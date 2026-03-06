# Final Release Audit — 2026-03-04

## Scope

Этот аудит собран по результатам большого статического предрелизного прохода без ручного визуального smoke-клика по экранам.

Что было сделано:

- кодовый аудит критических пользовательских контуров;
- точечные исправления backend и frontend;
- усиление state-consistency между экранами;
- зачистка XSS / markup-break / unsafe inline handler хвостов;
- выравнивание error feedback и retry flow;
- расширение регрессионного покрытия под найденные баги.

Это не заменяет живой ручной UX-проход, но хорошо отвечает на вопрос:
ломаются ли ключевые механики по коду, и не врёт ли интерфейс о своём состоянии.

## What Was Covered

Проверены и/или доработаны:

- Welcome / onboarding / profile selection
- Main / quick access / profile modal / statistics preview
- Complexes list
- Complexes builder (`create.html`) и autosave
- S1 / S2 / S3
- Calendar
- Statistics
- Microcards
- Settings
- Editor dashboard / base editor / import manager
- task-specific editor'ы (`draw`, `click`, `sequence`, `open_answer`, `test`)
- shared frontend assets (`NotificationUI`, `ConnectionMonitor`, `ThemeSwitcherUI`, `SharedProfileModal`)
- S1 shared UI (`ui-helpers`, `task-renderer`, `success-effects`)
- S1 task-specific web renderers (`OpenAnswerUI`, `SequenceUI`, `DrawUI`)
- S1 support layer (`draft-storage`, `session-controls`, `api-client`, `main`, `routes`)

## Critical Defects Fixed

Ниже только те вещи, которые реально могли сломать релизный контур или доверие пользователя.

### Authentication / Access

- Исправлен реальный auth-bypass при входе в профиль: неверный пароль больше не считался успешным.
- Исправлена логика password prompt на главной: проверка теперь идёт против выбранного профиля, а не залипшего state.
- Welcome больше не уводит пользователя в `Main` с битым profile-state в ряде стартовых сценариев.

### State Consistency / Lost Progress

- Исправлен `GET /api/statistics/overall` для пустого `user_id`, чтобы first-run не падал `500`.
- Усилен `resume` в `S1`, чтобы он не зависел от одного глобального alias.
- `S1` больше не держит stale result fragments между задачами и результатами.
- `S1 next task` больше не затирает текущий экран скелетоном при неуспешной загрузке следующего задания.
- `DraftStorage` теперь стабилен через reload одной вкладки и корректно чистит legacy + tab-specific черновики.
- `OpenAnswerUI` корректно синхронизирует textarea, кнопку проверки и счётчик после restore draft.
- `Settings`, `Statistics`, `Calendar`, `Microcards` и `Main` больше не оставляют stale данные на экране после частичных и полных ошибок загрузки.
- `Calendar` time limit больше не врёт о сохранении при неуспешном update.
- `create.html` и editor autosave теперь честно показывают save failure вместо тихого провала.

### Navigation / Flow Integrity

- `S2` и `S1` теперь корректно отменяют сессию перед выходом, а не просто “уходят со страницы”.
- `S3` честно показывает ошибку при отсутствии `sessionId` или провале загрузки результатов.
- `Main.loadInitialTask()` больше не падает внутри собственного `catch` из-за отсутствующего `showRetryOption`.
- `Session API client` теперь устойчив к не-JSON ответам сервера и не маскирует HTTP-ошибки `SyntaxError`-ом.

### Unsafe Rendering / Injection

- Закрыт большой класс XSS / DOM-break рисков на:
  - Welcome
  - Main
  - Complexes
  - S2
  - S3
  - Calendar
  - Microcards
  - import manager
  - editor toasts / modals
  - DrawUI / ClickUI hints
  - TaskRenderer fallback
- Исправлены unsafe inline-handler аргументы в `import_manager` и других шаблонных рендерах.

### UX Feedback / Honesty

- Убраны десятки веток, где ошибка уходила только в `console.error`, без видимого сигнала пользователю.
- `NotificationUI.confirm()` перестал копить `keydown`-listener и оставлять залипшие побочки.
- `SharedProfileModal` теперь не зависит от наличия `NotificationUI` для базового feedback.
- `Main`, `Statistics`, `Calendar`, `Complexes` и `Settings` теперь заметно реже создают ложное ощущение “как будто сохранилось / загрузилось”.

### Memory / Event Leaks

- `SequenceUI` cleanup теперь снимает `resize` listener.
- В shared UI и modal-слоях убраны несколько накопительных listener-хвостов.

## Test Status

На момент финального среза:

- `npm test`: `25` test files, `96 passed`, `2 skipped`
- `npm run lint:frontend`: green

Дополнительно в процессе прохода ранее уже гонялись:

- опорный backend/frontend smoke-набор;
- интеграционные сценарии по phase1/phase2/phase6;
- выборочные backend unit/smoke тесты по профилям, статистике, editor API, session API, microcards API.

## Residual Risks

Это уже не выглядит как блокеры, но важно честно зафиксировать остаток.

### No Full Manual UX Pass

Живого сквозного ручного кликанья по всем экранам не было.
Значит остаются риски:

- чисто визуальных регрессий;
- layout/spacing проблем;
- фокус-менеджмента;
- редких межбраузерных нюансов;
- мест, где код формально корректен, но UX всё равно раздражает.

### Secondary Frontend Noise

- В коде ещё могут оставаться вторичные `console.warn/error` ветки, которые уже не ломают поток, но засоряют диагностику.
- В тестах остаётся harmless stdout `[DrawUI] build ...`; это не блокер, но шум.

### Product Risk, Not Just Technical Risk

Технически основной контур сейчас заметно крепче.
Но продуктовый вопрос остаётся отдельным:

- насколько быстро новый пользователь понимает, что делать;
- насколько сильна первая “ценность” без подсказки разработчика;
- не слишком ли сложен для first-run редакторский/комбинаторный слой.

Это уже хуже ловится статическим аудитом.

## Release Verdict

### Technical Verdict

`CONDITIONAL GO`

По коду проект не выглядит мёртвым и не выглядит сломанным в ключевом ядре.
Критические релизные хвосты по auth, state loss, unsafe rendering, silent failures и S1 flow в большой степени вычищены.

Если смотреть именно на техническую жизнеспособность:

- проект живой;
- основные механики присутствуют;
- ключевой контур больше не выглядит хрупким “на соплях”;
- релиз технически можно выпускать, если не ждать идеала.

### What Would Make It `NO-GO`

Релиз стоит тормозить только если перед выпуском всплывёт хотя бы один из этих пунктов:

- ручной smoke покажет data loss в `S1` / editor / complex builder;
- найдётся новый auth/profile selection обход;
- окажется, что first-run всё ещё упирается в битый onboarding/profile-state;
- прогресс между session / calendar / statistics / microcards реально расходится в живом сценарии.

Сейчас по коду таких блокеров не видно.

## Bottom Line

Это не “мертворождённая хуета”.
Это уже реальный продукт с рабочим ядром, который был бы легко убит десятком nasty багов в последних 10%, если бы их не добили.

После этого прохода состояние выглядит так:

- не идеально;
- не отполировано до блеска;
- но уже достаточно цельно и технически вменяемо, чтобы жить.

Если нужен один короткий ответ:

Проект имеет жизненные силы, основной функционал по коду выглядит рабочим, и сейчас это скорее `release candidate`, чем разваливающийся прототип.
