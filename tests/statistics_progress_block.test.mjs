/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

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
        <div id="chart-content"></div>
        <div id="metric-tasks-icon"></div>
        <div id="metric-time-icon"></div>
        <div id="metric-streak-icon"></div>
        <span id="tasks-mastered"></span>
        <span id="tasks-total"></span>
        <span id="time-hours"></span>
        <span id="time-minutes"></span>
        <span id="streak-days"></span>
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
        expect(theoryList.textContent).toContain('2 complexes');
        expect(theoryList.textContent).toContain('4 attempts');
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
        expect(toastSpy).toHaveBeenCalledWith('РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»РЅРѕСЃС‚СЊСЋ РѕР±РЅРѕРІРёС‚СЊ РіСЂР°С„РёРє. РџРѕРєР°Р·Р°РЅС‹ РґРѕСЃС‚СѓРїРЅС‹Рµ РґР°РЅРЅС‹Рµ.', 'warning');
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
