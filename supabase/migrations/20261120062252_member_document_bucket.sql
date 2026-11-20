insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('km16-member-documents', 'km16-member-documents', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png']);

create policy "KM16 member documents require server access"
on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'km16-member-documents')
with check (bucket_id <> 'km16-member-documents');
