# Инструкция: Как применить цветовую палету к веб-интерфейсу
## Полное руководство для разработчиков (2025-2026)

---

## РАЗДЕЛ I: БАЗОВЫЕ ПРИНЦИПЫ (Шаги 1-6)

### ШАГ 1: Организуйте вашу палету в иерархию ролей

Разделите цвета на **функциональные категории**:

#### 1.1 Основные цвета (Primary Colors)
- **Определение**: цвета, которые будут появляться **чаще всего** на экране
- **Функция**: направляют внимание пользователя, связаны с брендом
- **Применение**: основные кнопки, логотип, навигация
- **Выберите 1 цвет** из вашей палеты, который чаще всего привлекает внимание

#### 1.2 Вторичные цвета (Secondary Colors)
- **Определение**: цвета, которые дополняют первичный
- **Функция**: создают контрастность и иерархию
- **Применение**: второстепенные кнопки, разделители, карточки
- **Выберите 1-2 цвета**, которые гармонируют с основным

#### 1.3 Акцентные цвета (Accent Colors)
- **Определение**: яркие цвета для привлечения внимания
- **Функция**: выделяют важные элементы, сигнализируют о состояниях
- **Применение**: ошибки (красный), успех (зелёный), предупреждения (оранжевый), информация (голубой)
- **Выберите 3-4 цвета** для разных состояний элементов

#### 1.4 Нейтральные цвета (Neutral Colors)
- **Определение**: оттенки серого для фона и текста
- **Функция**: улучшают читаемость, создают пространство
- **Применение**: фоны, текст, границы элементов
- **Если нет в палете**: создайте из существующих цветов, убирая насыщенность

**Пример организации:**
```
Ваша палета: #FF6B6B, #4ECDC4, #FFE66D, #95E1D3, #2C3E50

✓ Primary: #4ECDC4 (бирюза) — спокойный, профессиональный
✓ Secondary: #2C3E50 (тёмный синий) — дополняет первичный
✓ Accent Error: #FF6B6B (коралл) — ошибки
✓ Accent Success: #95E1D3 (мятный) — успех
✓ Accent Warning: #FFE66D (жёлтый) — предупреждения
✓ Neutral: используйте оттенки серого (не из палеты)
```

---

### ШАГ 2: Создайте вариации (оттенки и полутона)

Один цвет недостаточен. Вам нужны его вариации для разных состояний элементов.

#### 2.1 Что это такое

- **Оттенок (Shade)**: более тёмная версия цвета (добавляется чёрный)
- **Полутон (Tint)**: более светлая версия цвета (добавляется белый)

**Пример для цвета #4ECDC4:**
```
Очень светлый (фоны):    #E8F9F7
Светлый:                  #B3E5DF
Основной:                 #4ECDC4
Тёмный (для текста):      #1D9B94
Очень тёмный (границы):   #0B4F4B
```

#### 2.2 Как создать эти вариации

**Самый простой способ:**

1. Используйте онлайн-инструменты:
   - **0to255.com** — генератор оттенков
   - **Color.adobe.com** — генератор палет
   - **Figr.design** — автоматическое создание с проверкой доступности

2. **Или используйте HSL:**
   - Преобразуйте HEX → HSL (онлайн)
   - Меняйте только **L (Lightness)** значение:
     - L+20% = светлый полутон
     - L-20% = тёмный оттенок
   - Остальные значения (H, S) оставляйте неизменными

**Пример в коде:**
```css
:root {
  /* PRIMARY */
  --color-primary: #4ECDC4;
  --color-primary-light: #B3E5DF;
  --color-primary-dark: #1D9B94;
  
  /* ERROR */
  --color-error: #FF6B6B;
  --color-error-light: #FFD4D4;
  --color-error-dark: #CC3333;
}
```

---

### ШАГ 3: Проверьте контрастность (WCAG 2.0+)

**Это критически важно для доступности и читаемости.**

#### 3.1 Минимальные требования контраста

