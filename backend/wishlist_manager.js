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
            // Sprawdź czy tabela wishlist już istnieje
            const tableExists = await this.dbAll(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='wishlist'
            `);

            if (tableExists.length === 0) {
                // Utwórz nową tabelę z poprawnym constraint
                await this.dbRun(`
                    CREATE TABLE wishlist (
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
                        status TEXT DEFAULT 'wanted' CHECK (status IN ('wanted', 'found', 'downloading', 'completed', 'requires_selection')),
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
                console.log('✅ Utworzono nową tabelę wishlist z poprawnym constraint');
            } else {
                // Tabela istnieje - sprawdź czy musimy ją zmigrować
                console.log('🔄 Tabela wishlist już istnieje, sprawdzanie constraint...');
                
                // Test czy constraint pozwala na 'requires_selection'
                try {
                    await this.dbRun(`
                        INSERT OR REPLACE INTO wishlist 
                        (tmdb_id, media_type, title, status, added_at)
                        VALUES (-1, 'movie', 'TEST_CONSTRAINT', 'requires_selection', ?)
                    `, [new Date().toISOString()]);
                    
                    // Jeśli się udało, usuń test
                    await this.dbRun('DELETE FROM wishlist WHERE tmdb_id = -1 AND title = ?', ['TEST_CONSTRAINT']);
                    console.log('✅ Constraint wspiera requires_selection');
                    
                } catch (constraintError) {
                    console.log('⚠️ Constraint nie wspiera requires_selection - wykonywanie migracji...');
                    await this.migrateWishlistTable();
                }
            }

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

            // Zaktualizowana tabela znalezionych pozycji z dodatkowymi polami
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
                    match_type TEXT DEFAULT 'name' CHECK (match_type IN ('tmdb_id', 'name', 'mixed')), -- typ dopasowania
                    tmdb_match BOOLEAN DEFAULT 0, -- czy to dokładne dopasowanie TMDB ID
                    auto_downloadable BOOLEAN DEFAULT 0, -- czy można automatycznie pobrać
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (wishlist_id) REFERENCES wishlist(id),
                    FOREIGN KEY (playlist_id) REFERENCES playlists(id)
                )
            `);

            // Dodaj nowe kolumny do istniejącej tabeli jeśli nie istnieją
            try {
                await this.dbRun('ALTER TABLE wishlist_matches ADD COLUMN match_type TEXT DEFAULT "name"');
            } catch (e) { /* kolumna już istnieje */ }

            try {
                await this.dbRun('ALTER TABLE wishlist_matches ADD COLUMN tmdb_match BOOLEAN DEFAULT 0');
            } catch (e) { /* kolumna już istnieje */ }

            try {
                await this.dbRun('ALTER TABLE wishlist_matches ADD COLUMN auto_downloadable BOOLEAN DEFAULT 0');
            } catch (e) { /* kolumna już istnieje */ }

            console.log('✅ Wishlist Manager: baza danych zainicjalizowana');
        } catch (error) {
            console.error('❌ Wishlist Manager: błąd inicjalizacji bazy:', error);
        }
    }

    async migrateWishlistTable() {
        try {
            console.log('🔄 Rozpoczynanie migracji tabeli wishlist...');
            
            // 1. Utwórz tabelę tymczasową z nowym constraint
            await this.dbRun(`
                CREATE TABLE wishlist_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tmdb_id INTEGER NOT NULL,
                    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
                    title TEXT NOT NULL,
                    original_title TEXT,
                    release_date TEXT,
                    poster_path TEXT,
                    overview TEXT,
                    genres TEXT,
                    vote_average REAL,
                    vote_count INTEGER,
                    status TEXT DEFAULT 'wanted' CHECK (status IN ('wanted', 'found', 'downloading', 'completed', 'requires_selection')),
                    priority INTEGER DEFAULT 1 CHECK (priority IN (1, 2, 3, 4, 5)),
                    auto_download BOOLEAN DEFAULT 1,
                    search_keywords TEXT,
                    notes TEXT,
                    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    found_at DATETIME,
                    last_check DATETIME,
                    UNIQUE(tmdb_id, media_type)
                )
            `);
            
            // 2. Skopiuj dane ze starej tabeli
            await this.dbRun(`
                INSERT INTO wishlist_new 
                SELECT * FROM wishlist
            `);
            
            // 3. Usuń starą tabelę
            await this.dbRun('DROP TABLE wishlist');
            
            // 4. Zmień nazwę nowej tabeli
            await this.dbRun('ALTER TABLE wishlist_new RENAME TO wishlist');
            
            console.log('✅ Migracja tabeli wishlist zakończona pomyślnie');
            
        } catch (migrationError) {
            console.error('❌ Błąd migracji tabeli wishlist:', migrationError);
            throw migrationError;
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
                    MAX(wm.created_at) as last_match_date,
                    SUM(CASE WHEN wm.auto_downloadable = 1 THEN 1 ELSE 0 END) as auto_downloadable_count
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

    // === NOWA LOGIKA WYSZUKIWANIA I DOPASOWYWANIA ===

    async checkWishlistMatches() {
        try {
            console.log('🔍 Sprawdzanie wishlisty z nową logiką...');
            
            const wantedItems = await this.dbAll(`
                SELECT * FROM wishlist 
                WHERE status IN ('wanted', 'requires_selection')
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
                    const matches = await this.findMatchesWithNewLogic(item);
                    
                    if (matches.length > 0) {
                        await this.handleFoundMatchesWithNewLogic(item, matches);
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

    async findMatchesWithNewLogic(wishlistItem) {
        try {
            const matches = [];

            // 1. PRIORYTET: Wyszukaj po dokładnym TMDB ID
            const tmdbMatches = await this.findTmdbMatches(wishlistItem);
            
            // 2. DODATKOWO: Wyszukaj po nazwie (tylko jeśli nie ma dokładnych TMDB matches)
            const nameMatches = tmdbMatches.length === 0 ? 
                await this.findNameMatches(wishlistItem) : [];

            // Połącz wyniki i oznacz typ dopasowania
            matches.push(...tmdbMatches.map(match => ({ 
                ...match, 
                match_type: 'tmdb_id', 
                tmdb_match: true,
                auto_downloadable: tmdbMatches.length === 1 // Auto tylko jeśli dokładnie 1 TMDB match
            })));

            matches.push(...nameMatches.map(match => ({ 
                ...match, 
                match_type: 'name', 
                tmdb_match: false,
                auto_downloadable: false // Nazwy nigdy nie są auto-downloadable
            })));

            console.log(`🎯 Znaleziono ${matches.length} matchy dla "${wishlistItem.title}": TMDB=${tmdbMatches.length}, Name=${nameMatches.length}`);

            return matches;

        } catch (error) {
            console.error('Błąd wyszukiwania matchy:', error);
            return [];
        }
    }

    async findTmdbMatches(wishlistItem) {
        try {
            if (!wishlistItem.tmdb_id) {
                return [];
            }

            const streamType = wishlistItem.media_type === 'tv' ? 'series' : 'movie';
            
            // Wyszukaj w bazie mediów po dokładnym TMDB ID
            const matches = await this.dbAll(`
                SELECT 
                    m.*,
                    p.name as playlist_name
                FROM media m
                LEFT JOIN playlists p ON m.playlist_id = p.id
                WHERE m.tmdb_id = ? AND m.stream_type = ?
            `, [wishlistItem.tmdb_id, streamType]);

            console.log(`🔍 TMDB ID ${wishlistItem.tmdb_id}: znaleziono ${matches.length} dokładnych matchy`);

            return matches.map(media => ({
                ...media,
                match_score: 1.0, // Maksymalny score dla dokładnego TMDB match
                match_reason: `Dokładne dopasowanie TMDB ID: ${wishlistItem.tmdb_id}`
            }));

        } catch (error) {
            console.error('Błąd wyszukiwania TMDB matchy:', error);
            return [];
        }
    }

    async findNameMatches(wishlistItem) {
        try {
            const searchTerms = this.generateSearchTerms(wishlistItem);
            const matches = [];
            const streamType = wishlistItem.media_type === 'tv' ? 'series' : 'movie';

            for (const term of searchTerms) {
                // Wyszukaj w bazie mediów po nazwie
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
                    AND (m.tmdb_id IS NULL OR m.tmdb_id != ?)  -- Wyklucz pozycje które już znamy po TMDB
                `, [
                    `%${term}%`,
                    `%${term.replace(/[^\w\s]/g, '')}%`, // bez znaków specjalnych
                    `%${term.split(' ')[0]}%`, // pierwsze słowo
                    streamType,
                    wishlistItem.tmdb_id
                ]);

                for (const media of mediaMatches) {
                    const score = this.calculateMatchScore(wishlistItem, media, term);
                    
                    if (score > 0.6) { // próg dopasowania dla nazw
                        // Sprawdź czy już nie mamy tego matcha
                        const existingMatch = matches.find(m => 
                            m.stream_id === media.stream_id && 
                            m.stream_type === media.stream_type &&
                            m.playlist_id === media.playlist_id
                        );

                        if (!existingMatch) {
                            matches.push({
                                ...media,
                                match_score: score,
                                match_reason: `Dopasowanie nazwy: "${term}" -> "${media.name}" (score: ${score.toFixed(2)})`,
                                search_term: term
                            });
                        }
                    }
                }
            }

            // Sortuj według score i usuń duplikaty
            const uniqueMatches = matches
                .sort((a, b) => b.match_score - a.match_score)
                .slice(0, 10); // max 10 najlepszych matchy

            console.log(`🔍 NAME SEARCH dla "${wishlistItem.title}": znaleziono ${uniqueMatches.length} matchy po nazwie`);

            return uniqueMatches;

        } catch (error) {
            console.error('Błąd wyszukiwania matchy po nazwie:', error);
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

        // Bonus za poprawny rok (jeśli dostępny)
        if (wishlistItem.release_date && media.name.includes(wishlistItem.release_date.substring(0, 4))) {
            score += 0.2;
        }

        return Math.min(score, 1.0);
    }

    async handleFoundMatchesWithNewLogic(wishlistItem, matches) {
        try {
            console.log(`🎯 Obsługa ${matches.length} matchy dla: ${wishlistItem.title}`);

            // Usuń stare matche dla tej pozycji wishlisty
            await this.dbRun('DELETE FROM wishlist_matches WHERE wishlist_id = ?', [wishlistItem.id]);

            // Zapisz wszystkie nowe matche
            for (const match of matches) {
                await this.dbRun(`
                    INSERT INTO wishlist_matches 
                    (wishlist_id, media_stream_id, media_stream_type, playlist_id, 
                     playlist_name, match_score, match_reason, match_type, tmdb_match, auto_downloadable)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    wishlistItem.id,
                    match.stream_id,
                    match.stream_type,
                    match.playlist_id,
                    match.playlist_name,
                    match.match_score,
                    match.match_reason,
                    match.match_type,
                    match.tmdb_match ? 1 : 0,
                    match.auto_downloadable ? 1 : 0
                ]);
            }

            // NOWA LOGIKA STATUSU:
            const autoDownloadableCount = matches.filter(m => m.auto_downloadable).length;
            const totalMatches = matches.length;

            let newStatus = 'found';
            let shouldAutoDownload = false;

            if (totalMatches === 0) {
                // Nie znaleziono nic
                newStatus = 'wanted';
            } else if (autoDownloadableCount === 1) {
                // Dokładnie 1 auto-downloadable match (tylko TMDB exact match)
                newStatus = 'found';
                shouldAutoDownload = wishlistItem.auto_download;
            } else if (totalMatches > 0) {
                // Znaleziono matche, ale wymagają selekcji
                newStatus = 'requires_selection';
                shouldAutoDownload = false;
            }

            // Aktualizuj status
            await this.dbRun(`
                UPDATE wishlist 
                SET status = ?, found_at = ? 
                WHERE id = ?
            `, [newStatus, new Date().toISOString(), wishlistItem.id]);

            // Log
            const bestMatch = matches[0];
            await this.logWishlistAction(
                wishlistItem.id, 
                'SUCCESS', 
                `Status: ${newStatus}, Matche: ${totalMatches} (auto: ${autoDownloadableCount}), Najlepszy: ${bestMatch?.name} (${bestMatch?.match_score?.toFixed(2)})`,
                JSON.stringify({ 
                    matches: totalMatches, 
                    auto_downloadable: autoDownloadableCount,
                    new_status: newStatus,
                    will_auto_download: shouldAutoDownload
                })
            );

            // Auto-download TYLKO jeśli dokładnie 1 auto-downloadable match
            if (shouldAutoDownload && autoDownloadableCount === 1) {
                const autoMatch = matches.find(m => m.auto_downloadable);
                await this.initiateAutoDownload(wishlistItem, autoMatch);
            } else if (newStatus === 'requires_selection') {
                console.log(`⚠️ "${wishlistItem.title}" wymaga ręcznej selekcji (${totalMatches} matchy, ${autoDownloadableCount} auto)`);
                
                // Wyślij powiadomienie o wymaganiu wyboru
                await this.sendSelectionRequiredNotification(wishlistItem, matches);
            }

        } catch (error) {
            console.error('Błąd obsługi znalezionych matchy:', error);
            throw error;
        }
    }

    async sendSelectionRequiredNotification(wishlistItem, matches) {
        try {
            const settings = await this.dbAll('SELECT value FROM settings WHERE key = ?', ['discordWebhook']);
            const webhookUrl = settings[0]?.value;
            
            if (webhookUrl) {
                const topMatches = matches.slice(0, 3);
                let message = `🤔 **Wybór wymagany dla:** ${wishlistItem.title}\n`;
                message += `Znaleziono ${matches.length} matchy, wybierz który pobrać:\n\n`;
                
                topMatches.forEach((match, idx) => {
                    const scorePercent = (match.match_score * 100).toFixed(0);
                    const type = match.match_type === 'tmdb_id' ? '🎯 TMDB' : '📝 Nazwa';
                    message += `${idx + 1}. **${match.name}** (${match.playlist_name})\n`;
                    message += `   ${type} | Score: ${scorePercent}%\n\n`;
                });

                message += `💡 Sprawdź wishlistę w aplikacji aby wybrać właściwą wersję.`;

                await axios.post(webhookUrl, {
                    content: message,
                    username: "Media Center Wishlist - Selection Required"
                });
            }
        } catch (error) {
            console.error('Błąd wysyłania powiadomienia o wyborze:', error);
        }
    }

    async sendWishlistNotification(wishlistItem, match) {
        try {
            const settings = await this.dbAll('SELECT value FROM settings WHERE key = ?', ['discordWebhook']);
            const webhookUrl = settings[0]?.value;
            
            if (webhookUrl) {
                const message = `🎯 **Wishlist Auto-Download!**\n` +
                    `**${wishlistItem.title}** (${wishlistItem.media_type})\n` +
                    `Znaleziono jako: **${match.name}**\n` +
                    `Playlista: ${match.playlist_name}\n` +
                    `Typ: ${match.match_type === 'tmdb_id' ? '🎯 TMDB ID Match' : '📝 Name Match'}\n` +
                    `Score: ${(match.match_score * 100).toFixed(0)}%\n` +
                    `✅ Pobieranie rozpoczęte automatycznie`;

                await axios.post(webhookUrl, {
                    content: message,
                    username: "Media Center Wishlist - Auto Download"
                });
            }
        } catch (error) {
            console.error('Błąd wysyłania powiadomienia wishlist:', error);
        }
    }

    async initiateAutoDownload(wishlistItem, match) {
        try {
            console.log(`⏬ Auto-download: ${wishlistItem.title} -> ${match.name}`);

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
                    `Auto-download filmu: ${filename} z ${match.playlist_name}`
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
                        `Auto-download serialu: ${episodesToDownload.length} odcinków z ${match.playlist_name}`
                    );
                }
            }

            // Wyślij powiadomienie Discord o auto-download
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
                    SUM(CASE WHEN status = 'requires_selection' THEN 1 ELSE 0 END) as requires_selection,
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