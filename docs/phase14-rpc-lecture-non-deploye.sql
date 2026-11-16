-- KM16 Phase 14 — PROJET RPC NON DÉPLOYÉ
-- Prérequis: appliquer et tester le schéma proposé dans un projet Supabase ISOLÉ.
-- Cette version n'accorde aucun droit EXECUTE et ne doit pas être appliquée en production.
-- Les RPC définitives doivent faire l'objet d'une revue de sécurité avant déploiement.

-- Lecture limitée aux imports actifs; aucune donnée personnelle renvoyée.
create or replace function public.km16_member_review_list(
  p_season text, p_environment text
) returns table (
  source_member_id text, state text, version bigint,
  updated_at timestamptz, updated_by uuid
) language plpgsql security definer set search_path = ''
as $body$
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users u
    where u.id=auth.uid() and lower(u.email)='alexandre.marchat@gmail.com'
  ) then
    raise exception 'Accès refusé' using errcode='42501';
  end if;
  if p_season is null or p_season !~ '^[0-9]{4}/[0-9]{4}$'
     or p_environment not in ('live','test') or p_environment is null then
    raise exception 'Paramètres invalides';
  end if;
  return query
  select c.external_id,
         coalesce(s.state,'a_verifier'),
         coalesce(s.version,0::bigint),
         s.updated_at,s.updated_by
  from public.km16_external_clients c
  left join public.km16_member_review_status s
    on s.season_id=c.season_id
   and s.environment=p_environment
   and s.source='import'
   and s.source_member_id=c.external_id
  where c.season_id=p_season and c.archived_at is null
  order by c.external_id;
end;
$body$;

-- Lecture paginée de l'historique d'une fiche importée.
create or replace function public.km16_member_review_history_list(
  p_season text, p_environment text, p_external_id text,
  p_limit integer default 50, p_before_id bigint default null
) returns table (
  event_id bigint, previous_state text, new_state text,
  changed_at timestamptz, changed_by uuid, version bigint
) language plpgsql security definer set search_path = ''
as $body$
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users u
    where u.id=auth.uid() and lower(u.email)='alexandre.marchat@gmail.com'
  ) then
    raise exception 'Accès refusé' using errcode='42501';
  end if;
  if p_season is null or p_season !~ '^[0-9]{4}/[0-9]{4}$'
     or p_environment not in ('live','test') or p_environment is null
     or nullif(trim(p_external_id),'') is null
     or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Paramètres invalides';
  end if;
  return query
  select h.id,h.previous_state,h.new_state,h.changed_at,h.changed_by,h.version
  from public.km16_member_review_history h
  where h.season_id=p_season and h.environment=p_environment
    and h.source='import' and h.source_member_id=p_external_id
    and (p_before_id is null or h.id<p_before_id)
  order by h.id desc limit p_limit;
end;
$body$;

-- IMPORTANT: revoke default public execute privileges explicitly after
-- deployment, then grant EXECUTE only to the authenticated role.
-- These functions still require server-side admin authorization.
-- The write RPC is intentionally not included until concurrency tests and
-- permission review are completed.
