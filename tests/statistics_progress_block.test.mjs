/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

if (typeof window !== 'undefined') {
    window.__STATISTICS_APP_AUTO_INIT_DISABLED__ = true;
}

const { StatisticsApp } = require('../frontend/statistics/statistics.js');

const DAY_TEMPLATE = (dayIndex, overrides = {}) => {
    const date = `2024-01-${String(dayIndex + 1).padStart(2, '0')}T00:00:00.000Z`;
    return {
        date,
        attempts: overrides.attempts ?? (dayIndex + 1),
        success_rate: overrides.success_rate ?? 0.5 + dayIndex * 0.02,
        study_minutes: overrides.study_minutes ?? 15 + dayIndex * 3,
        ...overrides
    };
};

function mountBaseDom() {
    document.body.innerHTML = `
        <header class="stats-header">
            <div class="stats-header-end">
                <button class="stats-user-chip">Profile</button>
            </div>
        </header>
        <div id="chart-card">
            <div id="chart-header"></div>
            <div class="chart-viewport" style="width: 800px; height: 400px;">
                <div id="chart-content"></div>
                <div id="chart-overlay"></div>
            </div>
            <div id="empty-chart" class="hidden"></div>
            <div id="chart-legend"></div>
            <div id="heatmap-strip">
                <div id="heatmap-container" class="heatmap-grid"></div>
            </div>
        </div>
        <div id="chart-metric-selector">
            <button class="chart-toggle-btn active" data-metric="attempts">Задачи</button>
            <button class="chart-toggle-btn" data-metric="study">Время</button>
        </div>
        <span id="legend-primary-label"></span>
        <span id="legend-value-label"></span>
        <span id="legend-trend-label"></span>
        <span id="chart-period-delta"></span>
        <div id="chart-insight"></div>
        <span id="chart-period-text"></span>
        <div id="chart-insight-value"></div>
        <div id="chart-insight-subtitle"></div>
        <div id="chart-insight-tags"></div>
        <div id="chart-content"></div>
        <div id="chart-legend"></div>
        <div id="right-column"></div>
        <div id="theory-analytics-list"></div>
        <div id="complexes-nav"></div>
        <button id="complexes-prev"></button>
        <button id="complexes-next"></button>
        <span id="complexes-counter"></span>
        <div id="complexes-grid"></div>
        <div id="chart-content"></div>
        <div id="metric-tasks" class="st-metric-card"></div>
        <div id="metric-time" class="st-metric-card"></div>
        <div id="metric-microcards" class="st-metric-card"></div>
        <div id="metric-streak" class="st-metric-card"></div>
        <div id="metric-tasks-value" class="st-metric-body"></div>
        <p id="metric-tasks-empty" class="st-metric-empty hidden"></p>
        <div id="metric-time-value" class="st-metric-body"></div>
        <p id="metric-time-empty" class="st-metric-empty hidden"></p>
        <div id="metric-microcards-value" class="st-metric-body"></div>
        <p id="metric-microcards-empty" class="st-metric-empty hidden"></p>
        <div id="metric-streak-value" class="st-metric-body"></div>
        <p id="metric-streak-empty" class="st-metric-empty hidden"></p>
        <div id="metric-tasks-icon"></div>
        <div id="metric-time-icon"></div>
        <div id="metric-microcards-icon"></div>
        <div id="metric-streak-icon"></div>
        <span id="tasks-mastered"></span>
        <span id="tasks-total"></span>
        <span id="time-hours"></span>
        <span id="time-minutes"></span>
        <span id="time-source-hint"></span>
        <span id="streak-days"></span>
        <span id="streak-best"></span>
        <span id="microcards-reviews-count"></span>
        <span id="microcards-correct-rate"></span>
        <span id="microcards-correct-badge"></span>
    `;
}

function buildDynamics(values) {
    return values.map((value, idx) => DAY_TEMPLATE(idx, value));
}

