const THEORY_EDITOR_ROUTE = "/ui/editor/Theory_Editor.html";
const THEORY_CENTER_ROUTE = "/ui/editor/Theory_Center.html";
const EMPTY_THEORY_DELTA = { ops: [{ insert: "\n" }] };
const THEORY_DEFAULT_TEXT_COLOR_FALLBACK = "#1A1A1A";
const THEORY_DRAFT_STORAGE_PREFIX = "theory-editor-draft:";
const THEORY_EDITOR_ONBOARDING_TOUR_ID = "theory-editor-authoring";

const theoryEditorState = {
    catalog: [],
    activeTheoryId: "",
    activeItem: null,
    version: null,
    dirty: false,
    loading: false,
    saving: false,
    search: "",
    context: null,
    publicationItem: null,
    workspaceLimits: null,
};

let theoryDraftSaveTimer = 0;
let theoryReloadConfirmPending = false;
let currentTheoryEditorUserId = "";
let lastTheoryEditorRange = null;
const theoryPublicationBySourceId = new Map();
const theoryPublicationByItemId = new Map();
let allTheoryPublicationItems = [];
let theorySkipBeforeUnloadPrompt = false;
let theoryHistoryGuardToken = "";
let theoryHistoryGuardPromptOpen = false;
let theoryHistoryGuardDisabled = false;
let theoryEditorOnboardingSnapshot = null;
let theoryEditorOnboardingImageVariantActive = false;
let theoryEditorOnboardingImageMarkerEventsBound = false;
let theoryEditorOnboardingImageMarkerTimer = 0;

function getTheoryEditorOnboardingPreviewTourId() {
    try {
        const params = new URLSearchParams(window.location.search || "");
        return params.get("onboarding_preview") || params.get("onboarding_tour") || "";
    } catch (error) {
        return "";
    }
}

function getTheoryEditorDemoStateId() {
    try {
        const params = new URLSearchParams(window.location.search || "");
        return params.get("demo_state") || getTheoryEditorOnboardingPreviewTourId();
    } catch (error) {
        return getTheoryEditorOnboardingPreviewTourId();
    }
}

function isTheoryEditorOnboardingDemoRequested() {
    return getTheoryEditorDemoStateId() === THEORY_EDITOR_ONBOARDING_TOUR_ID;
}

function isTheoryEditorOnboardingTourActive() {
    return document.body?.dataset?.onboardingTourId === THEORY_EDITOR_ONBOARDING_TOUR_ID;
}

