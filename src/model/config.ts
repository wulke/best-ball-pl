/**
 * False Nine scoring table + model constants. Every number here is a knob:
 * the model is transparent by construction — rankings must be traceable to
 * these constants (docs/research/false-nine-scoring.md,
 * docs/research/historical-baseline-modeling.md).
 */

import type { Position } from '../etl/types.js';

/**
 * Underdog soccer best-ball points table. Sourced RotoWire ×2 + Rotogrinders
 * cross-check (value-for-value match); NOT primary-verified against
 * Underdog's own rules page (Cloudflare-blocked). Treat as v1 canon —
 * spot-check before trusting final point weights.
 */
export const FALSE_NINE_POINTS = {
  goal: 8.0,
  assist: 4.0,
  shotOnTarget: 2.0,
  shotOffTarget: 1.0,
  chanceCreated: 1.0,
  cross: 0.75,
  tackle: 0.5,
  pass: 0.05,
  cleanSheet: 5.0, // G + D only
  gkWin: 5.0, // G only
  save: 2.0, // G only
  penaltySave: 3.0, // G only
  goalConceded: -2.0, // G + D only
} as const;

/**
 * Unconfirmed rules, parameterized rather than guessed silently (per #3):
 * - `blockedShotsCountOffTarget`: FBref's Sh−SoT conflates blocked; Opta
 *   semantics suggest blocked ≠ off target. Default: conservative (false).
 * - Cards: no published value anywhere; default 0 and flag as sensitivity.
 * - Clean-sheet minutes threshold: unconfirmed; modeled as an eligibility
 *   *fraction* of matches (see eligibilityFraction in project.ts), not a
 *   per-match cutoff — season aggregates can't express the latter.
 */
export type ScoringConfig = typeof FALSE_NINE_POINTS & {
  blockedShotsCountOffTarget: boolean;
};

export const DEFAULT_SCORING: ScoringConfig = {
  ...FALSE_NINE_POINTS,
  blockedShotsCountOffTarget: false,
};

/** League-average conversion constants (EPL, ~5-season eyeball). */
export type ConversionConfig = {
  /** Goals per shot on target (~0.30 league-wide) → SoT ≈ xG / 0.30. */
  goalsPerSoT: number;
  /** Off-target (non-blocked) shots ≈ this × SoT count. */
  offTargetPerSoT: number;
  /** Key passes per assist (~7.7) → chances created ≈ xA × 7.7. */
  kpPerAssist: number;
};

export const DEFAULT_CONVERSIONS: ConversionConfig = {
  goalsPerSoT: 0.3,
  offTargetPerSoT: 0.95,
  kpPerAssist: 7.7,
};

/**
 * Volume baselines FPL cannot express, per position, per 90. FALLBACK ONLY —
 * used where FBref rows are missing (promoted squads, deep history, unmatched
 * names). The FBref slice (`npm run fbref`) supplies per-player
 * SoT/KP/Crs/TklW/Cmp per-90s that replace these outright.
 */
export type VolumeBaselines = Record<
  Position,
  { passes: number; crosses: number; tackles: number; chancesCreatedFloor: number }
>;

/** Volume model knobs — real per-player rates when FBref data exists. */
export type VolumeConfig = {
  /** League-average per-position per-90 baselines — fallback only. */
  baselines: VolumeBaselines;
  /** Shrinkage toward the position's FBref-covered volume mean:
   *  k = fbrefWeightedMinutes / (fbrefWeightedMinutes + this). */
  regressionMinutes: number;
  /** Minimum recency-weighted FBref minutes behind a player's per-90 term
   *  before they may define the position's volume mean (the shrinkage
   *  target) for that term. */
  minMeanMinutes: number;
  /** FBref Sh−SoT conflates blocked and genuinely-off-target shots. When
   *  blockedShotsCountOffTarget=false (default), this share of the miss
   *  count is scored as off-target; the rest is blocked (0 pts). ~2/3 league
   *  eyeball — sensitivity-flagged, not Opta-verified. */
  offTargetShareOfMisses: number;
};

export const DEFAULT_VOLUME: VolumeBaselines = {
  G: { passes: 26, crosses: 0, tackles: 0, chancesCreatedFloor: 0 },
  D: { passes: 38, crosses: 2.2, tackles: 2.1, chancesCreatedFloor: 0.3 },
  MD: { passes: 42, crosses: 1.8, tackles: 1.5, chancesCreatedFloor: 0.5 },
  FW: { passes: 22, crosses: 1.0, tackles: 0.8, chancesCreatedFloor: 0.4 },
};

