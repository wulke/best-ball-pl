/**
 * Draft-review lenses (#18): pure math over the snapshot pool + a parsed pick
 * log. No React, no storage — trivially dev-testable against the fixture.
 *
 * The sheet's ranking currency is `tournamentScore` (ceiling-weighted, #10);
 * raw p50 stays visible alongside, never folded into one number.
 */
import type { Position, SnapshotPlayer } from '../types.js';
import type { CarryFlag, PickLogEntry } from './types.js';

export type { CarryFlag };

/** Starter shape: 1 G / 2 D / 2 MD / 2 FW / 2 FLEX = 9 starting slots. */
const STARTER_NEEDS: Record<Position, number> = { G: 1, D: 2, MD: 2, FW: 2 };
const POSITIONS: Position[] = ['G', 'D', 'MD', 'FW'];
const ROSTER_SIZE = 18;
/** A full 12-team room drafts ~216 picks; below this the BPA board is suspect. */
const FULL_LOG_FLOOR = 180;

export type DeviationRow = {
  pick: number;
  round: number;
  mine: SnapshotPlayer;
  /** Best sheet-ranked player on the board at my pick (overall). */
  bpa: SnapshotPlayer;
  /** mine.overallRank − bpa.overallRank; positive = reached past a better player. */
  rankDelta: number;
  /** bpa − mine on tournamentScore; positive = points left on the board. */
  scoreDelta: number;
  /** Best same-position player on the board (secondary lens); null when mine is it. */
  posBpa: SnapshotPlayer | null;
  posScoreDelta: number;
};

export type Headline = {
  rosterScore: number;
  sheetPerfectScore: number;
  percent: number;
  rosterP50: number;
  sheetPerfectP50: number;
  p50Percent: number;
};

export type StarterSlot = { slot: Position | 'FLEX'; player: SnapshotPlayer | null };

export type PseudoStarters = {
  slots: StarterSlot[];
  legal: boolean;
  missing: Position[];
  total: number;
};

export type TierMix = {
  maxTier: number;
  starters: number[]; // counts by tier index (1-based → index 0 unused)
  bench: number[];
  /** Avg p10/p50 across pseudo-starters — the floor gauge. */
  floorRatio: number | null;
  durabilityFlagged: number;
};

export type ClubRow = {
  club: string;
  counts: Record<Position, number>;
  total: number;
  /** 1 = best quartile (projected clean sheets); 4 = worst. */
  defenseQuartile: number;
  /** 1 = best quartile (projected attacking output); 4 = worst. */
  attackQuartile: number;
};

export type ClubGrid = {
  rows: ClubRow[];
  /** Clubs whose keepers/defenders sit in the top CS quartile. */
  eliteDefenseClubs: string[];
  /** Clubs in the top attacking quartile. */
  eliteAttackClubs: string[];
};

export type DraftReview = {
  teamCount: number;
  pickCount: number;
  matchedCount: number;
  unmatchedCount: number;
  partialLog: boolean;
  deviations: DeviationRow[];
  /** My picks that matched no pool player (transfer insurance etc.). */
  unmatchedMine: { pick: number; round: number; rawName: string }[];
  headline: Headline;
  starters: PseudoStarters;
  tierMix: TierMix;
  clubGrid: ClubGrid;
  /** Top auto-flags for the carry-forward card, severity-ordered. */
  flags: CarryFlag[];
};

type Pool = SnapshotPlayer[];

const score = (p: SnapshotPlayer): number => p.projection?.tournamentScore ?? 0;
const rank = (p: SnapshotPlayer): number => p.projection?.overallRank ?? Number.MAX_SAFE_INTEGER;

