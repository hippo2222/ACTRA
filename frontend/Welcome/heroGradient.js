(function () {
    'use strict';

    /* ── Reduced-motion guard ── */
    const prefersReducedMotion =
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;           // keep static CSS gradient as fallback

    /* ── DOM elements ── */
    const heroSection = document.querySelector('.welcome-hero');
    const canvas = document.getElementById('heroGradientCanvas');
    if (!heroSection || !canvas) return;

    const ctx = canvas.getContext('2d');

    /* ── Logo animation (15 s cooldown, single-play via CSS class on SVG) ── */
    const heroLogo = document.getElementById('heroLogo');
    let lastLogoTrigger = 0;
    let logoAnimating = false;
    let logoAnimTimer = null;
    const LOGO_COOLDOWN_MS = 15000;
    const LOGO_CYCLE_MS = 4100;

    function triggerLogoAnimation() {
        if (!heroLogo) return;
        if (logoAnimating) return;

        const now = Date.now();
        if (now - lastLogoTrigger < LOGO_COOLDOWN_MS) return;
        lastLogoTrigger = now;
        logoAnimating = true;

        // Add .animating → swaps orbit paths & starts CSS animations
        // Reflow trick guarantees animation restart from frame 0
        heroLogo.classList.remove('animating');
        void heroLogo.offsetWidth;
        heroLogo.classList.add('animating');

        // After one full cycle, remove class → back to static logo
        if (logoAnimTimer) clearTimeout(logoAnimTimer);
        logoAnimTimer = setTimeout(() => {
            heroLogo.classList.remove('animating');
            logoAnimating = false;
            logoAnimTimer = null;
        }, LOGO_CYCLE_MS);
    }

    /* ── Read theme colors from CSS variables ── */
    function getCSSColor(varName, fallback) {
        const val = getComputedStyle(document.documentElement)
            .getPropertyValue(varName).trim();
        return val || fallback;
    }

    function hexToRGB(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        return {
            r: parseInt(hex.substring(0, 2), 16),
            g: parseInt(hex.substring(2, 4), 16),
            b: parseInt(hex.substring(4, 6), 16),
        };
    }

    function parseColor(str) {
        str = str.trim();
        if (str.startsWith('#')) return hexToRGB(str);
        const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) return { r: +m[1], g: +m[2], b: +m[3] };
        return { r: 80, g: 60, b: 180 };
    }

    /* ── Color helpers ── */
    function readThemeColors() {
        return [
            parseColor(getCSSColor('--color-primary', '#6366f1')),
            parseColor(getCSSColor('--color-accent-dark', '#7c3aed')),
            parseColor(getCSSColor('--color-primary-dark', '#4338ca')),
            parseColor(getCSSColor('--color-primary-darker', '#312e81')),
        ];
    }

    function readBaseColor() {
        return parseColor(getCSSColor('--color-primary-darker', '#1e1b4b'));
    }

    function readCursorColor() {
        return parseColor(getCSSColor('--color-primary', '#6366f1'));
    }

    /* ── Blob class ── */
    class Blob {
        constructor(x, y, radius, color) {
            this.x = x;
            this.y = y;
            this.radius = radius;
            this.color = color;
            this.alpha = 0.4;

            const angle = Math.random() * Math.PI * 2;
            const speed = 0.35 + Math.random() * 0.35;     // faster: 0.35–0.70 px/frame
            this.vx = Math.cos(angle) * speed;
            this.vy = Math.sin(angle) * speed;
        }

        update(w, h) {
            this.x += this.vx;
            this.y += this.vy;

            if (this.x - this.radius < 0) { this.x = this.radius; this.vx *= -0.95; }
            if (this.x + this.radius > w) { this.x = w - this.radius; this.vx *= -0.95; }
            if (this.y - this.radius < 0) { this.y = this.radius; this.vy *= -0.95; }
            if (this.y + this.radius > h) { this.y = h - this.radius; this.vy *= -0.95; }
        }

        draw(ctx) {
            const { r, g, b } = this.color;
            const grad = ctx.createRadialGradient(
                this.x, this.y, 0,
                this.x, this.y, this.radius
            );
            grad.addColorStop(0, `rgba(${r},${g},${b},${this.alpha})`);
            grad.addColorStop(0.6, `rgba(${r},${g},${b},${this.alpha * 0.4})`);
            grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
            ctx.fillStyle = grad;
            ctx.fillRect(
                this.x - this.radius, this.y - this.radius,
                this.radius * 2, this.radius * 2
            );
        }
    }

    /* ── Cursor blob (follows mouse with lerp) ── */
    class CursorBlob {
        constructor(color) {
            this.x = 0;
            this.y = 0;
            this.targetX = 0;
            this.targetY = 0;
            this.radius = 0;
            this.targetRadius = 0;
            this.color = color;
            this.alpha = 0;
            this.targetAlpha = 0;
            this.active = false;
        }

        setTarget(x, y, canvasW, canvasH) {
            this.targetX = x;
            this.targetY = y;
            this.targetRadius = Math.min(canvasW, canvasH) * 0.45;
            this.targetAlpha = 0.3;
            this.active = true;
        }

        fadeOut(canvasW, canvasH) {
            this.targetAlpha = 0;
            this.targetX = canvasW / 2;
            this.targetY = canvasH / 2;
        }

        update() {
            const lerpFactor = 0.035;
            this.x += (this.targetX - this.x) * lerpFactor;
            this.y += (this.targetY - this.y) * lerpFactor;
            this.radius += (this.targetRadius - this.radius) * lerpFactor;
            this.alpha += (this.targetAlpha - this.alpha) * 0.04;

            if (this.alpha < 0.002 && this.targetAlpha === 0) {
                this.active = false;
                this.alpha = 0;
            }
        }

        draw(ctx) {
            if (!this.active || this.alpha < 0.002) return;
            const { r, g, b } = this.color;
            const grad = ctx.createRadialGradient(
                this.x, this.y, 0,
                this.x, this.y, this.radius
            );
            grad.addColorStop(0, `rgba(${r},${g},${b},${this.alpha})`);
            grad.addColorStop(0.5, `rgba(${r},${g},${b},${this.alpha * 0.35})`);
            grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
            ctx.fillStyle = grad;
            ctx.fillRect(
                this.x - this.radius, this.y - this.radius,
                this.radius * 2, this.radius * 2
            );
        }
    }

    /* ── Canvas sizing ── */
    let W = 0, H = 0;

    function resize() {
        const rect = heroSection.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        W = rect.width;
        H = rect.height;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* ── Initialize blobs ── */
    function createBlobs() {
        const colors = readThemeColors();
        const blobs = [];
        for (let i = 0; i < 4; i++) {
            const rFactor = 0.3 + Math.random() * 0.25;
            const radius = Math.min(W, H) * rFactor;
            const x = radius + Math.random() * (W - radius * 2);
            const y = radius + Math.random() * (H - radius * 2);
            blobs.push(new Blob(x, y, radius, colors[i % colors.length]));
        }
        return blobs;
    }

    /* ── Main state ── */
    heroSection.classList.add('has-canvas');
    resize();
    let blobs = createBlobs();
    let baseColor = readBaseColor();
    const cursorBlob = new CursorBlob(readCursorColor());

    /* ── Theme change handler — re-read colors ── */
    window.addEventListener('themechanged', () => {
        const colors = readThemeColors();
        blobs.forEach((b, i) => { b.color = colors[i % colors.length]; });
        cursorBlob.color = readCursorColor();
        baseColor = readBaseColor();
    });

    /* ── Event listeners ── */
    window.addEventListener('resize', () => {
        resize();
        blobs.forEach(b => {
            b.x = Math.min(b.x, W - b.radius);
            b.y = Math.min(b.y, H - b.radius);
        });
    });

    heroSection.addEventListener('mouseenter', () => {
        triggerLogoAnimation();
    });

    heroSection.addEventListener('mousemove', (e) => {
        const rect = heroSection.getBoundingClientRect();
        cursorBlob.setTarget(e.clientX - rect.left, e.clientY - rect.top, W, H);
    });

    heroSection.addEventListener('mouseleave', () => {
        cursorBlob.fadeOut(W, H);
        // Don't reset logo — let the timer handle it (single-play)
    });

    /* ── Animation loop ── */
    let animId;

    function frame() {
        // Dark base fill
        ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
        ctx.fillRect(0, 0, W, H);

        // Additive blending for soft glow
        ctx.globalCompositeOperation = 'lighter';

        for (const b of blobs) {
            b.update(W, H);
            b.draw(ctx);
        }

        cursorBlob.update();
        cursorBlob.draw(ctx);

        ctx.globalCompositeOperation = 'source-over';

        animId = requestAnimationFrame(frame);
    }

    frame();

    window.addEventListener('beforeunload', () => {
        if (animId) cancelAnimationFrame(animId);
    });
})();
