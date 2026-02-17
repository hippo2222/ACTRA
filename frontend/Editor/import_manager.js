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
        this.importMode = 'text'; // 'text' | 'archive'
        this.uploadedFile = null;
        this.checkResult = null;
        this.archiveCacheId = null;
        this.perTaskConflictRes = new Map(); // index -> 'skip'|'overwrite'|'new_id'
        this.aiTemplateType = 'open_answer';
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
                circle.className = 'w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-contrast font-semibold text-sm';
                label.className = 'text-xs font-medium text-text-secondary';
            } else if (stepNum < this.currentStep) {
                circle.className = 'w-10 h-10 rounded-full bg-success flex items-center justify-center text-primary-contrast font-semibold text-sm cursor-pointer hover:ring-2 hover:ring-success';
                label.className = 'text-xs font-medium text-success';
            } else {
                circle.className = 'w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-text-disabled font-semibold text-sm';
                label.className = 'text-xs font-medium text-text-disabled';
            }

            // Clickable completed steps
            stepEl.onclick = stepNum < this.currentStep ? () => this.goToStep(stepNum) : null;
            stepEl.style.cursor = stepNum < this.currentStep ? 'pointer' : 'default';
        });
    }

    updateNavigationButtons() {
        const prevBtn = document.querySelector('[data-role="import-prev"]');
        const nextBtn = document.querySelector('[data-role="import-next"]');

        // Prev button
        prevBtn.disabled = this.currentStep === 1;

        // Next button
        if (this.currentStep === 4) {
            nextBtn.textContent = 'Импортировать';
        } else {
            nextBtn.textContent = 'Далее';
        }
    }

    // =========================================================================
    // Step Rendering
    // =========================================================================

    renderCurrentStep() {
        const contentArea = document.querySelector('[data-role="import-content"]');

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

        this.attachStepEventListeners();
    }

    setImportMode(mode) {
        this.importMode = mode;
        this.renderCurrentStep();
    }

    renderStep1() {
        // Get modules from dashboard catalog
        const modules = this.dashboard.catalog || [];

        return `
            <div class="max-w-2xl mx-auto">
                <h3 class="text-lg font-bold text-text-main mb-6">Выберите режим импорта</h3>
                
                <div class="grid grid-cols-2 gap-4 mb-8">
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
                </div>
                
                ${this.importMode === 'text' ? this.renderStep1Text(modules) : ''}
                ${this.importMode === 'archive' ? this.renderStep1Archive(modules) : ''}
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
        if (this.importMode === 'archive') {
            // Step 2 for Archive is "Validating..." (Spinner)
            return `
               <div class="flex flex-col items-center justify-center py-12">
                   <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
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
            <div class="max-w-2xl mx-auto">
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
        if (!this.parsedResult) {
            return `
                <div class="flex flex-col items-center justify-center py-12">
                    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
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
            <div>
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
                            <div class="text-2xl font-bold text-success">${summary.valid || 0}</div>
                            <div class="text-xs text-text-secondary">✓ Готовы</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-warning">${summary.warnings || 0}</div>
                            <div class="text-xs text-text-secondary">⚠ Предупреждения</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-error">${summary.errors || 0}</div>
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
            <div class="max-w-2xl mx-auto text-center py-8">
                <div class="w-20 h-20 bg-success-light rounded-full flex items-center justify-center mx-auto mb-6">
                    <span class="material-symbols-outlined text-success text-[48px]">check_circle</span>
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
            valid: 'text-success',
            warning: 'text-warning',
            error: 'text-error',
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
            valid: '<span class="text-success font-semibold">Валидно</span>',
            warning: '<span class="text-warning font-semibold">Предупреждения</span>',
            error: '<span class="text-error font-semibold">Ошибки</span>'
        };

        const issuesHtml = (task.validation?.issues || []).map(issue => {
            const color = issue.severity === 'error' ? 'text-error' : 'text-warning';
            const icon = issue.severity === 'error' ? 'error' : 'warning';
            return `<div class="flex items-start gap-2 py-1"><span class="material-symbols-outlined ${color} text-[16px] mt-0.5">${icon}</span><span class="text-sm ${color}">${this.escapeHtml(issue.message)}</span></div>`;
        }).join('') || '<div class="text-sm text-success">Нет проблем</div>';

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
            open_answer: {
                title: 'Открытый ответ (@OPEN_ANSWER)',
                prompt: `ИНСТРУКЦИЯ ДЛЯ ПОЛЬЗОВАТЕЛЯ:
1) Вставьте свой материал вместо блока "МАТЕРИАЛ".
2) Отправьте этот текст ИИ-агенту.
3) Скопируйте ответ ИИ-агента без изменений и вставьте в импорт.

