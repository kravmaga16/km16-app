const section=document.getElementById('tarifs'),host=document.getElementById('payment-console-host'),status=document.getElementById('payment-console-status');
if(section&&host){
 let frame=null,category='Tous';
 const group=value=>{const s=String(value||'').toLowerCase();return s.includes('adulte')?'Adultes':s.includes('enfant')?'Enfants':s.includes('ado')?'Ados':'Tous';};
 function send(){frame?.contentWindow?.postMessage({type:'km16-payment-category',category},location.origin);}
 function load(){if(frame)return;frame=document.createElement('iframe');frame.id='payment-console-frame';frame.title='Console d’inscription et de paiement KM16';frame.src='./adhesion.html?embed=1&categorie='+encodeURIComponent(category);frame.style.cssText='display:block;width:100%;height:950px;border:0;border-radius:14px;background:#f5f4f1';frame.setAttribute('referrerpolicy','same-origin');frame.onload=send;host.append(frame);status.textContent='Chargement de la console d’inscription…';}
 function check(){if(section.classList.contains('active'))load();}
 document.addEventListener('click',event=>{const link=event.target.closest('a[data-payment-category]');if(!link)return;event.preventDefault();category=group(link.dataset.paymentCategory);load();send();document.getElementById('payment-console').scrollIntoView({behavior:'smooth',block:'start'});});
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;const data=event.data;if(data?.type==='km16-payment-ready'){status.textContent='';if(typeof data.enabled==='boolean')document.getElementById('payment-legacy').hidden=data.enabled;send();}if(data?.type==='km16-payment-height'&&Number.isFinite(data.height)&&data.height>0){frame.style.height=Math.min(18000,Math.max(450,Math.ceil(data.height)))+'px';}});
 new MutationObserver(check).observe(section,{attributes:true,attributeFilter:['class','hidden']});window.addEventListener('hashchange',check);check();
}
