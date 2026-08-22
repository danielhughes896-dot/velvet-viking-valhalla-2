# VALHALLA — YEAR-ROUND PROGRAMME HARDENING

**Branch** `audit/programme-and-history` · **NOT MERGED** · held for review.

Valhalla is not a coach. It is a programme that learns how you train. Everything
below is measured against that: whether an athlete could put this on their phone
in January and still be using it, sensibly, three years later.

---

## §1 · VOLUME CEILING — the launch blocker

**Was.** Each block started from the previous block's absorbed volume and
multiplied that start by its distance profile to find a peak. Nothing anywhere
compared either number to the athlete. A marathon athlete starting at 60km/week
reached **86 after one year, 149 after two, 257 after three**.

**Now.** Four quantities are kept apart:

| | |
|---|---|
| **Stated** | what the athlete typed once. An opinion, never updated. |
| **Absorbed** | the median completed week of the current block. |
| **Demonstrated sustainable** | the third-highest completed week across a rolling year. One big week is a week; three is a capacity. |
| **Peak** | the top of one block's ramp. Temporary by definition. |

A block may start no more than **10% above demonstrated capacity** and may peak
no higher than a **ceiling anchored to it**, clamped into `[backstop, backstop ×
1.25]`.

**Why the clamp matters.** A first attempt allowed `demonstrated × 1.05`, which
reads as a small allowance and is in fact a ratchet: peak is capped by the
ceiling, so demonstrated climbs to meet it, so the ceiling rises 5%, so
demonstrated climbs again. The 5K athlete reached 118km/week against a 110
backstop and was still going. *A multiplier applied to a quantity that chases it
is not an allowance, it is a feedback loop.*

**Five-year simulation** of the real cycle (race → recovery → maintain → base →
speed), with the clock advancing alongside the athlete so the rolling window is
exercised rather than bypassed:

```
PERFECTLY COMPLIANT — runs everything prescribed
  dist   start   yr1    yr2    yr3    yr4    yr5   | ceiling
  5k      40    58.9   76.8  100.1    110    110  |     110
  10k     45      67   88.1    110    120    120  |     120
  half    50    80.3  110.2    140    140    140  |     140
  full    60   107.8  166.8    170    170    170  |     170

CAPACITY-LIMITED — own hard ceiling at start x 1.4
  5k      40    58.9   72.8   72.8   72.8   72.8  |     110
  10k     45      67   81.9   85.1   85.1   85.1  |     120
  half    50    80.3  108.5  108.5  108.5  108.5  |     140
  full    60   107.8    147    147    147    147  |     170

CAPACITY-LIMITED — own hard ceiling at the start volume
  5k      40      52     52     52     52     52  |     110
  10k     45    60.8   60.8   60.8   60.8   60.8  |     120
  half    50    77.5   77.5   77.5   77.5   77.5  |     140
  full    60     105    105    105    105    105  |     170
```

Every column is flat from year four. An athlete who cannot grow settles against
their own limit rather than decaying toward zero — which was the other failure
mode, and the more dangerous one.

**19 tests · 5 mutations, all killed.**

---

## §2–§3 · MAINTENANCE HOLDS FITNESS

**Was.** "Maintain & Protect" ran the same progression machinery as a race build.
Every quality structure interpolates its dimensions across progress through the
build, and in a steady block the build was the whole block: **tempo 16 → 25
minutes, interval sessions 7.6 → 12.6km across eight weeks**. A 56–66% increase
in quality load under a heading that promises the opposite, invisible because the
weekly volume never moved.

Every long run in that block also finished **"at Goal Pace"** — for an athlete
who had not entered a race and whose block culminates in nothing. It was the most
repeated session in the programme.

**Now.** A three-week dose cycle that averages the middle of each structure's own
range and returns to where it started. Least-squares slope of quality load across
a maintenance block: **0.04 km/week**. Goal-pace work is gated on the block's
*purpose*; a race block keeps it whether or not there is an entry in a real
event, because that block does end in a goal effort.

