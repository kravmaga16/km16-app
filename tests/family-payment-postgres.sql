-- Apply the family payment migration in a disposable database with the annual offer fixture.
begin;
do $test$
declare
  owner_id uuid;
  profile_a uuid:=gen_random_uuid();
  profile_b uuid:=gen_random_uuid();
  order_a uuid:=gen_random_uuid();
  order_b uuid:=gen_random_uuid();
  batch_id uuid:=gen_random_uuid();
  cart jsonb;
  subtotal integer;
  state text;
begin
  select id into strict owner_id from auth.users order by created_at limit 1;
  insert into public.km16_household_members(id,owner_id,label) values
    (profile_a,owner_id,'Essai technique A'),(profile_b,owner_id,'Essai technique B');
  cart:=jsonb_build_array(
    jsonb_build_object('id',order_a,'household_id',profile_a,'participant_key','fixture-'||order_a,'product_id','adulte-premiere','email','fixture@example.invalid','first_name','Test','last_name','A','birth_date','1990-01-01','phone','0600000000'),
    jsonb_build_object('id',order_b,'household_id',profile_b,'participant_key','fixture-'||order_b,'product_id','adulte-premiere','email','fixture@example.invalid','first_name','Test','last_name','B','birth_date','1990-01-01','phone','0600000000')
  );
  select amount into strict subtotal from public.km16_membership_products where id='adulte-premiere';
  perform public.km16_create_family_payment(batch_id,owner_id,false,cart);
  perform public.km16_create_family_payment(batch_id,owner_id,false,cart);
  if (select count(*) from public.km16_membership_orders where family_payment_id=batch_id)<>2 then raise exception 'Duplicate orders'; end if;
  state:=public.km16_record_family_payment(batch_id,'cs_test_KM16Fixture','pi_KM16Fixture',false,2*subtotal,0,false,null);
  if state<>'paid' or (select count(*) from public.km16_membership_payments where order_id in (order_a,order_b) and amount_cents=subtotal)<>2 then raise exception 'Wrong payment allocation'; end if;
  state:=public.km16_record_family_payment(batch_id,'cs_test_KM16Fixture','pi_KM16Fixture',false,2*subtotal,subtotal,false,null);
  if state<>'review' or exists(select 1 from public.km16_membership_payments where order_id in (order_a,order_b) and refunded_cents<>0) then raise exception 'Unknown refund was attributed'; end if;
  state:=public.km16_record_family_payment(batch_id,'cs_test_KM16Fixture','pi_KM16Fixture',false,2*subtotal,subtotal,false,jsonb_build_object(order_b::text,subtotal));
  if state<>'partially_refunded' or not exists(select 1 from public.km16_membership_payments where order_id=order_b and refunded_cents=subtotal)
    or not exists(select 1 from public.km16_membership_payments where order_id=order_a and status='paid' and refunded_cents=0) then raise exception 'Wrong partial refund allocation'; end if;
  state:=public.km16_record_family_payment(batch_id,'cs_test_KM16Fixture','pi_KM16Fixture',false,2*subtotal,0,false,null);
  if state<>'partially_refunded' then raise exception 'Stale notification replaced the refund'; end if;
  state:=public.km16_record_family_payment(batch_id,'cs_test_KM16Fixture','pi_KM16Fixture',false,2*subtotal,2*subtotal,false,null);
  if state<>'refunded' or (select sum(refunded_cents) from public.km16_membership_payments where order_id in (order_a,order_b))<>2*subtotal then raise exception 'Wrong full refund allocation'; end if;
end;
$test$;
rollback;
