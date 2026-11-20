create function public.km16_admin_health_documents(p_season text)
returns table(order_id uuid, first_name text, last_name text, state text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id=auth.uid() and u.email_confirmed_at is not null
      and lower(u.email)='alexandre.marchat@gmail.com'
  ) then
    raise exception 'Accès refusé' using errcode='42501';
  end if;
  return query
  select o.id, o.first_name::text, o.last_name::text,
    case when d.health_status='received' or exists (
      select 1 from storage.objects f
      where f.bucket_id='km16-member-documents' and f.name=o.id::text||'/health'
    ) then 'review' else 'missing' end
  from public.km16_membership_documents d
  join public.km16_membership_orders o on o.id=d.order_id
  where o.livemode and o.approval<>'rejected' and o.season_id=p_season
    and d.health_kind='certificat' and d.health_status in ('missing','received')
  order by o.last_name, o.first_name, o.id;
end;
$$;
revoke all on function public.km16_admin_health_documents(text) from public, anon, authenticated;
grant execute on function public.km16_admin_health_documents(text) to authenticated;
