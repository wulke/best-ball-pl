/**
 * Room records: localStorage is the working store (#19 hybrid decision);
 * Export downloads the record verbatim as data/drafts/<yyyy-mm-dd>-<room-slug>.json
 * for commit (the archival step); Import reads it back as the restore path.
 */
import { useCallback, useEffect, useState } from 'react';
import { ROOM_RECORD_VERSION, inferProfileId, type RoomRecord } from './types.js';

const STORAGE_KEY = 'bbpl-rooms';

function load(): RoomRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRoomRecord).map(normalizeRoomRecord);
  } catch {
    return [];
  }
}

function isRoomRecord(value: unknown): value is RoomRecord {
  if (typeof value !== 'object' || value === null) return false;
  const room = value as Partial<RoomRecord>;
  return (
    typeof room.id === 'string' &&
    typeof room.name === 'string' &&
    typeof room.rawPaste === 'string' &&
    Array.isArray(room.picks) &&
    (room.competition === undefined || room.competition === null || typeof room.competition === 'string')
  );
}

/** Additive v1 migration: old locally persisted rooms did not have competition
 *  (normalized to null) or profileId (back-filled from the competition label
 *  when it resolves to a known contest — the legacy rooms created under a
 *  slate profile keep reviewing under that slate, not whatever is active). */
function normalizeRoomRecord(room: RoomRecord): RoomRecord {
  return {
    ...room,
    competition: room.competition ?? null,
    profileId: room.profileId ?? inferProfileId(room.competition) ?? null,
  };
}

export function newRoomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'room';
}

/** The archival filename: <yyyy-mm-dd>-<room-slug>.json, committed under data/drafts/. */
export function exportFilename(room: RoomRecord): string {
  const date = room.draftDate || room.updatedAt.slice(0, 10);
  return `${date}-${slugify(room.name)}.json`;
}

/** Download the record verbatim — the human moves it into data/drafts/ and commits. */
export function exportRoomFile(room: RoomRecord): void {
  const blob = new Blob([JSON.stringify(room, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename(room);
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Parse an exported room file. Throws on anything that isn't a room record. */
export function parseRoomFile(text: string): RoomRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON');
  }
  if (!isRoomRecord(parsed)) throw new Error('not a room record (missing id/name/picks)');
  if (parsed.version !== ROOM_RECORD_VERSION) {
    throw new Error(`unsupported record version ${String(parsed.version)}`);
  }
  return normalizeRoomRecord(parsed);
}

/** The rooms working store. One instance lives in App (shared with the sheet pin). */
export function useRooms() {
  const [rooms, setRooms] = useState<RoomRecord[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
    } catch {
      // Storage unavailable (private mode) — in-memory only for this session.
    }
  }, [rooms]);

  const upsert = useCallback((room: RoomRecord) => {
    setRooms((prev) => {
      const next = prev.some((r) => r.id === room.id)
        ? prev.map((r) => (r.id === room.id ? room : r))
        : [room, ...prev];
      // Most recently touched first — the sheet's carry pin reads rooms[0].
      return [...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  const remove = useCallback((id: string) => {
    setRooms((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { rooms, upsert, remove };
}
