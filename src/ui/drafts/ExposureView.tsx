/**
 * Cross-room player exposure view (#72). It presents #71's pure aggregate
 * against the live local room set; browser storage remains owned by useRooms.
 */
import { useMemo, useState } from 'react';
import type { SnapshotPlayer } from '../types.js';
import { computeExposure } from './exposure.js';
import type { PlayerExposure } from './exposure.js';
import type { RoomRecord } from './types.js';

type Props = {
  players: SnapshotPlayer[];
  rooms: RoomRecord[];
};

type Sort = 'percent' | 'capital';
type CompetitionOption = { value: string | null; label: string };

const UNCATEGORIZED = '__uncategorized__';

const POSITION_BADGE: Record<SnapshotPlayer['position'], string> = {
  G: 'border border-pos-g/30 bg-pos-g/10 text-pos-g',
  D: 'border border-pos-d/30 bg-pos-d/10 text-pos-d',
  MD: 'border border-pos-md/30 bg-pos-md/10 text-pos-md',
  FW: 'border border-pos-fw/30 bg-pos-fw/10 text-pos-fw',
};

function competitionLabel(competition: string | null): string {
  return competition ?? 'Uncategorized';
}

/** Latest edited competition is the least surprising landing point after a draft. */
export function competitionsByRecency(rooms: RoomRecord[]): CompetitionOption[] {
  const latestByCompetition = new Map<string | null, string>();
  for (const room of rooms) {
    const latest = latestByCompetition.get(room.competition);
    if (!latest || room.updatedAt > latest) latestByCompetition.set(room.competition, room.updatedAt);
  }
  return [...latestByCompetition]
    .sort(([, a], [, b]) => b.localeCompare(a))
    .map(([value]) => ({ value, label: competitionLabel(value) }));
}

function selectValue(competition: string | null): string {
  return competition ?? UNCATEGORIZED;
}

function formatCapital(capital: number): string {
  return `$${capital.toFixed(2)}`;
}

type ExposureRow = PlayerExposure & { player: SnapshotPlayer };

export function ExposureView({ players, rooms }: Props) {
  const competitions = useMemo(() => competitionsByRecency(rooms), [rooms]);
  const [selectedValue, setSelectedValue] = useState(() => selectValue(competitions[0]?.value ?? null));
  const [sort, setSort] = useState<Sort>('percent');
  const selectedCompetition = selectedValue === UNCATEGORIZED ? null : selectedValue;
  const playerById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const exposure = useMemo(() => computeExposure(rooms), [rooms]);
  const rows = useMemo(() => {
    const selected = exposure
      .filter((entry) => entry.competition === selectedCompetition)
      .flatMap((entry): ExposureRow[] => {
        const player = playerById.get(entry.playerId);
        return player ? [{ ...entry, player }] : [];
      });
    return selected.sort((a, b) => {
      const primary = sort === 'percent' ? b.percent - a.percent : b.capital - a.capital;
      return primary || b.pickedRooms - a.pickedRooms || a.player.name.localeCompare(b.player.name);
    });
  }, [exposure, playerById, selectedCompetition, sort]);
  const totalRooms = rooms.filter((room) => room.competition === selectedCompetition).length;

  if (competitions.length === 0) {
    return (
      <main className="rounded-md border border-default bg-surface px-3 py-2">
        <h2 className="font-condensed text-lg font-semibold">Exposure by competition</h2>
        <p className="mt-1 text-sm text-secondary">
          No draft rooms yet. Add a completed room in Drafts to see player exposure and entry capital here.
        </p>
      </main>
    );
  }

  return (
    <section className="rounded-md border border-default bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Portfolio</p>
          <h2 className="font-condensed text-lg font-semibold">Exposure by competition</h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted" htmlFor="exposure-competition">
            Competition
          </label>
          <select
            id="exposure-competition"
            value={selectedValue}
            onChange={(event) => setSelectedValue(event.target.value)}
            className="rounded border border-default bg-surface-raised px-2 py-1 text-sm text-primary focus:border-strong focus:outline-none"
          >
            {competitions.map((competition) => (
              <option key={selectValue(competition.value)} value={selectValue(competition.value)}>
                {competition.label}
              </option>
            ))}
          </select>
          <label className="text-xs text-muted" htmlFor="exposure-sort">
            Sort
          </label>
          <select
            id="exposure-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="rounded border border-default bg-surface-raised px-2 py-1 text-sm text-primary focus:border-strong focus:outline-none"
          >
            <option value="percent">Exposure</option>
            <option value="capital">Capital</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Player exposure for {competitionLabel(selectedCompetition)}</caption>
          <thead className="border-b border-default bg-surface-raised text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-2 py-1">Player</th>
              <th className="px-2 py-1 text-right">Drafts</th>
              <th className="px-2 py-1 text-right">Exposure</th>
              <th className="px-2 py-1 text-right">Capital</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, pickedRooms, percent, capital }) => (
              <tr key={player.id} className="border-b border-default last:border-b-0 hover:bg-surface-hover">
                <td className="px-2 py-1 font-medium text-primary">
                  {player.name}{' '}
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${POSITION_BADGE[player.position]}`}>
                    {player.position}
                  </span>
                  <span className="ml-1 text-xs text-muted">{player.team}</span>
                </td>
                <td className="px-2 py-1 text-right font-condensed tabular-nums text-secondary">
                  {pickedRooms}/{totalRooms}
                </td>
                <td className="px-2 py-1 text-right font-condensed tabular-nums text-secondary">{(percent * 100).toFixed(1)}%</td>
                <td className="px-2 py-1 text-right font-condensed tabular-nums text-secondary">{formatCapital(capital)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p className="px-3 py-2 text-sm text-secondary">
          No matched picks for this competition yet. Select your team in each Drafts room to include it.
        </p>
      )}
    </section>
  );
}
