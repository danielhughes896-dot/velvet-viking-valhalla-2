# Plan mathematics audit — full input range

**Base SHA** `7f3dfb5ce93dee56cf00cdfcf6c9acc19f90e3a4` (`main`)
**Branch** `audit/plan-mathematics-full-range` — not merged
**Verdict** **RED**

The engine generates coherent, coach-plausible plans inside a **bounded window
of stated weekly volume**, and materially inappropriate ones outside it in both
directions. The window is narrower than the input the builder accepts, and
nothing tells the athlete — or us — which side of it they are on.

---

## 1. The question, answered

> *Can I let an athlete enter any supported current weekly volume — including
> 0 km/week — and trust Valhalla to produce a mathematically coherent,
> physiologically sensible plan for their chosen race?*

**No.**

- **0 km/week is not reachable.** The builder validates `volume > 0`
  (`BUILDER_SPEC.validation.volumeMustExceed = 0`), so the smallest accepted
  input is 1. There is no onboarding or base-building path, and no upper bound
  is validated at all.
- **Below the window** (roughly under 22–26 km/week on a five-day week) the
  engine emits negative distances, zero-distance components, 0 km "Long Runs",
  and weeks up to **32× the athlete's stated volume**.
- **Above the window** (roughly over 65–95 km/week, earlier on fewer days) the
  engine silently under-delivers: an 80 km/week 10K athlete on three days is
  prescribed **38 km/week, flat, for nine weeks**.
- **Inside the window the plans are good.** At 40 km/week for a half and
  70 km/week for a marathon, target and actual agree to within 1%, the long run
  holds 27–32% of the week, cutbacks and taper behave, and the progression is
  one a coach would recognise. The methodology is sound. The arithmetic that
  implements it fails at the edges.

### The coherent window, measured

Smallest and largest stated weekly volume (km/wk) producing a 12-week plan with
**no hard findings**, by race distance and running days:

| | 3 days | 4 days | 5 days | 6 days |
|---|---|---|---|---|
| **5K** | 15–30 | 19–47 | 26–56 | 31–69 |
| **10K** | 14–34 | 19–55 | 25–66 | 30–81 |
| **Half** | 13–41 | 17–65 | **23–73** | 26–104 |
| **Marathon** | 12–62 | 17–86 | 22–94 | 25–160 |
| **Ultra 50K** | 11–56 | 14–80 | 21–87 | 26–78 |

Everything outside these ranges is an input the builder accepts and the engine
mishandles.

---

## 2. The observed failure, traced

The screenshots are a half-marathon athlete at roughly 10–15 km/week. The
prescription is reproduced exactly from inputs in
`test/planMathematicsInvariants.test.js`.

**Input** `half`, 12 km/week, 12 weeks, 5 days. **Week 3.**

```
profile.volMult 1.55              peakVolume = min(12 × 1.55, ceiling 140) = 18.6
week 3 volume                     14.2
LONG_FRACTION.threshold 0.28      longTarget = min(longCap 20, 14.2 × 0.28) = 3.976 → 4.0
pos = (3-1)/(9-1) = 0.25          raw goal segment = 4.0 × (0.2 + 0.18 × 0.25) = 0.98
                                  clamp(0.98, lo = 3, hi = longTarget × 0.5 = 2.0)
clamp(n,lo,hi) = max(lo,min(hi,n))            = max(3, 0.98) = 3      ← the floor beats the ceiling
distributeWeekVolume + capWeeklyVolume        day km 4.0 → 3
settle-up: params.km = round1(dd.km) = 3      params.finishKm untouched = 3
segmentsFor: easy = round1(3 − 3)             = 0
```

**Result:** a day titled **“Long Run + Goal Pace”**, 3 km, printed as
*easy 0 km + goal pace 3 km*. Example 2 (1 km / 3 km) is the same defect at
15 km/week.

This is precisely the pattern §10 of the brief hypothesised —
`round(total) − fixedComponent` — and it is present in two independent places.

---

## 3. Hard defects

Arithmetic or structural facts that are wrong on any reading. Counts are from
the full sweep (50,400 plans).

