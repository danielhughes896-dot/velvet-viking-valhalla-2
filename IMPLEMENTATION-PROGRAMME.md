# Implementation programme — plan mathematics remediation

**For final HQ approval. Nothing is implemented.** Branch
`audit/plan-mathematics-full-range`, unmerged. Engine, builder spec and
`test/audit/baseline.json` unchanged.

---

## 0. Two revisions to my own approved brief

HQ withheld authorisation on four constants and asked for evidence. Working
that evidence produced a better answer than the one I submitted, and two of the
four should be **withdrawn rather than authorised**.

### 0.1 `LONG_RUN_SAFE_GROWTH = 1.10` — WITHDRAWN

The decision brief derived the minimum viable start from *"can the long run
reach `longCapKm` at 10%/week in the weeks available"*. **That premise was
wrong in two ways.**

**First, `longCapKm` is a ceiling, not a target.** The engine computes
`longTarget = min(longCapKm, volume × LONG_FRACTION)`. Nothing requires the
long run to reach it. I treated a maximum as an objective.

**Second, the long run already grows at exactly the rate the weekly volume
grows** — it *is* `volume × LONG_FRACTION`. So there is no independent long-run
growth rate to set. What the product already states, through `profile.volMult`,
is that a block ramps `start → start × volMult`. Per developing week that is:

| implied growth / developing week | N=8 | N=12 | N=16 | N=20 | N=24 |
|---|---|---|---|---|---|
| 5K (×1.30) | 9.1% | 4.5% | 3.0% | 2.2% | 1.8% |
| 10K (×1.35) | 10.5% | 5.1% | 3.4% | 2.5% | 2.0% |
| Half (×1.55) | 15.7% | 7.6% | 5.0% | 3.7% | 3.0% |
| Marathon (×1.75) | 20.5% | 9.8% | 6.4% | 4.8% | 3.8% |
| Ultra (×2.00) | 26.0% | 12.2% | 8.0% | 5.9% | 4.7% |

Measured on real generated plans (50 km/week, five days, excluding rebound from
a cutback), the largest single-week growth is **24.4%** — an ultra block over
six weeks.

**This surfaces a finding the original audit did not: `volMult` is
block-length-invariant, so the per-week ramp rate is a function of how long the
block is rather than of the athlete.** An eight-week marathon block ramps at
20.5% per week and a twenty-four-week one at 3.8%, for the same athlete, same
distance, same goal. That is outside what HQ approved and is **flagged as a
seventh decision, not folded in.** It is also why a fixed 1.10 would have been
incoherent: it is simultaneously stricter than the product's own short-block
ramp and looser than its long-block ramp.

### 0.2 What replaces it — and it is a better-shaped decision

The genuinely missing quantity is not a rate. It is:

> **How long must the long run BE, at the end of a race block, for that race?**

Nothing in the product states this. `longCapKm` says how long it may be at
most. Priced against the conventional coaching bands:

| | cap | race | peak long / min start at fraction of cap | | | conventional peak |
|---|---|---|---|---|---|---|
| | | | **0.70** | **0.75** | **0.90** | |
| 5K | 12 | 5 | 8 km / 27 | 9 km / 29 | 11 km / 35 | 1.5–2.0 × race |
| 10K | 15 | 10 | 11 km / 33 | 11 km / 35 | 14 km / 42 | 1.4–1.8 × race |
| Half | 20 | 21.1 | 14 km / 33 | 15 km / 35 | 18 km / 42 | 0.85–1.0 × race |
| Marathon | 32 | 42.2 | 22 km / 40 | 24 km / 43 | 29 km / 52 | 0.70–0.80 × race |
| Ultra | 36 | 50 | 25 km / 35 | 27 km / 38 | 32 km / 45 | 0.60–0.72 × race |

Read across: **`longCapKm` is already the conventional peak long run for half,
marathon and ultra, and is generous for 5K and 10K.** A single global fraction
therefore does not work — 5K wants ≈0.75 of its cap and half/marathon want
≈0.90.

