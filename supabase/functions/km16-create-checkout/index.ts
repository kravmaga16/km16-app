// KM16 : creation du paiement Stripe
// Fonction : km16-create-checkout
// Desactiver Verify JWT apres deploiement.
// Le compte acheteur est verifie dans le code.
import { createCheckoutReminderRecorder } from '../_shared/checkout-reminders.mjs';

const SITE = "https://app.km16.fr";
const VIDEO = "shadow-boxing";
const PRICE = "price_1UUnXGFTSrnM01K8lC5NsfY3";

const headers = {
  "Access-Control-Allow-Origin": SITE,
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function reply(status, data) {
  return new Response(JSON.stringify(data), { status, headers });
}

Deno.serve(async (req) => {
  if (req.headers.get("origin") !== SITE) {
    return reply(403, { error: "Origine non autorisee" });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return reply(405, { error: "Methode non autorisee" });
  }

  const base = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (!base || !service || !stripeKey) {
    return reply(503, { error: "Configuration incomplete" });
  }

  const authorization = req.headers.get("authorization") || "";
  if (!/^Bearer \S+$/i.test(authorization)) {
    return reply(401, { error: "Connectez-vous pour acheter" });
  }

  try {
    // Verification du compte aupres de Supabase.
    const authResponse = await fetch(base + "/auth/v1/user", {
      headers: { apikey: service, Authorization: authorization },
    });
    if (!authResponse.ok) {
      return reply(401, { error: "Reconnectez-vous" });
    }
    const user = await authResponse.json();
    if (!user.id || !user.email || !user.email_confirmed_at ||
        user.is_anonymous) {
      return reply(403, { error: "Confirmez votre adresse e-mail" });
    }

    const body = await req.json().catch(() => null);
    if (!body || body.video_id !== VIDEO) {
      return reply(400, { error: "Video inconnue" });
    }

    const dbHeaders = {
      apikey: service,
      Authorization: "Bearer " + service,
    };

    const catalogResponse = await fetch(
      base + "/rest/v1/km16_videos?id=eq." + VIDEO +
        "&select=id,published,stripe_price_id,price_cents,currency",
      { headers: dbHeaders },
    );
    if (!catalogResponse.ok) throw new Error("Catalogue inaccessible");
    const catalog = await catalogResponse.json();
    const video = catalog[0];

    if (!video || !video.published) {
      return reply(409, { error: "Video pas encore disponible" });
    }
    if (video.stripe_price_id !== PRICE ||
        video.price_cents !== 999 || video.currency !== "eur") {
      throw new Error("Tarif catalogue incorrect");
    }

    const purchasesResponse = await fetch(
      base + "/rest/v1/km16_purchases?user_id=eq." +
        encodeURIComponent(user.id) +
        "&video_id=eq." + VIDEO + "&status=eq.paid&select=video_id&limit=1",
      { headers: dbHeaders },
    );
    if (!purchasesResponse.ok) throw new Error("Achats inaccessibles");
    const purchases = await purchasesResponse.json();
    if (purchases.length) {
      return reply(409, { error: "Vous possedez deja cette video" });
    }

    const priceResponse = await fetch(
      "https://api.stripe.com/v1/prices/" + PRICE,
      { headers: { Authorization: "Bearer " + stripeKey } },
    );
    if (!priceResponse.ok) throw new Error("Tarif Stripe inaccessible");
    const price = await priceResponse.json();
    if (!price.active || price.type !== "one_time" ||
        price.unit_amount !== 999 || price.currency !== "eur") {
      throw new Error("Tarif Stripe incorrect");
    }

    // Le prix et l'identite viennent du serveur.
    const params = new URLSearchParams({
      mode: "payment",
      "line_items[0][price]": PRICE,
      "line_items[0][quantity]": "1",
      "payment_method_types[0]": "card",
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: SITE +
        "/?payment=success&session_id={CHECKOUT_SESSION_ID}#videos",
      cancel_url: SITE + "/?payment=cancelled#videos",
      locale: "fr",
      "automatic_tax[enabled]": "false",
      "metadata[km16_source]": "km16-checkout-v1",
      "metadata[km16_video_id]": VIDEO,
      "metadata[km16_user_id]": user.id,
    });

    const checkoutReminders = createCheckoutReminderRecorder({ base, serviceKey: service });
    const attempt = stripeKey.startsWith('sk_live_') ? await checkoutReminders.begin({
      kind: 'video', sourceId: video.id, user, optIn: body.reminder_opt_in === true,
      livemode: true, amountCents: video.price_cents,
    }) : null;
    const checkoutResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + stripeKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    if (!checkoutResponse.ok) throw new Error("Creation Stripe refusee");
    const session = await checkoutResponse.json();
    if (!session.url || session.amount_total !== 999 ||
        session.currency !== "eur") {
      throw new Error("Session Stripe incorrecte");
    }

    if (attempt) await checkoutReminders.attach(attempt, session, {
      kind: 'video', sourceId: video.id, userId: user.id, amountCents: video.price_cents,
    });
    return reply(200, { url: session.url });
  } catch {
    return reply(500, {
      error: "Paiement indisponible. Merci de reessayer plus tard.",
    });
  }
});
