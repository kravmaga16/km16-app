const $=id=>document.getElementById(id);
const db=window.supabase.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false}});
let selected=null,busy=false,epoch=0;
const say=text=>{$('status').textContent=text;};
function lock(value){busy=value;for(const b of document.querySelectorAll('#workspace button'))b.disabled=value;}
function reset(){selected=null;$('editor').reset();$('editor-title').textContent='Nouvelle actualité';$('save').hidden=false;$('publish').textContent='Publier dans l’app';}
async function load(){
 const gen=epoch;const {data,error}=await db.from('km16_news').select('*').order('created_at',{ascending:false}).limit(200);
 if(gen!==epoch)return;
 if(error){say('Chargement impossible : '+error.message);return;}
 $('list').replaceChildren();
 for(const row of data){
  const card=document.createElement('article');card.className='card';
  const title=document.createElement('h3');title.textContent=row.title;
  const state=document.createElement('small');state.textContent=row.published_at?'Publié le '+new Date(row.published_at).toLocaleString('fr-FR'):'Brouillon';
  const body=document.createElement('p');body.textContent=row.body;
  const edit=document.createElement('button');edit.textContent='Modifier';edit.onclick=()=>{if(busy)return;selected=row;$('title').value=row.title;$('body').value=row.body;$('editor-title').textContent='Modifier l’actualité';$('save').hidden=!!row.published_at;$('publish').textContent=row.published_at?'Enregistrer les modifications':'Publier dans l’app';$('editor').scrollIntoView({block:'start'});};
  card.append(title,state,body,edit);
  if(row.published_at){const withdraw=document.createElement('button');withdraw.textContent='Retirer de l’app';withdraw.onclick=async()=>{if(busy)return;lock(true);try{const {error}=await db.from('km16_news').update({published_at:null}).eq('id',row.id);if(error)throw error;reset();await load();say('Actualité retirée. Elle est conservée en brouillon.');}catch(e){say(e.message);}finally{lock(false);}};card.append(withdraw);}
  $('list').append(card);
 }
 if(!data.length)$('list').textContent='Aucune actualité pour le moment.';
}
async function save(publish){
 if(busy||!$('editor').reportValidity())return;
 const title=$('title').value.trim(),body=$('body').value.trim();
 if(!title||!body){say('Renseigne le titre et le message.');return;}
 lock(true);
 try{
  const payload={title,body,published_at:publish?(selected?.published_at||new Date().toISOString()):null};
  const query=selected?db.from('km16_news').update(payload).eq('id',selected.id):db.from('km16_news').insert(payload);
  const {data,error}=await query.select().single();if(error)throw error;
  selected=data;reset();await load();say(publish?'Actualité publiée dans l’app. Aucun push envoyé à ce stade.':'Brouillon enregistré.');
 }catch(e){say('Enregistrement impossible : '+e.message);}finally{lock(false);}
}
$('editor').onsubmit=e=>{e.preventDefault();save(false);};$('publish').onclick=()=>save(true);
$('new').onclick=()=>{reset();$('title').focus();};$('refresh').onclick=load;
async function state(s){epoch++;reset();$('list').replaceChildren();const admin=s?.user?.email?.toLowerCase()==='alexandre.marchat@gmail.com';$('login').hidden=!!s;$('forbidden').hidden=!s||admin;$('workspace').hidden=!admin;$('password').value='';if(admin)await load();}
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;say('');}catch(e){say(e.message);}finally{button.disabled=false;$('password').value='';}};
async function logout(){await db.auth.signOut();await state(null);}
$('logout').onclick=logout;$('other').onclick=logout;
db.auth.onAuthStateChange((_e,s)=>setTimeout(()=>state(s),0));const {data}=await db.auth.getSession();await state(data.session);