function createTheoryEditorOnboardingImageSrc() {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="720" height="320" viewBox="0 0 720 320">
            <rect width="720" height="320" rx="28" fill="#eef4ff"/>
            <path d="M72 238c86-82 142-124 210-90 30 15 48 44 88 42 58-2 84-66 138-70 46-4 82 32 140 118" fill="none" stroke="#32208a" stroke-width="18" stroke-linecap="round"/>
            <circle cx="560" cy="92" r="38" fill="#b8c7ff"/>
            <text x="72" y="86" fill="#17213a" font-family="Arial, sans-serif" font-size="34" font-weight="700">Схема распространения волны</text>
        </svg>
    `.trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createTheoryEditorOnboardingDelta() {
    return {
        ops: [
            { insert: "Электромагнитная волна\n", attributes: { header: 1 } },
            { insert: "Волна переносит энергию через связанные электрическое и магнитное поля. В задачах важно видеть три параметра: частоту, длину волны и поляризацию.\n" },
            {
                insert: { image: createTheoryEditorOnboardingImageSrc() },
                attributes: { width: "56%", align: "center", float: "none" },
            },
            { insert: "\n" },
            { insert: "Что запомнить\n", attributes: { header: 2 } },
            { insert: "частота показывает, сколько колебаний происходит за секунду;" },
            { insert: "\n", attributes: { list: "bullet" } },
            { insert: "длина волны связана со скоростью распространения;" },
            { insert: "\n", attributes: { list: "bullet" } },
            { insert: "поляризация описывает направление колебаний поля." },
            { insert: "\n", attributes: { list: "bullet" } },
        ],
    };
}

function createTheoryEditorOnboardingCatalog() {
    const now = new Date().toISOString();
    return [
        {
            id: "theory-radio-wave-basics",
            title: "Радиофизика: электромагнитные волны",
            version: now,
            updated_at: now,
            has_content: true,
            image_count: 0,
            usage_topics: 2,
            usage_complexes: 1,
            ownership: { is_owned_by_current_user: true, owner_user_id: "demo-user" },
        },
        {
            id: "theory-signal-noise",
            title: "Шум и отношение сигнал/шум",
            version: now,
            updated_at: now,
            has_content: false,
            image_count: 0,
            usage_topics: 0,
            usage_complexes: 0,
            ownership: { is_owned_by_current_user: true, owner_user_id: "demo-user" },
        },
    ];
}

function applyTheoryEditorOnboardingDemoState() {
    if (!theoryEditorOnboardingSnapshot) {
        theoryEditorOnboardingSnapshot = {
            catalog: theoryEditorState.catalog.slice(),
            activeTheoryId: theoryEditorState.activeTheoryId,
            activeItem: theoryEditorState.activeItem,
            version: theoryEditorState.version,
            dirty: theoryEditorState.dirty,
            loading: theoryEditorState.loading,
            saving: theoryEditorState.saving,
            search: theoryEditorState.search,
            context: theoryEditorState.context,
            publicationItem: theoryEditorState.publicationItem,
            workspaceLimits: theoryEditorState.workspaceLimits,
            currentTheoryEditorUserId,
            publicationItems: allTheoryPublicationItems.slice(),
            title: document.getElementById("theory-title")?.value || "",
            editorHtml: document.getElementById("theory-editor")?.innerHTML || "",
            documentTitle: document.title,
        };
    }

    const catalog = createTheoryEditorOnboardingCatalog();
    theoryEditorState.catalog = catalog;
    theoryEditorState.activeTheoryId = catalog[0].id;
    theoryEditorState.activeItem = catalog[0];
    theoryEditorState.version = catalog[0].version;
    theoryEditorState.dirty = false;
    theoryEditorState.loading = false;
    theoryEditorState.saving = false;
    theoryEditorState.search = "";
    theoryEditorState.context = {
        ...(theoryEditorState.context || {}),
        returnUrl: THEORY_CENTER_ROUTE,
    };
    theoryEditorState.workspaceLimits = {
        ok: true,
        plan: "premium",
        theories: {
            personal_count: 2,
            personal_limit: 50,
            library_total_count: 2,
            library_limit: 200,
        },
    };
    currentTheoryEditorUserId = "demo-user";
    allTheoryPublicationItems = [];
    theoryPublicationBySourceId.clear();
    theoryPublicationByItemId.clear();
    theoryEditorState.publicationItem = null;

    const search = document.getElementById("theory-library-search");
    if (search) search.value = "";
    setTheoryEditorContent(catalog[0].title, createTheoryEditorOnboardingDelta());
    setTheoryStatus("Демо-теория готова к редактированию", "info", "edit_note");
    renderTheoryContextHeader();
    updateTheoryEditorActions();
    renderTheoryLibraryList();
    syncTheoryEditorOnboardingStepState();
    document.title = "Редактор теории";
}

function restoreTheoryEditorOnboardingDemoState() {
    if (!theoryEditorOnboardingSnapshot) return;
    const snapshot = theoryEditorOnboardingSnapshot;
    theoryEditorOnboardingSnapshot = null;
    deselectImage();
    theoryEditorState.catalog = snapshot.catalog;
    theoryEditorState.activeTheoryId = snapshot.activeTheoryId;
    theoryEditorState.activeItem = snapshot.activeItem;
    theoryEditorState.version = snapshot.version;
    theoryEditorState.dirty = snapshot.dirty;
    theoryEditorState.loading = snapshot.loading;
    theoryEditorState.saving = snapshot.saving;
    theoryEditorState.search = snapshot.search;
    theoryEditorState.context = snapshot.context;
    theoryEditorState.publicationItem = snapshot.publicationItem;
    theoryEditorState.workspaceLimits = snapshot.workspaceLimits;
    currentTheoryEditorUserId = snapshot.currentTheoryEditorUserId;
    allTheoryPublicationItems = snapshot.publicationItems;
    rebuildTheoryPublicationIndex(allTheoryPublicationItems);
    const titleEl = document.getElementById("theory-title");
    if (titleEl) titleEl.value = snapshot.title;
    const editor = document.getElementById("theory-editor");
    if (editor) editor.innerHTML = snapshot.editorHtml;
    document.title = snapshot.documentTitle;
    renderTheoryContextHeader();
    updateTheoryEditorActions();
    renderTheoryLibraryList();
}

function syncTheoryEditorOnboardingStepState() {
    const editor = document.getElementById("theory-editor");
    if (!editor) return;
    const image = editor.querySelector(".theory-image");
    const wrapper = image?.closest(".theory-image-wrapper");
    if (image) {
        image.setAttribute("data-onboarding-target", "theory-editor-selected-image");
    }
    if (wrapper) {
        wrapper.setAttribute("data-onboarding-target", "theory-editor-selected-image-wrapper");
    }
    const activeStepId = document.body?.dataset?.onboardingStepId || "";
    if (activeStepId === "theory-editor-body-and-text-tools" && image) {
        if (theoryEditorOnboardingImageVariantActive) {
            removeTheoryEditorOnboardingImageMarker();
            selectImage(image);
            return;
        }
        deselectImage();
        removeTheoryEditorOnboardingImageMarker();
        return;
    }
    theoryEditorOnboardingImageVariantActive = false;
    delete document.body.dataset.onboardingImageVariant;
    removeTheoryEditorOnboardingImageMarker();
    if (activeStepId === "theory-editor-image-tools" && image) {
        selectImage(image);
        return;
    }
    deselectImage();
}

function removeTheoryEditorOnboardingImageMarker() {
    window.clearTimeout(theoryEditorOnboardingImageMarkerTimer);
    theoryEditorOnboardingImageMarkerTimer = 0;
    document.querySelectorAll(".theory-onboarding-image-marker").forEach((node) => node.remove());
}

function scheduleTheoryEditorOnboardingImageMarker(delayMs = 260) {
    window.clearTimeout(theoryEditorOnboardingImageMarkerTimer);
    theoryEditorOnboardingImageMarkerTimer = window.setTimeout(() => {
        theoryEditorOnboardingImageMarkerTimer = 0;
        if (
            document.body?.dataset?.onboardingTourId !== THEORY_EDITOR_ONBOARDING_TOUR_ID
            || document.body?.dataset?.onboardingStepId !== "theory-editor-body-and-text-tools"
            || theoryEditorOnboardingImageVariantActive
        ) {
            return;
        }
        const image = document.querySelector("#theory-editor .theory-image");
        const wrapper = image?.closest(".theory-image-wrapper");
        if (!image || !wrapper) return;
        deselectImage();
        ensureTheoryEditorOnboardingImageMarker(wrapper);
    }, delayMs);
}

function positionTheoryEditorOnboardingImageMarker() {
    const marker = document.querySelector(".theory-onboarding-image-marker");
    const wrapper = marker?.__theoryOnboardingImageWrapper;
    if (!marker || !wrapper?.isConnected) return false;

    const image = wrapper.querySelector(".theory-image");
    const rect = (image || wrapper).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        marker.classList.remove("is-positioned", "is-visible");
        return false;
    }
    const markerSize = marker.offsetWidth || 40;
    const margin = 12;
    const insetX = Math.max(18, rect.width * 0.06);
    const insetY = Math.max(18, rect.height * 0.14);
    const left = Math.max(margin, Math.min(window.innerWidth - markerSize - margin, rect.right - markerSize - insetX));
    const top = Math.max(margin, Math.min(window.innerHeight - markerSize - margin, rect.top + insetY));
    marker.style.left = `${left}px`;
    marker.style.top = `${top}px`;
    marker.classList.add("is-positioned");
    return true;
}

function bindTheoryEditorOnboardingImageMarkerEvents() {
    if (theoryEditorOnboardingImageMarkerEventsBound) return;
    theoryEditorOnboardingImageMarkerEventsBound = true;
    window.addEventListener("scroll", positionTheoryEditorOnboardingImageMarker, { passive: true });
    window.addEventListener("resize", positionTheoryEditorOnboardingImageMarker);
}

function applyTheoryEditorOnboardingImageVariant(attempt = 0) {
    if (document.body?.dataset?.onboardingStepId !== "theory-editor-body-and-text-tools") return;
    const applied = Boolean(
        window.OnboardingTour
        && typeof window.OnboardingTour.setStepVariant === "function"
        && window.OnboardingTour.setStepVariant("image-tools")
    );
    const hasImageCallouts = document.querySelectorAll(".onboarding-tour-callout").length > 0;
    if ((!applied || !hasImageCallouts) && attempt < 6) {
        window.setTimeout(() => applyTheoryEditorOnboardingImageVariant(attempt + 1), 120);
    }
}

function ensureTheoryEditorOnboardingImageMarker(wrapper) {
    if (!wrapper) return;
    const existing = document.querySelector(".theory-onboarding-image-marker");
    if (existing && existing.__theoryOnboardingImageWrapper === wrapper) {
        positionTheoryEditorOnboardingImageMarker();
        return;
    }
    removeTheoryEditorOnboardingImageMarker();

    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "theory-onboarding-image-marker";
    marker.setAttribute("aria-label", "Показать инструменты изображения");
    marker.setAttribute("title", "Показать инструменты изображения");
    marker.setAttribute("contenteditable", "false");
    marker.setAttribute("data-onboarding-interactive", "image-tools-marker");
    marker.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">priority_high</span>';
    marker.__theoryOnboardingImageWrapper = wrapper;
    marker.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const currentWrapper = marker.__theoryOnboardingImageWrapper;
        const image = currentWrapper?.querySelector(".theory-image");
        if (!image) return;
        theoryEditorOnboardingImageVariantActive = true;
        document.body.dataset.onboardingImageVariant = "image-tools";
        removeTheoryEditorOnboardingImageMarker();
        selectImage(image);
        applyTheoryEditorOnboardingImageVariant();
    });
    document.body.appendChild(marker);
    bindTheoryEditorOnboardingImageMarkerEvents();
    positionTheoryEditorOnboardingImageMarker();
    window.requestAnimationFrame(positionTheoryEditorOnboardingImageMarker);
    window.requestAnimationFrame(() => {
        if (positionTheoryEditorOnboardingImageMarker()) {
            marker.classList.add("is-visible");
        }
    });
    window.setTimeout(positionTheoryEditorOnboardingImageMarker, 180);
    window.setTimeout(positionTheoryEditorOnboardingImageMarker, 420);
}

function bindTheoryEditorOnboardingStepReady() {
    window.addEventListener("onboarding:step-ready", (event) => {
        const detail = event?.detail || {};
        if (detail.tourId !== THEORY_EDITOR_ONBOARDING_TOUR_ID) return;
        if (detail.stepId === "theory-editor-body-and-text-tools") {
            scheduleTheoryEditorOnboardingImageMarker();
            return;
        }
        removeTheoryEditorOnboardingImageMarker();
    });
}

function syncTheoryEditorOnboardingDemoState() {
    if (isTheoryEditorOnboardingDemoRequested() || isTheoryEditorOnboardingTourActive()) {
        applyTheoryEditorOnboardingDemoState();
        syncTheoryEditorOnboardingStepState();
        return;
    }
    restoreTheoryEditorOnboardingDemoState();
}

function bindTheoryEditorOnboardingDemoObserver() {
    if (!document.body || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => syncTheoryEditorOnboardingDemoState());
    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-onboarding-tour-id", "data-onboarding-step-id"],
    });
    bindTheoryEditorOnboardingStepReady();
}

function theoryEditorNavigate(url) {
    theorySkipBeforeUnloadPrompt = true;
    theoryHistoryGuardDisabled = true;
    if (typeof window.navigateWithTransition === "function") {
        window.navigateWithTransition(url);
        return;
    }
    window.location.href = url;
}

function theoryEditorToast(message, severity = "info", duration = 2400) {
    if (typeof window.NotificationUI !== "undefined" && typeof window.NotificationUI.toast === "function") {
        window.NotificationUI.toast(message, severity, duration);
        return;
    }
    if (severity === "error") {
        console.error(message);
        return;
    }
    console.log(message);
}

async function theoryEditorConfirm(options) {
    const fallbackMessage = String(options?.message || "Подтвердите действие.").trim();
    if (typeof window.NotificationUI !== "undefined" && typeof window.NotificationUI.confirm === "function") {
        return window.NotificationUI.confirm({
            title: String(options?.title || "Подтвердите действие"),
            message: fallbackMessage,
            confirmText: String(options?.confirmText || "Продолжить"),
            cancelText: String(options?.cancelText || "Отмена"),
            variant: String(options?.variant || "warning"),
        });
    }
    if (window.WorkspaceImportClient && typeof window.WorkspaceImportClient.confirmAction === "function") {
        return window.WorkspaceImportClient.confirmAction({
            title: String(options?.title || "Подтвердите действие"),
            message: fallbackMessage,
            confirmText: String(options?.confirmText || "Продолжить"),
            cancelText: String(options?.cancelText || "Отмена"),
            variant: String(options?.variant || "warning"),
        });
    }
    return Promise.resolve(false);
}

function normalizeTheoryWorkspaceUrl(rawUrl, fallbackTheoryId = "") {
    const raw = String(rawUrl || "").trim();
    if (!raw) {
        return "";
    }

    try {
        const parsed = new URL(raw, window.location.origin);
        const params = parsed.searchParams;
        const isLegacyHub = String(params.get("theory_hub") || "").trim() === "1";
        if (!isLegacyHub) {
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }

        const theoryId = String(params.get("theory_id") || fallbackTheoryId || "").trim();
        const next = new URL(THEORY_CENTER_ROUTE, window.location.origin);
        next.searchParams.set("scope", "complexes");
        return `${next.pathname}${next.search}`;
    } catch (error) {
        if (raw.includes("theory_hub=1")) {
            return `${THEORY_CENTER_ROUTE}?scope=complexes`;
        }
        return raw;
    }
}

function parseTheoryEditorContext() {
    const params = new URLSearchParams(window.location.search || "");
    const theoryId = String(params.get("theory_id") || "").trim();
    const context = String(params.get("context") || "").trim();
    const returnUrl = normalizeTheoryWorkspaceUrl(String(params.get("return_url") || "").trim(), theoryId)
        || "/ui/editor";

    return {
        theoryId,
        context,
        returnUrl,
        moduleId: String(params.get("module_id") || "").trim(),
        topicId: String(params.get("topic_id") || "").trim(),
        moduleName: String(params.get("module_name") || "").trim(),
        topicName: String(params.get("topic_name") || "").trim(),
        complexId: String(params.get("complex_id") || "").trim(),
        complexName: String(params.get("complex_name") || "").trim(),
    };
}

function buildTheoryEditorUrl(theoryId, overrides = {}) {
    const baseContext = theoryEditorState.context || {};
    const merged = { ...baseContext, ...overrides };
    const next = new URL(THEORY_EDITOR_ROUTE, window.location.origin);
    const normalizedTheoryId = String(theoryId || "").trim();

    if (normalizedTheoryId) {
        next.searchParams.set("theory_id", normalizedTheoryId);
    }

    const mapping = {
        context: "context",
        moduleId: "module_id",
        topicId: "topic_id",
        moduleName: "module_name",
        topicName: "topic_name",
        complexId: "complex_id",
        complexName: "complex_name",
        returnUrl: "return_url",
    };

    Object.entries(mapping).forEach(([sourceKey, targetKey]) => {
        const rawValue = merged[sourceKey];
        const value = String(rawValue || "").trim();
        if (!value) {
            return;
        }
        next.searchParams.set(targetKey, sourceKey === "returnUrl"
            ? normalizeTheoryWorkspaceUrl(value, normalizedTheoryId)
            : value);
    });

    return `${next.pathname}${next.search}`;
}

function updateTheoryEditorUrl() {
    const nextUrl = buildTheoryEditorUrl(theoryEditorState.activeTheoryId);
    window.history.replaceState(null, "", nextUrl);
}

function setTheoryStatus(message, tone = "muted", icon = "notes") {
    const pill = document.getElementById("theory-status-pill");
    if (!pill) {
        return;
    }
    pill.dataset.tone = tone;
    pill.innerHTML = `
        <span class="material-symbols-outlined text-[16px]">${icon}</span>
        ${escapeTheoryHtml(message || "Готово")}
    `;
}

function createTheoryContextChip(icon, label) {
    const chip = document.createElement("span");
    chip.className = "theory-chip pill pill-sm pill-neutral";
    chip.innerHTML = `
        <span class="material-symbols-outlined text-[15px]">${escapeTheoryHtml(icon)}</span>
        ${escapeTheoryHtml(label)}
    `;
    return chip;
}

function resolveTheoryCenterScope() {
    const context = theoryEditorState.context || {};
    if (context.context === "complex" || context.complexId) {
        return "complexes";
    }
    if (context.context === "topic" || context.topicId) {
        return "topics";
    }
    return "";
}

function resolveTheoryCenterUrl() {
    const url = new URL(THEORY_CENTER_ROUTE, window.location.origin);
    const scope = resolveTheoryCenterScope();
    if (scope) {
        url.searchParams.set("scope", scope);
    }
    return `${url.pathname}${url.search}`;
}

function resolveTheoryComplexesUrl() {
    return "/ui/complexes";
}

function getTheoryDraftScopeId(theoryId = "") {
    const normalizedTheoryId = String(
        theoryId
        || theoryEditorState.activeTheoryId
        || theoryEditorState.context?.theoryId
        || ""
    ).trim();
    if (normalizedTheoryId) {
        return `theory:${normalizedTheoryId}`;
    }

    const context = theoryEditorState.context || {};
    return [
        "new",
        String(context.context || "standalone").trim() || "standalone",
        String(context.moduleId || "").trim(),
        String(context.topicId || "").trim(),
        String(context.complexId || "").trim(),
    ].join(":");
}

function getTheoryDraftKey(theoryId = "") {
    return `${THEORY_DRAFT_STORAGE_PREFIX}${getTheoryDraftScopeId(theoryId)}`;
}

function clearTheoryDraftByKey(draftKey = "") {
    const normalizedKey = String(draftKey || "").trim();
    if (!normalizedKey) {
        return;
    }
    try {
        window.sessionStorage?.removeItem(normalizedKey);
    } catch (error) {
        console.warn("[Theory Editor] Failed to clear draft", error);
    }
}

function clearTheoryDraft(theoryId = "") {
    clearTheoryDraftByKey(getTheoryDraftKey(theoryId));
}

function readTheoryDraft(theoryId = "") {
    try {
        const raw = window.sessionStorage?.getItem(getTheoryDraftKey(theoryId));
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        return {
            title: String(parsed.title || "").trim(),
            delta: parsed.delta && typeof parsed.delta === "object" ? parsed.delta : EMPTY_THEORY_DELTA,
            savedAt: String(parsed.savedAt || "").trim(),
        };
    } catch (error) {
        console.warn("[Theory Editor] Failed to read draft", error);
        return null;
    }
}

function saveTheoryDraftNow() {
    if (!theoryEditorState.dirty) {
        return;
    }

    const draftKey = getTheoryDraftKey();
    const titleEl = document.getElementById("theory-title");
    if (!draftKey || !titleEl) {
        return;
    }

    try {
        window.sessionStorage?.setItem(draftKey, JSON.stringify({
            title: String(titleEl.value || "").trim(),
            delta: editorHtmlToTheoryDelta(),
            savedAt: new Date().toISOString(),
        }));
    } catch (error) {
        console.warn("[Theory Editor] Failed to save draft", error);
    }
}

function scheduleTheoryDraftSave() {
    window.clearTimeout(theoryDraftSaveTimer);
    if (!theoryEditorState.dirty) {
        return;
    }
    theoryDraftSaveTimer = window.setTimeout(() => {
        saveTheoryDraftNow();
    }, 220);
}

function isTheoryDraftEqualToCurrent(draft) {
    if (!draft) {
        return true;
    }
    const titleEl = document.getElementById("theory-title");
    const currentTitle = titleEl ? String(titleEl.value || "").trim() : "";
    const currentDelta = editorHtmlToTheoryDelta();
    return draft.title === currentTitle
        && JSON.stringify(draft.delta || EMPTY_THEORY_DELTA) === JSON.stringify(currentDelta);
}

async function restoreTheoryDraftIfPresent(theoryId = "") {
    const draft = readTheoryDraft(theoryId);
    if (!draft) {
        return false;
    }

    if (isTheoryDraftEqualToCurrent(draft)) {
        clearTheoryDraft(theoryId);
        return false;
    }

    const savedAtLabel = draft.savedAt ? formatTheoryListDate(draft.savedAt) : "несколько минут назад";
    const shouldRestore = await theoryEditorConfirm({
        title: "Найден несохранённый черновик",
        message: `На этой странице остался черновик от ${savedAtLabel}. Восстановить его вместо текущего содержимого?`,
        confirmText: "Восстановить",
        cancelText: "Оставить текущее",
        variant: "info",
    });

    if (!shouldRestore) {
        clearTheoryDraft(theoryId);
        return false;
    }

    setTheoryEditorContent(draft.title, draft.delta || EMPTY_THEORY_DELTA);
    theoryEditorState.dirty = true;
    updateTheoryEditorActions();
    setTheoryStatus("Черновик восстановлен. Проверьте изменения и сохраните теорию.", "warning", "history");
    theoryEditorToast("Черновик восстановлен", "info", 2400);
    scheduleTheoryDraftSave();
    return true;
}

function getTheoryDefaultTextColor() {
    if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
        return THEORY_DEFAULT_TEXT_COLOR_FALLBACK;
    }

    const editor = document.getElementById("theory-editor");
    if (editor) {
        const editorColor = window.getComputedStyle(editor).color;
        if (String(editorColor || "").trim()) {
            return editorColor;
        }
    }

    const rootColor = window.getComputedStyle(document.documentElement).getPropertyValue("--color-text-main");
    if (String(rootColor || "").trim()) {
        return rootColor.trim();
    }

    return THEORY_DEFAULT_TEXT_COLOR_FALLBACK;
}

function setTheoryColorIndicator(color = "") {
    const indicator = document.getElementById("theory-color-indicator");
    if (!indicator) {
        return;
    }
    const nextColor = String(color || "").trim() || getTheoryDefaultTextColor();
    indicator.style.background = nextColor;
}

function renderTheoryContextHeader() {
    const copyEl = document.getElementById("theory-context-copy");
    const backBtn = document.getElementById("theory-back-btn");
    const backLabel = document.getElementById("theory-back-btn-label");
    const centerBtn = document.getElementById("theory-open-center-btn");
    const openComplexesBtn = document.getElementById("theory-open-complexes-btn");
    const context = theoryEditorState.context || {};

    if (centerBtn) {
        centerBtn.disabled = false;
    }

    if (openComplexesBtn) {
        openComplexesBtn.disabled = false;
        openComplexesBtn.dataset.target = resolveTheoryComplexesUrl();
    }

    if (copyEl) {
        if (context.context === "topic") {
            const topicLabel = [context.moduleName || context.moduleId, context.topicName || context.topicId]
                .filter(Boolean)
                .join(" / ");
            copyEl.textContent = topicLabel
                ? `Вы редактируете материал, который выбран для темы ${topicLabel}.`
                : "Вы редактируете материал, который выбран для одной из тем.";
        } else if (context.context === "complex") {
            const complexLabel = context.complexName || context.complexId || "текущего комплекса";
            copyEl.textContent = `Вы редактируете материал, который связан с ${complexLabel}.`;
        } else {
            copyEl.textContent = "Материалы: текст, структура и изображения теории.";
        }
    }

    if (backBtn && backLabel) {
        const returnUrl = normalizeTheoryWorkspaceUrl(context.returnUrl, theoryEditorState.activeTheoryId) || THEORY_CENTER_ROUTE;
        const isCenterReturn = returnUrl.includes("Theory_Center");
        backBtn.dataset.target = returnUrl;
        backBtn.hidden = isCenterReturn;
        backBtn.classList.toggle("hidden", isCenterReturn);
        if (isCenterReturn) {
            backLabel.textContent = "К центру теории";
        } else if (returnUrl.includes("/ui/editor")) {
            backLabel.textContent = "К редактору заданий";
        } else {
            backLabel.textContent = "Назад";
        }
    }

    renderTheoryQuotaUi();
}

function theoryLocalImageSrc(path) {
    if (!path) return "";
    if (path.startsWith('data:')) return path;
    if (path.startsWith('/api/local-image') || path.startsWith('/api/assets/')) return path;
    return `/api/local-image?path=${encodeURIComponent(path)}`;
}

function isTheoryHostedAssetRef(value) {
    return String(value || "").trim().startsWith("/api/assets/");
}

async function theoryReadJsonSafely(response) {
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

async function fetchTheoryWorkspaceLimits() {
    try {
        const response = await fetch("/api/workspace-limits/summary");
        const data = await theoryReadJsonSafely(response);
        if (!response.ok || !data?.ok) {
            throw new Error(data?.error || `http_${response.status}`);
        }
        theoryEditorState.workspaceLimits = data;
        return data;
    } catch (error) {
        console.warn("[Theory Editor] Failed to load workspace limits", error);
        theoryEditorState.workspaceLimits = null;
        return null;
    } finally {
        renderTheoryQuotaUi();
    }
}

function getTheoryWorkspaceLimitSummary() {
    const summary = theoryEditorState.workspaceLimits;
    return summary && typeof summary.theories === "object" ? summary.theories : null;
}

function isTheoryEditorPremiumPlan() {
    return String(theoryEditorState.workspaceLimits?.plan || "").trim().toLowerCase() === "premium";
}

function getTheoryLimitMessage(summary = getTheoryWorkspaceLimitSummary()) {
    if (!summary) {
        return "";
    }
    const personalCount = Number(summary.personal_count || 0);
    const personalLimit = Number(summary.personal_limit || 0);
    const libraryCount = Number(summary.library_total_count || 0);
    const libraryLimit = Number(summary.library_limit || 0);
    if (isTheoryEditorPremiumPlan()) {
        return "";
    }
    if (Number(summary.remaining_personal || 0) <= 0 && Number(summary.remaining_library || 0) <= 0) {
        return `Лимит теорий достигнут: свои ${personalCount}/${personalLimit}, библиотека ${libraryCount}/${libraryLimit}. Удалите лишнее или перейдите на Premium.`;
    }
    if (Number(summary.remaining_personal || 0) <= 0) {
        return `Лимит своих теорий достигнут: ${personalCount}/${personalLimit}. Удалите одну из личных теорий или перейдите на Premium.`;
    }
    if (Number(summary.remaining_library || 0) <= 0) {
        return `Библиотека теорий заполнена: ${libraryCount}/${libraryLimit}. Удалите лишнюю теорию или перейдите на Premium.`;
    }
    return "";
}

function isTheoryCreationBlocked() {
    if (String(theoryEditorState.activeTheoryId || "").trim()) {
        return false;
    }
    const summary = getTheoryWorkspaceLimitSummary();
    if (!summary || isTheoryEditorPremiumPlan()) {
        return false;
    }
    return Number(summary.remaining_personal || 0) <= 0 || Number(summary.remaining_library || 0) <= 0;
}

function renderTheoryQuotaUi() {
    const pill = document.getElementById("theory-quota-pill");
    const banner = document.getElementById("theory-limit-banner");
    const summary = getTheoryWorkspaceLimitSummary();
    const isPremium = isTheoryEditorPremiumPlan();
    const blocked = isTheoryCreationBlocked();

    if (pill) {
        if (!summary) {
            pill.hidden = true;
            pill.textContent = "";
        } else if (isPremium) {
            pill.className = "theory-chip theory-chip--primary";
            pill.hidden = false;
            pill.innerHTML = '<span class="material-symbols-outlined text-[16px]">workspace_premium</span> Premium · без лимита';
        } else {
            const toneClass = blocked ? "theory-chip" : "theory-chip theory-chip--primary";
            pill.className = toneClass;
            pill.hidden = false;
            pill.innerHTML = `<span class="material-symbols-outlined text-[16px]">inventory_2</span> Мои теории ${Number(summary.personal_count || 0)}/${Number(summary.personal_limit || 0)} · Библиотека ${Number(summary.library_total_count || 0)}/${Number(summary.library_limit || 0)}`;
        }
    }

    if (banner) {
        const message = blocked ? getTheoryLimitMessage(summary) : "";
        banner.hidden = !message;
        banner.textContent = message;
    }
}

async function resolveCurrentTheoryEditorUserId(forceRefresh = false) {
    if (!forceRefresh && currentTheoryEditorUserId) {
        return currentTheoryEditorUserId;
    }
    currentTheoryEditorUserId = "";
    try {
        const response = await fetch("/api/auth/me");
        const data = await theoryReadJsonSafely(response);
        const userId = String(data?.user?.user_id || "").trim();
        if (response.ok && data?.ok && data?.authenticated && userId) {
            currentTheoryEditorUserId = userId;
        }
    } catch (error) {
        console.warn("[Theory Editor] Failed to resolve current user", error);
    }
    return currentTheoryEditorUserId;
}

function getCatalogVisibilityLabel(value) {
    switch (String(value || "").trim().toLowerCase()) {
        case "access_code":
            return "По коду";
        case "private":
            return "Приватная";
        case "public":
        default:
            return "Общий доступ";
    }
}

function getCatalogVisibilityTone(value) {
    switch (String(value || "").trim().toLowerCase()) {
        case "access_code":
            return "info";
        case "private":
            return "muted";
        case "public":
        default:
            return "success";
    }
}

function getTheoryCatalogVisibilityDescription(value) {
    switch (String(value || "").trim().toLowerCase()) {
        case "access_code":
            return "Теория не видна в общем каталоге. Добавить её можно только по коду доступа.";
        case "private":
            return "Теория доступна только вам. Другие пользователи не увидят её в каталоге и не смогут открыть по коду.";
        case "public":
        default:
            return "Теория видна в общем каталоге и доступна для добавления в библиотеку.";
    }
}

function getTheoryVisibilityLock(item) {
    const lock = item?.visibility_lock && typeof item.visibility_lock === "object" ? item.visibility_lock : null;
    if (!lock) return null;
    return String(lock.forced_visibility || "").trim().toLowerCase() === "public" ? lock : null;
}

function formatTheoryVisibilityLockMessage(lock) {
    const complexTitles = Array.isArray(lock?.complex_titles)
        ? lock.complex_titles.filter((value) => String(value || "").trim())
        : [];
    if (complexTitles.length === 1) {
        return `Теория привязана к публичному комплексу «${complexTitles[0]}», поэтому должна оставаться в общем доступе.`;
    }
    if (complexTitles.length > 1) {
        return "Теория привязана к нескольким публичным комплексам, поэтому должна оставаться в общем доступе.";
    }
    return "Теория привязана к опубликованному для всех комплексу, поэтому должна оставаться в общем доступе.";
}

function getTheoryPublicationErrorMessage(error, fallback = "") {
    const message = String(error?.message || error || "").trim();
    if (message.includes("theory_catalog_visibility_locked_by_public_complex")) {
        return "Теория привязана к опубликованному для всех комплексу. Сначала измените публикацию комплекса.";
    }
    return message || fallback;
}

function formatTheoryPublicationTimestamp(value) {
    const raw = String(value || "").trim();
    if (!raw) return "ещё не публиковалась";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function getTheoryAccessCodeValue(item) {
    return String(item?.access_code || item?.payload?.access_code || "").trim();
}

function formatTheoryAccessCodeDisplay(value) {
    const code = String(value || "").trim().replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
    if (!code) return "";
    return code.match(/.{1,4}/g)?.join("-") || code;
}

function rebuildTheoryPublicationIndex(items) {
    theoryPublicationBySourceId.clear();
    theoryPublicationByItemId.clear();
    const normalizedItems = Array.isArray(items) ? items : [];
    normalizedItems.forEach((item) => {
        const itemId = String(item?.item_id || "").trim();
        const sourceId = String(item?.source_workspace_id || item?.source_workspace_ref || "").trim();
        if (itemId) theoryPublicationByItemId.set(itemId, item);
        if (sourceId) theoryPublicationBySourceId.set(sourceId, item);
    });
    allTheoryPublicationItems = normalizedItems;
}

function upsertTheoryPublicationItem(item) {
    const itemId = String(item?.item_id || "").trim();
    rebuildTheoryPublicationIndex(
        allTheoryPublicationItems
            .filter((entry) => String(entry?.item_id || "").trim() !== itemId)
            .concat(item ? [item] : [])
    );
    theoryEditorState.publicationItem = item || null;
    updateTheoryPublicationControls();
}

function resolveTheoryPublication(item = null) {
    const source = item || theoryEditorState.activeItem || null;
    const sourceItemId = String(
        source?.source_catalog_item_id
        || source?.sourceLineage?.catalog_item_id
        || source?.source_lineage?.catalog_item_id
        || ""
    ).trim();
    if (sourceItemId && theoryPublicationByItemId.has(sourceItemId)) {
        return theoryPublicationByItemId.get(sourceItemId) || null;
    }
    const theoryId = String(source?.id || theoryEditorState.activeTheoryId || "").trim();
    if (!theoryId) return null;
    return theoryPublicationBySourceId.get(theoryId) || null;
}

function isTheoryOwnedByCurrentUser(item = null) {
    const source = item || theoryEditorState.activeItem || null;
    const currentUserId = String(currentTheoryEditorUserId || "").trim();
    if (!source) return false;
    if (source?.ownership?.is_owned_by_current_user === true) return true;
    const ownerId = String(
        source?.ownership?.owner_user_id
        || source?.created_by_user_id
        || ""
    ).trim();
    return !!ownerId && !!currentUserId && ownerId === currentUserId;
}

function parseTheoryPublicationTimestamp(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return 0;
    }
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getTheorySavedVersionTimestamp(item = null) {
    const source = item || theoryEditorState.activeItem || null;
    return parseTheoryPublicationTimestamp(source?.updated_at || source?.version || "");
}

function getTheoryLatestPublicationTimestamp(publication = null) {
    const source = publication || theoryEditorState.publicationItem || null;
    return parseTheoryPublicationTimestamp(source?.latest_published_at || source?.updated_at || "");
}

function getTheoryPublicationSyncState(item = null, publication = null) {
    const resolvedPublication = publication || theoryEditorState.publicationItem || resolveTheoryPublication(item);
    if (!resolvedPublication) {
        return "unpublished";
    }

    const savedTimestamp = getTheorySavedVersionTimestamp(item);
    const publishedTimestamp = getTheoryLatestPublicationTimestamp(resolvedPublication);
    if (savedTimestamp && publishedTimestamp && savedTimestamp > publishedTimestamp) {
        return "stale";
    }
    return "current";
}

function getTheoryPublicationNotice(item = null, publication = null) {
    const syncState = getTheoryPublicationSyncState(item, publication);
    if (syncState === "stale") {
        return {
            kind: "stale",
            buttonLabel: "Нужна публикация",
            tooltip: "Есть сохранённые изменения, которые ещё не попали в публикацию. Опубликуйте новую версию, чтобы их увидели другие пользователи.",
            saveMessage: "Теория сохранена. Чтобы другие пользователи увидели изменения, обновите публикацию.",
        };
    }
    if (syncState === "unpublished") {
        return {
            kind: "unpublished",
            buttonLabel: "Не опубликована",
            tooltip: "Теория сохранена только в рабочей версии. Чтобы её увидели другие пользователи, опубликуйте материал.",
            saveMessage: "Теория сохранена. Чтобы её увидели другие пользователи, опубликуйте материал.",
        };
    }
    return {
        kind: "current",
        buttonLabel: "",
        tooltip: "",
        saveMessage: "",
    };
}

function updateTheoryPublicationControls() {
    const button = document.getElementById("theory-publish-btn");
    if (!button) {
        return;
    }

    const activeTheoryId = String(theoryEditorState.activeTheoryId || "").trim();
    const publication = theoryEditorState.publicationItem || resolveTheoryPublication();
    const canManage = !!activeTheoryId && isTheoryOwnedByCurrentUser();
    const notice = getTheoryPublicationNotice(theoryEditorState.activeItem, publication);

    button.disabled = !activeTheoryId || !canManage;
    if (!activeTheoryId) {
        button.title = "Сначала сохраните теорию";
    } else if (!canManage) {
        button.title = "Публикацией можно управлять только для своих теорий";
    } else if (notice.kind === "stale") {
        button.title = notice.tooltip;
    } else if (publication) {
        button.title = `Управление публикацией: ${getCatalogVisibilityLabel(publication.catalog_visibility)}`;
    } else {
        button.title = "Опубликовать сохранённую теорию";
    }

    if (!activeTheoryId || !canManage) {
        button.classList.add("hidden");
        button.dataset.tone = "muted";
        button.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">public</span>
            Не опубликована
        `;
        return;
    }

    const tone = publication ? getCatalogVisibilityTone(publication.catalog_visibility) : "muted";
    const label = publication ? getCatalogVisibilityLabel(publication.catalog_visibility) : "Не опубликована";
    const description = publication
        ? getTheoryCatalogVisibilityDescription(publication.catalog_visibility)
        : "Теория пока доступна только вам и ещё не опубликована.";

    button.classList.remove("hidden");
    button.dataset.tone = tone;
    button.title = description;
    button.innerHTML = `
        <span class="material-symbols-outlined text-[16px]">public</span>
        ${escapeTheoryHtml(label)}
    `;
}

