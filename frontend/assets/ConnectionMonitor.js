/**
 * ConnectionMonitor.js
 * Lightweight global connectivity detector for the desktop app.
 * Distinguishes local server outage from internet outage.
 */
(function () {
    'use strict';

    const HEALTH_URL = '/api/health';
    const NETWORK_URL = '/api/network/status';
    const ONLINE_INTERVAL_MS = 15000;
    const INTERNET_RETRY_INTERVAL_MS = 10000;
    const SERVER_RETRY_INTERVAL_MS = 5000;
    const PING_TIMEOUT_MS = 5000;

    let bannerEl = null;
    function wt(key, fallback) {
        if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
        var v = window.i18n.t(key);
        return v !== key ? v : fallback;
    }
    // Keep internet_offline for retry cadence, but avoid a global banner for it:
    // feature-level UI can explain availability more precisely.
    let currentState = 'ok'; // ok | server_offline | internet_offline
    let timerId = null;

    function createBanner() {
        if (document.getElementById('connection-monitor-banner')) return;
        const el = document.createElement('div');
        el.id = 'connection-monitor-banner';
        el.className = 'fixed top-0 left-0 right-0 z-[10000] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium shadow-lg transition-transform duration-300 border-b';
        el.style.transform = 'translateY(-100%)';
        el.setAttribute('role', 'status');
        document.body.prepend(el);
        bannerEl = el;
    }

    function adjustLayout(bannerHeight) {
        const h = bannerHeight || 0;
        document.documentElement.style.setProperty('--connection-banner-height', h ? h + 'px' : '0px');
        document.body.style.paddingTop = h ? h + 'px' : '';
        // Offset sticky / fixed headers so they sit below the banner.
        document.querySelectorAll('header.sticky, header[class*="sticky"]').forEach(el => {
            el.style.top = h ? h + 'px' : '';
        });
    }

    function showBanner() {
        if (!bannerEl) createBanner();
        if (bannerEl) {
            bannerEl.style.transform = 'translateY(0)';
            requestAnimationFrame(() => adjustLayout(bannerEl.offsetHeight));
        }
    }

    function hideBanner() {
        if (bannerEl) {
            bannerEl.style.transform = 'translateY(-100%)';
            adjustLayout(0);
        }
    }

    function setBannerState(state) {
        if (!bannerEl) createBanner();
        if (!bannerEl) return;

        if (state === 'server_offline') {
            bannerEl.className = 'fixed top-0 left-0 right-0 z-[10000] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium shadow-lg transition-transform duration-300 border-b bg-error text-white border-error';
            bannerEl.innerHTML = '<span class="material-symbols-outlined text-base">cloud_off</span> ' + wt('notify.server_offline', 'Потеряна связь с локальным сервером');
            showBanner();
            return;
        }

        if (state === 'internet_offline') {
            hideBanner();
            return;
        }

        hideBanner();
    }

    async function timedFetch(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
        try {
            return await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                cache: 'no-store',
            });
        } finally {
            clearTimeout(timer);
        }
    }

    function setState(nextState) {
        currentState = nextState;
        setBannerState(nextState);
    }

    async function ping() {
        try {
            const healthResp = await timedFetch(HEALTH_URL);
            if (!healthResp || !healthResp.ok) {
                setState('server_offline');
                schedule();
                return;
            }

            const networkResp = await timedFetch(NETWORK_URL);
            if (!networkResp || !networkResp.ok) {
                setState('ok');
                schedule();
                return;
            }

            const payload = await networkResp.json();
            if (payload && payload.ok && payload.internet_online === false) {
                setState('internet_offline');
            } else {
                setState('ok');
            }
        } catch (_e) {
            setState('server_offline');
        }
        schedule();
    }

    function schedule() {
        if (timerId) clearTimeout(timerId);
        let nextDelay = ONLINE_INTERVAL_MS;
        if (currentState === 'server_offline') {
            nextDelay = SERVER_RETRY_INTERVAL_MS;
        } else if (currentState === 'internet_offline') {
            nextDelay = INTERNET_RETRY_INTERVAL_MS;
        }
        timerId = setTimeout(ping, nextDelay);
    }

    function init() {
        createBanner();
        window.addEventListener('online', ping);
        window.addEventListener('offline', ping);
        ping();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
