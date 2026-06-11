# Миграция editor-поверхности микрокарточек V1 → V2 (бывшая фаза 5.2)

Статус: ПЛАН (2026-06-11). Контекст: docs/microcards_redesign_plan.md (фазы
0–4 и 5.1 выполнены). V1 жив только как editor-поверхность; пользовательский
режим целиком на V2 (storage 5.1: persistence/microcards_v2_storage.py).

## Факты разведки (проверено по коду)

- Editor-фронт: frontend/Editor/import_manager.js (~6200–7300) использует
  /api/editor/microcards/*: decks list/get, decks/from-analysis,
  append-from-analysis, queue, review/submit, create-manual, rename, archive,
  delete, cards POST/PUT/DELETE (~15 вызовов). Гейтится фиче-флагами
  microcards_mode / microcards_pair_match (M14).
- from-analysis: клиент шлёт {ai_run_id, selector} — кандидатов достаёт
  СЕРВЕР из сохранённого AI-анализа (h["ai_run_build_reopen_analysis_response"]
  + sanitize) и строит колоду через MicrocardsService.create_deck_from_analysis.
- Схема V1-карточки: {card_type: fact_recall|pair_match,
  front: {text, payload}, back: {text, payload}, status: active|archived|suspended}.
  fact_recall тривиально маппится в V2 (front/back текст). pair_match —
  структурные payload'ы (left/right items, pairs, explanations) и своя
  скоринг-функция score_pair_match_response; В V2 РАНТАЙМА pair_match НЕТ.
- Архив: V1 archive_deck ставит meta.archived (+archived_at), архивные
  скрываются из выдач. В V2 понятия архива нет.
- Календарный live-хук: record_microcards_review вызывается ТОЛЬКО из
  V1 review/submit (server.py _apply_microcards_review_live_integration с
  дедуп-ключом и state-файлом). V2-ответы доходят до календаря только через
  бэкфилл M4 (после 5.1 он читает v2-события корректно).
- Смоук-гейт: npm run smoke:microcards:hosted = pytest
  tests/test_microcards_hosted_route_contracts.py,
  tests/test_hosted_microcards_service.py,
  tests/test_hosted_microcards_analytics_service.py — всё V1-контракты.
- V1-колоды на проде могли создаваться через редактор → данные надо мигрировать.

## Продуктовые решения (РЕКОМЕНДАЦИИ — подтвердить до старта)

D1. **Мини-прохождение в редакторе** (queue + review/submit): НЕ переносить.
    Вместо него deep-link «Открыть в Микрокарточках» на колоду — у режима
    теперь есть Просмотр/Повторение/Прохождение, дублировать мини-плеер в
    редакторе незачем. (Альтернатива: адаптер на v2 session API — дороже и
    плодит второй UX прохождения.)
D2. **pair_match**: при миграции конвертировать каждую пару в обычную
    Q/A-карточку (term → definition); синтетические pair_match-карточки,
    дублирующие fact_recall того же чанка, пропускать по контент-дедупу.
    (Альтернатива «реализовать pair_match в V2» — отдельная большая фича из
    бэклога аудита, не блокирует миграцию.)
D3. **Архивные V1-колоды**: переносить с тегом `архив` (контент не теряем,
    из выдач не прячем — V2-библиотека фильтруется тегами).
D4. **V1 review-прогресс** (свои интервалы/стейты): НЕ переносить —
    планировщики несовместимы (V1 ручные интервалы vs FSRS); карточки
    приезжают «новыми». Контент важнее расписания.
D5. **M14-телеметрия/rollout**: удалить целиком; продуктовую телеметрию V2
    (если понадобится) делать отдельной задачей по нужным событиям.

## Этапы

Решения D1–D5 ПОДТВЕРЖДЕНЫ владельцем 2026-06-11.

M1 — ✅ ВЫПОЛНЕН 2026-06-11. V2-эндпоинты для редактора:
  - POST /api/v2/microcards/decks/from-analysis {ai_run_id, selector, name}:
    серверная выборка кандидатов из ai_run (переиспользовать существующие
    server.py-хелперы через ctx), маппинг fact_recall → front/back/hint,
    pair_match → по D2; создание через MicrocardsServiceV2 (+dedup).
  - POST /api/v2/microcards/decks/<id>/append-from-analysis — тот же маппинг
    через _create_from_parsed(dedup=True).
  - Всё остальное уже есть в V2: list/get (decks), PATCH (rename/direction),
    DELETE, cards CRUD, bulk-delete/restore.

  Реализация: services/microcards_analysis_import.py (analysis_to_rows с
  селектором V1-семантики, D2-конвертация pair→Q/A, фолбэки unit/chunk,
  синтетические пары по future_capabilities; deck_name_for_analysis в
  V1-стиле); роуты POST /api/v2/microcards/decks/from-analysis и
  /decks/<id>/append-from-analysis (ai_run-хелперы через
  get_extra("microcards_helpers"), дедуп общим _create_from_parsed).

M2 — ✅ ВЫПОЛНЕН 2026-06-11. Календарный live-хук в V2:
  Реализация: submit_answer возвращает review_event (только для
  запланированных повторений — first attempt/override, НЕ для пересдач
  мастери-цикла); v2 answer-роут вызывает существующий оркестратор
  _orchestrate_microcards_review_post_submit (helpers) — он сам ведёт
  дедуп-state и статистику; ошибки календаря не ломают ревью.
  Бэкфилл остаётся recovery-инструментом.

M3 — ✅ ВЫПОЛНЕН 2026-06-11. Editor-фронтенд (import_manager.js):
  Реализация: список колод → /api/v2 (декоратор приводит V2-сводки к
  привычным полям stats/meta); from-analysis/append → M1-роуты; мини-плеер
  (queue + review/submit + pair_match UI, ~8 методов) удалён —
  openMicrocardsDeckQueue() теперь deep-link /microcards?deck=<id>
  (query-параметр уже поддерживался режимом); панель «Сессия повторения»
  заменена пояснением. Manual editor: GET/POST/DELETE колод и карточек,
  PATCH-rename, reorder → /api/v2; archive удалён (вместо него кнопка
  «Открыть в Микрокарточках»); pair_match-тип убран из формы (D2), сейв
  pair-карточек блокируется с пояснением. Text-import: предпросмотр →
  новый deckless POST /api/v2/microcards/import/analyze (адаптер ответа в
  старую форму items/summary), исполнение → создание колоды + /import/auto
  тем же сырым текстом.

  (Исходный план M3:)
  - list/get/create-manual/rename/delete/cards → /api/v2/microcards/*
    (внимание: у v2 другие поля ответа — items/deck, name через PATCH);
  - from-analysis/append → новые M1-роуты;
  - queue/review-блок UI заменить кнопкой «Открыть в Микрокарточках»
    (D1) — удалить мини-плеер, score_pair_match-обвязку и flag-гейты
    microcards_mode/pair_match из этого пути.

M4 — ✅ ВЫПОЛНЕН 2026-06-11. Миграция данных V1 → V2:
  Реализация: tools/migrate_microcards_v1_decks_to_v2.py — источники: файлы
  (V1 и V2 делят одну папку data/microcards/decks; V1 распознаётся по
  meta-конверту/card_type) и hosted-таблица actra_hosted_microcards_decks;
  pair_match → Q/A на каждую пару, дедуп по front; архив → тег «архив» (+тег
  «v1»); владелец из meta.created_by_user_id (без владельца — пропуск с
  отчётом); идемпотентность через migrated_from_v1; оригиналы не трогаются;
  --dry-run. Прогнать на проде ДО деплоя M5.

  (Исходный план M4:)
  - tools/migrate_microcards_v1_decks_to_v2.py: источники — файловые
    per-user колоды (data/users/<uid>/microcards/decks/*.json, если есть) И
    hosted-репозиторий actra_hosted_microcards_decks; маппинг по D2/D3/D4;
    created_by_user_id = владелец; дедуп по контент-ключу против существующих
    v2-колод пользователя; идемпотентно, --dry-run.
  - Прогон на проде ДО M5.

M5 — ✅ ВЫПОЛНЕН 2026-06-11 (в репозитории; прод-деплой после прогона M4!).
  Реализация: theory-rollout роуты → routes/theory_rollout_routes.py;
  удалены routes/microcards_routes.py, microcards_service.py,
  hosted_microcards_service.py, hosted_microcards_analytics_service.py,
  scripts/microcards_m14_rollout_smoke.py; server.py: M14-блок (~350 строк),
  _microcards_service, hosted-ветка аналитики, импорты, 7 записей helpers;
  finish-line контракт = PostgresMicrocardsStorage; смоук
  smoke:microcards:hosted → v2-сьюты; browser_smoke_helpers и
  theory_p13_rollout_smoke переведены на /api/v2 (телеметрия
  microcards_deck_created_from_analysis теперь эмитится v2-роутом; v2
  from-analysis получил ai_mode-плейсхолдер-гейт — контракт сохранён).
  V1-репозитории persistence/hosted_microcards_*.py и чистка их таблиц при
  удалении аккаунта ОСТАВЛЕНЫ до отдельной drop-миграции таблиц.

  (Исходный план M5:)
  - theory-rollout роуты (/api/editor/theory/rollout/*) → новый
    routes/theory_rollout_routes.py (они про теорию, не про микрокарточки);
  - удалить: routes/microcards_routes.py (v1-часть), services/microcards_service.py,
    services/hosted_microcards_service.py, services/hosted_microcards_analytics_service.py,
    persistence/hosted_microcards_repository.py, hosted_microcards_review_repository.py;
  - server.py: M14-блок (_MICROCARDS_PROD_*, rollout stages/caps/telemetry,
    _microcards_service, _microcards_analytics_service → базовый M5-сервис,
    _microcards_review_live_integration_* — переносится/упрощается в M2),
    импорты, регистрация microcards_bp;
  - users_routes: удалить очистку v1-таблиц ПОСЛЕ дропа таблиц (отдельной
    миграцией: DROP actra_hosted_microcards_decks / _user_documents — только
    когда M4 подтверждён);
  - смоук-гейт smoke:microcards:hosted → новые контракты (v2 storage +
    v2 роуты); обновить server.py finish-line контракт.

M6 — ✅ ВЫПОЛНЕН 2026-06-11: удалены v1-сьюты (test_microcards_service.py,
  test_microcards_api.py, test_microcards_hosted_route_contracts.py,
  test_hosted_microcards_service.py, test_hosted_microcards_analytics_service.py,
  test_microcards_pair_match.py, test_microcards_service_crud.py,
  test_microcard_import_integration.py); добавлены тесты M4-миграции;
  test_ai_placeholder_contract перенацелен на v2-роуты. 109 тестов зелёные.

  (Исходный план M6:)
  - удалить v1-сьюты (desktop-app/tests/unit/test_microcards_service.py,
    tests/test_microcards_hosted_route_contracts.py,
    tests/test_hosted_microcards_service.py,
    tests/test_hosted_microcards_analytics_service.py и связанные);
  - новые: from-analysis→v2 (fact_recall + pair_match-конвертация + dedup),
    миграционный скрипт (v1-схема → v2, архив-тег, дедуп), календарный хук
    (дедуп-ключ, only-first-attempt);
  - полный прогон + e2e conftest правки.

## Порядок и риски

- Деплой-каденс: M1+M2 (бэк, совместимо) → M3 (фронт) → M4 (миграция данных,
  прод) → проверка → M5+M6 (выпил). M5 нельзя начинать до подтверждения M4.
- Риск pair_match-конвертации: терминологические пары дублируют fact_recall
  карточки того же чанка — обязателен контент-дедуп (D2).
- Риск тихих потребителей V1: перед M5 — grep по '/api/microcards' и
  '/api/editor/microcards' во ВСЁМ фронте и скриптах (e2e, smoke, paddle).
- Календарь: M2 менять semantics активности (live вместо backfill-only) —
  проверить, что дедуп не задвоит дни, уже учтённые бэкфиллом.
