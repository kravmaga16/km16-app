const $=id=>document.getElementById(id);
const ADMIN='alexandre.marchat@gmail.com';
const supa=window.supabase.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-course-bookings';
let session=null,bookings=[],sessions=[],busy=false;
const status=(msg,error=false)=>{$('status').textContent=msg;$('status').className=error?'status error':'status';};
async function call(action,other={}){
 const {data:{session:current}}=await supa.auth.getSession();if(!current)throw Error('Session expirée');
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action,...other})});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Service indisponible');return j;
}
let view='upcoming';
const todayParis=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateFr=d=>d?d.split('-').reverse().join('/'):'';
function render(){
 const byId=new Map(sessions.map(s=>[s.id,s]));
 const today=todayParis();
 $('active').textContent=bookings.filter(b=>b.status==='Inscrit').length;
 $('cancelled').textContent=bookings.filter(b=>b.status==='Annulé').length;
 $('new').textContent=bookings.filter(b=>!b.read_at).length;
 $('sessions').textContent=sessions.filter(s=>s.enabled&&s.session_date>=today).length;
 $('upcoming').textContent=bookings.filter(b=>b.status==='Inscrit'&&byId.get(b.session_id)?.session_date>=today).length;
 $('today-count').textContent=bookings.filter(b=>b.status==='Inscrit'&&byId.get(b.session_id)?.session_date===today).length;
 const selectedCourse=$('filter-course').value;
 const options=[...new Set(sessions.map(s=>s.category+' · '+s.venue))].sort();
 $('filter-course').replaceChildren(new Option('Tous les cours',''));
 options.forEach(x=>$('filter-course').add(new Option(x,x)));
 $('filter-course').value=selectedCourse;
 const search=$('filter-search').value.trim().toLocaleLowerCase('fr-FR');
 const shown=bookings.filter(b=>{
  const s=byId.get(b.session_id);if(!s)return false;
  if(view==='upcoming'&&s.session_date<today)return false;
  if(view==='new'&&b.read_at)return false;
  if(view==='active'&&b.status!=='Inscrit')return false;
  if(view==='cancelled'&&b.status!=='Annulé')return false;
  return (!$('filter-date').value||s.session_date===$('filter-date').value)&&
   (!$('filter-course').value||s.category+' · '+s.venue===$('filter-course').value)&&
   (!$('filter-status').value||($('filter-status').value==='new'?!b.read_at:b.status===$('filter-status').value))&&
   (!search||[b.first_name,b.last_name,b.email,b.last_name+' '+b.first_name,b.first_name+' '+b.last_name].join(' ').toLocaleLowerCase('fr-FR').includes(search));
 }).sort((a,b)=>{const x=byId.get(a.session_id),y=byId.get(b.session_id);return x.session_date.localeCompare(y.session_date)||x.start_time.localeCompare(y.start_time)||a.last_name.localeCompare(b.last_name,'fr')});
 $('results-count').textContent=shown.length+' inscription(s) affichée(s) · '+(view==='upcoming'?'séances à venir':view==='active'?'inscriptions actives':view==='cancelled'?'annulations':view==='new'?'nouveautés à traiter':'tout l’historique');
 $('rows').replaceChildren();
 for(const b of shown){
  const s=byId.get(b.session_id),tr=document.createElement('tr');
  if(!b.read_at)tr.className='new';
  for(const v of [b.read_at?'Lu':'Nouveau',dateFr(s.session_date)+' · '+s.start_time.slice(0,5)+'–'+s.end_time.slice(0,5),s.category+' · '+s.venue,b.first_name+' '+b.last_name,b.email,b.status]){
   const td=document.createElement('td');td.textContent=v;tr.append(td);
  }
  $('rows').append(tr);
 }
 if(!shown.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='Aucune inscription pour cette sélection';tr.append(td);$('rows').append(tr);}
 $('mark-read').disabled=busy||!shown.some(b=>!b.read_at);
 $('mark-read').onclick=async()=>{try{await call('admin_read',{ids:shown.filter(b=>!b.read_at).map(b=>b.id)});await load();}catch(e){status(e.message,true)}};
 const counts=new Map();
 for(const b of bookings){if(b.status==='Inscrit')counts.set(b.session_id,(counts.get(b.session_id)||0)+1);}
 $('session-rows').replaceChildren();
 const upcoming=sessions.filter(s=>s.enabled&&s.session_date>=today).sort((a,b)=>a.session_date.localeCompare(b.session_date)||a.start_time.localeCompare(b.start_time));
 for(const s of upcoming){
  const tr=document.createElement('tr');
  for(const v of [dateFr(s.session_date)+' · '+s.start_time.slice(0,5),s.category,s.venue,String(counts.get(s.id)||0)]){
   const td=document.createElement('td');td.textContent=v;tr.append(td);
  }
  $('session-rows').append(tr);
 }
 if(!upcoming.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='Aucune séance future';tr.append(td);$('session-rows').append(tr);}
 for(const [id,value] of [['show-new','new'],['show-upcoming','upcoming'],['show-active','active'],['show-cancelled','cancelled'],['show-all','all']]){
  $(id).classList.toggle('primary',view===value);$(id).setAttribute('aria-pressed',String(view===value));
 }
}
async function load(){if(busy||!session)return;busy=true;try{const data=await call('admin_list');bookings=data.bookings;sessions=data.sessions;$('updated').textContent='Mis à jour à '+new Date().toLocaleTimeString('fr-FR')+' · Actualisation toutes les 30 secondes';status('');}catch(e){status(e.message,true)}finally{busy=false;render();}}
async function authState(s){session=s;const admin=s?.user?.email?.toLowerCase()===ADMIN;$('login').hidden=!!s;$('workspace').hidden=!admin;$('identity').textContent=admin?s.user.email:'';if(s&&!admin)$('global-status').textContent='Accès réservé à l’administrateur KM16';if(admin)await load();}
$('login-form').onsubmit=async e=>{e.preventDefault();try{const {error}=await supa.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;}catch(e){$('global-status').textContent=e.message}finally{$('password').value=''}};
$('logout').onclick=()=>supa.auth.signOut();
for(const id of ['filter-date','filter-course','filter-status'])$(id).onchange=render;
$('filter-search').oninput=render;
for(const [id,value] of [['show-new','new'],['show-upcoming','upcoming'],['show-active','active'],['show-cancelled','cancelled'],['show-all','all']])$(id).onclick=()=>{view=value;render();};
$('reset').onclick=()=>{for(const id of ['filter-date','filter-course','filter-status','filter-search'])$(id).value='';view='upcoming';render()};
$('refresh').onclick=load;
$('session-form').onsubmit=async e=>{e.preventDefault();const date=$('session-date').value,category=$('session-category').value.trim(),start=$('session-start').value,end=$('session-end').value,venue=$('session-venue').value.trim();try{await call('admin_session',{session_date:date,course_key:JSON.stringify([category,start,end,venue]),category,start_time:start,end_time:end,venue});status('Séance ajoutée.');await load();}catch(e){status(e.message,true)}};
supa.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>authState(s),0)});
const {data}=await supa.auth.getSession();await authState(data.session);
setInterval(()=>{if(!document.hidden)load()},30000);
