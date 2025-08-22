#!/usr/bin/env python3
# download_manager.py - Kompletny system pobierania z curl i daemon mode

import sys
import os
import sqlite3
import threading
import queue
import subprocess
import time
import json
from urllib.parse import urlparse
import signal
from contextlib import contextmanager

# --- Konfiguracja ---
DATABASE_PATH = "/app/config/database.sqlite"
DOWNLOAD_LOG_FILE = "/app/config/downloads.log"

# Upewnij się, że folder config istnieje
os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)

class DownloadManager:
    def __init__(self):
        self.download_queue = queue.Queue()
        self.worker_thread = None
        self.running = True
        
        # Inicjalizuj bazę danych
        self.init_database()
        
        # Przywróć zadania z bazy do kolejki
        self.restore_queue_from_db()
        
        # Uruchom worker
        self.start_worker()
        
        # Obsługa sygnałów dla graceful shutdown
        signal.signal(signal.SIGTERM, self.shutdown)
        signal.signal(signal.SIGINT, self.shutdown)

    @contextmanager
    def get_db_connection(self):
        """Context manager dla połączeń z bazą danych"""
        conn = sqlite3.connect(DATABASE_PATH, timeout=30.0)
        conn.row_factory = sqlite3.Row  # Dostęp do kolumn po nazwie
        try:
            yield conn
        finally:
            conn.close()

    def init_database(self):
        """Inicjalizacja tabel bazy danych"""
        try:
            with self.get_db_connection() as conn:
                cursor = conn.cursor()
                
                # Sprawdź czy tabela downloads istnieje
                cursor.execute("""
                    SELECT name FROM sqlite_master 
                    WHERE type='table' AND name='downloads'
                """)
                
                if not cursor.fetchone():
                    self.log_message("Tabela downloads nie istnieje, pomijam inicjalizację")
                    return
                
                # Sprawdź czy kolumny istnieją
                cursor.execute("PRAGMA table_info(downloads)")
                columns = [column[1] for column in cursor.fetchall()]
                
                if 'download_status' not in columns:
                    cursor.execute('ALTER TABLE downloads ADD COLUMN download_status TEXT DEFAULT "pending"')
                    self.log_message("Dodano kolumnę download_status")
                
                if 'download_url' not in columns:
                    cursor.execute('ALTER TABLE downloads ADD COLUMN download_url TEXT')
                    self.log_message("Dodano kolumnę download_url")
                
                if 'worker_status' not in columns:
                    cursor.execute('ALTER TABLE downloads ADD COLUMN worker_status TEXT DEFAULT "queued"')
                    self.log_message("Dodano kolumnę worker_status")
                
                # Utwórz tabelę logów pobierania jeśli nie istnieje
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS download_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        download_id INTEGER,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        level TEXT DEFAULT 'INFO',
                        message TEXT,
                        FOREIGN KEY (download_id) REFERENCES downloads(id)
                    )
                ''')
                
                conn.commit()
                self.log_message("Baza danych zainicjalizowana")
                
        except Exception as e:
            self.log_message(f"Błąd inicjalizacji bazy: {e}", 'ERROR')

    def restore_queue_from_db(self):
        """Przywróć zadania z bazy do kolejki w pamięci"""
        try:
            with self.get_db_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute('''
                    SELECT * FROM downloads 
                    WHERE worker_status IN ('queued', 'downloading')
                    ORDER BY added_at ASC
                ''')
                
                pending_downloads = cursor.fetchall()
                
                for download in pending_downloads:
                    # Resetuj status na queued po restarcie
                    cursor.execute('UPDATE downloads SET worker_status = "queued" WHERE id = ?', (download['id'],))
                    
                    # Sprawdź czy mamy potrzebne dane
                    if download['download_url'] and download['filepath']:
                        job = {
                            'db_id': download['id'],
                            'item_id': download['episode_id'],
                            'url': download['download_url'],
                            'output_path': download['filepath'],
                            'title': download['filename'] or 'Unknown',
                            'item_type': download['stream_type']
                        }
                        self.download_queue.put(job)
                    
                conn.commit()
                self.log_message(f"Przywrócono {len(pending_downloads)} zadań do kolejki")
                
        except Exception as e:
            self.log_message(f"Błąd przywracania kolejki: {e}", 'ERROR')

    def log_message(self, message, level='INFO', download_id=None):
        """Zapisz wiadomość do logu (plik + baza)"""
        try:
            # Log do pliku
            with open(DOWNLOAD_LOG_FILE, 'a', encoding='utf-8') as f:
                timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
                f.write(f"[{timestamp}] [{level}] {message}\n")
            
            # Log do bazy (tylko jeśli download_id podane)
            if download_id:
                try:
                    with self.get_db_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute('''
                            INSERT INTO download_logs (download_id, level, message)
                            VALUES (?, ?, ?)
                        ''', (download_id, level, message))
                        conn.commit()
                except Exception as db_error:
                    print(f"Błąd zapisu logu do bazy: {db_error}")
            
            print(f"[{level}] {message}")
            
        except Exception as e:
            print(f"Błąd zapisu do logu: {e}")
            print(f"[{level}] {message}")  # Przynajmniej wyświetl w konsoli

    def download_with_curl(self, url, output_path, download_id, retries=3):
        """Pobierz plik używając curl"""
        for attempt in range(retries):
            try:
                self.log_message(f"Próba {attempt + 1}/{retries}: {os.path.basename(output_path)}", 
                               download_id=download_id)
                
                # Utwórz folder jeśli nie istnieje
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                
                # Komenda curl
                cmd = [
                    'curl',
                    '--location',  # Podążaj za przekierowaniami
                    '--fail',  # Zakończ z błędem przy HTTP error
                    '--retry', '3',  # Retry 3 razy
                    '--retry-delay', '5',  # Opóźnienie między retry
                    '--connect-timeout', '30',  # Timeout połączenia
                    '--max-time', '1800',  # Max czas pobierania (30 min)
                    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--continue-at', '-',  # Kontynuuj przerwane pobieranie
                    '--output', output_path,  # Plik wyjściowy
                    '--progress-bar',  # Pokazuj pasek postępu
                    url
                ]
                
                # Uruchom curl
                process = subprocess.Popen(
                    cmd, 
                    stdout=subprocess.PIPE, 
                    stderr=subprocess.STDOUT, 
                    universal_newlines=True
                )
                
                # Loguj output w czasie rzeczywistym
                for line in process.stdout:
                    if line.strip():
                        # Filtruj progress bar (zbyt verbose)
                        if not line.startswith('#') and not line.startswith('%'):
                            self.log_message(f"curl: {line.strip()}", download_id=download_id)
                
                process.wait()
                
                if process.returncode == 0:
                    # Sprawdź czy plik faktycznie został pobrany
                    if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                        self.log_message(f"✅ Pobieranie ukończone: {os.path.basename(output_path)}", 
                                       'SUCCESS', download_id)
                        return True
                    else:
                        self.log_message(f"❌ Plik nie został pobrany lub jest pusty", 
                                       'ERROR', download_id)
                else:
                    self.log_message(f"❌ curl zakończył się z kodem {process.returncode}", 
                                   'ERROR', download_id)
                    
            except Exception as e:
                self.log_message(f"❌ Błąd podczas pobierania (próba {attempt + 1}): {e}", 
                               'ERROR', download_id)
                
            if attempt < retries - 1:
                wait_time = (attempt + 1) * 5
                self.log_message(f"Czekam {wait_time}s przed kolejną próbą...", 
                               'WARNING', download_id)
                time.sleep(wait_time)
        
        return False

    def update_download_status(self, download_id, worker_status, download_status=None, progress=None, error_message=None):
        """Aktualizuj status pobierania w bazie"""
        try:
            with self.get_db_connection() as conn:
                cursor = conn.cursor()
                
                update_fields = ['worker_status = ?']
                params = [worker_status]
                
                if download_status:
                    update_fields.append('download_status = ?')
                    params.append(download_status)
                
                if progress is not None:
                    update_fields.append('progress = ?')
                    params.append(progress)
                
                if error_message:
                    update_fields.append('error_message = ?')
                    params.append(error_message)
                
                params.append(download_id)
                
                sql = f"UPDATE downloads SET {', '.join(update_fields)} WHERE id = ?"
                cursor.execute(sql, params)
                conn.commit()
                
        except Exception as e:
            self.log_message(f"Błąd aktualizacji statusu: {e}", 'ERROR')

    def download_worker(self):
        """Worker pobierania - działa w osobnym wątku"""
        self.log_message("🚀 Worker pobierania uruchomiony")
        
        while self.running:
            try:
                # Pobierz zadanie z kolejki (timeout 1s aby móc sprawdzać self.running)
                job = self.download_queue.get(timeout=1.0)
                
                db_id = job.get("db_id")
                item_id = job.get("item_id")
                url = job.get("url")
                output_path = job.get("output_path")
                title = job.get("title", "Nieznany tytuł")
                item_type = job.get("item_type", "unknown")
                
                if not all([db_id, url, output_path]):
                    self.log_message(f"❌ Niekompletne zadanie: {job}", 'ERROR')
                    self.download_queue.task_done()
                    continue
                
                # Aktualizuj status na "downloading"
                self.update_download_status(db_id, 'downloading', 'downloading')
                self.log_message(f"🔄 Rozpoczynam pobieranie: {title} (ID: {item_id})", 
                               download_id=db_id)
                
                # Pobierz plik
                success = self.download_with_curl(url, output_path, db_id)
                
                if success:
                    # Oznacz jako ukończone
                    self.update_download_status(db_id, 'completed', 'completed', 100)
                    self.log_message(f"✅ Ukończono: {title}", 'SUCCESS', db_id)
                else:
                    # Oznacz jako nieudane
                    self.update_download_status(db_id, 'failed', 'failed', 0, 
                                              'Pobieranie nieudane po wszystkich próbach')
                    self.log_message(f"❌ Nieudane pobieranie: {title}", 'ERROR', db_id)
                
                self.download_queue.task_done()
                
            except queue.Empty:
                # Timeout - kontynuuj pętlę
                continue
            except Exception as e:
                self.log_message(f"❌ Błąd w workerze: {e}", 'ERROR')
                if 'db_id' in locals():
                    self.update_download_status(db_id, 'failed', 'failed', 0, str(e))
                    self.download_queue.task_done()

    def start_worker(self):
        """Uruchom worker pobierania"""
        if self.worker_thread is None or not self.worker_thread.is_alive():
            self.worker_thread = threading.Thread(target=self.download_worker, daemon=True)
            self.worker_thread.start()

    def get_status(self):
        """Pobierz status wszystkich zadań z bazy"""
        try:
            with self.get_db_connection() as conn:
                cursor = conn.cursor()
                
                # Statystyki ogólne
                cursor.execute('''
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN worker_status = 'queued' THEN 1 ELSE 0 END) as queued,
                        SUM(CASE WHEN worker_status = 'downloading' THEN 1 ELSE 0 END) as downloading,
                        SUM(CASE WHEN worker_status = 'completed' THEN 1 ELSE 0 END) as completed,
                        SUM(CASE WHEN worker_status = 'failed' THEN 1 ELSE 0 END) as failed
                    FROM downloads
                ''')
                
                stats = cursor.fetchone()
                
                # Aktywne zadania
                cursor.execute('''
                    SELECT id, filename, worker_status, progress, error_message, added_at
                    FROM downloads 
                    WHERE worker_status IN ('queued', 'downloading', 'failed')
                    ORDER BY added_at ASC
                    LIMIT 20
                ''')
                
                active_jobs = [dict(row) for row in cursor.fetchall()]
                
                return {
                    "queue_size": self.download_queue.qsize(),
                    "stats": dict(stats) if stats else {},
                    "active_jobs": active_jobs
                }
        except Exception as e:
            self.log_message(f"Błąd pobierania statusu: {e}", 'ERROR')
            return {"queue_size": 0, "stats": {}, "active_jobs": []}

    def shutdown(self, signum=None, frame=None):
        """Graceful shutdown"""
        self.log_message("🛑 Zatrzymywanie download managera...")
        self.running = False
        
        # Poczekaj na zakończenie workera
        if self.worker_thread and self.worker_thread.is_alive():
            self.worker_thread.join(timeout=30)
        
        self.log_message("✅ Download manager zatrzymany")

# --- API dla pojedynczych pobierań (kompatybilność z istniejącym kodem) ---
def single_download(url, output_path):
    """Funkcja dla pojedynczego pobierania - kompatybilność wsteczna"""
    try:
        # Utwórz folder jeśli nie istnieje
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Komenda curl
        cmd = [
            'curl',
            '--location',  # Podążaj za przekierowaniami
            '--fail',  # Zakończ z błędem przy HTTP error
            '--retry', '3',  # Retry 3 razy
            '--retry-delay', '5',  # Opóźnienie między retry
            '--connect-timeout', '30',  # Timeout połączenia
            '--max-time', '1800',  # Max czas pobierania (30 min)
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--continue-at', '-',  # Kontynuuj przerwane pobieranie
            '--output', output_path,  # Plik wyjściowy
            '--progress-bar',  # Pokazuj pasek postępu
            url
        ]
        
        print(f"Rozpoczynam pobieranie: {os.path.basename(output_path)}", file=sys.stderr)
        
        # Uruchom curl
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        
        for line in process.stdout:
            if line.strip() and not line.startswith('#') and not line.startswith('%'):
                print(f"curl: {line.strip()}", file=sys.stderr)
        
        process.wait()
        
        if process.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print("SUCCESS")
            return 0
        else:
            print(f"FAILED with curl code {process.returncode}", file=sys.stderr)
            return 1
            
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

# --- Główna funkcja ---
def main():
    if len(sys.argv) == 3:
        # Tryb pojedynczego pobierania (kompatybilność z istniejącym kodem)
        download_url = sys.argv[1]
        output_file_path = sys.argv[2]
        return single_download(download_url, output_file_path)
    
    elif len(sys.argv) == 2 and sys.argv[1] == "--daemon":
        # Tryb daemon - uruchom tylko manager
        try:
            manager = DownloadManager()
            print("Download Manager uruchomiony w trybie daemon")
            print("Naciśnij Ctrl+C aby zatrzymać...")
            
            while manager.running:
                time.sleep(1)
                
        except KeyboardInterrupt:
            print("\nZatrzymywanie...")
            manager.shutdown()
        
        return 0
    
    else:
        print("Użycie:")
        print("  python download_manager.py <URL> <ŚCIEŻKA>     # Pojedyncze pobieranie")
        print("  python download_manager.py --daemon            # Tryb daemon")
        return 1

if __name__ == "__main__":
    sys.exit(main())
