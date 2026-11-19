create table public.km16_club_registrations (
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
revoke all on public.km16_club_registrations from public, anon, authenticated;
grant select on public.km16_club_registrations to authenticated;
grant insert (id, season_id, test, first_name, last_name, email, method, amount_cents, received_on) on public.km16_club_registrations to authenticated;
create policy club_registration_read on public.km16_club_registrations for select to authenticated using ((select public.km16_ops_is_admin()));
create policy club_registration_write on public.km16_club_registrations for insert to authenticated with check ((select public.km16_ops_is_admin()) and recorded_by=(select auth.uid()));
create index on public.km16_club_registrations (season_id,test,created_at desc);
