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

    function openDialog(id) {
        const dialog = $(id);
        if (!dialog) return;
        dialog.classList.remove('is-closing');
        dialog.showModal();
        dialog.offsetWidth; // force reflow
        dialog.classList.add('is-open');
    }

    function closeDialog(id) {
        const dialog = $(id);
        if (!dialog) return;
        const closeMs = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
        ) || 150;
        dialog.classList.remove('is-open');
        dialog.classList.add('is-closing');
        setTimeout(() => {
            dialog.classList.remove('is-closing');
            dialog.close();
        }, closeMs);
    }

    function openDropdown(menu) {
        if (typeof menu === 'string') menu = $(menu);
        if (!menu) return;
        menu.classList.remove('hidden');
        menu.classList.remove('is-closing');
        menu.offsetWidth; // force reflow
        menu.classList.add('is-open');
    }

    function closeDropdown(menu) {
        if (typeof menu === 'string') menu = $(menu);
        if (!menu || menu.classList.contains('hidden')) return;
        const closeMs = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')
        ) || 150;
        menu.classList.remove('is-open');
        menu.classList.add('is-closing');
        setTimeout(() => {
            menu.classList.remove('is-closing');
            menu.classList.add('hidden');
        }, closeMs);
    }

    function moveTabPill(bar, activeTab, animate) {
        if (typeof bar === 'string') bar = $(bar);
        if (!bar) return;
        const pill = bar.querySelector('.t-tabs-pill');
        if (!pill) return;
        if (!activeTab) {
            activeTab = bar.querySelector('.t-tab.is-active') || bar.querySelector('.t-tab[aria-selected="true"]') || bar.querySelector('.t-tab');
        }
        if (!activeTab) return;
        
        if (!animate) {
            const prev = pill.style.transition;
            pill.style.transition = 'none';
            pill.style.transform = `translateX(${activeTab.offsetLeft}px)`;
            pill.style.width = `${activeTab.offsetWidth}px`;
            void pill.offsetWidth;
            pill.style.transition = prev;
        } else {
            pill.style.transform = `translateX(${activeTab.offsetLeft}px)`;
            pill.style.width = `${activeTab.offsetWidth}px`;
        }
    }

    // ── Study preferences (sound / animations) — device-local ──────────────
    const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function loadPrefs() {
        try {
            const raw = JSON.parse(localStorage.getItem('mc_prefs') || '{}');
            return {
                sound: raw.sound !== false,
                volume: typeof raw.volume === 'number' ? Math.min(1, Math.max(0, raw.volume)) : 1,
                // Reduced-motion users get animations OFF by default (can opt back in).
                animations: raw.animations !== undefined ? !!raw.animations : !REDUCED_MOTION,
            };
        } catch (e) {
            return { sound: true, volume: 1, animations: !REDUCED_MOTION };
        }
    }
    const prefs = loadPrefs();
    function savePrefs() {
        try { localStorage.setItem('mc_prefs', JSON.stringify(prefs)); } catch (e) {}
        applyAnimationPrefs();
    }
    function applyAnimationPrefs() {
        document.documentElement.classList.toggle('mc-no-anim', !prefs.animations);
    }
    // Confetti and other JS-driven effects funnel through this guard.
    function fxAllowed() { return prefs.animations; }

    // ── Web Audio API Dopamine Sound Synthesizer ──────────────────────────
    const DopamineAudio = (function () {
        let audioCtx = null;

        function getAudioContext() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            return audioCtx;
        }

        function playNote(freq, type, duration, startTime, volume = 0.1) {
            if (!prefs.sound || prefs.volume <= 0) return;
            volume *= prefs.volume;
            try {
                const ctx = getAudioContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = type;
                osc.frequency.setValueAtTime(freq, startTime);

                gain.gain.setValueAtTime(volume, startTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(startTime);
                osc.stop(startTime + duration);
            } catch (e) {
                console.warn('Web Audio synthesis failed:', e);
            }
        }

        // ── Pre-rendered samples (tools/generate_microcards_sounds.py) ─────
        // Warm baked "plucks"/whooshes instead of raw oscillator beeps. Loaded
        // lazily; the synth below stays as the fallback while they load (or if
        // they fail), so sound never goes missing.
        const SAMPLE_NAMES = ['correct', 'boost', 'near_miss', 'recovery', 'combo_lost',
                              'card_flip', 'swipe_yes', 'swipe_no', 'combo_up', 'finish'];
        const sampleBuffers = {};
        let samplesRequested = false;
        function ensureSamples() {
            if (samplesRequested) return;
            samplesRequested = true;
            let ctx;
            try { ctx = getAudioContext(); } catch (e) { return; }
            SAMPLE_NAMES.forEach(name => {
                fetch(`/assets/sounds/mc/${name}.wav`)
                    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
                    .then(ab => ctx.decodeAudioData(ab))
                    .then(buf => { sampleBuffers[name] = buf; })
                    .catch(() => {}); // missing sample → synth fallback covers it
            });
        }
        function playSample(name, rate = 1, volume = 1) {
            if (!prefs.sound || prefs.volume <= 0) return true; // muted: swallow
            ensureSamples();
            const buf = sampleBuffers[name];
            if (!buf) return false; // not loaded (yet) → caller falls back to synth
            try {
                const ctx = getAudioContext();
                const src = ctx.createBufferSource();
                src.buffer = buf;
                src.playbackRate.value = rate;
                const gain = ctx.createGain();
                gain.gain.value = volume * prefs.volume;
                src.connect(gain);
                gain.connect(ctx.destination);
                src.start();
                return true;
            } catch (e) {
                return false;
            }
        }

        return {
            preload: ensureSamples,
            playCorrect: function () {
                if (playSample('correct')) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                playNote(523.25, 'sine', 0.15, now, 0.08); // C5
                playNote(659.25, 'sine', 0.25, now + 0.08, 0.08); // E5
            },
            playBoost: function () {
                if (playSample('boost')) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                playNote(523.25, 'sine', 0.12, now, 0.08); // C5
                playNote(659.25, 'sine', 0.12, now + 0.07, 0.08); // E5
                playNote(783.99, 'sine', 0.12, now + 0.14, 0.08); // G5
                playNote(1046.50, 'sine', 0.35, now + 0.21, 0.08); // C6
            },
            playNearMiss: function () {
                if (playSample('near_miss')) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                playNote(440.00, 'triangle', 0.22, now, 0.12); // A4
            },
            playRecovery: function () {
                if (playSample('recovery')) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                playNote(783.99, 'sine', 0.15, now, 0.08); // G5
                playNote(1046.50, 'sine', 0.3, now + 0.09, 0.08); // C6
            },
            playComboLost: function () {
                if (playSample('combo_lost')) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                playNote(392.00, 'sine', 0.15, now, 0.08); // G4
                playNote(311.13, 'sine', 0.35, now + 0.1, 0.08); // Eb4
            },
            playCardFlip: function () {
                if (playSample('card_flip', 1, 0.8)) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                playNote(160, 'triangle', 0.07, now, 0.04);
                playNote(110, 'triangle', 0.05, now + 0.03, 0.03);
            },
            playCardSwipe: function (know) {
                if (playSample(know ? 'swipe_yes' : 'swipe_no')) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                if (know) {
                    playNote(320, 'sine', 0.12, now, 0.05);
                    playNote(480, 'sine', 0.12, now + 0.04, 0.03);
                } else {
                    playNote(260, 'sine', 0.12, now, 0.05);
                    playNote(170, 'sine', 0.12, now + 0.04, 0.03);
                }
            },
            playComboLevelUp: function (combo) {
                const multiplier = Math.min(2.0, 1 + (combo - 1) * 0.12);
                // The baked pluck is pitch-shifted per combo — same ramp the
                // synth used, but with the warm timbre.
                if (playSample('combo_up', multiplier)) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                const freq = 523.25 * multiplier;
                playNote(freq, 'sine', 0.08, now, 0.06);
                playNote(freq * 1.5, 'sine', 0.15, now + 0.04, 0.04);
            },
            playSessionFinish: function () {
                if (playSample('finish')) return;
                const ctx = getAudioContext();
                const now = ctx.currentTime;
                playNote(523.25, 'sine', 0.1, now, 0.06);
                playNote(659.25, 'sine', 0.1, now + 0.08, 0.06);
                playNote(783.99, 'sine', 0.1, now + 0.16, 0.06);
                playNote(1046.50, 'sine', 0.35, now + 0.24, 0.08);
            }
        };
    })();

    // ── App State ─────────────────────────────────────────────────────────
    const state = {
        view: 'library', // 'library' | 'details' | 'session' | 'summary'
        decks: [],
        sortKey: 'name-asc', // library sort order
        activeTag: null, // active tag filter
        activeDeckId: null,
        activeDeck: null,
        cards: [], // active deck cards
        
        // Session state (mirrors the server session — the queue/cursor live there)
        session: null,
        sessionMode: 'review', // 'run' (full-deck pass, stars) | 'review' (SRS)
        sessionCards: [],
        sessionIndex: 0,
        currentCard: null, // the card on screen — survives queue re-syncs mid-presentation
        currentForm: 1,    // how the current card is checked: 1 self-grade / 2 typed
        sessionStats: { unique_total: 0, mastered: 0, first_try_correct: 0, correct: 0, errors: 0, pending_retry: 0 },

        // Browse mode (free flipping, no grading)
        browseIndex: 0,

        // Bulk selection in the deck editor (card ids)
        selectedCards: new Set(),

        // Gamification (per session)
        combo: 0,
        maxCombo: 0,
        sessionXp: 0,
        
        // Import modal state
        importFormat: 'csv',
        importSep: 'auto',
        
        // Keyboard controls lock
        keyboardLocked: false,

        // Server-side records cache: { [deckId]: { scoreL1, starsL1, scoreL2, starsL2 } }
        serverRecords: {}
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

    // ── Session progress (header toolbar / inner session) ──────────────────
    // Progress = mastered cards / unique cards. The cursor would jump backwards
    // every time a failed card is re-queued, so it never drives the bar.
    function updateHeaderProgress() {
        const stats = state.sessionStats || {};
        const total = stats.unique_total || state.sessionCards.length || 0;
        const mastered = Math.min(stats.mastered || 0, total);
        const text = total > 0 ? `${mastered}/${total}` : '0/0';
        const width = total > 0 ? `${(mastered / total) * 100}%` : '0%';

        const textEl = $('mcHeaderProgressText');
        const barEl = $('mcHeaderProgressBar');
        if (textEl) textEl.textContent = text;
        if (barEl) barEl.style.width = width;

        const sTextEl = $('mcSessionProgressText');
        const sBarEl = $('mcSessionProgressBar');
        if (sTextEl) sTextEl.textContent = text;
        if (sBarEl) sBarEl.style.width = width;

        // Repeat-queue chip: how many failed cards are still circling back.
        const pending = stats.pending_retry || 0;
        const repeatChip = $('mcRepeatChip');
        if (repeatChip) {
            const valEl = $('mcRepeatChipVal');
            if (valEl) valEl.textContent = pending;
            repeatChip.style.display = pending > 0 ? 'inline-flex' : 'none';
        }

        updateProgressVisuals();
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

    // Base points by card form: a typed answer (form 2) is objectively harder
    // than a self-graded flip, so it pays double.
    const FORM_BASE_POINTS = { 1: 100, 2: 200 };

    // Points for a correct answer: form base × combo multiplier (capped ramp).
    function pointsForCombo(combo, threshold, form = 1) {
        let multiplier = 1;
        if (combo >= threshold) {
            multiplier = 3;
        } else if (combo === 4) {
            multiplier = 2;
        } else if (combo === 3) {
            multiplier = 1.5;
        }
        return Math.floor((FORM_BASE_POINTS[form] || 100) * multiplier);
    }

    // A card closed on a re-presentation (after a miss) earns half the form
    // base, flat: the mastery cycle guarantees everyone finishes at 100%, so
    // full points are reserved for first-try answers.
    function retryPoints(form = 1) {
        return Math.floor((FORM_BASE_POINTS[form] || 100) / 2);
    }

    function calculateMaxPossiblePoints(sessionSize, threshold, form = 1) {
        let maxPossible = 0;
        for (let combo = 1; combo <= sessionSize; combo++) {
            maxPossible += pointsForCombo(combo, threshold, form);
        }
        return maxPossible;
    }

    function updateProgressVisuals() {
        const bar = $('mcSessionProgressBar');
        const flame = $('mcSessionProgressFlame');
        if (!bar) return;

        bar.classList.remove('bar--orange', 'bar--boost', 'bar--charcoal');
        if (flame) {
            flame.classList.remove('is-active', 'flame--sm', 'flame--md', 'flame--lg', 'flame--boost', 'flame--ember');
        }

        const widthPct = parseFloat(bar.style.width) || 0;
        if (flame) {
            flame.style.left = widthPct + '%';
        }

        const threshold = state.threshold || 5;

        if (state.isNearMiss) {
            bar.classList.add('bar--charcoal');
            if (flame) {
                flame.classList.add('is-active', 'flame--ember');
            }
        } else if (state.combo >= threshold) {
            bar.classList.add('bar--boost');
            if (flame) {
                flame.classList.add('is-active', 'flame--boost');
            }
        } else if (state.combo >= 3) {
            bar.classList.add('bar--orange');
            if (flame) {
                flame.classList.add('is-active');
                if (state.combo === 3 || state.combo === 4) {
                    flame.classList.add('flame--sm');
                } else if (state.combo === 5 || state.combo === 6) {
                    flame.classList.add('flame--md');
                } else {
                    flame.classList.add('flame--lg');
                }
            }
        }
    }

    let lastXpValue = 0;
    let _xpAnimFrame = null;
    function updateXpChip() {
        const el = $('xpChipVal');
        if (!el) return;
        // A new gain can land mid-animation — restart the tween from wherever
        // the previous one left off instead of stacking two rAF loops.
        if (_xpAnimFrame) { cancelAnimationFrame(_xpAnimFrame); _xpAnimFrame = null; }
        const startVal = lastXpValue;
        const endVal = state.sessionXp;
        lastXpValue = endVal;

        if (startVal === endVal) {
            popNumber(el, endVal);
            return;
        }

        const duration = 600;
        const startTime = performance.now();

        function update(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const ease = progress * (2 - progress); // easeOutQuad
            const currentVal = Math.round(startVal + (endVal - startVal) * ease);
            if (progress < 1) {
                // Plain text while counting up — rebuilding the per-digit spans
                // (popNumber) every frame restarts their CSS animation at 60fps
                // and reads as flicker.
                el.textContent = currentVal;
                _xpAnimFrame = requestAnimationFrame(update);
            } else {
                _xpAnimFrame = null;
                popNumber(el, endVal); // a single satisfying pop on landing
            }
        }
        _xpAnimFrame = requestAnimationFrame(update);
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

    // Central hook for every graded answer — drives combo, points and feedback.
    // `isRetry` = the card came back through the mastery cycle after a miss:
    // it still feeds the combo, but only earns the flat reduced reward.
    // `form` = how the card was checked (1 self-grade / 2 typed input).
    function registerAnswer(isCorrect, isRetry = false, form = 1) {
        const threshold = state.threshold || 5;
        if (isCorrect) {
            const wasNearMiss = state.isNearMiss;
            if (state.isNearMiss) {
                state.isNearMiss = false;
                DopamineAudio.playRecovery();
            }

            state.combo += 1;
            state.maxCombo = Math.max(state.maxCombo, state.combo);

            const pts = isRetry ? retryPoints(form) : pointsForCombo(state.combo, threshold, form);
            state.sessionXp += pts;
            updateXpChip();
            floatXp(pts);
            playCheck();
            reactCard('correct');
            showCombo();

            if (!wasNearMiss) {
                if (state.combo === threshold) {
                    DopamineAudio.playBoost();
                    if (fxAllowed() && window.CelebrationEffects && typeof window.CelebrationEffects.launchConfetti === 'function') {
                        try {
                            window.CelebrationEffects.launchConfetti();
                        } catch (e) {
                            console.warn(e);
                        }
                    }
                } else {
                    DopamineAudio.playComboLevelUp(state.combo);
                }
            }
        } else {
            if (state.combo >= 3 && !state.isNearMiss) {
                state.isNearMiss = true;
                DopamineAudio.playNearMiss();
                reactCard('wrong');
                showCombo();
            } else {
                state.combo = 0;
                state.isNearMiss = false;
                DopamineAudio.playComboLost();
                reactCard('wrong');
                showCombo();
            }
        }

        const wrap = $('mcFlashWrap');
        if (wrap) {
            if (state.combo >= 5) {
                wrap.classList.add('is-on-fire');
            } else {
                wrap.classList.remove('is-on-fire');
            }
        }

        updateProgressVisuals();
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
    let _fitTimer = null;
    function bindSessionRails() {
        const wrap = $('mcFlashWrap');
        if (wrap) {
            wrap.addEventListener('click', onCardActivate);
            wrap.addEventListener('keydown', onCardKey);
        }

        // Global document-level keydown handler for studying sessions
        document.addEventListener('keydown', (e) => {
            if (state.view !== 'session') return;
            
            // Bypass shortcuts when user is actively typing in text inputs/textareas
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                return;
            }

            const inner = $('flashcardInner');
            if (!inner) return;

            const isFlipped = inner.classList.contains('flipped');

            if (state.currentLevel === 1) {
                if (e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    onCardActivate(e);
                } else if (isFlipped) {
                    if (e.key === '1' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        submitAnswerL1(false);
                    } else if (e.key === '2' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        submitAnswerL1(true);
                    }
                }
            } else if (state.currentLevel === 2) {
                if (isFlipped && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault();
                    nextCard();
                }
            }
        });

        // Re-fit the card text when the viewport size changes.
        window.addEventListener('resize', () => {
            clearTimeout(_fitTimer);
            _fitTimer = setTimeout(fitCardText, 150);
        });
        const arena = $('mcArena'), railNo = $('railNo'), railYes = $('railYes');
        if (!arena || !railNo || !railYes) return;
        railNo.addEventListener('mouseenter', () => arena.classList.add('lean-left'));
        railNo.addEventListener('mouseleave', () => arena.classList.remove('lean-left'));
        railYes.addEventListener('mouseenter', () => arena.classList.add('lean-right'));
        railYes.addEventListener('mouseleave', () => arena.classList.remove('lean-right'));
        railNo.addEventListener('click', () => { if (arena.classList.contains('is-grading')) submitAnswerL1(false); });
        railYes.addEventListener('click', () => { if (arena.classList.contains('is-grading')) submitAnswerL1(true); });
    }

    // ── Run records (server-side; persisted only by completed runs) ────────
    function getDeckRecord(deckId) {
        const srv = (state.serverRecords && state.serverRecords[deckId]) || {};
        return {
            scoreL1: srv.scoreL1 || 0,
            starsL1: srv.starsL1 || 0,
            sizeL1: srv.sizeL1 || 0,
            scoreL2: srv.scoreL2 || 0,
            starsL2: srv.starsL2 || 0,
            sizeL2: srv.sizeL2 || 0,
            l1_run_completed: !!srv.l1_run_completed,
        };
    }
    // L2 gate for the active deck: at least one completed full-deck L1 run.
    function isDeckL2Unlocked() {
        const deck = state.activeDeck || {};
        if (typeof deck.l2_unlocked === 'boolean') return deck.l2_unlocked;
        return getDeckRecord(state.activeDeckId).l1_run_completed;
    }

    // The streak lives SERVER-side only (review events → analytics.streak,
    // rendered in the library KPI strip) — the old per-device localStorage
    // streak double-counted and diverged between devices.

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
        else if (viewName === 'browse') targetId = 'viewBrowse';

        const targetEl = $(targetId);
        if (targetEl) {
            targetEl.classList.remove('hidden');
            // Allow browser to register layout before animating
            setTimeout(() => targetEl.classList.add('active-view'), 50);
        }

        // Zen mode: Hide/show global navigation header
        const globalHeader = document.querySelector('[data-global-header]');
        if (globalHeader) {
            globalHeader.style.display = (viewName === 'session') ? 'none' : 'block';
        }

        // Break out of container constraints during study session
        const pageEl = document.querySelector('.mc-page');
        if (pageEl) {
            if (viewName === 'session') {
                pageEl.classList.add('mc-page--session-fullscreen');
            } else {
                pageEl.classList.remove('mc-page--session-fullscreen');
            }
        }

        // The contextual toolbar (back + deck name + progress) is useless on the
        // library screen — the page heading already says everything. Hide it there;
        // show it on every other view where the back button / progress matter.
        const toolbar = $('mcToolbar');
        const backBtn = $('mcHeaderBackBtn');
        // Library has its own page heading; deck details has its own breadcrumb
        // header — the shared toolbar is redundant on both. Keep it for session.
        if (viewName === 'library' || viewName === 'details' || viewName === 'session') {
            if (toolbar) toolbar.style.display = 'none';
        } else {
            if (toolbar) toolbar.style.display = 'flex';
            backBtn.style.visibility = 'visible';
        }

        // Show/hide progress tracker in header
        const headerProgress = $('mcHeaderProgress');
        if (viewName === 'session') {
            if (headerProgress) headerProgress.style.display = 'none';
            updateHeaderProgress();
        } else {
            if (headerProgress) headerProgress.style.display = 'none';
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
        } else if (state.view === 'browse') {
            exitBrowse();
        }
    }

    // ── API Service Calls ─────────────────────────────────────────────────
    async function apiCall(url, options = {}) {
        try {
            const resp = await fetch(url, options);
            const contentType = resp.headers.get('content-type') || '';
            let data;
            if (contentType.includes('application/json')) {
                data = await resp.json();
            } else {
                throw new Error(t('microcards.server_error_status', 'Ошибка сервера ({status})').replace('{status}', resp.status));
            }
            if (!data.ok) {
                throw new Error(data.error || 'API Error');
            }
            return data;
        } catch (err) {
            showToast(err.message, 'error');
            throw err;
        }
    }

    async function loadLibraryData() {
        switchView('library');
        const grid = $('decksGrid');
        grid.innerHTML = `<div class="col-span-full py-8 text-center text-xs text-text-secondary">${t('microcards.loading_decks', 'Загрузка колод...')}</div>`;
        
        try {
            const [decksData, settingsData, recordsData] = await Promise.all([
                apiCall('/api/v2/microcards/decks'),
                apiCall('/api/v2/microcards/settings').catch(() => ({ settings: {} })),
                apiCall('/api/v2/microcards/records').catch(() => ({ records: {} }))
            ]);
            state.settings = settingsData.settings || {};
            state.decks = decksData.items || [];
            // Hydrate server records cache (used by getDeckRecord)
            if (recordsData && recordsData.records) {
                state.serverRecords = Object.assign({}, state.serverRecords, recordsData.records);
            }
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
        let activeBtn = null;
        document.querySelectorAll('#mcSort .mc-sort-btn[data-sort]').forEach(btn => {
            const active = btn.getAttribute('data-sort') === state.sortKey;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            if (active) activeBtn = btn;
        });
        if (activeBtn) {
            moveTabPill('mcSort', activeBtn, true);
        }
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

    // Deterministic hue (0–359) from a string — gives each deck a stable accent colour.
    function deckHue(s) {
        let h = 0; const str = String(s || '');
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
        return h % 360;
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

            // Workload (what to do today) — lives in the ACTION row next to the CTA (info that
            // drives the action sits with the action). Empty when nothing is due/new.
            let workloadHtml = '';
            if (deck.is_paused) {
                workloadHtml = `<span class="mc-deck-card__load" style="background:color-mix(in srgb, var(--color-warning) 14%, transparent); color:var(--color-warning); border:1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); display:inline-flex; align-items:center; gap:0.25rem;"><span class="material-symbols-outlined" style="font-size:0.95rem;">pause_circle</span><span>${t('microcards.badge_paused', 'На паузе')} (${deck.paused_progress})</span></span>`;
            } else if (deck.due_count > 0) {
                workloadHtml = `<span class="mc-deck-card__load mc-deck-card__load--due">${t('microcards.badge_due', '{n} к повтору').replace('{n}', `${deck.due_count} / ${total}`)}</span>`;
            } else if (deck.new_count > 0) {
                workloadHtml = `<span class="mc-deck-card__load mc-deck-card__load--new">${t('microcards.badge_new_cards', '{n} новых').replace('{n}', `${deck.new_count} / ${total}`)}</span>`;
            }

            // Stars — leading achievement metric: silver (L1) → gold (L2).
            const record = getDeckRecord(deck.id);
            const isGold = record.starsL2 > 0;
            const starCount = isGold ? record.starsL2 : record.starsL1;
            const bestScore = isGold ? record.scoreL2 : record.scoreL1;
            const hasRecord = starCount > 0 || bestScore > 0;
            // Qualitative status WORD — the mastery bar below carries the %, so no numeric dup.
            const startedSrs = Math.max(0, total - (deck.new_count || 0)) > 0;
            const started = startedSrs || hasRecord;
            let statusText, statusMod, statusIcon = '';
            if (deck.is_paused) { statusText = t('microcards.badge_paused', 'На паузе'); statusMod = 'paused'; statusIcon = 'pause_circle'; }
            else if (!started) { statusText = t('microcards.not_attempted', 'Ещё не пройдено'); statusMod = 'new'; }
            else if (masteryPct >= 100) { statusText = t('microcards.stat_mastered', 'Освоено'); statusMod = 'mastered'; statusIcon = 'verified'; }
            else { statusText = t('microcards.in_progress', 'В процессе'); statusMod = 'progress'; }

            const tier = isGold ? 'gold' : 'silver';
            let starsHtml = `<div class="mc-deck-card__stars">`;
            for (let i = 0; i < 5; i++) {
                const on = i < starCount;
                starsHtml += `<span class="material-symbols-outlined mc-star mc-star--${tier} ${on ? 'mc-star--on' : 'mc-star--off'}">star</span>`;
            }
            starsHtml += `<span class="mc-deck-card__status mc-deck-card__status--${statusMod}">${statusIcon ? `<span class="material-symbols-outlined">${statusIcon}</span>` : ''}${escHtml(statusText)}</span>`;
            starsHtml += `</div>`;

            // Description + tags live in a collapsible overlay panel (collapsed by default), so
            // every card stays the same compact height. Expanding drops the panel down over the
            // cards below (absolute → no grid reflow).
            const descTrim = (deck.description || '').trim();
            const hasDetails = !!descTrim || !!tagsHtml;
            const detailsHtml = hasDetails ? `
                <div class="mc-deck-card__details" onclick="event.stopPropagation()">
                    ${descTrim ? `<p class="mc-deck-card__desc">${escHtml(descTrim)}</p>` : ''}
                    ${tagsHtml ? `<div class="mc-deck-card__tags">${tagsHtml}</div>` : ''}
                </div>` : '';
            const detailsToggle = hasDetails
                ? `<button type="button" class="mc-deck-card__expand" aria-label="${t('microcards.btn_details', 'Подробнее')}" aria-expanded="false" onclick="event.stopPropagation(); mcApp.toggleCardDetails('${deck.id}', event)"><span class="material-symbols-outlined">expand_more</span></button>`
                : '';

            // Compact meta line under the title: author · (catalog marker).
            // The total card count now lives inside the workload badge (count / total).
            const linked = !!deck.linked;
            // Author: an owned deck falls back to "Вы"; a linked (catalog) deck must NEVER show
            // "Вы" — show the original author if known, else let "Из каталога" stand alone.
            const authorName = linked ? (deck.author_name || '') : (deck.author_name || t('microcards.author_you', 'Вы'));
            const authorHtml = authorName
                ? `<span class="mc-deck-card__metaitem"><span class="material-symbols-outlined">person</span><span class="mc-deck-card__metatext">${escHtml(authorName)}</span></span>`
                : '';
            // "Из каталога" is pushed to the far right of the meta line (margin-left:auto).
            const linkedHtml = linked
                ? `<span class="mc-deck-card__metaitem mc-deck-card__metaitem--right"><span class="material-symbols-outlined">link</span><span class="mc-deck-card__metatext">${t('microcards.badge_linked', 'Из каталога')}</span></span>`
                : '';
            const metaHtml = authorHtml + linkedHtml;

            // Per-card action menu (⋯, top-right). Linked decks are read-only → no edit, "remove from library".
            const menuItems = linked
                ? `<button class="mc-menu__item" role="menuitem" onclick="event.stopPropagation(); mcApp.exportDeckFromLibrary('${deck.id}','json')"><span class="material-symbols-outlined">download</span>${t('microcards.btn_menu_export_json', 'Экспорт JSON')}</button>
                   <button class="mc-menu__item" role="menuitem" onclick="event.stopPropagation(); mcApp.exportDeckFromLibrary('${deck.id}','csv')"><span class="material-symbols-outlined">download</span>${t('microcards.btn_menu_export_csv', 'Экспорт CSV')}</button>
                   <button class="mc-menu__item mc-menu__item--danger" role="menuitem" onclick="event.stopPropagation(); mcApp.deleteDeckFromLibrary('${deck.id}')"><span class="material-symbols-outlined">link_off</span>${t('microcards.btn_remove_from_library', 'Убрать из библиотеки')}</button>`
                : `<button class="mc-menu__item" role="menuitem" onclick="event.stopPropagation(); mcApp.editDeckFromLibrary('${deck.id}')"><span class="material-symbols-outlined">settings</span>${t('microcards.btn_deck_params', 'Параметры')}</button>
                   <button class="mc-menu__item" role="menuitem" onclick="event.stopPropagation(); mcApp.exportDeckFromLibrary('${deck.id}','json')"><span class="material-symbols-outlined">download</span>${t('microcards.btn_menu_export_json', 'Экспорт JSON')}</button>
                   <button class="mc-menu__item" role="menuitem" onclick="event.stopPropagation(); mcApp.exportDeckFromLibrary('${deck.id}','csv')"><span class="material-symbols-outlined">download</span>${t('microcards.btn_menu_export_csv', 'Экспорт CSV')}</button>
                   <button class="mc-menu__item mc-menu__item--danger" role="menuitem" onclick="event.stopPropagation(); mcApp.deleteDeckFromLibrary('${deck.id}')"><span class="material-symbols-outlined">delete</span>${t('microcards.btn_menu_delete_deck', 'Удалить колоду')}</button>`;

            // Per-deck accent → thin left spine (identity colour without a focal-competing tile).
            card.style.setProperty('--deck-accent', `hsl(${deckHue(deck.name || deck.id)} 58% 48%)`);
            const studyBtnText = deck.is_paused ? t('microcards.btn_continue', 'Продолжить') : t('microcards.btn_study', 'Учить');
            const studyBtnIcon = deck.is_paused ? 'play_arrow' : 'school';
            card.innerHTML = `
                <div class="mc-deck-card__head">
                    <h3 class="mc-deck-card__title">${escHtml(deck.name)}</h3>
                    <div class="mc-deck-card__headctl">
                        ${detailsToggle}
                        <div class="mc-card-menu-wrap">
                            <button type="button" class="mc-iconbtn" aria-haspopup="menu" aria-label="${t('microcards.btn_more', 'Ещё')}" onclick="event.stopPropagation(); mcApp.toggleCardMenu('${deck.id}', event)">
                                <span class="material-symbols-outlined">more_horiz</span>
                            </button>
                            <div class="mc-menu mc-card-menu hidden" id="cardMenu-${deck.id}" role="menu">${menuItems}</div>
                        </div>
                    </div>
                </div>
                <p class="mc-deck-card__meta">${metaHtml}</p>
                <div class="mc-deck-card__prog">
                    ${starsHtml}
                    <div class="mc-deck-card__mastery ${masteryPct >= 100 ? 'is-full' : ''}" title="${t('microcards.stat_mastered', 'Освоено')}: ${masteryPct}%" aria-label="${t('microcards.stat_mastered', 'Освоено')}: ${masteryPct}%">
                        <span style="width:${masteryPct}%"></span>
                    </div>
                </div>
                <div class="mc-deck-card__action">
                    ${workloadHtml}
                    <button type="button" class="mc-btn mc-btn--primary mc-deck-card__study" onclick="event.stopPropagation(); mcApp.studyDeckFromLibrary('${deck.id}')">
                        <span class="material-symbols-outlined">${studyBtnIcon}</span><span>${studyBtnText}</span>
                    </button>
                </div>
                ${detailsHtml}
            `;
            grid.appendChild(card);
        });
        state._entrance = false; // entrance is a one-shot per fresh load
    }

    // ── Per-card actions (library) ─────────────────────────────────────────
    // The action menu items reuse the existing deck-detail logic, which keys off
    // state.activeDeck / state.activeDeckId — so we hydrate those from the library
    // list before delegating.
    function _setActiveDeckFromLibrary(deckId) {
        const deck = state.decks.find(d => d.id === deckId);
        if (deck) { state.activeDeck = deck; state.activeDeckId = deckId; }
        return deck;
    }
    async function studyDeckFromLibrary(deckId) {
        const deck = state.decks.find(d => d.id === deckId);
        if (deck && deck.is_paused) {
            state.activeDeckId = deckId;
            state.activeDeck = deck;
            try {
                const cardsData = await apiCall(`/api/v2/microcards/decks/${deckId}/cards`);
                state.cards = cardsData.items || [];
                resumeDeckSession(deck);
            } catch (err) {
                console.error('[studyDeckFromLibrary] resume error:', err);
                showToast(t('microcards.error_loading_cards', 'Не удалось загрузить карточки'), 'error');
            }
        } else {
            openDeckDetails(deckId);
        }
    }
    function editDeckFromLibrary(deckId) { closeAllCardMenus(); if (_setActiveDeckFromLibrary(deckId)) openDeckMetaDialog(); }
    function exportDeckFromLibrary(deckId, format) { closeAllCardMenus(); _setActiveDeckFromLibrary(deckId); exportDeck(format); }
    function deleteDeckFromLibrary(deckId) { closeAllCardMenus(); if (_setActiveDeckFromLibrary(deckId)) confirmDeleteDeck(); }

    function closeAllCardMenus() {
        document.querySelectorAll('.mc-card-menu').forEach(m => m.classList.add('hidden'));
        // The card clips overflow; it's lifted only while its menu is open.
        document.querySelectorAll('.mc-deck-card--menu-open').forEach(c => c.classList.remove('mc-deck-card--menu-open'));
    }
    function toggleCardMenu(deckId, e) {
        if (e) e.stopPropagation();
        const menu = document.getElementById('cardMenu-' + deckId);
        if (!menu) return;
        const willOpen = menu.classList.contains('hidden');
        closeAllCardMenus();
        if (willOpen) {
            menu.classList.remove('hidden');
            const card = menu.closest('.mc-deck-card');
            if (card) card.classList.add('mc-deck-card--menu-open');  // let the dropdown spill past the card edge
        }
    }

    // Expand/collapse a card's details panel (description + tags). The panel is absolute,
    // so expanding overlays the cards below instead of reflowing the grid row.
    function closeAllCardDetails() {
        document.querySelectorAll('.mc-deck-card.is-expanded').forEach(c => {
            c.classList.remove('is-expanded');
            const b = c.querySelector('.mc-deck-card__expand');
            if (b) b.setAttribute('aria-expanded', 'false');
        });
    }
    function toggleCardDetails(deckId, e) {
        if (e) e.stopPropagation();
        const card = e && e.currentTarget && e.currentTarget.closest('.mc-deck-card');
        if (!card) return;
        const willExpand = !card.classList.contains('is-expanded');
        closeAllCardDetails();
        closeAllCardMenus();
        if (willExpand) {
            card.classList.add('is-expanded');
            const b = card.querySelector('.mc-deck-card__expand');
            if (b) b.setAttribute('aria-expanded', 'true');
        }
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

    // ── Analytics widgets (streak / retention / overdue) ──────────────────
    async function loadAnalytics() {
        try {
            const data = await apiCall('/api/v2/microcards/analytics');
            renderAnalytics(data);
        } catch (err) {
            if ($('mcKpis')) $('mcKpis').style.display = 'none';
        }
    }
    function renderAnalytics(data) {
        data = data || {};
        $('anStreak').textContent = data.streak || 0;
        $('anRetention').textContent = data.retention || 0;
        $('anOverdue').textContent = data.overdue || 0;
        renderGoalKpi(data);
        const hasActivity = (data.total_reviews || 0) > 0 || (data.streak || 0) > 0 || (data.overdue || 0) > 0;
        $('mcKpis').style.display = hasActivity ? 'flex' : 'none';
    }

    // Study settings (session size, new-card pacing, direction) are no longer
    // user-configurable — every deck uses the universal defaults from the backend
    // (see MicrocardsServiceV2.DEFAULT_SETTINGS). state.settings is still hydrated
    // read-only on load so the details page can show the per-session card count.
    function bindLibraryDelegates() {
        const tf = $('libTagFilters');
        if (tf) tf.addEventListener('click', (e) => {
            const b = e.target.closest('.mc-tag-chip[data-tag]');
            if (b) selectTagFilter(b.getAttribute('data-tag') || null);
        });
    }

    function openCreateDeckDialog() {
        $('createDeckName').value = '';
        $('createDeckDesc').value = '';
        openDialog('dialogCreateDeck');
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
            closeDialog('dialogCreateDeck');
            showToast(t('microcards.toast_deck_created', 'Колода успешно создана!'), 'success');
            openDeckDetails(result.deck.id);
        } catch (err) {
            console.error(err);
        }
    }

    // ── Deck Details Screen ───────────────────────────────────────────────
    async function openDeckDetails(deckId) {
        state.activeDeckId = deckId;
        // Reset cards immediately so stale data from previous deck never bleeds through.
        state.cards = [];
        switchView('details');
        
        try {
            const data = await apiCall(`/api/v2/microcards/decks/${deckId}`);
            state.activeDeck = data.deck;
            
            // Set details fields (some are optional depending on the header layout)
            const titleEl = $('deckDetailsTitle');
            if (titleEl) titleEl.textContent = state.activeDeck.name;
            const descEl = $('deckDetailsDesc');
            if (descEl) {
                const descText = (state.activeDeck.description || '').trim();
                descEl.textContent = descText;
                descEl.classList.toggle('hidden', !descText);
            }

            // Render tags
            const tagsZone = $('deckDetailsTags');
            if (tagsZone) {
                tagsZone.innerHTML = '';
                (state.activeDeck.tags || []).forEach(t => {
                    const badge = document.createElement('span');
                    badge.className = 'mc-tag';
                    badge.textContent = t;
                    tagsZone.appendChild(badge);
                });
            }

            renderPublishStatus();

            // Linked (catalog-referenced) deck = read-only: hide edit/import/publish,
            // turn "delete" into "remove from library", show a read-only badge.
            const linked = !!state.activeDeck.linked;
            ['btnDeckEditor', 'btnDeckImport', 'btnDeckPublish', 'btnAddCardInline', 'btnRenameDeck'].forEach(id => {
                const el = $(id); if (el) el.classList.toggle('hidden', linked);
            });
            const delLabel = $('btnDeckDeleteLabel');
            if (delLabel) delLabel.textContent = linked
                ? t('microcards.btn_remove_from_library', 'Убрать из библиотеки')
                : t('microcards.btn_menu_delete_deck', 'Удалить колоду');
            const pub = $('deckPublishStatus');
            if (linked && pub) pub.innerHTML = `<span class="mc-pub-pill mc-pub--code"><span class="material-symbols-outlined">link</span>${t('microcards.linked_readonly', 'Из каталога · только чтение')}</span>`;
        } catch (err) {
            console.error('[openDeckDetails] deck load error:', err);
            showToast(t('microcards.error_loading_deck', 'Не удалось загрузить колоду'), 'error');
            return;
        }

        try {
            // Fetch per-deck record from server (ensure freshest data even if serverRecords is stale)
            const recData = await apiCall(`/api/v2/microcards/records/${deckId}`).catch(() => null);
            if (recData && recData.record) {
                state.serverRecords[deckId] = recData.record;
            }

            // Load cards
            const cardsData = await apiCall(`/api/v2/microcards/decks/${deckId}/cards`);
            state.cards = cardsData.items || [];
        } catch (err) {
            console.error('[openDeckDetails] cards load error:', err);
            showToast(t('microcards.error_loading_cards', 'Не удалось загрузить карточки'), 'error');
        }

        updateDeckProgressUI();
        renderDeckCardsList();

        // Render paused status badge next to title
        const pausedStatusEl = $('deckPausedStatus');
        if (pausedStatusEl) {
            if (state.activeDeck && state.activeDeck.is_paused) {
                pausedStatusEl.innerHTML = `<span class="mc-pub-pill" style="background:color-mix(in srgb, var(--color-warning) 14%, transparent); color:var(--color-warning); border:1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); display:inline-flex; align-items:center; gap:0.25rem;"><span class="material-symbols-outlined" style="font-size:0.95rem;">pause_circle</span><span>${t('microcards.badge_paused', 'На паузе')}</span></span>`;
            } else {
                pausedStatusEl.innerHTML = '';
            }
        }

        // Header CTA = Повторение (the daily SRS habit); reflect an active one.
        const studyCta = document.querySelector('.mc-dhead__cta');
        if (studyCta) {
            const slots = (state.activeDeck && state.activeDeck.active_sessions) || {};
            const studyIcon = studyCta.querySelector('.material-symbols-outlined');
            const studyText = studyCta.querySelector('[data-i18n="microcards.btn_review_mode"]') || studyCta.querySelector('span:not(.material-symbols-outlined):not(.mc-btn__count)');

            studyCta.removeAttribute('onclick');
            if (slots.review) {
                if (studyIcon) studyIcon.textContent = 'play_arrow';
                if (studyText) {
                    studyText.textContent = t('microcards.btn_continue_review', 'Продолжить повторение');
                    studyText.removeAttribute('data-i18n'); // prevent i18n override
                }
            } else {
                if (studyIcon) studyIcon.textContent = 'school';
                if (studyText) {
                    studyText.textContent = t('microcards.btn_review_mode', 'Повторение');
                    studyText.setAttribute('data-i18n', 'microcards.btn_review_mode');
                }
            }
            studyCta.onclick = () => { startReview(); };
        }

        // Resume banner: an interrupted RUN is the long-lived object worth a banner.
        const resumeSection = $('deckResumeSection');
        if (resumeSection) {
            const slots = (state.activeDeck && state.activeDeck.active_sessions) || {};
            const runSlot = slots.run_l1 ? { ...slots.run_l1, level: 1 } : (slots.run_l2 ? { ...slots.run_l2, level: 2 } : null);
            if (runSlot) {
                resumeSection.classList.remove('hidden');
                const progressEl = $('deckResumeProgress');
                if (progressEl) progressEl.textContent = `${runSlot.mastered}/${runSlot.unique_total}`;
                const levelEl = $('deckResumeLevel');
                if (levelEl) {
                    levelEl.textContent = runSlot.level === 2
                        ? t('microcards.run_indicator_l2', 'Прохождение · Уровень 2')
                        : t('microcards.run_indicator_l1', 'Прохождение · Уровень 1');
                }

                // Wire up the button clicks
                $('btnResumeSession').onclick = () => { startRun(runSlot.level); };
                $('btnRestartSession').onclick = () => { confirmResetRun(runSlot.level, true); };
            } else {
                resumeSection.classList.add('hidden');
            }
        }
    }

    // Reset a run (with an honest confirm showing how much progress is lost);
    // optionally start a fresh one right away.
    function confirmResetRun(level, startAfter = false) {
        const slots = (state.activeDeck && state.activeDeck.active_sessions) || {};
        const runSlot = level === 2 ? slots.run_l2 : slots.run_l1;
        const progress = runSlot ? `${runSlot.mastered}/${runSlot.unique_total}` : '';
        const msg = t('microcards.confirm_reset_run', 'Сбросить прогон {p}? Прогресс прогона будет потерян.')
            .replace('{p}', progress);
        if (!confirm(msg)) return;
        if (startAfter) {
            startRun(level, true);
        } else if (runSlot && runSlot.session_id) {
            apiCall(`/api/v2/microcards/session/${runSlot.session_id}/discard`, { method: 'POST' })
                .then(() => openDeckDetails(state.activeDeckId))
                .catch((e) => console.error('[resetRun]', e));
        }
    }


    // Recompute the metric strip, mastery bar, study-load CTA and meta line.
    function updateDeckProgressUI() {
        const now = Date.now();
        let nw = 0, learning = 0, mastered = 0, due = 0;
        state.cards.forEach(c => {
            if (c.is_new) nw++;
            else if ((c.level || 0) >= 2) mastered++;
            else learning++;
            if (!c.is_new && c.due_at && new Date(c.due_at).getTime() <= now) due++;
        });
        const total = state.cards.length;
        const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };

        // Stat tiles
        set('statDue', due);
        set('statNew', nw);
        set('statMastered', total ? Math.round((mastered / total) * 100) + '%' : '0%');
        set('statTotal', total);
        set('deckCardsCountBadge', total);

        // Segmented mastery bar (new → learning → mastered)
        const pct = n => total ? (n / total) * 100 : 0;
        const seg = (id, n) => { const e = $(id); if (e) e.style.width = pct(n) + '%'; };
        seg('segNew', nw);
        seg('segLearn', learning);
        seg('segMaster', mastered);

        // The Повторение CTA shows today's study load (due + new). The run cards
        // don't carry it — a run always covers the whole deck.
        const load = due + nw;
        const headChip = $('headStudyCount');
        if (headChip) { headChip.textContent = load; headChip.classList.toggle('hidden', load === 0); }
        const l1Chip = $('btnStudyCount');
        if (l1Chip) l1Chip.classList.add('hidden');

        // Header meta keeps only the author (for someone else's deck) + tags; counts
        // now live in the metric strip. Publish status moved inline next to the title.
        const loadEl = $('deckLoadLine');
        if (loadEl) loadEl.textContent = (state.activeDeck && state.activeDeck.author_name) || '';
        // Collapse the meta row entirely when there's nothing to show (no wasted line).
        const metaEl = $('deckDetailsMeta');
        if (metaEl) {
            const hasAuthor = !!(loadEl && loadEl.textContent.trim());
            const tagsEl = $('deckDetailsTags');
            const hasTags = !!(tagsEl && tagsEl.children.length > 0);
            metaEl.classList.toggle('hidden', !hasAuthor && !hasTags);
        }

        // Render best-run records and stars for L1 and L2
        const records = getDeckRecord(state.activeDeckId);

        // The "perfect run" ceiling covers the WHOLE deck (runs = full passes).
        const threshold = Math.max(3, Math.min(8, Math.floor(total * 0.15)));
        const maxPointsL1 = calculateMaxPossiblePoints(total, threshold, 1);
        const maxPointsL2 = calculateMaxPossiblePoints(total, threshold, 2);

        const detailsScoreL1 = $('detailsScoreL1');
        const detailsMaxPointsL1 = $('detailsMaxPointsL1');
        const detailsScoreL2 = $('detailsScoreL2');
        const detailsMaxPointsL2 = $('detailsMaxPointsL2');

        if (detailsScoreL1) detailsScoreL1.textContent = records.scoreL1;
        if (detailsMaxPointsL1) detailsMaxPointsL1.textContent = maxPointsL1;
        if (detailsScoreL2) detailsScoreL2.textContent = records.scoreL2;
        if (detailsMaxPointsL2) detailsMaxPointsL2.textContent = maxPointsL2;

        // Deck size the record was earned on (deck may have grown since).
        const sizeFmt = (n) => n > 0 ? t('microcards.record_size', '· {n} карт.').replace('{n}', n) : '';
        const sizeL1El = $('detailsSizeL1');
        if (sizeL1El) sizeL1El.textContent = sizeFmt(records.sizeL1);
        const sizeL2El = $('detailsSizeL2');
        if (sizeL2El) sizeL2El.textContent = sizeFmt(records.sizeL2);

        // Active run status inside the level cards.
        const slots = (state.activeDeck && state.activeDeck.active_sessions) || {};
        const renderRunStatus = (el, slot, level) => {
            if (!el) return;
            if (!slot) { el.classList.add('hidden'); el.innerHTML = ''; return; }
            el.classList.remove('hidden');
            el.innerHTML = `
                <span class="mc-run-status__label">${t('microcards.run_in_progress', 'Прогон:')} <strong>${slot.mastered}/${slot.unique_total}</strong></span>
                <button type="button" class="mc-btn mc-btn--primary" onclick="event.stopPropagation(); mcApp.startRun(${level})">
                    <span class="material-symbols-outlined" style="font-size:0.95rem">play_arrow</span>${t('microcards.btn_resume', 'Продолжить')}
                </button>
                <button type="button" class="mc-btn mc-btn--ghost" onclick="event.stopPropagation(); mcApp.confirmResetRun(${level})">
                    ${t('microcards.btn_reset_run', 'Сбросить')}
                </button>`;
        };
        renderRunStatus($('runStatusL1'), slots.run_l1, 1);
        renderRunStatus($('runStatusL2'), slots.run_l2, 2);

        // Render stars L1 (silver)
        const starsL1Container = $('detailsStarsL1');
        if (starsL1Container) {
            starsL1Container.innerHTML = '';
            for (let i = 0; i < 5; i++) {
                const active = i < records.starsL1;
                const starSpan = document.createElement('span');
                starSpan.className = `material-symbols-outlined${active ? ' is-on' : ''}`;
                if (active) {
                    starSpan.style.cssText = `font-size:1.4rem;`;
                } else {
                    starSpan.style.cssText = `font-size:1.4rem; font-variation-settings:'FILL' 0; color:var(--color-border-strong); opacity:0.35;`;
                }
                starSpan.textContent = 'star';
                starsL1Container.appendChild(starSpan);
            }
        }

        // Render stars L2 (gold)
        const starsL2Container = $('detailsStarsL2');
        if (starsL2Container) {
            starsL2Container.innerHTML = '';
            for (let i = 0; i < 5; i++) {
                const active = i < records.starsL2;
                const starSpan = document.createElement('span');
                starSpan.className = `material-symbols-outlined${active ? ' is-on' : ''}`;
                if (active) {
                    starSpan.style.cssText = `font-size:1.4rem;`;
                } else {
                    starSpan.style.cssText = `font-size:1.4rem; font-variation-settings:'FILL' 0; color:var(--color-border-strong); opacity:0.35;`;
                }
                starSpan.textContent = 'star';
                starsL2Container.appendChild(starSpan);
            }
        }

        // Lock/Unlock L2 card: gate = a completed full-deck L1 run
        const cardL2 = $('cardStudyL2');
        const lockNoticeL2 = $('lockNoticeL2');
        const statsL2Container = $('statsL2Container');
        const isL2Unlocked = isDeckL2Unlocked();

        if (cardL2) {
            if (isL2Unlocked) {
                cardL2.classList.remove('is-locked');
                cardL2.style.pointerEvents = 'auto';
                if (lockNoticeL2) lockNoticeL2.classList.add('hidden');
                if (statsL2Container) statsL2Container.classList.remove('hidden');
            } else {
                cardL2.classList.add('is-locked');
                cardL2.style.pointerEvents = 'none';
                if (lockNoticeL2) lockNoticeL2.classList.remove('hidden');
                if (statsL2Container) statsL2Container.classList.add('hidden');
            }
        }
    }

    // Read-only row for linked (catalog-referenced) decks — display only, no editing.
    function cardDisplayRowHTML(card) {
        const hintHtml = card.hint ? `<p class="mc-cardrow__hint">${t('microcards.hint_label', 'Подсказка')}: ${escHtml(card.hint)}</p>` : '';
        return `<div class="mc-cardrow mc-cardrow--locked" onclick="mcApp.notifyReadonlyCard()" title="${escHtml(t('microcards.readonly_card_title', 'Только чтение — карточка из каталога'))}">
            <div style="min-width:0;flex:1">
                <p class="mc-cardrow__front">${escHtml(card.front.text)}</p>
                <p class="mc-cardrow__back">${escHtml(card.back.text)}</p>
                ${hintHtml}
            </div>
            <div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0">
                <span class="mc-level-chip">${t('microcards.level_badge', 'Уровень {n}').replace('{n}', card.level || 1)}</span>
                <span class="material-symbols-outlined mc-cardrow__lock">lock</span>
            </div>
        </div>`;
    }

    // Linked (catalog) decks are read-only references — explain on click.
    function notifyReadonlyCard() {
        showToast(t('microcards.readonly_card_note', 'Карточки из каталога нельзя редактировать — это ссылка на колоду автора.'), 'info');
    }

    function renderDeckCardsList() {
        const container = $('deckCardsListContainer');
        const readOnly = !!(state.activeDeck && (state.activeDeck.read_only || state.activeDeck.linked));

        // Drop selections that no longer correspond to a card (or to this deck).
        const liveIds = new Set(state.cards.map(c => c.id));
        state.selectedCards.forEach(id => { if (!liveIds.has(id)) state.selectedCards.delete(id); });
        updateBulkBar();
        // Linked decks are read-only — no selection affordances at all.
        const selectAllBtn = $('btnSelectAllCards');
        if (selectAllBtn) selectAllBtn.classList.toggle('hidden', readOnly || state.cards.length === 0);

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

    // ── Bulk selection & delete with undo (editor pattern) ─────────────────
    function toggleCardSelect(el) {
        const id = el.getAttribute('data-select-id');
        if (!id) return;
        if (el.checked) state.selectedCards.add(id);
        else state.selectedCards.delete(id);
        updateBulkBar();
    }

    function updateBulkBar() {
        const bar = $('bulkCardsBar');
        if (!bar) return;
        const n = state.selectedCards.size;
        bar.classList.toggle('hidden', n === 0);
        const count = $('bulkSelectedCount');
        if (count) count.textContent = t('microcards.bulk_selected', 'Выбрано: {n}').replace('{n}', n);
        // The "select all" toggle is always visible next to the count badge.
        const allBtn = $('btnSelectAllCards');
        if (allBtn) {
            const total = state.cards.filter(c => c.id).length;
            const all = total > 0 && n >= total;
            allBtn.textContent = all
                ? t('microcards.btn_clear_selection', 'Снять выбор')
                : t('microcards.btn_select_all', 'Выбрать все');
        }
    }

    function toggleSelectAllCards() {
        const ids = state.cards.filter(c => c.id).map(c => c.id);
        const all = ids.length > 0 && state.selectedCards.size >= ids.length;
        state.selectedCards = all ? new Set() : new Set(ids);
        document.querySelectorAll('#deckCardsListContainer .mc-card-select').forEach(cb => {
            cb.checked = state.selectedCards.has(cb.getAttribute('data-select-id'));
        });
        updateBulkBar();
    }

    // Toast with a single action button (used for undo).
    function showActionToast(msg, actionLabel, onAction, duration = 7000) {
        const container = $('mcToastContainer');
        if (!container) return;
        const el = document.createElement('div');
        el.className = 'mc-toast mc-toast--info';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '0.7rem';
        const text = document.createElement('span');
        text.textContent = msg;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = actionLabel;
        btn.style.cssText = 'background:transparent;border:0;color:var(--color-primary);font-weight:800;cursor:pointer;padding:0;font-size:inherit;text-transform:uppercase';
        btn.addEventListener('click', () => { el.remove(); onAction(); });
        el.appendChild(text);
        el.appendChild(btn);
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, duration);
    }

    async function _refreshDeckCards() {
        try {
            const cardsData = await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards`);
            state.cards = cardsData.items || [];
        } catch (e) { console.error(e); }
        renderDeckCardsList();
        updateDeckProgressUI();
    }

    async function bulkDeleteSelected() {
        const ids = Array.from(state.selectedCards);
        if (!ids.length) return;
        try {
            const result = await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/cards/bulk-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ card_ids: ids })
            });
            const deleted = result.deleted || [];
            state.selectedCards = new Set();
            const deckId = state.activeDeckId;
            await _refreshDeckCards();
            showActionToast(
                t('microcards.toast_bulk_deleted', 'Удалено карточек: {n}').replace('{n}', deleted.length),
                t('microcards.btn_undo', 'Отменить'),
                async () => {
                    // Same ids go back to the same positions — review progress
                    // (states were never touched) re-attaches automatically.
                    try {
                        await apiCall(`/api/v2/microcards/decks/${deckId}/cards/bulk-restore`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ entries: deleted })
                        });
                        if (state.activeDeckId === deckId) await _refreshDeckCards();
                        showToast(t('microcards.toast_bulk_restored', 'Карточки восстановлены'), 'success');
                    } catch (e) { console.error(e); }
                }
            );
        } catch (err) {
            console.error(err);
        }
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
        const frontAttr = (card.front && card.front.image_attribution) || null;
        const backAttr = (card.back && card.back.image_attribution) || null;
        const openCls = opts.open ? ' open' : '';

        return `
        <div class="mc-card-item rounded-xl border border-border-subtle bg-surface-1${openCls}" data-card-id="${card.id || ''}" data-front-image="${escHtml(frontImg)}" data-back-image="${escHtml(backImg)}" data-front-attr="${escHtml(JSON.stringify(frontAttr))}" data-back-attr="${escHtml(JSON.stringify(backAttr))}">
            <div class="mc-card-head flex items-center gap-3 p-3 cursor-pointer select-none" onclick="mcApp.toggleCardExpand(this)">
                ${isNew ? '' : `<input type="checkbox" class="mc-card-select" data-select-id="${card.id}" ${state.selectedCards.has(card.id) ? 'checked' : ''} onclick="event.stopPropagation(); mcApp.toggleCardSelect(this)" aria-label="Выбрать карточку" />`}
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
                        <div class="mc-img-field" data-side="front">${cardImageFieldInner('front', frontImg, frontAttr)}</div>
                        <div class="mc-img-field" data-side="back">${cardImageFieldInner('back', backImg, backAttr)}</div>
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
            front_image_url: item.dataset.frontImage || null,
            back_image_url: item.dataset.backImage || null,
            front_image_attribution: _parseAttr(item.dataset.frontAttr),
            back_image_attribution: _parseAttr(item.dataset.backAttr)
        };
    }

    // ── Card image field + Openverse/Wikimedia image picker ───────────────
    function _parseAttr(raw) {
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function attributionHTML(attr) {
        if (!attr) return '';
        const author = attr.author ? escHtml(attr.author) : '';
        const lic = attr.license ? escHtml(attr.license) : '';
        const src = attr.source_page
            ? `<a href="${escHtml(attr.source_page)}" target="_blank" rel="noopener noreferrer" class="underline">${t('microcards.img_source', 'источник')}</a>`
            : '';
        const parts = [author && `© ${author}`, lic, src].filter(Boolean);
        return parts.join(' · ');
    }

    // Inner HTML of one image field (preview + actions + attribution).
    function cardImageFieldInner(side, url, attr) {
        const has = !!url;
        const label = side === 'front'
            ? t('microcards.img_for_question', 'Картинка к вопросу')
            : t('microcards.img_for_answer', 'Картинка к ответу');
        const findLabel = has ? t('microcards.img_replace', 'Заменить') : t('microcards.img_find', 'Найти картинку');
        return `
            <span class="block text-[10px] font-bold text-text-secondary uppercase mb-1">${label}</span>
            <div class="mc-img-box">
                ${has ? `<img class="mc-img-thumb" src="${escHtml(url)}" alt="" loading="lazy" />` : ''}
                <div class="mc-img-controls">
                    <button type="button" class="mc-img-btn" onclick="mcApp.openImagePicker(this,'${side}')">
                        <span class="material-symbols-outlined text-[16px]">image_search</span>${findLabel}
                    </button>
                    ${has ? `<button type="button" class="mc-img-btn mc-img-btn--rm" onclick="mcApp.clearCardImage(this,'${side}')">
                        <span class="material-symbols-outlined text-[16px]">close</span>${t('microcards.img_remove', 'Убрать')}
                    </button>` : ''}
                </div>
            </div>
            ${has && attr ? `<div class="mc-img-attr text-[10px] text-text-secondary mt-1">${attributionHTML(attr)}</div>` : ''}`;
    }

    function renderCardImageField(item, side) {
        const field = item.querySelector(`.mc-img-field[data-side="${side}"]`);
        if (!field) return;
        const url = item.dataset[side + 'Image'] || '';
        const attr = _parseAttr(item.dataset[side + 'Attr']);
        field.innerHTML = cardImageFieldInner(side, url, attr);
    }

    function clearCardImage(btn, side) {
        const item = btn.closest('.mc-card-item');
        item.dataset[side + 'Image'] = '';
        item.dataset[side + 'Attr'] = 'null';
        renderCardImageField(item, side);
    }

    function openImagePicker(btn, side) {
        state.imgPicker = { item: btn.closest('.mc-card-item'), side, selected: null };
        $('imgPickerResults').innerHTML = '';
        $('imgPickerPreview').classList.add('hidden');
        $('imgPickerInsert').disabled = true;
        $('imgPickerStatus').textContent = '';
        const input = $('imgPickerQuery');
        input.value = '';
        // Seed the query from the card's question text for convenience.
        const front = state.imgPicker.item.querySelector('textarea[data-field="front"]');
        if (front && front.value.trim()) input.value = front.value.trim().slice(0, 60);
        openDialog('dialogImagePicker');
        input.focus();
        if (input.value) imgPickerSearch();
    }

    async function imgPickerSearch() {
        const q = $('imgPickerQuery').value.trim();
        if (!q) return;
        const results = $('imgPickerResults');
        const status = $('imgPickerStatus');
        status.textContent = t('microcards.img_searching', 'Поиск…');
        results.innerHTML = '';
        $('imgPickerPreview').classList.add('hidden');
        $('imgPickerInsert').disabled = true;
        try {
            const data = await apiCall(`/api/v2/microcards/image-search?q=${encodeURIComponent(q)}`);
            const items = data.results || [];
            if (!items.length) {
                status.textContent = t('microcards.img_none', 'Ничего не найдено');
                return;
            }
            status.textContent = '';
            results.innerHTML = items.map((r, i) => `
                <button type="button" class="mc-imgres" onclick="mcApp.imgPickerSelect(this)"
                    data-idx="${i}" title="${escHtml(r.title || '')}">
                    <img src="${escHtml(r.thumb)}" alt="${escHtml(r.title || '')}" loading="lazy" fetchpriority="low" referrerpolicy="no-referrer" />
                </button>`).join('');
            state.imgPicker.items = items;
        } catch (err) {
            status.textContent = t('microcards.img_search_failed', 'Поиск недоступен, попробуйте ещё раз');
        }
    }

    function imgPickerSelect(btn) {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const r = (state.imgPicker.items || [])[idx];
        if (!r) return;
        state.imgPicker.selected = r;
        document.querySelectorAll('.mc-imgres.is-selected').forEach(el => el.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        $('imgPickerPreviewImg').src = r.full;
        $('imgPickerPreviewImg').setAttribute('referrerpolicy', 'no-referrer');
        $('imgPickerPreviewAttr').innerHTML = attributionHTML(r.attribution);
        $('imgPickerPreview').classList.remove('hidden');
        $('imgPickerInsert').disabled = false;
    }

    async function imgPickerInsert() {
        const pick = state.imgPicker && state.imgPicker.selected;
        if (!pick) return;
        const insertBtn = $('imgPickerInsert');
        insertBtn.disabled = true;
        $('imgPickerStatus').textContent = t('microcards.img_importing', 'Сохранение…');
        try {
            const attr = pick.attribution || {};
            const res = await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/image-import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: pick.full, ...attr })
            });
            const { item, side } = state.imgPicker;
            item.dataset[side + 'Image'] = res.asset_url;
            item.dataset[side + 'Attr'] = JSON.stringify(res.attribution || attr || null);
            renderCardImageField(item, side);
            closeDialog('dialogImagePicker');
            showToast(t('microcards.img_added', 'Картинка добавлена'), 'success');
        } catch (err) {
            $('imgPickerStatus').textContent = t('microcards.img_import_failed', 'Не удалось сохранить картинку');
            insertBtn.disabled = false;
        }
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

    function openDeckMetaDialog() {
        if (!state.activeDeck) return;
        $('metaDeckName').value = state.activeDeck.name || '';
        $('metaDeckDesc').value = state.activeDeck.description || '';
        $('metaDeckTags').value = (state.activeDeck.tags || []).join(', ');
        const dirSel = $('metaDeckDirection');
        if (dirSel) {
            const dir = state.activeDeck.direction;
            dirSel.value = (dir === 'back_front' || dir === 'mixed') ? dir : 'front_back';
        }
        openDialog('dialogDeckMeta');
    }

    async function saveDeckMetaDialog(e) {
        if (e) e.preventDefault();
        const name = $('metaDeckName').value.trim();
        const description = $('metaDeckDesc').value.trim();
        const tags = $('metaDeckTags').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const dirSel = $('metaDeckDirection');
        const direction = dirSel ? dirSel.value : null;
        if (!name) {
            showToast(t('microcards.error_name_required', 'Название колоды обязательно'), 'error');
            return;
        }
        try {
            await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, tags, direction })
            });
            closeDialog('dialogDeckMeta');
            showToast(t('microcards.toast_deck_saved', 'Параметры колоды сохранены'), 'success');
            openDeckDetails(state.activeDeckId);
        } catch (err) {
            console.error(err);
        }
    }

    // ── Inline deck rename (pencil next to the title) ─────────────────────
    function startInlineRename() {
        const h1 = $('deckDetailsTitle');
        const input = $('deckTitleInput');
        if (!h1 || !input) return;
        input.value = (state.activeDeck && state.activeDeck.name) || h1.textContent || '';
        h1.classList.add('hidden');
        input.classList.remove('hidden');
        input.focus();
        input.select();
    }
    async function commitInlineRename(save) {
        const h1 = $('deckDetailsTitle');
        const input = $('deckTitleInput');
        if (!h1 || !input || input.classList.contains('hidden')) return; // already committed (e.g. Enter then blur)
        const newName = input.value.trim();
        const cur = (state.activeDeck && state.activeDeck.name) || '';
        // Swap back to the heading first so a failed/cancelled edit never leaves the field stuck open.
        input.classList.add('hidden');
        h1.classList.remove('hidden');
        if (!save || !newName || newName === cur) return; // cancelled / empty / unchanged
        try {
            await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName,
                    description: (state.activeDeck && state.activeDeck.description) || '',
                    tags: (state.activeDeck && state.activeDeck.tags) || []
                })
            });
            if (state.activeDeck) state.activeDeck.name = newName;
            h1.textContent = newName;
            showToast(t('microcards.toast_deck_saved', 'Параметры колоды сохранены'), 'success');
        } catch (err) { console.error(err); }
    }
    function onRenameKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); commitInlineRename(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commitInlineRename(false); }
    }

    function toggleDeckActionsMenu(e) {
        if (e) e.stopPropagation();
        const menu = $('deckActionsDropdown');
        if (menu.classList.contains('is-open')) {
            closeDropdown(menu);
        } else {
            openDropdown(menu);
        }
    }

    // Close actions dropdown + any open per-card menus / expanded details on outer click
    document.addEventListener('click', () => {
        closeDropdown($('deckActionsDropdown'));
        closeAllCardMenus();
        closeAllCardDetails();
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
                closeDialog('dialogConfirmDelete');
                showToast(t('microcards.toast_deck_deleted', 'Колода успешно удалена'), 'success');
                loadLibraryData();
            } catch (err) {
                console.error(err);
            }
        };
        openDialog('dialogConfirmDelete');
    }

    // ── Learning Session Screen ───────────────────────────────────────────
    // Mirror the server session into local state. The server owns the queue:
    // failed cards are re-inserted there by the mastery cycle, so every sync
    // can grow `sessionCards` (the same card may appear more than once).
    function syncSessionState(session) {
        state.session = session;
        state.sessionCards = (session.card_queue || []).map(id => state.cards.find(c => c.id === id)).filter(Boolean);
        state.sessionIndex = Math.min(session.cursor || 0, state.sessionCards.length);
        const stats = Object.assign(
            { unique_total: 0, mastered: 0, first_try_correct: 0, correct: 0, errors: 0, pending_retry: 0, error_card_ids: [] },
            session.stats || {}
        );
        // Sessions paused before the mastery-cycle schema lack the new counters.
        if (!stats.unique_total) stats.unique_total = new Set(session.card_queue || []).size;
        state.sessionStats = stats;
    }

    // Has this card already been attempted in the session (i.e. a re-presentation)?
    function isCardRetry(cardId) {
        const fr = state.session && state.session.first_results;
        return !!(fr && Object.prototype.hasOwnProperty.call(fr, cardId));
    }

    // Offline fallback: emulate the server's mastery cycle locally so the run
    // stays playable if an answer request fails mid-session.
    function advanceLocally(card, isCorrect) {
        state.sessionIndex++;
        const stats = state.sessionStats;
        if (isCorrect) {
            stats.correct++;
            stats.mastered = Math.min((stats.mastered || 0) + 1, stats.unique_total || 0);
            stats.pending_retry = Math.max(0, (stats.pending_retry || 0) - 1);
        } else {
            stats.errors++;
            stats.pending_retry = (stats.pending_retry || 0) + 1;
            if (!stats.error_card_ids.includes(card.id)) stats.error_card_ids.push(card.id);
            const insertAt = Math.min(state.sessionCards.length, state.sessionIndex + 2 + Math.floor(Math.random() * 3));
            state.sessionCards.splice(insertAt, 0, card);
        }
    }

    // Прохождение: the whole deck at one fixed level — the only way to earn
    // stars and records (finalized server-side via the finish endpoint).
    function startRun(level, forceRestart = false) {
        return _startSession({ mode: 'run', level_mode: level === 2 ? 2 : 1, resume: true, restart: !!forceRestart });
    }

    // Повторение: SRS-dosed daily session (due + new), points only.
    function startReview(forceRestart = false) {
        return _startSession({ mode: 'review', resume: true, restart: !!forceRestart });
    }

    // Resume whatever the deck has active (used by library cards): runs first.
    function resumeDeckSession(deck) {
        const slots = (deck && deck.active_sessions) || {};
        if (slots.run_l1) return startRun(1);
        if (slots.run_l2) return startRun(2);
        return startReview();
    }

    async function _startSession(body) {
        // Reset gamification for the new sitting
        state.combo = 0;
        state.maxCombo = 0;
        state.sessionXp = 0;
        lastXpValue = 0;
        const comboChip = $('comboChip');
        if (comboChip) comboChip.style.display = 'none';
        popNumber($('xpChipVal'), 0);
        switchView('session');

        try {
            state.isNearMiss = false;
            const data = await apiCall(`/api/v2/microcards/decks/${state.activeDeckId}/session/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            syncSessionState(data.session);
            state.sessionMode = data.session.mode || (data.session.level_mode ? 'run' : 'review');
            state.sessionLevelMode = data.session.level_mode === 2 ? 2 : (data.session.level_mode === 1 ? 1 : null);

            // Restore gamification state (pausing/resuming recovery)
            state.combo = data.session.combo || 0;
            state.maxCombo = data.session.max_combo || 0;
            state.sessionXp = data.session.session_xp || 0;
            lastXpValue = state.sessionXp;

            const unique = state.sessionStats.unique_total || 1;
            state.threshold = Math.max(3, Math.min(8, Math.floor(unique * 0.15)));
            // The "perfect run" ceiling only makes sense for runs (records).
            state.maxPossiblePoints = state.sessionMode === 'run'
                ? calculateMaxPossiblePoints(unique, state.threshold, state.sessionLevelMode === 2 ? 2 : 1)
                : 0;

            // Update gamification UI
            if (state.combo > 0) {
                showCombo();
            } else {
                if (comboChip) comboChip.style.display = 'none';
            }
            popNumber($('xpChipVal'), state.sessionXp);
            renderSessionLevelIndicator();
            renderCompositionChip();
            updateHeaderProgress();

            setupCurrentCard();
        } catch (err) {
            console.error('[startSession]', err);
            switchView('details');
        }
    }

    // «Повторение: 12 · Новых: 5» — the review session says what it picked.
    function renderCompositionChip() {
        const chip = $('mcCompositionChip');
        if (!chip) return;
        const comp = state.session && state.session.composition;
        if (state.sessionMode === 'review' && comp) {
            chip.textContent = t('microcards.composition_chip', 'К повторению: {d} · Новых: {n}')
                .replace('{d}', comp.due).replace('{n}', comp.new);
            chip.style.display = 'inline-flex';
        } else {
            chip.style.display = 'none';
        }
    }

    // Mode/form chip in the HUD. Runs are one level for the whole sitting;
    // reviews show the CURRENT card's form (adaptive difficulty).
    function renderSessionLevelIndicator(form = null) {
        const levelInd = $('sessionLevelIndicator');
        if (!levelInd) return;
        let text, accent;
        if (state.sessionMode === 'review') {
            const f = form === 2 ? 2 : 1;
            text = f === 1
                ? t('microcards.review_form_l1', 'Повторение · Знаю / Не знаю')
                : t('microcards.review_form_l2', 'Повторение · Ввод ответа');
            accent = f === 1 ? 'var(--color-warning)' : 'var(--color-success)';
        } else {
            const level = state.sessionLevelMode === 2 ? 2 : 1;
            text = level === 1
                ? t('microcards.run_indicator_l1', 'Прохождение · Уровень 1')
                : t('microcards.run_indicator_l2', 'Прохождение · Уровень 2');
            accent = level === 1 ? 'var(--color-warning)' : 'var(--color-success)';
        }
        levelInd.textContent = text;
        levelInd.className = 'mc-level-indicator';
        levelInd.style.background = `color-mix(in srgb, ${accent} 12%, transparent)`;
        levelInd.style.borderColor = `color-mix(in srgb, ${accent} 30%, transparent)`;
        levelInd.style.color = accent;
    }

    // Un-flip without playing the flip-back transition: the next card's content
    // is loaded onto the faces right after, so an animated un-flip would flash
    // the new card's answer mid-rotation.
    function resetFlipInstant(inner) {
        if (!inner || !inner.classList.contains('flipped')) return;
        inner.style.transition = 'none';
        inner.classList.remove('flipped');
        void inner.offsetWidth;
        inner.style.transition = '';
    }

    // Card→card entry slide: replay the .mc-card-enter animation on the wrap
    // (remove → reflow → re-add guarantees the replay).
    function playCardEnter(wrap) {
        if (!wrap) return;
        wrap.classList.remove('mc-card-enter');
        void wrap.offsetWidth;
        wrap.classList.add('mc-card-enter');
    }

    function setupCurrentCard() {
        // The server completes the session only when every card is mastered;
        // the local length check is the offline fallback.
        if ((state.session && state.session.completed) || state.sessionIndex >= state.sessionCards.length) {
            finishSession();
            return;
        }

        const card = state.sessionCards[state.sessionIndex];
        state.currentCard = card;
        state._gradeBusy = false;

        // Reset card face state
        resetFlipInstant($('flashcardInner'));
        const _wrap = $('mcFlashWrap');
        if (_wrap && (_wrap.classList.contains('mc-fly-yes') || _wrap.classList.contains('mc-fly-no'))) {
            // Reset the fly-off without animating the card back across the screen.
            _wrap.style.transition = 'none';
            _wrap.classList.remove('mc-fly-yes', 'mc-fly-no');
            void _wrap.offsetWidth;
            _wrap.style.transition = '';
        }
        playCardEnter(_wrap); // the new card slides in
        hideRails(); // rails reappear only after the answer is revealed
        
        // Effective direction (reverse mode): which side is the question vs answer
        const dir = (state.session && ((state.session.card_directions || {})[card.id] || state.session.direction)) || 'front_back';
        const qSide = dir === 'back_front' ? card.back : card.front;
        const aSide = dir === 'back_front' ? card.front : card.back;

        // Load text and images (question on front face, answer on back face)
        $('cardFrontText').textContent = qSide.text;
        $('cardBackText').textContent = aSide.text;

        // Long passages read better small/left-aligned than as a big centered banner.
        const LONG = 160;
        const fb = document.querySelector('.flashcard-front .mc-face__body');
        const bb = document.querySelector('.flashcard-back .mc-face__body');
        if (fb) fb.classList.toggle('mc-face__body--long', (qSide.text || '').length > LONG);
        if (bb) bb.classList.toggle('mc-face__body--long', (aSide.text || '').length > LONG);

        if (card.hint) {
            $('btnShowHint').classList.remove('hidden');
            $('cardHintText').classList.add('hidden');
            $('cardHintText').textContent = card.hint;
        } else {
            $('btnShowHint').classList.add('hidden');
            $('cardHintText').classList.add('hidden');
        }

        const frontImg = $('cardFrontImage');
        const frontCap = $('cardFrontImageAttr');
        if (qSide.image_url) {
            frontImg.src = qSide.image_url; frontImg.classList.remove('hidden');
            frontImg.onload = fitCardText; // refit once the image takes up space
            if (frontCap) { frontCap.innerHTML = attributionHTML(qSide.image_attribution); frontCap.classList.toggle('hidden', !qSide.image_attribution); }
        } else {
            frontImg.classList.add('hidden');
            if (frontCap) frontCap.classList.add('hidden');
        }

        const backImg = $('cardBackImage');
        const backCap = $('cardBackImageAttr');
        if (aSide.image_url) {
            backImg.src = aSide.image_url; backImg.classList.remove('hidden');
            backImg.onload = fitCardText;
            if (backCap) { backCap.innerHTML = attributionHTML(aSide.image_attribution); backCap.classList.toggle('hidden', !aSide.image_attribution); }
        } else {
            backImg.classList.add('hidden');
            if (backCap) backCap.classList.add('hidden');
        }

        // Runs fix one interaction level for the whole sitting; reviews use the
        // per-card form picked by the server (adaptive difficulty).
        const level = state.sessionMode === 'review'
            ? (((state.session && state.session.card_forms) || {})[card.id] === 2 ? 2 : 1)
            : (state.sessionLevelMode === 2 ? 2 : 1);
        state.currentForm = level;
        renderSessionLevelIndicator(level);

        // Repeat badge: this card came back through the mastery cycle.
        const retryBadge = $('mcRetryBadge');
        if (retryBadge) retryBadge.classList.toggle('hidden', !isCardRetry(card.id));

        // Reset UI actions
        state.currentLevel = level;
        const wrap = $('mcFlashWrap');
        if (level === 1) {
            $('frontActionsL1').classList.remove('hidden');
            $('frontActionsL2').classList.add('hidden');
            $('backActionsL1').classList.remove('hidden');
            $('backActionsL2').classList.add('hidden');
            // L1: whole card is the click target to reveal the answer.
            if (wrap) {
                wrap.classList.add('is-clickable');
                wrap.setAttribute('role', 'button');
                wrap.setAttribute('tabindex', '0');
                wrap.setAttribute('aria-label', t('microcards.tap_to_reveal', 'Нажмите на карточку, чтобы увидеть ответ'));
            }
        } else {
            $('frontActionsL1').classList.add('hidden');
            $('frontActionsL2').classList.remove('hidden');
            $('backActionsL1').classList.add('hidden');
            $('backActionsL2').classList.remove('hidden');
            $('inputL2Answer').value = '';
            $('inputL2Answer').focus();
            if (wrap) {
                wrap.classList.remove('is-clickable');
                wrap.removeAttribute('role');
                wrap.removeAttribute('tabindex');
                wrap.removeAttribute('aria-label');
            }
        }

        $('l2ComparisonZone').classList.add('hidden');
        $('btnL2Override').classList.add('hidden');

        updateHeaderProgress();
        // Fit the text to the card after layout settles (rAF for the common case,
        // a short timeout to catch the height cap applying during view transitions).
        requestAnimationFrame(fitCardText);
        setTimeout(fitCardText, 130);
    }

    // Shrink the question/answer font so the text fits the card instead of the
    // card growing tall or scrolling. Short cards keep the full size; long
    // passages step down to a readable floor.
    function fitCardText() {
        const inner = $('flashcardInner');
        if (!inner) return;
        inner.style.height = ''; // let the card auto-size (capped by max-block-size)
        const faces = ['front', 'back']
            .map(s => document.querySelector('.flashcard-' + s + ' .mc-face__body'))
            .filter(Boolean);
        faces.forEach(b => { const tt = b.querySelector('.mc-face__text'); if (tt) tt.style.fontSize = ''; });
        // If nothing overflows the (capped) card, the default size already fits.
        if (!faces.some(b => b.scrollHeight > b.clientHeight + 1)) return;
        // Pin the card at its capped height so shrinking text doesn't shrink the card.
        inner.style.height = inner.clientHeight + 'px';
        faces.forEach(b => {
            const textEl = b.querySelector('.mc-face__text');
            if (!textEl) return;
            let size = parseFloat(getComputedStyle(textEl).fontSize) || 19;
            let guard = 0;
            while (b.scrollHeight > b.clientHeight + 1 && size > 12 && guard < 80) {
                size -= 1;
                textEl.style.fontSize = size + 'px';
                guard++;
            }
        });
    }

    function toggleHint() {
        const hintText = $('cardHintText');
        // a revealed hint changes the card's content height — refit afterwards
        hintText.classList.toggle('hidden');
        requestAnimationFrame(fitCardText);
    }

    function revealAnswerL1() {
        $('flashcardInner').classList.add('flipped');
        DopamineAudio.playCardFlip();
        showRails(); // reveal the swipe-style grading rails (desktop)
    }

    // Whole-card click/keyboard toggle (L1 only): question ⇄ answer.
    const _CARD_INTERACTIVE = 'button, a, input, textarea, select, form, .mc-rail, .mc-grade__btn, .mc-hint-btn';
    function onCardActivate(e) {
        if (state.currentLevel !== 1) return;
        if (e.target.closest(_CARD_INTERACTIVE)) return; // let inner controls handle their own clicks
        const inner = $('flashcardInner');
        if (inner.classList.contains('flipped')) {
            inner.classList.remove('flipped'); // flip back to the question
            DopamineAudio.playCardFlip();
            hideRails();
        } else {
            revealAnswerL1();
        }
    }
    function onCardKey(e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        if (state.currentLevel !== 1) return;
        if (e.target.closest(_CARD_INTERACTIVE)) return;
        e.preventDefault();
        onCardActivate(e);
    }

    async function submitAnswerL1(know) {
        if (state._gradeBusy) return; // ignore double-press before the next card renders
        state._gradeBusy = true;
        const card = state.currentCard || state.sessionCards[state.sessionIndex];
        const ratingValue = know ? 'know' : 'dont_know';
        const isRetry = isCardRetry(card.id);

        hideRails(); // rails vanish + card un-leans as the answer is graded

        // Card flies off toward the chosen side (visible on all widths).
        const flyWrap = $('mcFlashWrap');
        if (flyWrap) {
            flyWrap.classList.add(know ? 'mc-fly-yes' : 'mc-fly-no');
            DopamineAudio.playCardSwipe(know);
        }

        // Immediate juicy feedback on the revealed card
        registerAnswer(know, isRetry, state.currentForm || 1);

        // The server applies the mastery cycle (advances the cursor and, on a
        // miss, re-queues the card a few positions ahead) — mirror its session.
        let synced = false;
        try {
            if (state.session) {
                const result = await apiCall(`/api/v2/microcards/session/${state.session.id}/answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ card_id: card.id, user_answer: ratingValue })
                });
                if (result && result.session) {
                    syncSessionState(result.session);
                    maybeCelebrateCardLevelUp(card, result.card_state);
                    synced = true;
                }
                if (result && result.card_missing) {
                    showToast(t('microcards.card_removed_skip', 'Карточка была удалена из колоды — пропускаем'), 'info');
                }
            }
        } catch (err) {
            console.error(err);
        }
        if (!synced) advanceLocally(card, know);

        updateHeaderProgress();

        // Let the feedback animation play before advancing
        setTimeout(() => {
            setupCurrentCard();
        }, know ? 640 : 780);
    }

    async function submitAnswerL2(e) {
        if (e) e.preventDefault();
        if (state._gradeBusy) return; // answer already graded — waiting for "Далее"
        state._gradeBusy = true;
        const card = state.currentCard || state.sessionCards[state.sessionIndex];
        const answer = $('inputL2Answer').value.trim();
        const isRetry = isCardRetry(card.id);

        try {
            let isCorrect = false;
            let expected = card.back.text;
            let synced = false;

            if (state.session) {
                const result = await apiCall(`/api/v2/microcards/session/${state.session.id}/answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ card_id: card.id, user_answer: answer })
                });
                if (result.card_missing) {
                    // The card vanished from the deck mid-session — the server
                    // healed the queue; skip ahead without grading anything.
                    if (result.session) syncSessionState(result.session);
                    showToast(t('microcards.card_removed_skip', 'Карточка была удалена из колоды — пропускаем'), 'info');
                    state._gradeBusy = false;
                    setupCurrentCard();
                    return;
                }
                isCorrect = result.is_correct;
                expected = result.expected_answer;
                if (result.session) {
                    syncSessionState(result.session);
                    maybeCelebrateCardLevelUp(card, result.card_state);
                    synced = true;
                }
            } else {
                // Offline fallback math
                isCorrect = answer.toLowerCase() === expected.toLowerCase();
            }
            if (!synced) advanceLocally(card, isCorrect);

            // Flip card and show details
            $('flashcardInner').classList.add('flipped');
            DopamineAudio.playCardFlip();
            $('l2ComparisonZone').classList.remove('hidden');
            $('l2UserAnswerDisplay').textContent = answer || t('microcards.empty_answer', '(пусто)');
            $('l2CorrectAnswerDisplay').textContent = expected;

            const badge = $('answerEvaluationBadge');
            badge.classList.remove('hidden');
            if (isCorrect) {
                badge.textContent = t('microcards.badge_correct', 'Верно');
                badge.className = 'mc-eval-badge';
                badge.style.cssText = 'background:color-mix(in srgb,var(--color-success) 15%,transparent);border-color:var(--color-success);color:var(--color-success)';
                $('btnL2Override').classList.add('hidden');
            } else {
                badge.textContent = t('microcards.badge_error', 'Ошибка');
                badge.className = 'mc-eval-badge';
                badge.style.cssText = 'background:color-mix(in srgb,var(--color-error) 15%,transparent);border-color:var(--color-error);color:var(--color-error)';
                $('btnL2Override').classList.remove('hidden');
            }

            // Combo / XP / feedback
            registerAnswer(isCorrect, isRetry, state.currentForm || 1);
            updateHeaderProgress();

        } catch (err) {
            console.error(err);
            state._gradeBusy = false; // grading didn't happen — let the user retry
        }
    }

    // Review-only micro celebration: the card just earned its typed-input form.
    function maybeCelebrateCardLevelUp(card, cardState) {
        if (!cardState || !card) return;
        const newLevel = cardState.level || 1;
        if (state.sessionMode === 'review' && newLevel >= 2 && (card.level || 0) < 2) {
            showToast(t('microcards.card_leveled_up', 'Карточка окрепла! Теперь она проверяется вводом ответа.'), 'success');
            DopamineAudio.playBoost();
        }
        card.level = newLevel;
    }

    async function overrideL2Answer() {
        const card = state.currentCard || state.sessionCards[state.sessionIndex];
        const answer = $('inputL2Answer').value.trim();

        try {
            if (state.session) {
                // The server undoes the wrong verdict: error count, the card's
                // first-try result and the re-queued copy are all rolled back.
                const result = await apiCall(`/api/v2/microcards/session/${state.session.id}/answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ card_id: card.id, user_answer: answer, override: true })
                });
                if (result && result.session) {
                    syncSessionState(result.session);
                }
            } else {
                const stats = state.sessionStats;
                stats.errors = Math.max(0, stats.errors - 1);
                stats.correct++;
                stats.pending_retry = Math.max(0, (stats.pending_retry || 0) - 1);
                stats.mastered = Math.min((stats.mastered || 0) + 1, stats.unique_total || 0);
                const idx = stats.error_card_ids.indexOf(card.id);
                if (idx !== -1) stats.error_card_ids.splice(idx, 1);
                // Pull back the copy advanceLocally queued for the wrong verdict.
                for (let i = state.sessionCards.length - 1; i >= state.sessionIndex; i--) {
                    if (state.sessionCards[i].id === card.id) { state.sessionCards.splice(i, 1); break; }
                }
            }

            // Update UI
            const badge = $('answerEvaluationBadge');
            badge.textContent = t('microcards.badge_overridden', 'Исправлено');
            badge.className = 'mc-eval-badge';
            badge.style.cssText = 'background:color-mix(in srgb,var(--color-warning) 15%,transparent);border-color:var(--color-warning);color:var(--color-warning)';
            $('btnL2Override').classList.add('hidden');

            // Reward the correction (full points — the verdict was wrong, not the user)
            registerAnswer(true, false, state.currentForm || 1);
            updateHeaderProgress();

        } catch (err) {
            console.error(err);
        }
    }

    function nextCard() {
        // The answer submit already advanced the position (server cursor sync,
        // or advanceLocally in the offline path) — just render it.
        setupCurrentCard();
    }

    function abortSession() {
        if (!state.session) {
            switchView('details');
            return;
        }
        // The exit dialog speaks the mode's language: a run rolls back to its
        // last checkpoint, a review is simply not saved.
        const isRun = state.sessionMode === 'run';
        const text = $('exitSessionText');
        if (text) {
            text.textContent = isRun
                ? t('microcards.dialog_exit_text_run', 'Пауза сохранит прогресс прогона (чекпойнт). «Выйти без сохранения» откатит прогон к последней паузе — текущий подход будет потерян.')
                : t('microcards.dialog_exit_text_review', 'Вы можете приостановить повторение и продолжить позже, либо завершить его без сохранения этого подхода.');
        }
        const discardLabel = $('btnDiscardAndExitLabel');
        if (discardLabel) {
            discardLabel.textContent = isRun
                ? t('microcards.btn_abandon_run', 'Выйти без сохранения')
                : t('microcards.btn_discard_review', 'Завершить без сохранения');
        }
        openDialog('dialogConfirmExitSession');
    }

    async function pauseLearningSession() {
        if (!state.session) return;
        try {
            await apiCall(`/api/v2/microcards/session/${state.session.id}/pause`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    combo: state.combo,
                    max_combo: state.maxCombo,
                    session_xp: state.sessionXp
                })
            });
            showToast(t('microcards.session_paused', 'Сессия приостановлена'), 'info');
        } catch (err) {
            console.error('Failed to pause session:', err);
            showToast(t('microcards.error_pausing_session', 'Не удалось приостановить сессию'), 'error');
        }
        if (state.activeDeckId) {
            openDeckDetails(state.activeDeckId);
        } else {
            switchView('library');
            loadLibraryData();
        }
    }

    // «Выйти без сохранения»: a run rolls back to its last pause checkpoint
    // (only the current sitting is lost); a never-paused run or a review is
    // simply discarded. The server decides which case applies.
    async function abandonLearningSession() {
        if (!state.session) return;
        try {
            const res = await apiCall(`/api/v2/microcards/session/${state.session.id}/abandon`, { method: 'POST' });
            if (res.restored) {
                showToast(t('microcards.run_rolled_back', 'Прогон откатился к последней паузе'), 'info');
            } else {
                showToast(t('microcards.session_discarded', 'Подход не сохранён'), 'info');
            }
        } catch (err) {
            console.error('Failed to abandon session:', err);
        }
        if (state.activeDeckId) {
            openDeckDetails(state.activeDeckId);
        } else {
            switchView('library');
            loadLibraryData();
        }
    }


    // ── Session Summary Screen ────────────────────────────────────────────
    // The mastery cycle guarantees the session ends at 100% completion, so the
    // headline metric is FIRST-TRY accuracy: how much was right without repeats.
    // Runs are finalized SERVER-side (stars, record, L2 gate) via /finish.
    async function finishSession() {
        switchView('summary');
        DopamineAudio.playSessionFinish();

        const stats = state.sessionStats || {};
        const total = stats.unique_total || 0;
        const firstTry = stats.first_try_correct || 0;
        const accuracy = total > 0 ? Math.round((firstTry / total) * 100) : 0;
        const reviewedIds = stats.error_card_ids || [];

        $('sumStatTotal').textContent = total;
        $('sumStatCorrect').textContent = firstTry;
        $('sumStatErrors').textContent = reviewedIds.length;

        // Finalize on the server (idempotent; only runs persist a record).
        let finishResult = null;
        if (state.session) {
            try {
                const res = await apiCall(`/api/v2/microcards/session/${state.session.id}/finish`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_xp: state.sessionXp, max_combo: state.maxCombo })
                });
                finishResult = res.result || null;
            } catch (err) {
                console.error('[finishSession]', err);
            }
        }

        // Gamified summary: accuracy ring, stars (runs), XP, best combo, message
        renderSummaryRewards(accuracy, finishResult);

        // Cards that needed extra rounds in the mastery cycle (informational —
        // they are already closed; the dedicated errors-replay mode is gone).
        const errorsList = $('summaryErrorsList');
        const errorsSection = $('summaryErrorsSection');
        errorsList.innerHTML = '';

        if (reviewedIds.length > 0) {
            errorsSection.classList.remove('hidden');
            reviewedIds.forEach(cardId => {
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
        if ((reviewedIds.length === 0 || accuracy >= 90) && fxAllowed() && window.CelebrationEffects) {
            try {
                window.CelebrationEffects.launchConfetti();
            } catch (e) {
                console.warn(e);
            }
        }
    }

    function renderSummaryRewards(accuracy, finishResult) {
        const isRun = state.sessionMode === 'run';

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

        // The "perfect run" ceiling only exists for runs.
        const maxWrap = $('sumMaxWrap');
        if (maxWrap) maxWrap.classList.toggle('hidden', !isRun);
        if ($('sumMaxXp')) $('sumMaxXp').textContent = state.maxPossiblePoints || 0;

        // Stars: runs only, computed server-side from first-try accuracy.
        const starCount = isRun && finishResult ? (finishResult.stars || 0) : 0;
        const stars = $('sumStars');
        if (stars) {
            stars.style.display = isRun ? '' : 'none';
            if (isRun) {
                if (state.sessionLevelMode === 2) {
                    stars.classList.remove('silver');
                    stars.classList.add('gold');
                } else {
                    stars.classList.remove('gold');
                    stars.classList.add('silver');
                }
                stars.querySelectorAll('.material-symbols-outlined').forEach((s, i) => s.classList.toggle('is-on', i < starCount));
                stars.classList.remove('is-revealed'); void stars.offsetWidth; stars.classList.add('is-revealed');
            }
        }

        // Record badge + caches (server already persisted the run record).
        const recordBadge = $('sumRecordBadge');
        const isNewRecord = !!(isRun && finishResult && finishResult.is_new_record && state.sessionXp > 0);
        if (recordBadge) recordBadge.classList.toggle('hidden', !isNewRecord);
        if (isRun && finishResult && finishResult.record && state.activeDeckId) {
            state.serverRecords[state.activeDeckId] = finishResult.record;
        }

        // L2 gate: opened by completing an L1 run (server decides).
        const unlockBanner = $('sumLevel2UnlockBanner');
        const goToL2Btn = $('btnGoToLevel2');
        const wasL2Unlocked = !!(state.activeDeck && state.activeDeck.l2_unlocked);
        const isL2UnlockedNow = wasL2Unlocked || !!(finishResult && finishResult.l2_unlocked);
        if (isRun && state.sessionLevelMode === 1 && isL2UnlockedNow) {
            if (goToL2Btn) goToL2Btn.classList.remove('hidden');
            if (unlockBanner) unlockBanner.classList.toggle('hidden', wasL2Unlocked);
        } else {
            if (unlockBanner) unlockBanner.classList.add('hidden');
            if (goToL2Btn) goToL2Btn.classList.add('hidden');
        }
        if (state.activeDeck) state.activeDeck.l2_unlocked = isL2UnlockedNow;

        // XP + best combo
        popNumber($('sumXp'), state.sessionXp);
        if ($('sumCombo')) $('sumCombo').textContent = state.maxCombo;

        // Dynamic title / message
        let titleKey, titleFb, subKey, subFb;
        if (!isRun) {
            titleKey = 'microcards.res_title_review'; titleFb = 'Повторение завершено!';
            subKey = accuracy >= 80 ? 'microcards.res_sub_review_good' : 'microcards.res_sub_review_keep';
            subFb = accuracy >= 80
                ? 'Память держит материал крепко — так держать.'
                : 'Сложные карточки вернутся чаще — память подтянется.';
        }
        else if (starCount === 5) { titleKey = 'microcards.res_title_perfect'; titleFb = 'Идеально!'; subKey = 'microcards.res_sub_perfect'; subFb = 'Безупречно — ни одной ошибки!'; }
        else if (starCount >= 4) { titleKey = 'microcards.res_title_great'; titleFb = 'Великолепно!'; subKey = 'microcards.res_sub_great'; subFb = 'Отличный результат, так держать!'; }
        else if (starCount >= 3) { titleKey = 'microcards.res_title_good'; titleFb = 'Хорошая работа!'; subKey = 'microcards.res_sub_good'; subFb = 'Уверенный результат — ещё немного до идеала.'; }
        else if (starCount >= 1) { titleKey = 'microcards.res_title_ok'; titleFb = 'Неплохо!'; subKey = 'microcards.res_sub_ok'; subFb = 'Сложные карточки вернулись и были закрыты — попробуй пройти их с первой попытки.'; }
        else { titleKey = 'microcards.res_title_keep'; titleFb = 'Продолжай тренироваться'; subKey = 'microcards.res_sub_keep'; subFb = 'Пройди колоду ещё раз, чтобы закрепить материал.'; }
        if ($('sumTitle')) $('sumTitle').textContent = t(titleKey, titleFb);
        if ($('sumSubtitle')) $('sumSubtitle').textContent = t(subKey, subFb);
    }

    function restartLearningSession() {
        if (state.sessionMode === 'run') {
            startRun(state.sessionLevelMode === 2 ? 2 : 1);
        } else {
            startReview();
        }
    }

    function backToDecks() {
        loadLibraryData();
    }

    // ── Browse mode (free flipping — no grading, no FSRS, no points) ───────
    function startBrowse() {
        if (!state.cards || state.cards.length === 0) {
            showToast(t('microcards.browse_empty', 'В колоде пока нет карточек'), 'info');
            return;
        }
        state.browseIndex = 0;
        switchView('browse');
        renderBrowseCard();
    }

    function renderBrowseCard() {
        const card = state.cards[state.browseIndex];
        if (!card) return;
        resetFlipInstant($('browseCardInner'));
        playCardEnter($('browseCardWrap'));
        $('browseFrontText').textContent = card.front.text;
        $('browseBackText').textContent = card.back.text;
        const hint = $('browseHintText');
        if (hint) {
            hint.textContent = card.hint ? `${t('microcards.hint_label', 'Подсказка')}: ${card.hint}` : '';
            hint.classList.toggle('hidden', !card.hint);
        }
        const setImg = (el, url) => {
            if (!el) return;
            if (url) { el.src = url; el.classList.remove('hidden'); }
            else { el.classList.add('hidden'); }
        };
        setImg($('browseFrontImage'), card.front.image_url);
        setImg($('browseBackImage'), card.back.image_url);
        const counter = $('browseCounter');
        if (counter) counter.textContent = `${state.browseIndex + 1}/${state.cards.length}`;
    }

    function browseFlip() {
        const inner = $('browseCardInner');
        if (!inner) return;
        inner.classList.toggle('flipped');
        DopamineAudio.playCardFlip();
    }

    function browsePrev() {
        if (state.browseIndex > 0) { state.browseIndex--; renderBrowseCard(); }
    }

    function browseNext() {
        if (state.browseIndex < state.cards.length - 1) { state.browseIndex++; renderBrowseCard(); }
    }

    function exitBrowse() {
        switchView('details');
    }

    // ── Study settings dialog (sound / volume / animations / pace / goal) ──
    function openStudySettings() {
        const soundEl = $('prefSound');
        const volEl = $('prefVolume');
        const animEl = $('prefAnimations');
        if (soundEl) soundEl.checked = prefs.sound;
        if (volEl) volEl.value = Math.round(prefs.volume * 100);
        if (animEl) animEl.checked = prefs.animations;
        // Server-backed study settings (pace preset + daily goal)
        const loadSel = $('prefDailyLoad');
        if (loadSel) loadSel.value = (state.settings && state.settings.daily_load) || 'standard';
        const goalEl = $('prefDailyGoal');
        if (goalEl) goalEl.value = (state.settings && state.settings.daily_goal) || 20;
        syncVolumeRowState();
        openDialog('dialogStudyPrefs');
    }

    function syncVolumeRowState() {
        const row = $('prefVolumeRow');
        if (row) row.style.opacity = prefs.sound ? '1' : '0.45';
    }

    function bindStudyPrefsControls() {
        const soundEl = $('prefSound');
        if (soundEl) {
            soundEl.addEventListener('change', () => {
                prefs.sound = soundEl.checked;
                savePrefs();
                syncVolumeRowState();
                if (prefs.sound) DopamineAudio.playCorrect(); // instant feedback
            });
        }
        const volEl = $('prefVolume');
        if (volEl) {
            volEl.addEventListener('change', () => {
                prefs.volume = Math.min(1, Math.max(0, (parseInt(volEl.value, 10) || 0) / 100));
                savePrefs();
                DopamineAudio.playCorrect(); // hear the new level right away
            });
        }
        const animEl = $('prefAnimations');
        if (animEl) {
            animEl.addEventListener('change', () => {
                prefs.animations = animEl.checked;
                savePrefs();
            });
        }

        // Pace preset + daily goal live on the server (follow the account).
        const pushSettings = async (patch) => {
            try {
                const res = await apiCall('/api/v2/microcards/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patch)
                });
                if (res && res.settings) {
                    state.settings = res.settings;
                    renderGoalKpi();
                }
            } catch (e) {
                console.error('[settings]', e);
            }
        };
        const loadSel = $('prefDailyLoad');
        if (loadSel) {
            loadSel.addEventListener('change', () => pushSettings({ daily_load: loadSel.value }));
        }
        const goalEl = $('prefDailyGoal');
        if (goalEl) {
            goalEl.addEventListener('change', () => {
                const v = parseInt(goalEl.value, 10);
                if (v) pushSettings({ daily_goal: v });
            });
        }
    }

    // Daily-goal progress ring «X/N сегодня» (library KPI strip).
    function renderGoalKpi(analytics) {
        if (analytics) state._analytics = analytics;
        const a = state._analytics || {};
        const goal = (state.settings && state.settings.daily_goal) || 20;
        const today = a.reviews_today || 0;
        const todayEl = $('anGoalToday');
        const targetEl = $('anGoalTarget');
        if (todayEl) todayEl.textContent = today;
        if (targetEl) targetEl.textContent = goal;

        const met = today >= goal;
        const CIRC = 56.55; // 2π·r, r=9 (matches the SVG)
        const fill = $('mcGoalRingFill');
        if (fill) {
            const progress = Math.min(1, goal > 0 ? today / goal : 0);
            fill.style.strokeDashoffset = (CIRC * (1 - progress)).toFixed(2);
        }
        const kpi = $('mcGoalKpi');
        if (kpi) kpi.classList.toggle('is-met', met);
        const icon = $('mcGoalIcon');
        if (icon) icon.style.display = met ? 'inline' : 'none';
    }

    function bindBrowseControls() {
        const wrap = $('browseCardWrap');
        if (wrap) {
            wrap.addEventListener('click', browseFlip);
            wrap.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); browseFlip(); }
            });
        }
        document.addEventListener('keydown', (e) => {
            if (state.view !== 'browse') return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); browsePrev(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); browseNext(); }
        });
    }


    // ── Import Decks Dialog ───────────────────────────────────────────────
    const IMPORT_HINTS = {
        auto: ['microcards.imp_hint_auto', 'Вставьте что угодно — формат определится сам: Quizlet/Excel (таб), «вопрос — ответ», CSV, JSON или тест. Файлы тоже: Anki (.apkg, без медиа) и Word (.docx — таблица «вопрос|ответ» или абзацы). Разделитель и иерархия распознаются автоматически.'],
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
        // AI prompt helper starts collapsed, default variant.
        state.aiDetail = 'short'; state.aiHints = 'no';
        if ($('impAiPanel')) $('impAiPanel').classList.add('hidden');
        openDialog('dialogImportDeck');
    }

    // ── AI prompt helper ──────────────────────────────────────────────────
    // Ready-made prompt the user pastes into an AI to generate cards in our format.
    // Variants: detail (short = token-thrifty / full = thorough) × hints (no / yes).
    function _aiPromptText(detail, hints) {
        const fill = '<<вставьте сюда свой материал: конспект, текст лекции, статью>>';
        if (detail === 'short' && hints === 'no') {
            return `Сделай из текста ниже карточки для заучивания (вопрос и ответ).

Правила. Каждая карточка — это одна строка вида «Вопрос — Ответ», между вопросом и ответом ставь длинное тире « — » с пробелами. Не используй нумерацию, маркированные списки, заголовки, markdown и тройные кавычки — в ответе должны быть только строки-карточки и ничего больше. Вопросы короткие и конкретные, ответы краткие.

Пример правильного вывода:
Столица Японии — Токио
Сколько костей у взрослого человека? — 206

Материал:
${fill}`;
        }
        if (detail === 'short' && hints === 'yes') {
            return `Сделай из текста ниже карточки для заучивания (вопрос и ответ).

Правила. Каждая карточка — это одна строка вида «Вопрос — Ответ», между вопросом и ответом ставь длинное тире « — » с пробелами. К трудной карточке можно добавить подсказку в самом конце строки в особых скобках со слешами: (/короткий намёк/). Подсказка — это намёк, а не сам ответ. Не используй нумерацию, маркированные списки, заголовки, markdown и тройные кавычки — только строки-карточки.

Пример правильного вывода:
Столица Японии — Токио
Что такое митоз? — Деление клетки на две одинаковые (/«мито» значит «нить»/)

Материал:
${fill}`;
        }
        if (detail === 'full' && hints === 'no') {
            return `Ты — помощник, который делает качественные карточки для запоминания (вопрос → ответ). Преврати мой материал ниже в набор таких карточек.

Как оформлять (соблюдай точно). Каждая карточка — это одна строка вида «Вопрос — Ответ»; между вопросом и ответом ставь длинное тире с пробелами « — ». Пустых строк между карточками нет. Не добавляй нумерацию, маркированные списки, заголовки, пояснения, markdown или тройные кавычки — в ответе должны быть только строки-карточки и ничего больше.

Каким делать содержание. Одна карточка — одна мысль, не объединяй несколько фактов вместе. Вопрос короткий и однозначный (чтобы был ровно один правильный ответ), ответ краткий и точный (термин или 1–2 предложения). Не повторяй одинаковые карточки. Сохрани важные термины, даты, определения, причины и следствия. Пиши на том же языке, что и материал. Сделай от 10 до 40 карточек — по объёму материала.

Пример правильного вывода:
Столица Японии — Токио
Что такое фотосинтез? — Образование глюкозы из углекислого газа и воды на свету
Год начала Второй мировой войны — 1939

Материал:
${fill}`;
        }
        // full + hints
        return `Ты — помощник, который делает качественные карточки для запоминания (вопрос → ответ). Преврати мой материал ниже в набор таких карточек.

Как оформлять (соблюдай точно). Каждая карточка — это одна строка вида «Вопрос — Ответ»; между вопросом и ответом ставь длинное тире с пробелами « — ». Если карточка трудная, можешь добавить подсказку в самом конце строки в особых скобках со слешами: «Вопрос — Ответ (/короткий намёк/)». Подсказка — это лёгкая зацепка для памяти, а не сам ответ; добавляй её только там, где она правда помогает, не к каждой карточке. Обычные скобки без слешей подсказкой не считаются. Не используй нумерацию, маркированные списки, заголовки, пояснения, markdown или тройные кавычки — только строки-карточки.

Каким делать содержание. Одна карточка — одна мысль. Вопрос короткий и однозначный, ответ краткий и точный. Не повторяй карточки, сохрани важные термины, даты, определения, причины и следствия. Пиши на том же языке, что и материал. Сделай от 10 до 40 карточек — по объёму материала.

Пример правильного вывода:
Столица Японии — Токио
Что такое митоз? — Деление клетки на две одинаковые (/«мито» значит «нить»/)
Год начала Второй мировой войны — 1939

Материал:
${fill}`;
    }

    function renderAiPrompt() {
        const ta = $('impAiPrompt');
        if (ta) ta.value = _aiPromptText(state.aiDetail || 'short', state.aiHints || 'no');
    }
    function toggleAiPromptPanel() {
        const p = $('impAiPanel');
        if (!p) return;
        const willShow = p.classList.contains('hidden');
        p.classList.toggle('hidden', !willShow);
        if (willShow) renderAiPrompt();
    }
    function setAiVariant(kind, value) {
        if (kind === 'detail') state.aiDetail = value; else state.aiHints = value;
        const wrapId = kind === 'detail' ? 'impAiDetail' : 'impAiHints';
        const wrap = $(wrapId);
        if (wrap) wrap.querySelectorAll(`button[data-${kind}]`).forEach(b =>
            b.classList.toggle('is-active', b.getAttribute('data-' + kind) === value));
        renderAiPrompt();
    }
    async function copyAiPrompt() {
        const ta = $('impAiPrompt');
        if (!ta) return;
        try {
            await navigator.clipboard.writeText(ta.value);
            showToast(t('microcards.imp_ai_copied', 'Промпт скопирован — вставьте его в ИИ'), 'success');
        } catch (e) {
            ta.focus(); ta.select();
            showToast(t('microcards.imp_ai_copy_manual', 'Выделено — скопируйте вручную (Ctrl+C)'), 'warning');
        }
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
        setImportCollapsed(false); // back to the full input zone
    }

    // ── Collapsing source (input ⇄ compact bar) ───────────────────────────
    // While entering, the input zone is large; once recognized it collapses into a
    // one-line source summary so the preview gets the height.
    function setImportCollapsed(collapsed) {
        const zone = $('impInputZone');
        const bar = $('impSourceBar');
        if (!zone || !bar) return;
        if (collapsed) {
            const fi = $('importFile');
            const hasFile = fi && fi.files.length > 0;
            const icon = $('impSourceIcon');
            const txt = $('impSourceText');
            if (icon) icon.textContent = hasFile ? 'description' : 'content_paste';
            if (txt) txt.textContent = hasFile
                ? fi.files[0].name
                : t('microcards.imp_pasted_text', 'Вставленный текст');
        }
        zone.classList.toggle('hidden', collapsed);
        bar.classList.toggle('hidden', !collapsed);
    }
    function editImportSource() {
        setImportCollapsed(false);
        const fi = $('importFile');
        const ta = $('impContent');
        if (ta && !(fi && fi.files.length)) ta.focus();
    }
    function onImportBlur() {
        // Stepping away from the textarea with a valid result → collapse to free space.
        const pv = $('impPreview');
        if (pv && !pv.classList.contains('hidden')
            && !($('importFile').files.length) && ($('impContent').value || '').trim()) {
            setImportCollapsed(true);
        }
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
            const hintHtml = row.hint ? `<span class="mc-imp-row__hint"><span class="material-symbols-outlined">lightbulb</span>${escHtml(row.hint)}</span>` : '';
            return `<div class="mc-imp-row ${dup ? 'mc-imp-row--dup' : 'mc-imp-row--ok'}"><span class="mc-imp-row__icon material-symbols-outlined">${dup ? 'content_copy' : 'check_circle'}</span><span class="mc-imp-row__front">${escHtml(row.front)}</span><span class="mc-imp-row__back">${escHtml(row.back)}${hintHtml}</span></div>`;
        }).join('');

        // Collapse the input once we have a result: always for a file, and for pasted
        // text only when the user isn't actively typing (so live edits aren't interrupted).
        const recognized = (counts.ok || 0) + (counts.duplicates || 0) + (counts.errors || 0);
        const hasFile = $('importFile') && $('importFile').files.length > 0;
        if (recognized > 0 && (hasFile || document.activeElement !== $('impContent'))) {
            setImportCollapsed(true);
        }
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
        // Binary uploads (.apkg / .docx) go to the file endpoint regardless of
        // the selected tab — the server routes them by extension.
        const fname = isFile ? (fileInput.files[0].name || '').toLowerCase() : '';
        const isBinaryFile = isFile && (fname.endsWith('.apkg') || fname.endsWith('.docx'));
        const url = isBinaryFile
            ? `/api/v2/microcards/decks/${state.activeDeckId}/import/file`
            : `/api/v2/microcards/decks/${state.activeDeckId}/import/${fmt}`;
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
            closeDialog('dialogImportDeck');
            let msg = t('microcards.toast_imported', 'Импортировано {n} карточек').replace('{n}', result.added_count || 0);
            if (result.skipped_duplicates) {
                msg += ' · ' + t('microcards.toast_skipped_dup', 'дублей пропущено: {n}').replace('{n}', result.skipped_duplicates);
            }
            showToast(msg, 'success');
            openDeckDetails(state.activeDeckId);
        } catch (err) {
            console.error(err);
            if (String(err && err.message).includes('apkg_new_format_unsupported')) {
                showToast(t('microcards.apkg_new_format_hint', 'Этот .apkg в новом формате Anki. Экспортируйте колоду с галочкой «Поддержка старых версий Anki» и попробуйте снова.'), 'warning');
            }
        }
    }

    function openImportByCodeDialog() {
        if ($('importCodeInput')) $('importCodeInput').value = '';
        openDialog('dialogImportByCode');
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
            closeDialog('dialogImportByCode');
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
            unpublished: { label: t('microcards.pub_unpublished', 'Не опубликована'), hint: '', icon: 'lock', cls: 'mc-pub--muted' },
            public:      { label: t('microcards.pub_public', 'Публичная'), hint: '', icon: 'public', cls: 'mc-pub--public' },
            access_code: { label: t('microcards.pub_by_code', 'По коду доступа'), hint: '', icon: 'key', cls: 'mc-pub--code' },
            private:     { label: t('microcards.pub_private', 'Приватная'), hint: '', icon: 'lock', cls: 'mc-pub--muted' },
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
        openDialog('dialogPublishDeck');
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

        // Bind exit confirmation dialog buttons
        const pauseExitBtn = $('btnPauseAndExit');
        if (pauseExitBtn) {
            pauseExitBtn.addEventListener('click', async () => {
                closeDialog('dialogConfirmExitSession');
                await pauseLearningSession();
            });
        }
        const discardExitBtn = $('btnDiscardAndExit');
        if (discardExitBtn) {
            discardExitBtn.addEventListener('click', async () => {
                closeDialog('dialogConfirmExitSession');
                await abandonLearningSession();
            });
        }

        // Auto-pause session on tab/browser closure via modern keepalive fetch
        window.addEventListener('beforeunload', () => {
            if (state.view === 'session' && state.session) {
                const url = `/api/v2/microcards/session/${state.session.id}/pause`;
                const payload = JSON.stringify({
                    combo: state.combo,
                    max_combo: state.maxCombo,
                    session_xp: state.sessionXp
                });
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    keepalive: true
                });
            }
        });

        // Bind swipe-style grading rails
        bindSessionRails();
        bindBrowseControls();
        bindStudyPrefsControls();
        applyAnimationPrefs();
        // Fetch+decode the baked sounds after the first interaction (autoplay
        // policies) so the first real answer already plays the warm samples.
        document.addEventListener('pointerdown', () => DopamineAudio.preload(), { once: true });

        // Initial positioning of sliding tabs pill (without animation)
        setTimeout(() => {
            moveTabPill('mcSort', null, false);
        }, 100);

        window.addEventListener('resize', () => {
            moveTabPill('mcSort', null, false);
        });

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
        openDialog,
        closeDialog,
        handleBackNavigation,
        openCreateDeckDialog,
        handleCreateDeckSubmit,
        openDeckDetails,
        toggleDeckActionsMenu,
        exportDeck,
        confirmDeleteDeck,
        startRun,
        startReview,
        startBrowse,
        browsePrev,
        browseNext,
        exitBrowse,
        confirmResetRun,
        abortSession,
        toggleHint,
        revealAnswerL1,
        submitAnswerL1,
        submitAnswerL2,
        overrideL2Answer,
        nextCard,
        restartLearningSession,
        backToDecks,
        openDeckMetaDialog,
        saveDeckMetaDialog,
        toggleCardExpand,
        toggleCardAdvanced,
        addNewCardInline,
        saveCardInline,
        deleteCardInline,
        openImagePicker,
        clearCardImage,
        notifyReadonlyCard,
        imgPickerSearch,
        imgPickerSelect,
        imgPickerInsert,
        openImportDialog,
        switchImportTab,
        handleImportSubmit,
        previewImport,
        pasteImportClipboard,
        onImportInput,
        onImportFile,
        editImportSource,
        onImportBlur,
        toggleAiPromptPanel,
        setAiVariant,
        copyAiPrompt,
        openImportByCodeDialog,
        handleImportByCodeSubmit,
        selectTagFilter,
        startInlineRename,
        commitInlineRename,
        onRenameKey,
        studyDeckFromLibrary,
        editDeckFromLibrary,
        exportDeckFromLibrary,
        deleteDeckFromLibrary,
        toggleCardMenu,
        toggleCardDetails,
        publishDeckToCatalog,
        handlePublishSubmit,
        copyPublishCode,
        pauseLearningSession,
        abandonLearningSession,
        openStudySettings,
        toggleCardSelect,
        toggleSelectAllCards,
        bulkDeleteSelected
    };

    // Auto boot
    document.addEventListener('DOMContentLoaded', () => {
        if (window.i18n && typeof window.i18n.translatePage === 'function') {
            window.i18n.translatePage();
        }
        init();
    });

})();
