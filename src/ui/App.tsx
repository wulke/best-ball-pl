import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Position, Snapshot } from './types.js';
import { PlayerTable } from './PlayerTable.js';
import { useDrafted } from './useDrafted.js';
import { useDraftSession } from './useDraftSession.js';
import { buildRecommendations } from './recommend.js';
import { LivePanel } from './LivePanel.js';
import { DraftsView } from './drafts/DraftsView.js';
import { CarryCard } from './drafts/CarryCard.js';
import { reviewRoom } from './drafts/review.js';
import { useRooms } from './drafts/store.js';
import { ScarcityView } from './ScarcityView.js';

const THEMES = ['pitch', 'ember', 'volt'] as const;
type PositionFilter = 'ALL' | Position;
type View = 'sheet' | 'drafts' | 'scarcity';
const POSITION_FILTERS: PositionFilter[] = ['ALL', 'G', 'D', 'MD', 'FW'];

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setThemeTick] = useState(0);
  const [view, setView] = useState<View>('sheet');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
  const [query, setQuery] = useState('');
  const [hideDrafted, setHideDrafted] = useState(true);
  const [queueOnly, setQueueOnly] = useState(false);
  const [liveOpen, setLiveOpen] = useState(true);
  const [carryOpen, setCarryOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { drafted, toggle, clear } = useDrafted();
  const { mine, queue, toggleMine, toggleQueue, clearAll } = useDraftSession();
  const { rooms, upsert, remove } = useRooms();

  // Scarcity brings its own tall panel — collapse Live Draft to make room when switching to it.
  useEffect(() => {
    if (view === 'scarcity') setLiveOpen(false);
  }, [view]);

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

  const theme =
    (typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme')
      : null) ?? 'pitch';

  /** Players carrying a projection — everything the sheet can rank. */
  const players = useMemo(
    () => (snapshot?.players ?? []).filter((player) => player.projection),
    [snapshot],
  );

  /** The carry-forward pin: the latest room's flags + note, read mid-draft. */
  const carryPin = useMemo(() => {
    const latest = rooms.find((room) => room.myTeam && room.picks.length > 0);
    if (!latest || !snapshot) return null;
    const review = reviewRoom(snapshot.players, latest.picks, latest.myTeam);
    if (!review) return null;
    if (review.flags.length === 0 && latest.carryNote.trim() === '') return null;
    return { room: latest, flags: review.flags, note: latest.carryNote };
  }, [rooms, snapshot]);

  /** Draft by me: one click sets mine + off board (the M button). */
  const draftMine = useCallback(
    (id: string) => {
      toggleMine(id);
      if (!drafted.has(id) && !mine.has(id)) toggle(id);
    },
    [toggleMine, toggle, drafted, mine],
  );

  /** My roster as player objects (for the live panel). */
  const roster = useMemo(
    () => players.filter((p) => mine.has(p.id)),
    [players, mine],
  );

  const recs = useMemo(
    () => buildRecommendations(players, drafted, mine, queue),
    [players, drafted, mine, queue],
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
    // Rank order: overall in the ALL view, within-position when filtered.
    filtered.sort((a, b) =>
      positionFilter === 'ALL'
        ? (a.projection!.overallRank - b.projection!.overallRank)
        : (a.projection!.posRank - b.projection!.posRank),
    );
    return filtered;
  }, [players, positionFilter, hideDrafted, queueOnly, query, drafted, queue]);

  return (
    <div className="min-h-screen bg-app px-4 py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3">
        <header className="flex items-center justify-between gap-2 print:hidden">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">
              The False Nine · EPL Best Ball
            </p>
            <h1 className="font-condensed text-2xl font-bold">
              {view === 'drafts' ? 'Draft Rooms' : 'Cheat Sheet'}
              {view !== 'drafts' && snapshot && (
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
                  view === 'drafts' || menuOpen
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
          <DraftsView players={snapshot.players} rooms={rooms} upsert={upsert} remove={remove} />
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
            />

            {/* Scarcity is an analysis panel over the same live board state, not a separate
                page — the board (filters + table) below stays mounted underneath it. */}
            {view === 'scarcity' && <ScarcityView players={players} drafted={drafted} />}

            <div className="sticky top-0 z-20 flex h-11 flex-nowrap items-center gap-2 overflow-x-auto bg-app py-2 print:hidden">
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

              {(drafted.size > 0 || mine.size > 0 || queue.size > 0) && (
                <button
                  onClick={() => {
                    if (confirm('Clear the board, my roster, and queue? (New draft)')) {
                      clear();
                      clearAll();
                    }
                  }}
                  className="rounded border border-default px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
                  title="Full reset between drafts: off-board marks, my roster, queue"
                >
                  New draft
                </button>
              )}

              <span className="ml-auto text-xs tabular-nums text-muted">
                {visible.length} shown · {drafted.size} off board · {mine.size} mine · {queue.size} queued
              </span>
            </div>

            <PlayerTable
              players={visible}
              drafted={drafted}
              onToggleDrafted={toggle}
              mine={mine}
              onDraftMine={draftMine}
              queued={queue}
              onToggleQueued={toggleQueue}
              groupByTier={positionFilter !== 'ALL'}
            />
          </>
        )}
      </div>
    </div>
  );
}
