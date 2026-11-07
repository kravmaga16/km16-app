export const SEASON='2026/2027';
export const START='2026-09-07',END='2027-06-25',RENEWAL='2027-06-01';
export function parisDate(at=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
 const v=t=>parts.find(p=>p.type===t).value;return `${v('year')}-${v('month')}-${v('day')}`;
}
export function seasonState(at=new Date()){
 const today=parisDate(at);return {archived:today>END,renewalOpen:today>=RENEWAL&&today<'2028-06-01',defaultSeason:today>END?'2027/2028':SEASON};
}
export function validSeason(s){return typeof s==='string'&&/^20\d{2}\/20\d{2}$/.test(s)&&Number(s.slice(5))===Number(s.slice(0,4))+1;}
export function seasonRows(rows,season){
 if(!validSeason(season))throw Error('Saison invalide');
 // Le rattachement est enregistré avec la commande, jamais recalculé depuis un paiement.
 if(rows.some(r=>!validSeason(r.season_id)))throw Error('Installez la mise à jour des saisons dans la base de données');
 return rows.filter(r=>r.season_id===season);
}
