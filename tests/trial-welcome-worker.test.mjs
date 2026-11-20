// All HTTP and SMTP are intercepted. No production contact or e-mail delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createTrialWelcomeHandler, trialWelcomeMessage } from '../supabase/functions/km16-trial-welcome/handler.mjs';

const BASE = 'https://project.example.invalid';
const SERVICE = 'private-service-fixture';
const TOKEN = 'a'.repeat(64);
const JOB = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const RECIPIENT = 'parent@example.invalid';
const json = (value, status = 200) => Response.json(value, { status });

function harness(options = {}) {
  let state = 'pending', currentTime = NOW, opened = 0, closed = 0;
  const calls = [], messages = [], updates = [];
  const job = { id: JOB, order_id: ORDER, state: 'sending', ...options.job };
  const order = { id: ORDER, user_id: USER, email: RECIPIENT, product_id: 'essai',
    livemode: true, total_cents: 0, approval: 'pending', ...options.order };
  const user = { id: USER, email: RECIPIENT, email_confirmed_at: '2026-11-20T10:00:00Z',
    is_anonymous: false, ...options.user };
  const env = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    KM16_DOCUMENTS_SMTP_PASSWORD: 'smtp-fixture', ...options.env };
  const fetcher = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, BASE, 'credentials never leave the configured Supabase project');
    assert.equal(init.headers.Authorization, 'Bearer ' + SERVICE);
    assert.equal(init.headers.apikey, SERVICE);
    assert.ok(init.signal instanceof AbortSignal, 'every HTTP call has a deadline');
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = { path: parsed.pathname, query: parsed.searchParams, method: init.method, body };
    calls.push(call);
    currentTime += options.advance?.(call) || 0;
    if (options.throwPath === call.path) throw Error('SECRET database token and private customer information');
    if (options.errorPath === call.path) return json({ error: 'SECRET private backend detail' }, 500);
    switch (call.path) {
      case '/rest/v1/km16_automation_settings':
        assert.equal(call.method, 'GET');
        assert.equal(call.query.get('select'), 'token,enabled');
        return json([{ token: TOKEN, enabled: true, ...options.settings }]);
      case '/rest/v1/rpc/km16_claim_trial_welcome':
        assert.equal(call.method, 'POST');
        assert.deepEqual(body, {});
        if (Object.hasOwn(options, 'claimResponse')) return json(options.claimResponse);
        if (options.empty || state !== 'pending') return json([]);
        state = 'sending';
        return json([job]);
      case '/rest/v1/km16_membership_orders':
        assert.equal(call.method, 'GET');
        assert.equal(call.query.get('id'), 'eq.' + ORDER);
        return json(Object.hasOwn(options, 'orders') ? options.orders : [order]);
      case '/auth/v1/admin/users/' + USER:
        assert.equal(call.method, 'GET');
        return json(options.wrappedAccount ? { user } : user, options.userStatus || 200);
      case '/rest/v1/rpc/km16_prepare_trial_welcome_send':
        assert.equal(call.method, 'POST');
        assert.deepEqual(body, { p_id: JOB, p_user_id: USER, p_email: RECIPIENT });
        return json(Object.hasOwn(options, 'permitted') ? options.permitted : true);
      case '/rest/v1/km16_trial_welcome_queue':
        assert.equal(call.method, 'PATCH');
        assert.equal(call.query.get('id'), 'eq.' + JOB);
        assert.equal(call.query.get('state'), 'eq.sending', 'terminal rows cannot be rewritten');
        assert.equal(init.headers.Prefer, 'return=representation');
        updates.push(body);
        if (options.finishFails === true || options.finishFails === body.state) return json({}, 500);
        if (options.emptyFinish || state !== 'sending') return json([]);
        state = body.state;
        return json([{ ...job, ...body }]);
      default: throw Error('Unexpected request: ' + url);
    }
  };
  const handler = createTrialWelcomeHandler({
    env: key => env[key], fetcher, cryptoImpl: webcrypto, now: () => currentTime,
    ...(options.timers ? { timers: options.timers } : {}),
    createMailer() {
      opened++;
      if (options.transportThrows) throw Error('SECRET SMTP configuration');
      return {
        async sendMail(message) {
          messages.push(message);
          if (options.smtpThrows) throw Error('SECRET SMTP password');
          if (options.smtpPending) return new Promise(() => {});
          return options.smtpResult ?? { accepted: [RECIPIENT] };
        },
        close() { closed++; },
      };
    },
  });
  return {
    calls, messages, updates,
    get state() { return state; }, get opened() { return opened; }, get closed() { return closed; },
    run(input = {}) {
      const method = input.method || 'POST';
      return handler(new Request(BASE + '/functions/v1/km16-trial-welcome', {
        method, headers: { 'x-km16-automation': TOKEN, ...input.headers },
        ...(method === 'GET' ? {} : { body: input.raw ?? JSON.stringify(input.body ?? { action: 'work' }) }),
      }));
    },
  };
}

