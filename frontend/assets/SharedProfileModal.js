/**
 * SharedProfileModal.js
 * Unified profile switching modal for Calendar, Statistics, and other secondary pages.
 * Main.html keeps its own full-featured modal (create/edit/delete/password).
 *
 * Usage: include <script src="/assets/SharedProfileModal.js"></script> before </body>.
 * The script auto-injects the modal HTML and exposes global functions:
 *   openProfileModal(), closeProfileModal(), selectProfile(userId)
 */
(function () {
    'use strict';

    // --- Helpers ---
    function getAvatarUrl(avatarSeed, userId) {
        if (!avatarSeed) avatarSeed = '1.png';
        if (avatarSeed.includes('.')) {
            return `/api/assets/avatars/${avatarSeed}`;
        }
        return '/api/assets/avatars/1.png';
    }

    // --- State ---
    let _currentUserId = null;

    // --- Modal HTML ---
    function injectModal() {
        if (document.getElementById('sharedProfileModal')) return;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
        <div id="sharedProfileModal" class="fixed inset-0 z-[100] hidden transition-opacity duration-200">
            <div class="absolute inset-0 bg-scrim-strong backdrop-blur-sm" data-profile-backdrop></div>
            <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md">
                <div class="bg-surface-1 rounded-2xl shadow-2xl border border-border-subtle overflow-hidden mx-4">
                    <div class="p-5 border-b border-border-subtle flex items-center justify-between bg-surface-2">
                        <h3 class="text-lg font-bold text-text-main">Профили</h3>
                        <button data-profile-close
                            class="size-8 flex items-center justify-center rounded-full hover:bg-surface-1 transition-colors">
                            <span class="material-symbols-outlined text-text-muted">close</span>
                        </button>
                    </div>
                    <div id="sharedProfileList" class="p-4 max-h-[320px] overflow-y-auto space-y-2">
                        <div class="text-center text-text-secondary py-6">Загрузка...</div>
                    </div>
                    <div class="px-5 py-4 border-t border-border-subtle bg-surface-2">
                        <a href="/ui/main"
                            class="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-medium text-primary hover:bg-bg-hover rounded-lg transition-colors">
                            <span class="material-symbols-outlined text-[18px]">manage_accounts</span>
                            Управление профилями
                        </a>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.appendChild(wrapper.firstElementChild);

        // Event listeners
        const modal = document.getElementById('sharedProfileModal');
        modal.querySelector('[data-profile-backdrop]').addEventListener('click', closeProfileModal);
        modal.querySelector('[data-profile-close]').addEventListener('click', closeProfileModal);

        // ESC key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                closeProfileModal();
            }
        });
    }

    // --- API ---
    async function loadProfileList() {
        const listEl = document.getElementById('sharedProfileList');
        if (!listEl) return;

        listEl.innerHTML = `<div class="text-center text-text-secondary py-6">
            <div class="inline-flex items-center gap-2">
                <span class="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                <span class="text-sm">Загрузка профилей...</span>
            </div>
        </div>`;

        try {
            // Fetch current user to highlight
            try {
                const curRes = await fetch('/api/users/current');
                const curData = await curRes.json();
                if (curData.ok && curData.user) {
                    _currentUserId = curData.user.user_id;
                }
            } catch (_) { /* ignore */ }

            const res = await fetch('/api/users');
            const data = await res.json();

            if (!data.ok || !Array.isArray(data.items) || data.items.length === 0) {
                listEl.innerHTML = `
                    <div class="text-center py-8">
                        <span class="material-symbols-outlined text-text-secondary text-[32px] mb-2">person_off</span>
                        <p class="text-sm text-text-secondary">Нет профилей</p>
                        <p class="text-xs text-text-muted mt-1">Перейдите на главную для создания профиля</p>
                    </div>`;
                return;
            }

            listEl.innerHTML = data.items.map(user => {
                const isActive = _currentUserId === user.user_id;
                const avatar = getAvatarUrl(user.avatar_seed, user.user_id);
                return `
                    <div class="flex items-center gap-4 p-3 rounded-xl border ${isActive
                        ? 'border-primary bg-primary-lighter'
                        : 'border-border-subtle hover:border-primary'} cursor-pointer transition-all"
                        onclick="selectProfile('${user.user_id}')">
                        <img src="${avatar}" class="w-10 h-10 rounded-full bg-surface-2 object-cover" alt="${user.name}">
                        <div class="flex-1 min-w-0">
                            <div class="font-medium text-text-main truncate">${user.name}</div>
                            <div class="text-xs text-text-muted">${isActive ? 'Текущий профиль' : ''}</div>
                        </div>
                        ${isActive
                            ? '<span class="material-symbols-outlined text-primary shrink-0">check_circle</span>'
                            : ''}
                    </div>`;
            }).join('');

        } catch (e) {
            console.error('[SharedProfileModal] Failed to load profiles:', e);
            listEl.innerHTML = `
                <div class="text-center py-8 text-text-secondary">
                    <span class="material-symbols-outlined text-[32px] mb-2">error</span>
                    <p class="text-sm">Не удалось загрузить профили</p>
                </div>`;
        }
    }

    // --- Public API ---
    function openProfileModal() {
        injectModal();
        const modal = document.getElementById('sharedProfileModal');
        modal.classList.remove('hidden');
        loadProfileList();
    }

    function closeProfileModal() {
        const modal = document.getElementById('sharedProfileModal');
        if (modal) modal.classList.add('hidden');
    }

    async function selectProfile(userId) {
        if (!userId) return;
        try {
            const res = await fetch('/api/users/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId })
            });
            const data = await res.json();
            if (data.ok) {
                closeProfileModal();
                // Toast if NotificationUI available
                if (typeof NotificationUI !== 'undefined' && NotificationUI.toast) {
                    NotificationUI.toast(
                        "Profile switched",
                        'success', 1500
                    );
                    setTimeout(() => window.location.reload(), 400);
                } else {
                    window.location.reload();
                }
            }
        } catch (e) {
            console.error('[SharedProfileModal] Failed to select profile:', e);
        }
    }

    // Expose globally
    window.openProfileModal = openProfileModal;
    window.closeProfileModal = closeProfileModal;
    window.selectProfile = selectProfile;

    // Also expose getAvatarUrl for pages that need it
    if (!window.getAvatarUrl) {
        window.getAvatarUrl = getAvatarUrl;
    }
})();

