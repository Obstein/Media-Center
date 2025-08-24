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
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                server_url TEXT NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_sync DATETIME,
                media_count INTEGER DEFAULT 0
            )
        `);
        // Sprawdź czy tabela media ma kolumnę playlist_id
        db.all("PRAGMA table_info(media)", [], (err, columns) => {
            if (err) {
                console.error("Błąd sprawdzania struktury tabeli media:", err);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            
            if (!columnNames.includes('playlist_id')) {
                console.log("Dodawanie kolumny playlist_id do tabeli media...");
                db.run("ALTER TABLE media ADD COLUMN playlist_id INTEGER", (alterErr) => {
                    if (alterErr) {
                        console.error("Błąd dodawania kolumny playlist_id do media:", alterErr);
                    } else {
                        console.log("✅ Dodano kolumnę playlist_id do media");
                        // Po dodaniu kolumny, uruchom migrację danych
                        setTimeout(migrateExistingDataToPlaylists, 1000);
                    }
                });
            } else {
                console.log("Kolumna playlist_id już istnieje w tabeli media");
            }
        });
        
        // Dodaj playlist_id do favorites
        db.all("PRAGMA table_info(favorites)", [], (err, columns) => {
            if (err) {
                console.error("Błąd sprawdzania struktury tabeli favorites:", err);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            
            if (!columnNames.includes('playlist_id')) {
                console.log("Dodawanie kolumny playlist_id do tabeli favorites...");
                db.run("ALTER TABLE favorites ADD COLUMN playlist_id INTEGER", (alterErr) => {
                    if (alterErr) {
                        console.error("Błąd dodawania kolumny playlist_id do favorites:", alterErr);
                    } else {
                        console.log("✅ Dodano kolumnę playlist_id do favorites");
                    }
                });
            }
        });
        
        // Dodaj playlist_id do downloads
        db.all("PRAGMA table_info(downloads)", [], (err, columns) => {
            if (err) {
                console.error("Błąd sprawdzania struktury tabeli downloads:", err);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            
            if (!columnNames.includes('playlist_id')) {
                console.log("Dodawanie kolumny playlist_id do tabeli downloads...");
                db.run("ALTER TABLE downloads ADD COLUMN playlist_id INTEGER", (alterErr) => {
                    if (alterErr) {
                        console.error("Błąd dodawania kolumny playlist_id do downloads:", alterErr);
                    } else {
                        console.log("✅ Dodano kolumnę playlist_id do downloads");
                    }
                });
            }
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS media (
                stream_id INTEGER, name TEXT, stream_icon TEXT, rating REAL,
                tmdb_id TEXT, stream_type TEXT, container_extension TEXT,
                playlist_id INTEGER,
                PRIMARY KEY (stream_id, stream_type),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id)
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
                stream_id INTEGER, stream_type TEXT, playlist_id INTEGER,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (stream_id, stream_type, playlist_id),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id)
            )
        `);
        
        // Zaktualizowana tabela downloads
        db.run(`
            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stream_id INTEGER,
                stream_type TEXT,
                playlist_id INTEGER,
                episode_id TEXT,
                filename TEXT,
                filepath TEXT,
                status TEXT DEFAULT 'queued',
                worker_status TEXT DEFAULT 'queued',
                download_status TEXT DEFAULT 'pending',
                progress INTEGER DEFAULT 0,
                error_message TEXT,
                download_url TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (playlist_id) REFERENCES playlists(id)
            )
        `);
        
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
        
        console.log("Baza danych zainicjalizowana z systemem playlist");
        
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

