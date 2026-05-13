(function () {
    'use strict';

    const PERIODS = Object.freeze([
        {
            days: 14,
            label: '\u041d\u0430 14 \u0434\u043d\u0435\u0439',
            price: '$4.99',
            note: '$0.36/\u0434\u0435\u043d\u044c',
        },
        {
            days: 30,
            label: '\u041d\u0430 30 \u0434\u043d\u0435\u0439',
            price: '$7.99',
            note: '$0.27/\u0434\u0435\u043d\u044c \u00b7 \u0432\u044b\u0433\u043e\u0434\u043d\u0435\u0435 \u043d\u0430 25%',
            featured: true,
        },
        {
            days: 90,
            label: '\u041d\u0430 90 \u0434\u043d\u0435\u0439',
            price: '$19.99',
            note: '$0.22/\u0434\u0435\u043d\u044c \u00b7 \u0432\u044b\u0433\u043e\u0434\u043d\u0435\u0435 \u043d\u0430 38%',
        },
    ]);

    const FEATURES = Object.freeze([
        {
            icon: 'inventory_2',
            title: '\u0411\u0435\u0437 \u043b\u0438\u043c\u0438\u0442\u043e\u0432',
            text: '\u0411\u043e\u043b\u044c\u0448\u0435 \u043b\u0438\u0447\u043d\u044b\u0445 \u0437\u0430\u0434\u0430\u043d\u0438\u0439 \u0438 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u043e\u0432.',
        },
        {
            icon: 'calendar_month',
            title: '\u041f\u043e\u043b\u043d\u044b\u0439 \u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c',
            text: 'Daily Mix, \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435, streak \u0438 \u0437\u0434\u043e\u0440\u043e\u0432\u044c\u0435 \u043f\u0430\u043c\u044f\u0442\u0438.',
        },
        {
            icon: 'bar_chart',
            title: '\u041f\u043e\u043b\u043d\u0430\u044f \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430',
            text: '\u041c\u0435\u0442\u0440\u0438\u043a\u0438, \u0433\u0440\u0430\u0444\u0438\u043a, \u0442\u0438\u043f\u044b \u0437\u0430\u0434\u0430\u043d\u0438\u0439 \u0438 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u044b.',
        },
    ]);

    let activeModal = null;
    let activeTrigger = null;
    let stylesInstalled = false;

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
        return PERIODS.find((item) => item.days === normalized) || null;
    }

    function formatPeriod(days) {
        const offer = getOffer(days);
        return offer ? offer.label : `${Number(days || 0)} \u0434\u043d\u0435\u0439`;
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
                overflow: hidden;
                border: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.28));
                border-radius: 1.25rem;
                background: var(--color-surface-1, #fff);
                box-shadow: 0 28px 80px rgba(15, 23, 42, 0.32);
                transform: translateY(10px) scale(0.98);
                transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
            }
            .premium-promo-modal.is-open .premium-promo-modal__panel {
                transform: translateY(0) scale(1);
            }
            .premium-promo-modal__header {
                display: grid;
                gap: 0.65rem;
                padding: 1rem 1.1rem 0.8rem;
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
            }
            .premium-promo-modal__close:hover {
                background: var(--color-bg-hover, rgba(148, 163, 184, 0.12));
                color: var(--color-text-main, #0f172a);
            }
            .premium-promo-modal__title {
                margin: 0;
                color: var(--color-text-main, #0f172a);
                font-size: clamp(1.28rem, 2.5vw, 1.72rem);
                font-weight: 900;
                letter-spacing: 0;
                line-height: 1.12;
            }
            .premium-promo-modal__lead {
                margin: 0;
                max-width: 38rem;
                color: var(--color-text-secondary, #64748b);
                font-size: 0.9rem;
                line-height: 1.42;
            }
            .premium-promo-modal__body {
                display: grid;
                gap: 0.8rem;
                padding: 0.9rem 1.1rem 1rem;
            }
            .premium-promo-modal__features {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 0.6rem;
            }
            .premium-promo-modal__feature,
            .premium-promo-modal__offer {
                border: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.28));
                border-radius: 0.9rem;
                background: var(--color-surface-2, rgba(248, 250, 252, 0.8));
            }
            .premium-promo-modal__feature {
                padding: 0.72rem;
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
                gap: 0.6rem;
            }
            .premium-promo-modal__offer {
                position: relative;
                display: grid;
                gap: 0.45rem;
                padding: 0.72rem;
                text-align: left;
            }
            .premium-promo-modal__offer--featured {
                border-color: var(--color-primary-light, rgba(59, 130, 246, 0.4));
                background: var(--color-primary-lighter, rgba(59, 130, 246, 0.08));
            }
            .premium-promo-modal__offer-badge {
                width: fit-content;
                border-radius: 999px;
                background: var(--color-primary, #2563eb);
                color: var(--color-primary-fg, #fff);
                padding: 0.22rem 0.42rem;
                font-size: 0.62rem;
                font-weight: 850;
                line-height: 1;
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
            .premium-promo-modal__footer {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                gap: 0.6rem;
                border-top: 1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.22));
                padding-top: 0.75rem;
            }
            .premium-promo-modal__status {
                min-height: 1.1rem;
                color: var(--color-text-secondary, #64748b);
                font-size: 0.74rem;
                font-weight: 650;
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
                padding: 0.55rem 0.75rem;
                font-size: 0.76rem;
                font-weight: 800;
            }
            .premium-promo-modal__settings:hover {
                background: var(--color-bg-hover, rgba(148, 163, 184, 0.12));
            }
            @media (max-width: 760px) {
                .premium-promo-modal {
                    align-items: flex-end;
                    padding: 0.5rem;
                }
                .premium-promo-modal__panel {
                    max-height: calc(100vh - 1rem);
                    border-radius: 0.9rem;
                }
                .premium-promo-modal__header {
                    gap: 0.5rem;
                    padding: 0.75rem 0.8rem 0.6rem;
                }
                .premium-promo-modal__body {
                    gap: 0.6rem;
                    padding: 0.7rem 0.8rem 0.8rem;
                }
                .premium-promo-modal__topline {
                    gap: 0.65rem;
                }
                .premium-promo-modal__kicker {
                    padding: 0.24rem 0.45rem;
                    font-size: 0.64rem;
                }
                .premium-promo-modal__close {
                    width: 1.8rem;
                    height: 1.8rem;
                    border-radius: 0.65rem;
                }
                .premium-promo-modal__title {
                    font-size: 1.18rem;
                    line-height: 1.15;
                }
                .premium-promo-modal__lead {
                    font-size: 0.78rem;
                    line-height: 1.32;
                }
                .premium-promo-modal__features,
                .premium-promo-modal__offers {
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 0.42rem;
                }
                .premium-promo-modal__feature,
                .premium-promo-modal__offer {
                    border-radius: 0.7rem;
                    padding: 0.48rem;
                }
                .premium-promo-modal__feature-icon {
                    width: 1.45rem;
                    height: 1.45rem;
                    margin-bottom: 0.32rem;
                    border-radius: 0.5rem;
                    font-size: 0.9rem;
                }
                .premium-promo-modal__feature-title,
                .premium-promo-modal__offer-title {
                    font-size: 0.68rem;
                    line-height: 1.15;
                }
                .premium-promo-modal__feature-text {
                    font-size: 0.62rem;
                    line-height: 1.22;
                }
                .premium-promo-modal__offer {
                    gap: 0.32rem;
                }
                .premium-promo-modal__offer-badge {
                    padding: 0.16rem 0.3rem;
                    font-size: 0.55rem;
                }
                .premium-promo-modal__offer-price {
                    font-size: 0.92rem;
                }
                .premium-promo-modal__offer-note {
                    display: none;
                }
                .premium-promo-modal__footer {
                    gap: 0.45rem;
                    padding-top: 0.55rem;
                }
                .premium-promo-modal__status,
                .premium-promo-modal__settings {
                    font-size: 0.66rem;
                }
                .premium-promo-modal__settings {
                    padding: 0.45rem 0.55rem;
                }
            }
            @media (prefers-reduced-motion: reduce) {
                .premium-promo-modal,
                .premium-promo-modal__panel {
                    transition: none;
                }
                .premium-promo-modal__panel {
                    transform: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function close() {
        if (!activeModal) return;
        const modal = activeModal;
        activeModal = null;
        document.removeEventListener('keydown', handleEscape);
        modal.remove();
        if (activeTrigger && typeof activeTrigger.focus === 'function') {
            activeTrigger.focus({ preventScroll: true });
        }
        activeTrigger = null;
    }

    function handleEscape(event) {
        if (event.key === 'Escape') {
            close();
        }
    }

    function acknowledgePaymentPending() {
        if (activeModal) {
            setStatus(activeModal, '\u041c\u044b \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0430\u0435\u043c \u043e\u043f\u043b\u0430\u0442\u0443. \u041a\u0430\u043a \u0442\u043e\u043b\u044c\u043a\u043e checkout \u0431\u0443\u0434\u0435\u0442 \u0433\u043e\u0442\u043e\u0432, \u043a\u043d\u043e\u043f\u043a\u0438 \u043e\u043f\u043b\u0430\u0442\u044b \u043f\u043e\u044f\u0432\u044f\u0442\u0441\u044f \u0437\u0434\u0435\u0441\u044c.', 'neutral');
        }
    }

    function navigateToSettings() {
        close();
        const url = '/ui/settings#premium';
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
        return FEATURES.map((feature) => `
            <section class="premium-promo-modal__feature">
                <span class="premium-promo-modal__feature-icon material-symbols-outlined" aria-hidden="true">${escapeHtml(feature.icon)}</span>
                <h3 class="premium-promo-modal__feature-title">${escapeHtml(feature.title)}</h3>
                <p class="premium-promo-modal__feature-text">${escapeHtml(feature.text)}</p>
            </section>
        `).join('');
    }

    function renderOffers() {
        return PERIODS.map((offer) => `
            <section class="premium-promo-modal__offer${offer.featured ? ' premium-promo-modal__offer--featured' : ''}">
                ${offer.featured ? '<span class="premium-promo-modal__offer-badge">\u0412\u044b\u0431\u043e\u0440</span>' : ''}
                <div>
                    <p class="premium-promo-modal__offer-title">${escapeHtml(offer.label)}</p>
                    <p class="premium-promo-modal__offer-price">${escapeHtml(offer.price)}</p>
                </div>
                <p class="premium-promo-modal__offer-note">${escapeHtml(offer.note)}</p>
            </section>
        `).join('');
    }

    function open(options = {}) {
        ensureStyles();
        if (activeModal) close();
        activeTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        const title = String(options.title || '\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 ACTRA Premium').trim();
        const lead = String(options.lead || '\u0411\u0435\u0437 \u043b\u0438\u043c\u0438\u0442\u043d\u044b\u0445 \u0441\u0442\u043e\u043f\u043e\u0440\u043e\u0432, \u0441 \u043f\u043e\u043b\u043d\u044b\u043c \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u0435\u043c \u0438 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u043e\u0439.').trim();

        const modal = document.createElement('div');
        modal.className = 'premium-promo-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'premium-promo-title');
        modal.dataset.premiumPromoModal = 'true';
        modal.innerHTML = `
            <div class="premium-promo-modal__panel" data-premium-promo-panel>
                <div class="premium-promo-modal__header">
                    <div class="premium-promo-modal__topline">
                        <span class="premium-promo-modal__kicker">
                            <span class="material-symbols-outlined" aria-hidden="true">workspace_premium</span>
                            <span>Premium</span>
                        </span>
                        <button class="premium-promo-modal__close" type="button" data-premium-promo-close aria-label="\u0417\u0430\u043a\u0440\u044b\u0442\u044c">
                            <span class="material-symbols-outlined" aria-hidden="true">close</span>
                        </button>
                    </div>
                    <div>
                        <h2 class="premium-promo-modal__title" id="premium-promo-title">${escapeHtml(title)}</h2>
                        <p class="premium-promo-modal__lead">${escapeHtml(lead)}</p>
                    </div>
                </div>
                <div class="premium-promo-modal__body">
                    <div class="premium-promo-modal__features">${renderFeatures()}</div>
                    <div class="premium-promo-modal__offers">${renderOffers()}</div>
                    <div class="premium-promo-modal__footer">
                        <div class="premium-promo-modal__status" data-premium-promo-status>
                            \u041c\u0435\u0445\u0430\u043d\u0438\u0437\u043c \u043e\u043f\u043b\u0430\u0442\u044b Premium \u0443\u0436\u0435 \u0432 \u0440\u0430\u0431\u043e\u0442\u0435. \u041f\u043e\u043a\u0430 \u044d\u0442\u043e \u043e\u043a\u043d\u043e \u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u0442 \u0442\u0430\u0440\u0438\u0444\u044b.
                        </div>
                        <button class="premium-promo-modal__settings" type="button" data-premium-promo-settings>
                            \u041f\u043e\u043d\u044f\u0442\u043d\u043e
                        </button>
                    </div>
                </div>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.closest('[data-premium-promo-close]')) {
                close();
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
        document.addEventListener('keydown', handleEscape);
        requestAnimationFrame(() => {
            modal.classList.add('is-open');
        });
        requestAnimationFrame(() => {
            const firstButton = modal.querySelector('[data-premium-promo-settings]') || modal.querySelector('[data-premium-promo-close]');
            if (firstButton && typeof firstButton.focus === 'function') {
                firstButton.focus({ preventScroll: true });
            }
        });
        return modal;
    }

    function getTriggerOptions(trigger) {
        const feature = String(trigger?.dataset?.premiumPromoFeature || '').trim();
        if (feature === 'calendar') {
            return {
                title: '\u041f\u043e\u043b\u043d\u044b\u0439 \u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0432 Premium',
                lead: '\u041f\u043e\u043b\u043d\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430: Daily Mix, \u043d\u043e\u0432\u044b\u0439 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b, \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435, \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c \u0438 \u0437\u0434\u043e\u0440\u043e\u0432\u044c\u0435 \u043f\u0430\u043c\u044f\u0442\u0438.',
            };
        }
        if (feature === 'statistics') {
            return {
                title: '\u041f\u043e\u043b\u043d\u0430\u044f \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0432 Premium',
                lead: '\u041f\u043e\u043b\u043d\u0430\u044f \u0441\u0432\u043e\u0434\u043a\u0430: \u0437\u0430\u0434\u0430\u0447\u0438, \u0432\u0440\u0435\u043c\u044f, \u043c\u0438\u043a\u0440\u043e\u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438, \u0441\u0435\u0440\u0438\u044f, \u0433\u0440\u0430\u0444\u0438\u043a, \u0442\u0438\u043f\u044b \u0437\u0430\u0434\u0430\u043d\u0438\u0439 \u0438 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u044b.',
            };
        }
        if (feature === 'tasks-limit') {
            return {
                title: '\u041b\u0438\u043c\u0438\u0442 \u0437\u0430\u0434\u0430\u043d\u0438\u0439 \u0443\u0445\u043e\u0434\u0438\u0442 \u0432 Premium',
                lead: '\u0411\u043e\u043b\u044c\u0448\u0435 \u043b\u0438\u0447\u043d\u044b\u0445 \u0437\u0430\u0434\u0430\u043d\u0438\u0439 \u0431\u0435\u0437 \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0438 \u043d\u0430 \u0441\u0447\u0435\u0442\u0447\u0438\u043a\u0435.',
            };
        }
        if (feature === 'complexes-limit') {
            return {
                title: '\u0411\u043e\u043b\u044c\u0448\u0435 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u043e\u0432 \u0432 Premium',
                lead: '\u0411\u043e\u043b\u044c\u0448\u0435 \u043b\u0438\u0447\u043d\u044b\u0445 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u043e\u0432 \u0438 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u043e\u0432 \u0432 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0435.',
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
        PERIODS,
        FEATURES,
        open,
        close,
        getOffer,
        formatPeriod,
        formatPeriodWithPrice,
        navigateToSettings,
    };

    bindTriggers();
})();
