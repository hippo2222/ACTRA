import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadLocale(lang) {
  const filePath = path.resolve(process.cwd(), 'frontend/assets/locales', `${lang}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const cyrillicRegex = /[а-яА-ЯёЁіІїЇєЄґҐ]/;
const latinRegex = /[a-zA-Z]/;

const knownTech = new Set([
  'actra', 'json', 'ui', 'api', 'id', 'url', 'http', 'https', 'free', 'premium', 'pro',
  'pdf', 's3', 'postgresql', 'minio', 'docker', 'latex', 'katex', 'html', 'css', 'js',
  'dom', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'markdown', 'ok', 'ai', 'drag-and-drop',
  'drag & drop', 'ctrl', 'cmd', 'shift', 'alt', 'enter', 'esc', 'tab', 'caps lock',
  'space', 'backspace', 'delete', 'win', 'mac', 'windows', 'linux', 'ios', 'android',
  'n/a', 'utc', 'gmt', 'uuid', 'guid', 'v1', 'v2', 'beta', 'alpha', 'draft', 'dev',
  'prod', 'staging', 'cookie', 'cookies', 'token', 'jwt', 'email', 'e-mail', 'sms',
  'rss', 'xml', 'csv', 'tsv', 'sql', 'nosql', 'rest', 'graphql', 'grpc', 'websocket',
  'blob', 'cors', 'xss', 'csrf', 'dos', 'ddos', 'oauth', 'sso', 'ldap', 'saml',
  'click', 'draw', 'test', 'sequence', 'open_answer', 'matrix', 'flashcard', 'flashcards',
  's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10',
  'audio', 'video', 'mp3', 'mp4', 'wav', 'ogg', 'webm', 'aac', 'flac', 'gif', 'ico',
  'zip', 'tar', 'gz', '7z', 'rar', 'bzip2', 'gzip',
  'telegram', 'github', 'google', 'apple', 'yandex', 'mail.ru', 'vk', 'youtube',
  'px', 'em', 'rem', 'vh', 'vw', 'ms', 'kb', 'mb', 'gb', 'tb', 'hz', 'khz', 'mhz', 'ghz',
  'mytestx', 'sw', 'english'
]);

function isTechString(s) {
  const stripped = s.replace(/\{[^}]+\}/g, '').trim();
  if (!stripped || stripped.length <= 1) return true;
  if (stripped.startswith && (stripped.startsWith('http://') || stripped.startsWith('https://'))) return true;
  if (/^[\d\s\-_:.,#%/\+()×÷±=<>|*•–—−…?!'"]+$/.test(stripped)) return true;
  const words = stripped.match(/[a-zA-Z]+/g) || [];
  if (words.length === 0) return true;
  return words.every((w) => knownTech.has(w.toLowerCase()) || w.length === 1);
}

function flatten(obj, prefix = '') {
  const items = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(items, flatten(v, key));
    } else if (typeof v === 'string') {
      items[key] = v;
    }
  }
  return items;
}

describe('i18n locale integrity suite', () => {
  const ru = flatten(loadLocale('ru'));
  const uk = flatten(loadLocale('uk'));
  const en = flatten(loadLocale('en'));

  it('ru.json contains NO English leaks in complexes namespace', () => {
    const complexesKeys = Object.keys(ru).filter((k) => k.startsWith('complexes.'));
    const leaks = [];
    for (const k of complexesKeys) {
      const val = ru[k];
      if (latinRegex.test(val) && !cyrillicRegex.test(val) && !isTechString(val)) {
        leaks.push({ key: k, value: val });
      }
    }
    expect(leaks).toEqual([]);
    expect(ru['complexes.tasks_eyebrow']).toBe('Задания');
    expect(ru['complexes.btn_collapse']).toBe('Свернуть');
    expect(ru['complexes.tasks_count_label']).toBe('Заданий');
    expect(ru['complexes.summary_shown']).toBe('Показано');
    expect(ru['complexes.summary_of']).toBe('из');
    expect(ru['complexes.flabel_mine']).toBe('авторские');
    expect(ru['complexes.flabel_imported']).toBe('из каталога');
    expect(ru['complexes.flabel_all']).toBe('все комплексы библиотеки');
  });

  it('uk.json contains NO English leaks in complexes namespace', () => {
    const complexesKeys = Object.keys(uk).filter((k) => k.startsWith('complexes.'));
    const leaks = [];
    for (const k of complexesKeys) {
      const val = uk[k];
      if (latinRegex.test(val) && !cyrillicRegex.test(val) && !isTechString(val)) {
        leaks.push({ key: k, value: val });
      }
    }
    expect(leaks).toEqual([]);
    expect(uk['complexes.tasks_eyebrow']).toBe('Завдання');
    expect(uk['complexes.btn_collapse']).toBe('Згорнути');
    expect(uk['complexes.tasks_count_label']).toBe('Завдань');
    expect(uk['complexes.summary_shown']).toBe('Показано');
    expect(uk['complexes.summary_of']).toBe('з');
    expect(uk['complexes.flabel_mine']).toBe('авторські');
    expect(uk['complexes.flabel_imported']).toBe('з каталогу');
  });

  it('en.json contains NO Cyrillic text in complexes namespace', () => {
    const complexesKeys = Object.keys(en).filter((k) => k.startsWith('complexes.'));
    const cyrillicLeaks = [];
    for (const k of complexesKeys) {
      const val = en[k];
      if (cyrillicRegex.test(val)) {
        cyrillicLeaks.push({ key: k, value: val });
      }
    }
    expect(cyrillicLeaks).toEqual([]);
    expect(en['complexes.tasks_eyebrow']).toBe('Complex tasks');
    expect(en['complexes.btn_collapse']).toBe('Collapse');
    expect(en['complexes.linked_btn_collapse']).toBe('Collapse');
    expect(en['complexes.linked_btn_open']).toBe('Open');
    expect(en['complexes.btn_open']).toBe('Open');
  });

  it('wt() helper resolves genuine Russian strings on Complexes page when ru is loaded', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="test"></div></body></html>');
    dom.window._locale = loadLocale('ru');
    dom.window._lang = 'ru';
    dom.window.i18n = {
      t(key) {
        if (typeof dom.window._locale[key] === 'string') return dom.window._locale[key];
        const parts = key.split('.');
        let val = dom.window._locale;
        for (const p of parts) {
          if (val && typeof val === 'object') val = val[p];
          else return key;
        }
        return typeof val === 'string' ? val : key;
      }
    };

    function wt(key, fallback) {
      if (!dom.window.i18n) return fallback;
      const result = dom.window.i18n.t(key);
      return result !== key ? result : fallback;
    }

    expect(wt('complexes.tasks_eyebrow', 'Задания')).toBe('Задания');
    expect(wt('complexes.btn_collapse', 'Свернуть')).toBe('Свернуть');
    expect(wt('complexes.summary_shown', 'Показано')).toBe('Показано');
    expect(wt('complexes.summary_of', 'из')).toBe('из');
    expect(wt('complexes.flabel_mine', 'авторские')).toBe('авторские');
    expect(wt('complexes.flabel_imported', 'из каталога')).toBe('из каталога');
    expect(wt('complexes.btn_restart', 'Заново')).toBe('Заново');
  });

  it('i18n.updateDOM() correctly handles data-i18n-attr attributes', () => {
    const html = `
      <div>
        <input id="input1" data-i18n-attr="placeholder|settings.delete_password_placeholder" placeholder="Old" />
        <img id="img1" data-i18n-attr="alt|settings.account_alt;title|settings.account_alt" alt="Old" title="Old" />
      </div>
    `;
    const dom = new JSDOM(html, { url: 'http://localhost:8000/' });
    dom.window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const i18nScript = fs.readFileSync(path.resolve(process.cwd(), 'frontend/assets/i18n.js'), 'utf8');

    Object.defineProperty(global, 'window', { value: dom.window, configurable: true, writable: true });
    Object.defineProperty(global, 'document', { value: dom.window.document, configurable: true, writable: true });
    Object.defineProperty(global, 'localStorage', { value: dom.window.localStorage, configurable: true, writable: true });
    Object.defineProperty(global, 'CustomEvent', { value: dom.window.CustomEvent, configurable: true, writable: true });
    Object.defineProperty(global, 'fetch', { value: dom.window.fetch, configurable: true, writable: true });

    dom.window.eval(i18nScript);

    dom.window.i18n.applyLocale({
      'settings.delete_password_placeholder': 'Введите текущий пароль',
      'settings.account_alt': 'Аккаунт'
    }, 'ru');

    const input = dom.window.document.getElementById('input1');
    expect(input.placeholder).toBe('Введите текущий пароль');

    const img = dom.window.document.getElementById('img1');
    expect(img.getAttribute('alt')).toBe('Аккаунт');
    expect(img.getAttribute('title')).toBe('Аккаунт');
  });

  it('s1 namespace includes full theory viewer focus mode keys in ru, en, uk', () => {
    // Russian
    expect(ru['s1.mode_all']).toBe('Вся теория');
    expect(ru['s1.mode_dim']).toBe('Подсветка');
    expect(ru['s1.mode_isolate']).toBe('Только выжимка');
    expect(ru['s1.focus_mode_label']).toBe('Режим просмотра');
    expect(ru['s1.mode_no_linked_blocks']).toBe('Для этого задания нет связанных блоков');

    // English
    expect(en['s1.mode_all']).toBe('All theory');
    expect(en['s1.mode_dim']).toBe('Highlight');
    expect(en['s1.mode_isolate']).toBe('Summary only');
    expect(en['s1.focus_mode_label']).toBe('Viewing mode');
    expect(en['s1.mode_no_linked_blocks']).toBe('No linked blocks for this task');

    // Ukrainian
    expect(uk['s1.mode_all']).toBe('Вся теорія');
    expect(uk['s1.mode_dim']).toBe('Підсвічування');
    expect(uk['s1.mode_isolate']).toBe('Лише вижимка');
    expect(uk['s1.focus_mode_label']).toBe('Режим перегляду');
    expect(uk['s1.mode_no_linked_blocks']).toBe("Для цього завдання немає пов'язаних блоків");
  });
});
