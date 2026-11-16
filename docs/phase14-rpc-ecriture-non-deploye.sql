-- KM16 PHASE 14 — BROUILLON DE FONCTION D'ÉCRITURE, NON DÉPLOYÉ
-- À tester dans un projet Supabase isolé après revue de sécurité.
-- Prérequis : tables du brouillon phase14-schema-propose-non-deploye.sql.
-- Une invocation PostgreSQL d'une fonction s'exécute dans une transaction.
create or replace function public.km16_member_review_set(
  p_season text,
  p_environment text,
  p_external_id text,
  p_state text,
  p_expected_version bigint
) returns table (
  state text,
  version bigint,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql security definer set search_path = ''
as $body$
declare
  v_current public.km16_member_review_status%rowtype;
  v_version bigint;
  v_previous text;
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null or not exists (
    select 1 from auth.users u
    where u.id=v_actor and lower(u.email)='alexandre.marchat@gmail.com'
  ) then
    raise exception 'Accès refusé' using errcode='42501';
  end if;
  if p_season is null or p_season !~ '^[0-9]{4}/[0-9]{4}$'
    or p_environment is null or p_environment not in ('live','test')
    or nullif(btrim(p_external_id),'') is null
    or p_state is null or p_state not in ('a_verifier','en_cours','controle')
    or p_expected_version is null or p_expected_version<0 then
    raise exception 'Paramètres invalides' using errcode='22023';
  end if;

  -- Lock the source row: a concurrent archival/update cannot race this check.
  perform 1 from public.km16_external_clients c
  where c.external_id=p_external_id and c.season_id=p_season
    and c.archived_at is null
  for update;
  if not found then
    raise exception 'Fiche importée active introuvable' using errcode='22023';
  end if;

  -- Serialize first-time writes for the same dossier/environment.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_season||':'||p_environment||':import:'||p_external_id,0
    )
  );

  select s.* into v_current
  from public.km16_member_review_status s
  where s.season_id=p_season and s.environment=p_environment
    and s.source='import' and s.source_member_id=p_external_id
  for update;
  v_version := coalesce(v_current.version,0);
  v_previous := coalesce(v_current.state,'a_verifier');
  if v_version<>p_expected_version then
    raise exception 'Conflit de version : actualiser le dossier' using errcode='40001';
  end if;
  if v_previous=p_state then
    return query select v_previous,v_version,v_current.updated_at,v_current.updated_by;
    return;
  end if;

  insert into public.km16_member_review_status as s
    (season_id,environment,source,source_member_id,state,updated_at,updated_by,version)
  values (p_season,p_environment,'import',p_external_id,p_state,
          pg_catalog.now(),v_actor,v_version+1)
  on conflict (season_id,environment,source,source_member_id)
  do update set state=excluded.state,updated_at=excluded.updated_at,
                updated_by=excluded.updated_by,version=excluded.version
  returning s.* into v_current;

  insert into public.km16_member_review_history
    (season_id,environment,source,source_member_id,previous_state,new_state,
     changed_at,changed_by,version)
  values (p_season,p_environment,'import',p_external_id,v_previous,p_state,
          v_current.updated_at,v_actor,v_current.version);

  return query select v_current.state,v_current.version,
                      v_current.updated_at,v_current.updated_by;
end;
$body$;

-- SECURITY: PostgreSQL grants EXECUTE to PUBLIC on new functions by default.
-- Revoke immediately in the same migration transaction before exposing the RPC.
revoke all on function public.km16_member_review_set(text,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.km16_member_review_set(text,text,text,text,bigint)
  to authenticated;
-- Authorization still checks the actual admin identity inside the function.
-- No table grants are made to anon/authenticated.