export const DEFAULT_VOLUME_CONFIG: VolumeConfig = {
  baselines: DEFAULT_VOLUME,
  regressionMinutes: 1800,
  minMeanMinutes: 900,
  offTargetShareOfMisses: 0.67,
};

/** Minutes / durability model knobs. */
export type MinutesConfig = {
  /** Recency weights over seasons[0..2] (most recent first). */
  recencyWeights: [number, number, number];
  /** Single-season players shrink toward the no-history prior. */
  singleSeasonShrink: number;
  /** Prior for players with zero FPL history (new signings, youth). */
  noHistoryMinutes: number;
  /** Availability haircuts from FPL status codes ('i' injured, 'd' doubtful). */
  statusFactors: { i: number; d: number };
  /** Hard cap: 38 × 90. */
  maxMinutes: number;
  /**
   * Fixture-congestion rotation: outfield players on the top-N teams by
   * projected win rate (proxy for European/domestic-cup football — those are
   * the squads that rotate inside MW 1–26) take a minutes haircut. GKs are
   * exempt: cup rotation rests outfield legs, not the league #1 keeper.
   */
  congestion: { topTeams: number; factor: number };
  /** Goalkeeper job-share: one club hands out this many starts per season. */
  gkStartsPerSeason: number;
  /** Starts last season required to claim a share of the club's GK job
   *  (recent starting evidence — stale cross-club minutes don't count). */
  gkCredibleStarts: number;
  /** Newcomer (no FPL history) minutes prior: per-position price → minutes
   *  fit over established players, discounted for survivorship + unproven
   *  status. floor/cap clamp the estimate; minSamples guards thin positions
   *  (falls back to noHistoryMinutes). */
  newcomer: { discount: number; floorMinutes: number; capMinutes: number; minSamples: number };
  /** Outfield position-group minute caps (#83): a club fields exactly 11
   *  players, so its realized season total is exactly 11 × 90 × 38 minutes
   *  and the independently-estimated per-player expectations must be scaled
   *  down when a group's sum would exceed the club's slots. Defenders on the
   *  pitch per match (FPL classification — the back line; 4 for most teams,
   *  with 3-ATB clubs whose wing-backs read as D running slightly over, a
   *  league-constant approximation whose residual the total cap catches).
   *  The MD+FW group takes the remaining 11 − 1 − defenderSlots slots: the
   *  mid/forward split is formation-flexible, only the non-defender outfield
   *  count is fixed. */
  defenderSlots: number;
};

export const DEFAULT_MINUTES: MinutesConfig = {
  recencyWeights: [0.55, 0.3, 0.15],
  singleSeasonShrink: 0.85,
  noHistoryMinutes: 850,
  statusFactors: { i: 0.5, d: 0.8 },
  maxMinutes: 3420,
  congestion: { topTeams: 6, factor: 0.95 },
  defenderSlots: 4,
  gkStartsPerSeason: 38,
  gkCredibleStarts: 8,
  newcomer: { discount: 0.85, floorMinutes: 400, capMinutes: 3300, minSamples: 8 },
};

/** Rate estimation knobs (per-90 attacking terms). */
export type RateConfig = {
  /** xG/xA vs actual G/A blend — xG is the stabler next-season predictor. */
  xWeight: number;
  /** Shrinkage toward position mean: k = weightedMinutes / (weightedMinutes + this). */
  regressionMinutes: number;
};

export const DEFAULT_RATES: RateConfig = {
  xWeight: 0.7,
  regressionMinutes: 2400,
};

/** Conservative market shrinkage for daily-slate odds. Odds complement the
 * model's priors; they never replace them outright. */
export type OddsBlendConfig = {
  playerGoals: number;
  playerAssists: number;
  team: number;
};

export const DEFAULT_ODDS_BLEND: OddsBlendConfig = {
  playerGoals: 0.35,
  playerAssists: 0.35,
  team: 0.35,
};

/** In-season actuals blending (#43): how much weight completed-GW actuals
 *  carry against each prior family, expressed as pseudo-count shrinkage —
 *  weight = observed sample / (observed sample + k) — so every blend starts
 *  at exactly 0 with zero data (pre-season parity is structural, not
 *  guarded) and asymptotes to fully observed as the season plays out. All
 *  blends are pure functions of the snapshot's `actuals` section — no clocks,
 *  no randomness — so the scheduled refresh re-projects deterministically. */
