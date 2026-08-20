import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live-draft session state (first-$3-draft feedback):
 * - `mine`  — players I drafted this draft (the DRAFT button on a row)
 * - `queue` — my watch list / target pool (the ★ toggle), the Underdog
 *   "watch/queue" pattern ported over: star players between picks, filter
 *   the board down to them mid-draft.
 * Both persist to localStorage for the hours-long 30s/pick slow drafts;
 * `clearAll` runs between drafts alongside the drafted-board reset.
 *
 * `namespace` (a profile id, #47/#44) isolates a non-default profile's
 * roster/queue under suffixed keys — False Nine's own keys (`namespace`
 * omitted) are untouched, so switching profiles never tramples the
 * flagship's session.
 *
 * The queue is a perma-queue (#57): it survives `clearAll()` (the "New
 * draft" reset) so targets queued ahead of a draft — a late-round sleeper
 * whose situation changed since the last snapshot/model run — aren't lost
 * once the draft clock starts. `clearQueue()` empties it explicitly.
 */
const MINE_KEY = 'bbpl-mine';
const QUEUE_KEY = 'bbpl-queue';

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function useDraftSession(namespace?: string) {
  const mineKey = namespace ? `${MINE_KEY}:${namespace}` : MINE_KEY;
  const queueKey = namespace ? `${QUEUE_KEY}:${namespace}` : QUEUE_KEY;
  const [mine, setMine] = useState<Set<string>>(() => loadSet(mineKey));
  const [queue, setQueue] = useState<Set<string>>(() => loadSet(queueKey));
  // Each set tracks the key it was last loaded/written for, independently —
  // a shared ref would race when both keys change in the same commit (the
  // second effect would see the first effect's already-updated ref and write
  // stale state into the new namespace before the reload lands).
  const loadedMineKeyRef = useRef(mineKey);
  const loadedQueueKeyRef = useRef(queueKey);

  useEffect(() => {
    if (loadedMineKeyRef.current !== mineKey) {
      loadedMineKeyRef.current = mineKey;
      setMine(loadSet(mineKey));
      return; // switching namespace: reload only, don't overwrite the new key yet
    }
    try {
      localStorage.setItem(mineKey, JSON.stringify([...mine]));
    } catch {
      /* in-memory only */
    }
  }, [mineKey, mine]);

  useEffect(() => {
    if (loadedQueueKeyRef.current !== queueKey) {
      loadedQueueKeyRef.current = queueKey;
      setQueue(loadSet(queueKey));
      return;
    }
    try {
      localStorage.setItem(queueKey, JSON.stringify([...queue]));
    } catch {
      /* in-memory only */
    }
  }, [queueKey, queue]);

  const toggleMine = useCallback((id: string) => {
    setMine((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleQueue = useCallback((id: string) => {
    setQueue((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Reset between drafts: my roster only — the queue is a perma-queue and
   *  survives this (use `clearQueue` to empty it explicitly). */
  const clearAll = useCallback(() => {
    setMine(new Set());
  }, []);

  const clearQueue = useCallback(() => {
    setQueue(new Set());
  }, []);

  return { mine, queue, toggleMine, toggleQueue, clearAll, clearQueue };
}
