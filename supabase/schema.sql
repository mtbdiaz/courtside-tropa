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
  num_courts INT DEFAULT 8,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_event_name_unique ON batches(event_id, name);

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
  is_active BOOLEAN DEFAULT TRUE,
  status TEXT DEFAULT 'free' CHECK (status IN ('free', 'occupied')),
  current_match_id UUID,
  start_time TIMESTAMPTZ,                -- For live elapsed timer
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_courts_batch_number_unique ON courts(batch_id, court_number);

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

-- 7. Batch operation locks (prevents duplicate queue/autofill work across admins)
CREATE TABLE IF NOT EXISTS batch_operation_locks (
  batch_id UUID PRIMARY KEY REFERENCES batches(id) ON DELETE CASCADE,
  lock_key TEXT NOT NULL DEFAULT 'queue',
  holder_id TEXT,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
CREATE INDEX IF NOT EXISTS idx_courts_batch_active ON courts(batch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_match_history_batch ON match_history(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_operation_locks_until ON batch_operation_locks(locked_until);

-- Backfill for existing databases where is_active column doesn't exist yet
ALTER TABLE courts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Prevent duplicate players in same match (basic safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'check_no_duplicate_players'
      AND conrelid = 'matches'::regclass
  ) THEN
    ALTER TABLE matches ADD CONSTRAINT check_no_duplicate_players
      CHECK (
        team1_player1_id IS DISTINCT FROM team1_player2_id AND
        team1_player1_id IS DISTINCT FROM team2_player1_id AND
        team1_player1_id IS DISTINCT FROM team2_player2_id AND
        team1_player2_id IS DISTINCT FROM team2_player1_id AND
        team1_player2_id IS DISTINCT FROM team2_player2_id AND
        team2_player1_id IS DISTINCT FROM team2_player2_id
      );
  END IF;
END $$;

-- =============================================
-- REALTIME & RLS
-- =============================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_operation_locks ENABLE ROW LEVEL SECURITY;

-- Realtime publication (safe for reruns)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE events, batches, players, courts, matches, match_history;
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
    WHEN undefined_object THEN
      NULL;
  END;
END $$;

-- Replica Identity for proper UPDATE/DELETE realtime
ALTER TABLE players REPLICA IDENTITY FULL;
ALTER TABLE courts REPLICA IDENTITY FULL;
ALTER TABLE matches REPLICA IDENTITY FULL;
ALTER TABLE match_history REPLICA IDENTITY FULL;
ALTER TABLE batches REPLICA IDENTITY FULL;
ALTER TABLE batch_operation_locks REPLICA IDENTITY FULL;

-- Admin (authenticated) full access
DROP POLICY IF EXISTS "Admin full access" ON events;
CREATE POLICY "Admin full access" ON events FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin full access" ON batches;
CREATE POLICY "Admin full access" ON batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin full access" ON players;
CREATE POLICY "Admin full access" ON players FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin full access" ON courts;
CREATE POLICY "Admin full access" ON courts FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin full access" ON matches;
CREATE POLICY "Admin full access" ON matches FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin full access" ON match_history;
CREATE POLICY "Admin full access" ON match_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin full access" ON batch_operation_locks;
CREATE POLICY "Admin full access" ON batch_operation_locks FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Temporary public write access for event operations (admin UI can function with anon session)
DROP POLICY IF EXISTS "Public write events" ON events;
CREATE POLICY "Public write events" ON events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public write batches" ON batches;
CREATE POLICY "Public write batches" ON batches FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public write players" ON players;
CREATE POLICY "Public write players" ON players FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public write courts" ON courts;
CREATE POLICY "Public write courts" ON courts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public write matches" ON matches;
CREATE POLICY "Public write matches" ON matches FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public write history" ON match_history;
CREATE POLICY "Public write history" ON match_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public write operation locks" ON batch_operation_locks;
CREATE POLICY "Public write operation locks" ON batch_operation_locks FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Public read-only for queue view (players on phones)
DROP POLICY IF EXISTS "Public read queue" ON players;
CREATE POLICY "Public read queue" ON players FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Public read queue" ON courts;
CREATE POLICY "Public read queue" ON courts FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Public read queue" ON matches;
CREATE POLICY "Public read queue" ON matches FOR SELECT TO anon USING (status IN ('queued', 'playing'));
DROP POLICY IF EXISTS "Public read queue" ON batches;
CREATE POLICY "Public read queue" ON batches FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Public read queue" ON events;
CREATE POLICY "Public read queue" ON events FOR SELECT TO anon USING (true);

-- =============================================
-- INITIAL SEED (Idempotent)
-- =============================================
DO $$
DECLARE
  ev_id UUID;
BEGIN
  SELECT id INTO ev_id FROM events ORDER BY created_at ASC LIMIT 1;

  IF ev_id IS NULL THEN
    INSERT INTO events (name, tagline, date, venue)
    VALUES ('Courtside Tropa', 'Just One More Game… with Tropa 🏓🌅', 'May 1, 2026', 'Paddle Up! Davao (Buhangin)')
    RETURNING id INTO ev_id;
  END IF;

  INSERT INTO batches (event_id, name, start_time, end_time, num_courts)
  VALUES
    (ev_id, 'Batch 1', '8:00 AM - 12:00 NN', '8:00 AM - 12:00 NN', 8),
    (ev_id, 'Batch 2', '1:00 PM - 5:00 PM', '1:00 PM - 5:00 PM', 8)
  ON CONFLICT (event_id, name) DO NOTHING;
END $$;

SELECT '✅ Courtside Tropa schema applied successfully!' AS message;