import {initAdminMfa} from './admin-mfa.mjs?v=enrollment-20261123';
import {withClubPayments, clubAmountKnown, clubPaymentLabel} from './club-payments.mjs';
import {initCommunications} from './communications.mjs?v=ages-5-8';
import {SEASON,seasonState,parisDate} from './seasons.mjs?v=1';
import {clientsWorkbook,stagesMonthly} from './clients-excel.mjs?v=club-20261119';
const $=id=>document.getElementById(id),ADMIN='alexandre.marchat@gmail.com';
const client=window.supabase?.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
const resetAdminMfa=initAdminMfa(client?.auth, $('km16-admin-mfa'));
const mfaGate=$('km16-login-mfa');
const resetLoginMfa=initAdminMfa(client?.auth,mfaGate,{login:true});
let authRevision=0;
const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-clients';
let sourceClients=[],clubPayments=[],clubRegistrationRequest=0,clubRegistrationPending;
let lastSupplementaryRefresh=0;
const clubRegistrationTable = 'km16_club_registrations';
const clubRegistrationScope = () => ({season_id: $('season').value, test: $('test').checked});
let session=null,all=[],group='',generation=0,busy=false,controller=null;
const clientPageSize=50;
let clientPage=0;
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
  const {data,error}=await client.rpc('km16_admin_course_alert_counts').single();
  if(error)throw error;
  if(!Number.isSafeInteger(data?.unlinked)||data.unlinked<0||
     !Number.isSafeInteger(data?.attendance_due)||data.attendance_due<0)throw Error('Compteurs de cours invalides');
  put(String(data.unlinked),String(data.attendance_due),'Suivi des cours actualisé à '+new Date().toLocaleTimeString('fr-FR')+'.');
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
async function refreshKm16AutoMail(){const ticket=++km16AutoMailRequest,host=$('km16-auto-mail-list');if(!host)return;host.replaceChildren();$('km16-auto-mail-status').textContent='Chargement du journal des campagnes…';if(session?.user?.email?.toLowerCase()!==ADMIN){$('km16-auto-mail-status').textContent='Connexion administrateur requise.';return;}
 try{const {data,error}=await client.rpc('km16_admin_scheduled_campaigns_list');if(error)throw error;if(ticket!==km16AutoMailRequest)return;const ul=document.createElement('ul');ul.className='km16-approval-list';for(const c of data||[]){const li=document.createElement('li'),label=document.createElement('span'),btn=document.createElement('button');label.textContent=km16DateFr(c.send_on)+' · '+c.subject+' · '+(c.prepared_at?'Envoi lancé':c.approved?'Activée':'À activer')+' · '+c.accepted+'/'+c.total+' accepté(s) par OVH'+(Number(c.failed)?' · '+c.failed+' échec(s) ou incertain(s)':'');li.append(label);if(!c.prepared_at){btn.type='button';btn.textContent=c.approved?'Désactiver':'Activer l’envoi automatique';btn.onclick=async()=>{if($('test').checked){$('km16-auto-mail-status').textContent='Désactive le mode test pour modifier une campagne réelle.';return;}if(!confirm((c.approved?'Désactiver':'Activer')+' la campagne « '+c.subject+' » prévue le '+km16DateFr(c.send_on)+' ?'+(!c.approved?' Elle sera envoyée sans nouvelle confirmation à cette date.':'')))return;btn.disabled=true;try{const {error}=await client.rpc('km16_admin_scheduled_campaign_approve',{p_id:c.id,p_approve:!c.approved});if(error)throw error;await refreshKm16AutoMail();}catch(e){$('km16-auto-mail-status').textContent='Action impossible : '+e.message;btn.disabled=false;}};li.append(btn);}ul.append(li);}host.append(ul);$('km16-auto-mail-status').textContent=(data||[]).filter(c=>c.approved&&!c.prepared_at).length+' campagne(s) activée(s) · '+(data||[]).filter(c=>c.prepared_at).length+' campagne(s) lancée(s).';}catch(e){if(ticket===km16AutoMailRequest)$('km16-auto-mail-status').textContent='Journal indisponible : '+e.message;}}
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
let km16HealthRequest=0;
async function refreshKm16HealthDocuments(){
 const request=++km16HealthRequest;
 const count=$('km16-health-count'),status=$('km16-health-status'),host=$('km16-health-list');
 count.textContent='—';host.replaceChildren();
 if(session?.user?.email?.toLowerCase()!==ADMIN){status.textContent='Connexion administrateur requise.';return;}
 status.textContent='Chargement des certificats médicaux…';
 try{
  const {data,error}=await client.rpc('km16_admin_health_documents',{p_season:$('season').value});
  if(request!==km16HealthRequest)return;
  if(error)throw error;
  const missing=data.filter(row=>row.state==='missing').length;
  const review=data.length-missing;
  count.textContent=missing+' manquant(s) · '+review+' à vérifier';
  status.textContent=data.length?'Dossiers réels de la saison sélectionnée, y compris ceux déjà validés administrativement.':'Aucun certificat manquant ou à vérifier pour cette saison.';
  for(const row of data){
   const item=document.createElement('li');
   item.textContent=[row.first_name,row.last_name].filter(Boolean).join(' ')+' · '+(row.state==='missing'?'Certificat manquant':'Certificat reçu · à vérifier');
   host.append(item);
  }
 }catch{
  if(request===km16HealthRequest)status.textContent='Suivi des certificats indisponible. Actualise le tableau de bord pour réessayer.';
 }
}
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
$('km16-daily-refresh').onclick=()=>{refreshCourseAlerts();refreshAdminActionProgress();refreshKm16AutoMail();refreshKm16FollowupDashboard();refreshKm16HealthDocuments();load();renderKm16Daily();};
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
 const total=pending.reduce((sum,t)=>sum+t.count,0);
 const knownCount=count=>unknown.length===tasks.length?'—':unknown.length&&count>0?'≥ '+count:unknown.length?'—':String(count);
 $('km16-priorities-total').textContent=$('km16-dashboard-priority-count').textContent=knownCount(total);
 $('km16-priorities-categories').textContent=knownCount(pending.length);
 $('km16-priorities-status').textContent=(unknown.length?'Données partielles : '+unknown.map(t=>t.label).join(', ')+'. ':'')+(!pending.length&&!unknown.length?'Aucune alerte en attente. ':'')+(km16ActionError?'Erreur de synchronisation : '+km16ActionError:km16ActionLoaded?'Suivi « En cours » synchronisé entre appareils. Il ne valide aucun dossier.':'Chargement du suivi partagé…');
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
$('km16-priorities-refresh').onclick=()=>{refreshCourseAlerts();refreshAdminActionProgress();load();};
let overviewLoaded=false,shirtRefresh=0;
function renderApprovalDossiers(){const host=$('km16-dossiers-list'),count=$('km16-dossiers-count');host.replaceChildren();if(!overviewLoaded){count.textContent='Chargement des dossiers…';return;}const dossiers=[];const seen=new Set();for(const c of all){for(const p of c.products||[]){if(p.external||p.approval!=='pending'||!p.order_id||seen.has(p.order_id))continue;seen.add(p.order_id);dossiers.push({client:c,product:p});}}count.textContent=dossiers.length+' dossier(s) avec validation administrative en attente · Saison '+$('season').value+($('test').checked?' · Mode test':'');if(!dossiers.length){const p=document.createElement('p');p.className='muted';p.textContent='Aucune validation administrative en attente parmi les achats présents dans ce fichier.';host.append(p);return;}const ul=document.createElement('ul');ul.className='km16-approval-list';const dossierRows=document.createDocumentFragment();for(const d of dossiers){const li=document.createElement('li');const label=document.createElement('span');label.textContent=[d.client.first_name,d.client.last_name].filter(Boolean).join(' ')+' · '+d.product.title+' · '+euro(d.product.net_cents||0)+' encaissé(s)';const a=document.createElement('a');a.href='./adhesion-admin.html?admin_order='+encodeURIComponent(d.product.order_id)+'#admin';a.textContent='Vérifier / valider le dossier';a.setAttribute('aria-label','Ouvrir la validation administrative de '+d.client.first_name+' '+d.client.last_name);li.append(label,a);dossierRows.append(li);}ul.append(dossierRows);host.append(ul);}

