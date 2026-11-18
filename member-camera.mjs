// Camera access starts only after the member clicks the photo button.
// No audio is requested and a snapshot stays local until explicitly accepted.
export function createMemberCamera({dialog,trigger,canOpen,onPhoto,onFile,onNative}){
 const find=id=>dialog.querySelector('#member-camera-'+id);
 const video=find('video'),preview=find('preview'),status=find('status');
 const capture=find('capture'),use=find('use'),retake=find('retake'),switchCamera=find('switch'),retry=find('retry');
 let stream=null,snapshot=null,revision=0,devices=[],deviceId='',viewportCleanup=()=>{};

 function stopStream(){
  const previous=stream;stream=null;
  video.pause();video.srcObject=null;
  previous?.getTracks().forEach(track=>track.stop());
 }
 function state(value,message){
  dialog.dataset.state=value;status.textContent=message;
  video.hidden=value!=='starting'&&value!=='live';
  preview.hidden=value!=='captured';
  capture.hidden=value!=='starting'&&value!=='live';capture.disabled=value!=='live';
  use.hidden=retake.hidden=value!=='captured';
  switchCamera.hidden=value!=='live'||devices.length<2;
  retry.hidden=value!=='error';
  find('native').hidden=value!=='error';
  position();
 }
 function clearSnapshot(){snapshot=null;preview.removeAttribute('src');}
 function dispose(){
  revision++;stopStream();clearSnapshot();viewportCleanup();viewportCleanup=()=>{};
  trigger.setAttribute('aria-expanded','false');
 }
 function close(){dispose();if(dialog.open)dialog.close();}

 // The form is also embedded in a very tall, automatically resized iframe.
 // Centre the dialog in the visible part of that iframe, not its full height.
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
 function errorMessage(error){
  if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return 'L’accès à la caméra est bloqué. Autorisez la caméra dans les réglages de ce site, puis réessayez. Vous pouvez aussi choisir une photo.';
  if(error?.name==='NotFoundError'||error?.name==='OverconstrainedError')return 'Aucune caméra disponible. Vérifiez qu’une caméra est connectée, puis réessayez, ou choisissez une photo.';
  if(error?.name==='NotReadableError'||error?.name==='AbortError')return 'La caméra est indisponible ou utilisée par une autre application. Fermez cette application, puis réessayez, ou choisissez une photo.';
  return 'La caméra n’a pas pu démarrer. Réessayez ou choisissez une photo sur votre appareil.';
 }
 async function start(requestedDevice=''){
  const current=++revision;stopStream();clearSnapshot();devices=[];
  state('starting','Autorisez l’accès à la caméra si votre navigateur le demande.');
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
   state('error','La caméra directe n’est pas disponible dans ce navigateur. Ouvrez cette page en HTTPS dans Safari, Chrome ou Edge, ou choisissez une photo.');return;
  }
  let waiting;
  try{
   const constraints=requestedDevice?{deviceId:{exact:requestedDevice}}:{facingMode:{ideal:'user'}};
   const incoming=await navigator.mediaDevices.getUserMedia({audio:false,video:{...constraints,width:{ideal:1280},height:{ideal:960}}});
   if(current!==revision||!dialog.open){incoming.getTracks().forEach(track=>track.stop());return;}
   stream=incoming;deviceId=stream.getVideoTracks()[0]?.getSettings?.().deviceId||requestedDevice;
   video.muted=true;video.srcObject=incoming;
   await Promise.race([video.play(),new Promise((_,reject)=>{waiting=setTimeout(()=>reject(Error('Video timeout')),10000);})]);
   clearTimeout(waiting);
   if(current!==revision||!dialog.open)return;
   if(!video.videoWidth||!video.videoHeight)throw Error('No video frame');
   for(const track of incoming.getVideoTracks())track.addEventListener('ended',()=>{
    if(stream!==incoming||!dialog.open)return;
    revision++;stopStream();state('error','La caméra s’est arrêtée. Réessayez pour la rouvrir, ou choisissez une photo.');
   },{once:true});
   state('live','Placez votre visage dans le cadre, puis capturez la photo.');
   // Enumeration happens only after permission, to offer other available cameras.
   try{
    const available=await navigator.mediaDevices.enumerateDevices();
    if(current!==revision||!dialog.open||stream!==incoming)return;
    devices=available.filter(device=>device.kind==='videoinput'&&device.deviceId);
    switchCamera.hidden=devices.length<2;
   }catch{/* The default camera remains usable without device enumeration. */}
  }catch(error){
   if(current!==revision||!dialog.open)return;
   stopStream();state('error',errorMessage(error));
  }finally{clearTimeout(waiting);}
 }
 function open(){
  if(dialog.open||!canOpen())return;
  dialog.showModal();trigger.setAttribute('aria-expanded','true');watchViewport();
  void start();
 }
 capture.onclick=async()=>{
  if(dialog.dataset.state!=='live'||!stream||video.readyState<2)return;
  const current=revision;
  capture.disabled=true;switchCamera.disabled=true;
  try{
   const scale=Math.min(1,1200/Math.max(video.videoWidth,video.videoHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
   if(canvas.width<100||canvas.height<100)throw Error('Invalid camera resolution');
   canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
   preview.src=canvas.toDataURL('image/jpeg',.9);
   stopStream();
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));
   if(current!==revision||!dialog.open)return;
   if(!blob)throw Error('Snapshot failed');
   snapshot=new File([blob],'portrait-km16.jpg',{type:'image/jpeg'});
   state('captured','Vérifiez votre portrait. Utilisez cette photo ou reprenez-en une.');
   use.focus({preventScroll:true});
  }catch{
   if(current!==revision||!dialog.open)return;
   stopStream();clearSnapshot();state('error','La photo n’a pas pu être prise. Réessayez ou choisissez une photo.');
  }finally{switchCamera.disabled=false;}
 };
 use.onclick=()=>{if(!snapshot||!canOpen())return;const file=snapshot;close();void onPhoto(file);};
 retake.onclick=()=>void start(deviceId);
 retry.onclick=()=>void start();
 switchCamera.onclick=()=>{
  if(devices.length<2)return;
  const next=devices[(devices.findIndex(device=>device.deviceId===deviceId)+1)%devices.length];
  void start(next.deviceId);
 };
 find('close').onclick=close;
 find('file').onclick=()=>{close();onFile();};
 find('native').onclick=()=>{close();onNative();};
 trigger.onclick=open;
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{if(!dialog.open)dispose();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
 window.addEventListener('pagehide',close);
 window.addEventListener('message',event=>{
  if(parent!==window&&event.source===parent&&event.origin===location.origin&&event.data?.type==='km16-payment-hidden')close();
 });
 return {open,close};
}
