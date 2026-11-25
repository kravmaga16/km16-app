const section = document.getElementById('tarifs');
const host = document.getElementById('payment-console-host');
const status = document.getElementById('payment-console-status');

if (section && host && status) {
 let frame;
 let loadingTimer;
 const unavailable = 'Les inscriptions en ligne sont momentanément indisponibles. Contactez contact@km16.fr.';

 function load(category = '') {
  if (frame) return;
  frame = document.createElement('iframe');
  frame.id = 'payment-console-frame';
  frame.allow = 'camera';
  frame.title = 'Console d’inscription et de paiement KM16';
  frame.src = './adhesion.html?embed=1&categorie=' + encodeURIComponent(category);
  frame.style.cssText = 'display:block;width:100%;height:950px;border:0;border-radius:14px;background:#f5f4f1';
  frame.referrerPolicy = 'same-origin';
  status.textContent = 'Chargement de la console d’inscription…';
  loadingTimer = setTimeout(() => {
   status.textContent = 'La console tarde à répondre. Utilisez le lien « S’inscrire en ligne » pour ouvrir le formulaire.';
  }, 12000);
  host.append(frame);
 }

 function check() {
  if (section.classList.contains('active') && !section.hidden) load();
  else frame?.contentWindow?.postMessage({type:'km16-payment-hidden'}, location.origin);
 }

 document.addEventListener('click', event => {
  const link = event.target.closest('a[data-payment-category]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const category = link.dataset.paymentCategory;
  if (frame) frame.contentWindow?.postMessage({type:'km16-payment-category', category}, location.origin);
  else load(category);
  host.closest('#payment-console')?.scrollIntoView({behavior:'smooth', block:'start'});
 });

 window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
  const data = event.data;
  if (data?.type === 'km16-payment-ready' && typeof data.enabled === 'boolean') {
   clearTimeout(loadingTimer);
   status.textContent = data.enabled ? '' : unavailable;
  }
  if (data?.type === 'km16-payment-height' && Number.isFinite(data.height) && data.height > 0) {
   frame.style.height = Math.min(18000, Math.max(450, Math.ceil(data.height))) + 'px';
  }
 });
 new MutationObserver(check).observe(section, {attributes:true, attributeFilter:['class','hidden']});
 window.addEventListener('hashchange', check);
 check();
}
