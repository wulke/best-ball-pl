import type { GwActuals } from '../etl/types.js';
import { DEFAULT_ROLE, type RoleConfig } from './config.js';

/** The role inferred from a player's retained FPL live-feed row. */
export type RecentRole = 'start' | 'cameo' | 'dnp';

/** One team gameweek in the intentionally short-lived role window. */
export type RoleHistoryEntry = {
  gw: number;
  role: RecentRole;
  minutes: number;
};

/** Fast-reacting role signals. */
export type RoleSignal = {
  /** Null only when no retained team-GW history is available. */
  pStartRecent: number | null;
  /** Null when the history contains no appearances. */
  minutesPerAppearanceRecent: number | null;
};

/**
 * Builds a player's most recent role history from finalized GW actuals. The
 * window is deliberately short-lived (`cfg.roleWindowGames`, default 3): it
 * must not accumulate over a season.
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
  cfg: RoleConfig = DEFAULT_ROLE,
): RoleHistoryEntry[] {
  const recent: RoleHistoryEntry[] = [];
  const mostRecentFirst = [...gameweeks].sort((a, b) => b.event - a.event);

  for (const gameweek of mostRecentFirst) {
    if (!teamPlayed(gameweek)) continue;

    const row = gameweek.players.find((player) => player.id === playerId);
    const minutes = row?.minutes ?? 0;
    const role: RecentRole = minutes >= 60 ? 'start' : minutes >= 1 ? 'cameo' : 'dnp';
    recent.push({ gw: gameweek.event, role, minutes });

    if (recent.length === cfg.roleWindowGames) break;
  }

  return recent;
}

/**
 * Converts the short role window to independent start and appearance-minute
 * signals. DNPs inform the start chance but are excluded from the conditional
 * minutes average.
 */
export function roleSignal(history: readonly RoleHistoryEntry[], cfg: RoleConfig = DEFAULT_ROLE): RoleSignal {
  const window = history.slice(0, cfg.roleWindowGames);
  const weightedEntries = window.map((entry, index) => ({ entry, weight: cfg.roleRecencyWeights[index] }));
  const availableWeight = weightedEntries.reduce((sum, { weight }) => sum + weight, 0);
  if (availableWeight === 0) {
    return { pStartRecent: null, minutesPerAppearanceRecent: null };
  }

  const pStartRecent = weightedEntries.reduce(
    (sum, { entry, weight }) => sum + (entry.role === 'start' ? weight : 0),
    0,
  ) / availableWeight;

  const featured = weightedEntries.filter(({ entry }) => entry.minutes > 0);
  const featuredWeight = featured.reduce((sum, { weight }) => sum + weight, 0);
  const minutesPerAppearanceRecent = featuredWeight === 0
    ? null
    : featured.reduce(
      (sum, { entry, weight }) => sum + entry.minutes * weight,
      0,
    ) / featuredWeight;

  return { pStartRecent, minutesPerAppearanceRecent };
}

/** The season-level prior this blend reacts against: `project.ts`'s
 *  recency-weighted `startFraction` and its expected-minutes-per-appearance
 *  equivalent, computed independently of any in-season signal. */
export type SeasonRolePrior = {
  pStart: number;
  minutesPerAppearance: number;
};

export type BlendedRole = {
  pStart: number;
  minutesPerAppearance: number;
};

/**
 * Blends the fast-reacting recent-role signal (#134) with the season-level
 * prior using its own pseudo-count `k` (config.ts `RoleConfig`) — much
 * smaller than the in-season actuals blend's `startK` (`ActualsConfig`,
 * 900 minutes), because this signal exists to react within a GW or two, not
 * converge gradually over a season.
 *
 * `gamesObserved` is the count of team-GWs behind `signal`'s window
 * (0..roleWindowGames — the caller's `roleHistory(...).length`). Weight is
 * denominated in GWs, not minutes: w = n / (n + k), where
 * k = k0 + kPerGame × (n − 1). k0 is small enough that a single start/bench
 * call dominates the blended output almost immediately (by design — see
 * config.ts); k widens slightly as the window fills so a deeper 2–3 GW
 * sample earns proportionally more trust without letting one noisy result
 * swing the estimate to ~100% weight on the first look. Because w never
 * reaches 1, the season prior always retains some residual weight, so a
 * blended value can still ease back toward the prior if the recent signal's
 * own window later disagrees with it.
 *
 * No data (gamesObserved <= 0, or an all-empty history) returns the season
 * prior unchanged — pre-season parity is structural, matching the #43
 * in-season blends.
 */
export function blendRoleSignal(
  seasonPrior: SeasonRolePrior,
  signal: RoleSignal,
  gamesObserved: number,
  cfg: RoleConfig = DEFAULT_ROLE,
): BlendedRole {
  if (gamesObserved <= 0 || signal.pStartRecent == null) {
    return { ...seasonPrior };
  }

  const n = Math.min(gamesObserved, cfg.roleWindowGames);
  const k = cfg.roleK0 + cfg.roleKPerGame * (n - 1);
  const w = n / (n + k);

  const pStart = w * signal.pStartRecent + (1 - w) * seasonPrior.pStart;
  const minutesPerAppearance = signal.minutesPerAppearanceRecent == null
    ? seasonPrior.minutesPerAppearance
    : w * signal.minutesPerAppearanceRecent + (1 - w) * seasonPrior.minutesPerAppearance;

  return { pStart, minutesPerAppearance };
}
