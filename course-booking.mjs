const $=id=>document.getElementById(id);
const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-course-bookings';
async function call(action,params={}){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...params})});const j=await r.json();if(!r.ok)throw Error(j.error||'Service indisponible');return j}
const iso=d=>new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
let availableSessions=[];
function refreshSessionChoices(){
 const category=$('category-filter').value,previous=$('session').value;
 const filtered=availableSessions.filter(s=>(!category||s.category===category));
 $('session').replaceChildren(new Option('Choisir une séance',''));
 for(const s of filtered)$('session').add(new Option(iso(s.session_date)+' · '+s.start_time.slice(0,5)+' · '+s.category+' · '+s.venue,s.id));
 if(filtered.some(s=>s.id===previous))$('session').value=previous;
 $('submit').disabled=!filtered.length;
 if(!filtered.length)$('status').textContent='Aucune séance disponible pour ces filtres.';
 else if($('status').textContent==='Aucune séance disponible pour ces filtres.')$('status').textContent='';
}
function setSessionFilters(rows){
 availableSessions=rows;
 const categories=[...new Set(rows.map(s=>s.category))].sort((a,b)=>a.localeCompare(b,'fr'));
 for(const category of categories)$('category-filter').add(new Option(category,category));
 $('category-filter').onchange=refreshSessionChoices;
 refreshSessionChoices();
}
async function load(){try{const data=await call('sessions');setSessionFilters(data.sessions);const params=new URLSearchParams(location.search);
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
const param=params.get('session');if(param&&data.sessions.some(s=>s.id===param))$('session').value=param;else if(params.has('jour')&&params.has('debut')&&params.has('categorie')&&params.has('lieu')){const dayNames=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];const normal=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');const time=v=>{const m=String(v||'').match(/^(\d{1,2})[:hH](\d{2})$/);return m?String(Number(m[1])).padStart(2,'0')+':'+m[2]:String(v||'').slice(0,5)};const desired=normal(params.get('jour'));const match=data.sessions.find(s=>normal(dayNames[new Date(s.session_date+'T12:00:00Z').getUTCDay()])===desired&&time(s.start_time)===time(params.get('debut'))&&normal(s.category)===normal(params.get('categorie'))&&normal(s.venue)===normal(params.get('lieu')));if(match)$('session').value=match.id;else $('status').textContent='Aucune prochaine séance disponible pour ce créneau. Vous pouvez choisir une autre séance.';}refreshSessionChoices();if(!data.sessions.length)$('status').textContent='Aucune séance ouverte actuellement. Revenez prochainement.';}catch(e){$('status').textContent='Chargement indisponible. Réessayez plus tard.';}}

function cancellationUrl(token){const u=new URL('./course-booking.html',location.href);u.searchParams.set('cancel',token);return u.href;}
function showCancellation(token){$('token').value=token;$('cancel-form').hidden=false;$('cancel-status').textContent='';$('cancel-panel').scrollIntoView({behavior:'smooth',block:'center'});}
$('book-form').onsubmit=async e=>{
 e.preventDefault();$('submit').disabled=true;$('confirmation').hidden=true;$('status').className='';$('status').textContent='Enregistrement…';
 try{
  const selected=availableSessions.find(s=>s.id===$('session').value);
  const j=await call('book',{session_id:$('session').value,first_name:$('first').value,last_name:$('last').value,email:$('email').value,website:$('website').value});
  const url=cancellationUrl(j.cancellation_token);
  $('booking-summary').textContent=selected?iso(selected.session_date)+' · '+selected.start_time.slice(0,5)+'–'+selected.end_time.slice(0,5)+' · '+selected.category+' · '+selected.venue:'';
  $('status').textContent='Inscription confirmée. Conservez votre lien personnel pour pouvoir annuler.';
  $('cancel-link').href=url;$('token').value=j.cancellation_token;$('confirmation').hidden=false;
  sessionStorage.setItem('km16-last-cancel-link',url);
  $('book-form').hidden=true;
 }catch(err){$('status').textContent=err.message;$('status').className='error';}
 finally{$('submit').disabled=false;}
};
$('new-booking').onclick=()=>{$('confirmation').hidden=true;$('book-form').hidden=false;$('book-form').reset();refreshSessionChoices();$('status').textContent='';$('copy-status').textContent='';$('first').focus();};
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
  $('cancel-status').textContent='Inscription annulée. Votre demande a bien été enregistrée.';
  $('cancel-form').hidden=true;$('confirmation').hidden=true;$('book-form').hidden=false;$('status').textContent='';
  sessionStorage.removeItem('km16-last-cancel-link');
  if(new URLSearchParams(location.search).has('cancel'))history.replaceState(null,'',location.pathname);
 }catch(err){$('cancel-status').textContent=err.message;$('cancel-status').className='error';}
 finally{$('cancel-submit').disabled=false;}
};
const token=new URLSearchParams(location.search).get('cancel');
if(token){showCancellation(token);}
load();
