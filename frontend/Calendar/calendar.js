/**
 * Calendar Module - JavaScript логика для календаря обучения.
 *
 * Модули:
 * - CalendarState - управление состоянием
 * - CalendarAPI - работа с бэкендом
 * - CalendarUI - рендеринг компонентов
 * - CalendarInteractions - обработка событий
 */

function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
    const v = window.i18n.t(key);
    return v !== key ? v : fallback;
}

// =============================================================================
// CALENDAR STATE
// =============================================================================
class CalendarState {
    constructor() {
        this.settings = {
            daily_time_limit_minutes: 30,
            schedule_mode: 'daily',
            streak_days: 0,
        };
        this.daily_plan = {
            daily_mix: [],
            daily_mix_count: 0,
            daily_mix_minutes: 0,
            main_focus_name: '',
            main_focus_count: 0,
            main_focus_minutes: 0,
            is_adapted: false,
        };
        this.health_summary = {
            overall_health: 1.0,
            complexes: [],
            critical_count: 0,
        };
        this.schedule = [];
        this.activity = [];
        this.notifications = [];
        this.listeners = [];
    }

    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    notify() {
        this.listeners.forEach(callback => callback(this));
    }

    update(partial) {
        Object.assign(this, partial);
        this.notify();
    }

    updateSettings(settings) {
        Object.assign(this.settings, settings);
        this.notify();
    }
}

// =============================================================================
// CALENDAR API
// =============================================================================
class CalendarAPI {
    constructor(baseUrl = '/api/calendar') {
        this.baseUrl = baseUrl;
    }

    async fetchTodayPlan() {
        const response = await fetch(`${this.baseUrl}/today`);
        return response.json();
    }

    async updateSettings(settings) {
        const response = await fetch(`${this.baseUrl}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
        return response.json();
    }

    async startSession(sessionType, complexId = null) {
        const response = await fetch(`${this.baseUrl}/session/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_type: sessionType, complex_id: complexId }),
        });
        return response.json();
    }

    async completeSession(sessionId, tasksCompleted, activeTimeSeconds) {
        const response = await fetch(`${this.baseUrl}/session/${sessionId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tasks_completed: tasksCompleted, active_time_seconds: activeTimeSeconds }),
        });
        return response.json();
    }

    async getHealth() {
        const response = await fetch(`${this.baseUrl}/health`);
        return response.json();
    }

    async getActivity(days = 30) {
        const response = await fetch(`${this.baseUrl}/activity?days=${days}`);
        return response.json();
    }

    async dismissNotification(notificationId) {
        const response = await fetch(`${this.baseUrl}/notification/${notificationId}/dismiss`, {
            method: 'POST',
        });
        return response.json();
    }

    async freezeComplex(complexId, days) {
        const response = await fetch(`${this.baseUrl}/complex/${complexId}/freeze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days }),
        });
        return response.json();
    }
}

// =============================================================================
// CALENDAR UI COMPONENTS
// =============================================================================
class CalendarUI {
    constructor(state) {
        this.state = state;
    }

