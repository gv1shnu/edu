#!/bin/sh
set -eu
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a new empty target database}"
: "${1:?Usage: restore.sh /path/to/backup.dump}"
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-privileges --exit-on-error "$1"
printf '%s\n' 'Restore complete. Run migrations and verify before switching the application.'
