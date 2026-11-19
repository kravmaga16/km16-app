const $=id=>document.getElementById(id);
const account=window.supabase?.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
async function accountSession(){
 const result=await account?.auth.getSession();
 const s=result?.data?.session;
 return s?.user?.email_confirmed_at&&!s.user.is_anonymous?s:null;
}
let participants = [];
let participantOwner;
function chooseParticipant() {
 const participant = participants[$('participant').value];
 const useSavedName = Boolean(participant);
 $('first').value = participant?.first_name ?? '';
 $('last').value = participant?.last_name ?? '';
 $('first-label').hidden = $('last-label').hidden = useSavedName;
}
$('participant').onchange = chooseParticipant;

void accountSession().then(async session => {
 if (!session) return;
 $('email').value = session.user.email;
 $('email').readOnly = true;
 const {data, error} = await account.rpc('km16_my_course_bookings', {p_cancel: null});
 if (error || !Array.isArray(data)) return;

 const distinct = new Map();
 for (const {first_name, last_name} of data) {
  if (!first_name || !last_name) continue;
  const key = JSON.stringify([first_name.trim(), last_name.trim()]).toLocaleLowerCase('fr');
  distinct.set(key, {first_name, last_name});
 }
 participants = [...distinct.values()];
 participantOwner = session.user.id;
 if (!participants.length) return;
 const options = participants.map(({first_name, last_name}, index) =>
  new Option(first_name + ' ' + last_name, String(index)));
 $('participant').replaceChildren(new Option('Choisir un participant', ''), ...options,
  new Option('Saisir un autre participant', 'manual'));
 $('participant-choice').hidden = false;
}).catch(() => {});

const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-course-bookings';
async function call(action,params={},token=''){
 const controller=action==='sessions'?new AbortController():null;
 const timeout=controller?setTimeout(()=>controller.abort(),15000):null;
 try{
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,...params}),signal:controller?.signal});
  const j=await r.json();
  if(!r.ok)throw Error(j.error||'Service indisponible');
  return j;
 }catch(e){
  if(e?.name==='AbortError')throw Error('Le chargement prend trop de temps. Réessayez.');
  throw e;
 }finally{if(timeout!==null)clearTimeout(timeout);}
}
const todayParis=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const scrollBehavior=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
const iso=d=>new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
let availableSessions=[];
function refreshSessionChoices(){
 const category=$('category-filter').value,previous=$('session').value;
 const filtered=availableSessions.filter(s=>s.session_date>=todayParis()&&(!category||s.category===category));
 $('session').replaceChildren(new Option('Choisir une séance',''));
 for(const s of filtered)$('session').add(new Option(iso(s.session_date)+' · '+s.start_time.slice(0,5)+' · '+s.category+' · '+s.venue,s.id));
 if(filtered.some(s=>s.id===previous))$('session').value=previous;
 $('submit').disabled=!$('session').value;
 if(!filtered.length)$('status').textContent='Aucune séance disponible pour ces filtres.';
 else if($('status').textContent==='Aucune séance disponible pour ces filtres.')$('status').textContent='';
}
function setSessionFilters(rows){
 availableSessions=rows.filter(s=>s.session_date>=todayParis());
 $('category-filter').replaceChildren(new Option('Toutes les catégories',''));
 const categories=[...new Set(availableSessions.map(s=>s.category))].sort((a,b)=>a.localeCompare(b,'fr'));
 for(const category of categories)$('category-filter').add(new Option(category,category));
 $('category-filter').onchange=refreshSessionChoices;
 $('session').onchange=()=>{$('submit').disabled=!$('session').value;};
 refreshSessionChoices();
}
let loadingSessions=false;
async function load(){
 if(loadingSessions)return;
 loadingSessions=true;
 $('retry-load').hidden=true;
 $('session').disabled=true;
 $('submit').disabled=true;
 $('status').className='';
 $('status').textContent='Chargement des séances disponibles…';
 try{const data=await call('sessions');if(!Array.isArray(data.sessions))throw Error('Réponse invalide');setSessionFilters(data.sessions);const params=new URLSearchParams(location.search);
const group=params.get('groupe');
if(group){
 const normalizeGroup=v=>String(v||'').toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const categoryMatches=(category)=>{
  const v=normalizeGroup(category);
  if(group==='Enfants')return v.includes('enfant');
  if(group==='Adolescents')return v.includes('ado');
  if(group==='Préparation noire et plus')return v.includes('adulte')&&(/noir|preparation/.test(v));
  if(group==='Adultes tous niveaux')return v.includes('adulte')&&!(/noir|preparation/.test(v));
  return false;
 };
 const matchingCategories=[...new Set(data.sessions.filter(x=>categoryMatches(x.category)).map(x=>x.category))];
 if(matchingCategories.length===1){
  $('category-filter').value=matchingCategories[0];
  refreshSessionChoices();
 }else if(matchingCategories.length>1){
  availableSessions=data.sessions.filter(x=>categoryMatches(x.category));
  $('category-filter').replaceChildren(new Option(group,''));
  refreshSessionChoices();
 }
}
const param=params.get('session');if(param&&availableSessions.some(s=>s.id===param))$('session').value=param;else if(params.has('jour')&&params.has('debut')&&params.has('categorie')&&params.has('lieu')){const dayNames=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];const normal=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');const time=v=>{const m=String(v||'').match(/^(\d{1,2})[:hH](\d{2})$/);return m?String(Number(m[1])).padStart(2,'0')+':'+m[2]:String(v||'').slice(0,5)};const desired=normal(params.get('jour'));const match=availableSessions.find(s=>normal(dayNames[new Date(s.session_date+'T12:00:00Z').getUTCDay()])===desired&&time(s.start_time)===time(params.get('debut'))&&normal(s.category)===normal(params.get('categorie'))&&normal(s.venue)===normal(params.get('lieu')));if(match)$('session').value=match.id;else $('status').textContent='Aucune prochaine séance disponible pour ce créneau. Vous pouvez choisir une autre séance.';}$('submit').disabled=!$('session').value;if(!data.sessions.length)$('status').textContent='Aucune séance ouverte actuellement. Revenez prochainement.';
 else if($('status').textContent==='Chargement des séances disponibles…')$('status').textContent='';
 }catch(e){$('status').className='error';$('status').textContent='Impossible de charger les séances. Vérifiez votre connexion et réessayez.';$('retry-load').hidden=false;}
 finally{loadingSessions=false;$('session').disabled=false;}
}

