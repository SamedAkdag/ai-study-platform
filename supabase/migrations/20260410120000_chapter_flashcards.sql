-- AI-generated flashcards for Stories-style review

alter table chapters
  add column if not exists flashcards jsonb;

drop view if exists public_shared_chapters;

create view public_shared_chapters as
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
  c.mind_map,
  c.flashcards,
  c.status
from chapters c
join books b on b.id = c.book_id
where b.is_public = true
  and b.share_token is not null
  and c.status = 'ready'
  and c.explanation is not null;

grant select on public_shared_chapters to anon, authenticated;
