// Transactional confirmation of a new free-trial request. No promotional copy,
// payment operation, attendance record or historical-recipient import.
const SITE = 'https://app.km16.fr';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>;,\r\n]+@[^\s@<>;,\r\n]+\.[^\s@<>;,\r\n]+$/;
const TRIALS = new Set(['essai', 'essai-saint-jean']);
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
class DeliveryError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function trialWelcomeMessage(jobId, recipient) {
  if (!UUID.test(jobId || '') || typeof recipient !== 'string' ||
      recipient.length > 254 || recipient !== normalizeEmail(recipient) || !EMAIL.test(recipient)) {
    throw new DeliveryError('invalid_recipient');
  }
  return {
    from: { name: 'KM16', address: 'contact@km16.fr' },
    replyTo: 'contact@km16.fr',
    to: { address: recipient },
    subject: 'Bienvenue chez KM16 — votre cours d’essai vous attend !',
    text: `Bonjour,

Bienvenue chez KM16 ! Votre demande de cours d’essai offert est bien enregistrée.

Vous pouvez venir quand vous le souhaitez, en choisissant dans notre planning une séance adaptée au pratiquant : enfants, adolescents ou adultes tous niveaux.

Consultez les horaires et le dojo correspondant avant votre venue :
${SITE}/#planning

À votre arrivée, présentez-vous à l’enseignant en précisant que vous venez pour votre cours d’essai. Nous serons heureux de vous accueillir et de vous faire découvrir le Krav Maga.

Pour toute question ou pour préparer votre première séance, répondez simplement à ce message.

À bientôt sur les tatamis !

L’équipe KM16
contact@km16.fr
`,
    messageId: '<km16-trial-welcome-' + jobId + '@km16.fr>',
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

async function equalSecret(a, b, cryptoImpl) {
  const encode = value => new TextEncoder().encode(value);
  const [x, y] = await Promise.all([a, b].map(value =>
    cryptoImpl.subtle.digest('SHA-256', encode(value)).then(buffer => new Uint8Array(buffer))));
  let different = 0;
  for (let i = 0; i < x.length; i++) different |= x[i] ^ y[i];
  return different === 0;
}

export function createTrialWelcomeHandler({ env, fetcher, createMailer,
  cryptoImpl = globalThis.crypto, now = Date.now, timers = globalThis }) {
  return async request => {
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (request.headers.has('origin')) return reply({ error: 'forbidden' }, 403);
    const token = request.headers.get('x-km16-automation') || '';
    if (token.length < 64 || token.length > 512) return reply({ error: 'forbidden' }, 403);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 1024) return reply({ error: 'invalid_request' }, 400);
      body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.action !== 'work') throw Error();
    } catch { return reply({ error: 'invalid_request' }, 400); }
    const base = (env('SUPABASE_URL') || '').replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!base.startsWith('https://') || !key) return reply({ error: 'configuration_unavailable' }, 503);
    const deadline = now() + 50000;
    const authHeaders = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    async function jsonRequest(path, method = 'GET', data, allow404 = false) {
      const remaining = Math.floor(deadline - now());
      if (remaining <= 0) throw new DeliveryError('time_budget_exhausted');
      try {
        const response = await fetcher(base + path, {
          method, headers: { ...authHeaders, Prefer: 'return=representation' },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
          signal: AbortSignal.timeout(Math.min(8000, remaining)),
        });
        if (allow404 && response.status === 404) return null;
        if (!response.ok) throw new DeliveryError('service_unavailable');
        return await response.json();
      } catch (error) {
        throw error instanceof DeliveryError ? error : new DeliveryError('service_unavailable');
      }
    }
    const db = (path, method = 'GET', data) => jsonRequest('/rest/v1/' + path, method, data);
    let job, mailer, smtpStarted = false, acceptedBySmtp = false;
    async function finish(state, errorCode = null) {
      const rows = await db('km16_trial_welcome_queue?id=eq.' + job.id + '&state=eq.sending', 'PATCH', {
        state, error_code: errorCode, ...(state === 'accepted' ? { sent_at: new Date(now()).toISOString() } : {}),
      });
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== job.id || rows[0].state !== state) {
        throw new DeliveryError('delivery_persistence_unverified');
      }
    }
    try {
      const settings = (await db('km16_automation_settings?select=token,enabled&id=eq.1'))?.[0];
      if (settings?.enabled !== true || typeof settings.token !== 'string' || settings.token.length < 64 ||
          settings.token.length > 512 || !await equalSecret(token, settings.token, cryptoImpl)) {
        return reply({ error: 'forbidden' }, 403);
      }
      if (!env('KM16_DOCUMENTS_SMTP_PASSWORD')) return reply({ error: 'smtp_unavailable' }, 503);
      const jobs = await db('rpc/km16_claim_trial_welcome', 'POST', {});
      if (!Array.isArray(jobs) || jobs.length > 1) throw new DeliveryError('invalid_claim_response');
      if (jobs.length === 0) return reply({ ok: true, claimed: 0, accepted: 0 });
      job = jobs[0];
      if (!job || !UUID.test(job.id || '') || !UUID.test(job.order_id || '') || job.state !== 'sending') {
        job = null;
        throw new DeliveryError('invalid_claim_row');
      }
      const orders = await db('km16_membership_orders?id=eq.' + job.order_id +
        '&select=id,user_id,email,product_id,total_cents,livemode,approval');
      const order = Array.isArray(orders) && orders.length === 1 ? orders[0] : null;
      const recipient = normalizeEmail(order?.email);
      if (!order || order.id !== job.order_id || !UUID.test(order.user_id || '') ||
          order.livemode !== true || order.total_cents !== 0 || !TRIALS.has(order.product_id) ||
          !['pending', 'approved'].includes(order.approval) || recipient.length > 254 || !EMAIL.test(recipient)) {
        await finish('skipped', 'order_ineligible');
        return reply({ ok: true, claimed: 1, skipped: 1 });
      }
      const account = await jsonRequest('/auth/v1/admin/users/' + order.user_id, 'GET', undefined, true);
      const user = account?.user || account;
      if (!user || user.id !== order.user_id || !user.email_confirmed_at || user.is_anonymous === true ||
          normalizeEmail(user.email) !== recipient || Date.parse(user.banned_until || '') > now()) {
        await finish('skipped', 'identity_changed');
        return reply({ ok: true, claimed: 1, skipped: 1 });
      }
      const message = trialWelcomeMessage(job.id, recipient);
      // The final database guard also detects a rejected/changed order or pause
      // committed while the current account was being verified.
      const permitted = await db('rpc/km16_prepare_trial_welcome_send', 'POST', {
        p_id: job.id, p_user_id: order.user_id, p_email: recipient,
      });
      if (permitted !== true) {
        await finish('skipped', 'no_longer_eligible');
        return reply({ ok: true, claimed: 1, skipped: 1 });
      }
      if (deadline - now() < 23000) throw new DeliveryError('time_budget_exhausted');
      mailer = createMailer();
      smtpStarted = true;
      let timeout;
      try {
        const result = await Promise.race([
          mailer.sendMail(message),
          new Promise((_, reject) => {
            timeout = timers.setTimeout(() => reject(new DeliveryError('smtp_timeout')), 20000);
          }),
        ]);
        acceptedBySmtp = Array.isArray(result?.accepted) && result.accepted.some(value =>
          normalizeEmail(typeof value === 'string' ? value : value?.address) === recipient);
        if (!acceptedBySmtp) {
          await finish('failed', 'smtp_rejected');
          return reply({ ok: true, claimed: 1, failed: 1 });
        }
      } finally { timers.clearTimeout(timeout); }
      await finish('accepted');
      return reply({ ok: true, claimed: 1, accepted: 1 });
    } catch (error) {
      const code = error instanceof DeliveryError ? error.code : 'delivery_unavailable';
      if (job) {
        try { await finish(smtpStarted ? 'uncertain' : 'failed', code); } catch { /* Stale sending is never reclaimed. */ }
      }
      return reply({ ok: false, error: code,
        ...(job ? { claimed: 1, [smtpStarted ? 'uncertain' : 'failed']: 1,
          ...(acceptedBySmtp ? { smtp_accepted: 1 } : {}) } : {}),
      }, 503);
    } finally { try { mailer?.close(); } catch { /* Delivery state already recorded. */ } }
  };
}
