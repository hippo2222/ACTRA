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
        
        // Import modal state
        importFormat: 'csv',
        
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

        // Configure header back button
        const backBtn = $('mcHeaderBackBtn');
        if (viewName === 'library') {
            backBtn.style.visibility = 'hidden';
            $('mcHeaderSubtitle').textContent = t('microcards.subtitle_default', 'Повторение и обучение');
        } else {
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
            renderLibrary();
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

    function renderLibrary() {
        const grid = $('decksGrid');
        const empty = $('decksEmpty');
        grid.innerHTML = '';

        const searchQuery = $('libSearch').value.toLowerCase().trim();
        const filtered = state.decks.filter(d => d.name.toLowerCase().includes(searchQuery));

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

        filtered.forEach(deck => {
            const card = document.createElement('div');
            card.className = 'mc-deck-card';
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
                    <div style="display:flex;gap:0.35rem;flex-wrap:wrap;justify-content:flex-end">${duePill}${newPill}</div>
                </div>
            `;
            grid.appendChild(card);
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

            // Load cards
            const cardsData = await apiCall(`/api/v2/microcards/decks/${deckId}/cards`);
            state.cards = cardsData.items || [];
            
            // Calculate progress by level
            let l1 = 0, l2 = 0;
            state.cards.forEach(c => {
                // Determine level from local user stats if available, or default to level 1
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

            renderDeckCardsList();
        } catch (err) {
            console.error(err);
        }
    }

    function renderDeckCardsList() {
        const container = $('deckCardsListContainer');
        container.innerHTML = '';

        if (state.cards.length === 0) {
            container.innerHTML = `<div style="padding:2rem;text-align:center;font-size:0.8rem;color:var(--color-text-secondary);border:1px dashed var(--color-border-strong);border-radius:var(--mc-radius-sm)">${t('microcards.no_cards_yet', 'В колоде пока нет карточек.')}</div>`;
            return;
        }

        state.cards.forEach(card => {
            const item = document.createElement('div');
            item.className = 'mc-cardrow';

            const hintHtml = card.hint ? `<p class="mc-cardrow__hint">${t('microcards.hint_label', 'Подсказка')}: ${escHtml(card.hint)}</p>` : '';

            item.innerHTML = `
                <div style="min-width:0;flex:1">
                    <p class="mc-cardrow__front">${escHtml(card.front.text)}</p>
                    <p class="mc-cardrow__back">${escHtml(card.back.text)}</p>
                    ${hintHtml}
                </div>
                <div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0">
                    <span class="mc-level-chip">${t('microcards.level_badge', 'Уровень {n}').replace('{n}', card.level || 1)}</span>
                    <button type="button" onclick="mcApp.openCardEditor('${card.id}')" class="mc-iconbtn" style="width:2.4rem;height:2.4rem" aria-label="Редактировать">
                        <span class="material-symbols-outlined" style="font-size:1.05rem">edit</span>
                    </button>
                </div>
            `;
            container.appendChild(item);
        });
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
        
        // Load text and images
        $('cardFrontText').textContent = card.front.text;
        $('cardBackText').textContent = card.back.text;
        
        if (card.hint) {
            $('btnShowHint').classList.remove('hidden');
            $('cardHintText').classList.add('hidden');
            $('cardHintText').textContent = card.hint;
        } else {
            $('btnShowHint').classList.add('hidden');
            $('cardHintText').classList.add('hidden');
        }

        // Front Image
        const frontImg = $('cardFrontImage');
        if (card.front.image_url) {
            frontImg.src = card.front.image_url;
            frontImg.classList.remove('hidden');
        } else {
            frontImg.classList.add('hidden');
        }

        // Back Image
        const backImg = $('cardBackImage');
        if (card.back.image_url) {
            backImg.src = card.back.image_url;
            backImg.classList.remove('hidden');
        } else {
            backImg.classList.add('hidden');
        }

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
    }

    async function submitAnswerL1(know) {
        const card = state.sessionCards[state.sessionIndex];
        const ratingValue = know ? 'know' : 'dont_know';
        
        try {
            // Update stats locally
            if (know) {
                state.sessionStats.correct++;
            } else {
                state.sessionStats.errors++;
                if (!state.sessionErrors.includes(card.id)) {
                    state.sessionErrors.push(card.id);
                }
            }

            // Sync with backend if not errors-only offline review
            if (state.session && !state.isErrorsOnlyMode) {
                await apiCall(`/api/v2/microcards/session/${state.session.id}/answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ card_id: card.id, user_answer: ratingValue })
                });
            }

            state.sessionIndex++;
            setupCurrentCard();
        } catch (err) {
            console.error(err);
        }
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
        
        $('sumStatTotal').textContent = state.sessionStats.total;
        $('sumStatCorrect').textContent = state.sessionStats.correct;
        $('sumStatErrors').textContent = state.sessionStats.errors;

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

        // Run celebration effect if perfect score
        if (state.sessionStats.errors === 0 && window.CelebrationEffects) {
            try {
                window.CelebrationEffects.launchConfetti();
            } catch (e) {
                console.warn(e);
            }
        }
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
    function openImportDialog() {
        $('importCsvContent').value = '';
        $('importJsonContent').value = '';
        $('importFile').value = '';
        switchImportTab('csv');
        $('dialogImportDeck').showModal();
    }

    function switchImportTab(format) {
        state.importFormat = format;
        const btnCsv = $('btnImportTabCsv');
        const btnJson = $('btnImportTabJson');
        const zoneCsv = $('importTabCsvZone');
        const zoneJson = $('importTabJsonZone');

        if (format === 'csv') {
            btnCsv.classList.add('is-active');
            btnJson.classList.remove('is-active');
            zoneCsv.classList.remove('hidden');
            zoneJson.classList.add('hidden');
        } else {
            btnCsv.classList.remove('is-active');
            btnJson.classList.add('is-active');
            zoneCsv.classList.add('hidden');
            zoneJson.classList.remove('hidden');
        }
    }

    async function handleImportSubmit(e) {
        e.preventDefault();
        const fileInput = $('importFile');
        const isFile = fileInput.files.length > 0;
        
        let url = `/api/v2/microcards/decks/${state.activeDeckId}/import/${state.importFormat}`;
        let options = { method: 'POST' };

        if (isFile) {
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            options.body = formData;
        } else {
            const content = state.importFormat === 'csv' ? $('importCsvContent').value : $('importJsonContent').value;
            if (!content.trim()) {
                showToast(t('microcards.error_import_empty', 'Введите текст или выберите файл'), 'error');
                return;
            }
            if (state.importFormat === 'json') {
                try {
                    options.body = JSON.stringify(JSON.parse(content));
                    options.headers = { 'Content-Type': 'application/json' };
                } catch (err) {
                    showToast(t('microcards.error_json_invalid', 'Невалидный JSON формат'), 'error');
                    return;
                }
            } else {
                options.body = JSON.stringify({ csv_content: content });
                options.headers = { 'Content-Type': 'application/json' };
            }
        }

        try {
            const result = await apiCall(url, options);
            $('dialogImportDeck').close();
            showToast(t('microcards.toast_imported', 'Успешно импортировано {n} карточек').replace('{n}', result.added_count), 'success');
            openDeckDetails(state.activeDeckId);
        } catch (err) {
            console.error(err);
        }
    }

    // ── Catalog Integration ───────────────────────────────────────────────
    function publishDeckToCatalog() {
        $('publishVisibility').value = 'public';
        $('dialogPublishDeck').showModal();
    }

    async function handlePublishSubmit(e) {
        e.preventDefault();
        const visibility = $('publishVisibility').value;
        
        try {
            const result = await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ catalog_visibility: visibility })
            });
            $('dialogPublishDeck').close();
            showToast(t('microcards.toast_published', 'Колода опубликована в каталог!'), 'success');
            openDeckDetails(state.activeDeckId);
        } catch (err) {
            console.error(err);
        }
    }

    // ── Init & Event Binding ──────────────────────────────────────────────
    function init() {
        loadLibraryData();
        
        // Bind search input to re-run filtering
        $('libSearch').addEventListener('input', () => {
            renderLibrary();
        });

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
        openDeckEditor,
        saveDeckMeta,
        saveActiveCard,
        deleteActiveCard,
        closeDeckEditor,
        openCardEditor: (id) => selectEditorTarget('card', id),
        initNewCardForm,
        previewEditorImage,
        openImportDialog,
        switchImportTab,
        handleImportSubmit,
        publishDeckToCatalog,
        handlePublishSubmit
    };

    // Auto boot
    document.addEventListener('DOMContentLoaded', () => {
        if (window.i18n && typeof window.i18n.translatePage === 'function') {
            window.i18n.translatePage();
        }
        init();
    });

})();
