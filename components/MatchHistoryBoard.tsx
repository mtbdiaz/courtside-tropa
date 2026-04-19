'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BatchId } from '@/types/courtside';
import { useCourtsideBoard } from '@/hooks/useCourtsideBoard';

export default function MatchHistoryBoard({ initialBatchId = 1 }: { initialBatchId?: BatchId }) {
  const { activeBatch, isReady, setActiveBatchId, editScore } = useCourtsideBoard(initialBatchId);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');

  if (!isReady) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-7xl items-center justify-center px-4 py-12 sm:px-6">
        <div className="glass-panel rounded-[2rem] px-6 py-10 text-center text-slate-100/90">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-amber-300" />
          <div className="mt-4 text-lg font-semibold text-white">Loading match history</div>
        </div>
      </main>
    );
  }

  const completed = activeBatch.history.filter((match) => match.status === 'complete');

  const beginEdit = (matchId: string, currentA: number | null, currentB: number | null) => {
    setEditingMatchId(matchId);
    setScoreA(currentA === null ? '' : String(currentA));
    setScoreB(currentB === null ? '' : String(currentB));
  };

  const handleSave = async () => {
    if (!editingMatchId) {
      return;
    }

    const nextA = scoreA === '' ? null : Number(scoreA);
    const nextB = scoreB === '' ? null : Number(scoreB);
    if ((nextA !== null && Number.isNaN(nextA)) || (nextB !== null && Number.isNaN(nextB))) {
      return;
    }

    await editScore(activeBatch.batchId, editingMatchId, nextA, nextB);
    setEditingMatchId(null);
    setScoreA('');
    setScoreB('');
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Admin</p>
            <h2 className="text-display mt-2 text-3xl font-semibold sm:text-4xl">Match History</h2>
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
            <Link href="/dashboard" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90">
              Back to dashboard
            </Link>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
        <div className="space-y-3">
          {completed.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">None</div> : null}
          {completed.map((match) => (
            <article key={match.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.28em] text-slate-300/70">{match.courtLabel}</div>
                  <div className="mt-1 font-semibold text-white">{new Date(match.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                </div>
                <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90">Winner: {match.winner === 'TBD' ? 'Pending' : `Team ${match.winner}`}</div>
              </div>
              <div className="mt-3 text-sm text-slate-200/90">Team A: {match.teamA.join(', ')} ({match.scoreA ?? '-'})</div>
              <div className="mt-1 text-sm text-slate-200/90">Team B: {match.teamB.join(', ')} ({match.scoreB ?? '-'})</div>
              {editingMatchId === match.id ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
                  <input
                    type="number"
                    min="0"
                    value={scoreA}
                    onChange={(event) => setScoreA(event.target.value)}
                    placeholder="Score A"
                    className="glass-input rounded-2xl px-4 py-2"
                  />
                  <input
                    type="number"
                    min="0"
                    value={scoreB}
                    onChange={(event) => setScoreB(event.target.value)}
                    placeholder="Score B"
                    className="glass-input rounded-2xl px-4 py-2"
                  />
                  <button type="button" onClick={handleSave} className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950">
                    Update
                  </button>
                  <button type="button" onClick={() => setEditingMatchId(null)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100/90">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => beginEdit(match.id, match.scoreA, match.scoreB)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100/90"
                  >
                    Edit score
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
