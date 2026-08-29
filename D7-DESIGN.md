# D-7 · Block-length-dependent volume ramp — design and evidence

**Analysis only. Nothing implemented.** Branch `impl/plan-mathematics-s0-s3` @ `aae4346`,
unmerged. Engine unchanged; the S0–S3 ratchet, instrumentation and tests are
untouched. Every candidate below was measured by simulation — mutating
`volMult` inside the test sandbox for one build and restoring it immediately —
so no change reached the repository.

Recorded as instructed: **the earlier `ONRAMP_STEP` "2–8 weeks" sensitivity
claim is withdrawn. The verified worst case is 18 weeks.** `ONRAMP_STEP`
remains unimplemented and 7.5% remains provisional, not methodology authority.

---

## 1. Headline

**The two surviving in-race defect classes have unrelated causes, and only one
of them is D-7.**

| | cause | D-7 fixes it? |
|---|---|---|
| 26 week-one overshoots | `volMult` applied without reference to time available | **Yes — to zero** |
| 48 taper increases | quality-structure selection, two mechanisms, neither duration-related | **No — unchanged** |

And a scheduling finding that matters more than either: **D-7 cannot pass the
whole-population ratchet while routed athletes are still served by the race
generator.** It should land after S4/S5, not now.

---

## 2. Causal chain — the 26 week-one overshoots

```
blockArcFor('race', 4)  ->  buildWeeks 1, taper 2
progress  = w / buildWeeks            = 1/1 = 1        (week one)
trend     = start + (peak − start)×1  = peak
peak      = start × volMult
=> week one IS the peak, at start × volMult
```

The absolute weekly increment is `(volMult − 1) × start / buildWeeks`.
`volMult` is a constant; `buildWeeks` shrinks with block length. **The same
total development is compressed into however many weeks the athlete happens to
have.**

**Distribution — all 26:**

| | |
|---|---|
| Programme duration | **N=4 only** (26 of 26) |
| Distance | 5K 9 · 10K 4 · half 2 · marathon 3 · ultra 8 |
| Days/week | d5 23 · d3 3 |
| Starting volume | 26–80 km/wk, one per volume — i.e. **every** viable athlete at N=4 |

Worst observed: an **ultra athlete stating 60 km/week over four weeks is
prescribed a 120 km peak and a 120 km week one** — 2.00× stated, in the first
week.

---

## 3. Causal chain — the 48 taper increases, which are **not** D-7

**Distribution — all 48:**

| | |
|---|---|
| Programme duration | N = 4, 8, 12, 16, 24 — **spread across every duration** |
| Starting volume | **70–120 km/wk only** |
| Days/week | d3 32 · d5 16 |
| Distance | 5K 28 · 10K 8 · half 8 · marathon 2 · ultra 2 |

High volume, few days, all durations. **Nothing about block length.** Simulated
under D-7 candidate B the count falls 48 → 41 with an identical profile — and
the 7 that go are simply N=4 blocks that no longer have the same taper, not
cases fixed.

Two mechanisms, and they account for all 48 with nothing left over:

### 3a · Track alternation — 32 cases
With three or four running days there is **one** quality slot, and
`singleSlotKind` alternates the two stimuli by week parity. The S2 taper bound
holds each track against **its own** previous value, and each track does fall
correctly — but consecutive *delivered* weeks come from different tracks.

Measured, `5k | 100 km/wk | 12 wk | d3`:

```
wk 9   interval 11.2  tempo 8.0   delivers interval  11.2
wk 10  interval  6.4  tempo 6.0   delivers tempo      6.0   TAPER
wk 11  interval  8.1  tempo 5.0   delivers interval   8.1   TAPER  <- rises
```
Interval 11.2 → 8.1 falls. Tempo 8.0 → 6.0 falls. **Delivered 6.0 → 8.1 rises.**

*Correction: bound the delivered sequence, not each track. Small, self-contained,
and inside the already-approved D-6 clause 4. It is a defect in my own S2 work
and I am reporting it rather than folding it into D-7.*

### 3b · Structure floors — 16 cases
With five or six days both slots run every week, so there is no alternation.
Here the tapered structure **cannot shrink to the previous week's size because
its own floor is larger**. Measured, `5k | 100 km/wk | 12 wk | d5`:

```
wk 10  interval 6.5 + tempo 6.0     = 12.5   TAPER
wk 11  interval 8.5 + threshold 5.0 = 13.5   TAPER  <- rises
```
The week-11 interval is at its floor. The bound asked for 6.5 and 8.5 is the
smallest that structure can be.

*Correction: this is **S6**, not D-7 and not a code change. It needs a smaller
structure of the same stimulus to substitute to — the content dependency
already flagged when D-4 was approved.*

