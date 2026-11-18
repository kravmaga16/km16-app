-- PostgreSQL 17 isolé : journal administratif, sans Supabase, worker ni cron.
-- Exécuter uniquement avec psql -X dans la base dédiée email_relances_test.
-- Les fixtures, le journal, la RPC et les changements de rôles sont annulés.
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
       OR to_regclass('public.km16_email_alert_reviews') IS NOT NULL
       OR EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'km16_record_email_alert_review'
       ) THEN
        RAISE EXCEPTION 'Test refusé : des objets KM16 existent déjà';
    END IF;
END;
$guard$;

BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';

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
        WHERE (rolname IN ('anon', 'authenticated') AND (rolsuper OR rolbypassrls))
           OR (rolname = 'service_role' AND rolsuper)
    ) THEN
        RAISE EXCEPTION 'Test refusé : privilèges de rôles incompatibles avec les contrôles';
    END IF;
    -- Reproduit le rôle Supabase, tout en conservant les contrôles de privilèges.
    -- Cet ALTER ROLE et les éventuels CREATE ROLE sont annulés au ROLLBACK.
    ALTER ROLE service_role BYPASSRLS;
END;
$roles$;

-- Sources fictives : mêmes champs utiles, sans déclencheurs et sans dépendances
-- métier. campaign_id n'a volontairement pas de FK vers une campagne réelle.
CREATE TABLE public.km16_admin_purchase_notifications (
    id bigint PRIMARY KEY,
    event_key text NOT NULL UNIQUE,
    kind text NOT NULL,
    buyer_name text NOT NULL,
    product_name text NOT NULL,
    amount_cents integer NOT NULL CHECK (amount_cents >= 0),
    paid_at timestamptz NOT NULL,
    recipient text NOT NULL,
    state text NOT NULL CHECK (state IN ('pending', 'sending', 'accepted', 'failed', 'uncertain')),
    created_at timestamptz NOT NULL DEFAULT now(),
    attempted_at timestamptz,
    sent_at timestamptz,
    error_code text
);
CREATE TABLE public.km16_scheduled_mail_deliveries (
    id bigint PRIMARY KEY,
    campaign_id text NOT NULL,
    email text NOT NULL,
    state text NOT NULL CHECK (state IN ('pending', 'sending', 'accepted', 'failed', 'uncertain')),
    attempted_at timestamptz,
    sent_at timestamptz,
    error_code text,
    UNIQUE (campaign_id, email)
);
ALTER TABLE public.km16_admin_purchase_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.km16_scheduled_mail_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.km16_admin_purchase_notifications,
    public.km16_scheduled_mail_deliveries FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- SELECT FOR SHARE nécessite aussi UPDATE ; ces droits appartiennent uniquement
-- aux fixtures. La migration testée ne doit pas ajouter de droits aux sources.
GRANT SELECT, UPDATE ON public.km16_admin_purchase_notifications,
    public.km16_scheduled_mail_deliveries TO service_role;

CREATE TEMP TABLE km16_review_scenarios (
    id bigint PRIMARY KEY, state text NOT NULL, attempted_at timestamptz,
    is_actionable boolean NOT NULL
);
-- now() est fixe dans la transaction, notamment pour la borne exacte de 15 min.
INSERT INTO km16_review_scenarios VALUES
    (1, 'failed', now() - interval '1 hour', true),
    (2, 'uncertain', now() - interval '2 hours', true),
    (3, 'sending', now() - interval '30 minutes', true),
    (4, 'sending', now() - interval '5 minutes', false),
    (5, 'sending', now() - interval '15 minutes', false),
    (6, 'pending', NULL, false),
    (7, 'accepted', now() - interval '1 day', false),
    (8, 'failed', NULL, true),
    (9, 'uncertain', NULL, true),
    (10, 'sending', NULL, false);
INSERT INTO public.km16_admin_purchase_notifications
    (id, event_key, kind, buyer_name, product_name, amount_cents, paid_at,
     recipient, state, attempted_at, sent_at, error_code)
