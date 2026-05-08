(function () {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 12000;
  let readyCalled = false;
  let hideTimer = null;
  let timeoutTimer = null;

  function getBootScreen() {
    return document.querySelector('.actra-page-boot-screen');
  }

  function getTimeoutMs() {
    const raw = document.body?.dataset?.pageBootTimeoutMs;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 1000 ? value : DEFAULT_TIMEOUT_MS;
  }

  function clearTimers() {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (timeoutTimer) {
      window.clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  }

  function ready() {
    if (readyCalled) return;
    readyCalled = true;
    clearTimers();

    document.body?.classList.remove('actra-page-booting');
    const bootScreen = getBootScreen();
    if (bootScreen) {
      hideTimer = window.setTimeout(() => {
        bootScreen.setAttribute('aria-hidden', 'true');
        hideTimer = null;
      }, 280);
    }
  }

  function show() {
    readyCalled = false;
    clearTimers();
    const bootScreen = getBootScreen();
    if (bootScreen) bootScreen.removeAttribute('aria-hidden');
    document.body?.classList.add('actra-page-booting');
    armTimeout();
  }

  function armTimeout() {
    if (!document.body?.classList.contains('actra-page-booting')) return;
    if (timeoutTimer) window.clearTimeout(timeoutTimer);
    timeoutTimer = window.setTimeout(ready, getTimeoutMs());
  }

  window.PageBoot = {
    ready,
    fail: ready,
    show,
    isReady: () => readyCalled,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', armTimeout, { once: true });
  } else {
    armTimeout();
  }
})();
