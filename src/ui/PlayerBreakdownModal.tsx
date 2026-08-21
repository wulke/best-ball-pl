import { useEffect } from 'react';
import type { Position } from './types.js';
import type { PlayerProjection, ProjectedStatline } from '../model/types.js';
import { DEFAULT_SCORING, FALSE_NINE_POINTS } from '../model/config.js';
import { headlineDrivers } from './headlineDrivers.js';

type OddsTerm = Exclude<keyof NonNullable<PlayerProjection['odds']>, 'fetchedAt'>;

/**
 * Scoring terms in the order the ticket's table should read — one universal
 * list driven by scoring.ts, not a per-position template. `appliesTo` mirrors
 * scoreStatline's position gating (src/model/scoring.ts) so the breakdown
 * table and the actual scorer never drift apart.
 */
const TERMS: {
  label: string;
  stat: keyof ProjectedStatline;
  weight: keyof typeof FALSE_NINE_POINTS;
  appliesTo?: (position: Position) => boolean;
}[] = [
  { label: 'Goals', stat: 'goals', weight: 'goal' },
  { label: 'Assists', stat: 'assists', weight: 'assist' },
  { label: 'Shots on target', stat: 'shotsOnTarget', weight: 'shotOnTarget' },
  { label: 'Chances created', stat: 'chancesCreated', weight: 'chanceCreated' },
  { label: 'Crosses', stat: 'crosses', weight: 'cross' },
  { label: 'Tackles', stat: 'tackles', weight: 'tackle' },
  { label: 'Passes', stat: 'passes', weight: 'pass' },
  { label: 'Shots off target', stat: 'shotsOffTarget', weight: 'shotOffTarget' },
  {
    label: 'Clean sheets',
    stat: 'cleanSheets',
    weight: 'cleanSheet',
    appliesTo: (p) => p === 'G' || p === 'D',
  },
  {
    label: 'Goals conceded',
    stat: 'goalsConceded',
    weight: 'goalConceded',
    appliesTo: (p) => p === 'G' || p === 'D',
  },
  { label: 'Wins', stat: 'gkWins', weight: 'gkWin', appliesTo: (p) => p === 'G' },
  { label: 'Saves', stat: 'saves', weight: 'save', appliesTo: (p) => p === 'G' },
  {
    label: 'Penalties saved',
    stat: 'penaltiesSaved',
    weight: 'penaltySave',
    appliesTo: (p) => p === 'G' },
];

/** Market-covered terms only. The position gates match the scoring breakdown
 * above, so a midfielder never sees defensive or keeper-only market rows. */
const ODDS_TERMS: {
  label: string;
  term: OddsTerm;
  appliesTo?: (position: Position) => boolean;
}[] = [
  { label: 'Goals', term: 'goals' },
  { label: 'Assists', term: 'assists' },
  { label: 'Clean sheets', term: 'cleanSheets', appliesTo: (p) => p === 'G' || p === 'D' },
  { label: 'Goals conceded', term: 'goalsConceded', appliesTo: (p) => p === 'G' || p === 'D' },
  { label: 'Wins', term: 'gkWins', appliesTo: (p) => p === 'G' },
];

