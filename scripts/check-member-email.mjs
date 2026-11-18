import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {chromium,webkit} from 'playwright';

// Shipped HTML and real ES modules, including IndexedDB draft recovery.
// Auth and API doubles never create a real user, send email, upload or purchase.
const root=resolve('.'),products=JSON.parse(await readFile('catalogue.json','utf8'));
const confirmed={user:{email:'test@example.invalid',id:'fixture-user',is_anonymous:false,email_confirmed_at:'2026-01-01T00:00:00Z'},access_token:'fixture-only'};
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=createServer(async(req,res)=>{try{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(name==='/__camera-host.html'){
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
  res.end(`<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px system-ui}.panel:not(.active),[hidden]{display:none!important}main{max-width:1200px;margin:auto;padding:12px}header{height:140px;background:#222;color:#fff;padding:12px;box-sizing:border-box}</style></head><body><header>Page d’accueil KM16 — simulation locale</header><main><section id="tarifs" class="panel active"><div id="payment-console"><h2>Votre inscription</h2><p id="payment-console-status"></p><p id="payment-legacy" hidden></p><div id="payment-console-host"></div></div></section></main><script type="module" src="/payment-console.mjs"></script></body></html>`);return;
 }

 const path=resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!path.startsWith(root+sep)||!(await stat(path)).isFile())throw Error('Invalid path');
 res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(path));
}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const engines=process.env.KM16_CHROMIUM_ONLY?[['Chromium',chromium]]:[['Chromium',chromium],['WebKit',webkit]];
const allScenarios=['guest','session','anonymous','unconfirmed','slow-catalogue','guest-refresh','network-error','network-reload','rate-limit','wrong-identity','draft-new-tab','logout','minor','identity-switch-before-checkout','camera','camera-errors','camera-cancel-pending','camera-embed'];
const scenarios=process.env.KM16_CAMERA_ONLY?allScenarios.filter(name=>name.startsWith('camera')):allScenarios;
const otpCalls=events=>events.filter(e=>e.type==='otp');
const writes=events=>events.filter(e=>e.type==='api'&&['photo-upload','checkout'].includes(e.body.action));
let count=0;

