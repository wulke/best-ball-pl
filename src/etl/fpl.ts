/**
 * FPL API client — free, unauthenticated, undocumented. Be a good citizen:
 * every response is disk-cached under `.etl-cache/` with a TTL matched to how
 * often the data actually changes (bootstrap/fixtures follow the CDN's 5-minute
 * max-age; element-summary history is near-immutable between seasons, 24h).
 *
 * Set ETL_FRESH=1 to bypass cache reads (writes still refresh the cache).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const CACHE_DIR = path.join(REPO_ROOT, '.etl-cache');
const API_BASE = 'https://fantasy.premierleague.com/api';
const USER_AGENT = 'best-ball-pl/0.1 (pre-draft cheat sheet ETL; github.com/wulke/best-ball-pl)';

const SECOND = 1000;
const BOOTSTRAP_TTL = 5 * 60 * SECOND;
const FIXTURES_TTL = 5 * 60 * SECOND;
const ELEMENT_SUMMARY_TTL = 24 * 60 * 60 * SECOND;
const MAX_ATTEMPTS = 3;

/** Raw FPL API shapes — only the fields the ETL reads. */

export type RawTeam = { id: number; name: string; short_name: string };

export type RawElement = {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: number;
  team: number;
  now_cost: number;
  status: string;
  news: string;
};

export type RawBootstrap = {
  elements: RawElement[];
  teams: RawTeam[];
};

export type RawHistoryPastSeason = {
  season_name: string;
  total_points: number;
  minutes: number;
  starts: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  saves: number;
  penalties_saved: number;
  expected_goals?: string;
  expected_assists?: string;
};

export type RawElementSummary = { history_past: RawHistoryPastSeason[] };

export type RawFixture = {
  id: number;
  event: number;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  kickoff_time: string;
};

type CacheRecord<T> = { url: string; fetchedAt: string; body: T };

/** JSON fetch with retry/backoff on network errors, 429, and 5xx. */
async function fetchJson<T>(url: string, attempt = 1): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  } catch (err) {
    return retryTransient(url, attempt, err);
  }

  if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = res.status === 429 && retryAfter > 0 ? retryAfter * SECOND : backoff(attempt);
    await sleep(delay);
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  return (await res.json()) as T;

  async function retryTransient(u: string, a: number, err: unknown): Promise<T> {
    if (a >= MAX_ATTEMPTS) throw err;
    console.warn(`[ETL] network error on ${u} (attempt ${a}): ${errorText(err)}`);
    await sleep(backoff(a));
    return fetchJson<T>(u, a + 1);
  }
}

function backoff(attempt: number): number {
  return 2 ** (attempt - 1) * SECOND;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read-through disk cache keyed per endpoint. */
async function cached<T>(key: string, url: string, ttl: number): Promise<T> {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!process.env.ETL_FRESH && fs.existsSync(file)) {
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheRecord<T>;
      if (Date.now() - Date.parse(record.fetchedAt) < ttl) return record.body;
    } catch {
      // Corrupt cache entry — fall through to a fresh fetch.
    }
  }

  const body = await fetchJson<T>(url);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const record: CacheRecord<T> = { url, fetchedAt: new Date().toISOString(), body };
  fs.writeFileSync(file, JSON.stringify(record));
  return body;
}

export class FplApi {
  async fetchBootstrap(): Promise<RawBootstrap> {
    return cached('bootstrap-static', `${API_BASE}/bootstrap-static/`, BOOTSTRAP_TTL);
  }

  async fetchFixtures(): Promise<RawFixture[]> {
    return cached('fixtures', `${API_BASE}/fixtures/`, FIXTURES_TTL);
  }

  async fetchElementSummary(elementId: number): Promise<RawElementSummary> {
    return cached(
      `element-${elementId}`,
      `${API_BASE}/element-summary/${elementId}/`,
      ELEMENT_SUMMARY_TTL,
    );
  }

  /**
   * Pull element summaries for many players with a bounded number of
   * in-flight requests (politeness cap). Failures resolve to null (missing
   * history, not a failed run) so one bad element can't sink the snapshot.
   */
  async fetchElementSummaries(
    elementIds: number[],
    concurrency = 8,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<number, RawElementSummary | null>> {
    const results = new Map<number, RawElementSummary | null>();
    let next = 0;
    let done = 0;

    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= elementIds.length) return;
        const id = elementIds[index];
        try {
          results.set(id, await this.fetchElementSummary(id));
        } catch (err) {
          console.warn(`[ETL] element-summary ${id} failed after retries: ${errorText(err)}`);
          results.set(id, null);
        }
        done += 1;
        onProgress?.(done, elementIds.length);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, elementIds.length) }, () => worker()),
    );
    return results;
  }
}
