import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function loadText(filePath) {
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
        <header>
          <div class="settings-topbar">
            <a href="/ui/main">
              <span class="material-symbols-outlined">arrow_back</span>
              <span></span>
            </a>
            <h1></h1>
          </div>
        </header>
        <main>
          <section>
            <a id="settings-main-btn" href="/ui/main">
              <span class="material-symbols-outlined">dashboard</span>
              Главная
            </a>
          </section>
        </main>
        <img id="settings-account-avatar" />
        <div id="settings-account-name"></div>
        <div id="settings-account-caption"></div>
        <div id="settings-account-axes"></div>
        <div id="settings-account-subline"></div>
        <div id="settings-account-email"></div>
        <button id="settings-logout-btn" type="button"></button>
        <img id="settings-avatar-preview-image" />
        <div id="settings-avatar-preview-name"></div>
        <div id="settings-avatar-preview-note"></div>
        <input id="settings-avatar-file-input" type="file" />
        <button id="settings-avatar-upload-btn" type="button"></button>
        <div id="settings-avatar-save-status" class="hidden"></div>
        <div id="settings-avatar-crop-modal" class="hidden" aria-hidden="true">
          <div id="settings-avatar-crop-frame">
            <img id="settings-avatar-crop-image" class="hidden" />
          </div>
          <input id="settings-avatar-crop-zoom" type="range" value="100" />
          <button id="settings-avatar-crop-reset-btn" type="button"></button>
          <button id="settings-avatar-crop-cancel-btn" type="button"></button>
          <button id="settings-avatar-crop-cancel-icon-btn" type="button"></button>
          <button id="settings-avatar-crop-apply-btn" type="button"></button>
        </div>
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
        <input id="settings-password-username" type="email" />
        <label><span>Текущий пароль</span><input id="settings-password-current" type="password" /></label>
        <input id="settings-password-new" type="password" />
        <input id="settings-password-confirm" type="password" />
        <button id="settings-password-save-btn" type="button"></button>
        <button id="settings-password-cancel-btn" type="button"></button>
        <div id="settings-password-save-status" class="hidden"></div>
        <div id="theme-options"></div>
        <div id="theme-save-status" class="hidden"></div>
        <div id="settings-profile-title"></div>
        <div id="settings-profile-description"></div>
        <div id="settings-security-title"></div>
        <div id="settings-security-description"></div>
        <div id="settings-admin-title"></div>
        <div id="settings-admin-description"></div>
        <div id="settings-appearance-title"></div>
        <div id="settings-ai-title"></div>
        <div id="settings-ai-description"></div>
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
  defineGlobal('File', dom.window.File);
  defineGlobal('Blob', dom.window.Blob);
  defineGlobal('FormData', dom.window.FormData);
  return dom;
}

async function flushPromises(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installCommonUi(dom, setThemeSpy) {
  dom.window.ThemeManager = {
    getThemes: () => ([
      { id: 'light-a', name: 'Контраст', description: 'Светлая тема', swatch: '#f6f6f8', border: '#1349ec', isDark: false },
      { id: 'light-b', name: 'Тепло', description: 'Тёплая тема', swatch: '#fffecb', border: '#ff2e00', isDark: false },
      { id: 'dark-a', name: 'Ночь', description: 'Тёмная тема', swatch: '#141204', border: '#e8985e', isDark: true },
    ]),
    getTheme: () => dom.window.document.documentElement.getAttribute('data-theme') || 'light-a',
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
}

function installAvatarCropTestDoubles(dom) {
  const urlApi = {
    createObjectURL: vi.fn(() => 'blob:avatar-preview'),
    revokeObjectURL: vi.fn(),
  };
  dom.window.URL = urlApi;
  defineGlobal('URL', urlApi);

  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 640;
      this.naturalHeight = 480;
      this.width = 640;
      this.height = 480;
    }

    set src(value) {
      this._src = value;
      Promise.resolve().then(() => {
        if (this.onload) {
          this.onload();
        }
      });
    }

    get src() {
      return this._src;
    }
  }

  dom.window.Image = MockImage;
  defineGlobal('Image', MockImage);

  const originalCreateElement = dom.window.document.createElement.bind(dom.window.document);
  vi.spyOn(dom.window.document, 'createElement').mockImplementation((tagName, options) => {
    if (String(tagName).toLowerCase() === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
        }),
        toBlob: (callback) => {
          callback(new dom.window.Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' }));
        },
      };
    }
    return originalCreateElement(tagName, options);
  });
}

