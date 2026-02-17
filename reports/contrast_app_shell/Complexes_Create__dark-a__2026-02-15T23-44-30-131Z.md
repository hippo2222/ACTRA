
# Contrast Audit Report - 16.02.2026, 01:45:11

**Total Issues Found: 23**

## Text Contrast (LOW) (4 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.21** | 4.5 min | `span.text-status-error` | "*" |
| **3.02** | 4.5 min | `label.text-sm.font-medium.` | "Описание" |
| **3.02** | 4.5 min | `label.text-sm.font-medium.` | "Источник теории" |
| **3.77** | 4.5 min | `span.hidden.sm:inline` | "Удалить" |

## UI Border Contrast (10 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.01** | 3 | `input#name.form-field.form-fiel` | "Border" |
| **1.01** | 3 | `textarea#description.form-field.form-fiel` | "Border" |
| **1.01** | 3 | `select#theory-mode.form-field.form-fiel` | "Border" |
| **1.01** | 3 | `div.section-header-premi` | "Border" |
| **1.90** | 3 | `span.px-2.py-0.5.bg-bg-te` | "Border" |
| **1.04** | 3 | `div#selected-empty.bg-bg-secondary.roun` | "Border" |
| **1.00** | 3 | `div.px-4.py-3.z-10.space` | "Border" |
| **2.34** | 3 | `div.module-card.panel-ca` | "Border" |
| **2.34** | 3 | `div.module-card.panel-ca` | "Border" |
| **2.17** | 3 | `span#add-counter.counter-glass.inline` | "Border" |

## UI Component Boundary (2 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **2.08** | 3 | `input#name.form-field.form-fiel` | "Control" |
| **2.08** | 3 | `select#theory-mode.form-field.form-fiel` | "Не привязывать Новая" |

## Panel Contrast (TOO LOW) (2 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.14** | 1.3+ (visual separation) | `span.px-2.py-0.5.bg-bg-te` | "px-2 py-0.5 bg-bg-tertiary text-text-secondary bor" |
| **1.03** | 1.3+ (visual separation) | `div.w-16.h-16.rounded-fu` | "w-16 h-16 rounded-full bg-primary-lighter flex ite" |

## UI Component Boundary (MISSING) (5 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **N/A** | Visible bg or border | `button#tab-tasks.py-2.text-sm.font-me` | "Задания" |
| **N/A** | Visible bg or border | `button#tab-complexes.py-2.text-sm.font-me` | "Комплексы" |
| **N/A** | Visible bg or border | `button.module-expand` | "chevron_right" |
| **N/A** | Visible bg or border | `button.module-expand` | "chevron_right" |
| **N/A** | Visible bg or border | `button#reload-catalog.mt-2.w-full.h-9.text` | "Обновить" |

