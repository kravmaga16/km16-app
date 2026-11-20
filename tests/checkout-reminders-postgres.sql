-- Fictional data only. Executed against an isolated database, then rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END; $$;
-- A deterministic clock exists only inside this test transaction.
CREATE OR REPLACE FUNCTION public.km16_checkout_reminder_clock()
RETURNS timestamptz LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT current_setting('km16.test_clock')::timestamptz; $$;
SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
CREATE TEMP TABLE cases(case_no integer PRIMARY KEY,id uuid NOT NULL);
GRANT SELECT ON pg_temp.cases TO service_role;
CREATE FUNCTION pg_temp.case_id(n integer) RETURNS uuid LANGUAGE sql
AS $$ SELECT id FROM pg_temp.cases WHERE case_no=n; $$;
CREATE FUNCTION pg_temp.seed(n integer,k text,opt boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
 u uuid:=('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 s uuid:=('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 e text:='case'||n||'@example.invalid';
 session text:='cs_live_case'||n;
 source text;
 amount integer;
 a uuid;
BEGIN
 INSERT INTO auth.users VALUES(u) ON CONFLICT DO NOTHING;
 IF k='membership' THEN
  INSERT INTO public.km16_membership_products VALUES ('product'||n,'Fixture annual','annual','Adultes',63000,false,NULL);
  INSERT INTO public.km16_membership_orders(id,user_id,email,product_id,title,livemode,total_cents,amounts,stripe_session_id,created_at)
  VALUES(s,u,e,'product'||n,'Fixture annual',true,63000,'[21000,21000,21000]',session,public.km16_checkout_reminder_clock());
  UPDATE public.km16_membership_orders SET participant_key=encode(sha256(convert_to(
    'live|'||u::text||'|2027-07-01|fixture|person|2000-01-01','UTF8')),'hex') WHERE id=s;
  source:=s::text; amount:=21000;
 ELSIF k='shirts' THEN
  INSERT INTO public.km16_shirt_orders(id,user_id,email,sizes,amount_cents,stripe_session_id,livemode,created_at)
  VALUES(s,u,e,ARRAY['M'],1800,session,true,public.km16_checkout_reminder_clock());
  source:=s::text; amount:=1800;
 ELSE
  INSERT INTO public.km16_videos VALUES ('video'||n,'Fixture video',1900,'eur',true);
  source:='video'||n; amount:=1900;
 END IF;
 a:=public.km16_begin_checkout_attempt(k,source,u,e,opt,true);
 IF a IS NULL OR NOT public.km16_attach_checkout_attempt(a,session,amount,'eur',true) THEN
  RAISE EXCEPTION 'Fixture could not create attempt %',n;
 END IF;
 INSERT INTO pg_temp.cases VALUES(n,a);
 RETURN a;
END; $$;

SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_checkout_reminders),'migration never backfills historical unpaid orders');
SELECT pg_temp.assert_true((SELECT count(*)=2 AND bool_and(relrowsecurity) FROM pg_class
 WHERE oid IN ('public.km16_checkout_reminders'::regclass,'public.km16_checkout_reminder_stops'::regclass)), 'both private tables have RLS');
SELECT pg_temp.assert_true((SELECT count(*)=8 AND bool_and(NOT prosecdef)
 AND bool_and(has_function_privilege('service_role',oid,'EXECUTE'))
 AND bool_and(NOT has_function_privilege('anon',oid,'EXECUTE'))
 AND bool_and(NOT has_function_privilege('authenticated',oid,'EXECUTE'))
 AND bool_and(EXISTS(SELECT 1 FROM unnest(proconfig) AS setting WHERE replace(setting,'"','')='search_path='))
 FROM pg_proc WHERE proname IN ('km16_checkout_reminder_clock','km16_checkout_reminder_eligible',
 'km16_begin_checkout_attempt','km16_attach_checkout_attempt','km16_claim_checkout_reminders',
 'km16_prepare_checkout_reminder_send','km16_finish_checkout_reminder','km16_stop_checkout_reminders')),
 'all eight functions are invoker, fixed empty search_path, service-only');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','auth.users','SELECT'), 'no auth.users privilege expansion');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','public.km16_checkout_reminders','SELECT')
 AND NOT has_table_privilege('authenticated','public.km16_checkout_reminders','INSERT')
 AND NOT has_table_privilege('service_role','public.km16_checkout_reminders','DELETE'), 'private registry privileges are limited');
