/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const toursSource = fs.readFileSync(
    path.resolve('frontend/assets/onboarding_tours.js'),
    'utf8'
);

const locales = {
    ru: JSON.parse(fs.readFileSync(path.resolve('frontend/assets/locales/ru.json'), 'utf8')),
    en: JSON.parse(fs.readFileSync(path.resolve('frontend/assets/locales/en.json'), 'utf8')),
    uk: JSON.parse(fs.readFileSync(path.resolve('frontend/assets/locales/uk.json'), 'utf8')),
};

function loadTours() {
    delete window.ACTRA_ONBOARDING_TOURS;
    window.eval(toursSource);
    return window.ACTRA_ONBOARDING_TOURS;
}

function findTour(tours, tourId) {
    return tours.find((tour) => tour.tourId === tourId);
}

function resolveKey(obj, dottedKey) {
    return dottedKey.split('.').reduce(
        (acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined),
        obj
    );
}

function collectTargets(tour) {
    const targets = [];
    (tour.steps || []).forEach((step) => {
        (step.targets || []).forEach((target) => targets.push(target));
        (step.callouts || []).forEach((callout) => {
            if (callout.target) targets.push(callout.target);
        });
    });
    return targets;
}

describe('Microcards onboarding tours', () => {
    it('registers a library overview tour that auto-starts on /microcards', () => {
        const tours = loadTours();
        const tour = findTour(tours, 'microcards-library-overview');
        expect(tour).toBeTruthy();
        expect(tour.route).toEqual(['/microcards']);
        expect(tour.autoStart).toBe(true);
        expect(tour.referenceCategory).toBe('practice');
        expect(tour.steps).toHaveLength(5);
        expect(tour.totalStates).toBe(5);
        expect(tour.steps.map((step) => step.id)).toEqual([
            'library-pulse', 'library-find', 'library-deck-card', 'deck-mastery', 'study-modes',
        ]);
    });

    it('registers a review-session tour that does NOT auto-start (manual / preview only)', () => {
        const tours = loadTours();
        const tour = findTour(tours, 'microcards-review-session');
        expect(tour).toBeTruthy();
        expect(tour.route).toEqual(['/microcards']);
        expect(Boolean(tour.autoStart)).toBe(false);
        expect(tour.referenceCategory).toBe('practice');
        expect(tour.steps).toHaveLength(4);
        expect(tour.totalStates).toBe(4);
        expect(tour.steps.map((step) => step.id)).toEqual([
            'session-card', 'session-grade', 'session-queue', 'session-summary',
        ]);
    });

    it('only one of the two /microcards tours auto-starts (avoids a route conflict)', () => {
        const tours = loadTours();
        const microcardsTours = tours.filter((tour) => (tour.route || []).includes('/microcards'));
        const autoStarting = microcardsTours.filter((tour) => tour.autoStart === true);
        expect(autoStarting.map((tour) => tour.tourId)).toEqual(['microcards-library-overview']);
    });

    it('anchors every step to a stable microcards target with callout copy', () => {
        const tours = loadTours();
        ['microcards-library-overview', 'microcards-review-session'].forEach((tourId) => {
            const tour = findTour(tours, tourId);
            tour.steps.forEach((step) => {
                expect(typeof step.id).toBe('string');
                expect(Array.isArray(step.targets) && step.targets.length).toBeTruthy();
                (step.callouts || []).forEach((callout) => {
                    expect(typeof callout.body).toBe('string');
                    expect(callout.body.length).toBeGreaterThan(0);
                });
            });
            collectTargets(tour).forEach((target) => {
                expect(target).toMatch(/^\[data-onboarding-target="microcards-[a-z-]+"\]$/);
            });
        });
    });

    it('translates every microcards tour string in ru / en / uk', () => {
        const keyPattern = /wt\('(tours\.microcards_[^']+)'/g;
        const keys = new Set();
        let match;
        while ((match = keyPattern.exec(toursSource)) !== null) {
            keys.add(match[1]);
        }
        // sanity: both tours contribute their full copy tree
        expect(keys.size).toBeGreaterThanOrEqual(24);

        const missing = [];
        keys.forEach((key) => {
            ['ru', 'en', 'uk'].forEach((lang) => {
                const value = resolveKey(locales[lang], key);
                if (typeof value !== 'string' || value.trim().length === 0) {
                    missing.push(`${lang}: ${key}`);
                }
            });
        });
        expect(missing).toEqual([]);
    });
});
