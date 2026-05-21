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

function setupDom(fetchMock, url = 'http://localhost/settings') {
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
        <div id="settings-avatar-crop-modal" class="hidden" aria-hidden="true">
          <div id="settings-avatar-crop-frame"><img id="settings-avatar-crop-image" class="hidden" /></div>
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
        <div id="settings-email-pending-panel" class="hidden">
          <div id="settings-email-pending-title"></div>
          <div id="settings-email-pending-value"></div>
          <div id="settings-email-pending-hint"></div>
          <button id="settings-email-pending-resend-btn" type="button"></button>
          <div id="settings-email-pending-status" class="hidden"></div>
        </div>
        <div id="settings-email-form" class="hidden"></div>
        <input id="settings-email-input" />
        <button id="settings-email-save-btn" type="button"></button>
        <button id="settings-email-cancel-btn" type="button"></button>
        <div id="settings-email-save-status" class="hidden"></div>
        <div id="settings-password-state"></div>
        <button id="settings-password-toggle-btn" type="button"></button>
        <form id="settings-password-form" class="hidden"></form>
        <input id="settings-password-username" type="email" />
        <label><span>??????? ??????</span><input id="settings-password-current" type="password" /></label>
        <input id="settings-password-new" type="password" />
        <input id="settings-password-confirm" type="password" />
        <button id="settings-password-save-btn" type="button"></button>
        <button id="settings-password-cancel-btn" type="button"></button>
        <div id="settings-password-save-status" class="hidden"></div>
        <div id="settings-delete-section">
          <div id="settings-delete-title"></div>
          <div id="settings-delete-note"></div>
          <div id="settings-delete-warning"></div>
          <button id="settings-delete-toggle-btn" type="button"></button>
          <form id="settings-delete-form" class="hidden">
            <label id="settings-delete-password-wrap" class="hidden">
              <span>Current password</span>
              <input id="settings-delete-password" type="password" />
            </label>
            <button id="settings-delete-confirm-btn" type="button"></button>
            <button id="settings-delete-cancel-btn" type="button"></button>
            <div id="settings-delete-status" class="hidden"></div>
          </form>
        </div>
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
    url,
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
  defineGlobal('fetch', fetchMock);
  dom.window.fetch = fetchMock;
  return dom;
}

async function flushPromises(rounds = 14) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installCommonUi(dom) {
  dom.window.ThemeManager = {
    getThemes: () => ([{ id: 'light-a', name: 'Light', description: 'Light', swatch: '#fff', border: '#000', isDark: false }]),
    getTheme: () => 'light-a',
    setTheme: vi.fn(),
  };
  dom.window.NotificationUI = {
    toastVoice: vi.fn(),
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    voiceMessage: vi.fn(({ what = '', impact = '', next = '' } = {}) => [what, impact, next].filter(Boolean).join(' ')),
    resolveVariant: vi.fn((value) => value || 'info'),
  };
  defineGlobal('ThemeManager', dom.window.ThemeManager);
  defineGlobal('NotificationUI', dom.window.NotificationUI);
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
            name: '????',
            email: 'anna@example.com',
            email_verified: true,
            avatar_seed: '2.png',
            has_password: true,
          },
        }),
      };
    }

    if (key === 'GET /api/ui/settings') {
      return { ok: true, status: 200, json: async () => ({ ok: true, settings: { theme: 'light-a' } }) };
    }

    if (key === 'GET /api/users/ai-keys') {
      return { ok: true, status: 200, json: async () => ({ ok: true, providers: {} }) };
    }

    throw new Error(`Unexpected fetch: ${key}`);
  });
}

describe('settings pending email verification', () => {
  let dom;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows unverified email status across the account summary and email section', async () => {
    const fetchMock = buildFetchMock({
      'GET /api/auth/me': async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          authenticated: true,
          user: {
            user_id: 'u1',
            name: 'Anna',
            email: 'anna@example.com',
            email_verified: false,
            avatar_seed: '2.png',
            has_password: true,
          },
        }),
      }),
    });

    dom = setupDom(fetchMock);
    installCommonUi(dom);
    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(dom.window.document.getElementById('settings-account-caption').textContent).toContain('\u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430');
    expect(dom.window.document.getElementById('settings-account-subline').textContent).toContain('\u043d\u0435 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d\u043d\u043e\u0439');
    expect(dom.window.document.getElementById('settings-email-note').textContent).toContain('\u0435\u0449\u0451 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430');
  });

  it('stages a pending email change and keeps active email visible', async () => {
    const fetchMock = buildFetchMock({
      'POST /api/users/update': async (_input, init) => {
        const payload = JSON.parse(init.body);
        expect(payload.email).toBe('anna.next@example.com');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            email_change_pending: true,
            user: {
              user_id: 'u1',
              name: '????',
              email: 'anna@example.com',
              pending_email: 'anna.next@example.com',
              pending_email_change_pending: true,
              pending_email_verification_sent_at: '2026-04-17T10:20:00Z',
              email_verified: true,
              avatar_seed: '2.png',
              has_password: true,
            },
          }),
        };
      },
    });

    dom = setupDom(fetchMock);
    installCommonUi(dom);
    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    const input = dom.window.document.getElementById('settings-email-input');
    input.value = 'anna.next@example.com';
    dom.window.document.getElementById('settings-email-save-btn').click();
    await flushPromises();

    expect(dom.window.document.getElementById('settings-email-value').textContent).toContain('anna@example.com');
    expect(dom.window.document.getElementById('settings-email-pending-panel').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('settings-email-pending-value').textContent).toContain('anna.next@example.com');
    expect(dom.window.document.getElementById('settings-email-save-status').textContent).toContain('Проверьте почту');
  });

  it('confirms pending email from token in settings url', async () => {
    const fetchMock = buildFetchMock({
      'GET /api/auth/verify-email?token=token-123&purpose=change_email': async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          verified: true,
          email_changed: true,
          user: {
            user_id: 'u1',
            name: '????',
            email: 'anna.next@example.com',
            pending_email: null,
            email_verified: true,
            email_verified_at: '2026-04-17T10:30:00Z',
            avatar_seed: '2.png',
            has_password: true,
          },
        }),
      }),
    });

    dom = setupDom(fetchMock, 'http://localhost/settings?pending_email_token=token-123');
    installCommonUi(dom);
    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-email?token=token-123&purpose=change_email');
    expect(dom.window.document.getElementById('settings-email-value').textContent).toContain('anna.next@example.com');
    expect(dom.window.document.getElementById('settings-email-pending-panel').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('settings-email-pending-title').textContent).toContain('подтверждена');
  });
  it('deletes the hosted account from settings and navigates to welcome', async () => {
    const fetchMock = buildFetchMock({
      'POST /api/users/delete': async (_input, init) => {
        expect(JSON.parse(init.body)).toEqual({ verification_password: 'StrongPass1' });
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      },
    });

    dom = setupDom(fetchMock);
    installCommonUi(dom);
    dom.window.PageTransition = { navigate: vi.fn() };
    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    dom.window.document.getElementById('settings-delete-toggle-btn').click();
    dom.window.document.getElementById('settings-delete-password').value = 'StrongPass1';
    dom.window.document.getElementById('settings-delete-confirm-btn').click();
    await flushPromises();

    expect(dom.window.NotificationUI.confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/users/delete', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(dom.window.PageTransition.navigate).toHaveBeenCalledWith('/welcome');
  });
});
