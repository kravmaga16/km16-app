// Offline contract checks for the email-alert module. Run with: node --test tests/email-relances-contract.test.mjs
// Static checks only; no network, no Supabase access and no mail dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const server=readFileSync(new URL('../supabase/functions/km16-admin-email-alerts/index.ts',import.meta.url),'utf8');
const client=readFileSync(new URL('../clients.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../clients.html',import.meta.url),'utf8');
const menu=readFileSync(new URL('../admin-menu.js',import.meta.url),'utf8');
test('server accepts only authenticated admin and POST',()=>{
 assert.match(server,/req\.method !== 'POST'/);
 assert.match(server,/authClient\.auth\.getUser\(token\)/);
 assert.match(server,/user\.email\?\.toLowerCase\(\) !== ADMIN_EMAIL/);
 assert.match(server,/user\.email_confirmed_at/);
 assert.match(server,/user\.is_anonymous/);
});
test('server has no mail-sending or database mutations',()=>{
 assert.doesNotMatch(server,/\.insert\(|\.update\(|\.delete\(|\.upsert\(|fetch\(\s*['"]https?:/);
 assert.match(server,/\.select\('id,event_key,recipient,state,attempted_at'\)/);
 assert.match(server,/\.select\('id,campaign_id,email,state,attempted_at'\)/);
});
test('three states, 15-minute threshold and page bounds',()=>{
 assert.match(server,/state\.in\.\(failed,uncertain\)/);
 assert.match(server,/state\.eq\.sending/);
 assert.match(server,/15 \* 60_000/);
 assert.match(server,/Number\.isSafeInteger\(page\)/);
 assert.match(server,/\.range\(from, to\)/);
});
test('client has manual read-only controls and clears on auth change',()=>{
 assert.match(client,/refreshKm16EmailAlerts\(next=false\)/);
 assert.match(client,/clearKm16EmailAlerts\(\);communications\.reset\(\)/);
 assert.match(client,/body\.replaceChildren\(\)/);
 assert.match(client,/td\.textContent=/);
 assert.match(html,/id="km16-email-relances-more"/);
 assert.match(menu,/clients\.html#km16-email-relances/);
});

test('request and response security contracts',()=>{
 assert.match(server,/req\.headers\.get\('origin'\) !== ORIGIN/);
 assert.match(server,/status: 403, headers: \{ 'Content-Type': 'application\/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' \}/);
 assert.match(server,/Access-Control-Allow-Origin/);
 assert.match(server,/Cache-Control': 'no-store'/);
 assert.match(server,/user\.is_anonymous/);
 assert.match(server,/return json\(\{ error: 'Accès refusé' \}, 403\)/);
 assert.match(server,/page < 0 \|\| page > 10000/);
 assert.match(server,/has_more:/);
 assert.match(client,/body:JSON\.stringify\(\{page\}\)/);
 assert.match(client,/result\.page!==page/);
 assert.match(client,/km16EmailRequest/);
});
