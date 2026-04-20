'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  createEmptyBatchSnapshot,
  createEmptyCourtsideSnapshot,
  getBatchCounts,
  getPlayerStats,
  resolveQueueUnits,
} from '@/lib/courtside-engine';
import type {
  BatchId,
  BatchSnapshot,
  CustomMatchSelection,
  Gender,
  MatchPreview,
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
  status: 'queued' | 'playing' | 'active' | 'completed';
  match_type?: 'custom' | 'mixed';
}

interface MatchHistoryRow {
  id: string;
  batch_id: string;
  original_match_id?: string | null;
  match_id?: string | null;
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

function isQueuedMatchStatus(status: MatchRow['status']) {
  return status === 'queued' || status === 'active';
}

function isPlayingMatchStatus(status: MatchRow['status']) {
  return status === 'playing' || status === 'active';
}

function historyMatchId(row: MatchHistoryRow) {
  return row.original_match_id ?? row.match_id ?? null;
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

function toMatchPreview(match: MatchRow, playersById: Map<string, Player>, index: number): MatchPreview | null {
  const teamAIds = [match.team1_player1_id, match.team1_player2_id].filter(Boolean) as string[];
  const teamBIds = [match.team2_player1_id, match.team2_player2_id].filter(Boolean) as string[];
  const playerIds = [...teamAIds, ...teamBIds];
  if (playerIds.length !== 4) {
    return null;
  }

  return {
    id: match.id,
    courtId: match.id,
    courtLabel: `Match ${index + 1}`,
    teamA: teamAIds.map((id) => playersById.get(id)?.name ?? 'Unknown'),
    teamB: teamBIds.map((id) => playersById.get(id)?.name ?? 'Unknown'),
    playerIds,
    sourceUnitIds: playerIds,
    mode: (match.match_type ?? 'mixed') as MatchMode,
  };
}

function generateTeamings(ids: [string, string, string, string]) {
  return [
    [[ids[0], ids[1]], [ids[2], ids[3]]],
    [[ids[0], ids[2]], [ids[1], ids[3]]],
    [[ids[0], ids[3]], [ids[1], ids[2]]],
  ] as Array<[[string, string], [string, string]]>;
}

function chooseFairReadyMatch(
  availablePlayers: Player[],
  stats: ReturnType<typeof getPlayerStats>,
): { teamA: [string, string]; teamB: [string, string] } | null {
  if (availablePlayers.length < 4) {
    return null;
  }

  const ranked = [...availablePlayers].sort((a, b) => {
    const aStats = stats.get(a.id);
    const bStats = stats.get(b.id);
    const gameDiff = (aStats?.gamesPlayed ?? 0) - (bStats?.gamesPlayed ?? 0);
    if (gameDiff !== 0) {
      return gameDiff;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

  const pool = ranked.slice(0, Math.min(16, ranked.length));
  let best: { score: number; teamA: [string, string]; teamB: [string, string] } | null = null;
  let bestFallback: { score: number; teamA: [string, string]; teamB: [string, string] } | null = null;

  for (let i = 0; i < pool.length - 3; i += 1) {
    for (let j = i + 1; j < pool.length - 2; j += 1) {
      for (let k = j + 1; k < pool.length - 1; k += 1) {
        for (let l = k + 1; l < pool.length; l += 1) {
          const quartet = [pool[i], pool[j], pool[k], pool[l]] as [Player, Player, Player, Player];
          const maleCount = quartet.filter((player) => player.gender === 'M').length;
          const mixedEligible = maleCount === 2;
          const ids = quartet.map((player) => player.id) as [string, string, string, string];
          const gamesSum = ids.reduce((sum, id) => sum + (stats.get(id)?.gamesPlayed ?? 0), 0);

          for (const [teamA, teamB] of generateTeamings(ids)) {
            const teamAStatsA = stats.get(teamA[0]);
            const teamAStatsB = stats.get(teamA[1]);
            const teamBStatsA = stats.get(teamB[0]);
            const teamBStatsB = stats.get(teamB[1]);

            const teammateRepeat =
              Number(teamAStatsA?.recentTeammates.includes(teamA[1])) +
              Number(teamBStatsA?.recentTeammates.includes(teamB[1]));

            const opponentRepeat =
              Number(teamAStatsA?.recentOpponents.includes(teamB[0])) +
              Number(teamAStatsA?.recentOpponents.includes(teamB[1])) +
              Number(teamAStatsB?.recentOpponents.includes(teamB[0])) +
              Number(teamAStatsB?.recentOpponents.includes(teamB[1]));

            const teamAGames = (teamAStatsA?.gamesPlayed ?? 0) + (teamAStatsB?.gamesPlayed ?? 0);
            const teamBGames = (teamBStatsA?.gamesPlayed ?? 0) + (teamBStatsB?.gamesPlayed ?? 0);
            const teamImbalance = Math.abs(teamAGames - teamBGames);

            const score = gamesSum * 100 + teammateRepeat * 40 + opponentRepeat * 15 + teamImbalance * 10;
            const candidate = {
              score,
              teamA,
              teamB,
            };

            if (!bestFallback || candidate.score < bestFallback.score) {
              bestFallback = candidate;
            }

            if (!mixedEligible) {
              continue;
            }

            const teamAMixed = pool.find((player) => player.id === teamA[0])?.gender !== pool.find((player) => player.id === teamA[1])?.gender;
            const teamBMixed = pool.find((player) => player.id === teamB[0])?.gender !== pool.find((player) => player.id === teamB[1])?.gender;
            if (!teamAMixed || !teamBMixed) {
              continue;
            }

            if (!best || candidate.score < best.score) {
              best = candidate;
            }
          }
        }
      }
    }
  }

  const picked = best ?? bestFallback;
  if (!picked) {
    return null;
  }

  return {
    teamA: picked.teamA,
    teamB: picked.teamB,
  };
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

  const liveMatches = input.matches.filter((row) => isPlayingMatchStatus(row.status) && row.court_id);
  const queuedMatches = input.matches
    .filter((row) => isQueuedMatchStatus(row.status) && !row.court_id)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id.localeCompare(b.id));
  const activePlayerIds = new Set<string>();
  for (const match of liveMatches) {
    [match.team1_player1_id, match.team1_player2_id, match.team2_player1_id, match.team2_player2_id].forEach((id) => {
      if (id) {
        activePlayerIds.add(id);
      }
    });
  }

  for (const match of queuedMatches) {
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
      const fallbackLive = court.status === 'occupied';
      const ids = liveMatch
        ? [liveMatch.team1_player1_id, liveMatch.team1_player2_id, liveMatch.team2_player1_id, liveMatch.team2_player2_id].filter(Boolean) as string[]
        : [];

      const teamAIds = liveMatch ? [liveMatch.team1_player1_id, liveMatch.team1_player2_id].filter(Boolean) as string[] : [];
      const teamBIds = liveMatch ? [liveMatch.team2_player1_id, liveMatch.team2_player2_id].filter(Boolean) as string[] : [];

      return {
        id: court.id,
        label: `Court ${court.court_number}`,
        status: liveMatch || fallbackLive ? ('live' as const) : ('idle' as const),
        matchId: liveMatch?.id ?? court.current_match_id,
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

  const liveHistory = liveMatches.map((match) => {
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

  const historyByMatchId = new Map(
    input.histories
      .map((row) => [historyMatchId(row), row] as const)
      .filter(([id]) => Boolean(id))
      .map(([id, row]) => [id as string, row]),
  );

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
    queuedMatches: queuedMatches
      .map((match, index) => toMatchPreview(match, playersById, index))
      .filter(Boolean) as MatchPreview[],
    courts,
    history: [...liveHistory, ...completedHistory],
    lastUpdated: nowIso(),
  };
}

export function useCourtsideBoard(initialBatchId: BatchId = 1) {
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const batchDbIdRef = useRef<Record<BatchId, string | null>>({ 1: null, 2: null });
  const supportsMatchTypeRef = useRef(true);
  const historyMatchIdColumnRef = useRef<'original_match_id' | 'match_id'>('original_match_id');

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

    const isFirstLoad = !isReady;

    const [
      { data: sessionData },
      { data: batchesData, error: batchesError },
      { data: playersData, error: playersError },
      { data: courtsData, error: courtsError },
    ] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from('batches').select('id,name,num_courts,created_at').order('created_at', { ascending: true }),
      supabase.from('players').select('id,batch_id,name,gender,status,pair_id,created_at').order('created_at', { ascending: true }),
      supabase.from('courts').select('id,batch_id,court_number,status,current_match_id,start_time').order('court_number', { ascending: true }),
    ]);

    let historyData: MatchHistoryRow[] | null = null;
    let historyError: { code?: string } | null = null;

    if (historyMatchIdColumnRef.current === 'original_match_id') {
      const withOriginal = await supabase
        .from('match_history')
        .select('id,batch_id,original_match_id,court_number,team1_player1_name,team1_player2_name,team2_player1_name,team2_player2_name,score_team1,score_team2,winner_team,played_at,notes')
        .order('played_at', { ascending: false });
      historyData = (withOriginal.data as MatchHistoryRow[] | null) ?? null;
      historyError = withOriginal.error as { code?: string } | null;

      if (historyError?.code === '42703') {
        historyMatchIdColumnRef.current = 'match_id';
        const fallback = await supabase
          .from('match_history')
          .select('id,batch_id,match_id,court_number,team1_player1_name,team1_player2_name,team2_player1_name,team2_player2_name,score_team1,score_team2,winner_team,played_at,notes')
          .order('played_at', { ascending: false });
        historyData = (fallback.data as MatchHistoryRow[] | null) ?? null;
        historyError = fallback.error as { code?: string } | null;
      }
    } else {
      const withLegacy = await supabase
        .from('match_history')
        .select('id,batch_id,match_id,court_number,team1_player1_name,team1_player2_name,team2_player1_name,team2_player2_name,score_team1,score_team2,winner_team,played_at,notes')
        .order('played_at', { ascending: false });
      historyData = (withLegacy.data as MatchHistoryRow[] | null) ?? null;
      historyError = withLegacy.error as { code?: string } | null;

      if (historyError?.code === '42703') {
        historyMatchIdColumnRef.current = 'original_match_id';
        const fallback = await supabase
          .from('match_history')
          .select('id,batch_id,original_match_id,court_number,team1_player1_name,team1_player2_name,team2_player1_name,team2_player2_name,score_team1,score_team2,winner_team,played_at,notes')
          .order('played_at', { ascending: false });
        historyData = (fallback.data as MatchHistoryRow[] | null) ?? null;
        historyError = fallback.error as { code?: string } | null;
      }
    }

    let matchesData: MatchRow[] | null = null;
    let matchesError: { code?: string } | null = null;

    if (supportsMatchTypeRef.current) {
      const withType = await supabase
        .from('matches')
        .select('id,batch_id,court_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,end_time,score_team1,score_team2,winner_team,status,match_type');
      matchesData = (withType.data as MatchRow[] | null) ?? null;
      matchesError = withType.error as { code?: string } | null;
      if (matchesError?.code === '42703') {
        supportsMatchTypeRef.current = false;
        const fallback = await supabase
          .from('matches')
          .select('id,batch_id,court_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,end_time,score_team1,score_team2,winner_team,status');
        matchesData = (fallback.data as MatchRow[] | null) ?? null;
        matchesError = fallback.error as { code?: string } | null;
      }
    } else {
      const fallback = await supabase
        .from('matches')
        .select('id,batch_id,court_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,end_time,score_team1,score_team2,winner_team,status');
      matchesData = (fallback.data as MatchRow[] | null) ?? null;
      matchesError = fallback.error as { code?: string } | null;
    }

    if (batchesError || playersError || courtsError || matchesError || historyError) {
      setSyncStatus('offline');
      setIsReady(true);
      return;
    }

    if (sessionData.session?.user?.email) {
      setAuthEmail(sessionData.session.user.email);
    }

    let batches = (batchesData ?? []) as BatchRow[];
    const players = (playersData ?? []) as PlayerRow[];
    const courts = (courtsData ?? []) as CourtRow[];
    const matches = (matchesData ?? []) as MatchRow[];
    const histories = (historyData ?? []) as MatchHistoryRow[];

    if (batches.length === 0) {
      const { data: existingEvent } = await supabase.from('events').select('id').limit(1).maybeSingle();
      let eventId = existingEvent?.id as string | undefined;

      if (!eventId) {
        const { data: createdEvent } = await supabase
          .from('events')
          .insert({
            name: 'Courtside Tropa',
            tagline: 'Just One More Game... with Tropa',
            date: 'May 1, 2026',
            venue: 'Paddle Up! Davao (Buhangin)',
          })
          .select('id')
          .single();
        eventId = createdEvent?.id as string | undefined;
      }

      if (eventId) {
        await supabase.from('batches').insert([
          {
            event_id: eventId,
            name: 'Batch 1',
            start_time: '8:00 AM - 12:00 NN',
            end_time: '8:00 AM - 12:00 NN',
            num_courts: 5,
          },
          {
            event_id: eventId,
            name: 'Batch 2',
            start_time: '1:00 PM - 5:00 PM',
            end_time: '1:00 PM - 5:00 PM',
            num_courts: 5,
          },
        ]);
      }

      const { data: refreshedBatches, error: refreshedBatchesError } = await supabase
        .from('batches')
        .select('id,name,num_courts,created_at')
        .order('created_at', { ascending: true });

      if (refreshedBatchesError) {
        setSyncStatus('offline');
        setIsReady(true);
        return;
      }

      batches = (refreshedBatches ?? []) as BatchRow[];
    }

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
    const courtsToBootstrap: Array<{
      batch_id: string;
      court_number: number;
      status: 'free';
      current_match_id: null;
      start_time: null;
    }> = [];

    for (const batchId of [1, 2] as BatchId[]) {
      const row = byLogicalBatch.get(batchId);
      if (!row) {
        next.batches[batchId] = createEmptyBatchSnapshot(batchId);
        continue;
      }

      batchDbIdRef.current[batchId] = row.id;
      const batchCourts = courts.filter((entry) => entry.batch_id === row.id);
      if (batchCourts.length === 0 && (row.num_courts ?? 0) > 0) {
        courtsToBootstrap.push(
          ...Array.from({ length: row.num_courts ?? 0 }, (_, index) => ({
            batch_id: row.id,
            court_number: index + 1,
            status: 'free' as const,
            current_match_id: null,
            start_time: null,
          })),
        );
      }

      next.batches[batchId] = normalizeSnapshot({
        batchId,
        batchRow: row,
        players: players.filter((entry) => entry.batch_id === row.id),
        courts: batchCourts.length > 0
          ? batchCourts
          : Array.from({ length: row.num_courts ?? 0 }, (_, index) => ({
              id: `synthetic-${row.id}-${index + 1}`,
              batch_id: row.id,
              court_number: index + 1,
              status: 'free' as const,
              current_match_id: null,
              start_time: null,
            })),
        matches: matches.filter((entry) => entry.batch_id === row.id),
        histories: histories.filter((entry) => entry.batch_id === row.id),
        activeMode: activeModes[batchId],
      });
    }

    if (courtsToBootstrap.length > 0) {
      const { error: bootstrapError } = await supabase.from('courts').insert(courtsToBootstrap);
      if (bootstrapError) {
        console.error('Court bootstrap failed', bootstrapError);
      }
    }

    const hasData = (batchId: BatchId) => {
      const batch = next.batches[batchId];
      return batch.players.length > 0 || batch.courts.some((court) => court.status === 'live') || batch.queueOrder.length > 0 || batch.history.length > 0;
    };

    const nextActiveBatchId =
      (isFirstLoad && !hasData(initialBatchId)
        ? ([1, 2] as BatchId[]).find((batchId) => hasData(batchId)) ?? initialBatchId
        : initialBatchId);

    setSnapshot((current) => ({
      ...next,
      activeBatchId: isFirstLoad ? nextActiveBatchId : current.activeBatchId,
      lastUpdated: nowIso(),
    }));
    setSyncStatus('online');
    setIsReady(true);
  }, [activeModes, isReady, initialBatchId]);

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
    let dbBatchId = withBatchDbId(batchId);
    if (!supabase) {
      return;
    }

    if (!dbBatchId) {
      await loadFromDatabase();
      dbBatchId = withBatchDbId(batchId);
    }

    if (!dbBatchId) {
      console.error('Set court count failed: missing batch mapping', { batchId });
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
    let dbBatchId = withBatchDbId(batchId);
    if (!supabase || !name.trim()) {
      return;
    }

    if (!dbBatchId) {
      await loadFromDatabase();
      dbBatchId = withBatchDbId(batchId);
    }

    if (!dbBatchId) {
      console.error('Add player failed: missing batch mapping', { batchId, name });
      return;
    }

    const { error } = await supabase.from('players').insert({
      batch_id: dbBatchId,
      name: name.trim(),
      gender,
      status: 'break',
      created_at: nowIso(),
    });

    if (error) {
      console.error('Add player failed', error);
      return;
    }

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

  const addBulk = useCallback(async (batchId: BatchId, names: string[], gender: Gender) => {
    const supabase = supabaseRef.current;
    let dbBatchId = withBatchDbId(batchId);
    if (!supabase || names.length === 0) {
      return;
    }

    if (!dbBatchId) {
      await loadFromDatabase();
      dbBatchId = withBatchDbId(batchId);
    }

    if (!dbBatchId) {
      console.error('Bulk add players failed: missing batch mapping', { batchId, count: names.length });
      return;
    }

    const { error } = await supabase.from('players').insert(
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

    if (error) {
      console.error('Bulk add players failed', error);
      return;
    }

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

  const ensureReadyMatches = useCallback(async (batchId: BatchId, targetReadyMatches = 6) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const { data: queuedRows } = await supabase
      .from('matches')
      .select('id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('start_time', { ascending: true });

    const readyRows = queuedRows ?? [];
    if (readyRows.length >= targetReadyMatches) {
      return;
    }

    const reserved = new Set<string>();
    for (const row of readyRows) {
      [row.team1_player1_id, row.team1_player2_id, row.team2_player1_id, row.team2_player2_id].forEach((id) => {
        if (id) {
          reserved.add(id);
        }
      });
    }

    for (const court of batch.courts) {
      if (court.status === 'live') {
        court.sourceUnitIds.forEach((id) => reserved.add(id));
      }
    }

    const stats = getPlayerStats(batch);
    const available = batch.players.filter((player) => player.status === 'checked-in' && !reserved.has(player.id));
    const needed = targetReadyMatches - readyRows.length;
    const base = Date.now();

    for (let index = 0; index < needed; index += 1) {
      const next = chooseFairReadyMatch(available, stats);
      if (!next) {
        break;
      }

      const payload: {
        batch_id: string;
        court_id: null;
        team1_player1_id: string;
        team1_player2_id: string;
        team2_player1_id: string;
        team2_player2_id: string;
        start_time: string;
        status: 'queued';
        score_team1: number;
        score_team2: number;
        match_type?: 'mixed';
      } = {
        batch_id: dbBatchId,
        court_id: null,
        team1_player1_id: next.teamA[0],
        team1_player2_id: next.teamA[1],
        team2_player1_id: next.teamB[0],
        team2_player2_id: next.teamB[1],
        start_time: new Date(base + index * 1000).toISOString(),
        status: 'queued',
        score_team1: 0,
        score_team2: 0,
      };

      if (supportsMatchTypeRef.current) {
        payload.match_type = 'mixed';
      }

      await supabase.from('matches').insert(payload);

      const used = new Set([...next.teamA, ...next.teamB]);
      for (let i = available.length - 1; i >= 0; i -= 1) {
        if (used.has(available[i].id)) {
          available.splice(i, 1);
        }
      }
    }

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const moveQueueUnit = useCallback(async (batchId: BatchId, matchId: string, direction: 'up' | 'down') => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const { data: queuedRows } = await supabase
      .from('matches')
      .select('id,start_time')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('start_time', { ascending: true });

    const queue = (queuedRows ?? []).slice();
    const index = queue.findIndex((row) => row.id === matchId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= queue.length) {
      return;
    }

    const [moved] = queue.splice(index, 1);
    queue.splice(targetIndex, 0, moved);

    const base = Date.now() - queue.length * 1000;
    for (let i = 0; i < queue.length; i += 1) {
      await supabase
        .from('matches')
        .update({ start_time: new Date(base + i * 1000).toISOString() })
        .eq('id', queue[i].id)
        .eq('batch_id', dbBatchId);
    }

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

  const refreshQueueProcess = useCallback(async (batchId: BatchId) => {
    await ensureReadyMatches(batchId, 6);
  }, [ensureReadyMatches]);

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

    const historyMatchColumn = historyMatchIdColumnRef.current;

    await Promise.all([
      supabase.from('matches').delete().eq('id', matchId),
      supabase.from('match_history').delete().eq(historyMatchColumn, matchId),
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
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    if (selectedPlayers && selectedPlayers.playerIds.length === 4) {
      const payload: {
        batch_id: string;
        court_id: string;
        team1_player1_id: string | null;
        team1_player2_id: string | null;
        team2_player1_id: string | null;
        team2_player2_id: string | null;
        start_time: string;
        status: 'playing';
        score_team1: number;
        score_team2: number;
        match_type?: 'custom';
      } = {
        batch_id: dbBatchId,
        court_id: courtId,
        team1_player1_id: selectedPlayers.playerIds[0] ?? null,
        team1_player2_id: selectedPlayers.playerIds[1] ?? null,
        team2_player1_id: selectedPlayers.playerIds[2] ?? null,
        team2_player2_id: selectedPlayers.playerIds[3] ?? null,
        start_time: nowIso(),
        status: 'playing',
        score_team1: 0,
        score_team2: 0,
      };

      if (supportsMatchTypeRef.current) {
        payload.match_type = 'custom';
      }

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
      return;
    }

    const { data: queuedRows } = await supabase
      .from('matches')
      .select('id')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('start_time', { ascending: true })
      .limit(1);

    const nextReady = queuedRows?.[0];
    if (!nextReady) {
      return;
    }

    await supabase
      .from('matches')
      .update({
        court_id: courtId,
        status: 'playing',
        start_time: nowIso(),
      })
      .eq('id', nextReady.id)
      .eq('batch_id', dbBatchId)
      .is('court_id', null);

    await supabase.from('courts').update({
      status: 'occupied',
      current_match_id: nextReady.id,
      start_time: nowIso(),
    }).eq('id', courtId);

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

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
      const base = Date.now();
      for (let i = 0; i < playerIds.length; i += 1) {
        await supabase
          .from('players')
          .update({
            created_at: new Date(base + i * 1000).toISOString(),
            status: 'checked-in',
          })
          .eq('id', playerIds[i]);
      }
    }

    await supabase.from('courts').update({
      status: 'free',
      current_match_id: null,
      start_time: null,
    }).eq('id', courtId);

    const players = snapshot.batches[batchId].players;
    const toName = (id: string | null | undefined) => players.find((entry) => entry.id === id)?.name ?? null;

    const historyMatchColumn = historyMatchIdColumnRef.current;

    await supabase.from('match_history').delete().eq(historyMatchColumn, matchId);

    await supabase.from('match_history').insert({
      batch_id: withBatchDbId(batchId),
      [historyMatchColumn]: matchId,
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

    const historyMatchColumn = historyMatchIdColumnRef.current;

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
      }).eq(historyMatchColumn, matchId),
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

    const matchId = sourceUnitIds[0];
    const { data: row } = await supabase
      .from('matches')
      .select('team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id')
      .eq('id', matchId)
      .eq('batch_id', dbBatchId)
      .single();

    const ids = [row?.team1_player1_id, row?.team1_player2_id, row?.team2_player1_id, row?.team2_player2_id].filter(Boolean) as string[];
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

    await supabase
      .from('matches')
      .delete()
      .eq('id', matchId)
      .eq('batch_id', dbBatchId)
      .is('court_id', null);

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

  const enqueueCustomMatch = useCallback(async (batchId: BatchId, playerIds: string[], placement: 'top' | 'bottom') => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId || playerIds.length !== 4) {
      return;
    }

    // VALIDATION: Check for duplicate players
    const uniqueIds = Array.from(new Set(playerIds));
    if (uniqueIds.length !== 4) {
      console.error('Custom match validation failed: Duplicate players detected');
      return;
    }

    const batch = snapshot.batches[batchId];

    // VALIDATION: Get live court player IDs
    const liveIds = new Set(batch.courts.filter((court) => court.status === 'live').flatMap((court) => court.sourceUnitIds));

    // VALIDATION: Get all queued player IDs (including custom and mixed)
    const { data: queuedRows } = await supabase
      .from('matches')
      .select('id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('start_time', { ascending: true });

    const queuedIds = new Set<string>();
    for (const row of queuedRows ?? []) {
      [row.team1_player1_id, row.team1_player2_id, row.team2_player1_id, row.team2_player2_id].forEach((id) => {
        if (id) {
          queuedIds.add(id);
        }
      });
    }

    // VALIDATION: Check each player
    const playerMap = new Map(batch.players.map((player) => [player.id, player]));
    const validationErrors: string[] = [];
    
    for (const playerId of uniqueIds) {
      const player = playerMap.get(playerId);
      
      if (!player) {
        validationErrors.push(`Player ${playerId} not found`);
        continue;
      }
      
      if (player.status !== 'checked-in') {
        validationErrors.push(`Player ${player.name} is not checked in`);
        continue;
      }
      
      if (liveIds.has(playerId)) {
        validationErrors.push(`Player ${player.name} is already playing on a court`);
        continue;
      }
      
      if (queuedIds.has(playerId)) {
        validationErrors.push(`Player ${player.name} is already in the queue`);
        continue;
      }
    }

    if (validationErrors.length > 0) {
      console.error('Custom match validation failed:', validationErrors.join('; '));
      return;
    }

    // INSERTION LOGIC
    let queuedAt: string;

    if (placement === 'top') {
      // ADD TO TOP: Insert at position #2 (after Match #1)
      // Match #1 stays unchanged, new match inserted between #1 and #2
      
      const matchRows = (queuedRows ?? []) as Array<{ id: string; team1_player1_id: string | null; team1_player2_id: string | null; team2_player1_id: string | null; team2_player2_id: string | null; start_time: string | null }>;
      
      if (matchRows.length === 0) {
        // Queue is empty, insert at beginning
        queuedAt = new Date(Date.now()).toISOString();
      } else if (matchRows.length === 1) {
        // Only Match #1 exists, insert after it
        const match1Time = new Date(matchRows[0].start_time as string).getTime();
        queuedAt = new Date(match1Time + 500).toISOString(); // Insert 500ms after #1
      } else {
        // Multiple matches exist, insert between #1 and #2
        const match1Time = new Date(matchRows[0].start_time as string).getTime();
        const match2Time = new Date(matchRows[1].start_time as string).getTime();
        const midTime = Math.floor((match1Time + match2Time) / 2);
        queuedAt = new Date(midTime).toISOString();
      }
    } else {
      // ADD TO BOTTOM: Append at end of queue
      const matchRows = (queuedRows ?? []) as Array<{ id: string; team1_player1_id: string | null; team1_player2_id: string | null; team2_player1_id: string | null; team2_player2_id: string | null; start_time: string | null }>;
      
      if (matchRows.length === 0) {
        queuedAt = new Date(Date.now()).toISOString();
      } else {
        const lastTime = new Date(matchRows[matchRows.length - 1].start_time as string).getTime();
        queuedAt = new Date(lastTime + 1000).toISOString();
      }
    }

    // INSERT CUSTOM MATCH
    const payload: {
      batch_id: string;
      court_id: null;
      team1_player1_id: string;
      team1_player2_id: string;
      team2_player1_id: string;
      team2_player2_id: string;
      start_time: string;
      status: 'queued';
      score_team1: number;
      score_team2: number;
      match_type?: 'custom';
    } = {
      batch_id: dbBatchId,
      court_id: null,
      team1_player1_id: uniqueIds[0],
      team1_player2_id: uniqueIds[1],
      team2_player1_id: uniqueIds[2],
      team2_player2_id: uniqueIds[3],
      start_time: queuedAt,
      status: 'queued',
      score_team1: 0,
      score_team2: 0,
    };

    if (supportsMatchTypeRef.current) {
      payload.match_type = 'custom';
    }

    await supabase.from('matches').insert(payload);

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const fillIdleCourts = useCallback(async (batchId: BatchId) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const idleCourts = snapshot.batches[batchId].courts.filter((court) => court.status === 'idle');
    if (idleCourts.length === 0) {
      return;
    }

    const { data: queuedRows } = await supabase
      .from('matches')
      .select('id')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('start_time', { ascending: true });

    const ready = queuedRows ?? [];
    const assignCount = Math.min(idleCourts.length, ready.length);

    for (let i = 0; i < assignCount; i += 1) {
      const court = idleCourts[i];
      const readyMatch = ready[i];
      const startedAt = nowIso();

      await supabase
        .from('matches')
        .update({
          court_id: court.id,
          status: 'playing',
          start_time: startedAt,
        })
        .eq('id', readyMatch.id)
        .eq('batch_id', dbBatchId)
        .is('court_id', null);

      await supabase
        .from('courts')
        .update({
          status: 'occupied',
          current_match_id: readyMatch.id,
          start_time: startedAt,
        })
        .eq('id', court.id)
        .eq('batch_id', dbBatchId);
    }

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const startQueuedMatchOnCourt = useCallback(async (batchId: BatchId, courtId: string, matchId: string) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const startedAt = nowIso();
    await supabase
      .from('matches')
      .update({
        court_id: courtId,
        status: 'playing',
        start_time: startedAt,
      })
      .eq('id', matchId)
      .eq('batch_id', dbBatchId)
      .is('court_id', null);

    await supabase
      .from('courts')
      .update({
        status: 'occupied',
        current_match_id: matchId,
        start_time: startedAt,
      })
      .eq('id', courtId)
      .eq('batch_id', dbBatchId);

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

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
    ensureReadyMatches,
    enqueueCustomMatch,
    startQueuedMatchOnCourt,
    startMatchOnCourt,
    completeMatch,
    cancelMatch,
    editScore,
    fillIdleCourts,
    signOut,
  };
}
