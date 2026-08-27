/**
 * Next-pick recommendations (first-$3-draft feedback #7): pure math over the
 * board (projected, not off-board), my roster, and my queue. Mid-to-late
 * round support — fights the familiarity bias ("I don't know half these
 * players") with model-default targets, and the correlation bias ("I drafted
 * three players from the same club") with club-cluster tags.
 */
import type { Position, SnapshotFixture, SnapshotPlayer } from './types.js';
import { FALSE_NINE, POSITIONS, type ContestProfile } from '../contest/profiles.js';
import {
  clubPositionCounts,
  matchOpponentClubRules,
  matchSameClubRules,
  opponentClubSources,
  type Rule,
} from '../stacking/rules.js';

export type TargetState = 'need' | 'ok' | 'full';

export type Rec = {
  player: SnapshotPlayer;
  /** Short annotation chips: club cluster, CS correlation, scarcity, need. */
  tags: string[];
};

export type LiveRecs = {
  picksLeft: number;
  shape: ShapeEntry[];
  /** Clubs on my roster worth flagging for correlation. */
  clubChips: { club: string; count: number; attackers: number; matchedRules: Rule[] }[];
  /** For each roster stack rule that matched, the opponent club whose
   *  attackers now carry the anti-stack warning (#120). */
  oppWarnings: { oppClub: string; club: string; rule: Rule }[];
  /** My queue ∩ board, best first (the drafting pool). */
  queued: Rec[];
  /** Best players on the board, whatever the position. */
  bpa: Rec[];
  /** Model default target per position + that slot's fill state, plus the
   *  highest-floor (p10) and highest-ceiling (p90) alternative at the same
   *  position — lets a drafter pick safety or upside without leaving the panel. */
  byPosition: {
    pos: Position;
    state: TargetState;
    rec: Rec | null;
    floor: Rec | null;
    ceiling: Rec | null;
  }[];
};

/** One roster-shape chip: drafted count vs starting slots for a position
 *  (or the shared FLEX pool — every spot that will start, not just the
 *  exact-position slots). */
export type ShapeEntry = {
  pos: Position | 'FLEX';
  count: number;
  starter: number;
  target: number;
  state: TargetState;
};

