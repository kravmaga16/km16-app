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
      'Infos et inscription : https://app.km16.fr/adhesion.html?categorie=Stages&produit='||p.id||
        '&source_stage=email-j'||(p.event_date-p_today),
      case when p.event_date=p_today+7 then 'Si tu es déjà inscrit, ta place est réservée.' end,
      'À bientôt sur les tatamis,',
      'Alexandre et l’équipe KM16'
    ), true, now()
  from due_stages p
  on conflict (id) do nothing
  returning c.id,c.send_on,c.subject;
$function$
;
