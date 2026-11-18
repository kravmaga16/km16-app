// Real local Auth -> Edge -> PostgREST -> PostgreSQL integration; no hosted access.
// Run only after a disposable Supabase stack and this function are served locally.
// Environment: API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY; optional MAILPIT_URL.
// Audit tests append fictional journal entries; delivery tables remain unchanged.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { testEmailReviewJournal } from './email-reviews-integration.mjs';

function localUrl(name, protocol, port, path) {
  assert.ok(process.env[name], name + ' must be provided explicitly');
  const url = new URL(process.env[name]);
  assert.equal(url.protocol, protocol, name + ': local protocol required');
  assert.equal(url.hostname, '127.0.0.1', name + ': loopback required');
  assert.equal(url.port, port, name + ': isolated local port required');
  assert.equal(url.pathname, path, name + ': unexpected path');
  assert.equal(url.search, '', name + ': URL options are forbidden');
  assert.equal(url.hash, '', name + ': URL fragments are forbidden');
  return url;
}
const api = localUrl('API_URL', 'http:', '54321', '/');
assert.equal(api.username + api.password, '', 'API credentials belong in headers');
const db = localUrl('DB_URL', 'postgresql:', '54322', '/postgres');
assert.equal(decodeURIComponent(db.username), 'postgres', 'isolated postgres user required');
const anon = process.env.ANON_KEY, service = process.env.SERVICE_ROLE_KEY;
assert.ok(anon && service, 'local legacy anon/service_role keys required');
const mailpit = process.env.MAILPIT_URL ? localUrl('MAILPIT_URL', 'http:', '54324', '/') : null;
if (mailpit) assert.equal(mailpit.username + mailpit.password, '', 'unexpected Mailpit credentials');
const ORIGIN = 'https://app.km16.fr';
const functionPath = '/functions/v1/km16-admin-email-alerts';
const observedAt = new Date(Date.now() - 1000).toISOString();
const pgEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
  PGHOST: '127.0.0.1', PGPORT: '54322', PGDATABASE: 'postgres', PGUSER: 'postgres',
  PGPASSWORD: decodeURIComponent(db.password), PGAPPNAME: 'km16-email-integration', PGSSLMODE: 'disable',
};
function sql(args) {
  const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', env: pgEnv, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) throw Error('Local SQL failed: ' + (result.error?.message || result.stderr.trim()));
  return result.stdout.trim();
}
async function request(path, { token, key = anon, method = 'GET', body, origin, timeout = 30_000 } = {}) {
  const headers = { apikey: key };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (origin !== undefined) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, api), {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout), redirect: 'error',
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: response.status, data, headers: response.headers };
}
const call = (token, body = { page: 0 }, extra = {}) => request(functionPath, {
  token, body, method: 'POST', origin: ORIGIN, ...extra,
});
async function checkMailpit() {
  if (!mailpit) return;
  const response = await fetch(new URL('/api/v1/messages', mailpit), {
    signal: AbortSignal.timeout(10_000), redirect: 'error',
  });
  assert.equal(response.status, 200, 'local Mailpit API must be available');
  const result = await response.json();
  assert.equal(result.total, 0, 'disposable Mailpit must contain zero messages');
}
const fingerprintSql = `SELECT jsonb_build_object(
  'purchases', (SELECT md5(coalesce(jsonb_agg(to_jsonb(n) ORDER BY id)::text, '[]')) FROM public.km16_admin_purchase_notifications n),
  'deliveries', (SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text, '[]')) FROM public.km16_scheduled_mail_deliveries d),
  'campaigns', (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY id)::text, '[]')) FROM public.km16_scheduled_campaigns c)
)::text;`;
let checks = 0;
function passed(label) { checks++; console.log('PASS ' + checks + ': ' + label); }

// The background local Edge process may still be compiling its pinned SDK import.
let edgeReady;
const edgeDeadline = Date.now() + 60_000;
while (Date.now() < edgeDeadline) {
  try { edgeReady = await request(functionPath, { method: 'OPTIONS', origin: ORIGIN, timeout: 5000 }); }
  catch { edgeReady = null; }
  if (edgeReady?.status === 204) break;
  await delay(1000);
}
assert.equal(edgeReady?.status, 204, 'local Edge function must become ready');
await checkMailpit();
sql(['-v', 'km16_email_integration=1', '-v', 'fixture_observed_at=' + observedAt,
  '-f', fileURLToPath(new URL('./email-relances-integration-fixture.sql', import.meta.url))]);
sql(['-1', '-f', fileURLToPath(new URL('../supabase/migrations/20261118133138_email_alert_review_journal.sql', import.meta.url))]);
const before = sql(['-c', fingerprintSql]);
let restReady;
for (let attempt = 0; attempt < 20; attempt++) {
  restReady = await request('/rest/v1/km16_admin_purchase_notifications?select=id&limit=1', { token: service, key: service });
  if (restReady.status === 200) break;
  await delay(500);
}
assert.equal(restReady.status, 200, 'PostgREST schema cache must load the fixture');
passed('isolated fixture is reachable through real PostgREST');

async function createAndLogin(email) {
  const password = 'KM16local-Aa1!' + randomBytes(24).toString('base64url');
  const created = await request('/auth/v1/admin/users', {
    token: service, key: service, method: 'POST', body: { email, password, email_confirm: true },
  });
  assert.ok([200, 201].includes(created.status), 'local Auth admin user creation must succeed');
  const user = created.data?.user || created.data;
  assert.ok(user?.id && user.email_confirmed_at, 'fixture user must be confirmed');
  const login = await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email, password },
  });
  assert.equal(login.status, 200, 'real password login must succeed');
  assert.ok(login.data?.access_token, 'real access token required');
  return { id: user.id, token: login.data.access_token };
}
const admin = await createAndLogin('alexandre.marchat@gmail.com');
const member = await createAndLogin('member@example.invalid');
passed('real Auth creates confirmed local users and returns login tokens without email APIs');