export type ActualsConfig = {
  /** Team priors (CS/GC/win-rate): matches played vs this pseudo-count. */
  teamK: number;
  /** Outfield minutes: team matches played vs this pseudo-count. Observed
   *  minutes per team-match are prorated over the club's calendar games to a
   *  season rate, then blended against the prior season-minutes estimate. */
  minutesK: number;
  /** Per-90 attacking/GK-save rates: observed minutes vs this pseudo-count. */
  ratesK: number;
  /** GK starts: team matches played vs this pseudo-count (observed starts
   *  prorated to the club's 38-start job, blended against the starts-claim
   *  model, then re-normalized so the club's job stays conserved). */
  gkK: number;
  /** Start fraction (CS eligibility + durability): observed minutes vs this
   *  pseudo-count. */
  startK: number;
  /** FPL's live feed has no started-flag; a GW row with at least this many
   *  minutes counts as a start (subs rarely play 60+). */
  startMinutesThreshold: number;
};

export const DEFAULT_ACTUALS: ActualsConfig = {
  teamK: 6,
  minutesK: 6,
  ratesK: 900,
  gkK: 5,
  startK: 900,
  startMinutesThreshold: 60,
};

/** Percentile scenarios — parametric, deliberately simple and auditable (full
 * Monte Carlo is out of scope per the map). "Burst" terms (goals, assists,
 * shots, chances) scale with role form; "stable" terms (passing/cross/tackle
 * volume) barely move; team terms (CS/GC) track matches × team form.
 */
export type ScenarioConfig = {
  p10: {
    /** Minutes: role loss / injury absence. */
    minutesFactor: number;
    burstFactor: number;
    stableFactor: number;
    teamFormFactor: number;
  };
  p90: {
    minutesFactor: number;
    /** Breakout multipliers on burst terms, by position — attackers skew widest. */
    burstByPosition: Record<Position, number>;
    stableFactor: number;
    teamFormFactor: number;
  };
};

export const DEFAULT_SCENARIOS: ScenarioConfig = {
  p10: { minutesFactor: 0.6, burstFactor: 0.88, stableFactor: 0.95, teamFormFactor: 0.97 },
  p90: {
    minutesFactor: 1.1,
    burstByPosition: { G: 1.05, D: 1.12, MD: 1.2, FW: 1.25 },
    stableFactor: 1.03,
    teamFormFactor: 1.08,
  },
};

/**
 * Fixture-difficulty adjustment knobs (#42). Opponent strength (FPL FDR,
 * 1 easy … 5 hard, per side per fixture) enters as factors **relative to the
 * club's own calendar-mean difficulty**: factor = 1 + slope × (d̄ − d) for
 * output-raising slopes (easier fixture → more), sign-flipped for terms that
 * rise against harder opponents (goals conceded, saves — a busier keeper).
 * Because d̄ is the club's own mean, every factor family averages exactly 1
 * over a club's season: season-long output is opponent-neutral by
 * construction (bit-for-bit False Nine parity), and short windows express
 * genuine schedule strength — Saturday vs SUN is not Saturday vs MCI.
 *
 * What each family touches (the settled answer to "where do opponent
 * adjustments touch rates"):
 * - attack — goals, assists, shots on/off target, chances created (both the
 *   per-player key-pass branch and the baseline floor branch).
 * - cleanSheet / goalsConceded / gkWin — defensive counting terms (G + D CS/GC,
 *   G-only wins).
 * - saves — G-only; rises against harder opponents (more shots faced).
 * Crosses, tackles, passes, and penalty saves are minutes-volume terms —
 * unadjusted (v1; slopes are cheap to add if evidence demands).
 *
 * Slopes are per unit of FDR relative to the club mean; 0.12 ≈ a two-step
 * difficulty swing (2→4) moving attack output ∓24%. League-eyeball v1, like
 * the conversions — tune against results, not theory.
 */
export type FixtureDifficultyConfig = {
  attackSlope: number;
  cleanSheetSlope: number;
  goalsConcededSlope: number;
  savesSlope: number;
  gkWinSlope: number;
};

export const DEFAULT_FIXTURE_DIFFICULTY: FixtureDifficultyConfig = {
  attackSlope: 0.12,
  cleanSheetSlope: 0.15,
  goalsConcededSlope: 0.12,
  savesSlope: 0.08,
  gkWinSlope: 0.12,
};

