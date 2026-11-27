import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const js=readFileSync('clients.mjs','utf8');
assert.match(js,/\$\('search'\)\.oninput=\(\)=>\{clearTimeout\(km16SearchTimer\);km16SearchTimer=setTimeout\(renderFirstClientPage,160\);\}/,'Search debounce missing');
assert.match(js,/\$\('search-clear'\)\.onclick=\(\)=>\{(?:clearTimeout\(km16SearchTimer\);)?\$\('search'\)\.value='';renderFirstClientPage\(\);/,'Clear must render immediately');
assert.match(js,/\$\('login-form'\)\.onsubmit/,'Admin login handler missing');
console.log('KM16 search performance checks passed');
