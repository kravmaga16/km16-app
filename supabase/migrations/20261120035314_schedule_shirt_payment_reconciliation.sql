-- Check pending tee-shirt orders even when the buyer closes Stripe Checkout.
-- Deploy km16-reconcile-shirt-payments before applying this migration.
-- Uses the existing server-only automation token and global enabled switch.
CREATE OR REPLACE FUNCTION public.km16_dispatch_shirt_payment_checks()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  automation_token text;
BEGIN
  SELECT s.token INTO automation_token
  FROM public.km16_automation_settings AS s
  WHERE s.id = 1 AND s.enabled;

  IF automation_token IS NULL OR length(automation_token) < 64 THEN
    RETURN NULL;
  END IF;

  RETURN net.http_post(
    url := 'https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-reconcile-shirt-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-km16-automation', automation_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
END;
$function$;

ALTER FUNCTION public.km16_dispatch_shirt_payment_checks() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.km16_dispatch_shirt_payment_checks()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule(
  'km16-shirt-payments-every-minute',
  '* * * * *',
  'SELECT public.km16_dispatch_shirt_payment_checks();'
);
