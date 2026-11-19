create table public.km16_course_cancellation_bookings (
 session_id uuid not null references public.km16_course_sessions(id) on delete cascade,
 booking_id uuid not null,
 recorded_at timestamptz not null,
 primary key(session_id,recorded_at,booking_id)
);
create table public.km16_course_cancellations (
 session_id uuid primary key references public.km16_course_sessions(id) on delete cascade,
 recorded_at timestamptz not null default now()
);
alter table public.km16_course_cancellation_bookings enable row level security;
alter table public.km16_course_cancellations enable row level security;
revoke all on public.km16_course_cancellation_bookings,public.km16_course_cancellations from public,anon,authenticated;

create function public.km16_capture_course_cancellation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.enabled and not new.enabled and (old.session_date+old.start_time) at time zone 'Europe/Paris'>now() then
  insert into public.km16_course_cancellations(session_id) values(old.id)
  on conflict(session_id) do update set recorded_at=excluded.recorded_at;
  insert into public.km16_course_cancellation_bookings(session_id,booking_id,recorded_at)
  select old.id,id,now() from public.km16_course_bookings where session_id=old.id and status='Inscrit'
  on conflict do nothing;
 end if;
 return new;
end;
$$;
revoke all on function public.km16_capture_course_cancellation() from public,anon,authenticated;
create trigger km16_capture_course_cancellation after update of enabled on public.km16_course_sessions
 for each row execute function public.km16_capture_course_cancellation();

create function public.km16_admin_course_replacements(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare recorded timestamptz;
begin
 if not public.km16_ops_is_admin() then raise exception 'Accès réservé à l’administration KM16'; end if;
 select recorded_at into recorded from public.km16_course_cancellations where session_id=p_session;
 if not found then return null; end if;
 return (
  with cases as (
   select case when b.id is null or b.status='Annulé' then 'withdrawn'
    when b.status='Inscrit' and b.session_id<>p_session and s.enabled then 'moved'
    else 'waiting' end state,
    s.session_date,s.start_time,s.venue
   from public.km16_course_cancellation_bookings t
   left join public.km16_course_bookings b on b.id=t.booking_id
   left join public.km16_course_sessions s on s.id=b.session_id
   where t.session_id=p_session and t.recorded_at=recorded
  ), destinations as (
   select session_date,start_time,venue,count(*)::int as reservations
   from cases where state='moved' group by session_date,start_time,venue
  )
  select jsonb_build_object('recorded_at',recorded,'total',count(*),
   'moved',count(*) filter(where state='moved'),'waiting',count(*) filter(where state='waiting'),
   'withdrawn',count(*) filter(where state='withdrawn'),
   'destinations',coalesce((select jsonb_agg(to_jsonb(d) order by d.session_date,d.start_time,d.venue) from destinations d),'[]'::jsonb))
  from cases
 );
end;
$$;
revoke all on function public.km16_admin_course_replacements(uuid) from public,anon,authenticated;
grant execute on function public.km16_admin_course_replacements(uuid) to authenticated;
