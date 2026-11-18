// Guardrails for admin mobile CSS-only changes.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('clients.html','utf8');
assert.match(html,/class="km16-dashboard-nav"/,'Admin navigation missing');
assert.match(html,/\.km16-dashboard-nav a:focus-visible/,'Keyboard focus styles missing');
assert.match(html,/@media\(max-width:680px\)\{\.km16-dashboard-nav\{display:grid/,'Mobile navigation styles missing');
assert.match(html,/\.km16-profile-block\{min-width:0;overflow-wrap:anywhere\}/,'Profile overflow protection missing');
// Keep the module/version contract while allowing cache invalidation after a JS change.
// Actual login behavior is exercised in check-member-email.mjs and check-admin-login.mjs.
assert.match(html,/<script type="module" src="\.\/clients\.mjs\?v=[a-z0-9-]+"><\/script>/,'Versioned admin module reference missing');
assert.match(html,/#member-profile-close\{min-height:44px/,'Accessible member profile close button missing');
assert.match(html,/#member-profile-content table\{display:block;max-width:100%;overflow-x:auto\}/,'Member profile table overflow handling missing');
assert.match(html,/#km16-dossiers\{scroll-margin-top:20px;border-left:4px solid #b9832c\}/,'Dashboard priority marker missing');
assert.match(html,/#km16-quick-actions\{display:grid;grid-template-columns:1fr\}/,'Mobile quick actions missing');
console.log('KM16 admin mobile CSS, member profile and dashboard checks passed');
