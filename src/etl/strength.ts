/**
 * Results-driven opponent strength, ETL side (#92): builds the snapshot's
 * `strength` section — per-club season-to-date attack/concession sums on one
 * source's scale — from free in-season signals
 * (docs/research/opponent-strength-signals.md).
 *
 * Source chain, best-first, one per run (never mixed within a section — a
 * mixed-scale estimate would normalize lies):
 *
 *  1. Understat per-match team npxG/npxGA (`window.teamsData` on the league
 *     page, read through the same Playwright path the key-pass validation
 *     uses). Two traps handled: season-rollover lag (the `<startYear>` URL
 *     can still serve last season on opening day — probe both years and
 *     select by match dates, never by URL year) and scale (Understat xG runs
 *     ~11% hot league-wide — the section stores the source's own league
 *     mean, and multipliers are scale-free ratios).
 *  2. Fixture final scores (GF/GA from `homeScore`/`awayScore`, always
 *     current once a match finishes). Noisier — the model shrinks it harder
 *     (goal-scale constants in config.ts).
 *
 * Both builders also retain the per-match rows (#174, `matches` in the
 * snapshot section): one {date, home, attack, concede} per played
 * team-match, chronological, on the section's own scale — the sufficient
 * statistics recent form (#176), venue splits (#177), and walk-forward
 * truncation (#175) derive from. The sums stay the primary contract.
 *
 * The section is omitted while no current-season match has been played
 * (pre-season parity: the model runs its FDR-only path bit-for-bit). If
 * matches ARE played and neither source yields aggregates, the run fails —
 * never silently project a stale-opponent sheet.
 *
 * Not yet implemented (research verdict: fallback-only): FPL summed player
 * xG as a mid-tier fallback — GW-gated and 1dp-rounded; revisit after the
 * GW1–3 cross-check against Understat club xG.
 */

import { launchLocalChromium } from './fbref.js';
import type { SnapshotFixture, SnapshotStrength, StrengthClubSums, StrengthMatch } from './types.js';

/** Understat team titles → FPL short codes. Exact-title keys the page is
 *  known to use, plus common variants matched case/diacritic-insensitively.
 *  Codes outside the current 20-club pool are harmless (the section is
 *  pruned to calendar clubs). */
const UNDERSTAT_TEAM_TO_FPL: Record<string, string> = {
  Arsenal: 'ARS',
  'Aston Villa': 'AVL',
  Bournemouth: 'BOU',
  Brentford: 'BRE',
  Brighton: 'BHA',
  'Brighton and Hove Albion': 'BHA',
  Burnley: 'BUR',
  Chelsea: 'CHE',
  Coventry: 'COV',
  'Coventry City': 'COV',
  'Crystal Palace': 'CRY',
  Everton: 'EVE',
  Fulham: 'FUL',
  Hull: 'HUL',
  'Hull City': 'HUL',
  Ipswich: 'IPS',
  'Ipswich Town': 'IPS',
  Leeds: 'LEE',
  'Leeds United': 'LEE',
  Leicester: 'LEI',
  'Leicester City': 'LEI',
  Liverpool: 'LIV',
  'Manchester City': 'MCI',
  'Manchester United': 'MUN',
  Newcastle: 'NEW',
  'Newcastle United': 'NEW',
  Norwich: 'NOR',
  'Norwich City': 'NOR',
  'Nottingham Forest': 'NFO',
  Southampton: 'SOU',
  'Southampton FC': 'SOU',
  Sunderland: 'SUN',
  Tottenham: 'TOT',
  'Tottenham Hotspur': 'TOT',
  Watford: 'WAT',
  'West Ham': 'WHU',
  'West Ham United': 'WHU',
  Wolves: 'WOL',
  'Wolverhampton Wanderers': 'WOL',
};

