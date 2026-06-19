/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
    path.resolve('frontend/Reference/reference.js'),
    'utf8'
);

function loadReferenceHelpers() {
    delete window.ACTRAReference;
    window.ACTRA_ONBOARDING_TOURS = [];
    window.eval(source);
    return window.ACTRAReference;
}

describe('Reference page helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        history.replaceState(null, '', '/reference');
    });

    it('builds a searchable catalog from every tour, including manual tours', () => {
        const helpers = loadReferenceHelpers();
        const tours = helpers.normalizeTours([
            {
                tourId: 'auto-tour',
                version: 1,
                route: ['/main'],
                title: 'Главная',
                summary: 'Старт проекта',
                referenceCategory: 'Знакомимся с проектом',
                referenceTags: ['старт'],
                referenceOrder: 2,
                steps: [{ kicker: 'Первый шаг', callouts: [{ body: 'Быстрый доступ' }] }],
            },
            {
                tourId: 'manual-tour',
                version: 1,
                route: ['/editor/Point_Annotation.html'],
                autoStart: false,
                title: 'Click',
                summary: 'Ручной сценарий',
                referenceCategory: 'Создаем задания',
                referenceTags: ['ошибки'],
                referenceOrder: 1,
                steps: [{ kicker: 'Референс', callouts: [{ title: 'Текст ошибок' }] }],
            },
        ]);

        expect(tours.map((tour) => tour.tourId)).toEqual(['auto-tour', 'manual-tour']);
        expect(tours[1].autoStart).toBe(false);
        expect(helpers.filterTours(tours, 'ошибки референс')).toHaveLength(1);
        expect(helpers.filterTours(tours, 'быстрый доступ')[0].tourId).toBe('auto-tour');
    });

    it('builds preview urls with the selected tour id and reference embed flag', () => {
        const helpers = loadReferenceHelpers();
        const url = helpers.buildPreviewUrl(
            {
                tourId: 'click-editor-authoring',
                route: ['/editor/Point_Annotation.html'],
            },
            'https://actra.test'
        );

        expect(url).toBe('/editor/Point_Annotation.html?onboarding_preview=click-editor-authoring&reference_embed=1');
        expect(helpers.buildPreviewUrl(
            {
                tourId: 'click-editor-authoring',
                route: ['/editor/Point_Annotation.html'],
                steps: [{ kicker: 'Шаг 1' }, { kicker: 'Шаг 2' }],
            },
            'https://actra.test',
            1
        )).toBe('/editor/Point_Annotation.html?onboarding_preview=click-editor-authoring&reference_embed=1&onboarding_step=1');
    });

    it('returns an empty result set for unmatched searches', () => {
        const helpers = loadReferenceHelpers();
        const tours = helpers.normalizeTours([
            {
                tourId: 'calendar',
                version: 1,
                route: ['/calendar'],
                title: 'Календарь',
                summary: 'План повторений',
                steps: [{ kicker: 'Daily Mix', callouts: [{ body: 'Фокус дня' }] }],
            },
        ]);

        expect(helpers.filterTours(tours, 'несуществующая функция')).toEqual([]);
    });

    it('sorts tours alphabetically inside each sidebar category', () => {
        const helpers = loadReferenceHelpers();
        const tours = helpers.normalizeTours([
            {
                tourId: 'zeta',
                version: 1,
                route: ['/zeta'],
                title: 'Яркий тур',
                referenceCategory: 'intro',
                referenceOrder: 1,
                steps: [{ kicker: 'Шаг', callouts: [{ body: 'Текст' }] }],
            },
            {
                tourId: 'alpha',
                version: 1,
                route: ['/alpha'],
                title: 'Аккуратный тур',
                referenceCategory: 'intro',
                referenceOrder: 99,
                steps: [{ kicker: 'Шаг', callouts: [{ body: 'Текст' }] }],
            },
            {
                tourId: 'calendar',
                version: 1,
                route: ['/calendar'],
                title: 'Календарь',
                referenceCategory: 'practice',
                referenceOrder: 1,
                steps: [{ kicker: 'Шаг', callouts: [{ body: 'Текст' }] }],
            },
        ]);

        expect(tours.map((tour) => tour.tourId)).toEqual(['alpha', 'zeta', 'calendar']);
    });

    it('keeps the live preview stable while typing in search', () => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <main data-reference-root>
                <span data-reference-tour-count></span>
                <input data-reference-search />
                <div data-reference-result-count></div>
                <nav data-reference-toc></nav>
                <span data-reference-preview-title></span>
                <div data-reference-preview-notice hidden></div>
                <iframe data-reference-preview-frame></iframe>
            </main>
        `;
        window.ACTRA_ONBOARDING_TOURS = [
            {
                tourId: 'main-tour',
                version: 1,
                route: ['/main'],
                title: 'Главная',
                summary: 'Старт проекта',
                referenceCategory: 'Знакомимся с проектом',
                referenceTags: ['старт'],
                referenceOrder: 1,
                steps: [{ kicker: 'Первый шаг', callouts: [{ body: 'Быстрый доступ' }] }],
            },
            {
                tourId: 'calendar-tour',
                version: 1,
                route: ['/calendar'],
                title: 'Календарь',
                summary: 'План повторений',
                referenceCategory: 'Проходим и повторяем',
                referenceTags: ['план'],
                referenceOrder: 2,
                steps: [{ kicker: 'Daily Mix', callouts: [{ body: 'Фокус дня' }] }],
            },
        ];

        delete window.ACTRAReference;
        window.eval(source);

        const frame = document.querySelector('[data-reference-preview-frame]');
        const initialSrc = frame.getAttribute('src');
        const search = document.querySelector('[data-reference-search]');
        search.value = 'календарь';
        search.dispatchEvent(new Event('input', { bubbles: true }));

        expect(frame.getAttribute('src')).toBe(initialSrc);

        document.querySelector('[data-reference-tour-id="calendar-tour"]').click();
        expect(frame.getAttribute('src')).toBe('/calendar?onboarding_preview=calendar-tour&reference_embed=1');
        document.querySelector('[data-reference-tour-id="calendar-tour"][data-reference-step-index="0"]').click();
        expect(frame.getAttribute('src')).toBe('/calendar?onboarding_preview=calendar-tour&reference_embed=1');
        vi.useRealTimers();
    });

    it('renders state entries and opens preview on the selected state', () => {
        document.body.innerHTML = `
            <main data-reference-root>
                <span data-reference-tour-count></span>
                <input data-reference-search />
                <div data-reference-result-count></div>
                <nav data-reference-toc></nav>
                <span data-reference-preview-title></span>
                <div data-reference-preview-notice hidden></div>
                <iframe data-reference-preview-frame></iframe>
            </main>
        `;
        window.ACTRA_ONBOARDING_TOURS = [
            {
                tourId: 'main-tour',
                version: 1,
                route: ['/main'],
                title: 'Главная',
                summary: 'Старт проекта',
                referenceCategory: 'Знакомимся с проектом',
                referenceTags: ['старт'],
                referenceOrder: 1,
                steps: [
                    { kicker: 'Первый шаг', callouts: [{ body: 'Каталог' }] },
                    { kicker: 'Второй шаг', callouts: [{ body: 'Редактор комплексов' }] },
                ],
            },
        ];

        delete window.ACTRAReference;
        window.eval(source);

        const secondState = document.querySelector('[data-reference-tour-id="main-tour"][data-reference-step-index="1"]');
        expect(secondState.textContent).toContain('2/2');
        secondState.click();

        expect(document.querySelector('[data-reference-preview-frame]').getAttribute('src')).toBe('/main?onboarding_preview=main-tour&reference_embed=1&onboarding_step=1');
        expect(window.location.hash).toBe('#main-tour/state-2');
    });

    it('keeps state entries collapsed until selected, toggled, or matched by search', () => {
        document.body.innerHTML = `
            <main data-reference-root>
                <span data-reference-tour-count></span>
                <input data-reference-search />
                <div data-reference-result-count></div>
                <nav data-reference-toc></nav>
                <span data-reference-preview-title></span>
                <div data-reference-preview-notice hidden></div>
                <iframe data-reference-preview-frame></iframe>
            </main>
        `;
        window.ACTRA_ONBOARDING_TOURS = [
            {
                tourId: 'main-tour',
                version: 1,
                route: ['/main'],
                title: 'Главная',
                summary: 'Старт проекта',
                referenceCategory: 'Знакомимся с проектом',
                referenceOrder: 1,
                steps: [{ kicker: 'Первый шаг', callouts: [{ body: 'Каталог' }] }],
            },
            {
                tourId: 'calendar-tour',
                version: 1,
                route: ['/calendar'],
                title: 'Календарь',
                summary: 'План повторений',
                referenceCategory: 'Проходим и повторяем',
                referenceOrder: 2,
                steps: [
                    { kicker: 'Daily Mix', callouts: [{ body: 'Фокус дня' }] },
                    { kicker: 'Ритм недели', callouts: [{ body: 'Особенные повторы недели' }] },
                ],
            },
        ];

        delete window.ACTRAReference;
        window.eval(source);

        const frame = document.querySelector('[data-reference-preview-frame]');
        expect(document.querySelector('[data-reference-preview-title]').textContent).toBe('Выберите тур');
        expect([...document.querySelectorAll('.reference-toc__category-body')].every((body) => body.hidden)).toBe(true);
        expect(document.getElementById('reference-steps-main-tour').hidden).toBe(true);
        expect(document.getElementById('reference-steps-calendar-tour').hidden).toBe(true);

        const initialSrc = frame.getAttribute('src');
        document.querySelector('[data-reference-toggle-category]').click();
        expect(document.querySelector('.reference-toc__category-body').hidden).toBe(false);
        expect(document.getElementById('reference-steps-main-tour').hidden).toBe(true);

        document.querySelector('[data-reference-tour-id="main-tour"].reference-toc__button').click();
        expect(document.getElementById('reference-steps-main-tour').hidden).toBe(false);
        expect(frame.getAttribute('src')).toBe('/main?onboarding_preview=main-tour&reference_embed=1');

        const selectedSrc = frame.getAttribute('src');
        document.querySelectorAll('[data-reference-toggle-category]')[1].click();
        document.querySelector('[data-reference-toggle-tour-id="calendar-tour"]').click();
        expect(document.getElementById('reference-steps-calendar-tour').hidden).toBe(false);
        expect(initialSrc).toBe(null);
        expect(frame.getAttribute('src')).toBe(selectedSrc);

        document.querySelector('[data-reference-toggle-tour-id="calendar-tour"]').click();
        expect(document.getElementById('reference-steps-calendar-tour').hidden).toBe(true);

        const search = document.querySelector('[data-reference-search]');
        search.value = 'особенные повторы';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.getElementById('reference-steps-calendar-tour').hidden).toBe(false);
        expect(document.querySelectorAll('[data-reference-tour-id="calendar-tour"].reference-toc__step')).toHaveLength(1);
        expect(document.querySelector('[data-reference-tour-id="calendar-tour"].reference-toc__step').textContent).toContain('Ритм недели');
        expect(frame.getAttribute('src')).toBe(selectedSrc);
    });

    it('does not auto-expand state entries when search matches only the tour', () => {
        document.body.innerHTML = `
            <main data-reference-root>
                <span data-reference-tour-count></span>
                <input data-reference-search />
                <div data-reference-result-count></div>
                <nav data-reference-toc></nav>
                <span data-reference-preview-title></span>
                <div data-reference-preview-notice hidden></div>
                <iframe data-reference-preview-frame></iframe>
            </main>
        `;
        window.ACTRA_ONBOARDING_TOURS = [
            {
                tourId: 'main-tour',
                version: 1,
                route: ['/main'],
                title: 'Главная',
                summary: 'Старт проекта',
                referenceCategory: 'Знакомимся с проектом',
                referenceOrder: 1,
                steps: [{ kicker: 'Первый шаг', callouts: [{ body: 'Каталог' }] }],
            },
            {
                tourId: 'calendar-tour',
                version: 1,
                route: ['/calendar'],
                title: 'Календарь',
                summary: 'План повторений',
                referenceCategory: 'Проходим и повторяем',
                referenceOrder: 2,
                steps: [
                    { kicker: 'Daily Mix', callouts: [{ body: 'Фокус дня' }] },
                    { kicker: 'Ритм недели', callouts: [{ body: 'Особенные повторы недели' }] },
                ],
            },
        ];

        delete window.ACTRAReference;
        window.eval(source);

        const search = document.querySelector('[data-reference-search]');
        search.value = 'план повторений';
        search.dispatchEvent(new Event('input', { bubbles: true }));

        expect(document.querySelector('[data-reference-tour-id="calendar-tour"].reference-toc__button')).toBeTruthy();
        expect(document.getElementById('reference-steps-calendar-tour').hidden).toBe(true);
        expect(document.querySelector('[data-reference-result-count]').textContent).toContain('0 состояний');

        document.querySelector('[data-reference-toggle-tour-id="calendar-tour"]').click();
        expect(document.getElementById('reference-steps-calendar-tour').hidden).toBe(false);
        expect(document.querySelectorAll('[data-reference-tour-id="calendar-tour"].reference-toc__step')).toHaveLength(2);
    });

    it('syncs the active state when the embedded preview advances', () => {
        document.body.innerHTML = `
            <main data-reference-root>
                <span data-reference-tour-count></span>
                <input data-reference-search />
                <div data-reference-result-count></div>
                <nav data-reference-toc></nav>
                <span data-reference-preview-title></span>
                <div data-reference-preview-notice hidden></div>
                <iframe data-reference-preview-frame></iframe>
            </main>
        `;
        window.ACTRA_ONBOARDING_TOURS = [
            {
                tourId: 'main-tour',
                version: 1,
                route: ['/main'],
                title: 'Главная',
                summary: 'Старт проекта',
                referenceCategory: 'Знакомимся с проектом',
                referenceOrder: 1,
                steps: [
                    { kicker: 'Первый шаг', callouts: [{ body: 'Каталог' }] },
                    { kicker: 'Второй шаг', callouts: [{ body: 'Редактор комплексов' }] },
                ],
            },
        ];

        delete window.ACTRAReference;
        window.eval(source);

        const frame = document.querySelector('[data-reference-preview-frame]');
        document.querySelector('[data-reference-tour-id="main-tour"].reference-toc__button').click();
        const initialSrc = frame.getAttribute('src');
        const message = new MessageEvent('message', {
            origin: window.location.origin,
            source: frame.contentWindow,
            data: {
                type: 'actra:onboarding-step-ready',
                tourId: 'main-tour',
                stepIndex: 1,
            },
        });
        window.dispatchEvent(message);

        const activeStep = document.querySelector('.reference-toc__step.is-active');
        expect(activeStep.textContent).toContain('2/2');
        expect(document.querySelector('[data-reference-preview-title]').textContent).toBe('Главная · 2/2');
        expect(frame.getAttribute('src')).toBe(initialSrc);
        expect(window.location.hash).toBe('#main-tour/state-2');
    });
});
