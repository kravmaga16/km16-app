create table public.km16_household_members (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 label text not null check (char_length(trim(label)) between 1 and 100)
);
create unique index km16_household_owner_label on public.km16_household_members(owner_id,lower(label));
alter table public.km16_household_members enable row level security;
revoke all on public.km16_household_members from public,anon,authenticated;
alter table public.km16_course_bookings add column household_id uuid references public.km16_household_members(id) on delete set null;
alter table public.km16_membership_orders add column household_id uuid references public.km16_household_members(id) on delete set null;

create function public.km16_household(p_label text default null,p_kind text default null,p_record uuid default null,p_profile uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'Connexion requise'; end if;
 if p_label is not null then
  insert into public.km16_household_members(owner_id,label) values(actor,trim(p_label));
 elsif p_record is not null then
  if p_profile is not null and not exists(select 1 from public.km16_household_members where id=p_profile and owner_id=actor)
   then raise exception 'Profil indisponible'; end if;
  if p_kind='order' then
   update public.km16_membership_orders set household_id=p_profile where id=p_record and user_id=actor and livemode;
  elsif p_kind='course' then
   update public.km16_course_bookings set household_id=p_profile where id=p_record and owner_id=actor;
  else raise exception 'Dossier invalide'; end if;
  if not found then raise exception 'Dossier indisponible'; end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label) order by label,id) from public.km16_household_members where owner_id=actor),'[]'::jsonb);
end;
$$;

create function public.km16_move_course_booking(p_booking uuid,p_target uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); booking public.km16_course_bookings; original public.km16_course_sessions;
begin
 if actor is null then raise exception 'Connexion requise'; end if;
 select * into booking from public.km16_course_bookings where id=p_booking and owner_id=actor for update;
 if not found or booking.status<>'Inscrit' then raise exception 'Réservation indisponible'; end if;
 select * into original from public.km16_course_sessions where id=booking.session_id;
 if (original.session_date+original.start_time) at time zone 'Europe/Paris'<=now()
  or exists(select 1 from public.km16_course_attendance where booking_id=p_booking) then
  raise exception 'Cette réservation ne peut plus être déplacée';
 end if;

 if p_target is null then
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.session_date,q.start_time) from (
   select s.id,s.session_date,s.start_time,s.end_time,s.category,s.venue
   from public.km16_course_sessions s
   where s.id<>original.id and s.enabled and s.category=original.category
    and (s.session_date+s.start_time) at time zone 'Europe/Paris'>now()
    and not exists(select 1 from public.km16_course_bookings b where b.session_id=s.id and b.status='Inscrit'
     and lower(b.email)=lower(booking.email) and lower(b.first_name)=lower(booking.first_name) and lower(b.last_name)=lower(booking.last_name))
   order by s.session_date,s.start_time limit 100
  ) q),'[]'::jsonb);
 end if;

 perform 1 from public.km16_course_sessions s
 where s.id=p_target and s.id<>original.id and s.enabled and s.category=original.category
  and (s.session_date+s.start_time) at time zone 'Europe/Paris'>now() for share;
 if not found then raise exception 'Le nouveau créneau est indisponible'; end if;
 update public.km16_course_bookings set session_id=p_target,read_at=null where id=p_booking and owner_id=actor;
 return jsonb_build_object('moved',true);
exception when unique_violation then
 raise exception 'Une réservation existe déjà pour ce pratiquant sur ce créneau';
end;
$$;
revoke all on function public.km16_household(text,text,uuid,uuid),public.km16_move_course_booking(uuid,uuid) from public,anon,authenticated;
grant execute on function public.km16_household(text,text,uuid,uuid),public.km16_move_course_booking(uuid,uuid) to authenticated;

create or replace function public.km16_my_course_bookings(p_cancel uuid default null) returns jsonb
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
   select b.id,b.household_id,b.first_name,b.last_name,b.status,s.session_date,s.start_time,s.end_time,s.venue,s.category,
    b.status='Inscrit' and (s.session_date+s.start_time) at time zone 'Europe/Paris'>now() as cancellable
   from public.km16_course_bookings b join public.km16_course_sessions s on s.id=b.session_id
   where b.owner_id=auth.uid() and s.session_date >= (now() at time zone 'Europe/Paris')::date-30
 ) q),'[]'::jsonb);
end $$;