function ordinal(n: number): string {
  return `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

export function buildRecommendations(
  pool: SnapshotPlayer[],
  drafted: ReadonlySet<string>,
  mine: ReadonlySet<string>,
  queue: ReadonlySet<string>,
  profile: ContestProfile = FALSE_NINE,
  /** Slate window fixtures — drive the opponent-club anti-stack matches
   *  (#120). Empty (season-long) matches nothing. */
  fixtures: SnapshotFixture[] = [],
): LiveRecs {
  // Starter minimums, balanced-shape targets, and roster size come from the
  // contest profile (#39) — False Nine's shape by default.
  const STARTER_NEEDS = profile.roster.starters;
  const ROSTER_TARGETS = profile.roster.targets;
  const ROSTER_SIZE = profile.roster.rosterSize;
  const board = pool.filter((p) => p.projection && !drafted.has(p.id));
  const roster = pool.filter((p) => mine.has(p.id));
  const score = (p: SnapshotPlayer) => p.projection?.tournamentScore ?? 0;
  const byScore = (a: SnapshotPlayer, b: SnapshotPlayer) => score(b) - score(a);

  // Roster shape vs starter minimums + balanced targets.
  const counts: Record<Position, number> = { G: 0, D: 0, MD: 0, FW: 0 };
  for (const p of roster) counts[p.position] += 1;
  const shape: ShapeEntry[] = POSITIONS.map((pos) => ({
    pos,
    count: counts[pos],
    starter: STARTER_NEEDS[pos],
    target: ROSTER_TARGETS[pos],
    state: (counts[pos] < STARTER_NEEDS[pos]
      ? 'need'
      : counts[pos] < ROSTER_TARGETS[pos]
        ? 'ok'
        : 'full') as TargetState,
  }));
  // FLEX starter slots: players drafted beyond a position's exact-starter
  // minimum are the flex fillers (the same best-lineup semantics as
  // computeStarters in drafts/review.ts); overflow past the flex count is
  // bench. Daily no-bench slates therefore count every pick — all roster
  // spots start.
  const flexSlots = profile.roster.flex;
  if (flexSlots > 0) {
    const overflow = POSITIONS.reduce(
      (sum, pos) => sum + Math.max(0, counts[pos] - STARTER_NEEDS[pos]),
      0,
    );
    const flexCount = Math.min(flexSlots, overflow);
    shape.push({
      pos: 'FLEX',
      count: flexCount,
      starter: flexSlots,
      target: flexSlots,
      state: flexCount < flexSlots ? 'need' : 'full',
    });
  }

  // Club clusters on my roster — the correlation watch.
  const clubMap = new Map<
    string,
    { count: number; attackers: number; positions: Partial<Record<Position, number>> }
  >();
  for (const p of roster) {
    const entry = clubMap.get(p.team) ?? { count: 0, attackers: 0, positions: {} };
    entry.count += 1;
    if (p.position === 'MD' || p.position === 'FW') entry.attackers += 1;
    entry.positions[p.position] = (entry.positions[p.position] ?? 0) + 1;
    clubMap.set(p.team, entry);
  }
  const clubChips = [...clubMap.entries()]
    .filter(([, e]) => e.count >= 2)
    .map(([club, e]) => ({
      club,
      count: e.count,
      attackers: e.attackers,
      matchedRules: matchSameClubRules(e.positions),
    }))
    .sort((a, b) => b.count - a.count);

  // Opponent-attacker anti-stack warnings (#120): a matched roster stack at
  // club X makes X's fixture opponent's attackers a correlated-against pick.
  const rosterByClub = clubPositionCounts(roster);
  const oppWarnings = opponentClubSources(rosterByClub, fixtures);

  // How many board players remain in each position-tier (scarcity).
  const tierLeft = new Map<string, number>();
  for (const p of board) {
    if (!p.projection) continue;
    const key = `${p.position}:${p.projection.tier}`;
    tierLeft.set(key, (tierLeft.get(key) ?? 0) + 1);
  }

  const tagsFor = (player: SnapshotPlayer): string[] => {
    const tags: string[] = [];
    const myClub = clubMap.get(player.team);
    if (myClub && myClub.count >= 1) {
      tags.push(`${ordinal(myClub.count + 1)} ${player.team}`);
      // Would this pick complete a same-club stack rule for this club?
      const withPick = { ...myClub.positions, [player.position]: (myClub.positions[player.position] ?? 0) + 1 };
      for (const rule of matchSameClubRules(withPick)) tags.push(rule.label);
    }
    // Does this pick face a roster stack? (#120 — attackers vs a G+D CS pair.)
    if (fixtures.length > 0) {
      for (const m of matchOpponentClubRules(player, rosterByClub, fixtures)) {
        tags.push(`⚔ vs ${m.club}`);
      }
    }
    if (player.projection) {
      const left = tierLeft.get(`${player.position}:${player.projection.tier}`) ?? 0;
      if (left <= 3) tags.push(`T${player.projection.tier} ×${left} left`);
    }
    return tags;
  };

  const ranked = [...board].sort(byScore);
  const queued = board
    .filter((p) => queue.has(p.id))
    .sort(byScore)
    .slice(0, 8)
    .map((player) => ({ player, tags: tagsFor(player) }));

  const bpa = ranked.slice(0, 3).map((player) => ({ player, tags: tagsFor(player) }));

  const byFloor = (a: SnapshotPlayer, b: SnapshotPlayer) =>
    (b.projection?.points.p10 ?? 0) - (a.projection?.points.p10 ?? 0);
  const byCeiling = (a: SnapshotPlayer, b: SnapshotPlayer) =>
    (b.projection?.points.p90 ?? 0) - (a.projection?.points.p90 ?? 0);

  const byPosition = POSITIONS.map((pos) => {
    const state = shape.find((s) => s.pos === pos)!.state;
    const atPos = board.filter((p) => p.position === pos);
    const best = atPos.slice().sort(byScore)[0] ?? null;
    const floor = atPos.slice().sort(byFloor)[0] ?? null;
    const ceiling = atPos.slice().sort(byCeiling)[0] ?? null;
    return {
      pos,
      state,
      rec: best ? { player: best, tags: tagsFor(best) } : null,
      floor: floor ? { player: floor, tags: tagsFor(floor) } : null,
      ceiling: ceiling ? { player: ceiling, tags: tagsFor(ceiling) } : null,
    };
  });

  return { picksLeft: Math.max(0, ROSTER_SIZE - roster.length), shape, clubChips, oppWarnings, queued, bpa, byPosition };
}
