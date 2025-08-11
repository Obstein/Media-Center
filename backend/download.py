import sys
import requests
import os

def download_file(url, output_path):
    try:
        # Utwórz folder, jeśli nie istnieje
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        with requests.get(url, headers=headers, stream=True, allow_redirects=True) as r:
            r.raise_for_status()
            with open(output_path, 'wb') as f:
                for chunk in r.iter_content(chunk_size=8192): 
                    f.write(chunk)
        print("SUCCESS")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python download.py <URL> <OUTPUT_PATH>", file=sys.stderr)
        sys.exit(1)
        
    download_url = sys.argv[1]
    output_file_path = sys.argv[2]
    
    download_file(download_url, output_file_path)
