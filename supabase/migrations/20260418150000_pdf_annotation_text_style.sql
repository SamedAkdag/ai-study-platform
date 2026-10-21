-- Persist sampled PDF typography on annotations (style-matched inserts)
alter table pdf_annotations
  add column if not exists text_style jsonb;