// === FUNKCJA MIGRACJI ISTNIEJĄCYCH DANYCH ===
async function migrateExistingDataToPlaylists() {
    console.log('🔄 Rozpoczynanie migracji do systemu wielu playlist...');
    
    try {
        // Sprawdź czy już istnieje domyślna playlista
        const existingPlaylists = await dbAll('SELECT * FROM playlists');
        
        if (existingPlaylists.length === 0) {
            console.log('Tworzenie domyślnej playlisty...');
            
            // Pobierz istniejące ustawienia Xtream
            const settingsRows = await dbAll(`SELECT key, value FROM settings WHERE key IN ('serverUrl', 'username', 'password')`);
            const settings = settingsRows.reduce((acc, row) => ({...acc, [row.key]: row.value }), {});
            
            if (settings.serverUrl && settings.username && settings.password) {
                // Utwórz domyślną playlistę z istniejących ustawień
                const defaultPlaylistResult = await dbRun(`
                    INSERT INTO playlists (name, server_url, username, password, is_active, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, ['Domyślna Playlista', settings.serverUrl, settings.username, settings.password, 1, new Date().toISOString()]);
                
                const defaultPlaylistId = defaultPlaylistResult.lastID;
                console.log(`✅ Utworzono domyślną playlistę z ID: ${defaultPlaylistId}`);
                
                // Przypisz wszystkie istniejące media do domyślnej playlisty
                const mediaUpdateResult = await dbRun(`
                    UPDATE media SET playlist_id = ? WHERE playlist_id IS NULL
                `, [defaultPlaylistId]);
                
                console.log(`✅ Zaktualizowano ${mediaUpdateResult.changes} pozycji media`);
                
                // Przypisz wszystkie istniejące ulubione do domyślnej playlisty  
                const favoritesUpdateResult = await dbRun(`
                    UPDATE favorites SET playlist_id = ? WHERE playlist_id IS NULL
                `, [defaultPlaylistId]);
                
                console.log(`✅ Zaktualizowano ${favoritesUpdateResult.changes} ulubionych`);
                
                // Przypisz wszystkie istniejące pobierania do domyślnej playlisty
                const downloadsUpdateResult = await dbRun(`
                    UPDATE downloads SET playlist_id = ? WHERE playlist_id IS NULL
                `, [defaultPlaylistId]);
                
                console.log(`✅ Zaktualizowano ${downloadsUpdateResult.changes} pobierań`);
                
                // Zaktualizuj licznik mediów w playliście
                const mediaCount = await dbAll(`SELECT COUNT(*) as count FROM media WHERE playlist_id = ?`, [defaultPlaylistId]);
                await dbRun(`UPDATE playlists SET media_count = ? WHERE id = ?`, [mediaCount[0].count, defaultPlaylistId]);
                
                console.log('🎉 Migracja do systemu playlist zakończona pomyślnie!');
                
            } else {
                console.log('⚠️ Brak ustawień Xtream - migracja zostanie wykonana po pierwszym zapisie ustawień');
            }
        } else {
            console.log('Playlisty już istnieją - pomijanie migracji');
        }
        
    } catch (error) {
        console.error('❌ Błąd podczas migracji playlist:', error);
    }
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


// Dodaj te endpoint'y do server.js
// === API PLAYLISTS ===

// Pobierz wszystkie playlisty
app.get('/api/playlists', async (req, res) => {
    try {
        const playlists = await dbAll(`
            SELECT 
                p.*,
                COUNT(m.stream_id) as media_count,
                COUNT(CASE WHEN f.stream_id IS NOT NULL THEN 1 END) as favorites_count
            FROM playlists p
            LEFT JOIN media m ON p.id = m.playlist_id
            LEFT JOIN favorites f ON p.id = f.playlist_id
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `);
        
        res.json(playlists);
    } catch (error) {
        console.error('Błąd pobierania playlist:', error);
        res.status(500).json({ error: 'Nie udało się pobrać playlist.' });
    }
});

// Pobierz jedną playlistę
app.get('/api/playlists/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const playlist = await dbAll(`
            SELECT 
                p.*,
                COUNT(m.stream_id) as media_count,
                COUNT(CASE WHEN f.stream_id IS NOT NULL THEN 1 END) as favorites_count
            FROM playlists p
            LEFT JOIN media m ON p.id = m.playlist_id
            LEFT JOIN favorites f ON p.id = f.playlist_id
            WHERE p.id = ?
            GROUP BY p.id
        `, [id]);
        
        if (playlist.length === 0) {
            return res.status(404).json({ error: 'Playlista nie znaleziona.' });
        }
        
        res.json(playlist[0]);
    } catch (error) {
        console.error('Błąd pobierania playlisty:', error);
        res.status(500).json({ error: 'Nie udało się pobrać playlisty.' });
    }
});

// Dodaj nową playlistę
app.post('/api/playlists', async (req, res) => {
    const { name, server_url, username, password, is_active = true } = req.body;
    
    if (!name || !server_url || !username || !password) {
        return res.status(400).json({ error: 'Wszystkie pola są wymagane.' });
    }
    
    try {
        // Sprawdź czy nazwa nie jest zajęta
        const existing = await dbAll('SELECT id FROM playlists WHERE name = ?', [name]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Playlista o tej nazwie już istnieje.' });
        }
        
        const result = await dbRun(`
            INSERT INTO playlists (name, server_url, username, password, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [name, server_url, username, password, is_active ? 1 : 0, new Date().toISOString()]);
        
        const newPlaylist = await dbAll('SELECT * FROM playlists WHERE id = ?', [result.lastID]);
        
        console.log(`✅ Utworzono nową playlistę: ${name} (ID: ${result.lastID})`);
        res.status(201).json(newPlaylist[0]);
        
    } catch (error) {
        console.error('Błąd tworzenia playlisty:', error);
        res.status(500).json({ error: 'Nie udało się utworzyć playlisty.' });
    }
});

// Edytuj playlistę
app.put('/api/playlists/:id', async (req, res) => {
    const { id } = req.params;
    const { name, server_url, username, password, is_active } = req.body;
    
    if (!name || !server_url || !username || !password) {
        return res.status(400).json({ error: 'Wszystkie pola są wymagane.' });
    }
    
    try {
        // Sprawdź czy playlista istnieje
        const existing = await dbAll('SELECT * FROM playlists WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Playlista nie znaleziona.' });
        }
        
        // Sprawdź czy nazwa nie koliduje z inną playlistą
        const nameConflict = await dbAll('SELECT id FROM playlists WHERE name = ? AND id != ?', [name, id]);
        if (nameConflict.length > 0) {
            return res.status(400).json({ error: 'Playlista o tej nazwie już istnieje.' });
        }
        
        await dbRun(`
            UPDATE playlists 
            SET name = ?, server_url = ?, username = ?, password = ?, is_active = ?
            WHERE id = ?
        `, [name, server_url, username, password, is_active ? 1 : 0, id]);
        
        const updatedPlaylist = await dbAll('SELECT * FROM playlists WHERE id = ?', [id]);
        
        console.log(`✅ Zaktualizowano playlistę: ${name} (ID: ${id})`);
        res.json(updatedPlaylist[0]);
        
    } catch (error) {
        console.error('Błąd edycji playlisty:', error);
        res.status(500).json({ error: 'Nie udało się zaktualizować playlisty.' });
    }
});

