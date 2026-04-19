'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BatchId, MatchMode } from '@/types/courtside';
import { useCourtsideBoard } from '@/hooks/useCourtsideBoard';
import { CalendarClock, CircleAlert, Lock, Plus, Shield, TimerReset, Users, Waves, ArrowUpDown, Trophy } from 'lucide-react';

function formatTimer(startedAt: string | null) {
  if (!startedAt) {
    return '00:00';
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(elapsed / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function modeClasses(mode: MatchMode, currentMode: MatchMode) {
  return mode === currentMode
    ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
    : 'border-white/10 bg-white/5 text-slate-200/80 hover:border-amber-300/30 hover:bg-white/10';
}

export default function CourtsideBoard({ publicView = false, initialBatchId = 1 }: { publicView?: boolean; initialBatchId?: BatchId }) {
  const {
    activeBatch,
    queueUnits,
    batchCounts,
    isReady,
    syncStatus,
    authEmail,
    setActiveBatchId,
    setMode,
    setCourtCount,
    addSinglePlayer,
    addBulk,
    toggleBreak,
    lockSelectedPair,
    unlockSelectedPair,
    startMatchOnCourt,
    completeMatch,
    editScore,
    fillIdleCourts,
  } = useCourtsideBoard(initialBatchId);

  const [playerName, setPlayerName] = useState('');
  const [playerGender, setPlayerGender] = useState<'M' | 'F'>('M');
  const [bulkNames, setBulkNames] = useState('');
  const [bulkGender, setBulkGender] = useState<'M' | 'F'>('M');
  const [pairSelection, setPairSelection] = useState<string[]>([]);
  const [customSelection, setCustomSelection] = useState<string[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, { a: string; b: string }>>({});

  const waitingList = useMemo(() => queueUnits, [queueUnits]);
  const liveCourts = activeBatch.courts.filter((court) => court.status === 'live');
  const idleCourt = activeBatch.courts.find((court) => court.status === 'idle');
  const totalCapacityLabel = `${activeBatch.courtCount} courts active`;

  const onTogglePairSelection = (playerId: string) => {
    const currentPlayer = activeBatch.players.find((player) => player.id === playerId);
    if (!currentPlayer) {
      return;
    }

    const pairId = currentPlayer.pairId;
    if (pairId) {
      const pair = activeBatch.pairs.find((entry) => entry.id === pairId);
      if (!pair) {
        return;
      }

      setPairSelection((current) =>
        current.includes(pair.id)
          ? current.filter((entry) => entry !== pair.id)
          : [...current.filter((entry) => !activeBatch.pairs.some((lockedPair) => lockedPair.id === entry && lockedPair.playerIds.some((id) => pair.playerIds.includes(id)))), pair.id]
      );
      return;
    }

    setPairSelection((current) =>
      current.includes(playerId) ? current.filter((entry) => entry !== playerId) : [...current, playerId]
    );
  };

  const onToggleCustomSelection = (playerId: string) => {
    const player = activeBatch.players.find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }

    if (player.pairId) {
      const pair = activeBatch.pairs.find((entry) => entry.id === player.pairId);
      if (!pair) {
        return;
      }

      setCustomSelection((current) =>
        current.includes(pair.playerIds[0]) && current.includes(pair.playerIds[1])
          ? current.filter((entry) => !pair.playerIds.includes(entry))
          : Array.from(new Set([...current, ...pair.playerIds]))
      );
      return;
    }

    setCustomSelection((current) =>
      current.includes(playerId) ? current.filter((entry) => entry !== playerId) : [...current, playerId]
    );
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

  const handlePair = () => {
    if (pairSelection.length !== 2) {
      return;
    }

    lockSelectedPair(activeBatch.batchId, pairSelection[0], pairSelection[1]);
    setPairSelection([]);
  };

  const handleCustomStart = (courtId: string) => {
    startMatchOnCourt(activeBatch.batchId, courtId, 'custom', { playerIds: customSelection });
    setCustomSelection([]);
  };

  if (!isReady) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-7xl items-center justify-center px-4 py-12 sm:px-6">
        <div className="glass-panel rounded-[2rem] px-6 py-10 text-center text-slate-100/90">
          <LoaderSpinner />
          <div className="mt-4 text-lg font-semibold text-white">Loading Courtside Tropa</div>
          <p className="mt-2 text-sm text-slate-300/80">Restoring the latest queue snapshot and realtime connections.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Realtime event control</p>
            <h2 className="text-display mt-2 text-3xl font-semibold sm:text-4xl">{publicView ? 'Live Queue' : 'Admin Dashboard'}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200/85 sm:text-base">
              {publicView
                ? 'Follow the current batch queue, active courts, and live timers without logging in.'
                : 'Manage batches, queue players, pairings, courts, and match history from any signed-in device.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="glass-panel rounded-2xl px-4 py-3 text-sm text-slate-100/90">
              <div className="flex items-center gap-2 text-amber-200">
                <CalendarClock className="h-4 w-4" />
                May 1, 2026
              </div>
              <div className="mt-1 text-xs text-slate-300/80">{totalCapacityLabel}</div>
            </div>
            <div className="glass-panel rounded-2xl px-4 py-3 text-sm text-slate-100/90">
              <div className="flex items-center gap-2 text-rose-200">
                <Shield className="h-4 w-4" />
                {syncStatus === 'online' ? 'Realtime sync on' : 'Offline cache mode'}
              </div>
              <div className="mt-1 text-xs text-slate-300/80">{authEmail ?? 'Public view'}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={<Users className="h-4 w-4" />} label="Checked-in" value={batchCounts.checkedIn} />
          <StatCard icon={<TimerReset className="h-4 w-4" />} label="Waiting" value={batchCounts.waiting} />
          <StatCard icon={<Waves className="h-4 w-4" />} label="Live courts" value={batchCounts.activeCourts} />
          <StatCard icon={<CircleAlert className="h-4 w-4" />} label="Break" value={batchCounts.onBreak} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {[1, 2].map((batchId) => (
            <button
              key={batchId}
              type="button"
              onClick={() => setActiveBatchId(batchId as BatchId)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                activeBatch.batchId === batchId ? 'border-amber-300/50 bg-amber-300/15 text-amber-100' : 'border-white/10 bg-white/5 text-slate-200/80 hover:bg-white/10'
              }`}
            >
              Batch {batchId}
            </button>
          ))}

          {!publicView ? (
            <>
              <button
                type="button"
                onClick={() => setMode(activeBatch.batchId, 'mixed')}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${modeClasses('mixed', activeBatch.activeMode)}`}
              >
                Mixed Doubles
              </button>
              <button
                type="button"
                onClick={() => setMode(activeBatch.batchId, 'all-girls')}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${modeClasses('all-girls', activeBatch.activeMode)}`}
              >
                All-Girls
              </button>
              <button
                type="button"
                onClick={() => setMode(activeBatch.batchId, 'all-boys')}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${modeClasses('all-boys', activeBatch.activeMode)}`}
              >
                All-Boys
              </button>
              <button
                type="button"
                onClick={() => fillIdleCourts(activeBatch.batchId)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10"
              >
                Auto-fill courts
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          {!publicView ? (
            <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-white">Player management</h3>
                  <p className="text-sm text-slate-300/80">Add players, bulk paste names, pause returns, and lock pairs.</p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.3em] text-amber-200/80">
                  Queue first
                </div>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <h4 className="mb-4 text-sm font-semibold uppercase tracking-[0.25em] text-amber-200/80">Add player</h4>
                  <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
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
                            playerGender === gender ? 'border-amber-300/50 bg-amber-300/15 text-amber-100' : 'border-white/10 bg-white/5 text-slate-200/80'
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
                    className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white"
                  >
                    <Plus className="h-4 w-4" />
                    Add player
                  </button>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <h4 className="mb-4 text-sm font-semibold uppercase tracking-[0.25em] text-amber-200/80">Bulk paste</h4>
                  <textarea
                    value={bulkNames}
                    onChange={(event) => setBulkNames(event.target.value)}
                    rows={6}
                    placeholder={'One name per line\nOne name per line\nOne name per line'}
                    className="glass-input w-full rounded-2xl px-4 py-3 text-sm"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex gap-2">
                      {(['M', 'F'] as const).map((gender) => (
                        <button
                          key={gender}
                          type="button"
                          onClick={() => setBulkGender(gender)}
                          className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                            bulkGender === gender ? 'border-amber-300/50 bg-amber-300/15 text-amber-100' : 'border-white/10 bg-white/5 text-slate-200/80'
                          }`}
                        >
                          {gender}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleBulkAdd}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90"
                    >
                      <ArrowUpDown className="h-4 w-4" />
                      Import list
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-3xl border border-white/10 bg-black/15 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-200/80">Lock pair</h4>
                  <span className="text-xs text-slate-300/80">Select any 2 unpaired players</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {activeBatch.players.map((player) => {
                    const selected = pairSelection.includes(player.pairId ?? player.id);
                    const isPaired = Boolean(player.pairId);
                    return (
                      <button
                        key={player.id}
                        type="button"
                        onClick={() => onTogglePairSelection(player.id)}
                        className={`queue-item rounded-2xl border px-4 py-3 text-left transition ${selected ? 'data-[active=true]' : ''}`}
                        data-active={selected}
                        disabled={isPaired}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-white">{player.name}</div>
                            <div className="text-xs text-slate-300/80">{player.gender} • {player.status}</div>
                          </div>
                          {isPaired ? <Lock className="h-4 w-4 text-amber-300" /> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={pairSelection.length !== 2}
                    onClick={handlePair}
                    className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Lock selected pair
                  </button>
                  <button
                    type="button"
                    onClick={() => setPairSelection([])}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100/90"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="mt-5 rounded-3xl border border-white/10 bg-black/15 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-200/80">Queue roster</h4>
                  <span className="text-xs text-slate-300/80">{waitingList.length} queue units</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {activeBatch.players.map((player) => (
                    <div key={player.id} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-white">{player.name}</div>
                          <div className="text-xs text-slate-300/80">{player.gender} • {player.status}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleBreak(activeBatch.batchId, player.id)}
                          className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90"
                        >
                          {player.status === 'break' ? 'Return' : 'Break'}
                        </button>
                      </div>
                      {player.pairId ? <div className="mt-2 text-xs text-amber-200/80">Paired unit</div> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 rounded-3xl border border-white/10 bg-black/15 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-200/80">Locked pairs</h4>
                  <span className="text-xs text-slate-300/80">Pairs stay together in queue and matches</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeBatch.pairs.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300/80 sm:col-span-2">
                      No locked pairs yet.
                    </div>
                  ) : null}
                  {activeBatch.pairs.map((pair) => (
                    <div key={pair.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-white">{activeBatch.players.find((player) => player.id === pair.playerIds[0])?.name} + {activeBatch.players.find((player) => player.id === pair.playerIds[1])?.name}</div>
                          <div className="text-xs text-slate-300/80">Pair unit • {pair.playerIds.join(', ')}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => unlockSelectedPair(activeBatch.batchId, pair.id)}
                          className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90"
                        >
                          Unlock
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Courts</h3>
                <p className="text-sm text-slate-300/80">Open courts auto-fill as soon as a match finishes.</p>
              </div>
              {!publicView ? (
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
                  {[5, 6].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setCourtCount(activeBatch.batchId, count)}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${activeBatch.courtCount === count ? 'bg-amber-300/15 text-amber-100' : 'text-slate-300/80'}`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {activeBatch.courts.map((court) => {
                const match = activeBatch.history.find((entry) => entry.id === court.matchId);
                const draft = scoreDrafts[court.id] ?? { a: '', b: '' };
                return (
                  <article key={court.id} className={`card-rise rounded-[1.75rem] border p-4 ${court.status === 'live' ? 'border-orange-300/30 bg-orange-400/8' : 'border-white/10 bg-white/5'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm uppercase tracking-[0.28em] text-slate-300/70">{court.label}</div>
                        <h4 className="mt-1 text-lg font-semibold text-white">{court.status === 'live' ? 'Live match' : 'Waiting for players'}</h4>
                      </div>
                      <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">
                        {formatTimer(court.startedAt)}
                      </div>
                    </div>

                    {court.status === 'live' && match ? (
                      <div className="mt-4 space-y-3 text-sm">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <TeamStack title="Team A" players={court.teamA} />
                          <TeamStack title="Team B" players={court.teamB} />
                        </div>

                        {!publicView ? (
                          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                            <input
                              type="number"
                              min="0"
                              value={draft.a}
                              onChange={(event) => setScoreDrafts((current) => ({
                                ...current,
                                [court.id]: { ...(current[court.id] ?? { a: '', b: '' }), a: event.target.value },
                              }))}
                              placeholder="Score A"
                              className="glass-input rounded-2xl px-4 py-3"
                            />
                            <input
                              type="number"
                              min="0"
                              value={draft.b}
                              onChange={(event) => setScoreDrafts((current) => ({
                                ...current,
                                [court.id]: { ...(current[court.id] ?? { a: '', b: '' }), b: event.target.value },
                              }))}
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
                              Finalize
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3 text-sm text-slate-300/80">
                        <p>Idle court ready for the next match.</p>
                        {!publicView ? (
                          <button
                            type="button"
                            onClick={() => startMatchOnCourt(activeBatch.batchId, court.id, activeBatch.activeMode)}
                            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100/90"
                          >
                            Start next match here
                          </button>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {!publicView ? (
            <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-white">Custom match</h3>
                  <p className="text-sm text-slate-300/80">Select four players manually, then send them to any open court.</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200/80">Manual</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
                {activeBatch.players.map((player) => {
                  const selected = customSelection.includes(player.id);
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => onToggleCustomSelection(player.id)}
                      className={`queue-item rounded-2xl border px-4 py-3 text-left transition ${selected ? 'data-[active=true]' : ''}`}
                      data-active={selected}
                    >
                      <div className="font-medium text-white">{player.name}</div>
                      <div className="text-xs text-slate-300/80">{player.gender} • {player.status}</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-300/80">
                <span>{customSelection.length} selected</span>
                <button
                  type="button"
                  onClick={() => setCustomSelection([])}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium"
                >
                  Clear selection
                </button>
              </div>

              <p className="mt-2 text-xs text-slate-400/80">Pairs stay together when a paired player is selected.</p>

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  disabled={customSelection.length !== 4 || !idleCourt}
                  onClick={() => {
                    if (!idleCourt) {
                      return;
                    }
                    handleCustomStart(idleCourt.id);
                  }}
                  className="rounded-2xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Send to next open court
                </button>
                <span className="text-xs text-slate-400/80">
                  {idleCourt ? `Ready for ${idleCourt.label}` : 'No idle court available'}
                </span>
              </div>
            </section>
          ) : null}

          <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Match history</h3>
                <p className="text-sm text-slate-300/80">Scores sync instantly across all admin views and the public queue.</p>
              </div>
              <Trophy className="h-5 w-5 text-amber-300" />
            </div>

            <div className="mt-4 space-y-3">
              {activeBatch.history.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-300/80">
                  No completed matches yet.
                </div>
              ) : null}

              {activeBatch.history.map((match) => {
                const draft = scoreDrafts[match.id] ?? { a: match.scoreA?.toString() ?? '', b: match.scoreB?.toString() ?? '' };
                return (
                  <article key={match.id} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.28em] text-slate-300/70">{match.courtLabel}</div>
                        <div className="mt-1 font-semibold text-white">{match.mode}</div>
                        <div className="text-xs text-slate-400/80">{new Date(match.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">
                        {match.winner === 'TBD' ? 'Score pending' : `Winner: Team ${match.winner}`}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                      <input
                        type="number"
                        min="0"
                        value={draft.a}
                        onChange={(event) => setScoreDrafts((current) => ({
                          ...current,
                          [match.id]: { ...(current[match.id] ?? { a: '', b: '' }), a: event.target.value },
                        }))}
                        className="glass-input rounded-2xl px-4 py-3"
                      />
                      <input
                        type="number"
                        min="0"
                        value={draft.b}
                        onChange={(event) => setScoreDrafts((current) => ({
                          ...current,
                          [match.id]: { ...(current[match.id] ?? { a: '', b: '' }), b: event.target.value },
                        }))}
                        className="glass-input rounded-2xl px-4 py-3"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          editScore(activeBatch.batchId, match.id, draft.a === '' ? null : Number(draft.a), draft.b === '' ? null : Number(draft.b));
                        }}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100/90"
                      >
                        Save
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300/80">
                      <span>Team A: {match.teamA.join(', ')}</span>
                      <span>Team B: {match.teamB.join(', ')}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </section>

      {publicView ? (
        <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">Queue snapshot</h3>
              <p className="text-sm text-slate-300/80">Public view remains read-only and updates in real time.</p>
            </div>
            <div className="flex gap-3 text-sm text-slate-200/90">
              <Link href="/" className="rounded-full border border-white/10 bg-white/5 px-4 py-2">Login</Link>
              <Link href="/dashboard" className="rounded-full border border-white/10 bg-white/5 px-4 py-2">Dashboard</Link>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[1.75rem] border border-white/10 bg-black/15 p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-200/80">Waiting players</h4>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {waitingList.map((unit) => (
                  <div key={unit.id} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                    <div className="font-medium text-white">{unit.label}</div>
                    <div className="text-xs text-slate-300/80">{unit.type === 'pair' ? 'Locked pair' : 'Single player'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-black/15 p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-200/80">Live matches</h4>
              <div className="mt-4 space-y-3">
                {liveCourts.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">No live matches right now.</div>
                ) : null}

                {liveCourts.map((court) => (
                  <div key={court.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-white">{court.label}</span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs">{formatTimer(court.startedAt)}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-slate-200/90">
                      <div>Team A: {court.teamA.join(', ')}</div>
                      <div>Team B: {court.teamB.join(', ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function LoaderSpinner() {
  return (
    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-amber-300" />
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3 text-slate-200/90">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-2 text-amber-200">{icon}</div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="mt-4 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}

function TeamStack({ title, players }: { title: string; players: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-xs uppercase tracking-[0.25em] text-slate-400/80">{title}</div>
      <div className="mt-2 space-y-1 text-sm text-white">
        {players.map((player) => (
          <div key={player} className="rounded-xl bg-white/5 px-3 py-2">{player}</div>
        ))}
      </div>
    </div>
  );
}
