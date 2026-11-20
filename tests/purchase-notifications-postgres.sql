-- All records are fictional; there is no mail worker, cron or network extension.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %',message; end if; end; $$;

select pg_temp.assert_true((select count(*) = 0 from public.km16_admin_purchase_notifications), 'no historical backfill');
select pg_temp.assert_true(not has_function_privilege('anon','public.km16_enqueue_club_purchase()','EXECUTE')
  and not has_function_privilege('authenticated','public.km16_enqueue_club_purchase()','EXECUTE')
  and not has_function_privilege('service_role','public.km16_enqueue_club_purchase()','EXECUTE'), 'club trigger has no direct browser/service execute');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.km16_enqueue_membership_purchase()','EXECUTE')
  and not has_function_privilege('anon','public.km16_enqueue_membership_purchase()','EXECUTE'), 'membership trigger retains internal privileges');
select pg_temp.assert_true(has_function_privilege('service_role','public.km16_claim_shirt_payment_checks(integer)','EXECUTE')
  and not has_function_privilege('anon','public.km16_claim_shirt_payment_checks(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.km16_claim_shirt_payment_checks(integer)','EXECUTE'), 'only service_role can claim shirt checks');
select pg_temp.assert_true((select not prosecdef from pg_proc where oid='public.km16_claim_shirt_payment_checks(integer)'::regprocedure), 'shirt RPC remains invoker');

set local role authenticated;
set local km16.fixture_admin = 'no';
do $$ begin
  insert into public.km16_club_registrations(id,season_id,test,first_name,last_name,method,amount_cents,received_on)
  values ('10000000-0000-4000-8000-000000000009','2026/2027',false,'Forbidden','Fixture','cash',1000,'2026-11-19');
  raise exception 'FAIL: non-admin could create a club receipt';
exception when insufficient_privilege then null; end; $$;
set local km16.fixture_admin = 'yes';
insert into public.km16_club_registrations(id,season_id,test,first_name,last_name,method,amount_cents,received_on) values
 ('10000000-0000-4000-8000-000000000001','2026/2027',false,'Alice','Cheque','cheque',63000,'2026-11-19'),
 ('10000000-0000-4000-8000-000000000002','2026/2027',false,'Bob','Cash','cash',4000,'2026-07-01'),
 ('10000000-0000-4000-8000-000000000003','2026/2027',true,'Test','Cheque','cheque',63000,'2026-11-19'),
 ('10000000-0000-4000-8000-000000000004','2026/2027',true,'Test','Cash','cash',4000,'2026-11-19');
do $$ begin
  insert into public.km16_admin_purchase_notifications(event_key,kind,buyer_name,product_name,amount_cents,paid_at)
  values ('forbidden','test','Fixture','Fixture',100,now());
  raise exception 'FAIL: browser could insert its own notification';
exception when insufficient_privilege then null; end; $$;
do $$ begin
  perform * from public.km16_claim_shirt_payment_checks();
  raise exception 'FAIL: authenticated could claim Stripe checks';
exception when insufficient_privilege then null; end; $$;
reset role;

select pg_temp.assert_true((select count(*) = 2 from public.km16_admin_purchase_notifications), 'only two real club receipts enqueue');
select pg_temp.assert_true((select kind='règlement au club · chèque' and buyer_name='Alice Cheque'
  and product_name='Règlement au club · saison 2026/2027' and amount_cents=63000
  and paid_at='2026-11-18 23:00:00+00'::timestamptz and recipient='contact@km16.fr'
  from public.km16_admin_purchase_notifications where event_key='club:10000000-0000-4000-8000-000000000001'), 'cheque details and winter Paris date');
select pg_temp.assert_true((select kind='règlement au club · espèces'
  and paid_at='2026-06-30 22:00:00+00'::timestamptz
  from public.km16_admin_purchase_notifications where event_key='club:10000000-0000-4000-8000-000000000002'), 'cash label and summer Paris date');
