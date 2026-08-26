/** CLI entry point for `npm run lineups -- --profile <daily-profile-id>` (#99).
 * Manual, close-to-draft pull of confirmed starting XIs from the Premier
 * League site's pulselive API (research #96) → committed, date-stamped
 * `data/lineups/<profile-id>.json`. Run ~30–60 min before the slate's close —
 * not part of the scheduled FPL refresh. Loads `.env` (gitignored) like the
 * odds CLI, though pulselive needs no key. */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileById, resolveContest } from '../contest/profiles.js';
import { buildLineupSlate, matchPulseFixture, type PulseFixture, type PulseFixtureDetail } from './lineups.js';
import type { Snapshot } from './types.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const apiRoot = 'https://footballapi.pulselive.com/football';
const headers = { Origin: 'https://www.premierleague.com', 'User-Agent': 'best-ball-pl lineups ETL (manual pre-close pull)' };
/** EPL 2026/27 compSeason id (research #96, verified). The label check below
 *  makes the fast path safe; the scan covers a season rollover or id shift. */
const CURRENT_COMPSEASON = 841;
const SEASON_SCAN_RADIUS = 10;

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Pulselive API ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

/** EPL season label for the slate's kickoff year: a slate in August+ belongs
 *  to the season starting that August, one in January–May to the season
 *  started the prior year (the season never straddles a slate). */
function seasonLabelForSlateDate(date: string): string {
  const [year, month] = date.split('-').map(Number);
  const start = month >= 8 ? year : year - 1;
  return `${start}/${start + 1}`;
}

/** Current season's compSeason id, verified by its label. Probes the known id
 *  first; a scan only fires if the season rolls over or the id shifts. */
async function resolveCompSeason(slateDate: string): Promise<number> {
  const expected = seasonLabelForSlateDate(slateDate);
  const ids = [CURRENT_COMPSEASON];
  for (let i = 1; i <= SEASON_SCAN_RADIUS; i += 1) ids.push(CURRENT_COMPSEASON - i, CURRENT_COMPSEASON + i);
  for (const id of ids) {
    const season = await getJson<{ id: number; label: string }>(`${apiRoot}/compseasons/${id}`);
    if (season.label.includes(expected)) return season.id;
  }
  throw new Error(`[Lineups ETL] No pulselive compSeason labeled "${expected}" near ${CURRENT_COMPSEASON} — check CURRENT_COMPSEASON.`);
}

async function fetchSeasonFixtures(compSeason: number): Promise<PulseFixture[]> {
  const out: PulseFixture[] = [];
  for (let page = 0; page < 6; page += 1) {
    const body = await getJson<{ content: PulseFixture[] }>(
      `${apiRoot}/fixtures?comps=1&compSeasons=${compSeason}&altIds=true&pageSize=100&page=${page}`,
    );
    out.push(...body.content);
    if (body.content.length < 100) break;
  }
  return out;
}

async function main() {
  const profileId = argument('--profile');
  if (!profileId) throw new Error('Usage: npm run lineups -- --profile <daily-profile-id>');
  const snapshot = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8')) as Snapshot;
  const profile = profileById(profileId);
  if (profile.window.kind !== 'slate') throw new Error(`Profile '${profileId}' is not a single-day slate — lineups are a slate-time asset.`);
  const contest = resolveContest(profile, snapshot.fixtures);
  const compSeason = await resolveCompSeason(profile.window.date);
  const season = await fetchSeasonFixtures(compSeason);

  const details = new Map<number, PulseFixtureDetail>();
  for (const fixture of contest.fixtures) {
    const pulse = matchPulseFixture(fixture, season);
    const detail = await getJson<PulseFixtureDetail>(`${apiRoot}/fixtures/${pulse.id}?altIds=true`);
    details.set(fixture.id, detail);
  }

  const { slate, unmatched } = buildLineupSlate(
    profileId,
    profile.window.date,
    contest.fixtures,
    snapshot.players,
    details,
  );
  const output = path.join(repoRoot, 'data/lineups', `${profileId}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(slate, null, 2)}\n`);

  const covered = slate.fixtureCoverage.filter((fixture) => fixture.covered).length;
  const starters = slate.players.filter((player) => player.status === 'starter').length;
  const bench = slate.players.filter((player) => player.status === 'bench').length;
  console.log(`[Lineups ETL] Wrote ${covered}/${slate.fixtureCoverage.length} covered fixture(s) (${starters} starters, ${bench} bench) to ${path.relative(repoRoot, output)}.`);
  if (unmatched.length > 0) {
    console.log(`[Lineups ETL] ${unmatched.length} pulselive name(s) did not match the FPL pool (out-of-squad or matcher miss):`);
    for (const row of unmatched) console.log(`  ${row.side}: ${row.name} (#${row.shirt})`);
  }
}

main().catch((error) => {
  console.error('[Lineups ETL] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
