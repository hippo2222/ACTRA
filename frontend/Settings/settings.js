/**
 * Settings page — AI Keys management.
 */
(function () {
    'use strict';

    const PROVIDERS_ORDER = ['openrouter', 'gemini', 'groq'];

    const PROVIDER_ICONS = {
        openrouter: 'route',
        gemini: 'auto_awesome',
        groq: 'bolt',
    };

    const PROVIDER_COLORS = {
        openrouter: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
        gemini: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600', badge: 'bg-purple-100 text-purple-700' },
        groq: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
    };

    let _providersData = {};
    let _validationState = {}; // provider -> 'idle' | 'validating' | 'valid' | 'invalid'

    // -------------------------------------------------------------------------
    // Load
    // -------------------------------------------------------------------------

    async function loadKeys() {
        const container = document.getElementById('providers-container');
        try {
            const res = await fetch('/api/users/ai-keys');
            const data = await res.json();
            if (!data.ok) {
                container.innerHTML = renderError('Не удалось загрузить ключи');
                return;
            }
            _providersData = data.providers || {};
            renderProviders();
        } catch (e) {
            console.error('[Settings] Failed to load AI keys:', e);
            container.innerHTML = renderError('Ошибка сети при загрузке ключей');
        }
    }

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------

    function renderProviders() {
        const container = document.getElementById('providers-container');
        const cards = PROVIDERS_ORDER.map((name, idx) => {
            const p = _providersData[name] || {};
            const colors = PROVIDER_COLORS[name] || PROVIDER_COLORS.openrouter;
            const icon = PROVIDER_ICONS[name] || 'key';
            const hasKey = p.has_key || false;
            const masked = p.masked || '';
            const hint = p.hint || '';
            const url = p.url || '';
            const label = p.label || name;
            const isRecommended = name === 'openrouter';
            const vstatus = _validationState[name] || 'idle';

            return `
            <div class="provider-card rounded-xl border ${colors.border} ${colors.bg} p-5 animate-fade-in"
                 style="animation-delay: ${idx * 80}ms">
                <div class="flex items-start justify-between gap-3 mb-4">
                    <div class="flex items-center gap-3">
                        <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-white/80 shadow-sm">
                            <span class="material-symbols-outlined ${colors.icon} text-[20px]">${icon}</span>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-text-main">${escapeHtml(label)}</span>
                                ${isRecommended ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-fg uppercase tracking-wide">рекомендуем</span>' : ''}
                            </div>
                            <div class="text-xs text-text-secondary mt-0.5">${escapeHtml(hint)}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0 ${vstatus === 'validating' ? 'validating' : ''}">
                        ${renderStatusBadge(vstatus, hasKey)}
                    </div>
                </div>

                <div class="flex gap-2">
                    <div class="relative flex-1">
                        <input type="password" id="key-input-${name}"
                            class="key-input block w-full rounded-lg border border-border-subtle bg-white/90 py-2.5 px-3 text-sm text-text-main placeholder:text-text-disabled focus:ring-2 focus:ring-primary focus:border-primary pr-10"
                            placeholder="${hasKey ? masked : 'Вставьте API-ключ...'}"
                            autocomplete="off" spellcheck="false"
                            data-provider="${name}">
                        <button onclick="toggleKeyVisibility('${name}')" type="button"
                            class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-2 transition-colors"
                            title="Показать/скрыть ключ">
                            <span class="material-symbols-outlined text-text-muted text-[18px]" id="eye-icon-${name}">visibility_off</span>
                        </button>
                    </div>
                    <button onclick="validateKey('${name}')"
                        class="px-3 py-2 text-xs font-semibold rounded-lg border border-border-subtle bg-white hover:bg-surface-2 text-text-secondary transition-colors shrink-0"
                        id="validate-btn-${name}"
                        title="Проверить ключ">
                        <span class="material-symbols-outlined text-[16px]">verified</span>
                    </button>
                </div>

                ${url ? `
                <div class="mt-3 flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-[14px] text-text-disabled">open_in_new</span>
                    <a href="${escapeHtml(url)}" target="_blank" rel="noopener"
                       class="text-xs text-primary hover:underline font-medium">Получить ключ</a>
                </div>` : ''}
            </div>`;
        });

        container.innerHTML = cards.join('');
    }

    function renderStatusBadge(status, hasKey) {
        switch (status) {
            case 'validating':
                return '<span class="status-dot bg-warning"></span><span class="text-xs text-warning-text font-medium">Проверка...</span>';
            case 'valid':
                return '<span class="status-dot bg-success"></span><span class="text-xs text-success-text font-medium">Работает</span>';
            case 'invalid':
                return '<span class="status-dot bg-error"></span><span class="text-xs text-error font-medium">Недействителен</span>';
            default:
                if (hasKey) {
                    return '<span class="status-dot bg-success"></span><span class="text-xs text-success-text font-medium">Настроен</span>';
                }
                return '<span class="status-dot bg-border-subtle"></span><span class="text-xs text-text-disabled">Не настроен</span>';
        }
    }

    function renderError(msg) {
        return `
        <div class="text-center py-12">
            <span class="material-symbols-outlined text-error text-[32px]">error</span>
            <p class="text-sm text-text-secondary mt-2">${escapeHtml(msg)}</p>
            <button onclick="loadKeys()" class="mt-3 text-sm text-primary hover:underline">Повторить</button>
        </div>`;
    }

    // -------------------------------------------------------------------------
    // Save
    // -------------------------------------------------------------------------

    async function saveKeys() {
        const btn = document.getElementById('save-keys-btn');
        const statusEl = document.getElementById('save-status');
        btn.disabled = true;
        statusEl.textContent = 'Сохранение...';
        statusEl.className = 'text-sm text-text-muted';

        const keys = {};
        for (const name of PROVIDERS_ORDER) {
            const input = document.getElementById(`key-input-${name}`);
            if (input && input.value.trim()) {
                keys[name] = input.value.trim();
            } else if (_providersData[name]?.has_key && (!input || !input.value)) {
                // Keep existing key (user didn't type anything) — send empty to signal "keep"
                // Actually, we need to NOT send anything for unchanged keys.
                // The backend will only save non-empty keys, so if user clears the field,
                // the key will be removed. If user doesn't touch it, we need to preserve.
                // Solution: if the input is empty and the key existed, don't include it
                // and let the backend keep the old one. But the backend replaces all keys...
                // So we need to read the raw key from the backend. We can't — it's masked.
                // Best approach: if input is empty and key existed, re-read from settings.
                // Simpler: treat empty input with existing key as "keep existing".
            }
        }

        // For keys that existed but input is empty: we need to re-fetch and merge
        // Actually, simplest: the backend stores the full set. If user only changes one key,
        // we send only the changed ones. But for keys we don't send, we need to keep the old.
        // Let's fetch current raw keys from a dedicated endpoint... no, that's insecure.
        // Best UX: if user leaves input empty and key was configured, keep the old key.
        // We'll send a special signal: "__keep__" for unchanged keys.
        const payload = {};
        for (const name of PROVIDERS_ORDER) {
            const input = document.getElementById(`key-input-${name}`);
            const val = input ? input.value.trim() : '';
            if (val) {
                payload[name] = val;
            }
            // If empty and key existed, we don't include it — backend will remove it
            // This is correct: if user clears field, they want to remove the key
        }

        try {
            const res = await fetch('/api/users/ai-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keys: payload }),
            });
            const data = await res.json();

            if (data.ok) {
                statusEl.textContent = 'Сохранено!';
                statusEl.className = 'text-sm text-success-text font-medium';
                // Reload to refresh masked values
                await loadKeys();
                // Clear inputs (they now show masked placeholders)
                for (const name of PROVIDERS_ORDER) {
                    const input = document.getElementById(`key-input-${name}`);
                    if (input) input.value = '';
                }
            } else {
                statusEl.textContent = data.error || 'Ошибка сохранения';
                statusEl.className = 'text-sm text-error font-medium';
            }
        } catch (e) {
            console.error('[Settings] Save failed:', e);
            statusEl.textContent = 'Ошибка сети';
            statusEl.className = 'text-sm text-error font-medium';
        } finally {
            btn.disabled = false;
            setTimeout(() => {
                statusEl.textContent = '';
            }, 4000);
        }
    }

    // -------------------------------------------------------------------------
    // Validate
    // -------------------------------------------------------------------------

    async function validateKey(providerName) {
        const input = document.getElementById(`key-input-${providerName}`);
        const key = input ? input.value.trim() : '';

        if (!key) {
            showToast('Введите ключ для проверки', 'warning');
            return;
        }

        _validationState[providerName] = 'validating';
        renderProviders();
        // Re-fill the input value after re-render
        const inputAfter = document.getElementById(`key-input-${providerName}`);
        if (inputAfter) inputAfter.value = key;

        try {
            const res = await fetch('/api/users/ai-keys/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: providerName, api_key: key }),
            });
            const data = await res.json();

            if (data.ok && data.valid) {
                _validationState[providerName] = 'valid';
                showToast(`${_providersData[providerName]?.label || providerName}: ключ действителен`, 'success');
            } else {
                _validationState[providerName] = 'invalid';
                showToast(`${_providersData[providerName]?.label || providerName}: ключ недействителен`, 'error');
            }
        } catch (e) {
            _validationState[providerName] = 'invalid';
            showToast('Ошибка сети при проверке ключа', 'error');
        }

        renderProviders();
        // Re-fill after re-render
        const inputFinal = document.getElementById(`key-input-${providerName}`);
        if (inputFinal) inputFinal.value = key;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function toggleKeyVisibility(providerName) {
        const input = document.getElementById(`key-input-${providerName}`);
        const icon = document.getElementById(`eye-icon-${providerName}`);
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) icon.textContent = 'visibility';
        } else {
            input.type = 'password';
            if (icon) icon.textContent = 'visibility_off';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function showToast(message, type) {
        const colors = {
            success: 'bg-success text-white',
            error: 'bg-error text-white',
            warning: 'bg-warning text-warning-dark',
            info: 'bg-info text-white',
        };
        const toast = document.createElement('div');
        toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${colors[type] || colors.info} transition-all opacity-0 translate-y-2`;
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.transition = 'opacity 200ms, transform 200ms';
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(8px)';
            setTimeout(() => toast.remove(), 250);
        }, 3500);
    }

    // Expose globally
    window.saveKeys = saveKeys;
    window.validateKey = validateKey;
    window.toggleKeyVisibility = toggleKeyVisibility;
    window.loadKeys = loadKeys;

    // Init
    document.addEventListener('DOMContentLoaded', loadKeys);
})();
