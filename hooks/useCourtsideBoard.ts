'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  createEmptyBatchSnapshot,
  createEmptyCourtsideSnapshot,
  findNextMatch,
  getBatchCounts,
  resolveQueueUnits,
} from '@/lib/courtside-engine';
import type {
  BatchId,
  BatchSnapshot,
  CustomMatchSelection,
  Gender,
  MatchMode,
  Pair,
  Player,
} from '@/types/courtside';

interface BatchRow {
  id: string;
  name: string;
  num_courts: number | null;
  created_at: string | null;
}

interface PlayerRow {
  id: string;
  batch_id: string;
  name: string;
  gender: Gender;
  status: 'checked-in' | 'break';
  pair_id: string | null;
  created_at: string | null;
}

interface CourtRow {
  id: string;
  batch_id: string;
  court_number: number;
  status: 'free' | 'occupied';
  current_match_id: string | null;
  start_time: string | null;
}

interface MatchRow {
  id: string;
  batch_id: string;
  court_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
  start_time: string | null;
  end_time: string | null;
  score_team1: number | null;
  score_team2: number | null;
  winner_team: 'team1' | 'team2' | null;
  status: 'active' | 'completed';
}

interface MatchHistoryRow {
  id: string;
  batch_id: string;
  match_id: string | null;
  court_number: number | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  score_team1: number | null;
  score_team2: number | null;
  winner_team: 'team1' | 'team2' | null;
  played_at: string | null;
  notes: string | null;
}

const BATCH_NAME_REGEX = /batch\s*([12])/i;

function nowIso() {
  return new Date().toISOString();
}

function winnerToAB(winner: 'team1' | 'team2' | null): 'A' | 'B' | 'TBD' {
  if (winner === 'team1') {
    return 'A';
  }

  if (winner === 'team2') {
    return 'B';
  }

  return 'TBD';
}

function scoreToWinner(scoreA: number | null, scoreB: number | null): 'team1' | 'team2' | null {
  if (scoreA === null || scoreB === null || scoreA === scoreB) {
    return null;
  }

  return scoreA > scoreB ? 'team1' : 'team2';
}

function getBatchIdFromName(name: string): BatchId | null {
  const matched = name.match(BATCH_NAME_REGEX);
  if (!matched) {
    return null;
  }

  return matched[1] === '1' ? 1 : 2;
}

function modeFromPlayers(genders: Gender[]): MatchMode {
  if (genders.length !== 4) {
    return 'custom';
  }

  const males = genders.filter((value) => value === 'M').length;
  const females = genders.filter((value) => value === 'F').length;

  return males === 2 && females === 2 ? 'mixed' : 'custom';
}

function buildPairs(players: Player[]): Pair[] {
  const map = new Map(players.map((player) => [player.id, player]));
  const seen = new Set<string>();
  const pairs: Pair[] = [];

  for (const player of players) {
    if (!player.pairId) {
      continue;
    }

    const mate = map.get(player.pairId);
    if (!mate || mate.pairId !== player.id) {
      continue;
    }

    const ids = [player.id, mate.id].sort();
    const key = ids.join('-');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    pairs.push({
      id: `pair-${key}`,
      playerIds: [ids[0], ids[1]],
      createdAt: player.createdAt,
    });
  }

  return pairs;
}