SELECT id, 'fixture:review:' || id, 'test', 'Personne fictive', 'Produit fictif',
       0, now(), 'purchase' || id || '@example.invalid', state, attempted_at,
       CASE WHEN state = 'accepted' THEN attempted_at END,
       CASE WHEN state = 'failed' THEN 'FICTIONAL_FAILURE' END
FROM km16_review_scenarios;
INSERT INTO public.km16_scheduled_mail_deliveries
    (id, campaign_id, email, state, attempted_at, sent_at, error_code)
SELECT id, 'KM16_REVIEW_FIXTURE', 'campaign' || id || '@example.invalid',
       state, attempted_at,
       CASE WHEN state = 'accepted' THEN attempted_at END,
       CASE WHEN state = 'failed' THEN 'FICTIONAL_FAILURE' END
FROM km16_review_scenarios;

CREATE TEMP TABLE km16_review_source_before AS
SELECT 'achats'::text AS categorie,
       md5(jsonb_agg(to_jsonb(n) ORDER BY id)::text) AS digest
FROM public.km16_admin_purchase_notifications n
UNION ALL
SELECT 'emails_programmes', md5(jsonb_agg(to_jsonb(d) ORDER BY id)::text)
FROM public.km16_scheduled_mail_deliveries d;
CREATE TEMP TABLE km16_review_source_acl_before AS
SELECT oid, relacl FROM pg_class
WHERE oid IN ('public.km16_admin_purchase_notifications'::regclass,
              'public.km16_scheduled_mail_deliveries'::regclass);

\ir ../supabase/migrations/20261118134753_email_alert_review_journal.sql

-- Payloads de test réutilisés pour les succès, les replays et les refus.
CREATE TEMP TABLE km16_review_requests AS
SELECT c.categorie || ':' || s.id AS scenario,
       jsonb_build_object(
           'request_id', md5('km16-review:' || c.categorie || ':' || s.id)::uuid,
           'categorie', c.categorie, 'notification_id', s.id,
           'expected_state', s.state, 'expected_attempted_at', s.attempted_at,
           'expected_last_review_id', 0, 'decision', 'verification_effectuee',
           'note', CASE s.id WHEN 8 THEN E'\t abc \n'
                    WHEN 9 THEN '  ' || repeat('x', 1000) || '  '
                    ELSE '  Vérification manuelle complète.  ' END,
           'actor_id', '11111111-1111-4111-8111-111111111111'
       ) AS payload,
       CASE s.id WHEN 8 THEN 'abc' WHEN 9 THEN repeat('x', 1000)
            ELSE 'Vérification manuelle complète.' END AS expected_note
FROM km16_review_scenarios s
CROSS JOIN (VALUES ('achats'::text), ('emails_programmes'::text)) c(categorie)
WHERE s.is_actionable;
CREATE TEMP TABLE km16_review_results AS
SELECT NULL::text AS scenario, r.* FROM public.km16_email_alert_reviews r WITH NO DATA;
DO $temp_acl$
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role',
        (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()));
END;
$temp_acl$;
GRANT SELECT ON km16_review_requests TO service_role;
GRANT INSERT, SELECT ON km16_review_results TO service_role;

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.km16_review_results
SELECT q.scenario, r.*
FROM pg_temp.km16_review_requests q
CROSS JOIN LATERAL public.km16_record_email_alert_review(
    (q.payload->>'request_id')::uuid, q.payload->>'categorie',
    (q.payload->>'notification_id')::bigint, q.payload->>'expected_state',
    (q.payload->>'expected_attempted_at')::timestamptz,
    (q.payload->>'expected_last_review_id')::bigint, q.payload->>'decision',
    q.payload->>'note', (q.payload->>'actor_id')::uuid
) r;
RESET ROLE;

