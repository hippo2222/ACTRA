import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadScript(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function defineGlobal(name, value) {
    Object.defineProperty(global, name, {
        value,
        configurable: true,
        writable: true,
    });
}

function setupDom() {
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
            <body>
                <div id="import-modal">
                    <h2 data-role="import-modal-title"></h2>
                    <div data-role="import-steps-panel"></div>
                    <div data-role="import-footer"></div>
                    <div data-role="import-content"></div>
                </div>
            </body>
        </html>
    `, {
        url: 'http://localhost',
        runScripts: 'dangerously',
        resources: 'usable',
    });

    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('HTMLElement', dom.window.HTMLElement);
    defineGlobal('Node', dom.window.Node);
    defineGlobal('navigator', dom.window.navigator);
    dom.window.fetch = vi.fn();
    defineGlobal('fetch', dom.window.fetch);

    dom.window.eval(loadScript('frontend/Editor/import_manager.js') + '\n;window.ImportManager = ImportManager;');
    return dom;
}

describe.skip('ImportManager AI placeholder mode', () => {
    let dom;
    let manager;

    beforeEach(() => {
        dom = setupDom();
        const ImportManager = dom.window.ImportManager;
        manager = new ImportManager({
            catalog: [],
            closeModals: vi.fn(),
            loadCatalog: vi.fn(),
        });
    });

    it('renders in-progress placeholder and skips live AI fetches when ai_mode is disabled', async () => {
        const result = await manager.openTheoryAnalysisMode();

        expect(result).toMatchObject({ ok: false, error: 'ai_mode_in_progress' });
        expect(dom.window.fetch).not.toHaveBeenCalled();

        const content = dom.window.document.querySelector('[data-role="import-content"]');
        expect(content.textContent).toContain('В разработке');
        expect(content.textContent).toContain('Внутренняя ИИ-генерация');
    });

    it('routes microcards entrypoints into the same placeholder while ai_mode is disabled', async () => {
        const result = await manager.openManualMicrocardsEditor();

        expect(result).toMatchObject({ ok: false, error: 'ai_mode_in_progress' });
        expect(dom.window.fetch).not.toHaveBeenCalled();

        const content = dom.window.document.querySelector('[data-role="import-content"]');
        expect(content.textContent).toContain('В разработке');
    });

    it('keeps theory analysis behind the same placeholder even if ai_mode flag is enabled', async () => {
        manager.theoryFeatureFlags.ai_mode = true;
        manager.theoryFeatureFlags.analysis_v2_schema = true;
        manager.theoryFeatureFlags.analysis_report_blocks_v1 = true;
        manager.theoryFeatureFlags.analysis_report_renderer_v1 = true;

        const result = await manager.openTheoryAnalysisMode();

        expect(result).toMatchObject({ ok: false, error: 'ai_mode_in_progress' });
        expect(dom.window.fetch).not.toHaveBeenCalled();

        const content = dom.window.document.querySelector('[data-role="import-content"]');
        expect(content.textContent).toContain('В разработке');
    });
});
