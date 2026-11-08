// Supabase Edge Function : km16-notifications. JWT verification OFF.
// Les opérations administrateur vérifient la session côté serveur.
import {createClient} from 'npm:@supabase/supabase-js@2.49.8';
import webpush from 'npm:web-push@3.6.7';
const SITE='https://app.km16.fr';
const cors={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:cors});
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const check=(r:any)=>{if(r.error)throw Object.assign(Error('Base de données indisponible'),{code:r.error.code||'database'});return r.data;};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
function validSubscription(s:any){
 try{const u=new URL(s.endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
 ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname)&&
 s.endpoint.length<2048&&/^[A-Za-z0-9_-]{87}$/.test(s.keys.p256dh)&&/^[A-Za-z0-9_-]{22}$/.test(s.keys.auth);}
 catch{return false;}
}
Deno.serve(async req=>{
 let phase='lecture';
 const schedulerToken=Deno.env.get('KM16_SCHEDULER_TOKEN');
 const supplied=req.headers.get('x-km16-scheduler');
 const scheduler=!!schedulerToken&&schedulerToken.length>=32&&!!supplied&&(await hash(supplied))===(await hash(schedulerToken));
 if(!scheduler&&req.headers.get('origin')!==SITE)return reply({error:'Origine refusée'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Méthode refusée'},405);
 try{
  const raw=await req.text();if(raw.length>8000)return reply({error:'Requête trop longue'},413);
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'JSON invalide'},400);}
  const publicKey=Deno.env.get('KM16_VAPID_PUBLIC_KEY'),privateKey=Deno.env.get('KM16_VAPID_PRIVATE_KEY');
  async function sendBatch(id:string){
   if(!publicKey||!privateKey)throw Error('Configuration Web Push manquante');
  phase='lecture-actualite';
  const news=check(await db.from('km16_news').select('id,title,body,published_at,category,expires_on,expires_at').eq('id',id).single());
  if(!news?.published_at||new Date(news.published_at)>new Date())throw Error('Actualité non publiée');
  if(news.expires_at&&Date.parse(news.expires_at)<=Date.now())throw Error('Actualité expirée');
  phase='preparation-file';
  check(await db.rpc('km16_push_prepare',{p_news:id}));

  // Envoi au plus une fois par destinataire et actualité. Un envoi interrompu n'est
  // jamais réessayé automatiquement : mieux vaut le signaler que créer des doublons.
  phase='verification-cles';
  webpush.setVapidDetails('mailto:contact@km16.fr',publicKey,privateKey);
  phase='reservation-lot';
  const batch=check(await db.rpc('km16_push_claim',{p_news:id}));
  phase='envoi-lot';
  for(let i=0;i<batch.length;i+=5){
   await Promise.all(batch.slice(i,i+5).map(async(d:any)=>{
    let status='accepted';
    const current=check(await db.from('km16_push_subscriptions').select('categories,subscription').eq('token_hash',d.token_hash).maybeSingle());
    if(!current?.categories.includes(news.category)||current.subscription.endpoint!==d.subscription.endpoint){
     check(await db.from('km16_push_deliveries').delete().eq('news_id',id).eq('token_hash',d.token_hash));return;
    }
    try{await webpush.sendNotification(d.subscription,JSON.stringify({title:news.title,body:news.body.slice(0,180),id:news.id}),{TTL:86400,timeout:7000});}
    catch(e){status='failed';if([404,410].includes((e as any).statusCode))check(await db.from('km16_push_subscriptions').delete().eq('token_hash',d.token_hash).eq('subscription->>endpoint',d.subscription.endpoint));}
    check(await db.from('km16_push_deliveries').update({status}).eq('news_id',id).eq('token_hash',d.token_hash));
   }));
  }
  phase='comptage-resultats';
  const result:any={accepted:0,pending:0,failed:0,sending:0};
  for(const status of Object.keys(result)){const q=await db.from('km16_push_deliveries').select('*',{count:'exact',head:true}).eq('news_id',id).eq('status',status);check(q);result[status]=q.count||0;}
  return result;
  }
  if(input.action==='scheduled-tick'){
   if(!scheduler)return reply({error:'Accès refusé'},403);
   phase='publication-programmee';
   check(await db.rpc('km16_schedule_due'));
   const pending=check(await db.rpc('km16_schedule_pending'));
   const results=[];
   for(const row of pending){
    const news=check(await db.from('km16_news').select('expires_on,published_at,expires_at').eq('id',row.id).single());
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(!news.published_at||(news.expires_at&&Date.parse(news.expires_at)<=Date.now())){
     check(await db.from('km16_push_deliveries').update({status:'failed'}).eq('news_id',row.id).eq('status','pending'));
    }else results.push(await sendBatch(row.id));
   }
   return reply({ok:true,batches:results.length});
  }
  if(input.action==='config')return publicKey&&privateKey?reply({publicKey}):reply({error:'Notifications en cours de configuration'},503);
  if(['subscribe','unsubscribe','preferences'].includes(input.action)){
   if(typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))return reply({error:'Identifiant invalide'},400);
   const token_hash=await hash(input.token);
   if(input.action==='preferences'){
    if(input.categories===undefined){
      const row=check(await db.from('km16_push_subscriptions').select('categories').eq('token_hash',token_hash).maybeSingle());
      return reply({categories:row?.categories??null});
    }
    if(!Array.isArray(input.categories)||input.categories.length>2||input.categories.some((x:unknown)=>x!=='cours'&&x!=='stages'))return reply({error:'Préférences invalides'},400);
    const row=check(await db.from('km16_push_subscriptions').update({categories:[...new Set(input.categories)]}).eq('token_hash',token_hash).select('categories').single());
    return reply(row);
   }
   if(input.action==='unsubscribe'){check(await db.from('km16_push_subscriptions').delete().eq('token_hash',token_hash));return reply({ok:true});}
   if(!publicKey||!privateKey)return reply({error:'Notifications non configurées'},503);
   if(!validSubscription(input.subscription))return reply({error:'Abonnement non compatible'},400);
   const subscription={endpoint:input.subscription.endpoint,keys:{p256dh:input.subscription.keys.p256dh,auth:input.subscription.keys.auth}};
   check(await db.from('km16_push_subscriptions').upsert({token_hash,subscription},{onConflict:'token_hash'}));
   return reply({ok:true});
  }
  const bearer=req.headers.get('authorization')||'';
  if(!bearer.startsWith('Bearer '))return reply({error:'Connexion requise'},401);
  const {data:{user},error}=await db.auth.getUser(bearer.slice(7));
  if(error||!user)return reply({error:'Session expirée'},401);
  if(!user.email_confirmed_at||user.is_anonymous||user.email?.toLowerCase()!=='alexandre.marchat@gmail.com')return reply({error:'Accès réservé au président'},403);
  if(input.action==='schedule-ready')return reply({ready:!!schedulerToken&&check(await db.rpc('km16_scheduler_ready',{p_secret:schedulerToken}))});
  if(input.action==='history'){
   phase='historique-envois';
   return reply({history:check(await db.rpc('km16_push_history'))});
  }
  if(input.action==='stats'){
   phase='comptage-abonnements';
   const counts=await Promise.all([null,'cours','stages'].map(async category=>{
    let query=db.from('km16_push_subscriptions').select('token_hash',{count:'exact',head:true});
    if(category)query=query.contains('categories',[category]);
    const result=await query;check(result);return result.count??0;
   }));
   return reply({total:counts[0],cours:counts[1],stages:counts[2]});
  }
  if(input.action!=='send'||!/^[0-9a-f-]{36}$/.test(input.id||''))return reply({error:'Action invalide'},400);
  if(!publicKey||!privateKey)return reply({error:'Clés Web Push à configurer'},503);
  return reply(await sendBatch(input.id));
 }catch(e){
  console.error('KM16_PUSH_FAILURE',JSON.stringify({phase,code:(e as any)?.code||'exception'}));
  return reply({error:'Envoi interrompu — diagnostic : '+phase+'. Aucun nouvel envoi automatique.'},500);
 }
});
