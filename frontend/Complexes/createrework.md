\## 📋 Детальный план реализации (с семантическими переменными)



---



\### \*\*ЭТАП 1: Структурные изменения HTML\*\*



\*\*1.1 Layout Grid\*\* (строки ~245-260)

\- ❌ Удалить: `grid-cols-\[1fr\_380px\_420px]` (3 колонки)

\- ✅ Заменить на: `grid-cols-\[1fr\_420px]` (2 колонки)

\- ❌ Удалить: весь `<div id="links-panel">` (средняя колонка с сцепками)



\*\*1.2 Структура карточки задачи\*\* (строки ~600-700)

```html

<!-- Было -->

<div class="task-card">

&nbsp; <checkbox />

&nbsp; <title />

&nbsp; <topic-tag />

</div>



<!-- Станет -->

<div class="task-card">

&nbsp; <checkbox />

&nbsp; <div class="task-content">

&nbsp;   <title />

&nbsp;   <topic-tag />

&nbsp;   <div class="task-links-inline">  ← НОВОЕ

&nbsp;     <span class="link-tag">🔗 СЦЕПКА 1</span>

&nbsp;     <span class="link-tag">Задании: 2</span>

&nbsp;   </div>

&nbsp; </div>

</div>

```



---



\### \*\*ЭТАП 2: CSS - Визуальная глубина (elevation system)\*\*



\*\*2.1 Карточки задач\*\* (новый класс `.task-card-premium`)

```css

.task-card-premium {

&nbsp; background: var(--color-bg-secondary);

&nbsp; border: 1.5px solid var(--color-border-subtle);

&nbsp; border-radius: 0.875rem; /\* 14px \*/

&nbsp; padding: 1.25rem 1.5rem;

&nbsp; box-shadow: 

&nbsp;   0 1px 3px color-mix(in srgb, var(--color-text-main) 5%, transparent),

&nbsp;   0 1px 2px color-mix(in srgb, var(--color-text-main) 10%, transparent);

&nbsp; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

}



.task-card-premium:hover {

&nbsp; border-color: var(--color-primary);

&nbsp; transform: translateY(-2px);

&nbsp; box-shadow: 

&nbsp;   0 4px 12px color-mix(in srgb, var(--color-text-main) 8%, transparent),

&nbsp;   0 2px 6px color-mix(in srgb, var(--color-primary) 15%, transparent);

}

```



\*\*2.2 Блок "Информация"\*\* (обновить существующий)

```css

.info-panel {

&nbsp; background: var(--color-surface-1);

&nbsp; border: 1.5px solid var(--color-border-subtle);

&nbsp; border-radius: 1rem;

&nbsp; padding: 1.5rem;

&nbsp; box-shadow: 0 2px 8px color-mix(in srgb, var(--color-text-main) 4%, transparent);

}

```



\*\*2.3 Блок "Задания в комплексе"\*\* (обновить)

```css

.tasks-panel {

&nbsp; background: var(--color-surface-1);

&nbsp; border: 1.5px solid var(--color-border-subtle);

&nbsp; border-radius: 1rem;

&nbsp; padding: 1.5rem;

&nbsp; box-shadow: 0 2px 8px color-mix(in srgb, var(--color-text-main) 4%, transparent);

}

```



\*\*2.4 Правая панель "Каталог"\*\* (sticky + elevation)

```css

.catalog-panel {

&nbsp; position: sticky;

&nbsp; top: 1.5rem;

&nbsp; background: var(--color-surface-1);

&nbsp; border: 1.5px solid var(--color-border-subtle);

&nbsp; border-radius: 1rem;

&nbsp; padding: 1.5rem;

&nbsp; box-shadow: 0 2px 8px color-mix(in srgb, var(--color-text-main) 4%, transparent);

&nbsp; max-height: calc(100vh - 3rem);

&nbsp; overflow-y: auto;

}

```



---



\### \*\*ЭТАП 3: Inline сцепки (теги внутри задач)\*\*



\*\*3.1 Контейнер тегов\*\*

```css

.task-links-inline {

&nbsp; display: flex;

&nbsp; flex-wrap: wrap;

&nbsp; gap: 0.5rem;

&nbsp; margin-top: 0.75rem;

&nbsp; padding-top: 0.75rem;

&nbsp; border-top: 1px solid var(--color-border-subtle);

}

```



