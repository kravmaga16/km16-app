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
  res.end(`<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px system-ui}.panel:not(.active),[hidden]{display:none!important}main{max-width:1200px;margin:auto;padding:12px}#payment-console-frame{min-height:5000px}header{height:140px;background:#222;color:#fff;padding:12px;box-sizing:border-box}</style></head><body><header>Page d’accueil KM16 — simulation locale</header><main><section id="tarifs" class="panel active"><div id="payment-console"><h2>Votre inscription</h2><p id="payment-console-status"></p><p id="payment-legacy" hidden></p><div id="payment-console-host"></div></div></section></main><script type="module" src="/payment-console.mjs"></script></body></html>`);return;
 }

 const path=resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!path.startsWith(root+sep)||!(await stat(path)).isFile())throw Error('Invalid path');
 res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(path));
}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const engines=process.env.KM16_CHROMIUM_ONLY?[['Chromium',chromium]]:[['Chromium',chromium],['WebKit',webkit]];
const allScenarios=['guest','session','anonymous','unconfirmed','slow-catalogue','guest-refresh','network-error','network-reload','rate-limit','wrong-identity','draft-new-tab','confirmation-no-draft','confirmation-legacy','confirmation-expired','logout','minor','identity-switch-before-checkout','reminder-free','camera','camera-errors','camera-cancel-pending','camera-embed','camera-desktop-devices','camera-device-recovery','camera-framing','camera-member-order'];
const scenarios=process.env.KM16_ADMIN_ONLY?[]:process.env.KM16_CAMERA_ONLY?allScenarios.filter(name=>name.startsWith('camera')):allScenarios;
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
  if(url.origin===origin){
   if(scenario==='catalogue-local-error'&&url.pathname==='/catalogue.json')return route.fulfill({status:503});
   return route.continue();
  }
  if(url.hostname==='script.google.com'&&url.pathname.startsWith('/macros/s/'))return route.fulfill({status:200,contentType:'text/javascript',body:'/* Agenda fixture. */'});
  if(url.hostname==='km16.fr'||url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com')return route.fulfill({status:204});
  if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('supabase'))return route.fulfill({status:200,contentType:'text/javascript',body:'/* Auth test double already installed. */'});
  if(url.hostname==='checkout.stripe.com')return route.fulfill({status:200,contentType:'text/html',body:'<h1>Payment simulation only</h1>'});
  unexpected.push(url.origin+url.pathname);return route.abort();
 });
 const initial=['session','slow-catalogue','logout','identity-switch-before-checkout','camera-member-order'].includes(scenario)?confirmed:scenario==='anonymous'?{user:{id:'anon-fixture',is_anonymous:true},access_token:'anonymous-fixture'}:scenario==='unconfirmed'?{user:{id:'unconfirmed-fixture',email:'test@example.invalid',is_anonymous:false,email_confirmed_at:null},access_token:'unconfirmed-fixture'}:null;
 await context.addInitScript(({initial,products,scenario,confirmed})=>{
  if(!['127.0.0.1','localhost'].includes(location.hostname))return;
  const saved=localStorage.getItem('km16-test-auth');
  window.TEST_SESSION=saved?JSON.parse(saved):initial;
  window.TEST_OTP_BEHAVIOR=['network-error','network-reload'].includes(scenario)&&!localStorage.getItem('km16-test-otp-ok')?'network':scenario==='rate-limit'?'rate-limit':'ok';
  window.TEST_CHECKOUT_DELAY=0;
  // A real synthetic video stream exercises video.play(), canvas capture and JPEG
  // conversion, without requesting a device or granting camera permissions.
  const desktopCameras=['camera-desktop-devices','camera-device-recovery'].includes(scenario);
  const camera=window.TEST_CAMERA={
   behavior:'ok',color:'#4466aa',requests:[],streams:[],pending:[],playPending:[],enumerations:0,
   defaultDeviceId:desktopCameras?'fixture-iphone':'fixture-front',
   labelsRequirePermission:scenario==='camera-desktop-devices',permissionGranted:false,
   deviceBehaviors:{},blockedVideoDevices:[],pattern:scenario==='camera-framing'?'quadrants':'portrait',
   devices:desktopCameras?[
    {kind:'videoinput',deviceId:'fixture-iphone',label:'iPhone de test (Caméra Continuité)'},
    {kind:'videoinput',deviceId:'fixture-facetime',label:'FaceTime HD Camera (Built-in)'},
    {kind:'videoinput',deviceId:'fixture-usb',label:'Webcam USB de test'}
   ]:[{kind:'videoinput',deviceId:'fixture-front',label:'Caméra avant fictive'},{kind:'videoinput',deviceId:'fixture-rear',label:'Caméra arrière fictive'}]
  };
  function cameraStream(constraints){
   const canvas=document.createElement('canvas');canvas.width=camera.pattern==='quadrants'?640:320;canvas.height=camera.pattern==='quadrants'?480:400;
   const paint=()=>{
    const ctx=canvas.getContext('2d');
    if(camera.pattern==='quadrants'){
     for(const [color,x,y] of [['#dc1e1e',0,0],['#14c81e',320,0],['#1432dc',0,240],['#e1c814',320,240]]){ctx.fillStyle=color;ctx.fillRect(x,y,320,240);}
    }else{ctx.fillStyle=camera.color;ctx.fillRect(0,0,320,400);ctx.fillStyle='#fff';ctx.fillRect(80,100,160,200);}
   };
   paint();const stream=canvas.captureStream(12),timer=setInterval(paint,80);
   const deviceId=constraints.video?.deviceId?.exact||camera.defaultDeviceId;
   const facingMode=deviceId==='fixture-rear'?'environment':'user';
   for(const track of stream.getTracks()){
    const stop=track.stop.bind(track),settings=track.getSettings.bind(track);
    track.stop=()=>{clearInterval(timer);stop();};
    track.getSettings=()=>({...settings(),deviceId,facingMode});
    Object.defineProperty(track,'label',{configurable:true,value:camera.devices.find(device=>device.deviceId===deviceId)?.label||'Caméra de test'});
   }
   camera.permissionGranted=true;camera.streams.push(stream);return stream;
  }
  const realVideoPlay=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){
   const deviceId=this.srcObject?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
   if(this.id==='member-camera-video'&&camera.blockedVideoDevices.includes(deviceId))return new Promise(resolve=>camera.playPending.push({deviceId,resolve}));
   return realVideoPlay.call(this);
  };
  const deviceEvents=new EventTarget();
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
   getUserMedia:async constraints=>{
    camera.requests.push(constraints);
    const deviceId=constraints.video?.deviceId?.exact||camera.defaultDeviceId,behavior=camera.deviceBehaviors[deviceId]||camera.behavior;
    if(behavior==='pending')return new Promise((resolve,reject)=>camera.pending.push({deviceId,resolve:()=>resolve(cameraStream(constraints)),reject}));
    if(behavior!=='ok')throw new DOMException('Synthetic camera failure',behavior);
    return cameraStream(constraints);
   },
   enumerateDevices:async()=>{camera.enumerations++;return camera.devices.map(device=>({...device,label:camera.labelsRequirePermission&&!camera.permissionGranted?'':device.label}));},
   getSupportedConstraints:()=>({facingMode:true,width:true,height:true,deviceId:true}),
   addEventListener:deviceEvents.addEventListener.bind(deviceEvents),
   removeEventListener:deviceEvents.removeEventListener.bind(deviceEvents)
  }});

  const listeners=[];
  window.authNotify=(event,next)=>{
   window.TEST_SESSION=next;localStorage.setItem('km16-test-auth',JSON.stringify(next));localStorage.setItem('km16-video-auth',JSON.stringify(next));
   for(const listener of listeners)listener(event,next);
  };
  const auth={
   mfa:{
    getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:window.TEST_SESSION?.access_token==='admin-aal2'?'aal2':'aal1'},error:null}),
    listFactors:async()=>({data:{totp:[{id:'fixture-totp'}]},error:null}),
    challengeAndVerify:async()=>{window.authNotify('MFA_CHALLENGE_VERIFIED',{...confirmed,access_token:'admin-aal2'});return {data:{},error:null};}
   },
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
  window.supabase={createClient:()=>({auth,rpc:async(name,args)=>{
   if(scenario==='prorata-admin'){
    await window.__record({type:'rpc',name,args});
    if(name==='km16_admin_membership_counts')return new Promise(resolve=>{window.releaseMembershipCounts=()=>resolve({data:[{total:1,pending:1,approved:0,rejected:0}],error:null});});
    if(name==='km16_admin_followup_summaries')return new Promise(resolve=>{window.releaseFollowupSummaries=()=>resolve({data:[],error:null});});
    if(name==='km16_admin_followup_history')return {data:[{recorded_at:'2026-11-18T12:00:00Z'}],error:null};
   }
   return {data:[],error:null};
  }})};
  window.addEventListener('storage',event=>{if(event.key==='km16-test-auth'){window.TEST_SESSION=JSON.parse(event.newValue);for(const listener of listeners)listener(window.TEST_SESSION?'SIGNED_IN':'SIGNED_OUT',window.TEST_SESSION);}});
  const realFetch=window.fetch.bind(window);
  window.fetch=async(input,options)=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(url.origin===location.origin)return realFetch(input,options);
   if(url.pathname!=='/functions/v1/km16-adhesions')throw Error('Unexpected external fetch: '+url.pathname);
   const body=JSON.parse(options?.body||'{}');await window.__record({type:'api',body,authorization:options?.headers?.Authorization||null});
   if(body.action==='catalogue'&&scenario==='catalogue-api-error')return new Response('{}',{status:503});
   if(body.action==='catalogue'&&scenario==='slow-catalogue')await new Promise(resolve=>window.finishCatalogue=resolve);
   let data;
   if(body.action==='catalogue')data={products,enabled:true,terms_url:'https://app.km16.fr/conditions-adhesion.html',privacy_url:'https://app.km16.fr/confidentialite.html'};
   else if(body.action==='photo-upload'){
    await window.__record({type:'frozen',value:[...document.querySelectorAll('#order input,#order select')].every(element=>element.disabled)});
    if(scenario==='identity-switch-before-checkout')window.TEST_SESSION={...confirmed,user:{...confirmed.user,id:'other-fixture',email:'other@example.invalid'}};
    data={ok:true};
   }
   else if(body.action==='checkout'){if(window.TEST_CHECKOUT_DELAY)await new Promise(resolve=>setTimeout(resolve,window.TEST_CHECKOUT_DELAY));data=scenario==='reminder-free'?{free:true}:{url:'https://checkout.stripe.com/c/pay/simulated-only'};}
   else if(body.action==='orders'){
    data={orders:[],payments:[],documents:[]};
    if(scenario==='camera-member-order'){
     data.orders.push({id:'fixture-order',title:'Adhésion de test',product_id:'adultes',total_cents:10000,livemode:true,approval:'approved',count:1});
     data.payments.push({order_id:'fixture-order',amount_cents:10000,status:'paid'});
     data.photo_order_ids=window.TEST_MEMBER_PHOTO?['fixture-order']:[];
    }
   }
   else if(scenario==='camera-member-order'&&body.action==='member-photo-add'){window.TEST_MEMBER_PHOTO=body.photo;data={ok:true};}
   else if(scenario==='prorata-admin'&&body.action==='admin-access')data={admin:true};
   else if(scenario==='prorata-admin'&&body.action==='admin-page')data={orders:[{id:'fixture-admin-order',first_name:'Camille',last_name:'Dossier',title:'Adhésion fictive',total_cents:25000,count:1,livemode:true,approval:'pending'}],payments:[],documents:[],mails:[]};
   else if(scenario==='prorata-admin'&&body.action==='links-list')data={links:[]};
   else if(scenario==='prorata-admin'&&body.action==='links-create')data={url:location.origin+'/adhesion.html#offre='+'a'.repeat(64),expires_at:'2027-12-01T00:00:00Z',livemode:false};
   else throw Error('Unexpected action: '+body.action);
   return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
 },{initial,products,scenario,confirmed});
 const hostPage=await context.newPage();let page=hostPage;
 if(scenario==='prorata-admin'){
  await hostPage.goto(origin+'/adhesion-admin.html?vue=prorata');
  return {context,page,events,errors,unexpected};
 }
 if(scenario==='catalogue-local-error'||scenario==='catalogue-api-error'){
  const query=scenario==='catalogue-local-error'?'?produit=cours-deux-heures':'?produit=stage-1';
  await page.goto(origin+'/adhesion.html'+query);
  return {context,page,events,errors,unexpected};
 }
 if(scenario==='camera-member-order'){
  await hostPage.goto(origin+'/adhesion.html?espace=1');
  return {context,page,hostPage,events,errors,unexpected};
 }
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
async function cameraDevice(page,deviceId){
 await cameraReady(page);
 await page.waitForFunction(deviceId=>document.querySelector('#member-camera-video').srcObject?.getVideoTracks()[0]?.getSettings().deviceId===deviceId,deviceId);
 assert.equal(await page.locator('#member-camera-device').inputValue(),deviceId,'selector names the camera actually displayed');
}
async function cameraZoom(page,value){
 const input=page.locator('#member-camera-zoom');
 assert.equal(await input.isEnabled(),true,'framing controls remain usable');
 await input.evaluate((element,value)=>{element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));},value);
 assert.equal(Number(await input.inputValue()),value);
}
async function dragCameraImage(page,from,to){
 const stage=page.locator('#member-camera-stage');await stage.scrollIntoViewIfNeeded();
 const bounds=await stage.boundingBox();assert.ok(bounds&&bounds.width>100&&bounds.height>100,'portrait frame has usable dimensions');
 await page.mouse.move(bounds.x+bounds.width*from[0],bounds.y+bounds.height*from[1]);
 await page.mouse.down();
 await page.mouse.move(bounds.x+bounds.width*to[0],bounds.y+bounds.height*to[1],{steps:8});
 await page.mouse.up();
}
async function imageSamples(page,src){
 return page.evaluate(async src=>{
  const image=new Image();image.src=src;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  return {width:canvas.width,height:canvas.height,pixels:[[.2,.2],[.8,.2],[.2,.8],[.8,.8]].map(([x,y])=>Array.from(ctx.getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height*y),1,1).data))};
 },src);
}
async function stageSamples(page){
 const screenshot=await page.locator('#member-camera-stage').screenshot();
 return imageSamples(page,'data:image/png;base64,'+screenshot.toString('base64'));
}
function assertFramingColor(sample,color,message){
 const channel=color==='green'?1:2;
 for(const pixel of sample.pixels)assert.ok(pixel[channel]>Math.max(...pixel.slice(0,3).filter((_,index)=>index!==channel))+45,`${message}: ${JSON.stringify(pixel)}`);
}

