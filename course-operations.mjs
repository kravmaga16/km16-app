const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const view=params.get('vue');
const title=view==='instructeur'?'Présences par séance':view==='paiements'?'Paiements à rapprocher':'Mes réservations';
$('title').textContent=title;document.title=title+' · KM16';
const suppliedSeason=params.get('saison');
const season=/^20\d{2}\/20\d{2}$/.test(suppliedSeason||'')?suppliedSeason:'2026/2027';
const db=window.supabase?.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
const status=$('status'),rows=$('rows'),tools=$('tools');
const day=new Intl.DateTimeFormat('fr-FR',{dateStyle:'full',timeZone:'Europe/Paris'});
const clock=new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short',hourCycle:'h23',timeZone:'Europe/Paris'});
const money=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'});
const make=(parent,tag,content='')=>{const el=document.createElement(tag);el.textContent=content;parent.append(el);return el;};
const row=()=>{const el=make(rows,'article');el.className='row';return el;};
const sessionLabel=s=>day.format(new Date(s.session_date+'T12:00:00Z'))+' · '+s.start_time.slice(0,5)+'–'+s.end_time.slice(0,5)+' · '+s.venue+' · '+s.category;
const go=(parent,text,url)=>{const a=make(parent,'a',text);a.href=url;return a;};
async function rpc(name,args){
 const {data,error}=await db.rpc(name,args);
 if(error)throw Error(error.message);
 return data;
}
function button(parent,label,action){
 const b=make(parent,'button',label);b.type='button';
 b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};
 return b;
}
function appendMoveCourse(item,entry){
 button(item,'Déplacer ce cours',async()=>{
  const existing=item.querySelector('.move-course');
  if(existing){existing.remove();return;}
  const alternatives=await rpc('km16_move_course_booking',{p_booking:entry.id});
  const panel=make(item,'div');panel.className='move-course';
  if(!alternatives.length){make(panel,'p','Aucun autre créneau compatible disponible.');return;}
  const label=make(panel,'label','Nouveau créneau');
  const select=make(label,'select');
  for(const course of alternatives){const option=make(select,'option',sessionLabel(course));option.value=course.id;}
  button(panel,'Confirmer le déplacement',async()=>{
   if(!window.confirm('Remplacer votre réservation par le créneau sélectionné ?'))return;
   await rpc('km16_move_course_booking',{p_booking:entry.id,p_target:select.value});
   await reservations();
   status.textContent='Votre réservation a été déplacée.';
  });
 });
}
async function reservations(cancel=null){
 const list=await rpc('km16_my_course_bookings',{p_cancel:cancel});rows.replaceChildren();
 status.textContent=list.length?'Séances à venir et réservations des 30 derniers jours.':'Aucune réservation associée à ce compte.';
 for(const entry of list){
  const item=row();
  item.id='booking-'+entry.id;item.tabIndex=-1;
  make(item,'h2',[entry.first_name,entry.last_name].join(' '));
  make(item,'p',sessionLabel(entry));
  make(item,'p',entry.status);
  if(entry.cancellable)appendMoveCourse(item,entry);
  if(entry.cancellable)button(item,'Annuler cette réservation',async()=>{
   if(window.confirm('Annuler la réservation de '+entry.first_name+' pour cette séance ?'))await reservations(entry.id);
  });
 }
 if(!cancel&&location.hash.startsWith('#booking-')){
  const target=$(location.hash.slice(1));
  target?.focus({preventScroll:true});
  target?.scrollIntoView({block:'start'});
 }
}
async function instructors(){
 const result=await rpc('km16_instructor_courses');
 const label=make(tools,'label','Séance');const select=make(label,'select');
 status.textContent=result.sessions.length?'Sélectionnez une séance.':'Aucune séance attribuée à ce compte.';
 if(!result.sessions.length)return;
 for(const s of result.sessions){const o=make(select,'option',sessionLabel(s));o.value=s.id;}
 const [today, time] = clock.format(new Date()).split(' ');
 const todaySessions = result.sessions.filter(session => session.session_date === today);
 const ongoing = todaySessions.find(session =>
  session.start_time.slice(0, 5) <= time && session.end_time.slice(0, 5) > time);
 const laterToday = todaySessions.find(session => session.start_time.slice(0, 5) > time);
 const future = result.sessions.find(session => session.session_date > today);
 select.value = (ongoing ?? laterToday ?? todaySessions.at(-1) ?? future ?? result.sessions.at(-1)).id;
 let revision=0;
 async function show(args={}){
  const ticket=++revision;
  const id=select.value;
  const payload=await rpc('km16_instructor_courses',{p_session:id,...args});
  if(ticket!==revision)return;
  rows.replaceChildren();
  const pending = payload.bookings.filter(entry => entry.present == null).length;
  const present = payload.bookings.filter(entry => entry.present === true).length;
  const absent = payload.bookings.length - pending - present;
  status.textContent = payload.bookings.length
   ? `${pending} à pointer · ${present} présent(s) · ${absent} absent(s)`
   : 'Aucune inscription active pour cette séance.';
  for (const entry of payload.bookings) {
   const item = row();
   make(item, 'h2', [entry.first_name, entry.last_name].join(' '));
   const actions = make(item, 'div');
   actions.className = 'actions';
   for (const [label, value] of [['Présent', true], ['Absent', false]]) {
    const control = button(actions, label, () => show({p_booking: entry.id, p_present: value}));
    control.setAttribute('aria-pressed', String(entry.present === value));
   }
  }
  if(result.admin){
   const item=row();make(item,'h2','Accès instructeurs à cette séance');
   for(const email of payload.instructors){
    const action=make(item,'p',email+' ');button(action,'Retirer l’accès',()=>show({p_email:email,p_remove:true}));
   }
   const emailLabel=make(item,'label','E-mail du compte KM16 de l’instructeur');
   const input=make(emailLabel,'input');input.type='email';
   button(item,'Donner accès à cette séance',async()=>{if(input.value.trim()&&input.reportValidity())await show({p_email:input.value.trim()});});
  }
 }
 select.onchange=()=>{rows.replaceChildren();void show().catch(e=>{status.textContent=e.message;});};
 await show();
}
async function payments(){
 rows.replaceChildren();tools.replaceChildren();status.textContent='Chargement des paiements…';
 const data=await rpc('km16_admin_payment_matches',{p_season:season});
 status.textContent=data.length?'Saison '+season+' · '+data.length+' paiement(s) affiché(s).':'Aucun paiement à rapprocher pour '+season+'.';
 for(const tx of data){
  const item=row();const name=[tx.payer_first_name,tx.payer_last_name].filter(Boolean).join(' ')||'Payeur non renseigné';
  make(item,'h2',name);
  make(item,'p',[tx.source,tx.source_reference,tx.paid_at?day.format(new Date(tx.paid_at)):'',money.format(tx.amount_cents/100)].filter(Boolean).join(' · '));
  button(item,'Chercher la fiche adhérente',async()=>{
   const existing=item.querySelector('section');if(existing){existing.remove();return;}
   const panel=make(item,'section');
   const label=make(panel,'label','Rechercher par nom ou e-mail');const input=make(label,'input');input.value=tx.payer_last_name||'';
   const suggestion = make(panel, 'div');
   const results = make(panel, 'div');
   function renderMatch(parent, match) {
    const description = [match.first_name, match.last_name, match.email].filter(Boolean).join(' · ');
    const entry = make(parent, 'p', description + ' ');
    button(entry, 'Confirmer le rapprochement', async () => {
     if (!window.confirm('Associer ' + money.format(tx.amount_cents / 100) + ' à ' + description + ' ?')) return;
     await rpc('km16_admin_payment_matches', {p_season: season, p_transaction: tx.id, p_external: match.external_id});
     await payments();
     status.textContent = 'Rapprochement enregistré. ' + status.textContent;
    });
   }
   async function search() {
    const matches = await rpc('km16_admin_payment_matches', {p_season: season, p_transaction: tx.id, p_search: input.value.trim()});
    results.replaceChildren();
    if (!matches.length) make(results, 'p', 'Aucune fiche active trouvée.');
    for (const match of matches) renderMatch(results, match);
   }
   const submit = button(panel, 'Rechercher', search);
   panel.insertBefore(submit, results);
   if (/^(fighty|sportigo)$/i.test(tx.source?.trim())) {
    try {
     const {status: matchStatus, candidate} = await rpc('km16_payment_match_suggestion', {p_season: season, p_transaction: tx.id});
     if (matchStatus === 'unique') {
      make(suggestion, 'h3', 'Fiche suggérée');
      make(suggestion, 'p', 'Le prénom et le nom du payeur correspondent à une seule fiche active de cette saison.');
      if (candidate.shared_email) make(suggestion, 'p', 'Cet e-mail est partagé par plusieurs fiches. Vérifie le membre du foyer avant de confirmer.');
      renderMatch(suggestion, candidate);
      return;
     }
     if (matchStatus === 'ambiguous') {
      make(suggestion, 'p', 'Plusieurs fiches ont le même prénom et le même nom. Vérifie la fiche manuellement.');
     }
    } catch {
     make(suggestion, 'p', 'Suggestion indisponible. La recherche manuelle reste accessible.');
    }
   }
   await search();
  });
 }
}
try{
 if(!db)throw Error('Connexion indisponible.');
 const {data,error}=await db.auth.getSession();
 if(error)throw error;
 if(!data.session){status.textContent='Connectez-vous pour accéder à cet espace.';$('signin').hidden=false;}
 else if(view==='instructeur')await instructors();
 else if(view==='paiements')await payments();
 else{go(tools,'Réserver un cours','./course-booking.html');await reservations();}
}catch(error){status.textContent=error.message;}
