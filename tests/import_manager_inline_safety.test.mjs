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
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
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

describe('ImportManager inline safety helpers', () => {
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

    it('escapes JS-string-dangerous characters for inline handlers', () => {
        const raw = `deck'"<>&\nline`;
        const escaped = manager.escapeInlineJsString(raw);

        expect(escaped).toContain('\\x27');
        expect(escaped).toContain('\\x22');
        expect(escaped).toContain('\\x3C');
        expect(escaped).toContain('\\x3E');
        expect(escaped).toContain('\\x26');
        expect(escaped).toContain('\\n');
        expect(escaped).not.toContain(`'"<>&`);
    });

    it('serializes card payloads safely for inline edit buttons', () => {
        const card = {
            id: `card'"1`,
            card_type: 'fact_recall',
            front: { text: 'front "text"' },
            back: { text: "back 'text'" },
        };

        const serialized = manager.serializeInlineJson(card);

        expect(serialized).toContain('\\x22id\\x22');
        expect(serialized).toContain('\\x27');
        expect(serialized).not.toContain('"');
        expect(serialized).not.toContain("'");

        manager.manualEditorEditCardFromEncoded(JSON.stringify(card));

        expect(manager.manualEditorCardForm).toMatchObject({
            mode: 'edit',
            card_id: `card'"1`,
            card_type: 'fact_recall',
        });
    });

    it('escapes module options and source text in import step templates', () => {
        const modulesHtml = manager.renderStep1Text([
            { id: `mod"1`, name: `<unsafe>` },
        ]);
        manager.importMode = 'text';
        manager.sourceText = '</textarea><script>alert(1)</script>';
        const step2Html = manager.renderStep2();

        expect(modulesHtml).toContain('value="mod&quot;1"');
        expect(modulesHtml).toContain('&lt;unsafe&gt;');
        expect(modulesHtml).not.toContain('<option value="mod"1">');

        expect(step2Html).toContain('&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(step2Html).not.toContain('</textarea><script>alert(1)</script>');
    });

    it('marks AI status failures explicitly instead of pretending keys are missing', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        dom.window.fetch.mockRejectedValue(new Error('network down'));

        const data = await manager.aiCheckStatus();

        expect(data).toMatchObject({
            ai_available: false,
            status_check_failed: true,
        });
        expect(manager.aiStatus).toMatchObject({
            ai_available: false,
            status_check_failed: true,
        });
        errorSpy.mockRestore();
    });
});
