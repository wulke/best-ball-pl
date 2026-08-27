/**
 * Draft-review contract — settled in #18 (what analysis changes strategy) and
 * #19 (intake), built in #20. The recap parser itself is #22: everything here
 * is the contract it must produce and the review UI consumes.
 */
import type { ContestProfile } from '../../contest/profiles.js';
import { PROFILES, resolveContest } from '../../contest/profiles.js';
import type { Position, SnapshotFixture, SnapshotPlayer } from '../types.js';

/** One pick in a parsed draft-recap log. Persisted in the room record. */
export type PickLogEntry = {
  /** 1-based overall pick number across the whole room (~216 picks). */
  pick: number;
  /** 1-based round (18-round snake). */
  round: number;
  /** Drafting team name, verbatim from the recap. */
  team: string;
  /** Player name as pasted — the matcher's input, kept verbatim for re-parse. */
  rawName: string;
  /** Matched snapshot player id; null while unmatched. */
  playerId: string | null;
  /** True when no confident match exists. Transfer-insurance non-EPL picks
   *  land here by design — excluded from deviation math, never blocking. */
  unmatched: boolean;
  /** Underdog's own position tag from the recap's position-club line
   *  ("MD - NFO" → "MD"), #132. Where it disagrees with the snapshot's
   *  FPL-derived position, the player belongs in the override table
   *  (src/etl/position-overrides.ts — run `npm run positions:audit`).
   *  Optional: legacy room records predate the field; re-parse back-fills. */
  udPosition?: Position;
  /** Underdog's club abbreviation from the same line ("MD - NFO" → "NFO") —
   *  the matcher join's second, independent verification. Optional as above. */
  udClub?: string;
};

/** Transient matcher candidates — preview-time only, never persisted. */
export type PickCandidate = { playerId: string; label: string };

/** One auto-flag on the carry-forward card (#18 lens 6). */
export type CarryFlag = { severity: 'red' | 'amber'; text: string };

/** Preview-time pick: a log entry plus candidates awaiting one-click confirm. */
export type PreviewPick = PickLogEntry & { candidates?: PickCandidate[] };

export const ROOM_RECORD_VERSION = 1;

/** "2026-08-22" -> "Aug 22", to detect a date already spelled out in a profile name. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Best-effort back-fill of a room's profileId from its editable competition
 * label (#45) — legacy rooms (created before the structured link existed)
 * carry no profileId, but their label was defaulted from the profile name
 * (plus the slate date), so an exact or prefix match usually resolves. A
 * hand-edited label ("GW2 practice") still matches when it keeps the
 * profile-name prefix; a fully rewritten label stays null, and the room
 * then reviews under whatever profile is active — the same fallback as a
 * genuinely unknown contest.
 */
export function inferProfileId(competition: string | null | undefined): string | null {
  if (!competition) return null;
  const hit = PROFILES.find(
    (profile) =>
      competition === profile.name ||
      competition.startsWith(`${profile.name} —`) ||
      competition.startsWith(`${profile.name} `),
  );
  return hit?.id ?? null;
}

/**
 * Infer a daily profile from a legacy pick log's clubs (#45) — for rooms
 * created before the profileId link existed that ALSO carry no competition
 * label (nothing for inferProfileId to match). The distinct clubs appearing
 * in the room's matched picks must be a subset of exactly one profile's
 * window clubs, and the room's team count must equal that profile's draft
 * size. Returns null when nothing resolves cleanly (season rooms, unknown
 * contests, windows whose calendar moved).
 */
export function inferProfileFromPicks(
  picks: PickLogEntry[],
  pool: SnapshotPlayer[],
  fixtures: SnapshotFixture[],
): string | null {
  const teamCount = teamsInLog(picks).length;
  if (teamCount === 0) return null;
  const byId = new Map(pool.map((p) => [p.id, p]));
  const clubs = new Set<string>();
  for (const pick of picks) {
    const team = pick.playerId ? byId.get(pick.playerId)?.team : undefined;
    if (team) clubs.add(team);
  }
  if (clubs.size === 0) return null;
  const hits = PROFILES.filter((profile) => {
    if (profile.kind !== 'daily') return false;
    if (profile.draft.draftSize !== teamCount) return false;
    let windowClubs: string[];
    try {
      windowClubs = resolveContest(profile, fixtures).clubs ?? [];
    } catch {
      return false; // window unresolved (calendar moved) — can't vouch for it
    }
    return [...clubs].every((club) => windowClubs.includes(club));
  });
  return hits.length === 1 ? hits[0].id : null;
}

/** Editable initial grouping only; rooms do not retain a profile-object link. */
export function defaultCompetition(profile: ContestProfile): string {
  const { window } = profile;
  switch (window.kind) {
    case 'slate':
      // Some profile names already spell out the slate date (e.g. "(Aug 22)"); avoid showing it twice.
      return profile.name.includes(shortDate(window.date))
        ? profile.name
        : `${profile.name} — ${window.date}`;
    case 'season':
    case 'fixtures':
      return profile.name;
  }
}

/**
 * A completed draft room. localStorage is the working store; Export writes
 * this record verbatim to data/drafts/&lt;yyyy-mm-dd&gt;-&lt;room-slug&gt;.json for
 * commit (the archival step), Import reads it back.
 */
export type RoomRecord = {
  version: typeof ROOM_RECORD_VERSION;
  id: string;
  /** Auto-from-recap where possible, always editable. */
  name: string;
  /** Entry cost in $ — 3 (practice) / 15 (flagship) / manual. */
  entryCost: number | null;
  /** Editable contest grouping; null means Uncategorized. */
  competition: string | null;
  /** Contest profile the room was drafted under — the registry id from
   *  src/contest/profiles.ts. The review lenses always run under the room's
   *  own profile (window clubs, roster shape, and the window-projected pool)
   *  regardless of which profile is active in the sheet switcher. Null on
   *  legacy rooms: the review falls back to the active profile, and
   *  inferProfileId() back-fills the field from the competition label. */
  profileId: string | null;
  /** Draft date, yyyy-mm-dd. */
  draftDate: string;
  /** The recap paste, stored verbatim — re-parse and debug source of truth. */
  rawPaste: string;
  /** The parsed full pick log (the whole room, not just my picks). */
  picks: PickLogEntry[];
  /** My team's name in the recap; null until picked from the dropdown. */
  myTeam: string | null;
  /** Optional Underdog draft URL (manually pasted; #22 sniffs pre-fill). */
  draftUrl: string | null;
  /** Free-text line of the carry-forward card — the human read of the room. */
  carryNote: string;
  createdAt: string;
  updatedAt: string;
};

/** Distinct non-empty values, in first-appearance order. */
export function distinctStrings(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value) seen.add(value);
  }
  return [...seen];
}

/** Teams present in a pick log, in first-appearance order. */
export function teamsInLog(picks: PickLogEntry[]): string[] {
  return distinctStrings(picks.map((pick) => pick.team));
}

/** Distinct competition labels across a set of rooms, in first-appearance order. */
export function competitionsInRooms(rooms: RoomRecord[]): string[] {
  return distinctStrings(rooms.map((room) => room.competition));
}

/**
 * Renumber pick/round after any structural edit (add/delete/reorder/team
 * change). Pick = array index + 1; round = ceil(pick / teamCount) from the
 * unique team names actually present.
 */
export function renumber(picks: PickLogEntry[]): PickLogEntry[] {
  const teamCount = Math.max(1, teamsInLog(picks).length);
  return picks.map((entry, index) => ({
    ...entry,
    pick: index + 1,
    round: Math.floor(index / teamCount) + 1,
  }));
}
