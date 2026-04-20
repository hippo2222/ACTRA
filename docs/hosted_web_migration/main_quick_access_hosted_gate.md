# Main + Quick Access Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует официальный strict hosted gate для surface `main + quick access`.

## Strict Hosted Gate

```bash
npm run smoke:main-quick-access:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` проходит без failed/error;
- набор подтверждает hosted truth для `main` и `quick access`, а не legacy file-backed behavior.

## Состав Gate

- `tests/test_main_screen_http.py`
- `tests/test_quick_access_hosted_ui_state.py`
- `tests/test_quick_access_hosted_gate.py`

## Что именно подтверждает strict gate

- hosted `main` UI требует auth session и не открывается как legacy profile surface;
- hosted `quick access` читает pinned/recent/settings через `user.settings["web_ui_state"]`, а не через `data/users/<user>/ui_state.json`;
- hosted `quick access` собирает paused-session metadata через `HostedSessionRepository`-style contract и объединяет ее со statistics/calendar reads;
- hosted `pin`, `unpin`, `remove`, `recent` и `ui/settings` сохраняют состояние в hosted profile settings;
- blocked hosted reads по identity/session storage превращаются в явный degraded payload, а не в silent fallback.

## Что не входит в этот gate

- широкий browser smoke вокруг всего `Main` UX;
- production-like infra verification с реальным Postgres/S3 stack;
- соседние contours `statistics`, `calendar` и launch-layer beyond the quick-access contract.

## Текущий статус

С `2026-04-19` `npm run smoke:main-quick-access:hosted` считается официальным strict hosted gate
для surface `main + quick access`.

Локальная верификация strict gate зафиксирована прогоном `npm run smoke:main-quick-access:hosted`
от `2026-04-19`.

На текущий момент это означает:

- у `main + quick access` есть один канонический запуск для release-check;
- hosted source of truth по `main -> quick access -> pin/unpin/remove/settings` проверяется повторяемо одной командой;
- legacy `ui_state.json` остается только в `legacy_local` runtime и больше не считается hosted truth.
