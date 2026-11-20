-- Checkout reminders are prospective and opt-in. No historical rows are added.
-- The Edge worker validates Stripe immediately before calling prepare/send.
CREATE TABLE public.km16_checkout_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('membership','shirts','video')),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254
    AND email ~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+[.][^[:space:]@<>;,]+$'),
  product_id text NOT NULL,
  group_key text NOT NULL,
  title text NOT NULL,
  sizes text[] NOT NULL DEFAULT '{}'::text[],
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  total_cents integer NOT NULL CHECK (total_cents >= amount_cents),
  stripe_session_id text CHECK (stripe_session_id ~ '^cs_live_[A-Za-z0-9]+$'),
  livemode boolean NOT NULL CHECK (livemode),
  opt_in boolean NOT NULL,
  consented_at timestamptz,
  consent_version text NOT NULL DEFAULT 'checkout-reminder-v1'
    CHECK (consent_version = 'checkout-reminder-v1'),
  created_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  next_check_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'preparing'
    CHECK (state IN ('preparing','pending','checking','sending','accepted','failed','uncertain','skipped')),
  lock_token uuid,
  locked_at timestamptz,
  attempted_at timestamptz,
  sent_at timestamptz,
  error_code text,
  unsubscribe_token_hash text UNIQUE CHECK (unsubscribe_token_hash ~ '^[a-f0-9]{64}$'),
  CHECK (opt_in = (consented_at IS NOT NULL)),
  CHECK (due_at = created_at + interval '24 hours'),
  CHECK (state NOT IN ('pending','checking','sending','accepted','failed','uncertain')
    OR (opt_in AND stripe_session_id IS NOT NULL))
);

