/**
 * The pick-log table — both the intake match-confirm preview (candidates get
 * one-click confirm, unmatched flagged) and the room editor's editable log
 * (inline re-match, team edit, delete, add). #19: inline edit is the pressure
 * valve on the parsed log.
 */
import { useMemo, useState } from 'react';
import type { SnapshotPlayer } from '../types.js';
import type { PreviewPick } from './types.js';
import { renumber } from './types.js';
import { PlayerPicker } from './PlayerPicker.js';

const POS_BADGE: Record<string, string> = {
  G: 'border-pos-g/30 bg-pos-g/10 text-pos-g',
  D: 'border-pos-d/30 bg-pos-d/10 text-pos-d',
  MD: 'border-pos-md/30 bg-pos-md/10 text-pos-md',
  FW: 'border-pos-fw/30 bg-pos-fw/10 text-pos-fw',
};

type Props = {
  players: SnapshotPlayer[];
  picks: PreviewPick[];
  /** Highlight rows drafted by my team. */
  myTeam?: string | null;
  /** Editor mode: inline edit, add, delete. */
  editable?: boolean;
  /** Preview mode: confirm an ambiguous candidate. */
  onConfirmCandidate?: (pickIndex: number, playerId: string) => void;
  /** Preview mode: dismiss candidates, leave the pick unmatched. */
  onLeaveUnmatched?: (pickIndex: number) => void;
  /** Editor mode: full-log replacement (renumbered). */
  onChange?: (picks: PreviewPick[]) => void;
};

type Filter = 'all' | 'mine' | 'unresolved';

const TH =
  'font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted px-1 py-1 whitespace-nowrap';

