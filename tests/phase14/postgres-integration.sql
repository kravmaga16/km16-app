-- Transactional integration tests on a disposable database.
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $test$
declare v record; n integer;
begin
 select * into v from public.km16_member_review_set('2026/2027','test','fictional-active','en_cours',0);
 if v.state<>'en_cours' or v.version<>1 then raise exception 'Initial status failed'; end if;
 select * into v from public.km16_member_review_set('2026/2027','test','fictional-active','controle',1);
 if v.state<>'controle' or v.version<>2 then raise exception 'Transition failed'; end if;
 select count(*) into n from public.km16_member_review_history where source_member_id='fictional-active' and environment='test';
 if n<>2 then raise exception 'History failed'; end if;
 select * into v from public.km16_member_review_set('2026/2027','test','fictional-active','controle',2);
 select count(*) into n from public.km16_member_review_history where source_member_id='fictional-active' and environment='test';
 if n<>2 then raise exception 'No-op produced history'; end if;
 begin
   perform public.km16_member_review_set('2026/2027','test','fictional-active','a_verifier',1);
   raise exception 'Expected stale version to fail';
 exception when sqlstate '40001' then null; end;
 begin
   perform public.km16_member_review_set('2026/2027','test','fictional-archived','controle',0);
   raise exception 'Expected archived record to fail';
 exception when sqlstate '22023' then null; end;
 select count(*) into n from public.km16_member_review_list('2026/2027','test');
 if n<>1 then raise exception 'Active season filter failed: %',n; end if;
 select count(*) into n from public.km16_member_review_history_list('2026/2027','test','fictional-active',1,null);
 if n<>1 then raise exception 'History pagination failed'; end if;
 select count(*) into n from public.km16_member_review_status where environment='live';
 if n<>0 then raise exception 'Environment isolation failed'; end if;
end $test$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $test$
begin
 begin
   perform public.km16_member_review_set('2026/2027','test','fictional-active','controle',2);
   raise exception 'Expected non-admin to fail';
 exception when insufficient_privilege then null; end;
 begin
   perform public.km16_member_review_list('2026/2027','test');
   raise exception 'Expected non-admin read to fail';
 exception when insufficient_privilege then null; end;
end $test$;
select set_config('request.jwt.claim.sub','',false);
do $test$
begin
 begin
   perform public.km16_member_review_history_list('2026/2027','test','fictional-active');
   raise exception 'Expected anonymous history read to fail';
 exception when insufficient_privilege then null; end;
end $test$;
rollback;
