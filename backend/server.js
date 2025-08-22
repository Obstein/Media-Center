const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const { spawn } = require('child_process');

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
        
        // Rozszerzona tabela downloads z nowymi kolumnami
        db.run(`
            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stream_id INTEGER,
                stream_type TEXT,
                episode_id TEXT,
                filename TEXT,
                filepath TEXT,
                status TEXT DEFAULT 'queued', -- queued, downloading, completed, failed
                worker_status TEXT DEFAULT 'queued', -- queued, downloading, completed, failed
                download_status TEXT DEFAULT 'pending', -- pending, downloading, completed, failed
                progress INTEGER DEFAULT 0,
                error_message TEXT,
                download_url TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Tabela logów pobierania
        db.run(`
            CREATE TABLE IF NOT EXISTS download_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                download_id INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                level TEXT DEFAULT 'INFO',
                message TEXT,
                FOREIGN KEY (download_id) REFERENCES downloads(id)
            )
        `);
        
        // Dodaj nowe kolumny do istniejącej tabeli downloads jeśli nie istnieją
        db.all("PRAGMA table_info(downloads)", [], (err, columns) => {
            if (err) {
                console.error("Błąd sprawdzania struktury tabeli downloads:", err);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            
            if (!columnNames.includes('worker_status')) {
                db.run("ALTER TABLE downloads ADD COLUMN worker_status TEXT DEFAULT 'queued'", (alterErr) => {
                    if (alterErr) console.error("Błąd dodawania kolumny worker_status:", alterErr);
                    else console.log("Dodano kolumnę worker_status");
                });
            }
            
            if (!columnNames.includes('download_status')) {
                db.run("ALTER TABLE downloads ADD COLUMN download_status TEXT DEFAULT 'pending'", (alterErr) => {
                    if (alterErr) console.error("Błąd dodawania kolumny download_status:", alterErr);
                    else console.log("Dodano kolumnę download_status");
                });
            }
            
            if (!columnNames.includes('download_url')) {
                db.run("ALTER TABLE downloads ADD COLUMN download_url TEXT", (alterErr) => {
                    if (alterErr) console.error("Błąd dodawania kolumny download_url:", alterErr);
                    else console.log("Dodano kolumnę download_url");
                });
            }
        });
        
        console.log("Baza danych zainicjalizowana z tabelami pobierania");
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

// --- Funkcja retry dla API calls ---
async function makeRetryRequest(url, options = {}, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(url, {
                timeout: 15000,
                ...options
            });
            return response;
        } catch (error) {
            console.error(`API request failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
            
            // Jeśli to ostatnia próba, rzuć błąd
            if (attempt === maxRetries) {
                throw error;
            }
            
            // Sprawdź czy warto ponowić próbę
            const shouldRetry = (
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                (error.response && [502, 503, 504, 521, 522, 523, 524].includes(error.response.status))
            );
            
            if (!shouldRetry) {
                throw error;
            }
            
            // Czekaj przed następną próbą (exponential backoff)
            const waitTime = delay * Math.pow(2, attempt - 1);
            console.log(`Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// --- Kolejka pobierania ---
let downloadQueue = [];
let isProcessing = false;
const activeDownloads = new Map();

// --- Download Manager Process ---
let downloadManagerProcess = null;

// NOWA FUNKCJA - Wklej ją tutaj
async function sendDiscordNotification(message) {
    try {
        const webhookUrl = await dbAll('SELECT value FROM settings WHERE key = ?', ['discordWebhook']);
        if (webhookUrl && webhookUrl[0] && webhookUrl[0].value) {
            await axios.post(webhookUrl[0].value, {
                content: message,
                username: "Media Center Downloader"
            });
            console.log("Wysłano powiadomienie na Discord.");
        }
    } catch (error) {
        console.error("Nie udało się wysłać powiadomienia na Discord:", error.message);
    }
}

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
        res.status(200).json({ message: 'Ustawienia zostały pomyślnie zapisane.' });
    } catch (error) {
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
            res.json({ items: rows, totalPages, currentPage: parseInt(page), totalItems });
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
        
        // Użyj retry mechanism dla Xtream API calls
        try {
            if (finalDetails.stream_type === 'series') {
                const xtreamUrl = `${xtreamBaseUrl}&action=get_series_info&series_id=${id}`;
                console.log(`Fetching series info for ID: ${id}`);
                const seriesInfoRes = await makeRetryRequest(xtreamUrl);
                finalDetails.xtream_details = seriesInfoRes.data;
                if (seriesInfoRes.data?.info?.tmdb) {
                    tmdbIdToUse = seriesInfoRes.data.info.tmdb;
                }
            } else if (finalDetails.stream_type === 'movie') {
                const xtreamUrl = `${xtreamBaseUrl}&action=get_vod_info&vod_id=${id}`;
                console.log(`Fetching movie info for ID: ${id}`);
                const movieInfoRes = await makeRetryRequest(xtreamUrl);
                finalDetails.xtream_details = { info: movieInfoRes.data?.movie_data, ...movieInfoRes.data };
                if (movieInfoRes.data?.movie_data?.tmdb_id) {
                    tmdbIdToUse = movieInfoRes.data.movie_data.tmdb_id;
                }
            }
        } catch (xtreamError) {
            console.error(`Failed to fetch Xtream details after retries: ${xtreamError.message}`);
            // Kontynuuj bez szczegółów Xtream jeśli nie można ich pobrać
            finalDetails.xtream_details = null;
            finalDetails.xtream_error = `Nie udało się pobrać szczegółów z serwera: ${xtreamError.message}`;
        }
        
        // TMDB API call z retry
        if (tmdbIdToUse) {
            const tmdbType = finalDetails.stream_type === 'series' ? 'tv' : 'movie';
            const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbIdToUse}?api_key=${tmdbApi}&append_to_response=videos,credits,translations`;
            try {
                console.log(`Fetching TMDB details for ID: ${tmdbIdToUse}`);
                const tmdbRes = await makeRetryRequest(tmdbUrl);
                let tmdbData = tmdbRes.data;
                const polishTranslation = tmdbData.translations?.translations?.find(t => t.iso_639_1 === 'pl');
                if (polishTranslation?.data) {
                    tmdbData.title = polishTranslation.data.title || tmdbData.title;
                    tmdbData.name = polishTranslation.data.name || tmdbData.name;
                    tmdbData.overview = polishTranslation.data.overview || tmdbData.overview;
                }
                finalDetails.tmdb_details = tmdbData;
            } catch(tmdbError) {
                console.error(`Failed to fetch TMDB details after retries: ${tmdbError.message}`);
                finalDetails.tmdb_details = null;
                finalDetails.tmdb_error = `Nie udało się pobrać szczegółów z TMDB: ${tmdbError.message}`;
            }
        }
        
        res.json(finalDetails);
    } catch (error) {
        console.error(`Błąd podczas pobierania szczegółów dla ${type}/${id}:`, error.message);
        res.status(500).json({ 
            error: 'Nie udało się pobrać szczegółów.',
            details: error.message 
        });
    }
});

