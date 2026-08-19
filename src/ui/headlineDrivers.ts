/**
 * Headline-driver "why" text for the player breakdown modal (#30).
 *
 * Pure UI-layer formatting: turns the raw explanation fields persisted on
 * `PlayerProjection` (#29) into short labeled sentences. No pre-written
 * strings live in the snapshot — everything here is derived client-side.
 *
 * Deliberately "headline drivers", not a full reasoning trace: rate-blend
 * diagnostics (hasXg/k/gBlend) stay out — that's a future in-season view.
 */
import type { PlayerProjection } from '../model/types.js';
import type { Position } from './types.js';

export type DriverLine = {
  /** Row label, e.g. "Minutes". */
  label: string;
  /** The sentence — terse, numbers baked in. */
  text: string;
  /** True when the line flags risk (durability tripped) — label turns negative. */
  negative?: boolean;
};

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const int = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * One line per driver, in display order. Minutes / Confidence / Team context
 * always render; Congestion and Durability only appear when they fired —
 * during a draft, the absence of a red line is itself the signal.
 */
export function headlineDrivers(p: PlayerProjection, position: Position, team: string): DriverLine[] {
  const lines: DriverLine[] = [];

  // --- Minutes basis -------------------------------------------------------
  if (position === 'G') {
    // Keeper minutes come entirely from the starts-claim model (job-share),
    // never from the newcomer blend or congestion haircut.
    const starts = Math.round(p.statline.matches);
    lines.push({
      label: 'Minutes',
      text: `Keeper starts-claim model — ~${starts} claimed starts at ${team}; job-share split, no outfield blend.`,
    });
  } else if (p.newcomerPrior.applied) {
    lines.push(
      p.seasonCount === 0
        ? {
            label: 'Minutes',
            text: `Price-tier newcomer prior — ~${int(p.newcomerPrior.value)} min (no usable FPL history; per-position price fit).`,
          }
        : {
            label: 'Minutes',
            text: `Thin history — 1 usable season blended toward the price-tier prior (~${int(p.newcomerPrior.value)} min).`,
          },
    );
  } else {
    lines.push({
      label: 'Minutes',
      text: `Observed history — ${p.seasonCount} usable season${p.seasonCount === 1 ? '' : 's'}, ${int(p.weightedMinutes)} weighted min → ${int(p.minutes)} projected.`,
    });
  }

  // --- Congestion haircut (outfield only, only when it fired) -------------
  if (position !== 'G' && p.congestionApplied) {
    lines.push({
      label: 'Congestion',
      text: 'High-win-rate team — fixture-congestion minutes haircut applied.',
    });
  }

  // --- Confidence basis -----------------------------------------------------
  lines.push({
    label: 'Confidence',
    text: `${p.confidence} — ${p.seasonCount} usable season${p.seasonCount === 1 ? '' : 's'}, ${int(p.weightedMinutes)} weighted min behind the rates.`,
  });

  // --- Durability risk (only when a threshold tripped) ---------------------
  if (p.durabilityRisk) {
    const reasons: string[] = [];
    if (p.durabilityReasons.thinMinutesShare) reasons.push('minutes share < 50% of club');
    if (p.durabilityReasons.lowStartFraction) reasons.push('start rate < 55%');
    if (p.durabilityReasons.highUnusedSubs) reasons.push('unused-sub rate > 0.6/90');
    lines.push({
      label: 'Durability',
      text: reasons.length > 0 ? `Risk — ${reasons.join(' · ')}.` : 'Risk — threshold tripped.',
      negative: true,
    });
  }

  // --- Team context basis ---------------------------------------------------
  const tc = p.teamContext;
  if (tc.observed) {
    const base = `Observed ${team} priors — ${pct(tc.cleanSheetRate)} CS rate, ${tc.goalsConcededPerMatch.toFixed(1)} GC/match`;
    lines.push({
      label: 'Team context',
      text:
        position === 'G'
          ? `${base}, ${pct(tc.gkWinRate)} keeper win rate.`
          : `${base}.`,
    });
  } else {
    lines.push({
      label: 'Team context',
      text: `Promoted-team fallback — ${team} lacks keeper/squad history; league-mean priors (${pct(tc.cleanSheetRate)} CS, ${tc.goalsConcededPerMatch.toFixed(1)} GC/match).`,
    });
  }

  return lines;
}
