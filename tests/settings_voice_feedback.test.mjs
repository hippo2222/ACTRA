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
        <img id="settings-account-avatar" />
        <div id="settings-account-name"></div>
        <div id="settings-account-caption"></div>
        <div id="settings-account-subline"></div>
        <div id="settings-account-email"></div>
        <button id="settings-logout-btn" type="button"></button>
        <img id="settings-avatar-preview-image" />
        <div id="settings-avatar-preview-name"></div>
        <div id="settings-avatar-preview-note"></div>
        <input id="settings-avatar-file-input" type="file" />
        <button id="settings-avatar-upload-btn" type="button"></button>
        <div id="settings-avatar-save-status" class="hidden"></div>
        <input id="settings-name-input" />
        <button id="settings-name-save-btn" type="button"></button>
        <div id="settings-name-save-status" class="hidden"></div>
        <div id="settings-email-value"></div>
        <div id="settings-email-note"></div>
        <button id="settings-email-toggle-btn" type="button"></button>
        <div id="settings-email-form" class="hidden"></div>
        <input id="settings-email-input" />
        <button id="settings-email-save-btn" type="button"></button>
        <button id="settings-email-cancel-btn" type="button"></button>
        <div id="settings-email-save-status" class="hidden"></div>
        <div id="settings-password-state"></div>
        <button id="settings-password-toggle-btn" type="button"></button>
        <div id="settings-password-form" class="hidden"></div>
        <label><span>Текущий пароль</span><input id="settings-password-current" type="password" /></label>
        <input id="settings-password-new" type="password" />
        <input id="settings-password-confirm" type="password" />
        <button id="settings-password-save-btn" type="button"></button>
        <button id="settings-password-cancel-btn" type="button"></button>
        <div id="settings-password-save-status" class="hidden"></div>
        <div id="theme-options"></div>
        <div id="theme-save-status" class="hidden"></div>
        <div id="settings-profile-caption"></div>
        <div id="settings-footer-profile-note"></div>
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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
        const fetchMock = vi.fn(async (input, init = {}) => {
            const url = typeof input === 'string' ? input : String(input?.url || '');
            const method = String(init?.method || 'GET').toUpperCase();

            if (url === '/api/auth/me' && method === 'GET') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        ok: true,
                        authenticated: true,
                        user: { user_id: 'u1', name: 'Анна', email: 'anna@example.com', avatar_seed: '1.png', has_password: true },
                    }),
                };
            }

            if (url === '/api/ui/settings' && method === 'GET') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
                };
            }

            if (url === '/api/editor/theory/rollout/status') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true, rollout: { feature_flags: { ai_mode: true } } }),
                };
            }

            if (url === '/api/billing/status') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true, status: { premium: false } }),
                };
            }

            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: false, error: 'load_failed' }),
            };
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

    it('shows voice error when /api/users/ai-keys request fails by network', async () => {
        const fetchMock = vi.fn(async (input) => {
            const url = typeof input === 'string' ? input : String(input?.url || '');
            if (url === '/api/auth/me') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        ok: true,
                        authenticated: true,
                        user: { user_id: 'u1', name: 'Анна', email: 'anna@example.com', avatar_seed: '1.png', has_password: true },
                    }),
                };
            }
            if (url === '/api/ui/settings') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
                };
            }
            if (url === '/api/editor/theory/rollout/status') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true, rollout: { feature_flags: { ai_mode: true } } }),
                };
            }
            if (url === '/api/billing/status') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true, status: { premium: false } }),
                };
            }
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
