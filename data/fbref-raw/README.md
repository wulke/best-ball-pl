# Manually saved FBref pages (gitignored)

FBref is Cloudflare-fronted with no API; automated fetch is blocked, so these
pages are saved by hand from a normal browser (which Cloudflare trusts) and
parsed locally by `npm run fbref`. Parsed output is committed as
`data/fbref.json` — this folder is raw input only, safe to delete afterwards.

## Capture

Open each URL, wait for the stats table to render (saving too early captures
Cloudflare's "Just a moment…" wall), ⌘S → format **HTML Only** (Safari:
*Page Source*), save into this folder. **Filenames don't matter** — the parser
identifies each page by the canonical URL embedded in the file, so whatever
the browser names it works as-is. Do NOT use single-file / webarchive formats.

> **Finding the pages:** FBref's in-page "Statistics" dropdown only lists 5 of
> the stat pages (Standard, Goalkeeping, Shooting, Playing Time, Misc) —
> Passing, Pass Types, and Defensive Actions are NOT in it. Use the direct
> URLs below instead.

### ⚠️ The passing page needs a CSV export (JS-populated cells)

The passing page's pass columns (Cmp, KP, …) are **JS-populated after load** —
no save format captures them (HTML Only, Single File, and even the console
copy path are all unreliable: HTML/MHTML store the pre-JS server document).
The reliable capture is FBref's own CSV export, which is generated from the
rendered table. Per passing page:

1. Open the passing URL, **wait** until the table shows numbers in the
   "Passes Completed"/"Key Passes" columns (scrolling to the table helps).
2. Hover the table header → **Share & Export ▾** → **Get table as CSV (for
   Excel)** → a `.csv` downloads.
3. Save it into this folder as `2025-2026_passing.csv` or
   `2024-2025_passing.csv` (the exact name matters — the CSV carries no
   page URL, so the parser detects it by filename).
4. The old empty passing save can stay (the CSV sorts last and wins) or be
   deleted.

Everything else (shooting, pass types, defense, goalkeeping, playing time)
is server-rendered and saves fine as HTML Only.

| Page | Format | URL |
|---|---|---|
| 2025/26 shooting | HTML Only | https://fbref.com/en/comps/9/2025-2026/shooting/2025-2026-Premier-League-Stats |
| 2025/26 passing | **CSV export** | https://fbref.com/en/comps/9/2025-2026/passing/2025-2026-Premier-League-Stats |
| 2025/26 pass types | HTML Only | https://fbref.com/en/comps/9/2025-2026/passing_types/2025-2026-Premier-League-Stats |
| 2025/26 defense | HTML Only | https://fbref.com/en/comps/9/2025-2026/defense/2025-2026-Premier-League-Stats |
| 2025/26 goalkeeping | HTML Only | https://fbref.com/en/comps/9/2025-2026/keepers/2025-2026-Premier-League-Stats |
| 2025/26 playing time | HTML Only | https://fbref.com/en/comps/9/2025-2026/playingtime/2025-2026-Premier-League-Stats |
| 2024/25 shooting | HTML Only | https://fbref.com/en/comps/9/2024-2025/shooting/2024-2025-Premier-League-Stats |
| 2024/25 passing | **CSV export** | https://fbref.com/en/comps/9/2024-2025/passing/2024-2025-Premier-League-Stats |
| 2024/25 pass types | HTML Only | https://fbref.com/en/comps/9/2024-2025/passing_types/2024-2025-Premier-League-Stats |
| 2024/25 defense | HTML Only | https://fbref.com/en/comps/9/2024-2025/defense/2024-2025-Premier-League-Stats |
| 2024/25 goalkeeping | HTML Only | https://fbref.com/en/comps/9/2024-2025/keepers/2024-2025-Premier-League-Stats |
| 2024/25 playing time | HTML Only | https://fbref.com/en/comps/9/2024-2025/playingtime/2024-2025-Premier-League-Stats |

Partial sets are fine — terms whose page isn't saved (or came up empty) fall
back to league baselines for everyone. Then run:

```bash
npm run fbref
```
