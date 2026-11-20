-- Deploy km16-trial-welcome and its queue before activating this scheduler.
CREATE OR REPLACE FUNCTION public.km16_dispatch_trial_welcome()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE automation_token text;
BEGIN
  SELECT s.token INTO automation_token FROM public.km16_automation_settings s
  WHERE s.id=1 AND s.enabled;
  IF automation_token IS NULL OR length(automation_token)<64 OR length(automation_token)>512 THEN
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url:='https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-trial-welcome',
    headers:=jsonb_build_object('Content-Type','application/json','x-km16-automation',automation_token),
    body:='{"action":"work"}'::jsonb,
    timeout_milliseconds:=60000
  );
END;
$function$;
ALTER FUNCTION public.km16_dispatch_trial_welcome() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.km16_dispatch_trial_welcome() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('km16-trial-welcome-every-minute','* * * * *',
  'SELECT public.km16_dispatch_trial_welcome();');
