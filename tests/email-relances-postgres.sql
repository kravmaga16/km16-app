-- PostgreSQL 17 isolé : aucune connexion à Supabase, aucun worker ni cron.
-- Lancer uniquement dans la base dédiée email_relances_test, avec psql -X.
-- Le nom de base et l'absence des objets KM16 sont contrôlés avant toute écriture.
-- Les trois tables, leurs données et la fonction sont intégralement annulées.
\set ON_ERROR_STOP on
\pset pager off

DO $guard$
BEGIN
    IF current_database() <> 'email_relances_test' THEN
        RAISE EXCEPTION 'Test refusé : base email_relances_test obligatoire';
    END IF;
    IF current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'Ce test doit être exécuté sur PostgreSQL 17';
    END IF;
    IF to_regclass('public.km16_admin_purchase_notifications') IS NOT NULL
       OR to_regclass('public.km16_scheduled_mail_deliveries') IS NOT NULL
       OR to_regclass('public.km16_scheduled_campaigns') IS NOT NULL
       OR to_regprocedure('public.km16_preparer_relances()') IS NOT NULL THEN
        RAISE EXCEPTION 'Test refusé : des objets KM16 existent déjà';
    END IF;
END;
$guard$;

BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';

-- Les rôles créés ici disparaissent aussi au ROLLBACK.
DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'service_role')
          AND (rolsuper OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'Test refusé : les rôles de test doivent subir les contrôles RLS';
    END IF;
END;
$roles$;

-- Structures correspondant aux migrations KM16 communiquées ; données fictives.
CREATE TABLE public.km16_scheduled_campaigns (
    id text PRIMARY KEY,
    send_on date NOT NULL,
    season text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    approved boolean NOT NULL DEFAULT false,
    approved_by uuid,
    approved_at timestamptz,
    prepared_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.km16_admin_purchase_notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_key text NOT NULL UNIQUE,
    kind text NOT NULL,
    buyer_name text NOT NULL,
    product_name text NOT NULL,
    amount_cents integer NOT NULL CHECK (amount_cents >= 0),
    paid_at timestamptz NOT NULL,
    recipient text NOT NULL DEFAULT 'test@example.invalid',
    state text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'sending', 'accepted', 'failed', 'uncertain')),
    created_at timestamptz NOT NULL DEFAULT now(),
    attempted_at timestamptz,
    sent_at timestamptz,
    error_code text
);
CREATE TABLE public.km16_scheduled_mail_deliveries (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id text NOT NULL REFERENCES public.km16_scheduled_campaigns(id),
    email text NOT NULL,
    state text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'sending', 'accepted', 'failed', 'uncertain')),
    attempted_at timestamptz,
    sent_at timestamptz,
    error_code text,
    UNIQUE (campaign_id, email)
);

ALTER TABLE public.km16_scheduled_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.km16_admin_purchase_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.km16_scheduled_mail_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.km16_scheduled_campaigns,
    public.km16_admin_purchase_notifications,
    public.km16_scheduled_mail_deliveries FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.km16_admin_purchase_notifications,
    public.km16_scheduled_mail_deliveries TO anon, authenticated, service_role;

-- Politiques STRICTEMENT réservées aux fixtures : anon et authenticated peuvent
-- lire directement les données fictives, mais ne doivent pas appeler la fonction.
-- Cela distingue le refus EXECUTE d'un éventuel refus SELECT/RLS des tables.
CREATE POLICY fixture_select ON public.km16_admin_purchase_notifications
    FOR SELECT TO anon, authenticated, service_role USING (true);
CREATE POLICY fixture_select ON public.km16_scheduled_mail_deliveries
    FOR SELECT TO anon, authenticated, service_role USING (true);