**Proposed instead — one number per distance, expressed the way each distance's
long run is actually justified:**

| | `MIN_PEAK_LONG_KM` | Basis | Min start volume |
|---|---|---|---|
| 5K | 8 | aerobic development; the race is too short to rehearse | 26 |
| 10K | 12 | aerobic development | 37 |
| Half | 18 | 0.85 × race — race-specific endurance | 41 |
| Marathon | 30 | 0.71 × race — race-specific endurance | 54 |
| Ultra 50K | 30 | 0.60 × race — time on feet | 42 |

`MIN_VIABLE_START = MIN_PEAK_LONG_KM / (volMult × LONG_FRACTION)`, using two
existing constants and one new per-distance number. **Block-length
independent**, which is more honest than my original table: a longer horizon
does not lower what a race block needs — it gives more room for the *on-ramp*
before it. The "you have time — take it" finding survives intact; it simply
lives in the on-ramp, which is where volume growth belongs.

**This is the single decision I most need HQ to rule on.** Five numbers, each a
plain coaching statement about one race.

### 0.3 `UNDISTRIBUTED_WARN_KM = 3/week` — WITHDRAWN

HQ is right, and the objection is fatal to the design as submitted: a tolerance
below which a shortfall is not reported *is* a mechanism that silently
legitimises allocator loss. §1 replaces it with an accounting identity in which
allocator loss cannot exist undeclared at any magnitude, and in which the
discriminating quantity is **computed per week, not chosen**.

---

## 1. The three-way distinction — the accounting identity

HQ's requirement is the structural core of this programme. Today there is one
undifferentiated quantity, `actual − target`, which conflates three unrelated
things. It is replaced by **four recorded quantities per week and one
invariant**.

```
intendedVolume        what the block arc asked for, before any adjustment

deliberateReduction   an INTENTIONAL reduction, with a named cause:
                      cutback | taper | recovery_ceiling | race_week
                      This is not a shortfall. Prescribing below demonstrated
                      capacity on purpose is the methodology working.

revisedTarget       = intendedVolume − deliberateReduction
                      ← THIS is what the allocator is asked to distribute.

allocatorRevision     volume the allocator could NOT place, with a named cause:
                      long_cap | easy_cap | day_count
                      MUST carry a declaration. MUST NOT exist undeclared,
                      AT ANY MAGNITUDE. There is no threshold.

prescribedTotal     = Σ session km actually built

roundingResidual    = prescribedTotal − (revisedTarget − allocatorRevision)
```

### The invariant, asserted at generation

```
|roundingResidual| ≤ roundingBound(week)

roundingBound = 0.5           (long run quantised to 1 km)
              + 0.25 × easyDays      (easy quantised to 0.5 km)
              + 0.5  × qualityDays   (quality ceil to 0.5 km)

allocatorRevision > 0  ⇒  declaration != null
```

**The bound is computed from the week's own session mix, not chosen.** Measured
across 7,254 weeks where the allocator succeeded and no deliberate reduction
applied:

| | |
|---|---|
| mean \|residual\| | **0.46 km** |
| max \|residual\| | **2.0 km** (ultra, 8 weeks, 6 days — theoretical bound 2.25) |
| weeks over 2 km | **0** |
| weeks over 3 km | **0** |

### Why this cannot legitimise loss

The three quantities are **separately named and separately accounted**. Nothing
is compared against a tolerance to decide whether it counts.

- A residual **within** the bound is rounding, and rounding is *reconciled* —
  the last child absorbs it (D-3 clause 4), so it does not accumulate.
- A residual **outside** the bound is, by construction, not rounding. It must
  have been attributed to `deliberateReduction` or `allocatorRevision`, both of
  which carry a named cause. **An unattributed difference is a generation
  failure, not a tolerated one.**
- `allocatorRevision` is **zero or declared**. There is no magnitude at which
  it is accepted quietly. The 531 km the audit found becomes 531 km of
  *declared, caused, athlete-visible* revision — or the target is changed
  before generation with the athlete's knowledge (D-5).

