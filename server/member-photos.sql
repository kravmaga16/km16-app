-- Private participant portraits. Access only through the authenticated Edge API.
create table public.km16_member_photos (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 path text not null unique,
 created_at timestamptz not null default now()
);
alter table public.km16_member_photos enable row level security;
revoke all on public.km16_member_photos from anon, authenticated;
grant all on public.km16_member_photos to service_role;
create index km16_member_photos_user_created on public.km16_member_photos(user_id,created_at);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('km16-member-photos','km16-member-photos',false,1500000,array['image/jpeg']);