CREATE TABLE public.km16_checkout_reminder_stops (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  stopped_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.km16_checkout_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.km16_checkout_reminder_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.km16_checkout_reminders, public.km16_checkout_reminder_stops
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.km16_checkout_reminders TO service_role;
GRANT SELECT, INSERT ON TABLE public.km16_checkout_reminder_stops TO service_role;

-- A resumed open session may be attached to the new explicit attempt after the
-- previous attempt was superseded. Its historical row keeps the session ID.
CREATE UNIQUE INDEX km16_checkout_reminders_active_session
  ON public.km16_checkout_reminders(stripe_session_id)
  WHERE state IN ('pending','checking','sending','accepted','uncertain');
CREATE UNIQUE INDEX km16_checkout_reminders_one_send_per_source
  ON public.km16_checkout_reminders(user_id,kind,source_id)
  WHERE state IN ('sending','accepted','uncertain');
CREATE INDEX km16_checkout_reminders_due
  ON public.km16_checkout_reminders(next_check_at,created_at,id)
  WHERE state IN ('pending','checking');
CREATE INDEX km16_checkout_reminders_group
  ON public.km16_checkout_reminders(user_id,kind,group_key,created_at DESC);
CREATE INDEX km16_checkout_reminders_recipient_send
  ON public.km16_checkout_reminders(email,attempted_at DESC)
  WHERE state IN ('sending','accepted','uncertain');
CREATE INDEX IF NOT EXISTS km16_membership_payments_order_state
  ON public.km16_membership_payments(order_id,status);

-- Tests replace only this clock in an isolated database. Production has no
-- test flag, configurable time, or caller-supplied eligibility timestamp.
CREATE FUNCTION public.km16_checkout_reminder_clock()
RETURNS timestamptz LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT pg_catalog.now(); $$;

CREATE FUNCTION public.km16_checkout_reminder_eligible(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.km16_checkout_reminders r
  WHERE r.id=p_id AND r.state IN ('pending','checking')
    AND r.opt_in AND r.livemode AND r.stripe_session_id IS NOT NULL
    AND r.created_at > public.km16_checkout_reminder_clock()-interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.km16_checkout_reminder_stops s WHERE s.email=r.email)
    AND NOT EXISTS (
      SELECT 1 FROM public.km16_checkout_reminders n
      WHERE n.user_id=r.user_id AND n.kind=r.kind AND n.group_key=r.group_key
        AND n.created_at>r.created_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.km16_checkout_reminders n
      WHERE n.user_id=r.user_id AND n.kind=r.kind AND n.source_id=r.source_id
        AND n.id<>r.id AND n.state IN ('sending','accepted','uncertain')
    )
    AND CASE r.kind
      WHEN 'membership' THEN EXISTS (
       SELECT 1 FROM public.km16_membership_orders o
       JOIN public.km16_membership_products p ON p.id=o.product_id
       JOIN public.km16_membership_config c ON c.id=1
       WHERE o.id::text=r.source_id AND o.user_id=r.user_id
        AND lower(btrim(o.email))=r.email AND o.product_id=r.product_id
        AND o.livemode AND o.total_cents=r.total_cents AND o.total_cents>0
        AND (o.amounts->>0)::integer=r.amount_cents
        AND o.stripe_session_id=r.stripe_session_id AND o.approval<>'rejected'
        AND c.enabled AND NOT p.draft AND p.category<>'Interne' AND p.kind<>'monthly' AND p.amount>0
        AND (p.event_date IS NULL OR p.event_date>=(public.km16_checkout_reminder_clock() AT TIME ZONE 'Europe/Paris')::date)
        AND (p.kind<>'annual' OR (
          c.season_end>=(public.km16_checkout_reminder_clock() AT TIME ZONE 'Europe/Paris')::date
          AND o.participant_key=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            'live|'||o.user_id::text||'|'||to_char(c.season_end,'YYYY-MM-DD')||'|'||
            lower(btrim(o.first_name))||'|'||lower(btrim(o.last_name))||'|'||to_char(o.birth_date,'YYYY-MM-DD'),
            'UTF8')),'hex')
        ))
        AND ((o.purchase_link_id IS NULL AND p.amount=o.total_cents) OR EXISTS (
          SELECT 1 FROM public.km16_purchase_links l
          WHERE l.id=o.purchase_link_id AND l.order_id=o.id AND l.livemode
            AND l.total_cents=o.total_cents
            AND l.revoked_at IS NULL AND l.expires_at>public.km16_checkout_reminder_clock()
        ))
        AND NOT EXISTS (
          SELECT 1 FROM public.km16_membership_payments pm WHERE pm.order_id=o.id
            AND (pm.status IN ('paid','refunded','disputed') OR pm.refunded_cents>0)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.km16_membership_orders newer
          JOIN public.km16_membership_payments pm ON pm.order_id=newer.id
          WHERE newer.user_id=r.user_id AND newer.product_id=r.product_id
            AND lower(btrim(newer.first_name))=lower(btrim(o.first_name))
            AND lower(btrim(newer.last_name))=lower(btrim(o.last_name)) AND newer.birth_date=o.birth_date
            AND newer.livemode AND newer.created_at>=r.created_at
            AND (pm.status IN ('paid','refunded','disputed') OR pm.refunded_cents>0)
        )
      )
      WHEN 'shirts' THEN EXISTS (
       SELECT 1 FROM public.km16_shirt_orders o
       WHERE o.id::text=r.source_id AND o.user_id=r.user_id
        AND lower(btrim(o.email))=r.email AND o.livemode
        AND o.status IN ('pending','cancelled') AND o.amount_cents=r.amount_cents
        AND o.stripe_session_id=r.stripe_session_id
        AND NOT EXISTS (
          SELECT 1 FROM public.km16_shirt_orders newer
          WHERE newer.user_id=r.user_id AND newer.livemode AND newer.status='paid'
            AND newer.created_at>=r.created_at
        )
      )
      WHEN 'video' THEN EXISTS (
       SELECT 1 FROM public.km16_videos v
       WHERE v.id=r.source_id AND v.id=r.product_id AND v.published
        AND v.currency='eur' AND v.price_cents=r.amount_cents
        AND NOT EXISTS (
          SELECT 1 FROM public.km16_purchases p
          WHERE p.user_id=r.user_id AND p.video_id=r.product_id
        )
      )
      ELSE false
    END
 );
$$;

