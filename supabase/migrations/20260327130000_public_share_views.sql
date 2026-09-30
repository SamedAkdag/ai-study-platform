-- Shared recipients see study materials only (no PDF page text / sources / page numbers).
-- Owners keep full access via books/chapters tables.

create or replace view public_shared_books as
select
  b.id,
  b.title,
  b.subject,
  b.share_token,
  b.created_at
from books b
where b.is_public = true
  and b.share_token is not null;

create or replace view public_shared_chapters as
select
  c.id,
  c.book_id,
  c.chapter_number,
  c.order_index,
  c.title,
  c.summary,
  c.key_concepts,
  c.explanation,
  c.explanation_brief,
  c.explanation_detailed,
  c.examples,
  c.quiz,
  c.status
from chapters c
join books b on b.id = c.book_id
where b.is_public = true
  and b.share_token is not null
  and c.status = 'ready'
  and c.explanation is not null;

grant select on public_shared_books to anon, authenticated;
grant select on public_shared_chapters to anon, authenticated;
