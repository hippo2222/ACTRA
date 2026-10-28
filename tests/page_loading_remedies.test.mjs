import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Audit Remedies: Edge Case & Deadlock Hardening', () => {
  describe('Main Screen Deadlock Prevention & Header Cache Hydration', () => {
    const mainLogic = fs.readFileSync(path.resolve(process.cwd(), 'frontend/assets/MainLogic.js'), 'utf-8');

    it('dismisses PageBoot before opening the Consent Gate modal', () => {
      expect(mainLogic).toMatch(/finishMainBoot\(\);\s*return openMainConsentGate\(userId,\s*required\);/);
      expect(mainLogic).toMatch(/function openMainConsentGate\(userId,\s*required\)\s*\{\s*finishMainBoot\(\);/);
    });

    it('synchronously hydrates currentUser from GlobalHeader cache before network calls', () => {
      expect(mainLogic).toMatch(/const cachedUser = window\.GlobalHeader && typeof window\.GlobalHeader\.getCachedUser === 'function'\s*\?\s*window\.GlobalHeader\.getCachedUser\(\)\s*:\s*null;/);
      expect(mainLogic).toMatch(/updateHeaderUser\(currentUser\);[\s\S]*?const premiumBannerPromise = loadPremiumArchiveBanner\(\);/);
    });
  });

  describe('Theory Editor Script Ordering & Draft Modal Deadlock Prevention', () => {
    const teHtml = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Editor/Theory_Editor.html'), 'utf-8');
    const teJs = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Editor/theory_editor.js'), 'utf-8');

    it('orders i18n.js before theory_editor.js in <head> for proper defer execution sequence', () => {
      const i18nIdx = teHtml.indexOf('src="/assets/i18n.js"');
      const editorIdx = teHtml.indexOf('src="/editor/theory_editor.js');
      expect(i18nIdx).toBeGreaterThan(-1);
      expect(editorIdx).toBeGreaterThan(-1);
      expect(i18nIdx).toBeLessThan(editorIdx);
    });

    it('dismisses PageBoot before opening the restoreTheoryDraft modal in loadTheoryById', () => {
      expect(teJs).toMatch(/window\.PageBoot\?\.ready\(\);\s*await restoreTheoryDraftIfPresent\(theoryEditorState\.activeTheoryId\);/);
    });

    it('wraps DOMContentLoaded initialization in try/finally { PageBoot.ready() }', () => {
      expect(teJs).toMatch(/document\.addEventListener\(["']DOMContentLoaded["'],\s*async\s*\(\)\s*=>\s*\{\s*try\s*\{[\s\S]*?\}\s*finally\s*\{\s*window\.PageBoot\?\.ready\(\);\s*\}\s*\}\);/);
    });
  });

  describe('Statistics User ID Race Elimination', () => {
    const statsJs = fs.readFileSync(path.resolve(process.cwd(), 'frontend/statistics/statistics.js'), 'utf-8');

    it('falls back to GlobalHeader cached userId in getCurrentUserQuery()', () => {
      expect(statsJs).toMatch(/const cachedUser = window\.GlobalHeader && typeof window\.GlobalHeader\.getCachedUser === 'function'/);
      expect(statsJs).toMatch(/const userId = this\.state\.currentUser\?\.user_id \|\| cachedUser\?\.userId \|\| cachedUser\?\.user_id;/);
    });

    it('synchronously hydrates this.state.currentUser in init() from GlobalHeader cache', () => {
      expect(statsJs).toMatch(/if \(cachedUser && !this\.state\.currentUser\) \{\s*this\.state\.currentUser = \{/);
    });
  });

  describe('bfcache & pageshow State Restoration', () => {
    const tmJs = fs.readFileSync(path.resolve(process.cwd(), 'frontend/assets/ThemeManager.js'), 'utf-8');
    const pbJs = fs.readFileSync(path.resolve(process.cwd(), 'frontend/assets/PageBoot.js'), 'utf-8');

    it('ThemeManager unlocks target and removes leave transition on pageshow', () => {
      expect(tmJs).toMatch(/target\.removeAttribute\(PageTransition\.lockAttr\);/);
      expect(tmJs).toMatch(/target\.classList\.remove\(PageTransition\.transitionClass,\s*PageTransition\.leaveClass\);/);
    });

    it('PageBoot automatically calls ready() on pageshow when event.persisted is true', () => {
      expect(pbJs).toMatch(/window\.addEventListener\(["']pageshow["'],\s*\(event\)\s*=>\s*\{\s*if\s*\(event\.persisted\)\s*\{\s*ready\(\);\s*\}\s*\}\);/);
    });
  });

  describe('PageBoot Resilience Across Screens', () => {
    const cxHtml = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Complexes/create.html'), 'utf-8');
    const refJs = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Reference/reference.js'), 'utf-8');
    const calHtml = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Calendar/calendar.html'), 'utf-8');

    it('create.html uses try/finally for PageBoot.ready()', () => {
      expect(cxHtml).toMatch(/document\.addEventListener\(['"]DOMContentLoaded['"],\s*async\s*\(\)\s*=>\s*\{\s*try\s*\{[\s\S]*?\}\s*finally\s*\{\s*window\.PageBoot\?\.ready\(\);\s*\}\s*\}\);/);
    });

    it('reference.js uses try/finally in init()', () => {
      expect(refJs).toMatch(/function init\(root\)\s*\{\s*try\s*\{[\s\S]*?\}\s*finally\s*\{\s*window\.PageBoot\?\.ready\(\);\s*\}\s*\}/);
    });

    it('calendar.html calls PageBoot.ready() on QA Preview early exit', () => {
      expect(calHtml).toMatch(/if \(isCalendarQaPreview\(\)\)\s*\{[\s\S]*?if \(isInitialLoad\) \{\s*window\.PageBoot\?\.ready\(\);\s*\}[\s\S]*?return;/);
    });
  });
});
