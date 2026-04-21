import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadFile(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function defineGlobal(name, value) {
  Object.defineProperty(global, name, {
    value,
    configurable: true,
    writable: true,
  });
}

async function flushPromises(rounds = 10) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setupDom(fetchMock, url = 'http://localhost/ui/welcome') {
  const html = loadFile('frontend/Welcome/welcome.html');
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
  });

  dom.window.fetch = fetchMock;
  dom.window.console = console;
  dom.window.ACTRA_CONFIG = { ui: { loadingRevealDelayMs: 0 } };
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  dom.window.requestAnimationFrame = (cb) => cb();
  dom.window.navigateWithTransition = vi.fn();
  dom.window.Image = class {
    set src(value) {
      this._src = value;
    }
  };

  defineGlobal('window', dom.window);
  defineGlobal('document', dom.window.document);
  defineGlobal('navigator', dom.window.navigator);
  defineGlobal('HTMLElement', dom.window.HTMLElement);
  defineGlobal('Node', dom.window.Node);
  defineGlobal('CustomEvent', dom.window.CustomEvent);
  defineGlobal('Image', dom.window.Image);
  defineGlobal('fetch', fetchMock);
  defineGlobal('requestAnimationFrame', dom.window.requestAnimationFrame);
  return dom;
}

describe('welcome hosted auth flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows auth choice in hosted mode and switches to login form', async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url === '/api/users/should-welcome') {
        return {
          ok: true,
          json: async () => ({ ok: true, show_welcome: true, mode: 'auth', authenticated: false, profiles: [] }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const dom = setupDom(fetchMock);
    dom.window.eval(loadFile('frontend/Welcome/welcome.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(dom.window.document.getElementById('modeSelect').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('hostedAuthChoice').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('profilesList').classList.contains('hidden')).toBe(true);

    dom.window.welcomeShowAuthLogin();
    await flushPromises();

    expect(dom.window.document.getElementById('loginIdentifierWrap').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('forgotPasswordLink').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('loginBackBtn').classList.contains('hidden')).toBe(false);
  });

  it('shows verification state after hosted registration and continues on demand', async () => {
    const navigateSpy = vi.fn();
    const fetchMock = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url === '/api/users/should-welcome') {
        return {
          ok: true,
          json: async () => ({ ok: true, show_welcome: true, mode: 'auth', authenticated: false, profiles: [] }),
        };
      }

      if (url === '/api/legal/current') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            documents: {
              terms: { version: 'terms-v1' },
              privacy: { version: 'privacy-v1' },
            },
          }),
        };
      }

      if (url === '/api/auth/register') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            user: {
              user_id: 'user_1',
              login: 'reader-one',
              email: 'reader@example.com',
              email_verification_sent_at: '2026-04-13T10:17:00Z',
            },
            verification_email: {
              sent: true,
              verify_url: 'http://localhost/ui/welcome?verify_email_token=verify-token-1',
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const dom = setupDom(fetchMock);
    dom.window.navigateWithTransition = navigateSpy;
    defineGlobal('window', dom.window);
    dom.window.eval(loadFile('frontend/Welcome/welcome.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    dom.window.welcomeShowAuthRegister();
    await flushPromises();

    dom.window.document.getElementById('onboardingName').value = 'Reader One';
    dom.window.document.getElementById('onboardingEmail').value = 'reader@example.com';
    dom.window.document.getElementById('onboardingPassword').value = 'StrongPass1';
    dom.window.document.getElementById('onboardingPasswordConfirm').value = 'StrongPass1';
    dom.window.document.getElementById('onboardingAcceptTerms').checked = true;
    dom.window.document.getElementById('onboardingAcceptPrivacy').checked = true;
    dom.window.welcomeUpdateConsentState('onboarding');

    await dom.window.welcomeCreateProfile();
    await flushPromises();

    const registerCall = fetchMock.mock.calls.find(([url]) => url === '/api/auth/register');
    expect(registerCall).toBeTruthy();
    const body = JSON.parse(registerCall[1].body);

    expect(body.name).toBe('Reader One');
    expect(body.email).toBe('reader@example.com');
    expect(body.password).toBe('StrongPass1');
    expect(Object.prototype.hasOwnProperty.call(body, 'login')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'avatar_seed')).toBe(false);
    expect(body.consent.accepted).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/assets/avatars')).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(dom.window.document.getElementById('onboardingVerificationPanel').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('onboardingVerificationEmail').textContent).toContain('reader@example.com');

    dom.window.welcomeContinueAfterVerification();
    expect(navigateSpy).toHaveBeenCalledWith('/ui/main');
  });

  it('confirms email token from welcome URL and shows success state', async () => {
    const navigateSpy = vi.fn();
    const fetchMock = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url === '/api/users/should-welcome') {
        return {
          ok: true,
          json: async () => ({ ok: true, show_welcome: true, mode: 'auth', authenticated: false, profiles: [] }),
        };
      }

      if (url === '/api/assets/avatars') {
        return {
          ok: true,
          json: async () => ({ ok: true, files: ['1.png', '2.png'] }),
        };
      }

      if (url === '/api/auth/verify-email?token=verify-token-1') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            verified: true,
            user: {
              user_id: 'user_1',
              email: 'reader@example.com',
              email_verified: true,
              email_verified_at: '2026-04-13T10:18:00Z',
            },
            verification: {
              verified_at: '2026-04-13T10:18:00Z',
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const dom = setupDom(fetchMock, 'http://localhost/ui/welcome?verify_email_token=verify-token-1');
    dom.window.navigateWithTransition = navigateSpy;
    defineGlobal('window', dom.window);
    dom.window.eval(loadFile('frontend/Welcome/welcome.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/verify-email?token=verify-token-1')).toBe(true);
    expect(dom.window.document.getElementById('onboardingVerificationPanel').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('onboardingVerificationTitle').textContent).toContain('Почта подтверждена');
    expect(dom.window.document.getElementById('onboardingVerificationResendBtn').classList.contains('hidden')).toBe(true);

    dom.window.welcomeContinueAfterVerification();
    expect(navigateSpy).toHaveBeenCalledWith('/ui/main');
  });

  it('opens forgot-password modal and requests reset email', async () => {
    const fetchMock = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url === '/api/users/should-welcome') {
        return {
          ok: true,
          json: async () => ({ ok: true, show_welcome: true, mode: 'auth', authenticated: false, profiles: [] }),
        };
      }

      if (url === '/api/auth/forgot-password') {
        const payload = JSON.parse(init.body);
        expect(payload.identifier).toBe('reader@example.com');
        return {
          ok: true,
          json: async () => ({
            ok: true,
            requested: true,
            message: 'Если аккаунт с таким логином или email существует, мы отправили письмо со ссылкой для сброса пароля.',
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const dom = setupDom(fetchMock);
    dom.window.eval(loadFile('frontend/Welcome/welcome.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    dom.window.welcomeShowAuthLogin();
    await flushPromises();
    dom.window.document.getElementById('loginIdentifier').value = 'reader@example.com';
    dom.window.welcomeOpenForgotPasswordModal();
    await flushPromises();

    expect(dom.window.document.getElementById('forgotPasswordModal').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('forgotPasswordIdentifierInput').value).toBe('reader@example.com');

    await dom.window.welcomeSubmitForgotPassword();
    await flushPromises();

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/forgot-password')).toBe(true);
    expect(dom.window.document.getElementById('forgotPasswordRequestStatus').textContent).toContain('Если аккаунт');
  });

  it('resets password from token in welcome url and continues to main', async () => {
    const navigateSpy = vi.fn();
    const fetchMock = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url === '/api/users/should-welcome') {
        return {
          ok: true,
          json: async () => ({ ok: true, show_welcome: true, mode: 'auth', authenticated: false, profiles: [] }),
        };
      }

      if (url === '/api/auth/reset-password') {
        const payload = JSON.parse(init.body);
        expect(payload.token).toBe('reset-token-1');
        expect(payload.new_password).toBe('StrongPass2');
        return {
          ok: true,
          json: async () => ({
            ok: true,
            password_reset: true,
            user: {
              user_id: 'user_1',
              email: 'reader@example.com',
              authenticated: true,
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const dom = setupDom(fetchMock, 'http://localhost/ui/welcome?reset_password_token=reset-token-1');
    dom.window.navigateWithTransition = navigateSpy;
    defineGlobal('window', dom.window);
    dom.window.eval(loadFile('frontend/Welcome/welcome.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushPromises();

    expect(dom.window.document.getElementById('forgotPasswordModal').classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('forgotPasswordResetPanel').classList.contains('hidden')).toBe(false);

    dom.window.document.getElementById('forgotPasswordNewPassword').value = 'StrongPass2';
    dom.window.document.getElementById('forgotPasswordConfirmPassword').value = 'StrongPass2';
    await dom.window.welcomeSubmitPasswordReset();
    await flushPromises();

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/reset-password')).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith('/ui/main');
  });
});
