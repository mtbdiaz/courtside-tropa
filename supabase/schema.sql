-- =============================================
-- COURTSIDE TROPA - Final Comprehensive Schema
-- May 1, 2026 • Paddle Up! Davao • Sunset Vibes 🏓🌅
-- Supports: Mixed Doubles Priority, Locked Pairs, Queue of Matches,
-- Pause/Play Queue, Auto-fill, Refresh Queue (protected), 3 Player States
-- =============================================

-- 1. Events
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT DEFAULT 'Courtside Tropa',
  tagline TEXT DEFAULT 'Just One More Game… with Tropa 🏓🌅',
  date TEXT DEFAULT 'May 1, 2026',
  venue TEXT DEFAULT 'Paddle Up! Davao (Buhangin)',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Batches (Batch 1 & Batch 2)
CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- 'Batch 1' or 'Batch 2'
  start_time TEXT,
  end_time TEXT,
  num_courts INT DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Players - 3 States + Fairness
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('M', 'F')) NOT NULL,
  status TEXT DEFAULT 'break' CHECK (status IN ('break', 'checked-in', 'playing')),
  pair_id UUID,                          -- For locked-in pairs
  games_played INT DEFAULT 0,            -- For fairness (prioritize low-play players)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Courts
CREATE TABLE IF NOT EXISTS courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
  court_number INT NOT NULL,
  status TEXT DEFAULT 'free' CHECK (status IN ('free', 'occupied')),
  current_match_id UUID,
  start_time TIMESTAMPTZ,                -- For live elapsed timer
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Matches (Queue = list of matches ordered by queue_position)
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
  court_id UUID REFERENCES courts(id) ON DELETE SET NULL,
  
  -- Teams
  team1_player1_id UUID REFERENCES players(id),
  team1_player2_id UUID REFERENCES players(id),
  team2_player1_id UUID REFERENCES players(id),
  team2_player2_id UUID REFERENCES players(id),
  
  match_type TEXT DEFAULT 'mixed' CHECK (match_type IN ('mixed', 'custom')),
  is_locked BOOLEAN DEFAULT FALSE,       -- Protects Match #1 and Custom matches during Refresh
  queue_position INT,                    -- Determines order in queue (1 = Now Calling)
  
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  score_team1 INT DEFAULT 0,
  score_team2 INT DEFAULT 0,
  winner_team TEXT CHECK (winner_team IN ('team1', 'team2', NULL)),
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'playing', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Match History (for editing scores + archive)
CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
  original_match_id UUID,
  court_number INT,
  
  team1_player1_name TEXT,
  team1_player2_name TEXT,
  team2_player1_name TEXT,
  team2_player2_name TEXT,
  
  score_team1 INT,
  score_team2 INT,
  winner_team TEXT CHECK (winner_team IN ('team1', 'team2', NULL)),
  played_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- =============================================
-- INDEXES (Performance for 80-100 players)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_players_batch_status ON players(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_players_games ON players(batch_id, games_played);
CREATE INDEX IF NOT EXISTS idx_players_pair ON players(pair_id);

CREATE INDEX IF NOT EXISTS idx_matches_batch_status ON matches(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_queue ON matches(batch_id, queue_position);
CREATE INDEX IF NOT EXISTS idx_matches_locked ON matches(is_locked);

CREATE INDEX IF NOT EXISTS idx_courts_batch ON courts(batch_id);
CREATE INDEX IF NOT EXISTS idx_match_history_batch ON match_history(batch_id);

-- Prevent duplicate players in same match (basic safety)
ALTER TABLE matches ADD CONSTRAINT check_no_duplicate_players 
  CHECK (
    team1_player1_id IS DISTINCT FROM team1_player2_id AND
    team1_player1_id IS DISTINCT FROM team2_player1_id AND
    team1_player1_id IS DISTINCT FROM team2_player2_id AND
    team1_player2_id IS DISTINCT FROM team2_player1_id AND
    team1_player2_id IS DISTINCT FROM team2_player2_id AND
    team2_player1_id IS DISTINCT FROM team2_player2_id
  );

-- =============================================
-- REALTIME & RLS
-- =============================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_history ENABLE ROW LEVEL SECURITY;

-- Realtime publication
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE 
  events, batches, players, courts, matches, match_history;

-- Replica Identity for proper UPDATE/DELETE realtime
ALTER TABLE players REPLICA IDENTITY FULL;
ALTER TABLE courts REPLICA IDENTITY FULL;
ALTER TABLE matches REPLICA IDENTITY FULL;
ALTER TABLE match_history REPLICA IDENTITY FULL;
ALTER TABLE batches REPLICA IDENTITY FULL;

-- Admin (authenticated) full access
CREATE POLICY "Admin full access" ON events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access" ON batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access" ON players FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access" ON courts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access" ON matches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access" ON match_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Public read-only for queue view (players on phones)
CREATE POLICY "Public read queue" ON players FOR SELECT TO anon USING (true);
CREATE POLICY "Public read queue" ON courts FOR SELECT TO anon USING (true);
CREATE POLICY "Public read queue" ON matches FOR SELECT TO anon USING (status IN ('queued', 'playing'));
CREATE POLICY "Public read queue" ON batches FOR SELECT TO anon USING (true);
CREATE POLICY "Public read queue" ON events FOR SELECT TO anon USING (true);

-- =============================================
-- INITIAL SEED (Run once)
-- =============================================
INSERT INTO events (name, tagline, date, venue)
VALUES ('Courtside Tropa', 'Just One More Game… with Tropa 🏓🌅', 'May 1, 2026', 'Paddle Up! Davao (Buhangin)')
ON CONFLICT DO NOTHING;

-- Insert Batches
DO $$
DECLARE
  ev_id UUID;
BEGIN
  SELECT id INTO ev_id FROM events LIMIT 1;

  INSERT INTO batches (event_id, name, start_time, end_time, num_courts)
  VALUES 
    (ev_id, 'Batch 1', '8:00 AM - 12:00 NN', '8:00 AM - 12:00 NN', 5),
    (ev_id, 'Batch 2', '1:00 PM - 5:00 PM', '1:00 PM - 5:00 PM', 5)
  ON CONFLICT DO NOTHING;
END $$;

SELECT '✅ Courtside Tropa schema applied successfully!' AS message;