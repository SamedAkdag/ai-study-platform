-- Public share stats + view/share counters on books

alter table books
  add column if not exists view_count integer not null default 0;

alter table books
  add column if not exists share_count integer not null default 0;

-- Backfill share_count from existing friend shares
update books b
set share_count = coalesce(s.cnt, 0)
from (
  select book_id, count(*)::int as cnt
  from study_shares
  group by book_id
) s
where b.id = s.book_id;

create or replace function record_book_view(p_book_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if p_book_id is null then
    return;
  end if;
  update books
  set view_count = view_count + 1
  where id = p_book_id
    and is_public = true
    and share_token is not null;
end;
$$;

create or replace function bump_book_share_count(p_book_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if p_book_id is null then
    return;
  end if;
  update books
  set share_count = share_count + 1
  where id = p_book_id;
end;
$$;

create or replace function trg_study_shares_bump_share_count()
returns trigger
language plpgsql
security definer
as $$
begin
  update books
  set share_count = share_count + 1
  where id = new.book_id;
  return new;
end;
$$;

drop trigger if exists study_shares_bump_share_count on study_shares;
create trigger study_shares_bump_share_count
  after insert on study_shares
  for each row
  execute function trg_study_shares_bump_share_count();

grant execute on function record_book_view(uuid) to anon, authenticated;
grant execute on function bump_book_share_count(uuid) to anon, authenticated;

-- Recreate public book view with stats (recipients need counts + is_public)
create or replace view public_shared_books as
select
  b.id,
  b.title,
  b.subject,
  b.share_token,
  b.created_at,
  b.is_public,
  b.view_count,
  b.share_count
from books b
where b.is_public = true
  and b.share_token is not null;

grant select on public_shared_books to anon, authenticated;
