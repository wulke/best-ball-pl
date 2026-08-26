/**
 * The Drafts view (#20): room list → paste box → match-confirm preview →
 * pick-your-team → review panel. Intake is paste-parse only (#19); the real
 * recap parser (#22) turns the paste into the full pick log, and the dev
 * fixture exercises the full flow when no real paste is handy.
 *
 * Weekly contests (#45): every room is tagged with the contest profile it was
 * drafted under (profileId at creation, derived competition label). The intake
 * picks the contest (default: the active sheet profile); the dev fixture
 * simulates either a 12×18 season room or a 6×6 no-bench daily room depending
 * on that contest's shape.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot } from '../types.js';
import type { PreviewPick, RoomRecord } from './types.js';
import { defaultCompetition, renumber } from './types.js';
import { extractRecapText, parseRecap, sniffDraftUrl } from './parse.js';
import { buildFixturePreview, buildSlateFixturePreview } from './fixture.js';
import { exportRoomFile, newRoomId, parseRoomFile } from './store.js';
import { PickTable } from './PickTable.js';
import { RoomEditor } from './RoomEditor.js';
import { PROFILES, profileById, type ContestProfile } from '../../contest/profiles.js';
import { useProfilePool } from '../useProfilePool.js';

type Props = {
  snapshot: Snapshot;
  rooms: RoomRecord[];
  upsert: (room: RoomRecord) => void;
  remove: (id: string) => void;
  /** Active contest profile — the intake's default contest and the legacy
   *  review fallback (rooms created before #45 carried no profileId). */
  profile?: ContestProfile;
};

type Intake =
  | { stage: 'idle' }
  | { stage: 'preview'; picks: PreviewPick[]; rawPaste: string; suggestedName: string | null; suggestedUrl: string | null };

const DEV = import.meta.env.DEV;
const PANEL = 'rounded-md border border-default bg-surface';
const CONTEST_TAG = 'rounded border border-default px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-secondary';

