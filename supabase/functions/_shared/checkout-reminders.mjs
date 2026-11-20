// Internal registry only: never sends mail or creates a Stripe payment.
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const SOURCES = {
  membership: ['km16-membership-v1', 'km16_order'],
  shirts: ['km16-shirts-v1', 'km16_shirt_order'],
  video: ['km16-checkout-v1', 'km16_video_id'],
};

export function createCheckoutReminderRecorder({
  base, serviceKey, fetcher = globalThis.fetch,
  logger = code => console.warn(code), timeoutMs = 5000,
} = {}) {
  async function rpc(name, body) {
    if (!base || !serviceKey) throw Error('checkout_reminder_registry_unavailable');
    const response = await fetcher(base.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw Error('checkout_reminder_registry_unavailable');
    return await response.json();
  }

  return {
    // Must finish before creating the Checkout Session. The SQL function verifies
    // the source order/catalogue and supersedes older attempts, including opt-outs.
    async begin({ kind, sourceId, user, optIn, livemode, amountCents }) {
      if (livemode !== true || amountCents === 0) return null;
      if (!SOURCES[kind] || typeof sourceId !== 'string' || !sourceId ||
          !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
          !UUID.test(user?.id || '') || !user?.email_confirmed_at || user?.is_anonymous ||
          typeof user.email !== 'string' || user.email.length > 254 || !EMAIL.test(user.email)) {
        throw Error('checkout_reminder_identity_invalid');
      }
      const attempt = await rpc('km16_begin_checkout_attempt', {
        p_kind: kind,
        p_source_id: sourceId,
        p_user_id: user.id,
        p_email: user.email,
        p_opt_in: optIn === true,
        p_livemode: true,
      });
      if (attempt !== null && (typeof attempt !== 'string' || !UUID.test(attempt))) {
        throw Error('checkout_reminder_registry_unavailable');
      }
      return attempt;
    },

    // Once a payment session exists, failure to attach must never turn its
    // successful response into an error encouraging the customer to pay twice.
    async attach(attempt, session, { kind, sourceId, userId, amountCents } = {}) {
      if (attempt === null) return false;
      try {
        const source = SOURCES[kind];
        if (!UUID.test(attempt || '') || !source ||
            !/^cs_live_[A-Za-z0-9]+$/.test(session?.id || '') ||
            session?.livemode !== true || session.mode !== 'payment' ||
            session.status !== 'open' || session.payment_status !== 'unpaid' ||
            !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
            session.amount_total !== amountCents || session.currency !== 'eur' ||
            session.metadata?.km16_source !== source[0] ||
            session.metadata?.[source[1]] !== sourceId ||
            kind === 'video' && (session.metadata?.km16_user_id !== userId ||
              session.client_reference_id !== userId)) {
          throw Error('checkout_reminder_session_invalid');
        }
        const attached = await rpc('km16_attach_checkout_attempt', {
          p_attempt: attempt,
          p_session_id: session.id,
          p_amount_cents: amountCents,
          p_currency: session.currency,
          p_livemode: true,
        });
        if (attached !== true) throw Error('checkout_reminder_not_attached');
        return true;
      } catch {
        // Neither the response body nor the error object may leak into logs.
        try { logger('checkout_reminder_attach_failed'); } catch { /* keep checkout successful */ }
        return false;
      }
    },
  };
}
