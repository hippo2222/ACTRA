#!/usr/bin/env bash
# scripts/backup_minio.sh
#
# Создаёт backup MinIO (S3-compatible) bucket через mc mirror.
#
# Использование:
#   ./scripts/backup_minio.sh [DEST_DIR]
#
# Переменные окружения (читаются из .env.hosted если не заданы):
#   ACTRA_S3_ENDPOINT    — endpoint MinIO (напр. http://minio:9000 или http://localhost:9000)
#   ACTRA_S3_BUCKET      — имя bucket (напр. actra)
#   ACTRA_S3_ACCESS_KEY  — access key
#   ACTRA_S3_SECRET_KEY  — secret key
#   BACKUP_DIR           — куда класть backup (по умолчанию ./backups/minio)
#
# Требования:
#   - mc (MinIO Client) установлен и в PATH.
#     Установка: https://min.io/docs/minio/linux/reference/minio-mc.html
#     Docker: docker run --rm --network=... minio/mc ...
#
# Пример:
#   ./scripts/backup_minio.sh /mnt/backups/minio

set -euo pipefail

log() { echo "[backup_minio] $*"; }
die() { echo "[backup_minio] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Resolve args
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEST_DIR="${1:-${BACKUP_DIR:-${REPO_ROOT}/backups/minio}}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SNAPSHOT_DIR="${DEST_DIR}/actra_minio_${TIMESTAMP}"
mkdir -p "${SNAPSHOT_DIR}"

# ---------------------------------------------------------------------------
# Load env
# ---------------------------------------------------------------------------
ENV_FILE="${REPO_ROOT}/.env.hosted"
_load_env_var() {
  local VAR="$1"
  if [[ -z "${!VAR:-}" ]] && [[ -f "${ENV_FILE}" ]]; then
    local VAL
    VAL="$(grep -E "^${VAR}=" "${ENV_FILE}" | head -1 | cut -d= -f2-)"
    export "${VAR}=${VAL}"
  fi
}

_load_env_var ACTRA_S3_ENDPOINT
_load_env_var ACTRA_S3_BUCKET
_load_env_var ACTRA_S3_ACCESS_KEY
_load_env_var ACTRA_S3_SECRET_KEY

[[ -z "${ACTRA_S3_ENDPOINT:-}" ]]   && die "ACTRA_S3_ENDPOINT is not set."
[[ -z "${ACTRA_S3_BUCKET:-}" ]]     && die "ACTRA_S3_BUCKET is not set."
[[ -z "${ACTRA_S3_ACCESS_KEY:-}" ]] && die "ACTRA_S3_ACCESS_KEY is not set."
[[ -z "${ACTRA_S3_SECRET_KEY:-}" ]] && die "ACTRA_S3_SECRET_KEY is not set."

# ---------------------------------------------------------------------------
# Mirror bucket → local snapshot dir via Docker minio/mc
# ---------------------------------------------------------------------------
log "Starting mirror via Docker..."

# If endpoint is localhost/127.0.0.1, we replace it with minio inside the docker network
S3_ENDPOINT_DOCKER="${ACTRA_S3_ENDPOINT}"
S3_ENDPOINT_DOCKER="${S3_ENDPOINT_DOCKER/localhost/minio}"
S3_ENDPOINT_DOCKER="${S3_ENDPOINT_DOCKER/127.0.0.1/minio}"

docker run --rm --network=actra_default \
  -v "${SNAPSHOT_DIR}:/backups" \
  --entrypoint "" \
  minio/mc sh -c "mc alias set target ${S3_ENDPOINT_DOCKER} ${ACTRA_S3_ACCESS_KEY} ${ACTRA_S3_SECRET_KEY} && mc mirror target/${ACTRA_S3_BUCKET} /backups --preserve"

SNAPSHOT_SIZE="$(du -sh "${SNAPSHOT_DIR}" | cut -f1)"
log "Done. Size: ${SNAPSHOT_SIZE}"
log "Snapshot: ${SNAPSHOT_DIR}"

# ---------------------------------------------------------------------------
# Rotate old snapshots (keep last 5)
# ---------------------------------------------------------------------------
KEEP_COUNT="${MINIO_BACKUP_KEEP:-5}"
SNAP_COUNT="$(ls -1d "${DEST_DIR}"/actra_minio_* 2>/dev/null | wc -l)"
if (( SNAP_COUNT > KEEP_COUNT )); then
  log "Rotating old snapshots (keeping last ${KEEP_COUNT})..."
  ls -1dt "${DEST_DIR}"/actra_minio_* | tail -n "+$((KEEP_COUNT + 1))" | xargs rm -rf
  log "Rotation done."
fi

echo "${SNAPSHOT_DIR}"