function buildQueueOrder(players: Player[], pairs: Pair[], activePlayerIds: Set<string>) {
  const pairIndex = new Map<string, Pair>();
  for (const pair of pairs) {
    pair.playerIds.forEach((id) => pairIndex.set(id, pair));
  }

  const queuedPlayers = players
    .filter((player) => player.status === 'checked-in' && !activePlayerIds.has(player.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const queue: string[] = [];
  const usedPairIds = new Set<string>();

  for (const player of queuedPlayers) {
    const pair = pairIndex.get(player.id);
    if (!pair) {
      queue.push(player.id);
      continue;
    }

    if (usedPairIds.has(pair.id)) {
      continue;
    }

    const allQueued = pair.playerIds.every((id) => queuedPlayers.some((entry) => entry.id === id));
    if (!allQueued) {
      queue.push(player.id);
      continue;
    }

    usedPairIds.add(pair.id);
    queue.push(pair.id);
  }

  return queue;
}

function normalizeSnapshot(input: {
  batchId: BatchId;
  batchRow: BatchRow;
  players: PlayerRow[];
  courts: CourtRow[];
  matches: MatchRow[];
  histories: MatchHistoryRow[];
  activeMode: MatchMode;
}): BatchSnapshot {
  const basePlayers: Player[] = input.players.map((row) => ({
    id: row.id,
    name: row.name,
    gender: row.gender,
    status: row.status,
    pairId: row.pair_id,
    createdAt: row.created_at ?? nowIso(),
    updatedAt: row.created_at ?? nowIso(),
  }));

  const pairs = buildPairs(basePlayers);
  const pairByPlayerId = new Map<string, string>();
  pairs.forEach((pair) => {
    pair.playerIds.forEach((id) => pairByPlayerId.set(id, pair.id));
  });

  const players: Player[] = basePlayers.map((player) => ({
    ...player,
    pairId: pairByPlayerId.get(player.id) ?? null,
  }));

  const playersById = new Map(players.map((player) => [player.id, player]));

  const activeMatches = input.matches.filter((row) => row.status === 'active');
  const activePlayerIds = new Set<string>();
  for (const match of activeMatches) {
    [match.team1_player1_id, match.team1_player2_id, match.team2_player1_id, match.team2_player2_id].forEach((id) => {
      if (id) {
        activePlayerIds.add(id);
      }
    });
  }

  const queueOrder = buildQueueOrder(players, pairs, activePlayerIds);
  const matchesById = new Map(input.matches.map((row) => [row.id, row]));

  const courts = [...input.courts]
    .sort((a, b) => a.court_number - b.court_number)
    .map((court) => {
      const liveMatch = court.current_match_id ? matchesById.get(court.current_match_id) : null;
      const ids = liveMatch
        ? [liveMatch.team1_player1_id, liveMatch.team1_player2_id, liveMatch.team2_player1_id, liveMatch.team2_player2_id].filter(Boolean) as string[]
        : [];

      const teamAIds = liveMatch ? [liveMatch.team1_player1_id, liveMatch.team1_player2_id].filter(Boolean) as string[] : [];
      const teamBIds = liveMatch ? [liveMatch.team2_player1_id, liveMatch.team2_player2_id].filter(Boolean) as string[] : [];

      return {
        id: court.id,
        label: `Court ${court.court_number}`,
        status: liveMatch ? ('live' as const) : ('idle' as const),
        matchId: liveMatch?.id ?? null,
        mode: liveMatch
          ? modeFromPlayers(ids.map((id) => playersById.get(id)?.gender ?? 'M'))
          : null,
        startedAt: liveMatch?.start_time ?? court.start_time,
        sourceUnitIds: ids,
        teamA: teamAIds.map((id) => playersById.get(id)?.name ?? 'Unknown'),
        teamB: teamBIds.map((id) => playersById.get(id)?.name ?? 'Unknown'),
        scoreA: liveMatch?.score_team1 ?? null,
        scoreB: liveMatch?.score_team2 ?? null,
      };
    });

  const liveHistory = activeMatches.map((match) => {
    const allIds = [match.team1_player1_id, match.team1_player2_id, match.team2_player1_id, match.team2_player2_id].filter(Boolean) as string[];

    return {
      id: match.id,
      batchId: input.batchId,
      courtId: match.court_id ?? '',
      courtLabel: `Court ${input.courts.find((court) => court.id === match.court_id)?.court_number ?? '-'}`,
      mode: modeFromPlayers(allIds.map((id) => playersById.get(id)?.gender ?? 'M')),
      sourceUnitIds: allIds,
      playerIds: allIds,
      teamA: [match.team1_player1_id, match.team1_player2_id].filter(Boolean).map((id) => playersById.get(id!)?.name ?? 'Unknown'),
      teamB: [match.team2_player1_id, match.team2_player2_id].filter(Boolean).map((id) => playersById.get(id!)?.name ?? 'Unknown'),
      scoreA: match.score_team1,
      scoreB: match.score_team2,
      winner: winnerToAB(match.winner_team),
      status: 'live' as const,
      startedAt: match.start_time ?? nowIso(),
      endedAt: null,
    };
  });

  const historyByMatchId = new Map(input.histories.filter((row) => row.match_id).map((row) => [row.match_id as string, row]));

  const completedHistory = [...input.matches]
    .filter((match) => match.status === 'completed')
    .sort((a, b) => (b.end_time ?? b.start_time ?? '').localeCompare(a.end_time ?? a.start_time ?? ''))
    .map((match) => {
      const matchHistory = historyByMatchId.get(match.id);
      const allIds = [match.team1_player1_id, match.team1_player2_id, match.team2_player1_id, match.team2_player2_id].filter(Boolean) as string[];

      return {
        id: match.id,
        batchId: input.batchId,
        courtId: match.court_id ?? '',
        courtLabel: `Court ${matchHistory?.court_number ?? input.courts.find((court) => court.id === match.court_id)?.court_number ?? '-'}`,
        mode: modeFromPlayers(allIds.map((id) => playersById.get(id)?.gender ?? 'M')),
        sourceUnitIds: allIds,
        playerIds: allIds,
        teamA: [match.team1_player1_id, match.team1_player2_id].filter(Boolean).map((id) => playersById.get(id!)?.name ?? 'Unknown'),
        teamB: [match.team2_player1_id, match.team2_player2_id].filter(Boolean).map((id) => playersById.get(id!)?.name ?? 'Unknown'),
        scoreA: match.score_team1,
        scoreB: match.score_team2,
        winner: winnerToAB(match.winner_team),
        status: 'complete' as const,
        startedAt: match.start_time ?? matchHistory?.played_at ?? nowIso(),
        endedAt: match.end_time ?? matchHistory?.played_at ?? nowIso(),
        notes: matchHistory?.notes ?? undefined,
      };
    });

  return {
    ...createEmptyBatchSnapshot(input.batchId),
    batchId: input.batchId,
    title: input.batchRow.name,
    courtCount: input.batchRow.num_courts ?? input.courts.length,
    activeMode: input.activeMode,
    players,
    pairs,
    queueOrder,
    courts,
    history: [...liveHistory, ...completedHistory],
    lastUpdated: nowIso(),
  };
}

export function useCourtsideBoard(initialBatchId: BatchId = 1) {
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const batchDbIdRef = useRef<Record<BatchId, string | null>>({ 1: null, 2: null });

  const [snapshot, setSnapshot] = useState(() => {
    const empty = createEmptyCourtsideSnapshot();
    empty.activeBatchId = initialBatchId;
    return empty;
  });
  const [isReady, setIsReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'loading' | 'online' | 'offline'>('loading');
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [activeModes, setActiveModes] = useState<Record<BatchId, MatchMode>>({ 1: 'mixed', 2: 'mixed' });

  const activeBatch = snapshot.batches[snapshot.activeBatchId];

  const loadFromDatabase = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    const [
      { data: sessionData },
      { data: batchesData, error: batchesError },
      { data: playersData, error: playersError },
      { data: courtsData, error: courtsError },
      { data: matchesData, error: matchesError },
      { data: historyData, error: historyError },
    ] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from('batches').select('id,name,num_courts,created_at').order('created_at', { ascending: true }),
      supabase.from('players').select('id,batch_id,name,gender,status,pair_id,created_at').order('created_at', { ascending: true }),
      supabase.from('courts').select('id,batch_id,court_number,status,current_match_id,start_time').order('court_number', { ascending: true }),
      supabase.from('matches').select('id,batch_id,court_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,end_time,score_team1,score_team2,winner_team,status'),
      supabase.from('match_history').select('id,batch_id,match_id,court_number,team1_player1_name,team1_player2_name,team2_player1_name,team2_player2_name,score_team1,score_team2,winner_team,played_at,notes').order('played_at', { ascending: false }),
    ]);

    if (batchesError || playersError || courtsError || matchesError || historyError) {
      setSyncStatus('offline');
      setIsReady(true);
      return;
    }

    if (sessionData.session?.user?.email) {
      setAuthEmail(sessionData.session.user.email);
    }

    const batches = (batchesData ?? []) as BatchRow[];
    const players = (playersData ?? []) as PlayerRow[];
    const courts = (courtsData ?? []) as CourtRow[];
    const matches = (matchesData ?? []) as MatchRow[];
    const histories = (historyData ?? []) as MatchHistoryRow[];

    const byLogicalBatch = new Map<BatchId, BatchRow>();

    for (const batch of batches) {
      const logical = getBatchIdFromName(batch.name);
      if (logical) {
        byLogicalBatch.set(logical, batch);
      }
    }

    if (!byLogicalBatch.has(1) || !byLogicalBatch.has(2)) {
      const sorted = [...batches].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
      if (!byLogicalBatch.has(1) && sorted[0]) {
        byLogicalBatch.set(1, sorted[0]);
      }
      if (!byLogicalBatch.has(2) && sorted[1]) {
        byLogicalBatch.set(2, sorted[1]);
      }
    }

    const next = createEmptyCourtsideSnapshot();

    for (const batchId of [1, 2] as BatchId[]) {
      const row = byLogicalBatch.get(batchId);
      if (!row) {
        next.batches[batchId] = createEmptyBatchSnapshot(batchId);
        continue;
      }

      batchDbIdRef.current[batchId] = row.id;
      next.batches[batchId] = normalizeSnapshot({
        batchId,
        batchRow: row,
        players: players.filter((entry) => entry.batch_id === row.id),
        courts: courts.filter((entry) => entry.batch_id === row.id),
        matches: matches.filter((entry) => entry.batch_id === row.id),
        histories: histories.filter((entry) => entry.batch_id === row.id),
        activeMode: activeModes[batchId],
      });
    }

    next.activeBatchId = initialBatchId;
    next.lastUpdated = nowIso();

    setSnapshot(next);
    setSyncStatus('online');
    setIsReady(true);
  }, [activeModes, initialBatchId]);

  const withBatchDbId = useCallback((batchId: BatchId) => batchDbIdRef.current[batchId], []);

  const setActiveBatchId = useCallback((batchId: BatchId) => {
    setSnapshot((current) => ({
      ...current,
      activeBatchId: batchId,
    }));
  }, []);

  const setMode = useCallback((batchId: BatchId, mode: MatchMode) => {
    setActiveModes((current) => ({
      ...current,
      [batchId]: mode,
    }));
    setSnapshot((current) => ({
      ...current,
      batches: {
        ...current.batches,
        [batchId]: {
          ...current.batches[batchId],
          activeMode: mode,
        },
      },
    }));
  }, []);

  const setCourtCount = useCallback(async (batchId: BatchId, count: number) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    await supabase.from('batches').update({ num_courts: count }).eq('id', dbBatchId);

    const { data: existingCourts } = await supabase
      .from('courts')
      .select('id,court_number,status')
      .eq('batch_id', dbBatchId)
      .order('court_number', { ascending: true });

    const courts = existingCourts ?? [];
    if (courts.length < count) {
      const inserts = [];
      for (let number = courts.length + 1; number <= count; number += 1) {
        inserts.push({
          batch_id: dbBatchId,
          court_number: number,
          status: 'free' as const,
        });
      }

      if (inserts.length > 0) {
        await supabase.from('courts').insert(inserts);
      }
    }

    if (courts.length > count) {
      const removable = courts.filter((court) => court.court_number > count && court.status === 'free').map((court) => court.id);
      if (removable.length > 0) {
        await supabase.from('courts').delete().in('id', removable);
      }
    }

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

  const addSinglePlayer = useCallback(async (batchId: BatchId, name: string, gender: Gender) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId || !name.trim()) {
      return;
    }

    await supabase.from('players').insert({
      batch_id: dbBatchId,
      name: name.trim(),
      gender,
      status: 'break',
      created_at: nowIso(),
    });

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

  const addBulk = useCallback(async (batchId: BatchId, names: string[], gender: Gender) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId || names.length === 0) {
      return;
    }

    await supabase.from('players').insert(
      names
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => ({
          batch_id: dbBatchId,
          name: value,
          gender,
          status: 'break',
          created_at: nowIso(),
        }))
    );

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

  const updatePlayer = useCallback(async (batchId: BatchId, playerId: string, name: string, gender: Gender) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId || !name.trim()) {
      return;
    }

    await supabase
      .from('players')
      .update({
        name: name.trim(),
        gender,
      })
      .eq('id', playerId)
      .eq('batch_id', dbBatchId);

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

  const deletePlayer = useCallback(async (batchId: BatchId, playerId: string) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const player = batch.players.find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }

    const isActive = batch.courts.some(
      (court) => court.status === 'live' && court.sourceUnitIds.includes(playerId),
    );
    if (isActive) {
      return;
    }

    if (player.pairId) {
      const pair = batch.pairs.find((entry) => entry.id === player.pairId);
      const mateId = pair?.playerIds.find((id) => id !== playerId);
      if (mateId) {
        await supabase
          .from('players')
          .update({ pair_id: null })
          .eq('id', mateId)
          .eq('batch_id', dbBatchId);
      }
    }

    await supabase.from('players').delete().eq('id', playerId).eq('batch_id', dbBatchId);
    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const prioritizePlayersForQueue = useCallback(async (batchId: BatchId, playerIds: string[]) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId || playerIds.length === 0) {
      return;
    }

    const uniqueIds = Array.from(new Set(playerIds));
    const batchPlayers = snapshot.batches[batchId].players;
    const earliestCreatedAt = batchPlayers.reduce((earliest, player) => {
      const value = new Date(player.createdAt).getTime();
      return Number.isFinite(value) ? Math.min(earliest, value) : earliest;
    }, Date.now());

    const base = earliestCreatedAt - uniqueIds.length * 3000;

    for (let index = 0; index < uniqueIds.length; index += 1) {
      const playerId = uniqueIds[index];
      const createdAt = new Date(base + index * 1000).toISOString();
      await supabase
        .from('players')
        .update({
          created_at: createdAt,
          status: 'checked-in',
        })
        .eq('id', playerId)
        .eq('batch_id', dbBatchId);
    }

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const toggleBreak = useCallback(async (batchId: BatchId, playerId: string) => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const player = batch.players.find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }

    const nextStatus = player.status === 'break' ? 'checked-in' : 'break';
    await supabase.from('players').update({ status: nextStatus }).eq('id', playerId);

    if (player.pairId) {
      const pair = batch.pairs.find((entry) => entry.id === player.pairId);
      const mateId = pair?.playerIds.find((id) => id !== playerId);
      if (mateId) {
        await supabase.from('players').update({ status: nextStatus }).eq('id', mateId);
      }
    }

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches]);

  const lockSelectedPair = useCallback(async (_batchId: BatchId, firstPlayerId: string, secondPlayerId: string) => {
    const supabase = supabaseRef.current;
    if (!supabase || firstPlayerId === secondPlayerId) {
      return;
    }

    await Promise.all([
      supabase.from('players').update({ pair_id: secondPlayerId }).eq('id', firstPlayerId),
      supabase.from('players').update({ pair_id: firstPlayerId }).eq('id', secondPlayerId),
    ]);

    await loadFromDatabase();
  }, [loadFromDatabase]);

  const unlockSelectedPair = useCallback(async (batchId: BatchId, pairId: string) => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const pair = batch.pairs.find((entry) => entry.id === pairId);
    const ids = pair?.playerIds ?? [];
    if (ids.length !== 2) {
      return;
    }

    await supabase.from('players').update({ pair_id: null }).in('id', ids);
    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches]);

  const moveQueueUnit = useCallback(async (batchId: BatchId, unitId: string, direction: 'up' | 'down') => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const currentOrder = resolveQueueUnits(batch);
    const index = currentOrder.findIndex((entry) => entry.id === unitId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= currentOrder.length) {
      return;
    }

    const nextOrder = currentOrder.slice();
    const [moved] = nextOrder.splice(index, 1);
    nextOrder.splice(targetIndex, 0, moved);

    const base = Date.now() - nextOrder.length * 2000;
    for (let i = 0; i < nextOrder.length; i += 1) {
      const createdAt = new Date(base + i * 2000).toISOString();
      await supabase
        .from('players')
        .update({ created_at: createdAt })
        .in('id', nextOrder[i].playerIds)
        .eq('batch_id', dbBatchId);
    }

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const refreshQueueProcess = useCallback(async (batchId: BatchId) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const queueUnits = resolveQueueUnits(batch);
    const base = Date.now() - queueUnits.length * 2000;

    for (let i = 0; i < queueUnits.length; i += 1) {
      const createdAt = new Date(base + i * 2000).toISOString();
      await supabase
        .from('players')
        .update({ created_at: createdAt })
        .in('id', queueUnits[i].playerIds)
        .eq('batch_id', dbBatchId);
    }

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const cancelMatch = useCallback(async (batchId: BatchId, courtId: string) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const court = snapshot.batches[batchId].courts.find((entry) => entry.id === courtId);
    const matchId = court?.matchId;
    if (!court || !matchId) {
      return;
    }

    const { data: matchRow } = await supabase
      .from('matches')
      .select('team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id')
      .eq('id', matchId)
      .single();

    const playerIds = [
      matchRow?.team1_player1_id,
      matchRow?.team1_player2_id,
      matchRow?.team2_player1_id,
      matchRow?.team2_player2_id,
    ].filter(Boolean) as string[];

    if (playerIds.length > 0) {
      const base = Date.now() - playerIds.length * 1000;
      for (let i = 0; i < playerIds.length; i += 1) {
        await supabase
          .from('players')
          .update({
            created_at: new Date(base + i * 1000).toISOString(),
            status: 'checked-in',
          })
          .eq('id', playerIds[i])
          .eq('batch_id', dbBatchId);
      }
    }

    await Promise.all([
      supabase.from('matches').delete().eq('id', matchId),
      supabase.from('match_history').delete().eq('match_id', matchId),
      supabase.from('courts').update({
        status: 'free',
        current_match_id: null,
        start_time: null,
      }).eq('id', courtId),
    ]);

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const startMatchOnCourt = useCallback(async (batchId: BatchId, courtId: string, mode: MatchMode, selectedPlayers?: CustomMatchSelection) => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    const workingBatch = snapshot.batches[batchId];
    const match = findNextMatch(workingBatch, mode, selectedPlayers);
    if (!match) {
      return;
    }

    const payload = {
      batch_id: withBatchDbId(batchId),
      court_id: courtId,
      team1_player1_id: match.teamA[0] ?? null,
      team1_player2_id: match.teamA[1] ?? null,
      team2_player1_id: match.teamB[0] ?? null,
      team2_player2_id: match.teamB[1] ?? null,
      start_time: nowIso(),
      status: 'active',
      score_team1: 0,
      score_team2: 0,
      is_pair_match: mode === 'custom' ? false : match.sourceUnitIds.some((id) => id.startsWith('pair-')),
    };

    const { data: inserted } = await supabase.from('matches').insert(payload).select('id').single();
    if (!inserted?.id) {
      return;
    }

    await supabase.from('courts').update({
      status: 'occupied',
      current_match_id: inserted.id,
      start_time: nowIso(),
    }).eq('id', courtId);

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const completeMatch = useCallback(async (batchId: BatchId, courtId: string, scoreA: number, scoreB: number) => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    const court = snapshot.batches[batchId].courts.find((entry) => entry.id === courtId);
    if (!court?.matchId) {
      return;
    }

    const matchId = court.matchId;
    const winner = scoreToWinner(scoreA, scoreB);

    const { data: matchRow } = await supabase
      .from('matches')
      .select('team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id')
      .eq('id', matchId)
      .single();

    await supabase.from('matches').update({
      status: 'completed',
      end_time: nowIso(),
      score_team1: scoreA,
      score_team2: scoreB,
      winner_team: winner,
    }).eq('id', matchId);

    const playerIds = [
      matchRow?.team1_player1_id,
      matchRow?.team1_player2_id,
      matchRow?.team2_player1_id,
      matchRow?.team2_player2_id,
    ].filter(Boolean) as string[];

    if (playerIds.length > 0) {
      await supabase.from('players').update({ created_at: nowIso(), status: 'checked-in' }).in('id', playerIds);
    }

    await supabase.from('courts').update({
      status: 'free',
      current_match_id: null,
      start_time: null,
    }).eq('id', courtId);

    const players = snapshot.batches[batchId].players;
    const toName = (id: string | null | undefined) => players.find((entry) => entry.id === id)?.name ?? null;

    await supabase.from('match_history').delete().eq('match_id', matchId);

    await supabase.from('match_history').insert({
      batch_id: withBatchDbId(batchId),
      match_id: matchId,
      court_number: Number(court.label.replace('Court ', '')),
      team1_player1_name: toName(matchRow?.team1_player1_id),
      team1_player2_name: toName(matchRow?.team1_player2_id),
      team2_player1_name: toName(matchRow?.team2_player1_id),
      team2_player2_name: toName(matchRow?.team2_player2_id),
      score_team1: scoreA,
      score_team2: scoreB,
      winner_team: winner,
      played_at: nowIso(),
    });

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const editScore = useCallback(async (batchId: BatchId, matchId: string, scoreA: number | null, scoreB: number | null) => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    const winner = scoreToWinner(scoreA, scoreB);

    await Promise.all([
      supabase.from('matches').update({
        score_team1: scoreA,
        score_team2: scoreB,
        winner_team: winner,
      }).eq('id', matchId),
      supabase.from('match_history').update({
        score_team1: scoreA,
        score_team2: scoreB,
        winner_team: winner,
      }).eq('match_id', matchId),
      supabase.from('match_history').update({
        score_team1: scoreA,
        score_team2: scoreB,
        winner_team: winner,
      }).eq('id', matchId),
    ]);

    await loadFromDatabase();
  }, [loadFromDatabase]);

  const removeQueueMatch = useCallback(async (batchId: BatchId, sourceUnitIds: string[]) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId || sourceUnitIds.length === 0) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const queueUnits = resolveQueueUnits(batch);
    const unitById = new Map(queueUnits.map((unit) => [unit.id, unit]));
    const playerIds = new Set<string>();

    for (const unitId of sourceUnitIds) {
      const unit = unitById.get(unitId);
      if (!unit) {
        const directPlayer = batch.players.find((entry) => entry.id === unitId);
        if (directPlayer) {
          playerIds.add(directPlayer.id);
        }
        continue;
      }
      unit.playerIds.forEach((id) => playerIds.add(id));
    }

    if (playerIds.size === 0) {
      return;
    }

    const ids = Array.from(playerIds);
    const base = Date.now();
    for (let i = 0; i < ids.length; i += 1) {
      await supabase
        .from('players')
        .update({
          status: 'checked-in',
          created_at: new Date(base + i * 1000).toISOString(),
        })
        .eq('id', ids[i])
        .eq('batch_id', dbBatchId);
    }

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const fillIdleCourts = useCallback(async (batchId: BatchId) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const initialBatch = snapshot.batches[batchId];
    const idleCourts = initialBatch.courts.filter((court) => court.status === 'idle');
    if (idleCourts.length === 0) {
      return;
    }

    const workingBatch = structuredClone(initialBatch);

    for (const court of idleCourts) {
      const next = findNextMatch(workingBatch, workingBatch.activeMode);
      if (!next) {
        break;
      }

      const startedAt = nowIso();
      const { data: inserted } = await supabase
        .from('matches')
        .insert({
          batch_id: dbBatchId,
          court_id: court.id,
          team1_player1_id: next.teamA[0] ?? null,
          team1_player2_id: next.teamA[1] ?? null,
          team2_player1_id: next.teamB[0] ?? null,
          team2_player2_id: next.teamB[1] ?? null,
          start_time: startedAt,
          status: 'active',
          score_team1: 0,
          score_team2: 0,
          is_pair_match: next.sourceUnitIds.some((id) => id.startsWith('pair-')),
        })
        .select('id')
        .single();

      if (!inserted?.id) {
        continue;
      }

      await supabase
        .from('courts')
        .update({
          status: 'occupied',
          current_match_id: inserted.id,
          start_time: startedAt,
        })
        .eq('id', court.id)
        .eq('batch_id', dbBatchId);

      workingBatch.queueOrder = workingBatch.queueOrder.filter(
        (id) => !next.sourceUnitIds.includes(id),
      );
    }

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const signOut = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setAuthEmail(null);
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabaseRef.current = supabase;

    void loadFromDatabase();

    const channel = supabase
      .channel('courtside-normalized')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batches' }, () => void loadFromDatabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => void loadFromDatabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courts' }, () => void loadFromDatabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void loadFromDatabase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_history' }, () => void loadFromDatabase())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadFromDatabase]);

  const batchCounts = useMemo(() => getBatchCounts(activeBatch), [activeBatch]);
  const queueUnits = useMemo(() => resolveQueueUnits(activeBatch), [activeBatch]);

  return {
    snapshot,
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
    updatePlayer,
    deletePlayer,
    prioritizePlayersForQueue,
    toggleBreak,
    lockSelectedPair,
    unlockSelectedPair,
    moveQueueUnit,
    removeQueueMatch,
    refreshQueueProcess,
    startMatchOnCourt,
    completeMatch,
    cancelMatch,
    editScore,
    fillIdleCourts,
    signOut,
  };
}
