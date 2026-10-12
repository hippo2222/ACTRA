function wt(key, fallback) {
  if (window.i18n && typeof window.i18n.t === 'function') {
    var v = window.i18n.t(key);
    if (v !== key) return v;
  }
  return fallback;
}

const THEORY_EDITOR_ROUTE = "/editor/Theory_Editor.html";
const THEORY_CENTER_ROUTE = "/editor/Theory_Center.html";
const EMPTY_THEORY_DELTA = { ops: [{ insert: "\n" }] };
const THEORY_DEFAULT_TEXT_COLOR_FALLBACK = "#1A1A1A";
const THEORY_DRAFT_STORAGE_PREFIX = "theory_editor_draft_v2:";
const THEORY_DRAFT_STORAGE_LEGACY_PREFIX = "theory-editor-draft:";
const MAX_THEORY_SNAPSHOTS = 5;
const THEORY_SNAPSHOT_DEBOUNCE_INTERVAL_MS = 45000;
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

const EditorUndoManager = (typeof UndoManager !== "undefined")
    ? UndoManager
    : class {
        constructor(maxHistory = 50) {
            this.history = [];
            this.currentIndex = -1;
            this.maxHistory = maxHistory;
        }
        pushState(state) {
            this.history = this.history.slice(0, this.currentIndex + 1);
            this.history.push(JSON.parse(JSON.stringify(state)));
            this.currentIndex++;
            if (this.history.length > this.maxHistory) {
                this.history.shift();
                this.currentIndex--;
            }
        }
        undo() {
            if (this.canUndo()) {
                this.currentIndex--;
                return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
            }
            return null;
        }
        redo() {
            if (this.canRedo()) {
                this.currentIndex++;
                return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
            }
            return null;
        }
        canUndo() { return this.currentIndex > 0; }
        canRedo() { return this.currentIndex < this.history.length - 1; }
        clear() { this.history = []; this.currentIndex = -1; }
    };

const theoryUndoManager = new EditorUndoManager(50);
let theoryUndoDebounceTimer = null;
let isRestoringTheoryUndoState = false;

function captureTheoryEditorSnapshot() {
    const editor = document.getElementById("theory-editor");
    const titleEl = document.getElementById("theory-title");
    return {
        html: editor ? editor.innerHTML : "",
        title: titleEl ? titleEl.value : "",
    };
}

function updateTheoryUndoButtons() {
    const undoBtn = document.getElementById("theory-undo");
    const redoBtn = document.getElementById("theory-redo");
    if (undoBtn) undoBtn.disabled = !theoryUndoManager.canUndo();
    if (redoBtn) redoBtn.disabled = !theoryUndoManager.canRedo();
}

function pushTheoryUndoState(immediate = true) {
    if (isRestoringTheoryUndoState) return;
    const snapshot = captureTheoryEditorSnapshot();

    const doPush = () => {
        const current = theoryUndoManager.history[theoryUndoManager.currentIndex];
        if (!current || current.html !== snapshot.html || current.title !== snapshot.title) {
            theoryUndoManager.pushState(snapshot);
            updateTheoryUndoButtons();
        }
    };

    if (immediate) {
        if (theoryUndoDebounceTimer) {
            clearTimeout(theoryUndoDebounceTimer);
            theoryUndoDebounceTimer = null;
        }
        doPush();
    } else {
        if (theoryUndoDebounceTimer) clearTimeout(theoryUndoDebounceTimer);
        theoryUndoDebounceTimer = setTimeout(doPush, 350);
    }
}

function performTheoryUndo() {
    if (!theoryUndoManager.canUndo()) return false;
    const state = theoryUndoManager.undo();
    if (!state) return false;
    applyTheoryEditorSnapshot(state);
    return true;
}

function performTheoryRedo() {
    if (!theoryUndoManager.canRedo()) return false;
    const state = theoryUndoManager.redo();
    if (!state) return false;
    applyTheoryEditorSnapshot(state);
    return true;
}

function applyTheoryEditorSnapshot(snapshot) {
    if (!snapshot) return;
    isRestoringTheoryUndoState = true;
    try {
        const titleEl = document.getElementById("theory-title");
        const editor = document.getElementById("theory-editor");
        if (titleEl && typeof snapshot.title === "string") {
            titleEl.value = snapshot.title;
        }
        if (editor && typeof snapshot.html === "string") {
            editor.innerHTML = snapshot.html;
            rebindTheoryEditorImages(editor);
        }
        markTheoryDirty();
        updateTheoryStatsCounter();
        updateTheoryToolbarActiveStates();
        updateTheoryUndoButtons();
    } finally {
        isRestoringTheoryUndoState = false;
    }
}

function rebindTheoryEditorImages(container) {
    if (!container) return;
    container.querySelectorAll("img.theory-image").forEach((img) => {
        img.onmousedown = function (e) { e.preventDefault(); };
        img.onclick = function (e) { theoryImageClick(this, e); };
    });
}

function initTheoryUndoHistory() {
    theoryUndoManager.clear();
    pushTheoryUndoState(true);
    updateTheoryUndoButtons();
}

function getTheoryEditorOnboardingPreviewTourId() {
    try {
        const params = new URLSearchParams(window.location.search || "");
        return params.get("onboarding_preview") || params.get("onboarding_tour") || "";
    } catch (error) {
        return "";
    }
}

function isTheoryEditorOnboardingTourActive() {
    return document.body?.dataset?.onboardingTourId === THEORY_EDITOR_ONBOARDING_TOUR_ID;
}

function isTheoryEditorOnboardingDemoRequested() {
    return isTheoryEditorOnboardingTourActive();
}

function createTheoryEditorOnboardingImageSrc() {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="720" height="320" viewBox="0 0 720 320">
            <rect width="720" height="320" rx="28" fill="#eef4ff"/>
            <path d="M72 238c86-82 142-124 210-90 30 15 48 44 88 42 58-2 84-66 138-70 46-4 82 32 140 118" fill="none" stroke="#32208a" stroke-width="18" stroke-linecap="round"/>
            <circle cx="560" cy="92" r="38" fill="#b8c7ff"/>
            <text x="72" y="86" fill="#17213a" font-family="Arial, sans-serif" font-size="34" font-weight="700">${wt('te.k139', 'Схема распространения волны')}</text>
        </svg>
    `.trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createTheoryEditorOnboardingDelta() {
    return {
        ops: [
            { insert: `${wt('te.k140', 'Электромагнитная волна')}\n`, attributes: { header: 1 } },
            { insert: `${wt('te.k141', 'Волна переносит энергию через связанные электрическое и магнитное поля. В задачах важно видеть три параметра: частоту, длину волны и поляризацию.')}\n` },
            {
                insert: { image: createTheoryEditorOnboardingImageSrc() },
                attributes: { width: "56%", align: "center", float: "none" },
            },
            { insert: "\n" },
            { insert: `${wt('te.k142', 'Что запомнить')}\n`, attributes: { header: 2 } },
            { insert: wt('te.k143', 'частота показывает, сколько колебаний происходит за секунду;') },
            { insert: "\n", attributes: { list: "bullet" } },
            { insert: wt('te.k144', 'длина волны связана со скоростью распространения;') },
            { insert: "\n", attributes: { list: "bullet" } },
            { insert: wt('te.k145', 'поляризация описывает направление колебаний поля.') },
            { insert: "\n", attributes: { list: "bullet" } },
        ],
    };
}

function createTheoryEditorOnboardingCatalog() {
    const now = new Date().toISOString();
    return [
        {
            id: "theory-radio-wave-basics",
            title: wt('te.k146', 'Радиофизика: электромагнитные волны'),
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
            title: wt('te.k147', 'Шум и отношение сигнал/шум'),
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
    setTheoryStatus(wt('te.k148', 'Демо-теория готова к редактированию'), "info", "edit_note");
    renderTheoryContextHeader();
    updateTheoryEditorActions();
    renderTheoryLibraryList();
    syncTheoryEditorOnboardingStepState();
    document.title = wt('te.k002', 'Редактор теории');
}

function clearTheoryEditorOnboardingUrlParams() {
    if (typeof window === "undefined" || !window.history || typeof window.history.replaceState !== "function") return;
    try {
        const url = new URL(window.location.href);
        let changed = false;
        ["onboarding_preview", "onboarding_tour", "onboarding_step", "demo_state"].forEach((key) => {
            if (url.searchParams.has(key)) {
                url.searchParams.delete(key);
                changed = true;
            }
        });
        if (changed) {
            window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : "") + url.hash);
        }
    } catch (e) {
        // ignore
    }
}

async function restoreTheoryEditorOnboardingDemoState() {
    clearTheoryEditorOnboardingUrlParams();
    deselectImage();
    removeTheoryEditorOnboardingImageMarker();

    if (!theoryEditorOnboardingSnapshot) {
        if (!theoryEditorState.catalog || theoryEditorState.catalog.length === 0) {
            await Promise.all([
                loadTheoryCatalog({ keepSelection: true }),
                fetchTheoryWorkspaceLimits(),
            ]);
            if (theoryEditorState.context?.theoryId) {
                await loadTheoryById(theoryEditorState.context.theoryId);
            } else {
                resetTheoryEditorState();
                setTheoryStatus(wt('te.k093', 'Новая теория'), "muted", "edit_square");
                document.title = wt('te.k094', 'Новая теория — Редактор теории');
            }
        }
        return;
    }
    const snapshot = theoryEditorOnboardingSnapshot;
    theoryEditorOnboardingSnapshot = null;
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
    marker.setAttribute("aria-label", wt('te.k001', 'Показать инструменты изображения'));
    marker.setAttribute("title", wt('te.k001', 'Показать инструменты изображения'));
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
    if (isTheoryEditorOnboardingTourActive()) {
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
    window.addEventListener("onboarding:finish", () => restoreTheoryEditorOnboardingDemoState());
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
    const fallbackMessage = String(options?.message || wt('te.k003', 'Подтвердите действие.')).trim();
    if (typeof window.NotificationUI !== "undefined" && typeof window.NotificationUI.confirm === "function") {
        return window.NotificationUI.confirm({
            title: String(options?.title || wt('te.k004', 'Подтвердите действие')),
            message: fallbackMessage,
            confirmText: String(options?.confirmText || wt('te.k005', 'Продолжить')),
            cancelText: String(options?.cancelText || wt('te.k006', 'Отмена')),
            variant: String(options?.variant || "warning"),
        });
    }
    if (window.WorkspaceImportClient && typeof window.WorkspaceImportClient.confirmAction === "function") {
        return window.WorkspaceImportClient.confirmAction({
            title: String(options?.title || wt('te.k004', 'Подтвердите действие')),
            message: fallbackMessage,
            confirmText: String(options?.confirmText || wt('te.k005', 'Продолжить')),
            cancelText: String(options?.cancelText || wt('te.k006', 'Отмена')),
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
    const theoryId = String(params.get("theory_id") || params.get("theoryId") || params.get("theory") || "").trim();
    const context = String(params.get("context") || "").trim();
    const returnUrl = normalizeTheoryWorkspaceUrl(String(params.get("return_url") || "").trim(), theoryId)
        || "/editor";

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
    const text = String(message || wt('te.k007', 'Готово')).trim();
    pill.dataset.tone = tone;
    pill.title = text;
    pill.innerHTML = `
        <span class="material-symbols-outlined text-[16px] shrink-0">${icon}</span>
        <span class="theory-status-pill__label">${escapeTheoryHtml(text)}</span>
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
    return "/complexes";
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

function getLegacyTheoryDraftKey(theoryId = "") {
    return `${THEORY_DRAFT_STORAGE_LEGACY_PREFIX}${getTheoryDraftScopeId(theoryId)}`;
}

function getTheoryDraftStorage() {
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            const testKey = "__test_ls__";
            window.localStorage.setItem(testKey, "1");
            window.localStorage.removeItem(testKey);
            return window.localStorage;
        }
    } catch (e) {}
    try {
        if (typeof window !== "undefined" && window.sessionStorage) {
            return window.sessionStorage;
        }
    } catch (e) {}
    return null;
}

function sanitizeDeltaForDraftStorage(delta) {
    if (!delta || !Array.isArray(delta.ops)) {
        return EMPTY_THEORY_DELTA;
    }
    const clonedOps = delta.ops.map(op => {
        if (!op || typeof op !== "object") return op;
        if (op.insert && typeof op.insert === "object" && op.insert.image) {
            const imgSrc = String(op.insert.image || "");
            if (imgSrc.startsWith("data:image/") && imgSrc.length > 512) {
                return {
                    ...op,
                    insert: {
                        ...op.insert,
                        image: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='%23e2e8f0'/><text x='50' y='50' font-size='10' text-anchor='middle' alignment-baseline='middle' fill='%2364748b'>Embedded Image</text></svg>",
                    }
                };
            }
        }
        return { ...op };
    });
    return { ops: clonedOps };
}

function formatTheorySnapshotTime(isoString) {
    if (!isoString) return "";
    try {
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return "";
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const timePart = `${hours}:${minutes}`;
        if (isToday) {
            return timePart;
        }
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        return `${day}.${month} ${timePart}`;
    } catch (e) {
        return "";
    }
}

function clearTheoryDraftByKey(draftKey = "") {
    const normalizedKey = String(draftKey || "").trim();
    if (!normalizedKey) {
        return;
    }
    try {
        window.localStorage?.removeItem(normalizedKey);
    } catch (error) {
        console.warn("[Theory Editor] Failed to clear draft from localStorage", error);
    }
    try {
        window.sessionStorage?.removeItem(normalizedKey);
    } catch (error) {
        console.warn("[Theory Editor] Failed to clear draft from sessionStorage", error);
    }
    updateTheoryDraftsBadge();
}