    // Streak Badge
    renderStreakBadge(container) {
        const streak = this.state.settings.streak_days;
        const isHot = streak >= 7;

        container.className = isHot ? 'pill-warning pill-sm' : 'pill-neutral pill-sm';
        container.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">local_fire_department</span>
            <span class="text-xs font-bold">${streak} ${this.getDaysWord(streak)}</span>
        `;
    }

    // Time Controller
    renderTimeController(container) {
        container.classList.add('segmented-control', 'calendar-time-controller');
        const buttons = container.querySelectorAll('.time-btn');
        buttons.forEach(btn => {
            const time = parseInt(btn.dataset.time);
            const isActive = time === this.state.settings.daily_time_limit_minutes;

            btn.className = 'time-btn segmented-control__button px-4 py-1.5 text-sm font-medium transition-all';
            btn.classList.toggle('active', isActive);
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    // Recipe Cards
    renderDailyMixCard(elements) {
        const plan = this.state.daily_plan;

        elements.count.textContent = plan.daily_mix_count || 0;
        elements.time.textContent = wt('calendar.tasks_time', 'задач (~{minutes} мин)').replace('{minutes}', plan.daily_mix_minutes || 0);

        if (plan.is_adapted) {
            elements.badge.textContent = wt('calendar.badge_adapted', 'Адаптация очереди');
            elements.desc.textContent = wt('calendar.daily_mix_adapted_desc', 'Очередь адаптирована, но эта подборка остается обязательной для прогресса.');
            elements.btnText.textContent = wt('calendar.btn_resume', 'Возобновить');
        } else {
            elements.badge.textContent = wt('calendar.badge_review', 'Повторение');
            elements.desc.textContent = wt('calendar.daily_mix_desc', 'Персонализированная подборка для закрепления материала.');
            elements.btnText.textContent = wt('calendar.btn_start', 'Начать');
        }
    }

    renderMainFocusCard(elements) {
        const plan = this.state.daily_plan;
        const limit = this.state.settings.daily_time_limit_minutes || 0;

        elements.title.textContent = plan.main_focus_name || wt('calendar.no_new_material', 'Нет нового материала');
        elements.count.textContent = plan.main_focus_count || 0;
        elements.time.textContent = wt('calendar.cases_time', 'новых кейса (~{minutes} мин)').replace('{minutes}', plan.main_focus_minutes || 0);

        // Короткое описание с учетом выбранного времени на день
        const descEl = document.getElementById('main-focus-desc');
        if (descEl) {
            descEl.textContent = plan.main_focus_name
                ? wt('calendar.main_focus_plan_hint', 'На сегодня, план на {limit} мин.').replace('{limit}', limit)
                : wt('calendar.no_active_complex', 'Нет активного комплекса.');
        }
    }

    // Schedule Strip
    renderScheduleStrip(container) {
        container.innerHTML = this.state.schedule.map(day => {
            const isToday = day.is_today;
            const isMissed = day.status === 'missed';
            const isFuture = day.is_future;

            let borderClass = 'border-border-subtle';
            let stateClass = '';
            let bgClass = 'bg-surface-1';
            let extraContent = '';

            if (isToday) {
                borderClass = 'border-primary';
                stateClass = 'schedule-card-today';
                extraContent = '<div class="absolute top-2 right-2 size-2 rounded-full bg-primary animate-pulse"></div>';
            } else if (isMissed) {
                borderClass = 'border-error-light';
                bgClass = 'bg-error-lighter';
            } else if (isFuture) {
                bgClass = 'bg-surface-1';
            }

            const tasksHtml = (day.tasks || []).filter(t => t).map(task => `
                <div class="schedule-task-row flex items-start gap-2">
                    <div class="schedule-task-icon size-1.5 rounded-full ${isToday ? 'bg-text-main' : 'bg-text-secondary'}"></div>
                    <span class="schedule-task-name text-sm ${isToday ? 'text-text-main font-medium' : 'text-text-secondary'}" title="${task}">${task}</span>
                </div>
            `).join('');

            const badgesHtml = (day.badges || []).map(badge => {
                let badgeClass = 'bg-bg-secondary border border-border-subtle text-text-secondary';
                if (badge === 'Пропущено') badgeClass = 'bg-error-lighter border border-error-light text-error-text';
                if (badge === 'Пересчитано' || badge === 'Смещено') badgeClass = 'bg-primary-lighter border border-primary-light text-primary-dark';
                return `<div class="px-2 py-0.5 rounded ${badgeClass} w-fit"><span class="text-[10px] uppercase font-medium">${badge}</span></div>`;
            }).join('');

            return `
                <div class="schedule-card ${stateClass} ${bgClass} border ${borderClass} rounded-xl p-4 flex flex-col gap-3 transition-all shadow-sm relative">
                    ${extraContent}
                    <div class="flex justify-between items-start gap-2">
                        <span class="${isToday ? 'text-primary font-bold' : 'text-text-main font-semibold'}">${day.day_name}</span>
                        <span class="text-xs text-text-secondary whitespace-nowrap">${day.day_num || ''} ${day.month || ''}</span>
                    </div>
                    <div class="h-px w-full bg-border-subtle"></div>
                    <div class="schedule-task-list flex flex-col gap-2">
                        ${tasksHtml}
                        ${badgesHtml || `<div class="px-2 py-0.5 rounded bg-bg-secondary border border-border-subtle w-fit"><span class="text-[10px] text-text-secondary uppercase">${wt('calendar.status_planned', 'План')}</span></div>`}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Heatmap
    renderHeatmap(container) {
        container.innerHTML = this.state.activity.map(day => {
            let bgClass = 'bg-border-light';
            let extraClass = '';

            const tasksSolved = day.tasks_solved || 0;
            const tasksAttempted = day.tasks_attempted || 0;
            const secondsSpent = day.seconds_spent || 0;
            const minutesSpent = Math.round(secondsSpent / 60);

            if (day.is_future) {
                bgClass = 'bg-surface-1 border border-dashed border-border-subtle';
            } else if (day.is_today) {
                bgClass = 'bg-primary animate-pulse shadow-lg shadow-primary-light border-2 border-text-on-dark';
            } else if (day.is_rest_day) {
                bgClass = 'bg-bg-tertiary';
                extraClass = 'border border-border-subtle';
            } else if (day.is_missed) {
                bgClass = 'bg-heat-missed';
                extraClass = 'border border-dashed border-error-light';
            } else if (tasksSolved >= 5) {
                bgClass = 'bg-heat-active';
            } else if (tasksSolved >= 4) {
                bgClass = 'bg-heat-high';
            } else if (tasksSolved >= 2) {
                bgClass = 'bg-heat-med';
            } else if (tasksSolved > 0) {
                bgClass = 'bg-heat-low';
            }

            // Улучшенный tooltip с деталями
            let tooltip = '';
            if (day.is_today) {
                tooltip = wt('calendar.tooltip_today_tasks', 'Сегодня: {tasks} задач').replace('{tasks}', tasksSolved) + (minutesSpent > 0 ? `, ${minutesSpent} ${wt('calendar.min_suffix', 'мин')}` : '');
            } else if (day.is_future) {
                tooltip = wt('calendar.tooltip_future', 'Будущее');
            } else if (day.is_rest_day) {
                tooltip = wt('calendar.status_rest_day', 'Выходной');
            } else if (day.is_missed) {
                tooltip = wt('calendar.tooltip_missed_zero', 'Пропуск (0 задач)');
            } else if (tasksSolved > 0) {
                const accuracy = tasksAttempted > 0 ? Math.round((tasksSolved / tasksAttempted) * 100) : 0;
                tooltip = wt('calendar.tooltip_tasks_count', '{tasks} задач').replace('{tasks}', tasksSolved) + (minutesSpent > 0 ? `, ${minutesSpent} ${wt('calendar.min_suffix', 'мин')}` : '') + (accuracy > 0 ? `, ${accuracy}%` : '');
            } else {
                tooltip = wt('calendar.tooltip_tasks_count', '{tasks} задач').replace('{tasks}', 0);
            }

            return `<div class="aspect-square rounded ${bgClass} ${extraClass} tooltip" data-tooltip="${tooltip}"></div>`;
        }).join('');
    }

    // Activity Banner
    renderActivityBanner(container) {
        const streak = this.state.settings.streak_days;
        const hasMissed = this.state.activity.some(d => d.is_missed);
        const isAdapted = this.state.daily_plan.is_adapted;

        if (streak >= 30) {
            container.innerHTML = this.getCongratulationsBanner(streak);
            container.classList.remove('hidden');
        } else if (hasMissed && isAdapted) {
            container.innerHTML = this.getMissedDayBanner();
            container.classList.remove('hidden');
        } else {
            container.innerHTML = this.getDefaultBanner();
            container.classList.remove('hidden');
        }
    }

    getCongratulationsBanner(streak) {
        return `
            <div class="relative overflow-hidden rounded-xl bg-gradient-to-br from-bg-secondary to-secondary-light border border-secondary-light p-5 shadow-sm animate-slide-in">
                <div class="absolute -right-6 -top-6 size-32 rounded-full bg-secondary-light blur-3xl"></div>
                <div class="relative z-10 flex flex-col gap-3">
                    <div class="flex items-center gap-2 text-secondary-text">
                        <span class="material-symbols-outlined">celebration</span>
                        <h4 class="font-bold text-lg">${wt('calendar.congrats_heading', '{streak} дней подряд!').replace('{streak}', streak)}</h4>
                    </div>
                    <p class="text-sm text-text-muted leading-relaxed max-w-[90%]">
                        ${wt('calendar.congrats_text', 'Вы отлично держитесь! Продолжайте в том же духе — регулярность важнее интенсивности.')}
                    </p>
                </div>
            </div>
        `;
    }

    getMissedDayBanner() {
        return `
            <div class="panel-row panel-row--soft items-start gap-4 animate-slide-in">
                <div class="flex items-center justify-center size-10 rounded-full bg-secondary-light text-secondary-text shrink-0">
                    <span class="material-symbols-outlined">event_busy</span>
                </div>
                <div class="flex flex-col gap-1">
                    <p class="text-sm text-text-main font-bold">${wt('calendar.missed_title', 'Пропустили день? Это нормально!')}</p>
                    <p class="text-xs text-text-muted leading-relaxed">
                        ${wt('calendar.missed_text', 'Ваш план уже перестроен. Мы распределили нагрузку на ближайшие дни.')}
                    </p>
                </div>
            </div>
        `;
    }

    getDefaultBanner() {
        return `
            <div class="panel-row panel-row--soft items-start gap-3">
                <span class="material-symbols-outlined text-text-muted mt-0.5">info</span>
                <div class="flex flex-col gap-1">
                    <p class="text-sm text-text-main font-medium">${wt('calendar.default_banner_title', 'Это нормально — пропускать дни')}</p>
                    <p class="text-xs text-text-muted leading-relaxed">
                        ${wt('calendar.default_banner_text', 'Ваш прогресс сохраняется. Можно выбрать меньше времени на день, если график стал слишком плотным.')}
                    </p>
                </div>
            </div>
        `;
    }

    // Notification Card
    renderNotificationCard(container) {
        if (this.state.notifications.length === 0) {
            container.classList.add('hidden');
            return;
        }

        const notif = this.state.notifications[0];
        container.innerHTML = `
            <div class="panel-row panel-row--soft justify-between animate-slide-in">
                <div class="flex items-center gap-3">
                    <div class="pill-warning pill-sm">
                        <span class="material-symbols-outlined text-[18px]">warning</span>
                    </div>
                    <div>
                        <p class="text-text-main text-sm font-medium">${notif.title}</p>
                        <p class="text-text-secondary text-xs">${notif.message}</p>
                    </div>
                </div>
                <button data-action="notification-action" data-type="${notif.action_type}" class="btn-secondary text-xs px-3 py-1.5 rounded-md font-bold">
                    ${notif.action_type === 'fix' ? wt('calendar.notif_action_fix', 'Исправить') : wt('calendar.notif_action_update', 'Обновить')}
                </button>
            </div>
        `;
        container.classList.remove('hidden');
    }

    // Health Indicator
      renderHealthIndicator(elements) {
          const health = this.state.health_summary;
          const percent = Math.round(health.overall_health * 100);
          const hasFewComplexes = (health.complexes || []).length <= 1;

          elements.percent.textContent = `${percent}%`;
          elements.chart?.parentElement?.classList.toggle('health-content--sparse', hasFewComplexes);

          // Conic gradient
        let gradient = 'conic-gradient(';
        let pos = 0;
        health.complexes.forEach((c, i) => {
            const size = 100 / health.complexes.length;
            const color = c.is_critical ? '#E57373' : (c.health_percent >= 80 ? '#2C7DA0' : '#E2E8F0');
            gradient += `${color} ${pos}% ${pos + size}%`;
            if (i < health.complexes.length - 1) gradient += ', ';
            pos += size;
        });
        gradient += ')';
        elements.ring.style.background = gradient;

        // List
          elements.list.innerHTML = health.complexes.map(c => `
              <div class="health-complex-item panel-row panel-row--soft group cursor-pointer" data-action="review-complex" data-complex="${c.complex_id || c.name}">
                  <div class="health-complex-meta flex items-center gap-2">
                      <div class="size-2 rounded-full ${c.is_critical ? 'bg-warning' : (c.health_percent >= 80 ? 'bg-primary' : 'bg-primary-light')}"></div>
                      <span class="health-complex-name text-sm text-text-main group-hover:${c.is_critical ? 'text-warning-dark' : 'text-primary'} transition-colors" title="${c.name}">${c.name}</span>
                  </div>
                  <span class="health-complex-score panel-chip ${c.is_critical ? 'text-warning-dark' : (c.health_percent >= 80 ? 'text-primary' : 'text-text-muted')} font-bold">${c.health_percent}%</span>
              </div>
          `).join('');
      }

    // Utils
    getDaysWord(n) {
        const abs = Math.abs(n) % 100;
        const n1 = abs % 10;
        if (abs > 10 && abs < 20) return wt('calendar.days_many', 'дней');
        if (n1 > 1 && n1 < 5) return wt('calendar.days_few', 'дня');
        if (n1 === 1) return wt('calendar.days_one', 'день');
        return wt('calendar.days_many', 'дней');
    }
}

// =============================================================================
// CALENDAR INTERACTIONS
// =============================================================================
class CalendarInteractions {
    constructor(state, api, ui) {
        this.state = state;
        this.api = api;
        this.ui = ui;
        this.dragState = { isDragging: false, startX: 0, scrollLeft: 0 };
    }

