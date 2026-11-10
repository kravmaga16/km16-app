// Fichier autonome pour index.ts. Verify JWT OFF : contrôle Supabase Auth ci-dessous.
import Stripe from 'npm:stripe@22';
function splitAmount(total, count) {
 if (!Number.isSafeInteger(total) || total < 0 || ![1,3,4].includes(count)) throw Error('Échéancier invalide');
 const regular=Math.floor(total/count);
 return [regular+total%count,...Array(count-1).fill(regular)];
}
function monthAfter(timestamp) {
 const d=new Date(timestamp*1000),day=d.getUTCDate();
 d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 d.setUTCDate(Math.min(day,last));return Math.floor(d.getTime()/1000);
}
function ageOn(birth, date) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||new Date(birth+'T12:00:00Z').toISOString().slice(0,10)!==birth) throw Error('Date de naissance invalide');
 let age=Number(date.slice(0,4))-Number(birth.slice(0,4));
 if(date.slice(5)<birth.slice(5))age--;return age;
}
function validateOrder(product, data, today) {
 if(!product || product.draft)throw Error('Cette offre n’est pas ouverte');
 if(product.event_date&&product.event_date<today)throw Error('Cet événement est passé');
 const n=Number(data.count);if(![1,3,4].includes(n)||(product.kind!=='annual'&&n!==1))throw Error('Choix de paiement invalide');
 if(!String(data.first_name||'').trim()||!String(data.last_name||'').trim()||String(data.first_name).length>80||String(data.last_name).length>80)throw Error('Nom et prénom requis');
 const age=ageOn(data.birth_date,today);
 if(age<0||age>110||product.min_age!=null&&age<product.min_age||product.max_age!=null&&age>product.max_age)throw Error('L’âge ne correspond pas à cette formule : contactez KM16');
 if(age<18&&!String(data.guardian_name||'').trim())throw Error('Représentant légal requis pour un mineur');
 if(!/^\+?[\d ().-]{8,25}$/.test(String(data.phone||'')))throw Error('Téléphone invalide');
 if(data.terms!==true||data.license!==true||data.privacy!==true||n>1&&data.installments!==true||product.review&&data.eligibility!==true)throw Error('Veuillez compléter les confirmations');
 return {count:n,amounts:splitAmount(product.amount,n),age};
}

