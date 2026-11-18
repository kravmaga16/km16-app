// Shipped admin page and modules in real browsers; every external request is blocked.
// Authentication, read APIs and notification data below are fictional test doubles.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, extname, sep} from 'node:path';
import {chromium, webkit} from 'playwright';

const root=resolve('.');
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=createServer(async(req,res)=>{try{
 const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!path.startsWith(root+sep)||!(await stat(path)).isFile())throw Error('Invalid path');
 res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
 res.end(await readFile(path));
}catch{res.writeHead(404);res.end('Not found');}});
let origin;
before(async()=>{await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(done=>server.close(done));});
const admin={user:{id:'fixture-admin',email:'alexandre.marchat@gmail.com',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false},access_token:'fixture-only'};

async function harness(browser){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const unexpected=[],errors=[];
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin)return route.continue();
  if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('supabase'))return route.fulfill({status:200,contentType:'text/javascript',body:'/* Local auth double installed before app scripts. */'});
  unexpected.push(url.origin+url.pathname);return route.abort();
 });
 await context.addInitScript(({admin})=>{
  const listeners=[];
  const state=window.__km16EmailTest={session:null,ready:false,calls:[],violations:[],mode:'normal',holdSignOut:false,delivered:0};
  state.notify=(session,event='SIGNED_IN')=>{state.session=session;for(const listener of listeners)listener(event,session);};
  state.login=()=>state.notify(admin);
  const auth={
   getSession:async()=>({data:{session:state.session},error:null}),
   onAuthStateChange:listener=>{listeners.push(listener);state.ready=true;return {data:{subscription:{unsubscribe(){}}}};},
   signOut:async()=>{if(state.holdSignOut)await new Promise(done=>{state.finishSignOut=done;});state.notify(null,'SIGNED_OUT');return {error:null};},
   signInWithPassword:async()=>{state.login();return {data:{session:state.session},error:null};}
  };
  const readRpcs=new Set(['km16_admin_action_progress_list','km16_admin_scheduled_campaigns_list','km16_admin_followup_dashboard','km16_admin_external_payment_summary','km16_admin_external_payment_statuses']);
  const readTables=new Set(['km16_booking_member_links','km16_course_attendance','km16_booking_external_links']);
  window.supabase={createClient:()=>({auth,
   rpc:async(name)=>{if(!readRpcs.has(name)){state.violations.push('rpc:'+name);throw Error('Unexpected RPC');}return {data:[],error:null};},
   from:table=>({select:async()=>{if(!readTables.has(table)){state.violations.push('table:'+table);throw Error('Unexpected table');}return {data:[],error:null};}})
  })};
  const row=(id,action,reference='fixture-'+id)=>({categorie:id===3?'emails_programmes':'achats',notification_id:id,reference,destinataire:'test@example.invalid',statut:action==='validation_requise'?'failed':action==='verification_manuelle'?'uncertain':'sending',derniere_tentative:'2026-11-18T08:00:00Z',action_requise:action});
  const first=[row(1,'validation_requise','<img src=x onerror="window.__emailInjected=true">'),row(2,'blocage_a_verifier'),row(3,'verification_manuelle')];
  const cursor={observed_at:'2026-11-18T09:00:00.000Z',purchases_after:2,campaigns_after:3};
  const realFetch=window.fetch.bind(window);
  window.fetch=async(input,options={})=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(url.origin===location.origin)return realFetch(input,options);
   const body=JSON.parse(options.body||'{}');
   let data,status=200;
   if(url.pathname==='/functions/v1/km16-admin-email-alerts'){
    state.calls.push({body,method:options.method,authorization:options.headers?.Authorization});
    if(state.mode==='hold'){
     // Deliberately deliver despite cancellation to verify the stale-response guard too.
     await new Promise(done=>{state.release=done;});
     data={alerts:[row(99,'validation_requise','LATE-RESPONSE')],page:body.page,has_more:false,cursor:{...cursor,purchases_after:99}};
    }else if(state.mode==='error'){status=503;data={error:'Consultation indisponible'};}
    else data={alerts:body.page===0?first:[first[2],row(4,'validation_requise')],page:body.page,has_more:body.page===0,cursor:body.page===0?cursor:{...cursor,purchases_after:4}};
   }else if(url.pathname==='/functions/v1/km16-clients'&&body.action==='clients')data={clients:[],test:body.test,season:body.season,seasons:[],updated_at:'2026-11-18T09:00:00Z'};
   else if(url.pathname==='/functions/v1/km16-shirts'&&body.action==='list')data={orders:[]};
   else if(url.pathname==='/functions/v1/km16-course-bookings'&&body.action==='admin_list')data={bookings:[],sessions:[]};
   else if(url.pathname==='/functions/v1/km16-communications'&&body.action==='status')data={email_ready:false,campaigns:[]};
   else{state.violations.push('fetch:'+url.pathname+':'+body.action);throw Error('Unexpected external request');}
   if(url.pathname==='/functions/v1/km16-admin-email-alerts')state.delivered++;
   return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  };
 },{admin});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/clients.html#km16-email-relances');
 await page.waitForFunction(()=>window.__km16EmailTest?.ready);
 return {page,context,async check(){assert.deepEqual(unexpected,[],'no request escaped to an external server');assert.deepEqual(errors,[],'no page errors');assert.deepEqual(await page.evaluate(()=>window.__km16EmailTest.violations),[],'only known read operations');}};
}
async function login(page){await page.evaluate(()=>window.__km16EmailTest.login());await page.waitForFunction(()=>!document.querySelector('#km16-email-relances').hidden);}
async function rows(page,count){await page.waitForFunction(count=>document.querySelectorAll('#km16-email-relances-rows tr').length===count,count);}
async function settle(page){await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}
const engines=process.env.KM16_CHROMIUM_ONLY?[['Chromium',chromium]]:[['Chromium',chromium],['WebKit',webkit]];
for(const [name,engine] of engines)test('Email alerts: '+name,{timeout:90000},async t=>{
 const browser=await engine.launch({headless:true,...(name==='Chromium'&&process.env.KM16_CHROMIUM_EXECUTABLE?{executablePath:process.env.KM16_CHROMIUM_EXECUTABLE}:{})});
 try{
  await t.test('guest and nonadmin never see the panel or query alerts',async()=>{
   const h=await harness(browser);try{
    assert.equal(await h.page.locator('#km16-email-relances').isVisible(),false);
    await h.page.evaluate(()=>window.__km16EmailTest.notify({user:{id:'fixture-member',email:'member@example.invalid'},access_token:'fixture-member-token'}));
    await h.page.waitForFunction(()=>!document.querySelector('#forbidden').hidden);
    assert.equal(await h.page.locator('#km16-email-relances').isVisible(),false);
    assert.equal(await h.page.evaluate(()=>window.__km16EmailTest.calls.length),0);
    await h.check();
   }finally{await h.context.close();}
  });
  await t.test('manual read, filtering, literal text and deduplicated pagination',async()=>{
   const h=await harness(browser);try{
    await login(h.page);assert.equal(await h.page.evaluate(()=>window.__km16EmailTest.calls.length),0,'no automatic query');
    await h.page.locator('#km16-email-relances-refresh').click();await rows(h.page,3);
    assert.match(await h.page.locator('#km16-email-relances-rows').textContent(),/<img src=x/);
    assert.equal(await h.page.locator('#km16-email-relances-rows img').count(),0);
    assert.equal(await h.page.evaluate(()=>!!window.__emailInjected),false);
    await h.page.locator('#km16-email-relances-filter').selectOption('verification_manuelle');await rows(h.page,1);
    assert.match(await h.page.locator('#km16-email-relances-rows').textContent(),/fixture-3/);
    assert.match(await h.page.locator('#km16-email-relances-count').textContent(),/1 alerte\(s\) affichée\(s\) sur 3 chargée\(s\)/);
    await h.page.locator('#km16-email-relances-filter').selectOption('');await rows(h.page,3);
    await h.page.locator('#km16-email-relances-more').click();await rows(h.page,4);
    assert.match(await h.page.locator('#km16-email-relances-count').textContent(),/4 alerte\(s\) affichée\(s\) sur 4 chargée\(s\)/);
    assert.equal(await h.page.locator('#km16-email-relances-more').isVisible(),false);
    const calls=await h.page.evaluate(()=>window.__km16EmailTest.calls);
    assert.equal(calls.length,2);assert.equal(calls[0].body.page,0);assert.equal(calls[1].body.page,1);
    assert.equal(calls[1].body.cursor.observed_at,'2026-11-18T09:00:00.000Z');
    assert.ok(calls.every(call=>call.method==='POST'&&call.authorization==='Bearer fixture-only'));
    assert.equal(await h.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'mobile overflow');
    await h.check();
   }finally{await h.context.close();}
  });
  await t.test('auth refresh during a request restores controls and rejects late rows',async()=>{
   const h=await harness(browser);try{
    await login(h.page);await h.page.evaluate(()=>{window.__km16EmailTest.mode='hold';});
    await h.page.locator('#km16-email-relances-refresh').click();
    await h.page.waitForFunction(()=>!!window.__km16EmailTest.release);
    assert.equal(await h.page.locator('#km16-email-relances-refresh').isDisabled(),true);
    await h.page.evaluate(()=>{const s=window.__km16EmailTest;s.notify(s.session,'TOKEN_REFRESHED');});
    await h.page.waitForFunction(()=>!document.querySelector('#km16-email-relances-refresh').disabled);
    await h.page.evaluate(()=>window.__km16EmailTest.release());await h.page.waitForFunction(()=>window.__km16EmailTest.delivered===1);await settle(h.page);
    assert.equal(await h.page.locator('#km16-email-relances-rows tr').count(),0);
    await h.page.evaluate(()=>{window.__km16EmailTest.mode='normal';});
    await h.page.locator('#km16-email-relances-refresh').click();await rows(h.page,3);
    assert.doesNotMatch(await h.page.locator('#km16-email-relances-rows').textContent(),/LATE-RESPONSE/);
    await h.check();
   }finally{await h.context.close();}
  });
  await t.test('logout clears visible addresses before a delayed signOut completes',async()=>{
   const h=await harness(browser);try{
    await login(h.page);await h.page.locator('#km16-email-relances-refresh').click();await rows(h.page,3);
    await h.page.evaluate(()=>{window.__km16EmailTest.holdSignOut=true;});
    await h.page.locator('#logout').click();await h.page.waitForFunction(()=>!!window.__km16EmailTest.finishSignOut);
    assert.equal(await h.page.locator('#km16-email-relances').isVisible(),false);
    assert.equal(await h.page.locator('#km16-email-relances-rows tr').count(),0);
    await h.page.evaluate(()=>window.__km16EmailTest.finishSignOut());
    await h.page.waitForFunction(()=>!document.querySelector('#login').hidden);
    await login(h.page);assert.equal(await h.page.locator('#km16-email-relances-refresh').isEnabled(),true);
    await h.check();
   }finally{await h.context.close();}
  });
  await t.test('failed refresh removes old rows and permits a new attempt',async()=>{
   const h=await harness(browser);try{
    await login(h.page);await h.page.locator('#km16-email-relances-refresh').click();await rows(h.page,3);
    await h.page.evaluate(()=>{window.__km16EmailTest.mode='error';});
    await h.page.locator('#km16-email-relances-refresh').click();
    await h.page.waitForFunction(()=>document.querySelector('#km16-email-relances-status').textContent.includes('indisponibles'));
    assert.equal(await h.page.locator('#km16-email-relances-rows tr').count(),0);
    assert.equal(await h.page.locator('#km16-email-relances-refresh').isEnabled(),true);
    assert.equal(await h.page.locator('#km16-email-relances-more').isVisible(),false);
    await h.check();
   }finally{await h.context.close();}
  });
 }finally{await browser.close();}
});
