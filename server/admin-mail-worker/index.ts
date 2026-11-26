import nodemailer from 'npm:nodemailer@7.0.11';
const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
async function db(path:string,method='GET',body?:unknown){const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('database '+r.status);const t=await r.text();return t?JSON.parse(t):null;}
const same=async(a:string,b:string)=>{const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const x=await digest(a),y=await digest(b);let diff=x.length^y.length;for(let i=0;i<Math.min(x.length,y.length);i++)diff|=x[i]^y[i];return diff===0;};
async function sendDonationThanks(password:string){
 const jobs=await db('rpc/km16_claim_donation_thank_you','POST',{});
 const job=jobs?.[0];
 if(!job)return null;
 let transport;
 let state='uncertain';
 try{
  transport=nodemailer.createTransport({
   host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:password},
   connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,
   tls:{rejectUnauthorized:true},disableFileAccess:true,disableUrlAccess:true,
  });
  const amount=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(job.amount_cents/100);
  const date=new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(new Date(job.paid_at));
  const result=await transport.sendMail({
   from:'KM16 <contact@km16.fr>',replyTo:'contact@km16.fr',to:job.email,
   subject:'Merci pour votre don à KM16 !',
   text:[
    'Bonjour,',
    'Toute l’équipe de Krav Maga 16 vous remercie pour votre don de '+amount+', reçu le '+date+'.',
    'Votre soutien contribue à la vie du club et nous aide à faire grandir la pratique du krav maga au sein de l’association.',
    'Merci de faire partie de l’aventure KM16.',
    'Sportivement,\nL’équipe Krav Maga 16',
   ].join('\n\n'),
   messageId:'<km16-donation-'+job.payment_intent_id+'@km16.fr>',
  });
  state=result.accepted?.some(email=>String(email).toLowerCase()===job.email.toLowerCase())?'accepted':'failed';
 }catch(error){
  const smtp=error as {responseCode?:number,code?:string};
  if((smtp.responseCode>=400&&smtp.responseCode<=599)||['EAUTH','ECONNECTION','EDNS'].includes(smtp.code))state='failed';
 }finally{transport?.close();}
 await db('km16_donation_thank_you?payment_intent_id=eq.'+encodeURIComponent(job.payment_intent_id)+'&state=eq.sending','PATCH',{
  state,...(state==='accepted'?{sent_at:new Date().toISOString()}:{}),
 });
 return state;
}
Deno.serve(async req=>{if(req.method!=='POST')return new Response('Method not allowed',{status:405});try{
 const token=req.headers.get('x-km16-automation')||'';if(token.length<64)return new Response('Forbidden',{status:403});
 const settings=(await db('km16_automation_settings?select=token,enabled&id=eq.1'))?.[0];
 if(!settings?.enabled||!await same(token,settings.token))return new Response('Forbidden',{status:403});
 const password=Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD');if(!password)return new Response('SMTP not configured',{status:503});
 // Keep a donation queue failure isolated from the other mail queues.
 const donation=await sendDonationThanks(password).catch(()=>{console.error('KM16 donation mail unavailable');return 'error';});
 let accepted=0,failed=0,uncertain=0;
 for(let i=0;i<8;i++){const claimed=await db('rpc/km16_claim_purchase_notification','POST',{});const job=claimed?.[0];if(!job)break;
  let transport:any;let state='uncertain',error_code=null;
  try{transport=nodemailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,tls:{rejectUnauthorized:true}});
   const euro=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(job.amount_cents/100);
   const body=['Nouvel achat KM16 confirmé','', 'Nom : '+job.buyer_name,'Type : '+job.kind,'Achat : '+job.product_name,'Montant payé : '+euro,'Date : '+new Date(job.paid_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}),'Référence : '+job.event_key,'','Notification administrative automatique KM16.'].join('\n');
   const result=await transport.sendMail({from:'KM16 <contact@km16.fr>',to:'contact@km16.fr',replyTo:'contact@km16.fr',subject:job.kind==='test'?'[TEST KM16] Vérification notifications d’achat':'[KM16] Nouvel achat confirmé · '+job.kind,text:body,messageId:'<km16-purchase-'+job.id+'@km16.fr>',disableFileAccess:true,disableUrlAccess:true});
   state=result.accepted?.length?'accepted':'failed';if(state==='failed')error_code='smtp_rejected';
  }catch(e){const status=Number((e as any)?.responseCode);if(status>=400&&status<=599||['EAUTH','ECONNECTION','EDNS'].includes((e as any)?.code)){state='failed';error_code='smtp_error';}else{state='uncertain';error_code='check_delivery';}}
  finally{transport?.close();}
  await db('km16_admin_purchase_notifications?id=eq.'+job.id+'&state=eq.sending','PATCH',{state,error_code,...(state==='accepted'?{sent_at:new Date().toISOString()}:{})});
  if(state==='accepted')accepted++;else if(state==='failed')failed++;else uncertain++;
 }
 let campaignAccepted=0,campaignFailed=0,campaignUncertain=0;
 for(let i=0;i<8;i++){
  const claimed=await db('rpc/km16_claim_scheduled_mail','POST',{});const job=claimed?.[0];if(!job)break;
  let transport:any;let state='uncertain',error_code=null;
  try{transport=nodemailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,tls:{rejectUnauthorized:true}});
   const result=await transport.sendMail({from:'KM16 <contact@km16.fr>',replyTo:'contact@km16.fr',to:job.email,subject:job.subject,text:job.body+'\\n\\n—\\nKM16 · contact@km16.fr',messageId:'<km16-scheduled-'+job.id+'@km16.fr>',disableFileAccess:true,disableUrlAccess:true});
   state=result.accepted?.length?'accepted':'failed';if(state==='failed')error_code='smtp_rejected';
  }catch(e){const code=Number((e as any)?.responseCode);if(code>=400&&code<=599||['EAUTH','ECONNECTION','EDNS'].includes((e as any)?.code)){state='failed';error_code='smtp_error';}else{state='uncertain';error_code='check_delivery';}}
  finally{transport?.close();}
  await db('km16_scheduled_mail_deliveries?id=eq.'+job.id+'&state=eq.sending','PATCH',{state,error_code,...(state==='accepted'?{sent_at:new Date().toISOString()}:{})});
  if(state==='accepted')campaignAccepted++;else if(state==='failed')campaignFailed++;else campaignUncertain++;
 }
 let courseAccepted=0;
 for(let i=0;i<4;i++){
  const claimed=await db('rpc/km16_claim_course_change_mail','POST',{});const job=claimed?.[0];if(!job)break;
  let transport:any;let state='uncertain';
  try{
   transport=nodemailer.createTransport({host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:'contact@km16.fr',pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,tls:{rejectUnauthorized:true}});
   const result=await transport.sendMail({from:'KM16 <contact@km16.fr>',to:job.email,replyTo:'contact@km16.fr',subject:job.subject,text:job.body,messageId:'<km16-course-change-'+job.id+'@km16.fr>',disableFileAccess:true,disableUrlAccess:true});
   state=result.accepted?.length?'accepted':'failed';
  }catch(e){const code=Number((e as any)?.responseCode);if(code>=400&&code<=599||['EAUTH','ECONNECTION','EDNS'].includes((e as any)?.code))state='failed';}
  finally{transport?.close();}
  await db('km16_course_change_mail?id=eq.'+job.id+'&state=eq.sending','PATCH',{state,...(state==='accepted'?{sent_at:new Date().toISOString()}:{})});
  if(state==='accepted')courseAccepted++;
 }
 return new Response(JSON.stringify({ok:true,donation,accepted,failed,uncertain,campaignAccepted,campaignFailed,campaignUncertain,courseAccepted}),{headers:{'Content-Type':'application/json'}});
}catch(e){console.error('KM16 mail worker',e instanceof Error?e.message:'unknown');return new Response(JSON.stringify({error:'Worker unavailable'}),{status:500,headers:{'Content-Type':'application/json'}});}});