**And the other half of the same fix.** An unlisted phase falls through to
`Build` in the Playbook rules, and Build permits controlled increases in quality
volume — so maintenance was the one phase whose whole purpose is not to progress,
holding the rule that says progression is appropriate. The generator no longer
progresses a steady block; the adaptation layer no longer can either.

**17 tests · 6 mutations, all killed.**

---

## §4 · SESSION ROTATION

**Was.** Two consecutive maintenance blocks were **byte-identical, 8 weeks of 8**,
because selection is `weekNum % poolSize` with no memory.

**Now.** A rotation offset counted from the athlete's own **closed** blocks of
the same purpose. Deterministic — the second block differs from the first because
it is the second, not because a coin came up differently — and a rebuild of the
live block does not turn the dial, so re-tailoring a plan leaves every session it
does not touch where it was.

| | within a block | across three blocks |
|---|---|---|
| Maintain | 8/8 distinct | **24/24 distinct** |
| Base | 10/10 distinct | 20/30 |
| Speed | 5–6/6 distinct | 13/18 |

**Residual, reported not hidden.** Base and Speed draw from two-candidate pools,
so blocks 1 and 3 line up. Consecutive blocks always differ, which is the case
that matters; widening those pools would change what a base block prescribes and
is a methodology decision for you, not a quiet edit.

---

## §5–§6 · BLOCK SHAPE

The generator knew one arc — ramp, peak, taper, goal effort — and every purpose
was poured into it.

**Aerobic Base was a ten-week block containing one base week.** Week 1 Base, 2–6
Build, 7 Peak, 8–9 Taper, week 10 a maximal goal effort, plus a second maximal
time trial at week 6. A block named for aerobic development spent ninety per cent
of itself doing something else and tapered for a race that did not exist.

**Speed & Threshold was three development weeks and three winding down.**

**Recovery was generated non-steady**, so it inherited the ramp: week one came
out at the start volume × the distance profile's *race* multiplier. A recovery
block that climbs.

**Now:**

```
AEROBIC BASE (10wk)   7 Base + 3 Build · no taper · no goal effort · no time
                      trial · ends on a consolidation week
SPEED (6wk)           4 development + 1 consolidation (−25% not −50%) + benchmark
RECOVERY (2wk)        flat, underneath the intensity ceiling already there
RACE GOAL (12wk)      unchanged, byte for byte
MAINTAIN (8wk)        one phase, no arc
```

`phaseForWeek` stays the single definition of what week N is — it takes the
purpose instead of a boolean, the boolean still means maintain, and a block built
with no purpose at all is the race block byte for byte.

> **METHODOLOGY CHANGES, DECLARED.** Base loses its taper, its goal effort and
> its mid-block time trial, and ramps on 1.25 rather than the race-distance
> multiplier (1.55 on half). Speed trades a taper week for a development week.
> Recovery stops ramping. These are authorised under §5/§6 but they are decisions
> about training, and they are yours to confirm.

**18 tests · 6 mutations, all killed.**

---

## §7 · THE WEEK THE ATHLETE IS STANDING IN

**Was.** Documented as a known limit rather than fixed. Preserving elapsed days
truthfully means the remainder of the current week is re-tailored around a past
the generator no longer controls; where a schedule change moved quality onto a
later weekday, the calendar week held the elapsed quality session **and** its
replacement — three hard sessions against a cap of two.

**Now.** The surplus comes out of the future half of the week, taken from the end
backwards, and a demoted day becomes easy running of the same distance rather
than a hole. The cap itself is not restated: the freshly generated days contain
the generator's own uncorrected version of the same week, so counting its quality
days asks the generator what it intended.

**The remaining limit, and it is the honest one:** a week already over its cap
because of sessions the athlete has *run* is left alone. There is nothing to
change there that would not be a lie. Historical preservation was not traded away
to satisfy the cap.

**3 tests · 2 mutations, all killed.**

---

## §8–§9 · ESCALATION

