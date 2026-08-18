/**
 * The recap paste-parser (#22) — built against the first real $3 draft: the
 * fixture captured from data/udraft-raw/Completed.mhtml, committed as
 * data/drafts/fixtures/2026-08-18-wulke-first-draft.txt.
 *
 * Paste format (copied text of the logged-in recap view, DOM order):
 *
 *     WULKE            <- drafting team (username)
 *     1.6|6            <- round.pickInRound | overall pick
 *     A. Semenyo       <- player name, verbatim
 *     MD - MCI         <- position - club (consumed by the parser, not stored)
 *
 * Nav junk, an ADP "Players" table, the logged-in team's recap summary, and
 * footer text can surround the board — the scan keys on the `round.pick|overall`
 * anchors, which only the board produces (exactly one per pick).
 *
 * Name matching (the #22 matcher): confident when (a) the pasted name is an
 * exact normalized match of an FPL web name (mononyms: Rayan, Kevin, Igor
 * Jesus), or (b) surname token(s) + first initial resolve to exactly one pool
 * player — falling back to surname-only uniqueness when the initial conflicts
 * with FPL's display name ("V. Livramento" vs pool "Tino Livramento").
 * Multiple survivors → the preview's one-click confirm queue (`candidates`);
 * nothing → `unmatched` (flagged, excluded from deviation math — transfer
 * insurance / non-EPL names land here by design).
 *
 * Normalization realities found in the data: NFKD does NOT decompose Ø
 * (Ødegaard), ß stays ß (Groß), FPL web names carry nicknames/abbreviations
 * (A.Becker, Bruno G., Kroupi.Jr, Rodrigo 'Rodri' Hernandez Cascante),
 * Japanese order puts the surname first (Mitoma Kaoru), and compound surnames
 * appear in the paste (van Dijk, Smith Rowe, Mukiele Mulere).
 */
import type { SnapshotPlayer } from '../types.js';
import type { PickCandidate, PreviewPick } from './types.js';

export type ParseResult =
  | {
      status: 'ok';
      picks: PreviewPick[];
      /** Room name suggested from the recap, if extractable. */
      suggestedName: string | null;
      /** Underdog draft URL sniffed from the paste, if present. */
      suggestedUrl: string | null;
    }
  | { status: 'error'; message: string };

/** A `round.pickInRound|overall` board anchor, e.g. "1.6|6". */
const ANCHOR = /^(\d{1,2})\.(\d{1,2})\s*\|\s*(\d{1,3})$/;
/** The line under a player name, e.g. "MD - MCI". */
const POS_CLUB = /^(G|D|MD|FW) - [A-Z]{3}$/;
/** Draft URLs on both the current (underdogsports) and legacy hosts. */
const DRAFT_URL =
  /https?:\/\/(?:www\.)?app\.underdog(?:fantasy|sports)\.com\/draft\/[0-9a-f-]{36}/i;

/** Diacritics NFKD won't decompose, plus forms it renders awkwardly. */
const CHAR_MAP: Record<string, string> = {
  'ø': 'o',
  'Ø': 'O',
  'ß': 'ss',
  'æ': 'ae',
  'Æ': 'AE',
  'œ': 'oe',
  'Œ': 'OE',
  'đ': 'd',
  'Đ': 'D',
  'þ': 'th',
  'Þ': 'TH',
  'ł': 'l',
  'Ł': 'L',
};

const isCombiningMark = (ch: string): boolean => /\p{M}/u.test(ch);

/**
 * Normalize a player name for matching: NFKD + explicit Ø/ß/… map, strip
 * combining marks, lowercase, and fold punctuation (initials "A.", FPL
 * "A.Becker"/"Kroupi.Jr", quote-wrapped nicknames, hyphenated "Mason-Clark")
 * to spaces.
 */
