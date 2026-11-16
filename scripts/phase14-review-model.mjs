// KM16 Phase 14 — isolated state machine prototype. No network, database or production writes.
export const REVIEW_STATES=Object.freeze(['a_verifier','en_cours','controle']);
export function updateReview(current,requested,expectedVersion,actor,now){
 if(!REVIEW_STATES.includes(requested))throw new Error('État invalide');
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new Error('Version invalide');
 if(typeof actor!=='string'||!actor)throw new Error('Administrateur manquant');
 if(!Number.isFinite(Date.parse(now)))throw new Error('Date invalide');
 const version=current?.version??0;
 if(version!==expectedVersion)throw new Error('Conflit : rafraîchir le dossier');
 const previous=current?.state??'a_verifier';
 if(previous===requested)return {status:current??{state:previous,version:0,updated_at:null,updated_by:null},event:null};
 const status={state:requested,version:version+1,updated_at:now,updated_by:actor};
 const event={previous_state:previous,new_state:requested,version:status.version,changed_at:now,changed_by:actor};
 return {status,event};
}
