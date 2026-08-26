/**
 * Room editor: the room facts (name/date/cost/URL/raw paste + re-parse), the
 * editable pick log, and the review panel. Every change autosaves to the
 * working store.
 *
 * Weekly contests (#45): the review always runs under the room's OWN contest
 * profile — the profileId persisted at creation, or the active profile as a
 * legacy fallback — with that contest's window-projected pool. Opening a Free
 * Kick room while False Nine is active still reviews against the slate's
 * clubs, roster shape, and projections.
 */
import { useMemo, useState } from 'react';
import type { Snapshot } from '../types.js';
import type { RoomRecord } from './types.js';
import { competitionsInRooms, defaultCompetition, teamsInLog } from './types.js';
import { parseRecap, preserveMatches } from './parse.js';
import { exportRoomFile } from './store.js';
import { PickTable } from './PickTable.js';
import { ReviewPanel } from './ReviewPanel.js';
import { FALSE_NINE, profileById, type ContestProfile } from '../../contest/profiles.js';
import { useProfilePool } from '../useProfilePool.js';

type Tab = 'room' | 'log' | 'review';

type Props = {
  room: RoomRecord;
  /** Current local rooms provide reusable competition labels. */
  rooms: RoomRecord[];
  snapshot: Snapshot;
  onChange: (room: RoomRecord) => void;
  onClose: () => void;
  /** Active contest profile — the fallback for legacy rooms (no profileId). */
  profile?: ContestProfile;
};

const FIELD_LABEL = 'text-xs font-semibold uppercase tracking-wider text-muted';
const INPUT =
  'rounded border border-default bg-surface px-2 py-1 text-sm text-primary placeholder:text-muted focus:border-strong focus:outline-none';