function cancellationUrl(token){const u=new URL('./course-booking.html',location.href);u.searchParams.set('cancel',token);return u.href;}
function showCancellation(token){$('token').value=token;$('cancel-form').hidden=false;$('cancel-status').textContent='';$('cancel-panel').scrollIntoView({behavior:scrollBehavior(),block:'center'});}
$('book-form').onsubmit=async e=>{
 e.preventDefault();$('submit').disabled=true;$('confirmation').hidden=true;$('status').className='';$('status').textContent='Enregistrement de votre inscription…';
 try{
  const selected=availableSessions.find(s=>s.id===$('session').value);
  if(!selected)throw Error('Veuillez choisir une séance avant de confirmer.');
  const participant = participants[$('participant').value];
  const booking = {session_id:selected.id, first_name:$('first').value,
   last_name:$('last').value, email:$('email').value, website:$('website').value};
  const activeAccount = await accountSession();
  if (participant && activeAccount?.user.id !== participantOwner) {
   participants = [];
   $('participant-choice').hidden = true;
   $('participant').value = '';
   chooseParticipant();
   $('email').value = activeAccount?.user.email ?? '';
   $('email').readOnly = Boolean(activeAccount);
   throw Error('Votre compte a changé. Renseignez le participant puis réessayez.');
  }
  const j=await call('book',booking,activeAccount?.access_token);
  const url=cancellationUrl(j.cancellation_token);
  $('booking-summary').textContent=selected?iso(selected.session_date)+' · '+selected.start_time.slice(0,5)+'–'+selected.end_time.slice(0,5)+' · '+selected.category+' · '+selected.venue:'';
  $('status').textContent='Votre place est réservée ! '+(j.account_booking?'Retrouvez la séance dans Mes réservations.':'Conservez votre lien d’annulation ci-dessous.');
  $('cancel-link').href=url;$('token').value=j.cancellation_token;$('confirmation').hidden=false;
  $('new-booking').textContent = participants.length ? 'Inscrire une autre personne à cette séance' : 'Réserver une autre séance';
  sessionStorage.setItem('km16-last-cancel-link',url);
  $('book-form').hidden=true;
  $('confirmation').scrollIntoView({behavior:scrollBehavior(),block:'start'});
 }catch(err){$('status').textContent=err.message;$('status').className='error';}
 finally{$('submit').disabled=!$('session').value||$('book-form').hidden;}
};
$('new-booking').onclick = () => {
 $('confirmation').hidden = true;
 $('book-form').hidden = false;
 if (participants.length) {
  $('participant').value = '';
  chooseParticipant();
 } else {
  $('session').value = '';
 }
 refreshSessionChoices();
 $('status').textContent = '';
 $('copy-status').textContent = '';
 $(participants.length ? 'participant' : 'session').focus();
};
$('copy-link').onclick=async()=>{
 const url=$('cancel-link').href;
 try{await navigator.clipboard.writeText(url);$('copy-status').textContent='Lien copié. Conservez-le dans un endroit privé.';}
 catch{$('copy-status').textContent='Copie automatique indisponible : utilisez le lien « Ouvrir la page d’annulation » pour le conserver.';}
};
$('cancel-link').onclick=e=>{e.preventDefault();const token=new URL(e.currentTarget.href).searchParams.get('cancel');if(token)showCancellation(token);};
$('cancel-back').onclick=()=>{$('cancel-form').hidden=true;$('cancel-status').textContent='Votre inscription est conservée.';};
$('cancel-form').onsubmit=async e=>{
 e.preventDefault();const token=$('token').value;if(!token)return;
 $('cancel-submit').disabled=true;$('cancel-status').className='';$('cancel-status').textContent='Annulation en cours…';
 try{
  await call('cancel',{token});
  $('cancel-status').textContent='Votre inscription est annulée. Vous pouvez réserver une autre séance si vous le souhaitez.';
  $('cancel-form').hidden=true;$('confirmation').hidden=true;$('book-form').hidden=false;$('status').textContent='';
  $('cancel-status').scrollIntoView({behavior:scrollBehavior(),block:'center'});
  sessionStorage.removeItem('km16-last-cancel-link');
  if(new URLSearchParams(location.search).has('cancel'))history.replaceState(null,'',location.pathname);
 }catch(err){$('cancel-status').textContent=err.message;$('cancel-status').className='error';}
 finally{$('cancel-submit').disabled=false;}
};
$('retry-load').onclick=load;
const token=new URLSearchParams(location.search).get('cancel');
if(token){history.replaceState(null,'',location.pathname);showCancellation(token);}
load();