export function PlayerBreakdownModal({
  name,
  position,
  team,
  projection,
  onClose,
}: {
  name: string;
  position: Position;
  /** FPL short name (e.g. "MCI") — names the team in the why-this-projection lines. */
  team: string;
  projection: PlayerProjection;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { statline } = projection;
  const rows = TERMS.filter((t) => t.appliesTo?.(position) ?? true)
    .map((t) => ({
      ...t,
      value: statline[t.stat],
      weight: DEFAULT_SCORING[t.weight] as number,
      subtotal: statline[t.stat] * DEFAULT_SCORING[t.weight],
    }))
    .filter((t) => t.weight !== 0 && t.value !== 0);
  const oddsRows = projection.odds
    ? ODDS_TERMS.filter((term) => term.appliesTo?.(position) ?? true)
      .map((term) => ({ ...term, comparison: projection.odds![term.term] }))
      .filter(({ comparison }) => comparison.oddsImplied != null)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm print:hidden"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name} scoring breakdown`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-strong bg-surface-raised p-4 shadow-lg"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-condensed text-lg font-semibold text-primary">{name}</h2>
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              {position} · projected season points breakdown
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-default text-sm text-muted transition-colors hover:border-strong hover:text-primary"
          >
            ×
          </button>
        </div>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b border-default">
              <th className="px-1 py-1 text-left font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                Stat
              </th>
              <th className="px-1 py-1 text-right font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                Value
              </th>
              <th className="px-1 py-1 text-right font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                Weight
              </th>
              <th className="px-1 py-1 text-right font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                Pts
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-default last:border-b-0">
                <td className="px-1 py-1 text-sm text-secondary">{row.label}</td>
                <td className="px-1 py-1 text-right font-condensed text-sm tabular-nums text-secondary">
                  {row.value.toFixed(1)}
                </td>
                <td className="px-1 py-1 text-right font-condensed text-sm tabular-nums text-muted">
                  ×{row.weight}
                </td>
                <td className="px-1 py-1 text-right font-condensed text-sm font-medium tabular-nums text-primary">
                  {row.subtotal.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-strong">
              <td colSpan={3} className="px-1 py-1 text-right text-xs font-semibold uppercase tracking-wide text-muted">
                Total (p50)
              </td>
              <td className="px-1 py-1 text-right font-condensed text-sm font-bold tabular-nums text-accent">
                {projection.points.p50.toFixed(1)}
              </td>
            </tr>
          </tfoot>
        </table>

        {oddsRows.length > 0 && projection.odds && (
          <section className="mt-4" aria-label="Odds rate detail">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-accent">
                Odds rate detail
              </span>
              {projection.odds.fetchedAt && (
                <span className="text-xs tabular-nums text-muted">
                  Odds fetched {projection.odds.fetchedAt}
                </span>
              )}
            </div>
            <table className="mt-1 w-full border-collapse">
              <thead>
                <tr className="border-b border-default">
                  <th className="px-1 py-1 text-left font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                    Term
                  </th>
                  <th className="px-1 py-1 text-right font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                    Model
                  </th>
                  <th className="px-1 py-1 text-right font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                    Odds
                  </th>
                  <th className="px-1 py-1 text-right font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                    Blended
                  </th>
                </tr>
              </thead>
              <tbody>
                {oddsRows.map(({ label, comparison }) => (
                  <tr key={label} className="border-b border-default last:border-b-0">
                    <td className="px-1 py-1 text-sm text-secondary">{label}</td>
                    <td className="px-1 py-1 text-right font-condensed text-sm tabular-nums text-secondary">
                      {comparison.model.toFixed(3)}
                    </td>
                    <td className="px-1 py-1 text-right font-condensed text-sm tabular-nums text-secondary">
                      {comparison.oddsImplied!.toFixed(3)}
                    </td>
                    <td className="px-1 py-1 text-right font-condensed text-sm font-medium tabular-nums text-primary">
                      {comparison.blended.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <div className="mt-4">
          <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-accent">
            Estimated range
          </span>
          <p className="mt-0.5 text-[0.7rem] text-muted">
            p10 / p50 / p90 scenario points — fixed multipliers on the projection, not a fitted
            statistical distribution.
          </p>
          <RangeChart p10={projection.points.p10} p50={projection.points.p50} p90={projection.points.p90} />
        </div>

        <div className="mt-4">
          <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-accent">
            Why this projection
          </span>
          <dl className="mt-1">
            {headlineDrivers(projection, position, team).map((line) => (
              <div
                key={line.label}
                className="flex gap-2 border-b border-default py-1 last:border-b-0"
              >
                <dt
                  className={`w-20 shrink-0 font-condensed text-[0.65rem] font-semibold uppercase tracking-wider ${
                    line.negative ? 'text-negative' : 'text-muted'
                  }`}
                >
                  {line.label}
                </dt>
                <dd className="text-xs leading-snug text-secondary">{line.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

function RangeChart({ p10, p50, p90 }: { p10: number; p50: number; p90: number }) {
  const width = 400;
  const height = 64;
  const padding = 36;
  const lo = Math.min(p10, p50, p90);
  const hi = Math.max(p10, p50, p90);
  const span = Math.max(hi - lo, 1);
  const x = (v: number) => padding + ((v - lo) / span) * (width - 2 * padding);
  const y = height / 2;

  const points: { label: string; value: number; strong?: boolean }[] = [
    { label: 'p10', value: p10 },
    { label: 'p50', value: p50, strong: true },
    { label: 'p90', value: p90 },
  ];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 w-full" role="img" aria-label="Estimated point range">
      <line x1={x(p10)} y1={y} x2={x(p90)} y2={y} className="stroke-border-strong" strokeWidth={2} />
      {points.map((pt) => (
        <g key={pt.label}>
          <line x1={x(pt.value)} y1={y - 6} x2={x(pt.value)} y2={y + 6} className="stroke-accent" strokeWidth={pt.strong ? 2.5 : 1.5} />
          <circle cx={x(pt.value)} cy={y} r={pt.strong ? 4 : 2.5} className={pt.strong ? 'fill-accent' : 'fill-secondary'} />
          <text
            x={x(pt.value)}
            y={y - 14}
            textAnchor="middle"
            className="font-condensed fill-muted text-[9px] font-semibold uppercase tracking-wide"
          >
            {pt.label}
          </text>
          <text
            x={x(pt.value)}
            y={y + 22}
            textAnchor="middle"
            className="font-condensed fill-primary text-[10px] font-medium tabular-nums"
          >
            {pt.value.toFixed(1)}
          </text>
        </g>
      ))}
    </svg>
  );
}
