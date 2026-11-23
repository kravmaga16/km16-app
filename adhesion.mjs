import {downloadCalendar, downloadCourseCalendar, stageCalendarFile} from './course-calendar-export.mjs?v=2';
import {hasStageAnalyticsConsent, prepareStageAnalytics, stageReminderSource, trackStageCheckout, trackStageReminderVisit, trackMembershipStep} from './stage-analytics.mjs?v=adhesion-mesure-20261120';
import {enhanceBirthDate} from './birth-date-input.mjs?v=1';
enhanceBirthDate(document.getElementById('birth_date'));
import {preparePhoto} from './member-photo.mjs?v=1';
import {createMemberCamera} from './member-camera.mjs?v=2';
import {parseEuro,eligibleProducts} from './purchase-links.mjs?v=liens1';
import {splitAmount,ageOn,validateOrder} from './rules.mjs';
import {createCheckoutAccess,verifiedAccount,normalizeEmail,saveOrderLoginReturn} from './checkout-account.mjs?v=brouillon-20261120';
const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n/100);
const client=window.supabase?.createClient('https://tlfewpbgbwesdriklxzb.supabase.co','sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn',{auth:{storageKey:'km16-video-auth',detectSessionInUrl:false,flowType:'implicit'}});
const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-adhesions';
const adminPanel=$('admin');
const adminMfaGate=$('adhesion-admin-mfa');
let resetAdhesionMfa;
let adminSessionToken=null;
const embedded=new URLSearchParams(location.search).get('embed')==='1'&&parent!==window;
const accountView=new URLSearchParams(location.search).get('espace')==='1'&&!embedded&&!location.hash.includes('offre=');
const paymentReturn=new URLSearchParams(location.search);
const requestedOrder=accountView && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(paymentReturn.get('order')||'')
 ? paymentReturn.get('order').toLowerCase() : '';
