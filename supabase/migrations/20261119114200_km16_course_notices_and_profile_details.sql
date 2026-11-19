create table public.km16_course_moved_dates(course_key text not null,session_date date not null, primary key(course_key,session_date));
alter table public.km16_course_moved_dates enable row level security;
revoke all on public.km16_course_moved_dates from public,anon,authenticated;
grant select on public.km16_course_moved_dates to service_role;
create table public.km16_course_change_mail (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.km16_course_sessions(id) on delete cascade,
 email text not null,
 subject text not null,
 body text not null,
 state text not null default 'pending' check (state in ('pending','sending','accepted','failed','uncertain')),
 created_at timestamptz not null default now(),
 claimed_at timestamptz,
 sent_at timestamptz
);
alter table public.km16_course_change_mail enable row level security;
revoke all on public.km16_course_change_mail from public,anon,authenticated;
create index km16_course_change_mail_pending on public.km16_course_change_mail(created_at) where state='pending';

create function public.km16_enqueue_course_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare cancelled boolean:=not new.enabled;
begin
 if not old.enabled or (old.session_date+old.start_time) at time zone 'Europe/Paris'<=now()
  or (old.enabled,old.session_date,old.start_time,old.end_time,old.venue,old.category)
     is not distinct from (new.enabled,new.session_date,new.start_time,new.end_time,new.venue,new.category) then
  return new;
 end if;
 if old.session_date<>new.session_date then
  insert into public.km16_course_moved_dates values(old.course_key,old.session_date) on conflict do nothing;
 end if;
 insert into public.km16_course_change_mail(session_id,email,subject,body)
 select new.id,lower(trim(b.email)),
  case when cancelled then 'KM16 · Cours annulé' else 'KM16 · Modification de votre cours' end,
  concat_ws(E'\n\n','Bonjour,',
    case when cancelled then 'Le cours suivant est annulé :' else 'Le cours suivant a été modifié :' end,
    'Créneau initial : '||to_char(old.session_date,'DD/MM/YYYY')||', '||to_char(old.start_time,'HH24:MI')||'–'||to_char(old.end_time,'HH24:MI')||' · '||old.venue||' · '||old.category,
    case when not cancelled then 'Nouveau créneau : '||to_char(new.session_date,'DD/MM/YYYY')||', '||to_char(new.start_time,'HH24:MI')||'–'||to_char(new.end_time,'HH24:MI')||' · '||new.venue||' · '||new.category end,
    'Voir les créneaux compatibles dans Mes réservations avec « Déplacer ce cours ».',
    'Consulter les créneaux ouverts : https://app.km16.fr/course-booking.html',
    'Gérer mes réservations : https://app.km16.fr/course-operations.html',
    'L’équipe KM16')
 from public.km16_course_bookings b
 where b.session_id=old.id and b.status='Inscrit'
  and trim(b.email) ~* '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
 group by lower(trim(b.email));
 return new;
end;
$$;
revoke all on function public.km16_enqueue_course_change() from public,anon,authenticated;
create trigger km16_course_change_mail after update of enabled,session_date,start_time,end_time,venue,category
 on public.km16_course_sessions for each row execute function public.km16_enqueue_course_change();

create function public.km16_claim_course_change_mail()
returns setof public.km16_course_change_mail language plpgsql security definer set search_path='' as $$
begin
 update public.km16_course_change_mail set state='uncertain' where state='sending' and claimed_at<now()-interval '15 minutes';
 return query update public.km16_course_change_mail q set state='sending',claimed_at=now()
 where q.id=(select p.id from public.km16_course_change_mail p where p.state='pending'
  order by p.created_at,p.id limit 1 for update skip locked) returning q.*;
end;
$$;
revoke all on function public.km16_claim_course_change_mail() from public,anon,authenticated;
grant execute on function public.km16_claim_course_change_mail() to service_role;
grant select,update on public.km16_course_change_mail to service_role;

create or replace function public.km16_household(p_label text default null,p_kind text default null,p_record uuid default null,p_profile uuid default null)
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
 return coalesce((
  select jsonb_agg(jsonb_build_object('id',m.id,'label',m.label,
   'first_name',coalesce(o.first_name,b.first_name),'last_name',coalesce(o.last_name,b.last_name),
   'birth_date',o.birth_date,'phone',o.phone,'guardian_name',o.guardian_name) order by m.label,m.id)
  from public.km16_household_members m
  left join lateral (select x.first_name,x.last_name,x.birth_date,x.phone,x.guardian_name
   from public.km16_membership_orders x where x.household_id=m.id and x.user_id=actor and x.livemode
   order by x.created_at desc,x.id limit 1) o on true
  left join lateral (select x.first_name,x.last_name from public.km16_course_bookings x
   where x.household_id=m.id and x.owner_id=actor order by x.created_at desc,x.id limit 1) b on true
  where m.owner_id=actor
 ),'[]'::jsonb);
end;
$$;


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
   select b.id,b.household_id,b.first_name,b.last_name,b.status,s.enabled as session_enabled,s.session_date,s.start_time,s.end_time,s.venue,s.category,
    b.status='Inscrit' and (s.session_date+s.start_time) at time zone 'Europe/Paris'>now() as cancellable
   from public.km16_course_bookings b join public.km16_course_sessions s on s.id=b.session_id
   where b.owner_id=auth.uid() and s.session_date >= (now() at time zone 'Europe/Paris')::date-30
 ) q),'[]'::jsonb);
end $$;

grant select on public.km16_household_members to service_role;

CREATE OR REPLACE FUNCTION public.km16_generate_course_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare inserted_count integer;
begin
 insert into public.km16_course_sessions(course_key,session_date,category,start_time,end_time,venue,enabled)
 select t.course_key,d::date,t.category,t.start_time,t.end_time,t.venue,true
 from generate_series(greatest(current_date,'2026-11-16'::date),'2027-06-24'::date,interval '1 day') d
 join public.km16_course_weekly_template t on t.enabled and t.weekday=extract(dow from d)::int
 where not exists(
  select 1 from public.km16_course_calendar_rules r
  where d::date between r.start_date and r.end_date
  and (r.rule='closed' or (r.rule='sundays_only' and extract(dow from d)::int<>0))
 )
 and not exists(select 1 from public.km16_course_moved_dates m where m.course_key=t.course_key and m.session_date=d::date)
 on conflict(course_key,session_date) do nothing;
 get diagnostics inserted_count=row_count;
 return inserted_count;
end $function$;
