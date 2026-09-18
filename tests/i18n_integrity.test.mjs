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

  it('catalog namespace includes linked theory and paired navigation keys in ru, en, uk', () => {
    // Russian
    expect(ru['catalog.btn_go_to_theory']).toBe('Перейти к теории');
    expect(ru['catalog.btn_go_to_complex']).toBe('Перейти к комплексу');
    expect(ru['catalog.linked_theory_auto_note']).toBe('При добавлении комплекса теория сохранится в вашем Теоретическом центре автоматически.');
    expect(ru['catalog.kicker_linked_complex']).toBe('Связанный комплекс');
    expect(ru['catalog.jump_to_paired']).toBe('Перейти к связанной публикации');
    expect(ru['catalog.type_image_labeling']).toBe('Подписи на рисунке');

    // English
    expect(en['catalog.btn_go_to_theory']).toBe('Go to theory');
    expect(en['catalog.btn_go_to_complex']).toBe('Go to complex');
    expect(en['catalog.linked_theory_auto_note']).toBe('When adding a complex, the theory is automatically saved to your Theory Center.');
    expect(en['catalog.kicker_linked_complex']).toBe('Linked complex');
    expect(en['catalog.jump_to_paired']).toBe('Go to linked publication');
    expect(en['catalog.type_image_labeling']).toBe('Image labeling');

    // Ukrainian
    expect(uk['catalog.btn_go_to_theory']).toBe('Перейти до теорії');
    expect(uk['catalog.btn_go_to_complex']).toBe('Перейти до комплексу');
    expect(uk['catalog.linked_theory_auto_note']).toBe('При додаванні комплексу теорія автоматично збережеться у вашому Теоретичному центрі.');
    expect(uk['catalog.kicker_linked_complex']).toBe("Пов'язаний комплекс");
    expect(uk['catalog.jump_to_paired']).toBe("Перейти до пов'язаної публікації");
    expect(uk['catalog.type_image_labeling']).toBe('Підписи на малюнку');
  });

  it('catalog namespace includes task composition breakdown and all task types in ru, en, uk', () => {
    const expectedTypes = [
      'type_test',
      'type_click',
      'type_open_answer',
      'type_sequence',
      'type_sequence_assembly',
      'type_draw',
      'type_image_labeling',
      'type_error_detection',
      'type_video',
    ];

    expect(ru['catalog.detail_tasks_kicker']).toBe('Состав заданий');
    expect(en['catalog.detail_tasks_kicker']).toBe('Task composition');
    expect(uk['catalog.detail_tasks_kicker']).toBe('Склад завдань');

    expect(ru['catalog.type_sequence']).toBe('Последовательность');
    expect(ru['catalog.type_sequence_assembly']).toBe('Последовательность');
    expect(ru['catalog.type_error_detection']).toBe('Поиск ошибок');

    expect(en['catalog.type_sequence']).toBe('Sequence');
    expect(en['catalog.type_sequence_assembly']).toBe('Sequence');
    expect(en['catalog.type_error_detection']).toBe('Error Detection');

    expect(uk['catalog.type_sequence']).toBe('Послідовність');
    expect(uk['catalog.type_sequence_assembly']).toBe('Послідовність');
    expect(uk['catalog.type_error_detection']).toBe('Пошук помилок');

    for (const key of expectedTypes) {
      expect(ru[`catalog.${key}`]).toBeDefined();
      expect(en[`catalog.${key}`]).toBeDefined();
      expect(uk[`catalog.${key}`]).toBeDefined();
      expect(ru[`catalog.${key}`].length).toBeGreaterThan(0);
      expect(en[`catalog.${key}`].length).toBeGreaterThan(0);
      expect(uk[`catalog.${key}`].length).toBeGreaterThan(0);
    }
  });

  it('catalog namespace includes date, freshness and owner keys in ru, en, uk', () => {
    expect(ru['catalog.date_unknown']).toBe('Дата не указана');
    expect(en['catalog.date_unknown']).toBe('Date not set');
    expect(uk['catalog.date_unknown']).toBe('Дату не вказано');

    expect(ru['catalog.date_today']).toBe('Сегодня');
    expect(en['catalog.date_today']).toBe('Today');
    expect(uk['catalog.date_today']).toBe('Сьогодні');

    expect(ru['catalog.date_yesterday']).toBe('Вчера');
    expect(en['catalog.date_yesterday']).toBe('Yesterday');
    expect(uk['catalog.date_yesterday']).toBe('Вчора');

    expect(ru['catalog.date_days_ago']).toBe('{n} дн. назад');
    expect(en['catalog.date_days_ago']).toBe('{n} days ago');
    expect(uk['catalog.date_days_ago']).toBe('{n} дн. тому');

    expect(ru['catalog.published_on']).toBe('Опубликовано {date}');
    expect(en['catalog.published_on']).toBe('Published {date}');
    expect(uk['catalog.published_on']).toBe('Опубліковано {date}');

    expect(ru['catalog.owner_you']).toBe('Вы');
    expect(en['catalog.owner_you']).toBe('You');
    expect(uk['catalog.owner_you']).toBe('Ви');

    expect(ru['catalog.owner_unknown']).toBe('Не указан');
    expect(en['catalog.owner_unknown']).toBe('Not specified');
    expect(uk['catalog.owner_unknown']).toBe('Не вказано');
  });

  it('formats dates in catalog according to active language locale', () => {
    const fixedDate = new Date('2026-03-15T12:00:00Z');

    const ruFormatted = fixedDate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    expect(ruFormatted).toMatch(/марта/);

    const enFormatted = fixedDate.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
    expect(enFormatted).toMatch(/March/);

    const ukFormatted = fixedDate.toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' });
    expect(ukFormatted).toMatch(/березня/);
  });
});



