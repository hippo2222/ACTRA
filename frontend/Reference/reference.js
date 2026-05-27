(function () {
    'use strict';

    function wt(key, fallback) {
        if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
        var v = window.i18n.t(key);
        return v !== key ? v : fallback;
    }

    const CATEGORY_ORDER = [
        'Знакомимся с проектом',
        'Находим материалы',
        'Создаем задания',
        'Объединяем задания в комплексы',
        'Работаем с теорией',
        'Проходим и повторяем',
        'Смотрим статистику',
    ];
    const CATEGORY_KEYS = {
        'Знакомимся с проектом': 'intro',
        'Находим материалы': 'find',
        'Создаем задания': 'create',
        'Объединяем задания в комплексы': 'assemble',
        'Работаем с теорией': 'theory',
        'Проходим и повторяем': 'practice',
        'Смотрим статистику': 'stats'
    };

    function translateCategory(category) {
        const keySuffix = CATEGORY_KEYS[category];
        if (!keySuffix) return category;
        return wt('reference.cat_' + keySuffix, category);
    }

    const PREVIEW_VIEWPORT_WIDTH = 1440;
    const PREVIEW_VIEWPORT_HEIGHT = 900;

    let state = {
        tours: [],
        filteredTours: [],
        selectedTourId: '',
        selectedStepIndex: 0,
        expandedCategoryIds: new Set(),
        expandedTourIds: new Set(),
        query: '',
        previewCheckTimer: 0,
    };

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    function normalizeText(value) {
        return String(value ?? '')
            .toLocaleLowerCase('ru-RU')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function asArray(value) {
        return Array.isArray(value) ? value.filter(Boolean) : [];
    }

    function getPrimaryRoute(tour) {
        const routes = Array.isArray(tour?.route) ? tour.route : [tour?.route];
        return routes.find(Boolean) || '';
    }

    function getCategory(tour) {
        const category = String(tour?.referenceCategory || '').trim();
        return category || wt('reference.default_category', 'Знакомимся с проектом');
    }

    function getStepTitle(step, index) {
        const firstCallout = asArray(step?.callouts)[0];
        return String(
            step?.kicker
            || step?.title
            || firstCallout?.title
            || wt('reference.step_fallback', 'Шаг {n}').replace('{n}', index + 1)
        );
    }

    function getStepSummary(step) {
        const firstCallout = asArray(step?.callouts)[0];
        return String(step?.body || firstCallout?.body || firstCallout?.title || '').trim();
    }

    function collectCallouts(step) {
        const callouts = [...asArray(step?.callouts)];
        const variantGroups = step?.calloutVariants && typeof step.calloutVariants === 'object'
            ? Object.values(step.calloutVariants)
            : [];
        variantGroups.forEach((group) => {
            asArray(group).forEach((callout) => callouts.push(callout));
        });
        asArray(step?.beacons).forEach((beacon) => {
            if (beacon?.title || beacon?.body) callouts.push(beacon);
        });
        return callouts;
    }

    function getTourSearchText(tour) {
        const parts = [
            tour?.tourId,
            tour?.title,
            tour?.summary,
            getCategory(tour),
            translateCategory(getCategory(tour)),
            ...asArray(tour?.referenceTags),
        ];

        asArray(tour?.steps).forEach((step, index) => {
            parts.push(step?.id, getStepTitle(step, index), step?.body, step?.kicker);
            collectCallouts(step).forEach((callout) => {
                parts.push(callout?.title, callout?.body, callout?.label);
            });
        });

        return normalizeText(parts.filter(Boolean).join(' '));
    }

    function normalizeStepIndex(tour, stepIndex) {
        const maxIndex = Math.max(0, asArray(tour?.steps).length - 1);
        const parsed = Number(stepIndex);
        return Number.isFinite(parsed)
            ? Math.min(maxIndex, Math.max(0, Math.trunc(parsed)))
            : 0;
    }

    function buildStepsMeta(tour) {
        return asArray(tour?.steps).map((step, index) => {
            const title = getStepTitle(step, index);
            const summary = getStepSummary(step);
            const searchText = normalizeText([
                index + 1,
                title,
                summary,
                step?.id,
                step?.kicker,
                ...collectCallouts(step).flatMap((callout) => [callout?.title, callout?.body, callout?.label]),
            ].filter(Boolean).join(' '));
            return { index, title, summary, searchText };
        });
    }

    function normalizeTours(tours) {
        return asArray(tours)
            .filter((tour) => tour && tour.tourId && asArray(tour.steps).length)
            .map((tour, index) => {
                const stepsMeta = buildStepsMeta(tour);
                return {
                    ...tour,
                    referenceCategory: getCategory(tour),
                    referenceTags: asArray(tour.referenceTags),
                    referenceOrder: Number.isFinite(Number(tour.referenceOrder))
                        ? Number(tour.referenceOrder)
                        : index + 1000,
                    primaryRoute: getPrimaryRoute(tour),
                    stepsMeta,
                    searchText: normalizeText([getTourSearchText(tour), ...stepsMeta.map((step) => step.searchText)].join(' ')),
                };
            })
            .sort((a, b) => {
                const categoryA = CATEGORY_ORDER.indexOf(a.referenceCategory);
                const categoryB = CATEGORY_ORDER.indexOf(b.referenceCategory);
                const orderA = categoryA === -1 ? CATEGORY_ORDER.length : categoryA;
                const orderB = categoryB === -1 ? CATEGORY_ORDER.length : categoryB;
                if (orderA !== orderB) return orderA - orderB;
                const titleOrder = String(a.title || '').localeCompare(String(b.title || ''), 'ru');
                if (titleOrder !== 0) return titleOrder;
                return a.referenceOrder - b.referenceOrder;
            });
    }

    function filterTours(tours, query) {
        const normalizedQuery = normalizeText(query);
        if (!normalizedQuery) return tours;
        const tokens = normalizedQuery.split(' ').filter(Boolean);
        return tours.filter((tour) => tokens.every((token) => tour.searchText.includes(token)));
    }

    function addStepParam(url, tour, stepIndex) {
        const normalizedStepIndex = normalizeStepIndex(tour, stepIndex);
        if (normalizedStepIndex > 0) {
            url.searchParams.set('onboarding_step', String(normalizedStepIndex));
        }
    }

    function buildPreviewUrl(tour, origin, stepIndex = 0) {
        const route = getPrimaryRoute(tour);
        if (!route) return '';
        const url = new URL(route, origin || window.location.origin);
        url.searchParams.set('onboarding_preview', tour.tourId);
        url.searchParams.set('reference_embed', '1');
        addStepParam(url, tour, stepIndex);
        return `${url.pathname}${url.search}${url.hash}`;
    }

    function formatReferenceHash(tourId, stepIndex = 0) {
        const normalizedTourId = String(tourId || '').trim();
        if (!normalizedTourId) return '';
        const normalizedStepIndex = Math.max(0, Math.trunc(Number(stepIndex) || 0));
        const suffix = normalizedStepIndex > 0 ? `/state-${normalizedStepIndex + 1}` : '';
        return `${encodeURIComponent(normalizedTourId)}${suffix}`;
    }

    function parseReferenceHash() {
        const raw = decodeURIComponent(String(window.location.hash || '').replace(/^#/, '')).trim();
        if (!raw) return { tourId: '', stepIndex: 0 };
        const match = raw.match(/^(.*?)(?:\/state-(\d+))?$/);
        if (!match) return { tourId: raw, stepIndex: 0 };
        return {
            tourId: match[1] || raw,
            stepIndex: match[2] ? Math.max(0, Number(match[2]) - 1) : 0,
        };
    }

    function groupByCategory(tours) {
        return tours.reduce((groups, tour) => {
            const category = getCategory(tour);
            if (!groups.has(category)) groups.set(category, []);
            groups.get(category).push(tour);
            return groups;
        }, new Map());
    }

    function getCategoryBodyId(category, index) {
        const normalized = String(category || '')
            .toLocaleLowerCase('ru-RU')
            .replace(/[^a-zа-я0-9_-]+/gi, '-')
            .replace(/^-+|-+$/g, '');
        return `reference-category-${normalized || index}`;
    }

    function getSearchTokens() {
        return normalizeText(state.query).split(' ').filter(Boolean);
    }

    function hasMatchingStep(tour) {
        const tokens = getSearchTokens();
        if (!tokens.length) return false;
        return asArray(tour?.stepsMeta).some((step) => tokens.every((token) => step.searchText.includes(token)));
    }

    function getVisibleSteps(tour) {
        const steps = asArray(tour?.stepsMeta);
        const tokens = getSearchTokens();
        if (!tokens.length) return steps;
        const matchingSteps = steps.filter((step) => tokens.every((token) => step.searchText.includes(token)));
        return matchingSteps.length ? matchingSteps : steps;
    }

    function getMatchedStepCount(tour) {
        const tokens = getSearchTokens();
        if (!tokens.length) return asArray(tour?.stepsMeta).length;
        return asArray(tour?.stepsMeta).filter((step) => tokens.every((token) => step.searchText.includes(token))).length;
    }

    function isTourExpanded(tour) {
        const tourId = String(tour?.tourId || '');
        return Boolean(
            tourId
            && (
                tourId === state.selectedTourId
                || state.expandedTourIds.has(tourId)
                || hasMatchingStep(tour)
            )
        );
    }

    function isCategoryExpanded(category, tours) {
        if (state.query) return true;
        if (state.expandedCategoryIds.has(category)) return true;
        return tours.some((tour) => tour.tourId === state.selectedTourId);
    }

    function getStepsId(tour) {
        return `reference-steps-${String(tour?.tourId || '').replace(/[^a-z0-9_-]/gi, '-')}`;
    }

    function setResultCount(root) {
        const count = root.querySelector('[data-reference-result-count]');
        if (!count) return;
        const total = state.tours.length;
        const shown = state.filteredTours.length;
        const shownStates = state.filteredTours.reduce((sum, tour) => sum + getMatchedStepCount(tour), 0);
        count.textContent = state.query
            ? wt('reference.result_found', 'Найдено: {shown} из {total} сценариев, {states} состояний').replace('{shown}', shown).replace('{total}', total).replace('{states}', shownStates)
            : wt('reference.result_total', 'Всего сценариев: {total}, состояний: {states}').replace('{total}', total).replace('{states}', shownStates);
    }

    function renderToc(root) {
        const toc = root.querySelector('[data-reference-toc]');
        if (!toc) return;
        if (!state.filteredTours.length) {
            toc.innerHTML = `<div class="reference-empty">${wt('reference.empty_search', 'Ничего не найдено. Попробуйте другой запрос.')}</div>`;
            return;
        }

        const groups = groupByCategory(state.filteredTours);
        toc.innerHTML = Array.from(groups.entries()).map(([category, tours], categoryIndex) => {
            const expanded = isCategoryExpanded(category, tours);
            const categoryBodyId = getCategoryBodyId(category, categoryIndex);
            return `
            <section class="reference-toc__category${expanded ? ' is-expanded' : ''}">
                <button
                    class="reference-toc__heading"
                    type="button"
                    data-reference-toggle-category="${escapeHtml(category)}"
                    aria-expanded="${expanded ? 'true' : 'false'}"
                    aria-controls="${escapeHtml(categoryBodyId)}"
                >
                    <span class="reference-toc__heading-icon" aria-hidden="true"></span>
                    <span class="reference-toc__heading-title">${escapeHtml(translateCategory(category))}</span>
                    <span class="reference-toc__heading-count">${tours.length}</span>
                </button>
                <div class="reference-toc__category-body" id="${escapeHtml(categoryBodyId)}" ${expanded ? '' : 'hidden'}>
                ${tours.map((tour) => {
                    const expanded = isTourExpanded(tour);
                    const stepsId = getStepsId(tour);
                    const visibleSteps = getVisibleSteps(tour);
                    return `
                        <div class="reference-toc__tour${expanded ? ' is-expanded' : ''}">
                            <div class="reference-toc__tour-row">
                                <button
                                    class="reference-toc__toggle"
                                    type="button"
                                    data-reference-toggle-tour-id="${escapeHtml(tour.tourId)}"
                                    aria-label="${expanded ? wt('reference.collapse_steps', 'Свернуть состояния') : wt('reference.expand_steps', 'Развернуть состояния')}"
                                    aria-expanded="${expanded ? 'true' : 'false'}"
                                    aria-controls="${escapeHtml(stepsId)}"
                                >
                                    <span aria-hidden="true"></span>
                                </button>
                                <button
                                    class="reference-toc__button${tour.tourId === state.selectedTourId ? ' is-active' : ''}"
                                    type="button"
                                    data-reference-tour-id="${escapeHtml(tour.tourId)}"
                                    data-reference-step-index="0"
                                >
                                    <span class="reference-toc__title">${escapeHtml(tour.title || tour.tourId)}</span>
                                    <span class="reference-toc__summary">${escapeHtml(tour.summary || '')}</span>
                                </button>
                            </div>
                            <div
                                class="reference-toc__steps"
                                id="${escapeHtml(stepsId)}"
                                aria-label="${wt('reference.tour_steps_label', 'Состояния тура')} ${escapeHtml(tour.title || tour.tourId)}"
                                ${expanded ? '' : 'hidden'}
                            >
                                ${visibleSteps.map((step) => `
                                    <button
                                        class="reference-toc__step${tour.tourId === state.selectedTourId && step.index === state.selectedStepIndex ? ' is-active' : ''}"
                                        type="button"
                                        data-reference-tour-id="${escapeHtml(tour.tourId)}"
                                        data-reference-step-index="${step.index}"
                                    >
                                        <span class="reference-toc__step-index">${step.index + 1}/${tour.stepsMeta.length}</span>
                                        <span class="reference-toc__step-copy">
                                            <span class="reference-toc__step-title">${escapeHtml(step.title)}</span>
                                            ${step.summary ? `<span class="reference-toc__step-summary">${escapeHtml(step.summary)}</span>` : ''}
                                        </span>
                                    </button>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
                </div>
            </section>
        `;
        }).join('');
    }

    function setPreviewNotice(root, message) {
        const notice = root.querySelector('[data-reference-preview-notice]');
        if (!notice) return;
        notice.hidden = !message;
        notice.textContent = message || '';
    }

    function schedulePreviewHealthCheck(root, frame, tour) {
        window.clearTimeout(state.previewCheckTimer);
        state.previewCheckTimer = window.setTimeout(() => {
            try {
                const doc = frame.contentDocument;
                const hasTourLayer = Boolean(
                    doc?.body?.classList?.contains('onboarding-tour-active')
                    || doc?.querySelector?.('.onboarding-tour-callout, .onboarding-tour-scrim')
                );
                if (!hasTourLayer) {
                    setPreviewNotice(
                        root,
                        wt('reference.preview_notice_no_layer', 'Текст справочника доступен здесь. Если живое превью не запустилось, откройте тур на полной странице.')
                    );
                }
            } catch (_) {
                setPreviewNotice(
                    root,
                    wt('reference.preview_notice_check_failed', 'Не удалось проверить состояние превью. Полная страница откроет этот же сценарий.')
                );
            }
        }, Number(tour?.autoStartDelay || 900) + 4500);
    }

    function syncPreviewChrome(root, tour) {
        const title = root.querySelector('[data-reference-preview-title]');
        const stepIndex = normalizeStepIndex(tour, state.selectedStepIndex);
        if (title) {
            title.textContent = tour
                ? `${tour.title || tour.tourId} · ${stepIndex + 1}/${asArray(tour.stepsMeta).length || 1}`
                : wt('reference.select_tour', 'Выберите тур');
        }
    }

    function setPreviewEmptyState(root, isEmpty) {
        const empty = root.querySelector('[data-reference-preview-empty]');
        const scale = root.querySelector('.reference-preview__scale');
        const frame = root.querySelector('[data-reference-preview-frame]');
        if (empty) empty.hidden = !isEmpty;
        if (scale) scale.hidden = isEmpty;
        if (isEmpty && frame) frame.removeAttribute('src');
    }

    function renderPreview(root, tour) {
        const frame = root.querySelector('[data-reference-preview-frame]');
        const stepIndex = normalizeStepIndex(tour, state.selectedStepIndex);
        const step = asArray(tour?.stepsMeta)[stepIndex];
        updatePreviewScale(root);
        syncPreviewChrome(root, tour);
        if (!tour) {
            window.clearTimeout(state.previewCheckTimer);
            setPreviewNotice(root, '');
            setPreviewEmptyState(root, true);
            return;
        }
        setPreviewEmptyState(root, false);
        if (!frame) return;

        const previewUrl = buildPreviewUrl(tour, window.location.origin, step?.index || 0);
        if (!previewUrl) {
            frame.removeAttribute('src');
            setPreviewNotice(root, wt('reference.preview_notice_no_url', 'Для этого сценария пока нет страницы живого превью.'));
            return;
        }

        setPreviewNotice(root, '');
        frame.src = previewUrl;
        frame.onload = () => schedulePreviewHealthCheck(root, frame, tour);
    }

    function syncStepFromPreview(root, tourId, stepIndex, sourceWindow) {
        const frame = root.querySelector('[data-reference-preview-frame]');
        if (!frame || sourceWindow !== frame.contentWindow) return;
        if (String(tourId || '') !== state.selectedTourId) return;
        const tour = state.tours.find((candidate) => candidate.tourId === state.selectedTourId);
        if (!tour) return;
        const normalizedStepIndex = normalizeStepIndex(tour, stepIndex);
        if (normalizedStepIndex === state.selectedStepIndex) return;

        state.selectedStepIndex = normalizedStepIndex;
        history.replaceState(null, '', `#${formatReferenceHash(state.selectedTourId, state.selectedStepIndex)}`);
        renderToc(root);
        syncPreviewChrome(root, tour);
    }

    function updatePreviewScale(root) {
        const viewport = root.querySelector('[data-reference-preview-frame]')?.closest('.reference-preview__viewport');
        if (!viewport) return;
        const availableWidth = Math.max(1, viewport.clientWidth || viewport.getBoundingClientRect().width || 0);
        const scale = Math.min(1, availableWidth / PREVIEW_VIEWPORT_WIDTH);
        viewport.style.setProperty('--reference-preview-scale', String(scale));
        viewport.style.height = `${Math.round(PREVIEW_VIEWPORT_HEIGHT * scale)}px`;
    }

    function selectTour(root, tourId, { stepIndex = 0, updateHash = true } = {}) {
        const nextTour = state.tours.find((tour) => tour.tourId === tourId)
            || state.filteredTours[0]
            || state.tours[0]
            || null;
        state.selectedTourId = nextTour?.tourId || '';
        state.selectedStepIndex = normalizeStepIndex(nextTour, stepIndex);
        if (nextTour?.referenceCategory) {
            state.expandedCategoryIds.add(nextTour.referenceCategory);
        }
        if (updateHash && state.selectedTourId) {
            history.replaceState(null, '', `#${formatReferenceHash(state.selectedTourId, state.selectedStepIndex)}`);
        }
        renderToc(root);
        renderPreview(root, nextTour);
    }

    function applyFilter(root) {
        state.filteredTours = filterTours(state.tours, state.query);
        setResultCount(root);
        renderToc(root);
    }

    function init(root) {
        if (!root) return;
        state.tours = normalizeTours(window.ACTRA_ONBOARDING_TOURS || []);
        state.filteredTours = state.tours;
        const hashState = parseReferenceHash();
        state.selectedTourId = hashState.tourId || '';
        state.selectedStepIndex = hashState.stepIndex || 0;

        const search = root.querySelector('[data-reference-search]');
        if (search) {
            search.addEventListener('input', () => {
                state.query = search.value || '';
                applyFilter(root);
            });
        }

        root.addEventListener('click', (event) => {
            const categoryToggle = event.target.closest('[data-reference-toggle-category]');
            if (categoryToggle) {
                event.preventDefault();
                const category = categoryToggle.getAttribute('data-reference-toggle-category') || '';
                if (state.expandedCategoryIds.has(category)) {
                    state.expandedCategoryIds.delete(category);
                } else {
                    state.expandedCategoryIds.add(category);
                }
                renderToc(root);
                return;
            }

            const toggle = event.target.closest('[data-reference-toggle-tour-id]');
            if (toggle) {
                event.preventDefault();
                const tourId = toggle.getAttribute('data-reference-toggle-tour-id') || '';
                if (state.expandedTourIds.has(tourId)) {
                    state.expandedTourIds.delete(tourId);
                } else {
                    state.expandedTourIds.add(tourId);
                }
                renderToc(root);
                return;
            }

            const button = event.target.closest('[data-reference-tour-id]');
            if (!button) return;
            event.preventDefault();
            selectTour(root, button.getAttribute('data-reference-tour-id') || '', {
                stepIndex: Number(button.getAttribute('data-reference-step-index') || 0),
            });
        });

        window.addEventListener('resize', () => updatePreviewScale(root), { passive: true });
        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data && typeof event.data === 'object' ? event.data : null;
            if (data?.type !== 'actra:onboarding-step-ready') return;
            syncStepFromPreview(root, data.tourId, data.stepIndex, event.source);
        });

        setResultCount(root);
        if (state.selectedTourId) {
            selectTour(root, state.selectedTourId, { updateHash: false });
        } else {
            renderToc(root);
            renderPreview(root, null);
        }
    }

    window.ACTRAReference = {
        buildPreviewUrl,
        collectCallouts,
        filterTours,
        getTourSearchText,
        normalizeTours,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init(document.querySelector('[data-reference-root]')), { once: true });
    } else {
        init(document.querySelector('[data-reference-root]'));
    }
})();
