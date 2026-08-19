# Research: The Free Kick / FIFA Daily V2 ruleset (beyond primary-confirmed contest-page facts)

**Branch:** `research/free-kick-daily-ruleset` · **Date:** 2026-08-19

## Question

Underdog's `free-kick-gw1-sat` contest profile (`src/contest/profiles.ts`) already has scoring, roster shape,
draft size, and prize structure primary-confirmed from a captured contest page. This ticket investigates the
*mechanics* around that: no-bench scoring behavior, snake order/tiebreaks, club-diversity rules, the wider
daily-vs-season product landscape, and whether the existing recap-paste parser format (#22) will hold for a
6-round/6-drafter daily room.

## Access note (same situation as `false-nine-scoring.md`)

- `help.underdogsports.com` and `app.underdogsports.com` both return **HTTP 403 "Attention Required! | Cloudflare"**
  to `curl`/`WebFetch` directly (`WebFetch` itself is Cloudflare-blocked here too, not just `curl`).
- Wayback Machine (`archive.org/wayback/available` + `web.archive.org/web/<ts>/<url>` fetched via `curl`, not
  `WebFetch` — `WebFetch` cannot reach `web.archive.org` at all in this environment, `curl` can) has snapshots
  for every `help.underdogsports.com` help-center article cited below, all captured **2026-07-02**. That is a
  single crawl date, so all of them reflect the site's rules as of ~7 weeks before this research, not
  necessarily today (2026-08-19) — flagged per-finding below where it matters.
- Underdog's public API (`GET https://api.underdogfantasy.com/v2/lobby`, unauthenticated, works via plain `curl`)
  turned out to be far more useful for this ticket than for the False Nine research: it surfaces the **live
  daily-contest catalog** including the actual "The Free Kick" GW1 Saturday entry, sibling contests on the same
  slate, and enough IDs to establish product taxonomy. Full raw response fetched 2026-08-19 (not committed —
  it's a live snapshot, not a stable artifact; re-fetch if this needs re-verifying).

## Finding 0 (important framing correction): "The Free Kick" name is reused across two different products

**Confidence: primary-sourced.**

`help.underdogsports.com/en/articles/14694347-the-free-kick` ("THE FREE KICK TOURNAMENT RULES", captured
2026-07-02) documents **a $1-entry, 4-round bracket tournament tied to the 2026 World Cup** — 12-man roster,
6-man bench, weekly auto-best-starters (1 FW×2/D×1/G×1/MD×1/Flex×1 = 6 starters, "Underdog automatically selects
the entrant's highest scoring players... to be starters"), entries advance/eliminate across 4 rounds culminating
in a 500-person final group, $2,500 to first. This is **not** the contest the `free-kick-gw1-sat` profile models.

The profile's actual contest — confirmed via the live lobby API (`v2/lobby`, `draft_pools[]`, fetched 2026-08-19)
— is a **same-named but structurally distinct daily entry** on the FIFA `"Sat Main Slate"` (`slate_id
a48d4ca7-b091-4ff6-811a-0de8b4a77804`, `game_count: 4`, `cutoff_at: 2026-08-22T13:41:00Z`, `best_ball: false`):

```
{
  "title": "The Free Kick",
  "slug": "the-free-kick-08-22-2026",
  "description": "20 entry max - $1k to first",
  "max_entries": 20,
  "cutoff_at": "2026-08-22T13:41:00Z",
  "contest_style_id": "487823ff-2858-47f4-b666-03c80890f687",
  "rules_url": "https://app.underdogsports.com/rules/sports/soccer",
  "image_url": ".../assets/royale/ud-soccer-ball-and-cleat.png"
}
```

This matches the profile's primary-confirmed facts exactly (20 max entries, $1k to first, 13:41Z cutoff, 4-game
slate). It sits alongside **three sibling contests on the identical slate** sharing the same `contest_style_id`
(i.e. same roster/scoring rules, different prize tiers/entry caps) — `"Match Day Mania"` ($4k to first, 135 max
entries), `"UD Match Day Mania"` (admin-only), and `"The Clean Sheet"` ($500 to first, 13 max entries). So "The
Free Kick" here is one prize-tier product on a shared daily-slate engine, not a unique format — worth knowing if
future tickets try to model prize-pool dynamics.

`rules_url` for the daily product is `https://app.underdogsports.com/rules/sports/soccer` (a generic per-sport
rules page, distinct from the World-Cup Free Kick's `rules/tournaments/...` URL) — this page 403s live and has
**no Wayback snapshot** (`archived_snapshots` empty as of this check), so its exact text is unconfirmed; findings
below are pieced together from Underdog's generic (cross-sport) draft/contest-type documentation instead.

**Practical implication for the doc below:** none of the World-Cup "Free Kick" tournament's rules (bracket
advancement, 12-man roster, 6-man bench, $1 entry) apply to the profile's contest. Every finding below is scoped
to the *generic Underdog daily-contest mechanics* that the profile's actual "The Free Kick" (soccer daily slate)
inherits, since no soccer-specific daily-contest rules page was reachable.

## Q1 — No-bench inference: are all 6 slots simply summed, no weekly-starter logic?

**Confidence: corroborated-but-unverified** (strong circumstantial + cross-sport corroboration, not a soccer-daily-specific primary quote).

Underdog's own contest-type taxonomy (`help.underdogsports.com/en/articles/11036935-draft-contest-types-and-entry-labels-explained`,
captured 2026-07-02) draws a hard line between two contest families:

> **Best Ball** — "...Underdog automatically selects the participant's highest scoring players at the designated
> positions to be 'starters' and only those players' statistics are counted towards the participant's
> accumulated score."
>
> **Battle Royale** — "Participants select players through a snake draft, and scores are matched up against
> every other score in the contest, not just the participants in your particular draft group. Contests are
> typically for shorter periods of time, such as one day or one week."

The auto-best-starters/bench mechanic is stated as a **Best Ball-specific** feature; the Battle Royale definition
describes total-roster contest-wide scoring with no mention of starters/bench at all. The daily FIFA slate's
`draft_pools` entries (including "The Free Kick") all use `image_url` paths under `/assets/royale/...` — the same
asset path as Underdog's NFL/NBA daily Battle Royale products — strongly suggesting these are Battle Royale
`contest_style`, not Best Ball, on Underdog's backend (`slate.best_ball: false` on the FIFA Sat Main Slate record
corroborates this directly). The profile's roster shape (`rosterSize: 6`, 6 starter+flex slots, 0 bench) makes
the question somewhat moot regardless — with zero bench slots there's nothing for a best-nine selector to choose
*from* even if the mechanic existed.

