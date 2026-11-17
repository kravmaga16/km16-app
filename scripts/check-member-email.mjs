import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium, webkit} from 'playwright';

// Real form/module with deterministic Auth/API stubs. All external requests are blocked.
const html=readFileSync('adhesion.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const source=readFileSync('adhesion.mjs','utf8').replace(/^import .*$/gm,'');
const helpers=['birth-date-input.mjs','member-photo.mjs','purchase-links.mjs','rules.mjs'].map(path=>readFileSync(path,'utf8').replace(/\bexport /g,'')).join('\n');
const products=JSON.parse(readFileSync('catalogue.json','utf8'));
const initial={user:{email:'test@example.invalid',id:'fixture-user',is_anonymous:false},access_token:'fixture-only'};
const scenarios=['guest','session','slow-catalogue','anonymous','login-error','network-error','refresh','logout'];
const engines=process.env.KM16_CHROMIUM_ONLY?[['Chromium',chromium]]:[['Chromium',chromium],['WebKit',webkit]];
let count=0;
for(const [engineName,engine] of engines){
 const browser=await engine.launch({headless:true,...(engineName==='Chromium'&&process.env.KM16_CHROMIUM_PATH?{executablePath:process.env.KM16_CHROMIUM_PATH,args:['--no-sandbox']}: {})});
 try{
  for(const width of [390,1280])for(const scenario of scenarios){
   const page=await browser.newPage({viewport:{width,height:844}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.abort());
   await page.setContent(html);
   const session=['session','slow-catalogue','refresh','logout'].includes(scenario)?initial:scenario==='anonymous'?{user:{id:'anonymous-fixture',is_anonymous:true},access_token:'fixture-only'}:null;
   await page.evaluate(({session,products,slow})=>{
    window.TEST_SESSION=session;window.CATALOGUE=products;window.TEST_ACTIONS=[];
    crypto.randomUUID??=()=> '00000000-0000-4000-8000-000000000001';
    window.supabase={createClient:()=>({auth:{
     getSession:async()=>({data:{session:window.TEST_SESSION}}),
     onAuthStateChange:fn=>{window.authNotify=fn;return {data:{subscription:{unsubscribe(){}}}};},
     signInWithPassword:async({email,password})=>{
      if(password==='bad')return {error:{code:'invalid_credentials'}};
      if(password==='offline')throw Error('Network unavailable');
      window.TEST_SESSION={user:{email,id:'fixture-user'},access_token:'fixture-only'};
      window.authNotify?.('SIGNED_IN',window.TEST_SESSION);
      return {data:{session:window.TEST_SESSION},error:null};
     },
     signOut:async()=>{window.TEST_SESSION=null;window.authNotify?.('SIGNED_OUT',null);return {error:null};}
    },rpc:async()=>({data:[],error:null})})};
    window.fetch=async(url,options)=>{
     const action=JSON.parse(options?.body||'{}').action;
     window.TEST_ACTIONS.push(action||String(url));
     if(action==='catalogue'&&slow)await new Promise(resolve=>window.finishCatalogue=resolve);
     return {ok:true,json:async()=>String(url).includes('catalogue.json')?window.CATALOGUE:action==='catalogue'?{
      products:window.CATALOGUE,enabled:true,
      terms_url:'https://app.km16.fr/conditions-adhesion.html',privacy_url:'https://app.km16.fr/confidentialite.html'
     }:{orders:[],payments:[],documents:[]}};
    };
   },{session,products,slow:scenario==='slow-catalogue'});
   await page.evaluate('(()=>{window.BOOT=(async()=>{'+helpers+'\n'+source+'})().catch(e=>window.BOOT_ERROR=e.message)})()');
   await page.waitForFunction(()=>document.querySelectorAll('#catalogue button:not([disabled])').length>0||window.BOOT_ERROR);
   assert.equal(await page.evaluate(()=>window.BOOT_ERROR),undefined);
   await page.locator('#catalogue button:not([disabled])').first().click();
   if(['guest','anonymous','login-error','network-error'].includes(scenario)){
    assert.equal(await page.locator('#order').isVisible(),false);
    assert.equal(await page.locator('#account-required').isVisible(),true);
    assert.equal(await page.locator('#email').isEditable(),true);
    await page.locator('#email').fill('test@example.invalid');
    await page.locator('#password').fill(scenario==='login-error'?'bad':scenario==='network-error'?'offline':'fixture-password');
    await page.locator('#login-submit').click();
    if(['login-error','network-error'].includes(scenario)){
     await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('Connexion impossible'));
     assert.equal(await page.locator('#login-submit').isEnabled(),true);
     assert.equal(await page.locator('#order').isVisible(),false);
     await page.locator('#password').fill('fixture-password');await page.locator('#login-submit').click();
    }
   }
   await page.waitForFunction(()=>document.getElementById('contact_email').value==='test@example.invalid'&&!document.getElementById('order').hidden);
   assert.notEqual(await page.locator('#contact_email').getAttribute('readonly'),null);
   if(scenario==='slow-catalogue'){
    assert.equal(await page.evaluate(()=>!!window.finishCatalogue),true);
    await page.evaluate(()=>window.finishCatalogue());
   }
   if(scenario==='refresh'){
    await page.locator('#first_name').fill('Prénom conservé');
    await page.evaluate(()=>window.authNotify('TOKEN_REFRESHED',window.TEST_SESSION));
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#first_name').inputValue(),'Prénom conservé');
   }
   if(scenario==='logout'){
    await page.locator('#logout').click();
    await page.waitForFunction(()=>document.getElementById('order').hidden);
    assert.equal(await page.locator('#contact_email').inputValue(),'');
    assert.equal(await page.locator('#email').isEditable(),true);
   }
   assert.deepEqual(errors,[]);
   assert.equal(await page.evaluate(()=>window.TEST_ACTIONS.every(action=>['catalogue','orders','./catalogue.json'].includes(action))),true);
   console.log(`PASS ${engineName} ${width}px ${scenario}`);count++;
   await page.close();
  }
 }finally{await browser.close();}
}
console.log(`PASS: ${count} customer email scenarios; no external calls or purchases.`);
