// Run the real Edge handler offline. The Auth and PostgREST clients are doubles;
// SQL concurrency, idempotence and ACLs are exercised by the separate SQL/HTTP tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/km16-admin-email-reviews/index.ts', import.meta.url), 'utf8')
  .replace(/^import \{ createClient \} from .*;\s*/m, ''));
const ORIGIN = 'https://app.km16.fr';
const TABLE = 'km16_email_alert_reviews';
const RPC = 'km16_record_email_alert_review';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const admin = { id: ACTOR, email: 'alexandre.marchat@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false };
const historyBody = { action: 'history', categorie: 'achats', notification_id: 1 };
const recordBody = {
  action: 'record', categorie: 'achats', notification_id: 1, request_id: REQUEST,
  expected_state: 'failed', expected_attempted_at: '2026-11-18T12:00:00.123456+01:00',
  expected_last_review_id: 0, decision: 'verification_effectuee', note: 'Vérification effectuée',
};
const review = (id, extra = {}) => ({
  id, request_id: REQUEST, categorie: 'achats', notification_id: 1,
  decision: 'verification_effectuee', note: 'Vérification effectuée',
  observed_state: 'failed', observed_attempted_at: recordBody.expected_attempted_at,
  previous_review_id: Math.max(0, id - 1), recorded_by: ACTOR,
  recorded_at: '2026-11-18T13:00:00.000000+00:00', ...extra,
});
const plain = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const { user = admin, authError = null, history = [], historyError = null, rpcError = null,
    authThrows = false, historyThrows = false, rpcThrows = false, missingEnv = null } = options;
  let handler, auth = 0, reads = 0, rpcs = 0, writes = 0, serviceClients = 0;
  const queries = [], rpcCalls = [], events = [], logs = [];
  const mutation = () => { writes++; throw Error('unexpected direct database mutation'); };
  const query = table => {
    assert.equal(table, TABLE, 'the handler may read only the review journal');
    const state = { table, filters: [] };
    return {
      select(columns) { state.columns = columns.split(','); return this; },
      eq(column, value) { state.filters.push({ column, value }); return this; },
      order(column, options) { state.order = { column, ...options }; return this; },
      lt(column, value) { state.before = { column, value }; return this; },
      async limit(limit) {
        reads++; events.push('read'); queries.push(plain({ ...state, limit }));
        if (historyThrows) throw Error('sensitive database details');
        if (historyError) return { data: null, error: historyError };
        if (Object.hasOwn(options, 'historyData')) return { data: options.historyData, error: null };
        const data = history.filter(row => state.filters.every(filter => row[filter.column] === filter.value))
          .filter(row => !state.before || row[state.before.column] < state.before.value)
          .sort((a, b) => (a[state.order.column] - b[state.order.column]) * (state.order.ascending ? 1 : -1))
          .slice(0, limit)
          .map(row => Object.fromEntries(state.columns.map(column => [column, row[column]])));
        return { data, error: null };
      },
      insert: mutation, update: mutation, upsert: mutation, delete: mutation,
    };
  };
  const createClient = (url, key) => {
    assert.equal(url, 'https://example.invalid');
    if (key === 'anon') return { auth: { async getUser(token) {
      auth++; events.push('auth:' + token);
      if (authThrows) throw Error('private authentication details');
      return { data: { user }, error: authError };
    } } };
    assert.equal(key, 'secret', 'database client must use the server key');
    serviceClients++; events.push('service');
    return {
      from: query,
      async rpc(name, args) {
        assert.equal(name, RPC, 'only the dedicated review RPC is permitted');
        rpcs++; events.push('rpc'); rpcCalls.push({ name, args: plain(args) });
        if (rpcThrows) throw Error('private RPC details');
        if (rpcError) return { data: null, error: rpcError };
        return { data: Object.hasOwn(options, 'rpcData') ? options.rpcData : [review(1)], error: null };
      },
    };
  };
  const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'secret' };
  if (missingEnv) delete env[missingEnv];
  vm.runInNewContext(source, {
    Deno: { serve: fn => { handler = fn; }, env: { get: key => env[key] } },
    createClient, Request, Response, console: { error: (...args) => logs.push(args) },
  }, { timeout: 1000 });
  return {
    async call({ origin = ORIGIN, method = 'POST', token = 'valid-user-jwt', body = historyBody, rawBody, authorization } = {}) {
      const headers = {};
      if (origin !== null) headers.origin = origin;
      if (authorization !== undefined) headers.authorization = authorization;
      else if (token) headers.authorization = 'Bearer ' + token;
      const result = await handler(new Request('https://example.invalid/functions/v1/km16-admin-email-reviews', {
        method, headers, ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(body) } : {}),
      }));
      return { status: result.status, data: result.status === 204 ? null : await result.json(), headers: result.headers };
    },
    stats: () => ({ auth, reads, rpcs, writes, serviceClients }), queries, rpcCalls, events, logs,
  };
}

