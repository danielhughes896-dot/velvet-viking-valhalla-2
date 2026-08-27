# Full Plan — Race-Day Hierarchy / Block Continuity

Branch `claude/race-day-hierarchy`, cut from `main` @ `177320b`.
**Not merged. Held for founder review.**

---

## 1. The headline you should read first

**Most of what this brief asked for was already built and already working.** I
walked the whole journey against `main` before changing anything, and found:

| Requirement | State on `main` |
|---|---|
| Permanent WHAT'S NEXT card from the start of a race block | ✅ already there (`renderContinuityCard`) |
| Race Day as the culmination of the block | ✅ |
| Outcome first once Race Day passes | ✅ `renderRaceOutcomePrompt()` renders first on Today |
| Recovery cue while the outcome is pending | ✅ `renderPostRaceRecoverCard()` |
| Explicit recovery transition once answered | ✅ `renderBlockTransitionCard()` |
| Existing recovery sizing | ✅ `startDevelopmentBlock('recovery')` |
| Four directions after recovery | ✅ maintain / base / speed / race |
| **Taper continuity bug** | ✅ **already fixed** — the TAPER-WEEK GUARD in `nextBlockRecommendation()` |
| **Impossible congratulations gate** | ✅ **already retired** — no such banner survives in code |
| **Post-block Week 1 fallback** | ✅ **already corrected** — `currentWeekNum()` returns `null` after a block |

I am not going to claim credit for fixing three defects that were already
fixed. I verified each of the three by test rather than by reading the comments
that say so, and those tests are in the new suite so they stay fixed.

**Two things were genuinely wrong.** They are §2 and §3.

---

## 2. The real gap: "permanent" was not permanent

`renderContinuityCard()` returned `''` for **every non-race block**. Its own
comment said so: *"a development block running, mid-block, with nothing yet to
say — renders nothing."*

So the card was permanent through the race build and then **vanished for the
entire recovery block that follows it** — precisely when an athlete who has
just raced, and is running easy for a fortnight, most wants to know where this
is going. Full Plan said nothing at all about what happens at the end of it.

That is the gap between the brief's *"permanent WHAT'S NEXT card so the athlete
can always see where the programme goes"* and what shipped.

### What it now does

During any development block in flight, Full Plan carries:

> **WHAT'S NEXT**
> When this **recovery** block finishes, Valhalla will offer you these directions:
> - Maintain & Protect
> - Aerobic Base
> - Speed & Threshold
> - Build a race block
>
> *Nothing changes until you choose. Your training history stays either way.*

**It names the directions; it does not offer them.** There are deliberately no
live `start-block` buttons here — a button would let an athlete replace a
recovery block halfway through it, which is the opposite of what recovery is
for. The actionable offer is still `renderBlockTransitionCard()`, and it still
arrives when the block actually ends.

### One table, two readers

The preview cannot promise a direction the offer will not make, because both
now read the same function. I extracted the purpose→directions table out of
`nextBlockRecommendation()` into `blockChoicesFor(purpose)`; the recommendation
uses it to make the real offer, the card uses it to preview. A test walks every
purpose and asserts the preview and the eventual offer are identical — a drift
there would be believed and only discovered weeks later.

No methodology was invented: the directions, the sizing and the recommendation
logic are all exactly what was there.

---

## 3. DNF was told "You raced"

`nextBlockRecommendation()` distinguished DNS (→ maintain, nothing to recover
from) but let **DNF fall through to the raced branch verbatim**, so an athlete
who did not finish was told *"You raced. The next few weeks are for recovering
properly."*

The brief asks to distinguish Raced / DNF / DNS appropriately. DNF now has its
own sentence:

> *"You did not finish. Recovery still comes first — we will not know what the
> day cost you until you have had some of it."*

**The block is unchanged** — DNF still gets recovery, because a day that ended
early can still cost as much as one that did not, and the sizing is the
engine's either way. Only the sentence changed. What the copy deliberately does
**not** do is claim to know how much the day took, because nobody does yet,
including the athlete. A test asserts that.

---

## 4. The journey, verified end to end

`test/raceDayLifecycle.test.js` — 19 tests walking:

```
race block week 1 → mid-block → taper → Race Day → outcome pending
   → Raced / DNF / DNS → recovery → recovery running → recovery done → choose
```