/** The #18 deviation lens: every own pick vs the best player still on the board. */
function computeDeviations(
  pool: Pool,
  picks: PickLogEntry[],
  myTeam: string,
): {
  rows: DeviationRow[];
  unmatched: { pick: number; round: number; rawName: string }[];
} {
  const rows: DeviationRow[] = [];
  const unmatched: { pick: number; round: number; rawName: string }[] = [];
  const taken = new Set<string>();

  for (const entry of picks) {
    if (entry.playerId) taken.add(entry.playerId);

    if (entry.team !== myTeam) continue;
    const mine = entry.playerId ? pool.find((p) => p.id === entry.playerId) : undefined;
    if (!mine?.projection) {
      unmatched.push({ pick: entry.pick, round: entry.round, rawName: entry.rawName });
      continue;
    }

    let bpa: SnapshotPlayer | null = null;
    let posBpa: SnapshotPlayer | null = null;
    for (const p of pool) {
      if (!p.projection || taken.has(p.id)) continue;
      if (!bpa || rank(p) < rank(bpa)) bpa = p;
      if (
        p.position === mine.position &&
        (!posBpa ||
          (p.projection!.posRank ?? 0) < (posBpa.projection!.posRank ?? 0))
      ) {
        posBpa = p;
      }
    }
    if (!bpa) continue;
    // Mine was added to `taken` above, so posBpa (if found) is a real alternative.
    const posAlternative = posBpa && posBpa.id !== mine.id ? posBpa : null;

    rows.push({
      pick: entry.pick,
      round: entry.round,
      mine,
      bpa,
      rankDelta: rank(mine) - rank(bpa),
      scoreDelta: score(bpa) - score(mine),
      posBpa: posAlternative,
      posScoreDelta: posAlternative ? score(posAlternative) - score(mine) : 0,
    });
  }
  return { rows, unmatched };
}

/**
 * Sheet-perfect top-18: the literal top of the sheet repaired to a legal
 * minimum shape (≥1 G / 2 D / 2 MD / 2 FW). Take the top 18 by rank, then swap
 * the lowest-ranked surplus players for the best available quota fillers —
 * exchange-optimal for this quota structure (18 slots vs 8 quota slots always
 * leaves droppable surplus).
 */
function sheetPerfect(pool: Pool): Pool {
  const sorted = [...pool].filter((p) => p.projection).sort((a, b) => rank(a) - rank(b));
  const chosen = sorted.slice(0, ROSTER_SIZE);
  const chosenIds = (): Set<string> => new Set(chosen.map((p) => p.id));
  const counts = (): Record<Position, number> => {
    const out: Record<Position, number> = { G: 0, D: 0, MD: 0, FW: 0 };
    for (const p of chosen) out[p.position] += 1;
    return out;
  };

  for (const pos of POSITIONS) {
    while (counts()[pos] < STARTER_NEEDS[pos]) {
      const ids = chosenIds();
      const filler = sorted.find((p) => p.position === pos && !ids.has(p.id));
      if (!filler) break;
      // Drop the lowest-ranked chosen player whose position is over quota —
      // by rank order this is the weakest droppable member.
      const current = counts();
      const dropIndex = chosen.reduce((worst, p, index) => {
        if (current[p.position] <= STARTER_NEEDS[p.position]) return worst;
        return worst === -1 || rank(p) > rank(chosen[worst]) ? index : worst;
      }, -1);
      if (dropIndex === -1) break;
      chosen[dropIndex] = filler;
    }
  }
  return chosen;
}

function computeHeadline(pool: Pool, roster: Pool): Headline {
  const perfect = sheetPerfect(pool);
  const rosterScore = roster.reduce((sum, p) => sum + score(p), 0);
  const perfectScore = perfect.reduce((sum, p) => sum + score(p), 0);
  const rosterP50 = roster.reduce((sum, p) => sum + (p.projection?.points.p50 ?? 0), 0);
  const perfectP50 = perfect.reduce((sum, p) => sum + (p.projection?.points.p50 ?? 0), 0);
  return {
    rosterScore,
    sheetPerfectScore: perfectScore,
    percent: perfectScore > 0 ? (rosterScore / perfectScore) * 100 : 0,
    rosterP50,
    sheetPerfectP50: perfectP50,
    p50Percent: perfectP50 > 0 ? (rosterP50 / perfectP50) * 100 : 0,
  };
}

/** Best legal 9 from the roster: 1G/2D/2MD/2FW starters + 2 FLEX (any position). */
function computeStarters(roster: Pool): PseudoStarters {
  const byPos: Record<Position, SnapshotPlayer[]> = { G: [], D: [], MD: [], FW: [] };
  for (const p of roster) byPos[p.position].push(p);
  POSITIONS.forEach((pos) => byPos[pos].sort((a, b) => score(b) - score(a)));

  const used = new Set<string>();
  const take = (pos: Position): SnapshotPlayer | null => {
    const next = byPos[pos].find((p) => !used.has(p.id)) ?? null;
    if (next) used.add(next.id);
    return next;
  };

  const slots: StarterSlot[] = [];
  const missing: Position[] = [];
  (['G', 'D', 'D', 'MD', 'MD', 'FW', 'FW'] as const).forEach((pos) => {
    const player = take(pos);
    if (!player) missing.push(pos);
    slots.push({ slot: pos, player });
  });
  const rest = roster
    .filter((p) => !used.has(p.id))
    .sort((a, b) => score(b) - score(a));
  for (let i = 0; i < 2; i += 1) slots.push({ slot: 'FLEX', player: rest[i] ?? null });

  const total = slots.reduce((sum, s) => sum + (s.player ? score(s.player) : 0), 0);
  return { slots, legal: missing.length === 0, missing, total };
}