const returnedOrder=paymentReturn.get('paid')==='1' ? requestedOrder : '';
let focusedRequestedOrder=false;
const trialJourney=paymentReturn.has('apres_essai')||paymentReturn.has('essai');
const renewalJourney=paymentReturn.has('renouveler');
const familyProfile=!accountView&&!embedded&&/^[0-9a-f-]{36}$/i.test(paymentReturn.get('profil')||'')?paymentReturn.get('profil'):'';
const FEKM_LICENSE_CENTS=3300;
const reuseOrder=paymentReturn.get(renewalJourney?'renouveler':'essai');
let reusedMember=null;
let trialReuseAttempt='';
const requestedCategory=new URLSearchParams(location.search).get('categorie')||'Tous';
const requestedProduct=new URLSearchParams(location.search).get('produit')||'';
let stageCatalogueLoaded=false;
let reminderSource=stageReminderSource(new URLSearchParams(location.search).get('source_stage'));
const stageDetail=/^stage-[a-z0-9-]+$/.test(requestedProduct)&&!embedded&&!accountView;
if(stageDetail){
 document.title='Inscription au stage · KM16';
 $('registration-title').textContent='Inscription au stage';
 $('registration-intro').textContent='Retrouvez les informations du stage et inscrivez-vous en ligne.';
 $('license-note').hidden=true;
 $('chosen').textContent='Sélectionnez « S’inscrire » pour continuer.';
}
const requestedStageDate=new URLSearchParams(location.search).get('stage_date')||'';
const categoryFor=value=>{const s=String(value).toLowerCase();return s.includes('adulte')?'Adultes':s.includes('enfant')?'Enfants':s.includes('ado')?'Ados':['Tous','Stages','Découverte','Équipement'].includes(value)?value:'Tous';};
let products=[],selected=null,session=null,enabled=false,category='Tous',busy=false,requestId=crypto.randomUUID(),generation=0;
const linkToken=new URLSearchParams(location.hash.slice(1)).get('offre')||'';
let specialOffer=null;
let photoData='',photoRevision=0,photoPreparing=false;
async function selectMemberPhoto(input,file=input?.files?.[0]){
 if(!file||busy)return;
 const revision=++photoRevision;
 photoPreparing=true;buttonState();$('photo-status').textContent='Préparation de la photo…';
 try{
  const value=await preparePhoto(file);
  if(revision!==photoRevision)return;
  photoData=value;
  for(const id of ['member_photo','member_camera'])if(id!==input?.id)$(id).value='';
  $('photo-preview').src=value;$('photo-preview').hidden=false;
  $('photo-status').textContent='Photo prête. Elle sera envoyée avec votre demande.';
 }catch(error){
  if(revision!==photoRevision)return;
  if(input)input.value='';
  $('photo-status').textContent=error.message+(photoData?' Votre photo précédente est conservée.':'');
 }finally{
  if(revision===photoRevision){photoPreparing=false;buttonState();}
 }
}
for(const id of ['member_photo','member_camera'])$(id).onchange=()=>selectMemberPhoto($(id));
const memberCamera=createMemberCamera({
 dialog:$('member-camera-dialog'),trigger:$('take-photo'),canOpen:()=>!busy&&!photoPreparing,
 onPhoto:file=>selectMemberPhoto(null,file),
 onFile:()=>$('member_photo').click(),
 onNative:()=>{$('member_camera').value='';$('member_camera').click();}
});
if(accountView){
 $('account-access').open=true;
 document.body.classList.add('account-view');document.title='Mon espace adhérent · KM16';
 document.querySelector('header h1').textContent='Mon espace adhérent';
 document.querySelector('header>p:last-child').textContent='Retrouvez vos inscriptions, vos stages et le suivi de vos paiements.';
 const bookings=document.createElement('a');bookings.href='./course-operations.html';bookings.textContent='Mes réservations de cours';$('account').before(bookings);
 const link=document.createElement('a');link.href='./#tarifs';link.className='member-purchase-link';link.textContent='Acheter une adhésion ou un stage →';$('my-orders').querySelector('.row').append(link);
}

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function note(t,error=false){$('status').textContent=t;$('status').className=error?'error':'';}
function text(tag,t,parent,cls){const e=document.createElement(tag);e.textContent=t;if(cls)e.className=cls;parent.append(e);return e;}
async function api(data,expectedUser=null){const s=client?(await accountTimeout(client.auth.getSession())).data?.session:null;if(expectedUser&&(!verifiedAccount(s)||s.user.id!==expectedUser.id||normalizeEmail(s.user.email)!==normalizeEmail(expectedUser.email)))throw Error('Votre connexion a changé. Vérifiez votre demande avant de continuer.');const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(s?{Authorization:'Bearer '+s.access_token}:{})},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error||'Service indisponible');return result;}
// Account restoration must not wait for the remote catalogue or order history.
let accountRevision=0,accountLoginBusy=false,catalogueReady=false;
const accountSession=verifiedAccount;
function accountMessage(message,error=false){const target=$('account-status');target.textContent=message;target.className=error?'error':'muted';}
function syncAccountForm(){
 const ready=!!accountSession(session);
 if(ready)$('contact_email').value=session.user.email.trim();
 $('contact_email').readOnly=ready;
 $('contact-email-help').textContent=ready?'Adresse vérifiée de votre espace KM16. Pour utiliser une autre adresse, déconnectez-vous ci-dessus.':'Vos confirmations et votre accès personnel seront envoyés à cette adresse. Pour un mineur, indiquez l’e-mail du parent ou du représentant légal.';
 $('order').hidden=!selected;
 $('account-access').hidden=ready;
 $('login-submit').textContent=accountLoginBusy?'Connexion…':selected?'Me connecter et continuer':'Me connecter';
}
function focusAccount(){
 $('account-access').open=true;$('password-access').open=true;
 $('account').scrollIntoView({behavior:'smooth',block:'start'});
 $('email').focus({preventScroll:true});
 accountMessage('Saisissez votre e-mail et votre mot de passe pour continuer.');
}
function accountTimeout(promise){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('La connexion ne répond pas. Réessayez.')),15000);})]).finally(()=>clearTimeout(timer));
}
async function restoreAccount(){
 if(!client){accountMessage('Connexion indisponible. Rechargez la page pour réessayer.',true);return;}
 const revision=accountRevision;
 try{const {data,error}=await accountTimeout(client.auth.getSession());if(revision!==accountRevision)return;if(error)throw error;await authState(data.session);}
 catch{if(revision===accountRevision)accountMessage('Votre connexion n’a pas pu être rétablie. Connectez-vous ci-dessous.',true);}
}
function buttonState(){ $('save-request').disabled=busy||!selected;$('pay').disabled=busy||photoPreparing||!enabled||!selected||selected.draft;$('reset-request').disabled=busy;$('pay').textContent=busy?'Préparation de votre demande…':photoPreparing?'Préparation de la photo…':!enabled?'Paiement indisponible':!accountSession(session)?'Valider ma demande':selected?.amount===0?'Envoyer ma demande gratuite':'Continuer vers le paiement';for(const id of ['member_photo','member_camera','take-photo'])$(id).disabled=busy||photoPreparing;$('take-photo').textContent=photoData?'Reprendre une photo':'Prendre une photo';}
function render(){
 if(linkToken){$('catalogue').replaceChildren();$('filters').replaceChildren();return;}
 let offered=products.filter(p=>p.category!=='Interne'&&p.category!=='Équipement'&&(!p.event_date||p.event_date>=today())&&(!embedded||!p.draft));
 if(trialJourney||renewalJourney||familyProfile){
  offered=offered.filter(p=>p.kind==='annual'&&!p.draft);
  if(reusedMember?.birth_date){
   const age=ageOn(reusedMember.birth_date,today());
   offered=offered.filter(p=>(p.min_age==null||age>=p.min_age)&&(p.max_age==null||age<=p.max_age));
   if(renewalJourney)offered.sort((a,b)=>Number(b.id===reusedMember.product_id)-Number(a.id===reusedMember.product_id));
  }
 }
 if(stageDetail){
  const stage=offered.find(p=>p.id===requestedProduct&&p.category==='Stages'&&!p.draft&&!p.review);
  const host=$('catalogue');host.replaceChildren();$('filters').replaceChildren();
  const card=document.createElement('article');card.className='card';host.append(card);
  if(!stageCatalogueLoaded)text('p','Chargement du stage…',card);
  else if(stage){
   const number=/^stage-([1-9])$/.exec(stage.id)?.[1]||(stage.id==='stage-combat'?'8':'');
   if(number)text('span','Stage '+number+'/9',card,'tag');
   text('h2',stage.title,card);
   if(stage.note)text('p',stage.note,card);
   text('p',stage.amount?money(stage.amount):'Gratuit',card,'price');
   const button=text('button','S’inscrire',card);button.type='button';button.onclick=()=>choose(stage);
  }else text('p','Les inscriptions pour ce stage ne sont pas ouvertes.',card);
  const back=text('a','Voir tous les stages',card);back.href='./#stages';
  return;
 }
 renderRecommendedMembership(offered);
 $('filters').replaceChildren();for(const c of ['Tous',...new Set(offered.map(p=>p.category))]){const b=text('button',c,$('filters'));b.type='button';b.setAttribute('aria-pressed',String(c===category));b.onclick=()=>{category=c;render();};}
 $('catalogue').replaceChildren();for(const p of offered.filter(p=>category==='Tous'||p.category===category)){const a=document.createElement('article');a.className='card';text('span',p.draft?'En préparation':p.category,a,'tag');text('h3',p.title,a);text('span',p.amount?money(p.amount)+(p.kind==='monthly'?' / mois':''):'Gratuit',a,'price');text('p',p.note,a);const b=text('button',p.draft?'Bientôt disponible':'Choisir cette formule',a);b.disabled=!!p.draft;b.onclick=()=>choose(p);$('catalogue').append(a);}
}
function standardMembership(age, categoryHint=''){
 return products.find(p=>p.kind==='annual'&&!p.draft&&!p.review&&p.id.endsWith('-premiere')
  && (age===null?p.category===categoryHint:(p.min_age==null||age>=p.min_age)&&(p.max_age==null||age<=p.max_age)));
}
function renderRecommendedMembership(offered=products){
 const host=$('membership-recommendation');host.replaceChildren();
 if((!trialJourney&&!familyProfile)||renewalJourney||accountView||embedded)return;
 const age=reusedMember?.birth_date?ageOn(reusedMember.birth_date,today()):null;
 // A linked trial is authenticated before recommending a formula for its participant.
 if(age===null&&reuseOrder)return;
 const product=standardMembership(age,categoryFor(requestedCategory));
 if(!product||!offered.includes(product))return;
 const card=text('article','',host,'summary');
 text('h3','Formule recommandée'+(reusedMember?.first_name?' pour '+reusedMember.first_name:''),card);
 text('strong',product.title,card);
 text('p',money(product.amount)+' au club. Avec une nouvelle licence FEKM à '+money(FEKM_LICENSE_CENTS)+', le total est de '+money(product.amount+FEKM_LICENSE_CENTS)+'. La licence se règle séparément.',card);
 const pattern=firstCourseCategory(product);
 if(pattern&&firstCourseSessions===null){text('p','Chargement des prochains créneaux…',card);void fetchFirstCourseSessions();}
 else if(pattern){
  const now=parisClock.format(new Date()).replace(' ','T');
  const upcoming=(firstCourseSessions||[]).filter(course=>pattern.test(course.category)&&course.session_date+'T'+course.start_time.slice(0,5)>now)
   .sort((a,b)=>(a.session_date+a.start_time).localeCompare(b.session_date+b.start_time)).slice(0,3);
  if(upcoming.length){const list=text('ul','',card);for(const course of upcoming)text('li',upcomingDate(course.session_date)+' · '+course.start_time.slice(0,5)+' · '+course.venue,list);}
 }
 const actions=text('div','',card,'row');
 const button=text('button','M’inscrire à cette formule',actions);button.type='button';button.onclick=()=>choose(product);
 const planning=text('a','Voir tous les horaires et dojos',actions);planning.href='./#planning';
}
function choose(p,{focus=true}={}){if(busy)return;if(selected?.id!==p.id||Number(p.amount)<=0)$('checkout-reminder').checked=false;selected=p;if(focus&&p.kind==='annual')void trackMembershipStep('formula_chosen');$('checkout-reminder-wrap').hidden=!(Number(p.amount)>0);if(p.category==='Stages'&&!linkToken&&!embedded)prepareStageAnalytics();requestId=crypto.randomUUID();$('chosen').textContent=p.title;syncAccountForm();$('count').value=String(specialOffer?.count||1);$('count').disabled=!!specialOffer;$('payment-mode').hidden=p.kind!=='annual'||!!specialOffer;for(const o of $('count').options)o.disabled=p.kind!=='annual'&&o.value!=='1';$('eligibility-wrap').hidden=!p.review;$('eligibility').required=p.review;updateSchedule();if(focus){if(reusedMember&&!familyProfile)fillMemberDetails(reusedMember);$('selection').scrollIntoView({behavior:'smooth',block:'start'});$('first_name').focus({preventScroll:true});}}
function updateSchedule(){if(!selected)return;const n=Number($('count').value),a=splitAmount(selected.amount,n);$('schedule').replaceChildren();text('strong',(n===1?'À régler : ':'Total : ')+money(selected.amount),$('schedule'));if(n>1)text('div','Aujourd’hui : '+money(a[0])+' · Puis '+(n-1)+' mensualités de '+money(a[1]),$('schedule'));if(selected.kind==='annual'||selected.kind==='monthly')text('div','Sans supplément · Licence non comprise',$('schedule'));$('installments-wrap').hidden=n===1;$('installments').required=n>1;updateCheckoutSummary();buttonState();}
$('count').onchange=()=>{requestId=crypto.randomUUID();updateSchedule();};
$('birth_date').onchange=()=>{let minor=true;try{minor=ageOn($('birth_date').value,today())<18;}catch{}$('guardian').hidden=!minor;$('guardian_name').required=minor;};
$('login').onsubmit=async e=>{
 e.preventDefault();if(accountLoginBusy)return;
 if(!client){accountMessage('Connexion indisponible. Rechargez la page pour réessayer.',true);return;}
 if(!$('login').reportValidity())return;
 accountLoginBusy=true;$('login-submit').disabled=true;syncAccountForm();accountMessage('Connexion en cours…');
 try{
  const {data,error}=await accountTimeout(client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}));
  if(error)throw error;
  const next=accountSession(data?.session);
  if(!next)throw Error('Confirmez votre adresse e-mail, puis reconnectez-vous.');
  accountRevision++;
  if(adminPanel){
   await authState(next);
   return;
  }
  void authState(next).catch(()=>accountMessage('Connexion réussie. L’historique est temporairement indisponible.',true));
  accountMessage('Vous êtes connecté. Vous pouvez poursuivre votre inscription.');
  if(selected){$('selection').scrollIntoView({behavior:'smooth',block:'start'});$('first_name').focus({preventScroll:true});}
 }catch(error){
  const message=error?.code==='email_not_confirmed'?'Confirmez votre adresse avec le lien reçu par e-mail, puis reconnectez-vous.':error?.status===429?'Trop de tentatives. Réessayez dans quelques minutes.':'Connexion impossible. Vérifiez votre e-mail, votre mot de passe et votre connexion, puis réessayez.';
  accountMessage(message,true);
 }finally{$('password').value='';accountLoginBusy=false;$('login-submit').disabled=false;syncAccountForm();}
};
function fillMemberDetails(member){
 $('checkout-reminder').checked=false;
 for(const field of ['first_name','last_name','birth_date','phone','guardian_name'])$(field).value=member[field]||'';
 $('birth_date-display').value=member.birth_date;
 $('birth_date-display').dispatchEvent(new Event('input',{bubbles:true}));
 $('birth_date').dispatchEvent(new Event('change'));
 updateCheckoutSummary();
}
function showMembershipJourney(){
 if((!trialJourney&&!renewalJourney&&!familyProfile)||accountView||embedded)return;
 const panel=$('membership-journey');
 panel.hidden=false;
 if((reuseOrder||familyProfile)&&!session)$('account-access').open=true;
 $('membership-journey-title').textContent=renewalJourney?'Renouveler une adhésion':familyProfile?'Inscrire un membre du foyer':'Choisir mon adhésion après l’essai';
 const button=$('membership-journey-reuse');
 button.hidden=!reuseOrder||!session||!!reusedMember;
 $('membership-journey-status').textContent=reusedMember
  ?'Formules adaptées à '+reusedMember.first_name+'. Vérifiez ses coordonnées après avoir choisi une formule.'
  :(reuseOrder||familyProfile)&&!session?'Connectez-vous pour reprendre les coordonnées du pratiquant. Vous pouvez aussi remplir le formulaire.'
  :'Choisissez une formule annuelle adaptée au pratiquant.';
 button.onclick=async()=>{
  const current=session?.user;
  button.disabled=true;
  try{
   const member=await api({action:'membership-reuse',order_id:reuseOrder,kind:renewalJourney?'renewal':'trial'},current);
   if(session?.user.id!==current?.id)return;
   reusedMember=member;category='Tous';render();showMembershipJourney();
   if(selected?.kind==='annual'){
    const age=ageOn(member.birth_date,today());
    if((selected.min_age==null||age>=selected.min_age)&&(selected.max_age==null||age<=selected.max_age))fillMemberDetails(member);
    else{selected=null;syncAccountForm();note('Choisissez une formule adaptée au pratiquant.');}
   }
  }catch(error){$('membership-journey-status').textContent=error.message;}
  finally{button.disabled=false;}
 };
 const attempt=trialJourney&&reuseOrder&&session?.user?.id?session.user.id+':'+reuseOrder:'';
 if(attempt&&trialReuseAttempt!==attempt&&!reusedMember&&!button.disabled){trialReuseAttempt=attempt;void button.onclick();}
}
function isFreeTrial(id,amount){return ['essai','essai-saint-jean'].includes(id)&&Number(amount)===0;}
function updateCheckoutSummary(){
 if(!selected)return;
 const trial=isFreeTrial(selected.id,selected.amount);
 $('registration-validation-note').textContent=trial
  ?'Après l’enregistrement de votre demande de cours d’essai, choisissez librement une séance adaptée au pratiquant dans le planning. Présentez-vous à l’enseignant à votre arrivée.'
  :'L’inscription est soumise à la validation de KM16. Pour une formule réservée, faites confirmer votre éligibilité au club avant de payer.';
 const summary=$('checkout-summary');
 summary.replaceChildren();
 const participant=[$('first_name').value.trim(),$('last_name').value.trim()].filter(Boolean).join(' ');
 text('p',selected.title+(participant?' · '+participant:''),summary);
 const amounts=splitAmount(selected.amount,Number($('count').value));
 text('p',amounts[0]===0?'Aucun paiement à effectuer.':'À régler aujourd’hui : '+money(amounts[0]),summary);
 if(amounts.length>1)text('p','Puis '+(amounts.length-1)+' échéances mensuelles de '+money(amounts[1])+' · Total '+money(selected.amount),summary);
 if(trial){const planning=text('a','Consulter le planning pour mon cours d’essai',summary);planning.href='./#planning';}
 if(selected.kind==='annual'){
  text('p','Licence FEKM saison 2026/2027 : '+money(FEKM_LICENSE_CENTS)+' à régler séparément auprès de la fédération si nécessaire.',summary);
  const faq=text('details','',summary);text('summary','Avant de m’inscrire',faq);
  text('p','Vous pouvez commencer en cours de saison tant que la formule est ouverte. Le montant applicable est celui affiché ici.',faq);
  text('p','Pour votre premier cours, prévoyez un tee-shirt blanc et un bas de kimono noir.',faq);
  const equipment=text('a','Voir la tenue et les protections',faq);equipment.href='./#equipement';
 }
 else if(selected.category==='Stages')text('p','Après validation du paiement, retrouvez la confirmation et les informations du stage dans Mes inscriptions.',summary);
}
$('order').addEventListener('input',updateCheckoutSummary);
for(const id of ['first_name','last_name','birth_date','contact_email'])$(id).addEventListener('input',()=>{$('checkout-reminder').checked=false;});
// Date entry is displayed by the date helper; a change also covers that control.
$('birth_date').addEventListener('change',()=>{$('checkout-reminder').checked=false;});
$('km16-reuse-apply').addEventListener('click',()=>{$('checkout-reminder').checked=false;});
const draftFields=['first_name','last_name','birth_date','phone','guardian_name','contact_email'];
const draftChecks=['license','terms','privacy','eligibility','installments'];
function resetRegistration(){
 memberCamera.close();
 $('order').reset();photoData='';photoRevision++;photoPreparing=false;requestId=crypto.randomUUID();
 $('photo-preview').removeAttribute('src');$('photo-preview').hidden=true;$('photo-status').textContent='';
 $('birth_date').dispatchEvent(new Event('change'));
 if(selected){$('count').value=String(specialOffer?.count||1);updateSchedule();}
 syncAccountForm();
}
const checkoutAccess=adminPanel?null:createCheckoutAccess({
 client,kind:'membership',host:$('checkout-access'),emailInput:$('contact_email'),
 returnPath:location.pathname+location.search+location.hash,
 getDraft:({manual=false}={})=>({productId:selected.id,reminderSource:stageDetail&&selected.id===requestedProduct&&hasStageAnalyticsConsent()?reminderSource:undefined,requestId,count:Number($('count').value),photo:manual?undefined:photoData,profile:$('purchase-profile').value,fields:Object.fromEntries(draftFields.map(id=>[id,$(id).value])),checks:manual?{}:Object.fromEntries(draftChecks.map(id=>[id,$(id).checked]))}),
 applyDraft:draft=>{
  const product=specialOffer?.product?.id===draft.productId?specialOffer.product:products.find(p=>p.id===draft.productId&&!p.draft&&(!p.event_date||p.event_date>=today()));
  if(!product)throw Error('Cette formule n’est plus proposée. Choisissez une offre disponible.');
  if(stageDetail&&product.id===requestedProduct)reminderSource??=stageReminderSource(draft.reminderSource);
  choose(product,{focus:false});
  if(draft.profile&&householdProfiles.some(profile=>profile.id===draft.profile))$('purchase-profile').value=draft.profile;
  if(/^[0-9a-f-]{36}$/i.test(draft.requestId||''))requestId=draft.requestId;
  for(const id of draftFields){const value=draft.fields?.[id];if(typeof value==='string')$(id).value=value.slice(0,id==='contact_email'?254:160);}
  $('birth_date-display').value=$('birth_date').value;$('birth_date-display').dispatchEvent(new Event('input',{bubbles:true}));
  for(const id of draftChecks)$(id).checked=draft.checks?.[id]===true;
  if([1,3,4].includes(draft.count)&&(product.kind==='annual'||draft.count===1)&&!specialOffer)$('count').value=String(draft.count);
  if(typeof draft.photo==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(draft.photo)&&draft.photo.length<=2000000){photoData=draft.photo;$('photo-preview').src=photoData;$('photo-preview').hidden=false;$('photo-status').textContent='Votre photo a été conservée avec votre demande.';}
  $('birth_date').dispatchEvent(new Event('change'));syncAccountForm();updateSchedule();
  // A saved OTP draft can predate a later opt-out in another tab. Ask again.
  $('checkout-reminder').checked=false;
  note(Number(selected?.amount)===0?'Votre demande a été retrouvée. Vérifiez les informations conservées, puis envoyez votre demande gratuite.':'Votre demande a été retrouvée. Vérifiez les informations conservées, puis continuez vers le paiement.');
  $('selection').scrollIntoView({behavior:'smooth',block:'start'});
  $('chosen').tabIndex=-1;$('chosen').focus({preventScroll:true});
 },
 onVerified:next=>{session=next;syncAccountForm();buttonState();note(Number(selected?.amount)===0?'Votre e-mail est confirmé. Vérifiez puis envoyez votre demande gratuite.':'Votre e-mail est confirmé. Vérifiez votre demande puis continuez vers le paiement.');}
});
$('save-request').onclick=async()=>{
 const button=$('save-request');
 if(!selected)return;
 button.disabled=true;
 try{await checkoutAccess.save();note('Inscription enregistrée sur cet appareil pour une heure.');}
 catch(error){note(error.message,true);}
 finally{button.disabled=false;}
};
$('resume-request').onclick=async()=>{
 const button=$('resume-request');button.disabled=true;
 try{if(session&&!householdProfiles.length)await loadHouseholdProfiles();if(!await checkoutAccess.restore())note('Ce brouillon a expiré ou appartient à un autre compte.',true);}
 finally{button.hidden=true;button.disabled=false;}
};
$('reset-request').onclick=async()=>{await checkoutAccess.clear();resetRegistration();note('Votre demande a été effacée de ce navigateur.');};
$('email-link-login').onsubmit=async event=>{
 event.preventDefault();if(!$('email-link-login').reportValidity())return;
 const button=$('account-email-submit');if(button.disabled)return;button.disabled=true;
 accountMessage('Envoi du lien de connexion…');
 try{if(!client)throw Error('Connexion indisponible');if(requestedOrder)saveOrderLoginReturn(requestedOrder,$('account-email').value);else if(reuseOrder&&(renewalJourney||trialJourney))saveOrderLoginReturn(reuseOrder,$('account-email').value,renewalJourney?'renewal':'trial');const {error}=await accountTimeout(client.auth.signInWithOtp({email:normalizeEmail($('account-email').value),options:{shouldCreateUser:false,emailRedirectTo:'https://app.km16.fr/'}}));if(error)throw error;accountMessage('Si vous avez un espace KM16 à cette adresse, consultez votre boîte e-mail pour vous connecter.');}
 catch(error){accountMessage(error?.status===429?'Un lien a déjà été demandé. Patientez une minute avant de réessayer.':'Le lien n’a pas pu être envoyé. Vérifiez votre adresse puis réessayez.',true);}
 finally{button.disabled=false;}
};
$('logout').onclick=async()=>{
 if(!adminPanel){await checkoutAccess.clear();resetRegistration();}
 const {error}=await client.auth.signOut({scope:'local'});
 if(error)accountMessage('La déconnexion n’a pas abouti. Réessayez.',true);
};
if(adminMfaGate)$('adhesion-admin-mfa-logout').onclick=$('logout').onclick;
$('order').onsubmit=async e=>{
 e.preventDefault();if(busy||photoPreparing||$('member-camera-dialog').open||!selected||!enabled||!$('order').reportValidity())return;
 const controls=[...$('order').querySelectorAll('input,select')].map(element=>({element,disabled:element.disabled}));
 const photoToUpload=photoData;
 const reminderAccountId=session?.user?.id||null;
 for(const {element} of controls)element.disabled=true;
 busy=true;buttonState();note('Préparation de votre demande…');
 const payload={action:'checkout',request_id:requestId,product_id:selected.id,reminder_opt_in:Number(selected.amount)>0&&$('checkout-reminder').checked,...($('purchase-profile').value?{household_id:$('purchase-profile').value}:{}),...(linkToken?{link_token:linkToken}:{}),count:Number($('count').value)};
 for(const id of ['first_name','last_name','birth_date','phone','guardian_name'])payload[id]=$(id).value;
 for(const id of draftChecks)payload[id]=$(id).checked;
 try{
  validateOrder(selected,payload,today());
  if(selected.kind==='annual')void trackMembershipStep('form_completed');
  const verified=await checkoutAccess.ensure();
  if(!verified){note('Consultez votre e-mail pour confirmer cette adresse. Votre demande est conservée.');return;}
  payload.reminder_opt_in=payload.reminder_opt_in&&$('checkout-reminder').checked&&(!reminderAccountId||reminderAccountId===verified.user.id);
  session=verified;syncAccountForm();
  if(photoToUpload)await api({action:'photo-upload',request_id:payload.request_id,photo:photoToUpload},verified.user);
  const r=await api(payload,verified.user);
  if(r.free){await checkoutAccess.clear();note(isFreeTrial(selected.id,selected.amount)?'Votre demande gratuite a été enregistrée dans votre espace KM16. Vous pouvez venir quand vous le souhaitez sur une séance adaptée dans le planning. Présentez-vous à l’enseignant à votre arrivée.':'Votre demande gratuite a été enregistrée dans votre espace KM16. Le club doit la valider.');requestId=crypto.randomUUID();await orders();}
  else{const u=new URL(r.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('Adresse de paiement invalide');await checkoutAccess.clear();if(selected.kind==='annual')await trackMembershipStep('checkout_opened');if(!linkToken&&!embedded)await trackStageCheckout(selected, stageDetail && selected.id===requestedProduct ? reminderSource : undefined);(embedded?window.top:window).location.assign(u.href);}
 }catch(error){note(error.message,true);}finally{for(const {element,disabled} of controls)element.disabled=disabled;busy=false;buttonState();}
};
let myOrderGroup='Tous les achats',myOrderData={orders:[],payments:[],documents:[]};
const orderGroupNames=['Adhésions','Stages','Cours et essais','Équipements','Autres achats'];
function orderGroup(order){
 const product=products.find(p=>p.id===order.product_id);
 if(product){
  if(product.category==='Stages')return 'Stages';
  if(product.kind==='annual'||product.kind==='monthly')return 'Adhésions';
  if(product.category==='Découverte')return 'Cours et essais';
  if(product.category==='Équipement')return 'Équipements';
 }
 const title=String(order.title||'').toLocaleLowerCase('fr');
 if(/stage|préparation ceinture|spécial (combat|bâton|couteau)/.test(title))return 'Stages';
 if(/cours|essai/.test(title))return 'Cours et essais';
 if(/tee.?shirt|équipement/.test(title))return 'Équipements';
 if(/adulte|ados|enfant|adhésion|cotisation|abonnement/.test(title))return 'Adhésions';
 return 'Autres achats';
}
function memberOrderAnchor(order) {
 return order.id === returnedOrder ? 'returned-order' : 'member-order-' + order.id;
}
let householdProfiles=[], memberCourses=null, memberPerson='', firstCourseSessions=null, firstCourseRequest=null;
function participantName(entry){
 return [entry.first_name,entry.last_name].filter(Boolean).join(' ').trim();
}
function participantKey(entry){
 if(entry.household_id)return 'profil:'+entry.household_id;
 return participantName(entry).normalize('NFC').toLocaleLowerCase('fr').replace(/\s+/g,' ');
}
function matchesParticipant(entry){
 return !memberPerson||participantKey(entry)===memberPerson;
}
function renderMemberFamily(){
 if(!accountView)return;
 const people=new Map(householdProfiles.map(profile=>['profil:'+profile.id,profile.label]));
 for(const entry of [...myOrderData.orders.filter(order=>order.livemode===true),...(memberCourses||[])]){
  const key=participantKey(entry);
  if(key&&!entry.household_id)people.set(key,participantName(entry));
 }
 if(!people.has(memberPerson))memberPerson='';
 const select=$('member-person');
 select.replaceChildren(new Option('Tout le foyer',''));
 for(const [key,name] of [...people].sort((a,b)=>a[1].localeCompare(b[1],'fr')))select.add(new Option(name,key));
 select.value=memberPerson;
 const shortcuts=$('member-family-join');shortcuts.replaceChildren();
 for(const profile of householdProfiles){
  const annualOrders=myOrderData.orders.filter(order=>order.livemode===true&&order.household_id===profile.id&&order.approval!=='rejected'&&orderGroup(order)==='Adhésions');
  const seasonStart=myOrderData.season_end?(Number(myOrderData.season_end.slice(0,4))-1)+'-06-01':'';
  if(seasonStart&&annualOrders.some(order=>order.created_at?.slice(0,10)>=seasonStart
   && myOrderData.payments.some(payment=>payment.order_id===order.id&&payment.status==='paid'&&payment.amount_cents>(payment.refunded_cents||0))))continue;
  const previous=myOrderData.orders.find(order=>order.livemode===true&&order.household_id===profile.id&&order.birth_date);
  const birth=profile.birth_date||previous?.birth_date;
  const formula=birth?standardMembership(ageOn(birth,today())):null;
  const row=text('div','',shortcuts,'summary');
  const link=text('a','Inscrire '+profile.label,row);
  link.href='./adhesion.html?profil='+encodeURIComponent(profile.id);
  if(formula)text('p',formula.title+' · '+money(formula.amount)+' hors licence FEKM',row,'muted');
 }
 $('member-family').hidden=!session;
}
$('member-person').onchange=()=>{
 memberPerson=$('member-person').value;
 renderMyOrders();renderMemberActions();renderUpcomingStages();renderUpcomingCourses();renderFirstCourse();
};

async function householdRpc(args={}){
 const {data,error}=await client.rpc('km16_household',args);
 if(error)throw Error(error.message);
 if(!Array.isArray(data))throw Error('Profils indisponibles.');
 return data;
}
function renderPurchaseProfiles(){
 const select=$('purchase-profile'),previous=select.value;
 select.replaceChildren(new Option('Saisir les coordonnées',''));
 for(const profile of householdProfiles)select.add(new Option(profile.label,profile.id));
 select.value=householdProfiles.some(p=>p.id===previous)?previous:'';
 $('purchase-household').hidden=!session||!householdProfiles.length;
}
$('purchase-profile').onchange=()=>{
 const profile=householdProfiles.find(p=>p.id===$('purchase-profile').value);
 const guardian=$('guardian_name').value.trim();
 const parentPhone=guardian?$('phone').value:'';
 const parentEmail=$('contact_email').value;
 if(familyProfile){reusedMember=profile||null;selected=null;$('chosen').textContent='Choisissez une formule pour ce pratiquant.';}
 resetRegistration();
 if(familyProfile){showMembershipJourney();render();}
 if(profile){
  $('purchase-profile').value=profile.id;
  queueMicrotask(()=>{
   if($('purchase-profile').value!==profile.id)return;
   if(profile.birth_date)fillMemberDetails(profile);
   else{
    $('first_name').value=profile.first_name||'';
    $('last_name').value=profile.last_name||'';
    updateCheckoutSummary();
   }
   if(guardian&&(!$('birth_date').value||ageOn($('birth_date').value,today())<18)){
    $('guardian_name').value=guardian;if(parentPhone)$('phone').value=parentPhone;
   }
   if(parentEmail&&!$('contact_email').readOnly)$('contact_email').value=parentEmail;
   updateCheckoutSummary();
  });
 }
};
async function loadHouseholdProfiles(){
 const gen=generation;
 try{
  const profiles=await householdRpc();if(gen!==generation)return;householdProfiles=profiles;renderPurchaseProfiles();
  if(familyProfile&&$('purchase-profile').value===''&&!$('first_name').value&&!$('last_name').value){
   const profile=profiles.find(p=>p.id===familyProfile);
   if(profile){$('purchase-profile').value=profile.id;$('purchase-profile').onchange();}
  }
  if(accountView){renderMemberFamily();renderMyOrders();renderUpcomingCourses();}
 }
 catch{if(gen===generation)$('household-status').textContent='Les profils du foyer sont temporairement indisponibles.';}
}
$('household-form').onsubmit=async event=>{
 event.preventDefault();
 const input=$('household-label'),button=event.submitter,gen=generation;
 if(!session||!input.value.trim())return;
 button.disabled=true;
 try{
  const profiles=await householdRpc({p_label:input.value.trim()});
  if(gen!==generation)return;
  householdProfiles=profiles;input.value='';
  $('household-status').textContent='Profil créé. Vous pouvez lui rattacher un dossier ou un cours.';
  renderMemberFamily();renderMyOrders();renderUpcomingCourses();
 }catch(error){if(gen===generation)$('household-status').textContent=error.message;}
 finally{button.disabled=false;}
};
function appendHouseholdLink(parent,record,kind){
 if(!accountView||!householdProfiles.length)return;
 const details=text('details','',parent);
 text('summary','Profil du pratiquant',details);
 const label=text('label','Rattacher à un profil',details);
 const select=document.createElement('select');
 select.add(new Option('Aucun profil',''));
 for(const p of householdProfiles)select.add(new Option(p.label,p.id));
 select.value=record.household_id||'';
 label.append(select);
 const button=text('button','Enregistrer le profil',details);
 button.type='button';
 const feedback=text('p','',details);feedback.setAttribute('role','status');
 button.onclick=async()=>{
  const profile=select.value||null,gen=generation;
  button.disabled=true;
  try{
   await householdRpc({p_kind:kind,p_record:record.id,p_profile:profile});
   if(gen!==generation)return;
   record.household_id=profile;
   memberPerson='';
   $('household-status').textContent='Rattachement enregistré.';
   renderMemberFamily();renderMyOrders();renderMemberActions();renderUpcomingCourses();renderUpcomingStages();renderFirstCourse();
  }catch(error){if(gen===generation)feedback.textContent=error.message;}
  finally{button.disabled=false;}
 };
}
function firstCourseCategory(product){
 if(product.category==='Enfants')return /^enfants/i;
 if(product.category==='Ados')return /^adolescents/i;
 if(product.category==='Adultes')return /^adultes.*tous niveaux/i;
 return null;
}
async function fetchFirstCourseSessions(){
 if(firstCourseRequest)return;
 const controller=new AbortController();
 firstCourseRequest=controller;
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-course-bookings',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sessions'}),signal:controller.signal,
  });
  const data=await response.json();
  if(firstCourseRequest!==controller)return;
  firstCourseSessions=response.ok&&Array.isArray(data.sessions)?data.sessions:[];
 }catch{
  if(firstCourseRequest!==controller)return;
  firstCourseSessions=[];
 }finally{
  clearTimeout(timer);
  if(firstCourseRequest===controller){firstCourseRequest=null;renderFirstCourse();renderRecommendedMembership();}
 }
}
const parisClock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short',hourCycle:'h23'});
function renderFirstCourse(){
 if(!accountView||!session)return;
 const panel=$('member-first-course'),list=$('member-first-course-list');
 list.replaceChildren();
 panel.hidden=true;
 if(!memberCourses||!myOrderData.season_end||today()>myOrderData.season_end)return;

 const cutoff=new Date();
 cutoff.setUTCDate(cutoff.getUTCDate()-30);
 const seasonStart=(Number(myOrderData.season_end.slice(0,4))-1)+'-06-01';
 const now=parisClock.format(new Date()).replace(' ','T');
 const seen=new Set();
 for(const order of myOrderData.orders){
  if(order.livemode!==true||order.approval==='rejected'||!matchesParticipant(order)
   ||!order.created_at||Date.parse(order.created_at)<cutoff.getTime()||order.created_at.slice(0,10)<seasonStart)continue;
  const product=products.find(p=>p.id===order.product_id&&p.kind==='annual');
  const category=product&&firstCourseCategory(product);
  const key=participantKey(order);
  if(!category||!key||seen.has(key)||memberCourses.some(course=>course.status==='Inscrit'&&participantKey(course)===key))continue;
  seen.add(key);
  panel.hidden=false;
  const card=text('article','',list,'summary');
  text('h3',participantName(order),card);
  const payments=myOrderData.payments.filter(payment=>payment.order_id===order.id);
  const paid=payments.some(p=>p.status==='paid'&&p.amount_cents>(p.refunded_cents||0));
  const docs=myOrderData.documents?.find(d=>d.order_id===order.id);
  if(order.approval!=='approved'||!paid||payments.some(p=>p.status==='disputed')||docs?.health_status==='missing'||docs?.school_required&&docs.school_status==='missing'){
   text('p','Consultez votre dossier pour voir les démarches à terminer avant de venir.',card);
   const details=text('a','Voir mon dossier',card);
   details.href='#'+memberOrderAnchor(order);
   continue;
  }
  text('p','Tenue KM16 : tee-shirt blanc et bas de kimono noir. Consultez la liste des protections avant le cours.',card);
  const outfit=text('a','Voir la tenue et les protections KM16',card);
  outfit.href='./#equipement';
  if(firstCourseSessions===null){text('p','Chargement des prochains cours…',card);void fetchFirstCourseSessions();continue;}
  const upcoming=firstCourseSessions.filter(course=>category.test(course.category)&&course.session_date<=myOrderData.season_end&&course.session_date+'T'+course.start_time.slice(0,5)>now).slice(0,3);
  if(!upcoming.length){const planning=text('a','Consulter le planning',card);planning.href='./#planning';continue;}
  for(const course of upcoming){
   const item=text('div','',card,'summary');
   text('p',[upcomingDate(course.session_date),course.start_time.slice(0,5)+'–'+course.end_time.slice(0,5),course.venue].join(' · '),item);
   const actions=text('div','',item,'row');
   const book=text('a','Réserver',actions);
   book.href=memberBookingUrl(order,course);
   appendDojoDirections(actions,course.venue);
  }
 }
}
function appendOrderHelp(card,order){
 const help=document.createElement('details');
 text('summary','Demander de l’aide à KM16',help);
 const label=text('label','Motif de la demande',help);
 const select=document.createElement('select');
 for(const topic of ['Paiement','Justificatifs ou licence','Inscription ou stage','Autre demande'])select.add(new Option(topic,topic));
 label.append(select);
 const open=text('a','Préparer mon e-mail',help);
 function update(){
  open.href='mailto:contact@km16.fr?subject='+encodeURIComponent('KM16 · '+select.value+' · Dossier '+order.id)
   +'&body='+encodeURIComponent('Bonjour,\n\nJe vous contacte au sujet de mon dossier KM16.\nRéférence : '+order.id+'\nMotif : '+select.value+'\n\nMa question :\n\nMerci,');
 }
 select.onchange=update;
 update();
 card.append(help);
}
function memberBookingUrl(order, course){
 const params=new URLSearchParams();
 if(course)params.set('session',course.id);
 if(order.household_id)params.set('participant',order.household_id);
 const product=products.find(p=>p.id===order.product_id);
 const category=product&&firstCourseCategory(product);
 if(!course&&category){
  params.set('groupe',category.test('Enfants')?'Enfants':category.test('Adolescents')?'Adolescents':'Adultes tous niveaux');
 }
 return './course-booking.html'+(params.size?'?'+params:'');
}
function renderMemberActions() {
 if (!accountView) return;
 const panel = $('member-actions');
 const list = $('member-actions-list');
 const items = document.createDocumentFragment();
 for (const order of myOrderData.orders) {
  if (order.livemode !== true || order.approval === 'rejected' || !matchesParticipant(order)) continue;
  const payments = myOrderData.payments.filter(p => p.order_id === order.id);
  const paid = payments.filter(p => p.status === 'paid')
   .reduce((sum, p) => sum + p.amount_cents - (p.refunded_cents || 0), 0);
  const actions = [];
  const unsettled = payments.some(p => p.status === 'disputed' || p.status === 'refunded' || p.refunded_cents > 0);
  if (unsettled) actions.push('Contacter KM16 au sujet du paiement.');
  else if (paid < order.total_cents && payments.some(p => p.status === 'failed')) {
   actions.push('Vérifier le règlement de l’échéance avec KM16.');
  }

  if (orderGroup(order) === 'Adhésions' && paid > 0 && !unsettled) {
   const docs = myOrderData.documents?.find(d => d.order_id === order.id);
   if(docs){
    if(docs.health_status!=='validated')actions.push({label:docs.health_kind==='attestation'?'Déposer ou suivre mon attestation':'Déposer ou suivre mon certificat',type:'health'});
    actions.push({label:'Déposer ou suivre ma licence',type:'license'});
   }
   if(order.approval==='approved'&&memberCourses&&!memberCourses.some(course=>course.status==='Inscrit'&&participantKey(course)===participantKey(order))){
    actions.push({label:'Voir les prochains cours',href:memberBookingUrl(order)});
   }
   if (docs?.school_required && docs.school_status === 'missing') actions.push('Présenter le justificatif Saint-Jean au club.');
  }
  if(paid>0&&!unsettled&&Array.isArray(myOrderData.photo_order_ids)&&!myOrderData.photo_order_ids.includes(order.id))
   actions.push({label:'Ajouter la photo du pratiquant',photo:true});
  if(myOrderData.trial_attended_ids?.includes(order.id)){
   actions.push({label:'Choisir mon adhésion après l’essai',href:'./adhesion.html?apres_essai=1&essai='+encodeURIComponent(order.id)});
  }
  if (!actions.length) continue;

  const box = document.createElement('article');
  box.className = 'summary';
  const participant = [order.first_name, order.last_name].filter(Boolean).join(' ');
  text('h3', participant ? participant + ' · ' + order.title : order.title, box);
  const steps = text('ul', '', box);
  for (const action of actions) {
   if(typeof action==='string'){text('li',action,steps);continue;}
   const item=text('li','',steps), shortcut=text('a',action.label,item);
   shortcut.href=action.href||'#'+memberOrderAnchor(order)+'-'+(action.photo?'photo':action.type);
   if(action.type||action.photo)shortcut.onclick=event=>{
    event.preventDefault();
    if(myOrderGroup!=='Tous les achats'){myOrderGroup='Tous les achats';renderMyOrders();}
    const target=$(memberOrderAnchor(order)+(action.photo?'-photo':'-documents'));
    if(target){if(action.type)target.dataset.focusType=action.type;target.open=true;($(memberOrderAnchor(order)+'-'+action.type)||target.querySelector('summary')).focus();target.scrollIntoView({block:'start'});}
   };
  }
  const link = text('a', 'Voir le dossier', box);
  link.href = '#' + memberOrderAnchor(order);
  link.onclick = event => {
   event.preventDefault();
   if (myOrderGroup !== 'Tous les achats') {
    myOrderGroup = 'Tous les achats';
    renderMyOrders();
   }
   const target = $(memberOrderAnchor(order));
   target?.focus();
   target?.scrollIntoView({block: 'start'});
  };
  items.append(box);
 }
 if (!items.childNodes.length) text('p', 'Aucune démarche à faire pour le moment.', items);
 list.replaceChildren(items);
 panel.hidden = false;
}
const memberEventDate = new Intl.DateTimeFormat('fr-FR', {dateStyle:'full',timeZone:'Europe/Paris'});
function upcomingDate(date){
 return memberEventDate.format(new Date(date+'T12:00:00Z'));
}
function appendDojoDirections(parent, venue){
 const name=String(venue||'').trim().toLowerCase().replace(/[ -]+/g,' ');
 let address;
 if(name==='suchet'||name==='dojo suchet')address='1 square Henry-Bataille, 75016 Paris';
 if(['st jean','st jean de passy','saint jean de passy'].includes(name))address='72 rue Raynouard, 75016 Paris';
 if(!address)return;
 const link=text('a','Itinéraire',parent);
 const url=new URL('https://www.google.com/maps/dir/');
 url.searchParams.set('api','1');
 url.searchParams.set('destination',address);
 link.href=url.href;
 link.target='_blank';
 link.rel='noopener noreferrer';
 link.setAttribute('aria-label','Itinéraire vers '+address);
}
async function loadUpcomingCourses(){
 const gen=generation;
 const list=$('member-upcoming-courses');
 list.replaceChildren();
 text('p','Chargement des réservations…',list);
 try{
  const {data,error}=await client.rpc('km16_my_course_bookings',{p_cancel:null});
  if(gen!==generation)return;
  if(error||!Array.isArray(data))throw Error('Réservations indisponibles');
  memberCourses=data;renderMemberFamily();renderMemberActions();renderUpcomingCourses();renderFirstCourse();
 }catch{
  if(gen!==generation)return;
  memberCourses=null;
  renderUpcomingCourses();renderFirstCourse();
 }
}
function renderUpcomingCourses(){
 const list=$('member-upcoming-courses');
 list.replaceChildren();
 if(memberCourses){
  for(const course of memberCourses.filter(row=>row.status==='Inscrit'&&row.cancellable&&matchesParticipant(row))){
   const card=text('article','',list,'summary');
   text('strong',[course.first_name,course.last_name].filter(Boolean).join(' '),card);
   text('p',[upcomingDate(course.session_date),course.start_time.slice(0,5)+'–'+course.end_time.slice(0,5),course.venue,course.category,course.session_enabled===false?'Séance annulée par le club':''].filter(Boolean).join(' · '),card);
   const actions=text('div','',card,'row');
   const save=text('button','Ajouter à mon calendrier',actions);
   save.type='button';save.hidden=course.session_enabled===false;
   save.onclick=()=>downloadCourseCalendar(course);
   const link=text('a','Déplacer ou annuler cette réservation',actions);
   link.href='./course-operations.html#booking-'+encodeURIComponent(course.id);
   appendDojoDirections(actions,course.venue);
   appendHouseholdLink(card,course,'course');
  }
  if(!list.childNodes.length)text('p','Aucun cours réservé à venir.',list);
 }else{
  const link=text('a','Consulter mes réservations de cours',list);
  link.href='./course-operations.html';
 }
}
function renderUpcomingStages(){
 if(!accountView)return;
 const list=$('member-upcoming-stages');
 list.replaceChildren();
 const stages=[];
 for(const order of myOrderData.orders){
  if(order.livemode!==true||order.approval==='rejected'||!matchesParticipant(order))continue;
  const stage=products.find(p=>p.id===order.product_id&&p.category==='Stages'&&p.event_date>=today());
  if(!stage)continue;
  const payments=myOrderData.payments.filter(p=>p.order_id===order.id);
  if(payments.some(p=>p.status==='disputed'))continue;
  const paid=payments.filter(p=>p.status==='paid').reduce((sum,p)=>sum+p.amount_cents-(p.refunded_cents||0),0);
  if(order.total_cents===0 ? order.approval!=='approved' : paid<order.total_cents)continue;
  stages.push({stage,order});
 }
 for(const {stage,order} of stages.sort((a,b)=>a.stage.event_date.localeCompare(b.stage.event_date))){
  const card=text('article','',list,'summary');
  text('strong',order.title,card);
  const participant=[order.first_name,order.last_name].filter(Boolean).join(' ');
  text('p',[participant,upcomingDate(stage.event_date),stage.note].filter(Boolean).join(' · '),card);
  const actions=text('div','',card,'row');
  const calendar=stageCalendarFile(stage,order);
  if(calendar){
   const save=text('button','Ajouter à mon calendrier',actions);
   save.type='button';
   save.onclick=()=>downloadCalendar(calendar,'KM16-stage-'+stage.event_date+'.ics');
  }
  appendDojoDirections(actions,stage.note?.split('·').at(-1));
 }
 if(!stages.length)text('p','Aucun stage confirmé à venir.',list);
}
function appendMemberBills(box,order){
 const panel=text('details','',box);
 text('summary','Factures et justificatifs de paiement',panel);
 const list=text('div','',panel);
 panel.addEventListener('toggle',async()=>{
  if(!panel.open||list.childNodes.length)return;
  const status=text('p','Recherche des factures…',list);
  try{
   const {bills}=await api({action:'member-bills',order_id:order.id},session?.user);
   if(!bills.length){status.textContent='Aucune facture émise disponible pour le moment.';return;}
   status.remove();
   for(const bill of bills){
    const line=text('div','',list,'row');
    text('span','Échéance '+bill.installment+' · '+money(Number(bill.amount_cents)),line);
    const download=text('button','Télécharger '+bill.number,line);
    download.type='button';
    download.onclick=async()=>{
     download.disabled=true;
     try{
      const result=await api({action:'member-bill',order_id:order.id,number:bill.number},session?.user);
      const bytes=Uint8Array.from(atob(result.bill.pdf_base64),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
      const link=document.createElement('a');link.href=url;link.download=result.bill.number+'.pdf';
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
     }catch(error){note(error.message,true);}
     finally{download.disabled=false;}
    };
   }
  }catch(error){status.textContent=error.message;}
 });
}
function renderMyOrders(){
 const all=myOrderData.orders.filter(o=>o.livemode===true&&matchesParticipant(o));
 const groups=['Tous les achats',...orderGroupNames.filter(g=>all.some(o=>orderGroup(o)===g))];
 if(!groups.includes(myOrderGroup))myOrderGroup='Tous les achats';
 const filters=$('order-filters');filters.replaceChildren();
 for(const group of groups){
  const count=group==='Tous les achats'?all.length:all.filter(o=>orderGroup(o)===group).length;
  const button=text('button',group+' ('+count+')',filters);button.type='button';
  button.setAttribute('aria-pressed',String(group===myOrderGroup));
  button.onclick=()=>{myOrderGroup=group;renderMyOrders();Array.from(filters.children).find(b=>b.getAttribute('aria-pressed')==='true')?.focus({preventScroll:true});};
 }
 const returningOrder=requestedOrder;
 const visible=all.filter(o=>myOrderGroup==='Tous les achats'||orderGroup(o)===myOrderGroup).sort((a,b)=>Number(b.id===returningOrder)-Number(a.id===returningOrder));
 const focusedCard=$('orders').contains(document.activeElement)?document.activeElement.id:'';
 $('orders').replaceChildren();
 for(const o of visible){
  const box=document.createElement('div');box.className='summary';box.id=memberOrderAnchor(o);box.tabIndex=-1;text('strong',o.title,box);
  if(myOrderData.trial_attended_ids?.includes(o.id)){
   const join=text('a','Choisir mon adhésion',box);
   join.href='./adhesion.html?apres_essai=1&essai='+encodeURIComponent(o.id);
  }
  const renewal=myOrderData.renewal_window;
  const created=o.created_at?.slice(0,10);
  if(renewal&&orderGroup(o)==='Adhésions'&&o.approval==='approved'&&created>=renewal.previous&&created<renewal.opens){
   const link=text('a','Renouveler pour '+([o.first_name,o.last_name].filter(Boolean).join(' ')||'ce pratiquant'),box);
   link.href='./adhesion.html?renouveler='+encodeURIComponent(o.id);
  }
  const payments=myOrderData.payments.filter(p=>p.order_id===o.id);
  const paid=payments.filter(p=>p.status==='paid').reduce((s,p)=>s+p.amount_cents-(p.refunded_cents||0),0);
  if(isFreeTrial(o.product_id,o.total_cents)&&o.approval!=='rejected'){
   if(myOrderData.trial_attended_ids?.includes(o.id))text('p','Cours d’essai effectué.',box);
   else{
    text('p','Cours d’essai offert · Demande enregistrée. Choisissez une séance adaptée au pratiquant et présentez-vous à l’enseignant à votre arrivée.',box);
    const planning=text('a','Choisir ma séance dans le planning',box);planning.href='./#planning';
   }
  }else text('div',money(paid)+' encaissés sur '+money(o.total_cents)+' · Dossier : '+({pending:'en attente de validation',approved:'validé',rejected:'refusé'}[o.approval]),box);
  if(o.approval!=='rejected'&&o.total_cents>0&&o.stripe_session_id&&!payments.some(p=>['paid','refunded','disputed'].includes(p.status))){
   const reminderLabel=text('label','',box,'check');
   const reminder=document.createElement('input');reminder.type='checkbox';reminder.checked=false;
   const reminderText=document.createElement('span');reminderText.textContent='Je souhaite recevoir un seul rappel par e-mail si je ne termine pas ce paiement.';
   reminderLabel.append(reminder,reminderText);
   const resume=text('button','Reprendre le paiement',box);
   resume.type='button';
   const feedback=text('p','',box,'muted');feedback.setAttribute('role','status');
   resume.onclick=async()=>{
    resume.disabled=true;reminder.disabled=true;feedback.textContent='Vérification du paiement…';
    try{
     const result=await api({action:'resume-checkout',order_id:o.id,reminder_opt_in:reminder.checked},session?.user);
     if(result.status==='open'){
      const url=new URL(result.url);
      if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw Error('Adresse de paiement invalide.');
      location.assign(url.href);return;
     }
     feedback.textContent={
      processed:'Stripe a déjà traité cette session. Actualisez le dossier pour voir le statut.',
      expired:'La session Stripe a expiré. Contactez contact@km16.fr pour reprendre ce dossier.',
      unavailable:'Le paiement ne peut pas être repris ici. Contactez contact@km16.fr.',
     }[result.status]||'Le statut du paiement est indisponible.';
    }catch(error){feedback.textContent=error.message;}
    finally{resume.disabled=false;reminder.disabled=false;}
   };
  }
  if(orderGroup(o)==='Stages' && o.approval!=='rejected' && paid>0 && paid>=o.total_cents && !payments.some(p=>p.status==='disputed')){
   text('p','Inscription confirmée',box,'notice');
  }
  if(payments.some(p=>p.status==='failed'))text('div','Échéance non réglée : contactez KM16 pour régulariser.',box);
  if(payments.some(p=>['refunded','disputed'].includes(p.status)))text('div','Paiement remboursé ou en litige. Contactez KM16.',box);
  for(const p of payments)text('div',money(p.amount_cents)+' · '+({paid:'payé',failed:'à régulariser',pending:'en attente',refunded:'remboursé',disputed:'en litige'}[p.status]),box);
  if(myOrderData.photo_order_ids?.includes(o.id)||!myOrderData.photo_order_ids){
  const photoButton=text('button','Voir la photo du dossier',box);photoButton.type='button';photoButton.onclick=async()=>{photoButton.disabled=true;try{const r=await api({action:'photo-view',order_id:o.id});const image=document.createElement('img');image.src=r.url;image.alt='Photo du pratiquant';image.style.cssText='display:block;max-width:160px;max-height:180px;margin-top:12px';box.append(image);photoButton.remove();}catch(e){note(e.message,true);photoButton.disabled=false;}};
  }else if(paid>0&&o.approval!=='rejected'){
   const upload=text('details','',box);upload.id=memberOrderAnchor(o)+'-photo';
   text('summary','Ajouter la photo du pratiquant',upload);
   const form=text('form','',upload), input=text('input','',form);
   input.type='file';input.accept='image/*,.heic,.heif';input.required=true;input.setAttribute('aria-label','Photo du pratiquant');
   const button=text('button','Enregistrer la photo',form);button.type='submit';
   const status=text('p','',form,'muted');status.setAttribute('role','status');
   form.onsubmit=async event=>{
    event.preventDefault();const account=session?.user;
    if(!account)return;
    button.disabled=true;input.disabled=true;status.textContent='Préparation de la photo…';
    try{
     const photo=await preparePhoto(input.files[0]);
     await api({action:'member-photo-add',request_id:o.id,photo},account);
     status.textContent='Photo enregistrée.';await orders();
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;input.disabled=false;}
   };
  }
  if(orderGroup(o)==='Adhésions'&&paid>0&&!payments.some(p=>['disputed','refunded'].includes(p.status))){
   const step=document.createElement('div');step.className='notice';text('strong','Étape obligatoire : votre licence FEKM',step);text('p','Votre règlement KM16 ne comprend pas la licence. Souscrivez-la directement auprès de la FEKM, puis déposez votre justificatif dans votre dossier pour validation par KM16. L’ouverture du site ne prouve pas le paiement de la licence.',step);const a=text('a','Acheter ma licence sur le site FEKM ↗',step);a.href='https://www.krav-maga.net/connexion/';a.target='_blank';a.rel='noopener noreferrer';box.append(step);
  }
  documentSummary(box,(myOrderData.documents||[]).find(d=>d.order_id===o.id),o);
  appendHouseholdLink(box,o,'order');
  if(o.count>1){
   const schedule=text('details','',box);
   text('summary','Voir mon échéancier',schedule);
   text('p','Encaissé : '+money(paid)+' · Reste à régler : '+money(Math.max(0,o.total_cents-paid)),schedule);
   if(o.schedule_id&&paid<o.total_cents){
    const next=text('p','',schedule);next.setAttribute('role','status');
    schedule.addEventListener('toggle',async()=>{
     if(!schedule.open||next.textContent)return;
     next.textContent='Vérification de la prochaine échéance…';
     try{
      const r=await api({action:'member-schedule',order_id:o.id},session?.user);
      next.textContent=r.next_at?'Prochain prélèvement prévu : '+memberEventDate.format(new Date(r.next_at)):'Aucune prochaine date confirmée par Stripe.';
     }catch{next.textContent='Date momentanément indisponible. Actualisez le dossier pour réessayer.';}
    });
   }
  }
  if(payments.some(p=>['paid','refunded'].includes(p.status)))appendMemberBills(box,o);
  appendOrderHelp(box,o);$('orders').append(box);
 }
 if(focusedCard)$(focusedCard)?.focus({preventScroll:true});
 if(!visible.length)text('p','Aucune inscription enregistrée.',$('orders'));
}
function renderKm16Reuse(){const box=$('km16-reuse-member'),select=$('km16-reuse-select');if(!box||!select)return;const candidates=(myOrderData.orders||[]).filter(o=>o.first_name&&o.last_name&&o.birth_date);const seen=new Set();const unique=candidates.filter(o=>{const key=[o.first_name,o.last_name,o.birth_date].join('|').toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});box.hidden=!session||!unique.length;if(box.hidden)return;select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choisir un pratiquant déjà enregistré';select.append(placeholder);unique.forEach((o,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=[o.first_name,o.last_name,o.birth_date].join(' · ');select.append(option);});$('km16-reuse-apply').onclick=()=>{if(!select.value){$('km16-reuse-status').textContent='Choisissez d’abord un dossier.';return;}const o=unique[Number(select.value)];if(!o)return;for(const id of ['first_name','last_name','birth_date','phone','guardian_name']){if(typeof o[id]==='string'&&o[id].trim())$(id).value=o[id].trim();}$('birth_date').dispatchEvent(new Event('change'));$('km16-reuse-status').textContent='Informations reprises. Vérifiez les coordonnées, confirmez les conditions avant de continuer.';};}
let paymentCheckTimer;
let paymentChecks=0;
function showPaymentReturn(order, payments=[], failed=false){
 if(!returnedOrder)return;
 const panel=$('payment-return');
 panel.hidden=false;
 const status=$('payment-return-status');
 const refresh=$('payment-return-refresh');
 const license=$('payment-return-license');
 const ordersLink=$('payment-return-orders');
 license.hidden=true;
 ordersLink.hidden=!order;
 if(order)ordersLink.href='#returned-order';
 refresh.hidden=!session;
 if(!session){status.textContent='Connectez-vous à votre espace KM16 pour vérifier ce paiement.';return;}
 if(failed){status.textContent='Le statut est momentanément indisponible. Réessayez dans un instant.';return;}
 const paid=payments.filter(p=>p.status==='paid').reduce((sum,p)=>sum+p.amount_cents-(p.refunded_cents||0),0);
 if(order?.approval==='rejected'||payments.some(p=>['disputed','refunded','failed'].includes(p.status)||p.refunded_cents>0)){
  status.textContent='Ce dossier ou ce paiement demande une vérification. Consultez votre inscription ou contactez contact@km16.fr.';
 }else if(order&&paid>0&&orderGroup(order)==='Stages'&&paid>=order.total_cents){
  status.textContent='Paiement reçu. Votre inscription au stage est confirmée.';
 }else if(order&&paid>0&&orderGroup(order)==='Adhésions'){
  const payment=paid>=order.total_cents?'Paiement reçu.':'Première échéance reçue.';
  license.hidden=order.approval==='approved';
  status.textContent=payment+(license.hidden?' Votre dossier est validé.':' Souscrivez votre licence FEKM si ce n’est pas encore fait, puis présentez le justificatif au club.');
 }else if(order&&paid>0&&paid>=order.total_cents){
  status.textContent='Paiement reçu. Consultez votre inscription pour connaître l’état du dossier.';
 }else{
  status.textContent='Paiement en cours de vérification. Patientez avant de relancer une inscription.';
  if(paymentChecks<4){
   paymentChecks++;
   paymentCheckTimer=setTimeout(orders,3500);
  }
 }
}
async function orders(){
 clearTimeout(paymentCheckTimer);
 if(!session){showPaymentReturn();return;}
 const gen=generation;
 try{
  const next=await api({action:'orders'});
  if(gen!==generation)return;
  myOrderData=next;renderMemberFamily();renderMyOrders();renderMemberActions();renderUpcomingStages();renderFirstCourse();renderKm16Reuse();
  if(requestedOrder&&!returnedOrder&&!focusedRequestedOrder){
   const target=$('member-order-'+requestedOrder);
   if(target){target.focus();focusedRequestedOrder=true;}
   else note('Cette inscription est introuvable dans le compte connecté.',true);
  }
  const order=next.orders.find(o=>o.id===returnedOrder&&o.livemode===true);
  const returnedPayments=next.payments.filter(p=>p.order_id===returnedOrder);
  showPaymentReturn(order,returnedPayments);
  if(order&&orderGroup(order)==='Adhésions'&&returnedPayments.some(p=>p.status==='paid'&&p.amount_cents>(p.refunded_cents||0))&&hasStageAnalyticsConsent()){
   const key='km16-payment-measured:'+returnedOrder;
   try{if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,'1');void trackMembershipStep('payment_confirmed');}}catch{}
  }
 }catch(e){if(gen===generation){
  if(accountView)$('member-upcoming-stages').textContent='Stages temporairement indisponibles. Utilisez Actualiser pour réessayer.';
  if(returnedOrder)showPaymentReturn(null,[],true);else note(e.message,true);
 }}
}

