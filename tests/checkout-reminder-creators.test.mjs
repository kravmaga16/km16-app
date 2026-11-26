// Execute the production creator sources offline. Stripe, Auth, database and SMTP
// are replaced; an unexpected outbound operation fails the scenario.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { createCheckoutReminderRecorder } from '../supabase/functions/_shared/checkout-reminders.mjs';

const BASE = 'https://fixture.example.invalid';
const SITE = 'https://app.km16.fr';
const USER = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const ATTEMPT = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'confirmed@example.invalid';
const VIDEO = 'shadow-boxing';
const SESSION = 'cs_live_fixture123';
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/' + SESSION;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const verifiedUser = { id: USER, email: EMAIL, email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false };

function recorderHarness(options = {}) {
  const calls = [], logs = [];
  const recorder = createCheckoutReminderRecorder({
    base: BASE, serviceKey: 'private-fixture-key',
    logger: code => { logs.push(code); if (options.loggerThrows) throw Error('log unavailable'); },
    fetcher: async (url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer private-fixture-key');
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (options.throws) throw Error('private provider details: do not log');
      if (url.endsWith('km16_begin_checkout_attempt')) {
        return json(Object.hasOwn(options, 'beginValue') ? options.beginValue : ATTEMPT, options.status || 200);
      }
      assert.ok(url.endsWith('km16_attach_checkout_attempt'));
      return json(options.attachValue ?? true, options.status || 200);
    },
  });
  return { recorder, calls, logs };
}

const beginInput = (kind = 'membership', overrides = {}) => ({
  kind, sourceId: kind === 'video' ? VIDEO : ORDER, user: verifiedUser,
  optIn: true, livemode: true, amountCents: 999, ...overrides,
});
const attachInput = (kind = 'membership', overrides = {}) => ({
  kind, sourceId: kind === 'video' ? VIDEO : ORDER, userId: USER, amountCents: 999, ...overrides,
});
function sessionFor(kind = 'membership', overrides = {}) {
  const metadata = kind === 'membership' ? { km16_source: 'km16-membership-v1', km16_order: ORDER }
    : kind === 'shirts' ? { km16_source: 'km16-shirts-v1', km16_shirt_order: ORDER }
      : { km16_source: 'km16-checkout-v1', km16_video_id: VIDEO, km16_user_id: USER };
  return {
    id: SESSION, url: CHECKOUT_URL, mode: 'payment', livemode: true,
    status: 'open', payment_status: 'unpaid', currency: 'eur', amount_total: 999,
    expires_at: Math.floor(Date.now() / 1000) + 1800,
    client_reference_id: USER, metadata, ...overrides,
  };
}

test('registry records opt-outs too, but only literal true is an opt-in', async () => {
  for (const kind of ['membership', 'shirts', 'video']) {
    for (const optIn of [true, false, undefined, 'true', 1]) {
      const h = recorderHarness();
      assert.equal(await h.recorder.begin(beginInput(kind, { optIn })), ATTEMPT);
      assert.deepEqual(h.calls[0].body, {
        p_kind: kind, p_source_id: kind === 'video' ? VIDEO : ORDER,
        p_user_id: USER, p_email: EMAIL, p_opt_in: optIn === true, p_livemode: true,
      });
    }
  }
});

test('free/test flows do not call registry; missing confirmed identity cannot prepare an attempt', async () => {
  for (const overrides of [{ livemode: false }, { amountCents: 0 }]) {
    const h = recorderHarness();
    assert.equal(await h.recorder.begin(beginInput('membership', overrides)), null);
    assert.equal(h.calls.length, 0);
  }
  for (const user of [null, { ...verifiedUser, email_confirmed_at: null },
    { ...verifiedUser, is_anonymous: true }, { ...verifiedUser, email: 'a@example.invalid\r\nBcc:x@y.invalid' }]) {
    const h = recorderHarness();
    await assert.rejects(h.recorder.begin(beginInput('video', { user })), /identity_invalid/);
    assert.equal(h.calls.length, 0);
  }
});

