/**
 * Matchup context for the daily-slate sheet strip: per-fixture "betting site"
 * numbers derived client-side from what the board already computed.
 *
 * Sources, no new ETL:
 * - **Predicted score (λ home / away)**: the sum of p50 `statline.goals` over
 *   the active profile's pool, grouped by club. Because daily profiles are
 *   window-projected, a one-fixture slate's statline is *per that fixture* —
 *   the sum IS the model's opponent-adjusted, start-aware, odds-blended
 *   expected goals for the matchup (keeper/own-goal contributions are ~0).
 * - **1X2 / clean sheets / over 2.5**: an independent Poisson grid over the
 *   two λs (standard Dixon-Coles-free independence assumption — display-only
 *   context, never an input the model consumes).
 * - **Market line (MKT)**: real bookmaker 1X2 decimal quotes from the slate's
 *   odds asset (`data/odds/<profile>.json`), implied probabilities
 *   normalized per book (overround removed), then averaged across books.
 *   Absent quotes → `market: null` → the chip simply hides the line.
 *
 * Pure functions throughout — deterministic and unit-testable offline.
 */

import type { OddsSlate } from '../etl/odds.js';
import type { SnapshotFixture } from '../etl/types.js';
import type { SnapshotPlayer } from './types.js';

export type MatchupMarket = {
  homeWin: number;
  draw: number;
  awayWin: number;
  /** Distinct bookmakers behind the average. */
  books: number;
};

export type MatchupContext = {
  fixture: SnapshotFixture;
  /** Model expected goals (p50 pool sum) — the "predicted score". */
  homeXg: number;
  awayXg: number;
  /** Poisson-derived 1X2 probabilities (sum to 1). */
  homeWin: number;
  draw: number;
  awayWin: number;
  /** P(opponent scores zero). */
  homeCleanSheet: number;
  awayCleanSheet: number;
  /** P(total goals > 2.5). */
  over25: number;
  /** Bookmaker consensus, when the odds asset priced this fixture. */
  market: MatchupMarket | null;
};

/** Poisson pmf, iteratively (no factorial overflow). */
function poissonPmf(k: number, lambda: number): number {
  let pmf = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) pmf = (pmf * lambda) / i;
  return pmf;
}

/** Grid cap: P(>MAX goals) is negligible at football scoring rates. */
const MAX_GOALS = 10;

export function matchProbabilities(
  homeXg: number,
  awayXg: number,
): { homeWin: number; draw: number; awayWin: number } {
  if (homeXg < 0 || awayXg < 0) throw new Error(`negative xG (${homeXg}, ${awayXg})`);
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (let h = 0; h <= MAX_GOALS; h += 1) {
    for (let a = 0; a <= MAX_GOALS; a += 1) {
      const p = poissonPmf(h, homeXg) * poissonPmf(a, awayXg);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }
  const total = homeWin + draw + awayWin; // renormalize the truncated tail
  return { homeWin: homeWin / total, draw: draw / total, awayWin: awayWin / total };
}

/** P(a side failing to score) against the opponent's λ. */
export function cleanSheetProb(opponentXg: number): number {
  return Math.exp(-Math.max(0, opponentXg));
}

/** P(three or more total goals). */
export function overProb(homeXg: number, awayXg: number, line = 2.5): number {
  const cutoff = Math.floor(line); // over `line` ⇔ total ≥ floor(line)+1
  let underOrPush = 0;
  for (let h = 0; h <= MAX_GOALS; h += 1) {
    for (let a = 0; a <= MAX_GOALS && h + a <= cutoff; a += 1) {
      underOrPush += poissonPmf(h, homeXg) * poissonPmf(a, awayXg);
    }
  }
  return 1 - underOrPush;
}

/** Bookmaker 1X2 quotes → per-book normalized implied probabilities → average. */
export function marketLine(quotes: Array<{ bookmaker: string; selection: 'home' | 'draw' | 'away'; price: number }>): MatchupMarket | null {
  const byBook = new Map<string, Map<'home' | 'draw' | 'away', number>>();
  for (const q of quotes) {
    if (!Number.isFinite(q.price) || q.price <= 1) continue; // degenerate quote
    const book = byBook.get(q.bookmaker) ?? new Map();
    book.set(q.selection, q.price);
    byBook.set(q.bookmaker, book);
  }
  const sums = { homeWin: 0, draw: 0, awayWin: 0 };
  let books = 0;
  for (const book of byBook.values()) {
    const h = book.get('home');
    const d = book.get('draw');
    const a = book.get('away');
    if (h == null || d == null || a == null) continue; // incomplete market — skip the book
    const raw = { h: 1 / h, d: 1 / d, a: 1 / a };
    const overround = raw.h + raw.d + raw.a;
    sums.homeWin += raw.h / overround;
    sums.draw += raw.d / overround;
    sums.awayWin += raw.a / overround;
    books += 1;
  }
  if (books === 0) return null;
  return { homeWin: sums.homeWin / books, draw: sums.draw / books, awayWin: sums.awayWin / books, books };
}

/** Sum p50 expected goals per club across the pool (window-scaled for dailies). */
function expectedGoalsByClub(players: SnapshotPlayer[]): Map<string, number> {
  const byClub = new Map<string, number>();
  for (const p of players) {
    const goals = p.projection?.statline.goals ?? 0;
    byClub.set(p.team, (byClub.get(p.team) ?? 0) + goals);
  }
  return byClub;
}

/** One MatchupContext per fixture. `odds` must already be a real pull
 *  (fetchedAt set) — the placeholder contract lives in windowProjections. */
export function matchupContext(
  players: SnapshotPlayer[],
  fixtures: SnapshotFixture[],
  odds?: OddsSlate,
): MatchupContext[] {
  const xg = expectedGoalsByClub(players);
  const oddsByFixture = new Map((odds?.fixtures ?? []).map((f) => [f.fixtureId, f]));
  return fixtures.map((fixture) => {
    const homeXg = xg.get(fixture.home) ?? 0;
    const awayXg = xg.get(fixture.away) ?? 0;
    const probs = matchProbabilities(homeXg, awayXg);
    return {
      fixture,
      homeXg,
      awayXg,
      ...probs,
      homeCleanSheet: cleanSheetProb(awayXg),
      awayCleanSheet: cleanSheetProb(homeXg),
      over25: overProb(homeXg, awayXg),
      market: marketLine(oddsByFixture.get(fixture.id)?.matchWinner ?? []),
    };
  });
}
