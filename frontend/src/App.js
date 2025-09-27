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

// === KOMPONENTY PLAYLIST MANAGER ===

const PlaylistCard = ({ playlist, onEdit, onDelete, onToggle, onSync, syncing = false }) => { // NOWE: prop syncing
    const [isExpanded, setIsExpanded] = useState(false);
    
    return (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            {/* Header z nazwą i statusem */}
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-white">{playlist.name}</h3>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                        playlist.is_active 
                            ? 'bg-green-900/50 text-green-300 border border-green-700' 
                            : 'bg-gray-900/50 text-gray-400 border border-gray-700'
                    }`}>
                        {playlist.is_active ? '🟢 Aktywna' : '⚪ Nieaktywna'}
                    </div>
                    {/* NOWY: Wskaźnik synchronizacji */}
                    {syncing && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-purple-900/50 text-purple-300 rounded text-xs">
                            <div className="animate-spin rounded-full h-3 w-3 border-b border-purple-300"></div>
                            Sync...
                        </div>
                    )}
                </div>
                
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-gray-400 hover:text-white transition-colors"
                        title="Pokaż szczegóły"
                    >
                        {isExpanded ? '▲' : '▼'}
                    </button>
                </div>
            </div>
            
            {/* Statystyki */}
            <div className="grid grid-cols-3 gap-4 mb-3 text-sm">
                <div className="text-center">
                    <div className="text-2xl font-bold text-blue-400">{playlist.media_count || 0}</div>
                    <div className="text-gray-400">Media</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-red-400">{playlist.favorites_count || 0}</div>
                    <div className="text-gray-400">Ulubione</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-gray-400">
                        {playlist.last_sync ? new Date(playlist.last_sync).toLocaleDateString() : 'Nigdy'}
                    </div>
                    <div className="text-gray-400">Ostatni sync</div>
                </div>
            </div>
            
            {/* Rozwinięte szczegóły */}
            {isExpanded && (
                <div className="bg-gray-900/50 rounded p-3 mb-3 text-sm">
                    <div className="grid grid-cols-1 gap-2">
                        <div><strong>Server:</strong> {playlist.server_url}</div>
                        <div><strong>Username:</strong> {playlist.username}</div>
                        <div><strong>Utworzona:</strong> {new Date(playlist.created_at).toLocaleString()}</div>
                        {playlist.last_sync && (
                            <div><strong>Ostatnia synchronizacja:</strong> {new Date(playlist.last_sync).toLocaleString()}</div>
                        )}
                    </div>
                </div>
            )}
            
            {/* Akcje */}
            <div className="flex gap-2">
                <button
                    onClick={() => onToggle(playlist.id)}
                    disabled={syncing}
                    className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        playlist.is_active 
                            ? 'bg-gray-600 hover:bg-gray-700 text-gray-200' 
                            : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                >
                    {playlist.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                </button>
                
                <button
                    onClick={() => onSync(playlist.id)}
                    disabled={syncing || !playlist.is_active}
                    className="px-3 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-1"
                    title={!playlist.is_active ? 'Tylko aktywne playlisty można synchronizować' : 'Synchronizuj playlistę'}
                >
                    {syncing ? (
                        <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b border-white"></div>
                            Sync
                        </>
                    ) : (
                        <>🔄 Sync</>
                    )}
                </button>
                
                <button
                    onClick={() => onEdit(playlist)}
                    disabled={syncing}
                    className="px-3 py-2 rounded text-sm font-medium bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-800 disabled:cursor-not-allowed text-white transition-colors"
                >
                    ✏️ Edytuj
                </button>
                <button
    onClick={() => onEditFilters(playlist)}
    disabled={syncing}
    className="px-3 py-2 rounded text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white transition-colors"
>
    🎛️ Filtry
</button>
                <button
                    onClick={() => onDelete(playlist.id, playlist.name)}
                    disabled={playlist.media_count > 0 || syncing}
                    className="px-3 py-2 rounded text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white transition-colors"
                    title={playlist.media_count > 0 ? 'Nie można usunąć playlisty z mediami' : 'Usuń playlistę'}
                >
                    🗑️
                </button>
            </div>
        </div>
    );
};

const PlaylistForm = ({ playlist, onSave, onCancel, isEditing = false }) => {
    const [formData, setFormData] = useState({
        name: playlist?.name || '',
        server_url: playlist?.server_url || '',
        username: playlist?.username || '',
        password: playlist?.password || '',
        is_active: playlist?.is_active ?? true
    });
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
        // Usuń błąd dla tego pola
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: null }));
        }
    };

    const validateForm = () => {
        const newErrors = {};
        if (!formData.name.trim()) newErrors.name = 'Nazwa jest wymagana';
        if (!formData.server_url.trim()) newErrors.server_url = 'URL serwera jest wymagany';
        if (!formData.username.trim()) newErrors.username = 'Username jest wymagany';
        if (!formData.password.trim()) newErrors.password = 'Password jest wymagane';
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateForm()) return;
        
        setLoading(true);
        try {
            await onSave(formData);
        } catch (error) {
            console.error('Błąd zapisywania playlisty:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-bold text-white mb-4">
                {isEditing ? 'Edytuj Playlistę' : 'Dodaj Nową Playlistę'}
            </h3>
            
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                        Nazwa playlisty
                    </label>
                    <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        className={`w-full bg-gray-700 border rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500 ${
                            errors.name ? 'border-red-500' : 'border-gray-600'
                        }`}
                        placeholder="np. Netflix PL, HBO Max"
                    />
                    {errors.name && <p className="text-red-400 text-sm mt-1">{errors.name}</p>}
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                        URL serwera
                    </label>
                    <input
                        type="text"
                        name="server_url"
                        value={formData.server_url}
                        onChange={handleChange}
                        className={`w-full bg-gray-700 border rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500 ${
                            errors.server_url ? 'border-red-500' : 'border-gray-600'
                        }`}
                        placeholder="http://example.com:80"
                    />
                    {errors.server_url && <p className="text-red-400 text-sm mt-1">{errors.server_url}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Username
                        </label>
                        <input
                            type="text"
                            name="username"
                            value={formData.username}
                            onChange={handleChange}
                            className={`w-full bg-gray-700 border rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500 ${
                                errors.username ? 'border-red-500' : 'border-gray-600'
                            }`}
                            placeholder="username"
                        />
                        {errors.username && <p className="text-red-400 text-sm mt-1">{errors.username}</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Password
                        </label>
                        <input
                            type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            className={`w-full bg-gray-700 border rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500 ${
                                errors.password ? 'border-red-500' : 'border-gray-600'
                            }`}
                            placeholder="••••••••"
                        />
                        {errors.password && <p className="text-red-400 text-sm mt-1">{errors.password}</p>}
                    </div>
                </div>

                <div className="flex items-center">
                    <input
                        type="checkbox"
                        name="is_active"
                        id="is_active"
                        checked={formData.is_active}
                        onChange={handleChange}
                        className="w-4 h-4 text-red-600 bg-gray-700 border-gray-600 rounded focus:ring-red-500"
                    />
                    <label htmlFor="is_active" className="ml-2 text-sm text-gray-300">
                        Playlista aktywna (będzie synchronizowana automatycznie)
                    </label>
                </div>

                <div className="flex gap-3 pt-4">
                    <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-red-800 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Zapisywanie...' : (isEditing ? 'Zapisz Zmiany' : 'Dodaj Playlistę')}
                    </button>
                    
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white font-bold rounded-lg transition duration-300"
                    >
                        Anuluj
                    </button>
                </div>
            </form>
        </div>
    );
};

const FilterEditor = ({ playlist, onSave, onCancel }) => {
    const [loading, setLoading] = useState(true);
    const [categories, setCategories] = useState({ movies: [], series: [] });
    const [languages, setLanguages] = useState([]);
    const [selectedCategories, setSelectedCategories] = useState({
        movies: [],
        series: []
    });
    const [selectedLanguages, setSelectedLanguages] = useState([]);

    useEffect(() => {
        const fetchFilters = async () => {
            setLoading(true);
            try {
                // Pobierz kategorie i języki
                const [categoriesRes, languagesRes] = await Promise.all([
                    axios.get(`/api/playlists/${playlist.id}/categories`),
                    axios.get(`/api/playlists/${playlist.id}/languages`)
                ]);

                setCategories(categoriesRes.data);
                setLanguages(languagesRes.data);

                // Załaduj obecne filtry
                if (playlist.category_filters) {
                    try {
                        setSelectedCategories(JSON.parse(playlist.category_filters));
                    } catch (e) {
                        console.error('Błąd parsowania category_filters:', e);
                    }
                }

                if (playlist.language_filters) {
                    try {
                        setSelectedLanguages(JSON.parse(playlist.language_filters));
                    } catch (e) {
                        console.error('Błąd parsowania language_filters:', e);
                    }
                }
            } catch (error) {
                console.error('Błąd ładowania filtrów:', error);
            } finally {
                setLoading(false);
            }
        };

        if (playlist?.id) {
            fetchFilters();
        }
    }, [playlist]);

    const handleCategoryToggle = (type, categoryId) => {
        setSelectedCategories(prev => {
            const current = prev[type] || [];
            const updated = current.includes(categoryId)
                ? current.filter(id => id !== categoryId)
                : [...current, categoryId];
            
            return { ...prev, [type]: updated };
        });
    };

    const handleSelectAllCategories = (type) => {
        const allIds = categories[type].map(cat => cat.category_id.toString());
        setSelectedCategories(prev => ({ ...prev, [type]: allIds }));
    };

    const handleDeselectAllCategories = (type) => {
        setSelectedCategories(prev => ({ ...prev, [type]: [] }));
    };

    const handleLanguageToggle = (langCode) => {
        setSelectedLanguages(prev => 
            prev.includes(langCode)
                ? prev.filter(code => code !== langCode)
                : [...prev, langCode]
        );
    };

    const handleSelectAllLanguages = () => {
        setSelectedLanguages(languages.map(lang => lang.code));
    };

    const handleDeselectAllLanguages = () => {
        setSelectedLanguages([]);
    };

    const handleSave = async () => {
        try {
            await onSave({
                category_filters: JSON.stringify(selectedCategories),
                language_filters: JSON.stringify(selectedLanguages)
            });
        } catch (error) {
            console.error('Błąd zapisywania filtrów:', error);
        }
    };

    if (loading) {
        return (
            <div className="bg-gray-800 rounded-lg p-6">
                <div className="text-center text-gray-400">Ładowanie filtrów...</div>
            </div>
        );
    }

    const movieCategoriesCount = selectedCategories.movies?.length || 0;
    const seriesCategoriesCount = selectedCategories.series?.length || 0;
    const languagesCount = selectedLanguages.length;

    return (
        <div className="bg-gray-800 rounded-lg p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">
                    Filtry synchronizacji: {playlist.name}
                </h3>
                <div className="text-sm text-gray-400">
                    📊 Filmy: {movieCategoriesCount} | Seriale: {seriesCategoriesCount} | Języki: {languagesCount}
                </div>
            </div>

            {/* Filtry języków */}
            <div className="bg-gray-900/50 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                    <h4 className="font-semibold text-white">🌐 Filtry językowe</h4>
                    <div className="flex gap-2">
                        <button
                            onClick={handleSelectAllLanguages}
                            className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded"
                        >
                            Zaznacz wszystkie
                        </button>
                        <button
                            onClick={handleDeselectAllLanguages}
                            className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                        >
                            Odznacz wszystkie
                        </button>
                    </div>
                </div>

                {languages.length === 0 ? (
                    <p className="text-sm text-gray-400">Nie wykryto prefiksów językowych w tej playliście</p>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {languages.map(lang => (
                            <label
                                key={lang.code}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                    selectedLanguages.includes(lang.code)
                                        ? 'bg-blue-900/50 border border-blue-600'
                                        : 'bg-gray-700/50 hover:bg-gray-700'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedLanguages.includes(lang.code)}
                                    onChange={() => handleLanguageToggle(lang.code)}
                                    className="w-4 h-4"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-white">{lang.code}</div>
                                    <div className="text-xs text-gray-400 truncate">{lang.name}</div>
                                </div>
                            </label>
                        ))}
                    </div>
                )}

                {selectedLanguages.length === 0 && (
                    <div className="mt-2 text-xs text-yellow-400">
                        ⚠️ Nie wybrano żadnego języka - zostaną synchronizowane wszystkie pozycje
                    </div>
                )}
            </div>

            {/* Kategorie filmów */}
            <div className="bg-gray-900/50 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                    <h4 className="font-semibold text-white">🎬 Kategorie filmów</h4>
                    <div className="flex gap-2">
                        <button
                            onClick={() => handleSelectAllCategories('movies')}
                            className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded"
                        >
                            Zaznacz wszystkie
                        </button>
                        <button
                            onClick={() => handleDeselectAllCategories('movies')}
                            className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                        >
                            Odznacz wszystkie
                        </button>
                    </div>
                </div>

                {categories.movies.length === 0 ? (
                    <p className="text-sm text-gray-400">Brak kategorii filmów</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {categories.movies.map(cat => (
                            <label
                                key={cat.category_id}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                    selectedCategories.movies?.includes(cat.category_id.toString())
                                        ? 'bg-blue-900/50 border border-blue-600'
                                        : 'bg-gray-700/50 hover:bg-gray-700'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedCategories.movies?.includes(cat.category_id.toString())}
                                    onChange={() => handleCategoryToggle('movies', cat.category_id.toString())}
                                    className="w-4 h-4"
                                />
                                <span className="text-sm text-white">{cat.category_name}</span>
                            </label>
                        ))}
                    </div>
                )}

                {(!selectedCategories.movies || selectedCategories.movies.length === 0) && (
                    <div className="mt-2 text-xs text-yellow-400">
                        ⚠️ Nie wybrano kategorii - zostaną synchronizowane wszystkie filmy
                    </div>
                )}
            </div>

            {/* Kategorie seriali */}
            <div className="bg-gray-900/50 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                    <h4 className="font-semibold text-white">📺 Kategorie seriali</h4>
                    <div className="flex gap-2">
                        <button
                            onClick={() => handleSelectAllCategories('series')}
                            className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded"
                        >
                            Zaznacz wszystkie
                        </button>
                        <button
                            onClick={() => handleDeselectAllCategories('series')}
                            className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                        >
                            Odznacz wszystkie
                        </button>
                    </div>
                </div>

                {categories.series.length === 0 ? (
                    <p className="text-sm text-gray-400">Brak kategorii seriali</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {categories.series.map(cat => (
                            <label
                                key={cat.category_id}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                    selectedCategories.series?.includes(cat.category_id.toString())
                                        ? 'bg-blue-900/50 border border-blue-600'
                                        : 'bg-gray-700/50 hover:bg-gray-700'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedCategories.series?.includes(cat.category_id.toString())}
                                    onChange={() => handleCategoryToggle('series', cat.category_id.toString())}
                                    className="w-4 h-4"
                                />
                                <span className="text-sm text-white">{cat.category_name}</span>
                            </label>
                        ))}
                    </div>
                )}

                {(!selectedCategories.series || selectedCategories.series.length === 0) && (
                    <div className="mt-2 text-xs text-yellow-400">
                        ⚠️ Nie wybrano kategorii - zostaną synchronizowane wszystkie seriale
                    </div>
                )}
            </div>

            {/* Przyciski akcji */}
            <div className="flex gap-3 pt-4">
                <button
                    onClick={handleSave}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
                >
                    Zapisz Filtry
                </button>
                
                <button
                    onClick={onCancel}
                    className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white font-bold rounded-lg transition duration-300"
                >
                    Anuluj
                </button>
            </div>
        </div>
    );
};

const PlaylistManager = () => {
    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingPlaylist, setEditingPlaylist] = useState(null);
    const [message, setMessage] = useState('');
    const [overview, setOverview] = useState(null);
    const [syncing, setSyncing] = useState({ all: false, single: {} }); // NOWE: Stan synchronizacji
    const [showFilterEditor, setShowFilterEditor] = useState(false);
const [editingPlaylistForFilters, setEditingPlaylistForFilters] = useState(null);

const handleEditFilters = (playlist) => {
    setEditingPlaylistForFilters(playlist);
    setShowFilterEditor(true);
};

const handleSaveFilters = async (filters) => {
    try {
        await axios.put(`/api/playlists/${editingPlaylistForFilters.id}`, filters);
        setMessage('Filtry synchronizacji zostały zapisane.');
        await fetchPlaylists();
        setShowFilterEditor(false);
        setEditingPlaylistForFilters(null);
        setTimeout(() => setMessage(''), 3000);
    } catch (error) {
        console.error('Błąd zapisywania filtrów:', error);
        setMessage('Błąd zapisywania filtrów.');
    }
};

    // Pobierz playlisty
    const fetchPlaylists = async () => {
        try {
            const response = await axios.get('/api/playlists');
            setPlaylists(response.data);
        } catch (error) {
            console.error('Błąd pobierania playlist:', error);
            setMessage('Błąd pobierania playlist.');
        }
    };

    // Pobierz przegląd
    const fetchOverview = async () => {
        try {
            const response = await axios.get('/api/playlists/overview');
            setOverview(response.data);
        } catch (error) {
            console.error('Błąd pobierania przeglądu:', error);
        }
    };

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            await Promise.all([fetchPlaylists(), fetchOverview()]);
            setLoading(false);
        };
        loadData();
    }, []);

    // Zapisz playlistę (dodaj lub edytuj)
    const handleSavePlaylist = async (formData) => {
        try {
            if (editingPlaylist) {
                // Edytuj istniejącą
                await axios.post(`/api/playlists/${editingPlaylist.id}`, formData);
                setMessage('Playlista została zaktualizowana.');
            } else {
                // Dodaj nową
                await axios.post('/api/playlists', formData);
                setMessage('Playlista została dodana.');
            }
            
            // Odśwież dane i ukryj formularz
            await Promise.all([fetchPlaylists(), fetchOverview()]);
            setShowForm(false);
            setEditingPlaylist(null);
            
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error('Błąd zapisywania playlisty:', error);
            setMessage(error.response?.data?.error || 'Błąd zapisywania playlisty.');
        }
    };

    // Usuń playlistę
    const handleDeletePlaylist = async (id, name) => {
        if (!window.confirm(`Czy na pewno chcesz usunąć playlistę "${name}"?`)) {
            return;
        }

        try {
            await axios.delete(`/api/playlists/${id}`);
            setMessage('Playlista została usunięta.');
            await Promise.all([fetchPlaylists(), fetchOverview()]);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error('Błąd usuwania playlisty:', error);
            setMessage(error.response?.data?.error || 'Błąd usuwania playlisty.');
        }
    };

    // Przełącz aktywność
    const handleTogglePlaylist = async (id) => {
        try {
            await axios.post(`/api/playlists/${id}/toggle`);
            setMessage('Status playlisty został zmieniony.');
            await fetchPlaylists();
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error('Błąd zmiany statusu:', error);
            setMessage('Błąd zmiany statusu playlisty.');
        }
    };

    // NOWE: Synchronizuj pojedynczą playlistę
    const handleSyncPlaylist = async (id) => {
        setSyncing(prev => ({ ...prev, single: { ...prev.single, [id]: true } }));
        
        try {
            const response = await axios.post(`/api/playlists/${id}/sync`);
            setMessage(response.data.message || 'Synchronizacja playlisty zakończona.');
            await Promise.all([fetchPlaylists(), fetchOverview()]);
            setTimeout(() => setMessage(''), 5000);
        } catch (error) {
            console.error('Błąd synchronizacji playlisty:', error);
            setMessage(error.response?.data?.error || 'Błąd synchronizacji playlisty.');
            setTimeout(() => setMessage(''), 5000);
        } finally {
            setSyncing(prev => ({ ...prev, single: { ...prev.single, [id]: false } }));
        }
    };

    // NOWE: Synchronizuj wszystkie playlisty
    const handleSyncAllPlaylists = async () => {
        setSyncing(prev => ({ ...prev, all: true }));
        
        try {
            const response = await axios.post('/api/playlists/sync-all');
            const result = response.data;
            
            let messageText = result.message;
            if (result.results && result.results.length > 0) {
                const successCount = result.results.filter(r => !r.error).length;
                const errorCount = result.results.filter(r => r.error).length;
                
                messageText += `\n\n📊 Szczegóły:\n`;
                messageText += `✅ Udane: ${successCount}\n`;
                if (errorCount > 0) {
                    messageText += `❌ Błędy: ${errorCount}\n`;
                }
                
                // Pokaż pierwsze kilka wyników
                result.results.slice(0, 3).forEach(r => {
                    if (r.error) {
                        messageText += `• ${r.playlist_name}: ERROR - ${r.error}\n`;
                    } else {
                        messageText += `• ${r.playlist_name}: +${r.added || 0} -${r.removed || 0}\n`;
                    }
                });
            }
            
            setMessage(messageText);
            await Promise.all([fetchPlaylists(), fetchOverview()]);
            setTimeout(() => setMessage(''), 10000);
            
        } catch (error) {
            console.error('Błąd synchronizacji wszystkich playlist:', error);
            setMessage(error.response?.data?.error || 'Błąd synchronizacji playlist.');
            setTimeout(() => setMessage(''), 5000);
        } finally {
            setSyncing(prev => ({ ...prev, all: false }));
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-8">
                <div className="text-gray-400">Ładowanie playlist...</div>
            </div>
        );
    }

    const activePlaylists = playlists.filter(p => p.is_active);

    return (
        <div className="space-y-6">
            {/* Nagłówek z przeglądem */}
            {overview && (
                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">Przegląd Playlist</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                        <div className="bg-blue-900/50 p-4 rounded">
                            <div className="text-2xl font-bold text-blue-300">{overview.overview.total_playlists}</div>
                            <div className="text-gray-400">Łącznie</div>
                        </div>
                        <div className="bg-green-900/50 p-4 rounded">
                            <div className="text-2xl font-bold text-green-300">{overview.overview.active_playlists}</div>
                            <div className="text-gray-400">Aktywnych</div>
                        </div>
                        <div className="bg-purple-900/50 p-4 rounded">
                            <div className="text-2xl font-bold text-purple-300">{overview.overview.total_media || 0}</div>
                            <div className="text-gray-400">Mediów</div>
                        </div>
                        <div className="bg-yellow-900/50 p-4 rounded">
                            <div className="text-2xl font-bold text-yellow-300">
                                {Math.round(overview.overview.avg_media_per_playlist || 0)}
                            </div>
                            <div className="text-gray-400">Średnio/playlist</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Komunikaty */}
            {message && (
                <div className={`p-4 rounded-lg whitespace-pre-line ${
                    message.includes('Błąd') || message.includes('błąd') || message.includes('ERROR') ? 
                    'bg-red-900/50 text-red-300 border border-red-700' : 
                    'bg-green-900/50 text-green-300 border border-green-700'
                }`}>
                    {message}
                </div>
            )}

            {/* Przyciski akcji */}
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">Zarządzaj Playlistami</h3>
                <div className="flex gap-3">
                    {/* NOWY: Przycisk synchronizacji wszystkich */}
                    <button
                        onClick={handleSyncAllPlaylists}
                        disabled={syncing.all || activePlaylists.length === 0}
                        className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition duration-300 flex items-center gap-2"
                    >
                        {syncing.all ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Synchronizacja...
                            </>
                        ) : (
                            <>🔄 Synchronizuj Wszystkie ({activePlaylists.length})</>
                        )}
                    </button>
                    
                    <button
                        onClick={() => {
                            setShowForm(true);
                            setEditingPlaylist(null);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
                    >
                        ➕ Dodaj Playlistę
                    </button>
                </div>
            </div>

            {/* Formularz dodawania/edycji */}
            {showForm && (
                <PlaylistForm
                    playlist={editingPlaylist}
                    onSave={handleSavePlaylist}
                    onCancel={() => {
                        setShowForm(false);
                        setEditingPlaylist(null);
                    }}
                    isEditing={!!editingPlaylist}
                />
            )}
{showFilterEditor && (
    <FilterEditor
        playlist={editingPlaylistForFilters}
        onSave={handleSaveFilters}
        onCancel={() => {
            setShowFilterEditor(false);
            setEditingPlaylistForFilters(null);
        }}
    />
)}
            {/* Lista playlist */}
            <div className="grid gap-4">
                {playlists.length === 0 ? (
                    <div className="bg-gray-800 rounded-lg p-8 text-center">
                        <div className="text-gray-400 mb-4">Brak playlist do wyświetlenia</div>
                        <button
                            onClick={() => setShowForm(true)}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
                        >
                            Dodaj Pierwszą Playlistę
                        </button>
                    </div>
                ) : (
                    playlists.map(playlist => (
                        <PlaylistCard
                            key={playlist.id}
                            playlist={playlist}
                            onEdit={(playlist) => {
                                setEditingPlaylist(playlist);
                                setShowForm(true);
                            }}
                            onDelete={handleDeletePlaylist}
                            onToggle={handleTogglePlaylist}
                            onSync={handleSyncPlaylist}
                            syncing={syncing.single[playlist.id] || false} // NOWE: Przekaż stan synchronizacji
                        />
                    ))
                )}
            </div>
        </div>
    );
};

// --- Komponent Karta Mediów ---
const MediaCard = ({ item, isFavorite, onToggleFavorite }) => (
  <div className="card bg-gray-800 rounded-lg overflow-hidden shadow-lg relative group">
    <a href={`#/details/${item.stream_type}/${item.stream_id}`} className="absolute inset-0 z-0">
        <span className="sr-only">Zobacz szczegóły {item.name}</span>
    </a>
    {/* NOWY: Badge playlisty */}
    {item.playlist_name && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-gray-900/80 text-xs text-gray-300 rounded z-10">
            {item.playlist_name}
        </div>
    )}
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
/* const DownloadWidget = ({ downloads, onRemove, onClose, isOpen }) => {
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
*/
const ArchiveSeriesManager = ({ isOpen, onClose, onRefresh }) => {
    const [seriesStats, setSeriesStats] = useState([]);
    const [duplicates, setDuplicates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('series'); // 'series', 'duplicates', 'cleanup'

    useEffect(() => {
        if (isOpen) {
            fetchArchiveStats();
            fetchDuplicates();
        }
    }, [isOpen]);

    const fetchArchiveStats = async () => {
        setLoading(true);
        try {
            const response = await axios.get('/api/downloads/archive/stats');
            setSeriesStats(response.data.top_series || []);
        } catch (error) {
            console.error('Błąd pobierania statystyk:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchDuplicates = async () => {
        try {
            const response = await axios.get('/api/downloads/archive/duplicates');
            setDuplicates(response.data.duplicate_groups || []);
        } catch (error) {
            console.error('Błąd pobierania duplikatów:', error);
        }
    };

    const handleBulkAction = async (action, params = {}) => {
        if (!window.confirm(`Czy na pewno chcesz wykonać akcję: ${action}?`)) {
            return;
        }

        try {
            await axios.post('/api/downloads/archive/bulk-action', {
                action,
                ...params
            });
            
            // Odśwież dane
            fetchArchiveStats();
            fetchDuplicates();
            onRefresh();
        } catch (error) {
            console.error('Błąd operacji grupowej:', error);
            alert('Błąd wykonania operacji.');
        }
    };

    const handleDeleteSeries = async (seriesName) => {
        const episodeCount = seriesStats.find(s => s.series_name === seriesName)?.total_episodes || 0;
        
        if (!window.confirm(`Czy na pewno chcesz usunąć wszystkie ${episodeCount} odcinków serialu "${seriesName}" z archiwum?\n\nTo pozwoli systemowi pobrać te odcinki ponownie.`)) {
            return;
        }

        await handleBulkAction('delete_series', { series_name: seriesName });
    };

    const handleExportArchive = async (format = 'json') => {
        try {
            const response = await axios.get(`/api/downloads/archive/export?format=${format}`, {
                responseType: format === 'csv' ? 'blob' : 'json'
            });

            if (format === 'csv') {
                // Pobierz CSV jako plik
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', 'download_archive.csv');
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
            } else {
                // Wyświetl JSON
                console.log('Archive export:', response.data);
                alert('Dane zostały wyeksportowane do konsoli przeglądarki (F12)');
            }
        } catch (error) {
            console.error('Błąd eksportu:', error);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white">
                        📊 Zarządzanie Archiwum Pobierania
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl"
                    >
                        ×
                    </button>
                </div>

                {/* Zakładki */}
                <div className="flex bg-gray-900 rounded-lg p-1 mb-4">
                    <button
                        onClick={() => setActiveTab('series')}
                        className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'series'
                                ? 'bg-gray-700 text-white'
                                : 'text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        📺 Seriale ({seriesStats.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('duplicates')}
                        className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'duplicates'
                                ? 'bg-gray-700 text-white'
                                : 'text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        🔄 Duplikaty ({duplicates.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('cleanup')}
                        className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'cleanup'
                                ? 'bg-gray-700 text-white'
                                : 'text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        🧹 Czyszczenie
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="text-center py-8 text-gray-400">
                            Ładowanie danych archiwum...
                        </div>
                    ) : (
                        <>
                            {activeTab === 'series' && (
                                <div className="space-y-3">
                                    <div className="mb-4 p-3 bg-blue-900/30 rounded">
                                        <h4 className="font-semibold text-blue-300 mb-2">📈 Top Seriale w Archiwum</h4>
                                        <p className="text-blue-200 text-sm">
                                            Lista seriali z największą liczbą pobranych odcinków. 
                                            Możesz usunąć całe seriale aby pozwolić systemowi pobrać je ponownie.
                                        </p>
                                    </div>

                                    {seriesStats.length === 0 ? (
                                        <div className="text-center py-8 text-gray-400">
                                            Brak seriali w archiwum
                                        </div>
                                    ) : (
                                        seriesStats.map((series, index) => (
                                            <div key={index} className="bg-gray-700/50 p-4 rounded border-l-4 border-blue-500">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex-1">
                                                        <h4 className="font-semibold text-white text-lg">
                                                            {series.series_name}
                                                        </h4>
                                                        <div className="text-sm text-gray-400 mt-1 space-y-1">
                                                            <div>📦 <strong>{series.total_episodes}</strong> odcinków w archiwum</div>
                                                            <div>📅 <strong>{series.seasons_count}</strong> sezonów</div>
                                                            <div>🕐 Od {new Date(series.first_download).toLocaleDateString('pl-PL')} do {new Date(series.last_download).toLocaleDateString('pl-PL')}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2 ml-4">
                                                        <button
                                                            onClick={() => handleDeleteSeries(series.series_name)}
                                                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                                                        >
                                                            🗑️ Usuń Serial
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {activeTab === 'duplicates' && (
                                <div className="space-y-3">
                                    <div className="mb-4 p-3 bg-orange-900/30 rounded">
                                        <h4 className="font-semibold text-orange-300 mb-2">🔄 Duplikaty w Archiwum</h4>
                                        <p className="text-orange-200 text-sm">
                                            Znalezione duplikaty plików w archiwum. Usunięcie duplikatów może zaoszczędzić miejsce 
                                            i uporządkować archiwum.
                                        </p>
                                    </div>

                                    {duplicates.length === 0 ? (
                                        <div className="text-center py-8 text-gray-400">
                                            ✨ Brak duplikatów w archiwum
                                        </div>
                                    ) : (
                                        duplicates.map((duplicate, index) => (
                                            <div key={index} className="bg-gray-700/50 p-4 rounded border-l-4 border-orange-500">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex-1">
                                                        <h4 className="font-semibold text-white">
                                                            {duplicate.filename}
                                                        </h4>
                                                        <div className="text-sm text-gray-400 mt-1">
                                                            <div>🔄 <strong>{duplicate.count}</strong> duplikatów</div>
                                                            <div className="mt-2">
                                                                <strong>Pobrania:</strong>
                                                                {duplicate.downloads.map((dl, idx) => (
                                                                    <div key={idx} className="ml-2 text-xs">
                                                                        • {new Date(dl.added_at).toLocaleString('pl-PL')} (ID: {dl.id})
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2 ml-4">
                                                        <button
                                                            onClick={() => handleBulkAction('delete_selected', {
                                                                ids: duplicate.downloads.slice(1).map(d => d.id) // Zostaw pierwszą kopię
                                                            })}
                                                            className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-sm"
                                                        >
                                                            🧹 Usuń Duplikaty ({duplicate.count - 1})
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {activeTab === 'cleanup' && (
                                <div className="space-y-6">
                                    <div className="mb-4 p-3 bg-green-900/30 rounded">
                                        <h4 className="font-semibold text-green-300 mb-2">🧹 Narzędzia Czyszczenia</h4>
                                        <p className="text-green-200 text-sm">
                                            Narzędzia do masowego czyszczenia i eksportu danych archiwum.
                                        </p>
                                    </div>

                                    {/* Czyszczenie według wieku */}
                                    <div className="bg-gray-700/50 p-4 rounded">
                                        <h5 className="font-semibold text-white mb-3">📅 Usuń Stare Wpisy</h5>
                                        <p className="text-gray-300 text-sm mb-3">
                                            Usuń wszystkie wpisy z archiwum starsze niż określona liczba dni.
                                        </p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleBulkAction('delete_old', { days: 30 })}
                                                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded"
                                            >
                                                Usuń starsze niż 30 dni
                                            </button>
                                            <button
                                                onClick={() => handleBulkAction('delete_old', { days: 90 })}
                                                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded"
                                            >
                                                Usuń starsze niż 90 dni
                                            </button>
                                            <button
                                                onClick={() => handleBulkAction('delete_old', { days: 365 })}
                                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
                                            >
                                                Usuń starsze niż rok
                                            </button>
                                        </div>
                                    </div>

                                    {/* Eksport danych */}
                                    <div className="bg-gray-700/50 p-4 rounded">
                                        <h5 className="font-semibold text-white mb-3">📤 Eksport Danych</h5>
                                        <p className="text-gray-300 text-sm mb-3">
                                            Wyeksportuj listę archiwum do pliku CSV lub JSON dla analizy zewnętrznej.
                                        </p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleExportArchive('csv')}
                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                                            >
                                                📊 Eksportuj CSV
                                            </button>
                                            <button
                                                onClick={() => handleExportArchive('json')}
                                                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded"
                                            >
                                                📋 Eksportuj JSON
                                            </button>
                                        </div>
                                    </div>

                                    {/* Statystyki szybkie */}
                                    <div className="bg-gray-700/50 p-4 rounded">
                                        <h5 className="font-semibold text-white mb-3">📊 Szybkie Statystyki</h5>
                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div className="bg-blue-900/50 p-3 rounded">
                                                <div className="text-blue-300 font-semibold">{seriesStats.length}</div>
                                                <div className="text-gray-400">Unikalne seriale</div>
                                            </div>
                                            <div className="bg-orange-900/50 p-3 rounded">
                                                <div className="text-orange-300 font-semibold">
                                                    {duplicates.reduce((sum, dup) => sum + (dup.count - 1), 0)}
                                                </div>
                                                <div className="text-gray-400">Duplikaty do usunięcia</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-gray-600">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
                    >
                        Zamknij
                    </button>
                    <button
                        onClick={() => {
                            fetchArchiveStats();
                            fetchDuplicates();
                            onRefresh();
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                    >
                        🔄 Odśwież
                    </button>
                </div>
            </div>
        </div>
    );
};

// Zaktualizowany komponent DownloadWidget z wyszukiwaniem i grupowaniem
const DownloadWidget = ({ downloads, onRemove, onClose, isOpen }) => {
    const [statistics, setStatistics] = useState(null);
    const [daemonStatus, setDaemonStatus] = useState(null);
    const [activeTab, setActiveTab] = useState('active'); // 'active' lub 'archive'
    const [archive, setArchive] = useState([]);
    const [archiveLoading, setArchiveLoading] = useState(false);
    const [archivePagination, setArchivePagination] = useState({ currentPage: 1, totalPages: 1 });
    
    // NOWE: Stany dla wyszukiwania i grupowania
    const [searchTerm, setSearchTerm] = useState('');
    const [groupBy, setGroupBy] = useState('none'); // 'none', 'series', 'date', 'status'
    const [sortBy, setSortBy] = useState('newest'); // 'newest', 'oldest', 'name'

    // Pobierz statystyki i status daemon
    useEffect(() => {
        if (isOpen) {
            const fetchStats = async () => {
                try {
                    const [statsResponse, daemonResponse] = await Promise.all([
                        axios.get('/api/downloads/statistics'),
                        axios.get('/api/downloads/daemon-status')
                    ]);
                    setStatistics(statsResponse.data);
                    setDaemonStatus(daemonResponse.data);
                } catch (error) {
                    console.error('Błąd pobierania statystyk pobierania:', error);
                }
            };
            
            fetchStats();
            const interval = setInterval(fetchStats, 5000);
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    // Pobierz archiwum gdy przełączamy na zakładkę archiwum
    useEffect(() => {
        if (isOpen && activeTab === 'archive') {
            fetchArchive(1);
        }
    }, [isOpen, activeTab]);

    const fetchArchive = async (page = 1) => {
        setArchiveLoading(true);
        try {
            const response = await axios.get('/api/downloads/archive', {
                params: { 
                    page, 
                    limit: 50, // Zwiększ limit dla lepszego wyszukiwania
                    search: searchTerm, // Dodaj wyszukiwanie do API
                    sort: sortBy
                }
            });
            setArchive(response.data.downloads);
            setArchivePagination(response.data.pagination);
        } catch (error) {
            console.error('Błąd pobierania archiwum:', error);
        } finally {
            setArchiveLoading(false);
        }
    };

    // NOWA FUNKCJA: Filtrowanie i grupowanie danych
    const processDownloads = (downloads) => {
        let filtered = downloads;

        // Filtrowanie po wyszukiwanej frazie
        if (searchTerm) {
            filtered = filtered.filter(item => 
                item.filename?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.stream_type?.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Sortowanie
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'oldest':
                    return new Date(a.added_at) - new Date(b.added_at);
                case 'name':
                    return (a.filename || '').localeCompare(b.filename || '');
                case 'newest':
                default:
                    return new Date(b.added_at) - new Date(a.added_at);
            }
        });

        // Grupowanie
        if (groupBy === 'none') {
            return [{ groupName: null, items: filtered }];
        }

        const groups = {};
        
        filtered.forEach(item => {
            let groupKey;
            
            switch (groupBy) {
                case 'series':
                    // Wyciągnij nazwę serialu z nazwy pliku
                    const seriesMatch = item.filename?.match(/^(.+?)\s+-\s+S\d+E\d+/);
                    groupKey = seriesMatch ? seriesMatch[1] : (item.stream_type === 'movie' ? '🎬 Filmy' : '📺 Inne');
                    break;
                    
                case 'date':
                    const date = new Date(item.added_at);
                    groupKey = date.toLocaleDateString('pl-PL', { 
                        year: 'numeric', 
                        month: 'long',
                        day: 'numeric'
                    });
                    break;
                    
                case 'status':
                    groupKey = item.worker_status === 'completed' ? '✅ Ukończone' : 
                              item.worker_status === 'failed' ? '❌ Nieudane' : 
                              item.worker_status === 'downloading' ? '⏳ W trakcie' : 
                              '⏸️ W kolejce';
                    break;
                    
                default:
                    groupKey = 'Wszystkie';
            }
            
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(item);
        });

        return Object.entries(groups)
            .map(([groupName, items]) => ({ groupName, items }))
            .sort((a, b) => a.groupName.localeCompare(b.groupName));
    };

    const handleDeleteFromArchive = async (id, filename) => {
        if (!window.confirm(`Czy na pewno chcesz trwale usunąć "${filename}" z archiwum?\n\nTo pozwoli systemowi pobrać ten plik ponownie w przyszłości.`)) {
            return;
        }

        try {
            await axios.delete(`/api/downloads/archive/${id}`);
            // Odśwież archiwum
            fetchArchive(archivePagination.currentPage);
            // Odśwież statystyki
            const statsResponse = await axios.get('/api/downloads/statistics');
            setStatistics(statsResponse.data);
        } catch (error) {
            console.error('Błąd usuwania z archiwum:', error);
        }
    };

    const handleStartDaemon = async () => {
        try {
            await axios.post('/api/downloads/start-daemon');
            setTimeout(async () => {
                const response = await axios.get('/api/downloads/daemon-status');
                setDaemonStatus(response.data);
            }, 2000);
        } catch (error) {
            console.error('Błąd uruchamiania daemon:', error);
        }
    };

    const handleStopDaemon = async () => {
        try {
            await axios.post('/api/downloads/stop-daemon');
            setTimeout(async () => {
                const response = await axios.get('/api/downloads/daemon-status');
                setDaemonStatus(response.data);
            }, 2000);
        } catch (error) {
            console.error('Błąd zatrzymywania daemon:', error);
        }
    };

    // Odśwież archiwum gdy zmienia się wyszukiwanie lub sortowanie
    useEffect(() => {
        if (activeTab === 'archive') {
            const timer = setTimeout(() => {
                fetchArchive(1);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [searchTerm, sortBy]);

    if (!isOpen) return null;

    const getStatusIcon = (status, workerStatus) => {
        if (workerStatus === 'downloading') return '⏳';
        if (workerStatus === 'completed') return '✅';
        if (workerStatus === 'failed') return '❌';
        return '⏸️';
    };

    const getStatusText = (status, workerStatus) => {
        if (workerStatus === 'downloading') return 'Pobieranie...';
        if (workerStatus === 'completed') return 'Ukończone';
        if (workerStatus === 'failed') return 'Błąd';
        if (workerStatus === 'queued') return 'W kolejce';
        return status;
    };

    const getRemoveButtonInfo = (workerStatus) => {
        if (workerStatus === 'completed') {
            return {
                text: '📦',
                title: 'Archiwizuj (ukryj z widoku)',
                className: 'text-blue-400 hover:text-blue-300'
            };
        } else {
            return {
                text: '×',
                title: 'Usuń z listy',
                className: 'text-gray-500 hover:text-white'
            };
        }
    };

    const processedDownloads = processDownloads(activeTab === 'active' ? downloads : archive);

    return (
        <div className="fixed bottom-4 right-4 w-[480px] bg-gray-800 rounded-lg shadow-2xl border border-gray-700 z-50 max-h-[80vh] overflow-hidden flex flex-col download-widget">
            <div className="p-4 flex-shrink-0">
                <div className="flex justify-between items-center mb-3">
                    <h4 className="font-bold text-lg text-white">Download Manager</h4>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
                </div>

                {/* Zakładki */}
                <div className="flex bg-gray-900 rounded-lg p-1 mb-3">
                    <button
                        onClick={() => setActiveTab('active')}
                        className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'active'
                                ? 'bg-gray-700 text-white'
                                : 'text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        Aktywne ({downloads.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('archive')}
                        className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                            activeTab === 'archive'
                                ? 'bg-gray-700 text-white'
                                : 'text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        Archiwum ({statistics?.statistics?.archived || 0})
                    </button>
                </div>

                {/* NOWE: Kontrolki wyszukiwania i grupowania dla archiwum */}
                {activeTab === 'archive' && (
                    <div className="mb-3 space-y-2">
                        {/* Wyszukiwanie */}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Szukaj w archiwum..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                            />
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                                >
                                    ×
                                </button>
                            )}
                        </div>

                        {/* Grupowanie i sortowanie */}
                        <div className="grid grid-cols-2 gap-2">
                            <select
                                value={groupBy}
                                onChange={(e) => setGroupBy(e.target.value)}
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                            >
                                <option value="none">Bez grupowania</option>
                                <option value="series">📺 Grupuj po serialach</option>
                                <option value="date">📅 Grupuj po datach</option>
                                <option value="status">🔄 Grupuj po statusie</option>
                            </select>

                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                            >
                                <option value="newest">🕐 Najnowsze</option>
                                <option value="oldest">🕕 Najstarsze</option>
                                <option value="name">🔤 Nazwa</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* Status Daemon - tylko dla aktywnych */}
                {activeTab === 'active' && daemonStatus && (
                    <div className="mb-3 p-2 bg-gray-700 rounded">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-300">
                                Daemon: {daemonStatus.is_running ? 
                                    <span className="text-green-400">🟢 Aktywny</span> : 
                                    <span className="text-red-400">🔴 Zatrzymany</span>
                                }
                            </span>
                            <div className="flex gap-2">
                                {!daemonStatus.is_running ? (
                                    <button 
                                        onClick={handleStartDaemon}
                                        className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                                    >
                                        Start
                                    </button>
                                ) : (
                                    <button 
                                        onClick={handleStopDaemon}
                                        className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                                    >
                                        Stop
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Statystyki - tylko dla aktywnych */}
                {activeTab === 'active' && statistics && (
                    <div className="mb-3">
                        <div className="grid grid-cols-4 gap-2 text-xs mb-2">
                            <div className="bg-blue-900/50 p-2 rounded text-center">
                                <div className="text-blue-300 font-semibold">{statistics.statistics.queued}</div>
                                <div className="text-gray-400">Kolejka</div>
                            </div>
                            <div className="bg-yellow-900/50 p-2 rounded text-center">
                                <div className="text-yellow-300 font-semibold">{statistics.statistics.downloading}</div>
                                <div className="text-gray-400">Pobiera</div>
                            </div>
                            <div className="bg-green-900/50 p-2 rounded text-center">
                                <div className="text-green-300 font-semibold">{statistics.statistics.completed}</div>
                                <div className="text-gray-400">Gotowe</div>
                            </div>
                            <div className="bg-red-900/50 p-2 rounded text-center">
                                <div className="text-red-300 font-semibold">{statistics.statistics.failed}</div>
                                <div className="text-gray-400">Błędy</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Zawartość - scrollowalna */}
            <div className="flex-1 overflow-y-auto">
                {activeTab === 'active' ? (
                    /* Lista aktywnych pobierań */
                    <div className="px-4 pb-4">
                        {downloads.length === 0 ? (
                            <p className="text-gray-400 text-sm text-center py-4">Brak aktywnych pobierań</p>
                        ) : (
                            <ul className="space-y-2 text-sm">
                                {downloads.slice(0, 10).map(d => {
                                    const removeButtonInfo = getRemoveButtonInfo(d.worker_status);
                                    
                                    return (
                                        <li key={d.id} className="bg-gray-700/50 p-2 rounded">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="truncate text-gray-300 flex-1">
                                                    {getStatusIcon(d.status, d.worker_status)} {d.filename}
                                                </span>
                                                <div className="flex items-center gap-2 ml-2">
                                                    <span className={`text-xs font-semibold ${
                                                        d.worker_status === 'failed' ? 'text-red-400' : 
                                                        d.worker_status === 'completed' ? 'text-green-400' :
                                                        d.worker_status === 'downloading' ? 'text-blue-400' :
                                                        'text-gray-400'
                                                    }`}>
                                                        {getStatusText(d.status, d.worker_status)}
                                                    </span>
                                                    <button 
                                                        onClick={() => onRemove(d.id)} 
                                                        className={`text-lg ${removeButtonInfo.className}`}
                                                        title={removeButtonInfo.title}
                                                    >
                                                        {removeButtonInfo.text}
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            {d.worker_status === 'downloading' && (
                                                <div className="w-full bg-gray-600 rounded-full h-1.5 animate-pulse">
                                                    <div className="bg-blue-500 h-1.5 rounded-full" style={{width: `${d.progress || 30}%`}}></div>
                                                </div>
                                            )}
                                            
                                            {d.error_message && (
                                                <div className="text-red-400 text-xs mt-1 truncate" title={d.error_message}>
                                                    {d.error_message}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                ) : (
                    /* ULEPSZONE ARCHIWUM z grupowaniem - POPRAWIONE SCROLLOWANIE */
                    <div className="px-4 pb-4">
                        <div className="max-h-full overflow-y-auto">
                            {archiveLoading ? (
                                <p className="text-gray-400 text-sm text-center py-4">Ładowanie archiwum...</p>
                            ) : processedDownloads.length === 0 ? (
                                <p className="text-gray-400 text-sm text-center py-4">
                                    {searchTerm ? `Brak wyników dla "${searchTerm}"` : 'Archiwum jest puste'}
                                </p>
                            ) : (
                                <>
                                    {/* Informacja o wynikach */}
                                    {searchTerm && (
                                        <div className="mb-3 text-xs text-gray-400 bg-gray-700/30 p-2 rounded">
                                            📊 Znaleziono {processedDownloads.reduce((sum, group) => sum + group.items.length, 0)} wyników dla "{searchTerm}"
                                        </div>
                                    )}

                                    {/* POPRAWIONA SEKCJA - Scrollowalna lista grup */}
                                    <div className="space-y-4 max-h-96 overflow-y-auto pr-2 download-widget-scroll">
                                        {processedDownloads.map((group, groupIndex) => (
                                            <div key={groupIndex}>
                                                {/* Nagłówek grupy - STICKY */}
                                                {group.groupName && groupBy !== 'none' && (
                                                    <div className="sticky top-0 z-10 archive-group-header flex items-center justify-between mb-2 pb-1 border-b border-gray-600 py-2">
                                                        <h5 className="text-sm font-semibold text-white">
                                                            {group.groupName}
                                                        </h5>
                                                        <span className="text-xs text-gray-400 bg-gray-700/80 px-2 py-1 rounded">
                                                            {group.items.length} {group.items.length === 1 ? 'pozycja' : 'pozycji'}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Elementy grupy */}
                                                <div className="space-y-2">
                                                    {group.items.map(d => (
                                                        <div key={d.id} className="archive-item bg-purple-900/20 p-3 rounded border border-purple-700/30 hover:bg-purple-900/40 transition-all duration-200">
                                                            <div className="archive-item-content flex justify-between items-start gap-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <span className="text-purple-400">📦</span>
                                                                        <span className="text-gray-300 text-sm font-medium truncate" title={d.filename}>
                                                                            {d.filename}
                                                                        </span>
                                                                    </div>
                                                                    
                                                                    <div className="text-xs text-gray-500 space-y-1">
                                                                        <div className="flex items-center gap-4">
                                                                            <span>📅 {new Date(d.added_at).toLocaleDateString('pl-PL')}</span>
                                                                            <span className="capitalize">
                                                                                {d.stream_type === 'series' ? '📺 Serial' : '🎬 Film'}
                                                                            </span>
                                                                        </div>
                                                                        
                                                                        {/* Dodatkowe info dla seriali */}
                                                                        {d.stream_type === 'series' && d.episode_id && (
                                                                            <div className="text-purple-300">
                                                                                🎭 Episode ID: {d.episode_id}
                                                                            </div>
                                                                        )}
                                                                        
                                                                        {/* Info o ścieżce pliku */}
                                                                        {d.filepath && (
                                                                            <div className="text-gray-500 truncate" title={d.filepath}>
                                                                                📁 {d.filepath}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                
                                                                <div className="flex-shrink-0">
                                                                    <button 
                                                                        onClick={() => handleDeleteFromArchive(d.id, d.filename)} 
                                                                        className="archive-action-button text-red-400 hover:text-red-300 hover:bg-red-900/30 p-2 rounded transition-all duration-200"
                                                                        title="Usuń z archiwum (pozwoli na ponowne pobranie)"
                                                                    >
                                                                        🗑️
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Separator między grupami */}
                                                {groupBy !== 'none' && groupIndex < processedDownloads.length - 1 && (
                                                    <div className="mt-4 border-t border-gray-600"></div>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Paginacja archiwum - ZAWSZE WIDOCZNA NA DOLE */}
                                    {archivePagination.totalPages > 1 && (
                                        <div className="mt-4 pt-3 border-t border-gray-600 bg-gray-800 flex justify-between items-center text-xs">
                                            <button
                                                onClick={() => fetchArchive(archivePagination.currentPage - 1)}
                                                disabled={archivePagination.currentPage <= 1}
                                                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded flex items-center gap-1"
                                            >
                                                ← Poprzednia
                                            </button>
                                            
                                            <div className="flex items-center gap-2">
                                                <span className="text-gray-400">
                                                    Strona {archivePagination.currentPage} z {archivePagination.totalPages}
                                                </span>
                                                <span className="text-gray-500">
                                                    ({archivePagination.totalItems} łącznie)
                                                </span>
                                            </div>
                                            
                                            <button
                                                onClick={() => fetchArchive(archivePagination.currentPage + 1)}
                                                disabled={archivePagination.currentPage >= archivePagination.totalPages}
                                                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded flex items-center gap-1"
                                            >
                                                Następna →
                                            </button>
                                        </div>
                                    )}

                                    {/* Informacja o łącznej liczbie elementów */}
                                    <div className="mt-2 text-center text-xs text-gray-500">
                                        Wyświetlono {processedDownloads.reduce((sum, group) => sum + group.items.length, 0)} z {archivePagination.totalItems} pozycji
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const TMDBAssignmentModal = ({ isOpen, onClose, onAssign, currentItem }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [assigning, setAssigning] = useState(false);

    useEffect(() => {
        if (isOpen && currentItem) {
            // Automatyczne wyszukiwanie na podstawie nazwy media
            setSearchQuery(currentItem.name || '');
        }
    }, [isOpen, currentItem]);

    const searchTMDB = React.useCallback(async () => {
        if (!searchQuery.trim() || searchQuery.length < 2) {
            setSearchResults([]);
            return;
        }

        setSearching(true);
        try {
            const mediaType = currentItem?.stream_type === 'series' ? 'tv' : 'movie';
            const response = await axios.get('/api/tmdb/search', {
                params: { 
                    query: searchQuery, 
                    type: mediaType // Wyszukaj tylko odpowiedni typ
                }
            });
            setSearchResults(response.data.results || []);
        } catch (error) {
            console.error('Błąd wyszukiwania TMDB:', error);
        } finally {
            setSearching(false);
        }
    }, [searchQuery, currentItem]);

    useEffect(() => {
        const timer = setTimeout(() => {
            searchTMDB();
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery, searchTMDB]);

    const handleAssign = async (tmdbItem) => {
        setAssigning(true);
        try {
            await onAssign(tmdbItem);
            onClose();
        } catch (error) {
            console.error('Błąd przypisywania TMDB ID:', error);
        } finally {
            setAssigning(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white">
                        Przypisz TMDB ID dla: {currentItem?.name}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl"
                        disabled={assigning}
                    >
                        ×
                    </button>
                </div>

                <div className="mb-4">
                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={`Wyszukaj ${currentItem?.stream_type === 'series' ? 'serial' : 'film'} w TMDB...`}
                            className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                            disabled={assigning}
                        />
                        <button
                            onClick={searchTMDB}
                            disabled={searching || assigning}
                            className="bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white font-bold py-3 px-6 rounded-lg transition duration-300"
                        >
                            {searching ? 'Szukam...' : 'Szukaj'}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3">
                    {searchResults.length === 0 && searchQuery.length >= 2 && !searching ? (
                        <div className="bg-gray-700 rounded-lg p-6 text-center text-gray-400">
                            Brak wyników dla "{searchQuery}"
                        </div>
                    ) : (
                        searchResults.map((item) => (
                            <div key={item.id} className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                                <div className="flex gap-3">
                                    <div className="w-16 h-24 flex-shrink-0">
                                        <img
                                            src={item.poster_path ? 
                                                `https://image.tmdb.org/t/p/w200${item.poster_path}` : 
                                                'https://placehold.co/200x300/1f2937/ffffff?text=No+Image'
                                            }
                                            alt={item.title || item.name}
                                            className="w-full h-full object-cover rounded"
                                        />
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-semibold text-white truncate">
                                            {item.title || item.name}
                                        </h4>
                                        
                                        {item.original_title && item.original_title !== (item.title || item.name) && (
                                            <p className="text-sm text-gray-400 truncate">
                                                Oryginalny: {item.original_title || item.original_name}
                                            </p>
                                        )}
                                        
                                        <div className="text-sm text-gray-400 mb-2">
                                            <span>TMDB ID: {item.id}</span>
                                            {(item.release_date || item.first_air_date) && (
                                                <span className="ml-2">
                                                    ({new Date(item.release_date || item.first_air_date).getFullYear()})
                                                </span>
                                            )}
                                            {item.vote_average > 0 && (
                                                <span className="ml-2">⭐ {item.vote_average.toFixed(1)}</span>
                                            )}
                                        </div>
                                        
                                        {item.overview && (
                                            <p className="text-gray-300 text-sm leading-tight line-clamp-2">
                                                {item.overview.length > 150 ? 
                                                    `${item.overview.substring(0, 150)}...` : 
                                                    item.overview
                                                }
                                            </p>
                                        )}
                                    </div>
                                    
                                    <div className="flex flex-col justify-between">
                                        <button
                                            onClick={() => handleAssign(item)}
                                            disabled={assigning}
                                            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white rounded text-sm transition-colors"
                                        >
                                            {assigning ? '...' : '✓ Przypisz'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="mt-4 flex justify-end gap-3 pt-4 border-t border-gray-600">
                    <button
                        onClick={onClose}
                        disabled={assigning}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-800 text-white rounded transition-colors"
                    >
                        Anuluj
                    </button>
                </div>
            </div>
        </div>
    );
};
// --- Komponent Widoku Szczegółów ---
const DetailsView = ({ type, id, favorites, onToggleFavorite, onDownload }) => {
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showTMDBModal, setShowTMDBModal] = useState(false);
    const [updating, setUpdating] = useState(false);

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

    const handleAssignTMDB = async (tmdbItem) => {
        setUpdating(true);
        try {
            // Wyślij zapytanie do backend aby zaktualizować TMDB ID
            await axios.post(`/api/media/${details.stream_id}/${details.stream_type}/assign-tmdb`, {
                tmdb_id: tmdbItem.id,
                playlist_id: details.playlist_id
            });
            
            // Odśwież szczegóły aby pobrać nowe dane TMDB
            const response = await axios.get(`/api/media/details/${type}/${id}`);
            setDetails(response.data);
            
            console.log(`✅ Przypisano TMDB ID ${tmdbItem.id} do ${details.name}`);
        } catch (error) {
            console.error('Błąd przypisywania TMDB ID:', error);
            throw error;
        } finally {
            setUpdating(false);
        }
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
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                            <h2 className="text-4xl font-bold">{tmdb?.title || tmdb?.name || details.name}</h2>
                            <div className="flex items-center my-2 text-lg text-gray-400 flex-wrap">
                                {releaseYear && <span>{releaseYear}</span>}
                                {genres && <span className="mx-2">&bull;</span>}
                                <span>{genres}</span>
                            </div>
                        </div>
                        
                        {/* NOWA SEKCJA: Info o TMDB i przycisk przypisania */}
                        <div className="ml-4 text-right">
                            {details.tmdb_id ? (
                                <div className="mb-2">
                                    <div className="text-sm text-green-400 mb-1">✅ TMDB ID przypisany</div>
                                    <div className="text-xs text-gray-400">ID: {details.tmdb_id}</div>
                                    <button
                                        onClick={() => setShowTMDBModal(true)}
                                        disabled={updating}
                                        className="text-xs text-blue-400 hover:text-blue-300 underline mt-1"
                                    >
                                        Zmień przypisanie
                                    </button>
                                </div>
                            ) : (
                                <div className="mb-2">
                                    <div className="text-sm text-yellow-400 mb-1">⚠️ Brak TMDB ID</div>
                                    <button
                                        onClick={() => setShowTMDBModal(true)}
                                        disabled={updating}
                                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded text-sm transition-colors"
                                    >
                                        {updating ? 'Aktualizacja...' : '🔗 Przypisz TMDB'}
                                    </button>
                                </div>
                            )}
                            
                            {/* Info o playliście */}
                            {details.playlist_name && (
                                <div className="text-xs text-gray-500">
                                    📺 {details.playlist_name}
                                </div>
                            )}
                        </div>
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

            {/* Modal przypisania TMDB */}
            <TMDBAssignmentModal
                isOpen={showTMDBModal}
                onClose={() => setShowTMDBModal(false)}
                onAssign={handleAssignTMDB}
                currentItem={details}
            />
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

// Zaktualizowany komponent Ustawień z synchronizacją TMDB

const SettingsView = () => {
    const [settings, setSettings] = useState({ 
        serverUrl: '', username: '', password: '', tmdbApi: '', 
        discordWebhook: '', checkFrequency: '12' 
    });
    const [message, setMessage] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSyncingTmdb, setIsSyncingTmdb] = useState(false);
    const [tmdbStatus, setTmdbStatus] = useState(null);
    const [activeTab, setActiveTab] = useState('general'); // Nowy stan dla zakładek

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await axios.get('/api/settings');
                if (response.data) { 
                    setSettings(prev => ({ ...prev, ...response.data })); 
                }
            } catch (error) { 
                console.error('Nie udało się pobrać ustawień:', error); 
            }
        };
        fetchSettings();
    }, []);

    // Pobierz status TMDB
    useEffect(() => {
        const fetchTmdbStatus = async () => {
            try {
                const response = await axios.get('/api/tmdb/status');
                setTmdbStatus(response.data);
            } catch (error) {
                console.error('Nie udało się pobrać statusu TMDB:', error);
            }
        };
        fetchTmdbStatus();
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

    const handleTmdbSync = async () => {
        setMessage('');
        setIsSyncingTmdb(true);
        try {
            const response = await axios.post('/api/tmdb/sync', { limit: 20000 });
            setMessage(response.data.message || 'Synchronizacja TMDB zakończona.');
            
            // Odśwież status TMDB
            const statusResponse = await axios.get('/api/tmdb/status');
            setTmdbStatus(statusResponse.data);
        } catch (error) {
            setMessage(error.response?.data?.error || 'Wystąpił błąd podczas synchronizacji TMDB.');
        } finally {
            setIsSyncingTmdb(false);
            setTimeout(() => setMessage(''), 5000);
        }
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-white border-l-4 border-red-500 pl-4">Ustawienia Aplikacji</h2>
            
            {/* Zakładki */}
            <div className="mb-6">
                <nav className="flex space-x-8">
                    <button
                        onClick={() => setActiveTab('general')}
                        className={`py-2 px-1 border-b-2 font-medium text-sm ${
                            activeTab === 'general'
                                ? 'border-red-500 text-red-400'
                                : 'border-transparent text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        Ustawienia Ogólne
                    </button>
                    <button
                        onClick={() => setActiveTab('playlists')}
                        className={`py-2 px-1 border-b-2 font-medium text-sm ${
                            activeTab === 'playlists'
                                ? 'border-red-500 text-red-400'
                                : 'border-transparent text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        Zarządzaj Playlistami
                    </button>
                </nav>
            </div>

            {/* Zawartość zakładek */}
            {activeTab === 'general' && (
                <div>
                    {/* Status TMDB */}
                    {tmdbStatus && (
                        <div className="mb-6 bg-gray-800 p-4 rounded-lg">
                            <h3 className="text-lg font-semibold mb-3 text-white">Status synchronizacji TMDB</h3>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                                <div className="bg-gray-900/50 p-3 rounded">
                                    <div className="text-gray-300 font-semibold text-lg">{tmdbStatus.total_media}</div>
                                    <div className="text-gray-400">Łącznie mediów</div>
                                </div>
                                <div className="bg-blue-900/50 p-3 rounded">
                                    <div className="text-blue-300 font-semibold text-lg">{tmdbStatus.with_genres}</div>
                                    <div className="text-gray-400">Z gatunkami</div>
                                </div>
                                <div className="bg-yellow-900/50 p-3 rounded">
                                    <div className="text-yellow-300 font-semibold text-lg">{tmdbStatus.without_genres}</div>
                                    <div className="text-gray-400">Bez gatunków</div>
                                </div>
                                <div className="bg-red-900/50 p-3 rounded">
                                    <div className="text-red-300 font-semibold text-lg">{tmdbStatus.without_tmdb_id}</div>
                                    <div className="text-gray-400">Bez TMDB ID</div>
                                </div>
                                <div className="bg-green-900/50 p-3 rounded">
                                    <div className="text-green-300 font-semibold text-lg">{tmdbStatus.top_genres?.length || 0}</div>
                                    <div className="text-gray-400">Gatunki w bazie</div>
                                </div>
                            </div>
                            
                            {/* Progress bar */}
                            {tmdbStatus.total_media > 0 && (
                                <div className="mt-4">
                                    <div className="flex justify-between text-sm text-gray-400 mb-1">
                                        <span>Postęp synchronizacji</span>
                                        <span>{Math.round((tmdbStatus.with_genres / (tmdbStatus.total_media - tmdbStatus.without_tmdb_id)) * 100)}%</span>
                                    </div>
                                    <div className="w-full bg-gray-700 rounded-full h-2">
                                        <div 
                                            className="bg-blue-500 h-2 rounded-full transition-all duration-300" 
                                            style={{
                                                width: `${Math.round((tmdbStatus.with_genres / (tmdbStatus.total_media - tmdbStatus.without_tmdb_id)) * 100)}%`
                                            }}
                                        ></div>
                                    </div>
                                </div>
                            )}
                            
                            {tmdbStatus.top_genres && tmdbStatus.top_genres.length > 0 && (
                                <div className="mt-3">
                                    <p className="text-sm text-gray-400 mb-2">Najpopularniejsze gatunki:</p>
                                    <div className="flex flex-wrap gap-2">
                                        {tmdbStatus.top_genres.slice(0, 5).map((genre, idx) => (
                                            <span key={idx} className="px-2 py-1 bg-gray-700 rounded text-xs">
                                                {genre.name} ({genre.count})
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    

                    {/* Formularz ustawień */}
                    <div className="max-w-2xl mx-auto bg-gray-800 p-8 rounded-lg shadow-2xl">
                        <form onSubmit={handleSave} className="space-y-6">
                            <div className="p-4 border border-gray-700 rounded-lg">
                                <h3 className="text-lg font-semibold mb-3 text-white">Dane logowania Xtream (Domyślne)</h3>
                                <div className="text-sm text-gray-400 mb-4">
                                    ⚠️ Te ustawienia są używane tylko dla kompatybilności wstecznej. 
                                    Użyj zakładki "Zarządzaj Playlistami" aby dodać nowe źródła IPTV.
                                </div>
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
                                    <option value="1">Co godzinę</option>
                                    <option value="6">Co 6 godzin</option>
                                    <option value="12">Co 12 godzin</option>
                                    <option value="24">Raz dziennie</option>
                                </select>
                            </div>
                            
                            <div className="pt-4 space-y-4">
                                <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300">
                                    Zapisz Ustawienia
                                </button>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <button 
                                        type="button" 
                                        onClick={handleRefresh} 
                                        disabled={isRefreshing} 
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300 disabled:bg-blue-800 disabled:cursor-not-allowed"
                                    >
                                        {isRefreshing ? 'Odświeżanie...' : 'Odśwież listę mediów'}
                                    </button>
                                    
                                    <button 
                                        type="button" 
                                        onClick={handleTmdbSync} 
                                        disabled={isSyncingTmdb} 
                                        className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300 disabled:bg-purple-800 disabled:cursor-not-allowed"
                                    >
                                        {isSyncingTmdb ? 'Synchronizacja...' : 'Synchronizuj TMDB'}
                                    </button>
                                </div>
                                
                                {message && <p className={`text-center mt-4 ${message.includes('Błąd') || message.includes('błąd') ? 'text-red-400' : 'text-green-400'}`}>{message}</p>}
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Zakładka Playlist Manager */}
            {activeTab === 'playlists' && (
                <PlaylistManager />
            )}
        </div>
    );
};

const WishlistCard = ({ item, onUpdate, onDelete, onDownload, onViewMatches, onMarkCompleted, onReset  }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({
        priority: item.priority,
        auto_download: item.auto_download,
        search_keywords: item.search_keywords || '',
        notes: item.notes || ''
    });

    const handleSaveEdit = async () => {
        try {
            await onUpdate(item.id, editData);
            setIsEditing(false);
        } catch (error) {
            console.error('Błąd aktualizacji:', error);
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'wanted': return '🔍';
            case 'found': return '🎯';
            case 'requires_selection': return '🤔';
            case 'downloading': return '⏬';
            case 'completed': return '✅';
            default: return '❓';
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'wanted': return 'bg-blue-900/50 text-blue-300';
            case 'found': return 'bg-green-900/50 text-green-300';
            case 'requires_selection': return 'bg-orange-900/50 text-orange-300';
            case 'downloading': return 'bg-yellow-900/50 text-yellow-300';
            case 'completed': return 'bg-gray-900/50 text-gray-300';
            default: return 'bg-gray-900/50 text-gray-300';
        }
    };

    const getStatusText = (status) => {
        switch (status) {
            case 'wanted': return 'Poszukiwane';
            case 'found': return 'Znalezione';
            case 'requires_selection': return 'Wymaga wyboru';
            case 'downloading': return 'Pobieranie';
            case 'completed': return 'Ukończone';
            default: return status;
        }
    };

    const getPriorityColor = (priority) => {
        switch (priority) {
            case 1: return 'bg-red-600';
            case 2: return 'bg-orange-500';
            case 3: return 'bg-yellow-500';
            case 4: return 'bg-blue-500';
            case 5: return 'bg-gray-500';
            default: return 'bg-gray-500';
        }
    };

    return (
        
        <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
            <div className="flex p-4">
                <div className="w-20 h-28 flex-shrink-0 mr-4">
                    <img
                        src={item.poster_path ? 
                            `https://image.tmdb.org/t/p/w200${item.poster_path}` : 
                            'https://placehold.co/200x300/1f2937/ffffff?text=No+Image'
                        }
                        alt={item.title}
                        className="w-full h-full object-cover rounded"
                    />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-semibold text-white truncate">
                                {item.title}
                            </h3>
                            {item.original_title && item.original_title !== item.title && (
                                <p className="text-sm text-gray-400 truncate">
                                    {item.original_title}
                                </p>
                            )}
                        </div>
                        
                        <div className="flex items-center gap-2 ml-4">
                            <div className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(item.status)}`}>
                                {getStatusIcon(item.status)} {getStatusText(item.status)}
                            </div>
                            <div className={`w-3 h-3 rounded-full ${getPriorityColor(item.priority)}`} title={`Priorytet: ${item.priority}`}></div>
                        </div>
                    </div>

                    <div className="text-sm text-gray-400 space-y-1">
                        <div className="flex items-center gap-4">
                            <span className="capitalize">
                                {item.media_type === 'tv' ? 'Serial' : 'Film'}
                            </span>
                            {item.release_date && (
                                <span>{new Date(item.release_date).getFullYear()}</span>
                            )}
                            {item.vote_average > 0 && (
                                <span className="flex items-center gap-1">
                                    ⭐ {item.vote_average.toFixed(1)}
                                </span>
                            )}
                        </div>
                        
                        <div className="flex items-center gap-4 text-xs">
                            <span>Auto-DL: {item.auto_download ? '✅' : '❌'}</span>
                            {item.match_count > 0 && (
                                <span className={`${
                                    item.status === 'requires_selection' ? 'text-orange-400' : 'text-green-400'
                                }`}>
                                    {item.match_count} match{item.match_count !== 1 ? 'y' : ''}
                                    {item.auto_downloadable_count > 0 && (
                                        <span className="ml-1 text-green-500">
                                            ({item.auto_downloadable_count} auto)
                                        </span>
                                    )}
                                </span>
                            )}
                        </div>

                        {/* Dodatkowe info dla requires_selection */}
                        {item.status === 'requires_selection' && (
                            <div className="mt-2 p-2 bg-orange-900/30 rounded text-xs">
                                <div className="text-orange-300 font-medium mb-1">
                                    🤔 Znaleziono wiele wersji - wybierz właściwą:
                                </div>
                                <div className="text-orange-200">
                                    Sprawdź dostępne opcje i wybierz którą wersję chcesz pobrać
                                </div>
                            </div>
                        )}
                    </div>

                    {item.genres && item.genres.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {item.genres.slice(0, 3).map((genre) => (
                                <span key={genre.id} className="px-2 py-0.5 bg-gray-700 text-xs text-gray-300 rounded">
                                    {genre.name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="px-4 py-3 bg-gray-900/30 border-t border-gray-700">
                <div className="flex justify-between items-center">
                    <div className="flex gap-2">
                        {item.match_count > 0 && (
                            <button
                                onClick={() => onViewMatches(item)}
                                className={`text-sm hover:underline ${
                                    item.status === 'requires_selection' 
                                        ? 'text-orange-400 hover:text-orange-300 font-medium' 
                                        : 'text-green-400 hover:text-green-300'
                                }`}
                            >
                                {item.status === 'requires_selection' 
                                    ? `🤔 Wybierz wersję (${item.match_count})` 
                                    : `🎯 Zobacz matche (${item.match_count})`
                                }
                            </button>
                        )}
                    </div>
                    
                    <div className="flex gap-2">
                        {/* Przycisk pobierania - różne zachowanie w zależności od statusu */}
                        {item.status === 'found' && item.auto_downloadable_count === 1 && (
                            <button
                                onClick={() => onDownload(item)}
                                className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                            >
                                ⏬ Auto-pobierz
                            </button>
                        )}
                        
                        {item.status === 'requires_selection' && (
                            <button
                                onClick={() => onViewMatches(item)}
                                className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-sm font-medium"
                            >
                                🤔 Wybierz wersję
                            </button>
                        )}

                        {/* Przycisk oznacz jako ukończone */}
                        {(item.status === 'found' || item.status === 'requires_selection') && (
                            <button
                                onClick={() => onMarkCompleted(item.id)}
                                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm"
                                title="Oznacz jako ukończone (jeśli już masz)"
                            >
                                ✅ Gotowe
                            </button>
                        )}

                        {/* Przycisk reset - dla pozycji które wymagają ponownego sprawdzenia */}
                        {(item.status === 'found' || item.status === 'requires_selection' || item.status === 'completed') && (
                            <button
                                onClick={() => onReset(item.id)}
                                className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm"
                                title="Resetuj i sprawdź ponownie"
                            >
                                🔄 Reset
                            </button>
                        )}
                        
                        <button
                            onClick={() => onDelete(item.id)}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                        >
                            🗑️
                        </button>
                    </div>
                </div>
            </div>
        </div>
    
       
    );
};

// Zaktualizowany WishlistMatchesModal z lepszą wizualizacją typów matchy

const WishlistMatchesModal = ({ item, matches, onClose, onDownload }) => {
    if (!item || !matches) return null;

    const groupedMatches = matches.reduce((groups, match) => {
        const type = match.match_type || 'name';
        if (!groups[type]) groups[type] = [];
        groups[type].push(match);
        return groups;
    }, {});

    const getMatchTypeInfo = (type) => {
        switch (type) {
            case 'tmdb_id':
                return {
                    icon: '🎯',
                    label: 'Dokładne dopasowanie TMDB ID',
                    color: 'bg-green-900/50 border-green-700',
                    description: 'To samo TMDB ID - najwyższa pewność dopasowania'
                };
            case 'name':
                return {
                    icon: '📝',
                    label: 'Dopasowanie po nazwie',
                    color: 'bg-blue-900/50 border-blue-700',
                    description: 'Dopasowanie na podstawie podobieństwa nazw'
                };
            default:
                return {
                    icon: '❓',
                    label: 'Inne',
                    color: 'bg-gray-900/50 border-gray-700',
                    description: 'Inne kryteria dopasowania'
                };
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white">
                        Dostępne wersje dla: {item.title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl"
                    >
                        ×
                    </button>
                </div>

                {/* Info o statusie */}
                {item.status === 'requires_selection' && (
                    <div className="mb-4 p-3 bg-orange-900/30 border border-orange-700 rounded">
                        <div className="text-orange-300 font-medium mb-1">
                            🤔 Wybór wymagany
                        </div>
                        <div className="text-orange-200 text-sm">
                            Znaleziono wiele wersji. Wybierz którą chcesz pobrać klikając przycisk "Pobierz".
                        </div>
                    </div>
                )}

                {/* Wyświetl grupy matchy według typu */}
                <div className="space-y-4">
                    {Object.entries(groupedMatches).map(([type, typeMatches]) => {
                        const typeInfo = getMatchTypeInfo(type);
                        
                        return (
                            <div key={type} className={`border rounded-lg p-4 ${typeInfo.color}`}>
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-white flex items-center gap-2">
                                        {typeInfo.icon} {typeInfo.label}
                                        <span className="text-sm font-normal text-gray-400">
                                            ({typeMatches.length} {typeMatches.length === 1 ? 'wynik' : 'wyniki'})
                                        </span>
                                    </h4>
                                    {type === 'tmdb_id' && (
                                        <span className="text-xs bg-green-800 text-green-200 px-2 py-1 rounded">
                                            Najwyższa pewność
                                        </span>
                                    )}
                                </div>
                                
                                <p className="text-sm text-gray-300 mb-3">{typeInfo.description}</p>
                                
                                <div className="space-y-2">
                                    {typeMatches.map((match) => (
                                        <div key={match.id} className="bg-gray-700/50 p-3 rounded">
                                            <div className="flex justify-between items-start">
                                                <div className="flex-1">
                                                    <h5 className="font-medium text-white">
                                                        {match.media_name}
                                                    </h5>
                                                    <div className="text-sm text-gray-400 mt-1 space-y-1">
                                                        <div>
                                                            <span className="font-medium">Playlista:</span> {match.playlist_name}
                                                        </div>
                                                        <div>
                                                            <span className="font-medium">Dopasowanie:</span> {(match.match_score * 100).toFixed(0)}%
                                                        </div>
                                                        {match.auto_downloadable && (
                                                            <div className="text-green-400 text-xs">
                                                                ✅ Może być automatycznie pobrane
                                                            </div>
                                                        )}
                                                        {match.match_reason && (
                                                            <div className="text-gray-500 text-xs">
                                                                {match.match_reason}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="ml-4">
                                                    <button
                                                        onClick={() => onDownload(item.id, match.id)}
                                                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                                                    >
                                                        ⏬ Pobierz
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-6 text-center">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
                    >
                        Zamknij
                    </button>
                </div>
            </div>
        </div>
    );
};

const TMDBSearchResult = ({ item, onAdd, inWishlist = false }) => {
    const [isAdding, setIsAdding] = useState(false);

    const handleAdd = async () => {
        setIsAdding(true);
        try {
            await onAdd(item);
        } catch (error) {
            console.error('Błąd dodawania:', error);
        } finally {
            setIsAdding(false);
        }
    };

    return (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex gap-3">
                <div className="w-16 h-24 flex-shrink-0">
                    <img
                        src={item.poster_path ? 
                            `https://image.tmdb.org/t/p/w200${item.poster_path}` : 
                            'https://placehold.co/200x300/1f2937/ffffff?text=No+Image'
                        }
                        alt={item.title || item.name}
                        className="w-full h-full object-cover rounded"
                    />
                </div>
                
                <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-white truncate">
                        {item.title || item.name}
                    </h4>
                    
                    <div className="text-sm text-gray-400 mb-2">
                        <span className="capitalize">
                            {item.media_type === 'tv' ? 'Serial' : 'Film'}
                        </span>
                        {(item.release_date || item.first_air_date) && (
                            <span className="ml-2">
                                {new Date(item.release_date || item.first_air_date).getFullYear()}
                            </span>
                        )}
                    </div>
                    
                    {item.overview && (
                        <p className="text-gray-300 text-sm leading-tight line-clamp-2">
                            {item.overview.length > 100 ? 
                                `${item.overview.substring(0, 100)}...` : 
                                item.overview
                            }
                        </p>
                    )}
                </div>
                
                <div className="flex flex-col justify-between">
                    {inWishlist ? (
                        <div className="px-3 py-1 bg-gray-600 text-gray-300 rounded text-sm text-center">
                            📋 W wishliście
                        </div>
                    ) : (
                        <button
                            onClick={handleAdd}
                            disabled={isAdding}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white rounded text-sm"
                        >
                            {isAdding ? '...' : '+ Dodaj'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};


const WishlistView = () => {
    const [wishlist, setWishlist] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [activeTab, setActiveTab] = useState('wishlist');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [selectedMatches, setSelectedMatches] = useState(null);
    const [showMatchesModal, setShowMatchesModal] = useState(false);

    const fetchData = React.useCallback(async () => {
        try {
            setLoading(true);
            const [wishlistRes, statsRes] = await Promise.all([
                axios.get('/api/wishlist'),
                axios.get('/api/wishlist/stats')
            ]);
            
            setWishlist(wishlistRes.data);
            setStats(statsRes.data);
        } catch (error) {
            console.error('Błąd ładowania wishlisty:', error);
            setMessage('Błąd ładowania danych wishlisty.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const searchTMDB = React.useCallback(async () => {
        if (!searchQuery.trim() || searchQuery.length < 2) {
            setSearchResults([]);
            return;
        }

        setSearching(true);
        try {
            const response = await axios.get('/api/tmdb/search', {
                params: { query: searchQuery, type: 'multi' }
            });
            setSearchResults(response.data.results || []);
        } catch (error) {
            console.error('Błąd wyszukiwania TMDB:', error);
            setMessage('Błąd wyszukiwania w TMDB.');
        } finally {
            setSearching(false);
        }
    }, [searchQuery]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (activeTab === 'add') {
                searchTMDB();
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery, activeTab, searchTMDB]);

    const handleAddToWishlist = async (tmdbItem) => {
        try {
            await axios.post('/api/wishlist', {
                tmdb_id: tmdbItem.id,
                media_type: tmdbItem.media_type,
                priority: 1,
                auto_download: true
            });
            
            setMessage(`Dodano "${tmdbItem.title || tmdbItem.name}" do wishlisty!`);
            setTimeout(() => setMessage(''), 3000);
            fetchData();
            
            setSearchResults(prev => prev.map(item => 
                item.id === tmdbItem.id && item.media_type === tmdbItem.media_type
                    ? { ...item, in_wishlist: true, wishlist_status: 'wanted' }
                    : item
            ));
        } catch (error) {
            console.error('Błąd dodawania do wishlisty:', error);
            setMessage(error.response?.data?.error || 'Błąd dodawania do wishlisty.');
        }
    };

    const handleResetWishlistItem = async (id) => {
        if (!window.confirm('Czy na pewno chcesz zresetować status tej pozycji? Będzie ponownie sprawdzona.')) {
            return;
        }

        try {
            await axios.post(`/api/wishlist/${id}/reset`);
            setMessage('Pozycja została zresetowana i będzie ponownie sprawdzona.');
            setTimeout(() => setMessage(''), 3000);
            fetchData();
        } catch (error) {
            console.error('Błąd resetowania pozycji:', error);
            setMessage('Błąd resetowania pozycji.');
        }
    };

    const handleMarkCompleted = async (id) => {
        if (!window.confirm('Czy na pewno chcesz oznaczyć tę pozycję jako ukończoną?')) {
            return;
        }

        try {
            await axios.post(`/api/wishlist/${id}/mark-completed`);
            setMessage('Pozycja została oznaczona jako ukończona.');
            setTimeout(() => setMessage(''), 3000);
            fetchData();
        } catch (error) {
            console.error('Błąd oznaczania jako ukończone:', error);
            setMessage('Błąd oznaczania jako ukończone.');
        }
    };

    const handleUpdateWishlist = async (id, updates) => {
        try {
            await axios.put(`/api/wishlist/${id}`, updates);
            setMessage('Pozycja wishlisty została zaktualizowana.');
            setTimeout(() => setMessage(''), 3000);
            fetchData();
        } catch (error) {
            console.error('Błąd aktualizacji wishlisty:', error);
            setMessage('Błąd aktualizacji pozycji wishlisty.');
        }
    };

    const handleDeleteFromWishlist = async (id) => {
        if (!window.confirm('Czy na pewno chcesz usunąć tę pozycję z wishlisty?')) {
            return;
        }

        try {
            await axios.delete(`/api/wishlist/${id}`);
            setMessage('Pozycja została usunięta z wishlisty.');
            setTimeout(() => setMessage(''), 3000);
            fetchData();
        } catch (error) {
            console.error('Błąd usuwania z wishlisty:', error);
            setMessage('Błąd usuwania z wishlisty.');
        }
    };

    const handleCheckWishlist = async () => {
        try {
            setMessage('Sprawdzanie wishlisty...');
            const response = await axios.post('/api/wishlist/check');
            setMessage(response.data.message);
            setTimeout(() => setMessage(''), 5000);
            fetchData();
        } catch (error) {
            console.error('Błąd sprawdzania wishlisty:', error);
            setMessage('Błąd sprawdzania wishlisty.');
        }
    };

    const handleViewMatches = async (item) => {
        try {
            const response = await axios.get(`/api/wishlist/${item.id}/matches`);
            setSelectedItem(item);
            setSelectedMatches(response.data);
            setShowMatchesModal(true);
        } catch (error) {
            console.error('Błąd pobierania matchy:', error);
            setMessage('Błąd pobierania matchy.');
        }
    };

    const handleDownloadMatch = async (wishlistId, matchId) => {
        try {
            await axios.post(`/api/wishlist/${wishlistId}/download/${matchId}`);
            setMessage('Pobieranie rozpoczęte!');
            setTimeout(() => setMessage(''), 3000);
            setShowMatchesModal(false);
            fetchData();
        } catch (error) {
            console.error('Błąd pobierania matcha:', error);
            setMessage('Błąd rozpoczynania pobierania.');
        }
    };

    const handleAutoDownload = async (item) => {
        if (item.match_count === 0) {
            setMessage('Brak matchy do pobrania.');
            return;
        }

        try {
            const matchesResponse = await axios.get(`/api/wishlist/${item.id}/matches`);
            const bestMatch = matchesResponse.data[0];
            
            if (bestMatch) {
                await handleDownloadMatch(item.id, bestMatch.id);
            }
        } catch (error) {
            console.error('Błąd auto-download:', error);
            setMessage('Błąd auto-download.');
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-8">
                <div className="text-gray-400">Ładowanie wishlisty...</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {stats && (
    <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Statystyki Wishlisty</h3>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-4 text-center">
            <div className="bg-blue-900/50 p-4 rounded">
                <div className="text-2xl font-bold text-blue-300">{stats.statistics.total || 0}</div>
                <div className="text-gray-400">Łącznie</div>
            </div>
            <div className="bg-yellow-900/50 p-4 rounded">
                <div className="text-2xl font-bold text-yellow-300">{stats.statistics.wanted || 0}</div>
                <div className="text-gray-400">Poszukiwane</div>
            </div>
            <div className="bg-green-900/50 p-4 rounded">
                <div className="text-2xl font-bold text-green-300">{stats.statistics.found || 0}</div>
                <div className="text-gray-400">Znalezione</div>
            </div>
            <div className="bg-orange-900/50 p-4 rounded">
                <div className="text-2xl font-bold text-orange-300">{stats.statistics.requires_selection || 0}</div>
                <div className="text-gray-400 text-xs">Wymaga wyboru</div>
            </div>
            <div className="bg-purple-900/50 p-4 rounded">
                <div className="text-2xl font-bold text-purple-300">{stats.statistics.downloading || 0}</div>
                <div className="text-gray-400">Pobierane</div>
            </div>
            <div className="bg-gray-900/50 p-4 rounded">
                <div className="text-2xl font-bold text-gray-300">{stats.statistics.completed || 0}</div>
                <div className="text-gray-400">Ukończone</div>
            </div>
            <div className="bg-red-900/50 p-4 rounded">
                <div className="text-2xl font-bold text-red-300">{stats.statistics.auto_download_enabled || 0}</div>
                <div className="text-gray-400">Auto-DL</div>
            </div>
        </div>

        {/* Dodatkowe informacje o statusach */}
        {(stats.statistics.requires_selection > 0 || stats.statistics.found > 0) && (
            <div className="mt-4 p-3 bg-gray-900/50 rounded">
                <div className="text-sm text-gray-300 space-y-1">
                    {stats.statistics.requires_selection > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-orange-400">🤔</span>
                            <span>
                                <strong>{stats.statistics.requires_selection}</strong> pozycji wymaga ręcznego wyboru wersji
                            </span>
                        </div>
                    )}
                    {stats.statistics.found > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-green-400">🎯</span>
                            <span>
                                <strong>{stats.statistics.found}</strong> pozycji gotowych do automatycznego pobierania
                            </span>
                        </div>
                    )}
                </div>
            </div>
        )}
    </div>
)}

            {message && (
                <div className={`p-4 rounded-lg ${
                    message.includes('Błąd') || message.includes('błąd') ? 
                    'bg-red-900/50 text-red-300 border border-red-700' : 
                    'bg-green-900/50 text-green-300 border border-green-700'
                }`}>
                    {message}
                </div>
            )}

            <div className="flex justify-between items-center">
                <nav className="flex space-x-8">
                    <button
                        onClick={() => setActiveTab('wishlist')}
                        className={`py-2 px-1 border-b-2 font-medium text-sm ${
                            activeTab === 'wishlist'
                                ? 'border-red-500 text-red-400'
                                : 'border-transparent text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        Moja Wishlist ({wishlist.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('add')}
                        className={`py-2 px-1 border-b-2 font-medium text-sm ${
                            activeTab === 'add'
                                ? 'border-red-500 text-red-400'
                                : 'border-transparent text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        Dodaj Nowe
                    </button>
                </nav>

                {activeTab === 'wishlist' && (
                    <button
                        onClick={handleCheckWishlist}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
                    >
                        🔍 Sprawdź Wishlistę
                    </button>
                )}
            </div>

            {activeTab === 'wishlist' && (
                <div className="space-y-4">
                    {wishlist.length === 0 ? (
                        <div className="bg-gray-800 rounded-lg p-8 text-center">
                            <div className="text-gray-400 mb-4">Twoja wishlist jest pusta</div>
                            <button
                                onClick={() => setActiveTab('add')}
                                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
                            >
                                Dodaj Pierwszą Pozycję
                            </button>
                        </div>
                    ) : (
                        wishlist.map(item => (
                            <WishlistCard
                                key={item.id}
                                item={item}
                                onUpdate={handleUpdateWishlist}
                                onDelete={handleDeleteFromWishlist}
                                onDownload={handleAutoDownload}
                                onViewMatches={handleViewMatches}
                            />
                        ))
                    )}
                </div>
            )}

            {activeTab === 'add' && (
                <div>
                    <div className="bg-gray-800 rounded-lg p-6 mb-6">
                        <h3 className="text-lg font-semibold text-white mb-4">Wyszukaj w TMDB</h3>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Wpisz nazwę filmu lub serialu..."
                                className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                            <button
                                onClick={searchTMDB}
                                disabled={searching}
                                className="bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white font-bold py-3 px-6 rounded-lg transition duration-300"
                            >
                                {searching ? 'Szukam...' : 'Szukaj'}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {searchResults.length === 0 && searchQuery.length >= 2 && !searching && (
                            <div className="bg-gray-800 rounded-lg p-6 text-center text-gray-400">
                                Brak wyników dla "{searchQuery}"
                            </div>
                        )}
                        
                        {searchResults.map((item) => (
                            <TMDBSearchResult
                                key={`${item.id}_${item.media_type}`}
                                item={item}
                                onAdd={handleAddToWishlist}
                                inWishlist={item.in_wishlist}
                            />
                        ))}
                    </div>
                </div>
            )}

            {showMatchesModal && (
                <WishlistMatchesModal
                    item={selectedItem}
                    matches={selectedMatches}
                    onClose={() => setShowMatchesModal(false)}
                    onDownload={handleDownloadMatch}
                />
            )}
        </div>
    );
};

// --- Główny Komponent Aplikacji ---
function App() {
  const [route, setRoute] = useState({ path: 'home', params: {} });
  const [favorites, setFavorites] = useState(new Set());
  const [downloads, setDownloads] = useState([]);
  const [isWidgetOpen, setIsWidgetOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);


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
        case 'wishlist':  
            return <WishlistView />;
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
      {/* Logo */}
      <a href="#/home" className="text-2xl font-bold text-white no-underline">
        <span className="text-red-500">M</span>ediaCenter
      </a>
      
      {/* Desktop Menu */}
      <div className="hidden md:flex items-center space-x-4">
        <button 
          onClick={() => setIsWidgetOpen(!isWidgetOpen)} 
          className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 relative"
        >
          Pobierane
          {downloads.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              {downloads.length}
            </span>
          )}
        </button>
        <a href="#/home" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium no-underline transition-colors duration-200">
          Strona Główna
        </a>
        <a href="#/wishlist" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium no-underline transition-colors duration-200">
          Wishlist
        </a>
        <a href="#/settings" className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium no-underline transition-colors duration-200">
          Ustawienia
        </a>
      </div>

      {/* Mobile menu button */}
      <div className="md:hidden">
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="text-gray-300 hover:text-white focus:outline-none focus:text-white transition-colors duration-200"
          aria-label="Toggle menu"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {isMobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>
    </div>

    {/* Mobile Menu */}
    <div className={`md:hidden transition-all duration-300 ease-in-out ${
      isMobileMenuOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
    }`}>
      <div className="px-2 pt-2 pb-3 space-y-1 bg-gray-800/90 rounded-lg mt-2">
        <button 
          onClick={() => {
            setIsWidgetOpen(!isWidgetOpen);
            setIsMobileMenuOpen(false);
          }} 
          className="text-gray-300 hover:text-white block px-3 py-2 rounded-md text-base font-medium w-full text-left transition-colors duration-200 relative"
        >
          Pobierane
          {downloads.length > 0 && (
            <span className="absolute top-2 right-3 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              {downloads.length}
            </span>
          )}
        </button>
        
        <a 
          href="#/home" 
          onClick={() => setIsMobileMenuOpen(false)}
          className="text-gray-300 hover:text-white block px-3 py-2 rounded-md text-base font-medium no-underline transition-colors duration-200"
        >
          🏠 Strona Główna
        </a>
        
        <a 
          href="#/wishlist" 
          onClick={() => setIsMobileMenuOpen(false)}
          className="text-gray-300 hover:text-white block px-3 py-2 rounded-md text-base font-medium no-underline transition-colors duration-200"
        >
          ⭐ Wishlist
        </a>
        
        <a 
          href="#/settings" 
          onClick={() => setIsMobileMenuOpen(false)}
          className="text-gray-300 hover:text-white block px-3 py-2 rounded-md text-base font-medium no-underline transition-colors duration-200"
        >
          ⚙️ Ustawienia
        </a>
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
