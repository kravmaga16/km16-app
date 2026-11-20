// PostgreSQL behavior tests, entirely in-memory. No credentials, network, cron or SMTP.
// Install the pinned test dependency externally: npm install @electric-sql/pglite@0.5.16
// PGLITE_MODULE may point to that installation's dist/index.js.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const source = path => readFile(new URL(path, import.meta.url), 'utf8');
try {
  await db.exec(await source('./purchase-notifications-fixture.sql'));
  const migrations = await readdir(new URL('../supabase/migrations/', import.meta.url));
  const matching = migrations.filter(path => path.endsWith('_purchase_notification_coverage.sql'));
  assert.equal(matching.length, 1, 'exactly one purchase coverage migration is required');
  await db.exec(await source('../supabase/migrations/' + matching[0]));
  const results = await db.exec(await source('./purchase-notifications-postgres.sql'));
  assert.ok(results.some(result => result.rows?.some(row => row.result === 'KM16_PURCHASE_NOTIFICATION_SQL_OK')));
  const checks = results.filter(result => result.fields?.some(field => field.name === 'assert_true')).length;
  assert.ok(checks >= 25, 'all behavioral checks must execute');
  console.log(`PASS ${checks} PostgreSQL behavior checks: cash/cheque, permissions/RLS, labels, paid transitions, no backfill, duplicate protection, live-only Stripe claims, fairness and lease exclusions.`);
} catch (error) {
  console.error(error.message, error.where || '');
  process.exitCode = 1;
} finally {
  await db.close();
}
