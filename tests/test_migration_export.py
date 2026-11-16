#!/usr/bin/env python3
"""Tests for private migration CSV export. No database access."""
import csv
import importlib.util
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "export-km16-migrations.py"
spec = importlib.util.spec_from_file_location("km16_migration_export", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.csv_file = self.root / "migrations.csv"
        self.output = self.root / "private"
        self.rows = [
            {"version": "20261108081316" if i == 0 else "20261116050941" if i == 43 else f"20261115{i:06d}",
             "name": f"test migration {i}", "sql": f"select {i};\n-- café"}
            for i in range(44)
        ]
        self.write_rows()

    def write_rows(self):
        with self.csv_file.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=("version", "name", "sql"))
            writer.writeheader()
            writer.writerows(self.rows)

    def test_exports_all_with_unicode(self):
        count, size = module.export(self.csv_file, self.output)
        self.assertEqual(count, 44)
        self.assertGreater(size, 0)
        self.assertEqual(len(list(self.output.glob("*.sql"))), 44)
        self.assertIn("café", next(self.output.glob("*.sql")).read_text())

    def test_rejects_incomplete_history(self):
        self.rows.pop()
        self.write_rows()
        with self.assertRaises(ValueError):
            module.export(self.csv_file, self.output)

    def test_rejects_duplicate_version(self):
        self.rows[10]["version"] = self.rows[9]["version"]
        self.write_rows()
        with self.assertRaises(ValueError):
            module.export(self.csv_file, self.output)

    def test_refuses_overwrite(self):
        self.output.mkdir()
        (self.output / "existing.sql").write_text("keep")
        with self.assertRaises(ValueError):
            module.export(self.csv_file, self.output)
        self.assertEqual((self.output / "existing.sql").read_text(), "keep")

    def test_rejects_empty_sql(self):
        self.rows[8]["sql"] = ""
        self.write_rows()
        with self.assertRaises(ValueError):
            module.export(self.csv_file, self.output)

if __name__ == "__main__":
    unittest.main()