function updateTheoryPublicationControls() {
    const button = document.getElementById("theory-publish-btn");
    if (!button) {
        return;
    }

    const activeTheoryId = String(theoryEditorState.activeTheoryId || "").trim();
    const publication = theoryEditorState.publicationItem || resolveTheoryPublication();
    const canManage = !!activeTheoryId && isTheoryOwnedByCurrentUser();
    const notice = getTheoryPublicationNotice(theoryEditorState.activeItem, publication);

    button.disabled = !activeTheoryId || !canManage;
    if (!activeTheoryId) {
        button.title = "Сначала сохраните теорию";
    } else if (!canManage) {
        button.title = "Публикацией можно управлять только для своих теорий";
    } else if (notice.kind === "stale") {
        button.title = notice.tooltip;
    } else if (publication) {
        button.title = `Управление публикацией: ${getCatalogVisibilityLabel(publication.catalog_visibility)}`;
    } else {
        button.title = notice.tooltip;
    }

    if (!activeTheoryId || !canManage) {
        button.classList.add("hidden");
        button.dataset.tone = "muted";
        button.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">public</span>
            Не опубликована
        `;
        return;
    }

    if (notice.kind === "stale") {
        button.classList.remove("hidden");
        button.dataset.tone = "warning";
        button.title = notice.tooltip;
        button.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">campaign</span>
            ${escapeTheoryHtml(notice.buttonLabel)}
        `;
        return;
    }

    const tone = publication ? getCatalogVisibilityTone(publication.catalog_visibility) : "muted";
    const label = publication ? getCatalogVisibilityLabel(publication.catalog_visibility) : notice.buttonLabel;
    const description = publication
        ? getTheoryCatalogVisibilityDescription(publication.catalog_visibility)
        : notice.tooltip;

    button.classList.remove("hidden");
    button.dataset.tone = tone;
    button.title = description;
    button.innerHTML = `
        <span class="material-symbols-outlined text-[16px]">public</span>
        ${escapeTheoryHtml(label)}
    `;
}

function syncActiveTheoryPublicationFromIndex() {
    theoryEditorState.publicationItem = resolveTheoryPublication();
    updateTheoryPublicationControls();
}

async function fetchTheoryPublicationItems(forceRefresh = false) {
    const userId = await resolveCurrentTheoryEditorUserId(forceRefresh);
    if (!userId) {
        rebuildTheoryPublicationIndex([]);
        syncActiveTheoryPublicationFromIndex();
        return [];
    }
    const params = new URLSearchParams({
        content_type: "theory",
        owner_user_id: userId,
        include_owned_non_public: "true",
    });
    const response = await fetch(`/api/catalog/items?${params.toString()}`);
    const data = await theoryReadJsonSafely(response);
    if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
        throw new Error(data?.error || `HTTP ${response.status}`);
    }
    rebuildTheoryPublicationIndex(data.items);
    syncActiveTheoryPublicationFromIndex();
    return data.items;
}

async function copyTheoryAccessCode(value) {
    const code = String(value || "").trim().replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
    if (!code || code === "Код будет создан после публикации") return;
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(code);
            theoryEditorToast("Код доступа скопирован.", "success", 2500);
            return;
        }
    } catch (error) {
        console.warn("[Theory Editor] Failed to copy access code", error);
    }
    theoryEditorToast(`Код доступа: ${code}`, "info", 3200);
}

function theoryAssetSrc(assetId, assetUrl) {
    if (assetUrl) return assetUrl;
    if (assetId) return `/api/assets/${encodeURIComponent(assetId)}/content`;
    return "";
}

function escapeTheoryHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderTheoryInline(text, attributes) {
    let html = escapeTheoryHtml(text).replace(/\u00A0/g, "&nbsp;");
    // Convert soft breaks (\r) back to <br>
    html = html.replace(/\r/g, "<br>");
    const attrs = attributes || {};
    if (attrs.bold) html = `<strong>${html}</strong>`;
    if (attrs.italic) html = `<em>${html}</em>`;
    if (attrs.underline) html = `<u>${html}</u>`;
    if (attrs.strike) html = `<s>${html}</s>`;
    if (attrs.color) html = `<span style="color:${escapeTheoryHtml(attrs.color)}">${html}</span>`;
    return html;
}

function getTheoryLineAttributes(rawAttrs) {
    const lineAttrs = {};
    const attrs = rawAttrs && typeof rawAttrs === "object" ? rawAttrs : {};
    if (attrs.list === "ordered" || attrs.list === "bullet" || attrs.list === "check") {
        lineAttrs.list = attrs.list;
    }
    if (attrs.blockquote) {
        lineAttrs.blockquote = true;
    }
    const header = Number(attrs.header);
    if (Number.isInteger(header) && header >= 1 && header <= 6) {
        lineAttrs.header = header;
    }
    if (attrs.align) {
        lineAttrs.align = attrs.align;
    }
    return lineAttrs;
}

function normalizeTheoryImageRef(raw) {
    if (!raw || typeof raw !== "string") return null;
    let value = raw.trim();
    if (!value) return null;
    if (value.startsWith("data:")) {
        return value;
    }
    if (value.startsWith("/")) {
        return value;
    }
    if (value.startsWith("http://") || value.startsWith("https://")) {
        return value;
    }
    return `/api/local-image?path=${encodeURIComponent(value)}`;
}

function getTheoryImageAttributes(attrs) {
    const imageAttrs = {};
    if (!attrs || typeof attrs !== "object") return imageAttrs;
    const width = String(attrs.width || "").trim();
    if (width) imageAttrs.width = width;
    const align = String(attrs.align || "").trim();
    if (["left", "center", "right"].includes(align)) imageAttrs.align = align;
    const rotate = String(attrs.rotate || "").trim();
    if (["0", "90", "180", "270"].includes(rotate) && rotate !== "0") imageAttrs.rotate = rotate;
    const float = String(attrs.float || "").trim();
    if (["none", "left", "right"].includes(float) && float !== "none") imageAttrs.float = float;
    const flip = String(attrs.flip || "").trim();
    if (["none", "horizontal"].includes(flip) && flip !== "none") imageAttrs.flip = flip;
    return imageAttrs;
}

