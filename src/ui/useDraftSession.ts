import { useCallback, useEffect, useState } from 'react';

/**
 * Live-draft session state (first-$3-draft feedback):
 * - `mine`  — players I drafted this draft (the DRAFT button on a row)
 * - `queue` — my watch list / target pool (the ★ toggle), the Underdog
 *   "watch/queue" pattern ported over: star players between picks, filter
 *   the board down to them mid-draft.
 * Both persist to localStorage for the hours-long 30s/pick slow drafts;
 * `clearAll` runs between drafts alongside the drafted-board reset.
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

export function useDraftSession() {
  const [mine, setMine] = useState<Set<string>>(() => loadSet(MINE_KEY));
  const [queue, setQueue] = useState<Set<string>>(() => loadSet(QUEUE_KEY));

  useEffect(() => {
    try {
      localStorage.setItem(MINE_KEY, JSON.stringify([...mine]));
    } catch {
      /* in-memory only */
    }
  }, [mine]);

  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify([...queue]));
    } catch {
      /* in-memory only */
    }
  }, [queue]);

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

  /** Full reset between drafts: my roster, queue, and the off-board marks. */
  const clearAll = useCallback(() => {
    setMine(new Set());
    setQueue(new Set());
  }, []);

  return { mine, queue, toggleMine, toggleQueue, clearAll };
}
