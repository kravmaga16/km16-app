// Phase 14: pure, unconnected adapter for future review RPC calls.
// No automatic matching, no writes on import, and no production integration.
export const REVIEW_STATES = Object.freeze(['a_verifier','en_cours','controle']);

export function reviewKeyForImportedMember(member, season, environment) {
  if (!member || typeof member.id !== 'string' || !member.id.startsWith('import:')) return null;
  const externalId = member.id.slice('import:'.length);
  if (!externalId || !/^\d{4}\/\d{4}$/.test(season) || !['live','test'].includes(environment)) return null;
  if (member.season_id && member.season_id !== season) return null;
  return { season, environment, externalId };
}

export async function listReviewStatuses(supabase, season, environment) {
  if (!supabase?.rpc || !/^\d{4}\/\d{4}$/.test(season) || !['live','test'].includes(environment)) {
    throw new Error('Paramètres de consultation invalides');
  }
  const {data,error}=await supabase.rpc('km16_member_review_list',{p_season:season,p_environment:environment});
  if (error) throw new Error('Impossible de charger les statuts administratifs');
  return Array.isArray(data)?data:[];
}

export async function saveReviewStatus(supabase, key, state, expectedVersion) {
  if (!supabase?.rpc || !key || !/^\d{4}\/\d{4}$/.test(key.season)
    || !['live','test'].includes(key.environment) || !key.externalId
    || !REVIEW_STATES.includes(state)
    || !Number.isSafeInteger(expectedVersion) || expectedVersion<0) {
    throw new Error('Paramètres de sauvegarde invalides');
  }
  const {data,error}=await supabase.rpc('km16_member_review_set',{
    p_season:key.season,p_environment:key.environment,
    p_external_id:key.externalId,p_state:state,p_expected_version:expectedVersion
  });
  if (error) {
    if (error.code==='40001') throw new Error('Dossier modifié ailleurs : actualisez avant de réessayer');
    throw new Error('Enregistrement non confirmé : aucune validation affichée');
  }
  const row=Array.isArray(data)?data[0]:data;
  if (!row || row.state!==state || !Number.isSafeInteger(Number(row.version))) {
    throw new Error('Réponse serveur invalide : enregistrement non confirmé');
  }
  return row;
}
