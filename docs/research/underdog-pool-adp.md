# Research: Underdog pool and ADP access path

**Ticket:** #5 · **Date:** 2026-08-17 · **Branch:** `research/underdog-pool-adp`

## Question

Can the False Nine player pool and ADP be pulled programmatically from Underdog, without logging in?

## Verdict

**No — not for the actual player pool / ADP.** A narrow slice of Underdog's API is reachable unauthenticated (confirms the contest exists and its metadata), but the player-level draft board / ADP data was not found at any unauthenticated endpoint after systematic probing, and Underdog's Terms of Use explicitly prohibit automated/scraped access regardless of auth state. This is a **blocker, not just a technical gap** — see ToS section below.

## What was tried

### 1. `api.underdogfantasy.com` — unauthenticated probing

Base host resolves and responds (Cloudflare-fronted, Rails/Rack backend per `x-runtime` header). No JS/bot challenge on this host (unlike `app.underdogsports.com`, see below).

| Path | Result |
|---|---|
| `GET /v2/lobby` | **200 OK**, 140 KB JSON. Contains `draft_pools`, `lobbies`, `slate_sit_and_gos`, `slates`, `tournaments`, `weekly_winners`. |
| `GET /beta/v3/over_under_lines`, `/beta/v5/over_under_lines` | **200 OK**. Pick'em-style prop lines (`appearances`, `games`, `over_under_lines`, `players`, `providers`) — currently MLB/NFL only, no soccer/FIFA content in the live response. |
| `/v2/contests`, `/contests`, `/v1/players`, `/v2/players`, `/v1/draft_lists`, `/v2/draft_lists`, `/v2/draft`, `/v2/best_ball_pools`, `/v2/lobbies`, `/v2/draft_pools/{id}`, `/v2/draft_pools/{id}/players`, `/v2/pools/{id}`, `/v2/appearances`, `/v2/player_pool_entries`, `/v2/salaries`, `/v2/big_boards`, `/v2/rankings`, `/v2/adp_reports`, `/v2/slates/{id}`, `/v2/slates/{id}/players` | **404** (plain HTML 404, not a JSON auth-error — consistent with wrong/nonexistent routes, not a gate) |

**Key finding in `/v2/lobby`:** the `tournaments` array includes the actual False Nine contest, unauthenticated:

```json
{
  "id": "ea9924ae-f0fa-4397-850d-6d793f5399f4",
  "title": "The False Nine",
  "description": "EPL Best Ball! - $2k to first!",
  "entry_count": 5887,
  "max_entries": 20,
  "total_rounds": 4,
  "cutoff_at": "2026-08-21T15:29:00Z",
  "rules_url": "https://app.underdogsports.com/rules/tournaments/the-false-nine",
  "slates": [{
    "id": "b2c428e7-939b-4742-9343-c8a2faab535c",
    "sport_id": "FIFA",
    "title": "2026 EPL Season",
    "best_ball": true,
    "start_at": "2026-08-21T17:00:00Z"
  }]
}
```
Source: `curl -s https://api.underdogfantasy.com/v2/lobby -H "User-Agent: Mozilla/5.0"` (2026-08-17). Underdog uses `sport_id: "FIFA"` for EPL soccer contests. This gives entry counts, cutoff time, contest structure, and the slate ID — useful for a status widget, but **no player names, positions, teams, or ADP**.

Guessed player/draft-board paths (`draft_pools/{id}/players`, `slates/{id}/players`, `draftables`, `player_pool_entries`, `rankings`, `adp_reports`) all 404'd. The real draft board is very likely served either (a) behind auth-scoped routes not yet guessed correctly, or (b) pushed over an authenticated WebSocket/ActionCable channel once a draft is joined — Underdog's stack shows Rails conventions (`x-runtime` header) consistent with ActionCable for live draft state.

### 2. Public contest pages / embedded JSON

- `underdogfantasy.com` → 301 redirects to `www.underdogsports.com` (site rebrand as of 2026). `www.underdogsports.com/contests` → **404** (path no longer exists post-rebrand).
- `www.underdogsports.com/games/drafts` → 200, but it's a static Webflow marketing page (`cdn.prod.website-files.com` bundles) — no `__NEXT_DATA__`, no embedded JSON, no XHR calls to the real API visible in the static HTML.
- `app.underdogsports.com` (the actual draft app, formerly `app.underdogfantasy.com`) → **403 "Attention Required" (Cloudflare challenge page)**, even on a bare unauthenticated `GET /`. This host is bot-gated at the edge — plain `curl`/`WebFetch` cannot get past it; it needs a real browser (JS challenge, or a headless browser with a solved challenge / valid `cf_clearance` cookie).
- `play.underdogsports.com` → 200 but is only a mobile deep-link redirector shell, not the app.

### 3. Community-known API surface

- No official Underdog developer docs/API portal exists (confirmed via search — Underdog does not publish one).
- Existing open-source scrapers (e.g. `aidanhall21/underdog-fantasy-pickem-scraper`) target the Pick'em prop-lines endpoints (the same `over_under_lines` family found above), not best-ball draft pools or ADP.
- Third-party ADP aggregators that do show Underdog ADP (STACKED, DraftSharks, FantasyPros, Establish The Run) do not disclose their collection method on-page — no evidence they use a public API; most plausibly scrape the authenticated draft board in-browser or license the feed.

### 4. Terms of Service — hard blocker independent of technical feasibility

Underdog's Terms of Use (`legal.underdogsports.com`, §6 "Improper conduct") explicitly prohibit:

> "scrape, access, monitor, index, frame, link, or copy any content or information on the Services by accessing the Services in an automated way, using any robot, spider, scraper, web crawler, or using any method of access other than manually accessing the publicly-available portions of the Services through a browser or accessing the Services through any approved mobile application, application programming interface, or client application"

Source: https://legal.underdogsports.com/?g=42203 (fetched 2026-08-17). This applies regardless of login state and covers both the unauthenticated `/v2/lobby` probing above and any logged-in scraping. Recommend treating **all** programmatic pulls from Underdog — auth or not — as against ToS.

## What a logged-in session task would need (if pursued despite ToS)

Not attempted (per ticket scope — no credentials used). For the record, based on the `app.underdogsports.com` Cloudflare gate:
- A real authenticated browser session (cookies: Underdog auth/session cookie + a solved Cloudflare `cf_clearance` cookie) — plain `curl` with a bearer token is unlikely to be enough because the edge challenge triggers on `app.*` before any app-level auth is checked.
- Practically this means a headless-browser automation (Playwright/Puppeteer) driven by a logged-in human, not a lightweight API client — which is also the more clearly ToS-violating path.

## Recommendation

Given the ToS prohibition and the missing player/ADP surface even unauthenticated, **do not build an Underdog scraper**. Options for the False Nine cheat sheet:
1. Manual/semi-manual entry of the player pool (EPL player list is a bounded, slow-changing set — squads for 20 clubs).
2. Source ADP-equivalent rankings from free EPL fantasy data (e.g. official FPL API, which is a documented free/public endpoint) as a proxy, cross-referenced manually against Underdog's own published rankings articles (e.g. RotoWire's "Underdog EPL Best Ball Rankings 2026/27" — editorial content, not ADP, but same universe of players).
3. If ADP is truly required, treat it as a manual, periodic human data-entry task (e.g. a maintainer copies the draft-board screen into a small JSON) rather than automated pulling — keeps within ToS and within the static-only architecture constraint (`AGENTS.md`).
