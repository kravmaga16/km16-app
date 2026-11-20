// The scheduled worker only reads Stripe and confirms existing orders.
// The existing database trigger queues the administrator's email atomically.
const BATCH_SIZE = 8;
const PARALLELISM = 4;
const REQUEST_TIMEOUT_MS = 8_000;
const RUN_BUDGET_MS = 50_000;
const STRIPE_VERSION = '2026-11-18.endive';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_SESSION = /^cs_live_[A-Za-z0-9]+$/;

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const objectId = value => typeof value === 'string' ? value : value?.id;

class CheckError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function sameToken(a, b, cryptoImpl) {
  const digest = async value => new Uint8Array(await cryptoImpl.subtle.digest(
    'SHA-256', new TextEncoder().encode(value),
  ));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

function paymentResult(order, session) {
  if (session?.id !== order.stripe_session_id || session.livemode !== true ||
      session.mode !== 'payment' || session.currency !== 'eur' ||
      session.amount_total !== order.amount_cents ||
      session.metadata?.km16_source !== 'km16-shirts-v1' ||
      session.metadata?.km16_shirt_order !== order.id) {
    return { outcome: 'skipped', code: 'session_mismatch' };
  }
  if (session.status === 'expired' && session.payment_status === 'unpaid') {
    return { status: 'cancelled' };
  }
  if (session.status !== 'complete' || session.payment_status !== 'paid') {
    return { outcome: 'pending' };
  }

  // Expanded objects are required: an incomplete Stripe response never grants
  // a paid status. Refunds and disputes also remain available for human review.
  const intent = session.payment_intent;
  const charge = intent?.latest_charge;
  if (!intent || typeof intent !== 'object' || !charge || typeof charge !== 'object' ||
      !/^pi_[A-Za-z0-9]+$/.test(intent.id || '') || !/^ch_[A-Za-z0-9]+$/.test(charge.id || '') ||
      objectId(charge.payment_intent) !== intent.id || intent.livemode !== true ||
      charge.livemode !== true || intent.currency !== 'eur' || charge.currency !== 'eur' ||
      intent.amount !== order.amount_cents || intent.amount_received !== order.amount_cents ||
      charge.amount !== order.amount_cents || charge.amount_captured !== order.amount_cents ||
      intent.metadata?.km16_source !== 'km16-shirts-v1' ||
      intent.metadata?.km16_shirt_order !== order.id) {
    return { outcome: 'skipped', code: 'payment_unverified' };
  }
  if (charge.refunded === true || charge.amount_refunded > 0 || charge.disputed === true) {
    return { outcome: 'skipped', code: 'payment_refunded_or_disputed' };
  }
  if (intent.status !== 'succeeded' || charge.paid !== true || charge.captured !== true ||
      charge.refunded !== false || charge.disputed !== false || charge.amount_refunded !== 0) {
    return { outcome: 'skipped', code: 'payment_not_settled' };
  }
  return { status: 'paid' };
}

export function createShirtPaymentHandler({ env, fetcher, cryptoImpl = globalThis.crypto, now = Date.now }) {
  return async request => {
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    const token = request.headers.get('x-km16-automation') || '';
    if (token.length < 64 || token.length > 512) return reply({ error: 'forbidden' }, 403);

    const base = (env('SUPABASE_URL') || '').replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!base.startsWith('https://') || !key) return reply({ error: 'configuration_unavailable' }, 503);
    const deadline = now() + RUN_BUDGET_MS;

    async function jsonRequest(url, init, errorCode) {
      const remaining = Math.floor(deadline - now());
      if (remaining <= 0) throw new CheckError('time_budget_exhausted');
      try {
        const response = await fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
        });
        if (!response.ok) throw new CheckError(errorCode);
        return await response.json();
      } catch (error) {
        if (error instanceof CheckError) throw error;
        throw new CheckError(errorCode);
      }
    }
    const db = (path, method = 'GET', body) => jsonRequest(base + '/rest/v1/' + path, {
      method,
      headers: {
        apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, 'database_unavailable');

    try {
      const settings = (await db('km16_automation_settings?select=token,enabled&id=eq.1'))?.[0];
      if (settings?.enabled !== true || typeof settings.token !== 'string' ||
          settings.token.length < 64 || settings.token.length > 512 ||
          !await sameToken(token, settings.token, cryptoImpl)) {
        return reply({ error: 'forbidden' }, 403);
      }

      // Check configuration before reserving rows; a missing key must not defer
      // orders that another correctly configured invocation can process.
      const stripeKey = env('KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY') || '';
      if (!stripeKey.startsWith('sk_live_')) return reply({ error: 'stripe_unavailable' }, 503);

      // Request bodies are deliberately unused. Only the private, bounded SQL
      // claim chooses orders; callers cannot supply an order or increase a batch.
      const orders = await db('rpc/km16_claim_shirt_payment_checks', 'POST', { p_limit: BATCH_SIZE });
      if (!Array.isArray(orders) || orders.length > BATCH_SIZE) {
        throw new CheckError('invalid_claim_response');
      }
      const totals = { checked: 0, paid: 0, cancelled: 0, pending: 0, skipped: 0, failed: 0 };
      const errors = {};
      const record = result => {
        totals.checked++;
        totals[result.outcome]++;
        if (result.code) errors[result.code] = (errors[result.code] || 0) + 1;
      };

      async function check(order) {
        if (order?.livemode !== true || !UUID.test(order.id || '') ||
            !LIVE_SESSION.test(order.stripe_session_id || '') ||
            !Number.isSafeInteger(order.amount_cents) || order.amount_cents <= 0) {
          return { outcome: 'skipped', code: 'invalid_order' };
        }
        try {
          const sessionUrl = new URL('https://api.stripe.com/v1/checkout/sessions/' +
            encodeURIComponent(order.stripe_session_id));
          sessionUrl.searchParams.set('expand[]', 'payment_intent.latest_charge');
          const session = await jsonRequest(sessionUrl.toString(), {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + stripeKey, 'Stripe-Version': STRIPE_VERSION },
          }, 'stripe_unavailable');
          const result = paymentResult(order, session);
          if (!result.status) return result;

          // A concurrent page refresh or worker may have already confirmed it.
          // Only pending rows can change, so the purchase trigger cannot fire twice.
          const updated = await db('km16_shirt_orders?id=eq.' + encodeURIComponent(order.id) +
            '&stripe_session_id=eq.' + encodeURIComponent(order.stripe_session_id) +
            '&status=eq.pending&livemode=eq.true&select=id,status',
          'PATCH', { status: result.status });
          if (!Array.isArray(updated) || updated.length > 1 ||
              (updated.length === 1 && (updated[0].id !== order.id || updated[0].status !== result.status))) {
            throw new CheckError('invalid_update_response');
          }
          return updated.length ? { outcome: result.status } : { outcome: 'skipped', code: 'order_already_changed' };
        } catch (error) {
          return { outcome: 'failed', code: error instanceof CheckError ? error.code : 'check_unavailable' };
        }
      }

      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(PARALLELISM, orders.length) }, async () => {
        while (cursor < orders.length) {
          const order = orders[cursor++];
          record(await check(order));
        }
      }));
      return reply({ ok: totals.failed === 0, ...totals, errors }, totals.failed ? 503 : 200);
    } catch (error) {
      return reply({ error: error instanceof CheckError ? error.code : 'reconciliation_unavailable' }, 503);
    }
  };
}
