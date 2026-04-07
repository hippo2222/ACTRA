const THEORY_EDITOR_ROUTE = "/ui/editor/Theory_Editor.html";
const THEORY_CENTER_ROUTE = "/ui/editor/Theory_Center.html";
const EMPTY_THEORY_DELTA = { ops: [{ insert: "\n" }] };
const THEORY_DEFAULT_TEXT_COLOR_FALLBACK = "#1A1A1A";
const THEORY_DRAFT_STORAGE_PREFIX = "theory-editor-draft:";

const theoryEditorState = {
    catalog: [],
    activeTheoryId: "",
    version: null,
    dirty: false,
    loading: false,
    saving: false,
    search: "",
    context: null,
};

let theoryDraftSaveTimer = 0;
let theoryReloadConfirmPending = false;

function theoryEditorNavigate(url) {
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
    return window.confirm(fallbackMessage);
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
        backBtn.dataset.target = returnUrl;
        if (returnUrl.includes("Theory_Center")) {
            backLabel.textContent = "К центру теории";
        } else if (returnUrl.includes("/ui/editor")) {
            backLabel.textContent = "К редактору заданий";
        } else {
            backLabel.textContent = "Назад";
        }
    }

    if (centerBtn) {
        centerBtn.disabled = false;
    }
}