// --- ZOPTYMALIZOWANE ODŚWIEŻANIE MEDIÓW ---
app.post('/api/media/refresh', async (req, res) => {
    let settings;
    let transactionActive = false;
    
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
        
        // Pobierz dane z Xtream
        let moviesList = [];
        let seriesList = [];
        
        try {
            console.log('Pobieranie filmów...');
            const moviesRes = await axios.get(`${xtreamBaseUrl}&action=get_vod_streams`, {
                timeout: 30000
            });
            moviesList = Array.isArray(moviesRes.data) ? moviesRes.data.map(m => ({...m, stream_type: 'movie'})) : [];
            console.log(`Pobrano ${moviesList.length} filmów`);
        } catch (error) {
            console.error('Błąd pobierania filmów:', error.message);
        }
        
        try {
            console.log('Pobieranie seriali...');
            const seriesRes = await axios.get(`${xtreamBaseUrl}&action=get_series`, {
                timeout: 30000
            });
            seriesList = Array.isArray(seriesRes.data) ? seriesRes.data.map(s => ({...s, stream_type: 'series', stream_id: s.series_id})) : [];
            console.log(`Pobrano ${seriesList.length} seriali`);
        } catch (error) {
            console.error('Błąd pobierania seriali:', error.message);
        }
        
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
        
        // Rozpocznij transakcję TYLKO jeśli mamy zmiany do wykonania
        await dbRun('BEGIN TRANSACTION');
        transactionActive = true;
        
        // Usuń stare pozycje
        if (itemsToDelete.length > 0) {
            console.log(`Usuwanie ${itemsToDelete.length} starych pozycji...`);
            
            const deleteMediaStmt = db.prepare('DELETE FROM media WHERE stream_id = ? AND stream_type = ?');
            const deleteGenresStmt = db.prepare('DELETE FROM media_genres WHERE media_stream_id = ? AND media_stream_type = ?');
            const deleteFavoritesStmt = db.prepare('DELETE FROM favorites WHERE stream_id = ? AND stream_type = ?');
            
            try {
                for (const item of itemsToDelete) {
                    await stmtRun(deleteMediaStmt, [item.stream_id, item.stream_type]);
                    await stmtRun(deleteGenresStmt, [item.stream_id, item.stream_type]);
                    await stmtRun(deleteFavoritesStmt, [item.stream_id, item.stream_type]);
                }
            } finally {
                deleteMediaStmt.finalize();
                deleteGenresStmt.finalize();
                deleteFavoritesStmt.finalize();
            }
        }
        
        // Dodaj nowe pozycje
        if (itemsToAdd.length > 0) {
            console.log(`Dodawanie ${itemsToAdd.length} nowych pozycji...`);
            
            const insertMediaSql = `INSERT OR REPLACE INTO media (stream_id, name, stream_icon, rating, tmdb_id, stream_type, container_extension) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            const insertGenreSql = `INSERT OR IGNORE INTO genres (id, name) VALUES (?, ?)`;
            const insertMediaGenreSql = `INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) VALUES (?, ?, ?)`;
            
            const mediaStmt = db.prepare(insertMediaSql);
            const genreStmt = db.prepare(insertGenreSql);
            const mediaGenreStmt = db.prepare(insertMediaGenreSql);
            
            try {
                let processedCount = 0;
                for (const item of itemsToAdd) {
                    const tmdbId = item.tmdb;
                    await stmtRun(mediaStmt, [
                        item.stream_id, 
                        item.name, 
                        item.stream_icon || item.cover, 
                        item.rating_5based || item.rating, 
                        tmdbId, 
                        item.stream_type, 
                        item.container_extension
                    ]);
                    
                    // Pobierz gatunki z TMDB jeśli mamy ID
                    if (tmdbId) {
                        try {
                            const tmdbType = item.stream_type === 'series' ? 'tv' : 'movie';
                            const tmdbUrl = `${tmdbBaseUrl}/${tmdbType}/${tmdbId}?api_key=${tmdbApi}&language=pl-PL`;
                            
                            const tmdbRes = await axios.get(tmdbUrl, {
                                timeout: 10000
                            });
                            
                            if (tmdbRes.data && tmdbRes.data.genres) {
                                for (const genre of tmdbRes.data.genres) {
                                    await stmtRun(genreStmt, [genre.id, genre.name]);
                                    await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, genre.id]);
                                }
                            }
                            
                            await delay(50); // Krótkie opóźnienie dla TMDB API
                        } catch (tmdbError) {
                            if (tmdbError.response && tmdbError.response.status !== 404) {
                                console.warn(`Błąd TMDB dla ID ${tmdbId} (typ: ${item.stream_type}): ${tmdbError.response.status}`);
                            }
                            // Dodaj domyślny gatunek przy błędzie
                            await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                        }
                    } else {
                        // Brak TMDB ID - dodaj domyślny gatunek
                        await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                    }
                    
                    processedCount++;
                    if (processedCount % 100 === 0) {
                        console.log(`Przetworzono ${processedCount}/${itemsToAdd.length} nowych pozycji...`);
                    }
                }
            } finally {
                mediaStmt.finalize();
                genreStmt.finalize();
                mediaGenreStmt.finalize();
            }
        }
        
        // Zatwierdź transakcję
        await dbRun('COMMIT');
        transactionActive = false;
        
        const summary = `Synchronizacja zakończona. Dodano: ${itemsToAdd.length}, Usunięto: ${itemsToDelete.length}.`;
        console.log(summary);
        res.status(200).json({ message: summary });
        
    } catch (error) {
        console.error('Błąd podczas odświeżania listy mediów:', error.message);
        
        // Wycofaj transakcję tylko jeśli jest aktywna
        if (transactionActive) {
            try {
                await dbRun('ROLLBACK');
            } catch (rollbackError) {
                console.error('Błąd podczas rollback:', rollbackError.message);
            }
        }
        
        res.status(500).json({ 
            error: `Nie udało się pobrać lub przetworzyć listy. Błąd: ${error.message}` 
        });
    }
});

// --- API POBIERANIA ---
app.get('/api/downloads/status', async (req, res) => {
    try {
        // Pobierz z bazy danych z dodatkowymi kolumnami
        const downloads = await dbAll(`
            SELECT 
                id, stream_id, stream_type, episode_id, filename, filepath,
                status, worker_status, progress, error_message, download_url,
                added_at
            FROM downloads 
            ORDER BY added_at DESC 
            LIMIT 50
        `);
        
        // Dodaj logi pobierania jeśli istnieją
        const downloadsWithLogs = await Promise.all(downloads.map(async (download) => {
            try {
                const logs = await dbAll(`
                    SELECT timestamp, level, message 
                    FROM download_logs 
                    WHERE download_id = ? 
                    ORDER BY timestamp DESC 
                    LIMIT 10
                `, [download.id]);
                
                return {
                    ...download,
                    logs: logs
                };
            } catch (logError) {
                return download; // Zwróć bez logów jeśli błąd
            }
        }));
        
        res.json(downloadsWithLogs);
    } catch (error) {
        console.error("Błąd pobierania statusu:", error);
        res.status(500).json({ error: 'Błąd pobierania statusu.' });
    }
});

// Nowy endpoint do statystyk download managera
app.get('/api/downloads/statistics', async (req, res) => {
    try {
        const stats = await dbAll(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN worker_status = 'queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN worker_status = 'downloading' THEN 1 ELSE 0 END) as downloading,
                SUM(CASE WHEN worker_status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN worker_status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM downloads
        `);
        
        const recentActivity = await dbAll(`
            SELECT 
                dl.timestamp, dl.level, dl.message, dl.download_id,
                d.filename
            FROM download_logs dl
            LEFT JOIN downloads d ON dl.download_id = d.id
            ORDER BY dl.timestamp DESC 
            LIMIT 20
        `);
        
        res.json({
            statistics: stats[0],
            recent_activity: recentActivity
        });
    } catch (error) {
        console.error("Błąd pobierania statystyk:", error);
        res.status(500).json({ error: 'Błąd pobierania statystyk.' });
    }
});

