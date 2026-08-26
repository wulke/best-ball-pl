/**
 * The window-projected player pool for one contest profile, with its optional
 * odds/lineup companions (#45). One instance per profile: the sheet, the
 * drafts intake, the room review, and the carry pin each compute their pool
 * from the profile they are actually under — never from whatever profile
 * happens to be active elsewhere in the UI. The sheet's pool and a daily
 * room's review pool can therefore coexist even when the active profile
 * differs from the room's own (a Free Kick room opened while False Nine is
 * active still reviews against window-projected slate numbers).
 */
import { useEffect, useMemo, useState } from 'react';
import type { OddsSlate } from '../etl/odds.js';
import type { LineupSlate } from '../model/lineups.js';
import type { ContestProfile } from '../contest/profiles.js';
import { poolForProfile } from './windowProjections.js';
import { loadStartOverrides } from './startOverrides.js';
import type { Snapshot, SnapshotPlayer } from './types.js';

export function useProfilePool(
  snapshot: Snapshot | null,
  profile: ContestProfile,
): { pool: SnapshotPlayer[]; odds?: OddsSlate; lineups?: LineupSlate } {
  const [odds, setOdds] = useState<OddsSlate | undefined>(undefined);
  const [lineups, setLineups] = useState<LineupSlate | undefined>(undefined);

  // Daily odds and lineups are optional static companion assets. Missing,
  // stale, or malformed coverage never blocks the pool: the projection layer
  // uses model-only terms for those fixtures/players (the sheet behaves the
  // same way). Season profiles have no per-contest assets at all.
  useEffect(() => {
    if (!snapshot || profile.kind !== 'daily') {
      setOdds(undefined);
      setLineups(undefined);
      return;
    }
    let cancelled = false;
    fetch(`data/odds/${profile.id}.json`)
      .then((res) => (res.ok ? res.json() as Promise<OddsSlate> : undefined))
      .then((asset) => { if (!cancelled) setOdds(asset); })
      .catch(() => { if (!cancelled) setOdds(undefined); });
    fetch(`data/lineups/${profile.id}.json`)
      .then((res) => (res.ok ? res.json() as Promise<LineupSlate> : undefined))
      .then((asset) => { if (!cancelled) setLineups(asset); })
      .catch(() => { if (!cancelled) setLineups(undefined); });
    return () => { cancelled = true; };
  }, [snapshot, profile]);

  const startOverrides = useMemo(() => loadStartOverrides(profile.id), [profile]);

  const pool = useMemo(
    () => (snapshot ? poolForProfile(snapshot, profile, odds, lineups, startOverrides) : []),
    [snapshot, profile, odds, lineups, startOverrides],
  );

  return { pool, odds, lineups };
}