DO $first_reviews$
BEGIN
    IF (SELECT count(*) FROM public.km16_email_alert_reviews) <> 10
       OR (SELECT count(*) FROM km16_review_results) <> 10 THEN
        RAISE EXCEPTION 'Une ligne de journal par succès attendue, soit dix lignes';
    END IF;
    IF EXISTS (
        SELECT 1 FROM km16_review_requests q
        LEFT JOIN km16_review_results r USING (scenario)
        WHERE r.request_id IS DISTINCT FROM (q.payload->>'request_id')::uuid
           OR r.categorie IS DISTINCT FROM q.payload->>'categorie'
           OR r.notification_id IS DISTINCT FROM (q.payload->>'notification_id')::bigint
           OR r.observed_state IS DISTINCT FROM q.payload->>'expected_state'
           OR r.observed_attempted_at IS DISTINCT FROM (q.payload->>'expected_attempted_at')::timestamptz
           OR r.previous_review_id IS DISTINCT FROM 0::bigint
           OR r.decision IS DISTINCT FROM 'verification_effectuee'
           OR r.note IS DISTINCT FROM q.expected_note
           OR r.recorded_by IS DISTINCT FROM (q.payload->>'actor_id')::uuid
           OR r.recorded_at IS NULL OR r.recorded_at < now() OR r.recorded_at > clock_timestamp()
    ) THEN
        RAISE EXCEPTION 'Identité, note normalisée, état observé ou horodatage incorrect';
    END IF;
    IF EXISTS (
        SELECT 1 FROM km16_review_results r
        LEFT JOIN public.km16_email_alert_reviews j USING (id)
        WHERE (to_jsonb(r) - 'scenario') IS DISTINCT FROM to_jsonb(j)
    ) THEN
        RAISE EXCEPTION 'La RPC doit retourner exactement la ligne enregistrée';
    END IF;
END;
$first_reviews$;
CREATE TEMP TABLE km16_review_initial_journal AS SELECT * FROM public.km16_email_alert_reviews;
GRANT SELECT ON km16_review_initial_journal TO service_role;

-- Trois décisions successives pour la même notification restent trois événements.
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.km16_review_results
SELECT 'history_2', r.* FROM public.km16_record_email_alert_review(
    '22222222-0000-4000-8000-000000000002', 'achats', 1, 'failed',
    now() - interval '1 hour',
    (SELECT id FROM pg_temp.km16_review_results WHERE scenario = 'achats:1'),
    'a_reexaminer', '  À réexaminer après retour du prestataire.  ',
    '22222222-2222-4222-8222-222222222222'
) r;
INSERT INTO pg_temp.km16_review_results
SELECT 'history_3', r.* FROM public.km16_record_email_alert_review(
    '33333333-0000-4000-8000-000000000003', 'achats', 1, 'failed',
    now() - interval '1 hour',
    (SELECT id FROM pg_temp.km16_review_results WHERE scenario = 'history_2'),
    'ne_pas_relancer', 'Décision administrative conservée sans nouvel envoi.',
    '22222222-2222-4222-8222-222222222222'
) r;
RESET ROLE;

DO $history$
DECLARE initial_id bigint; second_id bigint; third_id bigint;
BEGIN
    SELECT id INTO STRICT initial_id FROM km16_review_results WHERE scenario = 'achats:1';
    SELECT id INTO STRICT second_id FROM km16_review_results WHERE scenario = 'history_2';
    SELECT id INTO STRICT third_id FROM km16_review_results WHERE scenario = 'history_3';
    IF NOT (initial_id < second_id AND second_id < third_id)
       OR (SELECT count(*) FROM public.km16_email_alert_reviews) <> 12
       OR (SELECT previous_review_id FROM public.km16_email_alert_reviews WHERE id = second_id) <> initial_id
       OR (SELECT previous_review_id FROM public.km16_email_alert_reviews WHERE id = third_id) <> second_id
       OR (SELECT decision FROM public.km16_email_alert_reviews WHERE id = second_id) <> 'a_reexaminer'
       OR (SELECT decision FROM public.km16_email_alert_reviews WHERE id = third_id) <> 'ne_pas_relancer'
       OR (SELECT recorded_by FROM public.km16_email_alert_reviews WHERE id = third_id)
          <> '22222222-2222-4222-8222-222222222222'::uuid THEN
        RAISE EXCEPTION 'Ordre, chaînage, décision ou auteur de l''historique incorrect';
    END IF;
