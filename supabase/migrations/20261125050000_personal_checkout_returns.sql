create table public.km16_personal_checkout_returns (
  id uuid primary key,
  link_id uuid not null unique references public.km16_purchase_links(id) on delete cascade,
  expires_at timestamptz not null,
  draft jsonb not null
);

alter table public.km16_personal_checkout_returns enable row level security;
revoke all on public.km16_personal_checkout_returns from public, anon, authenticated;
grant select, insert, update, delete on public.km16_personal_checkout_returns to service_role;

select cron.schedule(
  'km16-expire-personal-checkout-returns',
  '*/15 * * * *',
  $$delete from public.km16_personal_checkout_returns where expires_at <= now()$$
);
