-- Durable orchestration for topic study (waitUntil section chain).
-- Holds brief/research/outline + next_unit while chapters fill one-by-one.

alter table books
  add column if not exists pipeline_state jsonb;

comment on column books.pipeline_state is
  'Topic/agent pipeline checkpoint: brief, research, outline, next_unit, phase';

create index if not exists books_pipeline_phase_idx
  on books ((pipeline_state->>'phase'))
  where pipeline_state is not null;