function clearTheoryDraft(theoryId = "") {
    clearTheoryDraftByKey(getTheoryDraftKey(theoryId));
    clearTheoryDraftByKey(getLegacyTheoryDraftKey(theoryId));
    hideTheoryDraftBanner();
    updateTheoryDraftsBadge();
}

function extractTheoryDeltaStats(delta) {
    if (!delta || !Array.isArray(delta.ops)) {
        return { words: 0, chars: 0, images: 0, preview: "" };
    }
    let text = "";
    let images = 0;
    for (const op of delta.ops) {
        if (typeof op.insert === "string") {
            text += op.insert;
        } else if (op.insert && typeof op.insert === "object" && op.insert.image) {
            images++;
        }
    }
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    const chars = trimmed.length;
    const preview = trimmed.slice(0, 300);
    return { words, chars, images, preview };
}

function extractCurrentTheoryEditorStats() {
    const editor = document.getElementById("theory-editor");
    const titleEl = document.getElementById("theory-title");
    const text = editor ? String(editor.innerText || "").trim() : "";
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const chars = text.length;
    const images = editor ? editor.querySelectorAll("img").length : 0;
    const title = titleEl ? String(titleEl.value || "").trim() : "";
    return { title, words, chars, images };
}

function renderTheoryDeltaToHtmlSnippet(delta) {
    if (!delta || !Array.isArray(delta.ops) || !delta.ops.length) {
        return `<p class="text-text-muted italic text-xs">${escapeTheoryHtml(wt('te.k164', 'Черновик пуст'))}</p>`;
    }
    const lines = deltaToTheoryLines(delta);
    if (!lines.length) {
        return `<p class="text-text-muted italic text-xs">${escapeTheoryHtml(wt('te.k164', 'Черновик пуст'))}</p>`;
    }

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
        const listClass = activeListType === "ordered" ? "list-decimal pl-5 space-y-1" : "list-disc pl-5 space-y-1";
        blocks.push(`<${listTag} class="${listClass}">${activeListItems.join("")}</${listTag}>`);
        activeListType = null;
        activeListItems = [];
    };

    const maxLines = Math.min(lines.length, 12);
    for (let i = 0; i < maxLines; i++) {
        const line = lines[i];
        const attrs = line && typeof line === "object" ? line.attrs || {} : {};
        const lineHtml = renderTheoryLineContent(line && line.segments);
        const listType = attrs.list === "ordered" ? "ordered" : (attrs.list === "bullet" || attrs.list === "check" ? "bullet" : null);

        if (listType) {
            if (activeListType && activeListType !== listType) flushList();
            activeListType = listType;
            activeListItems.push(`<li>${lineHtml}</li>`);
            continue;
        }

        flushList();
        const headerLevel = Number(attrs.header);
        if (Number.isInteger(headerLevel) && headerLevel >= 1 && headerLevel <= 6) {
            blocks.push(`<h${headerLevel} class="font-bold text-sm mt-1.5 mb-1 text-text-main">${lineHtml}</h${headerLevel}>`);
        } else if (attrs.blockquote) {
            blocks.push(`<blockquote class="border-l-2 border-primary/50 pl-2 italic text-xs text-text-secondary my-1">${lineHtml}</blockquote>`);
        } else {
            blocks.push(`<p class="text-xs text-text-main my-1">${lineHtml || "&nbsp;"}</p>`);
        }
    }

    flushList();
    if (lines.length > 12) {
        blocks.push(`<p class="text-[11px] text-text-muted mt-2 pt-1 border-t border-border-subtle">... (+${lines.length - 12})</p>`);
    }
    return blocks.join("");
}

function readTheoryDraft(theoryId = "") {
    const primaryKey = getTheoryDraftKey(theoryId);
    const legacyKey = getLegacyTheoryDraftKey(theoryId);
    let raw = null;

    try {
        raw = window.localStorage?.getItem(primaryKey);
    } catch (e) {}
    if (!raw) {
        try {
            raw = window.localStorage?.getItem(legacyKey);
        } catch (e) {}
    }
    if (!raw) {
        try {
            raw = window.sessionStorage?.getItem(legacyKey);
        } catch (e) {}
    }
    if (!raw) {
        try {
            raw = window.sessionStorage?.getItem(primaryKey);
        } catch (e) {}
    }

    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return null;
        }

        let snapshots = [];
        if (Array.isArray(parsed.snapshots) && parsed.snapshots.length > 0) {
            snapshots = parsed.snapshots.map((s, idx) => {
                const sDelta = s.delta && typeof s.delta === "object" ? s.delta : EMPTY_THEORY_DELTA;
                const sStats = extractTheoryDeltaStats(sDelta);
                return {
                    id: s.id || `snap_${idx}`,
                    title: String(s.title || "").trim(),
                    delta: sDelta,
                    savedAt: String(s.savedAt || "").trim(),
                    wordCount: typeof s.wordCount === "number" ? s.wordCount : sStats.words,
                    charCount: typeof s.charCount === "number" ? s.charCount : sStats.chars,
                    imageCount: typeof s.imageCount === "number" ? s.imageCount : sStats.images,
                    previewText: String(s.previewText || sStats.preview || "").trim(),
                };
            });
        } else {
            const delta = parsed.delta && typeof parsed.delta === "object" ? parsed.delta : EMPTY_THEORY_DELTA;
            const stats = extractTheoryDeltaStats(delta);
            snapshots = [{
                id: "snap_legacy",
                title: String(parsed.title || "").trim(),
                delta,
                savedAt: String(parsed.savedAt || "").trim(),
                wordCount: typeof parsed.wordCount === "number" ? parsed.wordCount : stats.words,
                charCount: typeof parsed.charCount === "number" ? parsed.charCount : stats.chars,
                imageCount: typeof parsed.imageCount === "number" ? parsed.imageCount : stats.images,
                previewText: String(parsed.previewText || stats.preview || "").trim(),
            }];
        }

        const top = snapshots[0] || {};
        return {
            key: primaryKey,
            version: parsed.version || 1,
            theoryId: theoryId || parsed.theoryId || theoryEditorState.activeTheoryId || "",
            context: parsed.context || {},
            snapshots,
            title: top.title || "",
            delta: top.delta || EMPTY_THEORY_DELTA,
            savedAt: top.savedAt || "",
            wordCount: top.wordCount || 0,
            charCount: top.charCount || 0,
            imageCount: top.imageCount || 0,
            previewText: top.previewText || "",
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

    const title = String(titleEl.value || "").trim();
    const rawDelta = editorHtmlToTheoryDelta();
    const delta = sanitizeDeltaForDraftStorage(rawDelta);
    const stats = extractTheoryDeltaStats(delta);
    const storage = getTheoryDraftStorage();
    if (!storage) return;

    try {
        const existingDraft = readTheoryDraft();
        let snapshots = [];
        if (existingDraft && Array.isArray(existingDraft.snapshots) && existingDraft.snapshots.length > 0) {
            snapshots = existingDraft.snapshots.map(s => ({ ...s }));
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const nowMs = now.getTime();

        if (snapshots.length > 0) {
            const topSnapshot = snapshots[0];
            const topSavedAtMs = topSnapshot?.savedAt ? new Date(topSnapshot.savedAt).getTime() : 0;
            const isRecent = topSavedAtMs > 0 && (nowMs - topSavedAtMs) < THEORY_SNAPSHOT_DEBOUNCE_INTERVAL_MS;

            if (isRecent) {
                topSnapshot.title = title;
                topSnapshot.delta = delta;
                topSnapshot.savedAt = nowIso;
                topSnapshot.wordCount = stats.words;
                topSnapshot.charCount = stats.chars;
                topSnapshot.imageCount = stats.images;
                topSnapshot.previewText = stats.preview;
            } else {
                const newSnapshot = {
                    id: `snap_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
                    title,
                    delta,
                    savedAt: nowIso,
                    wordCount: stats.words,
                    charCount: stats.chars,
                    imageCount: stats.images,
                    previewText: stats.preview,
                };
                snapshots.unshift(newSnapshot);
                if (snapshots.length > MAX_THEORY_SNAPSHOTS) {
                    snapshots.length = MAX_THEORY_SNAPSHOTS;
                }
            }
        } else {
            snapshots = [{
                id: `snap_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
                title,
                delta,
                savedAt: nowIso,
                wordCount: stats.words,
                charCount: stats.chars,
                imageCount: stats.images,
                previewText: stats.preview,
            }];
        }

        const payload = {
            version: 2,
            theoryId: theoryEditorState.activeTheoryId || "",
            context: theoryEditorState.context || {},
            snapshots,
        };

        storage.setItem(draftKey, JSON.stringify(payload));
        updateTheoryDraftsBadge();
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
    const currentDelta = sanitizeDeltaForDraftStorage(editorHtmlToTheoryDelta());
    return draft.title === currentTitle
        && JSON.stringify(draft.delta || EMPTY_THEORY_DELTA) === JSON.stringify(currentDelta);
}

function listTheoryDrafts() {
    const drafts = [];
    const seenKeys = new Set();
    const storages = [];
    try {
        if (typeof window !== "undefined" && window.localStorage) storages.push(window.localStorage);
    } catch (e) {}
    try {
        if (typeof window !== "undefined" && window.sessionStorage) storages.push(window.sessionStorage);
    } catch (e) {}

    const currentKey = getTheoryDraftKey();
    const currentLegacyKey = getLegacyTheoryDraftKey();

    for (const storage of storages) {
        let keys = [];
        try {
            keys = Object.keys(storage);
        } catch (e) {
            continue;
        }

        for (const k of keys) {
            if (!k.startsWith(THEORY_DRAFT_STORAGE_PREFIX) && !k.startsWith(THEORY_DRAFT_STORAGE_LEGACY_PREFIX)) {
                continue;
            }
            if (seenKeys.has(k)) {
                continue;
            }
            seenKeys.add(k);

            let raw = null;
            try {
                raw = storage.getItem(k);
            } catch (e) {
                continue;
            }
            if (!raw) continue;

            try {
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== "object") continue;

                let snapshots = [];
                if (Array.isArray(parsed.snapshots) && parsed.snapshots.length > 0) {
                    snapshots = parsed.snapshots;
                } else if (parsed.delta) {
                    const stats = extractTheoryDeltaStats(parsed.delta);
                    snapshots = [{
                        id: "snap_legacy",
                        title: String(parsed.title || "").trim(),
                        delta: parsed.delta,
                        savedAt: String(parsed.savedAt || "").trim(),
                        wordCount: typeof parsed.wordCount === "number" ? parsed.wordCount : stats.words,
                        charCount: typeof parsed.charCount === "number" ? parsed.charCount : stats.chars,
                        imageCount: typeof parsed.imageCount === "number" ? parsed.imageCount : stats.images,
                        previewText: String(parsed.previewText || stats.preview || "").trim(),
                    }];
                }

                if (!snapshots.length) continue;

                const top = snapshots[0];
                const scope = k.startsWith(THEORY_DRAFT_STORAGE_PREFIX)
                    ? k.slice(THEORY_DRAFT_STORAGE_PREFIX.length)
                    : k.slice(THEORY_DRAFT_STORAGE_LEGACY_PREFIX.length);

                const isBoundTheory = scope.startsWith("theory:");
                const itemTheoryId = isBoundTheory ? scope.slice("theory:".length) : (parsed.theoryId || "");
                const isBoundCourse = !isBoundTheory && (scope.includes(":course:") || scope.includes(":module:") || (scope.split(":").length > 2 && scope.split(":")[2] !== ""));
                const isCurrent = k === currentKey || k === currentLegacyKey;

                const normalizedDraft = {
                    key: k,
                    version: parsed.version || 2,
                    theoryId: itemTheoryId,
                    scopeId: scope,
                    title: top.title,
                    delta: top.delta,
                    savedAt: top.savedAt,
                    wordCount: top.wordCount,
                    charCount: top.charCount,
                    imageCount: top.imageCount,
                    previewText: top.previewText,
                    snapshots,
                };

                drafts.push({
                    key: k,
                    theoryId: itemTheoryId,
                    scopeId: scope,
                    title: top.title,
                    savedAt: top.savedAt,
                    snapshotsCount: snapshots.length,
                    wordCount: top.wordCount,
                    imageCount: top.imageCount,
                    previewText: top.previewText,
                    contextType: isBoundTheory ? "bound_theory" : (isBoundCourse ? "bound_course" : "standalone"),
                    isCurrent,
                    draft: normalizedDraft,
                });
            } catch (e) {}
        }
    }

    drafts.sort((a, b) => {
        const timeA = a.savedAt ? new Date(a.savedAt).getTime() : 0;
        const timeB = b.savedAt ? new Date(b.savedAt).getTime() : 0;
        return timeB - timeA;
    });

    return drafts;
}

function cleanupExpiredTheoryDrafts(days = 14) {
    const drafts = listTheoryDrafts();
    const thresholdMs = days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleanedCount = 0;
    for (const d of drafts) {
        if (!d.savedAt) continue;
        const savedTime = new Date(d.savedAt).getTime();
        if (Number.isFinite(savedTime) && (now - savedTime) > thresholdMs) {
            clearTheoryDraftByKey(d.key);
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) {
        updateTheoryDraftsBadge();
    }
    return cleanedCount;
}

function clearAllTheoryDrafts() {
    const drafts = listTheoryDrafts();
    for (const d of drafts) {
        clearTheoryDraftByKey(d.key);
    }
    hideTheoryDraftBanner();
    updateTheoryDraftsBadge();
}

function updateTheoryDraftsBadge() {
    const drafts = listTheoryDrafts();
    const count = drafts.length;

    const badgeBtn = document.getElementById("theory-drafts-badge-btn");
    const countEl = document.getElementById("theory-drafts-badge-count");
    if (badgeBtn) {
        if (count > 0) {
            badgeBtn.classList.remove("hidden");
            badgeBtn.classList.add("inline-flex");
            if (countEl) {
                countEl.textContent = String(count);
            }
        } else {
            badgeBtn.classList.add("hidden");
            badgeBtn.classList.remove("inline-flex");
            if (countEl) {
                countEl.textContent = "0";
            }
        }
    }

    const registryBtn = document.getElementById("theory-draft-banner-registry-btn");
    if (registryBtn) {
        registryBtn.hidden = count <= 1;
    }
}

function hideTheoryDraftBanner() {
    const banner = document.getElementById("theory-draft-banner");
    if (banner) {
        banner.hidden = true;
    }
}

function showTheoryDraftBanner(draft, theoryId = "") {
    const banner = document.getElementById("theory-draft-banner");
    if (!banner || !draft) return;

    const timeEl = document.getElementById("theory-draft-banner-meta");
    if (timeEl) {
        const timeStr = draft.savedAt ? formatTheoryListDate(draft.savedAt) : "";
        const titleStr = draft.title ? `«${draft.title}»` : wt('te.k163', 'Без названия');
        const wordsStr = `${draft.wordCount || 0} ${wt('te.k161', 'слов')}`;
        timeEl.textContent = `· ${titleStr} (${wordsStr}${timeStr ? `, ${timeStr}` : ""})`;
    }

    const registryBtn = document.getElementById("theory-draft-banner-registry-btn");
    const previewBtn = document.getElementById("theory-draft-banner-preview-btn");
    const restoreBtn = document.getElementById("theory-draft-banner-restore-btn");
    const deleteBtn = document.getElementById("theory-draft-banner-delete-btn");

    if (registryBtn) {
        registryBtn.onclick = () => {
            openTheoryDraftsRegistryModal();
        };
    }
    if (previewBtn) {
        previewBtn.onclick = () => {
            openTheoryDraftModal(draft, theoryId);
        };
    }
    if (restoreBtn) {
        restoreBtn.onclick = () => {
            applyRestoredTheoryDraft(draft);
        };
    }
    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            const confirmed = await theoryEditorConfirm({
                title: wt('te.k155', 'Удалить черновик'),
                message: wt('te.k165', 'Вы действительно хотите удалить сохранённый черновик этой теории? Это действие нельзя отменить.'),
                confirmText: wt('te.k155', 'Удалить черновик'),
                cancelText: wt('te.k122', 'Остаться'),
                variant: 'error',
            });
            if (confirmed) {
                clearTheoryDraft(theoryId);
                theoryEditorToast(wt('te.k158', 'Черновик удалён'), 'info');
            }
        };
    }

    banner.hidden = false;
    updateTheoryDraftsBadge();
}