SET LOCAL ROLE anon;
DO $$ BEGIN
 PERFORM * FROM public.km16_checkout_reminders;
 RAISE EXCEPTION 'FAIL: anon could read reminder recipients';
EXCEPTION WHEN insufficient_privilege THEN NULL; END; $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM * FROM public.km16_claim_checkout_reminders(1);
 RAISE EXCEPTION 'FAIL: browser could claim reminders';
EXCEPTION WHEN insufficient_privilege THEN NULL; END; $$;
RESET ROLE;

-- Registration is server-only, snapshots the first installment, and preserves
-- a new refusal of consent even when the already-open Stripe session is reused.
SELECT pg_temp.seed(1,'membership');
CREATE TEMP TABLE ids(label text PRIMARY KEY,id uuid);
GRANT SELECT,INSERT ON pg_temp.ids TO service_role;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.km16_begin_checkout_attempt('membership','20000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','other@example.invalid',true,true) IS NULL, 'source email must match verified caller');
SELECT pg_temp.assert_true(public.km16_begin_checkout_attempt('membership','20000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000000','case1@example.invalid',true,true) IS NULL, 'source owner must match caller');
SELECT pg_temp.assert_true(public.km16_begin_checkout_attempt('membership','20000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','case1@example.invalid',true,false) IS NULL, 'test checkouts never create reminder attempts');
SELECT pg_temp.assert_true(public.km16_begin_checkout_attempt('membership','invalid-id',
 '10000000-0000-4000-8000-000000000001','case1@example.invalid',true,true) IS NULL, 'malformed source fails closed');
SELECT pg_temp.assert_true(public.km16_begin_checkout_attempt('unknown','x',
 '10000000-0000-4000-8000-000000000001','case1@example.invalid',true,true) IS NULL, 'unsupported purchase kind fails closed');
INSERT INTO pg_temp.ids VALUES('resumed',public.km16_begin_checkout_attempt('membership','20000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001',' CASE1@EXAMPLE.INVALID ',true,true));
SELECT pg_temp.assert_true((SELECT state='skipped' AND error_code='superseded' FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(1)), 'new attempt supersedes old pending attempt');
SELECT pg_temp.assert_true((SELECT amount_cents=21000 AND total_cents=63000 AND email='case1@example.invalid'
 AND due_at=created_at+interval '24 hours' AND consented_at=created_at
 FROM public.km16_checkout_reminders WHERE id=(SELECT id FROM pg_temp.ids WHERE label='resumed')), 'snapshot uses first installment, normalized verified email and explicit consent');
SELECT pg_temp.assert_true(NOT public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='resumed'),'cs_live_case1',63000,'eur',true), 'cannot attach full subscription price instead of first installment');
SELECT pg_temp.assert_true(NOT public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='resumed'),'cs_test_case1',21000,'eur',false), 'test Stripe sessions rejected');
SELECT pg_temp.assert_true(NOT public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='resumed'),'cs_live_case1',21000,'usd',true), 'unexpected currency rejected');
SELECT pg_temp.assert_true(NOT public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='resumed'),'cs_live_wrong',21000,'eur',true), 'session must already match source order');
SELECT pg_temp.assert_true(public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='resumed'),'cs_live_case1',21000,'eur',true), 'same Stripe session can follow a superseded consent record');
INSERT INTO pg_temp.ids VALUES('refused',public.km16_begin_checkout_attempt('membership','20000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','case1@example.invalid',false,true));
SELECT pg_temp.assert_true(public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='refused'),'cs_live_case1',21000,'eur',true), 'nonconsenting attempt still records completed checkout creation');
SELECT pg_temp.assert_true((SELECT state='skipped' AND NOT opt_in AND consented_at IS NULL AND error_code='consent_not_requested'
 FROM public.km16_checkout_reminders WHERE id=(SELECT id FROM pg_temp.ids WHERE label='refused')), 'refusal is durable and never enters send queue');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_checkout_reminders WHERE state='pending'), 'new opt-out supersedes earlier opt-in for same product');
