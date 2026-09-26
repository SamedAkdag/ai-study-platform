-- MVP: allow anon key to use books/chapters (no auth yet)
alter table books enable row level security;
alter table chapters enable row level security;

drop policy if exists "anon_all_books" on books;
create policy "anon_all_books"
  on books
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anon_all_chapters" on chapters;
create policy "anon_all_chapters"
  on chapters
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Also allow the special "public" role used by some API key modes
grant select, insert, update, delete on books to anon, authenticated;
grant select, insert, update, delete on chapters to anon, authenticated;
