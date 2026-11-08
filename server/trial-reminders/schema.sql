create table public.km16_trial_reminder_config(id integer primary key check(id=1),enabled boolean not null default true,activated_at timestamptz not null default now());
insert into public.km16_trial_reminder_config(id) values(1);
create table public.km16_trial_attendance(
 id uuid primary key default gen_random_uuid(),order_id uuid unique references public.km16_membership_orders(id),
 season text not null check(season~'^20[0-9]{2}/20[0-9]{2}$'),first_name text not null,last_name text not null,birth_date date not null,email text not null,
 attended_on date not null,created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),stopped boolean not null default false,
 check(char_length(first_name) between 1 and 80 and char_length(last_name) between 1 and 80)
);
create unique index km16_trial_identity on public.km16_trial_attendance(season,lower(first_name),lower(last_name),birth_date);
create table public.km16_trial_push_links(token_hash text primary key references public.km16_push_subscriptions(token_hash) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,email text not null,enabled_at timestamptz not null default now());
create index km16_trial_push_email on public.km16_trial_push_links(email);
create table public.km16_trial_stops(email text primary key,stopped_at timestamptz not null default now());
create table public.km16_trial_reminders(
 id uuid primary key default gen_random_uuid(),trial_id uuid not null references public.km16_trial_attendance(id) on delete cascade,
 day integer not null check(day in(3,7)),channel text not null check(channel in('email','push')),target text not null,
 due_at timestamptz not null,state text not null default 'pending' check(state in('pending','sending','accepted','failed','uncertain','skipped')),
 locked_at timestamptz,sent_at timestamptz,error_code text,unique(trial_id,day,channel,target)
);
create index km16_trial_due on public.km16_trial_reminders(due_at) where state='pending';
create index km16_trial_reminder_trial on public.km16_trial_reminders(trial_id);
create index km16_trial_attendance_order on public.km16_trial_attendance(order_id);
alter table public.km16_trial_reminder_config enable row level security;
alter table public.km16_trial_attendance enable row level security;
alter table public.km16_trial_push_links enable row level security;
alter table public.km16_trial_stops enable row level security;
alter table public.km16_trial_reminders enable row level security;
revoke all on public.km16_trial_reminder_config,public.km16_trial_attendance,public.km16_trial_push_links,public.km16_trial_stops,public.km16_trial_reminders from public,anon,authenticated;
grant all on public.km16_trial_reminder_config,public.km16_trial_attendance,public.km16_trial_push_links,public.km16_trial_stops,public.km16_trial_reminders to service_role;
create function public.km16_trial_has_subscription(p_trial uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.km16_trial_attendance t join public.km16_membership_orders o
 on o.season_id=t.season and o.livemode and o.birth_date=t.birth_date and ((lower(trim(o.first_name))=lower(trim(t.first_name)) and lower(trim(o.last_name))=lower(trim(t.last_name))) or lower(trim(o.email))=t.email)
 join public.km16_membership_products p on p.id=o.product_id and p.kind in('annual','monthly')
 where t.id=p_trial and (o.approval='approved' or exists(select 1 from public.km16_membership_payments pm where pm.order_id=o.id and (pm.status in('paid','refunded','disputed') or pm.amount_cents>0 and pm.refunded_cents>0))))
 or exists(select 1 from public.km16_trial_attendance t join public.km16_external_clients e
 on e.season_id=t.season and e.payload->>'birth_date'=t.birth_date::text and ((lower(trim(e.payload->>'first_name'))=lower(trim(t.first_name)) and lower(trim(e.payload->>'last_name'))=lower(trim(t.last_name))) or lower(trim(e.payload->>'email'))=t.email) where t.id=p_trial);
