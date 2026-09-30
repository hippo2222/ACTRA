(function () {
    'use strict';

    function format(template, params) {
        const data = (params && typeof params === 'object') ? params : {};
        return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
            const value = data[key];
            return value == null ? '' : String(value);
        });
    }

    const api = {
        get locale() {
            return (typeof window !== 'undefined' && window.i18n && window.i18n.locale) ? window.i18n.locale : 'ru';
        },
        t(key, params, fallback) {
            let res = '';
            if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
                const v = window.i18n.t(key);
                if (v && v !== key) res = v;
            }
            if (!res) res = fallback || key;
            return format(res, params);
        },
    };

    if (typeof window !== 'undefined') {
        window.RP_AI_UX = api;
    }
})();
