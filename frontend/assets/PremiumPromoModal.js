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

    async function triggerPaddleCheckout(days, modalNode) {
        setStatus(modalNode, t('premium_promo_payment_pending', 'Preparing Paddle Checkout...'), 'neutral');
        const config = await fetchPaddleConfig();
        if (!config || !config.client_token) {
            setStatus(modalNode, t('premium_promo_payment_error', 'Failed to load billing configuration.'), 'error');
            return;
        }

        try {
            await loadPaddleScript(config.environment);
            if (!window.Paddle) throw new Error('Paddle SDK not available');

            window.Paddle.Environment.set(config.environment || 'production');
            window.Paddle.Initialize({ token: config.client_token });

            const priceId = config.prices ? config.prices[`${days}d`] : null;
            if (!priceId) {
                setStatus(modalNode, t('premium_promo_price_missing', 'Price configuration missing for selected period.'), 'error');
                return;
            }

            // Get current user ID if available
            let userId = '';
            try {
                const statusRes = await fetch('/api/billing/status', { credentials: 'same-origin' });
                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData && statusData.user) {
                        userId = statusData.user.user_id || statusData.user.id || '';
                    }
                }
            } catch (err) {
                // Ignore
            }

            setStatus(modalNode, t('premium_promo_checkout_opened', 'Checkout window opened.'), 'success');

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
        }
    }

    function renderOffers() {
        return getPeriods().map((offer) => `
            <button type="button" class="premium-promo-modal__offer${offer.featured ? ' premium-promo-modal__offer--featured' : ''}" data-premium-promo-buy="${offer.days}">
                ${offer.featured ? `<span class="premium-promo-modal__offer-badge">${escapeHtml(t('premium_promo_offer_badge', 'Best value'))}</span>` : ''}
                <div>
                    <p class="premium-promo-modal__offer-title">${escapeHtml(offer.label)}</p>
                    <p class="premium-promo-modal__offer-price">${escapeHtml(offer.price)}</p>
                </div>
                <p class="premium-promo-modal__offer-note">${escapeHtml(offer.note)}</p>
            </button>
        `).join('');
    }

    function open(options = {}) {
        ensureStyles();
        if (activeModal) close();
        activeTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        const title = String(options.title || t('premium_promo_title', 'Unlock ACTRA Premium')).trim();
        const lead = String(options.lead || t('premium_promo_lead', 'Premium checkout is being set up. You can explore plans and features now.')).trim();
        const closeLabel = t('premium_promo_close_label', 'Close');
        const statusText = t('premium_promo_status_wip', 'Premium payment is being set up. For now this window shows plans.');
        const settingsBtn = t('premium_promo_settings_btn', 'Got it');

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
                        <button class="premium-promo-modal__close" type="button" data-premium-promo-close aria-label="${escapeHtml(closeLabel)}">
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
                            ${escapeHtml(statusText)}
                        </div>
                        <button class="premium-promo-modal__settings" type="button" data-premium-promo-settings>
                            ${escapeHtml(settingsBtn)}
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
    };

    bindTriggers();
})();
