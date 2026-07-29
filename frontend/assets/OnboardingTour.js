(function () {
    'use strict';

    function wt(key, fallback) {
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const result = window.i18n.t(key);
            return result !== key ? result : fallback;
        }
        return fallback;
    }

    function rt(val, tourId, stepId, suffix) {
        if (!val || !tourId || !stepId) return val || '';
        const tId = tourId.replace(/-/g, '_');
        const cleanSuffix = suffix ? suffix.replace(/\./g, '_') : '';
        let key;
        if (stepId === 'tour') {
            key = 'tours.' + tId + '.' + cleanSuffix;
        } else {
            const sId = stepId.replace(/-/g, '_');
            key = 'tours.' + tId + '.' + sId + (cleanSuffix ? '.' + cleanSuffix : '');
        }
        return wt(key, val);
    }

    const LOCAL_SEEN_KEY = 'actra_onboarding_seen_v1';
    const LOCAL_DISABLED_KEY = 'actra_onboarding_disabled_v1';
    const LOCAL_FIRST_RUN_PROMPT_KEY = 'actra_onboarding_first_run_prompt_v1';
    const SETTINGS_ENDPOINT = '/api/ui/settings';
    const FIRST_RUN_TOUR_ID = 'main-dashboard-work-contour';
    const TARGET_WAIT_MS = 4000;
    const TARGET_POLL_MS = 120;
    const STEP_PREPARATION_WAIT_MS = 6000;
    const TRANSITION_MS = 220;

    let activeTour = null;
    let activeStepIndex = 0;
    let activePreviewMode = false;
    let activeReferencePreviewMode = false;
    let scrim = null;
    let tooltip = null;
    let calloutStack = null;
    let controlEl = null;
    let targetNodes = [];
    let cloneEls = [];
    let scrimPieces = [];
    let calloutEls = [];
    let beaconEls = [];
    let remoteSettings = null;
    let remoteSettingsLoaded = false;
    let remoteSettingsAvailable = false;
    let remoteSettingsPromise = null;
    let isInitialized = false;
    let transitionToken = 0;
    let scrollLockState = null;
    let activeStepVariant = '';

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    function normalizePath(pathname) {
        const raw = String(pathname || window.location.pathname || '').replace(/\/+$/, '');
        return raw || '/';
    }

    function readLocalSeen() {
        try {
            const parsed = JSON.parse(localStorage.getItem(LOCAL_SEEN_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function writeLocalSeen(seen) {
        try {
            localStorage.setItem(LOCAL_SEEN_KEY, JSON.stringify(seen || {}));
        } catch (_) {
            // localStorage can be unavailable in hardened browser contexts.
        }
    }

    function readLocalFlag(key) {
        try {
            return localStorage.getItem(key) === 'true';
        } catch (_) {
            return false;
        }
    }

    function writeLocalFlag(key, value) {
        try {
            localStorage.setItem(key, value ? 'true' : 'false');
        } catch (_) {
            // localStorage can be unavailable in hardened browser contexts.
        }
    }

    async function loadRemoteSettings() {
        if (remoteSettingsLoaded) return remoteSettings || {};
        if (remoteSettingsPromise) return remoteSettingsPromise;

        remoteSettingsPromise = (async () => {
            remoteSettingsLoaded = true;

            try {
                const response = await fetch(SETTINGS_ENDPOINT);
                const data = await response.json();
                remoteSettingsAvailable = Boolean(data && data.ok && data.settings && typeof data.settings === 'object');
                remoteSettings = remoteSettingsAvailable ? data.settings : {};
            } catch (_) {
                remoteSettingsAvailable = false;
                remoteSettings = {};
            } finally {
                remoteSettingsPromise = null;
            }

            return remoteSettings;
        })();

        return remoteSettingsPromise;
    }

    async function getSeenState() {
        const settings = await loadRemoteSettings();
        const remoteSeen = settings?.onboarding?.seen && typeof settings.onboarding.seen === 'object'
            ? settings.onboarding.seen
            : {};
        if (remoteSettingsAvailable) {
            return { ...remoteSeen };
        }
        return { ...readLocalSeen(), ...remoteSeen };
    }

    function isOnboardingDisabled(settings = remoteSettings || {}) {
        const remoteDisabled = settings?.onboarding?.disabled === true;
        return remoteSettingsAvailable ? remoteDisabled : (remoteDisabled || readLocalFlag(LOCAL_DISABLED_KEY));
    }

    async function isTourSeen(tour) {
        if (!tour) return true;
        const settings = await loadRemoteSettings();
        if (isOnboardingDisabled(settings)) return true;
        const seen = await getSeenState();
        return Number(seen[tour.tourId]) >= Number(tour.version || 1);
    }

    function getCurrentOnboardingSettings(settings = remoteSettings || {}) {
        return settings.onboarding && typeof settings.onboarding === 'object'
            ? { ...settings.onboarding }
            : {};
    }

    async function persistOnboardingSettings(onboarding) {
        const settings = await loadRemoteSettings();
        const nextOnboarding = {
            ...getCurrentOnboardingSettings(settings),
            ...(onboarding && typeof onboarding === 'object' ? onboarding : {}),
        };
        remoteSettings = { ...settings, onboarding: nextOnboarding };

        try {
            await fetch(SETTINGS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { onboarding: nextOnboarding } }),
            });
        } catch (_) {
            // Local fallback has already been updated by callers where needed.
        }
    }

    async function markTourSeen(tour) {
        if (!tour?.tourId) return;

        const localSeen = readLocalSeen();
        localSeen[tour.tourId] = tour.version || 1;
        writeLocalSeen(localSeen);

        try {
            const settings = await loadRemoteSettings();
            const onboarding = getCurrentOnboardingSettings(settings);
            onboarding.seen = {
                ...(onboarding.seen && typeof onboarding.seen === 'object' ? onboarding.seen : {}),
                [tour.tourId]: tour.version || 1,
            };
            await persistOnboardingSettings(onboarding);
        } catch (_) {
            // Local fallback already persisted the state.
        }
    }

    async function markFirstRunPromptSeen() {
        writeLocalFlag(LOCAL_FIRST_RUN_PROMPT_KEY, true);
        try {
            await persistOnboardingSettings({ firstRunPromptSeen: true });
        } catch (_) {
            // Local fallback already persisted the prompt state.
        }
    }

    async function disableAllOnboarding() {
        writeLocalFlag(LOCAL_DISABLED_KEY, true);
        writeLocalFlag(LOCAL_FIRST_RUN_PROMPT_KEY, true);

        const localSeen = readLocalSeen();
        getTours().forEach((tour) => {
            if (tour?.tourId) localSeen[tour.tourId] = tour.version || 1;
        });
        writeLocalSeen(localSeen);

        const settings = await loadRemoteSettings();
        const onboarding = getCurrentOnboardingSettings(settings);
        const seen = onboarding.seen && typeof onboarding.seen === 'object'
            ? { ...onboarding.seen }
            : {};
        getTours().forEach((tour) => {
            if (tour?.tourId) seen[tour.tourId] = tour.version || 1;
        });
        await persistOnboardingSettings({
            ...onboarding,
            disabled: true,
            firstRunPromptSeen: true,
            seen,
        });
    }

    function getTours() {
        return Array.isArray(window.ACTRA_ONBOARDING_TOURS)
            ? window.ACTRA_ONBOARDING_TOURS
            : [];
    }

    function findTourForRoute(pathname) {
        const route = normalizePath(pathname);
        return getTours().find((tour) => {
            const routes = Array.isArray(tour.route) ? tour.route : [tour.route];
            return tour.autoStart !== false && routes.some((candidate) => normalizePath(candidate) === route);
        }) || null;
    }

    function findTourById(tourId) {
        const normalized = String(tourId || '').trim();
        if (!normalized) return null;
        return getTours().find((tour) => tour.tourId === normalized) || null;
    }

    function findHelpTourForRoute(pathname) {
        const route = normalizePath(pathname);
        return getTours().find((tour) => {
            const routes = Array.isArray(tour.route) ? tour.route : [tour.route];
            return tour.autoStart !== false && routes.some((candidate) => normalizePath(candidate) === route);
        }) || null;
    }

    function getOnboardingHelpConfig() {
        return window.ACTRA_ONBOARDING_HELP && typeof window.ACTRA_ONBOARDING_HELP === 'object'
            ? window.ACTRA_ONBOARDING_HELP
            : {};
    }

    function resolveHelpTourId(button) {
        const config = getOnboardingHelpConfig();
        if (typeof config.getTourId === 'function') {
            const resolved = String(config.getTourId(button) || '').trim();
            if (resolved) return resolved;
        }
        const explicit = String(button?.dataset?.onboardingTourId || '').trim();
        if (explicit) return explicit;
        const fallback = String(button?.dataset?.onboardingFallbackTourId || '').trim();
        if (fallback) return fallback;
        return findHelpTourForRoute(window.location.pathname)?.tourId || '';
    }

    function resolveHelpMode(button) {
        const explicit = String(button?.dataset?.onboardingHelpMode || '').trim();
        if (explicit) return explicit;
        const configMode = String(getOnboardingHelpConfig().mode || '').trim();
        return configMode || 'direct';
    }

    function resolvePreviewUrl(tourId, button) {
        const config = getOnboardingHelpConfig();
        if (typeof config.getPreviewUrl === 'function') {
            const resolved = String(config.getPreviewUrl(tourId, button) || '').trim();
            if (resolved) return resolved;
        }
        const target = String(button?.dataset?.onboardingPreviewUrl || window.location.pathname || '').trim();
        const url = new URL(target || window.location.pathname, window.location.origin);
        url.search = '';
        url.hash = '';
        url.searchParams.set('onboarding_preview', tourId);
        url.searchParams.set('return_to', window.location.href);
        return url.href;
    }

    function resolveReturnToUrl() {
        try {
            const raw = new URLSearchParams(window.location.search || '').get('return_to') || '';
            if (!raw) return '';
            const url = new URL(raw, window.location.origin);
            if (url.origin !== window.location.origin) return '';
            return url.href;
        } catch (_) {
            return '';
        }
    }

    function isReferencePreviewRequest() {
        const params = new URLSearchParams(window.location.search || '');
        return params.get('reference_embed') === '1' || params.get('reference_preview') === '1';
    }

    function suppressReferenceBeforeUnloadPrompts() {
        if (!isReferencePreviewRequest() || window.__actraReferenceBeforeUnloadSuppressed) return;
        window.__actraReferenceBeforeUnloadSuppressed = true;

        try {
            window.onbeforeunload = null;
            Object.defineProperty(window, 'onbeforeunload', {
                configurable: true,
                get() {
                    return null;
                },
                set() {
                    return true;
                },
            });
        } catch (_) {
            window.onbeforeunload = null;
        }

        const originalAddEventListener = window.addEventListener.bind(window);
        originalAddEventListener('beforeunload', (event) => {
            event.stopImmediatePropagation();
            delete event.returnValue;
        }, true);

        window.addEventListener = function patchedAddEventListener(type, listener, options) {
            if (String(type).toLowerCase() === 'beforeunload') return undefined;
            return originalAddEventListener(type, listener, options);
        };
    }

    suppressReferenceBeforeUnloadPrompts();

    function getPreviewStepIndex() {
        const params = new URLSearchParams(window.location.search || '');
        const stateParam = String(params.get('onboarding_state') || '').trim();
        if (stateParam) {
            const stateNumber = Number(stateParam.replace(/[^\d.-]/g, ''));
            if (Number.isFinite(stateNumber)) return Math.max(0, Math.trunc(stateNumber) - 1);
        }

        const stepParam = String(params.get('onboarding_step') || '').trim();
        if (!stepParam) return 0;
        const stepNumber = Number(stepParam.replace(/[^\d.-]/g, ''));
        return Number.isFinite(stepNumber) ? Math.max(0, Math.trunc(stepNumber)) : 0;
    }

    function navigateTo(url) {
        if (!url) return;
        if (typeof window.navigateWithTransition === 'function') {
            try {
                const target = new URL(url, window.location.origin);
                window.navigateWithTransition(target.origin === window.location.origin
                    ? `${target.pathname}${target.search}${target.hash}`
                    : target.href);
            } catch (_) {
                window.navigateWithTransition(url);
            }
            return;
        }
        window.location.href = url;
    }

    function notifyReferencePreviewStep(tour, step) {
        if (!activeReferencePreviewMode || !window.parent || window.parent === window) return;
        try {
            window.parent.postMessage({
                type: 'actra:onboarding-step-ready',
                tourId: tour?.tourId || '',
                stepId: step?.id || '',
                stepIndex: activeStepIndex,
            }, window.location.origin);
        } catch (_) {
            // The reference page is same-origin; ignore if the frame is detached during navigation.
        }
    }

    function updateHelpButtons() {
        document.querySelectorAll('[data-onboarding-help-button]').forEach((button) => {
            const tourId = resolveHelpTourId(button);
            const hasTour = Boolean(findTourById(tourId));
            button.hidden = !hasTour;
            button.disabled = !hasTour;
            button.setAttribute('aria-disabled', hasTour ? 'false' : 'true');
            if (hasTour) {
                button.dataset.onboardingResolvedTourId = tourId;
            } else {
                delete button.dataset.onboardingResolvedTourId;
            }
        });
    }

    function isBlockingModalOpen() {
        const el = document.querySelector('.modal.open, .import-modal:not(.hidden), [role="dialog"]:not(.hidden)');
        if (!el) return false;
        return !el.closest('[hidden]');
    }

    function isFirstRunPromptSeen(settings = remoteSettings || {}) {
        const onboarding = settings?.onboarding && typeof settings.onboarding === 'object'
            ? settings.onboarding
            : {};
        return remoteSettingsAvailable
            ? onboarding.firstRunPromptSeen === true
            : (onboarding.firstRunPromptSeen === true || readLocalFlag(LOCAL_FIRST_RUN_PROMPT_KEY));
    }

    function shouldOfferFirstRunOnboardingChoice(tour, seen) {
        if (!tour || tour.tourId !== FIRST_RUN_TOUR_ID) return false;
        if (window.ACTRA_DISABLE_ONBOARDING_FIRST_RUN_PROMPT) return false;
        const settings = remoteSettings || {};
        if (isOnboardingDisabled(settings) || isFirstRunPromptSeen(settings)) return false;
        return Object.keys(seen || {}).length === 0;
    }

    function removeFirstRunChoiceModal() {
        document.querySelector('[data-onboarding-first-run-modal]')?.remove();
    }

    function showFirstRunChoiceModal(tour) {
        removeFirstRunChoiceModal();

        const modal = document.createElement('div');
        modal.className = 'onboarding-first-run-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'onboarding-first-run-title');
        modal.setAttribute('data-onboarding-first-run-modal', '');
        modal.innerHTML = `
            <section class="onboarding-first-run-card">
                <div class="onboarding-first-run-icon" aria-hidden="true">
                    <span class="material-symbols-outlined">tips_and_updates</span>
                </div>
                <div class="onboarding-first-run-copy">
                    <p class="onboarding-first-run-kicker">${wt('onboarding.first_run_kicker', 'Первый вход')}</p>
                    <h2 class="onboarding-first-run-title" id="onboarding-first-run-title">${wt('onboarding.first_run_title', 'Показать короткое обучение?')}</h2>
                    <p class="onboarding-first-run-body">${wt('onboarding.first_run_body', 'Подсказки будут появляться только при первом посещении страниц. Можно отключить их сразу для всего продукта.')}</p>
                </div>
                <div class="onboarding-first-run-actions">
                    <button type="button" class="onboarding-tour-button" data-onboarding-first-run-action="disable">
                        ${wt('onboarding.btn_disable', 'Убрать обучение')}
                    </button>
                    <button type="button" class="onboarding-tour-button onboarding-tour-button--primary" data-onboarding-first-run-action="start">
                        ${wt('onboarding.btn_start', 'Показать подсказки')}
                    </button>
                </div>
            </section>
        `;

        modal.addEventListener('click', (event) => {
            const action = event.target.closest('[data-onboarding-first-run-action]')?.getAttribute('data-onboarding-first-run-action');
            if (!action) return;
            event.preventDefault();
            event.stopPropagation();

            if (action === 'disable') {
                modal.querySelectorAll('button').forEach((button) => { button.disabled = true; });
                void disableAllOnboarding().finally(() => {
                    removeFirstRunChoiceModal();
                });
                return;
            }

            if (action === 'start') {
                modal.querySelectorAll('button').forEach((button) => { button.disabled = true; });
                void markFirstRunPromptSeen().finally(() => {
                    removeFirstRunChoiceModal();
                    void startTour(tour.tourId, { force: true });
                });
            }
        });

        document.body.appendChild(modal);
        window.setTimeout(() => {
            modal.querySelector('[data-onboarding-first-run-action="start"]')?.focus();
        }, 0);
        return modal;
    }

    function getSelectors(step) {
        if (
            activeStepVariant
            && step?.targetVariants
            && Array.isArray(step.targetVariants[activeStepVariant])
        ) {
            return step.targetVariants[activeStepVariant].filter(Boolean);
        }
        if (Array.isArray(step?.targets)) return step.targets.filter(Boolean);
        if (step?.target) return [step.target];
        return [];
    }

    function findStepTargets(step) {
        const nodes = [];
        getSelectors(step).forEach((selector) => {
            document.querySelectorAll(selector).forEach((node) => {
                if (!nodes.includes(node)) nodes.push(node);
            });
        });
        return nodes.filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
    }

    function waitForStepTargets(step) {
        const startedAt = Date.now();
        return new Promise((resolve) => {
            const tick = () => {
                const nodes = findStepTargets(step);
                if (nodes.length || Date.now() - startedAt >= TARGET_WAIT_MS) {
                    resolve(nodes);
                    return;
                }
                window.setTimeout(tick, TARGET_POLL_MS);
            };
            tick();
        });
    }

    function getStepReadySelectors(step) {
        if (!step) return [];
        if (Array.isArray(step.readySelectors)) {
            return step.readySelectors.filter(Boolean);
        }
        return step.readySelector ? [step.readySelector] : [];
    }

    function waitForStepReady(step) {
        const selectors = getStepReadySelectors(step);
        if (!selectors.length) return Promise.resolve(true);
        const startedAt = Date.now();
        return new Promise((resolve) => {
            const tick = () => {
                const ready = selectors.every((selector) => Boolean(document.querySelector(selector)));
                if (ready || Date.now() - startedAt >= TARGET_WAIT_MS) {
                    resolve(ready);
                    return;
                }
                window.requestAnimationFrame(tick);
            };
            tick();
        });
    }

    async function waitForStepPreparation(promises, step) {
        if (!Array.isArray(promises) || !promises.length) return;
        const timeoutMs = Number.isFinite(Number(step?.prepareTimeoutMs))
            ? Math.max(0, Number(step.prepareTimeoutMs))
            : STEP_PREPARATION_WAIT_MS;
        const settled = Promise.allSettled(promises).then((results) => {
            results.forEach((result) => {
                if (result.status === 'rejected') {
                    console.warn('[OnboardingTour] step preparation failed', result.reason);
                }
            });
        });
        if (timeoutMs <= 0) {
            await settled;
            return;
        }
        await Promise.race([
            settled,
            new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
        ]);
    }

    function prefersReducedMotion() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    }

    function waitForTransition() {
        if (prefersReducedMotion()) return Promise.resolve();
        return new Promise((resolve) => window.setTimeout(resolve, TRANSITION_MS));
    }

    function waitForLayoutFrame() {
        return new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
            });
        });
    }

    function getStepScrollBehavior(step) {
        return step?.scrollBehavior === 'smooth' && !prefersReducedMotion()
            ? 'smooth'
            : 'auto';
    }

    async function waitForStepScroll(behavior, step = null) {
        if (behavior !== 'smooth') {
            await waitForLayoutFrame();
            return;
        }
        const waitMs = Number.isFinite(Number(step?.scrollWaitMs))
            ? Math.max(0, Number(step.scrollWaitMs))
            : 420;
        await new Promise((resolve) => window.setTimeout(resolve, waitMs));
        await waitForLayoutFrame();
    }

    async function waitForFontsReady(timeoutMs = 900) {
        if (!document.fonts?.ready || document.fonts.status === 'loaded') {
            await waitForLayoutFrame();
            return;
        }
        await Promise.race([
            document.fonts.ready.catch(() => {}),
            new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
        ]);
        await waitForLayoutFrame();
    }

    function revealElements(nodes) {
        const elements = (nodes || []).filter(Boolean);
        if (!elements.length) return;
        const spotlightClones = elements.filter((node) => node.classList?.contains('onboarding-tour-spotlight-clone'));
        const animatedElements = elements.filter((node) => !spotlightClones.includes(node));

        spotlightClones.forEach((node) => {
            node.classList.remove('is-exiting');
            node.classList.add('is-visible');
        });

        animatedElements.forEach((node) => {
            node.classList.remove('is-visible', 'is-exiting');
        });
        animatedElements.forEach((node) => {
            // Force the browser to commit the initial hidden styles before the reveal class is applied.
            node.getBoundingClientRect();
        });
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                animatedElements.forEach((node) => node.classList.add('is-visible'));
            });
        });
    }

    function getLayerElements({ includeScrim = false, includeControl = true } = {}) {
        return [
            ...(includeScrim ? [scrim] : []),
            ...scrimPieces,
            tooltip,
            calloutStack,
            ...(includeControl ? [controlEl] : []),
            ...cloneEls,
            ...calloutEls,
            ...beaconEls,
        ].filter((node) => node?.parentNode);
    }

    async function fadeOutCurrentLayer({ preserveControl = false } = {}) {
        const elements = getLayerElements({ includeControl: !preserveControl });
        if (!elements.length) return;
        elements.forEach((node) => {
            node.classList.remove('is-visible');
            node.classList.add('is-exiting');
        });
        await waitForTransition();
    }

    function releaseTargetNodes() {
        targetNodes.forEach((node) => node.classList.remove(
            'onboarding-tour-target',
            'onboarding-tour-target--live',
            'onboarding-tour-target--outline',
            'onboarding-tour-target--source-hidden'
        ));
    }

    function stripCloneOnboardingMarkers(clone) {
        if (!clone?.querySelectorAll) return;
        [clone, ...clone.querySelectorAll('[data-onboarding-target], [data-onboarding-spotlight], [data-onboarding-clone-variant]')]
            .forEach((node) => {
                node.removeAttribute('data-onboarding-target');
                node.removeAttribute('data-onboarding-spotlight');
                node.removeAttribute('data-onboarding-clone-variant');
            });
    }

    function clearScrimPieces() {
        scrimPieces.forEach((node) => node.remove());
        scrimPieces = [];
        if (scrim) {
            scrim.classList.remove('onboarding-tour-scrim--has-hole');
            scrim.style.clipPath = '';
            scrim.style.webkitClipPath = '';
        }
    }

    function clearTargets({ preserveControl = false } = {}) {
        releaseTargetNodes();
        targetNodes = [];
        cloneEls.forEach((node) => node.remove());
        cloneEls = [];
        clearScrimPieces();
        calloutEls.forEach((node) => node.remove());
        calloutEls = [];
        beaconEls.forEach((node) => node.remove());
        beaconEls = [];
        if (calloutStack?.parentNode) calloutStack.parentNode.removeChild(calloutStack);
        calloutStack = null;
        if (!preserveControl) {
            if (controlEl?.parentNode) controlEl.parentNode.removeChild(controlEl);
            controlEl = null;
        }
        if (tooltip?.parentNode) tooltip.parentNode.removeChild(tooltip);
        tooltip = null;
    }

    function setTargets(nodes, { preserveControl = false } = {}) {
        clearTargets({ preserveControl });
        targetNodes = nodes || [];
        targetNodes.forEach((node) => {
            node.classList.add('onboarding-tour-target');
            const spotlightMode = node.getAttribute('data-onboarding-spotlight');
            if (spotlightMode === 'frame' || spotlightMode === 'live') {
                node.classList.add('onboarding-tour-target--live');
            }
            if (spotlightMode === 'live') {
                node.classList.add('onboarding-tour-target--outline');
                node.classList.add('onboarding-tour-target--source-hidden');
            }
        });
        cloneEls = [];
        targetNodes.forEach((node) => {
            const spotlightMode = node.getAttribute('data-onboarding-spotlight');

            const cloneWrap = document.createElement('div');
            cloneWrap.className = 'onboarding-tour-spotlight-clone';
            cloneWrap.__onboardingSourceNode = node;
            if (node.closest('.global-header')) {
                cloneWrap.classList.add('onboarding-tour-spotlight-clone--header');
            }
            if (node.matches?.('[data-onboarding-target="catalog-detail-panel"]')) {
                cloneWrap.classList.add('onboarding-tour-spotlight-clone--panel');
            }
            const cloneVariant = node.getAttribute('data-onboarding-clone-variant');
            if (cloneVariant) {
                cloneWrap.classList.add(`onboarding-tour-spotlight-clone--${cloneVariant}`);
            }
            cloneWrap.setAttribute('aria-hidden', 'true');

            if (spotlightMode === 'frame') {
                cloneWrap.classList.add('onboarding-tour-spotlight-clone--frame');
            } else {
                const clone = node.cloneNode(true);
                syncCloneFormState(node, clone);
                stripCloneOnboardingMarkers(clone);
                clone.classList.remove(
                    'onboarding-tour-target',
                    'onboarding-tour-target--live',
                    'onboarding-tour-target--outline',
                    'onboarding-tour-target--source-hidden'
                );
                clone.removeAttribute('tabindex');
                clone.querySelectorAll('a, button, input, select, textarea').forEach((child) => {
                    child.setAttribute('tabindex', '-1');
                    child.setAttribute('aria-hidden', 'true');
                });
                cloneWrap.appendChild(clone);
            }
            document.body.appendChild(cloneWrap);
            positionClone(cloneWrap, node);
            cloneEls.push(cloneWrap);
        });
        updateScrimPieces();
    }

    function syncCloneFormState(source, clone) {
        const sourceChildren = Array.from(source.querySelectorAll?.('input, select, textarea') || []);
        const cloneChildren = Array.from(clone.querySelectorAll?.('input, select, textarea') || []);
        const sourceFields = source.matches?.('input, select, textarea')
            ? [source, ...sourceChildren]
            : sourceChildren;
        const cloneFields = clone.matches?.('input, select, textarea')
            ? [clone, ...cloneChildren]
            : cloneChildren;

        cloneFields.forEach((field, index) => {
            const sourceField = sourceFields[index];
            if (!sourceField) return;
            if (field.tagName === 'SELECT') {
                field.value = sourceField.value;
                Array.from(field.options || []).forEach((option) => {
                    option.selected = option.value === sourceField.value;
                });
                return;
            }
            if (field.type === 'checkbox' || field.type === 'radio') {
                field.checked = Boolean(sourceField.checked);
                return;
            }
            field.value = sourceField.value;
        });
    }

    function createShell() {
        if (!scrim) {
            scrim = document.createElement('div');
            scrim.className = 'onboarding-tour-scrim';
            scrim.setAttribute('aria-hidden', 'true');
        }
        if (!scrim.parentNode) {
            document.body.appendChild(scrim);
            revealElements([scrim]);
        } else {
            scrim.classList.add('is-visible');
            scrim.classList.remove('is-exiting');
        }
        document.body.classList.add('onboarding-tour-active');
    }

    function lockTourScroll() {
        if (scrollLockState || !document.body) return;
        const bodyStyle = document.body.style;
        const htmlStyle = document.documentElement?.style;
        const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        scrollLockState = {
            x: window.scrollX || 0,
            y: window.scrollY || 0,
            position: bodyStyle.position,
            top: bodyStyle.top,
            left: bodyStyle.left,
            right: bodyStyle.right,
            width: bodyStyle.width,
            overflow: bodyStyle.overflow,
            boxSizing: bodyStyle.boxSizing,
            paddingRight: bodyStyle.paddingRight,
            scrollbarGutter: htmlStyle?.scrollbarGutter || '',
        };
        if (htmlStyle) {
            htmlStyle.scrollbarGutter = 'stable';
        }
        bodyStyle.position = 'fixed';
        bodyStyle.top = `-${scrollLockState.y}px`;
        bodyStyle.left = `-${scrollLockState.x}px`;
        bodyStyle.right = '0';
        bodyStyle.width = '100%';
        bodyStyle.overflow = 'hidden';
        bodyStyle.boxSizing = 'border-box';
        if (scrollbarGap > 0) {
            bodyStyle.paddingRight = `${scrollbarGap}px`;
        }
    }

    function unlockTourScroll() {
        if (!scrollLockState || !document.body) return;
        const bodyStyle = document.body.style;
        const htmlStyle = document.documentElement?.style;
        const { x, y, position, top, left, right, width, overflow, boxSizing, paddingRight, scrollbarGutter } = scrollLockState;
        scrollLockState = null;
        bodyStyle.position = position;
        bodyStyle.top = top;
        bodyStyle.left = left;
        bodyStyle.right = right;
        bodyStyle.width = width;
        bodyStyle.overflow = overflow;
        bodyStyle.boxSizing = boxSizing;
        bodyStyle.paddingRight = paddingRight;
        if (htmlStyle) {
            htmlStyle.scrollbarGutter = scrollbarGutter;
        }
        window.scrollTo(x, y);
    }

    function setBodyTourState(tour, step) {
        if (!document.body) return;
        if (tour?.tourId) {
            document.body.dataset.onboardingTourId = tour.tourId;
        } else {
            delete document.body.dataset.onboardingTourId;
        }
        if (step?.id) {
            document.body.dataset.onboardingStepId = step.id;
        } else {
            delete document.body.dataset.onboardingStepId;
        }
    }

    function setBodyStepVariant(variant) {
        if (!document.body) return;
        const normalized = String(variant || '').trim();
        if (normalized) {
            document.body.dataset.onboardingStepVariant = normalized;
        } else {
            delete document.body.dataset.onboardingStepVariant;
        }
    }

    async function removeShell() {
        const elements = getLayerElements({ includeScrim: true });
        elements.forEach((node) => {
            node.classList.remove('is-visible');
            node.classList.add('is-exiting');
        });
        await waitForTransition();
        clearTargets();
        if (scrim?.parentNode) scrim.parentNode.removeChild(scrim);
        document.body.classList.remove('onboarding-tour-active');
        setBodyTourState(null, null);
        unlockTourScroll();
    }

    function ensureTooltip() {
        if (!tooltip) {
            tooltip = document.createElement('section');
            tooltip.className = 'onboarding-tour-tooltip';
            tooltip.setAttribute('role', 'dialog');
            tooltip.setAttribute('aria-live', 'polite');
        }
        if (!tooltip.parentNode) document.body.appendChild(tooltip);
        return tooltip;
    }

    function getUnionRect(nodes) {
        const rects = (nodes || []).map((node) => node.getBoundingClientRect());
        if (!rects.length) {
            return {
                top: window.innerHeight * 0.35,
                right: window.innerWidth * 0.5,
                bottom: window.innerHeight * 0.35,
                left: window.innerWidth * 0.5,
                width: 0,
                height: 0,
            };
        }

        const top = Math.min(...rects.map((rect) => rect.top));
        const right = Math.max(...rects.map((rect) => rect.right));
        const bottom = Math.max(...rects.map((rect) => rect.bottom));
        const left = Math.min(...rects.map((rect) => rect.left));
        return {
            top,
            right,
            bottom,
            left,
            width: right - left,
            height: bottom - top,
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function positionClone(clone, node) {
        if (!clone || !node) return;
        const rect = node.getBoundingClientRect();
        const heightExtra = Math.max(0, Number(node.getAttribute('data-onboarding-clone-height-extra') || 0));
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height + heightExtra}px`;
    }

    function positionClones() {
        cloneEls.forEach((clone) => positionClone(clone, clone.__onboardingSourceNode));
    }

    function getFrameTargetRect() {
        const frameTargets = targetNodes.filter((node) => node.getAttribute('data-onboarding-spotlight') === 'frame');
        if (!frameTargets.length) return null;
        return getUnionRect(frameTargets);
    }

    function updateScrimPieces() {
        if (!scrim?.parentNode) return;
        const rect = getFrameTargetRect();
        if (!rect) {
            clearScrimPieces();
            return;
        }

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const top = clamp(rect.top, 0, viewportHeight);
        const right = clamp(rect.right, 0, viewportWidth);
        const bottom = clamp(rect.bottom, 0, viewportHeight);
        const left = clamp(rect.left, 0, viewportWidth);

        const polygonPath = `polygon(evenodd, 0px 0px, ${viewportWidth}px 0px, ${viewportWidth}px ${viewportHeight}px, 0px ${viewportHeight}px, 0px 0px, ${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${top}px, ${left}px ${top}px)`;

        scrim.classList.add('onboarding-tour-scrim--has-hole');
        scrim.style.clipPath = polygonPath;
        scrim.style.webkitClipPath = polygonPath;
    }

    function positionTooltip(step, nodes) {
        if (!tooltip) return;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        if (viewportWidth <= 720) {
            tooltip.dataset.placement = 'bottom';
            tooltip.style.removeProperty('--onboarding-arrow-x');
            return;
        }

        const rect = getUnionRect(nodes);
        const tooltipRect = tooltip.getBoundingClientRect();
        const gap = 18;
        const margin = 16;
        const centerX = rect.left + rect.width / 2;
        const left = clamp(centerX - tooltipRect.width / 2, margin, viewportWidth - tooltipRect.width - margin);

        let placement = step?.placement === 'top' ? 'top' : 'bottom';
        let top = rect.bottom + gap;
        if (placement === 'top' || top + tooltipRect.height > viewportHeight - margin) {
            placement = 'top';
            top = rect.top - tooltipRect.height - gap;
        }
        if (top < margin) {
            placement = 'bottom';
            top = clamp(rect.bottom + gap, margin, viewportHeight - tooltipRect.height - margin);
        }

        tooltip.dataset.placement = placement;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.setProperty('--onboarding-arrow-x', `${clamp(centerX - left, 24, tooltipRect.width - 24)}px`);
    }

    function renderStep(step) {
        renderBeacons(step);

        if (Array.isArray(step.callouts) && step.callouts.length) {
            renderCallouts(step);
            return;
        }

        const tooltipEl = ensureTooltip();
        const stepCount = activeTour?.steps?.length || 1;
        const isLastStep = activeStepIndex >= stepCount - 1;
        const listHtml = Array.isArray(step.items) && step.items.length
            ? `<div class="onboarding-tour-list">${step.items.map((item) => `
                <div class="onboarding-tour-list-item">
                    <span class="onboarding-tour-list-icon" aria-hidden="true">
                        <span class="material-symbols-outlined">${escapeHtml(item.icon || 'info')}</span>
                    </span>
                    <span>
                        <p class="onboarding-tour-list-title">${escapeHtml(item.title)}</p>
                        <p class="onboarding-tour-list-copy">${escapeHtml(item.body)}</p>
                    </span>
                </div>
            `).join('')}</div>`
            : '';

        tooltipEl.innerHTML = `
            <div class="onboarding-tour-kicker">
                <span class="material-symbols-outlined text-[15px]" aria-hidden="true">tips_and_updates</span>
                <span>${escapeHtml(rt(step.kicker, activeTour?.tourId, step.id, 'kicker') || rt(activeTour?.title, activeTour?.tourId, 'tour', 'title') || wt('onboarding.kicker_fallback', 'Обучение'))}</span>
            </div>
            <h2 class="onboarding-tour-title">${escapeHtml(rt(step.title, activeTour?.tourId, step.id, 'title') || '')}</h2>
            ${step.body ? `<p class="onboarding-tour-body">${escapeHtml(rt(step.body, activeTour?.tourId, step.id, 'body'))}</p>` : ''}
            ${listHtml}
            <div class="onboarding-tour-footer">
                <span class="onboarding-tour-progress">${stepCount > 1 ? `${activeStepIndex + 1} / ${stepCount}` : wt('onboarding.progress_main', 'Главная')}</span>
                <span class="onboarding-tour-actions">
                    <button type="button" class="onboarding-tour-button" data-onboarding-action="skip">${wt('onboarding.btn_close', 'Закрыть')}</button>
                    <button type="button" class="onboarding-tour-button onboarding-tour-button--primary" data-onboarding-action="${isLastStep ? 'done' : 'next'}">
                        ${isLastStep ? wt('onboarding.btn_done', 'Понятно') : wt('onboarding.btn_next', 'Далее')}
                    </button>
                </span>
            </div>
        `;
    }

    function renderArrowSvg() {
        return '<span class="onboarding-tour-callout-arrow" aria-hidden="true"></span>';
    }

    function renderBeacons(step) {
        beaconEls.forEach((node) => node.remove());
        beaconEls = [];

        const beacons = Array.isArray(step?.beacons) ? step.beacons : [];
        beacons.forEach((beacon) => {
            const target = beacon?.target ? document.querySelector(beacon.target) : null;
            if (!target) return;
            const rect = target.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            const startTourId = String(beacon.startTourId || beacon.tourId || '').trim();
            const stepVariant = String(beacon.stepVariant || beacon.calloutVariant || '').trim();
            const isInteractive = Boolean(startTourId || stepVariant);
            const node = document.createElement(isInteractive ? 'button' : 'span');
            node.className = 'onboarding-tour-beacon';
            if (isInteractive) {
                node.type = 'button';
                node.classList.add('onboarding-tour-beacon--interactive');
                node.setAttribute('data-onboarding-interactive', 'beacon');
            }
            if (startTourId) {
                node.setAttribute('data-onboarding-action', 'start-tour');
                node.setAttribute('data-onboarding-start-tour', startTourId);
                node.setAttribute('aria-label', beacon.label || wt('onboarding.beacon_next_mode', 'Открыть следующий режим обучения'));
                node.setAttribute('title', beacon.label || wt('onboarding.beacon_next_mode', 'Открыть следующий режим обучения'));
            } else if (stepVariant) {
                node.setAttribute('data-onboarding-action', 'set-step-variant');
                node.setAttribute('data-onboarding-step-variant', stepVariant);
                node.setAttribute('aria-label', beacon.label || wt('onboarding.beacon_extra_hint', 'Открыть дополнительную подсказку'));
                node.setAttribute('title', beacon.label || wt('onboarding.beacon_extra_hint', 'Открыть дополнительную подсказку'));
            } else {
                node.setAttribute('aria-hidden', 'true');
            }
            if (beacon.variant) {
                node.classList.add(`onboarding-tour-beacon--${String(beacon.variant).replace(/[^a-z0-9_-]/gi, '')}`);
            }
            node.dataset.placement = String(beacon.placement || 'right').replace(/-(start|end)$/, '');
            node.__onboardingTarget = target;
            node.__onboardingPlacement = String(beacon.placement || 'right');
            node.__onboardingOffsetX = Number(beacon.offsetX || 0);
            node.__onboardingOffsetY = Number(beacon.offsetY || 0);
            node.__onboardingGap = Number(beacon.gap || 8);
            document.body.appendChild(node);
            beaconEls.push(node);
        });
    }

    function positionBeacon(beacon) {
        const target = beacon?.__onboardingTarget;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const beaconRect = beacon.getBoundingClientRect();
        const width = beaconRect.width || 14;
        const height = beaconRect.height || 14;
        const gap = Number(beacon.__onboardingGap || 8);
        const offsetX = Number(beacon.__onboardingOffsetX || 0);
        const offsetY = Number(beacon.__onboardingOffsetY || 0);
        const placement = String(beacon.__onboardingPlacement || 'right').toLowerCase();
        const margin = 8;

        let left = rect.right + gap + offsetX;
        let top = rect.top + rect.height / 2 - height / 2 + offsetY;

        if (placement.startsWith('left')) {
            left = rect.left - width - gap - offsetX;
        } else if (placement.startsWith('top')) {
            left = rect.left + rect.width / 2 - width / 2 + offsetX;
            top = rect.top - height - gap - offsetY;
        } else if (placement.startsWith('bottom')) {
            left = rect.left + rect.width / 2 - width / 2 + offsetX;
            top = rect.bottom + gap + offsetY;
        }

        beacon.style.left = `${clamp(left, margin, window.innerWidth - width - margin)}px`;
        beacon.style.top = `${clamp(top, margin, window.innerHeight - height - margin)}px`;
    }

    function positionBeacons() {
        beaconEls.forEach(positionBeacon);
    }

    function renderCallouts(step) {
        if (tooltip?.parentNode) tooltip.parentNode.removeChild(tooltip);
        calloutEls.forEach((node) => node.remove());
        calloutEls = [];
        if (calloutStack?.parentNode) calloutStack.parentNode.removeChild(calloutStack);
        calloutStack = null;
        const canReuseControl = Boolean(activeTour?.persistControl);
        if (!canReuseControl && controlEl?.parentNode) {
            controlEl.parentNode.removeChild(controlEl);
            controlEl = null;
        }

        const useStack = window.innerWidth <= 720;
        if (useStack) {
            calloutStack = document.createElement('div');
            calloutStack.className = 'onboarding-tour-callout-stack';
            document.body.appendChild(calloutStack);
        }

        const variantCallouts = activeStepVariant && step.calloutVariants && Array.isArray(step.calloutVariants[activeStepVariant])
            ? step.calloutVariants[activeStepVariant]
            : null;
        const callouts = variantCallouts || step.callouts || [];

        let _ci = 0;
        callouts.forEach((callout) => {
            const _ckp = (variantCallouts ? 'cv.' + activeStepVariant + '.c' : 'c') + _ci;
            const targetNodes = callout.target
                ? Array.from(document.querySelectorAll(callout.target)).filter((node) => {
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                })
                : [];
            const target = targetNodes[0] || null;
            if (!target) return;

            const node = document.createElement('section');
            node.className = 'onboarding-tour-callout';
            if (callout.variant) {
                node.classList.add(`onboarding-tour-callout--${String(callout.variant).replace(/[^a-z0-9_-]/gi, '')}`);
            }
            const fixedWidth = Number(callout.width || 0);
            if (Number.isFinite(fixedWidth) && fixedWidth > 0) {
                node.style.width = `min(${fixedWidth}px, calc(100vw - 2rem))`;
            }
            const rawPlacement = String(callout.placement || 'bottom');
            node.dataset.placement = rawPlacement.replace(/-(start|end)$/, '');
            node.setAttribute('role', 'note');
            const extraArrows = Array.isArray(callout.extraArrows)
                ? callout.extraArrows.filter((arrow) => arrow && arrow.target)
                : [];
            const itemHtml = Array.isArray(callout.items) && callout.items.length
                ? `<div class="onboarding-tour-callout-list">${callout.items.map((item, _im) => `
                    <div class="onboarding-tour-callout-list-item">
                        <p class="onboarding-tour-callout-list-title">${escapeHtml(rt(item.title, activeTour?.tourId, step.id, _ckp + '.i' + _im + '.title') || '')}</p>
                        <p class="onboarding-tour-callout-list-copy">${escapeHtml(rt(item.body, activeTour?.tourId, step.id, _ckp + '.i' + _im + '.body') || '')}</p>
                    </div>
                `).join('')}</div>`
                : '';
            node.innerHTML = `
                ${callout.hideArrow ? '' : renderArrowSvg()}
                ${extraArrows.map((_, index) => `<span class="onboarding-tour-callout-arrow onboarding-tour-callout-arrow--extra" data-extra-arrow-index="${index}" aria-hidden="true"></span>`).join('')}
                ${callout.title ? `<h3 class="onboarding-tour-callout-title">${escapeHtml(rt(callout.title, activeTour?.tourId, step.id, _ckp + '.title'))}</h3>` : ''}
                ${callout.body ? `<p class="onboarding-tour-callout-body">${escapeHtml(rt(callout.body, activeTour?.tourId, step.id, _ckp + '.body'))}</p>` : ''}
                ${itemHtml}
            `;
            node.__onboardingTarget = target;
            node.__onboardingTargetNodes = callout.targetAll === true
                ? targetNodes
                : [target];
            node.__onboardingPlacement = rawPlacement;
            node.__onboardingOffsetX = Number(callout.offsetX || 0);
            node.__onboardingOffsetY = Number(callout.offsetY || 0);
            node.__onboardingArrowOffsetX = Number(callout.arrowOffsetX || 0);
            node.__onboardingArrowOffsetY = Number(callout.arrowOffsetY || 0);
            node.__onboardingArrowLengthExtra = Number(callout.arrowLengthExtra || 0);
            node.__onboardingGap = Number(callout.gap || step.calloutGap || 36);
            node.__onboardingRightOffset = Number.isFinite(Number(callout.rightOffset))
                ? Number(callout.rightOffset)
                : null;
            node.__onboardingCenterBetweenTarget = callout.centerBetweenTarget || '';
            node.__onboardingRowGroup = callout.rowGroup || '';
            node.__onboardingRowSlot = Number.isFinite(Number(callout.rowSlot))
                ? Number(callout.rowSlot)
                : null;
            node.__onboardingRowCount = Math.max(1, Number(callout.rowCount || 1));
            node.__onboardingRowInset = Number(callout.rowInset || 24);
            node.__onboardingSkipOverlapPush = callout.skipOverlapPush === true;
            node.__onboardingKeepPlacement = callout.keepPlacement === true;
            node.__onboardingPositionTarget = callout.positionTarget
                ? document.querySelector(callout.positionTarget)
                : null;
            node.__onboardingExtraArrows = extraArrows;
            (calloutStack || document.body).appendChild(node);
            calloutEls.push(node);
            _ci++;
        });

        const stepCount = activeTour?.steps?.length || 1;
        const visualStepCount = Number(activeTour?.totalStates || stepCount) || stepCount;
        const isLastVisualStep = activeStepIndex >= visualStepCount - 1;
        const hasPreviousStep = activeStepIndex > 0;
        const hasImplementedNextStep = Boolean(activeTour?.steps?.[activeStepIndex + 1]);
        const variantBackVariants = Array.isArray(step.variantBackVariants)
            ? step.variantBackVariants
            : [];
        const isVariantBranch = Boolean(
            activeStepVariant
            && variantBackVariants.includes(activeStepVariant)
        );
        let nextAction = isVariantBranch
            ? 'variant-back'
            : (isLastVisualStep ? 'done' : (hasImplementedNextStep ? 'next' : 'pending-next'));
        let nextLabel = isVariantBranch
            ? (step.variantBackLabel || wt('onboarding.btn_back', 'Вернуться'))
            : (isLastVisualStep
            ? wt('onboarding.btn_done', 'Понятно')
            : (hasImplementedNextStep ? wt('onboarding.btn_next', 'Далее') : (activeTour?.pendingNextLabel || wt('onboarding.btn_later', 'Дальше позже'))));
        if (activeReferencePreviewMode && isLastVisualStep && !isVariantBranch) {
            nextAction = hasPreviousStep ? 'prev' : 'pending-next';
            nextLabel = wt('onboarding.btn_back', 'Вернуться');
        }
        const nextDisabledAttr = nextAction === 'pending-next' ? ' disabled aria-disabled="true"' : '';
        const returnTourId = String(step.returnTourId || activeTour?.returnTourId || '').trim();
        const returnLabel = step.returnLabel || activeTour?.returnLabel || wt('onboarding.btn_back', 'Вернуться');
        const branchTourId = String(step.branchTourId || '').trim();
        const branchLabel = step.branchLabel || wt('onboarding.btn_open', 'Открыть');
        const returnToUrl = activePreviewMode ? resolveReturnToUrl() : '';
        const showPreviousButton = hasPreviousStep && !(activeReferencePreviewMode && isLastVisualStep && !isVariantBranch);
        const showReturnPageButton = Boolean(returnToUrl && !activeReferencePreviewMode);
        const showSkipButton = !activeReferencePreviewMode && !isLastVisualStep;
        const showPrimaryButton = !(activeReferencePreviewMode && isLastVisualStep && !hasPreviousStep && !isVariantBranch);
        if (!controlEl) {
            controlEl = document.createElement('div');
            controlEl.className = 'onboarding-tour-control';
        }
        controlEl.innerHTML = `
            <span class="onboarding-tour-control-label">${activeStepIndex + 1}/${visualStepCount}</span>
            <span class="onboarding-tour-actions">
                ${showPreviousButton ? `
                    <button type="button" class="onboarding-tour-button onboarding-tour-button--icon" data-onboarding-action="prev" aria-label="${wt('onboarding.btn_prev_aria', 'Вернуться к предыдущему состоянию')}">
                        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
                    </button>
                ` : ''}
                ${returnTourId ? `<button type="button" class="onboarding-tour-button" data-onboarding-action="return-tour" data-onboarding-return-tour="${escapeHtml(returnTourId)}">${escapeHtml(returnLabel)}</button>` : ''}
                ${branchTourId ? `<button type="button" class="onboarding-tour-button" data-onboarding-action="start-tour" data-onboarding-start-tour="${escapeHtml(branchTourId)}">${escapeHtml(branchLabel)}</button>` : ''}
                ${showReturnPageButton ? `<button type="button" class="onboarding-tour-button" data-onboarding-action="return-page">${wt('onboarding.btn_return_page', 'К заданию')}</button>` : ''}
                ${showSkipButton ? `<button type="button" class="onboarding-tour-button" data-onboarding-action="skip">${wt('onboarding.btn_close', 'Закрыть')}</button>` : ''}
                ${showPrimaryButton ? `
                <button type="button" class="onboarding-tour-button onboarding-tour-button--primary" data-onboarding-action="${nextAction}"${nextDisabledAttr}>
                    ${nextLabel}
                </button>
                ` : ''}
            </span>
        `;
        controlEl.classList.remove('is-exiting');
        if (!controlEl.parentNode) document.body.appendChild(controlEl);
    }

    function rectsOverlap(a, b, gap = 10) {
        return !(
            a.right + gap <= b.left
            || a.left >= b.right + gap
            || a.bottom + gap <= b.top
            || a.top >= b.bottom + gap
        );
    }

    function positionCallout(callout, occupiedRects = []) {
        if (!callout || window.innerWidth <= 720) return;
        const target = callout.__onboardingTarget;
        if (!target) return;

        const targetGroup = Array.isArray(callout.__onboardingTargetNodes) && callout.__onboardingTargetNodes.length
            ? callout.__onboardingTargetNodes
            : [target];
        const positionTarget = callout.__onboardingPositionTarget || null;
        const rect = positionTarget?.getBoundingClientRect
            ? positionTarget.getBoundingClientRect()
            : getUnionRect(targetGroup);
        const targetRect = getUnionRect(targetGroup);
        const bubble = callout.getBoundingClientRect();
        const margin = 16;
        const gap = Number(callout.__onboardingGap || 36);
        const offsetX = Number(callout.__onboardingOffsetX || 0);
        const offsetY = Number(callout.__onboardingOffsetY || 0);
        const arrowOffsetX = Number(callout.__onboardingArrowOffsetX || 0);
        const arrowOffsetY = Number(callout.__onboardingArrowOffsetY || 0);
        const arrowLengthExtra = Number(callout.__onboardingArrowLengthExtra || 0);
        const rightOffset = callout.__onboardingRightOffset;
        const rowSlot = callout.__onboardingRowSlot;
        const rowCount = Number(callout.__onboardingRowCount || 1);
        const rowInset = Number(callout.__onboardingRowInset || 24);
        const forcedLeftRaw = callout.__onboardingForcedLeft;
        const forcedTopRaw = callout.__onboardingForcedTop;
        const forcedLeft = forcedLeftRaw == null ? NaN : Number(forcedLeftRaw);
        const forcedTop = forcedTopRaw == null ? NaN : Number(forcedTopRaw);
        const skipOverlapPush = callout.__onboardingSkipOverlapPush === true;
        const keepPlacement = callout.__onboardingKeepPlacement === true;
        const centerX = targetRect.left + targetRect.width / 2;
        const centerY = targetRect.top + targetRect.height / 2;
        const left = clamp(centerX - bubble.width / 2, margin, window.innerWidth - bubble.width - margin);

        let placement = callout.__onboardingPlacement || 'bottom';
        const isStartAligned = placement.endsWith('-start');
        const isEndAligned = placement.endsWith('-end');
        placement = placement.replace(/-(start|end)$/, '');

        let top = rect.bottom + gap;
        let nextLeft = left;

        if (Number.isFinite(rowSlot)) {
            const available = Math.max(0, rect.width - (rowInset * 2) - bubble.width);
            const slotStep = rowCount > 1 ? available / (rowCount - 1) : 0;
            nextLeft = rect.left + rowInset + (slotStep * clamp(rowSlot, 0, rowCount - 1)) + offsetX;
        }

        if (Number.isFinite(forcedLeft)) {
            nextLeft = forcedLeft;
        }
        if (Number.isFinite(forcedTop)) {
            top = forcedTop;
        }

        if (placement === 'right') {
            nextLeft = rect.right + gap + offsetX;
            top = rect.top + Math.max(0, (rect.height - bubble.height) / 2) + offsetY;
            if (callout.__onboardingCenterBetweenTarget) {
                const peer = document.querySelector(callout.__onboardingCenterBetweenTarget);
                const peerRect = peer?.getBoundingClientRect();
                if (peerRect && peerRect.left > rect.right) {
                    const balancedGap = Math.max(0, (peerRect.left - rect.right - bubble.width) / 2);
                    nextLeft = rect.right + balancedGap + offsetX;
                }
            }
            if (nextLeft + bubble.width > window.innerWidth - margin) {
                placement = 'left';
                nextLeft = rect.left - bubble.width - gap - offsetX;
            }
        } else if (placement === 'left') {
            nextLeft = rect.left - bubble.width - gap - offsetX;
            top = rect.top + Math.max(0, (rect.height - bubble.height) / 2) + offsetY;
            if (!keepPlacement && nextLeft < margin) {
                placement = 'right';
                nextLeft = rect.right + gap + offsetX;
            }
        } else if (placement === 'top') {
            nextLeft += offsetX;
            top = rect.top - bubble.height - gap - offsetY;
        } else if (isStartAligned) {
            nextLeft = Number.isFinite(rightOffset)
                ? clamp(rect.right - bubble.width - rightOffset + offsetX, margin, window.innerWidth - bubble.width - margin)
                : clamp(rect.left + offsetX, margin, window.innerWidth - bubble.width - margin);
            top += offsetY;
        } else if (isEndAligned) {
            nextLeft = clamp(rect.right - bubble.width - offsetX, margin, window.innerWidth - bubble.width - margin);
            top += offsetY;
        } else {
            top += offsetY;
            nextLeft += offsetX;
        }

        if (!keepPlacement && placement === 'bottom' && top + bubble.height > window.innerHeight - margin) {
            placement = 'top';
            top = rect.top - bubble.height - gap;
        }
        if (!keepPlacement && placement === 'top' && top < margin) {
            placement = 'bottom';
            top = rect.bottom + gap;
        }

        top = clamp(top, margin, window.innerHeight - bubble.height - margin);
        nextLeft = clamp(nextLeft, margin, window.innerWidth - bubble.width - margin);

        const maxTop = window.innerHeight - bubble.height - margin;
        const blockingRects = occupiedRects.filter((occupied) => {
            const owner = occupied?.node;
            return !(owner && owner !== target && owner.contains(target));
        });
        let candidate = { left: nextLeft, top, right: nextLeft + bubble.width, bottom: top + bubble.height };
        let guard = 0;
        while (!skipOverlapPush && blockingRects.some((rect) => rectsOverlap(candidate, rect)) && guard < 20) {
            top = clamp(top + 18, margin, maxTop);
            candidate = { left: nextLeft, top, right: nextLeft + bubble.width, bottom: top + bubble.height };
            guard += 1;
            if (top >= maxTop) break;
        }

        if (!skipOverlapPush && blockingRects.some((rect) => rectsOverlap(candidate, rect))) {
            guard = 0;
            while (blockingRects.some((rect) => rectsOverlap(candidate, rect)) && guard < 20) {
                top = clamp(top - 18, margin, maxTop);
                candidate = { left: nextLeft, top, right: nextLeft + bubble.width, bottom: top + bubble.height };
                guard += 1;
                if (top <= margin) break;
            }
        }

        callout.dataset.placement = placement;
        callout.style.left = `${nextLeft}px`;
        callout.style.top = `${top}px`;
        callout.style.setProperty('--onboarding-arrow-x', `${clamp(centerX - nextLeft + arrowOffsetX, 30, bubble.width - 30)}px`);
        callout.style.setProperty('--onboarding-arrow-y', `${clamp(centerY - top + arrowOffsetY, 24, bubble.height - 24)}px`);
        if (placement === 'top') {
            callout.style.setProperty('--onboarding-arrow-length', `${Math.max(18, targetRect.top - candidate.bottom - 10 + arrowLengthExtra)}px`);
        } else if (placement === 'bottom') {
            callout.style.setProperty('--onboarding-arrow-length', `${Math.max(18, candidate.top - targetRect.bottom - 10 + arrowLengthExtra)}px`);
        } else if (placement === 'left') {
            callout.style.setProperty('--onboarding-arrow-length', `${Math.max(18, targetRect.left - candidate.right - 10 + arrowLengthExtra)}px`);
        } else if (placement === 'right') {
            callout.style.setProperty('--onboarding-arrow-length', `${Math.max(18, candidate.left - targetRect.right - 10 + arrowLengthExtra)}px`);
        }
        positionExtraArrows(callout);
        occupiedRects.push(candidate);
    }

    function positionExtraArrows(callout) {
        if (!callout || window.innerWidth <= 720) return;
        const arrows = Array.isArray(callout.__onboardingExtraArrows) ? callout.__onboardingExtraArrows : [];
        if (!arrows.length) return;

        const bubble = callout.getBoundingClientRect();
        const resolveAnchorX = (rect, anchor = 'center') => {
            if (anchor === 'left') return rect.left;
            if (anchor === 'right') return rect.right;
            return rect.left + rect.width / 2;
        };
        const resolveAnchorY = (rect, anchor = 'center') => {
            if (anchor === 'top') return rect.top;
            if (anchor === 'bottom') return rect.bottom;
            return rect.top + rect.height / 2;
        };
        arrows.forEach((config, index) => {
            const arrowEl = callout.querySelector(`[data-extra-arrow-index="${index}"]`);
            const target = config.target ? document.querySelector(config.target) : null;
            if (!arrowEl || !target) return;

            const rect = target.getBoundingClientRect();
            const placement = String(config.placement || 'right').replace(/-(start|end)$/, '');
            const offsetX = Number(config.offsetX || 0);
            const offsetY = Number(config.offsetY || 0);
            arrowEl.dataset.extraPlacement = placement;

            if (placement === 'line' || placement === 'diagonal') {
                const targetX = resolveAnchorX(rect, config.targetAnchorX || 'center') + offsetX;
                const targetY = resolveAnchorY(rect, config.targetAnchorY || 'center') + offsetY;
                const startX = Number.isFinite(Number(config.startX))
                    ? Number(config.startX)
                    : clamp(targetX - bubble.left, 24, bubble.width - 24);
                const startY = Number.isFinite(Number(config.startY))
                    ? Number(config.startY)
                    : -8;
                const dx = targetX - (bubble.left + startX);
                const dy = targetY - (bubble.top + startY);
                const length = Math.max(18, Math.hypot(dx, dy));
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                arrowEl.dataset.extraPlacement = 'line';
                arrowEl.style.setProperty('--onboarding-extra-line-left', `${startX}px`);
                arrowEl.style.setProperty('--onboarding-extra-line-top', `${startY}px`);
                arrowEl.style.setProperty('--onboarding-extra-line-length', `${length}px`);
                arrowEl.style.setProperty('--onboarding-extra-line-angle', `${angle}deg`);
                return;
            }

            if (placement === 'right') {
                const centerY = config.sameAxis === true
                    ? bubble.top + bubble.height / 2
                    : rect.top + rect.height / 2;
                arrowEl.style.setProperty('--onboarding-extra-arrow-top', `${clamp(centerY - bubble.top + offsetY, 20, bubble.height - 20)}px`);
                arrowEl.style.setProperty('--onboarding-extra-arrow-length', `${Math.max(18, rect.left - bubble.right - 10 + offsetX)}px`);
                return;
            }

            if (placement === 'left') {
                const centerY = config.sameAxis === true
                    ? bubble.top + bubble.height / 2
                    : rect.top + rect.height / 2;
                arrowEl.style.setProperty('--onboarding-extra-arrow-top', `${clamp(centerY - bubble.top + offsetY, 20, bubble.height - 20)}px`);
                arrowEl.style.setProperty('--onboarding-extra-arrow-length', `${Math.max(18, bubble.left - rect.right - 10 - offsetX)}px`);
                return;
            }

            const centerX = rect.left + rect.width / 2;
            arrowEl.style.setProperty('--onboarding-extra-arrow-x', `${clamp(centerX - bubble.left + offsetX, 24, bubble.width - 24)}px`);
            if (placement === 'top') {
                arrowEl.style.setProperty('--onboarding-extra-arrow-length', `${Math.max(18, bubble.top - rect.bottom - 10 - offsetY)}px`);
            } else {
                arrowEl.dataset.extraPlacement = 'bottom';
                arrowEl.style.setProperty('--onboarding-extra-arrow-length', `${Math.max(18, rect.top - bubble.bottom - 10 + offsetY)}px`);
            }
        });
    }

    function prepareCalloutRows(callouts) {
        if (!Array.isArray(callouts) || !callouts.length || window.innerWidth <= 720) return;
        const grouped = new Map();
        callouts.forEach((callout) => {
            callout.__onboardingForcedLeft = null;
            callout.__onboardingForcedTop = null;
            const group = callout.__onboardingRowGroup;
            if (!group) return;
            callout.__onboardingSkipOverlapPush = false;
            if (!grouped.has(group)) grouped.set(group, []);
            grouped.get(group).push(callout);
        });

        grouped.forEach((rowCallouts) => {
            const entries = rowCallouts
                .map((callout) => {
                    const targetGroup = Array.isArray(callout.__onboardingTargetNodes) && callout.__onboardingTargetNodes.length
                        ? callout.__onboardingTargetNodes
                        : [callout.__onboardingTarget].filter(Boolean);
                    const targetRect = getUnionRect(targetGroup);
                    const positionTarget = callout.__onboardingPositionTarget || null;
                    const rowRect = positionTarget?.getBoundingClientRect
                        ? positionTarget.getBoundingClientRect()
                        : targetRect;
                    const bubble = callout.getBoundingClientRect();
                    const rowInset = Number(callout.__onboardingRowInset || 24);
                    const gap = Number(callout.__onboardingGap || 36);
                    const offsetX = Number(callout.__onboardingOffsetX || 0);
                    const offsetY = Number(callout.__onboardingOffsetY || 0);
                    return {
                        callout,
                        bubble,
                        rowRect,
                        rowInset,
                        preferredLeft: targetRect.left + targetRect.width / 2 - bubble.width / 2 + offsetX,
                        top: rowRect.bottom + gap + offsetY,
                    };
                })
                .filter((entry) => entry.bubble.width > 0 && entry.bubble.height > 0)
                .sort((a, b) => a.preferredLeft - b.preferredLeft);
            if (!entries.length) return;

            const rowLeft = Math.max(16, Math.min(...entries.map((entry) => entry.rowRect.left + entry.rowInset)));
            const rowRight = Math.min(
                window.innerWidth - 16,
                Math.max(...entries.map((entry) => entry.rowRect.right - entry.rowInset))
            );
            const itemGap = 20;
            const commonTop = Math.max(16, Math.min(...entries.map((entry) => entry.top)));
            let cursor = rowLeft;
            entries.forEach((entry) => {
                const maxLeft = rowRight - entry.bubble.width;
                entry.left = clamp(entry.preferredLeft, cursor, maxLeft);
                cursor = entry.left + entry.bubble.width + itemGap;
            });

            const last = entries[entries.length - 1];
            const overflow = Math.max(0, last.left + last.bubble.width - rowRight);
            if (overflow > 0) {
                last.left -= overflow;
                for (let index = entries.length - 2; index >= 0; index -= 1) {
                    const entry = entries[index];
                    const next = entries[index + 1];
                    entry.left = Math.min(entry.left, next.left - itemGap - entry.bubble.width);
                }
            }

            entries.forEach((entry) => {
                entry.callout.__onboardingForcedLeft = clamp(entry.left, 16, window.innerWidth - entry.bubble.width - 16);
                entry.callout.__onboardingForcedTop = commonTop;
                entry.callout.__onboardingSkipOverlapPush = true;
            });
        });
    }

    function positionCallouts() {
        const occupiedRects = targetNodes.map((node) => {
            const rect = node.getBoundingClientRect();
            const pad = 8;
            return {
                node,
                left: rect.left - pad,
                top: rect.top - pad,
                right: rect.right + pad,
                bottom: rect.bottom + pad,
            };
        });
        prepareCalloutRows(calloutEls);
        calloutEls.forEach((callout) => positionCallout(callout, occupiedRects));
    }

    function placeControl(candidate) {
        if (!controlEl) return null;
        controlEl.style.left = candidate.left == null ? 'auto' : `${candidate.left}px`;
        controlEl.style.right = candidate.right == null ? 'auto' : `${candidate.right}px`;
        controlEl.style.top = candidate.top == null ? 'auto' : `${candidate.top}px`;
        controlEl.style.bottom = candidate.bottom == null ? 'auto' : `${candidate.bottom}px`;
        const rect = controlEl.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        };
    }

    function getControlCandidateByPlacement(placement, margin) {
        const normalized = String(placement || '').toLowerCase();
        const map = {
            'bottom-right': { right: margin, bottom: margin },
            'bottom-left': { left: margin, bottom: margin },
            'top-right': { right: margin, top: margin },
            'top-left': { left: margin, top: margin },
        };
        const candidate = map[normalized];
        return candidate ? { ...candidate, anchor: normalized } : null;
    }

    function resolveControlCandidate(candidate, width, height, margin) {
        const left = candidate.left ?? (window.innerWidth - width - (candidate.right ?? margin));
        const top = candidate.top ?? (window.innerHeight - height - (candidate.bottom ?? margin));
        return {
            ...candidate,
            left,
            top,
            anchor: candidate.anchor || 'custom',
        };
    }

    function getStepControlPlacement(step) {
        return step?.controlPlacement || '';
    }

    function shouldLockStepControlPlacement(step) {
        return step?.controlPlacementLocked === true;
    }

    function animateControlMove(fromRect) {
        if (!controlEl || !fromRect || prefersReducedMotion()) return;
        const toRect = controlEl.getBoundingClientRect();
        const deltaX = fromRect.left - toRect.left;
        const deltaY = fromRect.top - toRect.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

        controlEl.style.transition = 'none';
        controlEl.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        controlEl.getBoundingClientRect();
        window.requestAnimationFrame(() => {
            controlEl.style.transition = '';
            controlEl.style.transform = '';
        });
    }

    function positionControl(step) {
        if (!controlEl || window.innerWidth <= 720) return;

        const margin = 16;
        const controlRect = controlEl.getBoundingClientRect();
        const width = controlRect.width;
        const height = controlRect.height;
        const preferred = getControlCandidateByPlacement(getStepControlPlacement(step), margin);
        const defaultCandidates = [
            { right: margin, bottom: margin, anchor: 'bottom-right' },
            { left: margin, bottom: margin, anchor: 'bottom-left' },
            { right: margin, top: margin, anchor: 'top-right' },
            { left: margin, top: margin, anchor: 'top-left' },
        ];
        const candidates = preferred
            ? [preferred, ...defaultCandidates.filter((candidate) => candidate.anchor !== preferred.anchor)]
            : defaultCandidates;
        const occupiedRects = [
            ...cloneEls,
            ...calloutEls,
            tooltip,
            calloutStack,
        ].filter(Boolean).map((node) => {
            const rect = node.getBoundingClientRect();
            const pad = 12;
            return {
                left: rect.left - pad,
                top: rect.top - pad,
                right: rect.right + pad,
                bottom: rect.bottom + pad,
            };
        });

        const resolved = candidates.map((candidate) => resolveControlCandidate(candidate, width, height, margin));
        const freeCandidate = (preferred && shouldLockStepControlPlacement(step))
            ? resolveControlCandidate(preferred, width, height, margin)
            : (resolved.find((candidate) => {
            const rect = {
                left: candidate.left,
                top: candidate.top,
                right: candidate.left + width,
                bottom: candidate.top + height,
            };
            return !occupiedRects.some((occupied) => rectsOverlap(rect, occupied, 0));
        }) || resolved[0]);

        placeControl({
            left: freeCandidate.left,
            top: freeCandidate.top,
            right: null,
            bottom: null,
        });
        controlEl.dataset.onboardingControlPlacement = freeCandidate.anchor;
    }

    function positionActiveOverlays(step) {
        positionClones();
        positionBeacons();
        updateScrimPieces();
        if (Array.isArray(step?.callouts) && step.callouts.length) {
            positionCallouts();
            positionControl(step);
            return;
        }
        positionTooltip(step, targetNodes);
        positionControl(step);
    }

    function positionActiveOverlaysWithoutMotion(step) {
        document.body.classList.add('onboarding-tour-layout-stabilizing');
        positionActiveOverlays(step);
        document.body.getBoundingClientRect();
        window.requestAnimationFrame(() => {
            document.body.classList.remove('onboarding-tour-layout-stabilizing');
        });
    }

    function getStableOverlayLayoutSnapshot() {
        const nodeSnapshot = (node) => {
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
            };
        };
        return {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            targets: targetNodes.map(nodeSnapshot),
            beacons: beaconEls.map(nodeSnapshot),
            callouts: calloutEls.map((node) => ({
                width: node?.offsetWidth || 0,
                height: node?.offsetHeight || 0,
                scrollWidth: node?.scrollWidth || 0,
                scrollHeight: node?.scrollHeight || 0,
            })),
            tooltip: tooltip ? {
                width: tooltip.offsetWidth || 0,
                height: tooltip.offsetHeight || 0,
                scrollWidth: tooltip.scrollWidth || 0,
                scrollHeight: tooltip.scrollHeight || 0,
            } : null,
        };
    }

    function hasStableOverlayLayoutChanged(previous, next, threshold = 1.5) {
        if (!previous || !next) return true;
        if (Math.abs(previous.viewportWidth - next.viewportWidth) > threshold) return true;
        if (Math.abs(previous.viewportHeight - next.viewportHeight) > threshold) return true;
        const changedList = (beforeList = [], afterList = []) => {
            if (beforeList.length !== afterList.length) return true;
            return beforeList.some((before, index) => {
                const after = afterList[index];
                if (!before || !after) return before !== after;
                return Object.keys(before).some((key) => Math.abs(Number(before[key] || 0) - Number(after[key] || 0)) > threshold);
            });
        };
        if (changedList(previous.targets, next.targets)) return true;
        if (changedList(previous.beacons, next.beacons)) return true;
        if (changedList(previous.callouts, next.callouts)) return true;
        if (changedList(previous.tooltip ? [previous.tooltip] : [], next.tooltip ? [next.tooltip] : [])) return true;
        return false;
    }

    function getCurrentScrollY() {
        return scrollLockState ? scrollLockState.y : (window.scrollY || 0);
    }

    function isNodeComfortablyVisible(node) {
        if (!node) return true;
        const rect = node.getBoundingClientRect();
        const margin = 24;
        return rect.top >= margin && rect.bottom <= window.innerHeight - margin;
    }

    function getScrollableAncestor(node) {
        let current = node?.parentElement || null;
        while (current && current !== document.body && current !== document.documentElement) {
            const style = window.getComputedStyle(current);
            const overflowY = style.overflowY || style.overflow;
            if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight + 1) {
                return current;
            }
            current = current.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    async function applyStepScrollContainerOffset(step, scrollNode, scrollBehavior) {
        const offset = Number(step?.scrollContainerOffsetY || 0);
        if (!offset || !scrollNode) return;
        const scroller = getScrollableAncestor(scrollNode);
        if (!scroller) return;
        if (typeof scroller.scrollBy === 'function') {
            scroller.scrollBy({ top: offset, left: 0, behavior: scrollBehavior });
        } else {
            scroller.scrollTop += offset;
        }
        await waitForStepScroll(scrollBehavior, step);
    }

    async function showStep(index) {
        if (!activeTour?.steps?.length) return;
        const tour = activeTour;
        const nextIndex = clamp(index, 0, tour.steps.length - 1);
        const step = tour.steps[nextIndex];
        const token = ++transitionToken;
        const previousControlRect = controlEl?.parentNode ? controlEl.getBoundingClientRect() : null;
        const previousControlPlacement = controlEl?.dataset?.onboardingControlPlacement || '';
        const preserveControl = Boolean(tour.persistControl && previousControlRect);
        activeStepVariant = '';
        setBodyStepVariant('');

        createShell();
        releaseTargetNodes();
        setBodyTourState(tour, step);
        const preparationPromises = [];
        window.dispatchEvent(new CustomEvent('onboarding:before-step', {
            detail: {
                tourId: tour.tourId || '',
                stepId: step.id || '',
                stepIndex: nextIndex,
                waitUntil(promise) {
                    if (promise && typeof promise.then === 'function') {
                        preparationPromises.push(promise);
                    }
                },
            },
        }));
        await waitForStepPreparation(preparationPromises, step);
        if (token !== transitionToken || activeTour !== tour) return;

        let nodes = await waitForStepTargets(step);
        if (token !== transitionToken || activeTour !== tour) return;

        await waitForStepReady(step);
        if (token !== transitionToken || activeTour !== tour) return;
        await waitForFontsReady();
        if (token !== transitionToken || activeTour !== tour) return;
        nodes = findStepTargets(step);

        const explicitScrollY = Number(step.scrollY);
        const scrollBehavior = getStepScrollBehavior(step);
        const unlockForScroll = () => {
            if (scrollLockState) {
                unlockTourScroll();
            }
        };
        if (Number.isFinite(explicitScrollY)) {
            if (Math.abs(getCurrentScrollY() - explicitScrollY) > 1) {
                unlockForScroll();
                window.scrollTo({ top: explicitScrollY, left: 0, behavior: scrollBehavior });
                await waitForStepScroll(scrollBehavior, step);
            }
        } else if (step.skipAutoScroll !== true && nodes[0]) {
            const scrollTarget = step.scrollTarget ? document.querySelector(step.scrollTarget) : null;
            const scrollNode = scrollTarget || nodes[0];
            const hasScrollOffset = Number(step.scrollOffsetY || 0) !== 0;
            const shouldForceAutoScroll = step.forceAutoScroll === true;
            if ((shouldForceAutoScroll || hasScrollOffset || !isNodeComfortablyVisible(scrollNode)) && typeof scrollNode.scrollIntoView === 'function') {
                unlockForScroll();
                scrollNode.scrollIntoView({
                    behavior: scrollBehavior,
                    block: step.scrollBlock || 'center',
                    inline: 'center',
                });
                await waitForStepScroll(scrollBehavior, step);
            }
            if (Number(step.scrollContainerOffsetY || 0)) {
                unlockForScroll();
                await applyStepScrollContainerOffset(step, scrollNode, scrollBehavior);
            }
        }
        if (Number(step.scrollOffsetY || 0)) {
            unlockForScroll();
            window.scrollBy({ top: Number(step.scrollOffsetY || 0), left: 0, behavior: scrollBehavior });
            await waitForStepScroll(scrollBehavior, step);
        }
        lockTourScroll();
        await waitForLayoutFrame();
        if (token !== transitionToken || activeTour !== tour) return;

        const lockedNodes = findStepTargets(step);
        if (lockedNodes.length) {
            nodes = lockedNodes;
        }

        await fadeOutCurrentLayer({ preserveControl });
        if (token !== transitionToken || activeTour !== tour) return;

        activeStepIndex = nextIndex;
        setTargets(nodes, { preserveControl });
        renderStep(step);
        positionActiveOverlays(step);
        const currentControlPlacement = controlEl?.dataset?.onboardingControlPlacement || '';
        if (preserveControl && previousControlPlacement && previousControlPlacement !== currentControlPlacement) {
            animateControlMove(previousControlRect);
        }
        const shouldRevealControl = !(preserveControl && controlEl?.classList.contains('is-visible'));
        let stableSnapshot = getStableOverlayLayoutSnapshot();
        revealElements(getLayerElements({ includeControl: shouldRevealControl }));
        window.requestAnimationFrame(() => {
            if (token !== transitionToken || activeTour !== tour) return;
            if (hasStableOverlayLayoutChanged(stableSnapshot, getStableOverlayLayoutSnapshot())) {
                positionActiveOverlaysWithoutMotion(step);
                stableSnapshot = getStableOverlayLayoutSnapshot();
            }
            window.setTimeout(() => {
                if (token !== transitionToken || activeTour !== tour) return;
                if (hasStableOverlayLayoutChanged(stableSnapshot, getStableOverlayLayoutSnapshot())) {
                    positionActiveOverlaysWithoutMotion(step);
                }
            }, 360);
        });
        window.dispatchEvent(new CustomEvent('onboarding:step-ready', {
            detail: {
                tourId: tour.tourId || '',
                stepId: step.id || '',
                stepIndex: activeStepIndex,
            },
        }));
        notifyReferencePreviewStep(tour, step);
    }

    async function finishTour({ seen = true } = {}) {
        const tour = activeTour;
        const shouldPersistSeen = seen && !activePreviewMode;
        activeTour = null;
        activePreviewMode = false;
        activeReferencePreviewMode = false;
        activeStepVariant = '';
        setBodyStepVariant('');
        transitionToken += 1;
        await removeShell();
        if (shouldPersistSeen && tour) {
            await markTourSeen(tour);
        }
        window.dispatchEvent(new CustomEvent('onboarding:finish', {
            detail: {
                tourId: tour?.tourId || '',
                seen: Boolean(seen),
            },
        }));
    }

    function bindEvents() {
        document.addEventListener('click', (event) => {
            const helpButton = event.target.closest('[data-onboarding-help-button]');
            if (helpButton && !activeTour) {
                event.preventDefault();
                event.stopPropagation();
                const tourId = resolveHelpTourId(helpButton);
                if (!findTourById(tourId)) {
                    updateHelpButtons();
                    return;
                }
                if (resolveHelpMode(helpButton) === 'preview') {
                    navigateTo(resolvePreviewUrl(tourId, helpButton));
                    return;
                }
                void startTour(tourId, { force: true });
                return;
            }

            if (!activeTour) return;
            const isInsideTour = Boolean(
                tooltip?.contains(event.target)
                || controlEl?.contains(event.target)
                || calloutEls.some((node) => node.contains(event.target))
                || event.target.closest('[data-onboarding-interactive]')
            );
            if (!isInsideTour) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            const action = event.target.closest('[data-onboarding-action]')?.getAttribute('data-onboarding-action');
            if (!action) return;
            event.preventDefault();
            event.stopPropagation();

            if ((action === 'skip' || action === 'done') && activeReferencePreviewMode) {
                return;
            }
            if (action === 'skip' || action === 'done') {
                const returnToUrl = activePreviewMode ? resolveReturnToUrl() : '';
                void finishTour({ seen: true }).then(() => {
                    if (returnToUrl) navigateTo(returnToUrl);
                });
                return;
            }
            if (action === 'return-page') {
                const returnToUrl = resolveReturnToUrl();
                void finishTour({ seen: true }).then(() => {
                    if (returnToUrl) navigateTo(returnToUrl);
                });
                return;
            }
            if (action === 'return-tour') {
                const step = activeTour?.steps?.[activeStepIndex];
                const returnTourId = event.target.closest('[data-onboarding-return-tour]')?.getAttribute('data-onboarding-return-tour')
                    || step?.returnTourId
                    || activeTour?.returnTourId
                    || '';
                const shouldPreview = activePreviewMode;
                void finishTour({ seen: false }).then(() => {
                    if (!returnTourId) return;
                    window.setTimeout(() => {
                        void startTour(returnTourId, { force: true, preview: shouldPreview });
                    }, 0);
                });
                return;
            }
            if (action === 'start-tour') {
                const step = activeTour?.steps?.[activeStepIndex];
                const nextTourId = event.target.closest('[data-onboarding-start-tour]')?.getAttribute('data-onboarding-start-tour')
                    || step?.branchTourId
                    || '';
                const shouldPreview = activePreviewMode;
                void finishTour({ seen: false }).then(() => {
                    if (!nextTourId) return;
                    window.setTimeout(() => {
                        void startTour(nextTourId, { force: true, preview: shouldPreview });
                    }, 0);
                });
                return;
            }
            if (action === 'set-step-variant') {
                const step = activeTour?.steps?.[activeStepIndex];
                const variant = event.target.closest('[data-onboarding-step-variant]')?.getAttribute('data-onboarding-step-variant') || '';
                if (!step || !variant) return;
                activeStepVariant = variant;
                setBodyStepVariant(variant);
                const nodes = findStepTargets(step);
                if (nodes.length) {
                    setTargets(nodes, { preserveControl: true });
                }
                renderStep(step);
                positionActiveOverlays(step);
                revealElements(getLayerElements({ includeControl: false }));
                window.requestAnimationFrame(() => positionActiveOverlays(step));
                return;
            }
            if (action === 'next') {
                void showStep(activeStepIndex + 1);
                return;
            }
            if (action === 'prev') {
                void showStep(activeStepIndex - 1);
                return;
            }
            if (action === 'pending-next') {
                return;
            }
            if (action === 'variant-back') {
                const step = activeTour?.steps?.[activeStepIndex];
                const previousVariant = activeStepVariant;
                window.dispatchEvent(new CustomEvent('onboarding:before-variant-back', {
                    detail: {
                        tourId: activeTour?.tourId || '',
                        stepId: step?.id || '',
                        variant: previousVariant,
                    },
                }));
                activeStepVariant = '';
                setBodyStepVariant('');
                const nodes = findStepTargets(step);
                if (nodes.length) {
                    setTargets(nodes, { preserveControl: true });
                }
                renderStep(step);
                positionActiveOverlays(step);
                revealElements(getLayerElements({ includeControl: false }));
                window.requestAnimationFrame(() => positionActiveOverlays(step));
                window.dispatchEvent(new CustomEvent('onboarding:variant-back', {
                    detail: {
                        tourId: activeTour?.tourId || '',
                        stepId: step?.id || '',
                        previousVariant,
                    },
                }));
                return;
            }
        }, true);

        document.addEventListener('keydown', (event) => {
            if (!activeTour) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                void finishTour({ seen: true });
            }
        }, true);

        window.addEventListener('resize', () => {
            if (!activeTour) return;
            positionActiveOverlays(activeTour.steps[activeStepIndex]);
        });

        window.addEventListener('scroll', () => {
            if (!activeTour) return;
            if (scrollLockState) return;
            positionActiveOverlays(activeTour.steps[activeStepIndex]);
        }, { passive: true });
    }

    async function startTour(tourId, { force = false, preview = false, initialStep = 0 } = {}) {
        if (activeTour) return false;
        const tour = getTours().find((candidate) => candidate.tourId === tourId);
        if (!tour || !tour.steps?.length) return false;
        if (!force && await isTourSeen(tour)) return false;
        if (isBlockingModalOpen()) return false;

        activeTour = tour;
        activePreviewMode = Boolean(preview);
        activeReferencePreviewMode = Boolean(preview && isReferencePreviewRequest());
        const preparationPromises = [];
        window.dispatchEvent(new CustomEvent('onboarding:before-start', {
            detail: {
                tourId: tour.tourId || '',
                preview: Boolean(preview),
                referencePreview: activeReferencePreviewMode,
                waitUntil(promise) {
                    if (promise && typeof promise.then === 'function') {
                        preparationPromises.push(promise);
                    }
                },
            },
        }));
        await waitForStepPreparation(preparationPromises, tour);
        const firstStepIndex = clamp(Number(initialStep) || 0, 0, tour.steps.length - 1);
        await showStep(firstStepIndex);
        return true;
    }

    function getPreviewTourId() {
        const params = new URLSearchParams(window.location.search || '');
        return params.get('onboarding_preview') || params.get('onboarding_tour') || '';
    }

    async function autoStart() {
        const previewTourId = getPreviewTourId();
        if (previewTourId) {
            window.setTimeout(() => {
                if (isBlockingModalOpen()) return;
                void startTour(previewTourId, { force: true, preview: true, initialStep: getPreviewStepIndex() });
            }, 600);
            return;
        }

        if (window.ACTRA_DISABLE_AUTO_ONBOARDING) {
            return;
        }

        const tour = findTourForRoute(window.location.pathname);
        if (!tour) return;
        const settings = await loadRemoteSettings();
        if (isOnboardingDisabled(settings)) return;
        const seen = await getSeenState();
        if (Number(seen[tour.tourId]) >= Number(tour.version || 1)) return;

        if (shouldOfferFirstRunOnboardingChoice(tour, seen)) {
            window.setTimeout(() => {
                if (isBlockingModalOpen()) return;
                showFirstRunChoiceModal(tour);
            }, Number(tour.autoStartDelay || 1000));
            return;
        }

        window.setTimeout(() => {
            if (isBlockingModalOpen()) return;
            void startTour(tour.tourId);
        }, Number(tour.autoStartDelay || 1000));
    }

    function init() {
        if (isInitialized) return;
        isInitialized = true;
        bindEvents();
        updateHelpButtons();
        window.setTimeout(updateHelpButtons, 0);
        window.setTimeout(updateHelpButtons, 800);
        void autoStart();
    }

    window.OnboardingTour = {
        init,
        start: (tourId, options = {}) => startTour(tourId, { ...options, force: true }),
        startIfUnseen: (tourId, options = {}) => startTour(tourId, { ...options, force: false }),
        refreshHelpButtons: updateHelpButtons,
        getSettings: loadRemoteSettings,
        findTour: findTourById,
        findTourForRoute,
        finish: finishTour,
        setStepVariant: (variant) => {
            if (!activeTour?.steps?.[activeStepIndex]) return false;
            const normalized = String(variant || '').trim();
            activeStepVariant = normalized;
            setBodyStepVariant(normalized);
            const step = activeTour.steps[activeStepIndex];
            const nodes = findStepTargets(step);
            if (nodes.length) {
                setTargets(nodes, { preserveControl: true });
            }
            renderStep(step);
            positionActiveOverlays(step);
            revealElements(getLayerElements({ includeControl: false }));
            window.requestAnimationFrame(() => positionActiveOverlays(step));
            return true;
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
