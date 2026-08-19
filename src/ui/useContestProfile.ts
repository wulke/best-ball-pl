/**
 * The active contest profile (#39): which profile the sheet/live panel/review
 * run under. The profile objects live in src/contest/profiles.ts (a code
 * module, imported directly); only the active *choice* persists, as a profile
 * id under `bbpl-profile` in localStorage. Default: False Nine — the flagship
 * pre-draft experience is unchanged until a profile is explicitly switched
 * (the switcher UI itself lands with the sheet-tab slice, #44).
 *
 * Per-profile marks/queue/off-board persistence (map #37) keys these stores
 * by profile id when the switcher lands; today the single active profile owns
 * them, exactly as before.
 */
import { useCallback, useState } from 'react';
import { FALSE_NINE, PROFILES, profileById, type ContestProfile } from '../contest/profiles.js';

const STORAGE_KEY = 'bbpl-profile';

function load(): ContestProfile {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) return FALSE_NINE;
    return profileById(id);
  } catch {
    // Unknown/stale id (profile removed) or storage unavailable — default.
    return FALSE_NINE;
  }
}

export function useContestProfile() {
  const [profile, setProfileState] = useState<ContestProfile>(load);

  const setProfile = useCallback((id: string) => {
    const next = profileById(id); // throws on unknown — callers pass registry ids
    setProfileState(next);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* in-memory only for this session */
    }
  }, []);

  return { profile, setProfile, profiles: PROFILES };
}
