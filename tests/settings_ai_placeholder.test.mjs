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

function setupDom(fetchMock) {
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
        <div id="settings-email-pending-panel" class="hidden"></div>
        <div id="settings-email-form" class="hidden"></div>
        <input id="settings-email-input" />
        <button id="settings-email-save-btn" type="button"></button>
        <button id="settings-email-cancel-btn" type="button"></button>
        <div id="settings-email-save-status" class="hidden"></div>
        <div id="settings-password-state"></div>
        <button id="settings-password-toggle-btn" type="button"></button>
        <form id="settings-password-form" class="hidden"></form>
        <input id="settings-password-username" type="email" />
        <input id="settings-password-current" type="password" />
        <input id="settings-password-new" type="password" />
        <input id="settings-password-confirm" type="password" />
        <button id="settings-password-save-btn" type="button"></button>
        <button id="settings-password-cancel-btn" type="button"></button>
        <div id="settings-password-save-status" class="hidden"></div>
        <div id="theme-options"></div>
        <div id="theme-save-status" class="hidden"></div>
        <div id="settings-profile-caption"></div>
        <div id="settings-footer-profile-note"></div>
        <section id="settings-ai-section">
          <div id="settings-ai-placeholder" class="hidden"></div>
          <div id="settings-ai-live-content">
            <div id="providers-container"></div>
            <div id="settings-draft-banner" class="hidden"></div>
            <div id="settings-draft-banner-text"></div>
            <button id="settings-draft-restore-btn" type="button"></button>
            <button id="settings-draft-discard-btn" type="button"></button>
            <button id="save-keys-btn" type="button"></button>
            <button id="validate-all-btn" type="button"></button>
            <div id="save-status" class="hidden"></div>
          </div>
        </section>
      </body>
    </html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/ui/settings',
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

describe('settings AI placeholder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows placeholder and skips live AI key flows when ai_mode is disabled', async () => {
    const fetchMock = vi.fn(async (input, init = {}) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = String(init?.method || 'GET').toUpperCase();
      const key = `${method} ${url}`;

      if (key === 'GET /api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            authenticated: true,
            user: {
              user_id: 'u1',
              name: 'Anna',
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
          json: async () => ({ ok: true, settings: { theme: 'light-a' } }),
        };
      }

      if (key === 'GET /api/editor/theory/rollout/status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            rollout: {
              feature_flags: {
                ai_mode: false,
              },
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${key}`);
    });

    const dom = setupDom(fetchMock);
    dom.window.ThemeManager = {
      getThemes: () => [],
      getTheme: () => 'light-a',
      setTheme: vi.fn(),
    };
    dom.window.NotificationUI = {
      toastVoice: vi.fn(),
      toast: vi.fn(),
      voiceMessage: vi.fn(({ what = '', impact = '', next = '' } = {}) => [what, impact, next].filter(Boolean).join(' ')),
      resolveVariant: vi.fn((value) => value || 'info'),
    };
    defineGlobal('ThemeManager', dom.window.ThemeManager);
    defineGlobal('NotificationUI', dom.window.NotificationUI);

    dom.window.eval(loadScript('frontend/Settings/settings.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    const placeholder = dom.window.document.getElementById('settings-ai-placeholder');
    const liveContent = dom.window.document.getElementById('settings-ai-live-content');
    const saveButton = dom.window.document.getElementById('save-keys-btn');
    const validateButton = dom.window.document.getElementById('validate-all-btn');

    expect(placeholder.classList.contains('hidden')).toBe(false);
    expect(liveContent.classList.contains('hidden')).toBe(true);
    expect(saveButton.disabled).toBe(true);
    expect(validateButton.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/users/ai-keys', expect.anything());
  });
});
