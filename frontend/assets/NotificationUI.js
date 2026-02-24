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
            c.className = 'fixed inset-0 z-[200] flex flex-col items-end justify-end gap-3 p-6 pointer-events-none overflow-hidden';
            document.body.appendChild(c);
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
            bg: 'bg-success-light border-success',
            icon: 'text-success-dark',
            text: 'text-success-darker',
        },
        error: {
            bg: 'bg-error-light border-error',
            icon: 'text-error-dark',
            text: 'text-error-darker',
        },
        warning: {
            bg: 'bg-warning-light border-warning',
            icon: 'text-warning-dark',
            text: 'text-warning-darker',
        },
        info: {
            bg: 'bg-info-light border-info',
            icon: 'text-info-dark',
            text: 'text-info-darker',
        },
    };

    // ── toast ────────────────────────────────────────────────────────────
    function toast(message, variant = 'info', timeout = 4000) {
        const container = _ensureContainer();
        const colors = _COLORS[variant] || _COLORS.info;
        const icon = _ICONS[variant] || 'info';

        const el = document.createElement('div');
        el.className =
            `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg ` +
            `${colors.bg} w-full max-w-sm transform translate-x-[120%] transition-transform duration-300`;
        el.innerHTML = `
            <span class="material-symbols-outlined text-[20px] ${colors.icon} shrink-0">${icon}</span>
            <span class="text-sm font-medium ${colors.text} flex-1">${_esc(message)}</span>
            <button class="shrink-0 p-0.5 rounded hover:bg-black/10 transition-colors ${colors.icon}">
                <span class="material-symbols-outlined text-[16px]">close</span>
            </button>
        `;

        container.appendChild(el);
        // slide in
        requestAnimationFrame(() => {
            el.classList.remove('translate-x-[120%]');
            el.classList.add('translate-x-0');
        });

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            el.classList.remove('translate-x-0');
            el.classList.add('translate-x-[120%]');
            setTimeout(() => el.remove(), 300);
        };

        el.querySelector('button').onclick = dismiss;
        if (timeout > 0) setTimeout(dismiss, timeout);
    }

    // ── confirm dialog ──────────────────────────────────────────────────
    function confirm({
        title = 'Подтверждение',
        message = 'Вы уверены?',
        confirmText = 'Подтвердить',
        cancelText = 'Отмена',
        variant = 'error',
    } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className =
                'fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm ' +
                'opacity-0 transition-opacity duration-200';

            const btnColor = variant === 'error'
                ? 'bg-status-error hover:bg-red-600 text-white'
                : 'bg-primary hover:bg-primary-dark text-primary-fg';

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
            });

            const close = (result) => {
                overlay.classList.add('opacity-0');
                const card = overlay.querySelector('[data-role="confirm-card"]');
                if (card) card.classList.add('scale-95');
                setTimeout(() => overlay.remove(), 200);
                resolve(result);
            };

            overlay.querySelector('[data-role="cancel"]').onclick = () => close(false);
            overlay.querySelector('[data-role="confirm"]').onclick = () => close(true);

            // ESC = cancel
            const onKey = (e) => {
                if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey); }
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

    return { toast, confirm };
})();
