/**
 * Microcards Runtime UI (M10 + M13) — standalone review-first page.
 *
 * Features (M10):
 *  - Deck list with due/new/total counts
 *  - Queue open / resume / restart
 *  - Review flow: fact_recall (front→back→rate) and pair_match (matching→check→rate)
 *  - Work-on-errors loop: incorrect cards requeued to tail of session
 *  - Correct result shown after error
 *  - Session summary
 *  - pair_match behind feature flag
 *
 * UX-polish (M13):
 *  - Keyboard shortcuts: Space/Enter=reveal, 1-4=rating, Escape=back
 *  - Focus management: auto-focus reveal/rating buttons
 *  - Accessibility: ARIA attributes, focus-visible rings, reduced-motion
 *  - Success/failure glow via project's --_glow / a-result-glow pattern
 *  - Streak badge with tiered styling (warm/hot/epic)
 *  - Pair_match result highlighting with pop/shake animations
 *  - Rating button keyboard-active visual feedback
 *  - Session summary with animated counters and confetti celebration
 */

(function () {
    'use strict';

    // ── Helpers ───────────────────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }
    function escHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }
    function escJsString(s) {
        return String(s ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\x22')
            .replace(/&/g, '\\x26')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029')
            .replace(/</g, '\\x3C')
            .replace(/>/g, '\\x3E');
    }
    function show(el) { if (el) el.classList.remove('hidden'); }
    function hide(el) { if (el) el.classList.add('hidden'); }
    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return m + ':' + String(s).padStart(2, '0');
    }

    function normalizeDeckSearch(value) {
        return String(value ?? '')
            .toLocaleLowerCase('ru-RU')
            .trim();
    }

    function parseDeckTimestamp(value) {
        if (!value) return 0;
        const ts = Date.parse(value);
        return Number.isFinite(ts) ? ts : 0;
    }

    function getDeckStats(deck) {
        const stats = deck?.stats || {};
        return {
            due: Math.max(0, Number(stats.cards_due ?? 0)),
            newCards: Math.max(0, Number(stats.cards_new ?? 0)),
            total: Math.max(0, Number(stats.cards_total ?? 0)),
        };
    }

    function getDeckPriorityScore(deck) {
        const { due, newCards } = getDeckStats(deck);
        return (due * 10) + (newCards * 4);
    }

    function isDeckRecent(deck) {
        const meta = deck?.meta || {};
        const updatedAt = parseDeckTimestamp(meta.updated_at || meta.created_at);
        if (!updatedAt) return false;
        const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
        return (Date.now() - updatedAt) <= maxAgeMs;
    }

    function getDeckTopicLabel(deck) {
        const selector = deck?.selector || {};
        const meta = deck?.meta || {};
        const labels = [];
        const metaTopic = String(meta.topic || meta.section_title || meta.title || '').trim();
        const scope = String(selector.scope || '').trim();
        const language = String(deck?.target_language || '').trim();
        if (metaTopic) labels.push(metaTopic);
        if (scope && scope !== 'all' && !labels.includes(scope)) labels.push(scope);
        if (language && !labels.includes(language)) labels.push(language);
        return labels.join(' · ');
    }

    function getDeckSearchText(deck) {
        return normalizeDeckSearch([
            deck?.name || '',
            getDeckTopicLabel(deck),
            deck?.id || '',
        ].join(' '));
    }

    function getDeckOwnership(deck) {
        const ownership = (deck && typeof deck.ownership === 'object') ? deck.ownership : {};
        const meta = (deck && typeof deck.meta === 'object') ? deck.meta : {};
        const createdByUserId = String(
            ownership.created_by_user_id || meta.created_by_user_id || ''
        ).trim();
        const createdVia = String(
            ownership.created_via || meta.source || ''
        ).trim() || ((deck && deck.analysis_id) ? 'analysis_auto' : 'manual_editor');
        return {
            createdByUserId,
            createdVia,
            hasOwner: ownership.has_owner === true || !!createdByUserId,
            isOwnedByCurrentUser: ownership.is_owned_by_current_user === true,
        };
    }

    function getDeckCreatedViaLabel(createdVia) {
        const normalized = String(createdVia || '').trim().toLowerCase();
        if (normalized === 'manual_editor') return 'Редактор';
        if (normalized === 'analysis_auto') return 'ИИ';
        if (normalized === 'text_import') return 'Импорт';
        return 'Система';
    }

    function formatOwnerDisplayName(userId) {
        if (!userId) return '';
        // Hide technical IDs like user_7f4b075b5365
        if (/^user_[a-f0-9]{8,}$/i.test(userId)) return 'Другой профиль';
        return userId;
    }

    function getCardTypeLabel(cardType) {
        if (cardType === 'fact_recall') return 'Запомни';
        if (cardType === 'pair_match') return 'Пары';
        return cardType;
    }

    function renderDeckOwnershipBadges(deck) {
        const ownership = getDeckOwnership(deck);
        const chips = [];
        const displayName = escHtml(formatOwnerDisplayName(ownership.createdByUserId));
        const rawOwnerId = escHtml(ownership.createdByUserId);
        const sourceLabel = escHtml(getDeckCreatedViaLabel(ownership.createdVia));
        if (ownership.isOwnedByCurrentUser) {
            chips.push('<span class="inline-flex items-center gap-1 rounded-full border border-success-light bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-text-main">моё</span>');
        } else if (ownership.hasOwner && displayName) {
            chips.push(`<span class="mc-owner-chip inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-secondary" title="${rawOwnerId}">${displayName}</span>`);
        }
        chips.push(`<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-secondary" title="${sourceLabel}">${sourceLabel}</span>`);
        return chips.join('');
    }

    function isImportedDeck(deck) {
        const createdVia = String(getDeckOwnership(deck).createdVia || '').trim().toLowerCase();
        return createdVia === 'text_import';
    }

    function matchesDeckOwnershipFilter(deck) {
        const ownership = getDeckOwnership(deck);
        if (state.deckOwnershipFilter === 'mine') {
            return ownership.isOwnedByCurrentUser;
        }
        if (state.deckOwnershipFilter === 'shared') {
            return !ownership.isOwnedByCurrentUser && !isImportedDeck(deck);
        }
        if (state.deckOwnershipFilter === 'imported') {
            return isImportedDeck(deck);
        }
        return true;
    }

    function getFilteredDecks() {
        const query = normalizeDeckSearch(state.deckListQuery);
        let decks = Array.isArray(state.decks) ? state.decks.slice() : [];

        if (query) {
            decks = decks.filter((deck) => getDeckSearchText(deck).includes(query));
        }

        decks = decks.filter((deck) => matchesDeckOwnershipFilter(deck));

        if (state.deckListFilter === 'urgent') {
            decks = decks
                .filter((deck) => getDeckPriorityScore(deck) > 0)
                .sort((a, b) => getDeckPriorityScore(b) - getDeckPriorityScore(a));
        } else if (state.deckListFilter === 'new') {
            decks = decks
                .filter((deck) => getDeckStats(deck).newCards > 0)
                .sort((a, b) => getDeckStats(b).newCards - getDeckStats(a).newCards);
        } else if (state.deckListFilter === 'recent') {
            decks = decks
                .filter((deck) => isDeckRecent(deck))
                .sort((a, b) => parseDeckTimestamp(b?.meta?.updated_at || b?.meta?.created_at) - parseDeckTimestamp(a?.meta?.updated_at || a?.meta?.created_at));
        } else {
            decks = decks.sort((a, b) => {
                const scoreDiff = getDeckPriorityScore(b) - getDeckPriorityScore(a);
                if (scoreDiff !== 0) return scoreDiff;
                return parseDeckTimestamp(b?.meta?.updated_at || b?.meta?.created_at) - parseDeckTimestamp(a?.meta?.updated_at || a?.meta?.created_at);
            });
        }

        return decks;
    }

    function getMostUrgentDeckId(decks) {
        let bestDeckId = '';
        let bestScore = 0;
        (decks || []).forEach((deck) => {
            const score = getDeckPriorityScore(deck);
            const deckId = String(deck?.id || '').trim();
            if (deckId && score > bestScore) {
                bestScore = score;
                bestDeckId = deckId;
            }
        });
        return bestDeckId;
    }

    function setDeckEmptyMessage(title, text) {
        const emptyState = $('mcDeckEmpty');
        if (!emptyState) return;
        const textBlocks = emptyState.querySelectorAll('p');
        if (textBlocks[0]) textBlocks[0].textContent = title;
        if (textBlocks[1]) textBlocks[1].textContent = text;
    }

    function updateDeckFilterHint(visibleCount, totalCount) {
        const hint = $('mcDeckFilterHint');
        const ownershipHint = $('mcDeckOwnershipHint');
        if (!hint) return;
        if (ownershipHint) {
            if (state.deckOwnershipFilter === 'mine') {
                ownershipHint.textContent = 'Показываем колоды, созданные из текущего профиля. Они всё равно живут в общей библиотеке.';
            } else if (state.deckOwnershipFilter === 'shared') {
                ownershipHint.textContent = 'Показываем общие колоды, созданные вне текущего профиля и не пришедшие через отдельный импорт.';
            } else if (state.deckOwnershipFilter === 'imported') {
                ownershipHint.textContent = 'Показываем колоды, пришедшие через текстовый импорт.';
            } else {
                ownershipHint.textContent = 'Колоды живут в общей библиотеке, а прогресс по ним остаётся личным.';
            }
        }
        if (!totalCount) {
            hint.textContent = 'Когда появятся колоды, здесь можно будет быстро выбрать, что повторять первым.';
            return;
        }
        if (state.deckListFilter === 'urgent') {
            hint.textContent = visibleCount
                ? `${visibleCount} колод с ближайшим повторением. Сверху — самая срочная.`
                : 'Срочных повторений по текущему фильтру нет.';
            return;
        }
        if (state.deckListFilter === 'new') {
            hint.textContent = visibleCount
                ? `${visibleCount} колод с новыми карточками. Хороший режим для короткого входа.`
                : 'Новых карточек по текущему запросу нет.';
            return;
        }
        if (state.deckListFilter === 'recent') {
            hint.textContent = visibleCount
                ? `${visibleCount} колод, к которым ты возвращался недавно.`
                : 'Недавних колод по текущему запросу не найдено.';
            return;
        }
        if (state.deckListQuery) {
            hint.textContent = `Найдено ${visibleCount} из ${totalCount}. Поиск работает по названию и теме колоды.`;
            return;
        }
        hint.textContent = 'Сначала показываем колоды с самым срочным повторением.';
        if (!state.deckListQuery && state.deckListFilter === 'all' && totalCount > 0) {
            hint.textContent = 'Колоды живут в общей локальной библиотеке, а прогресс по ним остаётся личным. Сначала показываем самые срочные колоды.';
        }
    }

    function updateDeckFilterUi() {
        document.querySelectorAll('.mc-deck-filter-chip[data-filter]').forEach((button) => {
            const isActive = button.dataset.filter === state.deckListFilter;
            button.classList.toggle('bg-primary', isActive);
            button.classList.toggle('text-primary-fg', isActive);
            button.classList.toggle('border-primary', isActive);
            button.classList.toggle('shadow-sm', isActive);
            button.classList.toggle('bg-surface-1', !isActive);
            button.classList.toggle('text-text-secondary', !isActive);
            button.classList.toggle('border-border-subtle', !isActive);
            button.classList.toggle('hover:bg-bg-hover', !isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    function updateDeckOwnershipFilterUi() {
        document.querySelectorAll('.mc-deck-ownership-chip[data-ownership-filter]').forEach((button) => {
            const isActive = button.dataset.ownershipFilter === state.deckOwnershipFilter;
            button.classList.toggle('bg-primary', isActive);
            button.classList.toggle('text-primary-fg', isActive);
            button.classList.toggle('border-primary', isActive);
            button.classList.toggle('shadow-sm', isActive);
            button.classList.toggle('bg-surface-1', !isActive);
            button.classList.toggle('text-text-secondary', !isActive);
            button.classList.toggle('border-border-subtle', !isActive);
            button.classList.toggle('hover:bg-bg-hover', !isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    function rerenderDeckList() {
        renderDeckListState();
        renderDeckGrid();
    }

    function bindDeckListControls() {
        const queryInput = $('mcDeckQuery');
        if (queryInput) {
            queryInput.addEventListener('input', () => {
                state.deckListQuery = queryInput.value || '';
                rerenderDeckList();
            });
        }

        document.querySelectorAll('.mc-deck-filter-chip[data-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                state.deckListFilter = button.dataset.filter || 'all';
                updateDeckFilterUi();
                rerenderDeckList();
            });
        });

        document.querySelectorAll('.mc-deck-ownership-chip[data-ownership-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                state.deckOwnershipFilter = button.dataset.ownershipFilter || 'all';
                updateDeckOwnershipFilterUi();
                rerenderDeckList();
            });
        });

        updateDeckFilterUi();
        updateDeckOwnershipFilterUi();
        updateDeckFilterHint(0, 0);
    }

    // ── Toast ─────────────────────────────────────────────────────────────
    function showToast(msg, type) {
        const container = $('mcToastContainer');
        if (!container) return;
        const toneMap = {
            success: 'border-success-light bg-success-lighter text-success-text',
            error: 'border-error-light bg-error-lighter text-error-text',
            warning: 'border-warning-light bg-warning-lighter text-warning-text',
            info: 'border-info-light bg-info-lighter text-info-text',
        };
        const tone = toneMap[type] || toneMap.info;
        const el = document.createElement('div');
        el.className = `pointer-events-auto px-4 py-2.5 rounded-xl border shadow-lg text-xs font-semibold ${tone}`;
        el.style.animation = 'a-slide-up 0.3s ease-out';
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    // ── State ─────────────────────────────────────────────────────────────
    const state = {
        // Feature flags
        featureFlags: { microcards_mode: true, microcards_pair_match: true },
        // M14: Microcards productization rollout flags
        prodFlags: {
            microcards_runtime_ui: true,
            microcards_home_entry: true,
            microcards_calendar_integration: true,
            microcards_statistics_integration: true,
            microcards_manual_editor: true,
            microcards_text_import: true,
            microcards_review_fx: true,
            microcards_pair_match_runtime: true,
        },

        // Deck list
        decks: [],
        decksLoading: false,
        decksError: '',
        deckListQuery: '',
        deckListFilter: 'all',
        deckOwnershipFilter: 'all',

        // Summary from /api/microcards/summary
        summary: null,

        // Active review session
        activeDeckId: null,
        activeDeckName: '',
        session: null,
        queue: [],           // original queue from server
        localQueue: [],      // working queue (includes requeued errors)
        localIndex: 0,       // current position in localQueue
        revealed: false,
        submitting: false,
        reviewStartedAt: 0,
        pairSelections: {},  // cardId -> { leftId: rightId }
        pairEvaluation: null,

        // Session stats (client-side tracking)
        sessionStartedAt: 0,
        sessionStats: { total: 0, correct: 0, errors: 0, again: 0, hard: 0, good: 0, easy: 0 },
        requeuedCardIds: new Set(), // cards that have been requeued at least once

        // Current view: 'decks' | 'review' | 'summary'
        view: 'decks',
    };

    // ── View Switching ────────────────────────────────────────────────────
    function switchView(v) {
        state.view = v;
        hide($('mcViewDeckList'));
        hide($('mcViewReview'));
        hide($('mcViewSummary'));
        if (v === 'decks') show($('mcViewDeckList'));
        else if (v === 'review') show($('mcViewReview'));
        else if (v === 'summary') show($('mcViewSummary'));

        // Header progress
        if (v === 'review') {
            show($('mcHeaderProgress'));
            updateHeaderProgress();
        } else {
            hide($('mcHeaderProgress'));
        }

        // Header subtitle
        const subtitle = $('mcHeaderSubtitle');
        if (subtitle) {
            if (v === 'review') subtitle.textContent = state.activeDeckName || 'Сессия повторения';
            else if (v === 'summary') subtitle.textContent = 'Результаты сессии';
            else subtitle.textContent = 'Повторение и обучение';
        }
    }

    function updateHeaderProgress() {
        const total = state.localQueue.length;
        const done = Math.min(state.localIndex, total);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const txt = $('mcHeaderProgressText');
        const bar = $('mcHeaderProgressBar');
        if (txt) txt.textContent = done + '/' + total;
        if (bar) bar.style.width = pct + '%';
    }

    // ── Feature Flags ─────────────────────────────────────────────────────
    async function loadFeatureFlags() {
        try {
            const resp = await fetch('/api/editor/theory/rollout/status');
            const data = await resp.json();
            if (data.ok && data.rollout && data.rollout.feature_flags) {
                const ff = data.rollout.feature_flags;
                state.featureFlags.microcards_mode = ff.microcards_mode !== false;
                state.featureFlags.microcards_pair_match = ff.microcards_pair_match !== false;
            }
        } catch (e) {
            console.warn('[Microcards] Failed to load feature flags:', e);
        }
        // M14: Load microcards productization rollout flags
        try {
            const resp2 = await fetch('/api/microcards/rollout/status');
            const data2 = await resp2.json();
            if (data2.ok && data2.rollout && data2.rollout.effective_feature_flags) {
                const pf = data2.rollout.effective_feature_flags;
                Object.keys(state.prodFlags).forEach(key => {
                    if (Object.prototype.hasOwnProperty.call(pf, key)) {
                        state.prodFlags[key] = pf[key] !== false;
                    }
                });
            }
        } catch (e) {
            console.warn('[Microcards] Failed to load prod rollout flags:', e);
        }
    }

    // M14: Telemetry helper — fire-and-forget POST to runtime telemetry endpoint
    function emitProdTelemetry(eventName, fields) {
        try {
            fetch('/api/microcards/runtime/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: eventName, fields: fields || {} }),
            }).catch(() => { });
        } catch (_) { /* fire-and-forget */ }
    }

    // ── Data Loading ──────────────────────────────────────────────────────
    async function loadSummary() {
        try {
            const resp = await fetch('/api/microcards/summary');
            const data = await resp.json();
            if (data.ok) {
                state.summary = data;
                renderSummaryStrip(data);
                renderStreakBadge(data);
            } else {
                state.summary = null;
                resetSummaryStrip();
            }
        } catch (e) {
            console.warn('[Microcards] summary fetch failed:', e);
            state.summary = null;
            resetSummaryStrip();
        }
    }

    function renderSummaryStrip(data) {
        const qs = data.queue_summary || {};
        const today = data.today || {};
        const el = (id, val) => { const e = $(id); if (e) e.textContent = val; };
        el('mcSummaryDue', String(qs.cards_due_total ?? 0));
        el('mcSummaryNew', String(qs.cards_new_total ?? 0));
        const todayReviews = Number(today.reviews || 0);
        const todayCR = today.correct_rate;
        const todayText = String(todayReviews)
            + (Number.isFinite(todayCR) ? ' · ' + Math.round(todayCR * 100) + '%' : '');
        el('mcSummaryToday', todayText);
    }

    function renderStreakBadge(data) {
        const streak = data.activity_streak_days ?? data.streak_days ?? null;
        const el = $('mcStreakDays');
        if (el) el.textContent = streak != null ? String(streak) : '—';

        const badge = $('mcStreakBadge');
        if (badge && streak != null) {
            badge.classList.remove('mc-streak-warm', 'mc-streak-hot', 'mc-streak-epic');
            if (streak >= 21) {
                badge.classList.add('mc-streak-epic');
            } else if (streak >= 7) {
                badge.classList.add('mc-streak-hot');
            } else if (streak >= 1) {
                badge.classList.add('mc-streak-warm');
            }
        }
    }

    function resetSummaryStrip() {
        const el = (id, val) => { const e = $(id); if (e) e.textContent = val; };
        el('mcSummaryDue', '0');
        el('mcSummaryNew', '0');
        el('mcSummaryToday', '—');
        el('mcStreakDays', '—');

        const badge = $('mcStreakBadge');
        if (badge) {
            badge.classList.remove('mc-streak-warm', 'mc-streak-hot', 'mc-streak-epic');
        }
    }

    async function loadDecks() {
        state.decksLoading = true;
        state.decksError = '';
        renderDeckListState();
        try {
            const resp = await fetch('/api/editor/microcards/decks?limit=100');
            const data = await resp.json();
            if (data.ok) {
                state.decks = Array.isArray(data.items) ? data.items : [];
                state.decksError = '';
            } else {
                state.decks = [];
                state.decksError = data.message || data.error || 'Не удалось загрузить колоды';
            }
        } catch (e) {
            console.error('[Microcards] loadDecks failed:', e);
            state.decks = [];
            state.decksError = 'Ошибка сети при загрузке колод';
        } finally {
            state.decksLoading = false;
            renderDeckListState();
            renderDeckGrid();
        }
    }

    // ── Deck List Rendering ───────────────────────────────────────────────
    function renderDeckListState() {
        const grid = $('mcDeckGrid');
        const loading = $('mcDeckLoading');
        const empty = $('mcDeckEmpty');
        const error = $('mcDeckError');
        const filteredDecks = getFilteredDecks();
        const ownershipScopedTotal = Array.isArray(state.decks)
            ? state.decks.filter((deck) => matchesDeckOwnershipFilter(deck)).length
            : 0;

        hide(grid); hide(loading); hide(empty); hide(error);

        if (state.decksLoading) {
            show(loading);
        } else if (state.decksError) {
            show(error);
            const errText = $('mcDeckErrorText');
            if (errText) errText.textContent = state.decksError;
        } else if (!state.decks.length) {
            setDeckEmptyMessage(
                'Нет колод микрокарточек',
                'Создайте колоду из анализа теории в редакторе или воспользуйтесь ручным созданием.',
            );
            show(empty);
        } else if (!filteredDecks.length) {
            setDeckEmptyMessage(
                'По этому фильтру колод нет',
                'Снимите часть ограничений или измените поисковый запрос, чтобы увидеть другие колоды.',
            );
            show(empty);
        } else {
            show(grid);
        }

        updateDeckFilterHint(filteredDecks.length, ownershipScopedTotal || state.decks.length);
    }

    function renderDeckGrid() {
        const grid = $('mcDeckGrid');
        const decks = getFilteredDecks();
        if (!grid) return;
        if (!decks.length) {
            grid.innerHTML = '';
            return;
        }

        const mostUrgentDeckId = getMostUrgentDeckId(decks);

        grid.innerHTML = decks.map(deck => {
            const rawId = String(deck.id || '');
            const idJs = escJsString(rawId);
            const name = escHtml(String(deck.name || deck.id || 'Колода'));
            const stats = deck.stats || {};
            const due = Number(stats.cards_due ?? 0);
            const newCards = Number(stats.cards_new ?? 0);
            const total = Number(stats.cards_total ?? 0);
            const hasDue = due > 0 || newCards > 0;
            const borderClass = hasDue ? 'border-primary-light hover:border-primary' : 'border-border-strong hover:border-border-strong';
            const isMostUrgent = rawId && rawId === mostUrgentDeckId && getDeckPriorityScore(deck) > 0;
            const topicLabel = getDeckTopicLabel(deck);
            const ownershipBadges = renderDeckOwnershipBadges(deck);
            const metaHintParts = [];
            if (topicLabel) metaHintParts.push(topicLabel);
            if (isDeckRecent(deck)) metaHintParts.push('обновлена недавно');
            const metaHint = escHtml(metaHintParts.join(' · '));
            const dueBadge = hasDue
                ? `<span class="inline-flex self-start shrink-0 items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-lighter text-primary border border-primary-light">${due + newCards} к повтору</span>`
                : `<span class="inline-flex self-start shrink-0 items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-2 text-text-secondary border border-border-subtle">всё пройдено</span>`;

            const urgentBadge = isMostUrgent
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning-lighter text-warning-text border border-warning-light">
                        <span class="material-symbols-outlined text-[12px]">priority_high</span>
                        Самое срочное
                   </span>`
                : '';

            return `
                <div class="mc-deck-card rounded-xl border ${borderClass} bg-surface-1 p-4 transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5 group"
                     onclick="mcApp.openDeck('${idJs}')">
                    <div class="mc-deck-header flex flex-wrap items-start justify-between gap-2 mb-3">
                        <div class="min-w-0 flex-1">
                            <h3 class="mc-deck-title text-sm font-bold text-text-main group-hover:text-primary transition-colors" title="${name}">${name}</h3>
                            ${metaHint ? `<p class="mc-deck-meta mt-1 text-[11px] text-text-secondary" title="${metaHint}">${metaHint}</p>` : ''}
                            ${ownershipBadges ? `<div class="mc-deck-badges mt-2 flex flex-wrap gap-1">${ownershipBadges}</div>` : ''}
                        </div>
                        ${dueBadge}
                    </div>
                    ${urgentBadge ? `<div class="mb-3">${urgentBadge}</div>` : ''}
                    <div class="mc-deck-stats flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                        <span class="flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px]">pending_actions</span>
                            ${escHtml(due)} к повтору
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px]">fiber_new</span>
                            ${escHtml(newCards)} новых
                        </span>
                        <span class="flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px]">layers</span>
                            ${escHtml(total)}
                        </span>
                    </div>
                    <div class="mt-3 flex gap-2">
                        <button type="button"
                            onclick="event.stopPropagation(); mcApp.openDeck('${idJs}')"
                            class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg ${hasDue ? 'bg-primary text-primary-fg hover:bg-primary-hover' : 'bg-surface-2 text-text-secondary hover:bg-bg-hover'} transition-colors">
                            <span class="material-symbols-outlined text-[16px]">play_arrow</span>
                            ${hasDue ? 'Повторять' : 'Открыть'}
                        </button>
                        <button type="button"
                            onclick="event.stopPropagation(); mcApp.openDeck('${idJs}', { restart: true })"
                            class="flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-semibold rounded-lg border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors"
                            title="Начать сессию заново">
                            <span class="material-symbols-outlined text-[14px]">restart_alt</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ── Queue / Session ───────────────────────────────────────────────────
    async function openDeck(deckId, options) {
        const id = String(deckId || '').trim();
        if (!id) return;
        const restart = !!(options && options.restart);

        state.activeDeckId = id;
        state.revealed = false;
        state.submitting = false;
        state.pairSelections = {};
        state.pairEvaluation = null;
        state.sessionStats = { total: 0, correct: 0, errors: 0, again: 0, hard: 0, good: 0, easy: 0 };
        state.requeuedCardIds = new Set();
        state.sessionStartedAt = Date.now();

        switchView('review');
        renderCardLoading();

        try {
            const params = new URLSearchParams({ limit: '100' });
            if (restart) params.set('restart', '1');
            const resp = await fetch(`/api/editor/microcards/decks/${encodeURIComponent(id)}/queue?${params.toString()}`);
            const data = await resp.json();
            if (data.ok) {
                state.activeDeckName = data.deck?.name || id;
                state.session = data.session || null;
                state.queue = Array.isArray(data.queue) ? data.queue : [];
                // Build local queue (clone) for work-on-errors support
                state.localQueue = state.queue.map(c => ({ ...c, _requeued: false }));
                state.localIndex = Math.max(0, Number(data.cursor) || 0);
                state.reviewStartedAt = Date.now();

                // M14: emit session started telemetry
                emitProdTelemetry('microcards_runtime_session_started', {
                    deck_id: id,
                    restart: restart,
                    queue_count: state.localQueue.length,
                    session_id: (state.session || {}).id || null,
                });

                const el = $('mcReviewDeckName');
                if (el) el.textContent = state.activeDeckName;

                renderCurrentCard();
            } else {
                showToast(data.message || data.error || 'Не удалось открыть колоду', 'error');
                backToDecks();
            }
        } catch (e) {
            console.error('[Microcards] openDeck failed:', e);
            showToast('Ошибка сети при открытии колоды', 'error');
            backToDecks();
        }
    }

    function renderCardLoading() {
        hide($('mcCardContent'));
        hide($('mcCardEmpty'));
        show($('mcCardLoading'));
    }

    function getCurrentCard() {
        if (state.localIndex >= 0 && state.localIndex < state.localQueue.length) {
            return state.localQueue[state.localIndex];
        }
        return null;
    }

    // ── Card Rendering ────────────────────────────────────────────────────
    function renderCurrentCard() {
        const card = getCurrentCard();
        hide($('mcCardLoading'));

        updateHeaderProgress();
        updateReviewProgress();

        if (!card) {
            // Session complete
            hide($('mcCardContent'));
            if (state.sessionStats.total > 0) {
                showSessionSummary();
            } else {
                show($('mcCardEmpty'));
            }
            return;
        }

        show($('mcCardContent'));
        hide($('mcCardEmpty'));

        const cardType = String(card.card_type || 'fact_recall');
        const isPair = cardType === 'pair_match' && state.featureFlags.microcards_pair_match;
        const front = (card.front && typeof card.front === 'object') ? card.front : {};
        const back = (card.back && typeof card.back === 'object') ? card.back : {};
        const frontText = String(front.text || '').trim() || 'Карточка';

        // Type badge
        const badge = $('mcCardTypeBadge');
        if (badge) badge.textContent = getCardTypeLabel(cardType);

        // Requeue badge
        const reqBadge = $('mcCardRequeueBadge');
        if (reqBadge) {
            if (card._requeued) show(reqBadge); else hide(reqBadge);
        }

        // Front text
        const frontEl = $('mcCardFront');
        if (frontEl) frontEl.textContent = frontText;

        // Pair match area
        const pairArea = $('mcPairMatchArea');
        if (isPair) {
            show(pairArea);
            renderPairMatchUI(card);
        } else {
            hide(pairArea);
        }

        // Reset reveal
        state.revealed = false;
        state.pairEvaluation = null;
        state.reviewStartedAt = Date.now();
        hide($('mcRevealArea'));
        hide($('mcCardBack'));
        hide($('mcPairResult'));

        // Action buttons
        show($('mcActionsPreReveal'));
        hide($('mcActionsPostReveal'));

        // Update reveal button text
        const revealBtn = $('mcBtnReveal');
        if (revealBtn) {
            revealBtn.textContent = isPair ? 'Проверить пары' : 'Показать ответ';
            // M13: auto-focus reveal button for keyboard flow
            requestAnimationFrame(() => revealBtn.focus({ preventScroll: true }));
        }

        // Glow animation for card area
        const cardArea = $('mcCardArea');
        if (cardArea) {
            cardArea.classList.remove('mc-glow-correct', 'mc-glow-incorrect');
        }
    }

    function updateReviewProgress() {
        const total = state.localQueue.length;
        const done = Math.min(state.localIndex, total);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        const progText = $('mcReviewProgress');
        if (progText) progText.textContent = done + '/' + total;

        const progBar = $('mcReviewProgressBar');
        if (progBar) progBar.style.width = pct + '%';

        // Requeue info
        const requeueCount = state.localQueue.slice(state.localIndex).filter(c => c._requeued).length;
        const reqInfo = $('mcReviewRequeueInfo');
        const reqCount = $('mcReviewRequeueCount');
        if (requeueCount > 0) {
            show(reqInfo);
            if (reqCount) reqCount.textContent = String(requeueCount);
        } else {
            hide(reqInfo);
        }
    }

    // ── Pair Match UI ─────────────────────────────────────────────────────
    function renderPairMatchUI(card) {
        const grid = $('mcPairMatchGrid');
        if (!grid) return;

        const frontPayload = (card.front && typeof card.front.payload === 'object') ? card.front.payload : {};
        const leftItems = Array.isArray(frontPayload.left_items) ? frontPayload.left_items : [];
        const rightItems = Array.isArray(frontPayload.right_items) ? frontPayload.right_items : [];

        if (!leftItems.length || !rightItems.length) {
            grid.innerHTML = '<p class="text-xs text-text-secondary">pair_match данные пусты.</p>';
            return;
        }

        const cardId = String(card.id || '');
        const cardIdJs = escJsString(cardId);
        if (!state.pairSelections[cardId]) state.pairSelections[cardId] = {};
        const saved = state.pairSelections[cardId];

        grid.innerHTML = leftItems.map(left => {
            const leftId = String(left.id || '');
            const leftIdJs = escJsString(leftId);
            const currentVal = String(saved[leftId] || '');
            const options = rightItems.map(right => {
                const rid = String(right.id || '');
                return `<option value="${escHtml(rid)}" ${currentVal === rid ? 'selected' : ''}>${escHtml(String(right.text || rid))}</option>`;
            }).join('');

            return `
                <div class="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div class="flex-1 text-sm text-text-main px-3 py-2 rounded-lg border border-border-strong bg-surface-2" data-pair-left="${escHtml(leftId)}">${escHtml(String(left.text || leftId))}</div>
                    <span class="hidden sm:block text-text-muted text-xs">→</span>
                    <select onchange="mcApp.setPairSelection('${cardIdJs}','${leftIdJs}', this.value)"
                        class="flex-1 rounded-lg border border-border-strong bg-surface-1 px-3 py-2 text-sm text-text-main focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all">
                        <option value="">Выберите...</option>
                        ${options}
                    </select>
                </div>
            `;
        }).join('');
    }

    function setPairSelection(cardId, leftId, rightId) {
        if (!state.pairSelections[cardId]) state.pairSelections[cardId] = {};
        state.pairSelections[cardId][leftId] = String(rightId || '');
    }

    // ── Reveal ────────────────────────────────────────────────────────────
    function reveal() {
        if (state.revealed || state.submitting) return;
        const card = getCurrentCard();
        if (!card) return;

        const cardType = String(card.card_type || 'fact_recall');
        const isPair = cardType === 'pair_match' && state.featureFlags.microcards_pair_match;

        state.revealed = true;
        show($('mcRevealArea'));

        if (isPair) {
            evaluatePairMatch(card);
            show($('mcPairResult'));
            hide($('mcCardBack'));
        } else {
            const back = (card.back && typeof card.back === 'object') ? card.back : {};
            const backText = String(back.text || '').trim() || 'Ответ не указан';
            const backEl = $('mcCardBackText');
            if (backEl) backEl.textContent = backText;
            show($('mcCardBack'));
            hide($('mcPairResult'));
        }

        hide($('mcActionsPreReveal'));
        show($('mcActionsPostReveal'));
        setRatingButtonsEnabled(true);

        // M13: auto-focus Good button for keyboard flow (most common rating)
        requestAnimationFrame(() => {
            const goodBtn = $('mcBtnGood');
            if (goodBtn) goodBtn.focus({ preventScroll: true });
        });
    }

    function evaluatePairMatch(card) {
        const cardId = String(card.id || '');
        const saved = state.pairSelections[cardId] || {};
        const frontPayload = (card.front && typeof card.front.payload === 'object') ? card.front.payload : {};
        const backPayload = (card.back && typeof card.back.payload === 'object') ? card.back.payload : {};
        const pairs = Array.isArray(backPayload.pairs) ? backPayload.pairs : [];
        const exps = Array.isArray(backPayload.explanations) ? backPayload.explanations : [];

        // Build ID→text lookup maps from front payload
        const leftItems = Array.isArray(frontPayload.left_items) ? frontPayload.left_items : [];
        const rightItems = Array.isArray(frontPayload.right_items) ? frontPayload.right_items : [];
        const leftTextById = new Map(leftItems.map(i => [String(i.id || ''), String(i.text || i.id || '')]));
        const rightTextById = new Map(rightItems.map(i => [String(i.id || ''), String(i.text || i.id || '')]));

        let total = 0, correct = 0;
        const pairResults = [];
        for (const p of pairs) {
            const lid = String(p.left_id || '');
            const rid = String(p.right_id || '');
            if (!lid || !rid) continue;
            total++;
            const userPick = String(saved[lid] || '');
            const isCorrect = userPick === rid;
            if (isCorrect) correct++;
            pairResults.push({
                leftId: lid, rightId: rid, userPick, isCorrect,
                leftText: leftTextById.get(lid) || lid,
                rightText: rightTextById.get(rid) || rid,
                userPickText: userPick ? (rightTextById.get(userPick) || userPick) : '',
            });
        }

        const score = total ? Math.round((correct / total) * 10000) / 100 : 0;
        const isPerfect = correct === total && total > 0;
        state.pairEvaluation = { score, correct, total, isPerfect, pairs: pairResults };

        // Render result
        const scoreBadge = $('mcPairScoreBadge');
        if (scoreBadge) {
            scoreBadge.textContent = score + '%';
            if (isPerfect) {
                scoreBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold border border-success-light bg-success-lighter text-success-text';
            } else {
                scoreBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold border border-error-light bg-error-lighter text-error-text';
            }
        }

        const resultGrid = $('mcPairResultGrid');
        if (resultGrid) {
            const expByLeft = new Map(exps.map(e => [String(e.left_id || ''), String(e.text || '')]));
            resultGrid.innerHTML = pairResults.map(pr => {
                const icon = pr.isCorrect
                    ? '<span class="material-symbols-outlined text-success text-[14px]">check_circle</span>'
                    : '<span class="material-symbols-outlined text-error text-[14px]">cancel</span>';
                const exp = expByLeft.get(pr.leftId);
                const correctAnswer = !pr.isCorrect ? `<span class="text-[10px] text-success-text ml-1">(верно: ${escHtml(pr.rightText)})</span>` : '';
                return `
                    <div class="flex items-start gap-2 text-xs ${pr.isCorrect ? '' : 'text-error-text'}">
                        ${icon}
                        <span class="text-text-main font-medium">${escHtml(pr.leftText)}</span>
                        <span class="text-text-muted">→</span>
                        <span class="${pr.isCorrect ? 'text-text-main' : 'text-error-text line-through'}">${escHtml(pr.userPickText || '—')}</span>
                        ${correctAnswer}
                        ${exp ? `<span class="text-text-secondary ml-1">· ${escHtml(exp)}</span>` : ''}
                    </div>
                `;
            }).join('');
        }

        // Glow animation
        const cardArea = $('mcCardArea');
        if (cardArea) {
            cardArea.classList.remove('mc-glow-correct', 'mc-glow-incorrect');
            void cardArea.offsetWidth; // force reflow
            cardArea.classList.add(isPerfect ? 'mc-glow-correct' : 'mc-glow-incorrect');
        }

        // Highlight pair match grid items
        highlightPairMatchResults(card, pairResults);
    }

    function highlightPairMatchResults(card, pairResults) {
        const pairArea = $('mcPairMatchArea');
        if (!pairArea) return;
        const leftEls = pairArea.querySelectorAll('[data-pair-left]');
        leftEls.forEach((el, idx) => {
            const lid = el.getAttribute('data-pair-left');
            const pr = pairResults.find(p => p.leftId === lid);
            if (pr) {
                el.classList.remove('mc-pair-correct', 'mc-pair-incorrect');
                // M13: stagger animation for sequential reveal feel
                el.style.animationDelay = (idx * 0.08) + 's';
                el.classList.add(pr.isCorrect ? 'mc-pair-correct' : 'mc-pair-incorrect');
            }
        });
    }

    // ── Rating Submission ─────────────────────────────────────────────────
    function setRatingButtonsEnabled(enabled) {
        ['mcBtnAgain', 'mcBtnHard', 'mcBtnGood', 'mcBtnEasy'].forEach(id => {
            const btn = $(id);
            if (btn) btn.disabled = !enabled;
        });
    }

    async function submitRating(rating) {
        if (!state.revealed || state.submitting) return;
        const card = getCurrentCard();
        if (!card) return;

        const deckId = state.activeDeckId;
        if (!deckId) return;

        state.submitting = true;
        setRatingButtonsEnabled(false);

        const cardType = String(card.card_type || 'fact_recall');
        const isPair = cardType === 'pair_match' && state.featureFlags.microcards_pair_match;
        const responseTimeMs = Math.max(0, Date.now() - state.reviewStartedAt);

        const responsePayload = isPair
            ? { mapping: state.pairSelections[String(card.id || '')] || {} }
            : null;

        // Determine if this was an error (for work-on-errors loop)
        let wasError = false;
        if (rating === 'again') {
            wasError = true;
        } else if (isPair && state.pairEvaluation && !state.pairEvaluation.isPerfect) {
            wasError = true;
        }

        try {
            const resp = await fetch('/api/editor/microcards/review/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deck_id: deckId,
                    card_id: card.id,
                    rating: rating,
                    session_id: state.session?.id || null,
                    response: responsePayload,
                    response_time_ms: responseTimeMs,
                }),
            });
            const data = await resp.json();
            if (data.ok) {
                // Update session
                if (data.session && typeof data.session === 'object') {
                    state.session = data.session;
                }

                // Track stats
                state.sessionStats.total++;
                state.sessionStats[rating] = (state.sessionStats[rating] || 0) + 1;
                if (wasError) {
                    state.sessionStats.errors++;
                } else {
                    state.sessionStats.correct++;
                }

                // Work-on-errors: requeue to tail if error
                if (wasError) {
                    const requeued = { ...card, _requeued: true };
                    state.localQueue.push(requeued);
                    state.requeuedCardIds.add(String(card.id || ''));
                }

                // Glow animation
                const cardArea = $('mcCardArea');
                if (cardArea) {
                    cardArea.classList.remove('mc-glow-correct', 'mc-glow-incorrect');
                    void cardArea.offsetWidth;
                    cardArea.classList.add(wasError ? 'mc-glow-incorrect' : 'mc-glow-correct');
                }

                // Advance
                state.localIndex++;
                state.revealed = false;
                state.pairEvaluation = null;
                state.reviewStartedAt = Date.now();

                // Clear pair selections for this card
                delete state.pairSelections[String(card.id || '')];

                // Next card
                renderCurrentCard();
            } else {
                const err = String(data.error || '');
                if (err.startsWith('session_')) {
                    showToast('Сессия устарела. Возвращаемся к колодам.', 'warning');
                    backToDecks();
                } else {
                    showToast(data.message || data.error || 'Ошибка сохранения review', 'error');
                }
            }
        } catch (e) {
            console.error('[Microcards] submitRating failed:', e);
            showToast('Ошибка сети при отправке оценки', 'error');
        } finally {
            state.submitting = false;
            if (state.revealed) setRatingButtonsEnabled(true);
        }
    }

    // ── Session Summary ───────────────────────────────────────────────
    function showSessionSummary() {
        const stats = state.sessionStats;
        const elapsed = Math.round((Date.now() - state.sessionStartedAt) / 1000);

        // M14: emit session completed telemetry
        emitProdTelemetry('microcards_runtime_session_completed', {
            deck_id: state.activeDeckId,
            total: stats.total,
            correct: stats.correct,
            errors: stats.errors,
            elapsed_seconds: elapsed,
            requeued_cards: state.requeuedCardIds.size,
        });

        $('mcSummaryDeckName').textContent = state.activeDeckName;

        // M13: animated stat counters
        const CE = window.CelebrationEffects;
        if (CE && CE.animateCounter) {
            CE.animateCounter($('mcSumTotal'), stats.total, { duration: 600 });
            CE.animateCounter($('mcSumCorrect'), stats.correct, { duration: 600 });
            CE.animateCounter($('mcSumErrors'), stats.errors, { duration: 600 });
        } else {
            $('mcSumTotal').textContent = String(stats.total);
            $('mcSumCorrect').textContent = String(stats.correct);
            $('mcSumErrors').textContent = String(stats.errors);
        }
        $('mcSumTime').textContent = formatTime(elapsed);
        $('mcSumRAgain').textContent = String(stats.again);
        $('mcSumRHard').textContent = String(stats.hard);
        $('mcSumRGood').textContent = String(stats.good);
        $('mcSumREasy').textContent = String(stats.easy);

        switchView('summary');

        // M13: confetti celebration for good results
        if (CE && CE.celebrate && stats.total > 0) {
            const successRate = Math.round((stats.correct / stats.total) * 100);
            const isPerfect = stats.errors === 0;
            CE.celebrate(successRate, { isPerfect, isFinalResults: true });
        }
    }

    // ── Navigation ────────────────────────────────────────────────────
    function backToDecks() {
        state.activeDeckId = null;
        state.session = null;
        state.queue = [];
        state.localQueue = [];
        state.localIndex = 0;
        switchView('decks');
        loadDecks();
        loadSummary();
    }

    function restartSession() {
        if (state.activeDeckId) {
            openDeck(state.activeDeckId, { restart: true });
        }
    }

    async function refreshDecks() {
        await Promise.all([loadDecks(), loadSummary()]);
    }

    // ── Keyboard Shortcuts ────────────────────────────────────────────────
    const _ratingBtnMap = { '1': 'mcBtnAgain', '2': 'mcBtnHard', '3': 'mcBtnGood', '4': 'mcBtnEasy' };
    const _ratingKeyMap = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };

    function handleKeyDown(e) {
        // Skip if focus is on an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

        // Escape: navigate back
        if (e.key === 'Escape') {
            e.preventDefault();
            if (state.view === 'review') {
                backToDecks();
            } else if (state.view === 'summary') {
                backToDecks();
            }
            return;
        }

        if (state.view === 'review') {
            // Space / Enter: reveal answer
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (!state.revealed) {
                    reveal();
                }
                return;
            }

            // 1-4: rate card with visual feedback
            if (state.revealed && !state.submitting) {
                const rating = _ratingKeyMap[e.key];
                const btnId = _ratingBtnMap[e.key];
                if (rating && btnId) {
                    e.preventDefault();
                    // M13: visual keyboard-active feedback
                    const btn = $(btnId);
                    if (btn) {
                        btn.classList.add('mc-rating-active');
                        setTimeout(() => btn.classList.remove('mc-rating-active'), 200);
                    }
                    submitRating(rating);
                }
            }
        }
    }

    // ── Current-user header widget ─────────────────────────────────────────
    async function loadCurrentUser() {
        try {
            const res = await fetch('/api/users/current');
            const data = await res.json();
            if (!data.ok || !data.user) return;
            const user = data.user;
            const avatarEl = document.getElementById('mcHeaderAvatar');
            const nameEl = document.getElementById('mcHeaderUserName');
            if (avatarEl && user.avatar_seed) {
                const seed = String(user.avatar_seed);
                avatarEl.src = seed.includes('.') ? `/api/assets/avatars/${encodeURIComponent(seed)}` : '/api/assets/avatars/1.png';
                avatarEl.alt = user.name || 'Пользователь';
            }
            if (nameEl) nameEl.textContent = user.name || 'Гость';
        } catch (e) {
            /* non-critical, keep defaults */
        }
    }

    // ── Init ──────────────────────────────────────────────────────────────
    async function init() {
        document.addEventListener('keydown', handleKeyDown);
        bindDeckListControls();

        switchView('decks');
        await loadFeatureFlags();

        // M14: emit runtime opened telemetry
        emitProdTelemetry('microcards_runtime_opened', {});

        await Promise.all([loadDecks(), loadSummary(), loadCurrentUser()]);

        // Check URL params for direct deck open
        const params = new URLSearchParams(window.location.search);
        const directDeck = params.get('deck');
        if (directDeck) {
            openDeck(directDeck);
        }
    }

    // ── Public API ────────────────────────────────────────────────────────
    window.mcApp = {
        openDeck,
        backToDecks,
        restartSession,
        refreshDecks,
        reveal,
        submitRating,
        setPairSelection,
        state,
    };

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
