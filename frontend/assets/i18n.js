(function () {
    'use strict';

    var SUPPORTED = ['ru', 'en', 'uk'];
    var DEFAULT_LANG = 'ru';
    var STORAGE_KEY = 'actra_lang';

    var _locale = {};
    var _lang = DEFAULT_LANG;

    function getLang() {
        var stored = localStorage.getItem(STORAGE_KEY);
        return SUPPORTED.indexOf(stored) !== -1 ? stored : DEFAULT_LANG;
    }

    function t(key) {
        var parts = key.split('.');
        var val = _locale;
        for (var i = 0; i < parts.length; i++) {
            if (val && typeof val === 'object') {
                val = val[parts[i]];
            } else {
                return key;
            }
        }
        return typeof val === 'string' ? val : key;
    }

    function updateDOM() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            var val = t(key);
            if (val !== key) el.textContent = val;
        });
        document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-title');
            var val = t(key);
            if (val !== key) el.title = val;
        });
        document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-aria');
            var val = t(key);
            if (val !== key) el.setAttribute('aria-label', val);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-placeholder');
            var val = t(key);
            if (val !== key) el.placeholder = val;
        });
        document.querySelectorAll('[data-lang-display]').forEach(function (el) {
            el.textContent = _lang.toUpperCase();
        });
        document.querySelectorAll('[data-lang-btn]').forEach(function (btn) {
            var btnLang = btn.getAttribute('data-lang-btn');
            var isActive = btnLang === _lang;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    function applyLocale(localeObj, lang) {
        _locale = localeObj;
        _lang = lang;
        document.documentElement.lang = lang;
        updateDOM();
    }

    async function loadLocale(lang) {
        var safeLang = SUPPORTED.indexOf(lang) !== -1 ? lang : DEFAULT_LANG;
        try {
            var res = await fetch('/assets/locales/' + safeLang + '.json');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            applyLocale(data, safeLang);
            localStorage.setItem(STORAGE_KEY, safeLang);
            localStorage.setItem('actra_locale_' + safeLang, JSON.stringify(data));
        } catch (e) {
            console.warn('[i18n] Failed to load locale:', safeLang, e);
            if (safeLang !== DEFAULT_LANG) {
                await loadLocale(DEFAULT_LANG);
            }
        }
    }

    async function setLang(lang) {
        if (SUPPORTED.indexOf(lang) === -1) return;
        await loadLocale(lang);
        window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: lang } }));
    }

    async function init() {
        var lang = getLang();
        var cached = localStorage.getItem('actra_locale_' + lang);
        if (cached) {
            try {
                applyLocale(JSON.parse(cached), lang);
            } catch (_) {}
        }
        await loadLocale(lang);
    }

    window.i18n = {
        t: t,
        setLang: setLang,
        getLang: getLang,
        updateDOM: updateDOM,
        init: init,
    };

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-lang-btn]');
        if (!btn) return;
        if (btn.closest('[data-global-header]')) return;
        e.preventDefault();
        var lang = btn.getAttribute('data-lang-btn');
        if (window.i18n && typeof window.i18n.setLang === 'function') {
            window.i18n.setLang(lang);
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
