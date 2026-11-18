-- Disposable local Supabase stack only. No KM16 migrations, cron or mail worker.
-- Invoked by email-relances-integration.mjs, which forces loopback host/port.
-- The stack is destroyed by CI after the test; this fixture intentionally commits
-- so the real Auth/PostgREST/Edge HTTP chain can read it from other sessions.
\set ON_ERROR_STOP on
\pset pager off
\if :{?km16_email_integration}
\else
    \echo 'Refused: explicit isolated integration marker required.'
    SELECT 1 / 0;
\endif
\if :{?fixture_observed_at}
\else
    \echo 'Refused: fixture observation time required.'
    SELECT 1 / 0;
\endif

BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';
SELECT set_config('km16.email_integration', :'km16_email_integration', true);
DO $guard$
BEGIN
    IF current_setting('km16.email_integration') <> '1'
       OR current_setting('application_name') <> 'km16-email-integration'
       OR current_database() <> 'postgres'
       OR session_user <> 'postgres' THEN
        RAISE EXCEPTION 'Refused: disposable local integration connection required';
    END IF;
    IF current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'PostgreSQL 17 is required';
    END IF;
    IF to_regclass('auth.users') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
        RAISE EXCEPTION 'A real isolated Supabase stack is required';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users) THEN
        RAISE EXCEPTION 'Refused: the disposable Auth database must be empty';
    END IF;
    IF to_regclass('public.km16_admin_purchase_notifications') IS NOT NULL
       OR to_regclass('public.km16_scheduled_mail_deliveries') IS NOT NULL
       OR to_regclass('public.km16_scheduled_campaigns') IS NOT NULL THEN
        RAISE EXCEPTION 'Refused: existing KM16 objects';
    END IF;
END;
$guard$;

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
    recipient text NOT NULL DEFAULT 'contact@km16.fr',
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
    public.km16_scheduled_mail_deliveries FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON public.km16_scheduled_campaigns,
    public.km16_admin_purchase_notifications,
    public.km16_scheduled_mail_deliveries TO service_role;
-- Match existing production worker grants: FOR SHARE needs UPDATE privilege.
-- The review RPC only locks and reads these sources; fingerprints detect writes.
GRANT UPDATE ON public.km16_admin_purchase_notifications,
    public.km16_scheduled_mail_deliveries TO service_role;
-- No RLS policies: the real service_role bypasses RLS. Browser roles have no SELECT.

CREATE TEMP TABLE fixture_cases (
    id integer PRIMARY KEY, name text, state text, attempted_at timestamptz
) ON COMMIT DROP;
INSERT INTO fixture_cases VALUES
    (1, 'failed', 'failed', NULL),
    (2, 'uncertain', 'uncertain', :'fixture_observed_at'::timestamptz),
    (3, 'sending_old', 'sending', :'fixture_observed_at'::timestamptz - interval '30 minutes'),
    (4, 'sending_recent', 'sending', :'fixture_observed_at'::timestamptz - interval '5 minutes'),
    (5, 'sending_exact', 'sending', :'fixture_observed_at'::timestamptz - interval '15 minutes'),
    (6, 'sending_missing', 'sending', NULL),
    (7, 'pending', 'pending', :'fixture_observed_at'::timestamptz - interval '1 day'),
    (8, 'accepted', 'accepted', :'fixture_observed_at'::timestamptz - interval '1 day'),
    (9, 'sending_older_1ms', 'sending', :'fixture_observed_at'::timestamptz - interval '15 minutes 0.001 seconds'),
    (10, 'sending_newer_1ms', 'sending', :'fixture_observed_at'::timestamptz - interval '14 minutes 59.999 seconds');
INSERT INTO fixture_cases
SELECT 10 + n, 'bulk_' || n, 'failed', NULL
FROM generate_series(1, 105) AS n;

INSERT INTO public.km16_scheduled_campaigns (id, send_on, season, subject, body)
VALUES ('KM16_HTTP_FIXTURE', CURRENT_DATE, 'TEST', 'Fictional test', 'No email send');
INSERT INTO public.km16_admin_purchase_notifications
    (event_key, kind, buyer_name, product_name, amount_cents, paid_at,
     recipient, state, attempted_at, sent_at, error_code)
SELECT 'fixture:purchase:' || c.name, 'test', 'Fictional person', 'Fictional item',
       0, now(), c.name || '@example.invalid', c.state, c.attempted_at,
       CASE WHEN c.state = 'accepted' THEN c.attempted_at END,
       CASE WHEN c.state = 'failed' THEN 'FICTIONAL_FAILURE' END
FROM fixture_cases AS c ORDER BY c.id;
INSERT INTO public.km16_scheduled_mail_deliveries
    (campaign_id, email, state, attempted_at, sent_at, error_code)
SELECT 'KM16_HTTP_FIXTURE', c.name || '@example.invalid', c.state, c.attempted_at,
       CASE WHEN c.state = 'accepted' THEN c.attempted_at END,
       CASE WHEN c.state = 'failed' THEN 'FICTIONAL_FAILURE' END
FROM fixture_cases AS c ORDER BY c.id;

NOTIFY pgrst, 'reload schema';
COMMIT;
