create function public.km16_admin_course_scope(
  p_date date,
  p_session_id uuid,
  p_previous_version text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
  version text;
begin
  if public.km16_ops_is_admin() is distinct from true then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if (p_date is null) = (p_session_id is null) then
    raise exception 'Indiquez une date ou une séance' using errcode = '22023';
  end if;

  with scoped_sessions as (
    select id, course_key, session_date, category, start_time, end_time, venue, enabled
    from public.km16_course_sessions s
    where (p_session_id is not null and s.id = p_session_id)
       or (p_date is not null and s.session_date = p_date)
  ), scoped_bookings as (
    select b.id, b.session_id, b.first_name, b.last_name, b.email, b.status, b.created_at,
           b.cancelled_at, b.read_at,
           a.present, m.membership_order_id, x.external_id, x.season_id
    from public.km16_course_bookings b
    join scoped_sessions s on s.id = b.session_id
    left join public.km16_course_attendance a on a.booking_id = b.id
    left join public.km16_booking_member_links m on m.booking_id = b.id
    left join public.km16_booking_external_links x on x.booking_id = b.id
  )
  select jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from scoped_sessions s), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from scoped_bookings b), '[]'::jsonb)
  ) into snapshot;
  version := md5(snapshot::text);
  if version = p_previous_version then
    return jsonb_build_object('version', version, 'unchanged', true);
  end if;
  return snapshot || jsonb_build_object('version', version, 'unchanged', false);
end;
$$;

revoke all on function public.km16_admin_course_scope(date, uuid, text) from public, anon, authenticated;
grant execute on function public.km16_admin_course_scope(date, uuid, text) to authenticated;