// Usuń playlistę
app.delete('/api/playlists/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Sprawdź czy playlista istnieje
        const playlist = await dbAll('SELECT * FROM playlists WHERE id = ?', [id]);
        if (playlist.length === 0) {
            return res.status(404).json({ error: 'Playlista nie znaleziona.' });
        }
        
        // Sprawdź ile ma mediów
        const mediaCount = await dbAll('SELECT COUNT(*) as count FROM media WHERE playlist_id = ?', [id]);
        
        if (mediaCount[0].count > 0) {
            return res.status(400).json({ 
                error: `Nie można usunąć playlisty zawierającej ${mediaCount[0].count} pozycji. Usuń najpierw media lub przenieś je do innej playlisty.` 
            });
        }
        
        // Usuń powiązane dane
        await dbRun('DELETE FROM favorites WHERE playlist_id = ?', [id]);
        await dbRun('DELETE FROM downloads WHERE playlist_id = ?', [id]);
        await dbRun('DELETE FROM playlists WHERE id = ?', [id]);
        
        console.log(`🗑️ Usunięto playlistę: ${playlist[0].name} (ID: ${id})`);
        res.json({ message: 'Playlista została usunięta.' });
        
    } catch (error) {
        console.error('Błąd usuwania playlisty:', error);
        res.status(500).json({ error: 'Nie udało się usunąć playlisty.' });
    }
});

// Przełącz aktywność playlisty
app.post('/api/playlists/:id/toggle', async (req, res) => {
    const { id } = req.params;
    
    try {
        const playlist = await dbAll('SELECT * FROM playlists WHERE id = ?', [id]);
        if (playlist.length === 0) {
            return res.status(404).json({ error: 'Playlista nie znaleziona.' });
        }
        
        const newStatus = playlist[0].is_active ? 0 : 1;
        await dbRun('UPDATE playlists SET is_active = ? WHERE id = ?', [newStatus, id]);
        
        const updatedPlaylist = await dbAll('SELECT * FROM playlists WHERE id = ?', [id]);
        
        console.log(`🔄 Przełączono status playlisty ${playlist[0].name}: ${newStatus ? 'aktywna' : 'nieaktywna'}`);
        res.json(updatedPlaylist[0]);
        
    } catch (error) {
        console.error('Błąd przełączania statusu playlisty:', error);
        res.status(500).json({ error: 'Nie udało się zmienić statusu playlisty.' });
    }
});

