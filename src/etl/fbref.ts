/**
 * FBref parser — reads manually saved league-page HTML from data/fbref-raw/
 * and extracts per-player volume stats (Sh/SoT, KP, Crs, TklW, Cmp, GK W).
 *
 * Why manual saves: FBref is Cloudflare-fronted with no API; automated fetches
 * (curl, headless AND headed Playwright) are challenged. A normal browser
 * passes, so pages are saved by hand (see data/fbref-raw/README.md) and
 * parsed locally — zero network here. Parsed output is committed as
 * data/fbref.json, so the repo never needs the HTML again.
 *
 * Parsing runs the saved HTML through a local headless Chromium page
 * (Playwright) purely for DOM APIs — no requests are made.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const FBREF_RAW_DIR = path.join(REPO_ROOT, 'data/fbref-raw');
export const FBREF_JSON_PATH = path.join(REPO_ROOT, 'data/fbref.json');

/** FBref season (URL form) → FPL season label. */
export const SEASON_LABELS: Record<string, string> = {
  '2025-2026': '2025/26',
  '2024-2025': '2024/25',
};

/** The volume fields the model needs, by source page. */
export type FbrefField =
  | 'shots'
  | 'shotsOnTarget'
  | 'keyPasses'
  | 'crosses'
  | 'tacklesWon'
  | 'passesCompleted'
  | 'gkWins';

type PageSpec = {
  /** Raw-filename suffix: `<season>_<page>.html`. */
  file: string;
  /** field → candidate `data-stat` names (first hit in the table wins). */
  dataStats: Partial<Record<FbrefField, string[]>>;
  /** field → exact thead label (last header row), fallback when data-stat misses. */
  headers: Partial<Record<FbrefField, string>>;
};

/** Column guesses from FBref's documented data-stat vocabulary; header text
 *  (SoT, KP, Crs, TklW, Cmp, W) is the fallback if names drift. */
const PAGE_SPECS: PageSpec[] = [
  {
    file: 'shooting',
    dataStats: { shots: ['shots'], shotsOnTarget: ['shots_on_target'] },
    headers: { shots: 'Sh', shotsOnTarget: 'SoT' },
  },
  {
    file: 'passing',
    dataStats: {
      passesCompleted: ['passes_completed'],
      keyPasses: ['assisted_shots', 'key_passes'],
    },
    headers: { passesCompleted: 'Cmp', keyPasses: 'KP' },
  },
  {
    file: 'passing_types',
    dataStats: { crosses: ['crosses'] },
    headers: { crosses: 'Crs' },
  },
  {
    file: 'defense',
    dataStats: { tacklesWon: ['tackles_won'] },
    headers: { tacklesWon: 'TklW' },
  },
  {
    file: 'keeper',
    dataStats: { gkWins: ['gk_wins'] },
    headers: { gkWins: 'W' },
  },
];

export type FbrefPlayerRow = {
  /** FBref display name (footnote markers stripped). */
  name: string;
  /** Squad short name ("Manchester City") — null for the combined multi-club row. */
  squad: string | null;
  minutes: number;
  n90: number;
  values: Partial<Record<FbrefField, number>>;
};

export type FbrefParsed = {
  generated_at: string;
  /** FPL season label → page file → rows. */
  seasons: Record<string, Record<string, FbrefPlayerRow[]>>;
};

// ---------------------------------------------------------------------------
// Local Chromium (no network)
// ---------------------------------------------------------------------------

async function launchLocalChromium() {
  try {
    return await chromium.launch();
  } catch {
    // The shared ~/Library/Caches/ms-playwright is root-owned on this machine;
    // fall back to the project-local install under .pw-browsers/.
    const dir = path.join(REPO_ROOT, '.pw-browsers');
    if (!fs.existsSync(dir)) throw new Error(
      'No usable Playwright Chromium. Run: PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers npx playwright install chromium',
    );
    const candidates: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'Chromium' || /Google Chrome for Testing$/.test(e.name)) candidates.push(p);
      }
    };
    walk(dir);
    if (!candidates.length) throw new Error('No Chromium binary under .pw-browsers/');
    return chromium.launch({ executablePath: candidates[0] });
  }
}

// ---------------------------------------------------------------------------
// Table extraction
// ---------------------------------------------------------------------------

