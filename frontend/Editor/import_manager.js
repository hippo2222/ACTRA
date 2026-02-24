/**
 * ImportManager - Manages task import workflow
 */
class ImportManager {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.currentStep = 1;
        this.selectedModule = null;
        this.selectedTopic = null;
        this.selectedModuleName = '';
        this.selectedTopicName = '';
        this.sourceText = '';
        this.parsedResult = null;
        this.excludedTasks = new Set();
        this.selectedTasks = new Set(); // For bulk actions
        this.importMode = 'text'; // 'text' | 'archive' | 'ai'
        this.uploadedFile = null;
        this.checkResult = null;
        this.archiveCacheId = null;
        this.perTaskConflictRes = new Map(); // index -> 'skip'|'overwrite'|'new_id'
        this.aiTemplateType = 'material_analysis';

        // AI generation mode state
        this.materialText = '';
        this.aiUploadedFile = null;
        this.aiFileInfo = null;
        this.analysisResult = null;
        this.generationResult = null;
        this.aiProvider = null;
        this.aiProviderModel = null;
        this.aiRunId = null;
        this.dailyLimit = null;
        this.aiStatus = null;
        this.aiSelectedRecs = new Map(); // task_type -> {enabled, count}
        this.aiOutputLanguageMode = 'same_as_material'; // 'same_as_material' | 'custom'
        this.aiOutputLanguage = 'ru'; // used when mode=custom
        this.aiGenerating = false;
        this.aiAnalyzing = false;
        this.importInProgress = false;
        this.importRequestKey = null;
    }

    // =========================================================================
    // Step Navigation
    // =========================================================================

    goToStep(step) {
        this.currentStep = step;
        this.updateStepUI();
        this.renderCurrentStep();
        this.updateNavigationButtons();
    }

    /**
     * Preset module/topic from current dashboard location
     * Called when opening import modal
     */
    presetFromCurrentLocation() {
        const moduleId = this.dashboard.activeModuleId;
        const topicId = this.dashboard.activeTopicId;

        if (moduleId) {
            this.selectedModule = moduleId;
            const module = this.dashboard.catalog.find(m => m.id === moduleId);
            this.selectedModuleName = module ? (module.name || module.id) : moduleId;

            if (topicId && module) {
                const topic = (module.topics || []).find(t => t.id === topicId);
                if (topic) {
                    this.selectedTopic = topicId;
                    this.selectedTopicName = topic.name || topic.id;
                }
            }
        }
    }

    /**
     * Apply preset selection to UI elements after rendering
     */
    applyPresetSelection() {
        const moduleSelect = document.getElementById('import-module-select');
        const topicSelect = document.getElementById('import-topic-select');

        if (moduleSelect && this.selectedModule) {
            moduleSelect.value = this.selectedModule;
            // Trigger topic select update
            this.updateTopicSelect();

            // Set topic value after topics are loaded
            if (topicSelect && this.selectedTopic) {
                topicSelect.value = this.selectedTopic;
            }
        }
    }

    nextStep() {
        if (this.currentStep < 4) {
            this.goToStep(this.currentStep + 1);
        }
    }

    prevStep() {
        if (this.currentStep > 1) {
            this.goToStep(this.currentStep - 1);
        }
    }

    updateStepUI() {
        const steps = document.querySelectorAll('[data-role="import-steps"] [data-step]');
        steps.forEach(stepEl => {
            const stepNum = parseInt(stepEl.dataset.step);
            const circle = stepEl.querySelector('div:first-child');
            const label = stepEl.querySelector('span');

            if (stepNum === this.currentStep) {
                // Current step - primary color with number
                circle.className = 'w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-contrast font-semibold text-sm transition-all duration-300';
                circle.innerHTML = stepNum;
                label.className = 'text-xs font-medium text-text-secondary transition-colors duration-300';
                stepEl.classList.remove('completed');
            } else if (stepNum < this.currentStep) {
                // Completed step - green with checkmark
                circle.className = 'w-10 h-10 rounded-full bg-success flex items-center justify-center text-primary-contrast font-semibold text-sm cursor-pointer hover:ring-2 hover:ring-success hover:ring-offset-2 transition-all duration-300';
                circle.innerHTML = '<span class="material-symbols-outlined text-[20px]">check</span>';
                label.className = 'text-xs font-medium text-success-text transition-colors duration-300';
                stepEl.classList.add('completed');
            } else {
                // Future step - disabled
                circle.className = 'w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-text-disabled font-semibold text-sm transition-all duration-300';
                circle.innerHTML = stepNum;
                label.className = 'text-xs font-medium text-text-disabled transition-colors duration-300';
                stepEl.classList.remove('completed');
            }

            // Clickable completed steps
            stepEl.onclick = stepNum < this.currentStep ? () => this.goToStep(stepNum) : null;
            stepEl.style.cursor = stepNum < this.currentStep ? 'pointer' : 'default';
        });
    }

    updateNavigationButtons() {
        const prevBtn = document.querySelector('[data-role="import-prev"]');
        const nextBtn = document.querySelector('[data-role="import-next"]');
        if (!prevBtn || !nextBtn) return;

        // Prev button
        prevBtn.disabled = this.currentStep === 1;

        // Next button label
        if (this.currentStep === 4) {
            nextBtn.textContent = this.importInProgress ? 'Импорт...' : 'Импортировать';
        } else if (this.importMode === 'ai') {
            if (this.currentStep === 1) nextBtn.textContent = 'Анализировать';
            else if (this.currentStep === 2) nextBtn.textContent = 'Генерировать';
            else if (this.currentStep === 3) nextBtn.textContent = 'К импорту';
            else nextBtn.textContent = 'Далее';
        } else {
            nextBtn.textContent = 'Далее';
        }

        // Disable next during AI processing
        nextBtn.disabled = this.aiAnalyzing || this.aiGenerating || this.importInProgress;
    }

    // =========================================================================
    // Step Rendering
    // =========================================================================

    renderCurrentStep() {
        const contentArea = document.querySelector('[data-role="import-content"]');

        // Add fade-out class for smooth transition
        contentArea.classList.add('step-transitioning-out');

        // Wait for fade-out, then update content and fade-in
        setTimeout(() => {
            switch (this.currentStep) {
                case 1:
                    contentArea.innerHTML = this.renderStep1();
                    break;
                case 2:
                    contentArea.innerHTML = this.renderStep2();
                    break;
                case 3:
                    contentArea.innerHTML = this.renderStep3();
                    break;
                case 4:
                    contentArea.innerHTML = this.renderStep4();
                    break;
            }

            // Remove fade-out and add fade-in
            contentArea.classList.remove('step-transitioning-out');
            contentArea.classList.add('step-transitioning-in');

            // Clean up animation class after completion
            setTimeout(() => {
                contentArea.classList.remove('step-transitioning-in');
            }, 300);

            this.attachStepEventListeners();

            // Apply preset selection for step 1 after DOM is ready
            if (this.currentStep === 1) {
                this.applyPresetSelection();
            }
        }, 150);
    }

    setImportMode(mode) {
        this.importMode = mode;
        // Check AI availability when switching to AI mode
        if (mode === 'ai' && !this.aiStatus) {
            this.aiCheckStatus().then(() => this.renderCurrentStep());
        }
        this.renderCurrentStep();
    }

    showToast(message, type = 'info') {
        const colors = {
            success: 'bg-success text-white',
            error: 'bg-error text-white',
            warning: 'bg-warning text-warning-dark',
            info: 'bg-info text-white',
        };
        const toast = document.createElement('div');
        toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${colors[type] || colors.info} transition-all opacity-0 translate-y-2`;
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
        }, 3500);
    }

    _makeIdempotencyKey() {
        if (window.crypto?.randomUUID) {
            return `import-${window.crypto.randomUUID()}`;
        }
        return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    renderStep1() {
        // Get modules from dashboard catalog
        const modules = this.dashboard.catalog || [];

        return `
            <div class="max-w-2xl mx-auto animate-slide-up-fade">
                <h3 class="text-lg font-bold text-text-main mb-6">Выберите режим импорта</h3>
                
                <div class="grid grid-cols-3 gap-3 mb-8">
                    <button onclick="dashboard.importManager.setImportMode('text')" 
                        class="p-4 rounded-xl border-2 transition-all text-left ${this.importMode === 'text' ? 'border-primary bg-primary-lighter ring-2 ring-primary-light' : 'border-border-subtle hover:border-border-strong'}">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="material-symbols-outlined text-2xl ${this.importMode === 'text' ? 'text-primary' : 'text-text-disabled'}">description</span>
                            <span class="font-bold text-text-main">Из текста</span>
                        </div>
                        <p class="text-xs text-text-secondary">Вставка текста с разметкой (@OPEN_ANSWER, @SEQUENCE...)</p>
                    </button>
                    
                    <button onclick="dashboard.importManager.setImportMode('archive')" 
                        class="p-4 rounded-xl border-2 transition-all text-left ${this.importMode === 'archive' ? 'border-primary bg-primary-lighter ring-2 ring-primary-light' : 'border-border-subtle hover:border-border-strong'}">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="material-symbols-outlined text-2xl ${this.importMode === 'archive' ? 'text-primary' : 'text-text-disabled'}">folder_zip</span>
                            <span class="font-bold text-text-main">Из архива</span>
                        </div>
                        <p class="text-xs text-text-secondary">Загрузка ZIP-архива с заданиями (с картинками)</p>
                    </button>

                    <button onclick="dashboard.importManager.setImportMode('ai')" 
                        class="p-4 rounded-xl border-2 transition-all text-left ${this.importMode === 'ai' ? 'border-primary bg-primary-lighter ring-2 ring-primary-light' : 'border-border-subtle hover:border-border-strong'}">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="material-symbols-outlined text-2xl ${this.importMode === 'ai' ? 'text-primary' : 'text-text-disabled'}">auto_awesome</span>
                            <span class="font-bold text-text-main">ИИ-генерация</span>
                        </div>
                        <p class="text-xs text-text-secondary">Загрузите материал — ИИ создаст задания автоматически</p>
                    </button>
                </div>
                
                ${this.importMode === 'text' ? this.renderStep1Text(modules) : ''}
                ${this.importMode === 'archive' ? this.renderStep1Archive(modules) : ''}
                ${this.importMode === 'ai' ? this.renderStep1AI(modules) : ''}
            </div>
        `;
    }

    renderStep1Text(modules) {
        return `
            <div class="space-y-4 animate-fade-in">
                <div>
                    <label class="block text-sm font-semibold text-text-secondary mb-2">Целевой модуль</label>
                    <select id="import-module-select" 
                        class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm">
                        <option value="">Выберите модуль...</option>
                        ${modules.map(m => `<option value="${m.id}">${m.name || m.id}</option>`).join('')}
                    </select>
                </div>
                
                <div>
                    <label class="block text-sm font-semibold text-text-secondary mb-2">Целевая тема</label>
                    <select id="import-topic-select" 
                        class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm"
                        disabled>
                        <option value="">Сначала выберите модуль...</option>
                    </select>
                </div>
            </div>
        `;
    }

    renderStep1Archive(modules) {
        return `
            <div class="space-y-4 animate-fade-in">
                <div class="p-4 bg-warning-lighter text-warning-text rounded-lg text-sm border border-warning-light">
                    <div class="font-bold mb-1">Как это работает:</div>
                    <ul class="list-disc list-inside space-y-1 ml-1 text-xs">
                        <li>Задания будут распакованы из ZIP-архива</li>
                        <li>Картинки будут сохранены автоматически</li>
                        <li>Если модули/темы не выбраны, они будут созданы из структуры архива</li>
                    </ul>
                </div>

                 <div>
                    <label class="block text-sm font-semibold text-text-secondary mb-2">Файл архива (.zip)</label>
                    <div id="import-drop-zone" class="border-2 border-dashed border-border-subtle rounded-lg p-8 text-center bg-surface-2 hover:bg-bg-hover hover:border-primary transition-colors cursor-pointer relative">
                        <input type="file" id="import-file-input" accept=".zip" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                        <div class="pointer-events-none">
                            <span class="material-symbols-outlined text-4xl text-text-disabled mb-2">cloud_upload</span>
                            <p class="text-sm font-medium text-text-secondary" id="file-name-display">Перетащите файл сюда или кликните</p>
                            <p class="text-xs text-text-disabled mt-1">Максимальный размер: 200MB</p>
                        </div>
                    </div>
                </div>

                <div class="pt-4 border-t border-border-subtle">
                   <div class="flex items-center justify-between mb-2 cursor-pointer" onclick="document.getElementById('advanced-options').classList.toggle('hidden')">
                       <span class="text-sm font-semibold text-text-secondary">Дополнительно (Target Override)</span>
                       <span class="material-symbols-outlined text-text-disabled">expand_more</span>
                   </div>
                   <div id="advanced-options" class="hidden space-y-4">
                       <div>
                            <label class="block text-sm font-medium text-text-muted mb-1">Переопределить модуль (опционально)</label>
                            <select id="import-module-select" 
                                class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2 text-text-main sm:text-xs">
                                <option value="">Не переопределять (из архива)</option>
                                ${modules.map(m => `<option value="${m.id}">${m.name || m.id}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-text-muted mb-1">Переопределить тему (опционально)</label>
                            <select id="import-topic-select" 
                                class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2 text-text-main sm:text-xs" disabled>
                                <option value="">Не переопределять</option>
                            </select>
                        </div>
                   </div>
                </div>
            </div>
        `;
    }
    renderStep2() {
        if (this.importMode === 'ai') {
            return this.renderStep2AI();
        }

        if (this.importMode === 'archive') {
            // Step 2 for Archive is "Validating..." (Spinner)
            return `
               <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                   <img src="/assets/logo_animated.svg" alt="Loading" class="w-16 h-16 mb-4 drop-shadow-md" />
                   <h3 class="text-lg font-bold text-text-main">Проверка архива...</h3>
                   <p class="text-text-muted text-sm mt-2">Анализ структуры и поиск конфликтов</p>
               </div>
            `;
        }

        const hasErrors = this.parsedResult?.parsing_errors?.length > 0;
        const errorsList = this.parsedResult?.parsing_errors || [];
        const templateOptions = this.getAIAgentTemplateOptions();
        const activeTemplate = templateOptions[this.aiTemplateType] || templateOptions.open_answer;

        return `
            <div class="max-w-2xl mx-auto animate-slide-up-fade">
                <h3 class="text-lg font-bold text-text-main mb-2">Вставьте текст с заданиями</h3>
                <p class="text-sm text-text-muted mb-6">Вставьте текст, содержащий задания в формате парсера</p>

                <div class="mb-4 p-4 bg-surface-2 border border-border-subtle rounded-lg">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <h4 class="text-sm font-bold text-text-main">Шаблон промпта для ИИ-агента</h4>
                            <p class="text-xs text-text-secondary mt-1">Скопируйте шаблон, передайте его ИИ-агенту и вставьте результат ниже.</p>
                        </div>
                        <button id="ai-agent-copy-prompt-btn"
                            class="px-3 py-1.5 text-xs font-semibold text-primary border border-primary rounded hover:bg-primary hover:text-primary-fg transition-colors">
                            Скопировать промпт
                        </button>
                    </div>
                    <div class="mb-3">
                        <label for="ai-agent-template-type" class="block text-xs font-semibold text-text-secondary mb-1">Тип задания</label>
                        <select id="ai-agent-template-type"
                            class="block w-full rounded-lg border-border-subtle bg-surface-1 py-2 px-3 text-sm text-text-main focus:ring-2 focus:ring-primary">
                            ${Object.entries(templateOptions).map(([key, value]) => `
                                <option value="${key}" ${this.aiTemplateType === key ? 'selected' : ''}>${this.escapeHtml(value.title)}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div id="ai-agent-instructions" class="mb-3 p-3 bg-info-lighter border border-info-light rounded-lg">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-info text-[18px] mt-0.5">lightbulb</span>
                            <div class="text-xs text-info-text whitespace-pre-line">${this.escapeHtml(activeTemplate.instructions)}</div>
                        </div>
                    </div>
                    <textarea id="ai-agent-prompt-textarea" rows="12" readonly
                        class="block w-full rounded-lg border-border-subtle bg-surface-1 p-3 text-xs text-text-main font-mono">${this.escapeHtml(activeTemplate.prompt)}</textarea>
                </div>

                ${hasErrors ? `
                    <div class="mb-4 p-4 bg-error-lighter border border-error-light rounded-lg">
                        <div class="flex items-start gap-2 mb-2">
                            <span class="material-symbols-outlined text-error text-[20px]">error</span>
                            <div class="flex-1">
                                <h4 class="font-bold text-error-text mb-1">Обнаружены ошибки парсинга</h4>
                                <p class="text-sm text-error-text">Исправьте ошибки ниже и повторите попытку</p>
                            </div>
                        </div>
                        <div class="mt-3 space-y-1 max-h-32 overflow-y-auto">
                            ${errorsList.map(err => `
                                <div class="text-sm text-error-text font-mono bg-surface-1 p-2 rounded border border-error-light">
                                    ${this.escapeHtml(err)}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <div class="mb-2 flex justify-end">
                    <button id="import-paste-clipboard-btn"
                        class="px-3 py-1.5 text-xs font-semibold text-text-secondary border border-border-subtle rounded hover:bg-bg-hover transition-colors">
                        Вставить из буфера обмена
                    </button>
                </div>

                <textarea id="import-text-area" 
                    class="block w-full rounded-lg border-border-subtle bg-surface-2 p-4 text-text-main placeholder:text-text-disabled focus:ring-2 focus:ring-primary sm:text-sm font-mono ${hasErrors ? 'border-error focus:ring-error' : ''}"
                    rows="15"
                    placeholder="@OPEN_ANSWER&#10;# Опишите признаки пневмонии&#10;&#10;@SEQUENCE&#10;# Алгоритм диагностики&#10;element_1: Сбор анамнеза&#10;...&#10;&#10;@CLICK_TEXT&#10;# Выберите верные утверждения&#10;+ Верный вариант&#10;- Неверный вариант&#10;&#10;@TEST&#10;# Контрольные вопросы&#10;? Вопрос&#10;+ Верный ответ&#10;- Неверный ответ">${this.sourceText}</textarea>
                
                <div id="import-live-counter" class="mt-2 flex flex-wrap gap-2 text-xs min-h-[24px]"></div>
                
                <div class="mt-3 flex items-start gap-2 p-3 bg-info-lighter border border-info-light rounded-lg">
                    <span class="material-symbols-outlined text-info text-[20px]">info</span>
                    <div class="text-xs text-info-text">
                        <p class="font-medium mb-1">Поддерживаемые форматы:</p>
                        <p>@OPEN_ANSWER - Открытый ответ</p>
                        <p>@SEQUENCE - Последовательность</p>
                        <p>@CLICK_TEXT - Клик/Ошибки (текстовый выбор)</p>
                        <p>@CLICK_WORDS - Клик/Ошибки (поиск ошибок в тексте)</p>
                        <p>@TEST - Тест (вопросы с вариантами ответов)</p>
                        <p class="mt-1 font-medium">Поддерживается только подтип Клик/Ошибки (error_detection). Рисование и координатные click-задачи не поддерживаются.</p>
                    </div>
                </div>
            </div>
        `;
    }

    renderStep3() {
        if (this.importMode === 'ai') {
            return this.renderStep3AI();
        }

        if (!this.parsedResult) {
            return `
                <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                    <img src="/assets/logo_animated.svg" alt="Loading" class="w-16 h-16 mb-4 drop-shadow-md" />
                    <p class="text-text-muted">Парсинг заданий...</p>
                </div>
            `;
        }

        const summary = this.parsedResult.summary || {};
        const tasks = this.parsedResult.tasks || [];
        const selectedCount = this.selectedTasks.size;
        const notes = Array.isArray(this.parsedResult.notes)
            ? this.parsedResult.notes.filter(note => typeof note === 'string' && note.trim())
            : [];

        return `
            <div class="animate-slide-up-fade">
                <h3 class="text-lg font-bold text-text-main mb-4">Просмотр распарсенных заданий</h3>

                ${notes.length ? `
                    <div class="mb-4 p-3 bg-info-lighter border border-info-light rounded-lg">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-info text-[18px]">info</span>
                            <div class="text-xs text-info-text space-y-1">
                                ${notes.map(note => `<p>${this.escapeHtml(note)}</p>`).join('')}
                            </div>
                        </div>
                    </div>
                ` : ''}
                
                <!-- Summary -->
                <div class="mb-6 p-4 bg-surface-2 rounded-lg">
                    <div class="flex gap-6">
                        <div class="text-center">
                            <div class="text-2xl font-bold text-text-main">${summary.total || 0}</div>
                            <div class="text-xs text-text-secondary">Всего</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-success-text">${summary.valid || 0}</div>
                            <div class="text-xs text-text-secondary">✓ Готовы</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-warning-text">${summary.warnings || 0}</div>
                            <div class="text-xs text-text-secondary">⚠ Предупреждения</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-error-text">${summary.errors || 0}</div>
                            <div class="text-xs text-text-secondary">✗ Ошибки</div>
                        </div>
                    </div>
                </div>

                <!-- Settings Panel -->
                <div class="mb-4 p-4 bg-surface-1 border border-border-subtle rounded-lg shadow-sm">
                    <h4 class="text-sm font-bold text-text-main mb-3">Настройки импорта</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-text-secondary mb-1">Если задание уже существует</label>
                            <select id="conflict-resolution-select" class="block w-full rounded border-border-normal text-sm py-1.5 focus:ring-primary">
                                <option value="skip">Пропустить (по умолчанию)</option>
                                <option value="overwrite">Перезаписать</option>
                                <option value="new_id">Создать копию (новый ID)</option>
                            </select>
                        </div>
                        <div class="flex items-center">
                            <label class="flex items-center gap-2 cursor-pointer mt-4">
                                <input type="checkbox" id="skip-errors-checkbox" checked class="rounded text-primary focus:ring-primary w-4 h-4">
                                <span class="text-sm text-text-secondary">Пропускать задания с ошибками</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Bulk Actions -->
                <div class="mb-4 p-3 bg-primary-lighter border border-primary-light rounded-lg flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input 
                                type="checkbox" 
                                id="select-all-tasks"
                                onchange="dashboard.importManager.toggleSelectAll()"
                                class="w-4 h-4 text-primary rounded focus:ring-2 focus:ring-primary"
                                ${this.selectedTasks.size === tasks.length && tasks.length > 0 ? 'checked' : ''}>
                            <span class="text-sm font-medium text-text-secondary">Выбрать все</span>
                        </label>
                        ${selectedCount > 0 ? `
                            <span class="text-xs text-text-muted px-2 py-1 bg-surface-1 rounded border border-border-subtle">
                                Выбрано: ${selectedCount}
                            </span>
                        ` : ''}
                    </div>
                    <div class="flex gap-2">
                        <button 
                            onclick="dashboard.importManager.bulkExclude()"
                            class="px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-1 border border-border-subtle rounded hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            ${selectedCount === 0 ? 'disabled' : ''}>
                            Исключить выбранные
                        </button>
                        <button 
                            onclick="dashboard.importManager.bulkInclude()"
                            class="px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-1 border border-border-subtle rounded hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            ${selectedCount === 0 ? 'disabled' : ''}>
                            Включить выбранные
                        </button>
                    </div>
                </div>

                <!-- Tasks List -->
                <div class="space-y-3">
                    ${tasks.map((task, i) => this.renderTaskCard(task, i)).join('')}
                </div>
            </div>
        `;
    }

    renderStep4() {
        const validTasks = (this.parsedResult?.tasks || []).filter(t => t.status !== 'error');

        return `
            <div class="max-w-2xl mx-auto text-center py-8 animate-slide-up-fade">
                <div class="w-20 h-20 bg-success-light rounded-full flex items-center justify-center mx-auto mb-6">
                    <span class="material-symbols-outlined text-success-text text-[48px]">check_circle</span>
                </div>
                
                <h3 class="text-xl font-bold text-text-main mb-2">Готово к импорту</h3>
                <p class="text-text-muted mb-6">Будет импортировано ${validTasks.length} заданий</p>
                
                <div class="bg-surface-2 rounded-lg p-6 text-left">
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-text-muted">Модуль:</span>
                            <span class="font-medium text-text-main">${this.escapeHtml(this.selectedModuleName || this.selectedModule)}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-text-muted">Тема:</span>
                            <span class="font-medium text-text-main">${this.escapeHtml(this.selectedTopicName || this.selectedTopic)}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-text-muted">Заданий:</span>
                            <span class="font-medium text-text-main">${validTasks.length}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderTaskCard(task, index) {
        const statusColors = {
            valid: 'border-success-light bg-success-light',
            warning: 'border-warning-light bg-warning-light',
            error: 'border-error-light bg-error-light',
            conflict_overwrite: 'border-warning-light bg-warning-lighter',
            conflict_duplicate: 'border-info-light bg-info-lighter'
        };
        const statusIcons = {
            valid: '\u2713',
            warning: '\u26A0',
            error: '\u2717',
            conflict_overwrite: '\u26A1',
            conflict_duplicate: '\u2398'
        };
        const statusIconColors = {
            valid: 'text-success-text',
            warning: 'text-warning-text',
            error: 'text-error-text',
            conflict_overwrite: 'text-warning-dark',
            conflict_duplicate: 'text-info-dark'
        };
        const statusBgColors = {
            valid: 'bg-success-light',
            warning: 'bg-warning-light',
            error: 'bg-error-light',
            conflict_overwrite: 'bg-warning-lighter',
            conflict_duplicate: 'bg-info-light'
        };

        let statusKey = task.status;
        let statusLabel = task.status;

        if (task.status === 'conflict') {
            if (task.conflict_type === 'duplicate') {
                statusKey = 'conflict_duplicate';
                statusLabel = 'Дубликат (идентичен)';
            } else {
                statusKey = 'conflict_overwrite';
                statusLabel = 'Конфликт (изменен)';
            }
        }

        // Type-specific metadata
        const typeMetadata = this.getTaskTypeMetadata(task);

        // Type badges with icons
        const typeBadges = {
            'open_answer': { icon: '📝', label: 'Открытый ответ', color: 'bg-info-light text-info-dark' },
            'sequence_assembly': { icon: '🔢', label: 'Последовательность', color: 'bg-accent-light text-accent-dark' },
            'click': { icon: '🎯', label: 'Клик', color: 'bg-secondary-light text-secondary-dark' },
            'test': { icon: '❓', label: 'Тест', color: 'bg-warning-light text-warning-dark' }
        };
        const typeBadge = typeBadges[task.type] || { icon: '\u2022', label: task.type, color: 'bg-surface-2 text-text-secondary' };

        return `
            <div class="border-2 ${statusColors[statusKey] || 'border-border-subtle'} rounded-lg overflow-hidden transition-all hover:shadow-md">
                <!-- Card Header -->
                <div class="p-4 border-b border-border-subtle">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex items-center gap-2 flex-1">
                            <!-- Checkbox for bulk selection -->
                            <input 
                                type="checkbox" 
                                class="w-4 h-4 text-primary rounded focus:ring-2 focus:ring-primary flex-shrink-0"
                                data-task-checkbox="${index}"
                                onchange="dashboard.importManager.toggleTaskSelection(${index})"
                                ${this.selectedTasks.has(index) ? 'checked' : ''}>
                            <span class="text-sm font-bold text-text-muted">#${index + 1}</span>
                            <span class="inline-flex items-center gap-1 px-2 py-1 rounded ${typeBadge.color} text-xs font-medium">
                                <span>${typeBadge.icon}</span>
                                <span>${typeBadge.label}</span>
                            </span>
                        </div>
                        <div class="flex items-center gap-1 px-2 py-1 rounded ${statusBgColors[statusKey]} ${statusIconColors[statusKey]}">
                            <span class="text-lg font-bold">${statusIcons[statusKey]}</span>
                            <span class="text-xs font-semibold capitalize">${statusLabel}</span>
                        </div>
                    </div>
                    
                    <!-- Task Name (editable) -->
                    <h4 class="font-bold text-text-main mb-1 text-base cursor-pointer hover:bg-surface-2 rounded px-1 -mx-1 transition-colors" 
                        title="Нажмите для редактирования"
                        onclick="dashboard.importManager.startEditName(${index}, this)">${this.escapeHtml(task.name)}</h4>
                    
                    <!-- Prompt Preview -->
                    <p class="text-sm text-text-muted line-clamp-2">${this.escapeHtml(task.data?.prompt || 'Нет описания')}</p>
                </div>
                
                <!-- Card Body: Metadata -->
                <div class="p-4 bg-surface-2">
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        ${typeMetadata}
                    </div>
                </div>
                
                <!-- Validation Issues -->
                ${task.validation?.issues?.length > 0 ? `
                    <div class="p-4 border-t border-border-subtle bg-surface-2">
                        <div class="space-y-2">
                            ${task.validation.issues.slice(0, 3).map(issue => `
                                <div class="flex items-start gap-2 text-xs">
                                    <span class="flex-shrink-0 font-bold ${issue.severity === 'error' ? 'text-error' : 'text-warning'}">
                                        ${issue.severity === 'error' ? '\u2717' : '\u26A0'}
                                    </span>
                                    <span class="${issue.severity === 'error' ? 'text-error-text' : 'text-warning-text'} flex-1">
                                        ${this.escapeHtml(issue.message)}
                                    </span>
                                </div>
                            `).join('')}
                            ${task.validation.issues.length > 3 ? `
                                <div class="text-xs text-text-muted font-medium">
                                    +${task.validation.issues.length - 3} ещё...
                                </div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}
                
                <!-- Per-task conflict resolution (only for conflict tasks) -->
                ${task.status === 'conflict' ? `
                    <div class="px-4 py-2 border-t border-border-subtle bg-warning-lighter">
                        <label class="block text-xs font-semibold text-text-secondary mb-1">Действие при конфликте:</label>
                        <select 
                            onchange="dashboard.importManager.setPerTaskConflict(${index}, this.value)"
                            class="block w-full rounded border-border-normal text-xs py-1 focus:ring-primary bg-surface-1">
                            <option value="" ${!this.perTaskConflictRes.has(index) ? 'selected' : ''}>Как в общих настройках</option>
                            <option value="skip" ${this.perTaskConflictRes.get(index) === 'skip' ? 'selected' : ''}>Пропустить</option>
                            <option value="overwrite" ${this.perTaskConflictRes.get(index) === 'overwrite' ? 'selected' : ''}>Перезаписать</option>
                            <option value="new_id" ${this.perTaskConflictRes.get(index) === 'new_id' ? 'selected' : ''}>Создать копию (новый ID)</option>
                        </select>
                    </div>
                ` : ''}

                <!-- Actions -->
                <div class="p-3 bg-surface-1 border-t border-border-subtle flex gap-2">
                    <button 
                        onclick="dashboard.importManager.showTaskDetails(${index})"
                        class="flex-1 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary hover:text-primary-fg rounded transition-colors border border-primary">
                        Детали
                    </button>
                    <button 
                        onclick="dashboard.importManager.toggleExclude(${index})"
                        class="flex-1 px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-bg-hover hover:text-text-on-dark rounded transition-colors border border-border-subtle"
                        data-task-exclude-btn="${index}">
                        ${this.excludedTasks.has(index) ? 'Включить' : 'Исключить'}
                    </button>
                </div>
            </div>
        `;
    }

    getTaskTypeMetadata(task) {
        const data = task.data || {};

        if (task.type === 'open_answer') {
            const promptLength = (data.prompt || '').length;
            return `
                <div class="flex items-center gap-1">
                    <span class="text-text-muted">\u270E</span>
                    <span class="text-text-secondary">Длина вопроса:</span>
                    <span class="font-semibold text-text-main">${promptLength} \u0441\u0438\u043c\u0432.</span>
                </div>
            `;
        }

        if (task.type === 'sequence_assembly') {
            const elementsCount = data.elements_count || 0;
            const levelsCount = data.levels_count || 0;
            return `
                <div class="flex items-center gap-1">
                    <span class="text-text-muted">\u25A6</span>
                    <span class="text-text-secondary">Элементов:</span>
                    <span class="font-semibold text-text-main">${elementsCount}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="text-text-muted">\u2261</span>
                    <span class="text-text-secondary">Уровней:</span>
                    <span class="font-semibold text-text-main">${levelsCount}</span>
                </div>
            `;
        }

        if (task.type === 'click') {
            if (data.mode === 'text_choice') {
                const optionsCount = data.options_count || 0;
                const correctCount = data.correct_count || 0;
                return `
                    <div class="flex items-center gap-1">
                        <span class="text-text-muted">\u25A3</span>
                        <span class="text-text-secondary">Вариантов:</span>
                        <span class="font-semibold text-text-main">${optionsCount}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="text-text-muted">\u2713</span>
                        <span class="text-text-secondary">Правильных:</span>
                        <span class="font-semibold text-text-main">${correctCount}</span>
                    </div>
                    <div class="col-span-2 flex items-center gap-1">
                        <span class="text-text-muted">\u2699</span>
                        <span class="text-text-secondary">Режим:</span>
                        <span class="font-semibold text-text-main">Текстовый выбор</span>
                    </div>
                `;
            } else if (data.mode === 'word_errors' || data.mode === 'text_errors') {
                const textLength = data.text_length || 0;
                const errorCount = data.error_count || 0;
                return `
                    <div class="flex items-center gap-1">
                        <span class="text-text-muted">\u270E</span>
                        <span class="text-text-secondary">Текст:</span>
                        <span class="font-semibold text-text-main">${textLength} \u0441\u0438\u043c\u0432.</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="text-text-muted">\u2717</span>
                        <span class="text-text-secondary">Ошибок:</span>
                        <span class="font-semibold text-text-main">${errorCount}</span>
                    </div>
                `;
            }
        }

        if (task.type === 'test') {
            const questionCount = data.question_count || 0;
            return `
                <div class="flex items-center gap-1">
                    <span class="text-text-muted">\u25A3</span>
                    <span class="text-text-secondary">\u0412\u043e\u043f\u0440\u043e\u0441\u043e\u0432:</span>
                    <span class="font-semibold text-text-main">${questionCount}</span>
                </div>
            `;
        }

        return `
            <div class="col-span-2 text-text-muted text-center">Нет дополнительной информации</div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    showTaskDetails(index) {
        const task = this.parsedResult?.tasks?.[index];
        if (!task) return;

        const typeLabels = {
            open_answer: 'Открытый ответ',
            sequence_assembly: 'Последовательность',
            click: 'Клик',
            test: 'Тест'
        };
        const statusLabels = {
            valid: '<span class="text-success-text font-semibold">Валидно</span>',
            warning: '<span class="text-warning-text font-semibold">Предупреждения</span>',
            error: '<span class="text-error-text font-semibold">Ошибки</span>'
        };

        const issuesHtml = (task.validation?.issues || []).map(issue => {
            const color = issue.severity === 'error' ? 'text-error-text' : 'text-warning-text';
            const icon = issue.severity === 'error' ? 'error' : 'warning';
            return `<div class="flex items-start gap-2 py-1"><span class="material-symbols-outlined ${color} text-[16px] mt-0.5">${icon}</span><span class="text-sm ${color}">${this.escapeHtml(issue.message)}</span></div>`;
        }).join('') || '<div class="text-sm text-success-text">Нет проблем</div>';

        const data = task.data || {};
        let extraFieldsHtml = '';
        if (task.type === 'open_answer') {
            if (data.reference_answer) extraFieldsHtml += `<div class="mt-3"><div class="text-xs font-semibold text-text-muted mb-1">Эталонный ответ</div><div class="text-sm text-text-main bg-surface-2 rounded p-2">${this.escapeHtml(data.reference_answer)}</div></div>`;
            if (data.keywords?.length) extraFieldsHtml += `<div class="mt-3"><div class="text-xs font-semibold text-text-muted mb-1">Ключевые слова</div><div class="flex flex-wrap gap-1">${data.keywords.map(k => `<span class="px-2 py-0.5 bg-primary-lighter text-primary text-xs rounded-full">${this.escapeHtml(k)}</span>`).join('')}</div></div>`;
        } else if (task.type === 'sequence_assembly') {
            extraFieldsHtml += `<div class="mt-3 text-sm text-text-secondary">Элементов: ${data.elements_count || 0}, Уровней: ${data.levels_count || 0}</div>`;
        } else if (task.type === 'click') {
            if (data.mode === 'text_choice') extraFieldsHtml += `<div class="mt-3 text-sm text-text-secondary">Вариантов: ${data.options_count || 0}, Правильных: ${data.correct_count || 0}</div>`;
            else extraFieldsHtml += `<div class="mt-3 text-sm text-text-secondary">Текст: ${data.text_length || 0} симв., Ошибок: ${data.error_count || 0}</div>`;
        }

        // Create modal overlay
        let overlay = document.getElementById('task-detail-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'task-detail-overlay';
        overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
            <div class="bg-surface-1 rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between p-5 border-b border-border-subtle">
                    <h3 class="text-lg font-bold text-text-main">Задание #${index + 1}</h3>
                    <button onclick="document.getElementById('task-detail-overlay').remove()" class="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center">
                        <span class="material-symbols-outlined text-text-muted">close</span>
                    </button>
                </div>
                <div class="p-5 space-y-4">
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-text-muted">\u0422\u0438\u043f:</span> <span class="font-medium text-text-main">${typeLabels[task.type] || task.type}</span></div>
                        <div><span class="text-text-muted">Статус:</span> ${statusLabels[task.status] || task.status}</div>
                    </div>
                    <div>
                        <div class="text-xs font-semibold text-text-muted mb-1">Название</div>
                        <div class="text-sm text-text-main">${this.escapeHtml(task.name)}</div>
                    </div>
                    <div>
                        <div class="text-xs font-semibold text-text-muted mb-1">\u041f\u0440\u043e\u043c\u043f\u0442</div>
                        <div class="text-sm text-text-main bg-surface-2 rounded p-3 whitespace-pre-wrap">${this.escapeHtml(data.prompt || 'Нет')}</div>
                    </div>
                    ${extraFieldsHtml}
                    <div>
                        <div class="text-xs font-semibold text-text-muted mb-2">Валидация</div>
                        ${issuesHtml}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    startEditName(index, el) {
        const task = this.parsedResult?.tasks?.[index];
        if (!task) return;

        const currentName = task.name || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'w-full text-base font-bold text-text-main bg-surface-2 border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary';

        const commit = () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                task.name = newName;
            }
            el.textContent = task.name;
            el.style.display = '';
            input.remove();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { el.style.display = ''; input.remove(); }
        });

        el.style.display = 'none';
        el.parentNode.insertBefore(input, el.nextSibling);
        input.focus();
        input.select();
    }

    setPerTaskConflict(index, value) {
        if (value) {
            this.perTaskConflictRes.set(index, value);
        } else {
            this.perTaskConflictRes.delete(index);
        }
    }

    toggleExclude(index) {
        if (this.excludedTasks.has(index)) {
            this.excludedTasks.delete(index);
        } else {
            this.excludedTasks.add(index);
        }

        // Update button text
        const btn = document.querySelector(`[data-task-exclude-btn="${index}"]`);
        if (btn) {
            btn.textContent = this.excludedTasks.has(index) ? 'Включить' : 'Исключить';
        }
    }

    // =========================================================================
    // Event Listeners
    // =========================================================================

    attachStepEventListeners() {
        if (this.currentStep === 1) {
            const fileInput = document.getElementById('import-file-input');
            const dropZone = document.getElementById('import-drop-zone');

            const handleFileSelected = (file) => {
                if (file && file.name.endsWith('.zip')) {
                    this.uploadedFile = file;
                    const display = document.getElementById('file-name-display');
                    if (display) {
                        display.textContent = file.name;
                        display.classList.add('text-primary', 'font-bold');
                    }
                }
            };

            if (fileInput) {
                fileInput.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));
            }

            // Drag & Drop
            if (dropZone) {
                dropZone.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    dropZone.classList.add('border-primary', 'bg-primary-lighter');
                });
                dropZone.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('border-primary', 'bg-primary-lighter');
                });
                dropZone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('border-primary', 'bg-primary-lighter');
                    const file = e.dataTransfer?.files?.[0];
                    handleFileSelected(file);
                });
            }

            const moduleSelect = document.getElementById('import-module-select');
            const topicSelect = document.getElementById('import-topic-select');

            if (moduleSelect) {
                moduleSelect.addEventListener('change', (e) => {
                    this.selectedModule = e.target.value;
                    this.selectedModuleName = e.target.selectedOptions[0]?.textContent || e.target.value;
                    this.updateTopicSelect();
                });
            }
            if (topicSelect) {
                topicSelect.addEventListener('change', (e) => {
                    this.selectedTopic = e.target.value;
                    this.selectedTopicName = e.target.selectedOptions[0]?.textContent || e.target.value;
                });
            }

            // AI mode: file upload + drag-drop + textarea
            if (this.importMode === 'ai') {
                const aiFileInput = document.getElementById('ai-file-input');
                const aiDropZone = document.getElementById('ai-drop-zone');
                const aiTextarea = document.getElementById('ai-material-textarea');

                if (aiFileInput) {
                    aiFileInput.addEventListener('change', (e) => this._handleAIFileSelected(e.target.files[0]));
                }

                if (aiDropZone) {
                    aiDropZone.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        aiDropZone.classList.add('border-primary', 'bg-primary-lighter');
                    });
                    aiDropZone.addEventListener('dragleave', (e) => {
                        e.preventDefault();
                        aiDropZone.classList.remove('border-primary', 'bg-primary-lighter');
                    });
                    aiDropZone.addEventListener('drop', (e) => {
                        e.preventDefault();
                        aiDropZone.classList.remove('border-primary', 'bg-primary-lighter');
                        const file = e.dataTransfer?.files?.[0];
                        this._handleAIFileSelected(file);
                    });
                }

                if (aiTextarea) {
                    aiTextarea.addEventListener('input', (e) => {
                        this.materialText = e.target.value;
                        const wc = e.target.value.split(/\s+/).filter(Boolean).length;
                        const wcEl = document.getElementById('ai-word-count');
                        if (wcEl) wcEl.textContent = wc > 0 ? `${wc} слов` : '';
                    });
                }

                const langModeInputs = document.querySelectorAll('input[name="ai-output-language-mode"]');
                langModeInputs.forEach((input) => {
                    input.addEventListener('change', (e) => this.setAIOutputLanguageMode(e.target.value));
                });
                const langSelect = document.getElementById('ai-output-language-select');
                if (langSelect) {
                    langSelect.addEventListener('change', (e) => this.setAIOutputLanguage(e.target.value));
                }
            }
        }

        if (this.currentStep === 2) {
            const textArea = document.getElementById('import-text-area');
            const pasteBtn = document.getElementById('import-paste-clipboard-btn');
            const copyPromptBtn = document.getElementById('ai-agent-copy-prompt-btn');
            const templateSelect = document.getElementById('ai-agent-template-type');

            if (templateSelect) {
                templateSelect.addEventListener('change', (e) => {
                    this.aiTemplateType = e.target.value;
                    this.updateAIAgentPromptTextarea();
                });
            }

            if (copyPromptBtn) {
                copyPromptBtn.addEventListener('click', () => this.copyAIAgentPrompt());
            }

            if (pasteBtn) {
                pasteBtn.addEventListener('click', () => this.pasteImportTextFromClipboard());
            }

            if (textArea) {
                let liveCounterTimer = null;
                textArea.addEventListener('input', (e) => {
                    this.sourceText = e.target.value;
                    clearTimeout(liveCounterTimer);
                    liveCounterTimer = setTimeout(() => this._updateLiveCounter(e.target.value), 300);
                });
                // Initial counter update
                this._updateLiveCounter(this.sourceText);
            }
            this.updateAIAgentPromptTextarea();
        }
    }

    _updateLiveCounter(text) {
        const container = document.getElementById('import-live-counter');
        if (!container) return;

        const markers = [
            { marker: '@OPEN_ANSWER', label: 'Открытый ответ', color: 'bg-blue-100 text-blue-700' },
            { marker: '@SEQUENCE', label: 'Последовательность', color: 'bg-purple-100 text-purple-700' },
            { marker: '@CLICK_TEXT', label: 'Клик / Ошибки (выбор)', color: 'bg-amber-100 text-amber-700' },
            { marker: '@CLICK_WORDS', label: 'Клик / Ошибки (текст)', color: 'bg-rose-100 text-rose-700' },
            { marker: '@TEST', label: 'Тест', color: 'bg-orange-100 text-orange-700' }
        ];

        const badges = [];
        let total = 0;
        for (const { marker, label, color } of markers) {
            const count = (text.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            if (count > 0) {
                total += count;
                badges.push(`<span class="px-2 py-0.5 rounded-full ${color} font-medium">${label}: ${count}</span>`);
            }
        }

        if (total > 0) {
            container.innerHTML = `<span class="text-text-muted py-0.5">Найдено:</span>${badges.join('')}<span class="text-text-muted py-0.5 ml-1">Всего: ${total}</span>`;
        } else {
            container.innerHTML = text.trim() ? '<span class="text-text-disabled py-0.5">Маркеры не найдены</span>' : '';
        }
    }

    getAIAgentTemplateOptions() {
        return {
            material_analysis: {
                title: '🔍 Анализ материала (с чего начать)',
                instructions: `1. Скопируйте промпт и отправьте его ИИ-агенту.
2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.
3. Изучите рекомендации ИИ и выберите подходящий тип задания из списка выше.
Этот промпт НЕ генерирует задания — он помогает выбрать оптимальную стратегию.`,
                prompt: `Ты — эксперт по педагогическому дизайну. Преподаватель предоставит тебе учебный материал.

<task>
Выполни три действия:
1. Вычлени из материала «образовательные единицы» — конкретные концепции, факты, процессы, термины, которые студент должен понять и запомнить.
2. Для каждой единицы определи, каким типом задания её лучше всего закрепить.
3. Дай итоговую таблицу: тип задания → количество → на какие единицы направлено.
</task>

<available_task_types>
OPEN_ANSWER — свободный ответ. Студент формулирует ответ своими словами.
  Подходит для: концепций, определений, причинно-следственных связей, механизмов.

SEQUENCE — восстановление порядка перетаскиванием.
  Подходит для: алгоритмов, этапов, хронологии, протоколов.

TEST — тест с вариантами ответов (один или несколько правильных).
  Подходит для: фактов, классификаций, терминологии, количественных данных.

CLICK_TEXT — выбор верных/неверных утверждений из списка.
  Подходит для: тем с распространёнными заблуждениями, похожими понятиями, тонкими различиями.

CLICK_WORDS — поиск фактических ошибок в тексте.
  Подходит для: плотного фактического текста с числами, терминами, характеристиками.
</available_task_types>

<calibration>
Ориентиры количества заданий (суммарно по всем типам):
- ~300 слов (1 стр.) → 2–4 задания.
- ~1000 слов (3–4 стр.) → 8–15 заданий.
- ~3000+ слов (10+ стр.) → 20–40 заданий.

Если материала мало — прямо скажи об этом. Укажи, сколько заданий реально создать без потери качества. Рекомендуй только те типы, для которых материал даёт достаточно содержания. Типы, для которых материала не хватает — перечисли отдельно с пояснением.

Принцип: лучше 5 качественных заданий, чем 20 раздутых.
</calibration>

<illustrations_rule>
Если в материале есть или упоминаются иллюстрации, схемы, диаграммы, фотографии — отметь это. Платформа поддерживает задания с изображениями (клик по картинке, рисование), но они создаются вручную в редакторе. Кратко опиши, какие визуальные задания можно было бы создать.
</illustrations_rule>

<output_format>
Формат ответа (строго):

ОЦЕНКА МАТЕРИАЛА
[2–3 предложения: тема, объём, плотность]

ОБРАЗОВАТЕЛЬНЫЕ ЕДИНИЦЫ
[Пронумерованный список единиц, каждая — одна строка: название + краткое описание]

РЕКОМЕНДАЦИИ
[Для каждого рекомендуемого типа:]
ТИП — N заданий (приоритет: высокий/средний/низкий)
Направлено на единицы: [номера]
Обоснование: [1 предложение]

НЕ РЕКОМЕНДУЕТСЯ
[Типы, которые не подходят, с причиной в 1 предложение. Если все подходят — опустить секцию.]

ВИЗУАЛЬНЫЕ ВОЗМОЖНОСТИ
[Только если есть иллюстрации. Иначе — опустить секцию.]

ИТОГО: N заданий, M типов. Начать с: [тип].
</output_format>`
            },
            open_answer: {
                title: 'Открытый ответ (@OPEN_ANSWER)',
                instructions: `1. Скопируйте промпт и отправьте его ИИ-агенту.
2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.
3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа OPEN_ANSWER — это вопросы со свободным ответом. Студент видит вопрос и пишет ответ своими словами. Система затем сравнивает ответ с эталоном и ключевыми словами. Этот формат развивает глубокое понимание материала, способность формулировать мысли и воспроизводить знания по памяти — в отличие от тестов, где можно угадать ответ.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @OPEN_ANSWER. Извлеки из материала ключевые концепции, определения, причинно-следственные связи и важные факты, превратив их в вопросы, требующие осмысленного ответа.
</task>

<quality_criteria>
- Вопросы проверяют понимание, а не механическое запоминание. Вместо "Перечислите..." используй "Объясните...", "Опишите механизм...", "Почему...", "В чём различие между...".
- Эталонный ответ (строка =) содержит краткий, но полный ответ — он используется преподавателем для оценки.
- Ключевые слова (строки *) — это термины, наличие которых в ответе студента сигнализирует о правильности. Выбирай существенные термины, без которых ответ неполон.
- Каждый вопрос самодостаточен — понятен без контекста других заданий.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @OPEN_ANSWER на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@OPEN_ANSWER
# <вопрос>
= <эталонный ответ>
* <ключевое слово 1>
* <ключевое слово 2>
</output_format>

<example>
@OPEN_ANSWER
# Объясните, почему при пневмонии возникает одышка
= Воспалительный процесс в лёгочной ткани нарушает газообмен в альвеолах, снижая поступление кислорода в кровь, что компенсаторно увеличивает частоту дыхания
* газообмен
* альвеолы
* воспаление

@OPEN_ANSWER
# В чём различие между крупозной и очаговой пневмонией?
= Крупозная пневмония поражает целую долю лёгкого и имеет стадийное течение, очаговая — захватывает отдельные дольки и часто развивается как осложнение бронхита
* доля
* дольки
* стадийное течение
</example>`
            },
            sequence_assembly: {
                title: 'Последовательность (@SEQUENCE)',
                instructions: `1. Скопируйте промпт и отправьте его ИИ-агенту.
2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.
3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа SEQUENCE — это упражнения на восстановление правильного порядка. Студент видит перемешанные элементы и выстраивает их в верную последовательность перетаскиванием. Этот формат развивает процедурное мышление, понимание причинно-следственных связей, этапности процессов и хронологии событий.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @SEQUENCE. Выдели из материала процессы, алгоритмы, этапы, хронологические цепочки и классификации с естественным порядком — всё, что имеет логическую последовательность.
</task>

<quality_criteria>
- Каждое задание содержит от 3 до 7 элементов — достаточно для вызова, но не перегружает.
- Правильный порядок должен быть однозначным и обоснованным материалом, без спорных позиций.
- Формулировки элементов краткие и сопоставимые по длине, чтобы порядок нельзя было угадать по форме текста.
- Вопрос в строке # чётко указывает, по какому принципу нужно упорядочить элементы (хронология, этапность, от простого к сложному и т.д.).
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @SEQUENCE на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@SEQUENCE
# <инструкция: что и по какому принципу упорядочить>
element_1: <текст элемента>
element_2: <текст элемента>
element_3: <текст элемента>
level_1: element_1
level_2: element_2
level_3: element_3

Элементы нумеруются последовательно без пропусков (element_1, element_2, ...).
Уровни (level_N) задают правильный порядок, ссылаясь на element_X.
Если два элемента равноправны на одном уровне — перечисли их через запятую: level_2: element_3, element_4.
</output_format>

<example>
@SEQUENCE
# Расположите стадии крупозной пневмонии в порядке их развития
element_1: Стадия прилива
element_2: Стадия красного опеченения
element_3: Стадия серого опеченения
element_4: Стадия разрешения
level_1: element_1
level_2: element_2
level_3: element_3
level_4: element_4

@SEQUENCE
# Упорядочьте действия врача при подозрении на пневмонию
element_1: Сбор жалоб и анамнеза
element_2: Физикальный осмотр и аускультация
element_3: Назначение рентгенографии грудной клетки
element_4: Забор мокроты на анализ
element_5: Назначение антибактериальной терапии
level_1: element_1
level_2: element_2
level_3: element_3
level_4: element_4
level_5: element_5
</example>`
            },
            test: {
                title: 'Тест (@TEST)',
                instructions: `1. Скопируйте промпт и отправьте его ИИ-агенту.
2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.
3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа TEST — это тестовые вопросы с вариантами ответов. Студент выбирает один или несколько правильных вариантов из предложенных. Тесты позволяют быстро проверить знание фактов, понимание терминологии и способность различать верные и ложные утверждения. Это самый распространённый формат контроля знаний.
</task_context>

<task>
Преобразуй предоставленный материал в тестовые вопросы формата @TEST. Охвати ключевые факты, определения, классификации и клинически значимые детали из материала. Варьируй сложность: от прямых вопросов на знание фактов до вопросов, требующих сопоставления и анализа.
</task>

<quality_criteria>
- На каждый вопрос 4 варианта ответа. Среди них 1–2 правильных и 2–3 неправильных.
- Неправильные варианты (дистракторы) должны быть правдоподобными — это реальные термины или утверждения из смежных тем, а не абсурдные варианты, которые легко отсеять.
- Формулировки всех вариантов сопоставимы по длине и стилю, чтобы правильный ответ не выделялся визуально.
- Вопросы покрывают разные аспекты материала, избегая повторов.
- Вопросы с несколькими правильными ответами помечай несколькими "+".
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @TEST на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@TEST
# <название теста>
? <вопрос>
+ <правильный ответ>
- <неправильный ответ>
- <неправильный ответ>
- <неправильный ответ>

Каждый вопрос начинается с "?". Правильные ответы — "+", неправильные — "-".
</output_format>

<example>
@TEST
# Контрольные вопросы: пневмония
? Какой возбудитель наиболее часто вызывает внебольничную пневмонию?
+ Streptococcus pneumoniae
- Pseudomonas aeruginosa
- Klebsiella pneumoniae
- Mycobacterium tuberculosis
? Какие из перечисленных методов применяются для диагностики пневмонии?
+ Рентгенография органов грудной клетки
+ Бактериологический анализ мокроты
- Электроэнцефалография
- Колоноскопия
? Что характерно для крупозной пневмонии в отличие от очаговой?
+ Поражение целой доли лёгкого
- Поражение отдельных долек
- Постепенное начало на фоне ОРВИ
- Отсутствие лихорадки
</example>`
            },
            click_text: {
                title: 'Ошибки — выбор из вариантов (@CLICK_TEXT)',
                instructions: `1. Скопируйте промпт и отправьте его ИИ-агенту.
2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.
3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа CLICK_TEXT — это упражнения на классификацию утверждений. Студент видит список утверждений и должен кликнуть на верные (или неверные — в зависимости от инструкции). Все варианты отображаются как равноправные карточки, студент отмечает нужные. Этот формат развивает критическое мышление и способность отличать достоверную информацию от заблуждений.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @CLICK_TEXT. Для каждого задания сформулируй набор утверждений, часть которых верна, а часть содержит распространённые ошибки, заблуждения или неточности по теме материала.
</task>

<quality_criteria>
- Каждое задание содержит 4–7 утверждений: часть верных (+), часть неверных (-).
- Неверные утверждения основаны на типичных заблуждениях или подменах понятий, а не на очевидных нелепостях.
- Все утверждения относятся к одной теме, указанной в вопросе.
- Формулировки утверждений сопоставимы по длине и стилю.
- Вопрос в строке # однозначно указывает задачу: выбрать верные, выбрать неверные, или выбрать характерные признаки.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @CLICK_TEXT на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@CLICK_TEXT
# <вопрос или инструкция>
+ <верное утверждение>
+ <верное утверждение>
- <неверное утверждение>
- <неверное утверждение>

Верные утверждения — "+", неверные — "-".
</output_format>

<example>
@CLICK_TEXT
# Выберите верные утверждения о внебольничной пневмонии
+ Наиболее частый возбудитель — пневмококк
+ Характерны лихорадка, кашель и одышка
+ Рентгенография — основной метод подтверждения диагноза
- Антибиотики назначают только после получения результатов посева
- Вирусная пневмония всегда протекает легче бактериальной
- Пневмония не может развиться у молодых здоровых людей

@CLICK_TEXT
# Укажите, какие осложнения характерны для пневмонии
+ Плеврит
+ Абсцесс лёгкого
+ Дыхательная недостаточность
- Язвенная болезнь желудка
- Глаукома
</example>`
            },
            click_words: {
                title: 'Ошибки — поиск ошибок в тексте (@CLICK_WORDS)',
                instructions: `1. Скопируйте промпт и отправьте его ИИ-агенту.
2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.
3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа CLICK_WORDS — это упражнения на поиск ошибок в тексте. Студент читает текст, в котором намеренно допущены фактические ошибки, и кликает на слова или фразы, которые считает неверными. Этот формат развивает внимательное чтение, критический анализ информации и глубокое владение материалом — студент должен не просто знать правильный ответ, но и распознать, где именно текст искажает факты.
</task_context>

<task>
На основе предоставленного материала создай задания формата @CLICK_WORDS. Для каждого задания напиши связный текст из 2–4 предложений, в котором большая часть информации верна, но 2–4 слова или фразы заменены на фактически неверные. Ошибки должны быть содержательными, а не орфографическими.
</task>

<quality_criteria>
- Текст читается как связный и осмысленный параграф — ошибки не должны быть очевидны без знания материала.
- Ошибки — это подмены фактов: неправильные числа, перепутанные термины, инверсия причинно-следственных связей, неверные характеристики.
- Ошибочные фрагменты обёрнуты в [квадратные скобки]. В скобки заключается именно неверное слово или фраза, минимально необходимая для идентификации ошибки.
- Верная часть текста должна быть действительно верной — проверяй факты.
- Каждое задание содержит 2–4 ошибки, равномерно распределённых по тексту.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @CLICK_WORDS на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@CLICK_WORDS
# <инструкция: что именно искать>
text: <связный текст, где ошибочные фрагменты обёрнуты в [квадратные скобки]>
</output_format>

<example>
@CLICK_WORDS
# Найдите фактические ошибки в описании пневмонии
text: Пневмония — это воспалительное заболевание лёгких, чаще всего вызываемое [грибками]. Основные симптомы включают кашель, лихорадку и [отсутствие одышки]. Для подтверждения диагноза назначают [УЗИ органов брюшной полости]. Лечение бактериальной пневмонии проводится антибиотиками.

@CLICK_WORDS
# Найдите ошибки в описании кровообращения
text: Сердце человека состоит из [трёх] камер. Артерии несут кровь от сердца к органам, а вены — от органов к сердцу. Малый круг кровообращения проходит через [печень], где происходит газообмен. В норме частота сердечных сокращений взрослого человека составляет [40–50] ударов в минуту.
</example>`
            }
        };
    }

    updateAIAgentPromptTextarea() {
        const textarea = document.getElementById('ai-agent-prompt-textarea');
        const instructionsEl = document.getElementById('ai-agent-instructions');
        if (!textarea) return;
        const options = this.getAIAgentTemplateOptions();
        const active = options[this.aiTemplateType] || options.open_answer;
        textarea.value = active.prompt;
        if (instructionsEl) {
            instructionsEl.innerHTML = `
                <div class="flex items-start gap-2">
                    <span class="material-symbols-outlined text-info text-[18px] mt-0.5">lightbulb</span>
                    <div class="text-xs text-info-text whitespace-pre-line">${this.escapeHtml(active.instructions)}</div>
                </div>
            `;
        }
    }

    async copyAIAgentPrompt() {
        try {
            const options = this.getAIAgentTemplateOptions();
            const active = options[this.aiTemplateType] || options.open_answer;
            await this.writeToClipboard(active.prompt);
            this.showToast('Промпт для ИИ-агента скопирован в буфер обмена.', 'success');
        } catch (error) {
            this.showToast('Не удалось скопировать промпт. Скопируйте текст вручную.', 'error');
        }
    }

    async pasteImportTextFromClipboard() {
        const textArea = document.getElementById('import-text-area');
        if (!textArea) return;

        try {
            const text = await this.readFromClipboard();
            if (typeof text !== 'string' || !text.length) {
                this.showToast('Буфер обмена пуст.', 'warning');
                return;
            }
            textArea.value = text;
            this.sourceText = text;
            this._updateLiveCounter(text);
            this.showToast('Текст из буфера обмена вставлен.', 'success');
        } catch (error) {
            this.showToast('Не удалось прочитать буфер обмена. Используйте Ctrl+V.', 'warning');
        }
    }

    async writeToClipboard(text) {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(temp);
        if (!ok) throw new Error('copy_failed');
    }

    async readFromClipboard() {
        if (navigator?.clipboard?.readText) {
            return navigator.clipboard.readText();
        }
        throw new Error('clipboard_read_not_supported');
    }

    // showToast is defined above in the class

    updateTopicSelect() {
        const topicSelect = document.getElementById('import-topic-select');
        if (!topicSelect) return;

        const module = this.dashboard.catalog.find(m => m.id === this.selectedModule);

        if (!module || !module.topics) {
            topicSelect.disabled = true;
            topicSelect.innerHTML = '<option value="">Модуль не содержит тем...</option>';
            return;
        }

        topicSelect.disabled = false;
        topicSelect.innerHTML = `
            <option value="">Выберите тему...</option>
            ${module.topics.map(t => `<option value="${t.id}">${t.name || t.id}</option>`).join('')}
        `;

        // Restore selection
        if (this.selectedTopic) {
            topicSelect.value = this.selectedTopic;
        }
    }

    // =========================================================================
    // API Calls
    // =========================================================================

    async parseText(text, moduleId, topicId) {
        try {
            const response = await fetch('/api/editor/import/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: moduleId,
                    topic_id: topicId,
                    text: text
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Parse error:', error);
            throw error;
        }
    }

    async executeImport(moduleId, topicId, tasks, options = {}) {
        try {
            const response = await fetch('/api/editor/import/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: moduleId,
                    topic_id: topicId,
                    tasks: tasks,
                    import_context: options.importContext || null,
                    idempotency_key: options.idempotencyKey || null,
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Import error:', error);
            throw error;
        }
    }

    // =========================================================================
    // Actions
    // =========================================================================

    async handleNext() {
        if (this.currentStep === 1) {
            if (this.importMode === 'ai') {
                // Validate AI step 1: need material + module/topic
                if (!this.selectedModule || !this.selectedTopic) {
                    this.showToast('Выберите модуль и тему', 'warning');
                    return;
                }
                // Save textarea content
                const textarea = document.getElementById('ai-material-textarea');
                if (textarea) this.materialText = textarea.value;

                if (!this.materialText || this.materialText.split(/\s+/).filter(Boolean).length < 50) {
                    this.showToast('Загрузите файл или вставьте текст (минимум 50 слов)', 'warning');
                    return;
                }
                if (this.aiOutputLanguageMode === 'custom' && !this.aiOutputLanguage) {
                    this.showToast('Выберите язык для генерируемых заданий', 'warning');
                    return;
                }

                // Go to Step 2 and trigger analysis
                this.nextStep();
                await this.aiAnalyze();
                return;
            }

            if (this.importMode === 'text') {
                // Validate step 1 Text
                if (!this.selectedModule || !this.selectedTopic) {
                    alert('Пожалуйста, выберите модуль и тему');
                    return;
                }
                this.nextStep();
            } else {
                // Validate step 1 Archive
                if (!this.uploadedFile) {
                    alert('Пожалуйста, выберите файл архива');
                    return;
                }
                // Go to Step 2 (Validation Spinner) which automatically triggers Step 3
                this.nextStep();

                // Trigger validation
                try {
                    const formData = new FormData();
                    formData.append('file', this.uploadedFile);

                    const response = await fetch('/api/editor/import/check', {
                        method: 'POST',
                        body: formData
                    });
                    const result = await response.json();

                    if (result.ok) {
                        this.parsedResult = result; // Reuse parsedResult structure
                        this.archiveCacheId = result.cache_id || null;
                        this.nextStep(); // Go to Step 3 (Preview)
                    } else {
                        alert("Ошибка проверки архива: " + result.error);
                        this.prevStep();
                    }
                } catch (e) {
                    alert("Ошибка: " + e.message);
                    this.prevStep();
                }
            }
        } else if (this.currentStep === 2) {
            if (this.importMode === 'ai') {
                // AI Step 2 → Step 3: trigger generation
                this.nextStep();
                await this.aiGenerate();
                return;
            }

            // Parse text
            if (!this.sourceText.trim()) {
                alert('Пожалуйста, введите текст с заданиями');
                return;
            }

            // Show loading step
            this.nextStep();

            try {
                const result = await this.parseText(this.sourceText, this.selectedModule, this.selectedTopic);

                // Check if parsing was successful
                if (!result.ok) {
                    // Parse failed - show error and go back to step 2
                    this.parsedResult = {
                        parsing_errors: [result.error || 'Unknown parsing error']
                    };
                    this.prevStep();
                    return;
                }

                // Check for critical parsing errors
                if (result.parsing_errors && result.parsing_errors.length > 0) {
                    this.parsedResult = result;
                    this.prevStep();
                    return;
                }

                // Success - show preview
                this.parsedResult = result;
                this.importRequestKey = null;
                this.renderCurrentStep();
            } catch (error) {
                // Network or other error
                this.parsedResult = {
                    parsing_errors: ['Ошибка парсинга: ' + error.message]
                };
                this.prevStep();
            }
        } else if (this.currentStep === 3) {
            // Go to confirmation
            this.nextStep();
        } else if (this.currentStep === 4) {
            // Execute import
            await this.handleImport();
        }
    }

    async handleImport() {
        if (this.importInProgress) {
            return;
        }
        this.importInProgress = true;
        this.updateNavigationButtons();
        try {
            if (this.importMode === 'text' || this.importMode === 'ai') {
                const validTasks = this.parsedResult.tasks.filter((t, i) => t.status !== 'error' && !this.excludedTasks.has(i));
                if (!this.importRequestKey) {
                    this.importRequestKey = this._makeIdempotencyKey();
                }
                const importContext = this.importMode === 'ai'
                    ? {
                        source: 'ai',
                        ai_run_id: this.aiRunId || this.generationResult?.ai_run_id || null,
                        ai_provider: this.aiProvider || null,
                        ai_model: this.aiProviderModel || null,
                        source_file_info: this.aiFileInfo || (this.aiUploadedFile ? { name: this.aiUploadedFile.name } : null),
                        source_file_name: this.aiUploadedFile?.name || this.aiFileInfo?.name || null,
                    }
                    : { source: 'text' };
                const result = await this.executeImport(this.selectedModule, this.selectedTopic, validTasks, {
                    importContext,
                    idempotencyKey: this.importRequestKey,
                });
                if (result.ok) {
                    this.showToast(`Успешно импортировано ${result.imported} заданий!`, 'success');
                    this.dashboard.closeModals(); // Use dashboard helper
                    this.dashboard.loadCatalog();
                } else {
                    this.showToast('Ошибка импорта: ' + (result.error || 'Неизвестная ошибка'), 'error');
                }
            } else {
                // Archive Import
                const conflictRes = document.getElementById('conflict-resolution-select')?.value || 'skip';
                const skipErrors = document.getElementById('skip-errors-checkbox')?.checked || false;

                const formData = new FormData();
                if (this.archiveCacheId) {
                    formData.append('cache_id', this.archiveCacheId);
                } else {
                    formData.append('file', this.uploadedFile);
                }
                formData.append('conflict_resolution', conflictRes);
                formData.append('skip_errors', skipErrors.toString());
                if (this.selectedModule) formData.append('target_module_id', this.selectedModule);
                if (this.selectedTopic) formData.append('target_topic_id', this.selectedTopic);
                // Per-task conflict overrides
                if (this.perTaskConflictRes.size > 0) {
                    const overrides = {};
                    this.perTaskConflictRes.forEach((v, k) => { overrides[k] = v; });
                    formData.append('per_task_conflict', JSON.stringify(overrides));
                }

                // UI Loading State
                const btn = document.querySelector('[data-role="import-next"]');
                const originalText = await this._getButtonContent(btn);
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'Импорт...';
                }

                // Create visual progress bar
                const progressContainer = document.createElement('div');
                progressContainer.id = 'import-progress-bar-container';
                progressContainer.className = 'mt-4 px-2';
                progressContainer.innerHTML = `
                    <div class="flex items-center justify-between text-sm text-text-secondary mb-1">
                        <span id="import-progress-label">Подготовка...</span>
                        <span id="import-progress-percent">0%</span>
                    </div>
                    <div class="w-full bg-surface-alt rounded-full h-3 overflow-hidden">
                        <div id="import-progress-fill" class="h-full bg-primary rounded-full transition-all duration-300 ease-out" style="width: 0%"></div>
                    </div>
                `;
                const stepContent = document.querySelector('#import-step-content') || btn?.parentElement;
                if (stepContent) stepContent.appendChild(progressContainer);

                try {
                    const response = await fetch('/api/editor/import/confirm', {
                        method: 'POST',
                        body: formData
                    });

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    let finalResult = null;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            if (!line.trim()) continue;
                            try {
                                const msg = JSON.parse(line);
                                if (msg.type === 'progress') {
                                    const pct = Math.round((msg.current / (msg.total || 1)) * 100);
                                    const fill = document.getElementById('import-progress-fill');
                                    const label = document.getElementById('import-progress-label');
                                    const pctEl = document.getElementById('import-progress-percent');
                                    if (fill) fill.style.width = `${pct}%`;
                                    if (label) label.textContent = msg.status || `Задание ${msg.current} из ${msg.total}`;
                                    if (pctEl) pctEl.textContent = `${pct}%`;
                                    if (btn) btn.textContent = `Импорт... ${pct}%`;
                                } else if (msg.type === 'result') {
                                    finalResult = msg.data;
                                } else if (msg.type === 'error') {
                                    throw new Error(msg.error);
                                }
                            } catch (e) {
                                console.error("Error parsing stream line:", e);
                            }
                        }
                    }

                    if (finalResult) {
                        if (finalResult.ok) {
                            if (typeof NotificationUI !== 'undefined') {
                                NotificationUI.toast(`Импорт завершен: ${finalResult.imported} добавлено, ${finalResult.skipped} пропущено, ${finalResult.errors} ошибок.`, 'success');
                            } else {
                                alert(`Импорт завершен: ${finalResult.imported} добавлено, ${finalResult.skipped} пропущено, ${finalResult.errors} ошибок.`);
                            }
                            this.dashboard.closeModals();
                            this.dashboard.loadCatalog();
                        } else {
                            const errorMsg = finalResult.rollback
                                ? `Ошибка импорта (выполнен откат): ${finalResult.error_message || finalResult.error}`
                                : `Ошибка импорта: ${finalResult.error}`;
                            if (typeof NotificationUI !== 'undefined') {
                                NotificationUI.toast(errorMsg, 'error');
                            } else {
                                alert(errorMsg);
                            }
                        }
                    }
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'Импортировать';
                    }
                    const pc = document.getElementById('import-progress-bar-container');
                    if (pc) pc.remove();
                }
            }
        } catch (error) {
            alert('Ошибка импорта: ' + error.message);
        }
        this.importInProgress = false;
        this.updateNavigationButtons();
    }

    _getButtonContent(btn) {
        return btn ? btn.textContent : '';
    }

    // =========================================================================
    // Bulk Actions
    // =========================================================================

    toggleSelectAll() {
        const tasks = this.parsedResult?.tasks || [];
        const checkbox = document.getElementById('select-all-tasks');

        if (checkbox.checked) {
            // Select all
            tasks.forEach((_, index) => {
                this.selectedTasks.add(index);
            });
        } else {
            // Deselect all
            this.selectedTasks.clear();
        }

        // Re-render to update checkboxes
        this.renderCurrentStep();
    }

    toggleTaskSelection(index) {
        if (this.selectedTasks.has(index)) {
            this.selectedTasks.delete(index);
        } else {
            this.selectedTasks.add(index);
        }

        // Update select-all checkbox state
        const tasks = this.parsedResult?.tasks || [];
        const selectAllCheckbox = document.getElementById('select-all-tasks');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = this.selectedTasks.size === tasks.length && tasks.length > 0;
        }

        // Update counter
        this.renderCurrentStep();
    }

    bulkExclude() {
        if (this.selectedTasks.size === 0) return;

        // Add all selected tasks to excluded set
        this.selectedTasks.forEach(index => {
            this.excludedTasks.add(index);
        });

        // Clear selection
        this.selectedTasks.clear();

        // Re-render
        this.renderCurrentStep();
    }

    bulkInclude() {
        if (this.selectedTasks.size === 0) return;

        // Remove all selected tasks from excluded set
        this.selectedTasks.forEach(index => {
            this.excludedTasks.delete(index);
        });

        // Clear selection
        this.selectedTasks.clear();

        // Re-render
        this.renderCurrentStep();
    }

    // =========================================================================
    // AI Generation Mode
    // =========================================================================

    renderStep1AI(modules) {
        const limitInfo = this.dailyLimit;
        const limitHtml = limitInfo ? `
            <div class="flex items-center gap-2 text-xs text-text-muted">
                <span class="material-symbols-outlined text-[16px]">cloud_upload</span>
                <span>Загрузок файлов сегодня: <strong class="${limitInfo.files_remaining === 0 ? 'text-error' : 'text-text-main'}">${limitInfo.max_files_per_day - limitInfo.files_remaining}</strong> из ${limitInfo.max_files_per_day}</span>
            </div>` : '';

        return `
            <div class="space-y-5 animate-fade-in">
                <div class="p-4 bg-primary-lighter border border-primary-light rounded-lg">
                    <div class="flex items-start gap-3">
                        <span class="material-symbols-outlined text-primary text-[22px] mt-0.5">auto_awesome</span>
                        <div>
                            <h4 class="text-sm font-bold text-text-main mb-1">Как это работает</h4>
                            <ol class="text-xs text-text-secondary space-y-1 list-decimal list-inside">
                                <li>Загрузите учебный материал (файл или текст)</li>
                                <li>ИИ проанализирует материал и предложит типы заданий</li>
                                <li>Выберите нужные типы и количество</li>
                                <li>ИИ сгенерирует задания, вы просмотрите и импортируете</li>
                            </ol>
                        </div>
                    </div>
                </div>

                <!-- Module / Topic selection -->
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-semibold text-text-secondary mb-2">Целевой модуль</label>
                        <select id="import-module-select" 
                            class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm">
                            <option value="">Выберите модуль...</option>
                            ${modules.map(m => `<option value="${m.id}">${m.name || m.id}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-text-secondary mb-2">Целевая тема</label>
                        <select id="import-topic-select" 
                            class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm"
                            disabled>
                            <option value="">Сначала выберите модуль...</option>
                        </select>
                    </div>
                </div>

                <!-- Output language -->
                <div class="p-4 border border-border-subtle rounded-lg bg-surface-1">
                    <div class="flex items-start gap-2 mb-3">
                        <span class="material-symbols-outlined text-[18px] text-primary mt-0.5">translate</span>
                        <div>
                            <div class="text-sm font-semibold text-text-main">Язык генерируемых заданий</div>
                            <div class="text-xs text-text-secondary">Выберите язык вывода заранее: это повлияет на анализ и генерацию.</div>
                        </div>
                    </div>
                    <div class="space-y-2">
                        <label class="flex items-start gap-2 p-2 rounded-lg border border-border-subtle bg-surface-2 cursor-pointer">
                            <input type="radio" name="ai-output-language-mode" value="same_as_material"
                                class="mt-0.5 text-primary focus:ring-primary"
                                ${this.aiOutputLanguageMode !== 'custom' ? 'checked' : ''}>
                            <div class="min-w-0">
                                <div class="text-sm font-medium text-text-main">Согласен: задания на языке материала</div>
                                <div class="text-xs text-text-muted">Рекомендуемый вариант для лучшего качества и меньшего числа правок.</div>
                            </div>
                        </label>
                        <label class="flex items-start gap-2 p-2 rounded-lg border border-border-subtle bg-surface-2 cursor-pointer">
                            <input type="radio" name="ai-output-language-mode" value="custom"
                                class="mt-0.5 text-primary focus:ring-primary"
                                ${this.aiOutputLanguageMode === 'custom' ? 'checked' : ''}>
                            <div class="min-w-0 flex-1">
                                <div class="text-sm font-medium text-text-main">Выбрать другой язык заданий</div>
                                <div class="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                                    <select id="ai-output-language-select"
                                        class="rounded-lg border-border-subtle bg-surface-1 py-2 px-2 text-sm text-text-main focus:ring-2 focus:ring-primary ${this.aiOutputLanguageMode !== 'custom' ? 'opacity-60' : ''}"
                                        ${this.aiOutputLanguageMode !== 'custom' ? 'disabled' : ''}>
                                        <option value="ru" ${this.aiOutputLanguage === 'ru' ? 'selected' : ''}>Русский</option>
                                        <option value="en" ${this.aiOutputLanguage === 'en' ? 'selected' : ''}>English</option>
                                    </select>
                                    <span class="text-[11px] text-warning-text ${this.aiOutputLanguageMode === 'custom' ? '' : 'hidden'}" id="ai-output-language-warning">
                                        Перевод может быть посредственным; задания почти наверняка потребуют доработки в редакторе.
                                    </span>
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- File Upload -->
                <div>
                    <label class="block text-sm font-semibold text-text-secondary mb-2">Загрузка материала</label>
                    <div id="ai-drop-zone" class="border-2 border-dashed border-border-subtle rounded-lg p-6 text-center bg-surface-2 hover:bg-bg-hover hover:border-primary transition-all cursor-pointer relative">
                        <input type="file" id="ai-file-input" accept=".pdf,.docx,.txt" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                        <div class="pointer-events-none">
                            ${this.aiUploadedFile ? `
                                <span class="material-symbols-outlined text-3xl text-success-text mb-1">check_circle</span>
                                <p class="text-sm font-bold text-success-text" id="ai-file-name">${this.escapeHtml(this.aiUploadedFile.name)}</p>
                                <p class="text-xs text-text-muted mt-1">${this.aiFileInfo ? `${this.aiFileInfo.word_count} слов` : 'Загружено'}</p>
                            ` : `
                                <span class="material-symbols-outlined text-3xl text-text-disabled mb-1">upload_file</span>
                                <p class="text-sm font-medium text-text-secondary" id="ai-file-name">Перетащите PDF, DOCX или TXT</p>
                                <p class="text-xs text-text-disabled mt-1">Максимум 18 МБ</p>
                            `}
                        </div>
                    </div>
                    ${limitHtml}
                </div>

                <!-- Or paste text -->
                <div>
                    <div class="flex items-center gap-3 mb-2">
                        <div class="flex-1 h-px bg-border-subtle"></div>
                        <span class="text-xs text-text-disabled font-medium">или вставьте текст</span>
                        <div class="flex-1 h-px bg-border-subtle"></div>
                    </div>
                    <textarea id="ai-material-textarea" rows="6" 
                        class="block w-full rounded-lg border-border-subtle bg-surface-2 p-3 text-sm text-text-main focus:ring-2 focus:ring-primary resize-y"
                        placeholder="Вставьте учебный материал сюда...">${this.escapeHtml(this.materialText)}</textarea>
                    <div class="flex justify-between mt-1">
                        <span class="text-xs text-text-disabled" id="ai-word-count">${this.materialText ? this.materialText.split(/\s+/).filter(Boolean).length + ' слов' : ''}</span>
                        <span class="text-xs text-text-disabled">Минимум 50 слов</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderStep2AI() {
        if (this.aiAnalyzing) {
            return `
                <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                    <img src="/assets/logo_animated.svg" alt="AI Analyzing" class="w-16 h-16 mb-4 drop-shadow-md" />
                    <h3 class="text-lg font-bold text-text-main">Анализ материала...</h3>
                    <p class="text-text-muted text-sm mt-2">ИИ изучает ваш материал и подбирает типы заданий</p>
                </div>
            `;
        }

        if (!this.analysisResult) {
            return this._renderAIError('Не удалось получить результат анализа.', true);
        }

        const a = this.analysisResult;
        const recs = a.recommendations || [];
        const units = a.educational_units || [];
        const notRec = a.not_recommended || [];
        const warnings = (a.warnings || []).filter(w => w !== a.output_language_warning);
        const materialLang = a.material_language || a.target_language || 'unknown';
        const outputLang = a.effective_output_language || a.target_language || 'unknown';
        const outputLangMode = a.output_language_mode || 'same_as_material';

        // Initialize selections if empty
        if (this.aiSelectedRecs.size === 0) {
            recs.forEach(r => {
                this.aiSelectedRecs.set(r.task_type, { enabled: r.priority === 'high' || r.priority === 'medium', count: r.count });
            });
        }

        const _TYPE_LABELS = {
            'TEST': { icon: 'quiz', label: 'Тест', color: 'bg-warning-light text-warning-dark' },
            'OPEN_ANSWER': { icon: 'edit_note', label: 'Открытый ответ', color: 'bg-info-light text-info-dark' },
            'SEQUENCE': { icon: 'sort', label: 'Последовательность', color: 'bg-accent-light text-accent-dark' },
            'CLICK_TEXT': { icon: 'touch_app', label: 'Выбор утверждений', color: 'bg-secondary-light text-secondary-dark' },
            'CLICK_WORDS': { icon: 'spellcheck', label: 'Поиск ошибок', color: 'bg-error-light text-error-dark' },
        };
        const _PRIORITY_BADGES = {
            'high': '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-error-light text-error-dark">Высокий</span>',
            'medium': '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-warning-light text-warning-dark">Средний</span>',
            'low': '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-2 text-text-muted">Низкий</span>',
        };

        let totalSelected = 0;
        this.aiSelectedRecs.forEach(v => { if (v.enabled) totalSelected += v.count; });

        return `
            <div class="w-full animate-slide-up-fade">
                <div class="flex items-center justify-between mb-6">
                    <div>
                        <h3 class="text-lg font-bold text-text-main mb-1">Результат анализа</h3>
                        <p class="text-sm text-text-muted">Выберите типы заданий и количество для генерации</p>
                    </div>
                    <!-- Total -->
                    <div class="text-right">
                        <span class="text-sm text-text-secondary mr-2">Будет сгенерировано заданий:</span>
                        <span class="text-2xl font-bold text-primary align-middle" id="ai-total-count">${totalSelected}</span>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-6 items-start">
                    <!-- Left Column: Summary and Warnings -->
                    <div class="space-y-4">
                        ${a.human_summary ? `
                            <div class="p-4 bg-surface-2 rounded-lg">
                                <div class="flex items-start gap-2">
                                    <span class="material-symbols-outlined text-primary text-[20px] mt-0.5">summarize</span>
                                    <p class="text-sm text-text-secondary leading-relaxed">${this.escapeHtml(a.human_summary)}</p>
                                </div>
                            </div>
                        ` : ''}

                        <div class="p-3 bg-surface-1 border border-border-subtle rounded-lg">
                            <div class="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Язык генерации</div>
                            <div class="text-xs text-text-secondary space-y-1">
                                <p><strong class="text-text-main">Язык материала:</strong> ${this.escapeHtml(materialLang)}</p>
                                <p><strong class="text-text-main">Язык заданий:</strong> ${this.escapeHtml(outputLang)} ${outputLangMode === 'custom' ? '(выбран вручную)' : '(как в материале)'}</p>
                                ${a.output_language_warning ? `<p class="text-warning-text">${this.escapeHtml(a.output_language_warning)}</p>` : ''}
                            </div>
                        </div>

                        ${warnings.length ? `
                            <div class="p-3 bg-warning-lighter border border-warning-light rounded-lg">
                                <div class="flex items-start gap-2">
                                    <span class="material-symbols-outlined text-warning-text text-[18px]">warning</span>
                                    <div class="text-xs text-warning-text space-y-1">
                                        ${warnings.map(w => `<p>${this.escapeHtml(w)}</p>`).join('')}
                                    </div>
                                </div>
                            </div>
                        ` : ''}

                        ${notRec.length ? `
                            <div>
                                <p class="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">Не рекомендуется:</p>
                                <div class="text-xs text-text-disabled space-y-2">
                                    ${notRec.map(nr => {
            const typeInfo = _TYPE_LABELS[nr.task_type] || { label: nr.task_type };
            return `<p><strong class="text-text-secondary">${typeInfo.label}:</strong> ${this.escapeHtml(nr.reason || '')}</p>`;
        }).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Right Column: Recommendation Cards -->
                    <div class="space-y-3">
                        ${recs.map(rec => {
            const sel = this.aiSelectedRecs.get(rec.task_type) || { enabled: false, count: rec.count };
            const typeInfo = _TYPE_LABELS[rec.task_type] || { icon: 'help', label: rec.task_type, color: 'bg-surface-2 text-text-muted' };
            const coveredUnits = (rec.covers_units || []).map(id => {
                const u = units.find(u => u.id === id);
                return u ? u.title : `#${id}`;
            });

            return `
                                <div class="border-2 rounded-lg overflow-hidden transition-all ${sel.enabled ? 'border-primary bg-primary-lighter/30' : 'border-border-subtle opacity-70'}">
                                    <div class="p-3 flex items-start gap-3">
                                        <input type="checkbox" 
                                            class="w-4 h-4 mt-1 text-primary rounded focus:ring-primary flex-shrink-0"
                                            data-ai-rec-type="${rec.task_type}"
                                            ${sel.enabled ? 'checked' : ''}
                                            onchange="dashboard.importManager.toggleAIRec('${rec.task_type}', this.checked)">
                                        <span class="material-symbols-outlined ${typeInfo.color} rounded-lg p-1.5 text-[18px] mt-0.5">${typeInfo.icon}</span>
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center gap-2 mb-1">
                                                <span class="font-bold text-sm text-text-main">${typeInfo.label}</span>
                                                ${_PRIORITY_BADGES[rec.priority] || ''}
                                            </div>
                                            <!-- Truncate class removed below for full visibility -->
                                            <p class="text-xs text-text-muted leading-relaxed">${this.escapeHtml(rec.rationale || '')}</p>
                                            ${coveredUnits.length ? `<p class="text-[10px] text-text-disabled mt-2">Единицы: ${coveredUnits.join(', ')}</p>` : ''}
                                        </div>
                                        <div class="flex items-center gap-1 flex-shrink-0 mt-0.5 ml-2">
                                            <button onclick="dashboard.importManager.adjustAIRecCount('${rec.task_type}', -1)" 
                                                class="w-7 h-7 rounded-full bg-surface-2 hover:bg-bg-hover flex items-center justify-center text-text-secondary transition-colors ${!sel.enabled ? 'pointer-events-none opacity-50' : ''}">−</button>
                                            <span class="w-8 text-center font-bold text-sm text-text-main" data-ai-rec-count="${rec.task_type}">${sel.count}</span>
                                            <button onclick="dashboard.importManager.adjustAIRecCount('${rec.task_type}', 1)" 
                                                class="w-7 h-7 rounded-full bg-surface-2 hover:bg-bg-hover flex items-center justify-center text-text-secondary transition-colors ${!sel.enabled ? 'pointer-events-none opacity-50' : ''}">+</button>
                                        </div>
                                    </div>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    renderStep3AI() {
        if (this.aiGenerating) {
            return `
                <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                    <img src="/assets/logo_animated.svg" alt="AI Generating" class="w-16 h-16 mb-4 drop-shadow-md" />
                    <h3 class="text-lg font-bold text-text-main">Генерация заданий...</h3>
                    <p class="text-text-muted text-sm mt-2" id="ai-gen-progress">ИИ создаёт задания по вашему материалу</p>
                </div>
            `;
        }

        if (!this.generationResult) {
            return this._renderAIError('Не удалось сгенерировать задания.', true);
        }

        const gen = this.generationResult;
        const summary = gen.summary || {};
        const results = gen.results || [];
        const outputLangWarning = gen.output_language_warning || this.analysisResult?.output_language_warning || '';

        // Build flat task list grouped by type
        const allTasks = [];
        results.forEach(r => {
            (r.tasks || []).forEach(t => {
                allTasks.push({
                    ...t,
                    _taskType: r.task_type,
                    _provider: r.provider_used,
                    ai_meta: {
                        run_id: this.aiRunId || gen.ai_run_id || null,
                        provider_used: r.provider_used || this.aiProvider || null,
                        educational_unit_ids: Array.isArray(r.educational_unit_ids) ? [...r.educational_unit_ids] : [],
                    },
                });
            });
        });

        // Store for import
        this.parsedResult = {
            tasks: allTasks,
            summary: summary,
            notes: [],
        };
        this.importRequestKey = null;

        const _TYPE_LABELS = {
            'TEST': 'Тест', 'OPEN_ANSWER': 'Открытый ответ', 'SEQUENCE': 'Последовательность',
            'CLICK_TEXT': 'Выбор утверждений', 'CLICK_WORDS': 'Поиск ошибок',
        };

        // Group by type
        const grouped = {};
        results.forEach(r => {
            if (r.tasks && r.tasks.length > 0) {
                grouped[r.task_type] = r;
            }
        });

        const allUnits = Array.isArray(this.analysisResult?.educational_units) ? this.analysisResult.educational_units : [];
        const coverageByUnit = new Map();
        allUnits.forEach(u => {
            if (u && u.id != null) coverageByUnit.set(u.id, { unit: u, count: 0, byType: {} });
        });
        results.forEach(r => {
            const taskCount = Array.isArray(r.tasks) ? r.tasks.length : 0;
            const unitIds = Array.isArray(r.educational_unit_ids) ? r.educational_unit_ids : [];
            unitIds.forEach(unitId => {
                const bucket = coverageByUnit.get(unitId);
                if (!bucket) return;
                bucket.count += taskCount;
                bucket.byType[r.task_type] = (bucket.byType[r.task_type] || 0) + taskCount;
            });
        });
        const uncoveredUnits = [...coverageByUnit.values()].filter(x => x.count === 0);
        const overcoveredUnits = [...coverageByUnit.values()].filter(x => x.count >= 3);
        const coverageRows = [...coverageByUnit.values()].sort((a, b) => Number(a.unit.id) - Number(b.unit.id)).map(bucket => {
            const typeBreakdown = Object.entries(bucket.byType).map(([k, v]) => `${_TYPE_LABELS[k] || k}: ${v}`).join(' · ');
            const tone = bucket.count === 0
                ? 'bg-error-lighter text-error-text border-error-light'
                : (bucket.count >= 3 ? 'bg-warning-lighter text-warning-text border-warning-light' : 'bg-success-lighter text-success-text border-success-light');
            return `
                <div class="p-2 rounded-lg border ${tone}">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="text-xs font-semibold">#${bucket.unit.id} ${this.escapeHtml(bucket.unit.title || 'Unit')}</div>
                            <div class="text-[10px] opacity-80 mt-0.5">${this.escapeHtml(String(bucket.unit.type || 'unit'))}</div>
                        </div>
                        <div class="text-xs font-bold">${bucket.count}</div>
                    </div>
                    ${typeBreakdown ? `<div class="text-[10px] mt-1 opacity-90">${this.escapeHtml(typeBreakdown)}</div>` : ''}
                </div>
            `;
        }).join('');

        return `
            <div>
                <h3 class="text-lg font-bold text-text-main mb-1">Сгенерированные задания</h3>
                <p class="text-sm text-text-muted mb-4">Просмотрите задания и выберите для импорта</p>

                <!-- Summary -->
                <div class="mb-4 p-4 bg-surface-2 rounded-lg">
                    <div class="flex gap-6">
                        <div class="text-center">
                            <div class="text-2xl font-bold text-text-main">${summary.total_generated || 0}</div>
                            <div class="text-xs text-text-secondary">Всего</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-success-text">${summary.total_valid || 0}</div>
                            <div class="text-xs text-text-secondary">Готовы</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-warning-text">${summary.total_warnings || 0}</div>
                            <div class="text-xs text-text-secondary">Предупр.</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-error-text">${summary.total_errors || 0}</div>
                            <div class="text-xs text-text-secondary">Ошибки</div>
                        </div>
                    </div>
                </div>

                ${summary.quality ? `
                    <div class="mb-4 p-4 bg-surface-1 border border-border-subtle rounded-lg">
                        <div class="text-sm font-bold text-text-main mb-2">Quality Checks</div>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div class="p-2 rounded border border-border-subtle bg-surface-2">Duplicates: <span class="font-bold">${summary.quality.duplicate_groups || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-2">Lang warnings: <span class="font-bold">${summary.quality.language_mismatch_warnings || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-2">SEQ grounding: <span class="font-bold">${summary.quality.sequence_grounding_warnings || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-2">Material lang: <span class="font-bold">${this.escapeHtml(summary.quality.material_language || 'unknown')}</span></div>
                        </div>
                        <div class="mt-2 text-xs text-text-secondary">
                            Expected output lang: <span class="font-bold text-text-main">${this.escapeHtml(summary.quality.expected_output_language || gen.effective_output_language || 'unknown')}</span>
                        </div>
                    </div>
                ` : ''}

                ${outputLangWarning ? `
                    <div class="mb-4 p-3 bg-warning-lighter border border-warning-light rounded-lg">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-warning-text text-[18px]">warning</span>
                            <div class="text-xs text-warning-text">${this.escapeHtml(outputLangWarning)}</div>
                        </div>
                    </div>
                ` : ''}

                ${allUnits.length ? `
                    <div class="mb-4 p-4 bg-surface-1 border border-border-subtle rounded-lg">
                        <div class="flex items-center justify-between gap-3 mb-3">
                            <div>
                                <div class="text-sm font-bold text-text-main">Coverage</div>
                                <div class="text-xs text-text-secondary">Educational unit coverage before import</div>
                            </div>
                            <div class="text-xs text-text-secondary text-right">
                                <div>Uncovered: <span class="font-bold text-error-text">${uncoveredUnits.length}</span></div>
                                <div>Overcovered (3+): <span class="font-bold text-warning-text">${overcoveredUnits.length}</span></div>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                            ${coverageRows || '<div class="text-xs text-text-secondary">No coverage data</div>'}
                        </div>
                    </div>
                ` : ''}

                <!-- Error results -->
                ${results.filter(r => r.status === 'error' && r.parsing_errors?.length).map(r => `
                    <div class="mb-3 p-3 bg-error-lighter border border-error-light rounded-lg">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-error-text text-[18px]">error</span>
                            <div class="text-xs text-error-text">
                                <strong>${_TYPE_LABELS[r.task_type] || r.task_type}:</strong> ${r.parsing_errors.map(e => this.escapeHtml(e)).join('; ')}
                            </div>
                        </div>
                    </div>
                `).join('')}

                <!-- Grouped tasks -->
                ${Object.entries(grouped).map(([taskType, r]) => {
            const label = _TYPE_LABELS[taskType] || taskType;
            const tasks = r.tasks || [];
            const genTime = r.generation_time_ms ? ` (${(r.generation_time_ms / 1000).toFixed(1)}с)` : '';

            return `
                        <div class="mb-4 border border-border-subtle rounded-lg overflow-hidden">
                            <div class="px-4 py-2.5 bg-surface-2 flex items-center justify-between cursor-pointer"
                                onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('[data-chevron]').classList.toggle('rotate-180')">
                                <div class="flex items-center gap-2">
                                    <span class="font-bold text-sm text-text-main">${label}</span>
                                    <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-primary-lighter text-primary">${tasks.length}</span>
                                    <span class="text-[10px] text-text-disabled">${genTime}</span>
                                </div>
                                <span class="material-symbols-outlined text-text-muted text-[18px] transition-transform" data-chevron>expand_more</span>
                            </div>
                            <div class="divide-y divide-border-subtle">
                                ${tasks.map((task, i) => {
                const globalIdx = allTasks.findIndex(t => t === task || (t.index === task.index && t._taskType === taskType));
                const isExcluded = this.excludedTasks.has(globalIdx);
                const statusIcon = task.status === 'error' ? '<span class="text-error-text font-bold">✗</span>' :
                    task.status === 'warning' ? '<span class="text-warning-text font-bold">⚠</span>' :
                        '<span class="text-success-text font-bold">✓</span>';

                return `
                                        <div class="px-4 py-2.5 flex items-center gap-3 ${isExcluded ? 'opacity-40' : ''} hover:bg-bg-hover transition-colors">
                                            <input type="checkbox" class="w-4 h-4 text-primary rounded focus:ring-primary flex-shrink-0"
                                                ${!isExcluded ? 'checked' : ''}
                                                onchange="dashboard.importManager.toggleExclude(${globalIdx}); this.closest('.divide-y').parentElement.querySelector('[data-chevron]').click(); dashboard.importManager.renderCurrentStep();">
                                            <div class="flex-1 min-w-0">
                                                <p class="text-sm text-text-main truncate">${this.escapeHtml(task.name || task.prompt || `Задание #${i + 1}`)}</p>
                                                ${task.validation_issues?.length ? `
                                                    <p class="text-[10px] text-warning-text mt-0.5">${task.validation_issues.map(v => v.message).join('; ')}</p>
                                                ` : ''}
                                            </div>
                                            ${statusIcon}
                                        </div>
                                    `;
            }).join('')}
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    _renderAIError(message, showManualBtn = false) {
        return `
            <div class="max-w-md mx-auto text-center py-12">
                <div class="w-16 h-16 bg-error-light rounded-full flex items-center justify-center mx-auto mb-4">
                    <span class="material-symbols-outlined text-error text-[32px]">error_outline</span>
                </div>
                <h3 class="text-lg font-bold text-text-main mb-2">Что-то пошло не так</h3>
                <p class="text-sm text-text-muted mb-6">${this.escapeHtml(message)}</p>
                <div class="flex gap-3 justify-center">
                    <button onclick="dashboard.importManager.prevStep()" 
                        class="px-4 py-2 text-sm font-medium text-text-secondary border border-border-subtle rounded-lg hover:bg-bg-hover transition-colors">
                        Назад
                    </button>
                    ${showManualBtn ? `
                        <button onclick="dashboard.importManager.setImportMode('text'); dashboard.importManager.goToStep(1)" 
                            class="px-4 py-2 text-sm font-medium text-primary border border-primary rounded-lg hover:bg-primary hover:text-primary-fg transition-colors">
                            Ручной режим
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // =========================================================================
    // AI API Calls
    // =========================================================================

    async aiCheckStatus() {
        try {
            const resp = await fetch('/api/editor/ai/status');
            const data = await resp.json();
            this.aiStatus = data;
            this.dailyLimit = data.daily_limit || null;
            return data;
        } catch (e) {
            console.error('[AI] status check failed:', e);
            this.aiStatus = { ai_available: false };
            return this.aiStatus;
        }
    }

    async aiUploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const resp = await fetch('/api/editor/ai/upload', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.ok) {
                this.materialText = data.extracted_text;
                this.aiFileInfo = data.file_info;
                this.dailyLimit = { ...(this.dailyLimit || {}), files_remaining: (this.dailyLimit?.files_remaining ?? 3) - 1 };
                if (data.warnings?.length) {
                    this.showToast(data.warnings[0], 'warning');
                }
            } else {
                this.showToast(data.message || data.error || 'Ошибка загрузки файла', 'error');
            }
            return data;
        } catch (e) {
            console.error('[AI] upload failed:', e);
            this.showToast('Ошибка сети при загрузке файла', 'error');
            return { ok: false, error: 'network_error' };
        }
    }

    async aiAnalyze() {
        this.aiAnalyzing = true;
        this.analysisResult = null;
        this.aiRunId = null;
        this.importRequestKey = null;
        this.renderCurrentStep();

        try {
            const resp = await fetch('/api/editor/ai/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    material: this.materialText,
                    ai_run_id: this.aiRunId,
                    source_file_info: this.aiFileInfo || (this.aiUploadedFile ? { name: this.aiUploadedFile.name } : null),
                    ...this.getAIOutputLanguagePayload(),
                }),
            });
            const data = await resp.json();

            this.aiAnalyzing = false;

            if (data.ok) {
                this.analysisResult = data;
                this.aiProvider = data.provider_used;
                this.aiProviderModel = data.provider_model || null;
                this.aiRunId = data.ai_run_id || this.aiRunId;
                this.aiSelectedRecs.clear();
                this.importRequestKey = null;
            } else {
                if (data.fallback === 'manual') {
                    this.showToast(data.message || 'ИИ-сервис недоступен', 'error');
                } else {
                    this.showToast(data.message || data.error || 'Ошибка анализа', 'error');
                }
            }
            this.renderCurrentStep();
            return data;
        } catch (e) {
            console.error('[AI] analyze failed:', e);
            this.aiAnalyzing = false;
            this.showToast('Ошибка сети при анализе материала', 'error');
            this.renderCurrentStep();
            return { ok: false, error: 'network_error' };
        }
    }

    async aiGenerate() {
        const tasksToGenerate = [];
        this.aiSelectedRecs.forEach((val, key) => {
            if (val.enabled && val.count > 0) {
                const rec = (this.analysisResult?.recommendations || []).find(r => r.task_type === key);
                tasksToGenerate.push({
                    task_type: key,
                    count: val.count,
                    educational_units: rec?.covers_units ?
                        (this.analysisResult?.educational_units || []).filter(u => rec.covers_units.includes(u.id)) : [],
                });
            }
        });

        if (tasksToGenerate.length === 0) {
            this.showToast('Выберите хотя бы один тип заданий', 'warning');
            return { ok: false };
        }

        this.aiGenerating = true;
        this.generationResult = null;
        this.importRequestKey = null;
        this.renderCurrentStep();

        try {
            const resp = await fetch('/api/editor/ai/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    material: this.materialText,
                    ai_run_id: this.aiRunId,
                    tasks_to_generate: tasksToGenerate,
                    ...this.getAIOutputLanguagePayload(),
                }),
            });
            const data = await resp.json();

            this.aiGenerating = false;

            if (data.ok) {
                this.generationResult = data;
                this.aiRunId = data.ai_run_id || this.aiRunId;
                this.excludedTasks.clear();
                this.importRequestKey = null;
            } else {
                this.showToast(data.message || data.error || 'Ошибка генерации', 'error');
            }
            this.renderCurrentStep();
            return data;
        } catch (e) {
            console.error('[AI] generate failed:', e);
            this.aiGenerating = false;
            this.showToast('Ошибка сети при генерации заданий', 'error');
            this.renderCurrentStep();
            return { ok: false, error: 'network_error' };
        }
    }

    // =========================================================================
    // AI UI Helpers
    // =========================================================================

    getAIOutputLanguagePayload() {
        return {
            output_language_mode: this.aiOutputLanguageMode === 'custom' ? 'custom' : 'same_as_material',
            output_language: this.aiOutputLanguageMode === 'custom' ? (this.aiOutputLanguage || null) : null,
        };
    }

    setAIOutputLanguageMode(mode) {
        this.aiOutputLanguageMode = mode === 'custom' ? 'custom' : 'same_as_material';
        this.renderCurrentStep();
    }

    setAIOutputLanguage(lang) {
        this.aiOutputLanguage = (lang || '').trim().toLowerCase() || 'ru';
    }

    toggleAIRec(taskType, enabled) {
        const current = this.aiSelectedRecs.get(taskType) || { enabled: false, count: 0 };
        this.aiSelectedRecs.set(taskType, { ...current, enabled });
        this.renderCurrentStep();
    }

    adjustAIRecCount(taskType, delta) {
        const current = this.aiSelectedRecs.get(taskType);
        if (!current) return;
        const newCount = Math.max(1, Math.min(20, current.count + delta));
        this.aiSelectedRecs.set(taskType, { ...current, count: newCount });
        const el = document.querySelector(`[data-ai-rec-count="${taskType}"]`);
        if (el) el.textContent = newCount;
        // Update total
        let total = 0;
        this.aiSelectedRecs.forEach(v => { if (v.enabled) total += v.count; });
        const totalEl = document.getElementById('ai-total-count');
        if (totalEl) totalEl.textContent = total;
    }

    async _handleAIFileSelected(file) {
        if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        const allowedExts = ['pdf', 'docx', 'txt'];
        if (!allowedExts.includes(ext)) {
            this.showToast(`Формат .${ext} не поддерживается. Используйте PDF, DOCX или TXT.`, 'error');
            return;
        }
        if (file.size > 18 * 1024 * 1024) {
            this.showToast('Файл слишком большой (максимум 18 МБ).', 'error');
            return;
        }
        this.aiUploadedFile = file;

        // Update UI
        const nameEl = document.getElementById('ai-file-name');
        if (nameEl) {
            nameEl.textContent = file.name;
            nameEl.className = 'text-sm font-bold text-primary';
        }

        // Upload to server
        const result = await this.aiUploadFile(file);
        if (result.ok) {
            this.showToast(`Файл загружен: ${result.word_count} слов`, 'success');
            // Update word count display
            const wordCountEl = document.getElementById('ai-word-count');
            if (wordCountEl) wordCountEl.textContent = `${result.word_count} слов (из файла)`;
            // Update textarea
            const textarea = document.getElementById('ai-material-textarea');
            if (textarea) textarea.value = this.materialText;
        } else {
            this.aiUploadedFile = null;
            this.renderCurrentStep();
        }
    }
}

