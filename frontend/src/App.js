import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './index.css';

// --- Funkcja pomocnicza do tworzenia URL-a do proxy obrazków ---
const imageProxy = (url) => {
    if (!url) return 'https://placehold.co/400x600/1f2937/ffffff?text=Brak+Obrazka';
    return `/api/image-proxy?url=${encodeURIComponent(url)}`;
};

// --- Komponent Paginacji ---
const Pagination = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;
    return (
        <div className="flex justify-center items-center mt-10 space-x-4">
            <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="px-4 py-2 rounded-md border border-gray-700 bg-gray-800 text-sm font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">Poprzednia</button>
            <span className="text-gray-400">Strona {currentPage} z {totalPages}</span>
            <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-4 py-2 rounded-md border border-gray-700 bg-gray-800 text-sm font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">Następna</button>
        </div>
    );
};

// --- Komponent Karta Mediów ---
const MediaCard = ({ item, isFavorite, onToggleFavorite }) => (
  <div className="card bg-gray-800 rounded-lg overflow-hidden shadow-lg relative group">
    <a href={`#/details/${item.stream_type}/${item.stream_id}`} className="absolute inset-0 z-0">
        <span className="sr-only">Zobacz szczegóły {item.name}</span>
    </a>
    <button 
      onClick={(e) => {
        e.stopPropagation(); // Zapobiegaj nawigacji do szczegółów
        onToggleFavorite(item);
      }}
      className={`absolute top-2 right-2 p-2 rounded-full z-10 transition-all duration-200 transform hover:scale-125 ${isFavorite ? 'text-red-500 bg-gray-900/70' : 'text-gray-300 bg-gray-900/70 hover:text-red-500'}`}
    >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
        </svg>
    </button>
    <img 
      src={imageProxy(item.stream_icon)} 
      alt={`Okładka ${item.name}`} 
      className="w-full h-auto object-cover aspect-[2/3]"
      onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/400x600/1f2937/ffffff?text=Brak+Obrazka'; }}
    />
    <div className="p-3">
      <h3 className="font-bold text-md truncate text-white">{item.name}</h3>
      <p className="text-xs text-gray-400 capitalize">{item.stream_type === 'movie' ? 'Film' : 'Serial'}</p>
    </div>
  </div>
);

