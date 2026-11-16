import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const js=readFileSync('clients.mjs','utf8');
assert.match(js,/setInterval\(\(\)=>\{if\(!document\.hidden&&!busy&&session\?\.user\?\.email\?\.toLowerCase\(\)===ADMIN\)load\(\);\},120000\)/,'Safe refresh interval missing');
assert.match(js,/\$\('refresh'\)\.onclick=\(\)=>\{load\(\);refreshCourseAlerts\(\);\}/,'Manual refresh must remain available');
assert.match(js,/\$\('login-form'\)\.onsubmit/,'Admin login handler missing');
console.log('KM16 automatic refresh guardrails passed');
