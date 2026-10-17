-- Group study pack: shared “today’s unit” focus on study_groups

alter table study_groups
  add column if not exists focus_chapter_id uuid references chapters (id) on delete set null;

alter table study_groups
  add column if not exists focus_note text;

alter table study_groups
  add column if not exists focus_set_by text;

alter table study_groups
  add column if not exists focus_updated_at timestamptz;

create index if not exists study_groups_focus_chapter_idx
  on study_groups (focus_chapter_id)
  where focus_chapter_id is not null;