| Элемент | Минимум | Рекомендуемо |
|---------|---------|------------|
| Обычный текст (14px+) | 4.5:1 | 7:1 (AAA) |
| Крупный текст (18px+) | 3:1 | 4.5:1 (AAA) |
| UI элементы (кнопки) | 3:1 | 4.5:1 |
| Границы и разделители | 3:1 | — |

#### 3.2 Как проверить контрастность

1. **Используйте инструменты:**
   - **WebAIM Contrast Checker** (webaim.org)
   - **Deque axe DevTools** (расширение для Chrome)
   - **Color.adobe.com**

2. **Введите два цвета → инструмент покажет коэффициент**

3. **Проверьте все комбинации:**
   - ✓ Тёмный текст на светлом фоне
   - ✓ Светлый текст на тёмном фоне
   - ✓ Текст на всех вариантах фонов
   - ✓ Кнопки на фонах

#### 3.3 Если контрастность недостаточна

1. **Выберите другой цвет из палеты** — может быть более тёмным/светлым
2. **Используйте оттенки этого цвета** — темнее для текста, светлее для фонов
3. **Измените размер текста** — крупный текст (18px+) требует меньше контраста (3:1)
4. **Добавьте иконку/узор** — помимо цвета используйте символы и иконки

---

### ШАГ 4: Распределите цвета по элементам интерфейса

#### 4.1 Фоны (Backgrounds)

