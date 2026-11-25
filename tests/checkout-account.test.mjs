import assert from 'node:assert/strict';
import {normalizeEmail, verifiedAccount, safeCheckoutReturn, getPendingCheckout} from '../checkout-account.mjs';

const session = {access_token: 'simulated-session', user: {id: 'test-user', email: 'Parent@example.invalid', email_confirmed_at: '2026-11-18T00:00:00Z', is_anonymous: false}};
assert.equal(normalizeEmail('  Parent@Example.invalid  '), 'parent@example.invalid');
assert.equal(normalizeEmail(null), '');
assert.equal(normalizeEmail({toString: () => 'parent@example.invalid'}), '');
assert.equal(verifiedAccount(session), session);
for (const user of [null, {}, {...session.user, id: ''}, {...session.user, is_anonymous: true}, {...session.user, email_confirmed_at: null}, {...session.user, email: ''}, {...session.user, email: 'broken'}, {...session.user, email: 'a@example.invalid\nother@example.invalid'}, {...session.user, email: 'a@example.invalid', email_confirmed_at: null, phone_confirmed_at: '2026-11-18T00:00:00Z'}]) {
  assert.equal(verifiedAccount({user}), null, 'An unverified, anonymous or malformed identity must never unlock checkout');
}
assert.equal(verifiedAccount(null), null);
const origin = 'https://app.km16.fr';
assert.equal(safeCheckoutReturn('membership', '/adhesion.html?embed=1&espace=1&categorie=Enfants&paid=1', origin), '/adhesion.html?categorie=Enfants');
assert.equal(safeCheckoutReturn('membership', '/adhesion.html?produit=essai&stage_date=2026-12-01', origin), '/adhesion.html?stage_date=2026-12-01&produit=essai');
const offer = 'a'.repeat(64);
assert.equal(safeCheckoutReturn('membership', '/adhesion.html#offre=' + offer, origin), '/adhesion.html#offre=' + offer);
assert.equal(safeCheckoutReturn('membership', '/adhesion.html#access_token=secret', origin), '/adhesion.html');
assert.equal(safeCheckoutReturn('shirts', '/tee-shirts.html?paid=1&admin=1', origin), '/tee-shirts.html');
assert.equal(safeCheckoutReturn('video', '/index.html#anything', origin), '/#videos');
for (const url of ['https://attacker.invalid/adhesion.html', '//attacker.invalid/adhesion.html', 'javascript:alert(1)', 'https://user:password@app.km16.fr/adhesion.html', '/clients.html', '/adhesion.html/extra']) {
  assert.equal(safeCheckoutReturn('membership', url, origin), null, 'Only the intended local checkout destinations may be restored');
}
assert.equal(safeCheckoutReturn('unknown', '/adhesion.html', origin), null);
assert.equal(safeCheckoutReturn('shirts', '/adhesion.html', origin), null);
let storageReads = 0;
globalThis.localStorage = {getItem() {storageReads++;return null;}};
assert.equal(await getPendingCheckout({user: {...session.user, email_confirmed_at: null}}), null);
assert.equal(storageReads, 0, 'No pending personal draft should be retrieved for an unverified identity');
assert.equal(await getPendingCheckout(session), null);
assert.equal(storageReads, 1);
const pointer = {version: 1, id: 'a'.repeat(36), kind: 'membership', email: 'parent@example.invalid',
  url: '/adhesion.html#offre=' + offer, expiresAt: Date.now() + 60_000};
globalThis.localStorage = {getItem: () => JSON.stringify(pointer)};
assert.deepEqual(await getPendingCheckout(session), {kind: 'membership', url: pointer.url},
  'A verified payer can resume a personal offer even when IndexedDB is unavailable');
assert.equal(await getPendingCheckout({user: {...session.user, email: 'other@example.invalid'}}), null);
pointer.expiresAt = Date.now() - 1;
assert.equal(await getPendingCheckout(session), null);
delete globalThis.localStorage;
console.log('Passwordless checkout identity and safe-return checks passed.');
