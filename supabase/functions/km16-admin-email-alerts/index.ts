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
    const [purchases, campaigns] = await Promise.all([
      db.from('km16_admin_purchase_notifications')
        .select('id,event_key,recipient,state,attempted_at')
        .in('state', ['failed', 'uncertain', 'sending']).limit(1000),
      db.from('km16_scheduled_mail_deliveries')
        .select('id,campaign_id,email,state,attempted_at')
        .in('state', ['failed', 'uncertain', 'sending']).limit(1000),
    ]);
    if (purchases.error || campaigns.error) {
      console.error('KM16 relances read error', purchases.error?.code, campaigns.error?.code);
      return json({ error: 'Consultation indisponible' }, 503);
    }
    const now = Date.now();
    const action = (state: string, attempted: string | null) =>
      state === 'failed' ? 'validation_requise' :
      state === 'uncertain' ? 'verification_manuelle' :
      state === 'sending' && attempted && now - Date.parse(attempted) > 15 * 60_000
        ? 'blocage_a_verifier' : null;
    const alerts = [
      ...(purchases.data || []).map(x => ({ categorie: 'achats', notification_id: x.id,
        reference: x.event_key, destinataire: x.recipient, statut: x.state,
        derniere_tentative: x.attempted_at, action_requise: action(x.state, x.attempted_at) })),
      ...(campaigns.data || []).map(x => ({ categorie: 'emails_programmes', notification_id: x.id,
        reference: x.campaign_id, destinataire: x.email, statut: x.state,
        derniere_tentative: x.attempted_at, action_requise: action(x.state, x.attempted_at) })),
    ].filter(x => x.action_requise);
    return json({ alerts, truncated: (purchases.data?.length || 0) === 1000 ||
      (campaigns.data?.length || 0) === 1000 });
  } catch (error) {
    console.error('KM16 relances unexpected error', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Consultation indisponible' }, 503);
  }
});
