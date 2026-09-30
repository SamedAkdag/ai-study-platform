-- Study timer + public share links
alter table books add column if not exists study_seconds int not null default 0;
alter table books add column if not exists share_token text;
alter table books add column if not exists is_public boolean not null default false;

create unique index if not exists books_share_token_uidx
  on books (share_token)
  where share_token is not null;
