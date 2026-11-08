const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path'),{webcrypto}=require('crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../server/trial-reminders/index.ts'),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','').replace(/Deno.serve\([\s\S]*$/,'');
const context=vm.createContext({nodemailer:{},webpush:{},Request,Response,AbortSignal,crypto:webcrypto,TextEncoder,console});vm.runInContext(source+';globalThis.make=createHandler;',context);
const secret='w'.repeat(40),tid='12345678-1234-1234-1234-123456789012';let jobs=[],eligible=true,bound=true,smtp=[],push=[],stops=0;
const trial={id:tid,first_name:'Test',last_name:'Participant',email:'test@example.invalid'};
const fetcher=async(url,opts={})=>{
 if(url.endsWith('/auth/v1/user'))return Response.json({id:'user-id',email:'normal@example.invalid',email_confirmed_at:'2026-01-01'});
 if(url.includes('/auth/v1/admin/users/'))return Response.json({email:trial.email,email_confirmed_at:'2026-01-01'});
 if(url.endsWith('/rpc/km16_trial_tick'))return Response.json(null);
 if(url.endsWith('/rpc/km16_claim_trial_reminder'))return Response.json(jobs.length?[jobs.shift()]:[]);
 if(url.endsWith('/rpc/km16_trial_eligible'))return Response.json(eligible);
 if(url.endsWith('/rpc/km16_trial_push_valid'))return Response.json(bound);
 if(url.includes('/km16_trial_attendance?id='))return Response.json([trial]);
 if(url.includes('/km16_trial_push_links?'))return Response.json([{user_id:'user-id'}]);
 if(url.includes('/km16_push_subscriptions?'))return Response.json([{subscription:{endpoint:'https://web.push.apple.com/test-only'}}]);
 if(url.includes('/km16_trial_reminders?id='))return Response.json([]);
 if(url.endsWith('/km16_trial_stops')){stops++;return Response.json({});}
 throw Error('Unexpected URL '+url);
};
const handler=context.make(k=>({SUPABASE_URL:'https://mock.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',KM16_DOCUMENTS_WORKER_KEY:secret,KM16_DOCUMENTS_SMTP_PASSWORD:'mock',KM16_VAPID_PUBLIC_KEY:'pub',KM16_VAPID_PRIVATE_KEY:'private'})[k],fetcher,{createTransport:()=>({sendMail:async m=>{smtp.push(m);return {accepted:[m.to]};},close(){}})},{setVapidDetails(){},sendNotification:async(s,m)=>push.push({s,m:JSON.parse(m)})});
const request=(data,worker=false,auth=false)=>handler(new Request('https://mock.invalid',{method:'POST',headers:{Origin:'https://app.km16.fr',...(worker?{'x-km16-worker-key':secret}:{}),...(auth?{Authorization:'Bearer user'}:{})},body:JSON.stringify(data)}));
const job=(channel,day=3)=>({id:channel==='email'?'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',trial_id:tid,channel,day,target:channel==='email'?trial.email:'only-linked-device'});
(async()=>{
 assert.equal((await request({action:'work'})).status,401);assert.equal((await request({action:'list',season:'2026/2027'},false,true)).status,403);
 jobs=[job('email'),job('push')];const result=await (await request({action:'work'},true)).json();assert.equal(result.accepted,2);assert.equal(smtp.length,1);assert.equal(smtp[0].to,trial.email);assert.equal(push.length,1);assert.equal(push[0].m.type,'trial');
 await request({action:'work'},true);assert.equal(smtp.length,1);assert.equal(push.length,1);
 eligible=false;jobs=[job('email'),job('push')];assert.equal((await (await request({action:'work'},true)).json()).skipped,2);assert.equal(smtp.length,1);eligible=true;
 bound=false;jobs=[job('push',7)];assert.equal((await (await request({action:'work'},true)).json()).skipped,1);assert.equal(push.length,1);
 const match=smtp[0].text.match(/trial-stop.html#([a-f0-9-]+)\.([a-f0-9]{64})/);assert.ok(match);assert.equal((await request({action:'unsubscribe',id:match[1],signature:match[2]})).status,200);assert.equal(stops,1);assert.equal((await request({action:'unsubscribe',id:tid,signature:'0'.repeat(64)})).status,400);assert.equal(stops,1);
 console.log('PASS: worker authentication, admin isolation, individual email, targeted opted-in push only, membership recheck, no repeated sends, unlinked push skipped, signed unsubscribe');
})();
