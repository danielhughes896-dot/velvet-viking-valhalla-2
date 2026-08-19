# Content bridge — where it now lives

The server-side boundary is **`api/_content-bridge.js`**. This directory no longer
holds an implementation.

## What changed, and why

The first prototype kept the whole pipeline out of Valhalla in an operator-run
script here, because the monday.com board did not exist yet and the AI and
approval steps had nowhere real to happen. Both of those are now configured:

- the board `Velvet Viking — Content Pipeline` (`5102476403`) exists;
- the **Velvet Viking Social Content Agent** runs inside monday.com, triggered by
  `Workflow Status → Selected` and `→ Changes Requested`.

So the mock `generate` and `approve` steps this directory used to hold are
superseded by the real thing, on the far side of the boundary where they belong.
Keeping a second half-implementation would have meant two versions of the same
pipeline, and the wrong one would eventually get used.

## The boundary now

```
VALHALLA (coaching product — knows nothing about marketing)
  coachPersistReview(dd)           the domain hook, never a render path
   └ contentCandidateNotify(dd)    ancillary, wrapped, silent, last
  coachBreakthroughs()             deterministic, athlete-first, already existed
  contentCandidate(dd,'founder')   ten allow-listed fields
        │  one POST to our own origin, athlete's own bearer token
        ▼
  api/admin-user.js  action:"content_export"      owner-only, server-verified
  api/_content-bridge.js                          the only file that knows monday
        │  creates one item, Workflow Status = Candidate
        ▼
  ── VALHALLA'S RESPONSIBILITY ENDS HERE ──
        │
  monday.com   HUMAN sets Selected
               → Social Content Agent writes AI Content Pack, sets Review
               → HUMAN sets Approved / Changes Requested / Rejected
               → publishing: a later, separately authorised boundary
```

Valhalla never writes Format, AI Content Pack, Review Feedback or Assets, never
moves an item past `Candidate`, and has no publishing capability. Tests assert
each of those.

## Configuration

Server-side environment only, never committed and never sent to a browser:

```
MONDAY_API_TOKEN              secret
MONDAY_CONTENT_BOARD_ID       5102476403
MONDAY_CONTENT_GROUP_ID       the "APP DATA — Valhalla Evidence" group id
VVV_CONTENT_BRIDGE_ENABLED    off unless explicitly set
VVV_OWNER_USER_ID             already used by the existing owner-only routes

MONDAY_CONTENT_SOURCE_LABEL   optional; overrides the Source value ("Valhalla")
```

Each of the first four is required and each fails closed on its own:
`bridge_disabled`, `bridge_not_configured`, `bridge_group_not_configured`. With
any of them missing the bridge sends nothing at all.

`MONDAY_CONTENT_GROUP_ID` is **not** optional and has no default. monday drops a
group-less `create_item` into the board's FIRST group, which is where human
editorial work sits — landing machine evidence there would be a real defect, so
the bridge refuses to write rather than guess. The value is the group's id, not
its display name; read it from the board (a group id looks like `topics` or
`group_mkxxxxxx`, not `APP DATA — Valhalla Evidence`).

## Emission

`coachPersistReview()` — the function that already runs when a session is logged
or edited — calls `contentCandidateNotify()`. Eligibility is `coachBreakthroughs()`
and nothing else; there is no marketing score and no threshold invented for this.
The client posts to `/api/admin-user` with the athlete's own token and reads only
the status code. Everyone who is not the owner gets a 404 from the existing owner
gate, and their device records that and never asks again.

Nothing about it is visible to the athlete, and no failure of it can reach them:
the whole hook is wrapped and the request's rejection is swallowed.
