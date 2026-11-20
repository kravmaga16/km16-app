import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../supabase/functions/km16-adhesions/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const id='11111111-1111-1111-1111-111111111111';
const owner='22222222-2222-2222-2222-222222222222';
const items=[{id:'a',total_cents:45500,title:'Enfants'},{id:'b',total_cents:61000,title:'Ados'}];
let handler, enabled=true, phase='expired', creates=0, patches=0;
let group={id,user_id:owner,state:'pending',livemode:false,total_cents:106500,stripe_session_id:'cs_test_Expired'};
class Stripe{
 customers={create:async()=>({id:'cus_test'})};
 checkout={sessions:{
  retrieve:async sid=>({id:sid,metadata:{km16_family:id},livemode:false,status:phase,url:'https://checkout.stripe.com/mock'}),
  create:async (body, opts)=>{
   creates++;
   assert.match(opts.idempotencyKey,/cs_test_Expired$/);
   assert.equal(body.line_items.reduce((n,item)=>n+item.price_data.unit_amount,0),106500);
   assert.equal(body.payment_intent_data.metadata.km16_family,id);
   return {id:'cs_test_New',url:'https://checkout.stripe.com/mock'};
  }
 }};
}
async function fetch(url,req={}){
 if(url.includes('/auth/v1/user'))return Response.json({id:owner,email:'fixture@example.invalid',email_confirmed_at:'now'});
 if(url.includes('membership_config'))return Response.json([{enabled:true,terms_url:'https://example.invalid/terms'}]);
 if(url.includes('membership_orders?family_payment_id'))return Response.json(items);
 if(url.includes('family_payments')){
  assert.match(url,new RegExp(owner));
  if(req.method==='PATCH'){
   patches++;
   assert.match(url,/stripe_session_id=eq.cs_test_Expired/);
   group={...group,...JSON.parse(req.body)};return Response.json([group]);
  }
  return Response.json([group]);
 }
 throw Error(url);
}
const ctx=vm.createContext({Stripe,Response,fetch,console,URL,createCheckoutReminderRecorder:()=>({}),
 Deno:{serve:fn=>handler=fn,env:{get:k=>({SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'mock',
 KM16_ADHESIONS_STRIPE_SECRET_KEY:'sk_test_mock',KM16_FAMILY_CHECKOUT_ENABLED:String(enabled)})[k]}}});
vm.runInContext(source,ctx);
const request=(auth=true)=>handler(new Request('https://edge.invalid',{method:'POST',headers:{origin:'https://app.km16.fr',...(auth?{authorization:'Bearer mock'}:{})},body:JSON.stringify({action:'family-checkout',request_id:id})}));
assert.equal((await request(false)).status,401);
enabled=false;assert.equal((await request()).status,503);enabled=true;
assert.equal((await request()).status,200);
assert.equal(group.stripe_session_id,'cs_test_New');
assert.equal(creates,1);assert.equal(patches,1);
phase='open';assert.equal((await request()).status,200);assert.equal(creates,1);
phase='complete';assert.equal((await request()).status,409);assert.equal(creates,1);
console.log('Paiement familial : authentification, activation, reprise après expiration et protection contre le double paiement vérifiées.');
