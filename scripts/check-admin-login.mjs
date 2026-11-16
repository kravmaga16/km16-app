// KM16 administrative login smoke test (no credentials or network required).
// Fails CI if the login wiring or the verified Safari compatibility fix disappears.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('clients.html','utf8');
const js=readFileSync('clients.mjs','utf8');
assert.match(html,/id="login-form"/,'Login form missing');
assert.match(html,/id="login-button"/,'Login button missing');
assert.match(html,/type="module" src="\.\/clients\.mjs\?v=[^"]+"/,'Versioned admin script missing');
assert.match(js,/signInWithPassword/,'Supabase login handler missing');
assert.match(js,/\$\('login-form'\)\.onsubmit/,'Login submit listener missing');
assert.match(js,/onAuthStateChange/,'Session listener missing');
assert.doesNotMatch(js,/\\p\{M\}/,'Known Safari compatibility issue reintroduced');
console.log('KM16 admin login smoke checks passed');
