// All HTTP and SMTP operations are intercepted. These tests never send a message,
// create a Stripe session, or contact Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  classifySession, reminderMessage, createCheckoutReminderHandler,
} from '../supabase/functions/km16-checkout-reminders/handler.mjs';

const APP = 'https://app.km16.fr';
const BASE = 'https://project.example.invalid';
const TOKEN = 'a'.repeat(64);
const SERVICE = 'service-fixture-not-real';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const uuid = (prefix, n = 1) => `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${String(n).padStart(12, '0')}`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const sourceFor = kind => ({
  membership: ['KM16_ADHESIONS_STRIPE_SECRET_KEY', 'km16-membership-v1', 'km16_order'],
  shirts: ['KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY', 'km16-shirts-v1', 'km16_shirt_order'],
  video: ['STRIPE_SECRET_KEY', 'km16-checkout-v1', 'km16_video_id'],
})[kind];

function attempt(kind = 'membership', n = 1, changes = {}) {
  return {
    id: uuid('1', n), lock_token: uuid('2', n), user_id: uuid('3', n),
    source_id: kind === 'video' ? 'shadow-boxing' : uuid('4', n),
    product_id: kind === 'membership' ? 'annual-fixture' : kind === 'video' ? 'shadow-boxing' : 'shirts',
    group_key: kind === 'membership' ? 'a'.repeat(64) : kind === 'video' ? 'shadow-boxing' : 'shirts',
    kind, email: `client${n}@example.invalid`, livemode: true,
    stripe_session_id: 'cs_live_fixture' + n, amount_cents: kind === 'shirts' ? 1800 : 999,
    total_cents: 999, currency: 'eur', title: 'Offre KM16 fixture', sizes: ['M'],
    opt_in: true, state: 'checking', created_at: '2026-11-18T12:00:00Z',
    due_at: '2026-11-19T12:00:00Z', ...changes,
  };
}
function session(row, changes = {}) {
  const source = sourceFor(row.kind);
  return {
    id: row.stripe_session_id, livemode: true, mode: 'payment', status: 'expired',
    payment_status: 'unpaid', currency: 'eur', amount_total: row.amount_cents,
    customer_email: row.email, customer_details: null,
    client_reference_id: row.kind === 'video' ? row.user_id : null,
    metadata: { km16_source: source[1], [source[2]]: row.source_id,
      ...(row.kind === 'video' ? { km16_user_id: row.user_id } : {}) },
    payment_intent: null, ...changes,
  };
}
function intent(row, changes = {}) {
  return {
    id: 'pi_fixture1', livemode: true, status: 'requires_payment_method',
    currency: 'eur', amount: row.amount_cents, amount_received: 0,
    metadata: session(row).metadata, latest_charge: null, ...changes,
  };
}
function charge(row, changes = {}) {
  return {
    id: 'ch_fixture1', payment_intent: 'pi_fixture1', livemode: true, currency: 'eur',
    amount: row.amount_cents, amount_captured: 0, paid: false, captured: false,
    refunded: false, amount_refunded: 0, disputed: false, ...changes,
  };
}

