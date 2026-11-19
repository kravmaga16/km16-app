#!/usr/bin/env bash
# KM16: read-only export of migration history. Run on your Mac, never in CI.
set -euo pipefail
umask 077
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: set DATABASE_URL in your shell (do not paste credentials into GitHub)." >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required. Install PostgreSQL client tools locally." >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CSV="$ROOT/km16-migrations.csv"
OUT="$ROOT/km16-migrations-private"
MANIFEST="$ROOT/tests/fixtures/km16-production-migration-manifest.csv"
if [[ -e "$CSV" || -e "$OUT" ]]; then
  echo "ERROR: existing export detected. Refusing to overwrite." >&2
  exit 2
fi
trap 'rm -f "$CSV"' ERR
# \copy writes a local CSV; the SQL query itself is read-only.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "\\copy (SELECT version, name, array_to_string(statements, E'\\n') AS sql FROM supabase_migrations.schema_migrations ORDER BY version) TO '$CSV' WITH (FORMAT csv, HEADER true)"
python3 "$ROOT/scripts/export-km16-migrations.py" --csv "$CSV" --output-dir "$OUT" --manifest "$MANIFEST"
echo "Verified private SQL files: $OUT"
echo "Do not commit or upload these files without a secrets review."
