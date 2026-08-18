/**
 * The recap paste-parser seam (#20 ships everything around it; #22 lands the
 * parser once the first real $3 recap exists as a test fixture — build against
 * reality, not a guessed format).
 *
 * #22 replaces `parseRecap` with the real thing: recap text → full pick log,
 * plus the name matcher (auto-accept confident matches on normalized
 * diacritics/case/punctuation + last-name/first-initial; ambiguous entries
 * carry `candidates` for the preview's one-click confirm queue; the rest stay
 * unmatched) and the draftUrl sniff from the pasted text. Until then this
 * returns `unimplemented` — the Drafts view stores pastes verbatim so the
 * first recap is already captured when the parser lands.
 */
import type { PreviewPick } from './types.js';

export type ParseResult =
  | {
      status: 'ok';
      picks: PreviewPick[];
      /** Room name suggested from the recap, if extractable. */
      suggestedName: string | null;
      /** Underdog draft URL sniffed from the paste, if present. */
      suggestedUrl: string | null;
    }
  | { status: 'unimplemented' }
  | { status: 'error'; message: string };

/** Parse an Underdog draft-recap paste into the full pick log. STUB — #22. */
export function parseRecap(_rawPaste: string): ParseResult {
  void _rawPaste;
  return { status: 'unimplemented' };
}
