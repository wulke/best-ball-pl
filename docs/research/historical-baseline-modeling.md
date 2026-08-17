# Modeling: historical-stats baseline under False Nine scoring

**Related:** #3 (scoring rules), #4 (FPL API surface) · **Date:** 2026-08-17 · **Branch:** `research/historical-baseline-modeling`

## Question

Can we skip projection modeling (at least for baselining) by re-scoring each player's **historical** stat lines under Underdog's False Nine scoring, and mapping that against FPL price to see how FPL scoring/pricing translates to Underdog best ball?

**Answer: yes — and it's not just a baseline, it's the substrate.** Every future model (regression, xG-driven, minutes-prior) ultimately emits a stat line; a pure `statline → Underdog points` function scores all of them. The historical baseline is the cheapest first consumer of that function.

## Why it's the right v1

- **Transparent/auditable** — a number can be traced to exact stat inputs; no black box. When a ranking looks wrong, the cause is inspectable.
- **Free-path compliant** — sources are the free FPL API + FBref league pages (below).
- **Produces the translation artifact** — per-player Underdog pts/90 vs FPL price (`pts/90 per £M`) answers "how does FPL value map to Underdog value" directly, per position.
- **Reusable scorer** — projection upgrades swap the *stat-line generator*, not the scoring math.

## Stat coverage: FPL alone cannot express ~half the scoring

Mapping the False Nine table (see `false-nine-scoring.md`) against sources (FPL API fields verified in `fpl-api-surface.md`):

| Underdog stat | Pts | FPL API (`bootstrap` / `history_past`) | FBref league page |
|---|---|---|---|
| Goal | +8.0 | ✅ `goals_scored` | ✅ |
| Assist | +4.0 | ✅ `assists` | ✅ |
| Shot on target | +2.0 | ❌ | ✅ Shooting (`SoT`) |
| Shot off target | +1.0 | ❌ | ⚠️ `Sh − SoT` (includes blocked — see config) |
| Chance created | +1.0 | ❌ | ✅ Pass Types (`KP`) |
| Cross | +0.75 | ❌ | ✅ Pass Types (`Crs`) |
| Tackle won | +0.5 | ❌ | ✅ Defense (`TklW`) |
| Pass completed | +0.05 | ❌ | ✅ Passing (`Cmp`) |
| Clean sheet (G/D) | +5.0 | ✅ `clean_sheets` | ✅ |
| GK win | +5.0 | ⚠️ derivable from fixtures | ✅ GK (`W`) |
| Save (GK) | +2.0 | ✅ `saves` | ✅ (`SoTA − GA`) |
| Penalty save (GK) | +3.0 | ✅ `penalties_saved` | ✅ |
| Goal conceded (G/D) | −2.0 | ✅ `goals_conceded` | ✅ |

**The missing terms are not small.** A possession mid completing ~40 passes/match banks ~2.0 pts/GW before any attacking return; a volume striker's 3 shots ≈ +2–5 pts before goals; a cross-heavy fullback adds 0.75/ball. Dropping these doesn't shift everyone down uniformly — it **mis-ranks by archetype** (volume shooters, crossing fullbacks, deep-lying passers all get underrated vs pure G+A merchants). Conclusion: FPL API carries identity/price/position and the defensive+GK terms; FBref's six league pages per season (standard / shooting / passing / pass types / defense / GK) carry the volume terms.

## Source plan

| Source | Role | Cost |
|---|---|---|
| FPL `bootstrap-static` | Identity, position, price, CS/GC/saves/pen-saved; `history_past` = prior-season aggregates (incl. xG/xA) | 1 call ~1.4MB |
| FBref EPL league pages | SoT, KP, Crs, TklW, Cmp, GK W — **6–7 pages per season** | ~7 requests/season |
| Understat (optional, Tier 2) | Per-match shots/xG/xA; outfield-focused — thin/no GK coverage | 1 page/player when needed |

FBref caveat: Cloudflare-fronted, requests rate-limited by etiquette (~≤10 req/min, cache aggressively). At 7 pages/season this is fine, but the ETL must commit the parsed result to the repo, never re-fetch inline.

## Granularity: two tiers

1. **Tier 1 — season aggregates (build first):** 2025/26 (and optionally 2024/25) totals per player → total Underdog pts, pts/90, pts/90-per-£M. Answers cross-position value-vs-price immediately; sourceable entirely from FPL + the 7 FBref pages.
2. **Tier 2 — per-match-week scores:** the real best-ball currency, since Underdog auto-starts your **top 9 per GW** — value lives in weekly distribution and ceiling, not season totals. Past-season per-match needs Understat (outfield) or FBref match logs (1 page/player — expensive, batch it); current-season per-GW is nearly free once live via FPL `event/{gw}/live` (1 call covers all players). **Round 1 scores MW 1–26 only** — scale weekly rates by 26, not 38; DGWs are leverage, not noise.

## Scoring config: parameterize the unknowns, don't assume them

Per `false-nine-scoring.md` gaps, the scorer takes a config object with defaults + documented uncertainty:

- Cards (yellow/red) point values — unconfirmed; default 0, sensitivity-flagged.
- Clean-sheet minutes threshold (60'?) — unconfirmed; test 0/60 variants.
- Penalty events beyond GK saves (won/conceded/missed) — unconfirmed; default 0.
- **Blocked shots**: does a blocked shot earn the +1 "off target"? FBref `Sh − SoT` conflates them; Opta definition needed. Parameterize `blockedCountsAsOffTarget`.
- `chance created` = FBref `KP` (key pass) — Opta-equivalent by definition; low risk.

Sensitivity-testing these knobs (rerun ranking under each variant, diff the top-100 order) is the acceptance test for the baseline — not silently baking in guesses.

## Known distortions vs FPL pricing (things the baseline should surface, not hide)

- **Goal concession is 4× harsher than FPL's effective −1-per-2**: bad-team defenders/GKs get crushed under Underdog rules. Expect the value-vs-price table to demote FPL-cheap-defense heuristics.
- **Pass volume compresses positional gaps**: 0.05/pass accumulates for everyone but possession teams' mids/defenders most.
- **Last season ≠ projection**: transfers, promoted squads (2025/26 Championship stats out of scope v1 — their players carry 2024/25 EPL history or none), new signings unpriced by history. Report per-90 alongside totals; treat totals as minutes-biased.
- GK win +5 makes GK value team-strength-levered far beyond FPL's 4-pt save/CS framing.

## Implementation slice (order)

1. **Scorer module** (pure fn, no I/O): `(statline, config) → points`, per-position aware. Verified against a committed fixture table of known 2025/26 stat lines (a handful of archetypes: elite GK, crossing fullback, possession mid, volume striker, cheap attacker).
2. **ETL: FPL `bootstrap-static` + FBref season pages** → joined per-player stat lines → scored snapshot.
3. **UI column(s)**: Underdog pts/90, pts/90-per-£M on the cheat sheet.
4. Tier 2 (per-GW distributions) after the cheat sheet is usable — pre-season it's blocked on Understat/FBref-log backfill anyway.

**Not in scope v1:** projecting 2026/27 itself, cards pricing (until confirmed), Championship/promoted-player modeling, ADP integration.
