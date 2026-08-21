import type { Position } from './types.js';

/**
 * A verified correction where Underdog eligibility differs from FPL's single
 * `element_type`. Keep this small and source every entry in `note` so the
 * FPL-derived position remains the visible default and every exception is
 * reviewable.
 */
export type PositionOverride = {
  fplId: string;
  overridePosition: Position;
  note: string;
};

export const POSITION_OVERRIDES: readonly PositionOverride[] = [
  {
    fplId: '12',
    overridePosition: 'FW',
    note: 'RotoWire Underdog EPL rankings list Bukayo Saka as F, 2026-08-19.',
  },
];

/** Applies a deliberate Underdog correction after FPL element_type is mapped. */
export function applyPositionOverride(fplId: string, fplPosition: Position): Position {
  return POSITION_OVERRIDES.find((override) => override.fplId === fplId)?.overridePosition ?? fplPosition;
}
