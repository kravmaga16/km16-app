create function public.km16_course_change_message(initial public.km16_course_sessions,target public.km16_course_sessions,booking text default null)
returns text language sql stable set search_path='' as $$
 select concat_ws(E'\n\n','Bonjour,',
    case when not target.enabled then 'Le cours suivant est annulé :' else 'Le cours suivant a été modifié :' end,
    'Créneau initial : '||to_char(initial.session_date,'DD/MM/YYYY')||', '||to_char(initial.start_time,'HH24:MI')||'–'||to_char(initial.end_time,'HH24:MI')||' · '||initial.venue||' · '||initial.category,
    case when target.enabled then 'Nouveau créneau : '||to_char(target.session_date,'DD/MM/YYYY')||', '||to_char(target.start_time,'HH24:MI')||'–'||to_char(target.end_time,'HH24:MI')||' · '||target.venue||' · '||target.category end,
    'Voir les créneaux compatibles dans Mes réservations avec « Déplacer ce cours ».',
    'Consulter les créneaux ouverts : https://app.km16.fr/course-booking.html',
    case when booking is not null
     then 'Voir les créneaux de remplacement : https://app.km16.fr/course-operations.html?remplacement=1#booking-'||booking
     else 'Gérer mes réservations : https://app.km16.fr/course-operations.html' end,
    'L’équipe KM16')
$$;

create function public.km16_course_change_recipients(p_session uuid,p_cancel boolean)
returns table(email text,booking text) language sql stable set search_path='' as $$
 select lower(trim(b.email)),
  case when p_cancel and count(*)=1 and count(b.owner_id)=1 then min(b.id::text) end
 from public.km16_course_bookings b
 where b.session_id=p_session and b.status='Inscrit'
  and trim(b.email) ~* '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
 group by lower(trim(b.email))
$$;

create or replace function public.km16_enqueue_course_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not old.enabled or (old.session_date+old.start_time) at time zone 'Europe/Paris'<=now()
  or (old.enabled,old.session_date,old.start_time,old.end_time,old.venue,old.category)
     is not distinct from (new.enabled,new.session_date,new.start_time,new.end_time,new.venue,new.category) then return new; end if;
 if old.session_date<>new.session_date then
  insert into public.km16_course_moved_dates values(old.course_key,old.session_date) on conflict do nothing;
 end if;
 insert into public.km16_course_change_mail(session_id,email,subject,body)
 select new.id,r.email,case when new.enabled then 'KM16 · Modification de votre cours' else 'KM16 · Cours annulé' end,
  public.km16_course_change_message(old,new,r.booking)
 from public.km16_course_change_recipients(old.id,not new.enabled) r;
 return new;
end;
$$;

create function public.km16_admin_course_change(p_session uuid,p_cancel boolean default false,
 p_date date default null,p_start time default null,p_end time default null,p_venue text default null,p_confirmation text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare original public.km16_course_sessions; target public.km16_course_sessions;
 bookings integer; recipients integer; direct_count integer; signature text; audience jsonb; changed boolean;
begin
 if not public.km16_ops_is_admin() then raise exception 'Accès réservé à l’administration KM16'; end if;
 if p_confirmation is null then
  select * into original from public.km16_course_sessions where id=p_session;
 else
  select * into original from public.km16_course_sessions where id=p_session for update;
  perform 1 from public.km16_course_bookings where session_id=p_session for update;
 end if;
 if original.id is null or not original.enabled or (original.session_date+original.start_time) at time zone 'Europe/Paris'<=now()
  then raise exception 'Séance indisponible'; end if;
 target:=original;
 if p_cancel then target.enabled:=false;
 else
  if p_date is null or p_start is null or p_end is null or p_start>=p_end
   or (p_date+p_start) at time zone 'Europe/Paris'<=now() or coalesce(char_length(trim(p_venue)),0) not between 2 and 120
   then raise exception 'Données du cours invalides'; end if;
  target.session_date:=p_date;target.start_time:=p_start;target.end_time:=p_end;target.venue:=trim(p_venue);
 end if;
 changed:=target is distinct from original;
 select count(*) into bookings from public.km16_course_bookings where session_id=p_session and status='Inscrit';
 select count(*),count(booking),coalesce(jsonb_agg(to_jsonb(r) order by r.email),'[]'::jsonb)
 into recipients,direct_count,audience from public.km16_course_change_recipients(p_session,p_cancel) r;
 if not changed then recipients:=0;direct_count:=0; end if;
 signature:=md5(jsonb_build_array(to_jsonb(original),to_jsonb(target),bookings,audience)::text);
 if p_confirmation is not null then
  if signature<>p_confirmation then raise exception 'Le créneau ou les inscrits ont changé. Ouvrez un nouvel aperçu.'; end if;
  if changed then
   update public.km16_course_sessions set session_date=target.session_date,start_time=target.start_time,end_time=target.end_time,
     venue=target.venue,enabled=target.enabled where id=p_session;
  end if;
  return jsonb_build_object('changed',changed,'recipients',recipients);
 end if;
 return jsonb_build_object('confirmation',signature,'changed',changed,'bookings',bookings,'recipients',recipients,
  'direct_count',direct_count,'subject',case when p_cancel then 'KM16 · Cours annulé' else 'KM16 · Modification de votre cours' end,
  'old_label',to_char(original.session_date,'DD/MM/YYYY')||' · '||to_char(original.start_time,'HH24:MI')||'–'||to_char(original.end_time,'HH24:MI')||' · '||original.venue,
  'new_label',case when p_cancel then 'Séance annulée' else to_char(target.session_date,'DD/MM/YYYY')||' · '||to_char(target.start_time,'HH24:MI')||'–'||to_char(target.end_time,'HH24:MI')||' · '||target.venue end,
  'body',case when recipients>0 then public.km16_course_change_message(original,target,case when direct_count=recipients then '[lien-personnalisé]' end)||E'\n\n—\nKM16 · contact@km16.fr' end,
  'direct_body',case when direct_count>0 and direct_count<recipients then public.km16_course_change_message(original,target,'[lien-personnalisé]')||E'\n\n—\nKM16 · contact@km16.fr' end);
end;
$$;
revoke all on function public.km16_course_change_message(public.km16_course_sessions,public.km16_course_sessions,text),
 public.km16_course_change_recipients(uuid,boolean),public.km16_admin_course_change(uuid,boolean,date,time,time,text,text) from public,anon,authenticated;
grant execute on function public.km16_admin_course_change(uuid,boolean,date,time,time,text,text) to authenticated;
