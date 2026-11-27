import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

// Real pages and shared checkout module; every Auth/API/payment request is replaced.
// No verification email, account, order, or payment is created by this suite.
const ORIGIN='https://km16-fixture.test';
const confirmed={access_token:'fixture-token',user:{id:'fixture-user',email:'first@example.invalid',is_anonymous:false,email_confirmed_at:'2026-11-18T00:00:00Z'}};
const files=new Map();
for(const path of ['index.html','tee-shirts.html','tee-shirts.mjs','checkout-account.mjs'])files.set('/'+path,await readFile(path,'utf8'));
const index=files.get('/index.html');
const videoModule=[...index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('createCheckoutAccess'));
const authCapture=[...index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('KM16_AUTH_FRAGMENT')&&!s.includes('createCheckoutAccess'));
assert.ok(videoModule&&authCapture);
files.set('/video-module.mjs',videoModule);
files.set('/index.html',index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>${authCapture}\nwindow.showFixtureView=id=>{document.querySelectorAll('.panel').forEach(e=>{e.hidden=e.id!==id;e.classList.toggle('active',e.id===id)});window.dispatchEvent(new CustomEvent('km16-view-change',{detail:{id}}));};window.showFixtureView(location.hash==='#videos'?'videos':'accueil');</script><script type="module" src="/video-module.mjs"></script>`);
const stub=`
window.TEST_CALLS=[];window.TEST_OTP=[];window.TEST_VIDEO_QUERIES=0;window.TEST_SESSION=window.TEST_INITIAL_SESSION||null;
const listeners=[];
window.notifyAuth=(next,event='SIGNED_IN')=>{window.TEST_SESSION=next;listeners.forEach(fn=>fn(event,next));};
const auth={
 getSession:async()=>{window.TEST_SESSION_READS=(window.TEST_SESSION_READS||0)+1;if(window.TEST_SWITCH_ACCOUNT&&window.TEST_SESSION_READS===2)window.notifyAuth(window.TEST_SWITCH_ACCOUNT);return {data:{session:window.TEST_SESSION},error:null};},
 onAuthStateChange:fn=>{listeners.push(fn);return {data:{subscription:{unsubscribe(){}}}};},
 signInWithOtp:async data=>{window.TEST_OTP.push(data);if(window.TEST_OTP_ERROR)throw Error('fixture offline');return {data:{user:null,session:null},error:null};},
 setSession:async()=>{window.notifyAuth(window.TEST_CONFIRMED);return {data:{session:window.TEST_SESSION},error:null};},
 signInWithPassword:async ({email})=>{const next={...window.TEST_CONFIRMED,user:{...window.TEST_CONFIRMED.user,email}};window.notifyAuth(next);return {data:{session:next},error:null};},
 signOut:async()=>{window.notifyAuth(null,'SIGNED_OUT');return {error:null};},
 resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({error:null})
};
window.supabase={createClient:()=>({auth,from:table=>{
 if(table==='km16_videos')window.TEST_VIDEO_QUERIES++;
 const data=table==='km16_videos'?[{id:'video-1',title:'Vidéo test',description:'Présentation',price_cents:999,currency:'eur'}]:table==='km16_purchases'?(window.TEST_OWNED?[{video_id:'video-1'}]:[]):{vimeo_id:'12345',start_seconds:0};
 const query={select(){return this},eq(){return this},order(){return Promise.resolve({data,error:null})},maybeSingle(){return Promise.resolve({data,error:null})},then(resolve,reject){return Promise.resolve({data,error:null}).then(resolve,reject)}};return query;
}})};`;
const engines=process.env.KM16_CHROMIUM_ONLY?[['Chromium',chromium]]:[['Chromium',chromium],['WebKit',webkit]];
let count=0;
for(const [name,engine]of engines){
 const browser=await engine.launch({headless:true,...(name==='Chromium'&&process.env.KM16_CHROMIUM_PATH?{executablePath:process.env.KM16_CHROMIUM_PATH,args:['--no-sandbox']}: {})});
 try{
  for(const width of [390,1280])for(const kind of ['shirts','video']){
   const context=await browser.newContext({viewport:{width,height:900}});
   const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
   await context.addInitScript(({confirmed})=>{window.TEST_CONFIRMED=confirmed;},{confirmed});
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});
    if(url.origin===ORIGIN){
     const path=url.pathname==='/'?'/index.html':url.pathname;
     if(files.has(path))return route.fulfill({contentType:path.endsWith('.html')?'text/html':'application/javascript',body:files.get(path)});
     return route.fulfill({status:404,body:''});
    }
    if(url.pathname.includes('/functions/v1/')){
     const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
     if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
     const data=JSON.parse(request.postData()||'{}');
     await request.frame().evaluate(data=>window.TEST_CALLS.push(data),data);
     if(data.action==='list')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({orders:[]})});
     // Delayed failure verifies busy prevents two API submissions without opening Stripe.
     await new Promise(resolve=>setTimeout(resolve,80));
     return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Paiement simulé, aucune commande créée.'})});
    }
    return route.abort();
   });
   const page=await context.newPage();
   if(kind==='video'){
    const home=await context.newPage();
    await home.goto(ORIGIN);
    await home.waitForFunction(()=>typeof document.getElementById('kv-refresh').onclick==='function');
    assert.equal(await home.evaluate(()=>window.TEST_VIDEO_QUERIES),0,'home does not query the video catalogue');
    await home.evaluate(()=>{window.showFixtureView('videos');window.showFixtureView('videos');});
    await home.locator('#kv-catalog button').first().waitFor();
    assert.equal(await home.evaluate(()=>window.TEST_VIDEO_QUERIES),1,'opening the video tab loads its catalogue once');
    await home.close();
    const paymentReturn=await context.newPage();
    await paymentReturn.addInitScript(({confirmed})=>{
     window.TEST_INITIAL_SESSION=confirmed;
     window.TEST_OWNED=true;
    },{confirmed});
    await paymentReturn.goto(ORIGIN+'/?payment=success');
    await paymentReturn.waitForFunction(()=>document.getElementById('kv-status').textContent.includes('Votre achat est disponible'));
    assert.ok(await paymentReturn.evaluate(()=>window.TEST_VIDEO_QUERIES>0),'payment return refreshes the library without opening the tab');
    await paymentReturn.close();
   }
   await page.goto(ORIGIN+(kind==='shirts'?'/tee-shirts.html'+(width===390?'?sizes=XXS,2XL':'?sizes=M,L,XXS'):'/#videos'));
   const input=kind==='shirts'?'#purchase-email':'#kv-purchase-email';
   const button=kind==='shirts'?'#pay':'#kv-purchase-submit';
   const host=kind==='shirts'?'#shirt-email-verification':'#kv-purchase-verification';
   const reminder=kind==='shirts'?'#checkout-reminder':'#kv-checkout-reminder';
   const optedIn=width===390;
   const ready=kind==='shirts'?'#pay':'#kv-catalog button';
   await page.locator(ready).first().waitFor();
   if(kind==='shirts'){
    await page.waitForFunction(()=>window.notifyAuth&&typeof document.getElementById('shirt-order').onsubmit==='function');
    assert.equal(await page.locator('#quantity').inputValue(),width===390?'2':'1','only one or two whitelisted sizes can be preselected');
    assert.equal(await page.locator('#size1').inputValue(),width===390?'XXS':'M');
    if(width===390)assert.equal(await page.locator('#size2').inputValue(),'2XL');
    await page.locator('#quantity').selectOption('2');await page.locator('#size1').selectOption('XS');await page.locator('#size2').selectOption('XL');
   }else await page.locator('#kv-catalog button').first().click();
   assert.equal(await page.locator(input).isEditable(),true);
   assert.equal(await page.locator(reminder).isChecked(),false,'reminder opt-in starts unchecked');
   assert.equal(await page.locator(reminder).getAttribute('required'),null,'reminder is always optional');
   assert.equal(await page.locator(button).isEnabled(),true);
   await page.locator(input).fill('invalid');await page.locator(button).click();
   assert.equal(await page.evaluate(()=>window.TEST_OTP.length),0,'invalid email must not request identity');
   await page.locator(input).fill('first@example.invalid');
   if(optedIn)await page.locator(reminder).check();
   await page.locator(button).click();
   await page.waitForFunction(()=>window.TEST_OTP.length===1);
   await page.waitForFunction(()=>document.querySelector('[data-checkout-access-status]')?.textContent.includes('Ouvrez le lien'));
   assert.equal(await page.locator(host).isVisible(),true);
   assert.equal(await page.evaluate(()=>window.TEST_OTP[0].options.shouldCreateUser),true);
   assert.equal(await page.evaluate(()=>window.TEST_CALLS.some(c=>c.action==='checkout'||c.video_id)),false,'no checkout before verification');
   await page.locator(button).click();
   assert.equal(await page.evaluate(()=>window.TEST_OTP.length),1,'repeat submit reuses verification');
   // Confirmation in another tab resumes saved data; it must not submit payment automatically.
   const returning=await context.newPage();
   await returning.addInitScript(({confirmed})=>{window.TEST_INITIAL_SESSION=confirmed;},{confirmed});
   await returning.goto(ORIGIN+'/#access_token=fixture&refresh_token=fixture&type=signup');
   if(kind==='shirts')await returning.waitForURL('**/tee-shirts.html');
   await returning.locator(input).waitFor();
   await returning.waitForFunction(selector=>document.querySelector(selector)?.value==='first@example.invalid',input);
   if(kind==='shirts'){
    await returning.waitForFunction(()=>document.getElementById('quantity').value==='2');
    assert.equal(await returning.locator('#size1').inputValue(),'XS');assert.equal(await returning.locator('#size2').inputValue(),'XL');
   }else{
    await returning.locator('#kv-purchase').waitFor({state:'visible'});
    assert.match(await returning.locator('#kv-purchase-summary').textContent(),/Vidéo test/);
   }
   assert.equal(await returning.locator(input).isEditable(),false);
   assert.equal(await returning.locator(reminder).isChecked(),false,'OTP draft restores the choice of product, never stale reminder consent');
   assert.equal(await returning.evaluate(()=>window.TEST_CALLS.some(c=>c.action==='checkout'||c.video_id)),false);
   // A different account appearing between verification and checkout must never receive this purchase.
   await returning.evaluate(({confirmed})=>{window.TEST_SESSION_READS=0;window.TEST_SWITCH_ACCOUNT={...confirmed,user:{...confirmed.user,id:'other-user',email:'other@example.invalid'}};},{confirmed});
   await returning.locator(button).click();
   await returning.waitForFunction(()=>window.TEST_SESSION?.user.id==='other-user');
   await returning.waitForFunction(selector=>!document.querySelector(selector).disabled,button);
   await returning.waitForFunction(selector=>document.querySelector(selector).value==='other@example.invalid',input);
   assert.equal(await returning.evaluate(()=>window.TEST_CALLS.some(c=>c.action==='checkout'||c.video_id)),false,'account switch must block checkout');
   assert.equal(await returning.locator(reminder).isChecked(),false,'an account switch clears reminder consent');
   await returning.evaluate(({confirmed})=>{window.TEST_SWITCH_ACCOUNT=null;window.notifyAuth(confirmed);},{confirmed});
   await returning.waitForFunction(selector=>document.querySelector(selector).value==='first@example.invalid',input);
   if(optedIn)await returning.locator(reminder).check();
   await returning.locator(button).dblclick();
   await returning.waitForFunction(()=>window.TEST_CALLS.some(c=>c.action==='checkout'||c.video_id));
   await returning.waitForFunction(selector=>!document.querySelector(selector).disabled,button);
   assert.equal(await returning.evaluate(()=>window.TEST_CALLS.filter(c=>c.action==='checkout'||c.video_id).length),1);
   assert.equal(await returning.evaluate(()=>window.TEST_CALLS.find(c=>c.action==='checkout'||c.video_id).reminder_opt_in),optedIn,'checkout sends the explicit boolean, including false');
   if(kind==='shirts')assert.deepEqual(await returning.evaluate(()=>window.TEST_CALLS.find(c=>c.action==='checkout').sizes),['XS','XL']);
   else assert.equal(await returning.evaluate(()=>window.TEST_CALLS.find(c=>c.video_id).video_id),'video-1');
   assert.equal(await returning.locator(button).isEnabled(),true,'payment failure can be retried');
   // Even a replacement account with the same email cannot inherit the old opt-in.
   await returning.locator(reminder).check();
   await returning.evaluate(({confirmed})=>{window.TEST_SESSION_READS=1;window.TEST_SWITCH_ACCOUNT={...confirmed,user:{...confirmed.user,id:'replacement-user'}};},{confirmed});
   await returning.locator(button).click();
   await returning.waitForFunction(()=>window.TEST_CALLS.filter(c=>c.action==='checkout'||c.video_id).length===2);
   await returning.waitForFunction(selector=>!document.querySelector(selector).disabled,button);
   assert.equal(await returning.evaluate(()=>window.TEST_CALLS.filter(c=>c.action==='checkout'||c.video_id).at(-1).reminder_opt_in),false,'consent belongs to the account present when the form was submitted');
   // Explicit logout clears account and pending draft without disabling guest email entry.
   await returning.locator(reminder).check();
   await returning.locator(kind==='shirts'?'#logout':'#kv-logout').click();
   await returning.waitForFunction(selector=>!document.querySelector(selector).readOnly,input);
   assert.equal(await returning.locator(input).inputValue(),'');
   assert.equal(await returning.locator(reminder).isChecked(),false,'logout clears reminder consent');
   assert.equal(await returning.evaluate(()=>localStorage.getItem('km16-pending-checkout')),null);
   // A failing email request must leave the choice intact and a working retry control.
   await returning.evaluate(()=>{window.TEST_OTP_ERROR=true;});
   await returning.locator(input).fill('next@example.invalid');await returning.locator(button).click();
   await returning.waitForFunction(()=>window.TEST_OTP.length>0);
   await returning.waitForFunction(selector=>!document.querySelector(selector).disabled,button);
   assert.equal(await returning.locator(input).inputValue(),'next@example.invalid');
   if(kind==='shirts')assert.equal(await returning.locator('#quantity').inputValue(),'2');
   else assert.equal(await returning.locator('#kv-purchase').isVisible(),true);
   assert.deepEqual(errors,[]);
   assert.equal(await returning.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name} ${width}px overflow`);
   await context.close();console.log(`PASS ${name} ${width}px ${kind}: guest, confirmation return, no automatic payment, retry, logout`);count++;
  }
 }finally{await browser.close();}
}
console.log(`PASS ${count} guest purchase journeys; all email/Auth/API/payment responses simulated.`);
