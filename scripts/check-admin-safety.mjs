// Non-destructive administration security and reliability regression guardrails.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('clients.html','utf8');
const js=readFileSync('clients.mjs','utf8');
assert.match(html,/id="km16-member-quality"/,'Member quality section missing');
assert.match(html,/id="member-profile"/,'Member profile section missing');
assert.match(html,/id="data-status"/,'Data loading status missing');
assert.match(html,/id="client-results-count"/,'Accessible result count missing');
assert.match(js,/onAuthStateChange/,'Auth state handling missing');
assert.match(js,/AbortController/,'Cancelable data refresh missing');
assert.doesNotMatch(js,/\\p\{M\}/,'Safari incompatible regular expression reintroduced');
assert.doesNotMatch(js,/\.innerHTML\s*=/,'Potentially unsafe dynamic HTML insertion introduced');
assert.doesNotMatch(js,/\b(?:localStorage|sessionStorage)\s*\./,'Admin data browser storage introduced');
console.log('KM16 admin security and reliability static guardrails passed');
