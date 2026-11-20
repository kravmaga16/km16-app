-- Transactional welcome for newly submitted live, free trials only.
-- No INSERT ... SELECT/backfill: existing requests receive no new email.
CREATE TABLE public.km16_trial_welcome_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.km16_membership_orders(id) ON DELETE CASCADE,
  dedup_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','sending','accepted','failed','uncertain','skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  error_code text
);
CREATE INDEX km16_trial_welcome_pending
  ON public.km16_trial_welcome_queue (created_at,id) WHERE state='pending';
CREATE INDEX km16_trial_welcome_stale
  ON public.km16_trial_welcome_queue (locked_at) WHERE state='sending';
ALTER TABLE public.km16_trial_welcome_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.km16_trial_welcome_queue FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,UPDATE ON TABLE public.km16_trial_welcome_queue TO service_role;

CREATE FUNCTION public.km16_enqueue_trial_welcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  season text;
  season_year integer;
  identity_key text;
BEGIN
  IF NOT NEW.livemode OR NEW.total_cents<>0
     OR NEW.product_id NOT IN ('essai','essai-saint-jean')
     OR NEW.approval='rejected' THEN
    RETURN NEW;
  END IF;
  -- The normal BEFORE INSERT trigger supplies season_id. The fallback keeps
  -- the same September boundary if an internal importer omitted it.
  season_year:=extract(year FROM NEW.created_at AT TIME ZONE 'Europe/Paris')::integer
    - CASE WHEN to_char(NEW.created_at AT TIME ZONE 'Europe/Paris','MM-DD')<'09-01' THEN 1 ELSE 0 END;
  season:=coalesce(NEW.season_id,season_year::text||'/'||(season_year+1)::text);
  identity_key:=encode(sha256(convert_to(jsonb_build_array(
    NEW.user_id,season,
    lower(regexp_replace(btrim(NEW.first_name),'\s+',' ','g')),
    lower(regexp_replace(btrim(NEW.last_name),'\s+',' ','g')),
    NEW.birth_date
  )::text,'UTF8')),'hex');
  INSERT INTO public.km16_trial_welcome_queue(order_id,dedup_key)
  VALUES(NEW.id,identity_key)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.km16_enqueue_trial_welcome() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.km16_enqueue_trial_welcome() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER km16_trial_welcome_insert
  AFTER INSERT ON public.km16_membership_orders
  FOR EACH ROW EXECUTE FUNCTION public.km16_enqueue_trial_welcome();

CREATE FUNCTION public.km16_claim_trial_welcome()
RETURNS SETOF public.km16_trial_welcome_queue
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
BEGIN
  -- An interrupted SMTP attempt is never automatically sent a second time.
  UPDATE public.km16_trial_welcome_queue q
     SET state='uncertain',error_code='stale_send'
   WHERE q.state='sending' AND q.locked_at<now()-interval '15 minutes';
  UPDATE public.km16_trial_welcome_queue q
     SET state='skipped',error_code='order_ineligible'
   WHERE q.state='pending' AND NOT EXISTS (
    SELECT 1 FROM public.km16_membership_orders o
     WHERE o.id=q.order_id AND o.livemode AND o.total_cents=0
       AND o.product_id IN ('essai','essai-saint-jean') AND o.approval<>'rejected'
   );
  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM public.km16_trial_welcome_queue q
    WHERE q.state='pending'
      AND EXISTS(SELECT 1 FROM public.km16_automation_settings a WHERE a.id=1 AND a.enabled)
    ORDER BY q.created_at,q.id FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public.km16_trial_welcome_queue q
     SET state='sending',locked_at=now(),error_code=NULL
    FROM picked p WHERE q.id=p.id
  RETURNING q.*;
END;
$function$;
REVOKE ALL ON FUNCTION public.km16_claim_trial_welcome() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.km16_claim_trial_welcome() TO service_role;

CREATE FUNCTION public.km16_prepare_trial_welcome_send(p_id uuid,p_user_id uuid,p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.km16_trial_welcome_queue q
    JOIN public.km16_membership_orders o ON o.id=q.order_id
    WHERE q.id=p_id AND q.state='sending'
      AND o.user_id=p_user_id AND lower(btrim(o.email))=lower(btrim(p_email))
      AND q.locked_at>=now()-interval '15 minutes'
      AND o.livemode AND o.total_cents=0 AND o.approval<>'rejected'
      AND o.product_id IN ('essai','essai-saint-jean')
      AND EXISTS(SELECT 1 FROM public.km16_automation_settings a WHERE a.id=1 AND a.enabled)
  );
$function$;
REVOKE ALL ON FUNCTION public.km16_prepare_trial_welcome_send(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.km16_prepare_trial_welcome_send(uuid,uuid,text) TO service_role;
