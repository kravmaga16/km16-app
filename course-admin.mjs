const $=id=>document.getElementById(id);
const ADMIN='alexandre.marchat@gmail.com';
const supa=window.supabase.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-course-bookings';
let session=null,bookings=[],sessions=[],busy=false,attendance=new Map(),memberLinks=new Map(),externalLinks=new Map();
const status=(msg,error=false)=>{$('status').textContent=msg;$('status').className=error?'status error':'status';};
async function call(action,other={}){
 const {data:{session:current}}=await supa.auth.getSession();if(!current)throw Error('Session expirée');
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action,...other})});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Service indisponible');return j;
}
let memberDialogBooking=null,memberDialogChoices=[],memberDialogSelected=null,memberDialogRequest=0,memberDialogSaving=false;
const memberDialog=$('member-dialog');
const memberConfirm=$('member-dialog-confirm'),memberCheck=$('member-identity-check');
function updateMemberConfirm(){memberConfirm.disabled=memberDialogSaving||!memberDialogSelected||!memberCheck.checked;}
function renderMemberChoices(){
 const query=$('member-candidate-search').value.trim().toLocaleLowerCase('fr-FR');const list=$('member-candidate-options');list.replaceChildren();
 const shown=memberDialogChoices.filter(c=>[c.first_name,c.last_name,c.email,c.season_id,c.title,c.birth_date,c.source].join(' ').toLocaleLowerCase('fr-FR').includes(query));
 $('member-candidate-count').textContent=shown.length+' dossier(s) correspondant à la recherche';
 for(const c of shown){const button=document.createElement('button');button.type='button';button.className='member-option';button.setAttribute('aria-pressed',String(memberDialogSelected?.order_id===c.order_id));
 const strong=document.createElement('strong');strong.textContent=[c.first_name,c.last_name].filter(Boolean).join(' ');const detail=document.createElement('small');detail.textContent=[c.birth_date?'Naissance : '+c.birth_date.split('-').reverse().join('/'):'Naissance non renseignée',c.email||'E-mail non renseigné','Saison '+(c.season_id||'non renseignée'),c.title||'Adhésion',c.source||'KM16'].join(' · ');button.append(strong,detail);
 button.onclick=()=>{memberDialogSelected=c;memberCheck.checked=false;$('member-identity-check-wrap').hidden=false;renderMemberChoices();const exact=(c.first_name||'').trim().toLocaleLowerCase('fr-FR')===(memberDialogBooking.first_name||'').trim().toLocaleLowerCase('fr-FR');$('member-selection-warning').textContent=exact?'Vérifiez l’identité avant de confirmer.':'Prénoms différents : vérifiez impérativement l’identité et les coordonnées avant l’association.';updateMemberConfirm();};list.append(button);}
}
async function openMemberDialog(b,linked){
 const request=++memberDialogRequest;memberDialogBooking=b;memberDialogChoices=[];memberDialogSelected=null;memberDialogSaving=false;
 $('member-booking-info').textContent='Réservation : '+b.first_name+' '+b.last_name+' · '+b.email;
 $('member-candidate-search').value='';$('member-selection-warning').textContent='';$('member-candidate-count').textContent='Recherche des dossiers…';$('member-candidate-options').replaceChildren();memberCheck.checked=false;$('member-identity-check-wrap').hidden=true;updateMemberConfirm();$('member-dialog-unlink').hidden=!linked;
 $('member-current-link').textContent=linked?'Dossier actuellement associé : '+linked:'Aucun dossier actuellement associé.';
 if(!memberDialog.open)memberDialog.showModal();
 try{const [{data,error},{data:external,error:externalError}]=await Promise.all([supa.rpc('km16_admin_member_candidates',{p_booking_id:b.id}),supa.rpc('km16_admin_external_candidates',{p_booking_id:b.id})]);if(externalError)throw externalError;if(request!==memberDialogRequest||!memberDialog.open||memberDialogBooking!==b)return;
  if(error)throw error;memberDialogChoices=[...(data||[]).map(c=>({...c,source:'KM16'})),...(external||[]).map(c=>({...c,order_id:'external:'+c.external_id+':'+c.season_id,source:c.source||'Import',external_key:c.external_id}))];renderMemberChoices();if(!memberDialogChoices.length)$('member-selection-warning').textContent='Aucun dossier KM16 ou importé compatible trouvé. Vérifiez le nom et les coordonnées dans le fichier adhérents.';
 }catch(e){if(request===memberDialogRequest&&memberDialog.open)$('member-candidate-count').textContent='Recherche impossible : '+e.message;}
}
async function saveMemberLink(id){const b=memberDialogBooking;if(!b||memberDialogSaving)return;if(id&&(!memberDialogSelected||!memberCheck.checked))return;memberDialogSaving=true;updateMemberConfirm();$('member-dialog-unlink').disabled=true;
 try{if(id&&((memberLinks.get(b.id)||externalLinks.get(b.id))===id)){memberDialog.close();status('Ce dossier est déjà associé à cette réservation. Aucune modification nécessaire.');return;}if(!id){const [a,z]=await Promise.all([supa.from('km16_booking_member_links').delete().eq('booking_id',b.id),supa.from('km16_booking_external_links').delete().eq('booking_id',b.id)]);if(a.error||z.error)throw a.error||z.error;memberLinks.delete(b.id);externalLinks.delete(b.id);}else if(memberDialogSelected?.external_key){const {data:{user}}=await supa.auth.getUser();if(!user)throw Error('Session expirée');if(memberLinks.has(b.id)||externalLinks.has(b.id))throw Error('Retirez d’abord l’association existante');const {error}=await supa.from('km16_booking_external_links').upsert({booking_id:b.id,external_id:memberDialogSelected.external_key,season_id:memberDialogSelected.season_id,linked_by:user.id},{onConflict:'booking_id'});if(error)throw error;externalLinks.set(b.id,id);}else{if(externalLinks.has(b.id))throw Error('Retirez d’abord le dossier importé existant');const {data:{user}}=await supa.auth.getUser();if(!user)throw Error('Session expirée');const {error}=await supa.from('km16_booking_member_links').upsert({booking_id:b.id,membership_order_id:id,linked_by:user.id,linked_at:new Date().toISOString()},{onConflict:'booking_id'});if(error)throw error;memberLinks.set(b.id,id);}memberDialog.close();status(id?'Dossier associé après vérification manuelle.':'Association retirée.');render();}catch(e){$('member-selection-warning').textContent='Enregistrement impossible : '+e.message;}finally{memberDialogSaving=false;$('member-dialog-unlink').disabled=false;updateMemberConfirm();}
}
$('member-candidate-search').oninput=renderMemberChoices;
memberCheck.onchange=updateMemberConfirm;
$('member-dialog-cancel').onclick=()=>{if(!memberDialogSaving)memberDialog.close();};
$('member-dialog-unlink').onclick=()=>saveMemberLink('');
memberConfirm.onclick=()=>{if(memberDialogSelected)saveMemberLink(memberDialogSelected.order_id);};
memberDialog.addEventListener('cancel',e=>{if(memberDialogSaving)e.preventDefault();});
memberDialog.addEventListener('close',()=>{memberDialogRequest++;memberDialogBooking=null;memberDialogChoices=[];memberDialogSelected=null;memberCheck.checked=false;});
const requestedView=new URLSearchParams(location.search).get('view');
let view=['unlinked','attendance-pending'].includes(requestedView)?requestedView:'upcoming',selectedSessionId=null,showAllSessions=false,quickDateRange=null,sessionPendingOnly=false,sessionUnlinkedOnly=false,sessionAbsentOnly=false;
if(view!=='upcoming')$('filter-season').value='';
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
 $('unlinked-count').textContent=bookings.filter(b=>b.status==='Inscrit'&&!memberLinks.has(b.id)&&!externalLinks.has(b.id)).length;
 $('attendance-pending-count').textContent=bookings.filter(b=>b.status==='Inscrit'&&byId.get(b.session_id)?.session_date<today&&!attendance.has(b.id)).length;
 $('course-priority-summary').textContent=$('unlinked-count').textContent+' inscription(s) sans dossier · '+$('attendance-pending-count').textContent+' présence(s) à compléter · '+$('new').textContent+' nouveauté(s) non lue(s).';
 const selectedCourse=$('filter-course').value;
 const options=[...new Set(sessions.map(s=>s.category+' · '+s.venue))].sort((a,b)=>a.localeCompare(b,'fr'));
 $('filter-course').replaceChildren(new Option('Tous les cours',''));
 options.forEach(x=>$('filter-course').add(new Option(x,x)));
 $('filter-course').value=selectedCourse;
 const search=$('filter-search').value.trim().toLocaleLowerCase('fr-FR');
 const shown=bookings.filter(b=>{
  const s=byId.get(b.session_id);if(!s)return false;
  if(selectedSessionId&&b.session_id!==selectedSessionId)return false;
  if(selectedSessionId&&sessionPendingOnly&&(b.status!=='Inscrit'||attendance.has(b.id)))return false;
  if(selectedSessionId&&sessionAbsentOnly&&(b.status!=='Inscrit'||attendance.get(b.id)!==false))return false;
  if(selectedSessionId&&sessionUnlinkedOnly&&(b.status!=='Inscrit'||memberLinks.has(b.id)||externalLinks.has(b.id)))return false;
  if(view==='upcoming'&&(s.session_date<today||b.status!=='Inscrit'))return false;
  if(view==='new'&&b.read_at)return false;
  if(view==='active'&&b.status!=='Inscrit')return false;
  if(view==='cancelled'&&b.status!=='Annulé')return false;
  if(view==='unlinked'&&(b.status!=='Inscrit'||memberLinks.has(b.id)||externalLinks.has(b.id)))return false;
  if(view==='attendance-pending'&&(b.status!=='Inscrit'||s.session_date>=today||attendance.has(b.id)))return false;
  const season=$('filter-season').value;const inSeason=!season||(season==='2026/2027'?s.session_date>='2026-09-07'&&s.session_date<='2027-06-24':season==='2027/2028'?s.session_date>='2027-09-06'&&s.session_date<'2028-09-01':true);
  return inSeason&&(!quickDateRange||(s.session_date>=quickDateRange[0]&&s.session_date<=quickDateRange[1]))&&(!$('filter-date').value||s.session_date===$('filter-date').value)&&
   (!$('filter-course').value||s.category+' · '+s.venue===$('filter-course').value)&&
   (!$('filter-status').value||($('filter-status').value==='new'?!b.read_at:b.status===$('filter-status').value))&&
   (!search||[b.first_name,b.last_name,b.email,b.last_name+' '+b.first_name,b.first_name+' '+b.last_name].join(' ').toLocaleLowerCase('fr-FR').includes(search));
 }).sort((a,b)=>{const x=byId.get(a.session_id),y=byId.get(b.session_id);return x.session_date.localeCompare(y.session_date)||x.start_time.localeCompare(y.start_time)||a.last_name.localeCompare(b.last_name,'fr')});
 const focused=sessions.find(s=>s.id===selectedSessionId);
 $('session-edit').disabled=$('session-cancel').disabled=!focused?.enabled||focused.session_date<today;
 $('session-focus').hidden=!focused;
 $('session-focus-label').textContent=focused?'Séance sélectionnée : '+dateFr(focused.session_date)+' · '+focused.start_time.slice(0,5)+' · '+focused.category+' · '+focused.venue:'';
 $('results-count').textContent=shown.length+' inscription(s) affichée(s) · '+(view==='upcoming'?'séances à venir':view==='active'?'inscriptions actives':view==='cancelled'?'annulations':view==='new'?'nouveautés à traiter':view==='unlinked'?'inscriptions sans dossier':view==='attendance-pending'?'présences passées à renseigner':'tout l’historique');
 $('print-roster').disabled=!selectedSessionId||!shown.some(b=>b.status==='Inscrit');
 const bulkCandidates=selectedSessionId?bookings.filter(b=>b.session_id===selectedSessionId&&b.status==='Inscrit'&&!attendance.has(b.id)):[];
 $('session-bulk-tools').hidden=!selectedSessionId;
 $('session-bulk-summary').textContent=selectedSessionId?bulkCandidates.length+' présence(s) non renseignée(s) sur '+bookings.filter(b=>b.session_id===selectedSessionId&&b.status==='Inscrit').length+' inscription(s) active(s).':'';
 const sessionActive=selectedSessionId?bookings.filter(b=>b.session_id===selectedSessionId&&b.status==='Inscrit'):[];
 $('session-total').textContent=String(sessionActive.length);
 $('session-present').textContent=String(sessionActive.filter(b=>attendance.get(b.id)===true).length);
 $('session-absent').textContent=String(sessionActive.filter(b=>attendance.get(b.id)===false).length);
 $('session-unrecorded').textContent=String(sessionActive.filter(b=>!attendance.has(b.id)).length);
 $('session-unlinked').textContent=String(sessionActive.filter(b=>!memberLinks.has(b.id)).length);
 const recorded=sessionActive.filter(b=>attendance.has(b.id)).length;
 $('session-attendance-progress').textContent=selectedSessionId?'Émargement : '+recorded+' / '+sessionActive.length+' renseigné(s) ('+(sessionActive.length?Math.round(100*recorded/sessionActive.length):100)+' %).':'Sélectionnez une séance.';
 $('session-only-absent').disabled=!selectedSessionId||sessionAbsentOnly;
 $('session-only-pending').disabled=!selectedSessionId||sessionPendingOnly;
 $('session-only-unlinked').disabled=!selectedSessionId||sessionUnlinkedOnly;
 $('session-show-all').disabled=!selectedSessionId||(!sessionPendingOnly&&!sessionUnlinkedOnly);
 $('session-copy-summary').disabled=!selectedSessionId;
 $('session-mark-present').disabled=!bulkCandidates.length||busy;
 $('session-mark-absent').disabled=!bulkCandidates.length||busy;
 $('rows').replaceChildren();
 for(const b of shown){
  const s=byId.get(b.session_id),tr=document.createElement('tr');
  if(!b.read_at)tr.className='new';
  for(const v of [b.read_at?'Lu':'Nouveau',dateFr(s.session_date)+' · '+s.start_time.slice(0,5)+'–'+s.end_time.slice(0,5),s.category+' · '+s.venue,b.first_name+' '+b.last_name,b.email,b.status]){
   const td=document.createElement('td');td.textContent=v;tr.append(td);
  }
  const presence=document.createElement('td');
  if(b.status==='Inscrit'){
   const select=document.createElement('select');select.setAttribute('aria-label','Présence de '+b.first_name+' '+b.last_name);
   for(const [value,label] of [['','Non renseignée'],['true','Présent'],['false','Absent']])select.add(new Option(label,value));
   select.value=attendance.has(b.id)?String(attendance.get(b.id)):'';
   select.onchange=async()=>{
    const previous=attendance.has(b.id)?String(attendance.get(b.id)):'';select.disabled=true;
    try{
     if(select.value===''){
      const {error}=await supa.from('km16_course_attendance').delete().eq('booking_id',b.id);if(error)throw error;const {data:remaining,error:checkError}=await supa.from('km16_course_attendance').select('booking_id').eq('booking_id',b.id);if(checkError)throw checkError;if(remaining?.length)throw Error('La présence existe toujours dans la base');attendance.delete(b.id);
     }else{
      const {data:{user}}=await supa.auth.getUser();if(!user)throw Error('Session expirée');
      const value=select.value==='true';const {error}=await supa.from('km16_course_attendance').upsert({booking_id:b.id,present:value,recorded_by:user.id,recorded_at:new Date().toISOString()},{onConflict:'booking_id'});if(error)throw error;const {data:verified,error:checkError}=await supa.from('km16_course_attendance').select('present').eq('booking_id',b.id).maybeSingle();if(checkError)throw checkError;if(!verified||verified.present!==value)throw Error('La présence n’a pas été confirmée dans la base');attendance.set(b.id,value);
     }
     status('Présence enregistrée pour '+b.first_name+' '+b.last_name+'.');render();
    }catch(e){select.value=previous;status('Enregistrement de présence impossible : '+e.message,true);}finally{select.disabled=false;}
   };
   presence.append(select);
  }else presence.textContent='—';
  tr.append(presence);
  const linkCell=document.createElement('td');const linked=memberLinks.get(b.id)||externalLinks.get(b.id);
  const linkButton=document.createElement('button');linkButton.type='button';linkButton.textContent=linked?'Dossier associé · Modifier':'Associer un dossier';
  linkButton.setAttribute('aria-label','Associer la réservation de '+b.first_name+' '+b.last_name+' à un dossier adhérent');
  linkButton.onclick=()=>openMemberDialog(b,linked);
  linkCell.append(linkButton);tr.append(linkCell);
  const follow=document.createElement('td');const flags=[];if(b.status==='Inscrit'&&!memberLinks.has(b.id))flags.push('Dossier à associer');if(b.status==='Inscrit'&&s.session_date<today&&!attendance.has(b.id))flags.push('Présence à saisir');const label=document.createElement('span');label.className='km16-state '+(flags.length?'pending':'done');label.textContent=flags.length?flags.join(' · '):b.status==='Annulé'?'Annulée':'À jour';follow.append(label);tr.append(follow);
  [...tr.children].forEach((td,i)=>td.dataset.label=['État','Date / horaire','Cours / lieu','Pratiquant','E-mail','Statut','Présence','Fiche adhérent','Suivi'][i]||'');
  $('rows').append(tr);
 }
 if(!shown.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=9;td.textContent='Aucune inscription pour cette sélection';tr.append(td);$('rows').append(tr);}
 $('mark-read').disabled=busy||!shown.some(b=>!b.read_at);
 $('mark-read').onclick=async()=>{if(busy)return;const ids=shown.filter(b=>!b.read_at).map(b=>b.id);if(!ids.length)return;$('mark-read').disabled=true;try{await call('admin_read',{ids});await load();}catch(e){status(e.message,true);$('mark-read').disabled=false;}};
 const counts=new Map();
 for(const b of bookings){if(b.status==='Inscrit')counts.set(b.session_id,(counts.get(b.session_id)||0)+1);}
 $('session-rows').replaceChildren();
 const allUpcoming=sessions.filter(s=>s.enabled&&s.session_date>=today).sort((a,b)=>a.session_date.localeCompare(b.session_date)||a.start_time.localeCompare(b.start_time));
 const endDate=new Date(today+'T12:00:00Z');endDate.setUTCDate(endDate.getUTCDate()+13);
 const endIso=endDate.toISOString().slice(0,10);
 const upcoming=showAllSessions?allUpcoming:allUpcoming.filter(s=>s.session_date<=endIso);
 $('session-range-info').textContent=showAllSessions?'Toutes les séances à venir · '+upcoming.length:'14 prochains jours · '+upcoming.length+' séance(s)';
 $('toggle-session-range').textContent=showAllSessions?'Afficher les 14 prochains jours':'Afficher toutes les séances à venir';
 for(const s of upcoming){
  const tr=document.createElement('tr');
  for(const v of [dateFr(s.session_date)+' · '+s.start_time.slice(0,5),s.category,s.venue,String(counts.get(s.id)||0)]){
   const td=document.createElement('td');td.textContent=v;tr.append(td);
  }
  const actionCell=document.createElement('td');
  const button=document.createElement('button');button.type='button';button.className='session-open';
  button.textContent='Voir les inscrits';
  button.setAttribute('aria-label','Voir les inscrits du '+dateFr(s.session_date)+' '+s.start_time.slice(0,5)+' '+s.category);
  button.onclick=()=>{
    selectedSessionId=s.id;view='all';
    for(const id of ['filter-date','filter-course','filter-status','filter-search'])$(id).value='';
    render();
    $('bookings-panel').scrollIntoView({behavior:'smooth',block:'start'});
  };
  actionCell.append(button);tr.append(actionCell);
  if(s.id===selectedSessionId)tr.classList.add('session-selected');
  $('session-rows').append(tr);
 }
 if(!upcoming.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='Aucune séance future';tr.append(td);$('session-rows').append(tr);}
 for(const [id,value] of [['show-new','new'],['show-upcoming','upcoming'],['show-active','active'],['show-cancelled','cancelled'],['show-all','all'],['show-unlinked','unlinked'],['show-attendance-pending','attendance-pending']]){
  $(id).classList.toggle('primary',view===value);$(id).setAttribute('aria-pressed',String(view===value));
 }
}
async function load(){if(busy||!session)return;busy=true;try{const data=await call('admin_list');bookings=data.bookings;sessions=data.sessions;const attendanceResult=await supa.from('km16_course_attendance').select('booking_id,present');if(attendanceResult.error)throw attendanceResult.error;attendance=new Map((attendanceResult.data||[]).map(row=>[row.booking_id,row.present]));const linksResult=await supa.from('km16_booking_member_links').select('booking_id,membership_order_id');if(linksResult.error)throw linksResult.error;memberLinks=new Map((linksResult.data||[]).map(row=>[row.booking_id,row.membership_order_id]));const externalResult=await supa.from('km16_booking_external_links').select('booking_id,external_id,season_id');if(externalResult.error)throw externalResult.error;externalLinks=new Map((externalResult.data||[]).map(row=>[row.booking_id,'external:'+row.external_id+':'+row.season_id]));$('updated').textContent='Mis à jour à '+new Date().toLocaleTimeString('fr-FR')+' · Actualisation toutes les 30 secondes';status('');}catch(e){status(e.message,true)}finally{busy=false;render();}}
async function authState(s){session=s;const admin=s?.user?.email?.toLowerCase()===ADMIN;$('login').hidden=!!s;$('workspace').hidden=!admin;$('identity').textContent=admin?s.user.email:'';if(s&&!admin)$('global-status').textContent='Accès réservé à l’administrateur KM16';if(admin)await load();}
$('login-form').onsubmit=async e=>{e.preventDefault();try{const {error}=await supa.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;}catch(e){$('global-status').textContent=e.message}finally{$('password').value=''}};
$('logout').onclick=()=>supa.auth.signOut();
for(const id of ['filter-season','filter-date','filter-course','filter-status'])$(id).onchange=render;
$('filter-search').oninput=render;
for(const [id,value] of [['show-new','new'],['show-upcoming','upcoming'],['show-active','active'],['show-cancelled','cancelled'],['show-all','all'],['show-unlinked','unlinked'],['show-attendance-pending','attendance-pending']])$(id).onclick=()=>{view=value;selectedSessionId=null;render();};
$('clear-session-focus').onclick=()=>{selectedSessionId=null;sessionPendingOnly=false;sessionUnlinkedOnly=false;view='upcoming';render();};
async function bulkAttendance(present){
 if(!selectedSessionId||busy)return;
 const selected=sessions.find(s=>s.id===selectedSessionId);if(!selected)return;
 if(selected.session_date>todayParis()){status('Le pointage collectif est réservé aux séances du jour ou passées.',true);return;}
 const pending=bookings.filter(b=>b.session_id===selectedSessionId&&b.status==='Inscrit'&&!attendance.has(b.id));if(!pending.length)return;
 const label=present?'Présent':'Absent';if(!confirm('Confirmer « '+label+' » pour '+pending.length+' inscription(s) non renseignée(s) du '+dateFr(selected.session_date)+' ? Les présences déjà saisies seront conservées.'))return;
 $('session-mark-present').disabled=true;$('session-mark-absent').disabled=true;
 try{const {data:{user}}=await supa.auth.getUser();if(!user)throw Error('Session expirée');
  const rows=pending.map(b=>({booking_id:b.id,present,recorded_by:user.id,recorded_at:new Date().toISOString()}));
  const {error}=await supa.from('km16_course_attendance').upsert(rows,{onConflict:'booking_id',ignoreDuplicates:true});if(error)throw error;
  const check=await supa.from('km16_course_attendance').select('booking_id,present').in('booking_id',pending.map(b=>b.id));if(check.error)throw check.error;
  for(const entry of check.data||[])attendance.set(entry.booking_id,entry.present);
  const confirmed=(check.data||[]).filter(x=>x.present===present).length;
  status(confirmed+' présence(s) confirmée(s) dans la base : '+label+(confirmed<pending.length?' · Certaines étaient déjà renseignées ou ont été modifiées entre-temps.':''));render();
 }catch(e){status('Pointage collectif impossible : '+e.message,true);await load();}
}
$('session-only-absent').onclick=()=>{sessionAbsentOnly=true;sessionPendingOnly=false;sessionUnlinkedOnly=false;view='all';$('filter-date').value='';quickDateRange=null;render();};
$('session-only-pending').onclick=()=>{sessionAbsentOnly=false;sessionUnlinkedOnly=false;sessionPendingOnly=true;view='all';$('filter-date').value='';quickDateRange=null;render();};
$('session-only-unlinked').onclick=()=>{sessionAbsentOnly=false;sessionPendingOnly=false;sessionUnlinkedOnly=true;view='all';$('filter-date').value='';quickDateRange=null;render();};
$('session-show-all').onclick=()=>{sessionPendingOnly=false;sessionUnlinkedOnly=false;sessionAbsentOnly=false;view='all';$('filter-date').value='';quickDateRange=null;render();};
$('session-copy-summary').onclick=async()=>{const selected=sessions.find(s=>s.id===selectedSessionId);if(!selected)return;const active=bookings.filter(b=>b.session_id===selected.id&&b.status==='Inscrit');const lines=['KM16 · Bilan de séance',dateFr(selected.session_date)+' · '+selected.start_time.slice(0,5)+' · '+selected.category+' · '+selected.venue,'Inscrits : '+active.length,'Présents : '+active.filter(b=>attendance.get(b.id)===true).length,'Absents : '+active.filter(b=>attendance.get(b.id)===false).length,'Présences à renseigner : '+active.filter(b=>!attendance.has(b.id)).length,'Dossiers à associer : '+active.filter(b=>!memberLinks.has(b.id)).length];try{await navigator.clipboard.writeText(lines.join('\n'));status('Bilan de séance copié.');}catch(e){status('Copie impossible : '+e.message,true);}};
$('session-mark-present').onclick=()=>bulkAttendance(true);
$('session-mark-absent').onclick=()=>bulkAttendance(false);
$('print-roster').onclick=()=>{
 const selected=sessions.find(s=>s.id===selectedSessionId);if(!selected)return;
 const participants=bookings.filter(b=>b.session_id===selected.id&&b.status==='Inscrit').sort((a,b)=>(a.last_name||'').localeCompare(b.last_name||'','fr'));
 const w=window.open('','_blank','width=900,height=700');if(!w){status('Autorisez les fenêtres surgissantes pour imprimer la liste.',true);return;}
 w.opener=null;const d=w.document;d.title='KM16 · Émargement '+dateFr(selected.session_date);const style=d.createElement('style');style.textContent='body{font:15px system-ui,sans-serif;margin:30px;color:#222}h1{font-size:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:12px;text-align:left}th:last-child,td:last-child{width:120px}p{margin:8px 0 22px}';d.head.append(style);
 const h=d.createElement('h1');h.textContent='KM16 · Liste d’émargement';d.body.append(h);
 const info=d.createElement('p');info.textContent=[dateFr(selected.session_date),selected.start_time?.slice(0,5)+'–'+selected.end_time?.slice(0,5),selected.category,selected.venue].join(' · ');d.body.append(info);
 const count=d.createElement('p');count.textContent=participants.length+' inscrit(s) actif(s) · Présence à cocher sur papier';d.body.append(count);
 const table=d.createElement('table');const head=d.createElement('tr');for(const label of ['N°','Nom','Prénom','Présent(e)']){const th=d.createElement('th');th.textContent=label;head.append(th);}table.append(head);
 participants.forEach((b,i)=>{const tr=d.createElement('tr');for(const v of [String(i+1),b.last_name||'',b.first_name||'','☐']){const td=d.createElement('td');td.textContent=v;tr.append(td);}table.append(tr);});d.body.append(table);d.close();w.focus();w.print();
};
const plusDays=(n)=>{const d=new Date(todayParis()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
$('filter-today').onclick=()=>{selectedSessionId=null;quickDateRange=null;$('filter-date').value=todayParis();view='upcoming';render();};
$('filter-tomorrow').onclick=()=>{selectedSessionId=null;quickDateRange=null;$('filter-date').value=plusDays(1);view='upcoming';render();};
$('filter-next-seven').onclick=()=>{selectedSessionId=null;$('filter-date').value='';quickDateRange=[todayParis(),plusDays(6)];view='upcoming';render();};
$('filter-date').addEventListener('change',()=>{quickDateRange=null;render();});
$('reset').onclick=()=>{selectedSessionId=null;sessionPendingOnly=false;sessionUnlinkedOnly=false;sessionAbsentOnly=false;quickDateRange=null;for(const id of ['filter-date','filter-course','filter-status','filter-search'])$(id).value='';view='upcoming';render()};
function showCoursePriority(which){selectedSessionId=null;sessionPendingOnly=false;sessionUnlinkedOnly=false;quickDateRange=null;for(const id of ['filter-date','filter-course','filter-status','filter-search'])$(id).value='';$('filter-season').value='';view=which;render();$('results-count').scrollIntoView({behavior:'smooth',block:'start'});}
$('course-action-unlinked').onclick=()=>showCoursePriority('unlinked');
$('course-action-attendance').onclick=()=>showCoursePriority('attendance-pending');
$('course-action-new').onclick=()=>showCoursePriority('new');
$('refresh').onclick=load;
$('toggle-session-range').onclick=()=>{showAllSessions=!showAllSessions;render();};
let editingSession=null;
function endSessionEdit(){
 editingSession=null;$('session-form').reset();$('session-category').readOnly=false;
 $('session-submit').textContent='Ajouter la séance';$('session-exit-edit').hidden=true;
}
$('session-exit-edit').onclick=endSessionEdit;
$('session-edit').onclick=()=>{
 const course=sessions.find(s=>s.id===selectedSessionId);
 if(!course?.enabled)return;
 editingSession=course.id;
 for(const [id,value] of [['session-date',course.session_date],['session-category',course.category],['session-start',course.start_time.slice(0,5)],['session-end',course.end_time.slice(0,5)],['session-venue',course.venue]])$(id).value=value;
 $('session-category').readOnly=true;
 $('session-submit').textContent='Enregistrer et prévenir les inscrits';$('session-exit-edit').hidden=false;
 $('session-date').focus();
};
$('session-cancel').onclick=async()=>{
 const course=sessions.find(s=>s.id===selectedSessionId);
 if(!course?.enabled||!window.confirm('Annuler cette séance et prévenir les inscrits par e-mail ?'))return;
 $('session-cancel').disabled=true;
 try{await call('admin_change_session',{session_id:course.id,cancel:true});endSessionEdit();await load();status('Séance annulée. Les e-mails sont mis en file.');}
 catch(error){status(error.message,true);render();}
};
$('session-form').onsubmit=async e=>{
 e.preventDefault();
 const date=$('session-date').value,category=$('session-category').value.trim(),start=$('session-start').value,end=$('session-end').value,venue=$('session-venue').value.trim();
 const editing=editingSession;
 $('session-submit').disabled=true;
 try{
  const values={session_date:date,start_time:start,end_time:end,venue};
  if(editing)await call('admin_change_session',{...values,session_id:editing});
  else await call('admin_session',{...values,course_key:JSON.stringify([category,start,end,venue]),category});
  endSessionEdit();await load();status(editing?'Séance mise à jour. Les inscrits seront prévenus si le créneau a changé.':'Séance ajoutée.');
 }catch(error){status(error.message,true);}
 finally{$('session-submit').disabled=false;}
};
supa.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>authState(s),0)});
const {data}=await supa.auth.getSession();await authState(data.session);
setInterval(()=>{if(!document.hidden)load()},30000);
