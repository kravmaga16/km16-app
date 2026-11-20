-- Private ledger for a single Stripe charge shared by several annual enrolments.
create table public.km16_family_payments (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  livemode boolean not null,
  total_cents integer not null check (total_cents > 0),
  stripe_session_id text unique,
  payment_intent_id text unique,
  stripe_total_refunded integer not null default 0,
  state text not null default 'pending'
    check (state in ('pending','paid','partially_refunded','refunded','disputed','review')),
  created_at timestamptz not null default now(),
  check (stripe_total_refunded between 0 and total_cents)
);
alter table public.km16_family_payments enable row level security;
revoke all on public.km16_family_payments from public, anon, authenticated;
grant select, insert, update on public.km16_family_payments to service_role;

alter table public.km16_membership_orders
  add column family_payment_id uuid references public.km16_family_payments(id);
create index km16_membership_orders_family_payment_idx
  on public.km16_membership_orders(family_payment_id) where family_payment_id is not null;

create function public.km16_record_family_payment(
  p_id uuid, p_session text, p_intent text, p_livemode boolean,
  p_total integer, p_refunded integer, p_disputed boolean, p_allocations jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  batch public.km16_family_payments%rowtype;
  member_order public.km16_membership_orders%rowtype;
  order_count integer;
  order_total bigint;
  allocated bigint;
  member_refund integer;
  next_state text;
begin
  if p_session is null or p_intent is null or p_livemode is null or p_session !~ '^cs_(test|live)_[A-Za-z0-9]+$' or p_intent !~ '^pi_[A-Za-z0-9]+$'
     or p_total is null or p_refunded is null or p_refunded not between 0 and p_total
     or p_disputed is null then raise exception 'Invalid Stripe snapshot'; end if;
  select * into strict batch from public.km16_family_payments where id=p_id for update;
  if batch.livemode is distinct from p_livemode or batch.total_cents is distinct from p_total
     or (batch.stripe_session_id is not null and batch.stripe_session_id is distinct from p_session)
     or (batch.payment_intent_id is not null and batch.payment_intent_id is distinct from p_intent)
     or (p_livemode is distinct from (p_session like 'cs_live_%')) then
    raise exception 'Stripe snapshot does not match the family payment';
  end if;
  -- An older notification must never reduce the recorded refunded balance.
  if p_refunded<batch.stripe_total_refunded then return batch.state; end if;
  select count(*), sum(total_cents) into order_count,order_total
  from public.km16_membership_orders where family_payment_id=p_id
    and user_id=batch.user_id and livemode=batch.livemode and count=1;
  if order_count not between 2 and 8 or order_total is distinct from p_total::bigint
     or order_count<>(select count(*) from public.km16_membership_orders where family_payment_id=p_id)
     then raise exception 'Family enrolments do not match the charge'; end if;

  if p_refunded>0 and p_refunded<p_total then
    -- A partial refund is recorded only when Stripe refunds identify the affected orders.
    if jsonb_typeof(p_allocations) is distinct from 'object' then next_state:='review';
    else
      select coalesce(sum(case when v.value ~ '^[0-9]{1,9}$' then v.value::bigint else -1 end),0)
        into allocated from jsonb_each_text(p_allocations) v;
      if allocated<>p_refunded or exists (
        select 1 from jsonb_each_text(p_allocations) v
        left join public.km16_membership_orders o on o.id::text=v.key and o.family_payment_id=p_id
        where o.id is null or v.value is null or v.value !~ '^[0-9]{1,9}$'
          or case when v.value ~ '^[0-9]{1,9}$' then v.value::integer>o.total_cents else true end
      ) then next_state:='review'; end if;
    end if;
  end if;
  if next_state is null and p_refunded>0 and p_refunded<p_total and exists (
    select 1 from public.km16_membership_orders o
    join public.km16_membership_payments p on p.order_id=o.id
      and p.reference='family:'||p_intent||':'||o.id
    where o.family_payment_id=p_id
      and p.refunded_cents>coalesce((p_allocations->>o.id::text)::integer,0)
  ) then next_state:='review'; end if;
  if next_state is null then
    next_state:=case when p_disputed then 'disputed' when p_refunded=p_total then 'refunded'
      when p_refunded>0 then 'partially_refunded' else 'paid' end;
  end if;
  update public.km16_family_payments set stripe_session_id=p_session,payment_intent_id=p_intent,
    stripe_total_refunded=p_refunded,state=next_state where id=p_id;

  if next_state='review' then return next_state; end if;
  for member_order in select * from public.km16_membership_orders where family_payment_id=p_id order by id loop
    member_refund:=case when p_refunded=0 then 0 when p_refunded=p_total then member_order.total_cents
      else coalesce((p_allocations->>member_order.id::text)::integer,0) end;
    perform public.km16_record_membership_payment(jsonb_build_object(
      'reference','family:'||p_intent||':'||member_order.id,
      'order_id',member_order.id,'user_id',member_order.user_id,'amount_cents',member_order.total_cents,
      'refunded_cents',member_refund,
      'status',case when p_disputed then 'disputed' when member_refund>0 then 'refunded' else 'paid' end
    ));
    if p_disputed or member_refund>0 then
      update public.km16_membership_orders set approval='pending'
      where id=member_order.id and approval='approved';
    end if;
  end loop;
  return next_state;
end;
$$;
revoke all on function public.km16_record_family_payment(uuid,text,text,boolean,integer,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.km16_record_family_payment(uuid,text,text,boolean,integer,integer,boolean,jsonb) to service_role;

create function public.km16_create_family_payment(
  p_id uuid, p_user uuid, p_livemode boolean, p_orders jsonb
) returns public.km16_family_payments language plpgsql security invoker set search_path = '' as $$
declare
  batch public.km16_family_payments%rowtype;
  cfg public.km16_membership_config%rowtype;
  line public.km16_membership_orders%rowtype;
  offer public.km16_membership_products%rowtype;
  item jsonb;
  day_paris date := (now() at time zone 'Europe/Paris')::date;
  total bigint:=0;
begin
  if jsonb_typeof(p_orders) is distinct from 'array' or jsonb_array_length(p_orders) not between 2 and 8
    then raise exception 'Invalid family cart'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  select * into batch from public.km16_family_payments where id=p_id;
  if found then
    if batch.user_id is distinct from p_user or batch.livemode is distinct from p_livemode
      then raise exception 'Invalid family cart'; end if;
    return batch;
  end if;
  select * into strict cfg from public.km16_membership_config where id=1;
  if not cfg.enabled or cfg.season_end<day_paris then raise exception 'Enrolments closed'; end if;
  for item in select value from jsonb_array_elements(p_orders) loop
    line:=jsonb_populate_record(null::public.km16_membership_orders,item);
    select * into strict offer from public.km16_membership_products where id=line.product_id;
    if offer.kind<>'annual' or offer.draft or offer.review or offer.amount<=0
       or line.participant_key is null or line.household_id is null or line.birth_date is null
       or line.first_name is null or line.last_name is null or line.email is null
       or not exists(select 1 from public.km16_household_members h where h.id=line.household_id and h.owner_id=p_user)
       or (offer.min_age is not null and extract(year from age(day_paris,line.birth_date))<offer.min_age)
       or (offer.max_age is not null and extract(year from age(day_paris,line.birth_date))>offer.max_age)
       then raise exception 'Invalid participant or offer'; end if;
    total:=total+offer.amount;
  end loop;
  if (select count(distinct value->>'household_id') from jsonb_array_elements(p_orders))<>jsonb_array_length(p_orders) then
    raise exception 'Duplicate participant';
  end if;
  insert into public.km16_family_payments(id,user_id,livemode,total_cents)
    values(p_id,p_user,p_livemode,total) returning * into batch;
  for item in select value from jsonb_array_elements(p_orders) loop
    line:=jsonb_populate_record(null::public.km16_membership_orders,item);
    select * into strict offer from public.km16_membership_products where id=line.product_id;
    insert into public.km16_membership_orders(
      id,user_id,email,household_id,family_payment_id,participant_key,product_id,title,livemode,
      total_cents,count,amounts,first_name,last_name,birth_date,phone,guardian_name,
      approval,terms_version,consented_at,license_external
    ) values(
      line.id,p_user,line.email,line.household_id,p_id,line.participant_key,offer.id,offer.title,p_livemode,
      offer.amount,1,jsonb_build_array(offer.amount),line.first_name,line.last_name,line.birth_date,line.phone,line.guardian_name,
      'pending',cfg.terms_version,now(),true
    );
  end loop;
  return batch;
end;
$$;
revoke all on function public.km16_create_family_payment(uuid,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.km16_create_family_payment(uuid,uuid,boolean,jsonb) to service_role;
