# Complex Passage Definition Of Done

Дата обновления: `2026-04-17`

## Назначение

Этот checklist определяет, когда workstream "прохождение комплексов в hosted web" можно считать действительно готовым.

Он опирается на:

- [complex_passage_spec.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/complex_passage_spec.md)
- [complex_passage_implementation_plan.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/complex_passage_implementation_plan.md)

## Документы и терминология

- [ ] Есть один canonical spec по lifecycle, persisted fields и progression semantics.
- [ ] Команда использует одинаковые термины: `active`, `paused`, `iteration_results`, `final_results`, `completed`, `cancelled`, `resume_target`, `ui_state`.
- [ ] Новые тесты и runtime-изменения ссылаются на этот контракт, а не на устные договоренности.
- [ ] Если появляется новая развилка в поведении, она сначала фиксируется в spec/checklist, а потом уходит в код.

## Session lifecycle

- [ ] `start_session` создает рабочую session и открывает первый task.
- [ ] Неуспешный старт не создает silent-empty-session.
- [ ] `pause` переводит session в paused-state и сохраняет корректный `resume_target`.
- [ ] `resume` возвращает пользователя в тот же logical screen.
- [ ] `cancel` завершает текущий flow и очищает активный runtime-контекст.
- [ ] Простое чтение `GET /task` не снимает паузу автоматически.
- [ ] Cross-user доступ к чужой session невозможен.

## S1: task runtime

- [ ] `GET current task` стабильно отдает корректный task payload.
- [ ] Все поддерживаемые task families рендерятся в S1.
- [ ] `submit/check` работает для поддерживаемых task families.
- [ ] `next` невозможен без checked state.
- [ ] Draft input переживает reload.
- [ ] Checked state переживает reload.
- [ ] Same-tab reload не ломает flow ложной паузой.
- [ ] `ui_state` сохраняет и восстанавливает screen, task slot, draft, view state и checked state.

## Retry / skip / difficulty

- [ ] Retry-копии корректно помечаются как retry.
- [ ] Retry flow не ломает текущий queue index и iteration semantics.
- [ ] Partial retry test tasks не теряет список заваленных subtests.
- [ ] Skip переносит task в конец текущей iteration, а не удаляет его.
- [ ] Retry task нельзя пропустить.
- [ ] Последний remaining task iteration нельзя пропустить.
- [ ] Skip limit на task соблюдается.
- [ ] Difficulty progression согласована между S1, S2 и S3.

## S2: iteration results

- [ ] После завершения iteration UI переходит на S2 с корректным payload.
- [ ] S2 reload-safe.
- [ ] На S2 видны базовые legacy-совместимые метрики, на которые уже опираются тесты и аудит:
  - `total tasks`
  - `failed tasks`
  - `difficulty`
  - trigger/problem task list
- [ ] `resume_target` может вернуть пользователя на S2, если pause произошел на iteration results.

## S3: final results

- [ ] После последней iteration UI переходит на S3.
- [ ] S3 reload-safe.
- [ ] Итоговый payload согласован с session summary.
- [ ] `resume_target` может вернуть пользователя на S3, если pause произошел на final results.

## Persistence contract

- [ ] Session contract не зависит только от process-local памяти.
- [ ] Есть repository-совместимый минимальный набор persisted fields из canonical spec.
- [ ] Перезапуск процесса не теряет paused/active session state.
- [ ] Перезапуск процесса не ломает reload/resume semantics.

## Hosted runtime / isolation

- [ ] Hosted runtime не использует silent fallback к `default_user` там, где нужен явный user context.
- [ ] Session ownership проверяется на чтении и записи.
- [ ] Поведение не держится на неявном single-process предположении.
- [ ] Concurrency fixes не меняют внешний lifecycle contract без обновления spec.

## Results propagation

- [ ] Завершение комплекса записывает итог в statistics.
- [ ] Завершение комплекса записывает нужные данные в calendar/progress контур.
- [ ] Финальная запись идемпотентна или явно защищена от дублирования.

## Test gate

- [ ] Есть unit coverage для ключевых lifecycle/iteration/retry правил.
- [ ] Есть integration coverage для SessionAPI HTTP-contract.
- [ ] Есть e2e coverage для S1/S2/S3 user flow.
- [ ] Есть отдельный hosted gate для полного complex passage flow.
- [ ] Устаревшие тесты не спорят с реальным UI-contract; если UI-contract изменился, тесты обновлены синхронно.

## Release gate

- [ ] Нет известных красных тестов в целевом complex passage контуре.
- [ ] Документация, тесты и runtime описывают один и тот же lifecycle.
- [ ] Команда может использовать этот checklist как release gate без устных пояснений от автора изменений.
