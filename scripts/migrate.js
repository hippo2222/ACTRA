const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.resolve(__dirname, '../frontend');
const ASSETS_DIR_NAME = 'assets';

function getRelativePathToAssets(filePath) {
    const fileDir = path.dirname(filePath);
    const assetsDir = path.join(FRONTEND_DIR, ASSETS_DIR_NAME);
    let relPath = path.relative(fileDir, assetsDir);
    // Force forward slashes
    return relPath.split(path.sep).join('/');
}

function processFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        const originalContent = content;

        // 1. Remove Tailwind CDN
        content = content.replace(/<script\s+src="https:\/\/cdn\.tailwindcss\.com.*?"><\/script>/gi, '');

        // 2. Remove Tailwind Config Script
        content = content.replace(/<script\s+id="tailwind-config">[\s\S]*?<\/script>/gi, '');
        content = content.replace(/<script>\s*tailwind\.config\s*=[\s\S]*?<\/script>/gi, '');

        // 3. Remove Google Fonts
        content = content.replace(/<link\s+[^>]*href="https:\/\/fonts\.googleapis\.com[^"]*"[^>]*>/gi, '');
        content = content.replace(/<link\s+[^>]*href="https:\/\/fonts\.gstatic\.com[^"]*"[^>]*>/gi, '');

        // Cleanup newlines
        content = content.replace(/\n\s*\n/g, '\n');

        const relAssets = getRelativePathToAssets(filePath);

        // 4. Insert Local Links
        if (!content.includes('tailwind.css')) {
            const localLinks = `
    <link href="${relAssets}/tailwind.css" rel="stylesheet" />
    <link href="${relAssets}/fonts.css" rel="stylesheet" />`;

            if (content.includes('</head>')) {
                content = content.replace('</head>', `${localLinks}\n</head>`);
            }
        }

        if (content !== originalContent) {
            console.log(`Updated ${filePath}`);
            fs.writeFileSync(filePath, content, 'utf8');
        } else {
            // console.log(`No changes for ${filePath}`);
        }
    } catch (e) {
        console.error(`Error processing ${filePath}:`, e);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (file !== 'assets' && file !== 'node_modules') {
                walkDir(fullPath);
            }
        } else if (file.endsWith('.html')) {
            processFile(fullPath);
        }
    }
}

console.log(`Starting migration in ${FRONTEND_DIR}`);
walkDir(FRONTEND_DIR);
console.log('Migration complete');
