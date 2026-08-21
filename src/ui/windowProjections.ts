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
import { aggregateSeasonActuals } from '../model/actuals.js';
import type { OddsSlate } from '../etl/odds.js';
import type { Snapshot, SnapshotPlayer } from './types.js';

/** A committed placeholder is not a slate pull: it must leave the sheet
 * identical to the model-only view until an actual odds asset arrives. */
export function hasOddsCoverage(odds: OddsSlate | undefined): odds is OddsSlate & { fetchedAt: string } {
  return odds?.fetchedAt != null && odds.fixtures.length > 0;
}

/** The player pool for a profile: window-projected and pool-restricted (players
 *  outside the contest sit at rank 0 from `buildProjections` and are dropped). */
export function poolForProfile(snapshot: Snapshot, profile: ContestProfile, odds?: OddsSlate): SnapshotPlayer[] {
  if (profile.id === FALSE_NINE.id) {
    return snapshot.players.filter((p) => p.projection);
  }
  const contest = resolveContest(profile, snapshot.fixtures);
  const { projections } = buildProjections(
    snapshot.players,
    modelConfigFor(profile),
    contest,
    replacementConfigFor(profile),
    hasOddsCoverage(odds) ? odds : undefined,
    aggregateSeasonActuals(
      snapshot.players,
      snapshot.fixtures,
      snapshot.actuals,
      modelConfigFor(profile).actuals.startMinutesThreshold,
    ) ?? undefined,
  );
  return snapshot.players
    .map((p, i) => ({ ...p, projection: projections[i] }))
    .filter((p) => p.projection && p.projection.overallRank > 0);
}