test('begin returns SQL null, rejects malformed results and fails before Stripe on an RPC error', async () => {
  const empty = recorderHarness({ beginValue: null });
  assert.equal(await empty.recorder.begin(beginInput()), null);
  for (const options of [{ beginValue: {} }, { beginValue: 'not-an-id' }, { status: 500 }]) {
    const h = recorderHarness(options);
    await assert.rejects(h.recorder.begin(beginInput()), /registry_unavailable/);
  }
});

test('attach verifies payment identity and records only a valid live unpaid session', async () => {
  for (const kind of ['membership', 'shirts', 'video']) {
    const h = recorderHarness();
    assert.equal(await h.recorder.attach(ATTEMPT, sessionFor(kind), attachInput(kind)), true);
    assert.deepEqual(h.calls[0].body, {
      p_attempt: ATTEMPT, p_session_id: SESSION, p_amount_cents: 999,
      p_currency: 'eur', p_livemode: true,
    });
  }
  for (const change of [
    { livemode: false }, { payment_status: 'paid' }, { status: 'complete' },
    { currency: 'usd' }, { amount_total: 1 }, { mode: 'setup' },
    { id: 'cs_test_fixture' }, { metadata: {} },
  ]) {
    const h = recorderHarness();
    assert.equal(await h.recorder.attach(ATTEMPT, sessionFor('membership', change), attachInput()), false);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.logs, ['checkout_reminder_attach_failed']);
  }
  const h = recorderHarness();
  assert.equal(await h.recorder.attach(ATTEMPT, sessionFor('video', { client_reference_id: 'someone-else' }), attachInput('video')), false);
  assert.equal(h.calls.length, 0);
});

test('attach is best effort even when network, SQL result or logging fails; no sensitive detail is logged', async () => {
  for (const options of [{ throws: true }, { status: 500 }, { attachValue: false }, { throws: true, loggerThrows: true }]) {
    const h = recorderHarness(options);
    assert.equal(await h.recorder.attach(ATTEMPT, sessionFor(), attachInput()), false);
    assert.deepEqual(h.logs, ['checkout_reminder_attach_failed']);
  }
  const h = recorderHarness();
  assert.equal(await h.recorder.attach(null, null), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.logs.length, 0);
});

