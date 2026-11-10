import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../server/confirmations/index.ts',import.meta.url),'utf8').replace(/^import .*;$/m,'');
let config={confirmations_enabled:true},envMode='test',handler,claims=[],verified=0;
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'private-test',KM16_DOCUMENTS_WORKER_KEY:'x'.repeat(40),KM16_DOCUMENTS_SMTP_PASSWORD:'smtp-test',KM16_ADHESIONS_STRIPE_SECRET_KEY:'sk_live_fixture',KM16_CONFIRMATIONS_TEST_STRIPE_SECRET_KEY:'sk_test_fixture'};
const context=vm.createContext({Response,TextEncoder,crypto:webcrypto,URL,console,
 Deno:{env:{get:k=>k==='KM16_CONFIRMATIONS_MODE'?envMode:env[k]},serve:fn=>handler=fn},
 nodemailer:{createTransport:()=>({verify:async()=>{verified++},close(){},sendMail(){throw Error('No real mail in tests')}})},
 fetch:async(url,options)=>{
  if(url.includes('km16_membership_config'))return Response.json([config]);
  if(url.includes('rpc/km16_claim_confirmation')){claims.push(JSON.parse(options.body));return Response.json([])}
  throw Error('Unexpected network call');
 }});
vm.runInContext(source,context);
const request=(action='',key=env.KM16_DOCUMENTS_WORKER_KEY)=>new Request('https://example.invalid',{method:'POST',headers:{'x-km16-worker-key':key},body:JSON.stringify({action})});
assert.equal((await handler(request('','wrong'))).status,401);
assert.equal(claims.length,0);
assert.deepEqual(await (await handler(request())).json(),{sent:0});
assert.equal(claims[0].p_live,true,'Production switch selects live queue even when legacy env is test');
const readiness=await (await handler(request('readiness'))).json();
assert.equal(readiness.mode,'live');assert.equal(readiness.smtp_verified,true);assert.equal(verified,1);assert.equal(claims.length,1,'SMTP readiness must not claim mail jobs');
config={confirmations_enabled:false};envMode='live';
assert.deepEqual(await (await handler(request())).json(),{paused:true});assert.equal(claims.length,1);
envMode='test';await handler(request());assert.equal(claims[1].p_live,false);
const snapshot={id:'fixture',first_name:'Alice',last_name:'Test',title:'Ados',count:3,amounts:[20334,20333,20333],total_cents:61000,terms_version:'fixture-v1',consented_at:'2026-11-10T12:00:00Z'};
const charge={paid:true,currency:'eur',amount:20334,created:1794312000};
const schedule={phases:[{start_date:1796904000}],end_behavior:'cancel'};
const archive={version:'fixture-v1',conditions_html:'<html>Conditions exactes</html>',privacy_html:'<html>Confidentialité exacte</html>',rules_html:'<html>Règles exactes</html>'};
const mail=context.confirmationMail(snapshot,charge,schedule,archive);
assert.equal(mail.attachments.length,3);assert.equal(mail.attachments[0].content,archive.conditions_html);assert.ok(mail.text.includes('203,34 €'));assert.ok(mail.text.includes('610,00 €'));assert.ok(!mail.subject.includes('TEST'));
assert.throws(()=>context.confirmationMail(snapshot,{...charge,amount:20000},schedule,archive),/charge/);
assert.throws(()=>context.confirmationMail(snapshot,charge,schedule,{...archive,version:'wrong'}),/version/);
assert.throws(()=>context.confirmationMail(snapshot,charge,{...schedule,end_behavior:'release'},archive),/schedule/);
assert.throws(()=>context.confirmationMail({...snapshot,amounts:[20000,20000,20000]},charge,schedule,archive),/amounts/);
console.log('PASS: worker authentication, live/test isolation, stop switch, SMTP readiness without mail, exact archived attachments and payment validation');
