const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function parisInput(iso){
 if(!iso)return '';
 const parts=Object.fromEntries(fmt.formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
}
export function parisInstant(input){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input))throw Error('Renseigne une date et une heure de publication.');
 const candidates=['+01:00','+02:00'].map(offset=>new Date(input+':00'+offset)).filter(d=>Number.isFinite(d.getTime())&&parisInput(d.toISOString())===input);
 if(candidates.length!==1)throw Error('Cette heure est ambiguë ou inexistante lors du changement d’heure. Choisis une autre heure.');
 return candidates[0].toISOString();
}
