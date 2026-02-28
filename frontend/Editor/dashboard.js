/**
 * ACTRA Editor Dashboard
 */

class EditorDashboard {
    constructor() {
        this.catalog = [];
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
        this.sortMenuOpen = false;
        this.boundSortOutsideHandler = null;

        // Import manager
        this.importManager = null;
        this.sortLabels = {
            alphabet: 'По алфавиту',
            date: 'По дате изменения',
            type: 'По типу задания'
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

        this.init();
    }

    createAllTasksElement() {
        const button = document.createElement('button');
        button.className = 'flex items-center gap-2 px-3 py-2 text-text-secondary hover:text-text-main hover:bg-bg-hover rounded-lg transition-colors w-full text-left';
        button.dataset.allTasksButton = 'true';
        button.innerHTML = `
            <span class="material-symbols-outlined text-[20px]">all_inclusive</span>
            <span class="text-sm font-semibold flex-1 truncate text-inherit">Все задания</span>
        `;
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

    init() {
        this.log('[init] Dashboard initializing...');
        // this.log(`Location: ${window.location.href}`); // Removed as per instruction

        // if (window.location.protocol === 'file:') { // Removed as per instruction
        //     this.log("CRITICAL ERROR: Running via file:// protocol.");
        //     this.log("You MUST access this page via http://localhost:8000/ui/editor");
        //     alert("Ошибка: Вы открыли файл напрямую. Используйте http://localhost:8000/ui/editor");
        // }

        const lastView = this.loadDashboardState();
        this.loadCatalog(); // No await here, it's handled by the promise chain
        this.setupEventListeners();
        this.setupPageExitSafety();
        this.setupThemeListener();

        // Initialize import manager
        if (typeof ImportManager !== 'undefined') {
            this.importManager = new ImportManager(this);
            this.log('[init] ImportManager initialized');
        } else {
            console.warn('[Dashboard] ImportManager not loaded');
        }

        // Apply initial state from URL or saved state
        const routeState = window.__EDITOR_ROUTE_STATE__ || {};
        if (routeState.module && routeState.topic) {
            this.renderTopicTasks(routeState.module, routeState.topic);
        } else if (routeState.module) {
            this.renderModuleTopics(routeState.module);
        } else if (lastView) {
            // Restore last view if no URL params
            if (lastView.moduleId && lastView.topicId) {
                this.renderTopicTasks(lastView.moduleId, lastView.topicId);
            } else if (lastView.moduleId) {
                this.renderModuleTopics(lastView.moduleId);
            } else {
                this.renderGrid();
            }
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

    loadDashboardState() {
        try {
            const stored = localStorage.getItem('editorDashboardState');
            if (stored) {
                const state = JSON.parse(stored);
                this.expandedState = state.expanded || { modules: [], topics: [] };
                // Ensure structure
                if (!Array.isArray(this.expandedState.modules)) this.expandedState.modules = [];
                if (!Array.isArray(this.expandedState.topics)) this.expandedState.topics = [];

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

    updateUrlState() {
        const params = new URLSearchParams();
        if (this.activeModuleId) params.set('module', this.activeModuleId);
        if (this.activeTopicId) params.set('topic', this.activeTopicId);
        if (this.currentSort) params.set('sort', this.currentSort);

        const url = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
        history.replaceState(null, '', url);
        this.saveDashboardState();
    }

    async loadCatalog() {
        this.log("Fetching catalog from /api/editor/catalog...");
        try {
            const response = await fetch('/api/editor/catalog');
            this.log(`Response status: ${response.status}`);

            if (!response.ok) {
                this.log(`HTTP Error: ${response.status} ${response.statusText}`);
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.ok) {
                this.catalog = this.cleanCatalog(data.modules);
                this.log(`Catalog loaded: ${this.catalog ? this.catalog.length : 0} modules`);
                if (!this.catalog || this.catalog.length === 0) {
                    this.log("WARNING: Catalog is empty.");
                }
                this.renderSidebar(); // Moved here to ensure catalog is loaded before rendering sidebar
            } else {
                this.log(`Server returned error: ${data.error}`);
                NotificationUI.toast(`Ошибка загрузки данных: ${data.error}`, 'error');
            }
        } catch (error) {
            this.log(`FETCH ERROR: ${error.message}`);
            NotificationUI.toast(`Ошибка связи с сервером: ${error.message}`, 'error');
        }
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

        const backBtn = document.querySelector('[data-role="return-main"]');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                window.navigateWithTransition('/ui/main');
            });
        }

        this.setupSortControls();
        this.setupSelectionControls(); // Add selection controls
        this.setupSidebarResizer();
    }

    setupSelectionControls() {
        // Find or create Action Bar
        let actionBar = document.getElementById('selection-action-bar');
        if (!actionBar) {
            actionBar = document.createElement('div');
            actionBar.id = 'selection-action-bar';
            actionBar.className = 'fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-surface-1 rounded-xl shadow-2xl border border-border-subtle p-2 flex items-center gap-3 z-50 transition-all duration-300 translate-y-[200%]';
            actionBar.innerHTML = `
                <div class="px-3 font-semibold text-text-secondary border-r border-border-subtle" id="selection-counter">0 выбрано</div>
                <button onclick="dashboard.selectAllVisibleTasks()" class="flex items-center gap-2 px-4 py-2 bg-surface-2 text-text-secondary rounded-lg hover:bg-bg-hover transition-colors font-medium">
                    <span class="material-symbols-outlined">select_all</span>
                    Все
                </button>
                <div class="w-px h-6 bg-border-subtle"></div>
                <button onclick="dashboard.exportSelectedTasks()" class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-contrast rounded-lg hover:bg-primary-dark transition-colors font-medium">
                    <span class="material-symbols-outlined">archive</span>
                    Экспорт
                </button>
                <button onclick="dashboard.deleteSelectedTasks()" class="flex items-center gap-2 px-4 py-2 bg-error-lighter text-error-dark border border-error-light rounded-lg hover:bg-error-light transition-colors font-medium">
                    <span class="material-symbols-outlined">delete</span>
                    Удалить
                </button>
                <div class="w-px h-6 bg-border-subtle"></div>
                <button onclick="dashboard.cancelSelection()" class="p-2 text-text-disabled hover:text-text-muted hover:bg-bg-hover rounded-lg" title="Отмена">
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
            btn.className = 'p-2 text-text-disabled hover:text-primary hover:bg-bg-hover rounded-lg transition-colors';
            btn.title = 'Выбор заданий';
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
        if (!this.activeModuleId && !this.activeTopicId) {
            document.querySelectorAll('[data-module-button], [data-topic-button]').forEach(btn => {
                btn.classList.remove('bg-primary-lighter', 'text-primary');
            });
            const allTasksBtn = document.querySelector('[data-role="all-tasks"]');
            if (allTasksBtn) allTasksBtn.classList.add('bg-primary-lighter', 'text-primary');
            return;
        }

        document.querySelectorAll('[data-module-button]').forEach(btn => {
            const moduleId = btn.getAttribute('data-module-id');
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
            const topicId = btn.getAttribute('data-topic-id');
            const isActive = topicId === this.activeTopicId;
            btn.classList.toggle('bg-primary-lighter', isActive);
            btn.classList.toggle('text-primary', isActive);
            if (isActive) {
                btn.classList.remove('text-text-secondary');
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
        root.className = 'cursor-pointer hover:text-primary transition-colors';
        root.textContent = 'Библиотека';
        root.onclick = () => this.renderAllTasks();
        nav.appendChild(root);

        // Module Level
        if (this.activeModuleId) {
            const separator1 = document.createElement('span');
            separator1.className = 'text-text-disabled mx-1 font-normal text-xl';
            separator1.textContent = '›';
            nav.appendChild(separator1);

            const module = this.catalog.find(m => m.id === this.activeModuleId);
            const moduleName = module ? (module.name || module.id) : this.activeModuleId;
            const moduleSpan = document.createElement('span');
            moduleSpan.className = 'cursor-pointer hover:text-primary transition-colors truncate inline-block align-bottom anim-scale-in';
            moduleSpan.textContent = moduleName;
            moduleSpan.title = moduleName;
            moduleSpan.onclick = () => this.renderModuleTopics(this.activeModuleId);
            nav.appendChild(moduleSpan);

            // Topic Level
            if (this.activeTopicId) {
                const separator2 = document.createElement('span');
                separator2.className = 'text-text-disabled mx-1 font-normal text-xl shrink-0 anim-scale-in';
                separator2.textContent = '›';
                nav.appendChild(separator2);

                const topic = (module?.topics || []).find(t => t.id === this.activeTopicId);
                const topicName = topic ? (topic.name || topic.id) : this.activeTopicId;
                const topicSpan = document.createElement('span');
                topicSpan.className = 'text-text-main truncate inline-block align-bottom anim-scale-in';
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
        moduleSelect.innerHTML = '<option value="">Выберите модуль...</option>';
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
    }

    updateTopicSelect() {
        const moduleSelect = document.querySelector('#task-module-select');
        const topicSelect = document.querySelector('#task-topic-select');
        const module_id = moduleSelect.value;

        topicSelect.innerHTML = '<option value="">Выберите тему...</option>';
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
        ['create-task-modal', 'create-module-modal', 'create-topic-modal'].forEach(id => {
            const m = document.getElementById(id);
            if (!m) return;
            const content = m.querySelector('.bg-surface-1, .bg-card-light');
            if (content) {
                content.classList.remove('animate-scale-in');
            }
            m.classList.add('hidden');
            m.classList.remove('flex');
        });
    }

    async submitTaskForm() {
        const module_id = document.querySelector('#task-module-select').value;
        const topic_id = document.querySelector('#task-topic-select').value;
        const task_name = document.querySelector('#task-name-input').value.trim();
        const task_type = document.querySelector('#task-type-select').value;

        if (!module_id) {
            NotificationUI.toast('Пожалуйста, выберите модуль', 'warning');
            return;
        }
        if (!topic_id) {
            NotificationUI.toast('Пожалуйста, выберите тему', 'warning');
            return;
        }
        if (!task_name) {
            NotificationUI.toast('Пожалуйста, введите название задания', 'warning');
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
        document.querySelector('#create-module-modal').classList.add('hidden');
    }

    async submitModuleForm() {
        const name = document.querySelector('#module-name-input').value.trim();
        if (!name) {
            NotificationUI.toast('Название модуля не может быть пустым', 'warning');
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
                NotificationUI.toast('Ошибка при создании модуля: ' + data.error, 'error');
            }
        } catch (err) {
            console.error(err);
            NotificationUI.toast('Ошибка сети', 'error');
        }
    }

    // Topic Creation
    showTopicModal(moduleId = null) {
        let module_id = moduleId;
        if (!module_id) {
            module_id = document.querySelector('#task-module-select').value;
        }

        if (!module_id) {
            NotificationUI.toast('Сначала выберите модуль', 'warning');
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
        document.querySelector('#create-topic-modal').classList.add('hidden');
    }

    async submitTopicForm() {
        const module_id = document.querySelector('#topic-module-select').value;
        const nameInput = document.querySelector('#topic-name-input');
        const name = nameInput.value.trim();
        if (!name) {
            NotificationUI.toast('Название темы не может быть пустым', 'warning');
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
                NotificationUI.toast('Ошибка при создании темы: ' + data.error, 'error');
            }
        } catch (err) {
            console.error(err);
            NotificationUI.toast('Ошибка сети', 'error');
        }
    }

    async createNewTask(module_id, topic_id, task_name, task_type) {
        try {
            const response = await fetch('/api/editor/task/new', {
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
                console.log("Task created:", data.task_id);
                // Reload catalog and re-render
                await this.loadCatalog();
                this.renderSidebar();

                // Switch to editor
                window.navigateWithTransition(this.getEditorUrl(task_type, module_id, topic_id, data.task_id, true));
            } else {
                NotificationUI.toast('Ошибка при создании задания: ' + data.error, 'error');
            }
        } catch (error) {
            console.error("Error creating task:", error);
        }
    }

    getEditorUrl(type, module, topic, id, isNew = false) {
        let editorPage = '';
        if (type === 'click' || type === 'click_task') editorPage = 'Point_Annotation.html';
        if (type === 'draw' || type === 'draw_task') editorPage = 'Point_Annotation.html';
        if (type === 'test') editorPage = 'Test Task Editor Multiple Choice.html';
        if (type === 'sequence_assembly') editorPage = 'Sequence Assembly Editor Procedural Steps.html';
        if (type === 'open_answer') editorPage = 'Open Answer Editor Textual Reasoning.html';

        const newFlag = isNew ? '&new=1' : '';
        return `${editorPage}?module=${module}&topic=${topic}&task=${id}${newFlag}`;
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
                <p class="text-xs text-text-muted">Модулей пока нет.</p>
                <p class="text-xs text-text-disabled">Нажмите «+» чтобы создать первый модуль</p>
            `;
            navContainer.appendChild(hint);
        }

        this.catalog.forEach(module => {
            const moduleEl = this.createModuleElement(module);
            navContainer.appendChild(moduleEl);
        });

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
                            allTasks.push({
                                ...task,
                                moduleId: module.id,
                                moduleName: module.name || module.id,
                                topicId: topic.id,
                                topicName: topic.name || topic.id,
                                created_at: task.created_at || task.createdAt || task.meta?.created_at
                            });
                        });
                    }
                });
            }
        });
        return allTasks;
    }

    renderGrid(tasks = null) {
        const gridContainer = document.querySelector('main .grid');
        if (!gridContainer) return;

        const addBtn = document.querySelector('[data-role="create-task-card"]');
        const isFiltered = Array.isArray(tasks);
        const sourceTasks = tasks ?? this.collectAllTasks();
        const tasksToRender = this.sortTasks(sourceTasks);

        gridContainer.innerHTML = '';
        if (addBtn) {
            gridContainer.appendChild(addBtn);
        }

        if (!tasksToRender.length) {
            const emptyCard = this.createEmptyStateCard(
                isFiltered && this.currentSearchQuery
                    ? `По запросу «${this.currentSearchQuery.trim()}» ничего не найдено`
                    : 'Задания не найдены'
            );
            gridContainer.appendChild(emptyCard);
            return;
        }

        tasksToRender.forEach(task => {
            const card = this.createTaskCard(task);
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

        const topicTasks = (topic.tasks || []).map(task => ({
            ...task,
            moduleId: module.id,
            moduleName: module.name || module.id,
            topicId: topic.id,
            topicName: topic.name || topic.id
        }));

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
            (topic.tasks || []).map(task => ({
                ...task,
                moduleId: module.id,
                moduleName: module.name || module.id,
                topicId: topic.id,
                topicName: topic.name || topic.id
            }))
        );

        this.renderGrid(moduleTasks);
    }

    createTaskCard(task) {
        const article = document.createElement('article');
        const isErrorDetection = this.isErrorDetectionTask(task);
        const baseCardClasses = 'group rounded-xl p-5 flex flex-col h-[200px] border transition-all hover:shadow-xl hover:translate-y-[-4px] relative animate-slide-up shadow-sm cursor-pointer task-card';
        const cardTheme = 'bg-surface-2 border-border-subtle hover:border-primary';

        // Check selection state
        const uniqueId = `${task.moduleId}:${task.topicId}:${task.id}`;
        const isSelected = this.selectedTasks.has(uniqueId);

        if (isSelected) {
            article.className = `${baseCardClasses} bg-surface-2 border-primary ring-2 ring-primary`;
        } else {
            article.className = `${baseCardClasses} ${cardTheme}`;
        }

        // Pass unique ID to element dataset
        article.dataset.taskId = uniqueId;

        const { label: typeLabel, className: typeClass } = this.getTaskTypeMeta(task);
        const topicLabel = task.topicName || task.topicId || 'Без темы';
        const createdLabel = this.formatCreatedDate(task.created_at);
        const updatedLabel = task.updated_at ? this.formatCreatedDate(task.updated_at) : null;

        // Theme-aware error badge classes
        const isDark = this.isCurrentThemeDark();
        const errorBadgeClass = isDark
            ? 'bg-error-dark text-error-lighter ring-1 ring-inset ring-error-lighter'
            : 'bg-error-light text-error-darker ring-1 ring-inset ring-error-darker';

        article.innerHTML = `
            <div class="absolute top-3 right-3 z-10 ${this.selectionMode ? 'block' : 'hidden group-hover:block'}">
                <input type="checkbox" 
                    class="w-5 h-5 text-primary rounded border-border-strong focus:ring-primary task-checkbox transition-transform hover:scale-110"
                    ${isSelected ? 'checked' : ''}
                >
            </div>
        
            <div class="flex justify-between items-start mb-3">
                <div class="flex gap-2">
                    <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${typeClass}">
                        ${typeLabel}
                    </span>
                    ${isErrorDetection ? `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${errorBadgeClass}">
                        <span class="material-symbols-outlined leading-none" style="font-size: 18px;">bug_report</span>
                        Ошибки
                    </span>` : ""}
                </div>
                <div class="status-indicator-published" title="Published"></div>
            </div>
            <div class="flex-1">
                <h3 class="text-text-main text-lg font-bold leading-tight mb-2 group-hover:text-primary transition-colors cursor-pointer">${task.name || task.id}</h3>
                <p class="text-text-secondary text-xs font-medium">Создано ${createdLabel}${updatedLabel && updatedLabel !== createdLabel ? ` · Изм. ${updatedLabel}` : ''}</p>
            </div>
            <div class="flex gap-2 mt-4 flex-wrap items-center">
                <span class="inline-flex items-center rounded bg-surface-1 px-2 py-1 text-xs font-medium text-text-secondary border-2 border-border-normal">${task.moduleName || task.moduleId}</span>
                <span class="inline-flex items-center rounded bg-surface-1 px-2 py-1 text-xs font-medium text-text-secondary border-2 border-border-normal">${topicLabel}</span>
            </div>
        `;

        // Checkbox handler
        const checkbox = article.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleTaskSelection(uniqueId, checkbox.checked, e.shiftKey);
        });

        // Main card click
        article.addEventListener('click', (e) => {
            if (this.selectionMode) {
                // If in selection mode, card click acts as checkbox toggle
                checkbox.checked = !checkbox.checked;
                this.handleTaskSelection(uniqueId, checkbox.checked, e.shiftKey);
            } else {
                // Normal navigation
                this.loadTask(task.moduleId, task.topicId, task.id);
            }
        });

        return article;
    }

    createEmptyStateCard(message) {
        const article = document.createElement('article');
        article.className = 'border-2 border-dashed border-border-subtle rounded-xl bg-surface-1 p-6 flex flex-col items-center justify-center text-center text-text-disabled gap-2 h-[200px]';
        const details = this.currentSearchQuery && this.currentSearchQuery.trim()
            ? `<p class="text-xs text-text-disabled">Запрос: «${this.currentSearchQuery.trim()}»</p>`
            : '';
        article.innerHTML = `
            <span class="material-symbols-outlined text-3xl text-text-disabled mb-1">search_off</span>
            <p class="text-sm font-medium text-text-secondary">${message}</p>
            ${details}
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
                ? 'bg-info-dark text-info-lighter ring-1 ring-inset ring-info-lighter'
                : 'bg-info-light text-info-darker ring-1 ring-inset ring-info-darker'
        };

        if (task.type === 'click' || task.type === 'click_task') {
            return {
                label: 'Клик',
                className: isDark
                    ? 'bg-secondary-dark text-secondary-lighter ring-1 ring-inset ring-secondary-lighter'
                    : 'bg-secondary-light text-secondary-darker ring-1 ring-inset ring-secondary-darker'
            };
        }
        if (task.type === 'draw' || task.type === 'draw_task') {
            return {
                label: 'Рисование',
                className: isDark
                    ? 'bg-success-dark text-success-lighter ring-1 ring-inset ring-success-lighter'
                    : 'bg-success-light text-success-darker ring-1 ring-inset ring-success-darker'
            };
        }
        if (task.type === 'test') {
            return {
                label: 'Тест',
                className: isDark
                    ? 'bg-warning-dark text-warning-lighter ring-1 ring-inset ring-warning-lighter'
                    : 'bg-warning-light text-warning-darker ring-1 ring-inset ring-warning-darker'
            };
        }
        if (task.type === 'sequence_assembly') {
            return {
                label: 'Последовательность',
                className: isDark
                    ? 'bg-primary-dark text-primary-lighter ring-1 ring-inset ring-primary-lighter'
                    : 'bg-primary-lighter text-primary-darker ring-1 ring-inset ring-primary-darker'
            };
        }
        if (task.type === 'open_answer') {
            return {
                label: 'Открытый ответ',
                className: isDark
                    ? 'bg-info-dark text-info-lighter ring-1 ring-inset ring-info-lighter'
                    : 'bg-info-light text-info-darker ring-1 ring-inset ring-info-darker'
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

        if (count > 0 || this.selectionMode) {
            bar.classList.remove('translate-y-[200%]');
            counter.textContent = `${count} выбрано`;
        } else {
            bar.classList.add('translate-y-[200%]');
        }
    }

    async exportSelectedTasks() {
        if (this.selectedTasks.size === 0) return;

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
            NotificationUI.toast('Ошибка экспорта: ' + error.message, 'error');
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
        button.className = 'flex items-center gap-2 px-3 h-9 text-text-secondary hover:text-text-main hover:bg-bg-hover rounded-lg transition-colors group w-full text-left';
        button.dataset.moduleButton = module.id;
        button.innerHTML = `
            <span class="material-symbols-outlined text-[20px] group-hover:text-primary transition-colors">folder_open</span>
            <span class="text-sm font-medium flex-1 truncate" title="${module.name || module.id}">${module.name || module.id}</span>
            <div class="flex items-center gap-1 h-full">
                <div class="hidden group-hover:flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px] text-text-disabled hover:text-primary transition-colors p-0.5 rounded hover:bg-primary-lighter"
                          onclick="dashboard.startRenameModule('${module.id}'); event.stopPropagation();"
                          title="Переименовать модуль">edit</span>
                    <span class="material-symbols-outlined text-[16px] text-text-disabled hover:text-error transition-colors p-0.5 rounded hover:bg-error-lighter"
                          onclick="dashboard.deleteModule('${module.id}'); event.stopPropagation();"
                          title="Удалить модуль">delete</span>
                </div>
                <span class="material-symbols-outlined text-[16px] p-0.5 transition-transform" data-role="toggle">expand_more</span>
            </div>
        `;

        const childrenContainer = document.createElement('div');
        // Check if expanded
        const isExpanded = this.expandedState.modules.includes(module.id);

        childrenContainer.className = `flex flex-col ml-3 pl-3 border-l border-border-subtle mt-1 gap-1 ${isExpanded ? 'animate-slide-up' : 'hidden'}`;
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
                childrenContainer.classList.add('animate-slide-up');
                if (chevron) {
                    chevron.style.transform = 'rotate(0deg)';
                }
                // Update state
                if (!this.expandedState.modules.includes(module.id)) {
                    this.expandedState.modules.push(module.id);
                    this.saveDashboardState();
                }
            } else {
                childrenContainer.classList.add('hidden');
                childrenContainer.classList.remove('animate-slide-up');
                if (chevron) {
                    chevron.style.transform = 'rotate(-90deg)';
                }
                // Update state
                this.expandedState.modules = this.expandedState.modules.filter(id => id !== module.id);
                this.saveDashboardState();
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
        addTopicBtn.className = 'flex items-center gap-2 px-3 py-1.5 text-text-disabled hover:text-primary hover:bg-bg-hover rounded-lg transition-all w-full text-left mt-1';
        addTopicBtn.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">add_circle</span>
            <span class="text-[11px] font-bold uppercase tracking-wider">Добавить тему</span>
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

        const button = document.createElement('button');
        button.className = 'flex items-center gap-2 px-3 h-9 text-text-secondary hover:text-text-main hover:bg-bg-hover rounded-lg transition-colors w-full text-left group';
        button.dataset.topicButton = topic.id;
        button.dataset.topicModule = moduleId;
        button.innerHTML = `
            <span class="material-symbols-outlined text-[20px]">folder</span>
            <span class="text-sm font-medium flex-1 truncate" title="${topic.name || topic.id}">${topic.name || topic.id}</span>
            <div class="flex items-center gap-1 h-full">
                <div class="hidden group-hover:flex items-center gap-1">
                    <span class="material-symbols-outlined text-[16px] text-text-disabled hover:text-primary transition-colors p-0.5 rounded hover:bg-primary-lighter"
                          onclick="dashboard.startRenameTopic('${moduleId}', '${topic.id}'); event.stopPropagation();"
                          title="Переименовать тему">edit</span>
                    <span class="material-symbols-outlined text-[16px] text-text-disabled hover:text-error transition-colors p-0.5 rounded hover:bg-error-lighter"
                          onclick="dashboard.deleteTopic('${moduleId}', '${topic.id}'); event.stopPropagation();"
                          title="Удалить тему">delete</span>
                </div>
                <span class="material-symbols-outlined text-[16px] p-0.5 transition-transform" data-role="toggle">expand_more</span>
            </div>
        `;
        const chevron = button.querySelector('[data-role="toggle"]');

        const topicKey = `${moduleId}:${topic.id}`;
        const isExpanded = this.expandedState.topics.includes(topicKey);

        if (chevron) {
            chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        }

        const tasksContainer = document.createElement('div');
        tasksContainer.className = `flex flex-col ml-3 pl-3 border-l border-border-subtle my-1 gap-1 ${isExpanded ? 'animate-slide-up' : 'hidden'}`;
        tasksContainer.dataset.topicTasks = topicKey;

        if (topic.tasks && topic.tasks.length > 0) {
            topic.tasks.forEach(task => {
                const taskEl = this.createTaskElement(task, moduleId, topic.id);
                tasksContainer.appendChild(taskEl);
            });
        }

        const toggleTasks = () => {
            const isHidden = tasksContainer.classList.contains('hidden');
            if (isHidden) {
                tasksContainer.classList.remove('hidden');
                tasksContainer.classList.add('animate-slide-up');
                if (chevron) {
                    chevron.style.transform = 'rotate(0deg)';
                }
                // Update state
                if (!this.expandedState.topics.includes(topicKey)) {
                    this.expandedState.topics.push(topicKey);
                    this.saveDashboardState();
                }
            } else {
                tasksContainer.classList.add('hidden');
                tasksContainer.classList.remove('animate-slide-up');
                if (chevron) {
                    chevron.style.transform = 'rotate(-90deg)';
                }
                // Update state
                this.expandedState.topics = this.expandedState.topics.filter(key => key !== topicKey);
                this.saveDashboardState();
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
        addTaskBtn.className = 'flex items-center gap-2 px-3 py-1.5 text-text-disabled hover:text-primary hover:bg-bg-hover rounded-lg transition-all w-full text-left mt-1';
        addTaskBtn.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">add_circle</span>
            <span class="text-[11px] font-bold uppercase tracking-wider">Добавить задание</span>
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
        const baseClasses = 'flex items-center gap-2 px-3 py-2 rounded-lg w-full text-left transition-colors';
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
            <span class="text-sm font-normal flex-1 truncate">${task.name || task.id}</span>
        `;

        button.addEventListener('click', () => {
            this.loadTask(moduleId, topicId, task.id);
        });

        return button;
    }

    expandSidebarModule(moduleId) {
        if (!moduleId) return;
        const moduleContainer = document.querySelector(`[data-module="${moduleId}"]`);
        const children = moduleContainer?.querySelector(`[data-module-children="${moduleId}"]`);
        const chevron = moduleContainer?.querySelector('[data-role="toggle"]');
        if (children && children.classList.contains('hidden')) {
            children.classList.remove('hidden');
            children.classList.add('animate-slide-up');
        }
        if (chevron) {
            chevron.style.transform = 'rotate(0deg)';
        }
    }

    expandSidebarTopic(moduleId, topicId) {
        if (!moduleId || !topicId) return;
        const topicContainer = document.querySelector(`[data-topic="${moduleId}:${topicId}"]`);
        const tasksContainer = topicContainer?.querySelector(`[data-topic-tasks="${moduleId}:${topicId}"]`);
        const chevron = topicContainer?.querySelector('[data-role="toggle"]');
        if (tasksContainer && tasksContainer.classList.contains('hidden')) {
            tasksContainer.classList.remove('hidden');
            tasksContainer.classList.add('animate-slide-up');
        }
        if (chevron) {
            chevron.style.transform = 'rotate(0deg)';
        }
    }

    syncSidebarSelection() {
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

    async loadTask(moduleId, topicId, taskId) {
        try {
            const response = await fetch(`/api/editor/task/${moduleId}/${topicId}/${taskId}`);
            const data = await response.json();
            if (data.ok) {
                console.log("Task loaded:", data.task);
                this.switchEditor(data.task);
            } else {
                console.error("Failed to load task:", data.error);
            }
        } catch (error) {
            console.error("Error fetching task:", error);
        }
    }

    switchEditor(task) {
        const type = task.task_data.type || task.task_data.task_type;
        console.log(`Switching to ${type} editor for task: ${task.metadata.id}`);

        let editorPage = '';
        if (type === 'click' || type === 'click_task') editorPage = 'Point_Annotation.html';
        if (type === 'draw' || type === 'draw_task') editorPage = 'Point_Annotation.html';
        if (type === 'test') editorPage = 'Test Task Editor Multiple Choice.html';
        if (type === 'sequence_assembly') editorPage = 'Sequence Assembly Editor Procedural Steps.html';
        if (type === 'open_answer') editorPage = 'Open Answer Editor Textual Reasoning.html';

        if (editorPage) {
            const taskMeta = task?.task_data?.meta || {};
            const rootMeta = task?.metadata || {};
            let m = taskMeta.module || rootMeta.module;
            let t = taskMeta.topic || rootMeta.topic;
            const id = task.metadata.id;

            if ((!m || !t) && typeof rootMeta.path === 'string') {
                const normalizedPath = rootMeta.path.replace(/\\/g, '/');
                const match = normalizedPath.match(/modules\/([^/]+)\/topics\/([^/]+)\/tasks\/[^/]+\/task\.json$/);
                if (match) {
                    m = m || match[1];
                    t = t || match[2];
                }
            }

            if (!m || !t) {
                console.error('Cannot open editor: missing module/topic in task metadata', task);
                return;
            }
            window.navigateWithTransition(`${editorPage}?module=${m}&topic=${t}&task=${id}`);
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

        modal.classList.remove('hidden');

        if (this.importManager) {
            this.importManager.enterImportModalMode();
            // Preset module/topic from current location before going to step 1
            this.importManager.presetFromCurrentLocation();
            this.importManager.goToStep(1);
            // Preload AI status in background (for faster AI mode switch)
            this.importManager.aiCheckStatus().catch(() => {});
        } else {
            console.error('[Dashboard] ImportManager not initialized');
        }
    }

    showTheoryAnalysisModal() {
        const modal = document.getElementById('import-modal');
        if (!modal) {
            console.error('[Dashboard] Theory analysis modal not found');
            return;
        }

        modal.classList.remove('hidden');

        if (this.importManager) {
            this.importManager.openTheoryAnalysisMode().catch((e) => {
                console.error('[Dashboard] Failed to open theory analysis mode:', e);
            });
        } else {
            console.error('[Dashboard] ImportManager not initialized');
        }
    }

    closeImportModal() {
        const modal = document.getElementById('import-modal');
        if (modal) {
            modal.classList.add('hidden');
        }

        // Reset import manager state
        if (this.importManager) {
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
                return;
            }

            this.importManager.setModalPurpose('import');
            this.importManager.currentStep = 1;
            this.importManager.selectedModule = null;
            this.importManager.selectedTopic = null;
            this.importManager.selectedModuleName = '';
            this.importManager.selectedTopicName = '';
            this.importManager.sourceText = '';
            this.importManager.parsedResult = null;
            this.importManager.excludedTasks.clear();
            this.importManager.selectedTasks.clear();
            this.importManager.importMode = 'text';
            this.importManager.uploadedFile = null;
            this.importManager.checkResult = null;
            this.importManager.archiveCacheId = null;
            this.importManager.perTaskConflictRes.clear();
            this.importManager.aiTemplateType = 'material_analysis';
            // Reset AI state
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
        }
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
            title: 'Удалить задания?',
            message: `Вы действительно хотите удалить выбранные задания (${this.selectedTasks.size} шт.)?`,
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            variant: 'error'
        });
        if (!confirmed) return;

        const tasksToDelete = Array.from(this.selectedTasks).map(idStr => {
            const [moduleId, topicId, taskId] = idStr.split(':');
            return { module_id: moduleId, topic_id: topicId, task_id: taskId };
        });

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

                NotificationUI.toast(`Удалено ${data.deleted} заданий`, 'success');
                if (data.errors && data.errors.length > 0) {
                    NotificationUI.toast(`Ошибки: ${data.errors.join(', ')}`, 'warning', 6000);
                }
            } else {
                NotificationUI.toast(`Ошибка удаления: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Delete error:', error);
            NotificationUI.toast('Ошибка при удалении заданий', 'error');
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
        const modal = document.getElementById('sidebar-delete-modal');
        const content = document.getElementById('sidebar-delete-modal-content');

        if (overlay && modal && content) {
            overlay.classList.add('opacity-0');
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');

            setTimeout(() => {
                overlay.classList.add('hidden');
                modal.classList.add('hidden');
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
                NotificationUI.toast(`Ошибка удаления: ${data.message || data.error}`, 'error');
                this.restoreVisuals(key);
            }
        } catch (e) {
            console.error('Commit exception:', e);
            NotificationUI.toast('Ошибка сети при удалении', 'error');
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

        const label = type === 'module' ? 'Модуль удален' : 'Тема удалена';
        const toast = document.createElement('div');
        toast.id = id;
        toast.className = 'bg-bg-ink text-text-on-dark px-4 py-3 rounded-lg shadow-xl flex items-center gap-4 animate-slide-up pointer-events-auto min-w-[300px] justify-between';
        toast.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="text-sm font-medium">${label}</span>
                <span class="text-xs text-text-on-dark opacity-60 function-timer">6c</span>
            </div>
            <button class="text-primary-light hover:text-primary text-sm font-bold uppercase tracking-wider transition-colors">
                Отменить
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

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const modalIds = ['create-task-modal', 'create-module-modal', 'create-topic-modal', 'import-modal'];
        for (const id of modalIds) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
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
