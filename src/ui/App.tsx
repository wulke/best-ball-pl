import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Position, Snapshot } from './types.js';
import { PlayerTable, type RankMode } from './PlayerTable.js';
import { useDrafted } from './useDrafted.js';
import { useDraftSession } from './useDraftSession.js';
import { buildRecommendations } from './recommend.js';
import { LivePanel } from './LivePanel.js';
import { DraftsView } from './drafts/DraftsView.js';
import { ExposureView } from './drafts/ExposureView.js';
import { CarryCard } from './drafts/CarryCard.js';
import { computeExposure } from './drafts/exposure.js';
import { reviewRoom } from './drafts/review.js';
import { useRooms } from './drafts/store.js';
import { defaultCompetition } from './drafts/types.js';
import { ScarcityView } from './ScarcityView.js';
import { useContestProfile } from './useContestProfile.js';
import { useProfilePool } from './useProfilePool.js';
import { hasOddsCoverage } from './windowProjections.js';
import { FALSE_NINE, profileById, resolveContest } from '../contest/profiles.js';
import type { OddsSlate } from '../etl/odds.js';
import { matchupContext } from './matchupContext.js';
import { MatchupStrip } from './MatchupStrip.js';

const THEMES = ['pitch', 'ember', 'volt'] as const;
type PositionFilter = 'ALL' | Position;
type View = 'sheet' | 'drafts' | 'exposure' | 'scarcity';
const POSITION_FILTERS: PositionFilter[] = ['ALL', 'G', 'D', 'MD', 'FW'];
const RANK_MODE_KEY = 'bbpl-rank-mode';

