#!/usr/bin/env bash
set -Eeuo pipefail
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${DRILL_DB:?DRILL_DB is required}"
case "$DRILL_DB" in campha_restore_*|campha_test_restore_*) ;; *) echo 'DRILL_DB must start with campha_restore_ or campha_test_restore_' >&2; exit 2;; esac
[ -f "$BACKUP_FILE" ] || { echo 'BACKUP_FILE not found' >&2; exit 2; }
[ -f "${BACKUP_FILE}.sha256" ] && (cd "$(dirname "$BACKUP_FILE")" && sha256sum --check "$(basename "$BACKUP_FILE").sha256")
psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=db="$DRILL_DB" <<'SQL'
SELECT set_config('campha.drill_db', :'db', false);
DO $$
DECLARE target text := current_setting('campha.drill_db');
BEGIN
  PERFORM pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=target AND pid<>pg_backend_pid();
END $$;
SQL
dropdb --if-exists "$DRILL_DB"
createdb "$DRILL_DB"
cleanup(){ dropdb --if-exists "$DRILL_DB"; }
trap cleanup EXIT
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$DRILL_DB" "$BACKUP_FILE"
psql --dbname="$DRILL_DB" --set=ON_ERROR_STOP=1 <<'SQL'
SELECT PostGIS_Full_Version();
SELECT COUNT(*) AS applied_migrations FROM core.schema_migrations;
SELECT to_regclass('gis.layers') AS layers, to_regclass('auth.users') AS users;
SQL
printf 'restore_drill=passed database=%s\n' "$DRILL_DB"