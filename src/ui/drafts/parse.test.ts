/**
 * Parser + matcher tests against the first real recap (issue #22). The paste
 * fixture is the committed text of the logged-in recap view saved from the
 * first completed $3 draft (raw page: data/udraft-raw/Completed.mhtml,
 * gitignored — the paste text carries no room identifiers). The pool is the
 * committed FPL snapshot.
 *
 * Ground truth established when building the parser: 176 confident matches,
 * 1 ambiguous (J. Pedro → both João Pedros), 3 genuinely unmatched (names
 * absent from the FPL pool: B. Barcola, F. Kadioglu, V. Osimhen). All 18 of
 * my team's picks (WULKE) resolve confident.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { SnapshotPlayer } from '../types.js';
import { teamsInLog } from './types.js';
import { extractRecapText, normalizeName, parseRecap, sniffDraftUrl } from './parse.js';

const FIXTURE = new URL(
  '../../../data/drafts/fixtures/2026-08-18-wulke-first-draft.txt',
  import.meta.url,
);
const SNAPSHOT = new URL('../../../data/snapshot.json', import.meta.url);
const RAW_MHTML = new URL('../../../data/udraft-raw/Completed.mhtml', import.meta.url);

const paste = readFileSync(FIXTURE, 'utf8');
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as {
  players: SnapshotPlayer[];
};
const pool = snapshot.players;

const MY_TEAM = 'WULKE';

const result = () => {
  const parsed = parseRecap(paste, pool);
  assert.equal(parsed.status, 'ok', parsed.status === 'error' ? parsed.message : '');
  return parsed.status === 'ok' ? parsed : null;
};

test('normalizeName folds diacritics, case, punctuation, quotes', () => {
  assert.equal(normalizeName('M. Odegaard'), 'm odegaard');
  assert.equal(normalizeName('Ødegaard'), 'odegaard'); // NFKD leaves Ø intact
  assert.equal(normalizeName('Groß'), 'gross'); // ß → ss
  assert.equal(normalizeName('B. Guimarães'), 'b guimaraes');
  assert.equal(normalizeName('A.Becker'), 'a becker'); // FPL web-name style
  assert.equal(normalizeName('Rodrigo \'Rodri\' Hernandez Cascante'), 'rodrigo rodri hernandez cascante');
  assert.equal(normalizeName('E. Mason-Clark'), 'e mason clark'); // hyphenated
  assert.equal(normalizeName('V. Van Dijk'), 'v van dijk');
});

test('fixture parses to the full 180-pick log with the 10 recap teams', () => {
  const parsed = result();
  assert.ok(parsed);
  assert.equal(parsed.suggestedName, null);
  assert.equal(parsed.suggestedUrl, null); // the page text carries no URL
  assert.equal(parsed.picks.length, 180);
  assert.deepEqual(
    parsed.picks.map((p) => p.pick),
    Array.from({ length: 180 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    teamsInLog(parsed.picks),
    ['HOFF84', 'BIFFRENYLDS', 'JOJODFS', 'NEXTMYTH', 'BUCKEYEREMUS', 'WULKE', 'DANNYOSHEA23', 'BFITZER', 'POLARJACE', 'JEFONEF'],
  );
  // Snake integrity: WULKE at position 6 → 1.6, 2.5, 3.6, … 18.5.
  const mine = parsed.picks.filter((p) => p.team === MY_TEAM);
  assert.equal(mine.length, 18);
  assert.deepEqual(
    mine.map((p) => `${p.round}.${p.pick - (p.round - 1) * 10}`),
    Array.from({ length: 18 }, (_, i) => (i % 2 === 0 ? `${i + 1}.6` : `${i + 1}.5`)),
  );
  // rawName stays verbatim — the matcher's input is preserved for re-parse.
  assert.equal(mine[3].rawName, 'V. Van Dijk');
});

test('all 18 of my picks (WULKE) resolve confident, roster matches the recap', () => {
  const parsed = result();
  assert.ok(parsed);
  const byName = new Map(pool.map((p) => [p.name, p]));
  const find = (namePart: string, team: string) => {
    const hit = pool.find(
      (p) =>
        p.team === team &&
        ((p.fullName ?? '').toLowerCase().includes(namePart.toLowerCase()) ||
          p.name.toLowerCase().includes(namePart.toLowerCase())),
    );
    assert.ok(hit, `expected ${namePart} (${team}) in pool`);
    return hit!.id;
  };
  const expected = [
    ['A. Semenyo', 'Semenyo', 'MCI'],
    ['V. Gyokeres', 'Gyökeres', 'ARS'],
    ['J. Pickford', 'Pickford', 'EVE'],
    ['V. Van Dijk', 'van Dijk', 'LIV'],
    ['O. McBurnie', 'McBurnie', 'HUL'],
    ['M. Guehi', 'Guéhi', 'MCI'],
    ['E. Eze', 'Eze', 'ARS'],
    ['K. Mitoma', 'Mitoma', 'BHA'],
    ['B. Leno', 'Leno', 'FUL'],
    ['J. Tarkowski', 'Tarkowski', 'EVE'],
    ['Igor Jesus', 'Igor Jesus', 'NFO'],
    ['D. Maeda', 'Maeda', 'IPS'],
    ['M. Lacroix', 'Lacroix', 'CHE'],
    ['N. Woltemade', 'Woltemade', 'NEW'],
    ['E. Smith Rowe', 'Smith Rowe', 'FUL'],
    ['A. Robertson', 'Robertson', 'TOT'],
    ['R. Araujo', 'Araujo', 'LIV'],
    ['H. Ekitike', 'Ekitiké', 'LIV'],
  ] as const;
  const mine = parsed.picks.filter((p) => p.team === MY_TEAM);
  assert.equal(mine.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const [rawName, namePart, team] = expected[i];
    const pick = mine[i];
    assert.equal(pick.rawName, rawName);
    assert.equal(pick.unmatched, false, `${rawName} should be matched`);
    assert.equal(pick.playerId, find(namePart, team), `${rawName} matched the wrong player`);
  }
  // Roster composition matches the recap summary (FW 5 / MD 5 / D 6 / G 2).
  const positionCounts = mine.reduce(
    (counts, pick) => {
      const player = pool.find((p) => p.id === pick.playerId);
      if (player) counts[player.position] += 1;
      return counts;
    },
    { G: 0, D: 0, MD: 0, FW: 0 },
  );
  assert.deepEqual(positionCounts, { G: 2, D: 6, MD: 5, FW: 5 });
});

test('ambiguous names carry candidates for the one-click confirm queue', () => {
  const parsed = result();
  assert.ok(parsed);
  const pedro = parsed.picks.find((p) => p.rawName === 'J. Pedro');
  assert.ok(pedro, 'J. Pedro (2.1) should be in the log');
  assert.equal(pedro.unmatched, false); // awaiting confirmation, not unmatched
  assert.equal(pedro.playerId, null);
  assert.deepEqual(
    pedro.candidates?.map((c) => c.label),
    [
      'João Pedro Junqueira de Jesus — CHE (FW)',
      'João Pedro Loureiro da Costa — BHA (D)',
    ],
  );
});

test('shared FPL web names are disambiguated by the first initial', () => {
  const parsed = result();
  assert.ok(parsed);
  const resolve = (rawName: string) => {
    const pick = parsed.picks.find((p) => p.rawName === rawName);
    assert.ok(pick, rawName);
    assert.ok(pick.playerId, `${rawName} should resolve confidently`);
    return pool.find((p) => p.id === pick.playerId!)!;
  };
  // Alex + Cole Palmer both carry the web name "Palmer".
  assert.equal(resolve('C. Palmer').fullName, 'Cole Palmer');
  // Emiliano + Lisandro Martínez both normalize to "martinez".
  assert.equal(resolve('E. Martinez').fullName, 'Emiliano Martínez Romero');
  // Same-surname groups resolve by initial too.
  assert.equal(resolve('R. James').fullName, 'Reece James');
  assert.equal(resolve('D. Henderson').fullName, 'Dean Henderson');
});

test('names absent from the FPL pool stay unmatched and flagged', () => {
  const parsed = result();
  assert.ok(parsed);
  const unmatched = parsed.picks
    .filter((p) => p.unmatched)
    .map((p) => `${p.rawName} (${p.team})`);
  assert.deepEqual(unmatched, [
    'B. Barcola (BIFFRENYLDS)',
    'F. Kadioglu (DANNYOSHEA23)',
    'V. Osimhen (BFITZER)',
  ]);
});

test('the draft URL is sniffed when the paste carries it', () => {
  const parsed = parseRecap(paste, pool);
  assert.ok(parsed.status === 'ok');
  // Both hosts + the MHTML Snapshot-Content-Location form.
  for (const url of [
    'https://app.underdogsports.com/draft/750a297f-183d-4303-9561-48857dd15070',
    'Snapshot-Content-Location: https://app.underdogfantasy.com/draft/750a297f-183d-4303-9561-48857dd15070',
  ]) {
    const withUrl = parseRecap(`${url}\n${paste}`, pool);
    assert.ok(withUrl.status === 'ok');
    assert.equal(withUrl.suggestedUrl, url.match(/https?:\/\/[^\s]+/)?.[0]);
  }
});

test('unparseable or empty pastes return a clear error', () => {
  assert.equal(parseRecap('', pool).status, 'error');
  assert.equal(parseRecap('some random text\nwithout anchors', pool).status, 'error');
  // An anchor with a truncated neighbor surfaces the truncation message.
  const truncated = `${paste}\n12.7|127\nF. Whoever`;
  const parsed = parseRecap(truncated, pool);
  assert.ok(parsed.status === 'error');
  assert.match(parsed.message, /truncated/);
});

// ── Saved-page intake (.mhtml / .html) ──────────────────────────────────────

const SYNTHETIC_MHTML = [
  'From: <Saved by Blink>',
  'Snapshot-Content-Location: https://app.underdogsports.com/draft/00000000-0000-0000-0000-000000000000',
  'Subject: Recap',
  'MIME-Version: 1.0',
  'Content-Type: multipart/related;',
  '\ttype="text/html";',
  '\tboundary="----Boundary----"',
  '',
  '',
  '------Boundary----',
  'Content-Type: text/html',
  'Content-Transfer-Encoding: quoted-printable',
  'Content-Location: https://app.underdogsports.com/draft/00000000-0000-0000-0000-000000000000',
  '',
  '<!DOCTYPE html><html><body><p>HOFF84</p><p>1.1<span>|</span>1</p><p>E. Haalan=',
  'd</p><p>FW - MCI</p><p>WULKE</p><p>1.2|2</p><p>A. Semenyo</p><p>MD - MCI</p></body></html>',
  '------Boundary----',
].join('\n');

test('a saved .mhtml file extracts to the same paste text the parser consumes', () => {
  const extracted = extractRecapText(SYNTHETIC_MHTML);
  assert.equal(
    extracted,
    ['HOFF84', '1.1|1', 'E. Haaland', 'FW - MCI', 'WULKE', '1.2|2', 'A. Semenyo', 'MD - MCI'].join('\n'),
  );
  // The extracted text parses like a pasted recap — and the file header URL is
  // sniffed from the raw content, not the page text.
  const parsed = parseRecap(extracted, pool);
  assert.ok(parsed.status === 'ok');
  assert.equal(parsed.picks.length, 2);
  assert.equal(parsed.picks[1].team, 'WULKE');
  assert.equal(parsed.picks[1].rawName, 'A. Semenyo');
  assert.equal(sniffDraftUrl(SYNTHETIC_MHTML), 'https://app.underdogsports.com/draft/00000000-0000-0000-0000-000000000000');
  assert.equal(parsed.suggestedUrl, null); // page text alone carries no URL
});

test('plain .html saves and raw text pass through extractRecapText', () => {
  assert.equal(
    extractRecapText('<html><body><p>HOFF84</p><p>1.1|1</p><p>E. Haaland</p><p>FW - MCI</p></body></html>'),
    ['HOFF84', '1.1|1', 'E. Haaland', 'FW - MCI'].join('\n'),
  );
  assert.equal(extractRecapText('already pasted\ntext'), 'already pasted\ntext');
});

test(
  'the real saved MHTML extracts exactly to the committed fixture (local)',
  { skip: existsSync(RAW_MHTML) ? false : 'data/udraft-raw/ is gitignored — run where the saved recap lives' },
  () => {
    const extracted = extractRecapText(readFileSync(RAW_MHTML, 'utf8'));
    assert.equal(extracted, paste);
  },
);
