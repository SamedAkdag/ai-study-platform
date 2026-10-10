-- Store original PDFs for side-by-side study view

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'book-pdfs',
  'book-pdfs',
  false,
  52428800,
  array['application/pdf']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- MVP: allow read/upload (matches open study RLS style)
drop policy if exists "book_pdfs_select" on storage.objects;
drop policy if exists "book_pdfs_insert" on storage.objects;
drop policy if exists "book_pdfs_update" on storage.objects;

create policy "book_pdfs_select"
  on storage.objects for select
  using (bucket_id = 'book-pdfs');

create policy "book_pdfs_insert"
  on storage.objects for insert
  with check (bucket_id = 'book-pdfs');

create policy "book_pdfs_update"
  on storage.objects for update
  using (bucket_id = 'book-pdfs')
  with check (bucket_id = 'book-pdfs');
