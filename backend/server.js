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

const WishlistManager = require('./wishlist_manager');

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
      db.all("PRAGMA table_info(media)", [], (err, columns) => {
    if (err) {
        console.error("Błąd sprawdzania struktury tabeli media:", err);
        return;
    }
    
    const columnNames = columns.map(col => col.name);
    
    if (!columnNames.includes('original_name')) {
        console.log("Dodawanie kolumny original_name do tabeli media...");
        db.run("ALTER TABLE media ADD COLUMN original_name TEXT", (alterErr) => {
            if (alterErr) {
                console.error("Błąd dodawania kolumny original_name do media:", alterErr);
            } else {
                console.log("✅ Dodano kolumnę original_name do media");
                // Wypełnij istniejące rekordy
                db.run("UPDATE media SET original_name = name WHERE original_name IS NULL", (updateErr) => {
                    if (!updateErr) {
                        console.log("✅ Zaktualizowano original_name dla istniejących mediów");
                    }
                });
            }
        });
    } else {
        console.log("Kolumna original_name już istnieje w tabeli media");
    }
});
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

        // Dodaj kolumnę archived jeśli nie istnieje
db.all("PRAGMA table_info(downloads)", [], (err, columns) => {
    if (err) {
        console.error("Błąd sprawdzania struktury tabeli downloads:", err);
        return;
    }
    
    const columnNames = columns.map(col => col.name);
    
    if (!columnNames.includes('archived')) {
        db.run("ALTER TABLE downloads ADD COLUMN archived BOOLEAN DEFAULT 0", (alterErr) => {
            if (alterErr) {
                console.error("Błąd dodawania kolumny archived:", alterErr);
            } else {
                console.log("✅ Dodano kolumnę archived do tabeli downloads");
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

// Inicjalizacja Wishlist Manager
let wishlistManager;
setTimeout(() => {
    wishlistManager = new WishlistManager(db, dbAll, dbRun, stmtRun);
}, 2000); // Opóźnienie aby baza była gotowa

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

// Synchronizuj pojedynczą playlistę
app.post('/api/playlists/:id/sync', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Sprawdź czy playlista istnieje i jest aktywna
        const playlist = await dbAll('SELECT * FROM playlists WHERE id = ? AND is_active = 1', [id]);
        if (playlist.length === 0) {
            return res.status(404).json({ error: 'Playlista nie znaleziona lub nieaktywna.' });
        }
        
        const playlistData = playlist[0];
        console.log(`🔄 Rozpoczynanie synchronizacji playlisty: ${playlistData.name}`);
        
        const result = await syncSinglePlaylist(playlistData);
        
        res.json({
            message: `Synchronizacja playlisty "${playlistData.name}" zakończona.`,
            playlist_id: id,
            playlist_name: playlistData.name,
            ...result
        });
        
    } catch (error) {
        console.error(`Błąd synchronizacji playlisty ${id}:`, error);
        res.status(500).json({ error: `Błąd synchronizacji: ${error.message}` });
    }
});

// Synchronizuj wszystkie aktywne playlisty
app.post('/api/playlists/sync-all', async (req, res) => {
    try {
        // Pobierz wszystkie aktywne playlisty
        const activePlaylists = await dbAll('SELECT * FROM playlists WHERE is_active = 1 ORDER BY id');
        
        if (activePlaylists.length === 0) {
            return res.json({ message: 'Brak aktywnych playlist do synchronizacji.' });
        }
        
        console.log(`🔄 Rozpoczynanie synchronizacji ${activePlaylists.length} aktywnych playlist...`);
        
        const results = [];
        let totalAdded = 0;
        let totalRemoved = 0;
        let errors = 0;
        
        // Synchronizuj każdą playlistę po kolei
        for (const playlist of activePlaylists) {
            try {
                console.log(`📺 Synchronizacja: ${playlist.name}...`);
                const result = await syncSinglePlaylist(playlist);
                
                results.push({
                    playlist_id: playlist.id,
                    playlist_name: playlist.name,
                    ...result
                });
                
                totalAdded += result.added || 0;
                totalRemoved += result.removed || 0;
                
                // Krótka przerwa między playlistami
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (playlistError) {
                console.error(`❌ Błąd synchronizacji playlisty ${playlist.name}:`, playlistError);
                errors++;
                results.push({
                    playlist_id: playlist.id,
                    playlist_name: playlist.name,
                    error: playlistError.message
                });
            }
        }
        
        const summary = `Synchronizacja zakończona. Playlist: ${activePlaylists.length}, Dodano: ${totalAdded}, Usunięto: ${totalRemoved}, Błędy: ${errors}`;
        console.log(`✅ ${summary}`);
        
        res.json({
            message: summary,
            total_playlists: activePlaylists.length,
            total_added: totalAdded,
            total_removed: totalRemoved,
            errors: errors,
            results: results
        });
        
    } catch (error) {
        console.error('Błąd synchronizacji wszystkich playlist:', error);
        res.status(500).json({ error: `Błąd synchronizacji: ${error.message}` });
    }
});

// Funkcja pomocnicza do synchronizacji pojedynczej playlisty
async function syncSinglePlaylist(playlist) {
    const { id: playlistId, server_url, username, password, name } = playlist;
    
    try {
        const xtreamBaseUrl = `${server_url}/player_api.php?username=${username}&password=${password}`;
        
        // Pobierz filmy i seriale z tej playlisty
        console.log(`  📡 Pobieranie danych z: ${server_url}...`);
        
        let moviesList = [];
        let seriesList = [];
        
        // Pobierz filmy
        try {
            const moviesRes = await axios.get(`${xtreamBaseUrl}&action=get_vod_streams`, { timeout: 30000 });
            moviesList = Array.isArray(moviesRes.data) ? moviesRes.data.map(m => ({ ...m, stream_type: 'movie' })) : [];
            console.log(`  🎬 Pobrano ${moviesList.length} filmów`);
        } catch (error) {
            console.warn(`  ⚠️ Błąd pobierania filmów z ${name}: ${error.message}`);
        }
        
        // Pobierz seriale
        try {
            const seriesRes = await axios.get(`${xtreamBaseUrl}&action=get_series`, { timeout: 30000 });
            seriesList = Array.isArray(seriesRes.data) ? seriesRes.data.map(s => ({ ...s, stream_type: 'series', stream_id: s.series_id })) : [];
            console.log(`  📺 Pobrano ${seriesList.length} seriali`);
        } catch (error) {
            console.warn(`  ⚠️ Błąd pobierania seriali z ${name}: ${error.message}`);
        }
        
        const incomingList = [...moviesList, ...seriesList];
        
        if (incomingList.length === 0) {
            console.warn(`  ⚠️ Brak danych z playlisty ${name}`);
            return { added: 0, removed: 0, message: 'Brak danych z serwera' };
        }
        
        // Pobierz istniejące media TYLKO dla tej konkretnej playlisty
        const existingMedia = await dbAll(
            'SELECT stream_id, stream_type FROM media WHERE playlist_id = ?', 
            [playlistId]
        );
        
        const incomingMediaSet = new Set(incomingList.map(item => `${item.stream_id}_${item.stream_type}`));
        const existingMediaSet = new Set(existingMedia.map(m => `${m.stream_id}_${m.stream_type}`));
        
        const itemsToAdd = incomingList.filter(item => !existingMediaSet.has(`${item.stream_id}_${item.stream_type}`));
        const itemsToDelete = existingMedia.filter(m => !incomingMediaSet.has(`${m.stream_id}_${m.stream_type}`));
        
        console.log(`  ➕ Do dodania: ${itemsToAdd.length}, ➖ Do usunięcia: ${itemsToDelete.length}`);
        
        let transactionActive = false;
        
        try {
            await dbRun('BEGIN TRANSACTION');
            transactionActive = true;
            
            // Usuń stare pozycje tylko z tej playlisty
            if (itemsToDelete.length > 0) {
                const deleteMediaStmt = db.prepare('DELETE FROM media WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?');
                const deleteGenresStmt = db.prepare(`
                    DELETE FROM media_genres 
                    WHERE media_stream_id = ? AND media_stream_type = ? 
                    AND NOT EXISTS (
                        SELECT 1 FROM media m2 
                        WHERE m2.stream_id = ? AND m2.stream_type = ? 
                        AND m2.playlist_id != ?
                    )
                `);
                const deleteFavoritesStmt = db.prepare('DELETE FROM favorites WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?');
                
                try {
                    for (const item of itemsToDelete) {
                        await stmtRun(deleteMediaStmt, [item.stream_id, item.stream_type, playlistId]);
                        await stmtRun(deleteGenresStmt, [
                            item.stream_id, item.stream_type, 
                            item.stream_id, item.stream_type, 
                            playlistId
                        ]);
                        await stmtRun(deleteFavoritesStmt, [item.stream_id, item.stream_type, playlistId]);
                    }
                } finally {
                    deleteMediaStmt.finalize();
                    deleteGenresStmt.finalize();
                    deleteFavoritesStmt.finalize();
                }
            }
            
            // Dodaj nowe pozycje
            if (itemsToAdd.length > 0) {
                const tmdbApiRows = await dbAll(`SELECT value FROM settings WHERE key = 'tmdbApi'`);
                const tmdbApi = tmdbApiRows[0]?.value;
                
                // ✅ POPRAWKA: ZACHOWAJ ORYGINALNĄ NAZWĘ Z IPTV
                const insertMediaSql = `INSERT OR REPLACE INTO media 
                    (stream_id, name, stream_icon, rating, tmdb_id, stream_type, container_extension, playlist_id, original_name) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                const insertGenreSql = `INSERT OR IGNORE INTO genres (id, name) VALUES (?, ?)`;
                const insertMediaGenreSql = `INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) VALUES (?, ?, ?)`;
                
                const mediaStmt = db.prepare(insertMediaSql);
                const genreStmt = db.prepare(insertGenreSql);
                const mediaGenreStmt = db.prepare(insertMediaGenreSql);
                
                try {
                    let processedCount = 0;
                    for (const item of itemsToAdd) {
                        const tmdbId = item.tmdb;
                        const originalName = item.name; // ✅ ZACHOWAJ ORYGINALNĄ NAZWĘ
                        
                        // Dodaj media z ORYGINALNĄ nazwą z IPTV
                        await stmtRun(mediaStmt, [
                            item.stream_id,
                            originalName, // ✅ UŻYJ ORYGINALNEJ NAZWY ZAMIAST TMDB
                            item.stream_icon || item.cover,
                            item.rating_5based || item.rating,
                            tmdbId,
                            item.stream_type,
                            item.container_extension,
                            playlistId,
                            originalName // ✅ ZAPISZ TAKŻE JAKO original_name
                        ]);
                        
                        // Sprawdź czy gatunki już istnieją dla tego media
                        const existingGenres = await dbAll(`
                            SELECT COUNT(*) as count 
                            FROM media_genres 
                            WHERE media_stream_id = ? AND media_stream_type = ?
                        `, [item.stream_id, item.stream_type]);
                        
                        // Pobierz gatunki z TMDB tylko jeśli jeszcze ich nie ma
                        if (existingGenres[0].count === 0 && tmdbId && tmdbApi) {
                            try {
                                const tmdbType = item.stream_type === 'series' ? 'tv' : 'movie';
                                // ✅ POPRAWKA: UŻYJ JĘZYKA POLSKIEGO + FALLBACK NA ANGIELSKI
                                const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${tmdbApi}&language=pl-PL&append_to_response=translations`;
                                
                                const tmdbRes = await axios.get(tmdbUrl, { timeout: 10000 });
                                let tmdbData = tmdbRes.data;
                                
                                // ✅ PRIORYTET DLA POLSKIEGO TŁUMACZENIA
                                if (tmdbData.translations?.translations) {
                                    const polishTranslation = tmdbData.translations.translations.find(t => t.iso_639_1 === 'pl');
                                    if (polishTranslation?.data) {
                                        // Jeśli mamy polskie tłumaczenie, użyj go TYLKO dla opisów, NIE dla tytułów
                                        console.log(`  🇵🇱 Znaleziono polskie tłumaczenie dla ${originalName}`);
                                        // NIE NADPISUJ NAZWY! Zachowaj oryginalną z IPTV
                                    }
                                }
                                
                                // Dodaj gatunki (niezależnie od języka)
                                if (tmdbData.genres) {
                                    for (const genre of tmdbData.genres) {
                                        await stmtRun(genreStmt, [genre.id, genre.name]);
                                        await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, genre.id]);
                                    }
                                } else {
                                    await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                                }
                                
                                await new Promise(resolve => setTimeout(resolve, 50));
                            } catch (tmdbError) {
                                await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                            }
                        } else if (existingGenres[0].count === 0) {
                            await stmtRun(mediaGenreStmt, [item.stream_id, item.stream_type, -1]);
                        }
                        
                        processedCount++;
                        if (processedCount % 100 === 0) {
                            console.log(`  📈 Przetworzono ${processedCount}/${itemsToAdd.length} pozycji...`);
                        }
                    }
                } finally {
                    mediaStmt.finalize();
                    genreStmt.finalize();
                    mediaGenreStmt.finalize();
                }
            }
            
            // Zaktualizuj licznik mediów i datę synchronizacji
            const newMediaCount = await dbAll('SELECT COUNT(*) as count FROM media WHERE playlist_id = ?', [playlistId]);
            await dbRun('UPDATE playlists SET media_count = ?, last_sync = ? WHERE id = ?', [
                newMediaCount[0].count, 
                new Date().toISOString(), 
                playlistId
            ]);
            
            await dbRun('COMMIT');
            transactionActive = false;
            
            console.log(`  ✅ Synchronizacja ${name} zakończona: +${itemsToAdd.length} -${itemsToDelete.length} (łącznie: ${newMediaCount[0].count})`);
            
            return {
                added: itemsToAdd.length,
                removed: itemsToDelete.length,
                total_media: newMediaCount[0].count
            };
            
        } catch (dbError) {
            if (transactionActive) {
                await dbRun('ROLLBACK');
            }
            throw dbError;
        }
        
    } catch (error) {
        throw new Error(`Synchronizacja playlisty ${name}: ${error.message}`);
    }
}
// --- API: Ręczna synchronizacja TMDB ---
app.post('/api/tmdb/sync', async (req, res) => {
    const { limit = 10000 } = req.body;
    
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
    LEFT JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type AND mg.genre_id != -1
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
    LEFT JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type AND mg.genre_id != -1
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

app.get('/api/media', (req, res) => {
    const { 
        page = 1, 
        limit = 30, 
        search = '', 
        genre = 'all', 
        filter = '',
        playlist = 'all'
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
    
    // POPRAWIONE ZAPYTANIA SQL
    const dataSql = `${selectClause} ${fromClause} ${whereString} ORDER BY m.name ASC LIMIT ? OFFSET ?`;
    
    // POPRAWKA: Użyj subquery dla COUNT z DISTINCT
    const countSql = `
        SELECT COUNT(*) as total 
        FROM (
            SELECT DISTINCT m.stream_id, m.stream_type, m.playlist_id
            ${fromClause} 
            ${whereString}
        ) as distinct_items
    `;
    
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
        // ✅ POPRAWKA: Pobierz tylko niezarchiwizowane pobierania
        const downloads = await dbAll(`
            SELECT 
                id, stream_id, stream_type, episode_id, filename, filepath,
                status, worker_status, progress, error_message, download_url,
                added_at, archived
            FROM downloads 
            WHERE (archived = 0 OR archived IS NULL)
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

async function archiveOldCompletedDownloads() {
    try {
        console.log('🗂️ Archiwizacja starych ukończonych pobierań...');
        
        // Znajdź wszystkie ukończone zadania które nie są jeszcze zarchiwizowane
        const unarchived = await dbAll(`
            SELECT id, filename FROM downloads 
            WHERE worker_status = 'completed' 
            AND (archived = 0 OR archived IS NULL)
        `);
        
        if (unarchived.length > 0) {
            // Archiwizuj je
            await dbRun(`
                UPDATE downloads 
                SET archived = 1 
                WHERE worker_status = 'completed' 
                AND (archived = 0 OR archived IS NULL)
            `);
            
            console.log(`📦 Zarchiwizowano ${unarchived.length} ukończonych pobierań`);
        } else {
            console.log('✅ Wszystkie ukończone pobierania są już zarchiwizowane');
        }
        
    } catch (error) {
        console.error('❌ Błąd archiwizacji:', error);
    }
}

// Nowy endpoint do statystyk download managera
app.get('/api/downloads/statistics', async (req, res) => {
    try {
        // Statystyki tylko dla niezarchiwizowanych
        const stats = await dbAll(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN worker_status = 'queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN worker_status = 'downloading' THEN 1 ELSE 0 END) as downloading,
                SUM(CASE WHEN worker_status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN worker_status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM downloads
            WHERE archived = 0 OR archived IS NULL
        `);
        
        // Statystyki archiwum (dodatkowe info)
        const archivedStats = await dbAll(`
            SELECT COUNT(*) as archived_count
            FROM downloads
            WHERE archived = 1
        `);
        
        const recentActivity = await dbAll(`
            SELECT 
                dl.timestamp, dl.level, dl.message, dl.download_id,
                d.filename
            FROM download_logs dl
            LEFT JOIN downloads d ON dl.download_id = d.id
            WHERE d.archived = 0 OR d.archived IS NULL
            ORDER BY dl.timestamp DESC 
            LIMIT 20
        `);
        
        res.json({
            statistics: {
                ...stats[0],
                archived: archivedStats[0].archived_count
            },
            recent_activity: recentActivity
        });
    } catch (error) {
        console.error("Błąd pobierania statystyk:", error);
        res.status(500).json({ error: 'Błąd pobierania statystyk.' });
    }
});

app.post('/api/downloads/start', async (req, res) => {
    const { stream_id, stream_type, episodes, playlist_id } = req.body; // DODAJ playlist_id
    
    if (!stream_id || !stream_type || !episodes || episodes.length === 0) {
        return res.status(400).json({ error: 'Brakujące dane do rozpoczęcia pobierania.' });
    }
    
    try {
        // POBIERZ DANE PLAYLISTY dla prawidłowego URL
        let playlistData = null;
        if (playlist_id) {
            const playlistRows = await dbAll('SELECT * FROM playlists WHERE id = ?', [playlist_id]);
            playlistData = playlistRows[0];
        } else {
            // Fallback - znajdź playlistę dla tego media
            const mediaRows = await dbAll('SELECT m.*, p.* FROM media m LEFT JOIN playlists p ON m.playlist_id = p.id WHERE m.stream_id = ? AND m.stream_type = ? LIMIT 1', [stream_id, stream_type]);
            playlistData = mediaRows[0];
        }
        
        if (!playlistData) {
            return res.status(400).json({ error: 'Nie znaleziono playlisty dla tego media.' });
        }
        
        await dbRun('BEGIN TRANSACTION');
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO downloads 
            (stream_id, stream_type, playlist_id, episode_id, filename, status, worker_status, download_url) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const episode of episodes) {
            // Wygeneruj prawidłowy URL już tutaj
            let downloadUrl;
            if (stream_type === 'movie') {
                downloadUrl = `${playlistData.server_url}/movie/${playlistData.username}/${playlistData.password}/${stream_id}.mp4`;
            } else {
                downloadUrl = `${playlistData.server_url}/series/${playlistData.username}/${playlistData.password}/${episode.id}.mkv`;
            }
            
            await stmtRun(stmt, [
                stream_id, 
                stream_type, 
                playlistData.id || playlist_id,
                episode.id, 
                episode.filename, 
                'queued', 
                'queued',
                downloadUrl
            ]);
        }
        
        stmt.finalize();
        await dbRun('COMMIT');
        
        const jobIds = episodes.map(ep => ep.id);
        const newJobs = await dbAll(`
            SELECT * FROM downloads 
            WHERE episode_id IN (${jobIds.map(() => '?').join(',')}) 
            AND stream_id = ?
        `, [...jobIds, stream_id]);
        
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
        // Sprawdź czy wpis istnieje
        const downloadJob = await dbAll('SELECT * FROM downloads WHERE id = ?', [id]);
        
        if (downloadJob.length === 0) {
            return res.status(404).json({ error: 'Zadanie nie znalezione.' });
        }

        const job = downloadJob[0];
        
        // ✅ NOWA LOGIKA: Ukończone zadania są już zarchiwizowane automatycznie
        if (job.worker_status === 'completed') {
            // Ukończone są już w archiwum (archived = 1), nie rób nic więcej
            console.log(`📦 Zadanie ${id} jest już zarchiwizowane: ${job.filename}`);
            res.status(200).json({ 
                message: 'Zadanie jest już w archiwum.', 
                action: 'already_archived' 
            });
        } else {
            // Anuluj aktywne pobieranie, jeśli istnieje
            if (activeDownloads.has(parseInt(id))) {
                console.log(`Anulowanie aktywnego pobierania dla zadania ID: ${id}`);
                activeDownloads.get(parseInt(id)).kill('SIGKILL');
                activeDownloads.delete(parseInt(id));
            }
            
            // Usuń z kolejki w pamięci
            downloadQueue = downloadQueue.filter(job => job.id != id);

            // Sprawdź, czy zadanie nie zostało w pełni pobrane i usuń plik
            if (job.filepath && fs.existsSync(job.filepath)) {
                console.log(`Usuwanie niekompletnego pliku: ${job.filepath}`);
                try {
                    fs.unlinkSync(job.filepath);
                    const dir = path.dirname(job.filepath);
                    if (fs.readdirSync(dir).length === 0) {
                        console.log(`Usuwanie pustego folderu: ${dir}`);
                        fs.rmdirSync(dir);
                    }
                } catch (fileError) {
                    console.warn(`Nie można usunąć pliku/folderu: ${fileError.message}`);
                }
            }

            // Usuń wpis z bazy danych wraz z logami
            await dbRun('DELETE FROM download_logs WHERE download_id = ?', [id]);
            await dbRun('DELETE FROM downloads WHERE id = ?', [id]);
            
            console.log(`🗑️ Usunięto niekompletne pobieranie: ${job.filename}`);
            res.status(200).json({ message: 'Zadanie zostało usunięte.', action: 'deleted' });
        }
        
    } catch (error) {
        console.error(`Błąd obsługi zadania ${id}:`, error);
        res.status(500).json({ error: 'Nie udało się obsłużyć zadania.' });
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

// === API ROUTES WISHLIST === 
// Dodaj te endpointy do server.js po istniejących API



// === WISHLIST API ===

// Pobierz wishlistę
app.get('/api/wishlist', async (req, res) => {
    try {
        const { status, media_type, priority, sort_by } = req.query;
        const filters = { status, media_type, priority, sort_by };
        
        const wishlist = await wishlistManager.getWishlist(filters);
        res.json(wishlist);
    } catch (error) {
        console.error('Błąd pobierania wishlisty:', error);
        res.status(500).json({ error: 'Nie udało się pobrać wishlisty.' });
    }
});

// Dodaj do wishlisty
app.post('/api/wishlist', async (req, res) => {
    try {
        const { tmdb_id, media_type, priority = 1, auto_download = true, search_keywords = '', notes = '' } = req.body;
        
        if (!tmdb_id || !media_type) {
            return res.status(400).json({ error: 'tmdb_id i media_type są wymagane.' });
        }

        if (!['movie', 'tv'].includes(media_type)) {
            return res.status(400).json({ error: 'media_type musi być "movie" lub "tv".' });
        }

        const result = await wishlistManager.addToWishlist(tmdb_id, media_type, {
            priority,
            autoDownload: auto_download,
            searchKeywords: search_keywords,
            notes
        });

        res.status(201).json(result);
    } catch (error) {
        console.error('Błąd dodawania do wishlisty:', error);
        const statusCode = error.message.includes('już istnieje') ? 409 : 500;
        res.status(statusCode).json({ error: error.message });
    }
});

// Aktualizuj pozycję wishlisty
app.put('/api/wishlist/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        await wishlistManager.updateWishlistItem(parseInt(id), updates);
        res.json({ message: 'Pozycja wishlisty została zaktualizowana.' });
    } catch (error) {
        console.error('Błąd aktualizacji wishlisty:', error);
        res.status(500).json({ error: error.message });
    }
});

// Usuń z wishlisty
app.delete('/api/wishlist/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await wishlistManager.removeFromWishlist(parseInt(id));
        res.json({ message: 'Pozycja została usunięta z wishlisty.' });
    } catch (error) {
        console.error('Błąd usuwania z wishlisty:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sprawdź wishlistę (ręcznie)
app.post('/api/wishlist/check', async (req, res) => {
    try {
        const result = await wishlistManager.checkWishlistMatches();
        res.json({
            message: `Sprawdzono ${result.checked} pozycji, znaleziono ${result.found} matchy.`,
            ...result
        });
    } catch (error) {
        console.error('Błąd sprawdzania wishlisty:', error);
        res.status(500).json({ error: error.message });
    }
});

// Pobierz statystyki wishlisty
app.get('/api/wishlist/stats', async (req, res) => {
    try {
        const stats = await wishlistManager.getWishlistStats();
        res.json(stats);
    } catch (error) {
        console.error('Błąd pobierania statystyk wishlisty:', error);
        res.status(500).json({ error: 'Nie udało się pobrać statystyk wishlisty.' });
    }
});

// Pobierz matche dla pozycji wishlisty
app.get('/api/wishlist/:id/matches', async (req, res) => {
    try {
        const { id } = req.params;
        const matches = await dbAll(`
            SELECT 
                wm.*,
                m.name as media_name,
                m.stream_icon,
                p.name as playlist_name
            FROM wishlist_matches wm
            LEFT JOIN media m ON wm.media_stream_id = m.stream_id AND wm.media_stream_type = m.stream_type
            LEFT JOIN playlists p ON wm.playlist_id = p.id
            WHERE wm.wishlist_id = ?
            ORDER BY wm.match_score DESC, wm.created_at DESC
        `, [id]);

        res.json(matches);
    } catch (error) {
        console.error('Błąd pobierania matchy wishlist:', error);
        res.status(500).json({ error: 'Nie udało się pobrać matchy.' });
    }
});

// Ręcznie pobierz konkretny match z wishlisty
app.post('/api/wishlist/:wishlistId/download/:matchId', async (req, res) => {
    try {
        const { wishlistId, matchId } = req.params;
        
        // Pobierz szczegóły wishlist item i match
        const wishlistItem = await dbAll('SELECT * FROM wishlist WHERE id = ?', [wishlistId]);
        const match = await dbAll(`
            SELECT wm.*, m.* 
            FROM wishlist_matches wm
            LEFT JOIN media m ON wm.media_stream_id = m.stream_id AND wm.media_stream_type = m.stream_type
            WHERE wm.id = ? AND wm.wishlist_id = ?
        `, [matchId, wishlistId]);

        if (wishlistItem.length === 0 || match.length === 0) {
            return res.status(404).json({ error: 'Nie znaleziono pozycji lub matcha.' });
        }

        const item = wishlistItem[0];
        const matchData = match[0];

        // Rozpocznij pobieranie
        await wishlistManager.initiateAutoDownload(item, matchData);
        
        res.json({ message: 'Pobieranie rozpoczęte pomyślnie.' });
    } catch (error) {
        console.error('Błąd ręcznego pobierania z wishlisty:', error);
        res.status(500).json({ error: error.message });
    }
});

// Resetuj status pozycji wishlisty (przywróć do 'wanted' aby ponownie sprawdzić)
app.post('/api/wishlist/:id/reset', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Sprawdź czy pozycja istnieje
        const item = await dbAll('SELECT * FROM wishlist WHERE id = ?', [id]);
        if (item.length === 0) {
            return res.status(404).json({ error: 'Pozycja wishlisty nie znaleziona.' });
        }

        // Usuń stare matche
        await dbRun('DELETE FROM wishlist_matches WHERE wishlist_id = ?', [id]);
        
        // Resetuj status na 'wanted'
        await dbRun(`
            UPDATE wishlist 
            SET status = 'wanted', found_at = NULL 
            WHERE id = ?
        `, [id]);

        // Dodaj log
        await dbRun(`
            INSERT INTO wishlist_logs (wishlist_id, level, message)
            VALUES (?, ?, ?)
        `, [id, 'INFO', 'Status zresetowany - pozycja będzie ponownie sprawdzona']);

        res.json({ message: 'Status pozycji został zresetowany.' });
        
    } catch (error) {
        console.error('Błąd resetowania statusu wishlisty:', error);
        res.status(500).json({ error: 'Nie udało się zresetować statusu.' });
    }
});

// Oznacz pozycję jako ukończoną ręcznie
app.post('/api/wishlist/:id/mark-completed', async (req, res) => {
    const { id } = req.params;
    
    try {
        const item = await dbAll('SELECT * FROM wishlist WHERE id = ?', [id]);
        if (item.length === 0) {
            return res.status(404).json({ error: 'Pozycja wishlisty nie znaleziona.' });
        }

        await dbRun(`
            UPDATE wishlist 
            SET status = 'completed' 
            WHERE id = ?
        `, [id]);

        await dbRun(`
            INSERT INTO wishlist_logs (wishlist_id, level, message)
            VALUES (?, ?, ?)
        `, [id, 'INFO', 'Oznaczono jako ukończone ręcznie']);

        res.json({ message: 'Pozycja została oznaczona jako ukończona.' });
        
    } catch (error) {
        console.error('Błąd oznaczania jako ukończone:', error);
        res.status(500).json({ error: 'Nie udało się oznaczyć jako ukończone.' });
    }
});

// Pobierz szczegółowe logi dla pozycji wishlisty
app.get('/api/wishlist/:id/logs', async (req, res) => {
    const { id } = req.params;
    
    try {
        const logs = await dbAll(`
            SELECT 
                timestamp,
                level,
                message,
                data
            FROM wishlist_logs 
            WHERE wishlist_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 50
        `, [id]);

        res.json(logs);
        
    } catch (error) {
        console.error('Błąd pobierania logów wishlisty:', error);
        res.status(500).json({ error: 'Nie udało się pobrać logów.' });
    }
});

// Endpoint do migracji tabeli wishlist (admin)
app.post('/api/wishlist/migrate-database', async (req, res) => {
    try {
        if (!wishlistManager) {
            return res.status(500).json({ error: 'Wishlist Manager nie jest zainicjalizowany.' });
        }

        await wishlistManager.migrateWishlistTable();
        res.json({ message: 'Migracja tabeli wishlist zakończona pomyślnie.' });
        
    } catch (error) {
        console.error('Błąd migracji wishlist:', error);
        res.status(500).json({ error: `Błąd migracji: ${error.message}` });
    }
});

// Resetuj status pozycji wishlisty (przywróć do 'wanted' aby ponownie sprawdzić)
app.post('/api/wishlist/:id/reset', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Sprawdź czy pozycja istnieje
        const item = await dbAll('SELECT * FROM wishlist WHERE id = ?', [id]);
        if (item.length === 0) {
            return res.status(404).json({ error: 'Pozycja wishlisty nie znaleziona.' });
        }

        // Usuń stare matche
        await dbRun('DELETE FROM wishlist_matches WHERE wishlist_id = ?', [id]);
        
        // Resetuj status na 'wanted'
        await dbRun(`
            UPDATE wishlist 
            SET status = 'wanted', found_at = NULL 
            WHERE id = ?
        `, [id]);

        // Dodaj log
        await dbRun(`
            INSERT INTO wishlist_logs (wishlist_id, level, message)
            VALUES (?, ?, ?)
        `, [id, 'INFO', 'Status zresetowany - pozycja będzie ponownie sprawdzona']);

        res.json({ message: 'Status pozycji został zresetowany.' });
        
    } catch (error) {
        console.error('Błąd resetowania statusu wishlisty:', error);
        res.status(500).json({ error: 'Nie udało się zresetować statusu.' });
    }
});

