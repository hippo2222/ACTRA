import os
import re
import json
import requests
import hashlib
from urllib.parse import urlparse
from bs4 import BeautifulSoup

PROJECT_ROOT = "d:/Ai Ai/radioproject"
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
ASSETS_DIR = os.path.join(FRONTEND_DIR, "assets", "images")
MAP_FILE = os.path.join(PROJECT_ROOT, "image_map.json")

# Mapping categories based on usage context or filename
# This is a heuristic. We can iterate.
def get_category_path(url, filename, context_file):
    if "dicebear" in url:
        return os.path.join("avatars", "dicebear_default.svg")
    
    if "Calendar" in context_file:
         # Heuristic for calendar backgrounds
         if "blue" in filename.lower() or "gradient" in filename.lower(): 
             return os.path.join("calendar", "calendar_bg_blue.jpg")
         if "purple" in filename.lower() or "geometric" in filename.lower():
             return os.path.join("calendar", "calendar_bg_purple.jpg")
         return os.path.join("calendar", f"cal_img_{hash_url(url)}.jpg")

    if "MainScreen" in context_file and "BQdWMVC" in url: # known ID for main bg
        return os.path.join("dashboard", "main_training_bg.jpg")
    
    if "TestUI" in context_file or "snippets" in context_file or "ClickUI" in context_file:
         return os.path.join("tasks", f"task_{hash_url(url)}.jpg")

    return os.path.join("misc", f"img_{hash_url(url)}.jpg")

def hash_url(url):
    return hashlib.md5(url.encode()).hexdigest()[:8]

def main():
    print("Scanning for external images...")
    
    external_urls = set()
    usage_context = {} # url -> first file it was found in

    # Regex to find URLs roughly
    url_pattern = re.compile(r'(https?://(?:lh3\.googleusercontent\.com|api\.dicebear\.com)[^\s\'")]+)')

    for root, dirs, files in os.walk(FRONTEND_DIR):
        for file in files:
            if not file.endswith(".html"):
                continue
                
            path = os.path.join(root, file)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
                matches = url_pattern.findall(content)
                for url in matches:
                    external_urls.add(url)
                    if url not in usage_context:
                        usage_context[url] = path

    print(f"Found {len(external_urls)} unique external images.")
    
    image_map = {} # url -> local_relative_path

    for url in external_urls:
        try:
            print(f"Downloading: {url[:50]}...")
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            # Determine filename and path
            context = usage_context[url]
            # Try to get extension from header or url
            content_type = response.headers.get('content-type', '')
            ext = '.jpg'
            if 'svg' in content_type or 'svg' in url:
                ext = '.svg'
            elif 'png' in content_type:
                ext = '.png'
            
            # Clean url for hashing/naming
            safe_name = hash_url(url) + ext
            
            # Determine category
            rel_path = get_category_path(url, safe_name, context)
            
            # If it's a known semantic file (like dashboard bg), force that name
            # We hardcoded logic in get_category_path for some knowns
            
            full_save_path = os.path.join(ASSETS_DIR, rel_path)
            os.makedirs(os.path.dirname(full_save_path), exist_ok=True)
            
            with open(full_save_path, "wb") as f:
                f.write(response.content)
                
            # Map is from URL to /assets/images/...
            # We need to escape the windows path separators
            web_path = "/assets/images/" + rel_path.replace("\\", "/")
            image_map[url] = web_path
            
        except Exception as e:
            print(f"Failed to download {url}: {e}")

    # Save map
    with open(MAP_FILE, "w", encoding="utf-8") as f:
        json.dump(image_map, f, indent=2)
    
    print(f"Download complete. Map saved to {MAP_FILE}")

if __name__ == "__main__":
    main()
