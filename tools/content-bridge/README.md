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
MONDAY_CONTENT_GROUP_ID       optional; defaults to group_mm6bbdp2
                              ("APP DATA — Valhalla Evidence")
VVV_CONTENT_BRIDGE_ENABLED    off unless explicitly set
VVV_OWNER_USER_ID             already used by the existing owner-only routes

MONDAY_CONTENT_SOURCE_LABEL   optional; overrides the Source value ("Valhalla")
```

`MONDAY_API_TOKEN` and `VVV_CONTENT_BRIDGE_ENABLED` are required and each fails
closed on its own — `bridge_not_configured`, `bridge_disabled`. With either
missing the bridge sends nothing at all.

The board and group have documented defaults, because they are structural facts
of the destination rather than secrets. A group id is always passed on
`create_item`: monday drops a group-less create into the board's FIRST group,
which is where human editorial work sits, and machine evidence appearing there
would be a real defect. Setting `MONDAY_CONTENT_GROUP_ID` to an empty string is
read as a deliberate blank and refuses to write (`bridge_group_not_configured`)
rather than falling back.

## Candidate identity

`vv-<blockKey>-<date>`, where `blockKey` is a short hash of the block's start
date, goal race date and goal distance.

It was `vv-<date>-<archetype>`, which looked stable and was not. The archetype
DESCRIBES a session; it does not identify one. Editing a logged session — the
ordinary act of correcting what it was — changed the id, so the same session came
back as a second row for a human to reconcile. And across two blocks the same
date could reuse an id for a genuinely different session, silently deduping a new
candidate against an old row. Hashing the block and keying on the day fixes both.
The key carries no uid, no email, no pace, no heart rate and no score, and the
schedule dates it is derived from never appear in clear.

## Emission

`coachPersistReview()` — the function that already runs when a session is logged
or edited — calls `contentCandidateNotify()`. Eligibility is `coachBreakthroughs()`
and nothing else; there is no marketing score and no threshold invented for this.
The client posts to `/api/admin-user` with the athlete's own token and reads only
the status code. Everyone who is not the owner gets a 404 from the existing owner
gate, and their device records that and never asks again.

Nothing about it is visible to the athlete, and no failure of it can reach them:
the whole hook is wrapped and the request's rejection is swallowed.
