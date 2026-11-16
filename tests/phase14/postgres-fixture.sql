-- Disposable PostgreSQL CI fixture: fictional identities only.
create schema auth;
create table auth.users(id uuid primary key,email text not null);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create role anon nologin;
create role authenticated nologin;
create table public.km16_external_clients (
 external_id text not null,season_id text not null,archived_at timestamptz,
 primary key(external_id,season_id)
);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','alexandre.marchat@gmail.com'),
 ('22222222-2222-4222-8222-222222222222','test-nonadmin@example.invalid');
insert into public.km16_external_clients(external_id,season_id,archived_at) values
 ('fictional-active','2026/2027',null),
 ('fictional-archived','2026/2027',now()),
 ('fictional-previous','2025/2026',null);