let processingItems=[], processingStatus='', processingRequest=0, processingReady=false;
function openDashboardTask(){
 const id=location.hash.slice(1);
 if(id==='km16-to-process'||id==='km16-health-documents')$(id).open=true;
}
window.addEventListener('hashchange',openDashboardTask);
openDashboardTask();
function renderProcessingItems(){
 const host=$('km16-to-process-list');
 host.replaceChildren();
 const rows=[];
 const seen=new Set();
 if(overviewLoaded){
  for(const member of all){
   for(const product of member.products||[]){
    if(product.external||product.approval!=='pending'||!product.order_id||seen.has(product.order_id))continue;
    seen.add(product.order_id);
    rows.push({
     label:[member.first_name,member.last_name,product.title].filter(Boolean).join(' · '),
     detail:'Validation et justificatifs à vérifier',
     href:'./adhesion-admin.html?admin_order='+encodeURIComponent(product.order_id)+'#admin',
     action:'Vérifier le dossier',
    });
   }
  }
 }
 for(const item of processingItems){
  const payment=item.kind==='payment';
  rows.push({
   label:item.label, detail:item.detail,
   href:payment?'./course-operations.html?vue=paiements&saison='+encodeURIComponent($('season').value):'#km16-email-relances',
   action:payment?'Rapprocher les paiements':'Ouvrir le suivi des e-mails',
  });
 }
 $('km16-processing-payments').href='./course-operations.html?vue=paiements&saison='+encodeURIComponent($('season').value);
 const capped=['payment','email'].some(kind=>processingItems.filter(item=>item.kind===kind).length>=100);
 const partial=capped||!processingReady||!overviewLoaded;
 $('km16-processing-count').textContent=rows.length?(partial?'≥ ':'')+rows.length:partial?'—':'0';
 for(const row of rows){
  const item=document.createElement('li');
  const label=document.createElement('span');
  label.textContent=row.label+' — '+row.detail;
  const link=document.createElement('a');
  link.href=row.href;link.textContent=row.action;
  if(row.href==='#km16-email-relances')link.addEventListener('click',()=>void refreshKm16EmailAlerts(false));
  item.append(label,link);host.append(item);
 }
 $('km16-to-process-status').textContent=processingStatus||
  (overviewLoaded?(rows.length?rows.length+' élément(s) affiché(s).':'Aucune action détectée.'):'Chargement des dossiers…');
}
async function refreshProcessingItems(){
 const request=++processingRequest;
 processingItems=[];processingReady=false;
 const test=$('test').checked;
 processingStatus=test?'Mode test · dossiers de test uniquement.':'Chargement des paiements et des e-mails…';
 renderProcessingItems();
 if(test){processingReady=true;renderProcessingItems();return;}
 try{
  const {data,error}=await client.rpc('km16_admin_processing_items',{p_season:$('season').value});
  if(request!==processingRequest)return;
  if(error)throw error;
  processingItems=data||[];processingReady=true;
  processingStatus=processingItems.filter(i=>i.kind==='payment').length===100||processingItems.filter(i=>i.kind==='email').length===100?'Les 100 opérations les plus récentes sont affichées par catégorie.':'';
 }catch{
  if(request!==processingRequest)return;
  processingStatus='Les paiements ou les e-mails sont temporairement indisponibles.';
 }
 renderProcessingItems();
}

let stageReminderRequest=0;
const reminderDate = new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'});
async function refreshStageReminders(){
 const request=++stageReminderRequest;
 const host=$('km16-stage-reminders-rows'),status=$('km16-stage-reminders-status');
 host.replaceChildren();
 if(session?.user?.email?.toLowerCase()!==ADMIN)return;
 status.textContent='Chargement des rappels…';
 try{
  const {data,error}=await client.rpc('km16_admin_stage_reminders',{p_season:$('season').value});
  if(request!==stageReminderRequest)return;
  if(error)throw error;
  for(const reminder of data||[]){
   const tr=document.createElement('tr');
   const planned=reminder.planned_at?reminderDate.format(new Date(reminder.planned_at)):'Horaire à renseigner';
   const started=reminder.started_at?reminderDate.format(new Date(reminder.started_at)):'—';
   const cells=[reminder.title,reminder.channel,planned,started,reminder.targets,reminder.accepted,reminder.failures,reminder.registrations??'—'];
   for(const value of cells){
    const td=document.createElement('td');
    td.textContent=String(value);tr.append(td);
   }
   host.append(tr);
  }
  status.textContent=data?.length?'Heure de Paris · Horaire indicatif pour les e-mails.':'Aucun rappel pour cette saison.';
 }catch{
  if(request===stageReminderRequest)status.textContent='Le suivi des rappels est temporairement indisponible.';
 }
}
$('km16-stage-reminders-refresh').onclick=refreshStageReminders;
window.addEventListener('hashchange',()=>{
 if(session?.user?.email?.toLowerCase()!==ADMIN)return;
 if(location.hash==='#km16-stage-reminders')void refreshStageReminders();
 if(['#km16-daily-dashboard','#km16-to-process','#workspace',''].includes(location.hash))void refreshProcessingItems();
});

