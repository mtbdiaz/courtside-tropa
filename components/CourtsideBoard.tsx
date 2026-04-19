'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BatchId } from '@/types/courtside';
import { useCourtsideBoard } from '@/hooks/useCourtsideBoard';
import { getLeaderboardEntries, previewUpcomingMatches } from '@/lib/courtside-engine';
import { CircleOff, LogOut, Plus, Search, Waves } from 'lucide-react';

function formatTimer(startedAt: string | null, nowMs: number) {
  if (!startedAt) {
    return '00:00';
  }

  const elapsed = Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(elapsed / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function CourtsideBoard({ publicView = false, initialBatchId = 1 }: { publicView?: boolean; initialBatchId?: BatchId }) {
  const router = useRouter();
  const {
    activeBatch,
    isReady,
    syncStatus,
    authEmail,
    setActiveBatchId,
    setCourtCount,
    addSinglePlayer,
    addBulk,
    toggleBreak,
    startMatchOnCourt,
    completeMatch,
    fillIdleCourts,
    signOut,
  } = useCourtsideBoard(initialBatchId);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [playerName, setPlayerName] = useState('');
  const [playerGender, setPlayerGender] = useState<'M' | 'F'>('M');
  const [bulkNames, setBulkNames] = useState('');
  const [bulkGender, setBulkGender] = useState<'M' | 'F'>('M');
  const [customSearch, setCustomSearch] = useState('');
  const [customSelection, setCustomSelection] = useState<string[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, { a: string; b: string }>>({});

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  const activePlayers = useMemo(() => {
    const ids = new Set<string>();
    for (const court of activeBatch.courts) {
      if (court.status !== 'live') {
        continue;
      }
      for (const id of court.sourceUnitIds) {
        ids.add(id);
      }
    }
    return ids;
  }, [activeBatch.courts]);

  const availableForCustom = useMemo(
    () =>
      activeBatch.players.filter(
        (player) => player.status === 'checked-in' && !activePlayers.has(player.id),
      ),
    [activeBatch.players, activePlayers],
  );

  const customSearchResults = useMemo(() => {
    const query = customSearch.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return availableForCustom
      .filter((player) => player.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [availableForCustom, customSearch]);

  const liveCourts = useMemo(
    () => activeBatch.courts.filter((court) => court.status === 'live'),
    [activeBatch.courts],
  );

  const breakPlayers = useMemo(
    () => activeBatch.players.filter((player) => player.status === 'break'),
    [activeBatch.players],
  );

  const playingPlayers = useMemo(() => {
    const names = new Set<string>();
    for (const court of liveCourts) {
      for (const player of [...court.teamA, ...court.teamB]) {
        names.add(player);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [liveCourts]);

  const canRemoveCourt =
    activeBatch.courts.length > 1 &&
    activeBatch.courts[activeBatch.courts.length - 1]?.status === 'idle';

  const leaderboard = useMemo(() => {
    return getLeaderboardEntries(activeBatch);
  }, [activeBatch]);

  const upcomingMatches = useMemo(() => previewUpcomingMatches(activeBatch, activeBatch.activeMode, 6), [activeBatch]);

  const onToggleCustomPlayer = (playerId: string) => {
    const player = activeBatch.players.find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }

    setCustomSelection((current) => {
      if (current.includes(playerId)) {
        return current.filter((id) => id !== playerId);
      }

      if (current.length >= 4) {
        return current;
      }

      return [...current, playerId];
    });
  };

  const handleCustomStart = (courtId: string) => {
    if (customSelection.length !== 4) {
      return;
    }

    startMatchOnCourt(activeBatch.batchId, courtId, 'custom', { playerIds: customSelection });
    setCustomSelection([]);
    setCustomSearch('');
  };

  const handleAddPlayer = () => {
    if (!playerName.trim()) {
      return;
    }

    addSinglePlayer(activeBatch.batchId, playerName, playerGender);
    setPlayerName('');
  };

  const handleBulkAdd = () => {
    const names = bulkNames
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);

    if (names.length === 0) {
      return;
    }

    addBulk(activeBatch.batchId, names, bulkGender);
    setBulkNames('');
  };

  const handleLogout = async () => {
    await signOut();
    router.replace('/');
    router.refresh();
  };

  if (!isReady) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-7xl items-center justify-center px-4 py-12 sm:px-6">
        <div className="glass-panel rounded-[2rem] px-6 py-10 text-center text-slate-100/90">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-amber-300" />
          <div className="mt-4 text-lg font-semibold text-white">Loading live event data</div>
        </div>
      </main>
    );
  }

  if (publicView) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Public Queue</p>
              <h2 className="text-display mt-2 text-3xl font-semibold sm:text-4xl">Live Queue - Batch {activeBatch.batchId}</h2>
              <p className="mt-2 text-sm text-slate-200/85">View-only live status for players and spectators.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[1, 2].map((batchId) => (
                <button
                  key={batchId}
                  type="button"
                  onClick={() => setActiveBatchId(batchId as BatchId)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    activeBatch.batchId === batchId
                      ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                      : 'border-white/10 bg-white/5 text-slate-200/80 hover:bg-white/10'
                  }`}
                >
                  Batch {batchId}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <h3 className="text-xl font-semibold text-white">Upcoming Matches</h3>
            <p className="mt-1 text-sm text-slate-300/80">Ready matches are shown in queue order.</p>
            <div className="mt-4 space-y-3">
              {upcomingMatches.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">No ready matches yet.</div> : null}
              {upcomingMatches.map((match, index) => (
                <div key={match.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-amber-200/80">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.75)]" />
                      Ready match {index + 1}
                    </div>
                    <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">{match.mode === 'mixed' ? 'Mixed Doubles' : 'Custom Match'}</div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <TeamCard label="Team 1" players={match.teamA} />
                    <div className="text-center text-sm font-semibold uppercase tracking-[0.35em] text-amber-200/80">VS</div>
                    <TeamCard label="Team 2" players={match.teamB} alignRight />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold text-white">Current Matches</h3>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-amber-200/80">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.75)] animate-pulse" />
                Live
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {liveCourts.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">No live matches.</div>
              ) : null}
              {liveCourts.map((court) => (
                <div key={court.id} className="rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-4 text-sm shadow-[0_18px_50px_rgba(0,0,0,0.2)]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-200">{court.label}</span>
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                      {formatTimer(court.startedAt, nowMs)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <TeamCard label="Team 1" players={court.teamA} />
                    <div className="text-center text-xl font-black tracking-[0.45em] text-amber-200/80">VS</div>
                    <TeamCard label="Team 2" players={court.teamB} alignRight />
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <h3 className="text-xl font-semibold text-white">Leaderboard</h3>
          <p className="mt-1 text-sm text-slate-300/80">Based only on completed matches.</p>
          <div className="mt-4 space-y-2">
            {leaderboard.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">No completed matches yet.</div>
            ) : null}
            {leaderboard.map((entry) => (
              <div key={entry.playerId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-7 rounded-full bg-black/25 py-1 text-center text-xs text-amber-200">{entry.rank}</span>
                  <span className="font-medium text-white">{entry.name}</span>
                </div>
                <span className="text-slate-300/80">{entry.wins} wins • {entry.gamesPlayed} games</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Admin Dashboard</p>
            <h2 className="text-display mt-2 text-3xl font-semibold sm:text-4xl">Batch {activeBatch.batchId}</h2>
            <p className="mt-2 text-sm text-slate-200/85">
              {syncStatus === 'online' ? 'Realtime sync active.' : 'Working in offline cache mode.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2].map((batchId) => (
              <button
                key={batchId}
                type="button"
                onClick={() => setActiveBatchId(batchId as BatchId)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  activeBatch.batchId === batchId
                    ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                    : 'border-white/10 bg-white/5 text-slate-200/80 hover:bg-white/10'
                }`}
              >
                Batch {batchId}
              </button>
            ))}
            <button
              type="button"
              onClick={() => fillIdleCourts(activeBatch.batchId)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10"
            >
              Auto-fill courts
            </button>
            <Link href="/dashboard/history" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
              Match history
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-full border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
        <div className="mt-4 text-xs text-slate-300/80">Signed in as {authEmail ?? 'admin'}</div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Player Intake</h3>
                <p className="text-sm text-slate-300/80">Add players quickly and keep queue clean.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <label className="text-sm text-slate-200/90">Single player</label>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px]">
                  <input
                    value={playerName}
                    onChange={(event) => setPlayerName(event.target.value)}
                    placeholder="Player name"
                    className="glass-input rounded-2xl px-4 py-3 text-sm"
                  />
                  <div className="flex gap-2">
                    {(['M', 'F'] as const).map((gender) => (
                      <button
                        key={gender}
                        type="button"
                        onClick={() => setPlayerGender(gender)}
                        className={`flex-1 rounded-2xl border px-3 py-3 text-sm font-medium transition ${
                          playerGender === gender
                            ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                            : 'border-white/10 bg-white/5 text-slate-200/80'
                        }`}
                      >
                        {gender}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddPlayer}
                  className="mt-3 rounded-2xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white"
                >
                  Add player
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <label className="text-sm text-slate-200/90">Bulk add</label>
                <textarea
                  value={bulkNames}
                  onChange={(event) => setBulkNames(event.target.value)}
                  rows={5}
                  placeholder={'One name per line'}
                  className="glass-input mt-2 w-full rounded-2xl px-4 py-3 text-sm"
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex gap-2">
                    {(['M', 'F'] as const).map((gender) => (
                      <button
                        key={gender}
                        type="button"
                        onClick={() => setBulkGender(gender)}
                        className={`rounded-2xl border px-3 py-2 text-sm font-medium transition ${
                          bulkGender === gender
                            ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                            : 'border-white/10 bg-white/5 text-slate-200/80'
                        }`}
                      >
                        {gender}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleBulkAdd}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90"
                  >
                    Import
                  </button>
                </div>
              </div>
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Queue</h3>
                <p className="text-sm text-slate-300/80">Ready matches in order, not raw players.</p>
              </div>
              <span className="text-xs text-slate-300/80">{upcomingMatches.length} ready matches</span>
            </div>
            <div className="mt-4 space-y-3">
              {upcomingMatches.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">Queue is empty.</div> : null}
              {upcomingMatches.map((match, index) => (
                <div key={match.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-7 rounded-full bg-black/25 py-1 text-center text-xs text-amber-200">{index + 1}</span>
                      <span className="font-medium text-white">{match.courtLabel}</span>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">{match.mode === 'mixed' ? 'Mixed' : 'Custom'}</span>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <TeamCard label="Team 1" players={match.teamA} />
                    <div className="text-center text-sm font-semibold uppercase tracking-[0.35em] text-amber-200/80">VS</div>
                    <TeamCard label="Team 2" players={match.teamB} alignRight />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Courts</h3>
                <p className="text-sm text-slate-300/80">Run, score, and recycle courts quickly.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canRemoveCourt}
                  onClick={() => setCourtCount(activeBatch.batchId, activeBatch.courtCount - 1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CircleOff className="h-4 w-4" />
                </button>
                <span className="text-sm text-slate-200/90">{activeBatch.courtCount} courts</span>
                <button
                  type="button"
                  onClick={() => setCourtCount(activeBatch.batchId, activeBatch.courtCount + 1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100/90"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {activeBatch.courts.map((court) => {
                const draft = scoreDrafts[court.id] ?? { a: '', b: '' };
                return (
                  <div key={court.id} className={`rounded-2xl border p-4 ${court.status === 'live' ? 'border-orange-300/30 bg-orange-400/8' : 'border-white/10 bg-white/5'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-white">{court.label}</div>
                      <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">
                        {formatTimer(court.startedAt, nowMs)}
                      </div>
                    </div>

                    {court.status === 'live' ? (
                      <>
                        <div className="mt-3 text-sm text-slate-200/90">Team A: {court.teamA.join(', ')}</div>
                        <div className="mt-1 text-sm text-slate-200/90">Team B: {court.teamB.join(', ')}</div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                          <input
                            type="number"
                            min="0"
                            value={draft.a}
                            onChange={(event) =>
                              setScoreDrafts((current) => ({
                                ...current,
                                [court.id]: { ...(current[court.id] ?? { a: '', b: '' }), a: event.target.value },
                              }))
                            }
                            placeholder="Score A"
                            className="glass-input rounded-2xl px-4 py-3"
                          />
                          <input
                            type="number"
                            min="0"
                            value={draft.b}
                            onChange={(event) =>
                              setScoreDrafts((current) => ({
                                ...current,
                                [court.id]: { ...(current[court.id] ?? { a: '', b: '' }), b: event.target.value },
                              }))
                            }
                            placeholder="Score B"
                            className="glass-input rounded-2xl px-4 py-3"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const scoreA = Number(draft.a);
                              const scoreB = Number(draft.b);
                              if (Number.isNaN(scoreA) || Number.isNaN(scoreB)) {
                                return;
                              }
                              completeMatch(activeBatch.batchId, court.id, scoreA, scoreB);
                              setScoreDrafts((current) => {
                                const next = { ...current };
                                delete next[court.id];
                                return next;
                              });
                            }}
                            className="rounded-2xl bg-gradient-to-r from-emerald-400 to-lime-300 px-4 py-3 text-sm font-semibold text-slate-950"
                          >
                            Save Score
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => startMatchOnCourt(activeBatch.batchId, court.id, 'mixed')}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100/90"
                        >
                          Start default match
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        </div>

        <div className="space-y-6">
          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Custom Match</h3>
                <p className="text-sm text-slate-300/80">Search and select exactly four players.</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Search players</label>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-200" />
                <input
                  value={customSearch}
                  onChange={(event) => setCustomSearch(event.target.value)}
                  placeholder="Type a name"
                  className="glass-input w-full rounded-2xl px-10 py-3 text-sm"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {customSelection.map((id) => {
                const player = activeBatch.players.find((entry) => entry.id === id);
                if (!player) {
                  return null;
                }

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onToggleCustomPlayer(id)}
                    className="rounded-full border border-amber-300/40 bg-amber-300/15 px-3 py-1 text-xs text-amber-100"
                  >
                    {player.name} x
                  </button>
                );
              })}
              {customSelection.length === 0 ? <span className="text-xs text-slate-400/80">No players selected</span> : null}
            </div>

            <div className="mt-4 space-y-2">
              {customSearch.trim() === '' ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300/80">Start typing to find players.</div>
              ) : null}
              {customSearch.trim() !== '' && customSearchResults.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300/80">No matching checked-in players.</div>
              ) : null}
              {customSearchResults.map((player) => {
                const selected = customSelection.includes(player.id);
                return (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => onToggleCustomPlayer(player.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      selected
                        ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                        : 'border-white/10 bg-white/5 text-slate-100/90'
                    }`}
                  >
                    <div className="font-medium">{player.name}</div>
                    <div className="text-xs opacity-80">{player.gender}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 text-xs text-slate-300/80">{customSelection.length}/4 selected</div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {activeBatch.courts
                .filter((court) => court.status === 'idle')
                .slice(0, 3)
                .map((court) => (
                  <button
                    key={court.id}
                    type="button"
                    disabled={customSelection.length !== 4}
                    onClick={() => handleCustomStart(court.id)}
                    className="rounded-2xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Start on {court.label}
                  </button>
                ))}
              {activeBatch.courts.every((court) => court.status !== 'idle') ? (
                <span className="text-xs text-slate-400/80">No idle courts available.</span>
              ) : null}
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <h3 className="text-xl font-semibold text-white">Player Status</h3>

            <div className="mt-4">
              <h4 className="text-sm font-semibold text-amber-100">Currently Playing</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {playingPlayers.length === 0 ? <span className="text-sm text-slate-300/80">No players on court.</span> : null}
                {playingPlayers.map((name) => (
                  <span key={name} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-100/90">
                    {name}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h4 className="text-sm font-semibold text-amber-100">On Break</h4>
              <div className="mt-2 space-y-2">
                {breakPlayers.length === 0 ? <div className="text-sm text-slate-300/80">No players on break.</div> : null}
                {breakPlayers.map((player) => (
                  <div key={player.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <span className="text-white">{player.name}</span>
                    <button
                      type="button"
                      onClick={() => toggleBreak(activeBatch.batchId, player.id)}
                      className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90"
                    >
                      Return
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h4 className="text-sm font-semibold text-amber-100">Available Players</h4>
              <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
                {availableForCustom.map((player) => (
                  <div key={player.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <span className="text-white">{player.name}</span>
                    <button
                      type="button"
                      onClick={() => toggleBreak(activeBatch.batchId, player.id)}
                      className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90"
                    >
                      Break
                    </button>
                  </div>
                ))}
                {availableForCustom.length === 0 ? <div className="text-sm text-slate-300/80">No available players.</div> : null}
              </div>
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <h3 className="text-xl font-semibold text-white">Public Queue Link</h3>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <Link href={`/queue?batch=${activeBatch.batchId}`} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100/90">
                <Waves className="h-4 w-4 text-amber-200" />
                Open public queue view
              </Link>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}

function TeamCard({ label, players, alignRight = false }: { label: string; players: string[]; alignRight?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/20 p-3 ${alignRight ? 'text-right' : 'text-left'}`}>
      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400/80">{label}</div>
      <div className="mt-2 space-y-1 text-sm text-white">
        {players.map((player) => (
          <div key={player} className="rounded-xl bg-white/5 px-3 py-2">{player}</div>
        ))}
      </div>
    </div>
  );
}
