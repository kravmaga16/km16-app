alter table public.km16_news add column stage_date date;
alter table public.km16_news add column expires_at timestamptz generated always as (
 case when stage_date is not null then (stage_date+time '15:00') at time zone 'Europe/Paris'
 when expires_on is not null and category='stages' then (expires_on+time '15:00') at time zone 'Europe/Paris'
 when expires_on is not null then ((expires_on+1)+time '00:00') at time zone 'Europe/Paris'
 else null end
) stored;
alter policy "Published news readable" on public.km16_news using (
 published_at is not null and published_at<=now() and (expires_at is null or expires_at>now())
);