function renderOverview(){renderApprovalDossiers();renderProcessingItems();const put=(id,v)=>{$(id).textContent=v;};if(!overviewLoaded){for(const id of ['kpi-members','kpi-net','kpi-review'])put(id,'—');renderPriorities();return;}const pendingOrders=new Set();for(const c of all){for(const p of c.products||[]){if(!p.external&&p.approval==='pending'&&p.order_id)pendingOrders.add(p.order_id);}}const review=pendingOrders.size;put('kpi-members',String(all.length));put('kpi-net',euro(all.reduce((sum,c)=>sum+(c.amounts?.net_cents||0),0)));put('kpi-review',String(review));$('kpi-members-note').textContent='Fiches du fichier · saison '+$('season').value;$('kpi-net-note').textContent=($('test').checked?'Mode TEST · ':'')+'Hors imports Sportigo/Fighty et boutique';$('kpi-review-note').textContent='Validations administratives en attente · '+($('test').checked?'mode test':'achats réels');$('kpi-updated').textContent='Données du fichier actualisées à '+new Date().toLocaleTimeString('fr-FR');renderPriorities();}
async function refreshShirtKpi(){if(session?.user.email?.toLowerCase()!==ADMIN)return;const ticket=++shirtRefresh;putShirts('…','Consultation des commandes réelles…');try{const {data:{session:current}}=await client.auth.getSession();if(!current)throw Error('Session expirée');const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-shirts',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'list'})});const data=await r.json();if(!r.ok||!Array.isArray(data.orders))throw Error(data.error||'Commandes indisponibles');if(ticket!==shirtRefresh)return;const pending=data.orders.filter(o=>o.livemode===true&&o.status==='paid'&&!o.collected_at).length;putShirts(String(pending),'Commandes réelles payées · non retirées');}catch(e){if(ticket===shirtRefresh)putShirts('—','Données indisponibles · ouvrir la boutique');}}
function putShirts(value,note){$('kpi-shirts').textContent=value;$('kpi-shirts-note').textContent=note;renderPriorities();}
const euroFormatter=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'});
const euro=n=>euroFormatter.format(n/100);
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
function clear(){clientPage=0;$('client-pagination').hidden=true;lastSupplementaryRefresh=0;sourceClients=[];clubPayments=[];clubRegistrationRequest++;resetClubClientChoice();$('club-registration-list')?.replaceChildren();clubPaymentTotals=null;clubPaymentTotalsError=false;processingRequest++;stageReminderRequest++;processingItems=[];processingStatus='';processingReady=false;$('km16-stage-reminders-rows').replaceChildren();externalPaymentRequest++;if($('external-payment-summary'))$('external-payment-summary').replaceChildren();if($('external-payment-status'))$('external-payment-status').textContent='En attente de connexion.';closeMemberProfile();overviewLoaded=false;renderOverview();shirtRefresh++;courseAlertRequest++;$('kpi-course-unlinked').textContent='—';$('kpi-course-attendance').textContent='—';$('kpi-course-status').textContent='Suivi des cours en attente de connexion.';putShirts('—','En attente de connexion');all=[];$('stage-rows').replaceChildren();$('money-summary').replaceChildren();$('money-breakdown').replaceChildren();$('money-alerts').replaceChildren();$('money-alerts').hidden=true;$('rows').replaceChildren();$('data-status').textContent='';$('imports-note').textContent='';$('export').disabled=true;for(const g of ['enfants','ados','adultes'])$('split-'+g).textContent='';for(const id of ['count-enfants','count-ados','count-adultes'])$(id).textContent='0';}
let selectedMember=null;
function closeMemberProfile(){selectedMember=null;$('member-profile').hidden=true;$('member-profile-content').replaceChildren();}
function profileLine(parent,label,value){const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=label+' : ';p.append(strong,document.createTextNode(value===null||value===undefined||value===''?'Non renseigné':String(value)));parent.append(p);}
function profileBlock(parent,title){const block=document.createElement('div');block.className='km16-profile-block';const h=document.createElement('h3');h.textContent=title;block.append(h);parent.append(block);return block;}
$('km16-quick-member-go').onclick=()=>{const query=$('km16-quick-member-input').value.trim();if(!query){$('km16-quick-member-status').textContent='Saisissez un nom, prénom ou e-mail.';return;}group='';for(const b of document.querySelectorAll('[data-group]'))b.setAttribute('aria-pressed','false');$('search').value=query;renderFirstClientPage();$('km16-quick-member-status').textContent='Recherche appliquée au fichier de la saison sélectionnée.';$('search').scrollIntoView({behavior:'smooth',block:'center'});};
$('km16-quick-member-input').addEventListener('keydown',e=>{if(e.key==='Enter'){$('km16-quick-member-go').click();}});
function createProfileTabs(body){
 const tabList=document.createElement('div');
 tabList.className='km16-profile-tabs';
 tabList.setAttribute('role','tablist');
 tabList.setAttribute('aria-label','Rubriques de la fiche adhérent');
 body.append(tabList);
 const tabs=[];
 const panels={};
 function activate(index,focus=false){
  tabs.forEach(({button,panel},position)=>{
   const active=position===index;
   button.setAttribute('aria-selected',String(active));
   button.tabIndex=active?0:-1;
   panel.hidden=!active;
  });
  if(focus)tabs[index].button.focus();
 }
 for(const [key,label] of [['identity','Civilité'],['subscription','Abonnement'],['billing','Factures'],['file','Dossier'],['attendance','Présences']]){
  const button=document.createElement('button');
  const panel=document.createElement('div');
  const index=tabs.length;
  button.type='button';
  button.id='profile-tab-'+key;
  button.textContent=label;
  button.setAttribute('role','tab');
  button.setAttribute('aria-controls','profile-panel-'+key);
  panel.id='profile-panel-'+key;
  panel.className='km16-profile-grid';
  panel.setAttribute('role','tabpanel');
  panel.setAttribute('aria-labelledby',button.id);
  panel.tabIndex=0;
  button.onclick=()=>activate(index);
  button.onkeydown=event=>{
   const next={ArrowRight:(index+1)%tabs.length,ArrowLeft:(index+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
   if(next===undefined)return;
   event.preventDefault();
   activate(next,true);
  };
  tabs.push({button,panel});
  panels[key]=panel;
  tabList.append(button);
  body.append(panel);
 }
 activate(0);
 return panels;
}
function addInvoiceResend(block,member){
 const test=$('test').checked;
 const orders=[...new Set((member.products||[]).filter(product=>!product.external)
  .map(product=>product.order_id).filter(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)))];
 const status=document.createElement('p');
 status.className='muted';
 status.setAttribute('role','status');
 block.append(status);
 if(!orders.length){
  status.textContent='Aucun dossier de facturation KM16 associé.';
  return;
 }
 async function request(body){
  const {data,error}=await client.functions.invoke('km16-invoice-resend',{body:{...body,test}});
  if(error){
   const result=await error.context?.json?.().catch(()=>null);
   throw Error(result?.error||'Service de facturation indisponible.');
  }
  return data;
 }
 const load=document.createElement('button');
 load.type='button';
 load.textContent='Afficher les factures';
 block.append(load);
 load.onclick=async()=>{
  load.disabled=true;
  status.textContent='Recherche des factures…';
  try{
   const invoices=[];
   for(let start=0;start<orders.length;start+=50){
    const result=await request({action:'list',order_ids:orders.slice(start,start+50)});
    invoices.push(...result.invoices);
   }
   if(!invoices.length){
    status.textContent='Aucune facture PDF enregistrée pour ces dossiers.';
    return;
   }
   const list=document.createElement('ul');
   list.className='km16-profile-products';
   for(const invoice of invoices){
    const item=document.createElement('li');
    const button=document.createElement('button');
    button.type='button';
    button.textContent='Renvoyer la facture';
    button.setAttribute('aria-label','Renvoyer la facture '+invoice.number);
    button.disabled=!invoice.recipient;
    const feedback=document.createElement('p');
    feedback.setAttribute('role','status');
    item.append(document.createTextNode(invoice.number+' · '+new Date(invoice.issued_at).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'})+' · '+(invoice.recipient||'Adresse indisponible')+' '),button,feedback);
    button.onclick=async()=>{
     if(selectedMember!==member||!confirm('Renvoyer la facture '+invoice.number+' à '+invoice.recipient+' ?'))return;
     button.disabled=true;
     feedback.textContent='Envoi en cours…';
     try{
      const result=await request({action:'resend',number:invoice.number,recipient:invoice.recipient});
      if(!result?.sent)throw Error('Envoi non confirmé.');
      feedback.textContent='Facture renvoyée à '+invoice.recipient+'.';
     }catch(error){
      feedback.textContent=error.message;
     }finally{
      button.disabled=false;
     }
    };
    list.append(item);
   }
   load.replaceWith(list);
   status.textContent='';
  }catch(error){
   status.textContent=error.message;
  }finally{
   load.disabled=false;
  }
 };
}
function openMemberProfile(c){if(!all.includes(c))return;selectedMember=c;const panel=$('member-profile'),body=$('member-profile-content');body.replaceChildren();$('member-profile-title').textContent='Fiche · '+[c.first_name,c.last_name].filter(Boolean).join(' ');$('member-profile-scope').textContent='Saison '+$('season').value+' · '+(c.group||'Groupe à vérifier')+($('test').checked?' · ENVIRONNEMENT TEST':'');const {identity,subscription,billing,file,attendance}=createProfileTabs(body);
 const info=profileBlock(identity,'Identité et contact');profileLine(info,'Civilité',c.civility||c.civilite);profileLine(info,'Date de naissance',typeof c.birth_date==='string'?c.birth_date.split('-').reverse().join('/'):null);profileLine(info,'Prénom',c.first_name);profileLine(info,'Nom',c.last_name);profileLine(info,'Groupe',c.group);profileLine(info,'E-mail',c.email);profileLine(info,'Téléphone',c.phone);profileLine(info,'Représentant légal',c.guardian_name);profileLine(info,'Adresse',Array.isArray(c.address)?c.address.join(', '):'');
 if(c.external_only&&typeof c.id==='string'&&c.id.startsWith('import:')){
  const edit=profileBlock(identity,'Corriger cette fiche (import externe)');const form=document.createElement('form');form.className='km16-profile-edit';
  const fields=[['first_name','Prénom'],['last_name','Nom'],['birth_date','Date de naissance (AAAA-MM-JJ)'],['email','E-mail'],['phone','Téléphone']];const inputs={};
  for(const [key,label] of fields){const wrap=document.createElement('label');wrap.textContent=label;wrap.style.display='block';wrap.style.marginBottom='8px';const input=document.createElement('input');input.type='text';input.value=String(c[key]||'');input.maxLength=160;input.style.display='block';input.style.width='100%';wrap.append(input);form.append(wrap);inputs[key]=input;}
  const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='Enregistrer les corrections';const msg=document.createElement('p');msg.className='muted';msg.setAttribute('role','status');form.append(save,msg);edit.append(form);
  form.onsubmit=async ev=>{ev.preventDefault();const changes={};for(const [key] of fields){const next=inputs[key].value.trim();if(next!==String(c[key]||''))changes[key]=next;}
   if(!Object.keys(changes).length){msg.textContent='Aucune modification à enregistrer.';return;}
   if(!confirm('Enregistrer les corrections de cette fiche importée ? Les paiements et réservations ne seront pas modifiés.'))return;
   save.disabled=true;msg.textContent='Enregistrement…';const season=$('season').value;
   try{const {error}=await client.rpc('km16_admin_update_external_client',{p_external_id:c.id.slice(7),p_season:season,p_changes:changes});if(error)throw error;Object.assign(c,changes);clientSearchText.set(c,buildClientSearchText(c));msg.textContent='Corrections enregistrées. Historique conservé. Actualisez pour recharger le fichier.';save.textContent='Corrections enregistrées';$('member-profile-title').textContent='Fiche · '+[c.first_name,c.last_name].filter(Boolean).join(' ');}
   catch(e){msg.textContent='Enregistrement impossible : '+e.message;save.disabled=false;}
  };
 }
 if(c.external_only&&typeof c.id==='string'&&c.id.startsWith('import:')){
  const management=profileBlock(file,'Doublons (fusion et archivage sécurisés)');const msg=document.createElement('p');msg.className='muted';msg.textContent='Réservé aux fiches importées. Aucune suppression définitive. Les achats et réservations sont conservés.';management.append(msg);
  const targetLabel=document.createElement('label');targetLabel.textContent='Fiche principale à conserver (fusion)';targetLabel.style.display='block';const select=document.createElement('select');select.style.display='block';select.style.maxWidth='100%';const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Sélectionner une autre fiche';select.append(placeholder);
  for(const other of all.filter(x=>x!==c&&x.external_only&&typeof x.id==='string'&&x.id.startsWith('import:'))){const option=document.createElement('option');option.value=other.id.slice(7);option.textContent=[other.first_name,other.last_name,other.birth_date||'date inconnue',other.id.slice(7)].join(' · ');select.append(option);}targetLabel.append(select);management.append(targetLabel);
  const reasonLabel=document.createElement('label');reasonLabel.textContent='Motif (obligatoire)';reasonLabel.style.display='block';const reason=document.createElement('input');reason.type='text';reason.maxLength=500;reason.placeholder='Ex. double saisie confirmée';reason.style.display='block';reason.style.width='100%';reasonLabel.append(reason);management.append(reasonLabel);
  const merge=document.createElement('button');merge.type='button';merge.textContent='Fusionner vers la fiche sélectionnée';const archive=document.createElement('button');archive.type='button';archive.textContent='Archiver cette fiche';const feedback=document.createElement('p');feedback.className='muted';feedback.setAttribute('role','status');management.append(merge,document.createTextNode(' '),archive,feedback);
  async function act(kind){const why=reason.value.trim();if(why.length<8){feedback.textContent='Préciser un motif d’au moins 8 caractères.';return;}if(kind==='merge'&&!select.value){feedback.textContent='Sélectionner la fiche principale.';return;}const question=kind==='merge'?'Fusionner cette fiche vers '+select.options[select.selectedIndex].text+' ? Les données seront conservées dans l’historique.':'Archiver cette fiche ? Elle disparaîtra du fichier actif mais restera conservée en base.';if(!confirm(question))return;
   merge.disabled=true;archive.disabled=true;feedback.textContent='Traitement en cours…';try{const fn=kind==='merge'?'km16_admin_merge_external_clients':'km16_admin_archive_external_client';const args=kind==='merge'?{p_source:c.id.slice(7),p_target:select.value,p_season:$('season').value,p_reason:why}:{p_external_id:c.id.slice(7),p_season:$('season').value,p_reason:why};const {error}=await client.rpc(fn,args);if(error)throw error;feedback.textContent='Opération enregistrée. Actualisation du fichier…';closeMemberProfile();await load();}catch(e){feedback.textContent='Opération refusée : '+e.message;merge.disabled=false;archive.disabled=false;}}
  merge.onclick=()=>act('merge');archive.onclick=()=>act('archive');
 }
 const individual=profileBlock(identity,'Communiquer directement avec cet adhérent');const address=String(c.email||'').trim();const validAddress=/^[^\\s@<>;,]+@[^\\s@<>;,]+\\.[^\\s@<>;,]+$/.test(address)&&address.length<=254;if(validAddress){const mail=document.createElement('a');mail.href='mailto:'+encodeURIComponent(address)+'?subject='+encodeURIComponent('KM16 · Information concernant votre dossier');mail.textContent='Rédiger un e-mail à '+address;individual.append(mail);const note=document.createElement('p');note.className='muted';note.textContent='Ouvre votre messagerie pour rédiger et confirmer l’envoi. Aucun message n’est envoyé automatiquement depuis cette fiche.';individual.append(note);}else{profileLine(individual,'E-mail','Adresse absente ou à vérifier : corriger la fiche avant de contacter l’adhérent.');}
 const dossierLink=document.createElement('a');dossierLink.href='./adhesion-admin.html#admin';dossierLink.textContent='Ouvrir la gestion des adhésions et des justificatifs';profileBlock(file,'Validation administrative').append(dossierLink);
 const courseLink=document.createElement('a');courseLink.href='./course-admin.html';courseLink.textContent='Ouvrir la console des cours';profileBlock(attendance,'Gestion des cours').append(courseLink);
 const plan=profileBlock(subscription,'Saison et groupe');profileLine(plan,'Saison',$('season').value);profileLine(plan,'Groupe',c.group);
 const invoice=profileBlock(billing,'Factures KM16');
 addInvoiceResend(invoice,c);
 profileLine(invoice,'Adresse de facturation',Array.isArray(c.address)?c.address.join(', '):'');
 const products=profileBlock(subscription,'Achats et inscriptions connus');if(!c.products?.length){profileLine(products,'Produits','Aucun produit enregistré dans ce fichier');}else{const ul=document.createElement('ul');ul.className='km16-profile-products';for(const p of c.products){const li=document.createElement('li');li.textContent=[p.title,p.state,p.external?'Montant non intégré':Number.isFinite(p.total_cents)?euro(p.total_cents):'Montant non renseigné'].filter(Boolean).join(' · ');ul.append(li);}products.append(ul);}
 const money=profileBlock(billing,'Situation financière · fichier clients');if(c.external_only)profileLine(money,'Statut','Encaissements des plateformes externes non intégrés');{for(const [key,label] of moneyFields.slice(0,8)){profileLine(money,label,!clubAmountKnown(c,key)?'Non intégré':c.forecast_unknown&&['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(key)?'À vérifier':euro(c.amounts?.[key]||0));}if(c.forecast_unknown)profileLine(money,'Prévision','Échéancier incomplet');}
 const notes=profileBlock(file,'Suivi du dossier');profileLine(notes,'Source',c.source||'KM16');profileLine(notes,'Notes import',c.import_notes);profileLine(notes,'Justificatif tarif',c.saint_jean?'Tarif Saint-Jean : justificatif non validé par ce marquage':'Non applicable');profileLine(notes,'État',!Array.isArray(c.address)||!c.address.length||c.group==='À vérifier'?'Informations à vérifier':'Informations du fichier disponibles');
 const history=profileBlock(attendance,'Réservations et présences · dossiers KM16 associés');const historyText=document.createElement('p');historyText.className='muted';historyText.textContent='Chargement de l’historique…';history.append(historyText);
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
const normalizeSearch=value=>value.normalize('NFKC').toLocaleLowerCase('fr-FR');
const buildClientSearchText=c=>normalizeSearch([
 c.last_name,c.first_name,c.email,c.phone,c.guardian_name,...c.address,
 c.import_email,c.import_phone,c.additional_addresses,...c.products.map(p=>p.title)
].join(' '));
const clientSearchText=new WeakMap();
function setClients(rows){
 for(const row of rows){
  if(!clientSearchText.has(row))clientSearchText.set(row,buildClientSearchText(row));
 }
 all=rows;
}
const searchQuery=()=>normalizeSearch($('search').value).trim();
const matches=(c,query)=>!query||clientSearchText.get(c).includes(query);
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.appendChild(td);return td;}
let clubPaymentTotals = null;
let clubPaymentTotalsError = false;

function renderMoneySummary(){
 const totals=Object.fromEntries(moneyFields.map(([key])=>[key,0]));
 let partial=false;
 for(const c of all){if(c.forecast_unknown)partial=true;for(const key of Object.keys(totals))totals[key]+=c.amounts?.[key]||0;}
 const includeClubPayments = Boolean($('club-registration-form'));
 const clubPartial = includeClubPayments && !clubPaymentTotals;
 const forecastKeys=['future_cents','planned_cents','overdue_cents','cancelled_cents'];
 const primary=[['net_cents','Encaissé','Après remboursements'],['future_cents','À venir','Échéances futures vérifiées'],['planned_cents','Total prévu','Encaissé + échéances à venir']];
 $('money-scope').textContent=($('test').checked?'TEST · ':'')+'Saison '+$('season').value+' · Tous les groupes · Hors filtres de recherche';
 $('money-summary').replaceChildren();
 for(const [key,label,hint] of primary){
  const card=document.createElement('div');card.className='money-card';
  const title=document.createElement('div');title.className='money-label';title.textContent=label;
  const value=document.createElement('strong');value.className='money-value';value.textContent=euro(totals[key]);
  const help=document.createElement('p');help.className='muted';help.textContent=hint;card.append(title,value,help);
  if((partial&&forecastKeys.includes(key))||(clubPartial&&['net_cents','planned_cents'].includes(key))){const badge=document.createElement('span');badge.className='money-badge';badge.textContent='Montant partiel';card.append(badge);}
  $('money-summary').append(card);
 }
 const alerts=$('money-alerts');alerts.replaceChildren();
 const messages=[];
 if($('test').checked)messages.push('TEST : aucun de ces montants ne correspond à un encaissement réel.');
 if (clubPartial) messages.push(clubPaymentTotalsError
  ? 'Règlements au club indisponibles. Actualise pour charger les montants.'
  : 'Chargement des règlements au club…');
 if(totals.overdue_cents)messages.push('Impayés échus : '+euro(totals.overdue_cents)+(partial?' · montant partiel':'')+'.');
 if(totals.disputed_cents)messages.push('Paiements contestés : '+euro(totals.disputed_cents)+' — inclus dans l’encaissé.');
 if(partial)messages.push('Prévision incomplète : certains échéanciers restent à vérifier.');
 for(const message of messages){const p=document.createElement('p');p.textContent=message;alerts.append(p);}alerts.hidden=!messages.length;
 $('money-breakdown').replaceChildren();
 if (clubPaymentTotals) {
  for (const [method, label] of [['cheque','Encaissé par chèque au club'],['cash','Encaissé en espèces au club']]) {
   const term = document.createElement('dt');
   const value = document.createElement('dd');
   term.textContent = label;
   value.textContent = euro(clubPaymentTotals[method]);
   $('money-breakdown').append(term,value);
  }
 }
 for(const [key,label] of moneyFields.filter(([key])=>!primary.some(([k])=>k===key))){
  const term=document.createElement('dt');term.textContent=label;
  const value=document.createElement('dd');value.textContent=euro(totals[key]);
  if((partial&&forecastKeys.includes(key))||(clubPartial&&key==='gross_cents')){const badge=document.createElement('span');badge.className='money-badge';badge.textContent='Partiel';value.append(badge);}
  $('money-breakdown').append(term,value);
 }
}
// Suivi visuel temporaire : aucun statut n'est écrit en base.
const km16ReviewedInSession=new WeakSet();
function renderMemberQuality(){
 const summary=$('km16-member-quality-summary'),host=$('km16-member-quality-results');if(!summary||!host)return;
 const expandedGroups=[...host.querySelectorAll('details')].map(details=>details.open);
 host.replaceChildren();if(!overviewLoaded){summary.textContent='Analyse en attente du fichier adhérents…';return;}
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]/g,'');
 const emailGroups=new Map(),nameGroups=new Map(),missingEmailClients=[],missingNameClients=[];let missingEmail=0,missingName=0;
 for(const c of all){const email=String(c.email||'').trim().toLocaleLowerCase('fr-FR'),first=norm(c.first_name),last=norm(c.last_name);
  if(email){if(!emailGroups.has(email))emailGroups.set(email,[]);emailGroups.get(email).push(c);}else{missingEmail++;missingEmailClients.push(c); }
  if(first&&last){const key=first+'|'+last;if(!nameGroups.has(key))nameGroups.set(key,[]);nameGroups.get(key).push(c);}else{missingName++;missingNameClients.push(c); }
 }
 const duplicateEmails=[...emailGroups.values()].filter(g=>g.length>1),duplicateNames=[...nameGroups.values()].filter(g=>g.length>1);
 summary.textContent=all.length+' fiches · '+duplicateEmails.length+' groupe(s) avec même e-mail · '+duplicateNames.length+' groupe(s) avec même nom et prénom · '+missingEmail+' sans e-mail · '+missingName+' avec identité incomplète.';
 const groups=[['E-mail identique (partage familial possible)',duplicateEmails,false],['Nom et prénom identiques (homonymes possibles)',duplicateNames,false],['Fiches sans e-mail',missingEmailClients.map(c=>[c]),true],['Identité incomplète',missingNameClients.map(c=>[c]),true]];
 for(const [index,[label,items,individual]] of groups.entries()){const details=document.createElement('details'),head=document.createElement('summary');details.open=expandedGroups[index]||false;head.textContent=label+' : '+items.length+(individual?' fiche(s)':' groupe(s)');details.append(head);
  if(individual){const note=document.createElement('p');note.className='muted';note.textContent=items.filter(people=>km16ReviewedInSession.has(people[0])).length+' contrôlée(s) pendant cette session · suivi temporaire, perdu au rechargement · aucune fiche modifiée.';details.append(note);}
  if(!items.length){const p=document.createElement('p');p.className='muted';p.textContent='Aucune correspondance détectée.';details.append(p);}else{const ul=document.createElement('ul');ul.className='km16-approval-list';for(const people of items.slice(0,40)){const li=document.createElement('li');for(const c of people){const line=document.createElement('div'),name=document.createElement('span'),btn=document.createElement('button');name.textContent=[c.first_name,c.last_name].filter(Boolean).join(' ')+' · '+(c.email||'e-mail non renseigné')+' · '+(c.source||'KM16');btn.type='button';btn.textContent='Voir la fiche';btn.setAttribute('aria-label','Voir la fiche de '+c.first_name+' '+c.last_name);btn.onclick=()=>{openMemberProfile(c);$('member-profile').scrollIntoView({behavior:'smooth',block:'start'});};line.append(name,document.createTextNode(' '),btn);if(individual){const review=document.createElement('button');review.type='button';review.textContent=km16ReviewedInSession.has(c)?'Contrôlé (session) · Annuler':'Marquer contrôlé (session)';review.setAttribute('aria-pressed',String(km16ReviewedInSession.has(c)));review.onclick=()=>{if(km16ReviewedInSession.has(c))km16ReviewedInSession.delete(c);else km16ReviewedInSession.add(c);renderMemberQuality();};line.append(document.createTextNode(' '),review);}li.append(line);}ul.append(li);}details.append(ul);if(items.length>40){const p=document.createElement('p');p.className='muted';p.textContent='40 premiers '+(individual?'dossiers':'groupes')+' affichés.';details.append(p);}}host.append(details);}
}
function render(){
 if(selectedMember&&!all.includes(selectedMember))closeMemberProfile();renderOverview();communications.update();
 renderMoneySummary();renderMemberQuality();
 $('stage-rows').replaceChildren();for(const m of stagesMonthly(all)){const tr=document.createElement('tr');for(const v of [m.month,m.sold,m.refunded,m.retained,euro(m.amount_cents),euro(m.net_cents)])cell(tr,String(v));$('stage-rows').append(tr);}
 const km16GroupCounts={Enfants:{total:0,saintJean:0},Ados:{total:0,saintJean:0},Adultes:{total:0,saintJean:0}};
 for(const c of all){const counts=km16GroupCounts[c.group];if(!counts)continue;counts.total++;if(c.saint_jean)counts.saintJean++;}
 for(const g of ['Enfants','Ados','Adultes']){const counts=km16GroupCounts[g];$('count-'+g.toLowerCase()).textContent=counts.total;$('split-'+g.toLowerCase()).textContent=counts.saintJean+' Saint-Jean · '+(counts.total-counts.saintJean)+' autres tarifs';}
 renderClientResults();
}
function renderClientResults(){
 const query=searchQuery();
 const financePending=!overviewLoaded&&busy&&Boolean($('club-registration-form'));
 const shown=all.filter(c=>(!group||c.group===group)&&matches(c,query));
 const pageCount=Math.max(1,Math.ceil(shown.length/clientPageSize));
 clientPage=Math.min(Math.max(clientPage,0),pageCount-1);
 const start=clientPage*clientPageSize;
 const pageRows=shown.slice(start,start+clientPageSize);
 $('client-results-count').textContent=shown.length+' fiche(s) trouvée(s) sur '+all.length+' pour cette saison et cet environnement.';
 $('search-clear').hidden=!$('search').value;
 $('client-pagination').hidden=pageCount===1;
 $('client-page-prev').disabled=clientPage===0;
 $('client-page-next').disabled=clientPage===pageCount-1;
 $('client-page-status').textContent='Page '+(clientPage+1)+' sur '+pageCount+' · Fiches '+(start+1)+' à '+(start+pageRows.length);
 const km16RowsFragment=document.createDocumentFragment();
 for(const c of pageRows){const row=document.createElement('tr');cell(row,c.group);
  const name=cell(row,c.last_name+' '+c.first_name);const openProfile=document.createElement('button');openProfile.type='button';openProfile.className='km16-open-profile';openProfile.textContent='Voir la fiche';openProfile.disabled=financePending;openProfile.setAttribute('aria-label','Ouvrir la fiche de '+c.first_name+' '+c.last_name);openProfile.onclick=()=>openMemberProfile(c);name.append(openProfile);const tariff=document.createElement('div');tariff.className=c.saint_jean?'tag':'muted';tariff.textContent=c.saint_jean?'Tarif Saint-Jean-de-Passy':c.external_only?'Tarif importé · à confirmer':'Autres tarifs';name.append(tariff);if(c.external_import){const badge=document.createElement('div');badge.className='tag';badge.textContent='Import '+c.source;name.append(badge);}if(c.import_notes){const note=document.createElement('div');note.className='muted';note.textContent=c.import_notes;name.append(note);}if(c.guardian_name){const small=document.createElement('div');small.className='muted';small.textContent='Représentant : '+c.guardian_name;name.append(small);}
  const address=cell(row,c.address.length?c.address.join(', '):'Adresse en attente de facturation');if(c.billing_name){const small=document.createElement('div');small.className='muted';small.textContent='Facturé à : '+c.billing_name;address.append(small);}
  const contact=cell(row,c.email);const phone=document.createElement('div');phone.textContent=c.phone;contact.append(phone);if(c.external_import&&!c.external_only){const extra=document.createElement('div');extra.className='muted';extra.textContent='Coordonnées importées : '+[c.import_email,c.import_phone].filter(Boolean).join(' · ');contact.append(extra);}if(c.emergency_contacts){const extra=document.createElement('div');extra.className='muted';extra.textContent='Urgence : '+c.emergency_contacts;contact.append(extra);}if(c.additional_addresses||c.import_address?.length){const extra=document.createElement('div');extra.className='muted';extra.textContent='Autres coordonnées : '+[c.additional_addresses,c.import_address?.join(', ')].filter(Boolean).join(' · ');address.append(extra);}
  const td=cell(row,'');const ul=document.createElement('ul');for(const p of c.products){const li=document.createElement('li');li.textContent=p.title+(p.external?'':' · '+euro(p.total_cents));if(p.state!=='Acheté'){const state=document.createElement('span');state.className='tag';state.textContent=p.state;li.append(' ',state);}ul.append(li);}td.append(ul);for(const [key] of moneyFields.slice(0,8))cell(row,financePending?'En cours…':!clubAmountKnown(c,key)?'Non intégré':c.forecast_unknown&&['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(key)?'À vérifier':euro(c.amounts[key]||0));if(!financePending&&c.amounts.disputed_cents){const warning=document.createElement('div');warning.className='tag';warning.textContent='Contesté : '+euro(c.amounts.disputed_cents);td.append(warning);}km16RowsFragment.append(row);
 }
 if(!shown.length){const row=document.createElement('tr'),td=cell(row,financePending?'Recherche en cours de chargement des règlements au club':all.length?'Aucun client pour cette sélection':'Aucun achat encaissé dans cet environnement');td.colSpan=13;km16RowsFragment.append(row);}
 $('rows').replaceChildren(km16RowsFragment);
 for(const b of document.querySelectorAll('[data-group]'))b.setAttribute('aria-pressed',String(b.dataset.group===group));
 $('export').disabled=busy||!all.some(c=>matches(c,query))||Boolean($('club-registration-form')&&!clubPaymentTotals);
}
async function load({background=false}={}){
 if(busy||session?.user.email?.toLowerCase()!==ADMIN)return;
 const refreshSupplementary=!background||Date.now()-lastSupplementaryRefresh>=6*60*1000;
 busy=true;$('export').disabled=true;
 const gen=generation,test=$('test').checked,season=$('season').value;
 showSeason();controller=new AbortController();
 $('data-status').textContent='Chargement du fichier clients…';
 try{
  const {data:{session:current}}=await client.auth.getSession();if(!current)throw Error('Session expirée');
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'clients',test,season}),signal:controller.signal});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Chargement impossible');
  if(gen!==generation||test!==$('test').checked)return;
  if(!Array.isArray(data.clients)||data.test!==test||data.season!==season)throw Error('Réponse inattendue');
  sourceClients=data.clients;
  const registrationLoad=$('club-registration-form')?refreshClubRegistrations():null;
  if(!overviewLoaded&&registrationLoad){
   setClients(sourceClients);
   renderClientResults();
   $('data-status').textContent=all.length+' fiche(s) · Chargement des règlements au club…';
  }
  if(refreshSupplementary){
   lastSupplementaryRefresh=Date.now();
   void refreshExternalPayments();
   if(location.hash!=='#km16-email-relances'){
    void refreshProcessingItems();
    void refreshStageReminders();
   }
   void refreshShirtKpi();
  }
  await registrationLoad;
  if(gen!==generation)return;
  setClients(withClubPayments(sourceClients,clubPayments));
  updateClubClientChoices();overviewLoaded=true;$('imports-note').textContent=(data.imported_count||0)+' fiches du fichier actif rattachées à cette saison. Les encaissements Sportigo/Fighty ne sont pas intégrés aux totaux ci-dessous ; les identités concordantes sont rapprochées sans ajouter de paiement.';
  for(const value of data.seasons||[]){if(![...$('season').options].some(o=>o.value===value)){const o=document.createElement('option');o.value=value;o.textContent=value;$('season').append(o);}}
  $('test-notice').hidden=!test;
  const missing=all.filter(c=>!c.address.length).length,unchecked=all.filter(c=>c.group==='À vérifier').length;
  $('data-status').textContent=all.length+' pratiquant(s) · Mis à jour à '+new Date(data.updated_at).toLocaleTimeString('fr-FR')+(missing?' · '+missing+' adresse(s) en attente':'')+(unchecked?' · '+unchecked+' âge(s) à vérifier':'')+(all.some(c=>c.forecast_unknown)?' · Prévision incomplète : certains échéanciers n’ont pas pu être vérifiés':'');status('');
 }catch(e){if(gen===generation&&e.name!=='AbortError'){clear();$('data-status').textContent='Chargement interrompu';status(e.message,true);}}
 finally{if(gen===generation){busy=false;render();}}
}

let km16EmailAlerts=[],km16EmailRequest=0,km16EmailPage=0,km16EmailHasMore=false;
let km16EmailCursor=null,km16EmailController=null,km16EmailLoaded=false;
const KM16_EMAIL_ACTIONS={failed:'validation_requise',uncertain:'verification_manuelle',sending:'blocage_a_verifier'};
const KM16_EMAIL_LABELS={validation_requise:'Validation administrative requise',verification_manuelle:'Vérification manuelle obligatoire',blocage_a_verifier:'Blocage à vérifier'};
const isKm16EmailAdmin=s=>!!(s?.user?.id&&s.user.email?.toLowerCase()===ADMIN&&s.user.email_confirmed_at&&!s.user.is_anonymous);
const validKm16EmailCursor=c=>c&&typeof c==='object'&&!Array.isArray(c)&&
 typeof c.observed_at==='string'&&Number.isFinite(Date.parse(c.observed_at))&&
 ['purchases_after','campaigns_after'].every(key=>Number.isSafeInteger(c[key])&&c[key]>=0);
function renderKm16EmailAlerts(){
 const body=$('km16-email-relances-rows'),filter=$('km16-email-relances-filter')?.value||'';
 if(!body)return;
 body.replaceChildren();
 const visible=km16EmailAlerts.filter(x=>!filter||x.action_requise===filter);
 for(const item of visible){
  const tr=document.createElement('tr');
  const date=item.derniere_tentative?new Date(item.derniere_tentative):null;
  for(const value of [item.categorie==='achats'?'Achats':'E-mails programmés',item.reference,item.destinataire,item.statut,
    date&&Number.isFinite(date.getTime())?date.toLocaleString('fr-FR'):'—',KM16_EMAIL_LABELS[item.action_requise]]){
   const td=document.createElement('td');td.textContent=String(value??'');tr.append(td);
  }
  const actionCell=document.createElement('td'),follow=document.createElement('button');
  follow.type='button';follow.textContent='Suivi';follow.setAttribute('aria-label','Suivi de '+item.reference);
  follow.addEventListener('click',()=>openKm16EmailReview(item));actionCell.append(follow);tr.prepend(actionCell);
  body.append(tr);
 }
 const count=$('km16-email-relances-count');
 if(count){count.hidden=!km16EmailLoaded;count.textContent=visible.length+' alerte(s) affichée(s) sur '+km16EmailAlerts.length+' chargée(s).'+(km16EmailHasMore?' Le filtre porte sur les pages déjà chargées.':'');}
 const empty=$('km16-email-relances-empty');
 if(empty)empty.hidden=!km16EmailLoaded||visible.length>0;
 const more=$('km16-email-relances-more');
 if(more)more.hidden=!km16EmailHasMore;
}
function clearKm16EmailAlerts(){
 clearKm16EmailReview();
 km16EmailRequest++;km16EmailController?.abort();km16EmailController=null;
 km16EmailAlerts=[];km16EmailPage=0;km16EmailHasMore=false;km16EmailCursor=null;km16EmailLoaded=false;
 for(const id of ['km16-email-relances-refresh','km16-email-relances-more'])if($(id))$(id).disabled=false;
 renderKm16EmailAlerts();
 if($('km16-email-relances-status'))$('km16-email-relances-status').textContent='Aucune notification chargée. Aucun e-mail envoyé.';
}
async function refreshKm16EmailAlerts(next=false){
 const statusNode=$('km16-email-relances-status'),button=$('km16-email-relances-refresh'),more=$('km16-email-relances-more');
 if(!statusNode||!button)return;
 if(!isKm16EmailAdmin(session)){clearKm16EmailAlerts();return;}
 if(next&&(!km16EmailHasMore||!km16EmailCursor))return;
 if(!next)clearKm16EmailReview();
 const request=++km16EmailRequest,userId=session.user.id;
 km16EmailController?.abort();
 const requestController=new AbortController();km16EmailController=requestController;
 const page=next?km16EmailPage+1:0;
 button.disabled=true;if(more)more.disabled=true;
 statusNode.textContent='Consultation sécurisée des alertes…';
 try{
  const {data:{session:current}}=await client.auth.getSession();
  if(request!==km16EmailRequest)return;
  if(!isKm16EmailAdmin(current)||current.user.id!==userId||session?.user?.id!==userId){
   clearKm16EmailAlerts();statusNode.textContent='Session expirée. Reconnectez-vous pour consulter les alertes.';return;
  }
  const response=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-admin-email-alerts',{
   method:'POST',headers:{Authorization:'Bearer '+current.access_token,'apikey':'sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn','Content-Type':'application/json'},
   body:JSON.stringify(next?{page,cursor:km16EmailCursor}:{page}),cache:'no-store',signal:requestController.signal
  });
  const result=await response.json();
  if(request!==km16EmailRequest)return;
  if(!response.ok){
   if(response.status===401||response.status===403){clearKm16EmailAlerts();statusNode.textContent='Accès aux alertes refusé. Reconnectez-vous avec le compte administrateur.';return;}
   throw Error(result?.error||'Service indisponible');
  }
  if(!result||!Array.isArray(result.alerts)||result.alerts.length>200||result.page!==page||
    typeof result.has_more!=='boolean'||!validKm16EmailCursor(result.cursor)||
    (next&&(result.cursor.observed_at!==km16EmailCursor.observed_at||
      result.cursor.purchases_after<km16EmailCursor.purchases_after||result.cursor.campaigns_after<km16EmailCursor.campaigns_after)))throw Error('Réponse inattendue');
  const valid=result.alerts.every(x=>x&&['achats','emails_programmes'].includes(x.categorie)&&
    Number.isSafeInteger(x.notification_id)&&x.notification_id>0&&typeof x.reference==='string'&&typeof x.destinataire==='string'&&
    Object.hasOwn(KM16_EMAIL_ACTIONS,x.statut)&&KM16_EMAIL_ACTIONS[x.statut]===x.action_requise&&
    (x.derniere_tentative===null||(typeof x.derniere_tentative==='string'&&Number.isFinite(Date.parse(x.derniere_tentative)))));
  if(!valid)throw Error('Réponse inattendue');
  const unique=new Map((next?km16EmailAlerts:[]).map(x=>[x.categorie+':'+x.notification_id,x]));
  for(const item of result.alerts)unique.set(item.categorie+':'+item.notification_id,item);
  km16EmailAlerts=[...unique.values()];
  km16EmailPage=page;km16EmailHasMore=result.has_more;km16EmailCursor=result.cursor;km16EmailLoaded=true;
  renderKm16EmailAlerts();
  statusNode.textContent=km16EmailAlerts.length+' alerte(s) chargée(s)'+(km16EmailHasMore?' — autres pages disponibles':'')+'. Actualisez pour prendre en compte les changements de statut. Aucun e-mail envoyé.';
 }catch(e){
  if(request!==km16EmailRequest)return;
  if(!next){km16EmailAlerts=[];km16EmailPage=0;km16EmailHasMore=false;km16EmailCursor=null;km16EmailLoaded=false;renderKm16EmailAlerts();}
  statusNode.textContent=(next?'Page suivante indisponible, les alertes déjà chargées sont conservées : ':'Alertes indisponibles : ')+(e instanceof Error?e.message:'Erreur inconnue')+'. Aucun e-mail envoyé.';
 }finally{if(request===km16EmailRequest){km16EmailController=null;button.disabled=false;if(more)more.disabled=false;}}
}
$('km16-email-relances-refresh')?.addEventListener('click',()=>refreshKm16EmailAlerts(false));
$('km16-email-relances-more')?.addEventListener('click',()=>refreshKm16EmailAlerts(true));
$('km16-email-relances-filter')?.addEventListener('change',renderKm16EmailAlerts);

const KM16_REVIEW_DECISIONS={verification_effectuee:'Vérification effectuée',a_reexaminer:'Vérification à poursuivre',ne_pas_relancer:'Ne pas relancer'};
const km16ReviewUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const km16ReviewDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)&&Number.isFinite(Date.parse(value));
const km16ReviewInstant=value=>{
 const fraction=/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/i.exec(value)?.[1]||'';
 return BigInt(Date.parse(value))*1000n+BigInt(fraction.padEnd(6,'0').slice(3));
};
const km16ReviewSameDate=(a,b)=>a===null||b===null?a===b:km16ReviewDate(a)&&km16ReviewDate(b)&&km16ReviewInstant(a)===km16ReviewInstant(b);
const km16ReviewNoteLength=value=>Array.from(value).length;
const km16ReviewDateLabel=value=>value===null?'Non renseignée':new Date(value).toLocaleString('fr-FR');
let km16ReviewSelection=null,km16ReviewRows=[],km16ReviewRequest=0,km16ReviewController=null;
let km16ReviewLoaded=false,km16ReviewBusy=false,km16ReviewNext=null,km16ReviewLastId=0,km16ReviewPending=null,km16ReviewConflict=false;
function validKm16EmailReview(row,selection){
 return !!(row&&typeof row==='object'&&!Array.isArray(row)&&Number.isSafeInteger(row.id)&&row.id>0&&
  km16ReviewUuid(row.request_id)&&row.categorie===selection.categorie&&row.notification_id===selection.notification_id&&
  Object.hasOwn(KM16_REVIEW_DECISIONS,row.decision)&&typeof row.note==='string'&&km16ReviewNoteLength(row.note.trim())>=3&&km16ReviewNoteLength(row.note)<=1000&&
  Object.hasOwn(KM16_EMAIL_ACTIONS,row.observed_state)&&(row.observed_attempted_at===null||km16ReviewDate(row.observed_attempted_at))&&
  Number.isSafeInteger(row.previous_review_id)&&row.previous_review_id>=0&&row.previous_review_id<row.id&&
  km16ReviewUuid(row.recorded_by)&&km16ReviewDate(row.recorded_at));
}
function updateKm16EmailReviewControls(){
 const locked=!km16ReviewLoaded||km16ReviewBusy||!!km16ReviewPending||km16ReviewConflict;
 for(const id of ['km16-email-review-decision','km16-email-review-note'])if($(id))$(id).disabled=locked;
 const save=$('km16-email-review-save');
 if(save){save.disabled=!km16ReviewSelection||!km16ReviewLoaded||km16ReviewBusy||km16ReviewConflict;save.textContent=km16ReviewPending?'Réessayer cette vérification':'Enregistrer la vérification';}
 const reload=$('km16-email-review-reload');if(reload)reload.disabled=km16ReviewBusy||!!km16ReviewPending;
 const more=$('km16-email-review-more');if(more){more.hidden=km16ReviewNext===null;more.disabled=km16ReviewBusy||!!km16ReviewPending;}
 const abandon=$('km16-email-review-abandon');if(abandon){abandon.hidden=!km16ReviewPending||km16ReviewBusy;abandon.disabled=km16ReviewBusy;}
}
function renderKm16EmailReview(){
 const history=$('km16-email-review-history');if(!history)return;
 history.replaceChildren();
 for(const review of km16ReviewRows){
  const li=document.createElement('li'),heading=document.createElement('strong'),note=document.createElement('p'),attempt=document.createElement('p');
  heading.textContent=KM16_REVIEW_DECISIONS[review.decision]+' · '+km16ReviewDateLabel(review.recorded_at);
  note.className='km16-email-review-note';note.textContent=review.note;
  attempt.className='muted';attempt.textContent='Tentative observée : '+review.observed_state+' · '+km16ReviewDateLabel(review.observed_attempted_at);
  li.append(heading,note,attempt);
  if(km16ReviewSelection&&(review.observed_state!==km16ReviewSelection.statut||!km16ReviewSameDate(review.observed_attempted_at,km16ReviewSelection.derniere_tentative))){
   const old=document.createElement('p');old.className='km16-email-review-old';old.textContent='Annotation d’une ancienne tentative : l’état ou la date diffère de l’alerte affichée.';li.append(old);
  }
  history.append(li);
 }
 const empty=$('km16-email-review-empty');if(empty)empty.hidden=!km16ReviewLoaded||km16ReviewRows.length>0;
 updateKm16EmailReviewControls();
}
function clearKm16EmailReview(){
 km16ReviewRequest++;km16ReviewController?.abort();km16ReviewController=null;
 km16ReviewSelection=null;km16ReviewRows=[];km16ReviewLoaded=false;km16ReviewBusy=false;km16ReviewNext=null;km16ReviewLastId=0;km16ReviewPending=null;km16ReviewConflict=false;
 if($('km16-email-review'))$('km16-email-review').hidden=true;
 for(const id of ['km16-email-review-detail','km16-email-review-status'])if($(id))$(id).textContent='';
 for(const id of ['km16-email-review-decision','km16-email-review-note'])if($(id))$(id).value='';
 renderKm16EmailReview();
}
function openKm16EmailReview(item){
 clearKm16EmailReview();if(!isKm16EmailAdmin(session))return;
 km16ReviewSelection={...item};
 $('km16-email-review-detail').textContent='Référence : '+item.reference+'\nDestinataire : '+item.destinataire+'\nÉtat observé : '+item.statut+'\nDernière tentative : '+km16ReviewDateLabel(item.derniere_tentative);
 $('km16-email-review').hidden=false;$('km16-email-review-title').focus();
 $('km16-email-review').scrollIntoView({block:'nearest'});
 loadKm16EmailReviews();
}
async function km16EmailReviewApi(payload,request,requestController){
 const userId=session?.user?.id;
 const {data:{session:current}}=await client.auth.getSession();
 if(request!==km16ReviewRequest)return null;
 if(!isKm16EmailAdmin(session)||!isKm16EmailAdmin(current)||current.user.id!==userId||session.user.id!==userId){
  clearKm16EmailAlerts();$('km16-email-relances-status').textContent='Session expirée. Reconnectez-vous pour consulter le suivi.';return null;
 }
 const response=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-admin-email-reviews',{
  method:'POST',headers:{Authorization:'Bearer '+current.access_token,'apikey':'sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn','Content-Type':'application/json'},
  body:JSON.stringify(payload),cache:'no-store',signal:requestController.signal
 });
 const result=await response.json().catch(()=>null);
 if(request!==km16ReviewRequest)return null;
 if(response.status===401||response.status===403){
  clearKm16EmailAlerts();$('km16-email-relances-status').textContent='Accès au suivi refusé. Reconnectez-vous avec le compte administrateur.';return null;
 }
 if(!response.ok){const error=Error(typeof result?.error==='string'?result.error:'Suivi indisponible');error.status=response.status;throw error;}
 return result;
}
async function loadKm16EmailReviews(next=false){
 if(!km16ReviewSelection||km16ReviewBusy||km16ReviewPending||!isKm16EmailAdmin(session)||(next&&km16ReviewNext===null))return;
 const selection=km16ReviewSelection,beforeId=next?km16ReviewNext:null,request=++km16ReviewRequest;
 km16ReviewController?.abort();const requestController=new AbortController();km16ReviewController=requestController;km16ReviewBusy=true;
 if(!next){km16ReviewLoaded=false;km16ReviewRows=[];km16ReviewNext=null;km16ReviewLastId=0;}
 renderKm16EmailReview();$('km16-email-review-status').textContent='Chargement de l’historique…';
 try{
  const result=await km16EmailReviewApi({action:'history',categorie:selection.categorie,notification_id:selection.notification_id,...(next?{before_id:beforeId}:{})},request,requestController);
  if(request!==km16ReviewRequest)return;
  if(!result||!Array.isArray(result.reviews)||result.reviews.length>20||typeof result.has_more!=='boolean'||
   !result.reviews.every((row,index)=>validKm16EmailReview(row,selection)&&(!next||row.id<beforeId)&&(index===0||row.id<result.reviews[index-1].id))||
   (result.has_more?result.reviews.length===0||result.next_before_id!==result.reviews.at(-1).id:result.next_before_id!==null))throw Error('Historique inattendu');
  km16ReviewRows=next?[...km16ReviewRows,...result.reviews]:result.reviews;
  if(!next)km16ReviewLastId=result.reviews[0]?.id||0;
  km16ReviewNext=result.has_more?result.next_before_id:null;km16ReviewLoaded=true;renderKm16EmailReview();
  $('km16-email-review-status').textContent=km16ReviewConflict?'Historique rechargé. Actualisez les alertes puis ouvrez de nouveau ce suivi avant d’enregistrer.':km16ReviewRows.length+' vérification(s) chargée(s). Aucun e-mail envoyé.';
 }catch(e){if(request===km16ReviewRequest)$('km16-email-review-status').textContent='Historique indisponible. Rechargez-le avant d’enregistrer une vérification.';}
 finally{if(request===km16ReviewRequest){km16ReviewBusy=false;km16ReviewController=null;updateKm16EmailReviewControls();}}
}
async function saveKm16EmailReview(){
 if(!km16ReviewSelection||!km16ReviewLoaded||km16ReviewBusy||km16ReviewConflict||!isKm16EmailAdmin(session))return;
 if(!km16ReviewPending){
  const decision=$('km16-email-review-decision').value,note=$('km16-email-review-note').value.trim();
  if(!Object.hasOwn(KM16_REVIEW_DECISIONS,decision)||km16ReviewNoteLength(note)<3||km16ReviewNoteLength(note)>1000){$('km16-email-review-status').textContent='Choisissez une décision et saisissez une note de 3 à 1 000 caractères.';return;}
  km16ReviewPending={action:'record',categorie:km16ReviewSelection.categorie,notification_id:km16ReviewSelection.notification_id,
   request_id:crypto.randomUUID(),expected_state:km16ReviewSelection.statut,expected_attempted_at:km16ReviewSelection.derniere_tentative,
   expected_last_review_id:km16ReviewLastId,decision,note};
  $('km16-email-review-note').value=note;
 }
 const payload=km16ReviewPending,selection=km16ReviewSelection,request=++km16ReviewRequest;
 km16ReviewController?.abort();const requestController=new AbortController();km16ReviewController=requestController;km16ReviewBusy=true;
 updateKm16EmailReviewControls();$('km16-email-review-status').textContent='Enregistrement de la vérification…';
 try{
  const result=await km16EmailReviewApi(payload,request,requestController);
  if(request!==km16ReviewRequest)return;
  const review=result?.review;
  if(!validKm16EmailReview(review,selection)||review.request_id!==payload.request_id||review.decision!==payload.decision||review.note!==payload.note||
   review.observed_state!==payload.expected_state||!km16ReviewSameDate(review.observed_attempted_at,payload.expected_attempted_at)||review.previous_review_id!==payload.expected_last_review_id)throw Error('Enregistrement non confirmé');
  const unique=new Map(km16ReviewRows.map(row=>[row.id,row]));unique.set(review.id,review);
  km16ReviewRows=[...unique.values()].sort((a,b)=>b.id-a.id);km16ReviewLastId=Math.max(km16ReviewLastId,review.id);km16ReviewPending=null;
  $('km16-email-review-decision').value='';$('km16-email-review-note').value='';renderKm16EmailReview();
  $('km16-email-review-status').textContent='Vérification enregistrée. L’alerte reste affichée. Aucun e-mail envoyé.';
 }catch(e){
  if(request!==km16ReviewRequest)return;
  if(e.status===409){km16ReviewPending=null;km16ReviewConflict=true;$('km16-email-review-status').textContent='Le suivi ou la tentative a changé. Rechargez l’historique et actualisez les alertes avant de recommencer. Aucun enregistrement n’est confirmé.';}
  else if(e.status>=400&&e.status<500&&e.status!==408&&e.status!==429){km16ReviewPending=null;$('km16-email-review-status').textContent='Vérification refusée : '+e.message;}
  else $('km16-email-review-status').textContent='Résultat non confirmé. Réessayez cette même vérification ou abandonnez la tentative et rechargez l’historique. Fermer le panneau n’annule pas un enregistrement déjà effectué.';
 }finally{if(request===km16ReviewRequest){km16ReviewBusy=false;km16ReviewController=null;updateKm16EmailReviewControls();}}
}
$('km16-email-review-close')?.addEventListener('click',clearKm16EmailReview);
$('km16-email-review-reload')?.addEventListener('click',()=>loadKm16EmailReviews(false));
$('km16-email-review-more')?.addEventListener('click',()=>loadKm16EmailReviews(true));
$('km16-email-review-save')?.addEventListener('click',saveKm16EmailReview);
$('km16-email-review-abandon')?.addEventListener('click',()=>{
 if(km16ReviewBusy||!km16ReviewPending)return;
 km16ReviewPending=null;$('km16-email-review-decision').value='';$('km16-email-review-note').value='';loadKm16EmailReviews(false);
});

