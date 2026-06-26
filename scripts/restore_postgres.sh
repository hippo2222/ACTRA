#!/usr/bin/env bash
# scripts/restore_postgres.sh
#
# Восстанавливает Postgres из pg_dump-файла (формат custom).
#
# Использование:
#   ./scripts/restore_postgres.sh <DUMP_FILE> [DSN]
#
# Примеры:
#   ./scripts/restore_postgres.sh backups/postgres/actra_postgres_20260625_030000.dump
#   ./scripts/restore_postgres.sh /mnt/backups/actra_postgres_20260625_030000.dump \
#     "postgresql://actra:pass@localhost:5432/actra"
#
# Переменные окружения:
#   ACTRA_POSTGRES_DSN — DSN (читается из .env.hosted если не задан явно)
#
# ВНИМАНИЕ: restore удаляет существующие таблицы перед восстановлением.
#            Запускать только на тестовом окружении или при подтверждённом DR-сценарии.

set -euo pipefail

log() { echo "[restore_postgres] $*"; }
die() { echo "[restore_postgres] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
DUMP_FILE="${1:-}"
[[ -z "${DUMP_FILE}" ]] && die "Usage: $0 <DUMP_FILE> [DSN]"
[[ -f "${DUMP_FILE}" ]] || die "Dump file not found: ${DUMP_FILE}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Resolve DSN
# ---------------------------------------------------------------------------
ACTRA_POSTGRES_DSN="${2:-${ACTRA_POSTGRES_DSN:-}}"
if [[ -z "${ACTRA_POSTGRES_DSN:-}" ]]; then
  ENV_FILE="${REPO_ROOT}/.env.hosted"
  if [[ -f "${ENV_FILE}" ]]; then
    ACTRA_POSTGRES_DSN="$(grep -E '^ACTRA_POSTGRES_DSN=' "${ENV_FILE}" | head -1 | cut -d= -f2-)"
  fi
fi
[[ -z "${ACTRA_POSTGRES_DSN:-}" ]] && die "ACTRA_POSTGRES_DSN is not set."

# ---------------------------------------------------------------------------
# Confirm
# ---------------------------------------------------------------------------
log "Dump file : ${DUMP_FILE}"
log "Target DSN: ${ACTRA_POSTGRES_DSN//:*@/:***@}"
log ""
log "WARNING: This will DROP all existing tables and restore from the dump."
read -r -p "Type 'yes' to continue: " CONFIRM
[[ "${CONFIRM}" == "yes" ]] || die "Aborted."

# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------
# Parse DSN to get user and db for docker exec
DSN_NO_PROTO="${ACTRA_POSTGRES_DSN#postgresql://}"
USER_PASS_HOST_DB="${DSN_NO_PROTO%%/*}"
USER_PASS="${USER_PASS_HOST_DB%%@*}"
DB_NAME="${DSN_NO_PROTO#*/}"
DB_NAME="${DB_NAME%%\?*}"
PG_USER="${USER_PASS%%:*}"

docker exec -i actra-postgres-1 pg_restore \
  -U "${PG_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --no-acl \
  --no-owner \
  --clean \
  --if-exists \
  < "${DUMP_FILE}"

log "Restore complete."