**Was.** Valhalla said the same thing to an athlete who had missed one session
and one who had missed seven: *"A threshold session went unlogged on Wednesday
and it is still worth having this week."* Poor execution escalated exactly once
and then went flat.

**Now, three tiers, and the difference between them is what Valhalla does:**

| tier | trigger | what it says |
|---|---|---|
| **Isolated** | ≤1 miss, or ≥80% completion | *"One session of the last 12 went unrun. The block still works."* Nothing changes. |
| **Emerging** | 60–80% completion | *"3 of the last 12 sessions went unrun. That reads as a pattern rather than a bad week — the block can be re-tailored around the days you actually have."* |
| **Persistent** | <60% completion | *"You have run 5 of the last 12 prescribed sessions. A plan that does not fit the weeks you are having is not worth carrying…"* |

**Measured in sessions, never in days** — the mechanism that keeps the brief's
rule rather than merely intending it. The window is the last **12 planned
sessions**; below **6** there is no tier at all. Rest days do not count, so a
three-day-a-week athlete does not escalate twice as fast as a six-day one for
identical behaviour. An accepted adjustment is not a missed session.

One sentence reaches the athlete, not two: missing sessions outranks running them
badly. No exclamation marks, no blame vocabulary, no streaks, no encouragement
theatre — asserted by test, not by intention. Nothing is stored; nothing is
counted over time; no analytics system was built.

**20 tests · 6 mutations, all killed.**

---

## §10 · SUCCESS LANGUAGE — re-run on a valid fixture

**The audit's original run was invalid** and this is the finding. It logged every
session at one hand-picked pace, and 4:45/km is a good easy run, a mediocre
threshold and a hopeless 8×1200m. Every quality session scored below the poor bar,
so the run measured the fixture rather than the app.

**A second, larger fixture defect was found underneath it.** `buildPlan` set the
goal to 95% of the 10K benchmark whatever distance the plan was, and
`getActiveVDOT` rates the active goal against the plan's distance — so a
half-marathon fixture asked the app to rate a **42:45 half**. It obliged: VDOT
121.7 against roughly 85 for a world-record holder, and every pace zone came out
at half a real one, threshold at **2:03/km**. Structural tests were unaffected;
nothing about pace, execution score or target ranges could be trusted, and the
screenshots showed the impossible numbers. The fixture athlete is now a coherent
46.9 VDOT — 10K 43:39, half 1:36:45, easy 4:59–5:56/km. **All tests still pass,
which is the evidence that no assertion was leaning on the impossible athlete.**

**Re-run on the corrected fixture:** an athlete executing every session at the
middle of its own window scores 100 across the board, `missPattern` and
`executionPattern` both return null, and Next Move gives ordinary session advice.

> **AMBER — SUCCESS LANGUAGE DOES NOT ESCALATE, BECAUSE IT DOES NOT EXIST.**
> A perfectly executing athlete is told *"Keep this genuinely easy — it is what
> lets the quality sessions land"*, indefinitely. There is no positive
> counterpart to the three-tier negative escalation. Adding coach praise is a
> product and voice decision, not a defect fix, so it is reported rather than
> invented. One genuine defect on that path *was* fixed: `"The block is PLATEAU"`
> printed the internal enum into a sentence the athlete reads.

---

## §11–§14 · COACHING LANGUAGE

A fortnight of one athlete's cards, counted:

```
x39  "Keep Aug 22's Easy Aerobic genuinely easy."      on 39 of 45 cards
x30  "Nothing in recent sessions points strongly       on 30 of 40 reviews
      either way."
x14  "Quality work delivered close to the              on 14 of 40 reviews
      prescription."
```

Three defects wearing one symptom.

**§13 — a bug.** `coachSessionAfter` filtered on `!completed`, and for anything
in the past that is *today's* next session. The review of a run from six weeks ago
ended by pointing six weeks forward, and all 39 cards were pointed at the same
day. By date, each card names its own successor.