CREATE TEMP TABLE km16_scenarios (
    case_no integer PRIMARY KEY,
    case_name text NOT NULL,
    state text NOT NULL,
    attempted_at timestamptz,
    expected_action text
);
-- now() est fixe dans la transaction : la borne exacte de 15 min est déterministe.
INSERT INTO km16_scenarios VALUES
    (1, 'failed', 'failed', now(), 'validation_requise'),
    (2, 'uncertain', 'uncertain', now(), 'verification_manuelle'),
    (3, 'sending_old', 'sending', now() - interval '30 minutes', 'blocage_a_verifier'),
    (4, 'sending_recent', 'sending', now() - interval '5 minutes', NULL),
    (5, 'sending_exact_boundary', 'sending', now() - interval '15 minutes', NULL),
    (6, 'pending', 'pending', NULL, NULL),
    (7, 'accepted', 'accepted', now() - interval '1 day', NULL);

INSERT INTO public.km16_scheduled_campaigns (id, send_on, season, subject, body)
VALUES ('KM16_SQL_FIXTURE', CURRENT_DATE, 'TEST', 'Fictif', 'Aucun envoi');
INSERT INTO public.km16_admin_purchase_notifications
    (event_key, kind, buyer_name, product_name, amount_cents, paid_at,
     recipient, state, attempted_at, sent_at, error_code)
SELECT 'fixture:purchase:' || s.case_name, 'test', 'Personne fictive',
       'Produit fictif', 0, now(), s.case_name || '@example.invalid',
       s.state, s.attempted_at,
       CASE WHEN s.state = 'accepted' THEN s.attempted_at END,
       CASE WHEN s.state = 'failed' THEN 'FICTIONAL_FAILURE' END
FROM km16_scenarios AS s ORDER BY s.case_no;
INSERT INTO public.km16_scheduled_mail_deliveries
    (campaign_id, email, state, attempted_at, sent_at, error_code)
SELECT 'KM16_SQL_FIXTURE', s.case_name || '@example.invalid',
       s.state, s.attempted_at,
       CASE WHEN s.state = 'accepted' THEN s.attempted_at END,
       CASE WHEN s.state = 'failed' THEN 'FICTIONAL_FAILURE' END
FROM km16_scenarios AS s ORDER BY s.case_no;

CREATE TEMP TABLE km16_before_hash AS
SELECT 'achats'::text AS source,
       md5(jsonb_agg(to_jsonb(n) ORDER BY n.id)::text) AS digest
FROM public.km16_admin_purchase_notifications AS n
UNION ALL
SELECT 'emails_programmes', md5(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text)
FROM public.km16_scheduled_mail_deliveries AS d
UNION ALL
SELECT 'campagnes', md5(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text)
FROM public.km16_scheduled_campaigns AS c;

-- Inclusion relative au présent fichier, indépendante du répertoire de lancement.
\ir ../supabase/sql/km16_preparer_relances.sql

CREATE TEMP TABLE km16_expected AS
SELECT 'achats'::text AS categorie, n.id AS notification_id,
       n.event_key AS reference, n.recipient AS destinataire, n.state AS statut,
       n.attempted_at AS derniere_tentative, s.expected_action AS action_requise
FROM km16_scenarios AS s
JOIN public.km16_admin_purchase_notifications AS n
  ON n.event_key = 'fixture:purchase:' || s.case_name
WHERE s.expected_action IS NOT NULL
UNION ALL
SELECT 'emails_programmes', d.id, d.campaign_id, d.email,
       d.state, d.attempted_at, s.expected_action
FROM km16_scenarios AS s
JOIN public.km16_scheduled_mail_deliveries AS d
  ON d.email = s.case_name || '@example.invalid'
WHERE s.expected_action IS NOT NULL;
CREATE TEMP TABLE km16_actual AS
SELECT * FROM public.km16_preparer_relances() WITH NO DATA;
GRANT INSERT, SELECT ON km16_actual TO service_role;

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.km16_actual SELECT * FROM public.km16_preparer_relances();
RESET ROLE;

