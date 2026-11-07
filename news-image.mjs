const base='https://tlfewpbgbwesdriklxzb.supabase.co/storage/v1/object/public/km16-news-images/';
export const imageURL=path=>/^news\/[0-9a-f-]{36}\.jpg$/.test(path||'')?base+path:null;
export function appendImage(parent,path,title){
 const url=imageURL(path);if(!url)return;
 const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label','Agrandir l’image : '+title);
 const img=document.createElement('img');img.src=url;img.alt='Illustration : '+title;img.loading='lazy';img.decoding='async';
 img.style.cssText='display:block;width:100%;max-height:650px;object-fit:contain;margin:16px 0;border-radius:8px';
 img.onerror=()=>a.remove();a.append(img);parent.append(a);
}
export async function prepareImage(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880)throw Error('Choisis une image JPG, PNG ou WebP de moins de 5 Mo.');
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=url;await img.decode();
  if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>40000000)throw Error('Image trop grande.');
  const ratio=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Préparation de l’image impossible');
  ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
  if(!blob||blob.size>5242880)throw Error('Préparation de l’image impossible');
  return blob;
 }finally{URL.revokeObjectURL(url);}
}
