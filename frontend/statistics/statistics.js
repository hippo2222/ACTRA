/**
 * Statistics Page - API Integration and UI Logic
 * Phase 1 MVP: Basic statistics display with dynamic Empty/Main state switching
 */

const createInitialState = () => ({
    stats: null,
    dynamics: [],
    previousDynamics: [],
    complexStats: {},
    currentUser: null,
    hasData: false,
    currentPeriod: 7,
    smoothingWindow: 3,
    currentMetric: 'study',
    focusedDay: null,
    focusSource: null,
    dynamicsCache: {},
    previousDynamicsCache: {}
});

const StatisticsApp = {
    state: createInitialState(),

    metricOptions: {
        attempts: {
            id: 'attempts',
            title: 'Решено задач',
            shortLabel: 'Задачи',
            legendPrimary: 'Количество задач',
            legendTrend: 'Средний темп',
            aggregator: 'sum',
            valueType: 'count',
            // Показываем суммарные попытки за день (total_attempts), если нет — количество уникальных задач (attempts)
            accessor: (day) => (day.total_attempts ?? day.attempts ?? 0),
            fallbackMax: 10,
            min: 0,
            activeCondition: (day) => ((day.total_attempts ?? day.attempts ?? 0) > 0)
        },
        study: {
            id: 'study',
            title: 'Минуты обучения',
            shortLabel: 'Время',
            legendPrimary: 'Минуты обучения',
            legendTrend: 'Средний темп',
            aggregator: 'sum',
            valueType: 'minutes',
            accessor: (day) => day.study_minutes || 0,
            fallbackMax: 60,
            min: 0,
            activeCondition: (day) => (day.study_minutes || 0) > 0
        }
    },

    resetState(overrides = {}) {
        this.state = { ...createInitialState(), ...overrides };
        return this.state;
    },

    initForTest(stateOverrides = {}) {
        this.resetState(stateOverrides);
        if (typeof stateOverrides.hasData !== 'boolean') {
            this.state.hasData = (this.state.dynamics?.length || 0) > 0;
        }
        this.render();
    },

    getMetricConfig(metricId = this.state.currentMetric) {
        return this.metricOptions[metricId] || this.metricOptions.attempts;
    },

    getMetricValue(day, metricId = this.state.currentMetric) {
        const config = this.getMetricConfig(metricId);
        return config.accessor(day) ?? 0;
    },

    aggregateMetric(dynamics = [], metricId = this.state.currentMetric) {
        const config = this.getMetricConfig(metricId);
        if (!dynamics.length) return 0;

        const values = dynamics.map(day => this.getMetricValue(day, metricId));
        if (config.aggregator === 'average') {
            const activeValues = values.filter(val => typeof val === 'number');
            if (!activeValues.length) return 0;
            return activeValues.reduce((sum, val) => sum + val, 0) / activeValues.length;
        }

        return values.reduce((sum, val) => sum + val, 0);
    },

    formatMetricValue(value, metricId = this.state.currentMetric) {
        const config = this.getMetricConfig(metricId);
        const numeric = Number.isFinite(value) ? value : 0;
        const isPercent = config.valueType === 'percent';
        const formatter = new Intl.NumberFormat('ru-RU', {
            minimumFractionDigits: isPercent ? 1 : 0,
            maximumFractionDigits: isPercent ? 1 : 0
        });
        const formatted = formatter.format(numeric);
        if (config.valueType === 'minutes') {
            return `${formatted} мин`;
        }
        if (isPercent) {
            return `${formatted}%`;
        }
        return formatted;
    },

    computeRollingAverage(values = [], window = 3) {
        if (!values.length) return [];
        const result = [];
        values.forEach((val, idx) => {
            const start = Math.max(0, idx - window + 1);
            const slice = values.slice(start, idx + 1);
            const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length;
            result.push(avg);
        });
        return result;
    },

    normalizeDynamics(dynamics = [], days = this.state.currentPeriod) {
        if (!Array.isArray(dynamics)) return [];

        const byDate = new Map();
        dynamics.forEach((d) => {
            if (!d || !d.date) return;
            byDate.set(d.date, d);
        });

        // Anchor is ALWAYS Today
        const today = new Date();
        const refDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const startDate = new Date(refDate);
        startDate.setDate(refDate.getDate() - (days - 1));

        const result = [];
        // Generate all dates in period to check for activity
        for (let i = 0; i < days; i += 1) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            const dateStr = [
                d.getFullYear(),
                String(d.getMonth() + 1).padStart(2, '0'),
                String(d.getDate()).padStart(2, '0')
            ].join('-');
            const existing = byDate.get(dateStr);
            const isToday = i === days - 1;

            if (existing) {
                const hasActivity = (existing.attempts || 0) > 0 || (existing.study_minutes || 0) > 0;
                if (hasActivity || isToday) {
                    result.push({ ...existing, _isSynthetic: false });
                }
            } else if (isToday) {
                // Today must always be present as the right boundary
                result.push({
                    date: dateStr,
                    attempts: 0,
                    study_minutes: 0,
                    _isSynthetic: true
                });
            }
        }
        return result;
    },

    getFireThresholds(metricId, period) {
        const isStudy = metricId === 'study';
        const bands = isStudy
            ? [
                { days: 7, absDelta: 8, ratio: 1.3, minValue: 12 },
                { days: 30, absDelta: 6, ratio: 1.2, minValue: 8 },
                { days: Infinity, absDelta: 4, ratio: 1.1, minValue: 5 }
            ]
            : [
                { days: 7, absDelta: 2, ratio: 1.5, minValue: 2 },
                { days: 30, absDelta: 1.5, ratio: 1.35, minValue: 1.5 },
                { days: Infinity, absDelta: 1, ratio: 1.2, minValue: 1 }
            ];
        return bands.find(band => period <= band.days) || bands[bands.length - 1];
    },

    switchMetric(metricId) {
        if (!metricId || this.state.currentMetric === metricId || !this.metricOptions[metricId]) {
            return;
        }
        this.state.currentMetric = metricId;
        this.state.focusedDay = null;
        this.state.focusSource = null;
        this.updateMetricToggle();
        this.updateLegendLabels();
        this.updateChartTitle();
        this.updateChartSummary();
        this.renderChart();
        this.updateChartInsight(this.state.dynamics);
    },

    focusDayLight(index) {
        if (typeof index !== 'number' || index < 0 || index >= this.state.dynamics.length) {
            return;
        }
        this.state.focusedDay = index;
        this.state.focusSource = 'chart';

        const container = document.getElementById('chart-content');
        if (container) {
            container.querySelectorAll('.chart-point').forEach(point => {
                const idx = Number(point.getAttribute('data-index'));
                point.classList.toggle('chart-point--focused', idx === index);
            });
        }
    },

    clearFocusLight(source) {
        if (this.state.focusSource && this.state.focusSource !== source) {
            return;
        }
        this.state.focusedDay = null;
        this.state.focusSource = null;

        const container = document.getElementById('chart-content');
        if (container) {
            container.querySelectorAll('.chart-point').forEach(point => {
                point.classList.remove('chart-point--focused');
            });
        }
    },

    updateMetricToggle() {
        const selector = document.getElementById('chart-metric-selector');
        if (!selector) return;
        selector.querySelectorAll('.chart-toggle-btn').forEach(btn => {
            const isActive = btn.dataset.metric === this.state.currentMetric;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    },

    updateLegendLabels() {
        const config = this.getMetricConfig();
        const primaryLabel = document.getElementById('legend-primary-label');
        const trendLabel = document.getElementById('legend-trend-label');
        if (primaryLabel) primaryLabel.textContent = config.legendPrimary;
        if (trendLabel) trendLabel.textContent = config.legendTrend;
    },

    updateChartTitle() {
        const titleEl = document.getElementById('chart-title');
        if (!titleEl) return;
        const metricId = this.state.currentMetric;
        titleEl.textContent = metricId === 'study' ? 'Время обучения' : 'Твоя активность';
    },

    updateChartSummary() {
        const deltaEl = document.getElementById('chart-period-delta');
        if (!deltaEl) return;

        const dynamics = this.state.dynamics || [];
        const currentMetric = this.state.currentMetric;
        const period = this.state.currentPeriod;

        if (dynamics.length === 0) {
            deltaEl.textContent = '—';
            return;
        }

        const totalValue = this.aggregateMetric(dynamics, currentMetric);
        const activeDays = dynamics.filter(day => this.getMetricValue(day, currentMetric) > 0).length;
        const weeklyStudyTarget = 90; // минут за 7 дней
        const weeklyAttemptsTarget = 6; // попыток за 7 дней
        const studyThreshold = Math.ceil(weeklyStudyTarget * (period / 7));
        const attemptsThreshold = Math.ceil(weeklyAttemptsTarget * (period / 7));
        const activeRatio = period > 0 ? activeDays / period : 0;

        // Формируем сообщение в зависимости от активности
        let message = '';

        if (currentMetric === 'study') {
            const totalMinutes = Math.round(totalValue);
            const avgPerDay = activeDays > 0 ? Math.round(totalMinutes / activeDays) : 0;

            if (totalMinutes === 0) {
                message = 'Начни заниматься, чтобы увидеть статистику';
            } else if (activeDays === 0) {
                message = `${totalMinutes} мин — нет активных дней`;
            } else if (totalMinutes < studyThreshold) {
                message = `${totalMinutes} мин за ${activeDays} дн. — попробуй заниматься чаще`;
            } else if (activeRatio <= 0.3) {
                message = `${totalMinutes} мин за ${activeDays} дн. — хорошее начало, добавь регулярности`;
            } else if (totalMinutes >= studyThreshold * 1.5 && activeRatio >= 0.7) {
                message = `${totalMinutes} мин за ${activeDays} дн. — отличный результат! 🔥`;
            } else if (activeDays === period) {
                message = `${totalMinutes} мин за ${activeDays} дн. — отличная регулярность! 🔥`;
            } else if (activeDays >= period * 0.7) {
                message = `${totalMinutes} мин за ${activeDays} дн. — хороший темп!`;
            } else if (avgPerDay >= 20) {
                message = `${totalMinutes} мин за ${activeDays} дн. — продолжай в том же духе`;
            } else {
                message = `${totalMinutes} мин за ${activeDays} дн.`;
            }
        } else {
            // Для метрики attempts
            const totalAttempts = Math.round(totalValue);

            if (totalAttempts === 0) {
                message = 'Начни решать задачи, чтобы увидеть прогресс';
            } else if (activeDays === 0) {
                message = `${totalAttempts} попыток — нет активных дней`;
            } else if (totalAttempts < attemptsThreshold) {
                message = `${totalAttempts} попыток за ${activeDays} дн. — попробуй решать чаще`;
            } else if (activeRatio <= 0.3) {
                message = `${totalAttempts} попыток за ${activeDays} дн. — хорошее начало, занимайся регулярнее`;
            } else if (totalAttempts >= attemptsThreshold * 1.5 && activeRatio >= 0.7) {
                message = `${totalAttempts} попыток за ${activeDays} дн. — отличный результат! 🔥`;
            } else if (activeDays === period) {
                message = `${totalAttempts} попыток за ${activeDays} дн. — ты занимаешься каждый день! 🔥`;
            } else if (activeDays >= period * 0.7) {
                message = `${totalAttempts} попыток за ${activeDays} дн. — отличная активность!`;
            } else if (activeDays > 0) {
                message = `${totalAttempts} попыток за ${activeDays} дн.`;
            } else {
                message = `${totalAttempts} попыток`;
            }
        }

        deltaEl.textContent = message;
    },

    calculatePeriodDelta() {
        const metricId = this.state.currentMetric;
        const hasPrevious = Array.isArray(this.state.previousDynamics) && this.state.previousDynamics.length > 0;
        const currentValue = this.aggregateMetric(this.state.dynamics, metricId);
        const previousValue = this.aggregateMetric(this.state.previousDynamics, metricId);
        if (!hasPrevious) {
            return { deltaPercent: 0, direction: 'flat', hasPrevious: false, currentValue, previousValue: 0, valueDelta: 0 };
        }

        const valueDelta = currentValue - previousValue;
        const deltaPercent = previousValue === 0 ? 0 : ((valueDelta) / previousValue) * 100;
        const direction = valueDelta > 3 ? 'up' : valueDelta < -3 ? 'down' : Math.abs(deltaPercent) > 3 ? (deltaPercent > 0 ? 'up' : 'down') : 'flat';
        return { deltaPercent, direction, hasPrevious: true, currentValue, previousValue, valueDelta };
    },

    focusDay(index, source = 'chart') {
        if (typeof index !== 'number' || index < 0 || index >= this.state.dynamics.length) {
            return;
        }
        this.state.focusedDay = index;
        this.state.focusSource = source;
        this.renderChart();
    },

    clearFocus(source) {
        if (this.state.focusSource && this.state.focusSource !== source) {
            return;
        }
        this.state.focusedDay = null;
        this.state.focusSource = null;

        // Optimized update without full re-render
        const container = document.getElementById('chart-content');
        if (container) {
            container.querySelectorAll('.chart-point--focused').forEach(el => el.classList.remove('chart-point--focused'));
            container.querySelectorAll('.chart-bar--focused').forEach(el => el.classList.remove('chart-bar--focused'));
        }
    },

    getCurrentUserQuery() {
        const userId = this.state.currentUser?.user_id;
        return userId ? `user_id=${encodeURIComponent(userId)}` : '';
    },

    buildApiUrl(baseUrl) {
        const query = this.getCurrentUserQuery();
        if (!query) return baseUrl;
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}${query}`;
    },

    showSkeleton() {
        const skeleton = document.getElementById('chart-skeleton');
        const chartContent = document.getElementById('chart-content');
        if (skeleton) skeleton.classList.remove('hidden');
        if (chartContent) chartContent.classList.add('hidden');
    },

    hideSkeleton() {
        const skeleton = document.getElementById('chart-skeleton');
        const chartContent = document.getElementById('chart-content');
        if (skeleton) skeleton.classList.add('hidden');
        if (chartContent) chartContent.classList.remove('hidden');
    },

    async init() {
        console.log('[Statistics] Initializing...');
        this.bindEvents();
        await this.loadUserProfile();
        await this.loadData();
        console.log('[Statistics] Init complete. State:', JSON.stringify(this.state, null, 2));
    },

    async loadUserProfile() {
        try {
            const res = await fetch('/api/users/current');
            const data = await res.json();
            console.log('[Statistics] User API response:', data);
            if (data.ok && data.user) {
                this.state.currentUser = data.user;
                console.log('[Statistics] User loaded:', data.user.name, 'avatar_seed:', data.user.avatar_seed);
                this.updateUserDisplay();
            } else {
                console.warn('[Statistics] No user found in response');
            }
        } catch (error) {
            console.error('[Statistics] Failed to load user profile:', error);
        }
    },

    getAvatarUrl(avatarSeed, userId) {
        if (!avatarSeed) avatarSeed = userId;
        // Check if it looks like a filename (contains a dot)
        if (avatarSeed && avatarSeed.includes('.')) {
            return `/api/assets/avatars/${avatarSeed}`;
        }
        return '/api/assets/avatars/1.png';
    },

    // Profile modal functions provided by SharedProfileModal.js

    updateUserDisplay() {
        const user = this.state.currentUser;
        const avatarEl = document.getElementById('headerAvatar');
        const nameEl = document.getElementById('headerUserName');
        const streakBadge = document.getElementById('streak-badge');

        console.log('[Statistics] updateUserDisplay called, user:', user);

        if (user) {
            const avatarUrl = this.getAvatarUrl(user.avatar_seed, user.user_id);
            console.log('[Statistics] Avatar URL:', avatarUrl);

            if (avatarEl) {
                avatarEl.src = avatarUrl;
            }
            if (nameEl) {
                nameEl.textContent = user.name || 'Гость';
            }
        }

        // Update streak badge (dim if gap=1, hide flame if gap>1)
        if (streakBadge) {
            const streak = this.state.stats?.streak_days || 0;
            const streakGap = this.state.stats?.streak_gap || 0;
            const flameOpacity = streakGap === 1 ? 0.4 : 1;
            const hideFlame = streakGap > 1;
            if (streak > 0) {
                streakBadge.innerHTML = `
                    <span class="material-symbols-outlined ${hideFlame ? 'opacity-0' : ''} text-warning text-sm" style="opacity:${flameOpacity};">local_fire_department</span>
                    <span class="text-sm font-bold text-text-secondary dark:text-text-on-dark">${streak}</span>
                `;
                streakBadge.classList.remove('hidden');
            } else {
                streakBadge.innerHTML = '';
                streakBadge.classList.add('hidden');
            }
        }
    },

    bindEvents() {
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const period = parseInt(e.currentTarget.dataset.period);
                this.switchPeriod(period);
            });
        });

        const metricSelector = document.getElementById('chart-metric-selector');
        if (metricSelector) {
            metricSelector.querySelectorAll('.chart-toggle-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const metric = e.currentTarget.dataset.metric;
                    this.switchMetric(metric);
                });
            });

            metricSelector.addEventListener('mouseenter', () => {
                this.hideChartTooltip();
                this.clearFocus('chart');
            });
        }

        const periodSwitch = document.querySelector('.chart-period-switch');
        if (periodSwitch) {
            periodSwitch.addEventListener('mouseenter', () => {
                this.hideChartTooltip();
                this.clearFocus('chart');
            });
        }
    },

    async loadData() {
        this.showSkeleton();
        try {
            const period = this.state.currentPeriod;
            const statsUrl = this.buildApiUrl('/api/statistics/overall');
            const dynamicsUrl = this.buildApiUrl(`/api/statistics/time-dynamics?days=${period}&smooth=${this.state.smoothingWindow}`);
            const previousPeriodUrl = this.buildApiUrl(`/api/statistics/time-dynamics?days=${period}&offset=${period}&smooth=${this.state.smoothingWindow}`);
            const complexesUrl = this.buildApiUrl('/api/statistics/complexes');
            const complexesListUrl = this.buildApiUrl('/api/complexes');

            const [statsRes, dynamicsRes, previousRes, complexesRes, complexesListRes] = await Promise.all([
                fetch(statsUrl),
                fetch(dynamicsUrl),
                fetch(previousPeriodUrl),
                fetch(complexesUrl),
                fetch(complexesListUrl)
            ]);

            const statsData = await statsRes.json();
            const dynamicsData = await dynamicsRes.json();
            const previousData = await previousRes.json();
            const complexesData = await complexesRes.json();
            const complexesListData = await complexesListRes.json();

            console.log('[Statistics] API Responses:', {
                stats: statsData,
                dynamics: dynamicsData,
                previous: previousData,
                complexes: complexesData
            });

            if (statsData.ok) {
                this.state.stats = statsData.stats;
                console.log('[Statistics] Stats loaded:', this.state.stats);
            } else {
                console.warn('[Statistics] Stats API error:', statsData);
            }

            if (dynamicsData.ok) {
                const raw = dynamicsData.dynamics || [];
                this.state.dynamics = this.normalizeDynamics(raw, period);
                this.state.dynamicsCache[this.state.currentPeriod] = this.state.dynamics;
            } else {
                this.state.dynamics = [];
            }

            if (previousData.ok) {
                const rawPrev = previousData.dynamics || [];
                this.state.previousDynamics = this.normalizeDynamics(rawPrev, period);
                this.state.previousDynamicsCache[this.state.currentPeriod] = this.state.previousDynamics;
            } else {
                this.state.previousDynamics = [];
            }

            this.state.complexStats = complexesData.complexes || {};

            // Build complex name lookup from /api/complexes
            this.state.complexNames = {};
            if (complexesListData.ok && complexesListData.items) {
                for (const c of complexesListData.items) {
                    if (c.id && c.name) this.state.complexNames[c.id] = c.name;
                }
            }
            const statsHasData = !!(this.state.stats && ((this.state.stats.total_tasks_attempted || 0) > 0 || (this.state.stats.total_time_spent || 0) > 0));
            const dynamicsHasData = (this.state.dynamics?.length || 0) > 0;
            this.state.hasData = statsHasData || dynamicsHasData;

            this.hideSkeleton();
            this.render();
            this.updateUserDisplay();
        } catch (error) {
            console.error('[Statistics] Failed to load data:', error);
            this.state.hasData = false;
            this.state.dynamics = [];
            this.state.previousDynamics = [];
            this.hideSkeleton();
            this.render();
        }
    },

    async switchPeriod(days) {
        if (this.state.currentPeriod === days) return;

        this.state.currentPeriod = days;
        this.state.focusedDay = null;
        this.state.focusSource = null;

        document.querySelectorAll('.period-btn').forEach(btn => {
            const isActive = parseInt(btn.dataset.period) === days;
            btn.classList.toggle('active', isActive);

            // Active State
            btn.classList.toggle('bg-surface-1', isActive);
            btn.classList.toggle('text-text-main', isActive);
            btn.classList.toggle('shadow-sm', isActive);
            btn.classList.toggle('border', isActive);
            btn.classList.toggle('border-border-subtle', isActive);

            // Inactive State
            btn.classList.toggle('text-text-secondary', !isActive);
        });

        const loadCurrent = this.state.dynamicsCache[days]
            ? Promise.resolve(this.state.dynamicsCache[days])
            : fetch(this.buildApiUrl(`/api/statistics/time-dynamics?days=${days}&smooth=${this.state.smoothingWindow}`))
                .then(res => res.json())
                .then(data => (data.ok ? data.dynamics || [] : []))
                .catch((error) => {
                    console.error('[Statistics] Failed to load dynamics:', error);
                    return [];
                });

        const loadPrevious = this.state.previousDynamicsCache[days]
            ? Promise.resolve(this.state.previousDynamicsCache[days])
            : fetch(this.buildApiUrl(`/api/statistics/time-dynamics?days=${days}&offset=${days}&smooth=${this.state.smoothingWindow}`))
                .then(res => res.json())
                .then(data => (data.ok ? data.dynamics || [] : []))
                .catch((error) => {
                    console.error('[Statistics] Failed to load previous dynamics:', error);
                    return [];
                });

        const [current, previous] = await Promise.all([loadCurrent, loadPrevious]);
        this.state.dynamics = this.normalizeDynamics(current, days);
        this.state.previousDynamics = this.normalizeDynamics(previous, days);
        this.state.dynamicsCache[days] = this.state.dynamics;
        this.state.previousDynamicsCache[days] = this.state.previousDynamics;
        const statsHasData = !!(this.state.stats && ((this.state.stats.total_tasks_attempted || 0) > 0 || (this.state.stats.total_time_spent || 0) > 0));
        const dynamicsHasData = (this.state.dynamics?.length || 0) > 0;
        this.state.hasData = statsHasData || dynamicsHasData;

        this.render();
    },

    render() {
        this.renderMetrics();
        this.updateMetricToggle();
        this.updateLegendLabels();
        this.updateChartTitle();
        this.updateChartSummary();
        this.renderChart();
        this.renderPerformance();
        this.renderComplexes();
        this.updateEmptyState();
    },

    renderMetrics() {
        const stats = this.state.stats || {};
        const hasData = this.state.hasData;
        const hasStatsData = !!(
            (stats.total_tasks_attempted || 0) > 0 ||
            (stats.total_time_spent || 0) > 0
        );

        console.log('[Statistics] renderMetrics - stats:', stats, 'hasData:', hasData);

        const toggleMetricEmpty = (valueId, emptyId, hasMetricData) => {
            const valueEl = document.getElementById(valueId);
            const emptyEl = document.getElementById(emptyId);
            if (!valueEl || !emptyEl) return;
            if (hasMetricData) {
                valueEl.classList.remove('hidden');
                emptyEl.classList.add('hidden');
            } else {
                valueEl.classList.add('hidden');
                emptyEl.classList.remove('hidden');
            }
        };

        // Always show actual values from API (even if 0)
        const tasksMastered = stats.tasks_mastered ?? 0;
        const totalTasks = stats.total_tasks_available || 0;
        document.getElementById('tasks-mastered').textContent = tasksMastered;
        document.getElementById('tasks-total').textContent = `/ ${totalTasks}`;

        const totalTime = stats.total_time_spent || 0;
        const hours = Math.floor(totalTime / 3600);
        const minutes = Math.floor((totalTime % 3600) / 60);
        document.getElementById('time-hours').textContent = hours;
        document.getElementById('time-minutes').textContent = String(minutes).padStart(2, '0');

        const streakDays = stats.streak_days || 0;
        const streakBest = stats.streak_best || 0;
        const streakGap = stats.streak_gap || 0;
        document.getElementById('streak-days').textContent = streakDays;
        const bestEl = document.getElementById('streak-best');
        if (bestEl) bestEl.textContent = streakBest;

        const hasMetricData = hasStatsData;
        toggleMetricEmpty('metric-tasks-value', 'metric-tasks-empty', hasMetricData);
        toggleMetricEmpty('metric-time-value', 'metric-time-empty', hasMetricData);
        toggleMetricEmpty('metric-streak-value', 'metric-streak-empty', hasMetricData);

        ['metric-tasks', 'metric-time', 'metric-streak'].forEach((id) => {
            const card = document.getElementById(id);
            if (!card) return;
            card.classList.toggle('metric-card--empty', !hasMetricData);
        });

        this.updateMetricStyles(hasMetricData);
    },

    updateMetricStyles(hasData) {
        const metricConfigs = [
            { id: 'metric-tasks', iconId: 'metric-tasks-icon', color: 'info', icon: 'school' },
            { id: 'metric-time', iconId: 'metric-time-icon', color: 'secondary', icon: 'schedule' },
            { id: 'metric-streak', iconId: 'metric-streak-icon', color: 'accent', icon: 'local_fire_department' }
        ];

        metricConfigs.forEach(config => {
            const iconEl = document.getElementById(config.iconId);
            if (hasData) {
                iconEl.classList.remove('bg-bg-secondary', 'text-text-muted');
                iconEl.classList.add(`bg-${config.color}-light`, `text-${config.color}-dark`);
            } else {
                iconEl.classList.add('bg-bg-secondary', 'text-text-muted');
                iconEl.classList.remove(`bg-${config.color}-light`, `text-${config.color}-dark`);
            }
        });
    },

    renderChart() {
        const container = document.getElementById('chart-content');
        const dynamics = this.state.dynamics || [];
        const hasData = dynamics.some(day => this.getMetricValue(day) > 0);

        this.updateChartLayoutState(hasData);

        if (!container || !hasData) {
            this.hideChartTooltip();
            this.updateChartInsight(null);
            if (container) container.innerHTML = '';
            return;
        }

        // updateChartInsight больше не используется для UI

        const metricConfig = this.getMetricConfig();
        const values = dynamics.map(day => this.getMetricValue(day));

        // Robust dimension calculation
        const viewport = container.closest('.chart-viewport');
        const rect = viewport?.getBoundingClientRect();
        const width = rect?.width || container.clientWidth || 640;
        const height = Math.max(240, rect?.height || width * 0.45);

        // Compact margins
        const margin = { top: 20, right: 20, bottom: 40, left: 40 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        const isSparse = dynamics.length <= 3;

        const minValue = metricConfig.min ?? 0;
        const dataMax = Math.max(...values);
        const computedMax = (Number.isFinite(dataMax) && dataMax > 0) ? dataMax : (metricConfig.fallbackMax || 10);
        const paddedMax = computedMax > 0 ? Math.ceil(computedMax * 1.25) : computedMax;
        const maxValue = metricConfig.max
            ? Math.min(metricConfig.max, Math.max(paddedMax, minValue + 1))
            : Math.max(paddedMax, minValue + 1);
        const range = Math.max(maxValue - minValue, 1);

        const step = dynamics.length > 1 ? innerWidth / (dynamics.length - 1) : 0;
        const barWidth = Math.max(10, Math.min(28, innerWidth / Math.max(dynamics.length, 4) * 0.6));
        const focusIndex = this.state.focusedDay;

        const bars = [];
        const labels = [];
        const hits = [];
        const points = [];
        const trendPoints = [];
        const fireIcons = [];

        const rolling = this.computeRollingAverage(values, this.state.smoothingWindow || 3);

        // Находим максимальное значение для отметки огоньком
        const maxVal = Math.max(...values);
        const maxIndices = values.map((v, i) => v === maxVal && v > 0 ? i : -1).filter(i => i >= 0);
        const maxIndexSet = new Set(maxIndices);
        const otherMax = values
            .map((v, i) => (maxIndexSet.has(i) ? -Infinity : v))
            .reduce((m, v) => (v > m ? v : m), -Infinity);
        const nextBest = Number.isFinite(otherMax) ? Math.max(0, otherMax) : 0;

        const metricIdForFire = this.state.currentMetric;
        const thresholds = this.getFireThresholds(metricIdForFire, this.state.currentPeriod || dynamics.length);
        const nonZeroCount = values.filter(v => v > 0).length;

        const hasStrongLead = nextBest > 0
            ? ((maxVal - nextBest) >= thresholds.absDelta) || ((maxVal / nextBest) >= thresholds.ratio)
            : maxVal >= thresholds.minValue;

        const fallbackLead = maxVal > 0 && (
            nonZeroCount === 1 ||
            (nextBest <= thresholds.minValue * 0.5 && maxVal >= thresholds.minValue * 0.5) ||
            (nextBest === 0 && maxVal > 0)
        );

        const fireIsOutstanding = maxVal > 0
            && maxIndices.length > 0
            && (hasStrongLead || fallbackLead);

        const pointPadding = 6; // чтобы точки/огонёк не упирались в границы

        dynamics.forEach((day, idx) => {
            // Calculate X relative to inner area
            const x = dynamics.length === 1 ? innerWidth / 2 : idx * step;
            const clampedX = Math.min(Math.max(x, pointPadding), innerWidth - pointPadding);
            const value = values[idx] ?? 0;
            const ratio = (value - minValue) / range;
            const y = innerHeight - (ratio * innerHeight); // Y is from top (0) to bottom (innerHeight)

            const isToday = this.isToday(day.date);
            const isFocused = typeof focusIndex === 'number' && focusIndex === idx;

            let barCenterX = clampedX;
            // Bars - добавляем минимальную высоту для значений > 0
            const minBarHeight = 8; // Минимальная видимая высота
            let barH = Math.max(0, ratio * innerHeight * (metricConfig.valueType === 'percent' ? 0.9 : 0.8));
            if (value > 0 && barH < minBarHeight) {
                barH = minBarHeight;
            }
            const barY = innerHeight - barH;

            // Отрисовываем столбец только если есть значение > 0
            if (value > 0) {
                const rawBarX = x - barWidth / 2;
                const barX = Math.min(
                    Math.max(rawBarX, 0),
                    innerWidth - barWidth
                );
                barCenterX = barX + barWidth / 2;
                bars.push(
                    `<rect x="${barX.toFixed(2)}" y="${barY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barH.toFixed(2)}" rx="6" class="chart-bar${isFocused ? ' chart-bar--focused' : ''}"></rect>`
                );
            }

            // Добавляем огонёк на лучшие дни (заменяет кружочек)
            const isFireDay = fireIsOutstanding && maxIndexSet.has(idx) && maxVal > 0;
            if (isFireDay) {
                const fireX = barCenterX;
                const fireY = y;
                const cls = ['chart-fire-icon', 'chart-point'];
                if (isToday) cls.push('chart-point--today');
                if (isFocused) cls.push('chart-point--focused');

                fireIcons.push(
                    `<text x="${fireX.toFixed(2)}" y="${fireY.toFixed(2)}" 
                        text-anchor="middle" dominant-baseline="middle" 
                        font-size="18" class="${cls.join(' ')}" 
                        data-index="${idx}"
                        role="img" aria-label="Best day achievement"
                        style="cursor: pointer;">🔥</text>`
                );
            }

            // Points - только если это не день с огоньком
            if (!day?._isSynthetic && !isFireDay) {
                points.push({ x: barCenterX, y, isToday, isFocused, index: idx });
            }

            // Trend
            if (typeof rolling[idx] === 'number') {
                const trRatio = (rolling[idx] - minValue) / range;
                const trY = innerHeight - (trRatio * innerHeight);
                trendPoints.push(`${x.toFixed(2)},${trY.toFixed(2)}`);
            }

            // Labels - показываем только ключевые точки
            const showLabel = dynamics.length <= 7 || idx === 0 || idx === dynamics.length - 1 ||
                (dynamics.length <= 14 && idx % 2 === 0) ||
                (dynamics.length > 14 && idx % Math.ceil(dynamics.length / 7) === 0);

            if (showLabel) {
                const { label } = this.getDayLabelInfo(day.date);
                let anchor = 'middle';
                if (idx === 0) anchor = 'start';
                if (idx === dynamics.length - 1) anchor = 'end';

                labels.push(
                    `<text x="${clampedX.toFixed(2)}" y="16" text-anchor="${anchor}" class="chart-label ${isToday ? 'chart-label--today' : ''}">${label}</text>`
                );
            }

            // Hitbox (relative to groups, will need adjustment in render)
            // Actually, hitboxes should cover the full vertical area including padding
            // So we render them in a separate group or adjust coords
            const rawHitW = dynamics.length > 1 ? Math.max(barWidth * 2, step) : innerWidth * 0.5;
            const hitW = Math.min(rawHitW, innerWidth);
            const minHitX = margin.left;
            const maxHitX = margin.left + innerWidth - hitW;
            const rawHitX = margin.left + x - hitW / 2;
            const hitX = Math.min(Math.max(rawHitX, minHitX), maxHitX);
            if (!day?._isSynthetic) {
                hits.push(
                    `<rect class="chart-hit ${isToday ? 'chart-hit--today' : ''}" data-index="${idx}" x="${hitX.toFixed(2)}" y="${margin.top}" width="${hitW.toFixed(2)}" height="${innerHeight.toFixed(2)}" fill="transparent" role="button" tabindex="0" aria-label="${this.formatFullDate(day.date)}"></rect>`
                );
            }
        });

        // Trend line
        const trendPath = trendPoints.length > 1
            ? `<polyline points="${trendPoints.join(' ')}" class="chart-line chart-line--smooth" />`
            : '';

        // Point markers
        const pointElements = points.map(p => {
            const r = p.isFocused ? 6 : 5; // today и обычные одинакового размера
            const cls = ['chart-point'];
            if (p.isToday) cls.push('chart-point--today');
            if (p.isFocused) cls.push('chart-point--focused');
            return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r}" class="${cls.join(' ')}" data-index="${p.index}"></circle>`;
        }).join('');

        // Grid - только 3 линии для компактности
        const gridLines = isSparse ? '' : Array.from({ length: 3 }).map((_, i) => {
            const y = (i / 2) * innerHeight;
            return `<line x1="0" y1="${y.toFixed(2)}" x2="${innerWidth.toFixed(2)}" y2="${y.toFixed(2)}" class="chart-grid-line"/>`;
        }).join('');

        // Вертикальная ось слева (тонкая, на фоне)
        const axisLine = `<line x1="0" y1="0" x2="0" y2="${innerHeight.toFixed(2)}" class="chart-axis"/>`;
        const axisTicks = (() => {
            const labels = [];
            const topVal = maxValue;
            const midVal = (maxValue + minValue) / 2;
            const bottomVal = minValue;
            const items = [
                { y: 0, val: topVal },
                { y: innerHeight / 2, val: midVal },
                { y: innerHeight, val: bottomVal }
            ];
            items.forEach(item => {
                labels.push(
                    `<text x="-8" y="${item.y.toFixed(2)}" text-anchor="end" dominant-baseline="middle" class="chart-axis-label">${this.formatMetricValue(item.val)}</text>`
                );
            });
            return labels.join('');
        })();

        container.innerHTML = `
            <svg viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" class="chart-svg" preserveAspectRatio="xMidYMid meet" style="overflow: visible;">
                <defs>
                    <linearGradient id="chartBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#dbeafe" />
                        <stop offset="100%" stop-color="#93c5fd" />
                    </linearGradient>
                </defs>
                
                <g transform="translate(${margin.left}, ${margin.top})">
                    ${axisLine}
                    ${axisTicks ? `<g>${axisTicks}</g>` : ''}
                    ${gridLines ? `<g>${gridLines}</g>` : ''}
                    <g class="chart-bars" fill="url(#chartBarGradient)">${bars.join('')}</g>
                    ${trendPath}
                    <g class="chart-fire-icons">${fireIcons.join('')}</g>
                    <g class="chart-points">${pointElements}</g>
                </g>

                <g transform="translate(${margin.left}, ${margin.top + innerHeight})">
                     <g class="chart-labels">${labels.join('')}</g>
                </g>

                <g class="chart-hit-layer">${hits.join('')}</g>
            </svg>
        `;

        this.bindChartTooltip(container, dynamics);
    },

    formatDateLabel(dateStr) {
        const date = new Date(dateStr);
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        return days[date.getDay()];
    },

    getDayLabelInfo(dateStr) {
        const date = new Date(dateStr);
        const isToday = this.isToday(dateStr);
        const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const label = `${dayNames[date.getDay()]} ${date.getDate()}`;
        return { label, isToday };
    },

    isToday(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        return date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate();
    },

    formatFullDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
    },

    updateChartInsight(dynamics) {
        // Эта функция больше не используется, так как сообщение теперь выводится в updateChartSummary
    },

    describeEvent(event) {
        if (!event || !event.type) return '';
        switch (event.type) {
            case 'perfect_day':
                return 'Идеальный день';
            case 'long_study':
                return '60+ мин';
            case 'streak_break':
                return event.gap_days ? `Перерыв ${event.gap_days} дн.` : 'Перерыв';
            case 'big_improvement':
                return event.delta ? `Прирост +${Math.round(event.delta * 100)} п.п.` : 'Уверенный рост';
            case 'drop':
                return event.delta ? `Снижение ${Math.round(event.delta * 100)} п.п.` : 'Спад';
            default:
                return '';
        }
    },

    getChartTooltipElement() {
        if (this._chartTooltip) return this._chartTooltip;
        const chartCard = document.getElementById('chart-card');
        if (!chartCard) return null;
        const tooltip = document.createElement('div');
        tooltip.id = 'chart-tooltip';
        tooltip.className = 'chart-tooltip hidden';
        chartCard.appendChild(tooltip);
        this._chartTooltip = tooltip;
        this._tooltipLastIndex = null;
        this._tooltipDebounceFrame = null;
        this._tooltipHideTimer = null;
        return tooltip;
    },

    bindChartTooltip(container, dynamics) {
        const tooltip = this.getChartTooltipElement();
        if (!tooltip) return;

        const chartCard = document.getElementById('chart-card');
        const hitboxes = container.querySelectorAll('.chart-hit');
        let currentIndex = null;
        let isVisible = false;

        const showTooltip = (idx, event) => {
            if (currentIndex === idx && isVisible) {
                return;
            }
            currentIndex = idx;
            const day = dynamics[idx];
            if (!day) return;
            if (day._isSynthetic) return;

            if (this._tooltipLastIndex !== idx) {
                tooltip.innerHTML = this.buildTooltipHtml(day);
                this._tooltipLastIndex = idx;
            }

            tooltip.classList.remove('hidden');
            void tooltip.offsetWidth; // trigger reflow for animation
            tooltip.classList.add('visible');
            isVisible = true;
            this.updateTooltipPosition(tooltip, chartCard, event);
            this.focusDayLight(idx);
        };

        const schedulePositionUpdate = (event) => {
            if (!isVisible || !chartCard) return;
            if (this._tooltipDebounceFrame) {
                cancelAnimationFrame(this._tooltipDebounceFrame);
            }
            this._tooltipDebounceFrame = requestAnimationFrame(() => {
                this.updateTooltipPosition(tooltip, chartCard, event);
            });
        };

        const hideTooltip = () => {
            if (!isVisible) return;
            tooltip.classList.remove('visible');
            isVisible = false;
            currentIndex = null;
            if (this._tooltipDebounceFrame) {
                cancelAnimationFrame(this._tooltipDebounceFrame);
                this._tooltipDebounceFrame = null;
            }
            if (this._tooltipHideTimer) {
                clearTimeout(this._tooltipHideTimer);
            }
            this._tooltipHideTimer = setTimeout(() => {
                if (!isVisible) {
                    tooltip.classList.add('hidden');
                }
            }, 200);
            this.clearFocusLight('chart');
        };

        hitboxes.forEach(hit => {
            hit.addEventListener('mouseenter', (e) => {
                const idx = Number(e.target.dataset.index);
                showTooltip(idx, e);
            });

            hit.addEventListener('mousemove', (e) => {
                schedulePositionUpdate(e);
            });

            hit.addEventListener('mouseleave', () => {
                hideTooltip();
            });
        });
    },

    updateTooltipPosition(tooltip, chartCard, event) {
        if (!chartCard || !event) return;
        const cardRect = chartCard.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const margin = 12;
        const arrowOffset = 16;

        let left = event.clientX - cardRect.left;
        const halfWidth = tooltipRect.width / 2;
        if (left - halfWidth < margin) {
            left = halfWidth + margin;
        } else if (left + halfWidth > cardRect.width - margin) {
            left = cardRect.width - halfWidth - margin;
        }

        let top = event.clientY - cardRect.top - tooltipRect.height - arrowOffset;
        if (top < margin) {
            top = event.clientY - cardRect.top + arrowOffset;
            tooltip.style.transform = 'translate(-50%, 0)';
        } else {
            tooltip.style.transform = 'translate(-50%, -100%)';
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    },

    hideChartTooltip() {
        const tooltip = this.getChartTooltipElement();
        if (!tooltip) return;
        tooltip.classList.remove('visible');
        if (this._tooltipDebounceFrame) {
            cancelAnimationFrame(this._tooltipDebounceFrame);
            this._tooltipDebounceFrame = null;
        }
        if (this._tooltipHideTimer) {
            clearTimeout(this._tooltipHideTimer);
        }
        this._tooltipHideTimer = setTimeout(() => {
            if (!tooltip.classList.contains('visible')) {
                tooltip.classList.add('hidden');
            }
        }, 200);
    },

    // Упрощенный tooltip - только факты
    buildTooltipHtml(day) {
        const attempts = day.attempts ?? 0;
        const totalAttempts = day.total_attempts ?? attempts;
        const study = day.study_minutes ?? 0;
        const labelInfo = this.getDayLabelInfo(day.date);

        return `
            <div class="chart-tooltip-date">${this.formatFullDate(day.date)}${labelInfo.isToday ? ' · Сегодня' : ''}</div>
            <div class="chart-tooltip-row">
                <span>Решено задач:</span>
                <span>${attempts}</span>
            </div>
            <div class="chart-tooltip-row">
                <span>Всего попыток:</span>
                <span>${totalAttempts}</span>
            </div>
            <div class="chart-tooltip-row">
                <span>Время учёбы:</span>
                <span>${study} мин</span>
            </div>
        `;
    },

    updateChartLayoutState(hasData) {
        const chartContent = document.getElementById('chart-content');
        const emptyChart = document.getElementById('empty-chart');
        const summary = document.getElementById('chart-summary');

        if (hasData) {
            if (chartContent) chartContent.classList.remove('hidden');
            if (emptyChart) emptyChart.classList.add('hidden');
            if (summary) summary.classList.remove('hidden');
        } else {
            if (chartContent) chartContent.classList.add('hidden');
            if (emptyChart) emptyChart.classList.remove('hidden');
            if (summary) summary.classList.add('hidden');
        }
    },

    renderPerformance() {
        const container = document.getElementById('performance-bars');
        const stats = this.state.stats || {};
        const byType = this.normalizePerformanceTypes(stats.by_task_type);
        const hasAnyAttempts = Object.values(byType || {}).some(v => (v?.attempts || 0) > 0);

        const typeConfig = {
            click: { name: 'Клик', color: 'indigo', order: 1 },
            draw: { name: 'Рисование', color: 'cyan', order: 2 },
            open_answer: { name: 'Открытый ответ', color: 'rose', order: 3 },
            sequence: { name: 'Последовательность', color: 'emerald', order: 4 },
            test: { name: 'Тест', color: 'amber', order: 5 },
            unknown: { name: 'Без категории', color: 'slate', order: 99 }
        };

        const typeSet = new Set([
            ...Object.keys(typeConfig),
            ...Object.keys(byType || {})
        ]);

        const types = Array.from(typeSet)
            .filter(type => type !== 'unknown')
            .sort((a, b) => {
                const orderA = typeConfig[a]?.order ?? 50;
                const orderB = typeConfig[b]?.order ?? 50;
                if (orderA === orderB) return a.localeCompare(b);
                return orderA - orderB;
            });

        const formatLabel = (type) => {
            if (!type || type === 'unknown') return 'Без категории';
            const label = type.replace(/_/g, ' ');
            return label.replace(/\b\w/g, char => char.toUpperCase());
        };

        if (!hasAnyAttempts) {
            container.innerHTML = '<p class="text-sm text-text-muted text-center py-3">Пока нет данных по типам задач. Пройдите несколько заданий, чтобы увидеть статистику.</p>';
            return;
        }

        container.innerHTML = types.map(type => {
            const config = typeConfig[type] || { name: formatLabel(type), color: 'slate' };
            const data = byType[type] || { attempts: 0, average_score: 0 };
            const rate = data.attempts > 0 ? Math.round(data.average_score) : 0;
            const hasTypeData = data.attempts > 0;

            return `
                <div>
                    <div class="flex justify-between text-sm mb-1">
                        <span class="${hasTypeData ? 'text-text-main' : 'text-text-muted'} font-medium">${config.name}</span>
                        <span class="${hasTypeData ? 'text-text-main' : 'text-text-muted'} font-bold">${hasTypeData ? rate + '%' : '—'}</span>
                    </div>
                    <div class="h-2 w-full bg-bg-secondary rounded-full overflow-hidden">
                        <div class="h-full bg-primary rounded-full transition-all duration-500" style="width: ${rate}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    },

    normalizePerformanceTypes(byType = {}) {
        const aliases = {
            sequence_assembly: 'sequence'
        };

        const aggregated = {};

        Object.entries(byType).forEach(([rawType, data]) => {
            const canonical = aliases[rawType] || rawType;
            const attempts = data?.attempts || 0;
            const successRate = data?.success_rate || 0;
            const averageScore = data?.average_score || 0;

            if (!aggregated[canonical]) {
                aggregated[canonical] = { attempts: 0, successSum: 0, scoreSum: 0 };
            }

            aggregated[canonical].attempts += attempts;
            aggregated[canonical].successSum += successRate * attempts;
            aggregated[canonical].scoreSum += averageScore * attempts;
        });

        return Object.fromEntries(
            Object.entries(aggregated).map(([type, info]) => {
                const attempts = info.attempts;
                const success_rate = attempts > 0 ? info.successSum / attempts : 0;
                const average_score = attempts > 0 ? info.scoreSum / attempts : 0;
                return [type, { attempts, success_rate, average_score }];
            })
        );
    },

    formatSessionDate(dateStr) {
        if (!dateStr) return '—';
        const date = new Date(dateStr);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return `Сегодня, ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        } else if (diffDays === 1) {
            return `Вчера, ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        } else {
            const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
            return `${date.getDate()} ${months[date.getMonth()]}`;
        }
    },

    renderComplexes() {
        const container = document.getElementById('complexes-grid');
        const complexStats = this.state.complexStats;
        const complexIds = Object.keys(complexStats);

        if (complexIds.length === 0) {
            container.innerHTML = `
                <div class="col-span-2 bg-surface-1 rounded-xl p-4 shadow-sm border border-border-subtle flex flex-col items-center justify-center text-center hover:shadow-lg hover:-translate-y-0.5 transition-all tooltip-parent" data-tooltip="Карточки комплексов появятся после первых сессий">
                    <span class="material-symbols-outlined text-text-muted text-2xl mb-2">folder_open</span>
                    <p class="text-xs text-text-muted">Нет данных о комплексах</p>
                </div>
            `;
            return;
        }

        const names = this.state.complexNames || {};

        // Sort by most recent session end_time, take top 2
        const recentComplexes = complexIds
            .map(id => {
                const sessions = complexStats[id].recent_sessions || [];
                const lastSession = sessions[0] || null;
                const lastEndTime = lastSession?.end_time || null;
                const aggregated = complexStats[id].aggregated || {};
                return {
                    id,
                    name: names[id] || `Комплекс ${id.slice(0, 8)}`,
                    lastEndTime,
                    attempts: aggregated.attempts || 0,
                    successRate: aggregated.success_rate || 0,
                    sessionCount: sessions.length
                };
            })
            .filter(c => c.lastEndTime !== null)
            .sort((a, b) => (b.lastEndTime > a.lastEndTime ? 1 : -1))
            .slice(0, 2);

        if (recentComplexes.length === 0) {
            container.innerHTML = `
                <div class="col-span-2 bg-surface-1 rounded-xl p-4 shadow-sm border border-border-subtle flex flex-col items-center justify-center text-center hover:shadow-lg hover:-translate-y-0.5 transition-all tooltip-parent" data-tooltip="Карточки комплексов появятся после первых сессий">
                    <span class="material-symbols-outlined text-text-muted text-2xl mb-2">folder_open</span>
                    <p class="text-xs text-text-muted">Нет данных о комплексах</p>
                </div>
            `;
            return;
        }

        container.innerHTML = recentComplexes.map((complex) => {
            const rate = Math.round(complex.successRate * 100);
            const dateLabel = this.formatSessionDate(complex.lastEndTime);
            const tooltip = `Попыток: ${complex.attempts} · Успешность: ${rate}%`;

            return `
                <div class="bg-surface-1 rounded-xl p-4 shadow-sm border border-border-subtle flex flex-col justify-between hover:shadow-lg hover:-translate-y-0.5 transition-all tooltip-parent" data-tooltip="${tooltip}">
                    <div>
                        <h4 class="font-bold text-sm text-text-main truncate leading-tight" title="${complex.name}">${complex.name}</h4>
                        <p class="text-[10px] text-text-muted mt-0.5">${dateLabel}</p>
                    </div>
                    <div>
                        <div class="flex justify-between text-[10px] font-bold mb-1 text-text-main">
                            <span>Успешность</span>
                            <span class="${rate >= 80 ? 'text-success' : rate >= 50 ? 'text-warning-dark' : 'text-error-dark'}">${rate}%</span>
                        </div>
                        <div class="h-1.5 w-full bg-bg-secondary rounded-full overflow-hidden">
                            <div class="h-full ${rate >= 80 ? 'bg-success' : rate >= 50 ? 'bg-warning' : 'bg-error'} rounded-full transition-all duration-500" style="width: ${rate}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    updateEmptyState() {
        const rightColumn = document.getElementById('right-column');
        const chartHeader = document.getElementById('chart-header');

        // Check if we have ANY data at all for the right column (Performance & Complexes)
        // We use state.stats which usually contains overall metrics and complex stats
        const hasOverallStats = !!(this.state.stats && ((this.state.stats.total_tasks_attempted || 0) > 0 || (this.state.stats.total_time_spent || 0) > 0));
        const hasComplexData = Object.keys(this.state.complexStats || {}).length > 0;

        const rightColumnHasData = hasOverallStats || hasComplexData;
        const dynamicsHasData = (this.state.dynamics?.length || 0) > 0;

        if (!rightColumnHasData) {
            if (rightColumn) rightColumn.classList.add('opacity-60', 'grayscale-[0.8]', 'select-none', 'pointer-events-none');
        } else {
            if (rightColumn) rightColumn.classList.remove('opacity-60', 'grayscale-[0.8]', 'select-none', 'pointer-events-none');
        }

        if (!dynamicsHasData) {
            if (chartHeader) chartHeader.classList.add('opacity-40', 'pointer-events-none', 'select-none');
        } else {
            if (chartHeader) chartHeader.classList.remove('opacity-40', 'pointer-events-none', 'select-none');
        }
    }
};

const shouldAutoInit = !(typeof window !== 'undefined' && window.__STATISTICS_APP_AUTO_INIT_DISABLED__);
if (shouldAutoInit) {
    document.addEventListener('DOMContentLoaded', () => StatisticsApp.init());
}

if (typeof window !== 'undefined') {
    window.StatisticsApp = StatisticsApp;
    // Profile modal functions provided by SharedProfileModal.js
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StatisticsApp, createInitialState };
}