const docStatus={missing:'Manquant',received:'Reçu — à vérifier',validated:'Validé',not_required:'Non demandé'};
const mailStatus={pending:'Programmé',sending:'En cours',sent:'Accepté par la messagerie',skipped:'Non nécessaire',failed:'Configuration à vérifier',uncertain:'Envoi à vérifier — aucun renvoi automatique'};
const memberDocumentsEndpoint = endpoint.replace(/km16-adhesions$/, 'km16-member-documents');
async function requestMemberDocument(orderId, action, type, file, decision) {
 const active = (await accountTimeout(client.auth.getSession())).data?.session;
 if(!verifiedAccount(active))throw Error('Reconnectez-vous à votre compte KM16.');
 const url = new URL(memberDocumentsEndpoint);
 url.search = new URLSearchParams({action, order: orderId, ...(type ? {type} : {})});
 const response = await fetch(url, {
  method:'POST', headers:{Authorization:'Bearer '+active.access_token,...(file?{'Content-Type':file.type}:decision?{'Content-Type':'application/json'}:{})},
  body:file||(decision?JSON.stringify(decision):undefined), cache:'no-store',
 });
 if(!response.ok)throw Error((await response.json().catch(()=>null))?.error || 'Service de dépôt indisponible.');
 return response;
}
function appendMemberDocuments(parent, order, documents, adminView=false) {
 const details=text('details','',parent);
 if(!adminView)details.id=memberOrderAnchor(order)+'-documents';
 text('summary',adminView?'Fichiers déposés par l’adhérent':'Mes justificatifs',details);
 const status=text('p','',details,'muted');status.setAttribute('role','status');
 const fields=text('div','',details);
 const labels={health:documents.health_kind==='attestation'?'Attestation de santé':'Certificat médical',license:'Licence FEKM'};
 const canUpload=!adminView && order.approval!=='rejected';
 let loaded=false, loading=false;
 const draw=files=>{
  fields.replaceChildren();
  if(canUpload)text('p','PDF, JPEG ou PNG, 5 Mo maximum par pièce.',fields,'muted');
  for(const [type,label] of Object.entries(labels)){
   const group=text('div','',fields,'summary');
   text('strong',label,group);
   const feedback=text('p','',group,'muted');feedback.setAttribute('role','status');
   if(!adminView){group.id=memberOrderAnchor(order)+'-'+type;group.tabIndex=-1;}
   const fileInfo=files[type];
   const labelsByState={missing:'À déposer',received:'Reçu · à vérifier',validated:'Validé',correction:'À corriger'};
   text('p',labelsByState[fileInfo.state],group);
   if(fileInfo.reason)text('p','Motif de correction : '+fileInfo.reason,group);
   if(fileInfo.exists){
    const download=text('button','Télécharger',group);download.type='button';
    download.onclick=async()=>{
     download.disabled=true;feedback.textContent='';
     try{
      const response=await requestMemberDocument(order.id,'download',type);
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');
      link.href=url;link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || type;
      group.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
     }catch(error){feedback.textContent=error.message;}
     finally{download.disabled=false;}
    };
    if(adminView&&!['validated','correction'].includes(fileInfo.state)){
     const controls=text('div','',group,'row');
     const reason=document.createElement('textarea');reason.maxLength=500;reason.placeholder='Motif communiqué à l’adhérent';reason.setAttribute('aria-label','Motif de correction pour '+label);controls.append(reason);
     const validate=text('button','Valider la pièce',controls);validate.type='button';
     const correct=text('button','Demander une correction',controls);correct.type='button';
     async function review(state){
      if(state==='correction'&&!reason.value.trim()){feedback.textContent='Indiquez le motif de correction.';reason.focus();return;}
      validate.disabled=correct.disabled=true;
      try{
       await requestMemberDocument(order.id,'review',type,null,{name:fileInfo.name,state,reason:state==='correction'?reason.value.trim():''});
       await reload();status.textContent='Décision enregistrée dans le dossier.';
      }catch(error){feedback.textContent=error.message;}
      finally{validate.disabled=correct.disabled=false;}
     }
     validate.onclick=()=>review('validated');
     correct.onclick=()=>review('correction');
    }
   }
   if(canUpload&&['missing','correction'].includes(fileInfo.state)){
    const form=text('form','',group);
    const input=document.createElement('input');
    input.type='file';input.accept='application/pdf,image/jpeg,image/png';input.required=true;input.setAttribute('aria-label',label);
    form.append(input);
    const button=text('button','Déposer',form);button.type='submit';
    form.onsubmit=async event=>{
     event.preventDefault();
     const file=input.files[0];
     if(!file)return;
     if(file.size>5*1024*1024){feedback.textContent='Choisissez un fichier de 5 Mo maximum.';return;}
     button.disabled=true;input.disabled=true;feedback.textContent='Envoi en cours…';
     try{
      await requestMemberDocument(order.id,'upload',type,file);
      await reload();status.textContent=label+' : fichier déposé. Vérification par KM16.';
     }catch(error){feedback.textContent=error.message;}
     finally{button.disabled=false;input.disabled=false;}
    };
   }
  }
 };
 async function reload(){
  const response=await requestMemberDocument(order.id,'list');
  draw((await response.json()).files);
  status.textContent='';loaded=true;
  if(details.dataset.focusType)$(memberOrderAnchor(order)+'-'+details.dataset.focusType)?.focus();
 }
 details.ontoggle=async()=>{
  if(!details.open||loaded||loading)return;
  loading=true;status.textContent='Chargement des justificatifs…';
  try{await reload();}
  catch(error){status.textContent=error.message+' Refermez puis rouvrez la rubrique pour réessayer.';}
  finally{loading=false;}
 };
}
function documentSummary(parent,d,order){
 if(!d)return;
 const box=document.createElement('div');box.className='summary';text('strong','Vos justificatifs',box);
 if(d.school_required)text('div','Justificatif Saint-Jean : '+docStatus[d.school_status],box);
 text('p','KM16 vérifie les pièces après leur dépôt. Si un justificatif Saint-Jean est demandé, présente-le au club.',box,'muted');
 appendMemberDocuments(box,order,d);
 parent.append(box);
}
function editDocuments(td,d,o){
 const status=document.createElement('div');status.className='km16-document-status';status.setAttribute('role','status');td.append(status);
 if(!d){status.textContent='Justificatifs non disponibles · vérifier le premier paiement annuel';status.dataset.state='missing';return;}
 appendMemberDocuments(td,o,d,true);
 const describe=(label,value)=>label+' : '+(docStatus[value]||'À vérifier');
 const updateStatus=()=>{const items=[describe('Santé',d.health_status)];if(d.school_required)items.push(describe('Saint-Jean',d.school_status));status.textContent=items.join(' · ');status.dataset.state=d.health_status==='validated'&&(!d.school_required||d.school_status==='validated')?'validated':'pending';};
 const editor=document.createElement('details');editor.className='km16-document-editor';const summary=document.createElement('summary');summary.textContent='Vérifier ou modifier les justificatifs';editor.append(summary);td.append(editor);
 const make=(label,options,value)=>{const l=text('label',label,editor),s=document.createElement('select');s.setAttribute('aria-label',label);for(const [v,t] of options)s.add(new Option(t,v));s.value=value;l.append(s);return s;};
 const states=['missing','received','validated'].map(x=>[x,docStatus[x]]);
 const kind=make('Pièce de santé',[['attestation','Attestation (< 15 ans)'],['certificat','Certificat médical']],d.health_kind);
 try{const at=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(o.consented_at));if(ageOn(o.birth_date,at)>=15)kind.options[0].disabled=true;}catch{}
 const health=make('Réception santé',states,d.health_status);
 const school=d.school_required?make('Justificatif Saint-Jean',states,d.school_status):null;
 updateStatus();
 const b=text('button','Enregistrer les justificatifs',editor);b.type='button';const feedback=text('p','',editor,'muted');const dirty=()=>kind.value!==d.health_kind||health.value!==d.health_status||(school&&school.value!==d.school_status);const updateDirty=()=>{const changed=Boolean(dirty());b.disabled=!changed;td.dataset.unsavedDocuments=changed?'true':'false';feedback.textContent=changed?'Modifications non enregistrées · les statuts affichés restent ceux de la base.':'';};for(const control of [kind,health,school].filter(Boolean))control.addEventListener('change',updateDirty);updateDirty();feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
 b.onclick=async()=>{b.disabled=true;b.textContent='Enregistrement…';feedback.textContent='Enregistrement des justificatifs en cours…';try{await api({action:'documents-update',order_id:d.order_id,revision:d.revision,health_kind:kind.value,health_status:health.value,school_status:school?school.value:'not_required'});d.health_kind=kind.value;d.health_status=health.value;if(school)d.school_status=school.value;d.revision++;updateStatus();updateDirty();feedback.textContent='Justificatifs enregistrés avec succès.';note('Justificatifs enregistrés pour '+o.first_name+' '+o.last_name+'.');await admin();}catch(e){feedback.textContent='Échec : '+e.message;note(e.message,true);}finally{b.disabled=false;b.textContent='Enregistrer les justificatifs';}};
}
const requestedFollowup=new URLSearchParams(location.search).get('followup');if(adminPanel&&['attention','all','sent','uncertain','never','recent','due'].includes(requestedFollowup))$('km16-followup-filter').value=requestedFollowup;
let km16AdminTriage='pending';
const km16TriageButtons=[...document.querySelectorAll('[data-triage]')];
function km16SetTriage(value){km16AdminTriage=value;for(const b of km16TriageButtons)b.setAttribute('aria-pressed',String(b.dataset.triage===value));const rows=[...$('admin-orders').querySelectorAll('tr[data-triage-status]')];let visible=0;for(const row of rows){const status=row.dataset.triageStatus;row.hidden=!(value==='all'||value==='pending'&&status!=='approved'||value==='ready'&&status==='ready'||value==='blocked'&&status==='blocked');if(!row.hidden)visible++;}$('km16-triage-status').textContent=visible+' dossier(s) affiché(s). Les dossiers sont classés pour vérification, sans validation automatique.';}
for(const b of km16TriageButtons)b.onclick=()=>km16SetTriage(b.dataset.triage);
const km16OpenGlobalStatus=(status)=>{if(km16AdminLoading){$('km16-overview-status').textContent='Chargement en cours : réessayez dans un instant.';return;}if(!['all','pending','approved','rejected'].includes(status))return;$('km16-admin-server-approval').value=status;km16AdminServerApproval=status;$('km16-followup-search').value='';km16AdminServerSearch='';$('km16-admin-server-search-status').textContent='Recherche réinitialisée pour afficher tous les dossiers du statut sélectionné.';$('km16-admin-server-filter-status').textContent='Filtre global : '+$('km16-admin-server-approval').selectedOptions[0].textContent+' · chargement en cours…';km16SetTriage('all');$('km16-admin-triage').scrollIntoView({behavior:'smooth',block:'start'});admin(false);};
if(adminPanel)$('km16-overview-review').onclick=()=>km16OpenGlobalStatus('pending');
if(adminPanel)$('km16-overview-approved-action').onclick=()=>km16OpenGlobalStatus('all');
for(const button of document.querySelectorAll('[data-overview-approval]'))button.onclick=()=>km16OpenGlobalStatus(button.dataset.overviewApproval);
if(adminPanel)$('km16-overview-refresh').onclick=async()=>{const button=$('km16-overview-refresh'),status=$('km16-overview-status'),gen=generation;button.disabled=true;status.textContent='Actualisation des indicateurs globaux…';try{const {data,error}=await client.rpc('km16_admin_membership_counts');if(error)throw error;if(gen!==generation)return;const c=Array.isArray(data)?data[0]:data;if(!c)throw Error('Aucun indicateur disponible');for(const key of ['total','pending','approved','rejected'])$('km16-overview-'+key).textContent=Number(c[key]).toLocaleString('fr-FR');$('km16-admin-global-counts').textContent='Saison · '+Number(c.total)+' dossier(s) réels au total · '+Number(c.pending)+' à vérifier · '+Number(c.approved)+' validé(s) · '+Number(c.rejected)+' refusé(s)';status.textContent='Indicateurs globaux mis à jour · '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});}catch(e){if(gen===generation)status.textContent='Actualisation impossible : '+e.message;}finally{button.disabled=false;}};
if(adminPanel)$('km16-admin-diagnostics-run').onclick=async()=>{const button=$('km16-admin-diagnostics-run'),status=$('km16-admin-diagnostics-status'),results=$('km16-admin-diagnostics-results');button.disabled=true;status.textContent='Vérification en lecture seule…';results.replaceChildren();try{const response=await api({action:'admin-diagnostics'});if(response.read_only!==true||!Array.isArray(response.checks))throw Error('Réponse de diagnostic invalide');for(const check of response.checks){const item=document.createElement('p');item.textContent=(check.ok?'✓ ':'✗ ')+check.name+' : '+(check.ok?'Disponible':'Indisponible');results.append(item);}status.textContent=response.checks.every(x=>x.ok)?'Contrôles de lecture réussis · aucune donnée modifiée.':'Un ou plusieurs contrôles ont échoué · aucune donnée modifiée.';}catch(e){status.textContent='Diagnostic indisponible : '+e.message;}finally{button.disabled=false;}};
const km16ActivityRefresh=$('km16-admin-activity-refresh'),km16ActivityMore=$('km16-admin-activity-more');let km16ActivityLoading=false,km16ActivityEntries=[],km16ActivityNextPage=0,km16ActivityHasMore=false,km16ActivityServerSearch='',km16ActivityServerApproval='all';
const km16RenderActivity=()=>{const target=$('km16-admin-activity-list'),status=$('km16-admin-activity-status');const filter=$('km16-admin-activity-filter').value,query=$('km16-admin-activity-search').value.normalize('NFKC').toLocaleLowerCase('fr-FR').trim();const labels={pending:'À vérifier',approved:'Validé',rejected:'Refusé'};const items=km16ActivityEntries.filter(e=>(filter==='all'||e.new_status===filter)&&(!query||[e.order_id,e.actor_email,e.previous_status,e.new_status].join(' ').normalize('NFKC').toLocaleLowerCase('fr-FR').includes(query)));target.replaceChildren();for(const entry of items){const item=document.createElement('div');item.className='km16-activity-entry';item.textContent=new Date(entry.decided_at).toLocaleString('fr-FR')+' · '+(labels[entry.previous_status]||entry.previous_status)+' → '+(labels[entry.new_status]||entry.new_status)+' · '+entry.actor_email+' · dossier '+entry.order_id;target.append(item);}if(!items.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=km16ActivityEntries.length?'Aucune décision ne correspond aux filtres sélectionnés.':'Aucune décision historisée dans les entrées chargées.';target.append(empty);}status.textContent=(km16ActivityServerSearch||km16ActivityServerApproval!=='all'?'Recherche globale active · ':'')+items.length+' décision(s) affichée(s) sur '+km16ActivityEntries.length+' entrée(s) chargée(s)'+(km16ActivityHasMore?' · historique supplémentaire disponible':' · fin de l’historique');$('km16-admin-activity-loaded').textContent=km16ActivityEntries.length+' décision(s) chargée(s)';};
const km16VisibleActivity=()=>{const filter=$('km16-admin-activity-filter').value,query=$('km16-admin-activity-search').value.normalize('NFKC').toLocaleLowerCase('fr-FR').trim();return km16ActivityEntries.filter(e=>(filter==='all'||e.new_status===filter)&&(!query||[e.order_id,e.actor_email,e.previous_status,e.new_status].join(' ').normalize('NFKC').toLocaleLowerCase('fr-FR').includes(query)));};
const km16CheckActivityExport=(entries)=>{if(!entries.length)throw Error('Aucune décision à exporter');const ids=new Set(),dates=[];for(const entry of entries){if(!Number.isSafeInteger(Number(entry.id))||!entry.order_id||!entry.decided_at||!entry.actor_email||!['pending','approved','rejected'].includes(entry.new_status))throw Error('Données de décision incomplètes');if(ids.has(String(entry.id)))throw Error('Décision en double détectée dans la pagination');ids.add(String(entry.id));const ms=Date.parse(entry.decided_at);if(!Number.isFinite(ms))throw Error('Date de décision invalide');dates.push(ms);}const format=ms=>new Date(ms).toLocaleString('fr-FR',{timeZone:'Europe/Paris'});const label=entries.length+' décision(s) vérifiée(s) · période : '+format(dates.reduce((a,b)=>Math.min(a,b)))+' au '+format(dates.reduce((a,b)=>Math.max(a,b)))+' (heure de Paris)';$('km16-admin-activity-export-check').textContent=label;return label;};
const km16DownloadActivityCsv=(entries,suffix='')=>{const csvCell=value=>{let v=String(value??'');if(/^[\s]*[=+@-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};const rows=[['Date et heure (Europe/Paris)','Référence dossier','Ancien statut','Nouveau statut','Administrateur'],...entries.map(e=>[new Date(e.decided_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}),e.order_id,e.previous_status,e.new_status,e.actor_email])];const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='KM16-historique-decisions-'+new Date().toISOString().slice(0,10)+suffix+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
if(adminPanel)$('km16-admin-activity-export').onclick=()=>{const entries=km16VisibleActivity();if(!entries.length){$('km16-admin-activity-status').textContent='Aucune décision chargée ne correspond aux filtres : aucun fichier créé.';return;}try{km16CheckActivityExport(entries);km16DownloadActivityCsv(entries,'-charges');}catch(e){$('km16-admin-activity-export-check').textContent='Export non généré : '+e.message;return;}$('km16-admin-activity-status').textContent=entries.length+' décision(s) exportée(s) parmi les entrées chargées'+(km16ActivityHasMore?' · des pages supplémentaires restent à charger.':'.');};
let km16ActivityExporting=false;
if(adminPanel)$('km16-admin-activity-export-all').onclick=async()=>{if(km16ActivityExporting||km16ActivityLoading)return;const q=$('km16-admin-activity-search').value.trim(),approval=$('km16-admin-activity-filter').value,status=$('km16-admin-activity-status'),button=$('km16-admin-activity-export-all');if(q.length>120||q&&!/^[\p{L}\p{N} @._-]+$/u.test(q)){status.textContent='Recherche invalide : vérifiez les caractères utilisés.';return;}if(!confirm('Exporter toutes les décisions correspondant aux filtres actuels ? Le fichier contiendra des données administratives confidentielles.'))return;km16ActivityExporting=true;button.disabled=true;km16ActivityRefresh.disabled=true;km16ActivityMore.disabled=true;const entries=[];let snapshotId='';try{for(let page=0;page<=100000;page++){status.textContent='Préparation de l’export complet : '+entries.length+' décision(s) récupérée(s)…';const result=await api({action:'admin-recent-decisions',page,search:q,approval,...(snapshotId?{snapshot_id:snapshotId}:{})});if(!snapshotId){snapshotId=String(result.snapshot_id??'');if(!/^(0|[1-9][0-9]{0,18})$/.test(snapshotId))throw Error('Référence de période manquante');}else if(String(result.snapshot_id)!==snapshotId)throw Error('La période de référence a changé pendant l’export');if(!Array.isArray(result.history))throw Error('Réponse du serveur invalide');entries.push(...result.history);if(!result.has_more){if(!entries.length){status.textContent='Aucune décision ne correspond aux filtres : aucun fichier créé.';return;}km16CheckActivityExport(entries);km16DownloadActivityCsv(entries,'-complet');status.textContent='Export complet préparé : '+entries.length+' décision(s) · période figée au début de l’export.';return;}if(!result.history.length)throw Error('Pagination interrompue : résultat incomplet');}throw Error('Historique trop volumineux pour cet export.');}catch(e){status.textContent='Export interrompu, aucun fichier incomplet téléchargé : '+e.message;}finally{km16ActivityExporting=false;button.disabled=false;km16ActivityRefresh.disabled=false;km16ActivityMore.disabled=false;}};
if(adminPanel){$('km16-admin-activity-filter').onchange=km16RenderActivity;$('km16-admin-activity-search').oninput=km16RenderActivity;}
const km16LoadActivity=async(loadMore=false)=>{if(km16ActivityLoading)return;km16ActivityLoading=true;km16ActivityRefresh.disabled=true;km16ActivityMore.disabled=true;const status=$('km16-admin-activity-status');status.textContent=loadMore?'Chargement des décisions suivantes…':'Chargement des dernières décisions…';try{const page=loadMore?km16ActivityNextPage:0;const result=await api({action:'admin-recent-decisions',page,search:km16ActivityServerSearch,approval:km16ActivityServerApproval});const received=Array.isArray(result.history)?result.history:[];km16ActivityEntries=loadMore?[...km16ActivityEntries,...received]:received;km16ActivityNextPage=page+1;km16ActivityHasMore=result.has_more===true;km16ActivityMore.hidden=!km16ActivityHasMore;km16RenderActivity();}catch(e){status.textContent='Journal indisponible : '+e.message;}finally{km16ActivityLoading=false;km16ActivityRefresh.disabled=false;km16ActivityMore.disabled=false;}};
if(adminPanel){km16ActivityRefresh.onclick=()=>km16LoadActivity(false);km16ActivityMore.onclick=()=>km16LoadActivity(true);}
if(adminPanel)$('km16-admin-activity-server-search').onclick=()=>{if(km16ActivityLoading)return;const q=$('km16-admin-activity-search').value.trim();if(q.length>120||q&&!/^[\p{L}\p{N} @._-]+$/u.test(q)){$('km16-admin-activity-status').textContent='Recherche invalide : 120 caractères maximum, lettres, chiffres, espaces, @ . _ et - uniquement.';return;}km16ActivityServerSearch=q;km16ActivityServerApproval=$('km16-admin-activity-filter').value;km16LoadActivity(false);};
if(adminPanel)$('km16-admin-activity-reset').onclick=()=>{if(km16ActivityLoading)return;km16ActivityServerSearch='';km16ActivityServerApproval='all';$('km16-admin-activity-search').value='';$('km16-admin-activity-filter').value='all';km16LoadActivity(false);};
let km16AdminLoaded=null,km16AdminNextPage=0,km16AdminHasMore=false,km16AdminLoading=false,km16AdminServerSearch='',km16AdminServerApproval='all';
const km16HasUnsavedDocuments=()=>Boolean(document.querySelector('#admin-orders [data-unsaved-documents="true"],#km16-followup-inline-body [data-unsaved-documents="true"]'));
const km16ConfirmDiscardDocuments=()=>!km16HasUnsavedDocuments()||confirm('Des modifications de justificatifs ne sont pas enregistrées. Les abandonner et actualiser les dossiers ?');
window.addEventListener('beforeunload',event=>{if(km16HasUnsavedDocuments()){event.preventDefault();event.returnValue='';}});
async function admin(loadMore=false){if(km16AdminLoading)return;if(!km16ConfirmDiscardDocuments())return;km16AdminLoading=true;const gen=generation;const refreshButton=$('admin-refresh'),followupRefresh=$('km16-followup-refresh'),moreButton=$('km16-admin-more');if(refreshButton)refreshButton.disabled=true;if(followupRefresh)followupRefresh.disabled=true;if(moreButton){moreButton.disabled=true;moreButton.textContent=loadMore?'Chargement des dossiers…':'Charger 25 dossiers supplémentaires';}$('km16-followup-status').textContent='Actualisation des dossiers et de leurs historiques…';try{
 const page=loadMore?km16AdminNextPage:0;const result=await api({action:'admin-page',page,page_size:25,search:km16AdminServerSearch,approval:km16AdminServerApproval});if(gen!==generation)return;
 const r=loadMore&&km16AdminLoaded?{orders:[...km16AdminLoaded.orders,...result.orders],payments:[...km16AdminLoaded.payments,...result.payments],documents:[...km16AdminLoaded.documents,...result.documents],mails:[...km16AdminLoaded.mails,...result.mails]}:result;
 km16AdminLoaded=r;if(!loadMore)$('km16-admin-sync-after-decision').hidden=true;km16AdminNextPage=page+1;km16AdminHasMore=result.has_more===true;$('km16-admin-active-filter').textContent='Vue : '+$('km16-admin-server-approval').selectedOptions[0].textContent+(km16AdminServerSearch?' · recherche « '+km16AdminServerSearch+' »':'')+(km16AdminHasMore?' · résultats partiels':'');$('km16-admin-server-filter-status').textContent='Dossiers récupérés : '+$('km16-admin-server-approval').selectedOptions[0].textContent+' · '+r.orders.length+' chargé(s).';
 $('km16-admin-more-wrap').hidden=!km16AdminHasMore;$('km16-admin-loaded').textContent=r.orders.length+' dossier(s) chargé(s)'+(km16AdminServerSearch?' pour « '+km16AdminServerSearch+' »':'')+(km16AdminHasMore?' · autres dossiers disponibles':' · fin de liste');
 const countsLabel=$('km16-admin-global-counts');try{const {data:globalCounts,error:countsError}=await client.rpc('km16_admin_membership_counts');if(countsError)throw countsError;if(gen!==generation)return;const c=Array.isArray(globalCounts)?globalCounts[0]:globalCounts;countsLabel.textContent=c?'Saison · '+Number(c.total)+' dossier(s) réels au total · '+Number(c.pending)+' à vérifier · '+Number(c.approved)+' validé(s) · '+Number(c.rejected)+' refusé(s)':'Totaux globaux indisponibles';if(c){for(const key of ['total','pending','approved','rejected'])$('km16-overview-'+key).textContent=Number(c[key]).toLocaleString('fr-FR');$('km16-overview-status').textContent='Indicateurs globaux mis à jour · '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});}else $('km16-overview-status').textContent='Indicateurs globaux indisponibles';}catch(e){countsLabel.textContent='Totaux globaux indisponibles · les compteurs ci-dessous concernent uniquement les dossiers chargés.';$('km16-overview-status').textContent='Indicateurs indisponibles · consultez les dossiers chargés ci-dessous.';for(const key of ['total','pending','approved','rejected'])$('km16-overview-'+key).textContent='—';console.warn('Totaux adhésions indisponibles',e?.message);}
 const orderIds=r.orders.filter(o=>o.livemode===true).map(o=>o.id);let followups=[],deliveryHistory=[],historyError=false;
 const batches=[];for(let i=0;i<orderIds.length;i+=100)batches.push(orderIds.slice(i,i+100));
 // Trois lots simultanés au maximum : limite la latence sans saturer les RPC Supabase.
 for(let i=0;i<batches.length;i+=3){const results=await Promise.allSettled(batches.slice(i,i+3).map(async ids=>{const [a,b]=await Promise.all([client.rpc('km16_admin_followup_history',{p_order_ids:ids}),client.rpc('km16_admin_followup_delivery_history',{p_order_ids:ids})]);if(a.error)throw a.error;if(b.error)throw b.error;return {followups:a.data||[],deliveries:b.data||[]};}));if(gen!==generation)return;for(const result of results){if(result.status==='fulfilled'){followups.push(...result.value.followups);deliveryHistory.push(...result.value.deliveries);}else{historyError=true;console.warn('Historique des relances incomplet',result.reason?.message||'Erreur réseau');}}}
 const groupByOrder=(items)=>{const map=new Map();for(const item of items||[]){if(!map.has(item.order_id))map.set(item.order_id,[]);map.get(item.order_id).push(item);}return map;};
 const paymentsByOrder=groupByOrder(r.payments),mailsByOrder=groupByOrder(r.mails),followupsByOrder=groupByOrder(followups),deliveryByOrder=groupByOrder(deliveryHistory),documentsByOrder=new Map((r.documents||[]).map(d=>[d.order_id,d]));
 for(const values of followupsByOrder.values())values.sort((a,b)=>Date.parse(b.recorded_at)-Date.parse(a.recorded_at));for(const values of deliveryByOrder.values())values.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const table=document.createElement('table'),head=document.createElement('tr');
 for(const h of ['Pratiquant','Formule','Échéances','Paiement net','Dossier','Justificatifs','E-mails'])text('th',h,head);table.append(head);
 for(const o of r.orders.filter(order=>order.livemode===true)){
  const row=document.createElement('tr');row.id='admin-order-'+o.id;
  const doc=documentsByOrder.get(o.id);const paidPayments=(paymentsByOrder.get(o.id)||[]).filter(p=>p.status==='paid');const netPaid=paidPayments.reduce((sum,p)=>sum+p.amount_cents-(p.refunded_cents||0),0);const paymentIssue=(paymentsByOrder.get(o.id)||[]).some(p=>['failed','disputed','refunded'].includes(p.status));const docsReady=!!doc&&doc.health_status==='validated'&&(!doc.school_required||doc.school_status==='validated');const triage=o.approval==='approved'?'approved':o.approval==='rejected'?'blocked':netPaid>0&&!paymentIssue&&docsReady?'ready':'blocked';row.dataset.triageStatus=triage;
  const decisionSummary=document.createElement('div');decisionSummary.style.cssText='margin:8px 0;padding:9px 11px;background:#f6f4f0;border-radius:8px;font-size:13px';const decisionItems=[];if(o.approval==='approved')decisionItems.push('Dossier administrativement validé');else if(o.approval==='rejected')decisionItems.push('Dossier refusé : examiner avant toute nouvelle décision');else if(netPaid<=0)decisionItems.push('Paiement non confirmé');else if(paymentIssue)decisionItems.push('Incident de paiement à contrôler');else if(!doc)decisionItems.push('Justificatifs à vérifier');else if(doc.health_status!=='validated'||doc.school_required&&doc.school_status!=='validated')decisionItems.push('Justificatifs à valider');else decisionItems.push('Paiement et justificatifs indiqués conformes · validation finale requise');decisionSummary.textContent='Décision : '+decisionItems.join(' · ');
  const triageLabel=document.createElement('small');triageLabel.style.display='block';triageLabel.style.marginTop='6px';triageLabel.textContent=triage==='ready'?'Pièces indiquées validées · contrôle final nécessaire':triage==='blocked'?(!netPaid?'Paiement à vérifier':paymentIssue?'Incident de paiement':!doc?'Justificatifs non disponibles':'Justificatifs à vérifier'):triage==='approved'?'Dossier validé':'Dossier à vérifier';const identity=text('td',o.first_name+' '+o.last_name,row);identity.append(triageLabel,decisionSummary);const detail=document.createElement('details');detail.style.marginTop='6px';const detailTitle=document.createElement('summary');detailTitle.textContent='Photo et détails du dossier';detail.append(detailTitle);identity.append(detail);const photo=text('button','Voir la photo',detail);photo.type='button';photo.onclick=async()=>{try{const r=await api({action:'photo-view',order_id:o.id});const img=document.createElement('img');img.src=r.url;img.alt='Photo du pratiquant';img.style.cssText='display:block;max-width:100px;max-height:120px';detail.append(img);photo.remove();}catch(e){note(e.message,true);}};text('td',(o.livemode?'':'[TEST] ')+o.title,row);text('td',o.count+' fois',row);
  const p=paymentsByOrder.get(o.id)||[];text('td',money(p.filter(x=>x.status==='paid').reduce((s,x)=>s+x.amount_cents-x.refunded_cents,0))+' / '+money(o.total_cents)+(p.some(x=>x.status==='failed')?' · IMPAYÉ':''),row);
  const td=document.createElement('td');const state=text('strong',({pending:'À vérifier',approved:'Validé',rejected:'Refusé'}[o.approval]||'À vérifier'),td);state.style.display='block';state.style.marginBottom='8px';const feedback=text('div','',td,'muted');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const actionSection=(label)=>{const section=document.createElement('section');section.className='km16-dossier-action-section';const heading=document.createElement('strong');heading.textContent=label;section.append(heading);const area=document.createElement('div');area.className='km16-dossier-action-buttons';section.append(area);td.append(section);return area;};
  const controls=actionSection('Décision administrative');const reminderControls=actionSection('Relances et suivi');
  const reasons=[];if(netPaid<=0)reasons.push('Le règlement de votre adhésion reste à vérifier.');if(paymentIssue)reasons.push('Une échéance ou une opération de paiement nécessite une vérification.');if(!doc)reasons.push('Les justificatifs de votre dossier restent à compléter ou à contrôler.');else{if(doc.health_status!=='validated')reasons.push('Le justificatif de santé reste à vérifier.');if(doc.school_required&&doc.school_status!=='validated')reasons.push('Le justificatif Saint-Jean reste à vérifier.');}
  if(o.approval==='pending'&&reasons.length){const email=String(o.email||'').trim();const contact=document.createElement('button');contact.type='button';contact.textContent='Préparer une relance';contact.title='Ouvrir votre messagerie avec un brouillon, sans envoi automatique';reminderControls.append(contact);contact.onclick=()=>{if(!/^[^\\s@<>;,]+@[^\\s@<>;,]+\\.[^\\s@<>;,]+$/.test(email)){feedback.textContent='Adresse e-mail absente ou invalide : vérifier le contact du dossier.';return;}const subject='KM16 · Suivi de votre dossier d’adhésion';const body='Bonjour,\\n\\nNous faisons le point sur le dossier de '+[o.first_name,o.last_name].filter(Boolean).join(' ')+'.\\n\\n'+reasons.join('\\n')+'\\n\\nMerci de consulter votre espace adhérent KM16 : https://app.km16.fr/adhesion.html?espace=1\\n\\nSi vous avez déjà transmis ces éléments, ne tenez pas compte de ce message et contactez-nous si nécessaire.\\n\\nSportivement,\\nL’équipe KM16';const href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);window.location.href=href;feedback.textContent='Brouillon préparé dans votre messagerie. Aucun e-mail envoyé par KM16.';};}

  const approve=document.createElement('button');approve.type='button';approve.textContent='✓ Valider le dossier';approve.style.cssText='background:#187446;color:white;border:0;border-radius:8px;padding:9px 12px;font-weight:700';approve.hidden=o.approval==='approved';controls.append(approve);
  if(o.approval==='pending'&&reasons.length){const send=document.createElement('button');send.type='button';send.textContent='Envoyer depuis KM16';send.title='Envoi direct depuis contact@km16.fr avec journal et anti-doublon';reminderControls.append(send);send.onclick=async()=>{const recipient=String(o.email||'').trim();const subject='KM16 · Suivi de votre dossier d’adhésion';const body='Bonjour,\\n\\nNous faisons le point sur le dossier de '+[o.first_name,o.last_name].filter(Boolean).join(' ')+'.\\n\\n'+reasons.join('\\n')+'\\n\\nMerci de consulter votre espace adhérent KM16 : https://app.km16.fr/adhesion.html?espace=1\\n\\nSi vous avez déjà transmis ces éléments, ne tenez pas compte de ce message et contactez-nous si nécessaire.\\n\\nSportivement,\\nL’équipe KM16';const editor=document.createElement('dialog');editor.style.cssText='max-width:min(620px,94vw);width:94vw;border:1px solid #ddd;border-radius:14px;padding:22px';const title=document.createElement('h3');title.textContent='Vérifier la relance avant envoi';const to=document.createElement('p');to.textContent='Destinataire : '+recipient;const subjectLabel=document.createElement('label');subjectLabel.textContent='Objet';const subjectInput=document.createElement('input');subjectInput.type='text';subjectInput.maxLength=180;subjectInput.value=subject;subjectInput.style.width='100%';subjectLabel.append(subjectInput);const bodyLabel=document.createElement('label');bodyLabel.textContent='Message';const bodyInput=document.createElement('textarea');bodyInput.value=body;bodyInput.maxLength=4000;bodyInput.rows=13;bodyInput.style.cssText='width:100%;font:inherit';bodyLabel.append(bodyInput);const warning=document.createElement('p');warning.className='muted';warning.textContent='Envoi réel depuis contact@km16.fr. Une relance directe maximum par dossier et par jour. Vérifiez les informations avant de confirmer.';const actions=document.createElement('div');actions.className='row';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Annuler';const submit=document.createElement('button');submit.type='button';submit.className='primary';submit.textContent='Confirmer l’envoi';actions.append(cancel,submit);editor.append(title,to,subjectLabel,bodyLabel,warning,actions);document.body.append(editor);cancel.onclick=()=>editor.close();editor.onclose=()=>editor.remove();submit.onclick=async()=>{if(subjectInput.value.trim().length<5||bodyInput.value.trim().length<30){warning.textContent='Complétez l’objet et le message avant l’envoi.';return;}if(!confirm('Confirmer l’envoi réel à '+recipient+' ?'))return;submit.disabled=true;send.disabled=true;feedback.textContent='Envoi en cours…';try{const {data:{session:current}}=await client.auth.getSession();if(!current)throw Error('Session expirée');const response=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-membership-followup-send',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'send',order_id:o.id,subject:subjectInput.value.trim(),body:bodyInput.value.trim()})});const result=await response.json();if(!response.ok)throw Error(result.error||'Envoi indisponible');feedback.textContent=result.message||'Résultat à vérifier';if(result.status==='accepted'){send.textContent='E-mail accepté';await admin();}}catch(e){feedback.textContent='Envoi non confirmé : '+e.message;}finally{send.disabled=false;editor.close();}};if(typeof editor.showModal==='function')editor.showModal();else editor.setAttribute('open','');};}
  const followupBox=document.createElement('div');followupBox.className='muted';followupBox.style.marginTop='8px';const history=followupsByOrder.get(o.id)||[];const delivery=(deliveryByOrder.get(o.id)||[])[0];const last=history[0];followupBox.textContent=last?'Dernière relance confirmée : '+new Date(last.recorded_at).toLocaleDateString('fr-FR')+' · '+history.length+' au journal':'Aucune relance confirmée dans le journal';td.append(followupBox);if(delivery){const status=document.createElement('div');status.className='muted';status.textContent='Envoi KM16 : '+({accepted:'Accepté par OVH',failed:'Échec confirmé',uncertain:'À vérifier avant renvoi',sending:'En cours / à vérifier'}[delivery.state]||'À vérifier')+' · '+new Date(delivery.created_at).toLocaleString('fr-FR');td.append(status);}
  const confirmSent=document.createElement('button');confirmSent.type='button';confirmSent.textContent='Marquer l’e-mail comme envoyé';confirmSent.title='À utiliser uniquement après avoir envoyé le message depuis votre messagerie';confirmSent.style.marginTop='6px';reminderControls.append(confirmSent);confirmSent.onclick=async()=>{if(!confirm('Confirmez-vous avoir réellement envoyé un e-mail de relance à '+o.first_name+' '+o.last_name+' ? Ouvrir un brouillon ne suffit pas.'))return;confirmSent.disabled=true;try{const {data,error}=await client.rpc('km16_admin_record_followup',{p_order_id:o.id,p_note:'Envoi confirmé manuellement par l’administrateur'});if(error)throw error;followupBox.textContent='Dernière relance confirmée : '+new Date(data).toLocaleString('fr-FR')+' · Journal mis à jour';feedback.textContent='Relance enregistrée dans le journal.';}catch(e){feedback.textContent='Journal indisponible : '+e.message;}finally{confirmSent.disabled=false;}};
  const historyPanel=document.createElement('details');historyPanel.className='km16-decision-history';const historyTitle=document.createElement('summary');historyTitle.textContent='Historique des décisions';const historyContent=document.createElement('div');historyContent.className='muted';historyContent.textContent='Ouvrir pour consulter les décisions enregistrées.';const historyRefresh=document.createElement('button');historyRefresh.type='button';historyRefresh.textContent='Actualiser l’historique';historyRefresh.style.margin='8px 0';historyPanel.append(historyTitle,historyRefresh,historyContent);td.append(historyPanel);const loadDecisionHistory=async()=>{historyContent.textContent='Chargement de l’historique…';try{const result=await api({action:'admin-decision-history',order_id:o.id});historyContent.replaceChildren();if(!result.history?.length){historyContent.textContent='Aucune décision historisée depuis l’activation du journal.';return;}const labels={pending:'À vérifier',approved:'Validé',rejected:'Refusé'};for(const entry of result.history){const line=document.createElement('p');line.textContent=new Date(entry.decided_at).toLocaleString('fr-FR')+' · '+(labels[entry.previous_status]||entry.previous_status)+' → '+(labels[entry.new_status]||entry.new_status)+' · '+entry.actor_email;historyContent.append(line);}}catch(e){historyContent.textContent='Historique indisponible : '+e.message;}};historyRefresh.onclick=loadDecisionHistory;historyPanel.addEventListener('toggle',()=>{if(historyPanel.open)loadDecisionHistory();});
  const select=document.createElement('select');select.setAttribute('aria-label','Autre décision pour '+o.first_name+' '+o.last_name);for(const [v,t] of [['','Autre décision…'],['pending','Remettre à vérifier'],['rejected','Refuser le dossier']])select.add(new Option(t,v));controls.append(select);
  async function decide(value){if(value===o.approval)return;if(!confirm((value==='approved'?'Valider administrativement':value==='rejected'?'Refuser':'Remettre à vérifier')+' le dossier de '+o.first_name+' '+o.last_name+' ?')){select.value='';return;}approve.disabled=true;select.disabled=true;feedback.textContent='Enregistrement…';try{await api({action:'approve',order_id:o.id,approval:value});o.approval=value;state.textContent=({pending:'À vérifier',approved:'Validé',rejected:'Refusé'}[value]);approve.hidden=value==='approved';feedback.textContent='Décision enregistrée.';decisionSummary.textContent='Décision : '+(value==='approved'?'Dossier administrativement validé':value==='rejected'?'Dossier refusé : examiner avant toute nouvelle décision':'Dossier à vérifier · contrôle administratif requis');triageLabel.textContent=value==='approved'?'Dossier validé':value==='rejected'?'Dossier refusé':'Dossier à vérifier';if(historyPanel.open){void loadDecisionHistory();}else historyContent.textContent='Nouvelle décision enregistrée · ouvrez pour consulter l’historique.';if(o.livemode===true)void $('km16-overview-refresh').click();if($('km16-admin-activity').getBoundingClientRect().height>0)void km16LoadActivity();note('Dossier de '+o.first_name+' '+o.last_name+' : '+state.textContent+'.');row.dataset.triageStatus=value==='approved'?'approved':value==='rejected'?'blocked':netPaid>0&&!paymentIssue&&docsReady?'ready':'blocked';km16SetTriage(km16AdminTriage);const followupRow=[...$('km16-followup-list').querySelectorAll('tr[data-order-id]')].find(item=>item.dataset.orderId===o.id);if(followupRow?.children[1])followupRow.children[1].textContent=state.textContent;$('km16-admin-sync-after-decision').hidden=false;$('km16-admin-server-filter-status').textContent='Décision enregistrée. Actualisez les listes pour appliquer les filtres et la pagination à jour.';}catch(e){feedback.textContent='Erreur : '+e.message;note(e.message,true);}finally{approve.disabled=false;select.disabled=false;select.value='';}}
  approve.onclick=()=>decide('approved');select.onchange=()=>{if(select.value)decide(select.value);};row.append(td);
  const docs=document.createElement('td');editDocuments(docs,documentsByOrder.get(o.id),o);row.append(docs);
  const mails=document.createElement('td');for(const m of mailsByOrder.get(o.id)||[])text('div',(m.kind==='initial'?'Demande':'Relance J+7')+' : '+mailStatus[m.status]+(m.sent_at?' · '+new Date(m.sent_at).toLocaleString('fr-FR'):''),mails);row.append(mails);table.append(row);
 }
 const followupHost=$('km16-followup-list'),followupStatus=$('km16-followup-status');const summaryRows=r.orders.filter(o=>o.livemode===true).map(o=>{const deliveries=deliveryByOrder.get(o.id)||[];const manual=followupsByOrder.get(o.id)||[];return {o,delivery:deliveries[0]||null,manual:manual[0]||null};});
 const latestFollowup=({delivery,manual})=>[delivery?.created_at,manual?.recorded_at].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
 let inlineReturn=null,inlineVisible=[],followupPage=0;const followupPageSize=25;const closeInline=()=>{if(inlineReturn?.row?.querySelector('[data-unsaved-documents="true"]')&&!confirm('Des modifications de justificatifs ne sont pas enregistrées. Les abandonner et quitter ce dossier ?'))return false;if(inlineReturn){const {row,parent,next}=inlineReturn;if(parent?.isConnected)parent.insertBefore(row,next?.parentNode===parent?next:null);inlineReturn=null;}$('km16-followup-inline-body').replaceChildren();$('km16-followup-position').textContent='';$('km16-followup-inline').hidden=true;return true;};$('km16-followup-inline-close').onclick=closeInline;closeInline();
 const renderFollowupCenter=()=>{if(!closeInline())return;const filter=$('km16-followup-filter').value;const query=$('km16-followup-search').value.normalize('NFKC').toLocaleLowerCase('fr-FR').trim();followupHost.replaceChildren();const filtered=summaryRows.filter(({o,delivery,manual})=>(!query||[o.first_name,o.last_name,o.email].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('fr-FR').includes(query))&&(filter==='all'||filter==='sent'&&(delivery?.state==='accepted'||!!manual)||filter==='uncertain'&&['uncertain','sending','failed'].includes(delivery?.state)||filter==='attention'&&(o.approval==='pending'||['uncertain','sending','failed'].includes(delivery?.state))||filter==='never'&&o.approval==='pending'&&!delivery&&!manual||filter==='recent'&&o.approval==='pending'&&!!latestFollowup({delivery,manual})&&Date.now()-Date.parse(latestFollowup({delivery,manual}))<7*86400000||filter==='due'&&o.approval==='pending'&&!['uncertain','sending'].includes(delivery?.state)&&!!latestFollowup({delivery,manual})&&Date.now()-Date.parse(latestFollowup({delivery,manual}))>=7*86400000));const totalPages=Math.max(1,Math.ceil(filtered.length/followupPageSize));followupPage=Math.min(followupPage,totalPages-1);const pageRows=filtered.slice(followupPage*followupPageSize,(followupPage+1)*followupPageSize);inlineVisible=pageRows.map(x=>x.o.id);$('km16-followup-page-prev').disabled=followupPage===0;$('km16-followup-page-next').disabled=followupPage>=totalPages-1;$('km16-followup-page-status').textContent='Page '+(followupPage+1)+' / '+totalPages+' · '+filtered.length+' dossier(s)';const t=document.createElement('table');const h=document.createElement('tr');for(const name of ['Adhérent','Dossier','Dernière relance','Statut e-mail','Action'])text('th',name,h);t.append(h);if(!filtered.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=km16AdminHasMore?'Aucun résultat parmi les dossiers chargés. Lancez « Rechercher dans tous les dossiers » pour consulter le serveur.':'Aucun dossier ne correspond à cette recherche ou à ce filtre.';followupHost.append(empty);}for(const {o,delivery,manual} of pageRows){const tr=document.createElement('tr');tr.dataset.orderId=o.id;text('td',[o.first_name,o.last_name].filter(Boolean).join(' '),tr);text('td',({pending:'À vérifier',approved:'Validé',rejected:'Refusé'}[o.approval]||'À vérifier'),tr);const date=[delivery?.created_at,manual?.recorded_at].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];text('td',date?new Date(date).toLocaleString('fr-FR'):'Aucune relance connue',tr);text('td',delivery?({accepted:'Accepté par OVH',failed:'Échec confirmé',uncertain:'À vérifier',sending:'En cours / à vérifier'}[delivery.state]||delivery.state):manual?'Envoi confirmé manuellement':'Non contacté dans ce journal',tr);const td=document.createElement('td');const button=document.createElement('button');button.type='button';button.textContent='Traiter ici';button.onclick=()=>{if(!closeInline())return;km16SetTriage('all');const target=$('admin-order-'+o.id);if(!target)return;const parent=target.parentNode,next=target.nextSibling;inlineReturn={row:target,parent,next};const index=inlineVisible.indexOf(o.id);$('km16-followup-prev').disabled=index<=0;$('km16-followup-next').disabled=index<0||index>=inlineVisible.length-1;const holder=document.createElement('table');const headings=document.createElement('tr');const labels=['Pratiquant','Formule','Échéances','Paiement net','Dossier','Justificatifs','E-mails'];for(const label of labels){const th=document.createElement('th');th.textContent=label;headings.append(th);}for(const [index,cell] of [...target.children].entries()){if(cell.tagName==='TD')cell.dataset.label=labels[index]||'Détails';}holder.append(headings,target);$('km16-followup-inline-body').replaceChildren(holder);$('km16-followup-position').textContent=index>=0?'Dossier '+(index+1)+' sur '+inlineVisible.length:'';$('km16-followup-inline-title').textContent='Traitement · '+[o.first_name,o.last_name].filter(Boolean).join(' ');$('km16-followup-inline').hidden=false;$('km16-followup-inline').scrollIntoView({behavior:'smooth',block:'start'});};td.append(button);tr.append(td);for(const [index,cell] of [...tr.children].entries()){cell.dataset.label=['Adhérent','Dossier','Dernière relance','Statut e-mail','Action'][index]||'Information';}t.append(tr);}if(filtered.length)followupHost.append(t);followupStatus.textContent=pageRows.length+' dossier(s) sur cette page · '+filtered.length+' résultat(s) parmi '+summaryRows.length+' dossier(s) chargés'+(km16AdminHasMore?' · Liste partielle : chargez les dossiers suivants pour rechercher dans les autres.':'')+(historyError?' · Attention : historique des envois partiellement indisponible.':' · Derniers envois enregistrés uniquement.');};
 const navigateInline=delta=>{const current=inlineReturn?.row?.id?.replace('admin-order-','');const index=inlineVisible.indexOf(current);const id=inlineVisible[index+delta];if(!id)return;const row=[...followupHost.querySelectorAll('tr')].find(tr=>tr.dataset.orderId===id);row?.querySelector('button')?.click();};$('km16-followup-prev').onclick=()=>navigateInline(-1);$('km16-followup-next').onclick=()=>navigateInline(1);
 $('km16-followup-page-prev').onclick=()=>{if(followupPage>0){followupPage--;renderFollowupCenter();}};$('km16-followup-page-next').onclick=()=>{followupPage++;renderFollowupCenter();};
 $('km16-followup-search').oninput=()=>{followupPage=0;renderFollowupCenter();};
 $('km16-admin-sync-after-decision').onclick=()=>admin(false);
 $('km16-admin-more').onclick=()=>admin(true);
 $('km16-admin-clear-filters').onclick=()=>{if(km16AdminLoading)return;km16AdminServerApproval='all';km16AdminServerSearch='';$('km16-admin-server-approval').value='all';$('km16-followup-search').value='';$('km16-followup-filter').value='attention';km16SetTriage('all');$('km16-admin-server-search-status').textContent='Recherche effacée';$('km16-admin-server-filter-status').textContent='Filtres réinitialisés';admin(false);};
 $('km16-admin-server-apply').onclick=()=>{km16AdminServerApproval=$('km16-admin-server-approval').value;$('km16-admin-server-filter-status').textContent='Filtre global : '+$('km16-admin-server-approval').selectedOptions[0].textContent+' · seuls les dossiers correspondants seront chargés.';admin(false);};
 $('km16-admin-server-search-button').onclick=()=>{const q=$('km16-followup-search').value.trim();if(q&&!/^[\\p{L}\\p{N} @._'\\-]+$/u.test(q)){$('km16-admin-server-search-status').textContent='Utilisez uniquement des lettres, chiffres, espaces et caractères usuels des noms ou e-mails.';return;}km16AdminServerSearch=q;$('km16-admin-server-search-status').textContent=q?'Recherche globale : '+q:'Tous les dossiers';followupPage=0;admin(false);};
 $('km16-admin-server-search-reset').onclick=()=>{km16AdminServerSearch='';$('km16-followup-search').value='';$('km16-admin-server-search-status').textContent='Tous les dossiers';followupPage=0;admin(false);};
 $('km16-followup-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('km16-admin-server-search-button').click();}};
 $('km16-followup-filter').onchange=()=>{followupPage=0;renderFollowupCenter();};$('km16-followup-refresh').onclick=()=>admin(false);renderFollowupCenter();
 $('admin-orders').replaceChildren(table);
 const rows=[...table.querySelectorAll('tr[data-triage-status]')];const counts={pending:0,ready:0,blocked:0,all:rows.length};for(const row of rows){const state=row.dataset.triageStatus;if(state!=='approved')counts.pending++;if(state==='ready')counts.ready++;if(state==='blocked')counts.blocked++;}for(const key of Object.keys(counts))$('km16-triage-'+key).textContent=String(counts[key]);km16SetTriage(km16AdminTriage);if(km16AdminHasMore)$('km16-triage-status').textContent+=' Résultats partiels : chargez les dossiers suivants pour compléter les totaux et les filtres.';
 const target=new URLSearchParams(location.search).get('admin_order');
 if(target){const selected=[...table.querySelectorAll('tr[id]')].find(row=>row.id==='admin-order-'+target);if(selected){km16SetTriage('all');selected.style.cssText='outline:3px solid #b31c28;background:#fff5f4;scroll-margin-top:24px';selected.scrollIntoView({block:'center',behavior:'smooth'});}}
}catch(e){if(gen===generation){note(e.message,true);$('km16-followup-status').textContent='Actualisation impossible : '+e.message;}}finally{if(gen===generation){if(refreshButton)refreshButton.disabled=false;if(followupRefresh)followupRefresh.disabled=false;if(moreButton){moreButton.disabled=false;moreButton.textContent='Charger 25 dossiers supplémentaires';}km16AdminLoading=false;}}}
function clearMemberFirstCourse(){
 firstCourseRequest?.abort();firstCourseRequest=null;firstCourseSessions=null;
 memberCourses=null;memberPerson='';householdProfiles=[];renderPurchaseProfiles();
 $('member-first-course').hidden=true;$('member-first-course-list').replaceChildren();
 $('member-family').hidden=true;$('member-person').replaceChildren(new Option('Tout le foyer',''));
}
async function restoreAdmin(s){
 const token=s?.access_token;
 if(adminSessionToken===token)return;
 adminSessionToken=token;
 session=s;
 const currentGeneration=++generation;
 km16AdminLoading=false;
 const status=$('admin-access-status');
 adminPanel.hidden=true;
 $('admin-orders').replaceChildren();
 $('links-list').replaceChildren();
 $('link-result').hidden=true;
 $('link-url').value='';
 $('link-email').value='';
 km16AdminLoaded=null;
 km16AdminNextPage=0;
 km16AdminHasMore=false;
 km16AdminServerSearch='';
 km16AdminServerApproval='all';
 $('km16-admin-server-approval').value='all';
 $('account-access').hidden=!!s;
 $('connected').hidden=!s;
 $('identity').textContent=s?.user.email||'';
 accountMessage('');
 if(!s){
  resetAdhesionMfa?.();
  status.textContent='Connectez-vous pour accéder aux dossiers.';
  return;
 }
 status.textContent='Vérification de l’accès administrateur…';
 try{
  const access=await api({action:'admin-access'},s.user);
  if(currentGeneration!==generation)return;
  if(access.admin!==true)throw Error('Accès réservé à l’administration KM16.');
  const {data,error}=await accountTimeout(client.auth.mfa.getAuthenticatorAssuranceLevel(token));
  if(currentGeneration!==generation)return;
  if(error)throw error;
  if(data?.currentLevel!=='aal2'){
   status.textContent='';
   if(adminMfaGate.hidden){adminMfaGate.hidden=false;adminMfaGate.open=true;}
   return;
  }
  resetAdhesionMfa?.();
  status.textContent='';
  adminPanel.hidden=false;
  initLinks();
  const target=$(location.hash.slice(1));
  target?.scrollIntoView();
  await Promise.all([admin(),listLinks()]);
 }catch(error){
  if(currentGeneration!==generation)return;
  resetAdhesionMfa?.();
  adminSessionToken=null;
  status.textContent=error.message||'Accès administratif indisponible. Rechargez la page pour réessayer.';
 }
}
async function authState(s){
 s=accountSession(s);
 if(adminPanel){
  session=s;
  if(catalogueReady)await restoreAdmin(s);
  return;
 }
 const previous=session;
 const enteredEmail=normalizeEmail($('contact_email').value);
 const identityChanged=previous&&previous.user.id!==s?.user.id;
 const differentEmail=!previous&&s&&enteredEmail&&enteredEmail!==normalizeEmail(s.user.email);
 session=s;
 generation++;
 if(identityChanged||differentEmail){clearMemberFirstCourse();$('membership-recommendation').replaceChildren();reusedMember=null;trialReuseAttempt='';await checkoutAccess.clear();resetRegistration();if(differentEmail)note('Une autre adresse a été confirmée. Renseignez la demande pour le compte affiché ou déconnectez-vous.',true);}
 km16AdminLoaded=null;km16AdminNextPage=0;km16AdminHasMore=false;km16AdminServerSearch='';km16AdminServerApproval='all';
 syncAccountForm();checkoutAccess.sync(s);$('login').hidden=!!s;$('connected').hidden=!s;$('identity').textContent=s?.user.email||'';$('my-orders').hidden=!s;
 showMembershipJourney();
 buttonState();

 if(!s){
  clearMemberFirstCourse();
  clearTimeout(paymentCheckTimer);showPaymentReturn();
  $('member-upcoming').hidden=true;$('member-upcoming-courses').replaceChildren();$('member-upcoming-stages').replaceChildren();
  $('member-actions').hidden=true;$('member-actions-list').replaceChildren();
  myOrderGroup='Tous les achats';myOrderData={orders:[],payments:[],documents:[]};$('km16-reuse-member').hidden=true;$('order-filters').replaceChildren();$('orders').replaceChildren();
  return;
 }
 if(accountView){
  $('member-upcoming').hidden=false;
  if(!$('member-upcoming-stages').childNodes.length)text('p','Chargement des stages…',$('member-upcoming-stages'));
  void loadUpcomingCourses();
 }
 void loadHouseholdProfiles();
 if(!catalogueReady&&!accountView)return;await orders();
}
$('payment-return-refresh').onclick=orders;
$('payment-return-orders').onclick=()=>{if(myOrderGroup!=='Tous les achats'){myOrderGroup='Tous les achats';renderMyOrders();}};
$('refresh').onclick=()=>{if(accountView&&session){firstCourseSessions=null;void loadUpcomingCourses();}return orders();};if(adminPanel)$('admin-refresh').onclick=()=>admin(false);

function initLinks(){
 const current=$('link-category').value;
 $('link-category').replaceChildren();
 for(const c of [...new Set(eligibleProducts(products,today()).map(p=>p.category))])$('link-category').add(new Option(c,c));
 if([...$('link-category').options].some(o=>o.value===current))$('link-category').value=current;
 linkOptions();
}
function linkOptions(){
 const current=$('link-product').value;$('link-product').replaceChildren();
 for(const p of eligibleProducts(products,today()).filter(p=>p.category===$('link-category').value))$('link-product').add(new Option(p.title,p.id));
 if([...$('link-product').options].some(o=>o.value===current))$('link-product').value=current;
 linkPrice();
}
function linkPrice(){
 const p=products.find(p=>p.id===$('link-product').value);$('link-standard').value=p?money(p.amount):'';$('link-amount').value=p?(p.amount/100).toFixed(2).replace('.',','):'';
 $('link-count').value='1';for(const o of $('link-count').options)o.disabled=p?.kind!=='annual'&&o.value!=='1';linkSchedule();
}
function linkSchedule(){try{const n=Number($('link-count').value),a=splitAmount(parseEuro($('link-amount').value),n);$('link-schedule').textContent=n===1?'Un règlement de '+money(a[0]):'Premier règlement : '+money(a[0])+', puis '+(n-1)+' mensualités de '+money(a[1])+'. Total : '+money(a.reduce((s,x)=>s+x,0));}catch{$('link-schedule').textContent='Saisissez un montant en euros.';}}
if(adminPanel){$('link-category').onchange=linkOptions;$('link-product').onchange=linkPrice;$('link-count').onchange=linkSchedule;$('link-amount').oninput=linkSchedule;}
if(adminPanel)$('link-form').onsubmit=async e=>{
 e.preventDefault();const gen=generation;$('link-create').disabled=true;$('link-status').textContent='Création du lien…';$('link-result').hidden=true;$('link-url').value='';
 try{
  const r=await api({action:'links-create',product_id:$('link-product').value,total_cents:parseEuro($('link-amount').value),count:Number($('link-count').value),recipient_email:$('link-email').value.trim()});
  if(gen!==generation)return;
  $('link-url').value=r.url;$('link-result').hidden=false;$('link-expiry').textContent=(r.livemode?'':'TEST · ')+"Ouverture du paiement jusqu’au "+new Date(r.expires_at).toLocaleString('fr-FR')+'. Un seul dossier peut utiliser ce lien.';
  $('link-status').textContent='Lien créé. Copiez-le avant de quitter cette page. Les paiements restent soumis à l’ouverture des inscriptions.';await listLinks();
 }catch(e){if(gen===generation)$('link-status').textContent=e.message;}finally{$('link-create').disabled=false;}
};
if(adminPanel)$('link-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('link-url').value);$('link-status').textContent='Lien copié.';}catch{$('link-url').select();$('link-status').textContent='Sélectionnez le lien puis copiez-le avec Cmd+C.';}};
if(adminPanel)$('links-refresh').onclick=listLinks;
async function listLinks(){const gen=generation;try{
 const {links}=await api({action:'links-list'});if(gen!==generation)return;
 const table=document.createElement('table'),h=document.createElement('tr');for(const label of ['Offre / payeur','Tarif','Règlement','État','Action'])text('th',label,h);table.append(h);
 for(const l of links){const tr=document.createElement('tr');text('td',(l.livemode?'':'[TEST] ')+(products.find(p=>p.id===l.product_id)?.title||l.product_id)+' · '+l.recipient_email,tr);text('td',money(l.total_cents)+' au lieu de '+money(l.standard_cents),tr);text('td',l.count+' fois',tr);const expired=Date.parse(l.expires_at)<=Date.now();text('td',l.order_id?'Associé à un dossier (paiement à vérifier)':l.revoked_at?'Annulé':expired?'Expiré':'Disponible jusqu’au '+new Date(l.expires_at).toLocaleDateString('fr-FR'),tr);const td=document.createElement('td');if(!l.order_id&&!l.revoked_at&&!expired){const b=text('button','Annuler le lien',td);b.type='button';b.onclick=async()=>{b.disabled=true;try{await api({action:'links-revoke',id:l.id});await listLinks();}catch(e){$('link-status').textContent=e.message;b.disabled=false;}};}tr.append(td);table.append(tr);}
 $('links-list').replaceChildren(table);
 }catch(e){if(gen===generation)$('link-status').textContent=e.message;}}

if(adminMfaGate){
 const {initAdminMfa}=await import('./admin-mfa.mjs?v=enrollment-20261123');
 resetAdhesionMfa=initAdminMfa(client?.auth,adminMfaGate,{login:true});
}
if(client){
 client.auth.onAuthStateChange((_event,s)=>{const revision=++accountRevision;setTimeout(()=>{if(revision===accountRevision)void authState(s).catch(()=>accountMessage('Les informations du compte sont temporairement indisponibles.',true));},0);});
 void restoreAccount();
 window.addEventListener('pageshow',()=>void restoreAccount());
 window.addEventListener('storage',event=>{if(event.key==='km16-video-auth')void restoreAccount();});
}else accountMessage('Connexion indisponible. Rechargez la page pour réessayer.',true);
syncAccountForm();showMembershipJourney();
if(returnedOrder){showPaymentReturn();$('payment-return-title').focus();}

try{
 const fallback=await fetch('./catalogue.json').then(r=>r.json());products=fallback;category=categoryFor(requestedCategory);render();
 try{const c=await api({action:'catalogue'});products=c.products;stageCatalogueLoaded=true;enabled=c.enabled;for(const [id,value] of [['terms-link',c.terms_url],['privacy-link',c.privacy_url]]){try{const u=new URL(value);if(u.protocol==='https:')$(id).href=u.href;}catch{enabled=false;}}$('opening').textContent=enabled?'Inscriptions ouvertes · Paiement en 1, 3 ou 4 fois pour les cotisations annuelles.':'Les paiements en ligne ne sont pas encore ouverts.';render();
 if(stageDetail&&reminderSource&&!linkToken){
  const stage=products.find(p=>p.id===requestedProduct&&!p.draft&&!p.review&&p.event_date>=today());
  if(stage)trackStageReminderVisit(stage,reminderSource);
 }
 if(requestedProduct==='essai'&&!linkToken){const trial=products.find(p=>p.id==='essai'&&!p.draft);if(trial)choose(trial);}
 if(requestedStageDate&&!linkToken){const matches=products.filter(p=>p.category==='Stages'&&!p.draft&&p.event_date===requestedStageDate&&p.event_date>=today());if(matches.length===1)choose(matches[0]);else note('Ce stage n’est pas ouvert au paiement en ligne. Choisissez un autre stage disponible ou contactez contact@km16.fr.',true);}}catch{$('opening').textContent='Le paiement est temporairement indisponible.';note('Vérifiez votre connexion puis rechargez la page pour réessayer.',true);}
 if(linkToken){
  try{specialOffer=await api({action:'link-preview',link_token:linkToken});$('offer-notice').hidden=false;$('offer-notice').textContent='Votre offre personnalisée : '+specialOffer.product.title+' · '+money(specialOffer.product.amount)+' · '+specialOffer.count+' fois, sans supplément. Utilisez l’e-mail du payeur indiqué à KM16 dans votre demande.';choose(specialOffer.product);}
  catch(e){$('offer-notice').hidden=false;$('offer-notice').textContent=e.message;$('order').hidden=true;selected=null;}
 }
 catalogueReady=true;if(!accountView&&!adminPanel){if(await checkoutAccess.resumeAvailable())$('resume-request').hidden=false;else await checkoutAccess.restore();}checkoutAccess?.sync(session);if(session||adminPanel)void authState(session).catch(()=>accountMessage('Les informations du compte sont temporairement indisponibles.',true));
 if(paymentReturn.has('cancel'))note(requestedOrder?'Paiement interrompu. Vous pouvez vérifier et reprendre le paiement depuis ce dossier.':'Vous avez quitté le paiement. Consultez Mes inscriptions avant de recommencer.');
}catch{note('Chargement impossible. Rechargez la page ou contactez contact@km16.fr.',true);}
if(adminPanel&&!catalogueReady){
 catalogueReady=true;
 void authState(session);
}

if(embedded){window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='km16-payment-category')return;category=categoryFor(event.data.category);render();});document.dispatchEvent(new Event('km16-payment-ready'));parent.postMessage({type:'km16-payment-ready',enabled},location.origin);}
