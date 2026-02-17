
# Contrast Audit Report - 16.02.2026, 01:47:23

**Total Issues Found: 24**

## Text Contrast (LOW) (5 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **2.06** | 3.0 min | `span` | "Сохранить" |
| **1.22** | 4.5 min | `span.text-status-error` | "*" |
| **3.05** | 4.5 min | `label.text-sm.font-medium.text-text-` | "Описание" |
| **3.05** | 4.5 min | `label.text-sm.font-medium.text-text-` | "Источник теории" |
| **2.85** | 4.5 min | `span.hidden.sm:inline` | "Удалить" |

## UI Border Contrast (10 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.04** | 3 | `input#name.form-field.form-field-input` | "Border" |
| **1.04** | 3 | `textarea#description.form-field.form-field-textarea` | "Border" |
| **1.04** | 3 | `select#theory-mode.form-field.form-field-input` | "Border" |
| **1.02** | 3 | `div.section-header-premium.flex.it` | "Border" |
| **1.90** | 3 | `span.px-2.py-0.5.bg-bg-tertiary.tex` | "Border" |
| **1.06** | 3 | `div#selected-empty.bg-bg-secondary.rounded-xl.bor` | "Border" |
| **1.00** | 3 | `div.px-4.py-3.z-10.space-y-2.5.sid` | "Border" |
| **2.34** | 3 | `div.module-card.panel-card` | "Border" |
| **2.34** | 3 | `div.module-card.panel-card` | "Border" |
| **1.72** | 3 | `span#add-counter.counter-glass.inline-flex.item` | "Border" |

## UI Component Boundary (2 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **2.05** | 3 | `input#name.form-field.form-field-input` | "Control" |
| **2.05** | 3 | `select#theory-mode.form-field.form-field-input` | "Не привязывать Новая" |

## Panel Contrast (TOO LOW) (2 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.14** | 1.3+ (visual separation) | `span.px-2.py-0.5.bg-bg-tertiary.tex` | "px-2 py-0.5 bg-bg-tertiary text-text-secondary bor" |
| **1.03** | 1.3+ (visual separation) | `div.w-16.h-16.rounded-full.bg-prim` | "w-16 h-16 rounded-full bg-primary-lighter flex ite" |

## UI Component Boundary (MISSING) (5 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **N/A** | Visible bg or border | `button#tab-tasks.py-2.text-sm.font-medium.text-` | "Задания" |
| **N/A** | Visible bg or border | `button#tab-complexes.py-2.text-sm.font-medium.text-` | "Комплексы" |
| **N/A** | Visible bg or border | `button.module-expand` | "chevron_right" |
| **N/A** | Visible bg or border | `button.module-expand` | "chevron_right" |
| **N/A** | Visible bg or border | `button#reload-catalog.mt-2.w-full.h-9.text-text-mute` | "Обновить" |

