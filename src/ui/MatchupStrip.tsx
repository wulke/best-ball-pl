/**
 * Matchup context strip (#108): a thin, collapsible row of per-fixture chips
 * docked ABOVE the sheet's sticky filter bar (both pin together in one
 * sticky wrapper — see App.tsx) — the "betting site" context
 * (predicted score, 1X2, clean sheets, over 2.5, and the real market line
 * when the slate has an odds pull) for daily profiles. False Nine (a
 * 380-fixture window) never renders it.
 *
 * Pure presentation — every number comes from `matchupContext()` (matchupContext.ts).
 */
import type { MatchupContext } from './matchupContext.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** '2026-08-29T11:30:00Z' → 'Sat 11:30Z' — UTC, deterministic for tests. */
function kickoffLabel(kickoff: string): string {
  const d = new Date(kickoff);
  return `${WEEKDAYS[d.getUTCDay()]} ${kickoff.slice(11, 16)}Z`;
}

const pct = (x: number) => `${Math.round(x * 100)}`;

function MatchupChip({ matchup }: { matchup: MatchupContext }) {
  const { fixture, market } = matchup;
  const homeEdge = matchup.homeWin >= matchup.awayWin;
  return (
    <div
      className="min-w-44 rounded border border-default bg-surface px-2 py-1"
      title={`${fixture.home} λ ${matchup.homeXg.toFixed(2)} · ${fixture.away} λ ${matchup.awayXg.toFixed(2)}${
        market ? ` · MKT avg of ${market.books} book${market.books === 1 ? '' : 's'}` : ' · no market quotes'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="font-condensed text-sm font-semibold tabular-nums">
          <span className={homeEdge ? 'text-accent' : 'text-primary'}>{fixture.home}</span>
          <span className="mx-1 text-secondary">
            {matchup.homeXg.toFixed(1)}–{matchup.awayXg.toFixed(1)}
          </span>
          <span className={!homeEdge ? 'text-accent' : 'text-primary'}>{fixture.away}</span>
        </span>
        <span className="text-[0.65rem] tabular-nums text-muted">{kickoffLabel(fixture.kickoff)}</span>
      </div>
      {/* 1X2 stacked bar: model home / draw / away */}
      <div className="mt-1 flex h-1 w-full overflow-hidden rounded" aria-hidden="true">
        <div className="bg-accent" style={{ width: `${matchup.homeWin * 100}%` }} />
        <div className="bg-muted" style={{ width: `${matchup.draw * 100}%` }} />
        <div className="bg-info" style={{ width: `${matchup.awayWin * 100}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 whitespace-nowrap text-[0.65rem] tabular-nums">
        <span className="text-secondary">
          {pct(matchup.homeWin)}/{pct(matchup.draw)}/{pct(matchup.awayWin)}
        </span>
        <span className="text-muted">
          CS {pct(matchup.homeCleanSheet)}/{pct(matchup.awayCleanSheet)} · O2.5 {pct(matchup.over25)}%
        </span>
        {market && (
          <span className="text-secondary">
            MKT {pct(market.homeWin)}/{pct(market.draw)}/{pct(market.awayWin)}
          </span>
        )}
      </div>
    </div>
  );
}

export function MatchupStrip({
  matchups,
  open,
  onToggle,
}: {
  matchups: MatchupContext[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="print:hidden">
      <button
        type="button"
        onClick={onToggle}
        className="text-xs font-semibold uppercase tracking-widest text-accent"
        title="Per-fixture matchup context: model predicted score, 1X2 / clean-sheet / over-2.5 probabilities, and the bookmaker line when an odds pull exists"
      >
        {open ? '▾' : '▸'} Matchups ({matchups.length})
      </button>
      {open && (
        <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
          {matchups.map((m) => (
            <MatchupChip key={m.fixture.id} matchup={m} />
          ))}
        </div>
      )}
    </div>
  );
}
