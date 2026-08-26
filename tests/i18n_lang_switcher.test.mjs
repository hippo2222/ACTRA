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
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function createFetchMock() {
  return vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (url.startsWith('/assets/locales/')) {
      const lang = url.replace('/assets/locales/', '').replace('.json', '');
      const filePath = path.resolve(process.cwd(), 'frontend/assets/locales', `${lang}.json`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          ok: true,
          status: 200,
          json: async () => data,
        };
      }
    }
    if (url === '/api/users/should-welcome') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, show_welcome: true, mode: 'auth', profiles: [] }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    };
  });
}

describe('i18n language switcher suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads lang from URL query param on initialization and dispatches i18n:changed', async () => {
    const fetchMock = createFetchMock();
    const html = loadFile('frontend/Welcome/welcome.html');
    const dom = new JSDOM(html, {
      url: 'http://localhost:8000/?lang=en',
      runScripts: 'outside-only',
    });

    dom.window.fetch = fetchMock;
    dom.window.console = console;

    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('localStorage', dom.window.localStorage);
    defineGlobal('CustomEvent', dom.window.CustomEvent);

    let changedEventDispatched = false;
    dom.window.addEventListener('i18n:changed', (e) => {
      changedEventDispatched = true;
      expect(e.detail?.lang).toBe('en');
    });

    dom.window.eval(loadFile('frontend/assets/i18n.js'));
    await flushPromises();

    expect(dom.window.i18n.getLang()).toBe('en');
    expect(dom.window.document.documentElement.lang).toBe('en');
    expect(changedEventDispatched).toBe(true);
  });

  it('switches language and syncs URL without reload', async () => {
    const fetchMock = createFetchMock();
    const html = loadFile('frontend/Welcome/welcome.html');
    const dom = new JSDOM(html, {
      url: 'http://localhost:8000/',
      runScripts: 'outside-only',
    });

    dom.window.fetch = fetchMock;
    dom.window.console = console;

    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('localStorage', dom.window.localStorage);
    defineGlobal('CustomEvent', dom.window.CustomEvent);

    dom.window.eval(loadFile('frontend/assets/i18n.js'));
    await flushPromises();

    expect(dom.window.i18n.getLang()).toBe('ru');

    await dom.window.i18n.setLang('uk');
    await flushPromises();

    expect(dom.window.i18n.getLang()).toBe('uk');
    expect(dom.window.document.documentElement.lang).toBe('uk');
    expect(dom.window.location.search).toContain('lang=uk');
    expect(dom.window.localStorage.getItem('actra_lang')).toBe('uk');

    const displayEl = dom.window.document.querySelector('[data-lang-display]');
    expect(displayEl?.textContent.trim()).toBe('UA');
  });

  it('displays UA for Ukrainian in GlobalHeader on both initial load and reRender', async () => {
    const fetchMock = createFetchMock();
    const dom = new JSDOM('<div data-global-header data-app-section="main"></div>', {
      url: 'http://localhost:8000/main?lang=uk',
      runScripts: 'outside-only',
    });

    dom.window.fetch = fetchMock;
    dom.window.console = console;

    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('localStorage', dom.window.localStorage);
    defineGlobal('CustomEvent', dom.window.CustomEvent);

    dom.window.eval(loadFile('frontend/assets/i18n.js'));
    dom.window.eval(loadFile('frontend/assets/GlobalHeader.js'));
    await flushPromises();

    const codeSpan = dom.window.document.querySelector('.global-header__lang-code');
    expect(codeSpan?.textContent.trim()).toBe('UA');

    // Trigger reRender
    dom.window.GlobalHeader.reRender();
    const codeSpanAfter = dom.window.document.querySelector('.global-header__lang-code');
    expect(codeSpanAfter?.textContent.trim()).toBe('UA');
  });

  it('contains language switcher in mobile drawer in welcome.html', () => {
    const html = loadFile('frontend/Welcome/welcome.html');
    const dom = new JSDOM(html);
    const drawer = dom.window.document.getElementById('welcomeDrawer');
    expect(drawer).toBeTruthy();

    const drawerLangButtons = drawer.querySelectorAll('[data-lang-btn]');
    expect(drawerLangButtons.length).toBe(3);
    const langs = Array.from(drawerLangButtons).map(b => b.getAttribute('data-lang-btn'));
    expect(langs).toEqual(['ru', 'en', 'uk']);
  });
});
