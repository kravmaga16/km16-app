-- New purchase alerts only: never enqueue historical club payments or imports.
-- The existing mail worker remains the only sender, to contact@km16.fr.

create or replace function public.km16_enqueue_club_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.test is false and new.amount_cents > 0 then
    insert into public.km16_admin_purchase_notifications (
      event_key, kind, buyer_name, product_name, amount_cents, paid_at
    ) values (
      'club:' || new.id,
      case new.method
        when 'cheque' then 'règlement au club · chèque'
        when 'cash' then 'règlement au club · espèces'
      end,
      pg_catalog.btrim(pg_catalog.concat_ws(' ', new.first_name, new.last_name)),
      'Règlement au club · saison ' || new.season_id,
      new.amount_cents,
      new.received_on::timestamp at time zone 'Europe/Paris'
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

alter function public.km16_enqueue_club_purchase() owner to postgres;
revoke all on function public.km16_enqueue_club_purchase()
  from public, anon, authenticated, service_role;

drop trigger if exists km16_purchase_mail_club on public.km16_club_registrations;
create trigger km16_purchase_mail_club
after insert on public.km16_club_registrations
for each row execute function public.km16_enqueue_club_purchase();

-- Preserve the paid transition, live-mode and refund guards and the event key.
-- Only the displayed purchase kind changes for stages and individual classes.
create or replace function public.km16_enqueue_membership_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.km16_membership_orders%rowtype;
  product_kind text;
  product_category text;
  notification_kind text;
begin
  if new.status is distinct from 'paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'paid' then
    return new;
  end if;

  select o.* into order_row
  from public.km16_membership_orders as o
  where o.id = new.order_id;

  if order_row.id is not null
     and order_row.livemode is true
     and new.amount_cents > 0
     and coalesce(new.refunded_cents, 0) = 0 then
    select p.kind, p.category into product_kind, product_category
    from public.km16_membership_products as p
    where p.id = order_row.product_id;

    notification_kind := case
      when pg_catalog.lower(pg_catalog.btrim(product_category)) = 'stages' then 'stage'
      when product_kind in ('annual', 'monthly') then 'abonnement'
      when pg_catalog.lower(pg_catalog.btrim(product_category)) = 'découverte' then 'cours à l’unité'
      else 'achat'
    end;

    insert into public.km16_admin_purchase_notifications (
      event_key, kind, buyer_name, product_name, amount_cents, paid_at
    ) values (
      'membership:' || new.reference,
      notification_kind,
      pg_catalog.btrim(pg_catalog.concat_ws(' ', order_row.first_name, order_row.last_name)),
      order_row.title,
      new.amount_cents,
      new.created_at
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

alter function public.km16_enqueue_membership_purchase() owner to postgres;
revoke all on function public.km16_enqueue_membership_purchase()
  from public, anon, authenticated, service_role;

-- A claim records the attempt before contacting Stripe. Failed reads can be
-- retried; previously paid/cancelled or sandbox orders cannot enter this batch.
alter table public.km16_shirt_orders
  add column if not exists payment_check_attempted_at timestamptz;

create index if not exists km16_shirt_pending_payment_checks
  on public.km16_shirt_orders (
    payment_check_attempted_at asc nulls first, created_at asc, id asc
  )
  where status = 'pending' and livemode is true and stripe_session_id is not null;

create or replace function public.km16_claim_shirt_payment_checks(p_limit integer default 8)
returns table (id uuid, stripe_session_id text, amount_cents integer, livemode boolean)
language sql
security invoker
set search_path = ''
as $$
  with picked as (
    select o.id
    from public.km16_shirt_orders as o
    where o.status = 'pending'
      and o.livemode is true
      and o.stripe_session_id is not null
      and (
        o.payment_check_attempted_at is null
        or o.payment_check_attempted_at < now() - interval '45 seconds'
      )
    order by o.payment_check_attempted_at asc nulls first, o.created_at asc, o.id asc
    limit greatest(1, least(coalesce(p_limit, 8), 20))
    for update skip locked
  ), claimed as (
    update public.km16_shirt_orders as o
    set payment_check_attempted_at = now()
    from picked
    where o.id = picked.id
    returning o.id, o.stripe_session_id, o.amount_cents, o.livemode
  )
  select c.id, c.stripe_session_id, c.amount_cents, c.livemode
  from claimed as c;
$$;

alter function public.km16_claim_shirt_payment_checks(integer) owner to postgres;
revoke all on function public.km16_claim_shirt_payment_checks(integer)
  from public, anon, authenticated;
grant execute on function public.km16_claim_shirt_payment_checks(integer) to service_role;

-- Existing table policies and grants are intentionally preserved. service_role
-- already has SELECT/UPDATE on the shirt table; browser roles cannot call the RPC.
