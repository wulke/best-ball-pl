/**
 * Matchup context strip (#108): a thin, collapsible row of per-fixture chips
 * docked ABOVE the sheet's sticky filter bar (both pin together in one
 * sticky wrapper — see App.tsx) — the "betting site" context
 * (predicted score, 1X2, clean sheets, over 2.5, and the real market line
 * when the slate has an odds pull) for daily profiles. False Nine (a
 * 380-fixture window) never renders it.
 *
 * Readability decisions from review:
 * - Accent-tinted band (bg-accent/5 + border-accent/30) + raised chips
 *   (bg-surface-raised + border-strong) so the strip stands out from the
 *   board as ONE context zone.
 * - Data coloring is monochrome/theme-neutral: accent-colored home
 *   bars/favorites collided with the theme's "active/selected" accent. Home
 *   vs away bar segments are neutral lightness steps (bg-secondary vs
 *   bg-muted — colorblind-safe, identical meaning in every theme), the
 *   favored club is text-primary vs the other's text-secondary, and the ONLY
 *   hue in the strip is MKT's text-info = "this number is the market's".
 * - No kickoff timestamp (noise mid-draft; the slate defines the window).
 * - Every probability is explicitly suffixed with % (62%/21%/17%, CS 41%/28%,
 *   O2.5 57%) — bare slashes read as scores, not odds.
 *
 * Pure presentation — every number comes from `matchupContext()` (matchupContext.ts).
 */
import type { MatchupContext } from './matchupContext.js';

/** Percentage label — every probability in the strip carries an explicit %. */
const pct = (x: number) => `${Math.round(x * 100)}%`;

function MatchupChip({ matchup }: { matchup: MatchupContext }) {
  const { fixture, market } = matchup;
  const homeEdge = matchup.homeWin >= matchup.awayWin;
  return (
    <div
      className="min-w-44 rounded border border-strong bg-surface-raised px-2 py-1"
      title={`${fixture.home} λ ${matchup.homeXg.toFixed(2)} · ${fixture.away} λ ${matchup.awayXg.toFixed(2)}${
        market ? ` · MKT avg of ${market.books} book${market.books === 1 ? '' : 's'}` : ' · no market quotes'
      }`}
    >
      <div className="whitespace-nowrap">
        <span className="font-condensed text-base font-bold leading-none tabular-nums">
          <span className={homeEdge ? 'text-primary' : 'text-secondary'}>{fixture.home}</span>
          <span className="mx-1 text-secondary">
            {matchup.homeXg.toFixed(1)}–{matchup.awayXg.toFixed(1)}
          </span>
          <span className={!homeEdge ? 'text-primary' : 'text-secondary'}>{fixture.away}</span>
        </span>
      </div>
      {/* 1X2 stacked bar: neutral lightness steps (theme-agnostic) — the
          favorite is the longer segment, not a color. */}
      <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded" aria-hidden="true">
        <div className="bg-secondary" style={{ width: `${matchup.homeWin * 100}%` }} />
        <div className="bg-muted/40" style={{ width: `${matchup.draw * 100}%` }} />
        <div className="bg-muted" style={{ width: `${matchup.awayWin * 100}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 whitespace-nowrap text-[0.65rem] tabular-nums">
        <span className="font-semibold text-secondary">
          {pct(matchup.homeWin)}/{pct(matchup.draw)}/{pct(matchup.awayWin)}
        </span>
        <span className="text-muted">
          CS {pct(matchup.homeCleanSheet)}/{pct(matchup.awayCleanSheet)} · O2.5 {pct(matchup.over25)}
        </span>
        {market && (
          <span className="font-semibold text-info">
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
    <div className="rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
        title="Per-fixture matchup context: model predicted score, 1X2 / clean-sheet / over-2.5 probabilities, and the bookmaker line when an odds pull exists"
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-accent">
          Matchups ({matchups.length})
        </span>
        <span className="text-xs text-muted" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 flex gap-2 overflow-x-auto pb-0.5">
          {matchups.map((m) => (
            <MatchupChip key={m.fixture.id} matchup={m} />
          ))}
        </div>
      )}
    </div>
  );
}
