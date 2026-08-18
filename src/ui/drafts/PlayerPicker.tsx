/**
 * Search-select over the pool — the inline-edit pressure valve (#19): re-match
 * a pick, fix a parser miss, or hand-add a pick. Matches on web name, full
 * name, and team code.
 */
import { useMemo, useState } from 'react';
import type { SnapshotPlayer } from '../types.js';

type Props = {
  players: SnapshotPlayer[];
  value: string | null;
  onSelect: (playerId: string | null) => void;
  placeholder?: string;
};

export function PlayerPicker({ players, value, onSelect, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = value ? players.find((p) => p.id === value) : undefined;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored = players
      .map((p) => {
        const name = p.name.toLowerCase();
        const full = p.fullName.toLowerCase();
        let hit = -1;
        if (name.startsWith(q)) hit = 0;
        else if (full.startsWith(q)) hit = 1;
        else if (name.includes(q)) hit = 2;
        else if (full.includes(q)) hit = 3;
        else if (p.team.toLowerCase() === q) hit = 4;
        return { p, hit, rank: p.projection?.overallRank ?? 9999 };
      })
      .filter((m) => m.hit >= 0)
      .sort((a, b) => a.hit - b.hit || a.rank - b.rank);
    return scored.slice(0, 8).map((m) => m.p);
  }, [players, query]);

  const showInput = open || query !== '' || !selected;

  return (
    <div className="relative min-w-0">
      {showInput ? (
        <>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Let a list click land before the menu unmounts.
              window.setTimeout(() => setOpen(false), 150);
            }}
            placeholder={placeholder ?? 'Search player…'}
            className="w-full rounded border border-strong bg-surface px-1.5 py-1 text-sm text-primary placeholder:text-muted focus:border-accent focus:outline-none"
          />
          {open && matches.length > 0 && (
            <div className="absolute left-0 top-full z-30 mt-0.5 w-64 max-w-[80vw] overflow-hidden rounded-md border border-strong bg-surface-raised shadow-lg">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(p.id);
                    setQuery('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm text-primary transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {p.name} <span className="text-muted">· {p.team}</span>
                  </span>
                  <span className="text-xs tabular-nums text-muted">{p.position}</span>
                </button>
              ))}
            </div>
          )}
          {open && query !== '' && matches.length === 0 && (
            <div className="absolute left-0 top-full z-30 mt-0.5 w-64 rounded-md border border-default bg-surface-raised px-2 py-1 text-xs text-muted">
              No pool player matches — leave it unmatched.
            </div>
          )}
        </>
      ) : (
        selected && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setQuery(' ');
            }}
            className="flex w-full items-center gap-1 truncate rounded border border-default px-1.5 py-0.5 text-left text-sm text-primary transition-colors hover:border-strong"
            title="Change matched player"
          >
            <span className="truncate">
              {selected.name} <span className="text-muted">· {selected.team}</span>
            </span>
            <span
              className="ml-auto text-xs text-muted hover:text-negative"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(null);
              }}
              title="Clear match"
            >
              ✕
            </span>
          </button>
        )
      )}
    </div>
  );
}
