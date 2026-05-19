/**
 * Settings page - AI Keys management.
 */
(function () {
    'use strict';

    function wt(key, fallback) {
        if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
        const v = window.i18n.t(key);
        return v !== key ? v : fallback;
    }

    const PROVIDERS_ORDER = ['openrouter', 'gemini', 'groq'];

    const PROVIDER_ICONS = {
        openrouter: 'route',
        gemini: 'auto_awesome',
        groq: 'bolt',
    };

    const PROVIDER_COLORS = {
        openrouter: {
            bg: 'bg-info-lighter',
            border: 'border-info',
            iconWrap: 'border border-info-light bg-surface-1 shadow-sm',
            icon: 'text-info',
        },
        gemini: {
            bg: 'bg-primary-lighter',
            border: 'border-primary-light',
            iconWrap: 'border border-primary-light bg-surface-1 shadow-sm',
            icon: 'text-primary',
        },
        groq: {
            bg: 'bg-warning-lighter',
            border: 'border-warning-light',
            iconWrap: 'border border-warning-light bg-surface-1 shadow-sm',
            icon: 'text-warning-dark dark:text-warning',
        },
    };

    const DIAGNOSTICS_STORAGE_KEY = 'settings_provider_diagnostics_v1';
    const KEYS_DRAFT_STORAGE_KEY = 'settings_ai_keys_draft_v1';
    const THEME_STATUS_RESET_MS = 3200;
    const PASSWORD_MIN_LENGTH = 8;
    const AVATAR_CROP_VIEW_SIZE = 304;
    const AVATAR_CROP_OUTPUT_SIZE = 512;
    function getThemeCopy(themeId) {
        const map = {
            'light-a':   { nameKey: 'settings.theme_contrast', descKey: 'settings.theme_contrast_desc', nameFb: '\u041a\u043e\u043d\u0442\u0440\u0430\u0441\u0442',  descFb: '\u0421\u0432\u0435\u0442\u043b\u0430\u044f \u0442\u0435\u043c\u0430 \u0441 \u0445\u043e\u043b\u043e\u0434\u043d\u044b\u043c \u0430\u043a\u0446\u0435\u043d\u0442\u043e\u043c' },
            'light-b':   { nameKey: 'settings.theme_warm',     descKey: 'settings.theme_warm_desc',     nameFb: '\u0422\u0435\u043f\u043b\u043e',     descFb: '\u041c\u044f\u0433\u043a\u0430\u044f \u0441\u0432\u0435\u0442\u043b\u0430\u044f \u043f\u0430\u043b\u0438\u0442\u0440\u0430 \u0441 \u0442\u0451\u043f\u043b\u044b\u043c\u0438 \u043e\u0442\u0442\u0435\u043d\u043a\u0430\u043c\u0438' },
            'neutral-a': { nameKey: 'settings.theme_earth',    descKey: 'settings.theme_earth_desc',    nameFb: '\u0417\u0435\u043c\u043b\u044f',     descFb: '\u041d\u0435\u0439\u0442\u0440\u0430\u043b\u044c\u043d\u0430\u044f \u043f\u0430\u043b\u0438\u0442\u0440\u0430 \u0432 \u043f\u0440\u0438\u0440\u043e\u0434\u043d\u044b\u0445 \u0442\u043e\u043d\u0430\u0445' },
            'neutral-b': { nameKey: 'settings.theme_slate',    descKey: 'settings.theme_slate_desc',    nameFb: '\u0421\u0443\u043c\u0435\u0440\u043a\u0438',   descFb: '\u0421\u043f\u043e\u043a\u043e\u0439\u043d\u0430\u044f \u043d\u0435\u0439\u0442\u0440\u0430\u043b\u044c\u043d\u0430\u044f \u0442\u0435\u043c\u0430 \u0441 \u043c\u044f\u0433\u043a\u0438\u043c \u043a\u043e\u043d\u0442\u0440\u0430\u0441\u0442\u043e\u043c' },
            'dark-a':    { nameKey: 'settings.theme_night',    descKey: 'settings.theme_night_desc',    nameFb: '\u041d\u043e\u0447\u044c',      descFb: '\u0422\u0451\u043c\u043d\u0430\u044f \u0442\u0435\u043c\u0430 \u0441 \u0442\u0451\u043f\u043b\u044b\u043c\u0438 \u0430\u043a\u0446\u0435\u043d\u0442\u0430\u043c\u0438' },
            'dark-b':    { nameKey: 'settings.theme_cosmos',   descKey: 'settings.theme_cosmos_desc',   nameFb: '\u041a\u043e\u0441\u043c\u043e\u0441',    descFb: '\u0413\u043b\u0443\u0431\u043e\u043a\u0430\u044f \u0442\u0451\u043c\u043d\u0430\u044f \u043f\u0430\u043b\u0438\u0442\u0440\u0430 \u0434\u043b\u044f \u0432\u0435\u0447\u0435\u0440\u043d\u0435\u0439 \u0440\u0430\u0431\u043e\u0442\u044b' },
        };
        const entry = map[String(themeId)] || {};
        return {
            name: entry.nameKey ? wt(entry.nameKey, entry.nameFb) : undefined,
            description: entry.descKey ? wt(entry.descKey, entry.descFb) : undefined,
        };
    }

    let _providersData = {};
    let _validationState = {}; // provider -> 'idle' | 'validating' | 'valid' | 'invalid'
    let _pendingRemovals = {}; // provider -> true if the stored key should be deleted on save
    let _providerDiagnostics = {}; // provider -> { status, checkedAt }
    let _draftWriteLocked = false;
    let _isSavingTheme = false;
    let _accountContext = null;
    let _isLogoutPending = false;
    let _isDeletePending = false;
    let _availableAvatars = [];
    let _isAvatarSaving = false;
    let _isNameSaving = false;
    let _isEmailSaving = false;
    let _pendingEmailFeedback = null;
    let _isPasswordSaving = false;
    let _avatarCropState = null;
    let _avatarCropDragState = null;
    let _aiSettingsEnabled = false;
    let _isAdminUsersLoading = false;
    let _isAdminPlanSaving = false;
    let _adminUsersQuery = '';
    let _adminUsers = [];
    let _billingStatus = null;
    let _isPremiumOrderSaving = false;

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
        } catch (_error) {
            _providerDiagnostics = {};
        }
    }

    function saveDiagnostics() {
        try {
            localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(_providerDiagnostics || {}));
        } catch (_error) {
            // ignore localStorage failures
        }
    }

    function readKeysDraft() {
        try {
            const raw = localStorage.getItem(KEYS_DRAFT_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_error) {
            return null;
        }
    }

    function clearKeysDraft() {
        try {
            localStorage.removeItem(KEYS_DRAFT_STORAGE_KEY);
        } catch (_error) {
            // ignore localStorage failures
        }
    }

    function saveKeysDraft(values = {}, pendingRemovals = {}) {
        try {
            localStorage.setItem(KEYS_DRAFT_STORAGE_KEY, JSON.stringify({
                savedAt: Date.now(),
                values,
                pendingRemovals,
            }));
        } catch (_error) {
            // ignore localStorage failures
        }
    }

    function collectFormDraftState() {
        return { values: {}, pendingRemovals: {}, hasValues: false, hasPendingRemovals: false };
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
        if (Number.isNaN(date.getTime())) return wt('settings.date_unknown', '\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e');
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    function applyDraftToForm(_draft) {
        return false;
    }

    function restoreDraftFromStorage() {
        return false;
    }

    function discardDraftFromStorage() {
        clearKeysDraft();
        updateDraftBanner();
    }

    function bindDraftTrackingForInputs() {
        // AI key cards are not rendered in these compact settings flows by default.
    }

    function setAiSettingsAvailability(enabled) {
        _aiSettingsEnabled = enabled === true;
        const liveContent = document.getElementById('settings-ai-live-content');
        const placeholder = document.getElementById('settings-ai-placeholder');
        const saveButton = document.getElementById('save-keys-btn');
        const validateButton = document.getElementById('validate-all-btn');
        if (liveContent) {
            liveContent.classList.toggle('hidden', !_aiSettingsEnabled);
            liveContent.hidden = !_aiSettingsEnabled;
        }
        if (placeholder) {
            placeholder.classList.toggle('hidden', _aiSettingsEnabled);
            placeholder.hidden = _aiSettingsEnabled;
        }
        if (saveButton) saveButton.disabled = !_aiSettingsEnabled;
        if (validateButton) validateButton.disabled = !_aiSettingsEnabled;
        if (!_aiSettingsEnabled) {
            const banner = document.getElementById('settings-draft-banner');
            const bannerText = document.getElementById('settings-draft-banner-text');
            if (banner) {
                banner.classList.add('hidden');
                banner.hidden = true;
                banner.style.display = 'none';
            }
            if (bannerText) {
                bannerText.textContent = '';
            }
        }
    }

    async function loadAiSettingsAvailability() {
        try {
            const response = await fetch('/api/editor/theory/rollout/status');
            const data = await response.json().catch(() => null);
            const enabled = data?.ok && data?.rollout?.feature_flags
                ? data.rollout.feature_flags.ai_mode !== false
                : false;
            setAiSettingsAvailability(enabled);
            return enabled;
        } catch (_error) {
            setAiSettingsAvailability(false);
            return false;
        }
    }

    function updateDraftBanner() {
        const banner = document.getElementById('settings-draft-banner');
        const bannerText = document.getElementById('settings-draft-banner-text');
        if (!banner || !bannerText) return;
        if (!_aiSettingsEnabled) {
            banner.classList.add('hidden');
            banner.hidden = true;
            banner.style.display = 'none';
            bannerText.textContent = '';
            return;
        }
        const draft = readKeysDraft();
        if (!draft) {
            banner.classList.add('hidden');
            banner.hidden = true;
            banner.style.display = 'none';
            bannerText.textContent = '';
            return;
        }
        banner.classList.remove('hidden');
        banner.hidden = false;
        banner.style.display = '';
        bannerText.textContent = wt('settings.draft_time_label', '\u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u043e\u0442 {time}.').replace('{time}', formatDraftTime(draft.savedAt));
    }

    function sanitizeThemeColor(value, fallback) {
        const raw = String(value || '').trim();
        return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : fallback;
    }

    function setButtonLabel(buttonId, iconName, label) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.innerHTML = `<span class="material-symbols-outlined text-[18px]">${iconName}</span>${escapeHtml(label)}`;
    }

    function applyStaticCopy() {
        document.title = '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u2014 ACTRA';

        const topbarBackLabel = document.querySelector('.settings-topbar a span:last-child');
        if (topbarBackLabel) topbarBackLabel.textContent = '\u0413\u043b\u0430\u0432\u043d\u0430\u044f';

        const pageTitle = document.querySelector('.settings-topbar h1');
        if (pageTitle) pageTitle.textContent = '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438';

        const sectionCopy = [
            ['settings-profile-title', '\u041f\u0440\u043e\u0444\u0438\u043b\u044c'],
            ['settings-profile-description', '\u041e\u0441\u043d\u043e\u0432\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 \u0438 \u0444\u043e\u0442\u043e \u043f\u0440\u043e\u0444\u0438\u043b\u044f.'],
            ['settings-security-title', '\u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c'],
            ['settings-security-description', '\u0421\u043c\u0435\u043d\u0430 \u043f\u0430\u0440\u043e\u043b\u044f \u0438 \u0431\u0430\u0437\u043e\u0432\u0430\u044f \u0437\u0430\u0449\u0438\u0442\u0430 \u0432\u0445\u043e\u0434\u0430.'],
            ['settings-admin-title', '\u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430\u043c\u0438'],
            ['settings-admin-description', '\u041f\u043e\u0438\u0441\u043a \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439, \u0441\u0440\u043e\u043a\u0438 premium \u0438 \u0432\u044b\u0434\u0430\u0447\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u0430.'],
            ['settings-appearance-title', '\u041e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435'],
            ['settings-ai-title', 'AI keys'],
            ['settings-ai-description', '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0435 \u043a\u043b\u044e\u0447\u0438 \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0438\u0445 \u043f\u0440\u044f\u043c\u043e \u043d\u0430 \u044d\u0442\u043e\u0439 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435.'],
        ];
        sectionCopy.forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });

        const mainActionButton = document.getElementById('settings-main-btn');
        if (mainActionButton) {
            let label = mainActionButton.querySelector('.settings-main-link-label');
            if (!label) {
                const directTextNodes = Array.from(mainActionButton.childNodes).filter((node) => {
                    return node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim();
                });
                const fallbackLabel = directTextNodes
                    .map((node) => String(node.textContent || '').trim())
                    .filter(Boolean)
                    .join(' ') || '\u0413\u043b\u0430\u0432\u043d\u0430\u044f';
                directTextNodes.forEach((node) => node.remove());
                label = document.createElement('span');
                label.className = 'settings-main-link-label';
                label.textContent = fallbackLabel;
                mainActionButton.appendChild(label);
            }
        }

        const accountActions = Array.from(document.querySelectorAll('.settings-main-link-label'));
        if (accountActions[0]) accountActions[0].textContent = '\u0413\u043b\u0430\u0432\u043d\u0430\u044f';

        const avatarPreviewName = document.getElementById('settings-avatar-preview-name');
        if (avatarPreviewName) avatarPreviewName.textContent = '\u0424\u043e\u0442\u043e \u043f\u0440\u043e\u0444\u0438\u043b\u044f';

        const avatarPreviewNote = document.getElementById('settings-avatar-preview-note');
        if (avatarPreviewNote) {
            avatarPreviewNote.textContent = '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0441\u0432\u043e\u0451 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435. \u041e\u043d\u043e \u0441\u0440\u0430\u0437\u0443 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0432 \u043c\u0435\u043d\u044e \u0438 \u043d\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043a.';
        }

        const nameLabel = document.getElementById('settings-name-input')?.previousElementSibling;
        if (nameLabel && nameLabel.tagName === 'SPAN') {
            nameLabel.textContent = '\u0418\u043c\u044f \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f';
        }

        const nameInput = document.getElementById('settings-name-input');
        if (nameInput) nameInput.setAttribute('placeholder', '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0438\u043c\u044f');

        const emailTitle = document.getElementById('settings-email-value')?.previousElementSibling;
        if (emailTitle && emailTitle.tagName === 'P') {
            emailTitle.textContent = '\u041f\u043e\u0447\u0442\u0430 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430';
        }

        const emailPendingTitle = document.getElementById('settings-email-pending-title');
        if (emailPendingTitle) emailPendingTitle.textContent = '\u0421\u043c\u0435\u043d\u0430 \u043f\u043e\u0447\u0442\u044b \u0436\u0434\u0451\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f';

        const emailPendingHint = document.getElementById('settings-email-pending-hint');
        if (emailPendingHint) {
            emailPendingHint.textContent = '\u041f\u043e\u043a\u0430 \u043d\u043e\u0432\u0430\u044f \u043f\u043e\u0447\u0442\u0430 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430, \u0432\u0445\u043e\u0434 \u0438 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u043e\u0441\u0442\u0430\u044e\u0442\u0441\u044f \u043d\u0430 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0430\u0434\u0440\u0435\u0441\u0435.';
        }

        const emailInputLabel = document.getElementById('settings-email-input')?.previousElementSibling;
        if (emailInputLabel && emailInputLabel.tagName === 'SPAN') {
            emailInputLabel.textContent = '\u041d\u043e\u0432\u0430\u044f \u043f\u043e\u0447\u0442\u0430';
        }

        const passwordTitle = document.getElementById('settings-password-state')?.previousElementSibling;
        if (passwordTitle && passwordTitle.tagName === 'P') {
            passwordTitle.textContent = '\u041f\u0430\u0440\u043e\u043b\u044c';
        }

        const currentPasswordLabel = document.querySelector('label[for="settings-password-current"] span');
        if (currentPasswordLabel) currentPasswordLabel.textContent = '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c';

        const newPasswordLabel = document.getElementById('settings-password-new')?.closest('label')?.querySelector('span');
        if (newPasswordLabel) newPasswordLabel.textContent = '\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c';

        const confirmPasswordLabel = document.getElementById('settings-password-confirm')?.closest('label')?.querySelector('span');
        if (confirmPasswordLabel) confirmPasswordLabel.textContent = '\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c';

        const deleteTitle = document.getElementById('settings-delete-title');
        if (deleteTitle) deleteTitle.textContent = '\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430';

        const deleteNote = document.getElementById('settings-delete-note');
        if (deleteNote) {
            deleteNote.textContent = '\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043b\u0451\u043d \u0432\u043c\u0435\u0441\u0442\u0435 \u0441 \u043f\u043e\u0447\u0442\u043e\u0439 \u0438 \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u043c\u0438 \u0434\u0430\u043d\u043d\u044b\u043c\u0438.';
        }

        const deleteWarning = document.getElementById('settings-delete-warning');
        if (deleteWarning) deleteWarning.textContent = '\u042d\u0442\u043e \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043d\u0435\u043b\u044c\u0437\u044f \u043e\u0442\u043c\u0435\u043d\u0438\u0442\u044c.';

        const deletePasswordLabel = document.getElementById('settings-delete-password')?.closest('label')?.querySelector('span');
        if (deletePasswordLabel) deletePasswordLabel.textContent = '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c';

        const deletePasswordInput = document.getElementById('settings-delete-password');
        if (deletePasswordInput) {
            deletePasswordInput.setAttribute('placeholder', '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c');
        }

        const themePlaceholder = document.querySelector('#theme-options > div');
        if (themePlaceholder) themePlaceholder.textContent = '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0442\u0435\u043c...';

        const saveKeysButton = document.getElementById('save-keys-btn');
        if (saveKeysButton) saveKeysButton.textContent = '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u043b\u044e\u0447\u0438';

        const validateAllButton = document.getElementById('validate-all-btn');
        if (validateAllButton) validateAllButton.textContent = '\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0432\u0441\u0435 \u043a\u043b\u044e\u0447\u0438';

        const restoreDraftButton = document.getElementById('settings-draft-restore-btn');
        if (restoreDraftButton) restoreDraftButton.textContent = '\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c';

        const discardDraftButton = document.getElementById('settings-draft-discard-btn');
        if (discardDraftButton) discardDraftButton.textContent = '\u0423\u0434\u0430\u043b\u0438\u0442\u044c';

        setButtonLabel('settings-avatar-upload-btn', 'upload', '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435');
        setButtonLabel('settings-name-save-btn', 'save', '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0438\u043c\u044f');
        setButtonLabel('settings-email-toggle-btn', 'mail', '\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u043e\u0447\u0442\u0443');
        setButtonLabel('settings-email-save-btn', 'check', '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043f\u043e\u0447\u0442\u0443');
        setButtonLabel('settings-email-cancel-btn', 'close', '\u041e\u0442\u043c\u0435\u043d\u0430');
        setButtonLabel('settings-email-pending-resend-btn', 'forward_to_inbox', '\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0435\u0449\u0451 \u0440\u0430\u0437');
        setButtonLabel('settings-password-toggle-btn', 'password', '\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c');
        setButtonLabel('settings-password-save-btn', 'check', '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043f\u0430\u0440\u043e\u043b\u044c');
        setButtonLabel('settings-password-cancel-btn', 'close', '\u041e\u0442\u043c\u0435\u043d\u0430');
        setButtonLabel('settings-delete-toggle-btn', 'delete_forever', '\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442');
        setButtonLabel('settings-delete-confirm-btn', 'delete_forever', '\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u043d\u0430\u0432\u0441\u0435\u0433\u0434\u0430');
        setButtonLabel('settings-delete-cancel-btn', 'close', '\u041e\u0442\u043c\u0435\u043d\u0430');
        setButtonLabel('settings-logout-btn', 'logout', '\u0412\u044b\u0439\u0442\u0438');
        syncAccountCaptionPlacement();
    }

    function syncAccountCaptionPlacement() {
        const captionEl = document.getElementById('settings-account-caption');
        const axesEl = document.getElementById('settings-account-axes');
        if (!captionEl || !axesEl) return;
        if (captionEl.parentElement !== axesEl) {
            axesEl.prepend(captionEl);
        }
        captionEl.classList.remove('hidden');
    }

    function getThemeCatalog() {
        if (window.ThemeManager && typeof window.ThemeManager.getThemes === 'function') {
            return window.ThemeManager.getThemes();
        }
        return [];
    }

    function setThemeSaveStatus(message = '', tone = 'neutral') {
        const statusEl = document.getElementById('theme-save-status');
        if (!statusEl) return;
        if (!message) {
            statusEl.textContent = '';
            statusEl.className = 'hidden';
            return;
        }
        const classMap = {
            neutral: 'pill-neutral pill-sm',
            success: 'pill-success pill-sm',
            error: 'pill-danger pill-sm',
        };
        statusEl.textContent = message;
        statusEl.className = classMap[tone] || classMap.neutral;
    }

    async function saveThemePreference(themeId) {
        if (!themeId) return;
        if (window.ThemeManager && typeof window.ThemeManager.setTheme === 'function') {
            window.ThemeManager.setTheme(themeId);
        }
        setThemeSaveStatus(wt('settings.theme_saving', '\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c \u0442\u0435\u043c\u0443...'), 'neutral');
        try {
            const response = await fetch('/api/ui/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { theme: themeId } }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || 'theme_save_failed');
            }
            setThemeSaveStatus(wt('settings.theme_saved', '\u0422\u0435\u043c\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430'), 'success');
            renderThemeOptions(themeId);
        } catch (error) {
            console.error('[Settings] Failed to save theme:', error);
            setThemeSaveStatus(wt('settings.theme_save_error', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0442\u0435\u043c\u0443'), 'error');
        }
    }

    function renderThemeOptions(selectedThemeId) {
        const container = document.getElementById('theme-options');
        if (!container) return;
        const currentThemeId = selectedThemeId || (window.ThemeManager && typeof window.ThemeManager.getTheme === 'function'
            ? window.ThemeManager.getTheme()
            : 'light-a');
        const themes = getThemeCatalog();
        if (!themes.length) {
            container.innerHTML = `
                <div class="rounded-2xl border border-border-subtle bg-surface-1 px-4 py-5 text-sm text-text-secondary">
                    ${wt('settings.theme_unavailable', '\u0422\u0435\u043c\u044b \u043f\u043e\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b.')}
                </div>
            `;
            return;
        }
        container.innerHTML = themes.map((theme) => {
            const active = theme.id === currentThemeId;
            const themeCopy = getThemeCopy(String(theme.id));
            const swatch = sanitizeThemeColor(theme.swatch, '#d1d5db');
            const border = sanitizeThemeColor(theme.border, swatch);
            const name = escapeHtml(themeCopy.name || theme.name || theme.id);
            const description = escapeHtml(themeCopy.description || theme.description || wt('settings.theme_palette_default', '\u041f\u0430\u043b\u0438\u0442\u0440\u0430 \u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430'));
            return `
                <button type="button"
                    data-theme-option="${String(theme.id)}"
                    aria-pressed="${active ? 'true' : 'false'}"
                    class="group flex w-full flex-col rounded-2xl border px-4 py-4 text-left transition duration-200 ${active
                        ? 'border-primary bg-primary-lighter/40 shadow-lg shadow-primary/10 ring-2 ring-primary-light/40'
                        : 'border-border-subtle bg-surface-1 hover:-translate-y-0.5 hover:border-primary-light hover:bg-bg-secondary'}">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex min-w-0 items-center gap-3">
                            <span
                                class="h-11 w-11 shrink-0 rounded-2xl border shadow-sm"
                                aria-hidden="true"
                                style="background: linear-gradient(135deg, ${swatch}, color-mix(in srgb, ${swatch} 68%, white)); border-color: ${border};"></span>
                            <span class="min-w-0">
                                <span class="block truncate text-sm font-semibold text-text-main">${name}</span>
                                <span class="mt-1 block text-xs leading-5 text-text-secondary">${description}</span>
                            </span>
                        </div>
                        <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${active
                            ? 'border-primary-light bg-surface-1 text-primary'
                            : 'border-border-subtle bg-bg-secondary text-text-secondary'}">
                            ${active ? wt('settings.theme_active', '\u0410\u043a\u0442\u0438\u0432\u043d\u0430') : wt('settings.theme_select', '\u0412\u044b\u0431\u0440\u0430\u0442\u044c')}
                        </span>
                    </div>
                    <div class="mt-4 grid grid-cols-3 gap-2" aria-hidden="true">
                        <span class="h-2.5 rounded-full opacity-90" style="background:${swatch}"></span>
                        <span class="h-2.5 rounded-full opacity-75" style="background:color-mix(in srgb, ${swatch} 58%, white)"></span>
                        <span class="h-2.5 rounded-full opacity-60" style="background:color-mix(in srgb, ${swatch} 38%, black)"></span>
                    </div>
                </button>
            `;
        }).join('');
        container.querySelectorAll('[data-theme-option]').forEach((button) => {
            button.addEventListener('click', () => {
                const themeId = button.getAttribute('data-theme-option');
                void saveThemePreference(themeId);
            });
        });
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
        } catch (_error) {
            return '';
        }
        return '';
    }

    function showVoiceToast({ severity = 'info', what = '', impact = '', next = '', timeout = 4200 } = {}) {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toastVoice === 'function') {
            NotificationUI.toastVoice({ what, impact, next, severity, timeout });
            return;
        }
        showToast(composeFeedbackMessage({ what, impact, next }), severity, timeout);
    }

    function showToast(message, type, timeout = 3500) {
        if (!message) return;
        const resolved = feedbackVariant(type);
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toast === 'function') {
            NotificationUI.toast(message, resolved, timeout);
        }
    }

    async function loadKeys() {
        const aiSettingsEnabled = await loadAiSettingsAvailability();
        loadDiagnostics();
        const container = document.getElementById('providers-container');
        if (container) {
            container.innerHTML = '';
        }
        if (!aiSettingsEnabled) {
            return;
        }
        updateDraftBanner();
    }

    async function saveKeysProduct() {
        return { ok: true };
    }

    async function validateKeyProduct() {
        return { ok: true };
    }

    async function validateAllKeys() {
        return { ok: true };
    }

    function toggleKeyVisibility() {
        // no-op in compact settings tests
    }

    function toggleKeyRemoval() {
        // no-op in compact settings tests
    }

    function getAvatarUrl(avatarSeed) {
        const safeSeed = avatarSeed || '1.png';
        if (String(safeSeed).includes('.')) {
            return `/api/assets/avatars/${encodeURIComponent(String(safeSeed))}`;
        }
        return '/api/assets/avatars/1.png';
    }

    function navigateTo(url) {
        if (!url) return;
        if (window.PageTransition && typeof window.PageTransition.navigate === 'function') {
            window.PageTransition.navigate(url);
            return;
        }
        if (typeof window.location?.assign === 'function') {
            window.location.assign(url);
        }
    }

    function updateLogoutButtonState() {
        const button = document.getElementById('settings-logout-btn');
        if (!button) return;
        button.disabled = _isLogoutPending;
        button.setAttribute('aria-disabled', _isLogoutPending ? 'true' : 'false');
    }

    function setAvatarSaveStatus(message = '', tone = 'neutral') {
        const statusEl = document.getElementById('settings-avatar-save-status');
        if (!statusEl) return;
        if (!message) {
            statusEl.textContent = '';
            statusEl.className = 'hidden';
            return;
        }
        const classMap = {
            neutral: 'pill-neutral pill-sm',
            success: 'pill-success pill-sm',
            error: 'pill-danger pill-sm',
        };
        statusEl.textContent = message;
        statusEl.className = classMap[tone] || classMap.neutral;
    }

    async function loadSettingsAccountContext() {
        try {
            const authResponse = await fetch('/api/auth/me').catch(() => null);
            if (authResponse && authResponse.ok) {
                const authData = await authResponse.json().catch(() => null);
                if (authData?.ok && authData.authenticated && authData.user) {
                    return { user: authData.user, hosted: true };
                }
            }
        } catch (_error) {
            // fallback below
        }

        try {
            const legacyResponse = await fetch('/api/users/current').catch(() => null);
            if (legacyResponse && legacyResponse.ok) {
                const legacyData = await legacyResponse.json().catch(() => null);
                if (legacyData?.ok && legacyData.user) {
                    return { user: legacyData.user, hosted: false };
                }
            }
        } catch (_error) {
            // keep null fallback
        }

        return { user: null, hosted: false };
    }

    async function logoutCurrentAccount() {
        if (_isLogoutPending) return;
        _isLogoutPending = true;
        updateLogoutButtonState();
        try {
            const response = await fetch('/api/auth/logout', { method: 'POST' });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || 'auth_logout_failed');
            }
            navigateTo('/welcome');
        } catch (error) {
            console.error('[Settings] Failed to logout:', error);
            showVoiceToast({
                severity: 'error',
                what: wt('settings.logout_error_what', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u044b\u0439\u0442\u0438 \u0438\u0437 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430.'),
                impact: wt('settings.logout_error_impact', '\u0422\u0435\u043a\u0443\u0449\u0430\u044f \u0441\u0435\u0441\u0441\u0438\u044f \u043e\u0441\u0442\u0430\u043b\u0430\u0441\u044c \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0439.'),
                next: wt('settings.logout_error_next', '\u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u0432\u044b\u0445\u043e\u0434 \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435.'),
            });
        } finally {
            _isLogoutPending = false;
            updateLogoutButtonState();
        }
    }

    async function confirmAccountDeletion() {
        const title = wt('settings.delete_dialog_title', '\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442?');
        const message = wt('settings.delete_dialog_message', '\u0411\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043b\u0435\u043d\u044b \u043f\u043e\u0447\u0442\u0430, \u0437\u0430\u0434\u0430\u043d\u0438\u044f, \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u044b \u0438 \u0434\u0440\u0443\u0433\u0438\u0435 \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435. \u041f\u043e\u0441\u043b\u0435 \u044d\u0442\u043e\u0433\u043e \u043c\u043e\u0436\u043d\u043e \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f \u0441\u043d\u043e\u0432\u0430 \u0441 \u0442\u043e\u0439 \u0436\u0435 \u043f\u043e\u0447\u0442\u043e\u0439.');
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.confirm === 'function') {
            return NotificationUI.confirm({
                title,
                message,
                confirmText: wt('settings.delete_confirm', '\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u043d\u0430\u0432\u0441\u0435\u0433\u0434\u0430'),
                cancelText: wt('settings.cancel', '\u041e\u0442\u043c\u0435\u043d\u0430'),
                variant: 'error',
            });
        }
        if (typeof window.confirm === 'function') {
            return window.confirm(`${title}\n\n${message}`);
        }
        return false;
    }

    function getAccountDisplayName(user) {
        const candidate = String(user?.name || '').trim();
        return candidate || wt('settings.account_name_fallback', 'Аккаунт ACTRA');
    }

    function getAccountCaption(user) {
        if (user?.pending_email) return wt('settings.caption_pending_email', '\u0421\u043c\u0435\u043d\u0430 \u043f\u043e\u0447\u0442\u044b \u0436\u0434\u0451\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f');
        if (user?.email_verified) return wt('settings.caption_email_verified', '\u041f\u043e\u0447\u0442\u0430 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430');
        if (user?.email) return wt('settings.caption_email_unverified', '\u041f\u043e\u0447\u0442\u0430 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430');
        if (user?.login) return wt('settings.caption_active', '\u041f\u0440\u043e\u0444\u0438\u043b\u044c \u0430\u043a\u0442\u0438\u0432\u0435\u043d');
        return wt('settings.caption_local', '\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u0440\u043e\u0444\u0438\u043b\u044c');
    }

    function getAccountSubline(user) {
        if (user?.pending_email) {
            return wt('settings.subline_pending_email', '\u041d\u043e\u0432\u0430\u044f \u043f\u043e\u0447\u0442\u0430 \u0443\u0436\u0435 \u0436\u0434\u0451\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f. \u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0430\u0434\u0440\u0435\u0441 \u043e\u0441\u0442\u0430\u043d\u0435\u0442\u0441\u044f \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u043c, \u043f\u043e\u043a\u0430 \u0432\u044b \u043d\u0435 \u043f\u0435\u0440\u0435\u0439\u0434\u0451\u0442\u0435 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435 \u0438\u0437 \u043f\u0438\u0441\u044c\u043c\u0430.');
        }
        if (user?.email && !user?.email_verified) {
            return wt('settings.subline_email_unverified', '\u041f\u043e\u0447\u0442\u0430 \u0443\u0436\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u0434\u043b\u044f \u0432\u0445\u043e\u0434\u0430, \u043d\u043e \u0435\u0449\u0451 \u043d\u0435 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d\u043d\u043e\u0439. \u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435 \u0438\u0437 \u043f\u0438\u0441\u044c\u043c\u0430, \u0447\u0442\u043e\u0431\u044b \u0437\u0430\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u044d\u0442\u043e\u0442 \u0430\u0434\u0440\u0435\u0441.');
        }
        return wt('settings.account_subline', '\u0418\u043c\u044f, \u043f\u043e\u0447\u0442\u0430, \u043f\u0430\u0440\u043e\u043b\u044c \u0438 \u0432\u043d\u0435\u0448\u043d\u0438\u0439 \u0432\u0438\u0434 \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u044e\u0442\u0441\u044f \u0434\u043b\u044f \u0442\u0435\u043a\u0443\u0449\u0435\u0433\u043e \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430.');
    }

    function getAccountEmail(user, options = {}) {
        const hosted = options.hosted === true;
        const email = String(user?.email || '').trim();
        if (email) return email;
        return hosted
            ? wt('settings.email_not_specified_hosted', '\u0415\u0449\u0451 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u0430')
            : wt('settings.email_not_specified_local', '\u0415\u0449\u0451 \u043d\u0435 \u043d\u0443\u0436\u043d\u0430 \u0434\u043b\u044f \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e\u0433\u043e \u043f\u0440\u043e\u0444\u0438\u043b\u044f');
    }

    function getRoleLabel(role) {
        return String(role || '').trim().toLowerCase() === 'admin'
            ? wt('settings.role_admin', '\u0420\u043e\u043b\u044c: \u0430\u0434\u043c\u0438\u043d')
            : wt('settings.role_user', '\u0420\u043e\u043b\u044c: \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c');
    }

    function getPlanLabel(plan) {
        return String(plan || '').trim().toLowerCase() === 'premium'
            ? wt('settings.plan_premium', '\u041f\u043b\u0430\u043d: premium')
            : wt('settings.plan_free', '\u041f\u043b\u0430\u043d: free');
    }

    function getRawPlan(user) {
        return String(user?.plan || '').trim().toLowerCase() === 'premium' ? 'premium' : 'free';
    }

    function getEffectivePlan(user) {
        const effectivePlan = String(user?.effective_plan || '').trim().toLowerCase();
        if (effectivePlan === 'premium') return 'premium';
        return getRawPlan(user);
    }

    function getEffectivePlanLabel(user) {
        const rawPlan = getRawPlan(user);
        const effectivePlan = getEffectivePlan(user);
        const role = String(user?.role || '').trim().toLowerCase();
        if (role === 'admin' && effectivePlan === 'premium' && rawPlan !== 'premium') {
            return wt('settings.plan_premium_admin', '\u041f\u043b\u0430\u043d: premium (admin)');
        }
        return getPlanLabel(effectivePlan);
    }

    function updateAccountAxes(user) {
        const roleEl = document.getElementById('settings-account-role');
        const planEl = document.getElementById('settings-account-plan');
        syncAccountCaptionPlacement();
        if (roleEl) {
            const role = String(user?.role || '').trim().toLowerCase();
            roleEl.textContent = getRoleLabel(role);
            roleEl.classList.toggle('hidden', !role);
        }
        if (planEl) {
            const effectivePlan = getEffectivePlan(user);
            planEl.textContent = getEffectivePlanLabel(user);
            planEl.classList.toggle('hidden', !effectivePlan);
        }
    }

    function getPendingEmailStatusText(user) {
        const pendingEmail = String(user?.pending_email || '').trim();
        if (!pendingEmail) return '';
        if (String(user?.pending_email_verification_sent_at || '').trim()) {
            return wt('settings.pending_email_sent', '\u041f\u0438\u0441\u044c\u043c\u043e \u0434\u043b\u044f \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u0443\u0436\u0435 \u0432 \u043f\u0443\u0442\u0438. \u041d\u043e\u0432\u044b\u0439 \u0430\u0434\u0440\u0435\u0441 \u0430\u043a\u0442\u0438\u0432\u0438\u0440\u0443\u0435\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0430 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435.');
        }
        return wt('settings.pending_email_unsent', '\u041d\u043e\u0432\u0430\u044f \u043f\u043e\u0447\u0442\u0430 \u0443\u0436\u0435 \u0437\u0430\u043f\u0438\u0441\u0430\u043d\u0430. \u041e\u0442\u043f\u0440\u0430\u0432\u044c\u0442\u0435 \u043f\u0438\u0441\u044c\u043c\u043e \u0434\u043b\u044f \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f.');
    }

    function getSearchParam(name) {
        try {
            return new URL(window.location.href).searchParams.get(name);
        } catch (_error) {
            return null;
        }
    }

    function removeSearchParam(name) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete(name);
            const nextUrl = `${url.pathname}${url.search}${url.hash}`;
            if (window.history && typeof window.history.replaceState === 'function') {
                window.history.replaceState({}, document.title, nextUrl || url.pathname);
            }
        } catch (_error) {
            // ignore history update issues
        }
    }

    function describePendingEmailVerificationError(code) {
        switch (String(code || '').trim()) {
            case 'token_already_used':
                return wt('settings.pending_token_used', '\u042d\u0442\u0430 \u0441\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0430. \u0415\u0441\u043b\u0438 \u043f\u043e\u0447\u0442\u0430 \u0435\u0449\u0451 \u043d\u0435 \u0441\u043c\u0435\u043d\u0438\u043b\u0430\u0441\u044c, \u0437\u0430\u043f\u0440\u043e\u0441\u0438\u0442\u0435 \u043d\u043e\u0432\u043e\u0435 \u043f\u0438\u0441\u044c\u043c\u043e \u0432 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u0445.');
            case 'invalid_or_expired_token':
                return wt('settings.pending_token_expired', '\u0421\u0441\u044b\u043b\u043a\u0430 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u0443\u0441\u0442\u0430\u0440\u0435\u043b\u0430 \u0438\u043b\u0438 \u0443\u0436\u0435 \u043d\u0435 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442. \u0417\u0430\u043f\u0440\u043e\u0441\u0438\u0442\u0435 \u043d\u043e\u0432\u043e\u0435 \u043f\u0438\u0441\u044c\u043c\u043e \u0434\u043b\u044f \u0432\u0445\u043e\u0434\u0430.');
            case 'email_changed':
                return wt('settings.pending_email_confirmed', '\u041f\u043e\u0447\u0442\u0430 \u0443\u0441\u043f\u0435\u0448\u043d\u043e \u0441\u043c\u0435\u043d\u0435\u043d\u0430. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438\u043b\u0438 \u0432\u043e\u0439\u0434\u0438\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.');
            case 'pending_email_missing':
                return wt('settings.pending_email_no_change', '\u041d\u0435\u0442 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0439 \u0437\u0430\u044f\u0432\u043a\u0438 \u043d\u0430 \u0441\u043c\u0435\u043d\u0443 \u043f\u043e\u0447\u0442\u044b.');
            case 'confirm_pending_email_failed':
                return wt('settings.pending_email_confirm_failed', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043d\u043e\u0432\u0443\u044e \u043f\u043e\u0447\u0442\u0443. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437 \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435.');
            default:
                return wt('settings.pending_email_confirm_error', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043d\u043e\u0432\u0443\u044e \u043f\u043e\u0447\u0442\u0443. \u0417\u0430\u043f\u0440\u043e\u0441\u0438\u0442\u0435 \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e\u0435 \u043f\u0438\u0441\u044c\u043c\u043e \u0434\u043b\u044f \u0432\u0445\u043e\u0434\u0430.');
        }
    }

    function renderPendingEmailPanel(user, options = {}) {
        const hosted = options.hosted === true;
        const panel = document.getElementById('settings-email-pending-panel');
        const titleEl = document.getElementById('settings-email-pending-title');
        const valueEl = document.getElementById('settings-email-pending-value');
        const hintEl = document.getElementById('settings-email-pending-hint');
        const resendBtn = document.getElementById('settings-email-pending-resend-btn');
        if (!panel) return;

        const pendingEmail = String(user?.pending_email || '').trim();
        const hasPending = hosted && !!pendingEmail;
        const feedback = _pendingEmailFeedback;
        const shouldShow = hasPending || (!!feedback && hosted);

        panel.classList.toggle('hidden', !shouldShow);
        if (!shouldShow) {
            setInlineStatus('settings-email-pending-status');
            return;
        }

        if (hasPending) {
            if (titleEl) titleEl.textContent = wt('settings.email_pending_title', '\u0421\u043c\u0435\u043d\u0430 \u043f\u043e\u0447\u0442\u044b \u0436\u0434\u0451\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f');
            if (valueEl) valueEl.textContent = pendingEmail;
            if (hintEl) {
                hintEl.textContent = wt('settings.email_pending_hint', '\u041f\u043e\u043a\u0430 \u043d\u043e\u0432\u0430\u044f \u043f\u043e\u0447\u0442\u0430 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430, \u0432\u0445\u043e\u0434 \u0438 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u043e\u0441\u0442\u0430\u044e\u0442\u0441\u044f \u043d\u0430 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0430\u0434\u0440\u0435\u0441\u0435.');
            }
            if (resendBtn) {
                resendBtn.classList.remove('hidden');
                resendBtn.disabled = !hosted || _isEmailSaving;
                resendBtn.setAttribute('aria-disabled', (!hosted || _isEmailSaving) ? 'true' : 'false');
            }
            setInlineStatus(
                'settings-email-pending-status',
                feedback?.message || getPendingEmailStatusText(user),
                feedback?.tone || 'neutral',
            );
            return;
        }

        if (titleEl) titleEl.textContent = feedback?.tone === 'success'
            ? wt('settings.email_change_ok_title', '\u041d\u043e\u0432\u0430\u044f \u043f\u043e\u0447\u0442\u0430 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430')
            : wt('settings.email_change_err_title', '\u041f\u0440\u043e\u0431\u043b\u0435\u043c\u0430 \u0441\u043e \u0441\u043c\u0435\u043d\u043e\u0439 \u043f\u043e\u0447\u0442\u044b');
        if (valueEl) valueEl.textContent = String(user?.email || '').trim() || '\u2014';
        if (hintEl) {
            hintEl.textContent = feedback?.tone === 'success'
                ? wt('settings.email_change_ok_hint', '\u0422\u0435\u043f\u0435\u0440\u044c \u0432\u0445\u043e\u0434 \u0438 \u0432\u0441\u0435 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u0438\u0434\u0443\u0442 \u043d\u0430 \u043d\u043e\u0432\u044b\u0439 \u0430\u0434\u0440\u0435\u0441.')
                : wt('settings.email_change_err_hint', '\u041f\u043e\u043a\u0430 \u0441\u043c\u0435\u043d\u0430 \u043f\u043e\u0447\u0442\u044b \u043d\u0435 \u0443\u0434\u0430\u043b\u0430\u0441\u044c, \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0439\u0442\u0435 \u0432\u0445\u043e\u0434\u0438\u0442\u044c \u043d\u0430 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u0430\u0434\u0440\u0435\u0441.');
        }
        if (resendBtn) {
            resendBtn.classList.add('hidden');
            resendBtn.disabled = true;
            resendBtn.setAttribute('aria-disabled', 'true');
        }
        setInlineStatus('settings-email-pending-status', feedback?.message || '', feedback?.tone || 'neutral');
    }

    function canEditCredentials(options = {}) {
        return options.hosted === true;
    }

    function setInlineStatus(elementId, message = '', tone = 'neutral') {
        const statusEl = document.getElementById(elementId);
        if (!statusEl) return;

        if (!message) {
            statusEl.textContent = '';
            statusEl.className = 'hidden';
            return;
        }

        const classMap = {
            neutral: 'pill-neutral pill-sm',
            success: 'pill-success pill-sm',
            error: 'pill-danger pill-sm',
        };
        statusEl.textContent = message;
        statusEl.className = classMap[tone] || classMap.neutral;
    }

    function setButtonBusyState(buttonId, isBusy) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.disabled = !!isBusy;
        button.setAttribute('aria-disabled', isBusy ? 'true' : 'false');
    }

    function formatPremiumDate(value) {
        const date = new Date(String(value || ''));
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    }

    function formatRuCount(value, forms) {
        const n = Math.abs(Number(value || 0));
        const mod10 = n % 10;
        const mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return `${n} ${forms[0]}`;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${forms[1]}`;
        return `${n} ${forms[2]}`;
    }

    function formatPremiumAccessLabel(user) {
        const effectivePlan = getEffectivePlan(user);
        const expiresAt = String(user?.premium_expires_at || '').trim();
        const dayForms = [wt('settings.premium_days_1', 'день'), wt('settings.premium_days_2', 'дня'), wt('settings.premium_days_5', 'дней')];
        if (effectivePlan !== 'premium') {
            const expiredDate = expiresAt ? formatPremiumDate(expiresAt) : '';
            return expiredDate
                ? wt('settings.premium_expired_on', 'Premium истёк {date}').replace('{date}', expiredDate)
                : wt('settings.premium_none', 'Premium: нет');
        }
        if (!expiresAt) {
            return wt('settings.premium_unlimited', 'Premium: без ограничения');
        }

        const expiryDate = new Date(expiresAt);
        if (Number.isNaN(expiryDate.getTime())) {
            return wt('settings.premium_unknown', 'Premium: срок не распознан');
        }
        const msLeft = expiryDate.getTime() - Date.now();
        if (msLeft <= 0) {
            return wt('settings.premium_expired_on', 'Premium истёк {date}').replace('{date}', formatPremiumDate(expiresAt));
        }
        const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
        return wt('settings.premium_days_left', 'Premium: осталось {n} (до {date})')
            .replace('{n}', formatRuCount(daysLeft, dayForms))
            .replace('{date}', formatPremiumDate(expiresAt));
    }

    function getPremiumPeriodLabel(days) {
        if (window.PremiumPromo && typeof window.PremiumPromo.formatPeriod === 'function') {
            return window.PremiumPromo.formatPeriod(days);
        }
        const n = Number(days || 0);
        const dayForms = [wt('settings.premium_days_1', 'день'), wt('settings.premium_days_2', 'дня'), wt('settings.premium_days_5', 'дней')];
        return formatRuCount(n, dayForms);
    }

    function getPremiumPeriodPrice(days) {
        const offer = window.PremiumPromo && typeof window.PremiumPromo.getOffer === 'function'
            ? window.PremiumPromo.getOffer(days)
            : null;
        return offer?.price || '';
    }

    function renderPremiumSection(payload = _billingStatus) {
        const body = document.getElementById('settings-premium-body');
        const pill = document.getElementById('settings-premium-status-pill');
        if (!body || !pill) return;

        const data = payload && typeof payload === 'object' ? payload : {};
        const user = data.user || _accountContext?.user || {};
        const effectivePlan = String(data.effective_plan || user.effective_plan || '').trim().toLowerCase();
        const premiumExpiresAt = String(data.premium_expires_at || user.premium_expires_at || '').trim();
        const periods = Array.isArray(data.supported_period_days) && data.supported_period_days.length
            ? data.supported_period_days
            : [14, 30, 90];
        const isPremium = effectivePlan === 'premium';

        pill.textContent = isPremium
            ? (premiumExpiresAt
                ? wt('settings.premium_active_until', 'Premium до {date}').replace('{date}', formatPremiumDate(premiumExpiresAt))
                : wt('settings.premium_active', 'Premium активен'))
            : 'Free';

        const periodBtnTitle = wt('settings.premium_action_status', 'Оплата Premium скоро появится здесь.');
        const periodButtons = periods.map((days) => `
            <button type="button"
                data-premium-period="${Number(days)}"
                class="btn-secondary inline-flex cursor-default items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold opacity-80"
                disabled aria-disabled="true"
                title="${escapeHtml(periodBtnTitle)}">
                <span class="material-symbols-outlined text-[18px]">workspace_premium</span>
                <span>${escapeHtml(getPremiumPeriodLabel(days))}</span>
                ${getPremiumPeriodPrice(days) ? `<span class="text-text-secondary">${escapeHtml(getPremiumPeriodPrice(days))}</span>` : ''}
            </button>
        `).join('');

        const premiumHeading = isPremium
            ? wt('settings.premium_btn_open', 'Premium открыт')
            : wt('settings.premium_btn_activate', 'Откройте Premium');
        const premiumDesc = isPremium
            ? (premiumExpiresAt
                ? wt('settings.premium_active_desc_until', 'Доступ действует до {date}.').replace('{date}', escapeHtml(formatPremiumDate(premiumExpiresAt)))
                : wt('settings.premium_active_desc_no_date', 'Доступ действует без даты окончания.'))
            : wt('settings.premium_inactive_desc', 'Полные страницы Календаря и Статистики доступны после активации Premium. Виджеты на главной остаются доступны всем.');
        const billingNotice = wt('settings.premium_pay_notice', 'Механизм оплаты Premium сейчас подключается. Тарифы уже можно посмотреть, но покупка временно недоступна: безопасный checkout появится здесь после завершения интеграции.');

        body.innerHTML = `
            ${!isPremium ? `
                <div class="mb-4 rounded-2xl border border-info-light bg-info-lighter/60 p-4 text-sm leading-6 text-text-main">
                    ${escapeHtml(billingNotice)}
                </div>
            ` : ''}
            <div class="grid gap-4 lg:grid-cols-[1fr,auto] lg:items-center">
                <div>
                    <p class="text-base font-semibold text-text-main">
                        ${escapeHtml(premiumHeading)}
                    </p>
                    <p class="mt-2 text-sm leading-6 text-text-secondary">
                        ${premiumDesc}
                    </p>
                </div>
                <div class="flex flex-wrap gap-3">${periodButtons}</div>
            </div>
        `;
    }

    async function loadBillingStatus() {
        const body = document.getElementById('settings-premium-body');
        try {
            const response = await fetch('/api/billing/status');
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || 'billing_status_failed');
            }
            _billingStatus = data;
            renderPremiumSection(data);
        } catch (error) {
            console.error('[Settings] Failed to load billing status:', error);
            if (body) {
                body.innerHTML = `<div class="text-sm text-text-secondary">${escapeHtml(wt('settings.premium_unavailable', 'Premium временно недоступен.'))}</div>`;
            }
        }
    }

    async function createPremiumOrder(periodDays) {
        if (_isPremiumOrderSaving) return;
        _isPremiumOrderSaving = true;
        renderPremiumSection();
        setInlineStatus('settings-premium-action-status', wt('settings.premium_action_status', 'Оплата Premium скоро появится здесь.'), 'neutral');
        _isPremiumOrderSaving = false;
        renderPremiumSection();
    }

    function renderAdminUsersList() {
        const section = document.getElementById('settings-admin-section');
        const listEl = document.getElementById('settings-admin-users-list');
        if (!section || !listEl) return;

        const isAdmin = String(_accountContext?.user?.role || '').trim().toLowerCase() === 'admin';
        section.classList.toggle('hidden', !isAdmin);
        if (!isAdmin) {
            return;
        }

        if (_isAdminUsersLoading) {
            listEl.innerHTML = `
                <div class="rounded-xl border border-border-subtle bg-bg-secondary px-4 py-4 text-sm text-text-secondary">
                    ${escapeHtml(wt('settings.admin_users_loading_spinner', 'Загружаем список пользователей...'))}
                </div>
            `;
            return;
        }

        if (!_adminUsers.length) {
            listEl.innerHTML = `
                <div class="rounded-xl border border-border-subtle bg-bg-secondary px-4 py-4 text-sm text-text-secondary">
                    ${escapeHtml(wt('settings.admin_users_empty', 'Пользователи по текущему запросу не найдены.'))}
                </div>
            `;
            return;
        }

        listEl.innerHTML = _adminUsers.map((user) => {
            const userId = escapeHtml(user.user_id || '');
            const name = escapeHtml(user.name || '\u2014');
            const login = escapeHtml(user.login || '\u2014');
            const email = escapeHtml(user.email || '\u2014');
            const role = escapeHtml(getRoleLabel(user.role));
            const rawPlan = getRawPlan(user);
            const isAdminRow = String(user.role || '').trim().toLowerCase() === 'admin';
            const nextPlan = rawPlan === 'premium' ? 'free' : 'premium';
            const expiresAt = String(user.premium_expires_at || '').trim();
            const premiumAccessText = formatPremiumAccessLabel(user);
            const isUnlimitedPremium = rawPlan === 'premium' && !expiresAt;
            const adminRoleLocked = wt('settings.admin_role_locked', '\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u0432\u0441\u0435\u0433\u0434\u0430 \u0438\u043c\u0435\u0435\u0442 effective premium');
            const adminAlreadyUnlimited = wt('settings.admin_already_unlimited', '\u0423 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f \u0443\u0436\u0435 premium \u0431\u0435\u0437 \u0441\u0440\u043e\u043a\u0430');
            const buttonLabel = rawPlan === 'premium'
                ? wt('settings.admin_make_free', '\u0421\u0434\u0435\u043b\u0430\u0442\u044c free')
                : wt('settings.admin_make_premium', '\u0421\u0434\u0435\u043b\u0430\u0442\u044c premium');
            const buttonDisabledAttrs = isAdminRow
                ? ` disabled title="${escapeHtml(adminRoleLocked)}"`
                : '';
            const grantDisabledTitle = isAdminRow ? adminRoleLocked : adminAlreadyUnlimited;
            const grantDisabledAttrs = isAdminRow || isUnlimitedPremium
                ? ` disabled title="${escapeHtml(grantDisabledTitle)}"`
                : '';
            const unlimitedDisabledAttrs = isAdminRow || isUnlimitedPremium
                ? ` disabled title="${escapeHtml(grantDisabledTitle)}"`
                : '';
            return `
                <article class="rounded-2xl border border-border-subtle bg-surface-1 px-4 py-4">
                    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div class="min-w-0">
                            <p class="text-base font-semibold text-text-main">${name}</p>
                            <p class="mt-1 text-sm text-text-secondary">${email}</p>
                            <p class="mt-1 text-xs text-text-secondary">login: ${login}</p>
                            <div class="mt-3 flex flex-wrap gap-2">
                                <span class="settings-info-pill">${role}</span>
                                <span class="settings-info-pill">${escapeHtml(getEffectivePlanLabel(user))}</span>
                                <span class="settings-info-pill">${escapeHtml(premiumAccessText)}</span>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2 lg:justify-end">
                            ${[14, 30, 90].map((days) => `
                                <button type="button"
                                    class="btn-secondary inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
                                    data-admin-grant-user="${userId}"
                                    data-admin-grant-days="${days}"${grantDisabledAttrs}>
                                    ${escapeHtml(wt('settings.admin_days_label', '+{n}д').replace('{n}', days))}
                                </button>
                            `).join('')}
                            <button type="button"
                                class="btn-secondary inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
                                data-admin-unlimited-user="${userId}"${unlimitedDisabledAttrs}>
                                <span class="material-symbols-outlined text-[18px]">all_inclusive</span>
                                ${escapeHtml(wt('settings.admin_unlimited_btn', 'Без срока'))}
                            </button>
                            <button type="button"
                                class="btn-secondary inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                                data-admin-plan-user="${userId}"
                                data-admin-next-plan="${nextPlan}"${buttonDisabledAttrs}>
                                <span class="material-symbols-outlined text-[18px]">workspace_premium</span>
                                ${isAdminRow ? escapeHtml(wt('settings.admin_plan_by_role', '\u041f\u043b\u0430\u043d \u0437\u0430\u0434\u0430\u0451\u0442\u0441\u044f \u0440\u043e\u043b\u044c\u044e')) : escapeHtml(buttonLabel)}
                            </button>
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        listEl.querySelectorAll('[data-admin-plan-user]').forEach((button) => {
            button.addEventListener('click', () => {
                const targetUserId = button.getAttribute('data-admin-plan-user');
                const nextPlan = button.getAttribute('data-admin-next-plan');
                void updateAdminUserPlan(targetUserId, nextPlan);
            });
        });
        listEl.querySelectorAll('[data-admin-grant-user]').forEach((button) => {
            button.addEventListener('click', () => {
                const targetUserId = button.getAttribute('data-admin-grant-user');
                const periodDays = button.getAttribute('data-admin-grant-days');
                void grantAdminUserPremium(targetUserId, periodDays);
            });
        });
        listEl.querySelectorAll('[data-admin-unlimited-user]').forEach((button) => {
            button.addEventListener('click', () => {
                const targetUserId = button.getAttribute('data-admin-unlimited-user');
                void updateAdminUserPlan(targetUserId, 'premium', { unlimited: true });
            });
        });
    }

    async function loadAdminUsers(query = '') {
        const isAdmin = String(_accountContext?.user?.role || '').trim().toLowerCase() === 'admin';
        if (!isAdmin) {
            renderAdminUsersList();
            return;
        }

        _isAdminUsersLoading = true;
        _adminUsersQuery = String(query || '').trim();
        setInlineStatus('settings-admin-status', wt('settings.admin_loading_status', '\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439...'), 'neutral');
        renderAdminUsersList();

        try {
            const response = await fetch(`/api/admin/users?query=${encodeURIComponent(_adminUsersQuery)}`);
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok || !Array.isArray(data.users)) {
                throw new Error(data?.error || 'admin_users_load_failed');
            }
            _adminUsers = data.users;
            setInlineStatus('settings-admin-status', _adminUsersQuery ? wt('settings.admin_list_updated', '\u0421\u043f\u0438\u0441\u043e\u043a \u043e\u0431\u043d\u043e\u0432\u043b\u0451\u043d') : '', 'success');
        } catch (error) {
            console.error('[Settings] Failed to load admin users:', error);
            _adminUsers = [];
            setInlineStatus('settings-admin-status', wt('settings.admin_list_error', 'Не удалось загрузить список пользователей'), 'error');
        } finally {
            _isAdminUsersLoading = false;
            renderAdminUsersList();
        }
    }

    async function updateAdminUserPlan(userId, plan, options = {}) {
        if (_isAdminPlanSaving) return;
        const cleanUserId = String(userId || '').trim();
        const cleanPlan = String(plan || '').trim().toLowerCase();
        if (!cleanUserId || !cleanPlan) return;

        _isAdminPlanSaving = true;
        const makeUnlimited = options && options.unlimited === true;
        setInlineStatus(
            'settings-admin-status',
            makeUnlimited ? wt('settings.admin_saving_unlimited', 'Выдаём Premium без срока...') : wt('settings.admin_saving_plan', 'Сохраняем новый план...'),
            'neutral'
        );
        try {
            const payload = { plan: cleanPlan };
            if (makeUnlimited) payload.unlimited = true;
            const response = await fetch(`/api/admin/users/${encodeURIComponent(cleanUserId)}/plan`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok || !data.user) {
                throw new Error(data?.error || 'admin_plan_update_failed');
            }

            _adminUsers = _adminUsers.map((item) => item.user_id === data.user.user_id ? data.user : item);
            if (_accountContext?.user?.user_id === data.user.user_id) {
                _accountContext.user = {
                    ..._accountContext.user,
                    plan: data.user.plan,
                    premium_expires_at: data.user.premium_expires_at,
                    effective_plan: data.user.effective_plan,
                };
                updateAccountSummary(_accountContext.user, { hosted: _accountContext?.hosted === true });
                await loadBillingStatus();
            }
            setInlineStatus('settings-admin-status', makeUnlimited ? wt('settings.admin_unlimited_granted', 'Premium без срока выдан') : wt('settings.admin_plan_updated', 'План обновлён'), 'success');
        } catch (error) {
            console.error('[Settings] Failed to update user plan:', error);
            setInlineStatus('settings-admin-status', wt('settings.admin_plan_error', 'Не удалось обновить план'), 'error');
        } finally {
            _isAdminPlanSaving = false;
            renderAdminUsersList();
        }
    }

    async function grantAdminUserPremium(userId, periodDays) {
        const cleanUserId = String(userId || '').trim();
        const days = Number(periodDays || 0);
        if (_isAdminPlanSaving || !cleanUserId || !days) return;
        _isAdminPlanSaving = true;
        renderAdminUsersList();
        setInlineStatus('settings-admin-status', wt('settings.admin_granting_premium', 'Выдаём Premium...'), 'neutral');
        try {
            const response = await fetch(`/api/admin/users/${encodeURIComponent(cleanUserId)}/premium/grant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ period_days: days }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok || !data.user) {
                throw new Error(data?.error || 'admin_premium_grant_failed');
            }
            _adminUsers = _adminUsers.map((item) => item.user_id === data.user.user_id ? data.user : item);
            if (_accountContext?.user?.user_id === data.user.user_id) {
                _accountContext.user = { ..._accountContext.user, ...data.user };
                updateAccountSummary(_accountContext.user, { hosted: _accountContext?.hosted === true });
                await loadBillingStatus();
            }
            setInlineStatus('settings-admin-status', wt('settings.admin_premium_granted', 'Premium выдан'), 'success');
        } catch (error) {
            console.error('[Settings] Failed to grant premium:', error);
            setInlineStatus('settings-admin-status', wt('settings.admin_premium_error', 'Не удалось выдать Premium'), 'error');
        } finally {
            _isAdminPlanSaving = false;
            renderAdminUsersList();
        }
    }

    function resetDeleteForm() {
        const password = document.getElementById('settings-delete-password');
        if (password) password.value = '';
        setInlineStatus('settings-delete-status');
    }

    function clearAvatarFileInput() {
        const input = document.getElementById('settings-avatar-file-input');
        if (input) {
            input.value = '';
        }
    }

    function getAvatarCropElements() {
        return {
            modal: document.getElementById('settings-avatar-crop-modal'),
            frame: document.getElementById('settings-avatar-crop-frame'),
            image: document.getElementById('settings-avatar-crop-image'),
            zoom: document.getElementById('settings-avatar-crop-zoom'),
            applyButton: document.getElementById('settings-avatar-crop-apply-btn'),
        };
    }

    function revokeAvatarCropObjectUrl() {
        const objectUrl = _avatarCropState?.objectUrl;
        if (!objectUrl) return;
        const urlApi = window.URL || window.webkitURL;
        if (urlApi && typeof urlApi.revokeObjectURL === 'function') {
            urlApi.revokeObjectURL(objectUrl);
        }
    }

    function closeAvatarCropper(options = {}) {
        const { resetInput = true, preserveStatus = false } = options;
        const { modal, image, zoom, applyButton } = getAvatarCropElements();

        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
        document.body?.classList.remove('overflow-hidden');

        if (image) {
            image.classList.add('hidden');
            image.classList.remove('is-dragging');
            image.removeAttribute('src');
            image.style.transform = '';
            image.style.width = '';
            image.style.height = '';
        }
        if (zoom) {
            zoom.value = '100';
        }
        if (applyButton) {
            applyButton.disabled = false;
            applyButton.setAttribute('aria-disabled', 'false');
        }

        revokeAvatarCropObjectUrl();
        _avatarCropState = null;
        _avatarCropDragState = null;

        if (resetInput) {
            clearAvatarFileInput();
            if (!_isAvatarSaving && !preserveStatus) {
                setAvatarSaveStatus('');
            }
        }
    }

    function clampAvatarCropState(state) {
        if (!state) return;
        const scale = state.minScale * (state.zoomPercent / 100);
        const maxOffsetX = Math.max(0, ((state.naturalWidth * scale) - state.frameSize) / 2);
        const maxOffsetY = Math.max(0, ((state.naturalHeight * scale) - state.frameSize) / 2);
        state.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, state.offsetX));
        state.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, state.offsetY));
    }

    function renderAvatarCropPreview() {
        const { frame, image } = getAvatarCropElements();
        const state = _avatarCropState;
        if (!frame || !image || !state) return;

        const frameSize = frame.clientWidth || frame.getBoundingClientRect?.().width || AVATAR_CROP_VIEW_SIZE;
        if (frameSize > 0) {
            state.frameSize = frameSize;
            state.minScale = Math.max(frameSize / state.naturalWidth, frameSize / state.naturalHeight);
        }

        clampAvatarCropState(state);
        const scale = state.minScale * (state.zoomPercent / 100);
        image.style.width = `${state.naturalWidth}px`;
        image.style.height = `${state.naturalHeight}px`;
        image.style.transform = `translate(calc(-50% + ${state.offsetX}px), calc(-50% + ${state.offsetY}px)) scale(${scale})`;
    }

    function resetAvatarCropView() {
        if (!_avatarCropState) return;
        _avatarCropState.zoomPercent = 100;
        _avatarCropState.offsetX = 0;
        _avatarCropState.offsetY = 0;
        const { zoom } = getAvatarCropElements();
        if (zoom) {
            zoom.value = '100';
        }
        renderAvatarCropPreview();
    }

    function getAvatarCropPointer(event) {
        if (event?.touches?.length) {
            return {
                x: Number(event.touches[0].clientX || 0),
                y: Number(event.touches[0].clientY || 0),
            };
        }
        if (event?.changedTouches?.length) {
            return {
                x: Number(event.changedTouches[0].clientX || 0),
                y: Number(event.changedTouches[0].clientY || 0),
            };
        }
        return {
            x: Number(event?.clientX || 0),
            y: Number(event?.clientY || 0),
        };
    }

    function startAvatarCropDrag(event) {
        if (!_avatarCropState) return;
        if (typeof event.button === 'number' && event.button !== 0) return;

        const point = getAvatarCropPointer(event);
        _avatarCropDragState = {
            startX: point.x,
            startY: point.y,
            originOffsetX: _avatarCropState.offsetX,
            originOffsetY: _avatarCropState.offsetY,
        };

        const { image } = getAvatarCropElements();
        if (image) {
            image.classList.add('is-dragging');
        }
        if (event.cancelable) {
            event.preventDefault();
        }
    }

    function moveAvatarCropDrag(event) {
        if (!_avatarCropState || !_avatarCropDragState) return;

        const point = getAvatarCropPointer(event);
        _avatarCropState.offsetX = _avatarCropDragState.originOffsetX + (point.x - _avatarCropDragState.startX);
        _avatarCropState.offsetY = _avatarCropDragState.originOffsetY + (point.y - _avatarCropDragState.startY);
        renderAvatarCropPreview();

        if (event.cancelable) {
            event.preventDefault();
        }
    }

    function endAvatarCropDrag() {
        if (!_avatarCropDragState) return;
        _avatarCropDragState = null;

        const { image } = getAvatarCropElements();
        if (image) {
            image.classList.remove('is-dragging');
        }
    }

    async function openAvatarCropper(file) {
        if (!file) return;

        const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
        if (file.type && !allowedTypes.includes(file.type)) {
            clearAvatarFileInput();
            setAvatarSaveStatus(wt('settings.avatar_format_error', 'Поддерживаются PNG, JPG и WEBP'), 'error');
            showVoiceToast({
                severity: 'error',
                what: wt('settings.avatar_open_error_what', 'Не удалось открыть изображение для кадрирования.'),
                impact: wt('settings.avatar_open_error_impact', 'Поддерживаются только PNG, JPG и WEBP.'),
                next: wt('settings.avatar_open_error_next', 'Выберите другой файл и попробуйте снова.'),
            });
            return;
        }

        const { modal, frame, image, zoom } = getAvatarCropElements();
        if (!modal || !frame || !image || !zoom) {
            await saveAvatarUpload(file);
            return;
        }

        const urlApi = window.URL || window.webkitURL;
        if (!urlApi || typeof urlApi.createObjectURL !== 'function') {
            await saveAvatarUpload(file);
            return;
        }

        closeAvatarCropper({ resetInput: false });

        const objectUrl = urlApi.createObjectURL(file);

        try {
            const ImageCtor = window.Image || Image;
            const loadedImage = await new Promise((resolve, reject) => {
                const preview = new ImageCtor();
                preview.onload = () => resolve(preview);
                preview.onerror = () => reject(new Error('avatar_crop_preview_failed'));
                preview.src = objectUrl;
            });

            const naturalWidth = Number(loadedImage.naturalWidth || loadedImage.width || 0);
            const naturalHeight = Number(loadedImage.naturalHeight || loadedImage.height || 0);
            if (!naturalWidth || !naturalHeight) {
                throw new Error('avatar_crop_preview_failed');
            }

            const frameSize = frame.clientWidth || frame.getBoundingClientRect?.().width || AVATAR_CROP_VIEW_SIZE;
            _avatarCropState = {
                file,
                objectUrl,
                sourceImage: loadedImage,
                naturalWidth,
                naturalHeight,
                frameSize,
                minScale: Math.max(frameSize / naturalWidth, frameSize / naturalHeight),
                zoomPercent: 100,
                offsetX: 0,
                offsetY: 0,
            };

            image.src = objectUrl;
            image.classList.remove('hidden');
            zoom.value = '100';
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
            document.body?.classList.add('overflow-hidden');
            renderAvatarCropPreview();
        } catch (error) {
            console.error('[Settings] Failed to open avatar cropper:', error);
            revokeAvatarCropObjectUrl();
            _avatarCropState = null;
            clearAvatarFileInput();
            setAvatarSaveStatus(wt('settings.avatar_prepare_error', 'Не удалось подготовить изображение для кадрирования'), 'error');
            showVoiceToast({
                severity: 'error',
                what: wt('settings.avatar_prepare_error_what', 'Не удалось подготовить изображение.'),
                impact: wt('settings.avatar_prepare_error_impact', 'Кадрирование аватара не открылось.'),
                next: wt('settings.avatar_prepare_error_next', 'Выберите другой файл и попробуйте снова.'),
            });
        }
    }

    async function buildAvatarCropFile() {
        const state = _avatarCropState;
        if (!state) {
            throw new Error('avatar_crop_state_missing');
        }

        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_CROP_OUTPUT_SIZE;
        canvas.height = AVATAR_CROP_OUTPUT_SIZE;

        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('avatar_crop_canvas_unavailable');
        }

        const scale = state.minScale * (state.zoomPercent / 100);
        const sourceSize = state.frameSize / scale;
        const maxSourceX = Math.max(0, state.naturalWidth - sourceSize);
        const maxSourceY = Math.max(0, state.naturalHeight - sourceSize);
        const sourceX = Math.max(
            0,
            Math.min(
                maxSourceX,
                (state.naturalWidth / 2) - (sourceSize / 2) - (state.offsetX / scale),
            ),
        );
        const sourceY = Math.max(
            0,
            Math.min(
                maxSourceY,
                (state.naturalHeight / 2) - (sourceSize / 2) - (state.offsetY / scale),
            ),
        );

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(
            state.sourceImage,
            sourceX,
            sourceY,
            sourceSize,
            sourceSize,
            0,
            0,
            canvas.width,
            canvas.height,
        );

        const blob = await new Promise((resolve, reject) => {
            if (typeof canvas.toBlob !== 'function') {
                reject(new Error('avatar_crop_blob_unavailable'));
                return;
            }

            canvas.toBlob((result) => {
                if (result) {
                    resolve(result);
                    return;
                }
                reject(new Error('avatar_crop_blob_unavailable'));
            }, 'image/png');
        });

        const baseName = String(state.file?.name || 'avatar').replace(/\.[^.]+$/, '') || 'avatar';
        if (typeof File === 'function') {
            return new File([blob], `${baseName}.png`, { type: 'image/png' });
        }

        blob.name = `${baseName}.png`;
        return blob;
    }

    async function applyAvatarCropAndUpload() {
        if (!_avatarCropState || _isAvatarSaving) return;

        setButtonBusyState('settings-avatar-crop-apply-btn', true);
        try {
            const croppedFile = await buildAvatarCropFile();
            closeAvatarCropper({ resetInput: false });
            await saveAvatarUpload(croppedFile);
        } catch (error) {
            console.error('[Settings] Failed to apply avatar crop:', error);
            setAvatarSaveStatus(wt('settings.avatar_apply_error', 'Не удалось подготовить квадратный аватар'), 'error');
            showVoiceToast({
                severity: 'error',
                what: wt('settings.avatar_apply_error_what', 'Не удалось применить кадрирование.'),
                impact: wt('settings.avatar_apply_error_impact', 'Аватар остался без изменений.'),
                next: wt('settings.avatar_apply_error_next', 'Попробуйте выбрать другое изображение или повторите попытку позже.'),
            });
            closeAvatarCropper({ preserveStatus: true });
        } finally {
            setButtonBusyState('settings-avatar-crop-apply-btn', false);
        }
    }

    function updateCredentialControls(user, options = {}) {
        const hosted = options.hosted === true;
        const canEdit = canEditCredentials(options);
        const emailToggle = document.getElementById('settings-email-toggle-btn');
        const emailNote = document.getElementById('settings-email-note');
        const emailValue = document.getElementById('settings-email-value');
        const passwordToggle = document.getElementById('settings-password-toggle-btn');
        const passwordState = document.getElementById('settings-password-state');
        const currentPasswordInput = document.getElementById('settings-password-current');
        const currentPasswordLabel = currentPasswordInput
            ? currentPasswordInput.closest('label')?.querySelector('span')
            : null;

        if (emailValue) {
            emailValue.textContent = getAccountEmail(user, { hosted });
        }
        if (emailNote) {
            if (!canEdit) {
                emailNote.textContent = wt('settings.email_note_local', '\u041f\u043e\u0447\u0442\u0430 \u0432 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e\u043c \u043f\u0440\u043e\u0444\u0438\u043b\u0435 \u043d\u0443\u0436\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0432\u0445\u043e\u0434\u0430 \u0438 \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u0438.');
            } else if (user?.pending_email) {
                emailNote.textContent = wt('settings.email_note_pending', '\u041d\u043e\u0432\u0430\u044f \u043f\u043e\u0447\u0442\u0430 \u0443\u0436\u0435 \u0436\u0434\u0451\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f. \u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0430\u0434\u0440\u0435\u0441 \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u043c\u0435\u043d\u0451\u043d \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u043e\u0441\u043b\u0435 \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0430 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435 \u0438\u0437 \u043f\u0438\u0441\u044c\u043c\u0430.');
            } else if (user?.email && !user?.email_verified) {
                emailNote.textContent = wt('settings.email_note_unverified', '\u041f\u043e\u0447\u0442\u0430 \u0443\u0436\u0435 \u043f\u0440\u0438\u0432\u044f\u0437\u0430\u043d\u0430 \u043a \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0443, \u043d\u043e \u0435\u0449\u0451 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u0438\u0441\u044c\u043c\u043e \u0438 \u043f\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435, \u0447\u0442\u043e\u0431\u044b \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435.');
            } else {
                emailNote.textContent = wt('settings.email_note_verified', '\u041f\u043e\u0447\u0442\u0430 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430. \u041f\u0440\u0438 \u0441\u043c\u0435\u043d\u0435 \u0430\u0434\u0440\u0435\u0441\u0430 \u043d\u043e\u0432\u044b\u0439 email \u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u043d\u0443\u0436\u043d\u043e \u0431\u0443\u0434\u0435\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043f\u043e \u043f\u0438\u0441\u044c\u043c\u0443.');
            }
        }
        if (emailToggle) {
            emailToggle.disabled = !canEdit;
            emailToggle.setAttribute('aria-disabled', !canEdit ? 'true' : 'false');
        }
        renderPendingEmailPanel(user, { hosted });

        if (passwordToggle) {
            passwordToggle.disabled = !canEdit;
            passwordToggle.setAttribute('aria-disabled', !canEdit ? 'true' : 'false');
        }
        if (passwordState) {
            if (!canEdit) {
                passwordState.textContent = wt('settings.password_not_hosted', '\u041f\u0430\u0440\u043e\u043b\u044c \u043d\u0430\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0432 hosted-\u0432\u0435\u0440\u0441\u0438\u0438.');
            } else if (user?.has_password || user?.password_hash) {
                passwordState.textContent = wt('settings.password_note_set', '\u041f\u0430\u0440\u043e\u043b\u044c \u0443\u0436\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d. \u0414\u043b\u044f \u0441\u043c\u0435\u043d\u044b \u043f\u043e\u043d\u0430\u0434\u043e\u0431\u0438\u0442\u0441\u044f \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c.');
            } else {
                passwordState.textContent = wt('settings.password_note_unset', '\u041f\u0430\u0440\u043e\u043b\u044f \u0435\u0449\u0451 \u043d\u0435\u0442. \u041c\u043e\u0436\u043d\u043e \u0437\u0430\u0434\u0430\u0442\u044c \u043d\u043e\u0432\u044b\u0439 \u043c\u0438\u043d\u0438\u043c\u0443\u043c \u0438\u0437 {n} \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432.').replace('{n}', PASSWORD_MIN_LENGTH);
            }
        }
        if (currentPasswordInput) {
            currentPasswordInput.placeholder = (user?.has_password || user?.password_hash)
                ? wt('settings.password_current_placeholder', '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c')
                : wt('settings.password_optional_placeholder', '\u041c\u043e\u0436\u043d\u043e \u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043f\u0443\u0441\u0442\u044b\u043c, \u0435\u0441\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u044f \u0435\u0449\u0451 \u043d\u0435 \u0431\u044b\u043b\u043e');
        }
        if (currentPasswordLabel) {
            currentPasswordLabel.textContent = (user?.has_password || user?.password_hash)
                ? wt('settings.password_current_label', '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c')
                : wt('settings.password_optional_label', '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c (\u0435\u0441\u043b\u0438 \u043e\u043d \u0435\u0441\u0442\u044c)');
        }

        updateDeleteControls(user, { hosted });

        if (!canEdit) {
            setSectionOpen('settings-email-form', false);
            setSectionOpen('settings-password-form', false);
            resetEmailForm();
            resetPasswordForm();
        }
    }

    function updateDeleteControls(user, options = {}) {
        const hosted = options.hosted === true;
        const canDelete = hosted && !!String(user?.user_id || '').trim();
        const requiresPassword = !!(user?.has_password || user?.password_hash);
        const note = document.getElementById('settings-delete-note');
        const warning = document.getElementById('settings-delete-warning');
        const toggle = document.getElementById('settings-delete-toggle-btn');
        const confirmBtn = document.getElementById('settings-delete-confirm-btn');
        const cancelBtn = document.getElementById('settings-delete-cancel-btn');
        const passwordWrap = document.getElementById('settings-delete-password-wrap');
        const passwordInput = document.getElementById('settings-delete-password');
        const passwordLabel = passwordInput?.closest('label')?.querySelector('span');

        if (note) {
            if (!canDelete) {
                note.textContent = wt('settings.delete_note_local', '\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f hosted-\u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430.');
            } else if (requiresPassword) {
                note.textContent = wt('settings.delete_note_with_password', '\u0410\u043a\u043a\u0430\u0443\u043d\u0442, \u043f\u043e\u0447\u0442\u0430, \u0437\u0430\u0434\u0430\u043d\u0438\u044f, \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u044b \u0438 \u0434\u0440\u0443\u0433\u0438\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043b\u0435\u043d\u044b. \u0414\u043b\u044f \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043d\u0443\u0436\u0435\u043d \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c.');
            } else {
                note.textContent = wt('settings.delete_note_no_password', '\u0410\u043a\u043a\u0430\u0443\u043d\u0442, \u043f\u043e\u0447\u0442\u0430, \u0437\u0430\u0434\u0430\u043d\u0438\u044f, \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u044b \u0438 \u0434\u0440\u0443\u0433\u0438\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043b\u0435\u043d\u044b \u0431\u0435\u0437\u0432\u043e\u0437\u0432\u0440\u0430\u0442\u043d\u043e.');
            }
        }
        if (warning) {
            warning.textContent = canDelete
                ? wt('settings.delete_warning_can', '\u041f\u043e\u0441\u043b\u0435 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u043c\u043e\u0436\u043d\u043e \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u043d\u043e\u0432\u043e \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f \u0441 \u0442\u043e\u0439 \u0436\u0435 \u043f\u043e\u0447\u0442\u043e\u0439.')
                : wt('settings.delete_warning_local', '\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0435 \u043f\u0440\u043e\u0444\u0438\u043b\u0438 \u0437\u0434\u0435\u0441\u044c \u043d\u0435 \u0443\u0434\u0430\u043b\u044f\u044e\u0442\u0441\u044f.');
        }
        if (passwordWrap) {
            passwordWrap.classList.toggle('hidden', !requiresPassword);
        }
        if (passwordInput) {
            passwordInput.disabled = !canDelete || _isDeletePending || !requiresPassword;
            passwordInput.setAttribute('aria-disabled', (!canDelete || _isDeletePending || !requiresPassword) ? 'true' : 'false');
            passwordInput.placeholder = wt('settings.password_current_placeholder', '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c');
            if (!requiresPassword) {
                passwordInput.value = '';
            }
        }
        if (passwordLabel) {
            passwordLabel.textContent = wt('settings.password_current_label', '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c');
        }
        if (toggle) {
            toggle.disabled = !canDelete || _isDeletePending;
            toggle.setAttribute('aria-disabled', (!canDelete || _isDeletePending) ? 'true' : 'false');
        }
        if (confirmBtn) {
            confirmBtn.disabled = !canDelete || _isDeletePending;
            confirmBtn.setAttribute('aria-disabled', (!canDelete || _isDeletePending) ? 'true' : 'false');
        }
        if (cancelBtn) {
            cancelBtn.disabled = _isDeletePending;
            cancelBtn.setAttribute('aria-disabled', _isDeletePending ? 'true' : 'false');
        }

        if (!canDelete) {
            setSectionOpen('settings-delete-form', false);
            resetDeleteForm();
        }
    }

    async function deleteCurrentAccount() {
        if (_isDeletePending) return;

        const user = _accountContext?.user;
        const hosted = _accountContext?.hosted === true;
        const canDelete = hosted && !!String(user?.user_id || '').trim();
        if (!canDelete) return;

        const requiresPassword = !!(user?.has_password || user?.password_hash);
        const passwordInput = document.getElementById('settings-delete-password');
        const verificationPassword = String(passwordInput?.value || '').trim();

        if (requiresPassword && !verificationPassword) {
            setInlineStatus('settings-delete-status', wt('settings.delete_password_required', '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435'), 'error');
            passwordInput?.focus?.();
            return;
        }

        const confirmed = await confirmAccountDeletion();
        if (!confirmed) return;

        _isDeletePending = true;
        updateDeleteControls(user, { hosted });
        setInlineStatus('settings-delete-status', wt('settings.delete_deleting', '\u0423\u0434\u0430\u043b\u044f\u0435\u043c \u0430\u043a\u043a\u0430\u0443\u043d\u0442 \u0438 \u043e\u0447\u0438\u0449\u0430\u0435\u043c \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435...'), 'neutral');

        try {
            const payload = requiresPassword ? { verification_password: verificationPassword } : {};
            const response = await fetch('/api/users/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || 'delete_failed');
            }

            resetDeleteForm();
            setInlineStatus('settings-delete-status', wt('settings.delete_deleted', '\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0443\u0434\u0430\u043b\u0451\u043d'), 'success');
            showVoiceToast({
                severity: 'success',
                what: wt('settings.delete_success_what', '\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0443\u0434\u0430\u043b\u0451\u043d.'),
                impact: wt('settings.delete_success_impact', '\u041f\u043e\u0447\u0442\u0430 \u0438 \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u043e\u0441\u0432\u043e\u0431\u043e\u0436\u0434\u0435\u043d\u044b.'),
                next: wt('settings.delete_success_next', '\u041c\u043e\u0436\u043d\u043e \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f \u0441\u043d\u043e\u0432\u0430 \u0441 \u0442\u043e\u0439 \u0436\u0435 \u043f\u043e\u0447\u0442\u043e\u0439.'),
            });
            navigateTo('/welcome');
        } catch (error) {
            const code = String(error?.message || '');
            const message = code === 'password_required_for_delete'
                ? wt('settings.delete_password_required', '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435')
                : code === 'invalid_password'
                    ? wt('settings.delete_invalid_password', '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u0443\u043a\u0430\u0437\u0430\u043d \u043d\u0435\u0432\u0435\u0440\u043d\u043e')
                    : code === 'authentication_required'
                        ? wt('settings.delete_session_expired', '\u0421\u0435\u0441\u0441\u0438\u044f \u0438\u0441\u0442\u0435\u043a\u043b\u0430. \u0412\u043e\u0439\u0434\u0438\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.')
                        : wt('settings.delete_error', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437 \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435.');
            console.error('[Settings] Failed to delete account:', error);
            setInlineStatus('settings-delete-status', message, 'error');
            showVoiceToast({
                severity: 'error',
                what: wt('settings.delete_error_what', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442.'),
                impact: wt('settings.delete_error_impact', '\u0414\u0430\u043d\u043d\u044b\u0435 \u0438 \u0441\u0435\u0441\u0441\u0438\u044f \u043f\u043e\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u044b.'),
                next: message,
            });
        } finally {
            _isDeletePending = false;
            updateDeleteControls(_accountContext?.user, { hosted: _accountContext?.hosted === true });
        }
    }

    function syncProfileForms(user, options = {}) {

        const nameInput = document.getElementById('settings-name-input');
        const emailInput = document.getElementById('settings-email-input');
        const passwordUsernameInput = document.getElementById('settings-password-username');
        const accountEmail = document.getElementById('settings-account-email');
        const hosted = options.hosted === true;

        if (nameInput) {
            nameInput.value = String(user?.name || '').trim();
        }
        if (emailInput) {
            emailInput.value = String(user?.email || '').trim();
        }
        if (passwordUsernameInput) {
            passwordUsernameInput.value = String(user?.email || user?.login || user?.name || '').trim();
        }
        if (accountEmail) {
            accountEmail.textContent = getAccountEmail(user, { hosted });
        }
        updateCredentialControls(user, { hosted });
    }

    function updateAvatarPreview(avatarSeed) {
        const previewImage = document.getElementById('settings-avatar-preview-image');
        const previewName = document.getElementById('settings-avatar-preview-name');
        const previewNote = document.getElementById('settings-avatar-preview-note');
        const safeAvatarSeed = String(avatarSeed || _accountContext?.user?.avatar_seed || '1.png').trim() || '1.png';
        const imageUrl = `${getAvatarUrl(safeAvatarSeed)}?trim=1&size=192`;

        if (previewImage) {
            previewImage.src = imageUrl;
            previewImage.alt = wt('settings.avatar_title', 'Фото профиля');
        }
        if (previewName) {
            previewName.textContent = wt('settings.avatar_title', 'Фото профиля');
        }
        if (previewNote) {
            previewNote.textContent = wt('settings.avatar_note', 'Загрузите своё изображение. Оно сразу появится в меню и на странице настроек.');
        }
    }

    function updateAccountSummary(user, options = {}) {
        const hosted = options.hosted === true;
        const avatarEl = document.getElementById('settings-account-avatar');
        const nameEl = document.getElementById('settings-account-name');
        const captionEl = document.getElementById('settings-account-caption');
        const sublineEl = document.getElementById('settings-account-subline');

        if (avatarEl) {
            avatarEl.src = `${getAvatarUrl(user?.avatar_seed)}?trim=1&size=160`;
            avatarEl.alt = getAccountDisplayName(user);
        }
        if (nameEl) {
            nameEl.textContent = getAccountDisplayName(user);
        }
        if (captionEl) {
            captionEl.textContent = getAccountCaption(user);
        }
        if (sublineEl) {
            sublineEl.textContent = hosted
                ? getAccountSubline(user)
                : wt('settings.profile_local_desc', 'Для локального профиля доступны имя, фото и оформление интерфейса.');
        }

        updateAccountAxes(user);
        syncProfileForms(user, { hosted });
        updateAvatarPreview(user?.avatar_seed);
    }

    function updateProfileCaption(user, options = {}) {
        const captionEl = document.getElementById('settings-profile-caption');
        if (!captionEl) return;

        const name = String(user?.name || '').trim();
        captionEl.textContent = name
            ? wt('settings.profile_appearance_for', 'Палитра интерфейса сохраняется для аккаунта «{name}».').replace('{name}', name)
            : wt('settings.appearance_description', 'Палитра интерфейса сохраняется для текущего аккаунта.');
    }

    async function loadAvatarOptions() {
        const legacyContainer = document.getElementById('settings-avatar-options');
        if (legacyContainer) {
            legacyContainer.innerHTML = '';
        }
        updateAvatarPreview(_accountContext?.user?.avatar_seed);
    }

    async function saveAvatarUpload(file) {
        if (!file || _isAvatarSaving) return;

        const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
        if (file.type && !allowedTypes.includes(file.type)) {
            setAvatarSaveStatus(wt('settings.avatar_format_error', 'Поддерживаются PNG, JPG и WEBP'), 'error');
            showVoiceToast({
                severity: 'error',
                what: wt('settings.avatar_upload_format_what', 'Не удалось загрузить изображение.'),
                impact: wt('settings.avatar_upload_format_impact', 'Поддерживаются только PNG, JPG и WEBP.'),
                next: wt('settings.avatar_upload_format_next', 'Выберите другой файл и попробуйте снова.'),
            });
            return;
        }

        _isAvatarSaving = true;
        setButtonBusyState('settings-avatar-upload-btn', true);
        setAvatarSaveStatus(wt('settings.avatar_uploading', 'Загружаем изображение...'), 'neutral');

        try {
            const formData = typeof FormData !== 'undefined' ? new FormData() : new window.FormData();
            formData.append('file', file, file.name || 'avatar.png');

            const response = await fetch('/api/users/avatar', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok || !data.user) {
                throw new Error(data?.error || 'avatar_upload_failed');
            }

            _accountContext = {
                ...(typeof _accountContext === 'object' && _accountContext ? _accountContext : {}),
                user: data.user,
                hosted: _accountContext?.hosted === true,
            };
            updateAccountSummary(_accountContext.user, { hosted: _accountContext.hosted === true });
            setAvatarSaveStatus(wt('settings.avatar_updated', 'Фото профиля обновлено'), 'success');
        } catch (error) {
            console.error('[Settings] Failed to upload avatar:', error);
            setAvatarSaveStatus(wt('settings.avatar_upload_error', 'Не удалось загрузить изображение'), 'error');
            showVoiceToast({
                severity: 'error',
                what: wt('settings.avatar_upload_error_what', 'Не удалось обновить фото профиля.'),
                impact: wt('settings.avatar_upload_error_impact', 'Текущее изображение осталось без изменений.'),
                next: wt('settings.avatar_upload_error_next', 'Попробуйте выбрать другой файл или повторите попытку позже.'),
            });
        } finally {
            _isAvatarSaving = false;
            setButtonBusyState('settings-avatar-upload-btn', false);
            const input = document.getElementById('settings-avatar-file-input');
            if (input) {
                input.value = '';
            }
            setTimeout(() => setAvatarSaveStatus(''), THEME_STATUS_RESET_MS);
        }
    }

    async function saveNamePreference() {
        const input = document.getElementById('settings-name-input');
        if (!input || _isNameSaving) return;

        const name = String(input.value || '').trim();
        const forbiddenChars = ['/', '\\', '<', '>', ':', '"', '|', '?', '*'];

        if (!name || name.length < 2 || name.length > 50) {
            setInlineStatus('settings-name-save-status', wt('settings.name_length_error', 'Имя должно содержать от 2 до 50 символов'), 'error');
            return;
        }
        if (forbiddenChars.some((char) => name.includes(char))) {
            setInlineStatus('settings-name-save-status', wt('settings.name_chars_error', 'В имени есть недопустимые символы'), 'error');
            return;
        }
        if (name === String(_accountContext?.user?.name || '').trim()) {
            setInlineStatus('settings-name-save-status', wt('settings.name_unchanged', 'Имя уже сохранено'), 'neutral');
            return;
        }

        _isNameSaving = true;
        setButtonBusyState('settings-name-save-btn', true);
        setInlineStatus('settings-name-save-status', wt('settings.name_saving', 'Сохраняем имя...'), 'neutral');

        try {
            const response = await fetch('/api/users/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok || !data.user) {
                throw new Error(data?.error || 'name_save_failed');
            }

            _accountContext = {
                ...(typeof _accountContext === 'object' && _accountContext ? _accountContext : {}),
                user: data.user,
                hosted: _accountContext?.hosted === true,
            };
            updateAccountSummary(_accountContext.user, { hosted: _accountContext.hosted === true });
            updateProfileCaption(_accountContext.user, { hosted: _accountContext.hosted === true });
            setInlineStatus('settings-name-save-status', wt('settings.name_saved', 'Имя обновлено'), 'success');
        } catch (error) {
            console.error('[Settings] Failed to save name:', error);
            setInlineStatus('settings-name-save-status', wt('settings.name_save_error', 'Не удалось сохранить имя'), 'error');
        } finally {
            _isNameSaving = false;
            setButtonBusyState('settings-name-save-btn', false);
            setTimeout(() => setInlineStatus('settings-name-save-status'), THEME_STATUS_RESET_MS);
        }
    }

    async function saveEmailPreference() {
        if (_isEmailSaving || !canEditCredentials({ hosted: _accountContext?.hosted === true })) return;

        const input = document.getElementById('settings-email-input');
        if (!input) return;

        const email = String(input.value || '').trim().toLowerCase();
        const currentEmail = String(_accountContext?.user?.email || '').trim().toLowerCase();
        const pendingEmail = String(_accountContext?.user?.pending_email || '').trim().toLowerCase();
        const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        if (!email || !emailPattern.test(email)) {
            setInlineStatus('settings-email-save-status', wt('settings.email_invalid', '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 email'), 'error');
            return;
        }
        if (email === currentEmail && email !== pendingEmail) {
            setInlineStatus('settings-email-save-status', wt('settings.email_unchanged', '\u042d\u0442\u043e\u0442 email \u0443\u0436\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d'), 'neutral');
            return;
        }

        _isEmailSaving = true;
        setButtonBusyState('settings-email-save-btn', true);
        renderPendingEmailPanel(_accountContext?.user, { hosted: _accountContext?.hosted === true });
        setInlineStatus('settings-email-save-status', wt('settings.email_sending', '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u043c \u043f\u0438\u0441\u044c\u043c\u043e \u0434\u043b\u044f \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f...'), 'neutral');

        try {
            const response = await fetch('/api/users/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok || !data.user) {
                throw new Error(data?.error || 'email_save_failed');
            }

            _pendingEmailFeedback = {
                tone: 'success',
                message: wt('settings.email_updated', '\u041f\u043e\u0447\u0442\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430. \u041d\u043e\u0432\u044b\u0439 \u0430\u0434\u0440\u0435\u0441 \u0441\u0442\u0430\u043d\u0435\u0442 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u043c \u043f\u043e\u0441\u043b\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f.'),
            };
            _accountContext = {
                ...(typeof _accountContext === 'object' && _accountContext ? _accountContext : {}),
                user: data.user,
                hosted: _accountContext?.hosted === true,
            };
            updateAccountSummary(_accountContext.user, { hosted: _accountContext.hosted === true });
            setInlineStatus('settings-email-save-status', wt('settings.email_check_inbox', '\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u0447\u0442\u0443: \u043f\u0438\u0441\u044c\u043c\u043e \u0441 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435\u043c \u0443\u0436\u0435 \u0432 \u043f\u0443\u0442\u0438.'), 'success');
            setSectionOpen('settings-email-form', false);
        } catch (error) {
            const code = String(error?.message || '');
            const message = code === 'email_change_unavailable'
                ? wt('settings.email_change_unavailable', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0443\u044e \u043f\u043e\u0447\u0442\u0443. \u0417\u0430\u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0439\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 email \u0438\u043b\u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.')
                : code === 'email_already_exists'
                ? wt('settings.email_already_exists', '\u042d\u0442\u043e\u0442 email \u0443\u0436\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f')
                : code === 'too_many_requests'
                    ? wt('settings.email_too_many_requests', '\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u0447\u0430\u0441\u0442\u043e. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435.')
                : code === 'disabled' || code === 'not_configured' || code === 'missing_base_url'
                    ? wt('settings.email_service_unavailable', '\u041f\u043e\u0447\u0442\u043e\u0432\u044b\u0439 \u0441\u0435\u0440\u0432\u0438\u0441 \u043f\u043e\u043a\u0430 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d')
                    : code === 'send_failed'
                        ? wt('settings.email_send_failed', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043f\u0438\u0441\u044c\u043c\u043e \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f')
                        : wt('settings.email_change_error', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c email');
            console.error('[Settings] Failed to save email:', error);
            _pendingEmailFeedback = { tone: 'error', message };
            renderPendingEmailPanel(_accountContext?.user, { hosted: _accountContext?.hosted === true });
            setInlineStatus('settings-email-save-status', message, 'error');
        } finally {
            _isEmailSaving = false;
            setButtonBusyState('settings-email-save-btn', false);
            renderPendingEmailPanel(_accountContext?.user, { hosted: _accountContext?.hosted === true });
        }
    }

    async function resendPendingEmailChange() {
        if (_isEmailSaving || !canEditCredentials({ hosted: _accountContext?.hosted === true })) return;
        if (!String(_accountContext?.user?.pending_email || '').trim()) return;

        _isEmailSaving = true;
        renderPendingEmailPanel(_accountContext?.user, { hosted: _accountContext?.hosted === true });
        setInlineStatus('settings-email-pending-status', wt('settings.email_resend_sending', '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u043c \u043f\u0438\u0441\u044c\u043c\u043e \u0435\u0449\u0451 \u0440\u0430\u0437...'), 'neutral');

        try {
            const response = await fetch('/api/users/resend-email-change', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok || !data.user) {
                throw new Error(data?.error || 'resend_email_change_failed');
            }

            _pendingEmailFeedback = {
                tone: 'success',
                message: wt('settings.email_resend_sent', '\u041f\u0438\u0441\u044c\u043c\u043e \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0432\u0445\u043e\u0434\u044f\u0449\u0438\u0435.'),
            };
            _accountContext = {
                ...(typeof _accountContext === 'object' && _accountContext ? _accountContext : {}),
                user: data.user,
                hosted: _accountContext?.hosted === true,
            };
            updateAccountSummary(_accountContext.user, { hosted: _accountContext.hosted === true });
        } catch (error) {
            const code = String(error?.message || '');
            const message = code === 'pending_email_missing'
                ? wt('settings.pending_email_no_change', '\u0421\u0435\u0439\u0447\u0430\u0441 \u043d\u0435\u0442 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0439 \u0441\u043c\u0435\u043d\u044b \u043f\u043e\u0447\u0442\u044b')
                : code === 'too_many_requests'
                    ? wt('settings.email_resend_rate', '\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u0447\u0430\u0441\u0442\u043e. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435.')
                : code === 'disabled' || code === 'not_configured' || code === 'missing_base_url'
                    ? wt('settings.email_service_unavailable', '\u041f\u043e\u0447\u0442\u043e\u0432\u044b\u0439 \u0441\u0435\u0440\u0432\u0438\u0441 \u043f\u043e\u043a\u0430 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d')
                    : wt('settings.email_resend_error', '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043f\u0438\u0441\u044c\u043c\u043e \u0435\u0449\u0451 \u0440\u0430\u0437');
            console.error('[Settings] Failed to resend pending email verification:', error);
            _pendingEmailFeedback = { tone: 'error', message };
            renderPendingEmailPanel(_accountContext?.user, { hosted: _accountContext?.hosted === true });
        } finally {
            _isEmailSaving = false;
            renderPendingEmailPanel(_accountContext?.user, { hosted: _accountContext?.hosted === true });
        }
    }

    async function maybeCompletePendingEmailVerification() {
        const token = String(getSearchParam('pending_email_token') || '').trim();
        if (!token) return null;

        removeSearchParam('pending_email_token');
        try {
            const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}&purpose=change_email`);
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok || !data.user) {
                throw new Error(data?.error || 'pending_email_verify_failed');
            }

            _pendingEmailFeedback = {
                tone: 'success',
                message: wt('settings.pending_email_verified', '\u041d\u043e\u0432\u0430\u044f \u043f\u043e\u0447\u0442\u0430 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430 \u0438 \u0443\u0436\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u0434\u043b\u044f \u0432\u0445\u043e\u0434\u0430.'),
            };
            return { user: data.user, hosted: true };
        } catch (error) {
            console.error('[Settings] Failed to confirm pending email:', error);
            _pendingEmailFeedback = {
                tone: 'error',
                message: describePendingEmailVerificationError(error?.message),
            };
            return null;
        }
    }

    async function savePasswordPreference() {

        if (_isPasswordSaving || !canEditCredentials({ hosted: _accountContext?.hosted === true })) return;

        const currentInput = document.getElementById('settings-password-current');
        const nextInput = document.getElementById('settings-password-new');
        const confirmInput = document.getElementById('settings-password-confirm');
        if (!currentInput || !nextInput || !confirmInput) return;

        const currentPassword = String(currentInput.value || '');
        const nextPassword = String(nextInput.value || '');
        const confirmPassword = String(confirmInput.value || '');

        if (nextPassword.length < PASSWORD_MIN_LENGTH) {
            setInlineStatus('settings-password-save-status', wt('settings.password_length_error', 'Пароль должен содержать минимум {n} символов').replace('{n}', PASSWORD_MIN_LENGTH), 'error');
            return;
        }
        if (nextPassword !== confirmPassword) {
            setInlineStatus('settings-password-save-status', wt('settings.password_mismatch', 'Новый пароль и подтверждение не совпадают'), 'error');
            return;
        }

        _isPasswordSaving = true;
        setButtonBusyState('settings-password-save-btn', true);
        setInlineStatus('settings-password-save-status', wt('settings.password_saving', 'Сохраняем пароль...'), 'neutral');

        try {
            const payload = { new_password: nextPassword };
            if (currentPassword) {
                payload.current_password = currentPassword;
            }

            const response = await fetch('/api/users/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || 'password_save_failed');
            }

            if (_accountContext?.user) {
                _accountContext.user.has_password = true;
            }
            updateCredentialControls(_accountContext?.user, { hosted: _accountContext?.hosted === true });
            setInlineStatus('settings-password-save-status', wt('settings.password_saved', 'Пароль обновлён'), 'success');
            resetPasswordForm();
            setSectionOpen('settings-password-form', false);
        } catch (error) {
            const code = String(error?.message || '');
            const message = code === 'current_password_required'
                ? wt('settings.password_current_wrong', 'Введите текущий пароль')
                : code === 'current_password_invalid'
                    ? wt('settings.password_wrong_current', 'Текущий пароль указан неверно')
                    : code === 'invalid_password'
                        ? wt('settings.password_length_error', 'Пароль должен содержать минимум {n} символов').replace('{n}', PASSWORD_MIN_LENGTH)
                        : wt('settings.password_error', 'Не удалось обновить пароль');
            console.error('[Settings] Failed to save password:', error);
            setInlineStatus('settings-password-save-status', message, 'error');
        } finally {
            _isPasswordSaving = false;
            setButtonBusyState('settings-password-save-btn', false);
        }
    }

    async function loadProfileThemeContext() {
        renderThemeOptions();

        const verificationContext = await maybeCompletePendingEmailVerification();
        const [accountContext, settingsData] = await Promise.all([
            loadSettingsAccountContext(),
            fetch('/api/ui/settings')
                .then((response) => response.json())
                .catch(() => null),
        ]);

        _accountContext = verificationContext || accountContext || { user: null, hosted: false };
        updateAccountSummary(_accountContext?.user, { hosted: _accountContext?.hosted === true });
        updateProfileCaption(_accountContext?.user, { hosted: _accountContext?.hosted === true });
        await loadBillingStatus();
        renderAdminUsersList();
        if (String(_accountContext?.user?.role || '').trim().toLowerCase() === 'admin') {
            await loadAdminUsers(_adminUsersQuery);
        }
        await loadAvatarOptions();

        const themeId = settingsData?.ok && settingsData.settings?.theme
            ? settingsData.settings.theme
            : (window.ThemeManager ? window.ThemeManager.getTheme() : 'light-a');

        if (window.ThemeManager && window.ThemeManager.getTheme() !== themeId) {
            window.ThemeManager.setTheme(themeId);
        }

        renderThemeOptions(themeId);
    }

    function _applySettingsI18n() {
        if (!window.i18n || typeof window.i18n.t !== 'function') return;
        var t = function (k) { return window.i18n.t(k); };

        var pv = t('page.settings');
        if (pv !== 'page.settings') document.title = pv;

        var topbarBack = document.querySelector('.settings-topbar a span:last-child');
        if (topbarBack) { var nh = t('settings.nav_home'); if (nh !== 'settings.nav_home') topbarBack.textContent = nh; }

        var topbarH1 = document.querySelector('.settings-topbar h1');
        if (topbarH1) { var st = t('settings.title'); if (st !== 'settings.title') topbarH1.textContent = st; }

        var accountActions = Array.from(document.querySelectorAll('.settings-main-link-label'));
        if (accountActions[0]) { var al = t('settings.nav_home'); if (al !== 'settings.nav_home') accountActions[0].textContent = al; }

        var idMap = [
            ['settings-account-subline', 'settings.account_subline'],
            ['settings-premium-description', 'settings.premium_description'],
            ['settings-profile-title', 'settings.profile_title'],
            ['settings-profile-description', 'settings.profile_description'],
            ['settings-avatar-preview-name', 'settings.avatar_title'],
            ['settings-avatar-preview-note', 'settings.avatar_note'],
            ['settings-email-note', 'settings.email_note'],
            ['settings-email-pending-title', 'settings.email_pending_title'],
            ['settings-email-pending-hint', 'settings.email_pending_hint'],
            ['settings-security-title', 'settings.security_title'],
            ['settings-security-description', 'settings.security_description'],
            ['settings-delete-title', 'settings.delete_title'],
            ['settings-delete-note', 'settings.delete_note'],
            ['settings-delete-warning', 'settings.delete_warning'],
            ['settings-admin-title', 'settings.admin_title'],
            ['settings-admin-description', 'settings.admin_description'],
            ['settings-appearance-title', 'settings.appearance_title'],
            ['settings-ai-description', 'settings.ai_description'],
            ['settings-draft-banner-text', 'settings.draft_hint'],
            ['settings-lang-label', 'settings.lang_label'],
            ['settings-lang-note', 'settings.lang_note'],
        ];
        idMap.forEach(function (pair) {
            var el = document.getElementById(pair[0]);
            if (!el) return;
            var val = t(pair[1]);
            if (val !== pair[1]) el.textContent = val;
        });

        var langGroup = document.getElementById('settings-lang-group');
        if (langGroup) { var lga = t('settings.lang_group_aria'); if (lga !== 'settings.lang_group_aria') langGroup.setAttribute('aria-label', lga); }

        var nameLabel = document.getElementById('settings-name-input') && document.getElementById('settings-name-input').previousElementSibling;
        if (nameLabel && nameLabel.tagName === 'SPAN') { var nl = t('settings.name_label'); if (nl !== 'settings.name_label') nameLabel.textContent = nl; }

        var nameInput = document.getElementById('settings-name-input');
        if (nameInput) { var np = t('settings.name_placeholder'); if (np !== 'settings.name_placeholder') nameInput.setAttribute('placeholder', np); }

        var emailTitle = document.getElementById('settings-email-value') && document.getElementById('settings-email-value').previousElementSibling;
        if (emailTitle && emailTitle.tagName === 'P') { var et = t('settings.email_label'); if (et !== 'settings.email_label') emailTitle.textContent = et; }

        var emailNewLabel = document.getElementById('settings-email-input') && document.getElementById('settings-email-input').previousElementSibling;
        if (emailNewLabel && emailNewLabel.tagName === 'SPAN') { var enl = t('settings.email_new_label'); if (enl !== 'settings.email_new_label') emailNewLabel.textContent = enl; }

        var pwTitle = document.getElementById('settings-password-state') && document.getElementById('settings-password-state').previousElementSibling;
        if (pwTitle && pwTitle.tagName === 'P') { var pwt = t('settings.password_label'); if (pwt !== 'settings.password_label') pwTitle.textContent = pwt; }

        var pwCurLabel = document.querySelector('label[for="settings-password-current"] span');
        if (pwCurLabel) { var pcl = t('settings.password_current_label'); if (pcl !== 'settings.password_current_label') pwCurLabel.textContent = pcl; }

        var pwCurInput = document.getElementById('settings-password-current');
        if (pwCurInput) { var pcp = t('settings.password_current_placeholder'); if (pcp !== 'settings.password_current_placeholder') pwCurInput.setAttribute('placeholder', pcp); }

        var pwNewLabel = document.getElementById('settings-password-new') && document.getElementById('settings-password-new').closest('label') && document.getElementById('settings-password-new').closest('label').querySelector('span');
        if (pwNewLabel) { var pnl = t('settings.password_new_label'); if (pnl !== 'settings.password_new_label') pwNewLabel.textContent = pnl; }

        var pwNewInput = document.getElementById('settings-password-new');
        if (pwNewInput) { var pnp = t('settings.password_new_placeholder'); if (pnp !== 'settings.password_new_placeholder') pwNewInput.setAttribute('placeholder', pnp); }

        var pwConfLabel = document.getElementById('settings-password-confirm') && document.getElementById('settings-password-confirm').closest('label') && document.getElementById('settings-password-confirm').closest('label').querySelector('span');
        if (pwConfLabel) { var pcfl = t('settings.password_confirm_label'); if (pcfl !== 'settings.password_confirm_label') pwConfLabel.textContent = pcfl; }

        var pwConfInput = document.getElementById('settings-password-confirm');
        if (pwConfInput) { var pcfp = t('settings.password_confirm_placeholder'); if (pcfp !== 'settings.password_confirm_placeholder') pwConfInput.setAttribute('placeholder', pcfp); }

        var draftBanner = document.getElementById('settings-draft-banner');
        if (draftBanner) {
            var draftTitleEl = draftBanner.querySelector('.text-sm.font-semibold');
            if (draftTitleEl) { var dtt = t('settings.draft_title'); if (dtt !== 'settings.draft_title') draftTitleEl.textContent = dtt; }
        }

        var restoreBtn = document.getElementById('settings-draft-restore-btn');
        if (restoreBtn) { var rb = t('settings.draft_restore'); if (rb !== 'settings.draft_restore') restoreBtn.textContent = rb; }

        var discardBtn = document.getElementById('settings-draft-discard-btn');
        if (discardBtn) { var db = t('settings.draft_discard'); if (db !== 'settings.draft_discard') discardBtn.textContent = db; }

        var saveKeysBtn = document.getElementById('save-keys-btn');
        if (saveKeysBtn) { var sk = t('settings.save_keys'); if (sk !== 'settings.save_keys') saveKeysBtn.textContent = sk; }

        var validateAllBtn = document.getElementById('validate-all-btn');
        if (validateAllBtn) { var va = t('settings.validate_keys'); if (va !== 'settings.validate_keys') validateAllBtn.textContent = va; }

        var adminSearchLabel = document.querySelector('#settings-admin-section label > span.mb-2');
        if (adminSearchLabel) { var asl = t('settings.admin_search_label'); if (asl !== 'settings.admin_search_label') adminSearchLabel.textContent = asl; }

        var adminSearchInput = document.getElementById('settings-admin-search-input');
        if (adminSearchInput) { var asp = t('settings.admin_search_placeholder'); if (asp !== 'settings.admin_search_placeholder') adminSearchInput.setAttribute('placeholder', asp); }

        var deletePasswordLabel = document.getElementById('settings-delete-password')?.closest('label')?.querySelector('span');
        if (deletePasswordLabel) { var dpl = t('settings.delete_password_label'); if (dpl !== 'settings.delete_password_label') deletePasswordLabel.textContent = dpl; }

        var deletePasswordInput = document.getElementById('settings-delete-password');
        if (deletePasswordInput) { var dpp = t('settings.delete_password_placeholder'); if (dpp !== 'settings.delete_password_placeholder') deletePasswordInput.setAttribute('placeholder', dpp); }

        var iconBtns = [
            ['settings-avatar-upload-btn', 'upload', 'settings.avatar_upload'],
            ['settings-name-save-btn', 'save', 'settings.name_save'],
            ['settings-email-toggle-btn', 'mail', 'settings.email_change'],
            ['settings-email-save-btn', 'check', 'settings.email_save'],
            ['settings-email-cancel-btn', 'close', 'settings.cancel'],
            ['settings-email-pending-resend-btn', 'forward_to_inbox', 'settings.email_resend'],
            ['settings-password-toggle-btn', 'password', 'settings.password_change'],
            ['settings-password-save-btn', 'check', 'settings.password_save'],
            ['settings-password-cancel-btn', 'close', 'settings.cancel'],
            ['settings-delete-toggle-btn', 'delete_forever', 'settings.delete_toggle'],
            ['settings-delete-confirm-btn', 'delete_forever', 'settings.delete_confirm'],
            ['settings-delete-cancel-btn', 'close', 'settings.cancel'],
            ['settings-admin-search-btn', 'search', 'settings.admin_search'],
            ['settings-logout-btn', 'logout', 'settings.logout'],
        ];
        iconBtns.forEach(function (row) {
            var val = t(row[2]);
            if (val !== row[2]) setButtonLabel(row[0], row[1], val);
        });

        // Crop image alt (data-i18n-alt not supported by updateDOM)
        var cropImg = document.getElementById('settings-avatar-crop-image');
        if (cropImg) { var cia = t('settings.crop_image_alt'); if (cia !== 'settings.crop_image_alt') cropImg.alt = cia; }

        // Account avatar alt (dynamic, not in data-i18n)
        var accountAvatar = document.getElementById('settings-account-avatar');
        if (accountAvatar) { var aaa = t('settings.account_alt'); if (aaa !== 'settings.account_alt') accountAvatar.alt = aaa; }

        // Re-render theme options to pick up translated theme names
        var currentTheme = window.ThemeManager ? window.ThemeManager.getTheme() : 'light-a';
        renderThemeOptions(currentTheme);

        window.i18n.updateDOM();
    }

    function bootstrapSettingsPage() {
        if (document.body && document.body.dataset.settingsInitialized === '1') {
            return;
        }
        if (document.body) {
            document.body.dataset.settingsInitialized = '1';
        }

        applyStaticCopy();
        _applySettingsI18n();

        const restoreBtn = document.getElementById('settings-draft-restore-btn');
        if (restoreBtn) {
            restoreBtn.onclick = () => {
                restoreDraftFromStorage();
            };
        }

        const discardBtn = document.getElementById('settings-draft-discard-btn');
        if (discardBtn) {
            discardBtn.onclick = () => {
                discardDraftFromStorage();
            };
        }

        const logoutBtn = document.getElementById('settings-logout-btn');
        if (logoutBtn) {
            logoutBtn.onclick = () => {
                void logoutCurrentAccount();
            };
        }
        updateLogoutButtonState();

        const mainBtn = document.getElementById('settings-main-btn');
        if (mainBtn) {
            mainBtn.addEventListener('click', (event) => {
                event.preventDefault();
                navigateTo('/main');
            });
        }

        const adminSearchBtn = document.getElementById('settings-admin-search-btn');
        if (adminSearchBtn) {
            adminSearchBtn.onclick = () => {
                const input = document.getElementById('settings-admin-search-input');
                void loadAdminUsers(input?.value || '');
            };
        }

        const adminSearchInput = document.getElementById('settings-admin-search-input');
        if (adminSearchInput) {
            adminSearchInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    void loadAdminUsers(adminSearchInput.value || '');
                }
            });
        }

        const avatarUploadBtn = document.getElementById('settings-avatar-upload-btn');
        const avatarFileInput = document.getElementById('settings-avatar-file-input');
        if (avatarUploadBtn && avatarFileInput) {
            avatarUploadBtn.onclick = () => avatarFileInput.click();
            avatarFileInput.addEventListener('change', () => {
                const file = avatarFileInput.files && avatarFileInput.files[0];
                if (file) {
                    setAvatarSaveStatus(wt('settings.avatar_crop_square_hint', 'Подготовьте квадратный кадр 1:1 и подтвердите загрузку'), 'neutral');
                    void openAvatarCropper(file);
                }
            });
        }

        const avatarCropCancelBtn = document.getElementById('settings-avatar-crop-cancel-btn');
        if (avatarCropCancelBtn) {
            avatarCropCancelBtn.onclick = () => {
                closeAvatarCropper();
            };
        }

        const avatarCropCancelIconBtn = document.getElementById('settings-avatar-crop-cancel-icon-btn');
        if (avatarCropCancelIconBtn) {
            avatarCropCancelIconBtn.onclick = () => {
                closeAvatarCropper();
            };
        }

        const avatarCropApplyBtn = document.getElementById('settings-avatar-crop-apply-btn');
        if (avatarCropApplyBtn) {
            avatarCropApplyBtn.onclick = () => {
                void applyAvatarCropAndUpload();
            };
        }

        const avatarCropResetBtn = document.getElementById('settings-avatar-crop-reset-btn');
        if (avatarCropResetBtn) {
            avatarCropResetBtn.onclick = () => {
                resetAvatarCropView();
            };
        }

        const avatarCropZoom = document.getElementById('settings-avatar-crop-zoom');
        if (avatarCropZoom) {
            avatarCropZoom.addEventListener('input', () => {
                if (!_avatarCropState) return;
                _avatarCropState.zoomPercent = Math.max(100, Math.min(300, Number(avatarCropZoom.value || 100)));
                renderAvatarCropPreview();
            });
        }

        const avatarCropFrame = document.getElementById('settings-avatar-crop-frame');
        if (avatarCropFrame) {
            avatarCropFrame.addEventListener('mousedown', startAvatarCropDrag);
            avatarCropFrame.addEventListener('touchstart', startAvatarCropDrag, { passive: false });
        }

        window.addEventListener('mousemove', moveAvatarCropDrag);
        window.addEventListener('mouseup', endAvatarCropDrag);
        window.addEventListener('touchmove', moveAvatarCropDrag, { passive: false });
        window.addEventListener('touchend', endAvatarCropDrag);
        window.addEventListener('touchcancel', endAvatarCropDrag);

        const avatarCropModal = document.getElementById('settings-avatar-crop-modal');
        if (avatarCropModal) {
            avatarCropModal.addEventListener('click', (event) => {
                if (event.target === avatarCropModal) {
                    closeAvatarCropper();
                }
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && _avatarCropState) {
                closeAvatarCropper();
            }
        });

        const saveNameBtn = document.getElementById('settings-name-save-btn');
        if (saveNameBtn) {
            saveNameBtn.onclick = () => {
                void saveNamePreference();
            };
        }

        const emailToggleBtn = document.getElementById('settings-email-toggle-btn');
        if (emailToggleBtn) {
            emailToggleBtn.onclick = () => {
                const form = document.getElementById('settings-email-form');
                const nextState = !!form && form.classList.contains('hidden');
                resetEmailForm();
                setSectionOpen('settings-email-form', nextState);
            };
        }

        const emailCancelBtn = document.getElementById('settings-email-cancel-btn');
        if (emailCancelBtn) {
            emailCancelBtn.onclick = () => {
                resetEmailForm();
                setSectionOpen('settings-email-form', false);
            };
        }

        const emailSaveBtn = document.getElementById('settings-email-save-btn');
        if (emailSaveBtn) {
            emailSaveBtn.onclick = () => {
                void saveEmailPreference();
            };
        }

        const emailPendingResendBtn = document.getElementById('settings-email-pending-resend-btn');
        if (emailPendingResendBtn) {
            emailPendingResendBtn.onclick = () => {
                void resendPendingEmailChange();
            };
        }

        const passwordToggleBtn = document.getElementById('settings-password-toggle-btn');
        if (passwordToggleBtn) {
            passwordToggleBtn.onclick = () => {
                const form = document.getElementById('settings-password-form');
                const nextState = !!form && form.classList.contains('hidden');
                resetPasswordForm();
                setSectionOpen('settings-password-form', nextState);
            };
        }

        const passwordCancelBtn = document.getElementById('settings-password-cancel-btn');
        if (passwordCancelBtn) {
            passwordCancelBtn.onclick = () => {
                resetPasswordForm();
                setSectionOpen('settings-password-form', false);
            };
        }

        const passwordSaveBtn = document.getElementById('settings-password-save-btn');
        if (passwordSaveBtn) {
            passwordSaveBtn.onclick = () => {
                void savePasswordPreference();
            };
        }

        const deleteToggleBtn = document.getElementById('settings-delete-toggle-btn');
        if (deleteToggleBtn) {
            deleteToggleBtn.onclick = () => {
                if (_isDeletePending) return;
                const form = document.getElementById('settings-delete-form');
                const nextState = !!form && form.classList.contains('hidden');
                resetDeleteForm();
                setSectionOpen('settings-delete-form', nextState);
            };
        }

        const deleteCancelBtn = document.getElementById('settings-delete-cancel-btn');
        if (deleteCancelBtn) {
            deleteCancelBtn.onclick = () => {
                if (_isDeletePending) return;
                resetDeleteForm();
                setSectionOpen('settings-delete-form', false);
            };
        }

        const deleteConfirmBtn = document.getElementById('settings-delete-confirm-btn');
        if (deleteConfirmBtn) {
            deleteConfirmBtn.onclick = () => {
                void deleteCurrentAccount();
            };
        }

        const deleteForm = document.getElementById('settings-delete-form');
        if (deleteForm) {
            deleteForm.addEventListener('submit', (event) => {
                event.preventDefault();
                void deleteCurrentAccount();
            });
        }

        const passwordForm = document.getElementById('settings-password-form');
        if (passwordForm) {
            passwordForm.addEventListener('submit', (event) => {
                event.preventDefault();
                void savePasswordPreference();
            });
        }

        window.addEventListener('themechanged', (event) => {
            renderThemeOptions(event.detail?.themeId);
        });

        window.addEventListener('i18n:changed', _applySettingsI18n);

        void loadProfileThemeContext();
        loadKeys();
        updateDraftBanner();
    }

    window.saveKeys = saveKeysProduct;
    window.validateKey = validateKeyProduct;
    window.validateAllKeys = validateAllKeys;
    window.toggleKeyVisibility = toggleKeyVisibility;
    window.toggleKeyRemoval = toggleKeyRemoval;
    window.loadKeys = loadKeys;
    window.restoreSettingsDraft = restoreDraftFromStorage;
    window.discardSettingsDraft = discardDraftFromStorage;

    function initSettingsPage() {
        bootstrapSettingsPage();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSettingsPage, { once: true });
    } else {
        initSettingsPage();
    }
})();
