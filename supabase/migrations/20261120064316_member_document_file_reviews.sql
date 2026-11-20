create table public.km16_document_file_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.km16_membership_orders(id) on delete cascade,
  object_name text not null check (object_name ~ '^(health|license)(-[a-f0-9-]{36})?$'),
  state text not null check (state in ('validated','correction')),
  reason text not null default '' check (length(reason)<=500 and (state<>'correction' or length(trim(reason))>0)),
  reviewed_by uuid not null,
  created_at timestamptz not null default now(),
  unique(order_id, object_name)
);
alter table public.km16_document_file_reviews enable row level security;
revoke all on table public.km16_document_file_reviews from public, anon, authenticated;
grant select, insert on table public.km16_document_file_reviews to service_role;

create function public.km16_sync_health_file_review()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.object_name='health' or new.object_name like 'health-%' then
    update public.km16_membership_documents
    set health_status=case when new.state='validated' then 'validated' else 'missing' end,
        updated_at=now(), reviewed_by=new.reviewed_by, revision=revision+1
    where order_id=new.order_id;
  end if;
  return new;
end;
$$;
revoke all on function public.km16_sync_health_file_review() from public, anon, authenticated;
create trigger km16_sync_health_file_review
after insert on public.km16_document_file_reviews
for each row execute function public.km16_sync_health_file_review();