function applyRestoredTheoryDraft(draft) {
    if (!draft) return;
    setTheoryEditorContent(draft.title, draft.delta || EMPTY_THEORY_DELTA);
    theoryEditorState.dirty = true;
    updateTheoryEditorActions();
    setTheoryStatus(wt('te.k012', 'Черновик восстановлен'), "warning", "history");
    theoryEditorToast(wt('te.k013', 'Черновик восстановлен'), "info", 2400);
    hideTheoryDraftBanner();
    scheduleTheoryDraftSave();
}

function openTheoryDraftModal(draft, theoryId = "") {
    return new Promise((resolve) => {
        let modalEl = document.getElementById("theory-draft-modal");
        if (modalEl) {
            modalEl.remove();
        }

        const snapshots = (draft.snapshots && Array.isArray(draft.snapshots) && draft.snapshots.length > 0)
            ? draft.snapshots
            : [draft];
        let activeSnapshotIndex = 0;

        const currentTitleEl = document.getElementById("theory-title");
        const currentTitle = currentTitleEl ? String(currentTitleEl.value || "").trim() || wt('te.k163', 'Без названия') : wt('te.k163', 'Без названия');
        const currentStats = extractCurrentTheoryEditorStats();

        const initialSnapshot = snapshots[0];
        const draftTitle = initialSnapshot.title || wt('te.k163', 'Без названия');
        const draftTime = initialSnapshot.savedAt ? formatTheoryListDate(initialSnapshot.savedAt) : "";
        const draftWords = initialSnapshot.wordCount ?? 0;
        const draftImages = initialSnapshot.imageCount ?? 0;
        const previewHtml = renderTheoryDeltaToHtmlSnippet(initialSnapshot.delta);

        const snapshotsSelectorHtml = snapshots.length > 1 ? `
        <div class="space-y-1.5 pt-1" id="theory-draft-snapshots-container">
            <div class="flex items-center justify-between text-xs font-semibold text-text-secondary">
                <span class="uppercase tracking-wider text-[11px]">${escapeTheoryHtml(wt('te.k167', 'Контрольные точки'))}</span>
                <span class="text-[11px] font-normal text-text-muted">${snapshots.length} ${snapshots.length === 1 ? escapeTheoryHtml(wt('te.k174', 'точка')) : escapeTheoryHtml(wt('te.k175', 'точек'))}</span>
            </div>
            <div id="theory-draft-snapshots-selector" class="flex items-center gap-1.5 overflow-x-auto py-1 theory-scroll">
                ${snapshots.map((snap, idx) => {
                    const timeStr = formatTheorySnapshotTime(snap.savedAt);
                    const wordsStr = `${snap.wordCount || 0} ${escapeTheoryHtml(wt('te.k161', 'слов'))}`;
                    const activeCls = idx === 0 ? "is-active" : "";
                    return `<button type="button" class="theory-snapshot-pill ${activeCls}" data-snapshot-index="${idx}">
                        <span>${escapeTheoryHtml(timeStr || `#${idx + 1}`)}</span>
                        <span class="opacity-75 text-[10px]">· ${wordsStr}</span>
                    </button>`;
                }).join("")}
            </div>
        </div>` : "";

        const modalHtml = `
<div id="theory-draft-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="theory-draft-modal-title">
    <div class="w-full max-w-2xl bg-surface-1 border border-border-subtle rounded-2xl shadow-xl flex flex-col max-h-[88vh] overflow-hidden animate-slide-up">
        <!-- Header -->
        <div class="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between shrink-0 bg-surface-2/40">
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="material-symbols-outlined text-primary text-[22px] shrink-0">history_edu</span>
                <div class="min-w-0">
                    <h3 id="theory-draft-modal-title" class="text-sm sm:text-base font-bold text-text-main leading-tight truncate">${escapeTheoryHtml(wt('te.k150', 'Обнаружен несохранённый черновик'))}</h3>
                    <p id="theory-draft-modal-subtitle" class="text-xs text-text-secondary leading-tight mt-0.5">${escapeTheoryHtml(wt('te.k159', 'Сохранён:'))} <span id="theory-draft-modal-saved-time">${escapeTheoryHtml(draftTime || wt('te.k008', 'несколько минут назад'))}</span></p>
                </div>
            </div>
            <button id="theory-draft-modal-close-btn" type="button" class="p-1 rounded-lg text-text-secondary hover:text-text-main hover:bg-surface-2 transition-colors shrink-0" aria-label="Close">
                <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
        </div>

        <!-- Body: Comparison & Preview -->
        <div class="p-5 overflow-y-auto space-y-4 flex-1 theory-scroll">
            ${snapshotsSelectorHtml}

            <!-- Version Comparison Matrix -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <!-- Draft Card -->
                <div class="p-3.5 rounded-xl border border-primary/30 bg-primary/5 flex flex-col gap-1" id="theory-draft-modal-draft-card">
                    <div class="flex items-center justify-between font-bold text-primary">
                        <span class="inline-flex items-center gap-1.5">
                            <span class="material-symbols-outlined text-[16px]">edit_note</span>
                            <span>${escapeTheoryHtml(wt('te.k152', 'В черновике'))}</span>
                        </span>
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-semibold">${escapeTheoryHtml(wt('the.k061', 'Черновик'))}</span>
                    </div>
                    <div id="theory-draft-modal-draft-title" class="font-semibold text-text-main truncate text-sm mt-1">${escapeTheoryHtml(draftTitle)}</div>
                    <div id="theory-draft-modal-draft-stats" class="text-text-secondary text-[11px] flex items-center gap-2.5 mt-0.5">
                        <span>${draftWords} ${escapeTheoryHtml(wt('te.k161', 'слов'))}</span>
                        <span>•</span>
                        <span>${draftImages} ${escapeTheoryHtml(wt('te.k162', 'изображений'))}</span>
                    </div>
                </div>

                <!-- Current Opened Card -->
                <div class="p-3.5 rounded-xl border border-border-subtle bg-surface-2/30 flex flex-col gap-1">
                    <div class="flex items-center justify-between font-bold text-text-secondary">
                        <span class="inline-flex items-center gap-1.5">
                            <span class="material-symbols-outlined text-[16px]">draft</span>
                            <span>${escapeTheoryHtml(wt('te.k153', 'Открытая версия'))}</span>
                        </span>
                    </div>
                    <div class="font-semibold text-text-main truncate text-sm mt-1">${escapeTheoryHtml(currentTitle)}</div>
                    <div class="text-text-secondary text-[11px] flex items-center gap-2.5 mt-0.5">
                        <span>${currentStats.words} ${escapeTheoryHtml(wt('te.k161', 'слов'))}</span>
                        <span>•</span>
                        <span>${currentStats.images} ${escapeTheoryHtml(wt('te.k162', 'изображений'))}</span>
                    </div>
                </div>
            </div>

            <!-- Content Preview Container -->
            <div>
                <div class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">${escapeTheoryHtml(wt('te.k154', 'Предпросмотр содержимого черновика'))}</div>
                <div id="theory-draft-preview-box" class="p-4 rounded-xl border border-border-subtle bg-surface-2/20 max-h-56 overflow-y-auto text-sm theory-scroll leading-relaxed">
                    ${previewHtml}
                </div>
            </div>
        </div>

        <!-- Footer: 3 Clear Actions -->
        <div class="px-5 py-3 border-t border-border-subtle bg-surface-2/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <!-- Delete Draft button -->
            <button id="theory-draft-delete-btn" type="button" class="btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-error hover:bg-error/10 hover:border-error/30 transition-all">
                <span class="material-symbols-outlined text-[16px]">delete</span>
                <span>${escapeTheoryHtml(wt('te.k155', 'Удалить черновик'))}</span>
            </button>

            <!-- Right action pair: Defer and Restore -->
            <div class="flex items-center gap-2">
                <button id="theory-draft-defer-btn" type="button" class="btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold hover:bg-surface-2 transition-all">
                    <span>${escapeTheoryHtml(wt('te.k156', 'Отложить'))}</span>
                </button>
                <button id="theory-draft-restore-btn" type="button" class="btn-primary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-sm hover:shadow-md transition-all">
                    <span class="material-symbols-outlined text-[16px]">restore</span>
                    <span>${escapeTheoryHtml(wt('te.k157', 'Восстановить черновик'))}</span>
                </button>
            </div>
        </div>
    </div>
</div>
        `.trim();

        const template = document.createElement("div");
        template.innerHTML = modalHtml;
        modalEl = template.firstElementChild;
        document.body.appendChild(modalEl);

        const updateActiveSnapshotView = (index) => {
            activeSnapshotIndex = index;
            const snap = snapshots[index];
            if (!snap) return;

            modalEl.querySelectorAll(".theory-snapshot-pill").forEach((pill, idx) => {
                if (idx === index) {
                    pill.classList.add("is-active");
                } else {
                    pill.classList.remove("is-active");
                }
            });

            const draftCardTitle = modalEl.querySelector("#theory-draft-modal-draft-title");
            if (draftCardTitle) {
                draftCardTitle.textContent = snap.title || wt('te.k163', 'Без названия');
            }

            const draftCardStats = modalEl.querySelector("#theory-draft-modal-draft-stats");
            if (draftCardStats) {
                draftCardStats.innerHTML = `<span>${snap.wordCount ?? 0} ${escapeTheoryHtml(wt('te.k161', 'слов'))}</span><span>•</span><span>${snap.imageCount ?? 0} ${escapeTheoryHtml(wt('te.k162', 'изображений'))}</span>`;
            }

            const savedTimeEl = modalEl.querySelector("#theory-draft-modal-saved-time");
            if (savedTimeEl) {
                savedTimeEl.textContent = snap.savedAt ? formatTheoryListDate(snap.savedAt) : wt('te.k008', 'несколько минут назад');
            }

            const previewBox = modalEl.querySelector("#theory-draft-preview-box");
            if (previewBox) {
                previewBox.innerHTML = renderTheoryDeltaToHtmlSnippet(snap.delta);
            }
        };

        modalEl.querySelectorAll(".theory-snapshot-pill").forEach((pill) => {
            pill.onclick = () => {
                updateActiveSnapshotView(Number(pill.dataset.snapshotIndex));
            };
        });

        const cleanup = () => {
            if (modalEl && modalEl.parentNode) {
                modalEl.parentNode.removeChild(modalEl);
            }
            document.removeEventListener("keydown", onKeyDown);
        };

        const onRestore = () => {
            cleanup();
            const selectedSnapshot = snapshots[activeSnapshotIndex] || snapshots[0];
            applyRestoredTheoryDraft(selectedSnapshot);
            resolve("restored");
        };

        const onDefer = () => {
            cleanup();
            showTheoryDraftBanner(draft, theoryId);
            theoryEditorToast(wt('te.k149', 'Черновик отложен'), "info", 2400);
            resolve("deferred");
        };

        const onDelete = async () => {
            const confirmed = await theoryEditorConfirm({
                title: wt('te.k155', 'Удалить черновик'),
                message: wt('te.k165', 'Вы действительно хотите удалить сохранённый черновик этой теории? Это действие нельзя отменить.'),
                confirmText: wt('te.k155', 'Удалить черновик'),
                cancelText: wt('te.k122', 'Остаться'),
                variant: 'error',
            });
            if (confirmed) {
                cleanup();
                clearTheoryDraft(theoryId);
                theoryEditorToast(wt('te.k158', 'Черновик удалён'), "info");
                resolve("deleted");
            }
        };

        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onDefer();
            }
        };

        document.addEventListener("keydown", onKeyDown);

        const restoreBtn = document.getElementById("theory-draft-restore-btn");
        const deferBtn = document.getElementById("theory-draft-defer-btn");
        const deleteBtn = document.getElementById("theory-draft-delete-btn");
        const closeBtn = document.getElementById("theory-draft-modal-close-btn");

        if (restoreBtn) restoreBtn.onclick = onRestore;
        if (deferBtn) deferBtn.onclick = onDefer;
        if (deleteBtn) deleteBtn.onclick = onDelete;
        if (closeBtn) closeBtn.onclick = onDefer;

        modalEl.onclick = (event) => {
            if (event.target === modalEl) {
                onDefer();
            }
        };
    });
}