**§12 — a true sentence said until it stops being read.** Commentary is now
printed the first time and suppressed for the next three cards that could have
carried it. Only commentary: the verdict on the session and the instruction for
the next one are the card's job, and **anything safety-critical is exempt at any
cadence** — a coach who stops mentioning pain because they mentioned it on
Tuesday is not being concise.

> A first implementation of this deleted the line rather than thinning it, and a
> second cost **24 seconds per Full Plan render** because its lookback called six
> whole-plan aggregates for forty prior days per card. The shipped version is a
> run length: one stored field read per day.

**§11 — a form letter where the evidence was already in hand.** A well-executed
quality session is now described by what actually held — the distance, and
whichever of pace, heart rate and effort landed inside its window. Every clause
is gated on that component having been logged; a heart rate the athlete has
disowned stays unsaid.

**§14 — eight identical long runs.** Outside a race block every long run was
byte-identical. Three emphases now rotate on the same deterministic dial: steady,
even-or-better, rolling. **Same distance, same zone, same structured
prescription, same single easy segment** — only the instruction moves, because a
long run whose intensity rotated would be a methodology change and this is not
one. The screenshots caught a follow-on: the archetype's guidance said *"the last
third should be no slower than the first"* under a rolling long run, which is
good advice on flat ground and bad advice on hills. Each shape may now override
individual lines of its own guidance.

**Result — worst single coaching sentence across a fortnight: 75% of cards → 20%.**
Distinct debrief paragraphs 53 → 68.

**21 tests · 5 mutations, all killed.**

---

## §15 · LEARNING WITHOUT HEALTH-DATA CONSENT

Health-data consent is optional and must stay optional, which is a **design
constraint on every learning mechanism** rather than a preference: if the volume
ceiling or the escalation tiers needed heart rate, declining would silently
degrade the athlete's training — the coercion the consent design exists to
prevent.

Proved behaviourally by withholding heart rate and effort entirely:

- identical demonstrated capacity and identical ceiling
- a **byte-identical** next block
- identical missed-session tier
- a real poor-execution tier from **distance and pace alone**
- nothing quotes a heart rate the athlete never gave
- **no trend turns negative because a component is absent**

**What a declining athlete genuinely does not get is named rather than papered
over:** no heart-rate targets, no heart-rate baseline, and no substitute
manufactured for either.

> **The non-covered-inference question, answered.** It is methodologically clean
> *for these mechanisms* because they never needed covered data — not because a
> proxy was found. Deeper physiological inference (drift, heart rate at pace, the
> response and recovery models) does need it and stays gated behind consent on
> `feat/health-data-consent`. **This is not an argument for relaxing that gate.**

**8 tests.**

---

## §16 · TRANSITIONS

Re-tested against the four new arcs, because a shape change is exactly what can
quietly reopen a settled question about what carries over. The whole cycle walked
in the order an athlete lives it: every purpose entered from a finished race
block, **zero days carried**, every completed session archived, no block opening
before the week the athlete is in, the recovery intensity ceiling intact, the
volume ceiling holding across a full cycle, one ledger row per transition, and a
second maintenance block that is not the first one again.

**9 tests.**

---

## §17–§19 · GENERATED EVIDENCE

`tools/shots/programme-report.js` runs the real engine — it does not read it —
and is deterministic, which is what makes the numbers evidence. Full output
accompanies this report. Two figures worth pulling out:

- **Aerobic Base quality load, first third → last third: +49%.** A base block is
  a development block and is meant to progress, but this is the same shape §2
  removed from Maintain and it is worth your eye. Not changed here: §5 authorised
  the block's *shape*, not its progression rate.
- **Speed & Threshold, first third → last third: −43%.** An artefact of the
  metric on a 6-week block whose last two weeks are the consolidation and the
  benchmark, not a defect.

---

## §20 · VISUAL EVIDENCE

**94 frames** captured from the real runtime through Chromium — every view of
every programme purpose at 390px in both themes, plus a 360/430px sweep on the
surfaces where layout differs, the builder with each of the four purposes
selected, and the entry screen.

