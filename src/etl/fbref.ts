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
  | 'gkWins'
  | 'unusedSubs';

type PageSpec = {
  /** Canonical URL slug for this page type on FBref ("shooting", "passing",
   *  "passing_types", "defense", "keepers", "playingtime") — used to
   *  identify saved files by their content, since browsers name the files
   *  however they like. */
  slug: string;
  /** Legacy raw-filename suffix: `<season>_<page>.html` (still honoured as a
   *  fallback when the canonical URL can't be read). Also the cache key. */
  file: string;
  /** FBref DOM table id suffix (usually == file; "playingtime" →
   *  "stats_playing_time"). The player table is extracted by this id. */
  tableId?: string;
  /** field → candidate `data-stat` names (first hit in the table wins). */
  dataStats: Partial<Record<FbrefField, string[]>>;
  /** field → thead labels (last header row), fallback when data-stat misses.
   *  Both short column forms (SoT, KP, Crs) and full display labels
   *  ("Shots on Target") are accepted — FBref varies by page and season. */
  headers: Partial<Record<FbrefField, string[]>>;
};

/** Column guesses from FBref's documented data-stat vocabulary; thead labels
 *  (SoT, KP, Crs, TklW, Cmp, W) are the fallback if names drift. */
const PAGE_SPECS: PageSpec[] = [
  {
    slug: 'shooting',
    file: 'shooting',
    dataStats: { shots: ['shots'], shotsOnTarget: ['shots_on_target'] },
    headers: { shots: ['Sh', 'Shots Total'], shotsOnTarget: ['SoT', 'Shots on Target'] },
  },
  {
    slug: 'passing',
    file: 'passing',
    dataStats: {
      passesCompleted: ['passes_completed'],
      keyPasses: ['assisted_shots', 'key_passes'],
    },
    headers: { passesCompleted: ['Cmp', 'Passes Completed'], keyPasses: ['KP', 'Key Passes'] },
  },
  {
    slug: 'passing_types',
    file: 'passing_types',
    dataStats: { crosses: ['crosses'] },
    headers: { crosses: ['Crs', 'Crosses'] },
  },
  {
    slug: 'defense',
    file: 'defense',
    dataStats: { tacklesWon: ['tackles_won'] },
    headers: { tacklesWon: ['TklW', 'Tackles Won'] },
  },
  {
    slug: 'keepers',
    file: 'keeper',
    dataStats: { gkWins: ['gk_wins'] },
    headers: { gkWins: ['W', 'Wins'] },
  },
  {
    slug: 'playingtime',
    file: 'playingtime',
    tableId: 'playing_time',
    dataStats: { unusedSubs: ['unused_subs'] },
    headers: { unusedSubs: ['Unused Subs'] },
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
  // FBref delivers its player tables inside an HTML comment block (a script
  // swaps them in on load), so the raw browser DOM only shows the squad
  // summary tables. Pull the `stats_<page>` table straight out of the raw
  // HTML instead; fall back to the full page when the regex misses.
  const playerTableMatch = html.match(
    new RegExp(`<table[^>]*id="stats_${spec.tableId ?? spec.file}"[^>]*>[\\s\\S]*?</table>`),
  );
  const content = playerTableMatch
    ? `<!doctype html><html><body>${playerTableMatch[0]}</body></html>`
    : html;
  const browser = await launchLocalChromium();
  try {
    const page = await browser.newPage();
    await page.setContent(content, { waitUntil: 'domcontentloaded' });
    return await page.evaluate((specInner: PageSpec) => {
      // Pick the PLAYER table. FBref pages also carry squad-summary tables
      // (stats_squads_*) whose rows have no player cell — skip those. The
      // player cell is a <td data-stat="player"> (the <th> is the ranker).
      const tables = [...document.querySelectorAll('table[id^="stats_"]')];
      const table = tables.find((t) => t.querySelector('tbody tr [data-stat="player"]'));
      if (!table) return { rows: [], availableStats: [], availableHeaders: [], missing: 'player-table' } as ExtractedTable & { missing?: string };

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
            const candidates = specInner.headers[field] ?? [];
            if (candidates.length) idx = labels.findIndex((l) => candidates.includes(l));
          }
          if (idx !== -1) colIndexByField.set(field, idx);
        }
      }

      const rows: FbrefPlayerRow[] = [];
      for (const tr of table.querySelectorAll('tbody tr')) {
        const playerCell = tr.querySelector('[data-stat="player"]');
        const tds = [...tr.querySelectorAll('td')];
        if (!playerCell || tds.length === 0) continue;
        const name = (playerCell.textContent ?? '').replace(/[*†]/g, '').trim();
        if (!name) continue;
        const squadRaw =
          tds.find((td) => ['squad', 'team'].includes(td.getAttribute('data-stat') ?? ''))?.textContent?.trim() ?? '';
        // FBref's player tables sometimes drop the raw minutes column; 90s × 90
        // is the same number modulo display rounding (±45 min, below the QA
        // threshold of 90).
        const minutesText = tds.find((td) => td.getAttribute('data-stat') === 'minutes')?.textContent;
        const n90Text = tds.find((td) => td.getAttribute('data-stat') === 'minutes_90s')?.textContent ?? '0';
        const minutes =
          minutesText != null && minutesText.trim() !== ''
            ? Number.parseFloat(minutesText.replace(/,/g, ''))
            : Number.parseFloat(n90Text.replace(/,/g, '')) * 90;
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
          minutes: Number.isFinite(minutes) ? minutes : 0,
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
// Saved-file reading (.html + .mhtml)
// ---------------------------------------------------------------------------

/** Extract the main HTML document from a Chrome "Web Page, Single File"
 *  (.mhtml) save. Needed because FBref's passing table is JS-populated after
 *  load — "HTML Only" saves the pre-JS server document (empty cells), while
 *  the single-file format captures the rendered DOM. Returns null when the
 *  file isn't a parseable multipart MHTML (callers fall back to raw content). */
function readMhtmlHtml(filePath: string): string | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Chrome folds the MIME header across lines (boundary= lands on its own
  // line), so grab the whole pre-body header block and find the boundary
  // anywhere in it.
  const headEnd = raw.indexOf('\r\n\r\n');
  const headerBlock = headEnd === -1 ? raw : raw.slice(0, headEnd);
  const boundaryMatch = headerBlock.match(/boundary="?([^";\r\n]+)"?/);
  if (!boundaryMatch) return null;
  const boundary = `--${boundaryMatch[1]}`;
  const parts = raw.split(boundary).slice(1);
  for (const part of parts) {
    if (!part.trim() || part.startsWith('--')) continue;
    const sep = part.indexOf('\r\n\r\n');
    if (sep === -1) continue;
    const headerBlock = part.slice(0, sep);
    const body = part.slice(sep + 4);
    if (!/^Content-Type:\s*text\/html/im.test(headerBlock)) continue;
    // Prefer the part whose Content-Location matches the page (the first
    // text/html part is usually the page itself anyway).
    const encoding = headerBlock.match(/^Content-Transfer-Encoding:\s*(\S+)/im)?.[1]?.toLowerCase();
    if (encoding === 'base64') {
      return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
    }
    if (encoding === 'quoted-printable' || !encoding) {
      return body
        .replace(/=\r?\n/g, '') // soft line breaks
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    }
    return body;
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSV (FBref live page → Share & Export → "Get table as CSV")
// ---------------------------------------------------------------------------

/** RFC-4180-ish parser: quoted fields, "" escapes, \r\n or \n. */
function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV exports carry the table's full aria labels as headers ("Passes
 *  Completed", "Key Passes", …). Map each volume field to those labels; the
 *  first matching column wins. */
const CSV_FIELD_LABELS: Record<FbrefField, string[]> = {
  shots: ['Shots Total'],
  shotsOnTarget: ['Shots on Target'],
  passesCompleted: ['Passes Completed'],
  keyPasses: ['Key Passes'],
  crosses: ['Crosses'],
  tacklesWon: ['Tackles Won'],
  gkWins: ['Wins'],
  unusedSubs: ['Matches as Unused Sub'],
};

function extractTableFromCsv(text: string, spec: PageSpec): ExtractedTable {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() === 'Player'));
  if (headerIdx === -1) return { rows: [], availableStats: [], availableHeaders: [] };
  const header = rows[headerIdx].map((c) => c.trim());
  const col = (name: string) => header.findIndex((h) => h === name);
  const playerIdx = col('Player');
  const squadIdx = col('Squad');
  const n90Idx = col('90s Played');
  const minutesIdx = col('Minutes');
  const out: FbrefPlayerRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length) continue;
    const name = (r[playerIdx] ?? '').replace(/[*†]/g, '').trim();
    if (!name || name.toLowerCase() === 'total') continue;
    const n90 = parseNumber(n90Idx >= 0 ? (r[n90Idx] ?? '') : '');
    const minutesText = minutesIdx >= 0 ? (r[minutesIdx] ?? '').trim() : '';
    const minutes = minutesText !== '' ? parseNumber(minutesText) : n90 * 90;
    const values: Partial<Record<FbrefField, number>> = {};
    for (const field of Object.keys(spec.dataStats) as FbrefField[]) {
      const labels = CSV_FIELD_LABELS[field] ?? [];
      let idx = -1;
      for (const l of labels) {
        idx = header.findIndex((h) => h === l);
        if (idx !== -1) break;
      }
      if (idx === -1) continue;
      const t = (r[idx] ?? '').replace(/,/g, '').trim();
      if (t === '' || t === '-') continue;
      const n = Number.parseFloat(t);
      if (Number.isFinite(n)) values[field] = n;
    }
    out.push({
      name,
      squad: squadIdx >= 0 ? (r[squadIdx] ?? '').trim() || null : null,
      minutes: Number.isFinite(minutes) ? minutes : 0,
      n90,
      values,
    });
  }
  return { rows: out, availableStats: Object.keys(CSV_FIELD_LABELS), availableHeaders: header };
}