update public.km16_club_registrations set amount_cents=4001 where id='10000000-0000-4000-8000-000000000002';
insert into public.km16_club_registrations(id,season_id,test,first_name,last_name,method,amount_cents,received_on)
values ('10000000-0000-4000-8000-000000000001','2026/2027',false,'Alice','Cheque','cheque',63000,'2026-11-19')
on conflict(id) do nothing;
select pg_temp.assert_true((select count(*) = 2 from public.km16_admin_purchase_notifications), 'updates and duplicate receipt do not resend');

insert into public.km16_membership_products values
 ('annual','annual','Adultes'),('monthly','monthly','Adultes'),('stage','single','Stages'),
 ('class','single','Découverte'),('other','single','Autres'),('free','single','Découverte');
insert into public.km16_membership_orders(id,product_id,livemode,first_name,last_name,title) values
 ('20000000-0000-4000-8000-000000000001','annual',true,'Annual','Fixture','Abonnement annuel'),
 ('20000000-0000-4000-8000-000000000002','monthly',true,'Monthly','Fixture','Abonnement mensuel'),
 ('20000000-0000-4000-8000-000000000003','stage',true,'Stage','Fixture','Stage 3/9'),
 ('20000000-0000-4000-8000-000000000004','class',true,'Class','Fixture','Cours 2 heures'),
 ('20000000-0000-4000-8000-000000000005','other',true,'Other','Fixture','Autre achat'),
 ('20000000-0000-4000-8000-000000000006','annual',false,'Sandbox','Fixture','Test annuel'),
 ('20000000-0000-4000-8000-000000000007','free',true,'Free','Fixture','Essai offert'),
 ('20000000-0000-4000-8000-000000000008','missing',true,'Missing','Fixture','Titre archivé');
insert into public.km16_membership_payments(reference,order_id,amount_cents,refunded_cents,status) values
 ('annual-1','20000000-0000-4000-8000-000000000001',21000,0,'paid'),
 ('annual-2','20000000-0000-4000-8000-000000000001',21000,0,'paid'),
 ('monthly','20000000-0000-4000-8000-000000000002',9500,0,'paid'),
 ('stage','20000000-0000-4000-8000-000000000003',3000,0,'paid'),
 ('class','20000000-0000-4000-8000-000000000004',4000,null,'pending'),
 ('other','20000000-0000-4000-8000-000000000005',100,0,'paid'),
 ('test','20000000-0000-4000-8000-000000000006',63000,0,'paid'),
 ('free','20000000-0000-4000-8000-000000000007',0,0,'paid'),
 ('refund','20000000-0000-4000-8000-000000000001',21000,100,'paid'),
 ('unpaid','20000000-0000-4000-8000-000000000001',21000,0,'failed'),
 ('missing-product','20000000-0000-4000-8000-000000000008',100,0,'paid');
select pg_temp.assert_true((select count(*) = 8 from public.km16_admin_purchase_notifications), 'only paid positive live non-refunded receipts enqueue');
update public.km16_membership_payments set status='paid' where reference='class';
select pg_temp.assert_true((select kind='cours à l’unité' and product_name='Cours 2 heures' from public.km16_admin_purchase_notifications where event_key='membership:class'), 'pending to paid enqueues individual class');
select pg_temp.assert_true((select kind='stage' and product_name='Stage 3/9' from public.km16_admin_purchase_notifications where event_key='membership:stage'), 'stage has its own label and retains exact product title');
select pg_temp.assert_true((select count(*) = 3 from public.km16_admin_purchase_notifications where kind='abonnement'), 'annual installments and monthly payments retain subscription label');
select pg_temp.assert_true((select count(*) = 2 from public.km16_admin_purchase_notifications where kind='achat'), 'unknown or archived products use safe fallback with existing order title');
update public.km16_membership_payments set status='paid' where reference='annual-1';
update public.km16_membership_payments set status='pending' where reference='annual-1';
update public.km16_membership_payments set status='paid' where reference='annual-1';
select pg_temp.assert_true((select count(*) = 9 from public.km16_admin_purchase_notifications), 'replayed transition does not duplicate installment notification');