function deltaToTheoryLines(delta) {
    const ops = delta && Array.isArray(delta.ops) ? delta.ops : [];
    const lines = [];
    let segments = [];

    const pushLine = (attrs) => {
        lines.push({
            segments: segments.slice(),
            attrs: getTheoryLineAttributes(attrs),
        });
        segments = [];
    };

    for (const op of ops) {
        if (!op || typeof op !== "object" || !("insert" in op)) continue;
        const attrs = op.attributes || {};
        const insert = op.insert;
        if (typeof insert === "string") {
            const parts = insert.split("\n");
            for (let index = 0; index < parts.length; index += 1) {
                const chunk = parts[index];
                if (chunk) {
                    segments.push({ kind: "text", value: chunk, attrs });
                }
                if (index < parts.length - 1) {
                    pushLine(attrs);
                }
            }
            continue;
        }

        if (insert && typeof insert === "object" && typeof insert.image === "string") {
            const normalizedImage = normalizeTheoryImageRef(insert.image);
            if (normalizedImage) {
                const imageAttrs = getTheoryImageAttributes(op.attributes);
                segments.push({ kind: "image", value: normalizedImage, attrs: imageAttrs });
            }
        }
    }

    if (segments.length || !lines.length) {
        lines.push({ segments: segments.slice(), attrs: {} });
    }
    return lines;
}

function renderTheoryLineContent(segments) {
    if (!Array.isArray(segments) || !segments.length) return "<br>";
    let html = "";
    for (const segment of segments) {
        if (!segment || typeof segment !== "object") continue;
        if (segment.kind === "text") {
            html += renderTheoryInline(segment.value || "", segment.attrs || {});
            continue;
        }
        if (segment.kind === "image" && segment.value) {
            const safeRef = escapeTheoryHtml(segment.value);
            const attrs = segment.attrs || {};
            const width = attrs.width || "100%";
            const align = attrs.align || "left";
            const float = attrs.float || "none";
            const flip = attrs.flip || "none";
            
            const alignClass = align === "center" ? "mx-auto" : align === "right" ? "ml-auto" : "";
            
            let wrapperStyle = "";
            if (float === "left") {
                wrapperStyle = "display:inline-block;float:left;margin:0 16px 8px 0;position:relative;";
            } else if (float === "right") {
                wrapperStyle = "display:inline-block;float:right;margin:0 0 8px 16px;position:relative;";
            } else {
                const textAlign = align === "center" ? "text-align:center;" : align === "right" ? "text-align:right;" : "";
                wrapperStyle = `display:block;position:relative;${textAlign}`;
            }
            
            const rotate = attrs.rotate || "0";
            const flipScale = flip === "horizontal" ? " scaleX(-1)" : "";
            const transformStyle = rotate !== "0" || flip === "horizontal" ? `transform:rotate(${rotate}deg)${flipScale};` : "";
            const imageSrc = isTheoryHostedAssetRef(segment.value) ? segment.value : theoryLocalImageSrc(segment.value);
            const refAttr = isTheoryHostedAssetRef(segment.value)
                ? ` data-asset-url="${safeRef}"`
                : ` data-path="${safeRef}"`;
            html += `<span class="theory-image-wrapper" contenteditable="false" style="${wrapperStyle}"><img${refAttr} data-width="${width}" data-align="${align}" data-rotate="${rotate}" data-float="${float}" data-flip="${flip}" src="${imageSrc}" alt="" class="theory-image ${alignClass}" style="max-width:${width};width:${width};border-radius:12px;cursor:pointer;${transformStyle}" onmousedown="event.preventDefault()" onclick="theoryImageClick(this,event)" /></span>`;
        }
    }
    return html || "<br>";
}

function renderTheoryDeltaToEditor(delta) {
    const editor = document.getElementById("theory-editor");
    if (!editor) return;

    const lines = deltaToTheoryLines(delta);
    const blocks = [];
    let activeListType = null;
    let activeListItems = [];

    const flushList = () => {
        if (!activeListType || !activeListItems.length) {
            activeListType = null;
            activeListItems = [];
            return;
        }
        const listTag = activeListType === "ordered" ? "ol" : "ul";
        blocks.push(`<${listTag}>${activeListItems.join("")}</${listTag}>`);
        activeListType = null;
        activeListItems = [];
    };

    for (const line of lines) {
        const attrs = line && typeof line === "object" ? line.attrs || {} : {};
        const lineHtml = renderTheoryLineContent(line && line.segments);
        const listType =
            attrs.list === "ordered"
                ? "ordered"
                : attrs.list === "bullet" || attrs.list === "check"
                    ? "bullet"
                    : null;

        if (listType) {
            if (activeListType && activeListType !== listType) flushList();
            activeListType = listType;
            const align = attrs.align ? ` style="text-align: ${attrs.align}"` : "";
            activeListItems.push(`<li${align}>${lineHtml}</li>`);
            continue;
        }

        flushList();
        const headerLevel = Number(attrs.header);
        const align = attrs.align ? ` style="text-align: ${attrs.align}"` : "";

        if (Number.isInteger(headerLevel) && headerLevel >= 1 && headerLevel <= 6) {
            blocks.push(`<h${headerLevel}${align}>${lineHtml}</h${headerLevel}>`);
        } else if (attrs.blockquote) {
            blocks.push(`<blockquote${align}>${lineHtml}</blockquote>`);
        } else {
            blocks.push(`<p${align}>${lineHtml}</p>`);
        }
    }

    flushList();
    editor.innerHTML = blocks.length ? blocks.join("") : "<p><br></p>";
}

function collectTheoryInlineOps(node, attrs, out) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
        let text = node.nodeValue || "";
        if (!text) return;
        const siblingNodes = Array.from(node.parentNode?.childNodes || []);
        const currentIndex = siblingNodes.indexOf(node);
        const previousMeaningfulSibling = siblingNodes
            .slice(0, currentIndex)
            .reverse()
            .find((sibling) => String(sibling?.textContent || "").trim());
        const nextMeaningfulSibling = siblingNodes
            .slice(currentIndex + 1)
            .find((sibling) => String(sibling?.textContent || "").trim());
        if (!text.trim()) {
            if (!previousMeaningfulSibling || !nextMeaningfulSibling) {
                return;
            }
            text = " ";
        }
        // Normalize: internal newlines in text nodes should not trigger block breaks
        text = text.replace(/[\n\r]+/g, " ");
        if (!previousMeaningfulSibling) {
            text = text.replace(/^[\s\u00a0]+/, "");
        }
        if (!nextMeaningfulSibling) {
            text = text.replace(/[\s\u00a0]+$/, "");
        }
        if (!text) return;
        const op = { insert: text };
        if (attrs && Object.keys(attrs).length) op.attributes = attrs;
        out.push(op);
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (tag === "img") {
        const dataAssetUrl = node.getAttribute("data-asset-url");
        const dataAssetId = node.getAttribute("data-asset-id");
        const dataPath = node.getAttribute("data-path");
        const src = dataAssetUrl || theoryAssetSrc(dataAssetId, "") || dataPath || node.getAttribute("src") || "";
        if (src) {
            const imageOp = { insert: { image: src } };
            const width = node.getAttribute("data-width");
            const align = node.getAttribute("data-align");
            const rotate = node.getAttribute("data-rotate");
            const float = node.getAttribute("data-float");
            const flip = node.getAttribute("data-flip");
            if (width || align || rotate || float || flip) {
                imageOp.attributes = {};
                if (width) imageOp.attributes.width = width;
                if (align) imageOp.attributes.align = align;
                if (rotate && rotate !== "0") imageOp.attributes.rotate = rotate;
                if (float && float !== "none") imageOp.attributes.float = float;
                if (flip && flip !== "none") imageOp.attributes.flip = flip;
            }
            out.push(imageOp);
        }
        return;
    }
    if (tag === "br") {
        out.push({ insert: "\r" });
        return;
    }
    if (tag === "ul" || tag === "ol") {
        return;
    }

    const nextAttrs = { ...(attrs || {}) };
    if (tag === "strong" || tag === "b") nextAttrs.bold = true;
    if (tag === "em" || tag === "i") nextAttrs.italic = true;
    if (tag === "u") nextAttrs.underline = true;
    if (tag === "s" || tag === "strike") nextAttrs.strike = true;
    if (tag === "span" && node.style && node.style.color) nextAttrs.color = node.style.color;

    for (const child of Array.from(node.childNodes || [])) {
        collectTheoryInlineOps(child, nextAttrs, out);
    }
}

function normalizeTheoryWordMarkerText(value) {
    return String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractTheoryWordListMarker(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    const childNodes = Array.from(element.childNodes || []);
    for (const child of childNodes) {
        if (!child) {
            continue;
        }
        if (child.nodeType === Node.TEXT_NODE) {
            const rawText = String(child.nodeValue || "");
            if (!rawText.trim()) {
                continue;
            }
            const normalized = normalizeTheoryWordMarkerText(rawText);
            const match = normalized.match(/^([^\s]+)/);
            return match ? match[1] : "";
        }
        if (child.nodeType === Node.ELEMENT_NODE) {
            const normalized = normalizeTheoryWordMarkerText(child.textContent || "");
            if (!normalized) {
                continue;
            }
            const match = normalized.match(/^([^\s]+)/);
            return match ? match[1] : "";
        }
    }
    return "";
}

function isTheoryOrderedListMarker(marker) {
    const normalized = normalizeTheoryWordMarkerText(marker);
    if (!normalized) {
        return false;
    }
    return /^(\(?\d+[\.\)]|[a-zа-яёivxlcdm]+[\.\)])$/i.test(normalized);
}

function trimLeadingTheoryWhitespace(container) {
    if (!container || container.nodeType !== Node.ELEMENT_NODE) {
        return;
    }

    while (container.firstChild) {
        const firstChild = container.firstChild;
        if (firstChild.nodeType === Node.TEXT_NODE) {
            const nextValue = String(firstChild.nodeValue || "").replace(/^[\s\u00a0]+/, "");
            if (!nextValue) {
                firstChild.remove();
                continue;
            }
            firstChild.nodeValue = nextValue;
        } else if (firstChild.nodeType === Node.ELEMENT_NODE && !String(firstChild.textContent || "").trim()) {
            firstChild.remove();
            continue;
        }
        break;
    }
}

function stripTheoryWordListMarker(element, marker = "") {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return;
    }

    const markerToken = normalizeTheoryWordMarkerText(marker);
    let firstMeaningfulChild = null;

    for (const child of Array.from(element.childNodes || [])) {
        if (child.nodeType === Node.TEXT_NODE && !String(child.nodeValue || "").trim()) {
            continue;
        }
        if (child.nodeType === Node.ELEMENT_NODE && !String(child.textContent || "").trim()) {
            continue;
        }
        firstMeaningfulChild = child;
        break;
    }

    if (!firstMeaningfulChild) {
        return;
    }

    if (firstMeaningfulChild.nodeType === Node.ELEMENT_NODE) {
        const styleAttr = String(firstMeaningfulChild.getAttribute("style") || "");
        const classAttr = String(firstMeaningfulChild.getAttribute("class") || "");
        const childText = normalizeTheoryWordMarkerText(firstMeaningfulChild.textContent || "");
        const shouldRemoveWholeNode =
            /mso-list\s*:\s*ignore/i.test(styleAttr)
            || /symbol|wingdings/i.test(styleAttr)
            || /MsoList/i.test(classAttr)
            || (markerToken && childText.startsWith(markerToken));

        if (shouldRemoveWholeNode) {
            firstMeaningfulChild.remove();
            trimLeadingTheoryWhitespace(element);
            return;
        }
    }

    if (firstMeaningfulChild.nodeType === Node.TEXT_NODE) {
        const currentValue = String(firstMeaningfulChild.nodeValue || "");
        const escapedMarker = markerToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const nextValue = markerToken
            ? currentValue.replace(new RegExp(`^[\\s\\u00a0]*${escapedMarker}[\\s\\u00a0]*`), "")
            : currentValue;
        firstMeaningfulChild.nodeValue = nextValue;
    }

    trimLeadingTheoryWhitespace(element);
}

function normalizeTheoryWordLists(doc) {
    if (!doc || !doc.body) {
        return;
    }

    const candidates = Array.from(doc.body.querySelectorAll("p, div"));
    let activeList = null;
    let activeSignature = "";

    const resetActiveList = () => {
        activeList = null;
        activeSignature = "";
    };

    candidates.forEach((element) => {
        if (!element || !element.parentNode) {
            resetActiveList();
            return;
        }

        const classAttr = String(element.getAttribute("class") || "");
        const styleAttr = String(element.getAttribute("style") || "");
        const marker = extractTheoryWordListMarker(element);
        const hasWordListHint =
            /(?:^|\s)MsoListParagraph/i.test(classAttr)
            || /mso-list\s*:/i.test(styleAttr);

        if (!hasWordListHint || !marker) {
            resetActiveList();
            return;
        }

        const listType = isTheoryOrderedListMarker(marker) ? "ol" : "ul";
        const listSignatureMatch = styleAttr.match(/mso-list\s*:\s*([^;]+)/i);
        const listSignature = `${listType}:${String(listSignatureMatch?.[1] || classAttr || marker).trim()}`;

        if (!activeList || activeSignature !== listSignature || activeList.tagName.toLowerCase() !== listType) {
            activeList = doc.createElement(listType);
            activeSignature = listSignature;
            element.parentNode.insertBefore(activeList, element);
        }

        const li = doc.createElement("li");
        stripTheoryWordListMarker(element, marker);

        while (element.firstChild) {
            li.appendChild(element.firstChild);
        }
        if (!String(li.textContent || "").trim() && !li.querySelector("img")) {
            li.innerHTML = "<br>";
        }
        activeList.appendChild(li);
        element.remove();
    });
}

function cleanTheoryWordHtml(html) {
    if (!html) return "";

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    normalizeTheoryWordLists(doc);

    // 1. Remove Word-specific tags and comments
    const all = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ALL);
    const nodesToRemove = [];
    let n = all.nextNode();
    while (n) {
        if (n.nodeType === Node.COMMENT_NODE) {
            nodesToRemove.push(n);
        } else if (n.nodeType === Node.ELEMENT_NODE) {
            const tag = n.tagName.toLowerCase();
            // Word-specific tags like <o:p>, <v:shape>, etc.
            if (tag.includes(":") || tag === "meta" || tag === "link" || tag === "style" || tag === "title") {
                nodesToRemove.push(n);
            }
        }
        n = all.nextNode();
    }
    nodesToRemove.forEach((node) => {
        if (node.parentNode) {
            if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
                // If it's an element, try to preserve its text content if it's not a meta/style tag
                const tag = node.tagName.toLowerCase();
                if (tag !== "style" && tag !== "meta" && tag !== "link" && tag !== "title") {
                    while (node.firstChild) {
                        node.parentNode.insertBefore(node.firstChild, node);
                    }
                }
            }
            node.remove();
        }
    });

    // 2. Clean attributes and promote nested blocks
    const promoteBlocks = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote"];
    
    function cleanElement(el) {
        // Strip almost all attributes except essentials
        const attrsToKeep = ["src", "alt", "href", "title"];
        const styleToKeep = ["text-align", "color", "font-weight", "font-style", "text-decoration"];
        
        const preservedStyles = {};
        if (el.style) {
            styleToKeep.forEach(prop => {
                const val = el.style.getPropertyValue(prop);
                if (val) preservedStyles[prop] = val;
            });
        }
        
        while (el.attributes.length > 0) {
            el.removeAttribute(el.attributes[0].name);
        }
        
        attrsToKeep.forEach(attr => {
            if (el.dataset && el.dataset[attr]) el.setAttribute(attr, el.dataset[attr]);
        });
        
        // Restore whitelisted styles
        Object.entries(preservedStyles).forEach(([prop, val]) => {
            el.style.setProperty(prop, val);
        });

        // Recursively clean children
        Array.from(el.children).forEach(cleanElement);
    }

    cleanElement(doc.body);

    // 3. Ensure a flat structure for editorHtmlToTheoryDelta
    // Replace leaf DIVs with Ps, unwrap DIVs that contain other blocks
    const divs = doc.querySelectorAll("div");
    divs.forEach(div => {
        const hasBlockChildren = Array.from(div.children).some(child => 
            ["p", "div", "h1", "h2", "ul", "ol", "blockquote"].includes(child.tagName.toLowerCase())
        );
        
        if (hasBlockChildren) {
            // Unwrap: insert children before div, then remove div
            while (div.firstChild) {
                div.parentNode.insertBefore(div.firstChild, div);
            }
            div.remove();
        } else {
            // Convert to P
            const p = doc.createElement("p");
            p.innerHTML = div.innerHTML;
            div.parentNode.replaceChild(p, div);
        }
    });

    return doc.body.innerHTML;
}

