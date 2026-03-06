/**
 * Settings page - AI Keys management.
 */
(function () {
    'use strict';

    const PROVIDERS_ORDER = ['openrouter', 'gemini', 'groq'];

    const PROVIDER_ICONS = {
        openrouter: 'route',
        gemini: 'auto_awesome',
        groq: 'bolt',
    };

    const PROVIDER_COLORS = {
        openrouter: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600' },
        gemini: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600' },
        groq: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600' },
    };

    const DIAGNOSTICS_STORAGE_KEY = 'settings_provider_diagnostics_v1';
    const KEYS_DRAFT_STORAGE_KEY = 'settings_ai_keys_draft_v1';

    let _providersData = {};
    let _validationState = {}; // provider -> 'idle' | 'validating' | 'valid' | 'invalid'
    let _pendingRemovals = {}; // provider -> true if the stored key should be deleted on save
    let _providerDiagnostics = {}; // provider -> { status, checkedAt }
    let _draftWriteLocked = false;

    function composeFeedbackMessage({ what = '', impact = '', next = '' } = {}) {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.voiceMessage === 'function') {
            return NotificationUI.voiceMessage({ what, impact, next });
        }
        return [what, impact, next].filter(Boolean).join(' ');
    }

    function feedbackVariant(level = 'info') {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.resolveVariant === 'function') {
            return NotificationUI.resolveVariant(level);
        }
        const key = String(level || '').trim().toLowerCase();
        if (key === 'success' || key === 'warning' || key === 'error' || key === 'info') {
            return key;
        }
        if (key === 'blocking') {
            return 'error';
        }
        return 'info';
    }

    function loadDiagnostics() {
        try {
            const raw = localStorage.getItem(DIAGNOSTICS_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            _providerDiagnostics = parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            _providerDiagnostics = {};
        }
    }

    function saveDiagnostics() {
        try {
            localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(_providerDiagnostics || {}));
        } catch (e) {
            // Ignore localStorage write errors for diagnostics metadata.
        }
    }

    function setProviderDiagnostics(providerName, status) {
        if (!providerName) return;
        _providerDiagnostics[providerName] = {
            status: String(status || 'unknown'),
            checkedAt: Date.now(),
        };
        saveDiagnostics();
    }

    function clearProviderDiagnostics(providerName) {
        if (!providerName) return;
        if (Object.prototype.hasOwnProperty.call(_providerDiagnostics, providerName)) {
            delete _providerDiagnostics[providerName];
            saveDiagnostics();
        }
    }

    function readKeysDraft() {
        try {
            const raw = localStorage.getItem(KEYS_DRAFT_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (!parsed || typeof parsed !== 'object') return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function clearKeysDraft() {
        try {
            localStorage.removeItem(KEYS_DRAFT_STORAGE_KEY);
        } catch (e) {
            // Ignore localStorage write errors for draft metadata.
        }
    }

    function saveKeysDraft(values = {}, pendingRemovals = {}) {
        try {
            const payload = {
                savedAt: Date.now(),
                values,
                pendingRemovals,
            };
            localStorage.setItem(KEYS_DRAFT_STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            // Ignore localStorage write errors for draft metadata.
        }
    }

    function collectFormDraftState() {
        const values = {};
        let hasValues = false;
        let hasPendingRemovals = false;

        for (const name of PROVIDERS_ORDER) {
            const input = document.getElementById(`key-input-${name}`);
            const value = input ? input.value.trim() : '';
            if (value) {
                values[name] = value;
                hasValues = true;
            }
            if (_pendingRemovals[name]) {
                hasPendingRemovals = true;
            }
        }

        const pendingRemovals = {};
        for (const name of PROVIDERS_ORDER) {
            if (_pendingRemovals[name]) {
                pendingRemovals[name] = true;
            }
        }

        return { values, pendingRemovals, hasValues, hasPendingRemovals };
    }

    function persistFormDraftState() {
        if (_draftWriteLocked) return;
        const snapshot = collectFormDraftState();
        if (!snapshot.hasValues && !snapshot.hasPendingRemovals) {
            clearKeysDraft();
            updateDraftBanner();
            return;
        }
        saveKeysDraft(snapshot.values, snapshot.pendingRemovals);
        updateDraftBanner();
    }

    function formatDraftTime(savedAt) {
        const date = new Date(Number(savedAt || 0));
        if (Number.isNaN(date.getTime())) return 'недавно';
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    function applyDraftToForm(draft) {
        if (!draft || typeof draft !== 'object') return false;
        const values = draft.values && typeof draft.values === 'object' ? draft.values : {};
        const pendingRemovals = draft.pendingRemovals && typeof draft.pendingRemovals === 'object'
            ? draft.pendingRemovals
            : {};

        _draftWriteLocked = true;
        _pendingRemovals = {};
        for (const name of PROVIDERS_ORDER) {
            if (pendingRemovals[name]) _pendingRemovals[name] = true;
        }
        renderProviders({ preserveDrafts: false });
        for (const name of PROVIDERS_ORDER) {
            const input = document.getElementById(`key-input-${name}`);
            if (!input) continue;
            input.value = typeof values[name] === 'string' ? values[name] : '';
        }
        _draftWriteLocked = false;
        persistFormDraftState();
        return true;
    }

    function restoreDraftFromStorage() {
        const draft = readKeysDraft();
        if (!draft) return false;
        const restored = applyDraftToForm(draft);
        if (!restored) return false;

        showVoiceToast({
            severity: 'info',
            what: 'Черновик настроек восстановлен.',
            impact: 'Несохранённые значения снова доступны в форме.',
            next: 'Проверьте поля и нажмите «Сохранить ключи».',
        });
        return true;
    }

    function discardDraftFromStorage() {
        clearKeysDraft();
        updateDraftBanner();
        showVoiceToast({
            severity: 'info',
            what: 'Черновик настроек удалён.',
            impact: 'Форма продолжит работу с текущими данными сервера.',
            next: 'При необходимости введите новые значения вручную.',
        });
    }

    function bindDraftTrackingForInputs() {
        for (const name of PROVIDERS_ORDER) {
            const input = document.getElementById(`key-input-${name}`);
            if (!input || input.dataset.draftBound === '1') continue;
            input.dataset.draftBound = '1';
            input.addEventListener('input', persistFormDraftState);
        }
    }

    function updateDraftBanner() {
        const banner = document.getElementById('settings-draft-banner');
        const bannerText = document.getElementById('settings-draft-banner-text');
        if (!banner || !bannerText) return;

        const draft = readKeysDraft();
        if (!draft) {
            banner.classList.add('hidden');
            return;
        }

        const values = draft.values && typeof draft.values === 'object' ? draft.values : {};
        const pendingRemovals = draft.pendingRemovals && typeof draft.pendingRemovals === 'object'
            ? draft.pendingRemovals
            : {};
        const valuesCount = Object.values(values).filter((value) => String(value || '').trim().length > 0).length;
        const removalsCount = Object.keys(pendingRemovals).filter((name) => !!pendingRemovals[name]).length;
        const summaryParts = [];
        if (valuesCount > 0) summaryParts.push(`значений: ${valuesCount}`);
        if (removalsCount > 0) summaryParts.push(`отметок удаления: ${removalsCount}`);
        const summary = summaryParts.length ? summaryParts.join(', ') : 'изменений';
        bannerText.textContent = `Черновик от ${formatDraftTime(draft.savedAt)} (${summary}). Можно восстановить или удалить его.`;
        banner.classList.remove('hidden');
    }

    function resetProviderState() {
        _providersData = {};
        _validationState = {};
        _pendingRemovals = {};
    }

    async function loadKeys() {
        const container = document.getElementById('providers-container');
        if (!container) return;
        loadDiagnostics();

        try {
            const res = await fetch('/api/users/ai-keys');
            const data = await res.json();
            if (!data.ok) {
                resetProviderState();
                showVoiceToast({
                    severity: 'error',
                    what: 'Ключи AI не загружены.',
                    impact: 'Форма настроек сейчас недоступна для редактирования.',
                    next: 'Повторите загрузку страницы или нажмите «Повторить».',
                });
                container.innerHTML = renderError('Не удалось загрузить ключи');
                return;
            }

            _providersData = data.providers || {};
            _validationState = {};
            _pendingRemovals = {};
            renderProviders({ preserveDrafts: false });
        } catch (e) {
            console.error('[Settings] Failed to load AI keys:', e);
            resetProviderState();
            showVoiceToast({
                severity: 'error',
                what: 'Ключи AI не загружены из-за сетевой ошибки.',
                impact: 'Проверка и сохранение ключей временно недоступны.',
                next: 'Проверьте сеть и повторите загрузку страницы настроек.',
            });
            container.innerHTML = renderError('Ошибка сети при загрузке ключей');
        }
    }

    function renderProviders(options = {}) {
        const { preserveDrafts = true } = options;
        const container = document.getElementById('providers-container');
        if (!container) return;

        const draftValues = {};
        if (preserveDrafts) {
            for (const name of PROVIDERS_ORDER) {
                const input = document.getElementById(`key-input-${name}`);
                if (input) {
                    draftValues[name] = input.value;
                }
            }
        }

        const cards = PROVIDERS_ORDER.map((name, idx) => {
            const provider = _providersData[name] || {};
            const colors = PROVIDER_COLORS[name] || PROVIDER_COLORS.openrouter;
            const icon = PROVIDER_ICONS[name] || 'key';
            const hasKey = !!provider.has_key;
            const markedForRemoval = !!_pendingRemovals[name];
            const safeUrl = sanitizeExternalUrl(provider.url || '');
            const placeholder = markedForRemoval
                ? 'Ключ будет удален после сохранения'
                : (hasKey ? (provider.masked || '') : 'Вставьте API-ключ...');
            const validationStatus = _validationState[name] || 'idle';

            return `
            <div class="provider-card rounded-xl border ${colors.border} ${colors.bg} p-5 animate-fade-in"
                 style="animation-delay: ${idx * 80}ms">
                <div class="flex items-start justify-between gap-3 mb-4">
                    <div class="flex items-center gap-3">
                        <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-white/80 shadow-sm">
                            <span class="material-symbols-outlined ${colors.icon} text-[20px]">${icon}</span>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-text-main">${escapeHtml(provider.label || name)}</span>
                                ${name === 'openrouter' ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-fg uppercase tracking-wide">рекомендуем</span>' : ''}
                            </div>
                            <div class="text-xs text-text-secondary mt-0.5">${escapeHtml(provider.hint || '')}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0 ${validationStatus === 'validating' ? 'validating' : ''}">
                        ${renderStatusBadge(validationStatus, hasKey, markedForRemoval)}
                    </div>
                </div>

                <div class="flex gap-2">
                    <div class="relative flex-1">
                        <input type="password" id="key-input-${name}"
                            class="key-input block w-full rounded-lg border border-border-subtle bg-white/90 py-2.5 px-3 text-sm text-text-main placeholder:text-text-disabled focus:ring-2 focus:ring-primary focus:border-primary pr-10"
                            placeholder="${escapeHtml(placeholder)}"
                            autocomplete="off" spellcheck="false"
                            data-provider="${name}">
                        <button onclick="toggleKeyVisibility('${name}')" type="button"
                            class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-2 transition-colors"
                            title="Показать или скрыть ключ">
                            <span class="material-symbols-outlined text-text-muted text-[18px]" id="eye-icon-${name}">visibility_off</span>
                        </button>
                    </div>
                    <button onclick="validateKey('${name}')"
                        class="px-3 py-2 text-xs font-semibold rounded-lg border border-border-subtle bg-white hover:bg-surface-2 text-text-secondary transition-colors shrink-0 ${markedForRemoval ? 'opacity-50 cursor-not-allowed' : ''}"
                        id="validate-btn-${name}"
                        ${markedForRemoval ? 'disabled' : ''}
                        title="Проверить ключ">
                        <span class="material-symbols-outlined text-[16px]">verified</span>
                    </button>
                    ${hasKey || markedForRemoval ? `
                    <button onclick="toggleKeyRemoval('${name}')"
                        type="button"
                        class="px-3 py-2 text-xs font-semibold rounded-lg border border-border-subtle bg-white hover:bg-surface-2 ${markedForRemoval ? 'text-warning-dark border-warning-light' : 'text-error'} transition-colors shrink-0"
                        title="${markedForRemoval ? 'Отменить удаление' : 'Удалить сохраненный ключ'}">
                        <span class="material-symbols-outlined text-[16px]">${markedForRemoval ? 'undo' : 'delete'}</span>
                    </button>` : ''}
                </div>

                ${markedForRemoval ? `
                <div class="mt-2 text-xs font-medium text-warning-dark">
                    Ключ будет удален после сохранения.
                </div>` : ''}

                ${renderProviderDiagnostics(name, validationStatus, hasKey, markedForRemoval)}

                ${safeUrl ? `
                <div class="mt-3 flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-text-disabled">open_in_new</span>
                    <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener"
                       class="text-xs text-primary hover:underline font-medium">Получить ключ</a>
                </div>` : ''}
            </div>`;
        });

        container.innerHTML = cards.join('');

        if (preserveDrafts) {
            for (const name of PROVIDERS_ORDER) {
                if (!draftValues[name]) continue;
                const input = document.getElementById(`key-input-${name}`);
                if (input) {
                    input.value = draftValues[name];
                }
            }
        }

        bindDraftTrackingForInputs();
        updateDraftBanner();
    }

    function renderStatusBadge(status, hasKey, markedForRemoval = false) {
        if (markedForRemoval) {
            return '<span class="status-dot bg-warning"></span><span class="text-xs text-warning-text font-medium">Будет удален</span>';
        }

        switch (status) {
            case 'validating':
                return '<span class="status-dot bg-warning"></span><span class="text-xs text-warning-text font-medium">Проверка...</span>';
            case 'valid':
                return '<span class="status-dot bg-success"></span><span class="text-xs text-success-text font-medium">Работает</span>';
            case 'invalid':
                return '<span class="status-dot bg-error"></span><span class="text-xs text-error font-medium">Недействителен</span>';
            default:
                if (hasKey) {
                    return '<span class="status-dot bg-success"></span><span class="text-xs text-success-text font-medium">Настроен</span>';
                }
                return '<span class="status-dot bg-border-subtle"></span><span class="text-xs text-text-disabled">Не настроен</span>';
        }
    }

    function renderProviderDiagnostics(providerName, validationStatus, hasKey, markedForRemoval) {
        const diag = _providerDiagnostics[providerName];
        const checkedAt = diag && Number.isFinite(diag.checkedAt) ? new Date(diag.checkedAt) : null;
        const checkedAtText = checkedAt && !Number.isNaN(checkedAt.getTime())
            ? `${checkedAt.toLocaleDateString()} ${checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '';

        let line = '';
        let toneClass = 'text-text-secondary';

        if (markedForRemoval) {
            line = 'После сохранения ключ будет удалён. Диагностика сбросится автоматически.';
            toneClass = 'text-warning-text';
        } else if (validationStatus === 'validating') {
            line = 'Проверяем доступность провайдера и валидность ключа...';
            toneClass = 'text-warning-text';
        } else if (diag?.status === 'valid') {
            line = checkedAtText
                ? `Последняя успешная проверка: ${checkedAtText}.`
                : 'Ключ проходил проверку ранее.';
            toneClass = 'text-success-text';
        } else if (diag?.status === 'invalid') {
            line = checkedAtText
                ? `Последняя проверка не пройдена (${checkedAtText}). Проверьте ключ или провайдера.`
                : 'Последняя проверка не пройдена. Проверьте ключ.';
            toneClass = 'text-error-text';
        } else if (hasKey) {
            line = 'Ключ сохранён. Рекомендуется выполнить проверку перед генерацией.';
        } else {
            line = 'Ключ не задан. Без него AI-генерация будет недоступна.';
        }

        return `<div class="provider-diagnostics mt-3 rounded-lg px-3 py-2 text-[11px] ${toneClass}">${escapeHtml(line)}</div>`;
    }

    function renderError(message) {
        return `
        <div class="text-center py-12">
            <span class="material-symbols-outlined text-error text-[32px]">error</span>
            <p class="text-sm text-text-secondary mt-2">${escapeHtml(message)}</p>
            <button onclick="loadKeys()" class="mt-3 text-sm text-primary hover:underline">Повторить</button>
        </div>`;
    }

    // Legacy handler kept for backward compatibility with stale inline bindings.
    // Main path uses saveKeysProduct (window.saveKeys is bound below).
    async function saveKeys() {
        const btn = document.getElementById('save-keys-btn');
        const statusEl = document.getElementById('save-status');
        if (!btn || !statusEl) return;

        const hasProviderInputs = PROVIDERS_ORDER.some((name) => !!document.getElementById(`key-input-${name}`));
        if (!hasProviderInputs) {
            statusEl.textContent = 'Сначала загрузите ключи';
            statusEl.className = 'text-sm text-error font-medium';
            showToast('Не удалось загрузить текущие ключи. Сначала повторите загрузку.', 'error');
            setTimeout(() => {
                statusEl.textContent = '';
            }, 4000);
            return;
        }

        btn.disabled = true;
        statusEl.textContent = 'Сохранение...';
        statusEl.className = 'text-sm text-text-muted';

        const payload = {};
        for (const name of PROVIDERS_ORDER) {
            const input = document.getElementById(`key-input-${name}`);
            const value = input ? input.value.trim() : '';
            if (value) {
                payload[name] = value;
            } else if (_pendingRemovals[name]) {
                payload[name] = '';
            }
        }

        try {
            const res = await fetch('/api/users/ai-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keys: payload }),
            });
            const data = await res.json();

            if (data.ok) {
                statusEl.textContent = 'Сохранено!';
                statusEl.className = 'text-sm text-success-text font-medium';
                await loadKeys();
                return;
            }

            statusEl.textContent = data.error || 'Ошибка сохранения';
            statusEl.className = 'text-sm text-error font-medium';
        } catch (e) {
            console.error('[Settings] Save failed:', e);
            statusEl.textContent = 'Ошибка сети';
            statusEl.className = 'text-sm text-error font-medium';
        } finally {
            btn.disabled = false;
            setTimeout(() => {
                statusEl.textContent = '';
            }, 4000);
        }
    }

    // Legacy handler kept for backward compatibility with stale inline bindings.
    // Main path uses validateKeyProduct (window.validateKey is bound below).
    async function validateKey(providerName) {
        if (_pendingRemovals[providerName]) {
            showToast('Снимите отметку удаления перед проверкой ключа', 'warning');
            return;
        }

        const input = document.getElementById(`key-input-${providerName}`);
        const key = input ? input.value.trim() : '';
        if (!key) {
            showToast('Введите ключ для проверки', 'warning');
            return;
        }

        _validationState[providerName] = 'validating';
        renderProviders();

        try {
            const res = await fetch('/api/users/ai-keys/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: providerName, api_key: key }),
            });
            const data = await res.json();

            if (data.ok && data.valid) {
                _validationState[providerName] = 'valid';
                showToast(`${_providersData[providerName]?.label || providerName}: ключ действителен`, 'success');
            } else {
                _validationState[providerName] = 'invalid';
                showToast(`${_providersData[providerName]?.label || providerName}: ключ недействителен`, 'error');
            }
        } catch (e) {
            _validationState[providerName] = 'invalid';
            showToast('Ошибка сети при проверке ключа', 'error');
        }

        renderProviders();
    }

    async function saveKeysProduct() {
        const btn = document.getElementById('save-keys-btn');
        const validateAllBtn = document.getElementById('validate-all-btn');
        const statusEl = document.getElementById('save-status');
        if (!btn || !statusEl) return;

        const hasProviderInputs = PROVIDERS_ORDER.some((name) => !!document.getElementById(`key-input-${name}`));
        if (!hasProviderInputs) {
            statusEl.textContent = 'Сначала загрузите ключи';
            statusEl.className = 'text-sm text-error font-medium';
            showVoiceToast({
                severity: 'blocking',
                what: 'Не удалось сохранить ключи.',
                impact: 'Текущее состояние ключей осталось без изменений.',
                next: 'Сначала повторите загрузку страницы настроек.',
            });
            setTimeout(() => { statusEl.textContent = ''; }, 4000);
            return;
        }

        btn.disabled = true;
        if (validateAllBtn) validateAllBtn.disabled = true;
        statusEl.textContent = 'Сохранение...';
        statusEl.className = 'text-sm text-text-muted';

        const payload = {};
        const removedProviders = [];
        for (const name of PROVIDERS_ORDER) {
            const input = document.getElementById(`key-input-${name}`);
            const value = input ? input.value.trim() : '';
            if (value) {
                payload[name] = value;
            } else if (_pendingRemovals[name]) {
                payload[name] = '';
                removedProviders.push(name);
            }
        }

        try {
            const res = await fetch('/api/users/ai-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keys: payload }),
            });
            const data = await res.json();

            if (data.ok) {
                removedProviders.forEach((provider) => clearProviderDiagnostics(provider));
                clearKeysDraft();
                statusEl.textContent = 'Сохранено';
                statusEl.className = 'text-sm text-success-text font-medium';
                showVoiceToast({
                    severity: 'success',
                    what: 'Ключи сохранены.',
                    impact: removedProviders.length
                        ? `Удалено ключей: ${removedProviders.length}. Остальные данные не затронуты.`
                        : 'Данные ключей обновлены без потерь.',
                    next: 'При необходимости выполните проверку ключей.',
                });
                await loadKeys();
                return;
            }

            statusEl.textContent = data.error || 'Ошибка сохранения';
            statusEl.className = 'text-sm text-error font-medium';
            showVoiceToast({
                severity: 'error',
                what: 'Сохранение ключей завершилось ошибкой.',
                impact: 'Изменения не были применены.',
                next: 'Проверьте значения ключей и повторите попытку.',
            });
        } catch (e) {
            console.error('[Settings] Save failed:', e);
            statusEl.textContent = 'Ошибка сети';
            statusEl.className = 'text-sm text-error font-medium';
            showVoiceToast({
                severity: 'error',
                what: 'Сохранение ключей недоступно из-за сетевой ошибки.',
                impact: 'Изменения не были отправлены.',
                next: 'Проверьте сеть и повторите сохранение.',
            });
        } finally {
            btn.disabled = false;
            if (validateAllBtn) validateAllBtn.disabled = false;
            setTimeout(() => {
                statusEl.textContent = '';
            }, 4000);
        }
    }

    async function validateKeyProduct(providerName, options = {}) {
        const { silent = false } = options;

        if (_pendingRemovals[providerName]) {
            if (!silent) {
                showVoiceToast({
                    severity: 'warning',
                    what: 'Проверка пропущена.',
                    impact: 'Провайдер отмечен на удаление.',
                    next: 'Снимите отметку удаления, если хотите проверить ключ.',
                });
            }
            return { ok: false, code: 'marked_for_removal' };
        }

        const input = document.getElementById(`key-input-${providerName}`);
        const key = input ? input.value.trim() : '';
        if (!key) {
            if (!silent) {
                showVoiceToast({
                    severity: 'warning',
                    what: 'Проверка невозможна.',
                    impact: 'Ключ не задан.',
                    next: 'Введите ключ и повторите проверку.',
                });
            }
            return { ok: false, code: 'missing_key' };
        }

        _validationState[providerName] = 'validating';
        renderProviders();

        try {
            const res = await fetch('/api/users/ai-keys/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: providerName, api_key: key }),
            });
            const data = await res.json();
            const providerLabel = _providersData[providerName]?.label || providerName;

            if (data.ok && data.valid) {
                _validationState[providerName] = 'valid';
                setProviderDiagnostics(providerName, 'valid');
                if (!silent) {
                    showVoiceToast({
                        severity: 'success',
                        what: `${providerLabel}: ключ принят.`,
                        impact: 'Провайдер доступен для генерации.',
                        next: 'Можно сохранять изменения и продолжать работу.',
                    });
                }
                renderProviders();
                return { ok: true, code: 'valid' };
            }

            _validationState[providerName] = 'invalid';
            setProviderDiagnostics(providerName, 'invalid');
            if (!silent) {
                showVoiceToast({
                    severity: 'error',
                    what: `${providerLabel}: ключ не прошёл проверку.`,
                    impact: 'Генерация через этого провайдера может не работать.',
                    next: 'Проверьте ключ и выполните повторную проверку.',
                });
            }
            renderProviders();
            return { ok: false, code: 'invalid' };
        } catch (e) {
            _validationState[providerName] = 'invalid';
            setProviderDiagnostics(providerName, 'invalid');
            if (!silent) {
                showVoiceToast({
                    severity: 'error',
                    what: 'Проверка ключа завершилась сетевой ошибкой.',
                    impact: 'Статус провайдера не подтверждён.',
                    next: 'Проверьте сеть и повторите проверку.',
                });
            }
            renderProviders();
            return { ok: false, code: 'network_error' };
        }
    }

    async function validateAllKeys() {
        const btn = document.getElementById('validate-all-btn');
        if (btn) btn.disabled = true;

        const candidates = PROVIDERS_ORDER.filter((providerName) => {
            if (_pendingRemovals[providerName]) return false;
            const input = document.getElementById(`key-input-${providerName}`);
            return !!(input && input.value.trim());
        });

        if (!candidates.length) {
            showVoiceToast({
                severity: 'warning',
                what: 'Массовая проверка пропущена.',
                impact: 'Не найдено ключей для проверки.',
                next: 'Введите минимум один ключ и повторите команду.',
            });
            if (btn) btn.disabled = false;
            return;
        }

        let validCount = 0;
        let invalidCount = 0;
        try {
            for (const providerName of candidates) {
                const result = await validateKeyProduct(providerName, { silent: true });
                if (result.ok) validCount += 1;
                else invalidCount += 1;
            }

            const severity = invalidCount > 0 ? 'warning' : 'success';
            showVoiceToast({
                severity,
                what: 'Пакетная проверка ключей завершена.',
                impact: `Успешно: ${validCount}. С ошибками: ${invalidCount}.`,
                next: invalidCount > 0
                    ? 'Исправьте невалидные ключи и повторите проверку.'
                    : 'Все проверенные провайдеры готовы к работе.',
            });
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function toggleKeyVisibility(providerName) {
        const input = document.getElementById(`key-input-${providerName}`);
        const icon = document.getElementById(`eye-icon-${providerName}`);
        if (!input) return;

        if (input.type === 'password') {
            input.type = 'text';
            if (icon) icon.textContent = 'visibility';
        } else {
            input.type = 'password';
            if (icon) icon.textContent = 'visibility_off';
        }
    }

    function toggleKeyRemoval(providerName) {
        const markForRemoval = !_pendingRemovals[providerName];
        const providerLabel = _providersData[providerName]?.label || providerName;
        if (markForRemoval) {
            _pendingRemovals[providerName] = true;
            delete _validationState[providerName];
            clearProviderDiagnostics(providerName);
            showVoiceToast({
                severity: 'warning',
                what: `${providerLabel}: ключ помечен на удаление.`,
                impact: 'При сохранении этот ключ будет удалён из хранилища.',
                next: 'Проверьте список удалений и нажмите «Сохранить ключи».',
            });
        } else {
            delete _pendingRemovals[providerName];
            showVoiceToast({
                severity: 'info',
                what: `${providerLabel}: удаление ключа отменено.`,
                impact: 'Ключ останется доступным до следующего сохранения.',
                next: 'При необходимости выполните проверку ключа.',
            });
        }

        renderProviders();

        if (markForRemoval) {
            const input = document.getElementById(`key-input-${providerName}`);
            if (input) input.value = '';
        }

        persistFormDraftState();
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

    function sanitizeExternalUrl(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';

        try {
            const parsed = new URL(raw, window.location.origin);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.href;
            }
        } catch (_) {
            // Ignore malformed URLs and hide the CTA.
        }

        return '';
    }

    function showVoiceToast({ severity = 'info', what = '', impact = '', next = '', timeout = 4200 } = {}) {
        const message = composeFeedbackMessage({ what, impact, next });
        if (!message) return;

        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toastVoice === 'function') {
            NotificationUI.toastVoice({ what, impact, next, severity, timeout });
            return;
        }
        showToast(message, severity, timeout);
    }

    function showToast(message, type, timeout = 3500) {
        const resolved = feedbackVariant(type);
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toast === 'function') {
            NotificationUI.toast(message, resolved, timeout);
            return;
        }

        const colors = {
            success: 'bg-success text-white',
            error: 'bg-error text-white',
            warning: 'bg-warning text-warning-dark',
            info: 'bg-info text-white',
        };
        const toast = document.createElement('div');
        toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${colors[resolved] || colors.info} transition-all opacity-0 translate-y-2`;
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
        }, timeout);
    }

    window.saveKeys = saveKeysProduct;
    window.validateKey = validateKeyProduct;
    window.validateAllKeys = validateAllKeys;
    window.toggleKeyVisibility = toggleKeyVisibility;
    window.toggleKeyRemoval = toggleKeyRemoval;
    window.loadKeys = loadKeys;
    window.restoreSettingsDraft = restoreDraftFromStorage;
    window.discardSettingsDraft = discardDraftFromStorage;

    document.addEventListener('DOMContentLoaded', () => {
        const restoreBtn = document.getElementById('settings-draft-restore-btn');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', () => {
                restoreDraftFromStorage();
            });
        }

        const discardBtn = document.getElementById('settings-draft-discard-btn');
        if (discardBtn) {
            discardBtn.addEventListener('click', () => {
                discardDraftFromStorage();
            });
        }

        loadKeys();
        updateDraftBanner();
    });
})();
