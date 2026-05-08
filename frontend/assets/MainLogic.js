(function () {
    window.__mainOwnsGlobalHeaderHydration = true;

    let currentUser = null;

    // --- Abort Controllers for Race Condition Prevention (7.4) ---
    let statsLoadAbortController = null; // Отмена старого запроса статистики при смене периода
    let sessionStartAbortController = null; // Защита от дублирования запросов создания сессии
    let legalDocuments = null;
    let feedbackOptionsCache = null;
    let mainConsentGateResolver = null;
    let mainConsentGateUserId = null;
    let projectLinksMenuInitialized = false;
    let mainBootRedirecting = false;

    const PROJECT_COMMUNITY_LINKS = Object.freeze({
        github: 'https://github.com/hippo2222/ACTRA',
        telegram: 'https://t.me/ACTRAsite',
    });

    // --- Core API Helpers ---
    async function apiFetch(url, options = {}) {
        try {
            const resp = await fetch(url, options);

            // Handle abort: если запрос был отменен, не пытаемся парсить
            if (!resp.ok && resp.status === 0) {
                console.log(`API Request cancelled: ${url}`);
                return { ok: false, error: 'Cancelled', cancelled: true };
            }

            const data = await resp.json();
            return { ok: data.ok, data };
        } catch (e) {
            // AbortError срабатывает при abort()
            if (e.name === 'AbortError') {
                console.log(`API Request aborted: ${url}`);
                return { ok: false, error: e, cancelled: true };
            }
            console.error(`API Error (${url}):`, e);
            return { ok: false, error: e };
        }
    }

    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('open');
        const appContent = document.getElementById('app-content');
        if (appContent) appContent.classList.add('blurred');
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('open');
        const appContent = document.getElementById('app-content');
        if (appContent) appContent.classList.remove('blurred');
    }

    window.showReferencePlaceholder = function () {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toast === 'function') {
            NotificationUI.toast('Справочник в разработке', 'warning', 2200);
            return;
        }
        window.alert('Справочник в разработке');
    }

    function closeProjectLinksMenu() {
        const menu = document.getElementById('projectLinksMenu');
        const button = document.getElementById('projectLinksButton');
        if (menu) {
            menu.classList.add('hidden');
        }
        if (button) {
            button.setAttribute('aria-expanded', 'false');
        }
    }

    function openProjectLinksMenu() {
        const menu = document.getElementById('projectLinksMenu');
        const button = document.getElementById('projectLinksButton');
        if (menu) {
            menu.classList.remove('hidden');
        }
        if (button) {
            button.setAttribute('aria-expanded', 'true');
        }
    }

    function toggleProjectLinksMenu(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const menu = document.getElementById('projectLinksMenu');
        if (!menu) return;

        if (menu.classList.contains('hidden')) {
            openProjectLinksMenu();
            return;
        }

        closeProjectLinksMenu();
    }

    function initProjectLinksMenu() {
        if (projectLinksMenuInitialized) return;
        projectLinksMenuInitialized = true;

        document.addEventListener('click', (event) => {
            const menu = document.getElementById('projectLinksMenu');
            const button = document.getElementById('projectLinksButton');
            if (!menu || !button) return;
            if (menu.contains(event.target) || button.contains(event.target)) return;
            closeProjectLinksMenu();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeProjectLinksMenu();
            }
        });
    }

    window.closeProjectLinksMenu = closeProjectLinksMenu;
    window.toggleProjectLinksMenu = toggleProjectLinksMenu;
    window.openProjectCommunityLink = function (kind) {
        const url = PROJECT_COMMUNITY_LINKS[kind];
        closeProjectLinksMenu();

        if (!url) {
            const message = kind === 'telegram'
                ? '\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 \u0442\u0435\u043b\u0435\u0433\u0440\u0430\u043c-\u043a\u0430\u043d\u0430\u043b \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f, \u043a\u043e\u0433\u0434\u0430 \u0443\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 \u0430\u0434\u0440\u0435\u0441.'
                : '\u0421\u0441\u044b\u043b\u043a\u0430 \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0440\u0430\u0437\u0434\u0435\u043b\u0430 \u043f\u043e\u043a\u0430 \u043d\u0435 \u0437\u0430\u0434\u0430\u043d\u0430.';
            if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toast === 'function') {
                NotificationUI.toast(message, 'warning', 2600);
                return;
            }
            window.alert(message);
            return;
        }

        window.open(url, '_blank', 'noopener,noreferrer');
    };

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    function compactUiLabel(value, maxLength = 56) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        if (text.length <= maxLength) return text;

        const separatorCount = (text.match(/[_:/-]/g) || []).length;
        const looksMachineLike = separatorCount >= 4 || /\b(session|complex|iteration|task)\b/i.test(text);
        if (!looksMachineLike) return text;

        const head = Math.max(18, Math.floor(maxLength * 0.62));
        const tail = Math.max(10, maxLength - head - 1);
        return `${text.slice(0, head)}\u2026${text.slice(-tail)}`;
    }

    function escapeInlineJsString(value) {
        const escaped = String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029')
            .replace(/</g, '\\x3C')
            .replace(/>/g, '\\x3E');
        return escapeHtml(escaped);
    }

    const PREMIUM_GATED_UI_PAGES = Object.freeze({
        '/ui/calendar': '\u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c',
        '/ui/statistics': '\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430',
    });
    let premiumGateModalOpen = false;

    function getPremiumGatedPage(url) {
        if (!url) return null;
        try {
            const destination = new URL(String(url), window.location.href);
            const path = destination.pathname.replace(/\/+$/, '') || '/';
            const label = PREMIUM_GATED_UI_PAGES[path];
            return label ? { path, label } : null;
        } catch (_err) {
            return null;
        }
    }

    function currentUserHasPremiumAccess() {
        const effectivePlan = String(currentUser?.effective_plan || currentUser?.plan || 'free').trim().toLowerCase();
        const role = String(currentUser?.role || currentUser?.account_role || '').trim().toLowerCase();
        return effectivePlan === 'premium' || role === 'admin' || currentUser?.is_admin === true;
    }

    async function showPremiumNavigationGate(page) {
        if (!page || premiumGateModalOpen) return;
        premiumGateModalOpen = true;
        try {
            if (window.PremiumPromo && typeof window.PremiumPromo.open === 'function') {
                window.PremiumPromo.open({
                    title: page.path === '/ui/statistics'
                        ? '\u041f\u043e\u043b\u043d\u0430\u044f \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0432 Premium'
                        : '\u041f\u043e\u043b\u043d\u044b\u0439 \u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0432 Premium',
                    lead: page.path === '/ui/statistics'
                        ? '\u041f\u043e\u043b\u043d\u0430\u044f \u0441\u0432\u043e\u0434\u043a\u0430: \u0437\u0430\u0434\u0430\u0447\u0438, \u0432\u0440\u0435\u043c\u044f, \u043c\u0438\u043a\u0440\u043e\u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438, \u0441\u0435\u0440\u0438\u044f, \u0433\u0440\u0430\u0444\u0438\u043a, \u0442\u0438\u043f\u044b \u0437\u0430\u0434\u0430\u043d\u0438\u0439 \u0438 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u044b.'
                        : '\u041f\u043e\u043b\u043d\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430: Daily Mix, \u043d\u043e\u0432\u044b\u0439 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b, \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435, \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c \u0438 \u0437\u0434\u043e\u0440\u043e\u0432\u044c\u0435 \u043f\u0430\u043c\u044f\u0442\u0438.',
                });
                return;
            }
            if (window.NotificationUI && typeof window.NotificationUI.confirm === 'function') {
                const shouldOpenSettings = await window.NotificationUI.confirm({
                    title: `${page.label} \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0432 Premium`,
                    message: '\u0412\u0438\u0434\u0436\u0435\u0442 \u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u043e\u0439 \u043e\u0441\u0442\u0430\u0435\u0442\u0441\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0432\u0441\u0435\u043c. \u041f\u043e\u043b\u043d\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0441 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u043d\u044b\u043c\u0438 \u0434\u0430\u043d\u043d\u044b\u043c\u0438 \u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u0430\u043a\u0442\u0438\u0432\u0430\u0446\u0438\u0438 Premium.',
                    confirmText: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c Premium',
                    cancelText: '\u041e\u0441\u0442\u0430\u0442\u044c\u0441\u044f \u0437\u0434\u0435\u0441\u044c',
                    variant: 'primary',
                });
                if (shouldOpenSettings) {
                    window.__mainPremiumNavigationBase?.('/ui/settings#premium');
                }
                return;
            }

            const shouldOpenSettings = window.confirm(`${page.label} \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0432 Premium. \u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 Premium?`);
            if (shouldOpenSettings) {
                window.__mainPremiumNavigationBase?.('/ui/settings#premium');
            }
        } finally {
            premiumGateModalOpen = false;
        }
    }

    function installPremiumNavigationGate() {
        if (window.__mainPremiumNavigationGateInstalled) return;
        const baseNavigate = typeof window.navigateWithTransition === 'function'
            ? window.navigateWithTransition.bind(window)
            : (url, options = {}) => {
                if (options?.replace) window.location.replace(url);
                else window.location.assign(url);
            };
        window.__mainPremiumNavigationGateInstalled = true;
        window.__mainPremiumNavigationBase = baseNavigate;
        window.navigateWithTransition = (url, options) => {
            const gatedPage = getPremiumGatedPage(url);
            if (gatedPage && !currentUserHasPremiumAccess()) {
                showPremiumNavigationGate(gatedPage);
                return;
            }
            baseNavigate(url, options);
        };
    }

    const mainRecommendationState = {
        preferredAction: null,
        statsEmpty: null,
        calendarMixCount: 0,
        calendarHasData: false,
        microcardsDue: 0,
        microcardsHasDecks: false,
        microcardsDisabled: false,
    };

    function setMainRecommendationState(partial) {
        Object.assign(mainRecommendationState, partial || {});
        renderMainNextStepBanner();
    }

    function ensureMainNextStepBanner() {
        const host = document.getElementById('quick-access-section');
        if (!host) return null;

        let banner = document.getElementById('mainNextStepBanner');
        if (banner) return banner;

        banner = document.createElement('div');
        banner.id = 'mainNextStepBanner';
        banner.className = 'mb-3 rounded-xl border border-primary-light bg-primary-lighter/40 p-3';

        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col gap-3 md:flex-row md:items-center md:justify-between';

        const textWrap = document.createElement('div');
        textWrap.className = 'min-w-0';

        const eyebrow = document.createElement('p');
        eyebrow.className = 'text-[10px] font-bold uppercase tracking-[0.18em] text-primary';
        eyebrow.textContent = 'Лучший следующий шаг';

        const title = document.createElement('p');
        title.id = 'mainNextStepTitle';
        title.className = 'mt-1 text-sm font-bold text-text-main min-w-0';

        const reason = document.createElement('p');
        reason.id = 'mainNextStepReason';
        reason.className = 'mt-1 text-xs text-text-secondary min-w-0';

        textWrap.appendChild(eyebrow);
        textWrap.appendChild(title);
        textWrap.appendChild(reason);

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'mainNextStepButton';
        button.className = 'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-fg transition-all hover:bg-primary-hover';

        const icon = document.createElement('span');
        icon.id = 'mainNextStepButtonIcon';
        icon.className = 'material-symbols-outlined text-[18px]';

        const label = document.createElement('span');
        label.id = 'mainNextStepButtonLabel';

        button.appendChild(icon);
        button.appendChild(label);
        wrap.appendChild(textWrap);
        wrap.appendChild(button);
        banner.appendChild(wrap);

        const referenceNode = document.getElementById('quick-access-empty');
        if (referenceNode) {
            host.insertBefore(banner, referenceNode.nextSibling);
        } else {
            host.appendChild(banner);
        }

        return banner;
    }

    function getMainFallbackRecommendation() {
        if (mainRecommendationState.calendarHasData && mainRecommendationState.calendarMixCount > 0) {
            return {
                title: 'Откройте план на сегодня',
                reason: 'На сегодня уже есть готовый учебный шаг. Это самый быстрый способ войти в рабочий ритм.',
                label: 'Открыть календарь',
                icon: 'calendar_month',
                action: () => window.navigateWithTransition('/ui/calendar'),
            };
        }

        if (mainRecommendationState.microcardsDue > 0) {
            return {
                title: 'Сделайте короткое повторение',
                reason: `Сейчас к повторению ждут ${mainRecommendationState.microcardsDue} карточек. Это самый короткий путь вернуться в обучение.`,
                label: 'Открыть микрокарточки',
                icon: 'style',
                action: () => window.navigateWithTransition('/ui/microcards'),
            };
        }

        if (mainRecommendationState.statsEmpty === true) {
            return {
                title: 'Запустите первый комплекс',
                reason: 'После первого прохождения здесь появятся прогресс, календарь и понятная статистика.',
                label: 'Открыть комплексы',
                icon: 'playlist_play',
                action: () => window.navigateWithTransition('/ui/complexes'),
            };
        }

        if (mainRecommendationState.microcardsHasDecks && !mainRecommendationState.microcardsDisabled) {
            return {
                title: 'Вернитесь через лёгкое повторение',
                reason: 'Если нет времени на длинную сессию, начните с микрокарточек и быстро вернитесь в ритм.',
                label: 'Открыть микрокарточки',
                icon: 'style',
                action: () => window.navigateWithTransition('/ui/microcards'),
            };
        }

        return {
            title: 'Продолжите обучение',
            reason: 'Откройте комплексы и выберите следующий шаг без лишних поисков.',
            label: 'Открыть комплексы',
            icon: 'arrow_forward',
            action: () => window.navigateWithTransition('/ui/complexes'),
        };
    }

    function renderMainNextStepBanner() {
        const banner = document.getElementById('mainNextStepBanner');
        if (banner) banner.remove();
    }

    function showFeedbackError(message) {
        const el = document.getElementById('feedbackError');
        if (!el) return;
        if (!message) {
            el.textContent = '';
            el.classList.add('hidden');
            return;
        }
        el.textContent = message;
        el.classList.remove('hidden');
    }

    function showFeedbackNetworkStatus(message, tone = 'neutral') {
        const el = document.getElementById('feedbackNetworkStatus');
        if (!el) return;
        if (!message) {
            el.textContent = '';
            el.className = 'hidden text-xs rounded-lg px-3 py-2 border border-border-strong bg-surface-2 text-text-secondary';
            return;
        }

        const toneClassMap = {
            warning: 'text-xs rounded-lg px-3 py-2 border border-border-strong bg-surface-2 text-text-main',
            success: 'text-xs rounded-lg px-3 py-2 border border-border-strong bg-surface-2 text-text-main',
            neutral: 'text-xs rounded-lg px-3 py-2 border border-border-strong bg-surface-2 text-text-secondary',
        };
        el.className = toneClassMap[tone] || toneClassMap.neutral;
        el.textContent = message;
    }

    async function fetchNetworkStatus() {
        const { ok, data } = await apiFetch('/api/network/status');
        if (!ok || !data) return null;
        return data;
    }

    async function retryPendingFeedbackDelivery() {
        // Best-effort background retry for tickets queued while offline.
        await apiFetch('/api/feedback/retry-pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 5 }),
        });
    }

    function showMainConsentGateError(message) {
        const el = document.getElementById('mainConsentGateError');
        if (!el) return;
        if (!message) {
            el.textContent = '';
            el.classList.add('hidden');
            return;
        }
        el.textContent = message;
        el.classList.remove('hidden');
    }

    async function ensureLegalDocumentsLoaded() {
        if (legalDocuments) return true;
        const { ok, data } = await apiFetch('/api/legal/current');
        if (!ok || !data?.documents) return false;
        legalDocuments = data.documents;
        return true;
    }

    function getRequiredConsentVersions() {
        if (!legalDocuments) return { terms_version: '', privacy_version: '' };
        return {
            terms_version: legalDocuments.terms?.version || '',
            privacy_version: legalDocuments.privacy?.version || '',
        };
    }

    function collectConsent(termsCheckboxId, privacyCheckboxId) {
        const termsEl = document.getElementById(termsCheckboxId);
        const privacyEl = document.getElementById(privacyCheckboxId);
        const versions = getRequiredConsentVersions();
        return {
            accepted: !!(termsEl && termsEl.checked && privacyEl && privacyEl.checked),
            terms_version: versions.terms_version,
            privacy_version: versions.privacy_version,
        };
    }

    window.openMainLegalDocument = async function (docType) {
        const loaded = await ensureLegalDocumentsLoaded();
        if (!loaded) {
            NotificationUI.toast('Не удалось загрузить юридические документы', 'error');
            return;
        }

        const { ok, data } = await apiFetch(`/api/legal/document/${docType}`);
        if (!ok || !data?.document) {
            NotificationUI.toast('Не удалось открыть документ', 'error');
            return;
        }

        const doc = data.document;
        const titleEl = document.getElementById('mainLegalDocTitle');
        const metaEl = document.getElementById('mainLegalDocMeta');
        const contentEl = document.getElementById('mainLegalDocContent');
        if (titleEl) titleEl.textContent = doc.title || 'Документ';
        if (metaEl) metaEl.textContent = `Версия: ${doc.version || '-'} | Действует с: ${doc.effective_at || '-'}`;
        if (contentEl) contentEl.textContent = doc.content || '';
        openModal('mainLegalDocModal');
    };

    window.closeMainLegalDocument = function () {
        closeModal('mainLegalDocModal');
    };

    window.updateNewProfileConsentState = function () {
        const terms = document.getElementById('newProfileAcceptTerms');
        const privacy = document.getElementById('newProfileAcceptPrivacy');
        const btn = document.getElementById('createProfileBtn');
        if (btn) btn.disabled = !(terms?.checked && privacy?.checked);
    };

    window.updateMainConsentGateState = function () {
        const terms = document.getElementById('mainConsentGateAcceptTerms');
        const privacy = document.getElementById('mainConsentGateAcceptPrivacy');
        const btn = document.getElementById('mainConsentGateSubmitBtn');
        if (btn) btn.disabled = !(terms?.checked && privacy?.checked);
    };

    function openMainConsentGate(userId, required) {
        mainConsentGateUserId = userId;
        const versionsEl = document.getElementById('mainConsentGateVersions');
        const termsEl = document.getElementById('mainConsentGateAcceptTerms');
        const privacyEl = document.getElementById('mainConsentGateAcceptPrivacy');

        if (versionsEl) {
            versionsEl.textContent = `Terms: ${required.terms_version || '-'} | Privacy: ${required.privacy_version || '-'}`;
        }
        if (termsEl) termsEl.checked = false;
        if (privacyEl) privacyEl.checked = false;
        showMainConsentGateError(null);
        window.updateMainConsentGateState();
        openModal('mainConsentGateModal');

        return new Promise(resolve => {
            mainConsentGateResolver = resolve;
        });
    }

    window.cancelMainConsentGate = function () {
        closeModal('mainConsentGateModal');
        showMainConsentGateError(null);
        mainConsentGateUserId = null;
        if (mainConsentGateResolver) {
            mainConsentGateResolver(false);
            mainConsentGateResolver = null;
        }
    };

    window.submitMainConsentGate = async function () {
        if (!mainConsentGateUserId) {
            showMainConsentGateError('Не выбран профиль');
            return;
        }

        const consent = collectConsent('mainConsentGateAcceptTerms', 'mainConsentGateAcceptPrivacy');
        if (!consent.accepted) {
            showMainConsentGateError('Подтвердите оба документа');
            return;
        }

        const { ok, data } = await apiFetch('/api/consent/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: mainConsentGateUserId,
                source: 'main_gate',
                consent,
            }),
        });

        if (!ok) {
            showMainConsentGateError((data && (data.message || data.error)) || 'Не удалось сохранить согласие');
            return;
        }

        closeModal('mainConsentGateModal');
        showMainConsentGateError(null);
        mainConsentGateUserId = null;
        if (mainConsentGateResolver) {
            mainConsentGateResolver(true);
            mainConsentGateResolver = null;
        }
    };

    async function ensureUserConsent(userId) {
        const [loaded, consentResponse] = await Promise.all([
            ensureLegalDocumentsLoaded(),
            apiFetch(`/api/consent/status?user_id=${encodeURIComponent(userId)}`),
        ]);
        if (!loaded) {
            NotificationUI.toast('Не удалось загрузить юридические документы', 'error');
            return false;
        }

        const { ok, data } = consentResponse;
        if (!ok || !data) {
            NotificationUI.toast('Не удалось проверить согласие с условиями', 'error');
            return false;
        }
        if (data.status === 'up_to_date') return true;

        const required = data.required || getRequiredConsentVersions();
        return openMainConsentGate(userId, required);
    }

    function buildFeedbackTechnicalPayload() {
        const rootTheme = document.documentElement.getAttribute('data-theme');
        let localTheme = null;
        try {
            localTheme = localStorage.getItem('theme');
        } catch (_) {
            localTheme = null;
        }

        return {
            app_route: window.location.pathname,
            href: window.location.href,
            user_agent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
            theme: rootTheme || localTheme || null,
            submitted_at: new Date().toISOString(),
        };
    }

    function renderFeedbackSelectOptions(selectId, values, labelsMap, defaultValue) {
        const select = document.getElementById(selectId);
        if (!select || !Array.isArray(values) || values.length === 0) return;

        select.replaceChildren();
        values.forEach(v => {
            const safe = String(v);
            const label = labelsMap[safe] || safe;
            const option = document.createElement('option');
            option.value = safe;
            option.textContent = String(label);
            select.appendChild(option);
        });

        if (defaultValue && values.includes(defaultValue)) {
            select.value = defaultValue;
        }
    }

    async function ensureFeedbackOptionsLoaded() {
        if (feedbackOptionsCache) return feedbackOptionsCache;
        const { ok, data } = await apiFetch('/api/feedback/options');
        if (!ok || !data) return null;
        feedbackOptionsCache = data;
        return feedbackOptionsCache;
    }

    window.openFeedbackModal = async function () {
        showFeedbackError(null);
        showFeedbackNetworkStatus(null);
        const titleEl = document.getElementById('feedbackTitle');
        const descEl = document.getElementById('feedbackDescription');
        const includeTechEl = document.getElementById('feedbackIncludeTechnical');
        const includeLogsEl = document.getElementById('feedbackIncludeLogs');
        if (titleEl) titleEl.value = '';
        if (descEl) descEl.value = '';
        if (includeTechEl) includeTechEl.checked = false;
        if (includeLogsEl) includeLogsEl.checked = false;

        const options = await ensureFeedbackOptionsLoaded();
        if (options) {
            renderFeedbackSelectOptions('feedbackType', options.types || [], {
                bug: '\u0411\u0430\u0433',
                idea: '\u0418\u0434\u0435\u044f',
                improvement: '\u0423\u043b\u0443\u0447\u0448\u0435\u043d\u0438\u0435',
                question: '\u0412\u043e\u043f\u0440\u043e\u0441',
            }, 'bug');
            renderFeedbackSelectOptions('feedbackSeverity', options.severity || [], {
                low: '\u041d\u0438\u0437\u043a\u0430\u044f',
                medium: '\u0421\u0440\u0435\u0434\u043d\u044f\u044f',
                high: '\u0412\u044b\u0441\u043e\u043a\u0430\u044f',
                critical: '\u041a\u0440\u0438\u0442\u0438\u0447\u043d\u0430\u044f',
            }, 'medium');
        }

        const network = await fetchNetworkStatus();
        if (network && network.internet_online === false) {
            showFeedbackNetworkStatus('\u0418\u043d\u0442\u0435\u0440\u043d\u0435\u0442 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d. \u041e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0441\u044f \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u0438 \u0431\u0443\u0434\u0435\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u043f\u0440\u0438 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0439 \u043f\u043e\u043f\u044b\u0442\u043a\u0435.', 'warning');
        } else if (network?.feedback_delivery && network.feedback_delivery.configured === false) {
            showFeedbackNetworkStatus('\u041a\u0430\u043d\u0430\u043b \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439 \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a\u0443 \u043f\u043e\u043a\u0430 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d. \u041e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0441\u044f \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e.', 'neutral');
        } else if (network?.internet_online === true) {
            showFeedbackNetworkStatus('\u0421\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435 \u0441 \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u043e\u043c \u0435\u0441\u0442\u044c. \u041e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u0431\u0443\u0434\u0435\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a\u0443 \u043f\u043e email.', 'success');
            retryPendingFeedbackDelivery();
        }

        openModal('feedbackModal');
    };

    window.closeFeedbackModal = function () {
        closeModal('feedbackModal');
        showFeedbackError(null);
        showFeedbackNetworkStatus(null);
    };

    window.submitFeedback = async function () {
        const typeEl = document.getElementById('feedbackType');
        const severityEl = document.getElementById('feedbackSeverity');
        const titleEl = document.getElementById('feedbackTitle');
        const descEl = document.getElementById('feedbackDescription');
        const includeTechEl = document.getElementById('feedbackIncludeTechnical');
        const includeLogsEl = document.getElementById('feedbackIncludeLogs');
        const submitBtn = document.getElementById('feedbackSubmitBtn');

        const title = (titleEl?.value || '').trim();
        const description = (descEl?.value || '').trim();

        if (title.length < 3 || title.length > 180) {
            showFeedbackError('\u0422\u0435\u043c\u0430 \u0434\u043e\u043b\u0436\u043d\u0430 \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u043e\u0442 3 \u0434\u043e 180 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432');
            titleEl?.focus();
            return;
        }
        if (description.length < 5 || description.length > 10000) {
            showFeedbackError('\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0434\u043e\u043b\u0436\u043d\u043e \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u043e\u0442 5 \u0434\u043e 10000 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432');
            descEl?.focus();
            return;
        }
        if (!currentUser?.user_id) {
            showFeedbackError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0440\u043e\u0444\u0438\u043b\u044c');
            return;
        }

        showFeedbackError(null);
        if (submitBtn) submitBtn.disabled = true;

        const includeTechnicalData = !!includeTechEl?.checked;
        const payload = {
            user_id: currentUser.user_id,
            type: typeEl?.value || 'bug',
            severity: severityEl?.value || 'medium',
            title,
            description,
            include_technical_data: includeTechnicalData,
            include_logs: !!includeLogsEl?.checked,
        };
        if (includeTechnicalData) {
            payload.technical = buildFeedbackTechnicalPayload();
        }

        const { ok, data } = await apiFetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (submitBtn) submitBtn.disabled = false;

        if (!ok) {
            const message = (data && (data.message || data.error)) || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435';
            showFeedbackError(message);
            return;
        }

        const ticketId = data?.ticket_id ? ` (${data.ticket_id})` : '';
        const emailSent = !!data?.email_notification?.sent;
        if (emailSent) {
            NotificationUI.toast(`\u041e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e${ticketId}`, 'success');
        } else {
            NotificationUI.toast(`\u041e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e${ticketId}. \u041e\u0442\u043f\u0440\u0430\u0432\u0438\u043c \u043f\u0440\u0438 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0439 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u0438`, 'warning');
        }
        window.closeFeedbackModal();
    };

    // --- Initialization ---
    function finishMainBoot() {
        document.body.classList.remove('main-is-booting');
        const bootScreen = document.querySelector('.main-boot-screen');
        if (bootScreen) {
            window.setTimeout(() => {
                bootScreen.setAttribute('aria-hidden', 'true');
            }, 360);
        }
    }

    async function initialize() {
        try {
            // 1. Update UI baseline
            updateDateTime();
            initProjectLinksMenu();
            installPremiumNavigationGate();

            if (!window.updateDateTimeInterval) {
                window.updateDateTimeInterval = setInterval(updateDateTime, 30000);
            }

            // 2. Load User
            await loadCurrentUser();

            // 3. Load Dynamic Content
            if (!currentUser) {
                return;
            }

            retryPendingFeedbackDelivery();
            const consentOk = await ensureUserConsent(currentUser.user_id);
            if (!consentOk) {
                mainBootRedirecting = true;
                window.navigateWithTransition('/ui/welcome');
                return;
            }

            initEscKeyHandler(); // WEAK-5 fix: ESC closes modals
            window.updateNewProfileConsentState();

            // Listen for theme changes to sync with backend
            window.addEventListener('themechanged', async (e) => {
                if (isInitialThemeLoad) {
                    console.log('[MainLogic] Ignoring initial theme load event');
                    return;
                }
                const newThemeId = e.detail.themeId;
                console.log('[MainLogic] Theme changed, syncing to backend:', newThemeId);
                await apiFetch('/api/ui/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ settings: { theme: newThemeId } })
                });
            });

            Promise.allSettled([
                loadCalendarWidget(),
                loadMicrocardsWidget(),
            ]).then((widgetLoads) => {
                widgetLoads.forEach((result) => {
                    if (result.status === 'rejected') {
                        console.error('[MainLogic] Deferred widget load failed:', result.reason);
                    }
                });
            });

            const criticalWidgetLoads = await Promise.allSettled([
                loadQuickAccess(),
                loadUserSettings(), // Renamed from loadStatsSettings
            ]);
            criticalWidgetLoads.forEach((result) => {
                if (result.status === 'rejected') {
                    console.error('[MainLogic] Initial critical widget load failed:', result.reason);
                }
            });

            loadStatistics().catch((error) => {
                console.error('[MainLogic] Deferred statistics load failed:', error);
            });

            applyMainPreviewMode();
        } catch (error) {
            console.error('[MainLogic] Failed to initialize main screen:', error);
        } finally {
            if (!mainBootRedirecting) {
                finishMainBoot();
            }
        }
    }

    function isMainWidgetsPreviewEnabled() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return params.get('preview') === 'widgets' || params.get('mock') === 'widgets';
        } catch (_err) {
            return false;
        }
    }

    function applyMainPreviewMode() {
        if (!isMainWidgetsPreviewEnabled()) return;
        renderPreviewCalendarWidget();
        renderPreviewStatisticsWidget();
        renderPreviewQuickAccessWidget();
    }

    function renderPreviewCalendarWidget() {
        const loadingState = document.getElementById('calendarLoadingState');
        const emptyState = document.getElementById('calendarEmptyState');
        const contentState = document.getElementById('calendarContentState');
        const streakEl = document.getElementById('calendarStreakDays');
        const countEl = document.getElementById('calendarDailyMixCount');
        const timeEl = document.getElementById('calendarDailyMixTime');
        const healthList = document.getElementById('calendarHealthList');

        if (loadingState) loadingState.classList.add('hidden');
        if (emptyState) emptyState.classList.add('hidden');
        if (contentState) {
            contentState.classList.remove('hidden');
            contentState.classList.add('flex');
        }
        if (streakEl) streakEl.textContent = '6';
        if (countEl) {
            countEl.innerHTML = '<span class="text-sm font-black text-text-main">5</span><span class="text-[11px] text-text-secondary">задач</span>';
        }
        if (timeEl) {
            if (timeEl.parentElement) timeEl.parentElement.classList.remove('hidden');
            timeEl.textContent = '~34 мин';
        }

        const today = new Date();
        const previewDynamics = Array.from({ length: 14 }, (_unused, index) => {
            const date = new Date(today);
            date.setDate(today.getDate() - (13 - index));
            const pattern = [
                { task_attempts: 0, study_minutes: 0, completed_complexes: 0 },
                { task_attempts: 3, study_minutes: 8, completed_complexes: 0 },
                { task_attempts: 8, study_minutes: 20, completed_complexes: 0 },
                { task_attempts: 0, study_minutes: 0, completed_complexes: 0 },
                { task_attempts: 16, study_minutes: 42, completed_complexes: 1 },
                { task_attempts: 4, study_minutes: 12, completed_complexes: 0 },
                { task_attempts: 9, study_minutes: 24, completed_complexes: 0 },
                { task_attempts: 0, study_minutes: 0, completed_complexes: 0 },
                { task_attempts: 5, study_minutes: 16, completed_complexes: 0 },
                { task_attempts: 14, study_minutes: 36, completed_complexes: 1 },
                { task_attempts: 24, study_minutes: 72, completed_complexes: 2 },
                { task_attempts: 10, study_minutes: 26, completed_complexes: 0 },
                { task_attempts: 4, study_minutes: 10, completed_complexes: 0 },
                { task_attempts: 18, study_minutes: 46, completed_complexes: 1 },
            ][index];
            return {
                date: date.toISOString().split('T')[0],
                tasks_attempted: pattern.task_attempts,
                task_attempts: pattern.task_attempts,
                study_minutes: pattern.study_minutes,
                completed_complexes: pattern.completed_complexes,
            };
        });
        renderMiniHeatmap(previewDynamics);

        if (healthList) {
            healthList.innerHTML = `
                <div class="main-health-row panel-row" title="Повторить: электродинамика&#10;Также ждут повторения: кинематика, магнитное поле">
                    <div class="main-health-meta">
                        <div class="w-1.5 h-1.5 rounded-full bg-status-error"></div>
                        <span class="main-health-name">Повторить: электродинамика</span>
                    </div>
                    <span class="main-health-extra" title="Ещё 2 комплекса">+2</span>
                </div>
            `;
        }
    }

    function renderPreviewStatisticsWidget() {
        const skeleton = document.getElementById('statsSkeleton');
        const content = document.getElementById('statsContent');
        const welcomeEl = document.getElementById('statsWelcomeMessage');
        const errorEl = document.getElementById('statsErrorMessage');
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        if (skeleton) skeleton.classList.add('hidden');
        if (welcomeEl) welcomeEl.remove();
        if (errorEl) errorEl.remove();
        if (content) {
            content.classList.remove('hidden', 'stats-content--empty', 'stats-content--error');
            content.querySelectorAll('.main-stats-row').forEach((row) => row.classList.remove('hidden'));
        }
        setText('statSolvedTasks', '18');
        setText('statTotalAvailable', '24');
        setText('statSuccessRate', '86%');
        setText('statTimeSpent', '1ч 42м');
        setText('statComplexesLabel', 'Комплексов сегодня');
        setText('statTodayCount', '3');
    }

    function renderPreviewQuickAccessWidget() {
        ensureQuickAccessHeader();
        const emptyEl = document.getElementById('quick-access-empty');
        const list = document.getElementById('quick-access-list');
        const count = document.getElementById('quick-access-count');

        if (emptyEl) emptyEl.hidden = true;
        if (count) {
            count.textContent = '3';
            count.title = 'Комплексов в быстром доступе: 3';
        }
        if (!list) return;

        list.hidden = false;
        list.className = 'main-quick-access-grid main-quick-access-grid--rail';
        list.innerHTML = `
            <div class="main-quick-access-card interactive-card group" data-tone="paused" role="button" tabindex="0" title="Подготовка к контрольной: электричество">
                <button type="button" class="main-quick-access-remove icon-button-muted" title="Убрать">
                    <span class="material-symbols-outlined text-[14px]">close</span>
                </button>
                <div class="main-quick-access-card-head">
                    <div class="main-quick-access-media">
                        <div class="relative w-8 h-8 flex items-center justify-center shrink-0">
                            <svg class="w-full h-full transform -rotate-90">
                                <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2.5" fill="transparent" pathLength="100" class="text-text-on-dark dark:text-text-secondary"></circle>
                                <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2.5" fill="transparent" pathLength="100" stroke-dasharray="100" stroke-dashoffset="38" stroke-linecap="round" class="text-primary"></circle>
                            </svg>
                            <span class="absolute text-[8px] font-bold text-text-secondary dark:text-text-on-dark">62%</span>
                        </div>
                    </div>
                    <div class="main-quick-access-body">
                        <div class="main-quick-access-topline">
                            <span class="main-quick-access-pill pill-neutral pill-sm pill-kicker">На паузе</span>
                            <span class="main-quick-access-meta-tag">Шаг 7/12</span>
                        </div>
                        <div class="main-quick-access-title">Подготовка к контрольной</div>
                        <div class="main-quick-access-description">Электричество: закон Ома, цепи, мощность.</div>
                    </div>
                </div>
                <div class="main-quick-access-footer">
                    <div class="main-quick-access-progress">
                        <div class="main-quick-access-progress-label">Сейчас 7/12</div>
                        <div class="main-quick-access-progress-track"><div class="main-quick-access-progress-fill" style="width: 62%"></div></div>
                    </div>
                    <div class="main-quick-access-action"><span>Продолжить</span><span class="material-symbols-outlined">restart_alt</span></div>
                </div>
            </div>
            <div class="main-quick-access-card interactive-card group" data-tone="critical" role="button" tabindex="0" title="Кинематика: графики движения">
                <button type="button" class="main-quick-access-remove icon-button-muted" title="Убрать">
                    <span class="material-symbols-outlined text-[14px]">close</span>
                </button>
                <div class="main-quick-access-card-head">
                    <div class="main-quick-access-media">
                        <div class="w-8 h-8 rounded-lg border border-border-subtle bg-surface-2 flex items-center justify-center text-text-secondary font-bold text-[10px] uppercase shrink-0">КИ</div>
                        <div class="absolute -top-1 -right-1 flex h-3 w-3"><span class="relative inline-flex rounded-full h-3 w-3 bg-status-error"></span></div>
                    </div>
                    <div class="main-quick-access-body">
                        <div class="main-quick-access-topline">
                            <span class="main-quick-access-pill pill-neutral pill-sm pill-kicker">Нужен повтор</span>
                            <span class="main-quick-access-meta-tag">Риск забывания</span>
                        </div>
                        <div class="main-quick-access-title">Кинематика: графики</div>
                        <div class="main-quick-access-description">Материал просит внимания после перерыва.</div>
                    </div>
                </div>
                <div class="main-quick-access-footer">
                    <div class="main-quick-access-progress">
                        <div class="main-quick-access-progress-label">Пора вернуться</div>
                        <div class="main-quick-access-progress-track"><div class="main-quick-access-progress-fill" style="width: 18%"></div></div>
                    </div>
                    <div class="main-quick-access-action"><span>Вернуться</span><span class="material-symbols-outlined">local_fire_department</span></div>
                </div>
            </div>
            <div class="main-quick-access-card interactive-card group" data-tone="mastered" role="button" tabindex="0" title="Магнитное поле: повторение">
                <button type="button" class="main-quick-access-remove icon-button-muted" title="Убрать">
                    <span class="material-symbols-outlined text-[14px]">close</span>
                </button>
                <div class="main-quick-access-card-head">
                    <div class="main-quick-access-media">
                        <span class="material-symbols-outlined text-[22px]">verified</span>
                    </div>
                    <div class="main-quick-access-body">
                        <div class="main-quick-access-topline">
                            <span class="main-quick-access-pill pill-neutral pill-sm pill-kicker">Закреплено</span>
                            <span class="main-quick-access-meta-tag">100%</span>
                        </div>
                        <div class="main-quick-access-title">Магнитное поле</div>
                        <div class="main-quick-access-description">Повторение перед итоговой проверкой.</div>
                    </div>
                </div>
                <div class="main-quick-access-footer">
                    <div class="main-quick-access-progress">
                        <div class="main-quick-access-progress-label">Готово к повторению</div>
                        <div class="main-quick-access-progress-track"><div class="main-quick-access-progress-fill" style="width: 100%"></div></div>
                    </div>
                    <div class="main-quick-access-action"><span>Открыть</span><span class="material-symbols-outlined">arrow_forward</span></div>
                </div>
            </div>
        `;
        setupQuickAccessRail(3);
    }

    async function loadCurrentUser() {
        const { ok, data } = await apiFetch('/api/users/current');

        if (ok && data.user) {
            currentUser = data.user;
            updateHeaderUser(currentUser);
        } else {
            // No active user — redirect to Welcome Screen
            mainBootRedirecting = true;
            window.navigateWithTransition('/ui/welcome');
        }
    }

    function getAvatarUrl(avatarSeed, userId) {
        // Если нет avatarSeed, используем дефолтный аватар
        if (!avatarSeed) {
            avatarSeed = '1.png';
        }
        // Если это имя файла (содержит точку), используем его
        if (avatarSeed.includes('.')) {
            return `/api/assets/avatars/${avatarSeed}`;
        }
        // Если это не файл (старые данные или user_id), используем дефолтный
        return `/api/assets/avatars/1.png`;
    }

    function updateHeaderUser(user) {
        window.__mainCurrentUser = user;
        const nameEl = document.getElementById('headerUserName');
        const avatarEl = document.getElementById('headerAvatar');
        const planBadgeEl = document.querySelector('[data-global-plan-badge]');
        if (nameEl) nameEl.textContent = user.name;
        if (avatarEl) avatarEl.src = getAvatarUrl(user.avatar_seed, user.user_id);
        if (planBadgeEl) {
            const effectivePlan = String(user.effective_plan || user.plan || 'free').trim().toLowerCase();
            planBadgeEl.hidden = false;
            planBadgeEl.textContent = effectivePlan === 'premium' ? 'Premium' : 'Free';
            planBadgeEl.classList.toggle('is-premium', effectivePlan === 'premium');
        }
    }
    window.__mainUpdateHeaderUser = updateHeaderUser;

    // --- User Management ---
    window.openProfileManagementModal = async function () {
        const termsEl = document.getElementById('newProfileAcceptTerms');
        const privacyEl = document.getElementById('newProfileAcceptPrivacy');
        const nameEl = document.getElementById('newUserName');
        if (termsEl) termsEl.checked = false;
        if (privacyEl) privacyEl.checked = false;
        if (nameEl) nameEl.value = '';
        window.updateNewProfileConsentState();

        openModal('profileModal');

        await loadProfilesList();
    }

    window.openProfileModal = window.openProfileManagementModal;

    window.closeProfileManagementModal = function () {
        closeModal('profileModal');
    }

    window.closeProfileModal = window.closeProfileManagementModal;

    async function loadProfilesList() {
        const listEl = document.getElementById('profilesList');
        listEl.innerHTML = '<div class="text-center py-8 text-text-muted">Загрузка...</div>';

        const { ok, data } = await apiFetch('/api/users');

        if (ok) {
            listEl.innerHTML = data.items.map(user => {
                const userIdLiteral = escapeInlineJsString(user.user_id);
                const avatarUrl = escapeHtml(getAvatarUrl(user.avatar_seed, user.user_id));
                const safeUserName = escapeHtml(user.name);
                return `
                <div class="group flex items-center justify-between p-4 rounded-2xl border ${currentUser?.user_id === user.user_id ? 'border-primary bg-primary-lighter' : 'border-border-subtle hover:border-border-strong'} hover:border-primary cursor-pointer transition-all">
                    <div class="flex items-center gap-4 flex-1" onclick="selectProfile('${userIdLiteral}')">
                        <img src="${avatarUrl}" class="w-10 h-10 rounded-full bg-surface-2 object-cover">
                        <div>
                            <div class="font-bold text-text-main flex items-center gap-2">
                                ${safeUserName}
                                ${user.has_password ? '<span class="material-symbols-outlined text-[14px] text-text-muted">lock</span>' : ''}
                            </div>
                            <div class="text-[10px] text-text-main font-medium uppercase">Нажмите для выбора</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="openEditProfile('${userIdLiteral}')" class="size-8 flex items-center justify-center rounded-xl bg-transparent border border-transparent text-text-muted hover:bg-surface-2 hover:text-text-main transition-all" title="Редактировать">
                            <span class="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        ${currentUser?.user_id === user.user_id ? '<span class="text-primary material-symbols-outlined">check_circle</span>' : ''}
                    </div>
                </div>
            `;
            }).join('');
        } else {
            listEl.innerHTML = '<div class="text-center py-8 text-error">Ошибка загрузки</div>';
        }
    }

    window.createNewProfile = async function () {
        const input = document.getElementById('newUserName');
        const name = input.value?.trim();

        // Валидация на пустоту
        if (!name) {
            NotificationUI.toast('Введите имя профиля', 'warning');
            input.focus();
            return;
        }

        // Проверка минимальной длины
        if (name.length < 2) {
            NotificationUI.toast('Имя должно содержать минимум 2 символа', 'warning');
            input.focus();
            return;
        }

        // Проверка максимальной длины
        if (name.length > 50) {
            NotificationUI.toast('Имя не может быть длиннее 50 символов', 'warning');
            input.focus();
            return;
        }

        // Проверка запрещенных символов
        const forbiddenChars = ['/', '\\', '<', '>', ':', '"', '|', '?', '*'];
        const hasForbidden = forbiddenChars.some(char => name.includes(char));

        if (hasForbidden) {
            NotificationUI.toast(`Имя не может содержать символы: ${forbiddenChars.join(', ')}`, 'warning');
            input.focus();
            return;
        }

        const legalLoaded = await ensureLegalDocumentsLoaded();
        if (!legalLoaded) {
            NotificationUI.toast('Не удалось загрузить документы для согласия', 'error');
            return;
        }

        const consent = collectConsent('newProfileAcceptTerms', 'newProfileAcceptPrivacy');
        if (!consent.accepted) {
            NotificationUI.toast('Подтвердите согласие с условиями и политикой приватности', 'warning');
            return;
        }

        const { ok, data } = await apiFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, consent })
        });

        if (ok) {
            input.value = '';
            await selectProfile(data.user.user_id);
        } else {
            // Показать ошибку пользователю
            const errorMessage = data.message || data.error || 'Не удалось создать профиль';
            NotificationUI.toast(errorMessage, 'error');
            input.focus();
        }
    }

    window.selectProfile = async function (userId) {
        const consentOk = await ensureUserConsent(userId);
        if (!consentOk) return;

        // Logic handled in wrapper below, this is raw call
        const { ok, data } = await apiFetch('/api/users/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });

        if (ok) {
            if (typeof window.closeProfileMenu === 'function') {
                window.closeProfileMenu();
            }
            closeModal('profileModal');

            if (typeof NotificationUI !== 'undefined') {
                NotificationUI.toast('Профиль переключён', 'success', 1500);
            }
            setTimeout(() => window.location.reload(), 400);
            return;
        }

        const errorMessage = data?.message || data?.error || 'Не удалось переключить профиль';
        NotificationUI.toast(errorMessage, 'error');
    }

    // --- Profile Editing & Passwords ---
    let passwordPromptResolve = null;
    let passwordPromptUserId = null;
    let editingUserId = null;
    let isAvatarManualMode = false; // legacy flag, manual mode disabled

    window.selectGalleryAvatar = function (filename) {
        document.getElementById('editAvatarSeed').value = filename;
        updateEditAvatarPreview();
        updateGallerySelection(filename);
    }

    function updateGallerySelection(filename) {
        document.querySelectorAll('.avatar-gallery-item').forEach(item => {
            const isSelected = item.getAttribute('data-filename') === filename;
            item.classList.toggle('ring-4', isSelected);
            item.classList.toggle('ring-primary', isSelected);
            item.classList.toggle('scale-90', isSelected);
        });
    }

    window.openEditProfile = async function (userId) {
        const { ok, data } = await apiFetch(`/api/users/current`);

        const { data: usersData } = await apiFetch('/api/users');
        const user = usersData.items.find(u => u.user_id === userId);
        if (!user) return;

        // Check if edit is protected
        if (user.has_password && user.security_settings?.require_password_on_edit) {
            passwordPromptUserId = userId;
            const verified = await showPasswordPrompt(`Защита настроек: ${user.name}`);
            if (!verified) return;
        }

        editingUserId = userId;
        document.getElementById('editName').value = user.name;
        document.getElementById('editAvatarSeed').value = user.avatar_seed || user.user_id;
        document.getElementById('editPassword').value = '';
        document.getElementById('requirePassLogin').checked = !!user.security_settings?.require_password_on_login;
        document.getElementById('requirePassEdit').checked = !!user.security_settings?.require_password_on_edit;
        // Force gallery mode (manual seed disabled)
        isAvatarManualMode = false;
        document.getElementById('avatarGallery').classList.remove('hidden');
        await loadAvatarGallery();
        updateEditAvatarPreview();
        openModal('editProfileModal');
    }

    async function loadAvatarGallery() {
        const gallery = document.getElementById('avatarGallery');
        const { ok, data } = await apiFetch('/api/assets/avatars');
        const files = data ? data.files : [];
        const currentSeed = document.getElementById('editAvatarSeed').value;
        let html = '';

        if (ok && files) {
            // Filter out manual-seed avatars if any (filename startswith 'manual_' for safety)
            const safeFiles = files.filter(f => !f.startsWith('manual_'));
            html += safeFiles.map(file => {
                const fileLiteral = escapeInlineJsString(file);
                const fileAttr = escapeHtml(file);
                const fileUrl = encodeURIComponent(String(file));
                return `
                <div class="avatar-gallery-item aspect-square rounded-xl bg-surface-2 cursor-pointer overflow-hidden border border-transparent hover:border-primary transition-all"
                onclick="selectGalleryAvatar('${fileLiteral}')" data-filename="${fileAttr}">
                    <img src="/api/assets/avatars/${fileUrl}" class="w-full h-full object-cover">
                </div>
            `;
            }).join('');
        }

        if (!html) {
            html = `<div class="col-span-4 text-center text-[11px] text-text-muted py-4">Нет загруженных аватаров</div>`;
        }

        gallery.innerHTML = html;
        updateGallerySelection(currentSeed);
    }

    window.updateEditAvatarPreview = function () {
        const seed = document.getElementById('editAvatarSeed').value || editingUserId;
        document.getElementById('editAvatarPreview').src = getAvatarUrl(seed, editingUserId);
    }

    window.confirmDeleteProfile = async function () {
        if (!editingUserId) return;
        const firstCheck = await NotificationUI.confirm({
            title: 'Удалить профиль?',
            message: 'Вся статистика и прогресс будут безвозвратно удалены.',
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            variant: 'error'
        });
        if (!firstCheck) return;
        const secondCheck = await NotificationUI.confirm({
            title: 'Последнее предупреждение',
            message: 'Это действие нельзя отменить. Профиль будет удалён навсегда.',
            confirmText: 'Да, удалить',
            cancelText: 'Отмена',
            variant: 'error'
        });
        if (!secondCheck) return;

        // Final check: if user has password, require it
        const { data: usersData } = await apiFetch('/api/users');
        const user = usersData.items.find(u => u.user_id === editingUserId);
        let verificationPassword = null;

        if (user && user.has_password) {
            passwordPromptUserId = editingUserId;
            const verified = await showPasswordPrompt(`Подтверждение удаления: ${user.name}`);
            if (!verified) return;
            verificationPassword = verified;
        }

        const { ok } = await apiFetch('/api/users/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: editingUserId, verification_password: verificationPassword })
        });

        if (ok) {
            NotificationUI.toast('Профиль успешно удалён', 'success');
            closeModal('editProfileModal');
            window.location.reload();
        }
    }

    window.saveProfileChanges = async function () {
        const payload = {
            user_id: editingUserId,
            name: document.getElementById('editName').value,
            avatar_seed: document.getElementById('editAvatarSeed').value,
            password: document.getElementById('editPassword').value,
            security_settings: {
                require_password_on_login: document.getElementById('requirePassLogin').checked,
                require_password_on_edit: document.getElementById('requirePassEdit').checked
            }
        };

        const { ok, data } = await apiFetch('/api/users/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (ok) {
            closeModal('editProfileModal');
            if (editingUserId === currentUser.user_id) window.location.reload();
            else await loadProfilesList();
        } else {
            // Error handling with user-friendly messages
            let errorMsg = 'Ошибка сохранения профиля';
            if (data.error === 'invalid_name_length') {
                errorMsg = 'Имя должно содержать от 2 до 50 символов';
            } else if (data.error === 'invalid_name_chars') {
                errorMsg = 'Имя содержит недопустимые символы (/, \\, <, >, :, ", |, ?, *)';
            } else if (data.message) {
                errorMsg = data.message;
            }
            NotificationUI.toast(errorMsg, 'error');
        }
    }

    async function showPasswordPrompt(title = "Вход в профиль") {
        document.getElementById('passPromptTitle').textContent = title;
        document.getElementById('promptPasswordInput').value = '';
        openModal('passwordPromptModal');
        document.getElementById('promptPasswordInput').focus();

        return new Promise(resolve => {
            passwordPromptResolve = resolve;
        });
    }

    window.submitPasswordPrompt = async function () {
        const password = document.getElementById('promptPasswordInput').value;

        // We need to verify this password.
        if (passwordPromptResolve) {
            if (!passwordPromptUserId) {
                NotificationUI.toast('Не определён профиль для проверки пароля', 'error');
                return;
            }
            const { ok, data } = await apiFetch('/api/users/verify-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: passwordPromptUserId, password })
            });

            if (ok && data?.verified) {
                const resolver = passwordPromptResolve;
                cleanupPrompt();
                if (resolver) resolver(password);
            } else {
                NotificationUI.toast('Неверный пароль', 'error');
                document.getElementById('promptPasswordInput').value = '';
            }
        }
    }

    const originalSelectProfile = window.selectProfile;

    window.selectProfile = async function (userId) {
        const usersResp = await apiFetch('/api/users');
        const users = Array.isArray(usersResp.data?.items) ? usersResp.data.items : null;
        if (!usersResp.ok || !users) {
            NotificationUI.toast('Не удалось загрузить список профилей', 'error');
            return;
        }
        const user = users.find(u => u.user_id === userId);

        if (user && user.has_password && user.security_settings?.require_password_on_login) {
            passwordPromptUserId = userId;
            const verified = await showPasswordPrompt(`Вход в профиль: ${user.name}`);
            if (verified) return originalSelectProfile(userId);
            return;
        }

        return originalSelectProfile(userId);
    }

    window.closePasswordPrompt = function () {
        const resolver = passwordPromptResolve;
        cleanupPrompt();
        if (resolver) resolver(false);
    }

    function cleanupPrompt() {
        closeModal('passwordPromptModal');
        passwordPromptResolve = null;
        passwordPromptUserId = null;
    }

    // --- Statistics & Calendar ---
    let currentStatsPeriod = 30; // Default
    let hasLoadedStatisticsOnce = false;
    let isStatsPeriodSwitching = false;
    let statsCardResizeRaf = null;
    let userSettingsLoaded = false;
    let isInitialThemeLoad = true;

    async function fetchMainUserSettings() {
        if (window.OnboardingTour && typeof window.OnboardingTour.getSettings === 'function') {
            const settings = await window.OnboardingTour.getSettings();
            return { ok: true, settings };
        }

        const { ok, data } = await apiFetch('/api/ui/settings');
        return { ok, settings: data?.settings };
    }

    async function loadUserSettings() {
        try {
            const { ok, settings } = await fetchMainUserSettings();
            if (ok && settings) {

                // 1. Stats Period
                if (settings.stats_period) {
                    currentStatsPeriod = parseInt(settings.stats_period);
                }

                // 2. Theme Persistence
                if (settings.theme && window.ThemeManager) {
                    const currentTheme = window.ThemeManager.getTheme();
                    if (currentTheme !== settings.theme) {
                        console.log('[MainLogic] Restoring theme from backend:', settings.theme);
                        isInitialThemeLoad = true;
                        window.ThemeManager.setTheme(settings.theme);
                    }
                }
            }
        } catch (e) {
            console.error("Failed to load user settings", e);
        }

        // After initial settings are applied (or failed), future changes should sync
        setTimeout(() => { isInitialThemeLoad = false; }, 800);

        userSettingsLoaded = true;
        updatePeriodButtons();
    }

    function updatePeriodButtons() {
        [1, 7, 30, 0].forEach(d => {
            const btn = document.getElementById(`btnPeriod${d}`);
            if (btn) {
                btn.type = 'button';
                btn.className = "main-period-toggle__button segmented-control__button";
                btn.classList.toggle('is-active', currentStatsPeriod === d);
                btn.disabled = isStatsPeriodSwitching;
                btn.setAttribute('aria-pressed', currentStatsPeriod === d ? 'true' : 'false');
            }
        });
    }

    function setStatsTransitionState(isLoading) {
        isStatsPeriodSwitching = !!isLoading;
        const statsCard = document.getElementById('statsCard');
        const statsContent = document.getElementById('statsContent');
        if (statsCard) {
            statsCard.classList.toggle('stats-card--busy', !!isLoading);
        }
        if (statsContent) {
            statsContent.classList.toggle('stats-content--switching', !!isLoading);
            statsContent.setAttribute('aria-busy', isLoading ? 'true' : 'false');
        }
        updatePeriodButtons();
    }

    function animateStatsContentIn() {
        return;
    }

    function getStatsCardNaturalHeight() {
        const statsCard = document.getElementById('statsCard');
        if (!statsCard) return 0;
        const previousHeight = statsCard.style.height;
        const previousOverflow = statsCard.style.overflow;
        const previousTransition = statsCard.style.transition;

        statsCard.style.transition = 'none';
        statsCard.style.height = '';
        statsCard.style.overflow = '';
        const naturalHeight = Math.max(1, Math.ceil(statsCard.scrollHeight || statsCard.offsetHeight || 0));

        statsCard.style.height = previousHeight;
        statsCard.style.overflow = previousOverflow;
        statsCard.style.transition = previousTransition;

        return naturalHeight;
    }

    function animateStatsCardHeight(startHeight, targetHeight, duration, easing) {
        const statsCard = document.getElementById('statsCard');
        if (!statsCard) return;

        if (statsCard.__statsHeightCleanupTimer) {
            clearTimeout(statsCard.__statsHeightCleanupTimer);
            statsCard.__statsHeightCleanupTimer = null;
        }

        statsCard.style.transition = 'none';
        statsCard.style.height = `${startHeight}px`;
        statsCard.style.overflow = 'hidden';
        void statsCard.offsetWidth;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                statsCard.style.transition = `height ${duration}ms ${easing}`;
                statsCard.style.height = `${targetHeight}px`;

                statsCard.__statsHeightCleanupTimer = setTimeout(() => {
                    const settledHeight = getStatsCardNaturalHeight();
                    statsCard.style.transition = 'none';
                    statsCard.style.height = `${settledHeight}px`;
                    statsCard.style.overflow = 'hidden';
                    requestAnimationFrame(() => {
                        statsCard.style.transition = '';
                        statsCard.__statsHeightCleanupTimer = null;
                    });
                }, duration + 30);
            });
        });
    }

    function syncStatsCardHeightToContent() {
        const statsCard = document.getElementById('statsCard');
        if (!statsCard || isStatsPeriodSwitching) return;
        const targetHeight = getStatsCardNaturalHeight();
        if (!targetHeight) return;
        statsCard.style.transition = 'none';
        statsCard.style.height = `${targetHeight}px`;
        statsCard.style.overflow = 'hidden';
        requestAnimationFrame(() => {
            statsCard.style.transition = '';
        });
    }

    function scheduleStatsCardHeightSync() {
        if (statsCardResizeRaf) {
            cancelAnimationFrame(statsCardResizeRaf);
        }
        statsCardResizeRaf = requestAnimationFrame(() => {
            statsCardResizeRaf = null;
            syncStatsCardHeightToContent();
        });
    }

    function pinStatsCardHeight() {
        const statsCard = document.getElementById('statsCard');
        if (!statsCard) return;
        if (statsCard.__statsHeightCleanupTimer) {
            clearTimeout(statsCard.__statsHeightCleanupTimer);
            statsCard.__statsHeightCleanupTimer = null;
        }
        const currentHeight = statsCard.getBoundingClientRect().height;
        if (currentHeight > 0) {
            statsCard.style.transition = 'none';
            statsCard.style.height = `${Math.ceil(currentHeight)}px`;
            statsCard.style.overflow = 'hidden';
        }
    }

    function releaseStatsCardHeight() {
        const statsCard = document.getElementById('statsCard');
        if (!statsCard) return;
        const startHeight = Math.max(1, Math.ceil(parseFloat(statsCard.style.height) || statsCard.offsetHeight || 0));
        if (!startHeight) return;

        const targetHeight = getStatsCardNaturalHeight();
        if (Math.abs(startHeight - targetHeight) <= 1) {
            requestAnimationFrame(() => {
                statsCard.style.transition = '';
                statsCard.style.height = `${targetHeight}px`;
                statsCard.style.overflow = 'hidden';
            });
            return;
        }

        const shrinking = targetHeight < startHeight;
        const duration = shrinking ? 340 : 220;
        const easing = shrinking
            ? 'cubic-bezier(0.22, 1, 0.36, 1)'
            : 'cubic-bezier(0.4, 0, 0.2, 1)';
        animateStatsCardHeight(startHeight, targetHeight, duration, easing);
    }

    window.selectStatsPeriod = async function (eventOrDays, maybeDays, maybeBtn) {
        let days = eventOrDays;
        const forwardedEvent = typeof eventOrDays !== 'number'
            ? eventOrDays
            : (typeof window !== 'undefined' ? window.event : null);

        if (forwardedEvent?.preventDefault) forwardedEvent.preventDefault();
        if (forwardedEvent?.stopPropagation) forwardedEvent.stopPropagation();
        if (forwardedEvent?.stopImmediatePropagation) forwardedEvent.stopImmediatePropagation();

        if (typeof eventOrDays !== 'number') {
            days = maybeDays;
        }

        if (days === currentStatsPeriod || isStatsPeriodSwitching) return;
        currentStatsPeriod = days;
        setStatsTransitionState(true);

        // RACE CONDITION FIX (7.4): Отменяем предыдущий запрос перед новым
        if (statsLoadAbortController) {
            statsLoadAbortController.abort();
        }

        // Save preference
        apiFetch('/api/ui/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { stats_period: days } })
        });
        try {
            await loadStatistics();
        } finally {
            setStatsTransitionState(false);
        }
    }

    async function loadStatistics() {
        const statsContent = document.getElementById('statsContent');
        const isFirstLoad = !hasLoadedStatisticsOnce;

        if (isFirstLoad) {
            showStatsSkeleton();
        } else {
            pinStatsCardHeight();
        }

        updatePeriodButtons();

        // RACE CONDITION FIX (7.4): Создаем новый AbortController для отслеживания этого запроса
        statsLoadAbortController = new AbortController();

        const { ok, data, cancelled } = await apiFetch(`/api/statistics/overall?days=${currentStatsPeriod}`, {
            signal: statsLoadAbortController.signal
        });

        // Если запрос был отменен, выходим без обновления
        if (cancelled) {
            releaseStatsCardHeight();
            return;
        }

        if (ok) {
            const s = data.stats;
            const statComplexesLabel = document.getElementById('statComplexesLabel');
            const completedComplexesMetric = currentStatsPeriod === 1
                ? (s.completed_complexes_today || 0)
                : (s.completed_complexes_period || 0);

            // Update values
            document.getElementById('statSolvedTasks').textContent = s.tasks_mastered || 0;
            document.getElementById('statTotalAvailable').textContent = s.total_tasks_available || 0;
            document.getElementById('statSuccessRate').textContent = `${Math.round((s.success_rate || 0) * 100)}%`;
            if (statComplexesLabel) {
                statComplexesLabel.textContent = currentStatsPeriod === 1
                    ? 'Комплексов сегодня'
                    : 'Комплексов пройдено';
            }
            document.getElementById('statTodayCount').textContent = completedComplexesMetric;

            const combinedSeconds = (s.learning_sources && s.learning_sources.combined)
                ? (s.learning_sources.combined.time_spent_seconds || 0)
                : (s.total_time_spent || 0);
            const mins = Math.round(combinedSeconds / 60);
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            document.getElementById('statTimeSpent').textContent = `${h}ч ${m}м`;

            // UX-30: Show welcome message if all stats are zero
            const isEmpty = !(s.tasks_mastered || s.success_rate || s.total_time_spent || completedComplexesMetric);
            setMainRecommendationState({ statsEmpty: isEmpty });
            let welcomeEl = document.getElementById('statsWelcomeMessage');
            if (isEmpty) {
                if (!welcomeEl && statsContent) {
                    welcomeEl = document.createElement('div');
                    welcomeEl.id = 'statsWelcomeMessage';
                    welcomeEl.className = 'p-3 bg-primary-lighter/40 border border-primary-light rounded-lg text-center mb-2';
                    welcomeEl.innerHTML = '<p class="text-sm font-medium text-primary-dark">Запустите первый комплекс: после него здесь появятся прогресс, время и ежедневная динамика.</p>';
                    statsContent.prepend(welcomeEl);
                }
            } else if (welcomeEl) {
                welcomeEl.remove();
                welcomeEl = null;
            }

            const statRows = statsContent ? Array.from(statsContent.querySelectorAll('.main-stats-row')) : [];
            if (isEmpty && statsContent && welcomeEl) {
                const emptyCopy = currentStatsPeriod === 1
                    ? 'Сегодня активности пока нет.'
                    : 'Запустите первый комплекс, и здесь появится прогресс.';
                welcomeEl.className = 'main-stats-empty-state';
                welcomeEl.innerHTML = `
                    <span class="material-symbols-outlined main-stats-empty-state__icon">bar_chart</span>
                    <div class="main-stats-empty-state__copy">
                        <p class="main-stats-empty-state__title">Статистика появится после первой активности</p>
                        <p class="main-stats-empty-state__text">${emptyCopy}</p>
                    </div>
                `;
                statsContent.prepend(welcomeEl);
                statsContent.classList.add('stats-content--empty');
                statsContent.classList.remove('stats-content--error');
                statRows.forEach((row) => row.classList.add('hidden'));
            } else {
                if (statsContent) {
                    statsContent.classList.remove('stats-content--empty');
                    statsContent.classList.remove('stats-content--error');
                }
                statRows.forEach((row) => row.classList.remove('hidden'));
            }

            // Hide skeleton and error, show content
            hideStatsSkeleton();
            hideStatsError();
            hasLoadedStatisticsOnce = true;
            releaseStatsCardHeight();
            animateStatsContentIn();
        } else {
            console.error('Failed to load statistics:', data);
            setMainRecommendationState({ statsEmpty: null });
            hideStatsSkeleton();
            showStatsError();
            hasLoadedStatisticsOnce = true;
            releaseStatsCardHeight();
            animateStatsContentIn();
        }
    }

    window.addEventListener('resize', scheduleStatsCardHeightSync);

    // --- Statistics Helper Functions ---
    function showStatsSkeleton() {
        const skeleton = document.getElementById('statsSkeleton');
        const content = document.getElementById('statsContent');
        if (skeleton) skeleton.classList.remove('hidden');
        if (content) content.classList.add('hidden');
    }

    function hideStatsSkeleton() {
        const skeleton = document.getElementById('statsSkeleton');
        const content = document.getElementById('statsContent');
        if (skeleton) skeleton.classList.add('hidden');
        if (content) content.classList.remove('hidden');
    }

    function showStatsError() {
        const statsContent = document.getElementById('statsContent');
        if (!statsContent) return;
        const welcomeEl = document.getElementById('statsWelcomeMessage');
        if (welcomeEl) welcomeEl.remove();
        statsContent.classList.remove('stats-content--empty');
        statsContent.querySelectorAll('.main-stats-row').forEach((row) => row.classList.add('hidden'));
        // Check if error message already exists
        let errorEl = document.getElementById('statsErrorMessage');

        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.id = 'statsErrorMessage';
            errorEl.className = 'main-stats-error-state';
            errorEl.innerHTML = `<div class="flex flex-col gap-2"><span class="material-symbols-outlined text-status-error text-[24px]">error</span><p class="text-sm font-semibold text-text-main">Статистика временно недоступна</p><p class="text-xs text-text-secondary">Ваш прогресс не потерян. Попробуйте загрузить блок ещё раз.</p><button onclick="retryLoadStatistics()" class="text-xs font-medium text-status-error hover:text-text-main underline">Загрузить снова</button></div>`;
            statsContent.prepend(errorEl);
        }

        // Keep the card height stable by rendering the error inside the content area
        statsContent.classList.add('stats-content--error');
        errorEl.classList.remove('hidden');
    }

    function hideStatsError() {
        const errorEl = document.getElementById('statsErrorMessage');
        const statsContent = document.getElementById('statsContent');
        if (errorEl) errorEl.classList.add('hidden');
        if (statsContent) statsContent.classList.remove('stats-content--error');
    }

    window.retryLoadStatistics = async function () {
        await loadStatistics();
    }

    function initEscKeyHandler() {
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            const modals = [
                'mainConsentGateModal',
                'mainLegalDocModal',
                'feedbackModal',
                'passwordPromptModal',
                'editProfileModal',
                'profileModal',
                'devModal'
            ];
            for (const id of modals) {
                const el = document.getElementById(id);
                if (el && el.classList.contains('open')) {
                    if (id === 'mainConsentGateModal' && typeof window.cancelMainConsentGate === 'function') {
                        window.cancelMainConsentGate();
                    } else if (id === 'mainLegalDocModal' && typeof window.closeMainLegalDocument === 'function') {
                        window.closeMainLegalDocument();
                    } else if (id === 'feedbackModal' && typeof window.closeFeedbackModal === 'function') {
                        window.closeFeedbackModal();
                    } else if (id === 'passwordPromptModal' && typeof closePasswordPrompt === 'function') {
                        closePasswordPrompt();
                    } else {
                        closeModal(id);
                    }
                    break;
                }
            }
        });
    }

    // --- Microcards Widget (M9) ---
    function setMicrocardsCardInteractive(enabled) {
        const cardEl = document.getElementById('microcardsCard');
        if (!cardEl) return;
        cardEl.removeAttribute('role');
        cardEl.removeAttribute('tabindex');
        cardEl.removeAttribute('data-nav');
        cardEl.classList.remove('interactive-card', 'cursor-pointer', 'hover:border-primary');
        if (!enabled) return;
        cardEl.setAttribute('role', 'link');
        cardEl.setAttribute('tabindex', '0');
        cardEl.setAttribute('data-nav', '/ui/microcards');
        cardEl.classList.add('interactive-card', 'cursor-pointer', 'hover:border-primary');
    }

    async function loadMicrocardsWidget() {
        const loadingState = document.getElementById('microcardsLoadingState');
        const emptyState = document.getElementById('microcardsEmptyState');
        const contentState = document.getElementById('microcardsContentState');
        const disabledState = document.getElementById('microcardsDisabledState');
        const cardEl = document.getElementById('microcardsCard');
        const ctaEl = document.getElementById('microcardsCTA');
        const dueBadgeEl = document.getElementById('microcardsDueBadge');
        const secondaryCtaEl = cardEl ? cardEl.querySelector('.main-secondary-cta') : null;

        if (!cardEl) return;

        setMicrocardsCardInteractive(false);
        if (dueBadgeEl) dueBadgeEl.hidden = true;
        if (ctaEl) ctaEl.disabled = true;
        if (secondaryCtaEl) secondaryCtaEl.disabled = true;

        const { ok, data } = await apiFetch('/api/microcards/summary');
        if (loadingState) loadingState.classList.add('hidden');

        if (!ok) {
            const isDisabled = data && (data.error === 'microcards_mode_disabled' || data.error === 'guest_cannot_use_microcards');
            if (isDisabled) {
                setMainRecommendationState({ microcardsDisabled: true, microcardsHasDecks: false, microcardsDue: 0 });
                if (disabledState) disabledState.classList.remove('hidden');
                if (emptyState) emptyState.classList.add('hidden');
                if (contentState) contentState.classList.add('hidden');
                if (ctaEl) ctaEl.disabled = true;
                const dueBadgeCount = document.getElementById('microcardsDueCount');
                const ctaText = document.getElementById('microcardsCTAText');
                const ctaIcon = document.getElementById('microcardsCTAIcon');
                const secondaryIcon = secondaryCtaEl?.querySelector('.material-symbols-outlined');
                const secondaryText = secondaryCtaEl?.querySelector('span:last-child');
                if (dueBadgeCount) dueBadgeCount.textContent = '—';
                if (ctaText) ctaText.textContent = 'Функционал в разработке';
                if (ctaIcon) ctaIcon.textContent = 'construction';
                if (secondaryIcon) secondaryIcon.textContent = 'schedule';
                if (secondaryText) secondaryText.textContent = 'Скоро вернём';
            } else {
                setMainRecommendationState({ microcardsDisabled: false, microcardsHasDecks: false, microcardsDue: 0 });
                if (dueBadgeEl) dueBadgeEl.hidden = true;
                if (disabledState) disabledState.classList.add('hidden');
                if (emptyState) {
                    emptyState.classList.remove('hidden');
                    const titleEl = emptyState.querySelector('p.text-sm');
                    const descEl = emptyState.querySelector('p.text-\\[10px\\]');
                    if (titleEl) titleEl.textContent = 'Сводка временно недоступна';
                    if (descEl) descEl.textContent = 'Открыть режим можно позже: сама карточка никуда не исчезнет.';
                }
            }
            return;
        }

        const queue = data.queue_summary || {};
        const today = data.today || {};
        const totals = data.totals || {};
        const dueTotal = queue.cards_due_total || 0;
        const newTotal = queue.cards_new_total || 0;
        const decksActive = totals.decks_active || 0;
        const todayReviews = today.reviews || 0;
        const todayCorrectRate = today.correct_rate;

        const hasDecks = decksActive > 0 || dueTotal > 0 || newTotal > 0 || todayReviews > 0 || (totals.reviews || 0) > 0;

        if (!hasDecks) {
            setMainRecommendationState({ microcardsDisabled: false, microcardsHasDecks: false, microcardsDue: 0 });
            if (dueBadgeEl) dueBadgeEl.hidden = true;
            if (disabledState) disabledState.classList.add('hidden');
            if (emptyState) emptyState.classList.remove('hidden');
            if (secondaryCtaEl) secondaryCtaEl.disabled = false;
            if (emptyState) {
                const titleEl = emptyState.querySelector('p.text-sm');
                const descEl = emptyState.querySelector('p.text-\\[10px\\]');
                if (titleEl) titleEl.textContent = 'Пока нет колод';
                if (descEl) descEl.textContent = 'Когда появятся колоды, здесь будет самый быстрый вход в повторение.';
            }
            if (contentState) contentState.classList.add('hidden');
            return;
        }

        setMainRecommendationState({ microcardsDisabled: false, microcardsHasDecks: true, microcardsDue: dueTotal });
        setMicrocardsCardInteractive(true);
        if (disabledState) disabledState.classList.add('hidden');
        if (emptyState) emptyState.classList.add('hidden');
        if (contentState) {
            contentState.classList.remove('hidden');
            contentState.classList.add('flex');
        }
        if (ctaEl) ctaEl.disabled = false;
        if (secondaryCtaEl) secondaryCtaEl.disabled = false;
        if (dueBadgeEl) dueBadgeEl.hidden = false;

        // Due badge in header
        const dueBadgeCount = document.getElementById('microcardsDueCount');
        if (dueBadgeCount) dueBadgeCount.textContent = dueTotal > 0 ? String(dueTotal) : '0';

        // Queue metrics
        const dueEl = document.getElementById('microcardsDueCards');
        const newEl = document.getElementById('microcardsNewCards');
        if (dueEl) dueEl.textContent = String(dueTotal);
        if (newEl) newEl.textContent = String(newTotal);

        // Today's reviews
        const todayEl = document.getElementById('microcardsTodayReviews');
        if (todayEl) {
            const word = _pluralizeReviews(todayReviews);
            todayEl.textContent = `${todayReviews} ${word}`;
        }

        // Today accuracy
        const accuracyEl = document.getElementById('microcardsTodayAccuracy');
        if (accuracyEl) {
            if (todayReviews > 0 && todayCorrectRate != null) {
                accuracyEl.textContent = `${Math.round(todayCorrectRate * 100)}%`;
            } else {
                accuracyEl.textContent = '';
            }
        }

        // CTA text
        const ctaText = document.getElementById('microcardsCTAText');
        const ctaIcon = document.getElementById('microcardsCTAIcon');
        if (ctaText && ctaIcon) {
            if (dueTotal > 0) {
                ctaText.textContent = 'Продолжить повторение';
                ctaIcon.textContent = 'play_arrow';
            } else {
                ctaText.textContent = 'Открыть микрокарточки';
                ctaIcon.textContent = 'arrow_forward';
            }
        }
    }

    function _pluralizeReviews(n) {
        const abs = Math.abs(n) % 100;
        const lastDigit = abs % 10;
        if (abs > 10 && abs < 20) return 'повторений';
        if (lastDigit > 1 && lastDigit < 5) return 'повторения';
        if (lastDigit === 1) return 'повторение';
        return 'повторений';
    }

    // --- Calendar Widget (enhanced) ---
    async function loadCalendarWidget() {
        const loadingState = document.getElementById('calendarLoadingState');
        const emptyState = document.getElementById('calendarEmptyState');
        const contentState = document.getElementById('calendarContentState');
        const streakEl = document.getElementById('calendarStreakDays');

        const [
            { ok, data },
            { ok: statsOk, data: statsData },
        ] = await Promise.all([
            apiFetch('/api/calendar/today'),
            apiFetch('/api/statistics/time-dynamics?days=14'),
        ]);
        if (loadingState) loadingState.classList.add('hidden');
        let hasData = false;
        let streakDays = 0;
        let mixCount = 0;
        let mixMinutes = 0;

        if (ok && data) {
            streakDays = data.streak_info?.days || 0;
            const dailyPlan = data.daily_plan || {};
            mixCount = dailyPlan.daily_mix_count || dailyPlan.daily_mix?.length || 0;
            mixMinutes = dailyPlan.daily_mix_estimated_minutes || dailyPlan.daily_mix_minutes || 0;
            hasData = mixCount > 0 || streakDays > 0;
        }

        // WEAK-1 fix: only fetch time-dynamics for heatmap (removed duplicate /api/statistics/overall)
        const hasActivity = statsOk && statsData?.dynamics?.some(d => {
            const taskAttempts = d?.total_attempts ?? d?.tasks_attempted ?? d?.attempts ?? 0;
            const studyMinutes = d?.combined_study_minutes ?? d?.study_minutes ?? 0;
            return taskAttempts > 0
                || (d?.microcards_reviews > 0)
                || (d?.activity_attempts_total > 0)
                || (d?.completed_complexes > 0)
                || studyMinutes > 0;
        });
        const criticalHealth = (data?.health_summary?.complexes || []).filter(c => c.health_percent < 80).length > 0;
        hasData = hasData || hasActivity || criticalHealth;
        setMainRecommendationState({ calendarHasData: hasData, calendarMixCount: mixCount });

        // Update streak badge
        if (streakEl) {
            streakEl.textContent = streakDays > 0 ? streakDays : '0';
        }

        if (!hasData) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (emptyState) {
                const textNodes = emptyState.querySelectorAll('p');
                if (textNodes[0]) textNodes[0].textContent = 'Начните с первого учебного шага';
                if (textNodes[1]) textNodes[1].textContent = 'После первого комплекса или повторения здесь появится ваш план на день.';
            }
            if (contentState) contentState.classList.add('hidden');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');
        if (contentState) {
            contentState.classList.remove('hidden');
            contentState.classList.add('flex');
        }

        // Update Daily Mix
        const countEl = document.getElementById('calendarDailyMixCount');
        const timeEl = document.getElementById('calendarDailyMixTime');

        if (mixCount === 0) {
            if (countEl) countEl.innerHTML = '<span class="text-sm font-semibold text-text-secondary">Нет задач</span>';
            if (timeEl) timeEl.parentElement.classList.add('hidden');
        } else {
            if (countEl) countEl.innerHTML = `<span class="text-3xl font-black text-text-main">${mixCount}</span><span class="ml-1 text-sm font-bold text-text-secondary">задач</span>`;
            if (timeEl) {
                timeEl.parentElement.classList.remove('hidden');
                timeEl.textContent = `~${mixMinutes} мин`;
            }
        }

        // Render mini heatmap
        if (statsOk && statsData?.dynamics) {
            renderMiniHeatmap(statsData.dynamics);
        }

        // Render health summary
        renderHealthSummary(ok ? data?.health_summary : null);
    }

    function calculateMiniHeatmapScore(day) {
        const taskAttempts = day?.task_attempts ?? 0;
        const microcardsReviews = day?.microcards_reviews ?? 0;
        const completedComplexes = day?.completed_complexes ?? 0;
        const studyMinutes = day?.study_minutes ?? 0;

        return (taskAttempts * 1.0)
            + (microcardsReviews * 0.35)
            + (completedComplexes * 8.0)
            + (studyMinutes * 0.2);
    }

    function resolveMiniHeatmapLevel(score) {
        if (score <= 0) return 'empty';
        if (score >= 40) return 'peak';
        if (score >= 20) return 'high';
        if (score >= 8) return 'mid';
        return 'low';
    }

    function describeMiniHeatmapLevel(level) {
        switch (level) {
            case 'peak': return 'Пиковый день';
            case 'high': return 'Сильная активность';
            case 'mid': return 'Хорошая активность';
            case 'low': return 'Небольшая активность';
            default: return 'Нет активности';
        }
    }

    function ensureMiniHeatmapLegend(container) {
        if (!container) return;
        const parent = container.parentElement;
        if (!parent) return;

        let legend = parent.querySelector('.main-heatmap-legend');
        if (!legend) {
            legend = document.createElement('div');
            legend.className = 'main-heatmap-legend';
            container.insertAdjacentElement('afterend', legend);
        }

        legend.innerHTML = `
            <span class="main-heatmap-legend-copy">Интенсивность за 14 дней</span>
            <div class="main-heatmap-legend-scale" aria-hidden="true">
                <span class="main-heatmap-legend-item"><span class="main-heatmap-legend-swatch" data-level="empty"></span>0</span>
                <span class="main-heatmap-legend-item"><span class="main-heatmap-legend-swatch" data-level="low"></span>Низко</span>
                <span class="main-heatmap-legend-item"><span class="main-heatmap-legend-swatch" data-level="mid"></span>Нормально</span>
                <span class="main-heatmap-legend-item"><span class="main-heatmap-legend-swatch" data-level="high"></span>Сильно</span>
                <span class="main-heatmap-legend-item"><span class="main-heatmap-legend-swatch" data-level="peak"></span>Пик</span>
            </div>
        `;
    }

    function renderMiniHeatmap(dynamics) {
        const container = document.getElementById('calendar-mini-heatmap');
        if (!container) return;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const activityMap = new Map();
        (dynamics || []).forEach(d => activityMap.set(d.date, d));
        const days = [];

        for (let i = 13; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const data = activityMap.get(dateStr);
            const hasMC = (data?.microcards_reviews || 0) > 0;
            const taskAttempts = data?.total_attempts ?? data?.tasks_attempted ?? data?.attempts ?? 0;
            const hasTasks = taskAttempts > 0;
            const completedComplexes = data?.completed_complexes || 0;
            const studyMinutes = data?.combined_study_minutes ?? data?.study_minutes ?? 0;
            const successRate = data?.success_rate ?? null;
            days.push({
                date: dateStr,
                completion_percent: successRate != null ? successRate * 100 : 0,
                task_attempts: taskAttempts,
                microcards_reviews: data?.microcards_reviews || 0,
                completed_complexes: completedComplexes,
                study_minutes: studyMinutes,
                success_rate: successRate,
                has_activity: hasTasks || hasMC || completedComplexes > 0,
                has_microcards: hasMC,
                has_tasks: hasTasks,
                is_today: dateStr === todayStr
            });
        }

        days.forEach(day => {
            day.activity_score = calculateMiniHeatmapScore(day);
            day.level = resolveMiniHeatmapLevel(day.activity_score);
        });

        container.innerHTML = days.map(day => {
            let statusText = 'Нет активности';
            if (day.is_today && !day.has_activity) {
                statusText = 'Сегодня, активности пока нет';
            } else if (day.has_activity) {
                const parts = [describeMiniHeatmapLevel(day.level)];
                if (day.completed_complexes > 0) {
                    parts.push(`Комплексы: ${day.completed_complexes}`);
                }
                if (day.task_attempts > 0) {
                    parts.push(`Попытки: ${day.task_attempts}`);
                }
                if (day.microcards_reviews > 0) {
                    parts.push(`Микрокарточки: ${day.microcards_reviews}`);
                }
                if (day.study_minutes > 0) {
                    parts.push(`Время: ${day.study_minutes} мин`);
                }
                if (day.has_tasks && day.success_rate != null) {
                    parts.push(`Успешность: ${Math.round(day.success_rate * 100)}%`);
                }
                statusText = parts.join('\n');
                if (day.is_today) {
                    statusText = `Сегодня\n${statusText}`;
                }
            } else if (day.is_today) {
                statusText = 'Сегодня';
            }
            const tooltip = `${day.date}\n${statusText}`;
            const todayAttr = day.is_today ? ' data-today="true"' : '';
            const accessibilityAttrs = day.has_activity
                ? ` title="${tooltip}" aria-label="${tooltip}"`
                : ' aria-hidden="true"';
            return `<div class="main-heatmap-cell" data-level="${day.level}"${todayAttr}${accessibilityAttrs}></div>`;
        }).join('');
        ensureMiniHeatmapLegend(container);
    }

    function renderHealthSummary(healthSummary) {
        const container = document.getElementById('calendarHealthList');
        if (!container) return;
        if (!healthSummary) {
            container.innerHTML = '';
            return;
        }
        const complexes = healthSummary.complexes || [];
        if (complexes.length === 0) {
            container.innerHTML = '';
            return;
        }
        const toReview = complexes
            .filter(c => Number(c.health_percent ?? 100) < 80)
            .sort((a, b) => {
                const criticalDelta = Number(Boolean(b.is_critical)) - Number(Boolean(a.is_critical));
                if (criticalDelta !== 0) return criticalDelta;
                return Number(a.health_percent ?? 100) - Number(b.health_percent ?? 100);
            });

        if (toReview.length === 0) {
            container.innerHTML = '<p class="text-[11px] text-text-secondary text-center py-1">Критичных комплексов нет</p>';
            return;
        }

        const primary = toReview[0];
        const extraCount = Math.max(0, toReview.length - 1);
        const extraNames = toReview.slice(1, 6).map(c => c.name).filter(Boolean);
        const tooltipParts = [
            primary.message ? `${primary.hint_title || ''}\n${primary.message}`.trim() : `Здоровье: ${primary.health_percent}%`,
        ];
        if (extraCount > 0) {
            tooltipParts.push(`Ещё к повторению: ${extraNames.join(', ')}${extraCount > extraNames.length ? ` и ещё ${extraCount - extraNames.length}` : ''}`);
        }
        const tooltip = tooltipParts.filter(Boolean).join('\n\n');

        container.innerHTML = `
            <div class="main-health-row panel-row" title="${escapeHtml(tooltip)}">
                <div class="main-health-meta">
                    <div class="w-1.5 h-1.5 rounded-full ${primary.is_critical ? 'bg-status-error' : 'bg-accent'}"></div>
                    <span class="main-health-name">Повторить: ${escapeHtml(primary.name || 'комплекс')}</span>
                </div>
                ${extraCount > 0
                    ? `<span class="main-health-extra" title="${escapeHtml(`Ещё ${extraCount} ${pluralizeComplexes(extraCount)}`)}">+${extraCount}</span>`
                    : `<span class="shrink-0 font-bold ${primary.is_critical ? 'text-status-error' : 'text-accent'}">${escapeHtml(String(primary.health_percent ?? 0))}%</span>`}
            </div>`;
    }

    function pluralizeComplexes(n) {
        const abs = Math.abs(Number(n) || 0) % 100;
        const lastDigit = abs % 10;
        if (abs > 10 && abs < 20) return 'комплексов';
        if (lastDigit > 1 && lastDigit < 5) return 'комплекса';
        if (lastDigit === 1) return 'комплекс';
        return 'комплексов';
    }

    // --- Navigation & Quick Access ---
    function ensureQuickAccessHeader() {
        const section = document.getElementById('quick-access-section');
        const header = section ? section.querySelector('.main-quick-access-header') : null;
        if (!header || header.dataset.enhanced === 'true') return header;

        header.dataset.enhanced = 'true';
        header.innerHTML = `
            <div class="main-quick-access-heading">
                <div class="main-quick-access-heading-icon">
                    <span class="material-symbols-outlined text-[20px]">bolt</span>
                </div>
                <div class="min-w-0">
                    <p class="main-quick-access-kicker">\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c</p>
                    <h3 class="text-base font-bold text-text-main">\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f</h3>
                </div>
            </div>
            <div class="main-quick-access-toolbar">
                <span class="main-quick-access-count" id="quick-access-count" title="Комплексов в быстром доступе">0</span>
                <div class="main-quick-access-nav" id="quick-access-nav" hidden>
                    <button type="button" class="main-quick-access-nav-btn icon-button-muted" id="quick-access-prev" aria-label="Previous complex">
                        <span class="material-symbols-outlined text-[16px]">chevron_left</span>
                    </button>
                    <button type="button" class="main-quick-access-nav-btn icon-button-muted" id="quick-access-next" aria-label="Next complex">
                        <span class="material-symbols-outlined text-[16px]">chevron_right</span>
                    </button>
                </div>
            </div>
        `;
        return header;
    }

    function updateQuickAccessCount(total, previewLimit = 4) {
        const el = document.getElementById('quick-access-count');
        if (!el) return;
        if (!Number.isFinite(total) || total < 0) {
            el.textContent = '\u2014';
            el.title = 'Количество комплексов неизвестно';
            return;
        }
        el.textContent = String(total);
        el.title = total > previewLimit
            ? `Показаны ${Math.min(total, previewLimit)} из ${total}`
            : `Комплексов в быстром доступе: ${total}`;
    }

    function setupQuickAccessRail(totalItems = 0) {
        const list = document.getElementById('quick-access-list');
        const nav = document.getElementById('quick-access-nav');
        const prev = document.getElementById('quick-access-prev');
        const next = document.getElementById('quick-access-next');
        const count = document.getElementById('quick-access-count');
        if (!list) return;

        const useRail = Number(totalItems) > 1;
        list.classList.toggle('main-quick-access-grid--rail', useRail);

        if (!nav || !prev || !next) return;

        nav.hidden = !useRail;
        if (!useRail) {
            list.onscroll = null;
            prev.disabled = true;
            next.disabled = true;
            if (count && Number(totalItems) === 1) {
                count.textContent = '1';
                count.title = 'Комплексов в быстром доступе: 1';
            }
            return;
        }

        const getCurrentIndex = () => {
            const card = list.querySelector('.main-quick-access-card');
            const cardWidth = card ? card.getBoundingClientRect().width : list.clientWidth;
            const gap = parseFloat(getComputedStyle(list).columnGap || getComputedStyle(list).gap || '0') || 0;
            const step = Math.max(1, cardWidth + gap);
            return Math.min(Number(totalItems), Math.max(1, Math.round(list.scrollLeft / step) + 1));
        };

        const updateNavState = () => {
            const maxScrollLeft = Math.max(0, list.scrollWidth - list.clientWidth - 6);
            const currentIndex = getCurrentIndex();
            prev.disabled = list.scrollLeft <= 6;
            next.disabled = list.scrollLeft >= maxScrollLeft;
            if (count) {
                count.textContent = `${currentIndex}/${totalItems}`;
                count.title = `Карточка ${currentIndex} из ${totalItems} в быстром доступе`;
            }
        };

        const scrollStep = (direction) => {
            const card = list.querySelector('.main-quick-access-card');
            const cardWidth = card ? card.getBoundingClientRect().width : list.clientWidth;
            const gap = parseFloat(getComputedStyle(list).columnGap || getComputedStyle(list).gap || '0') || 0;
            const amount = Math.max(1, Math.round(cardWidth + gap));
            list.scrollBy({ left: direction * amount, behavior: 'smooth' });
        };

        prev.onclick = () => scrollStep(-1);
        next.onclick = () => scrollStep(1);
        list.onscroll = updateNavState;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(updateNavState);
        } else {
            updateNavState();
        }
    }

    async function loadQuickAccess() {
        ensureQuickAccessHeader();
        const container = document.getElementById("quick-access-list");
        const emptyEl = document.getElementById("quick-access-empty");
        const quickAccessPreviewLimit = 4;
        if (!container) return;
        const emptyCta = document.getElementById('quick-access-empty-cta');
        const emptyActions = document.getElementById('quick-access-empty-actions');
        const showAllBtn = document.getElementById('quick-access-show-all');
        if (emptyCta) {
            emptyCta.className = 'qa-empty-cta btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-bold';
        }
        const setQuickAccessEmptyVisible = (visible) => {
            container.hidden = !!visible;
            if (emptyEl) emptyEl.hidden = !visible;
        };
        if (emptyCta && emptyActions && emptyCta.parentElement !== emptyActions) {
            emptyActions.appendChild(emptyCta);
        }

        const [{ ok, data }, sessionsResp] = await Promise.all([
            apiFetch(`/api/ui/quick-access?user_id=${encodeURIComponent(currentUser.user_id)}`),
            apiFetch(`/api/sessions/active?user_id=${encodeURIComponent(currentUser.user_id)}`)
        ]);
        const sessions = (sessionsResp && sessionsResp.ok && Array.isArray(sessionsResp.data?.items)) ? sessionsResp.data.items : [];
        const parseSessionTime = (value) => {
            if (!value) return 0;
            const parsed = Date.parse(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const pickPreferredSession = (existing, incoming) => {
            if (!incoming) return existing || null;
            if (!existing) return incoming;
            if (!!incoming.paused !== !!existing.paused) {
                return incoming.paused ? incoming : existing;
            }
            const incomingTs = Math.max(
                parseSessionTime(incoming.paused_at),
                parseSessionTime(incoming.updated_at),
                parseSessionTime(incoming.start_time)
            );
            const existingTs = Math.max(
                parseSessionTime(existing.paused_at),
                parseSessionTime(existing.updated_at),
                parseSessionTime(existing.start_time)
            );
            return incomingTs >= existingTs ? incoming : existing;
        };
        const formatPausedAt = (value) => {
            if (!value) return "";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return "";
            return date.toLocaleString("ru-RU", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            });
        };
        const pausedMap = new Map();
        sessions.forEach(s => {
            if (s && s.complex_id) {
                const existing = pausedMap.get(s.complex_id);
                pausedMap.set(s.complex_id, pickPreferredSession(existing, s));
            }
        });
        setMainRecommendationState({ preferredAction: null });
        const buildQuickAccessRecommendation = (item) => {
            if (!item || !item.complex || !item.complex.id) return null;
            const complexId = item.complex.id;
            const complexName = item.complex.name || 'текущий комплекс';
            const pausedSession = pausedMap.get(complexId) || item.paused_session || null;
            const isPaused = !!(pausedSession && pausedSession.paused);

            if (isPaused && pausedSession.session_id) {
                return {
                    title: 'Вернитесь к сессии на паузе',
                    reason: `Незавершённая сессия по комплексу «${complexName}» уже ждёт вас.`,
                    label: 'Продолжить сессию',
                    icon: 'restart_alt',
                    action: () => window.handleStartSession(
                        complexId,
                        pausedSession.session_id,
                        (pausedSession && pausedSession.resume_target && typeof pausedSession.resume_target.url === 'string')
                            ? pausedSession.resume_target.url
                            : ''
                    ),
                };
            }

            return {
                title: 'Продолжите активный комплекс',
                reason: `Комплекс «${complexName}» уже под рукой — можно продолжить с него.`,
                label: 'Открыть комплекс',
                icon: 'play_arrow',
                action: () => window.handleStartSession(complexId),
            };
        };

        if (!ok) {
            container.innerHTML = `<div class="p-4 text-center"><p class="text-sm text-text-secondary">Не удалось загрузить</p><button onclick="window._retryQuickAccess()" class="mt-1 text-xs font-semibold text-primary hover:underline">Попробовать снова</button></div>`;
            setQuickAccessEmptyVisible(false);
            if (showAllBtn) showAllBtn.hidden = false;
            updateQuickAccessCount(NaN, quickAccessPreviewLimit);
            setupQuickAccessRail(0);
            return;
        }
        if (!data.items?.length) {
            container.innerHTML = "";
            setQuickAccessEmptyVisible(true);
            if (showAllBtn) showAllBtn.hidden = true;
            updateQuickAccessCount(0, quickAccessPreviewLimit);
            setupQuickAccessRail(0);
            if (emptyEl && emptyActions) {
                let cta = document.getElementById('quick-access-empty-cta');
                if (!cta) {
                    cta = document.createElement('button');
                    cta.type = 'button';
                    cta.id = 'quick-access-empty-cta';
                    cta.className = 'qa-empty-cta btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-bold';
                    cta.textContent = 'Открыть комплексы';
                    cta.addEventListener('click', () => window.navigateWithTransition('/ui/complexes'));
                    emptyActions.appendChild(cta);
                }
                if (cta.parentElement !== emptyActions) {
                    emptyActions.appendChild(cta);
                }
            }
            return;
        }

        setMainRecommendationState({ preferredAction: buildQuickAccessRecommendation(data.items[0]) });
        setQuickAccessEmptyVisible(false);
        if (showAllBtn) showAllBtn.hidden = false;
        updateQuickAccessCount(data.items.length, quickAccessPreviewLimit);
        const previewItems = data.items.slice(0, quickAccessPreviewLimit);

        container.innerHTML = '';
        container.className = 'main-quick-access-grid';

        const buildQuickAccessCard = (item) => {
            const complex = item.complex;
            const complexName = String(complex.name || '');
            const safeComplexInitials = complexName.slice(0, 2);
            const complexId = complex.id;
            const pausedSession = pausedMap.get(complex.id) || item.paused_session || null;
            const isPaused = !!(pausedSession && pausedSession.paused);
            const stats = item.stats || {};
            const health = item.health || {};
            const pausedSessionId = pausedSession ? pausedSession.session_id : null;
            const pausedResumeUrl =
                pausedSession && pausedSession.resume_target && typeof pausedSession.resume_target.url === "string"
                    ? pausedSession.resume_target.url
                    : "";
            const pausedAtLabel = formatPausedAt(pausedSession && pausedSession.paused_at);
            const pausedDisplayIndex = pausedSession && typeof pausedSession.display_task_index === "number"
                ? pausedSession.display_task_index
                : (pausedSession && typeof pausedSession.current_task_index === "number"
                    ? Math.max(0, pausedSession.current_task_index - 1)
                    : null);
            const pausedProgress = typeof pausedDisplayIndex === "number"
                ? pausedDisplayIndex + 1
                : null;
            const pausedTotal = pausedSession && typeof pausedSession.total_tasks === "number"
                ? pausedSession.total_tasks
                : null;
            const progress = Math.round(stats.progress || 0);
            const isMastered = progress >= 100;

            const activateCard = () => {
                if (isPaused) {
                    window.handleStartSession(complexId, pausedSessionId, pausedResumeUrl);
                } else {
                    window.handleStartSession(complexId);
                }
            };

            let healthBadge = '';
            if (health.is_critical) {
                healthBadge = `<div class="absolute -top-1 -right-1 flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-error opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-status-error"></span></div>`;
            } else if (health.status === 'frozen') {
                healthBadge = `<div class="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-border-strong border-2 border-text-on-dark dark:border-border-strong"></div>`;
            }

            let iconContent = '';
            if (isMastered) {
                iconContent = `<div class="w-8 h-8 rounded-full bg-primary-lighter text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[16px]">check</span></div>`;
            } else if (progress > 0) {
                iconContent = `<div class="relative w-8 h-8 flex items-center justify-center shrink-0"><svg class="w-full h-full transform -rotate-90"><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2.5" fill="transparent" pathLength="100" class="text-text-on-dark dark:text-text-secondary"/><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2.5" fill="transparent" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - progress}" stroke-linecap="round" class="text-primary transition-all duration-500 ease-out"/></svg><span class="absolute text-[8px] font-bold text-text-secondary dark:text-text-on-dark">${progress}%</span></div>`;
            } else {
                iconContent = `<div class="w-8 h-8 rounded-lg border border-border-subtle bg-surface-2 flex items-center justify-center text-text-secondary font-bold text-[10px] uppercase shrink-0">${escapeHtml(safeComplexInitials)}</div>`;
            }

            let cardTone = 'ready';
            let statusPill = '\u0413\u043e\u0442\u043e\u0432';
            let metaTag = '';
            let description = complex.description || '\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u0432\u0445\u043e\u0434 \u0432 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u0431\u0435\u0437 \u043b\u0438\u0448\u043d\u0435\u0433\u043e \u043f\u043e\u0438\u0441\u043a\u0430.';
            let progressLabel = '\u0413\u043e\u0442\u043e\u0432 \u043a \u0437\u0430\u043f\u0443\u0441\u043a\u0443';
            let progressValue = 0;
            let actionLabel = '\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c';
            let actionIcon = 'play_arrow';

            if (isPaused) {
                cardTone = 'paused';
                statusPill = '\u041d\u0430 \u043f\u0430\u0443\u0437\u0435';
                metaTag = (pausedProgress && pausedTotal) ? '\u0428\u0430\u0433 ' + pausedProgress + '/' + pausedTotal : '\u0415\u0441\u0442\u044c \u0441\u0435\u0441\u0441\u0438\u044f';
                description = pausedAtLabel
                    ? '\u041f\u0430\u0443\u0437\u0430 \u0441 ' + pausedAtLabel + '. \u041c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0441 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0433\u043e \u0437\u0430\u0434\u0430\u043d\u0438\u044f.'
                    : '\u0421\u0435\u0441\u0441\u0438\u044f \u0443\u0436\u0435 \u0436\u0434\u0451\u0442 \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u044f \u0441 \u0442\u043e\u0433\u043e \u043c\u0435\u0441\u0442\u0430, \u0433\u0434\u0435 \u0432\u044b \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043b\u0438\u0441\u044c.';
                progressLabel = (pausedProgress && pausedTotal)
                    ? '\u0421\u0435\u0439\u0447\u0430\u0441 ' + pausedProgress + '/' + pausedTotal
                    : '\u0413\u043e\u0442\u043e\u0432\u043e \u043a \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u044e';
                progressValue = (pausedProgress && pausedTotal && pausedTotal > 0)
                    ? Math.round((pausedProgress / pausedTotal) * 100)
                    : Math.max(progress, 8);
                actionLabel = '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c';
                actionIcon = 'restart_alt';
            } else if (health.is_critical) {
                cardTone = 'critical';
                statusPill = '\u041d\u0443\u0436\u0435\u043d \u043f\u043e\u0432\u0442\u043e\u0440';
                metaTag = '\u0420\u0438\u0441\u043a \u0437\u0430\u0431\u044b\u0432\u0430\u043d\u0438\u044f';
                description = complex.description || '\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u043f\u0440\u043e\u0441\u0438\u0442 \u0432\u043d\u0438\u043c\u0430\u043d\u0438\u044f: \u043b\u0443\u0447\u0448\u0435 \u0431\u044b\u0441\u0442\u0440\u043e \u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u0438 \u043e\u0441\u0432\u0435\u0436\u0438\u0442\u044c \u043a\u043b\u044e\u0447\u0435\u0432\u044b\u0435 \u0448\u0430\u0433\u0438.';
                progressLabel = progress > 0 ? '\u041e\u0441\u0432\u043e\u0435\u043d\u043e ' + progress + '%' : '\u041f\u043e\u0440\u0430 \u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f';
                progressValue = progress > 0 ? progress : 18;
                actionLabel = '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f';
                actionIcon = 'local_fire_department';
            } else if (health.status === 'frozen') {
                cardTone = 'frozen';
                statusPill = '\u0417\u0430\u043c\u043e\u0440\u043e\u0436\u0435\u043d';
                metaTag = '\u0412 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u0435';
                description = complex.description || '\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u0437\u0430\u043c\u043e\u0440\u043e\u0436\u0435\u043d \u0432 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0438, \u043d\u043e \u0435\u0433\u043e \u043c\u043e\u0436\u043d\u043e \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0432\u0440\u0443\u0447\u043d\u0443\u044e.';
                progressLabel = progress > 0 ? '\u041e\u0441\u0432\u043e\u0435\u043d\u043e ' + progress + '%' : '\u0420\u0443\u0447\u043d\u043e\u0439 \u0437\u0430\u043f\u0443\u0441\u043a';
                progressValue = progress;
                actionLabel = '\u041e\u0442\u043a\u0440\u044b\u0442\u044c';
                actionIcon = 'ac_unit';
            } else if (isMastered) {
                cardTone = 'mastered';
                statusPill = '\u041f\u0440\u043e\u0439\u0434\u0435\u043d';
                metaTag = '\u041c\u043e\u0436\u043d\u043e \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c';
                description = complex.description || '\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d \u0438 \u0433\u043e\u0442\u043e\u0432 \u043a \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e\u043c\u0443 \u043f\u0440\u043e\u0445\u043e\u0434\u0443 \u0431\u0435\u0437 \u0434\u043e\u043b\u0433\u043e\u0433\u043e \u043f\u043e\u0438\u0441\u043a\u0430.';
                progressLabel = '\u041e\u0441\u0432\u043e\u0435\u043d\u043e 100%';
                progressValue = 100;
                actionLabel = '\u041e\u0442\u043a\u0440\u044b\u0442\u044c';
                actionIcon = 'task_alt';
            } else if (progress > 0) {
                cardTone = 'active';
                statusPill = '\u0412 \u0440\u0430\u0431\u043e\u0442\u0435';
                metaTag = String(progress) + '% \u043e\u0441\u0432\u043e\u0435\u043d\u043e';
                description = complex.description || '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0439\u0442\u0435 \u0441 \u0442\u043e\u0433\u043e \u043c\u0435\u0441\u0442\u0430, \u0433\u0434\u0435 \u0443\u0436\u0435 \u043d\u0430\u043a\u043e\u043f\u043b\u0435\u043d \u043f\u0440\u043e\u0433\u0440\u0435\u0441\u0441.';
                progressLabel = '\u041e\u0441\u0432\u043e\u0435\u043d\u043e ' + progress + '%';
                progressValue = progress;
                actionLabel = '\u041e\u0442\u043a\u0440\u044b\u0442\u044c';
                actionIcon = 'arrow_forward';
            } else {
                description = complex.description || '\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u0433\u043e\u0442\u043e\u0432 \u043a \u043d\u043e\u0432\u043e\u043c\u0443 \u0437\u0430\u043f\u0443\u0441\u043a\u0443 \u0438 \u0431\u044b\u0441\u0442\u0440\u043e\u043c\u0443 \u0432\u0445\u043e\u0434\u0443 \u0432 \u0440\u0430\u0431\u043e\u0442\u0443.';
            }

            if (!metaTag && item.is_pinned) {
                metaTag = '\u0417\u0430\u043a\u0440\u0435\u043f\u043b\u0451\u043d';
            } else if (!metaTag && health.days_since_last !== null && health.days_since_last !== undefined) {
                metaTag = health.days_since_last === 0 ? '\u0421\u0435\u0433\u043e\u0434\u043d\u044f' : String(health.days_since_last) + ' \u0434\u043d. \u043d\u0430\u0437\u0430\u0434';
            }

            const card = document.createElement("div");
            card.className = "main-quick-access-card interactive-card group";
            card.dataset.tone = cardTone;
            card.title = complexName;
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.onclick = activateCard;
            card.onkeydown = (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateCard();
                }
            };

            const accentEl = document.createElement("div");
            accentEl.className = "main-quick-access-accent";

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "main-quick-access-remove icon-button-muted";
            removeBtn.title = '\u0423\u0431\u0440\u0430\u0442\u044c';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                window._removeFromQuickAccess(complexId);
            };
            const rmIcon = document.createElement("span");
            rmIcon.className = "material-symbols-outlined text-[14px]";
            rmIcon.textContent = "close";
            removeBtn.appendChild(rmIcon);

            const headEl = document.createElement("div");
            headEl.className = "main-quick-access-card-head";

            const mediaEl = document.createElement("div");
            mediaEl.className = "main-quick-access-media";
            mediaEl.innerHTML = iconContent + healthBadge;

            const bodyEl = document.createElement("div");
            bodyEl.className = "main-quick-access-body";

            const toplineEl = document.createElement("div");
            toplineEl.className = "main-quick-access-topline";

            const pillEl = document.createElement("span");
            pillEl.className = "main-quick-access-pill pill-neutral pill-sm pill-kicker";
            pillEl.textContent = statusPill;
            toplineEl.appendChild(pillEl);

            if (metaTag) {
                const metaTagEl = document.createElement("span");
                metaTagEl.className = "main-quick-access-meta-tag";
                metaTagEl.textContent = compactUiLabel(metaTag, 28);
                metaTagEl.title = metaTag;
                toplineEl.appendChild(metaTagEl);
            }

            const titleEl = document.createElement("div");
            titleEl.className = "main-quick-access-title";
            titleEl.textContent = compactUiLabel(complexName, 58);
            titleEl.title = complexName;

            const descriptionEl = document.createElement("div");
            descriptionEl.className = "main-quick-access-description";
            descriptionEl.textContent = compactUiLabel(description, 118);
            descriptionEl.title = description;

            bodyEl.appendChild(toplineEl);
            bodyEl.appendChild(titleEl);
            bodyEl.appendChild(descriptionEl);

            headEl.appendChild(mediaEl);
            headEl.appendChild(bodyEl);

            const footerEl = document.createElement("div");
            footerEl.className = "main-quick-access-footer";

            const progressEl = document.createElement("div");
            progressEl.className = "main-quick-access-progress";

            const progressLabelEl = document.createElement("div");
            progressLabelEl.className = "main-quick-access-progress-label";
            progressLabelEl.textContent = progressLabel;
            progressEl.appendChild(progressLabelEl);

            if (progressValue > 0) {
                const trackEl = document.createElement("div");
                trackEl.className = "main-quick-access-progress-track";
                const fillEl = document.createElement("div");
                fillEl.className = "main-quick-access-progress-fill";
                fillEl.style.width = `${Math.max(4, Math.min(100, progressValue))}%`;
                trackEl.appendChild(fillEl);
                progressEl.appendChild(trackEl);
            }

            const actionEl = document.createElement("div");
            actionEl.className = "main-quick-access-action";
            actionEl.innerHTML = `<span>${escapeHtml(actionLabel)}</span><span class="material-symbols-outlined">${escapeHtml(actionIcon)}</span>`;

            footerEl.appendChild(progressEl);
            footerEl.appendChild(actionEl);

            card.appendChild(accentEl);
            card.appendChild(removeBtn);
            card.appendChild(headEl);
            card.appendChild(footerEl);

            return card;
        };

        previewItems.forEach((item) => {
            container.appendChild(buildQuickAccessCard(item));
        });
        setupQuickAccessRail(previewItems.length);
        return;

        previewItems.forEach(item => {
            const complex = item.complex;
            const complexName = String(complex.name || '');
            const safeComplexInitials = complexName.slice(0, 2);
            const complexId = complex.id;
            const pausedSession = pausedMap.get(complex.id) || item.paused_session || null;
            const isPaused = !!(pausedSession && pausedSession.paused);
            const stats = item.stats || {};
            const health = item.health || {};
            const pausedSessionId = pausedSession ? pausedSession.session_id : null;
            const pausedResumeUrl =
                pausedSession && pausedSession.resume_target && typeof pausedSession.resume_target.url === "string"
                    ? pausedSession.resume_target.url
                    : "";
            const pausedAtLabel = formatPausedAt(pausedSession && pausedSession.paused_at);
            const pausedDisplayIndex = pausedSession && typeof pausedSession.display_task_index === "number"
                ? pausedSession.display_task_index
                : (pausedSession && typeof pausedSession.current_task_index === "number"
                    ? Math.max(0, pausedSession.current_task_index - 1)
                    : null);
            const pausedProgress = typeof pausedDisplayIndex === "number"
                ? pausedDisplayIndex + 1
                : null;
            const pausedTotal = pausedSession && typeof pausedSession.total_tasks === "number"
                ? pausedSession.total_tasks
                : null;

            let healthBadge = '';
            if (health.is_critical) {
                healthBadge = `<div class="absolute -top-1 -right-1 flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-error opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-status-error"></span></div>`;
            } else if (health.status === 'frozen') {
                healthBadge = `<div class="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-border-strong border-2 border-text-on-dark dark:border-border-strong"></div>`;
            }

            const progress = Math.round(stats.progress || 0);
            const isMastered = progress >= 100;
            let iconContent = '';
            if (isMastered) {
                iconContent = `<div class="w-8 h-8 rounded-full bg-primary-lighter text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[16px]">check</span></div>`;
            } else if (progress > 0) {
                iconContent = `<div class="relative w-8 h-8 flex items-center justify-center shrink-0"><svg class="w-full h-full transform -rotate-90"><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2.5" fill="transparent" pathLength="100" class="text-text-on-dark dark:text-text-secondary"/><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2.5" fill="transparent" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - progress}" stroke-linecap="round" class="text-primary transition-all duration-500 ease-out"/></svg><span class="absolute text-[8px] font-bold text-text-secondary dark:text-text-on-dark">${progress}%</span></div>`;
            } else {
                iconContent = `<div class="w-8 h-8 rounded-lg border border-border-subtle bg-surface-2 flex items-center justify-center text-text-secondary font-bold text-[10px] uppercase shrink-0">${escapeHtml(safeComplexInitials)}</div>`;
            }

            let statusLine = '';
            if (isPaused) {
                const pauseText = pausedAtLabel ? `На паузе с ${pausedAtLabel}` : "На паузе";
                const progressText = (pausedProgress && pausedTotal) ? ` Шаг ${pausedProgress}/${pausedTotal}` : "";
                statusLine = `${pauseText}${progressText}`;
            } else if (item.is_pinned) {
                statusLine = 'Закреплено';
            } else {
                if (health.days_since_last !== null && health.days_since_last !== undefined) {
                    statusLine = health.days_since_last === 0 ? 'Сегодня' : `${health.days_since_last} дн. назад`;
                } else {
                    statusLine = complex.description || 'Нет описания';
                }
            }

            const card = document.createElement("div");
            card.className = "main-quick-access-card interactive-card group";
            card.title = complexName;
            card.onclick = () => {
                if (isPaused) {
                    window.handleStartSession(complexId, pausedSessionId, pausedResumeUrl);
                } else {
                    window.handleStartSession(complexId);
                }
            };

            const iconWrap = document.createElement("div");
            iconWrap.className = "relative flex-shrink-0";
            iconWrap.innerHTML = iconContent + healthBadge;

            const textWrap = document.createElement("div");
            textWrap.className = "flex flex-col min-w-0 flex-1";

            const titleEl = document.createElement("span");
            titleEl.className = "text-text-main font-bold text-xs leading-tight min-w-0 main-quick-access-title";
                titleEl.textContent = compactUiLabel(complexName, 58);
            titleEl.title = complexName;

            const metaEl = document.createElement("span");
            metaEl.className = "text-text-secondary text-[10px] mt-0.5 leading-tight min-w-0 main-quick-access-status-copy";
            metaEl.textContent = compactUiLabel(statusLine, 74);
            metaEl.title = statusLine;

            const removeBtn = document.createElement("button");
            removeBtn.className = "absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-surface-1 text-text-secondary opacity-0 group-hover:opacity-100 transition hover:bg-error-lighter hover:text-error";
            removeBtn.title = "Убрать";
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                window._removeFromQuickAccess(complexId);
            };
            const rmIcon = document.createElement("span");
            rmIcon.className = "material-symbols-outlined text-[14px]";
            rmIcon.textContent = "close";
            removeBtn.appendChild(rmIcon);

            textWrap.appendChild(titleEl);
            textWrap.appendChild(metaEl);

            card.appendChild(iconWrap);
            card.appendChild(textWrap);
            card.appendChild(removeBtn);

            container.appendChild(card);
        });
    }

    window._retryQuickAccess = async function () {
        await loadQuickAccess();
    };

    window._unpinComplex = async function (complexId) {
        await apiFetch('/api/ui/quick-access/unpin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ complex_id: complexId, user_id: currentUser.user_id })
        });
        await loadQuickAccess();
    };

    window._removeFromQuickAccess = async function (complexId) {
        await apiFetch('/api/ui/quick-access/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ complex_id: complexId, user_id: currentUser.user_id })
        });
        await loadQuickAccess();
    };

    async function markRecentComplex(complexId) {
        if (!complexId || !currentUser?.user_id) return;
        try {
            await apiFetch(`/api/ui/quick-access/recent`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ complex_id: complexId, user_id: currentUser.user_id })
            });
        } catch (err) {
            // best-effort
        }
    }

    async function resumePausedComplexSession(complexId, sessionId, preferredResumeUrl = "") {
        sessionStartAbortController = new AbortController();
        const response = await apiFetch(`/api/session/${encodeURIComponent(sessionId)}/resume`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
                currentUser?.user_id
                    ? { user_id: currentUser.user_id, source: "main_quick_access" }
                    : { source: "main_quick_access" }
            ),
            signal: sessionStartAbortController.signal
        });
        const { ok, data, cancelled } = response;
        if (cancelled) return false;
        if (!ok || !data?.ok) {
            NotificationUI.toast(`Ошибка при возобновлении: ${data?.error || 'Неизвестная ошибка'}`, 'error');
            return false;
        }
        await markRecentComplex(complexId);
        const resumeUrl =
            (typeof preferredResumeUrl === "string" && preferredResumeUrl) ||
            (typeof data?.resume_target?.url === "string" && data.resume_target.url) ||
            `/ui/session/${encodeURIComponent(sessionId)}`;
        window.navigateWithTransition(resumeUrl);
        return true;
    }

    async function startOrRestartComplexSession(complexId, force = false) {
        sessionStartAbortController = new AbortController();
        const response = await apiFetch(`/api/session/${encodeURIComponent(complexId)}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(force ? { user_id: currentUser.user_id, force: true } : { user_id: currentUser.user_id }),
            signal: sessionStartAbortController.signal
        });

        const { ok, data, cancelled } = response;
        if (cancelled) return false;

        if (!ok && data?.error === "paused_session_exists" && data?.session_id) {
            const resume = await NotificationUI.confirm({
                title: 'Найдена сессия на паузе',
                message: 'Для этого комплекса уже есть сессия на паузе.\nПродолжить её или начать заново?',
                confirmText: 'Продолжить',
                cancelText: 'Начать заново',
                variant: 'primary'
            });
            if (resume) {
                return resumePausedComplexSession(complexId, data.session_id);
            }
            return startOrRestartComplexSession(complexId, true);
        }

        if (!ok || !data?.session_id) {
            const errorMsg = data?.error || data?.message || "Неизвестная ошибка";
            NotificationUI.toast(`Ошибка при запуске: ${errorMsg}`, 'error');
            return false;
        }

        await markRecentComplex(complexId);
        window.navigateWithTransition(`/ui/session/${data.session_id}`);
        return true;
    }

    window.handleStartSession = async function (complexId, pausedSessionId = null, preferredResumeUrl = "") {
        try {
            if (sessionStartAbortController && !sessionStartAbortController.signal.aborted) {
                return;
            }
            if (pausedSessionId) {
                await resumePausedComplexSession(complexId, pausedSessionId, preferredResumeUrl);
                return;
            }
            await startOrRestartComplexSession(complexId, false);
            return;
        } catch (error) {
            console.error("Session start exception:", error);
            NotificationUI.toast('Ошибка подключения. Проверьте интернет', 'error');
        }
    }

    function updateDateTime() {
        const now = new Date();
        const options = { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };
        const el = document.getElementById('datetime-text');
        if (el) el.innerHTML = `<span class="font-bold text-text-main">${now.toLocaleDateString('ru-RU', options)}</span>`;
    }

    document.addEventListener("click", e => {
        if (e.target?.closest('button, input, select, textarea, label, .main-period-toggle, [data-stop-nav="true"]')) {
            return;
        }
        const el = e.target?.closest("[data-nav]");
        if (el) window.navigateWithTransition(el.getAttribute("data-nav"));
    });
    if (document.body?.classList.contains('main-is-booting')) {
        initialize();
    } else {
        document.addEventListener("DOMContentLoaded", initialize);
    }
})();
