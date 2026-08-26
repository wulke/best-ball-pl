# GW1 start-call verification ledger (#100)

Retro-comparison of the GW1 Saturday slate's start calls against real per-GW
minutes, per player, per slate fixture. Produced 2026-08-26, after GW1 actuals
landed (`actualsThrough: 1` in `data/snapshot.json`, fetched 2026-08-26T11:25Z).
Feeds the #46 short-window retune and the "does start knowledge deserve more
ranking weight" decision (map #37, Not yet specified).

## Question

How accurate were the two start-call inputs — **lineup-pull statuses** and
**manual overrides** — against what actually happened on the pitch? And how
well does the #97 model mapping (starter → per-start minutes, bench → 18′ cameo
floor) price the calls?

## Method

- **Calls** (`data/lineups/free-kick-gw1-sat.json`, reconstructed post-hoc
  this session via `npm run lineups -- --profile free-kick-gw1-sat`):
  confirmed XIs from premierleague.com's pulselive API, joined to FPL ids.
  Confirmed XIs are locked at team-sheet submission, so a post-hoc pull of
  played fixtures **is** the at-close pull — verified in #99 (88/88 starters +
  71/72 bench joined, 0 wrong-club calls; the one miss, Sindre Egeli, is out of
  the FPL pool). The GW1 asset was never committed at draft time (the lineups
  ETL shipped post-GW1); this reconstruction is the ledger's audit input.
