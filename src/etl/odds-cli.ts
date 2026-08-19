/** CLI entry point for `npm run odds -- --profile <daily-profile-id>` (#61). */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { profileById, resolveContest } from '../contest/profiles.js';
import { buildOddsSlate, type OddsEvent } from './odds.js'; import type { Snapshot } from './types.js';
const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const apiRoot = 'https://api.the-odds-api.com/v4/sports/soccer_epl';
function argument(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function getJson(url: URL): Promise<OddsEvent[]> { const response = await fetch(url); if (!response.ok) throw new Error(`Odds API ${response.status}: ${await response.text()}`); return response.json() as Promise<OddsEvent[]>; }
async function main() {
  const profileId = argument('--profile'); if (!profileId) throw new Error('Usage: npm run odds -- --profile <daily-profile-id>');
  const key = process.env.ODDS_API_KEY; if (!key) throw new Error('ODDS_API_KEY is required. Create a free key at the-odds-api.com before running this ETL.');
  const snapshot = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8')) as Snapshot;
  const profile = profileById(profileId); if (profile.window.kind !== 'slate') throw new Error(`Profile '${profileId}' is not a single-day slate.`);
  const contest = resolveContest(profile, snapshot.fixtures);
  const bulkEvents = await getJson(new URL(`${apiRoot}/odds?${new URLSearchParams({ apiKey: key, regions: 'us', markets: 'h2h,totals', oddsFormat: 'decimal' })}`));
  // First retain only priced slate fixtures, avoiding a paid per-event props request for absent team markets.
  const probe = buildOddsSlate(profileId, profile.window.date, contest.fixtures, [], bulkEvents, new Map(), new Date().toISOString());
  const details = new Map<string, OddsEvent>();
  for (const row of probe.fixtures) {
    const response = await fetch(new URL(`${apiRoot}/events/${row.eventId}/odds?${new URLSearchParams({ apiKey: key, regions: 'us', markets: 'player_goal_scorer_anytime,player_assists', oddsFormat: 'decimal' })}`));
    if (!response.ok) throw new Error(`Odds API player props ${response.status}: ${await response.text()}`);
    details.set(row.eventId, await response.json() as OddsEvent);
  }
  const slate = buildOddsSlate(profileId, profile.window.date, contest.fixtures, snapshot.players.filter((player) => contest.clubs!.includes(player.team)), bulkEvents, details);
  const output = path.join(repoRoot, 'data/odds', `${profileId}.json`); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(slate, null, 2)}\n`);
  console.log(`[Odds ETL] Wrote ${slate.fixtures.length}/${contest.fixtures.length} priced fixture(s) to ${path.relative(repoRoot, output)}.`);
}
main().catch((error) => { console.error('[Odds ETL] Failed:', error); process.exit(1); });