function parseNumber(text: string): number {
  const t = text.replace(/,/g, '').trim();
  if (t === '' || t === '-') return 0;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

type ExtractedTable = {
  rows: FbrefPlayerRow[];
  /** data-stat names present — for diagnostics when a field is missing. */
  availableStats: string[];
  /** thead labels (last header row) — for diagnostics. */
  availableHeaders: string[];
};

async function extractTable(html: string, spec: PageSpec): Promise<ExtractedTable> {
  const browser = await launchLocalChromium();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.evaluate((specInner: PageSpec) => {
      const table = document.querySelector('table[id^="stats_"]');
      if (!table) return { rows: [], availableStats: [], availableHeaders: [], missing: 'table' } as ExtractedTable & { missing?: string };

      // Align cells with the LAST header row's labels (FBref stacks over-headers).
      const headerRows = table.querySelectorAll('thead tr');
      const labels: string[] = [];
      if (headerRows.length) {
        for (const th of headerRows[headerRows.length - 1].querySelectorAll('th')) {
          labels.push((th.getAttribute('aria-label') ?? th.textContent ?? '').trim());
        }
      }

      // Resolve each needed field to a column index: prefer data-stat, else label.
      const wantedFields = Object.keys(specInner.dataStats) as FbrefField[];
      const colIndexByField = new Map<FbrefField, number>();
      const firstBodyRow = table.querySelector('tbody tr');
      if (firstBodyRow) {
        const tds = [...firstBodyRow.querySelectorAll('td')];
        for (const field of wantedFields) {
          const stats = specInner.dataStats[field] ?? [];
          let idx = tds.findIndex((td) => stats.includes(td.getAttribute('data-stat') ?? ''));
          if (idx === -1) {
            const label = specInner.headers[field];
            if (label) idx = labels.findIndex((l) => l === label);
          }
          if (idx !== -1) colIndexByField.set(field, idx);
        }
      }

      const rows: FbrefPlayerRow[] = [];
      for (const tr of table.querySelectorAll('tbody tr')) {
        const th = tr.querySelector('th[data-stat="player"]');
        const tds = [...tr.querySelectorAll('td')];
        if (!th || tds.length === 0) continue;
        const name = (th.textContent ?? '').replace(/[*†]/g, '').trim();
        if (!name) continue;
        const squadRaw = tds.find((td) => td.getAttribute('data-stat') === 'squad')?.textContent?.trim() ?? '';
        const minutesText = tds.find((td) => td.getAttribute('data-stat') === 'minutes')?.textContent ?? '0';
        const n90Text = tds.find((td) => td.getAttribute('data-stat') === 'minutes_90s')?.textContent ?? '0';
        const values: Partial<Record<FbrefField, number>> = {};
        for (const [field, idx] of colIndexByField) {
          const raw = tds[idx]?.textContent ?? '';
          const t = raw.replace(/,/g, '').trim();
          if (t === '' || t === '-') continue;
          const n = Number.parseFloat(t);
          if (Number.isFinite(n)) values[field] = n;
        }
        rows.push({
          name,
          squad: squadRaw === '' || squadRaw === '2 clubs' || squadRaw === '3 clubs' ? null : squadRaw,
          minutes: Number.parseFloat(minutesText.replace(/,/g, '')) || 0,
          n90: Number.parseFloat(n90Text) || 0,
          values,
        });
      }

      return {
        rows,
        availableStats: [...new Set([...table.querySelectorAll('td[data-stat]')].map((td) => td.getAttribute('data-stat') ?? ''))],
        availableHeaders: labels,
      } as ExtractedTable;
    }, spec);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Public entry: parse every file that exists in data/fbref-raw/
// ---------------------------------------------------------------------------

export async function parseFbrefRawDir(onLog: (msg: string) => void = console.log): Promise<FbrefParsed> {
  const parsed: FbrefParsed = { generated_at: new Date().toISOString(), seasons: {} };
  const missing: string[] = [];

  for (const [seasonUrl, seasonLabel] of Object.entries(SEASON_LABELS)) {
    parsed.seasons[seasonLabel] = {};
    for (const spec of PAGE_SPECS) {
      const file = path.join(FBREF_RAW_DIR, `${seasonUrl}_${spec.file}.html`);
      if (!fs.existsSync(file)) {
        missing.push(path.basename(file));
        continue;
      }
      const html = fs.readFileSync(file, 'utf8');
      const table = await extractTable(html, spec);
      if (!table.rows.length) {
        throw new Error(
          `No stats table found in ${path.basename(file)} — the page may not have loaded before saving ` +
            `(or Cloudflare's "Just a moment…" wall was saved). Re-save that page. Available headers: ${table.availableHeaders.join(', ')}`,
        );
      }
      const wanted = Object.keys(spec.dataStats) as FbrefField[];
      const resolved = wanted.filter((f) => table.rows.some((r) => f in r.values));
      if (resolved.length === 0) {
        throw new Error(
          `None of ${wanted.join('/')} found in ${path.basename(file)}. data-stats present: ${table.availableStats.slice(0, 40).join(', ')}; headers: ${table.availableHeaders.join(' | ')}`,
        );
      }
      const unresolved = wanted.filter((f) => !resolved.includes(f));
      if (unresolved.length) onLog(`[fbref] warn: ${unresolved.join('/')} unresolved in ${spec.file}`);
      parsed.seasons[seasonLabel][spec.file] = table.rows;
      onLog(`[fbref] ${seasonLabel} ${spec.file}: ${table.rows.length} rows (fields: ${resolved.join(', ')})`);
    }
  }

  if (missing.length) {
    onLog(`[fbref] missing raw pages (skipped): ${missing.join(', ')}`);
  }
  return parsed;
}

export function readFbrefCache(): FbrefParsed | null {
  if (!fs.existsSync(FBREF_JSON_PATH)) return null;
  return JSON.parse(fs.readFileSync(FBREF_JSON_PATH, 'utf8')) as FbrefParsed;
}

export function writeFbrefCache(data: FbrefParsed): void {
  fs.writeFileSync(FBREF_JSON_PATH, `${JSON.stringify(data, null, 1)}\n`);
}
