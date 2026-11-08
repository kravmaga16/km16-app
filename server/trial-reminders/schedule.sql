select cron.schedule('km16-trial-reminders','*/5 * * * *',$job$
 select net.http_post(
  url := 'https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-trial-reminders',
  headers := jsonb_build_object('Content-Type','application/json','x-km16-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='km16_documents_worker_key')),
  body := '{"action":"work"}'::jsonb,
  timeout_milliseconds := 60000
 );
$job$);
