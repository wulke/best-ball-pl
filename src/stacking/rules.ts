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
import type { Position, SnapshotPlayer } from '../ui/types.js';
import type { SnapshotFixture } from '../etl/types.js';
import { getOpponentClub } from '../ui/opponent.js';

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
  /** Candidate positions an opponentClub rule flags (attackers for the
   *  anti-CS rule). Same-club rules leave this unset — they flag any pick
   *  at the club that satisfies the slots. */
  appliesTo?: Position[];
  /** Light-tone copy for the half-held (prospective) anti-stack case;
   *  `{held}` fills with the rostered half, e.g. "a GK". */
  prospectiveTooltip?: string;
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

/** Opponent-attacker anti-CS warning (#120): once the roster holds a G+D
 *  clean-sheet pair from a club, that club's fixture opponent's attackers
 *  (MD/FW) are negatively correlated with the stack — their attacking
 *  returns evaporate exactly when the stack pays off. The prospective
 *  tooltip covers the half-held case (a lone GK or lone DEF at the club):
 *  a light heads-up, not a warning. */
export const OPP_ATT_CS_ANTISTACK: Rule = {
  id: 'opp-att-cs-antistack',
  label: 'CS clash',
  tooltip:
    'Faces your G+D clean-sheet stack from {club} — if {club} keeps a clean sheet, their attacking returns are gone',
  prospectiveTooltip:
    "You hold {held} from {club} — one pick from a G+D CS stack; completing it would erase this attacker's returns",
  slots: { G: 1, D: 1 },
  direction: 'antiStack',
  scope: 'opponentClub',
  appliesTo: ['MD', 'FW'],
  weight: 1,
};

export const STACK_RULES: Rule[] = [GK_DEF_CS_STACK, OPP_ATT_CS_ANTISTACK];

/** One anti-stack match against a candidate: which rule fired, the club
 *  whose stack the candidate opposes, whether the stack is only half-held
 *  (a lone GK or lone DEF — light tone, not a warning), and the human name
 *  of the held half when prospective ("a GK" / "a DEF"). */
export type AntiStackMatch = { rule: Rule; club: string; prospective: boolean; held?: string };

/** Does this per-position count satisfy every one of the rule's slots? */
function satisfiesSlots(counts: Partial<Record<Position, number>>, rule: Rule): boolean {
  return slotsDeficit(counts, rule) === 0;
}

/** Picks missing from a club's counts to satisfy a rule's slots. 0 = stack
 *  held; 1 = prospective (half-held); ≥2 = nothing worth flagging. */
function slotsDeficit(counts: Partial<Record<Position, number>>, rule: Rule): number {
  return (Object.entries(rule.slots) as [Position, number][]).reduce(
    (sum, [pos, min]) => sum + Math.max(0, min - (counts[pos] ?? 0)),
    0,
  );
}

/** The rule-slot positions a club's counts already hold (for {held}). */
function heldPositions(counts: Partial<Record<Position, number>>, rule: Rule): Position[] {
  return (Object.keys(rule.slots) as Position[]).filter(
    (pos) => (counts[pos] ?? 0) >= (rule.slots[pos] ?? 0),
  );
}

/** Same-club rules matched by one club's position counts. */
export function matchSameClubRules(
  counts: Partial<Record<Position, number>>,
  rules: Rule[] = STACK_RULES,
): Rule[] {
  return rules.filter((rule) => rule.scope === 'sameClub' && satisfiesSlots(counts, rule));
}

/** Opponent-club anti-stack rules matched by a candidate (#120): fires
 *  when the roster holds all (full, warning tone) or all-but-one pick
 *  (prospective, light tone) of the rule's stack slots at some club and
 *  the candidate is an attacker (`appliesTo`) from that club's fixture
 *  opponent. Empty when the stack club has no window fixture. */
export function matchOpponentClubRules(
  candidate: Pick<SnapshotPlayer, 'team' | 'position'>,
  rosterByClub: ReadonlyMap<string, Partial<Record<Position, number>>>,
  fixtures: SnapshotFixture[],
  rules: Rule[] = STACK_RULES,
): AntiStackMatch[] {
  const matches: AntiStackMatch[] = [];
  for (const rule of rules) {
    if (rule.scope !== 'opponentClub' || rule.direction !== 'antiStack') continue;
    if (rule.appliesTo && !rule.appliesTo.includes(candidate.position)) continue;
    for (const [club, counts] of rosterByClub) {
      const deficit = slotsDeficit(counts, rule);
      if (deficit > 1) continue;
      if (getOpponentClub({ team: club }, fixtures) === candidate.team) {
        const prospective = deficit === 1;
        matches.push({
          rule,
          club,
          prospective,
          held: prospective ? heldHalfName(counts, rule) : undefined,
        });
      }
    }
  }
  return matches;
}

/** Clubs whose roster FULLY satisfies an opponent-club rule's slots and
 *  whose club has a window fixture — the sources the anti-stack warning
 *  chips render from (#120). Prospective (half-held) stacks stay row-level:
 *  they don't earn panel furniture. */
export function opponentClubSources(
  rosterByClub: ReadonlyMap<string, Partial<Record<Position, number>>>,
  fixtures: SnapshotFixture[],
  rules: Rule[] = STACK_RULES,
): { rule: Rule; club: string; oppClub: string }[] {
  const sources: { rule: Rule; club: string; oppClub: string }[] = [];
  for (const rule of rules) {
    if (rule.scope !== 'opponentClub' || rule.direction !== 'antiStack') continue;
    for (const [club, counts] of rosterByClub) {
      if (!satisfiesSlots(counts, rule)) continue;
      const oppClub = getOpponentClub({ team: club }, fixtures);
      if (oppClub) sources.push({ rule, club, oppClub });
    }
  }
  return sources;
}

/** Per-club position counts for a set of players (roster or otherwise) —
 *  the input shape the stack/anti-stack evaluators match against. */
export function clubPositionCounts(
  players: readonly Pick<SnapshotPlayer, 'team' | 'position'>[],
): Map<string, Partial<Record<Position, number>>> {
  const counts = new Map<string, Partial<Record<Position, number>>>();
  for (const p of players) {
    const entry = counts.get(p.team) ?? {};
    entry[p.position] = (entry[p.position] ?? 0) + 1;
    counts.set(p.team, entry);
  }
  return counts;
}

/** Fill `{club}` into a rule's tooltip template, and `{held}` with the
 *  rostered half for prospective anti-stack matches (e.g. "a GK"). */
export function ruleTooltip(rule: Rule, club: string, held?: string): string {
  if (held && rule.prospectiveTooltip) {
    return rule.prospectiveTooltip.replaceAll('{club}', club).replaceAll('{held}', held);
  }
  return rule.tooltip.replaceAll('{club}', club);
}

/** Human name for the held half of a prospective stack, for tooltips. */
const POS_NAME: Record<Position, string> = { G: 'a GK', D: 'a DEF', MD: 'a MID', FW: 'an FWD' };

function heldHalfName(counts: Partial<Record<Position, number>>, rule: Rule): string {
  return heldPositions(counts, rule)
    .map((pos) => POS_NAME[pos])
    .join(' + ');
}