// Status wszystkich playlist - przegląd
app.get('/api/playlists/overview', async (req, res) => {
    try {
        const overview = await dbAll(`
            SELECT 
                COUNT(*) as total_playlists,
                COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_playlists,
                SUM(media_count) as total_media,
                AVG(media_count) as avg_media_per_playlist
            FROM playlists
        `);
        
        const recentActivity = await dbAll(`
            SELECT name, last_sync, media_count
            FROM playlists 
            WHERE last_sync IS NOT NULL
            ORDER BY last_sync DESC
            LIMIT 5
        `);
        
        res.json({
            overview: overview[0],
            recent_activity: recentActivity
        });
        
    } catch (error) {
        console.error('Błąd pobierania przeglądu playlist:', error);
        res.status(500).json({ error: 'Nie udało się pobrać przeglądu playlist.' });
    }
});
// --- API: Ręczna synchronizacja TMDB ---
app.post('/api/tmdb/sync', async (req, res) => {
    const { limit = 100 } = req.body;
    
    try {
        let settings;
        try {
            const rows = await dbAll(`SELECT key, value FROM settings WHERE key = 'tmdbApi'`);
            if (rows.length === 0 || !rows[0].value) {
                return res.status(400).json({ error: 'Brak klucza API do TMDB w ustawieniach.' });
            }
            settings = { tmdbApi: rows[0].value };
        } catch (err) {
            return res.status(500).json({ error: 'Błąd odczytu ustawień.' });
        }

        // Sprawdź ile pozycji potrzebuje aktualizacji
        const itemsToUpdate = await dbAll(`
            SELECT m.stream_id, m.tmdb_id, m.stream_type, m.name
            FROM media m
            LEFT JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type
            WHERE m.tmdb_id IS NOT NULL AND m.tmdb_id != '' AND mg.genre_id IS NULL
            GROUP BY m.stream_id, m.stream_type
            LIMIT ?
        `, [limit]);

        if (itemsToUpdate.length === 0) {
            return res.json({ 
                message: 'Wszystkie pozycje mają już przypisane gatunki TMDB.',
                processed: 0,
                total: 0
            });
        }

        console.log(`Ręczna synchronizacja TMDB: ${itemsToUpdate.length} pozycji do zaktualizowania`);

        const tmdbBaseUrl = 'https://api.themoviedb.org/3';
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        
        const insertGenreSql = `INSERT OR IGNORE INTO genres (id, name) VALUES (?, ?)`;
        const insertMediaGenreSql = `INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) VALUES (?, ?, ?)`;
        
        const genreStmt = db.prepare(insertGenreSql);
        const mediaGenreStmt = db.prepare(insertMediaGenreSql);

        let processed = 0;
        let errors = 0;

        for (const item of itemsToUpdate) {
            const tmdbId = item.tmdb_id;
            try {
                const tmdbType = item.stream_type === 'series' ? 'tv' : 'movie';
                const tmdbUrl = `${tmdbBaseUrl}/${tmdbType}/${tmdbId}?api_key=${settings.tmdbApi}&language=pl-PL`;
                
                console.log(`Pobieranie TMDB dla: ${item.name} (ID: ${tmdbId})`);
                const tmdbRes = await axios.get(tmdbUrl, { timeout: 10000 });
                
                if (tmdbRes.data && tmdbRes.data.genres && tmdbRes.data.genres.length > 0) {
                    console.log(`✅ Pobrano ${tmdbRes.data.genres.length} gatunków dla: ${item.name}`);
                    for (const genre of tmdbRes.data.genres) {
                        await stmtRun(genreStmt, [genre.id, genre.name]);
                        await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, genre.id]);
                    }
                } else {
                    console.log(`⚠️ Brak gatunków dla: ${item.name}, dodaję domyślny`);
                    await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                }
                
                processed++;
                await delay(100); // Opóźnienie dla TMDB API
                
            } catch (tmdbError) {
                errors++;
                if (tmdbError.response && tmdbError.response.status === 404) {
                    console.warn(`❌ TMDB ID ${tmdbId} nie znaleziono (404) dla: ${item.name}`);
                    await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                } else {
                    console.error(`❌ Błąd TMDB dla ${item.name} (ID: ${tmdbId}): ${tmdbError.message}`);
                    // Dodaj domyślny gatunek przy błędzie
                    await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                }
            }
        }
        
        genreStmt.finalize();
        mediaGenreStmt.finalize();
        
        const summary = `Synchronizacja TMDB zakończona. Przetworzono: ${processed}/${itemsToUpdate.length}, Błędy: ${errors}`;
        console.log(summary);
        
        res.json({
            message: summary,
            processed: processed,
            total: itemsToUpdate.length,
            errors: errors
        });

    } catch (error) {
        console.error('Błąd synchronizacji TMDB:', error.message);
        res.status(500).json({ error: `Błąd synchronizacji TMDB: ${error.message}` });
    }
});

// --- API: Status synchronizacji TMDB ---
// Poprawiona wersja endpoint'u /api/tmdb/status

// --- API: Status synchronizacji TMDB ---
app.get('/api/tmdb/status', async (req, res) => {
    try {
        // Sprawdź ile pozycji bez gatunków
        const withoutGenres = await dbAll(`
            SELECT COUNT(*) as count
            FROM media m
            LEFT JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type
            WHERE m.tmdb_id IS NOT NULL AND m.tmdb_id != '' AND mg.genre_id IS NULL
        `);

        // Sprawdź ile pozycji z gatunkami - POPRAWIONA WERSJA dla SQLite
        const withGenres = await dbAll(`
            SELECT COUNT(*) as count
            FROM (
                SELECT DISTINCT m.stream_id, m.stream_type
                FROM media m
                JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type
                WHERE m.tmdb_id IS NOT NULL AND m.tmdb_id != '' AND mg.genre_id != -1
            ) as distinct_media
        `);

        // Sprawdź ile pozycji bez TMDB ID
        const withoutTmdb = await dbAll(`
            SELECT COUNT(*) as count
            FROM media m
            WHERE m.tmdb_id IS NULL OR m.tmdb_id = ''
        `);

        // Sprawdź ostatnie gatunki
        const recentGenres = await dbAll(`
            SELECT g.name, COUNT(*) as count
            FROM genres g
            JOIN media_genres mg ON g.id = mg.genre_id
            WHERE g.id != -1
            GROUP BY g.id, g.name
            ORDER BY COUNT(*) DESC
            LIMIT 10
        `);

        // Sprawdź całkowitą liczbę pozycji w bazie
        const totalMedia = await dbAll(`
            SELECT COUNT(*) as count
            FROM media
        `);

        res.json({
            without_genres: withoutGenres[0].count,
            with_genres: withGenres[0].count,
            without_tmdb_id: withoutTmdb[0].count,
            total_media: totalMedia[0].count,
            top_genres: recentGenres
        });

    } catch (error) {
        console.error('Błąd pobierania statusu TMDB:', error);
        res.status(500).json({ error: 'Błąd pobierania statusu TMDB.' });
    }
});

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
// W server.js, zamień istniejące API ulubionych:

