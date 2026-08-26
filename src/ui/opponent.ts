/**
 * Opponent-club resolution for the correlation badges (#119): the club a
 * player's club faces in a fixture window. `SnapshotFixture` is symmetric
 * (`{home, away}`, no player-relative pointer), so callers used to inline
 * `fixtures.find(f => f.home === player.team || f.away === player.team)` and
 * pick the other side (see `StartCell` in `PlayerTable.tsx`). This is the
 * shared resolution instead — groundwork the opponent-attacker anti-stack
 * badge (#120) resolves which players to flag against.
 *
 * Returns `null` when the player's club has no fixture in the window (a
 * multi-club window's off-slate clubs): there is no opponent to resolve.
 */
import type { SnapshotFixture } from '../etl/types.js';
import type { SnapshotPlayer } from './types.js';

export function getOpponentClub(
  player: Pick<SnapshotPlayer, 'team'>,
  fixtures: SnapshotFixture[],
): string | null {
  const fixture = fixtures.find((f) => f.home === player.team || f.away === player.team);
  if (!fixture) return null;
  return fixture.home === player.team ? fixture.away : fixture.home;
}
