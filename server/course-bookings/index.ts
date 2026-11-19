const BASE=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN='alexandre.marchat@gmail.com';
const ORIGIN='https://app.km16.fr';
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:cors});
const text=(x:unknown)=>typeof x==='string'?x.trim():'';
async function db(path:string,method='GET',body?:unknown){
 const r=await fetch(BASE+'/rest/v1/'+path,{method,headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
 const value=await r.json().catch(()=>null);
 if(!r.ok)throw Error('database '+r.status+' '+JSON.stringify(value).slice(0,200));
 return value;
}
async function verifiedUser(req:Request){
 const auth=req.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9_.-]+$/.test(auth))return null;
 const r=await fetch(BASE+'/auth/v1/user',{headers:{apikey:SERVICE,Authorization:auth}});
 if(!r.ok)return null;
 const u=await r.json();
 return u.email_confirmed_at&&!u.is_anonymous?u:null;
}
async function sha(s:string){
 const bytes=new TextEncoder().encode(s);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function safeDate(s:string){return /^20\d\d-\d\d-\d\d$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));}
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')!==ORIGIN)return reply({error:'Origine non autorisée'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Méthode refusée'},405);
 try{
  const payload=await req.json();const action=text(payload.action);
  if(action==='sessions'){
   const from=new Date().toISOString().slice(0,10);
   const rows=await db('km16_course_sessions?select=id,course_key,session_date,category,start_time,end_time,venue&enabled=eq.true&session_date=gte.'+from+'&order=session_date.asc,start_time.asc&limit=1000');
   return reply({sessions:rows});
  }
  if(action==='book'){
   const owner=req.headers.has('authorization')?await verifiedUser(req):null;
   if(req.headers.has('authorization')&&!owner)return reply({error:'Reconnectez-vous à votre espace KM16.'},401);
   let householdId=null;
   if(payload.household_id){
    const value=text(payload.household_id);
    if(!owner||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
     ||!(await db('km16_household_members?id=eq.'+value+'&owner_id=eq.'+owner.id+'&select=id&limit=1')).length)
     return reply({error:'Profil indisponible dans votre foyer'},400);
    householdId=value;
   }
   const id=text(payload.session_id),first=text(payload.first_name),last=text(payload.last_name),email=text(owner?.email??payload.email).toLowerCase();
   if(!/^[0-9a-f-]{36}$/.test(id)||first.length<1||first.length>100||last.length<1||last.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return reply({error:'Informations invalides'},400);
   if(payload.website)return reply({error:'Demande refusée'},400);
   const session=await db('km16_course_sessions?id=eq.'+id+'&enabled=eq.true&select=id,session_date');
   if(!session.length||session[0].session_date<new Date().toISOString().slice(0,10))return reply({error:'Cours indisponible'},400);
   const recent=await db('km16_course_bookings?email=eq.'+encodeURIComponent(email)+'&created_at=gte.'+encodeURIComponent(new Date(Date.now()-3600000).toISOString())+'&select=id&limit=6');
   if(recent.length>=5)return reply({error:'Trop de demandes récentes. Réessayez plus tard.'},429);
   const token=crypto.randomUUID()+crypto.randomUUID();
   let rows;
   try{rows=await db('km16_course_bookings','POST',{session_id:id,first_name:first,last_name:last,email,status:'Inscrit',owner_id:owner?.id??null,household_id:householdId,cancellation_hash:await sha(token)});}
   catch(e){if(String(e).includes('23505'))return reply({error:'Une inscription active existe déjà pour cette adresse et ce cours.'},409);throw e;}
   return reply({ok:true,id:rows[0].id,cancellation_token:token,account_booking:Boolean(owner)});
  }
  if(action==='cancel'){
   const token=text(payload.token);
   if(token.length<50||token.length>150)return reply({error:'Jeton invalide'},400);
   const rows=await db('km16_course_bookings?cancellation_hash=eq.'+await sha(token)+'&select=id,status');
   if(!rows.length)return reply({error:'Inscription introuvable'},404);
   if(rows[0].status==='Annulé')return reply({ok:true,already_cancelled:true});
   await db('km16_course_bookings?id=eq.'+rows[0].id,'PATCH',{status:'Annulé',cancelled_at:new Date().toISOString(),read_at:null});
   return reply({ok:true});
  }
  if((await verifiedUser(req))?.email?.toLowerCase()!==ADMIN)return reply({error:'Accès réservé à l’administration KM16'},403);
  if(action==='admin_list'){
   const sessions=await db('km16_course_sessions?select=id,course_key,session_date,category,start_time,end_time,venue,enabled&order=session_date.desc&limit=1000');
   const bookings=await db('km16_course_bookings?select=id,session_id,first_name,last_name,email,status,created_at,cancelled_at,read_at&order=created_at.desc&limit=2000');
   return reply({sessions,bookings});
  }
  if(action==='admin_read'){
   if(!Array.isArray(payload.ids)||payload.ids.length>2000||payload.ids.some((x:unknown)=>!/^[-0-9a-f]{36}$/.test(text(x))))return reply({error:'Sélection invalide'},400);
   if(payload.ids.length)await db('km16_course_bookings?id=in.('+payload.ids.join(',')+')&read_at=is.null','PATCH',{read_at:new Date().toISOString()});
   return reply({ok:true});
  }
  if(action==='admin_change_session'){
   const id=text(payload.session_id);
   if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return reply({error:'Séance invalide'},400);
   const current=(await db('km16_course_sessions?id=eq.'+id))[0];
   const now=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date()).replace(' ','T');
   if(!current?.enabled||current.session_date+'T'+current.start_time.slice(0,5)<=now)return reply({error:'Séance indisponible'},409);
   let change:{enabled?:boolean;session_date?:string;start_time?:string;end_time?:string;venue?:string};
   if(payload.cancel===true)change={enabled:false};
   else{
    const date=text(payload.session_date),start=text(payload.start_time),end=text(payload.end_time),venue=text(payload.venue);
    if(!safeDate(date)||venue.length<2||venue.length>120||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||start>=end||date+'T'+start<=now)
     return reply({error:'Données du cours invalides'},400);
    change={session_date:date,start_time:start,end_time:end,venue};
   }
   const rows=await db('km16_course_sessions?id=eq.'+id+'&enabled=eq.true','PATCH',change);
   if(!rows?.length)return reply({error:'Séance indisponible'},409);
   return reply({ok:true,session:rows[0]});
  }
  if(action==='admin_session'){
   const date=text(payload.session_date),course=text(payload.course_key),category=text(payload.category),start=text(payload.start_time),end=text(payload.end_time),venue=text(payload.venue);
   if(!safeDate(date)||course.length<3||course.length>300||category.length<2||category.length>100||venue.length<2||venue.length>120||!/^\d\d:\d\d$/.test(start)||!/^\d\d:\d\d$/.test(end)||start>=end)return reply({error:'Données du cours invalides'},400);
   const rows=await db('km16_course_sessions?on_conflict=course_key,session_date','POST',{course_key:course,session_date:date,category,start_time:start,end_time:end,venue,enabled:true});
   return reply({ok:true,session:rows[0]});
  }
  return reply({error:'Action inconnue'},400);
 }catch(e){console.error('km16-course-bookings',String(e));return reply({error:'Service momentanément indisponible'},500);}
});