function harness(options = {}) {
  const rows = options.rows ?? [attempt()];
  const allAttempts = options.related ?? rows;
  const rowById = new Map(rows.filter(Boolean).map(row => [row.id, row]));
  const states = new Map(rows.filter(Boolean).map(row => [row.id, 'pending']));
  const stripeSessions = new Map();
  for (const row of Array.isArray(allAttempts) ? allAttempts : rows) {
    if (row && sourceFor(row.kind) && row.stripe_session_id) stripeSessions.set(row.stripe_session_id, session(row));
  }
  for (const [id, value] of Object.entries(options.sessions ?? {})) stripeSessions.set(id, value);
  const env = {
    SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    KM16_DOCUMENTS_SMTP_PASSWORD: 'smtp-fixture-not-real',
    KM16_ADHESIONS_STRIPE_SECRET_KEY: 'sk_live_membership_fixture',
    KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY: 'sk_live_shirts_fixture',
    STRIPE_SECRET_KEY: 'sk_live_video_fixture', ...options.env,
  };
  const calls = [], messages = [], finishes = [], preparations = [];
  let time = NOW, createMailerCount = 0, closeCount = 0, tokenNumber = 0;
  const cryptoImpl = {
    subtle: globalThis.crypto.subtle,
    getRandomValues: bytes => { bytes.fill(++tokenNumber); return bytes; },
  };
  const fetcher = async (url, init = {}) => {
    assert.ok(init.signal instanceof AbortSignal, 'outbound requests must have a deadline');
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = { url, path: parsed.pathname, method: init.method, body, headers: init.headers };
    calls.push(call);
    time += options.advance?.(call) || 0;
    if (parsed.origin === BASE) {
      assert.equal(init.headers.Authorization, 'Bearer ' + SERVICE);
      assert.equal(init.headers.apikey, SERVICE);
    }
    if (parsed.pathname === '/rest/v1/km16_automation_settings') {
      assert.equal(init.method, 'GET');
      return json([{ enabled: true, token: TOKEN, ...options.settings }], options.settingsStatus || 200);
    }
    if (parsed.pathname === '/rest/v1/rpc/km16_claim_checkout_reminders') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(body, { p_limit: 2 });
      if (Object.hasOwn(options, 'claimResponse')) return json(options.claimResponse, options.claimStatus || 200);
      const claimed = rows.filter(row => !row || states.get(row.id) === 'pending').slice(0, 2);
      for (const row of claimed) if (row) states.set(row.id, 'checking');
      return json(claimed, options.claimStatus || 200);
    }
    if (parsed.pathname.startsWith('/auth/v1/admin/users/')) {
      assert.equal(init.method, 'GET');
      const id = parsed.pathname.split('/').at(-1);
      const row = rows.find(value => value?.user_id === id);
      return json({ id, email: row?.email, email_confirmed_at: '2026-01-01T00:00:00Z',
        is_anonymous: false, ...options.user }, options.userStatus || 200);
    }
    if (parsed.origin === 'https://api.stripe.com') {
      assert.equal(init.method, 'GET', 'the worker must never create, charge or cancel a Stripe payment');
      assert.equal(init.headers.apikey, undefined, 'Supabase credentials must not reach Stripe');
      assert.equal(init.headers['Stripe-Version'], '2026-11-18.endive');
      assert.equal(parsed.searchParams.get('expand[]'), 'payment_intent.latest_charge');
      const id = parsed.pathname.split('/').at(-1);
      const row = (Array.isArray(allAttempts) ? allAttempts : rows).find(value => value?.stripe_session_id === id);
      assert.ok(row, 'Stripe session must belong to a claimed or related attempt');
      assert.equal(init.headers.Authorization, 'Bearer ' + env[sourceFor(row.kind)[0]]);
      if (options.stripeThrows?.includes(id)) throw Error('private Stripe response: do not expose');
      if (options.stripeErrors?.includes(id)) return json({ error: 'private Stripe details' }, 500);
      const value = stripeSessions.get(id);
      assert.ok(value, 'unexpected Stripe session');
      return json(typeof value === 'function' ? value(call) : value);
    }
    if (parsed.pathname === '/rest/v1/km16_checkout_reminders') {
      assert.equal(init.method, 'GET');
      assert.equal(parsed.searchParams.get('limit'), '21');
      assert.equal(parsed.searchParams.get('order'), 'created_at.desc');
      assert.equal(parsed.searchParams.get('livemode'), 'eq.true');
      assert.match(parsed.searchParams.get('group_key') || '', /^eq\..+/);
      if (options.relatedStatus) return json({}, options.relatedStatus);
      if (!Array.isArray(allAttempts)) return json(allAttempts);
      return json(options.unfilteredRelated ? allAttempts : allAttempts.filter(row => row &&
        'eq.' + row.user_id === parsed.searchParams.get('user_id') &&
        'eq.' + row.kind === parsed.searchParams.get('kind') &&
        (!parsed.searchParams.has('product_id') || 'eq.' + row.product_id === parsed.searchParams.get('product_id')) &&
        'eq.' + row.group_key === parsed.searchParams.get('group_key')));
    }
    if (parsed.pathname === '/rest/v1/rpc/km16_prepare_checkout_reminder_send') {
      assert.equal(init.method, 'POST');
      preparations.push(body);
      assert.match(body.p_token_hash, /^[0-9a-f]{64}$/);
      const row = rowById.get(body.p_id);
      assert.equal(body.p_lock_token, row.lock_token);
      if (options.prepareStatus) return json({ error: 'private database details' }, options.prepareStatus);
      if (options.prepareFalse || states.get(body.p_id) !== 'checking') return json(false);
      states.set(body.p_id, 'sending');
      return json(true);
    }
    if (parsed.pathname === '/rest/v1/rpc/km16_finish_checkout_reminder') {
      assert.equal(init.method, 'POST');
      finishes.push(body);
      const row = rowById.get(body.p_id);
      assert.equal(body.p_lock_token, row.lock_token);
      if (options.finishStatus) return json({ error: 'private database details' }, options.finishStatus);
      if (options.finishFalse) return json(false);
      states.set(body.p_id, body.p_state);
      return json(true);
    }
    if (parsed.pathname === '/rest/v1/rpc/km16_stop_checkout_reminders') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(Object.keys(body), ['p_token_hash']);
      return json(options.stopValue ?? true, options.stopStatus || 200);
    }
    throw Error('Unexpected outbound request: ' + parsed.origin + parsed.pathname);
  };
  const handler = createCheckoutReminderHandler({
    env: name => env[name], fetcher, cryptoImpl, now: () => time,
    createMailer: () => {
      createMailerCount++;
      if (options.createMailerError) throw options.createMailerError;
      let closed = false;
      return {
        async sendMail(message) {
          if (closed && options.rejectClosedMailer) throw Error('Closed SMTP transport');
          messages.push(message);
          if (options.smtpError) throw options.smtpError;
          if (options.smtpNeverResolves || options.smtpNeverResolvesAt?.includes(messages.length)) {
            return await new Promise(() => {});
          }
          return options.smtpResponse ?? { accepted: [message.to.address] };
        },
        close() { closed = true; closeCount++; if (options.closeThrows) throw Error('close failed'); },
      };
    },
    ...options.dependencies,
  });
  return {
    calls, messages, finishes, preparations, states, stripeSessions,
    get createMailerCount() { return createMailerCount; }, get closeCount() { return closeCount; },
    async call({ method = 'POST', token = TOKEN, origin, body = { action: 'work' }, rawBody, headers = {} } = {}) {
      const response = await handler(new Request(BASE + '/functions/v1/km16-checkout-reminders', {
        method,
        headers: { ...(token === null ? {} : { 'x-km16-automation': token }),
          ...(origin === undefined ? {} : { origin }), ...headers },
        ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(body) } : {}),
      }));
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
    },
  };
}

