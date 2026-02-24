(function () {
    'use strict';

    let currentMode = null;       // 'onboarding' | 'select' | 'login'
    let profiles = [];
    let pendingPasswordUserId = null;
    let legalDocuments = null;
    let consentGateResolver = null;
    let consentGateUserId = null;

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

    // --- Avatar helpers ---
    function getAvatarUrl(avatarSeed) {
        if (!avatarSeed) avatarSeed = '1.png';
        if (avatarSeed.includes('.')) {
            return `/api/assets/avatars/${encodeURIComponent(avatarSeed)}?trim=1&size=256`;
        }
        return '/api/assets/avatars/1.png?trim=1&size=256';
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
            return `
            <button class="avatar-option group relative rounded-full w-14 h-14 overflow-hidden focus:outline-none transition-all duration-200 ${selected
                    ? 'ring-2 ring-primary opacity-100'
                    : 'opacity-75 hover:opacity-100'
                }"
                 onclick="window._welcomeSelectAvatar('${file}', '${seedInputId}', '${previewId}', '${containerId}')"
                 data-filename="${file}">
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

    // --- Mode switching ---
    function showMode(mode) {
        currentMode = mode;
        document.getElementById('modeOnboarding').classList.toggle('hidden', mode !== 'onboarding');
        document.getElementById('modeSelect').classList.toggle('hidden', mode !== 'select');
        document.getElementById('modeLogin').classList.toggle('hidden', mode !== 'login');
        updateWelcomeHeader(mode);
    }

    function updateWelcomeHeader(mode) {
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
    }

    // --- Navigate to main ---
    function goToMain() {
        window.navigateWithTransition('/ui/main');
    }

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
        await apiFetch('/api/users/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });

        return true;
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
                    <button onclick="window.welcomeCancelCreate()" class="absolute top-4 right-4 text-text-muted hover:text-error transition-colors">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                    
                    <div class="flex flex-col items-center gap-6 mb-8">
                        <div class="relative group cursor-pointer flex-shrink-0">
                             <img id="selectAvatarPreview" src="/api/assets/avatars/1.png?trim=1&size=256" 
                                  class="w-20 h-20 rounded-full object-cover avatar-fill ring-4 ring-primary ring-offset-4 ring-offset-surface-1 shadow-md">
                        </div>
                        <input type="text" id="selectNewName" placeholder="Имя профиля..."
                            class="welcome-name-input w-full text-center bg-transparent border-b-2 border-border-subtle focus:border-primary px-2 py-2 text-xl font-bold text-text-main outline-none transition-colors placeholder:text-text-main"
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
            container.innerHTML = `
                <img src="${getAvatarUrl(profile.avatar_seed)}" class="w-12 h-12 rounded-full bg-surface-2 object-cover avatar-fill ring-2 ring-primary/30 shadow-sm">
                <div class="flex flex-col">
                    <span class="font-black text-text-main text-lg leading-tight tracking-tight">${profile.name}</span>
                    <span class="text-[10px] text-text-muted font-bold uppercase tracking-wider mt-0.5">Вход по паролю</span>
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

        const { ok } = await apiFetch('/api/users/verify-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: pendingPasswordUserId, password })
        });

        if (ok) {
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
        const password = document.getElementById('loginPassword').value;
        if (!password) {
            showError('loginError', 'Введите пароль');
            return;
        }

        const userId = profiles[0].user_id;
        const { ok } = await apiFetch('/api/users/verify-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, password })
        });

        if (ok) {
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

            const lockBadges = hasLock
                ? `<div class="absolute top-2 right-2 bg-text-main/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border border-white/10 z-10 transition-transform group-hover:scale-110">
                       <span class="material-symbols-outlined text-white text-[14px] block">lock</span>
                   </div>`
                : '';

            // V3 Profile Card Structure
            return `
            <button class="profile-card-v3 group flex flex-col items-center p-8 rounded-3xl text-center flex-shrink-0 cursor-pointer outline-none focus:ring-4 focus:ring-primary/20 relative overflow-hidden"
                 onclick="window.welcomeSelectProfile('${user.user_id}')">
                
                <!-- Hover background effect -->
                <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

                <div class="relative mb-5 transition-transform group-hover:scale-105 duration-300 transform-gpu">
                    <img src="${getAvatarUrl(user.avatar_seed)}" class="w-24 h-24 rounded-full object-cover avatar-fill shadow-lg ring-4 ring-surface-0 group-hover:ring-primary/40 transition-shadow" alt="${user.name}">
                    ${lockBadges}
                </div>
                
                <div class="w-full relative z-10">
                    <p class="text-xl font-bold text-text-main group-hover:text-primary transition-colors truncate w-full mb-1 tracking-tight">${user.name}</p>
                    <p class="text-[11px] uppercase tracking-widest font-bold text-text-muted opacity-60 group-hover:opacity-100 group-hover:text-primary transition-all duration-300 transform translate-y-1 group-hover:translate-y-0">
                        ${hasLock ? 'Требуется пароль' : 'Нажмите для входа'}
                    </p>
                </div>
            </button>`;
        }).join('');

        const addCardHtml = `
            <button class="profile-card-v3 profile-card-new group flex flex-col items-center justify-center p-8 rounded-3xl text-center flex-shrink-0 cursor-pointer outline-none focus:ring-4 focus:ring-primary/20"
                 onclick="window.welcomeToggleCreate()">
                <div class="w-24 h-24 rounded-full flex items-center justify-center bg-surface-2 mb-5 group-hover:scale-110 group-hover:bg-primary group-hover:text-white transition-all duration-300 shadow-inner group-hover:shadow-lg ring-4 ring-transparent group-hover:ring-primary/20">
                    <span class="material-symbols-outlined text-text-muted text-4xl group-hover:text-white transition-colors">add</span>
                </div>
                <div class="w-full">
                     <p class="text-lg font-bold text-text-muted group-hover:text-primary transition-colors tracking-tight">Новый профиль</p>
                </div>
            </button>`;

        container.innerHTML = cardsHtml + addCardHtml;
    }

    // --- Initialize ---
    async function init() {
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
                goToMain();
                return;
            }

            if (!data.show_welcome) {
                let selectedUserId = null;
                if (data.auto_select_user_id) {
                    const selected = await selectUser(data.auto_select_user_id);
                    if (selected) selectedUserId = data.auto_select_user_id;
                }

                if (!selectedUserId) {
                    const currentResp = await apiFetch('/api/users/current');
                    if (currentResp.ok && currentResp.data?.user?.user_id) {
                        selectedUserId = currentResp.data.user.user_id;
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
                case 'onboarding':
                    showMode('onboarding');
                    loadAvatarGallery('onboardingAvatarGallery', 'onboardingAvatarSeed', 'onboardingAvatarPreview');
                    setTimeout(() => document.getElementById('onboardingName').focus(), 400);
                    break;

                case 'select':
                    showMode('select');
                    renderProfilesList();
                    break;

                case 'login':
                    showMode('login');
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
