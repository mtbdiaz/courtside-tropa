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
  is_active?: boolean;
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
  queue_position?: number | null;
  created_at?: string | null;
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

function queueLockUntil(leaseMs: number) {
  return new Date(Date.now() + leaseMs).toISOString();
}

function isQueuePausedByBatch(batchId: BatchId) {
  if (typeof window === 'undefined') {
    return false;
  }

  const pausedMap = (window as typeof window & {
    __COURTSIDE_QUEUE_PAUSED_BY_BATCH?: Partial<Record<BatchId, boolean>>;
  }).__COURTSIDE_QUEUE_PAUSED_BY_BATCH;

  return Boolean(pausedMap?.[batchId]);
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

function matchPlayerIds(row: {
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
}) {
  return [row.team1_player1_id, row.team1_player2_id, row.team2_player1_id, row.team2_player2_id].filter(Boolean) as string[];
}

function hasAnyPlayerConflict(playerIds: string[], reserved: Set<string>) {
  return playerIds.some((id) => reserved.has(id));
}

async function updateQueuePositions(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  dbBatchId: string,
  rows: Array<{ id: string; queue_position?: number | null }>,
): Promise<{ error: string | null }> {
  for (let i = 0; i < rows.length; i += 1) {
    const nextPosition = i + 1;
    if ((rows[i].queue_position ?? null) === nextPosition) {
      continue;
    }

    const { error } = await supabase
      .from('matches')
      .update({ queue_position: nextPosition })
      .eq('id', rows[i].id)
      .eq('batch_id', dbBatchId)
      .is('court_id', null);

    if (error) {
      return { error: error.message };
    }
  }

  return { error: null };
}

function getBatchIdFromName(name: string): BatchId | null {
  const matched = name.match(BATCH_NAME_REGEX);
  if (!matched) {
    return null;
  }

  return matched[1] === '1' ? 1 : 2;
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

function matchTypeFromTeams(
  _batch: BatchSnapshot,
  teams: { teamA: [string, string]; teamB: [string, string] },
): 'mixed' | 'custom' {
  void teams;
  // Auto-generated queue matches are always treated as regular (non-custom).
  return 'mixed';
}

function chooseReadyMatchWithPairRules(
  availablePlayers: Player[],
  stats: ReturnType<typeof getPlayerStats>,
): { teamA: [string, string]; teamB: [string, string] } | null {
  if (availablePlayers.length < 4) return null;

  // 1. KEEP PAIRS TOGETHER
  const playersByPairId = new Map<string, Player[]>();
  for (const player of availablePlayers) {
    if (player.pairId) {
      const group = playersByPairId.get(player.pairId) ?? [];
      group.push(player);
      playersByPairId.set(player.pairId, group);
    }
  }

  // 2. ASSIGN MATCH COUNTS (Pairs take the HIGHEST count)
  const units: { kind: 'solo' | 'pair'; ids: string[]; matchCount: number; onCooldown: boolean }[] = [];
  const consumed = new Set<string>();

  for (const player of availablePlayers) {
    if (consumed.has(player.id)) continue;
    const pStats = stats.get(player.id);
    const pMatches = (pStats?.gamesPlayed ?? 0); 
    const pCooldown = (pStats?.consecutiveMatches ?? 0) >= 2;

    if (player.pairId) {
      const partner = (playersByPairId.get(player.pairId) ?? []).find(p => p.id !== player.id);
      if (partner && !consumed.has(partner.id)) {
        const partnerStats = stats.get(partner.id);
        const partnerMatches = (partnerStats?.gamesPlayed ?? 0);
        const partnerCooldown = (partnerStats?.consecutiveMatches ?? 0) >= 2;

        units.push({
          kind: 'pair',
          ids: [player.id, partner.id],
          matchCount: Math.max(pMatches, partnerMatches), // Pairs use the HIGHER count
          onCooldown: pCooldown || partnerCooldown, 
        });
        consumed.add(player.id);
        consumed.add(partner.id);
        continue;
      }
    }

    units.push({
      kind: 'solo',
      ids: [player.id],
      matchCount: pMatches,
      onCooldown: pCooldown,
    });
    consumed.add(player.id);
  }

// 3. APPLY COOLDOWNS & FIND LOWEST MATCH COUNT (L)
let eligibleUnits = units.filter(u => !u.onCooldown);
  
// ANTI-STALL OVERRIDE: If literally EVERYONE is on cooldown, ignore the cooldown rule so courts don't sit empty.
if (eligibleUnits.length === 0 && units.length >= 4) {
  eligibleUnits = units; 
} else if (eligibleUnits.length === 0) {
  return null;
}

  const L = Math.min(...eligibleUnits.map(u => u.matchCount));
  
  // 4. APPLY FAIRNESS WINDOW (L and L+1)
  let windowUnits = eligibleUnits.filter(u => u.matchCount <= L + 1);

  // 5. ANTI-STALL (If courts are empty, expand window until we find 4 players)
  let availableCount = windowUnits.reduce((sum, u) => sum + u.ids.length, 0);
  let currentMax = L + 1;
  
  while (availableCount < 4) {
    currentMax += 1;
    windowUnits = eligibleUnits.filter(u => u.matchCount <= currentMax);
    availableCount = windowUnits.reduce((sum, u) => sum + u.ids.length, 0);

    // If completely out of rested players, ignore cooldown to keep courts running
    if (currentMax > Math.max(...eligibleUnits.map(u => u.matchCount)) + 2) {
      const absoluteL = Math.min(...units.map(u => u.matchCount));
      windowUnits = units.filter(u => u.matchCount <= absoluteL + 2);
      break;
    }
  }

// 6. BUILD ALL POSSIBLE MATCH COMBINATIONS
  // SHUFFLE the window units so the same 4 players aren't always picked first
  const shuffledWindow = [...windowUnits].sort(() => Math.random() - 0.5);

  const solos = shuffledWindow.filter(u => u.kind === 'solo');
  const pairs = shuffledWindow.filter(u => u.kind === 'pair');

  type Candidate = { priority: number; sum: number; teamA: [string, string]; teamB: [string, string] };
  const candidates: Candidate[] = [];

  // Priority 0: 4 Solos
  for (let i = 0; i < solos.length - 3; i++) {
    for (let j = i + 1; j < solos.length - 2; j++) {
      for (let k = j + 1; k < solos.length - 1; k++) {
        for (let l = k + 1; l < solos.length; l++) {
          candidates.push({
            priority: 0,
            sum: solos[i].matchCount + solos[j].matchCount + solos[k].matchCount + solos[l].matchCount,
            teamA: [solos[i].ids[0], solos[j].ids[0]],
            teamB: [solos[k].ids[0], solos[l].ids[0]],
          });
        }
      }
    }
  }

  // Priority 1: Pair vs Pair
  for (let i = 0; i < pairs.length - 1; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      candidates.push({
        priority: 1,
        sum: (pairs[i].matchCount * 2) + (pairs[j].matchCount * 2),
        teamA: [pairs[i].ids[0], pairs[i].ids[1]],
        teamB: [pairs[j].ids[0], pairs[j].ids[1]],
      });
    }
  }

  // Priority 2: Pair vs 2 Solos (Only if forced)
  for (let i = 0; i < pairs.length; i++) {
    for (let j = 0; j < solos.length - 1; j++) {
      for (let k = j + 1; k < solos.length; k++) {
        candidates.push({
          priority: 2,
          sum: (pairs[i].matchCount * 2) + solos[j].matchCount + solos[k].matchCount,
          teamA: [pairs[i].ids[0], pairs[i].ids[1]],
          teamB: [solos[j].ids[0], solos[k].ids[0]],
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // 7. FINAL SELECTION: LOWEST MATCHES > SOLO PRIORITY
  candidates.sort((a, b) => {
    if (a.sum !== b.sum) return a.sum - b.sum; // Lowest combined matches wins
    return a.priority - b.priority;            // If equal, prefer Solos > Pair vs Pair
  });

// 8. FINAL SELECTION: Allow variance to break up cliques
  const bestSum = candidates[0].sum;
  const bestPriority = candidates[0].priority;
  
  // THE FIX: Allow a "variance" of up to 2 games in the sum.
  // This allows the engine to occasionally pull an (L+1) player into an (L) group
  // so the exact same 4 people don't get stuck together.
  const variance = 2; 

  const topTier = candidates.filter(c => 
    c.sum <= bestSum + variance && 
    c.priority === bestPriority
  );

  // Randomly pick one of these highly-rated matches
  const finalMatch = topTier[Math.floor(Math.random() * topTier.length)];
  const flip = Math.random() > 0.5;

  return { 
    teamA: flip ? finalMatch.teamA : finalMatch.teamB, 
    teamB: flip ? finalMatch.teamB : finalMatch.teamA 
  };
}

function chooseGenderSpecificCustomMatch(
  batchPlayers: Player[],
  gender: Gender,
  stats: ReturnType<typeof getPlayerStats>,
  unavailableIds: Set<string>,
): string[] | null {
  const eligibleById = new Map<string, Player>();
  for (const player of batchPlayers) {
    if (player.status !== 'checked-in' || player.gender !== gender || unavailableIds.has(player.id)) {
      continue;
    }
    eligibleById.set(player.id, player);
  }

  if (eligibleById.size < 4) {
    return null;
  }

  const ordered = [...eligibleById.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const eligiblePlayersByPairId = new Map<string, Player[]>();
  for (const player of ordered) {
    if (!player.pairId) {
      continue;
    }
    const group = eligiblePlayersByPairId.get(player.pairId) ?? [];
    group.push(player);
    eligiblePlayersByPairId.set(player.pairId, group);
  }

  type Unit = { kind: 'pair' | 'solo'; playerIds: string[]; order: number };
  const units: Unit[] = [];
  const consumed = new Set<string>();

  for (let index = 0; index < ordered.length; index += 1) {
    const player = ordered[index];
    if (consumed.has(player.id)) {
      continue;
    }

    if (player.pairId) {
      // Mixed-gender or unavailable partner pairs are not eligible for gender-specific custom generation.
      const pairGroup = batchPlayers.filter((candidate) => candidate.pairId === player.pairId);
      const hasNonTargetGenderPartner = pairGroup.some((candidate) => candidate.id !== player.id && candidate.gender !== gender);
      if (hasNonTargetGenderPartner) {
        consumed.add(player.id);
        continue;
      }

      const partner = (eligiblePlayersByPairId.get(player.pairId) ?? []).find((candidate) => candidate.id !== player.id);
      if (!partner || consumed.has(partner.id)) {
        consumed.add(player.id);
        continue;
      }

      units.push({
        kind: 'pair',
        playerIds: [player.id, partner.id],
        order: index,
      });
      consumed.add(player.id);
      consumed.add(partner.id);
      continue;
    }

    units.push({
      kind: 'solo',
      playerIds: [player.id],
      order: index,
    });
    consumed.add(player.id);
  }

  if (units.length < 2) {
    return null;
  }

  type Candidate = {
    score: number;
    depth: number;
    orderScore: number;
    ids: string[];
  };
  const candidates: Candidate[] = [];
  const addCandidate = (ids: string[], orders: number[]) => {
    candidates.push({
      score: ids.reduce((sum, id) => sum + (stats.get(id)?.gamesPlayed ?? 0), 0),
      depth: Math.max(...orders),
      orderScore: orders.reduce((sum, value) => sum + value, 0),
      ids,
    });
  };

  const solos = units.filter((unit) => unit.kind === 'solo');
  const pairs = units.filter((unit) => unit.kind === 'pair');

  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = 0; j < solos.length - 1; j += 1) {
      for (let k = j + 1; k < solos.length; k += 1) {
        addCandidate(
          [...pairs[i].playerIds, solos[j].playerIds[0], solos[k].playerIds[0]],
          [pairs[i].order, solos[j].order, solos[k].order],
        );
      }
    }
  }

  for (let i = 0; i < solos.length - 3; i += 1) {
    for (let j = i + 1; j < solos.length - 2; j += 1) {
      for (let k = j + 1; k < solos.length - 1; k += 1) {
        for (let l = k + 1; l < solos.length; l += 1) {
          addCandidate(
            [solos[i].playerIds[0], solos[j].playerIds[0], solos[k].playerIds[0], solos[l].playerIds[0]],
            [solos[i].order, solos[j].order, solos[k].order, solos[l].order],
          );
        }
      }
    }
  }

  for (let i = 0; i < pairs.length - 1; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      addCandidate([...pairs[i].playerIds, ...pairs[j].playerIds], [pairs[i].order, pairs[j].order]);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    if (a.orderScore !== b.orderScore) {
      return a.orderScore - b.orderScore;
    }
    return a.score - b.score;
  });

  return candidates[0].ids;
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
  const queuedMatches = input.matches
    .filter((row) => isQueuedMatchStatus(row.status) && !row.court_id)
    .sort((a, b) => {
      const aPos = a.queue_position ?? Number.MAX_SAFE_INTEGER;
      const bPos = b.queue_position ?? Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) {
        return aPos - bPos;
      }

      return (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id.localeCompare(b.id);
    });

  const matchesById = new Map(input.matches.map((row) => [row.id, row]));
  const playingMatchesByCourtId = new Map<string, MatchRow[]>();
  for (const match of input.matches) {
    if (!isPlayingMatchStatus(match.status) || !match.court_id) {
      continue;
    }

    const current = playingMatchesByCourtId.get(match.court_id) ?? [];
    current.push(match);
    playingMatchesByCourtId.set(match.court_id, current);
  }

  for (const [courtId, matches] of playingMatchesByCourtId) {
    matches.sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? '') || b.id.localeCompare(a.id));
    playingMatchesByCourtId.set(courtId, matches);
  }

  const liveMatchByCourtId = new Map<string, MatchRow | null>();
  const visibleLiveMatchIds = new Set<string>();
  for (const court of input.courts) {
    const fromCurrentMatchId = court.current_match_id ? matchesById.get(court.current_match_id) : null;
    const currentIsLive = Boolean(
      fromCurrentMatchId &&
      isPlayingMatchStatus(fromCurrentMatchId.status) &&
      fromCurrentMatchId.court_id === court.id,
    );

    const resolvedLiveMatch = currentIsLive
      ? (fromCurrentMatchId as MatchRow)
      : (playingMatchesByCourtId.get(court.id)?.[0] ?? null);

    liveMatchByCourtId.set(court.id, resolvedLiveMatch);
    if (resolvedLiveMatch) {
      visibleLiveMatchIds.add(resolvedLiveMatch.id);
    }
  }

  const liveMatches = Array.from(visibleLiveMatchIds)
    .map((matchId) => matchesById.get(matchId))
    .filter(Boolean) as MatchRow[];

  const livePlayerIds = new Set<string>();
  for (const match of liveMatches) {
    matchPlayerIds(match).forEach((id) => livePlayerIds.add(id));
  }

  const queuedPlayerIds = new Set<string>();
  for (const match of queuedMatches) {
    matchPlayerIds(match).forEach((id) => queuedPlayerIds.add(id));
  }

  const basePlayers: Player[] = input.players.map((row) => ({
    id: row.id,
    name: row.name,
    gender: row.gender,
    status: livePlayerIds.has(row.id) ? 'playing' : queuedPlayerIds.has(row.id) ? 'in-queue' : row.status,
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

  const courts = [...input.courts]
    .sort((a, b) => a.court_number - b.court_number)
    .map((court) => {
      const liveMatch = liveMatchByCourtId.get(court.id) ?? null;
      const fallbackLive = court.status === 'occupied';
      const ids = liveMatch
        ? [liveMatch.team1_player1_id, liveMatch.team1_player2_id, liveMatch.team2_player1_id, liveMatch.team2_player2_id].filter(Boolean) as string[]
        : [];

      const teamAIds = liveMatch ? [liveMatch.team1_player1_id, liveMatch.team1_player2_id].filter(Boolean) as string[] : [];
      const teamBIds = liveMatch ? [liveMatch.team2_player1_id, liveMatch.team2_player2_id].filter(Boolean) as string[] : [];

      return {
        id: court.id,
        label: `Court ${court.court_number}`,
        isActive: court.is_active !== false,
        status: liveMatch || fallbackLive ? ('live' as const) : ('idle' as const),
        matchId: liveMatch?.id ?? court.current_match_id,
        mode: liveMatch
          ? (liveMatch.match_type ?? 'mixed')
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
      mode: (match.match_type ?? 'mixed'),
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
        mode: (match.match_type ?? 'mixed'),
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

  const completedMatchIds = new Set(completedHistory.map((match) => match.id));
  const historyOnlyCompleted = input.histories
    .filter((row) => {
      const id = historyMatchId(row);
      return !id || !completedMatchIds.has(id);
    })
    .map((row) => {
      const fallbackId = historyMatchId(row) ?? `history-${row.id}`;
      const teamA = [row.team1_player1_name, row.team1_player2_name].filter(
        (name): name is string => Boolean(name && name.trim()),
      );
      const teamB = [row.team2_player1_name, row.team2_player2_name].filter(
        (name): name is string => Boolean(name && name.trim()),
      );
      const winner = winnerToAB(row.winner_team);

      return {
        id: fallbackId,
        batchId: input.batchId,
        courtId: '',
        courtLabel: `Court ${row.court_number ?? '-'}`,
        mode: input.activeMode,
        sourceUnitIds: [],
        playerIds: [],
        teamA,
        teamB,
        scoreA: row.score_team1,
        scoreB: row.score_team2,
        winner,
        status: 'complete' as const,
        startedAt: row.played_at ?? nowIso(),
        endedAt: row.played_at ?? nowIso(),
        notes: row.notes ?? undefined,
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
    history: [...liveHistory, ...completedHistory, ...historyOnlyCompleted],
    lastUpdated: nowIso(),
  };
}

const SNAPSHOT_CACHE_KEY = 'courtside:snapshot:v2';

function saveSnapshotToCache(snap: ReturnType<typeof createEmptyCourtsideSnapshot>) {
  try {
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snap));
  } catch { /* storage quota exceeded — ignore */ }
}

function loadSnapshotFromCache(): ReturnType<typeof createEmptyCourtsideSnapshot> | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReturnType<typeof createEmptyCourtsideSnapshot>;
    if (!parsed?.batches || !parsed?.activeBatchId) return null;
    return parsed;
  } catch {
    return null;
  }
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
  const [lastActionError, setLastActionError] = useState<string | null>(null);
  const [queueProcessing, setQueueProcessing] = useState(false);
  const [activeModes, setActiveModes] = useState<Record<BatchId, MatchMode>>({ 1: 'mixed', 2: 'mixed' });
  const loadInFlightRef = useRef(false);
  const loadAgainRef = useRef(false);
  const loadRevisionRef = useRef(0);
  const queueMutationLockRef = useRef(false);
  const queueLockHolderRef = useRef('queue-lock-holder');
  const realtimeLoadTimerRef = useRef<number | null>(null);
  const pendingPlayerStatusRef = useRef<Map<string, 'checked-in' | 'break'>>(new Map());
  const toggleSyncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (globalThis.crypto?.randomUUID) {
      queueLockHolderRef.current = `queue-lock-${globalThis.crypto.randomUUID()}`;
      return;
    }

    queueLockHolderRef.current = `queue-lock-${Date.now().toString(36)}`;
  }, []);

  const clearActionError = useCallback(() => {
    setLastActionError(null);
  }, []);

  const reportActionError = useCallback((message: string) => {
    console.error(message);
    setLastActionError(message);
  }, []);

  const acquireDistributedQueueLock = useCallback(async (batchId: BatchId, maxWaitMs = 1200, leaseMs = 8000) => {
    const supabase = supabaseRef.current;
    const dbBatchId = batchDbIdRef.current[batchId];
    if (!supabase || !dbBatchId) {
      return false;
    }

    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      const now = nowIso();
      const lockUntil = queueLockUntil(leaseMs);

      const { data: updatedLock, error: updateError } = await supabase
        .from('batch_operation_locks')
        .update({
          lock_key: 'queue',
          holder_id: queueLockHolderRef.current,
          locked_until: lockUntil,
          updated_at: now,
        })
        .eq('batch_id', dbBatchId)
        .or(`locked_until.is.null,locked_until.lt.${now}`)
        .select('batch_id')
        .maybeSingle();

      if (updateError?.code === 'PGRST204' || updateError?.code === '42P01') {
        // Lock table not available yet. Fall back to local lock behavior.
        return true;
      }

      if (updatedLock?.batch_id) {
        return true;
      }

      const { data: insertedLock, error: insertError } = await supabase
        .from('batch_operation_locks')
        .insert({
          batch_id: dbBatchId,
          lock_key: 'queue',
          holder_id: queueLockHolderRef.current,
          locked_until: lockUntil,
          updated_at: now,
        })
        .select('batch_id')
        .maybeSingle();

      if (insertError?.code === 'PGRST204' || insertError?.code === '42P01') {
        return true;
      }

      if (insertedLock?.batch_id) {
        return true;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 80);
      });
    }

    return false;
  }, []);

  const releaseDistributedQueueLock = useCallback(async (batchId: BatchId) => {
    const supabase = supabaseRef.current;
    const dbBatchId = batchDbIdRef.current[batchId];
    if (!supabase || !dbBatchId) {
      return;
    }

    const { error } = await supabase
      .from('batch_operation_locks')
      .update({
        locked_until: nowIso(),
        updated_at: nowIso(),
      })
      .eq('batch_id', dbBatchId)
      .eq('holder_id', queueLockHolderRef.current);

    if (error?.code === 'PGRST204' || error?.code === '42P01') {
      return;
    }
  }, []);

  const acquireQueueLock = useCallback(async (batchId: BatchId, maxWaitMs = 1200) => {
    const started = Date.now();
    while (queueMutationLockRef.current) {
      if (Date.now() - started >= maxWaitMs) {
        return false;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 40);
      });
    }

    queueMutationLockRef.current = true;
    const distributedLockAcquired = await acquireDistributedQueueLock(batchId, maxWaitMs);
    if (!distributedLockAcquired) {
      queueMutationLockRef.current = false;
      return false;
    }

    setQueueProcessing(true);
    return true;
  }, [acquireDistributedQueueLock]);

  const releaseQueueLock = useCallback((batchId: BatchId) => {
    queueMutationLockRef.current = false;
    setQueueProcessing(false);
    void releaseDistributedQueueLock(batchId);
  }, [releaseDistributedQueueLock]);

  const activeBatch = snapshot.batches[snapshot.activeBatchId];

  const loadFromDatabase = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    if (loadInFlightRef.current) {
      loadAgainRef.current = true;
      return;
    }

    loadInFlightRef.current = true;
    const loadRevision = ++loadRevisionRef.current;

    try {
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
        supabase.from('courts').select('id,batch_id,court_number,is_active,status,current_match_id,start_time').order('court_number', { ascending: true }),
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
        .select('id,batch_id,court_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,end_time,score_team1,score_team2,winner_team,status,queue_position,created_at,match_type');
      matchesData = (withType.data as MatchRow[] | null) ?? null;
      matchesError = withType.error as { code?: string } | null;
      if (matchesError?.code === '42703') {
        supportsMatchTypeRef.current = false;
        const fallback = await supabase
          .from('matches')
          .select('id,batch_id,court_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,end_time,score_team1,score_team2,winner_team,status,queue_position,created_at');
        matchesData = (fallback.data as MatchRow[] | null) ?? null;
        matchesError = fallback.error as { code?: string } | null;
      }
    } else {
      const fallback = await supabase
        .from('matches')
        .select('id,batch_id,court_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,end_time,score_team1,score_team2,winner_team,status,queue_position,created_at');
      matchesData = (fallback.data as MatchRow[] | null) ?? null;
      matchesError = fallback.error as { code?: string } | null;
    }

      if (batchesError || playersError || courtsError || matchesError || historyError) {
        if (!isReady) {
          const cached = loadSnapshotFromCache();
          if (cached) {
            setSnapshot(cached);
          }
        }
        setSyncStatus('offline');
        setIsReady(true);
        return;
      }

      setAuthEmail(sessionData.session?.user?.email ?? null);

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
              num_courts: 8,
            },
            {
              event_id: eventId,
              name: 'Batch 2',
              start_time: '1:00 PM - 5:00 PM',
              end_time: '1:00 PM - 5:00 PM',
              num_courts: 8,
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
      is_active: true;
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
              is_active: true as const,
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
                is_active: true as const,
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

      const pendingStatuses = pendingPlayerStatusRef.current;
      if (pendingStatuses.size > 0) {
        for (const batchId of [1, 2] as BatchId[]) {
          const batchSnapshot = next.batches[batchId];
          next.batches[batchId] = {
            ...batchSnapshot,
            players: batchSnapshot.players.map((player) => {
              const pending = pendingStatuses.get(player.id);
              if (!pending) {
                return player;
              }

              return {
                ...player,
                status: pending,
                updatedAt: nowIso(),
              };
            }),
          };
        }
      }

      if (loadRevision !== loadRevisionRef.current) {
        return;
      }

      const savedActiveBatchId = isFirstLoad ? nextActiveBatchId : initialBatchId;
      saveSnapshotToCache({ ...next, activeBatchId: savedActiveBatchId, lastUpdated: nowIso() });

      setSnapshot((current) => ({
        ...next,
        activeBatchId: isFirstLoad ? nextActiveBatchId : current.activeBatchId,
        lastUpdated: nowIso(),
      }));
      setSyncStatus('online');
      setIsReady(true);
    } finally {
      loadInFlightRef.current = false;
      if (loadAgainRef.current) {
        loadAgainRef.current = false;
        void loadFromDatabase();
      }
    }
  }, [activeModes, isReady, initialBatchId]);

  const scheduleRealtimeLoad = useCallback(() => {
    if (realtimeLoadTimerRef.current !== null) {
      window.clearTimeout(realtimeLoadTimerRef.current);
    }

    realtimeLoadTimerRef.current = window.setTimeout(() => {
      realtimeLoadTimerRef.current = null;
      void loadFromDatabase();
    }, 140);
  }, [loadFromDatabase]);

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
      .select('id,court_number,is_active,status')
      .eq('batch_id', dbBatchId)
      .order('court_number', { ascending: true });

    const courts = existingCourts ?? [];
    if (courts.length < count) {
      const inserts = [];
      for (let number = courts.length + 1; number <= count; number += 1) {
        inserts.push({
          batch_id: dbBatchId,
          court_number: number,
          is_active: true as const,
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

  const setCourtActive = useCallback(async (batchId: BatchId, courtId: string, isActive: boolean) => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      reportActionError('Court update failed: missing database connection or batch mapping.');
      return;
    }

    const court = snapshot.batches[batchId].courts.find((entry) => entry.id === courtId);
    if (!court) {
      reportActionError('Court update failed: selected court was not found.');
      return;
    }

    if (!isActive && court.status === 'live') {
      reportActionError('Court update failed: cannot deactivate a live court.');
      return;
    }

    const { error } = await supabase
      .from('courts')
      .update({ is_active: isActive })
      .eq('id', courtId)
      .eq('batch_id', dbBatchId);
    if (error) {
      reportActionError(`Court update failed: ${error.message}`);
      return;
    }

    await loadFromDatabase();
  }, [clearActionError, loadFromDatabase, reportActionError, snapshot.batches, withBatchDbId]);

  const addSinglePlayer = useCallback(
    async (batchId: BatchId, name: string, gender: Gender) => {
      const supabase = supabaseRef.current;
      const dbBatchId = withBatchDbId(batchId);
      if (!supabase || !dbBatchId) return;

      // 1. GHOST MATCH FIX: Find the current lowest matches for active players
      const { data: activePlayers } = await supabase
        .from('players')
        .select('games_played')
        .eq('batch_id', dbBatchId)
        .eq('status', 'checked-in');
        
      let startingMatches = 0;
      if (activePlayers && activePlayers.length > 0) {
        const L = Math.min(...activePlayers.map(p => p.games_played || 0));
        startingMatches = Math.max(L - 1, 0); // Start at L-1, but never below 0
      }

      // 2. Insert the player with the offset applied
      const { data, error } = await supabase
        .from('players')
        .insert({ 
          batch_id: dbBatchId, 
          name, 
          gender, 
          status: 'checked-in',
          games_played: startingMatches // <--- ADDED THIS LINE
        })
        .select('*')
        .single();

      if (error) {
        reportActionError('Failed to add player');
        console.error(error);
      } else if (data) {
        void loadFromDatabase();
      }
    },
    [loadFromDatabase, reportActionError, withBatchDbId]
  );

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

    const dbBatchId = withBatchDbId(batchId);
    if (!dbBatchId) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const player = batch.players.find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }

    const nextStatus = player.status === 'break' ? 'checked-in' : 'break';
    const targetIds = [playerId];

    // Optimistic transition for instant UX while backend sync is batched.
    setSnapshot((current) => {
      const batchSnapshot = current.batches[batchId];
      const idSet = new Set(targetIds);
      return {
        ...current,
        batches: {
          ...current.batches,
          [batchId]: {
            ...batchSnapshot,
            players: batchSnapshot.players.map((entry) =>
              idSet.has(entry.id)
                ? {
                    ...entry,
                    status: nextStatus,
                    updatedAt: nowIso(),
                  }
                : entry,
            ),
          },
        },
      };
    });

    targetIds.forEach((id) => {
      pendingPlayerStatusRef.current.set(id, nextStatus);
    });

    if (toggleSyncTimerRef.current !== null) {
      window.clearTimeout(toggleSyncTimerRef.current);
    }

    toggleSyncTimerRef.current = window.setTimeout(() => {
      const flush = async () => {
        const pendingEntries = Array.from(pendingPlayerStatusRef.current.entries());
        pendingPlayerStatusRef.current.clear();
        toggleSyncTimerRef.current = null;

        const checkedInIds = pendingEntries.filter(([, status]) => status === 'checked-in').map(([id]) => id);
        const breakIds = pendingEntries.filter(([, status]) => status === 'break').map(([id]) => id);

        if (checkedInIds.length > 0) {
          const { error } = await supabase
            .from('players')
            .update({ status: 'checked-in' })
            .in('id', checkedInIds)
            .eq('batch_id', dbBatchId);
          if (error) {
            reportActionError(`Player sync failed: ${error.message}`);
            await loadFromDatabase();
            return;
          }
        }

        if (breakIds.length > 0) {
          const { error } = await supabase
            .from('players')
            .update({ status: 'break' })
            .in('id', breakIds)
            .eq('batch_id', dbBatchId);
          if (error) {
            reportActionError(`Player sync failed: ${error.message}`);
            await loadFromDatabase();
            return;
          }
        }

        await loadFromDatabase();
      }

      void flush();
    }, 180);
  }, [loadFromDatabase, reportActionError, snapshot.batches, withBatchDbId]);

  const lockSelectedPair = useCallback(async (batchId: BatchId, firstPlayerId: string, secondPlayerId: string) => {
    const supabase = supabaseRef.current;
    if (!supabase || firstPlayerId === secondPlayerId) {
      return;
    }

    const dbBatchId = withBatchDbId(batchId);

    if (!dbBatchId) {
      return;
    }

    await Promise.all([
      supabase.from('players').update({ pair_id: secondPlayerId }).eq('id', firstPlayerId).eq('batch_id', dbBatchId),
      supabase.from('players').update({ pair_id: firstPlayerId }).eq('id', secondPlayerId).eq('batch_id', dbBatchId),
    ]);

    if (dbBatchId) {
      const { data: queuedRows } = await supabase
        .from('matches')
        .select('id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id')
        .eq('batch_id', dbBatchId)
        .in('status', ['queued', 'active'])
        .is('court_id', null);

      const affectedMatchIds = (queuedRows ?? [])
        .filter((row) => {
          const ids = matchPlayerIds(row);
          return ids.includes(firstPlayerId) || ids.includes(secondPlayerId);
        })
        .map((row) => row.id);

      if (affectedMatchIds.length > 0) {
        await supabase.from('matches').delete().in('id', affectedMatchIds).eq('batch_id', dbBatchId).is('court_id', null);
      }
    }

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

  const unlockSelectedPair = useCallback(async (batchId: BatchId, pairId: string) => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      return;
    }

    const batch = snapshot.batches[batchId];
    const pair = batch.pairs.find((entry) => entry.id === pairId);
    const ids = pair?.playerIds ?? [];
    if (ids.length !== 2) {
      return;
    }

    const liveIds = new Set(
      batch.courts
        .filter((court) => court.status === 'live')
        .flatMap((court) => court.sourceUnitIds),
    );
    if (ids.some((id) => liveIds.has(id))) {
      reportActionError('Unpair blocked: one or both players are currently playing. Unpair after the match ends.');
      return;
    }

    const { data: queuedRows } = await supabase
      .from('matches')
      .select('id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null);

    const affectedMatchIds = (queuedRows ?? [])
      .filter((row) => {
        const participants = matchPlayerIds(row);
        return participants.some((id) => ids.includes(id));
      })
      .map((row) => row.id);

    const base = Date.now();
    await Promise.all(
      ids.map((id, index) =>
        supabase
          .from('players')
          .update({
            pair_id: null,
            status: 'checked-in',
            created_at: new Date(base + index * 1000).toISOString(),
          })
          .eq('id', id)
          .eq('batch_id', dbBatchId),
      ),
    );

    if (affectedMatchIds.length > 0) {
      await supabase
        .from('matches')
        .delete()
        .eq('batch_id', dbBatchId)
        .in('id', affectedMatchIds)
        .is('court_id', null);
    }

    await loadFromDatabase();
  }, [clearActionError, loadFromDatabase, reportActionError, snapshot.batches, withBatchDbId]);

  const ensureReadyMatches = useCallback(async (batchId: BatchId, targetReadyMatches = 1) => {
    clearActionError();

    // 1. Check if it's already processing before doing anything
    if (queueProcessing) return;

    // 2. Declare the variables FIRST
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);

    // 3. NOW you can safely check if they exist
    if (!supabase || !dbBatchId) {
      reportActionError('Queue generation failed: missing database connection or batch mapping.');
      return;
    }

    const lockAcquired = await acquireQueueLock(batchId, 5000);
    if (!lockAcquired) {
      return;
    }

    try {
      // If a UI-level pause was set, respect it immediately after acquiring the lock.
      // This uses a small global flag set by the UI so the hook can abort in-progress runs.
      // (Prevents assignments from proceeding when an admin hits PAUSE mid-cycle.)
      try {
        if (isQueuePausedByBatch(batchId)) {
          return;
        }
      } catch {
        // ignore
      }
      const batch = snapshot.batches[batchId];
      const { data: queuedRows } = await supabase
      .from('matches')
      .select('id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,queue_position')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('queue_position', { ascending: true, nullsFirst: false })
      .order('start_time', { ascending: true });

    const sortedRows = (queuedRows ?? []).slice().sort((a, b) => {
      const aPos = a.queue_position ?? Number.MAX_SAFE_INTEGER;
      const bPos = b.queue_position ?? Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) {
        return aPos - bPos;
      }
      return (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id.localeCompare(b.id);
    });

    const reserved = new Set<string>();
    for (const court of batch.courts) {
      if (court.status === 'live') {
        court.sourceUnitIds.forEach((id) => reserved.add(id));
      }
    }

    const readyRows: Array<{
      id: string;
      queue_position?: number | null;
      team1_player1_id: string | null;
      team1_player2_id: string | null;
      team2_player1_id: string | null;
      team2_player2_id: string | null;
    }> = [];
    for (const row of sortedRows) {
      const ids = matchPlayerIds(row);
      if (ids.length !== 4 || hasAnyPlayerConflict(ids, reserved)) {
        const { error: deleteError } = await supabase.from('matches').delete().eq('id', row.id).eq('batch_id', dbBatchId).is('court_id', null);
        if (deleteError) {
          reportActionError(`Queue cleanup failed: ${deleteError.message}`);
        }
        continue;
      }

      ids.forEach((id) => reserved.add(id));
      readyRows.push(row);
    }

    const ensureResequence = await updateQueuePositions(supabase, dbBatchId, readyRows);
    if (ensureResequence.error) {
      reportActionError(`Queue resequencing failed: ${ensureResequence.error}`);
      return;
    }

    if (readyRows.length >= targetReadyMatches) {
      await loadFromDatabase();
      return;
    }

const stats = getPlayerStats(batch);
  
  // Create a dynamic list of players we use during this specific generation cycle
  const currentlyDrafted = new Set<string>();

  const available = batch.players.filter((player) => 
    player.status === 'checked-in' && 
    !reserved.has(player.id) &&
    !currentlyDrafted.has(player.id) // <--- THE NEW FIX
  );

  const next = chooseReadyMatchWithPairRules(available, stats);
  
  if (!next) {
    await loadFromDatabase();
    return;
  }

  // IMMEDIATELY reserve these new players so the next loop can't pick them!
  next.teamA.forEach(id => currentlyDrafted.add(id));
  next.teamB.forEach(id => currentlyDrafted.add(id));

    const payload: {
      batch_id: string;
      court_id: null;
      team1_player1_id: string;
      team1_player2_id: string;
      team2_player1_id: string;
      team2_player2_id: string;
      queue_position: number;
      start_time: string;
      status: 'queued';
      score_team1: number;
      score_team2: number;
      match_type?: 'mixed' | 'custom';
    } = {
      batch_id: dbBatchId,
      court_id: null,
      team1_player1_id: next.teamA[0],
      team1_player2_id: next.teamA[1],
      team2_player1_id: next.teamB[0],
      team2_player2_id: next.teamB[1],
      queue_position: readyRows.length + 1,
      start_time: nowIso(),
      status: 'queued',
      score_team1: 0,
      score_team2: 0,
    };

    if (supportsMatchTypeRef.current) {
      payload.match_type = matchTypeFromTeams(batch, next);
    }

    const { error: insertError } = await supabase.from('matches').insert(payload);
    if (insertError) {
      reportActionError(`Queue generation failed: ${insertError.message}`);
      return;
    }

      await loadFromDatabase();
    } finally {
      releaseQueueLock(batchId);
    }
  }, [acquireQueueLock, clearActionError, loadFromDatabase, releaseQueueLock, reportActionError, snapshot.batches, withBatchDbId, queueProcessing]);

  const moveQueueUnit = useCallback(async (batchId: BatchId, matchId: string, direction: 'up' | 'down') => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      reportActionError('Queue reorder failed: missing database connection or batch mapping.');
      return;
    }

    // Auto-fill runs on a timer; wait longer for queue lock so cycles are not skipped.
    const lockAcquired = await acquireQueueLock(batchId, 7000);
    if (!lockAcquired) {
      return;
    }

    try {
      const { data: queuedRows } = await supabase
      .from('matches')
      .select('id,queue_position,start_time')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('queue_position', { ascending: true, nullsFirst: false })
      .order('start_time', { ascending: true });

    const queue = (queuedRows ?? []).slice().sort((a, b) => {
      const aPos = a.queue_position ?? Number.MAX_SAFE_INTEGER;
      const bPos = b.queue_position ?? Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) {
        return aPos - bPos;
      }

      return (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id.localeCompare(b.id);
    });
    const index = queue.findIndex((row) => row.id === matchId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= queue.length) {
      return;
    }

    const [moved] = queue.splice(index, 1);
    queue.splice(targetIndex, 0, moved);

    const moveResequence = await updateQueuePositions(supabase, dbBatchId, queue);
    if (moveResequence.error) {
      reportActionError(`Queue reorder failed: ${moveResequence.error}`);
      return;
    }

      await loadFromDatabase();
    } finally {
      releaseQueueLock(batchId);
    }
  }, [acquireQueueLock, clearActionError, loadFromDatabase, releaseQueueLock, reportActionError, withBatchDbId]);

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
      .eq('batch_id', dbBatchId)
      .single();

    const playerIds = [
      matchRow?.team1_player1_id,
      matchRow?.team1_player2_id,
      matchRow?.team2_player1_id,
      matchRow?.team2_player2_id,
    ].filter(Boolean) as string[];

    if (playerIds.length > 0) {
      const base = Date.now() - playerIds.length * 1000;
      await Promise.all(
        playerIds.map((id, i) =>
          supabase
            .from('players')
            .update({
              created_at: new Date(base + i * 1000).toISOString(),
              status: 'checked-in',
            })
            .eq('id', id)
            .eq('batch_id', dbBatchId),
        ),
      );
    }

    const historyMatchColumn = historyMatchIdColumnRef.current;

    await Promise.all([
      supabase.from('matches').delete().eq('id', matchId).eq('batch_id', dbBatchId),
      supabase.from('match_history').delete().eq(historyMatchColumn, matchId).eq('batch_id', dbBatchId),
      supabase.from('courts').update({
        status: 'free',
        current_match_id: null,
        start_time: null,
      }).eq('id', courtId).eq('batch_id', dbBatchId),
    ]);

    await loadFromDatabase();
  }, [loadFromDatabase, snapshot.batches, withBatchDbId]);

  const startMatchOnCourt = useCallback(async (batchId: BatchId, courtId: string, mode: MatchMode, selectedPlayers?: CustomMatchSelection) => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      reportActionError('Start match failed: missing database connection or batch mapping.');
      return;
    }

    const targetCourt = snapshot.batches[batchId].courts.find((court) => court.id === courtId);
    if (!targetCourt?.isActive) {
      reportActionError('Start match failed: selected court is inactive.');
      return;
    }

    const lockAcquired = await acquireQueueLock(batchId);
    if (!lockAcquired) {
      return;
    }

    try {
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
          reportActionError('Start match failed: could not create match record.');
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
      .order('queue_position', { ascending: true, nullsFirst: false })
      .order('start_time', { ascending: true })
      .limit(1);

    const nextReady = queuedRows?.[0];
    if (!nextReady) {
      reportActionError('Start match failed: no queued matches available.');
      return;
    }

    const { error: matchUpdateError } = await supabase
      .from('matches')
      .update({
        court_id: courtId,
        queue_position: null,
        status: 'playing',
        start_time: nowIso(),
      })
      .eq('id', nextReady.id)
      .eq('batch_id', dbBatchId)
      .is('court_id', null);
    if (matchUpdateError) {
      reportActionError(`Start match failed: ${matchUpdateError.message}`);
      return;
    }

    const { error: courtUpdateError } = await supabase.from('courts').update({
      status: 'occupied',
      current_match_id: nextReady.id,
      start_time: nowIso(),
    }).eq('id', courtId);
    if (courtUpdateError) {
      reportActionError(`Start match failed while updating court: ${courtUpdateError.message}`);
      return;
    }

      await loadFromDatabase();
    } finally {
      releaseQueueLock(batchId);
    }
  }, [acquireQueueLock, clearActionError, loadFromDatabase, releaseQueueLock, reportActionError, snapshot.batches, withBatchDbId]);

  const completeMatch = useCallback(async (batchId: BatchId, courtId: string, scoreA: number | null, scoreB: number | null) => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return;
    }

    clearActionError();

    if (scoreA === null || scoreB === null) {
      reportActionError('Save score failed: both scores are required.');
      return;
    }

    const court = snapshot.batches[batchId].courts.find((entry) => entry.id === courtId);
    if (!court?.matchId) {
      return;
    }

    const matchId = court.matchId;
    const winner = scoreToWinner(scoreA, scoreB);

    const dbBatchId = withBatchDbId(batchId);
    if (!dbBatchId) {
      reportActionError('Save score failed: missing batch mapping.');
      return;
    }

    const { data: matchRow } = await supabase
      .from('matches')
      .select('team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id')
      .eq('id', matchId)
      .eq('batch_id', dbBatchId)
      .single();

    await supabase.from('matches').update({
      status: 'completed',
      end_time: nowIso(),
      score_team1: scoreA,
      score_team2: scoreB,
      winner_team: winner,
    }).eq('id', matchId).eq('batch_id', dbBatchId);

    const playerIds = [
      matchRow?.team1_player1_id,
      matchRow?.team1_player2_id,
      matchRow?.team2_player1_id,
      matchRow?.team2_player2_id,
    ].filter(Boolean) as string[];

    if (playerIds.length > 0) {
      const base = Date.now();
      await Promise.all(
        playerIds.map((id, index) =>
          supabase
            .from('players')
            .update({
              created_at: new Date(base + index * 1000).toISOString(),
              status: 'checked-in',
            })
            .eq('id', id)
            .eq('batch_id', dbBatchId),
        ),
      );
    }

    await supabase.from('courts').update({
      status: 'free',
      current_match_id: null,
      start_time: null,
    }).eq('id', courtId).eq('batch_id', dbBatchId);

    const players = snapshot.batches[batchId].players;
    const toName = (id: string | null | undefined) => players.find((entry) => entry.id === id)?.name ?? null;

    const historyMatchColumn = historyMatchIdColumnRef.current;

    await supabase.from('match_history').delete().eq(historyMatchColumn, matchId).eq('batch_id', dbBatchId);

    await supabase.from('match_history').insert({
      batch_id: dbBatchId,
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
  }, [clearActionError, loadFromDatabase, reportActionError, snapshot.batches, withBatchDbId]);

  const editScore = useCallback(async (batchId: BatchId, matchId: string, scoreA: number | null, scoreB: number | null) => {
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase) {
      return;
    }
    if (!dbBatchId) {
      return;
    }

    const winner = scoreToWinner(scoreA, scoreB);

    const historyMatchColumn = historyMatchIdColumnRef.current;

    await Promise.all([
      supabase.from('matches').update({
        score_team1: scoreA,
        score_team2: scoreB,
        winner_team: winner,
      }).eq('id', matchId).eq('batch_id', dbBatchId),
      supabase.from('match_history').update({
        score_team1: scoreA,
        score_team2: scoreB,
        winner_team: winner,
      }).eq(historyMatchColumn, matchId).eq('batch_id', dbBatchId),
      supabase.from('match_history').update({
        score_team1: scoreA,
        score_team2: scoreB,
        winner_team: winner,
      }).eq('id', matchId).eq('batch_id', dbBatchId),
    ]);

    await loadFromDatabase();
  }, [loadFromDatabase, withBatchDbId]);

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
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId || playerIds.length !== 4) {
      reportActionError('Custom match failed: select exactly 4 players and ensure batch is connected.');
      return;
    }

    const lockAcquired = await acquireQueueLock(batchId);
    if (!lockAcquired) {
      return;
    }

    try {
      // VALIDATION: Check for duplicate players
      const uniqueIds = Array.from(new Set(playerIds));
      if (uniqueIds.length !== 4) {
        reportActionError('Custom match failed: duplicate players selected.');
        return;
      }

    const batch = snapshot.batches[batchId];

    // VALIDATION: Get live court player IDs
    const liveIds = new Set(batch.courts.filter((court) => court.status === 'live').flatMap((court) => court.sourceUnitIds));

    // VALIDATION: Get all queued player IDs (including custom and mixed)
    const { data: queuedRows } = await supabase
      .from('matches')
      .select('id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,start_time,queue_position')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('queue_position', { ascending: true, nullsFirst: false })
      .order('start_time', { ascending: true });

    const orderedQueue = (queuedRows ?? []).slice().sort((a, b) => {
      const aPos = a.queue_position ?? Number.MAX_SAFE_INTEGER;
      const bPos = b.queue_position ?? Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) {
        return aPos - bPos;
      }
      return (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id.localeCompare(b.id);
    });

    const queuedIds = new Set<string>();
    for (const row of orderedQueue) {
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
        reportActionError(`Custom match failed: ${validationErrors.join('; ')}`);
        return;
      }

    const resequencedQueue = orderedQueue.map((row, i) => ({ ...row, queue_position: i + 1 }));
    const insertPosition = placement === 'top'
      ? (orderedQueue.length === 0 ? 1 : 2)
      : orderedQueue.length + 1;

    const finalQueue: Array<{ id: string; queue_position?: number | null }> = resequencedQueue.map((row) => ({
      id: row.id,
      queue_position: row.queue_position,
    }));
    finalQueue.splice(insertPosition - 1, 0, { id: '__custom__', queue_position: insertPosition });

    // INSERT CUSTOM MATCH
    const payload: {
      batch_id: string;
      court_id: null;
      team1_player1_id: string;
      team1_player2_id: string;
      team2_player1_id: string;
      team2_player2_id: string;
      queue_position: number;
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
      queue_position: insertPosition,
      start_time: nowIso(),
      status: 'queued',
      score_team1: 0,
      score_team2: 0,
    };

    if (supportsMatchTypeRef.current) {
      payload.match_type = 'custom';
    }

    const { data: inserted, error: insertError } = await supabase.from('matches').insert(payload).select('id,queue_position').single();
    if (insertError) {
      reportActionError(`Custom match insert failed: ${insertError.message}`);
      return;
    }

    if (!inserted?.id) {
      reportActionError('Custom match insert failed: missing inserted match id.');
      return;
    }

    const finalResequenceRows = finalQueue
      .map((row, i) => ({
        id: row.id === '__custom__' ? inserted.id : row.id,
        queue_position: row.id === '__custom__' ? (inserted.queue_position ?? insertPosition) : row.queue_position ?? i + 1,
      }));

    const customResequence = await updateQueuePositions(supabase, dbBatchId, finalResequenceRows);
    if (customResequence.error) {
      reportActionError(`Custom queue finalize failed: ${customResequence.error}`);
      return;
    }

      await loadFromDatabase();
    } finally {
      releaseQueueLock(batchId);
    }
  }, [acquireQueueLock, clearActionError, loadFromDatabase, releaseQueueLock, reportActionError, snapshot.batches, withBatchDbId]);

  const generateSingleGenderCustomMatch = useCallback(async (
    batchId: BatchId,
    gender: Gender,
    placement: 'top' | 'bottom',
  ) => {
    clearActionError();
    const batch = snapshot.batches[batchId];
    const liveIds = new Set(
      batch.courts
        .filter((court) => court.status === 'live')
        .flatMap((court) => court.sourceUnitIds),
    );
    const queuedIds = new Set(batch.queuedMatches.flatMap((match) => match.playerIds));

    const unavailableIds = new Set<string>([...liveIds, ...queuedIds]);
    const stats = getPlayerStats(batch);
    const selected = chooseGenderSpecificCustomMatch(batch.players, gender, stats, unavailableIds);
    if (!selected || selected.length !== 4) {
      reportActionError(`Custom match failed: need at least 4 checked-in ${gender === 'M' ? 'male' : 'female'} players.`);
      return;
    }

    await enqueueCustomMatch(batchId, selected, placement);
  }, [clearActionError, enqueueCustomMatch, reportActionError, snapshot.batches]);

  const fillIdleCourts = useCallback(async (batchId: BatchId, maxAssignments?: number) => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      reportActionError('Auto-fill failed: missing database connection or batch mapping.');
      return;
    }

    const lockAcquired = await acquireQueueLock(batchId);
    if (!lockAcquired) {
      return;
    }

    try {
    const idleCourts = snapshot.batches[batchId].courts.filter((court) => court.status === 'idle' && court.isActive);
    if (idleCourts.length === 0) {
      return;
    }

    const { data: queuedRows } = await supabase
      .from('matches')
      .select('id')
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'active'])
      .is('court_id', null)
      .order('queue_position', { ascending: true, nullsFirst: false })
      .order('start_time', { ascending: true });

    const ready = queuedRows ?? [];
    const normalizedLimit = typeof maxAssignments === 'number' && maxAssignments > 0
      ? Math.floor(maxAssignments)
      : Number.POSITIVE_INFINITY;
    const assignCount = Math.min(idleCourts.length, ready.length, normalizedLimit);

    for (let i = 0; i < assignCount; i += 1) {
      const court = idleCourts[i];
      const readyMatch = ready[i];
      const startedAt = nowIso();

      const { error: assignError } = await supabase
        .from('matches')
        .update({
          court_id: court.id,
          queue_position: null,
          status: 'playing',
          start_time: startedAt,
        })
        .eq('id', readyMatch.id)
        .eq('batch_id', dbBatchId)
        .is('court_id', null);
      if (assignError) {
        reportActionError(`Auto-fill failed while assigning match: ${assignError.message}`);
        return;
      }

      const { error: courtUpdateError } = await supabase
        .from('courts')
        .update({
          status: 'occupied',
          current_match_id: readyMatch.id,
          start_time: startedAt,
        })
        .eq('id', court.id)
        .eq('batch_id', dbBatchId);
      if (courtUpdateError) {
        reportActionError(`Auto-fill failed while updating court: ${courtUpdateError.message}`);
        return;
      }
    }

    await loadFromDatabase();
    } finally {
      releaseQueueLock(batchId);
    }
  }, [acquireQueueLock, clearActionError, loadFromDatabase, releaseQueueLock, reportActionError, snapshot.batches, withBatchDbId]);

  const startQueuedMatchOnCourt = useCallback(async (batchId: BatchId, courtId: string, matchId: string) => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      reportActionError('Queue-to-court failed: missing database connection or batch mapping.');
      return;
    }

    const targetCourt = snapshot.batches[batchId].courts.find((court) => court.id === courtId);
    if (!targetCourt?.isActive) {
      reportActionError('Queue-to-court failed: selected court is inactive.');
      return;
    }

    const lockAcquired = await acquireQueueLock(batchId, 5000);
    if (!lockAcquired) {
      reportActionError('Queue-to-court failed: system is busy, please try again.');
      return;
    }

    try {
      const startedAt = nowIso();
      const { error: matchUpdateError } = await supabase
      .from('matches')
      .update({
        court_id: courtId,
        queue_position: null,
        status: 'playing',
        start_time: startedAt,
      })
      .eq('id', matchId)
      .eq('batch_id', dbBatchId)
      .is('court_id', null);
    if (matchUpdateError) {
      reportActionError(`Queue-to-court failed: ${matchUpdateError.message}`);
      return;
    }

    const { error: courtUpdateError } = await supabase
      .from('courts')
      .update({
        status: 'occupied',
        current_match_id: matchId,
        start_time: startedAt,
      })
      .eq('id', courtId)
      .eq('batch_id', dbBatchId);
    if (courtUpdateError) {
      reportActionError(`Queue-to-court failed while updating court: ${courtUpdateError.message}`);
      return;
    }

      await loadFromDatabase();
    } finally {
      releaseQueueLock(batchId);
    }
  }, [acquireQueueLock, clearActionError, loadFromDatabase, releaseQueueLock, reportActionError, snapshot.batches, withBatchDbId]);

  const deleteAllPlayersForBatch = useCallback(async (batchId: BatchId) => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      reportActionError('Delete all players failed: missing database connection or batch mapping.');
      return;
    }

    // Nuclear admin op — force-clear any held in-memory lock so it's never blocked.
    queueMutationLockRef.current = false;
    setQueueProcessing(false);

    const { error: matchesError } = await supabase
      .from('matches')
      .delete()
      .eq('batch_id', dbBatchId);
    if (matchesError) {
      reportActionError(`Delete all players failed while clearing matches: ${matchesError.message}`);
      return;
    }

    const { error: courtsError } = await supabase
      .from('courts')
      .update({
        status: 'free',
        current_match_id: null,
        start_time: null,
      })
      .eq('batch_id', dbBatchId);
    if (courtsError) {
      reportActionError(`Delete all players failed while resetting courts: ${courtsError.message}`);
      return;
    }

    const { error: playersError } = await supabase
      .from('players')
      .delete()
      .eq('batch_id', dbBatchId);
    if (playersError) {
      reportActionError(`Delete all players failed: ${playersError.message}`);
      return;
    }

    await loadFromDatabase();
  }, [clearActionError, loadFromDatabase, reportActionError, withBatchDbId]);

  const setAllPlayersBreakForBatch = useCallback(async (batchId: BatchId) => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      reportActionError('Set all players to break failed: missing database connection or batch mapping.');
      return;
    }

    // Nuclear admin op — force-clear any held in-memory lock so it's never blocked.
    queueMutationLockRef.current = false;
    setQueueProcessing(false);

    const { error: clearMatchesError } = await supabase
      .from('matches')
      .delete()
      .eq('batch_id', dbBatchId)
      .in('status', ['queued', 'playing', 'active']);
    if (clearMatchesError) {
      reportActionError(`Set all players to break failed while clearing active queue: ${clearMatchesError.message}`);
      return;
    }

    const { error: courtsError } = await supabase
      .from('courts')
      .update({
        status: 'free',
        current_match_id: null,
        start_time: null,
      })
      .eq('batch_id', dbBatchId);
    if (courtsError) {
      reportActionError(`Set all players to break failed while resetting courts: ${courtsError.message}`);
      return;
    }

    const { error: playersError } = await supabase
      .from('players')
      .update({ status: 'break' })
      .eq('batch_id', dbBatchId);
    if (playersError) {
      reportActionError(`Set all players to break failed: ${playersError.message}`);
      return;
    }

    await loadFromDatabase();
  }, [clearActionError, loadFromDatabase, reportActionError, withBatchDbId]);

  const deleteAllMatchHistoryForBatch = useCallback(async (batchId: BatchId) => {
    clearActionError();
    const supabase = supabaseRef.current;
    const dbBatchId = withBatchDbId(batchId);
    if (!supabase || !dbBatchId) {
      reportActionError('Delete match history failed: missing database connection or batch mapping.');
      return;
    }

    // Nuclear admin op — force-clear any held in-memory lock so it's never blocked.
    queueMutationLockRef.current = false;
    setQueueProcessing(false);

    const { error: historyError } = await supabase
      .from('match_history')
      .delete()
      .eq('batch_id', dbBatchId);
    if (historyError) {
      reportActionError(`Delete match history failed: ${historyError.message}`);
      return;
    }

    const { error: completedMatchesError } = await supabase
      .from('matches')
      .delete()
      .eq('batch_id', dbBatchId)
      .eq('status', 'completed');
    if (completedMatchesError) {
      reportActionError(`Delete match history failed while clearing completed matches: ${completedMatchesError.message}`);
      return;
    }

    await loadFromDatabase();
  }, [clearActionError, loadFromDatabase, reportActionError, withBatchDbId]);

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

    const handleRealtimeChange = (payload: { new?: { batch_id?: string | null }; old?: { batch_id?: string | null } }) => {
      const rowBatchId = payload.new?.batch_id ?? payload.old?.batch_id ?? null;
      if (!rowBatchId) {
        scheduleRealtimeLoad();
        return;
      }

      const knownBatchIds = Object.values(batchDbIdRef.current).filter(Boolean) as string[];
      if (knownBatchIds.includes(rowBatchId)) {
        scheduleRealtimeLoad();
      }
    };

    let channelSubscribed = false;
    const channel = supabase
      .channel('courtside-normalized')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batches' }, () => scheduleRealtimeLoad())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courts' }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_history' }, handleRealtimeChange)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (channelSubscribed) {
            // Re-subscribed after a drop — force a full sync.
            scheduleRealtimeLoad();
          }
          channelSubscribed = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setSyncStatus('offline');
          channelSubscribed = false;
        }
      });

    const handleOnline = () => {
      setSyncStatus('loading');
      void loadFromDatabaseRef.current();
    };
    const handleOffline = () => {
      setSyncStatus('offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (realtimeLoadTimerRef.current !== null) {
        window.clearTimeout(realtimeLoadTimerRef.current);
        realtimeLoadTimerRef.current = null;
      }
      if (toggleSyncTimerRef.current !== null) {
        window.clearTimeout(toggleSyncTimerRef.current);
        toggleSyncTimerRef.current = null;
      }
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      void supabase.removeChannel(channel);
    };
  }, [loadFromDatabase, scheduleRealtimeLoad]);

  const loadFromDatabaseRef = useRef(loadFromDatabase);
  useEffect(() => {
    loadFromDatabaseRef.current = loadFromDatabase;
  }, [loadFromDatabase]);

  // Reconnect polling: while offline, probe every 15 s and sync the moment network is back.
  const reconnectIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (syncStatus === 'offline') {
      if (reconnectIntervalRef.current !== null) return;
      reconnectIntervalRef.current = window.setInterval(() => {
        if (navigator.onLine) {
          void loadFromDatabaseRef.current();
        }
      }, 15000);
    } else {
      if (reconnectIntervalRef.current !== null) {
        window.clearInterval(reconnectIntervalRef.current);
        reconnectIntervalRef.current = null;
      }
    }
  }, [syncStatus]);

  const batchCounts = useMemo(() => getBatchCounts(activeBatch), [activeBatch]);
  const queueUnits = useMemo(() => resolveQueueUnits(activeBatch), [activeBatch]);

  return {
    snapshot,
    activeBatch,
    queueUnits,
    batchCounts,
    isReady,
    syncStatus,
    lastActionError,
    clearActionError,
    queueProcessing,
    authEmail,
    setActiveBatchId,
    setMode,
    setCourtCount,
    setCourtActive,
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
    ensureReadyMatches,
    enqueueCustomMatch,
    generateSingleGenderCustomMatch,
    startQueuedMatchOnCourt,
    startMatchOnCourt,
    completeMatch,
    cancelMatch,
    editScore,
    fillIdleCourts,
    deleteAllPlayersForBatch,
    setAllPlayersBreakForBatch,
    deleteAllMatchHistoryForBatch,
    signOut,
  };
}
