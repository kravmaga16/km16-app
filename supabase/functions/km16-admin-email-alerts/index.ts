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
  if (req.headers.get('origin') !== ORIGIN) return json({ error: 'Origine refusée' }, 403);
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
    // Existing KM16 admin convention. Before deployment, replace this email
    // allowlist with the central server-side admin authorization mechanism.
    if (user.email?.toLowerCase() !== ADMIN_EMAIL || !user.email_confirmed_at)
      return json({ error: 'Accès refusé' }, 403);
    const db = createClient(url, secret, { auth: { persistSession: false } });
    // Only actionable records are queried. Pagination is explicit per source;
    // the client must not interpret a partial page as the complete queue.
    const body = await req.json().catch(() => ({}));
    const page = body?.page ?? 0;
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
      return json({ error: 'Page invalide' }, 400);
    const size = 100, from = page * size, to = from + size;
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const filter = `state.in.(failed,uncertain),and(state.eq.sending,attempted_at.lt.${cutoff})`;
    const [purchases, campaigns] = await Promise.all([
      db.from('km16_admin_purchase_notifications')
        .select('id,event_key,recipient,state,attempted_at')
        .or(filter).order('id', { ascending: true }).range(from, to),
      db.from('km16_scheduled_mail_deliveries')
        .select('id,campaign_id,email,state,attempted_at')
        .or(filter).order('id', { ascending: true }).range(from, to),
    ]);
    if (purchases.error || campaigns.error) {
      console.error('KM16 relances read error', purchases.error?.code, campaigns.error?.code);
      return json({ error: 'Consultation indisponible' }, 503);
    }
    const action = (state: string) =>
      state === 'failed' ? 'validation_requise' :
      state === 'uncertain' ? 'verification_manuelle' : 'blocage_a_verifier';
    const alerts = [
      ...(purchases.data || []).slice(0,size).map(x => ({ categorie: 'achats', notification_id: x.id,
        reference: x.event_key, destinataire: x.recipient, statut: x.state,
        derniere_tentative: x.attempted_at, action_requise: action(x.state) })),
      ...(campaigns.data || []).slice(0,size).map(x => ({ categorie: 'emails_programmes', notification_id: x.id,
        reference: x.campaign_id, destinataire: x.email, statut: x.state,
        derniere_tentative: x.attempted_at, action_requise: action(x.state) })),
    ];
    return json({ alerts, page, has_more: (purchases.data?.length || 0) > size ||
      (campaigns.data?.length || 0) > size });
  } catch (error) {
    console.error('KM16 relances unexpected error', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Consultation indisponible' }, 503);
  }
});
