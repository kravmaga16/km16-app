import {createCheckoutAccess, verifiedAccount, normalizeEmail} from './checkout-account.mjs?v=20261118';

const $=id=>document.getElementById(id);
const client=window.supabase.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-shirts';
const sizesAllowed=['XXS','XS','S','M','L','XL','2XL'];
let session=null,busy=false,authRevision=0,draftRestored=false;
for(const id of ['size1','size2'])for(const size of sizesAllowed)$(id).add(new Option(size,size));
$('size1').value='M';$('size2').value='M';
// Reminder links contain product choices only, never an email or account identity.
const sizeParameters=new URLSearchParams(location.search).getAll('sizes');
const requestedSizes=sizeParameters.length===1?sizeParameters[0].split(','):[];
const reminderSizes=[1,2].includes(requestedSizes.length)&&requestedSizes.every(size=>sizesAllowed.includes(size))?requestedSizes:null;
function applySizes(sizes){$('quantity').value=String(sizes.length);$('size1').value=sizes[0];$('size2').value=sizes[1]||'M';}
if(reminderSizes)applySizes(reminderSizes);
$('purchase-email').addEventListener('input',()=>{$('checkout-reminder').checked=false;});
for(const id of ['quantity','size1','size2'])$(id).addEventListener('change',()=>{$('checkout-reminder').checked=false;});
function message(s){$('message').textContent=s;}
function update(){
 const n=Number($('quantity').value);
 $('second').hidden=n===1;
 $('total').textContent='Total : '+(n===1?'18':'30')+' €';
 $('pay').disabled=busy;
 for(const id of ['quantity','size1','size2','purchase-email','checkout-reminder'])$(id).disabled=busy;
 $('pay').textContent=busy?'Préparation de votre demande…':session?'Continuer vers le paiement':'Valider ma commande';
}
function withDeadline(promise){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('La connexion ne répond pas. Réessayez.')),15000);})]).finally(()=>clearTimeout(timer));
}
const access=createCheckoutAccess({
 client,kind:'shirts',host:$('shirt-email-verification'),emailInput:$('purchase-email'),returnPath:'./tee-shirts.html',
 getDraft:()=>({quantity:$('quantity').value,size1:$('size1').value,size2:$('size2').value,email:$('purchase-email').value.trim()}),
 applyDraft:d=>{
  if(!['1','2'].includes(d.quantity)||!sizesAllowed.includes(d.size1)||!sizesAllowed.includes(d.size2))return;
  $('quantity').value=d.quantity;$('size1').value=d.size1;$('size2').value=d.size2;$('purchase-email').value=d.email||'';
  // A saved OTP draft must not reinstate a later opt-out from another tab.
  $('checkout-reminder').checked=false;
  if(reminderSizes)applySizes(reminderSizes);
  update();
  message('Votre choix a été conservé. Vérifiez votre commande avant de continuer.');
 },
 onVerified:()=>message('Votre adresse e-mail est confirmée. Vous pouvez continuer vers le paiement.')
});
function account(next){
 const previous=session;session=verifiedAccount(next);
 if(previous&&!session){void access.clear();$('purchase-email').value='';$('checkout-reminder').checked=false;}
 if(previous&&session&&previous.user.id!==session.user.id)$('checkout-reminder').checked=false;
 const previousEmail=normalizeEmail($('purchase-email').value);
 if(session&&previousEmail&&previousEmail!==normalizeEmail(session.user.email)){void access.clear();$('checkout-reminder').checked=false;message('Vous êtes connecté avec '+session.user.email+'. Vérifiez cette adresse avant de valider votre commande.');}
 $('admin').hidden=session?.user?.email?.toLowerCase()!=='alexandre.marchat@gmail.com';
 $('stripe-diagnostic').hidden=$('admin').hidden;
 $('guest-account').hidden=!!session;$('connected').hidden=!session;$('my-orders').hidden=!session;
 $('identity').textContent=session?'Connecté avec '+session.user.email:'';
 $('purchase-email').readOnly=!!session;
 if(session)$('purchase-email').value=session.user.email.trim();
 if(previous?.user.id!==session?.user.id){$('orders').replaceChildren();$('admin-orders').replaceChildren();}
 access.sync(session);update();showAccountStatus();
}
$('quantity').onchange=update;
async function api(data,expectedAccount=null){
 const {data:{session:s},error}=await withDeadline(client.auth.getSession());
 if(error||!verifiedAccount(s))throw Error('Confirmez votre adresse e-mail avant de continuer.');
 if(expectedAccount&&(s.user.id!==expectedAccount.id||normalizeEmail(s.user.email)!==expectedAccount.email))throw Error('Votre connexion a changé. Vérifiez votre adresse avant de continuer.');
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify(data)});
 const x=await r.json();if(!r.ok)throw Error(x.error||'Service indisponible');
 if(expectedAccount){
  const latest=await withDeadline(client.auth.getSession());const active=verifiedAccount(latest.data?.session);
  if(latest.error||!active||active.user.id!==expectedAccount.id||normalizeEmail(active.user.email)!==expectedAccount.email)throw Error('Votre connexion a changé. Reconnectez-vous avec l’adresse de cette commande avant de continuer.');
 }
 return x;
}
async function load(){if(!session){$('admin').hidden=true;return;}const userId=session.user.id;const admin=session.user.email?.toLowerCase()==='alexandre.marchat@gmail.com';$('admin').hidden=!admin;try{const {orders}=await api({action:'list'});if(session?.user.id!==userId)return;$('orders').replaceChildren();$('admin-orders').replaceChildren();for(const o of orders){if(admin){if(o.status==='paid'&&!o.collected_at){const li=document.createElement('li');li.textContent=o.email+' · '+o.sizes.join(' + ')+' · '+(o.amount_cents/100)+' € ';const b=document.createElement('button');b.textContent='Marquer comme remis';b.onclick=async()=>{if(!confirm('Confirmer la remise au club ?'))return;try{const result=await api({action:'collect',id:o.id});await load();message(result.email_sent?(result.test?'Retrait enregistré. E-mail de test envoyé à l’administrateur.':'Retrait enregistré. Confirmation envoyée à l’acheteur.'):(result.message||'Retrait enregistré, envoi e-mail à vérifier.'));}catch(e){message(e.message)}};li.append(b);$('admin-orders').append(li);}else if(o.collected_at&&o.handover_email_status==='failed'){const li=document.createElement('li');li.textContent=o.email+' · '+o.sizes.join(' + ')+' · remise enregistrée · e-mail non envoyé ';const b=document.createElement('button');b.textContent='Relancer l’e-mail de remise';b.onclick=async()=>{b.disabled=true;try{const r=await api({action:'retry-handover-email',id:o.id});await load();message(r.email_sent?'E-mail de remise accepté par OVH.':(r.message||'Envoi non confirmé.'));}catch(e){message(e.message);b.disabled=false;}};li.append(b);$('admin-orders').append(li);}}if(o.user_id===session.user.id){const li=document.createElement('li');li.textContent=o.sizes.join(' + ')+' · '+(o.amount_cents/100)+' € · '+(o.collected_at?'Retiré au club':o.status==='paid'?'Payé · à retirer au club':o.status==='cancelled'?'Annulé':'Paiement en attente');$('orders').append(li);}}}catch(e){message(e.message);}}
$('refresh').onclick=load;
$('login').onsubmit=async e=>{
 e.preventDefault();const button=$('login-submit');if(button.disabled)return;button.disabled=true;
 try{
  const {data,error}=await withDeadline(client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}));
  if(error||!verifiedAccount(data?.session))throw Error('Connexion impossible. Vérifiez votre e-mail et votre mot de passe.');
  authRevision++;account(data.session);void load();message('Vous êtes connecté. Votre choix de tailles a été conservé.');
 }catch(e){message(e.message||'Connexion impossible. Réessayez.');}
 finally{$('password').value='';button.disabled=false;}
};
$('email-access').onsubmit=async e=>{
 e.preventDefault();const button=$('access-submit');if(button.disabled)return;button.disabled=true;
 try{
  const {error}=await withDeadline(client.auth.signInWithOtp({email:$('access-email').value.trim(),options:{shouldCreateUser:false,emailRedirectTo:'https://app.km16.fr/'}}));
  if(error?.status===429)throw Error('Veuillez patienter quelques minutes avant de demander un nouveau lien.');
  if(error&&error.code!=='otp_disabled'&&error.code!=='user_not_found')throw error;
  $('access-status').textContent='Si cette adresse correspond à votre compte KM16, vous recevrez un lien pour retrouver vos achats.';
  setTimeout(()=>button.disabled=false,60000);
 }catch{$('access-status').textContent='Le lien n’a pas pu être envoyé. Vérifiez votre adresse et réessayez dans quelques minutes.';button.disabled=false;}
};
$('logout').onclick=async()=>{
 const {error}=await client.auth.signOut({scope:'local'});
 if(error){message('La déconnexion a échoué. Réessayez.');return;}
 authRevision++;account(null);await access.clear();message('Vous pouvez utiliser une autre adresse e-mail pour votre commande.');
};
client.auth.onAuthStateChange((event,s)=>{
 authRevision++;
 setTimeout(()=>{account(s);if(s)void load();},0);
});
$('shirt-order').onsubmit=async e=>{
 e.preventDefault();if(busy||!$('shirt-order').reportValidity())return;
 const submittedEmail=normalizeEmail($('purchase-email').value);
 const sizes=[$('size1').value,...(Number($('quantity').value)===2?[$('size2').value]:[])];
 const reminderOptIn=$('checkout-reminder').checked;
 const reminderAccountId=session?.user?.id||null;
 busy=true;update();message('Préparation de votre demande…');
 try{
  const verified=await access.ensure();
  if(!verified){message('Vérifiez votre e-mail avec le lien reçu, puis reprenez votre commande. Vos tailles sont conservées.');return;}
  const expectedAccount={id:verified.user.id,email:normalizeEmail(verified.user.email)};
  if(expectedAccount.email!==submittedEmail)throw Error('Utilisez l’adresse du compte connecté ou déconnectez-vous pour changer d’adresse.');
  account(verified);
  const r=await api({action:'checkout',sizes,reminder_opt_in:reminderOptIn&&$('checkout-reminder').checked&&(!reminderAccountId||reminderAccountId===expectedAccount.id)},expectedAccount);
  const u=new URL(r.url);if(u.hostname!=='checkout.stripe.com'||u.protocol!=='https:')throw Error('Lien de paiement invalide');
  await access.clear();location.assign(u.href);
 }catch(e){message(e.message||'La commande n’a pas pu aboutir. Réessayez.');}
 finally{busy=false;update();}
};
async function restoreAccount(){
 const revision=authRevision;
 try{
  const {data,error}=await withDeadline(client.auth.getSession());if(revision!==authRevision)return;if(error)throw error;
  account(data.session);if(!draftRestored){draftRestored=true;await access.restore();}access.sync(session);if(session)void load();
 }catch{message('Vos choix restent disponibles. Vérifiez votre connexion avant de continuer.');}
}
window.addEventListener('pageshow',()=>{void restoreAccount();});
window.addEventListener('storage',e=>{if(e.key==='km16-video-auth')void restoreAccount();});
await restoreAccount();
if(new URLSearchParams(location.search).has('paid'))message('Retour de Stripe : actualisez Mes commandes pour vérifier la confirmation du paiement.');
if(new URLSearchParams(location.search).has('cancel'))message('Paiement interrompu : aucune commande n’est confirmée.');
$('smtp-check').onclick=async()=>{const b=$('smtp-check');b.disabled=true;$('smtp-result').textContent='Vérification de la connexion OVH…';try{const r=await api({action:'mail-diagnostic'});$('smtp-result').textContent=r.ok?r.message:('Diagnostic : '+r.reason+' ('+(r.code||r.step)+')');}catch(e){$('smtp-result').textContent='Diagnostic indisponible : '+e.message;}finally{b.disabled=false;}};