RESET ROLE;
UPDATE public.km16_membership_orders SET total_cents=0,amounts='[0]' WHERE id='20000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.km16_begin_checkout_attempt('membership','20000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','case1@example.invalid',true,true) IS NULL, 'free trial has no payment reminder');
RESET ROLE;
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

-- All three purchase families advance after exactly 24h, with independent leases.
SELECT pg_temp.seed(10,'membership'),pg_temp.seed(11,'shirts'),pg_temp.seed(12,'video');
SET LOCAL km16.test_clock='2026-11-21 09:59:59+00';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_checkout_reminders(10)), 'nothing before 24 hours');
SET LOCAL km16.test_clock='2026-11-21 10:00:00+00';
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.km16_claim_checkout_reminders(10)), 'membership, shirt and video all become due');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_checkout_reminders(10)), 'active checking lease prevents another claim');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(10),gen_random_uuid(),repeat('a',64)), 'wrong lease cannot send');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(10),NULL,repeat('a',64)), 'null lease cannot send');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(10),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(10)),'not-a-hash'), 'unsubscribe token must be hashed');
INSERT INTO pg_temp.ids VALUES('old-lock',(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(10)));
SET LOCAL km16.test_clock='2026-11-21 10:10:00+00';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_checkout_reminders(10)), 'exact lease boundary remains reserved');
SET LOCAL km16.test_clock='2026-11-21 10:10:01+00';
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.km16_claim_checkout_reminders(10)), 'expired checks can be safely reclaimed before SMTP');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(10),(SELECT id FROM pg_temp.ids WHERE label='old-lock'),repeat('a',64)), 'old worker is fenced after reclaim');
SELECT pg_temp.assert_true(public.km16_prepare_checkout_reminder_send(pg_temp.case_id(10),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(10)),repeat('a',64)), 'current lease reserves exactly one SMTP attempt');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(10),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(10)),repeat('a',64)), 'repeated prepare never authorizes duplicate SMTP');
SELECT pg_temp.assert_true(public.km16_finish_checkout_reminder(pg_temp.case_id(10),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(10)),'accepted'), 'accepted result can be persisted');
SELECT pg_temp.assert_true(public.km16_finish_checkout_reminder(pg_temp.case_id(10),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(10)),'accepted'), 'finishing accepted is idempotent');
SELECT pg_temp.assert_true(NOT public.km16_finish_checkout_reminder(pg_temp.case_id(10),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(10)),'pending'), 'accepted delivery cannot be requeued');
SELECT pg_temp.assert_true(public.km16_prepare_checkout_reminder_send(pg_temp.case_id(11),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(11)),repeat('b',64)), 'shirt send is independently reserved');
SET LOCAL km16.test_clock='2026-11-21 10:26:00+00';
SELECT count(*) FROM public.km16_claim_checkout_reminders(10);
SELECT pg_temp.assert_true((SELECT state='uncertain' AND error_code='interrupted' FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(11)), 'crash after SMTP preparation becomes uncertain, never pending');
SELECT pg_temp.assert_true(NOT public.km16_finish_checkout_reminder(pg_temp.case_id(11),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(11)),'pending'), 'uncertain delivery has no automatic retry');
SELECT pg_temp.assert_true(public.km16_finish_checkout_reminder(pg_temp.case_id(12),
 (SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(12)),'pending','stripe_unavailable'), 'Stripe failure before SMTP safely postpones checking');
SELECT pg_temp.assert_true((SELECT state='pending' AND next_check_at=public.km16_checkout_reminder_clock()+interval '1 hour'
 AND lock_token IS NULL FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(12)), 'retry has one-hour delay and invalidates prior lock');
RESET ROLE;
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