\*\*3.2 Теги связей\*\* (цветное кодирование через семантику)

```css

.link-tag {

&nbsp; display: inline-flex;

&nbsp; align-items: center;

&nbsp; gap: 0.375rem;

&nbsp; padding: 0.375rem 0.75rem;

&nbsp; background: color-mix(in srgb, var(--color-primary) 10%, transparent);

&nbsp; border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);

&nbsp; border-radius: 0.5rem;

&nbsp; font-size: 0.75rem;

&nbsp; font-weight: 500;

&nbsp; color: var(--color-primary);

&nbsp; transition: all 0.15s ease;

&nbsp; white-space: nowrap;

}



.link-tag:hover {

&nbsp; background: color-mix(in srgb, var(--color-primary) 15%, transparent);

&nbsp; border-color: var(--color-primary);

&nbsp; transform: translateY(-1px);

&nbsp; box-shadow: 0 2px 6px color-mix(in srgb, var(--color-primary) 20%, transparent);

}



/\* Иконка связи \*/

.link-tag-icon {

&nbsp; width: 0.875rem;

&nbsp; height: 0.875rem;

&nbsp; opacity: 0.8;

}

```



---



\### \*\*ЭТАП 4: Кастомные чекбоксы\*\* (уже есть, улучшаем)



\*\*4.1 Обновить существующий `.task-checkbox-custom`\*\*

```css

.task-checkbox-custom {

&nbsp; width: 1.5rem;  /\* увеличить с 1.25rem \*/

&nbsp; height: 1.5rem;

&nbsp; border: 2px solid var(--color-border-normal);

&nbsp; border-radius: 0.375rem;

&nbsp; background: var(--color-surface-1);

&nbsp; box-shadow: inset 0 1px 2px color-mix(in srgb, var(--color-text-main) 5%, transparent);

}



.task-checkbox-input:checked + .task-checkbox-custom {

&nbsp; background: var(--color-primary);

&nbsp; border-color: var(--color-primary);

&nbsp; box-shadow: 

&nbsp;   0 2px 8px color-mix(in srgb, var(--color-primary) 30%, transparent),

&nbsp;   inset 0 1px 2px color-mix(in srgb, var(--color-text-main) 10%, transparent);

}

```



---



\### \*\*ЭТАП 5: Типографика\*\*



\*\*5.1 Заголовок задачи\*\*

```css

.task-title {

&nbsp; font-size: 1rem;

&nbsp; font-weight: 600;

&nbsp; line-height: 1.4;

&nbsp; color: var(--color-text-main);

&nbsp; margin-bottom: 0.5rem;

}

```



\*\*5.2 Topic tag\*\*

```css

.task-topic-tag {

&nbsp; font-size: 0.8125rem;

&nbsp; font-weight: 500;

&nbsp; color: var(--color-text-secondary);

&nbsp; background: var(--color-bg-tertiary);

&nbsp; border: 1px solid var(--color-border-subtle);

&nbsp; padding: 0.25rem 0.625rem;

&nbsp; border-radius: 0.375rem;

}

```



\*\*5.3 Заголовки секций\*\*

```css

.section-title {

&nbsp; font-size: 1.125rem;

&nbsp; font-weight: 700;

&nbsp; color: var(--color-text-main);

&nbsp; letter-spacing: -0.01em;

}



.section-subtitle {

&nbsp; font-size: 0.875rem;

&nbsp; font-weight: 500;

&nbsp; color: var(--color-text-muted);

&nbsp; margin-top: 0.25rem;

}

```



---



\### \*\*ЭТАП 6: Spacing (8px grid system)\*\*



\*\*6.1 Глобальные отступы\*\*

```css

/\* Container padding \*/

.main-container {

&nbsp; padding: 2rem; /\* 32px = 4×8px \*/

&nbsp; gap: 2rem;

}



/\* Card internal spacing \*/

.info-panel,

.tasks-panel,

.catalog-panel {

&nbsp; padding: 1.5rem; /\* 24px = 3×8px \*/

}



/\* Task card spacing \*/

.task-card-premium {

&nbsp; padding: 1.25rem 1.5rem; /\* 20px 24px \*/

&nbsp; margin-bottom: 0.75rem; /\* 12px gap \*/

}



/\* Section gaps \*/

.section-gap {

&nbsp; margin-bottom: 1.5rem; /\* 24px \*/

}

```



