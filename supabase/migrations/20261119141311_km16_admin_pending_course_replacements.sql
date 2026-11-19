create function public.km16_admin_pending_course_replacements()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.km16_ops_is_admin() then raise exception 'Accès réservé à l’administration KM16'; end if;
 return coalesce((
  select jsonb_agg(to_jsonb(q) order by q.session_date desc,q.start_time desc,q.session_id)
  from (
   select s.id as session_id,s.session_date,s.start_time,s.category,s.venue,
    (d.summary->>'total')::int as total,(d.summary->>'moved')::int as moved,
    (d.summary->>'waiting')::int as waiting
   from public.km16_course_cancellations c
   join public.km16_course_sessions s on s.id=c.session_id and not s.enabled
   cross join lateral (select public.km16_admin_course_replacements(s.id) as summary) d
   where (d.summary->>'waiting')::int>0
   order by s.session_date desc,s.start_time desc,s.id
   limit 50
  ) q
 ),'[]'::jsonb);
end;
$$;
revoke all on function public.km16_admin_pending_course_replacements() from public,anon,authenticated;
grant execute on function public.km16_admin_pending_course_replacements() to authenticated;
