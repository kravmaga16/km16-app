#!/usr/bin/env python3
"""Self-contained tests for the KM16 migration preflight; no database needed."""
import importlib.util
import pathlib
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "check-migration-replay.py"
spec = importlib.util.spec_from_file_location("km16_replay_preflight", SCRIPT)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)

TABLES = checker.REQUIRED_PREEXISTING
POLICIES = checker.REQUIRED_HISTORIC_POLICIES

class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.migrations = self.root / "migrations"
        self.migrations.mkdir()
        for i in range(44):
            version = ("20261108081316" if i == 0 else "20261108154725" if i == 1 else f"20261116{i:06d}")
            sql = ("create table public.km16_mail_campaigns(id int);" if i == 0 else
                   "create table public.km16_trial_attendance(id int);" if i == 1 else "select 1;")
            (self.migrations / f"{version}_test.sql").write_text(sql)
        self.baseline = self.root / "baseline.sql"
        self.baseline.write_text(
            "".join(f"create table public.{name}(id integer);\n" for name in TABLES)
            + "".join(f'create policy "{name}" on public.km16_news using (false);\n' for name in POLICIES)
        )

    def check(self):
        with patch("sys.argv", ["check-migration-replay.py", "--migrations", str(self.migrations),
                                "--baseline", str(self.baseline)]), redirect_stdout(StringIO()):
            return checker.main()

    def test_valid_fixture(self):
        self.assertEqual(self.check(), 0)

    def test_missing_migration(self):
        sorted(self.migrations.glob("*.sql"))[-1].unlink()
        self.assertEqual(self.check(), 2)

    def test_missing_table(self):
        self.baseline.write_text(self.baseline.read_text().replace(
            "create table public.km16_membership_orders(id integer);", ""))
        self.assertEqual(self.check(), 1)

    def test_commented_out_table_is_not_accepted(self):
        self.baseline.write_text(self.baseline.read_text().replace(
            "create table public.km16_membership_orders(id integer);",
            "-- create table public.km16_membership_orders(id integer);"))
        self.assertEqual(self.check(), 1)

    def test_missing_policy(self):
        self.baseline.write_text(self.baseline.read_text().replace(
            'create policy "President manages news" on public.km16_news using (false);', ""))
        self.assertEqual(self.check(), 1)

    def test_wrong_initial_migration_version(self):
        old = self.migrations / "20261108081316_test.sql"
        old.rename(self.migrations / "20261108081317_test.sql")
        self.assertEqual(self.check(), 2)

if __name__ == "__main__":
    unittest.main()
