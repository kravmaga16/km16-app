// KM16: dates réelles des séances issues de Supabase (le tableau hebdomadaire reste indicatif).
(() => {
  const endpoint='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-course-bookings';
  const panel=document.getElementById('planning');
  if(!panel)return;
  const section=document.createElement('section');
  section.className='card';
  section.style.margin='16px 0';
  const title=document.createElement('h3');title.textContent='Prochaines séances confirmées';
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Chargement du calendrier réel…';
  const list=document.createElement('div');
  section.append(title,status,list);
  const lead=document.getElementById('planning-lead');
  lead?.insertAdjacentElement('afterend',section);
  const formatDate=s=>new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(s+'T12:00:00Z'));
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  async function refresh(){
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sessions'}),cache:'no-store'});
      if(!response.ok)throw Error('Service indisponible');
      const payload=await response.json();
      if(!Array.isArray(payload.sessions))throw Error('Réponse invalide');
      const from=today(),until=new Date(from+'T12:00:00Z');until.setUTCDate(until.getUTCDate()+20);
      const to=until.toISOString().slice(0,10);
      const rows=payload.sessions.filter(s=>s.session_date>=from&&s.session_date<=to).sort((a,b)=>sCompare(a,b));
      list.replaceChildren();
      if(!rows.length){status.textContent='Aucune séance programmée sur les 21 prochains jours (fermeture ou vacances).';return;}
      status.textContent=rows.length+' séance(s) programmée(s) sur les 21 prochains jours. Les fermetures sont prises en compte.';
      const ul=document.createElement('ul');ul.style.lineHeight='1.9';
      for(const s of rows){
        const li=document.createElement('li');
        const start=String(s.start_time||'').slice(0,5),end=String(s.end_time||'').slice(0,5);
        li.textContent=formatDate(s.session_date)+' · '+start+'–'+end+' · '+s.category+' · '+s.venue+' ';
        const link=document.createElement('a');link.href='./course-booking.html';link.textContent='Réserver';li.append(link);ul.append(li);
      }
      list.append(ul);
    }catch(e){status.textContent='Calendrier en temps réel momentanément indisponible. Consultez les réservations pour vérifier les séances.';list.replaceChildren();}
  }
  function sCompare(a,b){return a.session_date.localeCompare(b.session_date)||String(a.start_time).localeCompare(String(b.start_time));}
  refresh();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
