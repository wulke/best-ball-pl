/**
 * Correlation-rule framework (#118): code-level config for stack/anti-stack
 * badges in the single-slate draft UI (map #117). A rule declares a
 * position-count shape (`slots`), whether satisfying it is a good thing
 * (`stack`) or a warning (`antiStack`), and the club relationship it checks
 * (`sameClub` today; `opponentClub` is the anti-stack ticket #120's rule).
 *
 * V1 is informational-only: `weight` is part of the shape per the map's
 * destination but isn't read anywhere yet — ranking-influence is deferred
 * fog until badges are validated live.
 */
import type { Position } from '../ui/types.js';

export type Rule = {
  id: string;
  /** Short badge text, e.g. the club-chip suffix. */
  label: string;
  /** Tooltip copy; `{club}` is replaced with the matched club name. */
  tooltip: string;
  /** Minimum count required per position for the rule to match a club. */
  slots: Partial<Record<Position, number>>;
  direction: 'stack' | 'antiStack';
  scope: 'sameClub' | 'opponentClub';
  /** Unused in v1 — reserved for ranking-influence, once badges are validated live. */
  weight: number;
};

/** GK + paired-DEF same-club clean-sheet stack: their clean-sheet points are
 *  the same event, so rostering both compounds rather than diversifies. */
export const GK_DEF_CS_STACK: Rule = {
  id: 'gk-def-cs-stack',
  label: 'CS corr',
  tooltip: 'G + D from {club}: their clean-sheet points are the same event',
  slots: { G: 1, D: 1 },
  direction: 'stack',
  scope: 'sameClub',
  weight: 1,
};

export const STACK_RULES: Rule[] = [GK_DEF_CS_STACK];

/** Does this per-position count satisfy every one of the rule's slots? */
function satisfiesSlots(counts: Partial<Record<Position, number>>, rule: Rule): boolean {
  return (Object.entries(rule.slots) as [Position, number][]).every(
    ([pos, min]) => (counts[pos] ?? 0) >= min,
  );
}

/** Same-club rules matched by one club's position counts. */
export function matchSameClubRules(
  counts: Partial<Record<Position, number>>,
  rules: Rule[] = STACK_RULES,
): Rule[] {
  return rules.filter((rule) => rule.scope === 'sameClub' && satisfiesSlots(counts, rule));
}

/** Fill `{club}` into a rule's tooltip template. */
export function ruleTooltip(rule: Rule, club: string): string {
  return rule.tooltip.replaceAll('{club}', club);
}
