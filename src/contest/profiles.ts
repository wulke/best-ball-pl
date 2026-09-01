/**
 * Contest profiles (#39): a contest — scoring table, roster shape + starter
 * minimums, window, ceiling weight, tier params — expressed as one data
 * object threaded through model, sheet, and review.
 *
 * Where profiles live (settled here): a **code module**, not committed JSON
 * in the snapshot. Profiles are rules (primary-confirmed contest facts and
 * the model knobs they select), the snapshot is FPL-derived data; mixing them
 * couples every data pull to contest-rule edits and robs the profile shape of
 * compile-time checking. The snapshot schema is untouched by this module —
 * the False Nine flagship view stays bit-for-bit identical (guarded by
 * profiles.test.ts) until the $15 draft completes 2026-08-21.
 *
 * Windows are **explicit fixture sets** (map #37 standing decision): a
 * profile's window spec resolves, against the committed fixture list, to an
 * explicit list of fixtures — a daily slate (The Free Kick's 4-match Saturday
 * set), a GW range, or the full 38. Never a bare GW label: the model consumes
 * the resolved list, and any window is a sum over its fixtures.
 *
 * The UI receives the active profile by importing this module; the active
 * *choice* persists as a profile id in localStorage (`bbpl-profile`) and is
 * resolved by src/ui/useContestProfile.ts. The sheet-tab switcher itself is
 * ticket #44.
 */

import type { Position, SnapshotFixture } from '../etl/types.js';
import {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_SCENARIOS,
  DEFAULT_SCORING,
  DEFAULT_TIERING,
  DEFAULT_TOURNAMENT,
  type ModelConfig,
  type ReplacementConfig,
  type ScenarioConfig,
  type ScoringConfig,
  type TieringConfig,
  type TournamentConfig,
} from '../model/config.js';

/** Canonical position order — starter-slot expansion and per-position loops. */
export const POSITIONS: readonly Position[] = ['G', 'D', 'MD', 'FW'];

/**
 * A contest window, as a spec that resolves to an explicit fixture list:
 * - `season`  — every committed fixture (False Nine's 38-game window).
 * - `slate`   — one UTC date's fixtures kicking off at/after the contest
 *   close time (The Free Kick's daily set — the GW1 Saturday slate excludes
 *   HUL-MUN, an 11:30Z kickoff, because the contest closes 13:41Z).
 * - `fixtures` — a hand-pinned fixture-id list; the escape hatch when a
 *   predicate can't express the set.
 * A GW *range* is sugar over an explicit list, added here when a GW contest
 * actually appears — the resolution contract (`resolveContest`) stays the
 * same either way.
 */
export type WindowSpec =
  | { kind: 'season' }
  | { kind: 'slate'; date: string; notBefore: string }
  | { kind: 'fixtures'; ids: number[] };

/** Roster + lineup shape. */
export type RosterShape = {
  /** Lineup-legality minimums by position. */
  starters: Record<Position, number>;
  /** Extra starting slots any position may fill. */
  flex: number;
  /** Total players drafted (starters + bench). */
  rosterSize: number;
  /** Balanced-shape suggestion per position (the live panel's targets). */
  targets: Record<Position, number>;
};

/** Draft-room shape metadata. */
export type DraftShape = {
  /** Entries per room (False Nine rooms are 12; The Free Kick is fixed at 6). */
  draftSize: number;
  /** Pick clock, seconds — display metadata only. */
  clockSeconds: number;
};