**What remains a threshold, and what it governs.** Whether to *interrupt the
athlete at build time* or *record the revision on the plan* is a separate
question about whose attention is needed. It operates on `allocatorRevision`,
which is already ≥ 0 and always declared. It cannot make anything silent
because there is nothing left that is silent. Proposed value: escalate when the
block-wide revision exceeds one week of the athlete's stated volume — derived
from the athlete's own number, not a constant.

---

## 2. Constants — evidence, and status after the above

| Constant | Status | Evidence |
|---|---|---|
| `LONG_RUN_SAFE_GROWTH = 1.10` | **withdrawn** | premise was wrong (§0.1); the long run already grows with the volume |
| `UNDISTRIBUTED_WARN_KM = 3` | **withdrawn** | replaced by a computed per-week rounding bound (§1) |
| `QUALITY_FLOOR_REPEAT_LIMIT = 1` | **derived — no new judgement** | the product already states its position twice. `MAINTAIN_POS_CYCLE` is three long *"so that an eight-week maintenance block contains no repeated session at all"*, and the base-block comment allows *"repeating one fartlek dose three weeks apart"* as ordinary. Repetition at distance is endorsed; **consecutive** repetition is endorsed nowhere. A limit of 1 is the weakest rule consistent with both. |
| `ONRAMP_STEP` absolute term | **derived** | `0.5 km × runningDays`. The easy-run rounding quantum is already 0.5 km, so this is the smallest weekly increase the engine can *express* — 1.5 km on three days, 3.0 km on six. |
| `ONRAMP_STEP` percentage term | **the one genuine new number** | see below |
| `MIN_PEAK_LONG_KM` (5 values) | **new — the decision HQ must take** | §0.2, priced against conventional bands |
| `MIN_LONG_RUN_KM = 6` | derived | the exact value at which the product's existing goal-segment floor (3) and ceiling (½ the run) stop contradicting |
| `MIN_QUALITY_SESSION_KM = 4.3` | derived | measured floor of the existing structure pools |
| `STIMULUS_MIN_*` | renamed | `TAPER_MIN_*` separated by purpose; same values |

### The one surviving judgement, and why it is not worth agonising over

On-ramp duration in weeks, four running days, against candidate growth rates:

| from → | 5 | 10 | 15 | 20 | 25 | 30 |
|---|---|---|---|---|---|---|
| **5%/wk** — marathon | 25 | 22 | 18 | 15 | 11 | 9 |
| **7.5%/wk** — marathon | 23 | 19 | 17 | 13 | 10 | 6 |
| **10%/wk** — marathon | 21 | 18 | 14 | 11 | 7 | 5 |
| **15%/wk** — marathon | 17 | 14 | 10 | 7 | 5 | 3 |

**A threefold change in the rate moves the answer by 2–8 weeks**, because the
*absolute* term dominates below 20–40 km/week — which is most of the on-ramp.
The percentage only takes over near the target.

**Recommendation: 7.5%.** At that rate the absolute term governs up to
27 km/week, so the percentage applies only in the last stretch where the
athlete is already running enough for a percentage to be meaningful; and it
sits below the product's own median block ramp, so an on-ramp never grows
faster than the block it feeds. If HQ prefers 5% or 10%, the programme does not
change — this is the least load-bearing number in the document.

---

## 3. The programme — eight stages

Ordered so that **each stage is independently verifiable against the existing
50,400-plan sweep**, and so that the measurement instrument exists before
anything it measures moves.

### Stage 0 · Volume accounting — instrumentation only
**No behaviour change.** Record the four quantities of §1 on every generated
week; assert the rounding-bound invariant at generation. Extend
`test/audit/planAudit.js` to capture them and `invariants.js` to check them.

*Why first:* every later stage is judged by whether volume moved for a named
reason. Without this, "actual ≠ target" stays one number and no stage can be
verified. It also converts D7 from a diagnosis into a measurement before any
attempt to fix it.

