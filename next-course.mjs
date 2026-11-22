const get = id => document.getElementById(id);
const profile = get('next-profile');
const message = get('next-session');
const book = get('next-book');
const remove = get('next-profile-remove');
const clear = get('next-profile-clear');
const key = 'km16-course-profiles';
const matchers = {enfants: /^enfants/i, adolescents: /^adolescents/i, adultes: /^adultes.*tous niveaux/i, noire: /préparation noire/i};
const dateFormat = new Intl.DateTimeFormat('fr-FR', {dateStyle:'full', timeZone:'Europe/Paris'});
const clock = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Paris', dateStyle:'short', timeStyle:'medium', hourCycle:'h23'});
let state = {profiles: [], selected: ''};
let sessions;
let unavailable = false;
try{
 const saved = JSON.parse(localStorage.getItem(key));
 if(Array.isArray(saved?.profiles)){
  state.profiles = saved.profiles.filter(p=>typeof p?.name==='string' && typeof p.id==='string' && Object.hasOwn(matchers,p.category));
  state.selected = state.profiles.some(p=>p.id===saved.selected) ? saved.selected : '';
 }
}catch{}
function save(){
 try{localStorage.setItem(key,JSON.stringify(state));}catch{}
}
function render(){
 profile.replaceChildren(new Option('Tous les cours',''), ...state.profiles.map(p=>new Option(p.name,p.id)));
 profile.value = state.selected;
 const selected = state.profiles.find(p=>p.id===state.selected);
 remove.hidden = !selected;
 clear.hidden = state.profiles.length === 0;
 book.href = './course-booking.html';
 book.textContent = 'Réserver un cours';
 if(!sessions){
  message.textContent = unavailable ? 'Le prochain cours est indisponible. Consulte le planning ou la page de réservation.' : 'Chargement des séances…';
  return;
 }
 const now = clock.format(new Date()).replace(' ','T');
 const next = sessions.find(s=>s.session_date+'T'+s.start_time.slice(0,5)>now.slice(0,16) && (!selected || matchers[selected.category].test(s.category)));
 if(!next){
  message.textContent = 'Aucune séance ouverte pour ce profil dans le calendrier actuel.';
  return;
 }
 message.textContent = dateFormat.format(new Date(next.session_date+'T12:00:00Z'))+' · '+next.start_time.slice(0,5)+'–'+next.end_time.slice(0,5)+' · '+next.venue+' · '+next.category;
 book.href = './course-booking.html?session='+encodeURIComponent(next.id);
 book.textContent = 'Réserver cette séance';
}
profile.addEventListener('change',()=>{state.selected=profile.value;save();render();});
get('next-profile-form').addEventListener('submit',event=>{
 event.preventDefault();
 const name = get('next-profile-name').value.trim();
 const category = get('next-profile-category').value;
 if(!name || !Object.hasOwn(matchers,category))return;
 const id = globalThis.crypto.randomUUID();
 state.profiles.push({id,name,category});
 state.selected=id;
 save();
 event.currentTarget.reset();
 render();
});
remove.addEventListener('click',()=>{
 state.profiles=state.profiles.filter(p=>p.id!==state.selected);
 state.selected='';
 save();
 render();
 profile.focus();
});
clear.addEventListener('click',()=>{
 try{localStorage.removeItem(key);}catch{return;}
 state={profiles:[],selected:''};
 render();
 profile.focus();
});
if(location.hash==='#next-course-profiles')get('next-course-profiles').open=true;
let loading=false;
async function load(){
 if(loading)return;
 loading=true;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch('https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-course-bookings',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sessions'}),signal:controller.signal,
  });
  const data=await response.json();
  if(!response.ok || !Array.isArray(data.sessions))throw Error('Calendrier indisponible');
  sessions=data.sessions;
 }catch{
  sessions=undefined;
  unavailable=true;
 }finally{
  clearTimeout(timeout);
  loading=false;
  render();
 }
}
render();
void load();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
window.addEventListener('online',()=>void load());
setInterval(()=>{if(!document.hidden)render();},60000);
