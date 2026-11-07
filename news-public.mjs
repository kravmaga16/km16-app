const target=document.querySelector('[data-live="actualites"]');
if(target){
 let busy=false;
 const prune=()=>{const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());for(const card of target.querySelectorAll('[data-expires]'))if(card.dataset.expires<today)card.remove();};
 async function refresh(){
  prune();if(busy||document.hidden)return;busy=true;
  try{
   const r=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/rest/v1/km16_news?select=id,title,body,published_at,expires_on&order=published_at.desc&limit=30',{headers:{apikey:'sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn'},cache:'no-store'});
   if(!r.ok)throw Error('news');
   const rows=await r.json();if(!Array.isArray(rows))throw Error('news');
   const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const cards=rows.filter(row=>!row.expires_on||row.expires_on>=today).map(row=>{const card=document.createElement('article');card.id='news-'+row.id;if(row.expires_on)card.dataset.expires=row.expires_on;card.className='card';const h=document.createElement('h3');h.textContent=row.title;const p=document.createElement('p');p.textContent=row.body;p.style.whiteSpace='pre-wrap';const date=document.createElement('small');date.textContent=new Date(row.published_at).toLocaleDateString('fr-FR');card.append(h,date,p);return card;});
   target.replaceChildren(...cards);target.querySelector('[data-news-error]')?.remove();
   const box=document.querySelector('.club-news');if(box)box.hidden=true;
  }catch{
   if(!target.children.length){const p=document.createElement('p');p.dataset.newsError='';p.textContent='Les actualités sont momentanément indisponibles.';target.append(p);}
  }finally{busy=false;}
 }
 refresh();setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);
}
