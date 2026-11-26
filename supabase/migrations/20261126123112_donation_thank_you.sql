create table public.km16_donation_thank_you (
  payment_intent_id text primary key check (payment_intent_id ~ '^pi_[a-zA-Z0-9]+$'),
  email text not null check (length(email) between 3 and 254),
  amount_cents integer not null check (amount_cents between 100 and 100000),
  paid_at timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending', 'sending', 'accepted', 'failed', 'uncertain')),
  claimed_at timestamptz,
  sent_at timestamptz
);

alter table public.km16_donation_thank_you enable row level security;
revoke all on public.km16_donation_thank_you from public, anon, authenticated, service_role;
grant select, insert, update on public.km16_donation_thank_you to service_role;

create index on public.km16_donation_thank_you (paid_at, payment_intent_id)
  where state = 'pending';

create function public.km16_claim_donation_thank_you()
returns setof public.km16_donation_thank_you
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- An interrupted SMTP transaction might have delivered the message.
  update public.km16_donation_thank_you
  set state = 'uncertain'
  where state = 'sending' and claimed_at < now() - interval '10 minutes';

  return query
  with next_job as (
    select d.payment_intent_id
    from public.km16_donation_thank_you d
    where d.state = 'pending'
    order by d.paid_at, d.payment_intent_id
    limit 1
    for update skip locked
  )
  update public.km16_donation_thank_you d
  set state = 'sending', claimed_at = now()
  from next_job
  where d.payment_intent_id = next_job.payment_intent_id
  returning d.*;
end
$$;

revoke all on function public.km16_claim_donation_thank_you() from public, anon, authenticated;
grant execute on function public.km16_claim_donation_thank_you() to service_role;
