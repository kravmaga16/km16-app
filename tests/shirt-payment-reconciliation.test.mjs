// Run the deployed reconciliation handler offline: every HTTP request is intercepted.
// The companion PostgreSQL tests exercise the real claim, grants and email triggers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShirtPaymentHandler } from '../supabase/functions/km16-reconcile-shirt-payments/handler.mjs';

const TOKEN = 'a'.repeat(64);
const BASE = 'https://project.example.invalid';
const makeOrder = (number = 1, overrides = {}) => ({
  id: `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`,
  stripe_session_id: 'cs_live_fixture' + number,
  amount_cents: 1800, livemode: true, ...overrides,
});
const makeSession = order => ({
  id: order.stripe_session_id, livemode: true, mode: 'payment',
  status: 'complete', payment_status: 'paid', amount_total: order.amount_cents, currency: 'eur',
  metadata: { km16_source: 'km16-shirts-v1', km16_shirt_order: order.id },
  payment_intent: {
    id: 'pi_fixture', livemode: true, status: 'succeeded', currency: 'eur',
    amount: order.amount_cents, amount_received: order.amount_cents,
    metadata: { km16_source: 'km16-shirts-v1', km16_shirt_order: order.id },
    latest_charge: {
      id: 'ch_fixture', payment_intent: 'pi_fixture', livemode: true, currency: 'eur',
      amount: order.amount_cents, amount_captured: order.amount_cents,
      paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false,
    },
  },
});
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

