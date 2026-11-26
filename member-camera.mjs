import {decodeMemberPhoto} from './member-photo.mjs?v=2';

// Camera access starts only after a deliberate click. No microphone is requested.
// Both the preview and the exported JPEG use the same portrait crop.
export function createMemberCamera({dialog,trigger,canOpen,onPhoto,onFile,onNative}){
 const find=id=>dialog.querySelector('#member-camera-'+id);
 const video=find('video'),preview=find('preview'),status=find('status'),stage=find('stage');
 const capture=find('capture'),use=find('use'),retake=find('retake'),switchCamera=find('switch'),retry=find('retry');
 const deviceSelect=find('device'),zoom=find('zoom');
 let stream=null,snapshot=null,revision=0,devices=[],deviceId='',viewportCleanup=()=>{},cancelPreview=()=>{};
 let framing={zoom:1,x:.5,y:.5},gesture=null,actions={onPhoto,onFile,onNative};
 const pointers=new Map();
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

 function stopStream(){
  cancelPreview();
  const previous=stream;stream=null;
  video.pause();video.srcObject=null;
  previous?.getTracks().forEach(track=>track.stop());
 }
 function showDevices(){
  const available=['starting','live','error'].includes(dialog.dataset.state);
  find('device-field').hidden=!available||!devices.length;
  deviceSelect.disabled=!available;
  switchCamera.hidden=!available||devices.length<2;switchCamera.disabled=!available;
  deviceSelect.replaceChildren(...devices.map((device,index)=>new Option(device.label||'Caméra '+(index+1),device.deviceId)));
  if(devices.some(device=>device.deviceId===deviceId))deviceSelect.value=deviceId;
 }
 function state(value,message){
  dialog.dataset.state=value;status.textContent=message;
  video.hidden=!['starting','live','capturing'].includes(value);
  preview.hidden=!['captured','saving'].includes(value);
  stage.hidden=['error','loading-photo'].includes(value);
  capture.hidden=!['starting','live','capturing'].includes(value);capture.disabled=value!=='live';
  use.hidden=retake.hidden=!['captured','saving'].includes(value);use.disabled=retake.disabled=value!=='captured';
  find('framing').hidden=!['live','captured'].includes(value);
  retry.hidden=value!=='error';find('native').hidden=value!=='error'||!actions.onNative;
  showDevices();renderFraming();position();
 }
 function clearSnapshot(){snapshot=null;preview.removeAttribute('src');pointers.clear();gesture=null;stage.classList.remove('dragging');}
 function dispose(){
  revision++;stopStream();clearSnapshot();actions={onPhoto,onFile,onNative};viewportCleanup();viewportCleanup=()=>{};
  trigger.setAttribute('aria-expanded','false');
 }
 function close(){dispose();if(dialog.open)dialog.close();}

 // Keep the camera and capture controls inside the visible part of a tall iframe.
 function position(){
  if(!dialog.open)return;
  let top=window.visualViewport?.offsetTop||0,height=window.visualViewport?.height||innerHeight;
  try{
   const frame=window.frameElement;
   if(frame&&parent!==window){
    const rect=frame.getBoundingClientRect(),viewport=parent.visualViewport;
    const parentTop=viewport?.offsetTop||0,parentHeight=viewport?.height||parent.innerHeight;
    const visibleTop=Math.max(rect.top,parentTop),visibleBottom=Math.min(rect.bottom,parentTop+parentHeight);
    if(visibleBottom>visibleTop){top=visibleTop-rect.top;height=visibleBottom-visibleTop;}
   }
  }catch{/* Cross-origin embeds use their own viewport. */}
  const margin=12;
  dialog.classList.toggle('camera-short',height<740);
  dialog.style.setProperty('--camera-height',Math.max(120,height-margin*2)+'px');
  dialog.style.top=Math.max(margin,top+(height-dialog.offsetHeight)/2)+'px';
 }
 function watchViewport(){
  const targets=[window,window.visualViewport];
  try{if(window.frameElement&&parent!==window)targets.push(parent,parent.visualViewport);}catch{}
  const update=()=>position();
  for(const target of targets){target?.addEventListener('resize',update);target?.addEventListener('scroll',update);}
  const observer=new ResizeObserver(update);observer.observe(dialog);
  viewportCleanup=()=>{observer.disconnect();for(const target of targets){target?.removeEventListener('resize',update);target?.removeEventListener('scroll',update);}};
 }

 function crop(){
  const width=snapshot?.width||video.videoWidth,height=snapshot?.height||video.videoHeight;
  if(!width||!height)return null;
  const baseWidth=Math.min(width,height*3/4),baseHeight=baseWidth*4/3;
  const maxZoom=Math.max(1,Math.min(3,baseWidth/100,baseHeight/100));
  framing.zoom=clamp(framing.zoom,1,maxZoom);zoom.max=String(maxZoom);
  const w=baseWidth/framing.zoom,h=baseHeight/framing.zoom;
  const x=clamp(framing.x*width-w/2,0,width-w),y=clamp(framing.y*height-h/2,0,height-h);
  framing.x=(x+w/2)/width;framing.y=(y+h/2)/height;
  return {x,y,w,h,width,height};
 }
 function renderFraming(){
  const box=crop();
  if(box){
   const source=snapshot?preview:video;
   Object.assign(source.style,{width:100*box.width/box.w+'%',height:100*box.height/box.h+'%',left:-100*box.x/box.w+'%',top:-100*box.y/box.h+'%'});
  }
  zoom.value=String(framing.zoom);
  find('zoom-value').textContent=framing.zoom.toFixed(2).replace('.',',')+' ×';
 }
 function canFrame(){return ['live','captured'].includes(dialog.dataset.state);}
 zoom.oninput=()=>{if(canFrame()){framing.zoom=Number(zoom.value);renderFraming();}};
 find('reset').onclick=()=>{framing.x=.5;framing.y=.5;renderFraming();};
 function pointerPosition(){
  const [first,second]=pointers.values();
  return second ? {x:(first.x+second.x)/2,y:(first.y+second.y)/2,distance:Math.hypot(second.x-first.x,second.y-first.y)} : first;
 }
 function startGesture(){
  const box=crop(),point=pointerPosition();
  gesture=box&&point ? {point,box,zoom:framing.zoom} : null;
  stage.classList.toggle('dragging',!!gesture);
 }
 stage.addEventListener('pointerdown',event=>{
  if(!canFrame()||event.button!==0||pointers.size>=2)return;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  stage.setPointerCapture(event.pointerId);startGesture();event.preventDefault();
 });
 stage.addEventListener('pointermove',event=>{
  if(!gesture||!pointers.has(event.pointerId)||!canFrame())return;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  const point=pointerPosition(),origin=gesture.point;
  const bounds=stage.getBoundingClientRect(),width=stage.clientWidth,height=stage.clientHeight;
  const dx=point.x-origin.x,dy=point.y-origin.y;
  let {box}=gesture;
  if(origin.distance){
   framing.zoom=gesture.zoom*point.distance/origin.distance;
   const resized=crop();
   const anchorX=(origin.x-bounds.left-stage.clientLeft)/width;
   const anchorY=(origin.y-bounds.top-stage.clientTop)/height;
   framing.x=(box.x+anchorX*box.w+(.5-anchorX-dx/width)*resized.w)/box.width;
   framing.y=(box.y+anchorY*box.h+(.5-anchorY-dy/height)*resized.h)/box.height;
  }else{
   if(framing.zoom===1&&(box.w===box.width||box.h===box.height)){
    if(Math.max(Math.abs(dx),Math.abs(dy))<5)return;
    const blocked=Math.abs(dx)>=Math.abs(dy) ? box.w===box.width : box.h===box.height;
    if(blocked){framing.zoom=1.25;box=gesture.box=crop();}
   }
   framing.x=(box.x+box.w/2-dx*box.w/width)/box.width;
   framing.y=(box.y+box.h/2-dy*box.h/height)/box.height;
  }
  renderFraming();
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture']){
  stage.addEventListener(event,pointer=>{if(pointers.delete(pointer.pointerId))startGesture();});
 }
 stage.addEventListener('keydown',event=>{
  if(!canFrame()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();const box=crop();if(!box)return;
  const step=event.shiftKey ? .1 : .025;
  framing.x+=({ArrowLeft:1,ArrowRight:-1}[event.key]||0)*box.w/box.width*step;
  framing.y+=({ArrowUp:1,ArrowDown:-1}[event.key]||0)*box.h/box.height*step;
  renderFraming();
 });

 async function editFile(file,editActions={onPhoto,onFile,onNative}){
  if(!file||dialog.open||!canOpen())return;
  const current=++revision;
  actions=editActions;framing={zoom:1,x:.5,y:.5};
  dialog.showModal();trigger.setAttribute('aria-expanded','true');watchViewport();
  state('loading-photo','Ouverture de la photo…');
  try{
   const image=await decodeMemberPhoto(file);
   if(current!==revision||!dialog.open)return;
   const scale=Math.min(1,1600/Math.max(image.width,image.height));
   const canvas=document.createElement('canvas');
   canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
   const context=canvas.getContext('2d');
   context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
   context.drawImage(image,0,0,canvas.width,canvas.height);
   snapshot=canvas;preview.src=canvas.toDataURL('image/jpeg',.95);
   await preview.decode();
   if(current!==revision||!dialog.open)return;
   state('captured','Ajustez le cadrage, puis utilisez cette photo.');
  }catch(error){
   if(current!==revision||!dialog.open)return;
   clearSnapshot();state('error',error.message||'Impossible d’ouvrir cette photo.');
  }
 }

 async function refreshDevices(current){
  try{
   const available=await navigator.mediaDevices.enumerateDevices();
   if(current!==revision||!dialog.open)return;
   devices=available.filter(device=>device.kind==='videoinput'&&device.deviceId);
   showDevices();position();
  }catch{/* The current camera remains usable without enumeration. */}
 }
 function integratedCamera(){
  // Device labels are only a preference, never a reason to hide other cameras.
  // In particular, do not mistake an iPhone Continuity camera for the Mac webcam.
  return devices.find(device=>!/(iphone|ipad|android|continuity|continuit|desk.?view|bureau|virtual|\bobs\b)/i.test(device.label)&&/(facetime|built[ -]?in|integrated|int[eé]gr[eé]e?|internal.*camera|macbook|imac|studio display)/i.test(device.label));
 }
 function errorMessage(error){
  if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return 'L’accès à la caméra est bloqué. Autorisez la caméra dans les réglages de ce site, puis réessayez. Vous pouvez aussi choisir une photo.';
  if(error?.name==='NotFoundError'||error?.name==='OverconstrainedError')return 'Cette caméra n’est plus disponible. Choisissez une autre caméra dans la liste, puis réessayez, ou choisissez une photo.';
  if(error?.name==='NotReadableError'||error?.name==='AbortError')return 'Cette caméra est indisponible ou utilisée ailleurs. Choisissez une autre caméra dans la liste ou fermez l’application qui l’utilise.';
  return 'Cette caméra ne transmet pas d’image. Choisissez une autre caméra dans la liste ou réessayez. Vous pouvez aussi choisir une photo.';
 }
 function waitForPreview(incoming,current){
  return new Promise((resolve,reject)=>{
   let finished=false,playing=false;
   const cancel=()=>finish();
   const ready=()=>{if(current!==revision||stream!==incoming||!dialog.open||playing&&video.readyState>=2&&video.videoWidth&&video.videoHeight)finish();};
   const timer=setTimeout(()=>finish(Error('Video timeout')),10000);
   function finish(error){
    if(finished)return;finished=true;clearTimeout(timer);
    video.removeEventListener('loadeddata',ready);video.removeEventListener('canplay',ready);
    if(cancelPreview===cancel)cancelPreview=()=>{};
    if(error)reject(error);else resolve();
   }
   cancelPreview=cancel;video.addEventListener('loadeddata',ready);video.addEventListener('canplay',ready);
   Promise.resolve(video.play()).then(()=>{playing=true;ready();},finish);
  });
 }
 async function start(requestedDevice=''){
  const current=++revision;stopStream();clearSnapshot();framing={zoom:1,x:.5,y:.5};
  if(requestedDevice)deviceId=requestedDevice;
  state('starting','Autorisez l’accès à la caméra. Vous pouvez choisir une autre caméra dans la liste.');
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
   state('error','La caméra directe n’est pas disponible dans ce navigateur. Ouvrez cette page en HTTPS dans Safari, Chrome ou Edge, ou choisissez une photo.');return;
  }
  try{
   // Show choices before requesting a stream: an unavailable iPhone must not trap
   // the user behind video.play() before the webcam selector becomes available.
   await refreshDevices(current);
   if(current!==revision||!dialog.open)return;
   const preferred=requestedDevice||integratedCamera()?.deviceId||'';
   const constraints=preferred?{deviceId:{exact:preferred}}:{facingMode:{ideal:'user'}};
   const incoming=await navigator.mediaDevices.getUserMedia({audio:false,video:{...constraints,width:{ideal:1280},height:{ideal:960}}});
   if(current!==revision||!dialog.open){incoming.getTracks().forEach(track=>track.stop());return;}
   stream=incoming;deviceId=stream.getVideoTracks()[0]?.getSettings?.().deviceId||preferred;
   // Labels can appear only after permission. Discover the built-in camera before
   // waiting for the default (possibly Continuity) camera to produce any image.
   await refreshDevices(current);
   if(current!==revision||!dialog.open||stream!==incoming)return;
   const integrated=!requestedDevice&&integratedCamera();
   if(integrated&&integrated.deviceId!==deviceId){void start(integrated.deviceId);return;}
   video.muted=true;video.srcObject=incoming;
   for(const track of incoming.getVideoTracks())track.addEventListener('ended',()=>{
    if(stream!==incoming||!dialog.open)return;
    revision++;stopStream();state('error','La caméra s’est arrêtée. Choisissez une caméra dans la liste ou réessayez.');
   },{once:true});
   await waitForPreview(incoming,current);
   if(current!==revision||!dialog.open||stream!==incoming)return;
   state('live','Placez votre visage dans le cadre. Déplacez l’image ou ajustez le zoom, puis capturez la photo.');
  }catch(error){
   if(current!==revision||!dialog.open)return;
   stopStream();state('error',errorMessage(error));
  }
 }
 function open(){
  if(dialog.open||!canOpen())return;
  dialog.showModal();trigger.setAttribute('aria-expanded','true');watchViewport();
  void start(deviceId);
 }
 capture.onclick=async()=>{
  if(dialog.dataset.state!=='live'||!stream||video.readyState<2)return;
  const current=revision;state('capturing','Capture de votre portrait…');
  try{
   const scale=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
   if(canvas.width<100||canvas.height<100)throw Error('Invalid camera resolution');
   canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
   snapshot=canvas;preview.src=canvas.toDataURL('image/jpeg',.95);stopStream();
   await preview.decode();
   if(current!==revision||!dialog.open)return;
   state('captured','Déplacez ou zoomez la photo, puis appuyez sur « Utiliser cette photo ».');
   use.focus({preventScroll:true});
  }catch{
   if(current!==revision||!dialog.open)return;
   stopStream();clearSnapshot();state('error','La photo n’a pas pu être prise. Réessayez ou choisissez une photo.');
  }
 };
 use.onclick=async()=>{
  if(dialog.dataset.state!=='captured'||!snapshot||!canOpen())return;
  const current=revision,box=crop(),source=snapshot;
  state('saving','Préparation de votre portrait…');
  try{
   const canvas=document.createElement('canvas');
   // Multiples of 3 and 4 preserve the displayed portrait ratio exactly.
   canvas.width=Math.max(102,Math.min(900,Math.floor(box.w/3)*3));canvas.height=canvas.width*4/3;
   canvas.getContext('2d').drawImage(source,box.x,box.y,box.w,box.h,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));
   if(current!==revision||!dialog.open||!canOpen())return;
   if(!blob)throw Error('Snapshot failed');
   const file=new File([blob],'portrait-km16.jpg',{type:'image/jpeg'});
   const accept=actions.onPhoto;close();void accept(file);
  }catch{
   if(current===revision&&dialog.open)state('captured','Le portrait n’a pas pu être préparé. Réessayez de l’utiliser ou reprenez la photo.');
  }
 };
 retake.onclick=()=>void start(deviceId);retry.onclick=()=>void start(deviceId);
 deviceSelect.onchange=()=>void start(deviceSelect.value);
 switchCamera.onclick=()=>{
  if(devices.length<2)return;
  const next=devices[(devices.findIndex(device=>device.deviceId===deviceId)+1)%devices.length];
  void start(next.deviceId);
 };
 navigator.mediaDevices?.addEventListener?.('devicechange',()=>{if(dialog.open)void refreshDevices(revision);});
 find('close').onclick=close;
 for(const [id,key] of [['file','onFile'],['native','onNative']]){
  find(id).onclick=()=>{const choose=actions[key];close();choose?.();};
 }
 trigger.onclick=open;
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{if(!dialog.open)dispose();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
 window.addEventListener('pagehide',close);
 window.addEventListener('message',event=>{
  if(parent!==window&&event.source===parent&&event.origin===location.origin&&event.data?.type==='km16-payment-hidden')close();
 });
 return {open,close,editFile};
}