| Элемент | Какой цвет | Примечание |
|---------|-----------|-----------|
| Основной фон страницы | Самый светлый нейтральный | Избегайте чистого белого (#FFF) |
| Карточки/панели | На тон светлее основного | Создаёт глубину |
| Наведение (hover) | Светлый полутон основного | Показывает интерактивность |

**Пример для светлого режима:**
```css
body { background: #F8F9F9; }
.card { background: #FFFFFF; }
.card:hover { background: #E8F9F7; }
```

#### 4.2 Текст (Text)

| Элемент | Какой цвет | Размер |
|---------|-----------|--------|
| Основной текст | Тёмный нейтральный | 14-16px |
| Вторичный текст | Серый средний | 12-14px |
| Заголовки | Самый тёмный нейтральный | 24px+ |
| Ссылки | Первичный цвет | С подчеркиванием |

#### 4.3 Кнопки и интерактивные элементы

**Основная кнопка (CTA):**
```css
.btn-primary {
  background: #4ECDC4;
  color: white;
  padding: 10px 20px;
  border-radius: 6px;
}

.btn-primary:hover {
  background: #1D9B94;
}

.btn-primary:active {
  background: #0B4F4B;
}

.btn-primary:disabled {
  background: #CCCCCC;
  opacity: 0.5;
}
```

#### 4.4 Состояния элементов (Success, Error, Warning, Info)

```css
.alert-error {
  background: #FFD4D4;
  border-left: 4px solid #FF6B6B;
  color: #CC3333;
}

.alert-success {
  background: #D4F5F0;
  border-left: 4px solid #95E1D3;
  color: #0B4F4B;
}

.alert-warning {
  background: #FFECB3;
  border-left: 4px solid #FFE66D;
  color: #F57F17;
}
```

#### 4.5 Границы и разделители (Borders)

```css
.form-input {
  border: 1px solid #DDDDDD;
}

.form-input:focus {
  border: 2px solid #4ECDC4;
  outline: 2px solid rgba(78, 205, 196, 0.2);
}
```

#### 4.6 Фокусное состояние (Focus State)

```css
button:focus-visible {
  outline: 2px solid #4ECDC4;
  outline-offset: 2px;
}

a:focus-visible {
  outline: 2px solid #4ECDC4;
  border-radius: 3px;
}
```

---

### ШАГ 5: Тестируйте и итерируйте

#### 5.1 Что проверить

- [ ] Все текст читаем на всех фонах (4.5:1+)
- [ ] Кнопки чётко видны (3:1+ контраст)
- [ ] На разных устройствах (мобильное, планшет, десктоп)
- [ ] На разных экранах с разной яркостью

#### 5.2 Инструменты тестирования

1. **WebAIM Contrast Checker** — проверка контраста
2. **Color Oracle** — симуляция дальтонизма
3. **Chrome DevTools → Lighthouse → Accessibility**
4. **Реальное тестирование** — пользователи

#### 5.3 Частые проблемы и решения

| Проблема | Признак | Решение |
|----------|---------|---------|
| Низкий контраст | Текст трудно читается | Используйте более тёмный текст |
| Много цветов сразу | Интерфейс хаотичный | Максимум 3-4 цвета; остальное серое |
| Нет иерархии | Не ясно, что важно | Яркие цвета только для главных элементов |
| Однообразно | Скучный интерфейс | Используйте полутона и оттенки |

---

### ШАГ 6: Реализуйте в коде

#### 6.1 Создайте переменные CSS

```css
:root {
  /* PRIMARY */
  --color-primary: #4ECDC4;
  --color-primary-light: #B3E5DF;
  --color-primary-dark: #1D9B94;
  --color-primary-darkest: #0B4F4B;
  
  /* SECONDARY */
  --color-secondary: #2C3E50;
  --color-secondary-light: #677A8E;
  --color-secondary-dark: #1A2332;
  
  /* STATES */
  --color-success: #95E1D3;
  --color-success-light: #D4F5F0;
  --color-success-dark: #2E8B7D;
  
  --color-error: #FF6B6B;
  --color-error-light: #FFD4D4;
  --color-error-dark: #CC3333;
  
  --color-warning: #FFE66D;
  --color-warning-light: #FFECB3;
  --color-warning-dark: #F57F17;
  
  /* NEUTRAL */
  --color-text-primary: #2C3E50;
  --color-text-secondary: #7F8C8D;
  --color-text-disabled: #BDC3C7;
  
  --color-bg-primary: #F8F9F9;
  --color-bg-secondary: #FFFFFF;
  --color-bg-tertiary: #ECF0F1;
  
  --color-border: #DDDDDD;
}
```

#### 6.2 Используйте переменные в компонентах

```css
.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:hover {
  background: var(--color-primary-dark);
}

.input {
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}

.input:focus {
  border-color: var(--color-primary);
  outline: 2px solid rgba(78, 205, 196, 0.2);
}

.error-message {
  background: var(--color-error-light);
  color: var(--color-error-dark);
  border-left: 4px solid var(--color-error);
}
```

#### 6.3 Для тёмного режима

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-text-primary: #FFFFFF;
    --color-text-secondary: #AAAAAA;
    --color-bg-primary: #1A1A1A;
    --color-bg-secondary: #2D2D2D;
    --color-bg-tertiary: #3D3D3D;
    --color-border: #444444;
  }
}
```

---

# РАЗДЕЛ II: ПРОДВИНУТЫЕ ТЕХНИКИ (Шаги 7-24)

## ШАГ 7: Тёмный режим (Dark Mode)

### 7.1 Стратегия адаптации палеты

**⚠️ НЕ ДЕЛАЙТЕ:** просто инвертировать цвета.

**✓ ПРАВИЛЬНО:** создайте парную палету.

| Аспект | Светлый режим | Тёмный режим |
|--------|--------------|-------------|
| **Основной фон** | #F8F9F9 | #1A1A1A |
| **Текст** | #2C3E50 | #F1F1F1 |
| **Primary** | #4ECDC4 | #32D4CD или светлее |

```css
:root {
  --bg-primary: #F8F9F9;
  --text-primary: #2C3E50;
  --color-primary: #4ECDC4;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1A1A1A;
    --text-primary: #F1F1F1;      /* Мягкий белый */
    --color-primary: #32D4CD;     /* Светлее */
  }
}
```

**Критично:**
- **Избегайте чистого чёрного (#000000)** — используйте #1A1A1A
- **Избегайте чистого белого (#FFFFFF)** — используйте #F1F1F1

### 7.2 Требования контраста для тёмного режима

**ОДИНАКОВЫЕ для обоих режимов:**
- Обычный текст (14px+): 4.5:1
- Крупный текст (18px+): 3:1
- UI элементы: 3:1

**Пример:** мягкий белый (#F1F1F1) на тёмном (#1A1A1A) = 16:1 ✓

### 7.3 Обработка проблемных цветов

Если жёлтый (#FFE66D) невидим на тёмном фоне:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-warning: #FFD700;  /* Более тёмный жёлтый */
  }
}
```