/**
 * Results-driven opponent strength knobs (#92) — the DVOA-style layer that
 * replaces the FDR slopes once the snapshot carries a `strength` section
 * (docs/research/opponent-strength-signals.md). Estimator: shrunk
 * league-mean multipliers in the #43 pseudo-count form —
 *   A_i = (Σattack_i + kA·μ·Fᴬ_i)/(n_i + kA)/μ ,  D_i likewise on concede —
 * seeded from FDR-extracted club quality so n=0 is pure FDR (no cliff
 * between the paths) and shrinking toward observed results as matches
 * accumulate. Factors are RATIO-formed per fixture,
 *   factor = (M_fixture / M̄_calendar)^γ  (then renormalized to calendar-mean
 *   exactly 1 — γ curvature would otherwise drift season means ~1% low),
 * where M is the opponent-keyed multiplier: attack family reads the
 * opponent's concession multiplier × own venue boost; cs/gc/saves read the
 * opponent's attack multiplier × their venue boost; gk-win reads the
 * composite (own venue × opponent leakiness)/(their venue × their attack).
 * Own-club strength cancels in the ratio by construction — it lives in the
 * #43 actuals blending, so the fixture factor carries only "who you're
 * playing", never "who you are".
 *
 * - `gamma.*` — response magnitude per family (the power dial). 0.6 ≈ the
 *   empirical shrunk spread (±40% season extremes) × FDR's ±24% response;
 *   family ratios mirror the FDR slopes' proportions.
 * - `homeBoost` — league-wide venue multiplier (arithmetic-symmetric pair
 *   homeBoost / 2 − homeBoost averages exactly 1 over a balanced calendar).
 *   Club-specific venue quality = the sample split the research measured as
 *   noise; revisit with 2+ seasons of Understat history.
 * - `seedSlope` — FDR-extracted quality → seed-multiplier slope; sign
 *   symmetric (strong club: attack seed up, concession seed down).
 * - shrinkage: xG-scale constants (kA 6 = #43's teamK, kD 10) per the
 *   walk-forward calibration; goal-scale (the fixture-scores fallback) needs
 *   roughly double (kA 18, kD 13) to be equally competitive.
 */
export type FixtureStrengthConfig = {
  kAttack: number;
  kDefense: number;
  kAttackGoals: number;
  kDefenseGoals: number;
  gamma: { attack: number; cs: number; gc: number; saves: number; win: number };
  homeBoost: number;
  seedSlope: number;
};

export const DEFAULT_FIXTURE_STRENGTH: FixtureStrengthConfig = {
  kAttack: 6,
  kDefense: 10,
  kAttackGoals: 18,
  kDefenseGoals: 13,
  gamma: { attack: 0.6, cs: 0.75, gc: 0.6, saves: 0.4, win: 0.6 },
  homeBoost: 1.11,
  seedSlope: 0.12,
};

/** Team-defensive priors: last season blended with league mean. */
export type TeamRegression = {
  /** Weight on last season's rates (rest = league mean). */
  lastSeasonWeight: number;
  /** League-mean fallbacks when a team has no 2025/26 EPL data (promoted). */
  meanCleanSheetRate: number;
  meanGoalsConcededPerMatch: number;
  meanGoalsForPerMatch: number;
  /** GK win-rate proxy: clamp(intercept + slope × (GF/m − GA/m), lo, hi). */
  winRate: { intercept: number; slope: number; lo: number; hi: number };
  /** Keeper saves/90 prior when no history. */
  meanSavesPer90: number;
};

export const DEFAULT_TEAM_REGRESSION: TeamRegression = {
  lastSeasonWeight: 0.65,
  meanCleanSheetRate: 0.276,
  meanGoalsConcededPerMatch: 1.45,
  meanGoalsForPerMatch: 1.45,
  winRate: { intercept: 0.34, slope: 0.55, lo: 0.18, hi: 0.68 },
  meanSavesPer90: 3.1,
};

/**
 * Tiering: natural breaks in the projected p50 distribution within each
 * position — tiers are the clusters that emerge from the model's own
 * estimates (forward-looking), never from fixed band sizes or price/value.
 * A break lands where the gap between consecutive players exceeds
 * max(minGap, gapMultiplier × mean gap); only the largest gaps survive up to
 * maxTiers. An isolated elite (e.g. a Haaland-sized gap) legitimately forms
 * a one-player tier.
 */
export type TieringConfig = {
  gapMultiplier: number;
  minGap: number;
  maxTiers: number;
  /** Flat-position plateaus (mid-tier D/MD blobs): any tier larger than this
   *  splits recursively at its largest internal gap, so tiers stay draft-room
   *  sized even where the projection distribution is honest-but-flat. */
  maxTierSize: number;
  /** Players beyond this position depth (by posRank) fall into residual tier 9
   *  — tiers exist where the draft happens, not down the bench-fodder tail. */
  draftableDepth: Record<Position, number>;
};