app.post('/api/downloads/start', async (req, res) => {
    const { stream_id, stream_type, episodes } = req.body;
    if (!stream_id || !stream_type || !episodes || episodes.length === 0) {
        return res.status(400).json({ error: 'Brakujące dane do rozpoczęcia pobierania.' });
    }
    try {
        await dbRun('BEGIN TRANSACTION');
        const stmt = db.prepare('INSERT OR IGNORE INTO downloads (stream_id, stream_type, episode_id, filename, status, worker_status) VALUES (?, ?, ?, ?, ?, ?)');
        for (const episode of episodes) {
            await stmtRun(stmt, [stream_id, stream_type, episode.id, episode.filename, 'queued', 'queued']);
        }
        stmt.finalize();
        await dbRun('COMMIT');
        
        const jobIds = episodes.map(ep => ep.id);
        const newJobs = await dbAll(`SELECT * FROM downloads WHERE episode_id IN (${jobIds.map(() => '?').join(',')})`, jobIds);
        downloadQueue.push(...newJobs);

        res.status(202).json({ message: `Dodano ${episodes.length} zadań do kolejki pobierania.` });
        if (!isProcessing) {
            processDownloadQueue();
        }
    } catch (error) {
        console.error("Błąd dodawania do kolejki:", error);
        await dbRun('ROLLBACK');
        res.status(500).json({ error: 'Nie udało się dodać do kolejki.' });
    }
});

