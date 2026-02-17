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
        <span id="chart-period-text"></span>
        <div id="chart-insight-value"></div>
        <div id="chart-insight-subtitle"></div>
        <div id="chart-insight-tags"></div>
        <div id="chart-content"></div>
        <div id="chart-legend"></div>
        <div id="right-column"></div>
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
});
