-- Disposable PostgreSQL fixture only. No mail worker, credentials or network.
DO $$ BEGIN
  IF to_regclass('public.km16_membership_orders') IS NOT NULL
     OR to_regclass('public.km16_checkout_reminders') IS NOT NULL THEN
    RAISE EXCEPTION 'Refused: existing KM16 database';
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END; $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- Deliberately no SELECT auth.users grant: the production service role lacks it.

CREATE TABLE public.km16_membership_products (
  id text PRIMARY KEY, title text NOT NULL, kind text NOT NULL,
  category text NOT NULL, amount integer NOT NULL, draft boolean NOT NULL DEFAULT false,
  event_date date
);
CREATE TABLE public.km16_membership_config (
  id integer PRIMARY KEY, enabled boolean NOT NULL, season_end date NOT NULL
);
INSERT INTO public.km16_membership_config VALUES (1,true,'2027-07-01');
CREATE TABLE public.km16_membership_orders (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
  email text NOT NULL, product_id text NOT NULL REFERENCES public.km16_membership_products(id),
  title text NOT NULL, livemode boolean NOT NULL, total_cents integer NOT NULL CHECK (total_cents>=0),
  amounts jsonb NOT NULL, stripe_session_id text UNIQUE,
  first_name text NOT NULL DEFAULT 'Fixture', last_name text NOT NULL DEFAULT 'Person',
  birth_date date NOT NULL DEFAULT '2000-01-01', participant_key text,
  approval text NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), purchase_link_id uuid
);
CREATE TABLE public.km16_membership_payments (
  reference text PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.km16_membership_orders(id),
  status text NOT NULL CHECK (status IN ('paid','pending','failed','refunded','disputed')),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents>=0)
);
CREATE TABLE public.km16_purchase_links (
  id uuid PRIMARY KEY, order_id uuid UNIQUE REFERENCES public.km16_membership_orders(id),
  livemode boolean NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  total_cents integer NOT NULL DEFAULT 63000
);
ALTER TABLE public.km16_membership_orders ADD FOREIGN KEY (purchase_link_id) REFERENCES public.km16_purchase_links(id);
CREATE TABLE public.km16_shirt_orders (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), email text NOT NULL,
  sizes text[] NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents IN (1800,3000)),
  stripe_session_id text UNIQUE, livemode boolean NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.km16_videos (
  id text PRIMARY KEY, title text NOT NULL, price_cents integer NOT NULL CHECK (price_cents>0),
  currency text NOT NULL CHECK (currency='eur'), published boolean NOT NULL
);
CREATE TABLE public.km16_purchases (
  stripe_checkout_session_id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
  video_id text NOT NULL REFERENCES public.km16_videos(id),
  status text NOT NULL CHECK (status IN ('paid','refunded','disputed','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.km16_membership_products, public.km16_membership_config,
  public.km16_membership_orders, public.km16_membership_payments, public.km16_purchase_links,
  public.km16_shirt_orders, public.km16_videos, public.km16_purchases TO service_role;

-- Historical unpaid checkout: applying the migration must not enqueue it.
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000000');
INSERT INTO public.km16_membership_products VALUES ('historic','Historic fixture','annual','Adultes',63000,false,NULL);
INSERT INTO public.km16_membership_orders
  (id,user_id,email,product_id,title,livemode,total_cents,amounts,stripe_session_id,created_at)
VALUES ('20000000-0000-4000-8000-000000000000','10000000-0000-4000-8000-000000000000',
 'historic@example.invalid','historic','Historic fixture',true,63000,'[21000,21000,21000]',
 'cs_live_historic','2026-11-01 10:00:00+00');
