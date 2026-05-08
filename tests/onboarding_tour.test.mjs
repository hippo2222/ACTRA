/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
    path.resolve('frontend/assets/OnboardingTour.js'),
    'utf8'
);
const toursSource = fs.readFileSync(
    path.resolve('frontend/assets/onboarding_tours.js'),
    'utf8'
);

const mainTour = {
    tourId: 'main-dashboard-work-contour',
    version: 1,
    route: ['/ui/main'],
    autoStart: true,
    autoStartDelay: 10,
    steps: [
        {
            id: 'main-step',
            targets: ['[data-onboarding-target="main-catalog-card"]'],
            callouts: [
                {
                    target: '[data-onboarding-target="main-catalog-card"]',
                    body: 'Demo callout',
                },
            ],
        },
    ],
};

function installDom(pathname = '/ui/main') {
    history.replaceState(null, '', pathname);
    document.head.innerHTML = '';
    document.body.innerHTML = `
        <main>
            <article data-onboarding-target="main-catalog-card">Catalog</article>
        </main>
    `;
    window.ACTRA_ONBOARDING_TOURS = [{ ...mainTour, steps: mainTour.steps.map((step) => ({ ...step })) }];
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
    document.fonts = undefined;

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.matches?.('[data-onboarding-target="main-catalog-card"]')) {
            return { x: 40, y: 40, left: 40, top: 40, right: 220, bottom: 120, width: 180, height: 80 };
        }
        return { x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 40, width: 120, height: 40 };
    });
}

function loadOnboarding(fetchMock) {
    window.fetch = fetchMock;
    delete window.OnboardingTour;
    window.eval(source);
}

async function settleAutoStart(delayMs = 20) {
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(delayMs);
    await Promise.resolve();
}

describe('OnboardingTour first-run behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        installDom();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete window.ACTRA_ONBOARDING_TOURS;
        delete window.ACTRA_DISABLE_ONBOARDING_FIRST_RUN_PROMPT;
        delete window.OnboardingTour;
    });

    it('offers a first-run choice on the main page and can disable every tour', async () => {
        const fetchMock = vi.fn(async (url, options = {}) => {
            if (url === '/api/ui/settings' && !options.method) {
                return { json: async () => ({ ok: true, settings: {} }) };
            }
            if (url === '/api/ui/settings' && options.method === 'POST') {
                return { json: async () => ({ ok: true }) };
            }
            throw new Error(`Unexpected fetch ${url}`);
        });

        loadOnboarding(fetchMock);
        await settleAutoStart();

        const modal = document.querySelector('[data-onboarding-first-run-modal]');
        expect(modal).not.toBeNull();
        expect(document.body.classList.contains('onboarding-tour-active')).toBe(false);

        modal.querySelector('[data-onboarding-first-run-action="disable"]').click();
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();

        const postCall = fetchMock.mock.calls.find(([url, options]) => url === '/api/ui/settings' && options?.method === 'POST');
        const body = JSON.parse(postCall[1].body);
        expect(body.settings.onboarding.disabled).toBe(true);
        expect(body.settings.onboarding.firstRunPromptSeen).toBe(true);
        expect(body.settings.onboarding.seen['main-dashboard-work-contour']).toBe(1);
        expect(document.querySelector('[data-onboarding-first-run-modal]')).toBeNull();
    });

    it('uses remote per-user seen state instead of browser-wide localStorage', async () => {
        localStorage.setItem('actra_onboarding_seen_v1', JSON.stringify({
            'main-dashboard-work-contour': 1,
        }));
        window.ACTRA_DISABLE_ONBOARDING_FIRST_RUN_PROMPT = true;
        const fetchMock = vi.fn(async (url, options = {}) => {
            if (url === '/api/ui/settings' && !options.method) {
                return { json: async () => ({ ok: true, settings: { onboarding: { seen: {} } } }) };
            }
            if (url === '/api/ui/settings' && options.method === 'POST') {
                return { json: async () => ({ ok: true }) };
            }
            throw new Error(`Unexpected fetch ${url}`);
        });

        loadOnboarding(fetchMock);
        await settleAutoStart();
        await vi.advanceTimersByTimeAsync(40);

        expect(document.body.classList.contains('onboarding-tour-active')).toBe(true);
        expect(document.body.dataset.onboardingTourId).toBe('main-dashboard-work-contour');
    });
});

describe('main onboarding tour config', () => {
    it('points the catalog callout upward to the catalog card', () => {
        expect(toursSource).toMatch(
            /target:\s*'\[data-onboarding-target="main-catalog-card"\]',\s*placement:\s*'bottom',\s*keepPlacement:\s*true,\s*offsetX:\s*-80/
        );
    });
});