function normTitle(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

const NORM_TEAM_TO_FPL = new Map(Object.entries(UNDERSTAT_TEAM_TO_FPL).map(([k, v]) => [normTitle(k), v]));

function understatTeamToFpl(title: string): string | null {
  return UNDERSTAT_TEAM_TO_FPL[title] ?? NORM_TEAM_TO_FPL.get(normTitle(title)) ?? null;
}

type UnderstatHistoryRow = {
  h_a?: string;
  date?: string;
  npxG?: string;
  npxGA?: string;
  xG?: string;
  xGA?: string;
};

export type UnderstatTeamsData = Record<string, { title: string; history: UnderstatHistoryRow[] }>;

/** One league page's played-match dates — the rollover-probe evidence. */
export type UnderstatPage = {
  startYear: number;
  teamsData: UnderstatTeamsData;
  /** ISO-ish "YYYY-MM-DD HH:MM:SS" per played match. */
  playedDates: string[];
};

type LooseRow = (string | number | boolean | null | undefined)[];
type LooseDateRow = Record<string, unknown>;

function isResult(value: unknown): boolean {
  return value === true || value === 'yes';
}

function datetimeFrom(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value : null;
}

/** Parse played match dates from both historical tuple rows and Understat's
 * current object rows. This remains a supplemental rollover signal: the
 * section's own teamsData rows are also probed below. */
export function parseDateRows(datesData: unknown): string[] {
  if (!Array.isArray(datesData)) return [];
  const dates: string[] = [];
  for (const rawRow of datesData) {
    if (Array.isArray(rawRow)) {
      const row = rawRow as LooseRow;
      if (!isResult(row[1])) continue;
      // Legacy shape: [id, isResult, home, away, goals, xG, datetime, forecast…]
      // — datetime is the first date-shaped string; scan rather than trust index.
      const datetime = row.map(datetimeFrom).find((value): value is string => value != null);
      if (datetime) dates.push(datetime);
      continue;
    }
    if (!rawRow || typeof rawRow !== 'object') continue;
    const row = rawRow as LooseDateRow;
    if (!isResult(row.isResult)) continue;
    const datetime = datetimeFrom(row.datetime);
    if (datetime) dates.push(datetime);
  }
  return dates;
}

function parseTeamsData(teamsData: unknown): UnderstatTeamsData {
  const out: UnderstatTeamsData = {};
  if (!teamsData || typeof teamsData !== 'object') return out;
  for (const [id, team] of Object.entries(teamsData as Record<string, unknown>)) {
    if (!team || typeof team !== 'object') continue;
    const t = team as { title?: unknown; history?: unknown };
    if (typeof t.title !== 'string' || !Array.isArray(t.history)) continue;
    out[id] = { title: t.title, history: t.history as UnderstatHistoryRow[] };
  }
  return out;
}

/** The same played-row evidence that understatStrengthFromPage aggregates.
 * datesData has changed shape before, so teamsData is the durable rollover
 * probe; every valid npxG/xG row carrying a date proves this page's season. */
export function playedDatesFromTeamsData(teamsData: UnderstatTeamsData): string[] {
  const dates = new Set<string>();
  for (const team of Object.values(teamsData)) {
    for (const row of team.history) {
      const attack = Number.parseFloat(row.npxG ?? row.xG ?? '');
      if (!Number.isFinite(attack)) continue;
      const date = datetimeFrom(row.date);
      if (date) dates.add(date);
    }
  }
  return [...dates];
}

/** Load the league pages for the candidate start-years in ONE browser
 *  session (the page JS XHRs `teamsData`/`datesData` into window scope after
 *  load — same wait the player validation uses). */
export async function fetchUnderstatLeaguePages(
  startYears: number[],
  onLog: (msg: string) => void = console.log,
): Promise<UnderstatPage[]> {
  const browser = await launchLocalChromium();
  try {
    const pages: UnderstatPage[] = [];
    for (const startYear of startYears) {
      const page = await browser.newPage();
      try {
        await page.goto(`https://understat.com/league/EPL/${startYear}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForTimeout(9_000);
        const raw = await page.evaluate(() => {
          const w = window as unknown as { teamsData?: unknown; datesData?: unknown };
          return { teamsData: w.teamsData ?? null, datesData: w.datesData ?? null };
        });
        const teamsData = parseTeamsData(raw.teamsData);
        const dateRowsDates = parseDateRows(raw.datesData);
        const teamsDataDates = playedDatesFromTeamsData(teamsData);
        if (dateRowsDates.length === 0 && teamsDataDates.length > 0) {
          onLog(`[strength] WARNING: Understat EPL ${startYear} datesData yielded 0 played matches while teamsData yielded ${teamsDataDates.length}; datesData shape may have drifted.`);
        }
        const playedDates = [...new Set([...dateRowsDates, ...teamsDataDates])];
        onLog(`[strength] Understat EPL ${startYear}: ${Object.keys(teamsData).length} teams, ${playedDates.length} played matches`);
        pages.push({ startYear, teamsData, playedDates });
      } finally {
        await page.close();
      }
    }
    return pages;
  } finally {
    await browser.close();
  }
}

/** The rollover probe: the page to trust is the one with played matches
 *  dated inside the current season — never the URL year (opening-day lag
 *  serves last season's data under this year's URL). */
export function selectCurrentSeasonPage(pages: UnderstatPage[], seasonStart: string): UnderstatPage | null {
  for (const page of pages) {
    if (page.playedDates.some((d) => d >= seasonStart)) return page;
  }
  return null;
}

/** Aggregate a selected page's teamsData into the strength section. Returns
 *  null when the page is incomplete for the calendar (unknown/mismatched
 *  club set) — the caller falls to the next source. */
export function understatStrengthFromPage(
  page: UnderstatPage,
  calendarClubs: ReadonlySet<string>,
): SnapshotStrength | null {
  const clubs: Record<string, StrengthClubSums> = {};
  const matches: Record<string, StrengthMatch[]> = {};
  let totalAttack = 0;
  let totalN = 0;
  let through = '';
  const mapped = new Set<string>();
  for (const team of Object.values(page.teamsData)) {
    const code = understatTeamToFpl(team.title);
    if (!code) continue;
    mapped.add(code);
    let n = 0;
    let attack = 0;
    let concede = 0;
    const clubMatches: StrengthMatch[] = [];
    for (const row of team.history) {
      const rowAttack = Number.parseFloat(row.npxG ?? row.xG ?? '');
      const rowConcede = Number.parseFloat(row.npxGA ?? row.xGA ?? '');
      if (!Number.isFinite(rowAttack) || !Number.isFinite(rowConcede)) continue;
      n += 1;
      attack += rowAttack;
      concede += rowConcede;
      if (row.date && row.date > through) through = row.date;
      // Per-match retention (#174): same finite-signal criterion as the
      //  sums, but a date is load-bearing here (recency windows sort by
      //  it) — a dateless played row still counts in the sums above,
      //  it just isn't retained per-match.
      if (row.date) {
        clubMatches.push({
          date: row.date,
          home: row.h_a === 'h',
          attack: round3(rowAttack),
          concede: round3(rowConcede),
        });
      }
    }
    totalAttack += attack;
    totalN += n;
    clubs[code] = { n, attack: round3(attack), concede: round3(concede) };
    matches[code] = clubMatches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  for (const club of calendarClubs) {
    if (!mapped.has(club)) return null; // incomplete page — fall through
  }
  if (totalN === 0) return null;
  return {
    source: 'understat',
    leagueAttackPerMatch: round3(totalAttack / totalN),
    through: through || `${page.startYear}-07-01 00:00:00`,
    clubs: pruneToCalendar(clubs, calendarClubs),
    matches: pruneToCalendar(matches, calendarClubs),
  };
}

/** Fallback: final scores are always current once a match finishes — GF/GA
 *  per club. Noisier than xG (the model shrinks goal-scale sums harder). */
export function fixtureGoalsStrength(fixtures: SnapshotFixture[]): SnapshotStrength | null {
  const clubs: Record<string, StrengthClubSums> = {};
  const matches: Record<string, StrengthMatch[]> = {};
  let totalGoals = 0;
  let totalN = 0;
  let through = '';
  for (const f of fixtures) {
    if (f.homeScore == null || f.awayScore == null) continue;
    const home = (clubs[f.home] ??= { n: 0, attack: 0, concede: 0 });
    const away = (clubs[f.away] ??= { n: 0, attack: 0, concede: 0 });
    home.n += 1;
    home.attack += f.homeScore;
    home.concede += f.awayScore;
    away.n += 1;
    away.attack += f.awayScore;
    away.concede += f.homeScore;
    totalN += 2;
    totalGoals += f.homeScore + f.awayScore;
    if (f.kickoff > through) through = f.kickoff;
    // Mirrored per-match rows on the goal scale (#174) — kickoff as date.
    (matches[f.home] ??= []).push({ date: f.kickoff, home: true, attack: f.homeScore, concede: f.awayScore });
    (matches[f.away] ??= []).push({ date: f.kickoff, home: false, attack: f.awayScore, concede: f.homeScore });
  }
  if (totalN === 0) return null;
  const rounded = Object.fromEntries(
    Object.entries(clubs).map(([code, c]) => [code, { n: c.n, attack: round3(c.attack), concede: round3(c.concede) }]),
  );
  const sortedMatches = Object.fromEntries(
    Object.entries(matches).map(([code, rows]) => [
      code,
      rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    ]),
  );
  return {
    source: 'fixture-goals',
    leagueAttackPerMatch: round3(totalGoals / totalN),
    through,
    clubs: rounded,
    matches: sortedMatches,
  };
}

function pruneToCalendar<T>(clubs: Record<string, T>, calendarClubs: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(clubs).filter(([code]) => calendarClubs.has(code)));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Current-season start (July 1) from the calendar's earliest kickoff. */
export function seasonStartFrom(fixtures: SnapshotFixture[]): string {
  const min = fixtures.reduce((earliest, f) => (f.kickoff < earliest ? f.kickoff : earliest), fixtures[0]?.kickoff ?? '');
  const year = Number.parseInt(min.slice(0, 4), 10);
  const month = Number.parseInt(min.slice(5, 7), 10);
  const startYear = Number.isFinite(year) ? (month >= 7 ? year : year - 1) : new Date().getUTCFullYear();
  return `${startYear}-07-01`;
}

/** The section builder the ETL calls: Understat first (probe both years,
 *  select by dates), fixture scores as fallback, omitted while nothing is
 *  played, hard failure when matches are played but nothing yields. */
export async function buildStrengthSection(
  fixtures: SnapshotFixture[],
  onLog: (msg: string) => void = console.log,
): Promise<SnapshotStrength | undefined> {
  const played = fixtures.filter((f) => f.homeScore != null && f.awayScore != null).length;
  if (played === 0) {
    onLog('[strength] No played fixtures yet — strength section omitted (FDR-only parity path).');
    return undefined;
  }
  const calendarClubs = new Set(fixtures.flatMap((f) => [f.home, f.away]));
  const seasonStart = seasonStartFrom(fixtures);
  try {
    const startYear = Number.parseInt(seasonStart.slice(0, 4), 10);
    const pages = await fetchUnderstatLeaguePages([startYear, startYear - 1], onLog);
    const page = selectCurrentSeasonPage(pages, seasonStart);
    if (page) {
      const section = understatStrengthFromPage(page, calendarClubs);
      if (section) {
        const clubList = Object.entries(section.clubs)
          .map(([code, c]) => `${code}(${c.n})`)
          .join(' ');
        onLog(`[strength] Understat selected (${page.startYear} page, through ${section.through}): ${clubList}`);
        return section;
      }
      onLog('[strength] Understat page incomplete for the calendar — falling back to fixture scores.');
    } else {
      onLog('[strength] No Understat page has current-season matches yet — falling back to fixture scores.');
    }
  } catch (error) {
    onLog(`[strength] Understat fetch failed (${error instanceof Error ? error.message : String(error)}) — falling back to fixture scores.`);
  }
  const fallback = fixtureGoalsStrength(fixtures);
  if (!fallback) {
    throw new Error(
      `${played} fixture(s) played but no strength source yielded aggregates — refusing to project with stale opponents.`,
    );
  }
  onLog(`[strength] Fixture-scores fallback (through ${fallback.through}, μ ${fallback.leagueAttackPerMatch}/team-match).`);
  return fallback;
}
