import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'bbpl-drafted';

/** Load the drafted-player id set from localStorage; corrupt data resets to empty. */
function load(key: string): Set<string> {
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

/**
 * Manual mark-drafted state, persisted to localStorage across sessions —
 * the draft-room scratchpad. Cleared explicitly between practice drafts
 * (practice-then-flagship loop on the map).
 *
 * `namespace` (a profile id, #47/#44) isolates a non-default profile's marks
 * under a suffixed key — False Nine's own key (`namespace` omitted) is
 * untouched, so switching profiles never tramples the flagship's marks.
 */
export function useDrafted(namespace?: string) {
  const key = namespace ? `${STORAGE_KEY}:${namespace}` : STORAGE_KEY;
  const [drafted, setDrafted] = useState<Set<string>>(() => load(key));
  const loadedKeyRef = useRef(key);

  useEffect(() => {
    if (loadedKeyRef.current !== key) {
      loadedKeyRef.current = key;
      setDrafted(load(key));
      return; // switching namespace: reload only, don't overwrite the new key yet
    }
    try {
      localStorage.setItem(key, JSON.stringify([...drafted]));
    } catch {
      // Storage unavailable (private mode) — in-memory only for this session.
    }
  }, [key, drafted]);

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
