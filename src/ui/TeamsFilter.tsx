/**
 * Daily-slate team checklist. Its controlled exclusion set is intentionally
 * shared with MatchupStrip: both surfaces toggle the same App-owned state.
 */
export function TeamsFilter({
  teams,
  excludedTeams,
  open,
  onOpenChange,
  onToggleTeam,
}: {
  teams: ReadonlySet<string>;
  excludedTeams: ReadonlySet<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleTeam: (team: string) => void;
}) {
  const slateTeams = [...teams].sort();
  const includedCount = slateTeams.filter((team) => !excludedTeams.has(team)).length;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
          open
            ? 'border-accent bg-surface-raised text-primary'
            : 'border-default text-secondary hover:border-strong hover:text-primary'
        }`}
        title="Choose which slate teams appear on the cheat sheet"
      >
        Teams (<span className="font-condensed tabular-nums">{includedCount}/{slateTeams.length}</span>)
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Slate teams"
          className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-default bg-surface-raised p-2 shadow-sm"
        >
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">Slate teams</p>
          <div className="flex flex-col gap-1">
            {slateTeams.map((team) => {
              const included = !excludedTeams.has(team);
              return (
                <label
                  key={team}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-secondary transition hover:bg-surface-hover hover:text-primary"
                >
                  <input
                    type="checkbox"
                    name="teams-filter"
                    value={team}
                    checked={included}
                    onChange={() => onToggleTeam(team)}
                    aria-label={`${included ? 'Exclude' : 'Include'} ${team} players on the sheet`}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: 'var(--color-accent)' }}
                  />
                  <span className="font-condensed font-semibold tabular-nums">{team}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
