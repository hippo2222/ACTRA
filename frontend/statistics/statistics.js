/**
 * Statistics Page - API Integration and UI Logic
 * Phase 1 MVP: Basic statistics display with dynamic Empty/Main state switching
 */

const createInitialState = () => ({
    stats: null,
    dynamics: [],
    previousDynamics: [],
    complexStats: {},
    complexList: [],
    theoryCatalog: [],
    theoryInsights: [],
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
            title: 'Учебная активность',
            shortLabel: 'Активность',
            legendPrimary: 'Все действия',
            legendTrend: 'Средний темп',
            aggregator: 'sum',
            valueType: 'count',
            // M8: combined activity (tasks + microcards)
            accessor: (day) => (day.activity_attempts_total ?? ((day.total_attempts ?? day.attempts ?? 0) + (day.microcards_reviews ?? 0))),
            fallbackMax: 10,
            min: 0,
            activeCondition: (day) => ((day.activity_attempts_total ?? ((day.total_attempts ?? day.attempts ?? 0) + (day.microcards_reviews ?? 0))) > 0)
        },
        study: {
            id: 'study',
            title: 'Время обучения',
            shortLabel: 'Время',
            legendPrimary: 'Минуты обучения',
            legendTrend: 'Средний темп',
            aggregator: 'sum',
            valueType: 'minutes',
            // M8: combined study time (tasks + microcards)
            accessor: (day) => day.combined_study_minutes ?? day.study_minutes ?? 0,
            fallbackMax: 60,
            min: 0,
            activeCondition: (day) => (day.combined_study_minutes ?? day.study_minutes ?? 0) > 0
        }
    },

    resetState(overrides = {}) {
        this.state = { ...createInitialState(), ...overrides };
        return this.state;
    },

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    },

    compactUiLabel(value, maxLength = 56) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        if (text.length <= maxLength) return text;

        const separatorCount = (text.match(/[_:/-]/g) || []).length;
        const looksMachineLike = separatorCount >= 4 || /\b(session|complex|iteration|task)\b/i.test(text);
        if (!looksMachineLike) return text;

        const head = Math.max(18, Math.floor(maxLength * 0.62));
        const tail = Math.max(10, maxLength - head - 1);
        return `${text.slice(0, head)}…${text.slice(-tail)}`;
    },

    showToast(message, type = 'error', duration = 2200) {
        const palette = {
            success: 'bg-success text-white',
            error: 'bg-error text-white',
            warning: 'bg-warning text-warning-dark',
            info: 'bg-info text-white',
        };
        const toast = document.createElement('div');
        toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${palette[type] || palette.info} transition-all opacity-0 translate-y-2`;
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.transition = 'opacity 200ms, transform 200ms';
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(8px)';
            setTimeout(() => toast.remove(), 250);
        }, Math.max(1200, duration));
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
                const hasActivity = (existing.activity_attempts_total || 0) > 0 || (existing.attempts || 0) > 0 || (existing.study_minutes || 0) > 0 || (existing.microcards_reviews || 0) > 0 || (existing.combined_study_minutes || 0) > 0;
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
        selector.classList.add('segmented-control');
        selector.querySelectorAll('.chart-toggle-btn').forEach(btn => {
            const isActive = btn.dataset.metric === this.state.currentMetric;
            btn.classList.add('segmented-control__button');
            btn.classList.toggle('active', isActive);
            btn.classList.toggle('is-active', isActive);
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
            // M8: для метрики attempts (комбинированная активность)
            const totalActions = Math.round(totalValue);

            if (totalActions === 0) {
                message = 'Начни заниматься, чтобы увидеть прогресс';
            } else if (activeDays === 0) {
                message = `${totalActions} действий — нет активных дней`;
            } else if (totalActions < attemptsThreshold) {
                message = `${totalActions} действий за ${activeDays} дн. — попробуй заниматься чаще`;
            } else if (activeRatio <= 0.3) {
                message = `${totalActions} действий за ${activeDays} дн. — хорошее начало, занимайся регулярнее`;
            } else if (totalActions >= attemptsThreshold * 1.5 && activeRatio >= 0.7) {
                message = `${totalActions} действий за ${activeDays} дн. — отличный результат! 🔥`;
            } else if (activeDays === period) {
                message = `${totalActions} действий за ${activeDays} дн. — ты занимаешься каждый день! 🔥`;
            } else if (activeDays >= period * 0.7) {
                message = `${totalActions} действий за ${activeDays} дн. — отличная активность!`;
            } else if (activeDays > 0) {
                message = `${totalActions} действий за ${activeDays} дн.`;
            } else {
                message = `${totalActions} действий`;
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
        this.initGlobalTooltip();
        this.bindEvents();
        await this.loadUserProfile();
        await this.loadData();
        console.log('[Statistics] Init complete. State:', JSON.stringify(this.state, null, 2));
    },

    initGlobalTooltip() {
        const el = document.createElement('div');
        el.id = 'stats-global-tooltip';
        el.style.cssText = [
            'position:fixed',
            'z-index:9999',
            'pointer-events:none',
            'opacity:0',
            'transition:opacity 0.15s ease',
            'background:rgba(15,23,42,0.92)',
            'color:#fff',
            'font-family:inherit',
            'font-size:12px',
            'line-height:1.4',
            'font-weight:450',
            'padding:5px 10px',
            'border-radius:7px',
            'max-width:240px',
            'text-align:center',
            'white-space:normal',
            'box-shadow:0 4px 16px rgba(0,0,0,0.18)',
        ].join(';');
        document.body.appendChild(el);
        this._globalTooltipEl = el;

        const show = (target) => {
            const text = target.getAttribute('data-tooltip');
            if (!text) return;
            el.textContent = text;
            el.style.opacity = '1';
            this._tooltipTarget = target;
            this._positionGlobalTooltip(target);
        };
        const hide = () => {
            el.style.opacity = '0';
            this._tooltipTarget = null;
        };

        document.addEventListener('mouseover', (e) => {
            const t = e.target.closest('[data-tooltip]');
            if (t) show(t);
        });
        document.addEventListener('mouseout', (e) => {
            const t = e.target.closest('[data-tooltip]');
            if (t && !t.contains(e.relatedTarget)) hide();
        });
        document.addEventListener('mousemove', () => {
            if (this._tooltipTarget) this._positionGlobalTooltip(this._tooltipTarget);
        }, { passive: true });
    },

    _positionGlobalTooltip(target) {
        const el = this._globalTooltipEl;
        if (!el) return;
        const r = target.getBoundingClientRect();
        const tipW = el.offsetWidth || 200;
        const tipH = el.offsetHeight || 30;
        const pad = 8;
        let x = r.left + r.width / 2 - tipW / 2;
        let y = r.top - tipH - 8;
        x = Math.max(pad, Math.min(x, window.innerWidth - tipW - pad));
        if (y < pad) y = r.bottom + 8;
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
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
                this.state.currentUser = null;
                console.warn('[Statistics] No user found in response');
                this.updateUserDisplay();
            }
        } catch (error) {
            this.state.currentUser = null;
            console.error('[Statistics] Failed to load user profile:', error);
            this.updateUserDisplay();
            this.showToast('Не удалось загрузить профиль. Продолжаем без данных профиля.', 'warning');
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

        // Update streak badge — use canonical activity_streak_days (mixed activity)
        if (!user) {
            if (avatarEl) {
                avatarEl.src = this.getAvatarUrl(null, null);
            }
            if (nameEl) {
                nameEl.textContent = 'Гость';
            }
        }

        if (streakBadge) {
            const streak = this.state.stats?.activity_streak_days || this.state.stats?.streak_days || 0;
            const streakGap = this.state.stats?.streak_gap || 0;
            const flameOpacity = streakGap === 1 ? 0.4 : 1;
            const hideFlame = streakGap > 1;
            if (streak > 0) {
                streakBadge.className = hideFlame ? 'pill-neutral pill-sm' : 'pill-warning pill-sm';
                streakBadge.innerHTML = `
                    <span class="material-symbols-outlined ${hideFlame ? 'opacity-0' : ''} text-sm" style="opacity:${flameOpacity};">local_fire_department</span>
                    <span class="text-sm font-bold">${streak}</span>
                `;
                streakBadge.classList.remove('hidden');
            } else {
                streakBadge.className = 'pill-neutral pill-sm hidden';
                streakBadge.innerHTML = '';
                streakBadge.classList.add('hidden');
            }
        }
    },

    bindEvents() {
        document.querySelectorAll('.period-btn').forEach(btn => {
            const isActive = parseInt(btn.dataset.period) === this.state.currentPeriod;
            btn.className = `period-btn segmented-control__button transition-all${isActive ? ' active is-active' : ''}`;
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            btn.addEventListener('click', (e) => {
                const period = parseInt(e.currentTarget.dataset.period);
                this.switchPeriod(period);
            });
        });

        const metricSelector = document.getElementById('chart-metric-selector');
        if (metricSelector) {
            metricSelector.classList.add('segmented-control');
            metricSelector.querySelectorAll('.chart-toggle-btn').forEach(btn => {
                btn.classList.add('segmented-control__button');
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
            periodSwitch.classList.add('segmented-control');
            periodSwitch.addEventListener('mouseenter', () => {
                this.hideChartTooltip();
                this.clearFocus('chart');
            });
        }
    },

    async loadData() {
        this.showSkeleton();
        let hadPartialLoadError = false;
        try {
            const period = this.state.currentPeriod;
            const statsUrl = this.buildApiUrl('/api/statistics/overall');
            const dynamicsUrl = this.buildApiUrl(`/api/statistics/time-dynamics?days=${period}&smooth=${this.state.smoothingWindow}`);
            const previousPeriodUrl = this.buildApiUrl(`/api/statistics/time-dynamics?days=${period}&offset=${period}&smooth=${this.state.smoothingWindow}`);
            const complexesUrl = this.buildApiUrl('/api/statistics/complexes');
            const complexesListUrl = this.buildApiUrl('/api/complexes');
            const theoriesUrl = this.buildApiUrl('/api/theories');

            const [statsRes, dynamicsRes, previousRes, complexesRes, complexesListRes, theoriesRes] = await Promise.all([
                fetch(statsUrl),
                fetch(dynamicsUrl),
                fetch(previousPeriodUrl),
                fetch(complexesUrl),
                fetch(complexesListUrl),
                fetch(theoriesUrl)
            ]);

            const statsData = await statsRes.json();
            const dynamicsData = await dynamicsRes.json();
            const previousData = await previousRes.json();
            const complexesData = await complexesRes.json();
            const complexesListData = await complexesListRes.json();
            const theoriesData = await theoriesRes.json();

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
                this.state.stats = null;
                hadPartialLoadError = true;
                console.warn('[Statistics] Stats API error:', statsData);
            }

            if (dynamicsData.ok) {
                const raw = dynamicsData.dynamics || [];
                this.state.dynamics = this.normalizeDynamics(raw, period);
                this.state.dynamicsCache[this.state.currentPeriod] = this.state.dynamics;
            } else {
                this.state.dynamics = [];
                delete this.state.dynamicsCache[this.state.currentPeriod];
                hadPartialLoadError = true;
            }

            if (previousData.ok) {
                const rawPrev = previousData.dynamics || [];
                this.state.previousDynamics = this.normalizeDynamics(rawPrev, period);
                this.state.previousDynamicsCache[this.state.currentPeriod] = this.state.previousDynamics;
            } else {
                this.state.previousDynamics = [];
                delete this.state.previousDynamicsCache[this.state.currentPeriod];
                hadPartialLoadError = true;
            }

            if (complexesData.ok && complexesData.complexes) {
                this.state.complexStats = complexesData.complexes;
            } else {
                this.state.complexStats = {};
                hadPartialLoadError = true;
            }

            // Build complex name lookup from /api/complexes
            this.state.complexNames = {};
            this.state.complexList = [];
            if (complexesListData.ok && complexesListData.items) {
                for (const c of complexesListData.items) {
                    if (c.id && c.name) this.state.complexNames[c.id] = c.name;
                }
                this.state.complexList = Array.isArray(complexesListData.items) ? complexesListData.items : [];
            } else {
                hadPartialLoadError = true;
            }
            if (theoriesRes.ok && theoriesData.ok && Array.isArray(theoriesData.items)) {
                this.state.theoryCatalog = theoriesData.items;
            } else {
                this.state.theoryCatalog = [];
                hadPartialLoadError = true;
            }
            this.state.theoryInsights = this.buildTheoryInsights();
            const mcReviews = this.state.stats?.microcards?.reviews_total || 0;
            const combinedAttempts = this.state.stats?.learning_sources?.combined?.attempts || 0;
            const statsHasData = !!(this.state.stats && ((this.state.stats.total_tasks_attempted || 0) > 0 || (this.state.stats.total_time_spent || 0) > 0 || mcReviews > 0 || combinedAttempts > 0));
            const dynamicsHasData = (this.state.dynamics?.length || 0) > 0;
            this.state.hasData = statsHasData || dynamicsHasData;

            this.hideSkeleton();
            this.render();
            this.updateUserDisplay();
            if (hadPartialLoadError) {
                this.showToast('Не удалось полностью обновить статистику. Показаны доступные данные.', 'warning');
            }
        } catch (error) {
            console.error('[Statistics] Failed to load data:', error);
            this.state.stats = null;
            this.state.hasData = false;
            this.state.dynamics = [];
            this.state.previousDynamics = [];
            delete this.state.dynamicsCache[this.state.currentPeriod];
            delete this.state.previousDynamicsCache[this.state.currentPeriod];
            this.state.complexStats = {};
            this.state.complexList = [];
            this.state.theoryCatalog = [];
            this.state.theoryInsights = [];
            this.state.complexNames = {};
            this.hideSkeleton();
            this.render();
            this.showToast('Не удалось загрузить статистику', 'error');
        }
    },

    async switchPeriod(days) {
        if (this.state.currentPeriod === days) return;

        this.state.currentPeriod = days;
        this.state.focusedDay = null;
        this.state.focusSource = null;
        let hadPeriodLoadError = false;

        document.querySelectorAll('.period-btn').forEach(btn => {
            const isActive = parseInt(btn.dataset.period) === days;
            btn.className = `period-btn segmented-control__button transition-all${isActive ? ' active is-active' : ''}`;
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        const loadCurrent = this.state.dynamicsCache[days]
            ? Promise.resolve({ ok: true, dynamics: this.state.dynamicsCache[days], fromCache: true })
            : fetch(this.buildApiUrl(`/api/statistics/time-dynamics?days=${days}&smooth=${this.state.smoothingWindow}`))
                .then(async (res) => {
                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                        hadPeriodLoadError = true;
                        return { ok: false, dynamics: [], fromCache: false };
                    }
                    return { ok: true, dynamics: data.dynamics || [], fromCache: false };
                })
                .catch((error) => {
                    console.error('[Statistics] Failed to load dynamics:', error);
                    hadPeriodLoadError = true;
                    return { ok: false, dynamics: [], fromCache: false };
                });

        const loadPrevious = this.state.previousDynamicsCache[days]
            ? Promise.resolve({ ok: true, dynamics: this.state.previousDynamicsCache[days], fromCache: true })
            : fetch(this.buildApiUrl(`/api/statistics/time-dynamics?days=${days}&offset=${days}&smooth=${this.state.smoothingWindow}`))
                .then(async (res) => {
                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                        hadPeriodLoadError = true;
                        return { ok: false, dynamics: [], fromCache: false };
                    }
                    return { ok: true, dynamics: data.dynamics || [], fromCache: false };
                })
                .catch((error) => {
                    console.error('[Statistics] Failed to load previous dynamics:', error);
                    hadPeriodLoadError = true;
                    return { ok: false, dynamics: [], fromCache: false };
                });

        const [currentResult, previousResult] = await Promise.all([loadCurrent, loadPrevious]);
        this.state.dynamics = this.normalizeDynamics(currentResult.dynamics, days);
        this.state.previousDynamics = this.normalizeDynamics(previousResult.dynamics, days);

        if (currentResult.ok) {
            this.state.dynamicsCache[days] = this.state.dynamics;
        } else {
            delete this.state.dynamicsCache[days];
        }

        if (previousResult.ok) {
            this.state.previousDynamicsCache[days] = this.state.previousDynamics;
        } else {
            delete this.state.previousDynamicsCache[days];
        }
        const mcReviews = this.state.stats?.microcards?.reviews_total || 0;
        const combinedAttempts = this.state.stats?.learning_sources?.combined?.attempts || 0;
        const statsHasData = !!(this.state.stats && ((this.state.stats.total_tasks_attempted || 0) > 0 || (this.state.stats.total_time_spent || 0) > 0 || mcReviews > 0 || combinedAttempts > 0));
        const dynamicsHasData = (this.state.dynamics?.length || 0) > 0;
        this.state.hasData = statsHasData || dynamicsHasData;

        if (hadPeriodLoadError) {
            this.showToast('Не удалось полностью обновить график. Показаны доступные данные.', 'warning');
        }

        this.render();
    },

    buildTheoryInsights() {
        const theoryTitleById = {};
        (Array.isArray(this.state.theoryCatalog) ? this.state.theoryCatalog : []).forEach((item) => {
            const theoryId = String(item?.id || '').trim();
            if (!theoryId) return;
            theoryTitleById[theoryId] = String(item?.title || theoryId).trim() || theoryId;
        });

        const grouped = new Map();
        (Array.isArray(this.state.complexList) ? this.state.complexList : []).forEach((complex) => {
            const complexId = String(complex?.id || '').trim();
            const theoryId = String(complex?.theory_link?.theory_id || '').trim();
            if (!complexId || !theoryId) return;

            const statEntry = this.state.complexStats?.[complexId] || {};
            const aggregated = statEntry.aggregated || {};
            const attempts = Number(aggregated.attempts || 0);
            const successRate = Number(aggregated.success_rate || 0);
            const recentSessions = Array.isArray(statEntry.recent_sessions) ? statEntry.recent_sessions : [];
            const latestEndTime = recentSessions[0]?.end_time || null;

            if (!grouped.has(theoryId)) {
                grouped.set(theoryId, {
                    theoryId,
                    title: theoryTitleById[theoryId] || theoryId,
                    complexCount: 0,
                    attempts: 0,
                    successSum: 0,
                    successWeight: 0,
                    latestEndTime: null,
                });
            }

            const row = grouped.get(theoryId);
            row.complexCount += 1;
            row.attempts += attempts;
            row.successSum += successRate * attempts;
            row.successWeight += attempts;
            if (latestEndTime && (!row.latestEndTime || latestEndTime > row.latestEndTime)) {
                row.latestEndTime = latestEndTime;
            }
        });

        const result = Array.from(grouped.values())
            .map((row) => ({
                ...row,
                successRate: row.successWeight > 0 ? row.successSum / row.successWeight : 0,
            }))
            .sort((left, right) => {
                if (right.attempts !== left.attempts) return right.attempts - left.attempts;
                if (right.complexCount !== left.complexCount) return right.complexCount - left.complexCount;
                return (left.title || left.theoryId).localeCompare(right.title || right.theoryId, 'ru');
            });

        // Show items with >0 attempts, but if none exist, show at least the recent/available ones
        const withAttempts = result.filter(r => r.attempts > 0);
        return withAttempts.length > 0 ? withAttempts.slice(0, 3) : result.slice(0, 3);
    },

    renderTheoryInsights() {
        const container = document.getElementById('theory-analytics-list');
        if (!container) return;

        let insights = Array.isArray(this.state.theoryInsights) ? this.state.theoryInsights.slice(0, 3) : [];

        // Fallback: если theory_link не заполнен — строим из complexStats напрямую
        if (!insights.length) {
            const names = this.state.complexNames || {};
            const complexStats = this.state.complexStats || {};
            const fallbackResult = Object.keys(complexStats)
                .map(id => {
                    const agg = complexStats[id].aggregated || {};
                    const sessions = complexStats[id].recent_sessions || [];
                    return {
                        theoryId: id,
                        title: names[id] || id,
                        complexCount: 1,
                        attempts: agg.attempts || 0,
                        successRate: agg.success_rate || 0,
                        latestEndTime: sessions[0]?.end_time || null,
                    };
                })
                .sort((a, b) => b.attempts - a.attempts);

            const fallbackWithAttempts = fallbackResult.filter(x => x.attempts > 0);
            insights = (fallbackWithAttempts.length > 0 ? fallbackWithAttempts : fallbackResult).slice(0, 3);
        }

        if (!insights.length) {
            container.innerHTML = '<p class="stats-empty-copy text-sm">Теоретические связи появятся после первых сессий.</p>';
            return;
        }

        container.innerHTML = insights.map((item) => {
            const successRate = Math.max(0, Math.min(100, Math.round((item.successRate || 0) * 100)));
            const toneClass = successRate >= 80 ? 'bg-success' : (successRate >= 50 ? 'bg-warning' : 'bg-error');
            const latestLabel = item.latestEndTime ? this.escapeHtml(this.formatFullDate(item.latestEndTime)) : '—';
            const safeTitle = this.escapeHtml(item.title || item.theoryId);
            return `
                <div class="stats-theory-card card-elevated rounded-xl border border-border-subtle bg-bg-secondary p-3">
                    <div class="flex items-start justify-between gap-2">
                        <p class="stats-theory-title text-sm font-bold text-text-main min-w-0" title="${safeTitle}">${safeTitle}</p>
                        <span class="rounded-full border border-border-subtle px-2 py-1 text-[10px] font-semibold text-text-secondary flex-shrink-0">${item.complexCount} компл.</span>
                    </div>
                    <div class="stats-theory-meta mt-2 flex items-center justify-between gap-3 text-[11px]">
                        <span>${item.attempts} попыток</span>
                        <span>${latestLabel}</span>
                    </div>
                    <div class="mt-2 h-1.5 w-full rounded-full bg-surface-1 overflow-hidden">
                        <div class="h-full ${toneClass} rounded-full transition-all duration-500" style="width:${successRate}%"></div>
                    </div>
                    <div class="mt-1 flex items-center justify-between text-[11px]">
                        <span class="text-text-secondary">Успех по теории</span>
                        <span class="font-semibold text-text-main">${successRate}%</span>
                    </div>
                </div>
            `;
        }).join('');
    },

    render() {
        this.renderMetrics();
        this.updateMetricToggle();
        this.updateLegendLabels();
        this.updateChartTitle();
        this.updateChartSummary();
        this.updateChartInsight(this.state.dynamics);
        this.renderChart();
        this.renderPerformance();
        this.renderTheoryInsights();
        this.renderComplexes();
        this.updateEmptyState();
    },

    renderMetrics() {
        const stats = this.state.stats || {};
        const mcStats = stats.microcards || {};
        const learningSources = stats.learning_sources || {};
        const mcReviewsTotal = mcStats.reviews_total || 0;
        const hasTasksData = (stats.total_tasks_attempted || 0) > 0 || (stats.total_time_spent || 0) > 0;
        const hasMcData = mcReviewsTotal > 0;
        const hasStatsData = hasTasksData || hasMcData;
        const combinedTimeSec = learningSources.combined?.time_spent_seconds || stats.total_time_spent || 0;
        const hasTimeData = combinedTimeSec > 0;
        const hasStreakData = (stats.activity_streak_days || stats.streak_days || 0) > 0
            || (stats.activity_streak_best || stats.streak_best || 0) > 0
            || hasStatsData;

        console.log('[Statistics] renderMetrics - stats:', stats, 'hasStatsData:', hasStatsData, 'hasTimeData:', hasTimeData);

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

        // Tasks mastered (task-centric, stays as-is per spec)
        const tasksMastered = stats.tasks_mastered ?? 0;
        const totalTasks = stats.total_tasks_available || 0;
        document.getElementById('tasks-mastered').textContent = tasksMastered;
        document.getElementById('tasks-total').textContent = `/ ${totalTasks}`;

        // Time: combined (tasks + microcards) via learning_sources
        const hours = Math.floor(combinedTimeSec / 3600);
        const minutes = Math.floor((combinedTimeSec % 3600) / 60);
        document.getElementById('time-hours').textContent = hours;
        document.getElementById('time-minutes').textContent = String(minutes).padStart(2, '0');

        // Time source hint (show breakdown if both sources have data)
        const timeHint = document.getElementById('time-source-hint');
        if (timeHint) {
            const taskTimeSec = learningSources.tasks?.time_spent_seconds || stats.total_time_spent || 0;
            const mcTimeSec = learningSources.microcards?.time_spent_seconds || 0;
            if (hasTimeData && taskTimeSec > 0 && mcTimeSec > 0) {
                const taskMin = Math.round(taskTimeSec / 60);
                const mcMin = Math.round(mcTimeSec / 60);
                timeHint.textContent = `(${taskMin} + ${mcMin} мин)`;
            } else {
                timeHint.textContent = '';
            }
        }

        // Streak: canonical activity_streak (mixed activity)
        const streakDays = stats.activity_streak_days || stats.streak_days || 0;
        const streakBest = stats.activity_streak_best || stats.streak_best || 0;
        document.getElementById('streak-days').textContent = streakDays;
        const bestEl = document.getElementById('streak-best');
        if (bestEl) bestEl.textContent = streakBest;

        // Microcards card
        const mcReviewsEl = document.getElementById('microcards-reviews-count');
        const mcRateEl = document.getElementById('microcards-correct-rate');
        const mcBadge = document.getElementById('microcards-correct-badge');
        if (mcReviewsEl) mcReviewsEl.textContent = mcReviewsTotal;
        if (mcRateEl) {
            const rate = mcStats.correct_rate || 0;
            mcRateEl.textContent = mcReviewsTotal > 0 ? `${Math.round(rate * 100)}%` : '';
        }
        if (mcBadge) {
            if (hasMcData) {
                const rate = mcStats.correct_rate || 0;
                const pct = Math.round(rate * 100);
                mcBadge.textContent = `${mcStats.decks_active || 0} колод`;
                mcBadge.classList.remove('hidden');
                mcBadge.className = `pill-sm ${pct >= 80 ? 'pill-success' : pct >= 50 ? 'pill-warning' : 'pill-danger'}`;
            } else {
                mcBadge.classList.add('hidden');
            }
        }

        // Toggle empty states per card
        toggleMetricEmpty('metric-tasks-value', 'metric-tasks-empty', hasTasksData);
        toggleMetricEmpty('metric-time-value', 'metric-time-empty', hasTimeData);
        toggleMetricEmpty('metric-microcards-value', 'metric-microcards-empty', hasMcData);
        toggleMetricEmpty('metric-streak-value', 'metric-streak-empty', hasStreakData);

        ['metric-tasks', 'metric-time', 'metric-microcards', 'metric-streak'].forEach((id) => {
            const card = document.getElementById(id);
            if (!card) return;
            const isEmpty = (id === 'metric-tasks') ? !hasTasksData
                : (id === 'metric-time') ? !hasTimeData
                : (id === 'metric-microcards') ? !hasMcData
                : !hasStreakData;
            card.classList.toggle('metric-card--empty', isEmpty);
        });

        this.updateMetricStyles(hasTasksData, hasTimeData, hasMcData, hasStreakData);
    },

    updateMetricStyles(hasTasksData, hasTimeData, hasMcData, hasStreakData) {
        const metricConfigs = [
            { iconId: 'metric-tasks-icon', color: 'info', active: hasTasksData },
            { iconId: 'metric-time-icon', color: 'secondary', active: hasTimeData },
            { iconId: 'metric-microcards-icon', color: 'success', active: hasMcData },
            { iconId: 'metric-streak-icon', color: 'accent', active: hasStreakData }
        ];

        metricConfigs.forEach(config => {
            const iconEl = document.getElementById(config.iconId);
            if (!iconEl) return;
            if (config.active) {
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
        const insightEl = document.getElementById('chart-insight');
        if (!insightEl) return;

        const series = Array.isArray(dynamics) ? dynamics : [];
        if (!series.length) {
            insightEl.textContent = '';
            insightEl.classList.add('hidden');
            return;
        }

        const metricId = this.state.currentMetric;
        const metricLabel = metricId === 'study' ? 'времени' : 'активности';
        const activeDays = series.filter((day) => this.getMetricValue(day, metricId) > 0).length;
        const period = this.state.currentPeriod || series.length;
        const delta = this.calculatePeriodDelta();
        let text = '';

        if (!delta.hasPrevious) {
            text = activeDays > 0
                ? `Это первый ${period}-дневный срез: смотри в первую очередь на регулярность, а не только на сумму.`
                : 'Как только появится активность, здесь будет подсказка по текущему ритму.';
        } else {
            const deltaPercent = Math.round(Math.abs(delta.deltaPercent || 0));
            if (delta.direction === 'up') {
                text = deltaPercent > 0
                    ? `${metricLabel[0].toUpperCase()}${metricLabel.slice(1)} стало больше на ${deltaPercent}% относительно прошлого периода. Удерживай текущий темп.`
                    : 'Темп выше прошлого периода. Продолжай в том же ритме.';
            } else if (delta.direction === 'down') {
                text = deltaPercent > 0
                    ? `${metricLabel[0].toUpperCase()}${metricLabel.slice(1)} стало меньше на ${deltaPercent}% относительно прошлого периода. Верни хотя бы одну короткую сессию в день.`
                    : 'Темп просел относительно прошлого периода. Верни короткую ежедневную практику.';
            } else if (activeDays <= Math.max(1, Math.floor(period * 0.4))) {
                text = `Ритм ровный, но активных дней только ${activeDays} из ${period}. Добавь ещё 1-2 короткие сессии в неделю.`;
            } else {
                text = `Ритм стабильный: ${activeDays} активных дней из ${period}. Теперь важнее держать регулярность, чем гнаться за пиком.`;
            }
        }

        insightEl.textContent = text;
        insightEl.classList.toggle('hidden', !text);
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

    // M8: mixed tooltip with microcards breakdown
    buildTooltipHtml(day) {
        const attempts = day.attempts ?? 0;
        const totalAttempts = day.total_attempts ?? attempts;
        const taskStudy = day.study_minutes ?? 0;
        const mcReviews = day.microcards_reviews ?? 0;
        const mcStudy = day.microcards_study_minutes ?? 0;
        const combinedStudy = day.combined_study_minutes ?? (taskStudy + mcStudy);
        const activityTotal = day.activity_attempts_total ?? (totalAttempts + mcReviews);
        const labelInfo = this.getDayLabelInfo(day.date);

        let html = `<div class="chart-tooltip-date">${this.formatFullDate(day.date)}${labelInfo.isToday ? ' \u00b7 \u0421\u0435\u0433\u043e\u0434\u043d\u044f' : ''}</div>`;

        if (totalAttempts > 0 || mcReviews > 0) {
            html += `<div class="chart-tooltip-row"><span>\u0412\u0441\u0435\u0433\u043e \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439:</span><span>${activityTotal}</span></div>`;
        }
        if (totalAttempts > 0) {
            html += `<div class="chart-tooltip-row"><span>\u0417\u0430\u0434\u0430\u0447\u0438:</span><span>${attempts} \u0443\u043d\u0438\u043a. / ${totalAttempts} \u043f\u043e\u043f.</span></div>`;
        }
        if (mcReviews > 0) {
            const mcRate = day.microcards_correct_rate ?? 0;
            const ratePct = Math.round(mcRate * 100);
            html += `<div class="chart-tooltip-row"><span>\u041a\u0430\u0440\u0442\u043e\u0447\u043a\u0438:</span><span>${mcReviews} (${ratePct}%)</span></div>`;
        }
        html += `<div class="chart-tooltip-row"><span>\u0412\u0440\u0435\u043c\u044f:</span><span>${combinedStudy} \u043c\u0438\u043d</span></div>`;

        return html;
    },

    updateChartLayoutState(hasData) {
        const chartCard = document.getElementById('chart-card');
        const chartContent = document.getElementById('chart-content');
        const emptyChart = document.getElementById('empty-chart');
        const summary = document.getElementById('chart-summary');

        if (hasData) {
            if (chartCard) chartCard.classList.remove('stats-chart-card--empty');
            if (chartContent) chartContent.classList.remove('hidden');
            if (emptyChart) emptyChart.classList.add('hidden');
            if (summary) summary.classList.remove('hidden');
        } else {
            if (chartCard) chartCard.classList.add('stats-chart-card--empty');
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

        // M8: Also render microcards performance section
        this.renderMicrocardsPerformance();

        if (!hasAnyAttempts) {
            container.innerHTML = '<p class="stats-empty-copy text-sm text-center py-3">Пока нет данных по типам задач. Пройдите несколько заданий, чтобы увидеть статистику.</p>';
            return;
        }

        const rows = types.map(type => {
            const config = typeConfig[type] || { name: formatLabel(type), color: 'slate' };
            const data = byType[type] || { attempts: 0, average_score: 0 };
            const hasTypeData = data.attempts > 0;
            if (!hasTypeData) return null; // Filter out inactive types

            const rate = Math.round(data.average_score);
            const safeName = this.escapeHtml(config.name);

            return `
                <div class="stats-performance-row">
                    <div class="stats-row-top text-sm">
                        <span class="stats-row-label text-text-main">${safeName}</span>
                        <span class="stats-row-value text-text-main">${rate}%</span>
                    </div>
                    <div class="h-1.5 w-full bg-bg-secondary rounded-full overflow-hidden">
                        <div class="h-full bg-primary rounded-full transition-all duration-1000" style="width:${rate}%"></div>
                    </div>
                </div>
            `;
        }).filter(Boolean);

        if (rows.length === 0) {
            container.innerHTML = '<p class="stats-empty-copy text-sm text-center py-3">Пока нет данных по типам задач.</p>';
            return;
        }

        container.innerHTML = rows.join('');
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
                <div class="col-span-2 stats-complex-card bg-surface-1 rounded-xl p-4 shadow-sm border border-border-subtle flex flex-col items-center justify-center text-center hover:shadow-lg hover:-translate-y-0.5 transition-all tooltip-parent" data-tooltip="Карточки комплексов появятся после первых сессий">
                    <span class="material-symbols-outlined text-text-secondary text-2xl mb-2">folder_open</span>
                    <p class="stats-empty-copy text-xs">Нет данных о комплексах</p>
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
            .slice(0, 12);

        if (recentComplexes.length === 0) {
            container.innerHTML = `
                <div class="col-span-2 stats-complex-card bg-surface-1 rounded-xl p-4 shadow-sm border border-border-subtle flex flex-col items-center justify-center text-center hover:shadow-lg hover:-translate-y-0.5 transition-all tooltip-parent" data-tooltip="Карточки комплексов появятся после первых сессий">
                    <span class="material-symbols-outlined text-text-secondary text-2xl mb-2">folder_open</span>
                    <p class="stats-empty-copy text-xs">Нет данных о комплексах</p>
                </div>
            `;
            return;
        }

        const cards = recentComplexes.map((complex) => {
            const rate = Math.round(complex.successRate * 100);
            const dateLabel = this.formatSessionDate(complex.lastEndTime);
            const safeName = this.escapeHtml(this.compactUiLabel(complex.name, 60));
            const safeFullName = this.escapeHtml(complex.name);
            const safeDateLabel = this.escapeHtml(dateLabel);
            const rateColor = rate >= 80 ? 'text-success' : rate >= 50 ? 'text-warning-dark' : 'text-error-dark';
            const barColor = rate >= 80 ? 'bg-success' : rate >= 50 ? 'bg-warning' : 'bg-error';

            return `
                <div class="stats-complex-card-compact card-elevated bg-surface-1 rounded-xl border border-border-subtle transition-all flex-shrink-0">
                    <div class="flex items-center justify-between gap-2 mb-1.5">
                        <h4 class="stats-complex-title font-bold text-xs text-text-main leading-tight flex-1 min-w-0" title="${safeFullName}">${safeName}</h4>
                        <span class="text-[10px] font-bold flex-shrink-0 ${rateColor}">${rate}%</span>
                    </div>
                      <div class="stats-complex-meta-row mb-2">
                          <span class="text-[10px] text-text-secondary">${safeDateLabel}</span>
                          <span class="text-[10px] text-text-muted">${complex.attempts} попыток</span>
                      </div>
                    <div class="h-1 w-full bg-bg-secondary rounded-full overflow-hidden">
                        <div class="h-full ${barColor} rounded-full" style="width:${rate}%"></div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = cards.join('');
        this._initComplexesCarousel(recentComplexes.length);
    },

    _initComplexesCarousel(total) {
        const nav     = document.getElementById('complexes-nav');
        const prevBtn = document.getElementById('complexes-prev');
        const nextBtn = document.getElementById('complexes-next');
        const counter = document.getElementById('complexes-counter');
        const grid    = document.getElementById('complexes-grid');
        if (!grid) return;

        if (this._carouselCleanup) this._carouselCleanup();

        const PER_PAGE = 4; // 2×2 карточки на страницу
        const totalPages = Math.ceil(total / PER_PAGE);
        let page = 0;
        let autoTimer = null;

        const allCards = Array.from(grid.querySelectorAll('.stats-complex-card-compact'));

        const goTo = (newPage) => {
            const isFirstInit = (page === 0 && allCards.every(c => c.style.display === ''));
            const oldPage = page;
            page = ((newPage % totalPages) + totalPages) % totalPages;
            const start = page * PER_PAGE;
            const end   = start + PER_PAGE;

            allCards.forEach((card, i) => {
                const isVisible = i >= start && i < end;
                if (isVisible) {
                    card.style.display = '';
                    // Trigger animation if page changed or first init
                    if (oldPage !== page || isFirstInit) {
                        card.classList.remove('complex-card--fade-in');
                        void card.offsetWidth; // Force reflow
                        card.classList.add('complex-card--fade-in');
                    }
                } else {
                    card.style.display = 'none';
                    card.classList.remove('complex-card--fade-in');
                }
            });

            if (nav)     nav.style.display = totalPages > 1 ? 'flex' : 'none';
            if (counter) counter.textContent = (page + 1) + '/' + totalPages;
            if (prevBtn) prevBtn.disabled = page === 0;
            if (nextBtn) nextBtn.disabled = page >= totalPages - 1;
        };

        const AUTO_MS       = 30000;
        const USER_PAUSE_MS = 40000;
        const scheduleAuto  = (delay) => {
            clearTimeout(autoTimer);
            if (totalPages <= 1) return;
            autoTimer = setTimeout(() => { goTo(page + 1); scheduleAuto(); },
                delay !== undefined ? delay : AUTO_MS);
        };
        const userNav = (fn) => { fn(); scheduleAuto(USER_PAUSE_MS); };

        if (prevBtn) { prevBtn.onclick = null; prevBtn.onclick = () => userNav(() => goTo(page - 1)); }
        if (nextBtn) { nextBtn.onclick = null; nextBtn.onclick = () => userNav(() => goTo(page + 1)); }

        this._carouselCleanup = () => { clearTimeout(autoTimer); };

        goTo(0);
        scheduleAuto();
    },

    // M8: Render microcards by_card_type breakdown in performance section
    renderMicrocardsPerformance() {
        const section = document.getElementById('microcards-performance');
        const container = document.getElementById('microcards-performance-bars');
        if (!section || !container) return;

        const mcStats = this.state.stats?.microcards || {};
        const byCardType = mcStats.by_card_type || {};
        const hasMcData = (mcStats.reviews_total || 0) > 0;

        if (!hasMcData) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');

        const typeConfig = {
            fact_recall: { name: 'Вопрос-ответ', color: 'indigo', order: 1 },
            pair_match: { name: 'Сопоставление', color: 'cyan', order: 2 }
        };

        const types = Object.keys(byCardType)
            .sort((a, b) => (typeConfig[a]?.order ?? 50) - (typeConfig[b]?.order ?? 50));

        if (types.length === 0) {
            // Show overall rate if no by_card_type breakdown
            const overallRate = Math.round((mcStats.correct_rate || 0) * 100);
            container.innerHTML = `
                <div>
                    <div class="flex justify-between text-sm mb-1">
                        <span class="text-text-main font-medium">Точность</span>
                        <span class="text-text-main font-bold">${overallRate}%</span>
                    </div>
                    <div class="h-2 w-full bg-bg-secondary rounded-full overflow-hidden">
                        <div class="h-full bg-success rounded-full transition-all duration-500" style="width: ${overallRate}%"></div>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = types.map(type => {
            const config = typeConfig[type] || { name: type, color: 'slate' };
            const data = byCardType[type] || {};
            const reviews = data.reviews || 0;
            const rate = Math.round((data.correct_rate || 0) * 100);
            const perfectRate = data.perfect_rate != null ? Math.round(data.perfect_rate * 100) : null;
            const safeName = this.escapeHtml(config.name);

            let rateLabel = `${rate}%`;
            if (perfectRate != null && type === 'pair_match') {
                rateLabel += ` (ид. ${perfectRate}%)`;
            }

            return `
                <div>
                    <div class="flex justify-between text-sm mb-1">
                        <span class="${reviews > 0 ? 'text-text-main' : 'text-text-muted'} font-medium">${safeName}</span>
                        <span class="${reviews > 0 ? 'text-text-main' : 'text-text-muted'} font-bold">${reviews > 0 ? rateLabel : '—'}</span>
                    </div>
                    <div class="h-2 w-full bg-bg-secondary rounded-full overflow-hidden">
                        <div class="h-full bg-success rounded-full transition-all duration-500" style="width: ${rate}%"></div>
                    </div>
                </div>
            `;
        }).join('');

        // Ratings distribution mini-bar
        const ratings = mcStats.ratings_distribution || {};
        const totalRatings = (ratings.again || 0) + (ratings.hard || 0) + (ratings.good || 0) + (ratings.easy || 0);
        if (totalRatings > 0) {
            const pct = (key) => Math.round(((ratings[key] || 0) / totalRatings) * 100);
            container.innerHTML += `
                <div class="mt-2">
                    <div class="flex justify-between text-[10px] font-semibold text-text-secondary mb-1">
                        <span>Распределение оценок</span>
                    </div>
                    <div class="flex h-2 w-full rounded-full overflow-hidden">
                        <div class="bg-error h-full" style="width:${pct('again')}%" title="Снова: ${ratings.again || 0}"></div>
                        <div class="bg-warning h-full" style="width:${pct('hard')}%" title="Трудно: ${ratings.hard || 0}"></div>
                        <div class="bg-success h-full" style="width:${pct('good')}%" title="Хорошо: ${ratings.good || 0}"></div>
                        <div class="bg-info h-full" style="width:${pct('easy')}%" title="Легко: ${ratings.easy || 0}"></div>
                    </div>
                    <div class="flex justify-between text-[9px] text-text-secondary mt-0.5">
                        <span>Снова</span>
                        <span>Трудно</span>
                        <span>Хорошо</span>
                        <span>Легко</span>
                    </div>
                </div>
            `;
        }
    },

    updateEmptyState() {
        const rightColumn = document.getElementById('right-column');
        const chartHeader = document.getElementById('chart-header');

        // M8: Check mixed data for right column visibility
        const mcReviews = this.state.stats?.microcards?.reviews_total || 0;
        const hasOverallStats = !!(this.state.stats && ((this.state.stats.total_tasks_attempted || 0) > 0 || (this.state.stats.total_time_spent || 0) > 0 || mcReviews > 0));
        const hasComplexData = Object.keys(this.state.complexStats || {}).length > 0;

        const rightColumnHasData = hasOverallStats || hasComplexData;
        const dynamicsHasData = (this.state.dynamics?.length || 0) > 0;

        if (rightColumn) {
            rightColumn.classList.remove('opacity-60', 'grayscale-[0.8]', 'select-none', 'pointer-events-none');
            rightColumn.classList.toggle('stats-column-empty', !rightColumnHasData);
        }

        if (chartHeader) {
            chartHeader.classList.remove('opacity-40', 'pointer-events-none', 'select-none');
            chartHeader.classList.toggle('stats-chart-header--idle', !dynamicsHasData);
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
