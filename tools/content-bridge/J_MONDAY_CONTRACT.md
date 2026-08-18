# monday.com contract — what the real integration needs

**Not built live.** The monday.com connector was unavailable in the session that
produced this prototype, so **no board was read, created or modified**, and no
board id, workspace id or column id in this document is a real value. They are
the shape the transport expects. HQ confirms or corrects them, then the mock in
`bridge.js` is swapped for the live client — one function, `mondayClient()`.

## Board: `Content Candidates`

One item per candidate. The item **is** the editorial unit of work.

| Column | Type | Source field | Notes |
|---|---|---|---|
| Item name | text | `candidateId` | deterministic, so re-ingesting updates rather than duplicates |
| Date | date | `date` | session date |
| Session kind | text / status | `sessionKind` | archetype, e.g. `threshold_continuous` |
| Distance (km) | number | `distanceKm` | |
| Execution score | number | `executionScore` | 0–100 |
| Goal | text | `goalDistanceLabel` | e.g. `Half Marathon` |
| Why notable | long text | `notableBecause` | one of three fixed product sentences |
| Source | status | `contentSource` | only ever `founder` in this prototype |
| Status | status | — | `Needs review` → `Drafted` → `Approved` |
| Suggested angles | long text | written back at step 3 | editorial starting points, not posts |
| Approved by | person | written back at step 4 | **required before anything proceeds** |

## What the board must NOT have

No column for heart rate, pace, RPE, feel, athlete notes, email, user id or
location. Those fields never cross the boundary, so a column for them could only
ever be filled by widening the allow-list — which is a deliberate, reviewable act
and should be treated as one.

## Automations to configure in monday.com, not in Valhalla

- `Status = Approved` notifies the person who publishes.
- No automation may move an item to a publishing state without a person in
  **Approved by**.

## Access

A monday.com API token scoped to this one board, held by the operator, never in
this repository and never in Valhalla. Valhalla holds no monday.com credential
and has no monday.com code path — the word does not appear in its runtime.
