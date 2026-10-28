/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function loadFile(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

describe('FOUT / Icon ligature explosion protection (Phase 3)', () => {
    it('configures Material Symbols Outlined with font-display: block in fonts.css', () => {
        const css = loadFile('frontend/assets/fonts.css');
        const fontFaceBlock = css.match(/@font-face\s*\{[^}]*Material Symbols Outlined[^}]*\}/s);
        expect(fontFaceBlock).toBeTruthy();
        expect(fontFaceBlock[0]).toContain('font-display: block;');
        expect(fontFaceBlock[0]).not.toContain('font-display: swap;');
    });

    it('enforces physical bounding box (1em x 1em, overflow: hidden) on .material-symbols-outlined', () => {
        const css = loadFile('frontend/assets/fonts.css');
        const iconClassBlock = css.match(/\.material-symbols-outlined\s*\{[^}]*\}/s);
        expect(iconClassBlock).toBeTruthy();
        const block = iconClassBlock[0];
        expect(block).toContain('width: 1em;');
        expect(block).toContain('height: 1em;');
        expect(block).toContain('overflow: hidden;');
        expect(block).toContain('vertical-align: middle;');
        expect(block).toContain('text-align: center;');
    });

    it('ensures settings.html has no external Google Fonts stylesheet requests', () => {
        const html = loadFile('frontend/Settings/settings.html');
        expect(html).not.toContain('fonts.googleapis.com');
        expect(html).toContain('/assets/fonts.css');
    });
});
