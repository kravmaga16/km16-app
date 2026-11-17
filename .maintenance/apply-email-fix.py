from pathlib import Path
import hashlib

root = Path.cwd()
m = (root / 'adhesion.mjs').read_text()
h = (root / 'adhesion.html').read_text()
for name, expected in [('adhesion.mjs','ace853602b0aeee0681f8df1714b34ba5af5b49f'),('adhesion.html','09b97e19c623d939ab9898204ca47fce923f45ca')]:
    data = (root / name).read_bytes()
    actual = hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if actual != expected:
        raise SystemExit('Source changed; refusing to patch: '+name)

def change(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Unexpected source: '+old[:100])
    return text.replace(old,new)

h=change(h,'<form id="login"><label for="email">E-mail</label>', '<p id="account-status" class="muted" role="status" aria-live="polite"></p><form id="login"><label for="email">Adresse e-mail du compte</label>')
h=change(h,'<button class="primary full">Me connecter</button></form>', '<button class="primary full" id="login-submit" type="submit">Me connecter</button></form>')
h=change(h,'<p id="chosen">Sélectionnez une offre à gauche.</p><form id="order" hidden>', '<p id="chosen">Sélectionnez une offre à gauche.</p><div id="account-required" class="notice" hidden><p>Pour continuer cette inscription, connectez-vous avec votre adresse e-mail. Elle sera automatiquement reprise dans votre dossier.</p><button type="button" id="account-required-login">Saisir mon e-mail et me connecter</button></div><form id="order" hidden>')
h=change(h,'<input id="contact_email" type="email" required readonly autocomplete="email"><p class="muted">Adresse confirmée de votre compte. Pour un mineur, utilisez le compte de son représentant légal.</p>', '<input id="contact_email" type="email" readonly autocomplete="email" aria-describedby="contact-email-help"><p class="muted" id="contact-email-help">Adresse du compte connecté, renseignée automatiquement. Pour utiliser une autre adresse, changez de compte ci-dessus. Pour un mineur, utilisez le compte de son représentant légal.</p>')
h=change(h,'./adhesion.mjs?v=admin-diagnostics-20261116','./adhesion.mjs?v=email-flow-20261117')

helper='''// Account restoration must not wait for the remote catalogue or order history.
let accountRevision=0,accountLoginBusy=false;
const accountSession=s=>s?.user?.email?.trim()&&!s.user.is_anonymous?s:null;
function accountMessage(message,error=false){const target=$('account-status');target.textContent=message;target.className=error?'error':'muted';}
function syncAccountForm(){
 const ready=!!accountSession(session);
 $('contact_email').value=ready?session.user.email.trim():'';
 $('order').hidden=!selected||!ready;
 $('account-required').hidden=!selected||ready;
 $('login-submit').textContent=accountLoginBusy?'Connexion…':selected?'Me connecter et continuer':'Me connecter';
}
function focusAccount(){
 $('account').scrollIntoView({behavior:'smooth',block:'start'});
 $('email').focus({preventScroll:true});
 accountMessage('Saisissez votre e-mail et votre mot de passe pour continuer.');
}
function accountTimeout(promise){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('La connexion ne répond pas. Réessayez.')),15000);})]).finally(()=>clearTimeout(timer));
}
$('account-required-login').onclick=focusAccount;
async function restoreAccount(){
 if(!client){accountMessage('Connexion indisponible. Rechargez la page pour réessayer.',true);return;}
 const revision=accountRevision;
 try{const {data,error}=await accountTimeout(client.auth.getSession());if(revision!==accountRevision)return;if(error)throw error;await authState(data.session);}
 catch{if(revision===accountRevision)accountMessage('Votre connexion n’a pas pu être rétablie. Connectez-vous ci-dessous.',true);}
}
'''
m=change(m,"function buttonState(){ $('pay').disabled=busy||!session||!enabled||!selected||selected.draft;",helper+"function buttonState(){ $('pay').disabled=busy||!accountSession(session)||!enabled||!selected||selected.draft;")
m=change(m,"$('chosen').textContent=p.title;$('order').hidden=false;", "$('chosen').textContent=p.title;syncAccountForm();")
m=change(m,"updateSchedule();$('selection').scrollIntoView({behavior:'smooth',block:'start'});}","updateSchedule();if(accountSession(session))$('selection').scrollIntoView({behavior:'smooth',block:'start'});else focusAccount();}")
old=next(x for x in m.splitlines() if x.startswith("$('login').onsubmit="))
new="""$('login').onsubmit=async e=>{
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
  void authState(next).catch(()=>accountMessage('Connexion réussie. L’historique est temporairement indisponible.',true));
  accountMessage('Vous êtes connecté. Vous pouvez poursuivre votre inscription.');
  if(selected){$('selection').scrollIntoView({behavior:'smooth',block:'start'});$('first_name').focus({preventScroll:true});}
 }catch(error){
  const message=error?.code==='email_not_confirmed'?'Confirmez votre adresse avec le lien reçu par e-mail, puis reconnectez-vous.':error?.status===429?'Trop de tentatives. Réessayez dans quelques minutes.':'Connexion impossible. Vérifiez votre e-mail, votre mot de passe et votre connexion, puis réessayez.';
  accountMessage(message,true);
 }finally{$('password').value='';accountLoginBusy=false;$('login-submit').disabled=false;syncAccountForm();}
};"""
m=change(m,old,new)
m=change(m,"e.preventDefault();if(busy||!session||!selected||!enabled)return;busy=true;", "e.preventDefault();if(!accountSession(session)){syncAccountForm();focusAccount();return;}if(busy||!selected||!enabled)return;busy=true;")
m=change(m,'async function authState(s){generation++;','async function authState(s){s=accountSession(s);generation++;')
m=change(m,"session=s;$('login').hidden=!!s;", "session=s;syncAccountForm();$('login').hidden=!!s;")
m=change(m," if(client){client.auth.onAuthStateChange((_e,s)=>setTimeout(()=>authState(s),0));const {data}=await client.auth.getSession();await authState(data.session);}", " // Authentication is initialized independently, before catalogue loading.")
anchor="try{\n const fallback=await fetch('./catalogue.json')"
startup="""if(client){
 client.auth.onAuthStateChange((_event,s)=>{const revision=++accountRevision;setTimeout(()=>{if(revision===accountRevision)void authState(s).catch(()=>accountMessage('Les informations du compte sont temporairement indisponibles.',true));},0);});
 void restoreAccount();
 window.addEventListener('pageshow',()=>void restoreAccount());
 window.addEventListener('storage',event=>{if(event.key==='km16-video-auth')void restoreAccount();});
}else accountMessage('Connexion indisponible. Rechargez la page pour réessayer.',true);
syncAccountForm();

try{
 const fallback=await fetch('./catalogue.json')"""
m=change(m,anchor,startup)
(root/'adhesion.mjs').write_text(m)
(root/'adhesion.html').write_text(h)
print('Applied verified account-flow patch to adhesion.html and adhesion.mjs only.')
