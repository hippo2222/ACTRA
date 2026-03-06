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
    const html = `<!DOCTYPE html>
    <html>
      <body>
        <div id="providers-container"></div>
        <div id="settings-draft-banner" class="hidden"></div>
        <div id="settings-draft-banner-text"></div>
        <button id="settings-draft-restore-btn" type="button"></button>
        <button id="settings-draft-discard-btn" type="button"></button>
        <button id="save-keys-btn" type="button"></button>
        <button id="validate-all-btn" type="button"></button>
        <div id="save-status"></div>
      </body>
    </html>`;

    const dom = new JSDOM(html, {
        url: 'http://localhost',
        runScripts: 'dangerously',
        resources: 'usable',
    });

    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('HTMLElement', dom.window.HTMLElement);
    defineGlobal('Node', dom.window.Node);
    defineGlobal('navigator', dom.window.navigator);
    defineGlobal('localStorage', dom.window.localStorage);
    return dom;
}

async function flushPromises(rounds = 6) {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve();
    }
}

describe('Settings voice feedback on load failures', () => {
    let dom;
    let toastVoiceSpy;

    beforeEach(() => {
        vi.restoreAllMocks();
        dom = setupDom();
        toastVoiceSpy = vi.fn();
        vi.spyOn(console, 'error').mockImplementation(() => {});

        dom.window.NotificationUI = {
            toastVoice: toastVoiceSpy,
            toast: vi.fn(),
            voiceMessage: vi.fn(({ what = '', impact = '', next = '' } = {}) => [what, impact, next].filter(Boolean).join(' ')),
            resolveVariant: vi.fn((value) => value || 'info'),
        };
    });

    it('shows voice error when /api/users/ai-keys responds with ok=false', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ ok: false, error: 'load_failed' }),
        }));
        dom.window.fetch = fetchMock;
        defineGlobal('fetch', fetchMock);

        dom.window.eval(loadScript('frontend/Settings/settings.js'));
        dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
        await flushPromises();

        expect(toastVoiceSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'error',
        }));
    });

    it('shows voice error when /api/users/ai-keys request fails by network', async () => {
        const fetchMock = vi.fn(async () => {
            throw new Error('network down');
        });
        dom.window.fetch = fetchMock;
        defineGlobal('fetch', fetchMock);

        dom.window.eval(loadScript('frontend/Settings/settings.js'));
        dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
        await flushPromises();

        expect(toastVoiceSpy).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'error',
        }));
    });
});
