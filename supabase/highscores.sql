-- Online-Bestenliste für München Turbo.
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.

create table if not exists public.highscores (
  id         bigint generated always as identity primary key,
  name       text        not null check (char_length(trim(name)) between 1 and 12),
  score      integer     not null check (score between 0 and 5000),
  race_time  real        not null check (race_time > 0 and race_time < 3600),
  place      smallint    not null check (place between 1 and 4),
  created_at timestamptz not null default now()
);

create index if not exists highscores_score_idx on public.highscores (score desc, race_time asc);

-- Row Level Security: jeder darf lesen und neue Einträge anlegen,
-- aber niemand darf fremde Einträge ändern oder löschen.
alter table public.highscores enable row level security;

drop policy if exists "Highscores lesen" on public.highscores;
create policy "Highscores lesen"
  on public.highscores for select
  to anon, authenticated
  using (true);

drop policy if exists "Highscores eintragen" on public.highscores;
create policy "Highscores eintragen"
  on public.highscores for insert
  to anon, authenticated
  with check (true);

revoke all on public.highscores from anon, authenticated;
grant select, insert on public.highscores to anon, authenticated;
grant usage on sequence public.highscores_id_seq to anon, authenticated;
