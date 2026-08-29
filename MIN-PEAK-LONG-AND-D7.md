# Final numerical gate: `MIN_PEAK_LONG_KM`, and D-7

**For HQ approval. Nothing implemented.** Branch `audit/plan-mathematics-full-range`,
unmerged. Engine, builder spec and `test/audit/baseline.json` unchanged. S1 not begun.

Two deliverables, as ruled.

---

# Part 1 · The five `MIN_PEAK_LONG_KM` values

### What the quantity is, precisely

**The smallest long run a race block must reach at its peak, for that race to
have been prepared for.** It is a **floor on the peak**, not a target and not a
cap — `longCapKm` remains the ceiling and is untouched.

It is defined on **`longTarget`**, the generator's weekly long-run allocation —
**not on the individual session**. This matters for ultra alone: `longTarget`
is split 0.62 / 0.38 across a back-to-back weekend, so an ultra `longTarget` of
30 km is an 18.6 km run followed by an 11.4 km run, which is the correct
reading of an ultra long weekend. Verified against the generator:
`ultra, 60 km/wk, week 6 → longTarget 36 → long_run 22 km + long_run_b2b 14 km`.

### The principle used to pick a point in each band

Two different justifications apply, and pretending otherwise would be the error:

- **5K and 10K — the long run is aerobic support.** The race is too short to
  rehearse in a long run. The floor therefore sits at the **bottom** of the
  band: setting it higher would route short-distance athletes to an on-ramp for
  a reason that has nothing to do with their race.
- **Half, marathon, ultra — the long run is race-specific endurance.** The
  floor sits where the athlete is **genuinely prepared**, not where the most
  athletes are admitted. **Admission is the on-ramp's job, not the floor's.**
  Lowering the floor to admit more athletes would move the compromise from a
  place where it is visible and managed into the race plan itself.

### The five values

`minStart = MIN_PEAK_LONG_KM / (volMult × LONG_FRACTION)` — both existing constants.

---

#### 5K — **8 km**

| | |
|---|---|
| **Evidence band** | 8–12 km. The long run is 20–25% of weekly volume in standard 5K programming; `longCapKm` is 12 (2.4 × race), generous relative to the race. |
| **Why this point** | Bottom of the band. For 5K the long run develops aerobic capacity; it rehearses nothing. 8 km is 1.6 × race distance, comfortably inside the conventional 1.5–2.0 × band, and 0.67 of the existing cap so the cap still has room to be a cap. |
| **Consequence** | `minStart` = **26 km/week** (peak 34). Routes **20.8%** of the audit input space to on-ramp — the smallest of the five. |
| **Sensitivity** | **3.21 km/week of start volume per km of long run.** 7 km → start 23; 9 km → start 29. |

#### 10K — **12 km**

| | |
|---|---|
| **Evidence band** | 12–16 km. Conventional 10K long runs run 1.4–1.8 × race; `longCapKm` is 15, already near the *bottom* of that band. |
| **Why this point** | Bottom of the band, same reasoning as 5K. 12 km is 1.2 × race — below the conventional band expressed against race distance, and deliberately so: at 10K the long run's job is aerobic, and the conventional multiple assumes an athlete whose weekly volume already supports it. Choosing 14 (inside the band) would push `minStart` to 44 km/week and route a third more athletes for no 10K-specific reason. |
| **Consequence** | `minStart` = **38 km/week** (peak 51). Routes **30.8%**. |
| **Sensitivity** | **3.09 km/week per km.** 11 km → start 34; 13 km → start 41. |

#### Half marathon — **18 km**

| | |
|---|---|
| **Evidence band** | 16–21 km (0.76–1.0 × race). Beginner half programmes peak at 16 km (10 miles); race-specific programmes at 19–21. `longCapKm` is 20. |
| **Why this point** | Not the bottom. 16 km would mean an athlete starts a half marathon never having run within 5 km of the distance, and this is the first distance at which the long run is race-specific rather than aerobic support. 18 km is 0.85 × race — the conventional lower bound *for a race-specific* plan — and 0.90 of the existing cap. **The 2 km above the floor of the band costs 5 km/week of admission threshold, and the on-ramp absorbs it.** |
| **Consequence** | `minStart` = **42 km/week** (peak 65). Routes **34.2%**. |
| **Sensitivity** | **2.30 km/week per km.** 17 km → start 40; 19 km → start 44. |

#### Marathon — **30 km**