async function harness(browser,width,scenario){
 const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
 const events=[],errors=[],unexpected=[];
 await context.exposeBinding('__record',(_source,event)=>events.push(event));
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin)return route.continue();
  if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('supabase'))return route.fulfill({status:200,contentType:'text/javascript',body:'/* Auth test double already installed. */'});
  if(url.hostname==='checkout.stripe.com')return route.fulfill({status:200,contentType:'text/html',body:'<h1>Payment simulation only</h1>'});
  unexpected.push(url.origin+url.pathname);return route.abort();
 });
 const initial=['session','slow-catalogue','logout','identity-switch-before-checkout'].includes(scenario)?confirmed:scenario==='anonymous'?{user:{id:'anon-fixture',is_anonymous:true},access_token:'anonymous-fixture'}:scenario==='unconfirmed'?{user:{id:'unconfirmed-fixture',email:'test@example.invalid',is_anonymous:false,email_confirmed_at:null},access_token:'unconfirmed-fixture'}:null;
 await context.addInitScript(({initial,products,scenario,confirmed})=>{
  if(!['127.0.0.1','localhost'].includes(location.hostname))return;
  const saved=localStorage.getItem('km16-test-auth');
  window.TEST_SESSION=saved?JSON.parse(saved):initial;
  window.TEST_OTP_BEHAVIOR=['network-error','network-reload'].includes(scenario)&&!localStorage.getItem('km16-test-otp-ok')?'network':scenario==='rate-limit'?'rate-limit':'ok';
  window.TEST_CHECKOUT_DELAY=0;
  // A real synthetic video stream exercises video.play(), canvas capture and JPEG
  // conversion, without requesting a device or granting camera permissions.
  const camera=window.TEST_CAMERA={behavior:'ok',color:'#4466aa',requests:[],streams:[],pending:[]};
  function cameraStream(constraints){
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=400;
   const paint=()=>{const ctx=canvas.getContext('2d');ctx.fillStyle=camera.color;ctx.fillRect(0,0,320,400);ctx.fillStyle='#fff';ctx.fillRect(80,100,160,200);};
   paint();const stream=canvas.captureStream(12),timer=setInterval(paint,80);
   const deviceId=constraints.video?.deviceId?.exact||'fixture-front';
   const facingMode=deviceId==='fixture-rear'?'environment':'user';
   for(const track of stream.getTracks()){
    const stop=track.stop.bind(track),settings=track.getSettings.bind(track);
    track.stop=()=>{clearInterval(timer);stop();};
    track.getSettings=()=>({...settings(),deviceId,facingMode});
   }
   camera.streams.push(stream);return stream;
  }
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
   getUserMedia:async constraints=>{
    camera.requests.push(constraints);
    if(camera.behavior==='pending')return new Promise((resolve,reject)=>camera.pending.push({resolve:()=>resolve(cameraStream(constraints)),reject}));
    if(camera.behavior!=='ok')throw new DOMException('Synthetic camera failure',camera.behavior);
    return cameraStream(constraints);
   },
   enumerateDevices:async()=>[{kind:'videoinput',deviceId:'fixture-front',label:'Caméra avant fictive'},{kind:'videoinput',deviceId:'fixture-rear',label:'Caméra arrière fictive'}],
   getSupportedConstraints:()=>({facingMode:true,width:true,height:true})
  }});

  const listeners=[];
  window.authNotify=(event,next)=>{
   window.TEST_SESSION=next;localStorage.setItem('km16-test-auth',JSON.stringify(next));localStorage.setItem('km16-video-auth',JSON.stringify(next));
   for(const listener of listeners)listener(event,next);
  };
  const auth={
   getSession:async()=>({data:{session:window.TEST_SESSION},error:null}),
   getUser:async()=>({data:{user:window.TEST_SESSION?.user||null},error:null}),
   onAuthStateChange:fn=>{listeners.push(fn);queueMicrotask(()=>fn('INITIAL_SESSION',window.TEST_SESSION));return {data:{subscription:{unsubscribe(){}}}};},
   signInWithOtp:async args=>{
    await window.__record({type:'otp',args});
    if(window.TEST_OTP_BEHAVIOR==='network')throw Error('Simulated network failure');
    if(window.TEST_OTP_BEHAVIOR==='rate-limit')return {data:{user:null,session:null},error:{status:429,code:'over_email_send_rate_limit',message:'Rate limit'}};
    return {data:{user:null,session:null},error:null};
   },
   signInWithPassword:async({email,password})=>{
    await window.__record({type:'password'});if(password==='bad')return {error:{code:'invalid_credentials'}};
    const session={...confirmed,user:{...confirmed.user,email}};window.authNotify('SIGNED_IN',session);return {data:{session},error:null};
   },
   signOut:async()=>{window.authNotify('SIGNED_OUT',null);return {error:null};},
   setSession:async()=>{window.authNotify('SIGNED_IN',confirmed);return {data:{session:confirmed},error:null};}
  };
  window.supabase={createClient:()=>({auth,rpc:async()=>({data:[],error:null})})};
  window.addEventListener('storage',event=>{if(event.key==='km16-test-auth'){window.TEST_SESSION=JSON.parse(event.newValue);for(const listener of listeners)listener(window.TEST_SESSION?'SIGNED_IN':'SIGNED_OUT',window.TEST_SESSION);}});
  const realFetch=window.fetch.bind(window);
  window.fetch=async(input,options)=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(url.origin===location.origin)return realFetch(input,options);
   if(url.pathname!=='/functions/v1/km16-adhesions')throw Error('Unexpected external fetch: '+url.pathname);
   const body=JSON.parse(options?.body||'{}');await window.__record({type:'api',body,authorization:options?.headers?.Authorization||null});
   if(body.action==='catalogue'&&scenario==='slow-catalogue')await new Promise(resolve=>window.finishCatalogue=resolve);
   let data;
   if(body.action==='catalogue')data={products,enabled:true,terms_url:'https://app.km16.fr/conditions-adhesion.html',privacy_url:'https://app.km16.fr/confidentialite.html'};
   else if(body.action==='photo-upload'){
    await window.__record({type:'frozen',value:[...document.querySelectorAll('#order input,#order select')].every(element=>element.disabled)});
    if(scenario==='identity-switch-before-checkout')window.TEST_SESSION={...confirmed,user:{...confirmed.user,id:'other-fixture',email:'other@example.invalid'}};
    data={ok:true};
   }
   else if(body.action==='checkout'){if(window.TEST_CHECKOUT_DELAY)await new Promise(resolve=>setTimeout(resolve,window.TEST_CHECKOUT_DELAY));data={url:'https://checkout.stripe.com/c/pay/simulated-only'};}
   else if(body.action==='orders')data={orders:[],payments:[],documents:[]};
   else throw Error('Unexpected action: '+body.action);
   return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
 },{initial,products,scenario,confirmed});
 const hostPage=await context.newPage();let page=hostPage;
 if(scenario==='camera-embed'){
  await hostPage.goto(origin+'/__camera-host.html');
  const handle=await hostPage.waitForSelector('#payment-console-frame');page=await handle.contentFrame();
 }else await page.goto(origin+'/adhesion.html');
 await page.waitForFunction(()=>document.querySelectorAll('#catalogue button:not([disabled])').length>0);
 await page.locator('#catalogue button:not([disabled])').first().click();
 if(scenario!=='slow-catalogue')await page.waitForFunction(()=>!document.querySelector('#pay').disabled);
 return {context,page,hostPage,events,errors,unexpected};
}
async function cameraReady(page){
 await page.waitForFunction(()=>{
  const dialog=document.querySelector('#member-camera-dialog'),video=document.querySelector('#member-camera-video');
  return dialog.open&&video.readyState>=2&&video.videoWidth>0&&!document.querySelector('#member-camera-capture').disabled;
 });
}
async function openCamera(page){await page.locator('#take-photo').click();await cameraReady(page);}
async function cameraStopped(page){
 await page.waitForFunction(()=>!document.querySelector('#member-camera-dialog').open&&window.TEST_CAMERA.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')),null,{polling:50});
}
async function captureCamera(page){
 await page.locator('#member-camera-capture').click();
 await page.waitForFunction(()=>!document.querySelector('#member-camera-preview').hidden&&!document.querySelector('#member-camera-use').disabled);
 assert.match(await page.locator('#member-camera-preview').getAttribute('src'),/^(?:data:image\/|blob:)/,'snapshot comes from the live video');
 await page.locator('#member-camera-preview').evaluate(image=>image.decode());
 assert.equal(await page.locator('#member-camera-preview').evaluate(image=>image.naturalWidth>0),true,'snapshot decodes as an image');
 await page.waitForFunction(()=>window.TEST_CAMERA.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
}
async function useCameraPhoto(page){
 const previous=await page.locator('#photo-preview').getAttribute('src');
 await page.locator('#member-camera-use').click();
 await page.waitForFunction(previous=>document.querySelector('#photo-status').textContent.includes('Photo prête')&&!document.querySelector('#pay').disabled&&document.querySelector('#photo-preview').getAttribute('src')!==previous,previous);
 await cameraStopped(page);
}
async function cameraError(page){
 await page.waitForFunction(()=>document.querySelector('#member-camera-dialog').open&&!document.querySelector('#member-camera-retry').hidden&&!document.querySelector('#member-camera-retry').disabled&&document.querySelector('#member-camera-status').textContent.length>0);
 assert.equal(await page.locator('#member-camera-capture').isDisabled(),true,'errors cannot capture a blank frame');
 assert.equal(await page.evaluate(()=>window.TEST_CAMERA.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),true,'camera failure releases streams');
}

async function photoFile(page,color='#ccc'){
 const data=await page.evaluate(color=>{const c=document.createElement('canvas');c.width=160;c.height=200;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,160,200);return c.toDataURL('image/png').split(',')[1];},color);
 return {name:'portrait-fictif.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
}
async function addPhoto(page,color='#ccc'){
 await page.locator('#member_photo').setInputFiles(await photoFile(page,color));
 await page.waitForFunction(()=>document.querySelector('#photo-status').textContent.includes('Photo prête'));
}
async function fill(page,{photo=true,minor=false}={}){
 await page.locator('#first_name').fill('Camille');await page.locator('#last_name').fill('Exemple');
 await page.locator('#birth_date-display').fill(minor?'01/01/2010':'01/01/1990');
 if(await page.locator('#contact_email').isEditable())await page.locator('#contact_email').fill('test@example.invalid');
 await page.locator('#phone').fill('0612345678');if(minor)await page.locator('#guardian_name').fill('Parent Exemple');
 for(const id of ['terms','privacy','license'])await page.locator('#'+id).check();
 if(await page.locator('#eligibility-wrap').isVisible())await page.locator('#eligibility').check();
 if(photo)await addPhoto(page);
}
async function notify(page,email=confirmed.user.email){
 await page.evaluate(s=>window.authNotify('SIGNED_IN',s),{...confirmed,user:{...confirmed.user,email}});
 await page.waitForFunction(email=>document.querySelector('#contact_email').value===email&&document.querySelector('#contact_email').readOnly,email);
}
async function submitEmail(page,events){
 await page.locator('#pay').click();await page.waitForFunction(()=>!document.querySelector('#checkout-access').hidden&&!document.querySelector('#pay').disabled);
 assert.equal(otpCalls(events).length,1);const args=otpCalls(events)[0].args;
 assert.equal(args.options.shouldCreateUser,true);assert.equal(args.options.emailRedirectTo,'https://app.km16.fr/');assert.equal(args.email,'test@example.invalid');
 assert.deepEqual(writes(events),[],'no dossier/photo/payment before email verification');
}
async function checkout(page,events){
 await page.evaluate(()=>{window.TEST_CHECKOUT_DELAY=100;document.querySelector('#order').requestSubmit();document.querySelector('#order').requestSubmit();});
 await page.waitForURL('https://checkout.stripe.com/**');const calls=writes(events);
 assert.deepEqual(calls.map(e=>e.body.action),['photo-upload','checkout'],'one checkout despite repeated submission');
 for(const call of calls)assert.equal(call.authorization,'Bearer fixture-only');
 assert.equal(calls[0].body.request_id,calls[1].body.request_id);return calls[1].body;
}

try{
 for(const [engineName,engine] of engines){
  const browser=await engine.launch({headless:true,...(engineName==='Chromium'&&process.env.KM16_CHROMIUM_PATH?{executablePath:process.env.KM16_CHROMIUM_PATH,args:['--no-sandbox']}: {})});
  try{for(const width of [390,1280])for(const scenario of scenarios){
   const {context,page,hostPage,events,errors,unexpected}=await harness(browser,width,scenario);
   try{
    assert.equal(await page.locator('#order').isVisible(),true,'form opens before account creation');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow');
    if(!['session','slow-catalogue','logout','identity-switch-before-checkout'].includes(scenario)){
     assert.equal(await page.locator('#contact_email').isEditable(),true,'guest email editable');
     assert.equal(await page.locator('#login').isVisible(),false,'password is optional');
    }
    if(scenario==='camera'){
     await fill(page,{photo:false});
     assert.equal(await page.locator('#member_camera').getAttribute('accept'),'image/*');
     assert.equal(await page.locator('#member_camera').getAttribute('capture'),'user','native capture remains an explicit fallback');
     assert.equal(await page.locator('#member_photo').getAttribute('capture'),null,'gallery selection remains available');
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.requests.length),0,'camera is never opened before a deliberate click');
     let fileChoosers=0;page.on('filechooser',()=>fileChoosers++);
     await openCamera(page);
     assert.equal(fileChoosers,0,'main camera button opens live video, not a file picker');
     assert.equal(await page.locator('#member-camera-video').evaluate(video=>video.muted&&video.playsInline&&video.srcObject instanceof MediaStream),true,'inline muted live stream');
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.requests[0].audio),false,'microphone is not requested');
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'camera fits mobile width');
     if(process.env.KM16_SCREENSHOTS&&width===390)await page.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-camera-live-${engineName}-${width}.png`)});
     await captureCamera(page);
     assert.equal(await page.locator('#photo-preview').isVisible(),false,'snapshot is not added before confirmation');
     const firstSnapshot=await page.locator('#member-camera-preview').getAttribute('src');
     await page.evaluate(()=>{window.TEST_CAMERA.color='#bb6644';});
     await page.locator('#member-camera-retake').click();await cameraReady(page);
     await captureCamera(page);
     assert.notEqual(await page.locator('#member-camera-preview').getAttribute('src'),firstSnapshot,'retake captures a fresh frame');
     await useCameraPhoto(page);
     const firstPhoto=await page.locator('#photo-preview').getAttribute('src');
     assert.match(firstPhoto,/^data:image\/jpeg;base64,/,'camera follows the same private JPEG conversion');
     assert.equal(await page.locator('#take-photo').textContent(),'Reprendre une photo');
     assert.deepEqual(writes(events),[],'camera preview and capture do not upload the portrait');
     await openCamera(page);await page.locator('#member-camera-close').click();await cameraStopped(page);
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),firstPhoto,'closing camera preserves the accepted photo');
     await openCamera(page);await captureCamera(page);await page.keyboard.press('Escape');await cameraStopped(page);
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),firstPhoto,'discarding a snapshot preserves the accepted photo');
     await openCamera(page);const beforeSwitch=await page.evaluate(()=>window.TEST_CAMERA.streams.length);
     const previousDevice=await page.locator('#member-camera-video').evaluate(video=>video.srcObject.getVideoTracks()[0].getSettings().deviceId);
     await page.locator('#member-camera-switch').click();await cameraReady(page);
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.streams.length),beforeSwitch+1,'camera switch starts a new stream');
     assert.notEqual(await page.locator('#member-camera-video').evaluate(video=>video.srcObject.getVideoTracks()[0].getSettings().deviceId),previousDevice,'camera switch selects a different device');
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.streams.slice(0,-1).every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),true,'camera switch releases the previous stream');
     await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await cameraStopped(page);
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),firstPhoto,'leaving the page does not overwrite the photo');
     await addPhoto(page,'#4488cc');
     const galleryPhoto=await page.locator('#photo-preview').getAttribute('src');
     assert.notEqual(galleryPhoto,firstPhoto,'gallery can replace a camera photo');
     await page.evaluate(()=>{window.TEST_CAMERA.color='#66aa55';});
     await openCamera(page);await captureCamera(page);await useCameraPhoto(page);
     const finalPhoto=await page.locator('#photo-preview').getAttribute('src');
     assert.notEqual(finalPhoto,galleryPhoto,'camera can replace a gallery photo');
     if(process.env.KM16_SCREENSHOTS&&width===390){await page.locator('#take-photo').evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-camera-${engineName}-${width}.png`)});}
     await submitEmail(page,events);await notify(page);await checkout(page,events);
     assert.equal(writes(events)[0].body.photo,finalPhoto,'only the latest confirmed capture is uploaded');
    }else if(scenario==='camera-errors'){
     await fill(page);const previous=await page.locator('#photo-preview').getAttribute('src');
     await page.evaluate(()=>{window.TEST_CAMERA.behavior='NotAllowedError';});
     await page.locator('#take-photo').click();await cameraError(page);
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),previous,'permission refusal preserves the photo');
     for(const error of ['NotFoundError','NotReadableError']){
      await page.evaluate(error=>{window.TEST_CAMERA.behavior=error;},error);
      await page.locator('#member-camera-retry').click();await cameraError(page);
      assert.equal(await page.locator('#photo-preview').getAttribute('src'),previous,'hardware errors preserve the photo');
     }
     await page.evaluate(()=>{window.TEST_CAMERA.behavior='ok';});
     await page.locator('#member-camera-retry').click();await cameraReady(page);
     await page.locator('#member-camera-close').click();await cameraStopped(page);
     await page.evaluate(()=>{window.TEST_CAMERA.behavior='NotAllowedError';});
     await page.locator('#take-photo').click();await cameraError(page);
     const nativeChooser=page.waitForEvent('filechooser');await page.locator('#member-camera-native').click();
     const native=await nativeChooser;assert.equal(await native.element().getAttribute('id'),'member_camera');
     await native.setFiles(await photoFile(page,'#bb5522'));
     await page.waitForFunction(previous=>document.querySelector('#photo-preview').getAttribute('src')!==previous&&document.querySelector('#photo-status').textContent.includes('Photo prête'),previous);
     const nativePhoto=await page.locator('#photo-preview').getAttribute('src');
     await page.locator('#member_photo').setInputFiles({name:'invalide.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
     await page.waitForFunction(()=>!document.querySelector('#pay').disabled&&!document.querySelector('#photo-status').textContent.includes('Préparation'));
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),nativePhoto,'invalid replacement preserves a confirmed photo');
     await page.locator('#take-photo').click();await cameraError(page);
     const galleryChooser=page.waitForEvent('filechooser');await page.locator('#member-camera-file').click();
     const gallery=await galleryChooser;assert.equal(await gallery.element().getAttribute('id'),'member_photo');
     await gallery.setFiles(await photoFile(page,'#114477'));
     await page.waitForFunction(previous=>document.querySelector('#photo-preview').getAttribute('src')!==previous&&document.querySelector('#photo-status').textContent.includes('Photo prête'),nativePhoto);
     assert.deepEqual(writes(events),[],'recovery stays local');
    }else if(scenario==='camera-embed'){
     // ResizeObserver and the shipped embed module handle a genuinely tall form.
     await page.evaluate(()=>{const filler=document.createElement('div');filler.style.height='4000px';document.body.append(filler);});
     await hostPage.waitForFunction(()=>document.getElementById('payment-console-frame').getBoundingClientRect().height>4000);
     for(const hiding of ['class','hidden']){
      await page.locator('#take-photo').scrollIntoViewIfNeeded();await openCamera(page);
      for(const id of ['member-camera-dialog','member-camera-close','member-camera-capture']){
       const bounds=await page.locator('#'+id).boundingBox();assert.ok(bounds,`${id} is visible in the iframe`);
       assert.ok(bounds.y>=-1&&bounds.y+bounds.height<=845,`${id} stays inside the parent viewport: ${JSON.stringify(bounds)}`);
       assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,`${id} stays inside the parent width`);
      }
      if(process.env.KM16_SCREENSHOTS&&hiding==='class')await hostPage.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-camera-embed-${engineName}-${width}.png`)});
      await hostPage.evaluate(hiding=>{const section=document.getElementById('tarifs');if(hiding==='hidden')section.hidden=true;else section.classList.remove('active');},hiding);
      await cameraStopped(page);
      await hostPage.evaluate(()=>{const section=document.getElementById('tarifs');section.hidden=false;section.classList.add('active');});
     }
     assert.deepEqual(writes(events),[]);
    }else if(scenario==='camera-cancel-pending'){
     await fill(page);const previous=await page.locator('#photo-preview').getAttribute('src');
     await page.evaluate(()=>{window.TEST_CAMERA.behavior='pending';});
     await page.locator('#take-photo').click();await page.waitForFunction(()=>window.TEST_CAMERA.pending.length===1);
     assert.equal(await page.locator('#member-camera-capture').isDisabled(),true,'capture waits for a real video frame');
     await page.locator('#member-camera-close').click();
     await page.evaluate(()=>window.TEST_CAMERA.pending[0].resolve());await cameraStopped(page);
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),previous,'late permission answer cannot alter the accepted photo');
     await page.locator('#take-photo').click();await page.waitForFunction(()=>window.TEST_CAMERA.pending.length===2);
     await page.keyboard.press('Escape');
     await page.locator('#take-photo').click();await page.waitForFunction(()=>window.TEST_CAMERA.pending.length===3);
     await page.evaluate(()=>window.TEST_CAMERA.pending[2].resolve());await cameraReady(page);
     await page.evaluate(()=>window.TEST_CAMERA.pending[1].resolve());
     await page.waitForFunction(()=>window.TEST_CAMERA.streams.filter(stream=>stream.getTracks().some(track=>track.readyState==='live')).length===1);
     assert.equal(await page.locator('#member-camera-video').evaluate(video=>video.srcObject===window.TEST_CAMERA.streams[1]),true,'stale permission promise cannot replace a newer camera session');
     await page.locator('#member-camera-close').click();await cameraStopped(page);
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),previous);
     assert.deepEqual(writes(events),[]);
    }else if(scenario==='identity-switch-before-checkout'){
     await fill(page);await page.locator('#pay').click();
     await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('connexion a changé')&&!document.querySelector('#pay').disabled);
     assert.deepEqual(writes(events).map(e=>e.body.action),['photo-upload'],'changed session cannot create checkout');
     assert.equal(events.find(e=>e.type==='frozen')?.value,true,'form controls frozen during submission');
     assert.equal(await page.locator('#first_name').isEnabled(),true,'form controls restored after failure');
    }else if(scenario==='guest'){
     await page.locator('#pay').click();assert.equal(otpCalls(events).length,0,'empty form cannot create account');
     await fill(page,{photo:false});await page.locator('#pay').click();assert.equal(otpCalls(events).length,0,'photo required');
     await addPhoto(page);await page.locator('#terms').uncheck();await page.locator('#pay').click();assert.equal(otpCalls(events).length,0,'consent required');
     await page.locator('#terms').check();
     if(process.env.KM16_SCREENSHOTS&&width===390){await page.locator('#contact_email').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-guest-${engineName}-${width}.png`)});}
     await submitEmail(page,events);
     if(process.env.KM16_SCREENSHOTS&&width===1280){await page.locator('#checkout-access').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-verification-${engineName}-${width}.png`)});}
     await page.locator('#pay').click();assert.equal(otpCalls(events).length,1,'waiting does not resend email');
     await notify(page);assert.equal(await page.locator('#first_name').inputValue(),'Camille');assert.equal(await page.locator('#photo-preview').isVisible(),true);
     assert.deepEqual(writes(events),[],'verification does not submit automatically');await checkout(page,events);
    }else if(scenario==='session'){
     assert.equal(await page.locator('#contact_email').inputValue(),confirmed.user.email);assert.equal(await page.locator('#contact_email').isEditable(),false);
     await fill(page);await checkout(page,events);assert.equal(otpCalls(events).length,0);
    }else if(['anonymous','unconfirmed'].includes(scenario)){
     await fill(page);await submitEmail(page,events);
    }else if(scenario==='slow-catalogue'){
     assert.equal(await page.locator('#contact_email').inputValue(),confirmed.user.email);
     await fill(page);await page.evaluate(()=>window.finishCatalogue());await page.waitForFunction(()=>!document.querySelector('#pay').disabled);
     assert.equal(await page.locator('#first_name').inputValue(),'Camille');assert.equal(await page.locator('#photo-preview').isVisible(),true);
    }else if(scenario==='guest-refresh'){
     await fill(page);await page.evaluate(()=>{window.authNotify('INITIAL_SESSION',null);window.dispatchEvent(new Event('pageshow'));});await page.waitForTimeout(50);
     assert.equal(await page.locator('#contact_email').inputValue(),confirmed.user.email);assert.equal(await page.locator('#first_name').inputValue(),'Camille');assert.equal(await page.locator('#photo-preview').isVisible(),true);assert.equal(otpCalls(events).length,0);
    }else if(['network-error','network-reload','rate-limit'].includes(scenario)){
     await fill(page);await page.locator('#pay').click();await page.waitForFunction(()=>!document.querySelector('#pay').disabled);
     assert.equal(otpCalls(events).length,1);assert.deepEqual(writes(events),[]);assert.equal(await page.locator('#first_name').inputValue(),'Camille');assert.equal(await page.locator('#contact_email').inputValue(),confirmed.user.email);assert.equal(await page.locator('#photo-preview').isVisible(),true);
     if(scenario==='network-reload'){
      await page.evaluate(()=>localStorage.setItem('km16-test-otp-ok','1'));await page.reload();
      await page.waitForFunction(()=>document.querySelector('#first_name').value==='Camille'&&!document.querySelector('#pay').disabled);
      assert.equal(await page.locator('#photo-preview').isVisible(),true);
      await page.locator('#pay').click();await page.waitForFunction(()=>!document.querySelector('#checkout-access').hidden&&!document.querySelector('#pay').disabled);
      assert.equal(otpCalls(events).length,2,'failed send can retry after restoring draft');
     }else if(scenario==='network-error'){await page.evaluate(()=>{window.TEST_OTP_BEHAVIOR='ok';});await page.locator('#pay').click();await page.waitForFunction(()=>!document.querySelector('#checkout-access').hidden&&!document.querySelector('#pay').disabled);assert.equal(otpCalls(events).length,2);}
    }else if(scenario==='wrong-identity'){
     await fill(page);await submitEmail(page,events);await notify(page,'other@example.invalid');assert.deepEqual(writes(events),[]);
     assert.equal(await page.locator('#first_name').inputValue(),'','different account clears personal data');assert.equal(await page.locator('#photo-preview').isVisible(),false);
    }else if(scenario==='draft-new-tab'){
     await fill(page);await page.locator('#count').selectOption('3');await page.locator('#installments').check();await submitEmail(page,events);
     const photo=await page.locator('#photo-preview').getAttribute('src');await page.evaluate(s=>localStorage.setItem('km16-test-auth',JSON.stringify(s)),confirmed);
     const next=await context.newPage();await next.goto(origin+'/adhesion.html');await next.waitForFunction(()=>document.querySelector('#first_name').value==='Camille'&&!document.querySelector('#order').hidden);
     assert.equal(await next.locator('#last_name').inputValue(),'Exemple');assert.equal(await next.locator('#birth_date-display').inputValue(),'01/01/1990');assert.equal(await next.locator('#count').inputValue(),'3');
     assert.equal(await next.locator('#photo-preview').getAttribute('src'),photo);assert.equal(await next.locator('#terms').isChecked(),true);assert.equal(await next.locator('#installments').isChecked(),true);assert.equal(await next.locator('#contact_email').inputValue(),confirmed.user.email);assert.deepEqual(writes(events),[]);
     assert.equal((await checkout(next,events)).count,3);
    }else if(scenario==='logout'){
     await fill(page);await page.locator('#logout').click();await page.waitForFunction(()=>!document.querySelector('#contact_email').readOnly);
     assert.equal(await page.locator('#first_name').inputValue(),'');assert.equal(await page.locator('#contact_email').inputValue(),'');assert.equal(await page.locator('#photo-preview').isVisible(),false);assert.deepEqual(writes(events),[]);
    }else if(scenario==='minor'){
     await fill(page,{minor:true});await page.locator('#guardian_name').fill('');await page.locator('#pay').click();assert.equal(otpCalls(events).length,0,'minor requires guardian');
     await page.locator('#guardian_name').fill('Parent Exemple');await submitEmail(page,events);await notify(page);const body=await checkout(page,events);assert.equal(body.guardian_name,'Parent Exemple');assert.equal(body.first_name,'Camille');
    }
    assert.deepEqual(errors,[],'no browser JS errors');assert.deepEqual(unexpected,[],'no unexpected external traffic');assert.equal(events.some(e=>e.type==='password'),false,'checkout never requires a password');
    console.log(`PASS ${engineName} ${width}px ${scenario}`);count++;
   }finally{await context.close();}
  }}finally{await browser.close();}
 }
 console.log(`PASS: ${count} real-module journeys; Auth/API simulated, external traffic blocked.`);
}finally{await new Promise(resolve=>server.close(resolve));}
