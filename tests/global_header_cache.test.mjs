/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

function loadScript(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

describe('GlobalHeader profile caching & anti-shift (Phase 2)', () => {
    let originalSessionStorage;

    beforeEach(() => {
        document.body.innerHTML = '<div data-global-header data-app-section="complexes"></div>';
        window.sessionStorage.clear();
        delete window.GlobalHeader;

        // Mock fetch
        window.fetch = vi.fn(async (url) => {
            if (url === '/api/users/current') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        ok: true,
                        user: {
                            display_name: 'Dr. John Doe',
                            avatar_seed: 'doctor_avatar.png',
                            effective_plan: 'premium',
                        },
                    }),
                };
            }
            return { ok: true, status: 200, json: async () => ({ ok: true }) };
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        window.sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it('renders with cached profile immediately without flashing loading string or default avatar', () => {
        // Pre-populate sessionStorage with cached user from previous page
        window.sessionStorage.setItem('actra_header_user_cache', JSON.stringify({
            displayName: 'Alice Specialist',
            avatarSeed: 'specialist.png',
            effectivePlan: 'premium',
        }));

        // Execute GlobalHeader script
        window.eval(loadScript('frontend/assets/GlobalHeader.js'));

        const nameEl = document.getElementById('headerUserName');
        const avatarEl = document.getElementById('headerAvatar');
        const planBadge = document.querySelector('[data-global-plan-badge]');
        const root = document.querySelector('[data-global-header]');

        // Immediately upon mount, values must be from cache
        expect(nameEl.textContent).toBe('Alice Specialist');
        expect(avatarEl.src).toContain('/api/assets/avatars/specialist.png');
        expect(planBadge.hidden).toBe(false);
        expect(planBadge.textContent).toBe('Premium');
        expect(planBadge.classList.contains('is-premium')).toBe(true);
        expect(root.dataset.globalHeaderReady).toBe('1');
    });

    it('updates cache and DOM on successful hydrateUser when cache was empty', async () => {
        window.eval(loadScript('frontend/assets/GlobalHeader.js'));

        // Initially without cache
        const nameEl = document.getElementById('headerUserName');
        expect(nameEl.textContent).toBe('header.profile_loading');

        // Wait for fetch to complete
        await new Promise((r) => setTimeout(r, 20));

        expect(nameEl.textContent).toBe('Dr. John Doe');
        const cachedRaw = window.sessionStorage.getItem('actra_header_user_cache');
        expect(cachedRaw).toBeTruthy();
        const cached = JSON.parse(cachedRaw);
        expect(cached.displayName).toBe('Dr. John Doe');
        expect(cached.avatarSeed).toBe('doctor_avatar.png');
        expect(cached.effectivePlan).toBe('premium');
    });

    it('clears user cache on window.GlobalHeader.clearUserCache() and actra:user_logged_out', () => {
        window.sessionStorage.setItem('actra_header_user_cache', JSON.stringify({
            displayName: 'Alice Specialist',
            avatarSeed: 'specialist.png',
            effectivePlan: 'free',
        }));

        window.eval(loadScript('frontend/assets/GlobalHeader.js'));
        expect(window.GlobalHeader.getCachedUser()?.displayName).toBe('Alice Specialist');

        window.GlobalHeader.clearUserCache();
        expect(window.GlobalHeader.getCachedUser()).toBeNull();
        expect(window.sessionStorage.getItem('actra_header_user_cache')).toBeNull();

        // Re-set and test event
        window.GlobalHeader.setCachedUser({ name: 'Bob' });
        expect(window.GlobalHeader.getCachedUser()?.displayName).toBe('Bob');

        window.dispatchEvent(new CustomEvent('actra:user_logged_out'));
        expect(window.GlobalHeader.getCachedUser()).toBeNull();
    });

    it('updates plan to premium immediately on actra:premium_activated', () => {
        window.sessionStorage.setItem('actra_header_user_cache', JSON.stringify({
            displayName: 'Alice Specialist',
            avatarSeed: 'specialist.png',
            effectivePlan: 'free',
        }));

        window.eval(loadScript('frontend/assets/GlobalHeader.js'));
        const planBadge = document.querySelector('[data-global-plan-badge]');
        expect(planBadge.textContent).toBe('Free');
        expect(planBadge.classList.contains('is-premium')).toBe(false);

        window.dispatchEvent(new CustomEvent('actra:premium_activated'));

        const updatedBadge = document.querySelector('[data-global-plan-badge]');
        expect(updatedBadge.textContent).toBe('Premium');
        expect(updatedBadge.classList.contains('is-premium')).toBe(true);
        expect(window.GlobalHeader.getCachedUser()?.effectivePlan).toBe('premium');
    });
});