app.post('/api/downloads/remove/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Anuluj aktywne pobieranie, jeśli istnieje
        if (activeDownloads.has(parseInt(id))) {
            console.log(`Anulowanie aktywnego pobierania dla zadania ID: ${id}`);
            activeDownloads.get(parseInt(id)).kill('SIGKILL');
            activeDownloads.delete(parseInt(id));
        }
        
        // Usuń z kolejki w pamięci
        downloadQueue = downloadQueue.filter(job => job.id != id);

        // Pobierz informacje o zadaniu z bazy danych
        const jobToDelete = await dbAll('SELECT * FROM downloads WHERE id = ?', [id]);
        
        // Sprawdź, czy zadanie istnieje i czy plik nie został w pełni pobrany
        if (jobToDelete.length > 0 && jobToDelete[0].filepath && jobToDelete[0].worker_status !== 'completed') {
            const { filepath } = jobToDelete[0];
            if (fs.existsSync(filepath)) {
                console.log(`Usuwanie niekompletnego pliku: ${filepath}`);
                fs.unlinkSync(filepath);
                try {
                    const dir = path.dirname(filepath);
                    if (fs.readdirSync(dir).length === 0) {
                        console.log(`Usuwanie pustego folderu: ${dir}`);
                        fs.rmdirSync(dir);
                    }
                } catch (e) {
                    console.warn(`Nie można usunąć folderu ${path.dirname(filepath)}, prawdopodobnie nie jest pusty.`);
                }
            }
        }

        // Usuń wpis z bazy danych wraz z logami
        await dbRun('DELETE FROM download_logs WHERE download_id = ?', [id]);
        await dbRun('DELETE FROM downloads WHERE id = ?', [id]);
        
        res.status(200).json({ message: 'Zadanie usunięte z listy.' });
    } catch (error) {
        console.error(`Błąd usuwania zadania ${id}:`, error);
        res.status(500).json({ error: 'Nie udało się usunąć zadania.' });
    }
});

