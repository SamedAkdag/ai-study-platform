-- Per-operation LLM token usage (input / output) for the study usage panel.

create table if not exists ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  book_id uuid references books (id) on delete set null,
  chapter_id uuid references chapters (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  operation text not null,
  provider text,
  model text,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  estimated boolean not null default false,
  meta jsonb
);

create index if not exists ai_usage_events_book_created_idx
  on ai_usage_events (book_id, created_at desc);

create index if not exists ai_usage_events_chapter_created_idx
  on ai_usage_events (chapter_id, created_at desc);

create index if not exists ai_usage_events_user_created_idx
  on ai_usage_events (user_id, created_at desc)
  where user_id is not null;

alter table ai_usage_events enable row level security;

drop policy if exists "anon_all_ai_usage_events" on ai_usage_events;
create policy "anon_all_ai_usage_events"
  on ai_usage_events for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on ai_usage_events to anon, authenticated;
