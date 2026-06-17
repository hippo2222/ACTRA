#!/usr/bin/env bash
# Daily postgres backup script.
# Runs via cron: 0 3 * * * /opt/actra/scripts/backup_postgres.sh

set -euo pipefail

BACKUP_DIR="/opt/actra/backups/postgres"
KEEP_DAYS=7
CONTAINER="actra-postgres-1"
DB="actra"
USER="actra"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="$BACKUP_DIR/actra_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting postgres backup..."

docker exec "$CONTAINER" pg_dump -U "$USER" "$DB" | gzip > "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[$(date)] Backup created: $DUMP_FILE ($SIZE)"

# Remove old backups
find "$BACKUP_DIR" -name "actra_*.sql.gz" -mtime +$KEEP_DAYS -delete
REMAINING=$(find "$BACKUP_DIR" -name "actra_*.sql.gz" | wc -l)
echo "[$(date)] Backups older than $KEEP_DAYS days removed. $REMAINING backups remaining."

echo "[$(date)] Backup complete."
