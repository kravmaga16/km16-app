const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-notifications';
const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function call(body){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Service indisponible');return d;}
const box=document.createElement('section');box.className='card';box.setAttribute('aria-label','Notifications KM16');
const title=document.createElement('h3');title.textContent='Les nouvelles du club sur ton téléphone';
const info=document.createElement('p');info.textContent='Reçois une alerte lorsque KM16 publie une actualité. Le titre et un aperçu peuvent apparaître sur l’écran verrouillé. Tu peux désactiver les alertes ici à tout moment.';
const label=document.createElement('label');
label.style.cssText='display:flex;align-items:center;gap:12px;min-height:44px;font-weight:650';
const button=document.createElement('input');button.type='checkbox';button.disabled=true;
button.style.cssText='width:22px;height:22px;accent-color:#c4151c';
label.append(button,document.createTextNode('Recevoir les notifications push des actualités KM16'));
const status=document.createElement('p');status.setAttribute('role','status');status.id='km16-push-status';
button.setAttribute('aria-describedby',status.id);
const group=document.createElement('fieldset');group.hidden=true;
const legend=document.createElement('legend');legend.textContent='Choisir les alertes sur cet appareil';group.append(legend);
const choices=Object.entries({cours:'Infos cours et fermetures',stages:'Stages et événements'}).map(([key,title])=>{
 const label=document.createElement('label');label.style.cssText='display:flex;align-items:center;gap:12px;min-height:44px';
 const input=document.createElement('input');input.type='checkbox';input.value=key;input.style.cssText=button.style.cssText;
 label.append(input,document.createTextNode(title));group.append(label);return input;
});
box.append(title,info,label,group,status);document.querySelector('#notification-settings')?.append(box);
const appleMobile=/iPhone|iPad|iPod/.test(navigator.userAgent)||(
 navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1
);
const standalone=navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;
const supported='serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
const blockedMessage='Active les notifications pour KM16 dans les réglages de notifications de ton appareil, puis reviens ici.';
if((appleMobile&&!standalone)||!supported){
 label.style.display='none';
 status.textContent=appleMobile
  ? standalone
   ? 'Les notifications KM16 nécessitent iOS ou iPadOS 16.4 ou une version plus récente.'
   : 'Dans Safari, ouvre app.km16.fr, touche Partager puis Sur l’écran d’accueil. Ouvre ensuite KM16 depuis son icône et reviens dans Paramètres pour activer les notifications.'
  : 'Les notifications ne sont pas disponibles dans ce navigateur.';
}else{
 let reg,key,token,subscription,working=false,categories=null;
 function paint(){window.dispatchEvent(new Event('km16-push-change'));button.checked=!!subscription;button.disabled=working||!key;group.hidden=!subscription||!categories;for(const c of choices){c.checked=categories?.includes(c.value)||false;c.disabled=working;}}
 try{
  token=localStorage.getItem('km16-push-token');
  if(!token){token=b64(crypto.getRandomValues(new Uint8Array(32)));localStorage.setItem('km16-push-token',token);}
  const config=await call({action:'config'});key=config.publicKey;
  await navigator.serviceWorker.register('./sw.js');
  reg=await navigator.serviceWorker.ready;
  subscription=await reg.pushManager.getSubscription();
  if(subscription){await call({action:'subscribe',token,subscription:subscription.toJSON()});categories=(await call({action:'preferences',token})).categories;status.textContent='Notifications activées sur ce téléphone.';}
  else if(Notification.permission==='denied')status.textContent=blockedMessage;
  paint();
 }catch(e){status.textContent=e.message||'Notifications indisponibles pour le moment.';button.checked=!!subscription;}
 button.onchange=async()=>{
  if(working||!reg||!key)return;working=true;paint();
  try{
   if(subscription){
    await call({action:'unsubscribe',token});
    await subscription.unsubscribe();subscription=null;categories=null;status.textContent='Notifications désactivées sur ce téléphone.';
   }else{
    if(Notification.permission==='denied')throw Error(blockedMessage);
    // La demande d’autorisation et l’abonnement partent du même geste.
    subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(key)});
    try{await call({action:'subscribe',token,subscription:subscription.toJSON()});}
    catch(e){await subscription.unsubscribe();subscription=null;throw e;}
    categories=(await call({action:'preferences',token})).categories;status.textContent='Notifications activées sur ce téléphone.';
   }
  }catch(e){
   status.textContent=e.name==='NotAllowedError'
    ? Notification.permission==='denied'?blockedMessage:'Autorise les notifications pour KM16 lorsque ton appareil te le demande.'
    : e.message||'Activation impossible.';
  }finally{working=false;paint();}
 };
 for(const choice of choices)choice.onchange=async()=>{
  if(working||!subscription||!categories)return;
  const next=choices.filter(c=>c.checked).map(c=>c.value);
  working=true;paint();
  try{
   categories=(await call({action:'preferences',token,categories:next})).categories;
   status.textContent=categories.length?'Préférences enregistrées.':'Aucune catégorie sélectionnée : aucune alerte ne sera envoyée à cet appareil.';
  }catch(e){status.textContent=e.message||'Préférences non enregistrées.';}
  finally{working=false;paint();}
 };

}
