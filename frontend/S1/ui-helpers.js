/**
 * UI Helpers Module
 * Handles DOM manipulations, status messages, modals, and loading states.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./session-state'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./session-state'));
    } else {
        root.UIHelpers = factory(root.SessionState);
    }
}(typeof self !== 'undefined' ? self : this, function (SessionState) {
    'use strict';

    let statusAutoHideTimer = null;

    function ensureState() {
        if (!SessionState) console.warn('SessionState not found in UIHelpers');
    }

    function clearStatusAutoHideTimer() {
        if (statusAutoHideTimer) {
            clearTimeout(statusAutoHideTimer);
            statusAutoHideTimer = null;
        }
    }

    function setButtonBusy(buttonId, busy, options = {}) {
        const button = typeof buttonId === "string" ? document.getElementById(buttonId) : buttonId;
        if (!button) return;

        const labelEl = button.querySelector(".truncate") || button;
        const defaultLabel =
            button.dataset.defaultLabel ||
            (labelEl ? String(labelEl.textContent || "").trim() : "");

        if (!button.dataset.defaultLabel) {
            button.dataset.defaultLabel = defaultLabel;
        }

        let spinner = button.querySelector('[data-role="busy-indicator"]');

        if (!busy) {
            if (labelEl) {
                labelEl.textContent = button.dataset.defaultLabel || defaultLabel;
            }
            if (spinner) spinner.remove();
            button.removeAttribute("aria-busy");
            button.classList.remove("pointer-events-none");
            return;
        }

        const busyLabel = String(options && options.label ? options.label : "Загрузка");
        if (labelEl) {
            labelEl.textContent = busyLabel;
        }

        if (!spinner) {
            spinner = document.createElement("span");
            spinner.setAttribute("data-role", "busy-indicator");
            spinner.setAttribute("aria-hidden", "true");
            spinner.className = "material-symbols-outlined text-[16px] leading-none animate-spin";
            spinner.textContent = "progress_activity";
            button.insertBefore(spinner, button.firstChild);
        }

        button.setAttribute("aria-busy", "true");
        button.classList.add("pointer-events-none");
    }

    // --- Status & feedback ---

    function showStatus(message, type = "info", options = {}) {
        clearStatusAutoHideTimer();

        // Check pause state from SessionState if available
        if (SessionState && SessionState.paused && type !== "error") {
            const bannerEl = document.getElementById("status-banner");
            if (bannerEl) bannerEl.classList.add("hidden");
            return;
        }

        const banner = document.getElementById("status-banner");
        if (!banner) return;

        if (!message) {
            banner.classList.add("hidden");
            banner.replaceChildren();
            return;
        }

        banner.replaceChildren();
        banner.classList.remove("hidden");

        // Reset classes
        banner.className = "mb-4 w-full min-w-0 rounded-lg border-2 px-4 py-3 flex items-center gap-3 break-words transition-colors duration-200";

        if (type === "error") {
            banner.classList.add(
                "border-error", "bg-surface-1", "text-text-main",
                "dark:border-error-light", "dark:bg-surface-2", "dark:text-text-on-dark"
            );
        } else if (type === "success") {
            banner.classList.add(
                "border-success", "bg-surface-1", "text-text-main",
                "dark:border-success-light", "dark:bg-surface-2", "dark:text-text-on-dark"
            );
        } else {
            banner.classList.add(
                "border-warning", "bg-surface-1", "text-text-main",
                "dark:border-warning-light", "dark:bg-surface-2", "dark:text-text-on-dark"
            );
        }

        const dismissible = !!(options && options.dismissible);
        const content = document.createElement("div");
        content.className = dismissible
            ? "flex w-full min-w-0 items-center justify-between gap-2"
            : "w-full min-w-0";

        const text = document.createElement("div");
        text.className = "min-w-0 flex-1 whitespace-pre-wrap leading-snug";
        text.textContent = message;
        content.appendChild(text);

        if (dismissible) {
            const closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.className =
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-transparent text-text-secondary transition-colors hover:bg-bg-hover";
            closeBtn.setAttribute("aria-label", "Закрыть уведомление");
            closeBtn.title = "Закрыть уведомление";

            const icon = document.createElement("span");
            icon.className = "material-symbols-outlined text-[14px] leading-none";
            icon.textContent = "close";
            closeBtn.appendChild(icon);

            closeBtn.addEventListener("click", () => {
                clearStatusAutoHideTimer();
                banner.classList.add("hidden");
                banner.replaceChildren();
            });

            content.appendChild(closeBtn);
        }

        banner.appendChild(content);

        const autoHideMs = Number(options && options.autoHideMs);
        if (Number.isFinite(autoHideMs) && autoHideMs > 0) {
            statusAutoHideTimer = setTimeout(() => {
                banner.classList.add("hidden");
                banner.replaceChildren();
                statusAutoHideTimer = null;
            }, autoHideMs);
        }
    }

    function showRetryOption(retryCallback) {
        clearStatusAutoHideTimer();
        const banner = document.getElementById("status-banner");
        if (!banner) return;

        banner.replaceChildren();

        const row = document.createElement("div");
        row.className = "flex w-full min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between";

        const textWrap = document.createElement("div");
        const title = document.createElement("p");
        title.className = "font-semibold";
        title.textContent = "Ошибка отправки ответа";
        const text = document.createElement("p");
        text.className = "text-sm mt-1";
        text.textContent = "Проверьте подключение к сети и попробуйте снова";
        textWrap.appendChild(title);
        textWrap.appendChild(text);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = "retry-submit-btn";
        btn.className =
            "shrink-0 px-4 py-2 bg-surface-1 dark:bg-surface-2 border border-current rounded-lg font-semibold hover:bg-bg-hover dark:hover:bg-bg-hover transition disabled:opacity-60 disabled:cursor-not-allowed";
        btn.textContent = "Повторить";
        btn.disabled = typeof retryCallback !== "function";

        row.appendChild(textWrap);
        row.appendChild(btn);
        banner.appendChild(row);

        banner.classList.remove("hidden");
        banner.className = "mb-4 w-full min-w-0 rounded-lg border-2 p-4 flex items-start gap-3 break-words border-error bg-surface-1 text-text-main dark:border-error-light dark:bg-surface-2 dark:text-text-on-dark";

        if (retryCallback) {
            btn.onclick = (e) => {
                e.stopPropagation();
                retryCallback();
            };
        }
    }

    // --- Modals ---

    function openPauseModal() {
        const modal = document.getElementById("pause-confirm-modal");
        if (!modal) return;

        // Reset visual state
        const spinner = document.getElementById("pause-confirm-spinner");
        if (spinner) spinner.classList.add("hidden");

        modal.classList.remove("hidden");
        modal.classList.add("flex");

        if (SessionState) SessionState.pauseModalOpen = true;
    }

    function closePauseModal() {
        const modal = document.getElementById("pause-confirm-modal");
        if (!modal) return;
        modal.classList.add("hidden");
        modal.classList.remove("flex");

        if (SessionState) {
            SessionState.pauseModalOpen = false;
            SessionState.pauseInFlight = false;
        }
    }

    function setPauseInFlight(inFlight) {
        if (SessionState) SessionState.pauseInFlight = !!inFlight;
        const pauseBtn = document.getElementById("pause-confirm-submit");
        const discardBtn = document.getElementById("pause-confirm-discard");
        const continueBtn = document.getElementById("pause-confirm-continue");
        const spinner = document.getElementById("pause-confirm-spinner");
        if (pauseBtn) pauseBtn.disabled = inFlight;
        if (discardBtn) discardBtn.disabled = inFlight;
        if (continueBtn) continueBtn.disabled = inFlight;
        if (spinner) spinner.classList.toggle("hidden", !inFlight);
    }

    function showResumeModal() {
        const modal = document.getElementById("resume-modal");
        if (!modal) return;
        modal.classList.remove("hidden");
        modal.classList.add("flex");
        const spinner = document.getElementById("resume-spinner");
        if (spinner) spinner.classList.add("hidden");
    }

    function hideResumeModal() {
        const modal = document.getElementById("resume-modal");
        if (!modal) return;
        modal.classList.add("hidden");
        modal.classList.remove("flex");
        const spinner = document.getElementById("resume-spinner");
        if (spinner) spinner.classList.add("hidden");
    }

    function setPausedUI(paused) {
        if (SessionState) SessionState.paused = !!paused;
        // Could update UI indicators if any
    }

    // --- Navigation Buttons ---

    function updateNextButtonState() {
        if (!SessionState) return;
        const nextBtn = document.getElementById("next-task-btn");
        if (!nextBtn) return;
        const canShowNext = !!SessionState.canGoNext && !!SessionState.currentTaskChecked;
        nextBtn.disabled = SessionState.isLoading || !canShowNext;
        nextBtn.classList.toggle("hidden", !canShowNext);
    }

    function setCanGoNext(enabled) {
        if (SessionState) SessionState.canGoNext = !!enabled;
        updateNextButtonState();
    }

    function setLoading(isLoading) {
        if (SessionState) SessionState.isLoading = !!isLoading;

        const checkBtn = document.getElementById("check-answer-btn");
        const nextBtn = document.getElementById("next-task-btn");

        if (checkBtn) checkBtn.disabled = !!isLoading;
        updateNextButtonState();

        // Spinner logic usually handled by showStatus or skeletons now?
        // In index.html setLoading also:
        // if (spinner) spinner.classList.remove("hidden"); etc.
        // But we are moving to skeletons.
        // For now, let's keep backward compatibility logic for spinner if it exists
        const spinner = document.getElementById("loading-spinner");
        const content = document.getElementById("task-content");
        if (isLoading) {
            if (spinner) spinner.classList.remove("hidden");
            if (content) content.classList.add("opacity-50", "pointer-events-none");
        } else {
            if (spinner) spinner.classList.add("hidden");
            if (content) content.classList.remove("opacity-50", "pointer-events-none");
        }
    }

    // --- Skeletons (Problem 6) ---

    function showTaskSkeleton() {
        const taskContent = document.getElementById("task-content");
        if (!taskContent) return;

        taskContent.innerHTML = `
      <div class="animate-pulse space-y-6 pt-4">
        <!-- Title & Meta -->
        <div class="space-y-2">
            <div class="h-8 bg-bg-tertiary dark:bg-surface-2 rounded w-1/3"></div>
            <div class="h-4 bg-bg-tertiary dark:bg-surface-2 rounded w-1/4"></div>
        </div>
        
        <!-- Description -->
        <div class="space-y-2">
            <div class="h-4 bg-bg-tertiary dark:bg-surface-2 rounded w-full"></div>
            <div class="h-4 bg-bg-tertiary dark:bg-surface-2 rounded w-5/6"></div>
            <div class="h-4 bg-bg-tertiary dark:bg-surface-2 rounded w-4/6"></div>
        </div>
        
        <!-- Content Area -->
        <div class="h-64 bg-surface-2 dark:bg-surface-2 rounded-lg border border-border-subtle dark:border-border-strong"></div>
        
        <!-- Controls -->
        <div class="flex gap-4 pt-4">
            <div class="h-10 bg-bg-tertiary dark:bg-surface-2 rounded w-32"></div>
        </div>
      </div>
    `;

        // Also clear title etc to avoid mixed state
        const titleEl = document.getElementById("task-title");
        if (titleEl) titleEl.textContent = "Загрузка...";
    }

    return {
        showStatus,
        showRetryOption,
        setButtonBusy,
        openPauseModal,
        closePauseModal,
        setPauseInFlight,
        showResumeModal,
        hideResumeModal,
        setPausedUI,
        setPaused: setPausedUI,
        setCanGoNext,
        setLoading,
        updateNextButtonState,
        showTaskSkeleton
    };
}));

