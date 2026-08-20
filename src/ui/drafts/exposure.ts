/**
 * Player exposure math (#71): pure aggregation over the live room records
 * supplied by `useRooms()`. It deliberately does not read the committed
 * draft archive or browser storage itself.
 */
import type { RoomRecord } from './types.js';

/** One player's exposure within one editable competition grouping. */
export type PlayerExposure = {
  playerId: string;
  competition: string | null;
  /** Rooms in this competition where the player is on my team. */
  pickedRooms: number;
  /** All locally logged rooms in this competition. */
  totalRooms: number;
  /** `pickedRooms / totalRooms`, expressed as a 0–1 share. */
  percent: number;
  /** Sum of the known entry costs for the player's selected rooms. */
  capital: number;
};

type ExposureTotals = { pickedRooms: number; capital: number };

/**
 * Compute exposure from live local room records. A player's repeated picks in
 * one room count once, and unmatched picks remain outside the calculation,
 * consistent with the draft review's carry-forward treatment.
 */
export function computeExposure(rooms: RoomRecord[]): PlayerExposure[] {
  const totalsByCompetition = new Map<string | null, number>();
  const exposureByCompetition = new Map<string | null, Map<string, ExposureTotals>>();

  for (const room of rooms) {
    const competition = room.competition;
    totalsByCompetition.set(competition, (totalsByCompetition.get(competition) ?? 0) + 1);

    if (!room.myTeam) continue;
    const playerIds = new Set(
      room.picks
        .flatMap((pick) =>
          pick.team === room.myTeam && !pick.unmatched && pick.playerId !== null ? [pick.playerId] : [],
        ),
    );
    if (playerIds.size === 0) continue;

    let totalsByPlayer = exposureByCompetition.get(competition);
    if (!totalsByPlayer) {
      totalsByPlayer = new Map();
      exposureByCompetition.set(competition, totalsByPlayer);
    }

    for (const playerId of playerIds) {
      const totals = totalsByPlayer.get(playerId) ?? { pickedRooms: 0, capital: 0 };
      totals.pickedRooms += 1;
      totals.capital += room.entryCost ?? 0;
      totalsByPlayer.set(playerId, totals);
    }
  }

  return [...exposureByCompetition].flatMap(([competition, totalsByPlayer]) => {
    const totalRooms = totalsByCompetition.get(competition)!;
    return [...totalsByPlayer].map(([playerId, totals]) => ({
      playerId,
      competition,
      totalRooms,
      pickedRooms: totals.pickedRooms,
      percent: totals.pickedRooms / totalRooms,
      capital: totals.capital,
    }));
  });
}
