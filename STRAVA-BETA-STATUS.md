# Strava private beta — status

**Internal. Nothing in this file belongs in athlete-facing UI.**

## Status

**ACTIVE, WITHIN THE APPLICATION'S EXISTING PRIVATE-BETA CAPACITY.**

Maximum **10 connected athletes in total, including the founder**
(`VVV_STRAVA_MAX_ATHLETES`, default 10).

This is not public launch, and it is not authorisation to widen beyond the
allowance Strava currently provides.

## The policy record — stated exactly

This is the part most easily misremembered, so it is written plainly:

1. Valhalla **disclosed its intended private-beta use** to Strava and asked
   them to clarify the policy position relevant to the product.
2. Strava **did not provide an individual interpretation.** Their response
   referred Valhalla back to the published API Agreement and API Policy,
   because they are unable to give individual feedback given submission volume.
3. This is **NOT recorded as Strava approval.**
4. This is **NOT recorded as Strava rejection.**
5. On that basis the **founder authorised** use of the existing Strava
   application within its current limited private-beta athlete capacity.
6. Wider availability remains gated on whatever Strava capacity or review is
   required at that stage.

Anyone reading this later: do not upgrade point 2 into an approval. Strava
declined to interpret. The decision to proceed was the founder's, taken with
that fact in front of them.

## What actually limits the beta

Two independent gates, and neither is a claim about Strava's internal state.

| Gate | Mechanism | Where |
|---|---|---|
| Is Strava commissioned here at all | `VVV_STRAVA_ENABLED` | every route |
| Is there a seat | count of `strava_connections` rows vs `VVV_STRAVA_MAX_ATHLETES` | `stravaMayConnect()`, checked at OAuth start **and** at the callback |

**Valhalla cannot see how many athletes Strava believes this application has,
and does not pretend to.** What it counts is its own roster — a table it owns —
and that is what the cap applies to. Strava remains authoritative for its own
limit; a refusal from Strava is handled on its own terms at the callback, and
is only described to the athlete as a capacity problem when it can be
identified as one.

### The rules the capacity model must keep

- An athlete who already holds a connection is **never** counted against
  admission, never re-checked against the cap, and never disconnected by a full
  roster. The connection **is** the entitlement.
- Sync, disconnect, deletion and webhook delivery **never** consult the cap.
- A roster that cannot be counted refuses **new** connections. An unprovable
  seat is not a free seat.
- There is deliberately **no** value meaning unlimited.
- Nothing evicts, rotates or reuses an athlete to make room.

## What replaced the founder gate

`VVV_STRAVA_ALLOWED_USER_IDS` and `stravaAllowedForUser()` are **removed**. The
variable is obsolete, read by nothing, and can be deleted from the deployment
at any time.

## Unchanged by this pass

Scopes, private-activity handling, token storage and refresh, retention and
deletion, disconnect semantics, provenance, Article 9 health-consent handling,
matching, duplicate protection, and the Strava → Ask Coach AI boundary.

**Strava-derived evidence still cannot enter the Ask Coach model context.**
Opening the beta to ten athletes changed who may connect. It changed nothing
about which evidence may reach a model.
