/**
 * SharedProfileModal.js
 * Shared lightweight profile switcher menu for Calendar, Statistics,
 * Microcards, and Main. Main.html still owns the heavy management modal.
 *
 * Exposes:
 *   openProfileMenu(eventOrAnchor)
 *   closeProfileMenu()
 *   selectProfile(userId)    // only when a page has not provided its own
 */
(function () {
    'use strict';

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
        if (typeof NotificationUI !== 'undefined' && NotificationUI.toast) {
            NotificationUI.toast(message, type, duration);
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

    let currentUserId = null;
    let activeAnchor = null;
    let globalListenersBound = false;

    function getElements() {
        return {
            overlay: document.getElementById('sharedProfileMenuOverlay'),
            panel: document.getElementById('sharedProfileMenuPanel'),
            current: document.getElementById('sharedProfileMenuCurrent'),
            list: document.getElementById('sharedProfileList'),
            manageButton: document.getElementById('sharedProfileManage'),
        };
    }

    function injectMenu() {
        if (document.getElementById('sharedProfileMenuOverlay')) {
            return getElements();
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
        <div id="sharedProfileMenuOverlay" class="fixed inset-0 z-[100] hidden">
            <div id="sharedProfileMenuPanel"
                class="absolute w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-2xl">
                <div class="border-b border-border-subtle bg-surface-2 px-4 py-3">
                    <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">Текущий профиль</p>
                    <div id="sharedProfileMenuCurrent" class="mt-3 flex items-center gap-3">
                        <div class="text-sm text-text-secondary">Загрузка...</div>
                    </div>
                </div>
                <div class="px-2 py-2">
                    <div class="flex items-center justify-between gap-3 px-2 pb-2">
                        <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">Быстрое переключение</p>
                        <a href="/ui/settings"
                            class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-bg-hover">
                            <span class="material-symbols-outlined text-[16px]">settings</span>
                            Настройки профиля
                        </a>
                    </div>
                    <div id="sharedProfileList" class="max-h-[320px] overflow-y-auto space-y-1 px-1 pb-1">
                        <div class="text-center text-text-secondary py-6">
                            <div class="inline-flex items-center gap-2">
                                <span class="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                                <span class="text-sm">Загрузка профилей...</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="border-t border-border-subtle bg-surface-2 p-2">
                    <button id="sharedProfileManage" type="button"
                        class="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-text-main transition-colors hover:bg-surface-1 hover:text-primary">
                        <span class="material-symbols-outlined text-[18px]">manage_accounts</span>
                        Управление профилями
                    </button>
                </div>
            </div>
        </div>`;

        document.body.appendChild(wrapper.firstElementChild);

        const elements = getElements();
        elements.overlay.addEventListener('click', (event) => {
            if (event.target === elements.overlay) {
                closeProfileMenu();
            }
        });
        elements.panel.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        elements.manageButton.addEventListener('click', () => {
            closeProfileMenu();
            openProfileManagement();
        });

        if (!globalListenersBound) {
            globalListenersBound = true;
            document.addEventListener('keydown', (event) => {
                const { overlay } = getElements();
                if (event.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
                    closeProfileMenu();
                }
            });
            window.addEventListener('resize', () => {
                const { overlay } = getElements();
                if (overlay && !overlay.classList.contains('hidden')) {
                    positionMenu();
                }
            });
            window.addEventListener('scroll', () => {
                const { overlay } = getElements();
                if (overlay && !overlay.classList.contains('hidden')) {
                    closeProfileMenu();
                }
            }, true);
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

    function positionMenu() {
        const { panel } = getElements();
        if (!panel || !activeAnchor) return;

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

    function renderCurrentProfile(user) {
        const { current } = getElements();
        if (!current) return;

        if (!user) {
            current.innerHTML = `<div class="text-sm text-text-secondary">Текущий профиль не найден</div>`;
            return;
        }

        const safeName = escapeHtml(user.name || 'Гость');
        const safeAvatar = escapeHtml(getAvatarUrl(user.avatar_seed));

        current.innerHTML = `
            <img src="${safeAvatar}" class="h-11 w-11 rounded-full bg-surface-1 object-cover" alt="${safeName}">
            <div class="min-w-0">
                <div class="truncate font-semibold text-text-main">${safeName}</div>
                <div class="mt-0.5 text-xs text-text-secondary">Тема и ключи сохраняются для этого профиля</div>
            </div>
        `;
    }

    async function loadProfileList() {
        const { list } = injectMenu();
        if (!list) return;

        list.innerHTML = `
            <div class="text-center text-text-secondary py-6">
                <div class="inline-flex items-center gap-2">
                    <span class="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                    <span class="text-sm">Загрузка профилей...</span>
                </div>
            </div>
        `;

        try {
            const [currentData, usersData] = await Promise.all([
                fetch('/api/users/current').then((response) => response.json()).catch(() => null),
                fetch('/api/users').then((response) => response.json()).catch(() => null),
            ]);

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
                        <p class="text-sm text-text-secondary">Нет профилей</p>
                        <p class="text-xs text-text-muted mt-1">Перейдите на главную для создания профиля</p>
                    </div>`;
                return;
            }

            list.innerHTML = usersData.items.map((user) => {
                const isActive = currentUserId === user.user_id;
                const safeAvatar = escapeHtml(getAvatarUrl(user.avatar_seed));
                const safeName = escapeHtml(user.name || 'Гость');
                const meta = isActive
                    ? 'Активный профиль'
                    : (user.has_password ? 'Пароль при входе' : 'Переключить');

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
        } catch (error) {
            console.error('[SharedProfileMenu] Failed to load profiles:', error);
            list.innerHTML = `
                <div class="text-center py-8 text-text-secondary">
                    <span class="material-symbols-outlined text-[32px] mb-2">error</span>
                    <p class="text-sm">Не удалось загрузить профили</p>
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
            window.navigateWithTransition('/ui/main');
            return;
        }

        window.location.assign('/ui/main');
    }

    function openProfileMenu(source) {
        const elements = injectMenu();
        const anchor = resolveAnchor(source);
        if (!anchor) return;

        if (activeAnchor === anchor && !elements.overlay.classList.contains('hidden')) {
            closeProfileMenu();
            return;
        }

        activeAnchor = anchor;
        setAnchorExpanded(true);
        elements.overlay.classList.remove('hidden');
        positionMenu();
        loadProfileList();
    }

    function closeProfileMenu() {
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
                showToast('Профиль переключен', 'success', 1500);
                setTimeout(() => window.location.reload(), 400);
                return;
            }

            showToast('Не удалось переключить профиль');
        } catch (error) {
            console.error('[SharedProfileMenu] Failed to select profile:', error);
            showToast('Ошибка сети при переключении профиля');
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
})();
