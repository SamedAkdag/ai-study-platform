-- Multi-depth explanations + generation style + per-page source excerpts
alter table chapters add column if not exists explanation_brief text;
alter table chapters add column if not exists explanation_detailed text;
alter table chapters add column if not exists generation_style text;
alter table chapters add column if not exists page_sources jsonb;
-- page_sources: [{ "page": 12, "topics": ["..."], "excerpt": "..." }]
