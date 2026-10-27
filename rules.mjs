export function splitAmount(total, count) {
 if (!Number.isSafeInteger(total) || total < 0 || ![1,3,4].includes(count)) throw Error('Échéancier invalide');
 const regular=Math.floor(total/count);
 return [regular+total%count,...Array(count-1).fill(regular)];
}
export function monthAfter(timestamp) {
 const d=new Date(timestamp*1000),day=d.getUTCDate();
 d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 d.setUTCDate(Math.min(day,last));return Math.floor(d.getTime()/1000);
}
export function ageOn(birth, date) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||new Date(birth+'T12:00:00Z').toISOString().slice(0,10)!==birth) throw Error('Date de naissance invalide');
 let age=Number(date.slice(0,4))-Number(birth.slice(0,4));
 if(date.slice(5)<birth.slice(5))age--;return age;
}
export function validateOrder(product, data, today) {
 if(!product || product.draft)throw Error('Cette offre n’est pas ouverte');
 if(product.event_date&&product.event_date<today)throw Error('Cet événement est passé');
 const n=Number(data.count);if(![1,3,4].includes(n)||(product.kind!=='annual'&&n!==1))throw Error('Choix de paiement invalide');
 if(!String(data.first_name||'').trim()||!String(data.last_name||'').trim()||String(data.first_name).length>80||String(data.last_name).length>80)throw Error('Nom et prénom requis');
 const age=ageOn(data.birth_date,today);
 if(age<0||age>110||product.min_age!=null&&age<product.min_age||product.max_age!=null&&age>product.max_age)throw Error('L’âge ne correspond pas à cette formule : contactez KM16');
 if(age<18&&!String(data.guardian_name||'').trim())throw Error('Représentant légal requis pour un mineur');
 if(!/^\+?[\d ().-]{8,25}$/.test(String(data.phone||'')))throw Error('Téléphone invalide');
 if(data.terms!==true||data.license!==true||data.privacy!==true||n>1&&data.installments!==true||product.review&&data.eligibility!==true)throw Error('Veuillez compléter les confirmations');
 return {count:n,amounts:splitAmount(product.amount,n),age};
}
