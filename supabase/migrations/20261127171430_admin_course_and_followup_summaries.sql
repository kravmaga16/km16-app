-- The booking and session tables have no authenticated read policy.
-- These two scoped functions return only aggregates or the latest follow-up metadata.
create function public.km16_admin_course_alert_counts()
returns table(unlinked bigint, attendance_due bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.km16_ops_is_admin() is distinct from true or auth.jwt()->>'aal' is distinct from 'aal2' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  return query
  select count(*) filter (where member_link.booking_id is null and external_link.booking_id is null),
         count(*) filter (where s.session_date < (now() at time zone 'Europe/Paris')::date
                                 and attendance.booking_id is null)
  from public.km16_course_bookings b
  left join public.km16_course_sessions s on s.id = b.session_id
  left join public.km16_booking_member_links member_link on member_link.booking_id = b.id
  left join public.km16_booking_external_links external_link on external_link.booking_id = b.id
  left join public.km16_course_attendance attendance on attendance.booking_id = b.id
  where b.status = 'Inscrit';
end;
$$;

create function public.km16_admin_followup_summaries(p_order_ids uuid[])
returns table(order_id uuid, recorded_at timestamptz, delivery_at timestamptz, delivery_state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.km16_ops_is_admin() is distinct from true or auth.jwt()->>'aal' is distinct from 'aal2' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if cardinality(p_order_ids) > 100 then
    raise exception '100 dossiers maximum par lot' using errcode = '22023';
  end if;

  return query
  with requested as (
    select distinct id from unnest(p_order_ids) as orders(id) where id is not null
  ), manual as (
    select l.order_id, max(l.recorded_at) as recorded_at
    from public.km16_membership_followup_log l join requested r on r.id = l.order_id
    group by l.order_id
  ), delivery as (
    select distinct on (f.order_id) f.order_id, f.created_at, f.state
    from public.km16_membership_followup_outbox f join requested r on r.id = f.order_id
    order by f.order_id, f.created_at desc, f.id desc
  )
  select r.id, m.recorded_at, d.created_at, d.state
  from requested r
  left join manual m on m.order_id = r.id
  left join delivery d on d.order_id = r.id;
end;
$$;

revoke all on function public.km16_admin_course_alert_counts() from public, anon, authenticated;
revoke all on function public.km16_admin_followup_summaries(uuid[]) from public, anon, authenticated;
grant execute on function public.km16_admin_course_alert_counts() to authenticated;
grant execute on function public.km16_admin_followup_summaries(uuid[]) to authenticated;
