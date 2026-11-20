// Customer payment reminders use a separate, consented outbox. No purchase is
// created, charged, cancelled or refunded by this worker.
const APP = 'https://app.km16.fr';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const SESSION = /^cs_live_[A-Za-z0-9]+$/;
const EMAIL = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const SIZES = new Set(['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL']);
const BATCH = 2;
const REQUEST_TIMEOUT = 8000;
const RUN_BUDGET = 50000;
const STRIPE_VERSION = '2026-11-18.endive';
const SOURCES = {
  membership: ['KM16_ADHESIONS_STRIPE_SECRET_KEY', 'km16-membership-v1', 'km16_order'],
  shirts: ['KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY', 'km16-shirts-v1', 'km16_shirt_order'],
  video: ['STRIPE_SECRET_KEY', 'km16-checkout-v1', 'km16_video_id'],
};
class WorkerError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const normalEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
const hashToken = (token, cryptoImpl) => cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(hex);
async function sameToken(a, b, cryptoImpl) {
  const [x, y] = await Promise.all([hashToken(a, cryptoImpl), hashToken(b, cryptoImpl)]);
  let different = 0;
  for (let i = 0; i < x.length; i++) different |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return different === 0;
}

function validAttempt(row) {
  return row && SOURCES[row.kind] && UUID.test(row.id || '') && UUID.test(row.user_id || '') &&
    typeof row.source_id === 'string' && row.source_id.length > 0 && row.source_id.length < 256 &&
    typeof row.product_id === 'string' && row.product_id.length > 0 && row.product_id.length < 256 &&
    typeof row.group_key === 'string' && row.group_key.length > 0 && row.group_key.length < 512 &&
    row.livemode === true && SESSION.test(row.stripe_session_id || '') &&
    Number.isSafeInteger(row.amount_cents) && row.amount_cents > 0 &&
    row.email === normalEmail(row.email) && row.email.length <= 254 && EMAIL.test(row.email);
}

// Stripe can finish a payment before its webhook reaches our database. A complete
// session or an in-flight PaymentIntent is therefore never an abandoned payment.
export function classifySession(row, session) {
  const source = SOURCES[row.kind];
  if (!source || session?.id !== row.stripe_session_id || session.livemode !== true ||
      session.mode !== 'payment' || session.currency !== 'eur' || session.amount_total !== row.amount_cents ||
      session.metadata?.km16_source !== source[1] || session.metadata?.[source[2]] !== row.source_id ||
      row.kind === 'video' && (session.metadata?.km16_user_id !== row.user_id || session.client_reference_id !== row.user_id) ||
      [session.customer_email, session.customer_details?.email].some(value => value && normalEmail(value) !== row.email)) {
    return { state: 'skipped', code: 'stripe_session_mismatch' };
  }
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required' || session.status === 'complete') {
    return { state: 'skipped', code: 'payment_completed_or_processing' };
  }
  if (session.status === 'open') return { state: 'pending', code: 'checkout_still_open' };
  if (session.status !== 'expired' || session.payment_status !== 'unpaid') {
    return { state: 'pending', code: 'stripe_state_unverified' };
  }
  const intent = session.payment_intent;
  if (intent === null) return { state: 'eligible' };
  if (!intent || typeof intent !== 'object' || !/^pi_[A-Za-z0-9]+$/.test(intent.id || '') ||
      intent.livemode !== true || intent.currency !== 'eur' || intent.amount !== row.amount_cents ||
      !Number.isSafeInteger(intent.amount_received)) {
    return { state: 'pending', code: 'payment_intent_unverified' };
  }
  if (intent.amount_received > 0 || intent.status === 'succeeded') {
    return { state: 'skipped', code: 'payment_received' };
  }
  const charge = intent.latest_charge;
  if (charge !== null && (typeof charge !== 'object' || !charge ||
      !/^ch_[A-Za-z0-9]+$/.test(charge.id || '') || charge.amount !== row.amount_cents ||
      charge.livemode !== true || charge.currency !== 'eur' ||
      (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id) !== intent.id)) {
    return { state: 'pending', code: 'charge_unverified' };
  }
  if (charge && (charge.paid === true || charge.refunded === true || charge.amount_refunded > 0 || charge.disputed === true)) {
    return { state: 'skipped', code: 'payment_received_refunded_or_disputed' };
  }
  if (charge && (charge.paid !== false || charge.refunded !== false || charge.disputed !== false ||
      charge.amount_refunded !== 0 || charge.captured !== false || charge.amount_captured !== 0)) {
    return { state: 'pending', code: 'charge_unverified' };
  }
  if (intent.amount_received !== 0 || !['canceled', 'requires_payment_method'].includes(intent.status)) {
    return { state: 'pending', code: 'payment_in_progress' };
  }
  return { state: 'eligible' };
}