// Oznacz pozycję jako ukończoną ręcznie
app.post('/api/wishlist/:id/mark-completed', async (req, res) => {
    const { id } = req.params;
    
    try {
        const item = await dbAll('SELECT * FROM wishlist WHERE id = ?', [id]);
        if (item.length === 0) {
            return res.status(404).json({ error: 'Pozycja wishlisty nie znaleziona.' });
        }

        await dbRun(`
            UPDATE wishlist 
            SET status = 'completed' 
            WHERE id = ?
        `, [id]);

        await dbRun(`
            INSERT INTO wishlist_logs (wishlist_id, level, message)
            VALUES (?, ?, ?)
        `, [id, 'INFO', 'Oznaczono jako ukończone ręcznie']);

        res.json({ message: 'Pozycja została oznaczona jako ukończona.' });
        
    } catch (error) {
        console.error('Błąd oznaczania jako ukończone:', error);
        res.status(500).json({ error: 'Nie udało się oznaczyć jako ukończone.' });
    }
});

// Pobierz szczegółowe logi dla pozycji wishlisty
app.get('/api/wishlist/:id/logs', async (req, res) => {
    const { id } = req.params;
    
    try {
        const logs = await dbAll(`
            SELECT 
                timestamp,
                level,
                message,
                data
            FROM wishlist_logs 
            WHERE wishlist_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 50
        `, [id]);

        res.json(logs);
        
    } catch (error) {
        console.error('Błąd pobierania logów wishlisty:', error);
        res.status(500).json({ error: 'Nie udało się pobrać logów.' });
    }
});

