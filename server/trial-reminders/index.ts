import nodemailer from 'npm:nodemailer@7.0.11';
import webpush from 'npm:web-push@3.6.7';
const SITE='https://app.km16.fr',ADMIN='alexandre.marchat@gmail.com';
const headers={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const matches=async(a,b)=>!!a&&!!b&&b.length>=32&&(await digest(a))===(await digest(b));
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const email=s=>typeof s==='string'&&s.length<=254&&/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(s);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function trialMessage(day,stopUrl){return {
 subject:day===3?'KM16 – Et si vous poursuiviez après votre cours d’essai ?':'KM16 – Un dernier rappel après votre cours d’essai',
 text:['Bonjour,','',day===3?'Nous espérons que votre cours d’essai chez KM16 vous a plu !':'Nous espérons que votre cours d’essai vous a donné envie de poursuivre l’entraînement avec KM16.','',
 'Pour continuer à progresser avec nous, retrouvez les formules d’abonnement dans l’application :','https://app.km16.fr/adhesion.html','',
 'Une question sur les cours, les horaires ou votre inscription ? Répondez à cet e-mail : nous serons ravis de vous aider.',
 '',day===3?'Un dernier rappel est prévu sept jours après votre essai si vous n’avez pas pris d’abonnement.':'Ceci est notre dernier rappel automatique après votre essai.',
 '', 'À bientôt sur les tatamis !','','L’équipe KRAV MAGA 16','contact@km16.fr','', 'Ne plus recevoir ces rappels : '+stopUrl].join('\n')
};}
export function createHandler(env,fetcher=fetch,mail=nodemailer,push=webpush){return async req=>{
 const workerSecret=env('KM16_DOCUMENTS_WORKER_KEY'),worker=await matches(req.headers.get('x-km16-worker-key'),workerSecret);
 if(!worker&&req.headers.get('origin')!==SITE)return reply({error:'Origine refusée'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST uniquement'},405);
 const base=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY');
 async function db(path,method='GET',body){const r=await fetcher(base+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('database');return r.status===204?null:r.json();}
 async function signature(t){if(!workerSecret||workerSecret.length<32)throw Error('configuration');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(workerSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t.id+'|'+t.email)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
 try{
  const raw=await req.text();if(raw.length>5000)return reply({error:'Requête trop longue'},413);let data;try{data=JSON.parse(raw);}catch{return reply({error:'Requête invalide'},400);}
  if(data.action==='work'){
   if(!worker)return reply({error:'Accès refusé'},401);
   await db('rpc/km16_trial_tick','POST',{});let accepted=0,skipped=0,failed=0;
   for(let i=0;i<2;i++){
    const job=(await db('rpc/km16_claim_trial_reminder','POST',{}))[0];if(!job)break;let started=false,state='failed',error_code=null;
    try{
     const t=(await db('km16_trial_attendance?id=eq.'+job.trial_id))[0];
     if(!t||!await db('rpc/km16_trial_eligible','POST',{p_trial:job.trial_id})){state='skipped';error_code='no_longer_eligible';}
     else if(job.channel==='email'){
      if(!env('KM16_DOCUMENTS_SMTP_PASSWORD'))throw Error('smtp_configuration');
      const stopUrl=SITE+'/trial-stop.html#'+t.id+'.'+await signature(t),message=trialMessage(job.day,stopUrl);message.text=message.text.replace('Bonjour,\n\n','Bonjour,\n\nPratiquant : '+t.first_name+' '+t.last_name+'\n\n');
      const transport=mail.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:env('KM16_DOCUMENTS_SMTP_PASSWORD')},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,tls:{rejectUnauthorized:true}});
      try{if(!await db('rpc/km16_trial_eligible','POST',{p_trial:job.trial_id})){state='skipped';error_code='no_longer_eligible';}else{started=true;const result=await transport.sendMail({from:'KM16 <contact@km16.fr>',replyTo:'contact@km16.fr',to:t.email,subject:message.subject,text:message.text,messageId:'<km16-trial-'+job.id+'@km16.fr>',disableFileAccess:true,disableUrlAccess:true});state=result.accepted?.length?'accepted':'failed';}}finally{transport.close();}
     }else{
      const link=(await db('km16_trial_push_links?token_hash=eq.'+job.target+'&email=eq.'+encodeURIComponent(t.email)))[0],subscription=(await db('km16_push_subscriptions?token_hash=eq.'+job.target))[0];
      let bound=false;
      if(link&&await db('rpc/km16_trial_push_valid','POST',{p_token:job.target,p_email:t.email})){
       const ar=await fetcher(base+'/auth/v1/admin/users/'+link.user_id,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
       if(!ar.ok)throw Error('account_verification');const current=await ar.json();const u=current.user||current;bound=!!u.email_confirmed_at&&u.email?.toLowerCase()===t.email&&!u.is_anonymous;
      }
      if(!bound||!subscription){state='skipped';error_code='push_disabled';}
      else{
       const pub=env('KM16_VAPID_PUBLIC_KEY'),priv=env('KM16_VAPID_PRIVATE_KEY');if(!pub||!priv)throw Error('push_configuration');
       push.setVapidDetails('mailto:contact@km16.fr',pub,priv);
       if(!await db('rpc/km16_trial_eligible','POST',{p_trial:job.trial_id})){state='skipped';error_code='no_longer_eligible';}
       else{started=true;await push.sendNotification(subscription.subscription,JSON.stringify({title:job.day===3?'Poursuivez avec KM16':'Votre dernier rappel KM16',body:'Votre cours d’essai vous a plu ? Retrouvez les abonnements et contactez-nous si vous avez une question.',id:job.id,type:'trial'}),{TTL:3600,timeout:7000});state='accepted';}
      }
     }
    }catch(e){state=started?'uncertain':'failed';error_code=started?'check_delivery':'configuration';if(job.channel==='push'&&[404,410].includes(e.statusCode)){state='failed';error_code='push_expired';await db('km16_push_subscriptions?token_hash=eq.'+job.target,'DELETE');}}
    await db('km16_trial_reminders?id=eq.'+job.id+'&state=eq.sending','PATCH',{state,error_code,...(state==='accepted'?{sent_at:new Date().toISOString()}:{})});
    if(state==='accepted')accepted++;else if(state==='skipped')skipped++;else failed++;
   }
   return reply({accepted,skipped,failed});
  }
  if(data.action==='unsubscribe'){
   if(!uuid(data.id)||typeof data.signature!=='string'||!/^[a-f0-9]{64}$/.test(data.signature))return reply({error:'Lien invalide'},400);
   const t=(await db('km16_trial_attendance?id=eq.'+data.id))[0];if(!t||!await matches(data.signature,await signature(t)))return reply({error:'Lien invalide'},400);
   await fetcher(base+'/rest/v1/km16_trial_stops',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({email:t.email}),signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw Error('database');});
   return reply({ok:true});
  }
  if(data.action==='push-unlink'){
   if(typeof data.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.token))return reply({error:'Identifiant invalide'},400);
   await db('km16_trial_push_links?token_hash=eq.'+await digest(data.token),'DELETE');return reply({ok:true});
  }
  const authorization=req.headers.get('authorization')||'';if(!/^Bearer \S+$/.test(authorization))return reply({error:'Connexion requise'},401);
  const ar=await fetcher(base+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(10000)});if(!ar.ok)return reply({error:'Session expirée'},401);const user=await ar.json();
  if(!user.email_confirmed_at||user.is_anonymous||!email(user.email))return reply({error:'Compte confirmé requis'},403);
  if(['push-status','push-link'].includes(data.action)){
   if(typeof data.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.token))return reply({error:'Activez les notifications sur cet appareil'},400);const token_hash=await digest(data.token);
   if(data.action==='push-status'){const row=(await db('km16_trial_push_links?token_hash=eq.'+token_hash))[0];if(row&&row.user_id!==user.id){await db('km16_trial_push_links?token_hash=eq.'+token_hash,'DELETE');return reply({enabled:false});}return reply({enabled:!!row});}
   if(!(await db('km16_push_subscriptions?token_hash=eq.'+token_hash))[0])return reply({error:'Activez d’abord les notifications sur cet appareil'},400);
   const r=await fetcher(base+'/rest/v1/km16_trial_push_links',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({token_hash,user_id:user.id,email:user.email.toLowerCase(),enabled_at:new Date().toISOString()})});if(!r.ok)throw Error('database');return reply({enabled:true});
  }
  if(user.email.toLowerCase()!==ADMIN)return reply({error:'Accès réservé au président'},403);
  if(data.action==='list'){
   if(!/^20\d{2}\/20\d{2}$/.test(data.season||''))return reply({error:'Saison invalide'},400);
   const trials=await db('km16_trial_attendance?season=eq.'+encodeURIComponent(data.season)+'&order=attended_on.desc&limit=1000');
   const orders=await db('km16_membership_orders?livemode=eq.true&product_id=in.(essai,essai-saint-jean)&season_id=eq.'+encodeURIComponent(data.season)+'&select=id,first_name,last_name,birth_date,email,approval&order=created_at.desc&limit=500');
   const jobs=trials.length?await db('km16_trial_reminders?trial_id=in.('+trials.map(t=>t.id).join(',')+')&select=trial_id,day,channel,state,sent_at,error_code&limit=5000'):[];
   const config=(await db('km16_trial_reminder_config?id=eq.1'))[0];
   const states=trials.length?await db('rpc/km16_trial_states','POST',{p_ids:trials.map(t=>t.id)}):[];
   return reply({trials:trials.map(t=>({...t,...states.find(s=>s.id===t.id)})),orders,jobs,enabled:config.enabled});
  }
  if(data.action==='record'){
   let value=data;if(data.order_id){if(!uuid(data.order_id))return reply({error:'Essai invalide'},400);const order=(await db('km16_membership_orders?id=eq.'+data.order_id))[0];if(!order?.livemode||!['essai','essai-saint-jean'].includes(order.product_id)||order.approval==='rejected')return reply({error:'Essai indisponible'},400);value={...order,season:order.season_id,attended_on:data.attended_on};}
   const normalize=s=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/g,' '):'';
   const first_name=normalize(value.first_name),last_name=normalize(value.last_name),recipient=normalize(value.email).toLowerCase();
   if(!first_name||first_name.length>80||!last_name||last_name.length>80||!email(recipient)||!date(value.birth_date)||!date(value.attended_on)||value.attended_on>today()||value.birth_date>=value.attended_on||!/^20\d{2}\/20\d{2}$/.test(value.season||''))return reply({error:'Vérifiez l’identité, l’e-mail et la date du cours effectué'},400);
   const from=Number(value.season.slice(0,4)),to=Number(value.season.slice(5));if(to!==from+1||value.attended_on<from+'-09-01'||value.attended_on>=to+'-09-01')return reply({error:'La date du cours ne correspond pas à la saison'},400);
   const row={order_id:data.order_id||null,first_name,last_name,birth_date:value.birth_date,email:recipient,season:value.season,attended_on:value.attended_on,created_by:user.id};
   const result=await fetcher(base+'/rest/v1/km16_trial_attendance',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(row)});
   if(result.status===409)return reply({error:'Cet essai est déjà enregistré pour cette personne et cette saison'},409);if(!result.ok)throw Error('database');return reply({ok:true});
  }
  if(data.action==='stop'){
   if(!uuid(data.id)||typeof data.stopped!=='boolean')return reply({error:'Valeur invalide'},400);await db('km16_trial_attendance?id=eq.'+data.id,'PATCH',{stopped:data.stopped});return reply({ok:true});
  }
  if(data.action==='configure'){
   if(typeof data.enabled!=='boolean')return reply({error:'Valeur invalide'},400);await db('km16_trial_reminder_config?id=eq.1','PATCH',{enabled:data.enabled});return reply({ok:true});
  }
  return reply({error:'Action invalide'},400);
 }catch{return reply({error:'Opération interrompue. Actualisez le suivi avant de recommencer.'},500);}
};}
Deno.serve(createHandler(k=>Deno.env.get(k)));