const SITE='https://app.km16.fr';
const stripe=new Stripe(Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY')||'sk_not_configured');
const base=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const headers={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers});}
async function db(path,method='GET',body=undefined,prefer=''){
 const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error('Base indisponible');const t=await r.text();return t?JSON.parse(t):null;
}
const live=()=>Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY')?.startsWith('sk_live_')===true;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function offerFor(token){
 if(!/^[a-f0-9]{64}$/.test(token||''))return null;
 return (await db('km16_purchase_links?token_hash=eq.'+await digest(token)+'&livemode=eq.'+live()))[0]||null;
}
Deno.serve(async req=>{
 if(req.headers.has('x-km16-worker-key')){
  const supplied=req.headers.get('x-km16-worker-key'),expected=Deno.env.get('KM16_DOCUMENTS_WORKER_KEY');
  const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).join(',');
  if(req.method!=='POST'||!expected||expected.length<32||!supplied||await digest(supplied)!==await digest(expected))return reply({error:'Accès refusé'},403);
  let input;try{input=await req.json();}catch{return reply({error:'Requête invalide'},400);}
  if(input.action!=='payment-readiness')return reply({error:'Action refusée'},403);
  try{
   const secret=Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY')||'';
   const headers={Authorization:'Bearer '+secret};
   const accountResponse=await fetch('https://api.stripe.com/v1/account',{headers,signal:AbortSignal.timeout(10000)});
   const account=accountResponse.ok?await accountResponse.json():{};
   const webhookResponse=await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100',{headers,signal:AbortSignal.timeout(10000)});
   const webhookData=webhookResponse.ok?await webhookResponse.json():{};
   const endpoint=(webhookData.data||[]).find(e=>e.url===base+'/functions/v1/km16-adhesions-webhook'&&e.status==='enabled');
   return reply({confirmations_live:(await db('km16_membership_config?id=eq.1'))[0]?.confirmations_enabled===true||Deno.env.get('KM16_CONFIRMATIONS_MODE')==='live',invoices_live:Deno.env.get('KM16_FACTURES_MODE')==='live',documents_live:Deno.env.get('KM16_DOCUMENTS_MODE')==='live',smtp_configured:!!Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD'),live_key:secret.startsWith('sk_live_'),live_allowed:Deno.env.get('KM16_ADHESIONS_ALLOW_LIVE')==='true',stripe_access:accountResponse.ok,charges_enabled:account.charges_enabled===true,payouts_enabled:account.payouts_enabled===true,webhook_secret:!!Deno.env.get('KM16_ADHESIONS_WEBHOOK_SECRET'),webhook_enabled:!!endpoint,webhook_events:endpoint?.enabled_events||[]});
  }catch{return reply({error:'Vérification Stripe indisponible'},503);}
 }
 if(req.headers.get('origin')!==SITE)return reply({error:'Origine refusée'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Méthode refusée'},405);
 try{
  if(!base||!key||!Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY'))throw Error('Configuration absente');
  const config=(await db('km16_membership_config?id=eq.1'))[0];
  let data;try{data=await req.json();}catch{return reply({error:'Requête invalide'},400);}
  if(data.action==='catalogue')return reply({products:await db('km16_membership_products?order=position'),enabled:config.enabled,terms_url:config.terms_url,privacy_url:config.privacy_url});
  if(data.action==='link-preview'){
   const l=await offerFor(data.link_token);
   if(!l||l.revoked_at||l.order_id||Date.parse(l.expires_at)<=Date.now())return reply({error:'Ce lien n’est plus disponible. Contactez KM16.'},409);
   const p=(await db('km16_membership_products?id=eq.'+encodeURIComponent(l.product_id)))[0];
   if(!p||p.draft||p.category==='Interne'||p.kind==='monthly')return reply({error:'Offre indisponible'},409);
   return reply({product:{...p,amount:l.total_cents},count:l.count,expires_at:l.expires_at});
  }
  const token=req.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(token))return reply({error:'Connectez-vous à votre compte KM16'},401);
  const ar=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:token}});
  if(!ar.ok)return reply({error:'Session expirée, reconnectez-vous'},401);
  const user=await ar.json();if(!user.email_confirmed_at||user.is_anonymous)return reply({error:'Confirmez votre adresse e-mail'},403);
  const admin=user.email?.toLowerCase()==='alexandre.marchat@gmail.com';
  if(data.action==='links-create'){
   if(!admin)return reply({error:'Accès privé'},403);
   const p=(await db('km16_membership_products?id=eq.'+encodeURIComponent(String(data.product_id))))[0];
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   if(!p||p.draft||p.category==='Interne'||p.kind==='monthly'||p.event_date&&p.event_date<today||p.kind==='annual'&&today>config.season_end)return reply({error:'Offre indisponible'},400);
   const count=data.count,amount=data.total_cents,email=String(data.recipient_email||'').trim().toLowerCase();
   if(![1,3,4].includes(count)||p.kind!=='annual'&&count!==1||!Number.isSafeInteger(amount)||amount<count*50||amount>p.amount||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply({error:'Vérifiez le tarif, les échéances et l’e-mail du compte payeur.'},400);
   const secret=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const link={id:crypto.randomUUID(),token_hash:await digest(secret),product_id:p.id,standard_cents:p.amount,total_cents:amount,count,recipient_email:email,livemode:live(),created_by:user.id,expires_at:new Date(Date.now()+7*86400000).toISOString()};
   await db('km16_purchase_links','POST',link);
   return reply({url:SITE+'/adhesion.html#offre='+secret,expires_at:link.expires_at,livemode:link.livemode});
  }
  if(data.action==='links-list'){
   if(!admin)return reply({error:'Accès privé'},403);
   return reply({links:await db('km16_purchase_links?select=id,product_id,standard_cents,total_cents,count,recipient_email,livemode,created_at,expires_at,revoked_at,order_id&order=created_at.desc&limit=100')});
  }
  if(data.action==='links-revoke'){
   if(!admin)return reply({error:'Accès privé'},403);
   if(!/^[0-9a-f-]{36}$/i.test(data.id))return reply({error:'Identifiant invalide'},400);
   const ok=await db('rpc/km16_revoke_purchase_link','POST',{p_id:data.id});
   return ok?reply({ok:true}):reply({error:'Lien déjà utilisé ou indisponible. Vérifiez le dossier dans Stripe.'},409);
  }
  if(data.action==='orders'){
   const orders=await db('km16_membership_orders?user_id=eq.'+user.id+'&select=id,product_id,title,livemode,total_cents,count,amounts,approval,created_at,stripe_session_id,schedule_id&order=created_at.desc');
   const ids=orders.map(o=>o.id);
   return reply({orders,payments:await db('km16_membership_payments?user_id=eq.'+user.id+'&select=order_id,reference,amount_cents,refunded_cents,status,created_at&order=created_at.desc'),documents:ids.length?await db('km16_membership_documents?order_id=in.('+ids.join(',')+')&select=order_id,health_kind,health_status,school_required,school_status,paid_at,updated_at'):[]});
  }
  if(data.action==='admin'){
   if(!admin)return reply({error:'Accès privé'},403);
   return reply({orders:await db('km16_membership_orders?order=created_at.desc&limit=500'),payments:await db('km16_membership_payments?order=created_at.desc&limit=2000'),documents:await db('km16_membership_documents?order=paid_at.desc&limit=500'),mails:await db('km16_document_mail_queue?order=due_at.desc&limit=1000&select=id,order_id,kind,status,due_at,sent_at,error_code')});
  }
  if(data.action==='documents-update'){
   if(!admin)return reply({error:'Accès privé'},403);
   if(!/^[0-9a-f-]{36}$/i.test(data.order_id)||!Number.isSafeInteger(data.revision)||data.revision<0||!['missing','received','validated'].includes(data.health_status)||!['not_required','missing','received','validated'].includes(data.school_status)||!['attestation','certificat'].includes(data.health_kind))return reply({error:'Valeur invalide'},400);
   const changed=await db('rpc/km16_update_documents','POST',{p_order:data.order_id,p_revision:data.revision,p_health:data.health_status,p_school:data.school_status,p_kind:data.health_kind,p_admin:user.id});
   if(!changed)return reply({error:'Le dossier a changé. Actualisez avant de réessayer'},409);
   return reply({ok:true});
  }
  if(data.action==='approve'){
   if(!admin)return reply({error:'Accès privé'},403);
   if(!/^[0-9a-f-]{36}$/i.test(data.order_id)||!['approved','rejected','pending'].includes(data.approval))return reply({error:'Valeur invalide'},400);
   await db('km16_membership_orders?id=eq.'+data.order_id,'PATCH',{approval:data.approval});
   return reply({ok:true});
  }
  if(data.action!=='checkout')return reply({error:'Action inconnue'},400);
  // Aucun paiement tant que l’installation et les textes n’ont pas été validés.
  if(!config.enabled||!config.terms_url||!config.privacy_url)return reply({error:'Les inscriptions en ligne ouvriront prochainement'},409);
  if(!/^[0-9a-f-]{36}$/i.test(data.request_id))return reply({error:'Identifiant de demande invalide'},400);
  const old=(await db('km16_membership_orders?id=eq.'+data.request_id+'&user_id=eq.'+user.id))[0];
  if(old){
   if(old.purchase_link_id){const l=await offerFor(data.link_token);if(!l||l.id!==old.purchase_link_id)return reply({error:'Lien invalide pour ce dossier'},403);}
   if(old.stripe_session_id){const s=await stripe.checkout.sessions.retrieve(old.stripe_session_id);if(s.status==='open')return reply({url:s.url});return reply({error:'Cette demande est déjà traitée. Consultez Mes inscriptions'},409);}
   return reply({error:'Une demande est en préparation. Actualisez dans quelques instants'},409);
  }
  let link=null;
  if(data.link_token){
   link=await offerFor(data.link_token);
   if(!link||link.revoked_at||link.order_id||Date.parse(link.expires_at)<=Date.now()||link.recipient_email!==user.email.toLowerCase())return reply({error:'Lien indisponible ou réservé à un autre compte payeur. Contactez KM16.'},409);
   data.product_id=link.product_id;data.count=link.count;
  }
  let product=(await db('km16_membership_products?id=eq.'+encodeURIComponent(data.product_id)))[0];
  if(link&&product)product={...product,amount:link.total_cents};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let valid;try{valid=validateOrder(product,data,today);}catch(e){return reply({error:e.message},400);}
  if(product.kind==='monthly')return reply({error:'Offre mensuelle en préparation'},409);
  if(product.kind==='annual'&&today>config.season_end)return reply({error:'Saison terminée'},409);
  const recent=await db('km16_membership_orders?user_id=eq.'+user.id+'&created_at=gte.'+encodeURIComponent(new Date(Date.now()-3600000).toISOString())+'&select=id');
  if(recent.length>=8)return reply({error:'Trop de demandes, contactez KM16'},429);
  if(Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY')?.startsWith('sk_live_')&&Deno.env.get('KM16_ADHESIONS_ALLOW_LIVE')!=='true')return reply({error:'Paiements réels non activés'},503);
  const id=data.request_id;
  let participantKey=null;
  if(product.kind==='annual'){
   const normalized=[Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY').startsWith('sk_live_')?'live':'test',user.id,config.season_end,data.first_name.trim().toLowerCase(),data.last_name.trim().toLowerCase(),data.birth_date].join('|');
   participantKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized)))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const duplicate=(await db('km16_membership_orders?participant_key=eq.'+participantKey+'&select=id'))[0];
   if(duplicate)return reply({error:'Un dossier existe déjà pour ce pratiquant cette saison. Consultez Mes inscriptions ou contactez KM16'},409);
  }
  // Snapshots de prix/consentements : ne jamais prendre de montant fourni par le navigateur.
  const order={id,user_id:user.id,email:user.email,participant_key:participantKey,product_id:product.id,livemode:Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY').startsWith('sk_live_'),title:product.title,total_cents:product.amount,count:valid.count,amounts:valid.amounts,first_name:data.first_name.trim(),last_name:data.last_name.trim(),birth_date:data.birth_date,phone:data.phone,guardian_name:valid.age<18?data.guardian_name.trim():null,approval:'pending',terms_version:config.terms_version,consented_at:new Date().toISOString(),license_external:true};
  if(link){
   order.purchase_link_id=link.id;order.standard_cents=link.standard_cents;
   const claimed=await db('rpc/km16_claim_purchase_link','POST',{p_hash:link.token_hash,p_order:order});
   if(!claimed)return reply({error:'Ce lien vient d’être utilisé ou annulé. Contactez KM16.'},409);
  }else await db('km16_membership_orders','POST',order);
  if(product.amount===0)return reply({free:true});
  const customer=await stripe.customers.create({email:user.email,preferred_locales:['fr'],metadata:{km16_order:id}},{idempotencyKey:'km16-member-customer-'+id});
  const metadata={km16_source:'km16-membership-v1',km16_order:id};
  const consent=valid.count>1?'Cotisation totale '+(product.amount/100).toFixed(2)+' EUR, sans frais supplémentaires. Première échéance aujourd’hui, puis '+(valid.count-1)+' prélèvements mensuels de '+(valid.amounts[1]/100).toFixed(2)+' EUR. Vous autorisez KM16 à réutiliser cette carte pour ces échéances uniquement.':'';
  const session=await stripe.checkout.sessions.create({mode:'payment',customer:customer.id,billing_address_collection:'required',customer_update:{name:'auto',address:'auto'},payment_method_types:['card'],line_items:[{price_data:{currency:'eur',unit_amount:valid.amounts[0],product_data:{name:product.title+' · '+(valid.count>1?'Échéance 1/'+valid.count:'Paiement intégral'),description:'Licence payée séparément. '+(valid.count>1?'Total cotisation : '+(product.amount/100).toFixed(2)+' EUR.':'')}},quantity:1}],metadata,payment_intent_data:{metadata,receipt_email:user.email,...(valid.count>1?{setup_future_usage:'off_session'}:{})},consent_collection:{terms_of_service:'required'},custom_text:{terms_of_service_acceptance:{message:'J’accepte les [conditions KM16]('+config.terms_url+').'},...(consent?{submit:{message:consent}}:{})},success_url:SITE+'/adhesion.html?paid=1',cancel_url:SITE+'/adhesion.html?cancel=1',locale:'fr',expires_at:Math.floor(Date.now()/1000)+1800},{idempotencyKey:'km16-member-checkout-'+id});
  await db('km16_membership_orders?id=eq.'+id,'PATCH',{stripe_session_id:session.id,customer_id:customer.id});
  return reply({url:session.url});
 }catch(e){console.error('KM16 adhésions',e?.type||e?.name);return reply({error:'Demande non aboutie. Contactez contact@km16.fr avant de recommencer si vous avez été débité'},500);}
});