const assertNoDatabase = h => {
  const { reads, rpcs, writes, serviceClients } = h.stats();
  assert.deepEqual({ reads, rpcs, writes, serviceClients }, { reads: 0, rpcs: 0, writes: 0, serviceClients: 0 });
};

test('authentication and the confirmed administrator allowlist precede all database access', async () => {
  for (const [setup, call, status] of [
    [{}, { token: null }, 401],
    [{}, { authorization: 'Basic token' }, 401],
    [{}, { authorization: 'Bearer one two' }, 401],
    [{ user: null }, {}, 401],
    [{ authError: { message: 'invalid jwt' } }, {}, 401],
    [{ user: { ...admin, email: 'member@example.invalid' } }, {}, 403],
    [{ user: { ...admin, is_anonymous: true } }, {}, 403],
    [{ user: { ...admin, email_confirmed_at: null } }, {}, 403],
    [{ user: { ...admin, id: null } }, {}, 403],
    [{ user: { ...admin, id: 'invalid-actor' } }, {}, 403],
  ]) {
    const h = harness(setup), result = await h.call({ ...call, rawBody: '{invalid json' });
    assert.equal(result.status, status);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assertNoDatabase(h);
  }
  const h = harness({ user: { ...admin, email: admin.email.toUpperCase() } });
  assert.equal((await h.call()).status, 200);
  assert.deepEqual(h.events, ['auth:valid-user-jwt', 'service', 'read']);
});

test('only the official origin can call POST or OPTIONS, and GET never queries data', async () => {
  for (const origin of ['https://foreign.example', 'https://app.km16.fr.evil.example', null]) {
    for (const method of ['POST', 'OPTIONS']) {
      const h = harness(), result = await h.call({ origin, method });
      assert.equal(result.status, 403);
      assert.equal(result.headers.get('access-control-allow-origin'), null);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(h.stats().auth, 0);
      assertNoDatabase(h);
    }
  }
  const h = harness(), preflight = await h.call({ method: 'OPTIONS', token: null });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await h.call({ method: 'GET' })).status, 405);
  assert.equal(h.stats().auth, 0);
  assertNoDatabase(h);
});

test('history uses a bounded descending keyset scoped to category and notification', async () => {
  const fixtures = [
    ...Array.from({ length: 23 }, (_, i) => review(i + 1)),
    review(24, { categorie: 'emails_programmes' }), review(25, { notification_id: 2 }),
  ];
  const before = JSON.stringify(fixtures), h = harness({ history: fixtures });
  const first = await h.call();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepEqual(first.data.reviews.map(row => row.id), Array.from({ length: 20 }, (_, i) => 23 - i));
  assert.equal(first.data.has_more, true);
  assert.equal(first.data.next_before_id, 4);
  const next = await h.call({ body: { ...historyBody, before_id: first.data.next_before_id } });
  assert.deepEqual(next.data.reviews.map(row => row.id), [3, 2, 1]);
  assert.equal(next.data.has_more, false);
  assert.equal(next.data.next_before_id, null);
  assert.equal(JSON.stringify(fixtures), before, 'history must not mutate its source');
  assert.deepEqual(h.queries.map(q => q.limit), [21, 21]);
  assert.deepEqual(h.queries[1].before, { column: 'id', value: 4 });
  assert.deepEqual(h.queries[0].order, { column: 'id', ascending: false });
  assert.ok(h.queries.every(q => !q.columns.includes('*') && !q.columns.includes('destinataire') && !q.columns.includes('body')));
  assert.equal(h.stats().rpcs, 0);
  assert.equal(h.stats().writes, 0);
});

