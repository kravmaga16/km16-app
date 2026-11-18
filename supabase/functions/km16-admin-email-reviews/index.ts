// Administrative review journal only. Never sends mail or changes delivery states.
// The Auth server verifies the caller; service_role remains on this server only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.10';

const ORIGIN = 'https://app.km16.fr';
const ADMIN_EMAIL = 'alexandre.marchat@gmail.com';
const TABLE = 'km16_email_alert_reviews';
const COLUMNS = 'id,request_id,categorie,notification_id,decision,note,observed_state,observed_attempted_at,previous_review_id,recorded_by,recorded_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ['achats', 'emails_programmes'];
const DECISIONS = ['verification_effectuee', 'a_reexaminer', 'ne_pas_relancer'];
const STATES = ['pending', 'sending', 'accepted', 'failed', 'uncertain'];
const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
  'Cache-Control': 'no-store',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
});
const positiveId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const nonnegativeId = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const uuid = (value: unknown) => typeof value === 'string' && UUID.test(value);
function validTimestamp(value: unknown) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$/.test(value)) return false;
  if (Number(value.slice(0, 4)) === 0 || !Number.isFinite(Date.parse(value))) return false;
  // Reject calendar overflow while keeping the original microseconds and offset.
  return new Date(value.slice(0, 10) + 'T00:00:00.000Z').toISOString().slice(0, 10) === value.slice(0, 10);
}
function validReviewIds(row: Record<string, unknown>) {
  return row && positiveId(row.id) && positiveId(row.notification_id) && nonnegativeId(row.previous_review_id);
}
function databaseError(error: { code?: string }) {
  if (error.code === 'PT409') return json({ error: 'La notification ou le journal a changé. Actualisez les alertes et leur historique avant de réessayer.' }, 409);
  if (error.code === 'PT404') return json({ error: 'Notification introuvable. Actualisez les alertes.' }, 404);
  if (['22023', '22P02', '22007', '22008'].includes(error.code || '')) return json({ error: 'Paramètres invalides.' }, 400);
  console.error('KM16 email review database error', error.code || 'unknown');
  return json({ error: 'Journal indisponible.' }, 503);
}

Deno.serve(async (req) => {
  if (req.headers.get('origin') !== ORIGIN) return new Response(JSON.stringify({ error: 'Origine refusée' }), {
    status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' },
  });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode refusée' }, 405);
  const token = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!token) return json({ error: 'Authentification requise' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !secret) return json({ error: 'Configuration serveur indisponible' }, 503);
  try {
    const authClient = createClient(url, anon, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json({ error: 'Session invalide' }, 401);
    if (user.email?.toLowerCase() !== ADMIN_EMAIL || !user.email_confirmed_at || user.is_anonymous || !uuid(user.id))
      return json({ error: 'Accès refusé' }, 403);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !CATEGORIES.includes(body.categorie) || !positiveId(body.notification_id))
      return json({ error: 'Requête invalide' }, 400);

    if (body.action === 'history') {
      const allowed = ['action', 'categorie', 'notification_id', 'before_id'];
      if (Object.keys(body).some(key => !allowed.includes(key)) ||
        (body.before_id !== undefined && !positiveId(body.before_id)))
        return json({ error: 'Paramètres d’historique invalides' }, 400);
      const db = createClient(url, secret, { auth: { persistSession: false } });
      let query = db.from(TABLE).select(COLUMNS)
        .eq('categorie', body.categorie).eq('notification_id', body.notification_id)
        .order('id', { ascending: false });
      if (body.before_id !== undefined) query = query.lt('id', body.before_id);
      const { data, error } = await query.limit(21);
      if (error) return databaseError(error);
      if (!Array.isArray(data) || data.some(row => !validReviewIds(row)))
        return json({ error: 'Journal indisponible.' }, 503);
      const reviews = data.slice(0, 20), hasMore = data.length > 20;
      return json({ reviews, has_more: hasMore, next_before_id: hasMore ? reviews.at(-1)!.id : null });
    }

    if (body.action === 'record') {
      const allowed = ['action', 'categorie', 'notification_id', 'request_id', 'expected_state',
        'expected_attempted_at', 'expected_last_review_id', 'decision', 'note'];
      if (Object.keys(body).some(key => !allowed.includes(key)) ||
        !uuid(body.request_id) || !STATES.includes(body.expected_state) ||
        !validTimestamp(body.expected_attempted_at) || !nonnegativeId(body.expected_last_review_id) ||
        !DECISIONS.includes(body.decision) || typeof body.note !== 'string')
        return json({ error: 'Paramètres de vérification invalides' }, 400);
      const note = body.note.trim(), length = Array.from(note).length;
      if (length < 3 || length > 1000 || note.includes('\0'))
        return json({ error: 'Le commentaire doit contenir entre 3 et 1 000 caractères.' }, 400);
      const db = createClient(url, secret, { auth: { persistSession: false } });
      const { data, error } = await db.rpc('km16_record_email_alert_review', {
        p_request_id: body.request_id,
        p_categorie: body.categorie,
        p_notification_id: body.notification_id,
        p_expected_state: body.expected_state,
        // Preserve the database timestamp precision when comparing the observation.
        p_expected_attempted_at: body.expected_attempted_at,
        p_expected_last_review_id: body.expected_last_review_id,
        p_decision: body.decision,
        p_note: note,
        p_actor_id: user.id,
      });
      if (error) return databaseError(error);
      if (!Array.isArray(data) || data.length !== 1 || !validReviewIds(data[0]))
        return json({ error: 'Journal indisponible.' }, 503);
      return json({ review: data[0] });
    }
    return json({ error: 'Action invalide' }, 400);
  } catch (error) {
    console.error('KM16 email review unexpected error', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Journal indisponible.' }, 503);
  }
});
