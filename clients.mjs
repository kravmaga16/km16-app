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
let overviewLoaded=false,shirtRefresh=0;
function renderOverview(){const put=(id,v)=>{$(id).textContent=v;};if(!overviewLoaded){for(const id of ['kpi-members','kpi-net','kpi-review'])put(id,'—');return;}const review=all.filter(c=>c.group==='À vérifier'||!Array.isArray(c.address)||!c.address.length).length;put('kpi-members',String(all.length));put('kpi-net',euro(all.reduce((sum,c)=>sum+(c.amounts?.net_cents||0),0)));put('kpi-review',String(review));put('kpi-members-note').textContent='Fiches du fichier · saison '+$('season').value;put('kpi-net-note').textContent=($('test').checked?'Mode TEST · ':'')+'Hors imports Sportigo/Fighty et boutique';put('kpi-review-note').textContent='Âge ou adresse à vérifier';$('kpi-updated').textContent='Données du fichier actualisées à '+new Date().toLocaleTimeString('fr-FR');}
async function refreshShirtKpi(){if(session?.user.email?.toLowerCase()!==ADMIN)return;const ticket=++shirtRefresh;putShirts('…','Consultation des commandes réelles…');try{const {data:{session:current}}=await client.auth.getSession();if(!current)throw Error('Session expirée');const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-shirts',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'list'})});const data=await r.json();if(!r.ok||!Array.isArray(data.orders))throw Error(data.error||'Commandes indisponibles');if(ticket!==shirtRefresh)return;const pending=data.orders.filter(o=>o.livemode===true&&o.status==='paid'&&!o.collected_at).length;putShirts(String(pending),'Commandes réelles payées · non retirées');}catch(e){if(ticket===shirtRefresh)putShirts('—','Données indisponibles · ouvrir la boutique');}}
function putShirts(value,note){$('kpi-shirts').textContent=value;$('kpi-shirts-note').textContent=note;}
const euro=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n/100);
const moneyFields=[['total_cents','Achats'],['gross_cents','Encaissé brut'],['refunded_cents','Remboursements'],['net_cents','Encaissé net'],['future_cents','Échéances futures'],['planned_cents','CA planifié · net + futur'],['overdue_cents','Échues impayées'],['cancelled_cents','Échéances annulées'],['disputed_cents','Montants contestés inclus dans le net']];
const status=(text,error=false)=>{$('status').textContent=text;$('status').className=error?'status error':'status';};
function clear(){closeMemberProfile();overviewLoaded=false;renderOverview();shirtRefresh++;putShirts('—','En attente de connexion');all=[];$('stage-rows').replaceChildren();$('money-summary').replaceChildren();$('money-breakdown').replaceChildren();$('money-alerts').replaceChildren();$('money-alerts').hidden=true;$('rows').replaceChildren();$('data-status').textContent='';$('imports-note').textContent='';$('export').disabled=true;for(const g of ['enfants','ados','adultes'])$('split-'+g).textContent='';for(const id of ['count-enfants','count-ados','count-adultes'])$(id).textContent='0';}
let selectedMember=null;
function closeMemberProfile(){selectedMember=null;$('member-profile').hidden=true;$('member-profile-content').replaceChildren();}
function profileLine(parent,label,value){const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=label+' : ';p.append(strong,document.createTextNode(value===null||value===undefined||value===''?'Non renseigné':String(value)));parent.append(p);}
function profileBlock(parent,title){const block=document.createElement('div');block.className='km16-profile-block';const h=document.createElement('h3');h.textContent=title;block.append(h);parent.append(block);return block;}
function openMemberProfile(c){if(!all.includes(c))return;selectedMember=c;const panel=$('member-profile'),body=$('member-profile-content');body.replaceChildren();$('member-profile-title').textContent='Fiche · '+[c.first_name,c.last_name].filter(Boolean).join(' ');$('member-profile-scope').textContent='Saison '+$('season').value+' · '+(c.group||'Groupe à vérifier')+($('test').checked?' · ENVIRONNEMENT TEST':'');const grid=document.createElement('div');grid.className='km16-profile-grid';body.append(grid);
 const info=profileBlock(grid,'Identité et contact');profileLine(info,'Prénom',c.first_name);profileLine(info,'Nom',c.last_name);profileLine(info,'Groupe',c.group);profileLine(info,'E-mail',c.email);profileLine(info,'Téléphone',c.phone);profileLine(info,'Représentant légal',c.guardian_name);profileLine(info,'Adresse',Array.isArray(c.address)?c.address.join(', '):'');
 const products=profileBlock(grid,'Achats et inscriptions connus');if(!c.products?.length){profileLine(products,'Produits','Aucun produit enregistré dans ce fichier');}else{const ul=document.createElement('ul');ul.className='km16-profile-products';for(const p of c.products){const li=document.createElement('li');li.textContent=[p.title,p.state,p.external?'Montant non intégré':Number.isFinite(p.total_cents)?euro(p.total_cents):'Montant non renseigné'].filter(Boolean).join(' · ');ul.append(li);}products.append(ul);}
 const money=profileBlock(grid,'Situation financière · fichier clients');if(c.external_only){profileLine(money,'Statut','Import externe : montants non intégrés');}else{for(const [key,label] of moneyFields.slice(0,8)){profileLine(money,label,c.forecast_unknown&&['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(key)?'À vérifier':euro(c.amounts?.[key]||0));}if(c.forecast_unknown)profileLine(money,'Prévision','Échéancier incomplet');}
 const notes=profileBlock(grid,'Suivi du dossier');profileLine(notes,'Source',c.source||'KM16');profileLine(notes,'Notes import',c.import_notes);profileLine(notes,'Justificatif tarif',c.saint_jean?'Tarif Saint-Jean : justificatif non validé par ce marquage':'Non applicable');profileLine(notes,'État',!Array.isArray(c.address)||!c.address.length||c.group==='À vérifier'?'Informations à vérifier':'Informations du fichier disponibles');
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
function render(){
 if(selectedMember&&!all.includes(selectedMember))closeMemberProfile();renderOverview();communications.update();
 renderMoneySummary();
 $('stage-rows').replaceChildren();for(const m of stagesMonthly(all)){const tr=document.createElement('tr');for(const v of [m.month,m.sold,m.refunded,m.retained,euro(m.amount_cents),euro(m.net_cents)])cell(tr,String(v));$('stage-rows').append(tr);}
 $('rows').replaceChildren();const shown=all.filter(c=>(!group||c.group===group)&&matches(c));
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
 if(admin){$('identity').textContent=s.user.email;refreshShirtKpi();await load();communications.load();}
}
$('login-form').onsubmit=async event=>{event.preventDefault();if(!client)return;const button=$('login-button');button.disabled=true;status('');try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;}catch(e){status(e.message,true);}finally{button.disabled=false;$('password').value='';}};
const logout=async()=>{generation++;controller?.abort();clear();await client.auth.signOut();await authState(null);};
$('logout').onclick=logout;$('other-account').onclick=logout;
$('season').onchange=()=>{generation++;controller?.abort();busy=false;clear();showSeason();load();};
$('refresh').onclick=load;$('search').oninput=render;
$('all').onclick=()=>{group='';render();};
for(const b of document.querySelectorAll('[data-group]'))b.onclick=()=>{group=b.dataset.group;render();};
$('test').onchange=()=>{generation++;controller?.abort();busy=false;clear();load();};
$('export').onclick=()=>{try{const rows=all.filter(matches);if(!rows.length)return;const bytes=clientsWorkbook(rows,all);const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=($('test').checked?'TEST-':'')+'KM16-Clients-'+$('season').value.replace('/','-')+'-'+new Date().toISOString().slice(0,10)+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Export créé : Enfants, Ados, Adultes, Synthèse et Stages par mois.');}catch(e){status(e.message,true);}};
if(!client)status('Connexion indisponible : rechargez la page',true);
else{client.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>authState(s),0);});const {data}=await client.auth.getSession();await authState(data.session);}
setInterval(()=>{if(!document.hidden)load();},60000);
