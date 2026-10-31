-- Allow removing original PDFs when a book is deleted

drop policy if exists "book_pdfs_delete" on storage.objects;

create policy "book_pdfs_delete"
  on storage.objects for delete
  using (bucket_id = 'book-pdfs');
