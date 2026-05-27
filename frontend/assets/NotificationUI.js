/**
 * NotificationUI — shared toast & confirm-dialog utility.
 * Drop-in replacement for native alert() / confirm().
 *
 * Usage:
 *   NotificationUI.toast('Сохранено', 'success');
 *   NotificationUI.toast('Ошибка сети', 'error');
 *   const ok = await NotificationUI.confirm({ title: 'Удалить?', message: '...' });
 */
window.NotificationUI = (function () {
    // ── helpers ──────────────────────────────────────────────────────────
    function _ensureContainer() {
        let c = document.getElementById('notify-toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'notify-toast-container';
            c.className = 'pointer-events-none fixed bottom-0 right-0 z-[100010] flex max-w-sm flex-col items-end gap-3 overflow-x-hidden p-4 sm:p-6';
            c.style.position = 'fixed';
            c.style.right = '0';
            c.style.bottom = '0';
            c.style.left = 'auto';
            c.style.top = 'auto';
            c.style.zIndex = "100010";
            (document.body || document.documentElement).appendChild(c);
        }
        return c;
    }

    const _ICONS = {
        success: 'check_circle',
        error: 'error',
        warning: 'warning',
        info: 'info',
    };

    const _COLORS = {
        success: {
            bg: 'bg-success-lighter border-success-light dark:bg-success-dark dark:border-success-light',
            icon: 'text-success-dark dark:text-success-text',
            text: 'text-success-dark dark:text-success-text',
        },
        error: {
            bg: 'bg-error-lighter border-error-light dark:bg-error-dark dark:border-error-light',
            icon: 'text-error-dark dark:text-error-text',
            text: 'text-error-dark dark:text-error-text',
        },
        warning: {
            bg: 'bg-warning-lighter border-warning-light dark:bg-warning-dark dark:border-warning-light',
            icon: 'text-warning-darker dark:text-warning-text',
            text: 'text-warning-darker dark:text-warning-text',
        },
        info: {
            bg: 'bg-info-lighter border-info-light dark:bg-info-dark dark:border-info-light',
            icon: 'text-info-dark dark:text-info-text',
            text: 'text-info-dark dark:text-info-text',
        },
    };

    const _SEVERITY_TO_VARIANT = {
        success: 'success',
        warning: 'warning',
        error: 'error',
        blocking: 'error',
        info: 'info',
    };

    function normalizeSeverity(severity) {
        const key = String(severity || '').trim().toLowerCase();
        return _SEVERITY_TO_VARIANT[key] ? key : 'info';
    }

    function resolveVariant(severityOrVariant) {
        const normalized = normalizeSeverity(severityOrVariant);
        return _SEVERITY_TO_VARIANT[normalized] || 'info';
    }

    function voiceMessage({ what = '', impact = '', next = '' } = {}) {
        const parts = [];
        const whatPart = String(what || '').trim();
        const impactPart = String(impact || '').trim();
        const nextPart = String(next || '').trim();

        if (whatPart) parts.push(whatPart);
        if (impactPart) parts.push(impactPart);
        if (nextPart) parts.push(nextPart);

        return parts.join(' ');
    }

    function toastVoice({ what = '', impact = '', next = '', severity = 'info', timeout = 4000, ...options } = {}) {
        const message = voiceMessage({ what, impact, next });
        if (!message) return;
        toast(message, resolveVariant(severity), timeout, options);
    }

    // ── toast ────────────────────────────────────────────────────────────
    function toast(message, variant = 'info', timeout = 4000, options = {}) {
        const container = _ensureContainer();
        const colors = _COLORS[variant] || _COLORS.info;
        const icon = _ICONS[variant] || 'info';
        const timeoutMs = Number.isFinite(timeout) ? Math.max(0, Number(timeout)) : 0;

        const el = document.createElement('div');
        el.className =
            `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg ` +
            `${colors.bg} w-full max-w-sm transform translate-x-[120%] transition-transform duration-300`;
        el.setAttribute('role', 'status');

        const iconEl = document.createElement('span');
        iconEl.className = `material-symbols-outlined text-[20px] ${colors.icon} shrink-0`;
        iconEl.textContent = icon;
        el.appendChild(iconEl);

        const textWrap = document.createElement('div');
        textWrap.className = 'min-w-0 flex-1';

        const textEl = document.createElement('div');
        textEl.className = `text-sm font-medium ${colors.text}`;
        textEl.textContent = String(message || '');
        textWrap.appendChild(textEl);

        let timerEl = null;
        if (options.showTimer && timeoutMs > 0) {
            timerEl = document.createElement('div');
            timerEl.className = `mt-1 text-xs font-semibold ${colors.icon} opacity-75`;
            textWrap.appendChild(timerEl);
        }

        el.appendChild(textWrap);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'ml-auto flex shrink-0 items-center gap-2';

        let dismissed = false;
        let dismissTimer = null;
        let countdownTimer = null;
        const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
        const renderCountdown = () => {
            if (!timerEl || !deadline) return;
            const secondsLeft = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
            timerEl.textContent = typeof options.timerFormatter === 'function'
                ? String(options.timerFormatter(secondsLeft))
                : `${secondsLeft} ${(window.i18n?.t('notify.timer_seconds') ?? 'с')}`;
        };
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            if (dismissTimer) {
                window.clearTimeout(dismissTimer);
                dismissTimer = null;
            }
            if (countdownTimer) {
                window.clearInterval(countdownTimer);
                countdownTimer = null;
            }
            el.classList.remove('translate-x-0');
            el.classList.add('translate-x-[120%]');
            setTimeout(() => el.remove(), 300);
        };

        if (options?.actionLabel && typeof options.onAction === 'function') {
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className = `rounded-md border border-current/20 px-2 py-1 text-xs font-semibold whitespace-nowrap transition-colors hover:bg-black/10 ${colors.icon}`;
            actionBtn.textContent = String(options.actionLabel || '');
            actionBtn.onclick = () => {
                try {
                    options.onAction();
                } finally {
                    if (options.dismissOnAction !== false) {
                        dismiss();
                    }
                }
            };
            actionsEl.appendChild(actionBtn);
        }

        if (options.closeable !== false) {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = `shrink-0 p-0.5 rounded hover:bg-black/10 transition-colors ${colors.icon}`;
            closeBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">close</span>';
            closeBtn.onclick = dismiss;
            actionsEl.appendChild(closeBtn);
        }

        if (actionsEl.childElementCount > 0) {
            el.appendChild(actionsEl);
        }
        container.appendChild(el);

        requestAnimationFrame(() => {
            el.classList.remove('translate-x-[120%]');
            el.classList.add('translate-x-0');
        });

        if (timerEl) {
            renderCountdown();
            countdownTimer = window.setInterval(renderCountdown, 250);
        }

        if (timeoutMs > 0) {
            dismissTimer = window.setTimeout(dismiss, timeoutMs);
        }
        return { dismiss, element: el };
    }

    // ── confirm dialog ──────────────────────────────────────────────────
    function confirm({
        title = (window.i18n?.t('notify.confirm_title') ?? 'Подтверждение'),
        message = (window.i18n?.t('notify.confirm_message') ?? 'Вы уверены?'),
        confirmText = (window.i18n?.t('notify.confirm_ok') ?? 'Подтвердить'),
        cancelText = (window.i18n?.t('notify.confirm_cancel') ?? 'Отмена'),
        variant = 'error',
    } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className =
                'fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm ' +
                'opacity-0 transition-opacity duration-200';
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.padding = '1rem';
            overlay.style.overflowY = 'auto';
            overlay.style.zIndex = '100020';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');

            const btnColor = variant === 'error'
                ? 'bg-status-error hover:bg-red-600 text-white'
                : 'bg-primary hover:bg-primary-dark text-primary-fg';

            const docEl = document.documentElement;
            const body = document.body;
            const previousDocOverflow = docEl ? docEl.style.overflow : '';
            const previousBodyOverflow = body ? body.style.overflow : '';
            const previousBodyPaddingRight = body ? body.style.paddingRight : '';
            const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const scrollbarWidth = docEl ? Math.max(0, window.innerWidth - docEl.clientWidth) : 0;

            if (docEl) docEl.style.overflow = 'hidden';
            if (body) {
                body.style.overflow = 'hidden';
                if (scrollbarWidth > 0) {
                    body.style.paddingRight = `${scrollbarWidth}px`;
                }
            }

            overlay.innerHTML = `
                <div class="bg-surface-1 rounded-2xl shadow-xl max-w-md w-full p-6 transform scale-95 transition-transform duration-200"
                     data-role="confirm-card">
                    <h3 class="text-lg font-bold text-text-main mb-2">${_esc(title)}</h3>
                    <p class="text-sm text-text-secondary mb-6 whitespace-pre-line">${_esc(message)}</p>
                    <div class="flex justify-end gap-3">
                        <button data-role="cancel"
                            class="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-main hover:bg-surface-2 rounded-lg transition-colors">
                            ${_esc(cancelText)}
                        </button>
                        <button data-role="confirm"
                            class="px-5 py-2 text-sm font-bold rounded-lg shadow-sm transition-colors ${btnColor}">
                            ${_esc(confirmText)}
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.classList.remove('opacity-0');
                const card = overlay.querySelector('[data-role="confirm-card"]');
                if (card) card.classList.remove('scale-95');
                const confirmBtn = overlay.querySelector('[data-role="confirm"]');
                if (confirmBtn) confirmBtn.focus({ preventScroll: true });
            });

            let settled = false;
            const cleanup = () => {
                document.removeEventListener('keydown', onKey);
                if (docEl) docEl.style.overflow = previousDocOverflow;
                if (body) {
                    body.style.overflow = previousBodyOverflow;
                    body.style.paddingRight = previousBodyPaddingRight;
                }
            };

            const close = (result) => {
                if (settled) return;
                settled = true;
                cleanup();
                overlay.classList.add('opacity-0');
                const card = overlay.querySelector('[data-role="confirm-card"]');
                if (card) card.classList.add('scale-95');
                setTimeout(() => {
                    overlay.remove();
                    if (activeElement && typeof activeElement.focus === 'function') {
                        activeElement.focus({ preventScroll: true });
                    }
                }, 200);
                resolve(result);
            };

            overlay.querySelector('[data-role="cancel"]').onclick = () => close(false);
            overlay.querySelector('[data-role="confirm"]').onclick = () => close(true);

            // ESC = cancel
            const onKey = (e) => {
                if (e.key === 'Escape') { close(false); }
            };
            document.addEventListener('keydown', onKey);

            // Click backdrop = cancel
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close(false);
            });
        });
    }

    function _esc(str) {
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }

    return {
        toast,
        confirm,
        normalizeSeverity,
        resolveVariant,
        voiceMessage,
        toastVoice,
    };
})();
