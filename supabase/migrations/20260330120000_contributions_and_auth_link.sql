-- Contributions + moderation + link group members to auth.users

alter table group_members
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists group_members_user_id_idx
  on group_members (user_id)
  where user_id is not null;

create table if not exists chapter_contributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references study_groups (id) on delete cascade,
  chapter_id uuid not null references chapters (id) on delete cascade,
  member_id uuid references group_members (id) on delete set null,
  author_name text not null,
  kind text not null check (kind in ('quiz', 'example', 'explanation')),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references group_members (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists chapter_contributions_chapter_status_idx
  on chapter_contributions (chapter_id, status, created_at desc);

create index if not exists chapter_contributions_group_status_idx
  on chapter_contributions (group_id, status, created_at desc);

alter table chapter_contributions enable row level security;

drop policy if exists "anon_all_chapter_contributions" on chapter_contributions;
create policy "anon_all_chapter_contributions"
  on chapter_contributions for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on chapter_contributions to anon, authenticated;