function getTheoryHeaderLevel(tag) {
    if (!tag || typeof tag !== "string") return null;
    const match = /^h([1-6])$/.exec(tag.toLowerCase());
    if (!match) return null;
    return Number(match[1]);
}

function editorHtmlToTheoryDelta() {
    const editor = document.getElementById("theory-editor");
    if (!editor) return { ops: [{ insert: "\n" }] };
    const ops = [];

    function processNodes(nodesToProcess) {
        const blockTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote"]);
        let inlineBuffer = [];

        const flushInlineBuffer = () => {
            if (inlineBuffer.length > 0) {
                inlineBuffer.forEach(node => {
                    collectTheoryInlineOps(node, {}, ops);
                });
                ops.push({ insert: "\n" });
                inlineBuffer = [];
            }
        };

        for (const node of nodesToProcess) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();
                
                if (tag === "div") {
                    const hasBlockChildren = Array.from(node.children).some(child => 
                        blockTags.has(child.tagName.toLowerCase()) || child.tagName.toLowerCase() === "div"
                    );
                    if (hasBlockChildren) {
                        flushInlineBuffer();
                        processNodes(Array.from(node.childNodes));
                        continue;
                    }
                    // If no block children, treat as inline (collect to buffer)
                    inlineBuffer.push(node);
                    continue;
                }

                if (blockTags.has(tag)) {
                    flushInlineBuffer();
                    if (tag === "ol" || tag === "ul") {
                        const listType = tag === "ol" ? "ordered" : "bullet";
                        const items = Array.from(node.children || []).filter(
                            (child) => child.tagName && child.tagName.toLowerCase() === "li"
                        );
                        for (const li of items) {
                            collectTheoryInlineOps(li, {}, ops);
                            const liAttrs = { list: listType };
                            if (li.style.textAlign) liAttrs.align = li.style.textAlign;
                            ops.push({ insert: "\n", attributes: liAttrs });
                        }
                    } else {
                        const lineAttrs = {};
                        const headerLevel = getTheoryHeaderLevel(tag);
                        if (headerLevel) lineAttrs.header = headerLevel;
                        if (tag === "blockquote") lineAttrs.blockquote = true;
                        if (node.style.textAlign) lineAttrs.align = node.style.textAlign;

                        collectTheoryInlineOps(node, {}, ops);
                        ops.push(Object.keys(lineAttrs).length ? { insert: "\n", attributes: lineAttrs } : { insert: "\n" });
                    }
                    continue;
                }

                // Any other element is treated as inline
                inlineBuffer.push(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
                if (!String(node.nodeValue || "").trim()) {
                    continue;
                }
                inlineBuffer.push(node);
            }
        }
        flushInlineBuffer();
    }

    processNodes(Array.from(editor.childNodes || []));

    const normalized = [];
    for (const op of ops) {
        if (!op || !("insert" in op)) continue;
        if (typeof op.insert === "object" && op.insert && typeof op.insert.image === "string") {
            const normalizedImage = normalizeTheoryImageRef(op.insert.image);
            if (!normalizedImage) continue;
            const imageOp = { insert: { image: normalizedImage } };
            if (op.attributes && typeof op.attributes === "object") {
                const attrs = {};
                if (op.attributes.width) attrs.width = op.attributes.width;
                if (op.attributes.align) attrs.align = op.attributes.align;
                if (op.attributes.rotate && op.attributes.rotate !== "0") attrs.rotate = op.attributes.rotate;
                if (op.attributes.float && op.attributes.float !== "none") attrs.float = op.attributes.float;
                if (op.attributes.flip && op.attributes.flip !== "none") attrs.flip = op.attributes.flip;
                if (Object.keys(attrs).length > 0) {
                    imageOp.attributes = attrs;
                }
            }
            normalized.push(imageOp);
            continue;
        }
        if (typeof op.insert !== "string") continue;
        normalized.push(op);
    }

    return normalized.length ? { ops: normalized } : { ops: [{ insert: "\n" }] };
}

function insertTheoryList(tag) {
    const editor = document.getElementById("theory-editor");
    if (!editor) return;

    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const blockTags = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE"]);

    function getBlockAncestor(node) {
        while (node && node !== editor) {
            if (node.nodeType === 1 && blockTags.has(node.tagName)) return node;
            node = node.parentNode;
        }
        return null;
    }

    if (!range) {
        editor.focus();
        document.execCommand("insertHTML", false, tag === "ul" ? "<ul><li><br></li></ul>" : "<ol><li><br></li></ol>");
        return;
    }

    const startBlock = getBlockAncestor(range.startContainer) || editor.firstElementChild;
    const endBlock = getBlockAncestor(range.endContainer) || editor.lastElementChild;

    if (!startBlock) {
        editor.focus();
        document.execCommand("insertHTML", false, tag === "ul" ? "<ul><li><br></li></ul>" : "<ol><li><br></li></ol>");
        return;
    }

    const blocks = [];
    let node = startBlock;
    while (node) {
        if (blockTags.has(node.tagName)) blocks.push(node);
        if (node === endBlock) break;
        node = node.nextElementSibling;
    }
    if (!blocks.length) blocks.push(startBlock);

    const list = document.createElement(tag);
    for (const block of blocks) {
        const li = document.createElement("li");
        li.innerHTML = block.innerHTML || "<br>";
        list.appendChild(li);
    }

    startBlock.parentNode.insertBefore(list, startBlock);
    blocks.forEach((block) => block.remove());

    const firstLi = list.firstElementChild;
    if (firstLi && selection) {
        editor.focus();
        const newRange = document.createRange();
        newRange.setStart(firstLi, 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    }
}

function setTheoryEditorContent(title, delta) {
    const titleEl = document.getElementById("theory-title");
    if (titleEl) {
        titleEl.value = title || "";
    }
    setTheoryColorIndicator();
    renderTheoryDeltaToEditor(delta || EMPTY_THEORY_DELTA);
}

function resetTheoryEditorState() {
    theoryEditorState.activeTheoryId = "";
    theoryEditorState.activeItem = null;
    theoryEditorState.publicationItem = null;
    theoryEditorState.version = null;
    theoryEditorState.dirty = false;
    setTheoryEditorContent("", EMPTY_THEORY_DELTA);
    updateTheoryEditorUrl();
    renderTheoryContextHeader();
    updateTheoryEditorActions();
}

async function openTheoryPublicationDialog() {
    const theoryId = String(theoryEditorState.activeTheoryId || "").trim();
    if (!theoryId) {
        theoryEditorToast("Сначала сохраните теорию, чтобы управлять публикацией.", "info", 3200);
        return;
    }

    await resolveCurrentTheoryEditorUserId();

    const activeTheory = theoryEditorState.activeItem
        || theoryEditorState.catalog.find((item) => String(item?.id || "").trim() === theoryId)
        || null;
    if (!isTheoryOwnedByCurrentUser(activeTheory)) {
        theoryEditorToast("Публикацией можно управлять только для своих теорий.", "warning", 3200);
        return;
    }

    if (!theoryEditorState.publicationItem) {
        try {
            await fetchTheoryPublicationItems(true);
        } catch (error) {
            console.warn("[Theory Editor] Failed to refresh publication items", error);
        }
    }

    const publication = theoryEditorState.publicationItem || resolveTheoryPublication(activeTheory);
    const currentVisibility = String(publication?.catalog_visibility || "public").trim().toLowerCase() || "public";
    const visibilityLock = getTheoryVisibilityLock(publication);
    const accessCode = getTheoryAccessCodeValue(publication);
    const theoryTitle = escapeTheoryHtml(
        String(document.getElementById("theory-title")?.value || activeTheory?.title || "Без названия").trim() || "Без названия"
    );

    const modal = document.createElement("div");
    modal.className = "fixed inset-0 z-[9999] overflow-y-auto bg-scrim p-4 sm:p-6";
    modal.innerHTML = `
        <div class="mx-auto flex min-h-full w-full max-w-4xl items-center justify-center">
            <div class="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl">
                <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4 sm:px-6">
                    <div class="space-y-1 max-w-3xl">
                        <div class="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                            <span class="material-symbols-outlined text-[16px]">public</span>
                            Публикация теории
                        </div>
                        <h3 class="text-xl font-bold text-text-main">${theoryTitle}</h3>
                        <p class="text-sm text-text-secondary">Публикуется последняя сохранённая версия теории. Смена режима доступа влияет на текущую публикацию, а новые изменения из редактора станут видны другим пользователям только после публикации новой версии.</p>
                    </div>
                    <button type="button" data-role="close" class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-main">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="custom-scrollbar space-y-5 overflow-y-auto p-5 sm:p-6">
                    <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">Текущий статус</div>
                                <div id="theory-publish-current-status" class="mt-1 text-base font-semibold text-text-main">${escapeTheoryHtml(publication ? getCatalogVisibilityLabel(publication.catalog_visibility) : "Не опубликована")}</div>
                                <div id="theory-publish-current-meta" class="mt-1 text-sm text-text-secondary">${publication ? `Последняя публикация: ${escapeTheoryHtml(formatTheoryPublicationTimestamp(publication.latest_published_at))}` : "После первой публикации теория появится в каталоге или станет доступна по коду."}</div>
                            </div>
                            <span id="theory-publish-current-badge" class="theory-status-pill" data-tone="${publication ? getCatalogVisibilityTone(currentVisibility) : "muted"}">
                                <span class="material-symbols-outlined text-[16px]">public</span>
                                ${escapeTheoryHtml(publication ? getCatalogVisibilityLabel(currentVisibility) : "Не опубликована")}
                            </span>
                        </div>
                    </div>

                    <div class="space-y-3">
                        <div>
                            <div class="text-sm font-semibold text-text-main">Режим доступа</div>
                            <p class="mt-1 text-sm text-text-secondary">Если публикация уже существует, доступ можно поменять отдельно от публикации новой версии. Новые правки из редактора увидят другие пользователи только после публикации.</p>
                        </div>
                        ${visibilityLock ? `
                            <div class="rounded-2xl border border-warning-light bg-warning-light/40 px-4 py-3 text-sm text-warning-darker">
                                Теория используется публичным комплексом. Режим доступа зафиксирован на «Общий доступ».
                            </div>
                        ` : ""}
                        <div class="grid gap-3 md:grid-cols-3">
                            ${["public", "access_code", "private"].map((visibility) => `
                                <label class="${visibilityLock && visibility !== "public" ? "cursor-not-allowed opacity-60" : "cursor-pointer"} rounded-2xl border border-border-subtle bg-surface-1 p-4 transition-colors hover:border-primary-light">
                                    <div class="flex items-start gap-3">
                                        <input type="radio" name="theory-publish-visibility" value="${visibility}" ${visibility === currentVisibility ? "checked" : ""} ${visibilityLock && visibility !== "public" ? "disabled" : ""} class="mt-1 h-4 w-4 text-primary" />
                                        <div class="space-y-1 min-w-0">
                                            <div class="text-sm font-semibold text-text-main">${escapeTheoryHtml(getCatalogVisibilityLabel(visibility))}</div>
                                            <div class="text-sm text-text-secondary">${escapeTheoryHtml(getTheoryCatalogVisibilityDescription(visibility))}</div>
                                        </div>
                                    </div>
                                </label>
                            `).join("")}
                        </div>
                    </div>

                    <div id="theory-publish-access-box" class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4 ${currentVisibility === "access_code" ? "" : "hidden"}">
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">Код доступа</div>
                                <div id="theory-publish-access-code" class="mt-1 text-base font-semibold tracking-[0.12em] text-text-main">${escapeTheoryHtml(accessCode ? formatTheoryAccessCodeDisplay(accessCode) : "Код будет создан после публикации")}</div>
                            </div>
                            <button type="button" class="theory-neutral-btn inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors hover:border-primary hover:text-primary" data-role="copy-access-code">
                                <span class="material-symbols-outlined text-[18px]">content_copy</span>
                                Скопировать код
                            </button>
                        </div>
                    </div>

                    <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4">
                        <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">Что произойдёт после изменения доступа</div>
                        <ul class="mt-2 space-y-2 text-sm text-text-secondary">
                            <li>Новые пользователи будут видеть публикацию только в рамках выбранного режима доступа.</li>
                            <li>Изменение доступа не публикует новую версию автоматически и не меняет содержимое текущей опубликованной версии.</li>
                            <li>Чтобы другие пользователи увидели новые правки из редактора, опубликуйте новую версию.</li>
                            <li>Новая публикация делает актуальной последнюю сохранённую версию теории для каталога и доступа по коду.</li>
                        </ul>
                    </div>

                    <div id="theory-publish-unsaved-note" class="${theoryEditorState.dirty ? "" : "hidden"} rounded-2xl border border-warning-light bg-warning-light/40 px-4 py-3 text-sm text-warning-darker">
                        Есть несохранённые изменения. В публикацию попадёт последняя сохранённая версия теории.
                    </div>

                    <div id="theory-publish-feedback" class="hidden rounded-2xl border px-4 py-3 text-sm"></div>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-1 px-5 py-4 sm:px-6">
                    <button type="button" data-role="update-visibility" class="theory-neutral-btn inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors hover:border-primary hover:text-primary">
                        <span class="material-symbols-outlined text-[18px]">tune</span>
                        Сохранить доступ
                    </button>
                    <div class="flex flex-wrap items-center justify-end gap-3">
                        <button type="button" data-role="close" class="theory-neutral-btn inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors hover:border-primary hover:text-primary">
                            Отмена
                        </button>
                        <button type="button" data-role="publish-version" class="theory-save-btn inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-fg shadow-sm transition-all hover:shadow-md">
                            <span class="material-symbols-outlined text-[18px]">publish</span>
                            Опубликовать версию
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const getSelectedVisibility = () => {
        const checked = modal.querySelector('input[name="theory-publish-visibility"]:checked');
        return String(checked?.value || "public").trim().toLowerCase() || "public";
    };

    const feedback = modal.querySelector("#theory-publish-feedback");
    const currentStatus = modal.querySelector("#theory-publish-current-status");
    const currentMeta = modal.querySelector("#theory-publish-current-meta");
    const currentBadge = modal.querySelector("#theory-publish-current-badge");
    const accessBox = modal.querySelector("#theory-publish-access-box");
    const accessCodeEl = modal.querySelector("#theory-publish-access-code");
    const updateBtn = modal.querySelector('[data-role="update-visibility"]');
    const publishBtn = modal.querySelector('[data-role="publish-version"]');

    const close = () => modal.remove();

    const setFeedback = (message = "", tone = "info") => {
        if (!feedback) return;
        const text = String(message || "").trim();
        feedback.classList.toggle("hidden", !text);
        if (!text) {
            feedback.textContent = "";
            feedback.className = "hidden rounded-2xl border px-4 py-3 text-sm";
            return;
        }
        const toneClasses = tone === "error"
            ? "border-error-light bg-error-lighter text-error-text"
            : tone === "success"
                ? "border-success-light bg-success-lighter text-success-text"
                : "border-info-light bg-info-lighter text-info-text";
        feedback.className = `rounded-2xl border px-4 py-3 text-sm ${toneClasses}`;
        feedback.textContent = text;
    };

    let modalBusy = false;
    const applyVisibilityControlState = (currentItem = null) => {
        const lock = getTheoryVisibilityLock(currentItem || publication);
        const radios = Array.from(modal.querySelectorAll('input[name="theory-publish-visibility"]'));
        let publicRadio = null;
        radios.forEach((input) => {
            const visibility = String(input?.value || "").trim().toLowerCase();
            const disabledByLock = !!lock && visibility !== "public";
            if (visibility === "public") {
                publicRadio = input;
            }
            input.disabled = modalBusy || disabledByLock;
        });
        if (lock) {
            const selected = getSelectedVisibility();
            if (selected !== "public" && publicRadio) {
                publicRadio.checked = true;
            }
        }
        return lock;
    };

    const setBusy = (busy = false) => {
        modalBusy = !!busy;
        applyVisibilityControlState(theoryEditorState.publicationItem);
        [updateBtn, publishBtn].forEach((node) => {
            if (!node) return;
            node.disabled = busy;
            node.classList.toggle("opacity-60", busy);
        });
    };

    const syncModalState = (currentItem = null) => {
        const lock = applyVisibilityControlState(currentItem);
        const selectedVisibility = getSelectedVisibility();
        if (currentStatus) {
            currentStatus.textContent = currentItem ? getCatalogVisibilityLabel(currentItem.catalog_visibility) : "Не опубликована";
        }
        if (currentMeta) {
            currentMeta.textContent = currentItem
                ? `Последняя публикация: ${formatTheoryPublicationTimestamp(currentItem.latest_published_at)}`
                : "После первой публикации теория появится в каталоге или станет доступна по коду.";
        }
        if (currentBadge) {
            currentBadge.dataset.tone = currentItem ? getCatalogVisibilityTone(currentItem.catalog_visibility) : "muted";
            currentBadge.innerHTML = `
                <span class="material-symbols-outlined text-[16px]">public</span>
                ${escapeTheoryHtml(currentItem ? getCatalogVisibilityLabel(currentItem.catalog_visibility) : "Не опубликована")}
            `;
        }
        const activeCode = getTheoryAccessCodeValue(currentItem);
        const showAccess = selectedVisibility === "access_code";
        if (accessBox) accessBox.classList.toggle("hidden", !showAccess);
        if (accessCodeEl) {
            accessCodeEl.textContent = activeCode
                ? formatTheoryAccessCodeDisplay(activeCode)
                : (selectedVisibility === "access_code" ? "Код будет создан после публикации" : "");
        }
        if (updateBtn) {
            const currentItemVisibility = String(currentItem?.catalog_visibility || "").trim().toLowerCase();
            const canUpdateVisibility = !!currentItem && selectedVisibility !== currentItemVisibility && !(lock && selectedVisibility !== "public");
            updateBtn.disabled = !canUpdateVisibility;
            updateBtn.classList.toggle("opacity-60", !canUpdateVisibility);
        }
    };

    modal.querySelectorAll('[data-role="close"]').forEach((node) => {
        node.addEventListener("click", close);
    });
    modal.addEventListener("click", (event) => {
        if (event.target === modal) close();
    });
    modal.querySelectorAll('input[name="theory-publish-visibility"]').forEach((input) => {
        input.addEventListener("change", () => syncModalState(theoryEditorState.publicationItem));
    });
    modal.querySelector('[data-role="copy-access-code"]')?.addEventListener("click", () => {
        copyTheoryAccessCode(accessCodeEl?.textContent || getTheoryAccessCodeValue(theoryEditorState.publicationItem));
    });
    updateBtn?.addEventListener("click", async () => {
        const currentItem = theoryEditorState.publicationItem;
        if (!currentItem) return;
        const nextVisibility = getSelectedVisibility();
        if (nextVisibility === String(currentItem.catalog_visibility || "").trim().toLowerCase()) {
            setFeedback("Выбранный режим доступа уже сохранён.", "info");
            return;
        }
        setBusy(true);
        setFeedback("");
        try {
            const resp = await fetch(`/api/catalog/items/${encodeURIComponent(currentItem.item_id)}/visibility`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ catalog_visibility: nextVisibility }),
            });
            const data = await theoryReadJsonSafely(resp);
            if (!resp.ok || data?.ok === false || !data?.item) {
                throw new Error(getTheoryPublicationErrorMessage(data?.error || "catalog_visibility_update_failed"));
            }
            upsertTheoryPublicationItem(data.item);
            syncModalState(data.item);
            setFeedback(`Доступ обновлён: ${getCatalogVisibilityLabel(data.item.catalog_visibility)}.`, "success");
            theoryEditorToast(`Статус публикации теории обновлён: ${getCatalogVisibilityLabel(data.item.catalog_visibility)}.`, "success", 2600);
        } catch (error) {
            console.error("[Theory Editor] Visibility update failed", error);
            setFeedback(`Не удалось изменить доступ: ${String(error?.message || "catalog_visibility_update_failed")}`, "error");
        } finally {
            setBusy(false);
        }
    });
    publishBtn?.addEventListener("click", async () => {
        const selectedVisibility = getSelectedVisibility();
        setBusy(true);
        setFeedback("");
        try {
            const resp = await fetch(`/api/catalog/theories/${encodeURIComponent(theoryId)}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ catalog_visibility: selectedVisibility }),
            });
            const data = await theoryReadJsonSafely(resp);
            if (!resp.ok || data?.ok === false || !data?.item) {
                throw new Error(getTheoryPublicationErrorMessage(data?.error || "catalog_publish_failed"));
            }
            upsertTheoryPublicationItem(data.item);
            syncModalState(data.item);
            setFeedback(`Публикация обновлена. Режим доступа: ${getCatalogVisibilityLabel(data.item.catalog_visibility)}.`, "success");
            theoryEditorToast(`Теория опубликована: ${getCatalogVisibilityLabel(data.item.catalog_visibility)}.`, "success", 2800);
        } catch (error) {
            console.error("[Theory Editor] Publish failed", error);
            setFeedback(`Не удалось опубликовать теорию: ${String(error?.message || "catalog_publish_failed")}`, "error");
        } finally {
            setBusy(false);
        }
    });

    syncModalState(publication);
    document.body.appendChild(modal);
}

