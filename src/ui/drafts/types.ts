/**
 * Draft-review contract — settled in #18 (what analysis changes strategy) and
 * #19 (intake), built in #20. The recap parser itself is #22: everything here
 * is the contract it must produce and the review UI consumes.
 */

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

/** Teams present in a pick log, in first-appearance order. */
export function teamsInLog(picks: PickLogEntry[]): string[] {
  const seen = new Set<string>();
  for (const pick of picks) {
    if (pick.team && !seen.has(pick.team)) seen.add(pick.team);
  }
  return [...seen];
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