function openTheoryDraftsRegistryModal() {
    return new Promise((resolve) => {
        let modalEl = document.getElementById("theory-drafts-registry-modal");
        if (modalEl) {
            modalEl.remove();
        }

        const renderModalContent = () => {
            const drafts = listTheoryDrafts();
            const count = drafts.length;

            const modalHtml = `
<div id="theory-drafts-registry-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="theory-drafts-registry-modal-title">
    <div class="w-full max-w-3xl bg-surface-1 border border-border-subtle rounded-2xl shadow-xl flex flex-col max-h-[88vh] overflow-hidden animate-slide-up">
        <!-- Header -->
        <div class="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between shrink-0 bg-surface-2/40">
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="material-symbols-outlined text-primary text-[22px] shrink-0">history_edu</span>
                <div class="min-w-0 flex items-center gap-2">
                    <h3 id="theory-drafts-registry-modal-title" class="text-sm sm:text-base font-bold text-text-main leading-tight truncate">${escapeTheoryHtml(wt('te.k176', 'Реестр черновиков'))}</h3>
                    <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">${count}</span>
                </div>
            </div>
            <button id="theory-drafts-registry-close-btn" type="button" class="p-1 rounded-lg text-text-secondary hover:text-text-main hover:bg-surface-2 transition-colors shrink-0" aria-label="Close">
                <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
        </div>

        <!-- Subheader / Action Bar -->
        <div class="px-5 py-2.5 border-b border-border-subtle bg-surface-2/20 flex items-center justify-between gap-3 text-xs">
            <div class="text-text-secondary font-medium">
                <span>${escapeTheoryHtml(wt('the.k062', 'Все черновики'))}: ${count}</span>
            </div>
            ${count > 0 ? `
            <button id="theory-drafts-clear-all-btn" type="button" class="btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-error hover:bg-error/10 hover:border-error/30 transition-all">
                <span class="material-symbols-outlined text-[15px]">delete_sweep</span>
                <span>${escapeTheoryHtml(wt('te.k169', 'Очистить все черновики'))}</span>
            </button>` : ''}
        </div>

        <!-- Body / Drafts List -->
        <div class="p-5 overflow-y-auto space-y-3 flex-1 theory-scroll" id="theory-drafts-registry-list">
            ${count === 0 ? `
            <div class="text-center py-12 flex flex-col items-center justify-center">
                <span class="material-symbols-outlined text-text-muted text-[42px] mb-2">draft</span>
                <p class="text-text-muted text-sm font-medium">${escapeTheoryHtml(wt('te.k172', 'Нет сохранённых черновиков'))}</p>
            </div>` : drafts.map((d, index) => {
                const titleStr = d.title || wt('te.k163', 'Без названия');
                const timeStr = formatTheorySnapshotTime(d.savedAt);
                const pointsCountStr = `${d.snapshotsCount} ${d.snapshotsCount === 1 ? escapeTheoryHtml(wt('te.k174', 'точка')) : escapeTheoryHtml(wt('te.k175', 'точек'))}`;
                const contextBadge = d.contextType === 'bound_course'
                    ? `<span class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">${escapeTheoryHtml(wt('te.k178', 'Привязан к курсу/теме'))}</span>`
                    : `<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">${escapeTheoryHtml(wt('te.k177', 'Автономный материал'))}</span>`;
                const currentBadge = d.isCurrent
                    ? `<span class="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">${escapeTheoryHtml(wt('the.k061', 'Черновик'))}</span>`
                    : '';
                const previewSnippet = d.previewText ? escapeTheoryHtml(d.previewText.slice(0, 160)) : escapeTheoryHtml(wt('te.k164', 'Черновик пуст'));

                return `
            <div class="p-3.5 rounded-xl border border-border-subtle bg-surface-2/15 hover:border-border-normal hover:bg-surface-2/30 transition-all flex flex-col gap-2" data-draft-key="${escapeTheoryHtml(d.key)}">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap mb-1">
                            ${currentBadge}
                            ${contextBadge}
                            <span class="text-[11px] text-text-muted font-normal">${escapeTheoryHtml(timeStr)}</span>
                        </div>
                        <h4 class="font-bold text-sm text-text-main truncate">${escapeTheoryHtml(titleStr)}</h4>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button type="button" class="theory-registry-open-btn btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold hover:bg-surface-2 transition-all" data-draft-index="${index}">
                            <span class="material-symbols-outlined text-[15px]">open_in_new</span>
                            <span>${escapeTheoryHtml(wt('te.k173', 'Открыть в редакторе'))}</span>
                        </button>
                        <button type="button" class="theory-registry-delete-btn p-1.5 rounded-lg text-text-secondary hover:text-error hover:bg-error/10 transition-colors" data-draft-key="${escapeTheoryHtml(d.key)}" title="${escapeTheoryHtml(wt('te.k155', 'Удалить черновик'))}">
                            <span class="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                    </div>
                </div>
                <div class="text-xs text-text-secondary line-clamp-2 bg-surface-1/50 p-2 rounded-lg border border-border-subtle/50">
                    ${previewSnippet}
                </div>
                <div class="flex items-center gap-3 text-[11px] text-text-muted font-medium">
                    <span>${pointsCountStr}</span>
                    <span>•</span>
                    <span>${d.wordCount} ${escapeTheoryHtml(wt('te.k161', 'слов'))}</span>
                    <span>•</span>
                    <span>${d.imageCount} ${escapeTheoryHtml(wt('te.k162', 'изображений'))}</span>
                </div>
            </div>`;
            }).join("")}
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-border-subtle bg-surface-2/30 flex items-center justify-end gap-2 shrink-0">
            <button id="theory-drafts-registry-cancel-btn" type="button" class="btn-secondary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold hover:bg-surface-2 transition-all">
                <span>${escapeTheoryHtml(wt('te.k122', 'Остаться'))}</span>
            </button>
        </div>
    </div>
</div>
            `.trim();

            const template = document.createElement("div");
            template.innerHTML = modalHtml;
            const newModal = template.firstElementChild;
            if (modalEl && modalEl.parentNode) {
                modalEl.replaceWith(newModal);
            } else {
                document.body.appendChild(newModal);
            }
            modalEl = newModal;

            const close = () => {
                if (modalEl && modalEl.parentNode) {
                    modalEl.parentNode.removeChild(modalEl);
                }
                document.removeEventListener("keydown", onKeyDown);
                resolve();
            };

            const onKeyDown = (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                }
            };
            document.addEventListener("keydown", onKeyDown);

            modalEl.querySelector("#theory-drafts-registry-close-btn")?.addEventListener("click", close);
            modalEl.querySelector("#theory-drafts-registry-cancel-btn")?.addEventListener("click", close);

            modalEl.onclick = (event) => {
                if (event.target === modalEl) {
                    close();
                }
            };

            const clearAllBtn = modalEl.querySelector("#theory-drafts-clear-all-btn");
            if (clearAllBtn) {
                clearAllBtn.onclick = async () => {
                    const confirmed = await theoryEditorConfirm({
                        title: wt('te.k169', 'Очистить все черновики'),
                        message: wt('te.k170', 'Вы действительно хотите удалить все сохранённые черновики теорий? Это действие нельзя отменить.'),
                        confirmText: wt('te.k169', 'Очистить все черновики'),
                        cancelText: wt('te.k122', 'Остаться'),
                        variant: 'error',
                    });
                    if (confirmed) {
                        clearAllTheoryDrafts();
                        theoryEditorToast(wt('te.k171', 'Все черновики удалены'), 'info');
                        renderModalContent();
                    }
                };
            }

            modalEl.querySelectorAll(".theory-registry-delete-btn").forEach((btn) => {
                btn.onclick = async () => {
                    const draftKey = btn.dataset.draftKey;
                    const confirmed = await theoryEditorConfirm({
                        title: wt('te.k155', 'Удалить черновик'),
                        message: wt('te.k165', 'Вы действительно хотите удалить сохранённый черновик этой теории? Это действие нельзя отменить.'),
                        confirmText: wt('te.k155', 'Удалить черновик'),
                        cancelText: wt('te.k122', 'Остаться'),
                        variant: 'error',
                    });
                    if (confirmed) {
                        clearTheoryDraftByKey(draftKey);
                        theoryEditorToast(wt('te.k158', 'Черновик удалён'), 'info');
                        updateTheoryDraftsBadge();
                        renderModalContent();
                    }
                };
            });

            modalEl.querySelectorAll(".theory-registry-open-btn").forEach((btn) => {
                btn.onclick = async () => {
                    const index = Number(btn.dataset.draftIndex);
                    const item = drafts[index];
                    if (!item) return;

                    if (item.isCurrent) {
                        close();
                        openTheoryDraftModal(item.draft, item.theoryId);
                        return;
                    }

                    const canLeave = await confirmDiscardUnsavedChanges();
                    if (!canLeave) return;

                    close();
                    if (item.theoryId) {
                        theoryEditorNavigate(`/editor/Theory_Editor.html?theory_id=${encodeURIComponent(item.theoryId)}`);
                    } else {
                        const scopeParts = String(item.scopeId || "").split(":");
                        const url = new URL("/editor/Theory_Editor.html", window.location.origin);
                        if (scopeParts[1] && scopeParts[1] !== "standalone") url.searchParams.set("context", scopeParts[1]);
                        if (scopeParts[2]) url.searchParams.set("module_id", scopeParts[2]);
                        if (scopeParts[3]) url.searchParams.set("topic_id", scopeParts[3]);
                        if (scopeParts[4]) url.searchParams.set("complex_id", scopeParts[4]);
                        theoryEditorNavigate(`${url.pathname}${url.search}`);
                    }
                };
            });
        };

        renderModalContent();
    });
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

    const outcome = await openTheoryDraftModal(draft, theoryId);
    return outcome === "restored";
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
    const usageNoteEl = document.getElementById("theory-usage-note");
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
                ? `${wt('te.k014', 'Вы редактируете материал, который выбран для темы ')}${topicLabel}.`
                : wt('te.k015', 'Вы редактируете материал, который выбран для одной из тем.');
        } else if (context.context === "complex") {
            const complexLabel = context.complexName || context.complexId || wt('te.k016', 'текущего комплекса');
            copyEl.textContent = `${wt('te.k017', 'Вы редактируете материал, который связан с ')}${complexLabel}.`;
        } else {
            copyEl.textContent = wt('te.k018', 'Материалы: текст, структура и изображения теории.');
        }
    }

    if (usageNoteEl) {
        if (context.context === "topic") {
            const topicLabel = [context.moduleName || context.moduleId, context.topicName || context.topicId]
                .filter(Boolean)
                .join(" / ");
            usageNoteEl.textContent = topicLabel ? `• ${topicLabel}` : "";
        } else if (context.context === "complex") {
            const complexLabel = context.complexName || context.complexId || "";
            usageNoteEl.textContent = complexLabel ? `• ${complexLabel}` : "";
        } else {
            usageNoteEl.textContent = "";
        }
    }

    if (backBtn && backLabel) {
        const returnUrl = normalizeTheoryWorkspaceUrl(context.returnUrl, theoryEditorState.activeTheoryId) || THEORY_CENTER_ROUTE;
        const isCenterReturn = returnUrl.includes("Theory_Center");
        backBtn.dataset.target = returnUrl;
        backBtn.hidden = isCenterReturn;
        backBtn.classList.toggle("hidden", isCenterReturn);
        if (isCenterReturn) {
            backLabel.textContent = wt('te.k019', 'К центру теории');
        } else if (returnUrl.includes("/editor")) {
            backLabel.textContent = wt('te.k020', 'К редактору заданий');
        } else {
            backLabel.textContent = wt('te.k021', 'Назад');
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
        return `${wt('te.k022', 'Лимит теорий достигнут: свои ')}${personalCount}/${personalLimit}${wt('te.k022b', ', библиотека ')}${libraryCount}/${libraryLimit}${wt('te.k022c', '. Удалите лишнее или перейдите на Premium.')}`;
    }
    if (Number(summary.remaining_personal || 0) <= 0) {
        return `${wt('te.k023', 'Лимит своих теорий достигнут: ')}${personalCount}/${personalLimit}${wt('te.k023b', '. Удалите одну из личных теорий или перейдите на Premium.')}`;
    }
    if (Number(summary.remaining_library || 0) <= 0) {
        return `${wt('te.k024', 'Библиотека теорий заполнена: ')}${libraryCount}/${libraryLimit}${wt('te.k024b', '. Удалите лишнюю теорию или перейдите на Premium.')}`;
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
            pill.innerHTML = `<span class="material-symbols-outlined text-[16px]">workspace_premium</span> ${wt('te.k025', 'Premium · без лимита')}`;
        } else {
            const toneClass = blocked ? "theory-chip" : "theory-chip theory-chip--primary";
            pill.className = toneClass;
            pill.hidden = false;
            pill.innerHTML = `<span class="material-symbols-outlined text-[16px]">inventory_2</span> ${wt('te.k026', 'Мои теории ')}${Number(summary.personal_count || 0)}/${Number(summary.personal_limit || 0)}${wt('te.k026b', ' · Библиотека ')}${Number(summary.library_total_count || 0)}/${Number(summary.library_limit || 0)}`;
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
            return wt('te.k027', 'По коду');
        case "private":
            return wt('te.k028', 'Приватная');
        case "public":
        default:
            return wt('te.k029', 'Общий доступ');
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
            return wt('te.k030', 'Теория не видна в общем каталоге. Добавить её можно только по коду доступа.');
        case "private":
            return wt('te.k031', 'Теория доступна только вам. Другие пользователи не увидят её в каталоге и не смогут открыть по коду.');
        case "public":
        default:
            return wt('te.k032', 'Теория видна в общем каталоге и доступна для добавления в библиотеку.');
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
        return `${wt('te.k033', 'Теория привязана к публичному комплексу «')}${complexTitles[0]}${wt('te.k033b', '», поэтому должна оставаться в общем доступе.')}`;
    }
    if (complexTitles.length > 1) {
        return wt('te.k034', 'Теория привязана к нескольким публичным комплексам, поэтому должна оставаться в общем доступе.');
    }
    return wt('te.k035', 'Теория привязана к опубликованному для всех комплексу, поэтому должна оставаться в общем доступе.');
}

function getTheoryPublicationErrorMessage(error, fallback = "") {
    const message = String(error?.message || error || "").trim();
    if (message.includes("theory_catalog_visibility_locked_by_public_complex")) {
        return wt('te.k036', 'Теория привязана к опубликованному для всех комплексу. Сначала измените публикацию комплекса.');
    }
    return message || fallback;
}

function formatTheoryPublicationTimestamp(value) {
    const raw = String(value || "").trim();
    if (!raw) return wt('te.k037', 'ещё не публиковалась');
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
            buttonLabel: wt('te.k038', 'Нужна публикация'),
            tooltip: wt('te.k039', 'Есть сохранённые изменения, которые ещё не попали в публикацию. Опубликуйте новую версию, чтобы их увидели другие пользователи.'),
            saveMessage: wt('te.k040', 'Теория сохранена. Чтобы другие пользователи увидели изменения, обновите публикацию.'),
        };
    }
    if (syncState === "unpublished") {
        return {
            kind: "unpublished",
            buttonLabel: wt('te.k041', 'Не опубликована'),
            tooltip: wt('te.k042', 'Теория сохранена только в рабочей версии. Чтобы её увидели другие пользователи, опубликуйте материал.'),
            saveMessage: wt('te.k043', 'Теория сохранена. Чтобы её увидели другие пользователи, опубликуйте материал.'),
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
        button.title = wt('te.k044', 'Сначала сохраните теорию');
    } else if (!canManage) {
        button.title = wt('te.k045', 'Публикацией можно управлять только для своих теорий');
    } else if (notice.kind === "stale") {
        button.title = notice.tooltip;
    } else if (publication) {
        button.title = `${wt('te.k046', 'Управление публикацией: ')}${getCatalogVisibilityLabel(publication.catalog_visibility)}`;
    } else {
        button.title = wt('te.k047', 'Опубликовать сохранённую теорию');
    }

    if (!activeTheoryId || !canManage) {
        button.classList.add("hidden");
        button.dataset.tone = "muted";
        button.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">public</span>
            ${wt('te.k041', 'Не опубликована')}
        `;
        return;
    }

    const tone = publication ? getCatalogVisibilityTone(publication.catalog_visibility) : "muted";
    const label = publication ? getCatalogVisibilityLabel(publication.catalog_visibility) : wt('te.k041', 'Не опубликована');
    const description = publication
        ? getTheoryCatalogVisibilityDescription(publication.catalog_visibility)
        : wt('te.k048', 'Теория пока доступна только вам и ещё не опубликована.');

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
        button.title = wt('te.k044', 'Сначала сохраните теорию');
    } else if (!canManage) {
        button.title = wt('te.k045', 'Публикацией можно управлять только для своих теорий');
    } else if (notice.kind === "stale") {
        button.title = notice.tooltip;
    } else if (publication) {
        button.title = `${wt('te.k046', 'Управление публикацией: ')}${getCatalogVisibilityLabel(publication.catalog_visibility)}`;
    } else {
        button.title = notice.tooltip;
    }

    if (!activeTheoryId || !canManage) {
        button.classList.add("hidden");
        button.dataset.tone = "muted";
        button.innerHTML = `
            <span class="material-symbols-outlined text-[16px]">public</span>
            ${wt('te.k041', 'Не опубликована')}
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
    if (!code || code === wt('te.k063', 'Код будет создан после публикации')) return;
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(code);
            theoryEditorToast(wt('te.k049', 'Код доступа скопирован.'), "success", 2500);
            return;
        }
    } catch (error) {
        console.warn("[Theory Editor] Failed to copy access code", error);
    }
    theoryEditorToast(`${wt('te.k050', 'Код доступа: ')}${code}`, "info", 3200);
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
    if (!text) return "";
    const attrs = attributes || {};
    const hasFormatting = Boolean(attrs.bold || attrs.italic || attrs.underline || attrs.strike || attrs.color);
    if (!hasFormatting) {
        return escapeTheoryHtml(text).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
    }

    const match = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
    const leading = match ? match[1] : "";
    const core = match ? match[2] : text;
    const trailing = match ? match[3] : "";

    if (!core) {
        return escapeTheoryHtml(text).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
    }

    let html = escapeTheoryHtml(core).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
    if (attrs.bold) html = `<strong>${html}</strong>`;
    if (attrs.italic) html = `<em>${html}</em>`;
    if (attrs.underline) html = `<u>${html}</u>`;
    if (attrs.strike) html = `<s>${html}</s>`;
    if (attrs.color) html = `<span style="color:${escapeTheoryHtml(attrs.color)}">${html}</span>`;

    const leadHtml = escapeTheoryHtml(leading).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
    const trailHtml = escapeTheoryHtml(trailing).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
    return leadHtml + html + trailHtml;
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

function extractTheoryInlineAttributes(node, currentAttrs) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return { ...(currentAttrs || {}) };
    }

    const nextAttrs = { ...(currentAttrs || {}) };
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    const style = node.style;
    const styleAttr = node.getAttribute ? String(node.getAttribute("style") || "") : "";

    // 1. Bold detection (tags and inline font-weight)
    if (tag === "strong" || tag === "b") {
        nextAttrs.bold = true;
    }
    if (style && style.fontWeight) {
        const fw = String(style.fontWeight).toLowerCase().trim();
        if (fw === "bold" || fw === "bolder") {
            nextAttrs.bold = true;
        } else if (fw === "normal" || fw === "400" || fw === "lighter") {
            delete nextAttrs.bold;
        } else {
            const num = parseInt(fw, 10);
            if (!isNaN(num)) {
                if (num >= 600) nextAttrs.bold = true;
                else if (num < 500) delete nextAttrs.bold;
            }
        }
    } else if (styleAttr && /font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(styleAttr)) {
        nextAttrs.bold = true;
    } else if (styleAttr && /font-weight\s*:\s*(normal|lighter|[1-4]00)/i.test(styleAttr)) {
        delete nextAttrs.bold;
    }

    // 2. Italic detection (tags and inline font-style)
    if (tag === "em" || tag === "i") {
        nextAttrs.italic = true;
    }
    if (style && style.fontStyle) {
        const fs = String(style.fontStyle).toLowerCase().trim();
        if (fs === "italic" || fs === "oblique") {
            nextAttrs.italic = true;
        } else if (fs === "normal") {
            delete nextAttrs.italic;
        }
    } else if (styleAttr && /font-style\s*:\s*(italic|oblique)/i.test(styleAttr)) {
        nextAttrs.italic = true;
    } else if (styleAttr && /font-style\s*:\s*normal/i.test(styleAttr)) {
        delete nextAttrs.italic;
    }

    // 3. Underline detection (tags and text-decoration)
    if (tag === "u" || tag === "ins") {
        nextAttrs.underline = true;
    }
    if (style && (style.textDecoration || style.textDecorationLine)) {
        const td = String(style.textDecoration || style.textDecorationLine || "").toLowerCase();
        if (td.includes("underline")) {
            nextAttrs.underline = true;
        } else if (td.includes("none")) {
            delete nextAttrs.underline;
        }
    } else if (styleAttr && /text-decoration(-line)?\s*:\s*[^;]*underline/i.test(styleAttr)) {
        nextAttrs.underline = true;
    }

    // 4. Strike-through detection (tags and text-decoration)
    if (tag === "s" || tag === "strike" || tag === "del") {
        nextAttrs.strike = true;
    }
    if (style && (style.textDecoration || style.textDecorationLine)) {
        const td = String(style.textDecoration || style.textDecorationLine || "").toLowerCase();
        if (td.includes("line-through")) {
            nextAttrs.strike = true;
        }
    } else if (styleAttr && /text-decoration(-line)?\s*:\s*[^;]*line-through/i.test(styleAttr)) {
        nextAttrs.strike = true;
    }

    // 5. Color detection
    if (style && style.color) {
        const colorVal = String(style.color).trim();
        if (colorVal && !/^(inherit|initial|unset|transparent)$/i.test(colorVal)) {
            nextAttrs.color = colorVal;
        }
    } else if (tag === "font" && node.getAttribute("color")) {
        nextAttrs.color = String(node.getAttribute("color")).trim();
    } else if (styleAttr) {
        const colorMatch = styleAttr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
        if (colorMatch && colorMatch[1]) {
            const rawColor = colorMatch[1].trim();
            if (!/^(inherit|initial|unset|transparent)$/i.test(rawColor)) {
                nextAttrs.color = rawColor;
            }
        }
    }

    return nextAttrs;
}

function areTheoryAttributesEqual(a, b) {
    const aObj = a && typeof a === "object" ? a : {};
    const bObj = b && typeof b === "object" ? b : {};
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (aObj[key] !== bObj[key]) return false;
    }
    return true;
}

function collectTheoryInlineOps(node, attrs, out) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
        let text = node.nodeValue || "";
        if (!text) return;
        text = text.replace(/[\r\n]+/g, " ");
        if (!text) return;
        const op = { insert: text };
        if (attrs && Object.keys(attrs).length) op.attributes = { ...attrs };
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
        if (!node.nextSibling) {
            return;
        }
        out.push({ insert: "\r" });
        return;
    }
    if (tag === "ul" || tag === "ol") {
        return;
    }

    const nextAttrs = extractTheoryInlineAttributes(node, attrs);

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

    // Convert Word heading classes (MsoHeading1..6, Heading1..6) to h1..h6
    const headingCandidates = Array.from(doc.body.querySelectorAll("p, div"));
    headingCandidates.forEach(el => {
        const cls = String(el.getAttribute("class") || "");
        const match = cls.match(/(?:MsoHeading|Heading)([1-6])/i);
        if (match) {
            const level = match[1];
            const h = doc.createElement(`h${level}`);
            while (el.firstChild) {
                h.appendChild(el.firstChild);
            }
            el.parentNode.replaceChild(h, el);
        }
    });

    // Remove Word's empty spacing paragraphs immediately following headings
    const headings = doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6");
    headings.forEach(heading => {
        let next = heading.nextElementSibling;
        while (next && (next.tagName.toLowerCase() === "p" || next.tagName.toLowerCase() === "div")) {
            const text = (next.textContent || "").replace(/[\s\u00a0\u200b]+/g, "");
            if (!text && !next.querySelector("img")) {
                const toRemove = next;
                next = next.nextElementSibling;
                toRemove.remove();
            } else {
                break;
            }
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

        const preservedAttrs = {};
        attrsToKeep.forEach(attr => {
            const val = el.getAttribute(attr);
            if (val !== null && val !== undefined) preservedAttrs[attr] = val;
        });
        
        while (el.attributes.length > 0) {
            el.removeAttribute(el.attributes[0].name);
        }
        
        Object.entries(preservedAttrs).forEach(([attr, val]) => {
            el.setAttribute(attr, val);
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
    const blockTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote"]);

    const emitBlock = (nodeOrArray, lineAttrs = {}) => {
        const blockOps = [];
        if (Array.isArray(nodeOrArray)) {
            nodeOrArray.forEach(n => collectTheoryInlineOps(n, {}, blockOps));
        } else {
            collectTheoryInlineOps(nodeOrArray, {}, blockOps);
        }

        // Trim leading whitespace only from the very first text op of the block
        for (let i = 0; i < blockOps.length; i++) {
            if (typeof blockOps[i].insert === "string") {
                blockOps[i].insert = blockOps[i].insert.replace(/^ +/, "");
                if (blockOps[i].insert.length > 0) break;
            }
        }
        // Trim trailing whitespace only from the very last text op of the block
        for (let i = blockOps.length - 1; i >= 0; i--) {
            if (typeof blockOps[i].insert === "string") {
                blockOps[i].insert = blockOps[i].insert.replace(/ +$/, "");
                if (blockOps[i].insert.length > 0) break;
            }
        }

        for (const op of blockOps) {
            if (typeof op.insert === "string" && op.insert.length === 0) continue;
            ops.push(op);
        }

        if (Object.keys(lineAttrs).length > 0) {
            ops.push({ insert: "\n", attributes: lineAttrs });
        } else {
            ops.push({ insert: "\n" });
        }
    };

    function processNodes(nodesToProcess) {
        let inlineBuffer = [];

        const flushInlineBuffer = () => {
            if (inlineBuffer.length > 0) {
                emitBlock(inlineBuffer);
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
                        for (const child of Array.from(node.children || [])) {
                            const childTag = (child.tagName || "").toLowerCase();
                            if (childTag === "li") {
                                const liAttrs = { list: listType };
                                if (child.style && child.style.textAlign) liAttrs.align = child.style.textAlign;
                                
                                const hasNestedList = Array.from(child.children || []).some(
                                    c => (c.tagName || "").toLowerCase() === "ul" || (c.tagName || "").toLowerCase() === "ol"
                                );
                                if (!hasNestedList) {
                                    emitBlock(child, liAttrs);
                                } else {
                                    const emitInlineIfNotEmpty = (nodes) => {
                                        const hasMeaningfulContent = nodes.some(n => {
                                            if (n.nodeType === Node.TEXT_NODE) {
                                                return Boolean((n.nodeValue || "").replace(/[\s\r\n\u00a0]+/g, ""));
                                            }
                                            if (n.nodeType === Node.ELEMENT_NODE) {
                                                const childElTag = (n.tagName || "").toLowerCase();
                                                if (childElTag === "br" && nodes.length === 1) return false;
                                                return true;
                                            }
                                            return false;
                                        });
                                        if (hasMeaningfulContent) {
                                            emitBlock(nodes, liAttrs);
                                        }
                                    };

                                    let currentInlineNodes = [];
                                    for (const childNode of Array.from(child.childNodes || [])) {
                                        if (
                                            childNode.nodeType === Node.ELEMENT_NODE &&
                                            ((childNode.tagName || "").toLowerCase() === "ul" || (childNode.tagName || "").toLowerCase() === "ol")
                                        ) {
                                            if (currentInlineNodes.length > 0) {
                                                emitInlineIfNotEmpty(currentInlineNodes);
                                                currentInlineNodes = [];
                                            }
                                            processNodes([childNode]);
                                        } else {
                                            currentInlineNodes.push(childNode);
                                        }
                                    }
                                    if (currentInlineNodes.length > 0) {
                                        emitInlineIfNotEmpty(currentInlineNodes);
                                    }
                                }
                            } else if (childTag === "ol" || childTag === "ul") {
                                processNodes([child]);
                            } else {
                                emitBlock(child, { list: listType });
                            }
                        }
                    } else {
                        const lineAttrs = {};
                        const headerLevel = getTheoryHeaderLevel(tag);
                        if (headerLevel) lineAttrs.header = headerLevel;
                        if (tag === "blockquote") lineAttrs.blockquote = true;
                        if (node.style.textAlign) lineAttrs.align = node.style.textAlign;

                        emitBlock(node, lineAttrs);
                    }
                    continue;
                }

                // Any other element is treated as inline
                inlineBuffer.push(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
                const text = node.nodeValue || "";
                if (!text) continue;
                const isWhitespace = !text.trim();
                if (isWhitespace && inlineBuffer.length === 0) {
                    const currentIndex = nodesToProcess.indexOf(node);
                    const remainingNodes = nodesToProcess.slice(currentIndex + 1);
                    const nextMeaningful = remainingNodes.find(n => n.nodeType === Node.ELEMENT_NODE || String(n.nodeValue || "").trim());
                    const isNextBlock = nextMeaningful && nextMeaningful.nodeType === Node.ELEMENT_NODE && (blockTags.has(nextMeaningful.tagName.toLowerCase()) || nextMeaningful.tagName.toLowerCase() === "div");
                    if (!nextMeaningful || isNextBlock) {
                        continue;
                    }
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
        if (op.insert === "") continue;

        const lastOp = normalized[normalized.length - 1];
        const isOpNewline = op.insert === "\n";
        const isLastOpNewline = lastOp && typeof lastOp.insert === "string" && lastOp.insert.endsWith("\n");

        if (
            lastOp &&
            typeof lastOp.insert === "string" &&
            !isOpNewline &&
            !isLastOpNewline &&
            areTheoryAttributesEqual(lastOp.attributes, op.attributes)
        ) {
            lastOp.insert += op.insert;
        } else {
            normalized.push(op);
        }
    }

    return normalized.length ? { ops: normalized } : { ops: [{ insert: "\n" }] };
}

function toggleTheoryHeading(level) {
    const editor = document.getElementById("theory-editor");
    if (!editor) return;
    editor.focus();

    pushTheoryUndoState(true);
    let currentBlock = "";
    try {
        currentBlock = String(document.queryCommandValue("formatBlock") || "").toLowerCase().replace(/[<>]/g, "");
    } catch (e) {}
    if (!currentBlock) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const node = sel.getRangeAt(0).startContainer;
            const el = node.nodeType === 1 ? node : node.parentElement;
            const heading = el?.closest("h1, h2, h3, h4, h5, h6, p");
            if (heading) currentBlock = heading.tagName.toLowerCase();
        }
    }

    if (currentBlock === `h${level}`) {
        document.execCommand("formatBlock", false, "<p>");
    } else {
        document.execCommand("formatBlock", false, `<h${level}>`);
    }
    pushTheoryUndoState(true);
    markTheoryDirty();
    updateTheoryToolbarActiveStates();
}

function executeTheoryListCommand(command) {
    const editor = document.getElementById("theory-editor");
    if (!editor) return;
    editor.focus();

    if (!editor.innerHTML.trim() || editor.innerHTML === "<br>") {
        editor.innerHTML = "<p><br></p>";
        const range = document.createRange();
        range.setStart(editor.firstElementChild, 0);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    document.execCommand(command, false, null);
    saveTheorySelection();
}

function toggleTheoryList(type) {
    pushTheoryUndoState(true);
    const cmd = type === "ol" ? "insertOrderedList" : "insertUnorderedList";
    executeTheoryListCommand(cmd);
    pushTheoryUndoState(true);
    markTheoryDirty();
    updateTheoryToolbarActiveStates();
}

function insertTheoryList(tag) {
    toggleTheoryList(tag);
}

function handleTheoryEditorKeydown(event) {
    const editor = document.getElementById("theory-editor");
    if (!editor) return;

    if (event.key === "Tab") {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const li = range.startContainer instanceof Element
                ? range.startContainer.closest("li")
                : range.startContainer.parentElement?.closest("li");
            if (li && editor.contains(li)) {
                event.preventDefault();
                pushTheoryUndoState(true);
                if (event.shiftKey) {
                    document.execCommand("outdent", false, null);
                } else {
                    document.execCommand("indent", false, null);
                }
                pushTheoryUndoState(true);
                markTheoryDirty();
                updateTheoryToolbarActiveStates();
                return;
            }
        }
    }

    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const li = range.startContainer instanceof Element
                ? range.startContainer.closest("li")
                : range.startContainer.parentElement?.closest("li");
            if (li && editor.contains(li)) {
                const text = (li.textContent || "").replace(/[\s\u00a0\u200b]+/g, "");
                const hasImage = Boolean(li.querySelector("img"));
                if (!text && !hasImage) {
                    event.preventDefault();
                    pushTheoryUndoState(true);
                    const list = li.closest("ul, ol");
                    const listType = list?.tagName.toLowerCase() === "ol" ? "insertOrderedList" : "insertUnorderedList";
                    document.execCommand(listType, false, null);
                    pushTheoryUndoState(true);
                    markTheoryDirty();
                    updateTheoryToolbarActiveStates();
                    return;
                }
            }
        }
    }

    if (event.key === "Backspace") {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            const li = range.startContainer instanceof Element
                ? range.startContainer.closest("li")
                : range.startContainer.parentElement?.closest("li");
            if (li && editor.contains(li)) {
                const text = (li.textContent || "").replace(/[\s\u00a0\u200b]+/g, "");
                const hasImage = Boolean(li.querySelector("img"));
                if (!text && !hasImage) {
                    event.preventDefault();
                    pushTheoryUndoState(true);
                    const list = li.closest("ul, ol");
                    const listType = list?.tagName.toLowerCase() === "ol" ? "insertOrderedList" : "insertUnorderedList";
                    document.execCommand(listType, false, null);
                    pushTheoryUndoState(true);
                    markTheoryDirty();
                    updateTheoryToolbarActiveStates();
                    return;
                }
            }
        }
    }
}

function setTheoryEditorContent(title, delta) {
    const titleEl = document.getElementById("theory-title");
    if (titleEl) {
        titleEl.value = title || "";
    }
    setTheoryColorIndicator();
    renderTheoryDeltaToEditor(delta || EMPTY_THEORY_DELTA);
    updateTheoryStatsCounter();
    updateTheoryToolbarActiveStates();
    initTheoryUndoHistory();
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
        theoryEditorToast(wt('te.k051', 'Сначала сохраните теорию, чтобы управлять публикацией.'), "info", 3200);
        return;
    }

    await resolveCurrentTheoryEditorUserId();

    const activeTheory = theoryEditorState.activeItem
        || theoryEditorState.catalog.find((item) => String(item?.id || "").trim() === theoryId)
        || null;
    if (!isTheoryOwnedByCurrentUser(activeTheory)) {
        theoryEditorToast(wt('te.k052', 'Публикацией можно управлять только для своих теорий.'), "warning", 3200);
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
        String(document.getElementById("theory-title")?.value || activeTheory?.title || wt('te.k053', 'Без названия')).trim() || wt('te.k053', 'Без названия')
    );

    const modal = document.createElement("div");
    modal.className = "fixed inset-0 z-[9999] overflow-x-hidden overflow-y-auto bg-scrim p-4 sm:p-6";
    modal.innerHTML = `
        <div class="mx-auto flex min-h-full w-full max-w-4xl items-center justify-center">
            <div class="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl">
                <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4 sm:px-6">
                    <div class="space-y-1 max-w-3xl">
                        <div class="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                            <span class="material-symbols-outlined text-[16px]">public</span>
                            ${wt('te.k054', 'Публикация теории')}
                        </div>
                        <h3 class="text-xl font-bold text-text-main">${theoryTitle}</h3>
                        <p class="text-sm text-text-secondary">${wt('te.k055', 'Публикуется последняя сохранённая версия теории. Смена режима доступа влияет на текущую публикацию, а новые изменения из редактора станут видны другим пользователям только после публикации новой версии.')}</p>
                    </div>
                    <button type="button" data-role="close" class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-main">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="custom-scrollbar space-y-5 overflow-y-auto p-5 sm:p-6">
                    <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">${wt('te.k056', 'Текущий статус')}</div>
                                <div id="theory-publish-current-status" class="mt-1 text-base font-semibold text-text-main">${escapeTheoryHtml(publication ? getCatalogVisibilityLabel(publication.catalog_visibility) : wt('te.k041', 'Не опубликована'))}</div>
                                <div id="theory-publish-current-meta" class="mt-1 text-sm text-text-secondary">${publication ? `${wt('te.k057', 'Последняя публикация: ')}${escapeTheoryHtml(formatTheoryPublicationTimestamp(publication.latest_published_at))}` : wt('te.k058', 'После первой публикации теория появится в каталоге или станет доступна по коду.')}</div>
                            </div>
                            <span id="theory-publish-current-badge" class="theory-status-pill" data-tone="${publication ? getCatalogVisibilityTone(currentVisibility) : "muted"}">
                                <span class="material-symbols-outlined text-[16px]">public</span>
                                ${escapeTheoryHtml(publication ? getCatalogVisibilityLabel(currentVisibility) : wt('te.k041', 'Не опубликована'))}
                            </span>
                        </div>
                    </div>

                    <div class="space-y-3">
                        <div>
                            <div class="text-sm font-semibold text-text-main">${wt('te.k059', 'Режим доступа')}</div>
                            <p class="mt-1 text-sm text-text-secondary">${wt('te.k060', 'Если публикация уже существует, доступ можно поменять отдельно от публикации новой версии. Новые правки из редактора увидят другие пользователи только после публикации.')}</p>
                        </div>
                        ${visibilityLock ? `
                            <div class="rounded-2xl border border-warning-light bg-warning-light/40 px-4 py-3 text-sm text-warning-darker">
                                ${wt('te.k061', 'Теория используется публичным комплексом. Режим доступа зафиксирован на «Общий доступ».')}
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
                                <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">${wt('te.k062', 'Код доступа')}</div>
                                <div id="theory-publish-access-code" class="mt-1 text-base font-semibold tracking-[0.12em] text-text-main">${escapeTheoryHtml(accessCode ? formatTheoryAccessCodeDisplay(accessCode) : wt('te.k063', 'Код будет создан после публикации'))}</div>
                            </div>
                            <button type="button" class="theory-neutral-btn inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors hover:border-primary hover:text-primary" data-role="copy-access-code">
                                <span class="material-symbols-outlined text-[18px]">content_copy</span>
                                ${wt('te.k064', 'Скопировать код')}
                            </button>
                        </div>
                    </div>

                    <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4">
                        <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">${wt('te.k065', 'Что произойдёт после изменения доступа')}</div>
                        <ul class="mt-2 space-y-2 text-sm text-text-secondary">
                            <li>${wt('te.k066', 'Новые пользователи будут видеть публикацию только в рамках выбранного режима доступа.')}</li>
                            <li>${wt('te.k067', 'Изменение доступа не публикует новую версию автоматически и не меняет содержимое текущей опубликованной версии.')}</li>
                            <li>${wt('te.k068', 'Чтобы другие пользователи увидели новые правки из редактора, опубликуйте новую версию.')}</li>
                            <li>${wt('te.k069', 'Новая публикация делает актуальной последнюю сохранённую версию теории для каталога и доступа по коду.')}</li>
                        </ul>
                    </div>

                    <div id="theory-publish-unsaved-note" class="${theoryEditorState.dirty ? "" : "hidden"} rounded-2xl border border-warning-light bg-warning-light/40 px-4 py-3 text-sm text-warning-darker">
                        ${wt('te.k070', 'Есть несохранённые изменения. В публикацию попадёт последняя сохранённая версия теории.')}
                    </div>

                    <div id="theory-publish-feedback" class="hidden rounded-2xl border px-4 py-3 text-sm"></div>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-1 px-5 py-4 sm:px-6">
                    <button type="button" data-role="update-visibility" class="theory-neutral-btn inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors hover:border-primary hover:text-primary">
                        <span class="material-symbols-outlined text-[18px]">tune</span>
                        ${wt('te.k071', 'Сохранить доступ')}
                    </button>
                    <div class="flex flex-wrap items-center justify-end gap-3">
                        <button type="button" data-role="close" class="theory-neutral-btn inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors hover:border-primary hover:text-primary">
                            ${wt('te.k006', 'Отмена')}
                        </button>
                        <button type="button" data-role="publish-version" class="theory-save-btn inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-fg shadow-sm transition-all hover:shadow-md">
                            <span class="material-symbols-outlined text-[18px]">publish</span>
                            ${wt('te.k072', 'Опубликовать версию')}
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
            currentStatus.textContent = currentItem ? getCatalogVisibilityLabel(currentItem.catalog_visibility) : wt('te.k041', 'Не опубликована');
        }
        if (currentMeta) {
            currentMeta.textContent = currentItem
                ? `${wt('te.k057', 'Последняя публикация: ')}${formatTheoryPublicationTimestamp(currentItem.latest_published_at)}`
                : wt('te.k058', 'После первой публикации теория появится в каталоге или станет доступна по коду.');
        }
        if (currentBadge) {
            currentBadge.dataset.tone = currentItem ? getCatalogVisibilityTone(currentItem.catalog_visibility) : "muted";
            currentBadge.innerHTML = `
                <span class="material-symbols-outlined text-[16px]">public</span>
                ${escapeTheoryHtml(currentItem ? getCatalogVisibilityLabel(currentItem.catalog_visibility) : wt('te.k041', 'Не опубликована'))}
            `;
        }
        const activeCode = getTheoryAccessCodeValue(currentItem);
        const showAccess = selectedVisibility === "access_code";
        if (accessBox) accessBox.classList.toggle("hidden", !showAccess);
        if (accessCodeEl) {
            accessCodeEl.textContent = activeCode
                ? formatTheoryAccessCodeDisplay(activeCode)
                : (selectedVisibility === "access_code" ? wt('te.k063', 'Код будет создан после публикации') : "");
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
            setFeedback(wt('te.k073', 'Выбранный режим доступа уже сохранён.'), "info");
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
            setFeedback(`${wt('te.k074', 'Доступ обновлён: ')}${getCatalogVisibilityLabel(data.item.catalog_visibility)}.`, "success");
            theoryEditorToast(`${wt('te.k075', 'Статус публикации теории обновлён: ')}${getCatalogVisibilityLabel(data.item.catalog_visibility)}.`, "success", 2600);
        } catch (error) {
            console.error("[Theory Editor] Visibility update failed", error);
            setFeedback(`${wt('te.k076', 'Не удалось изменить доступ: ')}${String(error?.message || "catalog_visibility_update_failed")}`, "error");
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
            setFeedback(`${wt('te.k077', 'Публикация обновлена. Режим доступа: ')}${getCatalogVisibilityLabel(data.item.catalog_visibility)}.`, "success");
            theoryEditorToast(`${wt('te.k078', 'Теория опубликована: ')}${getCatalogVisibilityLabel(data.item.catalog_visibility)}.`, "success", 2800);
        } catch (error) {
            console.error("[Theory Editor] Publish failed", error);
            setFeedback(`${wt('te.k079', 'Не удалось опубликовать теорию: ')}${String(error?.message || "catalog_publish_failed")}`, "error");
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
    setTheoryStatus(wt('te.k080', 'Есть несохранённые изменения'), "warning", "edit");
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
        setTheoryStatus(message || wt('te.k081', 'Лимит теорий достигнут'), "warning", "lock");
        if (!options.silent) {
            theoryEditorToast(message || wt('te.k081', 'Лимит теорий достигнут'), "warning", 3600);
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
    setTheoryStatus(wt('te.k082', 'Сохраняем теорию...'), "info", "save");

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
            const message = getTheoryLimitMessage() || wt('te.k081', 'Лимит теорий достигнут');
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
        let statusMessage = wt('te.k083', 'Теория сохранена');
        let statusTone = "success";
        let statusIcon = "check_circle";
        let toastMessage = wt('te.k083', 'Теория сохранена');
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
                statusMessage = wt('te.k084', 'Теория сохранена и привязана к теме');
                toastMessage = statusMessage;
                toastDuration = 2800;
            } catch (linkErr) {
                console.warn("[Theory Editor] Auto-link to topic failed", linkErr);
                statusMessage = wt('te.k085', 'Теория сохранена (привязка к теме не удалась)');
                statusTone = "warning";
                statusIcon = "warning";
                toastMessage = wt('te.k086', 'Теория сохранена. Привяжите её к теме вручную.');
                toastTone = "warning";
                toastDuration = 3500;
            }
        }

        if (publicationSync.synced) {
            statusTone = "success";
            statusIcon = "check_circle";
            toastMessage = `${toastMessage}${wt('te.k088', '. Публикация обновлена.')}`;
            toastDuration = Math.max(toastDuration, 2800);
        } else if (publicationSync.error) {
            statusTone = "warning";
            statusIcon = "warning";
            toastMessage = `${toastMessage}${wt('te.k090', '. Публикация не обновилась: ')}${String(publicationSync.error?.message || "catalog_publish_failed")}`;
            toastTone = "warning";
            toastDuration = Math.max(toastDuration, 3800);
        }

        if (publicationNotice.kind === "stale" || publicationNotice.kind === "unpublished") {
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

        document.title = item.title ? `${item.title}${wt('te.k091', ' — Редактор теории')}` : wt('te.k002', 'Редактор теории');
        return item;
    } catch (error) {
        console.error("[Theory Editor] Failed to save theory", error);
        setTheoryStatus(wt('te.k092', 'Не удалось сохранить теорию'), "error", "error");
        theoryEditorToast(wt('te.k092', 'Не удалось сохранить теорию'), "error", 3000);
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
    setTheoryStatus(wt('te.k093', 'Новая теория'), "muted", "edit_square");
    document.title = wt('te.k094', 'Новая теория — Редактор теории');
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
            theoryEditorToast(wt('te.k095', 'Изображение добавлено. Кликните для настройки размера.'), "success", 3000);
        }
    } catch (error) {
        console.error("[Theory Editor] Failed to upload image", error);
        setTheoryStatus(wt('te.k096', 'Не удалось загрузить изображение'), "error", "error");
        theoryEditorToast(wt('te.k096', 'Не удалось загрузить изображение'), "error", 2800);
    } finally {
        if (input) input.value = "";
    }
}

function updateTheoryEditorActions() {
    const saveBtn = document.getElementById("theory-save-btn");
    if (saveBtn) {
        saveBtn.disabled = theoryEditorState.saving || isTheoryCreationBlocked();
        saveBtn.innerHTML = theoryEditorState.saving
            ? `<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> ${wt('te.k097', 'Сохраняем')}`
            : `<span class="material-symbols-outlined text-[18px]">save</span> ${wt('te.k098', 'Сохранить')}`;
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
            saveBtn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> ${wt('te.k097', 'Сохраняем')}`;
        } else if (blocked) {
            saveBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">lock</span> ${wt('te.k099', 'Лимит достигнут')}`;
        } else {
            saveBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">save</span> ${wt('te.k098', 'Сохранить')}`;
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
    if (!value) return wt('te.k100', 'без даты');
    try {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return wt('te.k100', 'без даты');
        return parsed.toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch (error) {
        return wt('te.k100', 'без даты');
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

    countEl.textContent = `${items.length} ${items.length === 1 ? wt('te.k101', 'теория') : items.length < 5 ? wt('te.k102', 'теории') : wt('te.k103', 'теорий')}`;
    host.replaceChildren();

    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state-card empty-state-card--compact";
        empty.textContent = query
            ? wt('te.k104', 'По этому запросу теории не найдены.')
            : wt('te.k105', 'В библиотеке пока нет теорий. Можно начать с пустой заготовки.');
        host.appendChild(empty);
        return;
    }

    items.forEach((item) => {
        const theoryId = String(item?.id || "").trim();
        const title = String(item?.title || "").trim() || theoryId || wt('te.k053', 'Без названия');
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
                <span class="theory-chip pill pill-sm pill-neutral shrink-0 whitespace-nowrap" title="${libraryImageCount}${wt('te.k106', ' фото')}">
                    ${libraryImageCount}${wt('te.k106', ' фото')}
                </span>
            `);
        }
        if (isOrphan) {
            statusBadges.push(`
                <span class="theory-library-badge w-full px-2 py-1 text-center text-[10px] font-semibold" data-tone="error" title="${wt('te.k107', 'Теория не привязана ни к теме, ни к комплексу')}">
                    <span class="material-symbols-outlined text-[14px]">priority_high</span>
                    ${wt('te.k108', 'Нет привязки')}
                </span>
            `);
        }
        if (!hasContent) {
            statusBadges.push(`
                <span class="theory-library-badge w-full px-2 py-1 text-center text-[10px] font-semibold" title="${wt('te.k109', 'В теории только заголовок')}">
                    <span class="material-symbols-outlined text-[14px]">text_ad</span>
                    ${wt('te.k110', 'Только заголовок')}
                </span>
            `);
        }
        button.innerHTML = `
            <div class="flex items-start justify-between gap-2">
                <p class="truncate text-sm font-semibold text-text-main flex-1 min-w-0">${escapeTheoryHtml(title)}</p>
            </div>
            <div class="mt-2 flex flex-col gap-2">
                <p class="text-[11px] text-text-secondary">${wt('te.k111', 'Обновлено: ')}${escapeTheoryHtml(formatTheoryListDate(item?.updated_at || item?.version))}</p>
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
                ${wt('te.k112', 'Загружаем библиотеку теорий...')}
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
                    ${wt('te.k113', 'Не удалось загрузить библиотеку теорий.')}
                </div>
            `;
        }
        theoryEditorToast(wt('te.k114', 'Не удалось загрузить список теорий'), "warning", 2600);
        theoryEditorState.publicationItem = null;
        updateTheoryPublicationControls();
    }
}

async function loadTheoryById(theoryId) {
    const normalizedTheoryId = String(theoryId || "").trim();
    if (!normalizedTheoryId) {
        resetTheoryEditorState();
        setTheoryStatus(wt('te.k115', 'Новая теория'), "muted", "edit_square");
        document.title = wt('te.k002', 'Редактор теории');
        renderTheoryLibraryList();
        return;
    }

    theoryEditorState.loading = true;
    setTheoryStatus(`${wt('te.k116', 'Загружаем ')}${normalizedTheoryId}...`, "info", "progress_activity");

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
        setTheoryStatus(wt('te.k117', 'Теория загружена'), "success", "check_circle");
        document.title = item.title ? `${item.title}${wt('te.k091', ' — Редактор теории')}` : wt('te.k002', 'Редактор теории');
    } catch (error) {
        console.error("[Theory Editor] Failed to load theory", error);
        theoryEditorToast(wt('te.k118', 'Не удалось открыть теорию'), "error", 2800);
        setTheoryStatus(wt('te.k119', 'Теория не загружена'), "error", "error");
    } finally {
        theoryEditorState.loading = false;
    }
}

async function confirmDiscardUnsavedChanges() {
    if (!theoryEditorState.dirty) {
        return true;
    }
    return theoryEditorConfirm({
        title: wt('te.k080', 'Есть несохранённые изменения'),
        message: wt('te.k120', 'Если уйти сейчас, несохранённые правки теории будут потеряны.'),
        confirmText: wt('te.k121', 'Перейти'),
        cancelText: wt('te.k122', 'Остаться'),
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
        restoreTheorySelection();
        const editor = document.getElementById("theory-editor");
        if (editor) editor.focus();
        pushTheoryUndoState(true);
        document.execCommand("foreColor", false, color);
        setTheoryColorIndicator(color);
        pushTheoryUndoState(true);
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
        saveTheorySelection();
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
        widthSlider.addEventListener("change", () => {
            pushTheoryUndoState(true);
            markTheoryDirty();
        });
    }
    
    document.querySelectorAll(".theory-image-align-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const align = btn.getAttribute("data-align");
            if (_selectedImage) {
                pushTheoryUndoState(true);
                applyImageSettings(_selectedImage, { align });
                updateImageControls();
                pushTheoryUndoState(true);
                markTheoryDirty();
            }
        });
    });
    
    document.querySelectorAll(".theory-image-float-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const float = btn.getAttribute("data-float");
            if (_selectedImage) {
                pushTheoryUndoState(true);
                applyImageSettings(_selectedImage, { float });
                updateImageControls();
                pushTheoryUndoState(true);
                markTheoryDirty();
            }
        });
    });
    
    document.getElementById("theory-image-rotate-left")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        pushTheoryUndoState(true);
        const currentRotate = parseInt(_selectedImage.getAttribute("data-rotate") || "0");
        const newRotate = ((currentRotate - 90 + 360) % 360).toString();
        applyImageSettings(_selectedImage, { rotate: newRotate });
        pushTheoryUndoState(true);
        markTheoryDirty();
    });
    
    document.getElementById("theory-image-rotate-right")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        pushTheoryUndoState(true);
        const currentRotate = parseInt(_selectedImage.getAttribute("data-rotate") || "0");
        const newRotate = ((currentRotate + 90) % 360).toString();
        applyImageSettings(_selectedImage, { rotate: newRotate });
        pushTheoryUndoState(true);
        markTheoryDirty();
    });
    
    document.getElementById("theory-image-flip")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        pushTheoryUndoState(true);
        const currentFlip = _selectedImage.getAttribute("data-flip") || "none";
        const newFlip = currentFlip === "horizontal" ? "none" : "horizontal";
        applyImageSettings(_selectedImage, { flip: newFlip });
        updateImageControls();
        pushTheoryUndoState(true);
        markTheoryDirty();
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
        if ((e.key === "Delete" || e.key === "Backspace") && _selectedImage) {
            e.preventDefault();
            pushTheoryUndoState(true);
            const wrapper = _selectedImage.closest(".theory-image-wrapper") || _selectedImage;
            const parentP = wrapper.closest("p");
            if (parentP && parentP.children.length === 1 && !parentP.textContent.trim()) {
                parentP.remove();
            } else {
                wrapper.remove();
            }
            deselectImage();
            pushTheoryUndoState(true);
            markTheoryDirty();
            updateTheoryStatsCounter();
        }
    });
}

function initTheorySidebarToggle() {
    const grid = document.getElementById("theory-main-grid");
    const panel = document.getElementById("theory-library-panel");
    const toggleBtn = document.getElementById("theory-sidebar-toggle-btn");
    const closeBtn = document.getElementById("theory-sidebar-close-btn");
    if (!grid || !panel || !toggleBtn) return;

    const applyState = (isCollapsed) => {
        grid.classList.toggle("sidebar-collapsed", isCollapsed);
        panel.classList.toggle("is-collapsed", isCollapsed);
        toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
        const icon = toggleBtn.querySelector(".material-symbols-outlined");
        if (icon) {
            icon.textContent = isCollapsed ? "dock_to_right" : "view_sidebar";
        }
        toggleBtn.title = isCollapsed
            ? wt('te.k135', 'Развернуть библиотеку')
            : wt('te.k136', 'Свернуть библиотеку');
    };

    let collapsed = false;
    try {
        collapsed = localStorage.getItem("theorySidebarCollapsed") === "true";
    } catch (e) {}

    applyState(collapsed);

    toggleBtn.addEventListener("click", () => {
        const next = !panel.classList.contains("is-collapsed");
        applyState(next);
        try {
            localStorage.setItem("theorySidebarCollapsed", String(next));
        } catch (e) {}
    });

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            applyState(true);
            try {
                localStorage.setItem("theorySidebarCollapsed", "true");
            } catch (e) {}
        });
    }
}

function updateTheoryStatsCounter() {
    const counterEl = document.getElementById("theory-stats-counter");
    const editor = document.getElementById("theory-editor");
    if (!counterEl || !editor) return;

    const text = String(editor.innerText || "").trim();
    if (!text) {
        counterEl.textContent = "";
        return;
    }

    const words = text.split(/\s+/).filter(Boolean).length;
    const chars = text.length;
    counterEl.textContent = `${words} ${wt('te.k137', 'слов')}, ${chars} ${wt('te.k138', 'симв.')}`;
}

function updateTheoryToolbarActiveStates() {
    const editor = document.getElementById("theory-editor");
    if (!editor) return;

    const checkCommand = (btnId, cmd) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        let active = false;
        try {
            active = Boolean(document.queryCommandState(cmd));
        } catch (e) {}
        btn.setAttribute("aria-pressed", String(active));
        btn.classList.toggle("active", active);
    };

    checkCommand("theory-bold", "bold");
    checkCommand("theory-italic", "italic");
    checkCommand("theory-underline", "underline");
    checkCommand("theory-align-left", "justifyLeft");
    checkCommand("theory-align-center", "justifyCenter");
    checkCommand("theory-align-right", "justifyRight");
    checkCommand("theory-align-justify", "justifyFull");

    const checkListCommand = (btnId, listTag) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        let active = false;
        const cmd = listTag === "ul" ? "insertUnorderedList" : "insertOrderedList";
        try {
            active = Boolean(document.queryCommandState(cmd));
        } catch (e) {}
        if (!active) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const node = sel.getRangeAt(0).startContainer;
                const el = node.nodeType === 1 ? node : node.parentElement;
                const list = el?.closest("ul, ol");
                if (list && list.tagName.toLowerCase() === listTag) {
                    active = true;
                }
            }
        }
        btn.setAttribute("aria-pressed", String(active));
        btn.classList.toggle("active", active);
    };

    checkListCommand("theory-ul", "ul");
    checkListCommand("theory-ol", "ol");

    let blockFormat = "";
    try {
        blockFormat = String(document.queryCommandValue("formatBlock") || "").toLowerCase().replace(/[<>]/g, "");
    } catch (e) {}

    const checkHeadingCommand = (btnId, headingTag) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        let isHeading = blockFormat === headingTag;
        if (!isHeading) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const node = sel.getRangeAt(0).startContainer;
                const el = node.nodeType === 1 ? node : node.parentElement;
                const heading = el?.closest("h1, h2, h3, h4, h5, h6");
                if (heading && heading.tagName.toLowerCase() === headingTag) {
                    isHeading = true;
                }
            }
        }
        btn.setAttribute("aria-pressed", String(isHeading));
        btn.classList.toggle("active", isHeading);
    };

    checkHeadingCommand("theory-h1", "h1");
    checkHeadingCommand("theory-h2", "h2");

    updateTheoryUndoButtons();
}

function bindTheoryToolbar() {
    try {
        document.execCommand("styleWithCSS", false, true);
    } catch (error) {}

    document.getElementById("theory-undo")?.addEventListener("click", () => {
        performTheoryUndo();
    });
    document.getElementById("theory-redo")?.addEventListener("click", () => {
        performTheoryRedo();
    });

    document.getElementById("theory-bold")?.addEventListener("click", () => {
        pushTheoryUndoState(true);
        document.execCommand("bold");
        pushTheoryUndoState(true);
        markTheoryDirty();
        updateTheoryToolbarActiveStates();
    });
    document.getElementById("theory-italic")?.addEventListener("click", () => {
        pushTheoryUndoState(true);
        document.execCommand("italic");
        pushTheoryUndoState(true);
        markTheoryDirty();
        updateTheoryToolbarActiveStates();
    });
    document.getElementById("theory-underline")?.addEventListener("click", () => {
        pushTheoryUndoState(true);
        document.execCommand("underline");
        pushTheoryUndoState(true);
        markTheoryDirty();
        updateTheoryToolbarActiveStates();
    });
    document.getElementById("theory-h1")?.addEventListener("click", () => {
        toggleTheoryHeading(1);
    });
    document.getElementById("theory-h2")?.addEventListener("click", () => {
        toggleTheoryHeading(2);
    });
    document.getElementById("theory-ul")?.addEventListener("click", () => {
        toggleTheoryList("ul");
    });
    document.getElementById("theory-ol")?.addEventListener("click", () => {
        toggleTheoryList("ol");
    });
    document.getElementById("theory-align-left")?.addEventListener("click", () => {
        pushTheoryUndoState(true);
        document.execCommand("justifyLeft");
        pushTheoryUndoState(true);
        markTheoryDirty();
        updateTheoryToolbarActiveStates();
    });
    document.getElementById("theory-align-center")?.addEventListener("click", () => {
        pushTheoryUndoState(true);
        document.execCommand("justifyCenter");
        pushTheoryUndoState(true);
        markTheoryDirty();
        updateTheoryToolbarActiveStates();
    });
    document.getElementById("theory-align-right")?.addEventListener("click", () => {
        pushTheoryUndoState(true);
        document.execCommand("justifyRight");
        pushTheoryUndoState(true);
        markTheoryDirty();
        updateTheoryToolbarActiveStates();
    });
    document.getElementById("theory-align-justify")?.addEventListener("click", () => {
        pushTheoryUndoState(true);
        document.execCommand("justifyFull");
        pushTheoryUndoState(true);
        markTheoryDirty();
        updateTheoryToolbarActiveStates();
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
    initTheorySidebarToggle();

    document.getElementById("theory-title")?.addEventListener("input", () => {
        markTheoryDirty();
        pushTheoryUndoState(false);
    });

    document.getElementById("theory-editor")?.addEventListener("input", () => {
        markTheoryDirty();
        saveTheorySelection();
        updateTheoryStatsCounter();
        updateTheoryToolbarActiveStates();
        pushTheoryUndoState(false);
    });

    document.getElementById("theory-editor")?.addEventListener("keydown", (event) => {
        guardTheoryImageAdjacentDeletion(event);
        handleTheoryEditorKeydown(event);
    });

    document.getElementById("theory-editor")?.addEventListener("paste", (e) => {
        const html = e.clipboardData?.getData("text/html");
        if (html) {
            e.preventDefault();
            pushTheoryUndoState(true);
            const cleanHtml = cleanTheoryWordHtml(html);
            document.execCommand("insertHTML", false, cleanHtml);
            pushTheoryUndoState(true);
            markTheoryDirty();
            updateTheoryStatsCounter();
            updateTheoryToolbarActiveStates();
        }
    });

    const editor = document.getElementById("theory-editor");
    if (editor) {
        ["keyup", "mouseup", "touchend", "focus"].forEach(evt => {
            editor.addEventListener(evt, () => {
                saveTheorySelection();
                updateTheoryToolbarActiveStates();
            });
        });
    }

    document.addEventListener("selectionchange", () => {
        const active = document.activeElement;
        if (active && (active.id === "theory-editor" || active.closest?.("#theory-editor"))) {
            updateTheoryToolbarActiveStates();
        }
    });

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

    document.getElementById("theory-drafts-badge-btn")?.addEventListener("click", () => {
        openTheoryDraftsRegistryModal();
    });

    document.getElementById("theory-draft-banner-registry-btn")?.addEventListener("click", () => {
        openTheoryDraftsRegistryModal();
    });

    bindTheoryToolbar();

    document.addEventListener("keydown", async (event) => {
        if (theoryReloadConfirmPending) return;
        const isCtrl = event.ctrlKey || event.metaKey;
        const lowerKey = String(event.key || "").toLowerCase();

        // Ctrl+Z (Undo)
        if (isCtrl && lowerKey === "z" && !event.shiftKey) {
            const active = document.activeElement;
            const isLibrarySearch = active && (active.id === "theory-library-search" || active.closest?.("#theory-library-panel"));
            if (!isLibrarySearch) {
                event.preventDefault();
                performTheoryUndo();
                return;
            }
        }

        // Ctrl+Y or Ctrl+Shift+Z (Redo)
        if ((isCtrl && lowerKey === "y") || (isCtrl && event.shiftKey && lowerKey === "z")) {
            const active = document.activeElement;
            const isLibrarySearch = active && (active.id === "theory-library-search" || active.closest?.("#theory-library-panel"));
            if (!isLibrarySearch) {
                event.preventDefault();
                performTheoryRedo();
                return;
            }
        }

        if (isCtrl && lowerKey === "s") {
            event.preventDefault();
            try {
                await persistTheory();
            } catch (error) {}
            return;
        }

        const wantsReload = event.key === "F5" || (isCtrl && lowerKey === "r");
        if (!theoryEditorState.dirty || !wantsReload) return;

        event.preventDefault();
        theoryReloadConfirmPending = true;
        const canReload = await theoryEditorConfirm({
            title: wt('te.k123', 'Обновить страницу?'),
            message: wt('te.k124', 'Есть несохранённые изменения. Мы сохраним черновик и после обновления предложим восстановить его.'),
            confirmText: wt('te.k125', 'Обновить'),
            cancelText: wt('te.k122', 'Остаться'),
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
    cleanupExpiredTheoryDrafts(14);
    updateTheoryDraftsBadge();
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
    setTheoryStatus(wt('te.k093', 'Новая теория'), "muted", "edit_square");
    document.title = wt('te.k094', 'Новая теория — Редактор теории');
});

document.addEventListener("DOMContentLoaded", () => {
    window.setTimeout(async () => {
        if (theoryEditorState.context?.theoryId || theoryEditorState.activeTheoryId) return;
        await restoreTheoryDraftIfPresent("");
    }, 280);
});