**Gate:** the ratchet must be **byte-identical**. Any change to a defect count
at Stage 0 means the instrumentation altered behaviour and the stage is wrong.

---

### Stage 1 · D-3 invariant + D-2 long-run floor and goal-finish omission
Taken together because D-2 is only *true* if D-3 holds — otherwise the weekly
cap silently reintroduces the defect after D-2 computed a correct segment,
which is exactly what the audit demonstrated at 18 km/week.

- Children derive from the settled parent, after rounding and after the cap.
- Subtraction never produces a component: easy is `parent × (1 − fraction)`.
- Where a floor exceeds its ceiling, the component is **omitted**.
- `MIN_LONG_RUN_KM = 6`; no goal-pace finish below it; a long run never rounds
  to zero.
- Generator-side assertion of `Σ components = parent`.

**Expected:** D1, D2, D3, D4 → **0**.

---

### Stage 2 · D-5 allocator + taper monotonicity
- `allocatorRevision` becomes zero-or-declared. No silent loss at any
  magnitude.
- Build-time interruption when the block-wide revision exceeds one week of the
  athlete's stated volume, with the day count editable on the same screen.
- Shortfall stated on the plan where the athlete proceeds anyway.
- No taper week exceeds the week before it (D-6 clause 4). Where floors would
  violate it, the floors yield.

**Expected:** D7 → **0 silent** (declared revisions may remain and are counted
separately). D6 → **0**.

---

### Stage 3 · D-1 boundary and classification — the gate only
Classification, the honest time answer, and restriction of the race
generator's domain. **No new generator yet** — an athlete below the boundary
gets the truthful "here is what this needs and how long it takes", not a plan.

- `MIN_VIABLE_START(distance, days)` from §0.2.
- `weeksRequired = onRamp + block`; where the event date does not allow it,
  offer a later date, a shorter distance, or an honest foundation statement.
- Builder asks distance, days and block length before it can classify — a
  change to the **question sequence**, not to validation.

**Expected:** D5, D8 → **0 within the race generator's domain**. Cases below the
boundary leave the race-plan population entirely and are counted as
classification outcomes.

---

### Stage 4 · The on-ramp generator
Volume-led, minimal quality (strides and one controlled steady effort), one
long run. `ONRAMP_STEP` per §2. Its only objective is to arrive at
`MIN_VIABLE_START`.

**Expected:** the 1–22 km/week band gains a coherent architecture with its own
invariants.

---

### Stage 5 · The foundation generator
Time-based and interval-based walk/run. Shares almost nothing with
`buildBlockWeeks`. Exit at ~30 min continuous × 3/week. **The largest single
piece of work here.**

**Expected:** 0 km/week becomes a legitimate, servable athlete state.

---

### Stage 6 · D-4 substitution ladder + D-6 stimulus floors
Depends on **new session content**: at least one genuinely small structure per
stimulus. Content authoring can start in parallel with Stage 0 and is the long
pole.

- `STIMULUS_MIN_*` separated from `TAPER_MIN_*`.
- Reduce → substitute → omit quality → remain in foundation.
- `QUALITY_FLOOR_REPEAT_LIMIT = 1`.

**Expected:** identical consecutive quality prescriptions become impossible;
the "identical 5 and 10 km/week block" case disappears.

---

### Stage 7 · Guidance Level rename
Rename the athlete-facing and developer-facing label; keep `state.experience`
as the persisted key. **No prescription wiring** — per HQ, true Experience
Level stays a separate future input and constrains as a ceiling.

---

## 4. How each stage is verified

### The instrument
Every stage re-runs, unchanged, on the identical input set:

| | |
|---|---|
| `node test/audit/sweep.js` | 50,400 plans · 705,600 weeks · 4,939,200 sessions |
| `node test/audit/discontinuity.js` | 14,280 adjacent-volume pairs |
| `npm test` | 3,384 tests including the 2,350-plan matrix and the ratchet |

The **input list never changes**, so every stage is comparable to the audit
baseline and to every stage before it.

### The expected movement, stage by stage