**Answer to HQ's question 3: taper monotonicity has an independent surviving
cause — in fact two, and neither is D-7.**

---

## 4. What the engine already has for *earned* development

This is the most useful thing the investigation turned up.

**The product already has a complete apparatus for earned development. It
operates BETWEEN blocks and has no counterpart WITHIN one.**

| Existing mechanism | What it requires |
|---|---|
| `progressionJustification()` | an affirmative finding that more is right: demonstrated capacity, a development-purpose previous block, no missed sessions, execution landing on prescription, **the previous peak actually reached**, and a once-per-cycle gate |
| `demonstratedSustainableVolume()` | permission only — it can hold the answer down, never anchor it |
| `cappedBlockStartVolume()` | a block never opens above what the athlete is currently doing |
| `PEAK_OVER_DEMONSTRATED = 1.30` | a peak week may exceed demonstrated capacity by 30% |

Between blocks, development must be **earned and justified**. Within a block it
is granted **unconditionally, at a fixed multiple, regardless of time available
or evidence**. That asymmetry is D-7 stated precisely.

### 4a · And the product already contradicts itself on the size

The comment above `PEAK_OVER_DEMONSTRATED` says, in as many words:

> *"A peak week is temporary and is MEANT to exceed habitual volume — that is
> what a build is — **but it is not meant to exceed it by half.**"*

Two of the five `volMult` values exceed it by more than half — marathon 1.75
and ultra 2.00 — applied to the athlete's **stated** volume. On a first block
`demonstratedSustainableVolume()` is null, so the 1.30 bound never binds and
nothing else does.

**The engine holds two written positions on how much a block may add, they
disagree, and the disagreement is invisible because one only applies once the
athlete has history.** That is a finding for HQ in its own right; it is not
something I have acted on.

---

## 5. Candidate formulations

All are for `developmentMultiplierFor(distKey, planWeeks)` — the seam S3
already installed, which every caller already passes `planWeeks` to.

**The anchor: `buildWeeks` at the engine's own default race block.**
`BUILDER_PURPOSE_META.race.defaultWeeks` is **14**, which is
`blockArcFor('race',14).buildWeeks` = **11 developing weeks**. `volMult` was
designed for a block of that shape. Using it as the reference introduces **no
new number** — it is the product's own stated normal.

| | formulation | new constants |
|---|---|---|
| **A** | `min(volMult, (1+r)^buildWeeks)` | a rate `r` — **rejected**, this is the generic percentage rule HQ ruled out |
| **B** | `1 + (volMult − 1) × min(1, buildWeeks / 11)` — linear in developing weeks | **none** |
| **C** | `min(volMult, volMult ^ (buildWeeks / 11))` — geometric | **none** |
| **E** | `buildWeeks < 3 ? 1 : volMult` — hold short blocks flat | a threshold |

B and C both return **exactly `volMult`** at and above the engine default, so
neither can flatten a normal programme by construction.

---

## 6. Sensitivity, measured across the matrix

Routing recomputed against each candidate's own multiplier, since
`minViableStartKm` depends on it.

| | worst week-one jump | routed | in-race week-one overshoots | in-race taper |
|---|---|---|---|---|
| **today** | **100.0%** (ultra N=4) | 78.3% | 25 | 48 |
| **B linear** | **9.1%** | 81.4% | **0** | 41 |
| **C geometric** | **9.1%** | 81.6% | **0** | 41 |
| E hold-flat | 33.3% | 34.8%* | — | — |
| A rate 7.5% | 10.2% | 35.7%* | — | — |

\* arithmetic estimate only; A and E were not measured through the engine.

The 9.1% floor is not a residue of the fix — it is the **normal** week-one step
an ultra block already takes at full length (1/11 of a 100% total). B and C
both reach it.

### Normal-duration programmes are untouched — byte-identical

`half | 45 km/wk | 5 days`, candidate B:

| N | peak today | peak under B | sessions identical |
|---|---|---|---|
| 14 | 69.8 | 69.8 | **yes** |
| 16 | 69.8 | 69.8 | **yes** |
| 20 | 69.8 | 69.8 | **yes** |
| 24 | 69.8 | 69.8 | **yes** |

Max peak reduction anywhere at N ≥ 14, across every distance: **0.0%**.

### Compressed programmes — `ultra | 60 km/wk | 5 days`

| N | peak today → B | week one today → B | week-one ratio |
|---|---|---|---|
| 4 | 120 → **65.5** | 120 → **66** | 2.00 → **1.10** |
| 6 | 120 → 76.4 | 80.5 → 66.5 | 1.34 → 1.11 |
| 8 | 120 → 87.3 | 72 → 66 | 1.20 → 1.10 |
| 12 | 120 → 109.1 | 67 → 66 | 1.12 → 1.10 |

