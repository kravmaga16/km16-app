BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END; $$;
CREATE FUNCTION pg_temp.seed(n integer,product text DEFAULT 'essai',live boolean DEFAULT true,
  amount integer DEFAULT 0,approval text DEFAULT 'pending',first_name text DEFAULT 'Fixture',
  user_no integer DEFAULT NULL,season text DEFAULT '2026/2027') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o uuid:=('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
BEGIN
 INSERT INTO public.km16_membership_orders(id,user_id,email,product_id,livemode,total_cents,
 approval,first_name,last_name,birth_date,season_id)
 VALUES(o,('20000000-0000-4000-8000-'||lpad(coalesce(user_no,n)::text,12,'0'))::uuid,
 'fixture@example.invalid',product,live,amount,approval,first_name,'Participant','2000-01-01',season);
 RETURN o;
END; $$;

SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_trial_welcome_queue),'no historical backfill');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='public.km16_trial_welcome_queue'::regclass),'queue RLS enabled');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','public.km16_trial_welcome_queue','SELECT')
 AND NOT has_table_privilege('authenticated','public.km16_trial_welcome_queue','SELECT')
 AND NOT has_table_privilege('service_role','public.km16_trial_welcome_queue','INSERT')
 AND NOT has_table_privilege('service_role','public.km16_trial_welcome_queue','DELETE')
 AND has_table_privilege('service_role','public.km16_trial_welcome_queue','SELECT')
 AND has_table_privilege('service_role','public.km16_trial_welcome_queue','UPDATE'),'private server-only table privileges');
SELECT pg_temp.assert_true((SELECT count(*)=2 AND bool_and(NOT prosecdef)
 AND bool_and(has_function_privilege('service_role',oid,'EXECUTE'))
 AND bool_and(NOT has_function_privilege('anon',oid,'EXECUTE'))
 AND bool_and(NOT has_function_privilege('authenticated',oid,'EXECUTE'))
 FROM pg_proc WHERE proname IN ('km16_claim_trial_welcome','km16_prepare_trial_welcome_send')),
 'two invoker RPCs are service-only');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.km16_enqueue_trial_welcome()','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.km16_enqueue_trial_welcome()','EXECUTE')
 AND NOT has_function_privilege('service_role','public.km16_enqueue_trial_welcome()','EXECUTE'),'trigger execution not exposed');
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM * FROM public.km16_trial_welcome_queue;RAISE EXCEPTION 'FAIL: browser read';
EXCEPTION WHEN insufficient_privilege THEN NULL;END; $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM * FROM public.km16_claim_trial_welcome();RAISE EXCEPTION 'FAIL: browser claim';
EXCEPTION WHEN insufficient_privilege THEN NULL;END; $$;
RESET ROLE;

SELECT pg_temp.seed(1);
SELECT pg_temp.seed(2,'essai-saint-jean');
SELECT pg_temp.seed(3,'essai',false);
SELECT pg_temp.seed(4,'essai',true,100);
SELECT pg_temp.seed(5,'annual',true,0);
SELECT pg_temp.seed(6,'essai',true,0,'rejected');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.km16_trial_welcome_queue),'only new live free nonrejected trials queued');
UPDATE public.km16_membership_orders SET approval='approved' WHERE id='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.km16_trial_welcome_queue),'later order update does not enqueue another welcome');
SELECT pg_temp.seed(7,'essai-saint-jean',true,0,'pending','   FIXTURE  ',1);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.km16_trial_welcome_queue),'same account/practitioner/season across trial products deduplicated');
SELECT pg_temp.seed(8,'essai',true,0,'pending','Other child',1);
SELECT pg_temp.seed(9,'essai',true,0,'pending','Fixture',1,'2027/2028');
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM public.km16_trial_welcome_queue),'other child and new season get separate welcomes');

CREATE TEMP TABLE claimed(id uuid,order_id uuid);
GRANT SELECT,INSERT,DELETE ON pg_temp.claimed TO service_role;
CREATE FUNCTION pg_temp.prepare_claim() RETURNS boolean LANGUAGE sql AS $$
 SELECT public.km16_prepare_trial_welcome_send(c.id,o.user_id,o.email)
 FROM pg_temp.claimed c JOIN public.km16_membership_orders o ON o.id=c.order_id;