ПРОМПТ ДЛЯ ИИ-АГЕНТА:
Ты ИИ-агент. Преобразуй материал в задания строго для текстового парсера.
Тип задания: только OPEN_ANSWER.
Игнорируй Рисование и click-задачи с координатами/полигонами/freehand.

Требования к ответу:
- Верни только блоки заданий, без пояснений и без Markdown.
- Каждый блок начинается с @OPEN_ANSWER.
- Обязательная строка вопроса: # <вопрос>.
- Между заданиями оставляй пустую строку.

Формат:
@OPEN_ANSWER
# <вопрос>
= <эталонный ответ, опционально>
* <ключевое слово 1, опционально>
* <ключевое слово 2, опционально>

МАТЕРИАЛ:
<вставьте здесь исходный материал>`
            },
            sequence_assembly: {
                title: 'Последовательность (@SEQUENCE)',
                prompt: `ИНСТРУКЦИЯ ДЛЯ ПОЛЬЗОВАТЕЛЯ:
1) Вставьте свой материал вместо блока "МАТЕРИАЛ".
2) Отправьте этот текст ИИ-агенту.
3) Скопируйте ответ ИИ-агента без изменений и вставьте в импорт.

ПРОМПТ ДЛЯ ИИ-АГЕНТА:
Ты ИИ-агент. Преобразуй материал в задания строго для текстового парсера.
Тип задания: только SEQUENCE.
Игнорируй Рисование и click-задачи с координатами/полигонами/freehand.

Требования к ответу:
- Верни только блоки заданий, без пояснений и без Markdown.
- Каждый блок начинается с @SEQUENCE.
- Обязательная строка инструкции: # <описание задания>.
- Элементы: element_1, element_2, ... (без пропусков).
- Уровни: level_1, level_2, ... со ссылками на element_X.
- Между заданиями оставляй пустую строку.

Формат:
@SEQUENCE
# <описание задания>
element_1: <текст элемента 1>
element_2: <текст элемента 2>
element_3: <текст элемента 3>
level_1: element_1
level_2: element_2, element_3

МАТЕРИАЛ:
<вставьте здесь исходный материал>`
            },
            test: {
                title: 'Тест (@TEST)',
                prompt: `ИНСТРУКЦИЯ ДЛЯ ПОЛЬЗОВАТЕЛЯ:
1) Вставьте свой материал вместо блока "МАТЕРИАЛ".
2) Отправьте этот текст ИИ-агенту.
3) Скопируйте ответ ИИ-агента без изменений и вставьте в импорт.

ПРОМПТ ДЛЯ ИИ-АГЕНТА:
Ты ИИ-агент. Преобразуй материал в задания строго для текстового парсера.
Тип задания: только TEST.
Игнорируй Рисование и click-задачи с координатами/полигонами/freehand.

Требования к ответу:
- Верни только блоки заданий, без пояснений и без Markdown.
- Каждый блок начинается с @TEST.
- В каждом блоке минимум один вопрос.
- Формат вопроса: ? <текст вопроса>
- Формат ответов:
  + <правильный ответ>
  - <неправильный ответ>
- На каждый вопрос должен быть хотя бы один правильный ответ.
- Между заданиями оставляй пустую строку.

Формат:
@TEST
# <название теста, опционально>
? <вопрос 1>
+ <правильный ответ>
- <неправильный ответ>
- <неправильный ответ>
? <вопрос 2>
+ <правильный ответ>
- <неправильный ответ>

МАТЕРИАЛ:
<вставьте здесь исходный материал>`
            }
        };
    }

    updateAIAgentPromptTextarea() {
        const textarea = document.getElementById('ai-agent-prompt-textarea');
        if (!textarea) return;
        const options = this.getAIAgentTemplateOptions();
        const active = options[this.aiTemplateType] || options.open_answer;
        textarea.value = active.prompt;
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

    showToast(message, kind = 'info') {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toast === 'function') {
            NotificationUI.toast(message, kind);
            return;
        }
        alert(message);
    }

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

    async executeImport(moduleId, topicId, tasks) {
        try {
            const response = await fetch('/api/editor/import/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: moduleId,
                    topic_id: topicId,
                    tasks: tasks
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
        try {
            if (this.importMode === 'text') {
                const validTasks = this.parsedResult.tasks.filter((t, i) => t.status !== 'error' && !this.excludedTasks.has(i));
                const result = await this.executeImport(this.selectedModule, this.selectedTopic, validTasks);
                if (result.ok) {
                    alert(`Успешно импортировано ${result.imported} заданий!`);
                    this.dashboard.closeModals(); // Use dashboard helper
                    this.dashboard.loadCatalog();
                } else {
                    alert('Ошибка импорта: ' + (result.error || 'Неизвестная ошибка'));
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
}

