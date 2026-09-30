-- Study groups: roles + invite links for shared books (Phase 1)
-- Identity is client member_key until Auth is wired.

create table if not exists study_groups (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (book_id)
);

create table if not exists group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references study_groups (id) on delete cascade,
  token text not null,
  role text not null check (role in ('admin', 'write', 'read')),
  label text,
  max_uses int,
  use_count int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (token)
);

create table if not exists group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references study_groups (id) on delete cascade,
  member_key text not null,
  display_name text not null,
  role text not null check (role in ('owner', 'admin', 'write', 'read')),
  invite_id uuid references group_invites (id) on delete set null,
  joined_at timestamptz not null default now(),
  unique (group_id, member_key)
);

create index if not exists study_groups_book_id_idx on study_groups (book_id);
create index if not exists group_invites_group_id_idx on group_invites (group_id);
create index if not exists group_members_group_id_idx on group_members (group_id);
create index if not exists group_members_member_key_idx on group_members (member_key);

alter table study_groups enable row level security;
alter table group_invites enable row level security;
alter table group_members enable row level security;

drop policy if exists "anon_all_study_groups" on study_groups;
create policy "anon_all_study_groups"
  on study_groups for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "anon_all_group_invites" on group_invites;
create policy "anon_all_group_invites"
  on group_invites for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "anon_all_group_members" on group_members;
create policy "anon_all_group_members"
  on group_members for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on study_groups to anon, authenticated;
grant select, insert, update, delete on group_invites to anon, authenticated;
grant select, insert, update, delete on group_members to anon, authenticated;
