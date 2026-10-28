import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Phase 5: PageBoot Grace Period & Modern View Transitions', () => {
  describe('PageBoot.css', () => {
    const cssPath = path.resolve(process.cwd(), 'frontend/assets/PageBoot.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    it('defines 150ms grace period on actra-page-boot-card to prevent flash on fast loads', () => {
      expect(cssContent).toMatch(/\.actra-page-boot-card\s*\{[^}]*opacity:\s*0/s);
      expect(cssContent).toMatch(/\.actra-page-boot-card\s*\{[^}]*transition:\s*opacity\s+200ms\s+ease\s+150ms/s);
    });

    it('reveals actra-page-boot-card when body has actra-page-booting', () => {
      expect(cssContent).toMatch(/body\.actra-page-booting\s+\.actra-page-boot-card\s*\{\s*opacity:\s*1;\s*\}/);
    });

    it('disables transitions under prefers-reduced-motion', () => {
      expect(cssContent).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.actra-page-boot-card/s);
    });
  });

  describe('animations.css', () => {
    const cssPath = path.resolve(process.cwd(), 'frontend/assets/animations.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    it('enables native cross-document view transitions for modern browsers', () => {
      expect(cssContent).toMatch(/@view-transition\s*\{\s*navigation:\s*auto;\s*\}/);
    });
  });

  describe('ThemeManager PageTransition', () => {
    let dom;

    beforeEach(() => {
      dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>`, {
        url: 'http://localhost:8000/main',
        runScripts: 'outside-only',
      });
      dom.window.CSS = {
        supports: vi.fn(),
      };
      dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    });

    afterEach(() => {
      dom.window.close();
    });

    it('detects native view transition support when available', () => {
      const code = fs.readFileSync(path.resolve(process.cwd(), 'frontend/assets/ThemeManager.js'), 'utf-8');
      dom.window.eval(code);

      // Default JSDOM without startViewTransition
      expect(dom.window.PageTransition?.hasNativeViewTransition?.() || false).toBe(false);

      // Mock startViewTransition + CSS.supports('view-transition-name', 'none')
      dom.window.document.startViewTransition = vi.fn();
      dom.window.CSS.supports = vi.fn().mockReturnValue(true);

      expect(dom.window.PageTransition.hasNativeViewTransition()).toBe(true);
    });

    it('skips JS enter animation and navigates immediately when native view transition is supported', () => {
      const code = fs.readFileSync(path.resolve(process.cwd(), 'frontend/assets/ThemeManager.js'), 'utf-8');
      dom.window.eval(code);

      dom.window.document.startViewTransition = vi.fn();
      dom.window.CSS.supports = vi.fn().mockReturnValue(true);

      const root = dom.window.document.getElementById('root');
      dom.window.PageTransition.applyEnterTransition();
      expect(root.classList.contains('app-page-enter')).toBe(false);

      const navigateSpy = vi.spyOn(dom.window.PageTransition, '_doNavigate').mockImplementation(() => {});

      dom.window.PageTransition.navigate('/calendar');
      expect(navigateSpy).toHaveBeenCalledWith('/calendar', false);
    });
  });

  describe('PageBoot.js runtime behavior', () => {
    let dom;

    beforeEach(() => {
      dom = new JSDOM(`<!DOCTYPE html>
        <html lang="ru">
        <body class="actra-page-booting">
          <div class="actra-page-boot-screen">
            <div class="actra-page-boot-card">
              <img class="actra-page-boot-logo" src="/assets/logo_animated.svg" alt="ACTRA" />
            </div>
          </div>
          <main id="app">Content</main>
        </body>
        </html>`, {
        url: 'http://localhost:8000/main',
        runScripts: 'outside-only',
      });
    });

    afterEach(() => {
      dom.window.close();
    });

    it('ready() removes actra-page-booting class immediately', () => {
      const code = fs.readFileSync(path.resolve(process.cwd(), 'frontend/assets/PageBoot.js'), 'utf-8');
      dom.window.eval(code);

      expect(dom.window.document.body.classList.contains('actra-page-booting')).toBe(true);
      dom.window.PageBoot.ready();
      expect(dom.window.document.body.classList.contains('actra-page-booting')).toBe(false);
      expect(dom.window.PageBoot.isReady()).toBe(true);
    });

    it('ready() is idempotent when called multiple times', () => {
      const code = fs.readFileSync(path.resolve(process.cwd(), 'frontend/assets/PageBoot.js'), 'utf-8');
      dom.window.eval(code);

      dom.window.PageBoot.ready();
      dom.window.PageBoot.ready();
      expect(dom.window.PageBoot.isReady()).toBe(true);
    });
  });

  describe('Template Standardizations', () => {
    const screens = [
      'frontend/MainScreen/Main.html',
      'frontend/Calendar/calendar.html',
      'frontend/Complexes/index.html',
      'frontend/Complexes/create.html',
      'frontend/Editor/Main_Dashboard.html',
      'frontend/Editor/Theory_Center.html',
      'frontend/Editor/Theory_Editor.html',
      'frontend/Settings/settings.html',
      'frontend/Reference/index.html',
    ];

    it.each(screens)('screen %s includes PageBoot.css, PageBoot.js and actra-page-boot-screen', (file) => {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
      expect(content).toContain('PageBoot.css');
      expect(content).toContain('PageBoot.js');
      expect(content).toContain('actra-page-boot-screen');
      expect(content).toContain('actra-page-booting');
    });

    it('calendar.html does not contain duplicate #calendarInitialLoading', () => {
      const content = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Calendar/calendar.html'), 'utf-8');
      expect(content).not.toContain('id="calendarInitialLoading"');
    });
  });
});
