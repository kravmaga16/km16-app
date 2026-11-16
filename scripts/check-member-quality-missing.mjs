import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const js=readFileSync('clients.mjs','utf8');
const start=js.indexOf('function renderMemberQuality(){'),end=js.indexOf('function render(){',start);
assert.ok(start>=0&&end>start);
const section=js.slice(start,end);
for(const token of ['missingEmailClients.push(c)','missingNameClients.push(c)',"['Fiches sans e-mail',missingEmailClients.map(c=>[c]),true]","['Identité incomplète',missingNameClients.map(c=>[c]),true]",'details.open=expandedGroups[index]||false',"items.slice(0,40)","openMemberProfile(c)"])assert.ok(section.includes(token),'Missing quality-control behavior: '+token);
assert.match(js,/\$\('login-form'\)\.onsubmit/);
console.log('KM16 missing-contact and incomplete-identity listings verified');
