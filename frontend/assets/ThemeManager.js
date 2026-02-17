/**
 * ThemeManager.js
 * Handles theme persistence and application across the application.
 */

const ThemeManager = {
    themes: {
        'light-a': { name: 'Light A (Indigo/Platinum)', isDark: false },
        'light-b': { name: 'Light B (Spiced Orange)', isDark: false },
        'neutral-a': { name: 'Neutral A (Earth)', isDark: false },
        'neutral-b': { name: 'Neutral B (Green/Dusk Blue)', isDark: false },
        'dark-a': { name: 'Dark A', isDark: true },
        'dark-b': { name: 'Dark B', isDark: true }
    },

    init() {
        console.log('[ThemeManager] Init started');
        const savedTheme = localStorage.getItem('app-theme') || 'light-a';
        console.log('[ThemeManager] Loaded theme from storage:', savedTheme);
        this.setTheme(savedTheme);
    },

    setTheme(themeId) {
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

        localStorage.setItem('app-theme', themeId);

        // Dispatch event for components that might need to react
        window.dispatchEvent(new CustomEvent('themechanged', { detail: { themeId, ...this.themes[themeId] } }));
    },

    getTheme() {
        return localStorage.getItem('app-theme') || 'light-a';
    },

    getThemeInfo(themeId) {
        return this.themes[themeId || this.getTheme()];
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

    _getBody() {
        return document.body || document.documentElement || null;
    },

    applyEnterTransition() {
        if (this.prefersReducedMotion()) return;
        const body = this._getBody();
        if (!body) return;

        body.classList.add(this.transitionClass, this.enterClass);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                body.classList.add(this.enterActiveClass);
                body.classList.remove(this.enterClass);
                window.setTimeout(() => {
                    body.classList.remove(this.enterActiveClass);
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

        const body = this._getBody();
        if (!body) {
            if (replace) window.location.replace(url);
            else window.location.assign(url);
            return;
        }

        if (body.getAttribute(this.lockAttr) === '1') return;
        body.setAttribute(this.lockAttr, '1');
        body.classList.add(this.transitionClass, this.leaveClass);

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