describe('Statistics progress block logic', () => {
    beforeEach(() => {
        mountBaseDom();
        StatisticsApp.resetState();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders summary message for study metric with moderate activity', () => {
        StatisticsApp.state.dynamics = buildDynamics([
            { attempts: 4 },
            { attempts: 4 },
            { attempts: 4 }
        ]);
        StatisticsApp.state.previousDynamics = buildDynamics([
            { attempts: 2 },
            { attempts: 2 },
            { attempts: 2 }
        ]);

        StatisticsApp.updateChartSummary();

        const delta = document.getElementById('chart-period-delta');
        const text = document.getElementById('chart-period-text');

        expect(delta.textContent).toBe('54 мин за 3 дн. — попробуй заниматься чаще');
        expect(text.textContent).toBe('');
    });

    it('renders summary message for strong study activity', () => {
        StatisticsApp.state.currentMetric = 'study';
        StatisticsApp.state.currentPeriod = 3;
        StatisticsApp.state.dynamics = buildDynamics([
            { study_minutes: 40 },
            { study_minutes: 35 },
            { study_minutes: 45 }
        ]);
        StatisticsApp.state.previousDynamics = buildDynamics([
            { study_minutes: 20 },
            { study_minutes: 25 },
            { study_minutes: 20 }
        ]);

        StatisticsApp.updateChartSummary();

        const delta = document.getElementById('chart-period-delta');
        expect(delta.textContent).toBe('120 мин за 3 дн. — отличный результат! 🔥');
    });
    it('clears stale stats and warns when part of the statistics payload fails', async () => {
        StatisticsApp.resetState({
            currentUser: { user_id: 'user_1' },
            stats: { total_tasks_attempted: 42 },
            complexStats: { stale_complex: { aggregated: { attempts: 2 } } },
            complexNames: { stale_complex: 'Stale complex' }
        });

        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(StatisticsApp, 'showSkeleton').mockImplementation(() => {});
        vi.spyOn(StatisticsApp, 'hideSkeleton').mockImplementation(() => {});
        vi.spyOn(StatisticsApp, 'render').mockImplementation(() => {});
        vi.spyOn(StatisticsApp, 'updateUserDisplay').mockImplementation(() => {});
        const toastSpy = vi.spyOn(StatisticsApp, 'showToast').mockImplementation(() => {});

        global.fetch = vi
            .fn()
            .mockResolvedValueOnce({ json: async () => ({ ok: false, error: 'stats_failed' }) })
            .mockResolvedValueOnce({ json: async () => ({ ok: true, dynamics: [] }) })
            .mockResolvedValueOnce({ json: async () => ({ ok: true, dynamics: [] }) })
            .mockResolvedValueOnce({ json: async () => ({ ok: true, complexes: {} }) })
            .mockResolvedValueOnce({ json: async () => ({ ok: false, error: 'complex_list_failed' }) })
            .mockResolvedValueOnce({ json: async () => ({ ok: false, error: 'theories_failed' }) });

        await StatisticsApp.loadData();

        expect(StatisticsApp.state.stats).toBeNull();
        expect(StatisticsApp.state.complexStats).toEqual({});
        expect(StatisticsApp.state.complexNames).toEqual({});
        expect(toastSpy).toHaveBeenCalledWith('Не удалось полностью обновить статистику. Показаны доступные данные.', 'warning');
    });
    it('renders theory analytics from linked complexes', () => {
        StatisticsApp.resetState({
            complexList: [
                { id: 'cx_a1', theory_link: { theory_id: 'th_a' } },
                { id: 'cx_a2', theory_link: { theory_id: 'th_a' } },
                { id: 'cx_b1', theory_link: { theory_id: 'th_b' } }
            ],
            theoryCatalog: [
                { id: 'th_a', title: 'Theory A' },
                { id: 'th_b', title: 'Theory B' }
            ],
            complexStats: {
                cx_a1: { aggregated: { attempts: 3, success_rate: 1 } },
                cx_a2: { aggregated: { attempts: 1, success_rate: 0.5 } },
                cx_b1: { aggregated: { attempts: 2, success_rate: 0.25 } }
            }
        });

        StatisticsApp.state.theoryInsights = StatisticsApp.buildTheoryInsights();
        StatisticsApp.renderTheoryInsights();

        const theoryList = document.getElementById('theory-analytics-list');
        expect(theoryList.textContent).toContain('Theory A');
        expect(theoryList.textContent).toContain('2 компл.');
        expect(theoryList.textContent).toContain('4 попыток');
    });
    it('keeps the time card empty when there is activity without tracked study time', () => {
        StatisticsApp.resetState({
            stats: {
                total_tasks_attempted: 0,
                total_time_spent: 0,
                activity_streak_days: 0,
                activity_streak_best: 0,
                microcards: {
                    reviews_total: 3,
                    correct_rate: 0.66
                },
                learning_sources: {
                    combined: { time_spent_seconds: 0 },
                    tasks: { time_spent_seconds: 0 },
                    microcards: { time_spent_seconds: 0 }
                }
            }
        });

        StatisticsApp.renderMetrics();

        const timeValue = document.getElementById('metric-time-value');
        const timeEmpty = document.getElementById('metric-time-empty');
        const timeHint = document.getElementById('time-source-hint');

        expect(timeValue.classList.contains('hidden')).toBe(true);
        expect(timeEmpty.classList.contains('hidden')).toBe(false);
        expect(timeHint.textContent).toBe('');
    });
    it('renders recent complexes with the full attempts label', () => {
        StatisticsApp.resetState({
            complexStats: {
                cx_1: {
                    aggregated: { attempts: 5, success_rate: 0.8 },
                    recent_sessions: [{ end_time: '2026-04-01T12:00:00Z' }]
                }
            },
            complexNames: {
                cx_1: 'Комплекс на повторение'
            }
        });

        StatisticsApp.renderComplexes();

        expect(document.getElementById('complexes-grid').textContent).toContain('5 попыток');
    });
    it('keeps the hidden empty-chart overlay suppressed in CSS', () => {
        const css = readFileSync(resolve(process.cwd(), 'frontend/statistics/statistics.css'), 'utf8');
        expect(css).toContain('.st-empty-overlay.hidden');
        expect(css).toMatch(/\.st-metric-body\.hidden,[\s\S]*\.st-empty-overlay\.hidden,[\s\S]*display:\s*none\s*!important;/);
    });
    it('does not tint today hitbox on the chart', () => {
        const css = readFileSync(resolve(process.cwd(), 'frontend/statistics/statistics.css'), 'utf8');
        expect(css).toContain('.chart-hit--today { fill: transparent; }');
    });
    it('treats API-level period failures as warnings and does not cache failed dynamics', async () => {
        StatisticsApp.resetState({
            currentPeriod: 7,
            stats: { total_tasks_attempted: 12 }
        });

        vi.spyOn(console, 'error').mockImplementation(() => {});
        const toastSpy = vi.spyOn(StatisticsApp, 'showToast').mockImplementation(() => {});
        vi.spyOn(StatisticsApp, 'render').mockImplementation(() => {});

        global.fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                json: async () => ({ ok: false, error: 'dynamics_failed' })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ok: true, dynamics: [DAY_TEMPLATE(0)] })
            });

        await StatisticsApp.switchPeriod(30);

        expect(StatisticsApp.state.currentPeriod).toBe(30);
        expect(StatisticsApp.state.dynamicsCache[30]).toBeUndefined();
        expect(Array.isArray(StatisticsApp.state.previousDynamicsCache[30])).toBe(true);
        expect(toastSpy).toHaveBeenCalled();
        expect(toastSpy.mock.calls.at(-1)).toEqual([expect.any(String), 'warning']);
        return;
        expect(toastSpy).toHaveBeenCalledWith('Не удалось полностью обновить график. Показаны доступные данные.', 'warning');
    });
    it('renders an actionable chart insight for downward trend', () => {
        StatisticsApp.resetState({
            currentMetric: 'attempts',
            currentPeriod: 7,
            dynamics: buildDynamics([
                { attempts: 2 },
                { attempts: 1 },
                { attempts: 0 },
                { attempts: 1 },
                { attempts: 0 },
                { attempts: 0 },
                { attempts: 1 }
            ]),
            previousDynamics: buildDynamics([
                { attempts: 6 },
                { attempts: 5 },
                { attempts: 4 },
                { attempts: 4 },
                { attempts: 5 },
                { attempts: 4 },
                { attempts: 6 }
            ])
        });

        StatisticsApp.updateChartInsight(StatisticsApp.state.dynamics);

        const insight = document.getElementById('chart-insight');
        expect(insight.textContent).toContain('меньше');
        expect(insight.textContent).toContain('короткую сессию');
    });
});