---



\### \*\*ЭТАП 7: Форма и инпуты\*\*



\*\*7.1 Input fields\*\* (обновить `.form-field`)

```css

.form-field {

&nbsp; background: var(--color-surface-1);

&nbsp; border: 1.5px solid var(--color-border-subtle);

&nbsp; border-radius: 0.75rem; /\* увеличить с 0.5rem \*/

&nbsp; padding: 0.875rem 1rem;

&nbsp; box-shadow: inset 0 1px 2px color-mix(in srgb, var(--color-text-main) 3%, transparent);

}



.form-field:focus {

&nbsp; border-color: var(--color-primary);

&nbsp; box-shadow: 

&nbsp;   0 0 0 3px color-mix(in srgb, var(--color-primary) 10%, transparent),

&nbsp;   inset 0 1px 2px color-mix(in srgb, var(--color-text-main) 3%, transparent);

}

```



\*\*7.2 Textarea\*\*

```css

.form-field-textarea {

&nbsp; min-height: 120px;

&nbsp; line-height: 1.6;

&nbsp; resize: vertical;

}

```



---



\### \*\*ЭТАП 8: Кнопки (премиум стиль)\*\*



\*\*8.1 Primary button\*\* (save кнопка)

```css

.btn-primary {

&nbsp; background: linear-gradient(135deg, 

&nbsp;   var(--color-primary) 0%, 

&nbsp;   var(--color-primary-dark) 100%);

&nbsp; color: var(--color-primary-fg);

&nbsp; border: none;

&nbsp; padding: 0.875rem 1.75rem;

&nbsp; border-radius: 0.75rem;

&nbsp; font-size: 0.9375rem;

&nbsp; font-weight: 600;

&nbsp; box-shadow: 

&nbsp;   0 4px 12px color-mix(in srgb, var(--color-primary) 30%, transparent),

&nbsp;   0 2px 4px color-mix(in srgb, var(--color-text-main) 10%, transparent);

&nbsp; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

}



.btn-primary:hover {

&nbsp; transform: translateY(-2px);

&nbsp; box-shadow: 

&nbsp;   0 6px 20px color-mix(in srgb, var(--color-primary) 40%, transparent),

&nbsp;   0 4px 8px color-mix(in srgb, var(--color-text-main) 15%, transparent);

}



.btn-primary:active {

&nbsp; transform: translateY(0);

}

```



\*\*8.2 Secondary button\*\* (Черновик, Удалить)

```css

.btn-secondary {

&nbsp; background: transparent;

&nbsp; color: var(--color-text-secondary);

&nbsp; border: 1.5px solid var(--color-border-normal);

&nbsp; padding: 0.875rem 1.5rem;

&nbsp; border-radius: 0.75rem;

&nbsp; font-weight: 500;

&nbsp; transition: all 0.15s ease;

}



.btn-secondary:hover {

&nbsp; background: var(--color-bg-secondary);

&nbsp; border-color: var(--color-border-strong);

&nbsp; color: var(--color-text-main);

}

```



\*\*8.3 Danger button\*\* (Удалить)

```css

.btn-danger {

&nbsp; color: var(--color-status-error);

&nbsp; border-color: color-mix(in srgb, var(--color-status-error) 30%, transparent);

}



.btn-danger:hover {

&nbsp; background: color-mix(in srgb, var(--color-status-error) 5%, transparent);

&nbsp; border-color: var(--color-status-error);

}

```



---



\### \*\*ЭТАП 9: Микро-взаимодействия\*\*



\*\*9.1 Slide-in анимация для задач\*\*

