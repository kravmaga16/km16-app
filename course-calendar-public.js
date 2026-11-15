// KM16 : accès compact aux réservations, calendrier réel géré par Supabase.
(() => {
  const panel=document.getElementById('planning');
  if(!panel)return;
  const section=document.createElement('section');
  section.className='card';
  section.style.margin='16px 0';
  const title=document.createElement('h3');
  title.textContent='Réservation des cours';
  const description=document.createElement('p');
  description.textContent='Choisissez votre séance parmi les cours disponibles. Les fermetures et les vacances scolaires sont prises en compte automatiquement.';
  const button=document.createElement('a');
  button.className='cta';
  button.href='./course-booking.html';
  button.textContent='Réserver un cours';
  button.addEventListener('click',()=>{
    const selected=document.querySelector('#planning-filters button[aria-pressed="true"]')?.textContent?.trim();
    if(selected&&selected!=='Tous')button.href='./course-booking.html?groupe='+encodeURIComponent(selected);
    else button.href='./course-booking.html';
  });
  section.append(title,description,button);
  document.getElementById('planning-lead')?.insertAdjacentElement('afterend',section);
})();