function computeTierMix(roster: Pool, starters: PseudoStarters): TierMix {
  const starterIds = new Set(
    starters.slots.flatMap((s) => (s.player ? [s.player.id] : [])),
  );
  const maxTier = roster.reduce((max, p) => Math.max(max, p.projection?.tier ?? 0), 0);
  const bucket = (starter: boolean): number[] => {
    const out = new Array<number>(maxTier + 1).fill(0);
    for (const p of roster) {
      if (p.projection && starterIds.has(p.id) === starter) out[p.projection.tier] += 1;
    }
    return out;
  };
  const starterPlayers = starters.slots.flatMap((s) => (s.player ? [s.player] : []));
  const floorRatios = starterPlayers
    .filter((p) => p.projection && p.projection.points.p50 > 0)
    .map((p) => p.projection!.points.p10 / p.projection!.points.p50);
  return {
    maxTier,
    starters: bucket(true),
    bench: bucket(false),
    floorRatio:
      floorRatios.length > 0
        ? floorRatios.reduce((a, b) => a + b, 0) / floorRatios.length
        : null,
    durabilityFlagged: starterPlayers.filter((p) => p.projection?.durabilityRisk).length,
  };
}

function computeClubGrid(pool: Pool, roster: Pool): ClubGrid {
  const clubs = [...new Set(pool.map((p) => p.team))].sort();

  // Defense strength: the club's most-projected keeper's clean-sheet line — a
  // direct club CS-rate signal. Attack: top-4 FW/MD projected goals — squad-
  // listing depth can't inflate it.
  const defense = new Map<string, number>();
  const attack = new Map<string, number>();
  for (const club of clubs) {
    const gks = pool
      .filter((p) => p.team === club && p.position === 'G' && p.projection)
      .sort((a, b) => (b.projection!.minutes ?? 0) - (a.projection!.minutes ?? 0));
    defense.set(club, gks[0]?.projection?.statline.cleanSheets ?? 0);
    const attackers = pool
      .filter((p) => p.team === club && (p.position === 'FW' || p.position === 'MD') && p.projection)
      .sort((a, b) => (b.projection?.statline.goals ?? 0) - (a.projection?.statline.goals ?? 0))
      .slice(0, 4);
    attack.set(club, attackers.reduce((sum, p) => sum + (p.projection?.statline.goals ?? 0), 0));
  }

  const quartileOf = (values: Map<string, number>): Map<string, number> => {
    const ordered = [...values.entries()].sort((a, b) => b[1] - a[1]).map(([club]) => club);
    const out = new Map<string, number>();
    ordered.forEach((club, index) => {
      out.set(club, Math.min(4, Math.floor((index / ordered.length) * 4) + 1));
    });
    return out;
  };
  const defQ = quartileOf(defense);
  const attQ = quartileOf(attack);

  const rows: ClubRow[] = clubs.map((club) => {
    const counts: Record<Position, number> = { G: 0, D: 0, MD: 0, FW: 0 };
    for (const p of roster) if (p.team === club) counts[p.position] += 1;
    return {
      club,
      counts,
      total: counts.G + counts.D + counts.MD + counts.FW,
      defenseQuartile: defQ.get(club) ?? 4,
      attackQuartile: attQ.get(club) ?? 4,
    };
  });

  return {
    rows,
    eliteDefenseClubs: rows.filter((r) => r.defenseQuartile === 1).map((r) => r.club),
    eliteAttackClubs: rows.filter((r) => r.attackQuartile === 1).map((r) => r.club),
  };
}

