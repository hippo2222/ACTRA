const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve(__dirname, '../frontend');
const IGNORE_DIRS = ['assets', 'node_modules'];

function getAllHtmlFiles(dir, files = []) {
    const list = fs.readdirSync(dir);
    for (const item of list) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (!IGNORE_DIRS.includes(item)) {
                getAllHtmlFiles(fullPath, files);
            }
        } else if (item.endsWith('.html')) {
            files.push(fullPath);
        }
    }
    return files;
}

function getRelativeAssetsPath(htmlPath) {
    const rel = path.relative(path.dirname(htmlPath), path.join(frontendDir, 'assets'));
    return rel.replace(/\\/g, '/');
}

const htmlFiles = getAllHtmlFiles(frontendDir);

console.log(`Found ${htmlFiles.length} HTML files.`);

htmlFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const assetsPath = getRelativeAssetsPath(file);

    let modified = false;

    // 1. Inject ThemeManager.js in <head>
    if (content.includes('<head>') && !content.includes('ThemeManager.js')) {
        const scriptTag = `\n    <script src="${assetsPath}/ThemeManager.js"></script>`;
        content = content.replace('<head>', '<head>' + scriptTag);
        modified = true;
    }

    // 2. Inject ThemeSwitcherUI.js before </body>
    if (content.includes('</body>') && !content.includes('ThemeSwitcherUI.js')) {
        const uiScriptTag = `\n    <script src="${assetsPath}/ThemeSwitcherUI.js"></script>\n`;
        content = content.replace('</body>', uiScriptTag + '</body>');
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Updated: ${file}`);
    }
});

console.log('Migration complete.');