function loadRankMode(): RankMode {
  try {
    const raw = localStorage.getItem(RANK_MODE_KEY);
    return raw === 'vorp' ? 'vorp' : 'points';
  } catch {
    return 'points';
  }
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setThemeTick] = useState(0);
  const [view, setView] = useState<View>('sheet');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
  const [rankMode, setRankMode] = useState<RankMode>(loadRankMode);
  const [query, setQuery] = useState('');
  const [hideDrafted, setHideDrafted] = useState(true);
  const [queueOnly, setQueueOnly] = useState(false);
  const [liveOpen, setLiveOpen] = useState(true);
  const [carryOpen, setCarryOpen] = useState(true);
  const [matchupOpen, setMatchupOpen] = useState(() => {
    try {
      return localStorage.getItem('bbpl-matchup-strip') !== '0'; // default open
    } catch {
      return true;
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /** The sticky strip+filter stack's measured height — published as the
   *  `--bbpl-sticky-top` custom property so PlayerTable's <thead> sticks
   *  directly beneath it (the height varies with the matchup strip's
   *  open/collapsed state and chip wrap). null → 44px fallback in the var(). */
  const [stickyStackHeight, setStickyStackHeight] = useState<number | null>(null);
  /** Callback ref: (re)attaches a ResizeObserver every time the sheet view
   *  mounts the sticky stack — an effect with [] deps would orphan the first
   *  observer on view switches that unmount/remount the element. */
  const roRef = useRef<ResizeObserver | null>(null);
  const stickyStackRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => setStickyStackHeight(el.offsetHeight));
      ro.observe(el);
      roRef.current = ro;
    } else {
      setStickyStackHeight(null); // stack unmounted — fall back to the 44px default
    }
  }, []);
  const { profile, setProfile, profiles } = useContestProfile();
  // False Nine keeps the original (unsuffixed) storage keys — untouched by
  // profile switching; any other profile's marks/roster/queue live under
  // their own namespace so a slate draft never tramples the flagship's.
  const namespace = profile.id === FALSE_NINE.id ? undefined : profile.id;
  const { drafted, toggle, clear } = useDrafted(namespace);
  const { mine, queue, toggleMine, toggleQueue, clearAll, clearQueue } = useDraftSession(namespace);
  const { rooms, upsert, remove } = useRooms();

  /** Exposure displayed on the sheet is deliberately scoped to the active
   * profile's derived room label, even before a room for that profile exists. */
  const exposureCompetition = defaultCompetition(profile);
  const exposureByPlayer = useMemo(
    () => new Map(
      computeExposure(rooms)
        .filter((entry) => entry.competition === exposureCompetition)
        .map((entry) => [
          entry.playerId,
          { percent: entry.percent, pickedRooms: entry.pickedRooms, totalRooms: entry.totalRooms },
        ]),
    ),
    [rooms, exposureCompetition],
  );

  // Scarcity brings its own tall panel — collapse Live Draft to make room when switching to it.
  useEffect(() => {
    if (view === 'scarcity') setLiveOpen(false);
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(RANK_MODE_KEY, rankMode);
    } catch {
      // Storage unavailable — toggle still works for this session.
    }
  }, [rankMode]);

  // Close the hamburger menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    fetch('data/snapshot.json')
      .then((res) => {
        if (!res.ok) throw new Error(`snapshot fetch failed (${res.status})`);
        return res.json() as Promise<Snapshot>;
      })
      .then(setSnapshot)
      .catch((err: Error) => setError(err.message));
  }, []);

  // Publish the sticky stack's height as a CSS custom property on the App's
  // root so PlayerTable's <thead> can stick to `var(--bbpl-sticky-top)`.
  // Attachment lives in the stickyStackRef callback above (not an effect) so
  // view switches that unmount/remount the stack re-observe correctly;
  // ResizeObserver catches the strip toggle and chip wrap at narrow widths.
  // SSR/tests never run ref callbacks against a real DOM, so the var() fallback
  // in PlayerTable keeps standalone renders identical to the old top-11.
  // Daily odds are an optional static companion asset. Missing, stale, or
  // malformed coverage never blocks the slate sheet: the projection layer
  // simply uses its model-only terms for those fixtures/players.
  // (Fetched inside useProfilePool, which also serves the drafts intake, the
  // room review, and the carry pin — each under its own contest profile.)
  const { pool: players, odds } = useProfilePool(snapshot, profile);

  const theme =
    (typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme')
      : null) ?? 'pitch';

  /** Players carrying a projection under the active profile — everything the
   *  sheet can rank. False Nine reads the committed season projections
   *  as-is; any other profile is window-projected + pool-restricted client-
   *  side (#47), the snapshot itself untouched. (Computed in useProfilePool.) */

  // Per-fixture matchup context for daily profiles (#108): λs come from the
  // pool's window-projected p50 goal sums, so the strip reflects the same
  // opponent-adjusted, start-aware, odds-blended math the board ranks on.
  // False Nine's 380-fixture window has no strip — the flagship stays pixel-identical.
  const matchups = useMemo(
    () => (snapshot && profile.kind === 'daily'
      ? matchupContext(players, resolveContest(profile, snapshot.fixtures).fixtures, hasOddsCoverage(odds) ? odds : undefined)
      : []),
    [snapshot, profile, players, odds],
  );

  const toggleMatchupStrip = useCallback(() => {
    setMatchupOpen((open) => {
      try {
        localStorage.setItem('bbpl-matchup-strip', open ? '0' : '1');
      } catch {
        // Storage unavailable — the toggle still works for this session.
      }
      return !open;
    });
  }, []);

  /** The carry-forward pin: the latest room of the ACTIVE competition, read
   *  mid-draft (#45 — per-competition carry cards). Reviewed under the room's
   *  own contest profile and its window-projected pool, so a Free Kick room
   *  pins slate numbers even while False Nine is the active sheet profile.
   *  Rooms without a profileId (legacy) review under the active profile. */
  const carryRoom =
    rooms.find(
      (room) =>
        room.competition === exposureCompetition && room.myTeam && room.picks.length > 0,
    ) ?? null;
  const carryProfile = useMemo(
    () => (carryRoom?.profileId ? profileById(carryRoom.profileId) : profile),
    [carryRoom, profile],
  );
  const { pool: carryPool } = useProfilePool(snapshot, carryProfile);

  const carryPin = useMemo(() => {
    if (!carryRoom || !snapshot) return null;
    const review = reviewRoom(carryPool, carryRoom.picks, carryRoom.myTeam, carryProfile, snapshot.fixtures);
    if (!review) return null;
    if (review.flags.length === 0 && carryRoom.carryNote.trim() === '') return null;
    return { room: carryRoom, flags: review.flags, note: carryRoom.carryNote };
  }, [carryRoom, carryPool, carryProfile, snapshot]);

  /** Draft by me: one click sets mine + off board (the M button). */
  const draftMine = useCallback(
    (id: string) => {
      toggleMine(id);
      if (!drafted.has(id) && !mine.has(id)) toggle(id);
      setQuery('');
    },
    [toggleMine, toggle, drafted, mine],
  );

  /** Off-board toggle: clears the search box too, so a live-draft capture
   *  ("check" a player someone else took) snaps the sheet back to the full
   *  available pool instead of staying filtered to the just-searched name. */
  const toggleDrafted = useCallback(
    (id: string) => {
      toggle(id);
      setQuery('');
    },
    [toggle],
  );

  /** My roster as player objects (for the live panel). */
  const roster = useMemo(
    () => players.filter((p) => mine.has(p.id)),
    [players, mine],
  );

  const recs = useMemo(
    () => buildRecommendations(players, drafted, mine, queue, profile),
    [players, drafted, mine, queue, profile],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = players.filter((player) => {
      if (positionFilter !== 'ALL' && player.position !== positionFilter) return false;
      if (queueOnly && !queue.has(player.id)) return false;
      if (hideDrafted && drafted.has(player.id)) return false;
      if (
        q &&
        !player.name.toLowerCase().includes(q) &&
        !player.fullName.toLowerCase().includes(q) &&
        !player.team.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    // Rank order: overall in the ALL view (by rankMode), within-position when
    // filtered. `|| overallRank` covers a snapshot that predates draftValue
    // (falls back to the points-based rank rather than a no-op NaN sort).
    const overallRankFor = (p: (typeof filtered)[number]) =>
      rankMode === 'vorp'
        ? p.projection!.overallRankByValue || p.projection!.overallRank
        : p.projection!.overallRank;
    filtered.sort((a, b) =>
      positionFilter === 'ALL'
        ? overallRankFor(a) - overallRankFor(b)
        : (a.projection!.posRank - b.projection!.posRank),
    );
    return filtered;
  }, [players, positionFilter, hideDrafted, queueOnly, query, drafted, queue, rankMode]);

  return (
    <div className="min-h-screen bg-app px-4 py-6">
      <div
        className="mx-auto flex max-w-7xl flex-col gap-3"
        style={
          stickyStackHeight != null
            ? ({ '--bbpl-sticky-top': `${stickyStackHeight}px` } as CSSProperties)
            : undefined
        }
      >
        <header className="flex items-center justify-between gap-2 print:hidden">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">
              {profile.id === FALSE_NINE.id ? 'The False Nine · EPL Best Ball' : profile.name}
            </p>
            <h1 className="font-condensed text-2xl font-bold">
              {view === 'drafts' ? 'Draft Rooms' : view === 'exposure' ? 'Exposure' : 'Cheat Sheet'}
              {view !== 'drafts' && view !== 'exposure' && snapshot && (
                <span className="ml-2 align-middle font-condensed text-sm font-semibold text-muted tabular-nums">
                  {snapshot.generated_at.slice(0, 10)} · {players.length} players
                </span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded border border-default p-0.5">
              {(
                [
                  ['sheet', 'Sheet'],
                  ['scarcity', 'Scarcity'],
                ] as [View, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                    view === key ? 'bg-accent text-accent-fg' : 'text-muted hover:text-secondary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {profiles.length > 1 && (
              <select
                value={profile.id}
                onChange={(event) => setProfile(event.target.value)}
                aria-label="Contest profile"
                title="Contest profile — rankings, roster shape, and marks are scoped to the active profile"
                className="rounded border border-default bg-surface px-2 py-1 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary focus:border-strong focus:outline-none"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-1 rounded border border-default p-0.5">
              {THEMES.map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    localStorage.setItem('bbpl-theme', option);
                    document.documentElement.setAttribute('data-theme', option);
                    setThemeTick((tick) => tick + 1);
                  }}
                  className={`rounded px-2 py-1 text-xs font-medium transition ${
                    option === theme ? 'bg-accent text-accent-fg' : 'text-muted hover:text-secondary'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                aria-label="More views"
                className={`rounded border border-default px-2 py-1.5 text-sm transition ${
                  view === 'drafts' || view === 'exposure' || menuOpen
                    ? 'border-strong text-primary'
                    : 'text-muted hover:text-secondary'
                }`}
              >
                ☰
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-md border border-default bg-surface-raised py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setView('drafts');
                      setMenuOpen(false);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-sm font-semibold transition ${
                      view === 'drafts'
                        ? 'text-accent'
                        : 'text-secondary hover:bg-surface-hover hover:text-primary'
                    }`}
                  >
                    Drafts
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setView('exposure');
                      setMenuOpen(false);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-sm font-semibold transition ${
                      view === 'exposure'
                        ? 'text-accent'
                        : 'text-secondary hover:bg-surface-hover hover:text-primary'
                    }`}
                  >
                    Exposure
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {error ? (
          <main className="rounded-md border border-default bg-surface px-3 py-2">
            <p className="text-sm text-negative">Failed to load snapshot: {error}</p>
          </main>
        ) : !snapshot ? (
          <main className="rounded-md border border-default bg-surface px-3 py-2">
            <p className="text-sm text-muted">Loading snapshot…</p>
          </main>
        ) : view === 'drafts' ? (
          <DraftsView snapshot={snapshot} rooms={rooms} upsert={upsert} remove={remove} profile={profile} />
        ) : view === 'exposure' ? (
          <ExposureView players={snapshot.players} rooms={rooms} />
        ) : players.length === 0 ? (
          <main className="rounded-md border border-default bg-surface px-3 py-2">
            <p className="text-sm text-secondary">
              Snapshot has no projections. Run <code className="text-accent">npm run etl</code> to
              populate players and projections.
            </p>
          </main>
        ) : (
          <>
            {carryPin && (
              <div className="print:hidden">
                <button
                  type="button"
                  onClick={() => setCarryOpen((open) => !open)}
                  className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent"
                >
                  {carryOpen ? '▾' : '▸'} Carry card from{' '}
                  {carryPin.room.name || 'latest room'} (
                  {carryPin.room.draftDate || carryPin.room.updatedAt.slice(0, 10)})
                </button>
                {carryOpen && (
                  <CarryCard flags={carryPin.flags} note={carryPin.note} pinned />
                )}
              </div>
            )}

            <LivePanel
              recs={recs}
              roster={roster}
              open={liveOpen}
              onToggleOpen={() => setLiveOpen((value) => !value)}
              queueOnly={queueOnly}
              onToggleQueueOnly={() => setQueueOnly((value) => !value)}
              queueSize={queue.size}
              profile={profile}
            />

            {/* Scarcity is an analysis panel over the same live board state, not a separate
                page — the board (filters + table) below stays mounted underneath it. */}
            {view === 'scarcity' && <ScarcityView players={players} drafted={drafted} />}

            {/* Sticky config stack (#108): matchup strip ABOVE the table's
                filter bar, both inside one sticky wrapper so they pin together
                and the strip's collapsed↔open height change can never overlap
                the filters mid-scroll. Its measured height is published as the
                `--bbpl-sticky-top` custom property (see stickyStack effect) so
                PlayerTable's <thead> sticks directly beneath it — a hardcoded
                top-11 only worked when the stack was exactly the 44px bar. */}
            <div ref={stickyStackRef} className="sticky top-0 z-20 bg-app print:hidden">
              {matchups.length > 0 && (
                <MatchupStrip matchups={matchups} open={matchupOpen} onToggle={toggleMatchupStrip} />
              )}

              <div className="flex h-11 flex-nowrap items-center gap-2 overflow-x-auto py-2">
              <div className="flex items-center gap-0.5 rounded border border-default p-0.5">
                {POSITION_FILTERS.map((position) => (
                  <button
                    key={position}
                    onClick={() => setPositionFilter(position)}
                    className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                      position === positionFilter
                        ? 'bg-accent text-accent-fg'
                        : 'text-muted hover:text-secondary'
                    }`}
                  >
                    {position}
                  </button>
                ))}
              </div>

              {positionFilter === 'ALL' && (
                <div
                  className="flex items-center gap-0.5 rounded border border-default p-0.5"
                  title="How the overall (#) column ranks cross-position — VORP accounts for how deep/scarce each position is"
                >
                  {(['points', 'vorp'] as RankMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setRankMode(mode)}
                      className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                        mode === rankMode
                          ? 'bg-accent text-accent-fg'
                          : 'text-muted hover:text-secondary'
                      }`}
                    >
                      {mode === 'points' ? 'Points' : 'VORP'}
                    </button>
                  ))}
                </div>
              )}

              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search player or team…"
                className="w-48 rounded border border-default bg-surface px-2 py-1 text-sm text-primary placeholder:text-muted focus:border-strong focus:outline-none"
              />

              <button
                onClick={() => setHideDrafted((value) => !value)}
                className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                  hideDrafted ? 'bg-accent text-accent-fg' : 'text-muted hover:text-secondary'
                }`}
                title="Hide players drafted by anyone (off board)"
              >
                Hide off-board ({drafted.size})
              </button>

              {(drafted.size > 0 || mine.size > 0) && (
                <button
                  onClick={() => {
                    if (confirm('Clear the board and my roster? (New draft — your ★ queue is kept)')) {
                      clear();
                      clearAll();
                    }
                  }}
                  className="rounded border border-default px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
                  title="Reset between drafts: off-board marks, my roster — the ★ queue persists across drafts"
                >
                  New draft
                </button>
              )}

              {queue.size > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Clear your ★ target queue?')) clearQueue();
                  }}
                  className="rounded border border-default px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
                  title="Empty the ★ target queue (it otherwise persists across drafts)"
                >
                  Clear queue
                </button>
              )}

              <span className="ml-auto text-xs tabular-nums text-muted">
                {visible.length} shown · {drafted.size} off board · {mine.size} mine · {queue.size} queued
              </span>
              </div>
            </div>

            <PlayerTable
              players={visible}
              drafted={drafted}
              onToggleDrafted={toggleDrafted}
              mine={mine}
              onDraftMine={draftMine}
              queued={queue}
              onToggleQueued={toggleQueue}
              groupByTier={positionFilter !== 'ALL'}
              rankMode={rankMode}
              showOddsPoints={profile.window.kind === 'slate' && hasOddsCoverage(odds)}
              exposureByPlayer={exposureByPlayer}
              exposureCompetition={exposureCompetition}
            />
          </>
        )}
      </div>
    </div>
  );
}
