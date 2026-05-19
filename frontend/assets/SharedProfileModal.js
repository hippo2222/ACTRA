/**
 * SharedProfileModal.js
 * Shared upper-right profile menu for Calendar, Statistics, Microcards, and Main.
 *
 * Hosted flow:
 *   - current account card
 *   - account settings shortcut
 *   - inline theme picker
 *   - logout
 *
 * Legacy local flow:
 *   - profile switcher list
 *   - profile management fallback
 *
 * Exposes:
 *   openProfileMenu(eventOrAnchor)
 *   closeProfileMenu()
 *   selectProfile(userId)    // only when a page has not provided its own
 */
(function () {
    'use strict';

    function wt(key, fallback) {
        if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
        var v = window.i18n.t(key);
        return v !== key ? v : fallback;
    }

    const MENU_MODE = {
        HOSTED: 'hosted',
        LEGACY: 'legacy',
    };

    let currentUserId = null;
    let currentMode = MENU_MODE.LEGACY;
    let currentHostedUser = null;
    let activeAnchor = null;
    let globalListenersBound = false;
    let menuLoadToken = 0;
    let isThemeSaving = false;
    let isLogoutPending = false;
    let isThemeSectionExpanded = false;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    function showToast(message, type = 'error', duration = 2000) {
        if (window.NotificationUI && typeof window.NotificationUI.toast === 'function') {
            window.NotificationUI.toast(message, type, duration);
            return;
        }

        const palette = {
            success: 'bg-success text-white',
            error: 'bg-error text-white',
            warning: 'bg-warning text-warning-dark',
            info: 'bg-info text-white',
        };
        const toast = document.createElement('div');
        toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${palette[type] || palette.info} transition-all opacity-0 translate-y-2`;
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.transition = 'opacity 200ms, transform 200ms';
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(8px)';
            setTimeout(() => toast.remove(), 250);
        }, Math.max(1200, duration));
    }

    function getAvatarUrl(avatarSeed) {
        const safeSeed = avatarSeed || '1.png';
        if (String(safeSeed).includes('.')) {
            return `/api/assets/avatars/${encodeURIComponent(String(safeSeed))}`;
        }
        return '/api/assets/avatars/1.png';
    }

    function getElements() {
        return {
            overlay: document.getElementById('sharedProfileMenuOverlay'),
            panel: document.getElementById('sharedProfileMenuPanel'),
        };
    }

    function isMenuOpen() {
        const { overlay } = getElements();
        return Boolean(overlay && !overlay.classList.contains('hidden'));
    }

    function isScrollInsideProfileMenu(event) {
        const { panel } = getElements();
        if (!panel) return false;

        const target = event && event.target;
        return typeof Node !== 'undefined' && target instanceof Node && panel.contains(target);
    }

    function getThemeCatalog() {
        if (window.ThemeManager && typeof window.ThemeManager.getThemes === 'function') {
            return window.ThemeManager.getThemes();
        }
        return [];
    }

    function getCurrentThemeId() {
        if (window.ThemeManager && typeof window.ThemeManager.getTheme === 'function') {
            return window.ThemeManager.getTheme();
        }
        return document.documentElement.getAttribute('data-theme') || 'light-a';
    }

    function getHostedAccountCaption() {
        return wt('profile_modal.hosted_account_caption', 'Личный кабинет ACTRA');
    }

    function formatPremiumDate(value) {
        const date = new Date(String(value || ''));
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function hexToRgb(hex) {
        const normalized = String(hex || '').trim().replace('#', '');
        const source = normalized.length === 3
            ? normalized.split('').map((char) => `${char}${char}`).join('')
            : normalized;
        if (!/^[0-9a-fA-F]{6}$/.test(source)) {
            return null;
        }

        return {
            r: parseInt(source.slice(0, 2), 16),
            g: parseInt(source.slice(2, 4), 16),
            b: parseInt(source.slice(4, 6), 16),
        };
    }

    function getAccessibleInk(hex) {
        const rgb = hexToRgb(hex);
        if (!rgb) return '#0f172a';

        const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.03928
                ? normalized / 12.92
                : Math.pow((normalized + 0.055) / 1.055, 2.4);
        });
        const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        return luminance > 0.42 ? '#0f172a' : '#f8fafc';
    }

    function getCurrentThemeMeta() {
        return getThemeCatalog().find((theme) => theme.id === getCurrentThemeId()) || null;
    }

    function ensureMenuStyles() {
        if (document.getElementById('sharedProfileMenuStyles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'sharedProfileMenuStyles';
        style.textContent = `
            #sharedProfileMenuPanel .shared-profile-focus-target:focus-visible {
                outline: 2px solid color-mix(in srgb, var(--color-primary) 72%, white 28%);
                outline-offset: 2px;
                border-color: color-mix(in srgb, var(--color-primary) 72%, white 28%);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary-light) 34%, transparent);
            }

            #sharedProfileMenuPanel .shared-profile-theme-chip {
                scroll-margin: 0.75rem;
            }

            #sharedProfileMenuPanel .shared-profile-theme-chip:focus-visible {
                transform: translateY(-1px);
            }
        `;
        document.head.appendChild(style);
    }

    function injectMenu() {
        ensureMenuStyles();

        if (document.getElementById('sharedProfileMenuOverlay')) {
            return getElements();
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
        <div id="sharedProfileMenuOverlay" class="fixed inset-0 z-[100] hidden">
            <div id="sharedProfileMenuPanel"
                class="absolute overflow-hidden rounded-[1.35rem] border border-border-subtle bg-surface-1 shadow-2xl">
            </div>
        </div>`;

        document.body.appendChild(wrapper.firstElementChild);

        const elements = getElements();
        applyPanelDimensions(elements.panel);
        elements.panel.style.maxHeight = 'min(36rem, calc(100vh - 1rem))';
        elements.panel.style.overflowY = 'auto';
        elements.overlay.addEventListener('click', (event) => {
            if (event.target === elements.overlay) {
                closeProfileMenu();
            }
        });
        elements.panel.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        if (!globalListenersBound) {
            globalListenersBound = true;
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && isMenuOpen()) {
                    closeProfileMenu();
                }
            });
            window.addEventListener('resize', () => {
                if (isMenuOpen()) {
                    positionMenu();
                }
            });
            window.addEventListener('scroll', (event) => {
                if (!isMenuOpen() || isScrollInsideProfileMenu(event)) {
                    return;
                }
                closeProfileMenu();
            }, true);
            window.addEventListener('themechanged', () => {
                if (currentMode === MENU_MODE.HOSTED && isMenuOpen()) {
                    renderHostedThemeOptions(getCurrentThemeId());
                }
            });
        }

        return elements;
    }

    function resolveAnchor(source) {
        if (source?.currentTarget) return source.currentTarget;
        if (source?.target?.closest) return source.target.closest('[data-profile-menu-anchor]');
        if (typeof window.Element !== 'undefined' && source instanceof window.Element) return source;
        if (window.event?.currentTarget) return window.event.currentTarget;
        return activeAnchor;
    }

    function setAnchorExpanded(expanded) {
        if (!activeAnchor || typeof activeAnchor.setAttribute !== 'function') return;
        activeAnchor.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function applyPanelDimensions(panel) {
        if (!panel) return;
        const viewportWidth = typeof window.innerWidth === 'number' ? window.innerWidth : 1440;
        const width = Math.max(280, Math.min(368, viewportWidth - 16));
        panel.style.width = `${width}px`;
        panel.style.maxWidth = 'calc(100vw - 1rem)';
    }

    function positionMenu() {
        const { panel } = getElements();
        if (!panel || !activeAnchor) return;

        applyPanelDimensions(panel);

        const anchorRect = activeAnchor.getBoundingClientRect();
        const menuWidth = panel.offsetWidth || 360;
        const menuHeight = panel.offsetHeight || 420;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const margin = 8;

        let left = anchorRect.right - menuWidth;
        if (left < margin) left = margin;
        if (left + menuWidth > viewportWidth - margin) {
            left = viewportWidth - menuWidth - margin;
        }

        let top = anchorRect.bottom + 10;
        if (top + menuHeight > viewportHeight - margin) {
            const aboveTop = anchorRect.top - menuHeight - 10;
            top = aboveTop >= margin
                ? aboveTop
                : Math.max(margin, viewportHeight - menuHeight - margin);
        }

        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
    }

    function renderLoadingState() {
        const { panel } = injectMenu();
        if (!panel) return;
        panel.innerHTML = `
            <div class="px-4 py-8 text-center text-text-secondary">
                <div class="inline-flex items-center gap-2">
                    <span class="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                    <span class="text-sm">${wt('profile_modal.loading_menu', 'Загрузка меню...')}</span>
                </div>
            </div>
        `;
        positionMenu();
    }

    function renderLegacyShell() {
        const { panel } = injectMenu();
        if (!panel) return;

        panel.innerHTML = `
            <div class="border-b border-border-subtle bg-surface-2 px-4 py-3">
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">${wt('profile_modal.legacy_header', 'Текущий профиль')}</p>
                <div id="sharedProfileMenuCurrent" class="mt-3 flex items-center gap-3">
                    <div class="text-sm text-text-secondary">${wt('profile_modal.legacy_loading', 'Загрузка...')}</div>
                </div>
            </div>
            <div class="px-2 py-2">
                <div class="flex items-center justify-between gap-3 px-2 pb-2">
                    <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">${wt('profile_modal.legacy_switch_label', 'Быстрое переключение')}</p>
                    <a href="/settings"
                        id="sharedProfileSettings"
                        class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-bg-hover">
                        <span class="material-symbols-outlined text-[16px]">settings</span>
                        ${wt('profile_modal.legacy_settings', 'Настройки профиля')}
                    </a>
                </div>
                <div id="sharedProfileList" class="max-h-[320px] overflow-y-auto space-y-1 px-1 pb-1">
                    <div class="text-center text-text-secondary py-6">
                        <div class="inline-flex items-center gap-2">
                            <span class="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                            <span class="text-sm">${wt('profile_modal.legacy_loading_profiles', 'Загрузка профилей...')}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="border-t border-border-subtle bg-surface-2 p-2">
                <button id="sharedProfileManage" type="button"
                    class="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-main transition-colors hover:bg-surface-1 hover:text-primary">
                    <span class="material-symbols-outlined text-[18px]">manage_accounts</span>
                    ${wt('profile_modal.legacy_manage', 'Управление профилями')}
                </button>
            </div>
        `;

        const manageButton = document.getElementById('sharedProfileManage');
        if (manageButton) {
            manageButton.addEventListener('click', () => {
                closeProfileMenu();
                openProfileManagement();
            });
        }

        const settingsLink = document.getElementById('sharedProfileSettings');
        if (settingsLink) {
            settingsLink.addEventListener('click', () => {
                closeProfileMenu();
            });
        }

        positionMenu();
    }

    function renderHostedShell() {
        const { panel } = injectMenu();
        if (!panel) return;

        const currentThemeMeta = getCurrentThemeMeta();
        const currentThemeLabel = currentThemeMeta?.name || wt('profile_modal.hosted_theme_title', 'Оформление');
        const spoilerIcon = isThemeSectionExpanded ? 'expand_less' : 'expand_more';
        const effectivePlan = String(currentHostedUser?.effective_plan || currentHostedUser?.plan || 'free').trim().toLowerCase();
        const premiumExpiresAt = String(currentHostedUser?.premium_expires_at || '').trim();
        const planLabel = effectivePlan === 'premium'
            ? (premiumExpiresAt
                ? wt('profile_modal.hosted_premium_until', 'Premium до {date}').replace('{date}', formatPremiumDate(premiumExpiresAt))
                : wt('profile_modal.hosted_premium_active', 'Premium активен'))
            : wt('profile_modal.hosted_free_plan', 'Free план');

        panel.innerHTML = `
            <div class="border-b border-border-subtle px-4 py-4">
                <div class="flex items-center justify-between gap-3">
                    <p class="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">${wt('profile_modal.hosted_header', 'Аккаунт')}</p>
                    <span class="inline-flex items-center rounded-full border border-border-subtle bg-bg-secondary px-3 py-1 text-xs font-semibold text-text-secondary">
                        Hosted
                    </span>
                </div>
                <div id="sharedProfileMenuCurrent" class="mt-4 flex items-center gap-3">
                    <div class="text-sm text-text-secondary">${wt('profile_modal.hosted_loading', 'Загрузка аккаунта...')}</div>
                </div>
            </div>
            <div class="px-4 py-4 space-y-3">
                <a href="/settings"
                    id="sharedProfileSettings"
                    class="shared-profile-focus-target flex items-center justify-between rounded-2xl border border-border-subtle bg-surface-1 px-4 py-3 text-left transition-all hover:border-primary hover:bg-bg-hover">
                    <div class="flex items-center gap-3">
                        <span class="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary-light bg-primary-lighter text-primary">
                            <span class="material-symbols-outlined text-[20px]">settings_account_box</span>
                        </span>
                        <div>
                            <div class="text-sm font-semibold text-text-main">${wt('profile_modal.hosted_settings_title', 'Настройки аккаунта')}</div>
                            <div class="text-sm text-text-secondary">${wt('profile_modal.hosted_settings_desc', 'Профиль, аватар и персональные параметры')}</div>
                        </div>
                    </div>
                    <span class="material-symbols-outlined text-text-secondary">arrow_forward</span>
                </a>
                <button type="button"
                    id="sharedProfilePremium"
                    class="shared-profile-focus-target flex w-full items-center justify-between rounded-2xl border border-border-subtle bg-surface-1 px-4 py-3 text-left transition-all hover:border-primary hover:bg-bg-hover">
                    <div class="flex items-center gap-3">
                        <span class="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary-light bg-primary-lighter text-primary">
                            <span class="material-symbols-outlined text-[20px]">workspace_premium</span>
                        </span>
                        <div>
                            <div class="text-sm font-semibold text-text-main">${escapeHtml(planLabel)}</div>
                            <div class="text-sm text-text-secondary">${wt('profile_modal.hosted_premium_desc', 'Premium и будущая оплата')}</div>
                        </div>
                    </div>
                    <span class="material-symbols-outlined text-text-secondary">arrow_forward</span>
                </button>
                <div class="rounded-2xl border border-border-subtle bg-surface-1 overflow-hidden">
                    <button type="button"
                        id="sharedProfileThemeToggle"
                        data-profile-theme-toggle="true"
                        aria-expanded="${isThemeSectionExpanded ? 'true' : 'false'}"
                        class="shared-profile-focus-target flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover">
                        <div class="flex min-w-0 items-center gap-3">
                            <span class="flex h-11 w-11 items-center justify-center rounded-2xl border border-border-subtle bg-bg-secondary text-primary">
                                <span class="material-symbols-outlined text-[20px]">palette</span>
                            </span>
                            <div class="min-w-0">
                                <div class="text-sm font-semibold text-text-main">${wt('profile_modal.hosted_theme_title', 'Оформление')}</div>
                                <div class="mt-0.5 text-sm text-text-secondary">
                                    <span class="truncate">${escapeHtml(currentThemeLabel)}</span>
                                </div>
                            </div>
                        </div>
                        <span class="material-symbols-outlined text-text-secondary">${spoilerIcon}</span>
                    </button>
                    <div id="sharedProfileThemeSection" class="${isThemeSectionExpanded ? 'block' : 'hidden'} overflow-x-hidden border-t border-border-subtle px-4 pb-4 pt-3">
                        <p class="text-sm text-text-secondary">${wt('profile_modal.hosted_theme_hint', 'Подберите палитру. Изменение применяется сразу и сохраняется для аккаунта.')}</p>
                        <div id="sharedProfileThemeList" class="mt-3 grid min-w-0 grid-cols-1 gap-2 overflow-x-hidden">
                            <div class="rounded-xl border border-border-subtle bg-bg-secondary px-3 py-4 text-center text-sm text-text-secondary">
                                ${wt('profile_modal.hosted_themes_loading', 'Загружаем темы...')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="border-t border-border-subtle p-2">
                <button id="sharedProfileLogout" type="button"
                    class="shared-profile-focus-target flex w-full items-center justify-center gap-2 rounded-xl border border-border-subtle bg-surface-1 px-3 py-2.5 text-sm font-semibold text-text-main transition-colors hover:border-error hover:bg-bg-hover hover:text-error">
                    <span class="material-symbols-outlined text-[18px]">logout</span>
                    <span>${isLogoutPending ? wt('profile_modal.hosted_logout_busy', 'Выходим...') : wt('profile_modal.hosted_logout', 'Выйти')}</span>
                </button>
            </div>
        `;

        const settingsLink = document.getElementById('sharedProfileSettings');
        if (settingsLink) {
            settingsLink.addEventListener('click', () => {
                closeProfileMenu();
            });
        }

        const premiumLink = document.getElementById('sharedProfilePremium');
        if (premiumLink) {
            premiumLink.addEventListener('click', (event) => {
                event.preventDefault();
                closeProfileMenu();
                if (window.PremiumPromo && typeof window.PremiumPromo.open === 'function') {
                    window.PremiumPromo.open({
                        title: wt('profile_modal.premium_promo_title', 'Откройте ACTRA Premium'),
                        lead: wt('profile_modal.premium_promo_lead', 'Оплата Premium сейчас подключается. Пока можно посмотреть тарифы и возможности, а checkout появится после завершения интеграции.'),
                    });
                    return;
                }
                if (typeof window.navigateWithTransition === 'function') {
                    window.navigateWithTransition('/settings#premium');
                    return;
                }
                window.location.assign('/settings#premium');
            });
        }

        const themeToggleButton = document.getElementById('sharedProfileThemeToggle');
        if (themeToggleButton) {
            themeToggleButton.addEventListener('click', (event) => {
                if (event.currentTarget instanceof HTMLElement) {
                    event.currentTarget.blur();
                }
                isThemeSectionExpanded = !isThemeSectionExpanded;
                renderHostedShell();
                renderCurrentProfile(currentHostedUser);
                if (isThemeSectionExpanded) {
                    renderHostedThemeOptions(getCurrentThemeId());
                }
            });
        }

        const logoutButton = document.getElementById('sharedProfileLogout');
        if (logoutButton) {
            logoutButton.disabled = isLogoutPending;
            logoutButton.setAttribute('aria-disabled', isLogoutPending ? 'true' : 'false');
            logoutButton.addEventListener('click', () => {
                void logoutHostedUser();
            });
        }

        positionMenu();
    }

    function renderCurrentProfile(user) {
        const current = document.getElementById('sharedProfileMenuCurrent');
        if (!current) return;

        if (!user) {
            current.innerHTML = `<div class="text-sm text-text-secondary">${currentMode === MENU_MODE.HOSTED ? wt('profile_modal.hosted_not_found', 'Аккаунт не найден') : wt('profile_modal.legacy_not_found', 'Текущий профиль не найден')}</div>`;
            return;
        }

        const safeName = escapeHtml(user.name || wt('profile_modal.guest_name', 'Гость'));
        const safeAvatar = escapeHtml(getAvatarUrl(user.avatar_seed));
        const subtitle = currentMode === MENU_MODE.HOSTED
            ? getHostedAccountCaption()
            : wt('profile_modal.legacy_profile_caption', 'Тема и ключи сохраняются для этого профиля');

        current.innerHTML = `
            <div class="relative">
                <img src="${safeAvatar}" class="h-12 w-12 rounded-2xl border border-border-subtle bg-surface-1 object-cover shadow-sm" alt="${safeName}">
                ${currentMode === MENU_MODE.HOSTED
                    ? '<span class="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-surface-1 bg-success text-[11px] text-white">•</span>'
                    : ''}
            </div>
            <div class="min-w-0">
                <div class="truncate text-lg font-semibold text-text-main">${safeName}</div>
                <div class="mt-1 text-sm text-text-secondary">${subtitle}</div>
            </div>
        `;
    }

    function renderHostedThemeOptions(selectedThemeId) {
        if (currentMode !== MENU_MODE.HOSTED) return;

        const container = document.getElementById('sharedProfileThemeList');
        if (!container) return;

        const section = document.getElementById('sharedProfileThemeSection');
        if (!section || section.classList.contains('hidden')) {
            container.innerHTML = '';
            return;
        }

        const themes = getThemeCatalog();
        const activeThemeId = selectedThemeId || getCurrentThemeId();

        if (!themes.length) {
            container.innerHTML = `
                <div class="rounded-xl border border-border-subtle bg-bg-secondary px-3 py-4 text-center text-sm text-text-secondary">
                    ${wt('profile_modal.themes_unavailable', 'Темы недоступны')}
                </div>
            `;
            return;
        }

        container.innerHTML = themes.map((theme) => {
            const isActive = theme.id === activeThemeId;
            const swatch = theme.swatch || '#f8fafc';
            const border = theme.border || '#94a3b8';
            const accentInk = getAccessibleInk(swatch);
            const supportSwatches = [swatch, border, theme.isDark ? '#f8fafc' : '#0f172a'];

            return `
                <button type="button"
                    data-theme-chip="${escapeHtml(theme.id)}"
                    title="${escapeHtml(theme.name || theme.id)}"
                    class="shared-profile-focus-target shared-profile-theme-chip group flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all ${isActive
                        ? 'border-primary bg-primary-lighter shadow-md'
                        : 'border-border-subtle bg-surface-1 hover:border-primary hover:-translate-y-0.5'} ${isThemeSaving ? 'cursor-wait opacity-70' : ''}"
                    ${isThemeSaving ? 'disabled aria-disabled="true"' : ''}>
                    <span class="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-bg-secondary px-2 py-1">
                        ${supportSwatches.map((color) => `
                            <span class="h-3 w-3 rounded-full border shadow-sm" style="background:${escapeHtml(color)};border-color:rgba(255,255,255,0.4)"></span>
                        `).join('')}
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-semibold text-text-main">${escapeHtml(theme.name || theme.id)}</span>
                        <span class="mt-0.5 block text-xs text-text-secondary">${theme.isDark ? wt('profile_modal.theme_dark', 'Тёмная палитра') : wt('profile_modal.theme_light', 'Светлая палитра')}</span>
                    </span>
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-sm" style="background:${swatch};border-color:${border};color:${accentInk}">
                        <span class="material-symbols-outlined text-[16px] ${isActive ? 'text-primary' : ''}">
                            ${isActive ? 'check_circle' : 'ink_highlighter'}
                        </span>
                    </span>
                </button>
            `;
        }).join('');

        container.querySelectorAll('[data-theme-chip]').forEach((button) => {
            button.addEventListener('click', (event) => {
                if (event.currentTarget instanceof HTMLElement) {
                    event.currentTarget.blur();
                }
                const themeId = button.getAttribute('data-theme-chip');
                if (!themeId) return;
                void saveHostedTheme(themeId);
            });
        });

        positionMenu();
    }

    async function loadHostedThemePreference(token) {
        try {
            const response = await fetch('/api/ui/settings');
            if (!response.ok) {
                return getCurrentThemeId();
            }
            const data = await response.json().catch(() => null);
            if (token !== menuLoadToken) return null;
            const themeId = data?.ok && data.settings?.theme
                ? String(data.settings.theme)
                : getCurrentThemeId();

            if (
                window.ThemeManager
                && typeof window.ThemeManager.getTheme === 'function'
                && typeof window.ThemeManager.setTheme === 'function'
                && window.ThemeManager.getTheme() !== themeId
            ) {
                window.ThemeManager.setTheme(themeId);
            }

            return themeId;
        } catch (_error) {
            return getCurrentThemeId();
        }
    }

    async function saveHostedTheme(themeId) {
        if (!themeId || isThemeSaving || currentMode !== MENU_MODE.HOSTED) return;

        const previousThemeId = getCurrentThemeId();
        if (themeId === previousThemeId) {
            renderHostedThemeOptions(themeId);
            return;
        }

        isThemeSaving = true;
        if (window.ThemeManager && typeof window.ThemeManager.setTheme === 'function') {
            window.ThemeManager.setTheme(themeId);
        }
        renderHostedThemeOptions(themeId);

        try {
            const response = await fetch('/api/ui/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { theme: themeId } }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || 'theme_save_failed');
            }
        } catch (error) {
            console.error('[SharedProfileMenu] Failed to save theme:', error);
            if (window.ThemeManager && typeof window.ThemeManager.setTheme === 'function') {
                window.ThemeManager.setTheme(previousThemeId);
            }
            showToast(wt('profile_modal.toast_theme_failed', 'Не удалось сохранить тему'));
        } finally {
            isThemeSaving = false;
            renderHostedShell();
            renderCurrentProfile(currentHostedUser);
            if (isThemeSectionExpanded) {
                renderHostedThemeOptions(getCurrentThemeId());
            }
        }
    }

    async function detectHostedUser() {
        try {
            const response = await fetch('/api/auth/me');
            if (!response.ok) {
                return null;
            }
            const data = await response.json().catch(() => null);
            if (!data?.ok || !data.authenticated || !data.user) {
                return null;
            }
            return data.user;
        } catch (_error) {
            return null;
        }
    }

    async function loadHostedMenu(token, user) {
        if (token !== menuLoadToken) return;

        currentMode = MENU_MODE.HOSTED;
        currentHostedUser = user;
        currentUserId = user?.user_id || null;
        isThemeSectionExpanded = false;
        renderHostedShell();
        renderCurrentProfile(user);

        const themeId = await loadHostedThemePreference(token);
        if (token !== menuLoadToken || !themeId) return;
        renderHostedShell();
        renderCurrentProfile(user);
    }

    async function loadLegacyProfileList(token) {
        renderLegacyShell();

        const list = document.getElementById('sharedProfileList');
        if (!list) return;

        try {
            const [currentResponse, usersResponse] = await Promise.all([
                fetch('/api/users/current').catch(() => null),
                fetch('/api/users').catch(() => null),
            ]);
            if (token !== menuLoadToken) return;

            const currentData = currentResponse && currentResponse.ok
                ? await currentResponse.json().catch(() => null)
                : null;
            const usersData = usersResponse && usersResponse.ok
                ? await usersResponse.json().catch(() => null)
                : null;
            if (token !== menuLoadToken) return;

            if (currentData?.ok && currentData.user) {
                currentUserId = currentData.user.user_id;
                renderCurrentProfile(currentData.user);
            } else {
                currentUserId = null;
                renderCurrentProfile(null);
            }

            if (!usersData?.ok || !Array.isArray(usersData.items) || usersData.items.length === 0) {
                list.innerHTML = `
                    <div class="text-center py-8">
                        <span class="material-symbols-outlined text-text-secondary text-[32px] mb-2">person_off</span>
                        <p class="text-sm text-text-secondary">${wt('profile_modal.legacy_no_profiles', 'Нет профилей')}</p>
                        <p class="text-xs text-text-muted mt-1">${wt('profile_modal.legacy_no_profiles_hint', 'Перейдите на главную для создания профиля')}</p>
                    </div>`;
                return;
            }

            list.innerHTML = usersData.items.map((user) => {
                const isActive = currentUserId === user.user_id;
                const safeAvatar = escapeHtml(getAvatarUrl(user.avatar_seed));
                const safeName = escapeHtml(user.name || wt('profile_modal.guest_name', 'Гость'));
                const meta = isActive
                    ? wt('profile_modal.legacy_profile_active', 'Активный профиль')
                    : (user.has_password ? wt('profile_modal.legacy_profile_password', 'Пароль при входе') : wt('profile_modal.legacy_profile_switch', 'Переключить'));

                return `
                    <button type="button"
                        class="flex w-full items-center gap-4 rounded-xl border p-3 text-left transition-all ${isActive
                            ? 'border-primary bg-primary-lighter'
                            : 'border-border-subtle hover:border-primary hover:bg-bg-hover'}"
                        data-profile-switch="${escapeHtml(String(user.user_id || ''))}">
                        <img src="${safeAvatar}" class="h-10 w-10 rounded-full bg-surface-2 object-cover" alt="${safeName}">
                        <div class="min-w-0 flex-1">
                            <div class="truncate font-medium text-text-main">${safeName}</div>
                            <div class="text-xs text-text-muted">${meta}</div>
                        </div>
                        ${isActive
                            ? '<span class="material-symbols-outlined shrink-0 text-primary">check_circle</span>'
                            : '<span class="material-symbols-outlined shrink-0 text-text-muted">arrow_forward</span>'}
                    </button>`;
            }).join('');

            list.querySelectorAll('[data-profile-switch]').forEach((button) => {
                button.addEventListener('click', async () => {
                    const userId = button.getAttribute('data-profile-switch');
                    if (!userId) return;

                    closeProfileMenu();
                    if (typeof window.selectProfile === 'function' && window.selectProfile !== selectProfile) {
                        await window.selectProfile(userId);
                        return;
                    }
                    await selectProfile(userId);
                });
            });

            positionMenu();
        } catch (error) {
            console.error('[SharedProfileMenu] Failed to load profiles:', error);
            list.innerHTML = `
                <div class="text-center py-8 text-text-secondary">
                    <span class="material-symbols-outlined text-[32px] mb-2">error</span>
                    <p class="text-sm">${wt('profile_modal.legacy_load_failed', 'Не удалось загрузить профили')}</p>
                </div>`;
        }
    }

    function openProfileManagement() {
        if (typeof window.openProfileManagementModal === 'function') {
            window.openProfileManagementModal();
            return;
        }

        if (typeof window.openProfileModal === 'function' && window.openProfileModal !== openProfileMenu) {
            window.openProfileModal();
            return;
        }

        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition('/main');
            return;
        }

        window.location.assign('/main');
    }

    function navigateTo(url) {
        if (!url) return;

        if (window.PageTransition && typeof window.PageTransition.navigate === 'function') {
            window.PageTransition.navigate(url);
            return;
        }

        if (typeof window.location?.assign === 'function') {
            window.location.assign(url);
        }
    }

    async function logoutHostedUser() {
        if (isLogoutPending || currentMode !== MENU_MODE.HOSTED) return;

        isLogoutPending = true;
        renderHostedShell();
        renderCurrentProfile(currentHostedUser);
        renderHostedThemeOptions(getCurrentThemeId());

        try {
            const response = await fetch('/api/auth/logout', { method: 'POST' });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || 'auth_logout_failed');
            }

            closeProfileMenu();
            navigateTo('/welcome');
        } catch (error) {
            console.error('[SharedProfileMenu] Failed to logout:', error);
            showToast(wt('profile_modal.toast_logout_failed', 'Не удалось выйти из аккаунта'));
        } finally {
            isLogoutPending = false;
            if (currentMode === MENU_MODE.HOSTED && isMenuOpen()) {
                renderHostedShell();
                renderCurrentProfile(currentHostedUser);
                renderHostedThemeOptions(getCurrentThemeId());
            }
        }
    }

    async function loadMenuData(token) {
        const hostedUser = await detectHostedUser();
        if (token !== menuLoadToken) return;

        if (hostedUser) {
            await loadHostedMenu(token, hostedUser);
            return;
        }

        currentMode = MENU_MODE.LEGACY;
        currentHostedUser = null;
        await loadLegacyProfileList(token);
    }

    function openProfileMenu(source) {
        injectMenu();
        const anchor = resolveAnchor(source);
        if (!anchor) return;

        if (activeAnchor === anchor && isMenuOpen()) {
            closeProfileMenu();
            return;
        }

        activeAnchor = anchor;
        setAnchorExpanded(true);
        const { overlay } = getElements();
        overlay.classList.remove('hidden');
        renderLoadingState();
        positionMenu();

        const token = ++menuLoadToken;
        void loadMenuData(token);
    }

    function closeProfileMenu() {
        menuLoadToken += 1;
        const { overlay } = getElements();
        if (overlay) {
            overlay.classList.add('hidden');
        }
        setAnchorExpanded(false);
        activeAnchor = null;
    }

    async function selectProfile(userId) {
        if (!userId) return;

        try {
            const response = await fetch('/api/users/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId }),
            });
            const data = await response.json();

            if (data.ok) {
                closeProfileMenu();
                showToast(wt('profile_modal.toast_profile_switched', 'Профиль переключен'), 'success', 1500);
                setTimeout(() => window.location.reload(), 400);
                return;
            }

            showToast(wt('profile_modal.toast_switch_failed', 'Не удалось переключить профиль'));
        } catch (error) {
            console.error('[SharedProfileMenu] Failed to select profile:', error);
            showToast(wt('profile_modal.toast_switch_network', 'Ошибка сети при переключении профиля'));
        }
    }

    window.openProfileMenu = openProfileMenu;
    window.closeProfileMenu = closeProfileMenu;

    if (typeof window.openProfileModal !== 'function') {
        window.openProfileModal = openProfileMenu;
    }
    if (typeof window.closeProfileModal !== 'function') {
        window.closeProfileModal = closeProfileMenu;
    }
    if (typeof window.selectProfile !== 'function') {
        window.selectProfile = selectProfile;
    }
    if (!window.getAvatarUrl) {
        window.getAvatarUrl = getAvatarUrl;
    }

    window.addEventListener('i18n:changed', function () {
        if (isMenuOpen()) {
            if (currentMode === MENU_MODE.HOSTED) {
                renderHostedShell();
                renderCurrentProfile(currentHostedUser);
                if (isThemeSectionExpanded) renderHostedThemeOptions(getCurrentThemeId());
            } else {
                renderLegacyShell();
            }
        }
    });
})();