// --- API ULUBIONE (ZAKTUALIZOWANE) ---
app.get('/api/favorites', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT f.stream_id, f.stream_type, f.playlist_id, p.name as playlist_name
            FROM favorites f
            LEFT JOIN playlists p ON f.playlist_id = p.id
        `);
        res.json(rows);
    } catch (error) {
        console.error('Błąd pobierania ulubionych:', error);
        res.status(500).json({ error: 'Nie udało się pobrać ulubionych.' });
    }
});

app.post('/api/favorites/toggle', async (req, res) => {
    const { stream_id, stream_type, playlist_id } = req.body;
    
    if (!stream_id || !stream_type) {
        return res.status(400).json({ error: 'Brakujące stream_id lub stream_type.' });
    }
    
    // Jeśli nie podano playlist_id, spróbuj go znaleźć z tabeli media
    let finalPlaylistId = playlist_id;
    if (!finalPlaylistId) {
        try {
            const mediaItem = await dbAll(
                'SELECT playlist_id FROM media WHERE stream_id = ? AND stream_type = ? LIMIT 1', 
                [stream_id, stream_type]
            );
            if (mediaItem.length > 0) {
                finalPlaylistId = mediaItem[0].playlist_id;
            }
        } catch (error) {
            console.error('Błąd znajdowania playlist_id:', error);
        }
    }
    
    if (!finalPlaylistId) {
        return res.status(400).json({ error: 'Nie można określić playlist_id dla tego elementu.' });
    }
    
    try {
        // Sprawdź czy już istnieje w ulubionych
        const existing = await dbAll(
            'SELECT * FROM favorites WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?', 
            [stream_id, stream_type, finalPlaylistId]
        );
        
        if (existing.length > 0) {
            // Usuń z ulubionych
            await dbRun(
                'DELETE FROM favorites WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?', 
                [stream_id, stream_type, finalPlaylistId]
            );
            res.json({ status: 'removed', playlist_id: finalPlaylistId });
        } else {
            // Dodaj do ulubionych
            await dbRun(
                'INSERT INTO favorites (stream_id, stream_type, playlist_id) VALUES (?, ?, ?)', 
                [stream_id, stream_type, finalPlaylistId]
            );
            res.json({ status: 'added', playlist_id: finalPlaylistId });
        }
        
    } catch (error) {
        console.error('Błąd zmiany statusu ulubionych:', error);
        res.status(500).json({ error: 'Błąd podczas zmiany statusu ulubionych.' });
    }
});

// --- API MEDIA ---
// W server.js, zamień istniejący endpoint /api/media na ten zaktualizowany:

app.get('/api/media', (req, res) => {
    const { 
        page = 1, 
        limit = 30, 
        search = '', 
        genre = 'all', 
        filter = '',
        playlist = 'all'  // NOWY PARAMETR
    } = req.query;
    
    const offset = (page - 1) * limit;
    let params = [];
    
    // Dodaj JOIN z playlistami żeby mieć nazwę playlisty
    let fromClause = `
        FROM media m 
        LEFT JOIN playlists p ON m.playlist_id = p.id
    `;
    let selectClause = 'SELECT DISTINCT m.*, p.name as playlist_name';
    
    let whereClauses = [];
    
    // Filtr ulubione
    if (filter === 'favorites') {
        fromClause += ' JOIN favorites f ON m.stream_id = f.stream_id AND m.stream_type = f.stream_type AND m.playlist_id = f.playlist_id';
    }
    
    // Filtr gatunków
    if (genre && genre !== 'all') {
        fromClause += ' JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type';
        whereClauses.push('mg.genre_id = ?');
        params.push(genre);
    }
    
    // Filtr wyszukiwania
    if (search) {
        whereClauses.push(`m.name LIKE ?`);
        params.push(`%${search}%`);
    }
    
    // NOWY: Filtr playlist
    if (playlist && playlist !== 'all') {
        if (playlist.includes(',')) {
            // Wiele playlist - playlist=1,2,3
            const playlistIds = playlist.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
            if (playlistIds.length > 0) {
                whereClauses.push(`m.playlist_id IN (${playlistIds.map(() => '?').join(',')})`);
                params.push(...playlistIds);
            }
        } else {
            // Pojedyncza playlista
            const playlistId = parseInt(playlist);
            if (!isNaN(playlistId)) {
                whereClauses.push('m.playlist_id = ?');
                params.push(playlistId);
            }
        }
    }
    
    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // Zapytania SQL
    const dataSql = `${selectClause} ${fromClause} ${whereString} ORDER BY m.name ASC LIMIT ? OFFSET ?`;
    const countSql = `SELECT COUNT(DISTINCT m.stream_id, m.stream_type, m.playlist_id) as total ${fromClause} ${whereString}`;
    
    const countParams = [...params];
    params.push(limit, offset);
    
    // Wykonaj zapytanie liczące
    db.get(countSql, countParams, (err, row) => {
        if (err) { 
            console.error('Błąd zapytania count:', err);
            res.status(500).json({ error: err.message }); 
            return; 
        }
        
        const totalItems = row.total;
        const totalPages = Math.ceil(totalItems / limit);
        
        // Wykonaj zapytanie główne
        db.all(dataSql, params, (err, rows) => {
            if (err) { 
                console.error('Błąd zapytania media:', err);
                res.status(500).json({ error: err.message }); 
                return; 
            }
            
            res.json({ 
                items: rows, 
                totalPages, 
                currentPage: parseInt(page), 
                totalItems,
                // DODATKOWE INFO
                applied_filters: {
                    search: search || null,
                    genre: genre !== 'all' ? genre : null,
                    filter: filter || null,
                    playlist: playlist !== 'all' ? playlist : null
                }
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
        console.log(`Fetching media details for ${job.stream_type} ID: ${job.stream_id}`);
        const mediaDetailsRes = await axios.get(`http://localhost:${PORT}/api/media/details/${job.stream_type}/${job.stream_id}`);
        const details = mediaDetailsRes.data;
        const { tmdb_details, xtream_details } = details;

        console.log(`🔍 DEBUG: Szczegóły filmu dla ID ${job.stream_id}:`);
        console.log(`  - job.filename: ${job.filename}`);
        console.log(`  - details.container_extension: ${details.container_extension}`);
        console.log(`  - xtream_details struktura:`, Object.keys(xtream_details || {}));

        if (xtream_details?.info) {
            console.log(`  - xtream_details.info keys:`, Object.keys(xtream_details.info));
            console.log(`  - xtream_details.info.container_extension: ${xtream_details.info.container_extension}`);
        }

        if (xtream_details?.movie_data) {
            console.log(`  - xtream_details.movie_data keys:`, Object.keys(xtream_details.movie_data));
            console.log(`  - xtream_details.movie_data.container_extension: ${xtream_details.movie_data.container_extension}`);
        }

        // Sprawdź czy w nazwie pliku jest rozszerzenie
        const filenameMatch = job.filename?.match(/\.(mp4|mkv|avi|mov|m4v|wmv|flv|ts|m2ts)$/i);
        if (filenameMatch) {
            console.log(`  - Rozszerzenie z nazwy pliku: ${filenameMatch[1]}`);
        }

        // Określ prawidłowe rozszerzenie
        let extension = 'mp4'; // domyślne
        let downloadUrl;

        if (job.stream_type === 'movie') {
            // Dla filmów: sprawdź różne źródła rozszerzenia
            let movieExtension = null;
            
            // 1. Spróbuj z danych podstawowych media (najbardziej niezawodne)
            if (details.container_extension) {
                movieExtension = details.container_extension;
                console.log(`✅ Znaleziono rozszerzenie w details.container_extension: ${movieExtension}`);
            }
            // 2. Spróbuj z xtream_details.info.container_extension
            else if (xtream_details?.info?.container_extension) {
                movieExtension = xtream_details.info.container_extension;
                console.log(`✅ Znaleziono rozszerzenie w xtream_details.info: ${movieExtension}`);
            }
            // 3. Jeśli nadal brak, sprawdź czy w movie_data jest coś użytecznego
            else if (xtream_details?.movie_data?.container_extension) {
                movieExtension = xtream_details.movie_data.container_extension;
                console.log(`✅ Znaleziono rozszerzenie w xtream_details.movie_data: ${movieExtension}`);
            }
            // 4. Jeśli nadal nie mamy rozszerzenia, spróbuj odgadnąć na podstawie nazwy pliku
            else if (filenameMatch) {
                movieExtension = filenameMatch[1].toLowerCase();
                console.log(`✅ Znaleziono rozszerzenie w nazwie pliku: ${movieExtension}`);
            }
            
            // W ostateczności użyj mkv jako domyślnego
            extension = movieExtension || 'mkv';
            
            downloadUrl = `${serverUrl}/movie/${username}/${password}/${job.stream_id}.${extension}`;
            
            console.log(`🎬 MOVIE URL WITH CORRECT EXTENSION:`);
            console.log(`  - Stream ID: ${job.stream_id}`);
            console.log(`  - Final Extension: ${extension}`);
            console.log(`  - Final URL: ${downloadUrl}`);
            
        } else {
            // Dla seriali: znajdź konkretny odcinek i weź jego rozszerzenie
            const episodeData = Object.values(xtream_details.episodes).flat().find(ep => ep.id == job.episode_id);
            extension = episodeData?.container_extension || 'mkv';
            
            downloadUrl = `${serverUrl}/series/${username}/${password}/${job.episode_id}.${extension}`;
            
            console.log(`📺 SERIES URL:`);
            console.log(`  - Episode ID: ${job.episode_id}`);
            console.log(`  - Episode Extension: ${episodeData?.container_extension}`);
            console.log(`  - Final Extension: ${extension}`);
            console.log(`  - Final URL: ${downloadUrl}`);
        }
        
        // Reszta logiki nazewnictwa plików
        const title = tmdb_details?.title || tmdb_details?.name || xtream_details?.info?.name || job.filename;
        const year = (tmdb_details?.release_date || tmdb_details?.first_air_date || xtream_details?.info?.releasedate)?.substring(0, 4) || 'UnknownYear';
        
        const safeName = title.replace(/[^\w\s.-]/gi, '').trim();
        let folderPath = job.stream_type === 'movie'
            ? path.join('/downloads/movies', `${safeName} (${year})`)
            : path.join('/downloads/series', `${safeName} (${year})`);
        
        // Dla seriali dodaj folder sezonu
        if (job.stream_type === 'series') {
            const episodeData = Object.values(xtream_details.episodes).flat().find(ep => ep.id == job.episode_id);
            if (episodeData?.season) {
                folderPath = path.join(folderPath, `Season ${String(episodeData.season).padStart(2, '0')}`);
            }
        }
        
        const safeFilename = `${job.filename.replace(/\.(mp4|mkv|avi|mov)$/, '')}.${extension}`;
        const filePath = path.join(folderPath, safeFilename);

        // Aktualizuj szczegóły w bazie z URL pobierania
        await dbRun('UPDATE downloads SET filename = ?, filepath = ?, download_url = ? WHERE id = ?', 
                    [safeFilename, filePath, downloadUrl, job.id]);
        
        console.log(`Starting download job ${job.id}: ${safeFilename}`);
        console.log(`Download URL: ${downloadUrl}`);

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
            console.log(`🔍 Sprawdzanie serialu ID: ${series.stream_id}...`);
            
            try {
                const seriesInfoRes = await axios.get(`http://localhost:${PORT}/api/media/details/series/${series.stream_id}`);
                const allEpisodes = Object.values(seriesInfoRes.data.xtream_details.episodes).flat();
                
                // Sprawdź odcinki które są completed, downloading, lub mają już 3+ nieudane próby
                const existingDownloads = await dbAll(`
                    SELECT 
                        episode_id,
                        COUNT(*) as attempt_count,
                        MAX(CASE WHEN worker_status = 'completed' THEN 1 ELSE 0 END) as is_completed,
                        MAX(CASE WHEN worker_status = 'downloading' THEN 1 ELSE 0 END) as is_downloading
                    FROM downloads 
                    WHERE stream_id = ? AND stream_type = ?
                    GROUP BY episode_id
                    HAVING 
                        is_completed = 1 
                        OR is_downloading = 1 
                        OR attempt_count >= 3
                `, [series.stream_id, 'series']);

                const excludedEpisodeIds = new Set(existingDownloads.map(row => row.episode_id));

                console.log(`  - Wszystkich odcinków: ${allEpisodes.length}`);
                console.log(`  - Wykluczonych (completed/downloading/3+ prób): ${excludedEpisodeIds.size}`);

                // Sprawdź ile jest failed z mniej niż 3 próbami (do retry)
                const retryableDownloads = await dbAll(`
                    SELECT 
                        episode_id,
                        COUNT(*) as attempt_count
                    FROM downloads 
                    WHERE stream_id = ? AND stream_type = ? 
                    AND worker_status = 'failed'
                    GROUP BY episode_id
                    HAVING attempt_count < 3
                `, [series.stream_id, 'series']);

                console.log(`  - Do retry (< 3 próby): ${retryableDownloads.length}`);

                // Sprawdź ile ma już 3+ prób (do usunięcia)
                const maxAttemptsDownloads = await dbAll(`
                    SELECT 
                        episode_id,
                        COUNT(*) as attempt_count
                    FROM downloads 
                    WHERE stream_id = ? AND stream_type = ? 
                    AND worker_status = 'failed'
                    GROUP BY episode_id
                    HAVING attempt_count >= 3
                `, [series.stream_id, 'series']);

                // Usuń downloads które mają już 3+ nieudane próby (będą dodane ponownie jako nowe)
                if (maxAttemptsDownloads.length > 0) {
                    console.log(`🗑️ Usuwanie ${maxAttemptsDownloads.length} odcinków z 3+ nieudanymi próbami...`);
                    
                    for (const item of maxAttemptsDownloads) {
                        try {
                            // Usuń wszystkie próby dla tego odcinka
                            await dbRun(`
                                DELETE FROM downloads 
                                WHERE stream_id = ? AND stream_type = ? AND episode_id = ?
                            `, [series.stream_id, 'series', item.episode_id]);
                            
                            console.log(`  - Usunięto historie pobierania dla odcinka: ${item.episode_id}`);
                        } catch (error) {
                            console.error(`❌ Błąd usuwania downloads dla odcinka ${item.episode_id}:`, error);
                        }
                    }
                    
                    // Zaktualizuj listę wykluczonych po usunięciu
                    const updatedExistingDownloads = await dbAll(`
                        SELECT 
                            episode_id,
                            COUNT(*) as attempt_count,
                            MAX(CASE WHEN worker_status = 'completed' THEN 1 ELSE 0 END) as is_completed,
                            MAX(CASE WHEN worker_status = 'downloading' THEN 1 ELSE 0 END) as is_downloading
                        FROM downloads 
                        WHERE stream_id = ? AND stream_type = ?
                        GROUP BY episode_id
                        HAVING 
                            is_completed = 1 
                            OR is_downloading = 1 
                            OR attempt_count >= 3
                    `, [series.stream_id, 'series']);
                    
                    excludedEpisodeIds.clear();
                    updatedExistingDownloads.forEach(row => excludedEpisodeIds.add(row.episode_id));
                    
                    console.log(`  - Zaktualizowana lista wykluczonych: ${excludedEpisodeIds.size}`);
                }

                // Filtruj odcinki do dodania (nowe + te które zostały oczyszczone po 3 próbach)
                const newEpisodes = allEpisodes.filter(ep => !excludedEpisodeIds.has(ep.id));
                console.log(`  - Nowych + retry po cleanup: ${newEpisodes.length}`);

                if (newEpisodes.length > 0) {
                    console.log(`✨ Znaleziono ${newEpisodes.length} odcinków do dodania dla serialu: ${seriesInfoRes.data.name}`);
                    newDownloadsAdded = true;

                    const episodesToQueue = newEpisodes.map(ep => {
                        const title = seriesInfoRes.data.tmdb_details?.name || seriesInfoRes.data.name;
                        const filename = `${title.replace(/[^\w\s.-]/gi, '').trim()} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`;
                        return { id: ep.id, filename };
                    });

                    console.log(`  - Dodawanie do kolejki:`, episodesToQueue.map(ep => `${ep.id}:${ep.filename}`));

                    await axios.post(`http://localhost:${PORT}/api/downloads/start`, {
                        stream_id: series.stream_id,
                        stream_type: 'series',
                        episodes: episodesToQueue
                    });

                    const episodeList = newEpisodes.map(ep => 
                        `S${String(ep.season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`
                    ).join(', ');
                    
                    // Rozróżnij czy to nowe odcinki czy retry
                    const retryCount = retryableDownloads.length;
                    const cleanupCount = maxAttemptsDownloads.length;
                    const newCount = newEpisodes.length - retryCount;
                    
                    let notificationMessage = `✅ **${seriesInfoRes.data.name}** - dodano do kolejki: **${episodeList}**`;
                    if (retryCount > 0 || cleanupCount > 0) {
                        notificationMessage += `\n`;
                        if (retryCount > 0) notificationMessage += `🔄 Retry: ${retryCount} `;
                        if (cleanupCount > 0) notificationMessage += `🆕 Po cleanup: ${cleanupCount} `;
                        if (newCount > 0) notificationMessage += `✨ Nowe: ${newCount}`;
                    }
                    
                    await sendDiscordNotification(notificationMessage);
                } else {
                    console.log(`  - Brak nowych odcinków dla: ${seriesInfoRes.data.name}`);
                }

            } catch (seriesError) {
                console.error(`❌ Błąd podczas sprawdzania serialu ID ${series.stream_id}:`, seriesError.message);
                continue; // Przejdź do następnego serialu
            }
        }

        if (!newDownloadsAdded) {
            console.log('✅ Monitorowanie zakończone: nie znaleziono nowych odcinków.');
        } else {
            console.log('✅ Monitorowanie zakończone: znaleziono i dodano nowe odcinki.');
        }

    } catch (error) {
        console.error("❌ Wystąpił błąd podczas monitorowania ulubionych:", error.message);
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

// Zamień istniejący cron job na końcu server.js na:

cron.schedule('0 * * * *', async () => { // Uruchamia się co godzinę
    const currentTime = new Date().toLocaleString('pl-PL');
    console.log(`🕐 [${currentTime}] Uruchamianie zaplanowanych zadań...`);
    
    try {
        const settingsRows = await dbAll(`SELECT key, value FROM settings WHERE key = 'checkFrequency'`);
        const frequency = parseInt(settingsRows[0]?.value || '12', 10);
        const currentHour = new Date().getHours();

        // Uruchom monitorowanie ulubionych zgodnie z ustawioną częstotliwością
        if (currentHour % frequency === 0) {
            console.log(`📺 Uruchamianie monitorowania ulubionych (częstotliwość: co ${frequency}h)`);
            try {
                await monitorFavorites();
                console.log(`✅ Monitorowanie ulubionych zakończone pomyślnie`);
            } catch (error) {
                console.error(`❌ Błąd monitorowania ulubionych: ${error.message}`);
            }
        } else {
            const nextCheck = frequency - (currentHour % frequency);
            console.log(`⏳ Pominięto monitorowanie ulubionych. Następne sprawdzenie za ${nextCheck}h (o ${(currentHour + nextCheck) % 24}:00).`);
        }

        // Zawsze uruchamiaj uzupełnianie brakujących gatunków
        console.log(`🎭 Uruchamianie uzupełniania gatunków TMDB...`);
        try {
            await backfillTmdbGenres(50);
            console.log(`✅ Uzupełnianie gatunków TMDB zakończone pomyślnie`);
        } catch (error) {
            console.error(`❌ Błąd uzupełniania gatunków TMDB: ${error.message}`);
        }
        
    } catch (error) {
        console.error(`❌ Krytyczny błąd w cron job: ${error.message}`);
    }
    
    console.log(`🏁 [${new Date().toLocaleString('pl-PL')}] Zaplanowane zadania zakończone`);
});

// Dodaj również cron job do testowania (uruchamia się co 5 minut - tylko do debugowania)
cron.schedule('*/5 * * * *', async () => {
    const now = new Date();
    console.log(`🔍 [DEBUG] Cron job test - ${now.toLocaleString('pl-PL')} (minuty: ${now.getMinutes()})`);
    
    // Sprawdź status TMDB
    try {
        const withoutGenres = await dbAll(`
            SELECT COUNT(*) as count
            FROM media m
            LEFT JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type
            WHERE m.tmdb_id IS NOT NULL AND m.tmdb_id != '' AND mg.genre_id IS NULL
        `);
        
        if (withoutGenres[0].count > 0) {
            console.log(`📊 [DEBUG] Pozycji bez gatunków TMDB: ${withoutGenres[0].count}`);
        }
    } catch (error) {
        console.error(`❌ [DEBUG] Błąd sprawdzania statusu TMDB: ${error.message}`);
    }
});
