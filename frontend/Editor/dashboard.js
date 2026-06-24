// i18n helper
function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
    var v = window.i18n.t(key);
    return v !== key ? v : fallback;
}

/**
 * ACTRA Editor Dashboard
 */

const EDITOR_DASHBOARD_ONBOARDING_TOUR_ID = 'editor-dashboard-authoring';

class EditorDashboard {
    constructor() {
        this.catalog = [];
        this.workspaceLimits = null;
        this.placeholderTaskNames = [
            'тест теста',
            'тест теста 2',
            'тест теста 21',
            'тест теста 25',
            'тест теста 26',
            'тест теста 27',
            'тест теста 28',
            'тест теста 45',
            'тест теста 98',
            'тест теста 99',
        ];
        this.currentSearchQuery = '';
        this.debouncedSearchHandler = null;
        this.activeModuleId = null;
        this.activeTopicId = null;

        this.currentView = null; // { type: 'all' | 'module' | 'topic', moduleId?, topicId? }
        this.currentSearch = '';
        this.currentSort = 'date';
        this.showPremiumArchiveTasks = false;
        this.sortMenuOpen = false;
        this.boundSortOutsideHandler = null;

        // Import manager
        this.importManager = null;
        this.sortLabels = {
            alphabet: wt('db.k001', 'По алфавиту'),
            date: wt('db.k002', 'По дате изменения'),
            type: wt('db.k003', 'По типу задания')
        };
        this.sortControllerEl = null;
        this.sortToggleEl = null;
        this.sortMenuEl = null;
        this.sortLabelEl = null;
        this.collator = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true });

        // Selection state
        this.selectedTasks = new Set(); // Stores combined IDs: "moduleId:topicId:taskId"
        this.selectionMode = false;
        this.lastSelectedTaskId = null; // For shift-click

        // Sidebar state persistence
        this.expandedState = { modules: [], topics: [] };

        // Deletion Undo State
        this.pendingDeletions = new Map(); // key -> { id, type, timer, element, payload }
        this.pendingInitialView = null;

        // Workspace productivity layer (recent/favorites/recovery)
        this.recentTasksStorageKey = 'editor_recent_tasks_v1';
        this.favoriteTasksStorageKey = 'editor_favorite_tasks_v1';
        this.importHistoryStorageKey = 'editor_import_history_v1';
        this.maxRecentTasks = 8;
        this.recentTasks = [];
        this.favoriteTaskMap = {};
        this.currentUserId = '';
        this.currentUserIdResolved = false;
        this.currentUserIdPromise = null;

        this.topicTheoryModalState = {
            moduleId: null,
            topicId: null,
            loading: false,
            saving: false,
        };
        this.topicTheoryCatalog = [];
        this.topicTheoryModalBound = false;
        this.topicTheorySyncInFlight = new Set();
        this.pendingMicrocardsManual = false;
        this.onboardingDemoActive = false;
        this.onboardingSnapshot = null;
        this.onboardingDemoCatalogLoadSkipped = false;

        this.init();
    }

    createAllTasksElement() {
        const button = document.createElement('button');
        button.className = 'editor-sidebar-tree-button flex items-center gap-2 px-3 min-h-[2.5rem] text-text-secondary hover:text-text-main hover:bg-bg-hover rounded-lg transition-colors w-full text-left';
        button.dataset.allTasksButton = 'true';
        const badgeMarkup = this.getAllTasksNavBadgeMarkup();
        button.innerHTML = `
            <span class="material-symbols-outlined text-[20px]">all_inclusive</span>
            <span class="editor-sidebar-tree-label truncate text-sm font-semibold flex-1 text-inherit">${wt('db.k004', 'Все задания')}</span>
        `;
        if (badgeMarkup) {
            button.insertAdjacentHTML('beforeend', badgeMarkup);
        }
        button.addEventListener('click', () => {
            this.activeModuleId = null;
            this.activeTopicId = null;
            this.currentSearchQuery = '';
            const searchInput = document.querySelector('#editor-search-input');
            if (searchInput) {
                searchInput.value = '';
            }
            this.syncSidebarSelection();
            this.updateUrlState();
            this.renderGrid();
        });
        return button;
    }

    getAllTasksNavBadgeMarkup(summary = this.getTaskLimitSummary()) {
        if (!summary) return '';

        const isPremium = this.isPremiumWorkspacePlan();
        const label = isPremium
            ? 'Premium'
            : `${Number(summary.personal_count || 0)}/${Number(summary.personal_limit || 0)}`;
        const title = isPremium
            ? wt('db.k005', 'Premium · без лимита')
            : `${wt('db.k006', 'Мои задания:')} ${label}`;

        const promoAttrs = isPremium
            ? ''
            : ' data-premium-promo-trigger data-premium-promo-feature="tasks-limit" role="button" tabindex="0"';
        return `<span class="shrink-0 rounded-full border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[11px] font-semibold leading-none text-text-secondary" data-role="all-tasks-limit-badge" data-onboarding-target="editor-task-limit-badge" title="${this.escapeHtml(title)}"${promoAttrs}>${this.escapeHtml(label)}</span>`;
    }

    init() {
        this.log('[init] Dashboard initializing...');
        this.loadWorkspaceShortcuts();
        this.setupOnboardingTourBridge();
        // this.log(`Location: ${window.location.href}`); // Removed as per instruction

        // if (window.location.protocol === 'file:') { // Removed as per instruction
        //     this.log("CRITICAL ERROR: Running via file:// protocol.");
        //     this.log("You MUST access this page via http://localhost:8000/editor");
        //     alert("Ошибка: Вы открыли файл напрямую. Используйте http://localhost:8000/editor");
        // }

        const lastView = this.loadDashboardState();

        Promise.all([
            this.resolveCurrentDashboardUserId(),
            this.loadCatalog(),
            this.loadWorkspaceLimits(),
        ]).then(() => {
            // Clean up orphaned drafts after catalog is loaded
            this.cleanupOrphanedDrafts();
            this.renderWorkspaceShortcuts();
            this.refreshCurrentView();
            if (!document.getElementById('recovery-center-modal')?.classList.contains('hidden')) {
                this.renderRecoveryCenter();
            }
        }); // Clean orphaned drafts after catalog loads
        this.setupEventListeners();
        this.setupPageExitSafety();
        this.setupThemeListener();

        // Initialize import manager
        if (typeof ImportManager !== 'undefined') {
            this.importManager = new ImportManager(this);
            this.log('[init] ImportManager initialized');
        } else {
            const suppressImportManagerWarning =
                typeof window !== 'undefined' && window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
            if (!suppressImportManagerWarning) {
                console.warn('[Dashboard] ImportManager not loaded');
            }
        }

        // Apply initial state from URL or saved state after catalog loads
        const routeState = window.__EDITOR_ROUTE_STATE__ || {};
        if (routeState.microcards_manual === '1') {
            this.pendingMicrocardsManual = true;
        }
        if (routeState.archive === 'premium' || routeState.filter === 'archived') {
            this.showPremiumArchiveTasks = true;
        }

        if (routeState.module && routeState.topic) {
            this.pendingInitialView = { moduleId: routeState.module, topicId: routeState.topic };
        } else if (routeState.module) {
            this.pendingInitialView = { moduleId: routeState.module, topicId: null };
        } else if (lastView?.moduleId) {
            this.pendingInitialView = {
                moduleId: lastView.moduleId,
                topicId: lastView.topicId || null,
            };
        } else {
            this.renderGrid();
        }
    }

    log(msg) {
        console.log(msg);
        if (this.debugPanel) {
            const line = document.createElement('div');
            line.textContent = `> ${msg}`;
            line.style.borderBottom = '1px solid var(--color-border-subtle)';
            line.style.padding = '2px 0';
            this.debugPanel.appendChild(line);
            this.debugPanel.scrollTop = this.debugPanel.scrollHeight;
        }
    }

    setupOnboardingTourBridge() {
        window.addEventListener('onboarding:before-start', (event) => {
            if (event?.detail?.tourId !== EDITOR_DASHBOARD_ONBOARDING_TOUR_ID) return;
            this.applyEditorDashboardOnboardingDemoState();
        });

        window.addEventListener('onboarding:before-step', (event) => {
            if (event?.detail?.tourId !== EDITOR_DASHBOARD_ONBOARDING_TOUR_ID) return;
            if (!this.onboardingDemoActive) {
                this.applyEditorDashboardOnboardingDemoState();
            }
            if (event.detail.stepId === 'editor-dashboard-create-task') {
                this.prepareEditorDashboardOnboardingCreateModal();
            } else {
                this.closeModals();
            }
        });

        window.addEventListener('onboarding:finish', (event) => {
            if (event?.detail?.tourId !== EDITOR_DASHBOARD_ONBOARDING_TOUR_ID) return;
            this.restoreEditorDashboardOnboardingDemoState();
        });
    }

    createEditorDashboardOnboardingCatalog() {
        const now = new Date().toISOString();
        return [
            {
                id: 'onboarding-module-radiology',
                name: 'Лучевая диагностика',
                topics: [
                    {
                        id: 'onboarding-topic-waves',
                        name: 'Электромагнитные волны',
                        theory_link: {
                            theory_id: 'theory-radio-wave-basics',
                            relation: 'primary',
                        },
                        tasks: [
                            {
                                id: 'onboarding-task-wave-test',
                                name: 'Тест: параметры волны',
                                type: 'test',
                                created_at: now,
                                updated_at: now,
                            },
                            {
                                id: 'onboarding-task-spectrum-click',
                                name: 'Клик: участки спектра',
                                type: 'click',
                                created_at: now,
                                updated_at: now,
                            },
                        ],
                    },
                    {
                        id: 'onboarding-topic-safety',
                        name: 'Безопасность исследования',
                        tasks: [
                            {
                                id: 'onboarding-task-safety-open',
                                name: 'Открытый ответ: подготовка пациента',
                                type: 'open_answer',
                                created_at: now,
                                updated_at: now,
                            },
                        ],
                    },
                ],
            },
            {
                id: 'onboarding-module-practice',
                name: 'Практические навыки',
                topics: [
                    {
                        id: 'onboarding-topic-sequence',
                        name: 'Последовательность действий',
                        tasks: [
                            {
                                id: 'onboarding-task-sequence',
                                name: 'Сборка: порядок подготовки',
                                type: 'sequence_assembly',
                                created_at: now,
                                updated_at: now,
                            },
                        ],
                    },
                ],
            },
        ];
    }

    captureEditorDashboardOnboardingSnapshot() {
        return {
            catalog: JSON.parse(JSON.stringify(this.catalog || [])),
            workspaceLimits: this.workspaceLimits ? JSON.parse(JSON.stringify(this.workspaceLimits)) : null,
            activeModuleId: this.activeModuleId,
            activeTopicId: this.activeTopicId,
            currentSearchQuery: this.currentSearchQuery,
            currentSort: this.currentSort,
            showPremiumArchiveTasks: this.showPremiumArchiveTasks,
            expandedState: JSON.parse(JSON.stringify(this.expandedState || { modules: [], topics: [] })),
            selectedTasks: Array.from(this.selectedTasks || []),
            selectionMode: this.selectionMode,
            searchValue: document.querySelector('#editor-search-input')?.value || '',
        };
    }

    applyEditorDashboardOnboardingDemoState() {
        if (!this.onboardingSnapshot) {
            this.onboardingSnapshot = this.captureEditorDashboardOnboardingSnapshot();
        }
        this.onboardingDemoActive = true;
        document.body.dataset.editorDashboardOnboardingDemo = 'true';

        this.catalog = this.createEditorDashboardOnboardingCatalog();
        this.workspaceLimits = {
            ...(this.workspaceLimits || {}),
            plan: 'free',
            tasks: {
                personal_count: 4,
                personal_limit: 50,
                remaining_personal: 46,
            },
        };
        this.activeModuleId = 'onboarding-module-radiology';
        this.activeTopicId = 'onboarding-topic-waves';
        this.currentSearchQuery = '';
        this.currentSort = 'date';
        this.showPremiumArchiveTasks = false;
        this.expandedState = {
            modules: ['onboarding-module-radiology'],
            topics: ['onboarding-module-radiology:onboarding-topic-waves'],
        };
        this.selectedTasks.clear();
        this.selectionMode = false;

        const searchInput = document.querySelector('#editor-search-input');
        if (searchInput) searchInput.value = '';
        this.updateSortLabel();
        this.updateSortMenuChecks();
        this.closeModals();
        this.renderSidebar();
        this.renderTopicTasks('onboarding-module-radiology', 'onboarding-topic-waves');
    }

    prepareEditorDashboardOnboardingCreateModal() {
        this.showCreateTaskModal();
        const moduleSelect = document.querySelector('#task-module-select');
        const topicSelect = document.querySelector('#task-topic-select');
        const nameInput = document.querySelector('#task-name-input');
        const typeSelect = document.querySelector('#task-type-select');

        if (moduleSelect) {
            moduleSelect.value = 'onboarding-module-radiology';
            this.updateTopicSelect();
        }
        if (topicSelect) topicSelect.value = 'onboarding-topic-waves';
        if (nameInput) nameInput.value = 'Контрольный вопрос по волнам';
        if (typeSelect) typeSelect.value = 'test';
    }

    restoreEditorDashboardOnboardingDemoState() {
        if (!this.onboardingDemoActive && !this.onboardingSnapshot) return;

        const snapshot = this.onboardingSnapshot;
        const shouldReloadCatalog = this.onboardingDemoCatalogLoadSkipped;
        this.onboardingDemoActive = false;
        this.onboardingDemoCatalogLoadSkipped = false;
        this.onboardingSnapshot = null;
        delete document.body.dataset.editorDashboardOnboardingDemo;
        this.closeModals();

        if (snapshot) {
            this.catalog = snapshot.catalog || [];
            this.workspaceLimits = snapshot.workspaceLimits;
            this.activeModuleId = snapshot.activeModuleId || null;
            this.activeTopicId = snapshot.activeTopicId || null;
            this.currentSearchQuery = snapshot.currentSearchQuery || '';
            this.currentSort = snapshot.currentSort || 'date';
            this.showPremiumArchiveTasks = Boolean(snapshot.showPremiumArchiveTasks);
            this.expandedState = snapshot.expandedState || { modules: [], topics: [] };
            this.selectedTasks = new Set(snapshot.selectedTasks || []);
            this.selectionMode = Boolean(snapshot.selectionMode);

            const searchInput = document.querySelector('#editor-search-input');
            if (searchInput) searchInput.value = snapshot.searchValue || '';
            this.updateSortLabel();
            this.updateSortMenuChecks();
            this.renderSidebar();
            this.refreshCurrentView();
        }

        if (shouldReloadCatalog) {
            this.loadCatalog().then(() => {
                this.renderWorkspaceShortcuts();
                this.refreshCurrentView();
            });
        }
    }

    escapeHtml(value) {
        const el = document.createElement('span');
        el.textContent = value == null ? '' : String(value);
        return el.innerHTML;
    }

    async resolveCurrentDashboardUserId(forceRefresh = false) {
        if (!forceRefresh && this.currentUserIdResolved) {
            return this.currentUserId;
        }
        if (!forceRefresh && this.currentUserIdPromise) {
            return this.currentUserIdPromise;
        }

        this.currentUserIdPromise = (async () => {
            try {
                if (forceRefresh) {
                    this.currentUserId = '';
                    this.currentUserIdResolved = false;
                }
                const response = await fetch('/api/auth/me');
                const data = await response.json().catch(() => ({}));
                const userId = String(data?.user?.user_id || '').trim();
                if (response.ok && data?.ok && data?.authenticated && userId) {
                    this.currentUserId = userId;
                    return this.currentUserId;
                }
            } catch (error) {
                console.warn('[Dashboard] Failed to resolve current user through auth/me', error);
            } finally {
                this.currentUserIdResolved = true;
                this.currentUserIdPromise = null;
            }

            this.currentUserId = '';
            return this.currentUserId;
        })();

        return this.currentUserIdPromise;
    }

    normalizeRecoveryDraftOwnerUserId(rawDraft = null) {
        if (!rawDraft || typeof rawDraft !== 'object') return '';
        return String(
            rawDraft.ownerUserId
            || rawDraft.owner_user_id
            || rawDraft.createdByUserId
            || rawDraft.created_by_user_id
            || ''
        ).trim();
    }

    isRecoveryDraftVisibleToCurrentUser(ownerUserId = '', { requireOwner = false } = {}) {
        if (!this.currentUserIdResolved) return false;

        const normalizedCurrentUserId = String(this.currentUserId || '').trim();
        if (!normalizedCurrentUserId) {
            return true;
        }

        const normalizedOwnerUserId = String(ownerUserId || '').trim();
        if (!normalizedOwnerUserId) {
            return !requireOwner;
        }

        return normalizedOwnerUserId === normalizedCurrentUserId;
    }

    composeFeedbackMessage({ what = '', impact = '', next = '' } = {}) {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.voiceMessage === 'function') {
            return NotificationUI.voiceMessage({ what, impact, next });
        }
        return [what, impact, next].filter(Boolean).join(' ');
    }

    resolveFeedbackVariant(level = 'info') {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.resolveVariant === 'function') {
            return NotificationUI.resolveVariant(level);
        }
        const key = String(level || '').trim().toLowerCase();
        if (key === 'success' || key === 'warning' || key === 'error' || key === 'info') return key;
        if (key === 'blocking') return 'error';
        return 'info';
    }

    showToast(msg, severity = 'info') {
        this.showVoiceToast({
            severity: severity,
            what: msg
        });
    }

    showVoiceToast({ severity = 'info', what = '', impact = '', next = '', timeout = 4200 } = {}) {
        const message = this.composeFeedbackMessage({ what, impact, next });
        if (!message) return;

        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toastVoice === 'function') {
            NotificationUI.toastVoice({ severity, what, impact, next, timeout });
            return;
        }

        const resolved = this.resolveFeedbackVariant(severity);
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toast === 'function') {
            NotificationUI.toast(message, resolved, timeout);
            return;
        }

        console.warn('[Dashboard] Toast unavailable:', message);
    }

    async loadWorkspaceLimits() {
        try {
            const response = await fetch('/api/workspace-limits/summary', {
                method: 'GET',
                credentials: 'same-origin',
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data?.ok === false) {
                throw new Error(data?.error || `http_${response.status}`);
            }
            this.workspaceLimits = data;
            return data;
        } catch (error) {
            console.warn('[Dashboard] Failed to load workspace limits', error);
            this.workspaceLimits = null;
            return null;
        } finally {
            this.renderTaskLimitUi();
        }
    }

    getTaskLimitSummary() {
        return this.workspaceLimits && typeof this.workspaceLimits.tasks === 'object'
            ? this.workspaceLimits.tasks
            : null;
    }

    getTaskArchivedItems() {
        const summary = this.getTaskLimitSummary();
        return Array.isArray(summary?.archived_items) ? summary.archived_items : [];
    }

    getArchivedTaskRefs(item) {
        if (!item || typeof item !== 'object') return [];
        return [item.id, item.ref, item.workspace_entity_id, item.workspace_entity_ref]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
    }

    getTaskArchiveCandidateRefs(task = {}) {
        const moduleId = String(task.moduleId || task.module_id || '').trim();
        const topicId = String(task.topicId || task.topic_id || '').trim();
        const taskId = String(this.getCanonicalTaskId(task) || task.id || '').trim();
        return new Set([
            taskId,
            String(task.legacy_id || '').trim(),
            String(task.ref || task.path || task.metadata?.path || '').trim(),
            moduleId && topicId && taskId ? `${moduleId}/${topicId}/${taskId}` : '',
        ].filter(Boolean));
    }

    resolveTaskArchiveItem(task = {}) {
        const archivedItems = this.getTaskArchivedItems();
        if (!archivedItems.length || !task || typeof task !== 'object') return null;
        const candidateRefs = this.getTaskArchiveCandidateRefs(task);
        return archivedItems.find((item) => {
            if (!item || typeof item !== 'object') return false;
            return this.getArchivedTaskRefs(item).some((ref) => candidateRefs.has(ref));
        }) || null;
    }

    isTaskPremiumArchived(task = {}) {
        return Boolean(this.resolveTaskArchiveItem(task));
    }

    isTaskUniqueIdPremiumArchived(uniqueId) {
        const normalizedId = String(uniqueId || '').trim();
        if (!normalizedId) return false;
        return this.collectAllTasks().some((task) => (
            this.makeTaskUniqueId(task.moduleId, task.topicId, task.id) === normalizedId
            && this.isTaskPremiumArchived(task)
        ));
    }

    isPremiumWorkspacePlan() {
        return String(this.workspaceLimits?.plan || '').trim().toLowerCase() === 'premium';
    }

    getTaskLimitMessage(summary = this.getTaskLimitSummary()) {
        if (!summary || this.isPremiumWorkspacePlan()) return '';
        return `${wt('db.k007', 'Лимит своих заданий достигнут:')} ${Number(summary.personal_count || 0)}/${Number(summary.personal_limit || 0)}. ${wt('db.k008', 'Удалите лишние задания или перейдите на Premium.')}`;
    }

    getTaskDraftNotice(summary = this.getTaskLimitSummary()) {
        if (!summary || this.isPremiumWorkspacePlan() || !this.isTaskCreationBlocked()) return '';
        return `${this.getTaskLimitMessage(summary)} ${wt('db.k009', 'Новый черновик открыть можно, но первое сохранение нового задания будет заблокировано, пока не освободится слот.')}`;
    }

    isTaskCreationBlocked() {
        const summary = this.getTaskLimitSummary();
        if (!summary || this.isPremiumWorkspacePlan()) return false;
        return Number(summary.remaining_personal || 0) <= 0;
    }

    renderTaskLimitUi() {
        const pill = null;
        const note = document.getElementById('create-task-limit-note');
        const submitBtn = document.getElementById('create-task-submit-btn');
        const createCard = document.querySelector('[data-role="create-task-card"]');
        const archiveFilter = document.getElementById('editor-archive-filter');
        const archiveFilterCount = document.getElementById('editor-archive-filter-count');
        const summary = this.getTaskLimitSummary();
        const blocked = this.isTaskCreationBlocked();
        const archivedCount = Number(summary?.archived_count || this.getTaskArchivedItems().length || 0);

        if (pill) {
            if (!summary) {
                pill.classList.add('hidden');
            } else if (this.isPremiumWorkspacePlan()) {
                pill.classList.remove('hidden');
                pill.classList.add('inline-flex');
                pill.innerHTML = wt('db.k010', '<span class="material-symbols-outlined text-[18px]">workspace_premium</span><span>Premium · без лимита</span>');
            } else {
                pill.classList.remove('hidden');
                pill.classList.add('inline-flex');
                pill.innerHTML = `<span class="material-symbols-outlined text-[18px]">${blocked ? 'lock' : 'task'}</span><span>${wt('db.k011', 'Мои задания:')} ${Number(summary.personal_count || 0)}/${Number(summary.personal_limit || 0)}</span>`;
            }
        }

        if (note) {
            const message = blocked ? this.getTaskDraftNotice(summary) : '';
            note.classList.toggle('hidden', !message);
            note.textContent = message;
            if (message) {
                note.setAttribute('data-premium-promo-trigger', '');
                note.setAttribute('data-premium-promo-feature', 'tasks-limit');
                note.setAttribute('role', 'button');
                note.setAttribute('tabindex', '0');
            } else {
                note.removeAttribute('data-premium-promo-trigger');
                note.removeAttribute('data-premium-promo-feature');
                note.removeAttribute('role');
                note.removeAttribute('tabindex');
            }
        }

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        }

        if (createCard) {
            createCard.disabled = false;
            createCard.classList.remove('opacity-60', 'cursor-not-allowed');
            createCard.title = blocked ? (this.getTaskDraftNotice(summary) || wt('db.k012', 'Можно открыть черновик, но сохранить новое задание пока нельзя')) : wt('db.k013', 'Создать новое задание');
        }
        if (archiveFilter) {
            archiveFilter.hidden = archivedCount <= 0;
            archiveFilter.disabled = archivedCount <= 0;
            archiveFilter.setAttribute('aria-pressed', this.showPremiumArchiveTasks ? 'true' : 'false');
            archiveFilter.title = archivedCount > 0
                ? `${wt('db.k014', 'В архиве Premium:')} ${archivedCount} ${wt('db.k015', 'заданий. Они доступны для просмотра и удаления, но не для редактирования или экспорта.')}`
                : wt('db.k016', 'В архиве Premium пока нет заданий.');
        }
        if (archiveFilterCount) {
            archiveFilterCount.hidden = archivedCount <= 0;
            archiveFilterCount.textContent = String(archivedCount);
        }
        this.renderSidebar();
    }

    makeTaskUniqueId(moduleId, topicId, taskId) {
        if (!moduleId || !topicId || !taskId) return '';
        return `${moduleId}:${topicId}:${taskId}`;
    }

    getCanonicalTaskId(taskLike) {
        if (!taskLike || typeof taskLike !== 'object') return '';

        const taskMetaId = String(taskLike.task_data?.meta?.id || taskLike.meta?.id || taskLike.metadata?.id || '').trim();
        if (taskMetaId) return taskMetaId;

        const rawPath = String(taskLike.path || taskLike.metadata?.path || '').replace(/\\/g, '/');
        const pathMatch = rawPath.match(/(?:^|\/)tasks\/([^/]+)\/task\.json$/);
        if (pathMatch?.[1]) return String(pathMatch[1]).trim();

        return String(taskLike.taskId || taskLike.id || '').trim();
    }

    normalizeCatalogTask(task, context = {}) {
        const canonicalId = this.getCanonicalTaskId(task);
        const legacyId = String(task?.legacy_id || task?.id || '').trim();
        return {
            ...task,
            ...context,
            id: canonicalId || task?.id,
            legacy_id: legacyId && legacyId !== canonicalId ? legacyId : (task?.legacy_id || ''),
        };
    }

    getTaskBootstrapStorageKey(moduleId, topicId, taskId) {
        if (!moduleId || !topicId || !taskId) return '';
        return `editor_task_bootstrap_${moduleId}_${topicId}_${taskId}`;
    }

    storeTaskBootstrap(moduleId, topicId, taskId, task) {
        const key = this.getTaskBootstrapStorageKey(moduleId, topicId, taskId);
        if (!key) return;
        try {
            sessionStorage.setItem(key, JSON.stringify(task));
        } catch (error) {
            console.warn('[Dashboard] Failed to store task bootstrap', error);
        }
    }

    normalizeShortcutTask(taskLike = {}) {
        const moduleId = taskLike.moduleId || taskLike.module_id;
        const topicId = taskLike.topicId || taskLike.topic_id;
        const taskId = taskLike.taskId || taskLike.id || taskLike.task_id;
        const uniqueId = taskLike.uniqueId || this.makeTaskUniqueId(moduleId, topicId, taskId);
        if (!uniqueId || !moduleId || !topicId || !taskId) return null;

        return {
            uniqueId,
            moduleId,
            topicId,
            taskId,
            name: taskLike.name || taskLike.taskName || taskId,
            moduleName: taskLike.moduleName || taskLike.module_name || moduleId,
            topicName: taskLike.topicName || taskLike.topic_name || topicId,
            type: taskLike.type || taskLike.task_type || '',
            touchedAt: Number(taskLike.touchedAt || Date.now())
        };
    }

    loadWorkspaceShortcuts() {
        try {
            const rawRecent = localStorage.getItem(this.recentTasksStorageKey);
            const parsedRecent = rawRecent ? JSON.parse(rawRecent) : [];
            this.recentTasks = Array.isArray(parsedRecent)
                ? parsedRecent
                    .map((item) => this.normalizeShortcutTask(item))
                    .filter(Boolean)
                    .slice(0, this.maxRecentTasks)
                : [];
        } catch (e) {
            this.recentTasks = [];
        }

        try {
            const rawFavorite = localStorage.getItem(this.favoriteTasksStorageKey);
            const parsedFavorite = rawFavorite ? JSON.parse(rawFavorite) : {};
            this.favoriteTaskMap = {};
            if (parsedFavorite && typeof parsedFavorite === 'object') {
                Object.keys(parsedFavorite).forEach((key) => {
                    const normalized = this.normalizeShortcutTask(parsedFavorite[key]);
                    if (normalized) {
                        this.favoriteTaskMap[key] = normalized;
                    }
                });
            }
        } catch (e) {
            this.favoriteTaskMap = {};
        }
    }

    saveWorkspaceShortcuts() {
        try {
            localStorage.setItem(this.recentTasksStorageKey, JSON.stringify(this.recentTasks.slice(0, this.maxRecentTasks)));
            localStorage.setItem(this.favoriteTasksStorageKey, JSON.stringify(this.favoriteTaskMap || {}));
        } catch (e) {
            console.warn('[Dashboard] Failed to persist workspace shortcuts', e);
        }
    }

    isFavoriteTask(uniqueId) {
        return Boolean(uniqueId && this.favoriteTaskMap && this.favoriteTaskMap[uniqueId]);
    }

    toggleFavoriteTask(taskLike, options = {}) {
        const { skipRefreshGrid = false } = options;
        const normalized = this.normalizeShortcutTask(taskLike);
        if (!normalized) return;
        if (this.favoriteTaskMap[normalized.uniqueId]) {
            delete this.favoriteTaskMap[normalized.uniqueId];
        } else {
            this.favoriteTaskMap[normalized.uniqueId] = normalized;
        }
        this.saveWorkspaceShortcuts();
        this.renderWorkspaceShortcuts();
        if (!skipRefreshGrid) {
            this.refreshCurrentView();
        }
    }

    registerTaskVisit(taskLike) {
        const normalized = this.normalizeShortcutTask(taskLike);
        if (!normalized) return;
        const nextRecent = [normalized, ...this.recentTasks.filter((item) => item.uniqueId !== normalized.uniqueId)];
        this.recentTasks = nextRecent.slice(0, this.maxRecentTasks);
        if (this.favoriteTaskMap[normalized.uniqueId]) {
            this.favoriteTaskMap[normalized.uniqueId] = {
                ...this.favoriteTaskMap[normalized.uniqueId],
                ...normalized,
            };
        }
        this.saveWorkspaceShortcuts();
        this.renderWorkspaceShortcuts();
    }

    getWorkspaceTaskByUniqueId(uniqueId) {
        if (!uniqueId) return null;
        const allTasks = this.collectAllTasks();
        const hit = allTasks.find((task) => this.makeTaskUniqueId(task.moduleId, task.topicId, task.id) === uniqueId);
        if (!hit) return null;
        return this.normalizeShortcutTask({
            uniqueId,
            moduleId: hit.moduleId,
            topicId: hit.topicId,
            taskId: hit.id,
            name: hit.name || hit.id,
            moduleName: hit.moduleName || hit.moduleId,
            topicName: hit.topicName || hit.topicId,
            type: hit.type,
        });
    }

    loadImportHistory() {
        try {
            const raw = localStorage.getItem(this.importHistoryStorageKey);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    saveImportHistory(items = []) {
        try {
            localStorage.setItem(this.importHistoryStorageKey, JSON.stringify(items));
        } catch (e) {
            console.warn('[Dashboard] Failed to persist import history', e);
        }
    }

    getImportHistoryEntries(limit = 4) {
        return this.loadImportHistory()
            .slice(0, Math.max(0, Number(limit) || 0))
            .map((item, historyIndex) => ({
                historyIndex,
                timestamp: Number(item?.timestamp || 0),
                status: String(item?.status || 'unknown'),
                mode: String(item?.mode || 'text'),
                module: String(item?.module || ''),
                topic: String(item?.topic || ''),
                moduleId: String(item?.module_id || ''),
                topicId: String(item?.topic_id || ''),
                imported: Number(item?.imported || 0),
                skipped: Number(item?.skipped || 0),
                errors: Number(item?.errors || 0),
                message: String(item?.message || ''),
            }));
    }

    dismissImportHistoryEntry(historyIndex) {
        const normalizedIndex = Number(historyIndex);
        if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) return;

        const items = this.loadImportHistory();
        if (normalizedIndex >= items.length) return;

        items.splice(normalizedIndex, 1);
        this.saveImportHistory(items);
        this.renderWorkspaceShortcuts();
    }

    getImportHistoryTone(status) {
        const normalized = String(status || '').toLowerCase();
        if (normalized === 'ok' || normalized === 'success') return 'success';
        if (normalized === 'partial' || normalized === 'warning') return 'warning';
        if (normalized === 'error') return 'error';
        return 'info';
    }

    formatImportHistoryTime(timestamp) {
        const date = new Date(Number(timestamp || 0));
        if (Number.isNaN(date.getTime())) return wt('db.k017', 'недавно');
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    openImportHistoryEntry(entry) {
        this.showImportModal();
        if (!this.importManager || !entry) return;

        this.importManager.selectedModule = entry.moduleId || null;
        this.importManager.selectedTopic = entry.topicId || null;
        this.importManager.selectedModuleName = entry.module || '';
        this.importManager.selectedTopicName = entry.topic || '';
        this.importManager.goToStep(1);
    }

    buildWorkspaceImportPreviewRequestFromComplex(complexLike = {}) {
        const complexId = String(complexLike?.id || '').trim();
        if (!complexId) return null;

        const sourceCatalogItemId = String(
            complexLike?.source_catalog_item_id
            || complexLike?.sourceCatalogItemId
            || complexLike?.source_lineage?.source_catalog_item_id
            || complexLike?.sourceLineage?.sourceCatalogItemId
            || `internal_workspace_complex:${complexId}`
        ).trim();
        const sourceCatalogVersionId = String(
            complexLike?.source_catalog_version_id
            || complexLike?.sourceCatalogVersionId
            || complexLike?.source_lineage?.source_catalog_version_id
            || complexLike?.sourceLineage?.sourceCatalogVersionId
            || 'draft'
        ).trim();

        return {
            sourceComplexId: complexId,
            sourceCatalogItemId,
            sourceCatalogVersionId,
            preferExistingByLineage: true,
        };
    }

    previewWorkspaceCopyFromComplex(complexLike = {}) {
        void complexLike;
        this.showVoiceToast({
            severity: 'info',
            what: 'Legacy import is internal-only.',
            impact: 'This hosted flow no longer creates editable workspace copies from library content.',
            next: 'Open the linked publication directly or create a new complex from scratch.',
        });
        return;
        const request = this.buildWorkspaceImportPreviewRequestFromComplex(complexLike);
        if (!request) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k018', 'Preview workspace-копии не открыт.'),
                impact: wt('db.k019', 'Не удалось определить исходный комплекс.'),
                next: wt('db.k020', 'Обновите Theory Hub и повторите действие.'),
            });
            return;
        }
        this.showWorkspaceImportPreviewModal(request);
    }

    renderWorkspaceShortcuts() {
        const host = document.getElementById('editor-workspace-shortcuts');
        if (!host) return;

        const favoriteEntries = Object.values(this.favoriteTaskMap || {})
            .map((item) => this.getWorkspaceTaskByUniqueId(item.uniqueId) || item)
            .slice(0, 5);
        const importEntries = this.getImportHistoryEntries(3);
        const recoveryDrafts = this.getVisibleRecoveryDrafts();

        host.replaceChildren();
        if (!favoriteEntries.length && !importEntries.length) {
            host.classList.add('hidden');
            this.updateRecoveryCenterTrigger(recoveryDrafts);
            return;
        }

        host.classList.remove('hidden');
        if (favoriteEntries.length) {
            host.appendChild(this.createShortcutSection(wt('db.k021', 'Избранное'), favoriteEntries));
        }
        if (importEntries.length) {
            host.appendChild(this.createImportHistorySection(wt('db.k022', 'Последние импорты'), importEntries));
        }
        this.updateRecoveryCenterTrigger(recoveryDrafts);
    }

    createShortcutSection(title, entries = []) {
        const section = document.createElement('div');
        section.className = 'mb-3';
        const heading = document.createElement('div');
        heading.className = 'text-[10px] font-bold uppercase tracking-wider text-text-disabled mb-2 px-1';
        heading.textContent = title;
        section.appendChild(heading);

        const list = document.createElement('div');
        list.className = 'space-y-1';
        entries.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-1';

            const openBtn = document.createElement('button');
            openBtn.className = 'flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border-subtle bg-surface-1 text-text-secondary hover:text-primary hover:border-primary hover:bg-bg-hover transition-colors text-left';
            openBtn.innerHTML = `
                <span class="material-symbols-outlined text-[15px] text-text-disabled">article</span>
                <span class="truncate text-xs font-semibold">${this.escapeHtml(entry.name || entry.taskId)}</span>
            `;
            openBtn.title = `${entry.moduleName || entry.moduleId} / ${entry.topicName || entry.topicId}`;
            openBtn.addEventListener('click', () => {
                this.loadTask(entry.moduleId, entry.topicId, entry.taskId);
            });

            const favoriteBtn = document.createElement('button');
            favoriteBtn.className = 'h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border-subtle bg-surface-1 text-text-disabled hover:text-warning hover:border-warning transition-colors';
            favoriteBtn.title = this.isFavoriteTask(entry.uniqueId) ? wt('db.k023', 'Убрать из избранного') : wt('db.k024', 'Добавить в избранное');
            favoriteBtn.innerHTML = `<span class="material-symbols-outlined text-[17px]">${this.isFavoriteTask(entry.uniqueId) ? 'star' : 'star_outline'}</span>`;
            favoriteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.toggleFavoriteTask(entry, { skipRefreshGrid: true });
            });

            row.appendChild(openBtn);
            row.appendChild(favoriteBtn);
            list.appendChild(row);
        });

        section.appendChild(list);
        return section;
    }


    createImportHistorySection(title, entries = []) {
        const section = document.createElement('div');
        section.className = 'mb-3';

        const heading = document.createElement('div');
        heading.className = 'text-[10px] font-bold uppercase tracking-wider text-text-disabled mb-2 px-1';
        heading.textContent = title;
        section.appendChild(heading);

        const list = document.createElement('div');
        list.className = 'space-y-1';
        entries.forEach((entry) => {
            const tone = this.getImportHistoryTone(entry.status);
            const toneClass =
                tone === 'success'
                    ? 'text-success bg-success-lighter border-success-light'
                    : tone === 'warning'
                        ? 'text-warning bg-warning-lighter border-warning-light'
                        : tone === 'error'
                            ? 'text-error bg-error-lighter border-error-light'
                            : 'text-text-secondary bg-bg-tertiary border-border-subtle';
            const statusLabel =
                tone === 'success'
                    ? wt('db.k025', 'Успешно')
                    : tone === 'warning'
                        ? wt('db.k026', 'Частично')
                        : tone === 'error'
                            ? wt('db.k027', 'Ошибка')
                            : wt('db.k028', 'Недавно');
            const location = [entry.module, entry.topic].filter(Boolean).join(' / ') || wt('db.k029', 'Без привязки');
            const summary = `+${entry.imported} | skip ${entry.skipped} | err ${entry.errors}`;
            const timeLabel = this.formatImportHistoryTime(entry.timestamp);

            const row = document.createElement('div');
            row.className = 'flex items-start gap-1';

            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.dataset.role = 'import-history-open';
            openBtn.className = 'flex-1 min-w-0 text-left px-2.5 py-2 rounded-lg border border-border-subtle bg-surface-1 hover:border-primary hover:bg-bg-hover transition-colors';
            openBtn.addEventListener('click', () => this.openImportHistoryEntry(entry));

            const metaRow = document.createElement('div');
            metaRow.className = 'flex flex-wrap items-start justify-between gap-2';

            const statusBadge = document.createElement('span');
            statusBadge.className = `inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toneClass}`;
            statusBadge.textContent = statusLabel;

            const timeMeta = document.createElement('span');
            timeMeta.className = 'editor-import-history-meta text-[10px]';
            timeMeta.title = timeLabel;
            timeMeta.textContent = timeLabel;

            metaRow.append(statusBadge, timeMeta);

            const titleEl = document.createElement('p');
            titleEl.className = 'editor-import-history-title mt-1 text-[11px] font-semibold text-text-main';
            titleEl.textContent = location;

            const summaryEl = document.createElement('p');
            summaryEl.className = 'editor-import-history-summary mt-0.5 text-[10px]';
            summaryEl.textContent = summary;

            openBtn.append(metaRow, titleEl, summaryEl);

            const dismissBtn = document.createElement('button');
            dismissBtn.type = 'button';
            dismissBtn.dataset.role = 'import-history-dismiss';
            dismissBtn.dataset.historyIndex = String(entry.historyIndex);
            dismissBtn.className = 'h-8 w-8 mt-1 inline-flex items-center justify-center rounded-lg border border-border-subtle bg-surface-1 text-text-disabled hover:text-text-main hover:border-border-strong hover:bg-bg-hover transition-colors';
            dismissBtn.title = wt('db.k030', 'Убрать из истории импорта');
            dismissBtn.setAttribute('aria-label', wt('db.k031', 'Убрать из истории импорта'));
            dismissBtn.innerHTML = '<span class="material-symbols-outlined text-[17px]">close</span>';
            dismissBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.dismissImportHistoryEntry(entry.historyIndex);
            });

            row.append(openBtn, dismissBtn);
            list.appendChild(row);
        });

        const openImportBtn = document.createElement('button');
        openImportBtn.type = 'button';
        openImportBtn.className = 'w-full mt-1 text-left px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface-1 text-[11px] font-semibold text-text-secondary hover:text-primary hover:border-primary hover:bg-bg-hover transition-colors';
        openImportBtn.textContent = wt('db.k032', 'Открыть импорт заданий');
        openImportBtn.addEventListener('click', () => this.showImportModal());
        list.appendChild(openImportBtn);

        section.appendChild(list);
        return section;
    }

    createRecoverySummarySection(title, drafts = []) {
        const section = document.createElement('div');
        section.className = 'mb-3';

        const heading = document.createElement('div');
        heading.className = 'text-[10px] font-bold uppercase tracking-wider text-text-disabled mb-2 px-1';
        heading.textContent = title;
        section.appendChild(heading);

        const taskCount = drafts.filter((item) => item && item.kind === 'task').length;
        const complexCount = Math.max(0, drafts.length - taskCount);
        const latestTimestamp = Number(drafts[0]?.timestamp || 0);
        const latestLabel = latestTimestamp > 0 ? this.formatRecoveryTime(latestTimestamp) : wt('db.k033', 'н/д');

        const list = document.createElement('div');
        list.className = 'space-y-1';

        const summaryBtn = document.createElement('button');
        summaryBtn.type = 'button';
        summaryBtn.dataset.role = 'recovery-shortcut-open';
        summaryBtn.className = 'w-full text-left px-2.5 py-2 rounded-lg border border-border-subtle bg-surface-1 hover:border-primary hover:bg-bg-hover transition-colors';
        summaryBtn.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-text-main">
                    <span class="material-symbols-outlined text-[15px] text-text-disabled">history</span>
                    ${wt('db.k034', 'Черновики:')} ${this.escapeHtml(String(drafts.length))}
                </span>
                <span class="editor-recovery-meta text-[10px]">${wt('db.k035', 'последний')} ${this.escapeHtml(latestLabel)}</span>
            </div>
            <p class="editor-recovery-meta mt-1 text-[10px]">${wt('db.k036', 'задач')} ${taskCount} ${wt('db.k037', 'В· комплексов')} ${complexCount}</p>
        `;
        summaryBtn.addEventListener('click', () => this.showRecoveryCenter());
        list.appendChild(summaryBtn);

        const taskLookup = new Map(
            this.collectAllTasks().map((task) => [
                this.makeTaskUniqueId(task.moduleId, task.topicId, task.id),
                task,
            ])
        );
        drafts.slice(0, 2).forEach((item) => {
            let label = wt('db.k038', 'Черновик');
            let subtitle = '';
            if (item.kind === 'task') {
                const uniqueId = this.makeTaskUniqueId(item.moduleId, item.topicId, item.taskId);
                const task = taskLookup.get(uniqueId);
                label = task?.name || item.taskId || wt('db.k039', 'Черновик задания');
                subtitle = [task?.moduleName || item.moduleId, task?.topicName || item.topicId].filter(Boolean).join(' / ');
            } else {
                label = item.complexId && item.complexId !== 'new'
                    ? `${wt('db.k040', 'Комплекс:')} ${item.complexId}`
                    : wt('db.k041', 'Черновик комплекса');
                subtitle = wt('db.k042', 'Конструктор комплексов');
            }

            const row = document.createElement('button');
            row.type = 'button';
            row.dataset.role = 'recovery-shortcut-entry';
            row.className = 'w-full text-left px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface-1 text-[11px] text-text-secondary hover:text-primary hover:border-primary hover:bg-bg-hover transition-colors';
            row.innerHTML = `
                <div class="editor-recovery-title font-semibold text-text-main">${this.escapeHtml(label)}</div>
                <div class="editor-recovery-subtitle text-[10px]">${this.escapeHtml(subtitle || wt('db.k043', 'Черновик восстановления'))}</div>
            `;
            row.addEventListener('click', () => this.openRecoveryDraft(item));
            list.appendChild(row);
        });

        section.appendChild(list);
        return section;
    }

    updateRecoveryCenterTrigger(drafts = null) {
        const trigger = document.querySelector('[data-role="open-recovery-center"]');
        if (!trigger) return;

        const allDrafts = Array.isArray(drafts) ? drafts : this.getVisibleRecoveryDrafts();
        const total = allDrafts.length;
        let badge = trigger.querySelector('[data-role="recovery-draft-count"]');
        if (total <= 0) {
            trigger.removeAttribute('data-has-recovery');
            trigger.title = wt('db.k044', 'Черновики комплексов и отдельные черновики заданий');
            if (badge) badge.remove();
            return;
        }

        if (!badge) {
            badge = document.createElement('span');
            badge.dataset.role = 'recovery-draft-count';
            badge.className = 'inline-flex min-w-[18px] h-[18px] px-1 items-center justify-center rounded-full border border-warning-light bg-warning-lighter text-warning-darker text-[10px] font-bold';
            trigger.appendChild(badge);
        }

        const taskCount = allDrafts.filter((item) => item && item.kind === 'task').length;
        const complexCount = Math.max(0, total - taskCount);
        badge.textContent = total > 99 ? '99+' : String(total);
        trigger.dataset.hasRecovery = 'true';
        trigger.title = `${wt('db.k045', 'Отдельные черновики:')} ${total} (${wt('db.k046', 'заданий')} ${taskCount}, ${wt('db.k047', 'комплексов')} ${complexCount})`;
    }

    updateTheoryHubTrigger(summary = null) {
        const trigger = document.querySelector('[data-role="open-theory-hub"]');
        if (!trigger) return;

        const payload = summary && typeof summary === 'object' ? summary : this.theoryHubState?.summary;
        const queueCount = Number(payload?.queueCount || 0);
        const conflictCount = Number(payload?.conflictCount || 0);

        let badge = trigger.querySelector('[data-role="theory-hub-queue-count"]');
        if (queueCount <= 0) {
            trigger.removeAttribute('data-has-theory-queue');
            trigger.title = wt('db.k048', 'Центр теории');
            if (badge) badge.remove();
            return;
        }

        if (!badge) {
            badge = document.createElement('span');
            badge.dataset.role = 'theory-hub-queue-count';
            badge.className = 'inline-flex min-w-[18px] h-[18px] px-1 items-center justify-center rounded-full border text-[10px] font-bold';
            trigger.appendChild(badge);
        }

        const isConflictHeavy = conflictCount > 0;
        badge.classList.remove(
            'border-warning-light',
            'bg-warning-lighter',
            'text-warning-darker',
            'border-error-light',
            'bg-error-lighter',
            'text-error-text'
        );
        if (isConflictHeavy) {
            badge.classList.add('border-error-light', 'bg-error-lighter', 'text-error-text');
        } else {
            badge.classList.add('border-warning-light', 'bg-warning-lighter', 'text-warning-darker');
        }

        badge.textContent = queueCount > 99 ? '99+' : String(queueCount);
        trigger.dataset.hasTheoryQueue = 'true';
        trigger.title = `${wt('db.k049', 'Центр теории: изменений')} ${queueCount}, ${wt('db.k050', 'подборок')} ${conflictCount}`;
    }

    loadDashboardState() {
        try {
            const stored = localStorage.getItem('editorDashboardState');
            if (stored) {
                const state = JSON.parse(stored);
                this.expandedState = state.expanded || { modules: [], topics: [] };
                this.normalizeExpandedState();

                // Return saved view for init
                return state.lastView || null;
            }
        } catch (e) {
            console.warn('Failed to load dashboard state', e);
        }
        return null;
    }

    getCurrentTheme() {
        return document.documentElement.dataset.theme || 'light-b';
    }

    isCurrentThemeDark() {
        return this.getCurrentTheme().startsWith('dark');
    }

    setupThemeListener() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'data-theme') {
                    // Re-render grid to update badge contrast
                    // We only re-render if we are currently viewing the grid
                    this.renderGrid(this.currentTasks); // Optimization: keep current tasks if possible, but renderGrid usually takes all tasks or filtered. 
                    // Since we don't store "currentTasks" explicitly for re-render in that way, we can call refreshCurrentView
                    this.refreshCurrentView();
                }
            });
        });
        observer.observe(document.documentElement, { attributes: true });
    }

    saveDashboardState() {
        try {
            const state = JSON.parse(localStorage.getItem('editorDashboardState') || '{}');
            this.normalizeExpandedState();
            state.expanded = this.expandedState;
            state.lastView = {
                moduleId: this.activeModuleId,
                topicId: this.activeTopicId
            };
            localStorage.setItem('editorDashboardState', JSON.stringify(state));
        } catch (e) {
            console.warn('Failed to save dashboard state', e);
        }
    }

    normalizeExpandedState() {
        const modules = Array.isArray(this.expandedState?.modules) ? this.expandedState.modules : [];
        const topics = Array.isArray(this.expandedState?.topics) ? this.expandedState.topics : [];
        this.expandedState = {
            modules: Array.from(new Set(modules.map((value) => String(value || '').trim()).filter(Boolean))),
            topics: Array.from(new Set(topics.map((value) => String(value || '').trim()).filter(Boolean))),
        };
        return this.expandedState;
    }

    getTopicExpandedStateKey(moduleId, topicId) {
        if (!moduleId || !topicId) return '';
        return `${moduleId}:${topicId}`;
    }

    ensureModuleExpandedState(moduleId, { save = true } = {}) {
        const normalizedId = String(moduleId || '').trim();
        if (!normalizedId) return false;
        this.normalizeExpandedState();
        if (this.expandedState.modules.includes(normalizedId)) return false;
        this.expandedState.modules.push(normalizedId);
        if (save) this.saveDashboardState();
        return true;
    }

    ensureTopicExpandedState(moduleId, topicId, { save = true } = {}) {
        const topicKey = this.getTopicExpandedStateKey(moduleId, topicId);
        if (!topicKey) return false;
        this.normalizeExpandedState();
        if (this.expandedState.topics.includes(topicKey)) return false;
        this.expandedState.topics.push(topicKey);
        if (save) this.saveDashboardState();
        return true;
    }

    removeModuleExpandedState(moduleId, { save = true, includeTopics = false } = {}) {
        const normalizedId = String(moduleId || '').trim();
        if (!normalizedId) return false;
        this.normalizeExpandedState();
        const nextModules = this.expandedState.modules.filter((id) => id !== normalizedId);
        const nextTopics = includeTopics
            ? this.expandedState.topics.filter((key) => !key.startsWith(`${normalizedId}:`))
            : this.expandedState.topics;
        const changed = nextModules.length !== this.expandedState.modules.length
            || nextTopics.length !== this.expandedState.topics.length;
        if (!changed) return false;
        this.expandedState.modules = nextModules;
        this.expandedState.topics = nextTopics;
        if (save) this.saveDashboardState();
        return true;
    }

    removeTopicExpandedState(moduleId, topicId, { save = true } = {}) {
        const topicKey = this.getTopicExpandedStateKey(moduleId, topicId);
        if (!topicKey) return false;
        this.normalizeExpandedState();
        const nextTopics = this.expandedState.topics.filter((key) => key !== topicKey);
        if (nextTopics.length === this.expandedState.topics.length) return false;
        this.expandedState.topics = nextTopics;
        if (save) this.saveDashboardState();
        return true;
    }

    pruneExpandedState({ save = true } = {}) {
        this.normalizeExpandedState();
        const moduleIds = new Set((this.catalog || []).map((module) => String(module?.id || '').trim()).filter(Boolean));
        const topicIds = new Set();
        (this.catalog || []).forEach((module) => {
            const moduleId = String(module?.id || '').trim();
            (module?.topics || []).forEach((topic) => {
                const topicId = String(topic?.id || '').trim();
                if (moduleId && topicId) {
                    topicIds.add(this.getTopicExpandedStateKey(moduleId, topicId));
                }
            });
        });

        const nextModules = this.expandedState.modules.filter((id) => moduleIds.has(id));
        const nextTopics = this.expandedState.topics.filter((key) => topicIds.has(key));
        const changed = nextModules.length !== this.expandedState.modules.length
            || nextTopics.length !== this.expandedState.topics.length;

        this.expandedState.modules = nextModules;
        this.expandedState.topics = nextTopics;
        if (changed && save) this.saveDashboardState();
        return changed;
    }

    updateUrlState() {
        if (this.onboardingDemoActive) return;
        const params = new URLSearchParams();
        if (this.activeModuleId) params.set('module', this.activeModuleId);
        if (this.activeTopicId) params.set('topic', this.activeTopicId);
        if (this.currentSort) params.set('sort', this.currentSort);
        if (this.showPremiumArchiveTasks) params.set('archive', 'premium');

        const url = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
        history.replaceState(null, '', url);
        this.saveDashboardState();
    }

    async loadCatalog() {
        if (this.onboardingDemoActive) {
            this.onboardingDemoCatalogLoadSkipped = true;
            return;
        }
        this.log("Fetching catalog from /api/editor/catalog...");
        try {
            const response = await fetch('/api/editor/catalog');
            this.log(`Response status: ${response.status}`);

            if (!response.ok) {
                this.log(`HTTP Error: ${response.status} ${response.statusText}`);
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (this.onboardingDemoActive) {
                this.onboardingDemoCatalogLoadSkipped = true;
                return;
            }
            if (data.ok) {
                this.catalog = this.cleanCatalog(data.modules);
                this.log(`Catalog loaded: ${this.catalog ? this.catalog.length : 0} modules`);
                if (!this.catalog || this.catalog.length === 0) {
                    this.log("WARNING: Catalog is empty.");
                }
                this.pruneExpandedState();
                this.renderSidebar(); // Moved here to ensure catalog is loaded before rendering sidebar
                this.applyPendingInitialView();
                await this.applyPendingTheoryHubIntent();
                this.applyPendingMicrocardsManualIntent();
                this.loadWorkspaceLimits(); // Reload limits/counter automatically when catalog updates!
            } else {
                this.log(`Server returned error: ${data.error}`);
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k051', 'Каталог редактора не загружен.'),
                    impact: wt('db.k052', 'Модули и темы сейчас недоступны.'),
                    next: data.error ? `${wt('db.k053', 'Детали:')} ${data.error}. ${wt('db.k054', 'Повторите загрузку.')}` : wt('db.k055', 'Проверьте соединение и повторите попытку.'),
                });
            }
        } catch (error) {
            this.log(`FETCH ERROR: ${error.message}`);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k056', 'Каталог редактора не загружен из-за сетевой ошибки.'),
                impact: wt('db.k057', 'Текущая структура библиотеки недоступна.'),
                next: error?.message ? `${wt('db.k058', 'Проверьте сеть')} (${error.message}) ${wt('db.k059', 'и повторите загрузку.')}` : wt('db.k060', 'Проверьте сеть и повторите загрузку.'),
            });
        }
    }

    applyPendingInitialView() {
        const pending = this.pendingInitialView;
        this.pendingInitialView = null;

        if (!pending) {
            this.refreshCurrentView();
            return;
        }

        const module = (this.catalog || []).find((item) => item?.id === pending.moduleId);
        if (!module) {
            this.activeModuleId = null;
            this.activeTopicId = null;
            this.renderGrid();
            return;
        }

        if (pending.topicId) {
            const topic = (module.topics || []).find((item) => item?.id === pending.topicId);
            if (topic) {
                this.renderTopicTasks(module.id, topic.id);
                return;
            }
        }

        if (pending.moduleId) {
            this.renderModuleTopics(module.id);
            return;
        }

        this.renderGrid();
    }

    applyPendingMicrocardsManualIntent() {
        if (!this.pendingMicrocardsManual) return;
        this.pendingMicrocardsManual = false;
        this.showMicrocardsManualEditor();
    }

    showMicrocardsManualEditor() {
        if (!this.importManager) return;
        this.showTheoryAnalysisModal('microcards_manual');
    }

    captureTheoryHubDeepLinkFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const openHub = String(params.get('theory_hub') || '').trim() === '1';
            if (!openHub) return;
            this.pendingTheoryHubOpen = true;
            this.pendingTheoryHubFocusId = String(params.get('theory_id') || '').trim();
        } catch (error) {
            console.warn('[Dashboard] Failed to parse theory hub deep link', error);
        }
    }

    async applyPendingTheoryHubIntent() {
        if (!this.pendingTheoryHubOpen) return;
        this.pendingTheoryHubOpen = false;
        this.navigateToTheoryCenter({
            scope: 'complexes',
            query: this.pendingTheoryHubFocusId || '',
        });
        this.pendingTheoryHubFocusId = '';
    }

    setupEventListeners() {
        const addBtn = document.querySelector('[data-role="create-task-card"]');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.showCreateTaskModal();
            });
        }

        const searchInput = document.querySelector('#editor-search-input');
        if (searchInput) {
            const handler = this.debounce((event) => {
                this.handleSearch(event.target.value);
            }, 200);
            searchInput.addEventListener('input', handler);
            searchInput.addEventListener('search', handler);
            this.debouncedSearchHandler = handler;
        }

        const archiveFilter = document.getElementById('editor-archive-filter');
        if (archiveFilter) {
            archiveFilter.addEventListener('click', () => {
                this.showPremiumArchiveTasks = !this.showPremiumArchiveTasks;
                this.selectedTasks.clear();
                this.lastSelectedTaskId = null;
                this.updateActionBar();
                this.renderTaskLimitUi();
                this.refreshCurrentView();
            });
        }

        const backBtn = document.querySelector('[data-role="return-main"]');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                window.navigateWithTransition('/main');
            });
        }



        const recoveryBtn = document.querySelector('[data-role="open-recovery-center"]');
        if (recoveryBtn) {
            recoveryBtn.addEventListener('click', () => this.showRecoveryCenter());
        }

        const recoveryCloseBtn = document.querySelector('[data-role="close-recovery-center"]');
        if (recoveryCloseBtn) {
            recoveryCloseBtn.addEventListener('click', () => this.closeRecoveryCenter());
        }

        const recoveryModal = document.getElementById('recovery-center-modal');
        if (recoveryModal) {
            recoveryModal.addEventListener('click', (event) => {
                if (event.target === recoveryModal) {
                    this.closeRecoveryCenter();
                }
            });
        }

        this.setupSortControls();
        this.setupSelectionControls(); // Add selection controls
        this.setupSidebarResizer();
        this.setupTopicTheoryModalControls();
        this.setupTheoryHubControls();
        this.updateRecoveryCenterTrigger();
        this.updateTheoryHubTrigger();
    }

    setupSelectionControls() {
        // Find or create Action Bar
        let actionBar = document.getElementById('selection-action-bar');
        if (!actionBar) {
            actionBar = document.createElement('div');
            actionBar.id = 'selection-action-bar';
            actionBar.className = 'fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-surface-1 rounded-xl shadow-2xl border border-border-subtle p-2 flex items-center gap-3 z-50 transition-all duration-300 translate-y-[200%]';
            actionBar.innerHTML = `
                <div class="px-3 font-semibold text-text-secondary border-r border-border-subtle" id="selection-counter">0 ${wt('db.k061', 'выбрано')}</div>
                <button data-role="selection-select-all" onclick="dashboard.selectAllVisibleTasks()" class="flex items-center gap-2 px-4 py-2 bg-surface-2 text-text-secondary rounded-lg hover:bg-bg-hover transition-colors font-medium">
                    <span class="material-symbols-outlined">select_all</span>
                    ${wt('db.k062', 'Все')}
                </button>
                <div class="w-px h-6 bg-border-subtle"></div>
                <button data-role="selection-export" onclick="dashboard.exportSelectedTasks()" class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-contrast rounded-lg hover:bg-primary-dark transition-colors font-medium">
                    <span class="material-symbols-outlined">archive</span>
                    ${wt('db.k063', 'Экспорт')}
                </button>
                <button data-role="selection-delete" onclick="dashboard.deleteSelectedTasks()" class="flex items-center gap-2 px-4 py-2 bg-error-lighter text-error-dark border border-error-light rounded-lg hover:bg-error-light transition-colors font-medium">
                    <span class="material-symbols-outlined">delete</span>
                    ${wt('db.k064', 'Удалить')}
                </button>
                <div class="w-px h-6 bg-border-subtle"></div>
                <button data-role="selection-cancel" onclick="dashboard.cancelSelection()" class="p-2 text-text-disabled hover:text-text-muted hover:bg-bg-hover rounded-lg" title="${wt('db.k065', 'Отмена')}">
                    <span class="material-symbols-outlined">close</span>
                </button>
            `;
            document.body.appendChild(actionBar);
        }

        // Add "Select" button to header if exists
        const headerActions = document.querySelector('header .flex.items-center.gap-3');
        if (headerActions && !document.getElementById('toggle-select-btn')) {
            const btn = document.createElement('button');
            btn.id = 'toggle-select-btn';
            btn.dataset.role = 'selection-toggle';
            btn.className = 'p-2 text-text-disabled hover:text-primary hover:bg-bg-hover rounded-lg transition-colors';
            btn.title = wt('db.k066', 'Выбор заданий');
            btn.onclick = () => this.toggleSelectionMode();
            btn.innerHTML = '<span class="material-symbols-outlined">checklist</span>';
            // Insert before the last element (usually profile/settings)
            headerActions.insertBefore(btn, headerActions.firstChild);
        }
    }

    setupSidebarResizer() {
        const resizer = document.getElementById('sidebar-resizer');
        const sidebar = document.getElementById('editor-sidebar');
        const overlay = document.getElementById('sidebar-blur-overlay');
        const modal = document.getElementById('sidebar-delete-modal');
        if (!resizer || !sidebar) return;

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            resizer.classList.add('is-resizing');
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            e.preventDefault();
        });

        const handleMouseMove = (e) => {
            if (!isResizing) return;
            let newWidth = e.clientX;

            // Constrain width
            if (newWidth < 160) newWidth = 160;
            if (newWidth > 600) newWidth = 600;

            document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
            if (overlay) overlay.style.width = newWidth + 'px';
            if (modal) modal.style.width = newWidth + 'px';
        };

        const handleMouseUp = () => {
            if (!isResizing) return;
            isResizing = false;
            document.body.style.cursor = '';
            resizer.classList.remove('is-resizing');
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            // Save to localStorage
            const finalWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
            localStorage.setItem('editorSidebarWidth', finalWidth);
        };
    }

    setupSortControls() {
        this.sortControllerEl = document.querySelector('[data-role="sort-controller"]');
        if (!this.sortControllerEl) return;

        this.sortToggleEl = this.sortControllerEl.querySelector('[data-role="sort-toggle"]');
        this.sortMenuEl = this.sortControllerEl.querySelector('[data-role="sort-menu"]');
        this.sortLabelEl = this.sortControllerEl.querySelector('[data-role="sort-label"]');

        if (this.sortToggleEl) {
            this.sortToggleEl.addEventListener('click', (event) => {
                event.stopPropagation();
                if (!this.sortMenuEl) return;
                const isHidden = this.sortMenuEl.classList.contains('hidden');
                if (isHidden) {
                    this.openSortMenu();
                } else {
                    this.closeSortMenu();
                }
            });
        }

        if (this.sortMenuEl) {
            this.sortMenuEl.querySelectorAll('[data-sort-option]').forEach(button => {
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const option = button.getAttribute('data-sort-option');
                    if (!option) return;
                    if (this.currentSort === option) {
                        this.closeSortMenu();
                        return;
                    }
                    this.currentSort = option;
                    this.updateSortLabel();
                    this.updateSortMenuChecks();
                    this.closeSortMenu();
                    this.refreshCurrentView();
                });
            });
        }

        this.updateSortLabel();
        this.updateSortMenuChecks();
    }

    openSortMenu() {
        if (!this.sortMenuEl) return;
        this.sortMenuEl.classList.remove('hidden');
        if (!this.boundSortOutsideHandler) {
            this.boundSortOutsideHandler = (event) => {
                if (!this.sortControllerEl?.contains(event.target)) {
                    this.closeSortMenu();
                }
            };
        }
        document.addEventListener('click', this.boundSortOutsideHandler, { once: false });
    }

    closeSortMenu() {
        if (!this.sortMenuEl) return;
        this.sortMenuEl.classList.add('hidden');
        if (this.boundSortOutsideHandler) {
            document.removeEventListener('click', this.boundSortOutsideHandler);
        }
    }

    updateSortLabel() {
        if (!this.sortLabelEl) return;
        this.sortLabelEl.textContent = this.sortLabels[this.currentSort] || '';
    }

    syncSidebarSelection() {
        document.querySelectorAll('[data-onboarding-target="editor-active-topic"]').forEach((node) => {
            node.removeAttribute('data-onboarding-target');
        });
        if (!this.activeModuleId && !this.activeTopicId) {
            document.querySelectorAll('[data-module-button], [data-topic-button]').forEach(btn => {
                btn.classList.remove('bg-primary-lighter', 'text-primary');
            });
            const allTasksBtn = document.querySelector('[data-role="all-tasks"]');
            if (allTasksBtn) allTasksBtn.classList.add('bg-primary-lighter', 'text-primary');
            return;
        }

        document.querySelectorAll('[data-module-button]').forEach(btn => {
            const moduleId = btn.getAttribute('data-module-id') || btn.dataset.moduleButton;
            const isActive = moduleId === this.activeModuleId;
            btn.classList.toggle('bg-primary-lighter', isActive);
            btn.classList.toggle('text-primary', isActive);
            if (isActive) {
                btn.classList.remove('text-text-secondary');
            } else {
                btn.classList.add('text-text-secondary');
            }
        });

        document.querySelectorAll('[data-topic-button]').forEach(btn => {
            const topicId = btn.getAttribute('data-topic-id') || btn.dataset.topicButton;
            const isActive = topicId === this.activeTopicId;
            btn.classList.toggle('bg-primary-lighter', isActive);
            btn.classList.toggle('text-primary', isActive);
            if (isActive) {
                btn.classList.remove('text-text-secondary');
                btn.setAttribute('data-onboarding-target', 'editor-active-topic');
            } else {
                btn.classList.add('text-text-secondary');
            }
        });

        const allTasksBtn = document.querySelector('[data-role="all-tasks"]');
        if (allTasksBtn) {
            const isActive = !this.activeModuleId && !this.activeTopicId && !this.currentSearchQuery;
            allTasksBtn.classList.toggle('bg-primary-lighter', isActive);
            allTasksBtn.classList.toggle('text-primary', isActive);
        }
    }

    updateHeaderBreadcrumbs() {
        const nav = document.querySelector('#header-breadcrumbs');
        if (!nav) return;

        nav.innerHTML = '';

        // Root Level
        const root = document.createElement('span');
        root.className = 'editor-breadcrumb-link';
        root.textContent = wt('db.k067', 'Библиотека');
        root.onclick = () => this.renderAllTasks();
        nav.appendChild(root);

        // Module Level
        if (this.activeModuleId) {
            const separator1 = document.createElement('span');
            separator1.className = 'editor-breadcrumb-separator';
            separator1.textContent = '›';
            nav.appendChild(separator1);

            const module = this.catalog.find(m => m.id === this.activeModuleId);
            const moduleName = module ? (module.name || module.id) : this.activeModuleId;
            const moduleSpan = document.createElement('span');
            moduleSpan.className = 'editor-breadcrumb-link truncate anim-scale-in';
            moduleSpan.textContent = moduleName;
            moduleSpan.title = moduleName;
            moduleSpan.onclick = () => this.renderModuleTopics(this.activeModuleId);
            nav.appendChild(moduleSpan);

            // Topic Level
            if (this.activeTopicId) {
                const separator2 = document.createElement('span');
                separator2.className = 'editor-breadcrumb-separator shrink-0 anim-scale-in';
                separator2.textContent = '›';
                nav.appendChild(separator2);

                const topic = (module?.topics || []).find(t => t.id === this.activeTopicId);
                const topicName = topic ? (topic.name || topic.id) : this.activeTopicId;
                const topicSpan = document.createElement('span');
                topicSpan.className = 'editor-breadcrumb-current truncate anim-scale-in';
                topicSpan.textContent = topicName;
                topicSpan.title = topicName;
                nav.appendChild(topicSpan);
            }
        }
    }

    updateSortMenuChecks() {
        if (!this.sortMenuEl) return;
        this.sortMenuEl.querySelectorAll('[data-sort-option]').forEach(btn => {
            const option = btn.getAttribute('data-sort-option');
            const icon = btn.querySelector('[data-role="sort-check"]');
            const isActive = option === this.currentSort;
            btn.classList.toggle('bg-primary-lighter', isActive);
            btn.classList.toggle('text-primary', isActive);
            if (icon) {
                icon.classList.toggle('opacity-0', !isActive);
                icon.classList.toggle('opacity-100', isActive);
            }
        });
    }

    showCreateTaskModal() {
        const modal = document.querySelector('#create-task-modal');
        if (!modal) return;

        // Populate modules
        const moduleSelect = document.querySelector('#task-module-select');
        moduleSelect.innerHTML = wt('db.k068', '<option value="">Выберите модуль...</option>');
        this.catalog.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name || m.id;
            moduleSelect.appendChild(opt);
        });

        // Listen for module change to update topics
        moduleSelect.onchange = () => this.updateTopicSelect();

        if (this.activeModuleId) {
            moduleSelect.value = this.activeModuleId;
            this.updateTopicSelect();
            const topicSelect = document.querySelector('#task-topic-select');
            if (this.activeTopicId) {
                topicSelect.value = this.activeTopicId;
            }
        } else {
            this.updateTopicSelect();
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        const modalContent = modal.querySelector('.bg-surface-1');
        if (modalContent) modalContent.classList.add('animate-scale-in');
        if (!this.onboardingDemoActive && this.isTaskCreationBlocked()) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k069', 'Лимит заданий достигнут.'),
                impact: this.getTaskDraftNotice() || wt('db.k070', 'Новый черновик открыть можно, но сохранить его пока не получится.'),
                next: wt('db.k071', 'Освободите слот или перейдите на Premium.'),
                timeout: 4800,
            });
        }
    }

    updateTopicSelect() {
        const moduleSelect = document.querySelector('#task-module-select');
        const topicSelect = document.querySelector('#task-topic-select');
        const module_id = moduleSelect.value;

        topicSelect.innerHTML = wt('db.k072', '<option value="">Выберите тему...</option>');
        if (!module_id) return;

        const module = this.catalog.find(m => m.id === module_id);
        if (module && module.topics) {
            module.topics.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name || t.id;
                topicSelect.appendChild(opt);
            });
        }
    }

    closeModals() {
        ['create-task-modal', 'create-module-modal', 'create-topic-modal', 'topic-theory-modal', 'theory-hub-modal', 'import-modal'].forEach(id => {
            if (id === 'topic-theory-modal') {
                const theoryModal = document.getElementById('topic-theory-modal');
                if (theoryModal && (!theoryModal.classList.contains('hidden') || theoryModal.open)) {
                    this.closeTopicTheoryModal();
                }
                return;
            }
            if (id === 'theory-hub-modal') {
                const theoryHubModal = document.getElementById('theory-hub-modal');
                if (theoryHubModal && (!theoryHubModal.classList.contains('hidden') || theoryHubModal.open)) {
                    this.closeTheoryHub();
                }
                return;
            }
            if (id === 'import-modal') {
                const importModal = document.getElementById('import-modal');
                if (importModal && (!importModal.classList.contains('hidden') || importModal.open)) {
                    this.closeImportModal();
                }
                return;
            }
            const m = document.getElementById(id);
            if (!m) return;
            const content = m.querySelector('.bg-surface-1, .bg-card-light');
            if (content) {
                content.classList.remove('animate-scale-in');
            }
            if (m.close) {
                try {
                    m.close();
                } catch (e) {
                    console.warn('[Dashboard] Failed to close dialog natively:', e);
                }
            } else {
                m.classList.add('hidden');
                m.classList.remove('flex');
            }
        });
    }

    async submitTaskForm() {
        const module_id = document.querySelector('#task-module-select').value;
        const topic_id = document.querySelector('#task-topic-select').value;
        const task_name = document.querySelector('#task-name-input').value.trim();
        const task_type = document.querySelector('#task-type-select').value;

        if (!module_id) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k073', 'Создание задания приостановлено.'),
                impact: wt('db.k074', 'Модуль не выбран.'),
                next: wt('db.k075', 'Выберите модуль и повторите действие.'),
            });
            return;
        }
        if (!topic_id) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k076', 'Создание задания приостановлено.'),
                impact: wt('db.k077', 'Тема не выбрана.'),
                next: wt('db.k078', 'Выберите тему и повторите действие.'),
            });
            return;
        }
        if (!task_name) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k079', 'Создание задания приостановлено.'),
                impact: wt('db.k080', 'Название задания пустое.'),
                next: wt('db.k081', 'Введите название и повторите действие.'),
            });
            return;
        }

        await this.createNewTask(module_id, topic_id, task_name, task_type);
        document.querySelector('#task-name-input').value = '';
        this.closeModals();
    }

    // Module Creation
    showModuleModal() {
        const modal = document.querySelector('#create-module-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        const content = modal.querySelector('.bg-surface-1');
        if (content) content.classList.add('animate-scale-in');
    }

    closeModuleModal() {
        const modal = document.querySelector('#create-module-modal');
        if (!modal) return;
        const content = modal.querySelector('.bg-surface-1');
        if (content) content.classList.remove('animate-scale-in');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    async submitModuleForm() {
        const name = document.querySelector('#module-name-input').value.trim();
        if (!name) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k082', 'Создание модуля приостановлено.'),
                impact: wt('db.k083', 'Название модуля пустое.'),
                next: wt('db.k084', 'Введите название и повторите действие.'),
            });
            return;
        }

        try {
            const response = await fetch('/api/editor/module/new', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await response.json();
            if (data.ok) {
                await this.loadCatalog();
                this.renderSidebar();
                document.querySelector('#module-name-input').value = '';
                this.closeModuleModal();
                // Update module select in task modal if it was open
                if (!document.querySelector('#create-task-modal').classList.contains('hidden')) {
                    this.showCreateTaskModal();
                }
            } else {
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k085', 'Модуль не создан.'),
                    impact: wt('db.k086', 'Изменения не были применены.'),
                    next: data?.error ? `${wt('db.k087', 'Проверьте данные')} (${data.error}) ${wt('db.k088', 'и повторите.')}` : wt('db.k089', 'Проверьте данные и повторите создание.'),
                });
            }
        } catch (err) {
            console.error(err);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k090', 'Модуль не создан из-за сетевой ошибки.'),
                impact: wt('db.k091', 'Список модулей остался без изменений.'),
                next: wt('db.k092', 'Проверьте сеть и повторите действие.'),
            });
        }
    }

    // Topic Creation
    showTopicModal(moduleId = null) {
        let module_id = moduleId;
        if (!module_id) {
            module_id = document.querySelector('#task-module-select').value;
        }

        if (!module_id) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k093', 'Создание темы приостановлено.'),
                impact: wt('db.k094', 'Модуль не выбран.'),
                next: wt('db.k095', 'Сначала выберите модуль, затем создайте тему.'),
            });
            return;
        }

        // Update task-module-select if it differs, to keep UI in sync
        const moduleSelect = document.querySelector('#task-module-select');
        if (moduleSelect && moduleSelect.value !== module_id) {
            moduleSelect.value = module_id;
            this.updateTopicSelect();
        }

        const module = this.catalog.find(m => m.id === module_id);
        const modal = document.querySelector('#create-topic-modal');
        const select = modal.querySelector('#topic-module-select');
        select.innerHTML = `<option value="${module_id}">${module.name || module_id}</option>`;

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        const content = modal.querySelector('.bg-surface-1');
        if (content) content.classList.add('animate-scale-in');
    }

    closeTopicModal() {
        const modal = document.querySelector('#create-topic-modal');
        if (!modal) return;
        const content = modal.querySelector('.bg-surface-1');
        if (content) content.classList.remove('animate-scale-in');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    getTopicRow(moduleId, topicId) {
        if (!moduleId || !topicId) return null;
        const module = this.catalog.find((m) => m.id === moduleId);
        if (!module) return null;
        return (module.topics || []).find((topic) => topic.id === topicId) || null;
    }

    normalizeTheoryRelation(value) {
        return String(value || '').trim().toLowerCase() === 'copy' ? 'copy' : 'link';
    }

    buildTheoryEditorUrl(theoryId, options = {}) {
        const normalizedTheoryId = String(theoryId || '').trim();
        const url = new URL('/editor/Theory_Editor.html', window.location.origin);
        if (normalizedTheoryId) {
            url.searchParams.set('theory_id', normalizedTheoryId);
        }

        const mapping = {
            context: 'context',
            moduleId: 'module_id',
            topicId: 'topic_id',
            moduleName: 'module_name',
            topicName: 'topic_name',
            complexId: 'complex_id',
            complexName: 'complex_name',
            returnUrl: 'return_url',
        };

        Object.entries(mapping).forEach(([sourceKey, targetKey]) => {
            const value = String(options?.[sourceKey] || '').trim();
            if (!value) return;
            url.searchParams.set(targetKey, value);
        });

        return `${url.pathname}${url.search}`;
    }

    navigateToTheoryEditor(theoryId, options = {}) {
        const url = this.buildTheoryEditorUrl(theoryId, options);
        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition(url);
            return;
        }
        window.location.href = url;
    }

    buildTheoryCenterUrl(options = {}) {
        const url = new URL('/theory-center', window.location.origin);
        const scope = String(options.scope || '').trim();
        const moduleId = String(options.moduleId || '').trim();
        const state = String(options.state || '').trim();
        const query = String(options.query || '').trim();
        if (scope) url.searchParams.set('scope', scope);
        if (moduleId) url.searchParams.set('module_id', moduleId);
        if (state) url.searchParams.set('state', state);
        if (query) url.searchParams.set('q', query);
        return `${url.pathname}${url.search}`;
    }

    navigateToTheoryCenter(options = {}) {
        const url = this.buildTheoryCenterUrl(options);
        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition(url);
            return;
        }
        window.location.href = url;
    }

    setupTopicTheoryModalControls() {
        if (this.topicTheoryModalBound) return;
        const modal = document.getElementById('topic-theory-modal');
        if (!modal) return;

        modal.querySelectorAll('[data-role="topic-theory-close"]').forEach((btn) => {
            btn.addEventListener('click', () => this.closeTopicTheoryModal());
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.closeTopicTheoryModal();
            }
        });

        const picker = document.getElementById('topic-theory-picker');
        if (picker) {
            picker.addEventListener('change', () => this.syncTopicTheoryContextActions());
        }

        const relationSelect = document.getElementById('topic-theory-relation');
        const relationHint = document.getElementById('topic-theory-relation-hint');
        if (relationSelect && relationHint) {
            const updateHint = () => {
                relationHint.textContent = relationSelect.value === 'copy'
                    ? wt('db.k096', 'Независимая копия — дальнейшие изменения в теории не попадут в комплекс.')
                    : wt('db.k097', 'Связанные комплексы-наследники обновляются автоматически в безопасном режиме.');
            };
            relationSelect.addEventListener('change', updateHint);
            updateHint();
        }

        const saveBtn = document.getElementById('topic-theory-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.submitTopicTheoryForm());
        }


        const clearBtn = document.getElementById('topic-theory-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                const picker = document.getElementById('topic-theory-picker');
                if (picker) {
                    picker.value = '';
                    this.syncTopicTheoryContextActions();
                }
            });
        }

        const createNewBtn = document.getElementById('topic-theory-create-new-btn');
        if (createNewBtn) {
            createNewBtn.addEventListener('click', () => this.createAndLinkTopicTheory());
        }

        const editContentBtn = document.getElementById('topic-theory-edit-content-btn');
        if (editContentBtn) {
            editContentBtn.addEventListener('click', () => this.openTopicTheoryEditor());
        }

        const openComplexesBtn = document.getElementById('topic-theory-open-complexes-btn');
        if (openComplexesBtn) {
            openComplexesBtn.addEventListener('click', () => this.openTopicTheoryRelatedComplexes());
        }

        const openCenterBtn = document.getElementById('topic-theory-open-center-btn');
        if (openCenterBtn) {
            openCenterBtn.addEventListener('click', () => this.openTopicTheoryCenter());
        }

        this.topicTheoryModalBound = true;
        this.syncTopicTheoryContextActions();
    }

    getTopicTheoryModalSelectedTheoryId() {
        const picker = document.getElementById('topic-theory-picker');
        return String(picker?.value || '').trim();
    }

    ensureTopicTheoryWorkspaceNote() {
        let note = document.getElementById('topic-theory-workspace-note');
        if (note) return note;

        const picker = document.getElementById('topic-theory-picker');
        const pickerBlock = picker?.closest('div');
        if (!pickerBlock || !pickerBlock.parentElement) return null;

        note = document.createElement('div');
        note.id = 'topic-theory-workspace-note';
        note.className = 'rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2';

        const text = document.createElement('p');
        text.id = 'topic-theory-workspace-note-text';
        text.className = 'text-xs text-text-secondary';
        note.appendChild(text);

        pickerBlock.insertAdjacentElement('afterend', note);
        return note;
    }

    syncTopicTheoryContextActions() {
        const theoryId = this.getTopicTheoryModalSelectedTheoryId();
        const hasTheory = !!theoryId;

        const infoBlock = document.getElementById('topic-theory-current-info');
        const emptyBlock = document.getElementById('topic-theory-empty-state');
        const titleEl = document.getElementById('topic-theory-current-title');
        const openComplexesBtn = document.getElementById('topic-theory-open-complexes-btn');
        const workspaceNote = this.ensureTopicTheoryWorkspaceNote();
        const workspaceNoteText = document.getElementById('topic-theory-workspace-note-text');

        if (infoBlock && emptyBlock) {
            infoBlock.classList.toggle('hidden', !hasTheory);
            emptyBlock.classList.toggle('hidden', hasTheory);
        }

        if (hasTheory && titleEl) {
            // Find title in catalog
            const theory = this.topicTheoryCatalog?.find(t => t.id === theoryId);
            titleEl.textContent = theory ? (theory.title || theory.id) : theoryId;
        }

        // Summary visibility
        const summaryEl = document.getElementById('topic-theory-propagation-summary');
        if (summaryEl) {
            summaryEl.classList.toggle('hidden', !String(summaryEl.textContent || '').trim());
        }

        if (openComplexesBtn) {
            openComplexesBtn.classList.toggle('hidden', !hasTheory);
            openComplexesBtn.disabled = !hasTheory;
        }

        if (workspaceNote) {
            workspaceNote.classList.remove('hidden');
        }
        if (workspaceNoteText) {
            workspaceNoteText.textContent = hasTheory
                ? wt('db.k098', 'Эта теория живет в общей библиотеке материалов. Комплексы, унаследовавшие тему, будут брать ее как основной источник.')
                : wt('db.k099', 'Теории хранятся в общей библиотеке. Вы можете выбрать готовый материал или сначала создать новую теорию.');
        }
    }

    showCreateTheoryModal(defaultTitle = '') {
        return new Promise((resolve) => {
            const modal = document.getElementById('create-theory-modal');
            const input = document.getElementById('create-theory-title-input');
            const confirmBtn = document.getElementById('create-theory-confirm-btn');
            
            if (!modal || !input || !confirmBtn) {
                resolve(null);
                return;
            }

            // Set default value
            input.value = defaultTitle;
            
            // Close handlers
            const closeModal = (result) => {
                modal.classList.add('closing');
                setTimeout(() => {
                    modal.close();
                    modal.classList.remove('closing');
                    resolve(result);
                }, 200);
            };

            // Confirm handler
            const handleConfirm = () => {
                const value = input.value.trim();
                closeModal(value || null);
            };

            // Cancel handlers
            const handleCancel = () => closeModal(null);

            // Enter key handler
            const handleKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirm();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancel();
                }
            };

            // Attach event listeners
            confirmBtn.onclick = handleConfirm;
            input.onkeydown = handleKeyDown;
            
            const closeButtons = modal.querySelectorAll('[data-role="create-theory-close"]');
            closeButtons.forEach(btn => btn.onclick = handleCancel);

            // Show modal
            modal.showModal();
            setTimeout(() => input.focus(), 100);

            // Cleanup on close
            modal.addEventListener('close', () => {
                confirmBtn.onclick = null;
                input.onkeydown = null;
                closeButtons.forEach(btn => btn.onclick = null);
            }, { once: true });
        });
    }

    async createAndLinkTopicTheory() {
        if (!this.topicTheoryModalState.topicId) return;
        const topic = this.getTopicRow(this.topicTheoryModalState.moduleId, this.topicTheoryModalState.topicId);
        const defaultTitle = `${topic?.name || this.topicTheoryModalState.topicId} — ${wt('db.k100', 'Теория')}`;

        // Show custom modal instead of browser prompt
        const title = await this.showCreateTheoryModal(defaultTitle);
        if (!title) return; // Cancelled

        const saveBtn = document.getElementById('topic-theory-save-btn');
        if (saveBtn) saveBtn.disabled = true;

        try {
            const resp = await fetch('/api/theories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim() || defaultTitle,
                    description: `${wt('db.k101', 'Автоматически созданная теория для темы')} ${topic?.name || this.topicTheoryModalState.topicId}`
                })
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) throw new Error(data.error || 'Failed to create theory');

            const newTheoryId = data.item.id;
            
            // Reload catalog to include the new one
            await this.loadTopicTheoryCatalog(true);

            // Select it in picker
            const picker = document.getElementById('topic-theory-picker');
            if (picker) {
                picker.value = newTheoryId;
            }

            this.syncTopicTheoryContextActions();
            this.setTopicTheorySummary(wt('db.k102', 'Теория создана и выбрана. Нажмите «Сохранить» для привязки к теме.'), 'success');

        } catch (error) {
            console.error('Failed to create and link theory:', error);
            this.setTopicTheorySummary(wt('db.k103', 'Ошибка: не удалось создать теорию. Попробуйте снова.'), 'error');
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    openTopicTheoryEditor() {
        const theoryId = this.getTopicTheoryModalSelectedTheoryId();
        if (!theoryId) return;

        const moduleId = this.topicTheoryModalState.moduleId;
        const topicId = this.topicTheoryModalState.topicId;
        const module = this.catalog.find((item) => item.id === moduleId);
        const topic = this.getTopicRow(moduleId, topicId);
        const returnUrl = moduleId || topicId
            ? `/editor?module=${encodeURIComponent(moduleId || '')}&topic=${encodeURIComponent(topicId || '')}`
            : '/editor';

        this.closeTopicTheoryModal();
        this.navigateToTheoryEditor(theoryId, {
            context: 'topic',
            moduleId,
            topicId,
            moduleName: module?.name || '',
            topicName: topic?.name || '',
            returnUrl,
        });
    }

    openTopicTheoryRelatedComplexes() {
        const theoryId = this.getTopicTheoryModalSelectedTheoryId();
        if (!theoryId) return;

        const url = `/complexes?theory_id=${encodeURIComponent(theoryId)}`;
        this.closeTopicTheoryModal();
        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition(url);
            return;
        }
        window.location.href = url;
    }

    openTopicTheoryCenter() {
        const moduleId = this.topicTheoryModalState.moduleId;
        const topicId = this.topicTheoryModalState.topicId;
        const topic = this.getTopicRow(moduleId, topicId);
        this.closeTopicTheoryModal();
        this.navigateToTheoryCenter({
            scope: 'topics',
            moduleId,
            query: topic?.name || topicId || '',
        });
    }

    setTopicTheorySummary(message, tone = 'muted') {
        const summaryEl = document.getElementById('topic-theory-propagation-summary');
        if (!summaryEl) return;

        summaryEl.textContent = message || '';
        summaryEl.classList.remove(
            'text-text-muted',
            'text-text-secondary',
            'text-success-darker',
            'text-warning-darker',
            'text-error-text'
        );

        const toneMap = {
            muted: 'text-text-secondary',
            info: 'text-text-secondary',
            success: 'text-success-darker',
            warning: 'text-warning-darker',
            error: 'text-error-text',
        };
        summaryEl.classList.add(toneMap[tone] || toneMap.muted);
    }

    formatTopicTheorySummary(summary, options = {}) {
        void options;
        const impacted = Number(summary?.impacted_complexes || 0);
        const updated = Number(summary?.updated || 0);
        const skipped = Number(summary?.skipped || 0);
        const compositeCount = Number(summary?.composite_count || 0);
        const mode = String(summary?.mode || 'safe');
        const compositeSuffix = compositeCount > 0 ? `, ${wt('db.k104', 'составных наборов')} ${compositeCount}` : '';
        return `${wt('db.k105', 'Обновление комплексов')} (${mode}): ${wt('db.k106', 'затронуто')} ${impacted}, ${wt('db.k107', 'обновлено')} ${updated}, ${wt('db.k108', 'без изменений')} ${skipped}${compositeSuffix}.`;
    }

    async loadTopicTheoryCatalog(force = false) {
        const picker = document.getElementById('topic-theory-picker');
        if (!picker) return;

        if (!force && Array.isArray(this.topicTheoryCatalog) && this.topicTheoryCatalog.length > 0) {
            return;
        }

        const selectedValue = picker.value;
        picker.innerHTML = wt('db.k109', '<option value="">Загрузка теорий...</option>');
        try {
            const response = await fetch('/api/theories');
            const data = await response.json();
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }

            const items = Array.isArray(data.items) ? data.items : [];
            this.topicTheoryCatalog = items;

            picker.innerHTML = wt('db.k110', '<option value="">Без теории</option>');
            items.forEach((item) => {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.title ? `${item.title} (${item.id})` : item.id;
                picker.appendChild(opt);
            });

            if (selectedValue && Array.from(picker.options).some((opt) => opt.value === selectedValue)) {
                picker.value = selectedValue;
            }
        } catch (error) {
            console.error('[Dashboard] Failed to load theory catalog for topic modal', error);
            picker.innerHTML = wt('db.k111', '<option value="">Не удалось загрузить теории</option>');
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k112', 'Список теорий не загружен.'),
                impact: wt('db.k113', 'Выбор теории для темы сейчас ограничен.'),
                next: wt('db.k114', 'Проверьте соединение и обновите список теорий.'),
            });
        }
    }

    closeTopicTheoryModal() {
        const modal = document.getElementById('topic-theory-modal');
        if (!modal) return;

        let handleEnd = null;

        const handleClose = () => {
            if (typeof modal.close === 'function') {
                try {
                    modal.close();
                } catch (error) {
                    console.warn('[Dashboard] Failed to close topic theory dialog', error);
                }
            }
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            modal.classList.remove('closing');
            this.topicTheoryModalState = {
                moduleId: null,
                topicId: null,
                loading: false,
                saving: false,
            };
            if (handleEnd) {
                modal.removeEventListener('animationend', handleEnd);
            }
        };

        if (typeof modal.close !== 'function' || !modal.open) {
            handleClose();
            return;
        }

        modal.classList.add('closing');

        handleEnd = (event) => {
            if (event.animationName === 'scaleOut') {
                handleClose();
            }
        };

        modal.addEventListener('animationend', handleEnd);
        
        // Timer fallback in case animationend fails
        setTimeout(() => {
            if (modal.classList.contains('closing')) {
                handleClose();
            }
        }, 300);
    }

    async showTopicTheoryModal(moduleId, topicId) {
        if (!moduleId || !topicId) return;
        this.setupTopicTheoryModalControls();

        const modal = document.getElementById('topic-theory-modal');
        if (!modal) return;

        if (!modal._cancelListenerAdded) {
            modal.addEventListener('cancel', (e) => {
                e.preventDefault();
                this.closeTopicTheoryModal();
            });
            modal._cancelListenerAdded = true;
        }

        const topic = this.getTopicRow(moduleId, topicId);
        const module = this.catalog.find((m) => m.id === moduleId);
        const metaEl = document.getElementById('topic-theory-meta');
        const picker = document.getElementById('topic-theory-picker');
        const relationEl = document.getElementById('topic-theory-relation');

        this.topicTheoryModalState = {
            moduleId,
            topicId,
            loading: true,
            saving: false,
        };

        if (metaEl) {
            const moduleLabel = module?.name || moduleId;
            const topicLabel = topic?.name || topicId;
            metaEl.textContent = `${moduleLabel} / ${topicLabel}`;
        }
        this.setTopicTheorySummary(wt('db.k115', 'Загружаем текущее состояние темы...'), 'info');

        if (typeof modal.showModal === 'function' && !modal.open) {
            modal.showModal();
        } else {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        await this.loadTopicTheoryCatalog(false);

        try {
            const response = await fetch(
                `/api/editor/topic/${encodeURIComponent(moduleId)}/${encodeURIComponent(topicId)}/theory-link`
            );
            const data = await response.json();
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }

            const theoryLink = (data.item && typeof data.item.theory_link === 'object') ? data.item.theory_link : null;
            const theoryId = theoryLink && typeof theoryLink.theory_id === 'string' ? theoryLink.theory_id : '';
            const relation = this.normalizeTheoryRelation(theoryLink?.relation || 'link');

            if (picker) {
                if (theoryId && !Array.from(picker.options).some((opt) => opt.value === theoryId)) {
                    const fallback = document.createElement('option');
                    fallback.value = theoryId;
                    fallback.textContent = `${wt('db.k116', 'Теория')} ${theoryId}`;
                    picker.appendChild(fallback);
                }
                picker.value = theoryId || '';
            }
            if (relationEl) relationEl.value = relation;
            this.syncTopicTheoryContextActions();

            if (data.propagation_preview) {
                this.setTopicTheorySummary(this.formatTopicTheorySummary(data.propagation_preview), 'muted');
            } else {
                this.setTopicTheorySummary(wt('db.k117', 'Нет данных о связанных комплексах.'), 'muted');
            }
        } catch (error) {
            console.error('[Dashboard] Failed to load topic theory link', error);
            this.syncTopicTheoryContextActions();
            this.setTopicTheorySummary(wt('db.k118', 'Не удалось загрузить данные темы. Попробуйте позже.'), 'error');
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k119', 'Связь темы с теорией не загружена.'),
                impact: wt('db.k120', 'Текущая настройка темы неизвестна.'),
                next: wt('db.k121', 'Повторите попытку позже или проверьте сеть.'),
            });
        } finally {
            this.topicTheoryModalState.loading = false;
        }
    }

    buildTopicTheoryLinkFromModal() {
        const picker = document.getElementById('topic-theory-picker');
        const relationEl = document.getElementById('topic-theory-relation');
        const theoryId = String(picker?.value || '').trim();
        if (!theoryId) return null;
        return {
            theory_id: theoryId,
            relation: this.normalizeTheoryRelation(relationEl?.value || 'link'),
        };
    }

    async submitTopicTheoryForm() {
        const moduleId = this.topicTheoryModalState.moduleId;
        const topicId = this.topicTheoryModalState.topicId;
        if (!moduleId || !topicId || this.topicTheoryModalState.saving) return;

        const saveBtn = document.getElementById('topic-theory-save-btn');
        const payload = {
            theory_link: this.buildTopicTheoryLinkFromModal(),
            apply_to_complexes: true,
            dry_run: false,
            propagation_mode: 'safe',
        };

        this.topicTheoryModalState.saving = true;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.add('opacity-70');
        }
        this.setTopicTheorySummary(wt('db.k122', 'Сохраняем...'), 'info');

        try {
            const response = await fetch(
                `/api/editor/topic/${encodeURIComponent(moduleId)}/${encodeURIComponent(topicId)}/theory-link`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }
            );
            const data = await response.json();
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }

            if (data.propagation && data.propagation.summary) {
                const summary = data.propagation.summary;
                const compositeCount = Array.isArray(data.propagation.items)
                    ? data.propagation.items.filter((row) => row && row.status === 'composite').length
                    : 0;
                const tone = compositeCount > 0 ? 'info' : 'success';
                this.setTopicTheorySummary(
                    this.formatTopicTheorySummary(summary),
                    tone
                );
            } else {
                this.setTopicTheorySummary(wt('db.k123', 'Связь темы сохранена.'), 'success');
            }

            await this.loadCatalog();
            const propagationItems = Array.isArray(data?.propagation?.items) ? data.propagation.items : [];
            const compositeCount = propagationItems.filter((row) => row && row.status === 'composite').length;
            this.showVoiceToast({
                severity: compositeCount > 0 ? 'info' : 'success',
                what: wt('db.k124', 'Связь темы с теорией сохранена.'),
                impact: compositeCount > 0
                    ? wt('db.k125', 'Связанные комплексы синхронизированы; часть из них теперь использует составной набор теорий.')
                    : wt('db.k126', 'Связанные комплексы-наследники синхронизированы автоматически.'),
                next: compositeCount > 0
                    ? wt('db.k127', 'Многотемные комплексы могут иметь несколько теорий одновременно. Это нормальный сценарий.')
                    : wt('db.k128', 'Настройки темы успешно обновлены.'),
            });
            this.closeTopicTheoryModal();
        } catch (error) {
            console.error('[Dashboard] Failed to save topic theory link', error);
            this.setTopicTheorySummary(wt('db.k129', 'Сохранение не удалось. Проверьте данные и попробуйте снова.'), 'error');
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k130', 'Связь темы с теорией не сохранена.'),
                impact: wt('db.k131', 'Настройки темы и комплексов остались прежними.'),
                next: wt('db.k132', 'Проверьте параметры синхронизации и повторите действие.'),
            });
        } finally {
            this.topicTheoryModalState.saving = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.classList.remove('opacity-70');
            }
        }
    }

    async syncTopicTheoryToComplexes(moduleId, topicId, actionEl = null) {
        if (!moduleId || !topicId) return;

        const syncKey = `${moduleId}:${topicId}`;
        if (this.topicTheorySyncInFlight.has(syncKey)) return;
        this.topicTheorySyncInFlight.add(syncKey);

        const initialIcon = actionEl ? actionEl.textContent : '';
        const initialTitle = actionEl ? actionEl.title : '';
        if (actionEl) {
            actionEl.classList.add('opacity-60', 'pointer-events-none');
            actionEl.textContent = 'sync';
            actionEl.title = wt('db.k133', 'Синхронизация привязки темы...');
        }

        try {
            const endpoint = `/api/editor/topic/${encodeURIComponent(moduleId)}/${encodeURIComponent(topicId)}/theory-link`;

            const loadResponse = await fetch(endpoint);
            const loadData = await loadResponse.json();
            if (!loadResponse.ok || !loadData?.ok) {
                throw new Error(loadData?.error || `HTTP ${loadResponse.status}`);
            }

            const sourceTheoryLink = (loadData.item && typeof loadData.item.theory_link === 'object')
                ? loadData.item.theory_link
                : null;
            const sourceTheoryId = String(sourceTheoryLink?.theory_id || '').trim();
            if (!sourceTheoryId) {
                this.showVoiceToast({
                    severity: 'warning',
                    what: wt('db.k134', 'Быстрая синхронизация остановлена.'),
                    impact: wt('db.k135', 'У темы пока нет привязки к теории.'),
                    next: wt('db.k136', 'Сначала задайте теорию через menu_book, затем повторите синхронизацию.'),
                });
                return;
            }

            const payload = {
                theory_link: {
                    theory_id: sourceTheoryId,
                    relation: this.normalizeTheoryRelation(sourceTheoryLink?.relation || 'link'),
                },
                apply_to_complexes: true,
                dry_run: false,
                propagation_mode: 'safe',
            };

            const saveResponse = await fetch(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const saveData = await saveResponse.json();
            if (!saveResponse.ok || !saveData?.ok) {
                throw new Error(saveData?.error || `HTTP ${saveResponse.status}`);
            }

            const propagationSummary = saveData?.propagation?.summary || null;
            const propagationItems = Array.isArray(saveData?.propagation?.items) ? saveData.propagation.items : [];
            const compositeCount = propagationItems.filter((row) => row && row.status === 'composite').length;
            this.showVoiceToast({
                severity: compositeCount > 0 ? 'info' : 'success',
                what: wt('db.k137', 'Привязка теории темы синхронизирована.'),
                impact: propagationSummary
                    ? this.formatTopicTheorySummary(propagationSummary, { dryRun: false })
                    : wt('db.k138', 'Связанные комплексы получили актуальную версию привязки.'),
                next: compositeCount > 0
                    ? wt('db.k139', 'Часть комплексов использует несколько теорий по темам. Это нормальный составной режим.')
                    : wt('db.k140', 'Можно продолжать работу в редакторе.'),
            });

            await this.loadCatalog();
        } catch (error) {
            console.error('[Dashboard] Failed to run quick topic theory sync', error);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k141', 'Быстрая синхронизация не выполнена.'),
                impact: wt('db.k142', 'Привязки теории в комплексах не были обновлены.'),
                next: wt('db.k143', 'Откройте настройки теории темы и повторите синхронизацию.'),
            });
        } finally {
            this.topicTheorySyncInFlight.delete(syncKey);
            if (actionEl) {
                actionEl.classList.remove('opacity-60', 'pointer-events-none');
                actionEl.textContent = initialIcon || 'sync_alt';
                actionEl.title = initialTitle || wt('db.k144', 'Синхронизировать привязку темы с комплексами');
            }
        }
    }

    setupTheoryHubControls() {
        if (this.theoryHubBound) return;

        const modal = document.getElementById('theory-hub-modal');
        if (!modal) {
            this.theoryHubBound = true;
            return;
        }

        modal.querySelectorAll('[data-role="theory-hub-close"]').forEach((btn) => {
            btn.addEventListener('click', () => this.closeTheoryHub());
        });
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.closeTheoryHub();
            }
        });

        const refreshBtn = document.getElementById('theory-hub-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshTheoryHubData());
        }

        const syncAllBtn = document.getElementById('theory-hub-sync-all-btn');
        if (syncAllBtn) {
            syncAllBtn.addEventListener('click', () => this.runTheoryHubSyncAll());
        }

        const focusEl = document.getElementById('theory-hub-focus-theory');
        if (focusEl) {
            focusEl.addEventListener('change', () => {
                this.theoryHubState.focusTheoryId = String(focusEl.value || '').trim();
                this.theoryHubState.selectedComplexIds = [];
                this.renderTheoryHub();
            });
        }

        const ownershipEl = document.getElementById('theory-hub-ownership-filter');
        if (ownershipEl) {
            ownershipEl.addEventListener('change', () => {
                this.theoryHubState.ownershipFilter = this.normalizeTheoryHubOwnershipFilter(ownershipEl.value);
                this.theoryHubState.selectedComplexIds = [];
                this.renderTheoryHub();
            });
        }

        const searchEl = document.getElementById('theory-hub-search');
        if (searchEl) {
            searchEl.addEventListener('input', () => {
                this.theoryHubState.searchQuery = String(searchEl.value || '').trim();
                this.renderTheoryHub();
            });
        }

        const selectAllBtn = document.getElementById('theory-hub-select-all-btn');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                const filteredIds = Array.isArray(this.theoryHubState.filteredQueueIds)
                    ? this.theoryHubState.filteredQueueIds
                    : [];
                if (!filteredIds.length) return;
                const selectedSet = new Set(Array.isArray(this.theoryHubState.selectedComplexIds)
                    ? this.theoryHubState.selectedComplexIds
                    : []);
                const areAllSelected = filteredIds.every((id) => selectedSet.has(id));
                if (areAllSelected) {
                    filteredIds.forEach((id) => selectedSet.delete(id));
                } else {
                    filteredIds.forEach((id) => selectedSet.add(id));
                }
                this.theoryHubState.selectedComplexIds = Array.from(selectedSet.values());
                this.renderTheoryHub();
            });
        }

        const syncSelectedBtn = document.getElementById('theory-hub-sync-selected-btn');
        if (syncSelectedBtn) {
            syncSelectedBtn.addEventListener('click', async () => {
                await this.runTheoryHubBatchSync('selected');
            });
        }

        const forceResolveBtn = document.getElementById('theory-hub-force-resolve-btn');
        if (forceResolveBtn) {
            forceResolveBtn.addEventListener('click', async () => {
                // Поскольку theory-hub-modal открывается как native dialog через showModal,
                // кастомный NotificationUI.confirm становится inert (некликбельным).
                // Поэтому используем нативный window.confirm.
                const confirmed = window.confirm(wt('db.k146', 'Будет запущен sync в режиме all_force для выбранных элементов очереди.'));
                if (!confirmed) return;
                await this.runTheoryHubBatchSync('selected', {
                    propagationMode: 'all_force',
                    dryRun: false,
                });
            });
        }

        this.theoryHubBound = true;
    }

    isTheoryHubOpen() {
        const modal = document.getElementById('theory-hub-modal');
        return Boolean(modal && !modal.classList.contains('hidden'));
    }

    async showTheoryHub(options = {}) {
        this.setupTheoryHubControls();
        const modal = document.getElementById('theory-hub-modal');
        if (!modal) return;

        if (!modal._cancelListenerAdded) {
            modal.addEventListener('cancel', (e) => {
                e.preventDefault();
                this.closeTheoryHub();
            });
            modal._cancelListenerAdded = true;
        }

        const requestedFocus = String(options?.focusTheoryId || '').trim();
        if (requestedFocus) {
            this.theoryHubState.focusTheoryId = requestedFocus;
        }

        if (typeof modal.showModal === 'function' && !modal.open) {
            modal.showModal();
        } else {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        const searchEl = document.getElementById('theory-hub-search');
        if (searchEl) {
            searchEl.value = String(this.theoryHubState.searchQuery || '');
        }

        await this.refreshTheoryHubData();
    }

    closeTheoryHub() {
        const modal = document.getElementById('theory-hub-modal');
        if (!modal) return;

        if (typeof modal.close !== 'function') {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            return;
        }

        modal.classList.add('closing');
        const handleEnd = (event) => {
            if (event.animationName === 'scaleOut') {
                modal.removeEventListener('animationend', handleEnd);
                modal.close();
                modal.classList.remove('closing');
            }
        };
        modal.addEventListener('animationend', handleEnd);
        
        // Fallback
        setTimeout(() => {
             if (modal.classList.contains('closing')) {
                modal.removeEventListener('animationend', handleEnd);
                modal.close();
                modal.classList.remove('closing');
             }
        }, 400);
    }

    readTheoryHubSyncOptions() {
        return {
            propagationMode: 'safe',
            dryRun: false,
        };
    }

    resolveComplexTheoryMode(payload = {}) {
        const raw = String(payload?.theory_mode || '').trim().toLowerCase();
        if (raw === 'inherit' || raw === 'override') return raw;
        if (payload && typeof payload.theory_link === 'object' && payload.theory_link) return 'override';
        return 'inherit';
    }

    parseComplexTopicRef(taskRef) {
        if (typeof taskRef === 'string') {
            const parts = taskRef.split('/').map((part) => String(part || '').trim()).filter(Boolean);
            if (parts.length >= 3) {
                return {
                    moduleId: parts[0],
                    topicId: parts[1],
                };
            }
            return null;
        }

        if (taskRef && typeof taskRef === 'object') {
            const moduleId = String(taskRef.module_id || taskRef.moduleId || '').trim();
            const topicId = String(taskRef.topic_id || taskRef.topicId || '').trim();
            if (moduleId && topicId) {
                return { moduleId, topicId };
            }
        }

        return null;
    }

    collectComplexTopicRefs(taskRefs) {
        const refs = [];
        const seen = new Set();
        if (!Array.isArray(taskRefs)) return refs;

        taskRefs.forEach((taskRef) => {
            const parsed = this.parseComplexTopicRef(taskRef);
            if (!parsed) return;
            const key = `${parsed.moduleId}:${parsed.topicId}`;
            if (seen.has(key)) return;
            seen.add(key);
            refs.push(parsed);
        });
        return refs;
    }

    normalizeComplexSyncStatus(rawStatus, topicTheoryIds = []) {
        const normalized = String(rawStatus || '').trim().toLowerCase();
        if (normalized === 'ok' || normalized === 'none' || normalized === 'conflict') {
            return normalized;
        }
        if (topicTheoryIds.length > 1) return 'conflict';
        if (topicTheoryIds.length === 1) return 'ok';
        return 'none';
    }

    computeComplexNeedsSync({ mode, status, complexTheoryId, topicTheoryIds }) {
        if (status === 'conflict') return true;
        if (mode !== 'inherit') return false;

        if (topicTheoryIds.length === 0) {
            return Boolean(complexTheoryId);
        }
        if (topicTheoryIds.length === 1) {
            return String(complexTheoryId || '') !== String(topicTheoryIds[0] || '');
        }
        return true;
    }

    createTheoryHubTopicRow({
        moduleId,
        moduleName,
        topicId,
        topicName,
        theoryLink,
    }) {
        const normalizedTheoryLink = (theoryLink && typeof theoryLink === 'object') ? theoryLink : null;
        const theoryId = String(normalizedTheoryLink?.theory_id || '').trim();
        return {
            key: `${moduleId}:${topicId}`,
            moduleId,
            moduleName: moduleName || moduleId,
            topicId,
            topicName: topicName || topicId,
            theoryId,
            relation: this.normalizeTheoryRelation(normalizedTheoryLink?.relation || 'link'),
            hasTheoryLink: Boolean(theoryId),
            complexes: [],
            linkedComplexes: 0,
            conflictComplexes: 0,
            staleComplexes: 0,
        };
    }

    async ensureTheoryHubCatalogReady(force = false) {
        if (!force && Array.isArray(this.catalog) && this.catalog.length > 0) return;

        try {
            const response = await fetch('/api/editor/catalog');
            const data = await response.json();
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
            this.catalog = this.cleanCatalog(data.modules);
        } catch (error) {
            if (Array.isArray(this.catalog) && this.catalog.length > 0) {
                console.warn('[Dashboard] Theory Hub: fallback to cached catalog', error);
                return;
            }
            throw error;
        }
    }

    buildTheoryHubData(complexes = [], theories = []) {
        const topicMap = new Map();
        const theoryMap = new Map();
        const complexRows = [];
        const theoryTitleById = {};

        const ensureTheoryRow = (theoryId) => {
            const normalizedTheoryId = String(theoryId || '').trim();
            if (!normalizedTheoryId) return null;
            if (theoryMap.has(normalizedTheoryId)) return theoryMap.get(normalizedTheoryId);
            const row = {
                theoryId: normalizedTheoryId,
                title: theoryTitleById[normalizedTheoryId] || normalizedTheoryId,
                topicKeys: [],
                complexes: [],
                conflictComplexes: 0,
                staleComplexes: 0,
            };
            theoryMap.set(normalizedTheoryId, row);
            return row;
        };

        (Array.isArray(theories) ? theories : []).forEach((item) => {
            const theoryId = String(item?.id || '').trim();
            if (!theoryId) return;
            theoryTitleById[theoryId] = String(item?.title || theoryId).trim() || theoryId;
            const theoryRow = ensureTheoryRow(theoryId);
            if (theoryRow) {
                theoryRow.title = theoryTitleById[theoryId];
            }
        });

        (Array.isArray(this.catalog) ? this.catalog : []).forEach((moduleItem) => {
            const moduleId = String(moduleItem?.id || '').trim();
            if (!moduleId) return;
            const moduleName = String(moduleItem?.name || moduleId).trim() || moduleId;
            (Array.isArray(moduleItem?.topics) ? moduleItem.topics : []).forEach((topicItem) => {
                const topicId = String(topicItem?.id || '').trim();
                if (!topicId) return;
                const row = this.createTheoryHubTopicRow({
                    moduleId,
                    moduleName,
                    topicId,
                    topicName: topicItem?.name || topicId,
                    theoryLink: topicItem?.theory_link,
                });
                topicMap.set(row.key, row);
                if (row.theoryId) {
                    const theoryRow = ensureTheoryRow(row.theoryId);
                    if (theoryRow && !theoryRow.topicKeys.includes(row.key)) {
                        theoryRow.topicKeys.push(row.key);
                    }
                }
            });
        });

        const ensureTopicRow = (moduleId, topicId) => {
            const normalizedModuleId = String(moduleId || '').trim();
            const normalizedTopicId = String(topicId || '').trim();
            if (!normalizedModuleId || !normalizedTopicId) return null;
            const key = `${normalizedModuleId}:${normalizedTopicId}`;
            if (topicMap.has(key)) return topicMap.get(key);
            const row = this.createTheoryHubTopicRow({
                moduleId: normalizedModuleId,
                moduleName: normalizedModuleId,
                topicId: normalizedTopicId,
                topicName: normalizedTopicId,
                theoryLink: null,
            });
            topicMap.set(key, row);
            return row;
        };

        (Array.isArray(complexes) ? complexes : []).forEach((payload) => {
            const complexId = String(payload?.id || '').trim();
            if (!complexId) return;

            const complexName = String(payload?.name || complexId).trim() || complexId;
            const mode = this.resolveComplexTheoryMode(payload);
            const topicRefs = this.collectComplexTopicRefs(payload?.tasks);
            const topicKeys = topicRefs.map((ref) => `${ref.moduleId}:${ref.topicId}`);
            const topicTheoryIds = topicRefs
                .map((ref) => {
                    const row = ensureTopicRow(ref.moduleId, ref.topicId);
                    return String(row?.theoryId || '').trim();
                })
                .filter(Boolean)
                .filter((value, index, array) => array.indexOf(value) === index)
                .sort((left, right) => this.collator.compare(left, right));
            const complexTheoryId = String(payload?.theory_link?.theory_id || '').trim();
            const ownership = this.normalizeComplexOwnership(payload);
            const status = this.normalizeComplexSyncStatus(payload?.theory_sync_status, topicTheoryIds);
            const needsSync = this.computeComplexNeedsSync({
                mode,
                status,
                complexTheoryId,
                topicTheoryIds,
            });
            const relatedTheoryIds = Array.from(new Set([
                ...topicTheoryIds,
                ...(complexTheoryId ? [complexTheoryId] : []),
            ].filter(Boolean))).sort((left, right) => this.collator.compare(left, right));

            const row = {
                id: complexId,
                name: complexName,
                mode,
                status,
                needsSync,
                theoryId: complexTheoryId,
                topicKeys,
                topicCount: topicKeys.length,
                topicTheoryIds,
                relatedTheoryIds,
                ownership,
                source_catalog_item_id: String(payload?.source_catalog_item_id || payload?.source_lineage?.source_catalog_item_id || '').trim() || null,
                source_catalog_version_id: String(payload?.source_catalog_version_id || payload?.source_lineage?.source_catalog_version_id || '').trim() || null,
            };
            complexRows.push(row);

            topicRefs.forEach((ref) => {
                const topicRow = ensureTopicRow(ref.moduleId, ref.topicId);
                if (!topicRow) return;
                topicRow.complexes.push({
                    id: row.id,
                    name: row.name,
                    mode: row.mode,
                    status: row.status,
                    needsSync: row.needsSync,
                    ownership: row.ownership,
                });
                topicRow.linkedComplexes += 1;
                if (row.status === 'conflict') topicRow.conflictComplexes += 1;
                if (row.needsSync && row.status !== 'conflict') topicRow.staleComplexes += 1;
                if (topicRow.theoryId) {
                    const theoryRow = ensureTheoryRow(topicRow.theoryId);
                    if (theoryRow && !theoryRow.topicKeys.includes(topicRow.key)) {
                        theoryRow.topicKeys.push(topicRow.key);
                    }
                }
            });

            relatedTheoryIds.forEach((theoryId) => {
                const theoryRow = ensureTheoryRow(theoryId);
                if (!theoryRow) return;
                theoryRow.complexes.push({
                    id: row.id,
                    name: row.name,
                    mode: row.mode,
                    status: row.status,
                    needsSync: row.needsSync,
                    ownership: row.ownership,
                });
                if (row.status === 'conflict') theoryRow.conflictComplexes += 1;
                if (row.needsSync && row.status !== 'conflict') theoryRow.staleComplexes += 1;
            });
        });

        const topicRows = Array.from(topicMap.values()).sort((left, right) => {
            const moduleCmp = this.collator.compare(left.moduleName || left.moduleId, right.moduleName || right.moduleId);
            if (moduleCmp !== 0) return moduleCmp;
            return this.collator.compare(left.topicName || left.topicId, right.topicName || right.topicId);
        });
        const theoryRows = Array.from(theoryMap.values())
            .map((row) => ({
                ...row,
                title: theoryTitleById[row.theoryId] || row.title || row.theoryId,
                topicKeys: Array.from(new Set(Array.isArray(row.topicKeys) ? row.topicKeys : [])).sort((left, right) => this.collator.compare(left, right)),
                complexes: Array.isArray(row.complexes) ? row.complexes : [],
            }))
            .map((row) => ({
                ...row,
                topicCount: row.topicKeys.length,
                complexCount: row.complexes.length,
            }))
            .sort((left, right) => this.collator.compare(left.title || left.theoryId, right.title || right.theoryId));
        const queueRows = complexRows
            .filter((row) => row.status === 'conflict' || row.needsSync)
            .sort((left, right) => {
                const leftWeight = left.status === 'conflict' ? 0 : 1;
                const rightWeight = right.status === 'conflict' ? 0 : 1;
                if (leftWeight !== rightWeight) return leftWeight - rightWeight;
                return this.collator.compare(left.name || left.id, right.name || right.id);
            });

        const summary = {
            totalTopics: topicRows.length,
            mappedTopics: topicRows.filter((row) => row.linkedComplexes > 0).length,
            topicsWithTheory: topicRows.filter((row) => row.hasTheoryLink).length,
            totalTheories: theoryRows.length,
            mappedTheories: theoryRows.filter((row) => (row.complexCount || 0) > 0 || (row.topicCount || 0) > 0).length,
            totalComplexes: complexRows.length,
            queueCount: queueRows.length,
            conflictCount: queueRows.filter((row) => row.status === 'conflict').length,
            staleCount: queueRows.filter((row) => row.needsSync && row.status !== 'conflict').length,
            linkCount: topicRows.reduce((acc, row) => acc + row.linkedComplexes, 0),
        };

        return { topicRows, theoryRows, complexRows, queueRows, summary };
    }

    normalizeComplexOwnership(payload = {}) {
        const ownership = (payload && typeof payload.ownership === 'object') ? payload.ownership : {};
        const createdByUserId = String(
            ownership.created_by_user_id
            || ownership.createdByUserId
            || payload?.created_by_user_id
            || payload?.createdByUserId
            || ''
        ).trim();
        const updatedByUserId = String(
            ownership.updated_by_user_id
            || ownership.updatedByUserId
            || payload?.updated_by_user_id
            || payload?.updatedByUserId
            || createdByUserId
            || ''
        ).trim();
        const createdVia = String(
            ownership.created_via
            || ownership.createdVia
            || payload?.created_via
            || payload?.createdVia
            || ''
        ).trim() || 'legacy_unknown';
        const contentScope = String(
            ownership.content_scope
            || ownership.contentScope
            || payload?.content_scope
            || payload?.contentScope
            || ''
        ).trim() || 'shared_local';
        return {
            createdByUserId,
            updatedByUserId,
            createdVia,
            contentScope,
            hasOwner: ownership.has_owner === true || ownership.hasOwner === true || !!createdByUserId,
            isOwnedByCurrentUser: ownership.is_owned_by_current_user === true || ownership.isOwnedByCurrentUser === true,
            isSharedLibrary: ownership.is_shared_library !== false && ownership.isSharedLibrary !== false,
        };
    }

    getComplexCreatedViaLabel(createdVia) {
        const normalized = String(createdVia || '').trim().toLowerCase();
        if (normalized === 'complex_builder') return 'Builder';
        if (normalized === 'manual_editor') return 'Editor';
        if (normalized === 'archive_import') return wt('db.k150', 'Импорт');
        if (normalized === 'topic_propagation') return wt('db.k151', 'Sync темы');
        if (normalized === 'single_complex_sync') return wt('db.k152', 'Sync комплекса');
        return 'Workspace';
    }

    renderComplexOwnershipBadges(ownership) {
        const normalized = this.normalizeComplexOwnership({ ownership });
        const chips = [];
        if (normalized.isOwnedByCurrentUser) {
            chips.push(wt('db.k153', '<span class="inline-flex max-w-full items-center px-2 py-0.5 rounded-full border border-success-light bg-success-lighter text-[10px] font-semibold text-success-darker">моё</span>'));
        } else if (normalized.hasOwner) {
            chips.push(`<span class="inline-flex max-w-full items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-2 text-[10px] font-semibold text-text-secondary" title="${this.escapeHtml(normalized.createdByUserId)}">${this.escapeHtml(normalized.createdByUserId)}</span>`);
        }
        chips.push(`<span class="inline-flex max-w-full items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-2 text-[10px] font-semibold text-text-secondary">${this.escapeHtml(this.getComplexCreatedViaLabel(normalized.createdVia))}</span>`);
        return chips.join('');
    }

    normalizeTheoryHubOwnershipFilter(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'mine' || normalized === 'shared' || normalized === 'imported') {
            return normalized;
        }
        return 'all';
    }

    getTheoryHubOwnershipFilterLabel(value) {
        const normalized = this.normalizeTheoryHubOwnershipFilter(value);
        if (normalized === 'mine') return wt('db.k154', 'Моё');
        if (normalized === 'shared') return wt('db.k155', 'Общее');
        if (normalized === 'imported') return wt('db.k156', 'Импорт');
        return wt('db.k157', 'Все комплексы');
    }

    matchesTheoryHubOwnershipFilter(ownership, filterValue = this.theoryHubState?.ownershipFilter) {
        const normalizedFilter = this.normalizeTheoryHubOwnershipFilter(filterValue);
        if (normalizedFilter === 'all') return true;
        const normalizedOwnership = this.normalizeComplexOwnership({ ownership });
        if (normalizedFilter === 'mine') return normalizedOwnership.isOwnedByCurrentUser;
        if (normalizedFilter === 'imported') return normalizedOwnership.createdVia === 'archive_import';
        return !normalizedOwnership.isOwnedByCurrentUser && normalizedOwnership.createdVia !== 'archive_import';
    }

    filterTheoryHubComplexListByOwnership(complexes = [], filterValue = this.theoryHubState?.ownershipFilter) {
        return (Array.isArray(complexes) ? complexes : [])
            .filter((complexRow) => this.matchesTheoryHubOwnershipFilter(complexRow?.ownership, filterValue))
            .map((complexRow) => ({
                ...complexRow,
                ownership: this.normalizeComplexOwnership(complexRow),
            }));
    }

    filterTheoryHubTopicRowByOwnership(row, filterValue = this.theoryHubState?.ownershipFilter) {
        const complexes = this.filterTheoryHubComplexListByOwnership(row?.complexes, filterValue);
        return {
            ...row,
            complexes,
            linkedComplexes: complexes.length,
            conflictComplexes: complexes.filter((item) => item?.status === 'conflict').length,
            staleComplexes: complexes.filter((item) => item?.needsSync && item?.status !== 'conflict').length,
        };
    }

    filterTheoryHubTheoryRowByOwnership(row, filterValue = this.theoryHubState?.ownershipFilter) {
        const complexes = this.filterTheoryHubComplexListByOwnership(row?.complexes, filterValue);
        return {
            ...row,
            complexes,
            complexCount: complexes.length,
            conflictComplexes: complexes.filter((item) => item?.status === 'conflict').length,
            staleComplexes: complexes.filter((item) => item?.needsSync && item?.status !== 'conflict').length,
        };
    }

    renderTheoryHubComplexPreview(complexRow, {
        action = 'hub-open-complex',
        compact = true,
    } = {}) {
        const normalized = {
            ...complexRow,
            ownership: this.normalizeComplexOwnership(complexRow),
        };
        const tone = normalized.status === 'conflict'
            ? 'border-error-light bg-error-lighter text-error-text'
            : (normalized.needsSync
                ? 'border-warning-light bg-warning-lighter text-warning-darker'
                : 'border-border-subtle bg-surface-1 text-text-secondary');
        const ownershipBadges = this.renderComplexOwnershipBadges(normalized.ownership);
        const buttonClasses = compact
            ? `editor-theory-hub-preview-btn inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] ${tone}`
            : `editor-theory-hub-preview-btn inline-flex items-center px-2.5 py-1 rounded-lg border text-[11px] ${tone}`;
        return `
            <div class="editor-theory-hub-badge-row inline-flex max-w-full flex-wrap items-center gap-1">
                <button type="button" data-action="${this.escapeHtml(action)}" data-complex-id="${this.escapeHtml(normalized.id)}"
                    class="${buttonClasses}" title="${this.escapeHtml(normalized.name)}">${this.escapeHtml(normalized.name)}</button>
                ${ownershipBadges}
            </div>
        `;
    }

    createTheoryHubSummaryChip(label, value, tone = 'neutral') {
        const chip = document.createElement('span');
        const toneMap = {
            neutral: 'border-border-subtle bg-surface-2 text-text-secondary',
            info: 'border-primary-light bg-primary-lighter text-primary-darker',
            warning: 'border-warning-light bg-warning-lighter text-warning-darker',
            danger: 'border-error-light bg-error-lighter text-error-text',
            success: 'border-success-light bg-success-lighter text-success-darker',
        };
        chip.className = `inline-flex max-w-full items-center px-2.5 py-1 rounded-full border text-xs font-semibold ${toneMap[tone] || toneMap.neutral}`;
        chip.textContent = `${label}: ${value}`;
        return chip;
    }

    describeTheoryHubQueueReason(row) {
        if (!row) return wt('db.k158', 'Требуется проверка синхронизации.');
        if (row.status === 'conflict') {
            return row.topicTheoryIds?.length > 1
                ? `${wt('db.k159', 'Темы комплекса ссылаются на разные теории:')} ${row.topicTheoryIds.join(', ')}.`
                : wt('db.k160', 'Обнаружен конфликт привязки теории между темами комплекса.');
        }
        if (row.needsSync) {
            return wt('db.k161', 'Текущая theory_link комплекса не совпадает с вычисленной по темам.');
        }
        return wt('db.k162', 'Требуется проверка синхронизации.');
    }

    filterTheoryHubRows() {
        const focusTheoryId = String(this.theoryHubState.focusTheoryId || '').trim();
        const normalizedQuery = String(this.theoryHubState.searchQuery || '').trim().toLowerCase();
        const ownershipFilter = this.normalizeTheoryHubOwnershipFilter(this.theoryHubState.ownershipFilter);

        const topicRows = (Array.isArray(this.theoryHubState.topicRows) ? this.theoryHubState.topicRows : [])
            .map((row) => this.filterTheoryHubTopicRowByOwnership(row, ownershipFilter))
            .filter((row) => {
                if (focusTheoryId && String(row.theoryId || '').trim() !== focusTheoryId) return false;
                if (ownershipFilter !== 'all' && (!Array.isArray(row.complexes) || !row.complexes.length)) return false;
                if (!normalizedQuery) return true;
                const target = [
                    row.moduleName,
                    row.topicName,
                    row.moduleId,
                    row.topicId,
                    row.theoryId,
                    ...(Array.isArray(row.complexes) ? row.complexes.map((item) => item?.name || item?.id || '') : []),
                ].join(' ').toLowerCase();
                return target.includes(normalizedQuery);
            });

        const queueRows = (Array.isArray(this.theoryHubState.queueRows) ? this.theoryHubState.queueRows : [])
            .filter((row) => {
                if (focusTheoryId && (!Array.isArray(row.relatedTheoryIds) || !row.relatedTheoryIds.includes(focusTheoryId))) {
                    return false;
                }
                if (!this.matchesTheoryHubOwnershipFilter(row?.ownership, ownershipFilter)) return false;
                if (!normalizedQuery) return true;
                const target = [row.id, row.name, row.theoryId, ...(row.relatedTheoryIds || [])].join(' ').toLowerCase();
                return target.includes(normalizedQuery);
            });

        const theoryRows = (Array.isArray(this.theoryHubState.theoryRows) ? this.theoryHubState.theoryRows : [])
            .map((row) => this.filterTheoryHubTheoryRowByOwnership(row, ownershipFilter))
            .filter((row) => {
                if (focusTheoryId && row.theoryId !== focusTheoryId) return false;
                if (ownershipFilter !== 'all' && Number(row.complexCount || 0) <= 0) return false;
                if (!normalizedQuery) return true;
                const target = [
                    row.theoryId,
                    row.title,
                    ...(Array.isArray(row.complexes) ? row.complexes.map((item) => item?.name || item?.id || '') : []),
                ].join(' ').toLowerCase();
                return target.includes(normalizedQuery);
            });

        const complexRows = (Array.isArray(this.theoryHubState.complexRows) ? this.theoryHubState.complexRows : [])
            .filter((row) => {
                if (focusTheoryId && (!Array.isArray(row.relatedTheoryIds) || !row.relatedTheoryIds.includes(focusTheoryId))) {
                    return false;
                }
                if (!this.matchesTheoryHubOwnershipFilter(row?.ownership, ownershipFilter)) return false;
                if (!normalizedQuery) return true;
                const target = [row.id, row.name, row.theoryId, ...(row.relatedTheoryIds || [])].join(' ').toLowerCase();
                return target.includes(normalizedQuery);
            });

        return { topicRows, queueRows, theoryRows, complexRows };
    }

    updateTheoryHubControls(filteredQueueRows = [], filteredTheoryRows = []) {
        const focusEl = document.getElementById('theory-hub-focus-theory');
        if (focusEl) {
            const currentValue = String(this.theoryHubState.focusTheoryId || '').trim();
            const rows = Array.isArray(filteredTheoryRows) ? filteredTheoryRows : [];
            focusEl.innerHTML = wt('db.k163', '<option value="">Все теории</option>');
            rows.forEach((row) => {
                const option = document.createElement('option');
                option.value = row.theoryId;
                option.textContent = `${row.title || row.theoryId} (${row.complexCount || 0})`;
                focusEl.appendChild(option);
            });
            focusEl.value = rows.some((row) => row.theoryId === currentValue) ? currentValue : '';
        }

        const searchEl = document.getElementById('theory-hub-search');
        if (searchEl && searchEl.value !== String(this.theoryHubState.searchQuery || '')) {
            searchEl.value = String(this.theoryHubState.searchQuery || '');
        }

        const ownershipEl = document.getElementById('theory-hub-ownership-filter');
        if (ownershipEl) {
            ownershipEl.value = this.normalizeTheoryHubOwnershipFilter(this.theoryHubState.ownershipFilter);
        }

        const ownershipNoteEl = document.getElementById('theory-hub-ownership-note');
        if (ownershipNoteEl) {
            const scopeLabel = this.getTheoryHubOwnershipFilterLabel(this.theoryHubState.ownershipFilter);
            ownershipNoteEl.textContent = this.normalizeTheoryHubOwnershipFilter(this.theoryHubState.ownershipFilter) === 'all'
                ? wt('db.k164', 'Theory Hub фильтрует общую библиотеку комплексов. Прогресс по ним остаётся личным.')
                : `Scope «${scopeLabel}» ${wt('db.k165', 'оставляет видимыми только соответствующие комплексы из общей библиотеки. Прогресс по ним остаётся личным.')}`;
        }

        const selectedSet = new Set(Array.isArray(this.theoryHubState.selectedComplexIds)
            ? this.theoryHubState.selectedComplexIds
            : []);
        const filteredIds = filteredQueueRows.map((row) => String(row?.id || '').trim()).filter(Boolean);
        this.theoryHubState.filteredQueueIds = filteredIds;

        const selectAllBtn = document.getElementById('theory-hub-select-all-btn');
        if (selectAllBtn) {
            const areAllSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id));
            selectAllBtn.disabled = filteredIds.length === 0;
            selectAllBtn.classList.toggle('opacity-60', filteredIds.length === 0);
            const selectAllIcon = selectAllBtn.querySelector('.material-symbols-outlined');
            if (selectAllIcon) {
                selectAllIcon.textContent = areAllSelected ? 'check_box' : 'check_box_outline_blank';
            }
        }

        const syncSelectedBtn = document.getElementById('theory-hub-sync-selected-btn');
        if (syncSelectedBtn) {
            const hasSelectedInScope = filteredIds.some((id) => selectedSet.has(id));
            syncSelectedBtn.disabled = !hasSelectedInScope;
            syncSelectedBtn.classList.toggle('opacity-60', !hasSelectedInScope);
        }

        const forceResolveBtn = document.getElementById('theory-hub-force-resolve-btn');
        if (forceResolveBtn) {
            const hasSelectedInScope = filteredIds.some((id) => selectedSet.has(id));
            forceResolveBtn.disabled = !hasSelectedInScope;
            forceResolveBtn.classList.toggle('opacity-60', !hasSelectedInScope);
        }
    }

    renderTheoryHubImpact(theoryRows = [], topicRows = []) {
        const host = document.getElementById('theory-hub-impact');
        if (!host) return;

        const focusTheoryId = String(this.theoryHubState.focusTheoryId || '').trim();
        if (!focusTheoryId) {
            host.innerHTML = wt('db.k166', '<div class="text-sm text-text-secondary">Выберите теорию в фильтре, чтобы увидеть impact map и действия.</div>');
            return;
        }

        const row = (Array.isArray(theoryRows) ? theoryRows : []).find((item) => String(item?.theoryId || '').trim() === focusTheoryId);
        if (!row) {
            const scopeLabel = this.getTheoryHubOwnershipFilterLabel(this.theoryHubState.ownershipFilter);
            host.innerHTML = `<div class="text-sm text-text-secondary">${wt('db.k167', 'Для выбранной теории в scope «')}${this.escapeHtml(scopeLabel)}» ${wt('db.k168', 'пока нет связанных topic/complex.')}</div>`;
            return;
        }

        const topics = Array.isArray(topicRows)
            ? topicRows.filter((topicRow) => topicRow.theoryId === focusTheoryId)
            : [];
        const complexes = Array.isArray(row.complexes) ? row.complexes : [];
        const startCandidate = complexes.find((item) => String(item?.status || '') !== 'conflict') || complexes[0] || null;

        const topicPreview = topics.slice(0, 3).map((topicRow) => {
            return `<button type="button" data-action="hub-open-topic" data-module-id="${this.escapeHtml(topicRow.moduleId)}" data-topic-id="${this.escapeHtml(topicRow.topicId)}"
                class="editor-theory-hub-preview-btn inline-flex items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-1 text-[10px] text-text-secondary hover:text-primary hover:border-primary transition-colors" title="${this.escapeHtml(topicRow.topicName)}">${this.escapeHtml(topicRow.topicName)}</button>`;
        }).join('');

        const complexPreview = complexes.slice(0, 4)
            .map((complexRow) => this.renderTheoryHubComplexPreview(complexRow, { action: 'hub-open-complex' }))
            .join('');

        host.innerHTML = `
            <div class="rounded-xl border border-border-subtle bg-surface-1 p-3">
                <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                        <p class="editor-theory-hub-card-title text-sm font-semibold text-text-main">${this.escapeHtml(row.title || row.theoryId)}</p>
                        <p class="editor-theory-hub-card-id text-[11px]">${this.escapeHtml(row.theoryId)}</p>
                    </div>
                    <button type="button" data-action="hub-start-theory-training" data-theory-id="${this.escapeHtml(row.theoryId)}"
                        class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-primary-contrast text-xs font-semibold hover:bg-primary-dark transition-colors ${startCandidate ? '' : 'opacity-60 cursor-not-allowed'}"
                        ${startCandidate ? '' : 'disabled'}>
                        <span class="material-symbols-outlined text-[15px]">play_arrow</span>
                        ${wt('db.k169', 'Тренировать')}
                    </button>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">topics: ${topics.length}</span>
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">complexes: ${complexes.length}</span>
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-warning-light bg-warning-lighter text-[10px] text-warning-darker">stale: ${row.staleComplexes || 0}</span>
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-error-light bg-error-lighter text-[10px] text-error-text">conflicts: ${row.conflictComplexes || 0}</span>
                </div>
                <div class="editor-theory-hub-secondary mt-2 text-[11px]">${wt('db.k170', 'Темы')}</div>
                <div class="mt-1 flex flex-wrap gap-1">${topicPreview || wt('db.k171', '<span class="text-[11px] text-text-muted">Нет связанных тем</span>')}</div>
                <div class="editor-theory-hub-secondary mt-2 text-[11px]">${wt('db.k172', 'Комплексы')}</div>
                <div class="mt-1 flex flex-wrap gap-2">${complexPreview || wt('db.k173', '<span class="text-[11px] text-text-muted">Нет связанных комплексов</span>')}</div>
                <div class="editor-theory-hub-action-row mt-3 flex gap-2">
                    <button type="button" data-action="hub-open-complexes-for-theory" data-theory-id="${this.escapeHtml(row.theoryId)}"
                        class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface-2 text-xs font-semibold text-text-secondary hover:text-primary hover:border-primary transition-colors">
                        <span class="material-symbols-outlined text-[15px]">dashboard</span>
                        ${wt('db.k174', 'К комплексам')}
                    </button>
                </div>
            </div>
        `;
    }

    bindTheoryHubActions() {
        const mapHost = document.getElementById('theory-hub-map');
        const queueHost = document.getElementById('theory-hub-conflicts');
        const impactHost = document.getElementById('theory-hub-impact');
        if (!mapHost || !queueHost) return;

        [mapHost, queueHost, impactHost].forEach((host) => {
            if (!host) return;
            host.querySelectorAll('[data-action="hub-preview-workspace-copy"]').forEach((btn) => btn.remove());
        });

        mapHost.querySelectorAll('[data-action="hub-sync-topic"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const moduleId = String(btn.getAttribute('data-module-id') || '').trim();
                const topicId = String(btn.getAttribute('data-topic-id') || '').trim();
                if (!moduleId || !topicId) return;
                const options = this.readTheoryHubSyncOptions();
                await this.syncTopicTheoryFromHub(moduleId, topicId, btn, options);
            });
        });

        mapHost.querySelectorAll('[data-action="hub-open-topic"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const moduleId = String(btn.getAttribute('data-module-id') || '').trim();
                const topicId = String(btn.getAttribute('data-topic-id') || '').trim();
                if (!moduleId || !topicId) return;
                this.closeTheoryHub();
                this.showTopicTheoryModal(moduleId, topicId);
            });
        });

        mapHost.querySelectorAll('[data-action="hub-open-complex"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const complexId = String(btn.getAttribute('data-complex-id') || '').trim();
                if (!complexId) return;
                this.openComplexBuilder(complexId);
            });
        });

        mapHost.querySelectorAll('[data-action="hub-focus-theory"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const theoryId = String(btn.getAttribute('data-theory-id') || '').trim();
                this.theoryHubState.focusTheoryId = theoryId;
                this.theoryHubState.selectedComplexIds = [];
                this.renderTheoryHub();
            });
        });

        queueHost.querySelectorAll('[data-action="hub-toggle-select-complex"]').forEach((input) => {
            input.addEventListener('change', (event) => {
                const complexId = String(input.getAttribute('data-complex-id') || '').trim();
                if (!complexId) return;
                const selectedSet = new Set(Array.isArray(this.theoryHubState.selectedComplexIds)
                    ? this.theoryHubState.selectedComplexIds
                    : []);
                if (Boolean(event?.target?.checked)) selectedSet.add(complexId);
                else selectedSet.delete(complexId);
                this.theoryHubState.selectedComplexIds = Array.from(selectedSet.values());
                this.updateTheoryHubControls(Array.isArray(this.theoryHubState.filteredQueueRows) ? this.theoryHubState.filteredQueueRows : []);
            });
        });

        queueHost.querySelectorAll('[data-action="hub-sync-complex"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const complexId = String(btn.getAttribute('data-complex-id') || '').trim();
                if (!complexId) return;
                const options = this.readTheoryHubSyncOptions();
                await this.syncComplexTheoryFromTopics(complexId, btn, options);
            });
        });

        queueHost.querySelectorAll('[data-action="hub-open-complex"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const complexId = String(btn.getAttribute('data-complex-id') || '').trim();
                if (!complexId) return;
                this.openComplexBuilder(complexId);
            });
        });

        queueHost.querySelectorAll('[data-action="hub-focus-theory"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const theoryId = String(btn.getAttribute('data-theory-id') || '').trim();
                this.theoryHubState.focusTheoryId = theoryId;
                this.theoryHubState.selectedComplexIds = [];
                this.renderTheoryHub();
            });
        });

        if (impactHost) {
            impactHost.querySelectorAll('[data-action="hub-open-topic"]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const moduleId = String(btn.getAttribute('data-module-id') || '').trim();
                    const topicId = String(btn.getAttribute('data-topic-id') || '').trim();
                    if (!moduleId || !topicId) return;
                    this.closeTheoryHub();
                    this.showTopicTheoryModal(moduleId, topicId);
                });
            });

            impactHost.querySelectorAll('[data-action="hub-open-complex"]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const complexId = String(btn.getAttribute('data-complex-id') || '').trim();
                    if (!complexId) return;
                    this.openComplexBuilder(complexId);
                });
            });

            impactHost.querySelectorAll('[data-action="hub-open-complexes-for-theory"]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const theoryId = String(btn.getAttribute('data-theory-id') || '').trim();
                    const url = theoryId
                        ? `/complexes?theory_id=${encodeURIComponent(theoryId)}`
                        : '/complexes';
                    if (typeof window.navigateWithTransition === 'function') {
                        window.navigateWithTransition(url);
                    } else {
                        window.location.href = url;
                    }
                });
            });

            impactHost.querySelectorAll('[data-action="hub-start-theory-training"]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const theoryId = String(btn.getAttribute('data-theory-id') || '').trim();
                    await this.startTheoryFocusedTraining(theoryId);
                });
            });
        }
    }

    renderTheoryHub() {
        const summaryHost = document.getElementById('theory-hub-summary');
        const mapHost = document.getElementById('theory-hub-map');
        const queueHost = document.getElementById('theory-hub-conflicts');
        if (!summaryHost || !mapHost || !queueHost) return;

        if (this.theoryHubState.loading) {
            summaryHost.innerHTML = wt('db.k175', '<span class="inline-flex items-center px-2.5 py-1 rounded-full border border-border-subtle bg-surface-2 text-xs text-text-secondary">Загрузка...</span>');
            mapHost.innerHTML = wt('db.k176', '<div class="text-sm text-text-secondary">Собираем граф связей...</div>');
            queueHost.innerHTML = wt('db.k177', '<div class="text-sm text-text-secondary">Собираем очередь конфликтов...</div>');
            this.renderTheoryHubImpact([], []);
            return;
        }

        const filtered = this.filterTheoryHubRows();
        const topicRows = filtered.topicRows;
        const queueRows = filtered.queueRows;
        const theoryRows = filtered.theoryRows;
        const complexRows = filtered.complexRows;
        this.theoryHubState.filteredQueueRows = queueRows;

        summaryHost.replaceChildren();
        const summary = this.theoryHubState.summary || {};
        const scopeLabel = this.getTheoryHubOwnershipFilterLabel(this.theoryHubState.ownershipFilter);
        summaryHost.appendChild(this.createTheoryHubSummaryChip(wt('db.k178', 'Теории'), `${summary.mappedTheories || 0}/${summary.totalTheories || 0}`, 'info'));
        summaryHost.appendChild(this.createTheoryHubSummaryChip(wt('db.k179', 'Темы'), `${summary.mappedTopics || 0}/${summary.totalTopics || 0}`, 'neutral'));
        summaryHost.appendChild(this.createTheoryHubSummaryChip(wt('db.k180', 'Темы с теорией'), summary.topicsWithTheory || 0, 'neutral'));
        summaryHost.appendChild(this.createTheoryHubSummaryChip(wt('db.k181', 'Комплексы'), summary.totalComplexes || 0, 'neutral'));
        summaryHost.appendChild(this.createTheoryHubSummaryChip('Scope', scopeLabel, 'neutral'));
        summaryHost.appendChild(this.createTheoryHubSummaryChip(wt('db.k182', 'Видимые комплексы'), complexRows.length, complexRows.length > 0 ? 'success' : 'warning'));
        summaryHost.appendChild(this.createTheoryHubSummaryChip(wt('db.k183', 'Связей'), summary.linkCount || 0, 'success'));
        summaryHost.appendChild(this.createTheoryHubSummaryChip(wt('db.k184', 'Очередь'), summary.queueCount || 0, (summary.queueCount || 0) > 0 ? 'warning' : 'success'));
        summaryHost.appendChild(this.createTheoryHubSummaryChip(wt('db.k185', 'Конфликты'), summary.conflictCount || 0, (summary.conflictCount || 0) > 0 ? 'danger' : 'success'));

        mapHost.replaceChildren();
        if (!topicRows.length) {
            const empty = document.createElement('div');
            empty.className = 'rounded-xl border border-border-subtle bg-surface-1 p-4 text-sm text-text-secondary';
            empty.textContent = wt('db.k186', 'По текущему фильтру нет topic-узлов для карты.');
            mapHost.appendChild(empty);
        } else {
            topicRows.forEach((row) => {
                const card = document.createElement('div');
                card.className = 'rounded-xl border border-border-subtle bg-surface-1 p-3';
                const hasLinks = row.linkedComplexes > 0;
                const theoryBadge = row.hasTheoryLink
                    ? `<button type="button" data-action="hub-focus-theory" data-theory-id="${this.escapeHtml(row.theoryId)}" class="inline-flex items-center px-2 py-0.5 rounded-full border border-primary-light bg-primary-lighter text-[11px] font-semibold text-primary-darker hover:bg-primary-light transition-colors">${wt('db.k187', 'теория:')} ${this.escapeHtml(row.theoryId)}</button>`
                    : wt('db.k188', '<span class="inline-flex items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-2 text-[11px] font-semibold text-text-muted">без теории</span>');
                const complexPreview = row.complexes.slice(0, 3)
                    .map((complexRow) => this.renderTheoryHubComplexPreview(complexRow, { action: 'hub-open-complex' }))
                    .join('');
                const moreCount = Math.max(0, row.complexes.length - 3);

                card.innerHTML = `
                    <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0">
                            <p class="editor-theory-hub-card-title text-sm font-semibold text-text-main">${this.escapeHtml(`${row.moduleName} / ${row.topicName}`)}</p>
                            <p class="editor-theory-hub-card-id mt-0.5 text-[11px]">${this.escapeHtml(`${row.moduleId}:${row.topicId}`)}</p>
                        </div>
                        <div class="editor-theory-hub-badge-row flex flex-wrap items-center gap-1 shrink-0">
                            ${theoryBadge}
                            <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-2 text-[11px] text-text-secondary">${wt('db.k189', 'комплексы:')} ${row.linkedComplexes}</span>
                            ${row.conflictComplexes > 0 ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full border border-error-light bg-error-lighter text-[11px] text-error-text">${wt('db.k389', 'конфликты:')} ${row.conflictComplexes}</span>` : ''}
                        </div>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2">${complexPreview || wt('db.k190', '<span class="text-[11px] text-text-muted">Комплексы не используют эту тему.</span>')}${moreCount > 0 ? `<span class="text-[10px] text-text-muted px-1 py-0.5">+${moreCount}</span>` : ''}</div>
                    <div class="editor-theory-hub-action-row mt-3 flex items-center gap-2">
                        <button type="button" data-action="hub-sync-topic" data-module-id="${this.escapeHtml(row.moduleId)}" data-topic-id="${this.escapeHtml(row.topicId)}"
                            class="px-3 py-1.5 rounded-lg bg-primary text-primary-contrast text-xs font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            ${hasLinks ? '' : 'disabled'}>
                            Sync ${wt('db.k191', 'тему')}
                        </button>
                        <button type="button" data-action="hub-open-topic" data-module-id="${this.escapeHtml(row.moduleId)}" data-topic-id="${this.escapeHtml(row.topicId)}"
                            class="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-2 text-text-secondary text-xs font-semibold hover:text-primary hover:border-primary transition-colors">
                            ${wt('db.k192', 'Теория темы')}
                        </button>
                    </div>
                `;
                mapHost.appendChild(card);
            });
        }

        queueHost.replaceChildren();
        if (!queueRows.length) {
            const empty = document.createElement('div');
            empty.className = 'rounded-xl border border-success-light bg-success-lighter p-4';
            empty.innerHTML = `
                <p class="text-sm font-semibold text-success-darker">${wt('db.k193', 'Конфликтов и рассинхронов не найдено')}</p>
                <p class="text-xs text-success-darker mt-1">${wt('db.k194', 'Текущие привязки теории согласованы с темами.')}</p>
            `;
            queueHost.appendChild(empty);
        } else {
            const selectedSet = new Set(Array.isArray(this.theoryHubState.selectedComplexIds)
                ? this.theoryHubState.selectedComplexIds
                : []);
            queueRows.forEach((row) => {
                const statusTone = row.status === 'conflict'
                    ? 'border-error-light bg-error-lighter text-error-text'
                    : 'border-warning-light bg-warning-lighter text-warning-darker';
                const ownershipBadges = this.renderComplexOwnershipBadges(row.ownership);
                const theoryBadges = (Array.isArray(row.relatedTheoryIds) ? row.relatedTheoryIds : [])
                    .map((theoryId) => `<button type="button" data-action="hub-focus-theory" data-theory-id="${this.escapeHtml(theoryId)}" class="inline-flex items-center px-2 py-0.5 rounded-full border border-primary-light bg-primary-lighter text-[10px] text-primary-darker hover:bg-primary-light transition-colors">${this.escapeHtml(theoryId)}</button>`)
                    .join('');
                const isSelected = selectedSet.has(row.id);
                const card = document.createElement('div');
                card.className = 'rounded-xl border border-border-subtle bg-surface-1 p-3';
                card.innerHTML = `
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0 flex items-start gap-2">
                            <label class="mt-0.5 inline-flex items-center">
                                <input type="checkbox" data-action="hub-toggle-select-complex" data-complex-id="${this.escapeHtml(row.id)}"
                                    class="h-4 w-4 rounded border-border-strong text-primary focus:ring-primary" ${isSelected ? 'checked' : ''}>
                            </label>
                            <div class="min-w-0">
                                <p class="editor-theory-hub-card-title text-sm font-semibold text-text-main">${this.escapeHtml(row.name)}</p>
                                <p class="editor-theory-hub-card-id mt-0.5 text-[11px]">${this.escapeHtml(row.id)}</p>
                            </div>
                        </div>
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${statusTone}">${this.escapeHtml(row.status)}</span>
                    </div>
                    <p class="editor-theory-hub-secondary mt-2 text-[11px]">${this.escapeHtml(this.describeTheoryHubQueueReason(row))}</p>
                    <div class="editor-theory-hub-badge-row mt-2 flex flex-wrap gap-1">
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">${wt('db.k195', 'режим:')} ${this.escapeHtml(row.mode)}</span>
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">${wt('db.k196', 'тем:')} ${row.topicCount}</span>
                        ${row.theoryId ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full border border-primary-light bg-primary-lighter text-[10px] text-primary-darker">${wt('db.k391', 'theory комплекса:')} ${this.escapeHtml(row.theoryId)}</span>` : ''}
                        ${ownershipBadges}
                        ${theoryBadges}
                    </div>
                    <div class="editor-theory-hub-action-row mt-3 flex items-center gap-2">
                        <button type="button" data-action="hub-sync-complex" data-complex-id="${this.escapeHtml(row.id)}"
                            class="px-3 py-1.5 rounded-lg bg-primary text-primary-contrast text-xs font-semibold hover:bg-primary-dark transition-colors">
                            Sync ${wt('db.k197', 'комплекс')}
                        </button>
                        <button type="button" data-action="hub-open-complex" data-complex-id="${this.escapeHtml(row.id)}"
                            class="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-2 text-text-secondary text-xs font-semibold hover:text-primary hover:border-primary transition-colors">
                            ${wt('db.k198', 'Открыть')}
                        </button>
                    </div>
                `;
                queueHost.appendChild(card);
            });
        }

        this.updateTheoryHubControls(queueRows, theoryRows);
        this.renderTheoryHubImpact(theoryRows, topicRows);
        this.bindTheoryHubActions();
    }

    async refreshTheoryHubData() {
        if (!this.isTheoryHubOpen()) return;

        this.theoryHubState.loading = true;
        this.renderTheoryHub();

        try {
            await this.ensureTheoryHubCatalogReady(true);
            const [complexesResponse, theoriesResponse] = await Promise.all([
                fetch('/api/complexes'),
                fetch('/api/theories'),
            ]);
            const complexesData = await complexesResponse.json();
            const theoriesData = await theoriesResponse.json();
            if (!complexesResponse.ok || !complexesData?.ok) {
                throw new Error(complexesData?.error || `HTTP ${complexesResponse.status}`);
            }

            const theories = theoriesResponse.ok && theoriesData?.ok && Array.isArray(theoriesData.items)
                ? theoriesData.items
                : [];
            if ((!theoriesResponse.ok || !theoriesData?.ok) && theoriesResponse.status !== 404) {
                console.warn('[Dashboard] Failed to load theory catalog for Theory Hub');
            }

            const model = this.buildTheoryHubData(
                Array.isArray(complexesData.items) ? complexesData.items : [],
                theories
            );
            const nextFocusTheoryId = String(this.theoryHubState.focusTheoryId || '').trim();
            const focusTheoryExists = !nextFocusTheoryId || model.theoryRows.some((row) => row.theoryId === nextFocusTheoryId);
            const validSelectedIds = new Set(model.queueRows.map((row) => row.id));

            this.theoryHubState = {
                ...this.theoryHubState,
                loading: false,
                topicRows: model.topicRows,
                theoryRows: model.theoryRows,
                complexRows: model.complexRows,
                queueRows: model.queueRows,
                summary: model.summary,
                theoryCatalog: theories,
                focusTheoryId: focusTheoryExists ? nextFocusTheoryId : '',
                selectedComplexIds: (Array.isArray(this.theoryHubState.selectedComplexIds) ? this.theoryHubState.selectedComplexIds : [])
                    .filter((id) => validSelectedIds.has(id)),
            };
        } catch (error) {
            console.error('[Dashboard] Failed to refresh Theory Hub', error);
            this.theoryHubState = {
                ...this.theoryHubState,
                loading: false,
                topicRows: [],
                theoryRows: [],
                complexRows: [],
                queueRows: [],
                theoryCatalog: [],
                selectedComplexIds: [],
                summary: {
                    totalTopics: 0,
                    mappedTopics: 0,
                    topicsWithTheory: 0,
                    totalTheories: 0,
                    mappedTheories: 0,
                    totalComplexes: 0,
                    queueCount: 0,
                    conflictCount: 0,
                    staleCount: 0,
                    linkCount: 0,
                },
            };
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k199', 'Theory Hub пока недоступен.'),
                impact: wt('db.k200', 'Карта связей и очередь конфликтов не загружены.'),
                next: wt('db.k201', 'Проверьте сеть и повторите обновление.'),
            });
        } finally {
            this.renderTheoryHub();
            this.updateTheoryHubTrigger(this.theoryHubState.summary);
        }
    }

    async syncTopicTheoryFromHub(moduleId, topicId, actionEl = null, options = {}) {
        if (!moduleId || !topicId) return { ok: false, reason: 'topic_ref_required' };

        const propagationMode = String(options?.propagationMode || options?.mode || 'safe');
        const dryRun = Boolean(options?.dryRun);
        const silent = Boolean(options?.silent);
        const skipRefresh = Boolean(options?.skipRefresh);

        const syncKey = `${moduleId}:${topicId}`;
        if (this.topicTheorySyncInFlight.has(syncKey)) return { ok: false, reason: 'in_flight' };
        this.topicTheorySyncInFlight.add(syncKey);

        const initialText = actionEl ? actionEl.textContent : '';
        const initialTitle = actionEl ? actionEl.title : '';
        if (actionEl) {
            actionEl.disabled = true;
            actionEl.classList.add('opacity-60', 'pointer-events-none');
            actionEl.textContent = wt('db.k202', 'Синхр...');
        }

        try {
            const endpoint = `/api/editor/topic/${encodeURIComponent(moduleId)}/${encodeURIComponent(topicId)}/theory-link`;

            const loadResponse = await fetch(endpoint);
            const loadData = await loadResponse.json();
            if (!loadResponse.ok || !loadData?.ok) {
                throw new Error(loadData?.error || `HTTP ${loadResponse.status}`);
            }

            const sourceTheoryLink = (loadData.item && typeof loadData.item.theory_link === 'object')
                ? loadData.item.theory_link
                : null;
            const sourceTheoryId = String(sourceTheoryLink?.theory_id || '').trim();
            if (!sourceTheoryId) {
                if (!silent) {
                    this.showVoiceToast({
                        severity: 'warning',
                        what: wt('db.k203', 'Sync темы остановлен.'),
                        impact: wt('db.k204', 'У темы нет привязки к теории.'),
                        next: wt('db.k205', 'Сначала привяжите теорию к теме.'),
                    });
                }
                return { ok: false, reason: 'topic_has_no_theory' };
            }

            const payload = {
                theory_link: {
                    theory_id: sourceTheoryId,
                    relation: this.normalizeTheoryRelation(sourceTheoryLink?.relation || 'link'),
                },
                apply_to_complexes: true,
                dry_run: dryRun,
                propagation_mode: propagationMode,
            };

            const saveResponse = await fetch(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const saveData = await saveResponse.json();
            if (!saveResponse.ok || !saveData?.ok) {
                throw new Error(saveData?.error || `HTTP ${saveResponse.status}`);
            }

            const propagationSummary = saveData?.propagation?.summary || null;
            const propagationItems = Array.isArray(saveData?.propagation?.items) ? saveData.propagation.items : [];
            const conflictCount = propagationItems.filter((row) => row && row.status === 'conflict').length;
            if (!silent) {
                const severity = conflictCount > 0 ? 'warning' : 'success';
                this.showVoiceToast({
                    severity,
                    what: wt('db.k206', 'Sync темы выполнен.'),
                    impact: propagationSummary
                        ? this.formatTopicTheorySummary(propagationSummary)
                        : wt('db.k207', 'Связанные комплексы получили обновления.'),
                    next: conflictCount > 0 ? wt('db.k208', 'Проверьте complex entries со статусом conflict.') : wt('db.k209', 'Можно продолжать работу.'),
                });
            }

            if (!skipRefresh) {
                await this.refreshTheoryHubData();
            }
            return { ok: true, summary: propagationSummary, conflictCount };
        } catch (error) {
            console.error('[Dashboard] Failed to sync topic theory from Theory Hub', error);
            if (!silent) {
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k210', 'Sync темы не выполнен.'),
                    impact: wt('db.k211', 'Комплексы сохранили прежние привязки.'),
                    next: wt('db.k212', 'Проверьте параметры sync и повторите.'),
                });
            }
            return { ok: false, reason: 'request_failed', error };
        } finally {
            this.topicTheorySyncInFlight.delete(syncKey);
            if (actionEl) {
                actionEl.disabled = false;
                actionEl.classList.remove('opacity-60', 'pointer-events-none');
                actionEl.textContent = initialText || wt('db.k213', 'Синхр. тему');
                actionEl.title = initialTitle || actionEl.title;
            }
        }
    }

    async syncComplexTheoryFromTopics(complexId, actionEl = null, options = {}) {
        if (!complexId) return { ok: false, reason: 'complex_id_required' };

        const propagationMode = String(options?.propagationMode || options?.mode || 'safe');
        const dryRun = Boolean(options?.dryRun);
        const silent = Boolean(options?.silent);
        const skipRefresh = Boolean(options?.skipRefresh);
        const syncKey = `complex:${complexId}`;
        if (this.theoryHubSyncInFlight.has(syncKey)) return { ok: false, reason: 'in_flight' };
        this.theoryHubSyncInFlight.add(syncKey);

        const initialHtml = actionEl ? actionEl.innerHTML : '';
        if (actionEl) {
            actionEl.disabled = true;
            actionEl.classList.add('opacity-60', 'pointer-events-none');
            actionEl.textContent = wt('db.k214', 'Синхр...');
        }

        try {
            const response = await fetch(`/api/complexes/${encodeURIComponent(complexId)}/sync-theory-from-topics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    propagation_mode: propagationMode,
                    dry_run: dryRun,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }

            const summary = data.summary || {};
            if (!silent) {
                const action = String(summary?.action || '');
                const reason = String(summary?.reason || '');
                const status = String(summary?.status || 'none');
                const severity = status === 'conflict'
                    ? 'warning'
                    : 'success';
                this.showVoiceToast({
                    severity,
                    what: `Sync ${wt('db.k215', 'комплекса')} ${complexId} ${wt('db.k216', 'выполнен.')}`,
                    impact: `${wt('db.k217', 'Статус:')} ${status}, action: ${action || 'none'}${reason ? `, reason: ${reason}` : ''}.`,
                    next: status === 'conflict'
                        ? wt('db.k218', 'Проверьте темы комплекса и выровняйте theory-link.')
                        : wt('db.k219', 'Можно продолжать работу.'),
                });
            }

            if (!skipRefresh) {
                await this.refreshTheoryHubData();
            }
            return { ok: true, summary };
        } catch (error) {
            console.error('[Dashboard] Failed to sync complex theory from topics', error);
            if (!silent) {
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k220', 'Синхронизация комплекса не выполнена.'),
                    impact: `${wt('db.k221', 'Комплекс')} ${complexId} ${wt('db.k222', 'сохранил прежнее состояние.')}`,
                    next: wt('db.k223', 'Проверьте настройки режима sync и повторите попытку.'),
                });
            }
            return { ok: false, reason: 'request_failed', error };
        } finally {
            this.theoryHubSyncInFlight.delete(syncKey);
            if (actionEl) {
                actionEl.disabled = false;
                actionEl.classList.remove('opacity-60', 'pointer-events-none');
                actionEl.innerHTML = initialHtml || wt('db.k224', 'Синхр. комплекс');
            }
        }
    }

    async runTheoryHubSyncAll() {
        const syncAllBtn = document.getElementById('theory-hub-sync-all-btn');
        if (!syncAllBtn) return;
        if (syncAllBtn.disabled) return;

        const topicRows = Array.isArray(this.theoryHubState.topicRows)
            ? this.theoryHubState.topicRows.filter((row) => row.linkedComplexes > 0)
            : [];
        if (!topicRows.length) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k225', 'Sync all остановлен.'),
                impact: wt('db.k226', 'Нет тем, связанных с комплексами.'),
                next: wt('db.k227', 'Добавьте комплексы или привяжите темы к существующим комплексам.'),
            });
            return;
        }

        const options = this.readTheoryHubSyncOptions();
        const initialHtml = syncAllBtn.innerHTML;
        syncAllBtn.disabled = true;
        syncAllBtn.classList.add('opacity-60', 'pointer-events-none');
        syncAllBtn.innerHTML = wt('db.k228', '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Синхр...');

        let successCount = 0;
        let failedCount = 0;
        let conflictCount = 0;
        let skippedNoTheoryCount = 0;

        try {
            for (const row of topicRows) {
                const result = await this.syncTopicTheoryFromHub(row.moduleId, row.topicId, null, {
                    propagationMode: options.propagationMode,
                    dryRun: options.dryRun,
                    silent: true,
                    skipRefresh: true,
                });
                if (result?.ok) {
                    successCount += 1;
                    conflictCount += Number(result?.conflictCount || 0);
                } else if (result?.reason === 'topic_has_no_theory') {
                    skippedNoTheoryCount += 1;
                } else {
                    failedCount += 1;
                }
            }

            await this.refreshTheoryHubData();
            const severity = failedCount > 0
                ? 'warning'
                : (conflictCount > 0 ? 'warning' : 'success');
            this.showVoiceToast({
                severity,
                what: wt('db.k229', 'Sync all выполнен.'),
                impact: `${wt('db.k230', 'Тем обработано:')} ${topicRows.length}, ${wt('db.k231', 'успешно:')} ${successCount}, ${wt('db.k232', 'пропущено')} (${wt('db.k233', 'без теории')}): ${skippedNoTheoryCount}, ${wt('db.k234', 'с ошибками:')} ${failedCount}, conflicts: ${conflictCount}.`,
                next: failedCount > 0
                    ? wt('db.k235', 'Проверьте лог и повторите sync для проблемных тем.')
                    : wt('db.k236', 'Theory Hub обновлен по текущему состоянию.'),
            });
        } finally {
            syncAllBtn.disabled = false;
            syncAllBtn.classList.remove('opacity-60', 'pointer-events-none');
            syncAllBtn.innerHTML = initialHtml;
        }
    }

    async runTheoryHubBatchSync(scope = 'selected', options = {}) {
        const queueRows = Array.isArray(this.theoryHubState.filteredQueueRows)
            ? this.theoryHubState.filteredQueueRows
            : [];
        const selectedIds = Array.isArray(this.theoryHubState.selectedComplexIds)
            ? this.theoryHubState.selectedComplexIds
            : [];
        const candidateIds = scope === 'filtered'
            ? queueRows.map((row) => String(row?.id || '').trim()).filter(Boolean)
            : selectedIds.filter(Boolean);

        if (!candidateIds.length) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k237', 'Batch sync остановлен.'),
                impact: wt('db.k238', 'В Theory Hub нет выбранных complex-элементов.'),
                next: wt('db.k239', 'Отметьте нужные complex entries в conflict queue.'),
            });
            return;
        }

        const effectiveOptions = {
            ...this.readTheoryHubSyncOptions(),
            ...options,
            skipRefresh: true,
            silent: true,
        };
        const syncSelectedBtn = document.getElementById('theory-hub-sync-selected-btn');
        const forceResolveBtn = document.getElementById('theory-hub-force-resolve-btn');
        const toggleTargets = [syncSelectedBtn, forceResolveBtn].filter(Boolean);
        toggleTargets.forEach((btn) => {
            btn.disabled = true;
            btn.classList.add('opacity-60', 'pointer-events-none');
        });

        let successCount = 0;
        let conflictCount = 0;
        let failedCount = 0;

        try {
            for (const complexId of candidateIds) {
                const result = await this.syncComplexTheoryFromTopics(complexId, null, effectiveOptions);
                if (result?.ok) {
                    successCount += 1;
                    if (String(result?.summary?.status || '').trim().toLowerCase() === 'conflict') {
                        conflictCount += 1;
                    }
                } else {
                    failedCount += 1;
                }
            }

            await this.refreshTheoryHubData();
            this.showVoiceToast({
                severity: failedCount > 0
                    ? 'warning'
                    : (conflictCount > 0 ? 'warning' : 'success'),
                what: effectiveOptions.propagationMode === 'all_force'
                    ? wt('db.k240', 'Force resolve очереди завершён.')
                    : wt('db.k241', 'Batch sync очереди завершён.'),
                impact: `${wt('db.k242', 'Обработано complexes:')} ${candidateIds.length}, ${wt('db.k243', 'успех:')} ${successCount}, conflicts: ${conflictCount}, errors: ${failedCount}.`,
                next: wt('db.k244', 'Theory Hub обновлён по текущему состоянию.'),
            });
        } finally {
            toggleTargets.forEach((btn) => {
                btn.disabled = false;
                btn.classList.remove('opacity-60', 'pointer-events-none');
            });
        }
    }

    persistTheoryTrainingBridgeContext(sessionId, payload = {}) {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId || typeof sessionStorage === 'undefined') return;
        const storageKey = `${this.theoryTrainingBridgeStorageKey}:${normalizedSessionId}`;
        try {
            sessionStorage.setItem(storageKey, JSON.stringify({
                ...payload,
                sessionId: normalizedSessionId,
                savedAt: Date.now(),
            }));
        } catch (error) {
            console.warn('[Dashboard] Failed to persist theory training bridge context', error);
        }
    }

    async startTheoryFocusedTraining(theoryId) {
        const normalizedTheoryId = String(theoryId || '').trim();
        if (!normalizedTheoryId) return;

        const theoryRow = (Array.isArray(this.theoryHubState.theoryRows) ? this.theoryHubState.theoryRows : [])
            .find((row) => String(row?.theoryId || '').trim() === normalizedTheoryId);
        const candidate = Array.isArray(theoryRow?.complexes)
            ? theoryRow.complexes.find((item) => String(item?.status || '').trim().toLowerCase() !== 'conflict') || theoryRow.complexes[0]
            : null;
        const complexId = String(candidate?.id || '').trim();
        if (!complexId) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k245', 'Старт тренировки остановлен.'),
                impact: wt('db.k246', 'Для выбранной теории нет доступных комплексов.'),
                next: wt('db.k247', 'Сначала свяжите теорию с topic/complex.'),
            });
            return;
        }

        try {
            const response = await fetch(`/api/session/${encodeURIComponent(complexId)}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await response.json();

            let sessionId = '';
            if (response.status === 409 && data?.error === 'paused_session_exists' && data?.session_id) {
                sessionId = String(data.session_id || '').trim();
            } else if (response.ok && data?.ok && data?.session_id) {
                sessionId = String(data.session_id || '').trim();
            }

            if (!sessionId) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }

            this.persistTheoryTrainingBridgeContext(sessionId, {
                theoryId: normalizedTheoryId,
                theoryTitle: String(theoryRow?.title || normalizedTheoryId).trim() || normalizedTheoryId,
                complexId,
                origin: 'editor_theory_hub',
                returnUrl: this.buildTheoryEditorUrl(normalizedTheoryId, {
                    returnUrl: '/editor',
                }),
            });
            if (typeof window.navigateWithTransition === 'function') {
                window.navigateWithTransition(`/session/${encodeURIComponent(sessionId)}`);
            } else {
                window.location.href = `/session/${encodeURIComponent(sessionId)}`;
            }
        } catch (error) {
            console.error('[Dashboard] Failed to start theory-focused training', error);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k248', 'Старт тренировки не выполнен.'),
                impact: wt('db.k249', 'Сценарий «из теории в complex» не состоялся.'),
                next: wt('db.k250', 'Проверьте complex entry и повторите запуск.'),
            });
        }
    }

    openComplexBuilder(complexId) {
        const url = `/complexes/create?id=${encodeURIComponent(complexId)}`;
        this.closeTheoryHub();
        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition(url);
            return;
        }
        window.location.href = url;
    }

    async submitTopicForm() {
        const module_id = document.querySelector('#topic-module-select').value;
        const nameInput = document.querySelector('#topic-name-input');
        const name = nameInput.value.trim();
        if (!name) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k251', 'Создание темы приостановлено.'),
                impact: wt('db.k252', 'Название темы пустое.'),
                next: wt('db.k253', 'Введите название и повторите действие.'),
            });
            return;
        }

        try {
            const response = await fetch('/api/editor/topic/new', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ module_id, name })
            });
            const data = await response.json();
            if (data.ok) {
                await this.loadCatalog();
                this.renderSidebar();
                nameInput.value = '';
                this.closeTopicModal();
                // Update topic select in task modal
                if (!document.querySelector('#create-task-modal').classList.contains('hidden')) {
                    this.updateTopicSelect();
                    document.querySelector('#task-topic-select').value = data.topic_id;
                }
            } else {
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k254', 'Тема не создана.'),
                    impact: wt('db.k255', 'Структура модуля осталась без изменений.'),
                    next: data?.error ? `${wt('db.k256', 'Проверьте данные')} (${data.error}) ${wt('db.k257', 'и повторите.')}` : wt('db.k258', 'Проверьте данные и повторите создание.'),
                });
            }
        } catch (err) {
            console.error(err);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k259', 'Тема не создана из-за сетевой ошибки.'),
                impact: wt('db.k260', 'Изменения не были отправлены.'),
                next: wt('db.k261', 'Проверьте сеть и повторите действие.'),
            });
        }
    }

    async createNewTask(module_id, topic_id, task_name, task_type) {
        try {
            const response = await fetch('/api/editor/task/bootstrap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id,
                    topic_id,
                    task_name,
                    task_type
                })
            });

            const data = await response.json();
            if (data.ok) {
                if (this.isTaskCreationBlocked()) {
                    this.showVoiceToast({
                        severity: 'warning',
                        what: wt('db.k262', 'Черновик создан.'),
                        impact: this.getTaskDraftNotice() || wt('db.k263', 'Сохранение нового задания будет недоступно, пока не освободится слот.'),
                        next: wt('db.k264', 'Можно подготовить черновик и сохранить его позже.'),
                        timeout: 5000,
                    });
                }
                this.storeTaskBootstrap(module_id, topic_id, data.task_id, data.task);
                window.navigateWithTransition(
                    this.getEditorUrl(task_type, module_id, topic_id, data.task_id, {
                        isNew: true,
                        taskType: task_type,
                        taskName: task_name,
                    })
                );
            } else {
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k265', 'Задание не создано.'),
                    impact: wt('db.k266', 'Текущая тема не изменилась.'),
                    next: data?.error ? `${wt('db.k267', 'Проверьте данные')} (${data.error}) ${wt('db.k268', 'и повторите.')}` : wt('db.k269', 'Проверьте параметры и повторите создание.'),
                });
            }
        } catch (error) {
            console.error("Error creating task:", error);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k270', 'Задание не создано из-за сетевой ошибки.'),
                impact: wt('db.k271', 'Изменения не были отправлены на сервер.'),
                next: wt('db.k272', 'Проверьте сеть и повторите действие.'),
            });
        }
    }

    getEditorUrl(type, module, topic, id, options = false) {
        let editorPage = '';
        if (type === 'click' || type === 'click_task') editorPage = 'Point_Annotation.html';
        if (type === 'draw' || type === 'draw_task') editorPage = 'Point_Annotation.html';
        if (type === 'test') editorPage = 'Test Task Editor Multiple Choice.html';
        if (type === 'sequence_assembly') editorPage = 'Sequence Assembly Editor Procedural Steps.html';
        if (type === 'open_answer') editorPage = 'Open Answer Editor Textual Reasoning.html';

        const normalizedOptions = typeof options === 'boolean' ? { isNew: options } : (options || {});
        const params = new URLSearchParams({
            module,
            topic,
            task: id,
        });
        if (normalizedOptions.isNew) {
            params.set('new', '1');
        }
        if (normalizedOptions.taskType) {
            params.set('task_type', normalizedOptions.taskType);
        }
        if (normalizedOptions.taskName) {
            params.set('task_name', normalizedOptions.taskName);
        }
        if (normalizedOptions.restoreDraft) {
            params.set('restore_draft', '1');
        }
        if (!editorPage) {
            return '';
        }
        const encodedEditorPage = encodeURIComponent(editorPage);
        return `/editor/${encodedEditorPage}?${params.toString()}`;
    }

    renderSidebar() {
        const sidebarContainer = document.querySelector('aside .flex-1');
        if (!sidebarContainer) return;

        const navContainer = sidebarContainer.querySelector('.flex-col');
        if (!navContainer) return;

        navContainer.innerHTML = '';
        const allBtn = this.createAllTasksElement();
        navContainer.appendChild(allBtn);

        if (!this.catalog || this.catalog.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'flex flex-col items-center gap-2 px-3 py-6 text-center';
            hint.innerHTML = `
                <span class="material-symbols-outlined text-2xl text-text-disabled">folder_open</span>
                <p class="editor-sidebar-empty-copy text-xs font-medium">${wt('db.k273', 'Модулей пока нет.')}</p>
                <p class="editor-sidebar-empty-copy text-xs">${wt('db.k274', 'Нажмите «')}+» ${wt('db.k275', 'чтобы создать первый модуль')}</p>
            `;
            navContainer.appendChild(hint);
        }

        this.catalog.forEach(module => {
            const moduleEl = this.createModuleElement(module);
            navContainer.appendChild(moduleEl);
        });

        this.renderWorkspaceShortcuts();
        this.syncSidebarSelection();
        this.updateHeaderBreadcrumbs(); // Call breadcrumbs update
        // After rendering sidebar, render the grid with all tasks
        this.renderGrid();
    }

    collectAllTasks() {
        const allTasks = [];
        this.catalog.forEach(module => {
            if (module.topics) {
                module.topics.forEach(topic => {
                    if (topic.tasks) {
                        topic.tasks.forEach(task => {
                            allTasks.push(this.normalizeCatalogTask(task, {
                                moduleId: module.id,
                                moduleName: module.name || module.id,
                                topicId: topic.id,
                                topicName: topic.name || topic.id,
                                created_at: task.created_at || task.createdAt || task.meta?.created_at
                            }));
                        });
                    }
                });
            }
        });
        allTasks.push(...this.collectDraftOnlyTasks());
        return allTasks;
    }

    renderGrid(tasks = null) {
        const gridContainer = document.querySelector('main .grid');
        if (!gridContainer) return;

        const addBtn = document.querySelector('[data-role="create-task-card"]');
        const isFiltered = Array.isArray(tasks);
        const sourceTasks = tasks ?? this.collectAllTasks();
        const archiveFilteredTasks = this.showPremiumArchiveTasks
            ? sourceTasks.filter((task) => this.isTaskPremiumArchived(task))
            : sourceTasks;
        const tasksToRender = this.sortTasks(archiveFilteredTasks);
        const taskDraftIds = this.collectTaskDraftIds();

        gridContainer.innerHTML = '';
        if (addBtn) {
            gridContainer.appendChild(addBtn);
        }

        if (!tasksToRender.length) {
            const emptyCard = this.createEmptyStateCard(
                this.showPremiumArchiveTasks
                    ? wt('db.k276', 'В архиве Premium нет заданий для текущего раздела')
                    : isFiltered && this.currentSearchQuery
                    ? `${wt('db.k277', 'По запросу «')}${this.currentSearchQuery.trim()}» ${wt('db.k278', 'ничего не найдено')}`
                    : wt('db.k279', 'Задания не найдены')
            );
            gridContainer.appendChild(emptyCard);
            return;
        }

        tasksToRender.forEach((task, index) => {
            const uniqueId = this.makeTaskUniqueId(task.moduleId, task.topicId, task.id);
            const card = this.createTaskCard(task, {
                hasDraft: taskDraftIds.has(uniqueId),
            });
            if (index < 2) {
                card.setAttribute('data-onboarding-target', 'editor-existing-task-card');
                if (index === 0) {
                    card.querySelector('[data-action="favorite-task"]')?.setAttribute('data-onboarding-target', 'editor-task-favorite-action');
                }
            }
            gridContainer.appendChild(card);
        });
    }

    renderTopicTasks(moduleId, topicId) {
        const module = this.catalog.find(m => m.id === moduleId);
        if (!module) return;

        const topic = (module.topics || []).find(t => t.id === topicId);
        if (!topic) return;

        this.activeModuleId = module.id;
        this.activeTopicId = topic.id;
        this.expandSidebarModule(module.id);
        this.expandSidebarTopic(module.id, topic.id);
        this.syncSidebarSelection();
        this.updateHeaderBreadcrumbs();
        this.updateUrlState();

        const topicTasks = (topic.tasks || []).map(task => this.normalizeCatalogTask(task, {
            moduleId: module.id,
            moduleName: module.name || module.id,
            topicId: topic.id,
            topicName: topic.name || topic.id
        }));
        topicTasks.push(...this.collectDraftOnlyTasks({ moduleId: module.id, topicId: topic.id }));

        this.renderGrid(topicTasks);
    }

    renderModuleTopics(moduleId) {
        const module = this.catalog.find(m => m.id === moduleId);
        if (!module) return;

        this.activeModuleId = module.id;
        this.activeTopicId = null;
        this.expandSidebarModule(module.id);
        this.syncSidebarSelection();
        this.updateHeaderBreadcrumbs();
        this.updateUrlState();

        const moduleTasks = (module.topics || []).flatMap(topic =>
            (topic.tasks || []).map(task => this.normalizeCatalogTask(task, {
                moduleId: module.id,
                moduleName: module.name || module.id,
                topicId: topic.id,
                topicName: topic.name || topic.id
            }))
        );
        moduleTasks.push(...this.collectDraftOnlyTasks({ moduleId: module.id }));

        this.renderGrid(moduleTasks);
    }

    createTaskCard(task, options = {}) {
        const article = document.createElement('article');
        const isErrorDetection = this.isErrorDetectionTask(task);
        const archiveItem = this.resolveTaskArchiveItem(task);
        const isPremiumArchived = Boolean(archiveItem);
        const baseCardClasses = 'group rounded-xl p-5 flex flex-col h-[200px] border transition-all hover:shadow-xl hover:translate-y-[-4px] relative animate-slide-up shadow-sm cursor-pointer task-card';
        const cardTheme = 'bg-surface-2 border-border-subtle hover:border-primary';
        const hasDraft = Boolean(options.hasDraft);
        const isDraftOnly = Boolean(task.isDraftOnly);

        // Check selection state
        const uniqueId = `${task.moduleId}:${task.topicId}:${task.id}`;
        const isSelected = this.selectedTasks.has(uniqueId);
        const isFavorite = this.isFavoriteTask(uniqueId);

        if (isSelected) {
            article.className = `${baseCardClasses} bg-surface-2 border-primary ring-2 ring-primary${isPremiumArchived ? ' task-card--premium-archived' : ''}`;
        } else {
            article.className = `${baseCardClasses} ${cardTheme}${isPremiumArchived ? ' task-card--premium-archived' : ''}`;
        }

        // Pass unique ID to element dataset
        article.dataset.taskId = uniqueId;
        article.dataset.premiumArchived = isPremiumArchived ? '1' : '0';
        if (isPremiumArchived) {
            article.title = wt('db.k280', 'Задание в архиве Premium: можно выделить и удалить, но нельзя открыть для редактирования или экспортировать.');
        }

        const { label: typeLabel, className: typeClass } = this.getTaskTypeMeta(task);
        const topicLabel = task.topicName || task.topicId || wt('db.k281', 'Без темы');
        const createdLabel = this.escapeHtml(this.formatCreatedDate(task.created_at));
        const updatedLabel = task.updated_at ? this.escapeHtml(this.formatCreatedDate(task.updated_at)) : null;
        const safeTypeLabel = this.escapeHtml(typeLabel);
        const safeTaskName = this.escapeHtml(task.name || task.id || wt('db.k282', 'Без названия'));
        const safeModuleLabel = this.escapeHtml(task.moduleName || task.moduleId || wt('db.k283', 'Без модуля'));
        const safeTopicLabel = this.escapeHtml(topicLabel);

        // Theme-aware error badge classes
        const isDark = this.isCurrentThemeDark();
        const errorBadgeClass = isDark
            ? 'bg-error-dark text-error-text ring-1 ring-inset ring-error-light'
            : 'bg-error-light text-error-darker ring-1 ring-inset ring-error-darker';
        const draftBadgeClass = isDark
            ? 'border border-warning-light bg-warning-dark text-warning-text'
            : 'border border-warning-light bg-warning-lighter text-warning-darker';
        const archiveBadgeClass = isDark
            ? 'border border-warning-light bg-warning-dark text-warning-text'
            : 'border border-warning-light bg-warning-lighter text-warning-darker';

        article.innerHTML = `
            <div class="flex justify-between items-start mb-3 gap-3">
                <div class="flex items-start gap-2 flex-1 min-w-0">
                    <button type="button" data-action="favorite-task"
                        class="h-8 w-8 inline-flex shrink-0 items-center justify-center rounded-lg border ${isFavorite ? 'border-warning bg-warning-light text-warning-dark' : 'border-border-subtle bg-surface-1 text-text-disabled'} hover:border-warning hover:text-warning transition-colors">
                        <span class="material-symbols-outlined text-[17px]">${isFavorite ? 'star' : 'star_outline'}</span>
                    </button>
                    <div class="flex flex-wrap gap-1.5 pt-1">
                        <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${typeClass}">
                            ${safeTypeLabel}
                        </span>
                        ${hasDraft ? `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${draftBadgeClass}">
                            <span class="material-symbols-outlined leading-none" style="font-size: 16px;">edit_note</span>
                            ${wt('db.k038', 'Черновик')}
                        </span>` : ""}
                        ${isErrorDetection ? `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${errorBadgeClass}">
                            <span class="material-symbols-outlined leading-none" style="font-size: 18px;">bug_report</span>
                            ${wt('db.k392', 'Ошибки')}
                        </span>` : ""}
                        ${isPremiumArchived ? `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${archiveBadgeClass}" title="${wt('db.k393', 'Архив Premium: редактирование и экспорт заблокированы до продления Premium')}">
                            <span class="material-symbols-outlined leading-none" style="font-size: 16px;">inventory_2</span>
                            ${wt('db.k394', 'Архив Premium')}
                        </span>` : ""}
                    </div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <div class="${isDraftOnly ? 'w-2.5 h-2.5 rounded-full bg-warning ring-2 ring-warning-light' : 'status-indicator-published'}" title="${isDraftOnly ? wt('db.k284', 'Только локальный черновик') : 'Published'}"></div>
                    <div class="${this.selectionMode ? 'block' : 'hidden group-hover:block'}">
                        <input type="checkbox" 
                            class="w-5 h-5 text-primary rounded border-border-strong focus:ring-primary task-checkbox transition-transform hover:scale-110"
                            ${isSelected ? 'checked' : ''}
                        >
                    </div>
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <h3 class="editor-task-card-title text-text-main text-lg font-bold mb-2 group-hover:text-primary transition-colors cursor-pointer truncate">${safeTaskName}</h3>
                <p class="text-text-secondary text-xs font-medium truncate">${wt('db.k285', 'Создано')} ${createdLabel}${updatedLabel && updatedLabel !== createdLabel ? ` ${wt('db.k390', 'В· Изм.')} ${updatedLabel}` : ''}</p>
            </div>
            <div class="flex gap-2 mt-4 flex-wrap items-center">
                <span class="editor-task-card-chip inline-flex items-center rounded bg-surface-1 px-2 py-1 text-xs font-medium text-text-secondary border-2 border-border-normal whitespace-nowrap">${safeModuleLabel}</span>
                <span class="editor-task-card-chip inline-flex items-center rounded bg-surface-1 px-2 py-1 text-xs font-medium text-text-secondary border-2 border-border-normal whitespace-nowrap">${safeTopicLabel}</span>
            </div>
        `;

        // Checkbox handler
        const checkbox = article.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleTaskSelection(uniqueId, checkbox.checked, e.shiftKey);
        });

        const favoriteBtn = article.querySelector('[data-action="favorite-task"]');
        if (favoriteBtn) {
            favoriteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFavoriteTask({
                    uniqueId,
                    moduleId: task.moduleId,
                    topicId: task.topicId,
                    taskId: task.id,
                    name: task.name || task.id,
                    moduleName: task.moduleName || task.moduleId,
                    topicName: task.topicName || task.topicId,
                    type: task.type,
                });
            });
        }

        // Main card click
        article.addEventListener('click', (e) => {
            if (this.selectionMode) {
                // If in selection mode, card click acts as checkbox toggle
                checkbox.checked = !checkbox.checked;
                this.handleTaskSelection(uniqueId, checkbox.checked, e.shiftKey);
            } else {
                if (isPremiumArchived) {
                    this.showVoiceToast({
                        severity: 'warning',
                        what: wt('db.k286', 'Задание находится в архиве Premium.'),
                        impact: wt('db.k287', 'Редактирование и экспорт временно недоступны.'),
                        next: wt('db.k288', 'Можно удалить задание или продлить Premium, чтобы вернуть полный доступ.'),
                    });
                    return;
                }
                this.openTaskEntry(
                    { ...task, hasDraft },
                    task.moduleId,
                    task.topicId,
                    { preferDraft: hasDraft }
                );
            }
        });

        return article;
    }

    createEmptyStateCard(message) {
        const article = document.createElement('article');
        article.className = 'border-2 border-dashed border-border-subtle rounded-xl bg-surface-1 p-6 flex flex-col items-center justify-center text-center gap-2 h-[200px]';
        const safeMessage = this.escapeHtml(message);
        const safeQuery = this.escapeHtml(this.currentSearchQuery.trim());
        const details = this.currentSearchQuery && this.currentSearchQuery.trim()
            ? `<p class="editor-grid-empty-detail text-xs">${wt('db.k289', 'Запрос: «')}${this.currentSearchQuery.trim()}»</p>`
            : '';
        const safeDetails = details && this.currentSearchQuery
            ? details.replace(this.currentSearchQuery.trim(), safeQuery)
            : details;
        article.innerHTML = `
            <span class="material-symbols-outlined text-3xl text-text-disabled mb-1">search_off</span>
            <p class="editor-grid-empty-message text-sm font-medium">${safeMessage}</p>
            ${safeDetails}
        `;
        return article;
    }

    formatCreatedDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    }

    handleSearch(rawQuery = '') {
        const normalized = rawQuery.trim();
        this.currentSearchQuery = normalized;

        if (!normalized) {
            this.activeModuleId = null;
            this.activeTopicId = null;
            this.syncSidebarSelection();
            this.updateHeaderBreadcrumbs();
            this.renderGrid();
            return;
        }

        const query = normalized.toLowerCase();
        const matches = this.collectAllTasks().filter(task => {
            const searchable = [
                task.name,
                task.id,
                task.moduleName,
                task.moduleId,
                task.topicName,
                task.topicId,
                task.type
            ];
            return searchable.some(field =>
                field && field.toString().toLowerCase().includes(query)
            );
        });

        this.activeModuleId = null;
        this.activeTopicId = null;
        this.syncSidebarSelection();
        this.updateHeaderBreadcrumbs(); // Call breadcrumbs update
        this.renderGrid(matches);
    }

    renderAllTasks() {
        this.activeModuleId = null;
        this.activeTopicId = null;
        this.currentSearchQuery = ''; // Clear search query when viewing all tasks
        this.syncSidebarSelection();
        this.updateHeaderBreadcrumbs();
        this.renderGrid();
    }

    refreshCurrentView() {
        if (this.currentSearchQuery) {
            this.handleSearch(this.currentSearchQuery);
            return;
        }

        if (this.activeTopicId && this.activeModuleId) {
            this.renderTopicTasks(this.activeModuleId, this.activeTopicId);
            return;
        }

        if (this.activeModuleId) {
            this.renderModuleTopics(this.activeModuleId);
            return;
        }

        this.renderGrid();
    }

    debounce(fn, wait = 250) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    sortTasks(tasks = []) {
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return [];
        }

        const items = [...tasks];
        if (this.currentSort === 'alphabet') {
            items.sort((a, b) => {
                const nameA = (a.name || a.id || '').toString();
                const nameB = (b.name || b.id || '').toString();
                return this.collator.compare(nameA, nameB);
            });
            return items;
        }

        if (this.currentSort === 'type') {
            const order = ['click', 'click_task', 'draw', 'draw_task', 'test', 'sequence_assembly', 'open_answer'];
            const getIndex = (task) => {
                const idx = order.indexOf(task.type);
                return idx === -1 ? order.length : idx;
            };
            items.sort((a, b) => {
                const diff = getIndex(a) - getIndex(b);
                if (diff !== 0) return diff;
                const nameA = (a.name || a.id || '').toString();
                const nameB = (b.name || b.id || '').toString();
                return this.collator.compare(nameA, nameB);
            });
            return items;
        }

        // Default: date (descending)
        items.sort((a, b) => {
            const dateA = new Date(a.created_at || a.createdAt || 0).getTime();
            const dateB = new Date(b.created_at || b.createdAt || 0).getTime();
            return dateB - dateA;
        });
        return items;
    }

    getTaskTypeMeta(task = {}) {
        const isDark = this.isCurrentThemeDark();
        const base = {
            label: task.type || 'Task',
            className: isDark
                ? 'bg-info-dark text-info-text ring-1 ring-inset ring-info-light'
                : 'bg-info-light text-info ring-1 ring-inset ring-info'
        };

        if (task.type === 'click' || task.type === 'click_task') {
            return {
                label: wt('db.k290', 'Клик'),
                className: isDark
                    ? 'bg-secondary-dark text-secondary-text ring-1 ring-inset ring-secondary-light'
                    : 'bg-secondary-light text-secondary ring-1 ring-inset ring-secondary'
            };
        }
        if (task.type === 'draw' || task.type === 'draw_task') {
            return {
                label: wt('db.k291', 'Рисование'),
                className: isDark
                    ? 'bg-success-dark text-success-text ring-1 ring-inset ring-success-light'
                    : 'bg-success-light text-success ring-1 ring-inset ring-success'
            };
        }
        if (task.type === 'test') {
            return {
                label: wt('db.k292', 'Тест'),
                className: isDark
                    ? 'bg-warning-dark text-warning-text ring-1 ring-inset ring-warning-light'
                    : 'bg-warning-light text-warning ring-1 ring-inset ring-warning'
            };
        }
        if (task.type === 'single' || task.type === 'single_choice') {
            return {
                label: wt('db.k293', 'Один ответ'),
                className: isDark
                    ? 'bg-warning-dark text-warning-text ring-1 ring-inset ring-warning-light'
                    : 'bg-warning-light text-warning ring-1 ring-inset ring-warning'
            };
        }
        if (task.type === 'text' || task.type === 'text_input') {
            return {
                label: wt('db.k294', 'Текст'),
                className: isDark
                    ? 'bg-info-dark text-info-text ring-1 ring-inset ring-info-light'
                    : 'bg-info-light text-info ring-1 ring-inset ring-info'
            };
        }
        if (task.type === 'sequence_assembly') {
            return {
                label: wt('db.k295', 'Последовательность'),
                className: isDark
                    ? 'bg-primary-dark text-primary-light ring-1 ring-inset ring-primary-light'
                    : 'bg-primary-lighter text-primary ring-1 ring-inset ring-primary'
            };
        }
        if (task.type === 'open_answer') {
            return {
                label: wt('db.k296', 'Открытый ответ'),
                className: isDark
                    ? 'bg-info-dark text-info-text ring-1 ring-inset ring-info-light'
                    : 'bg-info-light text-info ring-1 ring-inset ring-info'
            };
        }
        return base;
    }

    // =========================================================================
    // Selection & Bulk Actions
    // =========================================================================

    toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;

        // Update header button state
        const btn = document.getElementById('toggle-select-btn');
        if (btn) {
            btn.classList.toggle('text-primary', this.selectionMode);
            btn.classList.toggle('bg-primary-lighter', this.selectionMode);
        }

        // If exiting mode, clear selection
        if (!this.selectionMode) {
            this.selectedTasks.clear();
            this.lastSelectedTaskId = null;
        }

        this.updateActionBar();
        this.renderGrid(); // Re-render to update UI state
    }

    cancelSelection() {
        this.selectionMode = false;
        this.selectedTasks.clear();
        this.lastSelectedTaskId = null;
        this.updateActionBar();
        this.renderGrid();

        // Update button
        const btn = document.getElementById('toggle-select-btn');
        if (btn) {
            btn.classList.remove('text-primary', 'bg-primary-lighter');
        }
    }

    handleTaskSelection(uniqueId, isSelected, isShiftClick) {
        if (!this.selectionMode) {
            this.selectionMode = true; // Auto-enter mode
            const btn = document.getElementById('toggle-select-btn');
            if (btn) btn.classList.add('text-primary', 'bg-primary-lighter');
        }

        if (isShiftClick && this.lastSelectedTaskId) {
            // Range selection logic
            this._selectRange(this.lastSelectedTaskId, uniqueId, isSelected);
        } else {
            // Single selection
            if (isSelected) {
                this.selectedTasks.add(uniqueId);
                this.lastSelectedTaskId = uniqueId;
            } else {
                this.selectedTasks.delete(uniqueId);
                this.lastSelectedTaskId = null;
            }
        }

        this.updateActionBar();

        // Visual update without full re-render for performance
        const card = document.querySelector(`article[data-task-id="${uniqueId}"]`);
        if (card) {
            this._updateCardVisualState(card, this.selectedTasks.has(uniqueId));
            const cb = card.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = this.selectedTasks.has(uniqueId);
        }
    }

    _updateCardVisualState(card, isSelected) {
        if (isSelected) {
            card.classList.add('bg-surface-2', 'border-primary', 'ring-2', 'ring-primary');
            card.classList.remove('border-border-subtle');
        } else {
            card.classList.remove('border-primary', 'ring-2', 'ring-primary');
            card.classList.add('border-border-subtle');
        }
    }

    _selectRange(startId, endId, select) {
        // Need current visible tasks list order
        const cards = Array.from(document.querySelectorAll('article[data-task-id]'));
        const ids = cards.map(c => c.dataset.taskId);

        const startIdx = ids.indexOf(startId);
        const endIdx = ids.indexOf(endId);

        if (startIdx === -1 || endIdx === -1) return;

        const [min, max] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];

        for (let i = min; i <= max; i++) {
            const id = ids[i];
            if (select) {
                this.selectedTasks.add(id);
            } else {
                this.selectedTasks.delete(id);
            }

            // Visual update
            const card = cards[i];
            const cb = card.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = select;
            this._updateCardVisualState(card, select);
        }
    }

    updateActionBar() {
        const bar = document.getElementById('selection-action-bar');
        const counter = document.getElementById('selection-counter');

        if (!bar || !counter) return;

        const count = this.selectedTasks.size;
        const exportBtn = bar.querySelector('[data-role="selection-export"]') || document.querySelector('#selection-action-bar [onclick*="exportSelectedTasks"]');
        const hasArchivedSelection = Array.from(this.selectedTasks)
            .some((uniqueId) => this.isTaskUniqueIdPremiumArchived(uniqueId));

        if (count > 0 || this.selectionMode) {
            bar.classList.remove('translate-y-[200%]');
            counter.textContent = `${count} ${wt('db.k297', 'выбрано')}`;
        } else {
            bar.classList.add('translate-y-[200%]');
        }

        if (exportBtn) {
            const exportBlocked = count === 0 || hasArchivedSelection;
            exportBtn.disabled = exportBlocked;
            exportBtn.classList.toggle('opacity-60', exportBlocked);
            exportBtn.classList.toggle('cursor-not-allowed', exportBlocked);
            exportBtn.title = hasArchivedSelection
                ? wt('db.k298', 'Экспорт недоступен: среди выбранных заданий есть архив Premium.')
                : wt('db.k299', 'Экспортировать выбранные задания');
        }
    }

    async exportSelectedTasks() {
        if (this.selectedTasks.size === 0) return;
        const hasArchivedSelection = Array.from(this.selectedTasks)
            .some((uniqueId) => this.isTaskUniqueIdPremiumArchived(uniqueId));
        if (hasArchivedSelection) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('db.k300', 'Экспорт недоступен для архива Premium.'),
                impact: wt('db.k301', 'Среди выбранных заданий есть материалы с ограниченным доступом.'),
                next: wt('db.k302', 'Снимите выделение с архивных заданий или продлите Premium.'),
            });
            return;
        }

        const tasksToExport = [];
        this.selectedTasks.forEach(uniqueId => {
            const [moduleId, topicId, taskId] = uniqueId.split(':');
            tasksToExport.push({
                module_id: moduleId,
                topic_id: topicId,
                task_id: taskId
            });
        });

        // Show loading state on button
        const btn = document.querySelector('#selection-action-bar [onclick*="exportSelectedTasks"]') || document.querySelector('#selection-action-bar button:nth-child(4)');
        if (!btn) return;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-text-on-dark"></div>';

        try {
            const response = await fetch('/api/editor/export/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tasks: tasksToExport })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tasks_export_${new Date().toISOString().slice(0, 10)}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            // Exit selection mode after successful export? Or keep it?
            // Keep it for now, user can click X
        } catch (error) {
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k303', 'Экспорт выбранных заданий не выполнен.'),
                impact: wt('db.k304', 'Файл экспорта не был сформирован.'),
                next: error?.message ? `${wt('db.k305', 'Проверьте ограничения и повторите')} (${error.message}).` : wt('db.k306', 'Повторите экспорт позже.'),
            });
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    isErrorDetectionTask(task = {}) {
        if (!task || (task.type !== 'click' && task.type !== 'click_task')) {
            return false;
        }
        const subtype = task.subtype
            || task.metadata?.subtype
            || task.task_data?.subtype
            || task.task_data?.content?.subtype;
        return subtype === 'error_detection';
    }

    createModuleElement(module) {
        const container = document.createElement('div');
        container.className = 'flex flex-col';
        container.dataset.module = module.id;

        const button = document.createElement('button');
        button.className = 'editor-sidebar-tree-button flex items-center gap-2 px-3 min-h-[2.5rem] text-text-secondary hover:text-text-main hover:bg-bg-hover rounded-lg transition-colors group w-full text-left';
        button.dataset.moduleButton = module.id;
        button.innerHTML = `
            <span class="material-symbols-outlined text-[20px] group-hover:text-primary transition-colors">folder_open</span>
            <span class="editor-sidebar-tree-label truncate text-sm font-medium flex-1" title="${module.name || module.id}">${module.name || module.id}</span>
            <div class="editor-sidebar-tree-actions h-full">
                <div class="editor-sidebar-tree-hover-actions">
                    <span class="material-symbols-outlined text-[16px] text-text-disabled hover:text-primary transition-colors p-0.5 rounded hover:bg-primary-lighter"
                          onclick="dashboard.startRenameModule('${module.id}'); event.stopPropagation();"
                          title="${wt('db.k307', 'Переименовать модуль')}">edit</span>
                    <span class="material-symbols-outlined text-[16px] text-text-disabled hover:text-error transition-colors p-0.5 rounded hover:bg-error-lighter"
                          onclick="dashboard.deleteModule('${module.id}'); event.stopPropagation();"
                          title="${wt('db.k308', 'Удалить модуль')}">delete</span>
                </div>
                <span class="material-symbols-outlined text-[16px] p-0.5 transition-transform" data-role="toggle">expand_more</span>
            </div>
        `;

        const childrenContainer = document.createElement('div');
        // Check if expanded
        const isExpanded = this.expandedState.modules.includes(module.id);
        const expandedClass = isExpanded
            ? (this.onboardingDemoActive ? '' : 'animate-slide-up')
            : 'hidden';

        childrenContainer.className = `flex flex-col ml-3 pl-3 border-l border-border-subtle mt-1 gap-1 ${expandedClass}`;
        childrenContainer.dataset.moduleChildren = module.id;
        const chevron = button.querySelector('[data-role="toggle"]');
        if (chevron) {
            chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        }

        if (module.topics && module.topics.length > 0) {
            module.topics.forEach(topic => {
                const topicEl = this.createTopicElement(topic, module.id);
                childrenContainer.appendChild(topicEl);
            });
        }

        const toggleChildren = () => {
            const isHidden = childrenContainer.classList.contains('hidden');
            if (isHidden) {
                childrenContainer.classList.remove('hidden');
                if (!this.onboardingDemoActive) {
                    childrenContainer.classList.add('animate-slide-up');
                }
                if (chevron) {
                    chevron.style.transform = 'rotate(0deg)';
                }
                // Update state
                this.ensureModuleExpandedState(module.id);
            } else {
                childrenContainer.classList.add('hidden');
                childrenContainer.classList.remove('animate-slide-up');
                if (chevron) {
                    chevron.style.transform = 'rotate(-90deg)';
                }
                this.removeModuleExpandedState(module.id);
            }
        };

        if (chevron) {
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleChildren();
            });
        }

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleChildren();
        });

        // Add "New Topic" button at the bottom of children
        const addTopicBtn = document.createElement('button');
        addTopicBtn.className = 'editor-sidebar-tree-button flex items-center gap-2 px-3 min-h-[2.5rem] text-text-secondary hover:text-primary hover:bg-bg-hover rounded-lg transition-all w-full text-left mt-1';
        addTopicBtn.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">add_circle</span>
            <span class="editor-sidebar-tree-label text-sm font-medium">${wt('db.k309', 'Добавить тему')}</span>
        `;
        addTopicBtn.onclick = (e) => {
            e.stopPropagation();
            this.showTopicModal(module.id);
        };
        childrenContainer.appendChild(addTopicBtn);

        container.appendChild(button);
        container.appendChild(childrenContainer);
        return container;
    }

    createTopicElement(topic, moduleId) {
        const container = document.createElement('div');
        container.className = 'flex flex-col';
        container.dataset.topic = `${moduleId}:${topic.id}`;
        const theoryLink = (topic && typeof topic.theory_link === 'object') ? topic.theory_link : null;
        const theoryId = theoryLink && typeof theoryLink.theory_id === 'string' ? theoryLink.theory_id : '';
        const hasTheoryLink = Boolean(theoryId);
        const theoryBadge = hasTheoryLink
            ? wt('db.k310', '<span class="inline-flex items-center justify-center w-5 h-5 rounded-full border border-primary-light bg-primary-lighter text-primary" title="У темы есть привязка к теории"><span class="material-symbols-outlined text-[13px]">menu_book</span></span>')
            : '';

        const button = document.createElement('button');
        button.className = 'editor-sidebar-tree-button flex items-center gap-2 px-3 min-h-[2.5rem] text-text-secondary hover:text-text-main hover:bg-bg-hover rounded-lg transition-colors w-full text-left group';
        button.dataset.topicButton = topic.id;
        button.dataset.topicModule = moduleId;
        button.innerHTML = `
            <span class="material-symbols-outlined text-[20px]">folder</span>
            <span class="editor-sidebar-tree-label truncate text-sm font-medium flex-1" title="${topic.name || topic.id}">${topic.name || topic.id}</span>
            ${theoryBadge}
            <div class="editor-sidebar-tree-actions h-full">
                <div class="editor-sidebar-tree-hover-actions">
                    <span class="material-symbols-outlined text-[16px] text-text-disabled hover:text-primary transition-colors p-0.5 rounded hover:bg-primary-lighter"
                          onclick="dashboard.startRenameTopic('${moduleId}', '${topic.id}'); event.stopPropagation();"
                          title="${wt('db.k311', 'Переименовать тему')}">edit</span>
                    <span class="material-symbols-outlined text-[16px] text-text-disabled hover:text-error transition-colors p-0.5 rounded hover:bg-error-lighter"
                          onclick="dashboard.deleteTopic('${moduleId}', '${topic.id}'); event.stopPropagation();"
                          title="${wt('db.k312', 'Удалить тему')}">delete</span>
                </div>
                <span class="material-symbols-outlined text-[16px] p-0.5 transition-transform" data-role="toggle">expand_more</span>
            </div>
        `;
        const actionsGroup = button.querySelector('.editor-sidebar-tree-hover-actions');
        if (actionsGroup) {
            const syncTheoryAction = document.createElement('span');
            syncTheoryAction.className = 'material-symbols-outlined text-[16px] text-text-disabled hover:text-primary transition-colors p-0.5 rounded hover:bg-primary-lighter';
            syncTheoryAction.textContent = 'sync_alt';
            syncTheoryAction.title = wt('db.k313', 'Синхронизировать привязку темы с комплексами');
            syncTheoryAction.dataset.role = 'topic-theory-sync';
            syncTheoryAction.dataset.moduleId = moduleId;
            syncTheoryAction.dataset.topicId = topic.id;
            syncTheoryAction.addEventListener('click', (event) => {
                event.stopPropagation();
                this.showSyncTheoryConfirmation(moduleId, topic.id, syncTheoryAction, topic.name);
            });

            const theoryAction = document.createElement('span');
            theoryAction.className = 'material-symbols-outlined text-[16px] text-text-disabled hover:text-primary transition-colors p-0.5 rounded hover:bg-primary-lighter';
            theoryAction.textContent = 'menu_book';
            theoryAction.dataset.role = 'topic-theory-open';
            theoryAction.dataset.moduleId = moduleId;
            theoryAction.dataset.topicId = topic.id;
            theoryAction.title = wt('db.k314', 'Настроить теорию темы');
            theoryAction.addEventListener('click', (event) => {
                event.stopPropagation();
                this.showTopicTheoryModal(moduleId, topic.id);
            });
            actionsGroup.insertBefore(theoryAction, actionsGroup.firstChild);
            actionsGroup.insertBefore(syncTheoryAction, actionsGroup.firstChild);
        }
        const chevron = button.querySelector('[data-role="toggle"]');

        const topicKey = `${moduleId}:${topic.id}`;
        const isExpanded = this.expandedState.topics.includes(topicKey);

        if (chevron) {
            chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        }

        const tasksContainer = document.createElement('div');
        const expandedClass = isExpanded
            ? (this.onboardingDemoActive ? '' : 'animate-slide-up')
            : 'hidden';
        tasksContainer.className = `flex flex-col ml-3 pl-3 border-l border-border-subtle my-1 gap-1 ${expandedClass}`;
        tasksContainer.dataset.topicTasks = topicKey;

        if (topic.tasks && topic.tasks.length > 0) {
            topic.tasks.forEach(task => {
                const taskEl = this.createTaskElement(
                    this.normalizeCatalogTask(task, {
                        moduleId,
                        moduleName: this.catalog.find((m) => m.id === moduleId)?.name || moduleId,
                        topicId: topic.id,
                        topicName: topic.name || topic.id,
                    }),
                    moduleId,
                    topic.id
                );
                tasksContainer.appendChild(taskEl);
            });
        }
        this.collectDraftOnlyTasks({ moduleId, topicId: topic.id }).forEach((task) => {
            const draftTaskEl = this.createTaskElement(task, moduleId, topic.id);
            tasksContainer.appendChild(draftTaskEl);
        });

        const toggleTasks = () => {
            const isHidden = tasksContainer.classList.contains('hidden');
            if (isHidden) {
                tasksContainer.classList.remove('hidden');
                if (!this.onboardingDemoActive) {
                    tasksContainer.classList.add('animate-slide-up');
                }
                if (chevron) {
                    chevron.style.transform = 'rotate(0deg)';
                }
                // Update state
                this.ensureTopicExpandedState(moduleId, topic.id);
            } else {
                tasksContainer.classList.add('hidden');
                tasksContainer.classList.remove('animate-slide-up');
                if (chevron) {
                    chevron.style.transform = 'rotate(-90deg)';
                }
                this.removeTopicExpandedState(moduleId, topic.id);
            }
        };

        if (chevron) {
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTasks();
            });
        }

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            // Original behavior: render tasks in grid
            this.renderTopicTasks(moduleId, topic.id);
            // Also ensure it expands
            if (tasksContainer.classList.contains('hidden')) {
                toggleTasks();
            }
        });

        // Add "New Task" button at the bottom of tasks
        const addTaskBtn = document.createElement('button');
        addTaskBtn.className = 'editor-sidebar-tree-button flex items-center gap-2 px-3 min-h-[2.5rem] text-text-secondary hover:text-primary hover:bg-bg-hover rounded-lg transition-all w-full text-left mt-1';
        addTaskBtn.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">add_circle</span>
            <span class="editor-sidebar-tree-label text-sm font-medium">${wt('db.k315', 'Добавить задание')}</span>
        `;
        addTaskBtn.onclick = (e) => {
            e.stopPropagation();
            // Pre-select module and topic in the task modal and show it
            const moduleSelect = document.querySelector('#task-module-select');
            moduleSelect.value = moduleId;
            this.updateTopicSelect();
            const topicSelect = document.querySelector('#task-topic-select');
            topicSelect.value = topic.id;
            this.showCreateTaskModal();
        };
        tasksContainer.appendChild(addTaskBtn);

        container.appendChild(button);
        container.appendChild(tasksContainer);
        return container;
    }

    createTaskElement(task, moduleId, topicId) {
        const button = document.createElement('button');
        const baseClasses = 'editor-sidebar-tree-button flex items-center gap-2 px-3 min-h-[2.5rem] rounded-lg w-full text-left transition-colors';
        const tone = 'text-text-secondary hover:text-text-main hover:bg-bg-hover';
        button.className = `${baseClasses} ${tone}`;

        let icon = 'description';
        if (task.type === 'video') icon = 'play_circle';
        if (task.type === 'click' || task.type === 'click_task') icon = 'touch_app';
        if (task.type === 'draw' || task.type === 'draw_task') icon = 'draw';
        if (task.type === 'test') icon = 'quiz';
        if (task.type === 'sequence_assembly') icon = 'reorder';
        if (task.type === 'open_answer') icon = 'edit_note';

        button.innerHTML = `
            <span class="material-symbols-outlined text-[20px]">${icon}</span>
            <span class="editor-sidebar-tree-label truncate text-sm font-medium flex-1">${task.name || task.id}</span>
            ${task.isDraftOnly ? wt('db.k316', '<span class="inline-flex h-5 items-center gap-1 rounded-full border border-warning-light bg-warning-lighter px-1.5 py-0 text-[10px] font-semibold leading-none text-warning-darker">Черновик</span>') : ''}
        `;

        button.addEventListener('click', () => {
            this.openTaskEntry(task, moduleId, topicId);
        });

        return button;
    }

    expandSidebarModule(moduleId, { saveState = true } = {}) {
        if (!moduleId) return;
        const moduleContainer = document.querySelector(`[data-module="${moduleId}"]`);
        const children = moduleContainer?.querySelector(`[data-module-children="${moduleId}"]`);
        const chevron = moduleContainer?.querySelector('[data-role="toggle"]');
        if (children && children.classList.contains('hidden')) {
            children.classList.remove('hidden');
            if (!this.onboardingDemoActive) {
                children.classList.add('animate-slide-up');
            }
        }
        if (chevron) {
            chevron.style.transform = 'rotate(0deg)';
        }
        this.ensureModuleExpandedState(moduleId, { save: saveState });
    }

    expandSidebarTopic(moduleId, topicId, { saveState = true } = {}) {
        if (!moduleId || !topicId) return;
        const topicContainer = document.querySelector(`[data-topic="${moduleId}:${topicId}"]`);
        const tasksContainer = topicContainer?.querySelector(`[data-topic-tasks="${moduleId}:${topicId}"]`);
        const chevron = topicContainer?.querySelector('[data-role="toggle"]');
        if (tasksContainer && tasksContainer.classList.contains('hidden')) {
            tasksContainer.classList.remove('hidden');
            if (!this.onboardingDemoActive) {
                tasksContainer.classList.add('animate-slide-up');
            }
        }
        if (chevron) {
            chevron.style.transform = 'rotate(0deg)';
        }
        this.ensureModuleExpandedState(moduleId, { save: false });
        this.ensureTopicExpandedState(moduleId, topicId, { save: saveState });
    }

    syncSidebarSelection() {
        document.querySelectorAll('[data-onboarding-target="editor-active-topic"]').forEach((node) => {
            node.removeAttribute('data-onboarding-target');
        });
        const moduleButtons = document.querySelectorAll('[data-module-button]');
        moduleButtons.forEach(btn => {
            const isActive = this.activeModuleId && btn.dataset.moduleButton === this.activeModuleId;
            btn.classList.toggle('bg-bg-hover', Boolean(isActive));
            btn.classList.toggle('text-primary', Boolean(isActive));
            btn.classList.toggle('ring-1', Boolean(isActive));
            btn.classList.toggle('ring-primary-light', Boolean(isActive));
        });

        const topicButtons = document.querySelectorAll('[data-topic-button]');
        topicButtons.forEach(btn => {
            const moduleId = btn.dataset.topicModule;
            const topicId = btn.dataset.topicButton;
            const isActive = this.activeModuleId === moduleId && this.activeTopicId === topicId;

            // Theme-aware active state
            const isDark = this.isCurrentThemeDark();
            const activeBg = isDark ? 'bg-primary-dark' : 'bg-primary-lighter';
            const activeText = isDark ? 'text-primary-lighter' : 'text-primary-dark';
            const allActiveClasses = ['bg-primary-dark', 'text-primary-lighter', 'bg-primary-lighter', 'text-primary', 'text-primary-dark'];

            if (isActive) {
                btn.classList.remove(...allActiveClasses);
                btn.classList.add(activeBg, activeText, 'font-semibold');
                btn.setAttribute('data-onboarding-target', 'editor-active-topic');
                this.expandSidebarTopic(moduleId, topicId);
            } else {
                btn.classList.remove(...allActiveClasses, 'font-semibold');
            }
        });

        if (this.activeModuleId) {
            this.expandSidebarModule(this.activeModuleId);
        }

        const allBtn = document.querySelector('[data-all-tasks-button]');
        if (allBtn) {
            const isAllActive = !this.activeModuleId && !this.activeTopicId && !this.currentSearchQuery;
            const isDark = this.isCurrentThemeDark();
            const activeBg = isDark ? 'bg-primary-dark' : 'bg-primary-lighter';
            const activeText = isDark ? 'text-primary-lighter' : 'text-primary-dark';
            const allActiveClasses = ['bg-primary-dark', 'text-primary-lighter', 'bg-primary-lighter', 'text-primary', 'text-primary-dark'];

            if (isAllActive) {
                allBtn.classList.remove(...allActiveClasses);
                allBtn.classList.add(activeBg, activeText, 'font-semibold');
            } else {
                allBtn.classList.remove(...allActiveClasses, 'font-semibold');
            }
        }
    }

    async loadTask(moduleId, topicId, taskId, options = {}) {
        try {
            const response = await fetch(`/api/editor/task/${moduleId}/${topicId}/${taskId}`);
            const data = await response.json();
            if (data.ok) {
                console.log("Task loaded:", data.task);
                const taskMeta = data.task?.metadata || {};
                const moduleFromCatalog = this.catalog.find((m) => m.id === moduleId);
                const topicFromCatalog = (moduleFromCatalog?.topics || []).find((t) => t.id === topicId);
                this.registerTaskVisit({
                    moduleId,
                    topicId,
                    taskId,
                    name: taskMeta.name || taskId,
                    moduleName: moduleFromCatalog?.name || moduleId,
                    topicName: topicFromCatalog?.name || topicId,
                    type: data.task?.task_data?.type || data.task?.task_data?.task_type || ''
                });
                this.switchEditor(data.task, options);
            } else {
                console.error("Failed to load task:", data.error);
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k317', 'Задача не открыта.'),
                    impact: wt('db.k318', 'Редактор не получил данные задания.'),
                    next: data?.error ? `${wt('db.k319', 'Проверьте состояние задачи')} (${data.error}) ${wt('db.k320', 'и повторите.')}` : wt('db.k321', 'Повторите открытие задания.'),
                });
            }
        } catch (error) {
            console.error("Error fetching task:", error);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k322', 'Задача не открыта из-за сетевой ошибки.'),
                impact: wt('db.k323', 'Переход в редактор отменён.'),
                next: wt('db.k324', 'Проверьте сеть и повторите попытку.'),
            });
        }
    }

    switchEditor(task, options = {}) {
        const type = task.task_data.type || task.task_data.task_type;
        const taskMeta = task?.task_data?.meta || {};
        const rootMeta = task?.metadata || {};
        const canonicalTaskId = taskMeta.id || rootMeta.id || task?.task_data?.id;
        console.log(`Switching to ${type} editor for task: ${canonicalTaskId}`);

        let editorPage = '';
        if (type === 'click' || type === 'click_task') editorPage = 'Point_Annotation.html';
        if (type === 'draw' || type === 'draw_task') editorPage = 'Point_Annotation.html';
        if (type === 'test') editorPage = 'Test Task Editor Multiple Choice.html';
        if (type === 'sequence_assembly') editorPage = 'Sequence Assembly Editor Procedural Steps.html';
        if (type === 'open_answer') editorPage = 'Open Answer Editor Textual Reasoning.html';

        if (editorPage) {
            let m = taskMeta.module || rootMeta.module;
            let t = taskMeta.topic || rootMeta.topic;
            const id = canonicalTaskId;

            if ((!m || !t) && typeof rootMeta.path === 'string') {
                const normalizedPath = rootMeta.path.replace(/\\/g, '/');
                const match = normalizedPath.match(/modules\/([^/]+)\/topics\/([^/]+)\/tasks\/[^/]+\/task\.json$/);
                if (match) {
                    m = m || match[1];
                    t = t || match[2];
                }
            }

            if (!m || !t || !id) {
                console.error('Cannot open editor: missing module/topic/task metadata', task);
                return;
            }
            window.navigateWithTransition(
                this.getEditorUrl(type, m, t, id, {
                    restoreDraft: Boolean(options.restoreDraft),
                })
            );
        }
    }

    cleanCatalog(modules) {
        if (!Array.isArray(modules)) return [];

        const isPlaceholderTask = (task) => {
            const name = (task?.name || task?.id || '').trim().toLowerCase();
            return this.placeholderTaskNames.includes(name);
        };

        return modules.map(module => {
            const topics = (module.topics || []).map(topic => {
                const tasks = (topic.tasks || []).filter(task => !isPlaceholderTask(task));
                return { ...topic, tasks };
            });
            return { ...module, topics };
        });
    }

    showImportModal() {
        const modal = document.getElementById('import-modal');
        if (!modal) {
            console.error('[Dashboard] Import modal not found');
            return;
        }

        if (!modal._cancelListenerAdded) {
            modal.addEventListener('cancel', (e) => {
                e.preventDefault();
                this.closeImportModal();
            });
            modal._cancelListenerAdded = true;
        }

        if (typeof modal.showModal === 'function' && !modal.open) {
            modal.showModal();
        } else {
            modal.classList.remove('hidden');
        }

        if (this.importManager) {
            this.openDirectImportWorkspace();
        } else {
            console.error('[Dashboard] ImportManager not initialized');
        }
    }

    openDirectImportWorkspace() {
        if (!this.importManager) {
            console.error('[Dashboard] ImportManager not initialized');
            return;
        }
        this.importManager.resetWorkspaceImportState();
        this.importManager.enterImportModalMode();
        this.importManager.presetFromCurrentLocation();
        this.importManager.goToStep(1);
        this.importManager.aiCheckStatus().catch(() => {});
    }

    showWorkspaceImportPreviewModal(payload = {}) {
        void payload;
        this.showVoiceToast({
            severity: 'info',
            what: 'Legacy import is internal-only.',
            impact: 'This modal is no longer available from hosted editor surfaces.',
            next: 'Use direct read-only library access or author a new workspace complex.',
        });
        return;
        const modal = document.getElementById('import-modal');
        if (!modal) {
            console.error('[Dashboard] Import modal not found');
            return;
        }

        modal.classList.remove('hidden');

        if (this.importManager) {
            this.importManager.openWorkspaceImportPreviewFlow(payload).catch((e) => {
                console.error('[Dashboard] Failed to open workspace import preview:', e);
            });
        } else {
            console.error('[Dashboard] ImportManager not initialized');
        }
    }

    showTheoryAnalysisModal(intent = 'analysis') {
        const modal = document.getElementById('import-modal');
        if (!modal) {
            console.error('[Dashboard] Theory analysis modal not found');
            return;
        }

        if (!modal._cancelListenerAdded) {
            modal.addEventListener('cancel', (e) => {
                e.preventDefault();
                this.closeImportModal();
            });
            modal._cancelListenerAdded = true;
        }

        if (typeof modal.showModal === 'function' && !modal.open) {
            modal.showModal();
        } else {
            modal.classList.remove('hidden');
        }

        if (this.importManager) {
            if (intent === 'microcards_manual') {
                this.importManager.openManualMicrocardsEditor().catch((e) => {
                    console.error('[Dashboard] Failed to open manual microcards editor:', e);
                });
            } else {
                this.openTheoryWorkspace().catch((e) => {
                    console.error('[Dashboard] Failed to open theory analysis mode:', e);
                });
            }
        } else {
            console.error('[Dashboard] ImportManager not initialized');
        }
    }

    async openTheoryWorkspace() {
        if (!this.importManager) {
            console.error('[Dashboard] ImportManager not initialized');
            return;
        }
        this.importManager.presetFromCurrentLocation();
        return this.importManager.openTheoryAnalysisMode();
    }

    async closeImportModal(options = {}) {
        const skipConfirm = options && options.skipConfirm === true;
        const modal = document.getElementById('import-modal');

        if (this.importManager) {
            if (!skipConfirm && typeof this.importManager.confirmImportModalCloseIfNeeded === 'function') {
                const confirmed = await this.importManager.confirmImportModalCloseIfNeeded();
                if (!confirmed) return false;
            }

            const performClose = async () => {
                const handleEnd = (event) => {
                    if (event.animationName === 'scaleOut') {
                        modal.removeEventListener('animationend', handleEnd);
                        modal.close();
                        modal.classList.remove('closing');
                        this.resetImportModalStateAfterClose();
                    }
                };
                if (modal && typeof modal.close === 'function') {
                    modal.classList.add('closing');
                    modal.addEventListener('animationend', handleEnd);
                    // Fallback
                    setTimeout(() => {
                        if (modal.classList.contains('closing')) {
                            modal.removeEventListener('animationend', handleEnd);
                            modal.close();
                            modal.classList.remove('closing');
                            this.resetImportModalStateAfterClose();
                        }
                    }, 250);
                } else if (modal) {
                    modal.classList.add('hidden');
                    this.resetImportModalStateAfterClose();
                }
            };

            await performClose();
            return true;
        }

        if (modal) {
            if (typeof modal.close === 'function') {
                modal.close();
            } else {
                modal.classList.add('hidden');
            }
        }
        return true;
    }

    resetImportModalStateAfterClose() {
        if (!this.importManager) return;

        if (this.importManager.modalPurpose === 'theory_analysis') {
            this.importManager.setModalPurpose('import');
            this.importManager.materialText = '';
            this.importManager.aiUploadedFile = null;
            this.importManager.aiFileInfo = null;
            this.importManager.analysisResult = null;
            this.importManager.generationResult = null;
            this.importManager.aiProvider = null;
            this.importManager.aiProviderModel = null;
            this.importManager.aiRunId = null;
            this.importManager.aiSelectedRecs.clear();
            this.importManager.aiGenerating = false;
            this.importManager.aiAnalyzing = false;
            this.importManager.theoryOpeningRunId = null;
            this.importManager.importRequestKey = null;
            this.importManager.currentStep = 1;
            this.importManager.importMode = 'text';
        } else {
            if (typeof this.importManager.resetImportModalState === 'function') {
                this.importManager.resetImportModalState().catch((e) => {
                    console.error('[Dashboard] Failed to reset import modal state after close:', e);
                });
            }
        }
    }


    showRecoveryCenter() {
        const modal = document.getElementById('recovery-center-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        this.renderRecoveryCenter();
        this.renderWorkspaceShortcuts();
    }

    closeRecoveryCenter() {
        const modal = document.getElementById('recovery-center-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    collectRecoveryDrafts() {
        const drafts = [];
        if (!this.currentUserIdResolved) {
            return drafts;
        }
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (!key) continue;

                if (key.startsWith('task_draft_')) {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    if (!parsed || !parsed.moduleId || !parsed.topicId || !parsed.taskId) continue;
                    const ownerUserId = this.normalizeRecoveryDraftOwnerUserId(parsed);
                    if (!this.isRecoveryDraftVisibleToCurrentUser(ownerUserId, { requireOwner: true })) continue;
                    const draftTaskName =
                        typeof parsed.taskName === 'string' && parsed.taskName.trim()
                            ? parsed.taskName.trim()
                            : (
                                (parsed.data && typeof parsed.data === 'object' && typeof parsed.data.name === 'string' && parsed.data.name.trim())
                                || (parsed.data && typeof parsed.data === 'object' && parsed.data.meta && typeof parsed.data.meta.name === 'string' && parsed.data.meta.name.trim())
                                || ''
                            );
                    drafts.push({
                        kind: 'task',
                        storageKey: key,
                        moduleId: parsed.moduleId,
                        topicId: parsed.topicId,
                        taskId: parsed.taskId,
                        taskName: draftTaskName,
                        moduleName: typeof parsed.moduleName === 'string' ? parsed.moduleName : '',
                        topicName: typeof parsed.topicName === 'string' ? parsed.topicName : '',
                        taskType: typeof parsed.taskType === 'string' ? parsed.taskType : this.inferTaskTypeFromDraftPayload(parsed.data),
                        ownerUserId,
                        draftData: parsed.data && typeof parsed.data === 'object' ? parsed.data : null,
                        timestamp: Number(parsed.timestamp || 0),
                    });
                    continue;
                }

                if (key.startsWith('complex_draft_')) {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    const ownerUserId = this.normalizeRecoveryDraftOwnerUserId(parsed);
                    if (!this.isRecoveryDraftVisibleToCurrentUser(ownerUserId)) continue;
                    drafts.push({
                        kind: 'complex',
                        storageKey: key,
                        complexId: parsed?.id || key.replace(/^complex_draft_/, '') || 'new',
                        ownerUserId,
                        timestamp: Number(parsed?.timestamp || 0),
                    });
                }
            }
        } catch (e) {
            console.warn('[Dashboard] Failed to collect recovery drafts', e);
        }

        return drafts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    inferTaskTypeFromDraftPayload(payload) {
        if (!payload || typeof payload !== 'object') return '';
        const rawType = String(payload.type || payload.task_type || payload.taskType || '').trim();
        if (rawType) return rawType;

        const content = payload.content && typeof payload.content === 'object' ? payload.content : {};
        if (Array.isArray(payload.annotations) || Array.isArray(content.annotations) || payload.errorDetection) {
            return 'click';
        }
        if (Array.isArray(content.regions) || Array.isArray(payload.regions)) {
            return 'draw';
        }
        if (Array.isArray(content.questions) || Array.isArray(payload.questions)) {
            return 'test';
        }
        if (Array.isArray(content.levels) || Array.isArray(payload.levels) || Array.isArray(content.elements)) {
            return 'sequence_assembly';
        }
        if (typeof content.question === 'string' || Array.isArray(content.keywords)) {
            return 'open_answer';
        }
        return '';
    }

    collectTaskDraftIds() {
        const taskDraftIds = new Set();
        this.collectRecoveryDrafts().forEach((item) => {
            if (item?.kind !== 'task') return;
            const context = this.getCatalogTaskContext(item.moduleId, item.topicId, item.taskId);
            const effectiveTaskId = this.getCanonicalTaskId(context.task) || item.taskId;
            const uniqueId = this.makeTaskUniqueId(item.moduleId, item.topicId, effectiveTaskId);
            if (uniqueId) {
                taskDraftIds.add(uniqueId);
            }
        });
        return taskDraftIds;
    }

    getTaskDraftStorageKeysForSelection(moduleId, topicId, taskId) {
        const normalizedModuleId = String(moduleId || '').trim();
        const normalizedTopicId = String(topicId || '').trim();
        const normalizedTaskId = String(taskId || '').trim();
        const keys = new Set();

        if (!normalizedModuleId || !normalizedTopicId || !normalizedTaskId) return keys;

        const targetTaskIds = new Set([normalizedTaskId]);
        const targetContext = this.getCatalogTaskContext(normalizedModuleId, normalizedTopicId, normalizedTaskId);
        [
            this.getCanonicalTaskId(targetContext.task),
            targetContext.task?.id,
            targetContext.task?.legacy_id,
        ].forEach((id) => {
            const cleanId = String(id || '').trim();
            if (cleanId) targetTaskIds.add(cleanId);
        });

        this.collectRecoveryDrafts().forEach((item) => {
            if (item?.kind !== 'task') return;
            if (item.moduleId !== normalizedModuleId || item.topicId !== normalizedTopicId) return;

            const context = this.getCatalogTaskContext(item.moduleId, item.topicId, item.taskId);
            const candidateTaskIds = new Set([
                item.taskId,
                this.getCanonicalTaskId(context.task),
                context.task?.id,
                context.task?.legacy_id,
            ].map((id) => String(id || '').trim()).filter(Boolean));

            const matches = Array.from(candidateTaskIds).some((id) => targetTaskIds.has(id));
            if (matches && item.storageKey) {
                keys.add(item.storageKey);
            }
        });

        [
            `task_draft_${normalizedModuleId}_${normalizedTopicId}_${normalizedTaskId}`,
            this.currentUserId
                ? `task_draft_v2_${encodeURIComponent(this.currentUserId)}_${normalizedModuleId}_${normalizedTopicId}_${normalizedTaskId}`
                : '',
        ].forEach((key) => {
            if (key && localStorage.getItem(key)) keys.add(key);
        });

        return keys;
    }

    removeTaskDraftsForSelection(moduleId, topicId, taskId) {
        let removedCount = 0;
        this.getTaskDraftStorageKeysForSelection(moduleId, topicId, taskId).forEach((key) => {
            if (localStorage.getItem(key)) {
                localStorage.removeItem(key);
                removedCount += 1;
                console.log(`[Dashboard] Removed draft for selected task: ${key}`);
            }
        });
        return removedCount;
    }

    getCatalogTaskContext(moduleId, topicId, taskId = null) {
        const module = (this.catalog || []).find((item) => item.id === moduleId) || null;
        const topic = (module?.topics || []).find((item) => item.id === topicId) || null;
        let task = taskId ? (topic?.tasks || []).find((item) => item.id === taskId) || null : null;

        if (!task && taskId) {
            task = (topic?.tasks || []).find((item) => String(item?.legacy_id || '').trim() === String(taskId || '').trim()) || null;
        }

        if (!task && taskId) {
            const normalizedSuffix = `/tasks/${taskId}/task.json`;
            task = (topic?.tasks || []).find((item) => {
                const path = String(item?.path || '').replace(/\\/g, '/');
                return path.endsWith(normalizedSuffix);
            }) || null;
        }

        return {
            module,
            topic,
            task,
            moduleName: module?.name || moduleId || wt('db.k325', 'Без модуля'),
            topicName: topic?.name || topicId || wt('db.k326', 'Без темы'),
        };
    }

    getVisibleRecoveryDrafts() {
        return this.collectRecoveryDrafts()
            .map((item) => {
                if (item?.kind === 'task') {
                    const context = this.getCatalogTaskContext(item.moduleId, item.topicId, item.taskId);
                    const taskExists = Boolean(context.task);
                    const resolvedTaskId = this.getCanonicalTaskId(context.task) || item.taskId;
                    const moduleName = context.module?.name || item.moduleName || context.moduleName;
                    const topicName = context.topic?.name || item.topicName || context.topicName;
                    return {
                        ...item,
                        taskExists,
                        resolvedTaskId,
                        moduleName,
                        topicName,
                        title: context.task?.name || item.taskName || item.taskId || wt('db.k327', 'Черновик задания'),
                        subtitle: `${moduleName} / ${topicName}`,
                    };
                }

                return {
                    ...item,
                    title: item.complexId && item.complexId !== 'new'
                        ? `${wt('db.k328', 'Комплекс:')} ${item.complexId}`
                        : wt('db.k329', 'Новый комплекс (черновик)'),
                    subtitle: wt('db.k330', 'Конструктор комплексов'),
                };
            });
    }

    collectDraftOnlyTasks(options = {}) {
        const { moduleId = null, topicId = null } = options;
        return this.collectRecoveryDrafts()
            .filter((item) => item?.kind === 'task')
            .map((item) => {
                const context = this.getCatalogTaskContext(item.moduleId, item.topicId, item.taskId);
                if (context.task) return null;
                if (moduleId && item.moduleId !== moduleId) return null;
                if (topicId && item.topicId !== topicId) return null;

                const taskType = String(item.taskType || '').trim();
                const taskLabel = String(item.taskName || item.taskId || '').trim() || wt('db.k331', 'Черновик задания');
                const isoTimestamp = Number(item.timestamp || 0) > 0
                    ? new Date(Number(item.timestamp)).toISOString()
                    : '';

                return {
                    id: item.taskId,
                    name: taskLabel,
                    type: taskType,
                    moduleId: item.moduleId,
                    moduleName: context.module?.name || item.moduleName || context.moduleName,
                    topicId: item.topicId,
                    topicName: context.topic?.name || item.topicName || context.topicName,
                    created_at: isoTimestamp,
                    updated_at: isoTimestamp,
                    isDraftOnly: true,
                    draftTimestamp: Number(item.timestamp || 0),
                    taskType,
                };
            })
            .filter(Boolean)
            .sort((left, right) => (right.draftTimestamp || 0) - (left.draftTimestamp || 0));
    }

    cleanupOrphanedDrafts() {
        if (this.onboardingDemoActive) return;
        try {
            const drafts = this.collectRecoveryDrafts().filter((item) => item?.kind === 'task');
            let cleanedCount = 0;
            const DRAFT_RETENTION_DAYS = 7; // Keep drafts for 7 days for crash recovery
            const retentionMs = DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

            drafts.forEach((draft) => {
                const context = this.getCatalogTaskContext(draft.moduleId, draft.topicId, draft.taskId);
                
                // If module or topic doesn't exist, it's definitely orphaned
                if (!context.module || !context.topic) {
                    console.log(`[Dashboard] Cleaning orphaned draft (no module/topic): ${draft.storageKey}`);
                    localStorage.removeItem(draft.storageKey);
                    cleanedCount++;
                    return;
                }
                
                // If task doesn't exist in the topic's task list, check if it's a recent draft
                if (!context.task) {
                    const draftAge = Date.now() - (draft.timestamp || 0);
                    const isRecentDraft = draftAge < retentionMs;
                    
                    if (isRecentDraft) {
                        // Keep recent drafts for crash recovery - user might not have saved yet
                        console.log(`[Dashboard] Preserving recent draft (${Math.round(draftAge / (24 * 60 * 60 * 1000))} days old): ${draft.storageKey}`);
                        return;
                    }
                    
                    // Delete old orphaned drafts
                    console.log(`[Dashboard] Cleaning old orphaned draft (${Math.round(draftAge / (24 * 60 * 60 * 1000))} days old): ${draft.storageKey}`);
                    localStorage.removeItem(draft.storageKey);
                    cleanedCount++;
                }
            });

            if (cleanedCount > 0) {
                console.log(`[Dashboard] Cleaned ${cleanedCount} orphaned draft(s)`);
            }
        } catch (e) {
            console.warn('[Dashboard] Failed to cleanup orphaned drafts', e);
        }
    }

    openTaskEntry(task, moduleId, topicId, options = {}) {
        if (!task) return;
        const preferDraft = Boolean(options.preferDraft || task.hasDraft);

        if (task.isDraftOnly) {
            const taskType = String(task.taskType || task.type || '').trim();
            if (!taskType) {
                this.showVoiceToast({
                    severity: 'warning',
                    what: wt('db.k332', 'Черновик не открыт.'),
                    impact: wt('db.k333', 'Не удалось определить тип задания для этого черновика.'),
                    next: wt('db.k334', 'Создайте черновик заново или сохраните новый черновик из редактора.'),
                });
                return;
            }
            window.navigateWithTransition(
                this.getEditorUrl(taskType, moduleId, topicId, task.id, {
                    isNew: true,
                    restoreDraft: true,
                    taskType,
                    taskName: task.name || task.id,
                })
            );
            return;
        }

        this.loadTask(moduleId, topicId, this.getCanonicalTaskId(task) || task.id, {
            restoreDraft: preferDraft,
        });
    }

    formatRecoveryTime(timestamp) {
        const date = new Date(Number(timestamp || 0));
        if (Number.isNaN(date.getTime())) return wt('db.k335', 'время неизвестно');
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    renderRecoveryCenter() {
        const drafts = this.getVisibleRecoveryDrafts();
        this.updateRecoveryCenterTrigger(drafts);

        const host = document.getElementById('recovery-center-content');
        if (!host) return;

        host.replaceChildren();
        if (!drafts.length) {
            const empty = document.createElement('div');
            empty.className = 'rounded-xl border border-border-subtle bg-surface-2 p-6 text-center';
            empty.innerHTML = `
                <span class="material-symbols-outlined text-3xl text-text-disabled">history_toggle_off</span>
                <p class="text-sm font-semibold text-text-secondary mt-2">${wt('db.k336', 'Черновиков для восстановления нет')}</p>
                <p class="text-xs text-text-secondary mt-1">${wt('db.k337', 'Когда появятся локальные черновики задач или комплексов, они будут показаны здесь.')}</p>
            `;
            host.appendChild(empty);
            return;
        }

        drafts.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'editor-recovery-card rounded-xl border border-border-subtle bg-surface-2 p-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4';
            card.dataset.recoveryIndex = String(index);

            const title = item.title || wt('db.k338', 'Черновик');
            const subtitle = item.subtitle || wt('db.k339', 'Источник не определён');
            const targetHint = item.kind === 'task'
                ? (item.taskExists
                    ? wt('db.k340', 'Откроется задача и предложит восстановить локальный черновик')
                    : wt('db.k341', 'Откроется редактор черновика задания'))
                : wt('db.k342', 'Откроется конструктор комплексов');

            card.innerHTML = `
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-[18px] text-text-disabled">${item.kind === 'task' ? 'article' : 'widgets'}</span>
                        <p class="editor-recovery-title text-sm font-bold text-text-main">${this.escapeHtml(title)}</p>
                    </div>
                    <p class="editor-recovery-subtitle text-xs mt-1">${this.escapeHtml(subtitle)}</p>
                    <p class="editor-recovery-meta text-[11px] mt-1">${wt('db.k343', 'Автосохранение:')} ${this.escapeHtml(this.formatRecoveryTime(item.timestamp))}</p>
                    <p class="editor-recovery-meta text-[11px] mt-1">${this.escapeHtml(targetHint)}</p>
                </div>
                <div class="editor-recovery-actions shrink-0">
                    <button type="button" data-action="open-recovery" data-index="${index}"
                        class="px-3 py-1.5 rounded-lg bg-primary text-primary-contrast text-xs font-semibold hover:bg-primary-dark transition-colors">
                        ${wt('db.k344', 'Открыть')}
                    </button>
                    <button type="button" data-action="discard-recovery" data-index="${index}"
                        class="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-1 text-text-secondary text-xs font-semibold hover:text-error hover:border-error transition-colors">
                        ${wt('db.k345', 'Удалить')}
                    </button>
                </div>
            `;

            host.appendChild(card);
        });

        host.querySelectorAll('[data-action="open-recovery"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const index = Number(btn.getAttribute('data-index'));
                const item = drafts[index];
                if (!item) return;
                this.openRecoveryDraft(item);
            });
        });

        host.querySelectorAll('[data-action="discard-recovery"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const index = Number(btn.getAttribute('data-index'));
                const item = drafts[index];
                if (!item) return;
                await this.discardRecoveryDraft(item);
            });
        });
    }

    openRecoveryDraft(item) {
        if (!item) return;
        if (item.kind === 'task') {
            this.closeRecoveryCenter();
            if (item.taskExists) {
                this.loadTask(item.moduleId, item.topicId, item.resolvedTaskId || item.taskId, {
                    restoreDraft: true,
                });
                return;
            }
            this.openTaskEntry({
                id: item.taskId,
                name: item.title || item.taskName || item.taskId,
                type: item.taskType,
                taskType: item.taskType,
                moduleId: item.moduleId,
                topicId: item.topicId,
                isDraftOnly: true,
            }, item.moduleId, item.topicId, { preferDraft: true });
            return;
        }

        const complexUrl = item.complexId && item.complexId !== 'new'
            ? `/complexes/create?id=${encodeURIComponent(item.complexId)}`
            : '/complexes/create';
        this.closeRecoveryCenter();
        window.navigateWithTransition(complexUrl);
    }

    async discardRecoveryDraft(item) {
        if (!item?.storageKey) return;
        const ok = await NotificationUI.confirm({
            title: wt('db.k346', 'Удалить черновик?'),
            message: wt('db.k347', 'Черновик будет удалён без возможности восстановления.'),
            confirmText: wt('db.k348', 'Удалить'),
            cancelText: wt('db.k349', 'Отмена'),
            variant: 'warning',
        });
        if (!ok) return;
        localStorage.removeItem(item.storageKey);
        this.showVoiceToast({
            severity: 'info',
            what: wt('db.k350', 'Черновик удалён.'),
            impact: wt('db.k351', 'Данные в облаке не затронуты.'),
            next: wt('db.k352', 'При необходимости откройте другой черновик.'),
        });
        this.renderRecoveryCenter();
        this.renderSidebar();
        this.refreshCurrentView();
    }

    importNextStep() {
        if (this.importManager) {
            this.importManager.handleNext();
        }
    }

    importPrevStep() {
        if (this.importManager) {
            this.importManager.prevStep();
        }
    }

    selectAllVisibleTasks() {
        const grid = document.querySelector('main .grid');
        if (!grid) return;

        const cards = Array.from(grid.querySelectorAll('article.task-card'));
        let addedCount = 0;

        cards.forEach(card => {
            const taskId = card.dataset.taskId;
            if (taskId && !this.selectedTasks.has(taskId)) {
                this.selectedTasks.add(taskId);
                addedCount++;

                // Update UI state
                const checkbox = card.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.checked = true;

                card.classList.add('bg-bg-hover', 'border-primary', 'ring-2', 'ring-primary-light');
                card.classList.remove('bg-surface-2', 'border-border-subtle', 'hover:border-primary-light');
            }
        });

        this.updateActionBar();
    }

    async deleteSelectedTasks() {
        if (this.selectedTasks.size === 0) return;

        const confirmed = await NotificationUI.confirm({
            title: wt('db.k353', 'Удалить задания?'),
            message: `${wt('db.k354', 'Вы действительно хотите удалить выбранные задания')} (${this.selectedTasks.size} ${wt('db.k355', 'шт.')})?`,
            confirmText: wt('db.k356', 'Удалить'),
            cancelText: wt('db.k357', 'Отмена'),
            variant: 'error'
        });
        if (!confirmed) return;

        const tasksToDelete = [];
        let draftsCleanedCount = 0;
        let localDraftOnlyCount = 0;

        Array.from(this.selectedTasks).forEach(idStr => {
            const [moduleId, topicId, ...taskIdParts] = String(idStr || '').split(':');
            const taskId = taskIdParts.join(':');
            if (!moduleId || !topicId || !taskId) return;

            const draftKeys = this.getTaskDraftStorageKeysForSelection(moduleId, topicId, taskId);
            const context = this.getCatalogTaskContext(moduleId, topicId, taskId);
            draftsCleanedCount += this.removeTaskDraftsForSelection(moduleId, topicId, taskId);

            if (draftKeys.size > 0 && !context.task) {
                localDraftOnlyCount += 1;
                return;
            }

            tasksToDelete.push({ module_id: moduleId, topic_id: topicId, task_id: taskId });
        });

        if (!tasksToDelete.length) {
            this.selectedTasks.clear();
            this.cancelSelection();
            this.renderSidebar();
            this.refreshCurrentView();
            this.renderRecoveryCenter();

            this.showVoiceToast({
                severity: 'success',
                what: `${wt('db.k358', 'Удалено черновиков:')} ${draftsCleanedCount || localDraftOnlyCount}.`,
                impact: wt('db.k359', 'Локальные черновики удалены с этого устройства.'),
                next: wt('db.k360', 'Список заданий обновлён.'),
            });
            return;
        }

        try {
            const response = await fetch('/api/editor/tasks/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tasks: tasksToDelete })
            });

            const data = await response.json();

            if (data.ok) {
                this.selectedTasks.clear();
                this.cancelSelection();

                // Refresh catalog and view
                await this.loadCatalog();
                this.renderSidebar();
                this.refreshCurrentView();
                this.renderRecoveryCenter();

                const successMessage = draftsCleanedCount > 0
                    ? `${wt('db.k361', 'Удалено заданий:')} ${data.deleted}. ${wt('db.k362', 'Очищено черновиков:')} ${draftsCleanedCount}.`
                    : `${wt('db.k363', 'Удалено заданий:')} ${data.deleted}.`;

                this.showVoiceToast({
                    severity: 'success',
                    what: successMessage,
                    impact: wt('db.k364', 'Выбранные элементы удалены из библиотеки.'),
                    next: wt('db.k365', 'Каталог обновлён автоматически.'),
                });
                if (data.errors && data.errors.length > 0) {
                    this.showVoiceToast({
                        severity: 'warning',
                        what: wt('db.k366', 'Удаление выполнено частично.'),
                        impact: `${wt('db.k367', 'Ошибки:')} ${data.errors.join(', ')}.`,
                        next: wt('db.k368', 'Проверьте проблемные задания и повторите удаление при необходимости.'),
                        timeout: 6000,
                    });
                }
            } else {
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k369', 'Массовое удаление не выполнено.'),
                    impact: wt('db.k370', 'Список заданий не изменён.'),
                    next: data?.error ? `${wt('db.k371', 'Проверьте детали')} (${data.error}) ${wt('db.k372', 'и повторите.')}` : wt('db.k373', 'Повторите операцию позже.'),
                });
            }
        } catch (error) {
            console.error('Delete error:', error);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k374', 'Массовое удаление не выполнено из-за сетевой ошибки.'),
                impact: wt('db.k375', 'Изменения не были применены.'),
                next: wt('db.k376', 'Проверьте сеть и повторите операцию.'),
            });
        }
    }

    // =========================================================================
    // Rename Logic (Modules & Topics)
    // =========================================================================

    startRenameModule(moduleId) {
        const btn = document.querySelector(`[data-module-button="${moduleId}"]`);
        if (!btn) return;
        const nameSpan = btn.querySelector('.truncate');
        if (!nameSpan) return;

        this._startInlineRename(nameSpan, nameSpan.textContent.trim(), async (newName) => {
            if (!newName) return;
            try {
                const resp = await fetch('/api/editor/module/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ module_id: moduleId, name: newName })
                });
                const data = await resp.json();
                if (data.ok) {
                    await this.loadCatalog();
                    this.renderSidebar();
                    this.refreshCurrentView();
                }
            } catch (err) {
                console.error('Rename module failed:', err);
            }
        });
    }

    startRenameTopic(moduleId, topicId) {
        const container = document.querySelector(`[data-topic="${moduleId}:${topicId}"]`);
        if (!container) return;
        const btn = container.querySelector(`[data-topic-button="${topicId}"]`);
        if (!btn) return;
        const nameSpan = btn.querySelector('.truncate');
        if (!nameSpan) return;

        this._startInlineRename(nameSpan, nameSpan.textContent.trim(), async (newName) => {
            if (!newName) return;
            try {
                const resp = await fetch('/api/editor/topic/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ module_id: moduleId, topic_id: topicId, name: newName })
                });
                const data = await resp.json();
                if (data.ok) {
                    await this.loadCatalog();
                    this.renderSidebar();
                    this.refreshCurrentView();
                }
            } catch (err) {
                console.error('Rename topic failed:', err);
            }
        });
    }

    _startInlineRename(spanEl, currentName, onConfirm) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'text-sm font-medium flex-1 bg-surface-2 border border-primary rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary text-text-main w-full';

        const originalDisplay = spanEl.style.display;
        spanEl.style.display = 'none';
        spanEl.parentNode.insertBefore(input, spanEl.nextSibling);
        input.focus();
        input.select();

        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;
            const newName = input.value.trim();
            input.remove();
            spanEl.style.display = originalDisplay || '';
            if (newName && newName !== currentName) {
                spanEl.textContent = newName;
                spanEl.title = newName;
                onConfirm(newName);
            }
        };
        const cancel = () => {
            if (committed) return;
            committed = true;
            input.remove();
            spanEl.style.display = originalDisplay || '';
        };

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', () => {
            setTimeout(commit, 100);
        });
    }

    // =========================================================================
    // Deletion Undo Logic (Modules & Topics)
    // =========================================================================

    deleteModule(moduleId) {
        if (this.pendingDeletions.has(`module:${moduleId}`)) return;

        // Find module name for confirmation
        const module = this.catalog.find(m => m.id === moduleId);
        const name = module ? (module.name || module.id) : moduleId;

        this.showDeleteConfirmation('module', moduleId, name);
    }

    deleteTopic(moduleId, topicId) {
        const key = `topic:${moduleId}:${topicId}`;
        if (this.pendingDeletions.has(key)) return;

        // Find topic name for confirmation
        let name = topicId;
        const module = this.catalog.find(m => m.id === moduleId);
        if (module && module.topics) {
            const topic = module.topics.find(t => t.id === topicId);
            if (topic) name = topic.name || topic.id;
        }

        this.showDeleteConfirmation('topic', moduleId, topicId, name);
    }

    showDeleteConfirmation(type, ...args) {
        const overlay = document.getElementById('sidebar-blur-overlay');
        const modal = document.getElementById('sidebar-delete-modal');
        const content = document.getElementById('sidebar-delete-modal-content');
        const nameEl = document.getElementById('sidebar-delete-target-name');
        const confirmBtn = document.getElementById('sidebar-delete-confirm-btn');

        if (!overlay || !modal || !confirmBtn) return;

        let name = '';
        let confirmAction = null;

        if (type === 'module') {
            const [id, moduleName] = args;
            name = moduleName;
            confirmAction = () => this.executeSoftDeleteModule(id);
        } else {
            const [moduleId, topicId, topicName] = args;
            name = topicName;
            confirmAction = () => this.executeSoftDeleteTopic(moduleId, topicId);
        }

        if (nameEl) nameEl.textContent = name;

        // Setup confirm button
        confirmBtn.onclick = () => {
            this.cancelDeleteConfirmation(); // Close modal
            if (confirmAction) confirmAction();
        };

        // Show UI
        overlay.classList.remove('hidden');
        modal.classList.remove('hidden');

        // Small delay for transition
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        });
    }

    cancelDeleteConfirmation() {
        const overlay = document.getElementById('sidebar-blur-overlay');
        const modal = document.getElementById('sidebar-delete-modal-content');
        const container = document.getElementById('sidebar-delete-modal');

        if (overlay && modal && container) {
            overlay.classList.add('opacity-0');
            modal.classList.remove('scale-100', 'opacity-100');
            modal.classList.add('scale-95', 'opacity-0');

            setTimeout(() => {
                overlay.classList.add('hidden');
                container.classList.add('hidden');
            }, 200);
        }
    }

    showSyncTheoryConfirmation(moduleId, topicId, actionEl, topicName) {
        const container = document.getElementById('topic-sync-confirm-modal');
        const overlay = document.getElementById('topic-sync-blur-overlay');
        const content = document.getElementById('topic-sync-modal-content');
        const targetLabel = document.getElementById('topic-sync-confirm-target');
        const confirmBtn = document.getElementById('topic-sync-confirm-btn');
        const cancelBtn = document.getElementById('topic-sync-cancel-btn');

        if (!container || !overlay || !content) return;

        if (targetLabel) targetLabel.textContent = topicName || topicId;

        container.classList.remove('hidden');
        requestAnimationFrame(() => {
            overlay.classList.add('opacity-100');
            overlay.classList.remove('opacity-0');
            content.classList.add('scale-100', 'opacity-100');
            content.classList.remove('scale-95', 'opacity-0');
        });

        const performSync = async () => {
            confirmBtn.disabled = true;
            confirmBtn.classList.add('opacity-70');
            confirmBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-lg">sync</span>';
            
            try {
                await this.syncTopicTheoryToComplexes(moduleId, topicId, actionEl);
                this.cancelSyncConfirmation();
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.classList.remove('opacity-70');
                confirmBtn.innerHTML = wt('db.k377', 'Подтвердить обновление');
            }
        };

        confirmBtn.onclick = performSync;
        cancelBtn.onclick = () => this.cancelSyncConfirmation();
        overlay.onclick = () => this.cancelSyncConfirmation();
    }

    cancelSyncConfirmation() {
        const container = document.getElementById('topic-sync-confirm-modal');
        const overlay = document.getElementById('topic-sync-blur-overlay');
        const content = document.getElementById('topic-sync-modal-content');

        if (container && overlay && content) {
            overlay.classList.add('opacity-0');
            overlay.classList.remove('opacity-100');
            content.classList.add('scale-95', 'opacity-0');
            content.classList.remove('scale-100', 'opacity-100');

            setTimeout(() => {
                container.classList.add('hidden');
            }, 200);
        }
    }

    executeSoftDeleteModule(moduleId) {
        // Visual feedback immediately
        const btn = document.querySelector(`[data-module-button="${moduleId}"]`);
        const container = document.querySelector(`[data-module="${moduleId}"]`);

        if (container) {
            container.style.display = 'none';
        }

        const payload = { module_id: moduleId };
        const key = `module:${moduleId}`;

        this.scheduleDeletion(key, 'module', payload, () => {
            // Commit cleanup
            if (container) container.remove();
            // Reload catalog to sync state
            // this.loadCatalog(); // Optional: might be too heavy? Let's assume UI is mostly consistent.
        });
    }

    executeSoftDeleteTopic(moduleId, topicId) {
        // Visual feedback
        const container = document.querySelector(`[data-topic="${moduleId}:${topicId}"]`);
        if (container) {
            container.style.display = 'none';
        }

        const payload = { module_id: moduleId, topic_id: topicId };
        const key = `topic:${moduleId}:${topicId}`;

        this.scheduleDeletion(key, 'topic', payload, () => {
            if (container) container.remove();
        });
    }

    scheduleDeletion(key, type, payload, onCommitSuccess) {
        // Create undo toast
        const toastId = `toast-${Date.now()}`;
        this.showUndoToast(toastId, type, () => this.undoDeletion(key, toastId));

        const timer = setTimeout(async () => {
            await this.commitDeletion(key, type, payload, onCommitSuccess);
            const toast = document.getElementById(toastId);
            if (toast) toast.remove();
        }, 6000);

        this.pendingDeletions.set(key, {
            type,
            payload,
            timer,
            toastId,
            elementKey: key
        });
    }

    async commitDeletion(key, type, payload, onSuccess) {
        if (!this.pendingDeletions.has(key)) return;
        this.pendingDeletions.delete(key); // Remove from pending so we don't double commit

        const endpoint = type === 'module'
            ? '/api/editor/modules/delete'
            : '/api/editor/topics/delete';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (data.ok) {
                if (type === 'module') {
                    this.removeModuleExpandedState(payload.module_id, { save: true, includeTopics: true });
                } else if (type === 'topic') {
                    this.removeTopicExpandedState(payload.module_id, payload.topic_id);
                }
                if (onSuccess) onSuccess();
                // If we deleted the active thing, clear view
                if (type === 'module' && this.activeModuleId === payload.module_id) {
                    this.activeModuleId = null;
                    this.activeTopicId = null;
                    this.renderGrid();
                } else if (type === 'topic' && this.activeTopicId === payload.topic_id) {
                    this.activeTopicId = null;
                    this.renderGrid();
                }
                // Refresh catalog silently to ensure consistency
                this.loadCatalog().then(() => this.renderSidebar());
            } else {
                console.error('Commit failed:', data.error);
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('db.k378', 'Удаление не подтверждено сервером.'),
                    impact: wt('db.k379', 'Сущность восстановлена в интерфейсе.'),
                    next: data?.message || data?.error
                        ? `${wt('db.k380', 'Проверьте причину')} (${data.message || data.error}) ${wt('db.k381', 'и повторите.')}`
                        : wt('db.k382', 'Повторите действие позже.'),
                });
                this.restoreVisuals(key);
            }
        } catch (e) {
            console.error('Commit exception:', e);
            this.showVoiceToast({
                severity: 'error',
                what: wt('db.k383', 'Удаление не выполнено из-за сетевой ошибки.'),
                impact: wt('db.k384', 'Изменения отменены локально.'),
                next: wt('db.k385', 'Проверьте сеть и повторите попытку.'),
            });
            this.restoreVisuals(key);
        }
    }

    undoDeletion(key, toastId) {
        const pending = this.pendingDeletions.get(key);
        if (!pending) return;

        clearTimeout(pending.timer);
        this.pendingDeletions.delete(key);

        const toast = document.getElementById(toastId);
        if (toast) toast.remove();

        this.restoreVisuals(key);
    }

    restoreVisuals(key) {
        // Re-show element
        let selector = '';
        if (key.startsWith('module:')) {
            const id = key.split(':')[1];
            selector = `[data-module="${id}"]`;
        } else {
            const parts = key.split(':');
            selector = `[data-topic="${parts[1]}:${parts[2]}"]`;
        }

        const el = document.querySelector(selector);
        if (el) {
            el.style.display = 'flex';
        }
    }

    showUndoToast(id, type, onUndo) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const label = type === 'module' ? wt('db.k386', 'Модуль удален') : wt('db.k387', 'Тема удалена');
        const toast = document.createElement('div');
        toast.id = id;
        toast.className = 'bg-bg-ink text-text-on-dark px-4 py-3 rounded-lg shadow-xl flex items-center gap-4 animate-slide-up pointer-events-auto min-w-[300px] justify-between';
        toast.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="text-sm font-medium">${label}</span>
                <span class="text-xs text-text-on-dark opacity-60 function-timer">6c</span>
            </div>
            <button class="text-primary-light hover:text-primary text-sm font-bold uppercase tracking-wider transition-colors">
                ${wt('db.k388', 'Отменить')}
            </button>
        `;

        const undoBtn = toast.querySelector('button');
        undoBtn.onclick = onUndo;

        // Countdown visual
        let left = 6;
        const timerSpan = toast.querySelector('.function-timer');
        const interval = setInterval(() => {
            left--;
            if (left > 0) {
                if (timerSpan) timerSpan.textContent = `${left}c`;
            } else {
                clearInterval(interval);
            }
        }, 1000);

        container.appendChild(toast);
    }

    setupPageExitSafety() {
        window.addEventListener('beforeunload', (event) => {
            if (this.pendingDeletions.size > 0) {
                // Force commit all pending deletions
                this.pendingDeletions.forEach((value, key) => {
                    const { type, payload } = value;
                    const endpoint = type === 'module'
                        ? '/api/editor/modules/delete'
                        : '/api/editor/topics/delete';

                    // Use fetch with keepalive to ensure request survives page unload
                    fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        keepalive: true
                    }).catch(e => console.error('Safety commit failed', e));
                });
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new EditorDashboard();

    const routeParams = new URLSearchParams(window.location.search);
    if (routeParams.get('create') === 'task') {
        window.setTimeout(() => {
            if (window.dashboard && typeof window.dashboard.showCreateTaskModal === 'function') {
                window.dashboard.showCreateTaskModal();
            }
        }, 0);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const modalIds = ['create-task-modal', 'create-module-modal', 'create-topic-modal', 'topic-theory-modal', 'theory-hub-modal', 'import-modal'];
        for (const id of modalIds) {
            const el = document.getElementById(id);
            if (el && (!el.classList.contains('hidden') || el.open)) {
                if (el.tagName === 'DIALOG') {
                    // Let the native dialog cancel event handler handle it to avoid duplicate calls
                    break;
                }
                if (id === 'import-modal') {
                    window.dashboard.closeImportModal();
                } else {
                    window.dashboard.closeModals();
                }
                break;
            }
        }
        window.dashboard.cancelDeleteConfirmation();
    });
});















