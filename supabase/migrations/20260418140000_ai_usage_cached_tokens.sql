-- Track MiMo prefix KV cache hits separately from total prompt tokens.

alter table ai_usage_events
  add column if not exists cached_tokens integer not null default 0
    check (cached_tokens >= 0);

comment on column ai_usage_events.cached_tokens is
  'prompt_tokens_details.cached_tokens (Cache Hit). Billable-ish input ≈ prompt_tokens - cached_tokens.';
