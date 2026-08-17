import { useEffect, useMemo, useState } from 'react';
import type { Position, Snapshot } from './types.js';
import { PlayerTable } from './PlayerTable.js';
import { useDrafted } from './useDrafted.js';

const THEMES = ['pitch', 'ember', 'volt'] as const;
type PositionFilter = 'ALL' | Position;
const POSITION_FILTERS: PositionFilter[] = ['ALL', 'G', 'D', 'MD', 'FW'];

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setThemeTick] = useState(0);
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
  const [query, setQuery] = useState('');
  const [hideDrafted, setHideDrafted] = useState(true);
  const { drafted, toggle, clear } = useDrafted();

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = players.filter((player) => {
      if (positionFilter !== 'ALL' && player.position !== positionFilter) return false;
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
  }, [players, positionFilter, hideDrafted, query, drafted]);

  return (
    <div className="min-h-screen bg-app px-4 py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3">
        <header className="flex items-center justify-between print:hidden">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">
              The False Nine · EPL Best Ball
            </p>
            <h1 className="font-condensed text-2xl font-bold">
              Cheat Sheet
              {snapshot && (
                <span className="ml-2 align-middle font-condensed text-sm font-semibold text-muted tabular-nums">
                  {snapshot.generated_at.slice(0, 10)} · {players.length} players
                </span>
              )}
            </h1>
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
        </header>

        {error ? (
          <main className="rounded-md border border-default bg-surface px-3 py-2">
            <p className="text-sm text-negative">Failed to load snapshot: {error}</p>
          </main>
        ) : !snapshot ? (
          <main className="rounded-md border border-default bg-surface px-3 py-2">
            <p className="text-sm text-muted">Loading snapshot…</p>
          </main>
        ) : players.length === 0 ? (
          <main className="rounded-md border border-default bg-surface px-3 py-2">
            <p className="text-sm text-secondary">
              Snapshot has no projections. Run <code className="text-accent">npm run etl</code> to
              populate players and projections.
            </p>
          </main>
        ) : (
          <>
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
                title="Hide players marked drafted"
              >
                Hide drafted ({drafted.size})
              </button>

              {drafted.size > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Clear all drafted marks? (New practice draft)')) clear();
                  }}
                  className="rounded border border-default px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
                  title="Reset the board between practice drafts"
                >
                  Clear
                </button>
              )}

              <span className="ml-auto text-xs tabular-nums text-muted">
                {visible.length} shown · {drafted.size} drafted
              </span>
            </div>

            <PlayerTable
              players={visible}
              drafted={drafted}
              onToggleDrafted={toggle}
              groupByTier={positionFilter !== 'ALL'}
            />
          </>
        )}
      </div>
    </div>
  );
}