for (const token of [anon, member.token]) {
  for (const table of ['km16_admin_purchase_notifications', 'km16_scheduled_mail_deliveries']) {
    const denied = await request('/rest/v1/' + table + '?select=id&limit=1', { token });
    assert.ok([401, 403].includes(denied.status), 'browser role must not read notification tables');
    assert.equal(Array.isArray(denied.data), false, 'denial must not return notification rows');
  }
}
passed('anon and authenticated users cannot read either notification table directly');

assert.equal((await call(member.token)).status, 403, 'member must be denied by server authorization');
assert.equal((await call(null)).status, 401, 'missing token must be denied');
const parts = admin.token.split('.');
parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
assert.equal((await call(parts.join('.'))).status, 401, 'tampered JWT must be denied');
passed('real server denies member, missing JWT and tampered JWT');

const foreign = await call(admin.token, { page: 0 }, { origin: 'https://foreign.example.invalid' });
assert.equal(foreign.status, 403);
assert.deepEqual(foreign.data, { error: 'Origine refusée' }, 'foreign origin must receive only the denial, never alerts');
// Local CLI Kong enables its CORS plugin on functions-v1, adding '*' even to a
// handler's denial. The handler-only tests separately check its stricter headers.
const allowedLocalCors = response => [ORIGIN, '*'].includes(response.headers.get('access-control-allow-origin'));
const preflight = await request(functionPath, { method: 'OPTIONS', origin: ORIGIN });
assert.equal(preflight.status, 204);
assert.ok(allowedLocalCors(preflight));
assert.equal((await request(functionPath, { token: admin.token, method: 'GET', origin: ORIGIN })).status, 405);
passed('real gateway and function enforce origin, OPTIONS and method restrictions');

const initial = await call(admin.token);
assert.equal(initial.status, 200, 'confirmed admin must be able to read alerts');
assert.equal(initial.data.page, 0);
assert.equal(initial.data.alerts.length, 200, 'first page must be bounded per source');
assert.equal(initial.data.has_more, true);
assert.equal(initial.headers.get('cache-control'), 'no-store');
assert.ok(allowedLocalCors(initial));
assert.ok(Date.parse(initial.data.cursor.observed_at) <= Date.now());
passed('confirmed administrator reads a bounded page with no-store headers');

// Use the exact fixture instant to test the boundary deterministically over HTTP.
// A page>0 cursor with after=0 is valid and freezes the clock independently of setup duration.
let cursor = { observed_at: observedAt, purchases_after: 0, campaigns_after: 0 };
const alerts = [];
let finished = false;
for (let page = 1; page <= 5; page++) {
  const result = await call(admin.token, { page, cursor });
  assert.equal(result.status, 200, 'keyset page must be readable');
  assert.equal(result.data.page, page);
  assert.equal(result.data.cursor.observed_at, observedAt);
  assert.ok(result.data.alerts.length <= 200);
  alerts.push(...result.data.alerts);
  cursor = result.data.cursor;
  if (!result.data.has_more) { finished = true; break; }
}
assert.equal(finished, true, 'pagination must terminate');
assert.equal(alerts.length, 218);
assert.equal(new Set(alerts.map(x => x.categorie + ':' + x.notification_id)).size, 218, 'no duplicate rows');
const expectedIds = [1, 2, 3, 9, ...Array.from({ length: 105 }, (_, i) => i + 11)];
for (const category of ['achats', 'emails_programmes']) {
  const rows = alerts.filter(x => x.categorie === category);
  assert.deepEqual(rows.map(x => x.notification_id), expectedIds, 'exact threshold/null/pending/accepted exclusions');
  for (const row of rows) {
    const action = row.notification_id === 2 ? 'verification_manuelle'
      : [3, 9].includes(row.notification_id) ? 'blocage_a_verifier' : 'validation_requise';
    assert.equal(row.action_requise, action);
    assert.ok(row.destinataire.endsWith('@example.invalid'), 'only fictional recipients');
  }
}
passed('real PostgREST filter and keysets return all 218 expected alerts across both sources');

for (const body of [null, [], { page: -1 }, { page: '1' }, { page: 1 }, { page: 1, cursor: { ...cursor, purchases_after: -1 } }]) {
  assert.equal((await call(admin.token, body)).status, 400, 'malformed requests must be rejected');
}
passed('malformed requests and cursor errors return HTTP 400');

await testEmailReviewJournal({ request, sql, admin, member, anon, service, observedAt, alertsCall: call });

const deleted = await request('/auth/v1/admin/users/' + encodeURIComponent(member.id), {
  token: service, key: service, method: 'DELETE',
});
assert.ok([200, 204].includes(deleted.status), 'fixture member deletion must succeed');
assert.equal((await call(member.token)).status, 401, 'stale JWT for removed user must be rejected by Auth');
assert.equal((await request('/functions/v1/km16-admin-email-reviews', {
  token: member.token, method: 'POST', origin: ORIGIN,
  body: { action: 'history', categorie: 'achats', notification_id: 1 },
})).status, 401, 'review endpoint rejects deleted fixture user too');
passed('a real previously valid JWT stops authorizing after its fixture user is deleted');

assert.equal(sql(['-c', fingerprintSql]), before, 'all notification/campaign values must remain unchanged');
await checkMailpit();
passed('notification data fingerprints are unchanged' + (mailpit ? ' and Mailpit remains empty' : ' (Mailpit not configured)'));
assert.equal(checks, 10);
console.log('KM16_EMAIL_INTEGRATION_OK: 10 checks; real local Auth/REST/Edge; no notification writes.');
