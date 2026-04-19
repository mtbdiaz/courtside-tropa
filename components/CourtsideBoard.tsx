'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BatchId } from '@/types/courtside';
import { useCourtsideBoard } from '@/hooks/useCourtsideBoard';
import { getLeaderboardEntries } from '@/lib/courtside-engine';
import { LogOut, Search, Trophy } from 'lucide-react';

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

type BoardMode = 'admin' | 'public' | 'score';

export default function CourtsideBoard({
  initialBatchId = 1,
  mode = 'admin',
}: {
  initialBatchId?: BatchId;
  mode?: BoardMode;
}) {
  const router = useRouter();
  const publicView = mode === 'public';
  const scoreOnly = mode === 'score';
  const {
    activeBatch,
    isReady,
    batchCounts,
    authEmail,
    setActiveBatchId,
    setCourtCount,
    addSinglePlayer,
    addBulk,
    updatePlayer,
    deletePlayer,
    toggleBreak,
    lockSelectedPair,
    unlockSelectedPair,
    moveQueueUnit,
    removeQueueMatch,
    refreshQueueProcess,
    ensureReadyMatches,
    enqueueCustomMatch,
    startQueuedMatchOnCourt,
    startMatchOnCourt,
    completeMatch,
    cancelMatch,
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
  const [pairSelection, setPairSelection] = useState<string[]>([]);
  const [pairSearch, setPairSearch] = useState('');
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState<'M' | 'F'>('M');
  const [queuePausedByBatch, setQueuePausedByBatch] = useState<Record<BatchId, boolean>>({ 1: false, 2: false });
  const [autoFillEnabledByBatch, setAutoFillEnabledByBatch] = useState<Record<BatchId, boolean>>({ 1: false, 2: false });
  const autoFillRunningRef = useRef(false);

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
      activeBatch.players
        .filter((player) => player.status === 'checked-in')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [activeBatch.players],
  );

  const sortedPlayers = useMemo(
    () => [...activeBatch.players].sort((a, b) => a.name.localeCompare(b.name)),
    [activeBatch.players],
  );

  const customSearchResults = useMemo(() => {
    const query = customSearch.trim().toLowerCase();
    if (!query) {
      return availableForCustom;
    }

    return availableForCustom
      .filter((player) => player.name.toLowerCase().includes(query))
      .slice(0, 10);
  }, [availableForCustom, customSearch]);

  const pairSearchResults = useMemo(() => {
    const query = pairSearch.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return activeBatch.players
      .filter(
        (player) =>
          player.status === 'checked-in' &&
          !player.pairId &&
          !activePlayers.has(player.id) &&
          player.name.toLowerCase().includes(query),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12);
  }, [activeBatch.players, activePlayers, pairSearch]);

  const liveCourts = useMemo(
    () => activeBatch.courts.filter((court) => court.status === 'live'),
    [activeBatch.courts],
  );

  const idleCourts = useMemo(
    () => activeBatch.courts.filter((court) => court.status === 'idle'),
    [activeBatch.courts],
  );

  const breakPlayers = useMemo(
    () => activeBatch.players.filter((player) => player.status === 'break').sort((a, b) => a.name.localeCompare(b.name)),
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

  const upcomingMatches = activeBatch.queuedMatches;

  const queuePaused = queuePausedByBatch[activeBatch.batchId];
  const autoFillEnabled = autoFillEnabledByBatch[activeBatch.batchId];

  useEffect(() => {
    if (publicView || scoreOnly || queuePaused) {
      return;
    }

    void ensureReadyMatches(activeBatch.batchId, 6);
    const generationId = window.setInterval(() => {
      void ensureReadyMatches(activeBatch.batchId, 6);
    }, 5000);

    return () => {
      window.clearInterval(generationId);
    };
  }, [activeBatch.batchId, ensureReadyMatches, publicView, queuePaused, scoreOnly]);

  useEffect(() => {
    if (publicView || scoreOnly || !autoFillEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (autoFillRunningRef.current) {
        return;
      }

      autoFillRunningRef.current = true;
      Promise.resolve(fillIdleCourts(activeBatch.batchId)).finally(() => {
        autoFillRunningRef.current = false;
      });
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeBatch.batchId, autoFillEnabled, fillIdleCourts, publicView, scoreOnly]);

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

  const handleAddCustomToQueue = async (placement: 'top' | 'bottom') => {
    if (customSelection.length !== 4) {
      return;
    }

    await enqueueCustomMatch(activeBatch.batchId, customSelection, placement);
    setCustomSelection([]);
    setCustomSearch('');
  };

  const handleDeleteQueueMatch = async (sourceUnitIds: string[]) => {
    await removeQueueMatch(activeBatch.batchId, sourceUnitIds);
  };

  const handlePlaceQueueOnCourt = async (courtId: string, matchId: string) => {
    await startQueuedMatchOnCourt(activeBatch.batchId, courtId, matchId);
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

  const beginEditPlayer = (playerId: string) => {
    const player = activeBatch.players.find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }

    setEditingPlayerId(player.id);
    setEditName(player.name);
    setEditGender(player.gender);
  };

  const savePlayerEdit = async () => {
    if (!editingPlayerId || !editName.trim()) {
      return;
    }

    await updatePlayer(activeBatch.batchId, editingPlayerId, editName, editGender);
    setEditingPlayerId(null);
    setEditName('');
  };

  const handleDeletePlayer = async () => {
    if (!editingPlayerId) {
      return;
    }

    const shouldDelete = window.confirm('Delete this player from the batch?');
    if (!shouldDelete) {
      return;
    }

    await deletePlayer(activeBatch.batchId, editingPlayerId);
    setEditingPlayerId(null);
    setEditName('');
  };

  const handlePairSelected = async () => {
    if (pairSelection.length !== 2) {
      return;
    }

    await lockSelectedPair(activeBatch.batchId, pairSelection[0], pairSelection[1]);
    setPairSelection([]);
    setPairSearch('');
  };

  const togglePairSelection = (playerId: string) => {
    const player = activeBatch.players.find((entry) => entry.id === playerId);
    if (!player || player.pairId) {
      return;
    }

    setPairSelection((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : current.length >= 2
          ? current
          : [...current, playerId],
    );
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
    const nextOpenCourt = activeBatch.courts.find((court) => court.status === 'idle');
    const nextTwoMatches = upcomingMatches.slice(0, 2);
    const nextMatch = nextTwoMatches[0];

    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Public Queue</p>
              <h2 className="text-display mt-2 text-3xl font-semibold sm:text-4xl">Live Queue - Batch {activeBatch.batchId}</h2>
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

        <section className="relative overflow-hidden rounded-[2rem] border border-amber-300/35 bg-gradient-to-r from-amber-300/25 via-orange-300/25 to-rose-300/25 px-6 py-6 shadow-[0_12px_40px_rgba(251,191,36,0.2)] sm:px-8 sm:py-7">
          <div className="pointer-events-none absolute -left-16 top-0 h-36 w-36 rounded-full bg-amber-200/20 blur-3xl" />
          <div className="pointer-events-none absolute -right-16 bottom-0 h-36 w-36 rounded-full bg-rose-200/20 blur-3xl" />

          <div className="relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-3 w-3 items-center justify-center">
                <span className="absolute h-3 w-3 animate-ping rounded-full bg-emerald-300/80" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-300" />
              </div>
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-amber-100/90">Now Calling</div>
            </div>

            {nextMatch ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {/* MATCH #1: LEFT SIDE - HIGHLIGHTED/PRIMARY */}
                <div className="rounded-[2rem] border-2 border-amber-300/60 bg-gradient-to-br from-amber-300/25 to-amber-400/10 p-5 shadow-[0_8px_32px_rgba(251,191,36,0.3)]">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-100">Match #1</div>
                    <div className="rounded-full bg-amber-300/30 px-3 py-1 text-xs font-bold text-amber-100">
                      {nextTwoMatches[0]?.mode === 'mixed' ? 'Mixed' : 'Custom'}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-2xl border border-amber-300/40 bg-black/30 px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-200/90">Team 1</div>
                      <div className="mt-2 space-y-1 text-sm font-semibold text-white">
                        {nextTwoMatches[0]?.teamA.map((player) => (
                          <div key={player} className="rounded-lg bg-amber-400/10 px-3 py-2">
                            {player}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="text-center font-black uppercase tracking-[0.35em] text-amber-300/80">VS</div>

                    <div className="rounded-2xl border border-amber-300/40 bg-black/30 px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-200/90">Team 2</div>
                      <div className="mt-2 space-y-1 text-sm font-semibold text-white">
                        {nextTwoMatches[0]?.teamB.map((player) => (
                          <div key={player} className="rounded-lg bg-amber-400/10 px-3 py-2">
                            {player}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {nextOpenCourt && (
                    <div className="mt-4 rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-center text-xs font-bold text-emerald-100">
                      → {nextOpenCourt.label}
                    </div>
                  )}
                </div>

                {/* MATCH #2: RIGHT SIDE - SECONDARY/PREVIEW */}
                {nextTwoMatches.length > 1 ? (
                  <div className="rounded-[2rem] border border-white/20 bg-white/5 p-5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="text-xs font-bold uppercase tracking-[0.3em] text-white/70">Match #2 (Preview)</div>
                      <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200/80">
                        {nextTwoMatches[1]?.mode === 'mixed' ? 'Mixed' : 'Custom'}
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-xs uppercase tracking-[0.25em] text-slate-400/80">Team 1</div>
                        <div className="mt-1 text-sm text-slate-200/90">{nextTwoMatches[1]?.teamA.join(' + ')}</div>
                      </div>

                      <div className="text-center text-xs font-bold uppercase tracking-[0.3em] text-white/50">VS</div>

                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-xs uppercase tracking-[0.25em] text-slate-400/80">Team 2</div>
                        <div className="mt-1 text-sm text-slate-200/90">{nextTwoMatches[1]?.teamB.join(' + ')}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5">
                    <div className="text-center text-sm font-semibold text-white/50">No Match #2 queued yet</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-2xl font-black leading-snug text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.35)] sm:text-3xl">
                NO READY MATCHES YET
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <h3 className="text-xl font-semibold text-white">Upcoming Matches</h3>
            <div className="mt-4 space-y-3">
              {upcomingMatches.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">No ready matches yet.</div> : null}
              {upcomingMatches.map((match, index) => (
                <div key={match.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-amber-200/80">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.75)]" />
                      Ready match {index + 1}
                    </div>
                    <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">{match.mode === 'mixed' ? 'Mixed' : 'Custom'}</div>
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
          <div className="flex items-center gap-3">
            <Trophy className="h-5 w-5 text-amber-300" />
            <h3 className="text-xl font-semibold text-white">Leaderboard</h3>
          </div>
          <div className="mt-4 space-y-2">
            {leaderboard.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">No completed matches yet.</div>
            ) : null}
            {leaderboard.map((entry, index) => (
              <div
                key={entry.playerId}
                className={`flex items-center justify-between rounded-2xl border p-3 text-sm transition ${
                  index === 0
                    ? 'animate-pulse border-amber-300/45 bg-amber-300/20'
                    : index === 1
                      ? 'border-slate-300/35 bg-slate-200/10'
                      : index === 2
                        ? 'border-orange-300/35 bg-orange-300/10'
                        : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-7 rounded-full bg-black/25 py-1 text-center text-xs text-amber-200">{entry.rank}</span>
                  <span className="font-medium text-white">{entry.name}</span>
                </div>
                <span className="text-slate-300/80">{entry.wins} wins - {entry.gamesPlayed} games</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (scoreOnly) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Score Game</p>
              <h2 className="text-display mt-2 text-3xl font-semibold sm:text-4xl">Active Courts</h2>
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
              <Link href="/dashboard" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
                Back to dashboard
              </Link>
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <div className="space-y-4">
            {liveCourts.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">No active courts right now.</div> : null}
            {liveCourts.map((court) => {
              const draft = scoreDrafts[court.id] ?? { a: '', b: '' };
              return (
                <div key={court.id} className="rounded-2xl border border-orange-300/30 bg-orange-400/8 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-white">{court.label}</div>
                    <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">
                      {formatTimer(court.startedAt, nowMs)}
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-slate-200/90">Team A: {court.teamA.join(', ')}</div>
                  <div className="mt-1 text-sm text-slate-200/90">Team B: {court.teamB.join(', ')}</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                      className="glass-input w-full min-w-0 rounded-2xl px-4 py-3"
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
                      className="glass-input w-full min-w-0 rounded-2xl px-4 py-3"
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
                      className="rounded-2xl bg-gradient-to-r from-emerald-400 to-lime-300 px-4 py-3 text-sm font-semibold text-slate-950 sm:col-span-2"
                    >
                      Save score
                    </button>
                  </div>
                </div>
              );
            })}
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
            <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Dashboard</p>
            <h2 className="text-display mt-2 text-3xl font-semibold sm:text-4xl">Batch {activeBatch.batchId}</h2>
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
            <Link href="/dashboard/score" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
              Score Game
            </Link>
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
        <div className="mt-4 text-xs text-slate-300/80">{authEmail ?? 'admin'}</div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Checked-in" value={batchCounts.checkedIn} />
        <StatCard label="Waiting" value={batchCounts.waiting} />
        <StatCard label="Live courts" value={batchCounts.activeCourts} />
        <StatCard label="Break" value={batchCounts.onBreak} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <h3 className="text-xl font-semibold text-white">Add Player/s</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <label className="text-sm text-slate-200/90">Single player</label>
                <div className="mt-2 space-y-2">
                  <input
                    value={playerName}
                    onChange={(event) => setPlayerName(event.target.value)}
                    placeholder="Player name"
                    className="glass-input w-full rounded-2xl px-4 py-3 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    {(['M', 'F'] as const).map((gender) => (
                      <button
                        key={gender}
                        type="button"
                        onClick={() => setPlayerGender(gender)}
                        className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
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
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
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
              <h3 className="text-xl font-semibold text-white">Pairings</h3>
              <span className="text-xs text-slate-300/80">{pairSelection.length}/2 selected</span>
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Search players</label>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-200" />
                <input
                  value={pairSearch}
                  onChange={(event) => setPairSearch(event.target.value)}
                  placeholder="Type a name"
                  className="glass-input w-full rounded-2xl px-10 py-3 text-sm"
                />
              </div>
            </div>

            <div className="mt-3 space-y-2 max-h-48 overflow-auto pr-1">
              {pairSearch.trim() !== '' && pairSearchResults.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300/80">No matching checked-in players.</div>
              ) : null}
              {pairSearchResults.map((player) => {
                const selected = pairSelection.includes(player.id);
                return (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => togglePairSelection(player.id)}
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

            <div className="mt-4 flex items-center gap-3">
              <button type="button" onClick={handlePairSelected} disabled={pairSelection.length !== 2} className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
                Make pair
              </button>
              <button type="button" onClick={() => setPairSelection([])} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100/90">
                Clear
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
              <h4 className="text-sm font-semibold text-amber-100">Pairs made</h4>
              <div className="mt-2 space-y-2 max-h-40 overflow-auto pr-1">
                {activeBatch.pairs.length === 0 ? <div className="text-sm text-slate-300/80">No pairs.</div> : null}
                {activeBatch.pairs.map((pair) => {
                  const firstName = activeBatch.players.find((player) => player.id === pair.playerIds[0])?.name ?? 'Player';
                  const secondName = activeBatch.players.find((player) => player.id === pair.playerIds[1])?.name ?? 'Player';
                  return (
                    <div key={pair.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-3 text-sm">
                      <span className="font-medium text-white">{firstName} + {secondName}</span>
                      <button type="button" onClick={() => unlockSelectedPair(activeBatch.batchId, pair.id)} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">
                        Unpair
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Queue</h3>
                <div className="mt-1 text-xs text-slate-300/80">Queue contains ready matches. Auto-generation keeps at least 6 when not paused.</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setQueuePausedByBatch((current) => ({
                      ...current,
                      [activeBatch.batchId]: !current[activeBatch.batchId],
                    }))
                  }
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    queuePaused
                      ? 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                      : 'border-amber-300/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15'
                  }`}
                >
                  {queuePaused ? 'Play queue' : 'Pause queue'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAutoFillEnabledByBatch((current) => ({
                      ...current,
                      [activeBatch.batchId]: !current[activeBatch.batchId],
                    }))
                  }
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    autoFillEnabled
                      ? 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                      : 'border-white/10 bg-white/5 text-slate-100/90 hover:bg-white/10'
                  }`}
                >
                  {autoFillEnabled ? 'Auto-fill 15s: On' : 'Auto-fill 15s: Off'}
                </button>
                <button
                  type="button"
                  onClick={() => refreshQueueProcess(activeBatch.batchId)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10"
                >
                  Refresh queue
                </button>
                <button
                  type="button"
                  onClick={() => fillIdleCourts(activeBatch.batchId)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10"
                >
                  Auto-fill courts
                </button>
              </div>
            </div>
            {queuePaused ? <div className="mt-3 rounded-2xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-amber-100">Queue is paused</div> : null}
            <div className="mt-4 space-y-3">
              {upcomingMatches.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">{queuePaused ? 'Queue paused.' : 'Queue is empty.'}</div> : null}
              {upcomingMatches.map((match, index) => (
                <div key={match.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-7 rounded-full bg-black/25 py-1 text-center text-xs text-amber-200">{index + 1}</span>
                      <span className="font-medium text-white">{match.courtLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => moveQueueUnit(activeBatch.batchId, match.id, 'up')} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">↑</button>
                      <button type="button" onClick={() => moveQueueUnit(activeBatch.batchId, match.id, 'down')} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">↓</button>
                      <button type="button" onClick={() => handleDeleteQueueMatch([match.id])} className="rounded-full border border-rose-300/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-100">Delete</button>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">{match.mode === 'mixed' ? 'Mixed' : 'Custom'}</span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <TeamCard label="Team 1" players={match.teamA} />
                    <div className="text-center text-sm font-semibold uppercase tracking-[0.35em] text-amber-200/80">VS</div>
                    <TeamCard label="Team 2" players={match.teamB} alignRight />
                  </div>
                  {idleCourts.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                      {idleCourts.map((court) => (
                        <button
                          key={`${match.id}-${court.id}`}
                          type="button"
                          onClick={() => handlePlaceQueueOnCourt(court.id, match.id)}
                          className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100"
                        >
                          {court.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Courts</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canRemoveCourt}
                  onClick={() => setCourtCount(activeBatch.batchId, activeBatch.courtCount - 1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  -
                </button>
                <span className="text-sm text-slate-200/90">{activeBatch.courtCount} courts</span>
                <button
                  type="button"
                  onClick={() => setCourtCount(activeBatch.batchId, activeBatch.courtCount + 1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100/90"
                >
                  +
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
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                            className="glass-input w-full min-w-0 rounded-2xl px-4 py-3"
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
                            className="glass-input w-full min-w-0 rounded-2xl px-4 py-3"
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
                            className="rounded-2xl bg-gradient-to-r from-emerald-400 to-lime-300 px-4 py-3 text-sm font-semibold text-slate-950 sm:col-span-2"
                          >
                            Save
                          </button>
                        </div>
                        <div className="mt-3">
                          <button type="button" onClick={() => cancelMatch(activeBatch.batchId, court.id)} className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100">
                            Cancel
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
            <h3 className="text-xl font-semibold text-white">Player Status</h3>

            <div className="mt-4">
              <h4 className="text-sm font-semibold text-amber-100">Currently Playing</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {playingPlayers.length === 0 ? <span className="text-sm text-slate-300/80">None</span> : null}
                {playingPlayers.map((name) => (
                  <span key={name} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-100/90">
                    {name}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h4 className="text-sm font-semibold text-amber-100">On Break</h4>
              <div className="mt-2 max-h-48 space-y-2 overflow-auto pr-1">
                {breakPlayers.length === 0 ? <div className="text-sm text-slate-300/80">None</div> : null}
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
                {availableForCustom.length === 0 ? <div className="text-sm text-slate-300/80">None</div> : null}
              </div>
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold text-white">Players</h3>
              <span className="text-xs text-slate-300/80">M / F</span>
            </div>

            <div className="mt-4 max-h-[32rem] space-y-3 overflow-auto pr-1">
              {sortedPlayers.map((player) => {
                const isEditing = editingPlayerId === player.id;

                return (
                  <div key={player.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    {isEditing ? (
                      <div className="grid gap-3 sm:grid-cols-[1fr_100px_auto] sm:items-center">
                        <input
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          className="glass-input rounded-2xl px-4 py-3 text-sm"
                        />
                        <div className="flex gap-2">
                          {(['M', 'F'] as const).map((gender) => (
                            <button
                              key={gender}
                              type="button"
                              onClick={() => setEditGender(gender)}
                              className={`flex-1 rounded-2xl border px-3 py-3 text-sm font-medium transition ${
                                editGender === gender
                                  ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                                  : 'border-white/10 bg-white/5 text-slate-200/80'
                              }`}
                            >
                              {gender}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={savePlayerEdit} className="rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950">
                            Save
                          </button>
                          <button type="button" onClick={() => setEditingPlayerId(null)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100/90">
                            Cancel
                          </button>
                          <button type="button" onClick={handleDeletePlayer} className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100">
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-100/90">{player.gender}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-white">{player.name}</div>
                          <div className="text-xs text-slate-300/80">{player.status}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => toggleBreak(activeBatch.batchId, player.id)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100/90">
                            {player.status === 'break' ? 'Return' : 'Break'}
                          </button>
                          <button type="button" onClick={() => beginEditPlayer(player.id)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100/90">
                            Edit
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Custom Match</h3>
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

            <div className="mt-4 space-y-2 max-h-56 overflow-auto pr-1">
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
            {customSelection.length === 4 ? (
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200/90">
                Team 1: {activeBatch.players.find((player) => player.id === customSelection[0])?.name ?? '-'} + {activeBatch.players.find((player) => player.id === customSelection[1])?.name ?? '-'} | Team 2: {activeBatch.players.find((player) => player.id === customSelection[2])?.name ?? '-'} + {activeBatch.players.find((player) => player.id === customSelection[3])?.name ?? '-'}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={customSelection.length !== 4}
                onClick={() => handleAddCustomToQueue('top')}
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add to Top
              </button>
              <button
                type="button"
                disabled={customSelection.length !== 4}
                onClick={() => handleAddCustomToQueue('bottom')}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add to Bottom
              </button>
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.28em] text-slate-400/80">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}