---

## ШАГ 8: Тени и глубина (Shadows)

### 8.1 Проблема теней в тёмном режиме

**Чёрные тени (rgba(0,0,0, 0.3)) невидимы на тёмном фоне!**

### 8.2 Правильный подход

**Для светлого режима:**
```css
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
```

**Для тёмного режима:**
```css
@media (prefers-color-scheme: dark) {
  box-shadow: 0 2px 8px rgba(255, 255, 255, 0.1);
}
```

### 8.3 Рекомендуемые непрозрачности

| Сценарий | Светлый | Тёмный |
|----------|---------|--------|
| Тонкая тень | rgba(0,0,0, 0.08) | rgba(255,255,255, 0.08) |
| Средняя тень | rgba(0,0,0, 0.15) | rgba(255,255,255, 0.12) |
| Сильная тень | rgba(0,0,0, 0.25) | rgba(255,255,255, 0.15) |

### 8.4 Альтернатива — слои цвета

Вместо теней используйте разные уровни фона:

```css
:root {
  --surface-0: #F8F9F9;   /* Основной */
  --surface-1: #FFFFFF;   /* Карточки */
  --surface-2: #F0F0F0;   /* Более высокий */
}

@media (prefers-color-scheme: dark) {
  :root {
    --surface-0: #1A1A1A;
    --surface-1: #2D2D2D;
    --surface-2: #3A3A3A;
  }
}
```

---

## ШАГ 9: Анимации и переходы (Animations)

### 9.1 Цвета при анимации

```css
.button {
  background: #4ECDC4;
  transition: background 0.3s ease;
}

.button:hover {
  background: #1D9B94;  /* Браузер автоматически интерполирует */
}
```

### 9.2 Рекомендуемые длительности

| Тип | Длительность |
|-----|--------------|
| Быстрый (hover) | 150-200ms |
| Нормальный (меню) | 250-350ms |
| Медленный (модал) | 500-800ms |

### 9.3 Поддержка prefers-reduced-motion

**35% пользователей используют reduced motion!**

```css
.fade-in {
  animation: fadeIn 0.6s ease-in-out;
}

@media (prefers-reduced-motion: reduce) {
  .fade-in {
    animation: none !important;
    transition: none !important;
    opacity: 1;
  }

  * {
    animation: none !important;
    transition: none !important;
  }
}
```

---

## ШАГ 10: Модальные окна и Overlay

### 10.1 Цвет backdrop

```css
.modal-backdrop {
  background: rgba(0, 0, 0, 0.4);
}

@media (prefers-color-scheme: dark) {
  .modal-backdrop {
    background: rgba(0, 0, 0, 0.6);
  }
}
```

### 10.2 Непрозрачности по контексту

| Контекст | Opacity |
|----------|---------|
| Информационный | 0.3-0.4 |
| Стандартный | 0.4-0.5 |
| Критический | 0.5-0.6 |

---

## ШАГ 11: Боковые панели и навигация

### 11.1 Активный vs неактивный элемент

```css
.nav-item {
  background: transparent;
  color: var(--color-text-secondary);
  transition: all 250ms ease;
}

.nav-item:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: var(--color-primary);
  color: white;
  font-weight: 600;
}
```

### 11.2 Фон боковой панели

**Вариант 1:** совпадает с основным
**Вариант 2:** на тон светлее (лучше для глубины)

```css
:root {
  --bg-sidebar: #F4F5F6;  /* На тон светлее */
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-sidebar: #242424;  /* На тон светлее тёмного */
  }
}
```

