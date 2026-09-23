(function () {
    'use strict';

    var SUPPORTED = ['ru', 'en', 'uk'];
    var DEFAULT_LANG = 'ru';
    var STORAGE_KEY = 'actra_lang';
    var LOCALE_VERSION = '2026.09.23.2';
    var VERSION_KEY = 'actra_locale_version';

    var _locale = {};
    var _lang = DEFAULT_LANG;

    function getLang() {
        try {
            if (typeof window !== 'undefined' && window.location && window.location.search) {
                var params = new URLSearchParams(window.location.search);
                var urlLang = params.get('lang');
                if (urlLang && SUPPORTED.indexOf(urlLang) !== -1) {
                    return urlLang;
                }
            }
        } catch (_) {}
        var stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        return SUPPORTED.indexOf(stored) !== -1 ? stored : DEFAULT_LANG;
    }

    var STRICT_STORAGE_KEY = 'actra_i18n_strict';

    function isStrict() {
        try {
            if (typeof window !== 'undefined') {
                if (window.__STRICT_I18N__ === true) return true;
                if (window.location && window.location.search) {
                    var params = new URLSearchParams(window.location.search);
                    var s = params.get('i18n_strict') || params.get('strict_i18n');
                    if (s === '1' || s === 'true') return true;
                    if (s === '0' || s === 'false') return false;
                }
            }
        } catch (_) {}
        try {
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem(STRICT_STORAGE_KEY) === 'true';
            }
        } catch (_) {}
        return false;
    }

    function injectStrictStyles() {
        if (typeof document === 'undefined' || document.getElementById('i18n-strict-styles')) return;
        try {
            var style = document.createElement('style');
            style.id = 'i18n-strict-styles';
            style.textContent = '[data-i18n-missing="true"] { outline: 2px dashed #ef4444 !important; outline-offset: 1px !important; background-color: rgba(239, 68, 68, 0.08) !important; }';
            document.head.appendChild(style);
        } catch (_) {}
    }

    function setStrict(enabled) {
        var val = Boolean(enabled);
        try {
            if (typeof window !== 'undefined') {
                window.__STRICT_I18N__ = val;
            }
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STRICT_STORAGE_KEY, val ? 'true' : 'false');
            }
        } catch (_) {}
        if (val) {
            injectStrictStyles();
        }
        updateDOM();
    }

    function t(key) {
        if (typeof _locale[key] === 'string') return _locale[key];
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

    function wt(key, fallback) {
        if (!key) return fallback;
        var val = t(key);
        if (val !== key) return val;
        if (isStrict() && _lang !== DEFAULT_LANG) {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('[i18n:strict] Missing translation for key: "' + key + '" in locale: "' + _lang + '"');
            }
            return '🔴[MISSING: ' + key + ']';
        }
        return fallback !== undefined ? fallback : key;
    }

    function updateDOM() {
        var strictMode = isStrict() && _lang !== DEFAULT_LANG;
        if (strictMode) injectStrictStyles();

        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            var val = t(key);
            if (val !== key) {
                el.textContent = val;
                el.removeAttribute('data-i18n-missing');
            } else if (strictMode) {
                el.textContent = '🔴[MISSING: ' + key + ']';
                el.setAttribute('data-i18n-missing', 'true');
                if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                    console.warn('[i18n:strict] Missing data-i18n for key: "' + key + '" in locale: "' + _lang + '"');
                }
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-title');
            var val = t(key);
            if (val !== key) {
                el.title = val;
                el.removeAttribute('data-i18n-missing');
            } else if (strictMode) {
                el.title = '🔴[MISSING: ' + key + ']';
                el.setAttribute('data-i18n-missing', 'true');
            }
        });
        document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-aria');
            var val = t(key);
            if (val !== key) {
                el.setAttribute('aria-label', val);
                el.removeAttribute('data-i18n-missing');
            } else if (strictMode) {
                el.setAttribute('aria-label', '🔴[MISSING: ' + key + ']');
                el.setAttribute('data-i18n-missing', 'true');
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-placeholder');
            var val = t(key);
            if (val !== key) {
                el.placeholder = val;
                el.removeAttribute('data-i18n-missing');
            } else if (strictMode) {
                el.placeholder = '🔴[MISSING: ' + key + ']';
                el.setAttribute('data-i18n-missing', 'true');
            }
        });
        document.querySelectorAll('[data-i18n-tooltip]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-tooltip');
            var val = t(key);
            if (val !== key) {
                el.setAttribute('data-tooltip', val);
                el.removeAttribute('data-i18n-missing');
            } else if (strictMode) {
                el.setAttribute('data-tooltip', '🔴[MISSING: ' + key + ']');
                el.setAttribute('data-i18n-missing', 'true');
            }
        });
        document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
            var raw = el.getAttribute('data-i18n-attr');
            if (!raw) return;
            var specs = raw.split(/[,;]/);
            specs.forEach(function (spec) {
                var parts = spec.trim().split('|');
                if (parts.length === 2) {
                    var attr = parts[0].trim();
                    var key = parts[1].trim();
                    var val = t(key);
                    if (val !== key) {
                        if (attr === 'placeholder') {
                            el.placeholder = val;
                        } else {
                            el.setAttribute(attr, val);
                        }
                        el.removeAttribute('data-i18n-missing');
                    } else if (strictMode) {
                        var marker = '🔴[MISSING: ' + key + ']';
                        if (attr === 'placeholder') {
                            el.placeholder = marker;
                        } else {
                            el.setAttribute(attr, marker);
                        }
                        el.setAttribute('data-i18n-missing', 'true');
                    }
                }
            });
        });
        document.querySelectorAll('[data-lang-display]').forEach(function (el) {
            var display = _lang === 'uk' ? 'ua' : _lang;
            el.textContent = display.toUpperCase();
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
            var res = await fetch('/assets/locales/' + safeLang + '.json?v=' + encodeURIComponent(LOCALE_VERSION));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            applyLocale(data, safeLang);
            localStorage.setItem(STORAGE_KEY, safeLang);
            localStorage.setItem('actra_locale_' + safeLang, JSON.stringify(data));
            localStorage.setItem(VERSION_KEY, LOCALE_VERSION);
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
        try {
            if (typeof window !== 'undefined' && window.location && window.history && typeof window.history.replaceState === 'function') {
                var url = new URL(window.location.href);
                url.searchParams.set('lang', lang);
                window.history.replaceState({}, '', url.toString());
            }
        } catch (_) {}
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: lang } }));
        }
    }

    async function init() {
        var lang = getLang();
        var storedVersion = typeof localStorage !== 'undefined' ? localStorage.getItem(VERSION_KEY) : null;
        if (storedVersion !== LOCALE_VERSION) {
            try {
                SUPPORTED.forEach(function (s) {
                    localStorage.removeItem('actra_locale_' + s);
                });
                localStorage.setItem(VERSION_KEY, LOCALE_VERSION);
            } catch (_) {}
        }
        var cached = typeof localStorage !== 'undefined' ? localStorage.getItem('actra_locale_' + lang) : null;
        if (cached) {
            try {
                applyLocale(JSON.parse(cached), lang);
            } catch (_) {}
        }
        await loadLocale(lang);
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: lang } }));
        }
    }

    window.i18n = {
        t: t,
        wt: wt,
        isStrict: isStrict,
        setStrict: setStrict,
        setLang: setLang,
        getLang: getLang,
        updateDOM: updateDOM,
        applyLocale: applyLocale,
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
