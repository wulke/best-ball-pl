/**
 * Understat key-passes cross-check (best-effort, `npm run fbref`).
 *
 * The PL stats API is the passing source of truth (FBref's passing page is
 * JS-populated and currently empty), so its key-pass numbers get validated
 * each refresh against a fully independent pipeline: Understat re-processes
 * the Opta event feed with its own definitions. `validatePlPassing` matches
 * players by name across the two datasets and reports the log-correlation,
 * the median count ratio (definitional offset is expected and stable), and
 * minutes agreement. Any drift (low correlation / ratio swing) warns loudly.
 *
 * Not a data source — nothing is cached or committed; if Understat is down
 * the run just logs a note and continues.
 */

import { launchLocalChromium } from './fbref.js';
import { norm } from './match.js';
import type { PlParsed } from './pl-stats.js';

export type UnderstatPlayerRow = {
  name: string;
  keyPasses: number;
  minutes: number;
};

export type UnderstatParsed = {
  generated_at: string;
  seasons: Record<string, UnderstatPlayerRow[]>;
};

const UNDERSTAT_SEASONS: Record<string, number> = { '2025/26': 2025, '2024/25': 2024 };

/** Pull one Understat league season's per-player key passes via headless
 *  Chromium (the data endpoint needs browser context). */
async function fetchUnderstatSeason(seasonYear: number): Promise<UnderstatPlayerRow[]> {
  const browser = await launchLocalChromium();
  try {
    const page = await browser.newPage();
    await page.goto(`https://understat.com/league/EPL/${seasonYear}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    // The league table data loads via /getLeagueData/EPL/<year> after the
    // page script runs; wait for it to land in window.playersData.
    await page.waitForTimeout(9_000);
    const players = await page.evaluate(() => {
      const data = (window as unknown as { playersData?: Record<string, string>[] }).playersData ?? [];
      return data.map((p) => ({
        name: p.player_name ?? '',
        keyPasses: Number.parseFloat(p.key_passes ?? '0') || 0,
        minutes: Number.parseFloat(p.time ?? '0') || 0,
      }));
    });
    return players.filter((p) => p.name);
  } finally {
    await browser.close();
  }
}

export async function fetchUnderstatStats(
  onLog: (msg: string) => void = console.log,
): Promise<UnderstatParsed> {
  const seasons: Record<string, UnderstatPlayerRow[]> = {};
  for (const [label, year] of Object.entries(UNDERSTAT_SEASONS)) {
    seasons[label] = await fetchUnderstatSeason(year);
    onLog(`[fbref] Understat EPL ${year}: ${seasons[label].length} players`);
  }
  return { generated_at: new Date().toISOString(), seasons };
}

export type SeasonValidation = {
  season: string;
  matched: number;
  /** Pearson r on log(keyPasses + 1). */
  correlation: number;
  /** median min(us,pl)/max(us,pl) — stable definitional offset expected. */
  medianRatio: number;
  /** median |usMin − plMin| / plMin. */
  medianMinutesDiff: number;
};

export type PlValidationReport = {
  seasons: SeasonValidation[];
  ok: boolean;
  notes: string[];
};

const MIN_MATCH_MINUTES = 900; // only established players with real volume
const R_CORR_THRESHOLD = 0.9;
const RATIO_RANGE: [number, number] = [0.5, 2.0];
const MINUTES_TOLERANCE = 0.05;

export function validatePlPassing(pl: PlParsed, us: UnderstatParsed): PlValidationReport {
  const seasons: SeasonValidation[] = [];
  const notes: string[] = [];
  for (const [label, plRows] of Object.entries(pl.seasons)) {
    const usRows = us.seasons[label] ?? [];
    if (!plRows.length || !usRows.length) {
      notes.push(`${label}: missing Understat or PL rows — skipped`);
      continue;
    }
    const usByNorm = new Map(usRows.map((r) => [norm(r.name), r]));
    const pairs: { name: string; ukp: number; pkp: number; umin: number; pmin: number }[] = [];
    for (const pr of plRows) {
      const ur = usByNorm.get(norm(pr.name));
      if (!ur) continue;
      if (ur.minutes <= MIN_MATCH_MINUTES) continue;
      const pkp = pr.values.keyPasses ?? 0;
      if (ur.keyPasses <= 0 || pkp <= 0) continue;
      pairs.push({ name: pr.name, ukp: ur.keyPasses, pkp, umin: ur.minutes, pmin: pr.minutes });
    }
    if (pairs.length < 30) {
      notes.push(`${label}: only ${pairs.length} matched pairs — skipping correlation`);
      continue;
    }
    const n = pairs.length;
    const lx = pairs.map((p) => Math.log(p.ukp + 1));
    const ly = pairs.map((p) => Math.log(p.pkp + 1));
    const mx = lx.reduce((a, b) => a + b, 0) / n;
    const my = ly.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i++) {
      num += (lx[i] - mx) * (ly[i] - my);
      dx += (lx[i] - mx) ** 2;
      dy += (ly[i] - my) ** 2;
    }
    const correlation = num / Math.sqrt(dx * dy);
    const ratios = pairs.map((p) => Math.min(p.ukp, p.pkp) / Math.max(p.ukp, p.pkp)).sort((a, b) => a - b);
    const medianRatio = ratios[Math.floor(n / 2)];
    const minDiffs = pairs
      .map((p) => (p.pmin > 0 ? Math.abs(p.umin - p.pmin) / p.pmin : 0))
      .sort((a, b) => a - b);
    const medianMinutesDiff = minDiffs[Math.floor(n / 2)];
    seasons.push({ season: label, matched: n, correlation, medianRatio, medianMinutesDiff });
    if (correlation < R_CORR_THRESHOLD) {
      notes.push(`${label}: key-pass correlation r=${correlation.toFixed(3)} < ${R_CORR_THRESHOLD} — PL API data suspicious`);
    }
    if (medianRatio < RATIO_RANGE[0] || medianRatio > RATIO_RANGE[1]) {
      notes.push(`${label}: key-pass ratio ${medianRatio.toFixed(2)} outside ${RATIO_RANGE.join('–')} — definitional drift?`);
    }
    if (medianMinutesDiff > MINUTES_TOLERANCE) {
      notes.push(`${label}: minutes differ by ${(medianMinutesDiff * 100).toFixed(1)}% > ${MINUTES_TOLERANCE * 100}% — check PL timePlayed`);
    }
  }
  return { seasons, ok: notes.length === 0, notes };
}

/** Compact one-line status per season for the run log. */
export function summarizeValidation(report: PlValidationReport): string {
  return report.seasons
    .map((s) => `${s.season} r=${s.correlation.toFixed(3)} ratio=${s.medianRatio.toFixed(2)} min±${(s.medianMinutesDiff * 100).toFixed(1)}% (${s.matched})`)
    .join('; ');
}
