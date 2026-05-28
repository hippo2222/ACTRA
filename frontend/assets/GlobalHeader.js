(function () {
    'use strict';

    var _t = function (key) {
        return (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(key) : key;
    };

    var NAV_ITEMS = [
        { section: 'main',      i18nKey: 'nav.home',      icon: 'home',           href: '/main' },
        { section: 'catalog',   i18nKey: 'nav.catalog',   icon: 'travel_explore', href: '/catalog' },
        { section: 'complexes', i18nKey: 'nav.complexes', icon: 'inventory_2',    href: '/complexes' },
        { section: 'theory',    i18nKey: 'nav.theory',    icon: 'hub',            href: '/theory-center' },
        { section: 'editor',    i18nKey: 'nav.editor',    icon: 'edit_document',  href: '/editor' },
    ];

    var CREATE_ITEMS = [
        {
            i18nKey:     'create.task_label',
            i18nCopyKey: 'create.task_copy',
            icon: 'add_task',
            href: '/editor?create=task',
        },
        {
            i18nKey:     'create.complex_label',
            i18nCopyKey: 'create.complex_copy',
            icon: 'design_services',
            href: '/complexes/create',
        },
        {
            i18nKey:     'create.theory_label',
            i18nCopyKey: 'create.theory_copy',
            icon: 'edit_square',
            href: '/editor/Theory_Editor.html',
        },
    ];

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, function (char) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char;
        });
    }

    function getSectionFromPath() {
        var path = window.location.pathname.replace(/\/+$/, '') || '/';
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
        var menu = root.querySelector('[data-global-create-menu]');
        var button = root.querySelector('[data-global-create-toggle]');
        if (menu) menu.classList.remove('is-open');
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function closeLangMenu(root) {
        var menu = root.querySelector('[data-global-lang-menu]');
        var button = root.querySelector('[data-global-lang-toggle]');
        if (menu) menu.classList.remove('is-open');
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function renderHeader(root) {
        var activeSection = root.dataset.appSection || document.body.dataset.appSection || getSectionFromPath();

        var navHtml = NAV_ITEMS.map(function (item) {
            var active = item.section === activeSection;
            var label = _t(item.i18nKey);
            return '<a class="global-header__link' + (active ? ' is-active' : '') + '"' +
                ' href="' + escapeHtml(item.href) + '"' +
                ' data-global-nav="' + escapeHtml(item.href) + '"' +
                ' data-i18n-aria="' + escapeHtml(item.i18nKey) + '" aria-label="' + escapeHtml(label) + '"' +
                ' data-i18n-title="' + escapeHtml(item.i18nKey) + '" title="' + escapeHtml(label) + '"' +
                (active ? ' aria-current="page"' : '') + '>' +
                '<span class="material-symbols-outlined" aria-hidden="true">' + escapeHtml(item.icon) + '</span>' +
                '<span data-i18n="' + escapeHtml(item.i18nKey) + '">' + escapeHtml(label) + '</span>' +
                '</a>';
        }).join('');

        var createHtml = CREATE_ITEMS.map(function (item) {
            return '<button class="global-header__menu-item" type="button" data-global-nav="' + escapeHtml(item.href) + '">' +
                '<span class="global-header__menu-icon material-symbols-outlined" aria-hidden="true">' + escapeHtml(item.icon) + '</span>' +
                '<span>' +
                '<span class="global-header__menu-title" data-i18n="' + escapeHtml(item.i18nKey) + '">' + escapeHtml(_t(item.i18nKey)) + '</span>' +
                '<span class="global-header__menu-copy" data-i18n="' + escapeHtml(item.i18nCopyKey) + '">' + escapeHtml(_t(item.i18nCopyKey)) + '</span>' +
                '</span>' +
                '</button>';
        }).join('');

        var currentLang = (window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';

        root.innerHTML =
            '<header class="global-header">' +
            '<div class="global-header__inner">' +
            '<a class="global-header__brand" href="/main" data-global-nav="/main"' +
            ' data-i18n-aria="header.brand_aria" aria-label="' + escapeHtml(_t('header.brand_aria')) + '">' +
            '<span class="brand-logo global-header__brand-logo" aria-hidden="true"></span>' +
            '<span class="global-header__brand-text">ACTRA</span>' +
            '</a>' +
            '<nav class="global-header__nav" data-i18n-aria="header.nav_aria" aria-label="' + escapeHtml(_t('header.nav_aria')) + '">' +
            navHtml +
            '</nav>' +
            '<div class="global-header__actions">' +
            '<div class="global-header__create">' +
            '<button class="global-header__menu-button" type="button" data-global-create-toggle aria-haspopup="menu" aria-expanded="false">' +
            '<span class="material-symbols-outlined" aria-hidden="true">add_circle</span>' +
            '<span data-i18n="create.button">' + escapeHtml(_t('create.button')) + '</span>' +
            '<span class="material-symbols-outlined" aria-hidden="true">expand_more</span>' +
            '</button>' +
            '<div class="global-header__menu" data-global-create-menu role="menu">' +
            createHtml +
            '</div>' +
            '</div>' +
            '<button class="global-header__reference" type="button" data-global-reference' +
            ' data-i18n-title="header.reference_title" title="' + escapeHtml(_t('header.reference_title')) + '">' +
            '<span class="material-symbols-outlined" aria-hidden="true">menu_book</span>' +
            '<span data-i18n="header.reference">' + escapeHtml(_t('header.reference')) + '</span>' +
            '</button>' +
            '<button class="global-header__onboarding-help onboarding-help-button onboarding-help-button--icon"' +
            ' type="button" data-onboarding-help-button data-onboarding-help-mode="direct" hidden' +
            ' data-i18n-title="header.onboarding_title" data-i18n-aria="header.onboarding_aria"' +
            ' title="' + escapeHtml(_t('header.onboarding_title')) + '"' +
            ' aria-label="' + escapeHtml(_t('header.onboarding_aria')) + '">' +
            '<span class="material-symbols-outlined" aria-hidden="true">help</span>' +
            '</button>' +
            '<div class="global-header__lang" data-global-lang>' +
            '<button class="global-header__lang-btn" type="button" data-global-lang-toggle aria-haspopup="menu" aria-expanded="false"' +
            ' data-i18n-aria="header.lang_aria" aria-label="' + escapeHtml(_t('header.lang_aria')) + '">' +
            '<span class="material-symbols-outlined" aria-hidden="true">language</span>' +
            '<span class="global-header__lang-code" data-lang-display>' + escapeHtml(currentLang.toUpperCase()) + '</span>' +
            '<span class="material-symbols-outlined global-header__lang-chevron" aria-hidden="true">expand_more</span>' +
            '</button>' +
            '<div class="global-header__lang-menu" data-global-lang-menu role="menu">' +
            '<button class="global-header__lang-item' + (currentLang === 'ru' ? ' is-active' : '') + '" type="button" data-lang-btn="ru" role="menuitem" aria-pressed="' + (currentLang === 'ru' ? 'true' : 'false') + '">' +
            '<span class="global-header__lang-item-dot" aria-hidden="true"></span>Русский' +
            '</button>' +
            '<button class="global-header__lang-item' + (currentLang === 'en' ? ' is-active' : '') + '" type="button" data-lang-btn="en" role="menuitem" aria-pressed="' + (currentLang === 'en' ? 'true' : 'false') + '">' +
            '<span class="global-header__lang-item-dot" aria-hidden="true"></span>English' +
            '</button>' +
            '<button class="global-header__lang-item' + (currentLang === 'uk' ? ' is-active' : '') + '" type="button" data-lang-btn="uk" role="menuitem" aria-pressed="' + (currentLang === 'uk' ? 'true' : 'false') + '">' +
            '<span class="global-header__lang-item-dot" aria-hidden="true"></span>Українська' +
            '</button>' +
            '</div>' +
            '</div>' +
            '<button class="global-header__profile" type="button" data-profile-menu-anchor aria-haspopup="menu" aria-expanded="false">' +
            '<img src="/api/assets/avatars/1.png" class="global-header__avatar" alt="" id="headerAvatar" data-global-avatar>' +
            '<span class="global-header__plan-badge" data-global-plan-badge hidden>Free</span>' +
            '<span class="global-header__user-name" id="headerUserName" data-global-user-name>' + escapeHtml(_t('header.profile_loading')) + '</span>' +
            '<span class="material-symbols-outlined" aria-hidden="true">expand_more</span>' +
            '</button>' +
            '</div>' +
            '</div>' +
            '</header>';
    }

    async function hydrateUser(root) {
        var avatar = root.querySelector('[data-global-avatar]');
        var name = root.querySelector('[data-global-user-name]');
        var planBadge = root.querySelector('[data-global-plan-badge]');
        try {
            var response = await fetch('/api/users/current');
            var data = await response.json();
            var user = data && (data.user || data.profile || data);
            var displayName = user?.display_name || user?.name || user?.username || user?.login || '';
            var avatarSeed = user?.avatar_seed || user?.avatar || user?.avatarSeed || '1.png';
            var effectivePlan = String(user?.effective_plan || user?.plan || 'free').trim().toLowerCase();
            if (name && displayName) name.textContent = displayName;
            if (planBadge) {
                planBadge.hidden = false;
                planBadge.textContent = effectivePlan === 'premium' ? 'Premium' : 'Free';
                planBadge.classList.toggle('is-premium', effectivePlan === 'premium');
            }
            if (avatar) {
                avatar.src = String(avatarSeed).includes('.')
                    ? '/api/assets/avatars/' + encodeURIComponent(String(avatarSeed))
                    : '/api/assets/avatars/1.png';
            }
        } catch (_) {
            if (planBadge) planBadge.hidden = true;
            if (name) name.textContent = (window.i18n && typeof window.i18n.t === 'function')
                ? window.i18n.t('header.profile_fallback')
                : 'Профиль';
        }
    }

    function bindHeader(root) {
        root.addEventListener('click', function (event) {
            var createToggle = event.target.closest('[data-global-create-toggle]');
            if (createToggle) {
                event.preventDefault();
                event.stopPropagation();
                closeLangMenu(root);
                var menu = root.querySelector('[data-global-create-menu]');
                var isOpen = menu && !menu.classList.contains('is-open');
                if (menu) menu.classList.toggle('is-open', !!isOpen);
                createToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                return;
            }

            var langToggle = event.target.closest('[data-global-lang-toggle]');
            if (langToggle) {
                event.preventDefault();
                event.stopPropagation();
                closeCreateMenu(root);
                var langMenu = root.querySelector('[data-global-lang-menu]');
                var langOpen = langMenu && !langMenu.classList.contains('is-open');
                if (langMenu) langMenu.classList.toggle('is-open', !!langOpen);
                langToggle.setAttribute('aria-expanded', langOpen ? 'true' : 'false');
                return;
            }

            var langBtn = event.target.closest('[data-lang-btn]');
            if (langBtn) {
                event.preventDefault();
                var lang = langBtn.getAttribute('data-lang-btn');
                closeLangMenu(root);
                if (window.i18n && typeof window.i18n.setLang === 'function') {
                    window.i18n.setLang(lang);
                }
                return;
            }

            var reference = event.target.closest('[data-global-reference]');
            if (reference) {
                event.preventDefault();
                closeCreateMenu(root);
                closeLangMenu(root);
                navigate('/reference');
                return;
            }

            var profile = event.target.closest('[data-profile-menu-anchor]');
            if (profile) {
                if (typeof window.openProfileMenu === 'function') {
                    window.openProfileMenu(event);
                }
                return;
            }

            var nav = event.target.closest('[data-global-nav]');
            if (nav) {
                event.preventDefault();
                closeCreateMenu(root);
                closeLangMenu(root);
                navigate(nav.getAttribute('data-global-nav') || nav.getAttribute('href'));
            }
        });

        document.addEventListener('click', function (event) {
            if (!root.contains(event.target)) {
                closeCreateMenu(root);
                closeLangMenu(root);
            }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                closeCreateMenu(root);
                closeLangMenu(root);
            }
        });
    }

    function initGlobalHeaders() {
        document.querySelectorAll('[data-global-header]').forEach(function (root) {
            renderHeader(root);
            if (root.dataset.globalHeaderBound !== '1') {
                root.dataset.globalHeaderBound = '1';
                bindHeader(root);
            }
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

    function reRenderAllHeaders() {
        initGlobalHeaders();
    }

    window.GlobalHeader = {
        init: initGlobalHeaders,
        reRender: reRenderAllHeaders,
    };

    window.addEventListener('i18n:changed', function () {
        reRenderAllHeaders();
    });

    initGlobalHeaders();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGlobalHeaders, { once: true });
    }
})();
