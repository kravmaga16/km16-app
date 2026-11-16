-- KM16 Phase 14 — PROJET DE MIGRATION, NON APPLIQUÉ
-- À faire relire et tester sur un environnement de développement avant déploiement.
-- Les données d'adhésion et les paiements restent intacts.
-- Le suivi permanent n'est autorisé dans cette version que pour les fiches
-- importées avec une clé (external_id, season_id) vérifiée.
create table if not exists public.km16_member_review_status (
  season_id text not null,
  environment text not null check (environment in ('live','test')),
  source text not null check (source = 'import'),
  source_member_id text not null,
  state text not null default 'a_verifier'
    check (state in ('a_verifier','en_cours','controle')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1 check (version >= 1),
  primary key (season_id,environment,source,source_member_id),
  foreign key (source_member_id,season_id)
    references public.km16_external_clients(external_id,season_id)
    on update restrict on delete restrict
);

create table if not exists public.km16_member_review_history (
  id bigint generated always as identity primary key,
  season_id text not null,
  environment text not null check (environment in ('live','test')),
  source text not null check (source = 'import'),
  source_member_id text not null,
  previous_state text check (previous_state in ('a_verifier','en_cours','controle')),
  new_state text not null check (new_state in ('a_verifier','en_cours','controle')),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id),
  version bigint not null check (version >= 1),
  foreign key (season_id,environment,source,source_member_id)
    references public.km16_member_review_status(season_id,environment,source,source_member_id)
    on update restrict on delete restrict
);
create index if not exists km16_member_review_history_lookup_idx
  on public.km16_member_review_history
  (season_id,environment,source,source_member_id,changed_at desc);

alter table public.km16_member_review_status enable row level security;
alter table public.km16_member_review_history enable row level security;
-- Defense in depth: even table owners are subject to RLS, unless bypassrls.
alter table public.km16_member_review_status force row level security;
alter table public.km16_member_review_history force row level security;

-- No direct grants to anon/authenticated and no RLS policies.
-- Only a separately reviewed, authenticated server-side RPC should read/write.
-- The RPC must verify admin authorization on the server, check the source
-- record is active, validate state transitions, perform versioned updates
-- and append history atomically. No RPC is included in this migration.
