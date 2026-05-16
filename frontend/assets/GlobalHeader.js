(function () {
    'use strict';

    const NAV_ITEMS = [
        { section: 'main', label: 'Главная', icon: 'home', href: '/main' },
        { section: 'catalog', label: 'Каталог', icon: 'travel_explore', href: '/catalog' },
        { section: 'complexes', label: 'Комплексы', icon: 'inventory_2', href: '/complexes' },
        { section: 'theory', label: 'Теория', icon: 'hub', href: '/theory-center' },
        { section: 'editor', label: 'Редактор', icon: 'edit_document', href: '/editor' },
    ];

    const CREATE_ITEMS = [
        {
            label: 'Задание',
            copy: 'Открыть мастер создания задания',
            icon: 'add_task',
            href: '/editor?create=task',
        },
        {
            label: 'Комплекс',
            copy: 'Собрать новый учебный комплекс',
            icon: 'design_services',
            href: '/complexes/create',
        },
        {
            label: 'Теория',
            copy: 'Создать теоретический материал',
            icon: 'edit_square',
            href: '/editor/Theory_Editor.html',
        },
    ];

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    function getSectionFromPath() {
        const path = window.location.pathname.replace(/\/+$/, '') || '/';
        if (path === '/main' || path === '/ui' || path === '/ui/main') return 'main';
        if (path === '/catalog' || path === '/ui/catalog') return 'catalog';
        if (path === '/complexes' || path === '/ui/complexes') return 'complexes';
        if (path === '/theory-center' || path === '/ui/theory-center' || path.endsWith('/Theory_Center.html')) return 'theory';
        if (path === '/editor' || path === '/ui/editor') return 'editor';
        if (path === '/reference' || path === '/ui/reference') return 'reference';
        return '';
    }

    function navigate(href) {
        if (!href) return;
        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition(href);
            return;
        }
        window.location.href = href;
    }

    function closeCreateMenu(root) {
        const menu = root.querySelector('[data-global-create-menu]');
        const button = root.querySelector('[data-global-create-toggle]');
        if (menu) menu.classList.remove('is-open');
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function renderHeader(root) {
        const activeSection = root.dataset.appSection || document.body.dataset.appSection || getSectionFromPath();
        const navHtml = NAV_ITEMS.map((item) => {
            const active = item.section === activeSection;
            return `
                <a class="global-header__link${active ? ' is-active' : ''}" href="${escapeHtml(item.href)}" data-global-nav="${escapeHtml(item.href)}" ${active ? 'aria-current="page"' : ''}>
                    <span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(item.icon)}</span>
                    <span>${escapeHtml(item.label)}</span>
                </a>
            `;
        }).join('');

        const createHtml = CREATE_ITEMS.map((item) => `
            <button class="global-header__menu-item" type="button" data-global-nav="${escapeHtml(item.href)}">
                <span class="global-header__menu-icon material-symbols-outlined" aria-hidden="true">${escapeHtml(item.icon)}</span>
                <span>
                    <span class="global-header__menu-title">${escapeHtml(item.label)}</span>
                    <span class="global-header__menu-copy">${escapeHtml(item.copy)}</span>
                </span>
            </button>
        `).join('');

        root.innerHTML = `
            <header class="global-header">
                <div class="global-header__inner">
                    <a class="global-header__brand" href="/main" data-global-nav="/main" aria-label="ACTRA, на главную">
                        <span class="brand-logo global-header__brand-logo" aria-hidden="true"></span>
                        <span class="global-header__brand-text">ACTRA</span>
                    </a>
                    <nav class="global-header__nav" aria-label="Основная навигация">
                        ${navHtml}
                    </nav>
                    <div class="global-header__actions">
                        <div class="global-header__create">
                            <button class="global-header__menu-button" type="button" data-global-create-toggle aria-haspopup="menu" aria-expanded="false">
                                <span class="material-symbols-outlined" aria-hidden="true">add_circle</span>
                                <span>Создать</span>
                                <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
                            </button>
                            <div class="global-header__menu" data-global-create-menu role="menu">
                                ${createHtml}
                            </div>
                        </div>
                        <button class="global-header__reference" type="button" data-global-reference title="Открыть справочник">
                            <span class="material-symbols-outlined" aria-hidden="true">menu_book</span>
                            <span>Справочник</span>
                        </button>
                        <button class="global-header__onboarding-help onboarding-help-button onboarding-help-button--icon" type="button" data-onboarding-help-button data-onboarding-help-mode="direct" hidden title="Показать обучение" aria-label="Показать обучение">
                            <span class="material-symbols-outlined" aria-hidden="true">help</span>
                        </button>
                        <button class="global-header__profile" type="button" data-profile-menu-anchor aria-haspopup="menu" aria-expanded="false">
                            <img src="/api/assets/avatars/1.png" class="global-header__avatar" alt="" id="headerAvatar" data-global-avatar>
                            <span class="global-header__plan-badge" data-global-plan-badge hidden>Free</span>
                            <span class="global-header__user-name" id="headerUserName" data-global-user-name>Загрузка...</span>
                            <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
                        </button>
                    </div>
                </div>
            </header>
        `;
    }

    async function hydrateUser(root) {
        const avatar = root.querySelector('[data-global-avatar]');
        const name = root.querySelector('[data-global-user-name]');
        const planBadge = root.querySelector('[data-global-plan-badge]');
        try {
            const response = await fetch('/api/users/current');
            const data = await response.json();
            const user = data && (data.user || data.profile || data);
            const displayName = user?.display_name || user?.name || user?.username || user?.login || '';
            const avatarSeed = user?.avatar_seed || user?.avatar || user?.avatarSeed || '1.png';
            const effectivePlan = String(user?.effective_plan || user?.plan || 'free').trim().toLowerCase();
            if (name && displayName) name.textContent = displayName;
            if (planBadge) {
                planBadge.hidden = false;
                planBadge.textContent = effectivePlan === 'premium' ? 'Premium' : 'Free';
                planBadge.classList.toggle('is-premium', effectivePlan === 'premium');
            }
            if (avatar) {
                avatar.src = String(avatarSeed).includes('.')
                    ? `/api/assets/avatars/${encodeURIComponent(String(avatarSeed))}`
                    : '/api/assets/avatars/1.png';
            }
        } catch (_) {
            if (planBadge) planBadge.hidden = true;
            if (name) name.textContent = 'Профиль';
        }
    }

    function bindHeader(root) {
        root.addEventListener('click', (event) => {
            const createToggle = event.target.closest('[data-global-create-toggle]');
            if (createToggle) {
                event.preventDefault();
                event.stopPropagation();
                const menu = root.querySelector('[data-global-create-menu]');
                const isOpen = menu && !menu.classList.contains('is-open');
                if (menu) menu.classList.toggle('is-open', !!isOpen);
                createToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                return;
            }

            const reference = event.target.closest('[data-global-reference]');
            if (reference) {
                event.preventDefault();
                closeCreateMenu(root);
                navigate('/reference');
                return;
            }

            const profile = event.target.closest('[data-profile-menu-anchor]');
            if (profile) {
                if (typeof window.openProfileMenu === 'function') {
                    window.openProfileMenu(event);
                }
                return;
            }

            const nav = event.target.closest('[data-global-nav]');
            if (nav) {
                event.preventDefault();
                closeCreateMenu(root);
                navigate(nav.getAttribute('data-global-nav') || nav.getAttribute('href'));
            }
        });

        document.addEventListener('click', (event) => {
            if (!root.contains(event.target)) closeCreateMenu(root);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeCreateMenu(root);
        });
    }

    function initGlobalHeaders() {
        document.querySelectorAll('[data-global-header]').forEach((root) => {
            if (root.dataset.globalHeaderReady === '1') return;
            root.dataset.globalHeaderReady = '1';
            renderHeader(root);
            bindHeader(root);
            if (window.__mainOwnsGlobalHeaderHydration && root.dataset.appSection === 'main') {
                if (window.__mainCurrentUser && typeof window.__mainUpdateHeaderUser === 'function') {
                    window.__mainUpdateHeaderUser(window.__mainCurrentUser);
                }
            } else {
                hydrateUser(root);
            }
            if (window.OnboardingTour && typeof window.OnboardingTour.refreshHelpButtons === 'function') {
                window.OnboardingTour.refreshHelpButtons();
            }
        });
    }

    window.GlobalHeader = {
        init: initGlobalHeaders,
    };

    initGlobalHeaders();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGlobalHeaders, { once: true });
    }
})();