| | |
|---|---|
| **Evidence band** | 29–34 km (0.70–0.80 × race). The 20-mile (32 km) long run is the near-universal reference peak; 18 miles (29 km) is the lowest defensible. `longCapKm` is 32. |
| **Why this point** | Just above the bottom. 30 km is 0.71 × race — inside the band, below the 32 km reference, and 0.94 of the existing cap. Setting 32 would make the floor equal to the ceiling, leaving the cap with nothing to cap and pushing `minStart` to 58. |
| **Consequence** | `minStart` = **54 km/week** (peak 95). Routes **44.2%** — the largest of the five, and the one to look at hardest. |
| **Sensitivity** | **1.79 km/week per km.** 29 km → start 52; 31 km → start 56. |

#### Ultra 50K — **30 km**

| | |
|---|---|
| **Evidence band** | 30–36 km (0.60–0.72 × race), as a **weekend total**. `longCapKm` is 36. |
| **Why this point** | Bottom of the band. 30 km is 0.60 × race, and splits to an 18.6 km / 11.4 km back-to-back weekend — a coherent ultra long weekend at the entry level. Time on feet, not distance, is the governing stimulus at this distance, which is why the bottom of the distance band is defensible where it would not be for the marathon. |
| **Consequence** | `minStart` = **42 km/week** (peak 84). Routes **34.2%**. |
| **Sensitivity** | **1.39 km/week per km** — the least sensitive of the five. 29 km → start 41; 31 km → start 44. |

---

### Summary, and the number HQ should weigh

| Distance | `MIN_PEAK_LONG_KM` | × race | × cap | `minStart` | routed to on-ramp |
|---|---|---|---|---|---|
| 5K | 8 | 1.60 | 0.67 | 26 km/wk | 20.8% |
| 10K | 12 | 1.20 | 0.80 | 38 km/wk | 30.8% |
| Half | 18 | 0.85 | 0.90 | 42 km/wk | 34.2% |
| Marathon | 30 | 0.71 | 0.94 | 54 km/wk | 44.2% |
| Ultra 50K | 30 | 0.60 | 0.83 | 42 km/wk | 34.2% |

**Across the whole 50,400-case audit population, 32.8% is routed to the
on-ramp.** That is the honest price of these values, and it is the number to
argue about rather than the kilometres.

Two things make it the right price rather than an alarming one:

1. **Routed is not refused.** Every one of those athletes keeps their goal,
   their goal time and their event date, and is given the route and its
   duration. Today they receive a plan whose week one is up to 32× what they
   said they run.
2. **All five values sit at or below the existing `longCapKm`**, so nothing
   here raises a limit or turns a backstop into a target. The largest is 0.94
   of its cap.

If HQ wants the marathon threshold lower, the lever is `MIN_PEAK_LONG_KM = 29`
(start 52, 0.69 × race) — one kilometre, two km/week, still inside the band.
Below 29 km the marathon long run leaves the conventional band entirely and I
would not propose it.

---

# Part 2 · D-7 — block-length-dependent volume ramp

## The mechanism, exactly

`buildBlockWeeks` sets `peakVolume = currentVolume × volMult` and then ramps
**linearly**:

```js
trend = currentVolume + (peakVolume − currentVolume) × (w / buildWeeks)
```

So the absolute weekly increment is `(volMult − 1) × start / buildWeeks`.
**`volMult` is a constant and `buildWeeks` shrinks with block length**, so the
increment scales as `1 / buildWeeks`. The same total growth is compressed into
however many weeks the athlete happens to have.

| N | buildWeeks | 5K ×1.30 | 10K ×1.35 | Half ×1.55 | Marathon ×1.75 | Ultra ×2.00 |
|---|---|---|---|---|---|---|
| 4 | 1 | 23.1% | 25.9% | 35.5% | 42.9% | **50.0%** |
| 5 | 2 | 13.0% | 14.9% | 21.6% | 27.3% | 33.3% |
| 6 | 3 | 9.1% | 10.4% | 15.5% | 20.0% | **25.0%** |
| 8 | 5 | 5.7% | 6.5% | 9.9% | 13.0% | 16.7% |
| 12 | 9 | 3.2% | 3.7% | 5.8% | 7.7% | 10.0% |
| 16 | 13 | 2.3% | 2.6% | 4.1% | 5.5% | 7.1% |
| 24 | 21 | 1.4% | 1.6% | 2.6% | 3.4% | 4.5% |

*(week-1→week-2 growth, the largest step in a linear ramp)*

**The model predicts the audit's measurement exactly.** The 24.4% ultra case is
N=6, predicted 25.0% before rounding. The mechanism is fully explained.

**The answer to HQ's question — "why can the same athlete/goal imply ~3.8% in
one block length and >20% in another"** — is that `volMult` answers *"how much
bigger is peak than start"* and is applied **without reference to how long the
athlete has to get there**. Nothing else differs. Block length is the only
input that changed.

## What `volMult` currently is

Of HQ's three options, it is unambiguously **a progression target**: `peak` is
always exactly `start × volMult`, subject only to the ceilings. Every block
reaches it, regardless of duration.