// ---------------------------------------------------------------------------
// Public entry: parse every saved page in data/fbref-raw/
// ---------------------------------------------------------------------------

/** Identify which (season, page) a saved file is. The page's canonical URL is
 *  authoritative (browsers name files arbitrarily); the legacy
 *  `<season>_<page>.html` convention is the fallback. */
function detectPage(
  fileName: string,
  html: string,
  onLog: (msg: string) => void,
): { seasonUrl: string; spec: PageSpec } | null {
  const canonical = html.match(/rel="canonical"\s+href="([^"]+)"/)?.[1];
  if (canonical) {
    const m = canonical.match(/\/comps\/9\/(\d{4}-\d{4})\/([a-z_]+)\//);
    if (m) {
      const [, seasonUrl, slug] = m;
      if (!SEASON_LABELS[seasonUrl]) {
        onLog(`[fbref] skip ${fileName}: season ${seasonUrl} isn't in the model window`);
        return null;
      }
      const spec = PAGE_SPECS.find((s) => s.slug === slug);
      if (spec) return { seasonUrl, spec };
      onLog(`[fbref] skip ${fileName}: "${slug}" page isn't one of the volume pages`);
      return null;
    }
  }
  const base = path.basename(fileName).toLowerCase();
  for (const [seasonUrl] of Object.entries(SEASON_LABELS)) {
    for (const spec of PAGE_SPECS) {
      if (base === `${seasonUrl}_${spec.file}.html` || base === `${seasonUrl}_${spec.file}.csv`) {
        return { seasonUrl, spec };
      }
    }
  }
  return null;
}

