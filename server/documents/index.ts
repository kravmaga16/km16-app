// Nouvelle fonction indépendante. Verify JWT OFF ; secret dédié obligatoire.
import nodemailer from 'npm:nodemailer@7';
// Uniquement métadonnées : aucun questionnaire ni fichier médical stocké ici.
function missingDocuments(d) {
 const a=[];
 if(d.health_status==='missing')a.push(d.health_kind==='attestation'?'une attestation de santé signée par le représentant légal':'un certificat médical d’absence de contre-indication à la pratique du Krav Maga');
 if(d.school_required&&d.school_status==='missing')a.push('un certificat de scolarité ou une carte scolaire de Saint-Jean-de-Passy pour l’année en cours, au nom du pratiquant');
 return a;
}
function mailAllowed(order, payments, documents) {
 return !!documents&&order.approval!=='rejected'&&payments.some(p=>p.reference===order.payment_intent_id&&p.status==='paid'&&p.refunded_cents===0)
 &&!payments.some(p=>p.refunded_cents>0||['refunded','disputed'].includes(p.status));
}
function documentMail(order,d,kind,test=false) {
 const missing=missingDocuments(d);
 if(!missing.length)return null;
 const participant=[order.first_name,order.last_name].join(' ').replace(/[\r\n]/g,' ');
 const subject=(test?'[TEST KM16] ':'')+(kind==='reminder'?'KM16 · Rappel des pièces manquantes':'KM16 · Documents pour votre adhésion');
 const text=['Bonjour,','',kind==='reminder'?'Sauf réception récente, les pièces suivantes restent à fournir pour le dossier de '+participant+' :':'Le premier paiement de votre adhésion a été enregistré pour '+participant+'. Pour compléter le dossier, merci de fournir :','',...missing.map(x=>'• '+x),
 '', 'Vous pouvez présenter ces documents au président de KM16 lors d’un cours. Ils ne bloquent pas le paiement de votre adhésion. Le paiement ne vaut pas autorisation de pratiquer avant vérification des conditions de santé et de licence.',
 d.health_kind==='attestation'&&d.health_status==='missing'?'Pour les moins de 15 ans : l’attestation est signée après avoir répondu négativement à toutes les questions du questionnaire santé. Si une réponse est positive, consultez un médecin et présentez le certificat nécessaire à la place. Ne transmettez jamais le questionnaire détaillé à KM16.':'',
 d.health_kind==='attestation'&&d.health_status==='missing'?'Modèle d’attestation FEKM : https://www.krav-maga.net/wp-content/uploads/sites/2/2024/09/ATTESTATION-POUR-MINEUR.pdf':'',
 '', 'Ne répondez pas avec un diagnostic ou des informations médicales détaillées. Si vous avez déjà remis les pièces, laissez le temps au club de les enregistrer.',
 '', 'Suivre votre dossier : https://app.km16.fr/adhesion.html?espace=1&order='+encodeURIComponent(order.id),
 'Licence FEKM à souscrire séparément : https://www.krav-maga.net/connexion/',
 '', 'Une seule relance automatique est prévue sept jours après le premier paiement si des pièces sont encore manquantes.',
 '', 'Alexandre Marchat', 'Président de KM16', 'contact@km16.fr'].filter(x=>x!==null).join('\n');
 return {subject,text};
}

const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function db(path,method='GET',body=undefined){
 const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error('database');const t=await r.text();return t?JSON.parse(t):null;
}
async function secretMatches(got,want){
 if(!got||!want||want.length<32)return false;
 const h=async x=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)));
 const a=await h(got),b=await h(want);let n=0;for(let i=0;i<a.length;i++)n|=a[i]^b[i];return n===0;
}
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({error:'POST uniquement'},{status:405});
 if(!await secretMatches(req.headers.get('x-km16-worker-key'),Deno.env.get('KM16_DOCUMENTS_WORKER_KEY')))return Response.json({error:'Accès refusé'},{status:401});
 const mode=Deno.env.get('KM16_DOCUMENTS_MODE')||'off';
 if(!['test','live'].includes(mode))return Response.json({paused:true});
 try{
  if(!base||!key||!Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD'))return Response.json({error:'Configuration absente'},{status:503});
  const config=(await db('km16_membership_config?id=eq.1'))[0];
  if(mode==='live'&&!config.documents_emails_enabled)return Response.json({paused:true});
  const transport=nodemailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD')},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,tls:{rejectUnauthorized:true}});
  let sent=0,skipped=0,failed=0;
  // Deux messages au plus par invocation : limite l’exposition au délai Edge.
  for(let i=0;i<2;i++){
   const jobs=await db('rpc/km16_claim_document_mail','POST',{p_live:mode==='live'});
   if(!jobs?.length)break;const job=jobs[0];
   let smtpStarted=false;
   try{
    const order=(await db('km16_membership_orders?id=eq.'+job.order_id))[0];
    const docs=(await db('km16_membership_documents?order_id=eq.'+job.order_id))[0];
    const payments=await db('km16_membership_payments?order_id=eq.'+job.order_id);
    const mail=order&&mailAllowed(order,payments,docs)?documentMail(order,docs,job.kind,mode==='test'):null;
    // Relecture au moment de l’envoi : une réception, annulation ou un remboursement stoppe la relance.
    if(!mail){await db('km16_document_mail_queue?id=eq.'+job.id,'PATCH',{status:'skipped',error_code:'no_document_due'});skipped++;continue;}
    const current=(await db('km16_membership_config?id=eq.1'))[0];
    if(mode==='live'&&!current.documents_emails_enabled){await db('km16_document_mail_queue?id=eq.'+job.id,'PATCH',{status:'pending',locked_at:null});break;}
    const to=mode==='test'?'alexandre.marchat@gmail.com':order.email;
    if(!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(to))throw Error('recipient');
    smtpStarted=true;
    const result=await transport.sendMail({from:'KM16 <contact@km16.fr>',replyTo:'contact@km16.fr',to,subject:mail.subject,text:mail.text,messageId:'<km16-doc-'+job.id+'@km16.fr>',disableFileAccess:true,disableUrlAccess:true});
    if(!result.accepted?.length)throw Error('not_accepted');
    await db('km16_document_mail_queue?id=eq.'+job.id,'PATCH',{status:'sent',sent_at:new Date().toISOString(),recipient:to,error_code:null});sent++;
   }catch{
    // SMTP peut avoir accepté l’e-mail avant une coupure : on ne réessaie jamais à l’aveugle.
    await db('km16_document_mail_queue?id=eq.'+job.id,'PATCH',{status:smtpStarted?'uncertain':'failed',error_code:smtpStarted?'check_delivery':'check_configuration'});failed++;
   }
  }
  transport.close();return Response.json({sent,skipped,failed,test:mode==='test'});
 }catch{return Response.json({error:'Traitement à vérifier dans le suivi des e-mails'},{status:500});}
});
