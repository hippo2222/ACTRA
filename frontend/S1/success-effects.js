/**
 * Success Effects Module
 * Игровые эффекты для визуального удовольствия при правильном/неправильном ответе.
 * — Confetti burst (canvas)
 * — Streak tracker
 * — Animated SVG checkmark
 * — Glow / shake / bounce orchestration
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SuccessEffects = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // =========================================================================
    //  STREAK TRACKER
    // =========================================================================
    let _streak = 0;

    function getStreak() { return _streak; }

    function recordSuccess() {
        _streak++;
        return _streak;
    }

    function recordFailure() {
        _streak = 0;
        return _streak;
    }

    function resetStreak() {
        _streak = 0;
    }

    // =========================================================================
    //  THEME COLOR HELPERS
    // =========================================================================

    /**
     * Read a CSS custom property from :root and return its computed value.
     */
    function _getThemeColor(varName) {
        try {
            return getComputedStyle(document.documentElement)
                .getPropertyValue(varName).trim();
        } catch (e) {
            return '';
        }
    }

    /**
     * Parse a CSS color string (hex or rgb) into {r, g, b}.
     * Returns null if parsing fails.
     */
    function _parseColor(color) {
        if (!color) return null;
        // Hex
        let m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
        // Short hex
        m = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
        if (m) return { r: parseInt(m[1]+m[1], 16), g: parseInt(m[2]+m[2], 16), b: parseInt(m[3]+m[3], 16) };
        // rgb(r, g, b)
        m = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) return { r: +m[1], g: +m[2], b: +m[3] };
        return null;
    }

    /**
     * Get an rgba() string for a CSS variable color at given alpha.
     * Falls back to the provided fallbackRgba if theme color can't be read.
     */
    function _themeRgba(varName, alpha, fallbackRgba) {
        const raw = _getThemeColor(varName);
        const c = _parseColor(raw);
        if (c) return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
        return fallbackRgba || 'rgba(34, 197, 94, ' + alpha + ')';
    }

    // =========================================================================
    //  CONFETTI ENGINE (lightweight, no dependencies)
    // =========================================================================

    // Universal celebration palette (not theme-specific — confetti is festive)
    const _CONFETTI_FALLBACK = [
        '#f59e0b', '#eab308',            // yellows/golds
        '#ec4899', '#f43f5e',            // pinks
        '#a855f7', '#8b5cf6',            // purples
        '#3b82f6', '#6366f1',            // blues
    ];

    /**
     * Build confetti palette: theme accent/success/primary + universal festive colors.
     */
    function _getConfettiColors() {
        const palette = _CONFETTI_FALLBACK.slice();
        // Inject theme colors for harmony
        const success = _getThemeColor('--color-success');
        const primary = _getThemeColor('--color-primary');
        const accent  = _getThemeColor('--color-accent');
        if (success) palette.unshift(success);
        if (primary) palette.push(primary);
        if (accent)  palette.push(accent);
        return palette;
    }

    let _confettiCanvas = null;
    let _confettiCtx = null;
    let _confettiRAF = null;

    function _ensureCanvas() {
        if (_confettiCanvas && _confettiCanvas.parentNode) return;
        _confettiCanvas = document.createElement('canvas');
        _confettiCanvas.id = 'success-confetti-canvas';
        _confettiCanvas.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'pointer-events:none;z-index:9999;';
        document.body.appendChild(_confettiCanvas);
        _confettiCtx = _confettiCanvas.getContext('2d');
    }

    function _removeCanvas() {
        if (_confettiCanvas && _confettiCanvas.parentNode) {
            _confettiCanvas.parentNode.removeChild(_confettiCanvas);
        }
        _confettiCanvas = null;
        _confettiCtx = null;
        if (_confettiRAF) {
            cancelAnimationFrame(_confettiRAF);
            _confettiRAF = null;
        }
    }

    /**
     * Launch confetti burst.
     * @param {Object} opts
     * @param {number} opts.particleCount - Number of particles (default 60)
     * @param {number} opts.originX - 0..1 horizontal origin (default 0.5)
     * @param {number} opts.originY - 0..1 vertical origin (default 0.35)
     * @param {number} opts.spread - spread angle in degrees (default 70)
     * @param {number} opts.duration - ms (default 1800)
     */
    function launchConfetti(opts) {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        opts = opts || {};
        const count = opts.particleCount || 60;
        const originX = opts.originX != null ? opts.originX : 0.5;
        const originY = opts.originY != null ? opts.originY : 0.35;
        const spread = (opts.spread || 70) * Math.PI / 180;
        const duration = opts.duration || 1800;

        _ensureCanvas();
        const canvas = _confettiCanvas;
        const ctx = _confettiCtx;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const cx = window.innerWidth * originX;
        const cy = window.innerHeight * originY;

        const confettiColors = _getConfettiColors();
        const particles = [];
        for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
            const speed = 4 + Math.random() * 6;
            const size = 4 + Math.random() * 4;
            particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.8),
                vy: Math.sin(angle) * speed * (0.6 + Math.random() * 0.8),
                size: size,
                color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.3,
                opacity: 1,
                shape: Math.random() > 0.5 ? 'rect' : 'circle',
                gravity: 0.12 + Math.random() * 0.06,
                friction: 0.98,
            });
        }

        const start = performance.now();

        function frame(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);

            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

            for (const p of particles) {
                p.vy += p.gravity;
                p.vx *= p.friction;
                p.vy *= p.friction;
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rotSpeed;

                // Fade out in last 40%
                p.opacity = progress > 0.6 ? 1 - (progress - 0.6) / 0.4 : 1;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                ctx.globalAlpha = Math.max(0, p.opacity);
                ctx.fillStyle = p.color;

                if (p.shape === 'rect') {
                    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                } else {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            if (progress < 1) {
                _confettiRAF = requestAnimationFrame(frame);
            } else {
                _removeCanvas();
            }
        }

        _confettiRAF = requestAnimationFrame(frame);
    }

    // =========================================================================
    //  ANIMATED SVG CHECKMARK
    // =========================================================================
    /**
     * Replaces the content of the icon wrapper with an animated SVG checkmark.
     * @param {HTMLElement} iconWrap - The container element (#result-icon-wrap)
     */
    function renderAnimatedCheckmark(iconWrap) {
        if (!iconWrap) return;
        iconWrap.innerHTML = '';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 52 52');
        svg.setAttribute('class', 'success-checkmark-svg');
        svg.style.cssText = 'width:28px;height:28px;';

        // Circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '26');
        circle.setAttribute('cy', '26');
        circle.setAttribute('r', '23');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', 'currentColor');
        circle.setAttribute('stroke-width', '3');
        circle.setAttribute('class', 'success-checkmark-circle');

        // Checkmark path
        const check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        check.setAttribute('fill', 'none');
        check.setAttribute('stroke', 'currentColor');
        check.setAttribute('stroke-width', '4');
        check.setAttribute('stroke-linecap', 'round');
        check.setAttribute('stroke-linejoin', 'round');
        check.setAttribute('d', 'M14.1 27.2l7.1 7.2 16.7-16.8');
        check.setAttribute('class', 'success-checkmark-check');

        svg.appendChild(circle);
        svg.appendChild(check);
        iconWrap.appendChild(svg);
    }

    /**
     * Replaces the content of the icon wrapper with an animated SVG cross for errors.
     * @param {HTMLElement} iconWrap - The container element (#result-icon-wrap)
     */
    function renderAnimatedCross(iconWrap) {
        if (!iconWrap) return;
        iconWrap.innerHTML = '';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 52 52');
        svg.setAttribute('class', 'error-cross-svg');
        svg.style.cssText = 'width:28px;height:28px;';

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '26');
        circle.setAttribute('cy', '26');
        circle.setAttribute('r', '23');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', 'currentColor');
        circle.setAttribute('stroke-width', '3');
        circle.setAttribute('class', 'error-cross-circle');

        const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line1.setAttribute('fill', 'none');
        line1.setAttribute('stroke', 'currentColor');
        line1.setAttribute('stroke-width', '4');
        line1.setAttribute('stroke-linecap', 'round');
        line1.setAttribute('d', 'M17 17l18 18');
        line1.setAttribute('class', 'error-cross-line');

        const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line2.setAttribute('fill', 'none');
        line2.setAttribute('stroke', 'currentColor');
        line2.setAttribute('stroke-width', '4');
        line2.setAttribute('stroke-linecap', 'round');
        line2.setAttribute('d', 'M35 17l-18 18');
        line2.setAttribute('class', 'error-cross-line error-cross-line-2');

        svg.appendChild(circle);
        svg.appendChild(line1);
        svg.appendChild(line2);
        iconWrap.appendChild(svg);
    }

    // =========================================================================
    //  STREAK BADGE
    // =========================================================================
    /**
     * Creates or updates the streak badge inside the result header.
     * @param {HTMLElement} header - The result-header element
     * @param {number} streak - Current streak count
     */
    function renderStreakBadge(header, streak) {
        if (!header) return;

        // Remove old badge
        const old = header.querySelector('.streak-badge');
        if (old) old.remove();

        if (streak < 2) return;

        const badge = document.createElement('span');
        badge.className = 'streak-badge';

        let fires = '';
        let extraClass = '';
        if (streak >= 5) {
            fires = '🔥🔥🔥';
            extraClass = ' streak-badge-epic';
        } else if (streak >= 3) {
            fires = '🔥🔥';
            extraClass = ' streak-badge-hot';
        } else {
            fires = '🔥';
            extraClass = '';
        }

        badge.innerHTML = `<span class="streak-badge-inner${extraClass}">${fires} ${streak} подряд!</span>`;
        header.appendChild(badge);
    }

    // =========================================================================
    //  NEXT BUTTON GLOW
    // =========================================================================
    function glowNextButton() {
        const btn = document.getElementById('next-task-btn');
        if (!btn) return;

        // Set theme-aware glow color
        btn.style.setProperty('--_glow',
            _themeRgba('--color-success', 0.4, 'rgba(34,197,94,0.4)'));

        btn.classList.remove('next-btn-glow');
        // Force reflow
        void btn.offsetWidth;
        btn.classList.add('next-btn-glow');

        // Remove after animation
        const onEnd = () => {
            btn.classList.remove('next-btn-glow');
            btn.removeEventListener('animationend', onEnd);
        };
        btn.addEventListener('animationend', onEnd);
    }

    // =========================================================================
    //  RESULT BOX GLOW
    // =========================================================================
    function glowResultBox(success) {
        const inner = document.getElementById('result-inner');
        if (!inner) return;

        // Set theme-aware glow color
        if (success) {
            inner.style.setProperty('--_glow',
                _themeRgba('--color-success', 0.35, 'rgba(34,197,94,0.35)'));
        } else {
            inner.style.setProperty('--_glow',
                _themeRgba('--color-error', 0.25, 'rgba(239,68,68,0.25)'));
        }

        const cls = success ? 'result-glow-success' : 'result-glow-error';
        inner.classList.remove('result-glow-success', 'result-glow-error');
        void inner.offsetWidth;
        inner.classList.add(cls);

        const onEnd = () => {
            inner.classList.remove(cls);
            inner.removeEventListener('animationend', onEnd);
        };
        inner.addEventListener('animationend', onEnd);
    }

    // =========================================================================
    //  SHAKE (error)
    // =========================================================================
    function shakeResultBox() {
        const box = document.getElementById('result-box');
        if (!box) return;

        box.classList.remove('anim-shake');
        void box.offsetWidth;
        box.classList.add('anim-shake');

        const onEnd = () => {
            box.classList.remove('anim-shake');
            box.removeEventListener('animationend', onEnd);
        };
        box.addEventListener('animationend', onEnd);
    }

    // =========================================================================
    //  TITLE BOUNCE
    // =========================================================================
    function bounceTitle() {
        const title = document.getElementById('result-title');
        if (!title) return;

        title.classList.remove('result-title-bounce');
        void title.offsetWidth;
        title.classList.add('result-title-bounce');

        const onEnd = () => {
            title.classList.remove('result-title-bounce');
            title.removeEventListener('animationend', onEnd);
        };
        title.addEventListener('animationend', onEnd);
    }

    // =========================================================================
    //  PROGRESS BAR SHIMMER
    // =========================================================================
    function shimmerProgressBar() {
        const bar = document.getElementById('progress-bar');
        if (!bar) return;

        bar.classList.remove('progress-shimmer');
        void bar.offsetWidth;
        bar.classList.add('progress-shimmer');

        const onEnd = () => {
            bar.classList.remove('progress-shimmer');
            bar.removeEventListener('animationend', onEnd);
        };
        bar.addEventListener('animationend', onEnd);
    }

    // =========================================================================
    //  MAIN ORCHESTRATOR
    // =========================================================================
    /**
     * Called after answer evaluation. Orchestrates all success/failure effects.
     * @param {boolean} success - Whether the answer was correct
     */
    function playResultEffects(success) {
        if (success) {
            // Streak is already updated by caller (session-controls) before this call
            const streak = getStreak();

            // Animated checkmark is handled in task-renderer via renderAnimatedCheckmark

            // Confetti — intensity scales with streak
            const confettiCount = streak >= 5 ? 100 : streak >= 3 ? 80 : 60;
            launchConfetti({ particleCount: confettiCount });

            // Glow on result box
            glowResultBox(true);

            // Bounce the title
            bounceTitle();

            // Glow the next button (short delay for stagger)
            setTimeout(glowNextButton, 300);

            // Shimmer progress bar
            setTimeout(shimmerProgressBar, 200);

            // Streak badge (rendered externally by task-renderer)
        } else {
            // Streak is already reset by caller (session-controls) before this call

            // Shake the result box
            shakeResultBox();

            // Error glow
            glowResultBox(false);
        }
    }

    // =========================================================================
    //  PUBLIC API
    // =========================================================================
    return {
        playResultEffects: playResultEffects,
        launchConfetti: launchConfetti,
        renderAnimatedCheckmark: renderAnimatedCheckmark,
        renderAnimatedCross: renderAnimatedCross,
        renderStreakBadge: renderStreakBadge,
        glowNextButton: glowNextButton,
        glowResultBox: glowResultBox,
        shakeResultBox: shakeResultBox,
        bounceTitle: bounceTitle,
        shimmerProgressBar: shimmerProgressBar,
        getStreak: getStreak,
        recordSuccess: recordSuccess,
        recordFailure: recordFailure,
        resetStreak: resetStreak,
    };
}));
