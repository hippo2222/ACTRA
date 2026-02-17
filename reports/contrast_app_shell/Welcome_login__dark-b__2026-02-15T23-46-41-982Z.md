
# Contrast Audit Report - 16.02.2026, 01:46:53

**Total Issues Found: 7**

**Warnings Found: 3**

## Panel Contrast (TOO HIGH) (2 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **7.62** | < 6.0 (softer look) | `section.panel-right.flex-1.flex.flex-c` | "panel-right flex-1 flex flex-col relative overflow" |
| **7.43** | < 6.0 (softer look) | `div.bg-surface-1.rounded-[2rem].sh` | "bg-surface-1 rounded-[2rem] shadow-xl p-10 flex fl" |

## Text Contrast (LOW) (2 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.13** | 3.0 min | `h2.text-4xl.md:text-6xl.font-blac` | "Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚С" |
| **1.94** | 3.0 min | `h3#loginName.text-3xl.font-black.text-text-` | "Демо профиль" |

## UI Border Contrast (1 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.23** | 3 | `input#loginPassword.w-full.pl-12.pr-12.py-4.bg-sur` | "Border" |

## Placeholder Contrast (LOW) (1 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.90** | 4.5 min | `input#loginPassword.w-full.pl-12.pr-12.py-4.bg-sur` | "РџР°СЂРѕР»СЊ" |

## UI Component Boundary (1 issues)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **1.06** | 3 | `button.w-full.py-4.bg-primary.text-wh` | "Р’РѕР№С‚Рё РІ СЃРёСЃ" |

## Text Contrast (EXCESSIVE) (3 warnings)

| Ratio | Required | Element | Text |
|---|---|---|---|
| **19.67** | < 18.0 | `h1.hero-title.text-4xl.lg:text-6x` | "ACTRA" |
| **19.67** | < 18.0 | `p.hero-subtitle.text-base.lg:tex` | "РРЅС‚РµСЂР°РєС‚РёРІРЅС‹Р№ С‚С" |
| **19.67** | < 18.0 | `div.absolute.bottom-6.left-0.right` | "V1.0.0-BETA" |

