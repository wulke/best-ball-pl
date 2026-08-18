/**
 * Shared FBref/PL volume-row → FPL player matching.
 *
 * Volume sources (FBref saved pages, Premier League stats API) have no shared
 * key with FPL: normalized full-name match first, unique web-name match
 * second, surname/first-name tiers with token-overlap sanity checks, team-map
 * tiebreak for ambiguity, committed overrides for the rest. Unmatched rows
 * are usually players outside the 2026/27 FPL pool — expected, logged, skipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SnapshotPlayer } from './types.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const OVERRIDES_PATH = path.join(REPO_ROOT, 'data/fbref-overrides.json');

/** Volume-source squad name → FPL short code (2026/27 pool). Both FBref short
 *  names and Premier League API full names are accepted. */
export const SQUAD_TO_FPL: Record<string, string> = {
  Arsenal: 'ARS',
  'Aston Villa': 'AVL',
  Brighton: 'BHA',
  'Brighton and Hove Albion': 'BHA',
  Bournemouth: 'BOU',
  Brentford: 'BRE',
  Chelsea: 'CHE',
  'Coventry City': 'COV',
  'Crystal Palace': 'CRY',
  Everton: 'EVE',
  Fulham: 'FUL',
  'Hull City': 'HUL',
  'Ipswich Town': 'IPS',
  'Leeds United': 'LEE',
  Liverpool: 'LIV',
  'Manchester City': 'MCI',
  'Manchester United': 'MUN',
  'Newcastle United': 'NEW',
  'Nottingham Forest': 'NFO',
  Sunderland: 'SUN',
  Tottenham: 'TOT',
  'Tottenham Hotspur': 'TOT',
};

/** Strip diacritics + everything non-alphabetic, lowercase. */
export function norm(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Normalized whitespace-delimited tokens ("A.Becker" → ["abecker"]). */
export function tokensOf(name: string): string[] {
  return name
    .split(/\s+/)
    .map(norm)
    .filter((t) => t.length > 0);
}

export type Overrides = Record<string, string>; // volume-source name → FPL element id

export function readOverrides(): Overrides {
  if (!fs.existsSync(OVERRIDES_PATH)) return {};
  return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')) as Overrides;
}

export function tiebreakBySquad(
  candidates: SnapshotPlayer[],
  squads: Set<string | null>,
): SnapshotPlayer | null {
  const fplCodes = new Set(
    [...squads].filter((s): s is string => s !== null).map((s) => SQUAD_TO_FPL[s]).filter(Boolean),
  );
  if (fplCodes.size === 0) return null;
  const hit = candidates.filter((p) => fplCodes.has(p.team));
  return hit.length === 1 ? hit[0] : null;
}

export function matchPlayer(
  sourceName: string,
  squads: Set<string | null>,
  seasonLabel: string,
  sourceMinutes: number,
  players: SnapshotPlayer[],
  byNormFull: Map<string, SnapshotPlayer[]>,
  byNormWeb: Map<string, SnapshotPlayer[]>,
  overrides: Overrides,
): SnapshotPlayer | null {
  const byId = (id: string) => players.find((p) => p.id === id) ?? null;
  const override = overrides[sourceName];
  if (override) {
    const hit = byId(override);
    if (!hit) throw new Error(`data/fbref-overrides.json: "${sourceName}" → id ${override} not in snapshot`);
    return hit;
  }

  // Guard for same-name strangers: volume-source "Neto" (Bournemouth GK) vs the
  // FPL winger "Pedro Lomba Neto" share a web name. When the source squad maps
  // to a DIFFERENT club than the candidate's AND the season minutes disagree by
  // >90, they're almost certainly different people (a transfer keeps the
  // player's season minutes; only the club changes). Such candidates are
  // rejected so the exact/surname tiers can't mis-pair them.
  const guard = (c: SnapshotPlayer | null): SnapshotPlayer | null => {
    if (!c) return null;
    const fplCodes = [...squads]
      .filter((s): s is string => s !== null)
      .map((s) => SQUAD_TO_FPL[s])
      .filter(Boolean);
    if (fplCodes.length === 0 || fplCodes.includes(c.team)) return c;
    const row = c.seasons.find((s) => s.season === seasonLabel);
    if (row && Math.abs(row.minutes - sourceMinutes) > 90) return null;
    return c;
  };

  const full = byNormFull.get(norm(sourceName)) ?? [];
  if (full.length === 1) return guard(full[0]);
  if (full.length > 1) return guard(tiebreakBySquad(full, squads) ?? full[0]);

  const web = byNormWeb.get(norm(sourceName)) ?? [];
  if (web.length === 1) return guard(web[0]);
  if (web.length > 1) return guard(tiebreakBySquad(web, squads) ?? null);

  // Surname tier: sources write "First Last" while FPL often lists only the
  // last name ("Caicedo") or a fuller name ("Kepa Arrizabalaga Revuelta",
  // "Josh Acheampong" vs FBref "Joshua Acheampong"). Match the source name's
  // FINAL token to the FPL web name or full-name suffix, then require a
  // NON-surname token overlap (one a prefix of the other) as a sanity check —
  // that stops same-surname strangers ("Jacob Bruun Larsen" ≠ Strand Larsen)
  // being paired while tolerating nicknames ("Josh" vs "Joshua").
  const srcTokens = tokensOf(sourceName);
  if (srcTokens.length >= 2) {
    const last = srcTokens[srcTokens.length - 1];
    const candidates = players.filter((p) => {
      if (norm(p.name) !== last && !norm(p.fullName).endsWith(last)) return false;
      const cand = tokensOf(`${p.name} ${p.fullName}`);
      const nonSurnameSrc = srcTokens.slice(0, -1);
      const nonSurnameCand = cand.filter((t) => t !== last);
      return nonSurnameSrc.some((t) => nonSurnameCand.some((c) => c.startsWith(t) || t.startsWith(c)));
    });
    if (candidates.length === 1) return guard(candidates[0]);
    if (candidates.length > 1) return guard(tiebreakBySquad(candidates, squads) ?? null);
  }

  // First-name-only tier: sources sometimes use a single token ("Alisson")
  // while FPL has "A.Becker" / "Alisson Becker". Match a full-name prefix.
  if (srcTokens.length === 1) {
    const only = srcTokens[0];
    const candidates = players.filter(
      (p) => norm(p.fullName).startsWith(only) && norm(p.fullName) !== only,
    );
    if (candidates.length === 1) return guard(candidates[0]);
    if (candidates.length > 1) return guard(tiebreakBySquad(candidates, squads) ?? null);
  }

  return null;
}

export function buildMatchIndexes(players: SnapshotPlayer[]): {
  byNormFull: Map<string, SnapshotPlayer[]>;
  byNormWeb: Map<string, SnapshotPlayer[]>;
} {
  const byNormFull = new Map<string, SnapshotPlayer[]>();
  const byNormWeb = new Map<string, SnapshotPlayer[]>();
  for (const p of players) {
    const k = norm(p.fullName);
    byNormFull.set(k, [...(byNormFull.get(k) ?? []), p]);
    const w = norm(p.name);
    byNormWeb.set(w, [...(byNormWeb.get(w) ?? []), p]);
  }
  return { byNormFull, byNormWeb };
}
