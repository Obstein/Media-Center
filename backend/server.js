const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = 3001;

const configDir = path.resolve(__dirname, 'config');
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}

const dbPath = path.resolve(configDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Błąd podczas łączenia z bazą danych:', err.message);
    } else {
        console.log(`Połączono z bazą danych SQLite w: ${dbPath}`);
        initializeDb();
    }
});

function initializeDb() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
        db.run(`
            CREATE TABLE IF NOT EXISTS media (
                stream_id INTEGER, name TEXT, stream_icon TEXT, rating REAL,
                tmdb_id TEXT, stream_type TEXT, container_extension TEXT,
                PRIMARY KEY (stream_id, stream_type)
            )
        `);
        db.run(`CREATE TABLE IF NOT EXISTS genres (id INTEGER PRIMARY KEY, name TEXT)`);
        db.run(`INSERT OR IGNORE INTO genres (id, name) VALUES (-1, 'Sprawdzono - Brak Gatunku')`);
        db.run(`
            CREATE TABLE IF NOT EXISTS media_genres (
                media_stream_id INTEGER, media_stream_type TEXT, genre_id INTEGER,
                PRIMARY KEY (media_stream_id, media_stream_type, genre_id),
                FOREIGN KEY (genre_id) REFERENCES genres(id)
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS favorites (
                stream_id INTEGER, stream_type TEXT, added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (stream_id, stream_type)
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stream_id INTEGER,
                stream_type TEXT,
                episode_id TEXT,
                filename TEXT,
                status TEXT DEFAULT 'queued', -- queued, downloading, completed, failed
                progress INTEGER DEFAULT 0,
                error_message TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    });
}

// --- Funkcje pomocnicze DB ---
function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) { if (err) reject(err); else resolve(this); });
    });
}
function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, function (err, rows) { if (err) reject(err); else resolve(rows); });
    });
}
function stmtRun(stmt, params = []) {
    return new Promise((resolve, reject) => {
        stmt.run(params, function (err) { if (err) reject(err); else resolve(this); });
    });
}

// --- Kolejka pobierania ---
let downloadQueue = [];
let isProcessing = false;

app.use(cors());
app.use(express.json());

// --- API: Image Proxy ---
app.get('/api/image-proxy', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).send('URL jest wymagany');
    }
    try {
        const decodedUrl = decodeURIComponent(url);
        const response = await axios({
            method: 'get',
            url: decodedUrl,
            responseType: 'stream',
            timeout: 5000
        });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        console.error(`Błąd proxy dla URL: ${decodeURIComponent(url)} - ${error.message}`);
        res.setHeader('Content-Type', 'image/gif');
        res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    }
});

// --- API USTAWIENIA ---
app.get('/api/settings', (req, res) => {
    const sql = `SELECT key, value FROM settings`;
    db.all(sql, [], (err, rows) => {
        if (err) { res.status(500).json({ error: err.message }); return; }
        const settings = rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
        res.json(settings);
    });
});

app.post('/api/settings', async (req, res) => {
    const settings = req.body;
    const sql = `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`;
    
    try {
        await dbRun('BEGIN TRANSACTION');
        const stmt = db.prepare(sql);
        for (const [key, value] of Object.entries(settings)) {
            await stmtRun(stmt, [key, value]);
        }
        stmt.finalize();
        await dbRun('COMMIT');
        console.log('Ustawienia pomyślnie zapisane w bazie danych.');
        res.status(200).json({ message: 'Ustawienia zostały pomyślnie zapisane.' });
    } catch (error) {
        console.error('Błąd podczas zapisu ustawień do bazy danych:', error);
        await dbRun('ROLLBACK');
        res.status(500).json({ error: 'Nie udało się zapisać ustawień.' });
    }
});

// --- API GATUNKI ---
app.get('/api/genres', (req, res) => {
    const sql = `SELECT * FROM genres ORDER BY name ASC`;
    db.all(sql, [], (err, rows) => {
        if (err) { res.status(500).json({ error: err.message }); return; }
        res.json(rows);
    });
});

// --- API ULUBIONE ---
app.get('/api/favorites', async (req, res) => {
    try {
        const rows = await dbAll('SELECT stream_id, stream_type FROM favorites');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Nie udało się pobrać ulubionych.' });
    }
});

app.post('/api/favorites/toggle', async (req, res) => {
    const { stream_id, stream_type } = req.body;
    if (!stream_id || !stream_type) {
        return res.status(400).json({ error: 'Brakujące dane.' });
    }

    try {
        const existing = await dbAll('SELECT * FROM favorites WHERE stream_id = ? AND stream_type = ?', [stream_id, stream_type]);
        
        if (existing.length > 0) {
            await dbRun('DELETE FROM favorites WHERE stream_id = ? AND stream_type = ?', [stream_id, stream_type]);
            res.json({ status: 'removed' });
        } else {
            await dbRun('INSERT INTO favorites (stream_id, stream_type) VALUES (?, ?)', [stream_id, stream_type]);
            res.json({ status: 'added' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Błąd podczas zmiany statusu ulubionych.' });
    }
});

// --- API MEDIA ---
app.get('/api/media', (req, res) => {
    const { page = 1, limit = 30, search = '', genre = 'all', filter = '' } = req.query;
    const offset = (page - 1) * limit;

    let params = [];
    let fromClause = 'FROM media m';
    let whereClauses = [];

    if (filter === 'favorites') {
        fromClause += ' JOIN favorites f ON m.stream_id = f.stream_id AND m.stream_type = f.stream_type';
    }

    if (genre && genre !== 'all') {
        fromClause += ' JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type';
        whereClauses.push('mg.genre_id = ?');
        params.push(genre);
    }
    
    if (search) {
        whereClauses.push(`m.name LIKE ?`);
        params.push(`%${search}%`);
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const dataSql = `SELECT DISTINCT m.* ${fromClause} ${whereString} ORDER BY m.name ASC LIMIT ? OFFSET ?`;
    const countSql = `SELECT COUNT(DISTINCT m.stream_id) as total ${fromClause} ${whereString}`;
    
    const countParams = [...params];
    params.push(limit, offset);

    db.get(countSql, countParams, (err, row) => {
        if (err) { res.status(500).json({ error: err.message }); return; }
        const totalItems = row.total;
        const totalPages = Math.ceil(totalItems / limit);

        db.all(dataSql, params, (err, rows) => {
            if (err) { res.status(500).json({ error: err.message }); return; }
            res.json({
                items: rows,
                totalPages,
                currentPage: parseInt(page),
                totalItems
            });
        });
    });
});

// --- API: SZCZEGÓŁY MEDIA ---
app.get('/api/media/details/:type/:id', async (req, res) => {
    const { type, id } = req.params;

    try {
        const settingsRows = await dbAll(`SELECT key, value FROM settings`);
        const settings = settingsRows.reduce((acc, row) => ({...acc, [row.key]: row.value }), {});
        const { serverUrl, username, password, tmdbApi } = settings;

        if (!tmdbApi || !serverUrl || !username || !password) {
            return res.status(400).json({ error: 'API nie jest w pełni skonfigurowane.' });
        }

        const mediaItemResult = await dbAll('SELECT * FROM media WHERE stream_id = ? AND stream_type = ?', [id, type]);
        if (!mediaItemResult || mediaItemResult.length === 0) {
            return res.status(404).json({ error: 'Nie znaleziono pozycji w bazie danych.' });
        }

        let finalDetails = { ...mediaItemResult[0] };
        let tmdbIdToUse = finalDetails.tmdb_id;

        const xtreamBaseUrl = `${serverUrl}/player_api.php?username=${username}&password=${password}`;
        
        if (finalDetails.stream_type === 'series') {
            const xtreamUrl = `${xtreamBaseUrl}&action=get_series_info&series_id=${id}`;
            const seriesInfoRes = await axios.get(xtreamUrl);
            finalDetails.xtream_details = seriesInfoRes.data;
            if (seriesInfoRes.data?.info?.tmdb) {
                tmdbIdToUse = seriesInfoRes.data.info.tmdb;
            }
        } else if (finalDetails.stream_type === 'movie') {
            const xtreamUrl = `${xtreamBaseUrl}&action=get_vod_info&vod_id=${id}`;
            const movieInfoRes = await axios.get(xtreamUrl);
            finalDetails.xtream_details = { info: movieInfoRes.data?.movie_data, ...movieInfoRes.data };
             if (movieInfoRes.data?.movie_data?.tmdb_id) {
                tmdbIdToUse = movieInfoRes.data.movie_data.tmdb_id;
            }
        }

        if (tmdbIdToUse) {
            const tmdbType = finalDetails.stream_type === 'series' ? 'tv' : 'movie';
            const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbIdToUse}?api_key=${tmdbApi}&append_to_response=videos,credits,translations`;
            try {
                const tmdbRes = await axios.get(tmdbUrl);
                let tmdbData = tmdbRes.data;

                const polishTranslation = tmdbData.translations?.translations?.find(t => t.iso_639_1 === 'pl');
                if (polishTranslation?.data) {
                    tmdbData.title = polishTranslation.data.title || tmdbData.title;
                    tmdbData.name = polishTranslation.data.name || tmdbData.name;
                    tmdbData.overview = polishTranslation.data.overview || tmdbData.overview;
                }
                
                finalDetails.tmdb_details = tmdbData;
            } catch(tmdbError) {
                console.error(`Nie udało się pobrać danych z TMDB dla ID ${tmdbIdToUse}: ${tmdbError.message}`);
            }
        }

        res.json(finalDetails);

    } catch (error) {
        console.error(`Błąd podczas pobierania szczegółów dla ${type}/${id}:`, error.message);
        res.status(500).json({ error: 'Nie udało się pobrać szczegółów.' });
    }
});


