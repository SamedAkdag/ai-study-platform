-- Cross-device study sync: chapter progress + PDF annotations
-- quiz_results + messages already exist from 20260326140000

create table if not exists chapter_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  book_id uuid references books on delete cascade not null,
  chapter_id uuid references chapters on delete cascade not null,
  opened_at timestamptz,
  quiz_ok int,
  quiz_total int,
  quiz_at timestamptz,
  updated_at timestamptz default now(),
  unique (user_id, chapter_id)
);

create index if not exists chapter_progress_user_book_idx
  on chapter_progress (user_id, book_id);

create table if not exists pdf_annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  book_id uuid references books on delete cascade not null,
  page int not null,
  kind text not null,
  quote text not null default '',
  body text,
  cite_style text,
  ai_mode text,
  question text,
  anchor_top_pct double precision,
  anchor_left_pct double precision,
  created_at timestamptz default now()
);

create index if not exists pdf_annotations_book_user_idx
  on pdf_annotations (book_id, user_id);

create index if not exists pdf_annotations_user_idx
  on pdf_annotations (user_id);

-- Optional context on chapter AI chat (selection quote)
alter table messages add column if not exists selection_quote text;

alter table chapter_progress enable row level security;
alter table pdf_annotations enable row level security;

drop policy if exists "chapter_progress_own" on chapter_progress;
create policy "chapter_progress_own"
  on chapter_progress for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- MVP open policies match existing study RLS style (tighten later)
drop policy if exists "anon_all_chapter_progress" on chapter_progress;
create policy "anon_all_chapter_progress"
  on chapter_progress for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "anon_all_pdf_annotations" on pdf_annotations;
create policy "anon_all_pdf_annotations"
  on pdf_annotations for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on chapter_progress to anon, authenticated;
grant select, insert, update, delete on pdf_annotations to anon, authenticated;

create index if not exists quiz_results_user_chapter_idx
  on quiz_results (user_id, chapter_id, created_at desc);

create index if not exists messages_user_chapter_idx
  on messages (user_id, chapter_id, created_at);