$$;
create function public.km16_trial_eligible(p_trial uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.km16_trial_attendance t join public.km16_trial_reminder_config c on c.id=1 and c.enabled
 where t.id=p_trial and not t.stopped and not exists(select 1 from public.km16_trial_stops s where s.email=t.email)
 and not public.km16_trial_has_subscription(t.id)
 and (t.order_id is null or exists(select 1 from public.km16_membership_orders o where o.id=t.order_id and o.livemode and o.product_id in('essai','essai-saint-jean') and o.approval<>'rejected'
 and (o.total_cents=0 or exists(select 1 from public.km16_membership_payments p where p.order_id=o.id and p.status='paid' and p.amount_cents>p.refunded_cents)))));
$$;
create function public.km16_trial_tick() returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Un essai ancien ne déclenche pas plusieurs rappels en retard.
 update public.km16_trial_reminders set state='uncertain',error_code='interrupted' where state='sending' and locked_at<now()-interval '3 minutes';
 update public.km16_trial_reminders r set state='skipped',error_code='no_longer_eligible' where state='pending' and not public.km16_trial_eligible(r.trial_id);
 insert into public.km16_trial_reminders(trial_id,day,channel,target,due_at)
 select t.id,d.day,'email',t.email,((t.attended_on+d.day)+time '09:00') at time zone 'Europe/Paris'
 from public.km16_trial_attendance t cross join (values(3),(7)) d(day)
 where public.km16_trial_eligible(t.id) and ((t.attended_on+d.day)+time '09:00') at time zone 'Europe/Paris' between now()-interval '2 days' and now()
 on conflict do nothing;
 insert into public.km16_trial_reminders(trial_id,day,channel,target,due_at)
 select t.id,d.day,'push',l.token_hash,((t.attended_on+d.day)+time '09:00') at time zone 'Europe/Paris'
 from public.km16_trial_attendance t cross join (values(3),(7)) d(day)
 join public.km16_trial_push_links l on l.email=t.email
 where public.km16_trial_eligible(t.id) and ((t.attended_on+d.day)+time '09:00') at time zone 'Europe/Paris' between now()-interval '2 days' and now()
 on conflict do nothing;
 update public.km16_trial_reminders set state='skipped',error_code='expired' where state='pending' and due_at<now()-interval '2 days';
end $$;
create function public.km16_claim_trial_reminder() returns setof public.km16_trial_reminders language plpgsql security invoker set search_path='' as $$
begin
 if extract(hour from now() at time zone 'Europe/Paris') not between 9 and 18 then return;end if;
 return query update public.km16_trial_reminders set state='sending',locked_at=now()
 where id=(select r.id from public.km16_trial_reminders r where r.state='pending' and r.due_at<=now() and public.km16_trial_eligible(r.trial_id) order by r.due_at,r.channel desc for update skip locked limit 1) returning *;
end $$;
revoke all on function public.km16_trial_has_subscription(uuid),public.km16_trial_eligible(uuid),public.km16_trial_tick(),public.km16_claim_trial_reminder() from public,anon,authenticated;
grant execute on function public.km16_trial_has_subscription(uuid),public.km16_trial_eligible(uuid),public.km16_trial_tick(),public.km16_claim_trial_reminder() to service_role;
create function public.km16_trial_push_valid(p_token text,p_email text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.km16_trial_push_links l join public.km16_push_subscriptions s on s.token_hash=l.token_hash where l.token_hash=p_token and l.email=p_email);
$$;
revoke all on function public.km16_trial_push_valid(text,text) from public,anon,authenticated;
grant execute on function public.km16_trial_push_valid(text,text) to service_role;

create function public.km16_trial_states(p_ids uuid[]) returns table(id uuid,subscribed boolean,opted_out boolean) language sql stable security invoker set search_path='' as $$
 select t.id,public.km16_trial_has_subscription(t.id),exists(select 1 from public.km16_trial_stops s where s.email=t.email) from public.km16_trial_attendance t where t.id=any(p_ids);
$$;
revoke all on function public.km16_trial_states(uuid[]) from public,anon,authenticated;
grant execute on function public.km16_trial_states(uuid[]) to service_role;