// --- ZOPTYMALIZOWANE ODŚWIEŻANIE MEDIÓW ---
app.post('/api/media/refresh', async (req, res) => {
    let settings;
    try {
        const rows = await dbAll(`SELECT key, value FROM settings`);
        settings = rows.reduce((acc, row) => ({...acc, [row.key]: row.value }), {});
    } catch (err) {
        return res.status(500).json({ error: 'Błąd odczytu ustawień.' });
    }
    
    const { serverUrl, username, password, tmdbApi } = settings;

    if (!serverUrl || !username || !password || !tmdbApi) {
        return res.status(400).json({ error: 'Wszystkie ustawienia (Xtream i TMDB API) muszą być skonfigurowane.' });
    }

    try {
        const xtreamBaseUrl = `${serverUrl}/player_api.php?username=${username}&password=${password}`;
        const tmdbBaseUrl = 'https://api.themoviedb.org/3';
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        
        console.log('Pobieranie filmów i seriali z Xtream...');
        const moviesRes = await axios.get(`${xtreamBaseUrl}&action=get_vod_streams`);
        const seriesRes = await axios.get(`${xtreamBaseUrl}&action=get_series`);

        const moviesList = Array.isArray(moviesRes.data) ? moviesRes.data.map(m => ({...m, stream_type: 'movie'})) : [];
        const seriesList = Array.isArray(seriesRes.data) ? seriesRes.data.map(s => ({...s, stream_type: 'series', stream_id: s.series_id})) : [];
        const incomingList = [...moviesList, ...seriesList];
        const incomingMediaSet = new Set(incomingList.map(item => `${item.stream_id}_${item.stream_type}`));

        console.log('Pobieranie istniejących mediów z bazy danych...');
        const existingMedia = await dbAll('SELECT stream_id, stream_type FROM media');
        const existingMediaSet = new Set(existingMedia.map(m => `${m.stream_id}_${m.stream_type}`));

        const itemsToAdd = incomingList.filter(item => !existingMediaSet.has(`${item.stream_id}_${item.stream_type}`));
        const itemsToDelete = existingMedia.filter(m => !incomingMediaSet.has(`${m.stream_id}_${m.stream_type}`));

        console.log(`Nowych pozycji do dodania: ${itemsToAdd.length}`);
        console.log(`Starych pozycji do usunięcia: ${itemsToDelete.length}`);

        if (itemsToAdd.length === 0 && itemsToDelete.length === 0) {
            return res.status(200).json({ message: 'Baza danych jest już aktualna. Nic nie zmieniono.' });
        }

        await dbRun('BEGIN TRANSACTION');
        
        if (itemsToDelete.length > 0) {
            const deleteMediaStmt = db.prepare('DELETE FROM media WHERE stream_id = ? AND stream_type = ?');
            const deleteGenresStmt = db.prepare('DELETE FROM media_genres WHERE media_stream_id = ? AND media_stream_type = ?');
            for (const item of itemsToDelete) {
                await stmtRun(deleteMediaStmt, [item.stream_id, item.stream_type]);
                await stmtRun(deleteGenresStmt, [item.stream_id, item.stream_type]);
            }
            deleteMediaStmt.finalize();
            deleteGenresStmt.finalize();
        }

        if (itemsToAdd.length > 0) {
            const insertMediaSql = `INSERT OR REPLACE INTO media (stream_id, name, stream_icon, rating, tmdb_id, stream_type, container_extension) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            const insertGenreSql = `INSERT OR IGNORE INTO genres (id, name) VALUES (?, ?)`;
            const insertMediaGenreSql = `INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) VALUES (?, ?, ?)`;
            
            const mediaStmt = db.prepare(insertMediaSql);
            const genreStmt = db.prepare(insertGenreSql);
            const mediaGenreStmt = db.prepare(insertMediaGenreSql);

            let processedCount = 0;
            for (const item of itemsToAdd) {
                const tmdbId = item.tmdb;
                await stmtRun(mediaStmt, [item.stream_id, item.name, item.stream_icon || item.cover, item.rating_5based || item.rating, tmdbId, item.stream_type, item.container_extension]);

                if (tmdbId) {
                    try {
                        const tmdbType = item.stream_type === 'series' ? 'tv' : 'movie';
                        const tmdbUrl = `${tmdbBaseUrl}/${tmdbType}/${tmdbId}?api_key=${tmdbApi}&language=pl-PL`;
                        const tmdbRes = await axios.get(tmdbUrl);
                        if (tmdbRes.data && tmdbRes.data.genres) {
                            for (const genre of tmdbRes.data.genres) {
                                await stmtRun(genreStmt, [genre.id, genre.name]);
                                await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, genre.id]);
                            }
                        }
                        await delay(50);
                    } catch (tmdbError) {
                        if (tmdbError.response && tmdbError.response.status !== 404) {
                            console.warn(`Błąd TMDB dla ID ${tmdbId} (typ: ${item.stream_type}): ${tmdbError.response.status}`);
                        }
                    }
                }
                processedCount++;
                if (processedCount % 100 === 0) {
                    console.log(`Przetworzono ${processedCount}/${itemsToAdd.length} nowych pozycji...`);
                }
            }
            
            mediaStmt.finalize();
            genreStmt.finalize();
            mediaGenreStmt.finalize();
        }

        await dbRun('COMMIT');
        
        const summary = `Synchronizacja zakończona. Dodano: ${itemsToAdd.length}, Usunięto: ${itemsToDelete.length}.`;
        console.log(summary);
        res.status(200).json({ message: summary });

    } catch (error) {
        console.error('Błąd podczas odświeżania listy mediów:', error.message);
        await dbRun('ROLLBACK');
        res.status(500).json({ error: `Nie udało się pobrać lub przetworzyć listy. Błąd: ${error.message}` });
    }
});

// --- API POBIERANIA ---
app.get('/api/downloads/status', async (req, res) => {
    try {
        const downloads = await dbAll('SELECT * FROM downloads ORDER BY added_at DESC LIMIT 10');
        res.json(downloads);
    } catch (error) {
        res.status(500).json({ error: 'Błąd pobierania statusu.' });
    }
});

app.post('/api/downloads/start', async (req, res) => {
    const { stream_id, stream_type, episodes } = req.body; // episodes to tablica

    if (!stream_id || !stream_type || !episodes || episodes.length === 0) {
        return res.status(400).json({ error: 'Brakujące dane do rozpoczęcia pobierania.' });
    }

    try {
        for (const episode of episodes) {
            const newDownload = {
                stream_id,
                stream_type,
                episode_id: episode.id,
                filename: episode.filename
            };
            await dbRun(
                'INSERT INTO downloads (stream_id, stream_type, episode_id, filename) VALUES (?, ?, ?, ?)',
                [stream_id, stream_type, episode.id, episode.filename]
            );
            downloadQueue.push(newDownload);
        }
        res.status(202).json({ message: `Dodano ${episodes.length} zadań do kolejki pobierania.` });
        if (!isProcessing) {
            processDownloadQueue();
        }
    } catch (error) {
        console.error("Błąd dodawania do kolejki:", error);
        res.status(500).json({ error: 'Nie udało się dodać do kolejki.' });
    }
});

async function processDownloadQueue() {
    if (isProcessing || downloadQueue.length === 0) {
        return;
    }
    isProcessing = true;
    const job = downloadQueue.shift();

    try {
        const settingsRows = await dbAll(`SELECT key, value FROM settings`);
        const settings = settingsRows.reduce((acc, row) => ({...acc, [row.key]: row.value }), {});
        const { serverUrl, username, password } = settings;

        const mediaInfo = await dbAll('SELECT * FROM media WHERE stream_id = ? AND stream_type = ?', [job.stream_id, job.stream_type]);
        if (mediaInfo.length === 0) throw new Error('Nie znaleziono media w bazie.');

        const details = mediaInfo[0];
        const yearMatch = details.name.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : 'UnknownYear';
        
        const safeName = details.name.replace(/[^a-z0-9\s-]/gi, '').trim();
        const folderPath = job.stream_type === 'movie'
            ? path.join('/downloads/movies', `${safeName} (${year})`)
            : path.join('/downloads/series', `${safeName} (${year})`);

        fs.mkdirSync(folderPath, { recursive: true });
        
        const filePath = path.join(folderPath, job.filename);
        const downloadUrl = `${serverUrl}/${job.stream_type === 'movie' ? 'movie' : 'series'}/${username}/${password}/${job.episode_id}.${details.container_extension || 'mp4'}`;

        await dbRun('UPDATE downloads SET status = ? WHERE episode_id = ?', ['downloading', job.episode_id]);

        await new Promise((resolve, reject) => {
            ffmpeg(downloadUrl)
                .on('progress', (progress) => {
                    const percent = Math.floor(progress.percent);
                    if (percent > 0) {
                        dbRun('UPDATE downloads SET progress = ? WHERE episode_id = ?', [percent, job.episode_id]);
                    }
                })
                .on('end', () => {
                    dbRun('UPDATE downloads SET status = ?, progress = 100 WHERE episode_id = ?', ['completed', job.episode_id]);
                    resolve();
                })
                .on('error', (err) => {
                    dbRun('UPDATE downloads SET status = ?, error_message = ? WHERE episode_id = ?', ['failed', err.message, job.episode_id]);
                    reject(err);
                })
                .outputOptions('-c', 'copy')
                .save(filePath);
        });

    } catch (error) {
        console.error(`Błąd przetwarzania zadania ${job.episode_id}:`, error);
        await dbRun('UPDATE downloads SET status = ?, error_message = ? WHERE episode_id = ?', ['failed', error.message, job.episode_id]);
    } finally {
        isProcessing = false;
        processDownloadQueue(); // Przetwórz następne zadanie
    }
}


app.listen(PORT, () => {
    console.log(`Serwer backendu działa na porcie ${PORT}`);
});

// --- Uzupełnianie brakujących danych w tle ---
async function backfillTmdbGenres(limit = 50) {
    console.log('Rozpoczynanie zadania uzupełniania brakujących gatunków TMDB...');

    let settings;
    try {
        const rows = await dbAll(`SELECT key, value FROM settings WHERE key = 'tmdbApi'`);
        if (rows.length === 0 || !rows[0].value) {
            console.log('Zadanie uzupełniania przerwane: brak klucza API do TMDB w ustawieniach.');
            return;
        }
        settings = { tmdbApi: rows[0].value };
    } catch (err) {
        console.error('Błąd odczytu ustawień w zadaniu uzupełniania:', err.message);
        return;
    }

    try {
        const itemsToUpdate = await dbAll(`
            SELECT m.stream_id, m.tmdb_id, m.stream_type
            FROM media m
            LEFT JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type
            WHERE m.tmdb_id IS NOT NULL AND m.tmdb_id != '' AND mg.genre_id IS NULL
            GROUP BY m.stream_id, m.stream_type
            LIMIT ?
        `, [limit]);

        if (itemsToUpdate.length === 0) {
            console.log('Zadanie uzupełniania zakończone: brak pozycji do zaktualizowania.');
            return;
        }

        console.log(`Znaleziono ${itemsToUpdate.length} pozycji do uzupełnienia gatunków.`);

        const tmdbBaseUrl = 'https://api.themoviedb.org/3';
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        
        const insertGenreSql = `INSERT OR IGNORE INTO genres (id, name) VALUES (?, ?)`;
        const insertMediaGenreSql = `INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) VALUES (?, ?, ?)`;
        
        const genreStmt = db.prepare(insertGenreSql);
        const mediaGenreStmt = db.prepare(insertMediaGenreSql);

        for (const item of itemsToUpdate) {
            const tmdbId = item.tmdb_id;
            try {
                const tmdbType = item.stream_type === 'series' ? 'tv' : 'movie';
                const tmdbUrl = `${tmdbBaseUrl}/${tmdbType}/${tmdbId}?api_key=${settings.tmdbApi}&language=pl-PL`;
                const tmdbRes = await axios.get(tmdbUrl);
                
                if (tmdbRes.data && tmdbRes.data.genres && tmdbRes.data.genres.length > 0) {
                    console.log(`Pobrano gatunki dla ${item.stream_type} ID ${tmdbId}`);
                    for (const genre of tmdbRes.data.genres) {
                        await stmtRun(genreStmt, [genre.id, genre.name]);
                        await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, genre.id]);
                    }
                } else {
                     await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                }
                await delay(100);
            } catch (tmdbError) {
                if (tmdbError.response && tmdbError.response.status === 404) {
                    console.warn(`TMDB ID ${tmdbId} nie znaleziono (404). Oznaczam jako sprawdzony.`);
                    await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                } else {
                    console.error(`Błąd TMDB dla ID ${tmdbId}: ${tmdbError.message}`);
                }
            }
        }
        
        genreStmt.finalize();
        mediaGenreStmt.finalize();
        console.log('Zadanie uzupełniania zakończone pomyślnie.');

    } catch (error) {
        console.error('Wystąpił krytyczny błąd w zadaniu uzupełniania:', error.message);
    }
}

cron.schedule('0 * * * *', () => {
    console.log('Uruchamianie zaplanowanego zadania uzupełniania gatunków TMDB...');
    backfillTmdbGenres(50);
});
