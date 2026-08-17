/**
 * UI-side snapshot types re-exported from the canonical ETL contract —
 * one source of truth for the snapshot schema lives in src/etl/types.ts.
 */
export type {
  Position,
  PlayerStatus,
  SeasonStatLine,
  Snapshot,
  SnapshotPlayer,
  SnapshotFixture,
  SnapshotMeta,
} from '../etl/types.js';
export type { PlayerProjection, ProjectedStatline, ProjectionScenario } from '../model/types.js';