function buildFlags(
  deviations: DeviationRow[],
  headline: Headline,
  starters: PseudoStarters,
  tierMix: TierMix,
  clubGrid: ClubGrid,
  roster: Pool,
  unmatchedMine: { rawName: string }[],
): CarryFlag[] {
  const red: CarryFlag[] = [];
  const amber: CarryFlag[] = [];

  // Lens 5 auto gap-flags.
  const eliteCsExposure = clubGrid.rows.some(
    (r) => r.defenseQuartile === 1 && (r.counts.G > 0 || r.counts.D > 0),
  );
  if (!eliteCsExposure) {
    red.push({
      severity: 'red',
      text: 'No G/D from a top-quartile clean-sheet defense — CS points left unexposed.',
    });
  }

  const attackers = roster.filter((p) => p.position === 'MD' || p.position === 'FW');
  const bottomHalf = attackers.filter(
    (p) => (clubGrid.rows.find((r) => r.club === p.team)?.attackQuartile ?? 4) >= 3,
  ).length;
  if (attackers.length >= 4 && bottomHalf / attackers.length >= 0.7) {
    amber.push({
      severity: 'amber',
      text: `Attackers concentrated in bottom-half attacks: ${bottomHalf}/${attackers.length} MD/FW.`,
    });
  }

  const concentrated = clubGrid.rows.find((r) => r.total >= 4);
  if (concentrated) {
    amber.push({
      severity: 'amber',
      text: `Club concentration: ${concentrated.total} players from ${concentrated.club} (lineup must span ≥2 clubs).`,
    });
  }

  // Lens 4 extremes (tiers-as-is in v1).
  const eliteStarters = tierMix.starters.slice(1, 3).reduce((a, b) => a + b, 0);
  if (eliteStarters === 0 && roster.length > 0) {
    amber.push({
      severity: 'amber',
      text: 'No pseudo-starter from tiers 1–2 — no spike source in the best 9.',
    });
  }
  if (tierMix.floorRatio !== null && tierMix.floorRatio < 0.55) {
    amber.push({
      severity: 'amber',
      text: `Spike-heavy starters: avg p10/p50 = ${tierMix.floorRatio.toFixed(2)} — thin floor.`,
    });
  }
  if (tierMix.durabilityFlagged >= 3) {
    amber.push({
      severity: 'amber',
      text: `${tierMix.durabilityFlagged} pseudo-starters carry the durability-risk flag.`,
    });
  }

  // Lens 1: the two largest reaches.
  deviations
    .filter((d) => d.scoreDelta >= 12)
    .sort((a, b) => b.scoreDelta - a.scoreDelta)
    .slice(0, 2)
    .forEach((d) => {
      amber.push({
        severity: 'amber',
        text: `R${d.round}: took ${d.mine.name} over BPA ${d.bpa.name} (−${d.scoreDelta.toFixed(0)} pts).`,
      });
    });

  if (!starters.legal) {
    amber.push({
      severity: 'amber',
      text: `Cannot field a legal 9: short ${starters.missing.join('/')}.`,
    });
  }
  // 12-team rooms sit ~50–55% of the naive sheet-perfect baseline by construction
  // (top-18 is unattainable) — flag only clearly-below-room-average outcomes.
  if (headline.percent < 45) {
    amber.push({
      severity: 'amber',
      text: `Roster at ${headline.percent.toFixed(0)}% of sheet-perfect (tournament score).`,
    });
  }
  if (unmatchedMine.length > 0) {
    amber.push({
      severity: 'amber',
      text: `${unmatchedMine.length} own pick(s) unmatched (transfer insurance?) — outside the model.`,
    });
  }

  return [...red, ...amber].slice(0, 5);
}

/** Run every lens over a room's pick log. Null until myTeam is picked. */
export function reviewRoom(
  pool: Pool,
  picks: PickLogEntry[],
  myTeam: string | null,
): DraftReview | null {
  if (!myTeam || picks.length === 0) return null;
  const projected = pool.filter((p) => p.projection);
  const teams = new Set(picks.map((p) => p.team));

  const { rows: deviations, unmatched: unmatchedMine } = computeDeviations(
    projected,
    picks,
    myTeam,
  );
  const mine = picks
    .filter((p) => p.team === myTeam && p.playerId)
    .map((p) => projected.find((q) => q.id === p.playerId!))
    .filter((p): p is SnapshotPlayer => Boolean(p?.projection));

  const headline = computeHeadline(projected, mine);
  const starters = computeStarters(mine);
  const tierMix = computeTierMix(mine, starters);
  const clubGrid = computeClubGrid(pool, mine);
  const flags = buildFlags(deviations, headline, starters, tierMix, clubGrid, mine, unmatchedMine);

  return {
    teamCount: teams.size,
    pickCount: picks.length,
    matchedCount: picks.filter((p) => p.playerId).length,
    unmatchedCount: picks.filter((p) => !p.playerId).length,
    partialLog: picks.length < FULL_LOG_FLOOR,
    deviations,
    unmatchedMine,
    headline,
    starters,
    tierMix,
    clubGrid,
    flags,
  };
}
