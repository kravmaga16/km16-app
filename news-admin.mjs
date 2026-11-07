import {appendImage,prepareImage} from './news-image.mjs';
import {parisInput,parisInstant} from './paris-time.mjs';
const $=id=>document.getElementById(id);
const db=window.supabase.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false}});
let imagePath=null,imageBlob=null,imageGeneration=0;
let selected=null,busy=false,epoch=0,stats=null,statsRequest=0;
const todayParis=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const expired=row=>!!row.expires_on&&row.expires_on<todayParis();
const say=text=>{$('status').textContent=text;};
function lock(value){busy=value;$('news-image').disabled=value;for(const b of document.querySelectorAll('#workspace button'))b.disabled=value;}
function reset(){clearImage();selected=null;$('schedule-fields').hidden=false;$('category').disabled=false;$('publish-notify').hidden=false;$('editor').reset();paintAudience();$('editor-title').textContent='Nouvelle actualité';$('save').hidden=false;$('publish').textContent='Publier seulement';}
async function load(){
 void loadStats();
 const gen=epoch,showArchives=$('show-archives').checked;
 let query=db.from('km16_news').select('*').order('created_at',{ascending:false}).limit(200);
 if(!showArchives)query=query.is('archived_at',null);
 const {data,error}=await query;
 if(showArchives!==$('show-archives').checked)return;
 if(gen!==epoch)return;
 if(error){say('Chargement impossible : '+error.message);return;}
 $('list').replaceChildren();
 for(const row of data){
  const card=document.createElement('article');card.className='card';
  const title=document.createElement('h3');title.textContent=row.title;
  const state=document.createElement('small');state.textContent=row.scheduled_for?'Programmée le '+parisInput(row.scheduled_for).replace('T',' à ')+' (Paris) · '+(row.scheduled_notify?'avec notification':'sans notification'):expired(row)?'Date de fin dépassée — hors de l’accueil':row.published_at?'Publié le '+new Date(row.published_at).toLocaleString('fr-FR'):'Brouillon';
  const body=document.createElement('p');body.textContent=row.body;
  const edit=document.createElement('button');edit.textContent='Modifier';edit.onclick=()=>{if(busy)return;selected=row;$('title').value=row.title;$('body').value=row.body;clearImage();imagePath=row.image_path;renderImage();$('expires-on').value=row.expires_on||'';$('scheduled-for').value=parisInput(row.scheduled_for);$('schedule-mode').value=row.scheduled_notify?'notify':'only';$('schedule-fields').hidden=!!(row.published_at||row.push_started_at);$('editor-title').textContent='Modifier l’actualité';$('category').value=row.category||'cours';paintAudience();$('category').disabled=!!row.push_started_at;$('publish-notify').hidden=!!(row.published_at||row.push_started_at);$('save').hidden=!!row.published_at;$('publish').textContent=row.published_at?'Enregistrer les modifications':'Publier seulement';$('editor').scrollIntoView({block:'start'});};
  const category=document.createElement('p');category.textContent=row.category==='stages'?'Stages et événements':'Infos cours et fermetures';card.append(title,state,category);appendImage(card,row.image_path,row.title);card.append(body,edit);
  const duplicate=document.createElement('button');duplicate.type='button';duplicate.textContent='Dupliquer';
  duplicate.onclick=()=>{
   if(busy)return;
   reset();
   $('title').value=(row.title+' — copie').slice(0,120);
   $('body').value=row.body;
   $('category').value=row.category||'cours';
   imagePath=row.image_path||null;renderImage();paintAudience();
   $('editor-title').textContent='Copie — nouveau brouillon';
   say('Copie préparée. Vérifie le contenu, puis enregistre le brouillon. Les dates sont effacées et aucune notification n’a été envoyée.');
   $('editor').scrollIntoView({block:'start'});$('title').focus({preventScroll:true});
  };
  card.append(duplicate);
  if(!row.published_at&&!row.scheduled_for){
   const archive=document.createElement('button');archive.type='button';archive.textContent=row.archived_at?'Restaurer le brouillon':'Archiver le brouillon';
   archive.onclick=async()=>{
    if(busy)return;lock(true);
    try{
     const {error}=await db.from('km16_news').update({archived_at:row.archived_at?null:new Date().toISOString()}).eq('id',row.id).is('published_at',null).is('scheduled_for',null).select().single();
     if(error)throw error;
     reset();await load();say(row.archived_at?'Brouillon restauré.':'Brouillon archivé. Aucune notification envoyée.');
    }catch{say('Archivage impossible. Actualise la liste et réessaie.');}finally{lock(false);}
   };
   card.append(archive);
   if(row.archived_at){state.textContent='Brouillon archivé';edit.remove();duplicate.remove();}
  }

  if(row.published_at&&!expired(row)){const send=document.createElement('button');send.textContent=row.push_started_at?'Voir / poursuivre l’envoi':'Notifier les téléphones inscrits';send.onclick=async()=>{if(busy)return;if(!row.push_started_at&&!confirm('Envoyer cette actualité aux téléphones inscrits ?'))return;lock(true);try{await notifyNews(row.id);await load();}catch(e){say('Actualité publiée. Envoi interrompu : '+e.message+' Utilise « Voir / poursuivre l’envoi ».');}finally{lock(false);}};card.append(send);}

  if(row.published_at){const withdraw=document.createElement('button');withdraw.textContent='Retirer de l’app';withdraw.onclick=async()=>{if(busy)return;lock(true);try{const {error}=await db.from('km16_news').update({published_at:null,scheduled_for:null,scheduled_notify:false}).eq('id',row.id);if(error)throw error;reset();await load();say('Actualité retirée. Elle est conservée en brouillon.');}catch(e){say(e.message);}finally{lock(false);}};card.append(withdraw);}
  if(row.scheduled_for){const cancel=document.createElement('button');cancel.textContent='Annuler la programmation';cancel.onclick=async()=>{
   if(busy)return;lock(true);
   try{
    const {error}=await db.from('km16_news').update({scheduled_for:null,scheduled_notify:false}).eq('id',row.id).eq('scheduled_for',row.scheduled_for).is('published_at',null).select().single();
    if(error)throw error;reset();await load();say('Programmation annulée. Actualité conservée en brouillon.');
   }catch{say('La programmation a changé ou la publication a déjà commencé. Actualise la liste.');}
   finally{lock(false);}
  };card.append(cancel);}
  $('list').append(card);
 }
 if(!data.length)$('list').textContent='Aucune actualité pour le moment.';
}
async function save(publish,notify=false,schedule=false){
 if(busy||!$('editor').reportValidity())return;
 const title=$('title').value.trim(),body=$('body').value.trim();
 if(!title||!body){say('Renseigne le titre et le message.');return;}
 const expires_on=$('expires-on').value||null;
 if(publish&&expires_on&&expires_on<todayParis()){say('Choisis une date de fin à partir d’aujourd’hui, ou laisse ce champ vide.');return;}
 lock(true);
 try{
  let scheduled_for=null;
  if(schedule){
   if(selected?.published_at||selected?.push_started_at)throw Error('Cette actualité ne peut plus être programmée.');
   scheduled_for=parisInstant($('scheduled-for').value);
   if(new Date(scheduled_for).getTime()<=Date.now()+60000)throw Error('Choisis une heure située à plus d’une minute.');
   if(expires_on&&expires_on<$('scheduled-for').value.slice(0,10))throw Error('La date de fin doit être le jour de publication ou après.');
   const {data:{session}}=await db.auth.getSession();if(!session)throw Error('Session expirée');
   const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-notifications',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'schedule-ready'})});
   const ready=await r.json();if(!r.ok||!ready.ready)throw Error('La programmation serveur n’est pas encore activée. Aucune programmation enregistrée.');
  }
  if(imageBlob){
   const path='news/'+crypto.randomUUID()+'.jpg';
   const {error}=await db.storage.from('km16-news-images').upload(path,imageBlob,{contentType:'image/jpeg',upsert:false});
   if(error)throw Error('Image non envoyée : '+error.message);
   imagePath=path;imageBlob=null;
  }
  const payload={title,body,image_path:imagePath||null,expires_on,scheduled_for,scheduled_notify:schedule&&$('schedule-mode').value==='notify',category:selected?.push_started_at?selected.category:$('category').value,published_at:publish?(selected?.published_at||new Date().toISOString()):null};
  let query=selected?db.from('km16_news').update(payload).eq('id',selected.id):db.from('km16_news').insert(payload);
  if(selected?.scheduled_for)query=query.eq('scheduled_for',selected.scheduled_for).is('published_at',null);
  const {data,error}=await query.select().single();if(error)throw error;
  const shouldNotify=publish&&notify&&!data.push_started_at;
  selected=data;reset();await load();
  say(schedule?'Actualité programmée pour le '+parisInput(data.scheduled_for).replace('T',' à ')+' (Paris).':publish?'Actualité publiée dans l’app.':'Brouillon enregistré.');
  if(shouldNotify){try{await notifyNews(data.id);await load();}catch(e){say('Actualité publiée, mais envoi interrompu : '+e.message+' Utilise « Voir / poursuivre l’envoi » pour vérifier.');}}

 }catch(e){say('Enregistrement impossible : '+e.message);}finally{lock(false);}
}
$('editor').onsubmit=e=>{e.preventDefault();save(false);};$('publish').onclick=()=>save(true);$('publish-notify').onclick=()=>save(true,true);$('schedule').onclick=()=>save(false,false,true);
$('new').onclick=()=>{reset();$('title').focus();};$('refresh').onclick=load;
async function state(s){epoch++;$('history').replaceChildren();stats=null;$('push-stats').textContent='';reset();$('list').replaceChildren();const admin=s?.user?.email?.toLowerCase()==='alexandre.marchat@gmail.com';$('login').hidden=!!s;$('forbidden').hidden=!s||admin;$('workspace').hidden=!admin;$('password').value='';if(admin)await load();}
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;say('');}catch(e){say(e.message);}finally{button.disabled=false;$('password').value='';}};
async function logout(){await db.auth.signOut();await state(null);}
$('logout').onclick=logout;$('other').onclick=logout;
$('show-archives').onchange=load;
$('category').onchange=paintAudience;
function paintAudience(){
 const count=stats?.[$('category').value];
 $('push-audience').textContent=Number.isInteger(count)&&!selected?.published_at&&!selected?.push_started_at?count+' appareil(s) inscrit(s) à cette catégorie au dernier relevé.':'';
}
async function loadStats(){
 const gen=epoch,request=++statsRequest;
 const current=()=>gen===epoch&&request===statsRequest;
 $('push-stats').textContent='Comptage des appareils…';
 stats=null;paintAudience();
 try{
  const {data:{session}}=await db.auth.getSession();if(!session||!current())return;
  const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-notifications',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'stats'})});
  const d=await r.json();
  if(!r.ok||!['total','cours','stages'].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0))throw Error('Compteur indisponible');
  if(!current())return;
  stats=d;
  $('push-stats').textContent=d.total+' appareil(s) inscrit(s) · Infos cours et fermetures : '+d.cours+' · Stages et événements : '+d.stages;
  paintAudience();
 }catch{if(current())$('push-stats').textContent='Compteur indisponible. Clique sur Actualiser pour réessayer.';}
}
let historyBusy=false;
$('history-refresh').onclick=async()=>{
 if(historyBusy)return;historyBusy=true;
 const gen=epoch;const button=$('history-refresh');button.disabled=true;
 $('history').textContent='Chargement…';
 try{
  const {data:{session}}=await db.auth.getSession();if(!session)throw Error();
  const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-notifications',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'history'})});
  const d=await r.json();if(!r.ok||!Array.isArray(d.history))throw Error();
  if(gen!==epoch)return;
  $('history').replaceChildren();
  if(!d.history.length)$('history').textContent='Aucun envoi de notification enregistré.';
  for(const row of d.history){
   const article=document.createElement('article');article.className='card';
   const h=document.createElement('h3');h.textContent=row.title;
   const p=document.createElement('p');p.textContent=new Date(row.started_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})+' · '+(row.category==='stages'?'Stages et événements':'Infos cours et fermetures');
   const result=document.createElement('p');result.textContent='Acceptées : '+row.accepted+' · Échecs : '+row.failed+' · En attente : '+row.pending+' · En cours ou résultat incertain : '+row.uncertain;
   article.append(h,p,result);$('history').append(article);
  }
 }catch{if(gen===epoch)$('history').textContent='Historique indisponible. Réessaie après avoir vérifié ta connexion.';}
 finally{historyBusy=false;button.disabled=false;}
};
function clearImage(){imageGeneration++;imagePath=null;imageBlob=null;$('news-image').value='';$('image-preview').replaceChildren();$('image-remove').hidden=true;}
function renderImage(){const box=$('image-preview');box.replaceChildren();if(imagePath)appendImage(box,imagePath,$('title').value||'actualité');$('image-remove').hidden=!imagePath&&!imageBlob;}
$('image-remove').onclick=()=>{if(!busy)clearImage();};
$('news-image').onchange=async()=>{
 if(busy)return;
 const file=$('news-image').files[0];if(!file)return;
 const gen=++imageGeneration;
 lock(true);say('Préparation de l’image…');
 try{
  const blob=await prepareImage(file);
  if(gen!==imageGeneration)return;
  imageBlob=blob;imagePath=null;
  const img=document.createElement('img'),url=URL.createObjectURL(blob);
  img.src=url;img.alt='Aperçu de l’image choisie';img.style.cssText='max-width:100%;max-height:360px;object-fit:contain';img.onload=img.onerror=()=>URL.revokeObjectURL(url);
  $('image-preview').replaceChildren(img);$('image-remove').hidden=false;say('Image prête. Enregistre ou publie l’actualité pour la conserver.');
 }catch(e){if(gen===imageGeneration)say(e.message||'Image illisible');$('news-image').value='';}
 finally{lock(false);}
};
db.auth.onAuthStateChange((_e,s)=>setTimeout(()=>state(s),0));const {data}=await db.auth.getSession();await state(data.session);

async function notifyNews(id){
 const gen=epoch;
 while(gen===epoch){
  const {data:{session}}=await db.auth.getSession();if(!session)throw Error('Session expirée');
  const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-notifications',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'send',id})});
  const d=await r.json();if(!r.ok)throw Error(d.error||'Envoi impossible');
  if(gen!==epoch)return;
  say(d.accepted+' notification(s) acceptée(s) par le service d’envoi · '+d.failed+' échec(s) · '+d.pending+' en attente'+(d.sending?' · '+d.sending+' en cours ou résultat incertain':'')+'. La réception sur chaque téléphone n’est pas garantie.');
  if(!d.pending)return;
 }
}
