#!/bin/sh
set -eu
set -o pipefail
cd /seed
sha256sum -c SHA256SUMS
{
  for file in ./*.sql.gz; do
    gzip -dc "$file"
  done
} | psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --single-transaction --set ON_ERROR_STOP=1 > /tmp/reto-restore.log 2>&1 || {
  echo 'RETO database import failed. Diagnostic file: /tmp/reto-restore.log' >&2
  exit 1
}
echo 'RETO: original PostgreSQL structure and masked data restored.'
