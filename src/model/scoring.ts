/**
 * The False Nine scorer — a pure function from a stat line to points.
 * This is the substrate every projection flows through (research:
 * historical-baseline-modeling.md): swap the stat-line generator, never the
 * scoring math.
 */

import type { ScoringConfig } from './config.js';
import type { Position } from '../etl/types.js';
import type { ProjectedStatline } from './types.js';

export function scoreStatline(
  statline: ProjectedStatline,
  position: Position,
  scoring: ScoringConfig,
): number {
  // Outfield volume terms — universal.
  let pts =
    statline.goals * scoring.goal +
    statline.assists * scoring.assist +
    statline.shotsOnTarget * scoring.shotOnTarget +
    statline.chancesCreated * scoring.chanceCreated +
    statline.crosses * scoring.cross +
    statline.tackles * scoring.tackle +
    statline.passes * scoring.pass;

  // Off-target shots: derived upstream (blocked excluded unless configured).
  pts += statline.shotsOffTarget * scoring.shotOffTarget;

  // Clean sheet / goals conceded: GK + D only.
  if (position === 'G' || position === 'D') {
    pts += statline.cleanSheets * scoring.cleanSheet;
    pts += statline.goalsConceded * scoring.goalConceded;
  }

  // Keeper-only terms.
  if (position === 'G') {
    pts += statline.gkWins * scoring.gkWin;
    pts += statline.saves * scoring.save;
    pts += statline.penaltiesSaved * scoring.penaltySave;
  }

  return Math.round(pts * 10) / 10;
}
