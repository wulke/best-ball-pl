import type { GwActuals } from '../etl/types.js';

/** The role inferred from a player's retained FPL live-feed row. */
export type RecentRole = 'start' | 'cameo' | 'dnp';

/** One team gameweek in the intentionally short-lived role window. */
export type RoleHistoryEntry = {
  gw: number;
  role: RecentRole;
  minutes: number;
};

/** Fast-reacting role signals. Null means the player has no played-GW history. */
export type RoleSignal = {
  pStartRecent: number | null;
  minutesPerAppearanceRecent: number | null;
};

/** The window is deliberately permanent: it must not accumulate over a season. */
const HISTORY_LIMIT = 3;
const RECENCY_WEIGHTS = [0.6, 0.25, 0.15] as const;

/**
 * Builds a player's most recent role history from finalized GW actuals.
 *
 * `teamPlayed` is optional because the retained FPL rows name featured players
 * but do not retain a player's club. A caller with fixture context supplies it
 * to distinguish a postponed/rest GW from an unused-sub DNP; absent that
 * context each retained GW is treated as played.
 */
export function roleHistory(
  playerId: string,
  gameweeks: readonly GwActuals[],
  teamPlayed: (gameweek: GwActuals) => boolean = () => true,
): RoleHistoryEntry[] {
  const recent: RoleHistoryEntry[] = [];
  const chronological = [...gameweeks].sort((a, b) => b.event - a.event);

  for (const gameweek of chronological) {
    if (!teamPlayed(gameweek)) continue;

    const row = gameweek.players.find((player) => player.id === playerId);
    const minutes = row?.minutes ?? 0;
    const role: RecentRole = minutes >= 60 ? 'start' : minutes >= 1 ? 'cameo' : 'dnp';
    recent.push({ gw: gameweek.event, role, minutes });

    if (recent.length === HISTORY_LIMIT) break;
  }

  return recent;
}

/**
 * Converts the short role window to independent start and appearance-minute
 * signals. DNPs inform the start chance but are excluded from the conditional
 * minutes average.
 */
export function roleSignal(history: readonly RoleHistoryEntry[]): RoleSignal {
  const window = history.slice(0, HISTORY_LIMIT);
  const availableWeight = window.reduce((sum, _, index) => sum + RECENCY_WEIGHTS[index], 0);
  if (availableWeight === 0) {
    return { pStartRecent: null, minutesPerAppearanceRecent: null };
  }

  const pStartRecent = window.reduce(
    (sum, entry, index) => sum + (entry.role === 'start' ? RECENCY_WEIGHTS[index] : 0),
    0,
  ) / availableWeight;

  const featured = window.filter((entry) => entry.minutes > 0);
  const featuredWeight = featured.reduce(
    (sum, entry) => sum + RECENCY_WEIGHTS[window.indexOf(entry)],
    0,
  );
  const minutesPerAppearanceRecent = featuredWeight === 0
    ? null
    : featured.reduce(
      (sum, entry) => sum + entry.minutes * RECENCY_WEIGHTS[window.indexOf(entry)],
      0,
    ) / featuredWeight;

  return { pStartRecent, minutesPerAppearanceRecent };
}