/** One contest as a data object — everything model, sheet, and review need. */
export type ContestProfile = {
  /** Stable key: the localStorage id and the switcher's value. */
  id: string;
  /** Display name. */
  name: string;
  /** Contest family ('season' best ball vs 'daily' slate) for copy/UI. */
  kind: 'season' | 'daily';
  window: WindowSpec;
  scoring: ScoringConfig;
  roster: RosterShape;
  draft: DraftShape;
  /** Explicit pool restriction by club; default = the window's own clubs. */
  poolClubs?: string[];
  /** Ceiling-weight knobs (ranking blend toward p90). */
  tournament: TournamentConfig;
  /** Tier params (natural-break cuts over the profile's own distribution). */
  tiering: TieringConfig;
  /** Scenario knobs (p10/p90 spread). Optional: season-shaped by default —
   *  multiplicative bursts are window-invariant, but short windows need
   *  discreteness-honest ceilings (#46): a goal is 8 points on a board whose
   *  top p50s are single-digit, and a starter's single-fixture q90 is "scores
   *  once" (≈×2.5 on goal expectation), not "×1.25 of a good season". */
  scenarios?: ScenarioConfig;
  /** Review headline baseline (#45): sheet-perfect % below this flags the
   *  room on the carry card. Room-size-dependent by construction — a 6-drafter
   *  no-bench slate draft gets far closer to the literal top of the sheet than
   *  a 12×18 season room does (the sheet-perfect top-6 is nearly attainable;
   *  the top-18 is not). Default 45 (the False Nine-tuned floor). */
  sheetPerfectFlagPercent?: number;
};

/**
 * Profile #1 — the pre-draft False Nine season contest. Every value is
 * today's behavior, preserved bit-for-bit: the scoring/tournament/tiering
 * fields are the very objects from src/model/config.ts, and the roster
 * constants are the ones previously hardcoded across recommend.ts,
 * review.ts, fixture.ts, and LivePanel. The committed snapshot's projections
 * are generated under this profile (ETL + model CLI); nothing about the
 * flagship view may change before the $15 draft completes 2026-08-21.
 */
export const FALSE_NINE: ContestProfile = {
  id: 'false-nine',
  name: 'False Nine — season best ball',
  kind: 'season',
  window: { kind: 'season' },
  scoring: DEFAULT_SCORING,
  roster: {
    starters: { G: 1, D: 2, MD: 2, FW: 2 },
    flex: 2,
    rosterSize: 18,
    targets: { G: 2, D: 6, MD: 5, FW: 5 },
  },
  draft: { draftSize: 12, clockSeconds: 30 },
  tournament: DEFAULT_TOURNAMENT,
  tiering: DEFAULT_TIERING,
};

/**
 * Profile #2 — The Free Kick (Underdog FIFA Daily V2, real EPL fixtures),
 * GW1 Saturday slate: the four 2026-08-22 fixtures kicking off after the
 * 13:41Z close (HUL-MUN's 11:30Z kickoff is pre-close, so not draftable).
 * Roster 1 G / 1 D / 1 MD / 1 FW / 2 FLEX = 6 rounds, **no bench** — every
 * pick starts, a total-points contest. Draft size 6, 30-second clock, pool =
 * the slate's 8 clubs. Scoring primary-confirmed identical to False Nine.
 * Tournament/tiering parity with False Nine held until short-window
 * calibration (#46); this profile now diverges — it is GPP-shaped
 * (top-heavy payouts, no bench, 6/6 starters) and window-scaled (top p50s
 * are single-digit; a goal is 8 points):
 *  - ceilingWeight 0.4 (vs 0.2): lean toward the boom outcome that wins
 *    top-heavy dailies;
 *  - tiering on window scale: minGap 1.0 (≈ one SoT, ~12% of a top p50 —
 *    the season gap of 8 deflated by the ~38× window ratio), maxTiers 4,
 *    maxTierSize 8 (a 6-round room reads 3-4 tiers; per-position pools run
 *    ~9-25 players, so 15-player chunks never split the blobs that matter);
 *  - scenarios: attacker bursts widened to single-fixture q90/expectation
 *    ratios (Poisson small-count: a starter's q90 is "scores once" ≈ ×2.5
 *    on goals, ≈×2.2 on SoT; blended points-weighted FW 2.0 / MD 1.8), D
 *    moderately (attack returns only — the CS lump stays season-shaped:
 *    fixture-level and shared across the whole back line), G near season
 *    (saves/CS anti-correlated in truth, every entry carries a keeper —
 *    thin edge, and a busy-keeper day is rarely the contest-winner).
 */
