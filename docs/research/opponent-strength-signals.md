# Research: Free in-season opponent-strength signals (DVOA-style)

Ticket: #91. Question: what team-strength signal can we estimate **for free, in-season, updating with the refresh cadence**, such that per-fixture projections adjust for *who you're actually playing* rather than FPL's static pre-season FDR — production adjusted for opponent faced, normalized so league-average opposition = 1.0. Feeds [#92](https://github.com/wulke/best-ball-pl/issues/92) (results-driven opponent factors in the #42 fixture machinery).

All facts below were verified live on **2026-08-21** (EPL 2026/27 opening day, GW1 unplayed) against the sources themselves; the calibration numbers come from a walk-forward study on Understat's complete **2025/26** season (380 matches, 20 clubs × 38 team-matches).

## TL;DR recommendation for #92

1. **Signal: Understat per-match team npxG / xGA** — fetched through the repo's existing Playwright path (dual-purpose `src/etl/understat.ts`, which already loads this exact page for key-pass validation). It is the only free source of per-match team xG with full coverage and no key, quota, or paid tier.
2. **Estimator: shrunk league-mean multipliers** — the exact `#43` pseudo-count form: `A_i = (npxG_i + kA·μ) / (n_i + kA) / μ`, `D_j = (xGA_j + kD·μ) / (n_j + kD) / μ`, with **kA = 6, kD = 10** (grounded below; kA=6 matches #43's `teamK: 6` precedent). Applied at the `fixtureFactors` level keyed off the *opponent's* D (and own A), preserving calendar-mean neutrality.
3. **Home/away: fold into the fixture factor** (league home boost 1.11 observed), **do not split the sample** — splitting halves n and bought nothing measurable.
4. **Promoted clubs / cold start: seed the prior with FDR**, not league mean — `(obs + k·μ·fdrMult)/(n+k)` — so a promoted side never starts rated league-average; zero matches = pure FDR (bit-for-bit parity with #92's settled fallback).
5. **Fallback chain when Understat is stale/down:** snapshot summed player xG/xA (zero plumbing, but GW-gated + decimal-backfill lag) → snapshot fixture GF/GA (zero plumbing, freshest, noisier — competitive only through ~3 team-matches) → pure FDR.

## What each source actually returns (verified 2026-08-21)

### Understat `teamsData` / `datesData` — the recommended path

- The league page (`understat.com/league/EPL/<startYear>`) populates `window.teamsData`, `window.datesData`, `window.playersData` via XHR after JS runs. `curl` gets an 18KB shell with **no embedded data** — the browser requirement the existing client already handles (`launchLocalChromium` + ~9s wait, `src/etl/understat.ts`).
- `teamsData[id]` = `{ title, history: [38 × { h_a, xG, xGA, npxG, npxGA, ppda, deep, deep_allowed, scored, missed, xpts, result, date, … }] }` — per-club chronological per-match rows. This is precisely the DVOA feed: own npxG/xGA per opponent faced. `datesData` = all 380 matches with both sides' goals and xG (`isResult` gates played/unplayed; unplayed entries carry a `forecast`).
- **npxG/npxGA strip penalties** — the right signal for *opponent-strength* (a penalty is ~0.76 xG independent of open-play quality); FPL's feed has no penalty-free variant.
- **Season-rollover lag (trap):** on opening day 2026-08-21, `/league/EPL/2026` still served the **completed 2025/26 season** (title and data both; `/main/2026` → 404). The ETL must probe both `<seasonStartYear>` and `<seasonStartYear−1>` and select the page whose `datesData` contains matches dated inside the current season window — never trust the year in the URL.
- **Scale (trap):** Understat league-wide μ[xG/team-match] = **1.529** vs μ[goals] = **1.375** — Understat xG runs **~11% hot** vs goals league-wide. Always normalize by the signal's own league mean; never mix xG-scale and goal-scale in one multiplier.
- Cost profile: free, no key, no documented quota; one page-load per refresh matches the existing best-effort validation pattern. Per-match rows appear same/next day, **not GW-gated** (freshest of the three in-season paths for mid-week slates).

### Snapshot fixture GF/GA (`homeScore`/`awayScore`) — zero new plumbing

- Already aggregated per club in `src/model/actuals.ts` (`TeamSeasonActuals`: played/GF/GA/CS). Enters per-fixture as played — no GW-completion gating (that gate applies only to player rows).
- Calibration verdict: raw goals need ~2× the shrinkage of xG to compete and **lose to xG-based estimates from ~4 team-matches onward, without reversal, through season's end** (both goals-target and xG-target; tables below). Through weeks 1–3 they are statistically tied. Use as cross-check/fallback, not primary.

### Snapshot summed player xG/xA — zero new plumbing, three caveats

- The pool is the **full 595-player FPL squad list**, so summing `actuals` rows per club covers essentially every minute played. FPL's live feed carries `expected_goals`/`expected_assists` decimals (`src/etl/actuals.ts:77`).
- Caveats: (a) **GW-gated** — a GW enters `actuals` only when every fixture in it is finished (#40), and FPL backfills the xG/xA decimals "shortly after a GW completes" (#43 header) — for a mid-week slate this lags Understat by up to a full GW; (b) per-player values round to 1dp, so a club's summed xG carries small rounding noise; (c) penalties included, no npxG variant.
- Unverifiable today (GW1 unplayed — `event/1/live` returns `{"elements":[]}`); once GW1–3 actuals exist, cross-check FPL-summed club xG vs Understat club xG to size the rounding/coverage gap before ever trusting this as the primary path.

### FPL bootstrap team strengths / FDR — static baseline only

- `bootstrap-static` currently serves 2026/27 with **`strength: null` and `strength_attack/defence_{home,away}` all 0** for every club (observed 2026-08-21) — FPL populates these in-season on an undocumented, sporadic cadence. Per-fixture FDR (`team_{h,a}_difficulty`) is published with the fixtures and effectively static.
- Conclusion unchanged from #42: FDR is the **pre-season prior and fallback**, not an in-season signal. The estimator below *seeds* from it rather than replacing it.

### Rejected / deferred

- **FBref (Opta xG):** passing page already observed JS-populated-and-empty for our fetch path (`src/etl/understat.ts` header); adding a second scraper for data Understat already gives is not worth the fragility.
- **football-data.org free tier:** results/standings only — no xG (odds are a paid add-on per `docs/research/free-odds-sources.md`).
- **Promoted-club history (Championship xG):** no free source found — Understat covers top flights only. Cold start therefore rides the FDR-seeded prior (below), which is #92's settled parity path anyway.

## Calibration (walk-forward, Understat 2025/26, 380 matches)

Method: at each club-match *t*, estimate from the prior *n = t−1* team-matches only; `est = (signal_sum + k·μ)/(n + k)`; RMSE against the next match. μ_gf = 1.375, μ_xg = 1.529, home boost = 1.110 (760 team-matches).

### A — attack signal: xG vs raw goals (predict own next-match goals)

| n (prior team-matches) | k\* xG | RMSE xG | k\* GF | RMSE GF | winner |
|---|---|---|---|---|---|
| 1–3 | 4 | 1.2895 | 40 | 1.2766 | GF (tie) |
| 4–6 | 9 | 0.9281 | 40 | 0.9392 | **xG** |
| 7–10 | 25 | 1.1468 | 40 | 1.1544 | **xG** |
| 11–15 | 9 | 1.2069 | 8 | 1.2196 | **xG** |
| 16–25 | 3 | 1.0400 | 10 | 1.0412 | **xG** |
| all (1–25) | **6** | 1.1140 | 18 | 1.1183 | **xG** |

Against the de-noised target (next-match xG) xG wins from n≥4 by a wider margin (0.8526 vs 0.8759 overall). **Answer to "how many matches before raw GF beats xG": it doesn't, within a season** — GF only ties in weeks 1–3, then loses everywhere; and raw GF needs k≈13–18 (heavy shrinkage) to compete at all, vs k≈6 for xG.

### A3 — defense signal: xGA vs GA (predict own next-match goals conceded)

Statistical tie on the goals target (overall 1.1284 xGA vs 1.1231 GA — within noise); on the xG target xGA is cleaner. Defense needs **more shrinkage than attack** (k\* 8–15, edge of grid 25–40 in the noisiest bands). → kD = 10 (between the xG- and goals-target optima; #92 can tune later — defense signal choice is low-stakes).

### C — home/away split vs pooled + boost (predict goals in home matches)

- Home-only xG, k=7: RMSE 1.1469
- Pooled all-match xG × league home boost, k=10: RMSE **1.1445**

Splitting halves the effective sample and buys nothing. **Fold venue into the fixture factor** (FDR already carries per-fixture venue; the observed boost 1.11 is the sanity anchor).

### D — the DVOA premise itself (chronological walk, 60-match burn-in)

Prediction `μ_gf × A_attacker × D_defender × (boost)` vs attacker-only:

| target | unadjusted (kA=13) | ×opponent (kA=14, kD=23) |
|---|---|---|
| next-match goals | 1.0950 | **1.0862** |
| next-match xG | 0.8435 | **0.8354** (xGA-D) / **0.8153** (GA-D) |

Opponent adjustment improves both targets with either defense signal. The RMSE delta looks small because single-match goal variance (Poisson σ≈1.17) dominates — the value for #92 is not aggregate RMSE, it is **fixture-to-fixture differentiation** (who you actually play), which is exactly what the fixture factors encode.

### Scale — how wide do the multipliers run?

Full-season 2025/26 per-club multipliers (rate ÷ league mean): **attack ×0.63 (Wolves) … ×1.40 (Man City); defense ×0.61 (Arsenal) … ×1.51 (Burnley)**. The current FDR slopes (0.12/step, ±2 steps ≈ ±24%) understate the empirical extremes (~±40%). With k=6 at n=6 matches the shrinkage halves the spread, converging toward FDR-like magnitude as the season deepens — a natural damping. #92 should key factor scale off the *shrunk* multiplier distribution, not inherit FDR's step size blindly.

## Recommended recipe (for #92 to implement)

```
A_i = (ΣnpxG_i + kA·μ·F_i) / (n_i + kA) / μ        # attack multiplier, mean 1.0
D_j = (ΣxGA_j  + kD·μ·F_j) / (n_j + kD) / μ        # defense multiplier, mean 1.0
     kA = 6, kD = 10, μ = league npxG/team-match (Understat live)
     F = FDR-implied multiplier (pre-season seed; 1.0 mid-season, FDR for promoted)
fixture factor: attack vs j → A_own × D_j ; CS/GC vs j → D_j ; home → ×1.11-ish (fold into venue term)
zero matches → A = D = F exactly (FDR parity, #92's settled fallback)
```

Data path: extend the existing Understat page-load to read `teamsData` (all 20 clubs' `history` in one fetch), **probe both start-year URLs and select by match dates** (rollover lag is real and observed), commit per-club `{n, npxG, xGA}` aggregates into the snapshot, re-estimate deterministically on refresh (no new state — #41-compatible). Fallback chain as in the TL;DR.

Open verification for #92: (1) FPL-summed vs Understat club xG once GW1–3 actuals exist; (2) confirm the 2026/27 Understat page exists and its `history` populates after this weekend's matches; (3) recalibrate kA/kD once a second season of data (2024/25) is pulled — cheap to add to the same probe.
