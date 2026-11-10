// Photos are decoded and redrawn locally: no original file or EXIF is uploaded.
let decoder;
async function heicDecoder(){
 if(!decoder)decoder=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./vendor/heic2any-0.0.4.min.js';s.onload=()=>resolve(window.heic2any);s.onerror=()=>{decoder=null;reject(Error('Conversion iPhone indisponible. Réessayez ou choisissez une photo JPEG.'));};document.head.append(s);});
 return decoder;
}
export async function preparePhoto(file){
 if(!file||!file.size)throw Error('Ajoutez une photo du pratiquant.');
 if(file.size>25*1024*1024)throw Error('La photo doit faire moins de 25 Mo.');
 if(/svg|xml/i.test(file.type)||/\.svgz?$/i.test(file.name))throw Error('Choisissez une photographie, pas un fichier SVG.');
 let source=file,bitmap;
 const decode=async blob=>{const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();return img;}finally{URL.revokeObjectURL(url);}};
 try{bitmap=await decode(source);}catch{
  if(!/heic|heif/i.test(file.type+' '+file.name))throw Error('Format non lisible. Choisissez une photo JPEG, PNG, WebP, GIF, AVIF ou HEIC/HEIF.');
  const convert=await heicDecoder();source=await convert({blob:file,toType:'image/jpeg',quality:.85});bitmap=await decode(Array.isArray(source)?source[0]:source);
 }
 if(bitmap.width<100||bitmap.height<100)throw Error('La photo doit mesurer au moins 100 × 100 pixels.');
 const ratio=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 const url=canvas.toDataURL('image/jpeg',.85);if(url.length>2000000)throw Error('Photo trop volumineuse après conversion. Choisissez une autre photo.');return url;
}