END;
$history$;
CREATE TEMP TABLE km16_review_journal_before_errors AS
SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) AS digest
FROM public.km16_email_alert_reviews r;

-- Seules mutations volontaires des sources : elles sont immédiatement annulées.
-- Même après évolution de la livraison ET du journal, un replay restitue l'événement.
SAVEPOINT km16_review_source_evolution;
UPDATE public.km16_admin_purchase_notifications
SET state = 'accepted', attempted_at = now(), sent_at = now() WHERE id = 1;
UPDATE public.km16_scheduled_mail_deliveries
SET state = 'accepted', attempted_at = now(), sent_at = now() WHERE id = 1;
SET LOCAL ROLE service_role;
DO $replay$
DECLARE q record; actual public.km16_email_alert_reviews%ROWTYPE;
        original public.km16_email_alert_reviews%ROWTYPE;
BEGIN
    FOR q IN SELECT * FROM pg_temp.km16_review_requests LOOP
        SELECT * INTO STRICT actual FROM public.km16_record_email_alert_review(
            (q.payload->>'request_id')::uuid, q.payload->>'categorie',
            (q.payload->>'notification_id')::bigint, q.payload->>'expected_state',
            (q.payload->>'expected_attempted_at')::timestamptz, 0,
            q.payload->>'decision', q.expected_note, (q.payload->>'actor_id')::uuid
        );
        SELECT * INTO STRICT original FROM pg_temp.km16_review_initial_journal
        WHERE request_id = (q.payload->>'request_id')::uuid;
        IF to_jsonb(actual) IS DISTINCT FROM to_jsonb(original) THEN
            RAISE EXCEPTION 'Replay différent de la réponse initiale : %', q.scenario;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.km16_email_alert_reviews) <> 12 THEN
        RAISE EXCEPTION 'Un replay a ajouté une ligne au journal';
    END IF;
END;
$replay$;
RESET ROLE;
ROLLBACK TO SAVEPOINT km16_review_source_evolution;
RELEASE SAVEPOINT km16_review_source_evolution;

-- Base valide courante ; chaque scénario ne change que la propriété à refuser.
CREATE TEMP TABLE km16_review_base_request AS
SELECT q.payload || jsonb_build_object('expected_last_review_id', r.id) AS payload
FROM km16_review_requests q CROSS JOIN km16_review_results r
WHERE q.scenario = 'achats:1' AND r.scenario = 'history_3';
CREATE TEMP TABLE km16_review_rejections (
    scenario text PRIMARY KEY, overrides jsonb NOT NULL,
    expected_code text NOT NULL DEFAULT '22023'
);
INSERT INTO km16_review_rejections (scenario, overrides) VALUES
    ('request_null', '{"request_id":null}'),
    ('actor_null', '{"actor_id":null}'),
    ('category_unknown', '{"categorie":"autre"}'),
    ('category_null', '{"categorie":null}'),
    ('id_zero', '{"notification_id":0}'),
    ('id_null', '{"notification_id":null}'),
    ('state_unknown', '{"expected_state":"unknown"}'),
    ('state_null', '{"expected_state":null}'),
    ('attempt_infinite', '{"expected_attempted_at":"infinity"}'),
    ('revision_negative', '{"expected_last_review_id":-1}'),
    ('revision_null', '{"expected_last_review_id":null}'),
    ('decision_unknown', '{"decision":"renvoyer"}'),
    ('decision_null', '{"decision":null}'),
    ('note_null', '{"note":null}'),
    ('note_blank', jsonb_build_object('note', E' \t\n ')),
    ('note_short_after_trim', '{"note":"  ab  "}'),
    ('note_too_long', jsonb_build_object('note', repeat('x', 1001)));