export const FREE_KICK_GW1_SAT: ContestProfile = {
  id: 'free-kick-gw1-sat',
  name: 'The Free Kick — GW1 Saturday slate (Aug 22)',
  kind: 'daily',
  window: { kind: 'slate', date: '2026-08-22', notBefore: '13:41:00Z' },
  scoring: DEFAULT_SCORING,
  roster: {
    starters: { G: 1, D: 1, MD: 1, FW: 1 },
    flex: 2,
    rosterSize: 6, // no bench — 6 drafted, 6 start
    targets: { G: 1, D: 1, MD: 1, FW: 1 },
  },
  draft: { draftSize: 6, clockSeconds: 30 },
  tournament: { ...DEFAULT_TOURNAMENT, ceilingWeight: 0.4 },
  tiering: { ...DEFAULT_TIERING, minGap: 1.0, maxTiers: 4, maxTierSize: 8 },
  scenarios: {
    p10: { ...DEFAULT_SCENARIOS.p10, burstFactor: 0.65 },
    p90: {
      ...DEFAULT_SCENARIOS.p90,
      burstByPosition: { G: 1.1, D: 1.45, MD: 1.8, FW: 2.0 },
    },
  },
  // 6-drafter no-bench: the sheet-perfect top-6 is nearly attainable, so a
  // clear miss sits higher than False Nine's 45. First-pass — #46 retune fog.
  sheetPerfectFlagPercent: 72,
};

/**
 * Profile #3 — The Free Kick (Underdog FIFA Daily V2, real EPL fixtures),
 * GW2 Saturday Main slate: the four 2026-08-29 fixtures kicking off after
 * the 11:11Z close. Unlike GW1 there is no pre-close exclusion — every
 * Saturday game this week is post-close, with NFO-LIV's 11:30Z kickoff
 * drafted 19 minutes after the contest locks. Same ruleset family as GW1:
 * roster 1 G / 1 D / 1 MD / 1 FW / 2 FLEX = 6 rounds, **no bench**, draft
 * size 6, 30-second clock, pool = the slate's 8 clubs, scoring
 * primary-confirmed identical to False Nine. Contest deltas vs GW1: a
 * 3-entry max (GW1: 20) and a more top-heavy single prize ($300 of $2,000
 * = 15% to first vs $1k of $10k = 10%) — same GPP direction, so the #46
 * short-window calibration carries over unchanged (still one-slate
 * provisional; retune once a few dailies have results). Odds and lineup
 * assets key off this id: data/odds/free-kick-gw2-sat.json,
 * data/lineups/free-kick-gw2-sat.json.
 */
export const FREE_KICK_GW2_SAT: ContestProfile = {
  id: 'free-kick-gw2-sat',
  name: 'The Free Kick — GW2 Saturday Main slate (Aug 29)',
  kind: 'daily',
  window: { kind: 'slate', date: '2026-08-29', notBefore: '11:11:00Z' },
  scoring: DEFAULT_SCORING,
  roster: {
    starters: { G: 1, D: 1, MD: 1, FW: 1 },
    flex: 2,
    rosterSize: 6, // no bench — 6 drafted, 6 start
    targets: { G: 1, D: 1, MD: 1, FW: 1 },
  },
  draft: { draftSize: 6, clockSeconds: 30 },
  tournament: { ...DEFAULT_TOURNAMENT, ceilingWeight: 0.4 },
  tiering: { ...DEFAULT_TIERING, minGap: 1.0, maxTiers: 4, maxTierSize: 8 },
  scenarios: {
    p10: { ...DEFAULT_SCENARIOS.p10, burstFactor: 0.65 },
    p90: {
      ...DEFAULT_SCENARIOS.p90,
      burstByPosition: { G: 1.1, D: 1.45, MD: 1.8, FW: 2.0 },
    },
  },
  // Same GPP shape as GW1 — carry the window-scaled baseline (#45).
  sheetPerfectFlagPercent: 72,
};

