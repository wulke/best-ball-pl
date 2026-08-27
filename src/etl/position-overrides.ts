import type { Position } from './types.js';

/**
 * A verified correction where Underdog eligibility differs from FPL's single
 * `element_type`. Keep this small and source every entry in `note` so the
 * FPL-derived position remains the visible default and every exception is
 * reviewable.
 *
 * Maintainer workflow (#132): `npm run positions:audit` re-parses every
 * committed draft capture (data/drafts/), joins each pick to the snapshot,
 * and prints override-ready entries for this table — trusted only where the
 * recap's club line agrees with the snapshot club (the join's second
 * verification). Paste the printed entries here, run `npm run etl`, commit
 * the refreshed snapshot, PR. Entries whose tags conflict across captures or
 * whose club disagrees are quarantined by the audit for eyes-on confirmation
 * in the Underdog app.
 */
export type PositionOverride = {
  fplId: string;
  overridePosition: Position;
  note: string;
};

export const POSITION_OVERRIDES: readonly PositionOverride[] = [
  {
    fplId: '431',
    overridePosition: 'FW',
    note: 'Amad (MUN): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Amad
  },
  {
    fplId: '338',
    overridePosition: 'D',
    note: 'Ampadu (LEE): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Ampadu
  },
  {
    fplId: '453',
    overridePosition: 'FW',
    note: 'Barnes (NEW): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Barnes
  },
  {
    fplId: '286',
    overridePosition: 'FW',
    note: 'Belloumi (HUL): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Belloumi
  },
  {
    fplId: '428',
    overridePosition: 'FW',
    note: 'Cunha (MUN): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Cunha
  },
  {
    fplId: '96',
    overridePosition: 'FW',
    note: 'Damsgaard (BRE): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Damsgaard
  },
  {
    fplId: '400',
    overridePosition: 'FW',
    note: 'Doku (MCI): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Doku
  },
  {
    fplId: '415',
    overridePosition: 'D',
    note: 'Dorgu (MUN): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Dorgu
  },
  {
    fplId: '454',
    overridePosition: 'FW',
    note: 'Elanga (NEW): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Elanga
  },
  {
    fplId: '157',
    overridePosition: 'FW',
    note: 'Estêvão (CHE): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Estêvão
  },
  {
    fplId: '367',
    overridePosition: 'FW',
    note: 'Gakpo (LIV): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Gakpo
  },
  {
    fplId: '482',
    overridePosition: 'FW',
    note: 'Hudson-Odoi (NFO): Underdog draft recaps 2026-08-19 (2 picks) — FPL MD.', // Hudson-Odoi
  },
  {
    fplId: '261',
    overridePosition: 'FW',
    note: 'Iwobi (FUL): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Iwobi
  },
  {
    fplId: '263',
    overridePosition: 'FW',
    note: 'Kevin (FUL): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Kevin
  },
  {
    fplId: '268',
    overridePosition: 'D',
    note: 'King (FUL): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // King
  },
  {
    fplId: '78',
    overridePosition: 'FW',
    note: 'Kroupi.Jr (BOU): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Kroupi.Jr
  },
  {
    fplId: '186',
    overridePosition: 'FW',
    note: 'Mason-Clark (COV): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Mason-Clark
  },
  {
    fplId: '389',
    overridePosition: 'MD',
    note: 'Matheus N. (MCI): Underdog draft recaps 2026-08-18 (1 pick) — FPL D.', // Matheus N.
  },
  {
    fplId: '427',
    overridePosition: 'FW',
    note: 'Mbeumo (MUN): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Mbeumo
  },
  {
    fplId: '122',
    overridePosition: 'FW',
    note: 'Minteh (BHA): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Minteh
  },
  {
    fplId: '237',
    overridePosition: 'FW',
    note: 'Ndiaye (EVE): Underdog draft recaps 2026-08-18..08-21 (5 picks) — FPL MD.', // Ndiaye
  },
  {
    fplId: '483',
    overridePosition: 'FW',
    note: 'Ndoye (NFO): Underdog draft recaps 2026-08-21 (2 picks) — FPL MD.', // Ndoye
  },
  {
    fplId: '156',
    overridePosition: 'FW',
    note: 'Neto (CHE): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Neto
  },
  {
    fplId: '95',
    overridePosition: 'FW',
    note: 'O.Dango (BRE): Underdog draft recaps 2026-08-18..08-21 (5 picks) — FPL MD.', // O.Dango
  },
  {
    fplId: '336',
    overridePosition: 'FW',
    note: 'Okafor (LEE): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Okafor
  },
  {
    fplId: '429',
    overridePosition: 'FW',
    note: 'Rashford (MUN): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Rashford
  },
  {
    fplId: '67',
    overridePosition: 'FW',
    note: 'Rayan (BOU): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Rayan
  },
  {
    fplId: '12',
    overridePosition: 'FW',
    note: 'Saka (ARS): RotoWire Underdog EPL rankings list him F, 2026-08-19; recap capture 2026-08-18 agrees.', // Saka
  },
  {
    fplId: '208',
    overridePosition: 'FW',
    note: 'Sarr (CRY): Underdog draft recaps 2026-08-18..08-21 (5 picks) — FPL MD.', // Sarr
  },
  {
    fplId: '94',
    overridePosition: 'FW',
    note: 'Schade (BRE): Underdog draft recaps 2026-08-18..08-19 (3 picks) — FPL MD.', // Schade
  },
  {
    fplId: '514',
    overridePosition: 'FW',
    note: 'Tel (TOT): Underdog draft recaps 2026-08-18..08-21 (5 picks) — FPL MD.', // Tel
  },
  {
    fplId: '557',
    overridePosition: 'FW',
    note: 'Tzolis (ARS): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Tzolis
  },
  {
    fplId: '260',
    overridePosition: 'FW',
    note: 'Wilson (LEE): Underdog draft recaps 2026-08-18..08-21 (5 picks) — FPL MD.', // Wilson
  },
  {
    fplId: '211',
    overridePosition: 'FW',
    note: 'Yeremy (CRY): Underdog draft recaps 2026-08-18 (1 pick) — FPL MD.', // Yeremy
  },
];

/** Applies a deliberate Underdog correction after FPL element_type is mapped. */
export function applyPositionOverride(fplId: string, fplPosition: Position): Position {
  return POSITION_OVERRIDES.find((override) => override.fplId === fplId)?.overridePosition ?? fplPosition;
}
