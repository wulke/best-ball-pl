# Research: Free official EPL lineup sources + pre-close release timing

Ticket: #96. Question: where can the tool pull **actual starting lineups**, free and machine-readable, close enough to a slate's draft close to matter — and when does each source publish relative to kickoff? Feeds [#99](https://github.com/wulke/best-ball-pl/issues/99) (`npm run lineups` ETL) and the start-aware minutes model [#97](https://github.com/wulke/best-ball-pl/issues/97).

All facts below were verified live by `curl` on **2026-08-21** (EPL 2026/27 GW1 eve; GW1 unplayed). Source bar (settled at charting): **official-with-predicted-fallback** — official paths first, predicted-XI aggregators only where an official gap is structural.

## TL;DR recommendation for #99

1. **Primary source: the official Premier League site's pulselive API** — `https://footballapi.pulselive.com/football/fixtures/{fixtureId}?altIds=true` with one header (`Origin: https://www.premierleague.com`), no auth, no key. Its `teamLists[]` carry the **confirmed starting XI** (players with full identity, shirt numbers, captain flags, opta alt-ids) once the site publishes team news.
2. **Timing window:** lists populate ~60–75 min before kickoff (site behavior; **not yet directly observed — verify live on GW1 Sat**). For the Aug 22 slate that means the three 14:00Z fixtures' lists are up by ~13:00Z — **before the 13:41Z close** — and BRE–TOT (16:30Z) lists land ~15:30Z, **after close** (structural, every slate with late kickoffs). So the pull captures 3-of-4 fixtures at close; the late fixture rides the manual override (#98) or a predicted source.
3. **Fallback:** manual per-player start override (ticket #98) for the late fixture and any player whose list wasn't captured. A predicted-XI aggregator (WhoScored/FotMob/FFS) is deliberately *not* wired in v1 — none is cleanly machine-readable (Cloudflare/ToS) and the manual path covers the structural gap; revisit only if the mixed-kickoff gap proves costly after a few slates.
4. **Player join:** lineup entries expose `name.display` + `matchShirtNumber` (+ pulselive `id`, `altIds.opta`); join to FPL with the repo's existing normalized-name matcher (FBref↔FPL tier) — verify against the first real slate.

## 1. Official: pulselive API (premierleague.com) — VERIFIED

The Premier League site's match-centre data comes from `footballapi.pulselive.com` — plain HTTPS, no auth, **no Cloudflare on the API path** (a plain `curl` with only an `Origin` header returns `HTTP 200`; the site's HTML pages are JS-shelled, the API is not).

- **Season discovery:** EPL 2026/27 is compSeason id **841** (verified by scanning `GET /football/compseasons/{id}` — label "English Premier League Season 2026/2027"; 2025/26 = 777). Fixtures list: `GET /football/fixtures?comps=1&compSeasons=841&altIds=true&pageSize=100&page=0`.
- **Aug 22 slate fixture ids (verified):** EVE–CRY **128925**, IPS–SUN **128927**, NFO–LEE **128928** (all 14:00Z), BRE–TOT **128924** (16:30Z); HUL–MUN **128926** (11:30Z, pre-close → excluded from the slate).
- **Lineups payload:** `GET /football/fixtures/{id}?altIds=true` returns `teamLists[0/1]`:
  - Empty until publication: verified pre-match on ARS–COV (status `U`, kickoff Fri 21 Aug 20:00 BST) — `teamLists: [null, null]`.
  - Populated on played fixtures: verified on 2025/26 WHU–CHE (status `C`) — `{ teamId, formation: { label, players: [[…ids…]] }, lineup: [ { name: {display, first, last}, matchShirtNumber, captain, positionInfo, id, altIds: {opta} }, … ], substitutes: […] }`. 11 in the formation grid; bench in `substitutes`.
- **Publication timing:** lists appear when the PL site publishes team news — expected ~60–75 min pre-KO. **Unverified live** (no GW1 fixture had published yet at probe time); the ETL should probe once on GW1 Saturday to pin the exact lead time.
- **ToS/practical:** unofficial but first-party; no key/quota documented; be a good citizen (one pull per slate, cache locally). `altIds=true` keeps the opta player ids for future cross-referencing.

## 2. FPL API: no lineups endpoint — VERIFIED dead end

- `GET https://fantasy.premierleague.com/api/predicted-lineups` → `503` "The game is being updated" (the generic maintenance response served for unknown paths under `/api/`; same for `/api/lineups`). FPL's in-app predicted-lineups product is not exposed via a public endpoint. Not a source.

## 3. Predicted-XI fallbacks — NOT VERIFIED (deliberately deferred)

Candidates for the post-close late-kickoff gap (all with real caveats, none clean):
- **WhoScored / FotMob** — predicted XIs on match pages; Cloudflare/JS-gated, ToS murky; FotMob's public API surface is unstable (a plain `leagues` probe returned 404 HTML).
- **Fantasy Football Scout** — long-lead predicted lineups but paywalled/regenerated content, no API.
- **Understat** — exposes *actual* lineups per match, not predicted: a mirror of the official path, not an independent predictor.

Recommendation stands: v1 uses manual overrides for the late fixture; revisit a predicted source only if the mixed-kickoff gap proves costly after a few real slates.

## Contract notes for #99

`data/lineups/<profile-id>.json` (odds-asset precedent, #61): `fetchedAt` ISO stamp; per-fixture `{ fixtureId (pulselive), kickoff, home: { teamId, abbr, lineup: [{ name, shirt, captain }], substitutes, formation }, away: {…} }`; a coverage mask (which fixtures had published lists at pull time); partial coverage preserved, never fabricated. Pull command run ~30–60 min before close, on demand (manual ETL step — not the scheduled refresh). Doc'd README recipe + PR, per #99.