```css

@keyframes slideInTask {

&nbsp; from {

&nbsp;   opacity: 0;

&nbsp;   transform: translateY(10px);

&nbsp; }

&nbsp; to {

&nbsp;   opacity: 1;

&nbsp;   transform: translateY(0);

&nbsp; }

}



.task-card-premium {

&nbsp; animation: slideInTask 0.3s ease backwards;

}



/\* Staggered delays \*/

.task-card-premium:nth-child(1) { animation-delay: 0.05s; }

.task-card-premium:nth-child(2) { animation-delay: 0.1s; }

.task-card-premium:nth-child(3) { animation-delay: 0.15s; }

.task-card-premium:nth-child(4) { animation-delay: 0.2s; }

```



\*\*9.2 Ripple effect\*\*

```css

.task-card-premium:active {

&nbsp; transform: translateY(0) scale(0.98);

}

```



---



\### \*\*ЭТАП 10: JavaScript изменения\*\*



\*\*10.1 Функция `renderSelectedList()`\*\* (строки ~600-800)

\- ✅ Добавить логику определения связей для каждой задачи

\- ✅ Генерировать inline теги связей

\- ✅ Вставлять в `.task-links-inline` контейнер



\*\*10.2 Новая функция `getTaskChains(taskRef)`\*\*

```javascript

function getTaskChains(taskRef) {

&nbsp; return state.chains

&nbsp;   .map((chain, idx) => ({

&nbsp;     index: idx,

&nbsp;     label: `СЦЕПКА ${idx + 1}`,

&nbsp;     tasksCount: chain.length,

&nbsp;     isInChain: chain.includes(taskRef)

&nbsp;   }))

&nbsp;   .filter(c => c.isInChain);

}

```



\*\*10.3 HTML генерация в `renderSelectedList()`\*\*

```javascript

// Внутри цикла по tasks

const chains = getTaskChains(task.ref);



if (chains.length > 0) {

&nbsp; const linksDiv = document.createElement('div');

&nbsp; linksDiv.className = 'task-links-inline';

&nbsp; 

&nbsp; chains.forEach(chain => {

&nbsp;   const tag = document.createElement('span');

&nbsp;   tag.className = 'link-tag';

&nbsp;   tag.innerHTML = `

&nbsp;     <span class="link-tag-icon">🔗</span>

&nbsp;     <span>${chain.label}</span>

&nbsp;   `;

&nbsp;   linksDiv.appendChild(tag);

&nbsp;   

&nbsp;   // Badge с количеством

&nbsp;   const count = document.createElement('span');

&nbsp;   count.className = 'link-tag';

&nbsp;   count.textContent = `Заданий: ${chain.tasksCount}`;

&nbsp;   linksDiv.appendChild(count);

&nbsp; });

&nbsp; 

&nbsp; cardContent.appendChild(linksDiv);

}

```



---



\### \*\*ЭТАП 11: Responsive (адаптивность)\*\*



```css

@media (max-width: 1024px) {

&nbsp; .main-container {

&nbsp;   grid-template-columns: 1fr;

&nbsp;   padding: 1.5rem;

&nbsp; }

&nbsp; 

&nbsp; .catalog-panel {

&nbsp;   position: static;

&nbsp;   max-height: none;

&nbsp; }

&nbsp; 

&nbsp; .task-card-premium {

&nbsp;   padding: 1rem 1.25rem;

&nbsp; }

}



@media (max-width: 640px) {

&nbsp; .task-links-inline {

&nbsp;   flex-direction: column;

&nbsp; }

&nbsp; 

&nbsp; .link-tag {

&nbsp;   width: 100%;

&nbsp;   justify-content: center;

&nbsp; }

}

```



---



\## 📊 Итоговая статистика изменений:



| Категория | Изменений |

|-----------|-----------|

| HTML структура | ~50 строк |

| CSS новые стили | ~400 строк |

| CSS обновления | ~150 строк |

| JavaScript логика | ~80 строк |

| \*\*ИТОГО\*\* | \*\*~680 строк\*\* |



---



\## 🎯 Результат:



✅ 2-колоночный layout (освобождено 30% пространства)  

✅ Inline сцепки внутри задач  

✅ Премиум визуальная глубина (shadows, borders, elevations)  

✅ Кастомные чекбоксы с анимацией  

✅ Улучшенная типографика  

✅ 8px grid spacing system  

✅ Микро-взаимодействия  

✅ Responsive design  

✅ \*\*100% семантические переменные\*\* (без хардкода цветов)



