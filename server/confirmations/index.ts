// Nouvelle fonction km16-confirmations-mails. Verify JWT OFF ; secret obligatoire.
import nodemailer from 'npm:nodemailer@7';
function euro(cents) {
 if(!Number.isSafeInteger(cents)||cents<0)throw Error('amount');
 return (cents/100).toFixed(2).replace('.',',')+' €';
}
function monthlyDate(timestamp,offset) {
 const a=new Date(timestamp*1000),day=a.getUTCDate();
 a.setUTCDate(1);a.setUTCMonth(a.getUTCMonth()+offset);
 const last=new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+1,0)).getUTCDate();
 a.setUTCDate(Math.min(day,last));
 return a.toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'});
}
function confirmationMail(snapshot,charge,schedule,archive,test=false) {
 const amounts=snapshot.amounts;
 if(![1,3,4].includes(snapshot.count)||!Array.isArray(amounts)||amounts.length!==snapshot.count||amounts.some(x=>!Number.isSafeInteger(x)||x<=0)||amounts.reduce((a,b)=>a+b,0)!==snapshot.total_cents)throw Error('amounts');
 if(!charge.paid||charge.currency!=='eur'||charge.amount!==amounts[0])throw Error('charge');
 if(archive.version!==snapshot.terms_version)throw Error('version');
 for(const k of ['conditions_html','privacy_html','rules_html'])if(typeof archive[k]!=='string'||!archive[k].includes('<html'))throw Error('archive');
 if(snapshot.count>1&&(!schedule?.phases?.[0]?.start_date||schedule.end_behavior!=='cancel'))throw Error('schedule');
 const who=[snapshot.first_name,snapshot.last_name].join(' ').replace(/[\r\n]/g,' ');
 const lines=amounts.map((a,i)=>`${i+1}. ${euro(a)} — ${monthlyDate(i?schedule.phases[0].start_date:charge.created,i?i-1:0)}${i?' · échéance prévue':' · premier paiement enregistré'}`);
 const text=['Bonjour,','',`Le premier paiement pour ${who} a bien été enregistré.`,
 `Référence de commande : ${snapshot.id}`,`Formule : ${snapshot.title}`,`Montant total : ${euro(snapshot.total_cents)}`,`Paiement en ${snapshot.count} fois, sans frais de fractionnement KM16.`,
 '',...lines,'','Le paiement ne vaut pas validation administrative ni autorisation de pratiquer. Le dossier est vérifié par KM16 ; les conditions de licence et de santé restent à remplir.',
 'La licence FEKM est à souscrire et régler séparément : https://www.krav-maga.net/connexion/',
 'Les demandes de justificatifs et leur éventuelle relance sont envoyées séparément.',
 '',`Version des documents : ${snapshot.terms_version}`,`Acceptation enregistrée le ${new Date(snapshot.consented_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})}.`,
 'Vous trouverez ci-joints les conditions acceptées, la politique de confidentialité et le règlement intérieur. Conservez ce message et ses pièces jointes.',
 'Les montants ci-dessus constituent l’échéancier initial. Un remboursement ou une modification ultérieure doit faire l’objet d’un récapitulatif distinct.',
 '', 'Votre dossier : https://app.km16.fr/adhesion.html','Contact : contact@km16.fr','','Alexandre Marchat','Président de KM16'].join('\n');
 return {subject:(test?'[TEST KM16] ':'')+'KM16 · Confirmation de votre commande',text,
 attachments:[['conditions-adhesion.html','conditions_html'],['confidentialite.html','privacy_html'],['reglement-interieur.html','rules_html']].map(([filename,key])=>({filename,content:archive[key],contentType:'text/html; charset=utf-8'}))};
}

