-- Spiel-Einstellungen für München Turbo (key → value).
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken (nach highscores.sql).
-- Werte ändern: Table Editor → config → Zeile bearbeiten. Wirkt beim nächsten Laden des Spiels.

create table if not exists public.config (
  key         text        primary key,
  value       jsonb       not null,
  description text,
  updated_at  timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists config_touch_updated_at on public.config;
create trigger config_touch_updated_at
  before update on public.config
  for each row execute function public.touch_updated_at();

-- Jeder darf lesen, ändern nur über das Dashboard
alter table public.config enable row level security;

drop policy if exists "Config lesen" on public.config;
create policy "Config lesen"
  on public.config for select
  to anon, authenticated
  using (true);

revoke all on public.config from anon, authenticated;
grant select on public.config to anon, authenticated;

insert into public.config (key, value, description) values
  ('track_length_m', '3333', 'Länge der Rennstrecke in Metern (erlaubt: 2000–10000). 3333 = ursprüngliche Strecke.')
on conflict (key) do nothing;

-- Längere Strecken bringen mehr Punkte: Grenze anheben und Streckenlänge pro Score mitspeichern
alter table public.highscores drop constraint if exists highscores_score_check;
alter table public.highscores add constraint highscores_score_check check (score between 0 and 50000);
alter table public.highscores add column if not exists track_length_m integer check (track_length_m between 2000 and 10000);