test('an empty history is distinct from an unavailable history', async () => {
  const result = await harness().call();
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { reviews: [], has_more: false, next_before_id: null });
  for (const historyData of [null, {}, [review(Number.MAX_SAFE_INTEGER + 1)], [review(1, { previous_review_id: -1 })], [null]]) {
    const h = harness({ historyData });
    assert.equal((await h.call()).status, 503);
    assert.equal(h.stats().writes, 0);
  }
});

test('history validates its cursor and rejects extra client fields before database use', async () => {
  const invalid = [null, [], [historyBody], false, {},
    { ...historyBody, action: 'send' }, { ...historyBody, categorie: 'anything' },
    ...[0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1].map(notification_id => ({ ...historyBody, notification_id })),
    ...[0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1].map(before_id => ({ ...historyBody, before_id })),
    { ...historyBody, actor: ACTOR }, { ...historyBody, offset: 20 },
  ];
  const h = harness();
  for (const body of invalid) assert.equal((await h.call({ body })).status, 400, JSON.stringify(body));
  assert.equal((await h.call({ rawBody: '{broken' })).status, 400);
  assertNoDatabase(h);
});

test('record invokes only the journal RPC with the verified server actor and exact observed timestamp', async () => {
  const h = harness(), result = await h.call({ body: { ...recordBody, note: ' \n Vérification effectuée\t ' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { review: review(1) });
  assert.deepEqual(h.rpcCalls, [{ name: RPC, args: {
    p_request_id: REQUEST, p_categorie: 'achats', p_notification_id: 1,
    p_expected_state: 'failed', p_expected_attempted_at: '2026-11-18T12:00:00.123456+01:00',
    p_expected_last_review_id: 0, p_decision: 'verification_effectuee',
    p_note: 'Vérification effectuée', p_actor_id: ACTOR,
  } }]);
  assert.deepEqual(h.events, ['auth:valid-user-jwt', 'service', 'rpc']);
  assert.equal(h.stats().reads, 0);
  assert.equal(h.stats().writes, 0);
});

test('clients cannot supply the actor, recorded time, or stored previous review field', async () => {
  for (const key of ['actor', 'actor_id', 'p_actor_id', 'recorded_by', 'recorded_at', 'previous_review_id']) {
    const h = harness(), result = await h.call({ body: { ...recordBody, [key]: ACTOR } });
    assert.equal(result.status, 400, key);
    assertNoDatabase(h);
  }
});

test('record rejects malformed identifiers, decisions, notes and timestamps before the RPC', async () => {
  const invalid = [
    ...[undefined, null, '', 'not-a-uuid', 12].map(request_id => ({ ...recordBody, request_id })),
    ...[undefined, null, 'resent', 0].map(expected_state => ({ ...recordBody, expected_state })),
    ...[undefined, -1, 1.5, '0', null, Number.MAX_SAFE_INTEGER + 1].map(expected_last_review_id => ({ ...recordBody, expected_last_review_id })),
    ...[undefined, null, 'resend', 'approved', false].map(decision => ({ ...recordBody, decision })),
    ...[undefined, null, ' ', '\t\n', 'ab', 'x'.repeat(1001), '\0abc', 123].map(note => ({ ...recordBody, note })),
    ...[undefined, 'not-a-date', '2026-11-18', '2026-02-30T12:00:00Z', '0000-01-01T00:00:00Z',
      '2026-13-18T12:00:00Z', '2026-11-18T24:00:00Z', '2026-11-18T12:00:00.1234567Z',
      '2026-11-18T12:00:00', 0, {}].map(expected_attempted_at => ({ ...recordBody, expected_attempted_at })),
  ];
  const h = harness();
  for (const body of invalid) assert.equal((await h.call({ body })).status, 400, JSON.stringify(body));
  assertNoDatabase(h);
});

test('nullable attempts and Unicode notes within the character bound remain valid', async () => {
  const h = harness();
  for (const note of ['abc', '😀'.repeat(1000)]) {
    const result = await h.call({ body: { ...recordBody, note, expected_attempted_at: null } });
    assert.equal(result.status, 200);
    const args = h.rpcCalls.at(-1).args;
    assert.equal(args.p_note, note);
    assert.equal(args.p_expected_attempted_at, null);
  }
  const result = await h.call({ body: { ...recordBody, note: '😀'.repeat(1001) } });
  assert.equal(result.status, 400);
  assert.equal(h.stats().rpcs, 2);
});

test('the database revalidates known delivery states and reports actionable conflicts', async () => {
  for (const expected_state of ['pending', 'sending', 'accepted', 'failed', 'uncertain']) {
    const h = harness({ rpcError: { code: 'PT409', message: 'private source state detail' } });
    const result = await h.call({ body: { ...recordBody, expected_state } });
    assert.equal(result.status, 409);
    assert.match(result.data.error, /Actualisez/);
    assert.equal(result.data.review, undefined);
    assert.equal(h.rpcCalls[0].args.p_expected_state, expected_state);
    assert.doesNotMatch(JSON.stringify(result.data), /private/);
  }
});

test('SQL conflicts, missing rows and invalid parameters have stable sanitized HTTP statuses', async () => {
  for (const [code, status] of [['PT409', 409], ['PT404', 404], ['22023', 400], ['22P02', 400], ['22007', 400], ['22008', 400], ['42501', 503], ['XX000', 503]]) {
    const h = harness({ rpcError: { code, message: 'private SQL detail', details: 'secret', hint: 'secret' } });
    const result = await h.call({ body: recordBody });
    assert.equal(result.status, status, code);
    assert.deepEqual(Object.keys(result.data), ['error']);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(JSON.stringify(result.data), /private|secret/);
    assert.doesNotMatch(JSON.stringify(h.logs), /private|secret/);
    assert.equal(h.stats().writes, 0);
  }
  const h = harness({ historyError: { code: '42501', message: 'private journal data' } });
  assert.equal((await h.call()).status, 503);
  assert.equal(h.stats().rpcs, 0);
});

test('malformed RPC rows fail closed instead of reporting a saved decision', async () => {
  for (const rpcData of [null, {}, [], [review(1), review(2)], [null],
    [review(Number.MAX_SAFE_INTEGER + 1)], [review(1, { notification_id: '1' })],
    [review(1, { previous_review_id: Number.MAX_SAFE_INTEGER + 1 })]]) {
    const h = harness({ rpcData }), result = await h.call({ body: recordBody });
    assert.equal(result.status, 503);
    assert.equal(result.data.review, undefined);
  }
});

test('unavailable configuration and unexpected failures do not expose credentials or private errors', async () => {
  for (const missingEnv of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const h = harness({ missingEnv }), result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(h.stats().auth, 0);
    assertNoDatabase(h);
  }
  for (const setup of [{ authThrows: true }, { historyThrows: true }, { rpcThrows: true }]) {
    const h = harness(setup), result = await h.call({ body: setup.rpcThrows ? recordBody : historyBody });
    assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(result.data), /private|sensitive|secret/);
    assert.doesNotMatch(JSON.stringify(h.logs), /private|sensitive|secret/);
    assert.equal(h.stats().writes, 0);
    if (setup.authThrows) assertNoDatabase(h);
  }
});
