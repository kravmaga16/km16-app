import nodemailer from 'npm:nodemailer@7.0.11';
const SITE='https://app.km16.fr',ADMIN='alexandre.marchat@gmail.com';
const headers={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const validEmail=s=>typeof s==='string'&&s.length<=254&&/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(s);
export function recipients(clients,group){
 const rows=clients.filter(c=>!group||c.group===group),emails=[...new Set(rows.map(c=>String(c.email||'').trim().toLowerCase()).filter(validEmail))].sort();
 return {emails,people:rows.length,missing:rows.filter(c=>!validEmail(String(c.email||'').trim())).length};
}
export function createHandler(env,fetcher=fetch,mailer=nodemailer){return async req=>{
 if(req.headers.get('origin')!==SITE)return reply({error:'Origine refusée'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Méthode refusée'},405);
 const base=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY'),authorization=req.headers.get('authorization')||'';
 try{
  if(!/^Bearer \S+$/.test(authorization))return reply({error:'Connexion requise'},401);
  const auth=await fetcher(base+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return reply({error:'Session expirée'},401);const user=await auth.json();
  if(user.email?.toLowerCase()!==ADMIN||!user.email_confirmed_at||user.is_anonymous)return reply({error:'Accès réservé au président'},403);
  const raw=await req.text();if(raw.length>15000)return reply({error:'Message trop long'},400);
  let data;try{data=JSON.parse(raw);}catch{return reply({error:'Requête invalide'},400);}
  const configured=!!env('KM16_DOCUMENTS_SMTP_PASSWORD');
  async function db(path,method='GET',body){
   const r=await fetcher(base+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('database');return r.status===204?null:r.json();
  }
  if(data.action==='status'){
   const rows=await db('km16_mail_campaigns?select=id,created_at,season,audience,subject,recipient_count,approved_at&created_by=eq.'+user.id+'&order=created_at.desc&limit=10');
   return reply({email_ready:configured,campaigns:rows});
  }
  if(data.action==='prepare'){
   if(!configured)return reply({error:'La messagerie OVH reste à configurer'},503);
   if(!['','Ados','Adultes','Enfants'].includes(data.group)||!/^20\d{2}\/20\d{2}$/.test(data.season||''))return reply({error:'Groupe ou saison invalide'},400);
   const subject=String(data.subject||'').trim(),body=String(data.body||'').trim();
   if(!subject||subject.length>160||/[\r\n]/.test(subject)||!body||body.length>10000)return reply({error:'Indiquez un objet et un message valides'},400);
   const r=await fetcher(base+'/functions/v1/km16-clients',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json',Origin:SITE},body:JSON.stringify({action:'clients',season:data.season,test:false}),signal:AbortSignal.timeout(60000)});
   if(!r.ok)throw Error('clients');const clients=await r.json();
   if(clients.test!==false||clients.season!==data.season||!Array.isArray(clients.clients))throw Error('clients');
   const selection=recipients(clients.clients,data.group);
   if(!selection.emails.length)return reply({error:'Aucune adresse e-mail valide dans ce groupe'},400);
   if(selection.emails.length>1000)return reply({error:'Sélection limitée à 1 000 adresses'},400);
   const id=crypto.randomUUID();
   await db('rpc/km16_prepare_mail','POST',{p_id:id,p_user:user.id,p_season:data.season,p_audience:data.group,p_subject:subject,p_body:body,p_emails:selection.emails});
   return reply({id,count:selection.emails.length,people:selection.people,missing:selection.missing,subject,body,group:data.group,season:data.season});
  }
  if(!['progress','send'].includes(data.action)||! /^[0-9a-f-]{36}$/.test(data.id||''))return reply({error:'Action invalide'},400);
  const campaign=(await db('km16_mail_campaigns?id=eq.'+data.id+'&created_by=eq.'+user.id))[0];
  if(!campaign)return reply({error:'Envoi introuvable'},404);
  if(data.action==='send'){
   if(!configured)return reply({error:'Messagerie OVH indisponible'},503);
   if(!campaign.approved_at&&data.confirm!==true)return reply({error:'Validez l’aperçu avant l’envoi'},400);
   if(Date.parse(campaign.created_at)<Date.now()-86400000)return reply({error:'Cet envoi a expiré. Préparez un nouvel aperçu.'},400);
   if(!campaign.approved_at)await db('km16_mail_campaigns?id=eq.'+campaign.id,'PATCH',{approved_at:new Date().toISOString()});
   const claimed=await db('rpc/km16_claim_mail','POST',{p_id:campaign.id});const delivery=claimed[0];
   if(delivery){
    const transport=mailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:env('KM16_DOCUMENTS_SMTP_PASSWORD')},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,tls:{rejectUnauthorized:true}});
    let state='uncertain',error_code=null;
    try{
     const result=await transport.sendMail({from:{name:'KM16',address:'contact@km16.fr'},replyTo:'contact@km16.fr',to:delivery.email,subject:campaign.subject,text:campaign.body+'\n\n—\nKM16 · contact@km16.fr',messageId:'<km16-group-'+delivery.id+'@km16.fr>',disableFileAccess:true,disableUrlAccess:true});
     state=result.accepted?.length?'accepted':'failed';if(state==='failed')error_code='rejected';
    }catch(e){
     const code=Number(e.responseCode);if(code>=400&&code<=599||['EAUTH','ECONNECTION','EDNS'].includes(e.code)){state='failed';error_code=code===421||code===450||code===451||code===452?'ovh_limit':'smtp_rejected';}else error_code='check_delivery';
    }finally{transport.close();}
    await db('km16_mail_deliveries?id=eq.'+delivery.id+'&state=eq.sending','PATCH',{state,error_code});
   }
  }
  const deliveries=await db('km16_mail_deliveries?campaign_id=eq.'+campaign.id+'&select=state,error_code&limit=1000');
  const counts=Object.fromEntries(['pending','sending','accepted','failed','uncertain'].map(state=>[state,deliveries.filter(d=>d.state===state).length]));
  return reply({id:campaign.id,subject:campaign.subject,body:campaign.body,group:campaign.audience,season:campaign.season,...counts,total:campaign.recipient_count,errors:deliveries.some(d=>d.error_code==='ovh_limit')?'Limite OVH atteinte. Interrompez l’envoi et vérifiez votre messagerie.':null});
 }catch{return reply({error:'Opération interrompue. Consultez l’historique avant de reprendre pour éviter un double envoi.'},500);}
};}
Deno.serve(createHandler(k=>Deno.env.get(k)));
