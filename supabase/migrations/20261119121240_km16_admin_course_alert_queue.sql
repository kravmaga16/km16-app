alter table public.km16_course_change_mail add column reviewed_at timestamptz;
create index km16_course_change_mail_unreviewed on public.km16_course_change_mail(created_at desc)
 where reviewed_at is null and state in ('pending','sending','failed','uncertain');

create function public.km16_admin_course_alert_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.km16_ops_is_admin() then raise exception 'Accès réservé à l’administration KM16'; end if;
 return coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
  select m.session_id,m.created_at,m.subject,s.session_date,s.start_time,s.venue,s.category,
   (count(*) filter(where m.state='failed'))::int as failed,
   (count(*) filter(where m.state='uncertain'))::int as uncertain,
   (count(*) filter(where m.state in ('pending','sending')))::int as delayed
  from public.km16_course_change_mail m join public.km16_course_sessions s on s.id=m.session_id
  where m.reviewed_at is null and (m.state in ('failed','uncertain')
   or m.state in ('pending','sending') and m.created_at<=now()-interval '10 minutes')
  group by m.session_id,m.created_at,m.subject,s.session_date,s.start_time,s.venue,s.category
  order by m.created_at desc limit 50
 ) q),'[]'::jsonb);
end;
$$;
create function public.km16_admin_review_course_alert(p_session uuid,p_created_at timestamptz,p_subject text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.km16_ops_is_admin() then raise exception 'Accès réservé à l’administration KM16'; end if;
 update public.km16_course_change_mail set reviewed_at=now()
 where session_id=p_session and created_at=p_created_at and subject=p_subject and reviewed_at is null
  and state in('failed','uncertain');
end;
$$;
revoke all on function public.km16_admin_course_alert_queue(),public.km16_admin_review_course_alert(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.km16_admin_course_alert_queue(),public.km16_admin_review_course_alert(uuid,timestamptz,text) to authenticated;