---

## ШАГ 12: Градиенты (Gradients)

### 12.1 Хорошие пары цветов

```css
/* Primary → более светлый Primary */
background: linear-gradient(135deg, #4ECDC4, #32D4CD);

/* Primary → Secondary */
background: linear-gradient(135deg, #4ECDC4, #2C3E50);
```

### 12.2 Рекомендуемое направление

```css
/* Диагональ 135deg — лучше всего */
background: linear-gradient(135deg, #4ECDC4, #32D4CD);
```

### 12.3 Проверка контраста на градиентах

Текст на градиенте должен иметь 4.5:1+ контраст на всём протяжении.

---

## ШАГ 13: Input-поля и валидация

### 13.1 Состояния input-полей

```css
.input {
  border: 1px solid var(--color-border);
  transition: all 250ms;
}

.input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.2);
}

.input.error {
  border-color: var(--color-error);
  background: var(--color-error-light);
}

.input:disabled {
  background: var(--color-bg-tertiary);
  opacity: 0.6;
  cursor: not-allowed;
}
```

### 13.2 Focus ring

```css
.input:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

---

## ШАГ 14: Disabled и Locked состояния

### 14.1 Disabled элементы

```css
.button:disabled {
  background: var(--color-bg-tertiary);
  color: var(--color-text-disabled);
  cursor: not-allowed;
  opacity: 0.6;
}
```

### 14.2 Отличие locked от disabled

```css
.button.locked {
  opacity: 0.7;
  border: 2px dashed var(--color-border);
}

.button.locked::after {
  content: '🔒';
  margin-left: 8px;
}
```

---

## ШАГ 15: Специализированные компоненты

### 15.1 Badges и Tags

```css
.badge {
  display: inline-block;
  background: var(--color-primary);
  color: white;
  padding: 4px 12px;
  border-radius: 12px;
  font-weight: 600;
}

