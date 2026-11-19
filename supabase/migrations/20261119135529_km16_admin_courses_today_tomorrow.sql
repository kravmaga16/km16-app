create table public.km16_course_planning_changes (
 id bigint generated always as identity primary key,
 session_id uuid not null references public.km16_course_sessions(id) on delete cascade,
 previous_date date not null,
 previous_start time not null,
 previous_venue text not null,
 recorded_at timestamptz not null default now()
);
alter table public.km16_course_planning_changes enable row level security;
revoke all on public.km16_course_planning_changes from public,anon,authenticated;
create index km16_course_planning_changes_date on public.km16_course_planning_changes(previous_date,session_id);

create function public.km16_track_course_planning_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.enabled and (old.session_date+old.start_time) at time zone 'Europe/Paris'>now()
  and (old.session_date,old.start_time,old.end_time,old.venue,old.category,old.enabled)
      is distinct from (new.session_date,new.start_time,new.end_time,new.venue,new.category,new.enabled) then
  insert into public.km16_course_planning_changes(session_id,previous_date,previous_start,previous_venue)
  values(old.id,old.session_date,old.start_time,old.venue);
 end if;
 return new;
end;
$$;
revoke all on function public.km16_track_course_planning_change() from public,anon,authenticated;
create trigger km16_course_planning_change after update of session_date,start_time,end_time,venue,category,enabled
 on public.km16_course_sessions for each row execute function public.km16_track_course_planning_change();

create function public.km16_admin_courses_today_tomorrow()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare paris_today date:=(now() at time zone 'Europe/Paris')::date;
begin
 if not public.km16_ops_is_admin() then raise exception 'Accès réservé à l’administration KM16'; end if;
 return jsonb_build_object('today',paris_today,'tomorrow',paris_today+1,'sessions',coalesce((
  select jsonb_agg(to_jsonb(q) order by q.display_date,q.display_time,q.category) from (
   select s.id,s.session_date,s.start_time,s.end_time,s.venue,s.category,s.enabled,
    case when s.session_date between paris_today and paris_today+1 then s.session_date else history.previous_date end as display_date,
    case when s.session_date between paris_today and paris_today+1 then s.start_time else history.previous_start end as display_time,
    history.previous_date,history.previous_start,history.previous_venue,
    (history.previous_date is not null or exists(select 1 from public.km16_course_change_mail m
     where m.session_id=s.id and m.subject='KM16 · Modification de votre cours')) as changed,
    b.active_count,
    case when s.enabled and (s.session_date+s.start_time) at time zone 'Europe/Paris'<=now()
     then b.unmarked_count else 0 end as attendance_pending,
    (select count(*)::int from public.km16_course_change_mail m where m.session_id=s.id
      and m.reviewed_at is null and (m.state in('failed','uncertain')
       or m.state in('pending','sending') and m.created_at<=now()-interval '10 minutes')) as mail_alerts
   from public.km16_course_sessions s
   left join lateral (
    select c.previous_date,c.previous_start,c.previous_venue from public.km16_course_planning_changes c
    where c.session_id=s.id and (s.session_date between paris_today and paris_today+1 or c.previous_date between paris_today and paris_today+1)
    order by c.id desc limit 1
   ) history on true
   cross join lateral (
    select count(*)::int as active_count,
     (count(*) filter(where a.booking_id is null))::int as unmarked_count
    from public.km16_course_bookings b
    left join public.km16_course_attendance a on a.booking_id=b.id
    where b.session_id=s.id and b.status='Inscrit'
   ) b
   where s.session_date between paris_today and paris_today+1 or history.previous_date is not null
  ) q
 ),'[]'::jsonb));
end;
$$;
revoke all on function public.km16_admin_courses_today_tomorrow() from public,anon,authenticated;
grant execute on function public.km16_admin_courses_today_tomorrow() to authenticated;
