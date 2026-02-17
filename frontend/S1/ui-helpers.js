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

    function ensureState() {
        if (!SessionState) console.warn('SessionState not found in UIHelpers');
    }

    // --- Status & feedback ---

    function showStatus(message, type = "info") {
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
            return;
        }

        banner.textContent = message;
        banner.classList.remove("hidden");

        // Reset classes
        banner.className = "mb-6 rounded-lg border p-4 flex items-start gap-3 transition-colors duration-200";

        if (type === "error") {
            banner.classList.add(
                "border-error-light", "bg-error-lighter", "text-error-darker",
                "dark:border-error", "dark:bg-error-light", "dark:text-error-lighter"
            );
        } else if (type === "success") {
            banner.classList.add(
                "border-success-light", "bg-success-lighter", "text-success-darker",
                "dark:border-success", "dark:bg-success-light", "dark:text-success-lighter"
            );
        } else {
            banner.classList.add(
                "border-warning-light", "bg-warning-lighter", "text-warning-darker",
                "dark:border-warning", "dark:bg-warning-light", "dark:text-warning-lighter"
            );
        }
    }

    function showRetryOption(retryCallback) {
        const banner = document.getElementById("status-banner");
        if (!banner) return;

        banner.innerHTML = `
      <div class="flex items-center justify-between gap-4 w-full">
        <div>
          <p class="font-semibold">Ошибка отправки ответа</p>
          <p class="text-sm mt-1">Проверьте подключение к сети и попробуйте снова</p>
        </div>
        <button 
          id="retry-submit-btn" 
          class="shrink-0 px-4 py-2 bg-surface-1 dark:bg-surface-2 border border-current rounded-lg font-semibold hover:bg-bg-hover dark:hover:bg-bg-hover transition"
        >
          Повторить
        </button>
      </div>
    `;

        banner.classList.remove("hidden");
        banner.className = "mb-6 rounded-lg border p-4 flex items-start gap-3 border-error-light bg-error-lighter text-error-darker dark:border-error dark:bg-error-light dark:text-error-lighter";

        const btn = document.getElementById("retry-submit-btn");
        if (btn && retryCallback) {
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
        nextBtn.disabled = SessionState.isLoading || !SessionState.canGoNext;
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

