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
const KM16_ACTIONS=[
 {id:'review',label:'Dossiers administratifs à valider',kpi:'kpi-review',url:'./clients.html#km16-dossiers',priority:1},
 {id:'attendance',label:'Présences des cours passés à renseigner',kpi:'kpi-course-attendance',url:'./course-admin.html?view=attendance-pending',priority:1},
 {id:'unlinked',label:'Réservations à associer aux adhérents',kpi:'kpi-course-unlinked',url:'./course-admin.html?view=unlinked',priority:2},
 {id:'shirts',label:'Tee-shirts à remettre',kpi:'kpi-shirts',url:'./tee-shirts.html#admin',priority:2}
];
const km16ActionState=new Map();
try{const saved=JSON.parse(localStorage.getItem('km16-action-progress-v1')||'{}');for(const [k,v] of Object.entries(saved))if(v==='en-cours')km16ActionState.set(k,v);}catch{}
function renderPriorities(){
 const host=$('km16-priorities-list');if(!host)return;host.replaceChildren();
 const value=id=>{const v=$(id)?.textContent?.trim();return v&&/^\\d+$/.test(v)?Number(v):null;};
 const tasks=KM16_ACTIONS.map(t=>({...t,count:value(t.kpi)}));
 const pending=tasks.filter(t=>t.count!==null&&t.count>0).sort((a,b)=>a.priority-b.priority||b.count-a.count);
 const unknown=tasks.filter(t=>t.count===null);
 for(const t of tasks)if(t.count===0)km16ActionState.delete(t.id);
 try{localStorage.setItem('km16-action-progress-v1',JSON.stringify(Object.fromEntries(km16ActionState)));}catch{}
 $('km16-priorities-total').textContent=unknown.length?'—':String(tasks.reduce((sum,t)=>sum+(t.count||0),0));
 $('km16-priorities-categories').textContent=unknown.length?'—':String(pending.length);
 $('km16-priorities-status').textContent=(pending.length?pending.length+' catégorie(s) nécessitent une intervention. ':'')+(unknown.length?'Certaines données sont indisponibles. ':'')+(!pending.length&&!unknown.length?'Aucune alerte en attente. ':'')+'Le suivi « En cours » est propre à ce navigateur et ne valide aucun dossier.';
 const ul=document.createElement('ul');ul.className='km16-approval-list';
 for(const task of [...pending,...unknown]){
  const li=document.createElement('li'),label=document.createElement('span'),link=document.createElement('a');
  const level=task.priority===1?'Urgent':'À planifier';
  label.textContent='['+level+'] '+(task.count===null?'À vérifier':task.count+' à traiter')+' · '+task.label;
  link.href=task.url;link.textContent='Ouvrir les dossiers';li.append(label,link);
  if(task.count!==null&&task.count>0){const btn=document.createElement('button');btn.type='button';btn.textContent=km16ActionState.has(task.id)?'En cours · Annuler le suivi':'Marquer en cours';btn.setAttribute('aria-pressed',String(km16ActionState.has(task.id)));btn.onclick=()=>{if(km16ActionState.has(task.id))km16ActionState.delete(task.id);else km16ActionState.set(task.id,'en-cours');try{localStorage.setItem('km16-action-progress-v1',JSON.stringify(Object.fromEntries(km16ActionState)));}catch{}renderPriorities();};li.append(btn);}
  ul.append(li);
 }
 if(ul.children.length)host.append(ul);
}
$('km16-priorities-copy').onclick=async()=>{
 const names=[['kpi-review','Dossiers administratifs à valider'],['kpi-course-attendance','Présences à renseigner'],['kpi-course-unlinked','Réservations sans dossier'],['kpi-shirts','Tee-shirts à remettre']];
 const lines=['KM16 · Point de pilotage','Saison : '+$('season').value,'Établi le '+new Date().toLocaleString('fr-FR'),'',...names.map(([id,label])=>label+' : '+($(id).textContent.trim()||'Indisponible')),'','Données issues des modules administratifs ; vérifier les indicateurs indisponibles.'];
 try{await navigator.clipboard.writeText(lines.join('\\n'));$('km16-priorities-status').textContent='Point de pilotage copié. Les compteurs restent consultables ci-dessous.';}catch(e){$('km16-priorities-status').textContent='Copie impossible : '+e.message;}
};
$('km16-priorities-refresh').onclick=()=>{refreshCourseAlerts();refreshShirtKpi();load();};
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
 host.replaceChildren();note.textContent='Consultation des transactions Fighty, Sportigo et Stripe…';
 if(session?.user.email?.toLowerCase()!==ADMIN)return;
 const season=$('season').value;
 try{
  const [{data,error},{data:auditRows,error:auditError},{data:stripeRows,error:stripeError},{data:statusRows,error:statusError}]=await Promise.all([client.rpc('km16_admin_external_payment_summary',{p_season:season}),client.rpc('km16_admin_external_payment_audit',{p_season:season}),client.rpc('km16_admin_stripe_reconciliation',{p_season:season}),client.rpc('km16_admin_external_payment_statuses',{p_season:season})]);if(error)throw error;if(auditError)throw auditError;if(stripeError)throw stripeError;if(statusError)throw statusError;
  if(request!==externalPaymentRequest||season!==$('season').value)return;
  const rows=Array.isArray(data)?data:[];
  for(const source of ['Fighty','Sportigo','Stripe']){
   const entry=rows.find(x=>x.source===source)||{};
   const count=Number(entry.transaction_count||0),paid=Number(entry.paid_cents||0),refund=Number(entry.refunded_cents||0);
   const card=document.createElement('div');card.className='money-card';
   const title=document.createElement('div');title.className='money-label';title.textContent=source==='Fighty'?'Fighty (ancienne plateforme)':source==='Sportigo'?'Sportigo (ancienne plateforme)':'Stripe (export direct)';
   const value=document.createElement('strong');value.className='money-value';value.textContent=count?euro(paid-refund):'Aucune transaction importée';
   const detail=document.createElement('p');detail.className='muted';detail.textContent=count?count+' transaction(s) · Encaissé '+euro(paid)+' · Remboursé '+euro(refund)+' · Sans dossier '+Number(entry.unmatched_count||0)+(source==='Stripe'?' · Montant non additionné aux paiements KM16':''):'Aucun export de cette plateforme importé · total non établi';
   const stats=(statusRows||[]).find(x=>x.source===source)||{};const breakdown=document.createElement('p');breakdown.className='muted';breakdown.textContent=count?Number(stats.paid_count||0)+' payés · '+Number(stats.refunded_count||0)+' remboursés · '+Number(stats.failed_count||0)+' échoués · '+Number(stats.cancelled_count||0)+' annulés':'Aucun statut de transaction à afficher';card.append(title,value,detail,breakdown);host.append(card);
  }
  const audit=(auditRows||[])[0]||{};
  const total=Number(audit.total_transactions||0),unlinked=Number(audit.unlinked_transactions||0),early=Number(audit.preseason_transactions||0),unverified=Number(audit.unverified_platform_transactions||0);
  note.textContent=season==='2026/2027'?(total?total+' opérations importées · '+unlinked+' sans dossier rapproché · '+early+' antérieures au 2 juin 2026 · '+unverified+' transactions Stripe (export direct) à rapprocher. Exception 2026/2027 : encaissements pris en compte dès le 2 juin. Montants provisoires, hors total KM16/Stripe.':'Aucune transaction externe importée pour cette saison.'):'Sportigo et Fighty ne sont plus utilisés à partir de 2027/2028. Leurs historiques restent disponibles sur la saison 2026/2027.';
  if(unverified){const stripe=host.querySelectorAll('.money-card')[2];if(stripe){const warning=document.createElement('p');warning.className='muted';const check=(stripeRows||[])[0]||{};warning.textContent=Number(check.total_transactions||0)+' opérations Stripe · '+Number(check.direct_matches||0)+' correspondance(s) directes (identifiants ch_ / pi_) · '+Number(check.unverified_transactions||0)+' à vérifier (doublons non exclus) · '+Number(check.missing_reference||0)+' sans référence exploitable. Ne pas additionner au total KM16 avant rapprochement.';stripe.append(warning);}}
 }catch(e){if(request===externalPaymentRequest)note.textContent='Paiements externes indisponibles : '+e.message;}
}
const moneyFields=[['total_cents','Achats'],['gross_cents','Encaissé brut'],['refunded_cents','Remboursements'],['net_cents','Encaissé net'],['future_cents','Échéances futures'],['planned_cents','CA planifié · net + futur'],['overdue_cents','Échues impayées'],['cancelled_cents','Échéances annulées'],['disputed_cents','Montants contestés inclus dans le net']];
const status=(text,error=false)=>{$('status').textContent=text;$('status').className=error?'status error':'status';};
function clear(){externalPaymentRequest++;if($('external-payment-summary'))$('external-payment-summary').replaceChildren();if($('external-payment-status'))$('external-payment-status').textContent='En attente de connexion.';closeMemberProfile();overviewLoaded=false;renderOverview();shirtRefresh++;courseAlertRequest++;$('kpi-course-unlinked').textContent='—';$('kpi-course-attendance').textContent='—';$('kpi-course-status').textContent='Suivi des cours en attente de connexion.';putShirts('—','En attente de connexion');all=[];$('stage-rows').replaceChildren();$('money-summary').replaceChildren();$('money-breakdown').replaceChildren();$('money-alerts').replaceChildren();$('money-alerts').hidden=true;$('rows').replaceChildren();$('data-status').textContent='';$('imports-note').textContent='';$('export').disabled=true;for(const g of ['enfants','ados','adultes'])$('split-'+g).textContent='';for(const id of ['count-enfants','count-ados','count-adultes'])$(id).textContent='0';}
let selectedMember=null;
function closeMemberProfile(){selectedMember=null;$('member-profile').hidden=true;$('member-profile-content').replaceChildren();}
function profileLine(parent,label,value){const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=label+' : ';p.append(strong,document.createTextNode(value===null||value===undefined||value===''?'Non renseigné':String(value)));parent.append(p);}
function profileBlock(parent,title){const block=document.createElement('div');block.className='km16-profile-block';const h=document.createElement('h3');h.textContent=title;block.append(h);parent.append(block);return block;}
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
 const products=profileBlock(grid,'Achats et inscriptions connus');if(!c.products?.length){profileLine(products,'Produits','Aucun produit enregistré dans ce fichier');}else{const ul=document.createElement('ul');ul.className='km16-profile-products';for(const p of c.products){const li=document.createElement('li');li.textContent=[p.title,p.state,p.external?'Montant non intégré':Number.isFinite(p.total_cents)?euro(p.total_cents):'Montant non renseigné'].filter(Boolean).join(' · ');ul.append(li);}products.append(ul);}
 const money=profileBlock(grid,'Situation financière · fichier clients');if(c.external_only){profileLine(money,'Statut','Import externe : montants non intégrés');}else{for(const [key,label] of moneyFields.slice(0,8)){profileLine(money,label,c.forecast_unknown&&['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(key)?'À vérifier':euro(c.amounts?.[key]||0));}if(c.forecast_unknown)profileLine(money,'Prévision','Échéancier incomplet');}
 const notes=profileBlock(grid,'Suivi du dossier');profileLine(notes,'Source',c.source||'KM16');profileLine(notes,'Notes import',c.import_notes);profileLine(notes,'Justificatif tarif',c.saint_jean?'Tarif Saint-Jean : justificatif non validé par ce marquage':'Non applicable');profileLine(notes,'État',!Array.isArray(c.address)||!c.address.length||c.group==='À vérifier'?'Informations à vérifier':'Informations du fichier disponibles');
 const history=profileBlock(grid,'Réservations et présences · dossiers KM16 associés');const historyText=document.createElement('p');historyText.className='muted';historyText.textContent='Chargement de l’historique…';history.append(historyText);
 const ids=[...new Set((c.products||[]).map(p=>p.order_id).filter(id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)))];
 if(c.external_only||!ids.length){historyText.textContent='Aucun identifiant de dossier KM16 exploitable. Les imports externes ne sont pas rapprochés automatiquement.';}
 else client.rpc('km16_admin_member_attendance',{p_order_ids:ids}).then(({data,error})=>{
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
 const norm=v=>String(v||'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]/g,'');
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
 if(admin){$('identity').textContent=s.user.email;refreshShirtKpi();refreshCourseAlerts();await load();communications.load();}
}
$('login-form').onsubmit=async event=>{event.preventDefault();if(!client)return;const button=$('login-button');button.disabled=true;status('');try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;}catch(e){status(e.message,true);}finally{button.disabled=false;$('password').value='';}};
const logout=async()=>{generation++;controller?.abort();clear();await client.auth.signOut();await authState(null);};
$('logout').onclick=logout;$('other-account').onclick=logout;
$('season').onchange=()=>{generation++;controller?.abort();busy=false;clear();showSeason();load();};
$('refresh').onclick=()=>{load();refreshCourseAlerts();};$('search').oninput=render;$('search-clear').onclick=()=>{$('search').value='';render();$('search').focus();};
$('all').onclick=()=>{group='';render();};
for(const b of document.querySelectorAll('[data-group]'))b.onclick=()=>{group=b.dataset.group;render();};
$('test').onchange=()=>{generation++;controller?.abort();busy=false;clear();load();};
$('export').onclick=()=>{try{const rows=all.filter(matches);if(!rows.length)return;const bytes=clientsWorkbook(rows,all);const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=($('test').checked?'TEST-':'')+'KM16-Clients-'+$('season').value.replace('/','-')+'-'+new Date().toISOString().slice(0,10)+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Export créé : Enfants, Ados, Adultes, Synthèse et Stages par mois.');}catch(e){status(e.message,true);}};
if(!client)status('Connexion indisponible : rechargez la page',true);
else{client.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>authState(s),0);});const {data}=await client.auth.getSession();await authState(data.session);}
setInterval(()=>{if(!document.hidden)load();},60000);
