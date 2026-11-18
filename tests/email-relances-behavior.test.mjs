// Offline behavioral tests of the actual Edge Function handler (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../supabase/functions/km16-admin-email-alerts/index.ts',import.meta.url),'utf8')
 .replace(/^import \{ createClient \} from .*;\s*/m,'')
 .replace(/\bvalue: unknown\b/g,'value')
 .replace(/\bstate: string\b/g,'state');
const ORIGIN='https://app.km16.fr';
function harness({user={email:'alexandre.marchat@gmail.com',email_confirmed_at:'2026-01-01',is_anonymous:false},authError=null,rows=[]}={}){
 let handler, reads=0, writes=0;
 const query=()=>({
  select(){return this;},or(){return this;},order(){return this;},
  range(from,to){reads++;return Promise.resolve({data:rows.slice(from,to+1),error:null});},
  insert(){writes++;throw Error('write');},update(){writes++;throw Error('write');}
 });
 const createClient=(_url,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user},error:authError})}}:{from:()=>query()};
 const context={Deno:{serve:fn=>{handler=fn},env:{get:k=>({SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'secret'})[k]}},createClient,Request,Response,Date,console};
 vm.runInNewContext(source,context,{timeout:1000});
 return {call:async({origin=ORIGIN,method='POST',token='valid',body={page:0}}={})=>{
  const headers={origin};if(token)headers.authorization='Bearer '+token;
  const req=new Request('https://example.invalid',{method,headers,...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const response=await handler(req);
  return {status:response.status,data:response.status===204?null:await response.json(),headers:response.headers};
 },stats:()=>({reads,writes})};
}
test('unauthenticated and unauthorized requests cannot query tables',async()=>{
 for(const opts of [{token:null},{user:{email:'someone@example.invalid',email_confirmed_at:'yes'}},{user:{email:'alexandre.marchat@gmail.com',is_anonymous:true,email_confirmed_at:'yes'}},{user:{email:'alexandre.marchat@gmail.com',email_confirmed_at:null}},{authError:{message:'invalid'},user:null}]){
  const {token,...setup}=opts;const h=harness(setup);
  const r=await h.call(token===null?{token:null}:{});
  assert.ok([401,403].includes(r.status));
  assert.equal(h.stats().reads,0);
 }
});
test('foreign origin rejected without allow-origin header',async()=>{
 const h=harness(),r=await h.call({origin:'https://evil.example'});
 assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
 assert.equal(h.stats().reads,0);
});
test('authorized read is paginated and never writes',async()=>{
 const rows=Array.from({length:102},(_,i)=>({id:i+1,event_key:'e'+i,recipient:'test@example.invalid',campaign_id:'c'+i,email:'test@example.invalid',state:'failed',attempted_at:null}));
 const h=harness({rows});
 const first=await h.call();
 assert.equal(first.status,200);assert.equal(first.data.alerts.length,200);
 assert.equal(first.data.has_more,true);
 const next=await h.call({body:{page:1}});
 assert.equal(next.status,200);assert.equal(next.data.alerts.length,4);
 assert.equal(next.data.has_more,false);
 assert.equal(h.stats().writes,0);
});
test('invalid page is rejected before database reads',async()=>{
 const h=harness(),r=await h.call({body:{page:-1}});
 assert.equal(r.status,400);assert.equal(h.stats().reads,0);
});

test('OPTIONS preflight is allowed only for the official origin',async()=>{
 const h=harness();
 const ok=await h.call({method:'OPTIONS'});
 assert.equal(ok.status,204);
 assert.equal(ok.headers.get('access-control-allow-origin'),ORIGIN);
 assert.equal(h.stats().reads,0);
});
test('invalid page types and excess page numbers are rejected',async()=>{
 const h=harness();
 for(const page of ['1',1.5,10001,null]){
  const r=await h.call({body:{page}});
  if(page===null){assert.equal(r.status,200);}else{assert.equal(r.status,400);}
 }
});

test('null and array request bodies are rejected',async()=>{
 const h=harness();
 for(const body of [null,[],[1],false]){
  const r=await h.call({body});
  assert.equal(r.status,400);
 }
 assert.equal(h.stats().reads,0);
});
