-- Run this after creating the 'appeal-proofs' bucket in Storage (must be
-- created manually in the dashboard - SQL can't create buckets, only policies).

create policy "students upload to own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'appeal-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "owner or staff can view proof files"
on storage.objects for select to authenticated
using (
  bucket_id = 'appeal-proofs'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_staff_or_admin()
  )
);