-- Source changes are checked again immediately before send, not just at claim.
SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
SELECT pg_temp.seed(20,'membership'),pg_temp.seed(21,'membership'),pg_temp.seed(22,'membership'),
 pg_temp.seed(23,'membership'),pg_temp.seed(24,'membership'),pg_temp.seed(25,'membership'),
 pg_temp.seed(26,'membership'),pg_temp.seed(27,'membership'),pg_temp.seed(28,'membership'),
 pg_temp.seed(29,'membership');
INSERT INTO public.km16_membership_payments VALUES
 ('first-installment-paid','20000000-0000-4000-8000-000000000020','paid',0),
 ('refund','20000000-0000-4000-8000-000000000021','refunded',21000),
 ('dispute','20000000-0000-4000-8000-000000000022','disputed',0);
UPDATE public.km16_membership_orders SET approval='rejected' WHERE id='20000000-0000-4000-8000-000000000023';
UPDATE public.km16_membership_products SET draft=true WHERE id='product24';
UPDATE public.km16_membership_products SET kind='single',event_date='2026-11-20' WHERE id='product25';
UPDATE public.km16_membership_orders SET livemode=false WHERE id='20000000-0000-4000-8000-000000000026';
UPDATE public.km16_membership_orders SET stripe_session_id='cs_live_replaced' WHERE id='20000000-0000-4000-8000-000000000027';
INSERT INTO public.km16_purchase_links(id,order_id,livemode,expires_at,revoked_at) VALUES
 ('30000000-0000-4000-8000-000000000028','20000000-0000-4000-8000-000000000028',true,'2026-11-21 09:00:00+00',NULL),
 ('30000000-0000-4000-8000-000000000029','20000000-0000-4000-8000-000000000029',true,'2026-12-01 09:00:00+00','2026-11-20 11:00:00+00');
UPDATE public.km16_membership_orders SET purchase_link_id=('30000000-0000-4000-8000-'||right(id::text,12))::uuid WHERE id IN ('20000000-0000-4000-8000-000000000028','20000000-0000-4000-8000-000000000029');
SET LOCAL km16.test_clock='2026-11-21 10:00:00+00';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_checkout_reminders(10)), 'paid first installment, refund, dispute, rejection, draft, past event, test, changed session and expired/revoked links excluded');
SELECT pg_temp.assert_true((SELECT count(*)=10 FROM public.km16_checkout_reminders WHERE state='skipped'), 'all ineligible sources become terminal without SMTP');
RESET ROLE;
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;
SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
SELECT pg_temp.seed(30,'membership'),pg_temp.seed(31,'shirts'),pg_temp.seed(32,'video'),pg_temp.seed(33,'membership');
SET LOCAL km16.test_clock='2026-11-21 10:00:00+00';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM public.km16_claim_checkout_reminders(10)), 'four valid attempts can be checked initially');
RESET ROLE;
INSERT INTO public.km16_membership_payments VALUES ('arrived-after-claim','20000000-0000-4000-8000-000000000030','paid',0);
UPDATE public.km16_shirt_orders SET status='paid' WHERE id='20000000-0000-4000-8000-000000000031';
INSERT INTO public.km16_purchases VALUES ('cs_live_paidVideo','10000000-0000-4000-8000-000000000032','video32','paid','2026-11-21 10:00:00+00');
UPDATE public.km16_membership_config SET season_end='2026-11-20';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(30),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(30)),repeat('c',64)), 'membership payment after claim prevents sending');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(31),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(31)),repeat('d',64)), 'shirt payment after claim prevents sending');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(32),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(32)),repeat('e',64)), 'video purchase after claim prevents sending');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(33),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(33)),repeat('f',64)), 'ended annual season is checked again at prepare');
RESET ROLE;
UPDATE public.km16_membership_config SET season_end='2027-07-01';
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
SELECT pg_temp.seed(40,'shirts'),pg_temp.seed(41,'video'),pg_temp.seed(42,'video'),pg_temp.seed(43,'video'),pg_temp.seed(44,'membership');
UPDATE public.km16_shirt_orders SET status='cancelled' WHERE id='20000000-0000-4000-8000-000000000040';
INSERT INTO public.km16_purchases VALUES
 ('cs_live_refundedVideo','10000000-0000-4000-8000-000000000041','video41','refunded','2026-11-20 11:00:00+00'),
 ('cs_live_disputedVideo','10000000-0000-4000-8000-000000000042','video42','disputed','2026-11-20 11:00:00+00'),
 ('cs_live_revokedVideo','10000000-0000-4000-8000-000000000043','video43','revoked','2026-11-20 11:00:00+00');
