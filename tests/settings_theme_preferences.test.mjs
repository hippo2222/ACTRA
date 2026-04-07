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

async function flushPromises(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

describe('settings theme preferences', () => {
  let dom;
  let currentTheme;
  let setThemeSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    dom = setupDom();
    currentTheme = 'light-a';
    setThemeSpy = vi.fn((themeId) => {
      currentTheme = themeId;
      dom.window.document.documentElement.setAttribute('data-theme', themeId);
      dom.window.dispatchEvent(new dom.window.CustomEvent('themechanged', { detail: { themeId } }));
    });

    dom.window.ThemeManager = {
      getThemes: () => ([
        { id: 'light-a', name: 'Контраст', description: 'Светлая тема', swatch: '#f6f6f8', border: '#1349ec', isDark: false },
        { id: 'light-b', name: 'Тепло', description: 'Теплая тема', swatch: '#fffecb', border: '#ff2e00', isDark: false },
        { id: 'dark-a', name: 'Ночь', description: 'Темная тема', swatch: '#141204', border: '#e8985e', isDark: true },
      ]),
      getTheme: () => currentTheme,
      setTheme: setThemeSpy,
    };

    dom.window.NotificationUI = {
      toastVoice: vi.fn(),
      toast: vi.fn(),
      voiceMessage: vi.fn(({ what = '', impact = '', next = '' } = {}) => [what, impact, next].filter(Boolean).join(' ')),
      resolveVariant: vi.fn((value) => value || 'info'),
    };

    defineGlobal('ThemeManager', dom.window.ThemeManager);
    defineGlobal('NotificationUI', dom.window.NotificationUI);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders theme cards and saves a newly selected theme', async () => {
    const fetchMock = vi.fn(async (input, init = {}) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = String(init?.method || 'GET').toUpperCase();

      if (url === '/api/users/current') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, user: { user_id: 'u1', name: 'Анна' } }),
        };
      }

      if (url === '/api/ui/settings' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, settings: { theme: 'dark-a' } }),
        };
      }

      if (url === '/api/ui/settings' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, settings: { theme: 'light-b' } }),
        };
      }

      if (url === '/api/users/ai-keys') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, providers: {} }),
        };
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(dom.window.document.querySelectorAll('[data-theme-option]').length).toBe(3);
    expect(setThemeSpy).toHaveBeenCalledWith('dark-a');

    const targetButton = dom.window.document.querySelector('[data-theme-option="light-b"]');
    expect(targetButton).toBeTruthy();
    targetButton.click();
    await flushPromises();

    expect(setThemeSpy).toHaveBeenCalledWith('light-b');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ui/settings',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
