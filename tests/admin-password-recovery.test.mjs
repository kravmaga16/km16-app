import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const moduleSource = readFileSync(new URL('../admin-password-recovery.mjs', import.meta.url), 'utf8');
const origin = 'https://app.km16.fr';
const verifierKey = 'km16-admin-password-recovery-code-verifier';

function element(properties = {}) {
  return {
    addEventListener(event, handler) { this[event] = handler; },
    ...properties,
  };
}

function setup(path, elements, auth, localValues = new Map()) {
  const location = new URL(path, origin);
  const urls = [];
  const options = [];
  runInNewContext(moduleSource, {
    location,
    URL,
    URLSearchParams,
    document: { getElementById: id => elements[id] },
    history: { replaceState: (_state, _title, url) => urls.push(url) },
    localStorage: {
      getItem: key => localValues.get(key),
      setItem: (key, value) => localValues.set(key, value),
      removeItem: key => localValues.delete(key),
    },
    window: {
      crypto: { subtle: {} },
      supabase: {
        createClient(_url, _key, config) {
          options.push(config.auth);
          return { auth };
        },
      },
    },
  });
  return { options, urls };
}

test('requests recovery with the canonical callback and isolates the session from storage', async () => {
  const button = element();
  const email = { value: '  admin@example.test ', reportValidity: () => true };
  const status = {};
  const localValues = new Map();
  const { options } = setup('/clients.html#km16-dossiers', {
    'request-password-recovery': button,
    email,
    'password-recovery-status': status,
  }, {
    async resetPasswordForEmail(value, { redirectTo }) {
      assert.equal(value, 'admin@example.test');
      assert.equal(redirectTo, origin + '/admin-password-reset.html');
      return { error: null };
    },
  }, localValues);

  await button.click();
  assert.match(status.textContent, /même navigateur/);
  assert.equal(button.disabled, false);
  const [auth] = options;
  assert.equal(auth.flowType, 'pkce');
  assert.equal(auth.detectSessionInUrl, false);
  auth.storage.setItem(verifierKey, 'verifier');
  auth.storage.setItem(auth.storageKey, 'session');
  assert.equal(localValues.get(verifierKey), 'verifier');
  assert.equal(localValues.has(auth.storageKey), false);
});

function resetScreen() {
  const password = { value: 'nouveau-mot-de-passe', focus() {} };
  const confirmation = { value: 'different', focus() {} };
  const submit = {};
  const form = element({
    hidden: true,
    elements: { password, confirmation },
    querySelector: () => submit,
    reset() { password.value = confirmation.value = ''; },
  });
  const status = {};
  return { form, status, password, confirmation, elements: {
    'password-reset-form': form,
    'password-reset-status': status,
  } };
}

test('requires a verifier and a recovery session before showing the form', async () => {
  const path = '/admin-password-reset.html?code=one-time-code';
  const missing = resetScreen();
  const { options, urls } = setup(path, missing.elements, {});
  assert.equal(options.length, 0);
  assert.deepEqual(urls, ['/admin-password-reset.html']);
  assert.equal(missing.form.hidden, true);

  const wrongSession = resetScreen();
  setup(path, wrongSession.elements, {
    exchangeCodeForSession: async () => ({ data: { redirectType: null, session: {} } }),
  }, new Map([[verifierKey, 'verifier']]));
  await new Promise(setImmediate);
  assert.equal(wrongSession.form.hidden, true);
  assert.match(wrongSession.status.textContent, /expiré/);
});

test('checks confirmation, updates the password once, and signs out after success', async () => {
  const { form, status, password, confirmation, elements } = resetScreen();
  const calls = [];
  setup('/admin-password-reset.html?code=one-time-code', elements, {
    async exchangeCodeForSession(code) {
      assert.equal(code, 'one-time-code');
      return { data: { redirectType: 'recovery', session: {} } };
    },
    async updateUser({ password }) { calls.push(password); return { error: null }; },
    async signOut() { calls.push('sign-out'); return { error: null }; },
  }, new Map([[verifierKey, 'verifier']]));

  await new Promise(setImmediate);
  assert.equal(form.hidden, false);
  const event = { preventDefault() {} };
  await form.submit(event);
  assert.deepEqual(calls, []);
  assert.match(status.textContent, /identiques/);
  confirmation.value = password.value;
  await form.submit(event);
  assert.deepEqual(calls, ['nouveau-mot-de-passe', 'sign-out']);
  assert.equal(form.hidden, true);
  assert.equal(password.value, '');
  assert.match(status.textContent, /Mot de passe enregistré/);
});
