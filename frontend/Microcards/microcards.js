/**
 * Microcards Runtime JS Controller (V2)
 * Fully rewritten for FSRS planning, progressive levels, in-page editing and dialog modals.
 */

(function () {
    'use strict';

    // ── Helper Selectors ──────────────────────────────────────────────────
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
    
    // Translation helper
    function t(key, fallback) {
        if (!window.i18n) return fallback;
        const result = window.i18n.t(key);
        return result !== key ? result : fallback;
    }

    // ── App State ─────────────────────────────────────────────────────────
    const state = {
        view: 'library', // 'library' | 'details' | 'session' | 'summary' | 'editor'
        decks: [],
        sortKey: 'name-asc', // library sort order
        activeTag: null, // active tag filter
        activeDeckId: null,
        activeDeck: null,
        cards: [], // active deck cards
        activeCard: null, // card being edited
        
        // Session state
        session: null,
        sessionCards: [],
        sessionIndex: 0,
        sessionStats: { total: 0, correct: 0, errors: 0 },
        sessionErrors: [], // list of incorrect card objects
        isErrorsOnlyMode: false,

        // Gamification (per session)
        combo: 0,
        maxCombo: 0,
        sessionXp: 0,
        
        // Import modal state
        importFormat: 'csv',
        importSep: 'auto',
        
        // Keyboard controls lock
        keyboardLocked: false
    };

    // ── Toast Notifications ────────────────────────────────────────────────
    function showToast(msg, type = 'info') {
        const container = $('mcToastContainer');
        if (!container) return;
        const kind = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
        const el = document.createElement('div');
        el.className = `mc-toast mc-toast--${kind}`;
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    // ── Session progress (header toolbar) ──────────────────────────────────
    function updateHeaderProgress() {
        const total = state.sessionCards.length || 0;
        const current = Math.min(state.sessionIndex + 1, total);
        const textEl = $('mcHeaderProgressText');
        const barEl = $('mcHeaderProgressBar');
        if (textEl) textEl.textContent = total > 0 ? `${current}/${total}` : '0/0';
        if (barEl) barEl.style.width = total > 0 ? `${(state.sessionIndex / total) * 100}%` : '0%';
    }

    // ══ Gamification ═══════════════════════════════════════════════════════

    // Animated number pop-in (transitions.dev). Re-renders each char, replays.
    function popNumber(el, value) {
        if (!el) return;
        el.classList.add('t-digit-group');
        el.classList.remove('is-animating');
        el.replaceChildren();
        const chars = String(value).split('');
        chars.forEach((ch, i) => {
            const span = document.createElement('span');
            span.className = 't-digit';
            span.textContent = ch;
            if (i === chars.length - 2) span.dataset.stagger = '1';
            else if (i === chars.length - 1) span.dataset.stagger = '2';
            el.appendChild(span);
        });
        void el.offsetHeight; // reflow → replay
        el.classList.add('is-animating');
    }

    // Points for a correct answer: base + combo bonus (capped, satisfying ramp).
    function pointsForCombo(combo) {
        return 10 + Math.min(Math.max(combo - 1, 0), 9) * 3; // 10 → 37
    }

    function updateXpChip() {
        popNumber($('xpChipVal'), state.sessionXp);
    }

    function showCombo() {
        const chip = $('comboChip');
        if (!chip) return;
        if (state.combo >= 2) {
            $('comboChipText').textContent = '×' + state.combo;
            chip.style.display = 'inline-flex';
            chip.classList.remove('is-break');
            chip.classList.remove('is-pop'); void chip.offsetWidth; chip.classList.add('is-pop');
        } else if (chip.style.display !== 'none') {
            chip.classList.remove('is-pop');
            chip.classList.add('is-break');
            setTimeout(() => { chip.style.display = 'none'; chip.classList.remove('is-break'); }, 320);
        }
    }

    function floatXp(pts) {
        const el = $('mcFloatXp');
        if (!el) return;
        el.textContent = '+' + pts;
        el.classList.remove('is-float'); void el.offsetWidth; el.classList.add('is-float');
    }

    function playCheck() {
        const check = $('mcFeedbackCheck');
        if (!check) return;
        check.setAttribute('data-state', 'out');
        void check.offsetWidth;
        check.setAttribute('data-state', 'in');
    }

    function reactCard(kind) {
        const card = $('flashcardInner');
        if (!card) return;
        const glow = kind === 'correct' ? 'mc-glow-correct' : 'mc-glow-wrong';
        card.classList.remove('mc-glow-correct', 'mc-glow-wrong');
        void card.offsetWidth;
        card.classList.add(glow);
        setTimeout(() => card.classList.remove(glow), 760);
        if (kind === 'wrong') {
            card.classList.remove('mc-shake'); void card.offsetWidth; card.classList.add('mc-shake');
            setTimeout(() => card.classList.remove('mc-shake'), 320);
        }
    }

    // Central hook for every graded answer — drives combo, XP and feedback.
    function registerAnswer(isCorrect) {
        if (isCorrect) {
            state.combo += 1;
            state.maxCombo = Math.max(state.maxCombo, state.combo);
            const pts = pointsForCombo(state.combo);
            state.sessionXp += pts;
            updateXpChip();
            floatXp(pts);
            playCheck();
            reactCard('correct');
            showCombo();
        } else {
            state.combo = 0;
            reactCard('wrong');
            showCombo();
        }
    }

    // ── L1 grading rails (swipe-style side zones) ──────────────────────────
    function hideRails() {
        const arena = $('mcArena');
        if (arena) arena.classList.remove('is-grading', 'lean-left', 'lean-right');
    }
    function showRails() {
        const arena = $('mcArena');
        if (arena) arena.classList.add('is-grading');
    }
    function bindSessionRails() {
        const arena = $('mcArena'), railNo = $('railNo'), railYes = $('railYes');
        if (!arena || !railNo || !railYes) return;
        railNo.addEventListener('mouseenter', () => arena.classList.add('lean-left'));
        railNo.addEventListener('mouseleave', () => arena.classList.remove('lean-left'));
        railYes.addEventListener('mouseenter', () => arena.classList.add('lean-right'));
        railYes.addEventListener('mouseleave', () => arena.classList.remove('lean-right'));
        railNo.addEventListener('click', () => { if (arena.classList.contains('is-grading')) submitAnswerL1(false); });
        railYes.addEventListener('click', () => { if (arena.classList.contains('is-grading')) submitAnswerL1(true); });
    }

    // ── Daily streak (local, per-device) ───────────────────────────────────
    function _todayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function loadStreak() {
        try { return JSON.parse(localStorage.getItem('mc_streak') || '{}'); } catch (e) { return {}; }
    }
    function recordStreak() {
        const s = loadStreak();
        const today = _todayKey();
        if (s.last === today) return s.count || 1;
        const y = new Date(); y.setDate(y.getDate() - 1);
        const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
        const count = s.last === yKey ? (s.count || 0) + 1 : 1;
        try { localStorage.setItem('mc_streak', JSON.stringify({ last: today, count })); } catch (e) {}
        return count;
    }
    function pluralizeDays(n) {
        const a = Math.abs(n) % 100, d = a % 10;
        if (a > 10 && a < 20) return t('microcards.days_many', 'дней');
        if (d > 1 && d < 5) return t('microcards.days_few', 'дня');
        if (d === 1) return t('microcards.days_one', 'день');
        return t('microcards.days_many', 'дней');
    }
    function renderStreak() {
        const s = loadStreak();
        const chip = $('mcStreakChip');
        if (!chip) return;
        if (s.count && s.last) {
            $('mcStreakText').textContent = t('microcards.streak_label', 'Серия: {n} {unit}')
                .replace('{n}', s.count).replace('{unit}', pluralizeDays(s.count));
            chip.style.display = 'inline-flex';
        } else {
            chip.style.display = 'none';
        }
    }

    // ── Navigation & View Switching ────────────────────────────────────────
    function switchView(viewName) {
        state.view = viewName;
        
        // Hide all views
        document.querySelectorAll('.page-view').forEach(el => {
            el.classList.add('hidden');
            el.classList.remove('active-view');
        });

        // Show targets
        let targetId = 'viewLibrary';
        if (viewName === 'details') targetId = 'viewDeckDetails';
        else if (viewName === 'session') targetId = 'viewSession';
        else if (viewName === 'summary') targetId = 'viewSummary';
        else if (viewName === 'editor') targetId = 'viewEditor';

        const targetEl = $(targetId);
        if (targetEl) {
            targetEl.classList.remove('hidden');
            // Allow browser to register layout before animating
            setTimeout(() => targetEl.classList.add('active-view'), 50);
        }

        // The contextual toolbar (back + deck name + progress) is useless on the
        // library screen — the page heading already says everything. Hide it there;
        // show it on every other view where the back button / progress matter.
        const toolbar = $('mcToolbar');
        const backBtn = $('mcHeaderBackBtn');
        if (viewName === 'library') {
            if (toolbar) toolbar.style.display = 'none';
        } else {
            if (toolbar) toolbar.style.display = 'flex';
            backBtn.style.visibility = 'visible';
        }

        // Show/hide progress tracker in header
        const headerProgress = $('mcHeaderProgress');
        if (viewName === 'session') {
            headerProgress.style.display = 'inline-flex';
            updateHeaderProgress();
        } else {
            headerProgress.style.display = 'none';
        }

        // Dropdowns clean up
        $('deckActionsDropdown').classList.add('hidden');
    }

    function handleBackNavigation() {
        if (state.view === 'details') {
            loadLibraryData();
        } else if (state.view === 'session') {
            abortSession();
        } else if (state.view === 'summary') {
            switchView('details');
        } else if (state.view === 'editor') {
            switchView('details');
        }
    }

    // ── API Service Calls ─────────────────────────────────────────────────
    async function apiCall(url, options = {}) {
        try {
            const resp = await fetch(url, options);
            const data = await resp.json();
            if (!data.ok) {
                throw new Error(data.error || 'API Error');
            }
            return data;
        } catch (err) {
            showToast(err.message, 'error');
            throw err;
        }
    }

    // ── Library Screen ────────────────────────────────────────────────────
    async function loadLibraryData() {
        switchView('library');
        const grid = $('decksGrid');
        grid.innerHTML = `<div class="col-span-full py-8 text-center text-xs text-text-secondary">${t('microcards.loading_decks', 'Загрузка колод...')}</div>`;
        
        try {
            const data = await apiCall('/api/v2/microcards/decks');
            state.decks = data.items || [];
            state._entrance = true; // stagger deck cards in on fresh load only
            renderLibrary();
            animateLibraryStats();
            loadAnalytics();
        } catch (err) {
            grid.innerHTML = `<div class="col-span-full py-8 text-center text-xs text-error">${t('microcards.load_library_error', 'Не удалось загрузить библиотеку.')}</div>`;
        } finally {
            // Dismiss the PageBoot splash as soon as the first screen is ready.
            // Without this the splash lingers for the full 12s timeout.
            if (window.PageBoot && typeof window.PageBoot.ready === 'function') {
                window.PageBoot.ready();
            }
        }
    }

    const SORT_KEYS = ['name-asc', 'name-desc', 'date-desc', 'due-desc', 'cards-desc'];

    function sortDecks(list, key) {
        const arr = list.slice();
        const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
        const ts = (d) => d.updated_at || d.created_at || '';
        switch (key) {
            case 'name-desc': return arr.sort((a, b) => collator.compare(b.name || '', a.name || ''));
            case 'date-desc': return arr.sort((a, b) => String(ts(b)).localeCompare(String(ts(a))));
            case 'due-desc':  return arr.sort((a, b) => (b.due_count || 0) - (a.due_count || 0) || collator.compare(a.name || '', b.name || ''));
            case 'cards-desc': return arr.sort((a, b) => (b.card_count || 0) - (a.card_count || 0) || collator.compare(a.name || '', b.name || ''));
            default:          return arr.sort((a, b) => collator.compare(a.name || '', b.name || '')); // name-asc
        }
    }

    function setSort(key) {
        state.sortKey = SORT_KEYS.includes(key) ? key : 'name-asc';
        document.querySelectorAll('#mcSort .mc-sort-btn[data-sort]').forEach(btn => {
            const active = btn.getAttribute('data-sort') === state.sortKey;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        renderLibrary();
    }

    // Animate the three library stat counters once (on data load, not on search).
    function animateLibraryStats() {
        let totalDue = 0, totalNew = 0;
        state.decks.forEach(d => { totalDue += d.due_count || 0; totalNew += d.new_count || 0; });
        popNumber($('libStatDue'), totalDue);
        popNumber($('libStatNew'), totalNew);
        popNumber($('libStatTotal'), state.decks.length);
    }

    // Author byline: original author for imported decks, "Вы" for your own.
    function deckAuthorHtml(deck) {
        const name = (deck && deck.author_name) ? deck.author_name : t('microcards.author_you', 'Вы');
        return `<span class="mc-author"><span class="material-symbols-outlined">person</span>${escHtml(name)}</span>`;
    }

    function renderLibrary() {
        const grid = $('decksGrid');
        const empty = $('decksEmpty');
        grid.innerHTML = '';

        const searchQuery = $('libSearch').value.toLowerCase().trim();
        const filtered = sortDecks(
            state.decks.filter(d => {
                const matchesSearch = !searchQuery
                    || (d.name || '').toLowerCase().includes(searchQuery)
                    || (d.description || '').toLowerCase().includes(searchQuery)
                    || (d.tags || []).some(tag => (tag || '').toLowerCase().includes(searchQuery));
                const matchesTag = !state.activeTag || (d.tags || []).includes(state.activeTag);
                return matchesSearch && matchesTag;
            }),
            state.sortKey
        );

        renderTagFilters();

        // Update stats
        let totalDue = 0;
        let totalNew = 0;
        state.decks.forEach(d => {
            totalDue += d.due_count || 0;
            totalNew += d.new_count || 0;
        });
        $('libStatDue').textContent = totalDue;
        $('libStatNew').textContent = totalNew;
        $('libStatTotal').textContent = state.decks.length;

        if (filtered.length === 0) {
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        const entrance = !!state._entrance;
        filtered.forEach((deck, idx) => {
            const card = document.createElement('div');
            card.className = entrance ? 'mc-deck-card mc-enter' : 'mc-deck-card';
            if (entrance) card.style.animationDelay = Math.min(idx, 8) * 45 + 'ms';
            card.onclick = () => openDeckDetails(deck.id);

            const tagsHtml = (deck.tags || []).slice(0, 4).map(tag => `<span class="mc-tag">${escHtml(tag)}</span>`).join('');

            // Mastery: share of cards at level 2
            const total = deck.card_count || 0;
            const mastered = deck.level2_count || 0;
            const masteryPct = total > 0 ? Math.round((mastered / total) * 100) : 0;

            const duePill = deck.due_count > 0
                ? `<span class="mc-pill mc-pill--due">${t('microcards.badge_due', '{n} к повтору').replace('{n}', deck.due_count)}</span>` : '';
            const newPill = deck.new_count > 0
                ? `<span class="mc-pill mc-pill--new">${t('microcards.badge_new_cards', '{n} новых').replace('{n}', deck.new_count)}</span>` : '';
            const linkedPill = deck.linked
                ? `<span class="mc-pill mc-pill--linked"><span class="material-symbols-outlined" style="font-size:0.9rem">link</span>${t('microcards.badge_linked', 'Из каталога')}</span>` : '';

            card.innerHTML = `
                <div class="mc-deck-card__top">
                    <span class="mc-deck-card__medallion"><span class="material-symbols-outlined">style</span></span>
                    <h3 class="mc-deck-card__title">${escHtml(deck.name)}</h3>
                </div>
                <p class="mc-deck-card__desc">${escHtml(deck.description || t('microcards.no_description', 'Описание отсутствует.'))}</p>
                ${tagsHtml ? `<div class="mc-deck-card__tags">${tagsHtml}</div>` : ''}
                <div class="mc-deck-card__progress"><span style="width:${masteryPct}%"></span></div>
                <div class="mc-deck-card__foot">
                    <span class="mc-deck-card__count">${t('microcards.cards_count_label', 'Карточек:')} <strong>${total}</strong></span>
                    ${deckAuthorHtml(deck)}
                </div>
                <div style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-top:0.5rem">${linkedPill}${duePill}${newPill}</div>
            `;
            grid.appendChild(card);
        });
        state._entrance = false; // entrance is a one-shot per fresh load
    }

    // ── Tag filters ────────────────────────────────────────────────────────
    function renderTagFilters() {
        const container = $('libTagFilters');
        if (!container) return;
        const tags = [...new Set(state.decks.flatMap(d => d.tags || []))].sort();
        if (tags.length === 0) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }
        container.classList.remove('hidden');
        const chip = (label, value, active) =>
            `<button type="button" class="mc-tag-chip ${active ? 'is-active' : ''}" data-tag="${value === null ? '' : escHtml(value)}">${escHtml(label)}</button>`;
        container.innerHTML =
            chip(t('microcards.tag_all', 'Все'), null, !state.activeTag) +
            tags.map(tag => chip(tag, tag, state.activeTag === tag)).join('');
    }
    function selectTagFilter(tag) {
        state.activeTag = (state.activeTag === tag) ? null : (tag || null);
        renderLibrary();
    }

    // ── Analytics widgets (streak / retention / overdue / heatmap / forecast) ──
    async function loadAnalytics() {
        try {
            const data = await apiCall('/api/v2/microcards/analytics');
            renderAnalytics(data);
        } catch (err) {
            if ($('mcActivity')) $('mcActivity').classList.add('hidden');
            if ($('mcKpis')) $('mcKpis').style.display = 'none';
        }
    }
    function renderAnalytics(data) {
        data = data || {};
        $('anStreak').textContent = data.streak || 0;
        $('anRetention').textContent = data.retention || 0;
        $('anOverdue').textContent = data.overdue || 0;
        const hasActivity = (data.total_reviews || 0) > 0 || (data.streak || 0) > 0 || (data.overdue || 0) > 0;
        $('mcKpis').style.display = hasActivity ? 'flex' : 'none';

        const heatmap = data.heatmap || [];
        const forecast = data.forecast || [];
        const hasHeat = heatmap.some(c => (c.count || 0) > 0);
        const hasFore = forecast.some(c => (c.count || 0) > 0);
        $('mcHeatmapCard').classList.toggle('hidden', !hasHeat);
        $('mcForecastCard').classList.toggle('hidden', !hasFore);
        $('mcActivity').classList.toggle('hidden', !hasHeat && !hasFore);
        if (hasHeat) renderHeatmap(heatmap);
        if (hasFore) renderForecast(forecast);
    }
    function heatColor(count) {
        if (count <= 0) return 'color-mix(in srgb, var(--color-text-main) 8%, transparent)';
        const pct = count < 3 ? 35 : count < 6 ? 65 : 100;
        return `color-mix(in srgb, var(--color-primary) ${pct}%, transparent)`;
    }
    function renderHeatmap(cells) {
        $('anHeatmap').innerHTML = cells.map(c =>
            `<div style="background:${heatColor(c.count)}" title="${escHtml(c.date)}: ${c.count}"></div>`).join('');
    }
    function renderForecast(days) {
        const max = Math.max(1, ...days.map(d => d.count || 0));
        $('anForecast').innerHTML = days.map(d => {
            const h = Math.max(3, Math.round(((d.count || 0) / max) * 52));
            const bg = d.count ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-text-main) 8%, transparent)';
            let label = d.date;
            try { label = new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }); } catch (e) {}
            return `<div class="mc-forecast__day" title="${escHtml(d.date)}: ${d.count}">
                <div class="mc-forecast__bar" style="height:${h}px;background:${bg}"></div>
                <span class="mc-forecast__label">${escHtml(label)}</span>
            </div>`;
        }).join('');
    }

    // ── Study settings (session size, new/session, direction) ──────────────
    function selectDirection(value) {
        $('setDirection').value = value;
        document.querySelectorAll('#settingsDirection [data-dir]').forEach(btn =>
            btn.classList.toggle('is-active', btn.getAttribute('data-dir') === value));
    }
    async function openSettingsDialog() {
        try {
            const data = await apiCall('/api/v2/microcards/settings');
            const s = data.settings || {};
            $('setSessionSize').value = s.session_size ?? 20;
            $('setNewPerSession').value = s.new_per_session ?? 20;
            $('setNewAuto').checked = s.new_per_session_mode === 'auto';
            applyNewAutoUI();
            selectDirection(s.default_direction || 'front_back');
            $('dialogSettings').showModal();
        } catch (err) {
            showToast(t('microcards.settings_load_fail', 'Не удалось загрузить настройки'), 'error');
        }
    }

    // Reflect the "auto new cards" toggle: the manual number becomes the ceiling.
    function applyNewAutoUI() {
        const auto = $('setNewAuto').checked;
        const hint = $('setNewAutoHint');
        if (hint) hint.hidden = !auto;
        const label = document.querySelector('label[for="setNewPerSession"]');
        if (label) label.textContent = auto
            ? t('microcards.set_new_per_session_max', 'Новых за сессию (макс.)')
            : t('microcards.set_new_per_session', 'Новых карточек за сессию');
    }
    function onNewAutoToggle() { applyNewAutoUI(); }
    async function saveSettings(e) {
        if (e) e.preventDefault();
        const payload = {
            session_size: parseInt($('setSessionSize').value, 10),
            new_per_session: parseInt($('setNewPerSession').value, 10),
            new_per_session_mode: $('setNewAuto').checked ? 'auto' : 'manual',
            default_direction: $('setDirection').value
        };
        try {
            await apiCall('/api/v2/microcards/settings', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            $('dialogSettings').close();
            showToast(t('microcards.settings_saved', 'Настройки сохранены'), 'success');
        } catch (err) { console.error(err); }
    }
    function bindLibraryDelegates() {
        const tf = $('libTagFilters');
        if (tf) tf.addEventListener('click', (e) => {
            const b = e.target.closest('.mc-tag-chip[data-tag]');
            if (b) selectTagFilter(b.getAttribute('data-tag') || null);
        });
        const dir = $('settingsDirection');
        if (dir) dir.addEventListener('click', (e) => {
            const b = e.target.closest('[data-dir]');
            if (b) selectDirection(b.getAttribute('data-dir'));
        });
    }

    function openCreateDeckDialog() {
        $('createDeckName').value = '';
        $('createDeckDesc').value = '';
        $('dialogCreateDeck').showModal();
    }

    async function handleCreateDeckSubmit(e) {
        e.preventDefault();
        const name = $('createDeckName').value.trim();
        const description = $('createDeckDesc').value.trim();
        if (!name) return;

        try {
            const result = await apiCall('/api/v2/microcards/decks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
            $('dialogCreateDeck').close();
            showToast(t('microcards.toast_deck_created', 'Колода успешно создана!'), 'success');
            openDeckDetails(result.deck.id);
        } catch (err) {
            console.error(err);
        }
    }

    // ── Deck Details Screen ───────────────────────────────────────────────
    async function openDeckDetails(deckId) {
        state.activeDeckId = deckId;
        switchView('details');
        
        try {
            const data = await apiCall(`/api/v2/microcards/decks/${deckId}`);
            state.activeDeck = data.deck;
            
            // Set details fields
            $('deckDetailsTitle').textContent = state.activeDeck.name;
            $('deckDetailsDesc').textContent = state.activeDeck.description || t('microcards.no_description', 'Описание отсутствует.');
            $('mcHeaderSubtitle').textContent = state.activeDeck.name;
            
            // Render tags
            const tagsZone = $('deckDetailsTags');
            tagsZone.innerHTML = '';
            (state.activeDeck.tags || []).forEach(t => {
                const badge = document.createElement('span');
                badge.className = 'mc-tag';
                badge.textContent = t;
                tagsZone.appendChild(badge);
            });

            // Author byline + publication status
            const authorEl = $('deckDetailsAuthor');
            if (authorEl) authorEl.innerHTML = `<span class="mc-deckhero__author-lbl">${t('microcards.author_label', 'Автор')}:</span> ${deckAuthorHtml(state.activeDeck)}`;
            renderPublishStatus();

            // Linked (catalog-referenced) deck = read-only: hide edit/import/publish,
            // turn "delete" into "remove from library", show a read-only badge.
            const linked = !!state.activeDeck.linked;
            ['btnDeckEditor', 'btnDeckImport', 'btnDeckPublish', 'btnAddCardInline'].forEach(id => {
                const el = $(id); if (el) el.classList.toggle('hidden', linked);
            });
            const delLabel = $('btnDeckDeleteLabel');
            if (delLabel) delLabel.textContent = linked
                ? t('microcards.btn_remove_from_library', 'Убрать из библиотеки')
                : t('microcards.btn_menu_delete_deck', 'Удалить колоду');
            const pub = $('deckPublishStatus');
            if (linked && pub) pub.innerHTML = `<span class="mc-pub-pill mc-pub--code"><span class="material-symbols-outlined">link</span>${t('microcards.linked_readonly', 'Из каталога · только чтение')}</span>`;

            // Load cards
            const cardsData = await apiCall(`/api/v2/microcards/decks/${deckId}/cards`);
            state.cards = cardsData.items || [];
            
            updateDeckProgressUI();
            renderDeckCardsList();
        } catch (err) {
            console.error(err);
        }
    }

    // Update the progress panel (levels, bars, counters) from state.cards.
    function updateDeckProgressUI() {
        let l1 = 0, l2 = 0;
        state.cards.forEach(c => {
            const lvl = c.level || 1;
            if (lvl === 1) l1++;
            else if (lvl === 2) l2++;
        });
        $('progressL1Count').textContent = l1;
        $('progressL2Count').textContent = l2;
        $('deckTotalCardsCount').textContent = state.cards.length;
        $('deckCardsCountBadge').textContent = state.cards.length;
        const total = state.cards.length || 1;
        $('progressL1Bar').style.width = `${(l1 / total) * 100}%`;
        $('progressL2Bar').style.width = `${(l2 / total) * 100}%`;

        // Real study load (FSRS): cards due for review + brand-new cards.
        const loadEl = $('deckLoadLine');
        if (loadEl) {
            let due = 0, nw = 0;
            const now = Date.now();
            state.cards.forEach(c => {
                if (c.is_new) nw++;
                else if (c.due_at && new Date(c.due_at).getTime() <= now) due++;
            });
            if (!state.cards.length) {
                loadEl.textContent = '';
            } else if (due === 0 && nw === 0) {
                loadEl.textContent = t('microcards.load_all_done', 'На сегодня всё повторено 🎉');
            } else {
                loadEl.textContent = [
                    t('microcards.badge_due', '{n} к повтору').replace('{n}', due),
                    t('microcards.badge_new_cards', '{n} новых').replace('{n}', nw)
                ].join(' · ');
            }
        }
    }

    // Read-only row for linked (catalog-referenced) decks — display only, no editing.
    function cardDisplayRowHTML(card) {
        const hintHtml = card.hint ? `<p class="mc-cardrow__hint">${t('microcards.hint_label', 'Подсказка')}: ${escHtml(card.hint)}</p>` : '';
        return `<div class="mc-cardrow">
            <div style="min-width:0;flex:1">
                <p class="mc-cardrow__front">${escHtml(card.front.text)}</p>
                <p class="mc-cardrow__back">${escHtml(card.back.text)}</p>
                ${hintHtml}
            </div>
            <div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0">
                <span class="mc-level-chip">${t('microcards.level_badge', 'Уровень {n}').replace('{n}', card.level || 1)}</span>
            </div>
        </div>`;
    }

    function renderDeckCardsList() {
        const container = $('deckCardsListContainer');
        const readOnly = !!(state.activeDeck && (state.activeDeck.read_only || state.activeDeck.linked));

        if (state.cards.length === 0) {
            const msg = readOnly
                ? t('microcards.no_cards_yet', 'В колоде пока нет карточек.')
                : t('microcards.no_cards_yet_editable', 'В колоде пока нет карточек. Нажмите «Добавить карточку».');
            container.innerHTML = `<div style="padding:2rem;text-align:center;font-size:0.8rem;color:var(--color-text-secondary);border:1px dashed var(--color-border-strong);border-radius:var(--mc-radius-sm)">${msg}</div>`;
            return;
        }

        container.innerHTML = readOnly
            ? state.cards.map(c => cardDisplayRowHTML(c)).join('')
            : state.cards.map(c => cardItemHTML(c)).join('');
    }

    // ── Editable cards accordion (inline editing on the deck page) ─────────
    const CARD_STATUS = {
        new:      { label: 'Новая',     varName: '--color-border-strong' },
        learning: { label: 'Изучается', varName: '--color-warning' },
        mastered: { label: 'Освоено',   varName: '--color-success' }
    };

    function cardStatusPill(card) {
        const bucket = (!card || !card.id) ? 'new'
            : (card.progress || (card.is_new ? 'new' : ((card.level || 0) >= 2 ? 'mastered' : 'learning')));
        const s = CARD_STATUS[bucket] || CARD_STATUS.new;
        return `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap"
            style="color:var(${s.varName});background:color-mix(in srgb, var(${s.varName}) 14%, transparent)">${s.label}</span>`;
    }

    const mcInputCls = 'w-full px-3 py-2 rounded-lg border border-border-strong bg-surface-2 text-sm text-text-main outline-none focus:border-primary transition-colors';

    // Build one accordion item. `card` may be a real card or a blank {id:null} for a new one.
    function cardItemHTML(card, opts = {}) {
        const isNew = !card.id;
        const front = card.front ? card.front.text : '';
        const back = card.back ? card.back.text : '';
        const hint = card.hint || '';
        const acc = (card.acceptable_answers || []).join('\n');
        const frontImg = card.front && card.front.image_url ? card.front.image_url : '';
        const backImg = card.back && card.back.image_url ? card.back.image_url : '';
        const openCls = opts.open ? ' open' : '';

        return `
        <div class="mc-card-item rounded-xl border border-border-subtle bg-surface-1${openCls}" data-card-id="${card.id || ''}">
            <div class="mc-card-head flex items-center gap-3 p-3 cursor-pointer select-none" onclick="mcApp.toggleCardExpand(this)">
                ${cardStatusPill(card)}
                <div class="flex-1 min-w-0">
                    <p class="mc-head-front text-sm font-bold text-text-main truncate">${escHtml(front) || '<span class="text-text-secondary font-normal">Новая карточка…</span>'}</p>
                    <p class="mc-head-back text-xs text-text-secondary truncate">${escHtml(back)}</p>
                </div>
                <span class="material-symbols-outlined mc-card-chevron text-text-secondary text-[20px]">expand_more</span>
            </div>
            <div class="mc-card-body">
              <div class="px-3 pb-3 pt-0 space-y-3">
                <div class="mc-form-row two">
                    <div>
                        <label class="block text-[10px] font-bold text-text-secondary uppercase mb-1">Вопрос</label>
                        <textarea data-field="front" rows="3" class="${mcInputCls} resize-y" placeholder="Лицевая сторона">${escHtml(front)}</textarea>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-text-secondary uppercase mb-1">Ответ</label>
                        <textarea data-field="back" rows="3" class="${mcInputCls} resize-y" placeholder="Обратная сторона">${escHtml(back)}</textarea>
                    </div>
                </div>

                <button type="button" onclick="mcApp.toggleCardAdvanced(this)" class="flex items-center gap-1 text-[11px] font-bold text-text-secondary hover:text-text-main transition-colors">
                    <span class="material-symbols-outlined text-[16px] mc-adv-chevron">expand_more</span>
                    Доп. настройки
                </button>
                <div class="mc-card-adv hidden space-y-3">
                    <div>
                        <label class="block text-[10px] font-bold text-text-secondary uppercase mb-1">Подсказка</label>
                        <input data-field="hint" type="text" class="${mcInputCls}" placeholder="Опционально" value="${escHtml(hint)}" />
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-text-secondary uppercase mb-1">Доп. допустимые ответы (по одному на строку)</label>
                        <textarea data-field="acceptable" rows="2" class="${mcInputCls} resize-y" placeholder="Синонимы, засчитываемые как верные">${escHtml(acc)}</textarea>
                    </div>
                    <div class="mc-form-row two">
                        <div>
                            <label class="block text-[10px] font-bold text-text-secondary uppercase mb-1">Картинка к вопросу (URL)</label>
                            <input data-field="frontImage" type="url" class="${mcInputCls}" placeholder="https://…" value="${escHtml(frontImg)}" />
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-text-secondary uppercase mb-1">Картинка к ответу (URL)</label>
                            <input data-field="backImage" type="url" class="${mcInputCls}" placeholder="https://…" value="${escHtml(backImg)}" />
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-between pt-1">
                    <button type="button" onclick="mcApp.deleteCardInline(this)" class="px-3 py-1.5 rounded-lg border border-error/40 text-error font-bold text-xs hover:bg-bg-hover transition-colors flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[16px]">delete</span>${isNew ? 'Отмена' : 'Удалить'}
                    </button>
                    <button type="button" onclick="mcApp.saveCardInline(this)" class="px-4 py-1.5 rounded-lg bg-primary text-primary-fg hover:bg-primary-hover font-bold text-xs transition-colors flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[16px]">check</span>Сохранить
                    </button>
                </div>
              </div>
            </div>
        </div>`;
    }

    function toggleCardExpand(headEl) {
        headEl.closest('.mc-card-item').classList.toggle('open');
    }

    function toggleCardAdvanced(btn) {
        const panel = btn.parentElement.querySelector('.mc-card-adv');
        const hidden = panel.classList.toggle('hidden');
        const chev = btn.querySelector('.mc-adv-chevron');
        if (chev) chev.style.transform = hidden ? '' : 'rotate(180deg)';
    }

    function addNewCardInline() {
        if (state.activeDeck && (state.activeDeck.read_only || state.activeDeck.linked)) return;
        const container = $('deckCardsListContainer');
        if (!state.cards.length) container.innerHTML = '';
        container.insertAdjacentHTML('afterbegin', cardItemHTML({ id: null }, { open: true }));
        const first = container.querySelector('.mc-card-item');
        if (first) first.querySelector('textarea[data-field="front"]').focus();
    }

    function readCardItem(item) {
        const get = (f) => {
            const el = item.querySelector(`[data-field="${f}"]`);
            return el ? el.value.trim() : '';
        };
        return {
            front_text: get('front'),
            back_text: get('back'),
            hint: get('hint') || null,
            acceptable_answers: get('acceptable').split('\n').map(s => s.trim()).filter(Boolean),
            front_image_url: get('frontImage') || null,
            back_image_url: get('backImage') || null
        };
    }

    async function saveCardInline(btn) {
        const item = btn.closest('.mc-card-item');
        const cardId = item.getAttribute('data-card-id');
        const payload = readCardItem(item);
        if (!payload.front_text || !payload.back_text) {
            showToast(t('microcards.error_front_back_required', 'Заполните вопрос и ответ'), 'error');
            return;
        }
        try {
            const base = `/api/v2/microcards/decks/${state.activeDeckId}/cards`;
            const url = cardId ? `${base}/${cardId}` : base;
            await apiCall(url, {
                method: cardId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            showToast(cardId ? t('microcards.toast_card_saved', 'Карточка сохранена') : t('microcards.toast_card_added', 'Карточка добавлена'), 'success');
            await reloadDeckCards();
        } catch (err) {
            console.error(err);
        }
    }

    async function deleteCardInline(btn) {
        const item = btn.closest('.mc-card-item');
        const cardId = item.getAttribute('data-card-id');
        if (!cardId) { // unsaved new card → just drop the row
            item.remove();
            if (!$('deckCardsListContainer').children.length) renderDeckCardsList();
            return;
        }
        if (!confirm(t('microcards.confirm_delete_card', 'Удалить эту карточку?'))) return;
        try {
            await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards/${cardId}`, { method: 'DELETE' });
            showToast(t('microcards.toast_card_deleted', 'Карточка удалена'), 'success');
            await reloadDeckCards();
        } catch (err) {
            console.error(err);
        }
    }

    // Reload just the cards + progress without leaving the deck view.
    async function reloadDeckCards() {
        const data = await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards`);
        state.cards = data.items || [];
        updateDeckProgressUI();
        renderDeckCardsList();
    }

    // ── Deck parameters dialog (replaces the old separate editor page) ─────
    function openDeckMetaDialog() {
        if (!state.activeDeck) return;
        $('metaDeckName').value = state.activeDeck.name || '';
        $('metaDeckDesc').value = state.activeDeck.description || '';
        $('metaDeckTags').value = (state.activeDeck.tags || []).join(', ');
        $('dialogDeckMeta').showModal();
    }

    async function saveDeckMetaDialog(e) {
        if (e) e.preventDefault();
        const name = $('metaDeckName').value.trim();
        const description = $('metaDeckDesc').value.trim();
        const tags = $('metaDeckTags').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (!name) {
            showToast(t('microcards.error_name_required', 'Название колоды обязательно'), 'error');
            return;
        }
        try {
            await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, tags })
            });
            $('dialogDeckMeta').close();
            showToast(t('microcards.toast_deck_saved', 'Параметры колоды сохранены'), 'success');
            openDeckDetails(state.activeDeckId);
        } catch (err) {
            console.error(err);
        }
    }

    function toggleDeckActionsMenu(e) {
        e.stopPropagation();
        const menu = $('deckActionsDropdown');
        menu.classList.toggle('hidden');
    }

    // Close actions dropdown on outer click
    document.addEventListener('click', () => {
        $('deckActionsDropdown').classList.add('hidden');
    });

    async function exportDeck(format) {
        const url = `/api/v2/microcards/decks/${state.activeDeckId}/export/${format}`;
        window.open(url, '_blank');
        showToast(t('microcards.toast_export_started', 'Экспорт запущен!'), 'success');
    }

    function confirmDeleteDeck() {
        $('deleteConfirmText').textContent = `Вы действительно хотите удалить колоду "${state.activeDeck.name}"? Это действие сотрет все карточки и ваш прогресс по ним.`;
        const btn = $('btnDeleteConfirmAction');
        btn.onclick = async () => {
            try {
                await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}`, { method: 'DELETE' });
                $('dialogConfirmDelete').close();
                showToast(t('microcards.toast_deck_deleted', 'Колода успешно удалена'), 'success');
                loadLibraryData();
            } catch (err) {
                console.error(err);
            }
        };
        $('dialogConfirmDelete').showModal();
    }

    // ── Learning Session Screen ───────────────────────────────────────────
    async function startLearningSession(errorsOnly = false) {
        state.isErrorsOnlyMode = errorsOnly;
        // Reset gamification for the new run
        state.combo = 0;
        state.maxCombo = 0;
        state.sessionXp = 0;
        const comboChip = $('comboChip');
        if (comboChip) comboChip.style.display = 'none';
        popNumber($('xpChipVal'), 0);
        switchView('session');

        try {
            if (errorsOnly) {
                // Initialize queue with failed cards from current session stats
                state.sessionCards = state.sessionErrors.map(id => state.cards.find(c => c.id === id)).filter(Boolean);
                state.sessionStats = { total: state.sessionCards.length, correct: 0, errors: 0 };
                state.sessionErrors = [];
                state.sessionIndex = 0;
                setupCurrentCard();
            } else {
                const data = await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/session/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resume: true, restart: true })
                });
                state.session = data.session;
                
                // Map queue IDs to full card payloads
                state.sessionCards = (state.session.card_queue || []).map(id => state.cards.find(c => c.id === id)).filter(Boolean);
                state.sessionStats = { total: state.sessionCards.length, correct: 0, errors: 0 };
                state.sessionErrors = [];
                state.sessionIndex = 0;
                
                setupCurrentCard();
            }
        } catch (err) {
            switchView('details');
        }
    }

    function setupCurrentCard() {
        if (state.sessionIndex >= state.sessionCards.length) {
            finishSession();
            return;
        }

        const card = state.sessionCards[state.sessionIndex];

        // Reset card face state
        $('flashcardInner').classList.remove('flipped');
        hideRails(); // rails reappear only after the answer is revealed
        
        // Effective direction (reverse mode): which side is the question vs answer
        const dir = (state.session && ((state.session.card_directions || {})[card.id] || state.session.direction)) || 'front_back';
        const qSide = dir === 'back_front' ? card.back : card.front;
        const aSide = dir === 'back_front' ? card.front : card.back;

        // Load text and images (question on front face, answer on back face)
        $('cardFrontText').textContent = qSide.text;
        $('cardBackText').textContent = aSide.text;

        if (card.hint) {
            $('btnShowHint').classList.remove('hidden');
            $('cardHintText').classList.add('hidden');
            $('cardHintText').textContent = card.hint;
        } else {
            $('btnShowHint').classList.add('hidden');
            $('cardHintText').classList.add('hidden');
        }

        const frontImg = $('cardFrontImage');
        if (qSide.image_url) { frontImg.src = qSide.image_url; frontImg.classList.remove('hidden'); }
        else { frontImg.classList.add('hidden'); }

        const backImg = $('cardBackImage');
        if (aSide.image_url) { backImg.src = aSide.image_url; backImg.classList.remove('hidden'); }
        else { backImg.classList.add('hidden'); }

        // Set Level Indicator
        const level = card.level || 1;
        const levelInd = $('sessionLevelIndicator');
        levelInd.textContent = level === 1 ? t('microcards.level1_indicator', 'Уровень 1: Знаю / Не знаю') : t('microcards.level2_indicator', 'Уровень 2: Открытый ответ');
        levelInd.className = 'mc-level-indicator';
        const accent = level === 1 ? 'var(--color-warning)' : 'var(--color-success)';
        levelInd.style.background = `color-mix(in srgb, ${accent} 12%, transparent)`;
        levelInd.style.borderColor = `color-mix(in srgb, ${accent} 30%, transparent)`;
        levelInd.style.color = accent;

        // Reset UI actions
        if (level === 1) {
            $('frontActionsL1').classList.remove('hidden');
            $('frontActionsL2').classList.add('hidden');
            $('backActionsL1').classList.remove('hidden');
            $('backActionsL2').classList.add('hidden');
        } else {
            $('frontActionsL1').classList.add('hidden');
            $('frontActionsL2').classList.remove('hidden');
            $('backActionsL1').classList.add('hidden');
            $('backActionsL2').classList.remove('hidden');
            $('inputL2Answer').value = '';
            $('inputL2Answer').focus();
        }

        $('l2ComparisonZone').classList.add('hidden');
        $('btnL2Override').classList.add('hidden');

        updateHeaderProgress();
    }

    function toggleHint() {
        const hintText = $('cardHintText');
        hintText.classList.toggle('hidden');
    }

    function revealAnswerL1() {
        $('flashcardInner').classList.add('flipped');
        showRails(); // reveal the swipe-style grading rails (desktop)
    }

    async function submitAnswerL1(know) {
        const card = state.sessionCards[state.sessionIndex];
        const ratingValue = know ? 'know' : 'dont_know';

        hideRails(); // rails vanish + card un-leans as the answer is graded

        // Update stats locally
        if (know) {
            state.sessionStats.correct++;
        } else {
            state.sessionStats.errors++;
            if (!state.sessionErrors.includes(card.id)) {
                state.sessionErrors.push(card.id);
            }
        }

        // Immediate juicy feedback on the revealed card
        registerAnswer(know);

        try {
            // Sync with backend if not errors-only offline review
            if (state.session && !state.isErrorsOnlyMode) {
                await apiCall(`/api/v2/microcards/session/${state.session.id}/answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ card_id: card.id, user_answer: ratingValue })
                });
            }
        } catch (err) {
            console.error(err);
        }

        // Let the feedback animation play before advancing
        setTimeout(() => {
            state.sessionIndex++;
            setupCurrentCard();
        }, know ? 640 : 780);
    }

    async function submitAnswerL2(e) {
        if (e) e.preventDefault();
        const card = state.sessionCards[state.sessionIndex];
        const answer = $('inputL2Answer').value.trim();

        try {
            let isCorrect = false;
            let expected = card.back.text;
            let cardState = null;

            if (state.session && !state.isErrorsOnlyMode) {
                const result = await apiCall(`/api/v2/microcards/session/${state.session.id}/answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ card_id: card.id, user_answer: answer })
                });
                isCorrect = result.is_correct;
                expected = result.expected_answer;
                cardState = result.card_state;
            } else {
                // Offline fallback math
                isCorrect = answer.toLowerCase() === expected.toLowerCase();
            }

            // Flip card and show details
            $('flashcardInner').classList.add('flipped');
            $('l2ComparisonZone').classList.remove('hidden');
            $('l2UserAnswerDisplay').textContent = answer || t('microcards.empty_answer', '(пусто)');
            $('l2CorrectAnswerDisplay').textContent = expected;

            const badge = $('answerEvaluationBadge');
            badge.classList.remove('hidden');
            if (isCorrect) {
                badge.textContent = t('microcards.badge_correct', 'Верно');
                badge.className = 'mc-eval-badge';
                badge.style.cssText = 'background:color-mix(in srgb,var(--color-success) 15%,transparent);border-color:var(--color-success);color:var(--color-success)';
                state.sessionStats.correct++;
                $('btnL2Override').classList.add('hidden');
            } else {
                badge.textContent = t('microcards.badge_error', 'Ошибка');
                badge.className = 'mc-eval-badge';
                badge.style.cssText = 'background:color-mix(in srgb,var(--color-error) 15%,transparent);border-color:var(--color-error);color:var(--color-error)';
                state.sessionStats.errors++;
                if (!state.sessionErrors.includes(card.id)) {
                    state.sessionErrors.push(card.id);
                }
                $('btnL2Override').classList.remove('hidden');
            }

            // Update level locally
            if (cardState) {
                card.level = cardState.level;
            }

            // Combo / XP / feedback
            registerAnswer(isCorrect);

        } catch (err) {
            console.error(err);
        }
    }

    async function overrideL2Answer() {
        const card = state.sessionCards[state.sessionIndex];
        const answer = $('inputL2Answer').value.trim();

        try {
            if (state.session && !state.isErrorsOnlyMode) {
                await apiCall(`/api/v2/microcards/session/${state.session.id}/answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ card_id: card.id, user_answer: answer, override: true })
                });
            }

            // Update stats
            state.sessionStats.errors = Math.max(0, state.sessionStats.errors - 1);
            state.sessionStats.correct++;
            
            const idx = state.sessionErrors.indexOf(card.id);
            if (idx !== -1) {
                state.sessionErrors.splice(idx, 1);
            }

            // Update UI
            const badge = $('answerEvaluationBadge');
            badge.textContent = t('microcards.badge_overridden', 'Исправлено');
            badge.className = 'mc-eval-badge';
            badge.style.cssText = 'background:color-mix(in srgb,var(--color-warning) 15%,transparent);border-color:var(--color-warning);color:var(--color-warning)';
            $('btnL2Override').classList.add('hidden');

            // Reward the correction
            registerAnswer(true);

        } catch (err) {
            console.error(err);
        }
    }

    function nextCard() {
        state.sessionIndex++;
        setupCurrentCard();
    }

    function abortSession() {
        if (confirm(t('microcards.confirm_exit_session', 'Вы уверены, что хотите выйти из сессии? Прогресс текущих ответов не сохранится.'))) {
            switchView('details');
        }
    }

    // ── Session Summary Screen ────────────────────────────────────────────
    function finishSession() {
        switchView('summary');

        const total = state.sessionStats.total || 0;
        const correct = state.sessionStats.correct || 0;
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

        $('sumStatTotal').textContent = state.sessionStats.total;
        $('sumStatCorrect').textContent = state.sessionStats.correct;
        $('sumStatErrors').textContent = state.sessionStats.errors;

        // Gamified summary: accuracy ring, stars, XP, best combo, message
        gamifySummary(accuracy);

        // Daily streak (count this completed session)
        recordStreak();

        // Configure "Работа над ошибками" button
        const retryBtn = $('btnRetryErrors');
        if (state.sessionErrors.length > 0) {
            retryBtn.classList.remove('hidden');
        } else {
            retryBtn.classList.add('hidden');
        }

        // Render errors list
        const errorsList = $('summaryErrorsList');
        const errorsSection = $('summaryErrorsSection');
        errorsList.innerHTML = '';

        if (state.sessionErrors.length > 0) {
            errorsSection.classList.remove('hidden');
            state.sessionErrors.forEach(cardId => {
                const card = state.cards.find(c => c.id === cardId);
                if (card) {
                    const row = document.createElement('div');
                    row.className = 'mc-errrow';
                    row.innerHTML = `
                        <p class="mc-errrow__q">${escHtml(card.front.text)}</p>
                        <p class="mc-errrow__a">${escHtml(card.back.text)}</p>
                    `;
                    errorsList.appendChild(row);
                }
            });
        } else {
            errorsSection.classList.add('hidden');
        }

        // Run celebration effect for strong results
        const acc = total > 0 ? (correct / total) * 100 : 0;
        if ((state.sessionStats.errors === 0 || acc >= 90) && window.CelebrationEffects) {
            try {
                window.CelebrationEffects.launchConfetti();
            } catch (e) {
                console.warn(e);
            }
        }
    }

    function gamifySummary(accuracy) {
        // Accuracy ring (r=56 → circumference ≈ 352)
        const circ = 352;
        const ring = $('sumAccRing');
        if (ring) {
            const tone = accuracy >= 85 ? 'var(--color-success)' : accuracy >= 60 ? 'var(--color-warning)' : 'var(--color-error)';
            ring.style.setProperty('--ring-circ', circ);
            ring.style.stroke = tone;
            ring.style.strokeDashoffset = circ; // start empty
            void ring.getBoundingClientRect();
            requestAnimationFrame(() => { ring.style.strokeDashoffset = circ * (1 - accuracy / 100); });
        }
        if ($('sumAccVal')) $('sumAccVal').textContent = accuracy + '%';

        // Stars: 3 ≥85, 2 ≥60, 1 ≥1
        const starCount = accuracy >= 85 ? 3 : accuracy >= 60 ? 2 : accuracy >= 1 ? 1 : 0;
        const stars = $('sumStars');
        if (stars) {
            stars.querySelectorAll('.material-symbols-outlined').forEach((s, i) => s.classList.toggle('is-on', i < starCount));
            stars.classList.remove('is-revealed'); void stars.offsetWidth; stars.classList.add('is-revealed');
        }

        // XP + best combo
        popNumber($('sumXp'), state.sessionXp);
        if ($('sumCombo')) $('sumCombo').textContent = state.maxCombo;

        // Dynamic title / message
        let titleKey, titleFb, subKey, subFb;
        if (accuracy >= 100) { titleKey = 'microcards.res_title_perfect'; titleFb = 'Идеально!'; subKey = 'microcards.res_sub_perfect'; subFb = 'Безупречно — ни одной ошибки!'; }
        else if (accuracy >= 85) { titleKey = 'microcards.res_title_great'; titleFb = 'Великолепно!'; subKey = 'microcards.res_sub_great'; subFb = 'Отличный результат, так держать!'; }
        else if (accuracy >= 60) { titleKey = 'microcards.res_title_good'; titleFb = 'Хорошая работа!'; subKey = 'microcards.res_sub_good'; subFb = 'Уверенный результат — ещё немного до идеала.'; }
        else if (accuracy >= 30) { titleKey = 'microcards.res_title_ok'; titleFb = 'Неплохо!'; subKey = 'microcards.res_sub_ok'; subFb = 'Поработай над ошибками — и станет отлично.'; }
        else { titleKey = 'microcards.res_title_keep'; titleFb = 'Продолжай тренироваться'; subKey = 'microcards.res_sub_keep'; subFb = 'Повтори ошибки, чтобы закрепить материал.'; }
        if ($('sumTitle')) $('sumTitle').textContent = t(titleKey, titleFb);
        if ($('sumSubtitle')) $('sumSubtitle').textContent = t(subKey, subFb);
    }

    function retrySessionErrors() {
        startLearningSession(true);
    }

    function restartLearningSession() {
        startLearningSession(false);
    }

    function backToDecks() {
        loadLibraryData();
    }

    // ── Deck & Cards Editor ───────────────────────────────────────────────
    function openDeckEditor() {
        switchView('editor');
        
        // Load metadata
        $('editDeckName').value = state.activeDeck.name;
        $('editDeckDesc').value = state.activeDeck.description || '';
        $('editDeckTags').value = (state.activeDeck.tags || []).join(', ');

        renderEditorSidebarList();
        initNewCardForm();
    }

    function renderEditorSidebarList() {
        const container = $('editorSidebarList');
        container.innerHTML = '';

        // Add Deck Metadata Button
        const metaBtn = document.createElement('button');
        metaBtn.type = 'button';
        metaBtn.className = 'mc-side-item mc-side-item--meta';
        metaBtn.onclick = () => selectEditorTarget('deck');
        metaBtn.innerHTML = `<span class="material-symbols-outlined">settings</span><span>${t('microcards.editor_deck_params_title', 'Параметры колоды')}</span>`;
        container.appendChild(metaBtn);

        if (state.cards.length === 0) {
            const emptyLabel = document.createElement('div');
            emptyLabel.style.cssText = 'text-align:center;padding:1rem;font-size:0.7rem;color:var(--color-text-secondary)';
            emptyLabel.textContent = t('microcards.editor_no_cards', 'Нет карточек');
            container.appendChild(emptyLabel);
            return;
        }

        state.cards.forEach(card => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mc-side-item';
            btn.textContent = card.front.text || t('microcards.editor_card_untitled', '(без текста)');
            btn.onclick = () => selectEditorTarget('card', card.id);
            container.appendChild(btn);
        });
    }

    function selectEditorTarget(type, id = null) {
        if (type === 'deck') {
            $('editorDeckMetaForm').classList.remove('hidden');
            $('editorCardFormZone').classList.add('hidden');
        } else {
            $('editorDeckMetaForm').classList.add('hidden');
            $('editorCardFormZone').classList.remove('hidden');
            
            const card = state.cards.find(c => c.id === id);
            if (card) {
                state.activeCard = card;
                $('editorCardFormTitle').textContent = t('microcards.editor_edit_card_title', 'Редактировать карточку');
                $('editCardFront').value = card.front.text;
                $('editCardBack').value = card.back.text;
                $('editCardHint').value = card.hint || '';
                $('editCardAcceptable').value = (card.acceptable_answers || []).join('\n');
                $('editCardFrontImage').value = card.front.image_url || '';
                $('editCardBackImage').value = card.back.image_url || '';
                
                previewEditorImage('front');
                previewEditorImage('back');
                
                $('btnDeleteCard').classList.remove('hidden');
            }
        }
    }

    function initNewCardForm() {
        state.activeCard = null;
        $('editorDeckMetaForm').classList.add('hidden');
        $('editorCardFormZone').classList.remove('hidden');
        
        $('editorCardFormTitle').textContent = t('microcards.editor_new_card_title', 'Новая карточка');
        $('editCardFront').value = '';
        $('editCardBack').value = '';
        $('editCardHint').value = '';
        $('editCardAcceptable').value = '';
        $('editCardFrontImage').value = '';
        $('editCardBackImage').value = '';
        
        $('editCardFrontImagePreview').classList.add('hidden');
        $('editCardBackImagePreview').classList.add('hidden');
        $('btnDeleteCard').classList.add('hidden');
    }

    function previewEditorImage(face) {
        const inputId = face === 'front' ? 'editCardFrontImage' : 'editCardBackImage';
        const previewId = face === 'front' ? 'editCardFrontImagePreview' : 'editCardBackImagePreview';
        const url = $(inputId).value.trim();
        const img = $(previewId);
        
        if (url) {
            img.src = url;
            img.classList.remove('hidden');
        } else {
            img.classList.add('hidden');
        }
    }

    async function saveDeckMeta() {
        const name = $('editDeckName').value.trim();
        const description = $('editDeckDesc').value.trim();
        const tagsRaw = $('editDeckTags').value;
        const tags = tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        if (!name) {
            showToast(t('microcards.error_name_required', 'Название колоды обязательно'), 'error');
            return;
        }

        try {
            await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, tags })
            });
            showToast(t('microcards.toast_deck_saved', 'Параметры колоды сохранены'), 'success');
            openDeckDetails(state.activeDeckId);
        } catch (err) {
            console.error(err);
        }
    }

    async function saveActiveCard() {
        const frontText = $('editCardFront').value.trim();
        const backText = $('editCardBack').value.trim();
        const hint = $('editCardHint').value.trim();
        const acceptable = $('editCardAcceptable').value.split('\n').map(s => s.trim()).filter(Boolean);
        const frontImage = $('editCardFrontImage').value.trim();
        const backImage = $('editCardBackImage').value.trim();

        if (!frontText || !backText) {
            showToast(t('microcards.error_front_back_required', 'Заполните лицевую и обратную стороны'), 'error');
            return;
        }

        const payload = {
            front_text: frontText,
            back_text: backText,
            hint: hint || null,
            acceptable_answers: acceptable,
            front_image_url: frontImage || null,
            back_image_url: backImage || null
        };

        try {
            if (state.activeCard) {
                // Update existing card
                await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards/${state.activeCard.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                showToast(t('microcards.toast_card_saved', 'Карточка сохранена'), 'success');
            } else {
                // Create new card
                await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                showToast(t('microcards.toast_card_added', 'Карточка добавлена'), 'success');
            }
            openDeckDetails(state.activeDeckId).then(() => openDeckEditor());
        } catch (err) {
            console.error(err);
        }
    }

    async function deleteActiveCard() {
        if (!state.activeCard) return;
        if (confirm(t('microcards.confirm_delete_card', 'Вы действительно хотите удалить эту карточку?'))) {
            try {
                await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards/${state.activeCard.id}`, {
                    method: 'DELETE'
                });
                showToast(t('microcards.toast_card_deleted', 'Карточка удалена'), 'success');
                openDeckDetails(state.activeDeckId).then(() => openDeckEditor());
            } catch (err) {
                console.error(err);
            }
        }
    }

    function closeDeckEditor() {
        openDeckDetails(state.activeDeckId);
    }

    // ── Import Decks Dialog ───────────────────────────────────────────────
    const IMPORT_HINTS = {
        auto: ['microcards.imp_hint_auto', 'Вставьте что угодно — формат определится сам: Quizlet/Excel (таб), «вопрос — ответ», CSV, JSON или тест. Разделитель и иерархия распознаются автоматически.'],
        csv: ['microcards.imp_hint_csv', 'Колонки: front, back, hint. Строки в кавычках. Совместимо с Quizlet (term/definition).'],
        json: ['microcards.imp_hint_json', 'Схема actra_flashcards_v1: { "cards": [ { "front": "Q", "back": "A", "hint": "H" } ] }'],
        txt_full: ['microcards.imp_hint_txt_full', 'Блочный формат @MICROCARD с полями Q:/A: — несколько строк на карточку, поддержка изображений и подсказок.'],
        txt_simplified: ['microcards.imp_hint_txt_simple', 'По строке на карточку: «вопрос<разделитель>ответ». Разделитель выбирается ниже (или «Авто»).'],
        test: ['microcards.imp_hint_test', 'Тестовый формат: «? Вопрос», «+ правильный», «- неправильный». Неправильные варианты игнорируются.'],
    };

    function openImportDialog() {
        state.importFormat = 'auto';
        state.importSep = 'auto';
        $('impContent').value = '';
        $('importFile').value = '';
        if ($('impMultiline')) $('impMultiline').checked = true;
        setImportSep('auto');
        setMarkerPreset('standard');
        switchImportTab('auto');
        clearImportPreview();
        $('dialogImportDeck').showModal();
    }

    function switchImportTab(format) {
        state.importFormat = format;
        document.querySelectorAll('#impTabs .mc-tabbtn[data-fmt]').forEach(b =>
            b.classList.toggle('is-active', b.getAttribute('data-fmt') === format));
        // Manual parser options only for the simplified TXT tab — Auto decides on
        // its own (separator + multiline), so we don't burden the user with knobs.
        $('impOptions').classList.toggle('hidden', format !== 'txt_simplified');
        // Configurable markers for the Test tab (adapt parser to the file's format).
        if ($('impTestOptions')) $('impTestOptions').classList.toggle('hidden', format !== 'test');
        const h = IMPORT_HINTS[format] || IMPORT_HINTS.csv;
        $('impHint').textContent = t(h[0], h[1]);
        schedulePreview();
    }

    function setImportSep(sep) {
        state.importSep = sep;
        document.querySelectorAll('#impSeps .mc-sep-chip[data-sep]').forEach(c =>
            c.classList.toggle('is-active', c.getAttribute('data-sep') === sep));
    }

    function setMarkerPreset(preset) {
        state.importMarkerPreset = preset;
        document.querySelectorAll('#impMarkerPresets .mc-sep-chip[data-preset]').forEach(c =>
            c.classList.toggle('is-active', c.getAttribute('data-preset') === preset));
        if ($('impMarkerCustom')) $('impMarkerCustom').classList.toggle('hidden', preset !== 'custom');
        schedulePreview();
    }

    function getTestMarkers() {
        // The image marker (@) is handled by the backend default and skipped — embedded
        // images can't be shown, so it's not exposed as a knob.
        const preset = state.importMarkerPreset || 'standard';
        if (preset === 'mytestx') return { question: '#', correct: '+', wrong: '-' };
        if (preset === 'custom') {
            const v = (id, d) => (($(id) && $(id).value) || '').trim() || d;
            return { question: v('impMarkerQuestion', '?'), correct: v('impMarkerCorrect', '+'), wrong: v('impMarkerWrong', '-') };
        }
        return null; // standard → backend default markers (accepts both ? and #)
    }

    function getImportOptions() {
        if (state.importFormat === 'auto') {
            // Auto: backend picks the separator and decides multiline itself.
            return { separator: 'auto', multiline: 'auto' };
        }
        if (state.importFormat === 'txt_simplified') {
            return { separator: state.importSep || 'auto', multiline: !!($('impMultiline') && $('impMultiline').checked) };
        }
        if (state.importFormat === 'test') {
            return { markers: getTestMarkers() };
        }
        return null;
    }

    function clearImportPreview() {
        if ($('impPreview')) $('impPreview').classList.add('hidden');
        if ($('impRows')) $('impRows').innerHTML = '';
        if ($('impCounts')) $('impCounts').innerHTML = '';
        if ($('impBadges')) $('impBadges').innerHTML = '';
    }

    function hasImportInput() {
        const fi = $('importFile');
        return (fi && fi.files.length > 0) || !!($('impContent').value || '').trim();
    }

    // Debounced live preview — fires automatically on file pick / typing / tab change.
    let _importPreviewTimer = null;
    function schedulePreview() {
        if (_importPreviewTimer) clearTimeout(_importPreviewTimer);
        if (!hasImportInput()) { clearImportPreview(); return; }
        _importPreviewTimer = setTimeout(() => runImportPreview(false), 350);
    }

    function onImportInput() {
        // Typing overrides a previously chosen file.
        if ($('importFile').files.length) $('importFile').value = '';
        schedulePreview();
    }
    function onImportFile() { schedulePreview(); }

    async function pasteImportClipboard() {
        try {
            const txt = await navigator.clipboard.readText();
            if (txt) { $('impContent').value = txt; $('importFile').value = ''; schedulePreview(); }
        } catch (e) {
            showToast(t('microcards.imp_paste_fail', 'Не удалось прочитать буфер — вставьте вручную (Ctrl+V)'), 'warning');
        }
    }

    // Manual "Предпросмотр" button.
    function previewImport() { runImportPreview(true); }

    async function runImportPreview(showEmptyError) {
        const fileInput = $('importFile');
        const hasFile = fileInput && fileInput.files.length > 0;
        const textContent = $('impContent').value;
        if (!hasFile && !textContent.trim()) {
            if (showEmptyError) showToast(t('microcards.error_import_empty', 'Введите текст или выберите файл'), 'error');
            clearImportPreview();
            return;
        }
        const url = `/api/v2/microcards/decks/${state.activeDeckId}/import/analyze`;
        try {
            let result;
            if (hasFile) {
                // Send the file so preview decodes (e.g. Windows-1251) exactly like import.
                const fd = new FormData();
                fd.append('file', fileInput.files[0]);
                fd.append('format', state.importFormat);
                const o = getImportOptions();
                if (o) fd.append('options', JSON.stringify(o));
                result = await apiCall(url, { method: 'POST', body: fd });
            } else {
                result = await apiCall(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ format: state.importFormat, content: textContent, options: getImportOptions() })
                });
            }
            renderImportPreview(result.rows || [], result.counts || {}, result);
        } catch (err) { console.error(err); }
    }

    const IMPORT_FORMAT_LABELS = {
        csv: ['microcards.fmt_csv', 'CSV-таблица'],
        json: ['microcards.fmt_json', 'JSON'],
        txt_full: ['microcards.fmt_txt_full', 'TXT (блоки)'],
        txt_simplified: ['microcards.fmt_txt_simplified', 'Текст «вопрос — ответ»'],
        test: ['microcards.fmt_test', 'Тестовые вопросы'],
    };
    function importFormatLabel(fmt) {
        const e = IMPORT_FORMAT_LABELS[fmt];
        return e ? t(e[0], e[1]) : fmt;
    }

    function renderImportPreview(rows, counts, meta) {
        $('impPreview').classList.remove('hidden');
        const badges = $('impBadges');
        if (badges) {
            const chips = [];
            const chip = (icon, text) => `<span class="mc-imp-count" style="display:inline-flex;align-items:center;gap:0.3rem"><span class="material-symbols-outlined" style="font-size:0.95rem">${icon}</span>${escHtml(text)}</span>`;
            if (state.importFormat === 'auto' && meta && meta.detected_format) {
                chips.push(chip('auto_awesome', t('microcards.imp_detected', 'Распознано: {f}').replace('{f}', importFormatLabel(meta.detected_format))));
            }
            const h = (meta && meta.hierarchy) || {};
            if (h.multiline_cards > 0) {
                chips.push(chip('account_tree', t('microcards.imp_hierarchy', 'Иерархия: {n} многострочных').replace('{n}', h.multiline_cards)));
            }
            // Poor result on a test/auto import → nudge the user to the marker settings.
            const okN = counts.ok || 0, errN = counts.errors || 0;
            if ((okN === 0 || errN >= okN) && (state.importFormat === 'test' || state.importFormat === 'auto')) {
                chips.push(chip('tune', t('microcards.imp_tune_hint', 'Разобралось не так? Вкладка «Тест» → «Маркеры разбора»')));
            }
            badges.innerHTML = chips.join('');
        }
        $('impCounts').innerHTML =
            `<span class="mc-imp-count mc-imp-count--ok">${t('microcards.imp_count_ok', 'К импорту: {n}').replace('{n}', counts.ok || 0)}</span>` +
            (counts.duplicates ? `<span class="mc-imp-count mc-imp-count--dup">${t('microcards.imp_count_dup', 'Дубли: {n}').replace('{n}', counts.duplicates)}</span>` : '') +
            (counts.errors ? `<span class="mc-imp-count mc-imp-count--err">${t('microcards.imp_count_err', 'Ошибки: {n}').replace('{n}', counts.errors)}</span>` : '');
        $('impRows').innerHTML = rows.slice(0, 200).map(row => {
            if (row.status === 'error') {
                return `<div class="mc-imp-row mc-imp-row--err"><span class="mc-imp-row__icon material-symbols-outlined">error</span><span class="mc-imp-row__front">${escHtml(row.front)}</span><span class="mc-imp-row__err">${escHtml(row.error || '')}</span></div>`;
            }
            const dup = row.duplicate;
            return `<div class="mc-imp-row ${dup ? 'mc-imp-row--dup' : 'mc-imp-row--ok'}"><span class="mc-imp-row__icon material-symbols-outlined">${dup ? 'content_copy' : 'check_circle'}</span><span class="mc-imp-row__front">${escHtml(row.front)}</span><span class="mc-imp-row__back">${escHtml(row.back)}</span></div>`;
        }).join('');
    }

    function bindImportControls() {
        const tabs = $('impTabs');
        if (tabs) tabs.addEventListener('click', (e) => {
            const b = e.target.closest('.mc-tabbtn[data-fmt]');
            if (b) switchImportTab(b.getAttribute('data-fmt'));
        });
        const seps = $('impSeps');
        if (seps) seps.addEventListener('click', (e) => {
            const c = e.target.closest('.mc-sep-chip[data-sep]');
            if (c) { setImportSep(c.getAttribute('data-sep')); schedulePreview(); }
        });
        const presets = $('impMarkerPresets');
        if (presets) presets.addEventListener('click', (e) => {
            const c = e.target.closest('.mc-sep-chip[data-preset]');
            if (c) setMarkerPreset(c.getAttribute('data-preset'));
        });
    }

    async function handleImportSubmit(e) {
        if (e) e.preventDefault();
        const fmt = state.importFormat;
        const fileInput = $('importFile');
        const isFile = fileInput.files.length > 0;
        const url = `/api/v2/microcards/decks/${state.activeDeckId}/import/${fmt}`;
        const opts = { method: 'POST' };

        if (isFile) {
            const fd = new FormData();
            fd.append('file', fileInput.files[0]);
            const parserOpts = getImportOptions();
            if (parserOpts) fd.append('options', JSON.stringify(parserOpts));
            opts.body = fd;
        } else {
            const content = $('impContent').value;
            if (!content.trim()) {
                showToast(t('microcards.error_import_empty', 'Введите текст или выберите файл'), 'error');
                return;
            }
            opts.headers = { 'Content-Type': 'application/json' };
            if (fmt === 'json') {
                let parsed;
                try { parsed = JSON.parse(content); }
                catch (err) { showToast(t('microcards.error_json_invalid', 'Невалидный JSON формат'), 'error'); return; }
                opts.body = JSON.stringify(parsed);
            } else if (fmt === 'csv') {
                opts.body = JSON.stringify({ csv_content: content, options: getImportOptions() });
            } else {
                opts.body = JSON.stringify({ text: content, options: getImportOptions() });
            }
        }

        try {
            const result = await apiCall(url, opts);
            $('dialogImportDeck').close();
            let msg = t('microcards.toast_imported', 'Импортировано {n} карточек').replace('{n}', result.added_count || 0);
            if (result.skipped_duplicates) {
                msg += ' · ' + t('microcards.toast_skipped_dup', 'дублей пропущено: {n}').replace('{n}', result.skipped_duplicates);
            }
            showToast(msg, 'success');
            openDeckDetails(state.activeDeckId);
        } catch (err) {
            console.error(err);
        }
    }

    // ── Import by access code ─────────────────────────────────────────────
    function openImportByCodeDialog() {
        if ($('importCodeInput')) $('importCodeInput').value = '';
        $('dialogImportByCode').showModal();
        setTimeout(() => { try { $('importCodeInput').focus(); } catch (e) {} }, 50);
    }

    async function handleImportByCodeSubmit(e) {
        if (e) e.preventDefault();
        const code = ($('importCodeInput').value || '').trim();
        if (!code) return;
        const btn = $('importByCodeSubmit');
        if (btn) btn.disabled = true;
        try {
            const result = await apiCall('/api/v2/microcards/catalog/import-by-code', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_code: code }),
            });
            $('dialogImportByCode').close();
            showToast(result.already_in_library
                ? t('microcards.toast_code_already', 'Эта колода уже в вашей библиотеке')
                : t('microcards.toast_imported', 'Импортировано {n} карточек').replace('{n}', result.added_count || 0), 'success');
            if (result.deck && result.deck.id) openDeckDetails(result.deck.id); else loadLibraryData();
        } catch (err) {
            showToast(t('microcards.toast_code_not_found', 'Колода по такому коду не найдена'), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── Publication status & catalog ──────────────────────────────────────
    function publishStatusMeta(key) {
        const M = {
            unpublished: { label: t('microcards.pub_unpublished', 'Не опубликована'), hint: t('microcards.pub_only_you', 'Только у вас'), icon: 'lock', cls: 'mc-pub--muted' },
            public:      { label: t('microcards.pub_public', 'Публичная'), hint: t('microcards.pub_public_hint', 'Видна всем в каталоге'), icon: 'public', cls: 'mc-pub--public' },
            access_code: { label: t('microcards.pub_by_code', 'По коду доступа'), hint: '', icon: 'key', cls: 'mc-pub--code' },
            private:     { label: t('microcards.pub_private', 'Приватная'), hint: t('microcards.pub_only_you', 'Только у вас'), icon: 'lock', cls: 'mc-pub--muted' },
        };
        return M[key] || M.unpublished;
    }

    function deckPublishState(deck) {
        if (!deck || !deck.catalog_item_id) return 'unpublished';
        return deck.catalog_visibility || 'public';
    }

    function publishStatusPillHtml(deck) {
        const key = deckPublishState(deck);
        const meta = publishStatusMeta(key);
        let extra = meta.hint;
        if (key === 'access_code' && deck.access_code) extra = t('microcards.pub_code_prefix', 'код: {c}').replace('{c}', deck.access_code);
        return `<span class="mc-pub-pill ${meta.cls}"><span class="material-symbols-outlined">${meta.icon}</span>${escHtml(meta.label)}${extra ? ` · ${escHtml(extra)}` : ''}</span>`;
    }

    function renderPublishStatus() {
        const el = $('deckPublishStatus');
        if (el) el.innerHTML = publishStatusPillHtml(state.activeDeck || {});
        const modalEl = $('publishCurrentStatus');
        if (modalEl) modalEl.innerHTML = `<span class="mc-pub-cur">${t('microcards.pub_current', 'Текущий статус:')}</span> ${publishStatusPillHtml(state.activeDeck || {})}`;
    }

    function selectedPublishVisibility() {
        const checked = document.querySelector('#publishOptions input[name="publishVisibility"]:checked');
        return checked ? checked.value : 'public';
    }
    function setPublishVisibility(value) {
        const radio = document.querySelector(`#publishOptions input[value="${value}"]`);
        if (radio) radio.checked = true;
    }
    function showPublishCode(code) {
        const box = $('publishCodeBox');
        if (!box) return;
        if (code) { $('publishCodeValue').textContent = code; box.classList.remove('hidden'); }
        else { box.classList.add('hidden'); }
    }

    function publishDeckToCatalog() {
        const deck = state.activeDeck || {};
        const key = deckPublishState(deck);
        setPublishVisibility(key === 'unpublished' ? 'public' : key);
        showPublishCode(key === 'access_code' ? deck.access_code : null);
        renderPublishStatus();
        $('dialogPublishDeck').showModal();
    }

    async function copyPublishCode() {
        const code = ($('publishCodeValue').textContent || '').trim();
        if (!code) return;
        try { await navigator.clipboard.writeText(code); showToast(t('microcards.pub_code_copied', 'Код скопирован'), 'success'); }
        catch (err) { showToast(t('microcards.pub_code_copy_fail', 'Не удалось скопировать код'), 'error'); }
    }

    async function handlePublishSubmit(e) {
        if (e) e.preventDefault();
        const visibility = selectedPublishVisibility();
        try {
            const result = await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ catalog_visibility: visibility })
            });
            if (result.deck) state.activeDeck = result.deck;
            renderPublishStatus();
            const code = (result.publish && result.publish.item && result.publish.item.access_code) || null;
            const labels = { public: t('microcards.pub_public', 'Публичная'), access_code: t('microcards.pub_by_code', 'По коду доступа'), private: t('microcards.pub_private', 'Приватная') };
            showToast(t('microcards.pub_updated', 'Доступ обновлён: {v}').replace('{v}', labels[visibility] || visibility), 'success');
            // Keep dialog open so the change (code/status) is visible immediately.
            showPublishCode(visibility === 'access_code' ? code : null);
        } catch (err) {
            console.error(err);
        }
    }

    // ── Init & Event Binding ──────────────────────────────────────────────
    function init() {
        // Deep-link: /microcards?deck=<id> opens that deck directly (e.g. from the catalog).
        let deepLinkDeck = null;
        try { deepLinkDeck = new URLSearchParams(window.location.search).get('deck'); } catch (e) {}
        if (deepLinkDeck) {
            openDeckDetails(deepLinkDeck);
        } else {
            loadLibraryData();
        }

        // Bind search input to re-run filtering
        $('libSearch').addEventListener('input', () => {
            renderLibrary();
        });

        // Bind sort buttons
        const sortBar = $('mcSort');
        if (sortBar) {
            sortBar.addEventListener('click', (e) => {
                const btn = e.target.closest('.mc-sort-btn[data-sort]');
                if (btn) setSort(btn.getAttribute('data-sort'));
            });
        }

        // Bind swipe-style grading rails
        bindSessionRails();

        // Bind import dialog controls (format tabs + separator chips)
        bindImportControls();

        // Bind tag-filter chips and settings direction buttons (delegated)
        bindLibraryDelegates();

        // Set up Escape navigation key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && state.view !== 'library') {
                // If any dialog is open, do not trigger page back navigation
                const openDialogs = document.querySelectorAll('dialog[open]');
                if (openDialogs.length === 0) {
                    handleBackNavigation();
                }
            }
        });
    }

    // Expose controls to global context
    window.mcApp = {
        init,
        handleBackNavigation,
        openCreateDeckDialog,
        handleCreateDeckSubmit,
        openDeckDetails,
        toggleDeckActionsMenu,
        exportDeck,
        confirmDeleteDeck,
        startLearningSession,
        abortSession,
        toggleHint,
        revealAnswerL1,
        submitAnswerL1,
        submitAnswerL2,
        overrideL2Answer,
        nextCard,
        retrySessionErrors,
        restartLearningSession,
        backToDecks,
        openDeckMetaDialog,
        saveDeckMetaDialog,
        toggleCardExpand,
        toggleCardAdvanced,
        addNewCardInline,
        saveCardInline,
        deleteCardInline,
        openDeckEditor,
        saveDeckMeta,
        saveActiveCard,
        deleteActiveCard,
        closeDeckEditor,
        openCardEditor: (id) => { openDeckEditor(); selectEditorTarget('card', id); },
        initNewCardForm,
        previewEditorImage,
        openImportDialog,
        switchImportTab,
        handleImportSubmit,
        previewImport,
        pasteImportClipboard,
        onImportInput,
        onImportFile,
        openImportByCodeDialog,
        handleImportByCodeSubmit,
        selectTagFilter,
        openSettingsDialog,
        saveSettings,
        onNewAutoToggle,
        selectDirection,
        publishDeckToCatalog,
        handlePublishSubmit,
        copyPublishCode
    };

    // Auto boot
    document.addEventListener('DOMContentLoaded', () => {
        if (window.i18n && typeof window.i18n.translatePage === 'function') {
            window.i18n.translatePage();
        }
        init();
    });

})();