CREATE FUNCTION public.km16_begin_checkout_attempt(
 p_kind text,p_source_id text,p_user_id uuid,p_email text,p_opt_in boolean,p_livemode boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
 v_now timestamptz:=public.km16_checkout_reminder_clock();
 v_email text:=lower(btrim(p_email));
 v_source text:=p_source_id;
 v_product text;
 v_group text;
 v_title text;
 v_sizes text[]:='{}'::text[];
 v_amount integer;
 v_total integer;
 v_id uuid;
 o public.km16_membership_orders%rowtype;
 s public.km16_shirt_orders%rowtype;
 v public.km16_videos%rowtype;
BEGIN
 IF p_livemode IS DISTINCT FROM true OR p_user_id IS NULL OR p_kind IS NULL
    OR p_kind NOT IN ('membership','shirts','video') OR v_email IS NULL
    OR length(v_email)>254 OR v_email !~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+[.][^[:space:]@<>;,]+$'
    OR p_source_id IS NULL OR length(p_source_id) NOT BETWEEN 1 AND 200 THEN
   RETURN NULL;
 END IF;
 IF p_kind IN ('membership','shirts') THEN
   IF p_source_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN NULL; END IF;
   v_source:=p_source_id::uuid::text;
 END IF;
 IF p_kind='membership' THEN
   SELECT * INTO o FROM public.km16_membership_orders WHERE id=v_source::uuid;
   IF NOT FOUND OR o.user_id<>p_user_id OR NOT o.livemode OR o.total_cents<=0
      OR lower(btrim(o.email))<>v_email THEN RETURN NULL; END IF;
   v_amount:=(o.amounts->>0)::integer;
   v_total:=o.total_cents;
   v_product:=o.product_id;
   v_group:=o.product_id||':'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
     lower(btrim(o.first_name))||'|'||lower(btrim(o.last_name))||'|'||to_char(o.birth_date,'YYYY-MM-DD'),
     'UTF8')),'hex');
   v_title:=o.title;
 ELSIF p_kind='shirts' THEN
   SELECT * INTO s FROM public.km16_shirt_orders WHERE id=v_source::uuid;
   IF NOT FOUND OR s.user_id<>p_user_id OR NOT s.livemode OR s.amount_cents<=0
      OR lower(btrim(s.email))<>v_email THEN RETURN NULL; END IF;
   v_amount:=s.amount_cents; v_total:=s.amount_cents; v_product:='shirts'; v_group:='shirts';
   v_title:='Tee-shirt KM16'; v_sizes:=s.sizes;
 ELSE
   SELECT * INTO v FROM public.km16_videos WHERE id=v_source;
   IF NOT FOUND OR NOT v.published OR v.price_cents<=0 OR v.currency<>'eur' THEN RETURN NULL; END IF;
   v_amount:=v.price_cents; v_total:=v.price_cents; v_product:=v.id; v_group:=v.id; v_title:=v.title;
 END IF;
 IF v_amount IS NULL OR v_amount<=0 OR v_total<v_amount THEN RETURN NULL; END IF;

 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   p_user_id::text||'/'||p_kind||'/'||v_group,0));
 UPDATE public.km16_checkout_reminders
 SET state='skipped',error_code='superseded',lock_token=NULL,locked_at=NULL
 WHERE user_id=p_user_id AND kind=p_kind AND group_key=v_group
   AND state IN ('preparing','pending','checking');

 INSERT INTO public.km16_checkout_reminders(
   kind,source_id,user_id,email,product_id,group_key,title,sizes,amount_cents,total_cents,
   livemode,opt_in,consented_at,created_at,due_at,next_check_at
 ) VALUES (
   p_kind,v_source,p_user_id,v_email,v_product,v_group,v_title,v_sizes,v_amount,v_total,
   true,coalesce(p_opt_in,false),CASE WHEN p_opt_in THEN v_now END,
   v_now,v_now+interval '24 hours',v_now+interval '24 hours'
 ) RETURNING id INTO v_id;
 RETURN v_id;
END;
$$;

