import type {
  BatchId,
  BatchSnapshot,
  CourtSlot,
  CustomMatchSelection,
  Gender,
  MatchMode,
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

function canSingletonsFormTeam(first: QueueUnit, second: QueueUnit, mode: MatchMode) {
  if (first.type !== 'player' || second.type !== 'player') {
    return false;
  }

  const genders = [...first.genders, ...second.genders];
  return isPairEligibleForMode(genders as Gender[], mode);
}

function findTeamContainer(units: QueueUnit[], mode: MatchMode, usedIds: Set<string>, startIndex = 0) {
  for (let index = startIndex; index < units.length; index += 1) {
    const unit = units[index];
    if (usedIds.has(unit.id)) {
      continue;
    }

    if (unit.type === 'pair') {
      if (isPairEligibleForMode(unit.genders, mode)) {
        return {
          unitIds: [unit.id],
          playerIds: unit.playerIds,
        };
      }

      continue;
    }

    for (let otherIndex = index + 1; otherIndex < units.length; otherIndex += 1) {
      const other = units[otherIndex];
      if (usedIds.has(other.id)) {
        continue;
      }

      if (canSingletonsFormTeam(unit, other, mode)) {
        return {
          unitIds: [unit.id, other.id],
          playerIds: [...unit.playerIds, ...other.playerIds],
        };
      }
    }
  }

  return null;
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

  const usedIds = new Set<string>();
  const firstTeam = findTeamContainer(orderedUnits, mode, usedIds);
  if (!firstTeam) {
    return null;
  }

  firstTeam.unitIds.forEach((unitId) => usedIds.add(unitId));
  const secondTeam = findTeamContainer(orderedUnits, mode, usedIds);
  if (!secondTeam) {
    return null;
  }

  return {
    sourceUnitIds: [...firstTeam.unitIds, ...secondTeam.unitIds],
    teamA: firstTeam.playerIds,
    teamB: secondTeam.playerIds,
    playerIds: [...firstTeam.playerIds, ...secondTeam.playerIds],
  };
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
