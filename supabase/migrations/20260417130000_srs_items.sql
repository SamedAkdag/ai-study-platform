-- Spaced repetition queue (chapter-level reviews)

create table if not exists srs_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  book_id uuid references books on delete cascade not null,
  chapter_id uuid references chapters on delete cascade not null,
  item_key text not null default 'chapter',
  ease real not null default 2.5,
  interval_days int not null default 0,
  repetitions int not null default 0,
  due_at date not null,
  last_grade int,
  updated_at timestamptz default now(),
  unique (user_id, chapter_id, item_key)
);

create index if not exists srs_items_user_due_idx
  on srs_items (user_id, due_at);

create index if not exists srs_items_book_idx
  on srs_items (book_id, user_id);

alter table srs_items enable row level security;

drop policy if exists "anon_all_srs_items" on srs_items;
create policy "anon_all_srs_items"
  on srs_items for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on srs_items to anon, authenticated;
