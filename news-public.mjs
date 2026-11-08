import {appendImage} from './news-image.mjs';
const target=document.querySelector('[data-live="actualites"]');
if(target){
 let busy=false,timer;
 function prune(){for(const card of target.querySelectorAll('[data-expires-at]'))if(Date.parse(card.dataset.expiresAt)<=Date.now())card.remove();}
 function arm(){clearTimeout(timer);const next=Math.min(...[...target.querySelectorAll('[data-expires-at]')].map(card=>Date.parse(card.dataset.expiresAt)).filter(time=>time>Date.now()));if(Number.isFinite(next))timer=setTimeout(()=>{prune();arm();},Math.min(Math.max(1,next-Date.now()),2147483647));}
 async function refresh(){
  prune();arm();if(busy||document.hidden)return;busy=true;
  try{
   const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/rest/v1/km16_news?select=id,title,body,published_at,expires_at,image_path&order=published_at.desc&limit=30',{headers:{apikey:'sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn'},cache:'no-store'});
   if(!r.ok)throw Error('news');
   const rows=await r.json();if(!Array.isArray(rows))throw Error('news');
   const cards=rows.filter(row=>!row.expires_at||Date.parse(row.expires_at)>Date.now()).map(row=>{const card=document.createElement('article');card.id='news-'+row.id;if(row.expires_at)card.dataset.expiresAt=row.expires_at;card.className='card';const h=document.createElement('h3');h.textContent=row.title;const p=document.createElement('p');p.textContent=row.body;p.style.whiteSpace='pre-wrap';const date=document.createElement('small');date.textContent=new Date(row.published_at).toLocaleDateString('fr-FR');card.append(h,date);appendImage(card,row.image_path,row.title);card.append(p);return card;});
   target.replaceChildren(...cards);arm();target.querySelector('[data-news-error]')?.remove();
   const box=document.querySelector('.club-news');if(box)box.hidden=true;
  }catch{
   if(!target.children.length){const p=document.createElement('p');p.dataset.newsError='';p.textContent='Les actualités sont momentanément indisponibles.';target.append(p);}
  }finally{busy=false;}
 }
 refresh();setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);window.addEventListener('focus',refresh);
}