function buildFetchMock(overrides = {}) {
  return vi.fn(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || 'GET').toUpperCase();
    const key = `${method} ${url}`;

    if (overrides[key]) {
      return overrides[key](input, init);
    }

    if (key === 'GET /api/auth/me') {
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

    if (key === 'GET /api/ui/settings') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: { theme: 'dark-a' } }),
      };
    }

    if (key === 'GET /api/users/ai-keys') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, providers: {} }),
      };
    }

    throw new Error(`Unexpected fetch: ${key}`);
  });
}

describe('settings theme preferences', () => {
  let dom;
  let setThemeSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    dom = setupDom();
    setThemeSpy = vi.fn((themeId) => {
      dom.window.document.documentElement.setAttribute('data-theme', themeId);
      dom.window.dispatchEvent(new dom.window.CustomEvent('themechanged', { detail: { themeId } }));
    });

    installCommonUi(dom, setThemeSpy);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('uses the served settings script path and wraps password controls in a form', () => {
    const html = loadText('frontend/Settings/settings.html');

    expect(html).toContain('<script src="/ui/settings/settings.js"></script>');
    expect(html).toContain('<form id="settings-password-form"');
    expect(html).toContain('id="settings-password-username"');
    expect(html).toContain('id="settings-avatar-crop-modal"');
    expect(html).toContain('id="settings-main-btn"');
    expect(html).toContain('id="settings-profile-title"');
    expect(html).toContain('id="settings-security-title"');
    expect(html).toContain('id="settings-appearance-title"');
    expect(html).toContain('id="settings-ai-title"');
    expect(html).toContain('.settings-avatar-crop-backdrop.hidden');
  });

  it('applies explicit section labels without shifting appearance and AI headings', async () => {
    const fetchMock = buildFetchMock({
      'GET /api/ui/settings': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
      }),
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(dom.window.document.getElementById('settings-profile-title')?.textContent).toBe('Профиль');
    expect(dom.window.document.getElementById('settings-security-title')?.textContent).toBe('Безопасность');
    expect(dom.window.document.getElementById('settings-appearance-title')?.textContent).toBe('Оформление');
    expect(dom.window.document.getElementById('settings-ai-title')?.textContent).toBe('AI keys');
  });

  it('keeps the main button icon intact and navigates via PageTransition', async () => {
    const navigateSpy = vi.fn();
    dom.window.PageTransition = { navigate: navigateSpy };
    defineGlobal('PageTransition', dom.window.PageTransition);

    const fetchMock = buildFetchMock({
      'GET /api/ui/settings': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
      }),
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    const mainButton = dom.window.document.getElementById('settings-main-btn');
    const icon = mainButton?.querySelector('.material-symbols-outlined');
    const label = mainButton?.querySelector('.settings-main-link-label');

    expect(icon?.textContent).toBe('dashboard');
    expect(label?.textContent).toBe('Главная');

    mainButton.click();

    expect(navigateSpy).toHaveBeenCalledWith('/ui/main');
  });

  it('renders compact account context, theme cards, and saves a newly selected theme', async () => {
    const fetchMock = buildFetchMock({
      'POST /api/ui/settings': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: { theme: 'light-b' } }),
      }),
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(dom.window.document.querySelectorAll('[data-theme-option]').length).toBe(3);
    expect(setThemeSpy).toHaveBeenCalledWith('dark-a');
    expect(dom.window.document.getElementById('settings-account-name')?.textContent).toContain('Анна');
    expect(dom.window.document.getElementById('settings-account-caption')?.textContent).toContain('Почта');
    expect(dom.window.document.getElementById('settings-account-email')?.textContent).toContain('anna@example.com');
    expect(dom.window.document.getElementById('settings-name-input')?.value).toBe('Анна');
    expect(dom.window.document.getElementById('settings-profile-caption')?.textContent).toContain('Анна');
    expect(dom.window.document.getElementById('settings-avatar-preview-image')?.getAttribute('src')).toContain('/api/assets/avatars/2.png');

    const targetButton = dom.window.document.querySelector('[data-theme-option="light-b"]');
    expect(targetButton).toBeTruthy();
    targetButton.click();
    await flushPromises();

    expect(setThemeSpy).toHaveBeenCalledWith('light-b');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ui/settings',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('logs out from settings and redirects to welcome', async () => {
    const navigateSpy = vi.fn();
    dom.window.PageTransition = { navigate: navigateSpy };
    defineGlobal('PageTransition', dom.window.PageTransition);

    const fetchMock = buildFetchMock({
      'GET /api/ui/settings': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
      }),
      'POST /api/auth/logout': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }),
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    dom.window.document.getElementById('settings-logout-btn').click();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(navigateSpy).toHaveBeenCalledWith('/ui/welcome');
  });

  it('uploads avatar from the compact profile card after square cropping', async () => {
    installAvatarCropTestDoubles(dom);

    const fetchMock = buildFetchMock({
      'GET /api/ui/settings': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
      }),
      'POST /api/users/avatar': async (_input, init) => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          user: {
            user_id: 'u1',
            name: 'Анна',
            email: 'anna@example.com',
            avatar_seed: '3.png',
            has_password: true,
          },
        }),
      }),
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    const fileInput = dom.window.document.getElementById('settings-avatar-file-input');
    const file = new dom.window.File([Uint8Array.from([137, 80, 78, 71])], 'avatar.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    fileInput.dispatchEvent(new dom.window.Event('change'));
    await flushPromises();

    const cropModal = dom.window.document.getElementById('settings-avatar-crop-modal');
    expect(cropModal.classList.contains('hidden')).toBe(false);

    dom.window.document.getElementById('settings-avatar-crop-apply-btn').click();
    await flushPromises();

    const avatarCall = fetchMock.mock.calls.find(([url]) => url === '/api/users/avatar');
    expect(avatarCall).toBeTruthy();
    expect(avatarCall[1].method).toBe('POST');
    expect(avatarCall[1].body).toBeInstanceOf(dom.window.FormData);
    expect(dom.window.document.getElementById('settings-account-avatar')?.getAttribute('src')).toContain('/api/assets/avatars/3.png');
    expect(dom.window.document.getElementById('settings-avatar-preview-image')?.getAttribute('src')).toContain('/api/assets/avatars/3.png');
    expect(dom.window.document.getElementById('settings-password-username')?.value).toBe('anna@example.com');
    expect(dom.window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-preview');
  });

  it('updates name and email from inline profile controls', async () => {
    const fetchMock = buildFetchMock({
      'GET /api/ui/settings': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
      }),
      'POST /api/users/update': async (_input, init) => {
        const payload = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            user: {
              user_id: 'u1',
              name: payload.name || 'Анна Новая',
              email: payload.email || 'new@example.com',
              avatar_seed: '2.png',
              has_password: true,
            },
          }),
        };
      },
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    const nameInput = dom.window.document.getElementById('settings-name-input');
    nameInput.value = 'Анна Новая';
    dom.window.document.getElementById('settings-name-save-btn').click();
    await flushPromises();

    expect(dom.window.document.getElementById('settings-account-name')?.textContent).toContain('Анна Новая');

    dom.window.document.getElementById('settings-email-toggle-btn').click();
    const emailForm = dom.window.document.getElementById('settings-email-form');
    expect(emailForm.classList.contains('hidden')).toBe(false);
    const emailInput = dom.window.document.getElementById('settings-email-input');
    emailInput.value = 'new@example.com';
    dom.window.document.getElementById('settings-email-save-btn').click();
    await flushPromises();

    expect(dom.window.document.getElementById('settings-account-email')?.textContent).toContain('new@example.com');
    expect(dom.window.document.getElementById('settings-email-value')?.textContent).toContain('new@example.com');
  });

  it('changes password from the disclosure form', async () => {
    const fetchMock = buildFetchMock({
      'GET /api/ui/settings': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
      }),
      'POST /api/users/change-password': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }),
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    dom.window.document.getElementById('settings-password-toggle-btn').click();
    const passwordForm = dom.window.document.getElementById('settings-password-form');
    expect(passwordForm.classList.contains('hidden')).toBe(false);

    dom.window.document.getElementById('settings-password-current').value = 'old-password';
    dom.window.document.getElementById('settings-password-new').value = 'new-password-123';
    dom.window.document.getElementById('settings-password-confirm').value = 'new-password-123';
    dom.window.document.getElementById('settings-password-save-btn').click();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/change-password',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(dom.window.document.getElementById('settings-password-form').classList.contains('hidden')).toBe(true);
    expect(dom.window.document.getElementById('settings-password-state')?.textContent).toContain('Пароль уже настроен');
  });
});
