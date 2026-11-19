import {Buffer} from "node:buffer";
import nodemailer from 'npm:nodemailer@7.0.11';

const site='https://app.km16.fr';
const admin='alexandre.marchat@gmail.com';
const sender='contact@km16.fr';
const headers={
 'Access-Control-Allow-Origin':site,
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
 'Access-Control-Allow-Methods':'POST,OPTIONS',
 'Cache-Control':'no-store',
};
const reply=(data,status=200)=>Response.json(data,{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createHandler(env,fetcher=fetch,mailer=nodemailer){
 return async req=>{
  if(req.headers.get('origin')!==site)return reply({error:'Origine refusée'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'Méthode refusée'},405);
  const authorization=req.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))return reply({error:'Connexion requise'},401);
  const base=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY');
  let sending=false;
  try{
   const auth=await fetcher(base+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(10000)});
   if(!auth.ok)return reply({error:'Session expirée'},401);
   const user=await auth.json();
   if(user.email?.toLowerCase()!==admin||!user.email_confirmed_at||user.is_anonymous)return reply({error:'Accès administrateur requis'},403);
   const data=await req.json().catch(()=>null);
   if(!data||typeof data.test!=='boolean')return reply({error:'Requête invalide'},400);
   const query=new URLSearchParams({livemode:'eq.'+!data.test,pdf_base64:'not.is.null'});
   async function bills(){
    const response=await fetcher(base+'/rest/v1/km16_bills?'+query,{
     headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)throw Error('database');
    return response.json();
   }
   if(data.action==='list'){
    const ids=data.order_ids;
    if(!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>typeof id!=='string'||!uuid.test(id)))return reply({error:'Dossiers invalides'},400);
    query.set('snapshot->>order_id','in.('+ids.join(',')+')');
    query.set('select','number,issued_at,recipient:snapshot->>email');
    query.set('order','issued_at.desc,number.desc');
    const rows=await bills();
    return reply({invoices:rows.map(row=>({...row,recipient:data.test?admin:row.recipient}))});
   }
   if(data.action!=='resend'||typeof data.number!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(data.number))return reply({error:'Facture invalide'},400);
   query.set('number','eq.'+data.number);
   query.set('select','number,pdf_base64,recipient:snapshot->>email');
   const [bill]=await bills();
   if(!bill?.pdf_base64)return reply({error:'PDF de la facture indisponible'},404);
   const to=data.test?admin:bill.recipient;
   if(to!==data.recipient||typeof to!=='string'||to.length>254||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(to))return reply({error:'Adresse de facturation à vérifier. Recharge la liste des factures.'},409);
   const pass=env('KM16_DOCUMENTS_SMTP_PASSWORD');
   if(!pass)return reply({error:'Service de messagerie indisponible'},503);
   const pdf=Uint8Array.from(atob(bill.pdf_base64),character=>character.charCodeAt(0));
   const transport=mailer.createTransport({
    host:'smtp.mail.ovh.net',port:465,secure:true,auth:{user:sender,pass},
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{rejectUnauthorized:true},
   });
   try{
    sending=true;
    const sent=await transport.sendMail({
     from:'KM16 <'+sender+'>',replyTo:sender,to,
     subject:(data.test?'[TEST] ':'')+'KM16 - Duplicata de votre facture '+bill.number,
     text:'Bonjour,\n\nComme demandé, voici votre facture KM16 en pièce jointe.\n\nBien cordialement,\nAlexandre Marchat\nPrésident de KM16',
     attachments:[{filename:bill.number+'.pdf',content:Buffer.from(pdf),contentType:'application/pdf'}],
     disableFileAccess:true,disableUrlAccess:true,
    });
    if(!sent.accepted?.length)return reply({error:'La messagerie a refusé l’envoi'},502);
    return reply({sent:true});
   }finally{transport.close();}
  }catch{
   return reply({error:sending?'Envoi non confirmé. Vérifie la réception avant de réessayer.':'Impossible de consulter ou de renvoyer la facture.'},502);
  }
 };
}

Deno.serve(createHandler(name=>Deno.env.get(name)));