app.get('/api/debug/serial-mismatch', async (req, res) => {
    try {
        console.log('🔍 DEBUG: Sprawdzanie błędnego dopasowania seriali...');
        
        // 1. Sprawdź co jest w ulubionych
        const favorites = await dbAll(`
            SELECT f.*, m.name as media_name, m.tmdb_id, p.name as playlist_name
            FROM favorites f
            LEFT JOIN media m ON f.stream_id = m.stream_id AND f.stream_type = m.stream_type AND f.playlist_id = m.playlist_id
            LEFT JOIN playlists p ON f.playlist_id = p.id
            WHERE f.stream_type = 'series'
        `);
        
        console.log('🎯 Ulubione seriale:');
        favorites.forEach(fav => {
            console.log(`  - Stream ID: ${fav.stream_id}, Nazwa: "${fav.media_name}", TMDB: ${fav.tmdb_id}, Playlista: ${fav.playlist_name}`);
        });
        
        // 2. Sprawdź co było pobierane (ostatnie 20 pobrań seriali)
        const recentDownloads = await dbAll(`
            SELECT d.*, m.name as media_name, m.tmdb_id
            FROM downloads d
            LEFT JOIN media m ON d.stream_id = m.stream_id AND d.stream_type = m.stream_type AND d.playlist_id = m.playlist_id
            WHERE d.stream_type = 'series'
            ORDER BY d.added_at DESC
            LIMIT 20
        `);
        
        console.log('📥 Ostatnie pobierania seriali:');
        recentDownloads.forEach(dl => {
            console.log(`  - Stream ID: ${dl.stream_id}, Episode ID: ${dl.episode_id}, Nazwa media: "${dl.media_name}", Filename: "${dl.filename}"`);
        });
        
        // 3. Sprawdź duplikaty stream_id w różnych playlistach
        const duplicateStreamIds = await dbAll(`
            SELECT 
                m.stream_id, 
                m.stream_type,
                COUNT(*) as count,
                GROUP_CONCAT(m.name || ' (PL:' || m.playlist_id || ')') as names
            FROM media m
            WHERE m.stream_type = 'series'
            GROUP BY m.stream_id, m.stream_type
            HAVING count > 1
        `);
        
        console.log('🔄 Seriale z duplikowanymi Stream ID:');
        duplicateStreamIds.forEach(dup => {
            console.log(`  - Stream ID: ${dup.stream_id}, Wystąpienia: ${dup.count}, Nazwy: ${dup.names}`);
        });
        
        // 4. Sprawdź konkretnie "Scheda" vs "The Heritage"
        const schedaSearch = await dbAll(`
            SELECT m.*, p.name as playlist_name
            FROM media m
            LEFT JOIN playlists p ON m.playlist_id = p.id
            WHERE m.name LIKE '%Scheda%' OR m.name LIKE '%Heritage%'
        `);
        
        console.log('🎬 Seriale z "Scheda" lub "Heritage":');
        schedaSearch.forEach(item => {
            console.log(`  - Stream ID: ${item.stream_id}, Nazwa: "${item.name}", TMDB: ${item.tmdb_id}, Playlista: ${item.playlist_name}`);
        });
        
        // 5. Sprawdź favorites dla konkretnego stream_id
        const schedaFavorites = await dbAll(`
            SELECT f.*, m.name as media_name
            FROM favorites f
            LEFT JOIN media m ON f.stream_id = m.stream_id AND f.stream_type = m.stream_type AND f.playlist_id = m.playlist_id
            WHERE m.name LIKE '%Scheda%' OR m.name LIKE '%Heritage%'
        `);
        
        console.log('❤️ Ulubione dla Scheda/Heritage:');
        schedaFavorites.forEach(fav => {
            console.log(`  - Stream ID: ${fav.stream_id}, Nazwa: "${fav.media_name}", Playlist ID: ${fav.playlist_id}`);
        });
        
        // 6. Sprawdź download logs dla błędnych pobrań
        const suspiciousDownloads = await dbAll(`
            SELECT 
                d.*,
                m.name as media_name,
                dl.message as log_message,
                dl.timestamp as log_time
            FROM downloads d
            LEFT JOIN media m ON d.stream_id = m.stream_id AND d.stream_type = m.stream_type
            LEFT JOIN download_logs dl ON d.id = dl.download_id
            WHERE (d.filename LIKE '%Heritage%' OR m.name LIKE '%Heritage%' OR m.name LIKE '%Scheda%')
            ORDER BY d.added_at DESC, dl.timestamp DESC
        `);
        
        console.log('🚨 Podejrzane pobierania (Heritage/Scheda):');
        suspiciousDownloads.forEach(dl => {
            console.log(`  - Download ID: ${dl.id}, Stream ID: ${dl.stream_id}, Media: "${dl.media_name}", Filename: "${dl.filename}"`);
            if (dl.log_message) {
                console.log(`    Log: ${dl.log_time} - ${dl.log_message}`);
            }
        });
        
        const summary = {
            favorites_count: favorites.length,
            recent_downloads_count: recentDownloads.length,
            duplicate_stream_ids: duplicateStreamIds.length,
            scheda_heritage_items: schedaSearch.length,
            suspicious_downloads: suspiciousDownloads.length
        };
        
        res.json({
            summary,
            favorites,
            recent_downloads: recentDownloads,
            duplicate_stream_ids: duplicateStreamIds,
            scheda_heritage_search: schedaSearch,
            suspicious_downloads: suspiciousDownloads
        });
        
    } catch (error) {
        console.error('Błąd debugowania:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/debug/xtream-series-mismatch/:stream_id', async (req, res) => {
    const { stream_id } = req.params;
    
    try {
        console.log(`🔍 DEBUG: Szczegółowa analiza Stream ID: ${stream_id}`);
        
        // 1. Sprawdź co jest w naszej bazie dla tego Stream ID
        const mediaInDB = await dbAll(`
            SELECT m.*, p.name as playlist_name, p.server_url, p.username, p.password
            FROM media m
            LEFT JOIN playlists p ON m.playlist_id = p.id
            WHERE m.stream_id = ? AND m.stream_type = 'series'
        `, [stream_id]);
        
        if (mediaInDB.length === 0) {
            return res.status(404).json({ error: 'Stream ID nie znaleziony w bazie' });
        }
        
        const results = [];
        
        // 2. Dla każdej playlisty sprawdź co zwraca Xtream API
        for (const media of mediaInDB) {
            console.log(`📡 Sprawdzanie Stream ID ${stream_id} w playliście: ${media.playlist_name}`);
            
            const xtreamBaseUrl = `${media.server_url}/player_api.php?username=${media.username}&password=${media.password}`;
            
            try {
                // A. Sprawdź listę seriali - czy Stream ID 44840 rzeczywiście to Scheda?
                console.log(`🔍 Pobieranie listy seriali z ${media.playlist_name}...`);
                const seriesListRes = await axios.get(`${xtreamBaseUrl}&action=get_series`, { timeout: 15000 });
                
                const seriesInList = seriesListRes.data.find(s => s.series_id == stream_id);
                
                // B. Pobierz szczegóły tego konkretnego serialu
                console.log(`🔍 Pobieranie szczegółów serialu ${stream_id} z ${media.playlist_name}...`);
                const seriesDetailsRes = await axios.get(`${xtreamBaseUrl}&action=get_series_info&series_id=${stream_id}`, { timeout: 15000 });
                
                const seriesDetails = seriesDetailsRes.data;
                const episodes = Object.values(seriesDetails.episodes || {}).flat();
                
                console.log(`📺 Wyniki dla playlisty ${media.playlist_name}:`);
                console.log(`  - Nazwa w liście: "${seriesInList?.name}"`);
                console.log(`  - Nazwa w szczegółach: "${seriesDetails?.info?.name}"`);
                console.log(`  - Liczba odcinków: ${episodes.length}`);
                console.log(`  - TMDB ID w szczegółach: ${seriesDetails?.info?.tmdb}`);
                
                if (episodes.length > 0) {
                    console.log(`  - Pierwszy odcinek: ID=${episodes[0].id}, Nazwa="${episodes[0].title}"`);
                    console.log(`  - URL pierwszego odcinka: ${media.server_url}/series/${media.username}/${media.password}/${episodes[0].id}.${episodes[0].container_extension || 'mkv'}`);
                }
                
                results.push({
                    playlist_id: media.playlist_id,
                    playlist_name: media.playlist_name,
                    media_name_in_db: media.name,
                    media_tmdb_in_db: media.tmdb_id,
                    
                    // Z listy seriali
                    series_in_list: seriesInList ? {
                        name: seriesInList.name,
                        series_id: seriesInList.series_id,
                        cover: seriesInList.cover,
                        plot: seriesInList.plot,
                        tmdb: seriesInList.tmdb,
                        rating: seriesInList.rating_5based
                    } : null,
                    
                    // Ze szczegółów
                    series_details: {
                        name: seriesDetails?.info?.name,
                        tmdb: seriesDetails?.info?.tmdb,
                        plot: seriesDetails?.info?.plot,
                        rating: seriesDetails?.info?.rating_5based,
                        release_date: seriesDetails?.info?.releasedate,
                        episodes_count: episodes.length
                    },
                    
                    // Próbka odcinków
                    episode_sample: episodes.slice(0, 3).map(ep => ({
                        id: ep.id,
                        title: ep.title,
                        season: ep.season,
                        episode_num: ep.episode_num,
                        container_extension: ep.container_extension
                    })),
                    
                    // Test czy rzeczywiście pobiera prawidłowy content
                    download_test: {
                        url: episodes[0] ? `${media.server_url}/series/${media.username}/${media.password}/${episodes[0].id}.${episodes[0].container_extension || 'mkv'}` : null,
                        episode_id: episodes[0]?.id
                    }
                });
                
            } catch (apiError) {
                console.error(`❌ Błąd API dla playlisty ${media.playlist_name}:`, apiError.message);
                results.push({
                    playlist_id: media.playlist_id,
                    playlist_name: media.playlist_name,
                    error: apiError.message
                });
            }
        }
        
        // 3. Sprawdź czy są inne seriale o podobnej nazwie
        console.log(`🔍 Szukanie seriali o podobnych nazwach...`);
        const similarSeries = await dbAll(`
            SELECT m.*, p.name as playlist_name
            FROM media m
            LEFT JOIN playlists p ON m.playlist_id = p.id
            WHERE (m.name LIKE '%Scheda%' OR m.name LIKE '%Heritage%') 
            AND m.stream_type = 'series'
            ORDER BY m.stream_id
        `);
        
        // 4. Sprawdź czy episode_id 1250637 należy do jakiegoś innego serialu
        console.log(`🔍 Sprawdzanie do którego serialu należy episode_id 1250637...`);
        const episodeOwnership = [];
        
        // Sprawdź kilka seriali z Heritage w nazwie
        for (const similar of similarSeries) {
            if (similar.name.toLowerCase().includes('heritage')) {
                try {
                    const xtreamBaseUrl = `${similar.server_url}/player_api.php?username=${similar.username}&password=${similar.password}`;
                    const seriesDetailsRes = await axios.get(`${xtreamBaseUrl}&action=get_series_info&series_id=${similar.stream_id}`, { timeout: 15000 });
                    
                    const episodes = Object.values(seriesDetailsRes.data.episodes || {}).flat();
                    const hasEpisode1250637 = episodes.find(ep => ep.id == '1250637');
                    
                    if (hasEpisode1250637) {
                        console.log(`🎯 ZNALEZIONO! Episode ID 1250637 należy do serialu: "${similar.name}" (Stream ID: ${similar.stream_id})`);
                        episodeOwnership.push({
                            stream_id: similar.stream_id,
                            series_name: similar.name,
                            playlist_name: similar.playlist_name,
                            has_episode_1250637: true,
                            episode_title: hasEpisode1250637.title
                        });
                    }
                } catch (err) {
                    console.error(`Błąd sprawdzania serialu ${similar.stream_id}:`, err.message);
                }
            }
        }
        
        const response = {
            stream_id: parseInt(stream_id),
            media_in_database: mediaInDB,
            xtream_api_results: results,
            similar_series: similarSeries,
            episode_ownership: episodeOwnership,
            
            diagnosis: {
                issue_type: "CONTENT_MISMATCH",
                description: "Stream ID w bazie wskazuje na jeden serial, ale Xtream API zwraca odcinki z innego serialu",
                likely_cause: episodeOwnership.length > 0 ? 
                    "Episode ID należą do innego serialu - błąd w konfiguracji serwera IPTV" :
                    "Serwer IPTV ma błędną konfigurację lub nastąpiło przemieszanie zawartości"
            }
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('Błąd debugowania:', error);
        res.status(500).json({ error: error.message });
    }
});

// === DODATKOWY ENDPOINT: Test pobierania konkretnego episode_id ===
app.get('/api/debug/test-episode/:episode_id', async (req, res) => {
    const { episode_id } = req.params;
    
    try {
        // Znajdź wszystkie playlisty i spróbuj pobrać ten episode_id
        const playlists = await dbAll('SELECT * FROM playlists WHERE is_active = 1');
        const results = [];
        
        for (const playlist of playlists) {
            try {
                const testUrl = `${playlist.server_url}/series/${playlist.username}/${playlist.password}/${episode_id}.mkv`;
                
                console.log(`🔍 Testowanie episode_id ${episode_id} w playliście ${playlist.name}...`);
                console.log(`URL: ${testUrl}`);
                
                // Spróbuj HEAD request żeby sprawdzić czy URL istnieje
                const headResponse = await axios.head(testUrl, { timeout: 10000 });
                
                results.push({
                    playlist_name: playlist.name,
                    playlist_id: playlist.id,
                    url: testUrl,
                    status: headResponse.status,
                    content_length: headResponse.headers['content-length'],
                    content_type: headResponse.headers['content-type'],
                    exists: true
                });
                
            } catch (error) {
                results.push({
                    playlist_name: playlist.name,
                    playlist_id: playlist.id,
                    error: error.response?.status || error.message,
                    exists: false
                });
            }
        }
        
        res.json({
            episode_id,
            results,
            summary: {
                total_playlists_tested: playlists.length,
                accessible_in: results.filter(r => r.exists).length,
                inaccessible_in: results.filter(r => !r.exists).length
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Wyszukaj w TMDB (do dodawania do wishlisty)
app.get('/api/tmdb/search', async (req, res) => {
    try {
        const { query, type = 'multi', page = 1 } = req.query;
        
        if (!query || query.length < 2) {
            return res.status(400).json({ error: 'Query musi mieć minimum 2 znaki.' });
        }

        const tmdbApiRows = await dbAll('SELECT value FROM settings WHERE key = ?', ['tmdbApi']);
        const tmdbApi = tmdbApiRows[0]?.value;
        
        if (!tmdbApi) {
            return res.status(400).json({ error: 'Brak klucza API TMDB.' });
        }

        const tmdbUrl = `https://api.themoviedb.org/3/search/${type}?api_key=${tmdbApi}&language=pl-PL&query=${encodeURIComponent(query)}&page=${page}`;
        
        const response = await axios.get(tmdbUrl, { timeout: 10000 });
        
        // Filtruj tylko filmy i seriale, dodaj flagę czy już jest w wishliście
        const results = response.data.results
            .filter(item => item.media_type === 'movie' || item.media_type === 'tv' || type !== 'multi')
            .map(item => ({
                ...item,
                media_type: item.media_type || type
            }));

        // Sprawdź które pozycje już są w wishliście
        if (results.length > 0) {
            const tmdbIds = results.map(r => r.id);
            const existingInWishlist = await dbAll(`
                SELECT tmdb_id, media_type, status 
                FROM wishlist 
                WHERE tmdb_id IN (${tmdbIds.map(() => '?').join(',')})
            `, tmdbIds);

            const wishlistMap = new Map();
            existingInWishlist.forEach(w => {
                wishlistMap.set(`${w.tmdb_id}_${w.media_type}`, w.status);
            });

            results.forEach(item => {
                const key = `${item.id}_${item.media_type}`;
                item.in_wishlist = wishlistMap.has(key);
                item.wishlist_status = wishlistMap.get(key) || null;
            });
        }

        res.json({
            ...response.data,
            results
        });
    } catch (error) {
        console.error('Błąd wyszukiwania TMDB:', error);
        res.status(500).json({ error: 'Nie udało się wyszukać w TMDB.' });
    }
});

// Pełna funkcja processDownloadQueue z poprawkami nazewnictwa Plex i TMDB
// Pełna funkcja processDownloadQueue z poprawkami nazewnictwa Plex i TMDB oraz automatyczną archiwizacją
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

        // Pobierz dane playlisty dla tego zadania
        const downloadDetails = await dbAll(`
            SELECT d.*, p.server_url, p.username, p.password, p.name as playlist_name
            FROM downloads d
            LEFT JOIN playlists p ON d.playlist_id = p.id
            WHERE d.id = ?
        `, [job.id]);
        
        if (downloadDetails.length === 0) {
            throw new Error('Nie znaleziono szczegółów pobierania');
        }
        
        const downloadJob = downloadDetails[0];
        
        if (!downloadJob.server_url || !downloadJob.username || !downloadJob.password) {
            throw new Error('Brak danych playlisty dla tego pobierania');
        }
        
        console.log(`🔍 DOWNLOAD JOB ${job.id}: ${downloadJob.filename}`);
        
        // Pobierz szczegóły media z Xtream API i TMDB
        const xtreamBaseUrl = `${downloadJob.server_url}/player_api.php?username=${downloadJob.username}&password=${downloadJob.password}`;
        
        let mediaDetailsResponse;
        try {
            if (downloadJob.stream_type === 'series') {
                const apiUrl = `${xtreamBaseUrl}&action=get_series_info&series_id=${downloadJob.stream_id}`;
                mediaDetailsResponse = await axios.get(apiUrl, { timeout: 15000 });
            } else {
                const apiUrl = `${xtreamBaseUrl}&action=get_vod_info&vod_id=${downloadJob.stream_id}`;
                mediaDetailsResponse = await axios.get(apiUrl, { timeout: 15000 });
            }
        } catch (apiError) {
            console.warn(`⚠️ Nie udało się pobrać szczegółów z API: ${apiError.message}`);
            mediaDetailsResponse = { data: null };
        }

        // ✅ POBIERZ DANE Z TMDB dla lepszych nazw i dat
        let tmdbDetails = null;
        let tmdbEpisodeDetails = null;
        try {
            // Pobierz TMDB ID z bazy danych
            const mediaFromDb = await dbAll(`
                SELECT tmdb_id FROM media 
                WHERE stream_id = ? AND stream_type = ? 
                LIMIT 1
            `, [downloadJob.stream_id, downloadJob.stream_type]);
            
            const tmdbId = mediaFromDb[0]?.tmdb_id || mediaDetailsResponse?.data?.info?.tmdb;
            
            if (tmdbId) {
                const tmdbApiRows = await dbAll('SELECT value FROM settings WHERE key = ?', ['tmdbApi']);
                const tmdbApi = tmdbApiRows[0]?.value;
                
                if (tmdbApi) {
                    const tmdbType = downloadJob.stream_type === 'series' ? 'tv' : 'movie';
                    const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${tmdbApi}&language=pl-PL`;
                    
                    console.log(`🎭 Pobieranie danych TMDB dla ${tmdbType} ID: ${tmdbId}`);
                    const tmdbResponse = await axios.get(tmdbUrl, { timeout: 10000 });
                    tmdbDetails = tmdbResponse.data;
                    console.log(`✅ TMDB: "${tmdbDetails.title || tmdbDetails.name}" (${tmdbDetails.release_date || tmdbDetails.first_air_date})`);
                    
                    // ✅ POBIERZ SZCZEGÓŁY ODCINKA Z TMDB (tylko dla seriali)
                    if (downloadJob.stream_type === 'series' && downloadJob.episode_id) {
                        const allEpisodes = mediaDetailsResponse?.data?.episodes ? Object.values(mediaDetailsResponse.data.episodes).flat() : [];
                        const episodeData = allEpisodes.find(ep => ep.id == downloadJob.episode_id);
                        
                        if (episodeData?.season && episodeData?.episode_num) {
                            try {
                                const tmdbEpisodeUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${episodeData.season}/episode/${episodeData.episode_num}?api_key=${tmdbApi}&language=pl-PL`;
                                console.log(`🎭 Pobieranie szczegółów odcinka S${episodeData.season}E${episodeData.episode_num} z TMDB...`);
                                
                                const tmdbEpisodeResponse = await axios.get(tmdbEpisodeUrl, { timeout: 10000 });
                                tmdbEpisodeDetails = tmdbEpisodeResponse.data;
                                console.log(`✅ TMDB Episode: "${tmdbEpisodeDetails.name}" (${tmdbEpisodeDetails.air_date})`);
                            } catch (episodeError) {
                                console.warn(`⚠️ Nie udało się pobrać szczegółów odcinka z TMDB: ${episodeError.message}`);
                            }
                        }
                    }
                }
            }
        } catch (tmdbError) {
            console.warn(`⚠️ Nie udało się pobrać danych TMDB: ${tmdbError.message}`);
        }
        
        const details = {
            stream_id: downloadJob.stream_id,
            stream_type: downloadJob.stream_type,
            name: downloadJob.filename,
            xtream_details: mediaDetailsResponse.data,
            tmdb_details: tmdbDetails,
            tmdb_episode_details: tmdbEpisodeDetails
        };

        // === OKREŚL ROZSZERZENIE PLIKU ===
        let extension = 'mp4'; // domyślne
        let downloadUrl;

        if (downloadJob.stream_type === 'movie') {
            // Sprawdź różne źródła rozszerzenia dla filmów
            if (details.xtream_details?.info?.container_extension) {
                extension = details.xtream_details.info.container_extension;
            } else {
                const filenameMatch = downloadJob.filename?.match(/\.(mp4|mkv|avi|mov|m4v|wmv|flv|ts|m2ts)$/i);
                if (filenameMatch) {
                    extension = filenameMatch[1].toLowerCase();
                }
            }
            
            downloadUrl = `${downloadJob.server_url}/movie/${downloadJob.username}/${downloadJob.password}/${downloadJob.stream_id}.${extension}`;
            
        } else {
            // Dla seriali: znajdź konkretny odcinek i weź jego rozszerzenie
            const allEpisodes = details.xtream_details?.episodes ? Object.values(details.xtream_details.episodes).flat() : [];
            const episodeData = allEpisodes.find(ep => ep.id == downloadJob.episode_id);
            extension = episodeData?.container_extension || 'mkv';
            
            downloadUrl = `${downloadJob.server_url}/series/${downloadJob.username}/${downloadJob.password}/${downloadJob.episode_id}.${extension}`;
        }

        // === PLEX-KOMPATYBILNA STRUKTURA FOLDERÓW I NAZW ===
        let plexCompatiblePath;

        if (downloadJob.stream_type === 'movie') {
            // === FILMY: /Movies/Movie Title (Year)/Movie Title (Year).ext ===
            
            const movieInfo = details.xtream_details?.info || {};
            const tmdbData = details.tmdb_details;
            
            // ✅ PRIORYTET: Użyj nazwy i roku z TMDB jeśli dostępne
            let movieTitle = tmdbData?.title || movieInfo.name || details.name || downloadJob.filename;
            let releaseYear = 'Unknown';
            
            // ✅ PRIORYTETOWE ŹRÓDŁA ROKU (TMDB FIRST)
            if (tmdbData?.release_date) {
                const tmdbYear = new Date(tmdbData.release_date).getFullYear();
                if (!isNaN(tmdbYear) && tmdbYear > 1900 && tmdbYear <= new Date().getFullYear() + 5) {
                    releaseYear = tmdbYear;
                    console.log(`🎭 Używam roku z TMDB: ${releaseYear}`);
                }
            } else if (movieInfo.releasedate) {
                const xtreamYear = new Date(movieInfo.releasedate).getFullYear();
                if (!isNaN(xtreamYear) && xtreamYear > 1900 && xtreamYear <= new Date().getFullYear() + 5) {
                    releaseYear = xtreamYear;
                    console.log(`📺 Używam roku z Xtream: ${releaseYear}`);
                }
            } else if (movieInfo.year) {
                const year = parseInt(movieInfo.year);
                if (!isNaN(year) && year > 1900 && year <= new Date().getFullYear() + 5) {
                    releaseYear = year;
                    console.log(`📺 Używam roku z Xtream (year): ${releaseYear}`);
                }
            } else {
                // Fallback: wykryj rok z nazwy
                const yearMatches = movieTitle.match(/[\(\[]?(\d{4})[\)\]]?/g);
                if (yearMatches) {
                    const lastYearMatch = yearMatches[yearMatches.length - 1];
                    const year = parseInt(lastYearMatch.replace(/[\(\[\)\]]/g, ''));
                    if (!isNaN(year) && year > 1900 && year <= new Date().getFullYear() + 5) {
                        releaseYear = year;
                        movieTitle = movieTitle.replace(/\s*[\(\[]?\d{4}[\)\]]?\s*$/, '').trim();
                        console.log(`🔍 Wykryto rok z nazwy: ${releaseYear}`);
                    }
                }
            }
            
            // Wyczyść tytuł dla systemu plików
            const safeMovieTitle = movieTitle
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            
            // Struktura Plex: /Movies/Movie Title (Year)/Movie Title (Year).ext
            const movieFolderName = `${safeMovieTitle} (${releaseYear})`;
            const movieFileName = `${safeMovieTitle} (${releaseYear}).${extension}`;
            
            plexCompatiblePath = path.join('/downloads/movies', movieFolderName, movieFileName);
            
            console.log(`🎬 PLEX MOVIE:`);
            console.log(`  - TMDB Title: "${tmdbData?.title || 'N/A'}"`);
            console.log(`  - TMDB Date: "${tmdbData?.release_date || 'N/A'}"`);
            console.log(`  - Final Title: "${movieTitle}"`);
            console.log(`  - Final Year: ${releaseYear}`);
            console.log(`  - Safe: "${safeMovieTitle}"`);
            console.log(`  - Structure: ${movieFolderName}/${movieFileName}`);
            
        } else {
            // === SERIALE: /TV Shows/Show Title (Year)/Season XX/Show Title - S01E05 - Episode Title.ext ===
            
            const seriesInfo = details.xtream_details?.info || {};
            const tmdbData = details.tmdb_details;
            const allEpisodes = details.xtream_details?.episodes ? Object.values(details.xtream_details.episodes).flat() : [];
            const episodeData = allEpisodes.find(ep => ep.id == downloadJob.episode_id);
            
            if (!episodeData) {
                throw new Error(`Nie znaleziono odcinka o ID: ${downloadJob.episode_id}`);
            }
            
            // ✅ PRIORYTET: Użyj nazwy i roku z TMDB jeśli dostępne
            let seriesTitle = tmdbData?.name || seriesInfo.name || details.name || downloadJob.filename.replace(/\s*-\s*S\d+E\d+.*$/, '').trim();
            let releaseYear = 'Unknown';
            
            // ✅ PRIORYTETOWE ŹRÓDŁA ROKU (TMDB FIRST)
            if (tmdbData?.first_air_date) {
                const tmdbYear = new Date(tmdbData.first_air_date).getFullYear();
                if (!isNaN(tmdbYear) && tmdbYear > 1900 && tmdbYear <= new Date().getFullYear() + 5) {
                    releaseYear = tmdbYear;
                    console.log(`🎭 Używam roku z TMDB: ${releaseYear}`);
                }
            } else if (seriesInfo.releasedate) {
                const xtreamYear = new Date(seriesInfo.releasedate).getFullYear();
                if (!isNaN(xtreamYear) && xtreamYear > 1900 && xtreamYear <= new Date().getFullYear() + 5) {
                    releaseYear = xtreamYear;
                    console.log(`📺 Używam roku z Xtream: ${releaseYear}`);
                }
            } else if (seriesInfo.year) {
                const year = parseInt(seriesInfo.year);
                if (!isNaN(year) && year > 1900 && year <= new Date().getFullYear() + 5) {
                    releaseYear = year;
                    console.log(`📺 Używam roku z Xtream (year): ${releaseYear}`);
                }
            } else if (seriesInfo.last_modified) {
                const modYear = new Date(seriesInfo.last_modified).getFullYear();
                if (!isNaN(modYear) && modYear > 1900 && modYear <= new Date().getFullYear()) {
                    releaseYear = modYear;
                    console.log(`📺 Używam roku z last_modified: ${releaseYear}`);
                }
            } else {
                // Fallback: wykryj rok z nazwy
                const yearMatches = seriesTitle.match(/[\(\[]?(\d{4})[\)\]]?/g);
                if (yearMatches) {
                    const firstYearMatch = yearMatches[0];
                    const year = parseInt(firstYearMatch.replace(/[\(\[\)\]]/g, ''));
                    if (!isNaN(year) && year > 1900 && year <= new Date().getFullYear() + 5) {
                        releaseYear = year;
                        seriesTitle = seriesTitle.replace(/\s*[\(\[]?\d{4}[\)\]]?\s*/, '').trim();
                        console.log(`🔍 Wykryto rok z nazwy: ${releaseYear}`);
                    }
                }
            }
            
            // ✅ LEPSZY FALLBACK: Jeśli nadal Unknown, użyj inteligentnego domyślnego
            if (releaseYear === 'Unknown') {
                const currentYear = new Date().getFullYear();
                releaseYear = currentYear - 2;
                console.log(`⚠️ Brak roku dla serialu "${seriesTitle}", używam domyślnego: ${releaseYear}`);
            }
            
            // Wyczyść nazwy dla systemu plików
            const safeSeriesTitle = seriesTitle
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            // ✅ INTELIGENTNY TYTUŁ ODCINKA Z TMDB
            let cleanEpisodeTitle = 'Odcinek ' + episodeData.episode_num; // domyślny fallback
            
            console.log(`📺 EPISODE TITLE PROCESSING:`);
            console.log(`  - Original Xtream Title: "${episodeData.title || 'N/A'}"`);
            console.log(`  - TMDB Episode Title: "${details.tmdb_episode_details?.name || 'N/A'}"`);
            
            // ✅ PRIORYTET 1: Użyj tytułu z TMDB jeśli dostępny
            if (details.tmdb_episode_details?.name) {
                cleanEpisodeTitle = details.tmdb_episode_details.name;
                console.log(`  ✅ Using TMDB episode title: "${cleanEpisodeTitle}"`);
            } 
            // ✅ PRIORYTET 2: Spróbuj wyczyścić tytuł z Xtream
            else if (episodeData.title) {
                cleanEpisodeTitle = episodeData.title;
                console.log(`  📺 Using Xtream title, will clean: "${cleanEpisodeTitle}"`);
                
                // Usuń prefiksy językowe (PL, EN, US, DE, FR, ES, IT, itp.)
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/^[A-Z]{2,3}\s*[-\s]*/, '').trim();
                console.log(`  - After language prefix removal: "${cleanEpisodeTitle}"`);

                // Usuń nazwę serialu z TMDB (najdokładniejsza)
                if (tmdbData?.name) {
                    const tmdbNameRegex = new RegExp(tmdbData.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                    cleanEpisodeTitle = cleanEpisodeTitle.replace(tmdbNameRegex, '').trim();
                    console.log(`  - After TMDB series name removal: "${cleanEpisodeTitle}"`);
                }

                // Usuń kody odcinków (S01E01, S1E1, 1x01, itp.)
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/S\d{1,2}E\d{1,2}/gi, '').trim();
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/\d{1,2}x\d{1,2}/gi, '').trim();
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/Season\s*\d+\s*Episode\s*\d+/gi, '').trim();
                console.log(`  - After episode code removal: "${cleanEpisodeTitle}"`);

                // Usuń pozostałe separatory i słowa językowe
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/^[\s\-–—_\|]+/, '').trim(); // wiodące
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/[\s\-–—_\|]+$/, '').trim(); // końcowe  
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/\s*-\s*-\s*/g, ' - ').trim(); // podwójne myślniki
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/^(Polski|Polish|English|Deutsch|Français|Español|Italiano)\s*[-\s]*/i, '').trim();
                cleanEpisodeTitle = cleanEpisodeTitle.replace(/\s+/g, ' ').trim(); // wielokrotne spacje
                console.log(`  - After full cleanup: "${cleanEpisodeTitle}"`);

                // Jeśli po czyszczeniu zostało bardzo mało, użyj domyślnego
                if (!cleanEpisodeTitle || cleanEpisodeTitle.length < 3 || /^[-\s]*$/.test(cleanEpisodeTitle)) {
                    cleanEpisodeTitle = `Odcinek ${episodeData.episode_num}`;
                    console.log(`  - Using fallback: "${cleanEpisodeTitle}"`);
                }
            }
            
            // ✅ DODATKOWE INFO: Jeśli TMDB ma opis odcinka, pokaż go w logach
            if (details.tmdb_episode_details?.overview) {
                console.log(`  📖 TMDB Episode Overview: "${details.tmdb_episode_details.overview.substring(0, 100)}..."`);
            }

            const safeEpisodeTitle = cleanEpisodeTitle
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            
            // Format numerów z zerami wiodącymi
            const seasonPadded = String(episodeData.season || 1).padStart(2, '0');
            const episodePadded = String(episodeData.episode_num || 1).padStart(2, '0');
            
            // Struktura Plex dla seriali
            const seriesFolderName = `${safeSeriesTitle} (${releaseYear})`;
            const seasonFolderName = `Season ${seasonPadded}`;
            
            // ✅ Format nazwy pliku zgodny z Plex: "Show Title - S01E05 - Episode Title.ext"
            const episodeFileName = `${safeSeriesTitle} - S${seasonPadded}E${episodePadded} - ${safeEpisodeTitle}.${extension}`;
            
            plexCompatiblePath = path.join('/downloads/series', seriesFolderName, seasonFolderName, episodeFileName);
            
            console.log(`📺 PLEX SERIES (TMDB ENHANCED):`);
            console.log(`  - TMDB Series: "${tmdbData?.name || 'N/A'}"`);
            console.log(`  - TMDB Air Date: "${tmdbData?.first_air_date || 'N/A'}"`);
            console.log(`  - TMDB Episode: "${details.tmdb_episode_details?.name || 'N/A'}"`);
            console.log(`  - TMDB Episode Air: "${details.tmdb_episode_details?.air_date || 'N/A'}"`);
            console.log(`  - Xtream Series: "${seriesInfo.name || 'N/A'}"`);
            console.log(`  - Xtream Episode: "${episodeData.title || 'N/A'}"`);
            console.log(`  - Final Series: "${seriesTitle}"`);
            console.log(`  - Final Episode: "${safeEpisodeTitle}"`);
            console.log(`  - Final Year: ${releaseYear}`);
            console.log(`  - Season: ${episodeData.season} -> ${seasonPadded}`);
            console.log(`  - Episode: ${episodeData.episode_num} -> ${episodePadded}`);
            console.log(`  - Final Structure: ${seriesFolderName}/${seasonFolderName}/${episodeFileName}`);
        }

        // Aktualizuj szczegóły w bazie z Plex-kompatybilną ścieżką
        const finalFileName = path.basename(plexCompatiblePath);
        await dbRun('UPDATE downloads SET filename = ?, filepath = ?, download_url = ? WHERE id = ?', 
                    [finalFileName, plexCompatiblePath, downloadUrl, downloadJob.id]);
        
        console.log(`📁 Final Plex Path: ${plexCompatiblePath}`);
        console.log(`🌐 Download URL: ${downloadUrl}`);

        // ✅ DIAGNOSTYKA URL - sprawdź czy URL jest dostępny
        console.log(`🔍 Testing download URL accessibility...`);
        try {
            const headResponse = await axios.head(downloadUrl, { 
                timeout: 10000,
                validateStatus: (status) => status < 500 // Akceptuj kody 4xx jako info, ale nie 5xx
            });
            console.log(`✅ URL accessible: HTTP ${headResponse.status}`);
            if (headResponse.headers['content-length']) {
                console.log(`📏 Content-Length: ${Math.round(headResponse.headers['content-length'] / 1024 / 1024)}MB`);
            }
            if (headResponse.headers['content-type']) {
                console.log(`🎬 Content-Type: ${headResponse.headers['content-type']}`);
            }
        } catch (headError) {
            console.warn(`⚠️ URL test failed: HTTP ${headError.response?.status || 'timeout'} - ${headError.message}`);
            if (headError.response?.status === 404) {
                console.error(`❌ CRITICAL: File not found (404). URL may be incorrect or episode unavailable.`);
            } else if (headError.response?.status === 403) {
                console.error(`❌ CRITICAL: Access forbidden (403). Check credentials or stream permissions.`);
            }
        }

        // Użyj download_manager.py do pobrania
        await new Promise((resolve, reject) => {
            const pythonProcess = spawn('python3', ['download_manager.py', downloadUrl, plexCompatiblePath]);
            activeDownloads.set(downloadJob.id, pythonProcess);

            let stdoutData = '';
            let stderrData = '';

            pythonProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
                console.log(`[Download ${downloadJob.id}] ${data.toString().trim()}`);
            });

            pythonProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
                console.error(`[Download ${downloadJob.id} Error] ${data.toString().trim()}`);
            });

            pythonProcess.on('close', (code) => {
                console.log(`Download ${downloadJob.id} finished with code: ${code}`);
                
                if (code === 0 || stdoutData.includes('SUCCESS')) {
                    resolve();
                } else {
                    // ✅ LEPSZA DIAGNOSTYKA BŁĘDÓW CURL
                    let errorMessage = `Download failed with code ${code}`;
                    
                    if (code === 1) {
                        if (stderrData.includes('curl code 22')) {
                            errorMessage += ` (HTTP Error - probably 404 or 403)`;
                        } else if (stderrData.includes('curl code 6')) {
                            errorMessage += ` (DNS resolution failed)`;
                        } else if (stderrData.includes('curl code 7')) {
                            errorMessage += ` (Connection failed)`;
                        } else if (stderrData.includes('curl code 28')) {
                            errorMessage += ` (Timeout)`;
                        }
                    }
                    
                    console.error(`❌ ${errorMessage}`);
                    console.error(`📋 STDERR: ${stderrData}`);
                    console.error(`📋 STDOUT: ${stdoutData}`);
                    
                    reject(new Error(`${errorMessage}. Details: ${stderrData}`));
                }
            });

            pythonProcess.on('error', (error) => {
                console.error(`Download ${downloadJob.id} process error:`, error);
                reject(error);
            });
        });

        // ✅ POPRAWKA: Oznacz jako ukończone I automatycznie archiwizuj
        await dbRun('UPDATE downloads SET status = ?, worker_status = ?, progress = 100, archived = 1 WHERE id = ?', 
                    ['completed', 'completed', downloadJob.id]);
        console.log(`✅ Download completed and automatically archived for job ${downloadJob.id}: ${finalFileName}`);

    } catch (error) {
        console.error(`❌ Błąd przetwarzania zadania ${job.id}:`, error);
        await dbRun('UPDATE downloads SET status = ?, worker_status = ?, error_message = ? WHERE id = ?', 
                    ['failed', 'failed', error.message, job.id]);
    } finally {
        activeDownloads.delete(job.id);
        isProcessing = false;
        // Kontynuuj przetwarzanie kolejki
        setTimeout(processDownloadQueue, 1000);
    }
}

