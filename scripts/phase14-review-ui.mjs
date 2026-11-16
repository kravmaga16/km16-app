// Phase 14: isolated UI renderer. Not imported by production clients.mjs.
// Caller must provide an authenticated RPC adapter and a stable imported-member key.
const LABELS=Object.freeze({a_verifier:'À vérifier',en_cours:'En cours',controle:'Contrôlé'});
export function createReviewControl(doc,{member,key,record,onSave,onHistory}){
 const root=doc.createElement('div');
 root.className='km16-review-phase14';
 if(!key){
   const note=doc.createElement('span');note.textContent='Suivi permanent indisponible : identifiant non vérifié';
   root.append(note);return root;
 }
 const label=doc.createElement('label');label.textContent='Suivi administratif permanent';
 const select=doc.createElement('select');
 for(const [value,title] of Object.entries(LABELS)){
   const option=doc.createElement('option');option.value=value;option.textContent=title;select.append(option);
 }
 select.value=record?.state??'a_verifier';
 const status=doc.createElement('span');
 status.setAttribute('role','status');
 status.textContent=record?.updated_at?'Dernière modification enregistrée : '+record.updated_at:'Aucun statut permanent enregistré';
 const save=doc.createElement('button');save.type='button';save.textContent='Enregistrer le statut';
 save.disabled=true;
 select.addEventListener('change',()=>{save.disabled=select.value===(record?.state??'a_verifier');status.textContent='Modification non enregistrée';});
 save.addEventListener('click',async()=>{
   if(save.disabled)return;
   save.disabled=true;select.disabled=true;status.textContent='Enregistrement en cours…';
   try{
     const next=await onSave(key,select.value,record?.version??0);
     if(!next||next.state!==select.value)throw new Error('Réponse non confirmée');
     record=next;
     status.textContent='Enregistré · version '+next.version;
   }catch(err){
     status.textContent=err?.message||'Échec de sauvegarde : actualiser avant de réessayer';
   }finally{
     select.disabled=false;save.disabled=select.value===(record?.state??'a_verifier');
   }
 });
 const history=doc.createElement('button');history.type='button';history.textContent='Voir l’historique';
 history.addEventListener('click',async()=>{
   history.disabled=true;
   try{
     const entries=await onHistory(key);
     const list=doc.createElement('ul');
     for(const entry of entries){
       const li=doc.createElement('li');
       li.textContent=(LABELS[entry.new_state]??'Statut inconnu')+' · '+(entry.changed_at??'date indisponible');
       list.append(li);
     }
     const old=root.querySelector('ul');if(old)old.remove();
     root.append(list);
   }catch(err){status.textContent=err?.message||'Historique indisponible';}
   finally{history.disabled=false;}
 });
 label.append(select);root.append(label,save,status,history);
 return root;
}