test('approved welcome choice 1 uses the exact text, sender, planning and safe single recipient', () => {
  const message = trialWelcomeMessage(JOB, RECIPIENT);
  assert.deepEqual(message.from, { name: 'KM16', address: 'contact@km16.fr' });
  assert.equal(message.replyTo, 'contact@km16.fr');
  assert.deepEqual(message.to, { address: RECIPIENT });
  assert.equal(message.subject, 'Bienvenue chez KM16 — votre cours d’essai vous attend !');
  assert.equal(message.text, `Bonjour,

Bienvenue chez KM16 ! Votre demande de cours d’essai offert est bien enregistrée.

Vous pouvez venir quand vous le souhaitez, en choisissant dans notre planning une séance adaptée au pratiquant : enfants, adolescents ou adultes tous niveaux.

Consultez les horaires et le dojo correspondant avant votre venue :
https://app.km16.fr/#planning

À votre arrivée, présentez-vous à l’enseignant en précisant que vous venez pour votre cours d’essai. Nous serons heureux de vous accueillir et de vous faire découvrir le Krav Maga.

Pour toute question ou pour préparer votre première séance, répondez simplement à ce message.

À bientôt sur les tatamis !

L’équipe KM16
contact@km16.fr
`);
  assert.equal(message.messageId, `<km16-trial-welcome-${JOB}@km16.fr>`);
  assert.equal(message.disableFileAccess, true);
  assert.equal(message.disableUrlAccess, true);
  assert.equal(message.html, undefined);
  assert.equal(message.attachments, undefined);
  for (const email of ['a@example.invalid,b@example.invalid', 'a@example.invalid\r\nBcc: x@example.invalid',
    'A <a@example.invalid>', ' parent@example.invalid', 'a'.repeat(255) + '@example.invalid']) {
    assert.throws(() => trialWelcomeMessage(JOB, email), /invalid_recipient/);
  }
});

test('unsupported method, browser origin, missing token and malformed requests never reach SQL', async () => {
  for (const [input, status] of [
    [{ method: 'GET' }, 405], [{ headers: { Origin: 'https://app.km16.fr' } }, 403],
    [{ headers: { 'x-km16-automation': '' } }, 403], [{ headers: { 'x-km16-automation': 'x'.repeat(513) } }, 403],
    [{ raw: '{' }, 400], [{ raw: 'x'.repeat(1025) }, 400], [{ body: null, raw: 'null' }, 400],
    [{ body: [] }, 400], [{ body: { action: 'send', email: 'attacker@example.invalid' } }, 400],
  ]) {
    const h = harness();
    assert.equal((await h.run(input)).status, status);
    assert.equal(h.calls.length, 0); assert.equal(h.opened, 0);
  }
});

