import sys
import requests
import os
import time
import socket
from urllib.parse import urlparse

def test_dns_resolution(hostname):
    """Test if hostname can be resolved"""
    try:
        socket.gethostbyname(hostname)
        return True
    except socket.gaierror:
        return False

def download_file(url, output_path):
    try:
        # Parse URL to get hostname
        parsed_url = urlparse(url)
        hostname = parsed_url.netloc
        
        print(f"Testing DNS resolution for: {hostname}", file=sys.stderr)
        
        # Test DNS resolution first
        if not test_dns_resolution(hostname):
            print(f"DNS Error: Cannot resolve hostname '{hostname}'", file=sys.stderr)
            print("Possible solutions:", file=sys.stderr)
            print("1. Check your internet connection", file=sys.stderr)
            print("2. Try different DNS servers (8.8.8.8, 1.1.1.1)", file=sys.stderr)
            print("3. Contact your Xtream provider - the URL might be invalid", file=sys.stderr)
            sys.exit(1)
        
        # Create folder if it doesn't exist
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Enhanced headers to mimic real browser
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
        
        print(f"Starting download from: {parsed_url.scheme}://{hostname}...", file=sys.stderr)
        
        # Configure request with retries and timeout
        session = requests.Session()
        session.headers.update(headers)
        
        # Handle redirects properly
        session.max_redirects = 10
        
        # Retry mechanism
        max_retries = 3
        for attempt in range(max_retries):
            try:
                with session.get(
                    url, 
                    stream=True, 
                    allow_redirects=True,
                    timeout=(30, 300),  # (connect timeout, read timeout)
                    verify=False  # Skip SSL verification for some IPTV providers
                ) as r:
                    r.raise_for_status()
                    
                    # Check if we got actual video content
                    content_type = r.headers.get('content-type', '').lower()
                    if 'text/html' in content_type or 'application/json' in content_type:
                        print(f"Warning: Received {content_type} instead of video content", file=sys.stderr)
                        print(f"Response content preview: {r.text[:200]}...", file=sys.stderr)
                    
                    # Download with progress
                    total_size = int(r.headers.get('content-length', 0))
                    downloaded = 0
                    
                    with open(output_path, 'wb') as f:
                        for chunk in r.iter_content(chunk_size=8192): 
                            if chunk:  # filter out keep-alive chunks
                                f.write(chunk)
                                downloaded += len(chunk)
                                
                                # Simple progress indicator
                                if total_size > 0:
                                    progress = (downloaded / total_size) * 100
                                    if downloaded % (1024 * 1024) == 0:  # Print every MB
                                        print(f"Progress: {progress:.1f}% ({downloaded}/{total_size} bytes)", file=sys.stderr)
                    
                    print(f"Download completed: {downloaded} bytes", file=sys.stderr)
                    break
                    
            except requests.exceptions.ConnectTimeout:
                print(f"Connection timeout (attempt {attempt + 1}/{max_retries})", file=sys.stderr)
                if attempt < max_retries - 1:
                    time.sleep(5)
                    continue
                else:
                    raise
                    
            except requests.exceptions.ReadTimeout:
                print(f"Read timeout (attempt {attempt + 1}/{max_retries})", file=sys.stderr)
                if attempt < max_retries - 1:
                    time.sleep(5)
                    continue
                else:
                    raise
                    
            except requests.exceptions.ConnectionError as e:
                print(f"Connection error (attempt {attempt + 1}/{max_retries}): {e}", file=sys.stderr)
                if attempt < max_retries - 1:
                    time.sleep(10)
                    continue
                else:
                    raise
        
        print("SUCCESS")
        
    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error {e.response.status_code}: {e.response.reason}", file=sys.stderr)
        if e.response.status_code == 404:
            print("The file was not found on the server. Check if the URL is correct.", file=sys.stderr)
        elif e.response.status_code == 403:
            print("Access forbidden. Check your Xtream credentials.", file=sys.stderr)
        elif e.response.status_code == 401:
            print("Unauthorized. Check your username and password.", file=sys.stderr)
        sys.exit(1)
        
    except requests.exceptions.ConnectionError as e:
        print(f"Connection Error: {e}", file=sys.stderr)
        print("This might be due to:", file=sys.stderr)
        print("- Network connectivity issues", file=sys.stderr)
        print("- Blocked domain by ISP", file=sys.stderr)
        print("- Server downtime", file=sys.stderr)
        sys.exit(1)
        
    except requests.exceptions.Timeout:
        print("Request timed out. The server might be slow or overloaded.", file=sys.stderr)
        sys.exit(1)
        
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python download.py <URL> <OUTPUT_PATH>", file=sys.stderr)
        sys.exit(1)
        
    download_url = sys.argv[1]
    output_file_path = sys.argv[2]
    
    download_file(download_url, output_file_path)
