create function public.km16_payment_match_suggestion(p_season text, p_transaction bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  payer_first text;
  payer_last text;
  match_count integer;
  candidate jsonb;
  accents constant text := 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ';
  plain constant text := 'aaaaaaceeeeiiiinooooouuuuyy';
begin
  if not public.km16_ops_is_admin() then
    raise exception 'Accès refusé';
  end if;

  select
    trim(regexp_replace(translate(lower(normalize(t.payer_first_name)), accents, plain), '[[:space:]‐‑–-]+', ' ', 'g')),
    trim(regexp_replace(translate(lower(normalize(t.payer_last_name)), accents, plain), '[[:space:]‐‑–-]+', ' ', 'g'))
  into payer_first, payer_last
  from public.km16_external_payment_transactions t
  where t.id = p_transaction
    and (t.season_id = p_season or t.import_season = p_season)
    and t.transaction_status = 'paid'
    and lower(trim(t.source)) in ('fighty', 'sportigo')
    and not exists (
      select 1 from public.km16_external_clients c
      where c.external_id = t.external_id and c.season_id = t.season_id and c.archived_at is null
    )
    and not exists (select 1 from public.km16_payment_match_audit a where a.transaction_id = t.id);

  if nullif(payer_first, '') is null or nullif(payer_last, '') is null then
    return jsonb_build_object('status', 'none');
  end if;

  with active as (
    select c.external_id, c.payload->>'first_name' as first_name, c.payload->>'last_name' as last_name,
      nullif(lower(trim(c.payload->>'email')), '') as email_key, c.payload->>'email' as email
    from public.km16_external_clients c
    where c.season_id = p_season and c.archived_at is null
  ), matching as (
    select * from active c
    where trim(regexp_replace(translate(lower(normalize(c.first_name)), accents, plain), '[[:space:]‐‑–-]+', ' ', 'g')) = payer_first
      and trim(regexp_replace(translate(lower(normalize(c.last_name)), accents, plain), '[[:space:]‐‑–-]+', ' ', 'g')) = payer_last
    limit 2
  )
  select count(*), (jsonb_agg(jsonb_build_object(
    'external_id', m.external_id, 'first_name', m.first_name, 'last_name', m.last_name,
    'email', m.email, 'shared_email', exists (
      select 1 from active a where a.external_id <> m.external_id and a.email_key = m.email_key
    )
  )))->0 into match_count, candidate
  from matching m;

  if match_count = 1 then
    return jsonb_build_object('status', 'unique', 'candidate', candidate);
  end if;
  return jsonb_build_object('status', case when match_count > 1 then 'ambiguous' else 'none' end);
end;
$$;

revoke all on function public.km16_payment_match_suggestion(text, bigint) from public, anon, authenticated;
grant execute on function public.km16_payment_match_suggestion(text, bigint) to authenticated;