DO $assertions$
BEGIN
    IF (SELECT count(*) FROM public.km16_admin_purchase_notifications) <> 7
       OR (SELECT count(*) FROM public.km16_scheduled_mail_deliveries) <> 7
       OR (SELECT count(*) FROM km16_actual) <> 6 THEN
        RAISE EXCEPTION '14 scénarios attendus : 6 alertes incluses, 8 cas exclus';
    END IF;
    IF EXISTS (
        (SELECT * FROM km16_actual EXCEPT ALL SELECT * FROM km16_expected)
        UNION ALL
        (SELECT * FROM km16_expected EXCEPT ALL SELECT * FROM km16_actual)
    ) THEN
        RAISE EXCEPTION 'Alertes ou actions différentes des résultats attendus';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc AS p JOIN pg_language AS l ON l.oid = p.prolang
        WHERE p.oid = 'public.km16_preparer_relances()'::regprocedure
          AND NOT p.prosecdef AND p.provolatile = 's' AND l.lanname = 'sql'
          AND p.proconfig @> ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'LANGUAGE SQL, STABLE, SECURITY INVOKER et search_path vide requis';
    END IF;
    IF has_function_privilege('anon', 'public.km16_preparer_relances()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.km16_preparer_relances()', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.km16_preparer_relances()', 'EXECUTE') THEN
        RAISE EXCEPTION 'Droits EXECUTE incorrects';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc AS p,
             LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
        WHERE p.oid = 'public.km16_preparer_relances()'::regprocedure
          AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'PUBLIC ne doit pas disposer de EXECUTE';
    END IF;
END;
$assertions$;

SET LOCAL ROLE anon;
DO $anon_denied$
DECLARE denied boolean := false;
BEGIN
    IF (SELECT count(*) FROM public.km16_admin_purchase_notifications) <> 7 THEN
        RAISE EXCEPTION 'Le témoin SELECT des fixtures doit fonctionner';
    END IF;
    BEGIN
        PERFORM * FROM public.km16_preparer_relances();
    EXCEPTION WHEN insufficient_privilege THEN
        denied := true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'anon a pu exécuter la fonction'; END IF;
END;
$anon_denied$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated_denied$
DECLARE denied boolean := false;
BEGIN
    IF (SELECT count(*) FROM public.km16_scheduled_mail_deliveries) <> 7 THEN
        RAISE EXCEPTION 'Le témoin SELECT des fixtures doit fonctionner';
    END IF;
    BEGIN
        PERFORM * FROM public.km16_preparer_relances();
    EXCEPTION WHEN insufficient_privilege THEN
        denied := true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'authenticated a pu exécuter la fonction'; END IF;
END;
$authenticated_denied$;
RESET ROLE;

DO $unchanged$
BEGIN
    IF EXISTS (
        SELECT 1 FROM km16_before_hash AS b
        JOIN (
            SELECT 'achats'::text AS source,
                   md5(jsonb_agg(to_jsonb(n) ORDER BY n.id)::text) AS digest
            FROM public.km16_admin_purchase_notifications AS n
            UNION ALL
            SELECT 'emails_programmes', md5(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text)
            FROM public.km16_scheduled_mail_deliveries AS d
            UNION ALL
            SELECT 'campagnes', md5(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text)
            FROM public.km16_scheduled_campaigns AS c
        ) AS a USING (source)
        WHERE a.digest IS DISTINCT FROM b.digest
    ) THEN
        RAISE EXCEPTION 'Une donnée a changé pendant les consultations';
    END IF;
END;
$unchanged$;

SELECT categorie, count(*) AS alertes
FROM km16_actual GROUP BY categorie ORDER BY categorie;
ROLLBACK;

DO $rolled_back$
BEGIN
    IF to_regclass('public.km16_admin_purchase_notifications') IS NOT NULL
       OR to_regclass('public.km16_scheduled_mail_deliveries') IS NOT NULL
       OR to_regclass('public.km16_scheduled_campaigns') IS NOT NULL
       OR to_regprocedure('public.km16_preparer_relances()') IS NOT NULL
       OR to_regclass('pg_temp.km16_actual') IS NOT NULL THEN
        RAISE EXCEPTION 'Des objets du test subsistent après ROLLBACK';
    END IF;
END;
$rolled_back$;
SELECT 'TEST_RELANCES_KM16_OK - 14 scenarios, 6 alertes, 8 exclusions, donnees inchangees, rollback verifie' AS resultat;
