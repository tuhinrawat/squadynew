#!/usr/bin/env bash
#
# Full logical backup of the database, written to a timestamped .sql.gz file.
# Run this BEFORE applying migrations or the bid backfill, so there is a
# restore point even though both of those operations are additive.
#
# Usage:
#   DATABASE_URL="postgresql://user:pass@host:5432/db" ./scripts/backup-db.sh
#   # or, with DATABASE_URL already in .env.local / the shell:
#   npm run db:backup
#
# Requires the Postgres client tools (pg_dump). On macOS: `brew install
# libpq` then add it to PATH, or `brew install postgresql`.
#
# IMPORTANT: DATABASE_URL must be a DIRECT Postgres URL (postgresql://...),
# not a Prisma Accelerate URL (prisma://...). pg_dump cannot use the
# Accelerate proxy. If you only have the Accelerate URL, grab the direct
# connection string from your database provider's dashboard for this.

set -euo pipefail

# Load DATABASE_URL from .env.local / .env if not already set, matching how
# the repo's tsx scripts resolve it.
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f .env.local ]; then
    # shellcheck disable=SC1091
    set -a; . ./.env.local; set +a
  elif [ -f .env ]; then
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
  fi
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set (and no .env.local/.env found)." >&2
  exit 1
fi

case "$DATABASE_URL" in
  prisma://*)
    echo "ERROR: DATABASE_URL is a Prisma Accelerate URL (prisma://...)." >&2
    echo "       pg_dump needs the DIRECT Postgres URL. Get it from your DB provider." >&2
    exit 1
    ;;
esac

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found. Install Postgres client tools first." >&2
  echo "       macOS: brew install libpq  (then add its bin to PATH)" >&2
  exit 1
fi

mkdir -p backups
TS="$(date +%Y%m%d_%H%M%S)"
OUT="backups/backup_${TS}.sql.gz"

echo "Backing up database to ${OUT} ..."
# --no-owner/--no-privileges keep the dump portable across roles/hosts.
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$OUT"

BYTES=$(wc -c < "$OUT" | tr -d ' ')
echo "Done. Wrote ${OUT} (${BYTES} bytes)."
echo
echo "To restore into an empty database:"
echo "  gunzip -c ${OUT} | psql \"\$TARGET_DATABASE_URL\""