function theoryLocalImageSrc(path) {
    if (!path) return "";
    // Если путь уже содержит /api/local-image, возвращаем как есть (избегаем двойного кодирования)
    if (path.startsWith('/api/local-image')) return path;
    return `/api/local-image?path=${encodeURIComponent(path)}`;
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
            const safePath = escapeTheoryHtml(segment.value);
            const attrs = segment.attrs || {};
            const width = attrs.width || "100%";
            const align = attrs.align || "left";
            const float = attrs.float || "none";
            const flip = attrs.flip || "none";
            
            const alignClass = align === "center" ? "mx-auto" : align === "right" ? "ml-auto" : "";
            
            let wrapperStyle = "";
            if (float === "left") {
                wrapperStyle = "display:inline-block;float:left;margin:0 16px 8px 0;";
            } else if (float === "right") {
                wrapperStyle = "display:inline-block;float:right;margin:0 0 8px 16px;";
            } else {
                const textAlign = align === "center" ? "text-align:center;" : align === "right" ? "text-align:right;" : "";
                wrapperStyle = `display:block;${textAlign}`;
            }
            
            const rotate = attrs.rotate || "0";
            const flipScale = flip === "horizontal" ? " scaleX(-1)" : "";
            const transformStyle = rotate !== "0" || flip === "horizontal" ? `transform:rotate(${rotate}deg)${flipScale};` : "";
            html += `<span class="theory-image-wrapper" contenteditable="false" style="${wrapperStyle}"><img data-path="${safePath}" data-width="${width}" data-align="${align}" data-rotate="${rotate}" data-float="${float}" data-flip="${flip}" src="${theoryLocalImageSrc(segment.value)}" alt="" class="theory-image ${alignClass}" style="max-width:${width};width:${width};border-radius:12px;cursor:pointer;${transformStyle}" onmousedown="event.preventDefault()" onclick="theoryImageClick(this,event)" /></span>`;
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
        const text = node.nodeValue || "";
        if (!text) return;
        const op = { insert: text };
        if (attrs && Object.keys(attrs).length) op.attributes = attrs;
        out.push(op);
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (tag === "img") {
        const dataPath = node.getAttribute("data-path");
        const src = dataPath || node.getAttribute("src") || "";
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
        out.push({ insert: "\n" });
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

    const nodes = Array.from(editor.childNodes || []);
    if (!nodes.length) return { ops: [{ insert: "\n" }] };

    for (const node of nodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
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
                continue;
            }

            const lineAttrs = {};
            const headerLevel = getTheoryHeaderLevel(tag);
            if (headerLevel) lineAttrs.header = headerLevel;
            if (tag === "blockquote") lineAttrs.blockquote = true;
            if (node.style.textAlign) lineAttrs.align = node.style.textAlign;

            collectTheoryInlineOps(node, {}, ops);
            ops.push(Object.keys(lineAttrs).length ? { insert: "\n", attributes: lineAttrs } : { insert: "\n" });
        } else {
            collectTheoryInlineOps(node, {}, ops);
            ops.push({ insert: "\n" });
        }
    }

    const normalized = [];
    for (const op of ops) {
        if (!op || !("insert" in op)) continue;
        if (typeof op.insert === "object" && op.insert && typeof op.insert.image === "string") {
            const normalizedImage = normalizeTheoryImageRef(op.insert.image);
            if (!normalizedImage) continue;
            const imageOp = { insert: { image: normalizedImage } };
            // Preserve image attributes (width, align, rotate, float, flip)
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
    theoryEditorState.version = null;
    theoryEditorState.dirty = false;
    setTheoryEditorContent("", EMPTY_THEORY_DELTA);
    updateTheoryEditorUrl();
    renderTheoryContextHeader();
    updateTheoryEditorActions();
}

function updateTheoryEditorActions() {
    const saveBtn = document.getElementById("theory-save-btn");
    if (saveBtn) {
        saveBtn.disabled = theoryEditorState.saving;
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
        if (currentTheoryId && !theoryEditorState.activeTheoryId) {
            theoryEditorState.activeTheoryId = currentTheoryId;
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
        theoryEditorState.version = item.version || item.updated_at || null;
        theoryEditorState.dirty = false;
        setTheoryEditorContent(item.title || "", item.delta || EMPTY_THEORY_DELTA);
        updateTheoryEditorUrl();
        renderTheoryContextHeader();
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

function markTheoryDirty() {
    theoryEditorState.dirty = true;
    updateTheoryEditorActions();
    scheduleTheoryDraftSave();
    setTheoryStatus("Есть несохранённые изменения", "warning", "edit");
}

async function persistTheory(options = {}) {
    if (theoryEditorState.saving) {
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
        if (!response.ok || !data?.ok || !data.item) {
            throw new Error(data?.error || "theory_save_failed");
        }

        const previousDraftKey = getTheoryDraftKey();
        const item = data.item;
        const wasNewTheory = !theoryEditorState.activeTheoryId;
        theoryEditorState.activeTheoryId = String(item.id || "").trim();
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

        // P7: Auto-link theory to topic when a NEW theory is saved via topic context
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
    
    // Update transform
    const currentRotate = img.getAttribute("data-rotate") || "0";
    const currentFlip = img.getAttribute("data-flip") || "none";
    const flipScale = currentFlip === "horizontal" ? " scaleX(-1)" : "";
    const transformStyle = currentRotate !== "0" || currentFlip === "horizontal" ? `rotate(${currentRotate}deg)${flipScale}` : "";
    img.style.transform = transformStyle;
    
    // Update wrapper
    const wrapper = img.closest(".theory-image-wrapper");
    if (wrapper) {
        const currentAlign = img.getAttribute("data-align") || "left";
        const currentFloat = img.getAttribute("data-float") || "none";
        let wrapperStyle = "";
        
        if (currentFloat === "left") {
            wrapperStyle = "display:inline-block;float:left;margin:0 16px 8px 0;";
        } else if (currentFloat === "right") {
            wrapperStyle = "display:inline-block;float:right;margin:0 0 8px 16px;";
        } else {
            const textAlign = currentAlign === "center" ? "text-align:center;" : currentAlign === "right" ? "text-align:right;" : "";
            wrapperStyle = `display:block;${textAlign}`;
        }
        
        wrapper.style.cssText = wrapperStyle;
    }
    
    markTheoryDirty();
}

function selectImage(imgElement) {
    if (!imgElement) return;
    
    // Deselect previous image
    if (_selectedImage) {
        _selectedImage.classList.remove("theory-image-selected");
    }
    
    // Select new image
    _selectedImage = imgElement;
    imgElement.classList.add("theory-image-selected");
    
    // Hide text controls and show image controls
    const textControls = document.getElementById("theory-text-controls");
    const imageControls = document.getElementById("theory-image-controls");
    if (textControls) {
        textControls.classList.add("hidden");
    }
    if (imageControls) {
        // Add visible class first (sets display: flex but opacity: 0)
        imageControls.classList.add("visible");
        // Then trigger opacity transition on next frame
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
    
    // Show text controls and hide image controls
    const textControls = document.getElementById("theory-text-controls");
    const imageControls = document.getElementById("theory-image-controls");
    if (imageControls) {
        // Hide immediately without transition
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
    
    // Update width slider
    const widthSlider = document.getElementById("theory-image-width-slider");
    const widthLabel = document.getElementById("theory-image-width-label");
    if (widthSlider && widthLabel) {
        const widthNum = parseInt(width) || 100;
        widthSlider.value = widthNum;
        widthLabel.textContent = `${widthNum}%`;
    }
    
    // Update alignment buttons
    document.querySelectorAll(".theory-image-align-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-align") === align);
    });
    
    // Update float buttons
    document.querySelectorAll(".theory-image-float-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-float") === float);
    });
    
    // Update flip button
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
        if (!response.ok || !data?.ok || !data.path) {
            throw new Error(data?.error || "image_upload_failed");
        }

        const editor = document.getElementById("theory-editor");
        if (editor) {
            const img = document.createElement("img");
            img.src = theoryLocalImageSrc(data.path);
            img.setAttribute("data-path", data.path);
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
            wrapper.appendChild(img);
            
            const p = document.createElement("p");
            p.appendChild(wrapper);
            const lastChild = editor.lastElementChild;
            if (lastChild && lastChild.tagName === "P" && lastChild.childNodes.length === 1 && lastChild.firstChild && lastChild.firstChild.nodeName === "BR") {
                editor.removeChild(lastChild);
            }
            editor.appendChild(p);
            
            theoryEditorState.version = data.version || theoryEditorState.version;
            markTheoryDirty();
            theoryEditorToast("Изображение добавлено. Кликните для настройки размера и выравнивания.", "success", 3000);
        }
    } catch (error) {
        console.error("[Theory Editor] Failed to upload image", error);
        setTheoryStatus("Не удалось загрузить изображение", "error", "error");
        theoryEditorToast("Не удалось загрузить изображение", "error", 2800);
    } finally {
        if (input) {
            input.value = "";
        }
    }
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
        // Only mark dirty if there's content to apply color to
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
    // Width slider
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
    
    // Alignment buttons
    document.querySelectorAll(".theory-image-align-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const align = btn.getAttribute("data-align");
            if (_selectedImage) {
                applyImageSettings(_selectedImage, { align });
                updateImageControls();
            }
        });
    });
    
    // Float buttons
    document.querySelectorAll(".theory-image-float-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const float = btn.getAttribute("data-float");
            if (_selectedImage) {
                applyImageSettings(_selectedImage, { float });
                updateImageControls();
            }
        });
    });
    
    // Rotate left (counter-clockwise, -90 degrees)
    document.getElementById("theory-image-rotate-left")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        const currentRotate = parseInt(_selectedImage.getAttribute("data-rotate") || "0");
        const newRotate = ((currentRotate - 90 + 360) % 360).toString();
        applyImageSettings(_selectedImage, { rotate: newRotate });
    });
    
    // Rotate right (clockwise, +90 degrees)
    document.getElementById("theory-image-rotate-right")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        const currentRotate = parseInt(_selectedImage.getAttribute("data-rotate") || "0");
        const newRotate = ((currentRotate + 90) % 360).toString();
        applyImageSettings(_selectedImage, { rotate: newRotate });
    });
    
    // Flip horizontal
    document.getElementById("theory-image-flip")?.addEventListener("click", () => {
        if (!_selectedImage) return;
        const currentFlip = _selectedImage.getAttribute("data-flip") || "none";
        const newFlip = currentFlip === "horizontal" ? "none" : "horizontal";
        applyImageSettings(_selectedImage, { flip: newFlip });
        updateImageControls();
    });
    
    // Click outside to deselect
    const editor = document.getElementById("theory-editor");
    if (editor) {
        editor.addEventListener("click", (e) => {
            // If clicked on editor but not on an image, deselect
            if (e.target === editor || (e.target.closest && !e.target.closest(".theory-image"))) {
                deselectImage();
            }
        });
    }
    
    // Escape key to deselect
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && _selectedImage) {
            deselectImage();
        }
    });
}