// Poprawiona funkcja handleRemoveDownload w frontend/src/App.js
const handleRemoveDownload = async (id) => {
    try {
        // Sprawdź status zadania przed usunięciem
        const downloadToRemove = downloads.find(d => d.id === parseInt(id));
        
        if (downloadToRemove && downloadToRemove.worker_status === 'completed') {
            // Dla ukończonych - już są zarchiwizowane automatycznie, po prostu usuń z widoku
            console.log(`Ukończone pobieranie ${downloadToRemove.filename} zostało automatycznie zarchiwizowane`);
        } else {
            // Dla nieukończonych - wyślij zapytanie do backend
            await axios.post(`/api/downloads/remove/${id}`);
        }
        
        // Usuń z lokalnego stanu (z widoku aktywnych)
        setDownloads(prev => prev.filter(d => d.id !== parseInt(id)));
    } catch (error) {
        console.error("Błąd podczas usuwania zadania", error);
    }
};

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
    LEFT JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type AND mg.genre_id != -1
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

app.get('/api/debug/serial-details/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        console.log(`🔍 DEBUG: Sprawdzam serial ID: ${id}`);
        
        // 1. Sprawdź co jest w bazie
        const mediaInDB = await dbAll(`
            SELECT m.*, p.server_url, p.username, p.password, p.name as playlist_name
            FROM media m
            LEFT JOIN playlists p ON m.playlist_id = p.id
            WHERE m.stream_id = ? AND m.stream_type = 'series'
        `, [id]);
        
        console.log(`📺 Znaleziono ${mediaInDB.length} seriali z tym ID`);
        
        if (mediaInDB.length === 0) {
            return res.json({ 
                error: 'Serial nie znaleziony w bazie',
                media_found: 0
            });
        }
        
        const results = [];
        
        for (const media of mediaInDB) {
            console.log(`📡 Sprawdzam playlistę: ${media.playlist_name}`);
            
            try {
                const xtreamBaseUrl = `${media.server_url}/player_api.php?username=${media.username}&password=${media.password}`;
                const apiUrl = `${xtreamBaseUrl}&action=get_series_info&series_id=${id}`;
                
                console.log(`🌐 API URL: ${apiUrl}`);
                
                const startTime = Date.now();
                const response = await axios.get(apiUrl, { 
                    timeout: 10000,
                    validateStatus: (status) => status < 500
                });
                const responseTime = Date.now() - startTime;
                
                console.log(`✅ Odpowiedź: ${response.status} (${responseTime}ms)`);
                console.log(`📦 Keys:`, Object.keys(response.data || {}));
                
                results.push({
                    playlist_name: media.playlist_name,
                    playlist_id: media.playlist_id,
                    server_url: media.server_url,
                    api_url: apiUrl,
                    response_time: responseTime,
                    status_code: response.status,
                    success: response.status === 200,
                    data_keys: Object.keys(response.data || {}),
                    has_info: !!(response.data?.info),
                    has_episodes: !!(response.data?.episodes),
                    episode_count: response.data?.episodes ? 
                        Object.values(response.data.episodes).flat().length : 0,
                    sample_data: {
                        info_name: response.data?.info?.name,
                        info_plot: response.data?.info?.plot?.substring(0, 100),
                        first_season: response.data?.episodes ? Object.keys(response.data.episodes)[0] : null
                    }
                });
                
            } catch (apiError) {
                console.error(`❌ Błąd API dla ${media.playlist_name}:`, apiError.message);
                results.push({
                    playlist_name: media.playlist_name,
                    playlist_id: media.playlist_id,
                    server_url: media.server_url,
                    success: false,
                    error: apiError.message,
                    error_code: apiError.code,
                    status_code: apiError.response?.status
                });
            }
        }
        
        res.json({
            serial_id: id,
            media_found: mediaInDB.length,
            api_results: results,
            debug_info: {
                timestamp: new Date().toISOString(),
                total_playlists_checked: results.length,
                successful_calls: results.filter(r => r.success).length,
                failed_calls: results.filter(r => !r.success).length
            }
        });
        
    } catch (error) {
        console.error('❌ Debug error:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack 
        });
    }
});