export function RoomEditor({ room, rooms, snapshot, onChange, onClose, profile }: Props) {
  const [tab, setTab] = useState<Tab>('room');
  const [reparseNote, setReparseNote] = useState<string | null>(null);

  const patch = (changes: Partial<RoomRecord>) =>
    onChange({ ...room, ...changes, updatedAt: new Date().toISOString() });

  /** The contest this room was drafted under — its own profileId, or the
   *  active profile for legacy rooms (created before #45 carried the link). */
  const roomProfile = useMemo(
    () => (room.profileId ? profileById(room.profileId) : profile ?? FALSE_NINE),
    [room.profileId, profile],
  );

  /** The review's pool — the room's own contest's window-projected, pool-
   *  restricted players. Never the active profile's board. */
  const { pool: roomPool } = useProfilePool(snapshot, roomProfile);

  const teams = useMemo(() => teamsInLog(room.picks), [room.picks]);
  const competitions = useMemo(() => competitionsInRooms(rooms), [rooms]);

  const reparse = () => {
    const result = parseRecap(room.rawPaste, roomPool);
    if (result.status === 'error') {
      setReparseNote(`Parse failed: ${result.message}`);
      return;
    }
    setReparseNote(null);
    patch({
      picks: preserveMatches(room.picks, result.picks, new Set(roomPool.map((p) => p.id))),
      ...(result.suggestedName && room.name === '' ? { name: result.suggestedName } : {}),
      ...(result.suggestedUrl && !room.draftUrl ? { draftUrl: result.suggestedUrl } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-default px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
        >
          ← Rooms
        </button>
        <h2 className="font-condensed text-xl font-bold text-primary">{room.name || 'Untitled room'}</h2>
        <span
          className="rounded border border-default px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-secondary"
          title="Contest this room was drafted under — the review runs under this, not the active sheet profile"
        >
          {roomProfile.kind === 'daily' ? 'DAILY' : 'SEASON'}
        </span>
        <span className="text-xs tabular-nums text-muted">
          {room.draftDate || 'no date'} · {room.entryCost !== null ? `$${room.entryCost}` : '—'} ·{' '}
          {room.picks.length} picks
        </span>
        <div className="ml-auto flex items-center gap-0.5 rounded border border-default p-0.5">
          {(
            [
              ['room', 'Room'],
              ['log', `Pick log`],
              ['review', 'Review'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                tab === key ? 'bg-accent text-accent-fg' : 'text-muted hover:text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'room' && (
        <section className="rounded-md border border-default bg-surface">
          <div className="grid gap-3 px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Room name</span>
              <input
                type="text"
                value={room.name}
                onChange={(event) => patch({ name: event.target.value })}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Draft date</span>
              <input
                type="date"
                value={room.draftDate}
                onChange={(event) => patch({ draftDate: event.target.value })}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Competition (editable tag)</span>
              <input
                type="text"
                list="room-competition-options"
                value={room.competition ?? ''}
                onChange={(event) => patch({ competition: event.target.value || null })}
                placeholder={defaultCompetition(roomProfile)}
                className={INPUT}
              />
              <datalist id="room-competition-options">
                {competitions.map((competition) => (
                  <option key={competition} value={competition} />
                ))}
              </datalist>
              <span className="text-[0.65rem] text-muted">
                defaults to “{defaultCompetition(roomProfile)}” — Exposure and the carry card group on it
              </span>
            </label>
            <div className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Entry cost</span>
              <div className="flex items-center gap-1">
                {[3, 15].map((cost) => (
                  <button
                    key={cost}
                    type="button"
                    onClick={() => patch({ entryCost: cost })}
                    className={`rounded px-2.5 py-1 text-sm font-semibold transition ${
                      room.entryCost === cost
                        ? 'bg-accent text-accent-fg'
                        : 'border border-default text-secondary hover:border-strong hover:text-primary'
                    }`}
                  >
                    ${cost}
                  </button>
                ))}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={room.entryCost ?? ''}
                  onChange={(event) =>
                    patch({
                      entryCost: event.target.value === '' ? null : Number(event.target.value),
                    })
                  }
                  placeholder="other"
                  className={`${INPUT} w-20`}
                />
              </div>
            </div>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={FIELD_LABEL}>Draft URL (optional)</span>
              <input
                type="url"
                value={room.draftUrl ?? ''}
                onChange={(event) =>
                  patch({ draftUrl: event.target.value.trim() === '' ? null : event.target.value.trim() })
                }
                placeholder="https://app.underdogfantasy.com/…"
                className={INPUT}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>My team</span>
              <select
                value={room.myTeam ?? ''}
                onChange={(event) => patch({ myTeam: event.target.value || null })}
                className={INPUT}
              >
                <option value="">— pick from recap teams —</option>
                {teams.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
              <span className="text-[0.65rem] text-muted">needed for the review panel</span>
            </div>
          </div>
          <div className="border-t border-default px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className={FIELD_LABEL}>Raw paste (verbatim)</span>
              <button
                type="button"
                onClick={reparse}
                className="rounded border border-default px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
              >
                Re-parse
              </button>
            </div>
            {reparseNote && <p className="mb-1 text-xs text-info">{reparseNote}</p>}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-default bg-surface-raised px-2 py-1 text-xs text-secondary">
              {room.rawPaste || '(no paste stored)'}
            </pre>
            <div className="mt-2 flex items-center justify-between text-[0.65rem] text-muted">
              <span>
                created {room.createdAt.slice(0, 16).replace('T', ' ')} · saved{' '}
                {room.updatedAt.slice(0, 16).replace('T', ' ')}
              </span>
              <button
                type="button"
                onClick={() => exportRoomFile(room)}
                className="rounded border border-default px-2 py-0.5 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary"
                title="Downloads the record verbatim — move it into data/drafts/ and commit"
              >
                Export for commit
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === 'log' && (
        <PickTable
          players={roomPool}
          picks={room.picks}
          myTeam={room.myTeam}
          editable
          onChange={(picks) => patch({ picks })}
        />
      )}

      {tab === 'review' &&
        (room.myTeam ? (
          <ReviewPanel
            pool={roomPool}
            fixtures={snapshot.fixtures}
            picks={room.picks}
            myTeam={room.myTeam}
            carryNote={room.carryNote}
            onCarryNoteChange={(carryNote) => patch({ carryNote })}
            profile={roomProfile}
          />
        ) : (
          <section className="rounded-md border border-default bg-surface px-3 py-6 text-center text-sm text-muted">
            Pick your team in the Room tab (or the dropdown above the log) to run the review.
          </section>
        ))}
    </div>
  );
}