/**
 * Profile #4 — Match Day Mania (Underdog FIFA Daily V2, real EPL fixtures),
 * GW3 Saturday Main slate: this week's daily brand — The Free Kick gave way
 * to Match Day Mania, same game-type family and ruleset shape. The six
 * 2026-09-05 fixtures kicking off after the 13:41Z close (8:41AM CDT):
 * BRE-SUN, BHA-LEE, FUL-CRY, MCI-COV, NFO-TOT @14:00Z and HUL-AVL @16:30Z.
 * Like GW1 there is a pre-close exclusion — NEW-BOU's 11:30Z kickoff lands
 * before the contest locks — and unlike GW1/GW2 the slate runs six games, so
 * the pool is 12 clubs (the biggest daily pool yet). Same roster family:
 * 1 G / 1 D / 1 MD / 1 FW / 2 FLEX = 6 rounds, **no bench**, draft size 6,
 * 30-second clock, scoring primary-confirmed identical to False Nine.
 * Contest deltas vs GW2: $10 entry (3), 84-entry max (3), $25k prizes with
 * $3k = 12% to first (GW1 10%, GW2 15%) — same GPP direction, so the #46
 * short-window calibration carries over unchanged (still one-slate
 * provisional; retune once a few dailies have results). Odds and lineup
 * assets key off this id: data/odds/match-day-mania-gw3-sat.json,
 * data/lineups/match-day-mania-gw3-sat.json.
 */
export const MATCH_DAY_MANIA_GW3_SAT: ContestProfile = {
  id: 'match-day-mania-gw3-sat',
  name: 'Match Day Mania — GW3 Saturday Main slate (Sep 5)',
  kind: 'daily',
  window: { kind: 'slate', date: '2026-09-05', notBefore: '13:41:00Z' },
  scoring: DEFAULT_SCORING,
  roster: {
    starters: { G: 1, D: 1, MD: 1, FW: 1 },
    flex: 2,
    rosterSize: 6, // no bench — 6 drafted, 6 start
    targets: { G: 1, D: 1, MD: 1, FW: 1 },
  },
  draft: { draftSize: 6, clockSeconds: 30 },
  tournament: { ...DEFAULT_TOURNAMENT, ceilingWeight: 0.4 },
  tiering: { ...DEFAULT_TIERING, minGap: 1.0, maxTiers: 4, maxTierSize: 8 },
  scenarios: {
    p10: { ...DEFAULT_SCENARIOS.p10, burstFactor: 0.65 },
    p90: {
      ...DEFAULT_SCENARIOS.p90,
      burstByPosition: { G: 1.1, D: 1.45, MD: 1.8, FW: 2.0 },
    },
  },
  // Same GPP shape and 6×6 no-bench room — carry the window-scaled baseline.
  sheetPerfectFlagPercent: 72,
};

/** The registry — the switcher's option list, in display order. */
export const PROFILES: readonly ContestProfile[] = [
  FALSE_NINE,
  FREE_KICK_GW1_SAT,
  FREE_KICK_GW2_SAT,
  MATCH_DAY_MANIA_GW3_SAT,
];

/** Look up a profile by id. Throws on unknown ids — fail loudly, never silently default. */
export function profileById(id: string): ContestProfile {
  const hit = PROFILES.find((p) => p.id === id);
  if (!hit) throw new Error(`Unknown contest profile '${id}'`);
  return hit;
}

