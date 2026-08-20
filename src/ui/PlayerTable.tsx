import { useState } from 'react';
import type { PlayerStatus, SnapshotPlayer } from './types.js';
import { Tooltip } from './Tooltip.js';
import { PlayerBreakdownModal } from './PlayerBreakdownModal.js';

/**
 * The ranked tier table — the cheat sheet itself.
 *
 * Settled at execution (ticket #9):
 * - Tier bands render as full-width labeled divider rows when a single position
 *   is selected (natural-break tiers are contiguous there); in the overall view
 *   tiers interleave across positions, so tier renders as a compact per-row column.
 * - Columns that earn space: pick toggle, rank, player (+availability/confidence
 *   flags), position, team, price, projected p50 points, tier, per-90, ceiling
 *   per-90 (best-ball spike proxy), value (pts per £M). Minutes etc. stay in the
 *   model report — second-order on draft day.
 */

const STATUS_LABELS: Record<Exclude<PlayerStatus, 'a'>, string> = {
  d: 'Doubtful',
  i: 'Injured',
  s: 'Suspended',
  u: 'Unavailable',
  n: 'Not with squad',
};

const POS_BADGE: Record<string, string> = {
  G: 'border-pos-g/30 bg-pos-g/10 text-pos-g',
  D: 'border-pos-d/30 bg-pos-d/10 text-pos-d',
  MD: 'border-pos-md/30 bg-pos-md/10 text-pos-md',
  FW: 'border-pos-fw/30 bg-pos-fw/10 text-pos-fw',
};

/** How the "ALL" view ranks/sorts cross-position. Within one position, points
 *  and VORP order agree (draftValue is tournamentScore minus a per-position
 *  constant) — this only changes the overall, cross-position ordering. */
export type RankMode = 'points' | 'vorp';

type Row = {
  player: SnapshotPlayer;
  /** Rank shown: posRank in a position view, overall rank (by rankMode) otherwise. */
  rank: number;
};

type Props = {
  players: SnapshotPlayer[];
  drafted: ReadonlySet<string>;
  onToggleDrafted: (id: string) => void;
  /** My roster this draft (live session). */
  mine: ReadonlySet<string>;
  /** Draft by me: marks mine AND off-board in one click. */
  onDraftMine: (id: string) => void;
  /** My target queue (live session). */
  queued: ReadonlySet<string>;
  onToggleQueued: (id: string) => void;
  /** true when a single position is filtered → contiguous tier band rows. */
  groupByTier: boolean;
  /** Cross-position rank/sort basis for the ALL view — raw points or VORP. */
  rankMode: RankMode;
};

const TH_BASE =
  'font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted px-1 py-1 whitespace-nowrap';
const TD_NUM =
  'font-condensed tabular-nums text-sm px-1 py-1 text-right whitespace-nowrap';

