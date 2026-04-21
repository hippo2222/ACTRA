(function () {
    'use strict';

    let currentMode = null;       // 'onboarding' | 'select' | 'login'
    let profiles = [];
    let pendingPasswordUserId = null;
    let legalDocuments = null;
    let consentGateResolver = null;
    let consentGateUserId = null;
    let hostedAuthFlow = false;
    let hostedVerificationState = null;
    let forgotPasswordState = { mode: 'request', resetToken: '', requestBusy: false, resetBusy: false };
    let initStarted = false;

    // --- API Helper ---
    async function apiFetch(url, options = {}) {
        try {
            const resp = await fetch(url, options);
            const data = await resp.json();
            return { ok: data.ok && resp.ok, data };
        } catch (e) {
            console.error(`[Welcome] API Error (${url}):`, e);
            return { ok: false, error: e };
        }
    }

    function isHostedAuthMode() {
        return hostedAuthFlow === true;
    }

    function toggleHidden(elementId, shouldHide) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.classList.toggle('hidden', !!shouldHide);
    }

    function setText(elementId, value) {
        const el = document.getElementById(elementId);
        if (el) el.textContent = value;
    }

    function getSearchParam(name) {
        try {
            return new URL(window.location.href).searchParams.get(name) || '';
        } catch (_) {
            return '';
        }
    }

    function removeSearchParam(name) {
        try {
            const url = new URL(window.location.href);
            if (!url.searchParams.has(name)) return;
            url.searchParams.delete(name);
            const nextUrl = `${url.pathname}${url.search}${url.hash}`;
            window.history.replaceState({}, document.title, nextUrl);
        } catch (_) {
            // Ignore URL cleanup errors.
        }
    }

    // --- Avatar helpers ---
    function getAvatarUrl(avatarSeed) {
        if (!avatarSeed) avatarSeed = '1.png';
        if (avatarSeed.includes('.')) {
            return `/api/assets/avatars/${encodeURIComponent(avatarSeed)}?trim=1&size=256`;
        }
        return '/api/assets/avatars/1.png?trim=1&size=256';
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
        return escapeHtml(
            String(value ?? '')
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\r/g, '\\r')
                .replace(/\n/g, '\\n')
                .replace(/\u2028/g, '\\u2028')
                .replace(/\u2029/g, '\\u2029')
                .replace(/</g, '\\x3C')
                .replace(/>/g, '\\x3E')
        );
    }

    function setupLoadingOverlayLogo() {
        const animatedLogo = document.getElementById('loadingLogoAnimated');
        const staticLogo = document.getElementById('loadingLogoStatic');
        if (!animatedLogo || !staticLogo) return;

        const prefersReducedMotion = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (prefersReducedMotion) {
            animatedLogo.classList.add('hidden');
            staticLogo.classList.remove('hidden');
            return;
        }

        animatedLogo.addEventListener('error', () => {
            animatedLogo.classList.add('hidden');
            staticLogo.classList.remove('hidden');
        }, { once: true });
    }

    async function loadAvatarGallery(containerId, seedInputId, previewId) {
        const gallery = document.getElementById(containerId);
        const { ok, data } = await apiFetch('/api/assets/avatars');
        const files = (ok && data && data.files) ? data.files.filter(f => !f.startsWith('manual_')) : [];
        const currentSeed = document.getElementById(seedInputId).value;

        gallery.innerHTML = files.map(file => {
            const selected = file === currentSeed;
            const safeFileLiteral = escapeInlineJsString(file);
            const safeSeedInputId = escapeInlineJsString(seedInputId);
            const safePreviewId = escapeInlineJsString(previewId);
            const safeContainerId = escapeInlineJsString(containerId);
            const safeFilenameAttr = escapeHtml(file);
            return `
            <button class="avatar-option group relative rounded-full w-14 h-14 overflow-hidden focus:outline-none transition-all duration-200 ${selected
                    ? 'ring-2 ring-primary opacity-100'
                    : 'opacity-75 hover:opacity-100'
                }"
                 onclick="window._welcomeSelectAvatar('${safeFileLiteral}', '${safeSeedInputId}', '${safePreviewId}', '${safeContainerId}')"
                 data-filename="${safeFilenameAttr}">
                <img src="/api/assets/avatars/${encodeURIComponent(file)}?trim=1&size=256" class="w-full h-full object-cover avatar-fill pointer-events-none shadow-sm" alt="Avatar">
            </button>`;
        }).join('');
    }

    window._welcomeSelectAvatar = function (filename, seedInputId, previewId, containerId) {
        document.getElementById(seedInputId).value = filename;
        document.getElementById(previewId).src = getAvatarUrl(filename);
        const container = document.getElementById(containerId);
        container.querySelectorAll('.avatar-option').forEach(item => {
            const isSelected = item.getAttribute('data-filename') === filename;
            if (isSelected) {
                item.classList.remove('opacity-75', 'hover:opacity-100');
                item.classList.add('ring-2', 'ring-primary', 'opacity-100');
            } else {
                item.classList.add('opacity-75', 'hover:opacity-100');
                item.classList.remove('ring-2', 'ring-primary', 'opacity-100');
            }
        });
    };

    // --- Validation ---
    function validateName(name) {
        if (!name || name.trim().length === 0) return 'Введите имя профиля';
        name = name.trim();
        if (name.length < 2) return 'Минимум 2 символа';
        if (name.length > 50) return 'Максимум 50 символов';
        const forbidden = ['/', '\\', '<', '>', ':', '"', '|', '?', '*'];
        if (forbidden.some(c => name.includes(c))) {
            return `Недопустимые символы: ${forbidden.join(', ')}`;
        }
        return null;
    }

    function validateLogin(login) {
        const value = String(login || '').trim().toLowerCase();
        if (!value) return 'Введите логин';
        if (value.length < 3 || value.length > 32) return 'Логин должен быть длиной 3-32 символа';
        if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(value)) {
            return 'Логин может содержать только латиницу, цифры, ".", "-" и "_"';
        }
        return null;
    }

    function validateEmail(email) {
        const value = String(email || '').trim().toLowerCase();
        if (!value) return 'Введите email';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return 'Введите корректный email';
        return null;
    }

    function validatePassword(password) {
        if (!password) return 'Введите пароль';
        if (String(password).length < 8) return 'Пароль должен содержать минимум 8 символов';
        return null;
    }

    function showError(elementId, message) {
        const el = document.getElementById(elementId);
        if (message) {
            if (el.querySelector('#onboardingErrorMsg')) {
                el.querySelector('#onboardingErrorMsg').textContent = message;
            } else {
                el.textContent = message;
            }
            el.classList.remove('hidden');
            // Auto hide after 5 seconds
            setTimeout(() => {
                if (!el.classList.contains('hidden')) el.classList.add('hidden');
            }, 5000);
        } else {
            el.classList.add('hidden');
        }
    }

    function describeVerificationProblem(code) {
        switch (String(code || '').trim()) {
            case 'already_verified':
                return 'Почта уже подтверждена. Можно продолжать.';
            case 'token_already_used':
                return 'Эта ссылка уже была использована. Если аккаунт подтверждён, просто продолжайте вход.';
            case 'invalid_or_expired_token':
                return 'Ссылка подтверждения недействительна или уже истекла. Запросите новое письмо.';
            case 'email_changed':
                return 'Для аккаунта уже указан другой email. Запросите новое письмо для актуального адреса.';
            case 'not_configured':
            case 'disabled':
                return 'Письма подтверждения сейчас временно недоступны. Попробуйте позже.';
            case 'send_failed':
                return 'Не удалось отправить письмо. Попробуйте ещё раз через несколько секунд.';
            case 'email_missing':
                return 'Для аккаунта не указан email для подтверждения.';
            default:
                return 'Не удалось завершить подтверждение почты.';
        }
    }

    function setHostedVerificationError(message) {
        const el = document.getElementById('onboardingVerificationError');
        if (!el) return;
        if (!message) {
            el.textContent = '';
            el.classList.add('hidden');
            return;
        }
        el.textContent = message;
        el.classList.remove('hidden');
    }

    function setForgotPasswordStatus(elementId, message, tone = 'neutral') {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (!message) {
            el.textContent = '';
            el.classList.add('hidden');
            el.classList.remove('border-error/30', 'bg-error/10', 'text-error', 'border-success/30', 'bg-success/10', 'text-success');
            el.classList.add('border-border-subtle', 'bg-surface-2', 'text-text-main');
            return;
        }

        el.textContent = message;
        el.classList.remove('hidden', 'border-error/30', 'bg-error/10', 'text-error', 'border-success/30', 'bg-success/10', 'text-success', 'border-border-subtle', 'bg-surface-2', 'text-text-main');
        if (tone === 'error') {
            el.classList.add('border-error/30', 'bg-error/10', 'text-error');
        } else if (tone === 'success') {
            el.classList.add('border-success/30', 'bg-success/10', 'text-success');
        } else {
            el.classList.add('border-border-subtle', 'bg-surface-2', 'text-text-main');
        }
    }

    function setForgotPasswordButtonBusy(elementId, busy, idleLabel, busyLabel) {
        const button = document.getElementById(elementId);
        if (!button) return;
        button.disabled = !!busy;
        button.textContent = busy ? busyLabel : idleLabel;
    }

    function describeForgotPasswordProblem(code) {
        switch (String(code || '').trim()) {
            case 'identifier_required':
                return 'Введите логин или email.';
            case 'disabled':
            case 'not_configured':
                return 'Письма для восстановления пароля сейчас недоступны. Попробуйте позже.';
            case 'send_failed':
                return 'Не удалось отправить письмо. Попробуйте ещё раз чуть позже.';
            case 'email_missing':
                return 'Для этого аккаунта не указана почта для восстановления.';
            default:
                return 'Не удалось запустить восстановление пароля.';
        }
    }

    function describeResetPasswordProblem(code) {
        switch (String(code || '').trim()) {
            case 'token_required':
                return 'Ссылка для сброса пароля отсутствует или повреждена.';
            case 'invalid_password':
                return 'Новый пароль должен содержать минимум 8 символов.';
            case 'token_already_used':
                return 'Эта ссылка уже была использована. Запросите новое письмо.';
            case 'invalid_or_expired_token':
                return 'Ссылка для сброса недействительна или уже истекла. Запросите новое письмо.';
            case 'email_changed':
                return 'Почта аккаунта уже изменилась. Запросите новое письмо для актуального адреса.';
            default:
                return 'Не удалось сохранить новый пароль.';
        }
    }

    function renderForgotPasswordModal() {
        const isResetMode = forgotPasswordState.mode === 'reset';
        toggleHidden('forgotPasswordRequestPanel', isResetMode);
        toggleHidden('forgotPasswordResetPanel', !isResetMode);
        toggleHidden('forgotPasswordRequestBtn', isResetMode);
        toggleHidden('forgotPasswordResetBtn', !isResetMode);

        setText(
            'forgotPasswordTitle',
            isResetMode ? 'Новый пароль' : 'Восстановление пароля'
        );
        setText(
            'forgotPasswordSubtitle',
            isResetMode
                ? 'Введите новый пароль для аккаунта, открытого по ссылке из письма.'
                : 'Укажите логин или email, и мы отправим ссылку для сброса.'
        );

        setForgotPasswordButtonBusy(
            'forgotPasswordRequestBtn',
            forgotPasswordState.requestBusy,
            'Отправить ссылку',
            'Отправляем...'
        );
        setForgotPasswordButtonBusy(
            'forgotPasswordResetBtn',
            forgotPasswordState.resetBusy,
            'Сохранить новый пароль',
            'Сохраняем...'
        );
    }

    function buildHostedVerificationStatusMessage(state) {
        if (!state) return '';
        if (state.statusMessage) return state.statusMessage;

        const user = state.user || {};
        const sentAt = user.email_verification_sent_at || state.sentAt || '';
        if (state.status === 'verified') {
            return user.email_verified_at
                ? `Почта подтверждена ${user.email_verified_at}.`
                : 'Почта подтверждена. Аккаунт готов к работе.';
        }
        if (state.status === 'error') {
            return state.verificationEmail?.sent
                ? 'Новое письмо уже отправлено. Проверьте входящие.'
                : '';
        }
        return sentAt
            ? `Последнее письмо отправлено ${sentAt}.`
            : 'Письмо уже отправлено. Откройте ссылку из письма, чтобы завершить регистрацию.';
    }

    function applyHostedVerificationState() {
        const isActive = currentMode === 'onboarding' && isHostedAuthMode() && !!hostedVerificationState;
        toggleHidden('onboardingVerificationPanel', !isActive);
        toggleHidden('modeOnboardingCard', isActive);
        toggleHidden('onboardingCreateBtn', isActive);
        if (isActive) {
            toggleHidden('onboardingSecondaryAction', true);
            toggleHidden('onboardingError', true);
        }

        if (!isActive) {
            updateWelcomeHeader(currentMode);
            return;
        }

        const state = hostedVerificationState;
        const user = state.user || {};
        const verificationEmail = state.verificationEmail || {};
        const email = String(
            state.email
            || user.email
            || (Array.isArray(verificationEmail.to) ? verificationEmail.to[0] : '')
            || ''
        ).trim().toLowerCase();
        const status = state.status || 'pending';

        let eyebrow = 'Email verification';
        let title = 'Проверьте почту';
        let body = 'Мы отправили письмо со ссылкой для подтверждения. После этого аккаунт будет считаться подтверждённым.';
        let hint = 'Если письмо не пришло сразу, подождите немного и проверьте папку spam.';
        let icon = 'mail';
        let canResend = state.canResend !== false;

        if (status === 'verified') {
            eyebrow = 'Email confirmed';
            title = 'Почта подтверждена';
            body = 'Подтверждение прошло успешно. Можно возвращаться в ACTRA и продолжать работу.';
            hint = 'Если это окно открылось из письма, просто вернитесь в приложение или нажмите кнопку ниже.';
            icon = 'verified';
            canResend = false;
        } else if (status === 'error') {
            eyebrow = 'Verification issue';
            title = 'Нужно подтвердить почту';
            body = state.message || describeVerificationProblem(state.reason);
            hint = 'Можно запросить новое письмо ещё раз. Если адрес был введён с ошибкой, позже его можно будет заменить в настройках.';
            icon = 'error';
        }

        setText('onboardingVerificationEyebrow', eyebrow);
        setText('onboardingVerificationTitle', title);
        setText('onboardingVerificationBody', body);
        setText('onboardingVerificationEmail', email || 'Email не указан');
        setText('onboardingVerificationStatus', buildHostedVerificationStatusMessage(state));
        setText('onboardingVerificationHint', hint);

        const iconEl = document.getElementById('onboardingVerificationIcon');
        if (iconEl) iconEl.textContent = icon;

        const resendBtn = document.getElementById('onboardingVerificationResendBtn');
        if (resendBtn) {
            resendBtn.disabled = !!state.resendBusy;
            resendBtn.textContent = state.resendBusy ? 'Отправляем...' : 'Отправить ещё раз';
            resendBtn.classList.toggle('hidden', !canResend);
        }

        const continueBtn = document.getElementById('onboardingVerificationContinueBtn');
        if (continueBtn) {
            const shouldReturnToAuth = status === 'error' && !user.user_id;
            continueBtn.textContent = shouldReturnToAuth ? 'К регистрации' : 'Перейти в ACTRA';
        }

        setHostedVerificationError(state.error || '');
        updateWelcomeHeader(currentMode);
    }

    function clearHostedVerificationState() {
        hostedVerificationState = null;
        applyHostedVerificationState();
    }

    function showHostedVerificationState(nextState) {
        hostedVerificationState = Object.assign({}, hostedVerificationState || {}, nextState || {});
        applyHostedVerificationState();
    }

    function buildHostedVerificationStateFromResponse(data, overrides = {}) {
        const user = data?.user || null;
        const verificationEmail = data?.verification_email || null;
        const alreadyVerified = !!(data?.already_verified || user?.email_verified);
        const delivered = !!verificationEmail?.sent;
        const reason = verificationEmail?.reason || '';
        const status = alreadyVerified ? 'verified' : (delivered ? 'pending' : 'error');

        return Object.assign(
            {
                status,
                user,
                verificationEmail,
                reason,
                canResend: !alreadyVerified,
                error: delivered || alreadyVerified ? '' : describeVerificationProblem(reason),
            },
            overrides || {}
        );
    }

    async function submitWelcomeEmailVerificationToken(token) {
        const cleanToken = String(token || '').trim();
        if (!cleanToken) return false;

        const { ok, data } = await apiFetch(`/api/auth/verify-email?token=${encodeURIComponent(cleanToken)}`);
        if (ok && data?.verified) {
            showHostedVerificationState({
                status: 'verified',
                user: data.user || null,
                verificationEmail: null,
                canResend: false,
                error: '',
                statusMessage: data?.verification?.verified_at
                    ? `Почта подтверждена ${data.verification.verified_at}.`
                    : 'Почта подтверждена. Аккаунт готов к работе.',
            });
            return true;
        }

        showHostedVerificationState({
            status: 'error',
            user: data?.user || null,
            verificationEmail: null,
            canResend: false,
            reason: data?.error || 'invalid_or_expired_token',
            message: describeVerificationProblem(data?.error || 'invalid_or_expired_token'),
            error: '',
            statusMessage: '',
        });
        return false;
    }

    function showConsentGateError(message) {
        const el = document.getElementById('consentGateError');
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
        if (!ok || !data.documents) {
            return false;
        }
        legalDocuments = data.documents;
        return true;
    }

    function getRequiredConsentVersions() {
        if (!legalDocuments) return { terms_version: '', privacy_version: '' };
        return {
            terms_version: legalDocuments.terms?.version || '',
            privacy_version: legalDocuments.privacy?.version || ''
        };
    }

    function collectConsent(termsCheckboxId, privacyCheckboxId) {
        const termsEl = document.getElementById(termsCheckboxId);
        const privacyEl = document.getElementById(privacyCheckboxId);
        return {
            accepted: !!(termsEl && termsEl.checked && privacyEl && privacyEl.checked),
            terms_version: getRequiredConsentVersions().terms_version,
            privacy_version: getRequiredConsentVersions().privacy_version,
        };
    }

    function openBlockModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeBlockModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    window.welcomeOpenLegalDocument = async function (docType) {
        const loaded = await ensureLegalDocumentsLoaded();
        if (!loaded) {
            showError('onboardingError', 'Не удалось загрузить юридические документы');
            return;
        }

        const { ok, data } = await apiFetch(`/api/legal/document/${docType}`);
        if (!ok || !data.document) {
            showError('onboardingError', 'Не удалось открыть документ');
            return;
        }

        const doc = data.document;
        const titleEl = document.getElementById('legalDocTitle');
        const metaEl = document.getElementById('legalDocMeta');
        const contentEl = document.getElementById('legalDocContent');
        if (titleEl) titleEl.textContent = doc.title || 'Документ';
        if (metaEl) metaEl.textContent = `Версия: ${doc.version || '-'} | Действует с: ${doc.effective_at || '-'}`;
        if (contentEl) contentEl.textContent = doc.content || '';

        openBlockModal('legalDocModal');
    };

    window.welcomeCloseLegalDocument = function () {
        closeBlockModal('legalDocModal');
    };

    window.welcomeUpdateConsentState = function (scope) {
        if (scope === 'onboarding') {
            const btn = document.getElementById('onboardingCreateBtn');
            const terms = document.getElementById('onboardingAcceptTerms');
            const privacy = document.getElementById('onboardingAcceptPrivacy');
            if (btn) btn.disabled = !(terms?.checked && privacy?.checked);
            return;
        }
        if (scope === 'select') {
            const btn = document.getElementById('selectCreateBtn');
            const terms = document.getElementById('selectAcceptTerms');
            const privacy = document.getElementById('selectAcceptPrivacy');
            if (btn) btn.disabled = !(terms?.checked && privacy?.checked);
            return;
        }
        if (scope === 'gate') {
            const btn = document.getElementById('consentGateSubmitBtn');
            const terms = document.getElementById('consentGateAcceptTerms');
            const privacy = document.getElementById('consentGateAcceptPrivacy');
            if (btn) btn.disabled = !(terms?.checked && privacy?.checked);
        }
    };

    function openConsentGate(userId, required) {
        consentGateUserId = userId;
        const versionsEl = document.getElementById('consentGateVersions');
        const termsEl = document.getElementById('consentGateAcceptTerms');
        const privacyEl = document.getElementById('consentGateAcceptPrivacy');

        if (versionsEl) {
            versionsEl.textContent = `Terms: ${required.terms_version || '-'} | Privacy: ${required.privacy_version || '-'}`;
        }
        if (termsEl) termsEl.checked = false;
        if (privacyEl) privacyEl.checked = false;
        showConsentGateError(null);
        window.welcomeUpdateConsentState('gate');
        openBlockModal('consentGateModal');

        return new Promise(resolve => {
            consentGateResolver = resolve;
        });
    }

    window.welcomeCancelConsentGate = function () {
        closeBlockModal('consentGateModal');
        showConsentGateError(null);
        if (consentGateResolver) {
            consentGateResolver(false);
            consentGateResolver = null;
        }
    };

    window.welcomeSubmitConsentGate = async function () {
        if (!consentGateUserId) {
            showConsentGateError('Не выбран профиль');
            return;
        }

        const consent = collectConsent('consentGateAcceptTerms', 'consentGateAcceptPrivacy');
        if (!consent.accepted) {
            showConsentGateError('Подтвердите оба документа');
            return;
        }

        const { ok, data } = await apiFetch('/api/consent/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: consentGateUserId,
                source: 'welcome_gate',
                consent: consent
            })
        });

        if (!ok) {
            showConsentGateError((data && (data.message || data.error)) || 'Не удалось сохранить согласие');
            return;
        }

        closeBlockModal('consentGateModal');
        showConsentGateError(null);
        if (consentGateResolver) {
            consentGateResolver(true);
            consentGateResolver = null;
        }
    };

    async function ensureUserConsent(userId) {
        const loaded = await ensureLegalDocumentsLoaded();
        if (!loaded) return false;

        const { ok, data } = await apiFetch(`/api/consent/status?user_id=${encodeURIComponent(userId)}`);
        if (!ok || !data) return false;
        if (data.status === 'up_to_date') return true;

        const required = data.required || getRequiredConsentVersions();
        return openConsentGate(userId, required);
    }

    function setHostedAuthChoiceVisible(visible) {
        toggleHidden('hostedAuthChoice', !visible);
        toggleHidden('profilesList', visible);
        toggleHidden('passwordInline', visible);
        toggleHidden('createProfileSection', visible);
    }

    function configureHostedRegistrationMode() {
        clearHostedVerificationState();
        setHostedAuthChoiceVisible(false);
        toggleHidden('onboardingAvatarPreviewWrap', true);
        toggleHidden('onboardingAvatarGallery', true);
        toggleHidden('onboardingLoginField', true);
        toggleHidden('hostedRegistrationFields', false);
        toggleHidden('onboardingSecondaryAction', false);

        const button = document.getElementById('onboardingCreateBtn');
        if (button) {
            button.innerHTML = 'Создать аккаунт <span class="material-symbols-outlined">person_add</span>';
        }

        const nameInput = document.getElementById('onboardingName');
        if (nameInput) nameInput.placeholder = 'Отображаемое имя';

        const avatarSeedInput = document.getElementById('onboardingAvatarSeed');
        if (avatarSeedInput) avatarSeedInput.value = '1.png';
        window.welcomeUpdateConsentState('onboarding');
    }

    function configureDesktopRegistrationMode() {
        clearHostedVerificationState();
        setHostedAuthChoiceVisible(false);
        toggleHidden('onboardingAvatarPreviewWrap', false);
        toggleHidden('onboardingAvatarGallery', false);
        toggleHidden('onboardingLoginField', false);
        toggleHidden('hostedRegistrationFields', true);
        toggleHidden('onboardingSecondaryAction', true);
        loadAvatarGallery('onboardingAvatarGallery', 'onboardingAvatarSeed', 'onboardingAvatarPreview');

        const button = document.getElementById('onboardingCreateBtn');
        if (button) {
            button.innerHTML = 'Начать обучение <span class="material-symbols-outlined">arrow_forward</span>';
        }

        const nameInput = document.getElementById('onboardingName');
        if (nameInput) nameInput.placeholder = 'Ваше имя';
    }

    function configureHostedLoginMode() {
        setHostedAuthChoiceVisible(false);
        toggleHidden('loginIdentifierWrap', false);
        toggleHidden('forgotPasswordLink', false);
        toggleHidden('loginBackBtn', false);
        toggleHidden('loginAvatar', true);
        toggleHidden('loginName', true);

        const passwordInput = document.getElementById('loginPassword');
        if (passwordInput) passwordInput.placeholder = 'Пароль';

        const identifierInput = document.getElementById('loginIdentifier');
        if (identifierInput) identifierInput.focus();

        const submitButton = document.getElementById('loginSubmitBtn');
        if (submitButton) {
            submitButton.innerHTML = 'Войти <span class="material-symbols-outlined">login</span>';
        }
    }

    function configureDesktopLoginMode() {
        setHostedAuthChoiceVisible(false);
        toggleHidden('loginIdentifierWrap', true);
        toggleHidden('forgotPasswordLink', true);
        toggleHidden('loginBackBtn', true);
        toggleHidden('loginAvatar', false);
        toggleHidden('loginName', false);

        const submitButton = document.getElementById('loginSubmitBtn');
        if (submitButton) {
            submitButton.innerHTML = 'Войти в систему <span class="material-symbols-outlined">login</span>';
        }
    }

    window.welcomeShowAuthLogin = function () {
        showMode('login');
        configureHostedLoginMode();
    };

    window.welcomeShowAuthRegister = function () {
        showMode('onboarding');
        configureHostedRegistrationMode();
    };

    window.welcomeBackToAuthChoice = function () {
        clearHostedVerificationState();
        showMode('select');
        setHostedAuthChoiceVisible(true);
    };

    window.welcomeContinueAfterVerification = function () {
        if (hostedVerificationState?.status === 'error' && !hostedVerificationState?.user?.user_id) {
            clearHostedVerificationState();
            showMode('select');
            setHostedAuthChoiceVisible(true);
            return;
        }
        goToMain();
    };

    window.welcomeResendVerificationEmail = async function () {
        if (!hostedVerificationState) return;

        showHostedVerificationState({
            resendBusy: true,
            error: '',
        });

        const { ok, data } = await apiFetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        if (!ok) {
            showHostedVerificationState({
                resendBusy: false,
                status: 'error',
                error: (data && (data.message || describeVerificationProblem(data.error))) || 'Не удалось отправить письмо повторно.',
            });
            return;
        }

        showHostedVerificationState(
            buildHostedVerificationStateFromResponse(data, {
                resendBusy: false,
                error: '',
                statusMessage: data?.verification_email?.sent
                    ? 'Новое письмо уже отправлено. Проверьте входящие.'
                    : buildHostedVerificationStatusMessage(hostedVerificationState),
            })
        );
    };

    window.welcomeOpenForgotPasswordModal = function (options = {}) {
        const resetToken = typeof options === 'string'
            ? String(options || '').trim()
            : String(options?.resetToken || '').trim();
        forgotPasswordState = {
            mode: resetToken ? 'reset' : 'request',
            resetToken,
            requestBusy: false,
            resetBusy: false,
        };
        renderForgotPasswordModal();

        const identifierInput = document.getElementById('forgotPasswordIdentifierInput');
        if (identifierInput && !resetToken) {
            const currentIdentifier = String(document.getElementById('loginIdentifier')?.value || '').trim();
            identifierInput.value = currentIdentifier;
        }
        setForgotPasswordStatus('forgotPasswordRequestStatus');
        setForgotPasswordStatus('forgotPasswordResetStatus');
        openBlockModal('forgotPasswordModal');

        if (resetToken) {
            const passwordInput = document.getElementById('forgotPasswordNewPassword');
            if (passwordInput) passwordInput.focus();
        } else if (identifierInput) {
            identifierInput.focus();
        }
    };

    window.welcomeCloseForgotPasswordModal = function () {
        closeBlockModal('forgotPasswordModal');
        forgotPasswordState = { mode: 'request', resetToken: '', requestBusy: false, resetBusy: false };
        renderForgotPasswordModal();
    };

    window.welcomeOpenForgotPasswordStub = function () {
        window.welcomeOpenForgotPasswordModal();
    };

    window.welcomeCloseForgotPasswordStub = function () {
        window.welcomeCloseForgotPasswordModal();
    };

    window.welcomeSubmitForgotPassword = async function () {
        if (forgotPasswordState.requestBusy) return;
        const identifier = String(document.getElementById('forgotPasswordIdentifierInput')?.value || '').trim();
        if (!identifier) {
            setForgotPasswordStatus('forgotPasswordRequestStatus', 'Введите логин или email.', 'error');
            return;
        }

        forgotPasswordState.requestBusy = true;
        renderForgotPasswordModal();
        setForgotPasswordStatus('forgotPasswordRequestStatus');

        const { ok, data } = await apiFetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier }),
        });

        forgotPasswordState.requestBusy = false;
        renderForgotPasswordModal();

        if (!ok) {
            setForgotPasswordStatus(
                'forgotPasswordRequestStatus',
                (data && (data.message || describeForgotPasswordProblem(data.error))) || 'Не удалось отправить письмо для восстановления.',
                'error'
            );
            return;
        }

        setForgotPasswordStatus(
            'forgotPasswordRequestStatus',
            data?.message || 'Если аккаунт существует, письмо уже отправлено.',
            'success'
        );
    };

    window.welcomeSubmitPasswordReset = async function () {
        if (forgotPasswordState.resetBusy) return;
        const token = String(forgotPasswordState.resetToken || '').trim();
        const newPassword = String(document.getElementById('forgotPasswordNewPassword')?.value || '');
        const confirmPassword = String(document.getElementById('forgotPasswordConfirmPassword')?.value || '');

        if (!token) {
            setForgotPasswordStatus('forgotPasswordResetStatus', 'Ссылка для сброса пароля отсутствует.', 'error');
            return;
        }
        const passwordError = validatePassword(newPassword);
        if (passwordError) {
            setForgotPasswordStatus('forgotPasswordResetStatus', passwordError, 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            setForgotPasswordStatus('forgotPasswordResetStatus', 'Пароли не совпадают.', 'error');
            return;
        }

        forgotPasswordState.resetBusy = true;
        renderForgotPasswordModal();
        setForgotPasswordStatus('forgotPasswordResetStatus');

        const { ok, data } = await apiFetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                new_password: newPassword,
            }),
        });

        forgotPasswordState.resetBusy = false;
        renderForgotPasswordModal();

        if (!ok) {
            setForgotPasswordStatus(
                'forgotPasswordResetStatus',
                (data && (data.message || describeResetPasswordProblem(data.error))) || 'Не удалось сохранить новый пароль.',
                'error'
            );
            return;
        }

        closeBlockModal('forgotPasswordModal');
        goToMain();
    };

    // --- Mode switching ---
    function showMode(mode) {
        currentMode = mode;
        document.getElementById('modeOnboarding').classList.toggle('hidden', mode !== 'onboarding');
        document.getElementById('modeSelect').classList.toggle('hidden', mode !== 'select');
        document.getElementById('modeLogin').classList.toggle('hidden', mode !== 'login');
        updateWelcomeHeader(mode);
    }

    const updateWelcomeHeaderLegacy = function (mode) {
        const title = document.getElementById('welcomeHeaderTitle');
        const subtitle = document.getElementById('welcomeHeaderSubtitle');
        if (!title || !subtitle) return;

        if (mode === 'onboarding') {
            title.textContent = 'Добро пожаловать!';
            subtitle.textContent = 'Похоже, вы здесь впервые. Создайте профиль, чтобы начать обучение.';
            return;
        }

        if (mode === 'login') {
            title.textContent = 'С возвращением';
            subtitle.textContent = 'Введите пароль, чтобы продолжить обучение.';
            return;
        }

        title.textContent = 'Добро пожаловать';
        subtitle.textContent = 'Выберите профиль, чтобы продолжить обучение.';
    };

    function updateWelcomeHeader(mode) {
        const title = document.getElementById('welcomeHeaderTitle');
        const subtitle = document.getElementById('welcomeHeaderSubtitle');
        const kicker = document.getElementById('welcomeHeaderKicker');
        const hint = document.getElementById('welcomeHeaderHint');
        if (!title || !subtitle) return;
        if (hint) hint.classList.add('hidden');

        if (kicker) {
            kicker.textContent = '';
            kicker.classList.add('hidden');
        }

        if (isHostedAuthMode()) {
            if (mode === 'onboarding') {
                if (hostedVerificationState) {
                    const status = hostedVerificationState.status || 'pending';
                    if (kicker) {
                        kicker.textContent = status === 'verified' ? 'Email confirmed' : 'Подтверждение почты';
                        kicker.classList.remove('hidden');
                    }
                    if (status === 'verified') {
                        title.textContent = 'Почта подтверждена';
                        subtitle.textContent = 'Аккаунт активирован. Можно переходить в ACTRA и продолжать работу.';
                        return;
                    }
                    if (status === 'error') {
                        title.textContent = 'Подтвердите email';
                        subtitle.textContent = 'Ссылка не сработала или письмо не дошло. Отсюда можно отправить новое письмо и завершить регистрацию.';
                        return;
                    }
                    title.textContent = 'Подтвердите email';
                    subtitle.textContent = 'Мы уже отправили письмо с ссылкой. Откройте его, чтобы завершить первичную регистрацию аккаунта.';
                    return;
                }
                if (kicker) {
                    kicker.textContent = 'Новый аккаунт';
                    kicker.classList.remove('hidden');
                }
                title.textContent = 'Создайте аккаунт';
                subtitle.textContent = 'Укажите отображаемое имя, логин, email и пароль, чтобы сразу войти в ACTRA Web.';
                return;
            }

            if (mode === 'login') {
                if (kicker) {
                    kicker.textContent = 'Вход';
                    kicker.classList.remove('hidden');
                }
                title.textContent = 'Войти в аккаунт';
                subtitle.textContent = 'Введите логин или email и пароль, чтобы продолжить обучение и открыть библиотеку.';
                return;
            }

            if (kicker) {
                kicker.textContent = 'ACTRA Web';
                kicker.classList.remove('hidden');
            }
            title.textContent = 'Вход или регистрация';
            subtitle.textContent = 'Используйте существующий аккаунт или создайте новый, чтобы открыть библиотеку, прогресс и публикации.';
            return;
        }

        if (mode === 'onboarding') {
            title.textContent = 'Добро пожаловать!';
            subtitle.textContent = 'Похоже, вы здесь впервые. Создайте профиль, чтобы начать обучение.';
            return;
        }

        if (mode === 'login') {
            title.textContent = 'С возвращением';
            subtitle.textContent = 'Введите пароль, чтобы продолжить обучение.';
            return;
        }

        title.textContent = 'Добро пожаловать';
        subtitle.textContent = 'Выберите профиль, чтобы продолжить обучение.';
    }

    function showStartupLoadError(message) {
        const title = document.getElementById('welcomeHeaderTitle');
        const subtitle = document.getElementById('welcomeHeaderSubtitle');
        if (title) title.textContent = 'Не удалось загрузить стартовый экран';
        if (subtitle) subtitle.textContent = 'Повторите попытку или перезапустите приложение.';

        showMode('select');
        window.welcomeCancelCreate();
        window.welcomeCancelPassword();

        const container = document.getElementById('profilesList');
        if (!container) return;
        container.innerHTML = `
            <div class="w-full max-w-xl rounded-[2rem] border border-error/20 bg-error/5 p-8 text-center shadow-xl">
                <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error/10 text-error">
                    <span class="material-symbols-outlined text-[28px]">error</span>
                </div>
                <h3 class="text-2xl font-black text-text-main mb-3">Стартовые данные недоступны</h3>
                <p class="text-sm text-text-secondary mb-6">${escapeHtml(message || 'Не удалось получить данные для входа.')}</p>
                <button type="button" onclick="window.welcomeRetryInit()"
                    class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-fg hover:bg-primary-hover transition-colors">
                    <span class="material-symbols-outlined text-[18px]">refresh</span>
                    Повторить
                </button>
            </div>
        `;
    }

    // --- Navigate to main ---
    function goToMain() {
        window.navigateWithTransition('/ui/main');
    }

    window.welcomeRetryInit = function () {
        window.location.reload();
    };

    // --- Create profile & select ---
    async function createAndSelect(name, avatarSeed, errorElementId, consentConfig) {
        const err = validateName(name);
        if (err) {
            showError(errorElementId, err);
            return false;
        }
        const loaded = await ensureLegalDocumentsLoaded();
        if (!loaded) {
            showError(errorElementId, 'Не удалось загрузить документы для согласия');
            return false;
        }

        const consent = collectConsent(consentConfig.termsCheckboxId, consentConfig.privacyCheckboxId);
        if (!consent.accepted) {
            showError(errorElementId, 'Подтвердите согласие с условиями и политикой приватности');
            return false;
        }

        showError(errorElementId, null);

        const { ok, data } = await apiFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.trim(),
                avatar_seed: avatarSeed || '1.png',
                consent: consent
            })
        });

        if (!ok) {
            showError(errorElementId, (data && (data.message || data.error)) || 'Не удалось создать профиль');
            return false;
        }

        // Select the new profile
        const userId = data.user.user_id;
        const selectResp = await apiFetch('/api/users/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });

        return !!selectResp.ok;
    }

    async function selectUser(userId) {
        const { ok } = await apiFetch('/api/users/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        return ok;
    }

    // --- Public: Onboarding create profile ---
    window.welcomeCreateProfile = async function () {
        if (isHostedAuthMode()) {
            const name = document.getElementById('onboardingName').value;
            const email = document.getElementById('onboardingEmail').value;
            const password = document.getElementById('onboardingPassword').value;
            const passwordConfirm = document.getElementById('onboardingPasswordConfirm').value;

            const nameError = validateName(name);
            if (nameError) {
                showError('onboardingError', nameError);
                return;
            }
            const emailError = validateEmail(email);
            if (emailError) {
                showError('onboardingError', emailError);
                return;
            }
            const passwordError = validatePassword(password);
            if (passwordError) {
                showError('onboardingError', passwordError);
                return;
            }
            if (password !== passwordConfirm) {
                showError('onboardingError', 'Пароли не совпадают');
                return;
            }

            const loaded = await ensureLegalDocumentsLoaded();
            if (!loaded) {
                showError('onboardingError', 'Не удалось загрузить документы для согласия');
                return;
            }
            const consent = collectConsent('onboardingAcceptTerms', 'onboardingAcceptPrivacy');
            if (!consent.accepted) {
                showError('onboardingError', 'Подтвердите согласие с документами');
                return;
            }

            showError('onboardingError', null);
            const { ok, data } = await apiFetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    email: String(email || '').trim().toLowerCase(),
                    password,
                    consent,
                })
            });

            if (!ok) {
                showError('onboardingError', (data && (data.message || data.error)) || 'Не удалось создать аккаунт');
                return;
            }

            showHostedVerificationState(
                buildHostedVerificationStateFromResponse(data)
            );
            return;
        }

        const name = document.getElementById('onboardingName').value;
        const avatar = document.getElementById('onboardingAvatarSeed').value;
        const ok = await createAndSelect(name, avatar, 'onboardingError', {
            termsCheckboxId: 'onboardingAcceptTerms',
            privacyCheckboxId: 'onboardingAcceptPrivacy',
        });
        if (ok) goToMain();
    };

    // --- Public: Select mode create profile ---
    window.welcomeCreateFromSelect = async function () {
        const name = document.getElementById('selectNewName').value;
        const avatar = document.getElementById('selectAvatarSeed').value;
        const ok = await createAndSelect(name, avatar, 'selectError', {
            termsCheckboxId: 'selectAcceptTerms',
            privacyCheckboxId: 'selectAcceptPrivacy',
        });
        if (ok) goToMain();
    };

    // --- Public: Toggle create form in select mode ---
    window.welcomeToggleCreate = function () {
        const form = document.getElementById('createProfileSection');
        const isHidden = form.classList.contains('hidden');

        if (isHidden) {
            form.classList.remove('hidden');
            form.innerHTML = `
                <div class="bg-surface-1 rounded-3xl border border-primary p-8 shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-300 relative">
                    <button onclick="window.welcomeCancelCreate()" class="absolute top-4 right-4 text-text-secondary hover:text-error transition-colors">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                    
                    <div class="flex flex-col items-center gap-6 mb-8">
                        <div class="relative group cursor-pointer flex-shrink-0">
                             <img id="selectAvatarPreview" src="/api/assets/avatars/1.png?trim=1&size=256" 
                                  class="w-20 h-20 rounded-full object-cover avatar-fill ring-4 ring-primary ring-offset-4 ring-offset-surface-1 shadow-md">
                        </div>
                        <input type="text" id="selectNewName" placeholder="Имя профиля..."
                            class="welcome-name-input w-full text-center bg-transparent border-b-2 border-border-subtle focus:border-primary px-2 py-2 text-xl font-bold text-text-main outline-none transition-colors placeholder:text-text-secondary"
                            maxlength="50" onkeydown="if(event.key==='Enter'){event.preventDefault();window.welcomeCreateFromSelect()}">
                    </div>
                    
                    <div id="selectAvatarGallery" class="flex justify-center flex-wrap gap-3 p-2 mb-6 overflow-visible"></div>
                    <input type="hidden" id="selectAvatarSeed" value="1.png">

                    <div class="mb-4 rounded-xl border border-border-subtle bg-surface-2 p-4">
                        <p class="text-xs font-semibold text-text-secondary mb-3">
                            Для создания профиля подтвердите согласие с документами:
                        </p>
                        <label class="flex items-start gap-3 text-sm text-text-main mb-2 cursor-pointer">
                            <input type="checkbox" id="selectAcceptTerms"
                                class="mt-0.5 rounded text-primary focus:ring-primary"
                                onchange="window.welcomeUpdateConsentState('select')">
                            <span>
                                Я принимаю
                                <button type="button"
                                    class="text-primary hover:underline font-semibold"
                                    onclick="window.welcomeOpenLegalDocument('terms'); return false;">
                                    Условия пользования
                                </button>
                            </span>
                        </label>
                        <label class="flex items-start gap-3 text-sm text-text-main cursor-pointer">
                            <input type="checkbox" id="selectAcceptPrivacy"
                                class="mt-0.5 rounded text-primary focus:ring-primary"
                                onchange="window.welcomeUpdateConsentState('select')">
                            <span>
                                Я ознакомился(ась) с
                                <button type="button"
                                    class="text-primary hover:underline font-semibold"
                                    onclick="window.welcomeOpenLegalDocument('privacy'); return false;">
                                    Политикой приватности
                                </button>
                            </span>
                        </label>
                    </div>
                     
                    <p id="selectError" class="text-xs text-error font-bold mb-4 hidden bg-error/10 p-2 rounded text-center"></p>
                     
                    <button id="selectCreateBtn" onclick="window.welcomeCreateFromSelect()"
                        class="w-full py-4 rounded-xl font-bold bg-primary text-primary-fg hover:bg-primary-hover shadow-lg transition-all text-base tracking-wide flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled>
                        Создать профиль
                        <span class="material-symbols-outlined">check</span>
                    </button>
                </div>
             `;
            loadAvatarGallery('selectAvatarGallery', 'selectAvatarSeed', 'selectAvatarPreview');
            window.welcomeUpdateConsentState('select');
            setTimeout(() => document.getElementById('selectNewName').focus(), 100);

            // Scroll to form smoothly
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            form.classList.add('hidden');
        }
    };

    // --- Public: Cancel create form ---
    window.welcomeCancelCreate = function () {
        const form = document.getElementById('createProfileSection');
        form.classList.add('hidden');
        form.innerHTML = '';
    };

    // --- Public: Click profile card ---
    window.welcomeSelectProfile = async function (userId) {
        const profile = profiles.find(p => p.user_id === userId);
        if (!profile) return;

        window.welcomeCancelCreate();
        window.welcomeCancelPassword();

        if (profile.has_password && profile.security_settings && profile.security_settings.require_password_on_login) {
            pendingPasswordUserId = userId;
            const container = document.getElementById('passwordInlineUser');
            const safeAvatarUrl = escapeHtml(getAvatarUrl(profile.avatar_seed));
            const safeProfileName = escapeHtml(profile.name);
            container.innerHTML = `
                <img src="${safeAvatarUrl}" class="w-12 h-12 rounded-full bg-surface-2 object-cover avatar-fill ring-2 ring-primary/30 shadow-sm">
                <div class="flex flex-col">
                    <span class="font-black text-text-main text-lg leading-tight tracking-tight">${safeProfileName}</span>
                    <span class="text-[10px] text-text-secondary font-bold uppercase tracking-wider mt-0.5">Вход по паролю</span>
                </div>
            `;
            const pwdSection = document.getElementById('passwordInline');
            pwdSection.classList.remove('hidden');
            document.getElementById('passwordInlineError').classList.add('hidden');

            const input = document.getElementById('passwordInlineInput');
            input.value = '';

            // Scroll to password form
            pwdSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => input.focus(), 300);
            return;
        }

        const ok = await selectUser(userId);
        if (!ok) return;

        const consentOk = await ensureUserConsent(userId);
        if (consentOk) goToMain();
    };

    // --- Public: Submit password ---
    window.welcomeSubmitPassword = async function () {
        if (!pendingPasswordUserId) return;
        const password = document.getElementById('passwordInlineInput').value;
        if (!password) {
            showError('passwordInlineError', 'Введите пароль');
            return;
        }

        const { ok, data } = await apiFetch('/api/users/verify-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: pendingPasswordUserId, password })
        });

        if (ok && data?.verified) {
            const selected = await selectUser(pendingPasswordUserId);
            if (!selected) return;

            const consentOk = await ensureUserConsent(pendingPasswordUserId);
            if (consentOk) goToMain();
        } else {
            showError('passwordInlineError', 'Неверный пароль');
            const input = document.getElementById('passwordInlineInput');
            input.closest('.bg-surface-1').classList.add('shake');
            setTimeout(() => input.closest('.bg-surface-1').classList.remove('shake'), 400);
            input.value = '';
            input.focus();
        }
    };

    // --- Public: Cancel password ---
    window.welcomeCancelPassword = function () {
        pendingPasswordUserId = null;
        document.getElementById('passwordInline').classList.add('hidden');
    };

    // --- Public: Login mode submit ---
    window.welcomeLoginSubmit = async function () {
        if (isHostedAuthMode()) {
            const identifier = document.getElementById('loginIdentifier').value;
            const password = document.getElementById('loginPassword').value;
            if (!identifier || !String(identifier).trim()) {
                showError('loginError', 'Введите логин или email');
                return;
            }
            const passwordError = validatePassword(password);
            if (passwordError) {
                showError('loginError', passwordError);
                return;
            }

            const { ok, data } = await apiFetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    identifier: String(identifier).trim(),
                    password,
                })
            });

            if (ok && data?.user?.user_id) {
                const consentOk = await ensureUserConsent(data.user.user_id);
                if (consentOk) goToMain();
                return;
            }

            showError('loginError', (data && (data.message || data.error)) || 'Неверный логин, email или пароль');
            const input = document.getElementById('loginPassword');
            input.closest('.bg-surface-1').classList.add('shake');
            setTimeout(() => input.closest('.bg-surface-1').classList.remove('shake'), 400);
            input.value = '';
            input.focus();
            return;
        }

        const password = document.getElementById('loginPassword').value;
        if (!password) {
            showError('loginError', 'Введите пароль');
            return;
        }

        const user = profiles[0];
        if (!user || !user.user_id) {
            showError('loginError', 'Профиль не найден');
            return;
        }

        const userId = user.user_id;
        const { ok, data } = await apiFetch('/api/users/verify-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, password })
        });

        if (ok && data?.verified) {
            const selected = await selectUser(userId);
            if (!selected) return;

            const consentOk = await ensureUserConsent(userId);
            if (consentOk) goToMain();
        } else {
            showError('loginError', 'Неверный пароль');
            const input = document.getElementById('loginPassword');
            input.closest('.bg-surface-1').classList.add('shake');
            setTimeout(() => input.closest('.bg-surface-1').classList.remove('shake'), 400);
            input.value = '';
            input.focus();
        }
    };

    // --- Render profiles list (V3 Grid) ---
    function renderProfilesList() {
        const container = document.getElementById('profilesList');

        const cardsHtml = profiles.map(user => {
            const hasLock = user.has_password
                && user.security_settings
                && user.security_settings.require_password_on_login;
            const safeUserId = escapeInlineJsString(user.user_id);
            const safeUserName = escapeHtml(user.name);
            const safeAvatarUrl = escapeHtml(getAvatarUrl(user.avatar_seed));

            const lockBadges = hasLock
                ? `<div class="absolute top-2 right-2 bg-text-main/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border border-white/10 z-10 transition-transform group-hover:scale-110">
                       <span class="material-symbols-outlined text-white text-[14px] block">lock</span>
                   </div>`
                : '';

            // V3 Profile Card Structure
            return `
            <button class="welcome-profile-card profile-card-v3 group relative flex flex-col items-center overflow-hidden rounded-3xl p-8 text-center cursor-pointer outline-none focus:ring-4 focus:ring-primary/20"
                 onclick="window.welcomeSelectProfile('${safeUserId}')">
                
                <!-- Hover background effect -->
                <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

                <div class="relative mb-5 transition-transform group-hover:scale-105 duration-300 transform-gpu">
                    <img src="${safeAvatarUrl}" class="w-24 h-24 rounded-full object-cover avatar-fill shadow-lg ring-4 ring-surface-0 group-hover:ring-primary/40 transition-shadow" alt="${safeUserName}">
                    ${lockBadges}
                </div>
                
                <div class="w-full relative z-10">
                    <p class="welcome-profile-name mb-1 w-full text-xl font-bold tracking-tight text-text-main transition-colors group-hover:text-primary" title="${safeUserName}">${safeUserName}</p>
                    <p class="welcome-profile-meta text-[11px] uppercase tracking-widest font-bold transition-all duration-300 transform translate-y-1 group-hover:translate-y-0 group-hover:text-primary">
                        ${hasLock ? 'Требуется пароль' : 'Нажмите для входа'}
                    </p>
                </div>
            </button>`;
        }).join('');

        const addCardHtml = `
            <button class="welcome-profile-card profile-card-v3 profile-card-new group flex flex-col items-center justify-center rounded-3xl p-8 text-center cursor-pointer outline-none focus:ring-4 focus:ring-primary/20"
                 onclick="window.welcomeToggleCreate()">
                <div class="w-24 h-24 rounded-full flex items-center justify-center bg-surface-2 mb-5 group-hover:scale-110 group-hover:bg-primary group-hover:text-white transition-all duration-300 shadow-inner group-hover:shadow-lg ring-4 ring-transparent group-hover:ring-primary/20">
                    <span class="material-symbols-outlined text-text-secondary text-4xl group-hover:text-white transition-colors">add</span>
                </div>
                <div class="w-full">
                     <p class="text-lg font-bold text-text-secondary group-hover:text-primary transition-colors tracking-tight">Новый профиль</p>
                </div>
            </button>`;

        container.innerHTML = cardsHtml + addCardHtml;
    }

    // --- Initialize ---
    async function init() {
        if (initStarted) return;
        initStarted = true;
        const verifyEmailToken = getSearchParam('verify_email_token');
        const resetPasswordToken = getSearchParam('reset_password_token');
        const overlay = document.getElementById('loadingOverlay');
        setupLoadingOverlayLogo();
        const overlayDelayMs = window.ACTRA_CONFIG?.ui?.loadingRevealDelayMs ?? 280;
        let overlayShown = false;
        let overlayShowTimer = null;

        const scheduleOverlay = () => {
            if (!overlay) return;
            overlayShowTimer = setTimeout(() => {
                overlay.classList.remove('hidden');
                requestAnimationFrame(() => {
                    overlay.style.opacity = '1';
                });
                overlayShown = true;
            }, overlayDelayMs);
        };

        const finalizeOverlay = () => {
            if (overlayShowTimer) clearTimeout(overlayShowTimer);
            if (!overlay) return;

            if (overlayShown) {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 320);
            } else {
                overlay.remove();
            }
        };

        scheduleOverlay();

        try {
            const { ok, data } = await apiFetch('/api/users/should-welcome');

            if (!ok) {
                showStartupLoadError('Не удалось получить список профилей и стартовый режим.');
                return;
            }

            hostedAuthFlow = data.mode === 'auth' || data.mode === 'authenticated' || !!verifyEmailToken || !!resetPasswordToken;

            if (verifyEmailToken) {
                removeSearchParam('verify_email_token');
                showMode('onboarding');
                configureHostedRegistrationMode();
                await submitWelcomeEmailVerificationToken(verifyEmailToken);
                return;
            }

            if (resetPasswordToken) {
                removeSearchParam('reset_password_token');
                showMode('login');
                configureHostedLoginMode();
                window.welcomeOpenForgotPasswordModal({ resetToken: resetPasswordToken });
                return;
            }

            if (!data.show_welcome) {
                if (hostedAuthFlow) {
                    const authMe = await apiFetch('/api/auth/me');
                    const selectedUserId = authMe.ok && authMe.data?.user?.user_id
                        ? authMe.data.user.user_id
                        : (data.auto_select_user_id || null);
                    if (selectedUserId) {
                        const consentOk = await ensureUserConsent(selectedUserId);
                        if (!consentOk) return;
                    }
                    goToMain();
                    return;
                }

                const availableProfiles = Array.isArray(data.profiles) ? data.profiles : [];
                let selectedUserId = null;
                if (data.auto_select_user_id) {
                    const selected = await selectUser(data.auto_select_user_id);
                    if (selected) selectedUserId = data.auto_select_user_id;
                }

                if (!selectedUserId) {
                    const currentResp = await apiFetch('/api/users/current');
                    if (currentResp.ok && currentResp.data?.user?.user_id) {
                        selectedUserId = currentResp.data.user.user_id;
                    } else if (data.auto_select_user_id || availableProfiles.length > 0) {
                        showStartupLoadError('Не удалось определить активный профиль для входа.');
                        return;
                    }
                }

                if (selectedUserId) {
                    const consentOk = await ensureUserConsent(selectedUserId);
                    if (!consentOk) return;
                }

                goToMain();
                return;
            }

            profiles = data.profiles || [];
            console.log('[Welcome] Loaded profiles:', profiles.length);

            if (profiles.length > 0) {
                profiles.forEach(p => {
                    const img = new Image();
                    img.src = getAvatarUrl(p.avatar_seed);
                });
            }

            switch (data.mode) {
                case 'auth':
                    showMode('select');
                    setHostedAuthChoiceVisible(true);
                    break;

                case 'onboarding':
                    showMode('onboarding');
                    configureDesktopRegistrationMode();
                    setTimeout(() => document.getElementById('onboardingName').focus(), 400);
                    break;

                case 'select':
                    showMode('select');
                    setHostedAuthChoiceVisible(false);
                    renderProfilesList();
                    break;

                case 'login':
                    showMode('login');
                    configureDesktopLoginMode();
                    if (profiles.length > 0) {
                        const user = profiles[0];
                        document.getElementById('loginAvatar').src = getAvatarUrl(user.avatar_seed);
                        document.getElementById('loginName').textContent = user.name;
                        setTimeout(() => document.getElementById('loginPassword').focus(), 400);
                    }
                    break;

                default:
                    goToMain();
                    return;
            }
        } finally {
            finalizeOverlay();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
