# Odds slate assets

`npm run odds -- --profile <daily-profile-id>` overwrites `data/odds/<profile-id>.json` with raw decimal quotes from The Odds API. Runs are manual and close to the slate's draft close (#79): the freshest pull before the draft wins, and the committed asset is whatever the last merged PR carried.

The versioned contract joins fixtures through `fixtureId` and players through `playerId`. `matchWinner` carries 1X2, `totalGoals` carries each over/under line, and `playerProps` carries anytime-goalscorer and assists O/U quotes. Every quote retains `bookmaker` and decimal `price`. Unpriced fixtures and unlisted players are omitted, so consumers must retain their FDR fallback.
