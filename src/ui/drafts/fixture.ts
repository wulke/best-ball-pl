/**
 * Dev fixture (#20's "hand-made fixture" — deterministic, regenerates against
 * whatever snapshot is loaded): a full 12-team × 18-round snake simulated
 * against the sheet, then engineered so every review lens has something to
 * say — a need reach, an early-GK reach, a club-concentration block, one
 * unmatched transfer-insurance pick, and one ambiguous surname for the
 * confirm queue. DEV-only affordance; #22 replaces all of this with reality.
 */
import type { SnapshotPlayer } from '../types.js';
import type { PreviewPick } from './types.js';
import { FALSE_NINE, type ContestProfile } from '../../contest/profiles.js';

const MY_TEAM = 'sheethead';
const TEAMS = [
  MY_TEAM,
  'chalk_wolf',
  'vice_pick',
  'tier_one_andy',
  'bpa_bruiser',
  'ceiling_seeker',
  'floor_general',
  'value_village',
  'the_grinder',
  'matchup_nerd',
  'late_gk_guy',
  'xfactor',
];

/** Deterministic PRNG — same fixture every load, for a given snapshot. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const surname = (player: SnapshotPlayer): string =>
  player.name.normalize('NFKD').replace(/[^a-zA-Z ]/g, '').trim().split(' ').pop()!
    .toLowerCase();

type SimEntry = { team: string; player: SnapshotPlayer | null; rawName: string };

export type FixturePreview = {
  picks: PreviewPick[];
  rawPaste: string;
  suggestedName: string;
  myTeam: string;
};

export function buildFixturePreview(
  pool: SnapshotPlayer[],
  profile: ContestProfile = FALSE_NINE,
): FixturePreview {
  // The fixture's engineering (reach moves, round-5 GK, concentration blocks)
  // is tuned to the 12×18 False Nine room shape.
  if (profile.id !== FALSE_NINE.id) {
    throw new Error('dev fixture simulates the False Nine profile only');
  }
  const ROOM_SIZE = profile.draft.draftSize;
  const ROUNDS = profile.roster.rosterSize;
  const STARTER_NEEDS = profile.roster.starters;
  const rand = mulberry32(0xfa17ba11);
  const sheet = pool
    .filter((p) => p.projection)
    .sort((a, b) => a.projection!.overallRank - b.projection!.overallRank);
  if (sheet.length < ROOM_SIZE * ROUNDS) {
    throw new Error('snapshot too small for the dev fixture');
  }

  // Seeded draft order.
  const order = [...TEAMS];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const params = new Map(
    order.map((team) => [
      team,
      team === MY_TEAM
        ? { needProb: 0.5, reachProb: 0.05 }
        : { needProb: 0.55 + rand() * 0.35, reachProb: rand() * 0.25 },
    ]),
  );

  const taken = new Set<string>();
  const roster = new Map<string, SnapshotPlayer[]>();
  const best = (position?: string): SnapshotPlayer => {
    const hit = sheet.find((p) => !taken.has(p.id) && (!position || p.position === position));
    // Every position is deep enough that a forced fill always finds one.
    return hit ?? sheet.find((p) => !taken.has(p.id))!;
  };
  const counts = (team: string): Record<string, number> => {
    const out: Record<string, number> = { G: 0, D: 0, MD: 0, FW: 0 };
    for (const p of roster.get(team) ?? []) out[p.position] += 1;
    return out;
  };

  const log: SimEntry[] = [];
  for (let i = 0; i < ROOM_SIZE * ROUNDS; i += 1) {
    const round = Math.floor(i / ROOM_SIZE);
    const slot = i % ROOM_SIZE;
    const team = order[round % 2 === 0 ? slot : ROOM_SIZE - 1 - slot];
    const { needProb, reachProb } = params.get(team)!;
    const mine = counts(team);
    const unmet = (['G', 'D', 'MD', 'FW'] as const).filter((pos) => mine[pos] < STARTER_NEEDS[pos]);
    const r = rand();

    let choice: SnapshotPlayer;
    if (unmet.length > 0 && (r < needProb || round >= 11)) {
      // Most-needed position first (largest starter gap; tie → random).
      const maxGap = Math.max(...unmet.map((pos) => STARTER_NEEDS[pos] - mine[pos]));
      const tied = unmet.filter((pos) => STARTER_NEEDS[pos] - mine[pos] === maxGap);
      choice = best(tied[Math.floor(rand() * tied.length)]);
    } else if (r > 1 - reachProb) {
      const window = sheet.filter((p) => !taken.has(p.id)).slice(0, 8);
      choice = window[Math.floor(rand() * window.length)];
    } else {
      choice = best();
    }
    taken.add(choice.id);
    roster.set(team, [...(roster.get(team) ?? []), choice]);
    log.push({ team, player: choice, rawName: choice.name });
  }

  // ── Engineering: give the review lenses real material ────────────────────
  const myIndices = log.map((e, i) => (e.team === MY_TEAM ? i : -1)).filter((i) => i >= 0);
  const swapPlayers = (i: number, j: number) => {
    const a = log[i].player!;
    const b = log[j].player!;
    log[i] = { ...log[i], player: b, rawName: b.name };
    log[j] = { ...log[j], player: a, rawName: a.name };
  };
  const roundOf = (i: number) => Math.floor(i / ROOM_SIZE) + 1;

  // 1. Round-3 need reach: pull one of my mid-round MD picks up to my 3rd pick.
  const r3 = myIndices[2];
  const reachTarget = myIndices.find(
    (i) => roundOf(i) >= 6 && roundOf(i) <= 10 && log[i].player?.position === 'MD',
  );
  if (reachTarget !== undefined && reachTarget !== r3) swapPlayers(r3, reachTarget);

  // 2. Early GK: move my keeper pick up to round 5.
  const r5 = myIndices[4];
  const gkIndex = myIndices.find((i) => log[i].player?.position === 'G');
  if (gkIndex !== undefined && gkIndex !== r5 && gkIndex !== r3) swapPlayers(r5, gkIndex);

  // 3. Club concentration: engineer 4 players from one club onto my roster.
  const myRoster = () => (roster.get(MY_TEAM) ?? []).map((p) => p.team);
  const tally = (clubs: string[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (const club of clubs) out.set(club, (out.get(club) ?? 0) + 1);
    return out;
  };
  // Reflect engineering swaps in the roster tally before choosing the club.
  const clubCounts = tally(myRoster());
  let targetClub = [...clubCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const protectedIndices = new Set([r3, r5, reachTarget, gkIndex].filter((x) => x !== undefined));
  let guard = 0;
  while ((clubCounts.get(targetClub) ?? 0) < 4 && guard < 4) {
    guard += 1;
    const mine = myIndices.find(
      (i) => !protectedIndices.has(i) && log[i].player?.team !== targetClub,
    );
    if (mine === undefined) break;
    const partner = log.findIndex(
      (e, i) =>
        e.team !== MY_TEAM &&
        !protectedIndices.has(i) &&
        e.player?.team === targetClub &&
        e.player?.position === log[mine].player?.position,
    );
    if (partner === -1) break;
    swapPlayers(mine, partner);
    clubCounts.set(targetClub, (clubCounts.get(targetClub) ?? 0) + 1);
  }

  // 4. Transfer insurance: my last pick is a non-EPL name — unmatched by design.
  const last = myIndices[myIndices.length - 1];
  if (!protectedIndices.has(last)) {
    log[last] = { team: MY_TEAM, player: null, rawName: 'Vinícius Júnior' };
  }

  // 5. One ambiguous surname late in the draft → the confirm queue.
  const bySurname = new Map<string, SnapshotPlayer[]>();
  for (const p of sheet) {
    const key = surname(p);
    bySurname.set(key, [...(bySurname.get(key) ?? []), p]);
  }
  const ambiguousSlot = log.findIndex(
    (e, i) =>
      e.team !== MY_TEAM &&
      i >= 13 * ROOM_SIZE &&
      e.player !== null &&
      (bySurname.get(surname(e.player)) ?? []).length >= 2,
  );
  let ambiguousCandidates: { playerId: string; label: string }[] | undefined;
  if (ambiguousSlot >= 0) {
    const group = bySurname.get(surname(log[ambiguousSlot].player!))!;
    ambiguousCandidates = group.slice(0, 3).map((p) => ({
      playerId: p.id,
      label: `${p.fullName} — ${p.team} (${p.position})`,
    }));
    log[ambiguousSlot] = {
      ...log[ambiguousSlot],
      player: null,
      rawName: group[0].name.split(' ').pop()!,
    };
  }

  // ── Materialize the contract + a recap-ish paste ─────────────────────────
  const picks: PreviewPick[] = log.map((entry, index) => ({
    pick: index + 1,
    round: Math.floor(index / ROOM_SIZE) + 1,
    team: entry.team,
    rawName: entry.rawName,
    playerId: entry.player?.id ?? null,
    unmatched: entry.player === null && index !== ambiguousSlot,
    ...(index === ambiguousSlot ? { candidates: ambiguousCandidates } : {}),
  }));

  const rawPaste = picks
    .map(
      (p) =>
        `${String(p.round).padStart(2, '0')}.${String((p.pick - 1) % ROOM_SIZE + 1).padStart(2, '0')} ${p.team} — ${p.rawName}`,
    )
    .join('\n');

  return {
    picks,
    rawPaste,
    suggestedName: 'Dev Fixture Room (sim)',
    myTeam: MY_TEAM,
  };
}