insert into public.km16_shirt_orders(id,stripe_session_id,amount_cents,status,livemode,created_at,payment_check_attempted_at) values
 ('30000000-0000-4000-8000-000000000001','cs_live_first',1800,'pending',true,now()-interval '3 hours',null),
 ('30000000-0000-4000-8000-000000000002','cs_live_second',3000,'pending',true,now()-interval '2 hours',null),
 ('30000000-0000-4000-8000-000000000003','cs_live_retry',1800,'pending',true,now()-interval '4 hours',now()-interval '1 minute'),
 ('30000000-0000-4000-8000-000000000004','cs_live_recent',1800,'pending',true,now()-interval '4 hours',now()),
 ('30000000-0000-4000-8000-000000000005','cs_test',1800,'pending',false,now()-interval '4 hours',null),
 ('30000000-0000-4000-8000-000000000006','cs_paid',1800,'paid',true,now()-interval '4 hours',null),
 ('30000000-0000-4000-8000-000000000007','cs_cancelled',1800,'cancelled',true,now()-interval '4 hours',null),
 ('30000000-0000-4000-8000-000000000008',null,1800,'pending',true,now()-interval '4 hours',null),
 ('30000000-0000-4000-8000-000000000009','cs_exact_boundary',1800,'pending',true,now()-interval '4 hours',now()-interval '45 seconds');

set local role service_role;
select pg_temp.assert_true((select id='30000000-0000-4000-8000-000000000001'::uuid from public.km16_claim_shirt_payment_checks(1)), 'oldest never-checked pending order first');
select pg_temp.assert_true((select id='30000000-0000-4000-8000-000000000002'::uuid from public.km16_claim_shirt_payment_checks(1)), 'second claim does not reclaim first lease');
select pg_temp.assert_true((select id='30000000-0000-4000-8000-000000000003'::uuid from public.km16_claim_shirt_payment_checks(8)), 'old failed attempt becomes eligible after lease');
select pg_temp.assert_true((select count(*)=0 from public.km16_claim_shirt_payment_checks(20)), 'recent, boundary, test, paid, cancelled and missing-session rows excluded');
reset role;
select pg_temp.assert_true((select count(*)=7 from public.km16_shirt_orders where status='pending'), 'claim does not mark orders paid');
select pg_temp.assert_true((select payment_check_attempted_at is null from public.km16_shirt_orders where id='30000000-0000-4000-8000-000000000005'), 'sandbox order is never touched');

insert into public.km16_shirt_orders(id,stripe_session_id,amount_cents,livemode)
select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cs_batch_'||n,1800,true
from generate_series(1,40) as n;
set local role service_role;
select pg_temp.assert_true((select count(*)=8 from public.km16_claim_shirt_payment_checks(null)), 'null batch uses default of eight');
select pg_temp.assert_true((select count(*)=20 from public.km16_claim_shirt_payment_checks(100000)), 'batch is capped at twenty');
select pg_temp.assert_true((select count(*)=1 from public.km16_claim_shirt_payment_checks(0)), 'zero batch is clamped to one');
select pg_temp.assert_true((select count(*)=1 from public.km16_claim_shirt_payment_checks(-10)), 'negative batch is clamped to one');
select pg_temp.assert_true((select count(*)=10 from public.km16_claim_shirt_payment_checks(20)), 'remaining rows progress without starvation or immediate duplicate claims');
select pg_temp.assert_true((select count(*)=0 from public.km16_claim_shirt_payment_checks()), 'completed pass has no immediate duplicates');
reset role;

select 'KM16_PURCHASE_NOTIFICATION_SQL_OK' as result;
rollback;
