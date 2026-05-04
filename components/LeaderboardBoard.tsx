'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Trophy } from 'lucide-react';

type Tab = 'overall' | '1' | '2';

interface HistoryRow {
  id: string;
  batch_id: string;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  winner_team: 'team1' | 'team2' | null;
}

interface BatchRow {
  id: string;
  name: string;
}

interface Entry {
  name: string;
  wins: number;
  gamesPlayed: number;
  rank: number;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const seed = hashString(name);
  const hue = seed % 360;
  const background = `linear-gradient(135deg, hsl(${hue} 82% 56%), hsl(${(hue + 34) % 360} 75% 44%))`;
  const sizeClass =
    size === 'lg'
      ? 'h-14 w-14 text-base'
      : size === 'md'
        ? 'h-10 w-10 text-sm'
        : 'h-7 w-7 text-[10px]';

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 font-bold text-white shadow-sm ${sizeClass}`}
      style={{ background }}
    >
      {getInitials(name)}
    </span>
  );
}

function computeLeaderboard(rows: HistoryRow[], batchId: string | null): Entry[] {
  const stats = new Map<string, { wins: number; gamesPlayed: number }>();
  const filtered = batchId ? rows.filter((r) => r.batch_id === batchId) : rows;

  for (const row of filtered) {
    const team1 = [row.team1_player1_name, row.team1_player2_name].filter(
      (n): n is string => Boolean(n?.trim()),
    );
    const team2 = [row.team2_player1_name, row.team2_player2_name].filter(
      (n): n is string => Boolean(n?.trim()),
    );

    for (const name of [...team1, ...team2]) {
      if (!stats.has(name)) stats.set(name, { wins: 0, gamesPlayed: 0 });
      stats.get(name)!.gamesPlayed++;
    }

    const winners =
      row.winner_team === 'team1' ? team1 : row.winner_team === 'team2' ? team2 : [];
    for (const name of winners) {
      if (stats.has(name)) stats.get(name)!.wins++;
    }
  }

  const entries: Entry[] = Array.from(stats.entries())
    .filter(([, { gamesPlayed }]) => gamesPlayed > 0)
    .map(([name, { wins, gamesPlayed }]) => ({ name, wins, gamesPlayed, rank: 0 }));

  entries.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed;
    return a.name.localeCompare(b.name);
  });

  let currentRank = 0;
  let lastWins: number | null = null;
  let lastGames: number | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.wins !== lastWins || entry.gamesPlayed !== lastGames) {
      currentRank = i + 1;
      lastWins = entry.wins;
      lastGames = entry.gamesPlayed;
    }
    entry.rank = currentRank;
  }

  return entries;
}

const RANK_CONFIG = {
  1: {
    card: 'border-amber-300/55 bg-gradient-to-br from-amber-300/25 to-amber-400/10 shadow-[0_10px_30px_rgba(251,191,36,0.2)]',
    badge: 'bg-amber-400 text-amber-950 shadow-[0_0_14px_rgba(251,191,36,0.55)]',
    label: 'text-amber-200',
    title: '1st Place',
    medal: '🥇',
  },
  2: {
    card: 'border-slate-300/40 bg-gradient-to-br from-slate-300/15 to-slate-400/5',
    badge: 'bg-slate-300 text-slate-900',
    label: 'text-slate-300',
    title: '2nd Place',
    medal: '🥈',
  },
  3: {
    card: 'border-orange-400/45 bg-gradient-to-br from-orange-400/15 to-orange-500/5',
    badge: 'bg-orange-400 text-orange-950',
    label: 'text-orange-300',
    title: '3rd Place',
    medal: '🥉',
  },
} as const;

export default function LeaderboardBoard() {
  const [tab, setTab] = useState<Tab>('overall');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(false);

  const [supabase] = useState(() => createSupabaseBrowserClient());

  const load = useCallback(async () => {
    const [batchesResult, historyResult] = await Promise.all([
      supabase.from('batches').select('id,name').order('created_at', { ascending: true }),
      supabase
        .from('match_history')
        .select(
          'id,batch_id,team1_player1_name,team1_player2_name,team2_player1_name,team2_player2_name,winner_team',
        )
        .not('winner_team', 'is', null),
    ]);

    if (batchesResult.data) setBatches(batchesResult.data as BatchRow[]);
    if (historyResult.data) setRows(historyResult.data as HistoryRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();

    const channel = supabase
      .channel('leaderboard-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_history' },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, supabase]);

  const activeBatchId = useMemo(() => {
    if (tab === 'overall') return null;
    return batches.find((b) => b.name === `Batch ${tab}`)?.id ?? null;
  }, [tab, batches]);

  const leaderboard = useMemo(
    () => computeLeaderboard(rows, activeBatchId),
    [rows, activeBatchId],
  );

  const topEntries = useMemo(() => leaderboard.filter((e) => e.rank <= 3), [leaderboard]);
  const remaining = useMemo(() => leaderboard.filter((e) => e.rank > 3), [leaderboard]);

  const byRank = useMemo(
    () => ({
      1: topEntries.filter((e) => e.rank === 1),
      2: topEntries.filter((e) => e.rank === 2),
      3: topEntries.filter((e) => e.rank === 3),
    }),
    [topEntries],
  );

  const totalMatches = useMemo(() => {
    const filtered = activeBatchId
      ? rows.filter((r) => r.batch_id === activeBatchId)
      : rows;
    return filtered.length;
  }, [rows, activeBatchId]);

  // Auto-scroll remaining entries
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || remaining.length < 6) return;

    el.scrollTop = 0;
    let animId: number;
    let lastTime = 0;

    const animate = (time: number) => {
      if (!lastTime) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;

      if (el && !isPausedRef.current) {
        el.scrollTop += delta * 0.028;
        if (el.scrollTop >= el.scrollHeight - el.clientHeight) {
          el.scrollTop = 0;
        }
      }
      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [remaining]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="glass-panel rounded-[2rem] px-6 py-10 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-amber-300" />
          <div className="mt-4 text-lg font-semibold text-white">Loading leaderboard…</div>
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-3 pb-16 pt-4 sm:px-6 sm:pt-6">
      {/* Header */}
      <section className="glass-panel rounded-[1.5rem] p-4 sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-amber-200/70 sm:text-xs sm:tracking-[0.35em]">
              All Day Event
            </p>
            <div className="mt-1 flex items-center gap-3">
              <Trophy className="h-6 w-6 shrink-0 text-amber-300 sm:h-7 sm:w-7" />
              <h2 className="text-display text-2xl font-semibold sm:text-4xl">Leaderboard</h2>
            </div>
            <p className="mt-1 text-xs text-slate-300/80 sm:text-sm">
              Courtside Tropa · Paddle Up! Davao · May 1, 2026
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-500/10 px-3 py-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100 sm:text-xs">
              Live
            </span>
          </div>
        </div>

        {/* Tab buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(['overall', '1', '2'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                tab === t
                  ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                  : 'border-white/10 bg-white/5 text-slate-200/80 hover:bg-white/10'
              }`}
            >
              {t === 'overall' ? 'Overall' : `Batch ${t}`}
            </button>
          ))}
          {totalMatches > 0 && (
            <span className="ml-auto self-center text-xs text-slate-400/70">
              {totalMatches} match{totalMatches !== 1 ? 'es' : ''} recorded
            </span>
          )}
        </div>
      </section>

      <AnimatePresence mode="wait">
        {leaderboard.length === 0 ? (
          <motion.section
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mt-4 glass-panel rounded-[1.5rem] p-10 text-center sm:rounded-[2rem]"
          >
            <Trophy className="mx-auto h-10 w-10 text-amber-200/30" />
            <div className="mt-4 text-lg font-semibold text-white">No matches recorded yet</div>
            <div className="mt-1 text-sm text-slate-300/80">
              Standings will appear once matches are completed.
            </div>
          </motion.section>
        ) : (
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="mt-4 space-y-3"
          >
            {/* Top 3 rank groups */}
            {([1, 2, 3] as const).map((rank) => {
              const entries = byRank[rank];
              if (entries.length === 0) return null;
              const cfg = RANK_CONFIG[rank];

              return (
                <div key={rank}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="text-xl leading-none">{cfg.medal}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-[0.22em] sm:text-xs ${cfg.label}`}
                    >
                      {cfg.title}
                      {entries.length > 1 ? ` · ${entries.length} tied` : ''}
                    </span>
                  </div>

                  <div
                    className={`grid gap-3 ${
                      entries.length === 1
                        ? 'grid-cols-1'
                        : entries.length === 2
                          ? 'grid-cols-2'
                          : 'grid-cols-2 sm:grid-cols-3'
                    }`}
                  >
                    {entries.map((entry, i) => (
                      <motion.div
                        key={entry.name}
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 380,
                          damping: 32,
                          delay: i * 0.06,
                        }}
                        className={`rounded-[1.4rem] border p-4 ${cfg.card}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="relative shrink-0">
                            <Avatar
                              name={entry.name}
                              size={rank === 1 && entries.length === 1 ? 'lg' : 'md'}
                            />
                            <span
                              className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${cfg.badge}`}
                            >
                              {rank}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div
                              className={`truncate font-semibold text-white ${
                                rank === 1 && entries.length === 1
                                  ? 'text-base sm:text-xl'
                                  : 'text-sm sm:text-base'
                              }`}
                            >
                              {entry.name}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-300/80">
                              <span className="font-semibold text-white">{entry.wins}</span> wins
                              {' · '}
                              <span>{entry.gamesPlayed}</span> played
                            </div>
                            {entry.gamesPlayed > 0 && (
                              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                                <motion.div
                                  className="h-full rounded-full bg-amber-300/60"
                                  initial={{ width: 0 }}
                                  animate={{
                                    width: `${Math.round((entry.wins / entry.gamesPlayed) * 100)}%`,
                                  }}
                                  transition={{ duration: 0.6, delay: i * 0.06 + 0.2 }}
                                />
                              </div>
                            )}
                            {entry.gamesPlayed > 0 && (
                              <div className="mt-0.5 text-right text-[10px] text-slate-400/80">
                                {Math.round((entry.wins / entry.gamesPlayed) * 100)}% win rate
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Full standings (rank 4+) */}
            {remaining.length > 0 && (
              <div className="glass-panel rounded-[1.5rem] p-4 sm:rounded-[2rem] sm:p-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-white sm:text-lg">
                    Full Standings
                  </h3>
                  {remaining.length >= 6 && (
                    <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-slate-300/70 sm:text-xs">
                      <span className="h-1 w-1 rounded-full bg-amber-300/70" />
                      Auto-scroll · hover to pause
                    </span>
                  )}
                </div>

                <div
                  ref={scrollRef}
                  className="space-y-2 overflow-hidden pr-0.5"
                  style={{ maxHeight: remaining.length >= 6 ? '20rem' : undefined }}
                  onMouseEnter={() => (isPausedRef.current = true)}
                  onMouseLeave={() => (isPausedRef.current = false)}
                  onTouchStart={() => (isPausedRef.current = true)}
                  onTouchEnd={() => (isPausedRef.current = false)}
                >
                  {remaining.map((entry, index) => (
                    <motion.div
                      key={entry.name}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.015 }}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/30 text-[11px] font-bold text-amber-100/70">
                        {entry.rank}
                      </span>
                      <Avatar name={entry.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">{entry.name}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs">
                          <span className="font-semibold text-white">{entry.wins}</span>
                          <span className="text-slate-400/80"> W</span>
                        </div>
                        <div className="text-[10px] text-slate-400/70">{entry.gamesPlayed} G</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="mt-6 text-center text-[10px] uppercase tracking-[0.22em] text-slate-400/50 sm:text-xs">
        Updates automatically as matches complete
      </p>
    </main>
  );
}
