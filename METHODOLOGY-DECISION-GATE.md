# Plan mathematics — methodology decision gate

**Status** Proposal for HQ approval. **No engine code, builder validation or
constant has been changed.** The audit branch `audit/plan-mathematics-full-range`
(`8c090ee`) and `test/audit/baseline.json` are untouched.

Every number below is **derived and shown**, from one of three sources:

| Source | Meaning |
|---|---|
| **existing** | a constant already in the runtime, carried forward unchanged |
| **derived** | forced by existing constants or by measurement of the engine's own structures |
| **proposed** | a genuinely new coaching number — flagged, with its rationale and the alternatives |

There are only **four** genuinely new numbers in this whole document. Everything
else falls out of what the product already says.

---

## The six decisions, in priority order

Ordered by what blocks what. D-1 decides how much of the input space the other
five have to cover, so it comes first.

---

# D-1 · The minimum viable programme boundary, and a foundation architecture beneath it

**Resolves** D5 (week one up to 32× stated volume), D8 (smallest week is 8 km),
and removes 1–22 km/week from the scope of every other decision.

### Current behaviour
A race-block architecture is forced down to 1 km/week. It cannot go there: the
easy floor is 3 km, quality structures cannot be built below 4.3 km, and the
weekly cap will not trim an easy day below 3, a long run below 70%, or a quality
day at all. So the engine emits the smallest week it can assemble — 8 km on
three days, ~20 km on six — and calls it the athlete's plan. A 1 km/week 5K
athlete gets 17.5 km in week one, 66% of it quality, with a 0 km long run.

### Proposed rule
> **A race programme has a minimum viable starting volume. Below it, Valhalla
> does not build a smaller race programme — it builds a different thing.**
>
> Four states, chosen by comparing the athlete's stated volume against the
> minimum viable start for their distance, day count and time available:
>
> | State | When |
> |---|---|
> | **FOUNDATION** | below the threshold of continuous running; walk/run, time-based |
> | **ON-RAMP** | continuous running, but below the minimum viable race start |
> | **RACE PROGRAMME** | at or above the minimum viable start |
> | **HIGH-VOLUME ADAPTATION** | above what the day count can distribute (see D-5) |
>
> **The race goal is retained in every state.** Foundation and on-ramp are
> routes to the athlete's chosen race, not a substitute for it: the goal
> distance, the goal time and the event date stay on the plan, and every screen
> says which stage of the route the athlete is on and what it is building
> toward.

### The boundary is derived, not chosen

Two independent constraints bind, and the minimum is the larger of them.

**(a) The week must be assemblable.** With `EASY_MIN_KM = 3` *(existing)*, the
measured quality-structure floor *(derived: 4.3 km absolute, 5.4–5.8 km typical
— the smallest session the existing pools can build once warm-up, work,
recoveries and cool-down are counted)*, and `LONG_FRACTION` *(existing)*:

```
W ≥ (3 × easyDays + qFloor × qualitySlots) / (1 − LONG_FRACTION)
```

**(b) The long run must be the longest run of the week**, and must be large
enough that its own goal-pace segment fits under its own ceiling (D-2):

```
W ≥ qFloor / LONG_FRACTION        and        W ≥ 6 / LONG_FRACTION
```

| | 3 days | 4 days | 5 days | 6 days |
|---|---|---|---|---|
| **5K / 10K** (f = 0.24) | 25 | 25 | 25 | 27 |
| **Half** (f = 0.28) | 22 | 22 | 24 | 29 |
| **Marathon** (f = 0.32) | 19 | 19 | 26 | 30 |
| **Ultra 50K** (f = 0.36) | 17 | 19 | 28 | 33 |

These sit within 1–3 km of the volumes at which the audit *empirically*
observed hard findings stop (half/5 days: derived 24, measured 23). That
agreement is the check that the derivation describes the real engine.

**(c) And a third constraint, which is the one that makes this a coaching rule
rather than an arithmetic one: the long run must be able to reach the peak the
distance needs, in the weeks available.** At the standard +10%/week on
developing weeks, over the developing weeks a block of length N actually has:

| Minimum **start** long run (km) | N=4 | N=8 | N=12 | N=16 | N=20 | N=24 |
|---|---|---|---|---|---|---|
| 5K (cap 12) | 12.0 | 9.0 | 6.8 | 5.1 | 3.8 | 2.9 |
| 10K (cap 15) | 15.0 | 11.3 | 8.5 | 6.4 | 4.8 | 3.6 |
| Half (cap 20) | 20.0 | 15.0 | 11.3 | 8.5 | 6.4 | 4.8 |
| Marathon (cap 32) | 32.0 | 24.0 | 18.1 | 13.6 | 10.2 | 7.7 |
| Ultra (cap 36) | 36.0 | 27.0 | 20.3 | 15.3 | 11.5 | 8.6 |

