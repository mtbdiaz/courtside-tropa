-- =============================================
-- COURTSIDE TROPA - Full Database Schema
-- Event: May 1, 2026 • Paddle Up! Davao
-- =============================================

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text default 'Courtside Tropa',
  tagline text default 'Just One More Game… with Tropa 🏓🌅',
  date text default 'May 1, 2026',
  venue text default 'Paddle Up! Davao (Buhangin)',
  created_at timestamptz default now()
);

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  name text not null,
  start_time text,
  end_time text,
  num_courts int default 5,
  created_at timestamptz default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references batches(id) on delete cascade,
  name text not null,
  gender text check (gender in ('M', 'F')) not null,
  status text default 'break' check (status in ('checked-in', 'break')),
  pair_id uuid,
  created_at timestamptz default now()
);

create table if not exists courts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references batches(id) on delete cascade,
  court_number int not null,
  status text default 'free' check (status in ('free', 'occupied')),
  current_match_id uuid,
  start_time timestamptz,
  created_at timestamptz default now()
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references batches(id) on delete cascade,
  court_id uuid references courts(id) on delete set null,
  team1_player1_id uuid references players(id),
  team1_player2_id uuid references players(id),
  team2_player1_id uuid references players(id),
  team2_player2_id uuid references players(id),
  start_time timestamptz default now(),
  end_time timestamptz,
  score_team1 int default 0,
  score_team2 int default 0,
  winner_team text check (winner_team in ('team1', 'team2', null)),
  status text default 'active' check (status in ('active', 'completed')),
  is_pair_match boolean default false,
  match_type text default 'mixed' check (match_type in ('custom', 'mixed'))
);

create table if not exists match_history (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references batches(id) on delete cascade,
  match_id uuid,
  court_number int,
  team1_player1_name text,
  team1_player2_name text,
  team2_player1_name text,
  team2_player2_name text,
  score_team1 int,
  score_team2 int,
  winner_team text check (winner_team in ('team1', 'team2', null)),
  played_at timestamptz default now(),
  notes text
);

create index if not exists idx_players_batch_status on players(batch_id, status);
create index if not exists idx_players_pair on players(pair_id);
create index if not exists idx_matches_batch on matches(batch_id);
create index if not exists idx_courts_batch on courts(batch_id);
create index if not exists idx_match_history_batch on match_history(batch_id);
create unique index if not exists idx_match_history_match_id_unique on match_history(match_id) where match_id is not null;

alter table events enable row level security;
alter table batches enable row level security;
alter table players enable row level security;
alter table courts enable row level security;
alter table matches enable row level security;
alter table match_history enable row level security;

-- Authenticated admin access
drop policy if exists "Allow all for authenticated users" on events;
create policy "Allow all for authenticated users" on events for all to authenticated using (true) with check (true);
drop policy if exists "Allow all for authenticated users" on batches;
create policy "Allow all for authenticated users" on batches for all to authenticated using (true) with check (true);
drop policy if exists "Allow all for authenticated users" on players;
create policy "Allow all for authenticated users" on players for all to authenticated using (true) with check (true);
drop policy if exists "Allow all for authenticated users" on courts;
create policy "Allow all for authenticated users" on courts for all to authenticated using (true) with check (true);
drop policy if exists "Allow all for authenticated users" on matches;
create policy "Allow all for authenticated users" on matches for all to authenticated using (true) with check (true);
drop policy if exists "Allow all for authenticated users" on match_history;
create policy "Allow all for authenticated users" on match_history for all to authenticated using (true) with check (true);

-- Temporary public access for event operations so the app keeps working if auth/session propagation is imperfect.
drop policy if exists "Allow public write events" on events;
create policy "Allow public write events" on events for all to anon, authenticated using (true) with check (true);
drop policy if exists "Allow public write batches" on batches;
create policy "Allow public write batches" on batches for all to anon, authenticated using (true) with check (true);
drop policy if exists "Allow public write players" on players;
create policy "Allow public write players" on players for all to anon, authenticated using (true) with check (true);
drop policy if exists "Allow public write courts" on courts;
create policy "Allow public write courts" on courts for all to anon, authenticated using (true) with check (true);
drop policy if exists "Allow public write matches" on matches;
create policy "Allow public write matches" on matches for all to anon, authenticated using (true) with check (true);
drop policy if exists "Allow public write history" on match_history;
create policy "Allow public write history" on match_history for all to anon, authenticated using (true) with check (true);

-- Public queue requires read access for anon users.
drop policy if exists "Allow public read events" on events;
create policy "Allow public read events" on events for select to anon, authenticated using (true);
drop policy if exists "Allow public read batches" on batches;
create policy "Allow public read batches" on batches for select to anon, authenticated using (true);
drop policy if exists "Allow public read players" on players;
create policy "Allow public read players" on players for select to anon, authenticated using (true);
drop policy if exists "Allow public read courts" on courts;
create policy "Allow public read courts" on courts for select to anon, authenticated using (true);
drop policy if exists "Allow public read matches" on matches;
create policy "Allow public read matches" on matches for select to anon, authenticated using (true);
drop policy if exists "Allow public read history" on match_history;
create policy "Allow public read history" on match_history for select to anon, authenticated using (true);

-- No seed data in this schema file.
