import os
import re
import sys

# Unbuffered output
sys.stdout.reconfigure(encoding='utf-8')

FRONTEND_DIR = r'd:\Ai Ai\radioproject\frontend'
ASSETS_DIR_NAME = 'assets'

def get_relative_path_to_assets(file_path):
    """Calculates relative path from file to frontend/assets"""
    file_dir = os.path.dirname(file_path)
    # Target: d:\Ai Ai\radioproject\frontend\assets
    assets_dir = os.path.join(FRONTEND_DIR, ASSETS_DIR_NAME)
    rel_path = os.path.relpath(assets_dir, file_dir)
    return rel_path.replace(os.sep, '/')

def process_file(file_path):
    print(f"Processing {file_path}...")
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return

    original_content = content

    # 1. Remove Tailwind CDN (DOTALL to handle multiline attributes if any)
    content = re.sub(r'<script\s+src="https://cdn\.tailwindcss\.com.*?".*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)

    # 2. Remove Tailwind Config Script
    content = re.sub(r'<script\s+id="tailwind-config">.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
    # Start of script tag, any content, tailwind.config =, any content, end script
    content = re.sub(r'<script>\s*tailwind\.config\s*=.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)

    # 3. Remove Google Fonts links
    # Match any link with href pointing to fonts.googleapis.com or fonts.gstatic.com
    content = re.sub(r'<link\s+[^>]*href="https://fonts\.googleapis\.com[^"]*"[^>]*>', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'<link\s+[^>]*href="https://fonts\.gstatic\.com[^"]*"[^>]*>', '', content, flags=re.DOTALL | re.IGNORECASE)
    
    # 4. Cleanup empty lines left by removal (optional but nice)
    content = re.sub(r'\n\s*\n', '\n', content)

    rel_assets = get_relative_path_to_assets(file_path)
    
    # 5. Insert Local Links
    # Check if they already exist to avoid duplication
    if 'tailwind.css' not in content:
        local_links = f'\n    <link href="{rel_assets}/tailwind.css" rel="stylesheet" />\n    <link href="{rel_assets}/fonts.css" rel="stylesheet" />'
        
        if '</head>' in content:
            content = content.replace('</head>', f'{local_links}\n</head>')
        else:
            print(f"Warning: No </head> tag in {file_path}")
    
    if content != original_content:
        print(f"Updated {file_path}")
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
    else:
        print(f"No changes for {file_path}")

def main():
    print(f"Starting migration in {FRONTEND_DIR}")
    for root, dirs, files in os.walk(FRONTEND_DIR):
        if 'assets' in dirs:
            pass 
        
        for file in files:
            if file.endswith('.html'):
                full_path = os.path.join(root, file)
                process_file(full_path)
    print("Migration complete")

if __name__ == '__main__':
    main()