function harness(options = {}) {
  const orders = options.orders ?? [makeOrder()];
  const sessions = new Map(orders.map(order => [order.stripe_session_id, makeSession(order)]));
  for (const [id, session] of Object.entries(options.sessions || {})) sessions.set(id, session);
  const states = new Map(orders.map(order => [order.id, 'pending']));
  const env = {
    SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'private-fixture-key',
    KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY: 'sk_live_fixture_not_real', ...options.env,
  };
  const calls = [], mutations = [];
  let active = 0, maximumActive = 0;
  const fetcher = async (url, init) => {
    active++; maximumActive = Math.max(maximumActive, active);
    try {
      assert.ok(init.signal instanceof AbortSignal, 'every outbound request must have a deadline');
      calls.push({ url, method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
      if (url === BASE + '/rest/v1/km16_automation_settings?select=token,enabled&id=eq.1') {
        assert.equal(init.method, 'GET');
        return json([{ enabled: true, token: TOKEN, ...options.settings }], options.settingsStatus || 200);
      }
      if (url === BASE + '/rest/v1/rpc/km16_claim_shirt_payment_checks') {
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(init.body), { p_limit: 8 });
        return json(options.claimResponse ?? orders, options.claimStatus || 200);
      }
      if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/')) {
        assert.equal(init.method, 'GET', 'the worker must never create or modify a Stripe payment');
        assert.equal(init.headers.Authorization, 'Bearer sk_live_fixture_not_real');
        assert.equal(init.headers['Stripe-Version'], '2026-11-18.endive');
        assert.equal(init.headers.apikey, undefined, 'Supabase keys must never reach Stripe');
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get('expand[]'), 'payment_intent.latest_charge');
        const id = parsed.pathname.split('/').at(-1);
        if (options.delayStripe) await new Promise(resolve => setImmediate(resolve));
        if (options.stripeErrors?.includes(id)) return json({ error: 'sensitive Stripe details' }, 500);
        if (options.stripeThrows?.includes(id)) throw Error('private API response containing credentials');
        assert.ok(sessions.has(id));
        return json(sessions.get(id));
      }
      if (url.startsWith(BASE + '/rest/v1/km16_shirt_orders?')) {
        assert.equal(init.method, 'PATCH');
        const filters = new URL(url).searchParams;
        const id = filters.get('id').slice(3);
        const order = orders.find(candidate => candidate.id === id);
        assert.equal(filters.get('stripe_session_id'), 'eq.' + order.stripe_session_id);
        assert.equal(filters.get('status'), 'eq.pending');
        assert.equal(filters.get('livemode'), 'eq.true');
        assert.equal(filters.get('select'), 'id,status');
        assert.equal(init.headers.Prefer, 'return=representation');
        const change = JSON.parse(init.body);
        assert.deepEqual(Object.keys(change), ['status']);
        if (options.patchError) return json({ error: 'private database details' }, 500);
        if (options.updateResponse) return json(options.updateResponse);
        if (states.get(id) !== 'pending') return json([]);
        states.set(id, change.status);
        mutations.push({ id, ...change });
        return json([{ id, status: change.status }]);
      }
      throw Error('Unexpected network request: ' + new URL(url).origin);
    } finally { active--; }
  };
  const handler = createShirtPaymentHandler({ env: name => env[name], fetcher, ...options.dependencies });
  return {
    calls, mutations, states, sessions,
    get maximumActive() { return maximumActive; },
    async call({ method = 'POST', token = TOKEN, body = {}, headers = {} } = {}) {
      const response = await handler(new Request(BASE + '/functions/v1/km16-reconcile-shirt-payments', {
        method,
        headers: { ...(token === null ? {} : { 'x-km16-automation': token }), ...headers },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      }));
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}

test('only the automation token can reserve work; GET, browser preflight and bearer JWT cannot', async () => {
  for (const request of [{ method: 'GET' }, { method: 'OPTIONS' }, { token: null },
    { token: null, headers: { Authorization: 'Bearer ordinary-user-jwt' } }, { token: 'x'.repeat(513) }]) {
    const h = harness();
    const result = await h.call(request);
    assert.ok([403, 405].includes(result.status));
    assert.equal(h.calls.length, 0);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('a wrong token and disabled automation stop before claim or Stripe', async () => {
  for (const options of [{}, { settings: { enabled: false } }]) {
    const h = harness(options);
    const result = await h.call({ token: options.settings ? TOKEN : 'b'.repeat(64) });
    assert.equal(result.status, 403);
    assert.equal(h.calls.length, 1);
    assert.equal(h.mutations.length, 0);
  }
});

test('missing or test Stripe key cannot consume a claim', async () => {
  for (const key of ['', 'sk_test_fixture']) {
    const h = harness({ env: { KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY: key } });
    assert.equal((await h.call()).status, 503);
    assert.equal(h.calls.length, 1);
  }
});

test('empty batch does not contact Stripe or send any mail', async () => {
  const h = harness({ orders: [] });
  const result = await h.call();
  assert.equal(result.status, 200);
  assert.equal(result.body.checked, 0);
  assert.equal(h.calls.length, 2);
});

test('a verified live payment confirms the guarded row and returns only aggregate data', async () => {
  const h = harness();
  const result = await h.call();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, checked: 1, paid: 1, cancelled: 0, pending: 0, skipped: 0, failed: 0, errors: {} });
  assert.deepEqual(h.mutations, [{ id: makeOrder().id, status: 'paid' }]);
  assert.equal(h.calls.length, 4);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
});

test('a replay or concurrent browser confirmation cannot update the order twice', async () => {
  const h = harness();
  assert.equal((await h.call()).body.paid, 1);
  const replay = await h.call();
  assert.equal(replay.body.paid, 0);
  assert.equal(replay.body.skipped, 1);
  assert.equal(replay.body.errors.order_already_changed, 1);
  assert.equal(h.mutations.length, 1);
});

test('test orders and invalid claim identifiers never reach Stripe', async () => {
  for (const order of [makeOrder(1, { livemode: false }), makeOrder(1, { stripe_session_id: 'cs_test_fixture' }),
    makeOrder(1, { id: '../other-table' }), makeOrder(1, { amount_cents: 0 })]) {
    const h = harness({ orders: [order] });
    const result = await h.call();
    assert.equal(result.body.errors.invalid_order, 1);
    assert.equal(h.calls.length, 2);
    assert.equal(h.mutations.length, 0);
  }
});

test('Stripe identity, mode, currency, source and amount must match the claimed order', async () => {
  const order = makeOrder();
  const changes = [
    { id: 'cs_live_other' }, { livemode: false }, { mode: 'subscription' }, { currency: 'usd' },
    { amount_total: 3000 }, { metadata: { km16_source: 'unrelated', km16_shirt_order: order.id } },
    { metadata: { km16_source: 'km16-shirts-v1', km16_shirt_order: makeOrder(2).id } },
  ];
  for (const change of changes) {
    const h = harness({ sessions: { [order.stripe_session_id]: { ...makeSession(order), ...change } } });
    const result = await h.call();
    assert.equal(result.body.errors.session_mismatch, 1);
    assert.equal(h.mutations.length, 0);
  }
});

test('expired unpaid sessions are cancelled; open and not-yet-paid sessions remain pending', async () => {
  const order = makeOrder();
  for (const [status, payment_status, expected] of [
    ['expired', 'unpaid', 'cancelled'], ['open', 'unpaid', 'pending'], ['complete', 'unpaid', 'pending'],
  ]) {
    const session = { ...makeSession(order), status, payment_status, payment_intent: null };
    const h = harness({ sessions: { [order.stripe_session_id]: session } });
    const result = await h.call();
    assert.equal(result.body[expected], 1);
    assert.equal(h.mutations.length, expected === 'cancelled' ? 1 : 0);
  }
});

test('expanded payment and charge objects are required', async () => {
  const order = makeOrder();
  for (const missing of ['payment_intent', 'latest_charge']) {
    const session = makeSession(order);
    if (missing === 'payment_intent') session.payment_intent = 'pi_fixture';
    else session.payment_intent.latest_charge = 'ch_fixture';
    const h = harness({ sessions: { [order.stripe_session_id]: session } });
    const result = await h.call();
    assert.equal(result.body.errors.payment_unverified, 1);
    assert.equal(h.mutations.length, 0);
  }
});

test('refunded, partially refunded or disputed charges never create paid orders', async () => {
  const order = makeOrder();
  for (const change of [{ refunded: true }, { amount_refunded: 1 }, { disputed: true }]) {
    const session = makeSession(order);
    Object.assign(session.payment_intent.latest_charge, change);
    const h = harness({ sessions: { [order.stripe_session_id]: session } });
    const result = await h.call();
    assert.equal(result.body.errors.payment_refunded_or_disputed, 1);
    assert.equal(h.mutations.length, 0);
  }
});

test('an unsettled charge, mismatched intent or missing refund flags fails closed', async () => {
  const order = makeOrder();
  const mutations = [
    session => { session.payment_intent.status = 'processing'; },
    session => { session.payment_intent.latest_charge.captured = false; },
    session => { session.payment_intent.amount_received = 1; },
    session => { session.payment_intent.latest_charge.payment_intent = 'pi_other'; },
    session => { delete session.payment_intent.latest_charge.refunded; },
    session => { session.payment_intent.livemode = false; },
  ];
  for (const mutate of mutations) {
    const session = makeSession(order); mutate(session);
    const h = harness({ sessions: { [order.stripe_session_id]: session } });
    assert.equal((await h.call()).body.skipped, 1);
    assert.equal(h.mutations.length, 0);
  }
});

test('a Stripe failure does not prevent other orders being confirmed', async () => {
  const orders = [makeOrder(1), makeOrder(2)];
  for (const errorType of ['stripeErrors', 'stripeThrows']) {
    const h = harness({ orders, [errorType]: [orders[0].stripe_session_id] });
    const result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(result.body.failed, 1);
    assert.equal(result.body.paid, 1);
    assert.equal(result.body.errors.stripe_unavailable, 1);
    assert.equal(h.mutations.length, 1);
    assert.equal(h.mutations[0].id, orders[1].id);
    assert.doesNotMatch(JSON.stringify(result.body), /private|sensitive|fixture|sk_live/);
  }
});

test('database failures and invalid PATCH results are not reported as successful payments', async () => {
  for (const options of [{ patchError: true }, { updateResponse: [{ id: 'wrong', status: 'paid' }] }]) {
    const h = harness(options);
    const result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(result.body.failed, 1);
    assert.equal(result.body.paid, 0);
    assert.equal(h.mutations.length, 0);
  }
});

test('caller-supplied orders and limits are ignored; the batch and concurrency remain bounded', async () => {
  const orders = Array.from({ length: 8 }, (_, i) => makeOrder(i + 1));
  const h = harness({ orders, delayStripe: true });
  const result = await h.call({ body: { p_limit: 9999, orders: [makeOrder(999)], action: 'sendMail' } });
  assert.equal(result.body.paid, 8);
  assert.equal(h.mutations.length, 8);
  assert.equal(h.maximumActive, 4);
  assert.equal(h.calls.filter(call => call.url.includes('api.stripe.com')).length, 8);
});

test('an oversized claim response is rejected before checking any order', async () => {
  const h = harness({ orders: Array.from({ length: 9 }, (_, i) => makeOrder(i + 1)) });
  const result = await h.call();
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'invalid_claim_response');
  assert.equal(h.calls.length, 2);
});

test('the overall time budget prevents starting Stripe requests once exhausted', async () => {
  let ticks = 0;
  const h = harness({ dependencies: { now: () => [0, 0, 0, 50_001][Math.min(ticks++, 3)] } });
  const result = await h.call();
  assert.equal(result.status, 503);
  assert.equal(result.body.errors.time_budget_exhausted, 1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.mutations.length, 0);
});