async function photoFile(page,color='#ccc'){
 const data=await page.evaluate(color=>{const c=document.createElement('canvas');c.width=160;c.height=200;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,160,200);return c.toDataURL('image/png').split(',')[1];},color);
 return {name:'portrait-fictif.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
}
async function addPhoto(page,color='#ccc'){
 await page.locator('#member_photo').setInputFiles(await photoFile(page,color));
 await page.locator('#member-camera-use').click();
 await page.waitForFunction(()=>!document.querySelector('#member-camera-dialog').open&&document.querySelector('#photo-status').textContent.includes('Photo prête'));
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
 assert.equal(args.options.shouldCreateUser,true);const redirect=new URL(args.options.emailRedirectTo);
 assert.equal(redirect.origin+redirect.pathname,'https://app.km16.fr/');assert.equal(redirect.searchParams.get('confirmation'),'adhesion');
 assert.match(redirect.searchParams.get('produit')||'',/^[a-z0-9-]+$/);assert.equal(args.email,'test@example.invalid');
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
  try{
   if(!process.env.KM16_CAMERA_ONLY){
    for(const scenario of ['catalogue-local-error','catalogue-api-error']){
     const {context,page,errors,unexpected}=await harness(browser,390,scenario);
     try{
      if(scenario==='catalogue-local-error'){
       await page.locator('#order').waitFor({state:'visible'});
       assert.equal(await page.locator('#chosen').textContent(),products.find(product=>product.id==='cours-deux-heures').title);
       assert.equal(await page.locator('#pay').isEnabled(),true);
       assert.match(await page.locator('#checkout-summary').textContent(),/40,00\s*€/);
      }else{
       await page.getByText('Les informations de ce stage sont temporairement indisponibles.').waitFor();
       assert.equal(await page.locator('#pay').isEnabled(),false);
      }
      assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
      console.log(`PASS ${engineName} ${scenario}`);
     }finally{await context.close();}
    }
    const {context,page,events,errors,unexpected}=await harness(browser,390,'prorata-admin');
    try{
     assert.equal(await page.locator('#link-form').isVisible(),false,'form stays hidden when signed out');
     await page.locator('#account-email').fill('test@example.invalid');
     await page.locator('#account-email-submit').click();
     await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('consultez votre boîte'));
     const args=otpCalls(events)[0].args;
     assert.equal(args.options.shouldCreateUser,false);
     const redirect=new URL(args.options.emailRedirectTo);
     assert.equal(redirect.searchParams.get('confirmation'),'admin-prorata');
     await page.goto(origin+redirect.search+'#access_token=fixture&refresh_token=fixture&type=magiclink');
     await page.waitForURL('**/adhesion-admin.html?vue=prorata');
     const code=page.locator('#adhesion-admin-mfa input[name="code"]');
     await code.waitFor({state:'visible'});
     assert.equal(await page.locator('#link-form').isVisible(),false,'MFA is required before the form appears');
     assert.equal(events.some(e=>e.body?.action==='links-list'),false,'private links are never requested before MFA');
     await code.fill('123456');
     await page.getByRole('button',{name:'Vérifier le code'}).click();
     await page.locator('#link-form').waitFor({state:'visible'});
     assert.equal(await page.locator('#admin > :nth-child(2)').getAttribute('id'),'payment-links');
     await page.waitForFunction(()=>document.querySelector('#link-product').value!=='');
     assert.equal(events.some(e=>['admin-page','links-list'].includes(e.body?.action)),false,'direct access needs neither dossiers nor link history');
     await page.locator('#links-refresh').click();
     await page.locator('#links-list table').waitFor({state:'visible'});
     assert.equal(events.filter(e=>e.body?.action==='links-list').length,1,'history stays available on demand');
     await page.locator('#link-amount').fill('250,00');
     await page.locator('#link-email').fill('payer@example.invalid');
     await page.locator('#link-create').click();
     await page.locator('#link-result').waitFor({state:'visible'});
     const write=events.find(e=>e.body?.action==='links-create');
     assert.equal(write.authorization,'Bearer admin-aal2');
     assert.equal(write.body.total_cents,25000);
     assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
     console.log(`PASS ${engineName} prorata admin: email return, MFA and simulated link creation`);
     await page.goto(origin+'/adhesion-admin.html');
     const dossier=page.locator('#admin-order-fixture-admin-order');
     await dossier.waitFor({state:'attached'});
     await page.waitForFunction(()=>window.releaseMembershipCounts&&window.releaseFollowupSummaries);
     assert.equal(events.some(e=>e.type==='rpc'&&e.name==='km16_admin_followup_history'),false);
     assert.equal(await dossier.getByRole('button',{name:'Valider le dossier'}).isVisible(),false,'mobile summary leaves the decision in the dossier');
     await dossier.getByRole('button',{name:'Ouvrir le dossier de Camille Dossier'}).click();
     assert.equal(await dossier.getByRole('button',{name:'Valider le dossier'}).isVisible(),true);
     assert.equal(await dossier.getByRole('button',{name:'Valider le dossier'}).isEnabled(),true);
     await dossier.getByText('Envoi confirmé manuellement').waitFor();
     const historyReads=events.filter(e=>e.type==='rpc'&&['km16_admin_followup_history','km16_admin_followup_delivery_history'].includes(e.name));
     assert.equal(historyReads.length,2);
     for(const read of historyReads)assert.deepEqual(read.args.p_order_ids,['fixture-admin-order']);
     await page.evaluate(()=>{window.releaseMembershipCounts();window.releaseFollowupSummaries();});
     await page.locator('#km16-followup-list tr[data-order-id]').waitFor({state:'attached'});
     assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
     console.log(`PASS ${engineName} admin dossiers: table before counts and summaries, history on demand`);
    }finally{await context.close();}
   }
   for(const width of [390,1280])for(const scenario of scenarios){
   const {context,page,hostPage,events,errors,unexpected}=await harness(browser,width,scenario);
   try{
    if(scenario!=='camera-member-order'){
     assert.equal(await page.locator('#order').isVisible(),true,'form opens before account creation');
     assert.equal(await page.locator('#guardian').isVisible(),false,'guardian stays hidden until a minor’s date is entered');
     assert.equal(await page.locator('#checkout-reminder').isChecked(),false,'payment reminders are opt-in only');
     assert.equal(await page.locator('#checkout-reminder').getAttribute('required'),null,'reminder consent is independent of required terms');
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow');
     if(!['session','slow-catalogue','logout','identity-switch-before-checkout'].includes(scenario)){
      assert.equal(await page.locator('#contact_email').isEditable(),true,'guest email editable');
      assert.equal(await page.locator('#login').isVisible(),false,'password is optional');
     }
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
     const maximumZoom=Number(await page.locator('#member-camera-zoom').getAttribute('max'));
     await cameraZoom(page,maximumZoom);
     await useCameraPhoto(page);
     const firstPhoto=await page.locator('#photo-preview').getAttribute('src');
     assert.match(firstPhoto,/^data:image\/jpeg;base64,/,'camera follows the same private JPEG conversion');
     const maximumZoomPhoto=await imageSamples(page,firstPhoto);
     assert.ok(maximumZoomPhoto.width>=100&&maximumZoomPhoto.height>=100,'maximum zoom still produces a portrait accepted by the upload preparation');
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
    }else if(scenario==='camera-desktop-devices'){
     await fill(page,{photo:false});
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.enumerations),0,'no camera enumeration before the photo action');
     await openCamera(page);await cameraDevice(page,'fixture-facetime');
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.requests[0].video.deviceId?.exact||window.TEST_CAMERA.defaultDeviceId),'fixture-iphone','masked labels initially use the exposed browser default');
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.requests.at(-1).video.deviceId?.exact),'fixture-facetime','revealed built-in webcam is selected precisely');
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.streams.slice(0,-1).every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),true,'automatic preference releases the default iPhone stream');
     const labels=await page.locator('#member-camera-device option').allTextContents();
     assert.ok(labels.some(label=>label.includes('FaceTime'))&&labels.some(label=>label.includes('iPhone'))&&labels.some(label=>label.includes('USB')),'available cameras are named');
     assert.equal(await page.locator('#member-camera-device').evaluate(element=>Boolean(element.getAttribute('aria-label')||element.labels?.length)),true,'camera selector has an accessible label');
     await page.locator('#member-camera-device').selectOption('fixture-iphone');await cameraDevice(page,'fixture-iphone');
     await captureCamera(page);
     await page.locator('#member-camera-retake').click();await cameraDevice(page,'fixture-iphone');
     await page.locator('#member-camera-close').click();await cameraStopped(page);
     const beforeReopen=await page.evaluate(()=>window.TEST_CAMERA.requests.length);
     await openCamera(page);await cameraDevice(page,'fixture-iphone');
     assert.equal(await page.evaluate(index=>window.TEST_CAMERA.requests[index].video.deviceId?.exact,beforeReopen),'fixture-iphone','an explicit camera choice survives reopening');
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.requests.every(request=>request.audio===false)),true,'camera selection never opens the microphone');
     await page.locator('#member-camera-close').click();await cameraStopped(page);
     assert.equal(await page.locator('#photo-preview').isVisible(),false,'unconfirmed camera images are not added to the form');
     assert.deepEqual(writes(events),[]);
    }else if(scenario==='camera-device-recovery'){
     await fill(page);const previousPhoto=await page.locator('#photo-preview').getAttribute('src');
     await openCamera(page);await cameraDevice(page,'fixture-facetime');
     assert.equal(await page.evaluate(()=>window.TEST_CAMERA.requests[0].video.deviceId?.exact),'fixture-facetime','known integrated camera is preferred before opening the default iPhone');
     await page.evaluate(()=>{window.TEST_CAMERA.blockedVideoDevices=['fixture-iphone'];});
     await page.locator('#member-camera-device').selectOption('fixture-iphone');
     await page.waitForFunction(()=>window.TEST_CAMERA.playPending.length===1);
     assert.equal(await page.locator('#member-camera-capture').isDisabled(),true,'an iPhone without a video frame cannot take an empty picture');
     assert.equal(await page.locator('#member-camera-device').isEnabled(),true,'camera selection is available before video.play resolves');
     await page.locator('#member-camera-device').selectOption('fixture-facetime');await cameraDevice(page,'fixture-facetime');
     await page.evaluate(()=>window.TEST_CAMERA.playPending[0].resolve());
     await page.waitForFunction(()=>window.TEST_CAMERA.streams.filter(stream=>stream.getTracks().some(track=>track.readyState==='live')).length===1);
     await cameraDevice(page,'fixture-facetime');
     await page.evaluate(()=>{window.TEST_CAMERA.blockedVideoDevices=[];window.TEST_CAMERA.deviceBehaviors['fixture-iphone']='pending';});
     await page.locator('#member-camera-device').selectOption('fixture-iphone');
     await page.waitForFunction(()=>window.TEST_CAMERA.pending.length===1);
     assert.equal(await page.locator('#member-camera-device').isEnabled(),true,'camera selection remains available while getUserMedia is pending');
     await page.locator('#member-camera-device').selectOption('fixture-usb');await cameraDevice(page,'fixture-usb');
     await page.evaluate(()=>window.TEST_CAMERA.pending[0].resolve());
     await page.waitForFunction(()=>window.TEST_CAMERA.streams.at(-1).getTracks().every(track=>track.readyState==='ended'));
     await cameraDevice(page,'fixture-usb');
     await page.evaluate(()=>{window.TEST_CAMERA.blockedVideoDevices=[];window.TEST_CAMERA.deviceBehaviors['fixture-iphone']='NotReadableError';});
     await page.locator('#member-camera-device').selectOption('fixture-iphone');await cameraError(page);
     assert.equal(await page.locator('#member-camera-device').isEnabled(),true,'an unavailable camera does not remove the selector');
     await page.locator('#member-camera-device').selectOption('fixture-facetime');await cameraDevice(page,'fixture-facetime');
     await page.locator('#member-camera-close').click();await cameraStopped(page);
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),previousPhoto,'camera failures do not discard an accepted portrait');
     assert.deepEqual(writes(events),[]);
    }else if(scenario==='camera-member-order'){
     await page.locator('#member-order-fixture-order-photo summary').click();
     const save=page.getByRole('button',{name:'Enregistrer la photo',exact:true});
     assert.equal(await save.isDisabled(),true);
     await page.locator('#member-order-fixture-order-photo input').setInputFiles(await photoFile(page));
     await page.locator('#member-camera-use').click();
     assert.equal(events.some(event=>event.body?.action==='member-photo-add'),false);
     await save.click();
     await page.getByRole('button',{name:'Voir la photo du dossier'}).waitFor();
     const upload=events.find(event=>event.body?.action==='member-photo-add');
     assert.equal(upload.body.request_id,'fixture-order');
     assert.match(upload.body.photo,/^data:image\/jpeg;base64,/);
    }else if(scenario==='camera-framing'){
     await fill(page,{photo:false});await openCamera(page);
     const stage=page.locator('#member-camera-stage');
     let bounds=await stage.boundingBox();assert.ok(Math.abs(bounds.width/bounds.height-.75)<.015,'the visible frame has the exported portrait ratio');
     await cameraZoom(page,2);await stage.focus();
     const beforeKeys=await stage.screenshot();
     for(let n=0;n<4;n++)await page.keyboard.press('ArrowRight');
     assert.notDeepEqual(await stage.screenshot(),beforeKeys,'keyboard arrows actually change the displayed framing');
     await page.locator('#member-camera-reset').click();
     assert.equal(Number(await page.locator('#member-camera-zoom').inputValue()),2,'recentering preserves the zoom');
     await dragCameraImage(page,[.85,.15],[.2,.85]);
     assertFramingColor(await stageSamples(page),'green','live framing selects the green top-right area');
     await captureCamera(page);
     assertFramingColor(await stageSamples(page),'green','capturing preserves the visible crop');
     assert.equal(await page.locator('#photo-preview').isVisible(),false,'framing remains local until confirmation');
     await useCameraPhoto(page);
     let portrait=await imageSamples(page,await page.locator('#photo-preview').getAttribute('src'));
     assert.ok(Math.abs(portrait.width/portrait.height-.75)<.01,'confirmed JPEG has the portrait crop dimensions');
     assertFramingColor(portrait,'green','exported pixels match the live green framing');
     await openCamera(page);await captureCamera(page);
     await cameraZoom(page,2);await dragCameraImage(page,[.15,.85],[.8,.15]);
     assertFramingColor(await stageSamples(page),'blue','a frozen picture can still be reframed to its blue bottom-left area');
     await useCameraPhoto(page);
     const finalPhoto=await page.locator('#photo-preview').getAttribute('src');
     portrait=await imageSamples(page,finalPhoto);assertFramingColor(portrait,'blue','the final file contains the post-capture framing, not the unframed snapshot');
     assert.deepEqual(writes(events),[],'zoom and drag do not upload the image');
     await submitEmail(page,events);await notify(page);await checkout(page,events);
     assert.equal(writes(events)[0].body.photo,finalPhoto,'only the final cropped JPEG is submitted with the request');
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
     await page.locator('#member-camera-use').click();
     await page.waitForFunction(previous=>document.querySelector('#photo-preview').getAttribute('src')!==previous&&document.querySelector('#photo-status').textContent.includes('Photo prête'),previous);
     const nativePhoto=await page.locator('#photo-preview').getAttribute('src');
     await page.locator('#member_photo').setInputFiles({name:'invalide.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
     await cameraError(page);
     await page.locator('#member-camera-close').click();
     assert.equal(await page.locator('#photo-preview').getAttribute('src'),nativePhoto,'invalid replacement preserves a confirmed photo');
     await page.locator('#take-photo').click();await cameraError(page);
     const galleryChooser=page.waitForEvent('filechooser');await page.locator('#member-camera-file').click();
     const gallery=await galleryChooser;assert.equal(await gallery.element().getAttribute('id'),'member_photo');
     await gallery.setFiles(await photoFile(page,'#114477'));
     await page.locator('#member-camera-use').click();
     await page.waitForFunction(previous=>document.querySelector('#photo-preview').getAttribute('src')!==previous&&document.querySelector('#photo-status').textContent.includes('Photo prête'),nativePhoto);
     assert.deepEqual(writes(events),[],'recovery stays local');
    }else if(scenario==='camera-embed'){
     // The fixture guarantees a tall iframe independently of ResizeObserver timing.
     // The real console/embed modules still run; this checks camera placement,
     // not whether an artificial out-of-view filler triggers auto-resizing.
     try{
      await hostPage.waitForFunction(()=>document.getElementById('payment-console-frame').getBoundingClientRect().height>=5000);
     }catch(error){
      console.error('Embedded camera fixture dimensions:',await hostPage.evaluate(()=>{
       const frame=document.getElementById('payment-console-frame'),section=document.getElementById('tarifs');
       const bounds=frame.getBoundingClientRect(),style=getComputedStyle(frame),content=frame.contentDocument;
       return {height:bounds.height,top:bounds.top,styleHeight:frame.style.height,minHeight:style.minHeight,display:style.display,sectionHidden:section.hidden,sectionClass:section.className,visibility:document.visibilityState,contentHeight:content?.body.getBoundingClientRect().height,embedReady:content?.body.classList.contains('payment-embed')};
      }));throw error;
     }
     for(const hiding of ['class','hidden']){
      await page.locator('#take-photo').scrollIntoViewIfNeeded();await openCamera(page);
      for(const id of ['member-camera-dialog','member-camera-close','member-camera-capture']){
       const bounds=await page.locator('#'+id).boundingBox();assert.ok(bounds,`${id} is visible in the iframe`);
       assert.ok(bounds.y>=-1&&bounds.y+bounds.height<=845,`${id} stays inside the parent viewport: ${JSON.stringify(bounds)}`);
       assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,`${id} stays inside the parent width`);
      }
      if(process.env.KM16_SCREENSHOTS&&hiding==='class')await hostPage.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-camera-embed-${engineName}-${width}.png`)});
      if(width===1280&&hiding==='class'){
       await hostPage.setViewportSize({width,height:650});
       await page.waitForFunction(()=>{
        const dialog=document.querySelector('#member-camera-dialog');
        return dialog.classList.contains('camera-short')&&parseFloat(dialog.style.getPropertyValue('--camera-height'))<=626;
       });
       await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
       for(const id of ['member-camera-device','member-camera-zoom','member-camera-reset','member-camera-capture']){
        const control=page.locator('#'+id),bounds=await control.boundingBox();
        assert.ok(bounds&&bounds.width>0&&bounds.height>0,`${id} is displayed in the short desktop viewport`);
        assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1&&bounds.y>=-1&&bounds.y+bounds.height<=651,`${id} stays entirely in the 1280×650 parent viewport: ${JSON.stringify(bounds)}`);
        const clipping=await control.evaluate(element=>{
         const rect=element.getBoundingClientRect(),body=element.closest('.camera-body');
         if(!body)return null;
         const container=body.getBoundingClientRect(),left=container.left+body.clientLeft,top=container.top+body.clientTop;
         return {inside:rect.left>=left-1&&rect.right<=left+body.clientWidth+1&&rect.top>=top-1&&rect.bottom<=top+body.clientHeight+1,control:{top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right},body:{top,bottom:top+body.clientHeight,left,right:left+body.clientWidth}};
        });
        assert.ok(!clipping||clipping.inside,`${id} is not clipped by the scrollable camera body: ${JSON.stringify(clipping)}`);
       }
       if(process.env.KM16_SCREENSHOTS)await hostPage.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-camera-embed-short-${engineName}-${width}.png`)});
       await hostPage.setViewportSize({width,height:844});
       await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      }
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
     await fill(page,{photo:false});assert.equal(await page.locator('#member_photo').getAttribute('required'),null,'photo is optional for paid registration');
     await addPhoto(page);await page.locator('#terms').uncheck();await page.locator('#pay').click();assert.equal(otpCalls(events).length,0,'consent required');
     await page.locator('#terms').check();
     await page.locator('#checkout-reminder').check();
     if(process.env.KM16_SCREENSHOTS&&width===390){await page.locator('#contact_email').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-guest-${engineName}-${width}.png`)});}
     await submitEmail(page,events);
     if(process.env.KM16_SCREENSHOTS&&width===1280){await page.locator('#checkout-access').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(process.env.KM16_SCREENSHOTS,`member-verification-${engineName}-${width}.png`)});}
     await page.locator('#pay').click();assert.equal(otpCalls(events).length,1,'waiting does not resend email');
     await notify(page);assert.equal(await page.locator('#first_name').inputValue(),'Camille');assert.equal(await page.locator('#photo-preview').isVisible(),true);
     assert.deepEqual(writes(events),[],'verification does not submit automatically');assert.equal((await checkout(page,events)).reminder_opt_in,true,'explicit choice is sent after verification');
    }else if(scenario==='session'){
     assert.equal(await page.locator('#contact_email').inputValue(),confirmed.user.email);assert.equal(await page.locator('#contact_email').isEditable(),false);
     await fill(page);assert.equal((await checkout(page,events)).reminder_opt_in,false,'accepting terms does not opt in to reminders');assert.equal(otpCalls(events).length,0);
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
      await page.locator('#resume-request').click();
      await page.waitForFunction(()=>document.querySelector('#first_name').value==='Camille'&&!document.querySelector('#pay').disabled);
      assert.equal(await page.locator('#photo-preview').isVisible(),true);
      await page.locator('#pay').click();await page.waitForFunction(()=>!document.querySelector('#checkout-access').hidden&&!document.querySelector('#pay').disabled);
      assert.equal(otpCalls(events).length,2,'failed send can retry after restoring draft');
     }else if(scenario==='network-error'){await page.evaluate(()=>{window.TEST_OTP_BEHAVIOR='ok';});await page.locator('#pay').click();await page.waitForFunction(()=>!document.querySelector('#checkout-access').hidden&&!document.querySelector('#pay').disabled);assert.equal(otpCalls(events).length,2);}
    }else if(scenario==='wrong-identity'){
     await fill(page);await page.locator('#checkout-reminder').check();await submitEmail(page,events);await notify(page,'other@example.invalid');assert.deepEqual(writes(events),[]);
     assert.equal(await page.locator('#checkout-reminder').isChecked(),false,'a different identity never inherits consent');
     assert.equal(await page.locator('#first_name').inputValue(),'','different account clears personal data');assert.equal(await page.locator('#photo-preview').isVisible(),false);
    }else if(scenario==='draft-new-tab'){
     await fill(page);await page.locator('#km16-review-next').click();
     assert.equal(await page.locator('[data-registration-step=review]').getAttribute('aria-current'),'step');
     assert.match(await page.locator('#km16-review-participant').textContent(),/Camille Exemple/);
     await page.locator('#count').selectOption('4');await page.locator('#installments').check();
     await page.locator('#count').selectOption('3');
     assert.equal(await page.locator('#installments').isChecked(),false,'changing the schedule requires renewed consent');
     await page.locator('#installments').check();await page.locator('#checkout-reminder').check();await submitEmail(page,events);
     const photo=await page.locator('#photo-preview').getAttribute('src');
     const redirect=new URL(otpCalls(events)[0].args.options.emailRedirectTo);
     const next=await context.newPage();await next.goto(origin+redirect.search+'#access_token=fixture&refresh_token=fixture&type=magiclink');
     await next.waitForURL('**/adhesion.html?confirmation=1');await next.waitForFunction(()=>document.querySelector('#first_name').value==='Camille'&&!document.querySelector('#order').hidden);
     assert.equal(await next.locator('[data-registration-step=review]').getAttribute('aria-current'),'step');
     assert.equal(await next.locator('#last_name').inputValue(),'Exemple');assert.equal(await next.locator('#birth_date-display').inputValue(),'01/01/1990');assert.equal(await next.locator('#count').inputValue(),'3');
     assert.equal(await next.locator('#photo-preview').getAttribute('src'),photo);assert.equal(await next.locator('#terms').isChecked(),true);assert.equal(await next.locator('#installments').isChecked(),true);assert.equal(await next.locator('#contact_email').inputValue(),confirmed.user.email);assert.deepEqual(writes(events),[]);
     assert.equal(await next.locator('#checkout-reminder').isChecked(),false,'a saved draft cannot reinstate reminder consent');
     const body=await checkout(next,events);assert.equal(body.count,3);assert.equal(body.reminder_opt_in,false);
    }else if(scenario.startsWith('confirmation-')){
     await fill(page);await submitEmail(page,events);
     const expectedProduct=await page.locator('#chosen').textContent();
     await page.evaluate(()=>localStorage.removeItem('km16-pending-checkout'));
     const redirect=new URL(otpCalls(events)[0].args.options.emailRedirectTo);
     const next=await context.newPage();
     const expired=scenario==='confirmation-expired';
     const legacy=scenario==='confirmation-legacy';
     await next.goto(origin+(legacy?'':redirect.search)+(expired?'#error_code=otp_expired':'#access_token=fixture&refresh_token=fixture&type=magiclink'));
     if(legacy){
      await next.waitForURL('**/adhesion.html?espace=1');
      await next.locator('#my-orders').waitFor({state:'visible'});
      assert.equal(await next.locator('#account-access').isVisible(),false,'the session is reused in the member area');
      await next.reload();
      await next.locator('#my-orders').waitFor({state:'visible'});
      assert.equal(await next.locator('#account-access').isVisible(),false,'reloading the member area does not ask for another login');
      assert.equal(otpCalls(events).length,1);
     }else{
      await next.waitForURL(new RegExp('/adhesion[.]html[?].*confirmation='+(expired?'erreur':'1')));
      await next.waitForFunction(expired=>document.querySelector('#status').textContent.includes(expired?'demandez un nouveau lien':'Votre e-mail est confirmé'),expired);
      assert.equal(await next.locator('#chosen').textContent(),expectedProduct);
      assert.equal(await next.locator('#first_name').inputValue(),'','personal data is never carried by the email URL');
      if(!expired)assert.match(await next.locator('#pay').textContent(),/Continuer vers le paiement/);
     }
     assert.deepEqual(writes(events),[],'opening a confirmation does not create an order or initiate payment');
    }else if(scenario==='logout'){
     await fill(page);await page.locator('#checkout-reminder').check();await page.locator('#logout').click();await page.waitForFunction(()=>!document.querySelector('#contact_email').readOnly);
     assert.equal(await page.locator('#checkout-reminder').isChecked(),false,'logout clears the opt-in');
     assert.equal(await page.locator('#first_name').inputValue(),'');assert.equal(await page.locator('#contact_email').inputValue(),'');assert.equal(await page.locator('#photo-preview').isVisible(),false);assert.deepEqual(writes(events),[]);
    }else if(scenario==='reminder-free'){
     await page.locator('#checkout-reminder').check();
     await page.locator('#catalogue .card').filter({has:page.getByRole('heading',{name:'Cours d’essai offert',exact:true})}).getByRole('button').click();
     assert.equal(await page.locator('#checkout-reminder-wrap').isVisible(),false,'free trials never offer payment reminders');
     assert.equal(await page.locator('#stripe-payment-note').isVisible(),false,'free trials do not display payment instructions');
     assert.equal(await page.locator('#checkout-reminder').isChecked(),false,'choosing a free trial clears earlier consent');
     await fill(page);await submitEmail(page,events);await notify(page);
     await page.locator('#pay').click();
     await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('demande gratuite a été enregistrée'));
     assert.match(await page.locator('#status').textContent(),/Vous pouvez venir quand vous le souhaitez/);
     assert.doesNotMatch(await page.locator('#registration-validation-note').textContent(),/soumise à la validation/);
     assert.equal(await page.getByRole('link',{name:'Consulter le planning pour mon cours d’essai'}).getAttribute('href'),'./#planning');
     assert.equal(writes(events).find(event=>event.body.action==='checkout').body.reminder_opt_in,false,'free trials cannot opt in');
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