async function creatorHarness(kind, options = {}) {
  const slug = { membership: 'km16-adhesions', shirts: 'km16-shirts', video: 'km16-create-checkout' }[kind];
  const calls = [], logs = [];
  const user = { ...verifiedUser, ...options.user };
  const env = {
    SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'private-fixture-key',
    KM16_ADHESIONS_STRIPE_SECRET_KEY: 'sk_live_fixture_not_real', KM16_ADHESIONS_ALLOW_LIVE: 'true',
    KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY: 'sk_live_fixture_not_real',
    KM16_SHIRTS_STRIPE_TEST_SECRET_KEY: 'sk_test_fixture_not_real',
    STRIPE_SECRET_KEY: 'sk_live_fixture_not_real', ...options.env,
  };
  let sourceOrder = {
    id: ORDER, user_id: USER, email: EMAIL, livemode: true, approval: 'pending',
    total_cents: 999, amounts: [999], count: 1, title: 'Cours fixture', product_id: 'stage-fixture',
    stripe_session_id: SESSION, customer_id: 'cus_fixture', terms_version: 'terms-fixture',
    ...options.order,
  };
  const sessions = new Map([[SESSION, sessionFor(kind, options.session)]]);
  const stripeCreate = async (params, createOptions) => {
    calls.push({ op: 'stripe-create', params: JSON.parse(JSON.stringify(params)), options: createOptions });
    const session = sessionFor(kind, {
      id: options.action === 'resume-checkout' ? 'cs_live_reopened123' : SESSION,
      metadata: params.metadata,
      amount_total: params.line_items[0].price_data?.unit_amount ?? 999,
      livemode: kind === 'membership' ? env.KM16_ADHESIONS_STRIPE_SECRET_KEY.startsWith('sk_live_') : true,
    });
    sessions.set(session.id, session);
    return session;
  };
  class Stripe {
    constructor() {
      this.customers = { create: async (params, createOptions) => {
        calls.push({ op: 'stripe-customer', params, options: createOptions }); return { id: 'cus_fixture' };
      } };
      this.checkout = { sessions: {
        create: stripeCreate,
        retrieve: async id => { calls.push({ op: 'stripe-retrieve', id }); return sessions.get(id); },
        list: async () => ({ data: options.related ?? [...sessions.values()], has_more: false }),
      } };
    }
  }
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(url);
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    if (url === BASE + '/auth/v1/user') return json(user);
    if (parsed.pathname.endsWith('/rpc/km16_begin_checkout_attempt')) {
      calls.push({ op: 'begin', body });
      assert.equal(init.headers.Authorization, 'Bearer private-fixture-key');
      assert.ok(init.signal instanceof AbortSignal);
      return json(Object.hasOwn(options, 'beginValue') ? options.beginValue : ATTEMPT, options.beginStatus || 200);
    }
    if (parsed.pathname.endsWith('/rpc/km16_attach_checkout_attempt')) {
      calls.push({ op: 'attach', body });
      assert.ok(init.signal instanceof AbortSignal);
      if (options.attachThrows) throw Error('private service details must never reach checkout or logs');
      return json(options.attachValue ?? true, options.attachStatus || 200);
    }
    if (parsed.pathname === '/rest/v1/km16_membership_config') {
      return json([{ enabled: true, terms_url: SITE + '/terms', privacy_url: SITE + '/privacy',
        terms_version: 'terms-fixture', season_end: '2099-06-30', ...options.config }]);
    }
    if (parsed.pathname === '/rest/v1/km16_membership_products') {
      return json([{ id: 'stage-fixture', title: 'Cours fixture', amount: options.free ? 0 : 999, kind: 'stage', draft: false }]);
    }
    if (parsed.pathname === '/rest/v1/km16_member_photos') return json([{ id: ORDER }]);
    if (parsed.pathname === '/rest/v1/km16_membership_payments') return json(options.paid ? [{ order_id: ORDER, status: 'paid', amount_cents: 999, refunded_cents: 0, ...options.payment }] : []);
    if (['/rest/v1/km16_membership_orders', '/rest/v1/km16_shirt_orders'].includes(parsed.pathname)) {
      if (init.method === 'POST') { sourceOrder = { ...sourceOrder, ...body }; calls.push({ op: 'order-create', body }); return json([sourceOrder]); }
      if (init.method === 'PATCH') { sourceOrder = { ...sourceOrder, ...body }; calls.push({ op: 'order-patch', body }); return json([sourceOrder]); }
      return json(parsed.searchParams.has('id') && (options.existing || options.action === 'resume-checkout') ? [sourceOrder] : []);
    }
    if (parsed.pathname === '/rest/v1/km16_videos') {
      return json([{ id: VIDEO, published: true, stripe_price_id: 'price_1UUnXGFTSrnM01K8lC5NsfY3', price_cents: 999, currency: 'eur' }]);
    }
    if (parsed.pathname === '/rest/v1/km16_purchases') return json(options.paid ? [{ video_id: VIDEO }] : []);
    if (url === 'https://api.stripe.com/v1/prices/price_1UUnXGFTSrnM01K8lC5NsfY3') {
      return json({ active: true, type: 'one_time', unit_amount: 999, currency: 'eur' });
    }
    if (url === 'https://api.stripe.com/v1/checkout/sessions') {
      assert.equal(init.method, 'POST');
      const params = new URLSearchParams(init.body);
      calls.push({ op: 'stripe-create', params: Object.fromEntries(params) });
      return json(sessionFor('video'));
    }
    throw Error('Unexpected outbound operation: ' + parsed.origin + parsed.pathname);
  };
  let handler;
  const source = (await readFile(new URL(options.legacy ? '../server/adhesions/index.ts' : '../supabase/functions/' + slug + '/index.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '');
  const context = {
    Deno: { env: { get: name => env[name] }, serve: value => { handler = value; } },
    Stripe, jpeg: {}, nodemailer: { createTransport: () => { throw Error('No SMTP allowed'); } },
    fetch: fetcher, Response, Request, Headers, URLSearchParams, TextEncoder,
    crypto: { ...globalThis.crypto, randomUUID: () => ORDER, subtle: globalThis.crypto.subtle },
    console: { error: (...values) => logs.push(values.join(' ')), warn: (...values) => logs.push(values.join(' ')) },
    createCheckoutReminderRecorder: input => createCheckoutReminderRecorder({ ...input, fetcher, logger: code => logs.push(code) }),
  };
  vm.runInNewContext(stripTypeScriptTypes(source), context, { filename: slug + '/index.ts' });
  const input = {
    action: options.action || 'checkout', request_id: ORDER, order_id: ORDER,
    product_id: 'stage-fixture', video_id: VIDEO, sizes: ['M'], count: 1,
    first_name: 'Test', last_name: 'Fixture', birth_date: '1990-01-01', phone: '0600000000',
    terms: true, privacy: true, license: true,
    // Malicious recipient/identity fields must have no effect on the registry.
    email: 'attacker@example.invalid', user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ...options.input,
  };
  return {
    calls, logs, get order() { return sourceOrder; },
    async call() {
      const response = await handler(new Request(BASE + '/functions/v1/' + slug, {
        method: 'POST', headers: { origin: SITE, authorization: 'Bearer user-fixture', 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

for (const kind of ['membership', 'shirts', 'video']) {
  test(kind + ': creator uses confirmed Auth identity and a strict opt-in, before Stripe then after source patch', async () => {
    for (const optIn of [true, false, 'true', undefined]) {
      const h = await creatorHarness(kind, { input: { reminder_opt_in: optIn } });
      const result = await h.call();
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.url, CHECKOUT_URL);
      const begin = h.calls.find(call => call.op === 'begin');
      assert.deepEqual(begin.body, { p_kind: kind, p_source_id: kind === 'video' ? VIDEO : ORDER,
        p_user_id: USER, p_email: EMAIL, p_opt_in: optIn === true, p_livemode: true });
      assert.ok(h.calls.indexOf(begin) < h.calls.findIndex(call => call.op === 'stripe-create'));
      const attachIndex = h.calls.findIndex(call => call.op === 'attach');
      assert.ok(attachIndex > h.calls.findIndex(call => call.op === 'stripe-create'));
      if (kind !== 'video') assert.ok(attachIndex > h.calls.findIndex(call => call.op === 'order-patch'));
      assert.equal(h.calls[attachIndex].body.p_amount_cents, kind === 'shirts' ? 1800 : 999);
    }
  });

  test(kind + ': failed begin prevents all Stripe creations; failed attach preserves successful checkout', async () => {
    const failed = await creatorHarness(kind, { beginStatus: 500 });
    assert.equal((await failed.call()).status, 500);
    assert.equal(failed.calls.filter(call => call.op === 'stripe-create' || call.op === 'stripe-customer').length, 0);
    for (const options of [{ attachStatus: 500 }, { attachValue: false }, { attachThrows: true }]) {
      const h = await creatorHarness(kind, options);
      const result = await h.call();
      assert.equal(result.status, 200);
      assert.equal(result.body.url, CHECKOUT_URL);
      assert.deepEqual(h.logs, ['checkout_reminder_attach_failed']);
    }
  });

  test(kind + ': SQL null skips attachment and unconfirmed customers never reach registry or Stripe', async () => {
    const h = await creatorHarness(kind, { beginValue: null });
    assert.equal((await h.call()).status, 200);
    assert.equal(h.calls.filter(call => call.op === 'attach').length, 0);
    const blocked = await creatorHarness(kind, { user: { email_confirmed_at: null } });
    assert.equal((await blocked.call()).status, 403);
    assert.equal(blocked.calls.length, 0);
  });
}

test('free membership and test membership/video do not register reminders', async () => {
  const free = await creatorHarness('membership', { free: true });
  assert.deepEqual((await free.call()).body, { free: true });
  assert.equal(free.calls.some(call => call.op === 'begin' || call.op === 'stripe-create'), false);
  for (const [kind, key] of [['membership', 'KM16_ADHESIONS_STRIPE_SECRET_KEY'], ['video', 'STRIPE_SECRET_KEY']]) {
    const h = await creatorHarness(kind, { env: { [key]: 'sk_test_fixture_not_real' } });
    assert.equal((await h.call()).status, 200);
    assert.equal(h.calls.some(call => call.op === 'begin' || call.op === 'attach'), false);
  }
});

test('membership existing open sessions are registered only after the paid guard and preserve the URL', async () => {
  for (const options of [{ action: 'resume-checkout' }, { existing: true }]) {
    const h = await creatorHarness('membership', { ...options, input: { reminder_opt_in: true } });
    assert.equal((await h.call()).body.url, CHECKOUT_URL);
    assert.equal(h.calls.filter(call => call.op === 'stripe-create').length, 0);
    assert.equal(h.calls.filter(call => call.op === 'begin').length, 1);
    assert.equal(h.calls.filter(call => call.op === 'attach').length, 1);
    const paid = await creatorHarness('membership', { ...options, paid: true });
    await paid.call();
    assert.equal(paid.calls.some(call => call.op === 'begin' || call.op === 'attach'), false);
  }
});

test('membership reopening keeps its original idempotency/metadata and attaches after the replacement ID is persisted', async () => {
  const h = await creatorHarness('membership', { action: 'resume-checkout', session: { status: 'expired', url: null } });
  assert.equal((await h.call()).status, 200);
  const create = h.calls.find(call => call.op === 'stripe-create');
  assert.equal(create.options.idempotencyKey, 'km16-reopen-' + SESSION);
  assert.deepEqual(create.params.metadata, { km16_source: 'km16-membership-v1', km16_order: ORDER });
  assert.equal(h.order.stripe_session_id, 'cs_live_reopened123');
  assert.ok(h.calls.findIndex(call => call.op === 'begin') < h.calls.indexOf(create));
  assert.ok(h.calls.findIndex(call => call.op === 'order-patch') < h.calls.findIndex(call => call.op === 'attach'));
});

test('ordinary creator metadata, Stripe idempotency and source identity remain unchanged', async () => {
  for (const kind of ['membership', 'shirts', 'video']) {
    const h = await creatorHarness(kind);
    assert.equal((await h.call()).status, 200);
    const create = h.calls.find(call => call.op === 'stripe-create');
    if (kind === 'video') {
      assert.equal(create.params['metadata[km16_source]'], 'km16-checkout-v1');
      assert.equal(create.params['metadata[km16_user_id]'], USER);
      assert.equal(create.params.customer_email, EMAIL);
      assert.equal(create.params.client_reference_id, USER);
    } else {
      const sourceKey = kind === 'membership' ? 'km16_order' : 'km16_shirt_order';
      assert.deepEqual(create.params.metadata, { km16_source: 'km16-' + (kind === 'membership' ? 'membership' : 'shirts') + '-v1', [sourceKey]: ORDER });
      assert.deepEqual(create.params.payment_intent_data.metadata, create.params.metadata);
      assert.equal(create.options.idempotencyKey, (kind === 'membership' ? 'km16-member-checkout-' : 'km16-shirts-') + ORDER);
    }
  }
});

for (const legacy of [false, true]) {
  test((legacy ? 'legacy ' : '') + 'membership resume keeps V5 paid orders valid after trial-only V6 without changing accepted terms', async () => {
    const h = await creatorHarness('membership', { legacy, action: 'resume-checkout',
      session: { status: 'expired', url: null },
      order: { terms_version: 'km16-2026-11-10-v5' },
      config: { terms_version: 'km16-2026-11-20-v6' } });
    const result = await h.call();
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'open');
    assert.equal(h.calls.filter(call => call.op === 'stripe-create').length, 1);
    assert.equal(h.order.terms_version, 'km16-2026-11-10-v5');
    assert.equal(h.calls.find(call => call.op === 'order-patch').body.terms_version, undefined);
  });
  test((legacy ? 'legacy ' : '') + 'membership resume rejects unrelated stale versions and trial IDs from the V5/V6 exception', async () => {
    for (const [accepted, current, product] of [
      ['km16-2026-11-09-v4', 'km16-2026-11-20-v6', 'stage-fixture'],
      ['km16-2026-11-10-v5', 'km16-future-v7', 'stage-fixture'],
      ['km16-2026-11-20-v6', 'km16-2026-11-10-v5', 'stage-fixture'],
      ['km16-2026-11-10-v5', 'km16-2026-11-20-v6', 'essai'],
      ['km16-2026-11-10-v5', 'km16-2026-11-20-v6', 'essai-saint-jean'],
    ]) {
      const h = await creatorHarness('membership', { legacy, action: 'resume-checkout',
        session: { status: 'expired', url: null },
        order: { terms_version: accepted, product_id: product },
        config: { terms_version: current } });
      const result = await h.call();
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'expired');
      assert.equal(h.calls.some(call => ['begin', 'stripe-create', 'order-patch'].includes(call.op)), false);
    }
  });
}


test('donation opens a separate Stripe Checkout after a confirmed KM16 payment', async () => {
  const h = await creatorHarness('membership', {
    action: 'create-donation', existing: true, paid: true, input: { amount_cents: 1250 },
  });
  const result = await h.call();
  assert.equal(result.status, 200);
  assert.equal(result.body.url, CHECKOUT_URL);
  assert.deepEqual(h.calls.map(call => call.op), ['stripe-create']);
  const [{ params, options }] = h.calls;
  assert.deepEqual(params.line_items, [{
    price_data: {
      currency: 'eur', unit_amount: 1250, product_data: { name: 'Don à l’association KM16' },
    },
    quantity: 1,
  }]);
  assert.deepEqual(params.metadata, { km16_source: 'km16-donation-v1', km16_donation_order: ORDER });
  assert.equal(params.payment_intent_data.receipt_email, EMAIL);
  assert.equal(params.success_url, SITE + '/adhesion.html?espace=1&paid=1&order=' + ORDER + '&don={CHECKOUT_SESSION_ID}');
  assert.match(options.idempotencyKey, /^km16-donation-/);
  assert.equal(h.order.total_cents, 999);
});

test('donation rejects invalid amounts, missing orders, and payments that need review', async () => {
  for (const [overrides, status] of [
    [{ input: { amount_cents: 99 } }, 400],
    [{ input: { amount_cents: 100001 } }, 400],
    [{ input: { amount_cents: '100' } }, 400],
    [{ existing: false }, 404],
    [{ paid: false }, 409],
    [{ payment: { refunded_cents: 50 } }, 409],
  ]) {
    const h = await creatorHarness('membership', {
      action: 'create-donation', existing: true, paid: true, input: { amount_cents: 100 }, ...overrides,
    });
    assert.equal((await h.call()).status, status);
    assert.equal(h.calls.length, 0);
  }
});

test('donation confirmation requires a paid Stripe session for the same order', async () => {
  const metadata = { km16_source: 'km16-donation-v1', km16_donation_order: ORDER };
  for (const [session, status, result] of [
    [{ status: 'complete', payment_status: 'paid', metadata }, 200, 'paid'],
    [{ status: 'complete', payment_status: 'unpaid', metadata }, 200, 'pending'],
    [{ status: 'open', metadata }, 200, 'pending'],
    [{ status: 'expired', metadata }, 200, 'expired'],
    [{ status: 'complete', payment_status: 'paid' }, 404, undefined],
    [{ status: 'complete', payment_status: 'paid', metadata: { ...metadata, km16_donation_order: ATTEMPT } }, 404, undefined],
  ]) {
    const h = await creatorHarness('membership', {
      action: 'donation-status', existing: true, input: { session_id: SESSION }, session,
    });
    const response = await h.call();
    assert.equal(response.status, status);
    assert.equal(response.body.status, result);
    assert.deepEqual(h.calls.map(call => call.op), ['stripe-retrieve']);
  }
});