**That is a direct violation of the principle HQ asked to preserve.** *Capacity
provides permission, not obligation* — and a multiplier that is always attained
whatever the time available is an obligation. It is the same shape as the
ratchet the product already removed from `demonstratedSustainableVolume()`:
a quantity that describes what a block *may* reach, used as the thing every
block *must* reach.

## What it should be

> **`volMult` should be an end-state capacity ceiling.** It keeps its existing
> values and its existing meaning — *the most a peak week may exceed the block's
> start* — and stops being the thing every block drives to.
>
> **The actual peak becomes what a safe per-week rate reaches in the time
> available:**
> ```
> peakVolume = start × min(volMult, (1 + rate) ^ buildWeeks)
> ```
> Progression becomes **time-dependent**, which is what it should have been:
> a longer block earns more growth because it had longer to earn it.

**No existing value is renumbered.** `volMult` stays 1.30 / 1.35 / 1.55 / 1.75 /
2.00 and becomes reachable rather than compulsory.

### What it changes, and what it does not

Effective total multiplier at a candidate rate of 7.5%/week:

| | N=6 | N=8 | N=10 | N=12 | N=16+ |
|---|---|---|---|---|---|
| **Half** (ceiling 1.55) | 1.24 | 1.44 | **1.55** | 1.55 | 1.55 |
| **Marathon** (ceiling 1.75) | 1.24 | 1.44 | 1.66 | **1.75** | 1.75 |
| **Ultra** (ceiling 2.00) | 1.24 | 1.44 | 1.66 | 1.92 | **2.00** |

**Blocks of 12 weeks and longer are unchanged for half and marathon.** Only
short blocks are reined in — which is exactly where the defect lives, and
exactly where reining in is coaching-correct: a six-week block for an athlete
who is not already close to race-fit is a sharpening block, not a build.

### The interaction HQ must see before approving Part 1

Time-limiting the peak makes `MIN_VIABLE_START` **block-length dependent
again** — but derived correctly this time, and in the right direction: a short
block needs a *higher* start, because it cannot grow as much.

| `minStart` under D-7 at 7.5% | N=6 | N=8 | N=10 | N=12 | N=16+ | (today) |
|---|---|---|---|---|---|---|
| 5K | 27 | 26 | 26 | 26 | 26 | 26 |
| 10K | 41 | 38 | 38 | 38 | 38 | 38 |
| Half | 52 | 45 | 42 | 42 | 42 | 42 |
| Marathon | 76 | 66 | 57 | 54 | 54 | 54 |
| Ultra | 68 | 59 | 51 | 44 | 42 | 42 |

A six-week marathon block would require 76 km/week — which is the truthful
statement that you cannot build for a marathon in six weeks unless you are
substantially there already.

**Part 1's five values are unaffected by this.** `MIN_PEAK_LONG_KM` is a
property of the race, not of the block; only the derived `minStart` moves, and
only for blocks of ten weeks or fewer.

## Recommendation

1. **Adopt `volMult` as an end-state capacity ceiling**, per the formula above.
   No value is renumbered.
2. **The rate is a new decision belonging to D-7**, not a reuse of the on-ramp's
   7.5%. Per HQ's ruling that 7.5% belongs specifically to the on-ramp
   architecture, D-7 needs its own number, its own evidence and its own
   approval. The 7.5% used in the tables above is an **illustration for
   comparison**, not a proposal.
3. **D-7 does not enter S1–S3.** It changes weekly volume for every athlete in
   short blocks and must not ride inside the arithmetic fixes. It should be
   sequenced after S3 at the earliest, with its own before/after run against
   the same 50,400 cases.
4. **What D-7 must not do:** raise any ceiling, change `LONG_FRACTION`, or make
   any block ramp *faster* than today. Every effect of the proposed change is a
   reduction.

### What D-7 still needs before it can be proposed properly

- The safe per-week weekly-volume growth rate, with evidence. This is a
  genuinely open question and I have not answered it here — the honest state is
  that the 10%-per-week convention has weak direct evidence, and the product
  deserves a better basis than a convention.
- Whether the rate should be **athlete-dependent** (a novice's ceiling below an
  advanced athlete's) — which is precisely the shape HQ approved for a future
  Experience Level: *constrain as a ceiling rather than manufacture capacity*.
  D-7 and Experience Level should be decided together, or D-7 will need
  revisiting when Experience Level lands.

---

## Status

| | |
|---|---|
| Engine / builder spec / API | **no diff** |
| `test/audit/baseline.json` | **unchanged** |
| Branch | `audit/plan-mathematics-full-range`, **not merged** |
| S0–S3 | **not begun** — awaiting approval of Part 1 |
| Constants encoded | **none** |
