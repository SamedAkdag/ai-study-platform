-- Phase 2: study platform schema (extends Milestone 1)
-- Keep existing books/chapters; add study-material + chat + quiz tables.
-- PDF parsing stays CLIENT-SIDE; chapters ≈ ~5-page study blocks.

create extension if not exists vector;

-- books
alter table books add column if not exists user_id uuid references auth.users;
alter table books add column if not exists subject text;
alter table books add column if not exists file_url text;
alter table books add column if not exists progress_step text;
-- progress_step: extracting | analyzing | segmenting | generating | ready | failed

-- chapters (study units / PDF blocks)
alter table chapters add column if not exists order_index int;
alter table chapters add column if not exists explanation text;
alter table chapters add column if not exists examples jsonb;
alter table chapters add column if not exists quiz jsonb;
alter table chapters add column if not exists page_text text;
-- embedding optional until an embedding provider is wired
alter table chapters add column if not exists embedding vector(1536);

update chapters
set order_index = chapter_number
where order_index is null and chapter_number is not null;

-- Allow generating status
-- status: pending | generating | ready | failed

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references chapters on delete cascade not null,
  user_id uuid references auth.users,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create table if not exists quiz_results (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references chapters on delete cascade not null,
  user_id uuid references auth.users,
  score int not null,
  total int not null,
  answers jsonb,
  created_at timestamptz default now()
);

create index if not exists messages_chapter_id_idx on messages (chapter_id);
create index if not exists quiz_results_chapter_id_idx on quiz_results (chapter_id);

-- MVP RLS (tighten after Auth)
alter table messages enable row level security;
alter table quiz_results enable row level security;

drop policy if exists "anon_all_messages" on messages;
create policy "anon_all_messages"
  on messages for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "anon_all_quiz_results" on quiz_results;
create policy "anon_all_quiz_results"
  on quiz_results for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on messages to anon, authenticated;
grant select, insert, update, delete on quiz_results to anon, authenticated;
