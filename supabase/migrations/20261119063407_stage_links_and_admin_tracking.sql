
alter table public.km16_news add column stage_product_id text;
CREATE OR REPLACE FUNCTION public.km16_queue_stage_push(p_now timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  with timed as (
    select p.*, (p.event_date + make_time(m.parts[1]::int,coalesce(m.parts[2],'0')::int,0))
      at time zone 'Europe/Paris' as starts_at
    from public.km16_membership_products p
    cross join lateral regexp_matches(p.note,'^[[:space:]]*(2[0-3]|[01]?[0-9])[[:space:]]*[hH][[:space:]]*([0-5][0-9])?') as m(parts)
    where p.id like 'stage-%' and p.kind='single' and p.event_date between
      (p_now at time zone 'Europe/Paris')::date+1 and (p_now at time zone 'Europe/Paris')::date+3
      and p.draft is false and p.review is false
  ), inserted as (
    insert into public.km16_news (id,title,body,category,scheduled_for,scheduled_notify,stage_date,expires_on,push_to_all,stage_product_id)
    select md5('km16-stage-push:'||p.id||':'||p.event_date)::uuid,
      'Dans 48 h · '||public.km16_stage_reminder_label(p.id,p.title),
      p.note||E'\n\nInfos et inscriptions dans la rubrique Stages de l’application KM16.',
      'stages',greatest(p.starts_at-interval '48 hours',now()+interval '1 millisecond'),true,p.event_date,p.event_date,true,p.id
    from timed p
    where p.starts_at-interval '48 hours' <= p_now
      and p.starts_at-interval '48 hours' > p_now-interval '10 minutes'
    on conflict (id) do nothing returning id
  )
  select count(*)::int from inserted;
$function$
;
CREATE OR REPLACE FUNCTION public.km16_queue_stage_reminder(p_today date)
 RETURNS TABLE(campaign_id text, send_on date, subject text)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  with due_stages as (
    select p.*,
      extract(year from p.event_date)::int - case when extract(month from p.event_date) < 9 then 1 else 0 end as season_start
    from public.km16_membership_products p
    where p.id like 'stage-%' and p.kind='single' and p.event_date in (p_today+3,p_today+7)
      and p.draft is false and p.review is false
  )
  insert into public.km16_scheduled_campaigns as c (id,send_on,season,subject,body,approved,approved_at)
  select 'stage-j'||(p.event_date-p_today)||':'||p.id||':'||p.event_date, p_today, p.season_start || '/' || (p.season_start+1),
    'KM16 · '||(case when p.event_date=p_today+3 then 'Tu n’es pas encore inscrit ? ' else 'Dans une semaine : ' end)||public.km16_stage_reminder_label(p.id,p.title),
    concat_ws(E'\n\n',
      'Bonjour,',
      case when p.event_date=p_today+3
        then 'Tu n’es pas encore inscrit ? On se retrouve dans trois jours au dojo pour « '||public.km16_stage_reminder_label(p.id,p.title)||' ».'
        else 'Dans une semaine, on se retrouve au dojo pour « '||public.km16_stage_reminder_label(p.id,p.title)||' ».' end,
      nullif(trim(p.note),''),
      case when p.amount is not null then 'Tarif : '||replace(to_char(p.amount::numeric/100,'FM999999990.00'),'.',',')||' €.' end,
      'Infos et inscription : https://app.km16.fr/adhesion.html?categorie=Stages&produit='||p.id,
      case when p.event_date=p_today+7 then 'Si tu es déjà inscrit, ta place est réservée.' end,
      'À bientôt sur les tatamis,',
      'Alexandre et l’équipe KM16'
    ), true, now()
  from due_stages p
  on conflict (id) do nothing
  returning c.id,c.send_on,c.subject;
$function$
;
update public.km16_scheduled_campaigns
set body=replace(body,'Pour les détails et l’inscription, ouvre la rubrique Stages de l’application KM16 : https://app.km16.fr/',
  'Infos et inscription : https://app.km16.fr/adhesion.html?categorie=Stages&produit='||split_part(id,':',2))
where id similar to 'stage-j(3|7):%' and prepared_at is null;

create function public.km16_admin_stage_reminders(p_season text)
returns table(stage_id text,title text,event_date date,channel text,planned_at timestamptz,started_at timestamptz,
  targets bigint,accepted bigint,failures bigint,registrations bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users u where u.id=auth.uid()
   and u.email_confirmed_at is not null and lower(u.email)='alexandre.marchat@gmail.com') then
   raise exception 'Accès refusé';
 end if;
 return query
 with stages as (
   select p.id,public.km16_stage_reminder_label(p.id,p.title) label,p.event_date,
     (p.event_date+make_time(m.parts[1]::int,coalesce(m.parts[2],'0')::int,0)) at time zone 'Europe/Paris' begins
   from public.km16_membership_products p
   left join lateral regexp_matches(p.note,'^[[:space:]]*(2[0-3]|[01]?[0-9])[[:space:]]*[hH][[:space:]]*([0-5][0-9])?') as m(parts) on true
   where p.id like 'stage-%' and p.kind='single' and p.event_date is not null
     and p.review is false and (p.draft is false or p.event_date < (now() at time zone 'Europe/Paris')::date)
     and (extract(year from p.event_date)::int-case when extract(month from p.event_date)<9 then 1 else 0 end)::text=split_part(p_season,'/',1)
 ), checkpoints as (
   select s.*,ch.name,ch.planned,ch.campaign_id,ch.news_id
   from stages s cross join lateral (values
     ('E-mail J−7',((s.event_date-7)+time '09:00') at time zone 'Europe/Paris','stage-j7:'||s.id||':'||s.event_date,null::uuid),
     ('E-mail J−3',((s.event_date-3)+time '09:00') at time zone 'Europe/Paris','stage-j3:'||s.id||':'||s.event_date,null::uuid),
     ('Push 48 h',s.begins-interval '48 hours',null::text,md5('km16-stage-push:'||s.id||':'||s.event_date)::uuid)
   ) ch(name,planned,campaign_id,news_id)
 ), metrics as (
   select c.*,coalesce(em.first_attempt,n.push_started_at) dispatched,
      coalesce(em.total,ps.total,0) total,coalesce(em.ok,ps.ok,0) ok,coalesce(em.failed,ps.failed,0) failed
   from checkpoints c
   left join public.km16_news n on n.id=c.news_id
   left join lateral (
     select min(d.attempted_at) first_attempt,count(*) total,
       count(*) filter(where d.state='accepted') ok,count(*) filter(where d.state in ('failed','uncertain')) failed
     from public.km16_scheduled_mail_deliveries d where d.campaign_id=c.campaign_id
   ) em on c.campaign_id is not null
   left join lateral (
     select count(*) total,count(*) filter(where d.status='accepted') ok,count(*) filter(where d.status='failed') failed
     from public.km16_push_deliveries d where d.news_id=c.news_id
   ) ps on c.news_id is not null
 ), windows as (
   select m.*,min(m.dispatched) over(partition by m.id,m.event_date order by m.planned rows between 1 following and unbounded following) next_dispatch
   from metrics m
 ), paid_orders as (
   select o.product_id,min(p.created_at) as paid_at
   from public.km16_membership_orders o join public.km16_membership_payments p on p.order_id=o.id
   where o.livemode and o.approval is distinct from 'rejected' and o.season_id in (p_season,replace(p_season,'/','-'))
     and p.status='paid' and p.amount_cents>coalesce(p.refunded_cents,0)
     and o.product_id in (select s.id from stages s)
   group by o.id,o.product_id
 )
 select w.id,w.label,w.event_date,w.name,w.planned,w.dispatched,w.total,w.ok,w.failed,
   case when w.ok>0 and w.dispatched is not null then (
    select count(*) from paid_orders po where po.product_id=w.id and po.paid_at>=w.dispatched
      and po.paid_at<least(w.next_dispatch,coalesce(w.begins,(w.event_date+1)::timestamp at time zone 'Europe/Paris'))
   ) end
 from windows w order by w.event_date,w.planned nulls last;
end $$;
revoke all on function public.km16_admin_stage_reminders(text) from public, anon;
grant execute on function public.km16_admin_stage_reminders(text) to authenticated;

create function public.km16_admin_processing_items(p_season text)
returns table(kind text,label text,detail text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users u where u.id=auth.uid()
   and u.email_confirmed_at is not null and lower(u.email)='alexandre.marchat@gmail.com') then
   raise exception 'Accès refusé';
 end if;
 return query
 select 'payment'::text,coalesce(nullif(trim(concat_ws(' ',t.payer_first_name,t.payer_last_name)),''),'Payeur non renseigné'),
   t.source||' · '||to_char(t.paid_at at time zone 'Europe/Paris','DD/MM/YYYY')||' · '||replace(to_char(t.amount_cents::numeric/100,'FM999999990.00'),'.',',')||' €'
 from public.km16_external_payment_transactions t
 where (t.season_id in (p_season,replace(p_season,'/','-')) or t.import_season in (p_season,replace(p_season,'/','-')))
   and t.transaction_status='paid' and not exists(select 1 from public.km16_external_clients c where c.external_id=t.external_id and c.season_id=t.season_id and c.archived_at is null)
 order by t.paid_at desc nulls last limit 100;
 return query
 select 'email'::text,concat_ws(' · ',n.buyer_name,n.product_name),
   case when n.state='uncertain' then 'Envoi à vérifier' else 'Échec d’envoi' end
 from public.km16_admin_purchase_notifications n
 where n.state in ('failed','uncertain')
   and not exists (select 1 from public.km16_email_alert_reviews r where r.notification_id=n.id and r.observed_attempted_at is not distinct from n.attempted_at
     and r.decision in ('verification_effectuee','ne_pas_relancer')
     and not exists(select 1 from public.km16_email_alert_reviews successor where successor.previous_review_id=r.id))
 order by n.attempted_at desc nulls last limit 100;
end $$;
revoke all on function public.km16_admin_processing_items(text) from public, anon;
grant execute on function public.km16_admin_processing_items(text) to authenticated;
