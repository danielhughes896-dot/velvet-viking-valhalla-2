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
  coachBreakthroughs()             deterministic, athlete-first, already existed
  contentCandidate(dd,'founder')   ten allow-listed fields, no I/O
        │
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
VVV_CONTENT_BRIDGE_ENABLED    off unless explicitly set
VVV_OWNER_USER_ID             already used by the existing owner-only routes
```

With `VVV_CONTENT_BRIDGE_ENABLED` unset the export fails closed and sends nothing.
