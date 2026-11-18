// Passwordless access is requested only after a customer validates their purchase form.
// Drafts stay on this device, expire after one hour, and never grant account access.
const SITE = 'https://app.km16.fr/';
const POINTER_KEY = 'km16-pending-checkout';
const DATABASE = 'km16-checkout-v1';
const STORE = 'drafts';
const TTL = 60 * 60 * 1000;
const RESEND_DELAY = 60 * 1000;
const destinations = {membership: '/adhesion.html', shirts: '/tee-shirts.html', video: '/#videos'};

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@<>\u0000-\u001f]+@[^\s@<>\u0000-\u001f]+\.[^\s@<>\u0000-\u001f]+$/.test(value);
}

export function verifiedAccount(session) {
  const user = session?.user;
  return user?.id && user.email_confirmed_at && !user.is_anonymous && validEmail(normalizeEmail(user.email)) ? session : null;
}

export function safeCheckoutReturn(kind, value, origin = globalThis.location?.origin || new URL(SITE).origin) {
  if (!Object.hasOwn(destinations, kind)) return null;
  try {
    const url = new URL(value || destinations[kind], origin + '/');
    if (url.origin !== origin || url.username || url.password) return null;
    if (kind === 'video') return ['/', '/index.html'].includes(url.pathname) ? '/#videos' : null;
    if (url.pathname !== destinations[kind]) return null;
    if (kind === 'shirts') return '/tee-shirts.html';
    const clean = new URL('/adhesion.html', origin);
    for (const key of ['categorie', 'stage_date', 'produit']) {
      const value = url.searchParams.get(key);
      if (value && value.length <= 100) clean.searchParams.set(key, value);
    }
    const offer = new URLSearchParams(url.hash.slice(1)).get('offre');
    if (/^[a-f0-9]{64}$/.test(offer || '')) clean.hash = 'offre=' + offer;
    return clean.pathname + clean.search + clean.hash;
  } catch { return null; }
}

function timely(value) {
  return value?.version === 1 && typeof value.id === 'string' && /^[a-f0-9-]{36}$/i.test(value.id) &&
    Object.hasOwn(destinations, value.kind) && validEmail(value.email || '') &&
    Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + TTL + 1000 &&
    safeCheckoutReturn(value.kind, value.url) === value.url;
}

function readPointer() {
  try { return JSON.parse(globalThis.localStorage.getItem(POINTER_KEY) || 'null'); } catch { return null; }
}

function removePointer(id) {
  try { if (!id || readPointer()?.id === id) globalThis.localStorage.removeItem(POINTER_KEY); } catch {}
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(Error('Brouillon indisponible')); return; }
    let settled = false;
    const timer = setTimeout(() => finish(Error('Brouillon indisponible')), 4000);
    const request = globalThis.indexedDB.open(DATABASE, 1);
    function finish(error, db) {
      if (settled) { db?.close(); return; }
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(db);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, {keyPath: 'id'});
    };
    request.onsuccess = () => finish(null, request.result);
    request.onerror = () => finish(Error('Brouillon indisponible'));
    request.onblocked = () => finish(Error('Brouillon indisponible'));
  });
}

async function stored(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let done = false, value;
    const transaction = db.transaction(STORE, mode);
    const timer = setTimeout(() => { try { transaction.abort(); } catch {} finish(Error('Brouillon indisponible')); }, 4000);
    const finish = error => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      db.close();
      if (error) reject(error); else resolve(value);
    };
    const store = transaction.objectStore(STORE);
    if (mode === 'readwrite') {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (!timely(item.value)) item.delete();
        item.continue();
      };
    }
    const request = operation(store);
    request.onsuccess = () => { value = request.result; };
    request.onerror = () => finish(Error('Brouillon indisponible'));
    transaction.oncomplete = () => finish();
    transaction.onerror = () => finish(Error('Brouillon indisponible'));
    transaction.onabort = () => finish(Error('Brouillon indisponible'));
  });
}

