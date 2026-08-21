# Daily-slate lineup assets

`data/lineups/<profile-id>.json` is an optional, committed browser asset. The
lineup pull is deliberately separate from the projection model: missing assets
or `fetchedAt: null` use the model default unchanged.

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
Player statuses are `starter`, `bench`, or `unknown`. Manual UI calls use the
localStorage map `bbpl-start-overrides:<profile-id>` with shape
`{ "playerId": { "fixtureId": "starter" | "bench" } }`; precedence is
manual override, then lineup asset, then model default.
