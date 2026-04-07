/**
 * ThemeManager.js
 * Handles theme persistence and application across the application.
 */

const ThemeManager = {
    themes: {
        'light-a': {
            name: 'Контраст',
            description: 'Светлая тема с холодным акцентом',
            swatch: '#f6f6f8',
            border: '#1349ec',
            isDark: false,
        },
        'light-b': {
            name: 'Тепло',
            description: 'Мягкая светлая палитра с теплыми оттенками',
            swatch: '#fffecb',
            border: '#ff2e00',
            isDark: false,
        },
        'neutral-a': {
            name: 'Земля',
            description: 'Нейтральная палитра в природных тонах',
            swatch: '#dcc9b6',
            border: '#6d4c3d',
            isDark: false,
        },
        'neutral-b': {
            name: 'Сумерки',
            description: 'Спокойная нейтральная тема с мягким контрастом',
            swatch: '#b0aac0',
            border: '#50663c',
            isDark: false,
        },
        'dark-a': {
            name: 'Ночь',
            description: 'Темная тема с теплыми акцентами',
            swatch: '#141204',
            border: '#e8985e',
            isDark: true,
        },
        'dark-b': {
            name: 'Космос',
            description: 'Глубокая темная палитра для вечерней работы',
            swatch: '#120d31',
            border: '#b98ea7',
            isDark: true,
        }
    },

    init() {
        console.log('[ThemeManager] Init started');
        const savedTheme = localStorage.getItem('app-theme') || 'light-a';
        console.log('[ThemeManager] Loaded theme from storage:', savedTheme);
        this.setTheme(savedTheme, false); // Don't persist back to storage on init

        // Cross-tab synchronization
        window.addEventListener('storage', (event) => {
            if (event.key === 'app-theme' && event.newValue) {
                console.log('[ThemeManager] Theme changed in another tab:', event.newValue);
                this.setTheme(event.newValue, false);
            }
        });
    },

    setTheme(themeId, persist = true) {
        if (!this.themes[themeId]) {
            console.warn('[ThemeManager] Invalid theme:', themeId, 'falling back to light-a');
            themeId = 'light-a';
        }
        console.log('[ThemeManager] Setting theme to:', themeId);

        const html = document.documentElement;
        html.setAttribute('data-theme', themeId);

        // Handle Tailwind 'dark' class compatibility
        if (this.themes[themeId].isDark) {
            html.classList.add('dark');
        } else {
            html.classList.remove('dark');
        }

        if (persist) {
            localStorage.setItem('app-theme', themeId);
        }

        // Dispatch event for components that might need to react
        window.dispatchEvent(new CustomEvent('themechanged', { detail: { themeId, ...this.themes[themeId] } }));
    },

    getTheme() {
        return localStorage.getItem('app-theme') || 'light-a';
    },

    getThemeInfo(themeId) {
        return this.themes[themeId || this.getTheme()];
    },

    getThemes() {
        return Object.entries(this.themes).map(([id, value]) => ({
            id,
            ...value,
        }));
    }
};

const PageTransition = {
    transitionClass: 'app-page-transition',
    enterClass: 'app-page-enter',
    enterActiveClass: 'app-page-enter-active',
    leaveClass: 'app-page-leave',
    lockAttr: 'data-nav-transitioning',
    durationMs: 170,
    _linksBound: false,

    prefersReducedMotion() {
        return !!(
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        );
    },

    _getTarget() {
        return document.querySelector('[data-page-transition-root]')
            || document.querySelector('main')
            || document.body
            || document.documentElement
            || null;
    },

    applyEnterTransition() {
        if (this.prefersReducedMotion()) return;
        const target = this._getTarget();
        if (!target) return;

        target.classList.add(this.transitionClass, this.enterClass);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                target.classList.add(this.enterActiveClass);
                target.classList.remove(this.enterClass);
                window.setTimeout(() => {
                    target.classList.remove(this.enterActiveClass);
                }, this.durationMs + 40);
            });
        });
    },

    navigate(url, options = {}) {
        if (!url) return;

        const replace = options.replace === true;
        const delayMs = Number.isFinite(options.delayMs)
            ? Math.max(0, Number(options.delayMs))
            : this.durationMs;

        if (this.prefersReducedMotion()) {
            if (replace) window.location.replace(url);
            else window.location.assign(url);
            return;
        }

        const target = this._getTarget();
        if (!target) {
            if (replace) window.location.replace(url);
            else window.location.assign(url);
            return;
        }

        if (target.getAttribute(this.lockAttr) === '1') return;
        target.setAttribute(this.lockAttr, '1');
        target.classList.add(this.transitionClass, this.leaveClass);

        window.setTimeout(() => {
            if (replace) window.location.replace(url);
            else window.location.assign(url);
        }, delayMs);
    },

    bindLinkTransitions() {
        if (this._linksBound) return;
        this._linksBound = true;

        document.addEventListener(
            'click',
            (event) => {
                if (event.defaultPrevented) return;
                if (event.button !== 0) return;
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

                const target = event.target && event.target.closest
                    ? event.target.closest('a[href]')
                    : null;
                if (!target) return;

                if (target.target && target.target !== '_self') return;
                if (target.hasAttribute('download')) return;
                if (target.getAttribute('rel') === 'external') return;
                if (target.getAttribute('data-no-transition') === 'true') return;

                const href = target.getAttribute('href');
                if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

                let destination;
                try {
                    destination = new URL(href, window.location.href);
                } catch (e) {
                    return;
                }

                if (destination.origin !== window.location.origin) return;
                if (!destination.pathname.startsWith('/ui/')) return;
                if (destination.href === window.location.href) return;

                event.preventDefault();
                this.navigate(destination.href);
            },
            true
        );
    },

    init() {
        const boot = () => {
            this.applyEnterTransition();
            this.bindLinkTransitions();
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
        } else {
            boot();
        }
    }
};

// Auto-init on script load
ThemeManager.init();
PageTransition.init();

// Re-apply theme when restoring from bfcache
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        ThemeManager.init();
    }
});

// Export for use in other scripts if needed
window.ThemeManager = ThemeManager;
window.navigateWithTransition = (url, options) => PageTransition.navigate(url, options);
