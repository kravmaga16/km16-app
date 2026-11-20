const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = 'km16-member-documents';
const SITE = 'https://app.km16.fr';
const TYPES = new Set(['health', 'license']);
const MIME = new Map([['application/pdf', 'pdf'], ['image/jpeg', 'jpg'], ['image/png', 'png']]);
const signatures = new Map([
  ['application/pdf', [37, 80, 68, 70, 45]],
  ['image/jpeg', [255, 216, 255]],
  ['image/png', [137, 80, 78, 71, 13, 10, 26, 10]],
]);
const headers = {
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Expose-Headers': 'Content-Disposition',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (value, status = 200) => Response.json(value, { status, headers });

async function readUpload(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

Deno.serve(async request => {
  if (request.headers.get('origin') !== SITE) return reply({ error: 'Origine refusée.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'Méthode refusée.' }, 405);

  const token = request.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(token)) return reply({ error: 'Connectez-vous à votre compte KM16.' }, 401);

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const orderId = searchParams.get('order');
  const type = searchParams.get('type');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(orderId ?? '') ||
      !['list', 'upload', 'download', 'review'].includes(action) || (action !== 'list' && !TYPES.has(type))) {
    return reply({ error: 'Demande invalide.' }, 400);
  }

  try {
    const base = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !key) throw Error('Missing configuration');
    const auth = await fetch(base + '/auth/v1/user', { headers: { apikey: key, Authorization: token } });
    if (!auth.ok) return reply({ error: 'Session expirée. Reconnectez-vous.' }, 401);
    const user = await auth.json();
    if (!user.email_confirmed_at || user.is_anonymous) return reply({ error: 'Confirmez votre adresse e-mail.' }, 403);

    const service = { apikey: key, Authorization: 'Bearer ' + key };
    const admin = user.email?.toLowerCase() === 'alexandre.marchat@gmail.com';
    if (action === 'review' && !admin) return reply({ error: 'Accès privé.' }, 403);
    const ownerFilter = admin && action !== 'upload' ? '' : '&user_id=eq.' + user.id;
    const eligibility = action === 'upload' ? '&approval=neq.rejected' : '';
    const order = await fetch(base + '/rest/v1/km16_membership_orders?id=eq.' + orderId +
      '&livemode=eq.true&select=id' + ownerFilter + eligibility, { headers: service });
    if (!order.ok) throw Error('Order lookup failed');
    if (!(await order.json()).length) return reply({ error: 'Dossier indisponible.' }, 404);

    const docs = await fetch(base + '/rest/v1/km16_membership_documents?order_id=eq.' + orderId +
      '&select=order_id,health_status', { headers: service });
    if (!docs.ok) throw Error('Document lookup failed');
    const [document] = await docs.json();
    if (!document) return reply({ error: 'Justificatifs indisponibles pour ce dossier.' }, 404);

    const storage = base + '/storage/v1/object';
    const reviewsUrl = base + '/rest/v1/km16_document_file_reviews';
    const [listed, reviewResponse] = await Promise.all([
      fetch(storage + '/list/' + BUCKET, {
        method: 'POST',
        headers: { ...service, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: orderId, limit: 100 }),
      }),
      fetch(reviewsUrl + '?order_id=eq.' + orderId + '&select=id,object_name,state,reason', { headers: service }),
    ]);
    if (!listed.ok || !reviewResponse.ok) throw Error('File status unavailable');
    const names = new Set((await listed.json()).map(object => object.name));
    const reviews = new Map((await reviewResponse.json()).map(review => [review.object_name, review]));
    function currentFile(kind) {
      let name = kind;
      let review = reviews.get(name);
      while (review?.state === 'correction' && names.has(kind + '-' + review.id)) {
        name = kind + '-' + review.id;
        review = reviews.get(name);
      }
      const exists = names.has(name);
      const state = review?.state ?? (kind === 'health' && document.health_status === 'validated'
        ? 'validated' : exists || kind === 'health' && document.health_status === 'received' ? 'received' : 'missing');
      return { name, exists, state, reason: review?.reason ?? '', review };
    }
    if (action === 'list') {
      const files = Object.fromEntries([...TYPES].map(kind => {
        const { name, exists, state, reason } = currentFile(kind);
        return [kind, { name, exists, state, reason }];
      }));
      return reply({ types: [...TYPES].filter(kind => files[kind].exists), files });
    }
    const current = currentFile(type);
    if (action === 'review') {
      const decision = await request.json().catch(() => null);
      const reason = typeof decision?.reason === 'string' ? decision.reason.trim() : '';
      if (!['validated', 'correction'].includes(decision?.state) || reason.length > 500 ||
          (decision.state === 'correction' && !reason)) return reply({ error: 'Renseignez un motif de correction de 500 caractères maximum.' }, 400);
      if (!current.exists || current.review || current.name !== decision.name) return reply({ error: 'Ce fichier a changé ou a déjà été traité. Actualisez le dossier.' }, 409);
      const review = await fetch(reviewsUrl, {
        method: 'POST', headers: { ...service, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, object_name: current.name, state: decision.state, reason, reviewed_by: user.id }),
      });
      if (review.status === 409) return reply({ error: 'Ce fichier a déjà été traité. Actualisez le dossier.' }, 409);
      if (!review.ok) throw Error('Review failed');
      return reply({ ok: true });
    }
    const path = BUCKET + '/' + orderId + '/' + current.name;
    if (action === 'download') {
      if (!current.exists) return reply({ error: 'Aucun fichier déposé.' }, 404);
      const downloaded = await fetch(storage + '/authenticated/' + path, { headers: service });
      if (downloaded.status === 404) return reply({ error: 'Aucun fichier déposé.' }, 404);
      if (!downloaded.ok) throw Error('Storage download failed');
      const extension = MIME.get(downloaded.headers.get('content-type')?.split(';')[0]) || 'bin';
      const filename = (type === 'health' ? 'justificatif-sante' : 'licence-fekm') + '.' + extension;
      return new Response(downloaded.body, { headers: {
        ...headers, 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + filename + '"',
      } });
    }

    if (current.exists && current.state !== 'correction') return reply({ error: 'Une pièce a déjà été déposée.' }, 409);
    const nextName = current.state === 'correction' ? type + '-' + current.review.id : type;
    if (names.size >= 90) return reply({ error: 'Contactez KM16 pour déposer une autre version.' }, 409);
    const mime = request.headers.get('content-type');
    const signature = signatures.get(mime);
    if (!signature) return reply({ error: 'Choisissez un fichier PDF, JPEG ou PNG.' }, 415);
    const bytes = await readUpload(request);
    if (!bytes || bytes.length === 0) return reply({ error: 'Choisissez un fichier de 5 Mo maximum.' }, 413);
    if (!signature.every((byte, index) => bytes[index] === byte)) return reply({ error: 'Le contenu du fichier ne correspond pas au format annoncé.' }, 415);
    const uploaded = await fetch(storage + '/' + BUCKET + '/' + orderId + '/' + nextName, {
      method: 'POST',
      headers: { ...service, 'Content-Type': mime, 'Cache-Control': 'no-store', 'x-upsert': 'false' },
      body: bytes,
    });
    if (!uploaded.ok) {
      const failure = await uploaded.json().catch(() => ({}));
      if (uploaded.status === 409 || failure.statusCode === '409' || failure.error === 'Duplicate') {
        return reply({ error: 'Une pièce a déjà été déposée. Contactez KM16 pour la remplacer.' }, 409);
      }
      throw Error('Storage upload failed');
    }
    return reply({ ok: true }, 201);
  } catch {
    return reply({ error: 'Le service de dépôt est momentanément indisponible.' }, 503);
  }
});