Cross-sport corroboration: Underdog's NFL "Battle Royale" is independently described (RotoGrinders/Stokastic
strategy content, not Underdog's own pages) as "six rounds (snake style)... leagues of six" with a
QB/RB/WR/WR/FLEX/TE roster — i.e. every drafted player is a starter, no bench, matching the Free Kick's 6-round/
6-drafter/no-bench shape structurally. Underdog is known to run one shared "daily contest" engine across sports
(same finding echoed in the task's original context), so this is a second independent confirmation of the same
mechanic, just not soccer-specific.

**New finding not previously in scope, worth flagging to the model/UI:** the Battle Royale definition explicitly
states scoring is **contest-wide, not draft-room-relative** — "your performance will be measured against the
scores of every other team in the entire contest, not just those in your group" (also stated on the dedicated
`help.underdogsports.com/en/articles/10717109-battle-royales` page, captured 2026-07-02). The Free Kick's 6-person
draft room only determines the player pool split (snake-drafted against 5 opponents for card access); the actual
leaderboard/payout ranks against **all** entries in the $10k contest (up to 20 entries × however many rooms fill),
not just your 6-person room. This may already be assumed correctly in existing model/review code — flagging here
since it wasn't listed as an established fact in the task context.

**Also newly surfaced, not previously documented anywhere in this repo:** Battle Royale has an **automatic
player-substitution rule** for ruled-out players — "In the event that a player you've drafted is ruled out before
their game begins and is unable to play, they will be automatically swapped out for an undrafted player, provided
there is another game available in the slate that hasn't started yet. You must still adhere to roster construction
requirements after the swap." For a 4-game Saturday slate this is plausible but not certain to trigger (needs an
undrafted, same-position-eligible player from a *different, not-yet-started* game on the same slate — with the
draft close at 13:41Z and slate close at 13:52Z, the swap window before the first kickoff is only ~8 minutes, so
in practice this mechanic likely rarely fires for GW1 Saturday specifically, but it exists as a platform rule and
should not be assumed away for other slates).

