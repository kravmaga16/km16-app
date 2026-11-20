-- Disposable PostgreSQL only. Fictional identities, no network or mail.
DO $$ BEGIN
  IF to_regclass('public.km16_membership_orders') IS NOT NULL THEN
    RAISE EXCEPTION 'Refused: existing KM16 database';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END; $$;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
CREATE TABLE public.km16_membership_orders(
  id uuid PRIMARY KEY,user_id uuid NOT NULL,email text NOT NULL,
  product_id text NOT NULL,livemode boolean NOT NULL,total_cents integer NOT NULL,
  approval text NOT NULL DEFAULT 'pending',first_name text NOT NULL,last_name text NOT NULL,
  birth_date date NOT NULL,season_id text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.km16_automation_settings(id integer PRIMARY KEY,enabled boolean NOT NULL,token text NOT NULL);
INSERT INTO public.km16_automation_settings VALUES(1,true,repeat('test-only',8));
GRANT SELECT ON public.km16_membership_orders,public.km16_automation_settings TO service_role;
-- A historical live trial exists before the queue migration. It must stay unqueued.
INSERT INTO public.km16_membership_orders VALUES
('10000000-0000-4000-8000-000000000000','20000000-0000-4000-8000-000000000000',
 'historic@example.invalid','essai',true,0,'pending','Historical','Fixture','2000-01-01','2026/2027','2026-10-01');