export function PlayerTable({
  players,
  drafted,
  onToggleDrafted,
  mine,
  onDraftMine,
  queued,
  onToggleQueued,
  groupByTier,
  rankMode,
}: Props) {
  const [breakdownPlayer, setBreakdownPlayer] = useState<SnapshotPlayer | null>(null);
  const rows: Row[] = players.map((player) => ({
    player,
    rank: groupByTier
      ? (player.projection?.posRank ?? 0)
      : rankMode === 'vorp'
        ? (player.projection?.overallRankByValue ?? 0)
        : (player.projection?.overallRank ?? 0),
  }));

  // Interleave tier band rows when grouping (tiers are contiguous in rank order).
  const body: React.ReactNode[] = [];
  let currentTier = -1;
  let tierStart = 0;

  const pushBand = (tier: number, from: number, toExclusive: number) => {
    const group = rows.slice(from, toExclusive);
    const hi = group[0].player.projection?.tournamentScore ?? 0;
    const lo = group[group.length - 1].player.projection?.tournamentScore ?? 0;
    body.push(
      <tr key={`band-${tier}`} className="border-y border-default bg-surface-raised print:static">
        <td colSpan={groupByTier ? 14 : 15} className="px-2 py-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-accent">
              Tier {tier}
            </span>
            <span className="text-[0.65rem] tabular-nums text-muted">
              {group.length} players · {hi.toFixed(1)}–{lo.toFixed(1)} pts
            </span>
          </div>
        </td>
      </tr>,
    );
  };

  rows.forEach((row, index) => {
    const tier = row.player.projection?.tier ?? 0;
    if (groupByTier && tier !== currentTier) {
      if (currentTier !== -1) pushBand(currentTier, tierStart, index);
      currentTier = tier;
      tierStart = index;
    }
    body.push(
      <PlayerRow
        key={row.player.id}
        row={row}
        showTierColumn={!groupByTier}
        isDrafted={drafted.has(row.player.id)}
        onToggleDrafted={onToggleDrafted}
        isMine={mine.has(row.player.id)}
        onDraftMine={onDraftMine}
        isQueued={queued.has(row.player.id)}
        onToggleQueued={onToggleQueued}
        onShowBreakdown={setBreakdownPlayer}
      />,
    );
  });
  if (groupByTier && currentTier !== -1) pushBand(currentTier, tierStart, rows.length);

  return (
    <div className="rounded-md border border-default bg-surface">
      {/* No overflow wrapper: an overflow container becomes the sticky
          thead's scroll ancestor and breaks vertical sticking (the header
          rendered over the first rows). The page is the scroller; on narrow
          viewports the table overflows to a body-level horizontal scrollbar. */}
      <table className="player-table w-full min-w-max border-collapse">
        <thead className="sticky top-11 z-10 bg-surface print:static">
          <tr className="border-b border-strong">
            <th className={`${TH_BASE} w-6`}>
              <Tooltip text="Off board — drafted by anyone in the room (not just you)" wide>
                <span>✓</span>
              </Tooltip>
            </th>
            <th className={`${TH_BASE} w-6`}>
              <Tooltip text="My pick — I drafted this player (marks off-board too)" wide>
                <span>M</span>
              </Tooltip>
            </th>
            <th className={`${TH_BASE} w-6`}>
              <Tooltip text="Queue / watch — my target pool, persists across drafts" wide>
                <span>★</span>
              </Tooltip>
            </th>
            <th className={`${TH_BASE} w-6`}>
              <Tooltip text="Scoring breakdown — how the projection is built" wide>
                <span>i</span>
              </Tooltip>
            </th>
            <th
              className={`${TH_BASE} w-8 text-right`}
              title={
                groupByTier
                  ? 'Rank within position by tournament-adjusted score (ceiling-weighted toward p90, dampened for durability risk)'
                  : rankMode === 'vorp'
                    ? 'Overall rank by draft value (VORP) — points above the last player at that position a full league would still start'
                    : 'Overall rank by tournament-adjusted score (ceiling-weighted toward p90, dampened for durability risk)'
              }
            >
              #
            </th>
            <th className={`${TH_BASE} text-left`}>Player</th>
            <th className={`${TH_BASE} w-11 px-1`}>Pos</th>
            <th className={`${TH_BASE} w-10 text-right`}>Team</th>
            <th className={`${TH_BASE} w-10 text-right`} title="FPL 2026/27 price (£M)">
              £
            </th>
            <th
              className={`${TH_BASE} w-14 text-right`}
              title="Projected season points (p50 scenario) — raw, unadjusted"
            >
              Pts
            </th>
            {!groupByTier && (
              <th
                className={`${TH_BASE} w-8 text-right`}
                title="Tier within position (natural breaks in tournament-adjusted score)"
              >
                T
              </th>
            )}
            <th className={`${TH_BASE} w-12 text-right`} title="Points per 90 (p50)">
              /90
            </th>
            <th
              className={`${TH_BASE} w-12 text-right`}
              title="Ceiling: p90 points per 90 — best-ball spike proxy"
            >
              Ceil
            </th>
            <th
              className={`${TH_BASE} w-10 text-right`}
              title="Tournament-adjusted score per £M — ceiling-weighted toward p90, dampened for durability risk; raw Pts is the unadjusted figure"
            >
              Val
            </th>
            <th
              className={`${TH_BASE} w-12 text-right`}
              title="Draft value (VORP): tournament-adjusted score minus the score of the last player at this position a full league would still start — how much this player beats his position's replacement level, not just raw points"
            >
              VORP
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={groupByTier ? 14 : 15} className="px-2 py-6 text-center text-sm text-muted">
                No players match the current filters.
              </td>
            </tr>
          )}
          {body}
        </tbody>
      </table>
      {breakdownPlayer?.projection && (
        <PlayerBreakdownModal
          name={breakdownPlayer.name}
          position={breakdownPlayer.position}
          team={breakdownPlayer.team}
          projection={breakdownPlayer.projection}
          onClose={() => setBreakdownPlayer(null)}
        />
      )}
    </div>
  );
}

