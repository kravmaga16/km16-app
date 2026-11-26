import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

const metadata = { km16_source: 'km16-donation-v1', km16_donation_order: 'order-fixture' };
const email = 'donateur@example.invalid';
const paidAt = '2026-11-26T23:30:00.000Z';

async function handler(file, context) {
  let serve;
  const source = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(stripTypeScriptTypes(source), {
    Deno: { env: { get: () => 'fixture-secret' }, serve: callback => { serve = callback; } },
    Response, AbortSignal, crypto, TextEncoder, console, ...context,
  });
  return serve;
}

test('the signed live Stripe donation event queues only confirmed payments', async () => {
  const session = {
    id: 'cs_live_fixture', metadata, mode: 'payment', livemode: true, status: 'complete',
    payment_status: 'paid', currency: 'eur', amount_total: 1250, payment_intent: 'pi_donation',
  };
  const intent = {
    id: 'pi_donation', metadata, livemode: true, currency: 'eur', status: 'succeeded',
    amount_received: 1250, receipt_email: email,
  };
  const event = { type: 'checkout.session.completed', livemode: true, created: Date.parse(paidAt)/1000, data: { object: { ...session } } };
  const inserts = [];
  class Stripe {
    static createSubtleCryptoProvider() {}
    checkout = { sessions: { retrieve: async () => session } };
    paymentIntents = { retrieve: async () => intent };
    webhooks = { constructEventAsync: async (_, signature) => {
      if (signature !== 'valid') throw Error('signature');
      return event;
    } };
  }
  const serve = await handler('../server/adhesions-webhook/index.ts', {
    Stripe, fetch: async (url, init) => {
      assert.match(url, /km16_donation_thank_you\?on_conflict=payment_intent_id$/);
      assert.equal(init.headers.Prefer, 'resolution=ignore-duplicates');
      inserts.push(JSON.parse(init.body));
      return new Response(null, { status: 201 });
    },
  });
  const send = signature => serve(new Request('https://example.invalid', { method: 'POST', headers: { 'stripe-signature': signature } }));
  assert.equal((await send('invalid')).status, 400);
  event.data.object.payment_status = 'unpaid';
  assert.equal((await send('valid')).status, 200);
  event.data.object.payment_status = 'paid';
  event.livemode = false;
  assert.equal((await send('valid')).status, 200);
  assert.equal(inserts.length, 0);
  event.livemode = true;
  event.type = 'checkout.session.async_payment_succeeded';
  assert.equal((await send('valid')).status, 200);
  assert.deepEqual(inserts, [{ payment_intent_id: 'pi_donation', email, amount_cents: 1250, paid_at: paidAt }]);
});

test('the worker sends the approved text to the donor and records SMTP acceptance', async () => {
  const messages = [], updates = [];
  const serve = await handler('../server/admin-mail-worker/index.ts', {
    nodemailer: { createTransport: () => ({
      sendMail: async message => { messages.push(message); return { accepted: [email] }; },
      close() {},
    }) },
    fetch: async (url, init) => {
      if (url.includes('km16_automation_settings')) return Response.json([{ enabled: true, token: 'a'.repeat(64) }]);
      if (url.endsWith('/rpc/km16_claim_donation_thank_you')) return Response.json([{
        payment_intent_id: 'pi_donation', email, amount_cents: 1250, paid_at: paidAt,
      }]);
      if (url.includes('km16_donation_thank_you?')) updates.push(JSON.parse(init.body));
      return Response.json([]);
    },
  });
  const response = await serve(new Request('https://example.invalid', { method: 'POST', headers: { 'x-km16-automation': 'a'.repeat(64) } }));
  assert.equal((await response.json()).donation, 'accepted');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, email);
  assert.equal(messages[0].subject, 'Merci pour votre don à KM16 !');
  assert.match(messages[0].text, /12,50\s€.*, reçu le 27 novembre 2026/);
  assert.equal(updates[0].state, 'accepted');
  assert.ok(updates[0].sent_at);
});

test('the queue deduplicates paid donations and never retries an uncertain delivery', async () => {
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const migration = (await readdir(migrations)).find(file => file.endsWith('_donation_thank_you.sql'));
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    await db.exec(await readFile(new URL(migration, migrations), 'utf8'));
    await db.exec(`set role service_role;
      insert into public.km16_donation_thank_you(payment_intent_id,email,amount_cents,paid_at)
      values ('pi_donation','donateur@example.invalid',1250,now()),
             ('pi_donation','donateur@example.invalid',1250,now())
      on conflict do nothing;`);
    const claim = 'select state from public.km16_claim_donation_thank_you()';
    assert.deepEqual((await db.query(claim)).rows, [{ state: 'sending' }]);
    assert.deepEqual((await db.query(claim)).rows, []);
    await db.exec("update public.km16_donation_thank_you set claimed_at=now()-interval '11 minutes'");
    assert.deepEqual((await db.query(claim)).rows, []);
    assert.deepEqual((await db.query('select state from public.km16_donation_thank_you')).rows, [{ state: 'uncertain' }]);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query(claim), /permission denied/);
    await assert.rejects(db.query('select * from public.km16_donation_thank_you'), /permission denied/);
  } finally {
    await db.close();
  }
});