function markTheoryDirty() {
    theoryEditorState.dirty = true;
    updateTheoryEditorActions();
    scheduleTheoryDraftSave();
    setTheoryStatus("Есть несохранённые изменения", "warning", "edit");
}

async function syncPublishedTheoryAfterSave(savedItem, options = {}) {
    return {
        synced: false,
        skipped: true,
        notice: getTheoryPublicationNotice(savedItem),
        silent: Boolean(options?.silent),
    };
}

async function persistTheory(options = {}) {
    if (theoryEditorState.saving) {
        return null;
    }
    if (!theoryEditorState.activeTheoryId && isTheoryCreationBlocked()) {
        const message = getTheoryLimitMessage();
        setTheoryStatus(message || "Лимит теорий достигнут", "warning", "lock");
        if (!options.silent) {
            theoryEditorToast(message || "Лимит теорий достигнут", "warning", 3600);
        }
        return null;
    }

    const titleEl = document.getElementById("theory-title");
    const payload = {
        title: titleEl ? String(titleEl.value || "").trim() : "",
        delta: editorHtmlToTheoryDelta(),
    };

    theoryEditorState.saving = true;
    updateTheoryEditorActions();
    setTheoryStatus("Сохраняем теорию...", "info", "save");

    try {
        let response;
        if (theoryEditorState.activeTheoryId) {
            const body = { ...payload };
            if (theoryEditorState.version) {
                body.expected_version = theoryEditorState.version;
            }
            response = await fetch(`/api/theories/${encodeURIComponent(theoryEditorState.activeTheoryId)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
        } else {
            response = await fetch("/api/theories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        }

        const data = await response.json();
        if (response.status === 409 && data?.error === "workspace_limit_reached") {
            await fetchTheoryWorkspaceLimits();
            const message = getTheoryLimitMessage() || "Лимит теорий достигнут";
            setTheoryStatus(message, "warning", "lock");
            if (!options.silent) {
                theoryEditorToast(message, "warning", 3600);
            }
            return null;
        }
        if (!response.ok || !data?.ok || !data.item) {
            throw new Error(data?.error || "theory_save_failed");
        }

        const previousDraftKey = getTheoryDraftKey();
        const item = data.item;
        const wasNewTheory = !theoryEditorState.activeTheoryId;
        theoryEditorState.activeTheoryId = String(item.id || "").trim();
        theoryEditorState.activeItem = item;
        theoryEditorState.version = item.version || item.updated_at || null;
        theoryEditorState.dirty = false;
        window.clearTimeout(theoryDraftSaveTimer);
        clearTheoryDraftByKey(previousDraftKey);
        clearTheoryDraft(theoryEditorState.activeTheoryId);
        const _titleEl = document.getElementById("theory-title");
        if (_titleEl) _titleEl.value = item.title || payload.title || "";
        updateTheoryEditorUrl();
        renderTheoryContextHeader();
        updateTheoryEditorActions();
        await loadTheoryCatalog({ keepSelection: true });
        await fetchTheoryWorkspaceLimits();
        const publicationSync = await syncPublishedTheoryAfterSave(item, options);
        const publicationNotice = getTheoryPublicationNotice(item);
        let statusMessage = "Теория сохранена";
        let statusTone = "success";
        let statusIcon = "check_circle";
        let toastMessage = "Теория сохранена";
        let toastTone = "success";
        let toastDuration = 2200;

        const saveFeedbackCtx = theoryEditorState.context || {};
        if (wasNewTheory && saveFeedbackCtx.context === "topic" && saveFeedbackCtx.moduleId && saveFeedbackCtx.topicId) {
            try {
                await fetch(
                    `/api/editor/topic/${encodeURIComponent(saveFeedbackCtx.moduleId)}/${encodeURIComponent(saveFeedbackCtx.topicId)}/theory-link`,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            theory_link: { theory_id: theoryEditorState.activeTheoryId, relation: "link" },
                            apply_to_complexes: true,
                            dry_run: false,
                            propagation_mode: "safe",
                        }),
                    }
                );
                statusMessage = "Теория сохранена и привязана к теме";
                toastMessage = statusMessage;
                toastDuration = 2800;
            } catch (linkErr) {
                console.warn("[Theory Editor] Auto-link to topic failed", linkErr);
                statusMessage = "Теория сохранена (привязка к теме не удалась)";
                statusTone = "warning";
                statusIcon = "warning";
                toastMessage = "Теория сохранена. Привяжите её к теме вручную.";
                toastTone = "warning";
                toastDuration = 3500;
            }
        }

        if (publicationSync.synced) {
            statusMessage = `${statusMessage}. Публикация обновлена автоматически.`;
            toastMessage = `${toastMessage}. Публикация обновлена.`;
            toastDuration = Math.max(toastDuration, 2800);
        } else if (publicationSync.error) {
            statusMessage = `${statusMessage}. Но публикацию не удалось обновить.`;
            statusTone = "warning";
            statusIcon = "warning";
            toastMessage = `${toastMessage}. Публикация не обновилась: ${String(publicationSync.error?.message || "catalog_publish_failed")}`;
            toastTone = "warning";
            toastDuration = Math.max(toastDuration, 3800);
        }

        if (publicationNotice.kind === "stale" || publicationNotice.kind === "unpublished") {
            statusMessage = publicationNotice.saveMessage;
            statusTone = "warning";
            statusIcon = "campaign";
            toastMessage = publicationNotice.saveMessage;
            toastTone = "warning";
            toastDuration = Math.max(toastDuration, 3800);
        }

        setTheoryStatus(statusMessage, statusTone, statusIcon);
        if (!options.silent) {
            theoryEditorToast(toastMessage, toastTone, toastDuration);
        }

        document.title = item.title ? `${item.title} — Редактор теории` : "Редактор теории";
        return item;

        const ctx = theoryEditorState.context || {};
        if (wasNewTheory && ctx.context === "topic" && ctx.moduleId && ctx.topicId) {
            try {
                await fetch(
                    `/api/editor/topic/${encodeURIComponent(ctx.moduleId)}/${encodeURIComponent(ctx.topicId)}/theory-link`,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            theory_link: { theory_id: theoryEditorState.activeTheoryId, relation: "link" },
                            apply_to_complexes: true,
                            dry_run: false,
                            propagation_mode: "safe",
                        }),
                    }
                );
                setTheoryStatus("Теория сохранена и привязана к теме", "success", "check_circle");
                if (!options.silent) {
                    theoryEditorToast("Теория сохранена и привязана к теме", "success", 2800);
                }
            } catch (linkErr) {
                console.warn("[Theory Editor] Auto-link to topic failed", linkErr);
                setTheoryStatus("Теория сохранена (привязка к теме не удалась)", "warning", "warning");
                if (!options.silent) {
                    theoryEditorToast("Теория сохранена. Привяжите её к теме вручную.", "warning", 3500);
                }
            }
        } else {
            setTheoryStatus("Теория сохранена", "success", "check_circle");
            if (!options.silent) {
                theoryEditorToast("Теория сохранена", "success", 2200);
            }
        }

        document.title = item.title ? `${item.title} — Редактор теории` : "Редактор теории";
        return item;
    } catch (error) {
        console.error("[Theory Editor] Failed to save theory", error);
        setTheoryStatus("Не удалось сохранить теорию", "error", "error");
        theoryEditorToast("Не удалось сохранить теорию", "error", 3000);
        throw error;
    } finally {
        theoryEditorState.saving = false;
        updateTheoryEditorActions();
    }
}

async function startNewTheory() {
    const canLeave = await confirmDiscardUnsavedChanges();
    if (!canLeave) {
        return;
    }
    resetTheoryEditorState();
    setTheoryStatus("Новая теория. Начните писать и сохраните материал.", "muted", "edit_square");
    document.title = "Новая теория — Редактор теории";
}

let _selectedImage = null;

function applyImageSettings(img, settings) {
    if (!img) return;
    
    const { width, align, rotate, float, flip } = settings;
    
    if (width !== undefined) {
        img.setAttribute("data-width", width);
        img.style.maxWidth = width;
        img.style.width = width;
    }
    
    if (align !== undefined) {
        img.setAttribute("data-align", align);
        const alignClass = align === "center" ? "mx-auto" : align === "right" ? "ml-auto" : "";
        img.className = `theory-image ${alignClass}`;
        if (_selectedImage === img) img.classList.add("theory-image-selected");
    }
    
    if (rotate !== undefined) {
        img.setAttribute("data-rotate", rotate);
    }
    
    if (float !== undefined) {
        img.setAttribute("data-float", float);
    }
    
    if (flip !== undefined) {
        img.setAttribute("data-flip", flip);
    }
    
    const currentRotate = img.getAttribute("data-rotate") || "0";
    const currentFlip = img.getAttribute("data-flip") || "none";
    const flipScale = currentFlip === "horizontal" ? " scaleX(-1)" : "";
    const transformStyle = currentRotate !== "0" || currentFlip === "horizontal" ? `rotate(${currentRotate}deg)${flipScale}` : "";
    img.style.transform = transformStyle;
    
    const wrapper = img.closest(".theory-image-wrapper");
    if (wrapper) {
        const currentAlign = img.getAttribute("data-align") || "left";
        const currentFloat = img.getAttribute("data-float") || "none";
        let wrapperStyle = "";
        
        if (currentFloat === "left") {
            wrapperStyle = "display:inline-block;float:left;margin:0 16px 8px 0;position:relative;";
        } else if (currentFloat === "right") {
            wrapperStyle = "display:inline-block;float:right;margin:0 0 8px 16px;position:relative;";
        } else {
            const textAlign = currentAlign === "center" ? "text-align:center;" : currentAlign === "right" ? "text-align:right;" : "";
            wrapperStyle = `display:block;position:relative;${textAlign}`;
        }
        
        wrapper.style.cssText = wrapperStyle;
    }
    
    markTheoryDirty();
}

function saveTheorySelection() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const editor = document.getElementById("theory-editor");
        if (editor && editor.contains(range.commonAncestorContainer)) {
            lastTheoryEditorRange = range.cloneRange();
        }
    }
}

function restoreTheorySelection() {
    if (!lastTheoryEditorRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(lastTheoryEditorRange);
}

function isTheoryBlankEditableBlock(node) {
    if (!(node instanceof Element)) return false;
    if (!["P", "DIV", "LI"].includes(node.tagName)) return false;
    if (node.querySelector(".theory-image-wrapper, img")) return false;
    const normalizedText = String(node.textContent || "").replace(/[\s\u00A0\u200B]/g, "");
    return normalizedText === "";
}

function isTheoryImageOnlyBlock(node) {
    return node instanceof Element && !!node.querySelector(".theory-image-wrapper");
}

function placeCaretInsideTheoryBlock(node, placeAtEnd = false) {
    if (!(node instanceof Element)) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(!placeAtEnd);
    selection.removeAllRanges();
    selection.addRange(range);
    lastTheoryEditorRange = range.cloneRange();
}

function guardTheoryImageAdjacentDeletion(event) {
    const key = String(event?.key || "");
    if (key !== "Backspace" && key !== "Delete") return false;

    const editor = document.getElementById("theory-editor");
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount || !selection.isCollapsed) {
        return false;
    }

    let anchor = selection.anchorNode;
    if (!anchor) return false;
    if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentElement;
    }
    if (!(anchor instanceof Element)) return false;

    const currentBlock = anchor.closest("p, div, li");
    if (!currentBlock || !editor.contains(currentBlock) || !isTheoryBlankEditableBlock(currentBlock)) {
        return false;
    }

    const imageSibling = key === "Backspace" ? currentBlock.previousElementSibling : currentBlock.nextElementSibling;
    if (!isTheoryImageOnlyBlock(imageSibling)) {
        return false;
    }

    event.preventDefault();

    const fallbackTarget = key === "Backspace" ? currentBlock.nextElementSibling : currentBlock.previousElementSibling;
    if (fallbackTarget && fallbackTarget !== imageSibling) {
        currentBlock.remove();
        if (fallbackTarget instanceof Element) {
            placeCaretInsideTheoryBlock(fallbackTarget, key === "Backspace");
        }
        markTheoryDirty();
        return true;
    }

    currentBlock.innerHTML = "<br>";
    placeCaretInsideTheoryBlock(currentBlock, false);
    return true;
}

function selectImage(imgElement) {
    if (!imgElement) return;
    
    if (_selectedImage) {
        _selectedImage.classList.remove("theory-image-selected");
    }
    
    _selectedImage = imgElement;
    imgElement.classList.add("theory-image-selected");
    
    const textControls = document.getElementById("theory-text-controls");
    const imageControls = document.getElementById("theory-image-controls");
    if (textControls) {
        textControls.classList.add("hidden");
    }
    if (imageControls) {
        imageControls.classList.add("visible");
        requestAnimationFrame(() => {
            imageControls.style.opacity = "1";
        });
        updateImageControls();
    }
}

function deselectImage() {
    if (_selectedImage) {
        _selectedImage.classList.remove("theory-image-selected");
        _selectedImage = null;
    }
    
    const textControls = document.getElementById("theory-text-controls");
    const imageControls = document.getElementById("theory-image-controls");
    if (imageControls) {
        imageControls.classList.remove("visible");
        imageControls.style.opacity = "";
    }
    if (textControls) {
        textControls.classList.remove("hidden");
    }
}

function updateImageControls() {
    if (!_selectedImage) return;
    
    const width = _selectedImage.getAttribute("data-width") || "100%";
    const align = _selectedImage.getAttribute("data-align") || "left";
    const float = _selectedImage.getAttribute("data-float") || "none";
    const flip = _selectedImage.getAttribute("data-flip") || "none";
    
    const widthSlider = document.getElementById("theory-image-width-slider");
    const widthLabel = document.getElementById("theory-image-width-label");
    if (widthSlider && widthLabel) {
        const widthNum = parseInt(width) || 100;
        widthSlider.value = widthNum;
        widthLabel.textContent = `${widthNum}%`;
    }
    
    document.querySelectorAll(".theory-image-align-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-align") === align);
    });
    
    document.querySelectorAll(".theory-image-float-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-float") === float);
    });
    
    const flipBtn = document.getElementById("theory-image-flip");
    if (flipBtn) {
        flipBtn.classList.toggle("active", flip === "horizontal");
    }
}

function theoryImageClick(imgElement, e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!imgElement) return;
    selectImage(imgElement);
}

window.theoryImageClick = theoryImageClick;

async function uploadTheoryImage(event) {
    const input = event?.target;
    const file = input && input.files ? input.files[0] : null;
    if (!file) {
        return;
    }

    try {
        const item = await persistTheory({ silent: true });
        const theoryId = String(item?.id || theoryEditorState.activeTheoryId || "").trim();
        if (!theoryId) {
            throw new Error("theory_not_ready");
        }

        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(`/api/theories/${encodeURIComponent(theoryId)}/upload-image`, {
            method: "POST",
            body: formData,
        });
        const data = await response.json();
        if (!response.ok || !data?.ok || (!data.path && !data.asset_url && !data.asset_id)) {
            throw new Error(data?.error || "image_upload_failed");
        }

        const editor = document.getElementById("theory-editor");
        if (editor) {
            const img = document.createElement("img");
            img.src = theoryAssetSrc(data.asset_id, data.asset_url) || theoryLocalImageSrc(data.path);
            if (data.path) img.setAttribute("data-path", data.path);
            if (data.asset_id) img.setAttribute("data-asset-id", data.asset_id);
            if (data.asset_url) img.setAttribute("data-asset-url", data.asset_url);
            
            img.setAttribute("data-width", "100%");
            img.setAttribute("data-align", "left");
            img.setAttribute("data-rotate", "0");
            img.setAttribute("data-float", "none");
            img.setAttribute("data-flip", "none");
            img.alt = "";
            img.className = "theory-image";
            img.style.maxWidth = "100%";
            img.style.width = "100%";
            img.style.borderRadius = "12px";
            img.style.cursor = "pointer";
            img.onmousedown = function(e) { e.preventDefault(); };
            img.onclick = function(e) { theoryImageClick(this, e); };

            const wrapper = document.createElement("span");
            wrapper.className = "theory-image-wrapper";
            wrapper.setAttribute("contenteditable", "false");
            wrapper.style.display = "block";
            wrapper.style.position = "relative";
            wrapper.appendChild(img);
            
            const p = document.createElement("p");
            p.appendChild(wrapper);

            if (lastTheoryEditorRange) {
                try {
                    restoreTheorySelection();
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        range.deleteContents();
                        range.insertNode(p);
                        
                        const nextP = document.createElement("p");
                        nextP.innerHTML = "<br>";
                        p.after(nextP);
                        
                        const nextRange = document.createRange();
                        nextRange.setStart(nextP, 0);
                        nextRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(nextRange);
                        lastTheoryEditorRange = nextRange.cloneRange();
                    } else {
                        editor.appendChild(p);
                    }
                } catch (e) {
                    console.warn("[Theory Editor] Failed to insert image at range", e);
                    editor.appendChild(p);
                }
            } else {
                const lastChild = editor.lastElementChild;
                if (lastChild && lastChild.tagName === "P" && lastChild.childNodes.length === 1 && lastChild.firstChild && lastChild.firstChild.nodeName === "BR") {
                    editor.removeChild(lastChild);
                }
                editor.appendChild(p);
            }
            
            theoryEditorState.version = data.version || theoryEditorState.version;
            markTheoryDirty();
            theoryEditorToast("Изображение добавлено. Кликните для настройки размера.", "success", 3000);
        }
    } catch (error) {
        console.error("[Theory Editor] Failed to upload image", error);
        setTheoryStatus("Не удалось загрузить изображение", "error", "error");
        theoryEditorToast("Не удалось загрузить изображение", "error", 2800);
    } finally {
        if (input) input.value = "";
    }
}

function updateTheoryEditorActions() {
    const saveBtn = document.getElementById("theory-save-btn");
    if (saveBtn) {
        saveBtn.disabled = theoryEditorState.saving || isTheoryCreationBlocked();
        saveBtn.innerHTML = theoryEditorState.saving
            ? '<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> Сохраняем'
            : '<span class="material-symbols-outlined text-[18px]">save</span> Сохранить';
        saveBtn.classList.toggle('theory-save-btn--dirty', !theoryEditorState.saving && theoryEditorState.dirty);
    }

    const openComplexesBtn = document.getElementById("theory-open-complexes-btn");
    if (openComplexesBtn) {
        openComplexesBtn.disabled = false;
        openComplexesBtn.dataset.target = resolveTheoryComplexesUrl();
    }

    updateTheoryPublicationControls();
}

function updateTheoryEditorActions() {
    const saveBtn = document.getElementById("theory-save-btn");
    const blocked = isTheoryCreationBlocked();
    if (saveBtn) {
        saveBtn.disabled = theoryEditorState.saving || blocked;
        if (theoryEditorState.saving) {
            saveBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> Сохраняем';
        } else if (blocked) {
            saveBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">lock</span> Лимит достигнут';
        } else {
            saveBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">save</span> Сохранить';
        }
        saveBtn.classList.toggle('theory-save-btn--dirty', !theoryEditorState.saving && theoryEditorState.dirty);
    }

    const openComplexesBtn = document.getElementById("theory-open-complexes-btn");
    if (openComplexesBtn) {
        openComplexesBtn.disabled = false;
        openComplexesBtn.dataset.target = resolveTheoryComplexesUrl();
    }

    updateTheoryPublicationControls();
    renderTheoryQuotaUi();
}

function formatTheoryListDate(value) {
    if (!value) return "без даты";
    try {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return "без даты";
        return parsed.toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch (error) {
        return "без даты";
    }
}

function renderTheoryLibraryList() {
    const host = document.getElementById("theory-library-list");
    const countEl = document.getElementById("theory-library-count");
    if (!host || !countEl) {
        return;
    }

    const query = String(theoryEditorState.search || "").trim().toLowerCase();
    const items = Array.isArray(theoryEditorState.catalog) ? theoryEditorState.catalog.filter((item) => {
        if (!query) return true;
        const title = String(item?.title || "").toLowerCase();
        const theoryId = String(item?.id || "").toLowerCase();
        return title.includes(query) || theoryId.includes(query);
    }) : [];

    countEl.textContent = `${items.length} ${items.length === 1 ? "теория" : items.length < 5 ? "теории" : "теорий"}`;
    host.replaceChildren();

    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state-card empty-state-card--compact";
        empty.textContent = query
            ? "По этому запросу теории не найдены."
            : "В библиотеке пока нет теорий. Можно начать с пустой заготовки.";
        host.appendChild(empty);
        return;
    }

    items.forEach((item) => {
        const theoryId = String(item?.id || "").trim();
        const title = String(item?.title || "").trim() || theoryId || "Без названия";
        const usageTopics = Number(item?.usage_topics || 0);
        const usageComplexes = Number(item?.usage_complexes || 0);
        const isOrphan = (usageTopics + usageComplexes) === 0;
        const hasContent = item?.has_content !== false;
        const button = document.createElement("button");
        button.type = "button";
        button.className = `theory-library-item card-elevated ${theoryId === theoryEditorState.activeTheoryId ? "is-active" : ""}`;
        if (theoryId === theoryEditorState.activeTheoryId) {
            button.setAttribute("data-onboarding-target", "theory-editor-active-library-item");
        }
        const libraryImageCount = Number(item?.image_count || 0);
        const metaBadges = [];
        const statusBadges = [];
        if (libraryImageCount > 0) {
            metaBadges.push(`
                <span class="theory-chip pill pill-sm pill-neutral shrink-0 whitespace-nowrap" title="${libraryImageCount} фото">
                    ${libraryImageCount} фото
                </span>
            `);
        }
        if (isOrphan) {
            statusBadges.push(`
                <span class="theory-library-badge w-full px-2 py-1 text-center text-[10px] font-semibold" data-tone="error" title="Теория не привязана ни к теме, ни к комплексу">
                    <span class="material-symbols-outlined text-[14px]">priority_high</span>
                    Нет привязки
                </span>
            `);
        }
        if (!hasContent) {
            statusBadges.push(`
                <span class="theory-library-badge w-full px-2 py-1 text-center text-[10px] font-semibold" title="В теории только заголовок">
                    <span class="material-symbols-outlined text-[14px]">text_ad</span>
                    Только заголовок
                </span>
            `);
        }
        button.innerHTML = `
            <div class="flex items-start justify-between gap-2">
                <p class="truncate text-sm font-semibold text-text-main flex-1 min-w-0">${escapeTheoryHtml(title)}</p>
            </div>
            <div class="mt-2 flex flex-col gap-2">
                <p class="text-[11px] text-text-secondary">Обновлено: ${escapeTheoryHtml(formatTheoryListDate(item?.updated_at || item?.version))}</p>
                <div class="flex flex-col items-stretch gap-1">
                    ${metaBadges.length ? `
                        <div class="flex justify-end gap-1">
                            ${metaBadges.join("")}
                        </div>
                    ` : ""}
                    ${statusBadges.length ? `
                        <div class="grid w-full ${statusBadges.length > 1 ? "grid-cols-2" : "grid-cols-1"} gap-1">
                            ${statusBadges.join("")}
                        </div>
                    ` : ""}
                </div>
            </div>
        `;
        button.addEventListener("click", async () => {
            await openTheoryFromLibrary(theoryId);
        });
        host.appendChild(button);
    });
}

async function loadTheoryCatalog(options = {}) {
    const keepSelection = options.keepSelection !== false;
    const skipPublicationRefresh = options.skipPublicationRefresh === true;
    const currentTheoryId = keepSelection ? theoryEditorState.activeTheoryId : "";
    const host = document.getElementById("theory-library-list");
    if (host) {
        host.innerHTML = `
            <div class="empty-state-card empty-state-card--compact">
                Загружаем библиотеку теорий...
            </div>
        `;
    }

    try {
        const response = await fetch("/api/theories");
        const data = await response.json();
        if (!response.ok || !data?.ok) {
            throw new Error(data?.error || `HTTP ${response.status}`);
        }
        theoryEditorState.catalog = Array.isArray(data.items) ? data.items : [];
        const activeTheory = theoryEditorState.catalog.find((item) => String(item?.id || "").trim() === String(theoryEditorState.activeTheoryId || "").trim()) || null;
        if (activeTheory) {
            theoryEditorState.activeItem = { ...(theoryEditorState.activeItem || {}), ...activeTheory };
        }
        if (currentTheoryId && !theoryEditorState.activeTheoryId) {
            theoryEditorState.activeTheoryId = currentTheoryId;
        }
        if (!skipPublicationRefresh) {
            try {
                await fetchTheoryPublicationItems();
            } catch (error) {
                console.warn("[Theory Editor] Failed to load publication state", error);
                theoryEditorState.publicationItem = null;
                updateTheoryPublicationControls();
            }
        } else {
            syncActiveTheoryPublicationFromIndex();
        }
        renderTheoryLibraryList();
    } catch (error) {
        console.error("[Theory Editor] Failed to load theory catalog", error);
        if (host) {
            host.innerHTML = `
                <div class="empty-state-card empty-state-card--compact">
                    Не удалось загрузить библиотеку теорий.
                </div>
            `;
        }
        theoryEditorToast("Не удалось загрузить список теорий", "warning", 2600);
        theoryEditorState.publicationItem = null;
        updateTheoryPublicationControls();
    }
}

async function loadTheoryById(theoryId) {
    const normalizedTheoryId = String(theoryId || "").trim();
    if (!normalizedTheoryId) {
        resetTheoryEditorState();
        setTheoryStatus("Новая теория. Сохраните материал, когда будете готовы.", "muted", "edit_square");
        document.title = "Редактор теории";
        renderTheoryLibraryList();
        return;
    }

    theoryEditorState.loading = true;
    setTheoryStatus(`Загружаем ${normalizedTheoryId}...`, "info", "progress_activity");

    try {
        const response = await fetch(`/api/theories/${encodeURIComponent(normalizedTheoryId)}`);
        const data = await response.json();
        if (!response.ok || !data?.ok || !data.item) {
            throw new Error(data?.error || "theory_load_failed");
        }

        const item = data.item;
        theoryEditorState.activeTheoryId = String(item.id || normalizedTheoryId).trim();
        theoryEditorState.activeItem = item;
        theoryEditorState.version = item.version || item.updated_at || null;
        theoryEditorState.dirty = false;
        setTheoryEditorContent(item.title || "", item.delta || EMPTY_THEORY_DELTA);
        updateTheoryEditorUrl();
        renderTheoryContextHeader();
        syncActiveTheoryPublicationFromIndex();
        updateTheoryEditorActions();
        renderTheoryLibraryList();
        await restoreTheoryDraftIfPresent(theoryEditorState.activeTheoryId);
        setTheoryStatus("Теория загружена", "success", "check_circle");
        document.title = item.title ? `${item.title} — Редактор теории` : "Редактор теории";
    } catch (error) {
        console.error("[Theory Editor] Failed to load theory", error);
        theoryEditorToast("Не удалось открыть теорию", "error", 2800);
        setTheoryStatus("Теория не загружена", "error", "error");
    } finally {
        theoryEditorState.loading = false;
    }
}

async function confirmDiscardUnsavedChanges() {
    if (!theoryEditorState.dirty) {
        return true;
    }
    return theoryEditorConfirm({
        title: "Есть несохранённые изменения",
        message: "Если уйти сейчас, несохранённые правки теории будут потеряны.",
        confirmText: "Перейти",
        cancelText: "Остаться",
        variant: "warning",
    });
}

function installTheoryHistoryGuardEntry() {
    if (typeof window === "undefined" || theoryHistoryGuardDisabled) {
        return;
    }
    const currentState = window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    if (currentState.__theoryHistoryGuard === theoryHistoryGuardToken) {
        return;
    }
    window.history.replaceState({
        ...currentState,
        __theoryHistoryBase: theoryHistoryGuardToken,
    }, "", window.location.href);
    window.history.pushState({
        ...currentState,
        __theoryHistoryGuard: theoryHistoryGuardToken,
    }, "", window.location.href);
}

function restoreTheoryHistoryGuardEntry() {
    if (typeof window === "undefined" || theoryHistoryGuardDisabled) {
        return;
    }
    const currentState = window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    if (currentState.__theoryHistoryGuard === theoryHistoryGuardToken) {
        return;
    }
    window.history.pushState({
        ...currentState,
        __theoryHistoryGuard: theoryHistoryGuardToken,
    }, "", window.location.href);
}

function initTheoryNavigationGuards() {
    if (typeof window === "undefined" || theoryHistoryGuardToken) {
        return;
    }
    theoryHistoryGuardToken = `theory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    installTheoryHistoryGuardEntry();

    window.addEventListener("popstate", async () => {
        if (theoryHistoryGuardDisabled) {
            return;
        }
        const currentState = window.history.state && typeof window.history.state === "object"
            ? window.history.state
            : {};
        if (currentState.__theoryHistoryGuard === theoryHistoryGuardToken) {
            return;
        }
        if (!theoryEditorState.dirty) {
            theoryHistoryGuardDisabled = true;
            window.setTimeout(() => window.history.back(), 0);
            return;
        }
        if (theoryHistoryGuardPromptOpen) {
            restoreTheoryHistoryGuardEntry();
            return;
        }
        theoryHistoryGuardPromptOpen = true;
        const canLeave = await confirmDiscardUnsavedChanges();
        theoryHistoryGuardPromptOpen = false;
        if (canLeave) {
            saveTheoryDraftNow();
            theorySkipBeforeUnloadPrompt = true;
            theoryHistoryGuardDisabled = true;
            window.setTimeout(() => window.history.back(), 0);
            return;
        }
        restoreTheoryHistoryGuardEntry();
    });
}

async function openTheoryFromLibrary(theoryId) {
    const normalizedTheoryId = String(theoryId || "").trim();
    if (!normalizedTheoryId || normalizedTheoryId === theoryEditorState.activeTheoryId) {
        return;
    }
    const canLeave = await confirmDiscardUnsavedChanges();
    if (!canLeave) {
        return;
    }
    await loadTheoryById(normalizedTheoryId);
}

const THEORY_COLORS = [
    "#000000", "#374151", "#6b7280", "#d1d5db",
    "#ef4444", "#f97316", "#eab308", "#22c55e",
    "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
    "#7c3aed", "#059669",
];

function initColorPicker() {
    const palette = document.getElementById("theory-color-palette");
    if (!palette) return;
    palette.innerHTML = THEORY_COLORS.map((c) =>
        `<button type="button" class="theory-color-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`
    ).join("");
    setTheoryColorIndicator();
    palette.addEventListener("click", (e) => {
        const swatch = e.target.closest(".theory-color-swatch");
        if (!swatch) return;
        const color = swatch.getAttribute("data-color");
        const editor = document.getElementById("theory-editor");
        if (editor) editor.focus();
        document.execCommand("foreColor", false, color);
        setTheoryColorIndicator(color);
        palette.classList.add("hidden");
        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().length > 0;
        const editorHasContent = editor && editor.textContent.trim().length > 0;
        if (hasSelection || editorHasContent) {
            markTheoryDirty();
        }
    });
    const colorBtn = document.getElementById("theory-color-btn");
    colorBtn?.addEventListener("mousedown", (e) => {
        e.preventDefault();
        palette.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
        const host = document.getElementById("theory-color-picker-host");
        if (host && !host.contains(e.target)) {
            palette.classList.add("hidden");
        }
    });
}

function initImageControls() {
    const widthSlider = document.getElementById("theory-image-width-slider");
    const widthLabel = document.getElementById("theory-image-width-label");
    if (widthSlider && widthLabel) {
        widthSlider.addEventListener("input", () => {
            const width = `${widthSlider.value}%`;
            widthLabel.textContent = width;
            if (_selectedImage) {
                applyImageSettings(_selectedImage, { width });
            }
        });
    }
    
    document.querySelectorAll(".theory-image-align-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const align = btn.getAttribute("data-align");
            if (_selectedImage) {
                applyImageSettings(_selectedImage, { align });
                updateImageControls();
            }
        });
    });
    
    document.querySelectorAll(".theory-image-float-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const float = btn.getAttribute("data-float");
            if (_selectedImage) {
                applyImageSettings(_selectedImage, { float });
                updateImageControls();
            }
        });
    });
    
    document.getElementById("theory-image-rotate-left")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        const currentRotate = parseInt(_selectedImage.getAttribute("data-rotate") || "0");
        const newRotate = ((currentRotate - 90 + 360) % 360).toString();
        applyImageSettings(_selectedImage, { rotate: newRotate });
    });
    
    document.getElementById("theory-image-rotate-right")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        const currentRotate = parseInt(_selectedImage.getAttribute("data-rotate") || "0");
        const newRotate = ((currentRotate + 90) % 360).toString();
        applyImageSettings(_selectedImage, { rotate: newRotate });
    });
    
    document.getElementById("theory-image-flip")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        const currentFlip = _selectedImage.getAttribute("data-flip") || "none";
        const newFlip = currentFlip === "horizontal" ? "none" : "horizontal";
        applyImageSettings(_selectedImage, { flip: newFlip });
        updateImageControls();
    });
    
    const editor = document.getElementById("theory-editor");
    if (editor) {
        editor.addEventListener("click", (e) => {
            if (e.target === editor || (e.target.closest && !e.target.closest(".theory-image"))) {
                deselectImage();
            }
        });
    }
    
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && _selectedImage) {
            deselectImage();
        }
    });
}

