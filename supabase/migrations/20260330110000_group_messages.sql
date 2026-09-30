-- Group discussion chat (book-level or chapter-scoped)

create table if not exists group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references study_groups (id) on delete cascade,
  chapter_id uuid references chapters (id) on delete cascade,
  member_id uuid references group_members (id) on delete set null,
  author_name text not null,
  author_role text not null check (author_role in ('owner', 'admin', 'write', 'read')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists group_messages_group_id_created_idx
  on group_messages (group_id, created_at desc);

create index if not exists group_messages_chapter_id_created_idx
  on group_messages (chapter_id, created_at desc)
  where chapter_id is not null;

alter table group_messages enable row level security;

drop policy if exists "anon_all_group_messages" on group_messages;
create policy "anon_all_group_messages"
  on group_messages for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on group_messages to anon, authenticated;
