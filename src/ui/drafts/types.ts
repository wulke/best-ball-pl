/**
 * Draft-review contract — settled in #18 (what analysis changes strategy) and
 * #19 (intake), built in #20. The recap parser itself is #22: everything here
 * is the contract it must produce and the review UI consumes.
 */
import type { ContestProfile } from '../../contest/profiles.js';

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
