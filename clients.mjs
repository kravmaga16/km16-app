import {initCommunications} from './communications.mjs?v=ages1';
import {SEASON,seasonState} from './seasons.mjs?v=1';
import {clientsWorkbook,stagesMonthly} from './clients-excel.mjs?v=import-actifs1';
const $=id=>document.getElementById(id),ADMIN='alexandre.marchat@gmail.com';
const client=window.supabase?.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-clients';
let session=null,all=[],group='',generation=0,busy=false,controller=null;
const communications=initCommunications({client,getState:()=>({clients:all,group,season:$('season').value,test:$('test').checked})});
$('season').value=seasonState().defaultSeason;
function showSeason(){
 const selected=$('season').value,state=seasonState();
 $('season-title').textContent='Saison '+selected;
 $('season-dates').textContent=selected===SEASON?'Du 7 septembre 2026 au 25 juin 2027 inclus.':'Dates de cette saison à paramétrer.';
 $('season-status').textContent=selected===SEASON?(state.archived?'Archives · historique conservé':state.renewalOpen?'Saison en cours · réabonnements ouverts pour 2027/2028':'Saison en cours · réabonnements à partir du 1er juin 2027'):'Achats rattachés à cette saison';
 $('renewal').hidden=!(selected===SEASON&&state.renewalOpen);
 $('km16-season-transition-status').textContent=selected===SEASON?(state.archived?'Saison archivée : historique conservé. Consultez la saison suivante pour les nouvelles inscriptions.':state.renewalOpen?'Réabonnements ouverts depuis le 1er juin 2027. Contrôlez les dossiers avant renouvellement.':'Réabonnements prévus à partir du 1er juin 2027. Préparez les dossiers et les communications.'):'Saison sélectionnée : '+selected+' · vérifiez les dates et offres avant toute nouvelle inscription.';
}
let courseAlertRequest=0;
async function refreshCourseAlerts(){
 const request=++courseAlertRequest;
 const put=(a,b,msg)=>{if(request!==courseAlertRequest)return;$('kpi-course-unlinked').textContent=a;$('kpi-course-attendance').textContent=b;$('kpi-course-status').textContent=msg;renderPriorities();};
 if(session?.user?.email?.toLowerCase()!==ADMIN){put('—','—','Accès administrateur requis.');return;}
 put('…','…','Actualisation des réservations et des présences…');
 try{
  const {data:{session:current}}=await client.auth.getSession();if(!current)throw Error('Session expirée');
  const response=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-course-bookings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'admin_list'})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Réservations indisponibles');
  if(!Array.isArray(result.bookings)||!Array.isArray(result.sessions))throw Error('Réponse des cours inattendue');
  const [links,attendance,externalLinks]=await Promise.all([client.from('km16_booking_member_links').select('booking_id'),client.from('km16_course_attendance').select('booking_id'),client.from('km16_booking_external_links').select('booking_id')]);
  if(links.error)throw links.error;if(attendance.error)throw attendance.error;if(externalLinks.error)throw externalLinks.error;
  const linked=new Set([...(links.data||[]),...(externalLinks.data||[])].map(x=>x.booking_id)),recorded=new Set((attendance.data||[]).map(x=>x.booking_id));
  const dates=new Map(result.sessions.map(x=>[x.id,x.session_date]));const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const active=result.bookings.filter(x=>x.status==='Inscrit');
  put(String(active.filter(x=>!linked.has(x.id)).length),String(active.filter(x=>dates.has(x.session_id)&&dates.get(x.session_id)<today&&!recorded.has(x.id)).length),'Suivi des cours actualisé à '+new Date().toLocaleTimeString('fr-FR')+'.');
 }catch(e){put('—','—','Suivi des cours indisponible : '+e.message);}
}
const KM16_MAIL_SCHEDULE=[
 {
  "send": "2026-12-13",
  "event": "Fermeture de fin d’année",
  "subject": "KM16 · De belles fêtes et une énergie renouvelée pour 2027 !",
  "body": "Bonjour à toutes et à tous,\n\nAlors que l’année 2026 touche à sa fin, toute l’équipe KM16 vous remercie chaleureusement pour votre confiance, votre fidélité et votre engagement.\n\nChaque entraînement et chaque progrès font de KM16 bien plus qu’un club de Krav Maga : une communauté unie autour du dépassement de soi, du respect et de la solidarité.\n\n🎄 Une pause pour revenir encore plus forts !\n\nLe club sera totalement fermé du dimanche 20 décembre 2026 au dimanche 3 janvier 2027 inclus. Aucun cours ne sera assuré pendant cette période.\n\nProfitez de cette pause pour vous ressourcer et partager de beaux moments avec vos proches.\n\n🥋 Rendez-vous dès le lundi 4 janvier 2027 pour retrouver les tatamis et poursuivre ensemble votre progression !\n\nToute l’équipe KM16 vous souhaite de merveilleuses fêtes, pleines de joie, de sérénité et de belles énergies.\n\nMerci de faire partie de l’aventure KM16 !\n\nSportivement et chaleureusement,\nL’équipe KM16\nKrav Maga 16 – Paris 16e\nhttps://app.km16.fr/"
 },
 {
  "send": "2027-01-31",
  "event": "Vacances scolaires d’hiver",
  "subject": "KM16 · Gardons l’énergie pendant les vacances d’hiver !",
  "body": "Bonjour à toutes et à tous,\n\nLes vacances d’hiver approchent ! C’est l’occasion de profiter d’un peu de repos tout en gardant le plaisir de pratiquer le Krav Maga.\n\n🥋 Du samedi 6 au dimanche 21 février 2027, les cours habituels du lundi au samedi sont suspendus. KM16 vous accueille uniquement les dimanches 7, 14 et 21 février, selon le planning habituel du dimanche.\n\nProfitez de ces rendez-vous pour entretenir vos réflexes, votre condition physique et votre motivation !\n\nNous vous souhaitons d’excellentes vacances et avons hâte de vous retrouver sur les tatamis.\n\nSportivement,\nL’équipe KM16\nhttps://app.km16.fr/"
 },
 {
  "send": "2027-03-28",
  "event": "Vacances scolaires de printemps",
  "subject": "KM16 · Vacances de printemps : on garde le rythme le dimanche !",
  "body": "Bonjour à toutes et à tous,\n\nLe printemps arrive, avec son énergie et ses belles occasions de progresser !\n\n🌿 Pendant les vacances scolaires de Paris, du samedi 3 au dimanche 18 avril 2027, les cours du lundi au samedi sont suspendus.\n\n🥋 Les entraînements restent assurés les dimanches 4, 11 et 18 avril, selon le planning habituel du dimanche.\n\nUne belle occasion de rester actif, de consolider vos acquis et de partager un moment sportif avec la communauté KM16.\n\nToute l’équipe vous souhaite de très belles vacances de printemps !\n\nSportivement,\nL’équipe KM16\nhttps://app.km16.fr/"
 },
 {
  "send": "2027-06-01",
  "event": "Ouverture des réabonnements",
  "subject": "KM16 · Votre place sur les tatamis pour 2027/2028 !",
  "body": "Bonjour à toutes et à tous,\n\nUne nouvelle saison se prépare chez KM16, et nous serions ravis de poursuivre l’aventure à vos côtés !\n\n🥋 Les réabonnements pour la saison 2027/2028 ouvrent à partir du 1er juin 2027.\n\nVotre progression, votre confiance et votre engagement sont au cœur de notre club. Renouveler votre adhésion, c’est continuer à apprendre, à vous dépasser et à partager l’esprit du Krav Maga avec notre équipe.\n\nRetrouvez les informations et les modalités d’inscription dans l’application KM16 :\nhttps://app.km16.fr/\n\nMerci pour votre fidélité et votre confiance. Nous espérons vous retrouver nombreux pour une nouvelle saison pleine d’énergie !\n\nSportivement,\nL’équipe KM16"
 },
 {
  "send": "2027-06-17",
  "event": "Fermeture estivale",
  "subject": "KM16 · Une belle fin de saison avant la pause estivale !",
  "body": "Bonjour à toutes et à tous,\n\nLa saison touche bientôt à sa fin, et nous tenons à vous remercier pour votre énergie, votre assiduité et tous les progrès accomplis ensemble.\n\n🥋 Les derniers cours KM16 auront lieu le jeudi 24 juin 2027. Le club fermera ensuite pour la pause estivale.\n\n☀️ Profitez de l’été pour vous reposer, bouger, vous ressourcer et revenir avec une énergie renouvelée !\n\nNous aurons le plaisir de vous retrouver dès le lundi 6 septembre 2027 pour une nouvelle saison de Krav Maga.\n\nLes réabonnements pour 2027/2028 sont ouverts depuis le 1er juin. Retrouvez les modalités sur https://app.km16.fr/.\n\nMerci de faire vivre l’esprit KM16 tout au long de l’année.\n\nTrès bel été à toutes et à tous !\n\nSportivement et chaleureusement,\nL’équipe KM16"
 },
 {
  "send": "2027-08-30",
  "event": "Rentrée KM16",
  "subject": "KM16 · Prêts à retrouver les tatamis le 6 septembre ?",
  "body": "Bonjour à toutes et à tous,\n\nLa rentrée approche, et toute l’équipe KM16 se réjouit de vous retrouver !\n\n🥋 Les cours reprennent le lundi 6 septembre 2027.\n\nQue vous souhaitiez consolider vos acquis, relever de nouveaux défis ou simplement retrouver le plaisir de vous entraîner ensemble, cette nouvelle saison sera une belle occasion de progresser.\n\nPréparez votre tenue, votre motivation et votre énergie : les tatamis vous attendent !\n\nPour retrouver les informations pratiques et les modalités d’inscription, rendez-vous sur https://app.km16.fr/.\n\nNous vous souhaitons une excellente rentrée et une magnifique saison 2027/2028 !\n\nSportivement,\nL’équipe KM16"
 }
];
function renderKm16MailSchedule(){const host=$('km16-comms-schedule-list');if(!host)return;host.replaceChildren();const today=km16ParisToday(),upcoming=KM16_MAIL_SCHEDULE.filter(x=>x.send>=today);$('km16-comms-schedule-status').textContent=upcoming.length+' communication(s) à préparer · Les campagnes activées sont envoyées automatiquement à leur date prévue ; les boutons ci-dessous servent à prévisualiser ou envoyer manuellement.';const ul=document.createElement('ul');ul.className='km16-approval-list';for(const item of upcoming){const li=document.createElement('li'),span=document.createElement('span'),button=document.createElement('button');span.textContent=(item.send===today?'À préparer aujourd’hui':'Prévue le '+km16DateFr(item.send))+' · '+item.event;button.type='button';button.textContent='Préparer l’e-mail';button.onclick=()=>{if($('test').checked){$('comm-status').textContent='Désactivez le mode test pour préparer une communication réelle.';return;}$('comm-channel').value='email';$('comm-channel').dispatchEvent(new Event('change'));$('comm-group').value='';$('comm-group').dispatchEvent(new Event('input'));$('comm-subject').value=item.subject;$('comm-subject').dispatchEvent(new Event('input'));$('comm-message').value=item.body;$('comm-message').dispatchEvent(new Event('input'));$('comm-title').scrollIntoView({behavior:'smooth',block:'start'});$('comm-status').textContent='Campagne préparée pour tous les groupes. Vérifiez les destinataires puis confirmez l’envoi.';};li.append(span,button);ul.append(li);}host.append(ul);}
let km16AutoMailRequest=0;
async function refreshKm16AutoMail(){const ticket=++km16AutoMailRequest,host=$('km16-auto-mail-list');if(!host)return;host.replaceChildren();$('km16-auto-mail-status').textContent='Chargement du journal des campagnes…';if(session?.user?.email?.toLowerCase()!==ADMIN)return;
 try{const {data,error}=await client.rpc('km16_admin_scheduled_campaigns_list');if(error)throw error;if(ticket!==km16AutoMailRequest)return;const ul=document.createElement('ul');ul.className='km16-approval-list';for(const c of data||[]){const li=document.createElement('li'),label=document.createElement('span'),btn=document.createElement('button');label.textContent=km16DateFr(c.send_on)+' · '+c.subject+' · '+(c.prepared_at?'Envoi lancé':c.approved?'Activée':'À activer')+' · '+c.accepted+'/'+c.total+' accepté(s) par OVH'+(Number(c.failed)?' · '+c.failed+' échec(s) ou incertain(s)':'');li.append(label);if(!c.prepared_at){btn.type='button';btn.textContent=c.approved?'Désactiver':'Activer l’envoi automatique';btn.onclick=async()=>{if(!confirm((c.approved?'Désactiver':'Activer')+' la campagne « '+c.subject+' » prévue le '+km16DateFr(c.send_on)+' ?'+(!c.approved?' Elle sera envoyée sans nouvelle confirmation à cette date.':'')))return;btn.disabled=true;try{const {error}=await client.rpc('km16_admin_scheduled_campaign_approve',{p_id:c.id,p_approve:!c.approved});if(error)throw error;await refreshKm16AutoMail();}catch(e){$('km16-auto-mail-status').textContent='Action impossible : '+e.message;btn.disabled=false;}};li.append(btn);}ul.append(li);}host.append(ul);$('km16-auto-mail-status').textContent=(data||[]).filter(c=>c.approved&&!c.prepared_at).length+' campagne(s) activée(s) · '+(data||[]).filter(c=>c.prepared_at).length+' campagne(s) lancée(s).';}catch(e){if(ticket===km16AutoMailRequest)$('km16-auto-mail-status').textContent='Journal indisponible : '+e.message;}}
