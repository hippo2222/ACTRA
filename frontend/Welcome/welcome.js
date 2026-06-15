(function () {
    'use strict';

    function wt(key, fallback) {
        if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
        var v = window.i18n.t(key);
        return v !== key ? v : fallback;
    }

    let currentMode = null;       // 'onboarding' | 'select' | 'login'
    let profiles = [];
    let pendingPasswordUserId = null;
    let legalDocuments = null;
    let consentGateResolver = null;
    let consentGateUserId = null;
    let hostedAuthFlow = false;
    let authProviders = {};
    let hostedVerificationState = null;
    let forgotPasswordState = { mode: 'request', resetToken: '', requestBusy: false, resetBusy: false };
    let initStarted = false;

    // --- API Helper ---
    async function apiFetch(url, options = {}) {
        try {
            const resp = await fetch(url, options);
            let data = null;
            let parseFailed = false;
            try {
                data = await resp.json();
            } catch (jsonErr) {
                parseFailed = true;
            }

            const errorStr = data?.error || '';
            const isStaleSession = resp.status === 401 || 
                                   errorStr === 'user_not_found' || 
                                   errorStr === 'auth_user_not_found';

            if (isStaleSession && url !== '/api/auth/logout') {
                console.warn(`[Welcome] Stale session detected on request ${url}. Clearing cookie...`);
                // Clear the cookie in the background
                fetch('/api/auth/logout', { method: 'POST' }).catch(err => {
                    console.error('[Welcome] Stale session logout call failed:', err);
                });
            }

            if (parseFailed) {
                return { ok: resp.ok, error: 'Invalid JSON response' };
            }

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

    function setAuthProviders(providers) {
        authProviders = providers && typeof providers === 'object' ? providers : {};
        const googleEnabled = !!(authProviders.google && authProviders.google.enabled);
        document.querySelectorAll('[data-google-auth-button]').forEach((button) => {
            button.disabled = !googleEnabled;
            button.setAttribute('aria-disabled', googleEnabled ? 'false' : 'true');
            button.title = googleEnabled ? '' : wt('welcome.google_not_configured', 'Google OAuth пока не настроен в локальном окружении');
            const label = button.querySelector('[data-google-auth-label]');
            if (label) {
                label.textContent = googleEnabled
                    ? button.dataset.googleEnabledLabel || wt('welcome.google_btn_enabled', 'Продолжить через Google')
                    : button.dataset.googleDisabledLabel || wt('welcome.google_btn_disabled', 'Google OAuth не настроен');
            }
        });
    }

    function getSearchParam(name) {
        try {
            return new URL(window.location.href).searchParams.get(name) || '';
        } catch (_) {
            return '';
        }
    }

    function getRequestedWelcomeView() {
        const view = String(getSearchParam('view') || getSearchParam('mode') || '').trim().toLowerCase();
        if (['register', 'registration', 'signup', 'sign-up'].includes(view)) return 'register';
        if (['login', 'signin', 'sign-in'].includes(view)) return 'login';
        return '';
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

    function formatPremiumDate(value) {
        const date = new Date(String(value || ''));
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
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
        if (!name || name.trim().length === 0) return wt('welcome.validate_name_required', 'Введите имя профиля');
        name = name.trim();
        if (name.length < 2) return wt('welcome.validate_name_min', 'Минимум 2 символа');
        if (name.length > 50) return wt('welcome.validate_name_max', 'Максимум 50 символов');
        const forbidden = ['/', '\\', '<', '>', ':', '"', '|', '?', '*'];
        if (forbidden.some(c => name.includes(c))) {
            return wt('welcome.validate_name_forbidden', 'Недопустимые символы: {chars}').replace('{chars}', forbidden.join(', '));
        }
        return null;
    }

    function validateLogin(login) {
        const value = String(login || '').trim().toLowerCase();
        if (!value) return wt('welcome.validate_login_required', 'Введите логин');
        if (value.length < 3 || value.length > 32) return wt('welcome.validate_login_length', 'Логин должен быть длиной 3-32 символа');
        if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(value)) {
            return wt('welcome.validate_login_format', 'Логин может содержать только латиницу, цифры, ".", "-" и "_"');
        }
        return null;
    }

    function validateEmail(email) {
        const value = String(email || '').trim().toLowerCase();
        if (!value) return wt('welcome.validate_email_required', 'Введите email');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return wt('welcome.validate_email_invalid', 'Введите корректный email');
        return null;
    }

    function validatePassword(password) {
        if (!password) return wt('welcome.validate_password_required', 'Введите пароль');
        if (String(password).length < 8) return wt('welcome.validate_password_length', 'Пароль должен содержать минимум 8 символов');
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
                return wt('welcome.verify_already_verified', 'Почта уже подтверждена. Можно продолжать.');
            case 'token_already_used':
                return wt('welcome.verify_token_used', 'Эта ссылка уже была использована. Если аккаунт подтверждён, просто продолжайте вход.');
            case 'invalid_or_expired_token':
                return wt('welcome.verify_token_expired', 'Ссылка подтверждения недействительна или уже истекла. Запросите новое письмо.');
            case 'email_changed':
                return wt('welcome.verify_email_changed', 'Для аккаунта уже указан другой email. Запросите новое письмо для актуального адреса.');
            case 'not_configured':
            case 'disabled':
                return wt('welcome.verify_not_configured', 'Письма подтверждения сейчас временно недоступны. Попробуйте позже.');
            case 'send_failed':
                return wt('welcome.verify_send_failed', 'Не удалось отправить письмо. Попробуйте ещё раз через несколько секунд.');
            case 'email_missing':
                return wt('welcome.verify_email_missing', 'Для аккаунта не указан email для подтверждения.');
            default:
                return wt('welcome.verify_failed', 'Не удалось завершить подтверждение почты.');
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
                return wt('welcome.forgot_identifier_required', 'Введите логин или email.');
            case 'disabled':
            case 'not_configured':
                return wt('welcome.forgot_not_configured', 'Письма для восстановления пароля сейчас недоступны. Попробуйте позже.');
            case 'send_failed':
                return wt('welcome.forgot_send_failed', 'Не удалось отправить письмо. Попробуйте ещё раз чуть позже.');
            case 'email_missing':
                return wt('welcome.forgot_email_missing', 'Для этого аккаунта не указана почта для восстановления.');
            default:
                return wt('welcome.forgot_failed', 'Не удалось запустить восстановление пароля.');
        }
    }

    function describeResetPasswordProblem(code) {
        switch (String(code || '').trim()) {
            case 'token_required':
                return wt('welcome.reset_token_required', 'Ссылка для сброса пароля отсутствует или повреждена.');
            case 'invalid_password':
                return wt('welcome.reset_password_length', 'Новый пароль должен содержать минимум 8 символов.');
            case 'token_already_used':
                return wt('welcome.reset_token_used', 'Эта ссылка уже была использована. Запросите новое письмо.');
            case 'invalid_or_expired_token':
                return wt('welcome.reset_token_expired', 'Ссылка для сброса недействительна или уже истекла. Запросите новое письмо.');
            case 'email_changed':
                return wt('welcome.reset_email_changed', 'Почта аккаунта уже изменилась. Запросите новое письмо для актуального адреса.');
            default:
                return wt('welcome.reset_failed', 'Не удалось сохранить новый пароль.');
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
            isResetMode ? wt('welcome.forgot_title_reset', 'Новый пароль') : wt('welcome.forgot_title_request', 'Восстановление пароля')
        );
        setText(
            'forgotPasswordSubtitle',
            isResetMode
                ? wt('welcome.forgot_subtitle_reset', 'Введите новый пароль для аккаунта, открытого по ссылке из письма.')
                : wt('welcome.forgot_subtitle_request', 'Укажите логин или email, и мы отправим ссылку для сброса.')
        );

        setForgotPasswordButtonBusy(
            'forgotPasswordRequestBtn',
            forgotPasswordState.requestBusy,
            wt('welcome.forgot_request_btn', 'Отправить ссылку'),
            wt('welcome.forgot_request_btn_busy', 'Отправляем...')
        );
        setForgotPasswordButtonBusy(
            'forgotPasswordResetBtn',
            forgotPasswordState.resetBusy,
            wt('welcome.forgot_reset_btn', 'Сохранить новый пароль'),
            wt('welcome.forgot_reset_btn_busy', 'Сохраняем...')
        );
    }

    function buildHostedVerificationStatusMessage(state) {
        if (!state) return '';
        if (state.statusMessage) return state.statusMessage;

        const user = state.user || {};
        const sentAt = user.email_verification_sent_at || state.sentAt || '';
        const effectivePlan = String(user.effective_plan || '').trim().toLowerCase();
        const premiumExpiresAt = String(user.premium_expires_at || '').trim();
        const premiumDate = effectivePlan === 'premium' && premiumExpiresAt
            ? formatPremiumDate(premiumExpiresAt)
            : '';
        if (state.status === 'verified') {
            return user.email_verified_at
                ? wt('welcome.verify_status_confirmed_at', 'Почта подтверждена {date}.').replace('{date}', user.email_verified_at)
                : wt('welcome.verify_status_confirmed', 'Почта подтверждена. Аккаунт готов к работе.');
        }
        if (state.status === 'error') {
            return state.verificationEmail?.sent
                ? wt('welcome.verify_status_resent', 'Новое письмо уже отправлено. Проверьте входящие.')
                : '';
        }
        if (premiumDate) {
            return wt('welcome.verify_status_premium', 'Premium активирован до {date}. Подтвердите email, чтобы завершить регистрацию.').replace('{date}', premiumDate);
        }
        return sentAt
            ? wt('welcome.verify_status_sent_at', 'Последнее письмо отправлено {date}.').replace('{date}', sentAt)
            : wt('welcome.verify_status_sent', 'Письмо уже отправлено. Откройте ссылку из письма, чтобы завершить регистрацию.');
    }

    function applyHostedVerificationState() {
        const isActive = currentMode === 'onboarding' && isHostedAuthMode() && !!hostedVerificationState;
        toggleHidden('onboardingVerificationPanel', !isActive);
        toggleHidden('modeOnboardingCard', isActive);
        toggleHidden('onboardingCreateBtn', isActive);
        toggleHidden('onboardingSocialAuth', isActive || !isHostedAuthMode());
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
        let title = wt('welcome.verify_panel_title', 'Проверьте почту');
        let body = wt('welcome.verify_panel_body', 'Мы отправили письмо со ссылкой для подтверждения. После этого аккаунт будет считаться подтверждённым.');
        let hint = wt('welcome.verify_panel_hint', 'Если письмо не пришло сразу, подождите немного и проверьте папку spam.');
        let icon = 'mail';
        let canResend = state.canResend !== false;

        if (status === 'verified') {
            eyebrow = 'Email confirmed';
            title = wt('welcome.verify_panel_confirmed_title', 'Почта подтверждена');
            body = wt('welcome.verify_panel_confirmed_body', 'Подтверждение прошло успешно. Можно возвращаться в ACTRA и продолжать работу.');
            hint = wt('welcome.verify_panel_confirmed_hint', 'Если это окно открылось из письма, просто вернитесь в приложение или нажмите кнопку ниже.');
            icon = 'verified';
            canResend = false;
        } else if (status === 'error') {
            eyebrow = 'Verification issue';
            title = wt('welcome.verify_panel_error_title', 'Нужно подтвердить почту');
            body = state.message || describeVerificationProblem(state.reason);
            hint = wt('welcome.verify_panel_error_hint', 'Можно запросить новое письмо ещё раз. Если адрес был введён с ошибкой, позже его можно будет заменить в настройках.');
            icon = 'error';
        }

        setText('onboardingVerificationEyebrow', eyebrow);
        setText('onboardingVerificationTitle', title);
        setText('onboardingVerificationBody', body);
        setText('onboardingVerificationEmail', email || wt('welcome.verify_email_not_specified', 'Email не указан'));
        setText('onboardingVerificationStatus', buildHostedVerificationStatusMessage(state));
        setText('onboardingVerificationHint', hint);

        const iconEl = document.getElementById('onboardingVerificationIcon');
        if (iconEl) iconEl.textContent = icon;

        const resendBtn = document.getElementById('onboardingVerificationResendBtn');
        if (resendBtn) {
            resendBtn.disabled = !!state.resendBusy;
            resendBtn.textContent = state.resendBusy ? wt('welcome.verify_resend_btn_busy', 'Отправляем...') : wt('welcome.verify_resend_btn', 'Отправить ещё раз');
            resendBtn.classList.toggle('hidden', !canResend);
        }

        const continueBtn = document.getElementById('onboardingVerificationContinueBtn');
        if (continueBtn) {
            const shouldReturnToAuth = status === 'error' && !user.user_id;
            continueBtn.textContent = shouldReturnToAuth ? wt('welcome.verify_continue_return_auth', 'К регистрации') : wt('welcome.verify_continue_enter_actra', 'Перейти в ACTRA');
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
                    ? wt('welcome.verify_status_confirmed_at', 'Почта подтверждена {date}.').replace('{date}', data.verification.verified_at)
                    : wt('welcome.verify_status_confirmed', 'Почта подтверждена. Аккаунт готов к работе.'),
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
        if (!legalDocuments) return { terms_version: '', privacy_version: '', refund_version: '' };
        return {
            terms_version: legalDocuments.terms?.version || '',
            privacy_version: legalDocuments.privacy?.version || '',
            refund_version: legalDocuments.refund?.version || ''
        };
    }

    function hasRequiredConsentVersions() {
        const versions = getRequiredConsentVersions();
        return Boolean(versions.terms_version && versions.privacy_version && versions.refund_version);
    }

    function showMissingLegalDocumentsError(errorId = 'onboardingError') {
        showError(errorId, 'Legal documents are not fully configured. Please try again later or contact support.');
    }

    function collectConsent(termsCheckboxId, privacyCheckboxId, refundCheckboxId) {
        const termsEl = document.getElementById(termsCheckboxId);
        const privacyEl = document.getElementById(privacyCheckboxId);
        const refundEl = document.getElementById(refundCheckboxId);
        const versions = getRequiredConsentVersions();
        return {
            accepted: !!(termsEl && termsEl.checked && privacyEl && privacyEl.checked && refundEl && refundEl.checked),
            terms_version: versions.terms_version,
            privacy_version: versions.privacy_version,
            refund_version: versions.refund_version,
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
            showError('onboardingError', wt('welcome.legal_load_failed', 'Не удалось загрузить юридические документы'));
            return;
        }

        const { ok, data } = await apiFetch(`/api/legal/document/${docType}`);
        if (!ok || !data.document) {
            showError('onboardingError', wt('welcome.legal_open_failed', 'Не удалось открыть документ'));
            return;
        }

        const doc = data.document;
        const titleEl = document.getElementById('legalDocTitle');
        const metaEl = document.getElementById('legalDocMeta');
        const contentEl = document.getElementById('legalDocContent');
        if (titleEl) titleEl.textContent = doc.title || wt('welcome.legal_doc_fallback', 'Документ');
        if (metaEl) metaEl.textContent = wt('welcome.legal_doc_meta', 'Версия: {version} | Действует с: {date}')
            .replace('{version}', doc.version || '-')
            .replace('{date}', doc.effective_at || '-');
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
            const refund = document.getElementById('onboardingAcceptRefund');
            if (btn) btn.disabled = !(terms?.checked && privacy?.checked && refund?.checked);
            return;
        }
        if (scope === 'select') {
            const btn = document.getElementById('selectCreateBtn');
            const terms = document.getElementById('selectAcceptTerms');
            const privacy = document.getElementById('selectAcceptPrivacy');
            const refund = document.getElementById('selectAcceptRefund');
            if (btn) btn.disabled = !(terms?.checked && privacy?.checked && refund?.checked);
            return;
        }
        if (scope === 'gate') {
            const btn = document.getElementById('consentGateSubmitBtn');
            const terms = document.getElementById('consentGateAcceptTerms');
            const privacy = document.getElementById('consentGateAcceptPrivacy');
            const refund = document.getElementById('consentGateAcceptRefund');
            if (btn) btn.disabled = !(terms?.checked && privacy?.checked && refund?.checked);
        }
    };

    function openConsentGate(userId, required) {
        consentGateUserId = userId;
        const versionsEl = document.getElementById('consentGateVersions');
        const termsEl = document.getElementById('consentGateAcceptTerms');
        const privacyEl = document.getElementById('consentGateAcceptPrivacy');
        const refundEl = document.getElementById('consentGateAcceptRefund');

        if (versionsEl) {
            versionsEl.textContent = `Terms: ${required.terms_version || '-'} | Privacy: ${required.privacy_version || '-'} | Refund: ${required.refund_version || '-'}`;
        }
        if (termsEl) termsEl.checked = false;
        if (privacyEl) privacyEl.checked = false;
        if (refundEl) refundEl.checked = false;
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
            showConsentGateError(wt('welcome.consent_not_selected', 'Не выбран профиль'));
            return;
        }

        if (!hasRequiredConsentVersions()) {
            showConsentGateError('Legal documents are not fully configured. Please try again later or contact support.');
            return;
        }

        const consent = collectConsent('consentGateAcceptTerms', 'consentGateAcceptPrivacy', 'consentGateAcceptRefund');
        if (!consent.accepted) {
            showConsentGateError(wt('welcome.consent_confirm_all', 'Подтвердите все три документа'));
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
            showConsentGateError((data && (data.message || data.error)) || wt('welcome.consent_save_failed', 'Не удалось сохранить согласие'));
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
        if (!hasRequiredConsentVersions()) return false;

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

    window.welcomeTogglePassword = function (inputId, button) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const willShow = input.type === 'password';
        input.type = willShow ? 'text' : 'password';
        if (button) {
            button.setAttribute('aria-label', willShow ? wt('welcome.pw_toggle_hide', 'Скрыть пароль') : wt('welcome.pw_toggle_show', 'Показать пароль'));
            const icon = button.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = willShow ? 'visibility_off' : 'visibility';
        }
        input.focus();
    };

    window.welcomeStartGoogleAuth = function () {
        if (!(authProviders.google && authProviders.google.enabled)) return;
        window.location.href = '/api/auth/google/start';
    };

    function configureHostedRegistrationMode() {
        clearHostedVerificationState();
        setHostedAuthChoiceVisible(false);
        toggleHidden('onboardingAvatarPreviewWrap', true);
        toggleHidden('onboardingAvatarGallery', true);
        toggleHidden('onboardingNameIcon', false);
        toggleHidden('onboardingLoginField', true);
        toggleHidden('hostedRegistrationFields', false);
        toggleHidden('onboardingSocialAuth', false);
        toggleHidden('onboardingSecondaryAction', false);

        const avatarPicker = document.getElementById('onboardingAvatarPicker');
        if (avatarPicker) {
            avatarPicker.className = 'flex flex-col items-center gap-0 mb-0';
        }

        const nameField = document.getElementById('onboardingNameField');
        const promo = document.getElementById('registrationPremiumPromo');
        if (nameField) {
            nameField.className = 'relative w-full';
            if (promo) {
                promo.parentNode.insertBefore(nameField, promo.nextSibling);
            }
        }

        const button = document.getElementById('onboardingCreateBtn');
        if (button) {
            button.innerHTML = `${wt('welcome.btn_create_account', 'Создать аккаунт')} <span class="material-symbols-outlined">person_add</span>`;
        }

        const nameInput = document.getElementById('onboardingName');
        if (nameInput) {
            nameInput.placeholder = wt('welcome.placeholder_name_hosted', 'Отображаемое имя');
            nameInput.className = 'w-full pl-12 pr-4 py-3.5 bg-surface-2 border border-border-strong rounded-xl outline-none focus:ring-2 focus:ring-primary transition-all font-medium text-base placeholder:text-text-secondary';
        }

        const avatarSeedInput = document.getElementById('onboardingAvatarSeed');
        if (avatarSeedInput) avatarSeedInput.value = '1.png';
        window.welcomeUpdateConsentState('onboarding');
    }

    function configureDesktopRegistrationMode() {
        clearHostedVerificationState();
        setHostedAuthChoiceVisible(false);
        toggleHidden('onboardingAvatarPreviewWrap', false);
        toggleHidden('onboardingAvatarGallery', false);
        toggleHidden('onboardingNameIcon', true);
        toggleHidden('onboardingLoginField', false);
        toggleHidden('hostedRegistrationFields', true);
        toggleHidden('onboardingSocialAuth', true);
        toggleHidden('onboardingSecondaryAction', true);
        loadAvatarGallery('onboardingAvatarGallery', 'onboardingAvatarSeed', 'onboardingAvatarPreview');

        const avatarPicker = document.getElementById('onboardingAvatarPicker');
        const nameField = document.getElementById('onboardingNameField');
        if (avatarPicker && nameField) {
            avatarPicker.appendChild(nameField);
            avatarPicker.className = 'flex flex-col items-center gap-4 mb-5';
            nameField.className = 'w-full text-center';
        }

        const button = document.getElementById('onboardingCreateBtn');
        if (button) {
            button.innerHTML = `${wt('welcome.btn_start_learning', 'Начать обучение')} <span class="material-symbols-outlined">arrow_forward</span>`;
        }

        const nameInput = document.getElementById('onboardingName');
        if (nameInput) {
            nameInput.placeholder = wt('welcome.placeholder_name_desktop', 'Ваше имя');
            nameInput.className = 'welcome-name-input w-full text-center bg-transparent border-b-2 border-border-subtle focus:border-primary px-4 py-2 text-2xl font-bold text-text-main outline-none transition-colors placeholder:text-text-secondary';
        }
    }

    function configureHostedLoginMode() {
        setHostedAuthChoiceVisible(false);
        toggleHidden('loginIdentifierWrap', false);
        toggleHidden('forgotPasswordLink', false);
        toggleHidden('loginBackBtn', false);
        toggleHidden('loginSocialAuth', false);
        toggleHidden('loginAvatar', true);
        toggleHidden('loginName', true);

        const passwordInput = document.getElementById('loginPassword');
        if (passwordInput) passwordInput.placeholder = wt('welcome.placeholder_password', 'Пароль');

        const identifierInput = document.getElementById('loginIdentifier');
        if (identifierInput) identifierInput.focus();

        const submitButton = document.getElementById('loginSubmitBtn');
        if (submitButton) {
            submitButton.innerHTML = `${wt('welcome.btn_login', 'Войти')} <span class="material-symbols-outlined">login</span>`;
        }
    }

    function configureDesktopLoginMode() {
        setHostedAuthChoiceVisible(false);
        toggleHidden('loginIdentifierWrap', true);
        toggleHidden('forgotPasswordLink', true);
        toggleHidden('loginBackBtn', true);
        toggleHidden('loginSocialAuth', true);
        toggleHidden('loginAvatar', false);
        toggleHidden('loginName', false);

        const submitButton = document.getElementById('loginSubmitBtn');
        if (submitButton) {
            submitButton.innerHTML = `${wt('welcome.btn_login_system', 'Войти в систему')} <span class="material-symbols-outlined">login</span>`;
        }
    }

    function setWelcomePageMode(mode) {
        if (!document.body) return;
        const nextMode = mode === 'auth' ? 'auth' : 'landing';
        document.body.dataset.mode = nextMode;
        document.body.classList.toggle('welcome-auth-open', nextMode === 'auth');
        document.body.classList.remove('welcome-auth-entering', 'welcome-auth-closing');
        if (nextMode === 'auth') {
            document.body.classList.add('welcome-auth-entering');
            window.setTimeout(() => {
                document.body?.classList.remove('welcome-auth-entering');
            }, 420);
        }
    }

    let welcomeAuthEntryScrollY = 0;
    let welcomeAuthShouldScrollToHero = false;

    function getWelcomeShell() {
        return document.querySelector('.welcome-shell') || document.querySelector('.welcome-hero');
    }

    function isWelcomeShellAlreadyFramed() {
        const shell = getWelcomeShell();
        if (!shell) return false;
        const rect = shell.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        return rect.top >= -8 && rect.top <= 96 && rect.bottom >= Math.min(360, viewportHeight * 0.5);
    }

    function openWelcomeAuthLayer() {
        welcomeAuthEntryScrollY = window.scrollY || document.documentElement.scrollTop || 0;
        welcomeAuthShouldScrollToHero = !isWelcomeShellAlreadyFramed();
        setWelcomePageMode('auth');
    }

    function keepHeroInViewIfNeeded() {
        const shell = getWelcomeShell();
        if (!shell || typeof shell.scrollIntoView !== 'function') return;

        const rect = shell.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const isAlreadyFramed = rect.top >= 0 && rect.top <= 96 && rect.bottom >= Math.min(360, viewportHeight * 0.5);
        if (isAlreadyFramed) return;

        shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    window.welcomeShowAuthLogin = function () {
        openWelcomeAuthLayer();
        showMode('login');
        configureHostedLoginMode();
        setTimeout(() => {
            if (welcomeAuthShouldScrollToHero) keepHeroInViewIfNeeded();
        }, 0);
    };

    window.welcomeShowAuthRegister = function () {
        openWelcomeAuthLayer();
        showMode('onboarding');
        configureHostedRegistrationMode();
        setTimeout(() => {
            if (welcomeAuthShouldScrollToHero) keepHeroInViewIfNeeded();
        }, 0);
    };

    window.welcomeScrollToTop = function () {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    };

    window.welcomeScrollToRegister = function () {
        window.welcomeShowAuthRegister();
    };

    window.welcomeReturnToHero = function () {
        const finishReturn = () => {
            clearHostedVerificationState();
            setHostedAuthChoiceVisible(false);
            setWelcomePageMode('landing');
            if (!welcomeAuthShouldScrollToHero) {
                window.requestAnimationFrame(() => {
                    window.scrollTo({ top: welcomeAuthEntryScrollY, left: 0, behavior: 'auto' });
                });
            }
        };

        if (document.body?.dataset.mode === 'auth') {
            document.body.classList.remove('welcome-auth-entering');
            document.body.classList.add('welcome-auth-closing');
            window.setTimeout(finishReturn, 220);
            return;
        }

        finishReturn();
    };

    window.welcomeBackToAuthChoice = function () {
        openWelcomeAuthLayer();
        clearHostedVerificationState();
        showMode('select');
        setHostedAuthChoiceVisible(true);
    };

    function openDesktopCreateProfileForm() {
        const form = document.getElementById('createProfileSection');
        if (form && !form.querySelector('*')) {
            form.classList.add('hidden');
        }
        window.welcomeToggleCreate();
    }

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
                error: (data && (data.message || describeVerificationProblem(data.error))) || wt('welcome.verify_resend_failed', 'Не удалось отправить письмо повторно.'),
            });
            return;
        }

        showHostedVerificationState(
            buildHostedVerificationStateFromResponse(data, {
                resendBusy: false,
                error: '',
                statusMessage: data?.verification_email?.sent
                    ? wt('welcome.verify_status_resent', 'Новое письмо уже отправлено. Проверьте входящие.')
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
            setForgotPasswordStatus('forgotPasswordRequestStatus', wt('welcome.forgot_identifier_required', 'Введите логин или email.'), 'error');
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
                (data && (data.message || describeForgotPasswordProblem(data.error))) || wt('welcome.forgot_send_recovery_failed', 'Не удалось отправить письмо для восстановления.'),
                'error'
            );
            return;
        }

        setForgotPasswordStatus(
            'forgotPasswordRequestStatus',
            data?.message || wt('welcome.forgot_sent_success', 'Если аккаунт существует, письмо уже отправлено.'),
            'success'
        );
    };

    window.welcomeSubmitPasswordReset = async function () {
        if (forgotPasswordState.resetBusy) return;
        const token = String(forgotPasswordState.resetToken || '').trim();
        const newPassword = String(document.getElementById('forgotPasswordNewPassword')?.value || '');
        const confirmPassword = String(document.getElementById('forgotPasswordConfirmPassword')?.value || '');

        if (!token) {
            setForgotPasswordStatus('forgotPasswordResetStatus', wt('welcome.forgot_token_missing', 'Ссылка для сброса пароля отсутствует.'), 'error');
            return;
        }
        const passwordError = validatePassword(newPassword);
        if (passwordError) {
            setForgotPasswordStatus('forgotPasswordResetStatus', passwordError, 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            setForgotPasswordStatus('forgotPasswordResetStatus', wt('welcome.forgot_passwords_mismatch', 'Пароли не совпадают.'), 'error');
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
                (data && (data.message || describeResetPasswordProblem(data.error))) || wt('welcome.reset_failed', 'Не удалось сохранить новый пароль.'),
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
            title.textContent = wt('welcome.header_welcome_title', 'Добро пожаловать!');
            subtitle.textContent = wt('welcome.header_welcome_subtitle', 'Создайте профиль, чтобы начать.');
            return;
        }

        if (mode === 'login') {
            title.textContent = wt('welcome.header_return_title', 'С возвращением');
            subtitle.textContent = wt('welcome.header_return_subtitle', 'Введите пароль, чтобы продолжить обучение.');
            return;
        }

        title.textContent = wt('welcome.header_select_title', 'Добро пожаловать');
        subtitle.textContent = wt('welcome.header_select_subtitle', 'Выберите профиль, чтобы продолжить обучение.');
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
                        kicker.textContent = status === 'verified' ? wt('welcome.header_verified_kicker', 'Почта подтверждена') : wt('welcome.header_verify_kicker_pending', 'Подтверждение почты');
                        kicker.classList.remove('hidden');
                    }
                    if (status === 'verified') {
                        title.textContent = wt('welcome.header_verified_title', 'Почта подтверждена');
                        subtitle.textContent = wt('welcome.header_verified_subtitle', 'Аккаунт активирован. Можно переходить в ACTRA и продолжать работу.');
                        return;
                    }
                    if (status === 'error') {
                        title.textContent = wt('welcome.header_verify_error_title', 'Подтвердите email');
                        subtitle.textContent = wt('welcome.header_verify_error_subtitle', 'Ссылка не сработала или письмо не дошло. Отсюда можно отправить новое письмо и завершить регистрацию.');
                        return;
                    }
                    title.textContent = wt('welcome.header_verify_error_title', 'Подтвердите email');
                    subtitle.textContent = wt('welcome.header_verify_pending_subtitle', 'Мы уже отправили письмо с ссылкой. Откройте его, чтобы завершить первичную регистрацию аккаунта.');
                    return;
                }
                if (kicker) {
                    kicker.textContent = wt('welcome.header_new_account_kicker', 'Новый аккаунт');
                    kicker.classList.remove('hidden');
                }
                title.textContent = wt('welcome.header_create_title', 'Создайте аккаунт');
                subtitle.textContent = wt('welcome.header_create_subtitle', 'Заполните данные для создания аккаунта.');
                return;
            }

            if (mode === 'login') {
                if (kicker) {
                    kicker.textContent = wt('welcome.header_login_kicker', 'Вход');
                    kicker.classList.remove('hidden');
                }
                title.textContent = wt('welcome.header_login_title', 'Войти в аккаунт');
                subtitle.textContent = wt('welcome.header_login_subtitle', 'Введите логин или email и пароль, чтобы продолжить обучение и открыть библиотеку.');
                return;
            }

            if (kicker) {
                kicker.textContent = 'ACTRA Web';
                kicker.classList.remove('hidden');
            }
            title.textContent = wt('welcome.header_choice_title', 'Вход или регистрация');
            subtitle.textContent = wt('welcome.header_choice_subtitle', 'Используйте существующий аккаунт или создайте новый, чтобы открыть библиотеку, прогресс и публикации.');
            return;
        }

        if (mode === 'onboarding') {
            title.textContent = wt('welcome.header_welcome_title', 'Добро пожаловать!');
            subtitle.textContent = wt('welcome.header_welcome_subtitle', 'Создайте профиль, чтобы начать.');
            return;
        }

        if (mode === 'login') {
            title.textContent = wt('welcome.header_return_title', 'С возвращением');
            subtitle.textContent = wt('welcome.header_return_subtitle', 'Введите пароль, чтобы продолжить обучение.');
            return;
        }

        title.textContent = wt('welcome.header_select_title', 'Добро пожаловать');
        subtitle.textContent = wt('welcome.header_select_subtitle', 'Выберите профиль, чтобы продолжить обучение.');
    }

    function showStartupLoadError(message) {
        const title = document.getElementById('welcomeHeaderTitle');
        const subtitle = document.getElementById('welcomeHeaderSubtitle');
        if (title) title.textContent = wt('welcome.startup_error_title', 'Не удалось загрузить стартовый экран');
        if (subtitle) subtitle.textContent = wt('welcome.startup_error_subtitle', 'Повторите попытку или перезапустите приложение.');

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
                <h3 class="text-2xl font-black text-text-main mb-3">${escapeHtml(wt('welcome.startup_error_heading', 'Стартовые данные недоступны'))}</h3>
                <p class="text-sm text-text-secondary mb-6">${escapeHtml(message || wt('welcome.startup_error_message', 'Не удалось получить данные для входа.'))}</p>
                <button type="button" onclick="window.welcomeRetryInit()"
                    class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-fg hover:bg-primary-hover transition-colors">
                    <span class="material-symbols-outlined text-[18px]">refresh</span>
                    ${escapeHtml(wt('welcome.startup_retry_btn', 'Повторить'))}
                </button>
            </div>
        `;
    }

    // --- Navigate to main ---
    function goToMain() {
        window.navigateWithTransition('/main');
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
            showError(errorElementId, wt('welcome.create_docs_failed', 'Не удалось загрузить документы для согласия'));
            return false;
        }

        if (!hasRequiredConsentVersions()) {
            showMissingLegalDocumentsError(errorElementId);
            return false;
        }

        const consent = collectConsent(
            consentConfig.termsCheckboxId,
            consentConfig.privacyCheckboxId,
            consentConfig.refundCheckboxId
        );
        if (!consent.accepted) {
            showError(errorElementId, wt('welcome.create_consent_required', 'Подтвердите согласие с условиями и политикой приватности'));
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
            showError(errorElementId, (data && (data.message || data.error)) || wt('welcome.create_profile_failed', 'Не удалось создать профиль'));
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
        const btn = document.getElementById('onboardingCreateBtn');
        if (btn && btn.disabled) {
            return;
        }
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
                showError('onboardingError', wt('welcome.create_passwords_mismatch', 'Пароли не совпадают'));
                return;
            }

            const loaded = await ensureLegalDocumentsLoaded();
            if (!loaded) {
                showError('onboardingError', wt('welcome.create_docs_failed', 'Не удалось загрузить документы для согласия'));
                return;
            }
            if (!hasRequiredConsentVersions()) {
                showMissingLegalDocumentsError('onboardingError');
                return;
            }
            const consent = collectConsent('onboardingAcceptTerms', 'onboardingAcceptPrivacy', 'onboardingAcceptRefund');
            if (!consent.accepted) {
                showError('onboardingError', wt('welcome.create_consent_docs', 'Подтвердите согласие с документами'));
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
                showError('onboardingError', (data && (data.message || data.error)) || wt('welcome.create_account_failed', 'Не удалось создать аккаунт'));
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
            refundCheckboxId: 'onboardingAcceptRefund',
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
            refundCheckboxId: 'selectAcceptRefund',
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
                        <input type="text" id="selectNewName" placeholder="${escapeHtml(wt('welcome.placeholder_profile_name', 'Имя профиля...'))}"
                            class="welcome-name-input w-full text-center bg-transparent border-b-2 border-border-subtle focus:border-primary px-2 py-2 text-xl font-bold text-text-main outline-none transition-colors placeholder:text-text-secondary"
                            maxlength="50" onkeydown="if(event.key==='Enter'){event.preventDefault();window.welcomeCreateFromSelect()}">
                    </div>

                    <div id="selectAvatarGallery" class="flex justify-center flex-wrap gap-3 p-2 mb-6 overflow-visible"></div>
                    <input type="hidden" id="selectAvatarSeed" value="1.png">

                    <div class="mb-4 rounded-xl border border-border-subtle bg-surface-2 p-4">
                        <p class="text-xs font-semibold text-text-secondary mb-3">
                            ${escapeHtml(wt('welcome.consent_header', 'Для создания профиля подтвердите согласие с документами:'))}
                        </p>
                        <label class="flex items-start gap-3 text-sm text-text-main mb-2 cursor-pointer">
                            <input type="checkbox" id="selectAcceptTerms"
                                class="mt-0.5 rounded text-primary focus:ring-primary"
                                onchange="window.welcomeUpdateConsentState('select')">
                            <span>
                                ${escapeHtml(wt('welcome.consent_i_accept', 'Я принимаю'))}
                                <button type="button"
                                    class="text-primary hover:underline font-semibold"
                                    onclick="window.welcomeOpenLegalDocument('terms'); return false;">
                                    ${escapeHtml(wt('welcome.terms_label', 'Условия пользования'))}
                                </button>
                            </span>
                        </label>
                        <label class="flex items-start gap-3 text-sm text-text-main mb-2 cursor-pointer">
                            <input type="checkbox" id="selectAcceptPrivacy"
                                class="mt-0.5 rounded text-primary focus:ring-primary"
                                onchange="window.welcomeUpdateConsentState('select')">
                            <span>
                                ${escapeHtml(wt('welcome.consent_i_read', 'Я ознакомился(ась) с'))}
                                <button type="button"
                                    class="text-primary hover:underline font-semibold"
                                    onclick="window.welcomeOpenLegalDocument('privacy'); return false;">
                                    ${escapeHtml(wt('welcome.privacy_label', 'Политикой приватности'))}
                                </button>
                            </span>
                        </label>
                        <label class="flex items-start gap-3 text-sm text-text-main cursor-pointer">
                            <input type="checkbox" id="selectAcceptRefund"
                                class="mt-0.5 rounded text-primary focus:ring-primary"
                                onchange="window.welcomeUpdateConsentState('select')">
                            <span>
                                ${escapeHtml(wt('welcome.consent_i_read', 'Я ознакомился(ась) с'))}
                                <button type="button"
                                    class="text-primary hover:underline font-semibold"
                                    onclick="window.welcomeOpenLegalDocument('refund'); return false;">
                                    ${escapeHtml(wt('welcome.refund_label', 'Политикой возвратов'))}
                                </button>
                            </span>
                        </label>
                    </div>

                    <p id="selectError" class="text-xs text-error font-bold mb-4 hidden bg-error/10 p-2 rounded text-center"></p>

                    <button id="selectCreateBtn" onclick="window.welcomeCreateFromSelect()"
                        class="w-full py-4 rounded-xl font-bold bg-primary text-primary-fg hover:bg-primary-hover shadow-lg transition-all text-base tracking-wide flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled>
                        ${escapeHtml(wt('welcome.create_profile_btn', 'Создать профиль'))}
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
                    <span class="text-[10px] text-text-secondary font-bold uppercase tracking-wider mt-0.5">${escapeHtml(wt('welcome.profile_password_badge', 'Вход по паролю'))}</span>
                </div>
            `;
            const pwdSection = document.getElementById('passwordInline');
            pwdSection.classList.remove('hidden');
            document.getElementById('passwordInlineError').classList.add('hidden');

            const usernameInput = document.getElementById('passwordInlineUsername');
            if (usernameInput) {
                usernameInput.value = profile.login || profile.name || '';
            }

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
            showError('passwordInlineError', wt('welcome.validate_password_required', 'Введите пароль'));
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
            showError('passwordInlineError', wt('welcome.error_password_wrong', 'Неверный пароль'));
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
        const usernameInput = document.getElementById('passwordInlineUsername');
        if (usernameInput) {
            usernameInput.value = '';
        }
    };

    // --- Public: Login mode submit ---
    window.welcomeLoginSubmit = async function () {
        if (isHostedAuthMode()) {
            const identifier = document.getElementById('loginIdentifier').value;
            const password = document.getElementById('loginPassword').value;
            if (!identifier || !String(identifier).trim()) {
                showError('loginError', wt('welcome.error_login_required', 'Введите логин или email'));
                return;
            }
            if (!password) {
                showError('loginError', wt('welcome.validate_password_required', 'Введите пароль'));
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

            showError('loginError', (data && (data.message || data.error)) || wt('welcome.error_credentials_wrong', 'Неверный логин, email или пароль'));
            const input = document.getElementById('loginPassword');
            input.closest('.bg-surface-1').classList.add('shake');
            setTimeout(() => input.closest('.bg-surface-1').classList.remove('shake'), 400);
            input.value = '';
            input.focus();
            return;
        }

        const password = document.getElementById('loginPassword').value;
        if (!password) {
            showError('loginError', wt('welcome.validate_password_required', 'Введите пароль'));
            return;
        }

        const user = profiles[0];
        if (!user || !user.user_id) {
            showError('loginError', wt('welcome.error_profile_not_found', 'Профиль не найден'));
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
            showError('loginError', wt('welcome.error_password_wrong', 'Неверный пароль'));
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
                        ${hasLock ? escapeHtml(wt('welcome.profile_password_hint', 'Требуется пароль')) : escapeHtml(wt('welcome.profile_click_hint', 'Нажмите для входа'))}
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
                     <p class="text-lg font-bold text-text-secondary group-hover:text-primary transition-colors tracking-tight">${escapeHtml(wt('welcome.profile_new', 'Новый профиль'))}</p>
                </div>
            </button>`;

        container.innerHTML = cardsHtml + addCardHtml;
    }

    function setupWelcomeSurfaceCarousel() {
        document.querySelectorAll('[data-welcome-carousel]').forEach((carousel) => {
            const track = carousel.querySelector('[data-welcome-carousel-track]');
            const slides = Array.from(carousel.querySelectorAll('[data-welcome-carousel-slide]'));
            const tabs = Array.from(carousel.querySelectorAll('[data-welcome-carousel-tab]'));
            const prev = carousel.querySelector('[data-welcome-carousel-prev]');
            const next = carousel.querySelector('[data-welcome-carousel-next]');
            if (!track || slides.length === 0) return;

            let activeIndex = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
            if (activeIndex < 0) activeIndex = 0;
            let autoplayTimer = 0;
            const autoplayDelay = Number(carousel.dataset.welcomeCarouselDelay || 6200);
            const canAutoplay = !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

            const stopAutoplay = () => {
                if (autoplayTimer) {
                    window.clearTimeout(autoplayTimer);
                    autoplayTimer = 0;
                }
            };

            const startAutoplay = (delay = autoplayDelay) => {
                if (!canAutoplay || autoplayTimer || slides.length < 2) return;
                autoplayTimer = window.setTimeout(() => {
                    autoplayTimer = 0;
                    setActiveSlide(activeIndex + 1, { userInitiated: false });
                    startAutoplay();
                }, delay);
            };

            const pauseAutoplayBriefly = () => {
                if (!canAutoplay) return;
                stopAutoplay();
                startAutoplay(autoplayDelay * 1.15);
            };

            const setActiveSlide = (nextIndex, options = {}) => {
                activeIndex = (nextIndex + slides.length) % slides.length;
                track.style.transform = `translateX(-${activeIndex * 100}%)`;

                slides.forEach((slide, index) => {
                    const isActive = index === activeIndex;
                    slide.classList.toggle('is-active', isActive);
                    slide.setAttribute('aria-hidden', isActive ? 'false' : 'true');
                    slide.inert = !isActive;
                    if (slide.getAttribute('role') === 'tabpanel') {
                        slide.tabIndex = isActive ? 0 : -1;
                    }
                });

                tabs.forEach((tab, index) => {
                    const isActive = index === activeIndex;
                    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
                    tab.tabIndex = isActive ? 0 : -1;
                });

                if (options.userInitiated) {
                    pauseAutoplayBriefly();
                }
            };

            tabs.forEach((tab, index) => {
                tab.addEventListener('click', () => setActiveSlide(index, { userInitiated: true }));
            });

            prev?.addEventListener('click', () => setActiveSlide(activeIndex - 1, { userInitiated: true }));
            next?.addEventListener('click', () => setActiveSlide(activeIndex + 1, { userInitiated: true }));

            carousel.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    setActiveSlide(activeIndex - 1, { userInitiated: true });
                    tabs[activeIndex]?.focus();
                } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    setActiveSlide(activeIndex + 1, { userInitiated: true });
                    tabs[activeIndex]?.focus();
                }
            });

            carousel.addEventListener('mouseenter', stopAutoplay);
            carousel.addEventListener('mouseleave', () => startAutoplay());
            carousel.addEventListener('focusin', stopAutoplay);
            carousel.addEventListener('focusout', () => {
                startAutoplay(900);
            });
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    stopAutoplay();
                } else {
                    startAutoplay();
                }
            });

            setActiveSlide(activeIndex);
            startAutoplay();
        });
    }

    function markDecorativeMaterialIcons() {
        document.querySelectorAll('.material-symbols-outlined').forEach((icon) => {
            if (!icon.hasAttribute('aria-label') && !icon.hasAttribute('aria-hidden')) {
                icon.setAttribute('aria-hidden', 'true');
            }
        });
    }

    function createWelcomePracticeDemoTask() {
        const questions = [
            {
                id: 'wave_q1',
                text: wt('welcome.demo_q1_text', 'Какой параметр электромагнитной волны определяет расстояние между двумя соседними максимумами?'),
                answers: [
                    { id: 0, text: wt('welcome.demo_q1_a1', 'Длина волны') },
                    { id: 1, text: wt('welcome.demo_q1_a2', 'Амплитуда сигнала') },
                    { id: 2, text: wt('welcome.demo_q1_a3', 'Период полураспада') },
                ],
            },
            {
                id: 'wave_q2',
                text: wt('welcome.demo_q2_text', 'Какие утверждения верны для электромагнитных волн?'),
                answers: [
                    { id: 0, text: wt('welcome.demo_q2_a1', 'Могут распространяться в вакууме') },
                    { id: 1, text: wt('welcome.demo_q2_a2', 'Всегда требуют упругую среду') },
                    { id: 2, text: wt('welcome.demo_q2_a3', 'Переносят энергию') },
                ],
            },
            {
                id: 'wave_q3',
                text: wt('welcome.demo_q3_text', 'Что происходит с частотой волны, если период колебаний уменьшается?'),
                answers: [
                    { id: 0, text: wt('welcome.demo_q3_a1', 'Частота уменьшается') },
                    { id: 1, text: wt('welcome.demo_q3_a2', 'Частота увеличивается') },
                    { id: 2, text: wt('welcome.demo_q3_a3', 'Частота не зависит от периода') },
                ],
            },
            {
                id: 'wave_q4',
                text: wt('welcome.demo_q4_text', 'Какая величина показывает число колебаний за одну секунду?'),
                answers: [
                    { id: 0, text: wt('welcome.demo_q4_a1', 'Частота') },
                    { id: 1, text: wt('welcome.demo_q4_a2', 'Длина волны') },
                    { id: 2, text: wt('welcome.demo_q4_a3', 'Фаза') },
                ],
            },
            {
                id: 'wave_q5',
                text: wt('welcome.demo_q5_text', 'В какой среде электромагнитная волна может распространяться без вещества?'),
                answers: [
                    { id: 0, text: wt('welcome.demo_q5_a1', 'В вакууме') },
                    { id: 1, text: wt('welcome.demo_q5_a2', 'Только в воде') },
                    { id: 2, text: wt('welcome.demo_q5_a3', 'Только в твёрдом теле') },
                ],
            },
            {
                id: 'wave_q6',
                text: wt('welcome.demo_q6_text', 'Как связаны скорость, длина волны и частота?'),
                answers: [
                    { id: 0, text: wt('welcome.demo_q6_a1', 'Скорость равна произведению длины волны на частоту') },
                    { id: 1, text: wt('welcome.demo_q6_a2', 'Скорость равна сумме длины волны и частоты') },
                    { id: 2, text: wt('welcome.demo_q6_a3', 'Связи между ними нет') },
                ],
            },
            {
                id: 'wave_q7',
                text: wt('welcome.demo_q7_text', 'Что переносит электромагнитная волна?'),
                answers: [
                    { id: 0, text: wt('welcome.demo_q7_a1', 'Энергию') },
                    { id: 1, text: wt('welcome.demo_q7_a2', 'Только массу вещества') },
                    { id: 2, text: wt('welcome.demo_q7_a3', 'Только электрический заряд') },
                ],
            },
        ];

        const testTitle = wt('welcome.demo_test_title', 'Тест: параметры волны');

        return {
            metadata: {
                id: 'welcome-practice-testui-preview',
                name: testTitle,
                type: 'test',
            },
            task_data: {
                id: 'welcome-practice-testui-preview',
                type: 'test',
                name: testTitle,
                difficulty: 1,
                content: {
                    test_type: 'single_choice',
                    questions,
                    show_options: true,
                },
                meta: {
                    id: 'welcome-practice-testui-preview',
                    module: 'onboarding-preview',
                    topic: 'radiophysics',
                    title: testTitle,
                },
            },
        };
    }

    function serializePreviewData(value) {
        return JSON.stringify(value).replace(/</g, '\\u003c');
    }

    function buildWelcomePracticePreviewDoc() {
        const task = serializePreviewData(createWelcomePracticeDemoTask());
        const draft = serializePreviewData({
            answers: {
                wave_q1: 0,
                wave_q2: 2,
                wave_q3: 1,
            },
        });
        const viewState = serializePreviewData({
            current_index: 2,
            visited_indices: [0, 1, 2],
            sidebar_scroll_top: 0,
        });

        return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1200, initial-scale=1">
  <link href="/assets/fonts.css" rel="stylesheet">
  <link href="/assets/tailwind.css" rel="stylesheet">
  <link href="/assets/lightB-variables.css" rel="stylesheet">
  <link href="/assets/lightB-components.css" rel="stylesheet">
  <style>
    html, body { width: 1200px; height: 675px; margin: 0; overflow: hidden; }
    body { background: var(--color-bg-secondary); color: var(--color-text-main); }
    .preview-shell { height: 100%; padding: 24px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; }
    .preview-toolbar { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(18rem, .95fr) auto; gap: 14px; align-items: center; border: 1px solid var(--color-border-strong); border-radius: 18px; background: var(--color-surface-1); padding: 14px; box-shadow: var(--shadow-sm); }
    .preview-title { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .preview-title h1 { margin: 0; overflow: hidden; color: var(--color-text-main); font-size: 21px; font-weight: 800; line-height: 1.18; text-overflow: ellipsis; white-space: nowrap; }
    .preview-title p { margin: 3px 0 0; color: var(--color-text-secondary); font-size: 12px; font-weight: 700; }
    .preview-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; border: 1px solid var(--color-border-strong); border-radius: 12px; background: var(--color-surface-2); color: var(--color-text-main); padding: 0 14px; font-size: 13px; font-weight: 800; }
    .preview-btn--primary { border-color: var(--color-primary); background: var(--color-primary); color: var(--color-primary-fg); }
    .preview-progress { display: grid; gap: 6px; border: 1px solid var(--color-border-strong); border-radius: 14px; background: var(--color-surface-2); padding: 9px 12px; }
    .preview-progress div:first-child { display: flex; justify-content: space-between; color: var(--color-text-secondary); font-size: 12px; font-weight: 800; }
    .preview-track { height: 8px; overflow: hidden; border-radius: 999px; background: var(--color-border-subtle); }
    .preview-track span { display: block; width: 43%; height: 100%; border-radius: inherit; background: var(--color-primary); }
    .preview-actions { display: flex; justify-content: flex-end; gap: 8px; }
    #task-content { min-height: 0; flex: 1; }
    #task-content > .grid { height: 100%; }
  </style>
</head>
<body class="font-display antialiased">
  <div class="preview-shell">
    <header class="preview-toolbar">
      <div class="preview-title">
        <span class="preview-btn preview-btn--primary">${wt('welcome.demo_back', '← К списку')}</span>
        <div>
          <h1>${wt('welcome.demo_test_title', 'Тест: параметры волны')}</h1>
          <p>${wt('welcome.demo_practice_sub', 'Практика · радиофизика')}</p>
        </div>
      </div>
      <div class="preview-progress">
        <div><span>${wt('welcome.demo_task_progress', 'Задание 3 из 7')}</span><span>${wt('welcome.demo_iteration_1', 'Итерация 1')}</span></div>
        <div class="preview-track"><span></span></div>
      </div>
      <div class="preview-actions">
        <span class="preview-btn preview-btn--primary">${wt('welcome.demo_check', 'Проверить')}</span>
        <span class="preview-btn">${wt('welcome.demo_finish', 'Завершить комплекс')}</span>
      </div>
    </header>
    <main id="task-content"></main>
  </div>
  <script>
    window.i18n = window.parent.i18n;
    window.wt = window.parent.wt;
  </script>
  <script src="/TestUI/TestUI.web.js?v=20260402-reviewfix1"><\/script>
  <script src="/TestUI/TestUI.question.js?v=20260402-reviewfix1"><\/script>
  <script src="/TestUI/TestUI.sidebar.js"><\/script>
  <script>
    const task = ${task};
    const draft = ${draft};
    const viewState = ${viewState};
    const mount = document.getElementById('task-content');
    if (mount && typeof TestUI !== 'undefined' && TestUI.render) {
      TestUI.render(mount, task);
      TestUI.restoreInput?.(draft);
      TestUI.restoreViewState?.(viewState);
    }
  <\/script>
</body>
</html>`;
    }

    function buildWelcomeResultPreviewDoc() {
        const resultData = serializePreviewData({
            session_id: '',
            complex_name: wt('welcome.demo_test_title', 'Тест: параметры волны'),
            iteration: 1,
            total_tasks: 9,
            successful_tasks: 7,
            failed_tasks: 2,
            has_next_iteration: true,
            duration_seconds: 270,
            difficulty: 2,
            iteration_results: [
                { id: 'q1', task_name: wt('welcome.demo_q1_a1', 'Длина волны'), success: true, difficulty: 2 },
                { id: 'q2', task_name: wt('welcome.demo_q2_title', 'Свойства электромагнитных волн'), success: true, difficulty: 2 },
                {
                    id: 'q3',
                    task_name: wt('welcome.demo_q3_title', 'Связь периода и частоты'),
                    prompt: wt('welcome.demo_q3_text', 'Что происходит с частотой волны, если период колебаний уменьшается?'),
                    success: false,
                    difficulty: 2,
                    user_answer: wt('welcome.demo_q3_a1', 'Частота уменьшается'),
                    correct_answer: wt('welcome.demo_q3_a2', 'Частота увеличивается'),
                    result_note: wt('welcome.demo_q3_note', 'Частота обратно пропорциональна периоду: чем меньше период, тем больше частота.'),
                },
                { id: 'q4', task_name: wt('welcome.demo_q4_a1', 'Частота колебаний'), success: true, difficulty: 2 },
                { id: 'q5', task_name: wt('welcome.demo_q5_title', 'Распространение в вакууме'), success: true, difficulty: 2 },
                { id: 'q5b', task_name: wt('welcome.demo_q1_a2', 'Амплитуда сигнала'), success: true, difficulty: 2 },
                {
                    id: 'q6',
                    task_name: wt('welcome.demo_q6_title', 'Скорость волны'),
                    prompt: wt('welcome.demo_q6_text', 'Как связаны скорость, длина волны и частота?'),
                    success: false,
                    difficulty: 2,
                    user_answer: wt('welcome.demo_q6_a2', 'Скорость равна сумме длины волны и частоты'),
                    correct_answer: wt('welcome.demo_q6_a1', 'Скорость равна произведению длины волны на частоту'),
                    result_note: wt('welcome.demo_q6_note', 'Используйте формулу v = λν.'),
                },
                { id: 'q7', task_name: wt('welcome.demo_q7_a1', 'Перенос энергии'), success: true, difficulty: 2 },
                { id: 'q8', task_name: wt('welcome.demo_q8_title', 'Энергия электромагнитной волны'), success: true, difficulty: 2 },
            ],
        });

        return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1200, initial-scale=1">
  <link href="/assets/tailwind.css" rel="stylesheet">
  <link href="/assets/fonts.css" rel="stylesheet">
  <link href="/assets/lightB-variables.css" rel="stylesheet">
  <link href="/assets/lightB-components.css" rel="stylesheet">
  <link href="/assets/s2-results.css" rel="stylesheet">
  <style>html,body{width:1200px;height:675px;margin:0;overflow:hidden}.s2-root{height:100vh}.s2-page-shell{min-height:100vh;padding:24px}.s2-main-stage{min-height:0}.s2-main{gap:16px}</style>
</head>
<body class="font-display bg-bg-main text-text-main antialiased">
  <div class="s2-root">
    <div class="s2-page-shell">
      <header class="s2-toolbar">
        <div class="s2-toolbar-main">
          <div class="s2-toolbar-title">
            <p class="s2-toolbar-context"><span id="complex-name">${wt('welcome.demo_complex_label', 'Комплекс')}</span><span class="s2-toolbar-separator">·</span><span>${wt('welcome.demo_iteration_label', 'Итерация')} <span id="iteration-number-label">?</span></span></p>
          </div>
        </div>
        <div class="s2-toolbar-actions">
          <button id="pause-btn-inline" class="s2-btn s2-ghost-btn s2-toolbar-action-btn" type="button">${wt('welcome.demo_pause', 'Пауза')}</button>
          <button id="finish-complex-btn-inline" class="s2-btn s2-danger-btn s2-toolbar-action-btn" type="button">${wt('welcome.demo_finish', 'Завершить комплекс')}</button>
          <div id="toolbar-menu-wrap" class="s2-menu-wrap">
            <button id="toolbar-menu-btn" class="s2-btn s2-menu-btn" type="button" aria-label="${wt('welcome.demo_more_actions', 'Дополнительные действия')}"><span class="material-symbols-outlined" aria-hidden="true">more_horiz</span></button>
            <div id="toolbar-menu-panel" class="s2-menu-panel hidden" role="menu" aria-hidden="true">
              <button id="pause-btn" class="s2-menu-item" type="button" role="menuitem">${wt('welcome.demo_put_on_pause', 'Поставить на паузу')}</button>
              <button id="finish-complex-btn" class="s2-menu-item s2-menu-item--danger" type="button" role="menuitem">${wt('welcome.demo_finish', 'Завершить комплекс')}</button>
            </div>
          </div>
        </div>
      </header>
      <div class="s2-main-stage">
        <main id="s2-main" class="s2-main">
          <section class="s2-panel s2-result-panel" aria-labelledby="result-heading">
            <div class="s2-result-head"><div class="s2-result-copy"><p class="s2-eyebrow">${wt('welcome.demo_result', 'Результат')}</p><div class="s2-hero-line"><div class="s2-score-stack"><h1 id="result-heading" class="s2-score-line"><span id="stat-success-rate">—</span></h1></div></div><p id="hero-summary" class="s2-hero-summary">${wt('welcome.demo_summary_loading', 'Короткая сводка появится сразу после загрузки.')}</p></div></div>
            <div class="s2-result-footer">
              <div class="s2-progress-block"><div class="s2-progress-track" aria-hidden="true"><div id="progress-success-bar" class="s2-progress-bar s2-progress-bar--success"></div><div id="progress-failed-bar" class="s2-progress-bar s2-progress-bar--error"></div></div><div class="s2-progress-counts"><span class="s2-count-chip s2-count-chip--success"><strong id="hero-success-count">—</strong> ${wt('welcome.demo_correct_count', 'верно')}</span><span id="hero-failed-chip" class="s2-count-chip s2-count-chip--error"><strong id="hero-failed-count">—</strong> ${wt('welcome.demo_errors_count', 'ошибок')}</span></div></div>
              <div class="s2-meta-strip" aria-label="${wt('welcome.demo_iteration_context_aria', 'Контекст итерации')}"><span class="s2-meta-inline"><span class="s2-meta-pill-label">${wt('welcome.demo_tasks_label', 'Задачи')}</span><strong id="stat-total-tasks">—</strong></span><span class="s2-meta-inline"><span class="s2-meta-pill-label">${wt('welcome.demo_difficulty_label', 'Сложность')}</span><strong id="stat-difficulty">—</strong></span><span class="s2-meta-inline"><span class="s2-meta-pill-label">${wt('welcome.demo_time_label', 'Время')}</span><strong id="stat-iteration-time">—</strong></span></div>
            </div>
          </section>
          <section class="s2-panel s2-action-panel"><article id="continue-btn" class="s2-action-card s2-action-card--next" role="button" tabindex="0"><p class="s2-eyebrow">${wt('welcome.demo_next_step', 'Следующий шаг')}</p><h2 id="recommendation-title" class="s2-action-title">—</h2><p id="recommendation-copy" class="s2-action-copy">—</p><div class="s2-next-cta" aria-hidden="true"><span id="continue-btn-label" class="truncate s2-next-cta-text">${wt('welcome.demo_to_next_iteration', 'К следующей итерации')}</span></div></article></section>
          <section id="result-review-panel" class="s2-result-review hidden" aria-hidden="true"><div class="s2-result-review-head"><div class="s2-result-review-copy"><p class="s2-eyebrow">${wt('welcome.demo_error_review', 'Разбор ошибок')}</p><h2 id="result-review-title" class="s2-review-panel-title">—</h2><p id="result-review-copy" class="s2-action-copy">—</p></div><button id="review-btn" class="s2-btn s2-secondary-btn hidden" type="button">${wt('welcome.demo_show_review', 'Показать разбор')}</button></div><div id="review-inline" class="s2-inline-review hidden" aria-hidden="true"></div></section>
          <div hidden aria-hidden="true"><strong id="stat-total-tasks-main">—</strong><strong id="stat-failed-tasks">—</strong><div id="trigger-tasks-list"></div></div>
        </main>
      </div>
    </div>
  </div>
  <div id="details-dialog-backdrop" class="s2-dialog-backdrop hidden" aria-hidden="true"><div class="s2-dialog-panel"><div class="s2-dialog-header"><div><p class="s2-eyebrow">${wt('welcome.demo_details', 'Детали')}</p><h2 id="details-dialog-title" class="s2-dialog-title">${wt('welcome.demo_iteration_details', 'Детали итерации')}</h2><p id="details-dialog-subtitle" class="s2-dialog-subtitle">—</p></div><button id="details-dialog-close-btn" class="s2-btn s2-ghost-btn" type="button">${wt('welcome.demo_close', 'Закрыть')}</button></div><div class="s2-dialog-body"><div class="s2-dialog-metrics"><div class="s2-dialog-metric"><span class="s2-meta-pill-label">${wt('welcome.demo_accuracy_label', 'Точность')}</span><strong id="details-rate">—</strong></div><div class="s2-dialog-metric"><span class="s2-meta-pill-label">${wt('welcome.demo_correct_label', 'Верно')}</span><strong id="details-success">—</strong></div><div class="s2-dialog-metric"><span class="s2-meta-pill-label">${wt('welcome.demo_errors_label', 'Ошибки')}</span><strong id="details-failed">—</strong></div><div class="s2-dialog-metric"><span class="s2-meta-pill-label">${wt('welcome.demo_time_label', 'Время')}</span><strong id="details-time">—</strong></div></div><div class="s2-dialog-progress-track"><div id="details-success-bar" class="s2-progress-bar s2-progress-bar--success"></div><div id="details-failed-bar" class="s2-progress-bar s2-progress-bar--error"></div></div><div id="details-errors" class="s2-dialog-list"></div></div></div></div>
  <script>
    window.i18n = window.parent.i18n;
    window.wt = window.parent.wt;
  </script>
  <script src="/assets/s2-results.js?v=20260511-copy1"><\/script>
  <script>
    if (window.S2Page && typeof window.S2Page.renderIterationResults === 'function') {
      window.S2Page.renderIterationResults(${resultData});
    }
  <\/script>
</body>
</html>`;
    }

    function setupWelcomePreviewStages() {
        const updateStage = (stage) => {
            const canvas = stage.querySelector('[data-welcome-preview-canvas]');
            if (!canvas) return;
            const scale = Math.max(0.1, stage.clientWidth / 1200);
            canvas.style.setProperty('--welcome-preview-scale', scale.toFixed(5));
        };

        const stages = Array.from(document.querySelectorAll('[data-welcome-preview-stage]'));
        stages.forEach(updateStage);
        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver((entries) => {
                entries.forEach((entry) => updateStage(entry.target));
            });
            stages.forEach((stage) => observer.observe(stage));
        } else {
            window.addEventListener('resize', () => stages.forEach(updateStage));
        }
    }

    function setupWelcomePreviewFrames() {
        const practiceFrame = document.getElementById('welcomePracticePreviewFrame');
        if (practiceFrame && !practiceFrame.srcdoc) {
            practiceFrame.srcdoc = buildWelcomePracticePreviewDoc();
        }

        const resultFrame = document.getElementById('welcomeResultPreviewFrame');
        if (resultFrame && !resultFrame.srcdoc) {
            resultFrame.srcdoc = buildWelcomeResultPreviewDoc();
        }
    }

    // --- Initialize ---
    async function init() {
        if (initStarted) return;
        initStarted = true;
        markDecorativeMaterialIcons();
        setupWelcomePreviewFrames();
        setupWelcomePreviewStages();
        setupWelcomeSurfaceCarousel();
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
                showStartupLoadError(wt('welcome.startup_profiles_failed', 'Не удалось получить список профилей и стартовый режим.'));
                return;
            }

            const requestedWelcomeView = getRequestedWelcomeView();
            hostedAuthFlow = data.mode === 'auth' || data.mode === 'authenticated' || !!verifyEmailToken || !!resetPasswordToken;
            if (requestedWelcomeView && ['auth', 'authenticated'].includes(data.mode)) {
                hostedAuthFlow = true;
            }
            setAuthProviders(data.auth_providers);

            if (verifyEmailToken) {
                removeSearchParam('verify_email_token');
                openWelcomeAuthLayer();
                showMode('onboarding');
                configureHostedRegistrationMode();
                await submitWelcomeEmailVerificationToken(verifyEmailToken);
                return;
            }

            if (resetPasswordToken) {
                removeSearchParam('reset_password_token');
                openWelcomeAuthLayer();
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
                        showStartupLoadError(wt('welcome.startup_profile_missing', 'Не удалось определить активный профиль для входа.'));
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
                    if (requestedWelcomeView === 'register') {
                        window.welcomeShowAuthRegister();
                    } else if (requestedWelcomeView === 'login') {
                        window.welcomeShowAuthLogin();
                    } else {
                        showMode('select');
                        setHostedAuthChoiceVisible(true);
                    }
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
                    if (requestedWelcomeView === 'register') {
                        setTimeout(openDesktopCreateProfileForm, 0);
                    }
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
            _applyWelcomeI18n();
        } finally {
            finalizeOverlay();
        }
    }

    function _applyWelcomeI18n() {
        if (currentMode) updateWelcomeHeader(currentMode);
        if (currentMode === 'onboarding') {
            if (isHostedAuthMode()) {
                const btn = document.getElementById('onboardingCreateBtn');
                if (btn) btn.innerHTML = `${wt('welcome.btn_create_account', 'Создать аккаунт')} <span class="material-symbols-outlined">person_add</span>`;
                const nameIn = document.getElementById('onboardingName');
                if (nameIn) nameIn.placeholder = wt('welcome.placeholder_name_hosted', 'Отображаемое имя');
            } else {
                const btn = document.getElementById('onboardingCreateBtn');
                if (btn) btn.innerHTML = `${wt('welcome.btn_start_learning', 'Начать обучение')} <span class="material-symbols-outlined">arrow_forward</span>`;
                const nameIn = document.getElementById('onboardingName');
                if (nameIn) nameIn.placeholder = wt('welcome.placeholder_name_desktop', 'Ваше имя');
            }
        } else if (currentMode === 'login') {
            const submitBtn = document.getElementById('loginSubmitBtn');
            if (submitBtn) {
                const isHosted = isHostedAuthMode();
                submitBtn.innerHTML = isHosted
                    ? `${wt('welcome.btn_login', 'Войти')} <span class="material-symbols-outlined">login</span>`
                    : `${wt('welcome.btn_login_system', 'Войти в систему')} <span class="material-symbols-outlined">login</span>`;
            }
            const pwdIn = document.getElementById('loginPassword');
            if (pwdIn && isHostedAuthMode()) pwdIn.placeholder = wt('welcome.placeholder_password', 'Пароль');
        } else if (currentMode === 'select') {
            renderProfilesList();
        }
        if (hostedVerificationState) applyHostedVerificationState();

        // Rebuild/refresh onboarding preview iframes with updated localization
        const practiceFrame = document.getElementById('welcomePracticePreviewFrame');
        if (practiceFrame) {
            practiceFrame.srcdoc = buildWelcomePracticePreviewDoc();
        }
        const resultFrame = document.getElementById('welcomeResultPreviewFrame');
        if (resultFrame) {
            resultFrame.srcdoc = buildWelcomeResultPreviewDoc();
        }

        if (window.i18n) window.i18n.updateDOM();
    }

    window.addEventListener('i18n:changed', _applyWelcomeI18n);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
