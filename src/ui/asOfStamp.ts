/**
 * The header's data-as-of stamp (#44): how fresh the committed snapshot is,
 * rendered beside the sheet title. The snapshot's `asOf` block (#40) carries
 * the facts — when ETL last saw FPL upstream, the last GW whose actuals are
 * folded in, the next kickoff — and this module turns them (plus the active
 * profile) into one compact line:
 *
 *   season:  fetched Wed 26 Aug, 11:25 UTC · actuals through GW1 · next kickoff Fri 28 Aug, 19:00 UTC · 517 players
 *   daily:   closes Sat 29 Aug, 11:11 UTC · fetched 26 Aug · GW1 actuals · 131 players
 *   closed:  closed 22 Aug · fetched 26 Aug · GW1 actuals · 137 players
 *
 * The daily close time is operationally critical (entry cutoff + the lineup-
 * pull ritual), so it leads the line and carries the clock; a finished slate
 * says `closed` dimly — a done contest kept for review isn't stale data.
 *
 * Staleness is the visible cue #41's guardrails can't give: they run at ETL
 * time, not while you're drafting. `fetchedAt` more than 30h old renders the
 * whole line in negative with a `stale` marker — 30h = the daily ~06:00 UTC
 * cron plus one whole missed run. Staleness tracks the *data*, never the
 * contest clock (a long-closed slate with daily-fresh actuals stays calm).
 *
 * Pure formatting, no React — trivially unit-testable; App.tsx mounts it.
 */
import type { ContestProfile } from '../contest/profiles.js';
import type { SnapshotAsOf } from '../etl/types.js';

/** Fetched data older than this marks the whole stamp stale (negative). */
const STALE_AFTER_MS = 30 * 60 * 60 * 1000;

export type DataAsOfStamp = { text: string; stale: boolean };

const dayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const dayTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
});

function parse(ts: string): number | null {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/** Slate close time for `slate` windows — the profile's own date + notBefore. */
export function slateCloseMs(profile: ContestProfile): number | null {
  if (profile.window.kind !== 'slate') return null;
  return parse(`${profile.window.date}T${profile.window.notBefore}`);
}

export function dataAsOfStamp(input: {
  profile: ContestProfile;
  /** Runtime-defensive: a cached pre-#40 snapshot may lack the block. */
  asOf: SnapshotAsOf | undefined;
  playerCount: number;
  now?: Date;
}): DataAsOfStamp {
  const { profile, asOf, playerCount } = input;
  const now = input.now ?? new Date();
  if (!asOf) return { text: `${playerCount} players`, stale: false };

  const parts: string[] = [];
  const closeMs = slateCloseMs(profile);
  if (closeMs != null) {
    parts.push(
      now.getTime() >= closeMs
        ? `closed ${dayFmt.format(closeMs)}`
        : `closes ${dayTimeFmt.format(closeMs)} UTC`,
    );
  }

  const fetchedMs = parse(asOf.fetchedAt);
  const stale = fetchedMs != null && now.getTime() - fetchedMs >= STALE_AFTER_MS;
  if (fetchedMs != null) {
    // A daily line already carries the close clock, so fetched needs only
    // day granularity there; the season line carries the pull's time of day.
    parts.push(
      `fetched ${
        closeMs != null
          ? dayFmt.format(fetchedMs)
          : `${dayFmt.format(fetchedMs)}, ${timeFmt.format(fetchedMs)} UTC`
      }`,
    );
  }
  if (stale) parts.push('stale');

  if (asOf.actualsThrough > 0) {
    parts.push(
      profile.kind === 'daily'
        ? `GW${asOf.actualsThrough} actuals`
        : `actuals through GW${asOf.actualsThrough}`,
    );
  }
  if (profile.kind === 'season' && asOf.nextKickoff) {
    const koMs = parse(asOf.nextKickoff);
    if (koMs != null) parts.push(`next kickoff ${dayTimeFmt.format(koMs)} UTC`);
  }
  parts.push(`${playerCount} players`);
  return { text: parts.join(' · '), stale };
}
