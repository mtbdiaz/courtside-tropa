import type {
  BatchId,
  BatchSnapshot,
  CourtSlot,
  CustomMatchSelection,
  Gender,
  MatchMode,
  MatchPreview,
  LeaderboardEntry,
  Pair,
  Player,
  QueueUnit,
} from '@/types/courtside';

const DEFAULT_COURT_COUNT = 6;

function now() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)}`;
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

function buildCourts(count: number): CourtSlot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `court-${index + 1}`,
    label: `Court ${index + 1}`,
    status: 'idle' as const,
    matchId: null,
    mode: null,
    startedAt: null,
    sourceUnitIds: [],
    teamA: [],
    teamB: [],
    scoreA: null,
    scoreB: null,
  }));
}

export function createEmptyBatchSnapshot(batchId: BatchId): BatchSnapshot {
  return {
    batchId,
    title: batchId === 1 ? 'Batch 1' : 'Batch 2',
    courtCount: DEFAULT_COURT_COUNT,
    activeMode: 'mixed',
    players: [],
    pairs: [],
    queueOrder: [],
    courts: buildCourts(DEFAULT_COURT_COUNT),
    history: [],
    lastUpdated: now(),
  };
}

export function createDefaultBatchMap() {
  return {
    1: createEmptyBatchSnapshot(1),
    2: createEmptyBatchSnapshot(2),
  };
}

export function createEmptyCourtsideSnapshot() {
  return {
    batches: createDefaultBatchMap(),
    activeBatchId: 1 as BatchId,
    lastUpdated: now(),
  };
}

export function hydrateSnapshot(raw: unknown, batchId: BatchId): BatchSnapshot {
  if (!raw || typeof raw !== 'object') {
    return createEmptyBatchSnapshot(batchId);
  }

  const snapshot = raw as Partial<BatchSnapshot>;
  return {
    ...createEmptyBatchSnapshot(batchId),
    ...snapshot,
    batchId,
    players: Array.isArray(snapshot.players) ? snapshot.players : [],
    pairs: Array.isArray(snapshot.pairs) ? snapshot.pairs : [],
    queueOrder: Array.isArray(snapshot.queueOrder) ? snapshot.queueOrder : [],
    courts: Array.isArray(snapshot.courts) && snapshot.courts.length > 0 ? snapshot.courts : buildCourts(snapshot.courtCount ?? DEFAULT_COURT_COUNT),
    history: Array.isArray(snapshot.history) ? snapshot.history : [],
    courtCount: snapshot.courtCount ?? DEFAULT_COURT_COUNT,
    activeMode: snapshot.activeMode ?? 'mixed',
    lastUpdated: snapshot.lastUpdated ?? now(),
  };
}

export function syncCourtCount(snapshot: BatchSnapshot, courtCount: number) {
  const next = cloneSnapshot(snapshot);
  const existing = new Map(next.courts.map((court) => [court.id, court]));
  next.courtCount = courtCount;
  next.courts = buildCourts(courtCount).map((court, index) => {
    const previous = snapshot.courts[index] ?? existing.get(court.id);
    if (!previous) {
      return court;
    }

    return {
      ...court,
      ...previous,
      id: court.id,
      label: court.label,
    };
  });
  next.lastUpdated = now();
  return next;
}

function getPlayerMap(snapshot: BatchSnapshot) {
  return new Map(snapshot.players.map((player) => [player.id, player]));
}

function getPairMap(snapshot: BatchSnapshot) {
  return new Map(snapshot.pairs.map((pair) => [pair.id, pair]));
}

function getPairLabel(snapshot: BatchSnapshot, pair: Pair) {
  const players = getPlayerMap(snapshot);
  const first = players.get(pair.playerIds[0])?.name ?? 'Player 1';
  const second = players.get(pair.playerIds[1])?.name ?? 'Player 2';
  return `${first} + ${second}`;
}

function getCompletedMatches(snapshot: BatchSnapshot) {
  return [...snapshot.history]
    .filter((match) => match.status === 'complete')
    .sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt));
}

function pushUnique(list: string[], value: string, limit = 6) {
  if (!list.includes(value)) {
    list.push(value);
  }

  if (list.length > limit) {
    list.splice(limit);
  }
}

export function getPlayerStats(snapshot: BatchSnapshot) {
  const players = getPlayerMap(snapshot);
  const stats = new Map(
    snapshot.players.map((player) => [player.id, {
      playerId: player.id,
      name: player.name,
      wins: 0,
      gamesPlayed: 0,
      lastPlayedAt: null as string | null,
      recentTeammates: [] as string[],
      recentOpponents: [] as string[],
      createdAt: player.createdAt,
    }])
  );

  for (const match of getCompletedMatches(snapshot)) {
    const playerIds = match.playerIds.filter((id) => players.has(id));
    if (playerIds.length !== 4) {
      continue;
    }

    const teamA = playerIds.slice(0, 2);
    const teamB = playerIds.slice(2, 4);
    const winnerIds = match.winner === 'A' ? teamA : match.winner === 'B' ? teamB : [];

    for (const playerId of playerIds) {
      const entry = stats.get(playerId);
      if (!entry) {
        continue;
      }

      entry.gamesPlayed += 1;
      entry.lastPlayedAt = entry.lastPlayedAt ?? match.endedAt ?? match.startedAt;
      if (winnerIds.includes(playerId)) {
        entry.wins += 1;
      }
    }

    for (const playerId of teamA) {
      const entry = stats.get(playerId);
      if (!entry) {
        continue;
      }

      teamA.forEach((mateId) => {
        if (mateId !== playerId) {
          pushUnique(entry.recentTeammates, mateId);
        }
      });

      teamB.forEach((opponentId) => pushUnique(entry.recentOpponents, opponentId));
    }

    for (const playerId of teamB) {
      const entry = stats.get(playerId);
      if (!entry) {
        continue;
      }

      teamB.forEach((mateId) => {
        if (mateId !== playerId) {
          pushUnique(entry.recentTeammates, mateId);
        }
      });

      teamA.forEach((opponentId) => pushUnique(entry.recentOpponents, opponentId));
    }
  }

  return stats;
}

export function getLeaderboardEntries(snapshot: BatchSnapshot): LeaderboardEntry[] {
  const stats = getPlayerStats(snapshot);

  const entries = snapshot.players.map((player) => {
    const entry = stats.get(player.id)!;
    return {
      playerId: player.id,
      name: player.name,
      wins: entry.wins,
      gamesPlayed: entry.gamesPlayed,
      rank: 0,
    } satisfies LeaderboardEntry;
  });

  entries.sort((a, b) => {
    if (b.wins !== a.wins) {
      return b.wins - a.wins;
    }

    if (a.gamesPlayed !== b.gamesPlayed) {
      return a.gamesPlayed - b.gamesPlayed;
    }

    return a.name.localeCompare(b.name);
  });

  let currentRank = 0;
  let lastWins: number | null = null;
  entries.forEach((entry, index) => {
    if (entry.wins !== lastWins) {
      currentRank = index + 1;
      lastWins = entry.wins;
    }

    entry.rank = currentRank;
  });

  return entries;
}

function getCandidateScore(
  snapshot: BatchSnapshot,
  playerIds: string[],
  teamGenders: Gender[],
  mode: MatchMode,
  stats: Map<string, ReturnType<typeof getPlayerStats> extends Map<string, infer Entry> ? Entry : never>
) {
  const now = Date.now();
  let score = 0;

  const playerEntries = playerIds.map((id) => ({
    id,
    stat: stats.get(id),
    player: snapshot.players.find((entry) => entry.id === id),
  }));

  for (const entry of playerEntries) {
    if (!entry.player || !entry.stat) {
      continue;
    }

    score += entry.stat.gamesPlayed * 90;
    score += entry.stat.wins * 12;

    const reference = entry.stat.lastPlayedAt ?? entry.player.createdAt;
    const waitMinutes = Math.max(0, (now - new Date(reference).getTime()) / 60000);
    score -= waitMinutes * 8;
  }

  if (mode === 'mixed') {
    const males = teamGenders.filter((gender) => gender === 'M').length;
    const females = teamGenders.filter((gender) => gender === 'F').length;
    score += males === 1 && females === 1 ? 0 : 35;
  }

  const combos = [
    [playerIds[0], playerIds[1]],
    [playerIds[2], playerIds[3]],
  ] as const;

  for (const [firstId, secondId] of combos) {
    const firstStat = stats.get(firstId);
    const secondStat = stats.get(secondId);
    if (!firstStat || !secondStat) {
      continue;
    }

    if (firstStat.recentTeammates.includes(secondId) || secondStat.recentTeammates.includes(firstId)) {
      score += 120;
    }
  }

  for (const firstId of [playerIds[0], playerIds[1]]) {
    const firstStat = stats.get(firstId);
    if (!firstStat) {
      continue;
    }

    for (const secondId of [playerIds[2], playerIds[3]]) {
      const secondStat = stats.get(secondId);
      if (!secondStat) {
        continue;
      }

      if (firstStat.recentOpponents.includes(secondId) || secondStat.recentOpponents.includes(firstId)) {
        score += 40;
      }
    }
  }

  return score;
}

function collectTeamCandidates(snapshot: BatchSnapshot, units: QueueUnit[], mode: MatchMode) {
  const playerMap = getPlayerMap(snapshot);
  const candidates: Array<{
    unitIds: string[];
    playerIds: string[];
    genders: Gender[];
    label: string;
    order: number;
  }> = [];

  units.forEach((unit, index) => {
    if (unit.type === 'pair') {
      if (!isPairEligibleForMode(unit.genders, mode)) {
        return;
      }

      candidates.push({
        unitIds: [unit.id],
        playerIds: unit.playerIds,
        genders: unit.genders,
        label: unit.label,
        order: index,
      });
      return;
    }

    for (let otherIndex = index + 1; otherIndex < units.length; otherIndex += 1) {
      const other = units[otherIndex];
      if (other.type !== 'player') {
        continue;
      }

      const combinedGenders = [unit.genders[0], other.genders[0]].filter(Boolean) as Gender[];
      if (!isPairEligibleForMode(combinedGenders, mode)) {
        continue;
      }

      candidates.push({
        unitIds: [unit.id, other.id],
        playerIds: [unit.playerIds[0], other.playerIds[0]],
        genders: combinedGenders,
        label: `${playerMap.get(unit.playerIds[0])?.name ?? unit.label} + ${playerMap.get(other.playerIds[0])?.name ?? other.label}`,
        order: index,
      });
    }
  });

  return candidates;
}

export function previewUpcomingMatches(snapshot: BatchSnapshot, mode: MatchMode, limit = 6): MatchPreview[] {
  const working = cloneSnapshot(snapshot);
  const previews: MatchPreview[] = [];
  const players = getPlayerMap(snapshot);

  const toName = (id: string) => players.get(id)?.name ?? id;

  while (previews.length < limit) {
    const match = findNextMatch(working, mode);
    if (!match) {
      break;
    }

    const nextIndex = previews.length + 1;
    previews.push({
      id: `preview-${nextIndex}`,
      courtId: `preview-${nextIndex}`,
      courtLabel: `Match ${nextIndex}`,
      teamA: match.teamA.map(toName),
      teamB: match.teamB.map(toName),
      sourceUnitIds: match.sourceUnitIds,
      mode,
    });

    working.queueOrder = removeUnitIds(working.queueOrder, match.sourceUnitIds);
  }

  return previews;
}

export function resolveQueueUnits(snapshot: BatchSnapshot): QueueUnit[] {
  const players = getPlayerMap(snapshot);
  const pairs = getPairMap(snapshot);
  const queuedPairIds = new Set(snapshot.queueOrder.filter((id) => pairs.has(id)));
  const result: QueueUnit[] = [];

  for (const id of snapshot.queueOrder) {
    if (pairs.has(id)) {
      const pair = pairs.get(id)!;
      const pairPlayers = pair.playerIds.map((playerId) => players.get(playerId)).filter(Boolean) as Player[];
      if (pairPlayers.length !== 2) {
        continue;
      }

      result.push({
        id: pair.id,
        type: 'pair',
        playerIds: pair.playerIds,
        label: getPairLabel(snapshot, pair),
        genders: pairPlayers.map((player) => player.gender),
      });
      continue;
    }

    const player = players.get(id);
    if (!player || queuedPairIds.has(player.pairId ?? '')) {
      continue;
    }

    result.push({
      id: player.id,
      type: 'player',
      playerIds: [player.id],
      label: player.name,
      genders: [player.gender],
    });
  }

  return result;
}

function appendUnitIds(queueOrder: string[], unitIds: string[]) {
  const seen = new Set(queueOrder);
  const next = queueOrder.slice();

  for (const id of unitIds) {
    if (!seen.has(id)) {
      next.push(id);
      seen.add(id);
    }
  }

  return next;
}

function replaceUnitAtIndex(queueOrder: string[], fromId: string, nextIds: string[]) {
  const index = queueOrder.indexOf(fromId);
  if (index === -1) {
    return appendUnitIds(queueOrder, nextIds);
  }

  const next = queueOrder.slice();
  next.splice(index, 1, ...nextIds);
  return next;
}

function removeUnitIds(queueOrder: string[], unitIds: string[]) {
  const removeSet = new Set(unitIds);
  return queueOrder.filter((id) => !removeSet.has(id));
}

export function addPlayer(snapshot: BatchSnapshot, name: string, gender: Gender) {
  const next = cloneSnapshot(snapshot);
  const trimmed = name.trim();
  if (!trimmed) {
    return next;
  }

  const player: Player = {
    id: createId('player'),
    name: trimmed,
    gender,
    status: 'checked-in',
    pairId: null,
    createdAt: now(),
    updatedAt: now(),
  };

  next.players.unshift(player);
  next.queueOrder.push(player.id);
  next.lastUpdated = now();
  return next;
}

export function addBulkPlayers(snapshot: BatchSnapshot, names: string[], gender: Gender) {
  return names.reduce((state, name) => addPlayer(state, name, gender), snapshot);
}

export function setPlayerStatus(snapshot: BatchSnapshot, playerId: string, status: 'checked-in' | 'break') {
  const next = cloneSnapshot(snapshot);
  const player = next.players.find((entry) => entry.id === playerId);
  if (!player) {
    return next;
  }

  player.status = status;
  player.updatedAt = now();

  if (status === 'break') {
    next.queueOrder = next.queueOrder.filter((id) => id !== playerId && id !== player.pairId);
    if (player.pairId) {
      const pair = next.pairs.find((entry) => entry.id === player.pairId);
      if (pair) {
        const mateId = pair.playerIds.find((entry) => entry !== playerId);
        if (mateId) {
          const mate = next.players.find((entry) => entry.id === mateId);
          if (mate) {
            mate.status = 'break';
            mate.updatedAt = now();
          }
        }
      }
    }
  } else if (!next.queueOrder.includes(player.pairId ?? playerId)) {
    if (player.pairId && next.pairs.some((pair) => pair.id === player.pairId)) {
      next.queueOrder.push(player.pairId);
    } else {
      next.queueOrder.push(playerId);
    }
  }

  next.lastUpdated = now();
  return next;
}

export function lockPair(snapshot: BatchSnapshot, firstPlayerId: string, secondPlayerId: string) {
  const next = cloneSnapshot(snapshot);
  const players = getPlayerMap(next);
  const first = players.get(firstPlayerId);
  const second = players.get(secondPlayerId);

  if (!first || !second || first.id === second.id || first.pairId || second.pairId) {
    return next;
  }

  const pair: Pair = {
    id: createId('pair'),
    playerIds: [first.id, second.id],
    createdAt: now(),
  };

  first.pairId = pair.id;
  second.pairId = pair.id;
  first.updatedAt = now();
  second.updatedAt = now();

  const firstIndex = next.queueOrder.indexOf(first.id);
  const secondIndex = next.queueOrder.indexOf(second.id);
  const insertAt = Math.max(0, Math.min(firstIndex === -1 ? secondIndex : firstIndex, secondIndex === -1 ? firstIndex : secondIndex));

  next.queueOrder = next.queueOrder.filter((id) => id !== first.id && id !== second.id);
  next.queueOrder.splice(insertAt === -1 ? next.queueOrder.length : insertAt, 0, pair.id);
  next.pairs.unshift(pair);
  next.lastUpdated = now();
  return next;
}

export function unlockPair(snapshot: BatchSnapshot, pairId: string) {
  const next = cloneSnapshot(snapshot);
  const pairIndex = next.pairs.findIndex((entry) => entry.id === pairId);
  if (pairIndex === -1) {
    return next;
  }

  const pair = next.pairs[pairIndex];
  next.pairs.splice(pairIndex, 1);
  next.queueOrder = replaceUnitAtIndex(next.queueOrder, pair.id, pair.playerIds);

  for (const playerId of pair.playerIds) {
    const player = next.players.find((entry) => entry.id === playerId);
    if (player) {
      player.pairId = null;
      player.updatedAt = now();
    }
  }

  next.lastUpdated = now();
  return next;
}

function isPairEligibleForMode(genders: Gender[], mode: MatchMode) {
  if (mode !== 'mixed') {
    return true;
  }

  return genders.includes('M') && genders.includes('F') && genders.length === 2;
}

function expandSelectedPlayers(snapshot: BatchSnapshot, playerIds: string[]) {
  const nextUnitIds: string[] = [];
  const nextPlayerIds: string[] = [];
  const pairMap = getPairMap(snapshot);
  const playerMap = getPlayerMap(snapshot);

  for (const playerId of playerIds) {
    const player = playerMap.get(playerId);
    if (!player) {
      continue;
    }

    if (player.pairId && pairMap.has(player.pairId)) {
      if (!nextUnitIds.includes(player.pairId)) {
        nextUnitIds.push(player.pairId);
        nextPlayerIds.push(...pairMap.get(player.pairId)!.playerIds);
      }
      continue;
    }

    if (!nextUnitIds.includes(player.id)) {
      nextUnitIds.push(player.id);
      nextPlayerIds.push(player.id);
    }
  }

  return {
    unitIds: nextUnitIds,
    playerIds: nextPlayerIds,
  };
}

export function findNextMatch(snapshot: BatchSnapshot, mode: MatchMode, selectedPlayers?: CustomMatchSelection) {
  const orderedUnits = resolveQueueUnits(snapshot);

  if (mode === 'custom') {
    if (!selectedPlayers || selectedPlayers.playerIds.length === 0) {
      return null;
    }

    const expanded = expandSelectedPlayers(snapshot, selectedPlayers.playerIds);
    if (expanded.playerIds.length !== 4) {
      return null;
    }

    return {
      sourceUnitIds: expanded.unitIds,
      teamA: expanded.playerIds.slice(0, 2),
      teamB: expanded.playerIds.slice(2, 4),
      playerIds: expanded.playerIds,
    };
  }

  const candidates = collectTeamCandidates(snapshot, orderedUnits, mode);
  if (candidates.length < 2) {
    return null;
  }

  const stats = getPlayerStats(snapshot);
  let best: {
    sourceUnitIds: string[];
    teamA: string[];
    teamB: string[];
    playerIds: string[];
    score: number;
    order: number;
  } | null = null;

  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    const first = candidates[firstIndex];

    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const second = candidates[secondIndex];

      const overlaps = first.unitIds.some((unitId) => second.unitIds.includes(unitId));
      if (overlaps) {
        continue;
      }

      const candidateScore =
        getCandidateScore(snapshot, first.playerIds, first.genders, mode, stats) +
        getCandidateScore(snapshot, second.playerIds, second.genders, mode, stats);

      const matchupPenalty = first.playerIds.reduce((penalty, playerId) => {
        const playerStat = stats.get(playerId);
        if (!playerStat) {
          return penalty;
        }

        return penalty + second.playerIds.reduce((innerPenalty, opponentId) => {
          const opponentStat = stats.get(opponentId);
          if (!opponentStat) {
            return innerPenalty;
          }

          return innerPenalty + (playerStat.recentOpponents.includes(opponentId) || opponentStat.recentOpponents.includes(playerId) ? 45 : 0);
        }, 0);
      }, 0);

      const totalScore = candidateScore + matchupPenalty + Math.abs(first.playerIds.length - second.playerIds.length) * 10 + first.order + second.order;

      if (!best || totalScore < best.score || (totalScore === best.score && first.order + second.order < best.order)) {
        best = {
          sourceUnitIds: [...first.unitIds, ...second.unitIds],
          teamA: first.playerIds,
          teamB: second.playerIds,
          playerIds: [...first.playerIds, ...second.playerIds],
          score: totalScore,
          order: first.order + second.order,
        };
      }
    }
  }

  return best
    ? {
        sourceUnitIds: best.sourceUnitIds,
        teamA: best.teamA,
        teamB: best.teamB,
        playerIds: best.playerIds,
      }
    : null;
}

export function startCourtMatch(
  snapshot: BatchSnapshot,
  courtId: string,
  mode: MatchMode,
  selectedPlayers?: CustomMatchSelection
) {
  const next = cloneSnapshot(snapshot);
  const court = next.courts.find((entry) => entry.id === courtId);
  if (!court || court.status === 'live') {
    return next;
  }

  const match = findNextMatch(next, mode, selectedPlayers);
  if (!match) {
    return next;
  }

  const matchId = createId('match');
  const startedAt = now();

  court.status = 'live';
  court.matchId = matchId;
  court.mode = mode;
  court.startedAt = startedAt;
  court.sourceUnitIds = match.sourceUnitIds;
  court.teamA = match.teamA;
  court.teamB = match.teamB;
  court.scoreA = null;
  court.scoreB = null;

  next.queueOrder = removeUnitIds(next.queueOrder, match.sourceUnitIds);
  next.history.unshift({
    id: matchId,
    batchId: next.batchId,
    courtId: court.id,
    courtLabel: court.label,
    mode,
    sourceUnitIds: match.sourceUnitIds,
    playerIds: match.playerIds,
    teamA: match.teamA,
    teamB: match.teamB,
    scoreA: null,
    scoreB: null,
    winner: 'TBD',
    status: 'live',
    startedAt,
    endedAt: null,
  });
  next.lastUpdated = now();
  return next;
}

function resolveWinner(scoreA: number | null, scoreB: number | null) {
  if (scoreA === null || scoreB === null || scoreA === scoreB) {
    return 'TBD' as const;
  }

  return scoreA > scoreB ? ('A' as const) : ('B' as const);
}

export function completeCourtMatch(snapshot: BatchSnapshot, courtId: string, scoreA: number, scoreB: number) {
  const next = cloneSnapshot(snapshot);
  const court = next.courts.find((entry) => entry.id === courtId);
  if (!court || !court.matchId) {
    return next;
  }

  const historyEntry = next.history.find((entry) => entry.id === court.matchId);
  const winner = resolveWinner(scoreA, scoreB);

  if (historyEntry) {
    historyEntry.scoreA = scoreA;
    historyEntry.scoreB = scoreB;
    historyEntry.winner = winner;
    historyEntry.status = 'complete';
    historyEntry.endedAt = now();
  }

  next.queueOrder = appendUnitIds(next.queueOrder, court.sourceUnitIds);
  court.status = 'idle';
  court.matchId = null;
  court.mode = null;
  court.startedAt = null;
  court.sourceUnitIds = [];
  court.teamA = [];
  court.teamB = [];
  court.scoreA = null;
  court.scoreB = null;
  next.lastUpdated = now();
  return next;
}

export function editHistoryScore(snapshot: BatchSnapshot, matchId: string, scoreA: number | null, scoreB: number | null) {
  const next = cloneSnapshot(snapshot);
  const match = next.history.find((entry) => entry.id === matchId);
  if (!match) {
    return next;
  }

  match.scoreA = scoreA;
  match.scoreB = scoreB;
  match.winner = resolveWinner(scoreA, scoreB);
  next.lastUpdated = now();
  return next;
}

export function setBatchMode(snapshot: BatchSnapshot, mode: MatchMode) {
  const next = cloneSnapshot(snapshot);
  next.activeMode = mode;
  next.lastUpdated = now();
  return next;
}

export function autoFillCourts(snapshot: BatchSnapshot, selectedPlayers?: CustomMatchSelection) {
  let next = cloneSnapshot(snapshot);

  for (const court of next.courts) {
    if (court.status === 'live') {
      continue;
    }

    const filled = startCourtMatch(next, court.id, next.activeMode, selectedPlayers);
    if (filled !== next) {
      next = filled;
    }
  }

  return next;
}

export function getBatchCounts(snapshot: BatchSnapshot) {
  const checkedIn = snapshot.players.filter((player) => player.status === 'checked-in').length;
  const onBreak = snapshot.players.filter((player) => player.status === 'break').length;
  const activeCourts = snapshot.courts.filter((court) => court.status === 'live').length;
  const waiting = resolveQueueUnits(snapshot).length;

  return {
    checkedIn,
    onBreak,
    activeCourts,
    waiting,
    total: snapshot.players.length,
  };
}