/** Resolve a window spec to its explicit fixture list — loudly, never empty. */
export function resolveWindow(window: WindowSpec, fixtures: SnapshotFixture[]): SnapshotFixture[] {
  switch (window.kind) {
    case 'season':
      return fixtures;
    case 'slate': {
      const cutoff = `${window.date}T${window.notBefore}`;
      const hit = fixtures.filter(
        (f) => f.kickoff.slice(0, 10) === window.date && f.kickoff >= cutoff,
      );
      if (hit.length === 0) {
        throw new Error(`Slate ${cutoff}+ matched no fixtures — calendar moved?`);
      }
      return hit;
    }
    case 'fixtures': {
      const byId = new Map(fixtures.map((f) => [f.id, f]));
      const missing = window.ids.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        throw new Error(`Fixture window references unknown ids: ${missing.join(', ')}`);
      }
      return window.ids.map((id) => byId.get(id)!);
    }
  }
}

/** A profile bound to a snapshot: the window as fixtures + the eligible pool. */
export type ResolvedContest = {
  profile: ContestProfile;
  /** The full committed calendar — normalizes opponent factors (club mean
   *  difficulty, per-club fixture count). Structurally a ProjectionWindow. */
  calendar: SnapshotFixture[];
  /** The window as an explicit fixture list — what any window-math sums over. */
  fixtures: SnapshotFixture[];
  /** Clubs whose players are draft-eligible; null = the whole player pool. */
  clubs: string[] | null;
};

/** Materialize a profile against the committed fixture list. */
export function resolveContest(
  profile: ContestProfile,
  fixtures: SnapshotFixture[],
): ResolvedContest {
  const window = resolveWindow(profile.window, fixtures);
  const restricted = profile.poolClubs != null || profile.window.kind !== 'season';
  const clubs = profile.poolClubs ?? (restricted
    ? [...new Set(window.flatMap((f) => [f.home, f.away]))].sort()
    : null);
  return { profile, calendar: fixtures, fixtures: window, clubs };
}

/** Ordered starter-slot expansion: position slots (G→D→MD→FW) then FLEX. */
export function starterSlots(profile: ContestProfile): (Position | 'FLEX')[] {
  const slots: (Position | 'FLEX')[] = [];
  for (const pos of POSITIONS) {
    for (let i = 0; i < profile.roster.starters[pos]; i += 1) slots.push(pos);
  }
  for (let i = 0; i < profile.roster.flex; i += 1) slots.push('FLEX');
  return slots;
}

/** Bench size: drafted players beyond the starting slots. */
export function benchSize(profile: ContestProfile): number {
  return profile.roster.rosterSize - starterSlots(profile).length;
}

/**
 * A "mostly complete" pick-log floor for the review's partialLog flag —
 * five-sixths of a full room's picks (12×18 → 180, the old hardcoded floor).
 */
export function fullLogFloor(profile: ContestProfile): number {
  return Math.round((profile.draft.draftSize * profile.roster.rosterSize * 5) / 6);
}

/**
 * The model config a profile runs under: base model constants with the
 * profile's scoring/ceiling/tier knobs substituted. For False Nine this is
 * value-identical to DEFAULT_MODEL_CONFIG (guarded by test) — the snapshot's
 * projections cannot drift when threading this through ETL/model CLI.
 */
export function modelConfigFor(profile: ContestProfile): ModelConfig {
  return {
    ...DEFAULT_MODEL_CONFIG,
    scoring: profile.scoring,
    tournament: profile.tournament,
    tiering: profile.tiering,
    scenarios: profile.scenarios ?? DEFAULT_SCENARIOS,
  };
}

/** The replacement-level shape (VORP baseline) a profile's roster + draft
 *  size implies — see `ReplacementConfig` in model/config.ts. For False Nine
 *  this is value-identical to `DEFAULT_REPLACEMENT`. */
export function replacementConfigFor(profile: ContestProfile): ReplacementConfig {
  return {
    starters: profile.roster.starters,
    flex: profile.roster.flex,
    draftSize: profile.draft.draftSize,
  };
}