test('wrong secret and disabled automation never claim a job', async () => {
  for (const settings of [{ token: 'b'.repeat(64) }, { enabled: false }, { token: 'short' }]) {
    const h = harness({ settings });
    assert.equal((await h.run()).status, 403);
    assert.equal(h.calls.length, 1); assert.equal(h.state, 'pending'); assert.equal(h.opened, 0);
  }
});

test('missing SMTP configuration never claims or loses a pending welcome', async () => {
  const h = harness({ env: { KM16_DOCUMENTS_SMTP_PASSWORD: '' } });
  assert.equal((await h.run()).status, 503);
  assert.equal(h.state, 'pending'); assert.equal(h.calls.length, 1); assert.equal(h.opened, 0);
});

test('empty queue succeeds without opening SMTP', async () => {
  const h = harness({ empty: true });
  assert.deepEqual(await (await h.run()).json(), { ok: true, claimed: 0, accepted: 0 });
  assert.equal(h.messages.length, 0); assert.equal(h.opened, 0);
});

for (const product_id of ['essai', 'essai-saint-jean']) {
  test(`new free ${product_id} sends once and records SMTP acceptance`, async () => {
    const h = harness({ order: { product_id }, wrappedAccount: product_id === 'essai-saint-jean' });
    assert.deepEqual(await (await h.run()).json(), { ok: true, claimed: 1, accepted: 1 });
    assert.equal(h.messages.length, 1); assert.equal(h.state, 'accepted');
    assert.equal(h.updates[0].sent_at, new Date(NOW).toISOString());
    assert.equal(h.closed, 1);
    assert.deepEqual(await (await h.run()).json(), { ok: true, claimed: 0, accepted: 0 });
    assert.equal(h.messages.length, 1);
  });
}

test('paid, test, rejected, missing or nontrial orders cannot receive the welcome', async () => {
  for (const options of [
    { order: { total_cents: 100 } }, { order: { livemode: false } },
    { order: { approval: 'rejected' } }, { order: { approval: 'unknown' } },
    { order: { product_id: 'annual-adult' } }, { order: { user_id: 'invalid' } },
    { order: { email: 'a@example.invalid,b@example.invalid' } }, { orders: [] },
    { orders: [{ id: ORDER }, { id: ORDER }] },
  ]) {
    const h = harness(options);
    assert.deepEqual(await (await h.run()).json(), { ok: true, claimed: 1, skipped: 1 });
    assert.equal(h.state, 'skipped'); assert.equal(h.updates[0].error_code, 'order_ineligible');
    assert.equal(h.opened, 0);
    assert.equal(h.calls.some(call => call.path.includes('/auth/')), false);
  }
});

test('recipient must remain the current confirmed, nonanonymous, unbanned account', async () => {
  for (const options of [
    { user: { email: 'changed@example.invalid' } }, { user: { email_confirmed_at: null } },
    { user: { is_anonymous: true } }, { user: { banned_until: '2027-01-01T00:00:00Z' } },
    { user: { id: ORDER } }, { userStatus: 404 },
  ]) {
    const h = harness(options);
    assert.deepEqual(await (await h.run()).json(), { ok: true, claimed: 1, skipped: 1 });
    assert.equal(h.updates[0].error_code, 'identity_changed'); assert.equal(h.opened, 0);
  }
});

test('historical casing is normalized; reply still goes only to the confirmed account', async () => {
  const h = harness({ order: { email: 'Parent@Example.Invalid' }, user: { email: 'PARENT@example.invalid' } });
  assert.equal((await (await h.run()).json()).accepted, 1);
  assert.deepEqual(h.messages[0].to, { address: RECIPIENT });
});

test('final database guard must return literal true before SMTP starts', async () => {
  for (const permitted of [false, null, 'true', {}]) {
    const h = harness({ permitted });
    assert.equal((await (await h.run()).json()).skipped, 1);
    assert.equal(h.updates[0].error_code, 'no_longer_eligible'); assert.equal(h.opened, 0);
  }
});

