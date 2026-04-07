// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SessionState = require('../../../frontend/S1/session-state');
const UIHelpers = require('../../../frontend/S1/ui-helpers');

describe('UIHelpers.updateNextButtonState', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        SessionState.canGoNext = false;
        SessionState.currentTaskChecked = false;
        SessionState.isLoading = false;
    });

    it('hides next button when task is not checked even if canGoNext is stale', () => {
        document.body.innerHTML = '<button id="next-task-btn"></button>';
        SessionState.canGoNext = true;
        SessionState.currentTaskChecked = false;

        UIHelpers.updateNextButtonState();

        const nextBtn = document.getElementById('next-task-btn');
        expect(nextBtn.disabled).toBe(true);
        expect(nextBtn.classList.contains('hidden')).toBe(true);
    });

    it('shows next button only after the current task is checked', () => {
        document.body.innerHTML = '<button id="next-task-btn" class="hidden"></button>';
        SessionState.currentTaskChecked = true;

        UIHelpers.setCanGoNext(true);

        const nextBtn = document.getElementById('next-task-btn');
        expect(nextBtn.disabled).toBe(false);
        expect(nextBtn.classList.contains('hidden')).toBe(false);
    });
});
