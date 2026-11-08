create table public.km16_mail_campaigns (
 id uuid primary key,
 created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 season text not null,
 audience text not null check (audience in ('','Ados','Adultes','Enfants')),
 subject text not null check (char_length(subject) between 1 and 160),
 body text not null check (char_length(body) between 1 and 10000),
 approved_at timestamptz,
 recipient_count integer not null check (recipient_count between 1 and 1000)
);
create table public.km16_mail_deliveries (
 id bigint generated always as identity primary key,
 campaign_id uuid not null references public.km16_mail_campaigns(id) on delete cascade,
 email text not null,
 state text not null default 'pending' check (state in ('pending','sending','accepted','failed','uncertain')),
 attempted_at timestamptz,
 error_code text,
 unique(campaign_id,email)
);
create index km16_mail_deliveries_pending on public.km16_mail_deliveries(campaign_id,id) where state='pending';
create index km16_mail_campaigns_created on public.km16_mail_campaigns(created_at desc);
alter table public.km16_mail_campaigns enable row level security;
alter table public.km16_mail_deliveries enable row level security;
revoke all on public.km16_mail_campaigns,public.km16_mail_deliveries from public,anon,authenticated;
grant all on public.km16_mail_campaigns,public.km16_mail_deliveries to service_role;
grant usage,select on sequence public.km16_mail_deliveries_id_seq to service_role;
create function public.km16_prepare_mail(p_id uuid,p_user uuid,p_season text,p_audience text,p_subject text,p_body text,p_emails text[])
returns uuid language plpgsql security invoker set search_path='' as $$
begin
 if cardinality(p_emails)<1 or cardinality(p_emails)>1000 then raise exception 'recipient_count';end if;
 insert into public.km16_mail_campaigns(id,created_by,season,audience,subject,body,recipient_count)
 values(p_id,p_user,p_season,p_audience,p_subject,p_body,cardinality(p_emails));
 insert into public.km16_mail_deliveries(campaign_id,email) select p_id,unnest(p_emails);
 return p_id;
end $$;
create function public.km16_claim_mail(p_id uuid)
returns setof public.km16_mail_deliveries language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(16076201);
 update public.km16_mail_deliveries set state='uncertain',error_code='interrupted' where state='sending' and attempted_at<now()-interval '2 minutes';
 if exists(select 1 from public.km16_mail_deliveries where state='sending') then return;end if;
 if not exists(select 1 from public.km16_mail_campaigns where id=p_id and approved_at is not null and created_at>now()-interval '24 hours') then return;end if;
 return query update public.km16_mail_deliveries set state='sending',attempted_at=now()
 where id=(select id from public.km16_mail_deliveries where campaign_id=p_id and state='pending' order by id for update skip locked limit 1) returning *;
end $$;
revoke all on function public.km16_prepare_mail(uuid,uuid,text,text,text,text,text[]),public.km16_claim_mail(uuid) from public,anon,authenticated;
grant execute on function public.km16_prepare_mail(uuid,uuid,text,text,text,text,text[]),public.km16_claim_mail(uuid) to service_role;
