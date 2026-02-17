
# Contrast Audit Report - 16.02.2026, 01:47:23

**Total Issues Found: 10**

## Text Contrast (LOW) (1 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **4.11** | 4.5 min | `span.text-status-error` | "*" |

## Panel Contrast (TOO LOW) (3 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.00** | 1.3+ (visual separation) | `span.px-2.py-0.5.bg-bg-tertiary.tex` | "px-2 py-0.5 bg-bg-tertiary text-text-secondary bor" |
| **1.15** | 1.3+ (visual separation) | `div.w-16.h-16.rounded-full.bg-prim` | "w-16 h-16 rounded-full bg-primary-lighter flex ite" |
| **1.04** | 1.3+ (visual separation) | `span#add-counter.counter-glass.inline-flex.item` | "counter-glass inline-flex items-center justify-cen" |

## UI Component Boundary (MISSING) (5 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **N/A** | Visible bg or border | `button#tab-tasks.py-2.text-sm.font-medium.text-` | "Задания" |
| **N/A** | Visible bg or border | `button#tab-complexes.py-2.text-sm.font-medium.text-` | "Комплексы" |
| **N/A** | Visible bg or border | `button.module-expand` | "chevron_right" |
| **N/A** | Visible bg or border | `button.module-expand` | "chevron_right" |
| **N/A** | Visible bg or border | `button#reload-catalog.mt-2.w-full.h-9.text-text-mute` | "Обновить" |

## UI Border Contrast (1 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.00** | 3 | `div.px-4.py-3.z-10.space-y-2.5.sid` | "Border" |