export function DraftsView({ snapshot, rooms, upsert, remove, profile = PROFILES[0] }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [intake, setIntake] = useState<Intake>({ stage: 'idle' });
  const [error, setError] = useState<string | null>(null);
  /** The contest the pasted room was drafted under — defaults to the active
   *  sheet profile, overridable here (a GW1 paste while GW2 is active). */
  const [intakeProfile, setIntakeProfile] = useState<ContestProfile>(profile);
  const fileInput = useRef<HTMLInputElement>(null);
  const recapFileInput = useRef<HTMLInputElement>(null);

  // Follow the active sheet profile unless the user has picked a different
  // contest for this intake session.
  useEffect(() => setIntakeProfile(profile), [profile]);

  /** The intake's match/review pool — the selected contest's own window-
   *  projected, pool-restricted players, not the active profile's. */
  const { pool: intakePool } = useProfilePool(snapshot, intakeProfile);

  const openRoom = rooms.find((room) => room.id === openId) ?? null;

  const createRoom = (init: Partial<RoomRecord>): RoomRecord => {
    const now = new Date().toISOString();
    return {
      version: 1,
      id: newRoomId(),
      name: init.name ?? '',
      entryCost: init.entryCost ?? 3,
      competition: init.competition ?? defaultCompetition(intakeProfile),
      profileId: intakeProfile.id,
      draftDate: init.draftDate ?? now.slice(0, 10),
      rawPaste: init.rawPaste ?? '',
      picks: init.picks ?? [],
      myTeam: init.myTeam ?? null,
      draftUrl: init.draftUrl ?? null,
      carryNote: '',
      createdAt: now,
      updatedAt: now,
    };
  };

  const commitPreview = (preview: Extract<Intake, { stage: 'preview' }>) => {
    const room = createRoom({
      name: preview.suggestedName ?? `Room ${new Date().toISOString().slice(0, 10)}`,
      rawPaste: preview.rawPaste,
      picks: renumber(preview.picks.map(({ candidates: _candidates, ...entry }) => entry)),
      draftUrl: preview.suggestedUrl,
    });
    upsert(room);
    setIntake({ stage: 'idle' });
    setPaste('');
    setOpenId(room.id);
  };

  const tryParse = () => {
    const raw = paste.trim();
    if (!raw) return;
    const result = parseRecap(raw, intakePool);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    setIntake({
      stage: 'preview',
      picks: result.picks,
      rawPaste: raw,
      suggestedName: result.suggestedName,
      suggestedUrl: result.suggestedUrl,
    });
  };

  const loadFixture = () => {
    try {
      const fixture =
        intakeProfile.kind === 'daily'
          ? buildSlateFixturePreview(intakePool, intakeProfile)
          : buildFixturePreview(intakePool, intakeProfile);
      setPaste(fixture.rawPaste);
      setIntake({
        stage: 'preview',
        picks: fixture.picks,
        rawPaste: fixture.rawPaste,
        suggestedName: fixture.suggestedName,
        suggestedUrl: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRecapText = (rawContent: string, sourceLabel?: string) => {
    const pasteText = extractRecapText(rawContent);
    const result = parseRecap(pasteText, intakePool);
    setPaste(pasteText);
    if (result.status === 'error') {
      setError(sourceLabel ? `${sourceLabel}: ${result.message}` : result.message);
      return;
    }
    setIntake({
      stage: 'preview',
      picks: result.picks,
      rawPaste: pasteText,
      suggestedName: result.suggestedName,
      // The recap page's own text carries no URL — sniff the saved-file header
      // (Snapshot-Content-Location) or the bookmarklet's prepended draft URL.
      suggestedUrl: sniffDraftUrl(rawContent) ?? result.suggestedUrl,
    });
  };

  const loadRecapFile = async (file: File) => {
    setError(null);
    try {
      handleRecapText(await file.text(), file.name);
    } catch (err) {
      setError(
        err instanceof Error ? `Could not read ${file.name}: ${err.message}` : `Could not read ${file.name}`,
      );
    }
  };

  const pasteFromClipboard = async () => {
    setError(null);
    try {
      if (!navigator.clipboard?.readText) {
        setError('Clipboard reading needs a secure context (https) — paste manually with Cmd+V instead.');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError('Clipboard is empty — copy the recap first (the Capture bookmarklet does this).');
        return;
      }
      handleRecapText(text);
    } catch (err) {
      setError(err instanceof Error ? `Clipboard read failed: ${err.message}` : 'Clipboard read failed');
    }
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      const room = parseRoomFile(await file.text());
      upsert({ ...room, updatedAt: new Date().toISOString() });
      setOpenId(room.id);
    } catch (err) {
      setError(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed');
    }
  };

  /** Room list grouped by competition tag — the "profile + week" view. */
  const groups = useMemo(() => {
    const byCompetition = new Map<string, RoomRecord[]>();
    for (const room of rooms) {
      const key = room.competition ?? 'Uncategorized';
      byCompetition.set(key, [...(byCompetition.get(key) ?? []), room]);
    }
    return [...byCompetition.entries()];
  }, [rooms]);

  if (openRoom) {
    return (
      <RoomEditor
        room={openRoom}
        rooms={rooms}
        snapshot={snapshot}
        onChange={upsert}
        onClose={() => setOpenId(null)}
        profile={profile}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            Practice-then-flagship loop · per-contest rooms
          </p>
          <h2 className="font-condensed text-2xl font-bold">Draft Rooms</h2>
        </div>
        <div className="flex items-center gap-1">
          {DEV && (
            <button
              type="button"
              onClick={loadFixture}
              className="rounded border border-default px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-info transition hover:border-strong"
              title={`Dev-only: simulate a full room for the selected contest (${intakeProfile.kind === 'daily' ? '6×6 no-bench slate' : '12×18 season'})`}
            >
              Dev fixture
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded border border-default px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
          >
            Import room
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = '';
            }}
          />
        </div>
      </header>

      {error && (
        <p className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      )}

      {/* Intake: paste box (#19) */}
      <section className={PANEL}>
        <div className="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2">
          <span className="font-condensed text-sm font-semibold uppercase tracking-wider text-accent">
            New room from recap paste
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <span className="font-semibold uppercase tracking-wider">Contest</span>
            <select
              value={intakeProfile.id}
              onChange={(event) => setIntakeProfile(profileById(event.target.value))}
              title="The contest this room was drafted under — drives matching, the review lenses, and the room's tag"
              className="rounded border border-default bg-surface px-2 py-1 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary focus:border-strong focus:outline-none"
            >
              {PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-2 px-3 py-2">
          <textarea
            value={paste}
            onChange={(event) => {
              setPaste(event.target.value);
              setIntake({ stage: 'idle' });
              setError(null);
            }}
            rows={4}
            placeholder="Paste Underdog's draft recap text here, or load a saved recap page (.mhtml / .html)…"
            className="w-full resize-y rounded border border-default bg-surface px-2 py-1 font-mono text-xs text-primary placeholder:text-muted focus:border-strong focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={tryParse}
              disabled={paste.trim() === ''}
              className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Parse &amp; preview
            </button>
            <button
              type="button"
              onClick={() => void pasteFromClipboard()}
              className="rounded border border-default px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
              title="Read the recap copied by the 'Capture Underdog recap' bookmarklet (see docs/recap-capture.md)"
            >
              Paste from clipboard
            </button>
            <button
              type="button"
              onClick={() => recapFileInput.current?.click()}
              className="rounded border border-default px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-secondary transition hover:border-strong hover:text-primary"
              title="Load a saved recap page: Chrome/Edge single-file .mhtml (⌘S → Webpage, Single File), .html, or a .txt paste"
            >
              Load recap file
            </button>
            <input
              ref={recapFileInput}
              type="file"
              accept=".mhtml,.mht,.html,.htm,.txt"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadRecapFile(file);
                event.target.value = '';
              }}
            />
            {intake.stage === 'idle' && (
              <span className="text-xs text-muted">
                paste, clipboard, or saved-page intake — inline edit is the pressure valve
              </span>
            )}
          </div>

          {intake.stage === 'preview' && (
            <div className="flex flex-col gap-2">
              <PickTable
                players={intakePool}
                picks={intake.picks}
                onConfirmCandidate={(index, playerId) => {
                  setIntake({
                    ...intake,
                    picks: intake.picks.map((pick, i) =>
                      i === index ? { ...pick, playerId, unmatched: false, candidates: undefined } : pick,
                    ),
                  });
                }}
                onLeaveUnmatched={(index) => {
                  setIntake({
                    ...intake,
                    picks: intake.picks.map((pick, i) =>
                      i === index ? { ...pick, playerId: null, unmatched: true, candidates: undefined } : pick,
                    ),
                  });
                }}
              />
              <div>
                <button
                  type="button"
                  onClick={() => commitPreview(intake)}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
                >
                  Create room ({intake.picks.filter((p) => !p.playerId).length} unmatched)
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Room list, grouped by competition tag */}
      <section className={PANEL}>
        <div className="border-b border-default px-3 py-2">
          <span className="font-condensed text-sm font-semibold uppercase tracking-wider text-accent">
            Rooms ({rooms.length})
          </span>
        </div>
        {rooms.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">
            No rooms yet — paste a recap above (or run the dev fixture).
          </p>
        ) : (
          <ul>
            {groups.map(([competition, groupRooms]) => (
              <li key={competition}>
                <p className="flex items-baseline gap-2 border-b border-default bg-surface-raised px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-muted">
                  {competition}
                  <span className="text-muted/70 normal-case">{groupRooms.length} room{groupRooms.length === 1 ? '' : 's'}</span>
                </p>
                {groupRooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default px-2 py-1.5 last:border-b-0 hover:bg-surface-hover"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenId(room.id)}
                      className="text-left text-sm font-semibold text-primary hover:text-accent"
                    >
                      {room.name || 'Untitled room'}
                    </button>
                    <span className="text-xs tabular-nums text-muted">
                      {room.draftDate || '—'} · {room.entryCost !== null ? `$${room.entryCost}` : '—'} ·{' '}
                      {room.picks.length} picks
                      {room.myTeam ? ` · my team: ${room.myTeam}` : ' · no team picked'}
                    </span>
                    {room.profileId && (
                      <span className={CONTEST_TAG} title="Contest this room was drafted under">
                        {profileById(room.profileId).kind === 'daily' ? 'DAILY' : 'SEASON'}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => exportRoomFile(room)}
                        className="rounded border border-default px-2 py-0.5 font-semibold text-secondary transition hover:border-strong hover:text-primary"
                        title="Download data/drafts/<date>-<slug>.json for commit"
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete room "${room.name || 'Untitled'}"? This cannot be undone.`))
                            remove(room.id);
                        }}
                        className="rounded border border-default px-2 py-0.5 font-semibold text-muted transition hover:border-negative hover:text-negative"
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
