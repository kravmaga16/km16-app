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
 -- Separate season and environment must not inherit status.
 select count(*) into n from public.km16_member_review_list('2025/2026','test');
 if n<>1 then raise exception 'Previous season fixture missing'; end if;
 select count(*) into n from public.km16_member_review_list('2026/2027','live') where state<>'a_verifier' or version<>0;
 if n<>0 then raise exception 'Live environment leaked test state'; end if;
 begin
   perform public.km16_member_review_set('2026/2027','test','fictional-active','unknown',2);
   raise exception 'Invalid state was accepted';
 exception when sqlstate '22023' then null; end;
 begin
   perform public.km16_member_review_set('2026/2027','test','fictional-active','controle',-1);
   raise exception 'Invalid version was accepted';
 exception when sqlstate '22023' then null; end;
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
-- Exercise actual client roles, not only JWT claim simulations.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare v record;
begin
 select * into v from public.km16_member_review_set('2026/2027','test','fictional-active','controle',2);
 if v.version<>2 then raise exception 'Authenticated admin RPC failed'; end if;
 begin
   perform 1 from public.km16_member_review_status limit 1;
   raise exception 'Authenticated role has direct table read access';
 exception when insufficient_privilege then null; end;
 begin
   perform 1 from public.km16_member_review_history limit 1;
   raise exception 'Authenticated role has direct history access';
 exception when insufficient_privilege then null; end;
end $test$;
-- Verify client roles cannot write directly to either review table.
set local role authenticated;
do $test$
begin
 begin
   insert into public.km16_member_review_status
     (season_id,environment,source,source_member_id,state)
   values ('2026/2027','test','import','fictional-active','controle');
   raise exception 'Authenticated role can write review status directly';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.km16_member_review_history
     (season_id,environment,source,source_member_id,new_state,version)
   values ('2026/2027','test','import','fictional-active','controle',1);
   raise exception 'Authenticated role can write history directly';
 exception when insufficient_privilege then null; end;
end $test$;
-- Prevent direct status modification/deletion and direct history deletion.
set local role authenticated;
do $test$
begin
 begin
   update public.km16_member_review_status set state='controle' where source_member_id='fictional-active';
   raise exception 'Authenticated role can update status directly';
 exception when insufficient_privilege then null; end;
 begin
   delete from public.km16_member_review_status where source_member_id='fictional-active';
   raise exception 'Authenticated role can delete status directly';
 exception when insufficient_privilege then null; end;
 begin
   delete from public.km16_member_review_history where source_member_id='fictional-active';
   raise exception 'Authenticated role can delete history directly';
 exception when insufficient_privilege then null; end;
end $test$;
-- Verify authorization under the real authenticated database role, not only a JWT claim.
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $test$
begin
 begin
   perform public.km16_member_review_list('2026/2027','test');
   raise exception 'Authenticated non-admin can list reviews';
 exception when insufficient_privilege then null; end;
 begin
   perform public.km16_member_review_history_list('2026/2027','test','fictional-active');
   raise exception 'Authenticated non-admin can read review history';
 exception when insufficient_privilege then null; end;
 begin
   perform public.km16_member_review_set('2026/2027','test','fictional-active','a_verifier',2);
   raise exception 'Authenticated non-admin can update review status';
 exception when insufficient_privilege then null; end;
end $test$;
set local role anon;
do $test$
begin
 begin
   perform public.km16_member_review_list('2026/2027','test');
   raise exception 'Anon can execute admin RPC';
 exception when insufficient_privilege then null; end;
end $test$;
rollback;
