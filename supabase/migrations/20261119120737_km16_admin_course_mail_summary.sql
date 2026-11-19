create index km16_course_change_mail_session_date on public.km16_course_change_mail(session_id,created_at desc);

create function public.km16_admin_course_mail_summary(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.km16_ops_is_admin() then raise exception 'Accès réservé à l’administration KM16'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.subject) from (
  select created_at,subject,count(*)::int as total,
   (count(*) filter(where state in('pending','sending')))::int as pending,
   (count(*) filter(where state='accepted'))::int as accepted,
   (count(*) filter(where state='failed'))::int as failed,
   (count(*) filter(where state='uncertain'))::int as uncertain
  from public.km16_course_change_mail where session_id=p_session
  group by created_at,subject order by created_at desc,subject limit 20
 ) x),'[]'::jsonb);
end;
$$;
revoke all on function public.km16_admin_course_mail_summary(uuid) from public,anon,authenticated;
grant execute on function public.km16_admin_course_mail_summary(uuid) to authenticated;

create or replace function public.km16_enqueue_course_change() returns trigger
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
    case when cancelled and count(*)=1 and count(b.owner_id)=1
     then 'Voir les créneaux de remplacement : https://app.km16.fr/course-operations.html?remplacement=1#booking-'||min(b.id::text)
     else 'Gérer mes réservations : https://app.km16.fr/course-operations.html' end,
    'L’équipe KM16')
 from public.km16_course_bookings b
 where b.session_id=old.id and b.status='Inscrit'
  and trim(b.email) ~* '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
 group by lower(trim(b.email));
 return new;
end;
$$;
