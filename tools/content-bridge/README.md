# Content bridge — prototype, operator-run, no automatic egress

This is **not** part of Valhalla and is **not** deployed. Only `api/*.js` becomes a
Vercel Serverless Function; everything here runs by hand, on the operator's own
machine, when the operator chooses to run it.

That is the whole privacy design. There is **no network path** from any athlete's
device to monday.com, to an AI provider, or to any social network. A candidate
only moves because a human exported it and ran a command.

## The pipeline, and where it stops

```
Valhalla (coaching product)
  coachBreakthroughs()            already exists; already means
                                  "a session worth telling someone about"
  contentCandidate(dd,'founder')  builds a minimal, allow-listed, neutral event
        │
        │  founder exports by hand. no automatic transmission.
        ▼
  1  ingest    verify + allow-list + founder-only            tools/content-bridge
  2  push      create a monday.com item                      MOCK in this prototype
  3  generate  prepare suggested angles                      MOCK in this prototype
  4  approve   HUMAN. mandatory. nothing proceeds without it
        │
        ▼
  5  publish   NOT BUILT. refuses to run. see below.
```

**Valhalla knows nothing about any of this.** It emits a neutral eligible event
and stops. No social network, caption, campaign, schedule or calendar exists
anywhere in the coaching product, and a test asserts that vocabulary never
appears in its runtime.

## Why steps 2 and 3 are mocks

The monday.com MCP connector was **not available** in the session that built this,
so no live board was read, created or written. Rather than guess at a board
schema and call it done, the transport is an interface with a mock behind it and
`J_MONDAY_CONTRACT.md` states exactly what the real board needs. Swapping the
mock for the live client is one file, once HQ confirms the board structure.

The AI step is mocked for a different reason: it is the step most able to cause
harm by being wired up early, and it must never receive more than the
allow-listed candidate. The mock proves the seam and the payload; it does not
call a model.

## Publishing

`publish` is deliberately unimplemented and **refuses to run**. Automatic social
publication is out of scope for this prototype and stays out until HQ has seen a
demonstration in a non-production account.

## Run it

```
node tools/content-bridge/bridge.js ingest   <candidates.json>
node tools/content-bridge/bridge.js review
node tools/content-bridge/bridge.js generate <candidateId>
node tools/content-bridge/bridge.js approve  <candidateId>
node tools/content-bridge/bridge.js publish  <candidateId>   # refuses
```

State is written to `tools/content-bridge/.state.json`, which is git-ignored.
Nothing here reads Supabase, and no credential is stored in this repository.
