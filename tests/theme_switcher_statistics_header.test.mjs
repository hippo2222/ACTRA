/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('ThemeSwitcherUI statistics header placement', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <header class="stats-header">
                <div class="stats-header-end">
                    <button class="stats-user-chip">Profile</button>
                </div>
            </header>
        `;

        window.ThemeManager = {
            getTheme: vi.fn(() => 'light-a'),
            setTheme: vi.fn()
        };

        delete require.cache[require.resolve('../frontend/assets/ThemeSwitcherUI.js')];
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete window.ThemeManager;
    });

    it('injects the switcher into the statistics header before the profile button', () => {
        require('../frontend/assets/ThemeSwitcherUI.js');
        document.dispatchEvent(new Event('DOMContentLoaded'));

        const headerActions = document.querySelector('.stats-header-end');
        const container = document.getElementById('theme-switcher-container');
        const profileChip = document.querySelector('.stats-user-chip');

        expect(container).not.toBeNull();
        expect(headerActions.firstElementChild).toBe(container);
        expect(container.nextElementSibling).toBe(profileChip);
        expect(container.style.position).not.toBe('fixed');
    });
});
