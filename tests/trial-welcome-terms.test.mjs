// Real PostgreSQL behavior in memory. No production data, network or messages.
// Pin @electric-sql/pglite@0.5.17 externally, or provide PGLITE_MODULE.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const v5 = 'km16-2026-11-10-v5', v6 = 'km16-2026-11-20-v6';
const newConditions = await source('../conditions-adhesion.html');
const oldTrial = 'Le cours d’essai est offert à tous, y compris hors Saint-Jean-de-Passy, sans paiement ni saisie de carte bancaire ; la date est à convenir avec KM16 et la demande reste soumise à validation du club.';
const newTrial = 'Le cours d’essai est offert à tous, y compris hors Saint-Jean-de-Passy, sans paiement ni saisie de carte bancaire. Après l’enregistrement de la demande, le pratiquant peut choisir librement une séance adaptée à son âge et à son niveau dans le planning en vigueur. Il se présente à l’enseignant à son arrivée pour son cours d’essai.';
assert.ok(newConditions.includes(newTrial));
const oldConditions = newConditions.replace(newTrial, oldTrial).replaceAll(v6, v5)
  .replace('Version du 20 novembre 2026', 'Version du 10 novembre 2026');
assert.equal(createHash('md5').update(oldConditions).digest('hex'), '694505e8fbf8aaf38d60a28a96e5fee1',
  'V6 changes only the trial paragraph and version labels from the verified V5 archive');
const paths = await readdir(new URL('../supabase/migrations/', import.meta.url));
const matching = paths.filter(path => /^\d+_trial_welcome_terms\.sql$/.test(path));
assert.equal(matching.length, 1);
const migration = await source('../supabase/migrations/' + matching[0]);
const db = new PGlite();
let checks = 1;
try {
  await db.exec(`
    CREATE TABLE public.km16_legal_archives(version text PRIMARY KEY,conditions_html text NOT NULL,
      privacy_html text NOT NULL,rules_html text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.km16_membership_config(id integer PRIMARY KEY,terms_version text NOT NULL,
      terms_url text NOT NULL DEFAULT 'https://app.km16.fr/conditions-adhesion.html',enabled boolean NOT NULL DEFAULT true);
    CREATE TABLE public.km16_membership_products(id text PRIMARY KEY,amount integer NOT NULL,
      kind text NOT NULL,review boolean NOT NULL,note text NOT NULL);
    CREATE TABLE public.km16_membership_orders(id integer PRIMARY KEY,terms_version text NOT NULL);
    CREATE TABLE public.km16_order_contracts(order_id integer PRIMARY KEY,version text NOT NULL,order_snapshot jsonb NOT NULL);
  `);
  async function reset() {
    await db.exec('TRUNCATE public.km16_legal_archives,public.km16_membership_config,public.km16_membership_products,public.km16_membership_orders,public.km16_order_contracts;');
    await db.query('INSERT INTO public.km16_legal_archives VALUES($1,$2,$3,$4,$5)',
      [v5, oldConditions, '<html>archived privacy</html>', '<html>archived rules</html>', '2026-11-10T12:00:00Z']);
    await db.query('INSERT INTO public.km16_membership_config(id,terms_version) VALUES(1,$1)', [v5]);
    await db.exec(`INSERT INTO public.km16_membership_products VALUES
      ('essai',0,'single',false,'Old trial note'),('essai-saint-jean',0,'single',true,'Old legacy note'),
      ('adulte-renouvellement',57000,'annual',true,'Paid product note'),('cours-deux-heures',4000,'single',false,'Paid class note');`);
    await db.query('INSERT INTO public.km16_membership_orders VALUES(1,$1)', [v5]);
    await db.query('INSERT INTO public.km16_order_contracts VALUES(1,$1,$2)', [v5, { terms_version: v5, total_cents: 57000 }]);
  }
  async function snapshot() {
    const names = ['km16_legal_archives','km16_membership_config','km16_membership_products','km16_membership_orders','km16_order_contracts'];
    const result = {};
    for (const name of names) result[name] = (await db.query('SELECT * FROM public.' + name + ' ORDER BY 1')).rows;
    return result;
  }
  await reset();
  const before = await snapshot();
  await db.exec(migration);
  const after = await snapshot();
  assert.deepEqual(after.km16_legal_archives.find(row => row.version === v5), before.km16_legal_archives[0]); checks++;
  const archived = after.km16_legal_archives.find(row => row.version === v6);
  assert.equal(archived.conditions_html, newConditions); checks++;
  assert.equal(archived.privacy_html, before.km16_legal_archives[0].privacy_html); checks++;
  assert.equal(archived.rules_html, before.km16_legal_archives[0].rules_html); checks++;
  assert.deepEqual(after.km16_membership_config[0], {...before.km16_membership_config[0],terms_version:v6}); checks++;
  const catalog = JSON.parse(await source('../catalogue.json'));
  for (const id of ['essai', 'essai-saint-jean']) {
    const row = after.km16_membership_products.find(row => row.id === id);
    assert.equal(row.note, catalog.find(product => product.id === id).note); checks++;
    assert.equal(row.review, false); checks++;
  }
  for (const id of ['adulte-renouvellement','cours-deux-heures']) {
    assert.deepEqual(after.km16_membership_products.find(row => row.id === id), before.km16_membership_products.find(row => row.id === id)); checks++;
  }
  assert.deepEqual(after.km16_membership_orders, before.km16_membership_orders); checks++;
  assert.deepEqual(after.km16_order_contracts, before.km16_order_contracts); checks++;
  await assert.rejects(db.exec(migration), /expected current version V5/); checks++;
  assert.deepEqual(await snapshot(), after); checks++;

  for (const [setup, expected] of [
    ["UPDATE public.km16_membership_config SET terms_version='future-v7'", /expected current version V5/],
    ["DELETE FROM public.km16_legal_archives", /V5 archive missing or changed/],
    ["UPDATE public.km16_legal_archives SET conditions_html=conditions_html||'changed'", /V5 archive missing or changed/],
    ["UPDATE public.km16_membership_products SET amount=1 WHERE id='essai'", /expected two free trial products/],
    ["INSERT INTO public.km16_legal_archives SELECT 'km16-2026-11-20-v6','existing-v6',privacy_html,rules_html,now() FROM public.km16_legal_archives", /duplicate key/],
  ]) {
    await reset(); await db.exec(setup); const previous = await snapshot();
    await assert.rejects(db.exec(migration), expected); checks++;
    assert.deepEqual(await snapshot(), previous, 'a failed precondition must not publish partial changes'); checks++;
  }
  console.log(`PASS ${checks} trial welcome terms checks: exact V6 content, immutable V5 and existing contracts, paid products preserved, trial-only changes, atomic preconditions.`);
} finally {
  await db.close();
}
