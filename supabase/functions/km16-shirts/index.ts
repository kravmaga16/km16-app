import nodemailer from 'npm:nodemailer@7';
import Stripe from 'npm:stripe@22';
import { createCheckoutReminderRecorder } from '../_shared/checkout-reminders.mjs';
const SITE='https://app.km16.fr',BASE=Deno.env.get('SUPABASE_URL')!,KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,SECRET=Deno.env.get('KM16_SHIRTS_STRIPE_TEST_SECRET_KEY')||'sk_test_not_configured';
const LIVE_KEY=Deno.env.get('KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY')||'';const stripe=new Stripe(SECRET);const liveStripe=LIVE_KEY.startsWith('sk_live_')?new Stripe(LIVE_KEY):null;const ACTIVE_LIVE=true;const H={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:H});
const checkoutReminders=createCheckoutReminderRecorder({base:BASE,serviceKey:KEY});
async function db(path:string,method='GET',body?:unknown){const r=await fetch(BASE+'/rest/v1/'+path,{method,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok)throw Error('Erreur base');return await r.json();}
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:H});if(req.method!=='POST'||req.headers.get('origin')!==SITE)return reply({error:'Accès refusé'},403);
try{const token=req.headers.get('authorization')||'';if(!/^Bearer \S+$/.test(token))return reply({error:'Connexion nécessaire'},401);
const auth=await fetch(BASE+'/auth/v1/user',{headers:{apikey:KEY,Authorization:token}});if(!auth.ok)return reply({error:'Session expirée'},401);const user=await auth.json();if(!user.email_confirmed_at||user.is_anonymous)return reply({error:'Confirmez votre e-mail'},403);
const data=await req.json();const admin=user.email?.toLowerCase()==='alexandre.marchat@gmail.com';
async function reconcile(o:any){if(o.status!=='pending'||!o.stripe_session_id)return o;const provider=o.livemode?liveStripe:stripe;if(!provider)throw Error('Stripe production indisponible');const session=await provider.checkout.sessions.retrieve(o.stripe_session_id);if(session.livemode!==o.livemode||session.metadata?.km16_shirt_order!==o.id||session.amount_total!==o.amount_cents||session.currency!=='eur')throw Error('Paiement Stripe incohérent');if(session.payment_status==='paid'){const a=await db('km16_shirt_orders?id=eq.'+o.id,'PATCH',{status:'paid'});return a[0]||{...o,status:'paid'};}if(session.status==='expired'){const a=await db('km16_shirt_orders?id=eq.'+o.id,'PATCH',{status:'cancelled'});return a[0]||{...o,status:'cancelled'};}return o;}
if(data.action==='list'){const rows=await db('km16_shirt_orders?livemode=eq.'+ACTIVE_LIVE+'&'+(admin?'':'user_id=eq.'+user.id+'&')+'order=created_at.desc&limit=100');return reply({orders:await Promise.all(rows.map(reconcile))});}
if(data.action==='store-status')return reply({livemode:ACTIVE_LIVE});
if(data.action==='live-readiness'){if(!admin)return reply({error:'Accès réservé'},403);const key=Deno.env.get('KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY');if(!key?.startsWith('sk_live_'))return reply({ready:false,reason:'Clé Stripe de production absente ou format incorrect'});try{const liveStripe=new Stripe(key);const account=await liveStripe.accounts.retrieve();return reply({ready:true,livemode:true,charges_enabled:account.charges_enabled===true,payouts_enabled:account.payouts_enabled===true,details_submitted:account.details_submitted===true});}catch(e){return reply({ready:false,reason:'Clé de production non validée par Stripe',code:String(e?.type||e?.code||'stripe_error').slice(0,45)});}}
if(data.action==='mail-diagnostic'){if(!admin)return reply({error:'Accès réservé'},403);const password=Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD');if(!password)return reply({ok:false,step:'secret',reason:'Mot de passe SMTP absent de cette fonction'});const transport=nodemailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{rejectUnauthorized:true}});try{await transport.verify();return reply({ok:true,message:'Connexion et authentification SMTP vérifiées'});}catch(e){return reply({ok:false,step:'smtp',code:String(e?.code||'UNKNOWN').slice(0,40),command:String(e?.command||'').slice(0,40),message:'Connexion ou authentification SMTP refusée'});}finally{transport.close();}}
if(data.action==='test-confirmation'){if(!admin)return reply({error:'Accès réservé'},403);const rows=await db('km16_shirt_orders?status=eq.paid&order=created_at.desc&limit=1');if(!rows.length)return reply({error:'Aucune commande payée'},404);const o=await reconcile(rows[0]);if(o.status!=='paid')return reply({error:'Paiement non confirmé'},409);const transport=nodemailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD')},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{rejectUnauthorized:true}});const amount=(o.amount_cents/100).toFixed(2).replace('.',',');const mail=await transport.sendMail({from:'KM16 <contact@km16.fr>',to:'alexandre.marchat@gmail.com',replyTo:'contact@km16.fr',subject:'[TEST KM16] Confirmation de commande tee-shirts',text:'Bonjour,\\n\\nVotre commande test de tee-shirts KM16 est payée.\\nTailles : '+o.sizes.join(' + ')+'\\nTotal : '+amount+' €\\nRetrait au club uniquement, sans livraison.\\n\\nCeci est un test : aucun tee-shirt réel ne doit être remis sur la base de ce message.\\n\\nKM16',disableFileAccess:true,disableUrlAccess:true});transport.close();if(!mail.accepted?.length)return reply({error:'Message refusé'},502);return reply({ok:true,message:'Confirmation test acceptée par le serveur de messagerie'});}
if(data.action==='retry-failed-handover'){if(!admin)return reply({error:'Accès réservé'},403);const rows=await db('km16_shirt_orders?status=eq.paid&handover_email_status=eq.failed&collected_at=not.is.null&order=created_at.desc&limit=1');if(!rows.length)return reply({ok:true,email_sent:false,message:'Aucune confirmation échouée à relancer.'});data.action='retry-handover-email';data.id=rows[0].id;}
if(data.action==='collect'||data.action==='retry-handover-email'){
 if(!admin)return reply({error:'Accès réservé'},403);
 if(!/^[0-9a-f-]{36}$/i.test(data.id))return reply({error:'Commande invalide'},400);
 const rows=await db('km16_shirt_orders?id=eq.'+data.id);if(!rows.length)return reply({error:'Commande introuvable'},404);
 const order=await reconcile(rows[0]);if(order.status!=='paid')return reply({error:'Paiement non confirmé'},409);
 // Un seul administrateur peut enregistrer la remise et réclamer l'envoi.
 const retry=data.action==='retry-handover-email';
 const claimed=retry?await db('km16_shirt_orders?id=eq.'+data.id+'&collected_at=not.is.null&handover_email_status=eq.failed&status=eq.paid','PATCH',{handover_email_status:'sending'}):await db('km16_shirt_orders?id=eq.'+data.id+'&collected_at=is.null&status=eq.paid','PATCH',{collected_at:new Date().toISOString(),handover_email_status:'sending'});
 if(!claimed.length)return reply({error:retry?'Aucun envoi échoué à relancer':'Remise déjà enregistrée. Aucun nouvel e-mail envoyé.'},409);
 // En mode test, les messages ne partent jamais vers les adhérents.
 const test=!order.livemode;
 const to=test?'alexandre.marchat@gmail.com':order.email;
 if(!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(to)){
  await db('km16_shirt_orders?id=eq.'+data.id,'PATCH',{handover_email_status:'failed'});
  return reply({ok:true,email_sent:false,message:'Retrait enregistré, adresse e-mail invalide.'});
 }
 try{
  const transport=nodemailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD')},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{rejectUnauthorized:true}});
  const amount=(order.amount_cents/100).toFixed(2).replace('.',',');
  const body=['Bonjour,','','Nous vous confirmons la remise de votre commande de tee-shirts KM16 au club.','', 'Tailles : '+order.sizes.join(' + '),'Montant réglé : '+amount+' €','Date de remise : '+new Date().toLocaleString('fr-FR',{timeZone:'Europe/Paris'}),'','Merci pour votre confiance.','', 'L’équipe KM16','contact@km16.fr'].join('\n');
  const sent=await transport.sendMail({from:'KM16 <contact@km16.fr>',to,replyTo:'contact@km16.fr',subject:(test?'[TEST KM16] ':'')+'Confirmation de remise de vos tee-shirts',text:body,disableFileAccess:true,disableUrlAccess:true});
  transport.close();
  if(!sent.accepted?.length)throw Error('SMTP refusé');
  await db('km16_shirt_orders?id=eq.'+data.id,'PATCH',{handover_email_status:'sent',handover_email_sent_at:new Date().toISOString()});
  return reply({ok:true,email_sent:true,test});
 }catch(e){
  console.error('handover_mail',e?.name);
  await db('km16_shirt_orders?id=eq.'+data.id,'PATCH',{handover_email_status:'failed'});
  return reply({ok:true,email_sent:false,message:'Retrait enregistré, mais envoi e-mail non confirmé.'});
 }
}
if(data.action!=='checkout')return reply({error:'Action inconnue'},400);
const sizes=data.sizes;if(!Array.isArray(sizes)||![1,2].includes(sizes.length)||sizes.some((s:any)=>!['XXS','XS','S','M','L','XL','2XL'].includes(s)))return reply({error:'Choisissez une ou deux tailles valides'},400);
if(ACTIVE_LIVE&&!liveStripe)return reply({error:'Stripe réel indisponible'},503);if(!ACTIVE_LIVE&&(!SECRET.startsWith('sk_test_')||SECRET==='sk_test_not_configured'))return reply({error:'Stripe test indisponible'},503);
const recent=await db('km16_shirt_orders?livemode=eq.'+ACTIVE_LIVE+'&user_id=eq.'+user.id+'&created_at=gte.'+encodeURIComponent(new Date(Date.now()-3600000).toISOString())+'&select=id');if(recent.length>=8)return reply({error:'Trop de commandes, contactez KM16'},429);
const id=crypto.randomUUID(),amount=sizes.length===1?1800:3000;await db('km16_shirt_orders','POST',{id,user_id:user.id,email:user.email,sizes,amount_cents:amount,livemode:ACTIVE_LIVE});
const attempt=ACTIVE_LIVE?await checkoutReminders.begin({kind:'shirts',sourceId:id,user,optIn:data.reminder_opt_in===true,livemode:ACTIVE_LIVE,amountCents:amount}):null;
const session=await (ACTIVE_LIVE?liveStripe!:stripe).checkout.sessions.create({mode:'payment',payment_method_types:['card'],customer_email:user.email,line_items:[{price_data:{currency:'eur',unit_amount:amount,product_data:{name:sizes.length===1?'Tee-shirt blanc KM16':'Lot de 2 tee-shirts blancs KM16',description:'Tailles : '+sizes.join(' + ')+' · Retrait au club uniquement'}},quantity:1}],metadata:{km16_source:'km16-shirts-v1',km16_shirt_order:id},payment_intent_data:{metadata:{km16_source:'km16-shirts-v1',km16_shirt_order:id}},success_url:SITE+'/tee-shirts.html?paid=1',cancel_url:SITE+'/tee-shirts.html?cancel=1',locale:'fr',expires_at:Math.floor(Date.now()/1000)+1800},{idempotencyKey:'km16-shirts-'+id});
await db('km16_shirt_orders?id=eq.'+id,'PATCH',{stripe_session_id:session.id});
if(attempt)await checkoutReminders.attach(attempt,session,{kind:'shirts',sourceId:id,userId:user.id,amountCents:amount});
return reply({url:session.url});
}catch(e){console.error('shirts',e?.name);return reply({error:'Commande indisponible. Contactez KM16 si vous avez été débité.'},500);}});
