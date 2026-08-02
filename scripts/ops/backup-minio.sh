#!/usr/bin/env bash
set -Eeuo pipefail
: "${MINIO_ALIAS:?MINIO_ALIAS is required}"
: "${MINIO_BACKUP_DIR:?MINIO_BACKUP_DIR is required}"
mkdir -p -- "$MINIO_BACKUP_DIR"
umask 077
for bucket in ${MINIO_BUCKETS:-layers raster documents field-photos quarantine}; do
  mc mirror --preserve "${MINIO_ALIAS}/${bucket}" "${MINIO_BACKUP_DIR}/${bucket}"
done
printf 'minio_backup=%s\n' "$MINIO_BACKUP_DIR"