.badge.success { background: var(--color-success); }
.badge.error { background: var(--color-error); }
```

### 15.2 Loading spinners

```css
.spinner {
  border: 3px solid var(--color-bg-tertiary);
  border-top: 3px solid var(--color-primary);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## ШАГ 16: Иконки

### 16.1 Наследование цвета

```css
.icon {
  color: inherit;  /* Наследует от родителя */
}
```

### 16.2 Контрастность иконки и фона

Минимум 3:1 контраст.

---

## ШАГ 17: Таблицы и списки

### 17.1 Striped rows

```css
.table-row:nth-child(even) {
  background: var(--color-bg-tertiary);
}

.table-row:hover {
  background: rgba(78, 205, 196, 0.1);
}
```

---

## ШАГ 18: Breadcrumbs и Tabs

### 18.1 Активный элемент

```css
.breadcrumb-item {
  color: var(--color-text-secondary);
}

.breadcrumb-item.active {
  color: var(--color-text-primary);
  font-weight: 600;
}
```

---

## ШАГ 19: Доступность — расширенные правила

### 19.1 Проблемы дальтонизма

- **❌ Красный + зелёный**
- **❌ Синий + фиолетовый**
- **✓ Используйте контраст яркости**
- **✓ Добавьте иконки и текст**

### 19.2 Инструменты тестирования

- **Color Oracle** — симуляция дальтонизма
- **WebAIM Contrast Checker** — контраст
- **Deque axe DevTools** — автоматическая проверка

### 19.3 Правила для low vision

```css
.button {
  padding: 12px 24px;  /* Минимум 44x44px */
  font-size: 16px;     /* Минимум 16px */
  line-height: 1.5;
}

.icon {
  width: 24px;  /* Минимум 20-24px */
  height: 24px;
}
```

---

## ШАГ 20: Focus states и клавиатурная навигация

### 20.1 Стиль focus indicator

```css
button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

### 20.2 Solid vs полупрозрачный

**Solid — лучше для доступности!**

```css
outline: 2px solid var(--color-primary);  /* ✓ */
box-shadow: 0 0 0 3px rgba(..., 0.3);     /* ✗ Слабее */
```

---

## ШАГ 21: Уведомления (Notifications)

### 21.1 Основные 4 типа + дополнительные

```css
.alert.success { background: var(--color-success-light); }
.alert.error { background: var(--color-error-light); }
.alert.warning { background: var(--color-warning-light); }
.alert.info { background: var(--color-info-light); }

.alert.pending { background: #E3F2FD; }  /* Синий */
.alert.deprecated { background: #F3E5F5; }  /* Фиолетовый */
```

---

## ШАГ 22: Состояния при взаимодействии

### 22.1 Hover → Active → Focus

```css
.button {
  background: var(--color-primary);  /* Normal */
}

.button:hover {
  background: var(--color-primary-dark);  /* Hover */
}

.button:active {
  background: var(--color-primary-darkest);  /* Active */
  transform: scale(0.98);
}

.button:focus-visible {
  outline: 2px solid var(--color-primary);  /* Focus */
}
```

---

## ШАГ 23: Responsiveness

### 23.1 Цвета на разных размерах

**ОДИНАКОВЫЕ на всех размерах!** Меняются только размеры элементов.

```css
@media (max-width: 768px) {
  .button {
    background: var(--color-primary);  /* ОДИН И ТОТ ЖЕ */
    padding: 10px 16px;                /* Размер меняется */
  }
}
```

---

## ШАГ 24: Брендирование и консистентность

### 24.1 Интеграция с брендом

```css
:root {
  --color-brand-primary: #4ECDC4;
  --color-brand-secondary: #FF6B6B;
  --color-success: #95E1D3;
  --color-error: #FF4444;
}
```

### 24.2 Если палета не совпадает с брендом

**Решение 1:** адаптируйте палету под бренд
**Решение 2:** используйте палету для акцентов, бренд для основного
**Решение 3:** используйте палету для компонентов, бренд для логотипа

---

## ФИНАЛЬНЫЙ ЧЕКЛИСТ

- [ ] **Dark Mode**
  - [ ] Парная палета создана
  - [ ] Контраст 4.5:1+ проверен
  - [ ] Тени адаптированы

- [ ] **Shadows & Depth**
  - [ ] Тени определены для обоих режимов
  - [ ] Или используются слои цвета

- [ ] **Animations**
  - [ ] Переходы 250-350ms
  - [ ] prefers-reduced-motion поддерживается

- [ ] **Forms & Input**
  - [ ] Focus, error, success, disabled состояния
  - [ ] Outline width 2-3px

- [ ] **Accessibility**
  - [ ] Контраст 4.5:1 текст, 3:1 UI
  - [ ] Тестирование на дальтонизм (Color Oracle)
  - [ ] Focus states видны

- [ ] **Components**
  - [ ] Badges, spinners, status indicators
  - [ ] Tables, breadcrumbs, tabs
  - [ ] Notifications (success, error, warning, info, pending)

- [ ] **Testing**
  - [ ] WebAIM Contrast Checker
  - [ ] Color Oracle (дальтонизм)
  - [ ] Реальные пользователи

---

## Золотые правила

1. **Контраст — король.** 4.5:1 для текста, 3:1 для UI.
2. **Не полагайтесь только на цвет.** Добавляйте иконки и текст.
3. **Используйте переменные CSS.** Облегчает изменения.
4. **Тёмный режим — отдельная система.** Не инвертируйте.
5. **Тени требуют светлых цветов в тёмном режиме.**
6. **Анимации — 250-350ms с поддержкой reduced-motion.**
7. **Focus states обязательны.** Outline 2px + offset 2px.
8. **Disabled = серый + opacity + not-allowed cursor.**
9. **Иконки наследуют цвет текста.**
10. **Размеры важнее цвета.** 44px мин. для мобильных.
11. **Тестируйте на доступность.** WebAIM + Color Oracle.
12. **Документируйте всё.** Создайте дизайн-систему.

Успехов в создании профессионального, доступного и красивого интерфейса! 🎨✨