app.get('/api/media/details/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    console.log(`🔍 DETAILS REQUEST: ${type}/${id}`);
    
    try {
        // POPRAWKA: Pobierz ustawienia z nowego systemu playlist
        const mediaItemResult = await dbAll(`
            SELECT m.*, p.server_url, p.username, p.password, p.name as playlist_name
            FROM media m
            LEFT JOIN playlists p ON m.playlist_id = p.id
            WHERE m.stream_id = ? AND m.stream_type = ?
            LIMIT 1
        `, [id, type]);
        
        console.log(`📊 Media query result: ${mediaItemResult.length} items found`);
        
        if (!mediaItemResult || mediaItemResult.length === 0) {
            console.log('❌ MEDIA NOT FOUND IN DB');
            return res.status(404).json({ error: 'Nie znaleziono pozycji w bazie danych.' });
        }
        
        const mediaItem = mediaItemResult[0];
        
        // Sprawdź czy mamy dane playlisty
        if (!mediaItem.server_url || !mediaItem.username || !mediaItem.password) {
            console.log('❌ MISSING PLAYLIST CONFIGURATION');
            return res.status(400).json({ error: 'Brak konfiguracji playlisty dla tego media.' });
        }
        
        // Pobierz klucz TMDB API
        const tmdbApiRows = await dbAll(`SELECT value FROM settings WHERE key = 'tmdbApi'`);
        const tmdbApi = tmdbApiRows[0]?.value;
        
        if (!tmdbApi) {
            console.log('⚠️ MISSING TMDB API KEY');
        }
        
        let finalDetails = { ...mediaItem };
        let tmdbIdToUse = finalDetails.tmdb_id;
        const xtreamBaseUrl = `${mediaItem.server_url}/player_api.php?username=${mediaItem.username}&password=${mediaItem.password}`;
        
        console.log(`📡 Using Xtream URL base: ${xtreamBaseUrl}`);
        
        // Użyj retry mechanism dla Xtream API calls
        try {
            if (finalDetails.stream_type === 'series') {
                const xtreamUrl = `${xtreamBaseUrl}&action=get_series_info&series_id=${id}`;
                console.log(`📺 Fetching series info: ${xtreamUrl}`);
                
                const seriesInfoRes = await makeRetryRequest(xtreamUrl);
                console.log(`✅ Series data received, keys: ${Object.keys(seriesInfoRes.data || {})}`);
                
                finalDetails.xtream_details = seriesInfoRes.data;
                if (seriesInfoRes.data?.info?.tmdb) {
                    tmdbIdToUse = seriesInfoRes.data.info.tmdb;
                    console.log(`🔄 Updated TMDB ID from series info: ${tmdbIdToUse}`);
                }
            } else if (finalDetails.stream_type === 'movie') {
                const xtreamUrl = `${xtreamBaseUrl}&action=get_vod_info&vod_id=${id}`;
                console.log(`🎬 Fetching movie info: ${xtreamUrl}`);
                
                const movieInfoRes = await makeRetryRequest(xtreamUrl);
                console.log(`✅ Movie data received, keys: ${Object.keys(movieInfoRes.data || {})}`);
                
                finalDetails.xtream_details = { 
                    info: movieInfoRes.data?.movie_data, 
                    ...movieInfoRes.data 
                };
                if (movieInfoRes.data?.movie_data?.tmdb_id) {
                    tmdbIdToUse = movieInfoRes.data.movie_data.tmdb_id;
                    console.log(`🔄 Updated TMDB ID from movie info: ${tmdbIdToUse}`);
                }
            }
        } catch (xtreamError) {
            console.error(`❌ Failed to fetch Xtream details: ${xtreamError.message}`);
            finalDetails.xtream_details = null;
            finalDetails.xtream_error = `Nie udało się pobrać szczegółów z serwera: ${xtreamError.message}`;
        }
        
        // TMDB API call z retry (tylko jeśli mamy klucz)
        if (tmdbIdToUse && tmdbApi) {
            const tmdbType = finalDetails.stream_type === 'series' ? 'tv' : 'movie';
            const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbIdToUse}?api_key=${tmdbApi}&language=pl-PL&append_to_response=videos,credits,translations`;
            
            try {
                console.log(`🎭 Fetching TMDB details for ID: ${tmdbIdToUse}`);
                const tmdbRes = await makeRetryRequest(tmdbUrl);
                let tmdbData = tmdbRes.data;
                
                // Polski opis jeśli dostępny
                const polishTranslation = tmdbData.translations?.translations?.find(t => t.iso_639_1 === 'pl');
                if (polishTranslation?.data) {
                    tmdbData.overview = polishTranslation.data.overview || tmdbData.overview;
                    console.log(`🇵🇱 Using Polish description`);
                }
                
                finalDetails.tmdb_details = tmdbData;
                console.log(`✅ TMDB data received`);
            } catch(tmdbError) {
                console.error(`❌ Failed to fetch TMDB details: ${tmdbError.message}`);
                finalDetails.tmdb_details = null;
                finalDetails.tmdb_error = `Nie udało się pobrać szczegółów z TMDB: ${tmdbError.message}`;
            }
        } else {
            console.log(`ℹ️ Skipping TMDB: tmdbId=${!!tmdbIdToUse}, apiKey=${!!tmdbApi}`);
        }
        
        console.log(`✅ DETAILS SUCCESS for ${type}/${id}`);
        res.json(finalDetails);
        
    } catch (error) {
        console.error(`❌ DETAILS ERROR for ${type}/${id}:`, error);
        res.status(500).json({ 
            error: 'Nie udało się pobrać szczegółów.',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Dodaj te endpoint'y do server.js, zastępując istniejący endpoint /api/downloads/archive

// Rozszerzony endpoint archiwum z wyszukiwaniem i sortowaniem
app.get('/api/downloads/archive', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 50, 
            search = '', 
            sort = 'newest',
            group_by = 'none'
        } = req.query;
        
        const offset = (page - 1) * limit;
        
        // Przygotuj warunki WHERE dla wyszukiwania
        let whereConditions = ['archived = 1'];
        let params = [];
        
        if (search && search.trim()) {
            whereConditions.push('(filename LIKE ? OR stream_type LIKE ?)');
            const searchTerm = `%${search.trim()}%`;
            params.push(searchTerm, searchTerm);
        }
        
        const whereClause = whereConditions.join(' AND ');
        
        // Przygotuj ORDER BY na podstawie sortowania
        let orderBy = 'added_at DESC'; // domyślnie
        switch (sort) {
            case 'oldest':
                orderBy = 'added_at ASC';
                break;
            case 'name':
                orderBy = 'filename ASC';
                break;
            case 'newest':
            default:
                orderBy = 'added_at DESC';
                break;
        }
        
        // Pobierz zarchiwizowane pobierania z wyszukiwaniem
        const archivedDownloads = await dbAll(`
            SELECT 
                id, stream_id, stream_type, episode_id, filename, filepath,
                status, worker_status, progress, added_at, archived
            FROM downloads 
            WHERE ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);
        
        // Policz total z wyszukiwaniem
        const totalResult = await dbAll(`
            SELECT COUNT(*) as total 
            FROM downloads 
            WHERE ${whereClause}
        `, params);
        
        const total = totalResult[0].total;
        const totalPages = Math.ceil(total / limit);
        
        res.json({
            downloads: archivedDownloads,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalItems: total,
                itemsPerPage: parseInt(limit)
            },
            filters: {
                search: search || null,
                sort,
                group_by
            }
        });
    } catch (error) {
        console.error("Błąd pobierania archiwum:", error);
        res.status(500).json({ error: 'Błąd pobierania archiwum.' });
    }
});


