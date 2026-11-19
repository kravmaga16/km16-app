-- The table and policies already exist in hosted KM16. Preserve its ledger.
create table if not exists public.km16_club_registrations (
 id uuid primary key,
 season_id text not null check (season_id ~ '^[0-9]{4}/[0-9]{4}$'),
 test boolean not null,
 first_name text not null check (length(btrim(first_name)) between 1 and 100),
 last_name text not null check (length(btrim(last_name)) between 1 and 100),
 email text check (length(email) <= 254),
 method text not null check (method in ('cheque','cash')),
 amount_cents integer not null check (amount_cents between 1 and 1000000),
 received_on date not null check (received_on <= (now() at time zone 'Europe/Paris')::date),
 recorded_by uuid not null default auth.uid(),
 created_at timestamptz not null default now()
);

alter table public.km16_club_registrations enable row level security;
alter table public.km16_club_registrations
 add column if not exists client_id text check (length(btrim(client_id)) between 1 and 512);

create index if not exists km16_club_registrations_season_id_test_created_at_idx
 on public.km16_club_registrations (season_id, test, created_at desc);

create or replace function public.km16_club_registration_is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.km16_ops_is_admin() $$;

revoke all on function public.km16_club_registration_is_admin() from public, anon;
grant execute on function public.km16_club_registration_is_admin() to authenticated;
revoke all on public.km16_club_registrations from public, anon, authenticated;
grant select, insert on public.km16_club_registrations to authenticated;

drop policy if exists club_registration_read on public.km16_club_registrations;
create policy club_registration_read on public.km16_club_registrations
 for select to authenticated using ((select public.km16_club_registration_is_admin()));

drop policy if exists club_registration_write on public.km16_club_registrations;
create policy club_registration_write on public.km16_club_registrations
 for insert to authenticated with check (
  (select public.km16_club_registration_is_admin()) and recorded_by = (select auth.uid())
 );

create or replace function public.km16_club_payment_totals(p_season text, p_test boolean)
returns table(method text, total_cents bigint)
language sql stable set search_path = ''
as $$
 select r.method, sum(r.amount_cents)
 from public.km16_club_registrations r
 where r.season_id = p_season and r.test = p_test
 group by r.method
$$;

revoke all on function public.km16_club_payment_totals(text, boolean) from public, anon;
grant execute on function public.km16_club_payment_totals(text, boolean) to authenticated;
