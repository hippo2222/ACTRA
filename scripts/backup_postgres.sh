#!/usr/bin/env bash
# scripts/backup_postgres.sh
#
# Создаёт датированный pg_dump для ACTRA Postgres.
#
# Использование:
#   ./scripts/backup_postgres.sh [OUTPUT_DIR]
#
# Переменные окружения:
#   ACTRA_POSTGRES_DSN        — полный DSN postgresql://user:pass@host:port/db
#                               (читается из .env.hosted если не задан явно)
#   BACKUP_DIR                — куда класть backup (по умолчанию ./backups/postgres)
#   POSTGRES_BACKUP_KEEP      — сколько последних backup хранить (по умолчанию 7)
#
# Пример (cron на сервере, запуск каждую ночь в 03:00):
#   0 3 * * * /opt/actra/scripts/backup_postgres.sh /opt/actra/backups/postgres >> /var/log/actra_backup.log 2>&1

set -euo pipefail

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [backup_postgres] $*"; }
die() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [backup_postgres] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Resolve OUTPUT_DIR
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_DIR="${1:-${BACKUP_DIR:-${REPO_ROOT}/backups/postgres}}"
mkdir -p "${BACKUP_DIR}"

# ---------------------------------------------------------------------------
# Resolve DSN
# ---------------------------------------------------------------------------
if [[ -z "${ACTRA_POSTGRES_DSN:-}" ]]; then
  ENV_FILE="${REPO_ROOT}/.env.hosted"
  if [[ -f "${ENV_FILE}" ]]; then
    ACTRA_POSTGRES_DSN="$(grep -E '^ACTRA_POSTGRES_DSN=' "${ENV_FILE}" | head -1 | cut -d= -f2-)"
  fi
fi
[[ -z "${ACTRA_POSTGRES_DSN:-}" ]] && die "ACTRA_POSTGRES_DSN is not set. Export it or ensure .env.hosted is present."

# ---------------------------------------------------------------------------
# Run pg_dump
# ---------------------------------------------------------------------------
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/actra_postgres_${TIMESTAMP}.dump"

log "Starting postgres backup..."
log "DSN: ${ACTRA_POSTGRES_DSN//:*@/:***@}"
log "Output: ${BACKUP_FILE}"

# Parse DSN to get user and db for docker exec
DSN_NO_PROTO="${ACTRA_POSTGRES_DSN#postgresql://}"
USER_PASS_HOST_DB="${DSN_NO_PROTO%%/*}"
USER_PASS="${USER_PASS_HOST_DB%%@*}"
DB_NAME="${DSN_NO_PROTO#*/}"
DB_NAME="${DB_NAME%%\?*}"
PG_USER="${USER_PASS%%:*}"

docker exec actra-postgres-1 pg_dump \
  -U "${PG_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --no-acl \
  --no-owner \
  > "${BACKUP_FILE}"

BACKUP_SIZE="$(du -sh "${BACKUP_FILE}" | cut -f1)"
log "Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# ---------------------------------------------------------------------------
# Rotate old backups (keep last N)
# ---------------------------------------------------------------------------
KEEP_COUNT="${POSTGRES_BACKUP_KEEP:-7}"
BACKUP_COUNT="$(ls -1 "${BACKUP_DIR}"/actra_postgres_*.dump 2>/dev/null | wc -l)"
if (( BACKUP_COUNT > KEEP_COUNT )); then
  log "Rotating: keeping last ${KEEP_COUNT} backups (found ${BACKUP_COUNT})..."
  ls -1t "${BACKUP_DIR}"/actra_postgres_*.dump | tail -n "+$((KEEP_COUNT + 1))" | xargs rm -f
  REMAINING="$(ls -1 "${BACKUP_DIR}"/actra_postgres_*.dump 2>/dev/null | wc -l)"
  log "Rotation done. ${REMAINING} backups remaining."
fi

log "Backup complete."
echo "${BACKUP_FILE}"