function bindTheoryToolbar() {
    try {
        document.execCommand("styleWithCSS", false, true);
    } catch (error) {
        // Browsers that ignore styleWithCSS can safely continue with default behavior.
    }
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
    initColorPicker();
    initImageControls();
}

function bindTheoryEditorEvents() {
    document.getElementById("theory-title")?.addEventListener("input", () => {
        markTheoryDirty();
    });

    document.getElementById("theory-editor")?.addEventListener("input", () => {
        markTheoryDirty();
    });

    document.getElementById("theory-library-search")?.addEventListener("input", (event) => {
        theoryEditorState.search = String(event?.target?.value || "").trim();
        renderTheoryLibraryList();
    });

    document.getElementById("theory-save-btn")?.addEventListener("click", async () => {
        try {
            await persistTheory();
        } catch (error) {
            // handled in persistTheory
        }
    });

    document.getElementById("theory-new-btn")?.addEventListener("click", async () => {
        await startNewTheory();
    });

    document.getElementById("theory-back-btn")?.addEventListener("click", async () => {
        const canLeave = await confirmDiscardUnsavedChanges();
        if (!canLeave) {
            return;
        }
        const button = document.getElementById("theory-back-btn");
        const target = button?.dataset.target || THEORY_CENTER_ROUTE;
        theoryEditorNavigate(target);
    });

    document.getElementById("theory-open-center-btn")?.addEventListener("click", async () => {
        const canLeave = await confirmDiscardUnsavedChanges();
        if (!canLeave) {
            return;
        }
        const target = resolveTheoryCenterUrl();
        theoryEditorNavigate(target);
    });

    document.getElementById("theory-open-complexes-btn")?.addEventListener("click", async () => {
        const canLeave = await confirmDiscardUnsavedChanges();
        if (!canLeave) {
            return;
        }
        const button = document.getElementById("theory-open-complexes-btn");
        const target = button?.dataset.target || resolveTheoryComplexesUrl();
        theoryEditorNavigate(target);
    });

    document.getElementById("theory-image-btn")?.addEventListener("click", () => {
        document.getElementById("theory-image-input")?.click();
    });
    document.getElementById("theory-image-input")?.addEventListener("change", uploadTheoryImage);

    bindTheoryToolbar();

    document.addEventListener("keydown", async (event) => {
        if (theoryReloadConfirmPending) {
            return;
        }
        const lowerKey = String(event.key || "").toLowerCase();
        if ((event.ctrlKey || event.metaKey) && lowerKey === "s") {
            event.preventDefault();
            try {
                await persistTheory();
            } catch (error) {
                // handled in persistTheory
            }
            return;
        }

        const wantsReload = event.key === "F5" || ((event.ctrlKey || event.metaKey) && lowerKey === "r");
        if (!theoryEditorState.dirty || !wantsReload) {
            return;
        }

        event.preventDefault();
        theoryReloadConfirmPending = true;
        const canReload = await theoryEditorConfirm({
            title: "Обновить страницу?",
            message: "Есть несохранённые изменения. Мы сохраним локальный черновик и после обновления предложим восстановить его.",
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

    const persistDraftOnLeave = () => {
        if (!theoryEditorState.dirty) {
            return;
        }
        saveTheoryDraftNow();
    };

    window.addEventListener("beforeunload", persistDraftOnLeave);
    window.addEventListener("pagehide", persistDraftOnLeave);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            persistDraftOnLeave();
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    theoryEditorState.context = parseTheoryEditorContext();
    renderTheoryContextHeader();
    bindTheoryEditorEvents();
    updateTheoryEditorActions();
    await loadTheoryCatalog({ keepSelection: true });

    if (theoryEditorState.context?.theoryId) {
        await loadTheoryById(theoryEditorState.context.theoryId);
        return;
    }

    resetTheoryEditorState();
    setTheoryStatus("Новая теория. Начните писать и сохраните материал.", "muted", "edit_square");
    document.title = "Новая теория — Редактор теории";
});

document.addEventListener("DOMContentLoaded", () => {
    document.addEventListener("keydown", async (event) => {
        if (theoryReloadConfirmPending) {
            return;
        }
        const lowerKey = String(event.key || "").toLowerCase();
        const wantsReload = event.key === "F5" || ((event.ctrlKey || event.metaKey) && lowerKey === "r");
        if (!theoryEditorState.dirty || !wantsReload) {
            return;
        }

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

    window.addEventListener("beforeunload", () => {
        if (!theoryEditorState.dirty) {
            return;
        }
        saveTheoryDraftNow();
    });

    window.setTimeout(async () => {
        if (theoryEditorState.context?.theoryId || theoryEditorState.activeTheoryId) {
            return;
        }
        await restoreTheoryDraftIfPresent("");
    }, 280);
});

