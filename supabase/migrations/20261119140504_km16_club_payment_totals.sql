create function public.km16_club_payment_totals(p_season text,p_test boolean)
returns table(method text, total_cents bigint)
language sql stable security invoker set search_path = ''
as $$
 select r.method,sum(r.amount_cents)
 from public.km16_club_registrations r
 where r.season_id=p_season and r.test=p_test
 group by r.method
$$;
revoke all on function public.km16_club_payment_totals(text,boolean) from public,anon;
grant execute on function public.km16_club_payment_totals(text,boolean) to authenticated;