test('work requires a valid automation token; browser preflight, GET and user JWT cannot claim', async () => {
  for (const request of [
    { method: 'GET' }, { method: 'OPTIONS', origin: APP }, { token: null },
    { token: 'short' }, { token: 'x'.repeat(513) },
    { token: null, headers: { Authorization: 'Bearer user-jwt' } },
    { origin: 'https://attacker.example.invalid' },
  ]) {
    const h = harness();
    const result = await h.call(request);
    assert.ok([204, 403, 405].includes(result.status));
    assert.equal(h.calls.length, 0);
    assert.equal(h.messages.length, 0);
    if (request.origin !== APP) assert.equal(result.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('wrong token or disabled automation stops before claiming; service credentials never reach the response', async () => {
  for (const options of [{}, { settings: { enabled: false } }, { settings: { token: 'short' } }]) {
    const h = harness(options);
    const result = await h.call({ token: Object.keys(options).length ? TOKEN : 'b'.repeat(64) });
    assert.equal(result.status, 403);
    assert.equal(h.calls.length, 1);
    assert.equal(h.messages.length, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /fixture|client|service|sk_live/);
  }
});

test('malformed, oversized and unknown requests have no effects', async () => {
  for (const request of [
    { rawBody: '{' }, { rawBody: 'x'.repeat(2049) }, { body: [] }, { body: null },
    { body: { action: 'send arbitrary mail', to: 'someone@example.invalid' } },
  ]) {
    const h = harness();
    assert.equal((await h.call(request)).status, 400);
    assert.equal(h.calls.length, 0);
    assert.equal(h.messages.length, 0);
  }
});

test('required configuration is checked before a claim and missing live Stripe keys never send', async () => {
  for (const env of [{ SUPABASE_URL: '' }, { SUPABASE_URL: 'http://unsafe.invalid' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
    const h = harness({ env });
    assert.equal((await h.call()).status, 503);
    assert.equal(h.calls.length, 0);
  }
  const smtp = harness({ env: { KM16_DOCUMENTS_SMTP_PASSWORD: '' } });
  assert.equal((await smtp.call()).status, 503);
  assert.equal(smtp.calls.length, 1);
  for (const kind of ['membership', 'shirts', 'video']) {
    for (const value of ['', 'sk_test_fixture']) {
      const h = harness({ rows: [attempt(kind)], env: { [sourceFor(kind)[0]]: value } });
      const result = await h.call();
      assert.equal(result.status, 503);
      assert.equal(result.body.errors.stripe_unavailable, 1);
      assert.equal(h.calls.some(call => call.url.startsWith('https://api.stripe.com')), false);
      assert.equal(h.messages.length, 0);
    }
  }
});

test('zero jobs does not create a mailer or contact Auth/Stripe', async () => {
  const h = harness({ rows: [] });
  const result = await h.call();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, claimed: 0, accepted: 0, failed: 0,
    uncertain: 0, skipped: 0, deferred: 0, errors: {} });
  assert.equal(h.calls.length, 2);
  assert.equal(h.createMailerCount, 0);
});

test('the claim batch is bounded and caller-supplied targets/limits cannot choose recipients', async () => {
  for (const claimResponse of [null, {}, [attempt(), attempt('shirts', 2), attempt('video', 3)]]) {
    const h = harness({ claimResponse });
    const result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(result.body.error, 'invalid_claim_response');
    assert.equal(h.messages.length, 0);
  }
  const h = harness();
  assert.equal((await h.call({ body: { action: 'work', p_limit: 10000, to: 'attacker@example.invalid', rows: [] } })).status, 200);
  assert.equal(h.messages[0].to.address, 'client1@example.invalid');
});

for (const kind of ['membership', 'shirts', 'video']) {
  test(kind + ': valid abandonment sends one message with the correct app resume link and a hashed unsubscribe token', async () => {
    const row = attempt(kind, 1, { sizes: ['M', 'XL'] });
    const h = harness({ rows: [row] });
    const result = await h.call();
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, 1);
    assert.equal(h.messages.length, 1);
    const message = h.messages[0];
    assert.deepEqual(message.from, { name: 'KM16', address: 'contact@km16.fr' });
    assert.equal(message.to.address, row.email);
    assert.equal(message.replyTo, 'contact@km16.fr');
    assert.equal(message.disableFileAccess, true);
    assert.equal(message.disableUrlAccess, true);
    assert.equal(message.messageId, '<km16-checkout-reminder-' + row.id + '@km16.fr>');
    const expected = kind === 'membership' ? APP + '/adhesion.html?espace=1&order=' + row.source_id
      : kind === 'shirts' ? APP + '/tee-shirts.html?sizes=M,XL' : APP + '/#videos';
    assert.ok(message.text.includes(expected));
    assert.equal(message.text.includes('checkout.stripe.com'), false, 'expired Stripe links must never be emailed');
    const rawToken = message.text.match(/checkout-reminder-stop\.html#([0-9a-f]{64})/)[1];
    assert.equal(h.preparations[0].p_token_hash, createHash('sha256').update(rawToken).digest('hex'));
    assert.notEqual(h.preparations[0].p_token_hash, rawToken);
    assert.equal(h.calls.some(call => JSON.stringify(call.body ?? {}).includes(rawToken)), false);
    assert.equal(h.finishes.at(-1).p_state, 'accepted');
    assert.equal(h.closeCount, 1);
    assert.equal((await h.call()).body.claimed, 0, 'a terminal attempt cannot be sent twice');
    assert.equal(h.messages.length, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /client1|fixture|@|token|cs_live/);
  });
}

test('unconfirmed, anonymous, banned, deleted or changed recipients are skipped before Stripe and SMTP', async () => {
  for (const options of [
    { user: { email_confirmed_at: null } }, { user: { is_anonymous: true } },
    { user: { email: 'different@example.invalid' } }, { user: { id: uuid('9') } },
    { user: { banned_until: '2099-01-01T00:00:00Z' } }, { userStatus: 404 },
  ]) {
    const h = harness(options);
    const result = await h.call();
    assert.equal(result.body.skipped, 1);
    assert.equal(h.finishes[0].p_error, 'identity_changed');
    assert.equal(h.calls.some(call => call.url.startsWith('https://api.stripe.com')), false);
    assert.equal(h.messages.length, 0);
  }
  const h = harness({ userStatus: 500 });
  assert.equal((await h.call()).body.errors.identity_unavailable, 1);
  assert.equal(h.messages.length, 0);
});

test('claim row validation rejects non-consenting, test, malformed and unclaimed attempts', async () => {
  for (const change of [
    { opt_in: false }, { opt_in: 'true' }, { livemode: false }, { state: 'accepted' },
    { id: 'not-a-uuid' }, { lock_token: 'wrong' }, { user_id: 'wrong' },
    { stripe_session_id: 'cs_test_fixture' }, { email: 'a@b.invalid\r\nBcc:x@y.invalid' },
    { email: 'UPPER@example.invalid' }, { amount_cents: 0 }, { group_key: undefined },
  ]) {
    const h = harness({ rows: [attempt('membership', 1, change)] });
    const result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(result.body.errors.invalid_claim_row, 1);
    assert.equal(h.messages.length, 0);
    assert.equal(h.calls.some(call => call.url.startsWith('https://api.stripe.com')), false);
  }
});

test('Stripe session identity, customer, source, mode, amount and currency traps fail closed', async () => {
  const row = attempt();
  for (const change of [
    { id: 'cs_live_other' }, { livemode: false }, { mode: 'subscription' },
    { currency: 'usd' }, { amount_total: 1 }, { metadata: {} },
    { metadata: { km16_source: 'other', km16_order: row.source_id } },
    { metadata: { km16_source: 'km16-membership-v1', km16_order: uuid('9') } },
    { customer_email: 'other@example.invalid' }, { customer_details: { email: 'other@example.invalid' } },
  ]) {
    const h = harness({ rows: [row], sessions: { [row.stripe_session_id]: session(row, change) } });
    const result = await h.call();
    assert.equal(result.body.skipped, 1);
    assert.equal(h.finishes[0].p_error, 'stripe_session_mismatch');
    assert.equal(h.messages.length, 0);
  }
  const video = attempt('video');
  for (const change of [
    { client_reference_id: uuid('9') },
    { metadata: { ...session(video).metadata, km16_user_id: uuid('9') } },
  ]) {
    assert.equal(classifySession(video, session(video, change)).state, 'skipped');
  }
});

test('paid, complete and no-payment-required sessions are suppressed; open sessions remain deferred', async () => {
  const row = attempt();
  for (const [change, expected] of [
    [{ status: 'complete', payment_status: 'paid' }, 'skipped'],
    [{ status: 'complete', payment_status: 'unpaid' }, 'skipped'],
    [{ payment_status: 'no_payment_required' }, 'skipped'],
    [{ status: 'open' }, 'deferred'],
    [{ status: 'unexpected' }, 'deferred'],
  ]) {
    const h = harness({ rows: [row], sessions: { [row.stripe_session_id]: session(row, change) } });
    const result = await h.call();
    assert.equal(result.body[expected], 1);
    assert.equal(h.messages.length, 0);
  }
});

test('PaymentIntent paid, processing, capture, action and unknown states cannot be treated as abandonment', () => {
  const row = attempt();
  for (const [change, expected] of [
    [{ status: 'succeeded', amount_received: row.amount_cents }, 'skipped'],
    [{ amount_received: 1 }, 'skipped'],
    [{ status: 'processing' }, 'pending'], [{ status: 'requires_capture' }, 'pending'],
    [{ status: 'requires_action' }, 'pending'], [{ status: 'requires_confirmation' }, 'pending'],
    [{ status: 'unknown' }, 'pending'], [{ amount_received: undefined }, 'pending'],
    [{ livemode: false }, 'pending'], [{ amount: 1 }, 'pending'], [{ currency: 'usd' }, 'pending'],
  ]) {
    assert.equal(classifySession(row, session(row, { payment_intent: intent(row, change) })).state, expected);
  }
  for (const payment_intent of ['pi_unexpanded', undefined, {}]) {
    assert.equal(classifySession(row, session(row, { payment_intent })).state, 'pending');
  }
  for (const status of ['canceled', 'requires_payment_method']) {
    assert.equal(classifySession(row, session(row, { payment_intent: intent(row, { status }) })).state, 'eligible');
  }
});

test('charges must be explicitly unpaid, not refunded/disputed and complete enough to verify', () => {
  const row = attempt();
  for (const change of [{ paid: true }, { refunded: true }, { amount_refunded: 1 }, { disputed: true }]) {
    assert.equal(classifySession(row, session(row, { payment_intent: intent(row, { latest_charge: charge(row, change) }) })).state, 'skipped');
  }
  for (const change of [
    { paid: undefined }, { refunded: undefined }, { disputed: undefined }, { amount_refunded: undefined },
    { id: undefined }, { amount: undefined }, { amount_captured: undefined }, { captured: undefined },
    { id: 'wrong' }, { amount: 1 }, { currency: 'usd' }, { livemode: false }, { payment_intent: 'pi_other' },
  ]) {
    assert.notEqual(classifySession(row, session(row, { payment_intent: intent(row, { latest_charge: charge(row, change) }) })).state,
      'eligible', JSON.stringify(change));
  }
  assert.equal(classifySession(row, session(row, { payment_intent: intent(row, { latest_charge: charge(row) }) })).state, 'eligible');
  assert.equal(classifySession(row, session(row, { payment_intent: intent(row, { latest_charge: 'ch_unexpanded' }) })).state, 'pending');
});

test('a paid related session suppresses the older attempt even before its webhook arrives', async () => {
  const row = attempt('video');
  const paid = attempt('video', 2, { user_id: row.user_id, email: row.email, opt_in: false });
  const h = harness({ rows: [row], related: [row, paid],
    sessions: { [paid.stripe_session_id]: session(paid, { status: 'complete', payment_status: 'paid' }) } });
  const result = await h.call();
  assert.equal(result.body.skipped, 1);
  assert.equal(h.messages.length, 0);
  assert.equal(h.calls.filter(call => call.url.startsWith('https://api.stripe.com')).length, 2);
});

test('payment for another child on the same account and product does not suppress this child’s reminder', async () => {
  const row = attempt('membership');
  const sibling = attempt('membership', 2, {
    user_id: row.user_id, email: row.email, product_id: row.product_id, group_key: 'b'.repeat(64),
  });
  const h = harness({ rows: [row], related: [row, sibling],
    sessions: { [sibling.stripe_session_id]: session(sibling, { status: 'complete', payment_status: 'paid' }) } });
  const result = await h.call();
  assert.equal(result.body.accepted, 1);
  assert.equal(h.messages.length, 1);
  const query = new URL(h.calls.find(call => call.path === '/rest/v1/km16_checkout_reminders').url);
  assert.equal(query.searchParams.get('group_key'), 'eq.' + row.group_key);
  assert.equal(h.calls.some(call => call.url.includes(sibling.stripe_session_id)), false);
});

test('a related open/processing session defers the older reminder; unverifiable related data never sends', async () => {
  const row = attempt('shirts');
  const other = attempt('shirts', 2, { user_id: row.user_id, email: row.email });
  for (const change of [ { status: 'open' }, { payment_intent: intent(other, { status: 'processing' }) } ]) {
    const h = harness({ rows: [row], related: [row, other], sessions: { [other.stripe_session_id]: session(other, change) } });
    assert.equal((await h.call()).body.deferred, 1);
    assert.equal(h.messages.length, 0);
  }
  for (const related of [[], {}, [row, { ...other, stripe_session_id: null }],
    Array.from({ length: 21 }, (_, i) => ({ ...row, id: i === 0 ? row.id : uuid('5', i) }))]) {
    const h = harness({ rows: [row], related });
    assert.equal((await h.call()).status, 503);
    assert.equal(h.messages.length, 0);
  }
});

test('Stripe errors defer safely and return aggregate codes without provider details', async () => {
  const row = attempt();
  for (const options of [{ stripeErrors: [row.stripe_session_id] }, { stripeThrows: [row.stripe_session_id] }]) {
    const h = harness({ rows: [row], ...options });
    const result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(result.body.errors.stripe_unavailable, 1);
    assert.equal(h.finishes[0].p_state, 'pending');
    assert.equal(h.messages.length, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /private|client1|fixture|sk_live/);
  }
});

test('atomic prepare false stops before SMTP; a prepare error also cannot send', async () => {
  for (const options of [{ prepareFalse: true }, { prepareStatus: 500 }]) {
    const h = harness(options);
    const result = await h.call();
    assert.equal(h.messages.length, 0);
    assert.equal(h.createMailerCount, 0);
    assert.equal(result.status, options.prepareStatus ? 503 : 200);
    assert.equal(h.preparations.length, 1);
  }
});

test('definitive SMTP refusals are terminal failed; transport uncertainty is terminal uncertain', async () => {
  for (const [smtpError, expected] of [
    [{ responseCode: 550 }, 'failed'], [{ responseCode: 450 }, 'failed'],
    [{ code: 'EAUTH' }, 'failed'], [{ code: 'EDNS' }, 'failed'], [{ code: 'ECONNECTION' }, 'failed'],
    [{ code: 'ETIMEDOUT' }, 'uncertain'], [Error('sensitive SMTP details'), 'uncertain'],
  ]) {
    const h = harness({ smtpError });
    const result = await h.call();
    assert.equal(result.body[expected], 1);
    assert.equal(h.finishes.at(-1).p_state, expected);
    assert.equal(h.messages.length, 1);
    assert.equal((await h.call()).body.claimed, 0);
    assert.equal(h.messages.length, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /sensitive|SMTP details|client1|fixture/);
  }
});

test('SMTP acceptance must name the intended recipient; another recipient or an empty result is a failure', async () => {
  for (const smtpResponse of [{ accepted: [] }, {}, { accepted: ['different@example.invalid'] }]) {
    const h = harness({ smtpResponse });
    assert.equal((await h.call()).body.failed, 1);
    assert.equal(h.finishes[0].p_error, 'smtp_rejected');
  }
  const h = harness({ smtpResponse: { accepted: [{ address: 'CLIENT1@example.invalid' }] } });
  assert.equal((await h.call()).body.accepted, 1);
});

test('SMTP success followed by persistence failure cannot be resent or reported accepted', async () => {
  for (const options of [{ finishStatus: 500 }, { finishFalse: true }]) {
    const h = harness(options);
    const result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(result.body.accepted, 0);
    assert.equal(result.body.uncertain, 1);
    assert.equal(h.states.get(attempt().id), 'sending');
    assert.equal((await h.call()).body.claimed, 0);
    assert.equal(h.messages.length, 1);
  }
});

test('unverified skipped/pending persistence is reported, not counted as completed work', async () => {
  const row = attempt();
  for (const change of [{ status: 'open' }, { status: 'complete', payment_status: 'paid' }]) {
    const h = harness({ rows: [row], finishFalse: true, sessions: { [row.stripe_session_id]: session(row, change) } });
    const result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(h.messages.length, 0);
    assert.equal(result.body.skipped, 0);
  }
});

test('bad product title or invalid shirt sizes cannot create an untrusted link or reach SMTP', async () => {
  for (const row of [attempt('membership', 1, { title: '' }), attempt('shirts', 1, { sizes: ['M', '../evil'] }),
    attempt('membership', 1, { source_id: 'https://attacker.invalid/' })]) {
    const h = harness({ rows: [row] });
    assert.equal((await h.call()).status, 503);
    assert.equal(h.messages.length, 0);
    assert.equal(h.preparations.length, 0);
  }
  const msg = reminderMessage(attempt('video', 1, { title: 'Hello\r\nBcc: evil\tvalue' }), 'f'.repeat(64));
  assert.equal(msg.subject, 'KM16 — souhaitez-vous reprendre votre demande ?');
  assert.ok(msg.text.includes('Hello  Bcc: evil value'));
});

test('unsubscribe accepts an opaque token without a login and passes only its hash to SQL', async () => {
  const raw = 'f'.repeat(64);
  const h = harness({ env: { KM16_DOCUMENTS_SMTP_PASSWORD: '' } });
  const result = await h.call({ token: null, origin: APP, body: { action: 'unsubscribe', token: raw, email: 'ignored@example.invalid' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), APP);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].body, { p_token_hash: createHash('sha256').update(raw).digest('hex') });
  assert.equal(JSON.stringify(h.calls).includes(raw), false);
  assert.equal(h.messages.length, 0);
});

test('bad unsubscribe token, GET and hostile origins have no effects; unknown tokens do not enumerate recipients', async () => {
  for (const token of ['', 'short', 'g'.repeat(64), 'F'.repeat(64), 'a'.repeat(65)]) {
    const h = harness();
    assert.equal((await h.call({ token: null, body: { action: 'unsubscribe', token } })).status, 400);
    assert.equal(h.calls.length, 0);
  }
  const unknown = harness();
  assert.deepEqual((await unknown.call({ token: null, body: { action: 'unsubscribe', token: 'b'.repeat(64) } })).body, { ok: true });
  const unavailable = harness({ stopStatus: 500 });
  assert.equal((await unavailable.call({ token: null, body: { action: 'unsubscribe', token: 'b'.repeat(64) } })).status, 503);
});

test('unsubscribe does not report success when SQL cannot confirm persistence', async () => {
  const h = harness({ stopValue: false });
  const result = await h.call({ token: null, origin: APP, body: { action: 'unsubscribe', token: 'f'.repeat(64) } });
  assert.equal(result.status, 503);
  assert.notEqual(result.body.ok, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.messages.length, 0);
});

test('run budget stops before Stripe or prepare; no send begins without a time reserve', async () => {
  for (const path of ['/rest/v1/rpc/km16_claim_checkout_reminders', '/rest/v1/km16_checkout_reminders']) {
    const h = harness({ advance: call => call.path === path ? 40000 : 0 });
    const result = await h.call();
    assert.equal(result.status, 503);
    assert.equal(result.body.errors.time_budget_exhausted, 1);
    assert.equal(h.messages.length, 0);
    assert.equal(h.preparations.length, 0);
  }
});

test('the absolute SMTP deadline closes a stalled transport and records uncertainty without a resend', async () => {
  let timerCallback;
  const timers = {
    setTimeout(callback) { timerCallback = callback; return 1; },
    clearTimeout() {},
  };
  const h = harness({ smtpNeverResolves: true, dependencies: { timers } });
  const pending = h.call();
  for (let i = 0; i < 20 && !timerCallback; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof timerCallback, 'function');
  timerCallback();
  const result = await pending;
  assert.equal(result.body.uncertain, 1);
  assert.equal(h.messages.length, 1);
  assert.ok(h.closeCount >= 1);
  assert.equal(h.finishes.at(-1).p_state, 'uncertain');
  assert.equal((await h.call()).body.claimed, 0);
  assert.equal(h.messages.length, 1);
});

test('a subsequent job creates a fresh SMTP transport after a stalled transport is closed', async () => {
  let timerCallback;
  const timers = {
    setTimeout(callback) { timerCallback = callback; return 1; },
    clearTimeout() {},
  };
  const h = harness({
    rows: [attempt('membership', 1), attempt('shirts', 2)],
    smtpNeverResolvesAt: [1], rejectClosedMailer: true, dependencies: { timers },
  });
  const pending = h.call();
  for (let i = 0; i < 20 && !timerCallback; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof timerCallback, 'function');
  timerCallback();
  const result = await pending;
  assert.equal(result.body.uncertain, 1);
  assert.equal(result.body.accepted, 1);
  assert.equal(h.messages.length, 2);
  assert.equal(h.createMailerCount, 2);
  assert.equal(h.states.get(attempt('membership', 1).id), 'uncertain');
  assert.equal(h.states.get(attempt('shirts', 2).id), 'accepted');
});

test('a close failure cannot change an accepted persisted outcome', async () => {
  const h = harness({ closeThrows: true });
  assert.equal((await h.call()).body.accepted, 1);
  assert.equal(h.states.get(attempt().id), 'accepted');
});
