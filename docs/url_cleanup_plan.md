# URL Cleanup Plan — убираем префикс `/ui/`

**Автор:** план составлен 2026-05-14
**Статус:** draft / готов к ревью
**Связанные ветки/PR:** TBD

---

## 1. Цель и мотивация

Сейчас все клиентские страницы продукта сервятся по URL вида:

- `https://actra.site/ui/main`
- `https://actra.site/ui/complexes`
- `https://actra.site/ui/editor?module=...&topic=...&sort=date`
- `https://actra.site/ui/session/<id>`
- `https://actra.site/ui/welcome`
- `https://actra.site/ui/settings`, `/ui/calendar`, `/ui/statistics`, `/ui/microcards`, `/ui/reference`, `/ui/theory-center`, `/ui/theory-editor`

Префикс `/ui/` — технический артефакт текущей реализации. Он не несёт смысла для пользователя, выглядит «инженерно», и его видно во всех адресных строках, шаринге ссылок, открытых вкладках. Цель этого изменения — убрать `/ui/` из адресов внутренних страниц, оставив URL вида:

- `https://actra.site/main`
- `https://actra.site/complexes`
- `https://actra.site/editor?module=...&topic=...&sort=date`
- `https://actra.site/session/<id>`
- `https://actra.site/welcome`, `/settings`, `/calendar`, `/statistics`, `/microcards`, `/reference`, `/theory-center`, `/theory-editor`

Публичный «маркетинговый» уровень (`/`, `/pricing`, `/refund`, `/privacy`, `/terms`, `/legal/*`, `/catalog`) **не трогаем** — он уже сидит на корне и сделан правильно.

---

## 2. Стратегические решения (зафиксированы при планировании)

1. **Маппинг 1 к 1**: каждый `/ui/<X>` превращается в `/<X>`. Без переименований («editor» → «editor», «complexes» → «complexes», и т.д.).
2. **Обратная совместимость**: старые `/ui/...` URL остаются рабочими и отдают **301 Moved Permanently** на новые. Бессрочно — никаких 410 Gone, чтобы не ломать старые закладки, индекс поисковиков, шаренные ссылки в чатах.
3. **Поэтапная миграция**: backend → внутренние ссылки во фронтенде → тесты → скрипты/конфиги → документация. Каждый этап — отдельный PR, чтобы можно было откатиться точечно.
4. **Документ-результат**: фиксируем фазы и чек-листы в этом файле.

---

## 3. Карта текущего состояния

### 3.1. Существующие UI-роуты

Все они определены в `desktop-app/routes/static_routes.py`. Полный список (плюс контекст):

| Текущий маршрут | Что отдаёт | Источник |
|---|---|---|
| `/` | 302 redirect → `/ui/welcome` | `serve_root_ui_alias` |
| `/ui` и `/ui/main` | `Main.html` — главная экрана приложения | `serve_main_ui` |
| `/ui/welcome` | `Welcome.html` — приветственный экран | `serve_welcome_ui` |
| `/Welcome/<filename>` | static assets экрана Welcome (legacy) | `serve_welcome_static` |
| `/ui/complexes`, `/ui/complexes/create` | список и создание комплексов | `serve_complexes_ui` / `serve_complexes_create_ui` |
| `/ui/catalog`, `/ui/catalog/<filename>` | публичный каталог | `serve_catalog_ui*` |
| `/catalog`, `/catalog/` | 302 alias → `/ui/catalog` | `serve_catalog_ui_alias` |
| `/ui/editor`, `/ui/editor/<filename>` | дашборд редактора + все его HTML/CSS/JS | `serve_editor_dashboard` / `serve_editor_file` |
| `/ui/editor/theory_center.js` | специальный обход для theory_center.js | `serve_theory_center_js` |
| `/ui/theory-center`, `/ui/theory-center/` | Theory_Center.html | `serve_theory_center_ui` |
| `/ui/theory-editor`, `/ui/theory-editor/` | Theory_Editor.html | `serve_theory_editor_ui` |
| `/ui/calendar`, `/ui/calendar/`, `/ui/calendar/<filename>`, `/ui/calendar.css` | страница «Календарь» (premium-gated) | `serve_calendar_*` |
| `/ui/statistics`, `/ui/statistics/`, `/ui/statistics/<filename>` | «Статистика» (premium-gated) | `serve_statistics_*` |
| `/ui/microcards`, `/ui/microcards/`, `/ui/microcards/<filename>` | runtime микрокарточек | `serve_microcards_*` |
| `/ui/settings`, `/ui/settings/`, `/ui/settings/<filename>` | настройки аккаунта | `serve_settings_*` |
| `/ui/reference`, `/ui/reference/`, `/ui/reference/<filename>` | онбординг-справка | `serve_reference_*` |
| `/ui/session/<id>` | S1 — выполнение задач сессии | `serve_session_ui` |
| `/ui/S1/<filename>` | static assets S1 | `serve_session_static` |
| `/ui/session/<id>/iteration/<id>` | S2 — итерационные результаты | `serve_iteration_results_ui` |
| `/ui/session/<id>/results` | S3 — финальные результаты сессии | `serve_session_results_ui` |
| `/ui/TestUI/<filename>`, `/ui/SequenceUI/<filename>`, `/ui/ClickUI/<filename>`, `/ui/DrawUI/<filename>`, `/ui/OpenAnswerUI/<filename>`, `/ui/MistakesUI/<filename>` | static assets task-UI модулей, грузятся из S1 | `serve_*_static` |
| `/assets/<filename>` | глобальные ассеты (CSS, JS, шрифты) | `serve_assets` |
| `/ui/assets/<filename>` | те же ассеты, доступные по относительным `../assets/...` со страниц `/ui/*` | `serve_ui_assets` |

