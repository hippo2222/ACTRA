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
        <button id="profile-anchor" type="button" data-profile-menu-anchor aria-expanded="false">Profile</button>
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

async function flushPromises(rounds = 20) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('shared profile menu', () => {
  let dom;
  let selectProfileSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    dom = setupDom();
    selectProfileSpy = vi.fn(async () => {});
    dom.window.selectProfile = selectProfileSpy;
    defineGlobal('selectProfile', selectProfileSpy);
    dom.window.NotificationUI = {
      toast: vi.fn(),
    };
    defineGlobal('NotificationUI', dom.window.NotificationUI);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keeps legacy profile switching flow for non-hosted runtime', async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url === '/api/auth/me') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, error: 'not_found' }),
        };
      }

      if (url === '/api/users/current') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, user: { user_id: 'u1', name: 'Анна', avatar_seed: '1.png' } }),
        };
      }

      if (url === '/api/users') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            items: [
              { user_id: 'u1', name: 'Анна', avatar_seed: '1.png', has_password: false },
              { user_id: 'u2', name: 'Игорь', avatar_seed: '2.png', has_password: true },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);
    dom.window.eval(loadScript('frontend/assets/SharedProfileModal.js'));
    dom.window.openProfileMenu({ currentTarget: dom.window.document.getElementById('profile-anchor') });
    await flushPromises();

    const overlay = dom.window.document.getElementById('sharedProfileMenuOverlay');
    const buttons = dom.window.document.querySelectorAll('[data-profile-switch]');

    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(buttons.length).toBe(2);
    expect(dom.window.document.body.textContent).toContain('Быстрое переключение');

    buttons[1].click();
    await flushPromises();

    expect(selectProfileSpy).toHaveBeenCalledWith('u2');
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('renders hosted account menu with spoiler theme picker and logout flow', async () => {
    let currentTheme = 'light-a';
    const setThemeSpy = vi.fn((themeId) => {
      currentTheme = themeId;
      dom.window.document.documentElement.setAttribute('data-theme', themeId);
      dom.window.dispatchEvent(new dom.window.CustomEvent('themechanged', { detail: { themeId } }));
    });
    const navigateSpy = vi.fn();

    dom.window.ThemeManager = {
      getThemes: () => ([
        { id: 'light-a', name: 'Контраст', swatch: '#f6f6f8', border: '#1349ec', isDark: false },
        { id: 'dark-a', name: 'Ночь', swatch: '#141204', border: '#e8985e', isDark: true },
      ]),
      getTheme: () => currentTheme,
      setTheme: setThemeSpy,
    };
    dom.window.PageTransition = { navigate: navigateSpy };

    defineGlobal('ThemeManager', dom.window.ThemeManager);
    defineGlobal('PageTransition', dom.window.PageTransition);

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
            user: {
              user_id: 'u-hosted',
              name: 'Hosted User',
              email: 'hosted@example.com',
              login: 'hosted-login',
              avatar_seed: '2.png',
              effective_plan: 'premium',
              premium_expires_at: '2026-06-07T00:00:00Z',
            },
          }),
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
          json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
        };
      }

      if (url === '/api/auth/logout' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/assets/SharedProfileModal.js'));
    dom.window.openProfileMenu({ currentTarget: dom.window.document.getElementById('profile-anchor') });
    await flushPromises();

    expect(dom.window.document.body.textContent).toContain('Hosted User');
    expect(dom.window.document.body.textContent).toContain('Личный кабинет ACTRA');
    expect(dom.window.document.body.textContent).toContain('Настройки аккаунта');
    expect(dom.window.document.body.textContent).toContain('Оформление');
    expect(dom.window.document.body.textContent).toContain('Выйти');
    expect(dom.window.document.body.textContent).not.toContain('Показать палитру');
    expect(dom.window.document.body.textContent).not.toContain('Скрыть палитру');
    expect(dom.window.document.body.textContent).not.toContain('hosted@example.com');
    expect(dom.window.document.body.textContent).not.toContain('hosted-login');

    expect(dom.window.document.getElementById('sharedProfileMenuStyles')).toBeTruthy();

    const settingsLink = dom.window.document.getElementById('sharedProfileSettings');
    expect(settingsLink?.getAttribute('href')).toBe('/settings');
    expect(settingsLink?.className).toContain('shared-profile-focus-target');
    expect(dom.window.document.body.textContent).toContain('Premium');
    const premiumButton = dom.window.document.getElementById('sharedProfilePremium');
    expect(premiumButton?.tagName).toBe('BUTTON');
    expect(premiumButton?.textContent).toContain('Premium');

    expect(dom.window.document.querySelector('[data-theme-chip="dark-a"]')).toBeNull();

    const toggleButton = dom.window.document.querySelector('[data-profile-theme-toggle="true"]');
    expect(toggleButton?.getAttribute('aria-expanded')).toBe('false');
    expect(toggleButton?.className).toContain('shared-profile-focus-target');
    toggleButton.click();
    await flushPromises();

    const darkChip = dom.window.document.querySelector('[data-theme-chip="dark-a"]');
    expect(darkChip).toBeTruthy();
    expect(darkChip?.className).toContain('shared-profile-theme-chip');
    expect(dom.window.document.querySelector('[data-profile-theme-toggle="true"]')?.getAttribute('aria-expanded')).toBe('true');

    const lightChip = dom.window.document.querySelector('[data-theme-chip="light-a"]');
    lightChip.click();
    await flushPromises();

    expect(setThemeSpy).toHaveBeenCalledWith('dark-a');
    expect(setThemeSpy).toHaveBeenCalledWith('light-a');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ui/settings',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const logoutButton = dom.window.document.getElementById('sharedProfileLogout');
    expect(logoutButton?.className).toContain('shared-profile-focus-target');
    logoutButton.click();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(navigateSpy).toHaveBeenCalledWith('/welcome');
  });

  it('opens the premium promo modal from hosted profile menu', async () => {
    dom.window.ThemeManager = {
      getThemes: () => [],
      getTheme: () => 'light-a',
      setTheme: vi.fn(),
    };
    defineGlobal('ThemeManager', dom.window.ThemeManager);

    const premiumOpenSpy = vi.fn();
    dom.window.PremiumPromo = { open: premiumOpenSpy };
    defineGlobal('PremiumPromo', dom.window.PremiumPromo);

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
            user: {
              user_id: 'u-hosted',
              name: 'Hosted User',
              avatar_seed: '2.png',
              effective_plan: 'free',
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

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/assets/SharedProfileModal.js'));
    dom.window.openProfileMenu({ currentTarget: dom.window.document.getElementById('profile-anchor') });
    await flushPromises();

    dom.window.document.getElementById('sharedProfilePremium').click();

    expect(premiumOpenSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Premium'),
      lead: expect.stringContaining('checkout'),
    }));
    expect(dom.window.document.getElementById('sharedProfileMenuOverlay').classList.contains('hidden')).toBe(true);
  });

  it('reverts hosted theme on save failure and keeps the menu open', async () => {
    let currentTheme = 'light-a';
    const setThemeSpy = vi.fn((themeId) => {
      currentTheme = themeId;
      dom.window.document.documentElement.setAttribute('data-theme', themeId);
      dom.window.dispatchEvent(new dom.window.CustomEvent('themechanged', { detail: { themeId } }));
    });

    dom.window.ThemeManager = {
      getThemes: () => ([
        { id: 'light-a', name: 'Контраст', swatch: '#f6f6f8', border: '#1349ec', isDark: false },
        { id: 'dark-a', name: 'Ночь', swatch: '#141204', border: '#e8985e', isDark: true },
      ]),
      getTheme: () => currentTheme,
      setTheme: setThemeSpy,
    };
    defineGlobal('ThemeManager', dom.window.ThemeManager);

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
            user: {
              user_id: 'u-hosted',
              name: 'Hosted User',
              email: 'hosted@example.com',
              avatar_seed: '2.png',
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

      if (url === '/api/ui/settings' && method === 'POST') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ ok: false, error: 'theme_save_failed' }),
        };
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    dom.window.fetch = fetchMock;
    defineGlobal('fetch', fetchMock);

    dom.window.eval(loadScript('frontend/assets/SharedProfileModal.js'));
    dom.window.openProfileMenu({ currentTarget: dom.window.document.getElementById('profile-anchor') });
    await flushPromises();

    const toggleButton = dom.window.document.querySelector('[data-profile-theme-toggle="true"]');
    toggleButton.click();
    await flushPromises();

    const darkChip = dom.window.document.querySelector('[data-theme-chip="dark-a"]');
    darkChip.click();
    await flushPromises();

    expect(setThemeSpy).toHaveBeenCalledWith('dark-a');
    expect(setThemeSpy).toHaveBeenCalledWith('light-a');
    expect(dom.window.NotificationUI.toast).toHaveBeenCalledWith('Не удалось сохранить тему', 'error', 2000);
    expect(dom.window.document.getElementById('sharedProfileMenuOverlay').classList.contains('hidden')).toBe(false);
  });
});
