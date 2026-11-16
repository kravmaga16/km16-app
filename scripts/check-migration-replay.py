#!/usr/bin/env python3
"""KM16 migration replay preflight (read-only; no database connection).

Usage:
  python3 scripts/check-migration-replay.py --migrations supabase/migrations
  python3 scripts/check-migration-replay.py --migrations /path/to/exported/migrations --baseline /path/to/baseline.sql
"""
import argparse
import pathlib
import re
import sys

EXPECTED_COUNT = 44
REQUIRED_PREEXISTING = (
    "km16_membership_orders",
    "km16_membership_products",
    "km16_membership_payments",
    "km16_external_clients",
    "km16_push_subscriptions",
)
REQUIRED_HISTORIC_POLICIES = ("Published news readable", "President manages news")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--migrations", type=pathlib.Path, required=True)
    parser.add_argument("--baseline", type=pathlib.Path)
    args = parser.parse_args()
    if not args.migrations.is_dir():
        print(f"FAIL: migration directory missing: {args.migrations}")
        return 2
    files = sorted(args.migrations.glob("*.sql"))
    if len(files) != EXPECTED_COUNT:
        print(f"FAIL: expected {EXPECTED_COUNT} migrations, found {len(files)}")
        return 2
    versions = [p.name.split("_", 1)[0] for p in files]
    if versions[:2] != ["20261108081316", "20261108154725"]:
        print("FAIL: first two migration versions do not match the recorded production history")
        return 2
    if len(set(versions)) != len(versions) or any(not re.fullmatch(r"\d{14}", v) for v in versions):
        print("FAIL: duplicate or invalid migration version")
        return 2
    if args.baseline is None or not args.baseline.is_file():
        print("FAIL: baseline SQL file is required for dependency checks")
        return 2
    baseline = args.baseline.read_text(encoding="utf-8")
    # Ignore ordinary SQL comments so a commented-out CREATE cannot satisfy checks.
    baseline = re.sub(r"/\\*.*?\\*/", "", baseline, flags=re.S)
    baseline = re.sub(r"(?m)^\\s*--[^\\n]*$", "", baseline)
    first = files[0].read_text(encoding="utf-8")
    second = files[1].read_text(encoding="utf-8")
    errors = []
    for table in REQUIRED_PREEXISTING:
        if not re.search(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:\"?public\"?\.)?\"?" + table + r"\"?\b", baseline, re.I):
            errors.append(f"baseline missing prerequisite table {table}")
    for policy in REQUIRED_HISTORIC_POLICIES:
        if not re.search(r"create\s+policy\s+[\"']?" + re.escape(policy) + r"[\"']?", baseline, re.I):
            errors.append(f"baseline missing historical policy {policy}")
    if "km16_mail_campaigns" not in first or "km16_trial_attendance" not in second:
        errors.append("unexpected first two migration contents; verify historical order")
    for error in errors:
        print("FAIL:", error)
    if errors:
        return 1
    print(f"PASS: {len(files)} migration files, unique ordered versions, prerequisite baseline objects present")
    print("NOTE: static preflight only. Real PostgreSQL 17 replay and schema diff are still required.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