export const DEFAULT_TIERING: TieringConfig = {
  gapMultiplier: 2.5,
  minGap: 8,
  maxTiers: 8,
  maxTierSize: 15,
  draftableDepth: { G: 25, D: 50, MD: 70, FW: 50 },
};

/**
 * Tournament-shape adjustments (#10): best-ball payouts reward boom weeks, not
 * mean output, so the sheet ranks on a ceiling-weighted score rather than raw
 * p50 — while raw p50 stays visible unadjusted (the "Pts" column) so the
 * adjustment is auditable, not hidden inside a single number.
 */
export type TournamentConfig = {
  /** Blend weight toward p90 in the ranking score: score = p50 + ceilingWeight × (p90 − p50). */
  ceilingWeight: number;
  /** A player's projected-minutes share of maxMinutes below this is flagged
   *  durability/rotation risk for the 26-week Round 1 grind. */
  minutesShareRiskThreshold: number;
  /** Multi-season start-rate below this also flags risk (undercuts a healthy
   *  minutes total padded by garbage-time cameos). */
  startFractionRiskThreshold: number;
  /** FBref unused-subs per 90 played above this flags durability/minutes risk
   *  (bench-heavy role — a player benched entirely more often than they're on
   *  the pitch is a rotation bet, not a Round-1 grind pick). Null when the
   *  playing-time page wasn't parsed. */
  unusedSubsRiskPer90: number;
  /** Ceiling boost applied to flagged players is scaled by this factor
   *  (0 = no boost, 1 = full boost) — a boom-week proxy is only worth
   *  drafting toward if the player is trusted to be on the pitch. */
  riskCeilingDampen: number;
};

export const DEFAULT_TOURNAMENT: TournamentConfig = {
  ceilingWeight: 0.2,
  minutesShareRiskThreshold: 0.5,
  startFractionRiskThreshold: 0.55,
  unusedSubsRiskPer90: 0.6,
  riskCeilingDampen: 0.3,
};

/**
 * Replacement-level shape for VORP-style draft value (#Pickford-4th): raw
 * tournamentScore ranks cross-position on "how many points," which overrates
 * shallow, low-variance positions (one keeper needed, flat curve) against
 * deep ones (multiple MD/FW slots, steep drop-off). `draftValue` instead asks
 * "how much does this player beat what's left at his position when your
 * league runs out of starters for it" — the standard fantasy VORP fix.
 *
 * Mirrors a profile's roster shape (`RosterShape` + `draft.draftSize` in
 * src/contest/profiles.ts) but lives here, one level below `contest/`, so the
 * model has no dependency on the profile module. `replacementConfigFor` in
 * profiles.ts is the one place that builds this from a profile.
 */
export type ReplacementConfig = {
  /** Starters per position, league-wide. */
  starters: Record<Position, number>;
  /** FLEX slots per team — assumed pulled evenly from D/MD/FW (never G, per
   *  the FLEX rule everywhere else in this codebase). */
  flex: number;
  /** Teams in the draft room. */
  draftSize: number;
};

/** False Nine's shape (12-team, 1G/2D/2MD/2FW + 2 FLEX) — the default for any
 *  caller that doesn't pass an explicit contest profile. */
export const DEFAULT_REPLACEMENT: ReplacementConfig = {
  starters: { G: 1, D: 2, MD: 2, FW: 2 },
  flex: 2,
  draftSize: 12,
};

export type ModelConfig = {
  scoring: ScoringConfig;
  conversions: ConversionConfig;
  volume: VolumeConfig;
  minutes: MinutesConfig;
  rates: RateConfig;
  actuals: ActualsConfig;
  odds: OddsBlendConfig;
  scenarios: ScenarioConfig;
  team: TeamRegression;
  fixture: FixtureDifficultyConfig;
  strength: FixtureStrengthConfig;
  tiering: TieringConfig;
  tournament: TournamentConfig;
};

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  scoring: DEFAULT_SCORING,
  conversions: DEFAULT_CONVERSIONS,
  volume: DEFAULT_VOLUME_CONFIG,
  minutes: DEFAULT_MINUTES,
  rates: DEFAULT_RATES,
  actuals: DEFAULT_ACTUALS,
  odds: DEFAULT_ODDS_BLEND,
  scenarios: DEFAULT_SCENARIOS,
  team: DEFAULT_TEAM_REGRESSION,
  fixture: DEFAULT_FIXTURE_DIFFICULTY,
  strength: DEFAULT_FIXTURE_STRENGTH,
  tiering: DEFAULT_TIERING,
  tournament: DEFAULT_TOURNAMENT,
};