async function discard(id) {
  removePointer(id);
  if (id) { try { await stored('readwrite', store => store.delete(id)); } catch {} }
}

async function persist(record) {
  let written = false;
  try {
    await stored('readwrite', store => store.put(record));
    written = true;
    const {version, id, kind, email, url, expiresAt, lastSentAt, retryAfter} = record;
    globalThis.localStorage.setItem(POINTER_KEY, JSON.stringify({version, id, kind, email, url, expiresAt, lastSentAt, retryAfter}));
    return true;
  } catch {
    // A stale pointer must not redirect an email confirmation to an older purchase.
    removePointer();
    if (written) { try { await stored('readwrite', store => store.delete(record.id)); } catch {} }
    return false;
  }
}

async function readDraft(pointer) {
  if (!timely(pointer)) { if (pointer?.id) await discard(pointer.id); return null; }
  try {
    const record = await stored('readonly', store => store.get(pointer.id));
    if (!timely(record) || record.kind !== pointer.kind || record.email !== pointer.email || record.url !== pointer.url) {
      await discard(pointer.id);
      return null;
    }
    return record;
  } catch { return null; }
}

export async function getPendingCheckout(session) {
  if (!verifiedAccount(session)) return null;
  const pointer = readPointer();
  if (!pointer) return null;
  const record = await readDraft(pointer);
  if (!record || normalizeEmail(session.user.email) !== record.email) return null;
  return {kind: record.kind, url: record.url};
}

function timeout(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('La vérification prend trop de temps. Vérifiez votre connexion, puis réessayez.')), 15000);
  })]).finally(() => clearTimeout(timer));
}

function accessError(error) {
  if (error?.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error?.code))
    return 'Patientez une minute avant de demander un nouveau lien.';
  if (error?.code === 'otp_disabled' || error?.code === 'signup_disabled')
    return 'La vérification par e-mail est temporairement indisponible. Contactez contact@km16.fr.';
  return error?.message?.startsWith('La vérification prend trop de temps') ? error.message :
    'Le lien de vérification n’a pas pu être envoyé. Vos informations sont conservées ici. Vérifiez votre connexion, puis réessayez.';
}

