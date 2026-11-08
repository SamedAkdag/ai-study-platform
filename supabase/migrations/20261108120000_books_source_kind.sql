-- Topic studies (chat goal → units) vs PDF uploads
alter table books add column if not exists source_kind text;

comment on column books.source_kind is
  'pdf | topic — null treated as pdf for legacy rows';
