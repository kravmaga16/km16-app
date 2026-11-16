#!/usr/bin/env python3
"""Export KM16 historical Supabase migrations from a local CSV copy.

Input is generated with a read-only PostgreSQL query; this tool does NOT connect
to Supabase and never uploads migration SQL to GitHub.

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "\\copy (SELECT version, name, array_to_string(statements, E'\\n') AS sql FROM supabase_migrations.schema_migrations ORDER BY version) TO 'km16-migrations.csv' WITH (FORMAT csv, HEADER true)"

Then:
python3 scripts/export-km16-migrations.py --csv km16-migrations.csv --output-dir ./km16-migrations-private
"""
import argparse
import csv
import hashlib
import pathlib
import re
import sys

VERSION = re.compile(r"^\d{14}$")
EXPECTED_COUNT = 44

def export(csv_path, output_dir, manifest_path=None):
    with csv_path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != EXPECTED_COUNT:
        raise ValueError(f"Expected {EXPECTED_COUNT} migrations, got {len(rows)}")
    versions = [row["version"] for row in rows]
    if any(not VERSION.fullmatch(v) for v in versions):
        raise ValueError("Invalid migration version")
    if versions != sorted(set(versions)):
        raise ValueError("Versions must be sorted and unique")
    if versions[0] != "20261108081316" or versions[-1] != "20261116050941":
        raise ValueError("Unexpected historical migration boundaries")
    if any(not row.get("sql", "").strip() for row in rows):
        raise ValueError("One or more migrations have empty SQL")
    if manifest_path is not None:
        with manifest_path.open(newline='', encoding='utf-8') as mf:
            manifest = {row['version']: row for row in csv.DictReader(mf)}
        if len(manifest) != EXPECTED_COUNT or set(manifest) != set(versions):
            raise ValueError('Migration manifest differs from export history')
        for row in rows:
            raw = row['sql'].encode('utf-8')
            reference = manifest[row['version']]
            if hashlib.md5(raw).hexdigest() != reference['md5'] or len(raw) != int(reference['bytes']) or row['name'] != reference['name']:
                raise ValueError(f"Migration integrity mismatch: {row['version']}")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise ValueError("Output directory is not empty; refusing to overwrite")
    output_dir.mkdir(parents=True, exist_ok=True)
    for row in rows:
        safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", row["name"]).strip("_") or "migration"
        (output_dir / f'{row["version"]}_{safe_name}.sql').write_text(
            row["sql"].rstrip() + "\n", encoding="utf-8"
        )
    return len(rows), sum(len(row["sql"].encode("utf-8")) for row in rows)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=pathlib.Path, required=True)
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, help="Expected migration fingerprints CSV")
    args = parser.parse_args()
    try:
        count, size = export(args.csv, args.output_dir, args.manifest)
    except (ValueError, KeyError, OSError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(f"PASS: exported {count} historical SQL files ({size} UTF-8 bytes)")
    print("SECURITY: keep these files private; review SQL for credentials before sharing.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