export function createCheckoutAccess({client, kind, host, emailInput, getDraft, applyDraft, onVerified, returnPath}) {
  const url = safeCheckoutReturn(kind, returnPath);
  if (!url || !host || !emailInput || typeof getDraft !== 'function') throw Error('Parcours de vérification invalide');
  let currentSession = null, record = null, waitingEmail = '', lastSentAt = 0, retryAfter = 0;
  let sending = false, saved = false, verified = false, noticeKey = '', tick = null, expiryTimer = null;
  // Prune expired records when a checkout page is opened, including orphaned drafts.
  void stored('readwrite', store => store.count()).catch(() => {});
  host.hidden = true;
  const panel = document.createElement('section');
  panel.dataset.checkoutAccess = '';
  panel.className = 'summary checkout-access-panel';
  const heading = document.createElement('h3');
  heading.textContent = 'Confirmez votre adresse e-mail';
  const status = document.createElement('p');
  status.dataset.checkoutAccessStatus = '';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const help = document.createElement('p');
  help.className = 'muted';
  const buttons = document.createElement('div');
  buttons.className = 'row';
  const resend = document.createElement('button');
  resend.type = 'button';
  resend.dataset.checkoutResend = '';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.dataset.checkoutEditEmail = '';
  edit.textContent = 'Corriger mon adresse e-mail';
  buttons.append(resend, edit);
  panel.append(heading, status, help, buttons);
  host.append(panel);

  function expireDraftLater() {
    if (expiryTimer) clearTimeout(expiryTimer);
    if (!record) return;
    const id = record.id;
    expiryTimer = setTimeout(() => {
      void discard(id);
      if (record?.id !== id) return;
      record = null;
      waitingEmail = '';
      lastSentAt = 0;
      retryAfter = 0;
      noticeKey = '';
      saved = false;
      verified = false;
      if (tick) { clearInterval(tick); tick = null; }
      host.hidden = true;
    }, Math.max(0, record.expiresAt - Date.now()));
  }

  function cooldown() {
    const remaining = Math.max(0, Math.ceil((Math.max(lastSentAt + RESEND_DELAY, retryAfter) - Date.now()) / 1000));
    resend.disabled = sending || verified || remaining > 0;
    resend.textContent = sending ? 'Envoi en cours…' : remaining ? 'Renvoyer le lien dans ' + remaining + ' s' : 'Renvoyer le lien';
    if (!remaining && tick) { clearInterval(tick); tick = null; }
  }
  function show(message, error = false) {
    host.hidden = false;
    heading.textContent = verified ? 'Adresse e-mail confirmée' : 'Confirmez votre adresse e-mail';
    status.textContent = message;
    status.className = error ? 'error' : '';
    help.textContent = verified ? 'Vous pouvez maintenant poursuivre votre demande.' :
      saved ? 'Votre demande est conservée pendant une heure sur cet appareil. Après vérification, vous retrouverez vos informations pour continuer.' :
        'Gardez cet onglet ouvert. Après avoir ouvert le lien reçu par e-mail, revenez ici pour poursuivre : votre navigateur ne permet pas de sauvegarder le brouillon.';
    buttons.hidden = verified;
    cooldown();
    if (!verified && Math.max(lastSentAt + RESEND_DELAY, retryAfter) > Date.now() && !tick) tick = setInterval(cooldown, 1000);
  }
  function waiting() {
    show('Ouvrez le lien envoyé à ' + waitingEmail + '. Aucun mot de passe à créer. Pensez aussi à vérifier vos courriers indésirables.');
  }
  function sync(session) {
    currentSession = verifiedAccount(session);
    if (!waitingEmail) return;
    verified = !!currentSession && normalizeEmail(currentSession.user.email) === waitingEmail;
    if (verified) {
      show('Votre adresse est vérifiée. Vérifiez vos informations, puis poursuivez votre demande.');
      const key = currentSession.user.id + ':' + waitingEmail;
      if (noticeKey !== key) {
        noticeKey = key;
        try { Promise.resolve(onVerified?.(currentSession)).catch(() => show('Adresse confirmée. Actualisez la page si votre demande ne réapparaît pas.', true)); }
        catch { show('Adresse confirmée. Actualisez la page si votre demande ne réapparaît pas.', true); }
      }
    } else if (currentSession) {
      show('Vous êtes connecté avec une autre adresse. Utilisez l’adresse de cette demande ou corrigez-la avant de continuer.', true);
    }
  }
  async function readSession() {
    if (!client?.auth?.getSession) throw Error('La connexion est indisponible. Rechargez la page pour réessayer.');
    const response = await timeout(client.auth.getSession());
    if (response.error) throw Error('Votre connexion n’a pas pu être vérifiée. Réessayez.');
    currentSession = verifiedAccount(response.data?.session);
    return currentSession;
  }
  async function send(force = false) {
    if (sending) return null;
    const email = normalizeEmail(emailInput.value);
    if (!validEmail(email)) throw Error('Saisissez une adresse e-mail valide pour recevoir votre confirmation.');
    sending = true;
    try {
      const account = await readSession();
      if (account) {
        if (normalizeEmail(account.user.email) !== email || waitingEmail && waitingEmail !== email)
          throw Error('Cette demande utilise une autre adresse e-mail. Corrigez l’adresse ou connectez-vous avec celle de la demande.');
        sync(account);
        return account;
      }
      const pointer = readPointer();
      const previousSent = timely(pointer) && pointer.email === email ? Number(pointer.lastSentAt) || 0 : 0;
      const previousRetry = timely(pointer) && pointer.email === email ? Number(pointer.retryAfter) || 0 : 0;
      if (waitingEmail !== email) { waitingEmail = ''; lastSentAt = 0; retryAfter = 0; noticeKey = ''; }
      lastSentAt = Math.max(lastSentAt, previousSent);
      retryAfter = Math.max(retryAfter, previousRetry);
      const expiresAt = Date.now() + TTL;
      const draft = await getDraft();
      record = {version: 1, id: record?.email === email ? record.id : crypto.randomUUID(), kind, email, url, expiresAt, lastSentAt, retryAfter, draft};
      saved = await persist(record);
      expireDraftLater();
      if (retryAfter > Date.now()) {
        show('Patientez une minute avant de demander un nouveau lien.', true);
        return null;
      }
      if (waitingEmail === email && !force || lastSentAt && Date.now() - lastSentAt < RESEND_DELAY) {
        waitingEmail = email;
        verified = false;
        waiting();
        return null;
      }
      waitingEmail = email;
      verified = false;
      lastSentAt = Date.now();
      retryAfter = 0;
      record.lastSentAt = lastSentAt;
      record.retryAfter = 0;
      saved = await persist(record);
      show('Envoi du lien de vérification à ' + email + '…');
      const {error} = await timeout(client.auth.signInWithOtp({email, options: {shouldCreateUser: true, emailRedirectTo: SITE}}));
      if (error) throw Object.assign(Error(accessError(error)), {publicAccessError: true, rateLimited: error.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code)});
      waiting();
      return null;
    } catch (error) {
      if (waitingEmail && !currentSession) {
        waitingEmail = '';
        lastSentAt = 0;
        retryAfter = error?.rateLimited ? Date.now() + RESEND_DELAY : 0;
        if (record) { record.lastSentAt = 0; record.retryAfter = retryAfter; saved = await persist(record); }
      }
      const message = error?.publicAccessError || error?.message?.startsWith('Cette demande') || error?.message?.startsWith('Votre connexion') || error?.message?.startsWith('La connexion') ? error.message : accessError(error);
      show(message, true);
      throw Error(message);
    } finally { sending = false; cooldown(); }
  }
  async function restore() {
    const pointer = readPointer();
    if (!pointer || pointer.kind !== kind) return false;
    const storedRecord = await readDraft(pointer);
    if (!storedRecord) return false;
    let account;
    try { account = await readSession(); } catch { return false; }
    if (account && normalizeEmail(account.user.email) !== storedRecord.email) {
      await discard(storedRecord.id);
      return false;
    }
    record = storedRecord;
    lastSentAt = Number(record.lastSentAt) || 0;
    retryAfter = Number(record.retryAfter) || 0;
    waitingEmail = lastSentAt || account ? record.email : '';
    saved = true;
    expireDraftLater();
    try { await applyDraft?.(record.draft); }
    catch { show('Votre sélection a changé. Vérifiez votre demande avant de continuer.', true); return false; }
    emailInput.value = record.email;
    if (retryAfter > Date.now()) show('Patientez une minute avant de demander un nouveau lien.', true);
    else if (lastSentAt) waiting();
    else show('Votre demande a été retrouvée. Validez-la pour recevoir un lien de vérification.');
    sync(account);
    return true;
  }
  async function clear() {
    const id = record?.id || (readPointer()?.kind === kind ? readPointer().id : null);
    record = null;
    waitingEmail = '';
    lastSentAt = 0;
    retryAfter = 0;
    verified = false;
    noticeKey = '';
    if (tick) { clearInterval(tick); tick = null; }
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    host.hidden = true;
    if (id) await discard(id);
  }
  resend.onclick = async () => { try { await send(true); } catch {} };
  edit.onclick = async () => { await clear(); emailInput.focus(); emailInput.select?.(); };
  return {ensure: () => send(false), restore, sync, clear};
}