$('retry-failed').onclick=async()=>{const b=$('retry-failed');b.disabled=true;$('retry-result').textContent='Relance en cours…';try{const r=await api({action:'retry-failed-handover'});$('retry-result').textContent=r.email_sent?'Confirmation acceptée par le serveur OVH. Vérifiez votre boîte e-mail.':(r.message||'Envoi non confirmé.');await load();}catch(e){$('retry-result').textContent='Erreur : '+e.message;}finally{b.disabled=false;}};

$('live-check').onclick=async()=>{const b=$('live-check');b.disabled=true;$('live-result').textContent='Vérification sécurisée auprès de Stripe…';try{const r=await api({action:'live-readiness'});$('live-result').textContent=r.ready?('Clé valide · Encaissements : '+(r.charges_enabled?'autorisés':'non autorisés')+' · Versements : '+(r.payouts_enabled?'autorisés':'non autorisés')+' · Dossier : '+(r.details_submitted?'complet':'incomplet')):('Vérification impossible : '+r.reason+(r.code?' ('+r.code+')':''));}catch(e){$('live-result').textContent='Erreur : '+e.message;}finally{b.disabled=false;}};

function showAccountStatus(){const el=$('account-status');if(!session){el.textContent='Non connecté.';return;}el.textContent='Compte connecté : '+session.user.email+(session.user.email?.toLowerCase()==='alexandre.marchat@gmail.com'?' · Administrateur reconnu':'');}
