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
        <div id="save-status" class="hidden"></div>
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
  defineGlobal('CustomEvent', dom.window.CustomEvent);
  defineGlobal('navigator', dom.window.navigator);
  defineGlobal('localStorage', dom.window.localStorage);
  return dom;
}

async function flushPromises(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe.skip('settings draft banner', () => {
  let dom;
  let toastVoiceSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    dom = setupDom();
    toastVoiceSpy = vi.fn();

    dom.window.ThemeManager = {
      getThemes: () => [],
      getTheme: () => 'light-a',
      setTheme: vi.fn(),
    };

    dom.window.NotificationUI = {
      toastVoice: toastVoiceSpy,
      toast: vi.fn(),
      voiceMessage: vi.fn(({ what = '', impact = '', next = '' } = {}) => [what, impact, next].filter(Boolean).join(' ')),
      resolveVariant: vi.fn((value) => value || 'info'),
    };

    defineGlobal('ThemeManager', dom.window.ThemeManager);
    defineGlobal('NotificationUI', dom.window.NotificationUI);
    defineGlobal('fetch', vi.fn(async (input, init = {}) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = String(init?.method || 'GET').toUpperCase();

      if (url === '/api/auth/me' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            authenticated: true,
            user: {
              user_id: 'u1',
              name: 'Анна',
              email: 'anna@example.com',
              avatar_seed: '2.png',
              has_password: true,
            },
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

      if (url === '/api/users/ai-keys') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            providers: {
              openrouter: {
                label: 'OpenRouter',
                hint: 'Основной провайдер',
                has_key: true,
                masked: 'sk-***',
              },
              gemini: {
                label: 'Gemini',
                hint: 'Резервный провайдер',
                has_key: false,
              },
              groq: {
                label: 'Groq',
                hint: 'Дополнительный провайдер',
                has_key: false,
              },
            },
          }),
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

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }));
    dom.window.fetch = global.fetch;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows banner summary for an existing draft on load', async () => {
    dom.window.localStorage.setItem('settings_ai_keys_draft_v1', JSON.stringify({
      savedAt: Date.UTC(2026, 3, 7, 10, 15, 0),
      values: { openrouter: 'sk-live' },
      pendingRemovals: { gemini: true },
    }));

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    const banner = dom.window.document.getElementById('settings-draft-banner');
    const bannerText = dom.window.document.getElementById('settings-draft-banner-text');

    expect(banner.classList.contains('hidden')).toBe(false);
    expect(bannerText.textContent).toContain('значений: 1');
    expect(bannerText.textContent).toContain('отметок удаления: 1');
  });

  it('restores draft values into the form and announces recovery', async () => {
    dom.window.localStorage.setItem('settings_ai_keys_draft_v1', JSON.stringify({
      savedAt: Date.UTC(2026, 3, 7, 10, 15, 0),
      values: { openrouter: 'sk-restored' },
      pendingRemovals: { openrouter: true },
    }));

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    dom.window.document.getElementById('settings-draft-restore-btn').click();
    await flushPromises();

    const input = dom.window.document.getElementById('key-input-openrouter');
    const removalNote = dom.window.document.body.textContent;

    expect(input.value).toBe('sk-restored');
    expect(removalNote).toContain('Ключ будет удал');
    expect(toastVoiceSpy).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'info',
      what: expect.stringContaining('Черновик'),
    }));
  });

  it('discards the draft and hides the banner', async () => {
    dom.window.localStorage.setItem('settings_ai_keys_draft_v1', JSON.stringify({
      savedAt: Date.UTC(2026, 3, 7, 10, 15, 0),
      values: { openrouter: 'sk-live' },
      pendingRemovals: {},
    }));

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    dom.window.document.getElementById('settings-draft-discard-btn').click();
    await flushPromises();

    const banner = dom.window.document.getElementById('settings-draft-banner');

    expect(banner.classList.contains('hidden')).toBe(true);
    expect(dom.window.localStorage.getItem('settings_ai_keys_draft_v1')).toBeNull();
  });
});
