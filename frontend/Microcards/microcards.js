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
        const colors = {
            success: 'border-success bg-success/10 text-success',
            error: 'border-error bg-error/10 text-error',
            warning: 'border-warning bg-warning/10 text-warning',
            info: 'border-primary bg-primary/10 text-primary',
        };
        const tone = colors[type] || colors.info;
        const el = document.createElement('div');
        el.className = `px-4 py-2.5 rounded-xl border shadow-lg text-xs font-semibold ${tone} transition-opacity duration-300`;
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 3000);
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
            headerProgress.classList.remove('hidden');
            headerProgress.classList.add('flex');
            updateHeaderProgress();
        } else {
            headerProgress.classList.add('hidden');
            headerProgress.classList.remove('flex');
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
        grid.innerHTML = '<div class="col-span-full py-8 text-center text-xs text-text-secondary">Загрузка колод...</div>';
        
        try {
            const data = await apiCall('/api/v2/microcards/decks');
            state.decks = data.items || [];
            renderLibrary();
        } catch (err) {
            grid.innerHTML = '<div class="col-span-full py-8 text-center text-xs text-error">Не удалось загрузить библиотеку.</div>';
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
            card.className = 'glass-card p-5 flex flex-col justify-between cursor-pointer';
            card.onclick = () => openDeckDetails(deck.id);

            const tagsHtml = (deck.tags || []).map(t => `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold border border-border-subtle bg-surface-2 text-text-secondary">${escHtml(t)}</span>`).join('');
            
            card.innerHTML = `
                <div>
                    <h3 class="font-extrabold text-base text-text-main mb-1 line-clamp-1">${escHtml(deck.name)}</h3>
                    <p class="text-xs text-text-secondary mb-4 line-clamp-2">${escHtml(deck.description || 'Описание отсутствует.')}</p>
                    <div class="flex flex-wrap gap-1 mb-4">${tagsHtml}</div>
                </div>
                <div class="flex items-center justify-between pt-3 border-t border-border-subtle">
                    <span class="text-xs text-text-secondary">Карточек: <strong class="text-text-main">${deck.card_count}</strong></span>
                    <div class="flex gap-2">
                        ${deck.due_count > 0 ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-error/10 border border-error/20 text-error">${deck.due_count} к повтору</span>` : ''}
                        ${deck.new_count > 0 ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-info/10 border border-info/20 text-info">${deck.new_count} новых</span>` : ''}
                    </div>
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
            showToast('Колода успешно создана!', 'success');
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
            $('deckDetailsDesc').textContent = state.activeDeck.description || 'Описание отсутствует.';
            $('mcHeaderSubtitle').textContent = state.activeDeck.name;
            
            // Render tags
            const tagsZone = $('deckDetailsTags');
            tagsZone.innerHTML = '';
            (state.activeDeck.tags || []).forEach(t => {
                const badge = document.createElement('span');
                badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold border border-border-subtle bg-surface-2 text-text-secondary';
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
            container.innerHTML = '<div class="py-8 text-center text-xs text-text-secondary border border-dashed border-border-strong rounded-xl">В колоде пока нет карточек.</div>';
            return;
        }

        state.cards.forEach(card => {
            const item = document.createElement('div');
            item.className = 'p-4 bg-surface-1 rounded-xl border border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-3';
            
            const hintHtml = card.hint ? `<p class="text-xs italic text-text-muted mt-1">Подсказка: ${escHtml(card.hint)}</p>` : '';
            
            item.innerHTML = `
                <div class="flex-1">
                    <p class="text-sm font-extrabold text-text-main">${escHtml(card.front.text)}</p>
                    <p class="text-xs text-text-secondary mt-1">${escHtml(card.back.text)}</p>
                    ${hintHtml}
                </div>
                <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-bold border border-border-subtle bg-surface-2 text-text-secondary">Уровень ${card.level || 1}</span>
                    <button type="button" onclick="mcApp.openCardEditor('${card.id}')" class="p-2 rounded-lg border border-border-strong hover:bg-bg-hover text-text-secondary hover:text-primary transition-colors flex items-center justify-center">
                        <span class="material-symbols-outlined text-[16px]">edit</span>
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
        showToast('Экспорт запущен!', 'success');
    }

    function confirmDeleteDeck() {
        $('deleteConfirmText').textContent = `Вы действительно хотите удалить колоду "${state.activeDeck.name}"? Это действие сотрет все карточки и ваш прогресс по ним.`;
        const btn = $('btnDeleteConfirmAction');
        btn.onclick = async () => {
            try {
                await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}`, { method: 'DELETE' });
                $('dialogConfirmDelete').close();
                showToast('Колода успешно удалена', 'success');
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
        levelInd.textContent = level === 1 ? 'Уровень 1: Знаю / Не знаю' : 'Уровень 2: Открытый ответ';
        levelInd.className = `px-3 py-1 rounded-full text-xs font-bold border ${level === 1 ? 'bg-warning/10 border-warning/30 text-warning' : 'bg-success/10 border-success/30 text-success'}`;

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
            $('l2UserAnswerDisplay').textContent = answer || '(пусто)';
            $('l2CorrectAnswerDisplay').textContent = expected;

            const badge = $('answerEvaluationBadge');
            badge.classList.remove('hidden');
            if (isCorrect) {
                badge.textContent = 'Верно';
                badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-success/15 border-success text-success';
                state.sessionStats.correct++;
                $('btnL2Override').classList.add('hidden');
            } else {
                badge.textContent = 'Ошибка';
                badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-error/15 border-error text-error';
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
            badge.textContent = 'Исправлено';
            badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-warning/15 border-warning text-warning';
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
        if (confirm('Вы уверены, что хотите выйти из сессии? Прогресс текущих ответов не сохранится.')) {
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
                    row.className = 'p-3 bg-surface-1 rounded-xl border border-border-subtle text-left';
                    row.innerHTML = `
                        <p class="text-xs font-extrabold text-text-main">${escHtml(card.front.text)}</p>
                        <p class="text-xs text-success font-semibold mt-1">${escHtml(card.back.text)}</p>
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
        metaBtn.className = 'w-full text-left px-3 py-2 text-xs font-bold rounded-lg border border-border-strong hover:bg-bg-hover flex items-center gap-1.5 transition-colors mb-2';
        metaBtn.onclick = () => selectEditorTarget('deck');
        metaBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">settings</span><span>Параметры колоды</span>';
        container.appendChild(metaBtn);

        if (state.cards.length === 0) {
            const emptyLabel = document.createElement('div');
            emptyLabel.className = 'text-center py-4 text-[10px] text-text-secondary';
            emptyLabel.textContent = 'Нет карточек';
            container.appendChild(emptyLabel);
            return;
        }

        state.cards.forEach(card => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full text-left px-3 py-2 text-xs rounded-lg border border-border-subtle hover:bg-bg-hover line-clamp-1 transition-colors';
            btn.textContent = card.front.text || '(без текста)';
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
                $('editorCardFormTitle').textContent = 'Редактировать карточку';
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
        
        $('editorCardFormTitle').textContent = 'Новая карточка';
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
            showToast('Название колоды обязательно', 'error');
            return;
        }

        try {
            await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, tags })
            });
            showToast('Параметры колоды сохранены', 'success');
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
            showToast('Заполните лицевую и обратную стороны', 'error');
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
                showToast('Карточка сохранена', 'success');
            } else {
                // Create new card
                await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                showToast('Карточка добавлена', 'success');
            }
            openDeckDetails(state.activeDeckId).then(() => openDeckEditor());
        } catch (err) {
            console.error(err);
        }
    }

    async function deleteActiveCard() {
        if (!state.activeCard) return;
        if (confirm('Вы действительно хотите удалить эту карточку?')) {
            try {
                await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards/${state.activeCard.id}`, {
                    method: 'DELETE'
                });
                showToast('Карточка удалена', 'success');
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
            btnCsv.className = 'px-4 py-1.5 text-xs font-bold rounded-lg border bg-primary text-primary-fg';
            btnJson.className = 'px-4 py-1.5 text-xs font-bold rounded-lg border border-border-strong';
            zoneCsv.classList.remove('hidden');
            zoneJson.classList.add('hidden');
        } else {
            btnCsv.className = 'px-4 py-1.5 text-xs font-bold rounded-lg border border-border-strong';
            btnJson.className = 'px-4 py-1.5 text-xs font-bold rounded-lg border bg-primary text-primary-fg';
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
                showToast('Введите текст или выберите файл для импорта', 'error');
                return;
            }
            if (state.importFormat === 'json') {
                try {
                    options.body = JSON.stringify(JSON.parse(content));
                    options.headers = { 'Content-Type': 'application/json' };
                } catch (err) {
                    showToast('Невалидный JSON формат', 'error');
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
            showToast(`Успешно импортировано ${result.added_count} карточек`, 'success');
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
            showToast('Колода опубликована в каталог!', 'success');
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