## Q2 — Snake draft order + tiebreaks (6-round / 6-drafter room)

**Confidence: primary-sourced** (generic Underdog rule, not FIFA/Free-Kick-specific — no soccer-specific override found).

- **Snake order:** confirmed both in the Free Kick World Cup tournament page and generically —
  "Entrants select players through a snake draft. In a snake draft, the pick order is reversed each round. In
  other words, the entrant with the first pick in round 1, will have the last pick in round 2 and the first pick
  in round 3." (`help.underdogsports.com/en/articles/14694347-the-free-kick`). For a 6-round contest this yields
  standard snake: picks 1–6 (R1, seed order), 7–12 (R2, reversed), 13–18 (R3, seed order), 19–24 (R4, reversed),
  25–30 (R5, seed order), 31–36 (R6, reversed).
- **Draft-order assignment:** "Draft order is determined entirely at random... It is technologically impossible,
  given the way Underdog's backend is built, to manipulate draft order in any fashion."
  (`help.underdogsports.com/en/articles/11060564-how-is-draft-order-determined`, captured 2026-07-02).
- **Tiebreak:** for daily/Battle Royale-style contests specifically —
  "Daily Tournament: In the event of a tie, users included in the tie will split the prizes their positions
  cover evenly. For example, if 1st place pays $30, 2nd place pays $20, and 3rd place pays $10, and there is a
  3-way tie for 1st, the 3 winners will split a $60 prize. The 2nd-highest unique score would then take home 4th
  place." (`help.underdogsports.com/en/articles/10862376-what-happens-in-a-tie-draft-contest`, captured
  2026-07-02; word-for-word identical language also appears on the dedicated Battle Royales article). This is a
  simple even-split-of-covered-prizes rule with no further disambiguation (no coin-flip, no earliest-entry
  tiebreak for daily contests specifically — that earliest-entry tiebreak only appears under the page's
  *season-long tournament playoff* section, not the daily-contest section).

## Q3 — Club diversity minimum (≥2 clubs, or ≤N-per-club cap) for daily contests

**Confidence: unresolved — and also unconfirmed for False Nine itself, contrary to how the task context framed it.**

This ticket's brief characterized a "no more than N players from one club" rule as "known from False Nine," but
`docs/research/false-nine-scoring.md` (read in full before starting this doc) **does not actually contain any
such rule** — it isn't in the points table, the weekly-starter section, or the gaps list. A repo-wide grep
(`docs/`, `src/`) turned up no mention of a club-diversity minimum or maximum anywhere. So the premise appears to
be a misremembering, not an established fact this doc could build on.