export function PickTable({
  players,
  picks,
  myTeam,
  editable = false,
  onConfirmCandidate,
  onLeaveUnmatched,
  onChange,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ index: number; field: 'player' | 'team' } | null>(null);
  const [adding, setAdding] = useState<{ team: string; playerId: string | null } | null>(null);

  const byId = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );

  const unresolved = picks.filter((p) => !p.playerId).length;
  const mine = myTeam ? picks.filter((p) => p.team === myTeam).length : 0;
  const visible = picks.filter((pick) => {
    if (filter === 'mine') return myTeam !== undefined && pick.team === myTeam;
    if (filter === 'unresolved') return !pick.playerId;
    return true;
  });

  const patch = (index: number, changes: Partial<PreviewPick>) => {
    onChange?.(
      renumber(picks.map((pick, i) => (i === index ? { ...pick, ...changes } : pick))),
    );
  };
  const removeAt = (index: number) => {
    onChange?.(renumber(picks.filter((_, i) => i !== index)));
    setEditing(null);
  };
  const addPick = () => {
    if (!adding?.playerId) return;
    onChange?.(
      renumber([
        ...picks,
        {
          pick: picks.length + 1,
          round: picks.length + 1,
          team: adding.team.trim() || myTeam || 'New team',
          rawName: byId.get(adding.playerId)?.name ?? '',
          playerId: adding.playerId,
          unmatched: false,
        },
      ]),
    );
    setAdding(null);
  };

  return (
    <div className="overflow-hidden rounded-md border border-default bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-default px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded border border-default p-0.5">
          {(
            [
              ['all', `All ${picks.length}`],
              ['mine', mine > 0 ? `My team ${mine}` : 'My team'],
              ['unresolved', unresolved > 0 ? `Unresolved ${unresolved}` : 'Unresolved'],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              disabled={key === 'mine' && !myTeam}
              className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide transition ${
                filter === key
                  ? 'bg-accent text-accent-fg'
                  : 'text-muted hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => setAdding({ team: myTeam ?? '', playerId: null })}
            className="rounded border border-default px-2 py-0.5 text-xs font-medium text-secondary transition hover:border-strong hover:text-primary"
          >
            + Add pick
          </button>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted">
          {picks.length} picks · {picks.length - unresolved} matched
        </span>
      </div>

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-strong">
              <th className={`${TH} w-10 text-right`}>#</th>
              <th className={`${TH} w-10 text-right`}>Rnd</th>
              <th className={`${TH} text-left`}>Team</th>
              <th className={`${TH} text-left`}>Player</th>
              <th className={`${TH} w-16 text-right`}>Pos</th>
              {editable && <th className={`${TH} w-20`} />}
            </tr>
          </thead>
          <tbody>
            {visible.map((pick) => {
              const index = picks.indexOf(pick);
              const player = pick.playerId ? byId.get(pick.playerId) : undefined;
              const isMine = myTeam != null && pick.team === myTeam;
              return (
                <tr
                  key={`${pick.pick}-${index}`}
                  className={`border-b border-default transition-colors last:border-b-0 hover:bg-surface-hover ${
                    isMine ? 'bg-accent/5' : ''
                  }`}
                >
                  <td className="px-1 py-1 text-right text-xs tabular-nums text-muted">
                    {pick.pick}
                  </td>
                  <td className="px-1 py-1 text-right text-xs tabular-nums text-muted">
                    {pick.round}
                  </td>
                  <td className="px-1 py-1">
                    {editing?.index === index && editing.field === 'team' ? (
                      <input
                        autoFocus
                        type="text"
                        defaultValue={pick.team}
                        onBlur={(event) => {
                          const team = event.target.value.trim();
                          if (team && team !== pick.team) patch(index, { team });
                          setEditing(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        className="w-32 rounded border border-strong bg-surface px-1.5 py-0.5 text-sm text-primary focus:border-accent focus:outline-none"
                      />
                    ) : (
                      <span
                        className={`text-sm ${isMine ? 'font-semibold text-accent' : 'text-secondary'}`}
                        title={isMine ? 'My team' : pick.team}
                      >
                        {pick.team}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-1">
                    {pick.candidates && pick.candidates.length > 0 && !pick.playerId ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-sm font-medium text-primary">{pick.rawName}</span>
                        {pick.candidates.map((candidate) => (
                          <button
                            key={candidate.playerId}
                            type="button"
                            onClick={() => onConfirmCandidate?.(index, candidate.playerId)}
                            className="rounded border border-strong bg-surface-raised px-1.5 py-0.5 text-xs text-primary transition hover:border-accent hover:text-accent"
                            title={`Match to ${candidate.label}`}
                          >
                            {candidate.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => onLeaveUnmatched?.(index)}
                          className="text-xs text-muted underline-offset-2 hover:text-negative hover:underline"
                        >
                          leave unmatched
                        </button>
                      </div>
                    ) : player ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        {editing?.index === index && editing.field === 'player' ? (
                          <PlayerPicker
                            players={players}
                            value={pick.playerId}
                            onSelect={(playerId) => {
                              patch(index, {
                                playerId,
                                unmatched: playerId === null,
                                rawName:
                                  (playerId && byId.get(playerId)?.name) || pick.rawName,
                              });
                              setEditing(null);
                            }}
                          />
                        ) : (
                          <>
                            <span className="truncate text-sm font-medium text-primary">
                              {pick.rawName || player.name}
                            </span>
                            <span className="text-xs text-muted">{player.team}</span>
                            {player.projection && (
                              <span
                                className="text-[0.65rem] tabular-nums text-muted"
                                title="Sheet rank by tournament score"
                              >
                                #{player.projection.overallRank} · T{player.projection.tier}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm text-secondary">{pick.rawName}</span>
                        <span
                          className="rounded border border-negative/30 bg-negative/10 px-1 py-0.5 text-[0.65rem] font-semibold leading-none text-negative"
                          title={
                            pick.unmatched
                              ? 'Unmatched — excluded from deviation math (transfer insurance lands here by design)'
                              : 'Awaiting match confirmation'
                          }
                        >
                          unmatched
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-1 text-right">
                    {player && (
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase leading-none tracking-wide ${POS_BADGE[player.position]}`}
                      >
                        {player.position}
                      </span>
                    )}
                  </td>
                  {editable && (
                    <td className="px-1 py-1 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          setEditing(
                            editing?.index === index && editing.field === 'player'
                              ? null
                              : { index, field: 'player' },
                          )
                        }
                        className="px-1 text-xs text-muted transition hover:text-accent"
                        title="Re-match player"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setEditing(
                            editing?.index === index && editing.field === 'team'
                              ? null
                              : { index, field: 'team' },
                          )
                        }
                        className="px-1 text-xs text-muted transition hover:text-accent"
                        title="Edit team name"
                      >
                        ⌨
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAt(index)}
                        className="px-1 text-xs text-muted transition hover:text-negative"
                        title="Delete pick"
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {adding && (
              <tr className="border-t border-strong bg-surface-raised">
                <td className="px-1 py-1 text-right text-xs tabular-nums text-muted">
                  {picks.length + 1}
                </td>
                <td />
                <td className="px-1 py-1">
                  <input
                    autoFocus
                    type="text"
                    value={adding.team}
                    onChange={(event) =>
                      setAdding({ ...adding, team: event.target.value })
                    }
                    placeholder="Team"
                    className="w-32 rounded border border-strong bg-surface px-1.5 py-0.5 text-sm text-primary focus:border-accent focus:outline-none"
                  />
                </td>
                <td className="px-1 py-1">
                  <PlayerPicker
                    players={players}
                    value={adding.playerId}
                    onSelect={(playerId) => setAdding({ ...adding, playerId })}
                  />
                </td>
                <td />
                <td className="px-1 py-1 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={addPick}
                    disabled={!adding.playerId}
                    className="rounded bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdding(null)}
                    className="px-1 text-xs text-muted hover:text-secondary"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            )}
            {visible.length === 0 && !adding && (
              <tr>
                <td colSpan={editable ? 6 : 5} className="px-2 py-6 text-center text-sm text-muted">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