CREATE FUNCTION public.km16_attach_checkout_attempt(
 p_attempt uuid,p_session_id text,p_amount_cents integer,p_currency text,p_livemode boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE r public.km16_checkout_reminders%rowtype; v_stopped boolean;
BEGIN
 IF p_livemode IS DISTINCT FROM true OR p_currency IS DISTINCT FROM 'eur'
    OR p_session_id IS NULL OR p_session_id !~ '^cs_live_[A-Za-z0-9]+$' THEN RETURN false; END IF;
 SELECT * INTO r FROM public.km16_checkout_reminders WHERE id=p_attempt FOR UPDATE;
 IF NOT FOUND OR r.state<>'preparing' OR r.amount_cents IS DISTINCT FROM p_amount_cents THEN RETURN false; END IF;
 IF r.kind='membership' AND NOT EXISTS (
   SELECT 1 FROM public.km16_membership_orders o WHERE o.id::text=r.source_id
   AND o.user_id=r.user_id AND lower(btrim(o.email))=r.email AND o.livemode
   AND o.stripe_session_id=p_session_id AND (o.amounts->>0)::integer=r.amount_cents
 ) THEN RETURN false; END IF;
 IF r.kind='shirts' AND NOT EXISTS (
   SELECT 1 FROM public.km16_shirt_orders o WHERE o.id::text=r.source_id
   AND o.user_id=r.user_id AND lower(btrim(o.email))=r.email AND o.livemode
   AND o.stripe_session_id=p_session_id AND o.amount_cents=r.amount_cents
 ) THEN RETURN false; END IF;
 SELECT EXISTS(SELECT 1 FROM public.km16_checkout_reminder_stops WHERE email=r.email) INTO v_stopped;
 UPDATE public.km16_checkout_reminders SET
   stripe_session_id=p_session_id,
   state=CASE WHEN r.opt_in AND NOT v_stopped THEN 'pending' ELSE 'skipped' END,
   error_code=CASE WHEN v_stopped THEN 'unsubscribed' WHEN NOT r.opt_in THEN 'consent_not_requested' END
 WHERE id=r.id;
 RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END;
$$;

CREATE FUNCTION public.km16_claim_checkout_reminders(p_limit integer DEFAULT 2)
RETURNS SETOF public.km16_checkout_reminders
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_now timestamptz:=public.km16_checkout_reminder_clock();
BEGIN
 UPDATE public.km16_checkout_reminders SET state='uncertain',error_code='interrupted'
 WHERE state='sending' AND attempted_at<v_now-interval '15 minutes';
 UPDATE public.km16_checkout_reminders SET state='skipped',error_code='checkout_not_attached'
 WHERE state='preparing' AND created_at<v_now-interval '1 hour';
 UPDATE public.km16_checkout_reminders SET state='skipped',error_code='no_longer_eligible',lock_token=NULL,locked_at=NULL
 WHERE state IN ('pending','checking') AND NOT public.km16_checkout_reminder_eligible(id);
 IF (v_now AT TIME ZONE 'Europe/Paris')::time<time '09:00'
    OR (v_now AT TIME ZONE 'Europe/Paris')::time>=time '19:00' THEN RETURN; END IF;
 RETURN QUERY WITH picked AS (
   SELECT r.id FROM public.km16_checkout_reminders r
   WHERE r.due_at<=v_now AND r.next_check_at<=v_now
     AND (r.state='pending' OR (r.state='checking' AND r.locked_at<v_now-interval '10 minutes'))
     AND public.km16_checkout_reminder_eligible(r.id)
   ORDER BY r.next_check_at,r.created_at,r.id
   LIMIT greatest(1,least(coalesce(p_limit,2),10))
   FOR UPDATE SKIP LOCKED
 ) UPDATE public.km16_checkout_reminders r
   SET state='checking',lock_token=gen_random_uuid(),locked_at=v_now
   FROM picked WHERE r.id=picked.id RETURNING r.*;
END;
$$;

CREATE FUNCTION public.km16_prepare_checkout_reminder_send(p_id uuid,p_lock_token uuid,p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
 r public.km16_checkout_reminders%rowtype;
 v_now timestamptz:=public.km16_checkout_reminder_clock();
 v_last timestamptz;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 SELECT * INTO r FROM public.km16_checkout_reminders WHERE id=p_id;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   r.user_id::text||'/'||r.kind||'/'||r.group_key,0));
 -- Serialize opt-out and the recipient limit before locking this attempt.
 -- The stop RPC takes the same email lock before touching any attempt rows.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('checkout-email/'||r.email,0));
 SELECT * INTO r FROM public.km16_checkout_reminders WHERE id=p_id FOR UPDATE;
 IF r.state<>'checking' OR p_lock_token IS NULL OR r.lock_token IS DISTINCT FROM p_lock_token
    OR r.locked_at<v_now-interval '10 minutes' THEN RETURN false; END IF;
 IF NOT public.km16_checkout_reminder_eligible(r.id) THEN
   UPDATE public.km16_checkout_reminders SET state='skipped',error_code='no_longer_eligible',lock_token=NULL,locked_at=NULL WHERE id=r.id;
   RETURN false;
 END IF;
 IF r.due_at>v_now OR (v_now AT TIME ZONE 'Europe/Paris')::time<time '09:00'
    OR (v_now AT TIME ZONE 'Europe/Paris')::time>=time '19:00' THEN
   UPDATE public.km16_checkout_reminders SET state='pending',next_check_at=greatest(due_at,v_now+interval '1 hour'),lock_token=NULL,locked_at=NULL WHERE id=r.id;
   RETURN false;
 END IF;
 SELECT max(attempted_at) INTO v_last FROM public.km16_checkout_reminders
 WHERE email=r.email AND state IN ('sending','accepted','uncertain') AND attempted_at>=v_now-interval '24 hours';
 IF v_last IS NOT NULL THEN
   UPDATE public.km16_checkout_reminders SET state='pending',next_check_at=v_last+interval '24 hours 1 second',error_code='recipient_rate_limit',lock_token=NULL,locked_at=NULL WHERE id=r.id;
   RETURN false;
 END IF;
 UPDATE public.km16_checkout_reminders SET state='sending',attempted_at=v_now,
   unsubscribe_token_hash=p_token_hash,error_code=NULL WHERE id=r.id;
 RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END;