const base=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function db(path,method='GET',body=undefined){
 const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(!r.ok)throw Error('database');const s=await r.text();return s?JSON.parse(s):null;
}
async function matches(a,b){
 if(!a||!b||b.length<32)return false;
 const h=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const x=await h(a),y=await h(b);let n=0;for(let i=0;i<x.length;i++)n|=x[i]^y[i];return n===0;
}
function createTransport(){return nodemailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD')},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,tls:{rejectUnauthorized:true}});}
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({error:'POST uniquement'},{status:405});
 if(!await matches(req.headers.get('x-km16-worker-key'),Deno.env.get('KM16_DOCUMENTS_WORKER_KEY')))return Response.json({error:'Accès refusé'},{status:401});
 let transport;
 try{
  const config=(await db('km16_membership_config?id=eq.1'))[0];
  const mode=config?.confirmations_enabled===true?'live':Deno.env.get('KM16_CONFIRMATIONS_MODE')||'off';
  let input={};try{input=await req.json();}catch{}
  if(input.action==='readiness'){
   transport=createTransport();
   await transport.verify();
   return Response.json({smtp_verified:true,mode,production_switch:'confirmations_enabled'});
  }
  if(!['test','live'].includes(mode)||mode==='live'&&!config.confirmations_enabled)return Response.json({paused:true});
  const stripeKey=Deno.env.get(mode==='live'?'KM16_ADHESIONS_STRIPE_SECRET_KEY':'KM16_CONFIRMATIONS_TEST_STRIPE_SECRET_KEY');
  if(!base||!service||!Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD')||!stripeKey?.startsWith(mode==='live'?'sk_live_':'sk_test_'))return Response.json({error:'Configuration absente'},{status:503});
  const jobs=await db('rpc/km16_claim_confirmation','POST',{p_live:mode==='live'});
  if(!jobs?.length)return Response.json({sent:0});
  const job=jobs[0];let smtpStarted=false;
  try{
   const order=(await db('km16_membership_orders?id=eq.'+job.order_id))[0];
   const payments=await db('km16_membership_payments?order_id=eq.'+job.order_id);
   if(!order||order.livemode!==(mode==='live')||order.approval==='rejected'||!payments.some(p=>p.reference===order.payment_intent_id&&p.status==='paid')||payments.some(p=>p.refunded_cents>0||['refunded','disputed'].includes(p.status))){
    await db('km16_confirmation_queue?id=eq.'+job.id,'PATCH',{status:'skipped',error_code:'order_ineligible'});return Response.json({skipped:1});
   }
   const contract=(await db('km16_order_contracts?order_id=eq.'+job.order_id))[0];
   const archive=(await db('km16_legal_archives?version=eq.'+encodeURIComponent(contract.version)))[0];
   async function stripe(path){
    const r=await fetch('https://api.stripe.com/v1/'+path,{headers:{Authorization:'Bearer '+stripeKey,'Stripe-Version':'2026-08-26.dahlia'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('stripe');return await r.json();
   }
   const pi=await stripe('payment_intents/'+encodeURIComponent(order.payment_intent_id));
   const charge=await stripe('charges/'+encodeURIComponent(typeof pi.latest_charge==='string'?pi.latest_charge:pi.latest_charge.id));
   if(charge.refunded||charge.amount_refunded>0||charge.disputed)throw Error('changed_payment');
   if(charge.livemode!==order.livemode||charge.customer!==order.customer_id)throw Error('wrong_payment');
   const schedule=order.count>1?await stripe('subscription_schedules/'+encodeURIComponent(order.schedule_id)):null;
   if(schedule&&(schedule.customer!==order.customer_id||schedule.metadata?.km16_order!==order.id))throw Error('wrong_schedule');
   const mail=confirmationMail(contract.order_snapshot,charge,schedule,archive,mode==='test');
   const current=(await db('km16_membership_config?id=eq.1'))[0];
   if(mode==='live'&&!current.confirmations_enabled){await db('km16_confirmation_queue?id=eq.'+job.id,'PATCH',{status:'pending',locked_at:null});return Response.json({paused:true});}
   const to=mode==='test'?'alexandre.marchat@gmail.com':contract.order_snapshot.email;
   if(!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(to))throw Error('recipient');
   transport=createTransport();
   smtpStarted=true;
   const result=await transport.sendMail({from:'KM16 <contact@km16.fr>',replyTo:'contact@km16.fr',to,...mail,messageId:'<km16-confirmation-'+job.id+'@km16.fr>',disableFileAccess:true,disableUrlAccess:true});
   if(!result.accepted?.length)throw Error('not_accepted');
   await db('km16_confirmation_queue?id=eq.'+job.id,'PATCH',{status:'sent',sent_at:new Date().toISOString(),recipient:to,error_code:null});
   return Response.json({sent:1,test:mode==='test'});
  }catch{
   await db('km16_confirmation_queue?id=eq.'+job.id,'PATCH',{status:smtpStarted?'uncertain':'failed',error_code:smtpStarted?'check_delivery':'check_configuration'});
   return Response.json({failed:1});
  }
 }catch{return Response.json({error:'Configuration à vérifier'},{status:500});}
 finally{transport?.close();}
});
