// Execute the actual Edge handler offline. Auth and the database are test doubles;
// the query double evaluates the filter, keyset, order and limit against fixtures.
// This does not replace a deployed Auth/PostgREST/RLS integration check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/km16-admin-email-alerts/index.ts', import.meta.url), 'utf8')
  .replace(/^import \{ createClient \} from .*;\s*/m, ''));
const ORIGIN = 'https://app.km16.fr';
const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const PURCHASES = 'km16_admin_purchase_notifications';
const CAMPAIGNS = 'km16_scheduled_mail_deliveries';
const admin = { email: 'alexandre.marchat@gmail.com', email_confirmed_at: '2026-01-01', is_anonymous: false };
const row = (id, state = 'failed', attempted_at = null) => ({
  id, state, attempted_at, event_key: 'purchase:' + id, recipient: 'purchase@example.invalid',
  campaign_id: 'campaign:' + id, email: 'campaign@example.invalid',
});

function harness({ user = admin, authError = null, purchases = [], campaigns = [], dbError = null } = {}) {
  let handler, reads = 0, writes = 0, now = NOW;
  const calls = [], logs = [];
  class Clock extends Date { static now() { return now; } }
  const query = table => {
    assert.ok([PURCHASES, CAMPAIGNS].includes(table), 'unexpected table');
    const state = { table };
    const failWrite = () => { writes++; throw Error('database mutation attempted'); };
    return {
      select(columns) { state.columns = columns.split(','); return this; },
      or(filter) { state.filter = filter; return this; },
      gt(column, value) { state.after = { column, value }; return this; },
      order(column, options) { state.order = { column, ...options }; return this; },
      async limit(limit) {
        reads++; calls.push({ ...state, limit });
        if (dbError) return { data: null, error: dbError };
        const match = /^state\.in\.\(([^)]+)\),and\(state\.eq\.([^,]+),attempted_at\.lt\.(.+)\)$/.exec(state.filter);
        assert.ok(match, 'unsupported query filter');
        const states = match[1].split(','), sendingState = match[2], cutoff = Date.parse(match[3]);
        assert.ok(Number.isFinite(cutoff), 'invalid query timestamp');
        const input = table === PURCHASES ? purchases : campaigns;
        const data = input.filter(item => states.includes(item.state) ||
          (item.state === sendingState && item.attempted_at !== null && Date.parse(item.attempted_at) < cutoff))
          .filter(item => item[state.after.column] > state.after.value)
          .sort((a, b) => (a[state.order.column] - b[state.order.column]) * (state.order.ascending ? 1 : -1))
          .slice(0, limit)
          .map(item => Object.fromEntries(state.columns.map(column => [column, item[column]])));
        return { data, error: null };
      },
      insert: failWrite, update: failWrite, delete: failWrite, upsert: failWrite,
    };
  };
  const createClient = (_url, key) => key === 'anon'
    ? { auth: { getUser: async () => ({ data: { user }, error: authError }) } }
    : { from: query };
  const context = {
    Deno: { serve: fn => { handler = fn; }, env: { get: key => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'secret' })[key] } },
    createClient, Request, Response, Date: Clock, console: { error: (...args) => logs.push(args) },
  };
  vm.runInNewContext(source, context, { timeout: 1000 });
  return {
    call: async ({ origin = ORIGIN, method = 'POST', token = 'valid', body = { page: 0 }, rawBody } = {}) => {
      const headers = {};
      if (origin !== null) headers.origin = origin;
      if (token) headers.authorization = 'Bearer ' + token;
      const req = new Request('https://example.invalid', {
        method, headers, ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(body) } : {}),
      });
      const response = await handler(req);
      return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
    },
    stats: () => ({ reads, writes }), calls, logs, advance: milliseconds => { now += milliseconds; },
  };
}

test('unauthenticated and unauthorized requests cannot query tables', async () => {
  for (const opts of [
    { token: null }, { user: { email: 'someone@example.invalid', email_confirmed_at: 'yes' } },
    { user: { ...admin, is_anonymous: true } }, { user: { ...admin, email_confirmed_at: null } },
    { authError: { message: 'invalid' }, user: null },
  ]) {
    const { token, ...setup } = opts, h = harness(setup);
    const result = await h.call(token === null ? { token: null } : {});
    assert.ok([401, 403].includes(result.status));
    assert.deepEqual(h.stats(), { reads: 0, writes: 0 });
  }
});

test('foreign or missing origin rejected without allow-origin header', async () => {
  for (const origin of ['https://evil.example', null]) {
    const h = harness(), result = await h.call({ origin });
    assert.equal(result.status, 403);
    assert.equal(result.headers.get('access-control-allow-origin'), null);
    assert.equal(h.stats().reads, 0);
  }
});

test('OPTIONS preflight is allowed only for the official origin; GET cannot read', async () => {
  const h = harness(), result = await h.call({ method: 'OPTIONS', token: null });
  assert.equal(result.status, 204);
  assert.equal(result.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await h.call({ method: 'GET' })).status, 405);
  assert.deepEqual(h.stats(), { reads: 0, writes: 0 });
});