$('km16-auto-mail-refresh').onclick=refreshKm16AutoMail;
const KM16_DEADLINES=[
 {date:'2026-12-20',end:'2027-01-03',label:'Fermeture de fin d’année',detail:'Club totalement fermé du 20 décembre 2026 au 3 janvier 2027 inclus, y compris les dimanches'},
 {date:'2027-02-06',end:'2027-02-21',label:'Vacances d’hiver · Paris (zone C)',detail:'Cours suspendus du lundi au samedi ; cours du dimanche maintenus (7, 14 et 21 février)'},
 {date:'2027-04-03',end:'2027-04-18',label:'Vacances de printemps · Paris (zone C)',detail:'Cours suspendus du lundi au samedi ; cours du dimanche maintenus (4, 11 et 18 avril)'},
 {date:'2027-06-01',label:'Ouverture des réabonnements',detail:'Réabonnements possibles à partir du 1er juin 2027'},
 {date:'2027-06-24',label:'Dernier jour de cours',detail:'Fermeture après les cours du jeudi 24 juin 2027'},
 {date:'2027-09-06',label:'Reprise des cours',detail:'Réouverture le lundi 6 septembre 2027'}
];
const km16ParisToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const km16DateFr=d=>d.split('-').reverse().join('/');
function km16UpcomingDeadlines(){const today=km16ParisToday();return KM16_DEADLINES.filter(d=>(d.end||d.date)>=today);}
function renderKm16Deadlines(){const host=$('km16-deadlines-list');if(!host)return;host.replaceChildren();const today=km16ParisToday(),items=km16UpcomingDeadlines();
 $('km16-deadlines-status').textContent=items.length?items.length+' échéance(s) à venir ou en cours · '+items.filter(d=>d.date<=today&&(d.end||d.date)>=today).length+' en cours.':'Aucune échéance future enregistrée dans ce calendrier.';
 const ul=document.createElement('ul');ul.className='km16-approval-list';for(const item of items){const li=document.createElement('li'),span=document.createElement('span');const active=item.date<=today&&(item.end||item.date)>=today;span.textContent=(active?'En cours · ':'À venir · ')+km16DateFr(item.date)+(item.end?' au '+km16DateFr(item.end):'')+' · '+item.label+' — '+item.detail;li.append(span);ul.append(li);}host.append(ul);
}
$('km16-deadlines-copy').onclick=async()=>{const lines=['KM16 · Échéances et fermetures','Établi le '+new Date().toLocaleString('fr-FR'),...km16UpcomingDeadlines().map(x=>km16DateFr(x.date)+(x.end?' au '+km16DateFr(x.end):'')+' · '+x.detail)];try{await navigator.clipboard.writeText(lines.join('\\n'));$('km16-deadlines-status').textContent='Échéances copiées.';}catch(e){$('km16-deadlines-status').textContent='Copie impossible : '+e.message;}};
renderKm16Deadlines();renderKm16MailSchedule();
const KM16_DAILY_ACTIONS=[
 {id:'kpi-review',label:'Dossiers à valider',href:'#km16-dossiers'},
 {id:'kpi-course-attendance',label:'Présences à renseigner',href:'./course-admin.html?view=attendance-pending'},
 {id:'kpi-course-unlinked',label:'Réservations sans dossier',href:'./course-admin.html?view=unlinked'},
 {id:'kpi-shirts',label:'Tee-shirts à remettre',href:'./tee-shirts.html#admin'}
];
let km16FollowupRequest=0;
async function refreshKm16FollowupDashboard(){const seq=++km16FollowupRequest;const ids=['pending','due','never','uncertain'];if(session?.user?.email?.toLowerCase()!==ADMIN){for(const id of ids)$('km16-followup-'+id).textContent='—';$('km16-followup-dashboard-status').textContent='Connexion administrateur requise.';return;}try{const {data,error}=await client.rpc('km16_admin_followup_dashboard');if(seq!==km16FollowupRequest)return;if(error)throw error;const row=data?.[0];if(!row)throw Error('Indicateurs indisponibles');for(const id of ids)$('km16-followup-'+id).textContent=String(row[id+'_count']??'—');$('km16-followup-dashboard-status').textContent='Indicateurs calculés sur les dossiers réels en attente · Actualisés à '+new Date().toLocaleTimeString('fr-FR');}catch(e){if(seq!==km16FollowupRequest)return;for(const id of ids)$('km16-followup-'+id).textContent='—';$('km16-followup-dashboard-status').textContent='Suivi indisponible : '+e.message;}}
function renderKm16Daily(){const cards=$('km16-daily-cards'),next=$('km16-daily-next');if(!cards||!next)return;
 const today=km16ParisToday();$('km16-daily-date').textContent='Aujourd’hui : '+km16DateFr(today)+' · Saison '+$('season').value;
 cards.replaceChildren();let pending=0,unknown=0;
 for(const item of KM16_DAILY_ACTIONS){const raw=$(item.id)?.textContent?.trim()||'',valid=/^\\d+$/.test(raw),count=valid?Number(raw):null;
  if(count===null)unknown++;else pending+=count;
  const card=document.createElement('div');card.className='km16-kpi';const label=document.createElement('span');label.textContent=item.label;const strong=document.createElement('strong');strong.textContent=count===null?'—':String(count);const detail=document.createElement('small');detail.textContent=count===null?'Indicateur à vérifier':count===0?'Aucune action en attente':'À traiter';const link=document.createElement('a');link.href=item.href;link.textContent='Ouvrir';card.append(label,strong,detail,link);cards.append(card);
 }
 $('km16-daily-status').textContent=unknown?'Données partielles : '+unknown+' indicateur(s) indisponible(s).':pending===0?'Aucune action en attente dans les quatre catégories suivies.':pending+' action(s) en attente dans les quatre catégories suivies.';
 next.replaceChildren();const upcoming=km16UpcomingDeadlines().slice(0,3);if(!upcoming.length){const p=document.createElement('p');p.className='muted';p.textContent='Aucune échéance future renseignée.';next.append(p);return;}
 const ul=document.createElement('ul');ul.className='km16-approval-list';for(const d of upcoming){const li=document.createElement('li');li.textContent=km16DateFr(d.date)+(d.end?' au '+km16DateFr(d.end):'')+' · '+d.label;ul.append(li);}next.append(ul);
}
$('km16-daily-refresh').onclick=()=>{refreshCourseAlerts();refreshShirtKpi();refreshAdminActionProgress();refreshKm16AutoMail();refreshKm16FollowupDashboard();load();renderKm16Daily();};
const KM16_ACTIONS=[
 {id:'review',label:'Dossiers administratifs à valider',kpi:'kpi-review',url:'./clients.html#km16-dossiers',priority:1},
 {id:'attendance',label:'Présences des cours passés à renseigner',kpi:'kpi-course-attendance',url:'./course-admin.html?view=attendance-pending',priority:1},
 {id:'unlinked',label:'Réservations à associer aux adhérents',kpi:'kpi-course-unlinked',url:'./course-admin.html?view=unlinked',priority:2},
 {id:'shirts',label:'Tee-shirts à remettre',kpi:'kpi-shirts',url:'./tee-shirts.html#admin',priority:2}
];
const km16ActionState=new Map();
let km16ActionLoaded=false,km16ActionError='',km16ActionBusy=false,km16ActionRequest=0;
async function refreshAdminActionProgress(){
 const request=++km16ActionRequest;km16ActionLoaded=false;km16ActionError='';renderPriorities();
 if(session?.user?.email?.toLowerCase()!==ADMIN)return;
 try{const {data,error}=await client.rpc('km16_admin_action_progress_list');if(error)throw error;if(request!==km16ActionRequest)return;
  km16ActionState.clear();for(const row of data||[])if(row.state==='en-cours')km16ActionState.set(row.action_id,'en-cours');km16ActionLoaded=true;
 }catch(e){if(request===km16ActionRequest)km16ActionError=e.message;}if(request===km16ActionRequest)renderPriorities();
}
async function setAdminActionProgress(actionId,inProgress){
 if(!km16ActionLoaded||km16ActionBusy)return;km16ActionBusy=true;renderPriorities();
 try{const {error}=await client.rpc('km16_admin_action_progress_set',{p_action_id:actionId,p_in_progress:inProgress});if(error)throw error;
  if(inProgress)km16ActionState.set(actionId,'en-cours');else km16ActionState.delete(actionId);
  km16ActionError='';
 }catch(e){km16ActionError='Enregistrement impossible : '+e.message;}
 finally{km16ActionBusy=false;renderPriorities();}
}
function renderPriorities(){
 const host=$('km16-priorities-list');if(!host)return;host.replaceChildren();
 const value=id=>{const v=$(id)?.textContent?.trim();return v&&/^\\d+$/.test(v)?Number(v):null;};
 const tasks=KM16_ACTIONS.map(t=>({...t,count:value(t.kpi)}));
 const pending=tasks.filter(t=>t.count!==null&&t.count>0).sort((a,b)=>a.priority-b.priority||b.count-a.count);
 const unknown=tasks.filter(t=>t.count===null);
 $('km16-priorities-total').textContent=unknown.length?'—':String(tasks.reduce((sum,t)=>sum+(t.count||0),0));
 $('km16-priorities-categories').textContent=unknown.length?'—':String(pending.length);
 $('km16-priorities-status').textContent=(pending.length?pending.length+' catégorie(s) nécessitent une intervention. ':'')+(unknown.length?'Certaines données sont indisponibles. ':'')+(!pending.length&&!unknown.length?'Aucune alerte en attente. ':'')+(km16ActionError?'Erreur de synchronisation : '+km16ActionError:km16ActionLoaded?'Suivi « En cours » synchronisé entre appareils. Il ne valide aucun dossier.':'Chargement du suivi partagé…');
 const ul=document.createElement('ul');ul.className='km16-approval-list';
 for(const task of [...pending,...unknown]){
  const li=document.createElement('li'),label=document.createElement('span'),link=document.createElement('a');
  const level=task.priority===1?'Urgent':'À planifier';
  label.textContent='['+level+'] '+(task.count===null?'À vérifier':task.count+' à traiter')+' · '+task.label;
  link.href=task.url;link.textContent='Ouvrir les dossiers';li.append(label,link);
  if(task.count!==null&&task.count>0){const btn=document.createElement('button');btn.type='button';btn.textContent=km16ActionState.has(task.id)?'En cours · Annuler le suivi':'Marquer en cours';btn.setAttribute('aria-pressed',String(km16ActionState.has(task.id)));btn.disabled=!km16ActionLoaded||km16ActionBusy;btn.onclick=()=>setAdminActionProgress(task.id,!km16ActionState.has(task.id));li.append(btn);}
  ul.append(li);
 }
 if(ul.children.length)host.append(ul);
 renderKm16Daily();
}
$('km16-priorities-copy').onclick=async()=>{
 const names=[['kpi-review','Dossiers administratifs à valider'],['kpi-course-attendance','Présences à renseigner'],['kpi-course-unlinked','Réservations sans dossier'],['kpi-shirts','Tee-shirts à remettre']];
 const lines=['KM16 · Point de pilotage','Saison : '+$('season').value,'Établi le '+new Date().toLocaleString('fr-FR'),'',...names.map(([id,label])=>label+' : '+($(id).textContent.trim()||'Indisponible')),'','Données issues des modules administratifs ; vérifier les indicateurs indisponibles.'];
 try{await navigator.clipboard.writeText(lines.join('\\n'));$('km16-priorities-status').textContent='Point de pilotage copié. Les compteurs restent consultables ci-dessous.';}catch(e){$('km16-priorities-status').textContent='Copie impossible : '+e.message;}
};
$('km16-priorities-refresh').onclick=()=>{refreshCourseAlerts();refreshShirtKpi();refreshAdminActionProgress();load();};
let overviewLoaded=false,shirtRefresh=0;
function renderApprovalDossiers(){const host=$('km16-dossiers-list'),count=$('km16-dossiers-count');host.replaceChildren();if(!overviewLoaded){count.textContent='Chargement des dossiers…';return;}const dossiers=[];const seen=new Set();for(const c of all){for(const p of c.products||[]){if(p.external||p.approval!=='pending'||!p.order_id||seen.has(p.order_id))continue;seen.add(p.order_id);dossiers.push({client:c,product:p});}}count.textContent=dossiers.length+' dossier(s) avec validation administrative en attente · Saison '+$('season').value+($('test').checked?' · Mode test':'');if(!dossiers.length){const p=document.createElement('p');p.className='muted';p.textContent='Aucune validation administrative en attente parmi les achats présents dans ce fichier.';host.append(p);return;}const ul=document.createElement('ul');ul.className='km16-approval-list';for(const d of dossiers){const li=document.createElement('li');const label=document.createElement('span');label.textContent=[d.client.first_name,d.client.last_name].filter(Boolean).join(' ')+' · '+d.product.title+' · '+euro(d.product.net_cents||0)+' encaissé(s)';const a=document.createElement('a');a.href='./adhesion.html?admin_order='+encodeURIComponent(d.product.order_id)+'#admin';a.textContent='Vérifier / valider le dossier';a.setAttribute('aria-label','Ouvrir la validation administrative de '+d.client.first_name+' '+d.client.last_name);li.append(label,a);ul.append(li);}host.append(ul);}
function renderOverview(){renderApprovalDossiers();const put=(id,v)=>{$(id).textContent=v;};if(!overviewLoaded){for(const id of ['kpi-members','kpi-net','kpi-review'])put(id,'—');renderPriorities();return;}const pendingOrders=new Set();for(const c of all){for(const p of c.products||[]){if(!p.external&&p.approval==='pending'&&p.order_id)pendingOrders.add(p.order_id);}}const review=pendingOrders.size;put('kpi-members',String(all.length));put('kpi-net',euro(all.reduce((sum,c)=>sum+(c.amounts?.net_cents||0),0)));put('kpi-review',String(review));$('kpi-members-note').textContent='Fiches du fichier · saison '+$('season').value;$('kpi-net-note').textContent=($('test').checked?'Mode TEST · ':'')+'Hors imports Sportigo/Fighty et boutique';$('kpi-review-note').textContent='Validations administratives en attente · '+($('test').checked?'mode test':'achats réels');$('kpi-updated').textContent='Données du fichier actualisées à '+new Date().toLocaleTimeString('fr-FR');renderPriorities();}
async function refreshShirtKpi(){if(session?.user.email?.toLowerCase()!==ADMIN)return;const ticket=++shirtRefresh;putShirts('…','Consultation des commandes réelles…');try{const {data:{session:current}}=await client.auth.getSession();if(!current)throw Error('Session expirée');const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-shirts',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'list'})});const data=await r.json();if(!r.ok||!Array.isArray(data.orders))throw Error(data.error||'Commandes indisponibles');if(ticket!==shirtRefresh)return;const pending=data.orders.filter(o=>o.livemode===true&&o.status==='paid'&&!o.collected_at).length;putShirts(String(pending),'Commandes réelles payées · non retirées');}catch(e){if(ticket===shirtRefresh)putShirts('—','Données indisponibles · ouvrir la boutique');}}
function putShirts(value,note){$('kpi-shirts').textContent=value;$('kpi-shirts-note').textContent=note;renderPriorities();}
const euro=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n/100);
let externalPaymentRequest=0;
async function refreshExternalPayments(){
 const request=++externalPaymentRequest;
 const host=$('external-payment-summary'),note=$('external-payment-status');if(!host||!note)return;
 host.replaceChildren();note.textContent='Consultation des montants importés…';
 if(session?.user.email?.toLowerCase()!==ADMIN)return;
 const season=$('season').value;
 try{
  const [{data,error},{data:statusRows,error:statusError}]=await Promise.all([
   client.rpc('km16_admin_external_payment_summary',{p_season:season}),
   client.rpc('km16_admin_external_payment_statuses',{p_season:season})
  ]);
  if(error)throw error;if(statusError)throw statusError;
  if(request!==externalPaymentRequest||season!==$('season').value)return;
  const rows=Array.isArray(data)?data:[];
  let totalPaid=0,totalRefund=0,totalCount=0;
  for(const source of ['Fighty','Sportigo','Stripe']){
   const entry=rows.find(x=>x.source===source)||{};
   const count=Number(entry.transaction_count||0),paid=Number(entry.paid_cents||0),refund=Number(entry.refunded_cents||0);
   totalPaid+=paid;totalRefund+=refund;totalCount+=count;
   const card=document.createElement('div');card.className='money-card';
   const title=document.createElement('div');title.className='money-label';title.textContent=source;
   const value=document.createElement('strong');value.className='money-value';value.textContent=count?euro(paid-refund):'Aucune transaction importée';
   const detail=document.createElement('p');detail.className='muted';
   detail.textContent=count?'Paiements réussis : '+euro(paid)+' · Remboursements : '+euro(refund)+' · '+count+' opérations':'Aucune opération importée';
   const stats=(statusRows||[]).find(x=>x.source===source)||{};
   const breakdown=document.createElement('p');breakdown.className='muted';
   breakdown.textContent=count?Number(stats.paid_count||0)+' payées · '+Number(stats.refunded_count||0)+' remboursées · '+Number(stats.failed_count||0)+' échouées · '+Number(stats.cancelled_count||0)+' annulées':'';
   card.append(title,value,detail,breakdown);host.append(card);
  }
  note.textContent=totalCount?'Total indicatif des sources importées : '+euro(totalPaid-totalRefund)+' · '+totalCount+' opérations. Montants bruts payés : '+euro(totalPaid)+' ; remboursements : '+euro(totalRefund)+'. Risque de doubles comptages entre plateformes : totaux non certifiés. Aucun rapprochement avec les adhérents.':'Aucune transaction importée pour cette saison.';
 }catch(e){if(request===externalPaymentRequest)note.textContent='Montants importés indisponibles : '+e.message;}
}
const moneyFields=[['total_cents','Achats'],['gross_cents','Encaissé brut'],['refunded_cents','Remboursements'],['net_cents','Encaissé net'],['future_cents','Échéances futures'],['planned_cents','CA planifié · net + futur'],['overdue_cents','Échues impayées'],['cancelled_cents','Échéances annulées'],['disputed_cents','Montants contestés inclus dans le net']];
const status=(text,error=false)=>{$('status').textContent=text;$('status').className=error?'status error':'status';};
function clear(){externalPaymentRequest++;if($('external-payment-summary'))$('external-payment-summary').replaceChildren();if($('external-payment-status'))$('external-payment-status').textContent='En attente de connexion.';closeMemberProfile();overviewLoaded=false;renderOverview();shirtRefresh++;courseAlertRequest++;$('kpi-course-unlinked').textContent='—';$('kpi-course-attendance').textContent='—';$('kpi-course-status').textContent='Suivi des cours en attente de connexion.';putShirts('—','En attente de connexion');all=[];$('stage-rows').replaceChildren();$('money-summary').replaceChildren();$('money-breakdown').replaceChildren();$('money-alerts').replaceChildren();$('money-alerts').hidden=true;$('rows').replaceChildren();$('data-status').textContent='';$('imports-note').textContent='';$('export').disabled=true;for(const g of ['enfants','ados','adultes'])$('split-'+g).textContent='';for(const id of ['count-enfants','count-ados','count-adultes'])$(id).textContent='0';}
let selectedMember=null;
function closeMemberProfile(){selectedMember=null;$('member-profile').hidden=true;$('member-profile-content').replaceChildren();}
function profileLine(parent,label,value){const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=label+' : ';p.append(strong,document.createTextNode(value===null||value===undefined||value===''?'Non renseigné':String(value)));parent.append(p);}
function profileBlock(parent,title){const block=document.createElement('div');block.className='km16-profile-block';const h=document.createElement('h3');h.textContent=title;block.append(h);parent.append(block);return block;}
$('km16-quick-member-go').onclick=()=>{const query=$('km16-quick-member-input').value.trim();if(!query){$('km16-quick-member-status').textContent='Saisissez un nom, prénom ou e-mail.';return;}group='';for(const b of document.querySelectorAll('[data-group]'))b.setAttribute('aria-pressed','false');$('search').value=query;render();$('km16-quick-member-status').textContent='Recherche appliquée au fichier de la saison sélectionnée.';$('search').scrollIntoView({behavior:'smooth',block:'center'});};
$('km16-quick-member-input').addEventListener('keydown',e=>{if(e.key==='Enter'){$('km16-quick-member-go').click();}});
function openMemberProfile(c){if(!all.includes(c))return;selectedMember=c;const panel=$('member-profile'),body=$('member-profile-content');body.replaceChildren();$('member-profile-title').textContent='Fiche · '+[c.first_name,c.last_name].filter(Boolean).join(' ');$('member-profile-scope').textContent='Saison '+$('season').value+' · '+(c.group||'Groupe à vérifier')+($('test').checked?' · ENVIRONNEMENT TEST':'');const grid=document.createElement('div');grid.className='km16-profile-grid';body.append(grid);
 const info=profileBlock(grid,'Identité et contact');profileLine(info,'Prénom',c.first_name);profileLine(info,'Nom',c.last_name);profileLine(info,'Groupe',c.group);profileLine(info,'E-mail',c.email);profileLine(info,'Téléphone',c.phone);profileLine(info,'Représentant légal',c.guardian_name);profileLine(info,'Adresse',Array.isArray(c.address)?c.address.join(', '):'');
 if(c.external_only&&typeof c.id==='string'&&c.id.startsWith('import:')){
  const edit=profileBlock(grid,'Corriger cette fiche (import externe)');const form=document.createElement('form');form.className='km16-profile-edit';
  const fields=[['first_name','Prénom'],['last_name','Nom'],['birth_date','Date de naissance (AAAA-MM-JJ)'],['email','E-mail'],['phone','Téléphone']];const inputs={};
  for(const [key,label] of fields){const wrap=document.createElement('label');wrap.textContent=label;wrap.style.display='block';wrap.style.marginBottom='8px';const input=document.createElement('input');input.type='text';input.value=String(c[key]||'');input.maxLength=160;input.style.display='block';input.style.width='100%';wrap.append(input);form.append(wrap);inputs[key]=input;}
  const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='Enregistrer les corrections';const msg=document.createElement('p');msg.className='muted';msg.setAttribute('role','status');form.append(save,msg);edit.append(form);
  form.onsubmit=async ev=>{ev.preventDefault();const changes={};for(const [key] of fields){const next=inputs[key].value.trim();if(next!==String(c[key]||''))changes[key]=next;}
   if(!Object.keys(changes).length){msg.textContent='Aucune modification à enregistrer.';return;}
   if(!confirm('Enregistrer les corrections de cette fiche importée ? Les paiements et réservations ne seront pas modifiés.'))return;
   save.disabled=true;msg.textContent='Enregistrement…';const season=$('season').value;
   try{const {error}=await client.rpc('km16_admin_update_external_client',{p_external_id:c.id.slice(7),p_season:season,p_changes:changes});if(error)throw error;Object.assign(c,changes);msg.textContent='Corrections enregistrées. Historique conservé. Actualisez pour recharger le fichier.';save.textContent='Corrections enregistrées';$('member-profile-title').textContent='Fiche · '+[c.first_name,c.last_name].filter(Boolean).join(' ');}
   catch(e){msg.textContent='Enregistrement impossible : '+e.message;save.disabled=false;}
  };
 }
 if(c.external_only&&typeof c.id==='string'&&c.id.startsWith('import:')){
  const management=profileBlock(grid,'Doublons (fusion et archivage sécurisés)');const msg=document.createElement('p');msg.className='muted';msg.textContent='Réservé aux fiches importées. Aucune suppression définitive. Les achats et réservations sont conservés.';management.append(msg);
  const targetLabel=document.createElement('label');targetLabel.textContent='Fiche principale à conserver (fusion)';targetLabel.style.display='block';const select=document.createElement('select');select.style.display='block';select.style.maxWidth='100%';const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Sélectionner une autre fiche';select.append(placeholder);
  for(const other of all.filter(x=>x!==c&&x.external_only&&typeof x.id==='string'&&x.id.startsWith('import:'))){const option=document.createElement('option');option.value=other.id.slice(7);option.textContent=[other.first_name,other.last_name,other.birth_date||'date inconnue',other.id.slice(7)].join(' · ');select.append(option);}targetLabel.append(select);management.append(targetLabel);
  const reasonLabel=document.createElement('label');reasonLabel.textContent='Motif (obligatoire)';reasonLabel.style.display='block';const reason=document.createElement('input');reason.type='text';reason.maxLength=500;reason.placeholder='Ex. double saisie confirmée';reason.style.display='block';reason.style.width='100%';reasonLabel.append(reason);management.append(reasonLabel);
  const merge=document.createElement('button');merge.type='button';merge.textContent='Fusionner vers la fiche sélectionnée';const archive=document.createElement('button');archive.type='button';archive.textContent='Archiver cette fiche';const feedback=document.createElement('p');feedback.className='muted';feedback.setAttribute('role','status');management.append(merge,document.createTextNode(' '),archive,feedback);
  async function act(kind){const why=reason.value.trim();if(why.length<8){feedback.textContent='Préciser un motif d’au moins 8 caractères.';return;}if(kind==='merge'&&!select.value){feedback.textContent='Sélectionner la fiche principale.';return;}const question=kind==='merge'?'Fusionner cette fiche vers '+select.options[select.selectedIndex].text+' ? Les données seront conservées dans l’historique.':'Archiver cette fiche ? Elle disparaîtra du fichier actif mais restera conservée en base.';if(!confirm(question))return;
   merge.disabled=true;archive.disabled=true;feedback.textContent='Traitement en cours…';try{const fn=kind==='merge'?'km16_admin_merge_external_clients':'km16_admin_archive_external_client';const args=kind==='merge'?{p_source:c.id.slice(7),p_target:select.value,p_season:$('season').value,p_reason:why}:{p_external_id:c.id.slice(7),p_season:$('season').value,p_reason:why};const {error}=await client.rpc(fn,args);if(error)throw error;feedback.textContent='Opération enregistrée. Actualisation du fichier…';closeMemberProfile();await load();}catch(e){feedback.textContent='Opération refusée : '+e.message;merge.disabled=false;archive.disabled=false;}}
  merge.onclick=()=>act('merge');archive.onclick=()=>act('archive');
 }
 const individual=profileBlock(grid,'Communiquer directement avec cet adhérent');const address=String(c.email||'').trim();const validAddress=/^[^\\s@<>;,]+@[^\\s@<>;,]+\\.[^\\s@<>;,]+$/.test(address)&&address.length<=254;if(validAddress){const mail=document.createElement('a');mail.href='mailto:'+encodeURIComponent(address)+'?subject='+encodeURIComponent('KM16 · Information concernant votre dossier');mail.textContent='Rédiger un e-mail à '+address;individual.append(mail);const note=document.createElement('p');note.className='muted';note.textContent='Ouvre votre messagerie pour rédiger et confirmer l’envoi. Aucun message n’est envoyé automatiquement depuis cette fiche.';individual.append(note);}else{profileLine(individual,'E-mail','Adresse absente ou à vérifier : corriger la fiche avant de contacter l’adhérent.');}
 const shortcuts=profileBlock(grid,'Actions rapides');const links=[['Voir les réservations et présences','./course-admin.html'],['Vérifier les adhésions','./adhesion.html#admin'],['Communiquer avec cet adhérent','#comm-title']];for(const [label,url] of links){const a=document.createElement('a');a.href=url;a.textContent=label;a.style.display='inline-block';a.style.margin='4px 12px 4px 0';shortcuts.append(a);}const help=document.createElement('p');help.className='muted';help.textContent='Les achats et montants ci-dessous proviennent du fichier clients. Les réservations et justificatifs détaillés restent accessibles dans leurs modules.';shortcuts.append(help);
 const products=profileBlock(grid,'Achats et inscriptions connus');if(!c.products?.length){profileLine(products,'Produits','Aucun produit enregistré dans ce fichier');}else{const ul=document.createElement('ul');ul.className='km16-profile-products';for(const p of c.products){const li=document.createElement('li');li.textContent=[p.title,p.state,p.external?'Montant non intégré':Number.isFinite(p.total_cents)?euro(p.total_cents):'Montant non renseigné'].filter(Boolean).join(' · ');ul.append(li);}products.append(ul);}
 const money=profileBlock(grid,'Situation financière · fichier clients');if(c.external_only){profileLine(money,'Statut','Import externe : montants non intégrés');}else{for(const [key,label] of moneyFields.slice(0,8)){profileLine(money,label,c.forecast_unknown&&['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(key)?'À vérifier':euro(c.amounts?.[key]||0));}if(c.forecast_unknown)profileLine(money,'Prévision','Échéancier incomplet');}
 const notes=profileBlock(grid,'Suivi du dossier');profileLine(notes,'Source',c.source||'KM16');profileLine(notes,'Notes import',c.import_notes);profileLine(notes,'Justificatif tarif',c.saint_jean?'Tarif Saint-Jean : justificatif non validé par ce marquage':'Non applicable');profileLine(notes,'État',!Array.isArray(c.address)||!c.address.length||c.group==='À vérifier'?'Informations à vérifier':'Informations du fichier disponibles');
 const history=profileBlock(grid,'Réservations et présences · dossiers KM16 associés');const historyText=document.createElement('p');historyText.className='muted';historyText.textContent='Chargement de l’historique…';history.append(historyText);
 const ids=[...new Set((c.products||[]).map(p=>p.order_id).filter(id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)))];
 const historyRequest=c.external_only&&typeof c.id==='string'&&c.id.startsWith('import:')?client.rpc('km16_admin_external_attendance',{p_external_id:c.id.slice(7),p_season:$('season').value}):ids.length?client.rpc('km16_admin_member_attendance',{p_order_ids:ids}):null;
 if(!historyRequest){historyText.textContent='Aucun identifiant de dossier exploitable. Les réservations non associées restent dans la console des cours.';}
 else historyRequest.then(({data,error})=>{
  if(selectedMember!==c)return;
  if(error){historyText.textContent='Historique indisponible : '+error.message;return;}
  if(!data?.length){historyText.textContent='Aucune réservation associée à ces dossiers. Les réservations non rapprochées restent dans la console des cours.';return;}
  historyText.textContent=data.length+' réservation(s) associée(s).';const list=document.createElement('ul');list.className='km16-profile-products';for(const x of data){const item=document.createElement('li');item.textContent=[x.session_date?.split('-').reverse().join('/'),x.start_time?.slice(0,5),x.category,x.venue,x.booking_status,x.present===true?'Présent':x.present===false?'Absent':'Présence non renseignée'].filter(Boolean).join(' · ');list.append(item);}history.append(list);
 }).catch(e=>{if(selectedMember===c)historyText.textContent='Historique indisponible : '+e.message;});
 panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'start'});}
$('member-profile-close').onclick=closeMemberProfile;
const matches=c=>{const q=$('search').value.normalize('NFKC').toLocaleLowerCase('fr-FR').trim();return !q||[c.last_name,c.first_name,c.email,c.phone,c.guardian_name,...c.address,c.import_email,c.import_phone,c.additional_addresses,...c.products.map(p=>p.title)].join(' ').normalize('NFKC').toLocaleLowerCase('fr-FR').includes(q);};
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.appendChild(td);return td;}
function renderMoneySummary(){
 const totals=Object.fromEntries(moneyFields.map(([key])=>[key,all.reduce((n,c)=>n+(c.amounts?.[key]||0),0)]));
 const partial=all.some(c=>c.forecast_unknown),forecastKeys=['future_cents','planned_cents','overdue_cents','cancelled_cents'];
 const primary=[['net_cents','Encaissé','Après remboursements'],['future_cents','À venir','Échéances futures vérifiées'],['planned_cents','Total prévu','Encaissé + échéances à venir']];
 $('money-scope').textContent=($('test').checked?'TEST · ':'')+'Saison '+$('season').value+' · Tous les groupes · Hors filtres de recherche';
 $('money-summary').replaceChildren();
 for(const [key,label,hint] of primary){
  const card=document.createElement('div');card.className='money-card';
  const title=document.createElement('div');title.className='money-label';title.textContent=label;
  const value=document.createElement('strong');value.className='money-value';value.textContent=euro(totals[key]);
  const help=document.createElement('p');help.className='muted';help.textContent=hint;card.append(title,value,help);
  if(partial&&forecastKeys.includes(key)){const badge=document.createElement('span');badge.className='money-badge';badge.textContent='Montant partiel';card.append(badge);}
  $('money-summary').append(card);
 }
 const alerts=$('money-alerts');alerts.replaceChildren();
 const messages=[];
 if($('test').checked)messages.push('TEST : aucun de ces montants ne correspond à un encaissement réel.');
 if(totals.overdue_cents)messages.push('Impayés échus : '+euro(totals.overdue_cents)+(partial?' · montant partiel':'')+'.');
 if(totals.disputed_cents)messages.push('Paiements contestés : '+euro(totals.disputed_cents)+' — inclus dans l’encaissé.');
 if(partial)messages.push('Prévision incomplète : certains échéanciers restent à vérifier.');
 for(const message of messages){const p=document.createElement('p');p.textContent=message;alerts.append(p);}alerts.hidden=!messages.length;
 $('money-breakdown').replaceChildren();
 for(const [key,label] of moneyFields.filter(([key])=>!primary.some(([k])=>k===key))){
  const term=document.createElement('dt');term.textContent=label;
  const value=document.createElement('dd');value.textContent=euro(totals[key]);
  if(partial&&forecastKeys.includes(key)){const badge=document.createElement('span');badge.className='money-badge';badge.textContent='Partiel';value.append(badge);}
  $('money-breakdown').append(term,value);
 }
}
function renderMemberQuality(){
 const summary=$('km16-member-quality-summary'),host=$('km16-member-quality-results');if(!summary||!host)return;
 host.replaceChildren();if(!overviewLoaded){summary.textContent='Analyse en attente du fichier adhérents…';return;}
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]/g,'');
 const emailGroups=new Map(),nameGroups=new Map();let missingEmail=0,missingName=0;
 for(const c of all){const email=String(c.email||'').trim().toLocaleLowerCase('fr-FR'),first=norm(c.first_name),last=norm(c.last_name);
  if(email){if(!emailGroups.has(email))emailGroups.set(email,[]);emailGroups.get(email).push(c);}else missingEmail++;
  if(first&&last){const key=first+'|'+last;if(!nameGroups.has(key))nameGroups.set(key,[]);nameGroups.get(key).push(c);}else missingName++;
 }
 const duplicateEmails=[...emailGroups.values()].filter(g=>g.length>1),duplicateNames=[...nameGroups.values()].filter(g=>g.length>1);
 summary.textContent=all.length+' fiches · '+duplicateEmails.length+' groupe(s) avec même e-mail · '+duplicateNames.length+' groupe(s) avec même nom et prénom · '+missingEmail+' sans e-mail · '+missingName+' avec identité incomplète.';
 const groups=[['E-mail identique (partage familial possible)',duplicateEmails],['Nom et prénom identiques (homonymes possibles)',duplicateNames]];
 for(const [label,items] of groups){const details=document.createElement('details'),head=document.createElement('summary');head.textContent=label+' : '+items.length+' groupe(s)';details.append(head);
  if(!items.length){const p=document.createElement('p');p.className='muted';p.textContent='Aucune correspondance détectée.';details.append(p);}else{const ul=document.createElement('ul');ul.className='km16-approval-list';for(const people of items.slice(0,40)){const li=document.createElement('li');for(const c of people){const line=document.createElement('div'),name=document.createElement('span'),btn=document.createElement('button');name.textContent=[c.first_name,c.last_name].filter(Boolean).join(' ')+' · '+(c.email||'e-mail non renseigné')+' · '+(c.source||'KM16');btn.type='button';btn.textContent='Voir la fiche';btn.setAttribute('aria-label','Voir la fiche de '+c.first_name+' '+c.last_name);btn.onclick=()=>{openMemberProfile(c);$('member-profile').scrollIntoView({behavior:'smooth',block:'start'});};line.append(name,document.createTextNode(' '),btn);li.append(line);}ul.append(li);}details.append(ul);if(items.length>40){const p=document.createElement('p');p.className='muted';p.textContent='40 premiers groupes affichés.';details.append(p);}}host.append(details);}
}
function render(){
 if(selectedMember&&!all.includes(selectedMember))closeMemberProfile();renderOverview();communications.update();
 renderMoneySummary();renderMemberQuality();
 $('stage-rows').replaceChildren();for(const m of stagesMonthly(all)){const tr=document.createElement('tr');for(const v of [m.month,m.sold,m.refunded,m.retained,euro(m.amount_cents),euro(m.net_cents)])cell(tr,String(v));$('stage-rows').append(tr);}
 $('rows').replaceChildren();const shown=all.filter(c=>(!group||c.group===group)&&matches(c));$('client-results-count').textContent=shown.length+' fiche(s) affichée(s) sur '+all.length+' pour cette saison et cet environnement.';$('search-clear').hidden=!$('search').value;
 for(const c of shown){const row=document.createElement('tr');cell(row,c.group);
  const name=cell(row,c.last_name+' '+c.first_name);const openProfile=document.createElement('button');openProfile.type='button';openProfile.className='km16-open-profile';openProfile.textContent='Voir la fiche';openProfile.setAttribute('aria-label','Ouvrir la fiche de '+c.first_name+' '+c.last_name);openProfile.onclick=()=>openMemberProfile(c);name.append(openProfile);const tariff=document.createElement('div');tariff.className=c.saint_jean?'tag':'muted';tariff.textContent=c.saint_jean?'Tarif Saint-Jean-de-Passy':c.external_only?'Tarif importé · à confirmer':'Autres tarifs';name.append(tariff);if(c.external_import){const badge=document.createElement('div');badge.className='tag';badge.textContent='Import '+c.source;name.append(badge);}if(c.import_notes){const note=document.createElement('div');note.className='muted';note.textContent=c.import_notes;name.append(note);}if(c.guardian_name){const small=document.createElement('div');small.className='muted';small.textContent='Représentant : '+c.guardian_name;name.append(small);}
  const address=cell(row,c.address.length?c.address.join(', '):'Adresse en attente de facturation');if(c.billing_name){const small=document.createElement('div');small.className='muted';small.textContent='Facturé à : '+c.billing_name;address.append(small);}
  const contact=cell(row,c.email);const phone=document.createElement('div');phone.textContent=c.phone;contact.append(phone);if(c.external_import&&!c.external_only){const extra=document.createElement('div');extra.className='muted';extra.textContent='Coordonnées importées : '+[c.import_email,c.import_phone].filter(Boolean).join(' · ');contact.append(extra);}if(c.emergency_contacts){const extra=document.createElement('div');extra.className='muted';extra.textContent='Urgence : '+c.emergency_contacts;contact.append(extra);}if(c.additional_addresses||c.import_address?.length){const extra=document.createElement('div');extra.className='muted';extra.textContent='Autres coordonnées : '+[c.additional_addresses,c.import_address?.join(', ')].filter(Boolean).join(' · ');address.append(extra);}
  const td=cell(row,'');const ul=document.createElement('ul');for(const p of c.products){const li=document.createElement('li');li.textContent=p.title+(p.external?'':' · '+euro(p.total_cents));if(p.state!=='Acheté'){const state=document.createElement('span');state.className='tag';state.textContent=p.state;li.append(' ',state);}ul.append(li);}td.append(ul);for(const [key] of moneyFields.slice(0,8))cell(row,c.external_only?'Non intégré':c.forecast_unknown&&['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(key)?'À vérifier':euro(c.amounts[key]));if(c.amounts.disputed_cents){const warning=document.createElement('div');warning.className='tag';warning.textContent='Contesté : '+euro(c.amounts.disputed_cents);td.append(warning);}$('rows').append(row);
 }
 if(!shown.length){const row=document.createElement('tr'),td=cell(row,all.length?'Aucun client pour cette sélection':'Aucun achat encaissé dans cet environnement');td.colSpan=13;$('rows').append(row);}
 $('count-enfants').textContent=all.filter(c=>c.group==='Enfants').length;for(const g of ['Enfants','Ados','Adultes']){const rows=all.filter(c=>c.group===g);$('split-'+g.toLowerCase()).textContent=rows.filter(c=>c.saint_jean).length+' Saint-Jean · '+rows.filter(c=>!c.saint_jean).length+' autres tarifs';}
 $('count-ados').textContent=all.filter(c=>c.group==='Ados').length;
 $('count-adultes').textContent=all.filter(c=>c.group==='Adultes').length;
 for(const b of document.querySelectorAll('[data-group]'))b.setAttribute('aria-pressed',String(b.dataset.group===group));
 $('export').disabled=busy||!all.some(matches);
}
async function load(){
 if(busy||session?.user.email?.toLowerCase()!==ADMIN)return;
 refreshExternalPayments();
 busy=true;render();const gen=generation,test=$('test').checked,season=$('season').value;showSeason();controller=new AbortController();
 $('data-status').textContent='Chargement du fichier clients…';
 try{
  const {data:{session:current}}=await client.auth.getSession();if(!current)throw Error('Session expirée');
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'clients',test,season}),signal:controller.signal});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Chargement impossible');
  if(gen!==generation||test!==$('test').checked)return;
  if(!Array.isArray(data.clients)||data.test!==test||data.season!==season)throw Error('Réponse inattendue');
  all=data.clients;overviewLoaded=true;refreshShirtKpi();$('imports-note').textContent=(data.imported_count||0)+' fiches du fichier actif rattachées à cette saison. Les encaissements Sportigo/Fighty ne sont pas intégrés aux totaux ci-dessous ; les identités concordantes sont rapprochées sans ajouter de paiement.';
  for(const value of data.seasons||[]){if(![...$('season').options].some(o=>o.value===value)){const o=document.createElement('option');o.value=value;o.textContent=value;$('season').append(o);}}
  $('test-notice').hidden=!test;
  const missing=all.filter(c=>!c.address.length).length,unchecked=all.filter(c=>c.group==='À vérifier').length;
  $('data-status').textContent=all.length+' pratiquant(s) · Mis à jour à '+new Date(data.updated_at).toLocaleTimeString('fr-FR')+(missing?' · '+missing+' adresse(s) en attente':'')+(unchecked?' · '+unchecked+' âge(s) à vérifier':'')+(all.some(c=>c.forecast_unknown)?' · Prévision incomplète : certains échéanciers n’ont pas pu être vérifiés':'');status('');
 }catch(e){if(gen===generation&&e.name!=='AbortError'){clear();$('data-status').textContent='Chargement interrompu';status(e.message,true);}}
 finally{if(gen===generation){busy=false;render();}}
}
async function authState(s){
 generation++;controller?.abort();busy=false;session=s;clear();communications.reset();
 const admin=s?.user.email?.toLowerCase()===ADMIN;
 $('login').hidden=!!s;$('forbidden').hidden=!s||admin;$('workspace').hidden=!admin;$('stages-panel').hidden=!admin;
 $('password').value='';$('test').checked=false;$('test-notice').hidden=true;group='';$('search').value='';
 if(admin){$('identity').textContent=s.user.email;refreshShirtKpi();refreshCourseAlerts();refreshAdminActionProgress();refreshKm16AutoMail();refreshKm16FollowupDashboard();await load();communications.load();}else{km16ActionRequest++;km16ActionState.clear();km16ActionLoaded=false;km16ActionError='';}
}
$('login-form').onsubmit=async event=>{event.preventDefault();if(!client)return;const button=$('login-button');button.disabled=true;status('');try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;}catch(e){status(e.message,true);}finally{button.disabled=false;$('password').value='';}};
const logout=async()=>{generation++;controller?.abort();clear();await client.auth.signOut();await authState(null);};
$('logout').onclick=logout;$('other-account').onclick=logout;
$('season').onchange=()=>{generation++;controller?.abort();busy=false;clear();showSeason();load();};
$('refresh').onclick=()=>{load();refreshCourseAlerts();};let km16SearchTimer; $('search').oninput=()=>{clearTimeout(km16SearchTimer);km16SearchTimer=setTimeout(render,160);};$('search-clear').onclick=()=>{$('search').value='';render();$('search').focus();};
$('all').onclick=()=>{group='';render();};
for(const b of document.querySelectorAll('[data-group]'))b.onclick=()=>{group=b.dataset.group;render();};
$('test').onchange=()=>{generation++;controller?.abort();busy=false;clear();load();};
$('export').onclick=()=>{try{const rows=all.filter(matches);if(!rows.length)return;const bytes=clientsWorkbook(rows,all);const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=($('test').checked?'TEST-':'')+'KM16-Clients-'+$('season').value.replace('/','-')+'-'+new Date().toISOString().slice(0,10)+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Export créé : Enfants, Ados, Adultes, Synthèse et Stages par mois.');}catch(e){status(e.message,true);}};
if(!client)status('Connexion indisponible : rechargez la page',true);
else{client.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>authState(s),0);});const {data}=await client.auth.getSession();await authState(data.session);}
setInterval(()=>{if(!document.hidden)load();},60000);
