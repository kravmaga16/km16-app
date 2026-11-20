// NOUVEL endpoint, NOUVEAU secret webhook : ne pas remplacer le webhook des vidéos.
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

const stripe=new Stripe(Deno.env.get('KM16_ADHESIONS_STRIPE_SECRET_KEY')||'sk_not_configured');
const cryptoProvider=Stripe.createSubtleCryptoProvider();
async function db(path,method='GET',body=undefined,prefer=''){
 const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/'+path,{method,headers:{apikey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),Authorization:'Bearer '+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error('Échec base');const t=await r.text();return t?JSON.parse(t):null;
}
const oid=v=>typeof v==='string'?v:v?.id;
async function payment(order,reference,amount,status,refunded=0){
 await db('rpc/km16_record_membership_payment','POST',{p:{reference,order_id:order.id,user_id:order.user_id,amount_cents:amount,status,refunded_cents:refunded}});
}
async function stop(order){
 if(!order.schedule_id&&order.customer_id){
  const list=await stripe.subscriptionSchedules.list({customer:order.customer_id,limit:100});
  if(list.has_more)throw Error('Échéancier à vérifier manuellement');
  const found=list.data.find(s=>s.metadata?.km16_order===order.id);
  if(found)order={...order,schedule_id:found.id};
 }
 if(order.schedule_id){const sch=await stripe.subscriptionSchedules.retrieve(order.schedule_id);if(['not_started','active'].includes(sch.status))await stripe.subscriptionSchedules.cancel(sch.id,{invoice_now:false,prorate:false},{idempotencyKey:'km16-stop-'+order.id});}
 await db('km16_membership_orders?id=eq.'+order.id,'PATCH',{approval:'pending'});
}
async function familySessionPaid(s){
 const groupId=s.metadata?.km16_family;
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(groupId||'')
  ||s.mode!=='payment'||s.status!=='complete'||s.payment_status!=='paid'||s.currency!=='eur')return;
 const pi=await stripe.paymentIntents.retrieve(oid(s.payment_intent));
 if(pi.status!=='succeeded'||pi.currency!=='eur'||pi.amount_received!==s.amount_total||pi.livemode!==s.livemode
  ||pi.metadata?.km16_family!==groupId||oid(pi.customer)!==oid(s.customer))throw Error('Family payment mismatch');
 const c=await stripe.charges.retrieve(oid(pi.latest_charge));
 if(!c.paid||c.currency!=='eur'||c.amount!==s.amount_total||oid(c.customer)!==oid(s.customer))throw Error('Family charge mismatch');
 let allocations=null;
 if(c.amount_refunded>0&&c.amount_refunded<c.amount){
  const refunds=await stripe.refunds.list({charge:c.id,limit:100});
  const completed=refunds.data.filter(refund=>refund.status==='succeeded');
  if(!refunds.has_more&&completed.every(r=>/^[a-f0-9-]{36}$/i.test(r.metadata?.km16_order||''))){
   allocations=Object.create(null);
   for(const refund of completed){
    const id=refund.metadata.km16_order;
    allocations[id]=(allocations[id]||0)+refund.amount;
   }
  }
 }
 await db('rpc/km16_record_family_payment','POST',{p_id:groupId,p_session:s.id,p_intent:pi.id,p_livemode:s.livemode,
  p_total:s.amount_total,p_refunded:c.amount_refunded,p_disputed:c.disputed,p_allocations:allocations});
}
async function sessionPaid(id){
 const s=await stripe.checkout.sessions.retrieve(id);
 if(s.metadata?.km16_source==='km16-family-v1')return familySessionPaid(s);
 if(s.metadata?.km16_source!=='km16-membership-v1'||s.mode!=='payment'||s.status!=='complete'||s.payment_status!=='paid')return;
 const order=(await db('km16_membership_orders?id=eq.'+encodeURIComponent(s.metadata.km16_order)))[0];
 if(!order||s.amount_total!==order.amounts[0]||s.currency!=='eur')throw Error('Montant ou commande incorrect');
 if(order.stripe_session_id&&order.stripe_session_id!==s.id)throw Error('Session incorrecte');
 const pi=await stripe.paymentIntents.retrieve(oid(s.payment_intent));
 const charge=await stripe.charges.retrieve(oid(pi.latest_charge));
 await db('km16_membership_orders?id=eq.'+order.id,'PATCH',{stripe_session_id:s.id,customer_id:oid(s.customer),payment_intent_id:pi.id});
 const bad=charge.refunded||charge.amount_refunded>0||charge.disputed;
 // Ne jamais créer de prélèvements futurs à partir d’un paiement remboursé/litigieux.
 if(bad){await payment(order,pi.id,pi.amount,charge.disputed?'disputed':'refunded',charge.amount_refunded);await stop({...order,customer_id:oid(s.customer)});return;}
 if(pi.status!=='succeeded')return;
 await payment(order,pi.id,pi.amount,'paid');
 if(order.count>1&&!order.schedule_id){
  const schedules=await stripe.subscriptionSchedules.list({customer:oid(s.customer),limit:100});
  if(schedules.has_more)throw Error('Échéancier à vérifier manuellement');
  const existing=schedules.data.find(x=>x.metadata?.km16_order===order.id);
  if(existing){await db('km16_membership_orders?id=eq.'+order.id,'PATCH',{schedule_id:existing.id});return;}
  const date=monthAfter(charge.created);
  if(date<=Math.floor(Date.now()/1000))throw Error('Échéancier trop ancien : intervention manuelle nécessaire');
  const metadata={km16_source:'km16-membership-v1',km16_order:order.id};
  const price=await stripe.prices.create({currency:'eur',unit_amount:order.amounts[1],recurring:{interval:'month'},product_data:{name:order.title+' · Échéances restantes'}},{idempotencyKey:'km16-price-'+order.id});
  // Durée bornée dès la création : pas d’abonnement annuel à renouvellement infini.
  const schedule=await stripe.subscriptionSchedules.create({customer:oid(s.customer),start_date:date,end_behavior:'cancel',metadata,default_settings:{collection_method:'charge_automatically',default_payment_method:oid(pi.payment_method),automatic_tax:{enabled:false}},phases:[{items:[{price:price.id,quantity:1}],duration:{interval:'month',interval_count:order.count-1},metadata,proration_behavior:'none'}]},{idempotencyKey:'km16-schedule-'+order.id});
  await db('km16_membership_orders?id=eq.'+order.id,'PATCH',{schedule_id:schedule.id});
  const latest=await stripe.charges.retrieve(charge.id);
  if(latest.refunded||latest.amount_refunded>0||latest.disputed){
   await payment(order,pi.id,pi.amount,latest.disputed?'disputed':'refunded',latest.amount_refunded);
   await stop({...order,schedule_id:schedule.id});
  }
 }
}
async function invoiceChanged(id){
 const inv=await stripe.invoices.retrieve(id);
 const subId=oid(inv.parent?.subscription_details?.subscription)||oid(inv.subscription);
 if(!subId)return;
 const sub=await stripe.subscriptions.retrieve(subId);
 if(sub.metadata?.km16_source!=='km16-membership-v1')return;
 const order=(await db('km16_membership_orders?id=eq.'+encodeURIComponent(sub.metadata.km16_order)))[0];
 if(!order||inv.currency!=='eur'||inv.total!==order.amounts[1])throw Error('Facture inattendue');
 // Relire la facture courante : un ancien événement d’échec ne remplace pas un succès.
 let status=inv.status==='paid'&&inv.amount_paid>=inv.total?'paid':['void','uncollectible'].includes(inv.status)?'failed':inv.attempt_count>0?'failed':'pending';
 let refunded=0;
 const payments=await stripe.invoicePayments.list({invoice:inv.id,limit:100});
 if(payments.has_more)throw Error('Facture à réconcilier manuellement');
 for(const item of payments.data){const pId=oid(item.payment?.payment_intent);if(pId){const pi=await stripe.paymentIntents.retrieve(pId);if(pi.latest_charge){const ch=await stripe.charges.retrieve(oid(pi.latest_charge));refunded+=ch.amount_refunded;if(ch.disputed)status='disputed';}}}
 if(refunded>0&&status!=='disputed')status='refunded';
 await payment(order,inv.id,inv.total,status,refunded);
 if(['refunded','disputed'].includes(status))await stop(order);
}
async function chargeChanged(chargeId){
 const c=await stripe.charges.retrieve(chargeId),piId=oid(c.payment_intent);if(!piId)return;
 const order=(await db('km16_membership_orders?payment_intent_id=eq.'+piId))[0];
 if(order){await sessionPaid(order.stripe_session_id);return;}
 const pi=await stripe.paymentIntents.retrieve(piId);
 if(pi.metadata?.km16_source==='km16-family-v1'){
  const sessions=await stripe.checkout.sessions.list({payment_intent:piId,limit:2});
  if(sessions.data.length!==1||sessions.has_more)throw Error('Family checkout session unavailable');
  await sessionPaid(sessions.data[0].id);return;
 }
 // Factures des échéances : retrouver leur référence par l’API officielle InvoicePayments.
 const links=await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:piId},limit:100});
 if(links.has_more)throw Error('Trop de factures');
 for(const link of links.data)await invoiceChanged(oid(link.invoice));
}
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('POST uniquement',{status:405});
 const secret=Deno.env.get('KM16_ADHESIONS_WEBHOOK_SECRET');
 if(!secret)return new Response('Configuration absente',{status:503});
 let event;try{event=await stripe.webhooks.constructEventAsync(await req.text(),req.headers.get('stripe-signature')||'',secret,300,cryptoProvider);}catch{return new Response('Signature invalide',{status:400});}
 try{
  const obj=event.data.object;
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))await sessionPaid(obj.id);
  else if(event.type.startsWith('invoice.'))await invoiceChanged(obj.id);
  else if(event.type==='charge.refunded')await chargeChanged(obj.id);
  else if(event.type.startsWith('charge.dispute.'))await chargeChanged(oid(obj.charge));
  return new Response(JSON.stringify({received:true}),{headers:{'Content-Type':'application/json'}});
 }catch(e){console.error('KM16 adhésion webhook',event.id,e?.type||e?.name);return new Response('Traitement à réessayer',{status:500});}
});