export function normalizeName(name: string): string {
  const decomposed = name.normalize('NFKD');
  const mapped = [...decomposed].map((ch) => CHAR_MAP[ch] ?? ch).join('');
  const noMarks = [...mapped].filter((ch) => !isCombiningMark(ch)).join('');
  return noMarks
    .replace(/[.'’]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type PoolEntry = {
  id: string;
  /** Normalized FPL web name (`name` field) — the tier-1 exact-match key. */
  webName: string;
  /** First character of the normalized full name's first token. */
  firstInit: string;
  /** Every token of fullName + web name — the surname/keyword lookup set. */
  tokens: Set<string>;
  label: string;
};

/** Index the pool once per parse call; pure, so tests can build it directly. */
export function buildPoolIndex(pool: SnapshotPlayer[]): Map<string, PoolEntry> {
  const index = new Map<string, PoolEntry>();
  for (const p of pool) {
    const fullF = normalizeName(p.fullName ?? p.name);
    const webName = normalizeName(p.name);
    const tokens = new Set<string>();
    for (const token of [...fullF.split(' '), ...webName.split(' ')]) {
      if (token) tokens.add(token);
    }
    index.set(p.id, {
      id: p.id,
      webName,
      firstInit: fullF.split(' ')[0]?.[0] ?? '',
      tokens,
      label: `${p.fullName ?? p.name} — ${p.team} (${p.position})`,
    });
  }
  return index;
}

export type NameMatch =
  | { kind: 'confident'; playerId: string }
  | { kind: 'ambiguous'; candidates: PickCandidate[] }
  | { kind: 'unmatched' };

function ambiguous(ids: string[], index: Map<string, PoolEntry>): NameMatch {
  const candidates = ids
    .map((id) => index.get(id)!)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((entry) => ({ playerId: entry.id, label: entry.label }));
  return { kind: 'ambiguous', candidates };
}

/**
 * Match a pasted name to the pool. See the file header for the confidence
 * tiers. Returns `candidates` for the preview's one-click confirm queue when
 * more than one pool player survives.
 */
export function matchName(
  index: Map<string, PoolEntry>,
  rawName: string,
): NameMatch {
  const normalized = normalizeName(rawName);
  const initialMatch = normalized.match(/^([a-z]) (.+)$/);
  const initial = initialMatch?.[1] ?? null;
  const rest = (initialMatch?.[2] ?? normalized).trim();
  const restTokens = rest.split(' ').filter(Boolean);
  if (restTokens.length === 0) return { kind: 'unmatched' };

  // Tier 1: the pasted name is (part of) an FPL web name — mononyms
  // ("Rayan", "Kevin", "Igor Jesus", "Thiago"). Web names are usually but
  // NOT always unique (Alex + Cole Palmer, both "Martinez") — apply the
  // first-initial constraint when a web name is shared.
  const webExact = [...index.values()].filter((entry) => entry.webName === rest);
  if (webExact.length === 1) return { kind: 'confident', playerId: webExact[0].id };
  if (webExact.length > 1) {
    if (initial) {
      const withInitial = webExact.filter((entry) => entry.firstInit === initial);
      if (withInitial.length === 1) return { kind: 'confident', playerId: withInitial[0].id };
      if (withInitial.length > 1) return ambiguous(withInitial.map((e) => e.id), index);
    }
    return ambiguous(webExact.map((e) => e.id), index);
  }

  // Candidate keys: every single token, the full name, and the last two
  // tokens as a phrase — covers "N. Mukiele Mulere", "E. Mason-Clark",
  // "E. Smith Rowe", "V. Van Dijk", "Igor Jesus".
  const keys = new Set<string>([rest, ...restTokens]);
  if (restTokens.length >= 2) keys.add(restTokens.slice(-2).join(' '));
  const candidates = new Set<string>();
  for (const key of keys) {
    if (!key) continue;
    for (const entry of index.values()) {
      if (entry.tokens.has(key)) candidates.add(entry.id);
    }
  }

  if (initial) {
    const withInitial = [...candidates].filter(
      (id) => index.get(id)!.firstInit === initial,
    );
    if (withInitial.length === 1) return { kind: 'confident', playerId: withInitial[0] };
    if (withInitial.length > 1) return ambiguous(withInitial, index);
    // The initial emptied the field — FPL display names disagree with real
    // given names ("V. Livramento" → "Tino"). Surname uniqueness is still a
    // confident match; a surviving surname group goes to the confirm queue.
    if (candidates.size === 1) {
      return { kind: 'confident', playerId: [...candidates][0] };
    }
    if (candidates.size > 1) return ambiguous([...candidates], index);
    return { kind: 'unmatched' };
  }

  if (candidates.size === 1) return { kind: 'confident', playerId: [...candidates][0] };
  if (candidates.size > 1) return ambiguous([...candidates], index);
  return { kind: 'unmatched' };
}

/** Parse an Underdog draft-recap paste into the full pick log. #22. */
export function parseRecap(rawPaste: string, pool: SnapshotPlayer[]): ParseResult {
  const lines = rawPaste.split(/\r?\n/);
  const index = buildPoolIndex(pool);

  const anchors = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => ANCHOR.test(line));
  if (anchors.length === 0) {
    return {
      status: 'error',
      message:
        'No Underdog recap pick lines found — paste the text of a completed recap page.',
    };
  }

  const picks: PreviewPick[] = [];
  for (const { line, i } of anchors) {
    const match = line.match(ANCHOR)!;
    const round = Number(match[1]);
    const overall = Number(match[3]);
    const team = (lines[i - 1] ?? '').trim();
    const rawName = (lines[i + 1] ?? '').trim();
    const posClub = (lines[i + 2] ?? '').trim();
    if (!team || !rawName || !POS_CLUB.test(posClub)) {
      return {
        status: 'error',
        message: `Recap parse stopped at pick ${overall} ("${line}") — the pasted text looks truncated. Paste the whole recap page.`,
      };
    }

    const nameMatch = matchName(index, rawName);
    picks.push({
      pick: overall,
      round,
      team,
      rawName,
      playerId: nameMatch.kind === 'confident' ? nameMatch.playerId : null,
      unmatched: nameMatch.kind === 'unmatched',
      ...(nameMatch.kind === 'ambiguous' ? { candidates: nameMatch.candidates } : {}),
    });
  }

  return {
    status: 'ok',
    picks,
    suggestedName: null,
    suggestedUrl: rawPaste.match(DRAFT_URL)?.[0] ?? null,
  };
}