### Continuity

| | |
|---|---|
| Adjacent stated-volume pairs under B | **5,950 · 0 reversals · 0 jumps** |
| Block-length axis (the new one D-7 exposes) | multiplier walks 1.05 → 1.55 in even steps, then plateaus at the engine default. Monotone, no cliff. |

### Long-run viability, peak volume, routing, attribution

- **Long-run viability**: unchanged at N ≥ 14. Below it the peak long run falls
  with the peak, which is why the routing threshold rises — the boundary is
  doing its job rather than being bypassed.
- **Routing rate**: 32.8% → 36.8% over the full input space, entirely at short
  durations. A four-week marathon would need 88 km/week rather than 54 — which
  is the truthful statement that a four-week marathon block is a taper.
- **Volume attribution**: unaffected. The accounting identity does not read
  `volMult`; `intendedVolume` simply becomes a smaller number.

---

## 7. The finding that governs sequencing

**D-7 makes the routed population's plans worse, and the whole-population
ratchet would therefore block it.**

Measured under candidate B, whole population:

| | today | B |
|---|---|---|
| `long_run_zero_distance` | 528 | **576** |
| `zero_km_work_segment` | 528 | **578** |
| `generator_invariant_failure` | 528 | **576** |
| `long_run_implausible_for_distance` | 4,735 | **5,078** |
| `taper_week_increases_volume` | 439 | **500** |

A lower multiplier means a lower peak, so `longTarget = volume × LONG_FRACTION`
is smaller all block, and more weeks produce a sub-kilometre long run that
rounds to zero — **in the routed population**, whose plans should not be being
generated at all.

Two ways out, and I recommend the first:

1. **Sequence D-7 after S4/S5.** Once routed athletes are served by foundation
   and on-ramp, the race generator no longer builds those cases and the whole
   population *is* the race population. D-7 then passes the ratchet as it
   stands, with no rule changed to accommodate it.
2. Scope the ratchet to the in-race population for D-7 specifically. Cheaper,
   and it weakens the guarantee exactly where the guarantee has been useful.

---

## 8. Should very short programmes route or hold instead?

**Neither, and the evidence says so.** Candidate E — holding short blocks
completely flat — leaves a 33.3% worst-case week-one jump, because it only
catches `buildWeeks < 3` and the problem extends well beyond that. Routing all
short blocks out would refuse an athlete who is already at the required volume
and simply wants a four-week sharpening block, which is a legitimate thing to
want.

**B and C answer it without a special case:** a four-week block earns 1/11 of
the development a full block earns, so it becomes a sharpening block *by
arithmetic* rather than by category. An athlete not already near race-fit is
then routed by the existing viability boundary — because the boundary is
computed from the same multiplier. One mechanism, two correct outcomes, no new
rule.

---

## 9. Recommendation

> **Adopt candidate B.** `developmentMultiplierFor` returns
> `1 + (volMult − 1) × min(1, buildWeeks / buildWeeks(defaultWeeks))`.

**Rationale**

- **It introduces no new number.** `volMult` keeps every existing value and
  becomes an end-state capacity ceiling; the reference is the product's own
  `defaultWeeks: 14`. There is no growth percentage, generic or otherwise.
- **Programme duration constrains what can be earned**, which is the approved
  correction stated exactly.
- **Capacity remains permission.** The multiplier can now only ever be lower
  than today. No ceiling rises, no backstop moves, and the change cannot walk
  any athlete upward.
- **Nothing legitimate is flattened.** Blocks at or above the engine's own
  default are byte-identical.
- **It leaves room for Experience Level.** A future ceiling multiplies onto the
  same seam without displacing it, exactly as HQ specified — and is not
  fabricated here.
- **B over C**: both perform identically on every measure. B is linear in
  developing weeks, which is the sentence "half the weeks earn half the
  development" and can be explained to an athlete. C's exponent is not
  explicable without algebra, and buys nothing.

**What I am NOT recommending**

- Not the 7.5% rate, or any rate. Candidate A is listed only as the rejected
  comparator.
- Not implementing now. Sequence after S4/S5 for the ratchet reason in §7.
- Not touching the two taper mechanisms as part of D-7 — 3a is an S2 defect of
  mine needing its own approval, 3b is S6 content.
- Not acting on the `PEAK_OVER_DEMONSTRATED` contradiction in §4a. It is
  reported for HQ's decision.

---

## 10. Status

| | |
|---|---|
| Engine / builder spec / API | **no diff** |
| S0–S3 ratchet, instrumentation, tests | **untouched** — no measurement error found |
| Branch | `impl/plan-mathematics-s0-s3`, unmerged |
| D-7 | designed, measured, **not implemented** |
| New constants encoded | **none** |