### D1 — the goal-pace floor overrides its own ceiling
`buildBlockWeeks`, line ~5034
```js
var goalSegKm = hasGoalSegment ? round1(clamp(longTarget*(0.2+0.18*pos),3,longTarget*0.5)) : 0;
```
`clamp(n,lo,hi)` is `Math.max(lo, Math.min(hi, n))`, so when `longTarget < 6`
the floor of 3 exceeds the ceiling of `longTarget × 0.5` and **the floor wins**.
The code states two bounds that contradict each other below 6 km and silently
resolves the contradiction in favour of the one that produces a segment larger
than the whole run.

*Affected:* half and marathon, stated volume **1–17 km/week** (segment ≥ the
run: 14,875 weeks) and **7–32 km/week** (segment over half the run: 8,172).
*Severity:* **critical** — it is the direct cause of the screenshots.

### D2 — `finishKm` does not follow the run it finishes
`buildDaysFromWeeks` ends with a settle-up pass:
```js
if (meta && meta.dayKmParam) p.params[meta.dayKmParam] = round1(dd.km);
```
`long_run_goal_finish` declares `dayKmParam:'km'`, so `km` correctly follows
smart rounding and `capWeeklyVolume`. `finishKm` is derived from the same run
and is **not in that pass**, so it keeps a value computed before the trim.

Demonstrated independently of D1: at `half`, 18 km/week, 8 weeks, week 2 has
`longTarget` 6.2 — the ceiling binds properly and `goalSegKm` is a legitimate
3 km, under half. `capWeeklyVolume` then cuts the day to 4 km and `finishKm`
stays 3, leaving **75% of the “long run” at goal pace**.
*Severity:* **high** — survives any fix to D1 on its own.

### D3 — subtraction after rounding, with no floor
`segmentsFor`, line ~5609
```js
case 'long_run_goal_finish':
  return [ segWork({km:round1(q.km-q.finishKm)}, 'easy'),
           segWork({km:q.finishKm}, 'goal_pace') ];
```
No floor. **Minimum observed component: −2 km** (`half`, 2 km/week: a 1 km
session whose easy component reads −2 km).
*Affected:* half and marathon, **1–13 km/week**, 11,774 components.
*Severity:* **critical** — a negative distance reaches the card.

### D4 — a “Long Run” of 0 km
`roundWorkoutKm('long', km)` rounds to the nearest whole km, so a 0.4 km long
run becomes **0**. The day keeps the title, the type and a 0 km work segment.
*Affected:* every distance, **1–3 km/week**, 5,256 days.
*Severity:* **high**.

### D5 — week one exceeds the athlete's stated volume, by up to 32×
`EASY_MIN_KM` is 3, quality structures have their own floors
(`TAPER_MIN_WORK_MIN` 10, `TAPER_MIN_WORK_KM` 2, rep-count floors), and
`capWeeklyVolume` refuses to trim an easy day below 3 or a long run below 70%
— and **never trims a quality day at all**. The smallest week the engine can
emit is therefore set by the number of running days, not by the athlete:
**8 km on three days, ~20 km on six**.

A 1 km/week 5K athlete is prescribed **17.5 km in week one**, 66% of it
quality, with a 0 km long run — and an identical plan to a 5 km/week athlete.
Worst observed ratio: target 0.7 km, actual 22.5 km — **32×**.
*Affected:* all distances, **1–109 km/week** (7,608 plans).
*Severity:* **critical**. This is the brief's *capacity is permission, not
obligation* principle inverted: the floors make the engine unable to express
the small end at all.

### D6 — a taper week larger than the week before it
Where the floors bind, taper weeks sit at the same floor as build weeks and
rounding pushes some above their predecessor. Also occurs at the top of the
range where the caps bind.
*Affected:* **1–16, 19, 48–120 km/week**, 10,501 weeks. *Severity:* medium.