export function reminderMessage(row, rawToken) {
  let resume;
  if (row.kind === 'membership' && UUID.test(row.source_id)) {
    resume = APP + '/adhesion.html?espace=1&order=' + encodeURIComponent(row.source_id);
  } else if (row.kind === 'shirts' && Array.isArray(row.sizes) && row.sizes.length >= 1 &&
      row.sizes.length <= 2 && row.sizes.every(size => SIZES.has(size))) {
    resume = APP + '/tee-shirts.html?sizes=' + row.sizes.map(encodeURIComponent).join(',');
  } else if (row.kind === 'video') {
    resume = APP + '/#videos';
  } else throw new WorkerError('resume_link_unavailable');
  if (!TOKEN.test(rawToken) || !UUID.test(row.id) || !EMAIL.test(row.email) || row.email.length > 254) {
    throw new WorkerError('message_unavailable');
  }
  const title = typeof row.title === 'string' ? row.title.replace(/[\r\n\t]/g, ' ').trim().slice(0, 200) : '';
  if (!title) throw new WorkerError('product_unavailable');
  const stop = APP + '/checkout-reminder-stop.html#' + rawToken;
  return {
    from: { name: 'KM16', address: 'contact@km16.fr' },
    replyTo: 'contact@km16.fr',
    to: { address: row.email },
    subject: 'KM16 — souhaitez-vous reprendre votre demande ?',
    text: `Bonjour,\n\nVous avez commencé une demande pour ${title}, mais aucun paiement confirmé n’y est encore associé.\n\nSi vous souhaitez poursuivre, vous pouvez retrouver votre demande et vérifier les informations avant de régler :\n${resume}\n\nNous pouvons vous aider si vous avez rencontré une difficulté. Répondez simplement à cet e-mail ou contactez-nous à contact@km16.fr.\n\nSi vous venez d’effectuer le paiement, ne le recommencez pas : contactez-nous en cas de doute.\n\nVous ne souhaitez plus donner suite ? Aucune action n’est nécessaire.\n\nL’équipe KM16\ncontact@km16.fr\n\nNe plus recevoir de rappels de paiement :\n${stop}\n`,
    messageId: '<km16-checkout-reminder-' + row.id + '@km16.fr>',
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function createCheckoutReminderHandler({ env, fetcher, createMailer, cryptoImpl = globalThis.crypto, now = Date.now, timers = globalThis }) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin === APP) Object.assign(headers, {
      'Access-Control-Allow-Origin': APP,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && origin !== APP) return reply({ error: 'forbidden' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    let body;
    try {
      const text = await request.text();
      if (text.length > 2048) return reply({ error: 'invalid_request' }, 400);
      body = text ? JSON.parse(text) : {};
      if (!body || Array.isArray(body) || typeof body !== 'object') throw Error();
    } catch { return reply({ error: 'invalid_request' }, 400); }
    const base = (env('SUPABASE_URL') || '').replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!base.startsWith('https://') || !key) return reply({ error: 'configuration_unavailable' }, 503);
    const deadline = now() + RUN_BUDGET;
    async function jsonRequest(url, init, code, allow404 = false) {
      const remaining = Math.floor(deadline - now());
      if (remaining <= 0) throw new WorkerError('time_budget_exhausted');
      try {
        const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT, remaining)) });
        if (allow404 && response.status === 404) return null;
        if (!response.ok) throw new WorkerError(code);
        return await response.json();
      } catch (error) {
        if (error instanceof WorkerError) throw error;
        throw new WorkerError(code);
      }
    }
    const authHeaders = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    const db = (path, method = 'GET', data) => jsonRequest(base + '/rest/v1/' + path, {
      method, headers: authHeaders, ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }, 'database_unavailable');
    let mailer;
    try {
      if (body.action === 'unsubscribe') {
        if (!TOKEN.test(body.token || '')) return reply({ error: 'invalid_link' }, 400);
        const stopped = await db('rpc/km16_stop_checkout_reminders', 'POST', { p_token_hash: await hashToken(body.token, cryptoImpl) });
        if (stopped !== true) throw new WorkerError('unsubscribe_unavailable');
        return reply({ ok: true });
      }
      if (body.action && body.action !== 'work') return reply({ error: 'invalid_request' }, 400);
      const token = request.headers.get('x-km16-automation') || '';
      if (token.length < 64 || token.length > 512) return reply({ error: 'forbidden' }, 403);
      const settings = (await db('km16_automation_settings?select=token,enabled&id=eq.1'))?.[0];
      if (settings?.enabled !== true || typeof settings.token !== 'string' || settings.token.length < 64 ||
          settings.token.length > 512 || !await sameToken(token, settings.token, cryptoImpl)) {
        return reply({ error: 'forbidden' }, 403);
      }
      if (!env('KM16_DOCUMENTS_SMTP_PASSWORD')) return reply({ error: 'smtp_unavailable' }, 503);
      const rows = await db('rpc/km16_claim_checkout_reminders', 'POST', { p_limit: BATCH });
      if (!Array.isArray(rows) || rows.length > BATCH) throw new WorkerError('invalid_claim_response');
      const totals = { claimed: rows.length, accepted: 0, failed: 0, uncertain: 0, skipped: 0, deferred: 0 };
      const errors = {};
      const recordError = code => { errors[code] = (errors[code] || 0) + 1; };
      const finish = async (row, state, code = null) => {
        const persisted = await db('rpc/km16_finish_checkout_reminder', 'POST', {
          p_id: row.id, p_lock_token: row.lock_token, p_state: state, p_error: code,
        });
        if (persisted !== true) throw new WorkerError('delivery_persistence_unverified');
        return true;
      };
      const sessions = new Map();
      async function checkStripe(row) {
        if (!validAttempt(row)) throw new WorkerError('attempt_unverified');
        const stripeKey = env(SOURCES[row.kind][0]) || '';
        if (!stripeKey.startsWith('sk_live_')) throw new WorkerError('stripe_unavailable');
        const cacheKey = row.kind + ':' + row.stripe_session_id;
        if (!sessions.has(cacheKey)) {
          const url = new URL('https://api.stripe.com/v1/checkout/sessions/' + row.stripe_session_id);
          url.searchParams.set('expand[]', 'payment_intent.latest_charge');
          sessions.set(cacheKey, await jsonRequest(url.toString(), {
            method: 'GET', headers: { Authorization: 'Bearer ' + stripeKey, 'Stripe-Version': STRIPE_VERSION },
          }, 'stripe_unavailable'));
        }
        return classifySession(row, sessions.get(cacheKey));
      }
      for (const row of rows) {
        let sending = false;
        let smtpResult;
        try {
          if (!validAttempt(row) || !UUID.test(row.lock_token || '') || row.opt_in !== true || row.state !== 'checking') {
            throw new WorkerError('invalid_claim_row');
          }
          if (deadline - now() < 22000) throw new WorkerError('time_budget_exhausted');
          const user = await jsonRequest(base + '/auth/v1/admin/users/' + row.user_id, {
            method: 'GET', headers: authHeaders,
          }, 'identity_unavailable', true);
          if (!user || user.id !== row.user_id || !user.email_confirmed_at || user.is_anonymous === true ||
              normalEmail(user.email) !== row.email || Date.parse(user.banned_until || '') > now()) {
            await finish(row, 'skipped', 'identity_changed'); totals.skipped++; continue;
          }
          let result = await checkStripe(row);
          if (result.state === 'eligible') {
            const since = Date.parse(row.created_at) - 7 * 86400000;
            if (!Number.isFinite(since)) throw new WorkerError('invalid_claim_row');
            const query = new URLSearchParams({
              user_id: 'eq.' + row.user_id, kind: 'eq.' + row.kind,
              group_key: 'eq.' + row.group_key, livemode: 'eq.true',
              created_at: 'gte.' + new Date(since).toISOString(), order: 'created_at.desc', limit: '21',
            });
            const related = await db('km16_checkout_reminders?' + query);
            if (!Array.isArray(related) || related.length > 20 || !related.some(attempt => attempt.id === row.id)) {
              throw new WorkerError('related_attempts_unverified');
            }
            for (const other of related) {
              if (other.id === row.id || other.stripe_session_id === row.stripe_session_id) continue;
              if (other.user_id !== row.user_id || other.kind !== row.kind || other.group_key !== row.group_key || other.product_id !== row.product_id ||
                  !other.stripe_session_id) throw new WorkerError('related_attempts_unverified');
              result = await checkStripe(other);
              if (result.state !== 'eligible') break;
            }
          }
          if (result.state !== 'eligible') {
            await finish(row, result.state, result.code);
            totals[result.state === 'pending' ? 'deferred' : 'skipped']++;
            continue;
          }
          const rawToken = hex(cryptoImpl.getRandomValues(new Uint8Array(32)));
          const message = reminderMessage(row, rawToken);
          if (deadline - now() < 22000) throw new WorkerError('time_budget_exhausted');
          const prepared = await db('rpc/km16_prepare_checkout_reminder_send', 'POST', {
            p_id: row.id, p_lock_token: row.lock_token, p_token_hash: await hashToken(rawToken, cryptoImpl),
          });
          if (prepared !== true) { totals.skipped++; continue; }
          sending = true;
          try {
            mailer ||= createMailer();
            // SMTP's individual connection/socket timeouts do not bound the
            // whole conversation. Keep time for persisting an uncertain result.
            let timeout;
            let response;
            try {
              response = await Promise.race([
                mailer.sendMail(message),
                new Promise((_, reject) => {
                  timeout = timers.setTimeout(() => {
                    try { mailer?.close?.(); } catch { /* outcome remains uncertain */ }
                    mailer = undefined;
                    reject(new WorkerError('smtp_result_uncertain'));
                  }, Math.min(20000, Math.max(1, deadline - now() - 8000)));
                }),
              ]);
            } finally { timers.clearTimeout(timeout); }
            const accepted = Array.isArray(response?.accepted) && response.accepted.some(
              address => normalEmail(typeof address === 'string' ? address : address?.address) === row.email,
            );
            smtpResult = accepted ? { state: 'accepted', code: null } : { state: 'failed', code: 'smtp_rejected' };
          } catch (error) {
            const responseCode = Number(error?.responseCode);
            const definitive = responseCode >= 400 && responseCode <= 599 || ['EAUTH', 'EDNS', 'ECONNECTION'].includes(error?.code);
            smtpResult = { state: definitive ? 'failed' : 'uncertain', code: definitive ? 'smtp_error' : 'smtp_result_uncertain' };
          }
          // A failed persistence after SMTP leaves sending in place. Its lease
          // expires to uncertain, never back to pending, preventing a duplicate.
          if (await finish(row, smtpResult.state, smtpResult.code) !== true) throw new WorkerError('delivery_persistence_unverified');
          totals[smtpResult.state]++;
        } catch (error) {
          const code = error instanceof WorkerError ? error.code : 'reminder_unavailable';
          recordError(code);
          if (sending) { totals.uncertain++; continue; }
          totals.deferred++;
          if (UUID.test(row?.id || '') && UUID.test(row?.lock_token || '')) {
            try { await finish(row, 'pending', code); } catch { recordError('defer_persistence_unavailable'); }
          }
        }
      }
      return reply({ ok: Object.keys(errors).length === 0, ...totals, errors }, Object.keys(errors).length ? 503 : 200);
    } catch (error) {
      return reply({ error: error instanceof WorkerError ? error.code : 'reminder_unavailable' }, 503);
    } finally { try { mailer?.close?.(); } catch { /* never change the persisted outcome */ } }
  };
}
