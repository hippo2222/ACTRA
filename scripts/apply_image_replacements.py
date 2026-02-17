import os
import json

PROJECT_ROOT = "d:/Ai Ai/radioproject"
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
MAP_FILE = os.path.join(PROJECT_ROOT, "image_map.json")

def main():
    print("Applying image replacements...")
    
    if not os.path.exists(MAP_FILE):
        print("Map file not found!")
        return

    with open(MAP_FILE, "r", encoding="utf-8") as f:
        image_map = json.load(f)
    
    # Sort keys by length desc to avoid partial replacement issues
    urls = sorted(image_map.keys(), key=len, reverse=True)
    
    count = 0
    for root, dirs, files in os.walk(FRONTEND_DIR):
        for file in files:
            if not file.endswith(".html"):
                continue
                
            path = os.path.join(root, file)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            
            original_content = content
            for url in urls:
                if url in content:
                    local_path = image_map[url]
                    # Specific fix for background-image: url('...')
                    # The download script saves as /assets/images/...
                    # server.py serves /assets/ from frontend/assets
                    # so /assets/images/... is correct relative to domain root
                    content = content.replace(url, local_path)
            
            # Additional cleanup for specific DiceBear pattern with dynamic seed
            # Regex replacement for any dicebear url not caught by exact match
            # (though our download script gathered all exact matches found)
            
            if content != original_content:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
                print(f"Updated: {file}")
                count += 1

    print(f"Replacement complete. Updated {count} files.")

if __name__ == "__main__":
    main()