app.get('/api/downloads/archive/stats', async (req, res) => {
    try {
        // Podstawowe statystyki archiwum
        const basicStats = await dbAll(`
            SELECT 
                COUNT(*) as total_archived,
                COUNT(CASE WHEN stream_type = 'series' THEN 1 END) as series_count,
                COUNT(CASE WHEN stream_type = 'movie' THEN 1 END) as movie_count,
                MIN(added_at) as oldest_entry,
                MAX(added_at) as newest_entry
            FROM downloads
            WHERE archived = 1
        `);

        // Statystyki grup seriali
        const seriesStats = await dbAll(`
            SELECT 
                CASE 
                    WHEN filename LIKE '%S%E%' THEN 
                        SUBSTR(filename, 1, 
                            CASE 
                                WHEN INSTR(filename, ' - S') > 0 THEN INSTR(filename, ' - S') - 1
                                ELSE LENGTH(filename)
                            END
                        )
                    ELSE 'Inne'
                END as series_name,
                COUNT(*) as episode_count,
                MIN(added_at) as first_episode,
                MAX(added_at) as last_episode
            FROM downloads
            WHERE archived = 1 AND stream_type = 'series'
            GROUP BY series_name
            HAVING episode_count > 1
            ORDER BY episode_count DESC
            LIMIT 10
        `);

        // Statystyki według miesięcy
        const monthlyStats = await dbAll(`
            SELECT 
                strftime('%Y-%m', added_at) as month,
                COUNT(*) as downloads_count,
                COUNT(CASE WHEN stream_type = 'series' THEN 1 END) as series_count,
                COUNT(CASE WHEN stream_type = 'movie' THEN 1 END) as movie_count
            FROM downloads
            WHERE archived = 1
            GROUP BY strftime('%Y-%m', added_at)
            ORDER BY month DESC
            LIMIT 12
        `);

        // Top 5 najpopularniejszych seriali (według liczby odcinków)
        const topSeries = await dbAll(`
            SELECT 
                CASE 
                    WHEN filename LIKE '%S%E%' THEN 
                        SUBSTR(filename, 1, 
                            CASE 
                                WHEN INSTR(filename, ' - S') > 0 THEN INSTR(filename, ' - S') - 1
                                ELSE LENGTH(filename)
                            END
                        )
                    ELSE filename
                END as series_name,
                COUNT(*) as total_episodes,
                COUNT(DISTINCT 
                    CASE 
                        WHEN filename LIKE '%S%E%' THEN 
                            SUBSTR(filename, INSTR(filename, ' - S') + 3, 3)
                        ELSE NULL
                    END
                ) as seasons_count,
                MIN(added_at) as first_download,
                MAX(added_at) as last_download
            FROM downloads
            WHERE archived = 1 AND stream_type = 'series' AND filename LIKE '%S%E%'
            GROUP BY series_name
            HAVING total_episodes > 2
            ORDER BY total_episodes DESC
            LIMIT 10
        `);

        res.json({
            basic: basicStats[0],
            series_groups: seriesStats,
            monthly_breakdown: monthlyStats,
            top_series: topSeries,
            summary: {
                total_series: seriesStats.length,
                avg_episodes_per_series: seriesStats.length > 0 
                    ? Math.round(seriesStats.reduce((sum, s) => sum + s.episode_count, 0) / seriesStats.length)
                    : 0
            }
        });
    } catch (error) {
        console.error("Błąd pobierania statystyk archiwum:", error);
        res.status(500).json({ error: 'Błąd pobierania statystyk archiwum.' });
    }
});

// NOWY: Endpoint do operacji grupowych w archiwum
app.post('/api/downloads/archive/bulk-action', async (req, res) => {
    try {
        const { action, ids, series_name } = req.body;
        
        if (!action) {
            return res.status(400).json({ error: 'Akcja jest wymagana.' });
        }
        
        let affectedRows = 0;
        
        switch (action) {
            case 'delete_selected':
                if (!ids || !Array.isArray(ids) || ids.length === 0) {
                    return res.status(400).json({ error: 'Lista ID jest wymagana.' });
                }
                
                // Usuń wybrane pozycje
                for (const id of ids) {
                    await dbRun('DELETE FROM download_logs WHERE download_id = ?', [id]);
                    await dbRun('DELETE FROM downloads WHERE id = ? AND archived = 1', [id]);
                    affectedRows++;
                }
                break;
                
            case 'delete_series':
                if (!series_name) {
                    return res.status(400).json({ error: 'Nazwa serialu jest wymagana.' });
                }
                
                // Znajdź wszystkie odcinki tego serialu
                const seriesToDelete = await dbAll(`
                    SELECT id FROM downloads 
                    WHERE archived = 1 
                    AND stream_type = 'series'
                    AND filename LIKE ?
                `, [`${series_name}%`]);
                
                // Usuń wszystkie odcinki serialu
                for (const item of seriesToDelete) {
                    await dbRun('DELETE FROM download_logs WHERE download_id = ?', [item.id]);
                    await dbRun('DELETE FROM downloads WHERE id = ?', [item.id]);
                    affectedRows++;
                }
                break;
                
            case 'delete_old':
                const { days = 30 } = req.body;
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - days);
                
                // Znajdź stare pozycje
                const oldItems = await dbAll(`
                    SELECT id FROM downloads 
                    WHERE archived = 1 
                    AND added_at < ?
                `, [cutoffDate.toISOString()]);
                
                // Usuń stare pozycje
                for (const item of oldItems) {
                    await dbRun('DELETE FROM download_logs WHERE download_id = ?', [item.id]);
                    await dbRun('DELETE FROM downloads WHERE id = ?', [item.id]);
                    affectedRows++;
                }
                break;
                
            default:
                return res.status(400).json({ error: 'Nieznana akcja.' });
        }
        
        res.json({ 
            message: `Pomyślnie wykonano operację "${action}"`,
            affected_rows: affectedRows
        });
        
    } catch (error) {
        console.error("Błąd operacji grupowej:", error);
        res.status(500).json({ error: 'Błąd wykonania operacji grupowej.' });
    }
});

// NOWY: Endpoint do eksportu listy archiwum (np. do CSV)
app.get('/api/downloads/archive/export', async (req, res) => {
    try {
        const { format = 'json' } = req.query;
        
        const archiveData = await dbAll(`
            SELECT 
                filename,
                stream_type,
                added_at,
                CASE 
                    WHEN filename LIKE '%S%E%' THEN 
                        SUBSTR(filename, 1, 
                            CASE 
                                WHEN INSTR(filename, ' - S') > 0 THEN INSTR(filename, ' - S') - 1
                                ELSE LENGTH(filename)
                            END
                        )
                    ELSE 'N/A'
                END as series_name,
                CASE 
                    WHEN filename LIKE '%S%E%' THEN 
                        SUBSTR(filename, INSTR(filename, ' - S') + 3, 3)
                    ELSE 'N/A'
                END as season,
                CASE 
                    WHEN filename LIKE '%S%E%' THEN 
                        SUBSTR(filename, INSTR(filename, 'E') + 1, 2)
                    ELSE 'N/A'
                END as episode
            FROM downloads
            WHERE archived = 1
            ORDER BY added_at DESC
        `);
        
        if (format === 'csv') {
            // Konwersja do CSV
            const csvHeader = 'filename,stream_type,series_name,season,episode,added_at\n';
            const csvRows = archiveData.map(row => 
                `"${row.filename}","${row.stream_type}","${row.series_name}","${row.season}","${row.episode}","${row.added_at}"`
            ).join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="download_archive.csv"');
            res.send(csvHeader + csvRows);
        } else {
            // JSON format
            res.json({
                export_date: new Date().toISOString(),
                total_items: archiveData.length,
                data: archiveData
            });
        }
        
    } catch (error) {
        console.error("Błąd eksportu archiwum:", error);
        res.status(500).json({ error: 'Błąd eksportu danych.' });
    }
});

// NOWY: Endpoint do analizy duplikatów w archiwum
app.get('/api/downloads/archive/duplicates', async (req, res) => {
    try {
        const duplicates = await dbAll(`
            SELECT 
                filename,
                COUNT(*) as duplicate_count,
                GROUP_CONCAT(id) as duplicate_ids,
                MIN(added_at) as first_download,
                MAX(added_at) as last_download
            FROM downloads
            WHERE archived = 1
            GROUP BY filename
            HAVING duplicate_count > 1
            ORDER BY duplicate_count DESC, filename
        `);
        
        // Szczegółowe informacje o duplikatach
        const duplicateDetails = [];
        for (const dup of duplicates) {
            const details = await dbAll(`
                SELECT id, filename, added_at, stream_id, episode_id, filepath
                FROM downloads
                WHERE archived = 1 AND filename = ?
                ORDER BY added_at ASC
            `, [dup.filename]);
            
            duplicateDetails.push({
                filename: dup.filename,
                count: dup.duplicate_count,
                total_size_saved: `${dup.duplicate_count - 1} duplicate${dup.duplicate_count > 2 ? 's' : ''}`,
                downloads: details
            });
        }
        
        const summary = {
            total_duplicate_groups: duplicates.length,
            total_duplicate_files: duplicates.reduce((sum, dup) => sum + dup.duplicate_count, 0),
            files_that_could_be_removed: duplicates.reduce((sum, dup) => sum + (dup.duplicate_count - 1), 0)
        };
        
        res.json({
            summary,
            duplicate_groups: duplicateDetails
        });
        
    } catch (error) {
        console.error("Błąd analizy duplikatów:", error);
        res.status(500).json({ error: 'Błąd analizy duplikatów.' });
    }
});

