/**
 * ThemeSwitcherUI.js
 * Legacy floating theme switcher.
 *
 * The standalone button is intentionally disabled by default.
 * Pages can opt in later by setting:
 * - <html data-theme-switcher="enabled">
 * - <body data-theme-switcher="enabled">
 * - data-theme-switcher-enabled="true" on an explicit slot/target
 */

(function () {
    'use strict';

    function isOptedIn() {
        return document.documentElement?.dataset.themeSwitcher === 'enabled'
            || document.body?.dataset.themeSwitcher === 'enabled'
            || !!document.querySelector('#theme-switcher-sidebar-target[data-theme-switcher-enabled="true"]')
            || !!document.querySelector('[data-theme-switcher-slot][data-theme-switcher-enabled="true"]');
    }

    if (!isOptedIn()) {
        return;
    }

    function wt(key, fallback) {
        if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
        var v = window.i18n.t(key);
        return v !== key ? v : fallback;
    }

    const THEMES = typeof window.ThemeManager?.getThemes === 'function'
        ? window.ThemeManager.getThemes()
        : [];

    function createUI() {
        if (document.getElementById('theme-switcher-container')) return;

        const sidebarTarget = document.querySelector('#theme-switcher-sidebar-target[data-theme-switcher-enabled="true"]');
        const slotTarget = document.querySelector('[data-theme-switcher-slot][data-theme-switcher-enabled="true"]');
        const mountTarget = sidebarTarget || slotTarget;
        if (!mountTarget) return;

        const currentThemeId = window.ThemeManager ? window.ThemeManager.getTheme() : 'light-a';
        const container = document.createElement('div');
        const toggleBtn = document.createElement('button');
        const menu = document.createElement('div');

        container.id = 'theme-switcher-container';
        container.className = 'relative';

        toggleBtn.type = 'button';
        toggleBtn.title = wt('theme.switch_title', 'Сменить тему');
        toggleBtn.className = sidebarTarget
            ? 'flex items-center gap-3 px-3 py-2 text-text-secondary hover:text-text-main hover:bg-bg-hover rounded-lg transition-colors w-full text-left'
            : 'flex size-8 items-center justify-center rounded-full bg-surface-2 text-text-muted border border-border-strong transition-colors hover:bg-surface-1 hover:text-primary';
        const switchLabel = wt('theme.switch_title', 'Сменить тему');
        toggleBtn.innerHTML = sidebarTarget
            ? `<span class="material-symbols-outlined text-[20px]">palette</span><span class="text-sm font-medium">${switchLabel}</span>`
            : '<span class="material-symbols-outlined text-[18px]">palette</span>';

        menu.id = 'theme-switcher-menu';
        menu.className = 'hidden absolute right-0 top-full mt-2 w-52 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-1 p-1.5 shadow-xl z-[100]';

        THEMES.forEach((theme) => {
            const btn = document.createElement('button');
            const swatch = document.createElement('div');
            const name = document.createElement('span');
            const check = document.createElement('span');

            btn.type = 'button';
            btn.dataset.themeId = theme.id;
            btn.className = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-bg-hover';
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                window.ThemeManager?.setTheme(theme.id);
                updateActiveState(theme.id);
                menu.classList.add('hidden');
            });

            swatch.className = 'h-3.5 w-3.5 rounded-full shrink-0';
            swatch.style.cssText = `background:${theme.swatch || '#d1d5db'};border:1.5px solid ${theme.border || '#94a3b8'}`;

            name.className = 'flex-1 text-text-main';
            name.textContent = theme.name || theme.id;

            check.className = 'material-symbols-outlined text-[14px] text-primary opacity-0 transition-opacity';
            check.textContent = 'check';
            if (theme.id === currentThemeId) check.style.opacity = '1';

            btn.appendChild(swatch);
            btn.appendChild(name);
            btn.appendChild(check);
            menu.appendChild(btn);
        });

        toggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const shouldShow = menu.classList.contains('hidden');
            menu.classList.toggle('hidden', !shouldShow);
            if (!shouldShow) return;
            updateActiveState(window.ThemeManager ? window.ThemeManager.getTheme() : 'light-a');
        });

        container.appendChild(toggleBtn);
        container.appendChild(menu);
        mountTarget.appendChild(container);

        document.addEventListener('click', () => {
            menu.classList.add('hidden');
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        window.addEventListener('themechanged', (event) => {
            updateActiveState(event.detail?.themeId);
        });

        function updateActiveState(activeId) {
            menu.querySelectorAll('button[data-theme-id]').forEach((btn) => {
                const isActive = btn.dataset.themeId === activeId;
                const check = btn.querySelector('.material-symbols-outlined');
                if (check) check.style.opacity = isActive ? '1' : '0';
                btn.classList.toggle('bg-primary-lighter', isActive);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