INSERT INTO km16_review_rejections VALUES
    ('stale_state', '{"expected_state":"uncertain"}', 'PT409'),
    ('stale_attempt', jsonb_build_object('expected_attempted_at', now() - interval '59 minutes'), 'PT409'),
    ('stale_attempt_null', '{"expected_attempted_at":null}', 'PT409'),
    ('stale_revision', '{"expected_last_review_id":0}', 'PT409'),
    ('missing_purchase', '{"notification_id":9999,"expected_last_review_id":0}', 'PT404'),
    ('missing_campaign', '{"categorie":"emails_programmes","notification_id":9999,"expected_last_review_id":0}', 'PT404');
INSERT INTO km16_review_rejections
SELECT 'not_actionable:' || c.categorie || ':' || s.id,
       jsonb_build_object('categorie', c.categorie, 'notification_id', s.id,
           'expected_state', s.state, 'expected_attempted_at', s.attempted_at,
           'expected_last_review_id', 0), 'PT409'
FROM km16_review_scenarios s
CROSS JOIN (VALUES ('achats'::text), ('emails_programmes'::text)) c(categorie)
WHERE NOT s.is_actionable;
INSERT INTO km16_review_rejections
SELECT 'stale_nullable_attempt:' || q.scenario,
       q.payload || jsonb_build_object(
           'request_id', md5('stale-null:' || q.scenario)::uuid,
           'expected_last_review_id', r.id, 'expected_attempted_at', now()), 'PT409'
FROM km16_review_requests q JOIN km16_review_results r USING (scenario)
WHERE q.scenario IN ('achats:8', 'emails_programmes:8');

-- Un request_id existant ne peut pas être réutilisé avec une autre charge.
INSERT INTO km16_review_rejections
SELECT 'reused_request:' || v.field, q.payload || v.changed, 'PT409'
FROM km16_review_requests q
CROSS JOIN (VALUES
    ('category', '{"categorie":"emails_programmes"}'::jsonb),
    ('notification', '{"notification_id":2}'::jsonb),
    ('state', '{"expected_state":"uncertain"}'::jsonb),
    ('attempt', '{"expected_attempted_at":null}'::jsonb),
    ('revision', '{"expected_last_review_id":1}'::jsonb),
    ('decision', '{"decision":"ne_pas_relancer"}'::jsonb),
    ('note', '{"note":"Autre note administrative."}'::jsonb),
    ('actor', '{"actor_id":"22222222-2222-4222-8222-222222222222"}'::jsonb)
) v(field, changed)
WHERE q.scenario = 'achats:1';
GRANT SELECT ON km16_review_base_request, km16_review_rejections TO service_role;

SET LOCAL ROLE service_role;
DO $rejections$
DECLARE q record; payload jsonb; base jsonb; actual_code text;
BEGIN
    SELECT b.payload INTO STRICT base FROM pg_temp.km16_review_base_request b;
    FOR q IN SELECT * FROM pg_temp.km16_review_rejections ORDER BY scenario LOOP
        payload := base || jsonb_build_object('request_id', md5('reject:' || q.scenario)::uuid)
                   || q.overrides;
        actual_code := NULL;
        BEGIN
            PERFORM * FROM public.km16_record_email_alert_review(
                (payload->>'request_id')::uuid, payload->>'categorie',
                (payload->>'notification_id')::bigint, payload->>'expected_state',
                (payload->>'expected_attempted_at')::timestamptz,
                (payload->>'expected_last_review_id')::bigint,
                payload->>'decision', payload->>'note', (payload->>'actor_id')::uuid
            );
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS actual_code = RETURNED_SQLSTATE;
        END;
        IF actual_code IS DISTINCT FROM q.expected_code THEN
            RAISE EXCEPTION 'Scénario % : SQLSTATE attendu %, obtenu %',
                q.scenario, q.expected_code, coalesce(actual_code, 'aucune erreur');
        END IF;
    END LOOP;
