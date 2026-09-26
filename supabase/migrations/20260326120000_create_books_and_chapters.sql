-- ADIM 1: books + chapters schema
create table books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  total_pages int,
  status text default 'processing', -- processing | ready | failed
  created_at timestamptz default now()
);

create table chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books on delete cascade,
  chapter_number int not null,
  title text not null,
  start_page int not null,
  end_page int not null,
  summary text,
  key_concepts text[],
  status text default 'pending',
  created_at timestamptz default now()
);

create index chapters_book_id_idx on chapters (book_id);
create index chapters_book_id_chapter_number_idx on chapters (book_id, chapter_number);
