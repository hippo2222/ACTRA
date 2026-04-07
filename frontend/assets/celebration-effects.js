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
        const baseAngle = opts.baseAngle != null ? opts.baseAngle : -Math.PI / 2;
        const spread = (opts.spread || 90) * Math.PI / 180;
        const duration = opts.duration || 2200;
        const sizeMultiplier = opts.sizeMultiplier || 1;
        const speedMultiplier = opts.speedMultiplier || 1;
        const origins = Array.isArray(opts.origins) && opts.origins.length
            ? opts.origins
            : [{ particleCount: count, originX: originX, originY: originY, baseAngle: baseAngle }];

        _ensureCanvas();
        const dpr = window.devicePixelRatio || 1;
        _canvas.width = window.innerWidth * dpr;
        _canvas.height = window.innerHeight * dpr;
        _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const colors = _getConfettiColors();

        const particles = [];
        origins.forEach(function (source) {
            const sourceCount = source && source.particleCount != null ? source.particleCount : count;
            const sourceX = source && source.originX != null ? source.originX : originX;
            const sourceY = source && source.originY != null ? source.originY : originY;
            const sourceAngle = source && source.baseAngle != null ? source.baseAngle : baseAngle;
            const cx = window.innerWidth * sourceX;
            const cy = window.innerHeight * sourceY;

            for (let i = 0; i < sourceCount; i++) {
                const angle = sourceAngle + (Math.random() - 0.5) * spread;
                const speed = (3 + Math.random() * 7) * speedMultiplier;
                particles.push({
                    x: cx, y: cy,
                    vx: Math.cos(angle) * speed * (0.5 + Math.random()),
                    vy: Math.sin(angle) * speed * (0.5 + Math.random()),
                    size: (4 + Math.random() * 5) * sizeMultiplier,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    rotation: Math.random() * Math.PI * 2,
                    rotSpeed: (Math.random() - 0.5) * 0.3,
                    opacity: 1,
                    shape: Math.random() > 0.4 ? 'rect' : 'circle',
                    gravity: 0.10 + Math.random() * 0.05,
                    friction: 0.985,
                });
            }
        });

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

    function _resolveContainedElements(containedOpts) {
        const opts = containedOpts === true ? {} : (containedOpts || {});
        const selectors = Array.isArray(opts.selectors) ? opts.selectors : [];
        const explicitElements = Array.isArray(opts.elements) ? opts.elements : [];
        const nodes = [];

        selectors.forEach(function (selector) {
            if (typeof selector !== 'string' || !selector.trim()) return;
            try {
                document.querySelectorAll(selector).forEach(function (node) {
                    nodes.push(node);
                });
            } catch (_) { }
        });

        explicitElements.forEach(function (node) {
            if (node && typeof node.animate === 'function') {
                nodes.push(node);
            }
        });

        if (!nodes.length) {
            ['#iteration-hero', '.s2-metric-card', '#breakdown-panel'].forEach(function (selector) {
                try {
                    document.querySelectorAll(selector).forEach(function (node) {
                        nodes.push(node);
                    });
                } catch (_) { }
            });
        }

        const unique = [];
        const seen = new Set();
        nodes.forEach(function (node) {
            if (!node || seen.has(node)) return;
            seen.add(node);
            unique.push(node);
        });
        return unique;
    }

    function _pulseContainedElements(elements, successRate) {
        if (!Array.isArray(elements) || !elements.length) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const emphasis = successRate >= 90 ? 1 : successRate >= 75 ? 0.82 : 0.68;
        const shadowOpacity = (0.12 + emphasis * 0.16).toFixed(3);
        const lift = successRate >= 90 ? -5 : -3;

        elements.forEach(function (el, index) {
            if (!el || typeof el.animate !== 'function') return;

            const delay = Math.min(index * 70, 240);
            const originalWillChange = el.style.willChange || '';
            el.style.willChange = 'transform, box-shadow, filter';

            try {
                const animation = el.animate([
                    {
                        transform: 'translateY(0px) scale(1)',
                        boxShadow: '0 16px 34px rgba(15, 23, 42, 0.08)',
                        filter: 'saturate(1)',
                    },
                    {
                        transform: 'translateY(' + lift + 'px) scale(1.01)',
                        boxShadow: '0 24px 44px rgba(15, 23, 42, ' + shadowOpacity + ')',
                        filter: 'saturate(' + (1 + emphasis * 0.14).toFixed(2) + ')',
                    },
                    {
                        transform: 'translateY(0px) scale(1)',
                        boxShadow: '0 16px 34px rgba(15, 23, 42, 0.08)',
                        filter: 'saturate(1)',
                    }
                ], {
                    duration: 760,
                    delay: delay,
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    fill: 'none',
                });

                if (animation && animation.finished && typeof animation.finished.finally === 'function') {
                    animation.finished.finally(function () {
                        el.style.willChange = originalWillChange;
                    });
                } else {
                    setTimeout(function () {
                        el.style.willChange = originalWillChange;
                    }, 1000);
                }
            } catch (_) {
                el.style.willChange = originalWillChange;
            }
        });
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

        if (opts.contained) {
            _pulseContainedElements(_resolveContainedElements(opts.contained), successRate);
            return;
        }

        if (successRate >= 80 || opts.isPerfect) {
            const count = opts.isPerfect ? 120 : 96;
            setTimeout(function () {
                launchConfetti({
                    particleCount: count,
                    origins: [
                        {
                            particleCount: Math.ceil(count / 2),
                            originX: -0.018,
                            originY: 1.025,
                            baseAngle: -Math.PI * 0.31,
                        },
                        {
                            particleCount: Math.floor(count / 2),
                            originX: 1.018,
                            originY: 1.025,
                            baseAngle: -Math.PI * 0.69,
                        }
                    ],
                    spread: 24,
                    duration: 1900,
                    sizeMultiplier: 1.95,
                    speedMultiplier: 1.22,
                });
            }, 360);
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
