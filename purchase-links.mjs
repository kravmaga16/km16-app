export function parseEuro(value){
 const s=String(value).trim();if(!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(s))throw Error('Saisissez un prix en euros avec deux décimales maximum.');
 const [euros,cents='']=s.replace(',','.').split('.');return Number(euros)*100+Number(cents.padEnd(2,'0'));
}
export function eligibleProducts(products,today){return products.filter(p=>!p.draft&&p.category!=='Interne'&&p.kind!=='monthly'&&p.amount>=50&&(!p.event_date||p.event_date>=today));}
