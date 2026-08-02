#!/usr/bin/env bash
set -Eeuo pipefail
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${PGDATABASE:?PGDATABASE is required}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
case "$RETENTION_DAYS" in ''|*[!0-9]*) echo 'RETENTION_DAYS must be an integer' >&2; exit 2;; esac
mkdir -p -- "$BACKUP_DIR"
umask 077
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIR/${PGDATABASE}_${timestamp}.dump"
temporary="${output}.partial"
trap 'rm -f -- "$temporary"' EXIT
pg_dump --format=custom --no-owner --no-privileges --file="$temporary" "$PGDATABASE"
pg_restore --list "$temporary" >/dev/null
sha256sum "$temporary" > "${temporary}.sha256"
mv -- "$temporary" "$output"
sed -i "s|$(basename "$temporary")|$(basename "$output")|" "${temporary}.sha256"
mv -- "${temporary}.sha256" "${output}.sha256"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "${PGDATABASE}_*.dump" -o -name "${PGDATABASE}_*.dump.sha256" \) -mtime "+$RETENTION_DAYS" -delete
printf 'backup=%s\n' "$output"