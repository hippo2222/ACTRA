import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 6: Frontend API Waterfall Parallelization', () => {
  describe('Catalog (catalog.js)', () => {
    const catalogPath = path.resolve(process.cwd(), 'frontend/Catalog/catalog.js');
    const catalogCode = fs.readFileSync(catalogPath, 'utf-8');

    it('parallelizes loadCurrentUser, loadWorkspaceLimits, and loadCatalogItems via Promise.all', () => {
      // Must not contain the old sequential await waterfall
      expect(catalogCode).not.toMatch(/await loadCurrentUser\(\);\s*await loadWorkspaceLimits\(\);\s*await loadCatalogItems\(\);/);
      // Must contain Promise.all parallelization for catalog items
      expect(catalogCode).toMatch(/await Promise\.all\(\s*\[\s*loadCurrentUser\(\),\s*loadWorkspaceLimits\(\),\s*loadCatalogItems\(\)\s*\]\s*\)/);
    });

    it('handles saved complex mode safely with sequential auth check before library fetch', () => {
      expect(catalogCode).toMatch(/if\s*\(state\.contentType === ['"]saved['"]\)\s*\{[\s\S]*?await loadCurrentUser\(\);[\s\S]*?await Promise\.all\(\s*\[\s*loadWorkspaceLimits\(\),\s*loadCatalogItems\(\)\s*\]\s*\);/);
    });
  });

  describe('Statistics (statistics.js)', () => {
    const statsPath = path.resolve(process.cwd(), 'frontend/statistics/statistics.js');
    const statsCode = fs.readFileSync(statsPath, 'utf-8');

    it('parallelizes loadUserProfile and loadData via Promise.all in init()', () => {
      // Must not contain old sequential await waterfall
      expect(statsCode).not.toMatch(/await this\.loadUserProfile\(\);\s*await this\.loadData\(\);/);
      // Must contain Promise.all for profile and stats data
      expect(statsCode).toMatch(/await Promise\.all\(\s*\[\s*this\.loadUserProfile\(\),\s*this\.loadData\(\)\s*\]\s*\);/);
    });
  });

  describe('Complexes (complexes.js)', () => {
    const complexesPath = path.resolve(process.cwd(), 'frontend/Complexes/complexes.js');
    const complexesCode = fs.readFileSync(complexesPath, 'utf-8');

    it('includes calendar health in the main Promise.all to avoid post-list waterfall', () => {
      // Promise.all must contain /api/calendar/health with safe catch
      expect(complexesCode).toMatch(/Promise\.all\(\s*\[[\s\S]*?fetch\(\s*["']\/api\/complexes["']\s*\),[\s\S]*?fetch\(\s*["']\/api\/calendar\/health["']\s*\)\.catch\(/);
      // Must not contain serial await fetch("/api/calendar/health")
      expect(complexesCode).not.toMatch(/const\s+healthResp\s*=\s*await\s+fetch\(\s*["']\/api\/calendar\/health["']\s*\);/);
    });
  });

  describe('Main Screen (MainLogic.js)', () => {
    const mainLogicPath = path.resolve(process.cwd(), 'frontend/assets/MainLogic.js');
    const mainLogicCode = fs.readFileSync(mainLogicPath, 'utf-8');

    it('launches premiumBannerPromise and userSettingsPromise in wave-1 concurrently with loadCurrentUser', () => {
      // Must initialize premium banner and user settings promises before awaiting loadCurrentUser
      expect(mainLogicCode).toMatch(/const premiumBannerPromise\s*=\s*loadPremiumArchiveBanner\(\);\s*const userSettingsPromise\s*=\s*loadUserSettings\(\);\s*await loadCurrentUser\(\);/);
      // Critical widgets await all settled concurrently
      expect(mainLogicCode).toMatch(/const criticalWidgetLoads\s*=\s*await Promise\.allSettled\(\s*\[\s*premiumBannerPromise,\s*loadQuickAccess\(\),\s*userSettingsPromise,?\s*\]\s*\);/);
    });
  });
});
