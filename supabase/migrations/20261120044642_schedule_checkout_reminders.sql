-- Deploy km16-checkout-reminders and its registry before this scheduler.
-- Eligibility enforces the 24-hour delay and 09:00–19:00 Europe/Paris window.
CREATE OR REPLACE FUNCTION public.km16_dispatch_checkout_reminders()
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

  IF automation_token IS NULL OR length(automation_token) < 64 OR length(automation_token) > 512 THEN
    RETURN NULL;
  END IF;

  RETURN net.http_post(
    url := 'https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-checkout-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-km16-automation', automation_token
    ),
    body := '{"action":"work"}'::jsonb,
    timeout_milliseconds := 60000
  );
END;
$function$;

ALTER FUNCTION public.km16_dispatch_checkout_reminders() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.km16_dispatch_checkout_reminders()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule(
  'km16-checkout-reminders-every-five-minutes',
  '*/5 * * * *',
  'SELECT public.km16_dispatch_checkout_reminders();'
);