END;
$rejections$;
RESET ROLE;

DO $privileges$
DECLARE signature text := 'public.km16_record_email_alert_review(uuid,text,bigint,text,timestamptz,bigint,text,text,uuid)';
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p WHERE p.oid = signature::regprocedure
          AND NOT p.prosecdef AND p.provolatile = 'v'
          AND p.proconfig @> ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'RPC SECURITY INVOKER, VOLATILE et search_path vide requis';
    END IF;
    IF has_function_privilege('anon', signature, 'EXECUTE')
       OR has_function_privilege('authenticated', signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', signature, 'EXECUTE')
       OR EXISTS (
           SELECT 1 FROM pg_proc p,
                LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           WHERE p.oid = signature::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'ACL EXECUTE de la RPC incorrecte';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.km16_email_alert_reviews'::regclass)
       OR NOT has_table_privilege('service_role', 'public.km16_email_alert_reviews', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.km16_email_alert_reviews', 'INSERT')
       OR has_table_privilege('service_role', 'public.km16_email_alert_reviews', 'UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('anon', 'public.km16_email_alert_reviews', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('authenticated', 'public.km16_email_alert_reviews', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR NOT has_sequence_privilege('service_role', 'public.km16_email_alert_reviews_id_seq', 'USAGE')
       OR has_sequence_privilege('anon', 'public.km16_email_alert_reviews_id_seq', 'USAGE,SELECT,UPDATE')
       OR has_sequence_privilege('authenticated', 'public.km16_email_alert_reviews_id_seq', 'USAGE,SELECT,UPDATE') THEN
        RAISE EXCEPTION 'RLS ou privilèges append-only du journal incorrects';
    END IF;
    IF EXISTS (
        SELECT 1 FROM km16_review_source_acl_before b JOIN pg_class c USING (oid)
        WHERE b.relacl IS DISTINCT FROM c.relacl
    ) THEN
        RAISE EXCEPTION 'La migration a changé les privilèges des sources';
    END IF;
END;
$privileges$;

CREATE FUNCTION pg_temp.km16_review_expect_error(command text, expected_code text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $helper$
DECLARE actual_code text;
BEGIN
    BEGIN
        EXECUTE command;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_code = RETURNED_SQLSTATE;
    END;
    IF actual_code IS DISTINCT FROM expected_code THEN
        RAISE EXCEPTION 'SQLSTATE attendu %, obtenu % pour %',
            expected_code, coalesce(actual_code, 'aucune erreur'), command;
    END IF;
END;
$helper$;
GRANT EXECUTE ON FUNCTION pg_temp.km16_review_expect_error(text, text)
TO anon, authenticated, service_role;

SET LOCAL ROLE anon;
SELECT pg_temp.km16_review_expect_error($sql$
    SELECT * FROM public.km16_record_email_alert_review(
        'aaaaaaaa-0000-4000-8000-000000000001', 'achats', 1, 'failed',
        now() - interval '1 hour', 0, 'verification_effectuee', 'Test de refus',
        '11111111-1111-4111-8111-111111111111')
$sql$, '42501');
SELECT pg_temp.km16_review_expect_error('SELECT * FROM public.km16_email_alert_reviews', '42501');
SELECT pg_temp.km16_review_expect_error('INSERT INTO public.km16_email_alert_reviews DEFAULT VALUES', '42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.km16_review_expect_error($sql$
    SELECT * FROM public.km16_record_email_alert_review(
        'aaaaaaaa-0000-4000-8000-000000000002', 'achats', 1, 'failed',
        now() - interval '1 hour', 0, 'verification_effectuee', 'Test de refus',
        '11111111-1111-4111-8111-111111111111')
$sql$, '42501');
SELECT pg_temp.km16_review_expect_error('SELECT * FROM public.km16_email_alert_reviews', '42501');
SELECT pg_temp.km16_review_expect_error('INSERT INTO public.km16_email_alert_reviews DEFAULT VALUES', '42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.km16_review_expect_error(
    'UPDATE public.km16_email_alert_reviews SET note = ''Modification interdite''', '42501');
SELECT pg_temp.km16_review_expect_error('DELETE FROM public.km16_email_alert_reviews', '42501');
RESET ROLE;

-- Vérifie la RLS indépendamment des ACL : même avec SELECT accordé temporairement,
-- anon et authenticated ne doivent voir aucune ligne du journal.
SAVEPOINT km16_review_rls_probe;
GRANT SELECT ON public.km16_email_alert_reviews TO anon, authenticated;
SET LOCAL ROLE anon;
DO $rls_anon$
BEGIN
    IF EXISTS (SELECT 1 FROM public.km16_email_alert_reviews) THEN
        RAISE EXCEPTION 'RLS : anon voit le journal';
    END IF;
END;
$rls_anon$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $rls_authenticated$
BEGIN
    IF EXISTS (SELECT 1 FROM public.km16_email_alert_reviews) THEN
        RAISE EXCEPTION 'RLS : authenticated voit le journal';
    END IF;
END;
$rls_authenticated$;
RESET ROLE;
ROLLBACK TO SAVEPOINT km16_review_rls_probe;
RELEASE SAVEPOINT km16_review_rls_probe;

DO $integrity$
BEGIN
    IF EXISTS (
        SELECT 1 FROM km16_review_source_before b JOIN (
            SELECT 'achats'::text AS categorie, md5(jsonb_agg(to_jsonb(n) ORDER BY id)::text) AS digest
            FROM public.km16_admin_purchase_notifications n
            UNION ALL
            SELECT 'emails_programmes', md5(jsonb_agg(to_jsonb(d) ORDER BY id)::text)
            FROM public.km16_scheduled_mail_deliveries d
        ) a USING (categorie) WHERE a.digest IS DISTINCT FROM b.digest
    ) THEN
        RAISE EXCEPTION 'Une donnée des sources a changé';
    END IF;
    IF EXISTS (
        SELECT 1 FROM km16_review_initial_journal initial
        LEFT JOIN public.km16_email_alert_reviews stored USING (id)
        WHERE to_jsonb(initial) IS DISTINCT FROM to_jsonb(stored)
    ) THEN
        RAISE EXCEPTION 'Une ligne historique a été modifiée ou supprimée';
    END IF;
    IF (SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM public.km16_email_alert_reviews r)
       IS DISTINCT FROM (SELECT digest FROM km16_review_journal_before_errors) THEN
        RAISE EXCEPTION 'Un replay, un refus ou un contrôle d''accès a changé le journal';
    END IF;
END;
$integrity$;

SELECT categorie, count(*) AS evenements FROM public.km16_email_alert_reviews
GROUP BY categorie ORDER BY categorie;
SELECT count(*) AS scenarios_de_refus_verifies FROM km16_review_rejections;
ROLLBACK;

DO $rolled_back$
BEGIN
    IF to_regclass('public.km16_admin_purchase_notifications') IS NOT NULL
       OR to_regclass('public.km16_scheduled_mail_deliveries') IS NOT NULL
       OR to_regclass('public.km16_email_alert_reviews') IS NOT NULL
       OR to_regclass('pg_temp.km16_review_results') IS NOT NULL
       OR EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'km16_record_email_alert_review'
       ) THEN
        RAISE EXCEPTION 'Des objets du test subsistent après ROLLBACK';
    END IF;
END;
$rolled_back$;
SELECT 'TEST_EMAIL_REVIEWS_KM16_OK - succes, historique, replays, conflits, droits, sources inchangees, rollback verifie' AS resultat;
