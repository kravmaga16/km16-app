// KM16 - read-only email follow-up alerts.
// SOURCE ONLY: not deployed. Requires SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY in the server environment. Never bundle in GitHub Pages.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.10';

const ORIGIN = 'https://app.km16.fr';
const ADMIN_EMAIL = 'alexandre.marchat@gmail.com';
const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
Deno.serve(async (req) => {
  if (req.headers.get('origin') !== ORIGIN) return new Response(JSON.stringify({ error: 'Origine refusée' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode refusée' }, 405);
  const token = /^Bearer (.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!token) return json({ error: 'Authentification requise' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !secret) return json({ error: 'Configuration serveur indisponible' }, 503);
  try {
    const authClient = createClient(url, anon, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json({ error: 'Session invalide' }, 401);
    // Existing KM16 admin convention, checked against the Auth server response.
    if (user.email?.toLowerCase() !== ADMIN_EMAIL || !user.email_confirmed_at || user.is_anonymous)
      return json({ error: 'Accès refusé' }, 403);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Requête invalide' }, 400);
    const page = body.page === undefined ? 0 : body.page;
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
      return json({ error: 'Page invalide' }, 400);
    // Keyset pagination survives earlier rows leaving the actionable set.
    // Freeze the time threshold throughout the scan. This is a live read,
    // not a transactional snapshot: refresh to recheck rows already visited.
    const now = Date.now();
    const cursor = page === 0 ? {
      observed_at: new Date(now).toISOString(), purchases_after: 0, campaigns_after: 0,
    } : body.cursor;
    if ((page === 0 && body.cursor !== undefined) ||
      !cursor || typeof cursor !== 'object' || Array.isArray(cursor) ||
      typeof cursor.observed_at !== 'string' ||
      !Number.isFinite(Date.parse(cursor.observed_at)) ||
      new Date(cursor.observed_at).toISOString() !== cursor.observed_at ||
      Date.parse(cursor.observed_at) < 0 || Date.parse(cursor.observed_at) > now ||
      !Number.isSafeInteger(cursor.purchases_after) || cursor.purchases_after < 0 ||
      !Number.isSafeInteger(cursor.campaigns_after) || cursor.campaigns_after < 0)
      return json({ error: 'Curseur invalide' }, 400);
    const size = 100;
    const cutoff = new Date(Date.parse(cursor.observed_at) - 15 * 60_000).toISOString();
    const filter = `state.in.(failed,uncertain),and(state.eq.sending,attempted_at.lt.${cutoff})`;
    const db = createClient(url, secret, { auth: { persistSession: false } });
    const [purchases, campaigns] = await Promise.all([
      db.from('km16_admin_purchase_notifications')
        .select('id,event_key,recipient,state,attempted_at')
        .or(filter).gt('id', cursor.purchases_after).order('id', { ascending: true }).limit(size + 1),
      db.from('km16_scheduled_mail_deliveries')
        .select('id,campaign_id,email,state,attempted_at')
        .or(filter).gt('id', cursor.campaigns_after).order('id', { ascending: true }).limit(size + 1),
    ]);
    if (purchases.error || campaigns.error) {
      console.error('KM16 relances read error', purchases.error?.code, campaigns.error?.code);
      return json({ error: 'Consultation indisponible' }, 503);
    }
    const purchaseRows = (purchases.data || []).slice(0, size);
    const campaignRows = (campaigns.data || []).slice(0, size);
    // JSON numbers must preserve IDs exactly for cursor comparisons.
    if ([...purchaseRows, ...campaignRows].some(x => !Number.isSafeInteger(x.id) || x.id <= 0))
      return json({ error: 'Consultation indisponible' }, 503);
    const action = (state: string) =>
      state === 'failed' ? 'validation_requise' :
      state === 'uncertain' ? 'verification_manuelle' : 'blocage_a_verifier';
    const alerts = [
      ...purchaseRows.map(x => ({ categorie: 'achats', notification_id: x.id,
        reference: x.event_key, destinataire: x.recipient, statut: x.state,
        derniere_tentative: x.attempted_at, action_requise: action(x.state) })),
      ...campaignRows.map(x => ({ categorie: 'emails_programmes', notification_id: x.id,
        reference: x.campaign_id, destinataire: x.email, statut: x.state,
        derniere_tentative: x.attempted_at, action_requise: action(x.state) })),
    ];
    return json({ alerts, page, has_more: (purchases.data?.length || 0) > size ||
      (campaigns.data?.length || 0) > size, cursor: {
        observed_at: cursor.observed_at,
        purchases_after: purchaseRows.at(-1)?.id ?? cursor.purchases_after,
        campaigns_after: campaignRows.at(-1)?.id ?? cursor.campaigns_after,
      } });
  } catch (error) {
    console.error('KM16 relances unexpected error', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Consultation indisponible' }, 503);
  }
});