    setupDragScroll(container) {
        container.addEventListener('mousedown', (e) => {
            this.dragState.isDragging = true;
            container.classList.add('dragging');
            this.dragState.startX = e.pageX - container.offsetLeft;
            this.dragState.scrollLeft = container.scrollLeft;
        });

        container.addEventListener('mouseleave', () => this.endDrag(container));
        container.addEventListener('mouseup', () => this.endDrag(container));

        container.addEventListener('mousemove', (e) => {
            if (!this.dragState.isDragging) return;
            e.preventDefault();
            const x = e.pageX - container.offsetLeft;
            const walk = (x - this.dragState.startX) * 1.5;
            container.scrollLeft = this.dragState.scrollLeft - walk;
        });
    }

    endDrag(container) {
        this.dragState.isDragging = false;
        container.classList.remove('dragging');
    }

    setupGlobalClickHandler() {
        document.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]');
            if (!action) return;

            const actionType = action.dataset.action;

            switch (actionType) {
                case 'switch-mode':
                    this.handleSwitchMode(action.dataset.mode);
                    break;
                case 'notification-action':
                    this.handleNotificationAction(action.dataset.type);
                    break;
                case 'review-complex':
                    this.handleReviewComplex(action.dataset.complex);
                    break;
            }
        });
    }

    async handleSwitchMode(mode) {
        try {
            await this.api.updateSettings({ schedule_mode: mode });
            this.state.updateSettings({ schedule_mode: mode });
        } catch (e) {
            console.error('Failed to switch mode:', e);
        }
    }

    handleNotificationAction(type) {
        if (type === 'fix') {
            const critical = this.state.health_summary.complexes.find(c => c.is_critical);
            if (critical) {
                this.handleReviewComplex(critical.complex_id || critical.name);
            }
        }
    }

    async handleReviewComplex(complexId) {
        console.log('Starting unplanned review:', complexId);
        try {
            const data = await this.api.startSession('daily_mix', complexId);
            if (data && data.session_id) {
                window.navigateWithTransition(`/session/${data.session_id}`);
                return;
            }
        } catch (e) {
            console.error('Failed to start review session:', e);
        }
        // Fallback: navigate to complexes list
        window.navigateWithTransition('/complexes');
    }
}

// =============================================================================
// EXPORT
// =============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CalendarState, CalendarAPI, CalendarUI, CalendarInteractions };
}
