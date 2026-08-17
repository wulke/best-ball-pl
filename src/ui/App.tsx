import { useEffect, useState } from 'react';
import type { Snapshot } from './types.js';

const THEMES = ['pitch', 'ember', 'volt'] as const;

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setThemeTick] = useState(0);

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

  return (
    <div className="min-h-screen bg-app px-4 py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">
              The False Nine · EPL Best Ball
            </p>
            <h1 className="font-condensed text-2xl font-bold">Cheat Sheet</h1>
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

        <main className="rounded-md border border-default bg-surface px-3 py-2">
          {error ? (
            <p className="text-sm text-negative">Failed to load snapshot: {error}</p>
          ) : !snapshot ? (
            <p className="text-sm text-muted">Loading snapshot…</p>
          ) : snapshot.players.length === 0 ? (
            <p className="text-sm text-secondary">
              Snapshot is a placeholder. Run <code className="text-accent">npm run etl</code> once the
              FPL pull lands to populate players and projections.
            </p>
          ) : (
            <p className="text-sm text-secondary tabular-nums">
              {snapshot.players.length} players · generated {snapshot.generated_at}
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
