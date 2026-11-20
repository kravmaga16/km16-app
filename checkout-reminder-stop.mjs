const button=document.getElementById('stop');
const status=document.getElementById('status');
const fragment=location.hash.slice(1);
const token=/^[a-f0-9]{64}$/i.test(fragment)?fragment.toLowerCase():null;
// Keep the capability out of the address bar, referrers and subsequent links.
history.replaceState(null,'',location.pathname+location.search);

if(!token){
  status.textContent='Ce lien est incomplet ou invalide. Ouvrez le lien de désinscription figurant dans votre e-mail de rappel.';
  button.hidden=true;
}else button.disabled=false;

button.onclick=async()=>{
  if(!token||button.disabled)return;
  button.disabled=true;
  status.textContent='Enregistrement de votre choix…';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-checkout-reminders',{
      method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',
      signal:controller.signal,body:JSON.stringify({action:'unsubscribe',token})
    });
    const result=await response.json();
    if(!response.ok||result?.ok!==true)throw Error('unsubscribe_failed');
    status.textContent='Les rappels de paiement sont désactivés pour votre adresse.';
    button.hidden=true;
  }catch{
    status.textContent='Votre choix n’a pas pu être enregistré. Réessayez, ou contactez contact@km16.fr.';
    button.disabled=false;
  }finally{clearTimeout(timer);}
};
