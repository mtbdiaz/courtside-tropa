'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BatchId, Gender } from '@/types/courtside';
import { useCourtsideBoard } from '@/hooks/useCourtsideBoard';
import { getLeaderboardEntries } from '@/lib/courtside-engine';
import { AnimatePresence, motion } from 'framer-motion';
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

function getTimerTone(startedAt: string | null, nowMs: number) {
  if (!startedAt) {
    return { className: 'text-emerald-100 bg-emerald-500/10 border-emerald-300/30', pulse: false };
  }

  const elapsedMinutes = Math.max(0, (nowMs - new Date(startedAt).getTime()) / 60000);
  if (elapsedMinutes < 10) {
    return { className: 'text-emerald-100 bg-emerald-500/10 border-emerald-300/30', pulse: false };
  }

  if (elapsedMinutes < 15) {
    return { className: 'text-amber-100 bg-amber-500/10 border-amber-300/30', pulse: false };
  }

  return { className: 'text-rose-100 bg-rose-500/10 border-rose-300/30', pulse: true };
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function Avatar({ name, size = 'sm', gender }: { name: string; size?: 'sm' | 'md' | 'lg'; gender?: Gender }) {
  const dimensionClass = size === 'lg' ? 'h-11 w-11 text-sm' : size === 'md' ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]';
  const seed = hashString(name);
  const hue = seed % 360;
  const background =
    gender === 'M'
      ? 'linear-gradient(135deg, hsl(211 90% 56%), hsl(220 80% 42%))'
      : gender === 'F'
        ? 'linear-gradient(135deg, hsl(328 86% 62%), hsl(339 78% 48%))'
        : `linear-gradient(135deg, hsl(${hue} 82% 56%), hsl(${(hue + 34) % 360} 75% 44%))`;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 font-bold text-white shadow-sm ${dimensionClass}`}
      style={{ background }}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  );
}

function PlayerNameRow({ name, alignRight = false, size = 'sm', muted = false, gender }: { name: string; alignRight?: boolean; size?: 'sm' | 'md' | 'lg'; muted?: boolean; gender?: Gender }) {
  return (
    <div className={`flex items-center gap-2 ${alignRight ? 'justify-end' : 'justify-start'}`}>
      {alignRight ? null : <Avatar name={name} size={size} gender={gender} />}
      <span className={`${muted ? 'text-slate-200/85' : 'text-white'} ${size === 'lg' ? 'text-base font-semibold' : 'text-sm'}`}>
        {name}
      </span>
      {alignRight ? <Avatar name={name} size={size} gender={gender} /> : null}
    </div>
  );
}

function TeamList({ players, alignRight = false, size = 'sm', getGender }: { players: string[]; alignRight?: boolean; size?: 'sm' | 'md' | 'lg'; getGender?: (name: string) => Gender | undefined }) {
  return (
    <div className={`space-y-2 ${alignRight ? 'text-right' : 'text-left'}`}>
      {players.map((player) => (
        <PlayerNameRow key={player} name={player} alignRight={alignRight} size={size} gender={getGender?.(player)} />
      ))}
    </div>
  );
}

type BoardMode = 'admin' | 'public' | 'score';

type NowCallingAnnouncement =
  | {
      id: string;
      type: 'court-assigned';
      courtLabel: string;
      teamA: string[];
      teamB: string[];
    }
  | {
      id: string;
      type: 'next-up';
      matchId: string;
      mode: 'mixed' | 'custom';
      teamA: string[];
      teamB: string[];
    };

const BATCH_UI_SETTINGS_STORAGE_KEY = 'courtside:batch-ui-settings:v1';
const DEFAULT_QUEUE_PAUSED_BY_BATCH: Record<BatchId, boolean> = { 1: false, 2: false };
const DEFAULT_AUTOFILL_ENABLED_BY_BATCH: Record<BatchId, boolean> = { 1: false, 2: false };

function hasCompleteTeams(teamA: string[], teamB: string[]) {
  const hasValidNames = (team: string[]) =>
    team.length > 0 && team.every((name) => typeof name === 'string' && name.trim().length > 0);
  return hasValidNames(teamA) && hasValidNames(teamB);
}

function parseScoreValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeBooleanRecord(value: unknown, fallback: Record<BatchId, boolean>): Record<BatchId, boolean> {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const candidate = value as Partial<Record<string, unknown>>;
  return {
    1: typeof candidate['1'] === 'boolean' ? candidate['1'] : fallback[1],
    2: typeof candidate['2'] === 'boolean' ? candidate['2'] : fallback[2],
  };
}

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
    lastActionError,
    clearActionError,
    authEmail,
    setActiveBatchId,
    setCourtCount,
    setCourtActive,
    addSinglePlayer,
    addBulk,
    updatePlayer,
    deletePlayer,
    toggleBreak,
    lockSelectedPair,
    unlockSelectedPair,
    moveQueueUnit,
    removeQueueMatch,
    ensureReadyMatches,
    enqueueCustomMatch,
    generateSingleGenderCustomMatch,
    startQueuedMatchOnCourt,
    completeMatch,
    cancelMatch,
    fillIdleCourts,
    queueProcessing,
    deleteAllPlayersForBatch,
    setAllPlayersBreakForBatch,
    deleteAllMatchHistoryForBatch,
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

function readPersistedBatchUiSettings() {
  if (typeof window === 'undefined') {
    return {
      queuePausedByBatch: DEFAULT_QUEUE_PAUSED_BY_BATCH,
      autoFillEnabledByBatch: DEFAULT_AUTOFILL_ENABLED_BY_BATCH,
    };
  }

  try {
    const raw = window.localStorage.getItem(BATCH_UI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        queuePausedByBatch: DEFAULT_QUEUE_PAUSED_BY_BATCH,
        autoFillEnabledByBatch: DEFAULT_AUTOFILL_ENABLED_BY_BATCH,
      };
    }

    const parsed = JSON.parse(raw) as {
      queuePausedByBatch?: unknown;
      autoFillEnabledByBatch?: unknown;
    };

    return {
      queuePausedByBatch: normalizeBooleanRecord(parsed.queuePausedByBatch, DEFAULT_QUEUE_PAUSED_BY_BATCH),
      // Auto-fill should always start disabled on a fresh login/session.
      autoFillEnabledByBatch: DEFAULT_AUTOFILL_ENABLED_BY_BATCH,
    };
  } catch {
    return {
      queuePausedByBatch: DEFAULT_QUEUE_PAUSED_BY_BATCH,
      autoFillEnabledByBatch: DEFAULT_AUTOFILL_ENABLED_BY_BATCH,
    };
  }
}
  const [playerSearch, setPlayerSearch] = useState('');
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState<'M' | 'F'>('M');
  const [initialBatchUiSettings] = useState(() => readPersistedBatchUiSettings());
  const [queuePausedByBatch, setQueuePausedByBatch] = useState<Record<BatchId, boolean>>(initialBatchUiSettings.queuePausedByBatch);
  const [autoFillEnabledByBatch, setAutoFillEnabledByBatch] = useState<Record<BatchId, boolean>>(initialBatchUiSettings.autoFillEnabledByBatch);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toggleBreakDisabledUntil, setToggleBreakDisabledUntil] = useState<Record<string, number>>({});
  const [pendingCourtAnnouncements, setPendingCourtAnnouncements] = useState<
    Array<Extract<NowCallingAnnouncement, { type: 'court-assigned' }>>
  >([]);
  const [pendingNextUpAnnouncements, setPendingNextUpAnnouncements] = useState<
    Array<Extract<NowCallingAnnouncement, { type: 'next-up' }>>
  >([]);
  const [activeNowCallingAnnouncement, setActiveNowCallingAnnouncement] = useState<NowCallingAnnouncement | null>(null);
  const AUTO_FILL_STUCK_TIMEOUT_MS = 12000;
  const autoFillRunningRef = useRef(false);
  const autoFillIntervalRef = useRef<number | null>(null);
  const autoFillWatchdogRef = useRef<number | null>(null);
  const autoFillStartedAtMsRef = useRef<number | null>(null);
  const fillIdleCourtsRef = useRef(fillIdleCourts);
  const seenLiveCourtSignatureByIdRef = useRef<Record<string, string>>({});
  const announcedLiveCourtSignatureByIdRef = useRef<Record<string, string>>({});
  const liveCourtTrackerInitializedRef = useRef(false);
  const previousNowCallingMatchIdRef = useRef<string | null>(null);
  const nowCallingMatchTrackerInitializedRef = useRef(false);

  useEffect(() => {
    fillIdleCourtsRef.current = fillIdleCourts;
  }, [fillIdleCourts]);

  const deferredPlayerSearch = useDeferredValue(playerSearch);
  const deferredCustomSearch = useDeferredValue(customSearch);
  const deferredPairSearch = useDeferredValue(pairSearch);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        BATCH_UI_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          queuePausedByBatch,
          autoFillEnabledByBatch,
        }),
      );
    } catch {
      // Ignore localStorage write failures (private mode, quota, etc).
    }
  }, [autoFillEnabledByBatch, queuePausedByBatch]);

  useEffect(() => {
    if (!lastActionError) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      clearActionError();
    }, 3500);

    return () => window.clearTimeout(timeoutId);
  }, [clearActionError, lastActionError]);

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
    () => {
      const queuedPlayerIds = new Set(activeBatch.queuedMatches.flatMap((match) => match.playerIds));
      return activeBatch.players
        .filter(
          (player) =>
            player.status === 'checked-in' &&
            !activePlayers.has(player.id) &&
            !queuedPlayerIds.has(player.id),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [activeBatch.players, activeBatch.queuedMatches, activePlayers],
  );

  const sortedPlayers = useMemo(
    () => [...activeBatch.players].sort((a, b) => a.name.localeCompare(b.name)),
    [activeBatch.players],
  );

  const playerGenderByName = useMemo(() => {
    const map = new Map<string, Gender>();
    for (const player of activeBatch.players) {
      if (!map.has(player.name)) {
        map.set(player.name, player.gender);
      }
    }
    return map;
  }, [activeBatch.players]);

  const getGenderForName = (name: string) => playerGenderByName.get(name);

  const filteredPlayers = useMemo(() => {
    const query = deferredPlayerSearch.trim().toLowerCase();
    if (!query) {
      return sortedPlayers;
    }

    return sortedPlayers.filter((player) => {
      return (
        player.name.toLowerCase().includes(query) ||
        player.gender.toLowerCase().includes(query) ||
        player.status.toLowerCase().includes(query)
      );
    });
  }, [deferredPlayerSearch, sortedPlayers]);

  const customSearchResults = useMemo(() => {
    const query = deferredCustomSearch.trim().toLowerCase();
    if (!query) {
      return availableForCustom;
    }

    return availableForCustom
      .filter((player) => player.name.toLowerCase().includes(query))
      .slice(0, 10);
  }, [availableForCustom, deferredCustomSearch]);

  const pairSearchResults = useMemo(() => {
    const query = deferredPairSearch.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return activeBatch.players
      .filter((player) => player.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 30);
  }, [activeBatch.players, deferredPairSearch]);

  const liveCourts = useMemo(
    () => activeBatch.courts.filter((court) => court.status === 'live'),
    [activeBatch.courts],
  );

  const idleCourts = useMemo(
    () => activeBatch.courts.filter((court) => court.status === 'idle' && court.isActive),
    [activeBatch.courts],
  );

  const inactiveCourtCount = useMemo(
    () => activeBatch.courts.filter((court) => !court.isActive).length,
    [activeBatch.courts],
  );

  const breakPlayers = useMemo(
    () => activeBatch.players.filter((player) => player.status === 'break').sort((a, b) => a.name.localeCompare(b.name)),
    [activeBatch.players],
  );

  const inQueuePlayers = useMemo(
    () => activeBatch.players.filter((player) => player.status === 'in-queue').sort((a, b) => a.name.localeCompare(b.name)),
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

  useEffect(() => {
    if (!publicView) {
      liveCourtTrackerInitializedRef.current = false;
      seenLiveCourtSignatureByIdRef.current = {};
      announcedLiveCourtSignatureByIdRef.current = {};
      const rafId = window.requestAnimationFrame(() => {
        setPendingCourtAnnouncements([]);
      });
      return () => window.cancelAnimationFrame(rafId);
    }

    if (!isReady) {
      return;
    }

    const currentLiveCourtSignatureById: Record<string, string> = {};
    for (const court of activeBatch.courts) {
      if (court.status !== 'live') {
        continue;
      }
      const sortedIds = [...court.sourceUnitIds].sort();
      currentLiveCourtSignatureById[court.id] = `${court.status}:${court.matchId ?? 'none'}:${sortedIds.join('|')}`;
    }

    if (!liveCourtTrackerInitializedRef.current) {
      liveCourtTrackerInitializedRef.current = true;
      seenLiveCourtSignatureByIdRef.current = currentLiveCourtSignatureById;
      return;
    }

    const newAnnouncements: Array<Extract<NowCallingAnnouncement, { type: 'court-assigned' }>> = [];
    for (const court of activeBatch.courts) {
      if (court.status !== 'live') {
        continue;
      }

      const nextSignature = currentLiveCourtSignatureById[court.id];
      const previousSignature = seenLiveCourtSignatureByIdRef.current[court.id];
      const previouslyAnnouncedSignature = announcedLiveCourtSignatureByIdRef.current[court.id];
      if (nextSignature !== previousSignature) {
        if (!hasCompleteTeams(court.teamA, court.teamB)) {
          continue;
        }
        if (previouslyAnnouncedSignature === nextSignature) {
          continue;
        }
        newAnnouncements.push({
          id: `court-assigned-${court.id}-${Date.now()}-${newAnnouncements.length}`,
          type: 'court-assigned',
          courtLabel: court.label,
          teamA: [...court.teamA],
          teamB: [...court.teamB],
        });
        announcedLiveCourtSignatureByIdRef.current[court.id] = nextSignature;
      }
    }

    const liveCourtIds = new Set(Object.keys(currentLiveCourtSignatureById));
    for (const courtId of Object.keys(announcedLiveCourtSignatureByIdRef.current)) {
      if (!liveCourtIds.has(courtId)) {
        delete announcedLiveCourtSignatureByIdRef.current[courtId];
      }
    }

    seenLiveCourtSignatureByIdRef.current = currentLiveCourtSignatureById;

    if (newAnnouncements.length > 0) {
      const rafId = window.requestAnimationFrame(() => {
        setPendingCourtAnnouncements((current) => [...current, ...newAnnouncements]);
        setActiveNowCallingAnnouncement((current) =>
          current?.type === 'next-up' ? null : current,
        );
      });

      return () => window.cancelAnimationFrame(rafId);
    }
  }, [activeBatch.courts, isReady, publicView]);

  useEffect(() => {
    if (!publicView) {
      nowCallingMatchTrackerInitializedRef.current = false;
      previousNowCallingMatchIdRef.current = null;
      const rafId = window.requestAnimationFrame(() => {
        setPendingNextUpAnnouncements([]);
      });
      return () => window.cancelAnimationFrame(rafId);
    }

    if (!isReady) {
      return;
    }

    const nextMatch = upcomingMatches[0];
    const nextMatchId = nextMatch?.id ?? null;

    if (!nowCallingMatchTrackerInitializedRef.current) {
      nowCallingMatchTrackerInitializedRef.current = true;
      previousNowCallingMatchIdRef.current = nextMatchId;
      return;
    }

    const previousMatchId = previousNowCallingMatchIdRef.current;
    if (
      nextMatch &&
      nextMatchId &&
      previousMatchId &&
      nextMatchId !== previousMatchId &&
      hasCompleteTeams(nextMatch.teamA, nextMatch.teamB)
    ) {
      setPendingNextUpAnnouncements((current) => {
        if (
          current.some((entry) => entry.matchId === nextMatch.id) ||
          (activeNowCallingAnnouncement?.type === 'next-up' && activeNowCallingAnnouncement.matchId === nextMatch.id)
        ) {
          return current;
        }

        return [
          ...current,
          {
            id: `next-up-${nextMatch.id}-${Date.now()}`,
            type: 'next-up',
            matchId: nextMatch.id,
            mode: nextMatch.mode,
            teamA: [...nextMatch.teamA],
            teamB: [...nextMatch.teamB],
          },
        ];
      });
    }

    previousNowCallingMatchIdRef.current = nextMatchId;
  }, [activeNowCallingAnnouncement, isReady, publicView, upcomingMatches]);

  useEffect(() => {
    if (!publicView || !activeNowCallingAnnouncement || activeNowCallingAnnouncement.type === 'court-assigned') {
      return;
    }

    if (pendingCourtAnnouncements.length === 0) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      setActiveNowCallingAnnouncement(null);
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [activeNowCallingAnnouncement, pendingCourtAnnouncements.length, publicView]);

  useEffect(() => {
    if (!publicView) {
      const rafId = window.requestAnimationFrame(() => {
        setActiveNowCallingAnnouncement(null);
        setPendingCourtAnnouncements([]);
        setPendingNextUpAnnouncements([]);
      });
      return () => window.cancelAnimationFrame(rafId);
    }

    if (activeNowCallingAnnouncement) {
      return;
    }

    if (pendingCourtAnnouncements.length > 0) {
      const [nextAnnouncement, ...remaining] = pendingCourtAnnouncements;
      const rafId = window.requestAnimationFrame(() => {
        setActiveNowCallingAnnouncement(nextAnnouncement);
        setPendingCourtAnnouncements(remaining);
      });
      return () => window.cancelAnimationFrame(rafId);
    }

    if (pendingNextUpAnnouncements.length > 0) {
      const [nextAnnouncement, ...remaining] = pendingNextUpAnnouncements;
      const rafId = window.requestAnimationFrame(() => {
        setActiveNowCallingAnnouncement(nextAnnouncement);
        setPendingNextUpAnnouncements(remaining);
      });
      return () => window.cancelAnimationFrame(rafId);
    }
  }, [
    activeNowCallingAnnouncement,
    pendingCourtAnnouncements,
    pendingNextUpAnnouncements,
    publicView,
  ]);

  useEffect(() => {
    if (!publicView || !activeNowCallingAnnouncement || activeNowCallingAnnouncement.type !== 'next-up') {
      return;
    }

    const stillQueued = upcomingMatches.some((match) => match.id === activeNowCallingAnnouncement.matchId);
    if (stillQueued) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      setActiveNowCallingAnnouncement(null);
      setPendingNextUpAnnouncements((current) =>
        current.filter((entry) => entry.matchId !== activeNowCallingAnnouncement.matchId),
      );
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [activeNowCallingAnnouncement, publicView, upcomingMatches]);

  useEffect(() => {
    if (!publicView) {
      return;
    }

    const queuedMatchIds = new Set(upcomingMatches.map((match) => match.id));
    const rafId = window.requestAnimationFrame(() => {
      setPendingNextUpAnnouncements((current) =>
        current.filter((entry) => queuedMatchIds.has(entry.matchId)),
      );
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [publicView, upcomingMatches]);

  useEffect(() => {
    if (!publicView || !activeNowCallingAnnouncement) {
      return;
    }

    const activeAnnouncementId = activeNowCallingAnnouncement.id;
    const timeoutId = window.setTimeout(() => {
      setActiveNowCallingAnnouncement((current) =>
        current?.id === activeAnnouncementId ? null : current,
      );
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [activeNowCallingAnnouncement, publicView]);

  const queuePaused = queuePausedByBatch[activeBatch.batchId];
  const autoFillEnabled = autoFillEnabledByBatch[activeBatch.batchId];
  const topLeaderboard = leaderboard.slice(0, 3);
  const remainingLeaderboard = leaderboard.slice(3);

  useEffect(() => {
    if (publicView || scoreOnly || queuePaused || autoFillEnabled) {
      return;
    }

    void ensureReadyMatches(activeBatch.batchId, 5);
    const generationId = window.setInterval(() => {
      void ensureReadyMatches(activeBatch.batchId, 5);
    }, 5000);

    return () => {
      window.clearInterval(generationId);
    };
  }, [activeBatch.batchId, autoFillEnabled, ensureReadyMatches, publicView, queuePaused, scoreOnly]);

  useEffect(() => {
    if (autoFillIntervalRef.current !== null) {
      window.clearInterval(autoFillIntervalRef.current);
      autoFillIntervalRef.current = null;
    }
    if (autoFillWatchdogRef.current !== null) {
      window.clearTimeout(autoFillWatchdogRef.current);
      autoFillWatchdogRef.current = null;
    }
    autoFillStartedAtMsRef.current = null;
    autoFillRunningRef.current = false;

    if (publicView || scoreOnly || !autoFillEnabled) {
      return;
    }

    const runAutoFill = () => {
      if (autoFillRunningRef.current) {
        const startedAt = autoFillStartedAtMsRef.current;
        if (startedAt !== null && Date.now() - startedAt >= AUTO_FILL_STUCK_TIMEOUT_MS) {
          // Recover from stuck runs (e.g., network stall) without requiring toggle spam.
          autoFillRunningRef.current = false;
          autoFillStartedAtMsRef.current = null;
        } else {
          return;
        }
      }

      autoFillRunningRef.current = true;
      autoFillStartedAtMsRef.current = Date.now();
      if (autoFillWatchdogRef.current !== null) {
        window.clearTimeout(autoFillWatchdogRef.current);
      }
      autoFillWatchdogRef.current = window.setTimeout(() => {
        autoFillRunningRef.current = false;
        autoFillStartedAtMsRef.current = null;
        autoFillWatchdogRef.current = null;
      }, AUTO_FILL_STUCK_TIMEOUT_MS);

      Promise.resolve()
        .then(async () => {
          // When auto-fill is ON, it should both top up queue and place matches on idle courts.
          await ensureReadyMatches(activeBatch.batchId, 5);
          await fillIdleCourtsRef.current(activeBatch.batchId);
        })
        .finally(() => {
        if (autoFillWatchdogRef.current !== null) {
          window.clearTimeout(autoFillWatchdogRef.current);
          autoFillWatchdogRef.current = null;
        }
        autoFillRunningRef.current = false;
        autoFillStartedAtMsRef.current = null;
        });
    };

    runAutoFill();
    autoFillIntervalRef.current = window.setInterval(runAutoFill, 15000);

    return () => {
      if (autoFillIntervalRef.current !== null) {
        window.clearInterval(autoFillIntervalRef.current);
        autoFillIntervalRef.current = null;
      }
      if (autoFillWatchdogRef.current !== null) {
        window.clearTimeout(autoFillWatchdogRef.current);
        autoFillWatchdogRef.current = null;
      }
      autoFillStartedAtMsRef.current = null;
      autoFillRunningRef.current = false;
    };
  }, [AUTO_FILL_STUCK_TIMEOUT_MS, activeBatch.batchId, autoFillEnabled, ensureReadyMatches, publicView, scoreOnly]);

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

  const handleGenerateOneQueue = async () => {
    if (queueProcessing || activeBatch.queuedMatches.length >= 5) {
      return;
    }

    const target = Math.min(5, Math.max(1, activeBatch.queuedMatches.length + 1));
    await ensureReadyMatches(activeBatch.batchId, target);
  };

  const handleToggleBreak = (playerId: string) => {
    const now = nowMs;
    const disabledUntil = toggleBreakDisabledUntil[playerId] ?? 0;
    if (disabledUntil > now) {
      return;
    }

    setToggleBreakDisabledUntil((current) => ({
      ...current,
      [playerId]: now + 1200,
    }));

    window.setTimeout(() => {
      setToggleBreakDisabledUntil((current) => {
        const next = { ...current };
        delete next[playerId];
        return next;
      });
    }, 1250);

    void toggleBreak(activeBatch.batchId, playerId);
  };

  const handlePlaceQueueOnCourt = async (courtId: string, matchId: string) => {
    await startQueuedMatchOnCourt(activeBatch.batchId, courtId, matchId);
  };

  const handleManualAutoFillCourts = async () => {
    if (queueProcessing) {
      return;
    }

    if (idleCourts.length === 0) {
      return;
    }

    // Manual override: top up ready queue first, then push queued matches to idle courts.
    const targetReady = Math.min(5, Math.max(activeBatch.queuedMatches.length, idleCourts.length));
    await ensureReadyMatches(activeBatch.batchId, targetReady);
    await fillIdleCourts(activeBatch.batchId);
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
    if (!player || player.pairId || player.status !== 'checked-in' || activePlayers.has(player.id)) {
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

  const handleDeleteAllPlayers = async () => {
    const shouldDelete = window.confirm(
      `Delete ALL players in Batch ${activeBatch.batchId}? This also clears current queue and live matches for this batch.`,
    );
    if (!shouldDelete) {
      return;
    }

    await deleteAllPlayersForBatch(activeBatch.batchId);
  };

  const handleSetAllPlayersBreak = async () => {
    const shouldSetBreak = window.confirm(
      `Set ALL players in Batch ${activeBatch.batchId} to Break? This also clears queued/live matches for this batch.`,
    );
    if (!shouldSetBreak) {
      return;
    }

    await setAllPlayersBreakForBatch(activeBatch.batchId);
  };

  const handleDeleteAllMatchHistory = async () => {
    const shouldDelete = window.confirm(
      `Delete ALL match history in Batch ${activeBatch.batchId}? Completed match records for this batch will be removed.`,
    );
    if (!shouldDelete) {
      return;
    }

    await deleteAllMatchHistoryForBatch(activeBatch.batchId);
  };

  const handleGenerateGenderCustom = async (gender: 'M' | 'F', placement: 'top' | 'bottom') => {
    await generateSingleGenderCustomMatch(activeBatch.batchId, gender, placement);
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
    const activeCourts = activeBatch.courts.filter((court) => court.isActive);
    const inactiveCourtCount = activeBatch.courts.filter((court) => !court.isActive).length;
    const nextOpenCourt = activeBatch.courts.find((court) => court.status === 'idle' && court.isActive);
    const nextTwoMatches = upcomingMatches.slice(0, 2);
    const nextMatch = nextTwoMatches[0];
    const courtAssignedAnnouncement = activeNowCallingAnnouncement?.type === 'court-assigned' ? activeNowCallingAnnouncement : null;
    const isHighlighting = Boolean(
      nextMatch &&
      activeNowCallingAnnouncement?.type === 'next-up' &&
      activeNowCallingAnnouncement.matchId === nextMatch.id,
    );

    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Public Queue</p>
              <h2 className="text-display mt-2 text-3xl font-semibold sm:text-4xl">Live Queue - Batch {activeBatch.batchId}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]">
                <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-3 py-1 text-emerald-100">
                  {activeCourts.length} active
                </span>
                <span className="rounded-full border border-slate-300/25 bg-slate-700/20 px-3 py-1 text-slate-200/90">
                  {inactiveCourtCount} inactive
                </span>
              </div>
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

            {courtAssignedAnnouncement ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={courtAssignedAnnouncement.id}
                  initial={{ opacity: 0, scale: 0.98, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -8 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="rounded-[2rem] border-2 border-amber-300/70 bg-gradient-to-br from-amber-300/30 to-rose-300/20 p-6 shadow-[0_12px_36px_rgba(251,191,36,0.28)]"
                >
                  <div className="text-center text-3xl font-black uppercase tracking-[0.2em] text-amber-50 drop-shadow-[0_4px_14px_rgba(0,0,0,0.35)] sm:text-4xl">
                    GO TO COURT {courtAssignedAnnouncement.courtLabel.replace(/^Court\s*/i, '').trim() || courtAssignedAnnouncement.courtLabel}
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <div className="rounded-2xl border border-amber-200/45 bg-black/30 px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-100/90">Team 1</div>
                      <div className="mt-2">
                        <TeamList players={courtAssignedAnnouncement.teamA} size="lg" getGender={getGenderForName} />
                      </div>
                    </div>

                    <div className="text-center text-2xl font-black uppercase tracking-[0.35em] text-amber-100">VS</div>

                    <div className="rounded-2xl border border-amber-200/45 bg-black/30 px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-100/90">Team 2</div>
                      <div className="mt-2">
                        <TeamList players={courtAssignedAnnouncement.teamB} size="lg" alignRight getGender={getGenderForName} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            ) : nextMatch ? (
              <AnimatePresence mode="wait">
                <motion.div key={nextMatch.id} layout className="space-y-4">
                  <div className={`grid gap-4 ${isHighlighting ? 'lg:grid-cols-1' : 'lg:grid-cols-2'}`}>
                    <motion.div
                      layout
                      className={`rounded-[2rem] border-2 p-5 shadow-[0_8px_32px_rgba(251,191,36,0.3)] ${
                        isHighlighting
                          ? 'border-amber-300/70 bg-gradient-to-br from-amber-300/30 to-amber-400/15 lg:col-span-2'
                          : 'border-amber-300/60 bg-gradient-to-br from-amber-300/25 to-amber-400/10'
                      }`}
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-100">Match #1 (BE READY)</div>
                        <div className="rounded-full bg-amber-300/30 px-3 py-1 text-xs font-bold text-amber-100">
                          {nextTwoMatches[0]?.mode === 'mixed' ? 'Mixed' : 'Custom'}
                        </div>
                      </div>

                      {isHighlighting ? (
                        <div className="mb-4 text-center text-3xl font-black uppercase tracking-[0.2em] text-amber-50 drop-shadow-[0_4px_14px_rgba(0,0,0,0.35)] sm:text-4xl">
                          NEXT UP!
                        </div>
                      ) : null}

                      <div className={isHighlighting ? 'grid gap-4 md:grid-cols-[1fr_auto_1fr]' : 'space-y-3'}>
                        <div className="rounded-2xl border border-amber-300/40 bg-black/30 px-4 py-3">
                          <div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-200/90">Team 1</div>
                          <div className="mt-2">
                            <TeamList players={nextTwoMatches[0]?.teamA ?? []} size={isHighlighting ? 'lg' : 'sm'} getGender={getGenderForName} />
                          </div>
                        </div>

                        <div className={`text-center font-black uppercase tracking-[0.35em] ${isHighlighting ? 'self-center text-amber-200 text-2xl' : 'text-amber-300/80'}`}>VS</div>

                        <div className="rounded-2xl border border-amber-300/40 bg-black/30 px-4 py-3">
                          <div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-200/90">Team 2</div>
                          <div className="mt-2">
                            <TeamList players={nextTwoMatches[0]?.teamB ?? []} size={isHighlighting ? 'lg' : 'sm'} alignRight getGender={getGenderForName} />
                          </div>
                        </div>
                      </div>

                      <div className={`mt-4 rounded-xl border px-3 py-2 text-center font-bold ${nextOpenCourt ? 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100' : 'border-slate-300/25 bg-slate-700/20 text-slate-200/90'} ${isHighlighting ? 'text-sm uppercase tracking-[0.2em]' : 'text-xs'}`}>
                        {nextOpenCourt ? (isHighlighting ? nextOpenCourt.label : `Next active court: ${nextOpenCourt.label}`) : 'No active court available'}
                      </div>
                    </motion.div>

                    <AnimatePresence mode="wait">
                      {!isHighlighting && nextTwoMatches.length > 1 ? (
                        <motion.div
                          key={nextTwoMatches[1].id}
                          layout
                          className="rounded-[2rem] border border-white/20 bg-white/5 p-5"
                        >
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="text-xs font-bold uppercase tracking-[0.3em] text-white/70">Match #2 (Be Ready)</div>
                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200/80">
                              {nextTwoMatches[1]?.mode === 'mixed' ? 'Mixed' : 'Custom'}
                            </div>
                          </div>

                          <div className="space-y-2 text-sm">
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-xs uppercase tracking-[0.25em] text-slate-400/80">Team 1</div>
                              <div className="mt-2">
                                <TeamList players={nextTwoMatches[1]?.teamA ?? []} getGender={getGenderForName} />
                              </div>
                            </div>

                            <div className="text-center text-xs font-bold uppercase tracking-[0.3em] text-white/50">VS</div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-xs uppercase tracking-[0.25em] text-slate-400/80">Team 2</div>
                              <div className="mt-2">
                                <TeamList players={nextTwoMatches[1]?.teamB ?? []} alignRight getGender={getGenderForName} />
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </motion.div>
              </AnimatePresence>
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
                    <TeamCard label="Team 1" players={match.teamA} getGender={getGenderForName} />
                    <div className="text-center text-sm font-semibold uppercase tracking-[0.35em] text-amber-200/80">VS</div>
                    <TeamCard label="Team 2" players={match.teamB} alignRight getGender={getGenderForName} />
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
                    {(() => {
                      const timerTone = getTimerTone(court.startedAt, nowMs);
                      return (
                        <span className={`rounded-full border px-3 py-1 text-xs ${timerTone.className} ${timerTone.pulse ? 'animate-pulse' : ''}`}>
                          {formatTimer(court.startedAt, nowMs)}
                        </span>
                      );
                    })()}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <TeamCard label="Team 1" players={court.teamA} getGender={getGenderForName} />
                    <div className="text-center text-xl font-black tracking-[0.45em] text-amber-200/80">VS</div>
                    <TeamCard label="Team 2" players={court.teamB} alignRight getGender={getGenderForName} />
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

          <div className="mt-4 space-y-4">
            {topLeaderboard.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-3">
                {topLeaderboard.map((entry, index) => {
                  const variants = [
                    'border-amber-300/55 bg-gradient-to-br from-amber-300/25 to-amber-400/10 shadow-[0_10px_30px_rgba(251,191,36,0.18)]',
                    'border-slate-300/45 bg-slate-100/10',
                    'border-orange-300/45 bg-orange-300/10',
                  ];

                  return (
                    <motion.div key={entry.playerId} layout className={`rounded-[1.5rem] border p-4 ${variants[index] ?? variants[2]}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/25 text-xs font-bold text-amber-100">{entry.rank}</span>
                          <PlayerNameRow name={entry.name} size="md" gender={getGenderForName(entry.name)} />
                        </div>
                        <div className="text-right text-xs text-slate-200/80">
                          <div>{entry.wins} wins</div>
                          <div>{entry.gamesPlayed} games</div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : null}

            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-3">
              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                {remainingLeaderboard.length === 0 ? (
                  <div className="p-3 text-sm text-slate-300/80">No additional leaderboard entries.</div>
                ) : null}
                {remainingLeaderboard.map((entry) => (
                  <div key={entry.playerId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/25 text-xs font-bold text-amber-100">{entry.rank}</span>
                      <PlayerNameRow name={entry.name} gender={getGenderForName(entry.name)} />
                    </div>
                    <span className="text-slate-300/80">{entry.wins} wins - {entry.gamesPlayed} games</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (scoreOnly) {
    const scoreCourts = activeBatch.courts.filter((court) => court.isActive);

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
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-full border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100"
              >
                <LogOut className="h-4 w-4" />
                Log Out
              </button>
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[2rem] p-5 sm:p-6">
          <div className="space-y-4">
            {scoreCourts.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">No active courts right now.</div> : null}
            <div className="grid gap-4 lg:grid-cols-2">
            {scoreCourts.map((court) => {
              const draft = scoreDrafts[court.id] ?? { a: '', b: '' };
              const isLive = court.status === 'live';
              return (
                <div key={court.id} className={`rounded-2xl border p-4 ${isLive ? 'border-orange-300/30 bg-orange-400/8' : 'border-white/10 bg-white/5'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-white">{court.label}</div>
                    <div className="flex items-center gap-2">
                      <div className={`rounded-full border px-3 py-1 text-xs ${isLive ? 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100' : 'border-slate-300/25 bg-slate-700/20 text-slate-200/90'}`}>
                        {isLive ? 'Live' : 'Waiting'}
                      </div>
                      {isLive ? (() => {
                        const timerTone = getTimerTone(court.startedAt, nowMs);
                        return (
                          <div className={`rounded-full border px-3 py-1 text-xs ${timerTone.className} ${timerTone.pulse ? 'animate-pulse' : ''}`}>
                            {formatTimer(court.startedAt, nowMs)}
                          </div>
                        );
                      })() : null}
                    </div>
                  </div>
                  {isLive ? (
                    <>
                      <div className="mt-3 text-sm text-slate-200/90">
                        <div className="text-xs uppercase tracking-[0.24em] text-slate-400/80">Team A</div>
                        <div className="mt-2"><TeamList players={court.teamA} getGender={getGenderForName} /></div>
                      </div>
                      <div className="mt-1 text-sm text-slate-200/90">
                        <div className="text-xs uppercase tracking-[0.24em] text-slate-400/80">Team B</div>
                        <div className="mt-2"><TeamList players={court.teamB} alignRight getGender={getGenderForName} /></div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          pattern="[0-9]*"
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
                          inputMode="numeric"
                          pattern="[0-9]*"
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
                          disabled={parseScoreValue(draft.a) === null || parseScoreValue(draft.b) === null}
                          onClick={() => {
                            const scoreA = parseScoreValue(draft.a);
                            const scoreB = parseScoreValue(draft.b);
                            if (scoreA === null || scoreB === null) {
                              return;
                            }
                            completeMatch(activeBatch.batchId, court.id, scoreA, scoreB);
                            setScoreDrafts((current) => {
                              const next = { ...current };
                              delete next[court.id];
                              return next;
                            });
                          }}
                          className="rounded-2xl bg-gradient-to-r from-emerald-400 to-lime-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
                        >
                          Save score
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-center text-sm font-medium text-slate-200/90">
                      Waiting for players...
                    </div>
                  )}
                </div>
              );
            })}
            </div>
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
            <Link href="/dashboard/score" className="relative z-10 touch-manipulation rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
              Score Game
            </Link>
            <Link href="/dashboard/history" className="relative z-10 touch-manipulation rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10">
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

      {lastActionError ? (
        <div className="fixed right-4 top-4 z-50 w-[min(92vw,24rem)] rounded-2xl border border-rose-300/35 bg-slate-950/90 px-4 py-3 text-sm text-rose-100 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
          <div className="flex items-start justify-between gap-3">
            <span>{lastActionError}</span>
            <button
              type="button"
              onClick={clearActionError}
              className="rounded-full border border-rose-300/30 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-100"
            >
              x
            </button>
          </div>
        </div>
      ) : null}

      {batchCounts.checkedIn < 4 ? (
        <section className="rounded-2xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/95">
          Need at least 4 checked-in players to generate matches and make courts live.
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <h3 className="text-xl font-semibold text-white">Add Player/s</h3>
            <p className="mt-2 text-xs text-amber-100/90">New players are added to Break by default. Move them to Checked-In from the On Break section.</p>
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
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300/80">No matching players.</div>
              ) : null}
              {pairSearchResults.map((player) => {
                const selected = pairSelection.includes(player.id);
                const isPlaying = activePlayers.has(player.id);
                const canPair = player.status === 'checked-in' && !player.pairId && !isPlaying;
                const availabilityLabel = player.pairId
                  ? 'Already paired'
                  : isPlaying
                    ? 'Currently playing'
                    : player.status !== 'checked-in'
                      ? 'On break'
                      : 'Available';
                return (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => togglePairSelection(player.id)}
                    disabled={!canPair}
                    className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      selected
                        ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                        : canPair
                          ? 'border-white/10 bg-white/5 text-slate-100/90'
                          : 'border-white/10 bg-black/20 text-slate-300/70'
                    }`}
                  >
                    <PlayerNameRow name={player.name} gender={player.gender} />
                    <div className="text-xs opacity-80">{player.gender} - {availabilityLabel}</div>
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
                  const firstPlayer = activeBatch.players.find((player) => player.id === pair.playerIds[0]);
                  const secondPlayer = activeBatch.players.find((player) => player.id === pair.playerIds[1]);
                  const firstName = firstPlayer?.name ?? 'Player';
                  const secondName = secondPlayer?.name ?? 'Player';
                  const onBreakCount = [firstPlayer?.status, secondPlayer?.status].filter((status) => status === 'break').length;
                  const pairStatusLabel = onBreakCount === 0 ? 'Checked In' : onBreakCount === 1 ? '1 On Break' : 'On Break';
                  const pairStatusClass =
                    onBreakCount === 0
                      ? 'text-emerald-200/90'
                      : onBreakCount === 1
                        ? 'text-amber-200/90'
                        : 'text-rose-200/90';
                  return (
                    <div key={pair.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-3 text-sm">
                      <div>
                        <div className="flex items-center gap-2">
                          <PlayerNameRow name={firstName} gender={getGenderForName(firstName)} />
                          <span className="text-slate-300/70">+</span>
                          <PlayerNameRow name={secondName} gender={getGenderForName(secondName)} />
                        </div>
                        <div className={`mt-1 text-xs ${pairStatusClass}`}>{pairStatusLabel}</div>
                      </div>
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
                <div className="mt-1 text-xs text-slate-300/80">Queue contains ready matches. Auto-generation keeps at least 5 when not paused.</div>
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
                  <span className="inline-flex items-center gap-2">
                    {autoFillEnabled ? <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.75)]" /> : null}
                    {autoFillEnabled ? 'Auto-fill 15s: On' : 'Auto-fill 15s: Off'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleGenerateOneQueue}
                  disabled={queueProcessing || activeBatch.queuedMatches.length >= 5 || batchCounts.checkedIn < 4}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10"
                >
                  Generate 1 Queue
                </button>
                <button
                  type="button"
                  onClick={() => void handleManualAutoFillCourts()}
                  disabled={queueProcessing}
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
                <div key={match.id} className={`rounded-2xl border border-white/10 bg-white/5 p-4 text-sm ${queuePaused ? 'opacity-75' : ''}`}>
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
                    <TeamCard label="Team 1" players={match.teamA} getGender={getGenderForName} />
                    <div className="text-center text-sm font-semibold uppercase tracking-[0.35em] text-amber-200/80">VS</div>
                    <TeamCard label="Team 2" players={match.teamB} alignRight getGender={getGenderForName} />
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
                <div className="mt-1 text-xs text-slate-300/80">{activeBatch.courts.length - inactiveCourtCount} active / {inactiveCourtCount} inactive</div>
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
                  <div key={court.id} className={`rounded-2xl border p-4 ${!court.isActive ? 'border-slate-300/20 bg-slate-700/20' : court.status === 'live' ? 'border-orange-300/30 bg-orange-400/8' : 'border-white/10 bg-white/5'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-white">{court.label}</div>
                      <div className="flex items-center gap-2">
                        <div className={`rounded-full border px-3 py-1 text-xs ${court.isActive ? 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100' : 'border-slate-300/20 bg-slate-900/30 text-slate-200/90'}`}>
                          {court.isActive ? 'Active' : 'Inactive'}
                        </div>
                        {(() => {
                          const timerTone = getTimerTone(court.startedAt, nowMs);
                          return (
                            <div className={`rounded-full border px-3 py-1 text-xs ${timerTone.className} ${timerTone.pulse ? 'animate-pulse' : ''}`}>
                              {formatTimer(court.startedAt, nowMs)}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {!court.isActive ? (
                      <div className="mt-3">
                        <div className="text-sm text-slate-300/80">This court is inactive and will not receive players.</div>
                        <button
                          type="button"
                          onClick={() => setCourtActive(activeBatch.batchId, court.id, true)}
                          className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-100"
                        >
                          Activate court
                        </button>
                      </div>
                    ) : court.status === 'live' ? (
                      <>
                        <div className="mt-3 text-sm text-slate-200/90">
                          <div className="text-xs uppercase tracking-[0.24em] text-slate-400/80">Team A</div>
                          <div className="mt-2"><TeamList players={court.teamA} getGender={getGenderForName} /></div>
                        </div>
                        <div className="mt-1 text-sm text-slate-200/90">
                          <div className="text-xs uppercase tracking-[0.24em] text-slate-400/80">Team B</div>
                          <div className="mt-2"><TeamList players={court.teamB} alignRight getGender={getGenderForName} /></div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9]*"
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
                            inputMode="numeric"
                            pattern="[0-9]*"
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
                            disabled={parseScoreValue(draft.a) === null || parseScoreValue(draft.b) === null}
                            onClick={() => {
                              const scoreA = parseScoreValue(draft.a);
                              const scoreB = parseScoreValue(draft.b);
                              if (scoreA === null || scoreB === null) {
                                return;
                              }
                              completeMatch(activeBatch.batchId, court.id, scoreA, scoreB);
                              setScoreDrafts((current) => {
                                const next = { ...current };
                                delete next[court.id];
                                return next;
                              });
                            }}
                            className="rounded-2xl bg-gradient-to-r from-emerald-400 to-lime-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
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
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setCourtActive(activeBatch.batchId, court.id, false)}
                            className="rounded-2xl border border-slate-300/20 bg-slate-900/30 px-4 py-3 text-sm font-medium text-slate-100/90"
                          >
                            Deactivate
                          </button>
                        </div>
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
              <h4 className="text-sm font-semibold text-amber-100">Currently Playing ({playingPlayers.length})</h4>
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
              <h4 className="text-sm font-semibold text-amber-100">On Break ({breakPlayers.length})</h4>
              <div className="mt-2 max-h-48 space-y-2 overflow-auto pr-1">
                {breakPlayers.length === 0 ? <div className="text-sm text-slate-300/80">None</div> : null}
                {breakPlayers.map((player) => (
                  <div key={player.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      <PlayerNameRow name={player.name} gender={player.gender} />
                    <button
                      type="button"
                      onClick={() => handleToggleBreak(player.id)}
                      disabled={(toggleBreakDisabledUntil[player.id] ?? 0) > nowMs}
                      className="relative z-10 touch-manipulation rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90"
                    >
                      Check In
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h4 className="text-sm font-semibold text-amber-100">In Queue ({inQueuePlayers.length})</h4>
              <div className="mt-2 max-h-48 space-y-2 overflow-auto pr-1">
                {inQueuePlayers.length === 0 ? <div className="text-sm text-slate-300/80">None</div> : null}
                {inQueuePlayers.map((player) => (
                  <div key={player.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <PlayerNameRow name={player.name} gender={player.gender} />
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">Queued</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h4 className="text-sm font-semibold text-amber-100">Available Players ({availableForCustom.length})</h4>
              <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
                {availableForCustom.map((player) => (
                  <div key={player.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      <PlayerNameRow name={player.name} gender={player.gender} />
                    <button
                      type="button"
                      onClick={() => handleToggleBreak(player.id)}
                      disabled={(toggleBreakDisabledUntil[player.id] ?? 0) > nowMs}
                      className="relative z-10 touch-manipulation rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-100/90"
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

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Search players</label>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-200" />
                <input
                  value={playerSearch}
                  onChange={(event) => setPlayerSearch(event.target.value)}
                  placeholder="Type name, gender, or status"
                  className="glass-input w-full rounded-2xl px-10 py-3 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 max-h-[32rem] space-y-3 overflow-auto pr-1">
              {filteredPlayers.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300/80">No players match your search.</div>
              ) : null}
              {filteredPlayers.map((player) => {
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
                          <PlayerNameRow name={player.name} gender={player.gender} />
                          <div className="text-xs text-slate-300/80">{player.status}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleBreak(player.id)}
                            disabled={(toggleBreakDisabledUntil[player.id] ?? 0) > nowMs}
                            className="relative z-10 touch-manipulation rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100/90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
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
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={player.name} gender={player.gender} />
                      <span>{player.name}</span>
                      <span>x</span>
                    </span>
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
                    <PlayerNameRow name={player.name} gender={player.gender} />
                    <div className="text-xs opacity-80">{player.gender}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 text-xs text-slate-300/80">{customSelection.length}/4 selected</div>
            {customSelection.length === 4 ? (
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200/90">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400/80">Team 1</div>
                    <div className="mt-2 space-y-1">
                      {[customSelection[0], customSelection[1]].map((id) => {
                        const player = activeBatch.players.find((entry) => entry.id === id);
                        return player ? <PlayerNameRow key={id} name={player.name} /> : null;
                      })}
                    </div>
                  </div>
                  <div className="sm:text-right">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400/80">Team 2</div>
                    <div className="mt-2 space-y-1">
                      {[customSelection[2], customSelection[3]].map((id) => {
                        const player = activeBatch.players.find((entry) => entry.id === id);
                        return player ? <PlayerNameRow key={id} name={player.name} alignRight /> : null;
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={customSelection.length !== 4 || queueProcessing}
                onClick={() => handleAddCustomToQueue('top')}
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add to Top
              </button>
              <button
                type="button"
                disabled={customSelection.length !== 4 || queueProcessing}
                onClick={() => handleAddCustomToQueue('bottom')}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add to Bottom
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={queueProcessing}
                onClick={() => handleGenerateGenderCustom('M', 'top')}
                className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100"
              >
                Generate 1 All Male Match (Top)
              </button>
              <button
                type="button"
                disabled={queueProcessing}
                onClick={() => handleGenerateGenderCustom('M', 'bottom')}
                className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100"
              >
                Generate 1 All Male Match (Bottom)
              </button>
              <button
                type="button"
                disabled={queueProcessing}
                onClick={() => handleGenerateGenderCustom('F', 'top')}
                className="rounded-2xl border border-fuchsia-300/40 bg-fuchsia-500/10 px-4 py-3 text-sm font-semibold text-fuchsia-100"
              >
                Generate 1 All Female Match (Top)
              </button>
              <button
                type="button"
                disabled={queueProcessing}
                onClick={() => handleGenerateGenderCustom('F', 'bottom')}
                className="rounded-2xl border border-fuchsia-300/40 bg-fuchsia-500/10 px-4 py-3 text-sm font-semibold text-fuchsia-100"
              >
                Generate 1 All Female Match (Bottom)
              </button>
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">Settings</h3>
                <div className="mt-1 text-xs text-slate-300/80">High impact actions are grouped here to prevent accidental clicks.</div>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen((current) => !current)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100/90 transition hover:bg-white/10"
              >
                {settingsOpen ? 'Hide' : 'Open'}
              </button>
            </div>

            {settingsOpen ? (
              <div className="mt-4 space-y-3 rounded-2xl border border-rose-300/25 bg-rose-500/10 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-100">Batch {activeBatch.batchId} only</div>
                <button
                  type="button"
                  onClick={handleDeleteAllPlayers}
                  className="w-full rounded-2xl border border-rose-300/30 bg-rose-500/15 px-4 py-3 text-left text-sm font-semibold text-rose-100"
                >
                  Delete all players
                </button>
                <button
                  type="button"
                  onClick={handleSetAllPlayersBreak}
                  className="w-full rounded-2xl border border-amber-300/35 bg-amber-500/15 px-4 py-3 text-left text-sm font-semibold text-amber-100"
                >
                  Set all players to Break
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAllMatchHistory}
                  className="w-full rounded-2xl border border-rose-300/30 bg-rose-500/15 px-4 py-3 text-left text-sm font-semibold text-rose-100"
                >
                  Delete all match history
                </button>
              </div>
            ) : null}
          </article>

        </div>
      </section>
    </main>
  );
}

function TeamCard({ label, players, alignRight = false, getGender }: { label: string; players: string[]; alignRight?: boolean; getGender?: (name: string) => Gender | undefined }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/20 p-3 ${alignRight ? 'text-right' : 'text-left'}`}>
      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400/80">{label}</div>
      <div className="mt-2">
        <TeamList players={players} alignRight={alignRight} getGender={getGender} />
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