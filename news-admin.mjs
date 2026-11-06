const $=id=>document.getElementById(id);
const db=window.supabase.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false}});
let selected=null,busy=false,epoch=0,stats=null,statsRequest=0;
const say=text=>{$('status').textContent=text;};
function lock(value){busy=value;for(const b of document.querySelectorAll('#workspace button'))b.disabled=value;}
function reset(){selected=null;$('category').disabled=false;$('publish-notify').hidden=false;$('editor').reset();paintAudience();$('editor-title').textContent='Nouvelle actualité';$('save').hidden=false;$('publish').textContent='Publier seulement';}
async function load(){
 void loadStats();
 const gen=epoch;const {data,error}=await db.from('km16_news').select('*').order('created_at',{ascending:false}).limit(200);
 if(gen!==epoch)return;
 if(error){say('Chargement impossible : '+error.message);return;}
 $('list').replaceChildren();
 for(const row of data){
  const card=document.createElement('article');card.className='card';
  const title=document.createElement('h3');title.textContent=row.title;
  const state=document.createElement('small');state.textContent=row.published_at?'Publié le '+new Date(row.published_at).toLocaleString('fr-FR'):'Brouillon';
  const body=document.createElement('p');body.textContent=row.body;
  const edit=document.createElement('button');edit.textContent='Modifier';edit.onclick=()=>{if(busy)return;selected=row;$('title').value=row.title;$('body').value=row.body;$('editor-title').textContent='Modifier l’actualité';$('category').value=row.category||'cours';paintAudience();$('category').disabled=!!row.push_started_at;$('publish-notify').hidden=!!(row.published_at||row.push_started_at);$('save').hidden=!!row.published_at;$('publish').textContent=row.published_at?'Enregistrer les modifications':'Publier seulement';$('editor').scrollIntoView({block:'start'});};
  const category=document.createElement('p');category.textContent=row.category==='stages'?'Stages et événements':'Infos cours et fermetures';card.append(title,state,category,body,edit);
  if(row.published_at){const send=document.createElement('button');send.textContent=row.push_started_at?'Voir / poursuivre l’envoi':'Notifier les téléphones inscrits';send.onclick=async()=>{if(busy)return;if(!row.push_started_at&&!confirm('Envoyer cette actualité aux téléphones inscrits ?'))return;lock(true);try{await notifyNews(row.id);await load();}catch(e){say('Actualité publiée. Envoi interrompu : '+e.message+' Utilise « Voir / poursuivre l’envoi ».');}finally{lock(false);}};card.append(send);}

  if(row.published_at){const withdraw=document.createElement('button');withdraw.textContent='Retirer de l’app';withdraw.onclick=async()=>{if(busy)return;lock(true);try{const {error}=await db.from('km16_news').update({published_at:null}).eq('id',row.id);if(error)throw error;reset();await load();say('Actualité retirée. Elle est conservée en brouillon.');}catch(e){say(e.message);}finally{lock(false);}};card.append(withdraw);}
  $('list').append(card);
 }
 if(!data.length)$('list').textContent='Aucune actualité pour le moment.';
}
async function save(publish,notify=false){
 if(busy||!$('editor').reportValidity())return;
 const title=$('title').value.trim(),body=$('body').value.trim();
 if(!title||!body){say('Renseigne le titre et le message.');return;}
 lock(true);
 try{
  const payload={title,body,category:selected?.push_started_at?selected.category:$('category').value,published_at:publish?(selected?.published_at||new Date().toISOString()):null};
  const query=selected?db.from('km16_news').update(payload).eq('id',selected.id):db.from('km16_news').insert(payload);
  const {data,error}=await query.select().single();if(error)throw error;
  const shouldNotify=publish&&notify&&!data.push_started_at;
  selected=data;reset();await load();
  say(publish?'Actualité publiée dans l’app.':'Brouillon enregistré.');
  if(shouldNotify){try{await notifyNews(data.id);await load();}catch(e){say('Actualité publiée, mais envoi interrompu : '+e.message+' Utilise « Voir / poursuivre l’envoi » pour vérifier.');}}

 }catch(e){say('Enregistrement impossible : '+e.message);}finally{lock(false);}
}
$('editor').onsubmit=e=>{e.preventDefault();save(false);};$('publish').onclick=()=>save(true);$('publish-notify').onclick=()=>save(true,true);
$('new').onclick=()=>{reset();$('title').focus();};$('refresh').onclick=load;
async function state(s){epoch++;stats=null;$('push-stats').textContent='';reset();$('list').replaceChildren();const admin=s?.user?.email?.toLowerCase()==='alexandre.marchat@gmail.com';$('login').hidden=!!s;$('forbidden').hidden=!s||admin;$('workspace').hidden=!admin;$('password').value='';if(admin)await load();}
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;say('');}catch(e){say(e.message);}finally{button.disabled=false;$('password').value='';}};
async function logout(){await db.auth.signOut();await state(null);}
$('logout').onclick=logout;$('other').onclick=logout;
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