Measured, not eyeballed:

- **horizontal overflow: 0 frames of 94**
- **theme applied correctly: 94 of 94** (47 light, 47 dark)
- **uncaught page errors: 0.** The only console entry is one
  `ERR_CONNECTION_RESET` per frame — the sandbox blocking the service worker's
  outbound fetch, identical on all 94.

Against your checklist:

| | |
|---|---|
| Gold = commercial/brand | ✅ crest, wordmark, active-nav, session-type accents |
| Purple = in-app interaction/progression | ✅ Build My Plan, structured-workout step badges, progress bar |
| Session-type colours intact | ✅ green easy, orange interval/tempo, blue long run, gold today |
| No accidental colour drift between equivalent controls | ✅ |
| Typography/layout unchanged | ✅ no changes were made to either |
| No overflow, clipping or broken cards | ✅ measured above |
| No stale race/goal language in non-race programmes | ✅ Maintain, Base and Recovery carry no goal-pace session and no goal-effort day |

> **Two honest limits on this evidence.** (1) The bottom navigation is
> `position: fixed`, so in a full-page screenshot it paints once at its viewport
> position and appears to overlay content further down the image. That is a
> capture artefact, not a layout defect — the app scrolls correctly. (2) These
> are Chromium renders at device-scale 2, not a physical Pixel. Fonts, safe-area
> insets and the Android status bar are not proven here.

---

## §21–§22 · REGRESSION AND MUTATION

- **Full suite: PASS.** (count in the closing block below)
- **Mutation pass: 87 cases, 87 killed.**

Two survived the first run and both were **real gaps in my own tests**, which is
what a mutation pass is for:

1. *"the maintenance dose cycle acquires a trend"* — reordering the cycle to
   0.35/0.5/0.65 keeps the same average and the same members, so every assertion
   passed. It is a different block: three progressively harder weeks then a reset
   is a mini-build repeated forever. Now tested as a property, not a literal.
2. *"safety-critical language is suppressed like anything else"* — the test asked
   the question of an athlete whose previous cards had never carried the sentence,
   so the run length was zero and the answer was "not suppressed" whether the
   exemption existed or not. It proved nothing. The prior reviews now carry it,
   plus a control showing an ordinary sentence in the same state *is* suppressed.

The mutation runner also learned per-case suites: the programme suites build and
log whole plans and are minutes each, and a mutation is only ever killed by the
suite written for it.

---

## §23 · VERDICT

### AMBER

Every one of the twenty-three items was implemented or answered, the launch
blocker is closed with a five-year proof rather than an argument, and the two
worst behaviours an athlete would actually have met — a plan that compounds to
257km/week and a coach that says the same sentence forty times — are gone and
guarded.

It is not GREEN, and not because the tests are thin. Three things stand between
here and green, and none of them is mine to decide:

1. **Six methodology changes are declared, not approved.** Base loses its taper,
   goal effort, time trial and race-distance multiplier; Speed trades a taper week
   for a development week; Recovery stops ramping. Every one is defensible and
   every one changes what an athlete runs.
2. **Valhalla still cannot tell an athlete they are going well.** Sustained
   correct execution produces no positive language at all, which is a strange
   silence in a product whose promise is that it learns how you train.
3. **The visual evidence is Chromium, not a phone.** No physical-device pass has
   been run against this branch.

Two residuals are measured and named rather than swept up: base/speed cross-block
rotation lines up on the third block, and Full Plan takes ~6.8 seconds to render
in the test VM — a pre-existing figure, now guarded against getting worse.

**Would an athlete use this continuously for years?** On the evidence here: yes.
The volume converges, the blocks differ from each other, maintenance maintains,
the coach stops repeating itself, elapsed training is immutable, and declining to
share health data costs them nothing structural. What they would still notice is
that it never tells them they are doing well.

**DO NOT MERGE — held for your review.**
