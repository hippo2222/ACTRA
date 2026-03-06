(function () {
    let currentUser = null;

    // --- Abort Controllers for Race Condition Prevention (7.4) ---
    let statsLoadAbortController = null; // Отмена старого запроса статистики при смене периода
    let sessionStartAbortController = null; // Защита от дублирования запросов создания сессии
    let legalDocuments = null;
    let feedbackOptionsCache = null;
    let mainConsentGateResolver = null;
    let mainConsentGateUserId = null;
    let updateInfoToastShown = false;
    let updatesConfigured = null;

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

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
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
        title.className = 'mt-1 text-sm font-bold text-text-main';

        const reason = document.createElement('p');
        reason.id = 'mainNextStepReason';
        reason.className = 'mt-1 text-xs text-text-secondary';

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

        const referenceNode = document.getElementById('quick-access-list');
        if (referenceNode) {
            host.insertBefore(banner, referenceNode);
        } else {
            host.appendChild(banner);
        }

        return banner;
    }

    function ensureWorkspaceOwnershipBanner() {
        const host = document.getElementById('quick-access-section');
        if (!host) return null;

        let banner = document.getElementById('workspaceOwnershipBanner');
        if (banner) return banner;

        banner = document.createElement('div');
        banner.id = 'workspaceOwnershipBanner';
        banner.className = 'rounded-xl border border-border-subtle bg-surface-1 p-3';
        banner.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-lighter text-primary">
                    <span class="material-symbols-outlined text-[20px]">groups</span>
                </div>
                <div class="min-w-0">
                    <p class="text-sm font-bold text-text-main">Профиль хранит личный прогресс</p>
                    <p class="mt-1 text-xs text-text-secondary">Комплексы, теория и микрокарточки могут быть частью общей локальной библиотеки. Прогресс, календарь, статистика и активные сессии остаются личными.</p>
                </div>
            </div>
        `;

        const referenceNode = document.getElementById('mainNextStepBanner') || document.getElementById('quick-access-list');
        if (referenceNode) {
            host.insertBefore(banner, referenceNode);
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
        const banner = ensureMainNextStepBanner();
        if (!banner) return;

        const recommendation = mainRecommendationState.preferredAction || getMainFallbackRecommendation();
        const titleEl = document.getElementById('mainNextStepTitle');
        const reasonEl = document.getElementById('mainNextStepReason');
        const labelEl = document.getElementById('mainNextStepButtonLabel');
        const iconEl = document.getElementById('mainNextStepButtonIcon');
        const buttonEl = document.getElementById('mainNextStepButton');
        if (!titleEl || !reasonEl || !labelEl || !iconEl || !buttonEl) return;

        titleEl.textContent = recommendation.title;
        reasonEl.textContent = recommendation.reason;
        labelEl.textContent = recommendation.label;
        iconEl.textContent = recommendation.icon || 'arrow_forward';
        buttonEl.onclick = () => {
            if (typeof recommendation.action === 'function') {
                recommendation.action();
            }
        };
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

    function setUpdateButtonConfigured(configured) {
        if (typeof configured !== 'boolean') return;
        const btn = document.getElementById('checkUpdatesButton');
        if (!btn) return;

        const defaultTitle = btn.dataset.defaultTitle || btn.getAttribute('title') || '';
        if (!btn.dataset.defaultTitle) {
            btn.dataset.defaultTitle = defaultTitle;
        }

        btn.disabled = !configured;
        if (configured) {
            btn.removeAttribute('aria-disabled');
            if (btn.dataset.defaultTitle) {
                btn.setAttribute('title', btn.dataset.defaultTitle);
            }
            return;
        }

        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('title', 'Проверка обновлений недоступна в этой сборке');
    }

    async function syncUpdatesConfiguredState(forceRefresh = false) {
        if (!forceRefresh && typeof updatesConfigured === 'boolean') {
            setUpdateButtonConfigured(updatesConfigured);
            return updatesConfigured;
        }

        const network = await fetchNetworkStatus();
        const configured = network?.updates?.configured;
        if (typeof configured === 'boolean') {
            updatesConfigured = configured;
            setUpdateButtonConfigured(updatesConfigured);
        }
        return updatesConfigured;
    }

    async function retryPendingFeedbackDelivery() {
        // Best-effort background retry for tickets queued while offline.
        await apiFetch('/api/feedback/retry-pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 5 }),
        });
    }

    function showAppUpdateNotice(text, downloadUrl) {
        const wrapEl = document.getElementById('appUpdateNotice');
        const textEl = document.getElementById('appUpdateNoticeText');
        const linkEl = document.getElementById('appUpdateNoticeLink');
        if (!wrapEl || !textEl || !linkEl) return;

        if (!text) {
            textEl.textContent = '';
            linkEl.classList.add('hidden');
            linkEl.removeAttribute('href');
            wrapEl.classList.add('hidden');
            return;
        }

        textEl.textContent = text;
        if (downloadUrl) {
            linkEl.href = downloadUrl;
            linkEl.classList.remove('hidden');
        } else {
            linkEl.classList.add('hidden');
            linkEl.removeAttribute('href');
        }
        wrapEl.classList.remove('hidden');
    }

    window.checkForAppUpdates = async function (force = false) {
        const configured = await syncUpdatesConfiguredState(force);
        if (configured === false) {
            showAppUpdateNotice(null, null);
            return;
        }

        const query = force ? '?force=1' : '';
        const { ok, data } = await apiFetch(`/api/update/check${query}`);
        if (!ok || !data) {
            if (force) NotificationUI.toast('Не удалось проверить обновления', 'error');
            return;
        }

        if (typeof data.manifest_url_configured === 'boolean') {
            updatesConfigured = data.manifest_url_configured;
            setUpdateButtonConfigured(updatesConfigured);
        }

        const currentVersion = data.current_version || '-';
        const latestVersion = data.latest_version || null;
        const downloadUrl = data.download_url || '';

        if (data.update_available) {
            const msg = latestVersion
                ? `Доступна новая версия ${latestVersion} (у вас ${currentVersion}).`
                : `Доступна новая версия (у вас ${currentVersion}).`;
            showAppUpdateNotice(msg, downloadUrl);
            if (!updateInfoToastShown || force) {
                NotificationUI.toast(msg, 'warning');
                updateInfoToastShown = true;
            }
            return;
        }

        showAppUpdateNotice(null, null);
        if (!force) return;

        if (data.reason === 'not_configured') {
            updatesConfigured = false;
            setUpdateButtonConfigured(false);
            return;
        }
        if (data.reason === 'offline' || data.reason === 'offline_cached') {
            NotificationUI.toast('Нет интернета: проверить обновления сейчас нельзя', 'warning');
            return;
        }
        if (
            data.reason === 'fetch_failed'
            || data.reason === 'fetch_failed_cached'
            || data.reason === 'manifest_invalid'
            || data.reason === 'manifest_invalid_cached'
        ) {
            NotificationUI.toast('Не удалось получить данные об обновлениях', 'error');
            return;
        }
        if (data.reason === 'disabled') {
            NotificationUI.toast('Проверка обновлений отключена', 'warning');
            return;
        }
        if (data.reason === 'up_to_date') {
            NotificationUI.toast(`Установлена актуальная версия (${currentVersion})`, 'success');
            return;
        }
        NotificationUI.toast('Проверка обновлений выполнена', 'success');
    };

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
        const loaded = await ensureLegalDocumentsLoaded();
        if (!loaded) {
            NotificationUI.toast('Не удалось загрузить юридические документы', 'error');
            return false;
        }

        const { ok, data } = await apiFetch(`/api/consent/status?user_id=${encodeURIComponent(userId)}`);
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
                bug: 'Баг',
                idea: 'Идея',
                improvement: 'Улучшение',
                question: 'Вопрос',
            }, 'bug');
            renderFeedbackSelectOptions('feedbackSeverity', options.severity || [], {
                low: 'Низкая',
                medium: 'Средняя',
                high: 'Высокая',
                critical: 'Критичная',
            }, 'medium');
        }

        const network = await fetchNetworkStatus();
        if (network && network.internet_online === false) {
            showFeedbackNetworkStatus('Интернет недоступен. Обращение сохранится локально и будет отправлено при следующей попытке.', 'warning');
        } else if (network?.feedback_delivery && network.feedback_delivery.configured === false) {
            showFeedbackNetworkStatus('Канал отправки сообщений разработчику пока не настроен. Обращение сохранится локально.', 'neutral');
        } else if (network?.internet_online === true) {
            showFeedbackNetworkStatus('Соединение с интернетом есть. Обращение будет отправлено разработчику по email.', 'success');
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
            showFeedbackError('Тема должна содержать от 3 до 180 символов');
            titleEl?.focus();
            return;
        }
        if (description.length < 5 || description.length > 10000) {
            showFeedbackError('Описание должно содержать от 5 до 10000 символов');
            descEl?.focus();
            return;
        }
        if (!currentUser?.user_id) {
            showFeedbackError('Не удалось определить текущий профиль');
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
            const message = (data && (data.message || data.error)) || 'Не удалось отправить обращение';
            showFeedbackError(message);
            return;
        }

        const ticketId = data?.ticket_id ? ` (${data.ticket_id})` : '';
        const emailSent = !!data?.email_notification?.sent;
        if (emailSent) {
            NotificationUI.toast(`Обращение отправлено${ticketId}`, 'success');
        } else {
            NotificationUI.toast(`Обращение сохранено локально${ticketId}. Отправим при следующей возможности`, 'warning');
        }
        window.closeFeedbackModal();
    };

    // --- Initialization ---
    async function initialize() {
        // 1. Update UI baseline
        updateDateTime();

        if (!window.updateDateTimeInterval) {
            window.updateDateTimeInterval = setInterval(updateDateTime, 30000);
        }

        // 2. Load User
        await loadCurrentUser();
        ensureWorkspaceOwnershipBanner();

        // 3. Load Dynamic Content
        if (currentUser) {
            retryPendingFeedbackDelivery();
            const consentOk = await ensureUserConsent(currentUser.user_id);
            if (!consentOk) {
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

            await Promise.all([
                loadQuickAccess(),
                loadUserSettings(), // Renamed from loadStatsSettings
                loadCalendarWidget(),
                loadMicrocardsWidget(),
                syncUpdatesConfiguredState(false),
            ]);
            window.checkForAppUpdates(false);
        }
    }

    async function loadCurrentUser() {
        const { ok, data } = await apiFetch('/api/users/current');

        if (ok && data.user) {
            currentUser = data.user;
            updateHeaderUser(currentUser);
        } else {
            // No active user — redirect to Welcome Screen
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
        const nameEl = document.getElementById('headerUserName');
        const avatarEl = document.getElementById('headerAvatar');
        if (nameEl) nameEl.textContent = user.name;
        if (avatarEl) avatarEl.src = getAvatarUrl(user.avatar_seed, user.user_id);
    }

    // --- User Management ---
    window.openProfileModal = async function () {
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

    window.closeProfileModal = function () {
        closeModal('profileModal');
    }

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
    let userSettingsLoaded = false;
    let isInitialThemeLoad = true;

    async function loadUserSettings() {
        try {
            const { ok, data } = await apiFetch('/api/ui/settings');
            if (ok && data.settings) {
                const settings = data.settings;

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
        await loadStatistics();
    }

    function updatePeriodButtons() {
        [1, 7, 30, 0].forEach(d => {
            const btn = document.getElementById(`btnPeriod${d}`);
            if (btn) {
                btn.className = "px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer";
                // Using strict semantics for active/inactive states
                if (currentStatsPeriod === d) {
                    btn.classList.add('bg-surface-1', 'shadow-sm', 'text-text-main', 'border', 'border-border-strong');
                } else {
                    btn.classList.add('text-text-muted', 'hover:text-text-main', 'border', 'border-transparent');
                }
            }
        });
    }

    window.selectStatsPeriod = async function (days, btn) {
        if (days === currentStatsPeriod) return;
        currentStatsPeriod = days;
        updatePeriodButtons();

        // RACE CONDITION FIX (7.4): Отменяем предыдущий запрос перед новым
        if (statsLoadAbortController) {
            statsLoadAbortController.abort();
        }

        // Animate OUT
        const content = document.getElementById('statsContent');
        if (content) {
            content.classList.add('opacity-50', 'blur-[2px]', 'scale-[0.98]');
        }

        // Save preference
        apiFetch('/api/ui/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { stats_period: days } })
        });
        // Small delay to make animation visible
        await new Promise(r => setTimeout(r, 150));
        await loadStatistics();

        // Animate IN
        if (content) {
            content.classList.remove('opacity-50', 'blur-[2px]', 'scale-[0.98]');
        }
    }

    async function loadStatistics() {
        const statsContent = document.getElementById('statsContent');
        const statSolvedTasks = document.getElementById('statSolvedTasks');
        // Determine if this is first load (no data yet)
        const isFirstLoad = !statSolvedTasks || !statSolvedTasks.textContent || statSolvedTasks.textContent === '0';

        if (isFirstLoad) {
            showStatsSkeleton();
        } else {
            // For subsequent loads, use blur effect
            if (statsContent) {
                statsContent.classList.add('opacity-50', 'blur-[2px]');
            }
        }

        updatePeriodButtons();

        // RACE CONDITION FIX (7.4): Создаем новый AbortController для отслеживания этого запроса
        statsLoadAbortController = new AbortController();

        const { ok, data, cancelled } = await apiFetch(`/api/statistics/overall?days=${currentStatsPeriod}`, {
            signal: statsLoadAbortController.signal
        });

        // Если запрос был отменен, выходим без обновления
        if (cancelled) {
            if (statsContent) statsContent.classList.remove('opacity-50', 'blur-[2px]');
            return;
        }

        if (ok) {
            const s = data.stats;
            // Update values
            document.getElementById('statSolvedTasks').textContent = s.tasks_mastered || 0;
            document.getElementById('statTotalAvailable').textContent = s.total_tasks_available || 0;
            document.getElementById('statSuccessRate').textContent = `${Math.round((s.success_rate || 0) * 100)}%`;
            document.getElementById('statTodayCount').textContent = s.completed_complexes_today || 0;

            const combinedSeconds = (s.learning_sources && s.learning_sources.combined)
                ? (s.learning_sources.combined.time_spent_seconds || 0)
                : (s.total_time_spent || 0);
            const mins = Math.round(combinedSeconds / 60);
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            document.getElementById('statTimeSpent').textContent = `${h}ч ${m}м`;

            // UX-30: Show welcome message if all stats are zero
            const isEmpty = !(s.tasks_mastered || s.success_rate || s.total_time_spent || s.completed_complexes_today);
            setMainRecommendationState({ statsEmpty: isEmpty });
            let welcomeEl = document.getElementById('statsWelcomeMessage');
            if (isEmpty) {
                if (!welcomeEl && statsContent) {
                    welcomeEl = document.createElement('div');
                    welcomeEl.id = 'statsWelcomeMessage';
                    welcomeEl.className = 'p-3 bg-primary-lighter/40 border border-primary-light rounded-lg text-center mb-2';
                    welcomeEl.innerHTML = '<p class="text-sm font-medium text-primary-dark">Запустите первый комплекс: после него здесь появятся прогресс, время и ежедневная динамика.</p>';
                    statsContent.parentElement.insertBefore(welcomeEl, statsContent);
                }
            } else if (welcomeEl) {
                welcomeEl.remove();
            }

            // Hide skeleton and error, show content
            hideStatsSkeleton();
            hideStatsError();

            // Remove blur effect
            if (statsContent) {
                statsContent.classList.remove('opacity-50', 'blur-[2px]');
            }
        } else {
            console.error('Failed to load statistics:', data);
            setMainRecommendationState({ statsEmpty: null });
            hideStatsSkeleton();
            showStatsError();
            if (statsContent) {
                statsContent.classList.remove('opacity-50', 'blur-[2px]');
            }
        }
    }

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
        // Check if error message already exists
        let errorEl = document.getElementById('statsErrorMessage');

        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.id = 'statsErrorMessage';
            errorEl.className = 'p-3 bg-error-lighter border border-error-light rounded-lg text-center';
            errorEl.innerHTML = `<div class="flex flex-col gap-2"><span class="material-symbols-outlined text-status-error text-[24px]">error</span><p class="text-sm font-semibold text-text-main">Статистика временно недоступна</p><p class="text-xs text-text-secondary">Ваш прогресс не потерян. Попробуйте загрузить блок ещё раз.</p><button onclick="retryLoadStatistics()" class="text-xs font-medium text-status-error hover:text-text-main underline">Загрузить снова</button></div>`;
            statsContent.parentElement.insertBefore(errorEl, statsContent);
        }

        // Hide content, show error
        statsContent.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }

    function hideStatsError() {
        const errorEl = document.getElementById('statsErrorMessage');
        const statsContent = document.getElementById('statsContent');
        if (errorEl) errorEl.classList.add('hidden');
        if (statsContent) statsContent.classList.remove('hidden');
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
    async function loadMicrocardsWidget() {
        const loadingState = document.getElementById('microcardsLoadingState');
        const emptyState = document.getElementById('microcardsEmptyState');
        const contentState = document.getElementById('microcardsContentState');
        const disabledState = document.getElementById('microcardsDisabledState');
        const cardEl = document.getElementById('microcardsCard');
        const ctaEl = document.getElementById('microcardsCTA');

        if (!cardEl) return;

        if (ctaEl) ctaEl.disabled = false;

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
            } else {
                setMainRecommendationState({ microcardsDisabled: false, microcardsHasDecks: false, microcardsDue: 0 });
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
            if (emptyState) emptyState.classList.remove('hidden');
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
        if (emptyState) emptyState.classList.add('hidden');
        if (contentState) {
            contentState.classList.remove('hidden');
            contentState.classList.add('flex');
        }

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

        const { ok, data } = await apiFetch('/api/calendar/today');
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
        const { ok: statsOk, data: statsData } = await apiFetch('/api/statistics/time-dynamics?days=14');
        const hasActivity = statsOk && statsData?.dynamics?.some(d => (d.tasks_attempted > 0) || (d.microcards_reviews > 0) || (d.activity_attempts_total > 0));
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
            if (countEl) countEl.innerHTML = '<span class="text-lg">Нет задач</span>';
            if (timeEl) timeEl.parentElement.classList.add('hidden');
        } else {
            if (countEl) countEl.innerHTML = `<span class="text-3xl font-black text-text-main">${mixCount}</span><span class="text-sm font-bold text-text-muted ml-1">задач</span>`;
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
        if (ok && data?.health_summary) {
            renderHealthSummary(data.health_summary);
        }
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
            const hasTasks = (data?.tasks_attempted || 0) > 0;
            days.push({
                date: dateStr,
                completion_percent: data ? (data.success_rate || 0) * 100 : 0,
                has_activity: hasTasks || hasMC,
                has_microcards: hasMC,
                has_tasks: hasTasks,
                is_today: dateStr === todayStr
            });
        }

        container.innerHTML = days.map(day => {
            let bgClass = 'bg-transparent border border-secondary';
            let style = '';
            if (day.is_today) {
                bgClass = 'ring-1 ring-accent';
                style = 'background-color: color-mix(in srgb, var(--color-accent), transparent 70%);';
            } else if (day.has_activity) {
                if (day.completion_percent >= 80) bgClass = 'bg-primary';
                else if (day.completion_percent >= 50) bgClass = 'bg-primary-dark';
                else if (day.completion_percent > 0) bgClass = 'bg-primary-light';
                else bgClass = 'bg-primary-light';
            }
            let statusText = 'Нет активности';
            if (day.is_today) {
                statusText = 'Сегодня';
            } else if (day.has_activity) {
                const parts = [];
                if (day.has_tasks) parts.push(`задания: ${Math.round(day.completion_percent)}%`);
                if (day.has_microcards) parts.push('микрокарточки');
                statusText = parts.length ? parts.join(', ') : 'Активность';
            }
            const tooltip = `${day.date}\n${statusText}`;
            return `<div class="w-3 h-3 rounded-[2px] ${bgClass}" style="${style}" title="${tooltip}"></div>`;
        }).join('');
    }

    function renderHealthSummary(healthSummary) {
        const container = document.getElementById('calendarHealthList');
        if (!container) return;
        if (!healthSummary) {
            container.innerHTML = '';
            return;
        }
        const complexes = healthSummary.complexes || [];
        const toShow = complexes.filter(c => c.health_percent < 80).slice(0, 2);

        if (toShow.length === 0) {
            container.innerHTML = '<p class="text-[10px] text-text-muted text-center py-1">Все комплексы в норме</p>';
            return;
        }

        container.innerHTML = toShow.map(c => {
            const tooltip = c.message ? `${c.hint_title || ''}\n${c.message}`.trim() : `Здоровье: ${c.health_percent}%`;
            return `
                <div class="flex items-center justify-between py-1.5 px-2 bg-surface-2 rounded text-[11px]" title="${escapeHtml(tooltip)}">
                    <div class="flex items-center gap-1.5">
                        <div class="w-1.5 h-1.5 rounded-full ${c.is_critical ? 'bg-status-error' : 'bg-accent'}"></div>
                        <span class="font-medium text-text-muted truncate max-w-[100px]">${escapeHtml(c.name || '')}</span>
                    </div>
                    <span class="font-bold ${c.is_critical ? 'text-status-error' : 'text-accent'}">${escapeHtml(String(c.health_percent ?? 0))}%</span>
                </div>`;
        }).join('');
    }

    // --- Navigation & Quick Access ---
    async function loadQuickAccess() {
        const container = document.getElementById("quick-access-list");
        const emptyEl = document.getElementById("quick-access-empty");
        const showAllBtn = document.getElementById("quick-access-show-all");
        if (!container) return;

        const [{ ok, data }, sessionsResp] = await Promise.all([
            apiFetch(`/api/ui/quick-access?user_id=${encodeURIComponent(currentUser.user_id)}`),
            apiFetch(`/api/sessions/active`)
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
                    reason: `У вас уже есть незавершённый прогон по комплексу «${complexName}». Самый быстрый следующий шаг — продолжить его.`,
                    label: 'Продолжить сессию',
                    icon: 'restart_alt',
                    action: () => window.handleStartSession(complexId, pausedSession.session_id),
                };
            }

            return {
                title: 'Продолжите активный комплекс',
                reason: `Комплекс «${complexName}» уже у вас под рукой. Проще всего вернуться в обучение через него.`,
                label: 'Открыть комплекс',
                icon: 'play_arrow',
                action: () => window.handleStartSession(complexId),
            };
        };

        if (!ok) {
            container.innerHTML = `<div class="p-4 text-center"><p class="text-sm text-text-muted">Не удалось загрузить</p><button onclick="window._retryQuickAccess()" class="text-xs text-primary hover:underline mt-1">Попробовать снова</button></div>`;
            if (emptyEl) emptyEl.hidden = true;
            if (showAllBtn) showAllBtn.hidden = false;
            return;
        }
        if (!data.items?.length) {
            container.innerHTML = "";
            if (emptyEl) emptyEl.hidden = false;
            if (showAllBtn) showAllBtn.hidden = true;
            if (emptyEl) {
                let cta = document.getElementById('quick-access-empty-cta');
                if (!cta) {
                    cta = document.createElement('button');
                    cta.type = 'button';
                    cta.id = 'quick-access-empty-cta';
                    cta.className = 'mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-fg transition-all hover:bg-primary-hover';
                    cta.textContent = 'Открыть комплексы';
                    cta.addEventListener('click', () => window.navigateWithTransition('/ui/complexes'));
                    emptyEl.querySelector('.flex')?.appendChild(cta);
                }
            }
            return;
        }

        setMainRecommendationState({ preferredAction: buildQuickAccessRecommendation(data.items[0]) });
        if (emptyEl) emptyEl.hidden = true;
        if (showAllBtn) showAllBtn.hidden = false;

        container.innerHTML = data.items.map(item => {
            const complex = item.complex;
            const complexName = String(complex.name || '');
            const safeComplexName = escapeHtml(complexName);
            const safeComplexDescription = escapeHtml(complex.description || 'Нет описания');
            const safeComplexInitials = escapeHtml(complexName.slice(0, 2));
            const complexIdLiteral = escapeInlineJsString(complex.id);
            const pausedSession = pausedMap.get(complex.id) || item.paused_session || null;
            const isPaused = !!(pausedSession && pausedSession.paused);
            const stats = item.stats || {};
            const health = item.health || {};
            const ctaIcon = isPaused ? 'restart_alt' : 'play_arrow';
            const pausedSessionIdLiteral = pausedSession ? escapeInlineJsString(pausedSession.session_id) : '';
            const onClickHandler = isPaused ? `window.handleStartSession('${complexIdLiteral}', '${pausedSessionIdLiteral}')` : `window.handleStartSession('${complexIdLiteral}')`;
            const pausedAtLabel = formatPausedAt(pausedSession && pausedSession.paused_at);
            const pausedProgress = pausedSession && typeof pausedSession.current_task_index === "number"
                ? pausedSession.current_task_index + 1
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
                iconContent = `<div class="w-10 h-10 rounded-full bg-primary-lighter text-primary flex items-center justify-center"><span class="material-symbols-outlined text-[20px]">check</span></div>`;
            } else if (progress > 0) {
                iconContent = `<div class="relative w-10 h-10 flex items-center justify-center"><svg class="w-full h-full transform -rotate-90"><circle cx="20" cy="20" r="16" stroke="currentColor" stroke-width="3" fill="transparent" pathLength="100" class="text-text-on-dark dark:text-text-secondary"/><circle cx="20" cy="20" r="16" stroke="currentColor" stroke-width="3" fill="transparent" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - progress}" stroke-linecap="round" class="text-primary transition-all duration-500 ease-out"/></svg><span class="absolute text-[9px] font-bold text-text-secondary dark:text-text-on-dark">${progress}%</span></div>`;
            } else {
                iconContent = `<div class="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center text-text-muted font-bold text-xs uppercase border border-border-subtle">${safeComplexInitials}</div>`;
            }

            let statusLine = '';
            if (isPaused) {
                const pauseText = pausedAtLabel
                    ? `На паузе с ${pausedAtLabel}`
                    : "На паузе";
                const progressText = (pausedProgress && pausedTotal) ? ` В· ${pausedProgress}/${pausedTotal}` : "";
                statusLine = `<span class="text-accent text-[10px] font-bold uppercase tracking-wider">${escapeHtml(`${pauseText}${progressText}`)}</span>`;
            } else if (item.is_pinned) {
                statusLine = `<span class="text-text-muted text-[10px] flex items-center gap-1"><span class="material-symbols-outlined text-[10px]">push_pin</span> Закреплено</span>`;
            } else {
                if (health.days_since_last !== null && health.days_since_last !== undefined) {
                    const dayText = health.days_since_last === 0 ? 'Сегодня' : `${health.days_since_last}дн. назад`;
                    statusLine = `<span class="text-text-muted text-[10px]">Активность: ${dayText}</span>`;
                } else {
                    statusLine = `<span class="text-text-muted text-[10px] uppercase tracking-wider max-w-[120px] truncate">${safeComplexDescription}</span>`;
                }
            }

            return `
                <div class="group relative bg-surface-1 rounded-xl p-3 border border-border-subtle hover:border-primary-light hover:shadow-lg transition-all cursor-pointer flex items-center justify-between gap-3"
                onclick="${onClickHandler}">
                    <div class="flex items-center gap-3">
                        <div class="relative">${iconContent}${healthBadge}</div>
                        <div class="flex flex-col">
                            <h4 class="font-bold text-sm text-text-main group-hover:text-primary transition-colors line-clamp-1">${safeComplexName}</h4>
                            <div class="flex items-center gap-2 mt-0.5">${statusLine}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-1">
                        <button class="h-7 w-7 rounded-full flex items-center justify-center text-text-muted hover:text-status-error hover:bg-surface-2 transition-all opacity-0 group-hover:opacity-100" onclick="event.stopPropagation();window._removeFromQuickAccess('${complexIdLiteral}')" title="Убрать"><span class="material-symbols-outlined text-[14px]">close</span></button>
                        <button class="h-8 w-8 rounded-full bg-bg-secondary flex items-center justify-center text-text-muted group-hover:bg-primary group-hover:text-primary-fg transition-all shadow-sm">
                            <span class="material-symbols-outlined text-[18px]">${ctaIcon}</span>
                        </button>
                    </div>
                </div>`;
        }).join('');
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

    window.handleStartSession = async function (complexId, pausedSessionId = null) {
        try {
            if (sessionStartAbortController && !sessionStartAbortController.signal.aborted) {
                return;
            }
            if (pausedSessionId) {
                await markRecentComplex(complexId);
                window.navigateWithTransition(`/ui/session/${pausedSessionId}`);
                return;
            }
            sessionStartAbortController = new AbortController();
            const response = await apiFetch(`/api/session/${encodeURIComponent(complexId)}/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: currentUser.user_id }),
                signal: sessionStartAbortController.signal
            });

            const { ok, data, cancelled } = response;
            if (cancelled) return;

            // MISSING-3: сервер нашёл паузированную сессию — предлагаем выбор
            if (!ok && data?.error === "paused_session_exists" && data?.session_id) {
                const resume = await NotificationUI.confirm({
                    title: 'Найдена сессия на паузе',
                    message: 'Для этого комплекса уже есть сессия на паузе.\nПродолжить её или начать заново?',
                    confirmText: 'Продолжить',
                    cancelText: 'Начать заново',
                    variant: 'primary'
                });
                if (resume) {
                    await markRecentComplex(complexId);
                    window.navigateWithTransition(`/ui/session/${data.session_id}`);
                } else {
                    sessionStartAbortController = new AbortController();
                    const resp2 = await apiFetch(`/api/session/${encodeURIComponent(complexId)}/start`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ user_id: currentUser.user_id, force: true }),
                        signal: sessionStartAbortController.signal
                    });
                    if (resp2.ok && resp2.data?.session_id) {
                        await markRecentComplex(complexId);
                        window.navigateWithTransition(`/ui/session/${resp2.data.session_id}`);
                    } else {
                        NotificationUI.toast(`Ошибка при запуске: ${resp2.data?.error || 'Неизвестная ошибка'}`, 'error');
                    }
                }
                return;
            }

            if (ok && data?.session_id) {
                await markRecentComplex(complexId);
                window.navigateWithTransition(`/ui/session/${data.session_id}`);
            } else {
                const errorMsg = data?.error || data?.message || "Неизвестная ошибка";
                NotificationUI.toast(`Ошибка при запуске: ${errorMsg}`, 'error');
            }
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
        const el = e.target?.closest("[data-nav]");
        if (el) window.navigateWithTransition(el.getAttribute("data-nav"));
    });
    document.addEventListener("DOMContentLoaded", initialize);
})();