Counts are the committed baseline from the 2,350-plan suite matrix. **↓0**
means the ratchet is tightened to zero and asserted flat from then on.

| Defect | base | S0 | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|---|---|
| `segment_km_negative` | 1,230 | = | **↓0** | 0 | 0 | 0 | 0 | 0 |
| `zero_km_work_segment` | 695 | = | **↓0** | 0 | 0 | 0 | 0 | 0 |
| `long_run_zero_distance` | 528 | = | **↓0** | 0 | 0 | 0 | 0 | 0 |
| `goal_segment_consumes_whole_long_run` | 1,515 | = | **↓0** | 0 | 0 | 0 | 0 | 0 |
| `taper_week_increases_volume` | 455 | = | ↓ | **↓0** | 0 | 0 | 0 | 0 |
| `week_undershoots_target` | 2,329 | = | ↓ | **↓0 silent** | ↓ | = | = | = |
| `week_overshoots_target` | 5,934 | = | ↓ | ↓ | **↓0 in-domain** | = | = | = |
| `week_one_exceeds_stated_volume` | 854 | = | = | ↓ | **↓0 in-domain** | = | = | = |

### The three rules that make this honest

1. **A stage may only reduce.** The ratchet already fails on any rise, for
   defects *and* for the six coaching-suspicious counts. That is the guard
   against a fix that relocates a problem rather than removing it.
2. **A count may not fall for the wrong reason.** From Stage 3 the race-plan
   population shrinks, so a count could fall simply because cases left it.
   Every table entry from S3 onward is therefore asserted **per-population**:
   the race generator's counts are asserted over cases it still owns, and each
   new architecture starts its own baseline at **zero and flat** — never
   ratcheted down from an inherited number. **A case that moves architecture is
   recorded as moved, never as fixed.**
3. **New codes start flat, not baselined.** On-ramp and foundation get their own
   invariants (a foundation week has no quality; an on-ramp long run never
   exceeds `MIN_PEAK_LONG_KM`; an on-ramp reaches its target in its stated
   weeks). These are asserted at zero from their first commit — there is no
   defect record for architecture that never shipped.

### Continuity, held throughout
The audit's cleanest result is that continuity is already sound: zero jumps,
five reversals of −0.5 km. **Stage 3 introduces the first deliberate
discontinuity in the product** — the boundary between on-ramp and race
programme. It must appear in `discontinuity.js` as a **named, attributed gate**
and nowhere else. Any *unattributed* discontinuity appearing at any stage fails
that stage.

---

## 5. Risks

1. **Stage 5 is large and mostly new.** Foundation shares almost nothing with
   the existing generator. If HQ wants value sooner, Stages 0–3 are shippable
   on their own: they remove every hard arithmetic defect and replace the
   below-boundary plan with an honest answer, which is already a materially
   safer product than today's.
2. **Stage 6 is content-bound, not code-bound.** Approving D-4 commits to
   authoring small structures for every stimulus. This should start now.
3. **`MIN_PEAK_LONG_KM` moves the boundary for real athletes.** At the proposed
   values a marathon needs 54 km/week to start a race block. Some athletes who
   are served a plan today will be routed to an on-ramp. That is the intended
   effect and it should be a deliberate, informed choice.
4. **The `volMult` block-length finding (§0.1) is unresolved and outside
   approved scope.** An eight-week marathon block ramps at 20.5% per week. It
   does not block this programme, and it should not be fixed inside it.

---

## 6. What I need from HQ

1. **`MIN_PEAK_LONG_KM`** — the five numbers, or a different basis for them.
2. **`ONRAMP_STEP` percentage** — 7.5% recommended; low sensitivity.
3. **Confirmation that `LONG_RUN_SAFE_GROWTH` and `UNDISTRIBUTED_WARN_KM` are
   withdrawn** rather than deferred.
4. **A ruling on scope for the `volMult` finding** — a seventh decision, or
   explicitly out of scope.
5. **Approval of the stage order**, and whether Stages 0–3 may ship ahead of
   4–6.