// Endpoint do trwałego usuwania z archiwum
app.delete('/api/downloads/archive/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Sprawdź czy wpis istnieje i jest zarchiwizowany
        const archived = await dbAll('SELECT * FROM downloads WHERE id = ? AND archived = 1', [id]);
        
        if (archived.length === 0) {
            return res.status(404).json({ error: 'Zarchiwizowane pobieranie nie znalezione.' });
        }
        
        // Usuń trwale z bazy
        await dbRun('DELETE FROM download_logs WHERE download_id = ?', [id]);
        await dbRun('DELETE FROM downloads WHERE id = ?', [id]);
        
        res.json({ message: 'Pobieranie zostało trwale usunięte z archiwum.' });
        
    } catch (error) {
        console.error("Błąd usuwania z archiwum:", error);
        res.status(500).json({ error: 'Błąd usuwania z archiwum.' });
    }
});

// Endpoint do usuwania przypisania TMDB ID (opcjonalny)
app.delete('/api/media/:stream_id/:stream_type/remove-tmdb', async (req, res) => {
    const { stream_id, stream_type } = req.params;
    const { playlist_id } = req.query;
    
    console.log(`🗑️ Usuwanie przypisania TMDB ID dla ${stream_type}/${stream_id}`);
    
    try {
        let updateQuery = 'UPDATE media SET tmdb_id = NULL WHERE stream_id = ? AND stream_type = ?';
        let updateParams = [stream_id, stream_type];
        
        if (playlist_id) {
            updateQuery += ' AND playlist_id = ?';
            updateParams.push(playlist_id);
        }
        
        const updateResult = await dbRun(updateQuery, updateParams);
        
        if (updateResult.changes === 0) {
            return res.status(404).json({ error: 'Media nie znalezione.' });
        }
        
        // Usuń gatunki przypisane z TMDB (zachowaj tylko domyślny jeśli nie ma innych)
        const mediaWithSameId = await dbAll(`
            SELECT COUNT(*) as count FROM media 
            WHERE stream_id = ? AND stream_type = ?
        `, [stream_id, stream_type]);
        
        if (mediaWithSameId[0].count === 1) {
            // Usuń wszystkie gatunki i dodaj domyślny "brak gatunku"
            await dbRun(`
                DELETE FROM media_genres 
                WHERE media_stream_id = ? AND media_stream_type = ?
            `, [stream_id, stream_type]);
            
            await dbRun(`
                INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) 
                VALUES (?, ?, ?)
            `, [stream_id, stream_type, -1]);
        }
        
        res.json({
            message: 'Przypisanie TMDB ID zostało usunięte.',
            media_updated: updateResult.changes
        });
        
        console.log(`✅ Usunięto przypisanie TMDB ID dla ${stream_type}/${stream_id}`);
        
    } catch (error) {
        console.error(`❌ Błąd usuwania przypisania TMDB ID:`, error);
        res.status(500).json({ 
            error: 'Nie udało się usunąć przypisania TMDB ID.' 
        });
    }
});

// Endpoint do pobierania listy media bez TMDB ID (pomocniczy dla adminów)
app.get('/api/media/without-tmdb', async (req, res) => {
    try {
        const { limit = 50, playlist_id } = req.query;
        
        let query = `
            SELECT m.*, p.name as playlist_name, COUNT(mg.genre_id) as genre_count
            FROM media m
            LEFT JOIN playlists p ON m.playlist_id = p.id
            LEFT JOIN media_genres mg ON m.stream_id = mg.media_stream_id AND m.stream_type = mg.media_stream_type
            WHERE (m.tmdb_id IS NULL OR m.tmdb_id = '')
        `;
        
        let params = [];
        
        if (playlist_id && playlist_id !== 'all') {
            query += ' AND m.playlist_id = ?';
            params.push(playlist_id);
        }
        
        query += `
            GROUP BY m.stream_id, m.stream_type, m.playlist_id
            ORDER BY m.name ASC
            LIMIT ?
        `;
        
        params.push(parseInt(limit));
        
        const mediaWithoutTMDB = await dbAll(query, params);
        
        // Statystyki
        let statsQuery = `
            SELECT 
                COUNT(*) as total_without_tmdb,
                COUNT(CASE WHEN m.stream_type = 'movie' THEN 1 END) as movies_without_tmdb,
                COUNT(CASE WHEN m.stream_type = 'series' THEN 1 END) as series_without_tmdb
            FROM media m
            WHERE (m.tmdb_id IS NULL OR m.tmdb_id = '')
        `;
        
        let statsParams = [];
        
        if (playlist_id && playlist_id !== 'all') {
            statsQuery += ' AND m.playlist_id = ?';
            statsParams.push(playlist_id);
        }
        
        const stats = await dbAll(statsQuery, statsParams);
        
        res.json({
            media: mediaWithoutTMDB,
            statistics: stats[0],
            showing: mediaWithoutTMDB.length,
            total: stats[0].total_without_tmdb
        });
        
    } catch (error) {
        console.error('Błąd pobierania media bez TMDB ID:', error);
        res.status(500).json({ error: 'Nie udało się pobrać listy media.' });
    }
});

