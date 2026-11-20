// PostgreSQL behavior tests in a fresh in-memory database; no SMTP or network.
// npm install @electric-sql/pglite@0.5.16 externally, or set PGLITE_MODULE.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const source = path => readFile(new URL(path, import.meta.url), 'utf8');
try {
  await db.exec(await source('./checkout-reminders-fixture.sql'));
  const paths = await readdir(new URL('../supabase/migrations/', import.meta.url));
  const matches = paths.filter(path => /^\d+_checkout_reminders\.sql$/.test(path));
  assert.equal(matches.length, 1, 'one checkout reminder migration, excluding scheduler');
  await db.exec(await source('../supabase/migrations/' + matches[0]));
  const results = await db.exec(await source('./checkout-reminders-postgres.sql'));
  assert.ok(results.some(result => result.rows?.some(row => row.result === 'KM16_CHECKOUT_REMINDER_SQL_OK')));
  const checks = results.filter(result => result.fields?.some(field => field.name === 'assert_true')).length;
  assert.ok(checks >= 50, 'all meaningful eligibility, consent and lease checks must execute');
  console.log(`PASS ${checks} checkout reminder PostgreSQL behavior checks: future-only, permissions, three purchase kinds, consent, paid/refund exclusion, expiry, lease recovery, at-most-one SMTP and unsubscribe.`);
} catch (error) {
  console.error(error.message, error.where || '', error.detail || '');
  process.exitCode = 1;
} finally {
  await db.close();
}