async function authState(s){
 const revision=++authRevision;
 generation++;controller?.abort();busy=false;session=null;clear();clearKm16EmailAlerts();communications.reset();
 const admin=s?.user.email?.toLowerCase()===ADMIN;
 if(admin){
  $('login').hidden=true;$('forbidden').hidden=true;$('workspace').hidden=true;$('stages-panel').hidden=true;
  $('km16-email-relances').hidden=true;
  const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel(s.access_token).catch(()=>null);
  if(revision!==authRevision)return;
  if(assurance?.data?.currentLevel!=='aal2'){
   if(mfaGate.hidden){mfaGate.hidden=false;mfaGate.open=true;}
   return;
  }
 }
 resetLoginMfa();
 session=s;
 void refreshKm16HealthDocuments();
 if(!admin)resetAdminMfa();
 $('login').hidden=!!s;$('forbidden').hidden=!s||admin;$('workspace').hidden=!admin;$('stages-panel').hidden=!admin;
 $('km16-email-relances').hidden=!isKm16EmailAdmin(s);
 $('password').value='';$('test').checked=false;$('test-notice').hidden=true;group='';$('search').value='';
 $('identity').textContent=admin?s.user.email:'';
 if(admin){const loading=load();refreshCourseAlerts();refreshAdminActionProgress();refreshKm16AutoMail();refreshKm16FollowupDashboard();await loading;if(revision===authRevision)communications.load();}else{void refreshKm16AutoMail();void refreshKm16FollowupDashboard();km16ActionRequest++;km16ActionState.clear();km16ActionLoaded=false;km16ActionError='';}
}
$('login-form').onsubmit=async event=>{event.preventDefault();if(!client)return;const button=$('login-button');button.disabled=true;status('');try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;}catch(e){status(e.message,true);}finally{button.disabled=false;$('password').value='';}};
const logout=async()=>{await authState(null);try{const {error}=await client.auth.signOut();if(error)throw error;}catch{status('Déconnexion non confirmée. Réessaie avant de fermer la console.',true);}};
$('logout').onclick=logout;$('other-account').onclick=logout;$('km16-mfa-logout').onclick=logout;
$('season').onchange=()=>{generation++;controller?.abort();busy=false;clear();showSeason();refreshKm16HealthDocuments();load();};
$('refresh').onclick=()=>{load();refreshCourseAlerts();};let km16SearchTimer;
function renderFirstClientPage(){clearTimeout(km16SearchTimer);clientPage=0;renderClientResults();}
$('search').oninput=()=>{clearTimeout(km16SearchTimer);km16SearchTimer=setTimeout(renderFirstClientPage,160);};
$('search-clear').onclick=()=>{clearTimeout(km16SearchTimer);$('search').value='';renderFirstClientPage();$('search').focus();};
$('client-page-prev').onclick=()=>{clientPage--;renderClientResults();if($('client-page-prev').disabled)$('client-page-next').focus();};
$('client-page-next').onclick=()=>{clientPage++;renderClientResults();if($('client-page-next').disabled)$('client-page-prev').focus();};
$('all').onclick=()=>{group='';renderFirstClientPage();};
for(const b of document.querySelectorAll('[data-group]'))b.onclick=()=>{group=b.dataset.group;renderFirstClientPage();};
$('test').onchange=()=>{generation++;controller?.abort();busy=false;clear();load();};
$('export').onclick=()=>{try{const query=searchQuery();const rows=all.filter(c=>matches(c,query));if(!rows.length||($('club-registration-form')&&!clubPaymentTotals))return;const bytes=clientsWorkbook(rows,all);const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=($('test').checked?'TEST-':'')+'KM16-Clients-'+$('season').value.replace('/','-')+'-'+new Date().toISOString().slice(0,10)+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Export créé : Enfants, Ados, Adultes, Synthèse et Stages par mois.');}catch(e){status(e.message,true);}};
function resetClubClientChoice() {
 const select = $('club-client-id');
 if (!select) return;
 const hadSelection = Boolean(select.value);
 select.replaceChildren(new Option('Nouvelle fiche', ''));
 if (hadSelection) select.onchange?.();
}

function updateClubClientChoices() {
 const select = $('club-client-id');
 if (!select) return;
 const previous = select.value;
 select.replaceChildren(new Option('Nouvelle fiche', ''));
 for (const member of all) {
  select.add(new Option([member.last_name, member.first_name, member.group, member.email].filter(Boolean).join(' · '), member.id));
 }
 select.value = [...select.options].some(option => option.value === previous) ? previous : '';
 if (previous && !select.value) select.onchange?.();
}

async function refreshClubRegistrations() {
 const request = ++clubRegistrationRequest;
 const list = $('club-registration-list');
 const scope = clubRegistrationScope();
 $('club-registration-scope').textContent = 'Saison ' + scope.season_id + (scope.test ? ' · MODE TEST' : '');
 const rows = [];
 let error;
 for (let offset = 0; ; offset += 500) {
  const page = await client.from(clubRegistrationTable)
   .select('id,client_id,first_name,last_name,email,method,amount_cents,received_on')
   .match(scope).order('created_at', {ascending:false}).order('id').range(offset, offset + 499);
  if (request !== clubRegistrationRequest) return;
  error = page.error;
  if (error) break;
  rows.push(...page.data);
  if (page.data.length < 500) break;
 }
 clubPaymentTotalsError = Boolean(error);
 clubPaymentTotals = error ? null : {cheque:0,cash:0};
 clubPayments = error ? [] : rows;
 for (const row of clubPayments) clubPaymentTotals[row.method] += row.amount_cents;
 list.replaceChildren();
 if (error || !rows.length) {
  const item = document.createElement('li');
  item.textContent = error ? 'Historique indisponible.' : 'Aucun règlement au club pour cette saison.';
  list.append(item);
  return;
 }
 for (const row of rows.slice(0,100)) {
  const item = document.createElement('li');
  item.textContent = [row.first_name + ' ' + row.last_name, clubPaymentLabel(row.method),
   euro(row.amount_cents), row.received_on.split('-').reverse().join('/')].join(' · ');
  list.append(item);
 }
}

const clubRegistrationForm = $('club-registration-form');
if (clubRegistrationForm) {
 const date = clubRegistrationForm.elements.received_on;
 const select = $('club-client-id');
 select.onchange = () => {
  const member = all.find(item => item.id === select.value);
  for (const key of ['first_name','last_name','email']) {
   const field = clubRegistrationForm.elements[key];
   field.readOnly = Boolean(member);
   field.value = member?.[key] || '';
  }
 };
 date.value = date.max = parisDate();
 clubRegistrationForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = clubRegistrationForm.querySelector('button[type=submit]');
  if (button.disabled || busy || !overviewLoaded || session?.user.email?.toLowerCase() !== ADMIN) return;
  const fields = new FormData(clubRegistrationForm);
  const status = $('club-registration-status');
  const entry = {
   ...clubRegistrationScope(),
   client_id: fields.get('client_id') || null,
   first_name: fields.get('first_name').trim(),
   last_name: fields.get('last_name').trim(),
   email: fields.get('email').trim() || null,
   method: fields.get('method'),
   amount_cents: Math.round(Number(fields.get('amount')) * 100),
   received_on: fields.get('received_on')
  };
  if (!entry.first_name || !entry.last_name) {
   status.textContent = 'Renseigne le prénom et le nom.';
   return;
  }
  const fingerprint = JSON.stringify(entry);
  if (clubRegistrationPending && clubRegistrationPending.fingerprint !== fingerprint) {
   status.textContent = 'Rétablis les valeurs de la dernière tentative et réessaie pour vérifier son enregistrement.';
   return;
  }
  clubRegistrationPending ??= {fingerprint, id: crypto.randomUUID()};
  const controls = Array.from(clubRegistrationForm.elements);
  controls.forEach(control => { control.disabled = true; });
  status.textContent = 'Enregistrement…';
  try {
   const id = clubRegistrationPending.id;
   const {error} = await client.from(clubRegistrationTable).insert({id, ...entry});
   if (error) {
    if (error.code !== '23505') throw error;
    const retry = await client.from(clubRegistrationTable).select('id').match({id, season_id: entry.season_id, test: entry.test}).maybeSingle();
    if (retry.error || !retry.data) throw retry.error || error;
   }
   clubRegistrationPending = undefined;
   clubRegistrationForm.reset();
   select.onchange();
   date.value = date.max = parisDate();
   status.textContent = 'Règlement enregistré. Actualisation du fichier clients…';
   await load();
  } catch (error) {
   if (['23514','42501','22007','22008'].includes(error.code)) clubRegistrationPending = undefined;
   status.textContent = clubRegistrationPending
    ? 'Enregistrement à vérifier. Réessaie avec les mêmes valeurs.'
    : 'Enregistrement refusé. Vérifie les données et ta connexion administrateur.';
  } finally {
   controls.forEach(control => { control.disabled = false; });
  }
 });
}

if(!client)status('Connexion indisponible : rechargez la page',true);
else{client.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>authState(s),0);});const {data}=await client.auth.getSession();await authState(data.session);}
// Avoid redundant background reloads; manual refresh remains available.
setInterval(()=>{if(!document.hidden&&!busy&&session?.user?.email?.toLowerCase()===ADMIN)load({background:true});},120000);
