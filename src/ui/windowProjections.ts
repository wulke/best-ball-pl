/**
 * Client-side pool projections for the active contest profile (#47 v0 of the
 * profile switcher, generalized by #44). The committed snapshot's
 * `player.projection` is always the False Nine season numbers — recomputing
 * client-side for any other profile keeps that snapshot untouched (same
 * contract as `npm run model -- --profile <id>`'s "window report only" path)
 * while giving the sheet a pool-scoped, window-projected board to rank.
 *
 * False Nine itself never recomputes here: it reads the committed
 * projections directly, so the flagship pre-draft experience stays exactly
 * what's shipped in data/snapshot.json (byte-identical, per profiles.test.ts).
 */
import {
  FALSE_NINE,
  modelConfigFor,
  replacementConfigFor,
  resolveContest,
  type ContestProfile,
} from '../contest/profiles.js';
import { buildProjections } from '../model/project.js';
import type { Snapshot, SnapshotPlayer } from './types.js';

/** The player pool for a profile: window-projected and pool-restricted (players
 *  outside the contest sit at rank 0 from `buildProjections` and are dropped). */
export function poolForProfile(snapshot: Snapshot, profile: ContestProfile): SnapshotPlayer[] {
  if (profile.id === FALSE_NINE.id) {
    return snapshot.players.filter((p) => p.projection);
  }
  const contest = resolveContest(profile, snapshot.fixtures);
  const { projections } = buildProjections(
    snapshot.players,
    modelConfigFor(profile),
    contest,
    replacementConfigFor(profile),
  );
  return snapshot.players
    .map((p, i) => ({ ...p, projection: projections[i] }))
    .filter((p) => p.projection && p.projection.overallRank > 0);
}