// Endpoint do masowego przypisywania TMDB ID na podstawie automatycznego wyszukiwania
app.post('/api/media/auto-assign-tmdb', async (req, res) => {
    try {
        const { limit = 10, playlist_id } = req.body;
        
        // Pobierz klucz API TMDB
        const tmdbApiRows = await dbAll('SELECT value FROM settings WHERE key = ?', ['tmdbApi']);
        const tmdbApi = tmdbApiRows[0]?.value;
        
        if (!tmdbApi) {
            return res.status(400).json({ error: 'Brak klucza API TMDB w ustawieniach.' });
        }
        
        // Pobierz media bez TMDB ID
        let query = `
            SELECT m.*, p.name as playlist_name
            FROM media m
            LEFT JOIN playlists p ON m.playlist_id = p.id
            WHERE (m.tmdb_id IS NULL OR m.tmdb_id = '')
        `;
        
        let params = [];
        
        if (playlist_id && playlist_id !== 'all') {
            query += ' AND m.playlist_id = ?';
            params.push(playlist_id);
        }
        
        query += ' ORDER BY m.name ASC LIMIT ?';
        params.push(parseInt(limit));
        
        const mediaToProcess = await dbAll(query, params);
        
        if (mediaToProcess.length === 0) {
            return res.json({
                message: 'Brak media do przetworzenia.',
                processed: 0,
                total: 0
            });
        }
        
        console.log(`🤖 Auto-przypisywanie TMDB ID dla ${mediaToProcess.length} pozycji...`);
        
        let processed = 0;
        let assigned = 0;
        let errors = 0;
        
        for (const media of mediaToProcess) {
            try {
                processed++;
                
                // Przygotuj zapytanie wyszukiwania
                let searchQuery = media.name;
                
                // Usuń typowe prefiksy i sufiksy
                searchQuery = searchQuery.replace(/^(PL|EN|US|DE|FR)\s*[-\s]*/i, '').trim();
                searchQuery = searchQuery.replace(/\s*\(?\d{4}\)?\s*$/, '').trim();
                searchQuery = searchQuery.replace(/\s*[-\s]*S\d+.*$/i, '').trim();
                
                const mediaType = media.stream_type === 'series' ? 'tv' : 'movie';
                
                console.log(`🔍 Szukam "${searchQuery}" jako ${mediaType}...`);
                
                // Wyszukaj w TMDB
                const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${tmdbApi}&language=pl-PL&query=${encodeURIComponent(searchQuery)}`;
                const searchResponse = await axios.get(searchUrl, { timeout: 10000 });
                
                if (searchResponse.data.results && searchResponse.data.results.length > 0) {
                    // Weź pierwszy wynik (najlepsze dopasowanie)
                    const bestMatch = searchResponse.data.results[0];
                    const confidence = calculateSearchConfidence(media.name, bestMatch.title || bestMatch.name);
                    
                    // Przypisz tylko jeśli pewność > 80%
                    if (confidence > 0.8) {
                        await dbRun(`
                            UPDATE media 
                            SET tmdb_id = ? 
                            WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?
                        `, [bestMatch.id, media.stream_id, media.stream_type, media.playlist_id]);
                        
                        assigned++;
                        console.log(`✅ Przypisano TMDB ID ${bestMatch.id} do "${media.name}" (pewność: ${Math.round(confidence * 100)}%)`);
                    } else {
                        console.log(`⚠️ Pominięto "${media.name}" - niska pewność: ${Math.round(confidence * 100)}%`);
                    }
                } else {
                    console.log(`❓ Brak wyników dla "${searchQuery}"`);
                }
                
                // Opóźnienie aby nie przeciążyć TMDB API
                await new Promise(resolve => setTimeout(resolve, 250));
                
            } catch (itemError) {
                errors++;
                console.error(`❌ Błąd przetwarzania "${media.name}":`, itemError.message);
            }
        }
        
        const summary = `Auto-przypisywanie zakończone. Przetworzono: ${processed}, Przypisano: ${assigned}, Błędy: ${errors}`;
        console.log(summary);
        
        res.json({
            message: summary,
            processed: processed,
            assigned: assigned,
            errors: errors,
            total: mediaToProcess.length
        });
        
    } catch (error) {
        console.error('Błąd auto-przypisywania TMDB ID:', error);
        res.status(500).json({ error: 'Błąd auto-przypisywania TMDB ID.' });
    }
});

// Funkcja pomocnicza do obliczania pewności wyszukiwania
function calculateSearchConfidence(originalName, tmdbName) {
    if (!originalName || !tmdbName) return 0;
    
    const orig = originalName.toLowerCase().trim();
    const tmdb = tmdbName.toLowerCase().trim();
    
    // Dokładne dopasowanie
    if (orig === tmdb) return 1.0;
    
    // Usuń znaki specjalne i porównaj
    const cleanOrig = orig.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const cleanTmdb = tmdb.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    
    if (cleanOrig === cleanTmdb) return 0.95;
    
    // Sprawdź czy jedno zawiera drugie
    if (cleanOrig.includes(cleanTmdb) || cleanTmdb.includes(cleanOrig)) {
        const shorter = cleanOrig.length < cleanTmdb.length ? cleanOrig : cleanTmdb;
        const longer = cleanOrig.length >= cleanTmdb.length ? cleanOrig : cleanTmdb;
        return (shorter.length / longer.length) * 0.9;
    }
    
    // Podobieństwo słów
    const origWords = cleanOrig.split(' ').filter(w => w.length > 2);
    const tmdbWords = cleanTmdb.split(' ').filter(w => w.length > 2);
    
    if (origWords.length === 0 || tmdbWords.length === 0) return 0;
    
    const matchingWords = origWords.filter(word => 
        tmdbWords.some(tmdbWord => 
            word === tmdbWord || 
            word.includes(tmdbWord) || 
            tmdbWord.includes(word)
        )
    );
    
    return (matchingWords.length / Math.max(origWords.length, tmdbWords.length)) * 0.8;
}

// Dodaj ten endpoint do backend/server.js (po istniejących endpointach API)

// Endpoint do przypisywania TMDB ID do media
app.post('/api/media/:stream_id/:stream_type/assign-tmdb', async (req, res) => {
    const { stream_id, stream_type } = req.params;
    const { tmdb_id, playlist_id } = req.body;
    
    console.log(`🔗 Przypisywanie TMDB ID ${tmdb_id} do ${stream_type}/${stream_id}`);
    
    if (!tmdb_id) {
        return res.status(400).json({ error: 'TMDB ID jest wymagane.' });
    }
    
    try {
        // Sprawdź czy media istnieje
        let mediaQuery = 'SELECT * FROM media WHERE stream_id = ? AND stream_type = ?';
        let mediaParams = [stream_id, stream_type];
        
        if (playlist_id) {
            mediaQuery += ' AND playlist_id = ?';
            mediaParams.push(playlist_id);
        }
        
        const existingMedia = await dbAll(mediaQuery, mediaParams);
        
        if (existingMedia.length === 0) {
            return res.status(404).json({ error: 'Media nie znalezione.' });
        }
        
        // Pobierz klucz API TMDB
        const tmdbApiRows = await dbAll('SELECT value FROM settings WHERE key = ?', ['tmdbApi']);
        const tmdbApi = tmdbApiRows[0]?.value;
        
        if (!tmdbApi) {
            return res.status(400).json({ error: 'Brak klucza API TMDB w ustawieniach.' });
        }
        
        // Zweryfikuj TMDB ID przez API
        try {
            const tmdbType = stream_type === 'series' ? 'tv' : 'movie';
            const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdb_id}?api_key=${tmdbApi}&language=pl-PL`;
            
            console.log(`🎭 Weryfikacja TMDB: ${tmdbUrl}`);
            const tmdbResponse = await axios.get(tmdbUrl, { timeout: 10000 });
            
            if (!tmdbResponse.data || !tmdbResponse.data.id) {
                return res.status(400).json({ error: 'Nieprawidłowe TMDB ID lub pozycja nie istnieje.' });
            }
            
            console.log(`✅ TMDB weryfikacja OK: "${tmdbResponse.data.title || tmdbResponse.data.name}"`);
            
        } catch (tmdbError) {
            console.error('❌ Błąd weryfikacji TMDB:', tmdbError.message);
            if (tmdbError.response?.status === 404) {
                return res.status(400).json({ error: 'TMDB ID nie istnieje.' });
            }
            return res.status(500).json({ error: 'Błąd weryfikacji TMDB ID.' });
        }
        
        await dbRun('BEGIN TRANSACTION');
        
        try {
            // Aktualizuj TMDB ID dla media
            let updateQuery = 'UPDATE media SET tmdb_id = ? WHERE stream_id = ? AND stream_type = ?';
            let updateParams = [tmdb_id, stream_id, stream_type];
            
            if (playlist_id) {
                updateQuery += ' AND playlist_id = ?';
                updateParams.push(playlist_id);
            }
            
            const updateResult = await dbRun(updateQuery, updateParams);
            
            if (updateResult.changes === 0) {
                throw new Error('Nie udało się zaktualizować media.');
            }
            
            console.log(`📝 Zaktualizowano ${updateResult.changes} pozycji media`);
            
            // Usuń stare gatunki dla tego media (ze wszystkich playlist jeśli nie określono playlist_id)
            let deleteGenresQuery = `
                DELETE FROM media_genres 
                WHERE media_stream_id = ? AND media_stream_type = ?
            `;
            let deleteGenresParams = [stream_id, stream_type];
            
            // Jeśli playlist_id określone, usuń gatunki tylko dla tego konkretnego media
            if (playlist_id) {
                deleteGenresQuery = `
                    DELETE FROM media_genres 
                    WHERE media_stream_id = ? AND media_stream_type = ? 
                    AND EXISTS (
                        SELECT 1 FROM media m 
                        WHERE m.stream_id = ? AND m.stream_type = ? AND m.playlist_id = ?
                    )
                `;
                deleteGenresParams = [stream_id, stream_type, stream_id, stream_type, playlist_id];
            }
            
            await dbRun(deleteGenresQuery, deleteGenresParams);
            console.log(`🗑️ Usunięto stare gatunki dla ${stream_type}/${stream_id}`);
            
            // Pobierz i dodaj nowe gatunki z TMDB
            try {
                const tmdbType = stream_type === 'series' ? 'tv' : 'movie';
                const tmdbDetailsUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdb_id}?api_key=${tmdbApi}&language=pl-PL`;
                
                const tmdbDetailsResponse = await axios.get(tmdbDetailsUrl, { timeout: 10000 });
                const tmdbData = tmdbDetailsResponse.data;
                
                if (tmdbData.genres && tmdbData.genres.length > 0) {
                    console.log(`🎭 Dodawanie ${tmdbData.genres.length} gatunków z TMDB...`);
                    
                    const insertGenreStmt = db.prepare('INSERT OR IGNORE INTO genres (id, name) VALUES (?, ?)');
                    const insertMediaGenreStmt = db.prepare('INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) VALUES (?, ?, ?)');
                    
                    try {
                        for (const genre of tmdbData.genres) {
                            await stmtRun(insertGenreStmt, [genre.id, genre.name]);
                            await stmtRun(insertMediaGenreStmt, [stream_id, stream_type, genre.id]);
                        }
                        
                        console.log(`✅ Dodano gatunki: ${tmdbData.genres.map(g => g.name).join(', ')}`);
                    } finally {
                        insertGenreStmt.finalize();
                        insertMediaGenreStmt.finalize();
                    }
                } else {
                    // Brak gatunków w TMDB - dodaj domyślny
                    await dbRun(
                        'INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) VALUES (?, ?, ?)',
                        [stream_id, stream_type, -1]
                    );
                    console.log(`⚠️ Brak gatunków w TMDB - dodano domyślny`);
                }
                
            } catch (genresError) {
                console.error('❌ Błąd pobierania gatunków z TMDB:', genresError.message);
                // Dodaj domyślny gatunek przy błędzie
                await dbRun(
                    'INSERT OR IGNORE INTO media_genres (media_stream_id, media_stream_type, genre_id) VALUES (?, ?, ?)',
                    [stream_id, stream_type, -1]
                );
            }
            
            await dbRun('COMMIT');
            
            res.json({
                message: 'TMDB ID zostało pomyślnie przypisane.',
                tmdb_id: tmdb_id,
                media_updated: updateResult.changes
            });
            
            console.log(`🎉 Pomyślnie przypisano TMDB ID ${tmdb_id} do ${stream_type}/${stream_id}`);
            
        } catch (transactionError) {
            await dbRun('ROLLBACK');
            throw transactionError;
        }
        
    } catch (error) {
        console.error(`❌ Błąd przypisywania TMDB ID:`, error);
        res.status(500).json({ 
            error: 'Nie udało się przypisać TMDB ID.',
            details: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Serwer backendu działa na porcie ${PORT}`);
    
    // Auto-start Download Manager po uruchomieniu serwera
    setTimeout(autoStartDownloadManager, 3000); // Czekaj 3s na inicjalizację bazy
});

// W server.js, zamień istniejący cron job na ten zaktualizowany:

cron.schedule('0 * * * *', async () => { // Uruchamia się co godzinę
    const currentTime = new Date().toLocaleString('pl-PL');
    console.log(`🕐 [${currentTime}] Uruchamianie zaplanowanych zadań...`);
    
    try {
        const settingsRows = await dbAll(`SELECT key, value FROM settings WHERE key = 'checkFrequency'`);
        const frequency = parseInt(settingsRows[0]?.value || '12', 10);
        const currentHour = new Date().getHours();

        // === NOWE: ODŚWIEŻANIE WSZYSTKICH AKTYWNYCH PLAYLIST ===
        if (currentHour % frequency === 0) {
            console.log(`📡 Uruchamianie automatycznego odświeżania playlist (częstotliwość: co ${frequency}h)`);
            try {
                // Pobierz wszystkie aktywne playlisty
                const activePlaylists = await dbAll('SELECT * FROM playlists WHERE is_active = 1');
                
                if (activePlaylists.length > 0) {
                    console.log(`🔄 Znaleziono ${activePlaylists.length} aktywnych playlist do odświeżenia`);
                    
                    let successCount = 0;
                    let errorCount = 0;
                    
                    // Synchronizuj każdą aktywną playlistę
                    for (const playlist of activePlaylists) {
                        try {
                            console.log(`📺 Auto-sync: ${playlist.name}...`);
                            const result = await syncSinglePlaylist(playlist);
                            console.log(`✅ ${playlist.name}: +${result.added} -${result.removed} (${result.total_media} total)`);
                            successCount++;
                        } catch (playlistError) {
                            console.error(`❌ Błąd auto-sync ${playlist.name}: ${playlistError.message}`);
                            errorCount++;
                        }
                        
                        // Krótka przerwa między playlistami
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    
                    console.log(`📊 Auto-sync zakończony: ${successCount} udanych, ${errorCount} błędów`);
                    
                    // Wyślij powiadomienie Discord o wynikach
                    if (successCount > 0 || errorCount > 0) {
                        try {
                            const webhookUrl = await dbAll('SELECT value FROM settings WHERE key = ?', ['discordWebhook']);
                            if (webhookUrl && webhookUrl[0] && webhookUrl[0].value) {
                                await axios.post(webhookUrl[0].value, {
                                    content: `🔄 **Automatyczne odświeżanie playlist zakończone**\n✅ Udane: ${successCount}\n❌ Błędy: ${errorCount}`,
                                    username: "Media Center Auto-Sync"
                                });
                            }
                        } catch (discordError) {
                            console.error("Nie udało się wysłać powiadomienia Discord:", discordError.message);
                        }
                    }
                } else {
                    console.log(`⏳ Brak aktywnych playlist do synchronizacji`);
                }
            } catch (error) {
                console.error(`❌ Błąd automatycznego odświeżania playlist: ${error.message}`);
            }
        } else {
            const nextCheck = frequency - (currentHour % frequency);
            console.log(`⏳ Pominięto odświeżanie playlist. Następne sprawdzenie za ${nextCheck}h (o ${(currentHour + nextCheck) % 24}:00).`);
        }

        if (currentHour % frequency === 0) {
    console.log(`🎯 Uruchamianie sprawdzania wishlisty...`);
    try {
        const wishlistResult = await wishlistManager.checkWishlistMatches();
        console.log(`✅ Sprawdzanie wishlisty zakończone: ${wishlistResult.found}/${wishlistResult.checked} znaleziono`);
        
        // Wyślij powiadomienie Discord o wynikach wishlisty
        if (wishlistResult.found > 0) {
            try {
                const webhookUrl = await dbAll('SELECT value FROM settings WHERE key = ?', ['discordWebhook']);
                if (webhookUrl && webhookUrl[0] && webhookUrl[0].value) {
                    await axios.post(webhookUrl[0].value, {
                        content: `🎯 **Wishlist Check Complete**\n✅ Znalezionych pozycji: ${wishlistResult.found}/${wishlistResult.checked}`,
                        username: "Media Center Wishlist"
                    });
                }
            } catch (discordError) {
                console.error("Nie udało się wysłać powiadomienia Discord o wishlist:", discordError.message);
            }
        }
    } catch (error) {
        console.error(`❌ Błąd sprawdzania wishlisty: ${error.message}`);
    }
}

        // === NOWE: MONITOROWANIE ULUBIONYCH Z WSZYSTKICH PLAYLIST ===
        if (currentHour % frequency === 0) {
            console.log(`📺 Uruchamianie monitorowania ulubionych...`);
            try {
                await monitorFavoritesMultiPlaylist(); // NOWA FUNKCJA
                console.log(`✅ Monitorowanie ulubionych zakończone pomyślnie`);
            } catch (error) {
                console.error(`❌ Błąd monitorowania ulubionych: ${error.message}`);
            }
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

// === NOWA FUNKCJA: Monitorowanie ulubionych z wielu playlist ===
async function monitorFavoritesMultiPlaylist() {
    console.log('Uruchamianie zadania monitorowania ulubionych (multi-playlist)...');
    
    try {
        // Pobierz wszystkie ulubione seriale z wszystkich playlist
        const favoriteSeries = await dbAll(`
            SELECT f.*, p.server_url, p.username, p.password, p.name as playlist_name, p.is_active
            FROM favorites f
            JOIN playlists p ON f.playlist_id = p.id
            WHERE f.stream_type = 'series' AND p.is_active = 1
        `);
        
        if (favoriteSeries.length === 0) {
            console.log('Monitorowanie zakończone: brak ulubionych seriali do sprawdzenia.');
            return;
        }

        console.log(`Znaleziono ${favoriteSeries.length} ulubionych seriali z aktywnych playlist do sprawdzenia...`);
        let newDownloadsAdded = false;

        // Grupuj ulubione według playlist dla lepszej wydajności
        const playlistGroups = {};
        favoriteSeries.forEach(series => {
            if (!playlistGroups[series.playlist_id]) {
                playlistGroups[series.playlist_id] = {
                    playlist: series,
                    series: []
                };
            }
            playlistGroups[series.playlist_id].series.push(series);
        });

        for (const [playlistId, group] of Object.entries(playlistGroups)) {
            const { playlist, series: playlistSeries } = group;
            console.log(`🔍 Sprawdzanie playlist: ${playlist.playlist_name} (${playlistSeries.length} seriali)...`);

            for (const series of playlistSeries) {
                try {
                    // Pobierz szczegóły serialu z odpowiedniej playlisty
                    const xtreamBaseUrl = `${playlist.server_url}/player_api.php?username=${playlist.username}&password=${playlist.password}`;
                    const seriesInfoUrl = `${xtreamBaseUrl}&action=get_series_info&series_id=${series.stream_id}`;
                    
                    const seriesInfoRes = await axios.get(seriesInfoUrl, { timeout: 15000 });
                    
                    if (!seriesInfoRes.data?.episodes) {
                        console.warn(`⚠️ Brak odcinków dla serialu ${series.stream_id} z ${playlist.playlist_name}`);
                        continue;
                    }

                    const allEpisodes = Object.values(seriesInfoRes.data.episodes).flat();
                    
                    // ZAKTUALIZOWANE ZAPYTANIE: Sprawdź odcinki uwzględniając archiwum
                    const existingDownloads = await dbAll(`
                        SELECT 
                            episode_id,
                            COUNT(*) as attempt_count,
                            MAX(CASE WHEN worker_status = 'completed' AND (archived = 0 OR archived IS NULL) THEN 1 ELSE 0 END) as is_completed_active,
                            MAX(CASE WHEN worker_status = 'completed' AND archived = 1 THEN 1 ELSE 0 END) as is_completed_archived,
                            MAX(CASE WHEN worker_status = 'downloading' THEN 1 ELSE 0 END) as is_downloading
                        FROM downloads 
                        WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?
                        GROUP BY episode_id
                        HAVING 
                            is_completed_active = 1 
                            OR is_completed_archived = 1 
                            OR is_downloading = 1 
                            OR attempt_count >= 3
                    `, [series.stream_id, 'series', playlist.playlist_id]);

                    const excludedEpisodeIds = new Set(existingDownloads.map(row => row.episode_id));

                    console.log(`  - ${playlist.playlist_name}/${series.stream_id}: ${allEpisodes.length} odcinków, ${excludedEpisodeIds.size} wykluczonych (w tym archiwum)`);

                    // Sprawdź ile jest failed z mniej niż 3 próbami (do retry) - tylko niezarchiwizowane
                    const retryableDownloads = await dbAll(`
                        SELECT 
                            episode_id,
                            COUNT(*) as attempt_count
                        FROM downloads 
                        WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?
                        AND worker_status = 'failed'
                        AND (archived = 0 OR archived IS NULL)
                        GROUP BY episode_id
                        HAVING attempt_count < 3
                    `, [series.stream_id, 'series', playlist.playlist_id]);

                    // Sprawdź ile ma już 3+ prób (do usunięcia) - tylko niezarchiwizowane
                    const maxAttemptsDownloads = await dbAll(`
                        SELECT 
                            episode_id,
                            COUNT(*) as attempt_count
                        FROM downloads 
                        WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?
                        AND worker_status = 'failed'
                        AND (archived = 0 OR archived IS NULL)
                        GROUP BY episode_id
                        HAVING attempt_count >= 3
                    `, [series.stream_id, 'series', playlist.playlist_id]);

                    // Usuń downloads które mają już 3+ nieudane próby (tylko niezarchiwizowane)
                    if (maxAttemptsDownloads.length > 0) {
                        console.log(`🗑️ Usuwanie ${maxAttemptsDownloads.length} odcinków z 3+ nieudanymi próbami z ${playlist.playlist_name}...`);
                        
                        for (const item of maxAttemptsDownloads) {
                            try {
                                await dbRun(`
                                    DELETE FROM downloads 
                                    WHERE stream_id = ? AND stream_type = ? AND playlist_id = ? AND episode_id = ?
                                    AND (archived = 0 OR archived IS NULL)
                                `, [series.stream_id, 'series', playlist.playlist_id, item.episode_id]);
                            } catch (error) {
                                console.error(`❌ Błąd usuwania downloads dla odcinka ${item.episode_id}:`, error);
                            }
                        }
                        
                        // Zaktualizuj listę wykluczonych po usunięciu
                        const updatedExistingDownloads = await dbAll(`
                            SELECT 
                                episode_id,
                                COUNT(*) as attempt_count,
                                MAX(CASE WHEN worker_status = 'completed' AND (archived = 0 OR archived IS NULL) THEN 1 ELSE 0 END) as is_completed_active,
                                MAX(CASE WHEN worker_status = 'completed' AND archived = 1 THEN 1 ELSE 0 END) as is_completed_archived,
                                MAX(CASE WHEN worker_status = 'downloading' THEN 1 ELSE 0 END) as is_downloading
                            FROM downloads 
                            WHERE stream_id = ? AND stream_type = ? AND playlist_id = ?
                            GROUP BY episode_id
                            HAVING 
                                is_completed_active = 1 
                                OR is_completed_archived = 1 
                                OR is_downloading = 1 
                                OR attempt_count >= 3
                        `, [series.stream_id, 'series', playlist.playlist_id]);
                        
                        excludedEpisodeIds.clear();
                        updatedExistingDownloads.forEach(row => excludedEpisodeIds.add(row.episode_id));
                        
                        console.log(`  - Zaktualizowana lista wykluczonych: ${excludedEpisodeIds.size}`);
                    }

                    // Filtruj odcinki do dodania
                    const newEpisodes = allEpisodes.filter(ep => !excludedEpisodeIds.has(ep.id));

                    if (newEpisodes.length > 0) {
                        console.log(`✨ Znaleziono ${newEpisodes.length} odcinków do dodania dla serialu z ${playlist.playlist_name}`);
                        newDownloadsAdded = true;

                        const seriesName = seriesInfoRes.data?.info?.name || `Serial ${series.stream_id}`;
                        const episodesToQueue = newEpisodes.map(ep => {
                            const filename = `${seriesName.replace(/[^\w\s.-]/gi, '').trim()} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`;
                            return { id: ep.id, filename };
                        });

                        await axios.post(`http://localhost:${PORT}/api/downloads/start`, {
                            stream_id: series.stream_id,
                            stream_type: 'series',
                            playlist_id: playlist.playlist_id,
                            episodes: episodesToQueue
                        });

                        const episodeList = newEpisodes.map(ep => 
                            `S${String(ep.season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`
                        ).join(', ');
                        
                        // Wyślij powiadomienie Discord
                        try {
                            await sendDiscordNotification(
                                `✅ **${seriesName}** (${playlist.playlist_name}) - dodano do kolejki: **${episodeList}**`
                            );
                        } catch (discordError) {
                            console.error("Błąd wysyłania powiadomienia Discord:", discordError.message);
                        }
                    }

                } catch (seriesError) {
                    console.error(`❌ Błąd podczas sprawdzania serialu ID ${series.stream_id} z ${playlist.playlist_name}:`, seriesError.message);
                    continue;
                }
                
                // Krótka przerwa między serialami
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Przerwa między playlistami
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!newDownloadsAdded) {
            console.log('✅ Monitorowanie zakończone: nie znaleziono nowych odcinków.');
        } else {
            console.log('✅ Monitorowanie zakończone: znaleziono i dodano nowe odcinki.');
        }

    } catch (error) {
        console.error("❌ Wystąpił błąd podczas monitorowania ulubionych (multi-playlist):", error.message);
    }
}

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