function PlayerRow({
  row,
  showTierColumn,
  isDrafted,
  onToggleDrafted,
  isMine,
  onDraftMine,
  isQueued,
  onToggleQueued,
  onShowBreakdown,
}: {
  row: Row;
  showTierColumn: boolean;
  isDrafted: boolean;
  onToggleDrafted: (id: string) => void;
  isMine: boolean;
  onDraftMine: (id: string) => void;
  isQueued: boolean;
  onToggleQueued: (id: string) => void;
  onShowBreakdown: (player: SnapshotPlayer) => void;
}) {
  const { player } = row;
  const projection = player.projection!; // upstream filters projection-less players
  const statusLabel =
    player.status !== 'a' ? STATUS_LABELS[player.status] ?? player.status : null;

  return (
    <tr
      className={`group border-b border-default transition-colors last:border-b-0 hover:bg-surface-hover ${
        isDrafted ? 'opacity-60' : ''
      }`}
    >
      <td className="w-6 px-1 py-1">
        <Tooltip
          text={
            isDrafted
              ? 'Off board — anyone in the room drafted them (click to undo)'
              : 'Mark off board — anyone in the room drafted them'
          }
          wide
        >
          <button
            type="button"
            aria-pressed={isDrafted}
            onClick={() => onToggleDrafted(player.id)}
            className={`flex h-4 w-4 items-center justify-center rounded border transition-colors focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              isDrafted
                ? 'border-strong bg-surface-hover text-primary'
                : 'border-strong opacity-0 hover:border-accent group-hover:opacity-100'
            }`}
          >
            {isDrafted && <span className="text-[10px] font-bold leading-none">✓</span>}
          </button>
        </Tooltip>
      </td>
      <td className="w-6 px-1 py-1">
        <Tooltip
          text={isMine ? 'My pick (click to undo)' : 'MY PICK — I drafted this player; marks off-board too'}
          wide
        >
          <button
            type="button"
            aria-pressed={isMine}
            onClick={() => onDraftMine(player.id)}
            className={`flex h-4 w-4 items-center justify-center rounded border text-[9px] font-bold leading-none transition-colors focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              isMine
                ? 'border-accent bg-accent text-accent-fg opacity-100'
                : 'border-accent/60 text-accent opacity-0 hover:bg-accent/10 group-hover:opacity-100'
            }`}
          >
            M
          </button>
        </Tooltip>
      </td>
      <td className="w-6 px-1 py-1">
        <Tooltip
          text={isQueued ? 'Queued — remove from my target pool' : 'Queue as a target (watch list)'}
          wide
        >
          <button
            type="button"
            aria-pressed={isQueued}
            onClick={() => onToggleQueued(player.id)}
            className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none transition-colors focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              isQueued
                ? 'border-accent bg-accent/10 text-accent opacity-100'
                : 'border-strong text-muted opacity-0 hover:border-accent hover:text-accent group-hover:opacity-100'
            }`}
          >
            ★
          </button>
        </Tooltip>
      </td>
      <td className="w-6 px-1 py-1">
        <Tooltip text="Scoring breakdown — how the projection is built" wide>
          <button
            type="button"
            onClick={() => onShowBreakdown(player)}
            className="flex h-4 w-4 items-center justify-center rounded border border-strong text-[10px] font-semibold italic leading-none text-muted opacity-0 transition-colors hover:border-accent hover:text-accent focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent group-hover:opacity-100"
          >
            i
          </button>
        </Tooltip>
      </td>
      <td className={`${TD_NUM} w-8 text-muted`}>{row.rank}</td>
      <td className="px-1 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`truncate text-sm font-medium ${
              isMine ? 'text-accent' : isDrafted ? 'text-muted line-through' : 'text-primary'
            }`}
            title={player.fullName}
          >
            {player.name}
          </span>
          {statusLabel && (
            <Tooltip text={`${statusLabel}${player.news ? ` — ${player.news}` : ''}`} wide>
              <span className="rounded border border-negative/30 bg-negative/10 px-1 py-0.5 text-[0.65rem] font-semibold leading-none text-negative">
                !
              </span>
            </Tooltip>
          )}
          {projection.confidence === 'medium' && (
            <Tooltip text="Projection confidence: medium history depth" wide>
              <span className="rounded border border-info/30 bg-info/10 px-1 py-0.5 text-[0.65rem] font-semibold leading-none text-info">
                ±
              </span>
            </Tooltip>
          )}
          {projection.confidence === 'low' && (
            <Tooltip text="Projection confidence: thin history — elevated uncertainty" wide>
              <span className="rounded border border-negative/30 bg-negative/10 px-1 py-0.5 text-[0.65rem] font-semibold leading-none text-negative">
                ?
              </span>
            </Tooltip>
          )}
          {projection.durabilityRisk && (
            <Tooltip
              text="Durability risk: thin projected minutes/start rate for the 26-week Round 1 grind — ceiling boost dampened"
              wide
            >
              <span className="rounded border border-info/30 bg-info/10 px-1 py-0.5 text-[0.65rem] font-semibold leading-none text-info">
                R
              </span>
            </Tooltip>
          )}
        </div>
      </td>
      <td className="px-1 py-1">
        <span
          className={`inline-block rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase leading-none tracking-wide ${POS_BADGE[player.position]}`}
        >
          {player.position}
        </span>
      </td>
      <td className="px-1 py-1 text-right text-xs font-medium tabular-nums text-secondary">
        {player.team}
      </td>
      <td className={`${TD_NUM} text-secondary`}>{player.price.toFixed(1)}</td>
      <td className={`${TD_NUM} font-bold text-primary`}>
        {projection.points.p50.toFixed(1)}
      </td>
      {showTierColumn && (
        <td className={`${TD_NUM} w-8 text-xs text-muted`}>T{projection.tier}</td>
      )}
      <td className={`${TD_NUM} text-secondary`}>{projection.per90.toFixed(1)}</td>
      <td className={`${TD_NUM} text-secondary`}>{projection.ceilingPer90.toFixed(1)}</td>
      <td className={`${TD_NUM} text-secondary`}>{projection.value.toFixed(1)}</td>
      <td className={`${TD_NUM} text-secondary`}>
        {projection.draftValue == null
          ? '—'
          : `${projection.draftValue > 0 ? '+' : ''}${projection.draftValue.toFixed(1)}`}
      </td>
    </tr>
  );
}
