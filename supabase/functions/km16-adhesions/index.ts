// Verify JWT OFF : contrôle Supabase Auth ci-dessous. Déployer aussi ../_shared/checkout-reminders.mjs.
import Stripe from 'npm:stripe@22';
import jpeg from 'npm:jpeg-js@0.4.4';
import { createCheckoutReminderRecorder } from '../_shared/checkout-reminders.mjs';
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
 if(!/^\+?[\d ().-]{8,25}$/.test(String(data.phone||''))||String(data.phone||'').replace(/\D/g,'').length<8)throw Error('Téléphone invalide');
 if(data.terms!==true||data.license!==true||data.privacy!==true||n>1&&data.installments!==true||product.review&&data.eligibility!==true)throw Error('Veuillez compléter les confirmations');
 return {count:n,amounts:splitAmount(product.amount,n),age};
}

const SITE='https://app.km16.fr';
const stripe=new Stripe(Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY')||'sk_not_configured');
const base=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const checkoutReminders=createCheckoutReminderRecorder({base,serviceKey:key});
const headers={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers});}
async function db(path,method='GET',body=undefined,prefer=''){
 const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error('Base indisponible');const t=await r.text();return t?JSON.parse(t):null;
}
const parisToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function renewalWindow(config,today){
 const start=Number(String(config.season_end).slice(0,4))-1;
 const opens=start+'-06-01';
 return config.enabled&&start>=2027&&today>=opens&&today<=config.season_end
  ?{opens,previous:(start-1)+'-06-01'}:null;
}
async function participantKeyFor(userId,seasonEnd,order){
 return digest([live()?'live':'test',userId,seasonEnd,order.first_name.trim().toLowerCase(),order.last_name.trim().toLowerCase(),order.birth_date].join('|'));
}
const live=()=>Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY')?.startsWith('sk_live_')===true;
function createMembershipCheckout(order,config,customerId,email,idempotencyKey,expiry){
  const id=order.id;
  const metadata={km16_source:'km16-membership-v1',km16_order:id};
  const consent=order.count>1?'Cotisation totale '+(order.total_cents/100).toFixed(2)+' EUR, sans frais supplémentaires. Première échéance aujourd’hui, puis '+(order.count-1)+' prélèvements mensuels de '+(order.amounts[1]/100).toFixed(2)+' EUR. Vous autorisez KM16 à réutiliser cette carte pour ces échéances uniquement.':'';
  return stripe.checkout.sessions.create({mode:'payment',customer:customerId,billing_address_collection:'required',customer_update:{name:'auto',address:'auto'},payment_method_types:['card'],line_items:[{price_data:{currency:'eur',unit_amount:order.amounts[0],product_data:{name:order.title+' · '+(order.count>1?'Échéance 1/'+order.count:'Paiement intégral'),description:'Licence payée séparément. '+(order.count>1?'Total cotisation : '+(order.total_cents/100).toFixed(2)+' EUR.':'')}},quantity:1}],metadata,payment_intent_data:{metadata,receipt_email:email,...(order.count>1?{setup_future_usage:'off_session'}:{})},consent_collection:{terms_of_service:'required'},custom_text:{terms_of_service_acceptance:{message:'J’accepte les [conditions KM16]('+config.terms_url+').'},...(consent?{submit:{message:consent}}:{})},success_url:SITE+'/adhesion.html?espace=1&paid=1&order='+id,cancel_url:SITE+'/adhesion.html?espace=1&cancel=1&order='+id,locale:'fr',...(expiry?{expires_at:expiry}:{})},{idempotencyKey});
}
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
  if(data.action==='admin-access')return admin?reply({admin:true}):reply({error:'Accès privé'},403);
  if(data.action==='photo-upload'||data.action==='member-photo-add'){
   if(!/^[0-9a-f-]{36}$/i.test(data.request_id))return reply({error:'Demande invalide'},400);
   const existing=(await db('km16_member_photos?id=eq.'+data.request_id))[0];
   if(existing&&existing.user_id!==user.id)return reply({error:'Demande indisponible'},403);
   const order=(await db('km16_membership_orders?id=eq.'+data.request_id+'&select=id,user_id,approval,livemode,total_cents'))[0];
   if(data.action==='member-photo-add'){
    if(!order||order.user_id!==user.id||!order.livemode||order.approval==='rejected'||order.total_cents<=0)
     return reply({error:'Dossier indisponible dans votre espace.'},404);
    const paid=await db('km16_membership_payments?order_id=eq.'+order.id+'&status=eq.paid&select=amount_cents,refunded_cents');
    if(!paid.some(p=>p.amount_cents>(p.refunded_cents||0)))return reply({error:'Le paiement doit être confirmé avant d’ajouter la photo.'},409);
    if(existing)return reply({ok:true});
   }else if(order){
    if(existing?.user_id===user.id)return reply({ok:true});
    return reply({error:'Ouvrez le dossier dans votre espace pour ajouter la photo.'},409);
   }
   const recent=await db('km16_member_photos?user_id=eq.'+user.id+'&created_at=gte.'+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+'&select=id');
   if(recent.length>=20)return reply({error:'Trop de photos envoyées. Contactez KM16.'},429);
   const input=String(data.photo||'');
   if(input.length>2000000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input))return reply({error:'Photo JPEG convertie requise'},400);
   let bytes;try{bytes=Uint8Array.from(atob(input.split(',')[1]),c=>c.charCodeAt(0));const image=jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:2,maxMemoryUsageInMB:64});if(image.width<100||image.height<100||image.width>1200||image.height>1200)throw Error();bytes=jpeg.encode(image,85).data;if(bytes.length>1500000)throw Error();}catch{return reply({error:'Photo non valide : utilisez une photo de 100 à 1200 pixels après conversion.'},400);}
   const path=user.id+'/'+data.request_id+'.jpg';
   const upload=await fetch(base+'/storage/v1/object/km16-member-photos/'+path,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'image/jpeg','x-upsert':data.action==='member-photo-add'?'false':'true'},body:bytes});
   if(!upload.ok){
    if(data.action==='member-photo-add'){
     const error=await upload.json().catch(()=>({}));
     if(error.error==='Duplicate'||upload.status===409||String(error.statusCode)==='409'){
      await db('km16_member_photos','POST',{id:data.request_id,user_id:user.id,path},'resolution=ignore-duplicates');
      return reply({ok:true});
     }
    }
    throw Error('Stockage photo indisponible');
   }
   await db('km16_member_photos','POST',{id:data.request_id,user_id:user.id,path},'resolution=merge-duplicates');
   return reply({ok:true});
  }
  if(data.action==='photo-view'){
   if(!/^[0-9a-f-]{36}$/i.test(data.order_id))return reply({error:'Dossier invalide'},400);
   const photo=(await db('km16_member_photos?id=eq.'+data.order_id+(admin?'':'&user_id=eq.'+user.id)))[0];
   if(!photo)return reply({error:'Photo indisponible'},404);
   const r=await fetch(base+'/storage/v1/object/sign/km16-member-photos/'+photo.path,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
   if(!r.ok)throw Error('Photo indisponible');const signed=await r.json();return reply({url:base+'/storage/v1'+signed.signedURL});
  }
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
  if(data.action==='membership-reuse'){
   const id=String(data.order_id||'');
   if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return reply({error:'Dossier invalide'},400);
   const order=(await db('km16_membership_orders?id=eq.'+id+'&user_id=eq.'+user.id+'&livemode=eq.true&select=id,product_id,first_name,last_name,birth_date,phone,guardian_name,approval,created_at'))[0];
   if(!order||order.approval==='rejected')return reply({error:'Dossier indisponible dans votre espace'},404);
   const today=parisToday();
   if(data.kind==='trial'){
    if(!(await db('km16_trial_attendance?order_id=eq.'+id+'&attended_on=lte.'+today+'&select=order_id&limit=1')).length)
     return reply({error:'La présence au cours d’essai n’est pas encore enregistrée'},409);
   }else if(data.kind==='renewal'){
    const window=renewalWindow(config,today);
    const product=(await db('km16_membership_products?id=eq.'+encodeURIComponent(order.product_id)+'&select=kind'))[0];
    const date=order.created_at.slice(0,10);
    if(!window||product?.kind!=='annual'||order.approval!=='approved'||date<window.previous||date>=window.opens)
     return reply({error:'Ce dossier n’est pas éligible au renouvellement en ligne'},409);
    const key=await participantKeyFor(user.id,config.season_end,order);
    if((await db('km16_membership_orders?participant_key=eq.'+key+'&select=id&limit=1')).length)
     return reply({error:'Une inscription existe déjà pour ce pratiquant pour la nouvelle saison'},409);
   }else return reply({error:'Parcours invalide'},400);
   const {first_name,last_name,birth_date,phone,guardian_name,product_id}=order;
   return reply({first_name,last_name,birth_date,phone,guardian_name,product_id});
  }
  if(data.action==='member-schedule'){
   const id=String(data.order_id||'');
   if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return reply({error:'Dossier invalide'},400);
   const order=(await db('km16_membership_orders?id=eq.'+id+'&user_id=eq.'+user.id+'&livemode=eq.true&select=schedule_id,customer_id,count'))[0];
   if(!order||order.count<=1||!order.schedule_id||!live())return reply({next_at:null});
   const schedule=await stripe.subscriptionSchedules.retrieve(order.schedule_id,{expand:['subscription']});
   if(schedule.customer!==order.customer_id||!schedule.livemode)return reply({next_at:null});
   const subscription=schedule.subscription;
   let next=null;
   if(schedule.status==='not_started'&&schedule.phases[0]?.collection_method!=='send_invoice')next=schedule.phases[0]?.start_date;
   if(schedule.status==='active'&&subscription?.status==='active'&&subscription.collection_method==='charge_automatically'&&!subscription.pause_collection&&!subscription.cancel_at_period_end){
    const period=subscription.items.data[0]?.current_period_end;
    if(period&&period<(subscription.cancel_at||Infinity)&&period<schedule.phases.at(-1)?.end_date)next=period;
   }
   return reply({next_at:next>Math.floor(Date.now()/1000)?new Date(next*1000).toISOString():null});
  }
  if(data.action==='member-bills'||data.action==='member-bill'){
   const oid=String(data.order_id||'');
   if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(oid))return reply({error:'Dossier invalide'},400);
   const order=(await db('km16_membership_orders?id=eq.'+oid+'&user_id=eq.'+user.id+'&livemode=eq.true&select=id'))[0];
   if(!order)return reply({error:'Dossier indisponible'},404);
   const filter='km16_bills?livemode=eq.true&snapshot->>order_id=eq.'+oid+'&pdf_base64=not.is.null';
   if(data.action==='member-bills'){
    const bills=await db(filter+'&select=number,issued_at,installment:snapshot->>installment,amount_cents:snapshot->>amount_cents&order=issued_at.asc');
    return reply({bills});
   }
   const number=String(data.number||'');
   if(!/^[A-Z0-9-]{1,60}$/i.test(number))return reply({error:'Facture invalide'},400);
   const bill=(await db(filter+'&number=eq.'+encodeURIComponent(number)+'&select=number,pdf_base64'))[0];
   if(!bill)return reply({error:'Facture indisponible pour ce dossier'},404);
   return reply({bill});
  }
  if(data.action==='orders'){
   const orders=await db('km16_membership_orders?user_id=eq.'+user.id+'&select=id,product_id,title,first_name,last_name,household_id,livemode,total_cents,count,amounts,approval,created_at,stripe_session_id,schedule_id&order=created_at.desc');
   const ids=orders.map(o=>o.id);
   const today=parisToday();
   const trials=orders.filter(o=>o.livemode&&['essai','essai-saint-jean'].includes(o.product_id)&&o.approval!=='rejected').map(o=>o.id);
   const attended=trials.length?await db('km16_trial_attendance?order_id=in.('+trials.join(',')+')&attended_on=lte.'+today+'&select=order_id'):[];
   const photos=ids.length?await db('km16_member_photos?user_id=eq.'+user.id+'&select=id'):[];
   return reply({orders,photo_order_ids:photos.map(photo=>photo.id),season_end:config.season_end,trial_attended_ids:attended.map(t=>t.order_id),renewal_window:renewalWindow(config,today),payments:await db('km16_membership_payments?user_id=eq.'+user.id+'&select=order_id,reference,amount_cents,refunded_cents,status,created_at&order=created_at.desc'),documents:ids.length?await db('km16_membership_documents?order_id=in.('+ids.join(',')+')&select=order_id,health_kind,health_status,school_required,school_status,paid_at,updated_at'):[]});
  }
  if(data.action==='admin-diagnostics'){
   if(!admin)return reply({error:'Accès privé'},403);
   const checks=[];
   try{const orders=await db('km16_membership_orders?select=id&limit=1');checks.push({name:'Accès aux dossiers',ok:Array.isArray(orders)});}catch{checks.push({name:'Accès aux dossiers',ok:false});}
   try{const history=await db('km16_membership_decision_history?select=id&limit=1');checks.push({name:'Lecture du journal des décisions',ok:Array.isArray(history)});}catch{checks.push({name:'Lecture du journal des décisions',ok:false});}
   return reply({checks,read_only:true,checked_at:new Date().toISOString()});
  }
  if(data.action==='admin-recent-decisions'){
   if(!admin)return reply({error:'Accès privé'},403);
   const page=Number(data.page??0),size=30;
   if(!Number.isSafeInteger(page)||page<0||page>100000)return reply({error:'Pagination invalide'},400);
   const approval=String(data.approval||'all');if(!['all','pending','approved','rejected'].includes(approval))return reply({error:'Filtre invalide'},400);
   const search=String(data.search||'').trim();if(search.length>120||search&&!/^[\p{L}\p{N} @._-]+$/u.test(search))return reply({error:'Recherche invalide'},400);
   let filters=approval==='all'?'':'&new_status=eq.'+approval;
   if(search){const term=search.replace(/[%*(),]/g,'').replace(/\s+/g,' ').trim();if(!term)return reply({error:'Recherche invalide'},400);filters+='&or=(actor_email.ilike.*'+encodeURIComponent(term)+'*,order_id.eq.'+(/^[0-9a-f-]{36}$/i.test(term)?term:'00000000-0000-0000-0000-000000000000')+')';}
   let snapshot=String(data.snapshot_id??'');
   if(snapshot&&!/^[1-9][0-9]{0,18}$/.test(snapshot))return reply({error:'Référence d’export invalide'},400);
   if(!snapshot){const newest=await db('km16_membership_decision_history?select=id&order=id.desc&limit=1');snapshot=String(newest[0]?.id??'0');}
   const history=snapshot==='0'?[]:await db('km16_membership_decision_history?select=id,order_id,previous_status,new_status,actor_email,decided_at&order=decided_at.desc,id.desc'+filters+'&id=lte.'+snapshot+'&offset='+(page*size)+'&limit='+(size+1));
   return reply({history:history.slice(0,size),page,has_more:history.length>size,snapshot_id:snapshot});
  }
  if(data.action==='admin-decision-history'){
   if(!admin)return reply({error:'Accès privé'},403);
   if(!/^[0-9a-f-]{36}$/i.test(String(data.order_id||'')))return reply({error:'Dossier invalide'},400);
   const history=await db('km16_membership_decision_history?order_id=eq.'+data.order_id+'&select=previous_status,new_status,actor_email,decided_at&order=decided_at.desc&limit=50');
   return reply({history});
  }
  if(data.action==='admin-page'){
   if(!admin)return reply({error:'Accès privé'},403);
   const page=Number(data.page??0),size=Number(data.page_size??25);
   if(!Number.isSafeInteger(page)||page<0||page>100000||!Number.isSafeInteger(size)||size<1||size>100)return reply({error:'Pagination invalide'},400);
   const start=page*size;
   const approval=String(data.approval||'all');if(!['all','pending','approved','rejected'].includes(approval))return reply({error:'Filtre invalide'},400);
   const search=String(data.search||'').trim().slice(0,100);
   if(search&&!/^[\p{L}\p{N} @._'\\-]+$/u.test(search))return reply({error:'Recherche invalide'},400);
   const tokens=search.split(/\s+/).filter(Boolean).slice(0,4);
   const filters=tokens.map(token=>'or=(first_name.ilike.*'+token+'*,last_name.ilike.*'+token+'*,email.ilike.*'+token+'*)');
   const fetched=await db('km16_membership_orders?select=*&livemode=eq.true&order=created_at.desc,id.desc&offset='+start+'&limit='+(size+1)+(approval==='all'?'':'&approval=eq.'+approval)+(filters.length?'&'+filters.map(f=>'or='+encodeURIComponent(f.slice(3))).join('&'):'') );
   const hasMore=fetched.length>size;
   const orders=fetched.slice(0,size);
   const ids=orders.map(o=>o.id);
   if(!ids.length)return reply({orders:[],payments:[],documents:[],mails:[],page,page_size:size,has_more:false});
   const condition='order_id=in.('+ids.join(',')+')';
   const [payments,documents,mails]=await Promise.all([
    db('km16_membership_payments?'+condition+'&order=created_at.desc&limit=1000'),
    db('km16_membership_documents?'+condition+'&order=paid_at.desc&limit=100'),
    db('km16_document_mail_queue?'+condition+'&order=due_at.desc&limit=1000&select=id,order_id,kind,status,due_at,sent_at,error_code')
   ]);
   return reply({orders,payments,documents,mails,page,page_size:size,has_more:hasMore});
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
   await db('rpc/km16_admin_set_membership_decision','POST',{p_order:data.order_id,p_status:data.approval,p_actor:user.id});
   return reply({ok:true});
  }
  if(data.action==='resume-checkout'){
   if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.order_id||''))return reply({error:'Dossier invalide'},400);
   const order=(await db('km16_membership_orders?id=eq.'+data.order_id+'&user_id=eq.'+user.id+'&select=id,approval,total_cents,stripe_session_id,livemode,customer_id,product_id,count,amounts,title,terms_version,participant_key,first_name,last_name,birth_date,purchase_link_id'))[0];
   if(!order)return reply({error:'Dossier introuvable dans votre espace'},404);
   if(!config.enabled||!order.livemode||!live()||Deno.env.get('KM16_ADHESIONS_ALLOW_LIVE')!=='true'||order.approval==='rejected'||!order.stripe_session_id||order.total_cents<=0)
    return reply({status:'unavailable'});
   const activity=await db('km16_membership_payments?order_id=eq.'+order.id+'&status=in.(paid,refunded,disputed)&select=order_id&limit=1');
   const checkout=await stripe.checkout.sessions.retrieve(order.stripe_session_id);
   if(activity.length||checkout.status==='complete'||checkout.payment_status==='paid')return reply({status:'processed'});
   if(checkout.mode!=='payment'||checkout.payment_status!=='unpaid'||!checkout.livemode||checkout.metadata?.km16_order!==order.id)
    return reply({status:'unavailable'});
   if(checkout.status==='open'&&checkout.url&&checkout.expires_at>Math.floor(Date.now()/1000)){
    const attempt=await checkoutReminders.begin({kind:'membership',sourceId:order.id,user,optIn:data.reminder_opt_in===true,livemode:order.livemode,amountCents:order.amounts[0]});
    await checkoutReminders.attach(attempt,checkout,{kind:'membership',sourceId:order.id,userId:user.id,amountCents:order.amounts[0]});
    return reply({status:'open',url:checkout.url});
   }
   if(checkout.status!=='expired')return reply({status:'unavailable'});
   // V6 updates the trial welcome. V7 makes the photo optional and clarifies privacy.
   // Existing paid orders retain their accepted archive.
   const paidTermsUnchanged=order.total_cents>0&&!['essai','essai-saint-jean'].includes(order.product_id)
    &&((order.terms_version==='km16-2026-11-10-v5'&&['km16-2026-11-20-v6','km16-2026-11-21-v7'].includes(config.terms_version))
    ||(order.terms_version==='km16-2026-11-20-v6'&&config.terms_version==='km16-2026-11-21-v7'));
   if(!order.customer_id||(order.terms_version!==config.terms_version&&!paidTermsUnchanged)||!config.terms_url||!config.privacy_url)
    return reply({status:'expired'});
   const product=(await db('km16_membership_products?id=eq.'+encodeURIComponent(order.product_id)))[0];
   const today=parisToday();
   if(!product||product.draft||product.kind==='monthly'||product.event_date&&product.event_date<today||
    product.kind==='annual'&&(today>config.season_end||order.participant_key!==await participantKeyFor(user.id,config.season_end,order)))
    return reply({status:'expired'});
   if(order.purchase_link_id){
    const offer=(await db('km16_purchase_links?id=eq.'+order.purchase_link_id+'&select=order_id,revoked_at,expires_at,total_cents'))[0];
    if(!offer||offer.order_id!==order.id||offer.revoked_at||Date.parse(offer.expires_at)<=Date.now()||offer.total_cents!==order.total_cents)
     return reply({status:'expired'});
   }else if(product.amount!==order.total_cents)return reply({status:'expired'});
   const previous=await stripe.checkout.sessions.list({customer:order.customer_id,limit:100});
   const related=previous.data.filter(s=>s.metadata?.km16_order===order.id);
   if(previous.has_more)return reply({status:'expired'});
   if(related.some(s=>s.status==='complete'||s.payment_status==='paid'))return reply({status:'processed'});
   const existing=related.find(s=>s.status==='open'&&s.payment_status==='unpaid'&&s.expires_at>Math.floor(Date.now()/1000)&&s.url);
   const anchor=related.find(s=>s.status==='expired')||checkout;
   const attempt=await checkoutReminders.begin({kind:'membership',sourceId:order.id,user,optIn:data.reminder_opt_in===true,livemode:order.livemode,amountCents:order.amounts[0]});
   const candidate=existing||await createMembershipCheckout(order,config,order.customer_id,user.email,'km16-reopen-'+anchor.id);
   const replacement=existing||await stripe.checkout.sessions.retrieve(candidate.id);
   if(replacement.status!=='open'||!replacement.url)return reply({status:'unavailable'});
   await db('km16_membership_orders?id=eq.'+order.id+'&stripe_session_id=eq.'+encodeURIComponent(checkout.id),'PATCH',{stripe_session_id:replacement.id});
   await checkoutReminders.attach(attempt,replacement,{kind:'membership',sourceId:order.id,userId:user.id,amountCents:order.amounts[0]});
   return reply({status:'open',url:replacement.url});
  }
  if(data.action!=='checkout')return reply({error:'Action inconnue'},400);
  // Aucun paiement tant que l’installation et les textes n’ont pas été validés.
  if(!config.enabled||!config.terms_url||!config.privacy_url)return reply({error:'Les inscriptions en ligne ouvriront prochainement'},409);
  if(!/^[0-9a-f-]{36}$/i.test(data.request_id))return reply({error:'Identifiant de demande invalide'},400);
  const old=(await db('km16_membership_orders?id=eq.'+data.request_id+'&user_id=eq.'+user.id))[0];
  if(old){
   if(old.purchase_link_id){const l=await offerFor(data.link_token);if(!l||l.id!==old.purchase_link_id)return reply({error:'Lien invalide pour ce dossier'},403);}
   if(old.stripe_session_id){const s=await stripe.checkout.sessions.retrieve(old.stripe_session_id);if(s.status==='open'){
    if(old.livemode===true&&old.total_cents>0&&s.mode==='payment'&&s.payment_status==='unpaid'&&s.metadata?.km16_order===old.id){
     const paid=await db('km16_membership_payments?order_id=eq.'+old.id+'&status=in.(paid,refunded,disputed)&select=order_id&limit=1');
     if(!paid.length){
      const attempt=await checkoutReminders.begin({kind:'membership',sourceId:old.id,user,optIn:data.reminder_opt_in===true,livemode:old.livemode,amountCents:old.amounts[0]});
      await checkoutReminders.attach(attempt,s,{kind:'membership',sourceId:old.id,userId:user.id,amountCents:old.amounts[0]});
     }
    }
    return reply({url:s.url});
   }return reply({error:'Cette demande est déjà traitée. Consultez Mes inscriptions'},409);}
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
  if(!user.email||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email))return reply({error:'E-mail confirmé obligatoire'},400);
  let participantKey=null;
  if(product.kind==='annual'){
   const normalized=[Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY').startsWith('sk_live_')?'live':'test',user.id,config.season_end,data.first_name.trim().toLowerCase(),data.last_name.trim().toLowerCase(),data.birth_date].join('|');
   participantKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized)))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const duplicate=(await db('km16_membership_orders?participant_key=eq.'+participantKey+'&select=id'))[0];
   if(duplicate)return reply({error:'Un dossier existe déjà pour ce pratiquant cette saison. Consultez Mes inscriptions ou contactez KM16'},409);
  }
  // Snapshots de prix/consentements : ne jamais prendre de montant fourni par le navigateur.
  let householdId=null;
  if(data.household_id){
   const value=String(data.household_id);
   if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ||!(await db('km16_household_members?id=eq.'+value+'&owner_id=eq.'+user.id+'&select=id&limit=1')).length)
    return reply({error:'Profil indisponible dans votre foyer'},400);
   householdId=value;
  }
  const order={id,user_id:user.id,email:user.email,household_id:householdId,participant_key:participantKey,product_id:product.id,livemode:Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY').startsWith('sk_live_'),title:product.title,total_cents:product.amount,count:valid.count,amounts:valid.amounts,first_name:data.first_name.trim(),last_name:data.last_name.trim(),birth_date:data.birth_date,phone:data.phone,guardian_name:valid.age<18?data.guardian_name.trim():null,approval:'pending',terms_version:config.terms_version,consented_at:new Date().toISOString(),license_external:true};
  if(link){
   order.purchase_link_id=link.id;order.standard_cents=link.standard_cents;
   const claimed=await db('rpc/km16_claim_purchase_link','POST',{p_hash:link.token_hash,p_order:order});
   if(!claimed)return reply({error:'Ce lien vient d’être utilisé ou annulé. Contactez KM16.'},409);
  }else await db('km16_membership_orders','POST',order);
  if(product.amount===0)return reply({free:true});
  const attempt=order.livemode?await checkoutReminders.begin({kind:'membership',sourceId:id,user,optIn:data.reminder_opt_in===true,livemode:order.livemode,amountCents:order.amounts[0]}):null;
  const customer=await stripe.customers.create({email:user.email,preferred_locales:['fr'],metadata:{km16_order:id}},{idempotencyKey:'km16-member-customer-'+id});
  const session=await createMembershipCheckout(order,config,customer.id,user.email,'km16-member-checkout-'+id,Math.floor(Date.now()/1000)+1800);
  await db('km16_membership_orders?id=eq.'+id,'PATCH',{stripe_session_id:session.id,customer_id:customer.id});
  if(attempt)await checkoutReminders.attach(attempt,session,{kind:'membership',sourceId:id,userId:user.id,amountCents:order.amounts[0]});
  return reply({url:session.url});
 }catch(e){console.error('KM16 adhésions',e?.type||e?.name);return reply({error:'Demande non aboutie. Contactez contact@km16.fr avant de recommencer si vous avez été débité'},500);}
});