- **Actuals**: `data/snapshot.json` → `actuals.gameweeks[0]` (event 1), FPL
  `event/1/live` minutes per player. FPL's live feed has **no start flag** —
  started = minutes ≥ 60 (the model's own `startMinutesThreshold`), with a
  "subbed-off 45–59′" bucket reported separately for the inherent ambiguity
  (a starter subbed at HT is indistinguishable from a 46′-cameo by minutes).
- **Fixture split** — the slate's four 2026-08-22 fixtures, by what was
  knowable at the 13:41Z close (lists publish ~60–75 min pre-KO, research #96):

| fixture | kickoff | score | knowable at close |
|---|---|---|---|
| 3 EVE–CRY | 14:00Z | 2-0 | ✅ |
| 5 IPS–SUN | 14:00Z | 2-1 | ✅ |
| 6 NFO–LEE | 14:00Z | 0-1 | ✅ |
| 2 BRE–TOT | 16:30Z | 3-0 | ❌ structural post-close |

## The ledger — per player, per slate fixture

Call = the lineup pull's status. Actual = FPL live minutes in the fixture.
"subbed-off 45–59′" = played 45–59 minutes (started-and-subbed or 46′-cameo;
no start flag in the feed).

<!-- the per-fixture tables are generated from data/lineups/free-kick-gw1-sat.json
     + data/snapshot.json actuals; regenerate with the throwaway join script -->

### Fixture 3: EVE–CRY (2-0)

| player | pos | club | call | source | actual | bucket |
|---|---|---|---|---|---|---|
| Henderson | G | CRY | starter | lineup pull | 90 | started |
| Muñoz | D | CRY | starter | lineup pull | 54 | subbed-off 45–59′ |
| Richards | D | CRY | starter | lineup pull | 90 | started |
| Canvot | D | CRY | starter | lineup pull | 90 | started |
| Mitchell | D | CRY | starter | lineup pull | 90 | started |
| Chadi Riad | D | CRY | starter | lineup pull | 72 | started |
| Wharton | MD | CRY | starter | lineup pull | 90 | started |
| Kamada | MD | CRY | starter | lineup pull | 90 | started |
| Mateta | FW | CRY | starter | lineup pull | 62 | started |
| Nketiah | FW | CRY | starter | lineup pull | 55 | subbed-off 45–59′ |
| Pickford | G | EVE | starter | lineup pull | 90 | started |
| Tarkowski | D | EVE | starter | lineup pull | 90 | started |
| Branthwaite | D | EVE | starter | lineup pull | 90 | started |
| Mykolenko | D | EVE | starter | lineup pull | 90 | started |
| Dewsbury-Hall | MD | EVE | starter | lineup pull | 90 | started |
| Ndiaye | MD | EVE | starter | lineup pull | 90 | started |
| McNeil | MD | CRY | starter | lineup pull | 62 | started |
| George | MD | EVE | starter | lineup pull | 83 | started |
| Armstrong | MD | EVE | starter | lineup pull | 90 | started |
| Röhl | MD | EVE | starter | lineup pull | 90 | started |
| Hackney | MD | EVE | starter | lineup pull | 78 | started |
| Barry | FW | EVE | starter | lineup pull | 78 | started |
| Benitez | G | CRY | bench | lineup pull | 0 | DNP |
| Sosa | D | CRY | bench | lineup pull | 0 | DNP |
| Mingueza | D | CRY | bench | lineup pull | 0 | DNP |
| Johnson | MD | EVE | bench | lineup pull | 6 | cameo |
| Yeremy | MD | CRY | bench | lineup pull | 35 | cameo |
| Hughes | MD | CRY | bench | lineup pull | 0 | DNP |
| Strand Larsen | FW | CRY | bench | lineup pull | 27 | cameo |
| Travers | G | EVE | bench | lineup pull | 0 | DNP |
| Keane | D | EVE | bench | lineup pull | 0 | DNP |
| O'Brien | D | EVE | bench | lineup pull | 0 | DNP |
| Patterson | D | EVE | bench | lineup pull | 0 | DNP |
| Garner | MD | EVE | bench | lineup pull | 11 | cameo |
| Alcaraz | MD | EVE | bench | lineup pull | 1 | cameo |
| Dibling | MD | EVE | bench | lineup pull | 0 | DNP |
| Beto | FW | EVE | bench | lineup pull | 11 | cameo |
| Guessand | MD | CRY | bench | lineup pull | 27 | cameo |
| Tomiyasu | D | CRY | bench | lineup pull | 18 | cameo |
| Khalaili | D | CRY | bench | lineup pull | 35 | cameo |

### Fixture 5: IPS–SUN (2-1)

| player | pos | club | call | source | actual | bucket |
|---|---|---|---|---|---|---|
| Diop | D | IPS | starter | lineup pull | 90 | started |
| Lukić | MD | IPS | starter | lineup pull | 90 | started |
| O'Shea | D | IPS | starter | lineup pull | 90 | started |
| Davis | D | IPS | starter | lineup pull | 90 | started |
| Greaves | D | IPS | starter | lineup pull | 90 | started |
| Núñez | MD | IPS | starter | lineup pull | 79 | started |
| Fatawu | MD | IPS | starter | lineup pull | 65 | started |
| Emersonn | FW | IPS | starter | lineup pull | 65 | started |
| Roefs | G | SUN | starter | lineup pull | 90 | started |
| Ballard | D | SUN | starter | lineup pull | 90 | started |
| Hume | D | SUN | starter | lineup pull | 79 | started |
| Reinildo | D | SUN | starter | lineup pull | 90 | started |
| O'Nien | D | SUN | starter | lineup pull | 66 | started |
| Meunier | D | SUN | starter | lineup pull | 90 | started |
| E.Le Fée | MD | SUN | starter | lineup pull | 79 | started |
| Xhaka | MD | SUN | starter | lineup pull | 90 | started |
| Sadiki | MD | SUN | starter | lineup pull | 90 | started |
| Angulo | MD | SUN | starter | lineup pull | 58 | subbed-off 45–59′ |
| Brobbey | FW | SUN | starter | lineup pull | 66 | started |
| Maeda | MD | IPS | starter | lineup pull | 79 | started |
| Scherpen | G | IPS | starter | lineup pull | 90 | started |
| Enciso | MD | IPS | starter | lineup pull | 70 | started |
| Walton | G | IPS | bench | lineup pull | 0 | DNP |
| Kipré | D | IPS | bench | lineup pull | 0 | DNP |
| Furlong | D | IPS | bench | lineup pull | 0 | DNP |
| Clarke | MD | IPS | bench | lineup pull | 19 | cameo |
| Akpom | FW | IPS | bench | lineup pull | 24 | cameo |
| McAteer | MD | IPS | bench | lineup pull | 24 | cameo |
| Ellborg | G | SUN | bench | lineup pull | 0 | DNP |
| Mukiele | D | SUN | bench | lineup pull | 0 | DNP |
| Alderete | D | SUN | bench | lineup pull | 23 | cameo |
| Diarra | MD | SUN | bench | lineup pull | 10 | cameo |
| Mundle | MD | SUN | bench | lineup pull | 0 | DNP |
| Rigg | MD | SUN | bench | lineup pull | 10 | cameo |
| Talbi | MD | SUN | bench | lineup pull | 31 | cameo |
| Jocelin.T | MD | SUN | bench | lineup pull | 0 | DNP |
| Isidor | FW | SUN | bench | lineup pull | 23 | cameo |
| Ouattara | D | IPS | bench | lineup pull | 10 | cameo |
| Humphreys | MD | IPS | bench | lineup pull | 0 | DNP |

### Fixture 6: NFO–LEE (0-1)

| player | pos | club | call | source | actual | bucket |
|---|---|---|---|---|---|---|
| Wilson | MD | LEE | starter | lineup pull | 65 | started |
| Bijol | D | LEE | starter | lineup pull | 90 | started |
| Rodon | D | LEE | starter | lineup pull | 90 | started |
| Bogle | D | LEE | starter | lineup pull | 90 | started |
| Justin | D | LEE | starter | lineup pull | 90 | started |
| Muharemović | D | LEE | starter | lineup pull | 90 | started |
| Stach | MD | LEE | starter | lineup pull | 90 | started |
| Aaronson | MD | LEE | starter | lineup pull | 81 | started |
| Ampadu | MD | LEE | starter | lineup pull | 90 | started |
| Calvert-Lewin | FW | LEE | starter | lineup pull | 90 | started |
| Trafford | G | LEE | starter | lineup pull | 90 | started |
| Sels | G | NFO | starter | lineup pull | 90 | started |
| N.Williams | D | NFO | starter | lineup pull | 90 | started |
| Milenković | D | NFO | starter | lineup pull | 90 | started |
| Murillo | D | NFO | starter | lineup pull | 90 | started |
| Aina | D | NFO | starter | lineup pull | 73 | started |
| Jair Cunha | D | NFO | starter | lineup pull | 90 | started |
| Gibbs-White | MD | NFO | starter | lineup pull | 90 | started |
| Ndoye | MD | NFO | starter | lineup pull | 61 | started |
| McAtee | MD | NFO | starter | lineup pull | 73 | started |
| I.Sangaré | MD | NFO | starter | lineup pull | 90 | started |
| Igor Jesus | FW | NFO | starter | lineup pull | 90 | started |
| Perri | G | LEE | bench | lineup pull | 0 | DNP |
| Okafor | MD | LEE | bench | lineup pull | 24 | cameo |
| Longstaff | MD | LEE | bench | lineup pull | 8 | cameo |
| James | MD | LEE | bench | lineup pull | 0 | DNP |
| Tanaka | MD | LEE | bench | lineup pull | 0 | DNP |
| Nmecha | FW | LEE | bench | lineup pull | 0 | DNP |
| John | G | NFO | bench | lineup pull | 0 | DNP |
| Abbott | D | NFO | bench | lineup pull | 0 | DNP |
| Netz | D | NFO | bench | lineup pull | 16 | cameo |
| Hudson-Odoi | MD | NFO | bench | lineup pull | 0 | DNP |
| Dominguez | MD | NFO | bench | lineup pull | 0 | DNP |
| Wood | FW | NFO | bench | lineup pull | 28 | cameo |
| Kalimuendo | FW | NFO | bench | lineup pull | 1 | cameo |
| Schlager | MD | NFO | bench | lineup pull | 16 | cameo |
| Diomande | D | NFO | bench | lineup pull | 0 | DNP |
| Elvedi | D | LEE | bench | lineup pull | 0 | DNP |
| Lienou | D | LEE | bench | lineup pull | 0 | DNP |
| Cresswell | MD | LEE | bench | lineup pull | 0 | DNP |

### Fixture 2: BRE–TOT (3-0) — **not knowable at close**

| player | pos | club | call | source | actual | bucket |
|---|---|---|---|---|---|---|
| Thiago | FW | BRE | starter | post-hoc — unavailable at close | 82 | started |
| Van Hecke | D | TOT | starter | post-hoc — unavailable at close | 90 | started |
| Tonali | MD | TOT | starter | post-hoc — unavailable at close | 90 | started |
| Kinsky | G | TOT | starter | post-hoc — unavailable at close | 90 | started |
| Senesi | D | TOT | starter | post-hoc — unavailable at close | 90 | started |
| Robertson | D | TOT | starter | post-hoc — unavailable at close | 90 | started |
| Tel | MD | TOT | starter | post-hoc — unavailable at close | 90 | started |
| Gallagher | MD | TOT | starter | post-hoc — unavailable at close | 45 | subbed-off 45–59′ |
| Bergvall | MD | TOT | starter | post-hoc — unavailable at close | 45 | subbed-off 45–59′ |
| Gray | MD | TOT | starter | post-hoc — unavailable at close | 85 | started |
| Moore | MD | TOT | starter | post-hoc — unavailable at close | 67 | started |
| Richarlison | FW | TOT | starter | post-hoc — unavailable at close | 67 | started |
| M.Sangaré | MD | BRE | starter | post-hoc — unavailable at close | 75 | started |
| Kelleher | G | BRE | starter | post-hoc — unavailable at close | 90 | started |
| Collins | D | BRE | starter | post-hoc — unavailable at close | 90 | started |
| Lewis-Potter | MD | BRE | starter | post-hoc — unavailable at close | 90 | started |
| Ajer | D | BRE | starter | post-hoc — unavailable at close | 90 | started |
| Kayode | D | BRE | starter | post-hoc — unavailable at close | 75 | started |
| Schade | MD | BRE | starter | post-hoc — unavailable at close | 90 | started |
| O.Dango | MD | BRE | starter | post-hoc — unavailable at close | 66 | started |
| Jensen | MD | BRE | starter | post-hoc — unavailable at close | 66 | started |
| Janelt | MD | BRE | starter | post-hoc — unavailable at close | 90 | started |
| Yarmoliuk | MD | BRE | bench | post-hoc — unavailable at close | 23 | cameo |
| Anthony | MD | BRE | bench | post-hoc — unavailable at close | 23 | cameo |
| Wilson | FW | BRE | bench | post-hoc — unavailable at close | 7 | cameo |
| Dubravka | G | TOT | bench | post-hoc — unavailable at close | 0 | DNP |
| Danso | D | TOT | bench | post-hoc — unavailable at close | 0 | DNP |
| Udogie | D | TOT | bench | post-hoc — unavailable at close | 4 | cameo |
| Davies | D | TOT | bench | post-hoc — unavailable at close | 0 | DNP |
| Maddison | MD | TOT | bench | post-hoc — unavailable at close | 22 | cameo |
| Bentancur | MD | TOT | bench | post-hoc — unavailable at close | 45 | subbed-off 45–59′ |
| Fernandes | MD | TOT | bench | post-hoc — unavailable at close | 45 | subbed-off 45–59′ |
| Solanke | FW | TOT | bench | post-hoc — unavailable at close | 22 | cameo |
| Williams-Barnett | MD | TOT | bench | post-hoc — unavailable at close | 0 | DNP |
| Valdimarsson | G | BRE | bench | post-hoc — unavailable at close | 0 | DNP |
| Henry | D | BRE | bench | post-hoc — unavailable at close | 0 | DNP |
| Hickey | D | BRE | bench | post-hoc — unavailable at close | 14 | cameo |
| Pinnock | D | BRE | bench | post-hoc — unavailable at close | 0 | DNP |
| Schuster | D | BRE | bench | post-hoc — unavailable at close | 0 | DNP |
| Damsgaard | MD | BRE | bench | post-hoc — unavailable at close | 14 | cameo |

## Accuracy of the lineup source (fixtures 3/5/6, knowable at close)

Calls: **66 starter, 53 bench** (119 total; every called player is in the
18-man squad of a covered fixture).

| call | started ≥60′ | subbed-off 45–59′ | cameo 1–44′ | DNP |
|---|---|---|---|---|
| **starter** (66) | 63 — **95.5%** | 3 — 4.5% | 0 | 0 |
| **bench** (53) | 0 | 0 | 24 — 45.3% | 29 — 54.7% |

- **Starter calls are ground truth**: 95.5% played ≥60′ (mean 82.9′, median
  90′), the rest subbed off 45–58′ (Muñoz, Nketiah, Angulo — the chasing
  sides). Zero DNPs, zero false starts. A confirmed-XI "starter" call carries
  no start-status risk; only sub-off *timing*.
- **Bench calls are clean non-starters**: 0 started. But only 45.3% appeared
  at all. The played cameo is ~18′ (mean 18.3, median 18.5) — strikingly
  tight; the **EV under a bench call is ~8′** (45.3% × 18.3).
- **Position skew** (bench calls, fixtures 3/5/6): G 0/6 ever played; D 5/17
  (cameo mean 20.4′); MD 13/23 (17.1′); FW 6/7 (19.0′). Named-sub keepers
  almost never play; named-sub forwards almost always get a cameo.

## Accuracy of manual judgment (overrides)

**No manual-override record exists for GW1** — none was committed, and #98's
override surface is still open. The GW1 draft rode the model default (factor
1, season-share minutes) on the structurally-unknown fixture: the 40 BRE–TOT
calls above were *not* knowable at the 13:41Z close and were not supplied by
hand (no repo record of any override). The "manual ritual" of #99's note is
therefore unverifiable for GW1.

Manual-judgment accuracy becomes measurable with GW2+: #98's override surface
records calls, the GW2 asset is committed, and GW2 actuals land ~2026-08-31.
This half of the ledger is **deferred**, not resolved — GW2+ slates should
each append a fixture column to this ledger.

## The structural-unknown fixture (BRE–TOT): cost of no signal at close

At the 13:41Z close the 40 BRE–TOT calls above were **not knowable** (16:30Z
kickoff — structural, not a GW1 quirk), and no manual override was recorded,
so the model ran every one of them `unknown` → factor 1 → season-share
minutes. What actually happened, and what correct calls would have priced
(model window minutes, means):

| call group (n) | default (season-share) | start-aware (hypothetical) | actual |
|---|---|---|---|
| starter calls (22) | 42.9′ | 51.4′ | **79.7′** |
| bench calls (18) | 28.7′ | 18.0′ | **12.2′** |

Both ways the tool was blind here: starters under-priced by ~37′ (default)
and non-starters over-priced by ~17′ — the draft board ranked these 40 on
stale 2025/26 minutes. Model-level minutes error on fixture 2: default MAE
**29.5′** vs start-aware (hypothetical) **23.7′** — start knowledge would
have helped, but this fixture is structurally where the tool is blind; the
mixed-kickoff-slate fog item (late-game GPP leverage) is the standing
question, not a GW1 quirk.

## Model mapping calibration (the #46 retune inputs)

Window expected minutes, model-run both ways (no asset vs reconstructed asset;
client-side `buildProjections` path — note the **CLI `npm run model` never
loads the lineup asset**, so its report shows the default path only), vs
actual per-GW minutes across all 123 pool players:

| set | default MAE | start-aware MAE |
|---|---|---|
| knowable fixtures (3/5/6, n=91) | 27.5′ | **17.4′** (−37%) |
| structural-unknown (fixture 2, n=32) | 29.5′ | 23.7′ (hypothetical) |
| all pool (n=123) | 28.0′ | **19.1′** (−32%) |

By call group (means, model window minutes vs actual):

| call group | default | start-aware | actual |
|---|---|---|---|
| starters, knowable fixtures (66) | 51.2′ | 64.2′ | 82.9′ |
| bench, knowable fixtures (53) | 29.4′ | 18.0′ | 8.3′ |
| starters, all fixtures (88) | 49.1′ | 61.0′ | 82.1′ |
| bench, all fixtures (71) | 29.2′ | 18.0′ | 9.3′ |

- **The default (season-share) base is a poor GW1 minutes predictor**: it
  under-prices starters by ~30–37′ (stale 2025/26 minutes; GW1 rotation) and
  over-prices non-starters by ~17–21′ (high-prior players who don't start).
- **Correct calls roughly halve the error but leave starters ~19′ low**: the
  `season-share / P(start)` mapping with conservative priors lands the called
  starters at ~62–64′ vs 82.9′ actual — the low-prior cases (newcomers,
  rotation-risk players who genuinely started) are the deficit (Diop 36→71′,
  actual 90; McAtee 22→64′, actual 73; Nketiah 21→58′, actual 55). A
  starter-typical baseline or a floor on called-starter minutes is a retune
  option; one GW of evidence, early season.
- **Cameo floor (18′): well-calibrated as an "if he plays" level** — the
  played cameo mean is 18.3′/median 18.5′. As a point estimate it is ~2× the
  EV (8–9′) because ~55% of bench calls never appear. Options for #46's retune
  (reporting, not deciding): keep 18′ as the p50 "if-plays" level with the
  DNP branch priced by scenario, or probability-weight toward ~9′.
- **Start knowledge is high-value for slate ranking**: default vs start-aware
  rank correlation **0.872** (Spearman), and the draft-sized top-6 overlaps
  only **2/6**:

| top-6 default | top-6 start-aware |
|---|---|
| Pickford, E.Le Fée, Stach, Gibbs-White, Garner, Xhaka | Thiago, Barry, Stach, Igor Jesus, Kelleher, E.Le Fée |

  The aware board correctly promoted full-90 starters from the 3-0 game
  (Kelleher CS, Thiago) and demoted bench-call casualties (Garner: 11′ actual,
  benched; Xhaka out of the top 6). Biggest rank movers: Garner 5→90 (65→18′,
  actual 11), Nketiah 122→32 (21→58′, actual 55), McAtee 109→23 (22→64′,
  actual 73), Fernandes 37→127 (50→18′, actual 45), Strand Larsen 54→143
  (44→18′, actual 27), Yarmoliuk 66→153 (42→18′, actual 23).
- **Bench-call pricing, all 71 calls (4 fixtures): model floor 18′ vs actual
  mean 9.3′** — the whole-slate version of the EV-vs-floor gap above.

## Limitations

- FPL's live feed has no start flag: the ≥60′ threshold is a proxy; the 7
  players in the 45–59′ band (started-and-subbed vs 46′-cameo) are ambiguous
  by construction. Ground-truth classification would need FBref/PL match
  sheets.
- The reconstructed asset is a post-hoc pull (fetchedAt 2026-08-26); for
  played fixtures confirmed XIs are unchanged from close, and #99's
  verification (88/88 + 71/72) matches this pull exactly, but it is not a
  contemporaneous record.
- No draft-picks record for GW1 exists in the repo, so the ledger measures
  call accuracy and model-minute error, not draft-outcome value.
- `npm run model` (CLI window report) ignores the lineup asset — the sheet
  (`windowProjections`) is the only start-aware consumer. If the CLI report is
  used for tuning, it shows the default path by design; worth an explicit note
  in the CLI's header or README if it ever drives a decision.
- Transfers and FPL data corrections post-2026-08-26T11:25Z would not be
  reflected (the ledger uses the committed snapshot's actuals as fetched).

## What this feeds

- **#46 short-window retune**: cameo-floor calibration (if-plays 18.3′ vs EV
  8–9′; position skew G ~0 / FW ~always); per-start minutes validation
  (starter mean 82.9′); the structural-unknown fixture as the blind spot
  worth scenario-hedging.
- **Predicted-XI quality decision** (map fog "Start-call accuracy over
  time"): the lineup source is essentially perfect on start status; start
  knowledge cuts slate minute error ~a third and churns 4/6 of a draft-sized
  board — evidence start knowledge deserves meaningful ranking weight, and
  that the mixed-kickoff fixture's unknown half is the real residual risk.
