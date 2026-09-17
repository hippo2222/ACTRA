(function () {
    'use strict';

    function t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const val = window.i18n.t(key);
            if (val !== key) {
                return val;
            }
            const prefixed = window.i18n.t('profile_modal.' + key);
            if (prefixed !== 'profile_modal.' + key) {
                return prefixed;
            }
        }
        return fallback || key;
    }

    function getPeriods() {
        return [
            {
                days: 14,
                label: t('premium_promo_period_14d', '14 days'),
                price: '$4.99',
                note: t('premium_promo_period_14d_note', '$0.36/day'),
            },
            {
                days: 30,
                label: t('premium_promo_period_30d', '30 days'),
                price: '$7.99',
                note: t('premium_promo_period_30d_note', '$0.27/day · 25% cheaper'),
                featured: true,
            },
            {
                days: 90,
                label: t('premium_promo_period_90d', '90 days'),
                price: '$19.99',
                note: t('premium_promo_period_90d_note', '$0.22/day · 38% cheaper'),
            },
        ];
    }

    function getFeatures() {
        return [
            {
                icon: 'inventory_2',
                title: t('premium_promo_feature_limits_title', 'No limits'),
                text: t('premium_promo_feature_limits_text', 'More personal tasks, complexes and microcard decks.'),
            },
            {
                icon: 'calendar_month',
                title: t('premium_promo_feature_calendar_title', 'Full Calendar'),
                text: t('premium_promo_feature_calendar_text', 'Daily Mix, schedule, streak and memory health.'),
            },
            {
                icon: 'bar_chart',
                title: t('premium_promo_feature_stats_title', 'Full Statistics'),
                text: t('premium_promo_feature_stats_text', 'Metrics, charts, task types and complexes.'),
            },
        ];
    }

    let activeModal = null;
    let activeTrigger = null;
    let stylesInstalled = false;
    let isClosing = false;
    let isCheckoutPending = false;
    let previousBodyOverflow = null;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    function getOffer(days) {
        const normalized = Number(days || 0);
        return getPeriods().find((item) => item.days === normalized) || null;
    }

    function formatPeriod(days) {
        const offer = getOffer(days);
        return offer ? offer.label : `${Number(days || 0)} days`;
    }

    function formatPeriodWithPrice(days) {
        const offer = getOffer(days);
        return offer ? `${offer.label} · ${offer.price}` : formatPeriod(days);
    }

    function ensureStyles() {
        if (stylesInstalled) return;
        stylesInstalled = true;
        const style = document.createElement('style');
        style.id = 'premium-promo-modal-styles';
        style.textContent = `
            [data-premium-promo-trigger] {
                cursor: pointer;
            }
            .premium-promo-modal {
                position: fixed;
                inset: 0;
                z-index: 100030;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
                background: color-mix(in srgb, var(--color-scrim, rgba(15, 23, 42, 0.62)) 84%, transparent);
                backdrop-filter: blur(10px);
                opacity: 0;
                transition: opacity 180ms ease;
            }
            .premium-promo-modal.is-open {
                opacity: 1;
            }
            .premium-promo-modal__panel {
                width: min(100%, 45rem);
                max-height: calc(100vh - 2rem);
                overflow-y: auto;
                overflow-x: hidden;
                border: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.28));
                border-radius: 1.25rem;
                background: var(--color-surface-1, #fff);
                box-shadow: 0 28px 80px rgba(15, 23, 42, 0.32);
                transform: translateY(12px) scale(0.98);
                transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease;
                will-change: transform, opacity;
            }
            .premium-promo-modal.is-open .premium-promo-modal__panel {
                transform: translateY(0) scale(1);
            }
            .premium-promo-modal__header {
                display: grid;
                gap: 0.65rem;
                padding: 1.1rem 1.25rem 0.85rem;
                border-bottom: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.22));
            }
            .premium-promo-modal__topline {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 1rem;
            }
            .premium-promo-modal__kicker {
                display: inline-flex;
                align-items: center;
                gap: 0.45rem;
                width: fit-content;
                border: 1px solid var(--color-primary-light, rgba(59, 130, 246, 0.35));
                border-radius: 999px;
                background: var(--color-primary-lighter, rgba(59, 130, 246, 0.09));
                color: var(--color-primary, #2563eb);
                padding: 0.3rem 0.55rem;
                font-size: 0.7rem;
                font-weight: 850;
                line-height: 1;
            }
            .premium-promo-modal__close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 2rem;
                height: 2rem;
                border: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.28));
                border-radius: 0.75rem;
                background: var(--color-surface-1, #fff);
                color: var(--color-text-secondary, #64748b);
                cursor: pointer;
                transition: background-color 140ms ease, color 140ms ease, transform 120ms ease;
            }
            .premium-promo-modal__close:hover {
                background: var(--color-bg-hover, rgba(148, 163, 184, 0.12));
                color: var(--color-text-main, #0f172a);
            }
            .premium-promo-modal__close:active {
                transform: scale(0.92);
            }
            .premium-promo-modal__close:focus-visible,
            .premium-promo-modal__settings:focus-visible,
            .premium-promo-modal__offer:focus-visible {
                outline: 2px solid var(--color-primary, #2563eb);
                outline-offset: 2px;
            }
            .premium-promo-modal__title {
                margin: 0;
                color: var(--color-text-main, #0f172a);
                font-size: clamp(1.28rem, 2.5vw, 1.72rem);
                font-weight: 900;
                letter-spacing: -0.01em;
                line-height: 1.15;
            }
            .premium-promo-modal__lead {
                margin: 0.25rem 0 0;
                max-width: 38rem;
                color: var(--color-text-secondary, #64748b);
                font-size: 0.9rem;
                line-height: 1.42;
            }
            .premium-promo-modal__body {
                display: grid;
                gap: 0.85rem;
                padding: 1rem 1.25rem 1.1rem;
            }
            .premium-promo-modal__features {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 0.65rem;
            }
            .premium-promo-modal__feature,
            .premium-promo-modal__offer {
                border: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.28));
                border-radius: 0.9rem;
                background: var(--color-surface-2, rgba(248, 250, 252, 0.8));
            }
            .premium-promo-modal__feature {
                padding: 0.75rem;
            }
            .premium-promo-modal__feature-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 1.75rem;
                height: 1.75rem;
                border-radius: 0.6rem;
                background: var(--color-primary-lighter, rgba(59, 130, 246, 0.09));
                color: var(--color-primary, #2563eb);
                margin-bottom: 0.45rem;
                font-size: 1.05rem;
            }
            .premium-promo-modal__feature-title {
                margin: 0;
                color: var(--color-text-main, #0f172a);
                font-size: 0.8rem;
                font-weight: 850;
            }
            .premium-promo-modal__feature-text {
                margin: 0.25rem 0 0;
                color: var(--color-text-secondary, #64748b);
                font-size: 0.72rem;
                line-height: 1.32;
            }
            .premium-promo-modal__offers {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 0.65rem;
            }
            .premium-promo-modal__offer {
                position: relative;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                gap: 0.5rem;
                padding: 0.75rem 0.85rem;
                text-align: left;
                cursor: pointer;
                font: inherit;
                transition: transform 140ms cubic-bezier(0.2, 0, 0, 1),
                            border-color 140ms ease,
                            background-color 140ms ease,
                            box-shadow 140ms ease;
            }
            .premium-promo-modal__offer:hover {
                border-color: var(--color-primary-light, rgba(59, 130, 246, 0.5));
                background: color-mix(in srgb, var(--color-surface-2, rgba(248, 250, 252, 0.8)) 90%, var(--color-primary-light, rgba(59, 130, 246, 0.35)));
                box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
            }
            .premium-promo-modal__offer:active {
                transform: scale(0.98);
            }
            .premium-promo-modal__offer--featured {
                border-color: var(--color-primary-light, rgba(59, 130, 246, 0.45));
                background: var(--color-primary-lighter, rgba(59, 130, 246, 0.08));
            }
            .premium-promo-modal__offer--featured:hover {
                border-color: var(--color-primary, #2563eb);
                background: color-mix(in srgb, var(--color-primary-lighter, rgba(59, 130, 246, 0.08)) 85%, var(--color-primary-light, rgba(59, 130, 246, 0.4)));
                box-shadow: 0 6px 18px rgba(37, 99, 235, 0.12);
            }
            .premium-promo-modal__offer-badge {
                width: fit-content;
                border-radius: 999px;
                background: var(--color-primary, #2563eb);
                color: var(--color-primary-fg, #fff);
                padding: 0.22rem 0.45rem;
                font-size: 0.62rem;
                font-weight: 850;
                line-height: 1;
            }
            .premium-promo-modal__offer-title-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.4rem;
            }
            .premium-promo-modal__offer-title,
            .premium-promo-modal__offer-price {
                margin: 0;
                color: var(--color-text-main, #0f172a);
            }
            .premium-promo-modal__offer-title {
                font-size: 0.82rem;
                font-weight: 850;
            }
            .premium-promo-modal__offer-price {
                font-size: 1.16rem;
                font-weight: 950;
                line-height: 1;
            }
            .premium-promo-modal__offer-note {
                margin: 0;
                color: var(--color-text-secondary, #64748b);
                font-size: 0.7rem;
                line-height: 1.25;
            }
            .premium-promo-modal.is-loading .premium-promo-modal__offer {
                opacity: 0.6;
                pointer-events: none;
                cursor: not-allowed;
            }
            .premium-promo-modal__footer {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                gap: 0.6rem;
                border-top: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.22));
                padding-top: 0.85rem;
            }
            .premium-promo-modal__status {
                min-height: 1.1rem;
                color: var(--color-text-secondary, #64748b);
                font-size: 0.74rem;
                font-weight: 650;
                display: flex;
                align-items: center;
                gap: 0.4rem;
            }
            .premium-promo-modal__status--success {
                color: var(--color-success, #15803d);
            }
            .premium-promo-modal__status--error {
                color: var(--color-error, #dc2626);
            }
            .premium-promo-modal__settings {
                border: 1px solid var(--color-border-strong, rgba(100, 116, 139, 0.35));
                border-radius: 0.75rem;
                background: transparent;
                color: var(--color-text-main, #0f172a);
                cursor: pointer;
                padding: 0.55rem 0.85rem;
                font-size: 0.76rem;
                font-weight: 800;
                transition: background-color 140ms ease, transform 120ms ease;
            }
            .premium-promo-modal__settings:hover {
                background: var(--color-bg-hover, rgba(148, 163, 184, 0.12));
            }
            .premium-promo-modal__settings:active {
                transform: scale(0.96);
            }
            .premium-promo-modal__success-hero {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 0.75rem;
                padding: 0.65rem 0 0.35rem;
                text-align: center;
            }
            .premium-promo-modal__success-icon-wrap {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 4.5rem;
                height: 4.5rem;
                border-radius: 50%;
                background: color-mix(in srgb, var(--color-success, #16a34a) 14%, var(--color-surface-1, #fff));
                border: 2px solid color-mix(in srgb, var(--color-success, #16a34a) 32%, transparent);
                box-shadow: 0 0 28px color-mix(in srgb, var(--color-success, #16a34a) 25%, transparent);
                animation: premiumSuccessPop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
            }
            .premium-promo-modal__success-icon {
                font-size: 2.5rem;
                color: var(--color-success, #16a34a);
            }
            @keyframes premiumSuccessPop {
                0% {
                    transform: scale(0.5);
                    opacity: 0;
                }
                70% {
                    transform: scale(1.1);
                    opacity: 1;
                }
                100% {
                    transform: scale(1);
                    opacity: 1;
                }
            }
            .premium-promo-modal__success-perks {
                display: grid;
                gap: 0.55rem;
                padding: 0.25rem 0;
            }
            .premium-promo-modal__success-perk {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                padding: 0.75rem 0.95rem;
                border: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.24));
                border-radius: 0.85rem;
                background: var(--color-surface-2, rgba(248, 250, 252, 0.8));
                color: var(--color-text-main, #0f172a);
                font-size: 0.84rem;
                font-weight: 650;
                line-height: 1.35;
            }
            .premium-promo-modal__perk-check {
                color: var(--color-success, #16a34a);
                font-size: 1.3rem;
                flex-shrink: 0;
            }
            .premium-promo-modal__success-actions {
                display: flex;
                justify-content: stretch;
                padding-top: 0.5rem;
            }
            .premium-promo-modal__success-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.55rem;
                width: 100%;
                min-height: 48px;
                border: none;
                border-radius: 0.85rem;
                background: var(--color-primary, #2563eb);
                color: var(--color-primary-fg, #fff);
                font-size: 0.94rem;
                font-weight: 850;
                cursor: pointer;
                box-shadow: 0 4px 16px color-mix(in srgb, var(--color-primary, #2563eb) 35%, transparent);
                transition: background-color 140ms ease, transform 120ms ease, box-shadow 140ms ease;
            }
            .premium-promo-modal__success-btn:hover {
                background: color-mix(in srgb, var(--color-primary, #2563eb) 88%, #000);
                transform: translateY(-1px);
                box-shadow: 0 6px 20px color-mix(in srgb, var(--color-primary, #2563eb) 45%, transparent);
            }
            .premium-promo-modal__success-btn:active {
                transform: scale(0.98);
            }
            .premium-promo-modal__success-btn:focus-visible {
                outline: 2px solid var(--color-primary, #2563eb);
                outline-offset: 2px;
            }
            .premium-promo-toast {
                position: fixed;
                bottom: 1.5rem;
                left: 50%;
                transform: translateX(-50%) translateY(12px);
                z-index: 100050;
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.75rem 1.25rem;
                border-radius: 999px;
                background: #0f172a;
                color: #fff;
                font-size: 0.85rem;
                font-weight: 700;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
                opacity: 0;
                transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease;
                pointer-events: none;
            }
            .premium-promo-toast.is-visible {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }
            .premium-promo-toast--success {
                background: var(--color-success, #15803d);
                color: #fff;
            }
            @media (max-width: 640px) {
                .premium-promo-modal {
                    align-items: flex-end;
                    padding: 0;
                }
                .premium-promo-modal__panel {
                    width: 100%;
                    max-height: 90vh;
                    border-radius: 1.25rem 1.25rem 0 0;
                    border-bottom: none;
                    transform: translateY(100%);
                    transition: transform 240ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 180ms ease;
                }
                .premium-promo-modal.is-open .premium-promo-modal__panel {
                    transform: translateY(0);
                }
                .premium-promo-modal__header {
                    gap: 0.5rem;
                    padding: 0.85rem 1rem 0.65rem;
                }
                .premium-promo-modal__body {
                    gap: 0.75rem;
                    padding: 0.75rem 1rem 1rem;
                }
                .premium-promo-modal__title {
                    font-size: 1.22rem;
                    line-height: 1.15;
                }
                .premium-promo-modal__lead {
                    font-size: 0.8rem;
                    line-height: 1.35;
                }
                .premium-promo-modal__features {
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 0.45rem;
                }
                .premium-promo-modal__feature {
                    padding: 0.55rem 0.45rem;
                }
                .premium-promo-modal__feature-icon {
                    width: 1.45rem;
                    height: 1.45rem;
                    font-size: 0.95rem;
                    margin-bottom: 0.25rem;
                }
                .premium-promo-modal__feature-title {
                    font-size: 0.72rem;
                    line-height: 1.15;
                }
                .premium-promo-modal__feature-text {
                    font-size: 0.65rem;
                    line-height: 1.22;
                }
                .premium-promo-modal__offers {
                    grid-template-columns: 1fr;
                    gap: 0.5rem;
                }
                .premium-promo-modal__offer {
                    flex-direction: row;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.75rem 0.9rem;
                    min-height: 52px;
                }
                .premium-promo-modal__offer-text {
                    display: grid;
                    gap: 0.2rem;
                }
                .premium-promo-modal__offer-title-row {
                    justify-content: flex-start;
                    gap: 0.45rem;
                }
                .premium-promo-modal__offer-title {
                    font-size: 0.85rem;
                }
                .premium-promo-modal__offer-price {
                    font-size: 1.12rem;
                    flex-shrink: 0;
                }
                .premium-promo-modal__offer-note {
                    display: block;
                    font-size: 0.68rem;
                }
                .premium-promo-modal__footer {
                    padding-top: 0.65rem;
                }
                .premium-promo-modal__status,
                .premium-promo-modal__settings {
                    font-size: 0.72rem;
                }
                .premium-promo-modal__success-icon-wrap {
                    width: 3.8rem;
                    height: 3.8rem;
                }
                .premium-promo-modal__success-icon {
                    font-size: 2rem;
                }
                .premium-promo-modal__success-perk {
                    font-size: 0.78rem;
                    padding: 0.65rem 0.8rem;
                }
            }
            @media (prefers-reduced-motion: reduce) {
                .premium-promo-modal,
                .premium-promo-modal__panel,
                .premium-promo-modal__offer,
                .premium-promo-modal__close,
                .premium-promo-modal__settings {
                    transition: none !important;
                }
                .premium-promo-modal__panel {
                    transform: none !important;
                }
                .premium-promo-modal__success-icon-wrap {
                    animation: none !important;
                }
                .premium-promo-modal__success-btn {
                    transition: none !important;
                    transform: none !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function close() {
        if (!activeModal || isClosing) return;
        isClosing = true;
        const modal = activeModal;
        activeModal = null;

        document.removeEventListener('keydown', handleKeydown);

        if (previousBodyOverflow !== null) {
            document.body.style.overflow = previousBodyOverflow;
            previousBodyOverflow = null;
        }

        const restoreTriggerFocus = () => {
            if (activeTrigger && typeof activeTrigger.focus === 'function') {
                activeTrigger.focus({ preventScroll: true });
            }
            activeTrigger = null;
        };

        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            modal.remove();
            isClosing = false;
            restoreTriggerFocus();
            return;
        }

        modal.classList.remove('is-open');

        let cleanedUp = false;
        const finish = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            modal.remove();
            isClosing = false;
            restoreTriggerFocus();
        };

        const panel = modal.querySelector('[data-premium-promo-panel]');
        if (panel) {
            panel.addEventListener('transitionend', (event) => {
                if (event.target === panel) finish();
            }, { once: true });
        }
        setTimeout(finish, 240);
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if (event.key === 'Tab') {
            if (!activeModal) return;
            const focusables = Array.from(
                activeModal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
            ).filter((el) => el.offsetParent !== null && window.getComputedStyle(el).visibility !== 'hidden');

            if (focusables.length === 0) {
                event.preventDefault();
                return;
            }

            const first = focusables[0];
            const last = focusables[focusables.length - 1];

            if (event.shiftKey) {
                if (document.activeElement === first || !activeModal.contains(document.activeElement)) {
                    event.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last || !activeModal.contains(document.activeElement)) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }
    }

    function acknowledgePaymentPending() {
        if (activeModal) {
            setStatus(activeModal, t('premium_promo_payment_pending', 'We are processing your payment. Once checkout is ready, the payment buttons will appear here.'), 'neutral');
        }
    }

    function navigateToSettings() {
        close();
        const url = '/settings#premium';
        if (typeof window.__mainPremiumNavigationBase === 'function') {
            window.__mainPremiumNavigationBase(url);
            return;
        }
        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition(url);
            return;
        }
        window.location.assign(url);
    }

    function setStatus(modal, message, tone = 'neutral') {
        const status = modal?.querySelector('[data-premium-promo-status]');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('premium-promo-modal__status--success', tone === 'success');
        status.classList.toggle('premium-promo-modal__status--error', tone === 'error');
    }

    function renderFeatures() {
        return getFeatures().map((feature) => `
            <section class="premium-promo-modal__feature">
                <span class="premium-promo-modal__feature-icon material-symbols-outlined" aria-hidden="true">${escapeHtml(feature.icon)}</span>
                <h3 class="premium-promo-modal__feature-title">${escapeHtml(feature.title)}</h3>
                <p class="premium-promo-modal__feature-text">${escapeHtml(feature.text)}</p>
            </section>
        `).join('');
    }

    let _paddleConfigCache = null;

    async function fetchPaddleConfig() {
        if (_paddleConfigCache) return _paddleConfigCache;
        try {
            const res = await fetch('/api/billing/paddle/config', { credentials: 'same-origin' });
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.ok) {
                _paddleConfigCache = data;
                return data;
            }
        } catch (e) {
            console.warn('[Paddle] Failed to fetch config:', e);
        }
        return null;
    }

    function loadPaddleScript(environment = 'production') {
        return new Promise((resolve, reject) => {
            if (window.Paddle) return resolve(window.Paddle);
            const existing = document.getElementById('paddle-v2-script');
            if (existing) {
                existing.addEventListener('load', () => resolve(window.Paddle));
                existing.addEventListener('error', reject);
                return;
            }
            const script = document.createElement('script');
            script.id = 'paddle-v2-script';
            script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
            script.onload = () => {
                if (window.Paddle) resolve(window.Paddle);
                else reject(new Error('Paddle SDK missing after script load'));
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function showToast(message, type = 'success', duration = 3500) {
        if (window.NotificationUI && typeof window.NotificationUI.toast === 'function') {
            window.NotificationUI.toast(message, type, duration);
            return;
        }
        const toast = document.createElement('div');
        toast.className = `premium-promo-toast premium-promo-toast--${type}`;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('is-visible');
        });
        setTimeout(() => {
            toast.classList.remove('is-visible');
            setTimeout(() => toast.remove(), 250);
        }, Math.max(1500, duration));
    }

    let _verificationTimer = null;
    async function verifyPremiumActivation(maxAttempts = 5) {
        if (_verificationTimer) clearTimeout(_verificationTimer);
        const delays = [800, 1600, 2800, 4200, 6000];

        for (let i = 0; i < maxAttempts; i++) {
            await new Promise((resolve) => {
                _verificationTimer = setTimeout(resolve, delays[i] || 3000);
            });
            try {
                const res = await fetch('/api/billing/status', { credentials: 'same-origin' });
                if (res.ok) {
                    const data = await res.json();
                    const plan = data?.effective_plan || data?.user?.effective_plan || data?.plan || data?.user?.plan;
                    if (plan === 'premium' || data?.is_premium) {
                        window.dispatchEvent(new CustomEvent('actra:premium_activated', { detail: data }));
                        if (window.GlobalHeader && typeof window.GlobalHeader.reRender === 'function') {
                            window.GlobalHeader.reRender();
                        }
                        return true;
                    }
                }
            } catch (err) {
                console.warn('[Premium] Status check error:', err);
            }
        }
        return false;
    }

    function renderSuccessView(modalNode) {
        const modal = modalNode || activeModal;
        if (!modal) return;

        const titleEl = modal.querySelector('#premium-promo-title');
        const leadEl = modal.querySelector('#premium-promo-lead');
        const bodyEl = modal.querySelector('.premium-promo-modal__body');
        const kickerEl = modal.querySelector('.premium-promo-modal__kicker');

        if (titleEl) {
            titleEl.textContent = t('premium_promo_success_title', 'Поздравляем! ACTRA Premium активирован');
        }
        if (leadEl) {
            leadEl.textContent = t('premium_promo_success_lead', 'Оплата успешно принята. Все лимиты сняты, Календарь и полная Статистика теперь доступны без ограничений.');
        }
        if (kickerEl) {
            kickerEl.innerHTML = `
                <span class="material-symbols-outlined" aria-hidden="true" style="color: var(--color-success, #16a34a);">verified</span>
                <span style="color: var(--color-success, #16a34a); font-weight: 850;">${escapeHtml(t('premium_promo_success_badge', 'Premium активен'))}</span>
            `;
            kickerEl.style.borderColor = 'color-mix(in srgb, var(--color-success, #16a34a) 35%, transparent)';
            kickerEl.style.backgroundColor = 'color-mix(in srgb, var(--color-success, #16a34a) 10%, transparent)';
        }

        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="premium-promo-modal__success-hero">
                    <div class="premium-promo-modal__success-icon-wrap" aria-hidden="true">
                        <span class="material-symbols-outlined premium-promo-modal__success-icon">verified</span>
                    </div>
                </div>
                <div class="premium-promo-modal__success-perks" role="list">
                    <div class="premium-promo-modal__success-perk" role="listitem">
                        <span class="material-symbols-outlined premium-promo-modal__perk-check" aria-hidden="true">check_circle</span>
                        <span>${escapeHtml(t('premium_promo_success_perk_limits', 'Неограниченное создание личных заданий и колод'))}</span>
                    </div>
                    <div class="premium-promo-modal__success-perk" role="listitem">
                        <span class="material-symbols-outlined premium-promo-modal__perk-check" aria-hidden="true">check_circle</span>
                        <span>${escapeHtml(t('premium_promo_success_perk_calendar', 'Полный доступ к Календарю и Daily Mix'))}</span>
                    </div>
                    <div class="premium-promo-modal__success-perk" role="listitem">
                        <span class="material-symbols-outlined premium-promo-modal__perk-check" aria-hidden="true">check_circle</span>
                        <span>${escapeHtml(t('premium_promo_success_perk_stats', 'Детальная статистика и аналитика прогресса'))}</span>
                    </div>
                </div>
                <div class="premium-promo-modal__success-actions">
                    <button class="premium-promo-modal__success-btn" type="button" data-premium-promo-settings>
                        <span class="material-symbols-outlined" aria-hidden="true">rocket_launch</span>
                        <span>${escapeHtml(t('premium_promo_success_btn', 'Начать пользоваться'))}</span>
                    </button>
                </div>
            `;
        }

        const successBtn = modal.querySelector('.premium-promo-modal__success-btn');
        if (successBtn && typeof successBtn.focus === 'function') {
            successBtn.focus({ preventScroll: true });
        }
    }

    function showSuccess() {
        let modal = activeModal;
        if (!modal || !modal.isConnected) {
            modal = open();
        }
        renderSuccessView(modal);
        return modal;
    }

    async function triggerPaddleCheckout(days, modalNode) {
        if (isCheckoutPending) return;
        isCheckoutPending = true;

        modalNode?.classList.add('is-loading');
        modalNode?.setAttribute('aria-busy', 'true');
        setStatus(modalNode, t('premium_promo_payment_pending', 'Preparing Paddle Checkout...'), 'neutral');

        try {
            // Check if user is logged in
            let userId = '';
            try {
                const statusRes = await fetch('/api/billing/status', { credentials: 'same-origin' });
                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData && statusData.user) {
                        const candidateId = statusData.user.user_id || statusData.user.id || '';
                        if (candidateId && candidateId !== 'guest') {
                            userId = candidateId;
                        }
                    }
                }
            } catch (err) {
                // Ignore
            }

            if (!userId) {
                setStatus(
                    modalNode,
                    t('premium_promo_auth_required', 'Для оформления подписки необходимо войти в аккаунт.'),
                    'error'
                );
                return;
            }

            const config = await fetchPaddleConfig();
            if (!config || !config.client_token) {
                setStatus(
                    modalNode,
                    t('premium_promo_payment_error', 'Платёжный шлюз временно недоступен или не настроен.'),
                    'error'
                );
                return;
            }

            await loadPaddleScript(config.environment);
            if (!window.Paddle) throw new Error('Paddle SDK not available');

            if (config.environment === 'sandbox') {
                window.Paddle.Environment.set('sandbox');
            }
            window.Paddle.Initialize({
                token: config.client_token,
                eventCallback: function(data) {
                    console.log('[Paddle Event]', data);
                    if (data && (data.name === 'checkout.completed' || data.name === 'checkout.payment.complete')) {
                        const targetModal = (activeModal && activeModal.isConnected) ? activeModal : modalNode;
                        if (targetModal && targetModal.isConnected) {
                            renderSuccessView(targetModal);
                        } else {
                            showSuccess();
                        }
                        showToast(t('premium_promo_toast_success', 'ACTRA Premium успешно активирован!'), 'success', 4000);
                        window.dispatchEvent(new CustomEvent('actra:paddle:checkout_completed', { detail: data }));
                        window.dispatchEvent(new CustomEvent('actra:premium_activated', { detail: data }));
                        if (window.GlobalHeader && typeof window.GlobalHeader.reRender === 'function') {
                            window.GlobalHeader.reRender();
                        }
                        void verifyPremiumActivation();
                    }
                    if (data && data.name === 'checkout.error') {
                        console.error('[Paddle Checkout Error Detail]', data);
                    }
                }
            });

            const priceId = config.prices ? config.prices[`${days}d`] : null;
            if (!priceId) {
                setStatus(modalNode, t('premium_promo_price_missing', 'Price configuration missing for selected period.'), 'error');
                return;
            }

            console.log('[Paddle] Launching checkout with priceId:', priceId, 'token:', config.client_token);

            setStatus(modalNode, t('premium_promo_status_wip', 'Безопасная оплата через Paddle.'), 'neutral');

            window.Paddle.Checkout.open({
                items: [{ priceId: priceId, quantity: 1 }],
                customData: userId ? { user_id: userId } : {},
                settings: {
                    displayMode: 'overlay',
                    theme: 'dark',
                    locale: window.i18n && window.i18n.locale === 'ru' ? 'ru' : 'en',
                },
            });
        } catch (err) {
            console.error('[Paddle Checkout] Error opening checkout:', err);
            setStatus(modalNode, t('premium_promo_checkout_failed', 'Could not launch Paddle checkout.'), 'error');
        } finally {
            isCheckoutPending = false;
            modalNode?.classList.remove('is-loading');
            modalNode?.removeAttribute('aria-busy');
        }
    }

    function renderOffers() {
        return getPeriods().map((offer) => `
            <button type="button" class="premium-promo-modal__offer${offer.featured ? ' premium-promo-modal__offer--featured' : ''}" data-premium-promo-buy="${offer.days}">
                <div class="premium-promo-modal__offer-text">
                    <div class="premium-promo-modal__offer-title-row">
                        <p class="premium-promo-modal__offer-title">${escapeHtml(offer.label)}</p>
                        ${offer.featured ? `<span class="premium-promo-modal__offer-badge">${escapeHtml(t('premium_promo_offer_badge', 'Best value'))}</span>` : ''}
                    </div>
                    <p class="premium-promo-modal__offer-note">${escapeHtml(offer.note)}</p>
                </div>
                <p class="premium-promo-modal__offer-price">${escapeHtml(offer.price)}</p>
            </button>
        `).join('');
    }

    function open(options = {}) {
        ensureStyles();
        if (activeModal) close();
        activeTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        if (previousBodyOverflow === null) {
            previousBodyOverflow = document.body.style.overflow || '';
            document.body.style.overflow = 'hidden';
        }

        const title = String(options.title || t('premium_promo_title', 'Unlock ACTRA Premium')).trim();
        const lead = String(options.lead || t('premium_promo_lead', 'Choose a Premium plan for unlimited access to study materials, Calendar, and Statistics.')).trim();
        const closeLabel = t('premium_promo_close_label', 'Close');
        const statusText = t('premium_promo_status_wip', 'Secure payment via Paddle.');
        const settingsBtn = t('premium_promo_settings_btn', 'Got it');

        const modal = document.createElement('div');
        modal.className = 'premium-promo-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'premium-promo-title');
        modal.setAttribute('aria-describedby', 'premium-promo-lead');
        modal.dataset.premiumPromoModal = 'true';
        modal.innerHTML = `
            <div class="premium-promo-modal__panel" data-premium-promo-panel>
                <div class="premium-promo-modal__header">
                    <div class="premium-promo-modal__topline">
                        <span class="premium-promo-modal__kicker">
                            <span class="material-symbols-outlined" aria-hidden="true">workspace_premium</span>
                            <span>Premium</span>
                        </span>
                        <button class="premium-promo-modal__close" type="button" data-premium-promo-close aria-label="${escapeHtml(closeLabel)}">
                            <span class="material-symbols-outlined" aria-hidden="true">close</span>
                        </button>
                    </div>
                    <div>
                        <h2 class="premium-promo-modal__title" id="premium-promo-title">${escapeHtml(title)}</h2>
                        <p class="premium-promo-modal__lead" id="premium-promo-lead">${escapeHtml(lead)}</p>
                    </div>
                </div>
                <div class="premium-promo-modal__body">
                    <div class="premium-promo-modal__features">${renderFeatures()}</div>
                    <div class="premium-promo-modal__offers">${renderOffers()}</div>
                    <div class="premium-promo-modal__footer">
                        <div class="premium-promo-modal__status" data-premium-promo-status>
                            ${escapeHtml(statusText)}
                        </div>
                        <button class="premium-promo-modal__settings" type="button" data-premium-promo-settings>
                            ${escapeHtml(settingsBtn)}
                        </button>
                    </div>
                </div>
            </div>
        `;

        let isMouseDownOnBackdrop = false;
        modal.addEventListener('mousedown', (event) => {
            isMouseDownOnBackdrop = (event.target === modal);
        });

        modal.addEventListener('click', (event) => {
            if ((event.target === modal && isMouseDownOnBackdrop) || event.target.closest('[data-premium-promo-close]')) {
                close();
                return;
            }
            const buyBtn = event.target.closest('[data-premium-promo-buy]');
            if (buyBtn) {
                const days = Number(buyBtn.dataset.premiumPromoBuy || 30);
                triggerPaddleCheckout(days, modal);
                return;
            }
            const settings = event.target.closest('[data-premium-promo-settings]');
            if (settings) {
                close();
                return;
            }
        });

        document.body.appendChild(modal);
        activeModal = modal;
        document.addEventListener('keydown', handleKeydown);
        requestAnimationFrame(() => {
            modal.classList.add('is-open');
        });
        requestAnimationFrame(() => {
            const featuredOffer = modal.querySelector('.premium-promo-modal__offer--featured');
            const firstOffer = modal.querySelector('[data-premium-promo-buy]');
            const settingsBtnNode = modal.querySelector('[data-premium-promo-settings]');
            const closeBtnNode = modal.querySelector('[data-premium-promo-close]');
            const targetButton = featuredOffer || firstOffer || settingsBtnNode || closeBtnNode;
            if (targetButton && typeof targetButton.focus === 'function') {
                targetButton.focus({ preventScroll: true });
            }
        });
        return modal;
    }

    function getTriggerOptions(trigger) {
        const feature = String(trigger?.dataset?.premiumPromoFeature || '').trim();
        if (feature === 'calendar') {
            return {
                title: t('premium_promo_trigger_calendar_title', 'Full Calendar available in Premium'),
                lead: t('premium_promo_trigger_calendar_lead', 'Full page: Daily Mix, new material, schedule, activity and memory health.'),
            };
        }
        if (feature === 'statistics') {
            return {
                title: t('premium_promo_trigger_statistics_title', 'Full Statistics available in Premium'),
                lead: t('premium_promo_trigger_statistics_lead', 'Full dashboard: tasks, time, microcards, streaks, charts, task types and complexes.'),
            };
        }
        if (feature === 'tasks-limit') {
            return {
                title: t('premium_promo_trigger_tasks_limit_title', 'Tasks limit goes away in Premium'),
                lead: t('premium_promo_trigger_tasks_limit_lead', 'More personal tasks without a cap on the counter.'),
            };
        }
        if (feature === 'complexes-limit') {
            return {
                title: t('premium_promo_trigger_complexes_limit_title', 'More complexes in Premium'),
                lead: t('premium_promo_trigger_complexes_limit_lead', 'More personal complexes and materials in the library.'),
            };
        }
        if (feature === 'microcards-limit') {
            return {
                title: t('premium_promo_trigger_microcards_limit_title', 'More microcard decks in Premium'),
                lead: t('premium_promo_trigger_microcards_limit_lead', 'Free plan: up to 4 personal decks and 8 total with the catalog. Premium removes the limit.'),
            };
        }
        return {};
    }

    function openFromTrigger(trigger) {
        open(getTriggerOptions(trigger));
    }

    function bindTriggers() {
        document.addEventListener('click', (event) => {
            const trigger = event.target?.closest?.('[data-premium-promo-trigger]');
            if (!trigger) return;
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
            openFromTrigger(trigger);
        }, true);

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const trigger = event.target?.closest?.('[data-premium-promo-trigger]');
            if (!trigger) return;
            event.preventDefault();
            openFromTrigger(trigger);
        }, true);
    }

    window.PremiumPromo = {
        getPeriods,
        getFeatures,
        open,
        close,
        getOffer,
        formatPeriod,
        formatPeriodWithPrice,
        navigateToSettings,
        triggerPaddleCheckout,
        renderSuccessView,
        showSuccess,
    };

    bindTriggers();
})();