$$;
UPDATE public.km16_automation_settings SET enabled=false WHERE id=1;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_trial_welcome()),'disabled automation claims no jobs');
RESET ROLE;
UPDATE public.km16_automation_settings SET enabled=true WHERE id=1;
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.claimed SELECT id,order_id FROM public.km16_claim_trial_welcome();
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM pg_temp.claimed),'claims exactly one job');
SELECT pg_temp.assert_true((SELECT state='sending' AND locked_at IS NOT NULL FROM public.km16_trial_welcome_queue WHERE id=(SELECT id FROM pg_temp.claimed)),'claim sets sending and lock time');
SELECT pg_temp.assert_true(pg_temp.prepare_claim(),'eligible claim passes final check');
SELECT pg_temp.assert_true(NOT public.km16_prepare_trial_welcome_send('00000000-0000-4000-8000-000000000000',NULL,NULL),'unknown job fails closed');
SELECT pg_temp.assert_true(NOT public.km16_prepare_trial_welcome_send((SELECT id FROM pg_temp.claimed),'00000000-0000-4000-8000-000000000000','fixture@example.invalid'),'changed account fails final check');
SELECT pg_temp.assert_true(NOT public.km16_prepare_trial_welcome_send((SELECT id FROM pg_temp.claimed),(SELECT o.user_id FROM public.km16_membership_orders o JOIN pg_temp.claimed c ON o.id=c.order_id),'other@example.invalid'),'changed email fails final check');
RESET ROLE;
UPDATE public.km16_automation_settings SET enabled=false WHERE id=1;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(NOT pg_temp.prepare_claim(),'pause before SMTP fails final check');
RESET ROLE;
UPDATE public.km16_automation_settings SET enabled=true WHERE id=1;
UPDATE public.km16_membership_orders SET approval='rejected' WHERE id=(SELECT order_id FROM pg_temp.claimed);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(NOT pg_temp.prepare_claim(),'rejection before SMTP fails final check');
UPDATE public.km16_trial_welcome_queue SET state='skipped',error_code='order_ineligible' WHERE id=(SELECT id FROM pg_temp.claimed) AND state='sending';
DELETE FROM pg_temp.claimed;
INSERT INTO pg_temp.claimed SELECT id,order_id FROM public.km16_claim_trial_welcome();
UPDATE public.km16_trial_welcome_queue SET state='accepted',sent_at=now() WHERE id=(SELECT id FROM pg_temp.claimed) AND state='sending';
SELECT pg_temp.assert_true(NOT pg_temp.prepare_claim(),'accepted job cannot be sent again');
DELETE FROM pg_temp.claimed;
INSERT INTO pg_temp.claimed SELECT id,order_id FROM public.km16_claim_trial_welcome();
UPDATE public.km16_trial_welcome_queue SET locked_at=now()-interval '16 minutes' WHERE id=(SELECT id FROM pg_temp.claimed);
SELECT pg_temp.assert_true(NOT pg_temp.prepare_claim(),'expired sending reservation fails final check');
SELECT * FROM public.km16_claim_trial_welcome();
SELECT pg_temp.assert_true((SELECT state='uncertain' AND error_code='stale_send' FROM public.km16_trial_welcome_queue WHERE id=(SELECT id FROM pg_temp.claimed)),'stale sending becomes uncertain, never pending');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_trial_welcome()),'sending and terminal jobs never reclaimed');
RESET ROLE;

SELECT pg_temp.seed(10);
UPDATE public.km16_membership_orders SET total_cents=100 WHERE id='10000000-0000-4000-8000-000000000010';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_trial_welcome()),'changed-to-paid trial skipped');
SELECT pg_temp.assert_true((SELECT state='skipped' FROM public.km16_trial_welcome_queue WHERE order_id='10000000-0000-4000-8000-000000000010'),'ineligible queued trial marked skipped');
RESET ROLE;

-- A transaction that fails to register a trial cannot leave a welcome behind.
SAVEPOINT failed_registration;
SELECT pg_temp.seed(11);
ROLLBACK TO SAVEPOINT failed_registration;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.km16_trial_welcome_queue WHERE order_id='10000000-0000-4000-8000-000000000011'),'registration rollback rolls back welcome');
ROLLBACK;