$$;

CREATE FUNCTION public.km16_finish_checkout_reminder(
 p_id uuid,p_lock_token uuid,p_state text,p_error text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE r public.km16_checkout_reminders%rowtype; v_now timestamptz:=public.km16_checkout_reminder_clock();
BEGIN
 SELECT * INTO r FROM public.km16_checkout_reminders WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.lock_token IS DISTINCT FROM p_lock_token OR p_lock_token IS NULL THEN RETURN false; END IF;
 IF r.state=p_state AND p_state IN ('accepted','failed','uncertain') THEN RETURN true; END IF;
 IF r.state='checking' AND p_state IN ('pending','skipped') THEN
   UPDATE public.km16_checkout_reminders SET state=p_state,next_check_at=v_now+interval '1 hour',
     error_code=left(p_error,120),lock_token=NULL,locked_at=NULL WHERE id=r.id;
   RETURN true;
 END IF;
 IF r.state='sending' AND p_state IN ('accepted','failed','uncertain') THEN
   UPDATE public.km16_checkout_reminders SET state=p_state,
     sent_at=CASE WHEN p_state='accepted' THEN v_now END,error_code=left(p_error,120) WHERE id=r.id;
   RETURN true;
 END IF;
 RETURN false;
END;
$$;

CREATE FUNCTION public.km16_stop_checkout_reminders(p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_email text;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN true; END IF;
 SELECT email INTO v_email FROM public.km16_checkout_reminders WHERE unsubscribe_token_hash=p_token_hash;
 IF NOT FOUND THEN RETURN true; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('checkout-email/'||v_email,0));
 INSERT INTO public.km16_checkout_reminder_stops(email,stopped_at)
 VALUES (v_email,public.km16_checkout_reminder_clock()) ON CONFLICT DO NOTHING;
 UPDATE public.km16_checkout_reminders SET state='skipped',error_code='unsubscribed',lock_token=NULL,locked_at=NULL
 WHERE email=v_email AND state IN ('preparing','pending','checking');
 RETURN true;
END;
$$;

ALTER FUNCTION public.km16_checkout_reminder_clock() OWNER TO postgres;
ALTER FUNCTION public.km16_checkout_reminder_eligible(uuid) OWNER TO postgres;
ALTER FUNCTION public.km16_begin_checkout_attempt(text,text,uuid,text,boolean,boolean) OWNER TO postgres;
ALTER FUNCTION public.km16_attach_checkout_attempt(uuid,text,integer,text,boolean) OWNER TO postgres;
ALTER FUNCTION public.km16_claim_checkout_reminders(integer) OWNER TO postgres;
ALTER FUNCTION public.km16_prepare_checkout_reminder_send(uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.km16_finish_checkout_reminder(uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.km16_stop_checkout_reminders(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.km16_checkout_reminder_clock(),
 public.km16_checkout_reminder_eligible(uuid),
 public.km16_begin_checkout_attempt(text,text,uuid,text,boolean,boolean),
 public.km16_attach_checkout_attempt(uuid,text,integer,text,boolean),
 public.km16_claim_checkout_reminders(integer),
 public.km16_prepare_checkout_reminder_send(uuid,uuid,text),
 public.km16_finish_checkout_reminder(uuid,uuid,text,text),
 public.km16_stop_checkout_reminders(text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.km16_checkout_reminder_clock(),
 public.km16_checkout_reminder_eligible(uuid),
 public.km16_begin_checkout_attempt(text,text,uuid,text,boolean,boolean),
 public.km16_attach_checkout_attempt(uuid,text,integer,text,boolean),
 public.km16_claim_checkout_reminders(integer),
 public.km16_prepare_checkout_reminder_send(uuid,uuid,text),
 public.km16_finish_checkout_reminder(uuid,uuid,text,text),
 public.km16_stop_checkout_reminders(text)
 TO service_role;