function bindTheoryToolbar() {
    try {
        document.execCommand("styleWithCSS", false, true);
    } catch (error) {}

    document.getElementById("theory-bold")?.addEventListener("click", () => {
        document.execCommand("bold");
        markTheoryDirty();
    });
    document.getElementById("theory-italic")?.addEventListener("click", () => {
        document.execCommand("italic");
        markTheoryDirty();
    });
    document.getElementById("theory-underline")?.addEventListener("click", () => {
        document.execCommand("underline");
        markTheoryDirty();
    });
    document.getElementById("theory-h1")?.addEventListener("click", () => {
        document.execCommand("formatBlock", false, "h1");
        markTheoryDirty();
    });
    document.getElementById("theory-h2")?.addEventListener("click", () => {
        document.execCommand("formatBlock", false, "h2");
        markTheoryDirty();
    });
    document.getElementById("theory-ul")?.addEventListener("click", () => {
        insertTheoryList("ul");
        markTheoryDirty();
    });
    document.getElementById("theory-ol")?.addEventListener("click", () => {
        insertTheoryList("ol");
        markTheoryDirty();
    });
    document.getElementById("theory-align-left")?.addEventListener("click", () => {
        document.execCommand("justifyLeft");
        markTheoryDirty();
    });
    document.getElementById("theory-align-center")?.addEventListener("click", () => {
        document.execCommand("justifyCenter");
        markTheoryDirty();
    });
    document.getElementById("theory-align-right")?.addEventListener("click", () => {
        document.execCommand("justifyRight");
        markTheoryDirty();
    });
    document.getElementById("theory-align-justify")?.addEventListener("click", () => {
        document.execCommand("justifyFull");
        markTheoryDirty();
    });

    document.getElementById("theory-toolbar")?.addEventListener("mousedown", (e) => {
        const interactiveTarget = e.target instanceof Element
            ? e.target.closest('input, select, textarea, option, [role="slider"]')
            : null;
        if (!interactiveTarget) {
            e.preventDefault();
        }
    });

    initColorPicker();
    initImageControls();
}

