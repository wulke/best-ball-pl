/**
 * The carry-forward card (#18 lens 6): top auto-flags + one free-text line —
 * the human read of the room. Pinned on the cheat sheet between drafts via
 * App; edited here.
 */
import type { CarryFlag } from './types.js';

type Props = {
  flags: CarryFlag[];
  note: string;
  onNoteChange?: (note: string) => void;
  /** Compact variant for the sheet pin. */
  pinned?: boolean;
};

export function CarryCard({ flags, note, onNoteChange, pinned = false }: Props) {
  return (
    <div
      className={`rounded-md border bg-surface ${
        flags.some((f) => f.severity === 'red') ? 'border-negative/40' : 'border-default'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-default px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-accent">
          Carry card{pinned ? ' · pinned' : ''}
        </span>
        <span className="text-[0.65rem] text-muted">
          {flags.length} flag{flags.length === 1 ? '' : 's'} — read into the next draft
        </span>
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2">
        {flags.length === 0 && onNoteChange === undefined && note === '' ? (
          <p className="text-sm text-muted">Nothing flagged — clean room.</p>
        ) : (
          <>
            {flags.length === 0 && <p className="text-sm text-muted">No auto-flags.</p>}
            {flags.map((flag, index) => (
              <div key={index} className="flex items-start gap-1.5">
                <span
                  className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    flag.severity === 'red' ? 'bg-negative' : 'bg-accent'
                  }`}
                  aria-label={flag.severity}
                />
                <span className="text-sm text-primary">{flag.text}</span>
              </div>
            ))}
            {onNoteChange ? (
              <textarea
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="One line for the human read of the room (room trends, drafters to avoid, timing notes)…"
                rows={2}
                className="mt-1 w-full resize-y rounded border border-default bg-surface px-2 py-1 text-sm text-primary placeholder:text-muted focus:border-strong focus:outline-none"
              />
            ) : (
              note.trim() !== '' && (
                <p className="mt-1 border-t border-default pt-1.5 text-sm text-secondary">
                  {note}
                </p>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
