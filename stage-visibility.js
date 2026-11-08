(() => {
 const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 function local(instant){const p=Object.fromEntries(fmt.formatToParts(new Date(instant)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
 function day(value){
  const text=String(value||'').trim();let y,m,d,match=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/);
  if(match)[,y,m,d]=match;else{match=text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);if(!match)return null;[,d,m,y]=match;}
  const result=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  const date=new Date(result+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===result?result:null;
 }
 function cutoff(value){const date=day(value);if(!date)return null;const target=date+'T15:00';for(const offset of ['+01:00','+02:00']){const n=Date.parse(target+':00'+offset);if(local(n)===target)return n;}return null;}
 function visible(value,now=Date.now()){const until=cutoff(value);return until===null||now<until;}
 globalThis.KM16StageVisibility={day,cutoff,visible};
})();