test('three alert rules include only failures, uncertain and sending older than 15 minutes', async () => {
  const fixtures = [
    row(1, 'failed'), row(2, 'uncertain'), row(3, 'sending', '2026-11-18T11:44:59.999Z'),
    row(4, 'sending', '2026-11-18T11:45:00.000Z'), row(5, 'sending', '2026-11-18T11:45:00.001Z'),
    row(6, 'sending'), row(7, 'pending', '2026-11-18T10:00:00.000Z'),
    row(8, 'accepted', '2026-11-18T10:00:00.000Z'),
  ];
  const h = harness({ purchases: fixtures, campaigns: fixtures }), result = await h.call();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.data.alerts.length, 6);
  for (const category of ['achats', 'emails_programmes']) {
    assert.deepEqual(result.data.alerts.filter(x => x.categorie === category).map(x => [x.notification_id, x.action_requise]),
      [[1, 'validation_requise'], [2, 'verification_manuelle'], [3, 'blocage_a_verifier']]);
  }
  assert.equal(result.data.has_more, false);
  assert.deepEqual(result.data.cursor, { observed_at: '2026-11-18T12:00:00.000Z', purchases_after: 3, campaigns_after: 3 });
  assert.equal(result.data.alerts[0].destinataire, 'purchase@example.invalid');
  assert.equal(result.data.alerts[3].destinataire, 'campaign@example.invalid');
  assert.deepEqual(h.stats(), { reads: 2, writes: 0 });
});

test('independent keysets page both sources without losing a row when earlier alerts disappear', async () => {
  const purchases = Array.from({ length: 102 }, (_, i) => row(i + 1));
  const campaigns = [row(7, 'uncertain'), row(15, 'failed')];
  const before = JSON.stringify({ purchases, campaigns });
  const h = harness({ purchases, campaigns }), first = await h.call();
  assert.equal(first.status, 200);
  assert.equal(first.data.alerts.length, 102);
  assert.equal(first.data.has_more, true);
  assert.deepEqual(first.data.cursor, { observed_at: '2026-11-18T12:00:00.000Z', purchases_after: 100, campaigns_after: 15 });
  assert.equal(JSON.stringify({ purchases, campaigns }), before, 'read must not mutate fixtures');
  purchases[0].state = 'accepted'; // Another worker resolves an earlier alert.
  const next = await h.call({ body: { page: 1, cursor: first.data.cursor } });
  assert.equal(next.status, 200);
  assert.deepEqual(next.data.alerts.map(x => [x.categorie, x.notification_id]), [['achats', 101], ['achats', 102]]);
  assert.equal(next.data.has_more, false);
  assert.equal(next.data.cursor.campaigns_after, 15);
  assert.equal(h.stats().writes, 0);
});

test('new low-ID alerts do not duplicate visited rows; refresh starts a new scan', async () => {
  const purchases = [row(1, 'pending'), ...Array.from({ length: 102 }, (_, i) => row(i + 2))];
  const h = harness({ purchases }), first = await h.call();
  purchases[0].state = 'failed';
  const next = await h.call({ body: { page: 1, cursor: first.data.cursor } });
  assert.deepEqual(next.data.alerts.map(x => x.notification_id), [102, 103]);
  assert.equal(new Set([...first.data.alerts, ...next.data.alerts].map(x => x.notification_id)).size, 102);
  const refreshed = await h.call();
  assert.equal(refreshed.data.alerts[0].notification_id, 1);
});

test('15-minute threshold stays fixed between pages and advances only on refresh', async () => {
  const purchases = [...Array.from({ length: 101 }, (_, i) => row(i + 1)), row(102, 'sending', '2026-11-18T11:50:00.000Z')];
  const h = harness({ purchases }), first = await h.call();
  h.advance(10 * 60_000);
  const next = await h.call({ body: { page: 1, cursor: first.data.cursor } });
  assert.deepEqual(next.data.alerts.map(x => x.notification_id), [101]);
  assert.equal(next.data.cursor.observed_at, first.data.cursor.observed_at);
  const refreshed = await h.call();
  assert.equal(refreshed.data.cursor.observed_at, '2026-11-18T12:10:00.000Z');
  const refreshedNext = await h.call({ body: { page: 1, cursor: refreshed.data.cursor } });
  assert.deepEqual(refreshedNext.data.alerts.map(x => x.notification_id), [101, 102]);
});

test('invalid pages, cursors and malformed bodies are rejected before database reads', async () => {
  const cursor = { observed_at: '2026-11-18T12:00:00.000Z', purchases_after: 1, campaigns_after: 0 };
  const invalid = [
    ...[-1, '1', 1.5, 10001, null].map(page => ({ page })),
    null, [], [1], false, { page: 1 }, { page: 0, cursor },
    ...[null, [], false, {},
      { ...cursor, observed_at: 'not a date' }, { ...cursor, observed_at: '2026-11-18' },
      { ...cursor, observed_at: '2026-11-18T12:00:01.000Z' },
      { ...cursor, purchases_after: -1 }, { ...cursor, purchases_after: '1' },
      { ...cursor, purchases_after: Number.MAX_SAFE_INTEGER + 1 },
      { ...cursor, campaigns_after: 1.5 },
    ].map(cursor => ({ page: 1, cursor })),
  ];
  const h = harness();
  for (const body of invalid) assert.equal((await h.call({ body })).status, 400, JSON.stringify(body));
  assert.equal((await h.call({ rawBody: '{broken' })).status, 400);
  assert.deepEqual(h.stats(), { reads: 0, writes: 0 });
});

test('database errors fail the complete read without exposing provider details', async () => {
  const h = harness({ dbError: { code: '42501', message: 'private database internals' } });
  const result = await h.call();
  assert.equal(result.status, 503);
  assert.deepEqual(result.data, { error: 'Consultation indisponible' });
  assert.equal(h.stats().writes, 0);
});

test('unsafe IDs fail closed instead of corrupting the next cursor', async () => {
  const h = harness({ purchases: [row(Number.MAX_SAFE_INTEGER + 1)] });
  const result = await h.call();
  assert.equal(result.status, 503);
  assert.equal(h.stats().writes, 0);
});
