/**
 * Positional-scarcity view (#dropoff): plots projected points by rank within
 * each position — the shape argument for how many of each position to draft
 * and how the FLEX slots (2 of 8 starters, any non-G) get filled. Live during
 * a draft: every position curve re-ranks against `drafted` (the same
 * off-board set the Sheet uses), so the ghost line shows the original board
 * and the solid line shows what's actually still available right now.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Position, SnapshotPlayer } from './types.js';

const POSITIONS: Position[] = ['D', 'G', 'MD', 'FW'];
const POS_LABEL: Record<Position, string> = { G: 'GK', D: 'DEF', MD: 'MID', FW: 'FWD' };
// Matches tailwind.config.ts positionColor() fixed hex — pos-g/d/md/fw.
const POS_HEX: Record<Position, string> = {
  G: '#fcd34d',
  D: '#60a5fa',
  MD: '#34d399',
  FW: '#a78bfa',
};
const POS_BADGE: Record<Position, string> = {
  G: 'border-pos-g/30 bg-pos-g/10 text-pos-g',
  D: 'border-pos-d/30 bg-pos-d/10 text-pos-d',
  MD: 'border-pos-md/30 bg-pos-md/10 text-pos-md',
  FW: 'border-pos-fw/30 bg-pos-fw/10 text-pos-fw',
};

const CAP = 80; // rank ceiling for chart rendering — past this, the tail never matters on draft day
const TEAMS_KEY = 'bbpl-scarcity-teams';

const W = 800;
const H = 340;
const MARGIN = { top: 16, right: 16, bottom: 30, left: 40 };
const PLOT_W = W - MARGIN.left - MARGIN.right;
const PLOT_H = H - MARGIN.top - MARGIN.bottom;

type Props = {
  players: SnapshotPlayer[];
  drafted: ReadonlySet<string>;
};

function loadTeams(): number {
  try {
    const raw = Number(localStorage.getItem(TEAMS_KEY));
    return raw >= 4 && raw <= 20 ? raw : 12;
  } catch {
    return 12;
  }
}

export function ScarcityView({ players, drafted }: Props) {
  const [teams, setTeams] = useState<number>(loadTeams);
  const [hoverRank, setHoverRank] = useState<number | null>(null);
  const [pinnedSeries, setPinnedSeries] = useState<'ghost' | 'live' | null>(null);
  const [hoverSeries, setHoverSeries] = useState<'ghost' | 'live' | null>(null);
  const activeSeries = hoverSeries ?? pinnedSeries;
  const [pinnedPosition, setPinnedPosition] = useState<Position | null>(null);
  const [hoverPosition, setHoverPosition] = useState<Position | null>(null);
  const activePosition = hoverPosition ?? pinnedPosition;

  useEffect(() => {
    try {
      localStorage.setItem(TEAMS_KEY, String(teams));
    } catch {
      // Storage unavailable — slider still works for this session.
    }
  }, [teams]);

  /** Full board per position, ranked by tournament score — the original draft order. */
  const byPos = useMemo(() => {
    const map = { G: [], D: [], MD: [], FW: [] } as Record<Position, SnapshotPlayer[]>;
    for (const p of players) {
      if (!p.projection) continue;
      map[p.position].push(p);
    }
    for (const pos of POSITIONS) {
      map[pos].sort((a, b) => b.projection!.tournamentScore - a.projection!.tournamentScore);
    }
    return map;
  }, [players]);

  /** Same lists with drafted players removed and re-ranked — what's live right now. */
  const livePos = useMemo(() => {
    const map = { G: [], D: [], MD: [], FW: [] } as Record<Position, SnapshotPlayer[]>;
    for (const pos of POSITIONS) map[pos] = byPos[pos].filter((p) => !drafted.has(p.id));
    return map;
  }, [byPos, drafted]);

  const yMax = useMemo(() => {
    const top = Math.max(...POSITIONS.map((pos) => byPos[pos][0]?.projection?.tournamentScore ?? 0));
    return Math.max(50, Math.ceil((top * 1.05) / 50) * 50);
  }, [byPos]);

  const xScale = (rank: number) => MARGIN.left + ((rank - 1) / (CAP - 1)) * PLOT_W;
  const yScale = (ts: number) => MARGIN.top + PLOT_H - (Math.min(ts, yMax) / yMax) * PLOT_H;

  const flexLo = 2 * teams + 1;
  const flexHi = Math.min(4 * teams, CAP);

  const flexAvg = useMemo(() => {
    const out = {} as Record<Position, number>;
    for (const pos of (['D', 'MD', 'FW'] as Position[])) {
      const slice = livePos[pos].slice(flexLo - 1, flexHi);
      out[pos] = slice.length ? slice.reduce((s, p) => s + p.projection!.tournamentScore, 0) / slice.length : 0;
    }
    return out;
  }, [livePos, flexLo, flexHi]);

  const maxFlexAvg = Math.max(flexAvg.D ?? 0, flexAvg.MD ?? 0, flexAvg.FW ?? 0, 1);

  /** How much value each position loses over its next few available players —
   *  the actionable "wait cost" signal: a steep drop means the position is
   *  about to get worse fast, a flat one means there's no rush. */
  const CLIFF_WINDOW = 3;
  const cliff = useMemo(() => {
    const out = {} as Record<
      Position,
      { now: number; soon: number; drop: number; dropPct: number; players: SnapshotPlayer[] }
    >;
    for (const pos of POSITIONS) {
      const slice = livePos[pos].slice(0, CLIFF_WINDOW);
      const now = slice[0]?.projection?.tournamentScore ?? 0;
      const soon = slice.length ? slice[slice.length - 1].projection!.tournamentScore : now;
      const drop = now - soon;
      out[pos] = { now, soon, drop, dropPct: now > 0 ? drop / now : 0, players: slice };
    }
    return out;
  }, [livePos]);
  const priority = useMemo(
    () => [...POSITIONS].sort((a, b) => cliff[b].dropPct - cliff[a].dropPct),
    [cliff],
  );

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width) * W;
    let rank = Math.round(1 + ((mx - MARGIN.left) / PLOT_W) * (CAP - 1));
    rank = Math.max(1, Math.min(CAP, rank));
    setHoverRank(rank);
  };

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {POSITIONS.map((pos) => {
          const total = byPos[pos].length;
          const gone = total - livePos[pos].length;
          const pct = total ? Math.round((gone / total) * 100) : 0;
          return (
            <div key={pos} className="rounded-md border border-default bg-surface px-3 py-2">
              <div className="flex items-center justify-between">
                <span
                  className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tabular-nums tracking-wide ${POS_BADGE[pos]}`}
                >
                  {POS_LABEL[pos]}
                </span>
                <span className="font-condensed text-xs font-semibold tabular-nums text-muted">
                  {gone}/{total} drafted
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${pct}%`, background: POS_HEX[pos] }}
                />
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
        <h2 className="mb-1 font-condensed text-sm font-semibold text-accent">Draft priority right now</h2>
        <p className="mb-2 text-xs text-secondary">
          Ranked by how much each position drops in value over its next {CLIFF_WINDOW} available players. A steep
          drop means the position gets meaningfully worse if someone else picks it before you — a flat one means
          there's no real cost to waiting a round. (This is about the position's own depth, not your roster — pair it
          with the Sheet's Live panel for what you actually need.)
        </p>
        <div className="flex flex-col gap-1.5">
          {priority.map((pos, i) => {
            const c = cliff[pos];
            const urgency = c.dropPct > 0.12 ? 'text-negative' : c.dropPct > 0.05 ? 'text-info' : 'text-muted';
            return (
              <div key={pos} className="flex items-center gap-2 rounded border border-default bg-surface px-2 py-1.5">
                <span className="w-4 font-condensed text-xs font-bold tabular-nums text-muted">{i + 1}</span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tabular-nums tracking-wide ${POS_BADGE[pos]}`}
                >
                  {POS_LABEL[pos]}
                </span>
                <span className="flex-1 truncate text-xs text-secondary">
                  {c.players[0] ? (
                    <>
                      {c.players[0].name} <span className="tabular-nums text-muted">({c.now.toFixed(0)})</span>
                      {c.players.length > 1 && (
                        <>
                          {' '}
                          → {c.players[c.players.length - 1].name}{' '}
                          <span className="tabular-nums text-muted">({c.soon.toFixed(0)})</span>
                        </>
                      )}
                    </>
                  ) : (
                    'none left'
                  )}
                </span>
                <span className={`font-condensed text-sm font-bold tabular-nums ${urgency}`}>
                  {c.drop > 0.5 ? `−${c.drop.toFixed(0)} pts` : 'flat'}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-md border border-default bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="scarcity-teams" className="text-xs font-semibold uppercase tracking-wide text-secondary">
              League size
            </label>
            <input
              id="scarcity-teams"
              type="range"
              min={8}
              max={16}
              step={1}
              value={teams}
              onChange={(e) => setTeams(Number(e.target.value))}
              className="w-32 accent-accent"
            />
            <span className="font-condensed text-sm font-bold tabular-nums">{teams} teams</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                type="button"
                onMouseEnter={() => setHoverPosition(pos)}
                onMouseLeave={() => setHoverPosition(null)}
                onClick={() => setPinnedPosition((prev) => (prev === pos ? null : pos))}
                className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-semibold transition ${
                  pinnedPosition === pos
                    ? 'bg-surface-hover text-primary'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                <span className="inline-block h-0.5 w-4 rounded" style={{ background: POS_HEX[pos] }} />
                {POS_LABEL[pos]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted">
          Set this to your real draft's team count. With {teams} teams, the shaded FLEX zone on the chart below moves
          to ranks {flexLo}–{flexHi} at DEF/MID/FWD: the top {2 * teams} at each position are assumed to fill
          everyone's 2 dedicated starter slots league-wide, so the next {2 * teams} are the pool your own 2 FLEX
          slots realistically get pulled from. A bigger league pushes both boundaries deeper into each position's
          board.
        </p>
      </section>

      <section className="rounded-md border border-default bg-surface px-3 py-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-condensed text-sm font-semibold">Points by position rank</h2>
          <div className="flex items-center gap-1 rounded border border-default p-0.5">
            {(
              [
                ['ghost', 'Original board'],
                ['live', 'Still available'],
              ] as ['ghost' | 'live', string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onMouseEnter={() => setHoverSeries(key)}
                onMouseLeave={() => setHoverSeries(null)}
                onClick={() => setPinnedSeries((prev) => (prev === key ? null : key))}
                className={`rounded px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide transition ${
                  pinnedSeries === key
                    ? 'bg-accent text-accent-fg'
                    : 'text-muted hover:text-secondary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-1 text-xs text-muted">
          Faint line = original board · solid = still available · ○ = on the clock (best player left, at their spot
          on the original board) · shaded = FLEX zone (ranks {flexLo}–{flexHi}). Hover or click a legend above to
          isolate a series or a position.
        </p>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverRank(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = MARGIN.top + PLOT_H * (1 - f);
            return (
              <g key={f}>
                <line
                  x1={MARGIN.left}
                  x2={W - MARGIN.right}
                  y1={y}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                />
                <text x={MARGIN.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--color-text-muted)">
                  {Math.round(yMax * f)}
                </text>
              </g>
            );
          })}

          {flexLo <= CAP && (
            <rect
              x={xScale(Math.min(flexLo, CAP))}
              y={MARGIN.top}
              width={Math.max(0, xScale(flexHi) - xScale(Math.min(flexLo, CAP)))}
              height={PLOT_H}
              fill="var(--color-accent)"
              opacity={0.08}
            />
          )}
          {teams <= CAP && (
            <line
              x1={xScale(teams)}
              x2={xScale(teams)}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_H}
              stroke="var(--color-text-muted)"
              strokeWidth={1}
              strokeDasharray="2,3"
            />
          )}

          {(['ghost', 'live'] as ('ghost' | 'live')[])
            .flatMap((series) => POSITIONS.map((pos) => ({ series, pos })))
            // Draw whatever is isolated (by series and/or position) last, so it paints on top.
            .sort((a, b) => {
              const score = (x: { series: 'ghost' | 'live'; pos: Position }) =>
                (x.series === activeSeries ? 1 : 0) + (x.pos === activePosition ? 1 : 0);
              return score(a) - score(b);
            })
            .map(({ series, pos }) => {
              const rows = (series === 'ghost' ? byPos[pos] : livePos[pos]).slice(0, CAP);
              const d = rows
                .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i + 1)},${yScale(p.projection!.tournamentScore)}`)
                .join(' ');
              const seriesIsolated = activeSeries !== null;
              const seriesActive = series === activeSeries;
              const posIsolated = activePosition !== null;
              const posActive = pos === activePosition;

              let opacity = seriesIsolated ? (seriesActive ? 1 : 0.08) : series === 'ghost' ? 0.25 : 1;
              if (posIsolated) opacity *= posActive ? 1 : 0.06;

              const width = seriesIsolated ? (seriesActive ? 2.5 : 1) : series === 'ghost' ? 1.5 : 2;

              return (
                <path
                  key={`${series}-${pos}`}
                  d={d}
                  fill="none"
                  stroke={POS_HEX[pos]}
                  strokeWidth={posActive ? width + 0.5 : width}
                  opacity={opacity}
                />
              );
            })}

          {/* "On the clock" marker — the best still-available player at each position, plotted at
              their spot on the ORIGINAL curve, so it reads as how deep the draft has eaten into that
              position's board so far (not just a count). */}
          {POSITIONS.map((pos) => {
            const draftedCount = byPos[pos].length - livePos[pos].length;
            const frontierRank = draftedCount + 1;
            if (frontierRank > byPos[pos].length || frontierRank > CAP) return null;
            const player = byPos[pos][frontierRank - 1];
            const cx = xScale(frontierRank);
            const cy = yScale(player.projection!.tournamentScore);
            const posIsolated = activePosition !== null;
            const posActive = pos === activePosition;
            const opacity = posIsolated ? (posActive ? 1 : 0.12) : 1;
            const drop = cliff[pos].drop;
            return (
              <g key={`marker-${pos}`} opacity={opacity}>
                <circle cx={cx} cy={cy} r={posActive ? 7 : 5.5} fill="var(--color-surface)" stroke={POS_HEX[pos]} strokeWidth={2} />
                <circle cx={cx} cy={cy} r={2} fill={POS_HEX[pos]} />
                {drop > 0.5 && (
                  <text
                    x={cx + 9}
                    y={cy - 8}
                    fontSize={9}
                    fontWeight={600}
                    fill={POS_HEX[pos]}
                    className="font-condensed"
                  >
                    −{drop.toFixed(0)}/next {CLIFF_WINDOW}
                  </text>
                )}
                <title>
                  {POS_LABEL[pos]}: {draftedCount} drafted — on the clock is originally-ranked #{frontierRank} (
                  {player.name}). Drops {drop.toFixed(0)} pts over its next {CLIFF_WINDOW} available players.
                </title>
              </g>
            );
          })}

          {hoverRank && (
            <line
              x1={xScale(hoverRank)}
              x2={xScale(hoverRank)}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_H}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
            />
          )}

          {[1, 12, 24, 36, 48, 60, 72, 80].map((r) => (
            <text
              key={r}
              x={xScale(r)}
              y={H - MARGIN.bottom + 14}
              textAnchor="middle"
              fontSize={9}
              fill="var(--color-text-muted)"
            >
              {r}
            </text>
          ))}
        </svg>

        {hoverRank && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 rounded border border-default bg-surface-raised px-2 py-1.5 text-xs">
            <span className="font-condensed font-semibold text-muted">Rank {hoverRank} available:</span>
            {POSITIONS.map((pos) => {
              const p = livePos[pos][hoverRank - 1];
              return (
                <span key={pos} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: POS_HEX[pos] }} />
                  {p ? (
                    <>
                      {p.name}{' '}
                      <span className="tabular-nums text-muted">{p.projection!.tournamentScore.toFixed(0)}</span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-md border border-default bg-surface px-3 py-2">
        <h2 className="mb-2 font-condensed text-sm font-semibold">Average score left in the FLEX zone</h2>
        <div className="flex flex-col gap-2">
          {(['D', 'MD', 'FW'] as Position[]).map((pos) => (
            <div key={pos} className="grid grid-cols-[3.5rem_1fr_3rem] items-center gap-2">
              <span className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tabular-nums tracking-wide ${POS_BADGE[pos]}`}>
                {POS_LABEL[pos]}
              </span>
              <div className="h-4 overflow-hidden rounded bg-surface-hover">
                <div
                  className="h-full rounded transition-[width]"
                  style={{ width: `${(flexAvg[pos] / maxFlexAvg) * 100}%`, background: POS_HEX[pos] }}
                />
              </div>
              <span className="text-right font-condensed text-sm font-bold tabular-nums">
                {flexAvg[pos].toFixed(0)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-secondary">
          Right now, midfielders left in the FLEX-relevant range ({flexLo}–{flexHi}) average{' '}
          <b className="text-primary">{flexAvg.MD.toFixed(0)} pts</b> — {flexAvg.D > 0 ? `${Math.round((flexAvg.MD / flexAvg.D - 1) * 100)}% more than defenders` : ''}
          {flexAvg.D > 0 && flexAvg.FW > 0 ? ' and ' : ''}
          {flexAvg.FW > 0 ? `${Math.round((flexAvg.MD / flexAvg.FW - 1) * 100)}% more than forwards` : ''} at the same
          depth. This recomputes live as players get marked off-board — watch it compress if the table is running
          on mids.
        </p>
      </section>
    </div>
  );
}
