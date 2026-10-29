import {clientsWorkbook} from './clients-excel.mjs?v=prevision2';
const $=id=>document.getElementById(id),ADMIN='alexandre.marchat@gmail.com';
const client=window.supabase?.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-clients';
let session=null,all=[],group='',generation=0,busy=false,controller=null;
const euro=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n/100);
const moneyFields=[['total_cents','Achats'],['gross_cents','Encaissé brut'],['refunded_cents','Remboursements'],['net_cents','Encaissé net'],['future_cents','Échéances futures'],['planned_cents','CA planifié · net + futur'],['overdue_cents','Échues impayées'],['cancelled_cents','Échéances annulées'],['disputed_cents','Montants contestés inclus dans le net']];
const status=(text,error=false)=>{$('status').textContent=text;$('status').className=error?'status error':'status';};
function clear(){all=[];$('money-summary').replaceChildren();$('rows').replaceChildren();$('data-status').textContent='';$('export').disabled=true;for(const id of ['count-enfants','count-ados','count-adultes'])$(id).textContent='0';}
const matches=c=>{const q=$('search').value.normalize('NFKC').toLocaleLowerCase('fr-FR').trim();return !q||[c.last_name,c.first_name,c.email,c.phone,c.guardian_name,...c.address,...c.products.map(p=>p.title)].join(' ').normalize('NFKC').toLocaleLowerCase('fr-FR').includes(q);};
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.appendChild(td);return td;}
function render(){
 $('money-summary').replaceChildren();for(const [key,label] of moneyFields){const box=document.createElement('div');box.className='panel';const text=document.createElement('div');text.textContent=label;const value=document.createElement('strong');value.textContent=euro(all.reduce((n,c)=>n+(c.amounts?.[key]||0),0))+((['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(key)&&all.some(c=>c.forecast_unknown))?' · PARTIEL À VÉRIFIER':'');box.append(text,value);$('money-summary').append(box);}
 $('rows').replaceChildren();const shown=all.filter(c=>(!group||c.group===group)&&matches(c));
 for(const c of shown){const row=document.createElement('tr');cell(row,c.group);
  const name=cell(row,c.last_name+' '+c.first_name);if(c.guardian_name){const small=document.createElement('div');small.className='muted';small.textContent='Représentant : '+c.guardian_name;name.append(small);}
  const address=cell(row,c.address.length?c.address.join(', '):'Adresse en attente de facturation');if(c.billing_name){const small=document.createElement('div');small.className='muted';small.textContent='Facturé à : '+c.billing_name;address.append(small);}
  const contact=cell(row,c.email);const phone=document.createElement('div');phone.textContent=c.phone;contact.append(phone);
  const td=cell(row,'');const ul=document.createElement('ul');for(const p of c.products){const li=document.createElement('li');li.textContent=p.title+' · '+euro(p.total_cents);if(p.state!=='Acheté'){const state=document.createElement('span');state.className='tag';state.textContent=p.state;li.append(' ',state);}ul.append(li);}td.append(ul);for(const [key] of moneyFields.slice(0,8))cell(row,c.forecast_unknown&&['future_cents','planned_cents','overdue_cents','cancelled_cents'].includes(key)?'À vérifier':euro(c.amounts[key]));if(c.amounts.disputed_cents){const warning=document.createElement('div');warning.className='tag';warning.textContent='Contesté : '+euro(c.amounts.disputed_cents);td.append(warning);}$('rows').append(row);
 }
 if(!shown.length){const row=document.createElement('tr'),td=cell(row,all.length?'Aucun client pour cette sélection':'Aucun achat encaissé dans cet environnement');td.colSpan=13;$('rows').append(row);}
 $('count-enfants').textContent=all.filter(c=>c.group==='Enfants').length;
 $('count-ados').textContent=all.filter(c=>c.group==='Ados').length;
 $('count-adultes').textContent=all.filter(c=>c.group==='Adultes').length;
 for(const b of document.querySelectorAll('[data-group]'))b.setAttribute('aria-pressed',String(b.dataset.group===group));
 $('export').disabled=busy||!all.some(matches);
}
async function load(){
 if(busy||session?.user.email?.toLowerCase()!==ADMIN)return;
 busy=true;render();const gen=generation,test=$('test').checked;controller=new AbortController();
 $('data-status').textContent='Chargement du fichier clients…';
 try{
  const {data:{session:current}}=await client.auth.getSession();if(!current)throw Error('Session expirée');
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'clients',test}),signal:controller.signal});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Chargement impossible');
  if(gen!==generation||test!==$('test').checked)return;
  if(!Array.isArray(data.clients)||data.test!==test)throw Error('Réponse inattendue');
  all=data.clients;$('test-notice').hidden=!test;
  const missing=all.filter(c=>!c.address.length).length,unchecked=all.filter(c=>c.group==='À vérifier').length;
  $('data-status').textContent=all.length+' pratiquant(s) · Mis à jour à '+new Date(data.updated_at).toLocaleTimeString('fr-FR')+(missing?' · '+missing+' adresse(s) en attente':'')+(unchecked?' · '+unchecked+' âge(s) à vérifier':'')+(all.some(c=>c.forecast_unknown)?' · Prévision incomplète : certains échéanciers n’ont pas pu être vérifiés':'');status('');
 }catch(e){if(gen===generation&&e.name!=='AbortError'){clear();$('data-status').textContent='Chargement interrompu';status(e.message,true);}}
 finally{if(gen===generation){busy=false;render();}}
}
async function authState(s){
 generation++;controller?.abort();busy=false;session=s;clear();
 const admin=s?.user.email?.toLowerCase()===ADMIN;
 $('login').hidden=!!s;$('forbidden').hidden=!s||admin;$('workspace').hidden=!admin;
 $('password').value='';$('test').checked=false;$('test-notice').hidden=true;group='';$('search').value='';
 if(admin){$('identity').textContent=s.user.email;await load();}
}
$('login-form').onsubmit=async event=>{event.preventDefault();if(!client)return;const button=$('login-button');button.disabled=true;status('');try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;}catch(e){status(e.message,true);}finally{button.disabled=false;$('password').value='';}};
const logout=async()=>{generation++;controller?.abort();clear();await client.auth.signOut();await authState(null);};
$('logout').onclick=logout;$('other-account').onclick=logout;
$('refresh').onclick=load;$('search').oninput=render;
$('all').onclick=()=>{group='';render();};
for(const b of document.querySelectorAll('[data-group]'))b.onclick=()=>{group=b.dataset.group;render();};
$('test').onchange=()=>{generation++;controller?.abort();busy=false;clear();load();};
$('export').onclick=()=>{try{const rows=all.filter(matches);if(!rows.length)return;const bytes=clientsWorkbook(rows,all);const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=($('test').checked?'TEST-':'')+'KM16-Clients-'+new Date().toISOString().slice(0,10)+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Export créé : Enfants, Ados, Adultes et Synthèse.');}catch(e){status(e.message,true);}};
if(!client)status('Connexion indisponible : rechargez la page',true);
else{client.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>authState(s),0);});const {data}=await client.auth.getSession();await authState(data.session);}
setInterval(()=>{if(!document.hidden)load();},60000);
