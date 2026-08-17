# Research: Free odds and props sources

Ticket: #6. Question: which free/cheap sources give soccer odds (anytime scorer/assist props, team goal totals, match-win probabilities) usable as projection priors for EPL, and which is the best fit for a hobby pre-draft tool.

## The Odds API (the-odds-api.com)

- **Free tier ("Starter")**: 500 credits/month. Credit cost = `markets_requested × regions_requested` per call (×10 for historical odds). [the-odds-api.com pricing](https://the-odds-api.com/#get-access)
  - Example: 1 market × 1 region = 1 credit/call → ~500 calls/month if you keep requests narrow. Pulling 3 markets × 2 regions = 6 credits/call → ~83 calls/month.
- **EPL coverage**: explicit — "EPL, EFL Championship, German Bundesliga, UEFA Europa & Champions Leagues, Italian Serie A, Spanish La Liga" listed among covered soccer leagues. [the-odds-api.com](https://the-odds-api.com/#get-access)
- **Player props**: available via the per-event odds endpoint (`/v4/sports/{sport}/events/{eventId}/odds`), not the bulk odds endpoint. Soccer markets confirmed: `player_goal_scorer_anytime`, `player_first_goal_scorer`, `player_last_goal_scorer`, `player_assists` (over/under), plus shots/cards props. [the-odds-api.com/sports-odds-data/betting-markets.html](https://the-odds-api.com/sports-odds-data/betting-markets.html)
  - Explicit scope limit: "Soccer player props are available for EPL, French Ligue 1, German Bundesliga, Italian Serie A, Spanish La Liga, and MLS. **Coverage is currently limited to US bookmakers.**" — meaning UK/Irish books (Bet365, Betfair SB) are not the source; odds come from US books (DraftKings, FanDuel, etc.) which still price EPL props for the US market.
- **Rate limits**: usage tracked via response headers `x-requests-remaining` / `x-requests-used`; a 429 is returned once the credit budget is exhausted for the period (no separate per-minute cap documented). [the-odds-api.com/liveapi/guides/v4](https://the-odds-api.com/liveapi/guides/v4/)
- **Auth**: simple query-string `apiKey={apiKey}`, no OAuth. [the-odds-api.com/liveapi/guides/v4](https://the-odds-api.com/liveapi/guides/v4/)
- **Licensing/ToS**: no explicit personal-use restriction found in the docs pages fetched; standard commercial API terms apply (not independently verified against a full ToS/EULA page — flag as unconfirmed if redistribution is ever considered).
- **Practical note for player-prop-per-player-per-gameweek use**: because per-event odds cost credits per market×region and props require the per-event endpoint (not bulk), a free-tier budget realistically supports **spot-checking a handful of matches per gameweek**, not a full 10-fixture EPL slate at player-prop granularity, every week, all season.

## football-data.org

- **Free tier ("Tier One")**: rate limit **10 calls/minute**. [football-data.org/pricing](https://www.football-data.org/pricing)
- **Competitions**: free tier explicitly includes **Premier League (England)**, plus Championship, Champions League, Bundesliga, La Liga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Brazil Serie A, World Cup, Euros — "Access to data of these leagues & cups is free. Forever." [football-data.org/coverage](https://www.football-data.org/coverage)
- **Odds**: **not included in any core tier.** A separate paid "Odds Add-On" exists at €15/month covering 40 competitions with pre-match odds. [football-data.org/pricing](https://www.football-data.org/pricing)
- **What it's actually good for**: fixtures, results, standings, squads, team/area metadata — a solid free source for the *schedule/results* backbone, but **not an odds source** unless the add-on is purchased.
- **Auth**: API-key based, account signup required (`X-Auth-Token` header per standard football-data.org convention).

## api-football (api-sports.io / api-football.com)

- **Free plan**: **100 requests/day**, and — per the vendor's own onboarding material — "access to every endpoint without exception," meaning the free key can hit `/odds` (same data paid users get, just capped daily volume). [search-verified via api-football.com pricing/getting-started page; direct fetch of api-football.com blocked by Cloudflare 403 for this agent — cross-referenced via two independent search snippets pointing at the same official pricing/docs pages]
- **Odds endpoint characteristics**: pre-match odds only on the standard `/odds` endpoint (live odds is a separate, more limited feature), sourced from **a limited set of bookmakers**, updated roughly every 3 hours, with odds becoming available **1–14 days before kickoff** and only a **7-day history retention window** (old odds roll off).
- **Player props**: **not confirmed present.** api-football's odds coverage is oriented to match-level markets (1X2, over/under, BTTS, handicaps, double chance) via bookmaker feeds; no anytime-goalscorer/player-prop market was found referenced in any fetched or searched source. Treat as **team/match-level odds only**, not a player-prop source.
- **Direct-fetch caveat**: `api-football.com` and `api-sports.io` documentation pages returned HTTP 403 to this agent's fetch tooling (likely bot/Cloudflare protection) — the above is corroborated by two independent search-engine summaries citing the official pricing and getting-started pages, not a raw doc fetch. If precise odds-endpoint parameters matter before committing to this source, do a manual signup + `curl` verification (a free key takes seconds to obtain).

## Betfair Exchange (developer.betfair.com)

- **Free access**: the **Delayed Application Key is free** for development purposes, for both private customers and licensed software vendors — no funding requirement. [support.developer.betfair.com — "Are there any costs associated with API access?"](https://support.developer.betfair.com/hc/en-us/articles/115003864531-Are-there-any-costs-associated-with-API-access)
- **Live key cost**: a **Live Application Key costs a one-off £499 activation fee** (non-refundable) and additionally requires a funded, KYC-verified account — real-time data is gated behind this. The delayed key alone is fine for pre-draft/analytical use where minute-by-minute freshness doesn't matter (this is a pre-draft prior, not live in-play trading).
- **Soccer market coverage confirmed on the Exchange**: **Anytime Goalscorer**, **Correct Score**, **Anytime Correct Score**, "Wincast"/First Goal Wincast, 1X2 match odds, over/under goals, BTTS — all standard exchange markets exist for EPL fixtures. [support.betfair.com exchange football rules pages]
- **Why this is valuable despite friction**: exchange back/lay prices convert directly to implied probabilities (1/decimal_odds, then de-vig against the back-lay spread) and represent a real, liquid market-consensus prior for anytime-goalscorer — arguably the single best free proxy for "market believes player X scores anytime" since it's peer-to-peer wagering, not a bookmaker's overround-padded price.
- **Access mechanics**: requires a real Betfair account (identity-verified per local gambling regulation) plus a non-interactive login flow (username/password + app key, session token refresh) — meaningfully more integration work than a plain REST API key. Historical/bulk data beyond live delayed streaming would require the paid **Betfair Historical Data** service.
- **ToS constraint to flag**: Betfair API terms restrict the Delayed Key to non-commercial/development use; a hobby pre-draft tool for personal use fits this, but redistributing scraped exchange odds publicly would need review against Betfair's terms (not fully verified in this pass — treat as a flag, not a blocker).

## Other candidates considered, not pursued

- **Oddspapi/SharpAPI/OddsPapi** (aggregator resellers surfaced repeatedly in search results): these are third-party odds resellers with their own free tiers (e.g. SharpAPI ~17,280 free calls/day) but are not primary bookmaker/exchange sources — lower trust for "market prior" accuracy claims, and not independently verified here since the ticket calls for primary sources. Worth a follow-up look only if The Odds API's per-event credit math proves too tight in-season.

## Ranked recommendation for the hobby pre-draft tool

1. **Betfair Exchange (Delayed App Key) for anytime-goalscorer priors.** Free, has the actual target market (Anytime Goalscorer), and exchange prices are the cleanest available proxy for true probability (no bookmaker margin baked in the same way). Higher integration cost (real account, session auth) is a one-time build cost, acceptable for a pre-draft tool that doesn't need live updates.
2. **The Odds API free tier as a secondary/cross-check source**, used sparingly (spot-check top-line matches, not the full slate) given the 500-credit/month ceiling and per-event-endpoint requirement for props. Useful for team-level match-win / goal-total markets across a broader bookmaker set at low credit cost (bulk odds endpoint, no player-prop granularity needed there).
3. **football-data.org free tier for the fixtures/results/standings backbone** — not an odds source, but the right free tool for the schedule data that odds need to be joined against. Confirmed PL coverage, 10 req/min is plenty for a pre-draft batch job.
4. **api-football free tier as a fallback/tiebreaker for match-level odds only** — 100 req/day is workable for a once-a-week batch pull of team-level odds, but skip it if player-prop-level priors are the goal; it doesn't appear to offer them. Note the vendor's docs pages blocked direct fetch in this research pass — verify endpoint shape with a live free key before building against it.

**Bottom line**: no free source gives a clean, bulk, EPL-wide anytime-goalscorer feed with no integration friction. The realistic build is **Betfair Exchange for the goalscorer/assist prior signal** (worth the auth complexity because it's the only free source with the actual player-prop market) layered with **The Odds API + football-data.org for match-level context and schedule**, and api-football held in reserve.
