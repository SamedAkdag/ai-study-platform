-- Store last processing error for UI
alter table books add column if not exists error_message text;