INSERT INTO public.km16_membership_orders(id,user_id,email,product_id,title,livemode,total_cents,amounts,stripe_session_id,created_at)
 SELECT '20000000-0000-4000-8000-000000000944',user_id,email,product_id,title,true,total_cents,amounts,'cs_live_newerPaid','2026-11-20 11:00:00+00'
 FROM public.km16_membership_orders WHERE id='20000000-0000-4000-8000-000000000044';
INSERT INTO public.km16_membership_payments VALUES ('newer-order-paid','20000000-0000-4000-8000-000000000944','paid',0);
SET LOCAL km16.test_clock='2026-11-21 10:00:00+00';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT id=pg_temp.case_id(40) FROM public.km16_claim_checkout_reminders(10)), 'expired unpaid shirt is eligible, refunded/disputed/revoked videos and paid replacement membership are not');
RESET ROLE;
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

-- Nighttime, max-age cutoff, and abandoned Stripe creation fail closed.
SET LOCAL km16.test_clock='2026-11-20 06:00:00+00';
SELECT pg_temp.seed(50,'video');
SET LOCAL km16.test_clock='2026-11-21 07:59:59+00';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_checkout_reminders(10)), 'no send before 09:00 Paris');
SET LOCAL km16.test_clock='2026-11-21 08:00:00+00';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.km16_claim_checkout_reminders(10)), '09:00 Paris opens the sending window');
SET LOCAL km16.test_clock='2026-11-21 18:00:00+00';
SELECT count(*) FROM public.km16_claim_checkout_reminders(10);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_checkout_reminders(10)), '19:00 Paris closes the sending window');
SET LOCAL km16.test_clock='2026-11-27 10:00:00+00';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_checkout_reminders(10)), 'attempts older than seven days expire');
SELECT pg_temp.assert_true((SELECT state='skipped' FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(50)), 'expired attempts never await a future retry');
RESET ROLE;
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

-- Recipient throttling spans purchase types; unsubscribe is global and durable.
SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
SELECT pg_temp.seed(60,'membership'),pg_temp.seed(61,'video');
UPDATE public.km16_checkout_reminders SET email='case60@example.invalid' WHERE id=pg_temp.case_id(61);
SET LOCAL km16.test_clock='2026-11-21 10:00:00+00';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.km16_claim_checkout_reminders(10)), 'two different products can reach Stripe validation');
SELECT pg_temp.assert_true(public.km16_prepare_checkout_reminder_send(pg_temp.case_id(60),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(60)),repeat('1',64)), 'first recipient message reserved');
SELECT pg_temp.assert_true(NOT public.km16_prepare_checkout_reminder_send(pg_temp.case_id(61),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(61)),repeat('2',64)), 'same recipient cannot receive second message in 24h across kinds');
SELECT pg_temp.assert_true((SELECT state='pending' AND error_code='recipient_rate_limit' AND next_check_at='2026-11-22 10:00:01+00'::timestamptz FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(61)), 'throttling postpones the other product without SMTP');
SELECT pg_temp.assert_true(public.km16_finish_checkout_reminder(pg_temp.case_id(60),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(60)),'accepted'), 'first recipient message finalizes');
SELECT pg_temp.assert_true(public.km16_stop_checkout_reminders(repeat('0',64)) AND public.km16_stop_checkout_reminders('invalid'), 'unknown and invalid unsubscribe tokens have generic response');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_checkout_reminder_stops), 'unknown token cannot stop unrelated recipients');
SELECT pg_temp.assert_true(public.km16_stop_checkout_reminders(repeat('1',64)), 'known hashed token stops reminders');
SELECT pg_temp.assert_true((SELECT state='skipped' AND error_code='unsubscribed' FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(61)), 'unsubscribe cancels pending reminders across purchase types');
INSERT INTO pg_temp.ids VALUES('stopped-new',public.km16_begin_checkout_attempt('membership','20000000-0000-4000-8000-000000000060',
 '10000000-0000-4000-8000-000000000060','case60@example.invalid',true,true));