// --- Endpoint do uruchamiania download manager daemon ---
app.post('/api/downloads/start-daemon', async (req, res) => {
    try {
        if (downloadManagerProcess && !downloadManagerProcess.killed) {
            return res.status(400).json({ error: 'Download Manager już działa' });
        }
        
        console.log('Uruchamianie Download Manager w trybie daemon...');
        
        downloadManagerProcess = spawn('python3', ['download_manager.py', '--daemon'], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        downloadManagerProcess.stdout.on('data', (data) => {
            console.log(`[Download Manager] ${data.toString().trim()}`);
        });
        
        downloadManagerProcess.stderr.on('data', (data) => {
            console.error(`[Download Manager Error] ${data.toString().trim()}`);
        });
        
        downloadManagerProcess.on('close', (code) => {
            console.log(`Download Manager zatrzymany z kodem: ${code}`);
            downloadManagerProcess = null;
        });
        
        downloadManagerProcess.on('error', (error) => {
            console.error('Błąd uruchamiania Download Manager:', error);
            downloadManagerProcess = null;
        });
        
        // Czekaj chwilę aby upewnić się że proces się uruchomił
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (downloadManagerProcess && !downloadManagerProcess.killed) {
            res.json({ message: 'Download Manager uruchomiony pomyślnie', pid: downloadManagerProcess.pid });
        } else {
            res.status(500).json({ error: 'Nie udało się uruchomić Download Manager' });
        }
        
    } catch (error) {
        console.error('Błąd uruchamiania daemon:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint do zatrzymywania download manager daemon
app.post('/api/downloads/stop-daemon', async (req, res) => {
    try {
        if (!downloadManagerProcess || downloadManagerProcess.killed) {
            return res.status(400).json({ error: 'Download Manager nie działa' });
        }
        
        console.log('Zatrzymywanie Download Manager...');
        
        // Wyślij SIGTERM dla graceful shutdown
        downloadManagerProcess.kill('SIGTERM');
        
        // Czekaj na zakończenie procesu
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                // Jeśli nie zakończył się po 10s, wymuś zabicie
                if (downloadManagerProcess && !downloadManagerProcess.killed) {
                    downloadManagerProcess.kill('SIGKILL');
                }
                resolve();
            }, 10000);
            
            downloadManagerProcess.on('close', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        
        downloadManagerProcess = null;
        res.json({ message: 'Download Manager zatrzymany' });
        
    } catch (error) {
        console.error('Błąd zatrzymywania daemon:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint do sprawdzania statusu daemon
app.get('/api/downloads/daemon-status', (req, res) => {
    const isRunning = downloadManagerProcess && !downloadManagerProcess.killed;
    
    res.json({
        is_running: isRunning,
        pid: isRunning ? downloadManagerProcess.pid : null,
        uptime: isRunning ? Date.now() - downloadManagerProcess.spawntime : 0
    });
});

async function processDownloadQueue() {
    if (isProcessing || downloadQueue.length === 0) {
        return;
    }
    isProcessing = true;
    const job = downloadQueue.shift();
    
    try {
        // Aktualizuj status w bazie
        await dbRun('UPDATE downloads SET status = ?, worker_status = ? WHERE id = ?', 
                    ['downloading', 'downloading', job.id]);

        const settingsRows = await dbAll(`SELECT key, value FROM settings`);
        const settings = settingsRows.reduce((acc, row) => ({...acc, [row.key]: row.value }), {});
        const { serverUrl, username, password } = settings;
        
        // Pobierz szczegóły media
        const mediaDetailsRes = await axios.get(`http://localhost:${PORT}/api/media/details/${job.stream_type}/${job.stream_id}`);
        const { tmdb_details, xtream_details } = mediaDetailsRes.data;
        
        const title = tmdb_details?.title || tmdb_details?.name || xtream_details?.info?.name || job.filename;
        const year = (tmdb_details?.release_date || tmdb_details?.first_air_date || xtream_details?.info?.releasedate)?.substring(0, 4) || 'UnknownYear';
        
        const safeName = title.replace(/[^\w\s.-]/gi, '').trim();
        let folderPath = job.stream_type === 'movie'
            ? path.join('/downloads/movies', `${safeName} (${year})`)
            : path.join('/downloads/series', `${safeName} (${year})`);
        
        let extension = 'mp4';
        if (job.stream_type === 'movie') {
            extension = xtream_details?.info?.container_extension || extension;
        } else {
            const episodeData = Object.values(xtream_details.episodes).flat().find(ep => ep.id == job.episode_id);
            extension = episodeData?.container_extension || extension;
            if (episodeData?.season) {
                folderPath = path.join(folderPath, `Season ${String(episodeData.season).padStart(2, '0')}`);
            }
        }
        
        const safeFilename = `${job.filename.replace(/\.mp4$/, '')}.${extension}`;
        const filePath = path.join(folderPath, safeFilename);
        const downloadUrl = `${serverUrl}/${job.stream_type}/${username}/${password}/${job.episode_id}.${extension}`;

        // Aktualizuj szczegóły w bazie z URL pobierania
        await dbRun('UPDATE downloads SET filename = ?, filepath = ?, download_url = ? WHERE id = ?', 
                    [safeFilename, filePath, downloadUrl, job.id]);
        
        console.log(`Starting download job ${job.id}: ${safeFilename}`);

        // Użyj download_manager.py
        await new Promise((resolve, reject) => {
            const pythonProcess = spawn('python3', ['download_manager.py', downloadUrl, filePath]);
            activeDownloads.set(job.id, pythonProcess);

            let stdoutData = '';
            let stderrData = '';

            pythonProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
                console.log(`[Download ${job.id}] ${data.toString().trim()}`);
            });

            pythonProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
                console.error(`[Download ${job.id} Error] ${data.toString().trim()}`);
            });

            pythonProcess.on('close', (code) => {
                console.log(`Download ${job.id} finished with code: ${code}`);
                
                if (code === 0 || stdoutData.includes('SUCCESS')) {
                    resolve();
                } else {
                    reject(new Error(`Download failed with code ${code}. Error: ${stderrData}`));
                }
            });

            pythonProcess.on('error', (error) => {
                console.error(`Download ${job.id} process error:`, error);
                reject(error);
            });
        });

        // Oznacz jako ukończone
        await dbRun('UPDATE downloads SET status = ?, worker_status = ?, progress = 100 WHERE id = ?', 
                    ['completed', 'completed', job.id]);
        console.log(`✅ Download completed for job ${job.id}`);

    } catch (error) {
        console.error(`Błąd przetwarzania zadania ${job.id}:`, error);
        await dbRun('UPDATE downloads SET status = ?, worker_status = ?, error_message = ? WHERE id = ?', 
                    ['failed', 'failed', error.message, job.id]);
    } finally {
        activeDownloads.delete(job.id);
        isProcessing = false;
        // Kontynuuj przetwarzanie kolejki
        setTimeout(processDownloadQueue, 1000);
    }
}

async function monitorFavorites() {
    console.log('Uruchamianie zadania monitorowania ulubionych...');
    try {
        const settingsRows = await dbAll(`SELECT key, value FROM settings`);
        const settings = settingsRows.reduce((acc, row) => ({...acc, [row.key]: row.value }), {});
        const { serverUrl, username, password, tmdbApi } = settings;

        if (!serverUrl || !username || !password || !tmdbApi) {
            console.log('Monitorowanie przerwane: brak pełnej konfiguracji Xtream i TMDB.');
            return;
        }

        const favoriteSeries = await dbAll('SELECT * FROM favorites WHERE stream_type = ?', ['series']);
        if (favoriteSeries.length === 0) {
            console.log('Monitorowanie zakończone: brak ulubionych seriali do sprawdzenia.');
            return;
        }

        console.log(`Znaleziono ${favoriteSeries.length} ulubionych seriali do sprawdzenia...`);
        let newDownloadsAdded = false;

        for (const series of favoriteSeries) {
            const seriesInfoRes = await axios.get(`http://localhost:${PORT}/api/media/details/series/${series.stream_id}`);
            const allEpisodes = Object.values(seriesInfoRes.data.xtream_details.episodes).flat();
            
            const downloadedEpisodes = await dbAll('SELECT episode_id FROM downloads WHERE stream_id = ?', [series.stream_id]);
            const downloadedEpisodeIds = new Set(downloadedEpisodes.map(ep => ep.episode_id));

            const newEpisodes = allEpisodes.filter(ep => !downloadedEpisodeIds.has(ep.id));

            if (newEpisodes.length > 0) {
                console.log(`Znaleziono ${newEpisodes.length} nowych odcinków dla serialu: ${seriesInfoRes.data.name}`);
                newDownloadsAdded = true;

                const episodesToQueue = newEpisodes.map(ep => {
                    const title = seriesInfoRes.data.tmdb_details?.name || seriesInfoRes.data.name;
                    const filename = `${title.replace(/[^\w\s.-]/gi, '').trim()} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`;
                    return { id: ep.id, filename };
                });

                await axios.post(`http://localhost:${PORT}/api/downloads/start`, {
                    stream_id: series.stream_id,
                    stream_type: 'series',
                    episodes: episodesToQueue
                });

                const episodeList = newEpisodes.map(ep => `S${String(ep.season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`).join(', ');
                await sendDiscordNotification(`✅ Nowe odcinki dla **${seriesInfoRes.data.name}** dodane do kolejki: **${episodeList}**`);
            }
        }

        if (!newDownloadsAdded) {
            console.log('Monitorowanie zakończone: nie znaleziono nowych odcinków.');
        }

    } catch (error) {
        console.error("Wystąpił błąd podczas monitorowania ulubionych:", error.message);
    }
}

// Auto-start download manager przy starcie serwera
async function autoStartDownloadManager() {
    try {
        console.log('Auto-uruchamianie Download Manager...');
        
        downloadManagerProcess = spawn('python3', ['download_manager.py', '--daemon'], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        downloadManagerProcess.stdout.on('data', (data) => {
            console.log(`[Download Manager] ${data.toString().trim()}`);
        });
        
        downloadManagerProcess.stderr.on('data', (data) => {
            console.error(`[Download Manager Error] ${data.toString().trim()}`);
        });
        
        downloadManagerProcess.on('close', (code) => {
            console.log(`Download Manager zatrzymany z kodem: ${code}`);
            downloadManagerProcess = null;
            
            // Auto-restart po 30 sekundach jeśli unexpected shutdown
            if (code !== 0) {
                console.log('Nieprzewidziany błąd Download Manager, restart za 30s...');
                setTimeout(autoStartDownloadManager, 30000);
            }
        });
        
        downloadManagerProcess.on('error', (error) => {
            console.error('Błąd auto-uruchamiania Download Manager:', error);
            downloadManagerProcess = null;
        });
        
        console.log(`Download Manager uruchomiony automatycznie (PID: ${downloadManagerProcess.pid})`);
        
    } catch (error) {
        console.error('Błąd auto-uruchamiania Download Manager:', error);
    }
}

// Graceful shutdown download manager przy zamykaniu serwera
process.on('SIGTERM', () => {
    if (downloadManagerProcess && !downloadManagerProcess.killed) {
        console.log('Zatrzymywanie Download Manager...');
        downloadManagerProcess.kill('SIGTERM');
    }
});

process.on('SIGINT', () => {
    if (downloadManagerProcess && !downloadManagerProcess.killed) {
        console.log('Zatrzymywanie Download Manager...');
        downloadManagerProcess.kill('SIGTERM');
    }
    process.exit(0);
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

app.listen(PORT, () => {
    console.log(`Serwer backendu działa na porcie ${PORT}`);
    
    // Auto-start Download Manager po uruchomieniu serwera
    setTimeout(autoStartDownloadManager, 3000); // Czekaj 3s na inicjalizację bazy
});

cron.schedule('0 * * * *', async () => { // Uruchamia się co godzinę
    console.log('Uruchamianie zaplanowanych zadań...');
    
    const settingsRows = await dbAll(`SELECT key, value FROM settings WHERE key = 'checkFrequency'`);
    const frequency = parseInt(settingsRows[0]?.value || '12', 10);
    const currentHour = new Date().getHours();

    // Uruchom monitorowanie ulubionych zgodnie z ustawioną częstotliwością
    if (currentHour % frequency === 0) {
        monitorFavorites();
    } else {
        console.log(`Pominięto monitorowanie ulubionych. Następne sprawdzenie za ${frequency - (currentHour % frequency)}h.`);
    }

    // Zawsze uruchamiaj uzupełnianie brakujących gatunków
    backfillTmdbGenres(50);
});
