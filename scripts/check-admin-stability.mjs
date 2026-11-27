import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const js=readFileSync('clients.mjs','utf8');
assert.match(js,/\$\('search'\)\.oninput=\(\)=>\{clearTimeout\(km16SearchTimer\);km16SearchTimer=setTimeout\(renderClientResults,160\);\}/);
assert.match(js,/\$\('search-clear'\)\.onclick=\(\)=>\{clearTimeout\(km16SearchTimer\);\$\('search'\)\.value='';renderClientResults\(\);\$\('search'\)\.focus\(\);\}/);
assert.match(js,/\$\('login-form'\)\.onsubmit/);
assert.match(js,/\$\('refresh'\)\.onclick/);
console.log('KM16 search cancellation and admin guardrails passed');