function bindTheoryEditorEvents() {
    document.getElementById("theory-title")?.addEventListener("input", () => {
        markTheoryDirty();
    });

    document.getElementById("theory-editor")?.addEventListener("input", () => {
        markTheoryDirty();
        saveTheorySelection();
    });

    document.getElementById("theory-editor")?.addEventListener("keydown", (event) => {
        guardTheoryImageAdjacentDeletion(event);
    });

    document.getElementById("theory-editor")?.addEventListener("paste", (e) => {
        const html = e.clipboardData?.getData("text/html");
        if (html) {
            e.preventDefault();
            const cleanHtml = cleanTheoryWordHtml(html);
            document.execCommand("insertHTML", false, cleanHtml);
            markTheoryDirty();
        }
    });

    const editor = document.getElementById("theory-editor");
    if (editor) {
        ["keyup", "mouseup", "touchend", "focus"].forEach(evt => {
            editor.addEventListener(evt, saveTheorySelection);
        });
    }

    document.getElementById("theory-library-search")?.addEventListener("input", (event) => {
        theoryEditorState.search = String(event?.target?.value || "").trim();
        renderTheoryLibraryList();
    });

    document.getElementById("theory-save-btn")?.addEventListener("click", async () => {
        try {
            await persistTheory();
        } catch (error) {}
    });

    document.getElementById("theory-publish-btn")?.addEventListener("click", async () => {
        await openTheoryPublicationDialog();
    });

    document.getElementById("theory-new-btn")?.addEventListener("click", async () => {
        await startNewTheory();
    });

    document.getElementById("theory-back-btn")?.addEventListener("click", async () => {
        const canLeave = await confirmDiscardUnsavedChanges();
        if (!canLeave) return;
        const button = document.getElementById("theory-back-btn");
        const target = button?.dataset.target || THEORY_CENTER_ROUTE;
        theoryEditorNavigate(target);
    });

    document.getElementById("theory-open-center-btn")?.addEventListener("click", async () => {
        const canLeave = await confirmDiscardUnsavedChanges();
        if (!canLeave) return;
        const target = resolveTheoryCenterUrl();
        theoryEditorNavigate(target);
    });

    document.getElementById("theory-open-complexes-btn")?.addEventListener("click", async () => {
        const canLeave = await confirmDiscardUnsavedChanges();
        if (!canLeave) return;
        const button = document.getElementById("theory-open-complexes-btn");
        const target = button?.dataset.target || resolveTheoryComplexesUrl();
        theoryEditorNavigate(target);
    });

    document.getElementById("theory-image-btn")?.addEventListener("click", () => {
        saveTheorySelection();
        document.getElementById("theory-image-input")?.click();
    });
    document.getElementById("theory-image-input")?.addEventListener("change", uploadTheoryImage);

    bindTheoryToolbar();

    document.addEventListener("keydown", async (event) => {
        if (theoryReloadConfirmPending) return;
        const lowerKey = String(event.key || "").toLowerCase();
        if ((event.ctrlKey || event.metaKey) && lowerKey === "s") {
            event.preventDefault();
            try {
                await persistTheory();
            } catch (error) {}
            return;
        }

        const wantsReload = event.key === "F5" || ((event.ctrlKey || event.metaKey) && lowerKey === "r");
        if (!theoryEditorState.dirty || !wantsReload) return;

        event.preventDefault();
        theoryReloadConfirmPending = true;
        const canReload = await theoryEditorConfirm({
            title: "Обновить страницу?",
            message: "Есть несохранённые изменения. Мы сохраним черновик и после обновления предложим восстановить его.",
            confirmText: "Обновить",
            cancelText: "Остаться",
            variant: "warning",
        });
        if (!canReload) {
            theoryReloadConfirmPending = false;
            return;
        }

        saveTheoryDraftNow();
        window.location.reload();
    });

    const persistDraftOnLeave = (event = null) => {
        if (!theoryEditorState.dirty) return;
        saveTheoryDraftNow();
        const params = new URLSearchParams(window.location.search || '');
        const isReferencePreview = params.get('reference_embed') === '1' || params.get('reference_preview') === '1';
        if (event && !theorySkipBeforeUnloadPrompt && !isReferencePreview) {
            event.preventDefault();
            event.returnValue = "";
        }
    };

    initTheoryNavigationGuards();
    window.addEventListener("beforeunload", persistDraftOnLeave);
    window.addEventListener("pagehide", persistDraftOnLeave);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") persistDraftOnLeave();
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    theoryEditorState.context = parseTheoryEditorContext();
    renderTheoryContextHeader();
    bindTheoryEditorEvents();
    bindTheoryEditorOnboardingDemoObserver();
    updateTheoryEditorActions();
    if (isTheoryEditorOnboardingDemoRequested()) {
        applyTheoryEditorOnboardingDemoState();
        return;
    }
    await Promise.all([
        loadTheoryCatalog({ keepSelection: true }),
        fetchTheoryWorkspaceLimits(),
    ]);

    if (theoryEditorState.context?.theoryId) {
        await loadTheoryById(theoryEditorState.context.theoryId);
        return;
    }

    resetTheoryEditorState();
    setTheoryStatus("Новая теория. Начните писать и сохраните материал.", "muted", "edit_square");
    document.title = "Новая теория — Редактор теории";
});

document.addEventListener("DOMContentLoaded", () => {
    window.setTimeout(async () => {
        if (theoryEditorState.context?.theoryId || theoryEditorState.activeTheoryId) return;
        await restoreTheoryDraftIfPresent("");
    }, 280);
});
