/**
 * ThemeSwitcherUI.js
 * Creates a compact theme switcher button that integrates into the page header.
 * Falls back to a small fixed button if no header is found.
 */

(function () {
    const THEMES = [
        { id: 'light-a', name: 'Classic', swatch: '#f6f6f8', border: '#1349ec' },
        { id: 'light-b', name: 'Warm', swatch: '#fffecb', border: '#ff2e00' },
        { id: 'neutral-a', name: 'Earth', swatch: '#dcc9b6', border: '#6d4c3d' },
        { id: 'neutral-b', name: 'Dusk', swatch: '#b0aac0', border: '#50663c' },
        { id: 'dark-a', name: 'Midnight', swatch: '#141204', border: '#e8985e' },
        { id: 'dark-b', name: 'Cosmic', swatch: '#120d31', border: '#b98ea7' }
    ];

    function createUI() {
        if (document.getElementById('theme-switcher-container')) return;

        const currentThemeId = window.ThemeManager ? window.ThemeManager.getTheme() : 'light-a';
        const sidebarTarget = document.getElementById('theme-switcher-sidebar-target');

        // --- Wrapper (relative for dropdown positioning) ---
        const container = document.createElement('div');
        container.id = 'theme-switcher-container';
        container.className = 'relative';

        // --- Toggle button ---
        const toggleBtn = document.createElement('button');
        if (sidebarTarget) {
            // Sidebar style (Rectangular, with text)
            toggleBtn.className = 'flex items-center gap-3 px-3 py-2 text-text-secondary hover:text-text-main hover:bg-bg-hover rounded-lg transition-colors w-full text-left';
            toggleBtn.innerHTML = `
                <span class="material-symbols-outlined text-[20px]">palette</span>
                <span class="text-sm font-medium">Сменить тему</span>
            `;
        } else {
            // Header style (Compact circle)
            toggleBtn.className = 'flex size-8 items-center justify-center rounded-full bg-surface-2 text-text-muted border border-border-strong transition-colors hover:bg-surface-1 hover:text-primary';
            toggleBtn.title = 'Сменить тему';
            toggleBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">palette</span>';
        }

        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            const isHidden = menu.classList.contains('hidden');
            menu.classList.toggle('hidden', !isHidden);
            if (isHidden) {
                updateActiveState(window.ThemeManager ? window.ThemeManager.getTheme() : 'light-a');
                // Reposition logic
                requestAnimationFrame(() => {
                    const rect = menu.getBoundingClientRect();

                    // Sidebar-specific positioning: always open up if in sidebar
                    if (sidebarTarget) {
                        menu.style.bottom = '100% ';
                        menu.style.top = 'auto';
                        menu.style.marginBottom = '8px ';
                        menu.style.marginTop = '0';
                        menu.style.left = '0';
                        menu.style.right = 'auto';
                        return;
                    }

                    // Standard dynamic positioning
                    if (rect.left < 4) {
                        menu.style.right = 'auto';
                        menu.style.left = '0';
                    } else {
                        menu.style.right = '0';
                        menu.style.left = 'auto';
                    }
                    if (rect.bottom > window.innerHeight - 4) {
                        menu.style.top = 'auto';
                        menu.style.bottom = '100%';
                        menu.style.marginTop = '0';
                        menu.style.marginBottom = '8px';
                    }
                });
            }
        };

        // --- Dropdown menu ---
        const menu = document.createElement('div');
        menu.id = 'theme-switcher-menu';
        menu.className = 'hidden absolute right-0 top-full mt-2 w-48 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-1 p-1.5 shadow-xl backdrop-blur-md z-[100]';

        THEMES.forEach(theme => {
            const btn = document.createElement('button');
            btn.dataset.themeId = theme.id;
            btn.className = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-bg-hover';
            btn.onclick = (e) => {
                e.stopPropagation();
                if (window.ThemeManager) {
                    window.ThemeManager.setTheme(theme.id);
                    updateActiveState(theme.id);
                }
            };

            const swatch = document.createElement('div');
            swatch.className = 'h-3.5 w-3.5 rounded-full flex-shrink-0';
            swatch.style.cssText = `background:${theme.swatch};border:1.5px solid ${theme.border}`;

            const name = document.createElement('span');
            name.textContent = theme.name;
            name.className = 'flex-1 text-text-main';

            const check = document.createElement('span');
            check.className = 'material-symbols-outlined text-[14px] text-primary opacity-0 transition-opacity';
            check.textContent = 'check';
            if (theme.id === currentThemeId) check.style.opacity = '1';

            btn.appendChild(swatch);
            btn.appendChild(name);
            btn.appendChild(check);
            menu.appendChild(btn);
        });

        container.appendChild(toggleBtn);
        container.appendChild(menu);

        // --- Insertion logic ---
        if (sidebarTarget) {
            sidebarTarget.appendChild(container);
        } else {
            const headerActions = document.querySelector('header .flex.items-center.gap-4:last-child')
                || document.querySelector('header .flex.items-center.gap-4')
                || document.querySelector('header .flex.items-center.gap-3');

            if (headerActions) {
                headerActions.insertBefore(container, headerActions.firstChild);
            } else {
                container.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999';
                document.body.appendChild(container);
            }
        }

        // Close menu when clicking outside
        document.addEventListener('click', () => {
            menu.classList.add('hidden');
        });
        menu.onclick = (e) => e.stopPropagation();

        function updateActiveState(activeId) {
            menu.querySelectorAll('button[data-theme-id]').forEach(btn => {
                const isActive = btn.dataset.themeId === activeId;
                const check = btn.querySelector('.material-symbols-outlined');
                if (check) check.style.opacity = isActive ? '1' : '0';
                if (isActive) {
                    btn.classList.add('bg-primary-lighter');
                } else {
                    btn.classList.remove('bg-primary-lighter');
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