### D7 — the plan silently under-delivers at high volume
`profile.longCapKm` and `EASY_MAX_FRACTION_OF_LONG` cap the week far below
target when the day count is low. The engine **knows** — it writes a
`planBuildNotes` entry — and the athlete is told nothing, by explicit design
(*“the answer is always run more days, which is their decision, not the app's”*).

At 10K, 80 km/week, 3 days: target 83–108 km/week, actual **35.5–44.5**, with
45.2 km undistributed in week one, **531 km undistributed across the block**
and a build note on 11 of its 12 weeks. The long run is pinned at its 15 km cap
for every one of nine build weeks; the plan does not progress at all.
*Affected:* **28–120 km/week**, 190,331 weeks. *Severity:* **high** — the
design decision is defensible; its silence at this magnitude is not.

### D8 — the small end of the week is unreachable
Consequence of D5, recorded separately because it is the thing to decide about:
**`minWeekKm` across 50,400 plans is 8 km**. There is no prescription in the
engine for an athlete below that, at any distance, on any schedule.

---

## 4. Mathematically valid, coaching-suspicious

Not asserted as defects. What to do about them is a methodology decision.

| Finding | Weeks | Stated-volume range |
|---|---|---|
| Quality is over 40% of the week | 124,567 | 1–50 |
| The long run is shorter than a quality session | 112,928 | 1–56 |
| A week grows over 10% on a week that was itself on trend | 1,940* | 1–120 |
| The long run is shorter than an easy run | 50,316 | 1–35, scattered to 88 |
| A long run under 5 km on a half, marathon or ultra plan | 44,109 | 1–29 |
| The goal-pace finish is over half the long run | 8,172 | 7–32 |

\* growth measured against a cutback week is excluded — returning to trend
after a deliberate 78% week is the design, not a jump.

**12.9% of all generated long runs are 4 km or shorter**, and **16% of every easy
run generated is exactly 3 km** — the floor, not a decision.

Three specific patterns worth naming:

1. **The quality sessions are sized independently of the week.** Their distance
   is whatever their structure prescribes, shrunk to fit
   `volume × LONG_FRACTION` and then floored. At low volume every structure sits
   on its floor, so the quality day is 5–9 km against a long run of 1–3 km and a
   week target of 10–14 km.
2. **A low-volume athlete gets a chopped-down advanced workout, not a
   developmental session.** At 5 and 10 km/week the block is *identical*: every
   quality session pinned at its floor —`progressive_tempo {min:10}` three
   times, `split_tempo {min:10,split:2}` three times,
   `threshold_continuous {km:2}` six times — across sixteen weeks with **no
   progression at all**. This is the repeated “Progressive Tempo: 10min”.
3. **The goal-pace segment follows the goal, everything else follows current
   fitness.** That is the established methodology and is correct in itself. But
   for a 12 km/week athlete with a 1:45 half goal off a 60:00 10K, current
   threshold is 5:56/km and goal pace is 4:59/km — so when D1 makes the entire
   long run goal pace, the whole session is faster than threshold.

---

## 5. What is already right

- **Continuity.** 14,280 adjacent-volume pairs compared across every distance,
  six block lengths and four day counts: **zero jumps**, five reversals of
  −0.5 km across a whole plan (rounding noise), 198 structural steps, **all
  attributable to a named rule** (long-run whole-km rounding, `longCapKm`). A
  1 km change in stated volume never produces a discontinuous plan. The engine's
  problems are smooth, not threshold-driven.
- **No NaN, no Infinity, no throw** anywhere in 50,400 plans.
- **No negative session distance** — only components.
- **Components reconcile with their session** wherever every component states a
  distance.
- **Training paces follow current fitness.** An athlete with a benchmark of
  VDOT 32 and a goal of VDOT 58 trains at the benchmark's paces. The
  `currentFitnessAnchor()` hierarchy is intact.
- **Inside the window the plans are genuinely good** (see §1).

---

## 6. Experience levels

`novice` / `experienced` / `advanced` are **presentation only** — the engine
never reads them. `buildBlockWeeks`, `buildDaysFromWeeks`,
`distributeWeekVolume`, `pickQualityStructure`, both shrink functions and
`volumeCeilingFor` contain no reference to experience.

So the differences are not merely explainable; **there are none**. A novice at
10 km/week and an advanced athlete at 10 km/week receive the identical, and
identically broken, plan. This is the documented design, asserted in the test
file so a future change has to say so.

---

## 7. Rounding audit

| Operation | Where | Order | Reconciles? |
|---|---|---|---|
| `round1` on weekly volume | `buildBlockWeeks` | parent first | yes |
| `round1` on `longTarget` | `buildBlockWeeks` | parent first | yes |
| `clamp(…, 3, longTarget×0.5)` on `goalSegKm` | `buildBlockWeeks` | child sized from **pre-cap** parent | **no — D1** |
| `distributeWeekVolume` easy/long | day loop | parent, then children | yes |
| `roundWorkoutKm` (long → 1 km, easy → 0.5 km, quality → ceil 0.5 km) | day push | **parent rounded after children sized** | **no — D2, D4** |
| `capWeeklyVolume` trims easy then long | after all days | **parent trimmed after children sized** | **no — D2** |
| settle-up `p.params[dayKmParam] = round1(dd.km)` | last | parent → child, **one param only** | **no — D2** |
| `round1(q.km − q.finishKm)` | `segmentsFor` | **subtract after rounding, no floor** | **no — D3** |

The engine rounds the parent last and the children first, then reconciles only
one of the two children. Every hard defect above is a consequence of that
ordering.

---

## 8. Implementation gate — what I did not change

Per §19 of the brief, **no engine code was modified**. D1–D4 are indisputable
implementation defects and are individually fixable, but every fix requires a
coaching decision that is not mine to take:

| Fix | Decision it requires |
|---|---|
| D1 — make the ceiling bind | What *is* the goal-pace segment on a 4 km long run? Half of it (1.5 km), or none at all? “None below a size” is a new rule. |
| D2 — put `finishKm` in the settle-up | Recompute it from the final km — with which fraction? Same question as D1. |
| D3 — floor the easy component at 0 | Alone, this converts a visible failure into an invisible one. §2 of the brief forbids exactly that. |
| D4 — stop rounding a long run to 0 | Requires a minimum long-run distance — a new rule. |
| D5/D8 — the small end | Requires low-volume methodology: a genuine base-building prescription, duration-based sessions, or a stated minimum. All new. |
| D7 — high-volume silence | Requires deciding what to tell the athlete. |

Fixing the arithmetic without the methodology would make a 3 km “long run”
print tidily instead of printing a negative number. That is the display patch
§2 rules out.

---

## 9. Recommended decisions, in priority order

1. **A minimum viable long run**, absolute and as a fraction of the race
   distance. Everything in D1–D4 resolves once a long run cannot be smaller
   than the goal segment it is meant to contain.
2. **Suppress the goal-pace finish below that minimum** rather than shrinking
   it. A goal-pace segment with no aerobic lead-in is not a smaller version of
   the session; it is a different one.
3. **A low-volume prescription that is not a chopped-down high-volume one.**
   Duration-based easy running and a developmental long run, under the existing
   methodology — the engine currently has no way to express the small end at
   all (D8).
4. **Let `capWeeklyVolume` trim quality**, or size quality from the week rather
   than flooring it. Quality is 40–70% of every low-volume week today.
5. **Decide what a builder that accepts 1 km/week should do** — refuse it,
   route it to onboarding, or serve it. Any of the three is defensible; the
   current answer (serve a 17.5 km week) is not.
6. **Say something at the top of the range** where `planBuildNotes` already
   knows the plan is 45 km/week short of its own target.

---

## 10. Audit tooling

Outside the production runtime; nothing here ships or is reachable from the app.

| File | What it is |
|---|---|
| `test/audit/planAudit.js` | Drives `buildBlockWeeks` + `buildDaysFromWeeks` and measures the result |
| `test/audit/invariants.js` | What counts as a hard defect vs coaching-suspicious |
| `test/audit/matrix.js` | The deterministic 2,350-plan matrix the suite runs |
| `test/audit/sweep.js` | The full 50,400-plan sweep — `node test/audit/sweep.js` |
| `test/audit/discontinuity.js` | Adjacent-volume continuity — `node test/audit/discontinuity.js` |
| `test/audit/report.js` | The representative plan tables |
| `test/audit/baseline.json` | **A defect record, not an approval.** The ratchet the suite holds |
| `test/planMathematicsInvariants.test.js` | 23 property tests over the matrix |
| `test/audit/out/` | Generated output, not committed |

The suite's new tests assert flat-zero for the invariants that hold everywhere
today, and hold the known defects against a **ratchet**: the counts may fall,
never rise. Nothing existing was weakened.
