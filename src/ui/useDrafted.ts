import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'bbpl-drafted';

/** Load the drafted-player id set from localStorage; corrupt data resets to empty. */
function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

/**
 * Manual mark-drafted state, persisted to localStorage across sessions —
 * the draft-room scratchpad. Cleared explicitly between practice drafts
 * (practice-then-flagship loop on the map).
 */
export function useDrafted() {
  const [drafted, setDrafted] = useState<Set<string>>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...drafted]));
    } catch {
      // Storage unavailable (private mode) — in-memory only for this session.
    }
  }, [drafted]);

  const toggle = useCallback((id: string) => {
    setDrafted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setDrafted(new Set()), []);

  return { drafted, toggle, clear };
}
