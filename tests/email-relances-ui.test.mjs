// Shipped admin page and modules in real browsers; every external request is blocked.
// Authentication, read APIs, review journal and notification data are fictional doubles.
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
  const state=window.__km16EmailTest={session:null,ready:false,calls:[],violations:[],mode:'normal',holdSignOut:false,delivered:0,
   reviewCalls:[],reviewMode:'normal',reviewWrites:0,reviewDelivered:0};
  state.notify=(session,event='SIGNED_IN')=>{state.session=session;for(const listener of listeners)listener(event,session);};
  state.login=()=>state.notify(admin);
  const auth={
   mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2'},error:null})},
   getSession:async()=>({data:{session:state.session},error:null}),
   onAuthStateChange:listener=>{listeners.push(listener);state.ready=true;return {data:{subscription:{unsubscribe(){}}}};},
   signOut:async()=>{if(state.holdSignOut)await new Promise(done=>{state.finishSignOut=done;});state.notify(null,'SIGNED_OUT');return {error:null};},
   signInWithPassword:async()=>{state.login();return {data:{session:state.session},error:null};}
  };
  const readRpcs=new Set(['km16_admin_action_progress_list','km16_admin_scheduled_campaigns_list','km16_admin_followup_dashboard','km16_admin_external_payment_summary','km16_admin_external_payment_statuses','km16_admin_health_documents']);
  const readTables=new Set(['km16_booking_member_links','km16_course_attendance','km16_booking_external_links']);
  // The client dashboard also reads the selected season's club payments on login.
  // Only this bounded read is simulated; writes and other tables remain rejected.
  const clubRegistrationRead=()=>{
   const expected=[
    ['select',['id,client_id,first_name,last_name,email,method,amount_cents,received_on']],
    ['match',[{season_id:document.querySelector('#season').value,test:document.querySelector('#test').checked}]],
    ['order',['created_at',{ascending:false}]],['order',['id']],['range',[0,499]]
   ];
   const query=Object.fromEntries(['select','match','order','range'].map(method=>[method,(...args)=>{
    const next=expected.shift();
    if(!next||next[0]!==method||JSON.stringify(next[1])!==JSON.stringify(args)){
     state.violations.push('table:km16_club_registrations:'+method);throw Error('Unexpected club registration read');
    }
    if(method!=='range')return query;
    if(state.holdClub)return new Promise(resolve=>{state.releaseClub=data=>resolve({data,error:null});});
    return Promise.resolve({data:[],error:null});
   }]));
   return query;
  };
  window.supabase={createClient:()=>({auth,
   rpc:async(name)=>{if(!readRpcs.has(name)){state.violations.push('rpc:'+name);throw Error('Unexpected RPC');}return {data:[],error:null};},
   from:table=>table==='km16_club_registrations'?clubRegistrationRead():({select:async()=>{if(!readTables.has(table)){state.violations.push('table:'+table);throw Error('Unexpected table');}return {data:[],error:null};}})
  })};
  const row=(id,action,reference='fixture-'+id)=>({categorie:id===3?'emails_programmes':'achats',notification_id:id,reference,destinataire:'test@example.invalid',statut:action==='validation_requise'?'failed':action==='verification_manuelle'?'uncertain':'sending',derniere_tentative:'2026-11-18T08:00:00Z',action_requise:action});
  const first=[row(1,'validation_requise','<img src=x onerror="window.__emailInjected=true">'),row(2,'blocage_a_verifier'),row(3,'verification_manuelle')];
  state.alertRows=first;
  const cursor={observed_at:'2026-11-18T09:00:00.000Z',purchases_after:2,campaigns_after:3};
  const review=(id,note='Vérification fictive '+id)=>({id,request_id:'00000000-0000-4000-8000-'+String(id).padStart(12,'0'),
   categorie:'achats',notification_id:1,decision:'a_reexaminer',note,observed_state:id===20?'uncertain':'failed',
   observed_attempted_at:id===20?'2026-11-17T08:00:00Z':'2026-11-18T08:00:00Z',previous_review_id:id-1,
   recorded_by:'00000000-0000-4000-8000-000000000001',recorded_at:'2026-11-18T09:00:00Z'});
  state.reviewRows=[review(20,'<img src=x onerror="window.__reviewInjected=true">'),review(19),review(18)];
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
   }else if(url.pathname==='/functions/v1/km16-admin-email-reviews'){
    state.reviewCalls.push({body,method:options.method,authorization:options.headers?.Authorization,cache:options.cache});
    if(body.action==='history'){
     if(state.reviewMode==='hold-history')await new Promise(done=>{state.releaseReview=done;});
     const source=state.reviewRows.filter(x=>x.categorie===body.categorie&&x.notification_id===body.notification_id&&(!body.before_id||x.id<body.before_id)).sort((a,b)=>b.id-a.id);
     const reviews=source.slice(0,2),has_more=source.length>2;
     data=state.reviewMode==='invalid-history'?{reviews:[null],has_more:false,next_before_id:null}:{reviews,has_more,next_before_id:has_more?reviews.at(-1).id:null};
    }else if(body.action==='record'){
     if(state.reviewMode==='conflict'){status=409;data={error:'Le suivi a changé'};}
     else{
      let saved=state.reviewRows.find(x=>x.request_id===body.request_id);
      if(!saved){
       const latest=state.reviewRows.filter(x=>x.categorie===body.categorie&&x.notification_id===body.notification_id).sort((a,b)=>b.id-a.id)[0]?.id||0;
       if(body.expected_last_review_id!==latest){status=409;data={error:'Version périmée'};}
       else{
        const id=Math.max(0,...state.reviewRows.map(x=>x.id))+1;
        saved={id,request_id:body.request_id,categorie:body.categorie,notification_id:body.notification_id,decision:body.decision,note:body.note,
         observed_state:body.expected_state,observed_attempted_at:body.expected_attempted_at,previous_review_id:body.expected_last_review_id,
         recorded_by:'00000000-0000-4000-8000-000000000001',recorded_at:'2026-11-18T09:30:00Z'};
        state.reviewRows.unshift(saved);state.reviewWrites++;
       }
      }
      if(saved){
       if(state.reviewMode==='hold-record')await new Promise(done=>{state.releaseReview=done;});
       if(state.reviewMode==='ambiguous-once'){state.reviewMode='normal';throw new TypeError('Connection lost after commit');}
       data={review:saved};
      }
     }
    }else{state.violations.push('review-action:'+body.action);throw Error('Unexpected review operation');}
    state.reviewDelivered++;
   }else if(url.pathname==='/functions/v1/km16-clients'&&body.action==='clients')data={clients:state.clients||[],test:body.test,season:body.season,seasons:[],updated_at:'2026-11-18T09:00:00Z'};
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
 return {page,context,async check(){assert.deepEqual(unexpected,[],'no request escaped to an external server');assert.deepEqual(errors,[],'no page errors');assert.deepEqual(await page.evaluate(()=>window.__km16EmailTest.violations),[],'only known reads and explicit journal records; no send operation');}};
}
async function login(page){await page.evaluate(()=>window.__km16EmailTest.login());await page.waitForFunction(()=>!document.querySelector('#km16-email-relances').hidden);}
async function rows(page,count){await page.waitForFunction(count=>document.querySelectorAll('#km16-email-relances-rows tr').length===count,count);}
async function settle(page){await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}
async function openReview(page,checkMobileButton=false){
 await login(page);await page.locator('#km16-email-relances-refresh').click();await rows(page,3);
 const follow=page.locator('#km16-email-relances-rows tr').first().getByRole('button',{name:/Suivi/});
 if(checkMobileButton){
  await follow.scrollIntoViewIfNeeded();
  const fits=await follow.evaluate(button=>{
   const rect=button.getBoundingClientRect();
   return innerWidth===390&&button.closest('.table-wrap').scrollLeft===0&&rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight;
  });
  assert.equal(fits,true,'Suivi is fully visible on 390px without horizontal table scrolling, before clicking');
 }
 await follow.click();
 await page.waitForFunction(()=>!document.querySelector('#km16-email-review-save').disabled);
}
async function fillReview(page,note='Vérification effectuée auprès du fournisseur'){
 await page.locator('#km16-email-review-decision').selectOption('verification_effectuee');
 await page.locator('#km16-email-review-note').fill(note);
}
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
  await t.test('client results are searchable while the club payment read is pending',async()=>{
   const h=await harness(browser);try{
    await h.page.evaluate(()=>{
     const state=window.__km16EmailTest;
     state.holdClub=true;
     state.clients=[{id:'fixture-client',group:'Adultes',first_name:'Élise',last_name:'Martin',
      email:'elise@example.invalid',address:[],products:[],amounts:{}}];
    });
    await login(h.page);
    const row=h.page.locator('#rows tr').filter({hasText:'Martin Élise'});
    await row.waitFor({state:'attached'});
    assert.match(await row.textContent(),/En cours/);
    assert.equal(await h.page.locator('#export').isDisabled(),true);
    await h.page.locator('#search').fill('E\u0301LISE');
    await h.page.waitForFunction(()=>document.querySelector('#client-results-count').textContent.startsWith('1 fiche'));
    await h.page.locator('#search').fill('inconnu');
    await h.page.waitForFunction(()=>document.querySelector('#client-results-count').textContent.startsWith('0 fiche'));
    await h.page.evaluate(()=>window.__km16EmailTest.releaseClub([{id:'fixture-payment',client_id:'fixture-client',
     first_name:'Élise',last_name:'Martin',email:'elise@example.invalid',method:'cash',amount_cents:1250,received_on:'2026-11-18'}]));
    await h.page.locator('#search').fill('règlement au club');
    await row.waitFor({state:'attached'});
    assert.match(await row.textContent(),/12,50/);
    assert.equal(await h.page.locator('#export').isEnabled(),true);
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
  await t.test('journal history, old-attempt marker and explicit save render text safely',async()=>{
   const h=await harness(browser);try{
    await openReview(h.page,true);
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),2);
    assert.match(await h.page.locator('#km16-email-review-history').textContent(),/<img src=x/);
    assert.equal(await h.page.locator('#km16-email-review-history img').count(),0);
    assert.match(await h.page.locator('#km16-email-review-history .km16-email-review-old').textContent(),/ancienne tentative/);
    await h.page.locator('#km16-email-review-more').click();
    await h.page.waitForFunction(()=>document.querySelectorAll('#km16-email-review-history li').length===3);
    const note='  Contrôle <img src=x onerror="window.__reviewInjected=true"> terminé  ';
    await fillReview(h.page,note);await h.page.locator('#km16-email-review-save').click();
    await h.page.waitForFunction(()=>document.querySelector('#km16-email-review-status').textContent.includes('Vérification enregistrée'));
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),4);
    assert.equal(await h.page.locator('#km16-email-review-history img').count(),0);
    assert.equal(await h.page.evaluate(()=>!!window.__reviewInjected),false);
    assert.equal(await h.page.locator('#km16-email-relances-rows tr').count(),3,'annotation never removes an alert');
    const calls=await h.page.evaluate(()=>window.__km16EmailTest.reviewCalls);
    const record=calls.find(x=>x.body.action==='record');
    assert.equal(record.body.note,note.trim());assert.equal(record.body.expected_last_review_id,20,'older pages do not replace newest revision');
    assert.equal(record.body.expected_state,'failed');assert.equal(record.body.expected_attempted_at,'2026-11-18T08:00:00Z');
    assert.equal(record.body.recorded_by,undefined,'actor must be server-owned');
    assert.ok(calls.every(x=>x.method==='POST'&&x.authorization==='Bearer fixture-only'&&x.cache==='no-store'));
    assert.equal(await h.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'journal mobile overflow');
    await h.check();
   }finally{await h.context.close();}
  });
  await t.test('journal preserves microsecond attempts and 1000 Unicode code points',async()=>{
   const h=await harness(browser);try{
    await h.page.evaluate(()=>{
     const state=window.__km16EmailTest;
     state.alertRows[0].derniere_tentative='2026-11-18T08:00:00.123457Z';
     state.reviewRows[0].observed_state='failed';state.reviewRows[0].observed_attempted_at='2026-11-18T09:00:00.123456+01:00';
     state.reviewRows[0].note='🥋'.repeat(1000);
     state.reviewRows[1].observed_attempted_at='2026-11-18T09:00:00.123457+01:00';
    });
    await openReview(h.page);
    assert.equal(await h.page.locator('#km16-email-review-history li').first().locator('.km16-email-review-old').count(),1,'one microsecond difference is a different attempt');
    assert.equal(await h.page.locator('#km16-email-review-history li').nth(1).locator('.km16-email-review-old').count(),0,'equivalent offsets preserve the same instant');
    assert.equal(await h.page.locator('#km16-email-review-history li').first().locator('.km16-email-review-note').textContent(),'🥋'.repeat(1000));
    await fillReview(h.page,'🥋'.repeat(1000));await h.page.locator('#km16-email-review-save').click();
    await h.page.waitForFunction(()=>document.querySelector('#km16-email-review-status').textContent.includes('Vérification enregistrée'));
    const record=await h.page.evaluate(()=>window.__km16EmailTest.reviewCalls.find(x=>x.body.action==='record').body);
    assert.equal(Array.from(record.note).length,1000);assert.equal(record.expected_attempted_at,'2026-11-18T08:00:00.123457Z');
    await h.check();
   }finally{await h.context.close();}
  });
  await t.test('ambiguous save locks editing; double click and retry retain one request ID',async()=>{
   const h=await harness(browser);try{
    await openReview(h.page);await fillReview(h.page,'Vérification avec réponse perdue');
    await h.page.evaluate(()=>{window.__km16EmailTest.reviewMode='ambiguous-once';const button=document.querySelector('#km16-email-review-save');button.click();button.click();});
    await h.page.waitForFunction(()=>document.querySelector('#km16-email-review-status').textContent.includes('Résultat non confirmé'));
    assert.equal(await h.page.locator('#km16-email-review-note').isDisabled(),true);
    assert.equal(await h.page.locator('#km16-email-review-decision').isDisabled(),true);
    assert.equal(await h.page.evaluate(()=>window.__km16EmailTest.reviewCalls.filter(x=>x.body.action==='record').length),1);
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),2,'no optimistic history entry');
    await h.page.locator('#km16-email-review-save').click();
    await h.page.waitForFunction(()=>document.querySelector('#km16-email-review-status').textContent.includes('Vérification enregistrée'));
    const records=await h.page.evaluate(()=>window.__km16EmailTest.reviewCalls.filter(x=>x.body.action==='record'));
    assert.equal(records.length,2);assert.deepEqual(records[0].body,records[1].body);
    assert.match(records[0].body.request_id,/^[0-9a-f-]{36}$/);
    assert.equal(await h.page.evaluate(()=>window.__km16EmailTest.reviewWrites),1);
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),3);
    assert.equal(await h.page.locator('#km16-email-review-note').inputValue(),'');
    await h.check();
   }finally{await h.context.close();}
  });
  await t.test('conflict never reports success or retries and requires alert refresh',async()=>{
   const h=await harness(browser);try{
    await openReview(h.page);await fillReview(h.page);
    await h.page.evaluate(()=>{window.__km16EmailTest.reviewMode='conflict';});
    await h.page.locator('#km16-email-review-save').click();
    await h.page.waitForFunction(()=>document.querySelector('#km16-email-review-status').textContent.includes('Le suivi ou la tentative a changé'));
    assert.equal(await h.page.locator('#km16-email-review-save').isDisabled(),true);
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),2);
    assert.equal(await h.page.evaluate(()=>window.__km16EmailTest.reviewWrites),0);
    await h.page.locator('#km16-email-review-reload').click();
    await h.page.waitForFunction(()=>document.querySelector('#km16-email-review-status').textContent.includes('Historique rechargé'));
    assert.equal(await h.page.locator('#km16-email-review-save').isDisabled(),true);
    assert.equal(await h.page.evaluate(()=>window.__km16EmailTest.reviewCalls.filter(x=>x.body.action==='record').length),1);
    await h.page.locator('#km16-email-relances-refresh').click();await rows(h.page,3);
    assert.equal(await h.page.locator('#km16-email-review').isVisible(),false);
    assert.equal(await h.page.locator('#km16-email-review-note').inputValue(),'');
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),0);
    await h.check();
   }finally{await h.context.close();}
  });
  for(const action of ['close','logout'])await t.test(action+' clears journal and rejects a late save response',async()=>{
   const h=await harness(browser);try{
    await openReview(h.page);await fillReview(h.page,'LATE-REVIEW');
    await h.page.evaluate(()=>{window.__km16EmailTest.reviewMode='hold-record';});
    await h.page.locator('#km16-email-review-save').click();
    await h.page.waitForFunction(()=>!!window.__km16EmailTest.releaseReview);
    await h.page.locator(action==='close'?'#km16-email-review-close':'#logout').click();
    assert.equal(await h.page.locator('#km16-email-review').isVisible(),false);
    assert.equal(await h.page.locator('#km16-email-review-note').inputValue(),'');
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),0);
    await h.page.evaluate(()=>window.__km16EmailTest.releaseReview());
    await h.page.waitForFunction(()=>window.__km16EmailTest.reviewDelivered===2);await settle(h.page);
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),0);
    assert.equal(await h.page.locator('#km16-email-review-status').textContent(),'');
    assert.equal(await h.page.locator('#km16-email-review').isVisible(),false);
    await h.check();
   }finally{await h.context.close();}
  });
  await t.test('malformed history cannot enable an annotation',async()=>{
   const h=await harness(browser);try{
    await login(h.page);await h.page.locator('#km16-email-relances-refresh').click();await rows(h.page,3);
    await h.page.evaluate(()=>{window.__km16EmailTest.reviewMode='invalid-history';});
    await h.page.locator('#km16-email-relances-rows tr').first().getByRole('button',{name:/Suivi/}).click();
    await h.page.waitForFunction(()=>document.querySelector('#km16-email-review-status').textContent.includes('Historique indisponible'));
    assert.equal(await h.page.locator('#km16-email-review-save').isDisabled(),true);
    assert.equal(await h.page.locator('#km16-email-review-history li').count(),0);
    assert.equal(await h.page.evaluate(()=>window.__km16EmailTest.reviewCalls.filter(x=>x.body.action==='record').length),0);
    await h.check();
   }finally{await h.context.close();}
  });
 }finally{await browser.close();}
});