export async function parseFbrefRawDir(onLog: (msg: string) => void = console.log): Promise<FbrefParsed> {
  const parsed: FbrefParsed = { generated_at: new Date().toISOString(), seasons: {} };
  for (const label of Object.values(SEASON_LABELS)) parsed.seasons[label] = {};
  const seen = new Set<string>();

  const files = fs.existsSync(FBREF_RAW_DIR)
    ? fs.readdirSync(FBREF_RAW_DIR).filter((f) => /\.(html|mhtml|csv)$/i.test(f)).sort()
    : [];
  if (!files.length) {
    onLog('[fbref] no saved pages (.html/.mhtml/.csv) in data/fbref-raw/');
    return parsed;
  }

  for (const f of files) {
    const fullPath = path.join(FBREF_RAW_DIR, f);
    const isCsv = f.toLowerCase().endsWith('.csv');
    let detected: { seasonUrl: string; spec: PageSpec } | null = null;
    let table: ExtractedTable | null = null;
    if (isCsv) {
      const text = fs.readFileSync(fullPath, 'utf8');
      detected = detectPage(f, text, onLog);
      if (!detected) continue;
      table = extractTableFromCsv(text, detected.spec);
      if (!table.rows.length) {
        onLog(`[fbref] WARNING: ${f} has no player rows (empty export or missing header) — skipped`);
        continue;
      }
    } else {
      const raw = fs.readFileSync(fullPath, 'utf8');
      let html: string;
      if (f.endsWith('.mhtml')) {
        html = readMhtmlHtml(fullPath) ?? '';
        if (!html) {
          onLog(`[fbref] WARNING: could not decode ${f} as a single-file MHTML — skipped`);
          continue;
        }
      } else {
        html = raw;
      }
      detected = detectPage(f, html, onLog);
      if (!detected) continue;
      table = await extractTable(html, detected.spec);
      if (!table.rows.length) {
        throw new Error(
          `No player stats table found in ${f} (detected as ${SEASON_LABELS[detected.seasonUrl]} ${detected.spec.slug}) — the page may not have ` +
            `loaded before saving (or Cloudflare's "Just a moment…" wall was saved). Re-save that page. ` +
            `Available headers: ${table.availableHeaders.join(', ')}`,
        );
      }
    }
    const { seasonUrl, spec } = detected;
    const seasonLabel = SEASON_LABELS[seasonUrl];
    const wanted = Object.keys(spec.dataStats) as FbrefField[];
    const resolved = wanted.filter((field) => table.rows.some((r) => field in r.values));
    if (resolved.length === 0) {
      const hint = isCsv
        ? 'the export may have run before the page finished loading — re-export once numbers show in every column'
        : 'cells are likely JS-populated (saved as "HTML Only"?) — use the live page\'s "Get table as CSV" export instead';
      // Graceful degradation: keep the rows (per-term coverage then falls
      // back to baselines) and warn loudly instead of killing the run.
      onLog(
        `[fbref] WARNING: ${seasonLabel} ${spec.slug} parsed (${table.rows.length} rows) but none of ` +
          `${wanted.join('/')} have values — ${hint}. That term falls back to league baselines. ` +
          `data-stats present: ${table.availableStats.slice(0, 30).join(', ')}`,
      );
    }
    const unresolved = wanted.filter((field) => !resolved.includes(field));
    if (unresolved.length && resolved.length) onLog(`[fbref] warn: ${unresolved.join('/')} unresolved in ${spec.slug}`);
    const key = spec.file;
    if (parsed.seasons[seasonLabel][key]) onLog(`[fbref] note: ${f} duplicates ${seasonLabel} ${key} — last one wins`);
    parsed.seasons[seasonLabel][key] = table.rows;
    seen.add(`${seasonLabel}/${key}`);
    onLog(`[fbref] ${seasonLabel} ${spec.slug}: ${table.rows.length} rows (fields: ${resolved.join(', ') || 'NONE — baseline fallback'})`);
  }

  const missing: string[] = [];
  for (const [seasonUrl, seasonLabel] of Object.entries(SEASON_LABELS)) {
    for (const spec of PAGE_SPECS) {
      if (!seen.has(`${seasonLabel}/${spec.file}`)) missing.push(`${seasonUrl}_${spec.file}`);
    }
  }
  if (missing.length) onLog(`[fbref] still missing (not saved yet): ${missing.join(', ')}`);
  return parsed;
}

export function readFbrefCache(): FbrefParsed | null {
  if (!fs.existsSync(FBREF_JSON_PATH)) return null;
  return JSON.parse(fs.readFileSync(FBREF_JSON_PATH, 'utf8')) as FbrefParsed;
}

export function writeFbrefCache(data: FbrefParsed): void {
  fs.writeFileSync(FBREF_JSON_PATH, `${JSON.stringify(data, null, 1)}\n`);
}
