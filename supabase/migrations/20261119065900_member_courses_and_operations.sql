
alter table public.km16_course_bookings add column owner_id uuid references auth.users(id) on delete set null;
create index km16_booking_owner on public.km16_course_bookings(owner_id) where owner_id is not null;
create unique index km16_booking_active_participant on public.km16_course_bookings(session_id,lower(email),lower(first_name),lower(last_name)) where status='Inscrit';
drop index public.km16_booking_unique_active;

create table public.km16_course_instructors (
 session_id uuid references public.km16_course_sessions(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 assigned_at timestamptz not null default now(),
 primary key(session_id,user_id)
);
create table public.km16_payment_match_audit (
 transaction_id bigint primary key references public.km16_external_payment_transactions(id),
 previous_external_id text, previous_season text, external_id text not null, season_id text not null,
 matched_by uuid not null, matched_at timestamptz not null default now()
);
alter table public.km16_course_instructors enable row level security;
alter table public.km16_payment_match_audit enable row level security;
revoke all on public.km16_course_instructors, public.km16_payment_match_audit from public,anon,authenticated;

create function public.km16_ops_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and lower(email)='alexandre.marchat@gmail.com')
$$;
create function public.km16_my_course_bookings(p_cancel uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 if p_cancel is not null then
  update public.km16_course_bookings b set status='Annulé',cancelled_at=now(),read_at=null
  from public.km16_course_sessions s where s.id=b.session_id and b.id=p_cancel and b.owner_id=auth.uid()
   and b.status='Inscrit' and (s.session_date+s.start_time) at time zone 'Europe/Paris'>now();
  if not found then raise exception 'Cette réservation ne peut plus être annulée'; end if;
 end if;
 return coalesce((select jsonb_agg(to_jsonb(q) order by q.session_date,q.start_time) from (
   select b.id,b.first_name,b.last_name,b.status,s.session_date,s.start_time,s.end_time,s.venue,s.category,
    b.status='Inscrit' and (s.session_date+s.start_time) at time zone 'Europe/Paris'>now() as cancellable
   from public.km16_course_bookings b join public.km16_course_sessions s on s.id=b.session_id
   where b.owner_id=auth.uid() and s.session_date >= (now() at time zone 'Europe/Paris')::date-30
 ) q),'[]'::jsonb);
end $$;

create function public.km16_instructor_courses(p_session uuid default null,p_booking uuid default null,p_present boolean default null,p_email text default null,p_remove boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; administrator boolean:=public.km16_ops_is_admin();
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 if p_email is not null then
  if not administrator or p_session is null then raise exception 'Accès refusé'; end if;
  select id into target from auth.users where email_confirmed_at is not null and lower(email)=lower(trim(p_email)) limit 1;
  if target is null then raise exception 'Aucun compte KM16 confirmé pour cet e-mail'; end if;
  if p_remove then delete from public.km16_course_instructors where session_id=p_session and user_id=target;
  else insert into public.km16_course_instructors(session_id,user_id) values(p_session,target) on conflict do nothing; end if;
 end if;
 if p_session is null then
  return jsonb_build_object('admin',administrator,'sessions',coalesce((select jsonb_agg(to_jsonb(q) order by q.session_date,q.start_time) from (
   select s.id,s.session_date,s.start_time,s.end_time,s.venue,s.category from public.km16_course_sessions s
   where s.enabled and s.session_date between (now() at time zone 'Europe/Paris')::date-7 and (now() at time zone 'Europe/Paris')::date+30
    and (administrator or exists(select 1 from public.km16_course_instructors i where i.session_id=s.id and i.user_id=auth.uid()))
  ) q),'[]'::jsonb));
 end if;
 if not administrator and not exists(select 1 from public.km16_course_instructors i join public.km16_course_sessions s on s.id=i.session_id
   where i.session_id=p_session and i.user_id=auth.uid() and s.enabled and s.session_date between (now() at time zone 'Europe/Paris')::date-7 and (now() at time zone 'Europe/Paris')::date+30)
 then raise exception 'Accès refusé'; end if;
 if p_booking is not null then
  if p_present is null then raise exception 'Présence invalide'; end if;
  perform 1 from public.km16_course_bookings where id=p_booking and session_id=p_session and status='Inscrit' for update;
  if not found then raise exception 'Réservation indisponible'; end if;
  insert into public.km16_course_attendance(booking_id,present,recorded_by) values(p_booking,p_present,auth.uid())
  on conflict(booking_id) do update set present=excluded.present,recorded_by=excluded.recorded_by,recorded_at=now();
 end if;
 return jsonb_build_object('bookings',coalesce((select jsonb_agg(to_jsonb(q) order by q.last_name,q.first_name) from (
   select b.id,b.first_name,b.last_name,a.present from public.km16_course_bookings b left join public.km16_course_attendance a on a.booking_id=b.id
   where b.session_id=p_session and b.status='Inscrit'
  ) q),'[]'::jsonb),'instructors',case when administrator then coalesce((select jsonb_agg(u.email order by u.email)
  from public.km16_course_instructors i join auth.users u on u.id=i.user_id where i.session_id=p_session),'[]'::jsonb) else '[]'::jsonb end);
end $$;

create function public.km16_admin_payment_matches(p_season text,p_transaction bigint default null,p_search text default null,p_external text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tx public.km16_external_payment_transactions; target public.km16_external_clients;
begin
 if not public.km16_ops_is_admin() then raise exception 'Accès refusé'; end if;
 if p_transaction is null then
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.paid_at desc nulls last) from (
   select t.id,t.source,t.source_reference,t.payer_first_name,t.payer_last_name,t.paid_at,t.amount_cents
   from public.km16_external_payment_transactions t where (t.season_id=p_season or t.import_season=p_season) and t.transaction_status='paid'
   and not exists(select 1 from public.km16_external_clients c where c.external_id=t.external_id and c.season_id=t.season_id and c.archived_at is null)
   order by t.paid_at desc nulls last limit 100
  ) q),'[]'::jsonb);
 end if;
 select * into tx from public.km16_external_payment_transactions where id=p_transaction and (season_id=p_season or import_season=p_season) and transaction_status='paid' for update;
 if not found then raise exception 'Transaction introuvable'; end if;
 if p_external is not null then
  if exists(select 1 from public.km16_external_clients c where c.external_id=tx.external_id and c.season_id=tx.season_id and c.archived_at is null)
    or exists(select 1 from public.km16_payment_match_audit a where a.transaction_id=tx.id) then raise exception 'Cette transaction est déjà rapprochée'; end if;
  select * into target from public.km16_external_clients where external_id=p_external and season_id=p_season and archived_at is null for update;
  if not found then raise exception 'Fiche inactive ou introuvable'; end if;
  insert into public.km16_payment_match_audit(transaction_id,previous_external_id,previous_season,external_id,season_id,matched_by)
  values(tx.id,tx.external_id,tx.season_id,target.external_id,target.season_id,auth.uid());
  update public.km16_external_payment_transactions set external_id=target.external_id,season_id=target.season_id where id=tx.id;
  return jsonb_build_object('matched',true);
 end if;
 return coalesce((select jsonb_agg(to_jsonb(q)) from (
   select c.external_id,c.payload->>'first_name' first_name,c.payload->>'last_name' last_name,
     c.payload->>'email' email
   from public.km16_external_clients c
   where c.season_id=p_season and c.archived_at is null and (
    position(lower(trim(coalesce(p_search,tx.payer_last_name,''))) in lower(concat_ws(' ',c.payload->>'first_name',c.payload->>'last_name',c.payload->>'email')))>0
   ) order by c.payload->>'last_name',c.payload->>'first_name' limit 30
 ) q),'[]'::jsonb);
end $$;
revoke all on function public.km16_ops_is_admin(), public.km16_my_course_bookings(uuid), public.km16_instructor_courses(uuid,uuid,boolean,text,boolean), public.km16_admin_payment_matches(text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.km16_my_course_bookings(uuid), public.km16_instructor_courses(uuid,uuid,boolean,text,boolean), public.km16_admin_payment_matches(text,bigint,text,text) to authenticated;
