-- Profiles (unique @username), friendships, study shares, focus stats

create table if not exists profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  bio text,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username ~ '^[a-z0-9_]{3,24}$'
  )
);

create unique index if not exists profiles_username_uidx
  on profiles (username);

create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles (user_id) on delete cascade,
  addressee_id uuid not null references profiles (user_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_no_self check (requester_id <> addressee_id),
  constraint friendships_pair_uidx unique (requester_id, addressee_id)
);

create index if not exists friendships_addressee_status_idx
  on friendships (addressee_id, status);

create table if not exists study_shares (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references profiles (user_id) on delete cascade,
  to_user_id uuid not null references profiles (user_id) on delete cascade,
  book_id uuid not null references books (id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint study_shares_no_self check (from_user_id <> to_user_id)
);

create index if not exists study_shares_to_user_idx
  on study_shares (to_user_id, created_at desc);

create table if not exists study_focus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (user_id) on delete cascade,
  book_id uuid not null references books (id) on delete cascade,
  chapter_id uuid references chapters (id) on delete set null,
  day date not null default (timezone('utc', now()))::date,
  seconds int not null default 0 check (seconds >= 0),
  updated_at timestamptz not null default now()
);

-- One row per user/book/chapter/day (chapter null = book-level only)
create unique index if not exists study_focus_unique_day_idx
  on study_focus (
    user_id,
    book_id,
    day,
    coalesce(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists study_focus_user_day_idx
  on study_focus (user_id, day desc);

alter table profiles enable row level security;
alter table friendships enable row level security;
alter table study_shares enable row level security;
alter table study_focus enable row level security;

drop policy if exists "anon_all_profiles" on profiles;
create policy "anon_all_profiles"
  on profiles for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "anon_all_friendships" on friendships;
create policy "anon_all_friendships"
  on friendships for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "anon_all_study_shares" on study_shares;
create policy "anon_all_study_shares"
  on study_shares for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "anon_all_study_focus" on study_focus;
create policy "anon_all_study_focus"
  on study_focus for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on profiles to anon, authenticated;
grant select, insert, update, delete on friendships to anon, authenticated;
grant select, insert, update, delete on study_shares to anon, authenticated;
grant select, insert, update, delete on study_focus to anon, authenticated;

-- Atomic focus bump (expression unique index → manual upsert)
create or replace function bump_study_focus(
  p_user_id uuid,
  p_book_id uuid,
  p_chapter_id uuid,
  p_seconds int
) returns void
language plpgsql
as $$
begin
  if p_seconds is null or p_seconds <= 0 then
    return;
  end if;

  update study_focus
  set
    seconds = seconds + p_seconds,
    updated_at = now()
  where user_id = p_user_id
    and book_id = p_book_id
    and day = (timezone('utc', now()))::date
    and chapter_id is not distinct from p_chapter_id;

  if found then
    return;
  end if;

  insert into study_focus (user_id, book_id, chapter_id, day, seconds, updated_at)
  values (
    p_user_id,
    p_book_id,
    p_chapter_id,
    (timezone('utc', now()))::date,
    p_seconds,
    now()
  );
exception
  when unique_violation then
    update study_focus
    set
      seconds = seconds + p_seconds,
      updated_at = now()
    where user_id = p_user_id
      and book_id = p_book_id
      and day = (timezone('utc', now()))::date
      and chapter_id is not distinct from p_chapter_id;
end;
$$;

grant execute on function bump_study_focus(uuid, uuid, uuid, int) to anon, authenticated;
