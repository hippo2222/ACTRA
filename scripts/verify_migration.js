const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.resolve(__dirname, '../frontend');
const IGNORE_DIRS = ['assets', 'node_modules'];

let totalFiles = 0;
let passedFiles = 0;
let failedFiles = [];

function checkFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');

        // Skip empty files
        if (!content.trim()) return;

        const errors = [];
        const hasHead = content.includes('<head>');

        // Check for Forbidden Patterns (CDNs) - ALWAYS APPLIES
        if (content.includes('cdn.tailwindcss.com')) errors.push('Contains Tailwind CDN');
        if (content.includes('fonts.googleapis.com')) errors.push('Contains Google Fonts (googleapis)');
        if (content.includes('fonts.gstatic.com')) errors.push('Contains Google Fonts (gstatic)');
        // if (content.includes('tailwind.config =')) errors.push('Contains inline Tailwind config'); // Config might be in partials? Unlikely but possible if legacy.

        // Check for Required Patterns (Local Assets) - ONLY IF HEAD EXISTS
        if (hasHead) {
            if (!content.includes('tailwind.css')) errors.push('Missing link to tailwind.css');
            if (!content.includes('fonts.css')) errors.push('Missing link to fonts.css');
        }

        if (errors.length > 0) {
            failedFiles.push({ path: filePath, errors });
        } else {
            passedFiles++;
        }
        totalFiles++;

    } catch (e) {
        console.error(`Error reading ${filePath}:`, e);
        failedFiles.push({ path: filePath, errors: [`Read error: ${e.message}`] });
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (!IGNORE_DIRS.includes(file)) {
                walkDir(fullPath);
            }
        } else if (file.endsWith('.html')) {
            checkFile(fullPath);
        }
    }
}

console.log(`Starting strict verification in ${FRONTEND_DIR}...`);
walkDir(FRONTEND_DIR);

console.log('\n--- Verification Results ---');
console.log(`Total HTML files scanned: ${totalFiles}`);
console.log(`Passed: ${passedFiles}`);
console.log(`Failed: ${failedFiles.length}`);

if (failedFiles.length > 0) {
    console.log('\n--- Failed Files ---');
    failedFiles.forEach(f => {
        console.log(`\nFile: ${path.relative(FRONTEND_DIR, f.path)}`);
        f.errors.forEach(e => console.log(`  - ${e}`));
    });
    process.exit(1);
} else {
    console.log('\nSUCCESS: All files are clean (no CDNs) and contain local links where appropriate.');
}