| Implied minimum **stated volume** | N=4 | N=8 | N=12 | N=16 | N=20 | N=24 |
|---|---|---|---|---|---|---|
| 5K | 50 | 38 | 28 | 21 | 16 | 12 |
| 10K | 63 | 47 | 35 | 27 | 20 | 15 |
| Half | 71 | 54 | 40 | 30 | 23 | 17 |
| Marathon | 100 | 75 | 56 | 42 | 32 | 24 |
| Ultra | 100 | 75 | 56 | 42 | 32 | 24 |

**`MIN_VIABLE_START(distance, days, weeks) = max(a, b, c)`.**

This is the single most important consequence in the document: **the minimum
viable volume is not a constant. It is a function of how much time the athlete
has left.** A 24-week marathon build is viable from 24 km/week; the same build
compressed to 12 weeks needs 56; at 4 weeks it needs 100, which is another way
of saying a four-week marathon block is a taper, not a build.

### Alternatives considered
1. **Refuse the input below a threshold.** Honest, and wrong: an athlete at
   5 km/week who wants to run a half in a year is exactly who the product
   should serve. Rejected.
2. **Serve a shrunken race programme (today's behaviour).** Rejected by the
   audit evidence.
3. **Duration-based prescription throughout, at every volume.** Coherent, and a
   much larger change: it would replace the distance-based architecture the
   whole product is built on. Recommended *only inside FOUNDATION*, where
   distance genuinely cannot express the prescription.
4. **A single global minimum (e.g. 25 km/week for everyone).** Simple, and it
   throws away the time-available relationship in table (c) — it would refuse a
   24-week half build to a 17 km/week athlete for whom it is entirely viable.
   Rejected.

### Rationale
Capacity provides permission, not obligation — and the inverse is the failure
here: the engine has no way to prescribe *less* than its own floors, so it
prescribes more than the athlete can absorb and calls it their plan. A separate
architecture below the boundary is the only way for the small end to be
expressible at all.

### Mathematical consequence
The race-block generator's input domain becomes `volume ≥ MIN_VIABLE_START`.
D5 and D8 cannot occur inside it. Every case in the audit's 1–22 km/week band
moves to a different generator whose floors are its own.

### Impact by distance
Sharpest at marathon and ultra, where the long run must reach 32–36 km: a
12-week marathon build needs 56 km/week and a marathon athlete stating
30 km/week with 12 weeks left is genuinely not ready, whatever we print.
Mildest at 5K, where 25 km/week and 16 weeks is enough.

### Impact by days per week
Fewer days *lowers* constraint (a) — fewer easy floors to fund — and raises the
practical ceiling problem (D-5). Three and four days are viable at lower volume
than five or six, which is the opposite of the intuition and is worth stating
in the UI.

### At the boundary
At exactly `MIN_VIABLE_START` the plan is a race programme with the long run at
its floor. One kilometre below, it is an on-ramp with the same goal and the
same event date. The audit's continuity finding matters here: the transition
must be a **named gate**, announced to the athlete, not a silent change of
shape.

### New constants required
- `MIN_QUALITY_SESSION_KM = 4.3` — *derived*, measured floor of the existing pools.
- `LONG_RUN_SAFE_GROWTH = 1.10/week` — *proposed* **(new #1)**. The standard
  long-run progression guideline. Alternatives: 1.05 (very conservative,
  pushes the 12-week marathon minimum to 78 km/week), 1.15 (aggressive,
  contradicts the product's own existing progression caution).

---

# D-2 · Minimum viable long run, and when the goal-pace finish exists at all

**Resolves** D1 (floor beats ceiling), D4 (0 km long run), and the
coaching-suspicious "3 km long run" and "goal segment over half the run".

### Current behaviour
```js
goalSegKm = round1(clamp(longTarget*(0.2+0.18*pos), 3, longTarget*0.5))
clamp(n,lo,hi) = Math.max(lo, Math.min(hi, n))
```
The code states a floor of 3 km and a ceiling of half the run. Below a 6 km long
run those two bounds contradict each other, and the floor wins — producing a
segment larger than the session containing it. Separately,
`roundWorkoutKm('long', km)` rounds to the nearest whole kilometre, so a 0.4 km
long run becomes 0.

### Proposed rule
> **1. A long run has an absolute floor of 6 km.** Below that the session is not
> a long run and must not be labelled one.
>
> **2. The goal-pace finish is omitted entirely below that floor** — not shrunk.
> Above it, the existing ceiling binds properly: `min(0.2 + 0.18·pos, 0.5) × L`,
> never less than 3 km, and the segment simply does not exist where those two
> cannot both hold.
>
> **3. A long run never rounds to zero.** Rounding is a presentation of a
> distance, never a decision about whether a session exists.

**The 6 km is *derived*, not chosen.** It is the exact value at which the two
bounds the product has already written down stop contradicting each other:
`3 ≤ L × 0.5` ⟺ `L ≥ 6`. Adopting it changes no existing intent; it makes the
existing intent achievable.

### Alternatives considered
1. **Make the ceiling win and shrink the segment** (1.5 km on a 3 km run).
   Removes the negative arithmetic and keeps a session with no aerobic lead-in.
   Rejected — a goal-pace segment with no lead-in is a different session, not a
   smaller one.
2. **Scale the floor with the long run** (`min(3, L×0.5)`). Same objection, and
   it produces a 0.5 km "goal-pace finish" that is a stride, not a stimulus.
3. **Distance-specific long-run floors** (6 km for 5K, 10 km for marathon).
   More correct in principle, and made redundant by D-1: once the minimum
   viable start is enforced, marathon long runs start at 18 km anyway. Keeping
   one universal floor as a *backstop* is simpler and cannot conflict.

### Rationale
The goal-pace finish exists to rehearse race rhythm on tired legs. A 3 km
segment at the end of a 3 km run rehearses nothing — there are no tired legs —
and asks a 12 km/week athlete to run their entire long run faster than their
own threshold pace. Omission is the coaching answer; shrinking is the
arithmetic one.

### Mathematical consequence
`goalSegKm ≤ 0.5 × L` becomes a true invariant. `easy = L − goalSeg ≥ 0.5 × L`
follows, so the easy component can never be zero or negative from this path.
D1 and D4 are eliminated by construction.

### Impact by distance
Half and marathon only — 5K, 10K and ultra do not carry a goal-pace finish
(`hasGoalSegment` requires `threshold` or `endurance` emphasis). Under D-1 the
minimum half long run is 6.7 km and the minimum marathon long run 8.2 km, so
the omission branch will rarely fire in a race programme; it is the guarantee
that matters, not the frequency.

### Impact by days per week
None directly. Indirectly, fewer days means a larger long run for the same
weekly volume, so the omission branch fires less often.

### At the boundary
At exactly 6 km the segment is 3 km — half the run, at its floor and at its
ceiling simultaneously. That is the correct degenerate case and it is now
reachable rather than contradictory.

### New constants required
- `MIN_LONG_RUN_KM = 6` — *derived* from two existing constants.
- `GOAL_FINISH_MIN_LONG_KM = 6` — *derived*, the same value; kept as its own
  name so a future change to one does not silently move the other.

---

# D-3 · The universal parent/child invariant

**Resolves** D2 (`finishKm` does not follow its run), D3 (subtraction after
rounding), and prevents the whole class.

### Current behaviour
`buildDaysFromWeeks` ends with a settle-up pass that pushes the final `dd.km`
back into `params[dayKmParam]`. It handles **one** parameter. `finishKm` is
derived from the same run, is not in the pass, and keeps a value computed before
`roundWorkoutKm` and `capWeeklyVolume` had their say. `segmentsFor` then
computes `round1(km − finishKm)` with no floor. Minimum observed component:
**−2 km**.

### Proposed rule
> **No component may make its parent impossible.** Concretely, four clauses:
>
> 1. **A floor may never exceed its own ceiling.** Where a component is bounded
>    both ways and the bounds cross, the component is **omitted**, not clamped
>    to either bound. (Clamping to the floor is D1; clamping to the ceiling is
>    D-2 alternative 1. Omission is the only answer that does not invent a
>    session.)
> 2. **Children are derived from the settled parent, never from an earlier
>    value.** Every quantity that is a function of the day's distance is
>    recomputed after rounding and after the weekly cap — not carried forward.
> 3. **Subtraction never produces a component.** The easy portion of a
>    structured run is `parent × (1 − fraction)`, computed from the fraction;
>    it is not `parent − fixedChild`.
> 4. **Rounding is applied to the parent first, then children are derived from
>    the rounded parent.** Never the reverse. Where children must round too,
>    the last child absorbs the residue so the set always reconciles.
>
> **Enforced, not assumed:** the reconciliation already asserted for fully
> quantified sessions in `test/planMathematicsInvariants.test.js` becomes a
> generator-side assertion, so a future archetype cannot opt out by omission.

### Alternatives considered
1. **Floor the easy component at zero.** Removes the negative number and keeps
   the 0 km component. This is the display patch the audit brief rules out.
2. **Add `finishKm` to the settle-up list.** Fixes today's instance and not the
   class — the next archetype with two dependent parameters reintroduces it.
   The audit found the same bug shape in two independent places already.
3. **Make all components fractions of the parent.** Clause 3 above, generalised.
   Correct, and a larger refactor than this gate needs to authorise; clause 3
   applies it where a subtraction exists today.

### Rationale
This is not a coaching rule; it is the arithmetic contract that lets coaching
rules mean what they say. D-2 is only *true* if D-3 holds — otherwise the
weekly cap silently reintroduces the same defect after D-2 has computed a
correct segment, which is exactly what the audit demonstrated at 18 km/week.

### Mathematical consequence
`Σ components = parent`, exactly, for every fully quantified session, at every
input. The invariant is already measurable — the audit asserts it flat at zero
today for the sessions that reconcile.

### Impact by distance / by days
Universal. No distance or schedule is exempt.

### At the boundary
The interesting case is clause 1: when bounds cross, something is omitted, and
the day must remain a coherent session without it. D-4 defines what happens
next.

### New constants required
**None.** This decision introduces no numbers.

---

# D-4 · What happens when a session will not fit

**Resolves** the coaching-suspicious "low-volume athlete given a chopped-down
advanced workout", and gives D-2 clause 1 and D-3 clause 1 somewhere to land.

### Current behaviour
`shrinkIntervalSpec` / `shrinkTempoSpec` reduce a structure's dimensions until
they hit a floor, and then stop. There is no substitution and no omission. The
result is the audit's most quoted finding: at 5 and 10 km/week a sixteen-week
block is *identical*, every structure pinned at its floor.

### Proposed rule
> **A four-rung ladder, taken strictly in order. The first rung that yields a
> coherent session wins.**
>
> | Rung | Action | When it applies |
> |---|---|---|
> | **1 · Reduce** | shrink the structure's volume dimensions, as today | the shrunk session is still above its own floor |
> | **2 · Substitute** | replace with the simplest structure of the same *stimulus* that does fit — a continuous tempo instead of a split tempo, strides instead of track reps | rung 1 would land on a floor |
> | **3 · Omit quality** | the day becomes an easy run and the week says so | no structure of that stimulus fits |
> | **4 · Remain in foundation** | the week is not a race week; D-1 applies | rung 3 would leave the week with no quality at all |
>
> **A session is never delivered at its floor two weeks running.** If rung 1
> lands on the same floor it landed on last exposure, rung 2 is taken instead.
> That single clause is what stops a floor from masquerading as progression
> (D-6).

### Alternatives considered
1. **Keep shrinking below the floors.** Produces sub-minimal stimuli — 1×400 m
   is not an interval session. Rejected.
2. **Always substitute, never shrink.** Loses the fine-grained progression that
   works correctly at normal volumes. Rejected.
3. **Omit immediately when the structure does not fit.** Simple, and throws
   away rung 2, which is where most low-volume weeks should land — an athlete
   at 26 km/week should get a *simpler* quality session, not none.

### Rationale
The distinction the audit named: *if the athlete does not yet have the capacity
to perform the normal session, prescribe the appropriate developmental session
— not a mathematically mutilated version of a higher-volume workout.* The
ladder is that sentence made operational.

### Mathematical consequence
Removes the "identical block" degenerate case. Introduces a requirement the
current pools do not meet: **each stimulus needs at least one genuinely small
structure** to substitute *to*. That is a content gap, not a code gap, and it
is flagged as a dependency below.

### Impact by distance
Speed emphasis (5K/10K) has the smallest structures already (4.3 km floor) and
needs the least new content. Endurance and time-on-feet need the most.

### Impact by days per week
Three- and four-day weeks carry one quality slot, so rung 3 removes the week's
only quality session and rung 4 fires sooner. Five and six days degrade more
gracefully.

### At the boundary
Rung 3 → rung 4 is the same gate as D-1's ON-RAMP → RACE PROGRAMME boundary,
approached from the other side. They must be the same threshold or a plan can
oscillate between them week to week.

### New constants required
- `QUALITY_FLOOR_REPEAT_LIMIT = 1` — *proposed* **(new #2)**: a structure may be
  delivered at its floor once before substitution is forced. Alternatives: 0
  (never allow a floor — too strict, a taper legitimately floors a session),
  2 (permits three identical weeks, which is the reported symptom).

---

# D-5 · The high-volume pathway

**Resolves** D7 (531 km silently undistributed in one 12-week block).

### Current behaviour
`profile.longCapKm` caps the long run and `EASY_MAX_FRACTION_OF_LONG = 1.0`
caps every easy day at the long run's length. Above a certain volume the week
cannot absorb the target. The engine writes a `planBuildNotes` entry — on 11 of
12 weeks in the worst measured case — and tells the athlete nothing, by explicit
design: *"the answer is always run more days, which is their decision, not the
app's."*

**That design decision is defensible. Its silence at this magnitude is not.**
A 10K athlete stating 80 km/week on three days is prescribed 38 km/week, flat,
for nine weeks, with the long run pinned at its cap the entire time.

### What the architecture can actually distribute

`long ≤ longCapKm`, each easy `≤ long`, plus the quality sessions:

| Max distributable km/week | 3 days | 4 days | 5 days | 6 days |
|---|---|---|---|---|
| **5K** (cap 12) | 43 | 55 | 74 | 86 |
| **10K** (cap 15) | 49 | 64 | 83 | 98 |
| **Half** (cap 20) | 56 | 76 | 92 | 112 |
| **Marathon** (cap 32) | 81 | 113 | 131 | 163 |
| **Ultra** (cap 36) | 87 | 123 | 138 | 174 |

These are *peak-week* figures. Stated volume ramps to peak by `volMult`, so the
supported **stated** volume is that figure divided by 1.30–2.00.

### Proposed rule
> **Distribute what the architecture supports, cap the rest, and say so — with
> the specific remedy, at the moment the athlete can act on it.**
>
> 1. **At build time**, if the target cannot be distributed, the builder tells
>    the athlete before the plan is generated: *"At 80 km/week over 3 days,
>    each run averages 27 km. Valhalla can prescribe about 49 km/week on three
>    days. Add a day to train at the volume you've entered."* — with the day
>    count still editable on the same screen.
> 2. **If they proceed anyway**, the plan is generated at the distributable
>    volume, the shortfall is stated on the plan, and the plan does not pretend
>    the target was met.
> 3. **The shortfall goes to easy volume first**, up to the point where an easy
>    day equals the long run — which is where it goes today. What changes is
>    that the remainder is *reported* rather than discarded.
> 4. **`PROFILE_CEILING_KM` remains a backstop, not a target** — unchanged.
>
> **Nothing about the caps changes.** `longCapKm` is a coaching limit on a
> single session and raising it to absorb volume would be exactly the "global
> backstops become targets" failure the product already guards against.

### Alternatives considered
1. **Raise `longCapKm` at high volume.** Turns a safety limit into a
   distribution mechanism. Rejected on the product's own stated principle.
2. **Silently cap (today).** Rejected — 531 km is not a rounding error.
3. **Refuse to build.** Too blunt: a 60 km/week athlete on four days is only
   slightly over and the plan is nearly right.
4. **Add running days automatically.** Changes the athlete's stated
   availability without asking. Rejected.
5. **Allow doubles (two runs in a day).** A real coaching answer at 90+ km/week
   and a whole new architecture. Recommended as a **later** decision, not this
   one.

### Rationale
The existing reasoning — that "run more days" is the athlete's decision — is
right, and the conclusion drawn from it was wrong. That it is their decision is
the reason to *tell* them, not the reason to stay quiet.

### Mathematical consequence
`week_undershoots_target` becomes either impossible (the target was adjusted
with consent) or *declared* (the athlete chose to proceed). The 190,331
instances in the audit collapse to zero silent ones.

### Impact by distance
Worst at 5K and 10K, where `longCapKm` is 12–15 km — a 5K athlete on three days
is capped at 43 km/week peak. Marathon and ultra have far more headroom.

### Impact by days per week
This is the axis. Three days is the constrained case at every distance; six days
supports 86–174 km/week and rarely binds.

### At the boundary
Just under the limit, nothing is said. Just over, the builder speaks. The
message must quote the athlete's own numbers, not a policy.

### New constants required
- `UNDISTRIBUTED_WARN_KM = 3` — *proposed* **(new #3)**: the per-week shortfall
  at which the builder speaks. Below it the difference is rounding.
  Alternatives: 0 (speaks on every plan, becomes noise), 5 (a 60 km block-wide
  shortfall passes silently).

---

# D-6 · Progression floors versus minimum stimulus

**Resolves** the reproduced `Progressive Tempo: 10min` repeated through a
sixteen-week block, and D6 (taper week larger than the week before).

### Current behaviour
`TAPER_MIN_WORK_MIN = 10` and `TAPER_MIN_WORK_KM = 2` are **taper** floors —
they exist so a taper cannot shrink a session to nothing. They are applied by
`shrinkTempoSpec` / `shrinkIntervalSpec`, which are also the functions used to
fit a session into a low-volume week. So a floor written for one week of a taper
became the permanent size of every quality session in a sixteen-week block.
At 5 and 10 km/week the two blocks are byte-identical.

### Proposed rule
> **A floor protects a minimum viable stimulus. It may never be the answer
> twice in a row.**
>
> 1. **Separate the two floors by purpose.** `TAPER_MIN_*` keeps its name and
>    its job — the smallest a session may be shrunk *during a taper*. A new,
>    distinct `STIMULUS_MIN_*` governs fitting a session into a small week.
>    They may hold the same values; they must not be the same rule, because a
>    taper floor is meant to bind and a fitting floor is meant to be a signal
>    that the session does not belong in this week.
> 2. **Hitting the fitting floor is a signal, not a result.** It triggers D-4
>    rung 2 (substitute), and on a second consecutive exposure, rung 3 (omit).
> 3. **A block that cannot progress its quality does not pretend to.** Where
>    every exposure of a stimulus would sit at its floor for the whole block,
>    the block is not a race build at that volume — D-1 applies, and the
>    correct prescription is an on-ramp whose progression is *aerobic volume*,
>    which at that volume is the adaptation actually available.
> 4. **Taper monotonicity becomes an invariant**: no taper week exceeds the week
>    before it. Where the floors would violate it, the floors yield.

### Alternatives considered
1. **Lower the floors.** Produces sub-minimal stimuli. Rejected.
2. **Add smaller structures to the pools.** Necessary regardless (see D-4's
   dependency) and not sufficient — a smaller floor is still a floor.
3. **Progress quality by intensity rather than volume at low capacity.**
   Physiologically defensible, and it introduces a second progression axis the
   product does not have. Rejected for now; noted as a future option.

### Rationale
The audit's phrasing is exact: *a floor is allowed to protect a minimum viable
stimulus; it must not masquerade as progression.* The engine currently cannot
tell the difference because one function serves both purposes.

### Mathematical consequence
Identical consecutive quality prescriptions inside a build block become
impossible. The `taper_week_increases_volume` count (10,501) goes to zero.

### Impact by distance
Endurance and time-on-feet emphases hit floors soonest because their structures
are largest. Speed is least affected.

### Impact by days per week
Two quality slots (5–6 days) means two independent floor sequences and more
scope for substitution; one slot (3–4 days) means the single quality session
alternates stimulus week to week and floors are more visible.

### At the boundary
The first exposure at a floor is legitimate. The second is the gate.

### New constants required
- `STIMULUS_MIN_KM` / `STIMULUS_MIN_MIN` — *derived*, initially equal to the
  existing `TAPER_MIN_WORK_KM = 2` and `TAPER_MIN_WORK_MIN = 10`. **Renaming,
  not renumbering**: they are separated so they can diverge later under
  evidence, not so they can be changed now.

---

# D-7 · Experience Level — added, because §7 asks for a determination

**Classification: a product-contract defect. Not intentional, not a regression,
and not an unfinished implementation of Experience Level — it is a
correctly-implemented *Guidance Level* wearing the name "Experience Level".**

### The evidence
`assets/builder-spec.js` states it in as many words:
> *"Coaching-depth preference, **not a training input** — same three levels,
> same order, same hint copy the app's EXPERIENCE_META has always held."*

And the three hints are unambiguously about explanation, not capability:
- novice — *"Tell me what to do, how to do it and what it should feel like."*
- experienced — *"Give me the session, targets and the important coaching cues."*
- advanced — *"Keep it concise. Give me the prescription and let me run."*

`buildBlockWeeks`, `buildDaysFromWeeks`, `distributeWeekVolume`,
`pickQualityStructure`, both shrink functions and `volumeCeilingFor` contain no
reference to it. The runtime's own comment says *"presentation only"* and is
accurate about what the code does.

### So the finding is not "Experience is unimplemented". It is:
1. The field the athlete sees labelled **Experience** is in fact **Guidance
   Level**, and it is complete and working.
2. There is **no Experience Level input at all.** Demonstrated capability enters
   the engine only through the current-fitness anchor (benchmark → calibration →
   performance) and stated volume. Training *history* — years running, injury
   history, blocks completed, whether they have raced this distance before —
   is never asked and never read.
3. Because HQ's position is that Experience Level belongs to prescription, this
   is a **gap**, and the audit's observation (a novice and an advanced athlete
   at 10 km/week get identical plans) is a true statement about a missing input,
   not about a broken one.

### Proposed rule
> **Rename, then decide separately.**
>
> 1. **Rename the existing field to Guidance Level** in the builder spec, the
>    UI and the stored key's documentation. Keep `state.experience` as the
>    persisted key — it is in every saved plan and every backup — but stop
>    calling it Experience anywhere an athlete or a developer can read it.
> 2. **Treat Experience Level as a new, unbuilt input**, and do not add it as
>    part of this remediation. It would be a second axis on top of volume,
>    distance, days and time-available, and D-1 through D-6 must land first —
>    otherwise its effects cannot be measured against a coherent baseline.
> 3. **If HQ wants it sooner**, the smallest honest version is a *ceiling*, not
>    a multiplier: a novice's `PEAK_OVER_DEMONSTRATED` and
>    `LONG_RUN_SAFE_GROWTH` are lower than an advanced athlete's. That respects
>    *capacity provides permission, not obligation* — experience would only
>    ever hold the answer down, never walk it up.

### New constants required
**None, under the recommended option.**

---

## The 0 → race-plan pathway

### The model
**Yes — the correct model is the staged one**, not a shrunken race programme:

```
current capacity  →  FOUNDATION  →  ON-RAMP  →  RACE PROGRAMME  →  race
   (0-?? km/wk)     walk/run,      continuous    the existing
                    time-based     running,      distance-specific
                                   volume-led    architecture
```

The goal, the goal time and the event date are carried through every stage
unchanged. What changes is the route, never the destination.

### FOUNDATION — below continuous running
An athlete at 0–5 km/week cannot be prescribed in kilometres: 10% of 2 km is
200 m, and the engine's smallest expressible easy run is 3 km. Foundation is
therefore **time-based and interval-based** (walk/run), which is the standard
and well-evidenced architecture for this athlete and is *not a new methodology*
— it is the established one for a population the product does not currently
serve at all.

Exit criterion: **~30 minutes continuous running, three times a week** ≈
15 km/week. Typical duration from true zero: **8–10 weeks**.

### ON-RAMP — continuous running, below the viable race start
Volume-led, minimal quality (strides and a single controlled steady effort),
one long run growing at the safe rate. Its purpose is to arrive at
`MIN_VIABLE_START` — nothing else.

Progression rule proposed: **`+max(2 km, 10%)` per developing week, every
fourth week held level.** The absolute term exists because percentage growth is
meaningless at low volume; the percentage term takes over above 20 km/week.

**Weeks required, from the derivation:**

| To a 12-week race block, from → | 1 | 3 | 5 | 10 | 15 | 20 | 25 | 30 | 40 |
|---|---|---|---|---|---|---|---|---|---|
| 5K (target 28) | 18 | 17 | 15 | 11 | 9 | 5 | 2 | 0 | 0 |
| 10K (target 35) | 21 | 19 | 18 | 14 | 11 | 7 | 5 | 2 | 0 |
| Half (target 40) | 22 | 21 | 19 | 17 | 13 | 10 | 6 | 5 | 0 |
| Marathon (target 56) | 27 | 26 | 25 | 21 | 18 | 14 | 11 | 9 | 5 |

| To a **24-week** race block, from → | 1 | 3 | 5 | 10 | 15 | 20 | 25 | 30 | 40 |
|---|---|---|---|---|---|---|---|---|---|
| 5K (target 25*) | 7 | 6 | 5 | 1 | 0 | 0 | 0 | 0 | 0 |
| 10K (target 25*) | 9 | 7 | 6 | 3 | 0 | 0 | 0 | 0 | 0 |
| Half (target 22*) | 10 | 9 | 7 | 5 | 1 | 0 | 0 | 0 | 0 |
| Marathon (target 24) | 15 | 14 | 13 | 9 | 6 | 2 | 0 | 0 | 0 |

\* at 24 weeks the assemblability floor binds rather than the long-run one.

### How the event date interacts — the rule that matters most
> **Valhalla computes the route before it builds anything:**
> `weeks required = foundation + on-ramp + MIN_BLOCK_WEEKS`
>
> - **Enough time** → build the staged plan, show the stages and their dates.
> - **Not enough time** → **say so, and say it in the athlete's own numbers.**
>   Then offer, in this order: (a) the same race at a later date; (b) a shorter
>   race distance on the same date, if one is viable from their capacity;
>   (c) a foundation/on-ramp plan with an honest statement that the event is
>   not a target this cycle.
>
> **Valhalla must not fabricate a plan.** A 0 km/week athlete with a marathon in
> 12 weeks is told the truth: from zero, marathon-ready is roughly 39 weeks.

**From true zero, to a race, the honest totals:**

| From 0 km/week to | foundation | on-ramp | block | **total** |
|---|---|---|---|---|
| 5K | ~9 | 9 | 12 | **~30 weeks** |
| 10K | ~9 | 11 | 12 | **~32 weeks** |
| Half | ~9 | 13 | 12 | **~34 weeks** |
| Marathon | ~9 | 18 | 12 | **~39 weeks** |

These are the numbers a coach would give, and they are the numbers Valhalla
should give.

---

## Worked examples — what *should* happen

No plans were generated for this table. It is the classification the proposed
rules produce, for a **12-week** horizon at **5 running days**. Where a longer
horizon changes the answer, that is stated — which is itself the point.

### 5K (min viable start 28 at 12 weeks, 25 at 16+)
| Stated | Classification | Why |
|---|---|---|
| 0 | FOUNDATION | not yet running; ~9 weeks of walk/run before volume means anything |
| 1–5 | FOUNDATION | below continuous running; kilometres cannot express the prescription |
| 10 | ON-RAMP (11 wk) | continuous running; 18 km short of a viable 12-week start |
| 20 | ON-RAMP (5 wk) | close; a 16-week block would start **today** at 20 |
| 30 | **NORMAL** | above the 28 threshold |
| 40 | **NORMAL** | comfortably inside |
| 50 | **NORMAL** | peak 65, under the 74 five-day ceiling |
| 70 | HIGH-VOLUME ADAPTATION | peak 91 exceeds what 5 days can distribute (74) |
| 100 | **UNSUPPORTED — WARN** | saturates the 110 backstop; needs 6 days or doubles |

### 10K (min viable start 35 at 12 weeks, 27 at 16)
| Stated | Classification | Why |
|---|---|---|
| 0–5 | FOUNDATION | as above |
| 10 | ON-RAMP (14 wk) | |
| 20 | ON-RAMP (7 wk) | a 20-week block is viable from today |
| 30 | ON-RAMP (2 wk) | *or* NORMAL at 16 weeks — the horizon decides |
| 40–50 | **NORMAL** | |
| 70 | **NORMAL** | peak 94.5, just over the 83 five-day ceiling → mild adaptation |
| 100 | **UNSUPPORTED — WARN** | |

### Half marathon (min viable start 40 at 12 weeks, 30 at 16, 22 at 24)
| Stated | Classification | Why |
|---|---|---|
| 0–5 | FOUNDATION | a half from zero is ~34 weeks; say so |
| 10 | ON-RAMP (17 wk) | 12 weeks is not enough time — offer a later date |
| 20 | ON-RAMP (10 wk) | **NORMAL** at a 24-week horizon |
| 30 | ON-RAMP (5 wk) | **NORMAL** at 16 weeks |
| 40 | **NORMAL** | exactly at the 12-week threshold; long run starts 11.2 km |
| 50–70 | **NORMAL** | |
| 100 | **UNSUPPORTED — WARN** | peak 155 against a 92 five-day ceiling and a 140 backstop |

### Marathon (min viable start 56 at 12 weeks, 42 at 16, 24 at 24)
| Stated | Classification | Why |
|---|---|---|
| 0–5 | FOUNDATION | ~39 weeks to marathon-ready; this is the honest answer |
| 10 | ON-RAMP (21 wk) | a marathon in 12 weeks from 10 km/week is not a plan |
| 20 | ON-RAMP (14 wk) | **NORMAL** at a 24-week horizon |
| 30 | ON-RAMP (9 wk) | **NORMAL** at 24 weeks |
| 40 | ON-RAMP (5 wk) | **NORMAL** at 16 weeks — long run must reach 32 km |
| 50 | ON-RAMP (2 wk) | **NORMAL** at 16 weeks |
| 70 | **NORMAL** | peak 122.5, under the 131 five-day ceiling |
| 100 | HIGH-VOLUME / WARN | peak 170 saturates the backstop exactly |

**The pattern worth noticing:** almost every ON-RAMP classification above
becomes NORMAL at a longer horizon. The product's answer to a low-volume
athlete is very often *"you have time — take it"*, not *"you are not ready"*.

---

## Established principles — checked, not disturbed

| Principle | Effect of these proposals |
|---|---|
| Training paces follow current fitness, not the goal | **Untouched.** Nothing here reads the goal VDOT. D-2 *strengthens* it by removing the case where an entire long run was prescribed at goal pace to an athlete far below it. |
| Capacity provides permission, not obligation | **Restored.** D-1 is the direct remedy: the engine gains the ability to prescribe less than its own floors. |
| Global backstops are not targets | **Explicitly protected** in D-5, which refuses to raise `longCapKm` to absorb volume. |
| Progression requires justification | **Untouched.** `progressionJustification()`, `demonstratedSustainableVolume()` and the anchor-on-previous-start rule are not read or changed. |
| Recovery is restorative | **Untouched.** `applyRecoveryCeiling()` and the cutback shape are unchanged; D-6 clause 4 protects taper monotonicity, which currently fails. |
| Existing phase methodology | **Untouched.** `phaseForWeek`, `blockArcFor` and the phase pools are unchanged. FOUNDATION and ON-RAMP are new *purposes* alongside race/base/maintain/recovery, using the existing purpose mechanism. |

---

## Summary of new numbers

Four, total. Everything else is derived from existing constants or renamed.

| # | Constant | Value | Basis |
|---|---|---|---|
| 1 | `LONG_RUN_SAFE_GROWTH` | 1.10 / developing week | the standard long-run progression guideline |
| 2 | `QUALITY_FLOOR_REPEAT_LIMIT` | 1 | a floor may be the answer once, not twice |
| 3 | `UNDISTRIBUTED_WARN_KM` | 3 / week | below this the shortfall is rounding |
| 4 | `ONRAMP_STEP` | max(2 km, 10%) / developing week | percentage growth is meaningless below ~20 km/week |

Derived, not new: `MIN_LONG_RUN_KM = 6`, `GOAL_FINISH_MIN_LONG_KM = 6`,
`MIN_QUALITY_SESSION_KM = 4.3`, `STIMULUS_MIN_*` (renamed from `TAPER_MIN_*`),
and the entire `MIN_VIABLE_START(distance, days, weeks)` table.

## Dependencies HQ should know about before approving

1. **D-4 needs content, not code.** Rung 2 (substitute) requires at least one
   genuinely small structure per stimulus. The pools do not have them today —
   the audit already noted a two-candidate pool as a separate methodology
   question. Approving D-4 commits to writing those sessions.
2. **FOUNDATION is a new architecture**, not a variant of the existing one. It
   is time-based and interval-based and shares almost nothing with
   `buildBlockWeeks`. It is the largest single piece of work here.
3. **D-1's boundary is a function of three inputs**, so the builder must know
   the day count and the block length before it can tell the athlete which
   state they are in. Today it asks in a different order. That is a builder
   flow change, and it is why §10's "do not change builder validation" matters
   — the change needed is to the *sequence*, not the validation.

---

## Status of this document

Nothing here is implemented. Verified at the point of writing:

| | |
|---|---|
| Engine, builder spec, API | **no diff** — `git diff HEAD -- protected/ assets/ api/` is empty |
| `test/audit/baseline.json` | **unchanged** — no diff against the audit commit |
| Audit branch | `audit/plan-mathematics-full-range`, **not merged** |
| Builder validation | untouched (`volumeMustExceed: 0`, `weeksRange: [4,24]`, `daysRange: [3,6]`) |
| New constants encoded anywhere | **none** — the four proposed numbers exist only as prose in this file |

If HQ approves these rules, here is the exact implementation programme I recommend.
