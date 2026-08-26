# Daily-slate lineup assets

`npm run lineups -- --profile <daily-profile-id>` is a **manual, close-to-draft
ETL step** — run ~30–60 min before the slate's draft close, not part of the
scheduled FPL refresh (#99). It pulls confirmed starting XIs from the Premier
League site's pulselive API (research #96 — no auth, no key; be a good citizen,
one pull per slate) and overwrites `data/lineups/<profile-id>.json` with the
freshest committed state. Runs are idempotent: same inputs, same bytes.

The asset is optional and deliberately separate from the projection model:
missing assets or `fetchedAt: null` use the model default unchanged.

```json
{
  "schemaVersion": 1,
  "profileId": "free-kick-gw1-sat",
  "slateDate": "2026-08-22",
  "fetchedAt": "2026-08-21T18:00:00Z",
  "fixtureCoverage": [{ "fixtureId": 123, "covered": true }],
  "players": [{ "fixtureId": 123, "playerId": "42", "status": "starter" }]
}
```

`fixtureCoverage` is the per-fixture coverage mask: a player absent from a
covered fixture remains `unknown`; an uncovered fixture has no lineup signal.
Player statuses are `starter`, `bench`, or `unknown` — confirmed XIs become
`starter`, named substitutes `bench` (a known non-starter). **Partial coverage
is preserved, never fabricated**: lists publish ~60–75 min before kickoff, so
late-kickoff fixtures are structurally uncovered at close and simply carry
`covered: false` + no players. Pulselive names join to FPL ids with the same
club-scoped matcher the odds ETL uses; names outside the FPL pool (youth
call-ups, loans) are skipped and reported by the CLI, not invented.

Manual UI calls use the localStorage map `bbpl-start-overrides:<profile-id>`
with shape `{ "playerId": { "fixtureId": "starter" | "bench" } }`; precedence is
manual override, then lineup asset, then model default.