// --- Komponent Widgetu Pobierania ---
const DownloadWidget = ({ downloads, onRemove, onClose, isOpen }) => {
    if (!isOpen || downloads.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 w-80 bg-gray-800 rounded-lg shadow-2xl border border-gray-700 z-50">
            <div className="p-4">
                <div className="flex justify-between items-center mb-3">
                    <h4 className="font-bold text-lg text-white">Aktywne Pobierania</h4>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">&times;</button>
                </div>
                <ul className="space-y-3 text-sm max-h-64 overflow-y-auto">
                    {downloads.map(d => (
                        <li key={d.id}>
                            <div className="flex justify-between items-center mb-1">
                                <span className="truncate text-gray-300">{d.filename}</span>
                                <div className="flex items-center gap-2">
                                    <span className={`font-semibold ${d.status === 'failed' ? 'text-red-400' : 'text-gray-400'}`}>
                                        {d.status === 'downloading' && 'Pobieranie...'}
                                        {d.status === 'completed' && 'Gotowe'}
                                        {d.status === 'queued' && 'W kolejce'}
                                        {d.status === 'failed' && 'Błąd'}
                                    </span>
                                    <button onClick={() => onRemove(d.id)} className="text-gray-500 hover:text-white">&times;</button>
                                </div>
                            </div>
                            {d.status === 'downloading' && (
                                <div className="w-full bg-gray-600 rounded-full h-2 animate-pulse">
                                    <div className="bg-blue-500 h-2 rounded-full"></div>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

// --- Komponent Widoku Szczegółów ---
const DetailsView = ({ type, id, favorites, onToggleFavorite, onDownload }) => {
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const isFavorite = favorites.has(`${id}_${type}`);

    useEffect(() => {
        const fetchDetails = async () => {
            if (!type || !id) return;
            setLoading(true);
            setError(null);
            try {
                const response = await axios.get(`/api/media/details/${type}/${id}`);
                setDetails(response.data);
            } catch (err) {
                setError('Nie udało się pobrać szczegółów.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchDetails();
    }, [type, id]);
    
    const handleDownloadMovie = () => {
        const tmdb = details?.tmdb_details;
        const xtreamInfo = details?.xtream_details?.info;
        const title = tmdb?.title || tmdb?.name || xtreamInfo?.name || details.name;
        const filename = title.replace(/[^\w\s.-]/gi, '').trim();
        onDownload(details.stream_id, 'movie', [{ id: details.stream_id, filename }]);
    };
    
    const handleDownloadEpisode = (episode) => {
        const tmdb = details?.tmdb_details;
        const xtreamInfo = details?.xtream_details?.info;
        const title = tmdb?.title || tmdb?.name || xtreamInfo?.name || details.name;
        const filename = `${title.replace(/[^\w\s.-]/gi, '').trim()} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode_num).padStart(2, '0')}`;
        onDownload(details.stream_id, 'series', [{ id: episode.id, filename }]);
    };

    const handleDownloadSeason = (seasonNum) => {
        const tmdb = details?.tmdb_details;
        const xtreamInfo = details?.xtream_details?.info;
        const title = tmdb?.title || tmdb?.name || xtreamInfo?.name || details.name;
        const episodesToDownload = details.xtream_details.episodes[seasonNum].map(ep => ({
            id: ep.id,
            filename: `${title.replace(/[^\w\s.-]/gi, '').trim()} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`
        }));
        onDownload(details.stream_id, 'series', episodesToDownload);
    };

    if (loading) return <p className="text-center text-gray-400">Ładowanie szczegółów...</p>;
    if (error) return <p className="text-center text-red-400">{error}</p>;
    if (!details) return null;

    const tmdb = details?.tmdb_details;
    const xtreamInfo = details?.xtream_details?.info;
    const trailer = tmdb?.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    const releaseYear = (tmdb?.release_date || tmdb?.first_air_date || xtreamInfo?.releasedate)?.substring(0, 4) || '';
    const plot = tmdb?.overview || xtreamInfo?.plot || 'Brak opisu.';
    const genres = tmdb?.genres?.map(g => g.name).join(', ') || xtreamInfo?.genre || '';

    return (
        <div>
            <button onClick={() => window.history.back()} className="mb-6 inline-block bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300 no-underline">
                &larr; Powrót
            </button>

            <div className="flex flex-col md:flex-row gap-8">
                <div className="md:w-1/3 lg:w-1/4 flex-shrink-0">
                    <img src={imageProxy(details.stream_icon)} alt={`Okładka ${details.name}`} className="rounded-lg shadow-lg w-full" />
                </div>
                <div className="md:w-2/3 lg:w-3/4">
                    <h2 className="text-4xl font-bold">{tmdb?.title || tmdb?.name || details.name}</h2>
                    <div className="flex items-center my-2 text-lg text-gray-400 flex-wrap">
                        {releaseYear && <span>{releaseYear}</span>}
                        {genres && <span className="mx-2">&bull;</span>}
                        <span>{genres}</span>
                    </div>
                    <p className="text-gray-300 mt-4">{plot}</p>
                    <div className="flex items-center gap-4 mt-6">
                        <button onClick={() => onToggleFavorite(details)} className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors ${isFavorite ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-600 hover:bg-gray-500 text-gray-200'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                            </svg>
                            {isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
                        </button>
                        {details.stream_type === 'movie' && (
                            <button onClick={handleDownloadMovie} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors">
                                Pobierz Film
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {trailer && (
                <div className="mt-8">
                    <h3 className="text-2xl font-bold mb-4">Zwiastun</h3>
                    <div className="aspect-w-16 aspect-h-9">
                        <iframe 
                            src={`https://www.youtube.com/embed/${trailer.key}`} 
                            title="YouTube video player" 
                            frameBorder="0" 
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                            allowFullScreen
                            className="w-full h-full rounded-lg"
                            style={{minHeight: '400px'}}>
                        </iframe>
                    </div>
                </div>
            )}

            {details.stream_type === 'series' && details.xtream_details?.episodes && (
                <div className="mt-8">
                    <h3 className="text-2xl font-bold mb-4">Odcinki</h3>
                    {Object.entries(details.xtream_details.episodes).map(([seasonNum, episodes]) => (
                        <div key={seasonNum} className="mb-6">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="text-xl font-semibold">Sezon {seasonNum}</h4>
                                <button onClick={() => handleDownloadSeason(seasonNum)} className="px-3 py-1 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors">
                                    Pobierz Sezon
                                </button>
                            </div>
                            <ul className="space-y-2">
                                {episodes.map(ep => (
                                    <li key={ep.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
                                        <span>{ep.episode_num}. {ep.title}</span>
                                        <button onClick={() => handleDownloadEpisode(ep)} className="px-3 py-1 rounded-lg text-xs font-semibold bg-gray-600 hover:bg-gray-500 text-white transition-colors">
                                            Pobierz
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};


// --- Komponent Widoku Głównego ---
const HomeView = ({ queryParams, onNavigate, favorites, onToggleFavorite }) => {
    const [mediaData, setMediaData] = useState({ items: [], totalPages: 1, totalItems: 0 });
    const [genres, setGenres] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState(queryParams.search || '');

    useEffect(() => {
        const timerId = setTimeout(() => {
            if (searchTerm !== queryParams.search) {
                onNavigate({ ...queryParams, search: searchTerm, page: 1 });
            }
        }, 500);
        return () => clearTimeout(timerId);
    }, [searchTerm, queryParams, onNavigate]);

    useEffect(() => {
        const fetchGenres = async () => {
            try {
                const response = await axios.get('/api/genres');
                setGenres(response.data);
            } catch (err) { console.error("Nie udało się pobrać gatunków", err); }
        };
        fetchGenres();
    }, []);

    useEffect(() => {
        const fetchMedia = async () => {
            setLoading(true);
            setError(null);
            try {
                const params = { 
                    page: queryParams.page || 1, 
                    limit: 30, 
                    genre: queryParams.genre || 'all', 
                    search: queryParams.search || '',
                    filter: queryParams.filter || ''
                };
                const response = await axios.get('/api/media', { params });
                setMediaData(response.data);
            } catch (err) {
                setError('Nie udało się pobrać listy mediów.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchMedia();
    }, [queryParams]);

    const handleGenreChange = (e) => {
        onNavigate({ ...queryParams, genre: e.target.value, page: 1 });
    };

    const handlePageChange = (newPage) => {
        onNavigate({ ...queryParams, page: newPage });
    };

    const handleFilterChange = (newFilter) => {
        onNavigate({ ...queryParams, filter: newFilter, page: 1 });
    };

    return (
        <div>
            <div className="mb-8 p-4 bg-gray-800 rounded-lg shadow-lg">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-2">
                        <label htmlFor="search" className="block text-sm font-medium text-gray-300 mb-1">Wyszukaj tytuł</label>
                        <input type="text" id="search" placeholder="np. The Boys..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500"/>
                    </div>
                    <div>
                        <label htmlFor="genreFilter" className="block text-sm font-medium text-gray-300 mb-1">Gatunek</label>
                        <select id="genreFilter" value={queryParams.genre || 'all'} onChange={handleGenreChange} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                            <option value="all">Wszystkie gatunki</option>
                            {genres.map(genre => <option key={genre.id} value={genre.id}>{genre.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Pokaż</label>
                        <div className="flex gap-2">
                            <button onClick={() => handleFilterChange('')} className={`flex-1 p-2 rounded-md text-sm ${!queryParams.filter ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'}`}>Wszystko</button>
                            <button onClick={() => handleFilterChange('favorites')} className={`flex-1 p-2 rounded-md text-sm ${queryParams.filter === 'favorites' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'}`}>Ulubione</button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-white border-l-4 border-red-500 pl-4">Twoje Media</h2>
                <span className="text-gray-400">Znaleziono: {mediaData.totalItems}</span>
            </div>
            {loading ? <p className="text-center text-gray-400">Ładowanie...</p> : error ? <p className="text-center text-red-400">{error}</p> : mediaData.items.length > 0 ? (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                        {mediaData.items.map(item => <MediaCard key={`${item.stream_id}-${item.stream_type}`} item={item} isFavorite={favorites.has(`${item.stream_id}_${item.stream_type}`)} onToggleFavorite={onToggleFavorite} />)}
                    </div>
                    <Pagination currentPage={mediaData.currentPage} totalPages={mediaData.totalPages} onPageChange={handlePageChange} />
                </>
            ) : <p className="text-center text-gray-400 bg-gray-800 p-8 rounded-lg">Brak wyników dla podanych kryteriów.</p>}
        </div>
    );
};

// --- Komponent Ustawień ---
const SettingsView = () => {
    const [settings, setSettings] = useState({ serverUrl: '', username: '', password: '', tmdbApi: '', discordWebhook: '', checkFrequency: '12' });
    const [message, setMessage] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await axios.get('/api/settings');
                if (response.data) { setSettings(prev => ({ ...prev, ...response.data })); }
            } catch (error) { console.error('Nie udało się pobrać ustawień:', error); }
        };
        fetchSettings();
    }, []);
    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings(prevSettings => ({ ...prevSettings, [name]: value }));
    };
    const handleSave = async (e) => {
        e.preventDefault();
        setMessage('');
        try {
            await axios.post('/api/settings', settings);
            setMessage('Ustawienia zostały pomyślnie zapisane!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            setMessage('Błąd podczas zapisu ustawień.');
            console.error('Błąd zapisu:', error);
        }
    };
    const handleRefresh = async () => {
        setMessage('');
        setIsRefreshing(true);
        try {
            const response = await axios.post('/api/media/refresh');
            setMessage(response.data.message || 'Lista mediów została odświeżona.');
        } catch (error) {
            setMessage(error.response?.data?.error || 'Wystąpił błąd podczas odświeżania.');
        } finally {
            setIsRefreshing(false);
            setTimeout(() => setMessage(''), 5000);
        }
    };
    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-white border-l-4 border-red-500 pl-4">Ustawienia Aplikacji</h2>
            <div className="max-w-2xl mx-auto bg-gray-800 p-8 rounded-lg shadow-2xl">
                <form onSubmit={handleSave} className="space-y-6">
                    <div className="p-4 border border-gray-700 rounded-lg">
                        <h3 className="text-lg font-semibold mb-3 text-white">Dane logowania Xtream</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="serverUrl" className="block text-sm font-medium text-gray-300">Server URL</label>
                                <input type="text" id="serverUrl" name="serverUrl" value={settings.serverUrl || ''} onChange={handleChange} className="mt-1 w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="http://line.example.com:80"/>
                            </div>
                            <div>
                                <label htmlFor="username" className="block text-sm font-medium text-gray-300">Username</label>
                                <input type="text" id="username" name="username" value={settings.username || ''} onChange={handleChange} className="mt-1 w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="twoja_nazwa_uzytkownika"/>
                            </div>
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-300">Password</label>
                                <input type="password" id="password" name="password" value={settings.password || ''} onChange={handleChange} className="mt-1 w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="••••••••"/>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="tmdbApi" className="block text-sm font-medium text-gray-300">Klucz API do TMDB</label>
                        <input type="password" id="tmdbApi" name="tmdbApi" value={settings.tmdbApi || ''} onChange={handleChange} className="mt-1 w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="••••••••••••••••••••••••••••••••"/>
                    </div>
                    <div>
                        <label htmlFor="discordWebhook" className="block text-sm font-medium text-gray-300">Webhook Discord</label>
                        <input type="text" id="discordWebhook" name="discordWebhook" value={settings.discordWebhook || ''} onChange={handleChange} className="mt-1 w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="https://discord.com/api/webhooks/..."/>
                    </div>
                    <div>
                        <label htmlFor="checkFrequency" className="block text-sm font-medium text-gray-300">Częstotliwość sprawdzania nowości (w godzinach)</label>
                        <select id="checkFrequency" name="checkFrequency" value={settings.checkFrequency} onChange={handleChange} className="mt-1 w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                            <option value="1">Co godzinę</option><option value="6">Co 6 godzin</option><option value="12">Co 12 godzin</option><option value="24">Raz dziennie</option>
                        </select>
                    </div>
                    <div className="pt-4 space-y-4">
                        <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300">Zapisz Ustawienia</button>
                        <button type="button" onClick={handleRefresh} disabled={isRefreshing} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300 disabled:bg-blue-800 disabled:cursor-not-allowed">{isRefreshing ? 'Odświeżanie...' : 'Wymuś odświeżenie listy mediów'}</button>
                        {message && <p className={`text-center mt-4 ${message.includes('Błąd') || message.includes('błąd') ? 'text-red-400' : 'text-green-400'}`}>{message}</p>}
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Główny Komponent Aplikacji ---
function App() {
  const [route, setRoute] = useState({ path: 'home', params: {} });
  const [favorites, setFavorites] = useState(new Set());
  const [downloads, setDownloads] = useState([]);
  const [isWidgetOpen, setIsWidgetOpen] = useState(true);

  // Pobieranie ulubionych
  useEffect(() => {
    const fetchFavorites = async () => {
        try {
            const response = await axios.get('/api/favorites');
            const favoriteSet = new Set(response.data.map(fav => `${fav.stream_id}_${fav.stream_type}`));
            setFavorites(favoriteSet);
        } catch (error) {
            console.error("Nie udało się pobrać ulubionych", error);
        }
    };
    fetchFavorites();
  }, []);

  // Pobieranie statusu pobierania
  useEffect(() => {
    const fetchStatus = async () => {
        try {
            const response = await axios.get('/api/downloads/status');
            setDownloads(response.data);
        } catch (error) {
            console.error("Nie udało się pobrać statusu pobierania", error);
        }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleFavorite = async (item) => {
    const key = `${item.stream_id}_${item.stream_type}`;
    const newFavorites = new Set(favorites);
    
    try {
        if (newFavorites.has(key)) {
            newFavorites.delete(key);
        } else {
            newFavorites.add(key);
        }
        setFavorites(newFavorites); // Optymistyczna aktualizacja UI
        
        await axios.post('/api/favorites/toggle', {
            stream_id: item.stream_id,
            stream_type: item.stream_type
        });
    } catch (error) {
        console.error("Błąd podczas zmiany statusu ulubionych", error);
        // Wycofaj zmianę w UI w razie błędu
        setFavorites(favorites);
    }
  };
  
  const handleDownload = async (stream_id, stream_type, episodes) => {
    try {
        await axios.post('/api/downloads/start', { stream_id, stream_type, episodes });
        setIsWidgetOpen(true); // Otwórz widget po dodaniu nowego pobierania
    } catch (error) {
        console.error("Błąd podczas rozpoczynania pobierania", error);
    }
  };

  const handleRemoveDownload = async (id) => {
    try {
        await axios.post(`/api/downloads/remove/${id}`);
        setDownloads(prev => prev.filter(d => d.id !== id));
    } catch (error) {
        console.error("Błąd podczas usuwania zadania", error);
    }
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      const [path, ...params] = hash.split('?');
      const queryParams = new URLSearchParams(params.join('?'));
      
      const pathParts = path.split('/');
      const mainPath = pathParts[0] || 'home';
      
      setRoute({ 
          path: mainPath, 
          params: {
              type: pathParts[1],
              id: pathParts[2],
              search: queryParams.get('search') || '',
              genre: queryParams.get('genre') || 'all',
              page: parseInt(queryParams.get('page') || '1', 10),
              filter: queryParams.get('filter') || ''
          } 
      });
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleNavigate = (newParams) => {
    const query = new URLSearchParams();
    if (newParams.search) query.set('search', newParams.search);
    if (newParams.genre && newParams.genre !== 'all') query.set('genre', newParams.genre);
    if (newParams.page && newParams.page > 1) query.set('page', newParams.page);
    if (newParams.filter) query.set('filter', newParams.filter);
    
    const queryString = query.toString();
    window.location.hash = `#home${queryString ? `?${queryString}` : ''}`;
  };

  const renderContent = () => {
    switch (route.path) {
        case 'settings':
            return <SettingsView />;
        case 'details':
            return <DetailsView type={route.params.type} id={route.params.id} favorites={favorites} onToggleFavorite={handleToggleFavorite} onDownload={handleDownload} />;
        case 'home':
        default:
            return <HomeView queryParams={route.params} onNavigate={handleNavigate} favorites={favorites} onToggleFavorite={handleToggleFavorite} />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <header className="bg-gray-900/80 backdrop-blur-sm shadow-lg sticky top-0 z-50">
        <nav className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="#/home" className="text-2xl font-bold text-white no-underline"><span className="text-red-500">M</span>ediaCenter</a>
            <div className="flex items-center space-x-4">
              <button onClick={() => setIsWidgetOpen(!isWidgetOpen)} className="text-gray-300 hover:text-white">Pobierane</button>
              <a href="#/home" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium no-underline">Strona Główna</a>
              <a href="#/settings" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium no-underline">Ustawienia</a>
            </div>
          </div>
        </nav>
      </header>
      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        {renderContent()}
      </main>
      <DownloadWidget downloads={downloads} onRemove={handleRemoveDownload} onClose={() => setIsWidgetOpen(false)} isOpen={isWidgetOpen} />
    </div>
  );
}

export default App;
