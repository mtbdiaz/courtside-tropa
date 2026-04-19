export type BatchId = 1 | 2;

export type Gender = 'M' | 'F';

export type PlayerStatus = 'checked-in' | 'break';

export type MatchMode = 'mixed' | 'custom';

export type CourtStatus = 'idle' | 'live';

export type MatchStatus = 'live' | 'complete';

export interface Player {
  id: string;
  name: string;
  gender: Gender;
  status: PlayerStatus;
  pairId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Pair {
  id: string;
  playerIds: [string, string];
  createdAt: string;
}

export interface QueueUnit {
  id: string;
  type: 'player' | 'pair';
  playerIds: string[];
  label: string;
  genders: Gender[];
}

export interface CourtSlot {
  id: string;
  label: string;
  status: CourtStatus;
  matchId: string | null;
  mode: MatchMode | null;
  startedAt: string | null;
  sourceUnitIds: string[];
  teamA: string[];
  teamB: string[];
  scoreA: number | null;
  scoreB: number | null;
}

export interface MatchRecord {
  id: string;
  batchId: BatchId;
  courtId: string;
  courtLabel: string;
  mode: MatchMode;
  sourceUnitIds: string[];
  playerIds: string[];
  teamA: string[];
  teamB: string[];
  scoreA: number | null;
  scoreB: number | null;
  winner: 'A' | 'B' | 'TBD';
  status: MatchStatus;
  startedAt: string;
  endedAt: string | null;
  notes?: string;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  wins: number;
  gamesPlayed: number;
  rank: number;
}

export interface MatchPreview {
  id: string;
  courtId: string;
  courtLabel: string;
  teamA: string[];
  teamB: string[];
  sourceUnitIds: string[];
  mode: MatchMode;
}

export interface BatchSnapshot {
  batchId: BatchId;
  title: string;
  courtCount: number;
  activeMode: MatchMode;
  players: Player[];
  pairs: Pair[];
  queueOrder: string[];
  courts: CourtSlot[];
  history: MatchRecord[];
  lastUpdated: string;
}

export interface CourtsideSnapshot {
  batches: Record<BatchId, BatchSnapshot>;
  activeBatchId: BatchId;
  lastUpdated: string;
}

export interface CustomMatchSelection {
  playerIds: string[];
}

export const BATCH_IDS: BatchId[] = [1, 2];

export const MODE_LABELS: Record<MatchMode, string> = {
  mixed: 'Mixed Doubles',
  custom: 'Custom Match',
};
