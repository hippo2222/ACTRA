# Production Logging Policy

This project uses structured Python logging (no `print()` in HTTP/API handlers).

## Levels

- `INFO`
  - Application start/stop milestones.
  - One-time subsystem registration events.
  - Business-significant actions (create/update/delete operations).
- `WARNING`
  - Slow requests (`> 1.0s`).
  - Recoverable runtime degradations (fallback paths, missing optional resources).
- `ERROR` / `EXCEPTION`
  - Failed operations and unhandled exceptions.
- `DEBUG`
  - Route map dumps.
  - Per-request trace logs (`before_request`/`after_request` internals).
  - Debug-only diagnostics.

## Runtime Rule

- Debug request tracing is enabled only when `FLASK_DEBUG` is enabled.
- In production mode, request-level logs are not emitted at `INFO` for every request.
