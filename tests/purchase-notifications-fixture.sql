-- Disposable PostgreSQL fixture only. The JS runner uses a fresh in-memory DB.
do $$
begin
  if to_regclass('public.km16_admin_purchase_notifications') is not null
     or to_regclass('public.km16_club_registrations') is not null then
    raise exception 'Refused: existing KM16 database';
  end if;
end;
$$;

create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table public.km16_admin_purchase_notifications (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  kind text not null,
  buyer_name text not null,
  product_name text not null,
  amount_cents integer not null check (amount_cents >= 0),
  paid_at timestamptz not null,
  recipient text not null default 'contact@km16.fr',
  state text not null default 'pending'
    check (state in ('pending','sending','accepted','failed','uncertain')),
  created_at timestamptz not null default now(),
  attempted_at timestamptz,
  sent_at timestamptz,
  error_code text
);
alter table public.km16_admin_purchase_notifications enable row level security;
revoke all on public.km16_admin_purchase_notifications from public, anon, authenticated;
grant select, update on public.km16_admin_purchase_notifications to service_role;

create table public.km16_club_registrations (
  id uuid primary key,
  season_id text not null,
  test boolean not null,
  first_name text not null,
  last_name text not null,
  method text not null check (method in ('cheque','cash')),
  amount_cents integer not null check (amount_cents > 0),
  received_on date not null,
  created_at timestamptz not null default now()
);
alter table public.km16_club_registrations enable row level security;
grant select, insert on public.km16_club_registrations to authenticated;
create policy admin_insert on public.km16_club_registrations
  for insert to authenticated with check (current_setting('km16.fixture_admin', true) = 'yes');
create policy admin_read on public.km16_club_registrations
  for select to authenticated using (current_setting('km16.fixture_admin', true) = 'yes');

create table public.km16_membership_products (
  id text primary key, kind text, category text
);
create table public.km16_membership_orders (
  id uuid primary key, product_id text, livemode boolean,
  first_name text, last_name text, title text
);
create table public.km16_membership_payments (
  reference text primary key,
  order_id uuid not null references public.km16_membership_orders(id),
  amount_cents integer not null,
  refunded_cents integer,
  status text not null,
  created_at timestamptz not null default now()
);
create function public.km16_enqueue_membership_purchase() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin return new; end; $$;
revoke all on function public.km16_enqueue_membership_purchase()
  from public, anon, authenticated, service_role;
create trigger km16_purchase_mail_membership
after insert or update of status on public.km16_membership_payments
for each row execute function public.km16_enqueue_membership_purchase();

create table public.km16_shirt_orders (
  id uuid primary key,
  stripe_session_id text unique,
  amount_cents integer not null check (amount_cents in (1800,3000)),
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  livemode boolean not null,
  created_at timestamptz not null default now()
);
alter table public.km16_shirt_orders enable row level security;
revoke all on public.km16_shirt_orders from public, anon, authenticated;
grant select, update on public.km16_shirt_orders to service_role;

-- A previous club receipt must not be backfilled by applying the migration.
insert into public.km16_club_registrations
values ('10000000-0000-4000-8000-000000000000','2026/2027',false,'Historical','Fixture','cash',1000,'2026-11-01',now());
