// backend/wishlist_manager.js - System zarządzania wishlistą
const axios = require('axios');

class WishlistManager {
    constructor(db, dbAll, dbRun, stmtRun) {
        this.db = db;
        this.dbAll = dbAll;
        this.dbRun = dbRun;
        this.stmtRun = stmtRun;
        this.initializeDatabase();
    }

    async initializeDatabase() {
        try {
            // Tabela wishlisty
            await this.dbRun(`
                CREATE TABLE IF NOT EXISTS wishlist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tmdb_id INTEGER NOT NULL,
                    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
                    title TEXT NOT NULL,
                    original_title TEXT,
                    release_date TEXT,
                    poster_path TEXT,
                    overview TEXT,
                    genres TEXT, -- JSON string z gatunkami
                    vote_average REAL,
                    vote_count INTEGER,
                    status TEXT DEFAULT 'wanted' CHECK (status IN ('wanted', 'found', 'downloading', 'completed')),
                    priority INTEGER DEFAULT 1 CHECK (priority IN (1, 2, 3, 4, 5)), -- 1=najwyższy, 5=najniższy
                    auto_download BOOLEAN DEFAULT 1,
                    search_keywords TEXT, -- dodatkowe słowa kluczowe do wyszukiwania
                    notes TEXT,
                    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    found_at DATETIME,
                    last_check DATETIME,
                    UNIQUE(tmdb_id, media_type)
                )
            `);

            // Tabela logów wishlisty
            await this.dbRun(`
                CREATE TABLE IF NOT EXISTS wishlist_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    wishlist_id INTEGER,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    level TEXT DEFAULT 'INFO',
                    message TEXT,
                    data TEXT, -- JSON z dodatkowymi danymi
                    FOREIGN KEY (wishlist_id) REFERENCES wishlist(id)
                )
            `);

            // Tabela znalezionych pozycji
            await this.dbRun(`
                CREATE TABLE IF NOT EXISTS wishlist_matches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    wishlist_id INTEGER,
                    media_stream_id INTEGER,
                    media_stream_type TEXT,
                    playlist_id INTEGER,
                    playlist_name TEXT,
                    match_score REAL, -- 0.0 - 1.0, jak dobrze pasuje
                    match_reason TEXT, -- opis dlaczego uznano za match
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (wishlist_id) REFERENCES wishlist(id),
                    FOREIGN KEY (playlist_id) REFERENCES playlists(id)
                )
            `);

            console.log('✅ Wishlist Manager: baza danych zainicjalizowana');
        } catch (error) {
            console.error('❌ Wishlist Manager: błąd inicjalizacji bazy:', error);
        }
    }

    // === ZARZĄDZANIE WISHLISTĄ ===