SELECT pg_temp.assert_true(public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='stopped-new'),'cs_live_case60',21000,'eur',true), 'new checkout remains functional after unsubscribe');
SELECT pg_temp.assert_true((SELECT state='skipped' AND error_code='unsubscribed' FROM public.km16_checkout_reminders WHERE id=(SELECT id FROM pg_temp.ids WHERE label='stopped-new')), 'later checkbox cannot silently remove global stop');
SELECT pg_temp.assert_true(public.km16_stop_checkout_reminders(repeat('1',64)) AND (SELECT count(*)=1 FROM public.km16_checkout_reminder_stops), 'unsubscribe is idempotent');
RESET ROLE;
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

-- One reminder per source, failed/uncertain messages are never retried by claim.
SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
SELECT pg_temp.seed(70,'video'),pg_temp.seed(71,'video');
SET LOCAL km16.test_clock='2026-11-21 10:00:00+00';
SET LOCAL ROLE service_role;
SELECT count(*) FROM public.km16_claim_checkout_reminders(10);
SELECT pg_temp.assert_true(public.km16_prepare_checkout_reminder_send(pg_temp.case_id(70),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(70)),repeat('3',64)), 'first source send can start');
SELECT pg_temp.assert_true(public.km16_finish_checkout_reminder(pg_temp.case_id(70),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(70)),'accepted'), 'first source send accepted');
SELECT pg_temp.assert_true(public.km16_prepare_checkout_reminder_send(pg_temp.case_id(71),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(71)),repeat('4',64)), 'other source can start');
SELECT pg_temp.assert_true(public.km16_finish_checkout_reminder(pg_temp.case_id(71),(SELECT lock_token FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(71)),'failed','smtp_rejected'), 'definite SMTP rejection becomes failed');
INSERT INTO pg_temp.ids VALUES('duplicate-source',public.km16_begin_checkout_attempt('video','video70',
 '10000000-0000-4000-8000-000000000070','case70@example.invalid',true,true));
SELECT pg_temp.assert_true(public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='duplicate-source'),'cs_live_newAttempt70',1900,'eur',true), 'later checkout is recorded without reusing old state');
SET LOCAL km16.test_clock='2026-11-22 10:00:01+00';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_claim_checkout_reminders(10)), 'same source already reminded and failed old sends are never retried');
RESET ROLE;
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
SELECT pg_temp.seed(80,'video');
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.ids VALUES('unfinished',public.km16_begin_checkout_attempt('video','video80',
 '10000000-0000-4000-8000-000000000080','case80@example.invalid',true,true));
SET LOCAL km16.test_clock='2026-11-20 11:00:01+00';
SELECT count(*) FROM public.km16_claim_checkout_reminders(10);
SELECT pg_temp.assert_true((SELECT state='skipped' AND error_code='checkout_not_attached' FROM public.km16_checkout_reminders WHERE id=(SELECT id FROM pg_temp.ids WHERE label='unfinished')), 'failed Stripe creation never becomes a reminder');
RESET ROLE;
DELETE FROM auth.users WHERE id='10000000-0000-4000-8000-000000000080';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.km16_checkout_reminders WHERE user_id='10000000-0000-4000-8000-000000000080'), 'registry does not block account deletion');
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

-- Two children using the same parent's account and same subscription remain
-- distinct. A newer checkout or payment for one must not suppress the other.
SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
SELECT pg_temp.seed(90,'membership'),pg_temp.seed(91,'membership');
DELETE FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(91);
UPDATE public.km16_membership_orders SET user_id='10000000-0000-4000-8000-000000000090',
 email='case90@example.invalid',product_id='product90',first_name='Second child',
 participant_key=encode(sha256(convert_to('live|10000000-0000-4000-8000-000000000090|2027-07-01|second child|person|2000-01-01','UTF8')),'hex')
 WHERE id='20000000-0000-4000-8000-000000000091';
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.ids VALUES('second-child',public.km16_begin_checkout_attempt('membership','20000000-0000-4000-8000-000000000091',
 '10000000-0000-4000-8000-000000000090','case90@example.invalid',true,true));