Searched specifically for this ticket: Underdog's own "Best Ball Contest Guidelines" page (the same one already
cited in `false-nine-scoring.md` for scoring cadence) contains no club/team/diversity/limit language at all on
re-check. RotoWire's Premier Pup strategy guide discusses club concentration only as **voluntary strategy
advice**, not a platform rule: *"Don't over-stack a single club. Three or four players from one team is a healthy
ceiling, enough to correlate without sinking your whole roster if that team has a bad month."* — explicitly
framed as risk-management advice, not an enforced maximum. No source (Underdog's own pages, RotoWire, Rotogrinders,
or the live lobby API's contest metadata) states a minimum-club-count or maximum-players-per-club rule for either
Best Ball or Battle Royale/daily contests.

**Conclusion: no club diversity rule of any kind — minimum or maximum — was found to exist on Underdog for any
soccer product**, season-long or daily. If the model currently assumes one, that assumption should be revisited;
if this needs to be pinned down definitively, it requires a logged-in browser session against the live
`app.underdogsports.com/rules/sports/soccer` page (403s to every automated tool tried here, and has no Wayback
snapshot).

## Q4 — Product landscape: is there a multi-GW weekly draft product distinct from the daily slate?

**Confidence: corroborated-but-unverified** (live-API snapshot at one point in time, not a documentation guarantee).

The live `v2/lobby` API's `tournaments[]` array (fetched 2026-08-19) lists every currently-offered
season/tournament-style contest across all sports. Filtering to FIFA/soccer-flavored titles, exactly two appear:
**"The Premier Pup"** and **"The False Nine"** — both season-long (weeks 1–26 qualifier + bracket rounds),
matching what `false-nine-scoring.md` already documents. No FIFA-flavored **"Weekly Winners"**-type product
(Underdog's third contest family — "Drafted teams compete for the duration of a specified season... award prizes
to the highest-scoring teams for each scoring week throughout the season," per the Draft Contest Types page) was
found in this snapshot; the one `weekly_winners[]` entry present in the lobby response is an NFL contest
(cutoff `2026-09-09`, unrelated to soccer).

The FIFA daily-slate side, by contrast, is exactly the four `draft_pools[]` entries already covered under
Finding 0 — all sharing one `slate_id` and `contest_style_id`, differing only in prize tier/entry cap. No
multi-gameweek *daily-style* draft (e.g. a 2–3 week window, shorter than a full season but longer than one
slate) was found for soccer as of this check.

**Caveat:** this is a live-catalog snapshot, not a documentation page — Underdog visibly launches/retires
contests on a rolling basis (e.g. the World Cup "Free Kick" tournament itself doesn't open until closer to the
2026 World Cup), so "not currently in the lobby" is evidence of absence only as of 2026-08-19, not a permanent
guarantee no such product exists or will exist. Re-check the lobby endpoint if this matters for a downstream
ticket closer to the World Cup or later in the EPL season.

## Q5 — Daily recap page format: does the `round.pick|overall` anchor survive for 6-round/6-drafter dailies?

**Confidence: unresolved for the actual page appearance; primary-sourced (source code) for why the parser itself shouldn't need changes.**

No captured or Wayback-archived example of an actual Underdog daily-contest (Battle Royale) recap/results page
was found — the existing fixture (`data/drafts/fixtures/2026-08-18-wulke-first-draft.txt`, referenced in
`src/ui/drafts/parse.ts`) was captured from a **season-long Best Ball** draft, not a daily one, and no daily-slate
recap page reference turned up in any of the sources searched (RotoWire, Rotogrinders, Underdog help center, or
the lobby API — the API has no recap/results endpoint, confirmed by the earlier `underdog-pool-adp` research and
re-confirmed here by probing `draft_pools`/`slate_sit_and_gos` structures, which carry contest metadata only, no
per-pick history).

What *is* confirmed by reading `src/ui/drafts/parse.ts` directly (#22's parser): the anchor regex is

```ts
const ANCHOR = /^(\d{1,2})\.(\d{1,2})\s*\|\s*(\d{1,3})$/;
```

i.e. `round . pickInRound | overallPick` — generic, with no hardcoded assumption about total drafters, room size,
or round count baked into the pattern itself (the doc comment in the task brief calling it a "totalDrafters"
anchor is a slight mischaracterization worth correcting for future readers: the second number is *overall pick
number*, not room size — for a 6-drafter room, round 1's `X.6|6` line happens to have `pickInRound == overall`
only because 6 == draft size, not because the field itself encodes draft size). The parser's team/name/pos-club
line-shape assumptions (`team` line above the anchor, `name` then `POS - CLUB` below) are also generic, not
season-format-specific. So **mechanically**, nothing in the parser as written should break against a 6-round/
6-drafter recap, provided Underdog's daily recap page uses the same three-line-per-pick DOM/copy shape as the
season-long one it was built against — which is the one thing that remains genuinely unverified. Given both
products share draft infrastructure (per Finding 0/Q1, "Battle Royale" and "Best Ball" both run through
Underdog's shared draft/snake-pick engine, just with different post-draft scoring), reusing the same recap
template for both is plausible but not confirmed.

**Gap:** confirming this needs an actual pasted/saved daily-contest recap page (e.g. after the GW1 Saturday
Free Kick draft completes 2026-08-22) run through `parseRecap` — the cheapest real test available once a draft
exists, no browser-session workaround needed for this one specifically.

## Addendum for `false-nine-scoring.md`: stronger scoring-table source found

While investigating Q1, this research surfaced a **directly Underdog-authored** scoring comparison page —
`help.underdogsports.com/en/articles/11159786-daily-vs-best-ball-scoring` ("Daily vs Best Ball Scoring", captured
via Wayback 2026-07-02) — that lists Underdog's own per-sport scoring tables for both contest families side by
side. For **Soccer/FIFA**, the "Daily: All Players" / "Daily: Goalkeeper" / "Daily: GK and Defender" tables are
**value-for-value identical** to the "Best Ball: All Players" / "Best Ball: Goalkeeper" / "Best Ball: GK and
Defender" tables directly below them on the same page — both matching the point values already in
`false-nine-scoring.md`'s table (Goal 8.0, Assist 4.0, Shot on Target 2.0, Shot off Target 1.0, Chance Created
1.0, Cross 0.75, Tackle Successful 0.5, Pass Successful 0.05, GK Save 2.0, Penalty Save 3.0, Goals Conceded -2.0,
Win 5.0, Clean Sheet 5.0). This is a stronger source than the RotoWire/Rotogrinders corroboration
`false-nine-scoring.md` currently relies on for the same numbers — it's Underdog's own page, not a third-party
strategy article — though it's still only reachable via Wayback, same caveat as everything else there. Notably,
this page does **not** list card, minutes-threshold, or penalty-event point values either — so the existing
"not found in any accessible source" gap in `false-nine-scoring.md` for those stands even against this stronger
source; it appears Underdog genuinely doesn't score those events for soccer, not just that no one has published
the numbers. A one-line pointer to this page was appended to `false-nine-scoring.md`'s gaps section rather than
rewriting its existing citations.

## Gaps / follow-ups

1. **Q3 (club diversity) is a clean no-finding, not a partial one** — worth telling whoever raised the premise
   that it doesn't appear to be a real Underdog rule for any soccer product, so nothing in the model should be
   built assuming one exists unless a logged-in-browser check of `app.underdogsports.com/rules/sports/soccer`
   turns up different text.
2. **Q5's actual recap-page shape is unverified** — the fastest path to closing this gap is simply running the
   real GW1 Saturday Free Kick recap through `parseRecap` once that draft completes (2026-08-22), not a browser
   session; flag this as a natural fast-follow right after the first live daily draft.
3. `app.underdogsports.com/rules/sports/soccer` — the daily product's actual `rules_url` — was unreachable by
   every method tried (403 live, no Wayback snapshot). If a logged-in browser session becomes available (same
   ask as `false-nine-scoring.md`'s gap #1), this page is the single highest-value thing to capture: it would
   settle Q3 and give a soccer-daily-specific (not generically-inferred) version of Q1's Battle-Royale mechanics.
4. The Finding-0 correction (two different "Free Kick" products sharing a name) should probably be surfaced to
   whoever maintains `src/contest/profiles.ts`'s doc comments — the comment above `FREE_KICK_GW1_SAT` doesn't
   currently disambiguate from the World Cup bracket tournament of the same name, which could confuse a future
   reader searching Underdog's own help center for "The Free Kick" and landing on the wrong rules page.
