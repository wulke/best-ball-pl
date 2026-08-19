/**
 * Next-pick recommendations (first-$3-draft feedback #7): pure math over the
 * board (projected, not off-board), my roster, and my queue. Mid-to-late
 * round support — fights the familiarity bias ("I don't know half these
 * players") with model-default targets, and the correlation bias ("I drafted
 * three players from the same club") with club-cluster tags.
 */
import type { Position, SnapshotPlayer } from './types.js';
import { FALSE_NINE, POSITIONS, type ContestProfile } from '../contest/profiles.js';

export type TargetState = 'need' | 'ok' | 'full';

export type Rec = {
  player: SnapshotPlayer;
  /** Short annotation chips: club cluster, CS correlation, scarcity, need. */
  tags: string[];
};

export type LiveRecs = {
  picksLeft: number;
  shape: { pos: Position; count: number; starter: number; target: number; state: TargetState }[];
  /** Clubs on my roster worth flagging for correlation. */
  clubChips: { club: string; count: number; attackers: number; csBlock: boolean }[];
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

function ordinal(n: number): string {
  return `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

export function buildRecommendations(
  pool: SnapshotPlayer[],
  drafted: ReadonlySet<string>,
  mine: ReadonlySet<string>,
  queue: ReadonlySet<string>,
  profile: ContestProfile = FALSE_NINE,
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
  const shape = POSITIONS.map((pos) => ({
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

  // Club clusters on my roster — the correlation watch.
  const clubMap = new Map<string, { count: number; attackers: number; csBlock: number }>();
  for (const p of roster) {
    const entry = clubMap.get(p.team) ?? { count: 0, attackers: 0, csBlock: 0 };
    entry.count += 1;
    if (p.position === 'MD' || p.position === 'FW') entry.attackers += 1;
    if (p.position === 'G' || p.position === 'D') entry.csBlock += 1;
    clubMap.set(p.team, entry);
  }
  const clubChips = [...clubMap.entries()]
    .filter(([, e]) => e.count >= 2)
    .map(([club, e]) => ({
      club,
      count: e.count,
      attackers: e.attackers,
      csBlock: e.csBlock >= 2, // G+D from one club: clean-sheet points move together
    }))
    .sort((a, b) => b.count - a.count);

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
      if (
        (player.position === 'G' || player.position === 'D') &&
        myClub.csBlock >= 1 &&
        myClub.csBlock + 1 >= 2
      ) {
        tags.push('CS corr'); // same-club GK/DEF clean sheets are the same event
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

  return { picksLeft: Math.max(0, ROSTER_SIZE - roster.length), shape, clubChips, queued, bpa, byPosition };
}
