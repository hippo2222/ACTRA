import os
import re

file_path = r'd:\Ai Ai\radioproject\frontend\MainScreen\Main.html'
FRONTEND_DIR = r'd:\Ai Ai\radioproject\frontend'
ASSETS_DIR_NAME = 'assets'

def get_relative_path_to_assets(file_path):
    file_dir = os.path.dirname(file_path)
    assets_dir = os.path.join(FRONTEND_DIR, ASSETS_DIR_NAME)
    rel_path = os.path.relpath(assets_dir, file_dir)
    return rel_path.replace(os.sep, '/')

print(f"Reading {file_path}")
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

original_content = content

content = re.sub(r'<script\s+src="https://cdn\.tailwindcss\.com.*?".*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
content = re.sub(r'<script\s+id="tailwind-config">.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
content = re.sub(r'<script>\s*tailwind\.config\s*=.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
content = re.sub(r'<link\s+[^>]*href="https://fonts\.googleapis\.com[^"]*"[^>]*>', '', content, flags=re.DOTALL | re.IGNORECASE)
content = re.sub(r'<link\s+[^>]*href="https://fonts\.gstatic\.com[^"]*"[^>]*>', '', content, flags=re.DOTALL | re.IGNORECASE)
content = re.sub(r'\n\s*\n', '\n', content)

rel_assets = get_relative_path_to_assets(file_path)

if 'tailwind.css' not in content:
    local_links = f'\n    <link href="{rel_assets}/tailwind.css" rel="stylesheet" />\n    <link href="{rel_assets}/fonts.css" rel="stylesheet" />'
    if '</head>' in content:
        content = content.replace('</head>', f'{local_links}\n</head>')

if content != original_content:
    print(f"Changes detected for {file_path}")
    print(f"Asset path: {rel_assets}")
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Saved.")
else:
    print("No changes.")
