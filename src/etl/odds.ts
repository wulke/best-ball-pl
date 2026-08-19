/** Odds API slate ETL (#61). Preserves raw bookmaker quotes for the static asset. */
import type { SnapshotFixture, SnapshotPlayer } from './types.js';

export const ODDS_SCHEMA_VERSION = 1;
/** `description` identifies the player on Odds API O/U player markets. */
export type OddsOutcome = { name: string; price: number; point?: number; description?: string };
export type OddsMarket = { key: string; outcomes: OddsOutcome[] };
export type OddsBookmaker = { key: string; title: string; markets: OddsMarket[] };
export type OddsEvent = { id: string; commence_time: string; home_team: string; away_team: string; bookmakers?: OddsBookmaker[] };
export type DecimalQuote = { bookmaker: string; price: number };
export type AssistsQuote = DecimalQuote & { side: 'over' | 'under'; point: number };

/** The browser-readable contract at `data/odds/<profileId>.json`. */
export type OddsSlate = {
  schemaVersion: typeof ODDS_SCHEMA_VERSION; profileId: string; slateDate: string; fetchedAt: string | null;
  fixtures: Array<{
    fixtureId: number; eventId: string; kickoff: string; home: string; away: string;
    /** Raw 1X2 decimal prices, keyed to FPL's home/away clubs or `draw`. */
    matchWinner: Array<DecimalQuote & { selection: 'home' | 'draw' | 'away' }>;
    /** Raw total-goals decimal prices, including each bookmaker's line. */
    totalGoals: AssistsQuote[];
    /** Only players in the profile's FPL pool; unlisted props are absent. */
    playerProps: Array<{ playerId: string; anytimeGoalscorer: DecimalQuote[]; assists: AssistsQuote[] }>;
  }>;
};

/** Odds API EPL labels mapped to FPL short-name IDs in snapshot.json. */
const CLUBS: Record<string, string> = {
  arsenal: 'ARS', astonvilla: 'AVL', bournemouth: 'BOU', brentford: 'BRE', brightonandhovealbion: 'BHA', chelsea: 'CHE', coventrycity: 'COV', crystalpalace: 'CRY', everton: 'EVE', fulham: 'FUL', hullcity: 'HUL', ipswichtown: 'IPS', leedsunited: 'LEE', liverpool: 'LIV', manchestercity: 'MCI', manchesterunited: 'MUN', newcastleunited: 'NEW', nottinghamforest: 'NFO', sunderland: 'SUN', tottenhamhotspur: 'TOT', westhamunited: 'WHU', wolverhamptonwanderers: 'WOL', wolves: 'WOL',
};
export function normalizeOddsName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const clubForOddsName = (name: string) => CLUBS[normalizeOddsName(name)];
const finitePrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 1;
function eventForFixture(fixture: SnapshotFixture, events: OddsEvent[]) {
  return events.find((event) => clubForOddsName(event.home_team) === fixture.home && clubForOddsName(event.away_team) === fixture.away);
}
function playerByOddsName(players: SnapshotPlayer[], name: string) {
  const target = normalizeOddsName(name);
  const matches = players.filter((player) => normalizeOddsName(player.fullName) === target || normalizeOddsName(player.name) === target);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Turns bulk/team and per-event/player API responses into the static asset. Missing coverage stays absent. */
export function buildOddsSlate(profileId: string, slateDate: string, fixtures: SnapshotFixture[], players: SnapshotPlayer[], bulkEvents: OddsEvent[], eventDetails: Map<string, OddsEvent>, fetchedAt = new Date().toISOString()): OddsSlate {
  const rows = fixtures.flatMap((fixture) => {
    const bulk = eventForFixture(fixture, bulkEvents);
    if (!bulk) return [];
    const matchWinner: OddsSlate['fixtures'][number]['matchWinner'] = [];
    const totalGoals: AssistsQuote[] = [];
    for (const book of bulk.bookmakers ?? []) for (const market of book.markets) {
      if (market.key === 'h2h') for (const outcome of market.outcomes) {
        if (!finitePrice(outcome.price)) continue;
        const club = clubForOddsName(outcome.name);
        const selection = outcome.name.toLowerCase() === 'draw' ? 'draw' : club === fixture.home ? 'home' : club === fixture.away ? 'away' : undefined;
        if (selection) matchWinner.push({ bookmaker: book.key, selection, price: outcome.price });
      }
      if (market.key === 'totals') for (const outcome of market.outcomes) {
        const side = outcome.name.toLowerCase();
        if ((side === 'over' || side === 'under') && finitePrice(outcome.price) && typeof outcome.point === 'number') totalGoals.push({ bookmaker: book.key, side, point: outcome.point, price: outcome.price });
      }
    }
    const props = new Map<string, OddsSlate['fixtures'][number]['playerProps'][number]>();
    for (const book of eventDetails.get(bulk.id)?.bookmakers ?? []) for (const market of book.markets) {
      if (market.key !== 'player_goal_scorer_anytime' && market.key !== 'player_assists') continue;
      for (const outcome of market.outcomes) {
        const player = playerByOddsName(players, market.key === 'player_assists' ? outcome.description ?? '' : outcome.name);
        if (!player || !finitePrice(outcome.price)) continue;
        const prop = props.get(player.id) ?? { playerId: player.id, anytimeGoalscorer: [], assists: [] };
        if (market.key === 'player_goal_scorer_anytime') prop.anytimeGoalscorer.push({ bookmaker: book.key, price: outcome.price });
        const side = outcome.name.toLowerCase();
        if (market.key === 'player_assists' && (side === 'over' || side === 'under') && typeof outcome.point === 'number') prop.assists.push({ bookmaker: book.key, side, point: outcome.point, price: outcome.price });
        props.set(player.id, prop);
      }
    }
    const playerProps = [...props.values()].filter((prop) => prop.anytimeGoalscorer.length || prop.assists.length);
    return matchWinner.length || totalGoals.length || playerProps.length ? [{ fixtureId: fixture.id, eventId: bulk.id, kickoff: fixture.kickoff, home: fixture.home, away: fixture.away, matchWinner, totalGoals, playerProps }] : [];
  });
  return { schemaVersion: ODDS_SCHEMA_VERSION, profileId, slateDate, fetchedAt, fixtures: rows };
}