SELECT pg_temp.assert_true(public.km16_attach_checkout_attempt((SELECT id FROM pg_temp.ids WHERE label='second-child'),'cs_live_case91',21000,'eur',true), 'second child checkout can attach under the parent account');
SELECT pg_temp.assert_true((SELECT state='pending' FROM public.km16_checkout_reminders WHERE id=pg_temp.case_id(90)), 'second child does not supersede the first child');
SELECT pg_temp.assert_true((SELECT count(DISTINCT group_key)=2 FROM public.km16_checkout_reminders), 'group key distinguishes participants without clear identity fields');
RESET ROLE;
INSERT INTO public.km16_membership_payments VALUES ('first-child-paid','20000000-0000-4000-8000-000000000090','paid',0);
SET LOCAL km16.test_clock='2026-11-21 10:00:00+00';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT id=(SELECT id FROM pg_temp.ids WHERE label='second-child') FROM public.km16_claim_checkout_reminders(10)), 'payment for child one does not cancel child two reminder');
RESET ROLE;
TRUNCATE public.km16_checkout_reminders,public.km16_checkout_reminder_stops;

-- Availability matches checkout resumption: old season, changed public price,
-- and modified private offer fail closed; a still-valid private price survives.
SET LOCAL km16.test_clock='2026-11-20 10:00:00+00';
SELECT pg_temp.seed(93,'membership'),pg_temp.seed(94,'membership'),pg_temp.seed(95,'membership'),
 pg_temp.seed(96,'membership'),pg_temp.seed(97,'membership'),pg_temp.seed(98,'video'),pg_temp.seed(99,'shirts');
UPDATE public.km16_membership_orders SET participant_key=repeat('0',64) WHERE id='20000000-0000-4000-8000-000000000093';
UPDATE public.km16_membership_products SET amount=75000 WHERE id IN ('product94','product95');
INSERT INTO public.km16_purchase_links(id,order_id,livemode,expires_at,revoked_at,total_cents) VALUES
 ('30000000-0000-4000-8000-000000000095','20000000-0000-4000-8000-000000000095',true,'2026-12-01 10:00:00+00',NULL,63000),
 ('30000000-0000-4000-8000-000000000096','20000000-0000-4000-8000-000000000096',true,'2026-12-01 10:00:00+00',NULL,50000);
UPDATE public.km16_membership_orders SET purchase_link_id=('30000000-0000-4000-8000-'||right(id::text,12))::uuid WHERE id IN ('20000000-0000-4000-8000-000000000095','20000000-0000-4000-8000-000000000096');
UPDATE public.km16_membership_products SET kind='monthly' WHERE id='product97';
UPDATE public.km16_videos SET published=false WHERE id='video98';
INSERT INTO public.km16_shirt_orders(id,user_id,email,sizes,amount_cents,stripe_session_id,livemode,status,created_at)
 SELECT '20000000-0000-4000-8000-000000000999',user_id,email,sizes,amount_cents,'cs_live_otherShirtPaid',true,'paid','2026-11-20 11:00:00+00'
 FROM public.km16_shirt_orders WHERE id='20000000-0000-4000-8000-000000000099';
SET LOCAL km16.test_clock='2026-11-21 10:00:00+00';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT id=pg_temp.case_id(95) FROM public.km16_claim_checkout_reminders(10)), 'only valid private price remains; old season, changed price, edited link, unavailable monthly/video and paid replacement shirt excluded');
SELECT pg_temp.assert_true((SELECT count(*)=6 FROM public.km16_checkout_reminders WHERE state='skipped'), 'all six unresumable sources are terminal without SMTP');
RESET ROLE;

SELECT 'KM16_CHECKOUT_REMINDER_SQL_OK' AS result;
ROLLBACK;
