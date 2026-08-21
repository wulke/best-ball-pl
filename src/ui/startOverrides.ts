import type { StartOverrideMap } from '../model/lineups.js';

/** Read the #97 override-map contract. The editor is intentionally a later
 * UI slice; malformed/stale storage must never block model-default minutes. */
export function loadStartOverrides(profileId: string): StartOverrideMap | undefined {
  try {
    const raw = localStorage.getItem(`bbpl-start-overrides:${profileId}`);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as StartOverrideMap : undefined;
  } catch {
    return undefined;
  }
}
