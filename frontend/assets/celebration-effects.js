/**
 * Celebration Effects for Results Pages (S2, S3)
 * Lightweight confetti + animated stat counters + success emoji burst.
 * Theme-aware: reads CSS variables for color harmony.
 */
(function (root) {
    'use strict';

    // =========================================================================
    //  THEME COLOR HELPERS (same as success-effects.js, standalone)
    // =========================================================================
    function _getThemeColor(varName) {
        try {
            return getComputedStyle(document.documentElement)
                .getPropertyValue(varName).trim();
        } catch (e) { return ''; }
    }

    function _parseColor(color) {
        if (!color) return null;
        let m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
        m = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
        if (m) return { r: parseInt(m[1]+m[1], 16), g: parseInt(m[2]+m[2], 16), b: parseInt(m[3]+m[3], 16) };
        m = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) return { r: +m[1], g: +m[2], b: +m[3] };
        return null;
    }

    // =========================================================================
    //  CONFETTI ENGINE (copy from success-effects, standalone)
    // =========================================================================
    const _CONFETTI_FALLBACK = [
        '#f59e0b', '#eab308', '#ec4899', '#f43f5e',
        '#a855f7', '#8b5cf6', '#3b82f6', '#6366f1',
    ];

    function _getConfettiColors() {
        const palette = _CONFETTI_FALLBACK.slice();
        const success = _getThemeColor('--color-success');
        const primary = _getThemeColor('--color-primary');
        const accent  = _getThemeColor('--color-accent');
        if (success) palette.unshift(success);
        if (primary) palette.push(primary);
        if (accent)  palette.push(accent);
        return palette;
    }

    let _canvas = null, _ctx = null, _raf = null;

    function _ensureCanvas() {
        if (_canvas && _canvas.parentNode) return;
        _canvas = document.createElement('canvas');
        _canvas.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(_canvas);
        _ctx = _canvas.getContext('2d');
    }

    function _removeCanvas() {
        if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
        _canvas = null; _ctx = null;
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    }

    function launchConfetti(opts) {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        opts = opts || {};
        const count = opts.particleCount || 80;
        const originX = opts.originX != null ? opts.originX : 0.5;
        const originY = opts.originY != null ? opts.originY : 0.3;
        const spread = (opts.spread || 90) * Math.PI / 180;
        const duration = opts.duration || 2200;

        _ensureCanvas();
        const dpr = window.devicePixelRatio || 1;
        _canvas.width = window.innerWidth * dpr;
        _canvas.height = window.innerHeight * dpr;
        _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const cx = window.innerWidth * originX;
        const cy = window.innerHeight * originY;
        const colors = _getConfettiColors();

        const particles = [];
        for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
            const speed = 3 + Math.random() * 7;
            particles.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * speed * (0.5 + Math.random()),
                vy: Math.sin(angle) * speed * (0.5 + Math.random()),
                size: 4 + Math.random() * 5,
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.3,
                opacity: 1,
                shape: Math.random() > 0.4 ? 'rect' : 'circle',
                gravity: 0.10 + Math.random() * 0.05,
                friction: 0.985,
            });
        }

        const start = performance.now();
        function frame(now) {
            const progress = Math.min((now - start) / duration, 1);
            _ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            for (const p of particles) {
                p.vy += p.gravity;
                p.vx *= p.friction;
                p.vy *= p.friction;
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rotSpeed;
                p.opacity = progress > 0.6 ? 1 - (progress - 0.6) / 0.4 : 1;
                _ctx.save();
                _ctx.translate(p.x, p.y);
                _ctx.rotate(p.rotation);
                _ctx.globalAlpha = Math.max(0, p.opacity);
                _ctx.fillStyle = p.color;
                if (p.shape === 'rect') {
                    _ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
                } else {
                    _ctx.beginPath();
                    _ctx.arc(0, 0, p.size/2, 0, Math.PI*2);
                    _ctx.fill();
                }
                _ctx.restore();
            }
            if (progress < 1) { _raf = requestAnimationFrame(frame); }
            else { _removeCanvas(); }
        }
        _raf = requestAnimationFrame(frame);
    }

    // =========================================================================
    //  ANIMATED STAT COUNTER
    // =========================================================================
    /**
     * Animate a number counting up from 0 to target in an element.
     * @param {HTMLElement} el - Element whose textContent will be animated
     * @param {number} target - Target number
     * @param {Object} opts - { duration, suffix, prefix }
     */
    function animateCounter(el, target, opts) {
        if (!el) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            el.textContent = (opts && opts.prefix || '') + target + (opts && opts.suffix || '');
            return;
        }

        opts = opts || {};
        const duration = opts.duration || 800;
        const suffix = opts.suffix || '';
        const prefix = opts.prefix || '';
        const start = performance.now();

        function tick(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            const current = Math.round(target * eased);
            el.textContent = prefix + current + suffix;
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    // =========================================================================
    //  CELEBRATION ORCHESTRATOR
    // =========================================================================
    /**
     * Play celebration effects based on success rate.
     * @param {number} successRate - 0..100 success percentage
     * @param {Object} opts
     * @param {boolean} opts.isPerfect - true if 0 errors
     * @param {boolean} opts.isFinalResults - true for S3 (final session results)
     */
    function celebrate(successRate, opts) {
        opts = opts || {};

        if (successRate >= 80 || opts.isPerfect) {
            // Great result — full confetti
            const count = opts.isPerfect ? 120 : 80;
            setTimeout(function () {
                launchConfetti({ particleCount: count });
            }, 400);
        }

        if (opts.isFinalResults && successRate >= 70) {
            // S3: second burst from sides for extra celebration
            setTimeout(function () {
                launchConfetti({ particleCount: 50, originX: 0.15, originY: 0.5, spread: 60 });
            }, 800);
            setTimeout(function () {
                launchConfetti({ particleCount: 50, originX: 0.85, originY: 0.5, spread: 60 });
            }, 1000);
        }
    }

    // =========================================================================
    //  SUCCESS RATE BADGE (animated ring)
    // =========================================================================
    /**
     * Create an animated circular progress ring SVG for success rate.
     * @param {number} percent - 0..100
     * @returns {HTMLElement} SVG element
     */
    function createProgressRing(percent) {
        const size = 64;
        const stroke = 5;
        const radius = (size - stroke) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percent / 100) * circumference;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
        svg.style.cssText = 'transform: rotate(-90deg);';

        // Background circle
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', String(size/2));
        bgCircle.setAttribute('cy', String(size/2));
        bgCircle.setAttribute('r', String(radius));
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--color-border-subtle, #e5e7eb)');
        bgCircle.setAttribute('stroke-width', String(stroke));

        // Progress circle
        const progCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        progCircle.setAttribute('cx', String(size/2));
        progCircle.setAttribute('cy', String(size/2));
        progCircle.setAttribute('r', String(radius));
        progCircle.setAttribute('fill', 'none');
        progCircle.setAttribute('stroke-width', String(stroke));
        progCircle.setAttribute('stroke-linecap', 'round');

        const color = percent >= 80 ? 'var(--color-success, #22c55e)'
                     : percent >= 60 ? 'var(--color-warning, #f59e0b)'
                     : 'var(--color-error, #ef4444)';
        progCircle.setAttribute('stroke', color);

        progCircle.style.strokeDasharray = circumference;
        progCircle.style.strokeDashoffset = String(circumference);
        progCircle.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.65, 0, 0.35, 1) 0.3s';

        svg.appendChild(bgCircle);
        svg.appendChild(progCircle);

        // Trigger animation after insertion
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                progCircle.style.strokeDashoffset = String(offset);
            });
        });

        return svg;
    }

    // =========================================================================
    //  PUBLIC API
    // =========================================================================
    root.CelebrationEffects = {
        launchConfetti: launchConfetti,
        animateCounter: animateCounter,
        celebrate: celebrate,
        createProgressRing: createProgressRing,
    };

}(typeof self !== 'undefined' ? self : this));