### 3.2. Маршруты, которые НЕ трогаем

Эти роуты уже на «правильных» местах:

- `/` — корень (сейчас 302 на `/ui/welcome`)
- `/pricing`, `/refund`, `/refund-policy`
- `/privacy`, `/terms`, `/legal/privacy`, `/legal/terms`
- `/sitemap.xml`, `/robots.txt`, `/favicon.ico`
- `/catalog`, `/catalog/`
- `/api/*` — все API blueprint'ы (auth, admin, billing, assets, complexes, editor, sessions и т.д.)

### 3.3. Объём затронутого кода

Подсчёт вхождений `/ui/` по проекту (на 2026-05-14):

| Область | Файлов | Вхождений |
|---|---:|---:|
| `desktop-app/` (роуты, бэкенд, server, hooks, тесты юнит/интеграция) | ~17 | ~120 |
| `frontend/` (HTML, JS, тесты на месте, mocks) | 43 | 327 |
| `tests/` (mjs, py, helpers) | 64 | 281 |
| `scripts/` (audit configs, smoke runners) | 21 | 131 |
| `docs/` (планы, runbook'и, спецификации) | 12 | 60 |
| **Итого** | **~157** | **~920** |

### 3.4. Критические точки, где URL формируются динамически

Эти места **обязательно** придётся править вместе с роутами, иначе backend будет возвращать старые `/ui/...` пути даже после переноса. Полный список (после ревизии):

1. **`desktop-app/server.py`**:
   - Строка `Flask(__name__, static_folder=str(EDITOR_UI_DIR), static_url_path="/ui/editor")` — `static_url_path` прибит к `/ui/editor`.
   - `@app.before_request _redirect_unauthenticated_hosted_pages()` — auth-гейт активируется **только если** `path == "/ui"` или `path.startswith("/ui/")`. Это **самая опасная** точка: пока её не обновим, новые `/main`, `/complexes`, `/editor` будут открыты без авторизации.
   - Внутри редиректов гейта: `return redirect("/ui/welcome")` × 2.

2. **`desktop-app/api/session_api.py`** — функция `get_resume_target()`:
   - Строка `session_url = f"/ui/session/{quote(session_id, safe='')}" if session_id else "/ui/complexes"`.

3. **`desktop-app/routes/auth_routes.py`**:
   - `return redirect("/ui/welcome?auth_error=google")` (Google OAuth fallback)
   - `return redirect("/ui/welcome")` (логаут / fallback)

4. **`desktop-app/routes/static_routes.py`** — inline HTML «public shell» и «premium required» содержат hard-coded ссылки `/ui/welcome`, `/ui/main`, `/ui/settings#premium`. Это HTML, который рендерится в Python.

5. **`desktop-app/webview_launcher.py`** — desktop-обёртка указывает на `/ui/...` при старте окна.

6. **`desktop-app/routes/quick_access_routes.py`** — генерация URL для quick-access сессий (тоже динамически возвращает `/ui/session/...`).

### 3.5. Относительные ссылки в HTML (важный нюанс)

Во фронтенде ~105 вхождений `href="../assets/..."` и `src="../assets/..."`. Сейчас Main.html сервится по `/ui/main`, относительный `../assets/foo.css` разрешается браузером как `/ui/assets/foo.css` — это работает, потому что есть отдельный роут `/ui/assets/<path>`.

**Хорошая новость**: после переноса страницы на `/main`, тот же относительный путь разрешится как `/assets/foo.css`, и **роут `/assets/<path>` уже существует и обслуживает ту же директорию** (`ASSETS_DIR`). То есть относительные ссылки **не сломаются**.

Единственное исключение — страница S1, которая сейчас на `/ui/session/<id>` (двухсегментный путь). Её относительные ссылки разрешаются как `/ui/...`. После переноса на `/session/<id>` — как `/...`. И там, и там роуты есть. Перепроверить нужно только страницы, которые тянут JS соседнего модуля по `../TestUI/...` — после переноса они должны попасть на `/TestUI/<filename>` (а такого роута сейчас нет — есть только `/ui/TestUI/<filename>`). Это будет починено в Фазе 1 (новые роуты создаются без `/ui/`).

---

## 4. Целевое состояние

После завершения всех фаз каждой паре «старая → новая» соответствует:

```
/ui/main                           →   /main                          (301)
/ui/welcome                        →   /welcome                       (301)
/ui/complexes                      →   /complexes                     (301)
/ui/complexes/create               →   /complexes/create              (301)
/ui/editor                         →   /editor                        (301)
/ui/editor/<filename>              →   /editor/<filename>             (301)
/ui/theory-center                  →   /theory-center                 (301)
/ui/theory-editor                  →   /theory-editor                 (301)
/ui/calendar (+ /, +<f>, +.css)    →   /calendar (+ /, +<f>, +.css)   (301)
/ui/statistics (+ /, +<f>)         →   /statistics (+ /, +<f>)        (301)
/ui/microcards (+ /, +<f>)         →   /microcards (+ /, +<f>)        (301)
/ui/settings (+ /, +<f>)           →   /settings (+ /, +<f>)          (301)
/ui/reference (+ /, +<f>)          →   /reference (+ /, +<f>)         (301)
/ui/catalog                        →   /catalog                       (301 — сейчас уже есть alias)
/ui/session/<id>                   →   /session/<id>                  (301)
/ui/session/<id>/iteration/<iid>   →   /session/<id>/iteration/<iid>  (301)
/ui/session/<id>/results           →   /session/<id>/results          (301)
/ui/S1/<f>                         →   /S1/<f>                        (301)
/ui/TestUI/<f>                     →   /TestUI/<f>                    (301)
/ui/SequenceUI/<f>                 →   /SequenceUI/<f>                (301)
/ui/ClickUI/<f>                    →   /ClickUI/<f>                   (301)
/ui/DrawUI/<f>                     →   /DrawUI/<f>                    (301)
/ui/OpenAnswerUI/<f>               →   /OpenAnswerUI/<f>              (301)
/ui/MistakesUI/<f>                 →   /MistakesUI/<f>                (301)
/ui/assets/<f>                     →   /assets/<f>                    (301 — для относительных ../assets от страниц, оставшихся на /ui/* во время переходного периода, можно оставить алиасом без 301)
```

`/` остаётся редиректом на «домашнюю» страницу для текущего пользователя (для неавторизованных — `/welcome`, не `/ui/welcome`).

---

## 5. Архитектурное решение

### 5.1. Паттерн реализации в `static_routes.py`

Вместо дублирования handler'ов параметризуем регистрацию. Для каждой страницы добавляем **новый «канонический»** маршрут и **редирект-маршрут** со старого. Используем существующий `static_bp` Blueprint, без введения нового.

Эскиз (псевдокод, не финальный код — конкретные изменения в Фазе 1):

```python
# Новый канонический роут
@static_bp.route("/complexes", methods=["GET"])
def serve_complexes_ui_canonical() -> Any:
    return _serve_complexes_index()  # выделить общую функцию

# Редирект со старого
@static_bp.route("/ui/complexes", methods=["GET"])
def serve_complexes_ui_legacy() -> Any:
    return redirect("/complexes", code=301)
```

Альтернатива (для уменьшения шума): зарегистрировать **обе** `@route` на одной view-функции, и сохранить старый URL без редиректа. Минус — пользователь, попавший по старой ссылке, не увидит обновлённый адрес в адресной строке. **Решение: используем 301-редирект**, т.к. пользователь получает «чистый» URL после первого захода.

### 5.2. Что делать со static_url_path

`Flask(__name__, static_folder=str(EDITOR_UI_DIR), static_url_path="/ui/editor")` — это глобальный встроенный механизм Flask, который сейчас даёт Editor static при URL `/ui/editor/<filename>`. Он перекрывается явным `@static_bp.route("/ui/editor/<path:filename>")`, поэтому **на практике не используется**. Можно:

- Вариант A (рекомендую): убрать `static_folder` и `static_url_path` из конструктора Flask — нам они не нужны, всё обслуживается blueprint'ами.
- Вариант B: установить `static_url_path="/editor"`.

Решение фиксируется в Фазе 1.

### 5.3. Auth-гейт `_redirect_unauthenticated_hosted_pages`

Сейчас:
```python
if not (path == "/catalog" or path.startswith("/catalog/") or path == "/ui" or path.startswith("/ui/")):
    return None
```

Нужно расширить — гейт должен срабатывать на всех **новых** канонических путях (все UI-страницы, кроме публичных welcome/catalog/legal/pricing/refund). Самый чистый вариант:

```python
PUBLIC_PATHS = {"", "/", "/welcome", "/ui/welcome", "/catalog", "/pricing", "/refund", ...}
PUBLIC_PREFIXES = ("/Welcome/", "/catalog/", "/legal/", "/assets/", "/api/", "/ui/assets/")

# UI-пути (старые и новые), требующие auth
UI_PREFIXES = ("/ui/", "/main", "/complexes", "/editor", "/theory-center",
               "/theory-editor", "/calendar", "/statistics", "/microcards",
               "/settings", "/reference", "/session/", "/S1/", "/TestUI/", "/SequenceUI/",
               "/ClickUI/", "/DrawUI/", "/OpenAnswerUI/", "/MistakesUI/")
```

Логика «требует auth» = (`path` начинается с одного из UI-prefix'ов) AND (не публичный). Конкретный список вынести в константу.

### 5.4. Динамическая генерация URL

Везде, где URL формируется в Python и возвращается клиенту (resume target, auth redirects, premium gates), **меняем на новые URL без `/ui/`**. Список — см. §3.4.

---

## 6. План по фазам

### Фаза 1 — Backend: новые роуты + 301 редиректы + auth-гейт + dynamic URLs + SEO-фиксы

**Цель:** на бэкенде после Фазы 1 все «красивые» URL уже работают; старые `/ui/...` отдают 301. Любой клиент (включая ещё не обновлённый фронтенд) продолжает работать через редиректы. Параллельно закрываются SEO-проблемы из GSC.

**Файлы:**
1. `desktop-app/routes/static_routes.py` — основная работа:
   - Для каждой view-функции выделить shared-логику, добавить **новый** canonical route без `/ui/`, переключить старый `/ui/*` маршрут на `redirect(<new>, code=301)`.
   - Исключение: `/ui/assets/<path>` оставить как **alias без редиректа** (по решению §12.2).
   - Обновить inline-HTML (`_public_shell_page`, `_premium_required_page`) — поменять `/ui/welcome`, `/ui/main`, `/ui/settings#premium` на новые.
   - `serve_root_ui_alias`: `return redirect("/ui/welcome", code=302)` → `return redirect("/welcome", code=301)` (SEO-фикс, см. §13).
   - `serve_sitemap_xml`: в `paths` добавить `"welcome"`.
2. `desktop-app/server.py`:
   - **Выпилить** `static_folder` и `static_url_path` из `Flask(__name__, ...)` — оставить просто `Flask(__name__)`. (Безопасность подтверждена в §12.3.)
   - Расширить `_redirect_unauthenticated_hosted_pages`: добавить новые prefix'ы в список UI-путей, поменять `redirect("/ui/welcome")` на `redirect("/welcome")`.
3. `desktop-app/api/session_api.py` — `get_resume_target()`: `/ui/session/{id}` → `/session/{id}`, `/ui/complexes` → `/complexes`.
4. `desktop-app/routes/auth_routes.py` — 2 редиректа на `/ui/welcome` → `/welcome`.
5. `desktop-app/routes/quick_access_routes.py` — все генерации `/ui/session/...` → `/session/...`.
6. `desktop-app/webview_launcher.py` — стартовый URL desktop-окна.
7. `desktop-app/routes/static_routes.py` — `redirect("/ui/catalog")` в `serve_catalog_ui_alias` → `/catalog` (роут уже сам по себе на корне).
8. **`frontend/Welcome/welcome.html`** — поменять `<link rel="canonical" href="https://actra.site/" />` на `href="https://actra.site/welcome"` (SEO-фикс, см. §13.2).

**Проверка после фазы 1:**
- `curl -I https://actra.site/ui/main` → 301 на `/main`.
- `curl -I https://actra.site/main` → 200 с HTML главной.
- Поднять локальный сервер, открыть в браузере `https://localhost:.../main` — должна загрузиться главная, ассеты приехать, JS-консоль чистая.
- Открыть `https://localhost:.../ui/main` — должен сделать 301 на `/main` и страница загрузиться.
- Зайти неавторизованным на `/main` — должен 302 редиректить на `/welcome`.
- Запустить полный pytest по `desktop-app/tests/` — может упасть несколько тестов, которые проверяют точный текст редиректов; их обновить **в этой же фазе** (т.к. они в той же папке, что и роуты).
- Запустить `tests/welcome_hosted_auth.test.mjs`, `tests/test_main_screen_http.py`, `tests/test_hosted_auth_http.py` — могут потребовать минорных правок.

**Атомарность:** один PR. Размер: оценочно ~400-600 правок в 7-9 файлах.

**Rollback:** простой revert PR — старая логика возвращается, и `/ui/*` снова канонический.

---

### Фаза 2 — Frontend: внутренние ссылки в HTML и JS

**Цель:** ни одна страница приложения не генерирует и не указывает на `/ui/*` URL. Все `<a href>`, `window.location.href = ...`, `history.pushState`, fetch-вызовы и т.д. используют новые пути.

**Стратегия:** разбить на **под-PR по модулям**, чтобы каждый ревью-комит был обозримым.

| Под-PR | Модули | Файлы (примерно) |
|---|---|---|
| 2a | Welcome + Main + GlobalHeader + shared assets | `frontend/Welcome/welcome.{html,js}`, `frontend/MainScreen/Main.html`, `frontend/assets/{GlobalHeader,MainLogic,ThemeManager,SharedProfileModal,PremiumPromoModal,OnboardingTour,onboarding_tours,s2-results}.js` |
| 2b | Complexes + Catalog | `frontend/Complexes/{index,create}.html`, `frontend/Catalog/{index.html,catalog.js}` |
| 2c | Editor (большой объём, ~50+ ссылок) | `frontend/Editor/*.{html,js}` — Main_Dashboard, Theory_Center, Theory_Editor, dashboard.js, base_editor.js, test_editor.js, theory_editor.js, theory_center.js, import_manager.js |
| 2d | Sessions (S1/S2/S3 + session_flow + session-controls + routes.js) | `frontend/S1/*`, `frontend/S2/index.html`, `frontend/S3/index.html` |
| 2e | Settings + Calendar + Statistics + Microcards + Reference | `frontend/Settings/*`, `frontend/Calendar/*`, `frontend/statistics/*`, `frontend/Microcards/*`, `frontend/Reference/index.html` |

**Для каждого под-PR одинаковый flow:**
1. В целевых файлах `grep -n "/ui/"` для аудита перед началом.
2. Заменить все вхождения по таблице из §4. Регулярная массовая замена: `s|/ui/main|/main|g`, и так по списку, с **аккуратной** проверкой контекста (не задеть строки в комментариях/документации, если они не подразумевают код).
3. Проверить, не разъехались ли пути по соседним файлам (ссылка из Main.html на `/ui/settings` должна стать `/settings`, но `data-*` атрибуты или конструкции `getElementById('ui-...')` не трогать).
4. Локально открыть страницы каждого модуля и пройти по ссылкам.
5. После каждого под-PR — пройтись по соответствующим e2e/audit-тестам (фаза 4 их адаптирует, но базовый smoke на этой фазе уже хорош).

**Проверка после Фазы 2:**
- Запись Network в DevTools при типичном пути «welcome → main → editor → complexes → session» — не должно быть ни одного 301-редиректа.
- `grep -rn "/ui/" frontend/` должен вернуть только текст в `*.md` файлах (плановые заметки) и, возможно, в `PlanS1.txt`.

---

### Фаза 3 — Тесты

**Цель:** все тесты используют новые URL.

**Подфазы:**

| Под-PR | Объём | Файлы |
|---|---|---|
| 3a | Unit + integration python-тесты в `desktop-app/tests/` (несколько штук уже подкорректировано в Фазе 1) | `test_premium_static_gates.py`, `test_session_api_resume_restore.py`, `test_quick_access_routes_start_session.py`, `test_session_routes_active_sessions.py`, `test_static_routes_resume_redirect.py`, `test_server_smoke.py`, `test_ai_import_e2e.py` |
| 3b | MJS-тесты `tests/` — основные suites | `welcome_hosted_auth.test.mjs`, `test_main_screen_http.py`, `test_hosted_auth_http.py`, `test_quick_access_hosted_gate.py`, `test_api_endpoints_7_1_7_2.py`, `s1_main_load_state.test.mjs`, `s2_*.test.mjs`, `s3_*.test.mjs` |
| 3c | Editor suite | `editor_*.test.mjs`, `theory_*.test.mjs`, `theory-*.test.mjs`, `test_editor_url_context.test.mjs`, `test_editor_image_paste.test.mjs` |
| 3d | Complex audit + helpers + session controls | `complex_audit/*`, `session_controls_*.test.mjs`, `session_flow_*.test.mjs`, `complexes_create_theory_asset_refs.test.mjs`, `reference_page.test.mjs`, `onboarding_tour.test.mjs` |
| 3e | Settings suite | `settings_*.test.mjs`, `shared_profile_menu.test.mjs`, `premium_ui_static.test.mjs`, `testui_apply_feedback.test.mjs`, `debug_reload.test.mjs`, `test_error_detection_reload.mjs`, `main_statistics_widget_stability.test.mjs`, `click_errors_editor_audit.test.mjs` |

**Важно:** в тестах, которые ассертят 301-редиректы со старых URL — оставить assert (это часть контракта). В тестах, которые открывают страницы — перейти на новые URL.

**Проверка после Фазы 3:** полный прогон `pytest desktop-app/tests/` и `pytest tests/` (python part) + `node --test tests/*.test.mjs` — должно быть зелёным.

---

### Фаза 4 — Scripts и configs (contrast_audit, smoke, browser audit)

**Цель:** все автономные скрипты используют новые URL.

**Файлы:**
- `scripts/contrast_audit.*.config.json` (12 файлов) — переписать `urls` массивы.
- `scripts/contrast_audit.js`, `scripts/contrast_audit.sample.json` — поменять примеры.
- `scripts/run_browser_smoke_release.js` (29 вхождений).
- `scripts/run_hosted_launch_acceptance.js`.
- `scripts/draw_editor_browser_audit.js`, `test_editor_browser_audit.js`, `sequence_editor_browser_audit.js`.
- `scripts/theory_p10_smoke.js`.
- `scripts/verify_paddle_readiness.js`.
- `scripts/dev_localhost.ps1`.

**Проверка:** прогнать smoke и audit-скрипты на стейджинге.

---

### Фаза 5 — Документация

**Цель:** все актуальные docs ссылаются на новые URL. Архивные планы (`hosted_web_migration/*`, `microcards_productization_v1_spec.md`) — обновить выборочно или приписать пометку «URL до миграции были `/ui/...`».

**Файлы:**
- `docs/main_design_handoff.md`
- `docs/onboarding_tour_plan.md`
- `docs/microcards_rollout_runbook.md`
- `docs/microcards_productization_v1_spec.md`
- `docs/premium_expiry_archive_plan_20260509.md`
- `docs/server_refactoring_plan.md`
- `docs/hosted_web_migration/*.md` — приоритет ниже (это исторические документы)
- `tests/RUN_TESTS.md`, `tests/ux_testing_checklist.md`
- `frontend/TestUI/templatesusageplan.md`, `frontend/TestUI/new/THALSR.MD`, `frontend/S1/PlanS1.txt`

---

## 7. Сводный чек-лист готовности к деплою (после всех фаз)

- [ ] Все новые роуты (`/main`, `/complexes`, …) возвращают 200 с правильным HTML.
- [ ] Все старые роуты (`/ui/main`, …) возвращают 301 на новый.
- [ ] `curl -I /` возвращает 302 на `/welcome` (не на `/ui/welcome`).
- [ ] Неавторизованный заход на `/main` редиректит на `/welcome`.
- [ ] `get_resume_target()` для активной сессии возвращает `/session/<id>` (не `/ui/session/<id>`).
- [ ] Auth-fail в Google OAuth ведёт на `/welcome?auth_error=google`.
- [ ] `grep -rn "/ui/" desktop-app/ frontend/ tests/ scripts/` находит только: (a) определения 301-редиректов в `static_routes.py`, (b) тесты, ассертящие эти редиректы, (c) исторические docs.
- [ ] Полный pytest зелёный.
- [ ] Полный `node --test tests/*.test.mjs` зелёный.
- [ ] Браузерный smoke (`run_browser_smoke_release.js`) проходит на стейджинге.
- [ ] Контраст-аудиты не упали на отсутствующих URL.
- [ ] `sitemap.xml` не содержит `/ui/...` (он и сейчас не содержит — но проверить).
- [ ] Опционально: обновить `sitemap.xml` чтобы добавить новые внутренние страницы — **нет**, т.к. они auth-only и не должны быть в индексе.
- [ ] Поисковой консолью (если есть) проверить, что Google не получает 4xx на старые URL — он должен видеть 301 и перенести индекс.

---

## 8. Риски и митигации

| Риск | Вероятность | Митигация |
|---|---|---|
| Пропущенная динамическая генерация URL → битый редирект-цикл (новая страница ведёт на `/ui/...`, тот 301-ит обратно) | средняя | поиск `/ui/` в всём backend в Фазе 1, перепроверка `get_resume_target` и всех `redirect(`/`url_for(` вызовов |
| Auth-гейт не сработает на новых путях → утечка private страниц в открытом виде | высокая, если забыть | в Фазе 1 переписать `_redirect_unauthenticated_hosted_pages` **в первую очередь**, добавить тест проверяющий что `/main` без cookies 302-ит на `/welcome` |
| Кэширование 301 в браузерах пользователей: если выкатить с ошибкой в 301-mapping, потом править — старая привязка прилипает | средняя | в первое время использовать **302** вместо 301, дать неделю на стабилизацию, потом перевести на 301 (или сразу 301 — но с двойной проверкой mapping'а) |
| Относительные `../assets/...` в HTML, которые сейчас идут через `/ui/assets/`, не сломаются — но если страница останется на `/ui/...` во время переходного периода, она должна продолжать получать ассеты | низкая | `/ui/assets/<path>` оставляем как живой роут (без редиректа) до конца Фазы 2 |
| Тесты падают непредсказуемо | высокая | каждая фаза — отдельный PR, тесты обновляются в той же фазе, в которой меняется код |
| Сторонние интеграции (Paddle webhook, Google OAuth redirect URI) указывают на `/ui/...` — может сломать платежи или login | средняя | проверить настройки Paddle и Google Cloud Console **до** деплоя; OAuth redirect_uri у нас на `/api/auth/google/callback`, не на `/ui/...` — OK; Paddle return URLs проверить в `billing_routes.py` |

---

## 9. Стратегия rollback

- Каждая фаза — отдельный PR. Откат фазы = `git revert <commit>`.
- Фазы 2-5 безопасны: они меняют только клиентскую часть, бэкенд остаётся совместимым (т.к. 301 со старого пути работают).
- Фаза 1 — самая критичная. Если что-то пошло не так на проде — откатить commit, передеплоить. Поскольку **старые `/ui/*` пути продолжают работать как канонические до деплоя Фазы 1**, никакой клиент не сломается; единственный риск — короткое окно, когда на проде уже новые URL отдают 200, но клиенты ещё ходят по старым (это OK, 301 их перенаправит) или новые (тоже OK, страница загрузится).

---

## 10. Что НЕ входит в этот план (out of scope)

- Переименование путей по смыслу (`/editor` → `/courses` и т.п.). Если потом захочется — это отдельный план, и он легче, потому что архитектура уже будет «одна страница — один canonical URL».
- Reorganization структуры папок `frontend/` (Editor → editor, MainScreen → main и т.п.) — это другая работа.
- SSR, HTML5 history-API single-page роутинг — нет, оставляем многостраничный server-rendered MPA как сейчас.
- Изменение sitemap.xml для индексации (UI-страницы auth-only, в индекс не идут).

---

## 11. Оценка трудозатрат

| Фаза | Файлов | LoC-правок | Время на разработку |
|---|---:|---:|---|
| 1. Backend + dynamic URLs + auth-гейт | 7-9 | ~200 | 1 рабочий день |
| 2. Frontend (5 под-PR) | 43 | ~330 | 1-2 рабочих дня |
| 3. Тесты (5 под-PR) | 64 | ~280 | 1-2 рабочих дня |
| 4. Scripts/configs | 21 | ~130 | 0.5 дня |
| 5. Документация | 12 | ~60 | 0.5 дня |
| **Итого** | **~150** | **~1000** | **~5 рабочих дней** |

Оценка консервативная, можно идти быстрее, но рекомендую не торопиться между Фазой 1 и Фазой 2 — оставить хотя бы день на проде проверить, что 301 работают как задумано.

---

## 12. Зафиксированные решения (закрытые вопросы)

Эти пункты обсуждались на этапе планирования и зафиксированы:

1. **`/` — поведение корня.** Решено: оставить `/` как редирект на welcome, поведение welcome-страницы не менять. **НО** — статус редиректа меняем с `302` на `301`, чтобы Google корректно индексировал canonical URL (см. §13 ниже). Поведение для авторизованного пользователя не меняется — он попадает на welcome, дальше нажимает «продолжить» и идёт на `/main`.
2. **`/ui/assets/`** — оставляем как живой алиас без 301-редиректа. Причина: в кэшах браузеров и в HTML-файлах разбросано много `../assets/...` ссылок, которые при просмотре старой версии страницы будут резолвиться в `/ui/assets/`. Алиас стоит дёшево и страхует от любых корнер-кейсов с кэшем.
3. **`static_url_path` в Flask** — выпиливаем. **Проверка безопасности уже сделана:**
   - `grep -rn "url_for(\"static\""` по `desktop-app/` — 0 совпадений.
   - `grep -rn "app.static_folder|app.static_url_path"` по всему проекту — 0 совпадений.
   - Все запросы `/ui/editor/<filename>` обслуживаются явным `@static_bp.route("/ui/editor/<path:filename>")` — встроенный Flask static он перекрывает.
   - **Вывод:** удаление `static_folder=str(EDITOR_UI_DIR), static_url_path="/ui/editor"` из `Flask(__name__, ...)` безопасно. В Фазе 1 делаем `Flask(__name__)`.
4. **Google Search Console** — есть конкретные проблемы, которые этот рефакторинг частично решит, а частично требует целевых правок. См. §13 ниже — добавляется как полноценная подзадача в Фазу 1.

---

## 13. SEO / Google Search Console — корректировки (приоритет: высокий)

### 13.1. Текущая диагностика

| Страница | Статус в GSC | Корневая причина |
|---|---|---|
| `http://actra.site/` | «Страница не проиндексирована из-за переадресации» | `/` отдаёт `302` (не `301`) на `/ui/welcome`. Google не индексирует временные редиректы. |
| `https://actra.site/ui/welcome` | «Вариант страницы с тегом canonical» | В `frontend/Welcome/welcome.html:10` стоит `<link rel="canonical" href="https://actra.site/" />` — Google идёт по canonical на `/`, видит там 302 → тупик. |
| `https://actra.site/privacy` | «Обнаружено, но не проиндексировано» | Низкий internal-linking, минимальный текст, страница доступна, но Google откладывает индексацию. После SEO-фиксов главной должно поправиться. |
| `https://actra.site/terms` | Аналогично privacy | Аналогично. |

**Итог:** все четыре проблемы соединены в один узел вокруг главной страницы. Цикл «canonical→/→302→canonical-target» делает их всех «висящими».

### 13.2. Что меняем (входит в Фазу 1, конкретные правки)

1. **`frontend/Welcome/welcome.html`** — поменять canonical:
   ```diff
   - <link rel="canonical" href="https://actra.site/" />
   + <link rel="canonical" href="https://actra.site/welcome" />
   ```
   После миграции welcome-страница сидит на канонической URL `/welcome`, и canonical совпадает с реальным адресом.

2. **`desktop-app/routes/static_routes.py` — функция `serve_root_ui_alias`**:
   ```diff
   - return redirect("/ui/welcome", code=302)
   + return redirect("/welcome", code=301)
   ```
   Меняем 302 → 301 (permanent), цель — на новый canonical URL `/welcome`.

3. **`/ui/welcome`** → 301 на `/welcome` (это часть общей миграции, но важно подчеркнуть: статус именно 301, не 302).

4. **Sitemap.xml** — сейчас в `serve_sitemap_xml` перечислены `""`, `"pricing"`, `"refund"`, `"privacy"`, `"terms"`. Добавить `"welcome"`. После правки:
   ```python
   paths = ("", "welcome", "pricing", "refund", "privacy", "terms")
   ```
   Так Google узнает о welcome как о публичной странице (она и так публичная — auth-гейт её пропускает).

5. **Internal linking** — на welcome-странице (и/или в footer'е публичных страниц) убедиться, что есть ссылки на `/pricing`, `/privacy`, `/terms`. По коду в `_public_shell_page` (`static_routes.py`) — навигация уже включает эти ссылки, всё ок. После того как `/welcome` сам начнёт индексироваться, эти ссылки помогут Google «вытянуть» privacy/terms из «обнаружено, но не проиндексировано».

### 13.3. После деплоя Фазы 1 (действия в GSC)

Не входит в код, но фиксирую как часть плана работ:

- Зайти в Google Search Console.
- Удалить из индекса (или дождаться переиндексации) старые `/ui/*` URL — Google сам их выкинет через 301.
- Submit новой sitemap через GSC: `Sitemaps → /sitemap.xml → Submit`.
- Использовать «URL inspection» tool для проверки: `https://actra.site/` → должен показывать «redirects to /welcome (301)», `https://actra.site/welcome` → «Indexable, canonical: /welcome».
- Запросить индексацию вручную для `/welcome` (Request indexing) и затем для `/pricing`, `/privacy`, `/terms`.

### 13.4. Проверка после Фазы 1 (расширение чек-листа §7)

Добавляется в §7:

- [ ] `curl -I https://actra.site/` возвращает **`301`** (не 302) на `/welcome`.
- [ ] `curl -sL https://actra.site/welcome | grep -i canonical` показывает `<link rel="canonical" href="https://actra.site/welcome" />`.
- [ ] `curl -s https://actra.site/sitemap.xml` содержит `<loc>https://actra.site/welcome</loc>`.
- [ ] В GSC: «URL inspection» для `https://actra.site/welcome` показывает `Indexable`.