| Stage | WHAT'S NEXT | Outcome ask | Recovery cue | Live action |
|---|---|---|---|---|
| Block running (wk 1, mid) | ✅ | — | — | none |
| **Taper week** | ✅ | — | — | **none** ← the taper bug |
| Race passed, pending (Today) | — | ✅ | ✅ | none |
| Race passed, pending (Full Plan) | ✅ points at Today | — | — | none |
| Raced | ✅ Recommended next | — | — | start recovery |
| DNF | ✅ Recommended next | — | — | start recovery |
| DNS | ✅ Recommended next | — | — | start maintain |
| **Recovery running** | ✅ **preview** | — | — | **none** ← the gap closed |
| Recovery done | ✅ What next? | — | — | all four |

Also asserted: rendering any surface never mutates the schedule or the block
purpose; the race block is closed and the recovery block opened in the ledger,
so history is kept; the outcome is recorded once and the answer is the
authority; and no commercial messaging appears anywhere in the journey.

---

## 5. Screenshots

`tools/shots/race-lifecycle-shots.js` → `tools/shots/out-race-lifecycle/`,
**18 frames**, 390 px, both themes, every stage above. Each frame drives the
app's own transitions (`recordRaceOutcome`, `startDevelopmentBlock`) inside the
page and re-renders through `renderApp()`.

The sweep also **measures** continuity rather than leaving it to the eye:
WHAT'S NEXT present at every Full Plan stage, no horizontal overflow, no page
errors.

---

## 6. Three harness mistakes of mine, worth recording

Every one of these produced a convincing false bug report about working code.

1. **The fixture never opened a block.** `buildPlan()` leaves
   `state.setup.blockId` unset, so `currentBlock()` is `null`,
   `recordRaceOutcome()` writes nothing and returns `null` — which looks
   *exactly* like "the outcome never clears". I nearly reported a broken
   lifecycle. `migrateAthleteRecord()` is the app's own path to a ledger entry
   and the fixture now uses it.
2. **The screenshot sweep pointed at the wrong screen.** Full Plan is its own
   view (`'full'`), not a Plan HQ tab; and `startDevelopmentBlock()` lands the
   athlete on Today — correctly, it has just rebuilt their schedule — so
   setting the view *before* running setup photographed Today for every frame.
   The sweep reported continuity missing from all sixteen Full Plan frames
   while the card was demonstrably rendering.
3. **The sweep matched prose instead of the element.** The card's title
   contains a curly apostrophe, and matching `innerText` for it failed even
   though the card was there. It now matches the `.coach-next-title` element.

Two of my new tests also tripped the cross-realm `deepEqual` trap (a value
built inside the VM sandbox is never reference-equal to one built outside), and
one regex reported a **"30-minute time trial"** as commercial messaging.

---

## 7. One existing test updated, not deleted

`test/raceDayContinuity.test.js` case **G** asserted the continuity card must
be **empty** during an active recovery block. That test pinned the exact
behaviour this brief asks to change.

What it was actually protecting — *nothing actionable mid-block* — is unchanged
and is now asserted explicitly: no `start-block` action, and no real
recommendation while recovery runs. Only the "must be silent" clause became
"must say where this goes".

---

## 8. Files changed

```
protected/velvet-viking-valhalla.html   blockChoicesFor() extracted; the DNF
                                        branch; the development-block preview
                                        in renderContinuityCard(); .yr-preview
test/raceDayLifecycle.test.js           NEW — 19 tests, the whole journey
test/raceDayContinuity.test.js          case G updated (§7)
tools/shots/race-lifecycle-shots.js     NEW — 18 frames + continuity measurement
RACE-DAY-HIERARCHY-REPORT.md            this file
```

**Not done, deliberately:** no new dashboard, no new methodology, no automatic
programme replacement, no commercial messaging, no general Full Plan redesign.
`raceOutcomePending()`, `renderRaceOutcomePrompt()`, `nextBlockRecommendation()`,
`renderBlockTransitionCard()` and `startDevelopmentBlock()` are all reused, not
replaced — a test asserts each still exists and that Full Plan still calls the
continuity card.

---

## 9. One thing still open, from the earlier brief

The **separate** race-day brief you queued earlier — *Race Day must not be
inside the final training week's mileage total* (Week 13 showing `0/71.7 km`
with "29.5 training + 42.2 race") — is **not addressed here**. This brief asked
for the lifecycle and explicitly said not to redesign Full Plan generally, and
the weekly-aggregation change is a different question about `weekVolume()`.

I have not touched it. Say the word and it is a small, separate pass.

---

## 10. Tests

Targeted: `raceDayLifecycle` 19/19, `raceDayContinuity` 14/14.
**Complete suite: 3047 pass / 0 fail** (3028 before; 19 new).

**Not merged. Awaiting your review.**