test('database or identity verification failures fail closed before SMTP', async () => {
  for (const path of ['/rest/v1/km16_membership_orders', '/auth/v1/admin/users/' + USER,
    '/rest/v1/rpc/km16_prepare_trial_welcome_send']) {
    const h = harness({ errorPath: path });
    const response = await h.run();
    assert.equal(response.status, 503);
    assert.equal(h.state, 'failed'); assert.equal(h.opened, 0);
    assert.doesNotMatch(await response.text(), /SECRET|private|parent@example|smtp-fixture/);
  }
});

test('malformed claim results never send or overwrite an unknown queue row', async () => {
  for (const claimResponse of [null, {}, [{ id: 'invalid' }], [null],
    [{ id: JOB, order_id: ORDER, state: 'pending' }], [{}, {}]]) {
    const h = harness({ claimResponse });
    assert.equal((await h.run()).status, 503);
    assert.equal(h.opened, 0); assert.equal(h.updates.length, 0);
  }
});

test('SMTP rejection is terminal and accepted list must contain the intended recipient', async () => {
  for (const smtpResult of [{ accepted: [] }, { accepted: ['other@example.invalid'] }, {}]) {
    const h = harness({ smtpResult });
    assert.deepEqual(await (await h.run()).json(), { ok: true, claimed: 1, failed: 1 });
    assert.equal(h.state, 'failed'); assert.equal(h.updates[0].error_code, 'smtp_rejected');
    await h.run(); assert.equal(h.messages.length, 1);
  }
});

test('transport initialization failure never counts as an attempted SMTP send', async () => {
  const h = harness({ transportThrows: true });
  const response = await h.run();
  assert.equal(response.status, 503); assert.equal(h.state, 'failed');
  assert.equal(h.messages.length, 0); assert.equal((await response.json()).uncertain, undefined);
});

test('SMTP exception is uncertain, closes the transport and never resends', async () => {
  const h = harness({ smtpThrows: true });
  const response = await h.run();
  assert.equal(response.status, 503); assert.equal(h.state, 'uncertain'); assert.equal(h.closed, 1);
  assert.doesNotMatch(await response.text(), /SECRET|parent@example|smtp-fixture/);
  await h.run(); assert.equal(h.messages.length, 1);
});

test('absolute SMTP timeout is uncertain and releases the transport', async () => {
  let fire, registered;
  const registration = new Promise(resolve => { registered = resolve; });
  let cleared = false;
  const timers = {
    setTimeout(callback, milliseconds) { assert.equal(milliseconds, 20000); fire = callback; registered(); return 1; },
    clearTimeout(id) { assert.equal(id, 1); cleared = true; },
  };
  const h = harness({ smtpPending: true, timers });
  const request = h.run();
  await registration; fire();
  const response = await request;
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'smtp_timeout');
  assert.equal(h.state, 'uncertain'); assert.equal(h.closed, 1); assert.equal(cleared, true);
  await h.run(); assert.equal(h.messages.length, 1);
});

test('SMTP acceptance followed by persistence failure is never reported as confirmed delivery', async () => {
  const h = harness({ finishFails: 'accepted' });
  const response = await h.run();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: 'service_unavailable',
    claimed: 1, uncertain: 1, smtp_accepted: 1 });
  assert.equal(h.state, 'uncertain');
  await h.run(); assert.equal(h.messages.length, 1);
});

test('missing terminal update confirmation leaves the sending row unreclaimed', async () => {
  const h = harness({ emptyFinish: true });
  const response = await h.run();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'delivery_persistence_unverified');
  assert.equal(h.state, 'sending');
  await h.run(); assert.equal(h.messages.length, 1);
});

test('insufficient execution budget prevents SMTP and protects the current request', async () => {
  const h = harness({ advance: call => call.path.includes('prepare_trial') ? 30000 : 0 });
  const response = await h.run();
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'time_budget_exhausted');
  assert.equal(h.state, 'failed'); assert.equal(h.opened, 0);
});