    async addToWishlist(tmdbId, mediaType, options = {}) {
        try {
            // Pobierz szczegóły z TMDB
            const tmdbDetails = await this.getTmdbDetails(tmdbId, mediaType);
            if (!tmdbDetails) {
                throw new Error('Nie znaleziono pozycji w TMDB');
            }

            const {
                priority = 1,
                autoDownload = true,
                searchKeywords = '',
                notes = ''
            } = options;

            const insertData = {
                tmdb_id: tmdbId,
                media_type: mediaType,
                title: tmdbDetails.title || tmdbDetails.name,
                original_title: tmdbDetails.original_title || tmdbDetails.original_name,
                release_date: tmdbDetails.release_date || tmdbDetails.first_air_date,
                poster_path: tmdbDetails.poster_path,
                overview: tmdbDetails.overview,
                genres: JSON.stringify(tmdbDetails.genres || []),
                vote_average: tmdbDetails.vote_average,
                vote_count: tmdbDetails.vote_count,
                priority: priority,
                auto_download: autoDownload ? 1 : 0,
                search_keywords: searchKeywords,
                notes: notes
            };

            const result = await this.dbRun(`
                INSERT OR REPLACE INTO wishlist 
                (tmdb_id, media_type, title, original_title, release_date, poster_path, 
                 overview, genres, vote_average, vote_count, priority, auto_download, 
                 search_keywords, notes, added_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                insertData.tmdb_id, insertData.media_type, insertData.title,
                insertData.original_title, insertData.release_date, insertData.poster_path,
                insertData.overview, insertData.genres, insertData.vote_average,
                insertData.vote_count, insertData.priority, insertData.auto_download,
                insertData.search_keywords, insertData.notes, new Date().toISOString()
            ]);

            await this.logWishlistAction(result.lastID, 'INFO', `Dodano do wishlisty: ${insertData.title}`);
            
            return { id: result.lastID, ...insertData };
        } catch (error) {
            console.error('Błąd dodawania do wishlisty:', error);
            throw error;
        }
    }

    async removeFromWishlist(wishlistId) {
        try {
            const item = await this.dbAll('SELECT * FROM wishlist WHERE id = ?', [wishlistId]);
            if (item.length === 0) {
                throw new Error('Pozycja nie znaleziona w wishliście');
            }

            await this.dbRun('DELETE FROM wishlist WHERE id = ?', [wishlistId]);
            await this.dbRun('DELETE FROM wishlist_logs WHERE wishlist_id = ?', [wishlistId]);
            await this.dbRun('DELETE FROM wishlist_matches WHERE wishlist_id = ?', [wishlistId]);

            await this.logWishlistAction(null, 'INFO', `Usunięto z wishlisty: ${item[0].title}`);
            return true;
        } catch (error) {
            console.error('Błąd usuwania z wishlisty:', error);
            throw error;
        }
    }

    async updateWishlistItem(wishlistId, updates) {
        try {
            const allowedFields = ['priority', 'auto_download', 'search_keywords', 'notes', 'status'];
            const updateFields = [];
            const updateValues = [];

            for (const [key, value] of Object.entries(updates)) {
                if (allowedFields.includes(key)) {
                    updateFields.push(`${key} = ?`);
                    updateValues.push(value);
                }
            }

            if (updateFields.length === 0) {
                throw new Error('Brak prawidłowych pól do aktualizacji');
            }

            updateValues.push(wishlistId);
            
            await this.dbRun(`
                UPDATE wishlist 
                SET ${updateFields.join(', ')} 
                WHERE id = ?
            `, updateValues);

            await this.logWishlistAction(wishlistId, 'INFO', 'Zaktualizowano pozycję wishlisty');
            return true;
        } catch (error) {
            console.error('Błąd aktualizacji wishlisty:', error);
            throw error;
        }
    }

    async getWishlist(filters = {}) {
        try {
            let whereClause = '';
            const params = [];

            if (filters.status) {
                whereClause += 'WHERE status = ?';
                params.push(filters.status);
            }

            if (filters.media_type) {
                whereClause += (whereClause ? ' AND ' : 'WHERE ') + 'media_type = ?';
                params.push(filters.media_type);
            }

            if (filters.priority) {
                whereClause += (whereClause ? ' AND ' : 'WHERE ') + 'priority = ?';
                params.push(filters.priority);
            }

            const orderBy = filters.sort_by || 'priority ASC, added_at DESC';

            const items = await this.dbAll(`
                SELECT 
                    w.*,
                    COUNT(wm.id) as match_count,
                    MAX(wm.created_at) as last_match_date
                FROM wishlist w
                LEFT JOIN wishlist_matches wm ON w.id = wm.wishlist_id
                ${whereClause}
                GROUP BY w.id
                ORDER BY ${orderBy}
            `, params);

            // Parsuj JSON gatunki
            return items.map(item => ({
                ...item,
                genres: item.genres ? JSON.parse(item.genres) : [],
                auto_download: Boolean(item.auto_download)
            }));
        } catch (error) {
            console.error('Błąd pobierania wishlisty:', error);
            throw error;
        }
    }

    // === WYSZUKIWANIE I DOPASOWYWANIE ===

    async checkWishlistMatches() {
        try {
            console.log('🔍 Sprawdzanie wishlisty...');
            
            const wantedItems = await this.dbAll(`
                SELECT * FROM wishlist 
                WHERE status = 'wanted' 
                ORDER BY priority ASC, added_at ASC
            `);

            if (wantedItems.length === 0) {
                console.log('📋 Brak pozycji do sprawdzenia w wishliście');
                return { checked: 0, found: 0 };
            }

            console.log(`📋 Sprawdzanie ${wantedItems.length} pozycji z wishlisty...`);

            let foundCount = 0;
            
            for (const item of wantedItems) {
                try {
                    const matches = await this.findMatches(item);
                    
                    if (matches.length > 0) {
                        await this.handleFoundMatches(item, matches);
                        foundCount++;
                    }

                    // Zaktualizuj ostatnią datę sprawdzenia
                    await this.dbRun(
                        'UPDATE wishlist SET last_check = ? WHERE id = ?',
                        [new Date().toISOString(), item.id]
                    );

                    // Krótkie opóźnienie między sprawdzeniami
                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (itemError) {
                    console.error(`❌ Błąd sprawdzania ${item.title}:`, itemError);
                    await this.logWishlistAction(item.id, 'ERROR', `Błąd sprawdzania: ${itemError.message}`);
                }
            }

            console.log(`✅ Sprawdzenie wishlisty zakończone: ${foundCount}/${wantedItems.length} znaleziono`);
            
            return { 
                checked: wantedItems.length, 
                found: foundCount 
            };

        } catch (error) {
            console.error('❌ Błąd sprawdzania wishlisty:', error);
            throw error;
        }
    }

    async findMatches(wishlistItem) {
        try {
            const searchTerms = this.generateSearchTerms(wishlistItem);
            const matches = [];

            for (const term of searchTerms) {
                // Wyszukaj w bazie mediów
                const mediaMatches = await this.dbAll(`
                    SELECT 
                        m.*,
                        p.name as playlist_name
                    FROM media m
                    LEFT JOIN playlists p ON m.playlist_id = p.id
                    WHERE (
                        LOWER(m.name) LIKE LOWER(?) 
                        OR LOWER(m.name) LIKE LOWER(?)
                        OR LOWER(m.name) LIKE LOWER(?)
                    )
                    AND m.stream_type = ?
                `, [
                    `%${term}%`,
                    `%${term.replace(/[^\w\s]/g, '')}%`, // bez znaków specjalnych
                    `%${term.split(' ')[0]}%`, // pierwsze słowo
                    wishlistItem.media_type === 'tv' ? 'series' : 'movie'
                ]);

                for (const media of mediaMatches) {
                    const score = this.calculateMatchScore(wishlistItem, media, term);
                    
                    if (score > 0.6) { // próg dopasowania
                        // Sprawdź czy już nie mamy tego matcha
                        const existingMatch = await this.dbAll(`
                            SELECT id FROM wishlist_matches 
                            WHERE wishlist_id = ? AND media_stream_id = ? AND media_stream_type = ?
                        `, [wishlistItem.id, media.stream_id, media.stream_type]);

                        if (existingMatch.length === 0) {
                            matches.push({
                                ...media,
                                match_score: score,
                                match_reason: `Dopasowanie nazwy: "${term}" -> "${media.name}"`,
                                search_term: term
                            });
                        }
                    }
                }
            }

            // Sortuj według score i usuń duplikaty
            return matches
                .sort((a, b) => b.match_score - a.match_score)
                .filter((match, index, self) => 
                    index === self.findIndex(m => 
                        m.stream_id === match.stream_id && 
                        m.stream_type === match.stream_type
                    )
                )
                .slice(0, 5); // max 5 najlepszych matchy

        } catch (error) {
            console.error('Błąd wyszukiwania matchy:', error);
            return [];
        }
    }

    generateSearchTerms(wishlistItem) {
        const terms = new Set();
        
        // Główny tytuł
        if (wishlistItem.title) {
            terms.add(wishlistItem.title.trim());
        }
        
        // Oryginalny tytuł
        if (wishlistItem.original_title && wishlistItem.original_title !== wishlistItem.title) {
            terms.add(wishlistItem.original_title.trim());
        }
        
        // Tytuł bez roku
        if (wishlistItem.title) {
            const titleWithoutYear = wishlistItem.title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
            if (titleWithoutYear !== wishlistItem.title) {
                terms.add(titleWithoutYear);
            }
        }
        
        // Dodatkowe słowa kluczowe
        if (wishlistItem.search_keywords) {
            const keywords = wishlistItem.search_keywords.split(',').map(k => k.trim()).filter(k => k);
            keywords.forEach(keyword => terms.add(keyword));
        }
        
        // Usuń bardzo krótkie terminy
        return Array.from(terms).filter(term => term.length >= 3);
    }

    calculateMatchScore(wishlistItem, media, searchTerm) {
        let score = 0;
        const mediaName = media.name.toLowerCase();
        const searchLower = searchTerm.toLowerCase();
        const titleLower = wishlistItem.title.toLowerCase();
        
        // Dokładne dopasowanie nazwy
        if (mediaName === searchLower || mediaName === titleLower) {
            score += 1.0;
        }
        // Nazwa zaczyna się od search term
        else if (mediaName.startsWith(searchLower) || mediaName.startsWith(titleLower)) {
            score += 0.9;
        }
        // Search term znajduje się w nazwie
        else if (mediaName.includes(searchLower) || mediaName.includes(titleLower)) {
            score += 0.7;
        }
        // Podobieństwo słów
        else {
            const mediaWords = mediaName.split(/\s+/);
            const searchWords = searchLower.split(/\s+/);
            const matchingWords = searchWords.filter(word => 
                mediaWords.some(mWord => mWord.includes(word) || word.includes(mWord))
            );
            score += (matchingWords.length / searchWords.length) * 0.6;
        }

        // Bonus za TMDB ID match (jeśli dostępne)
        if (media.tmdb_id && media.tmdb_id == wishlistItem.tmdb_id) {
            score += 0.5;
        }

        // Bonus za poprawny rok (jeśli dostępny)
        if (wishlistItem.release_date && media.name.includes(wishlistItem.release_date.substring(0, 4))) {
            score += 0.2;
        }

        return Math.min(score, 1.0);
    }

    async handleFoundMatches(wishlistItem, matches) {
        try {
            console.log(`🎯 Znaleziono ${matches.length} dopasowań dla: ${wishlistItem.title}`);

            // Zapisz wszystkie matche
            for (const match of matches) {
                await this.dbRun(`
                    INSERT INTO wishlist_matches 
                    (wishlist_id, media_stream_id, media_stream_type, playlist_id, 
                     playlist_name, match_score, match_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    wishlistItem.id,
                    match.stream_id,
                    match.stream_type,
                    match.playlist_id,
                    match.playlist_name,
                    match.match_score,
                    match.match_reason
                ]);
            }

            // Oznacz jako znaleziony
            await this.dbRun(`
                UPDATE wishlist 
                SET status = 'found', found_at = ? 
                WHERE id = ?
            `, [new Date().toISOString(), wishlistItem.id]);

            // Log
            const bestMatch = matches[0];
            await this.logWishlistAction(
                wishlistItem.id, 
                'SUCCESS', 
                `Znaleziono match: ${bestMatch.name} (score: ${bestMatch.match_score.toFixed(2)})`,
                JSON.stringify({ matches: matches.length, best_score: bestMatch.match_score })
            );

            // Auto-download jeśli włączony
            if (wishlistItem.auto_download) {
                await this.initiateAutoDownload(wishlistItem, bestMatch);
            }

        } catch (error) {
            console.error('Błąd obsługi znalezionych matchy:', error);
            throw error;
        }
    }

    async initiateAutoDownload(wishlistItem, match) {
        try {
            console.log(`⏬ Rozpoczynanie auto-download dla: ${wishlistItem.title}`);

            // Oznacz jako downloading
            await this.dbRun(`
                UPDATE wishlist 
                SET status = 'downloading' 
                WHERE id = ?
            `, [wishlistItem.id]);

            if (match.stream_type === 'movie') {
                // Dla filmów - pobierz cały film
                const filename = `${wishlistItem.title.replace(/[^\w\s.-]/gi, '').trim()}`;
                
                const downloadResponse = await axios.post('http://localhost:3001/api/downloads/start', {
                    stream_id: match.stream_id,
                    stream_type: 'movie',
                    playlist_id: match.playlist_id,
                    episodes: [{ id: match.stream_id, filename }]
                });

                await this.logWishlistAction(
                    wishlistItem.id,
                    'INFO',
                    `Rozpoczęto pobieranie filmu: ${filename}`
                );

            } else if (match.stream_type === 'series') {
                // Dla seriali - pobierz wszystkie dostępne odcinki
                const seriesDetails = await axios.get(`http://localhost:3001/api/media/details/series/${match.stream_id}`);
                
                if (seriesDetails.data?.xtream_details?.episodes) {
                    const allEpisodes = Object.values(seriesDetails.data.xtream_details.episodes).flat();
                    const episodesToDownload = allEpisodes.map(ep => ({
                        id: ep.id,
                        filename: `${wishlistItem.title.replace(/[^\w\s.-]/gi, '').trim()} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`
                    }));

                    const downloadResponse = await axios.post('http://localhost:3001/api/downloads/start', {
                        stream_id: match.stream_id,
                        stream_type: 'series',
                        playlist_id: match.playlist_id,
                        episodes: episodesToDownload
                    });

                    await this.logWishlistAction(
                        wishlistItem.id,
                        'INFO',
                        `Rozpoczęto pobieranie serialu: ${episodesToDownload.length} odcinków`
                    );
                }
            }

            // Wyślij powiadomienie Discord jeśli skonfigurowane
            await this.sendWishlistNotification(wishlistItem, match);

        } catch (error) {
            console.error('Błąd auto-download:', error);
            
            // Przywróć status na found
            await this.dbRun(`
                UPDATE wishlist 
                SET status = 'found' 
                WHERE id = ?
            `, [wishlistItem.id]);

            await this.logWishlistAction(
                wishlistItem.id,
                'ERROR',
                `Błąd auto-download: ${error.message}`
            );
        }
    }

    async sendWishlistNotification(wishlistItem, match) {
        try {
            const settings = await this.dbAll('SELECT value FROM settings WHERE key = ?', ['discordWebhook']);
            const webhookUrl = settings[0]?.value;
            
            if (webhookUrl) {
                const message = `🎯 **Wishlist Match Found!**\n` +
                    `**${wishlistItem.title}** (${wishlistItem.media_type})\n` +
                    `Znaleziono jako: **${match.name}**\n` +
                    `Playlista: ${match.playlist_name}\n` +
                    `Score: ${(match.match_score * 100).toFixed(0)}%\n` +
                    `Auto-download: ${wishlistItem.auto_download ? '✅ Tak' : '❌ Nie'}`;

                await axios.post(webhookUrl, {
                    content: message,
                    username: "Media Center Wishlist"
                });
            }
        } catch (error) {
            console.error('Błąd wysyłania powiadomienia wishlist:', error);
        }
    }

    // === POMOCNICZE ===

    async getTmdbDetails(tmdbId, mediaType) {
        try {
            const settings = await this.dbAll('SELECT value FROM settings WHERE key = ?', ['tmdbApi']);
            const tmdbApi = settings[0]?.value;
            
            if (!tmdbApi) {
                throw new Error('Brak klucza API TMDB');
            }

            const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbApi}&language=pl-PL`;
            const response = await axios.get(tmdbUrl, { timeout: 10000 });
            
            return response.data;
        } catch (error) {
            console.error('Błąd pobierania z TMDB:', error);
            return null;
        }
    }

    async logWishlistAction(wishlistId, level, message, data = null) {
        try {
            await this.dbRun(`
                INSERT INTO wishlist_logs (wishlist_id, level, message, data)
                VALUES (?, ?, ?, ?)
            `, [wishlistId, level, message, data]);
        } catch (error) {
            console.error('Błąd logowania wishlist:', error);
        }
    }

    async getWishlistStats() {
        try {
            const stats = await this.dbAll(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'wanted' THEN 1 ELSE 0 END) as wanted,
                    SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) as found,
                    SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) as downloading,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN auto_download = 1 THEN 1 ELSE 0 END) as auto_download_enabled
                FROM wishlist
            `);

            const recentActivity = await this.dbAll(`
                SELECT 
                    wl.timestamp,
                    wl.level,
                    wl.message,
                    w.title
                FROM wishlist_logs wl
                LEFT JOIN wishlist w ON wl.wishlist_id = w.id
                ORDER BY wl.timestamp DESC
                LIMIT 10
            `);

            return {
                statistics: stats[0],
                recent_activity: recentActivity
            };
        } catch (error) {
            console.error('Błąd pobierania statystyk wishlist:', error);
            return { statistics: {}, recent_activity: [] };
        }
    }
}

module.exports = WishlistManager;