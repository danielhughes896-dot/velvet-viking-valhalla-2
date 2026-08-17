# Execution Strategy: the four things HQ said back

The Execution Strategy prototype lives on `claude/execution-strategy` at
`d56ef02`. It is not merged, not deployed, not visible to the private beta, and
`EXECUTION_STRATEGY_ENABLED` is `false`.

HQ returned four points on it. This document records them so they survive the
branch, and states what each one changes. It is a record, not a workstream —
nothing here was implemented, and the Execution Strategy branch was not reopened
to write it.

---

## 1. Segment-level learning is not available yet

**HQ:** segment-level learning is not yet available; do not fabricate segment
behaviour from whole-session average pace and heart rate.

**Confirmed, and the repository is the reason.** `dd.actual.splits` exists in the
day contract and **nothing ever populates it.** `coachSplitMetrics()` therefore
returns `null` on every session that has ever been logged, in every plan, for
every athlete. There is no lap data, no per-kilometre trace, no split array —
only a whole-session distance, duration, average pace and average heart rate.

This is why the Execution Strategy learning loop **cannot close today**, and the
finding was already reported in that workstream rather than discovered here.

The specific temptation the instruction forecloses: a session's average pace can
always be compared against the strategy's *intended* average, and it would be
easy to call the difference "you went out too hard". It is not that. A runner who
negative-splits a tempo perfectly and one who blows up at 6km can produce the
same average. Reading execution quality out of a single mean is inventing the
interesting half of the data.

**What this changes:** the strategy remains prescriptive only. It says what to
do; it does not yet assess what was done. Closing the loop requires a real split
source — lap data from Strava's activity streams, or a native GPS recorder —
which is a separate piece of work with its own permissions, storage and battery
questions, not a modelling improvement.

**What it does not change:** the prescription itself is unaffected. Every segment
Execution Strategy emits comes from `segmentsFor()` decomposing a prescription
that already exists, with paces from the deterministic VDOT surface. Nothing in
the output depends on split data.

---

## 2. No goal retargeting until an evidence threshold is designed and adversarially tested

**HQ:** no automatic goal retargeting until a defensible evidence threshold has
been designed and adversarially tested.

**Accepted, and the sequencing is right.** Retargeting is the highest-consequence
automatic action the product could take: silently telling an athlete their goal
has moved, on evidence, and being wrong. The failure is not a bad pace target for
one session — it is demoralising somebody in week nine on the strength of a hot
week, a hilly route, a bad night's sleep, or a watch with a flat battery.

It also depends on point 1. Honest retargeting needs to distinguish *this athlete
is not on track* from *these particular sessions were compromised*, and the
compromised-session signals are largely segment-shaped: where in the session it
went wrong, whether the first half was on target, whether heart rate drifted
while pace held. Building retargeting on whole-session averages would produce a
threshold tuned to noise.

"Adversarially tested" is the operative phrase. A threshold is only defensible if
somebody has actively tried to make it fire wrongly — heat waves, altitude,
treadmill sessions, a mis-entered distance, a single heroic parkrun, a fortnight
of illness, a plan restarted mid-block. The test suite for this needs to be
written by somebody trying to break it, not by somebody demonstrating it works.

**What this changes:** nothing is deferred that was built. The prototype has no
retargeting and never proposed any.

---

## 3. Strategy methodology fractions are product choices, not universal constants

**HQ:** the strategy methodology fractions are product choices, not universal
scientific constants.

**Correct, and the code should keep saying so.** The staged fractions in
`STRATEGY_PHASES` and in the per-archetype strategy functions are a defensible
coaching convention — they are the shape most coaches would recognise for a
progressive long run or a controlled tempo — but they are one convention among
several, and no literature fixes them at those values. A different coach would
pick different numbers and be equally right.

This matters because of what happens if it is forgotten. A fraction presented as
scientific fact becomes unchangeable: nobody wants to be the person who altered
the science. A fraction understood as a product choice can be tuned, A/B'd,
argued about, and given to the athlete as an adjustable preference — which is
almost certainly where it should end up.

It also constrains the wording. The strategy must never say "research shows" or
"the optimal split is". It says what to do and why in coaching terms, which is
both honest and the register the rest of the product already uses.

**What this changes:** presentation discipline, permanently. Any future edit to
those numbers is a product decision requiring a product owner, not a bug fix —
and equally, it does not require a literature review to change them.

---

## 4. Execution Strategy is CORE

**HQ:** Execution Strategy is CORE — do not build artificial Pro restrictions
around it.

**Accepted without reservation, and it agrees with the earlier verdict.** The
workstream's own conclusion was `CORE`, on the grounds that Execution Strategy is
not an addition to the coaching product — it is the coaching product finally
saying out loud what its own prescriptions already mean. `segmentsFor()` was
decomposing all nineteen archetypes before this workstream started. The strategy
layer stages what was already there.

Gating it would mean shipping a paid tier where the free tier tells athletes
*what* to run and refuses to tell them *how* — which is not a feature boundary,
it is withholding the point. It would also be the wrong kind of upsell: the sort
that makes the free product feel deliberately hobbled rather than the paid one
feel generous.

**What this changes:** nothing structurally, and that is worth stating precisely.
The prototype contains no entitlement check, no tier field, no `isPro`, and no
call into the commercial gates. There is exactly one flag,
`EXECUTION_STRATEGY_ENABLED`, and it is a release flag rather than an entitlement
— it will be flipped to `true` for everyone or not at all.

---

## Where the branch stands

| | |
|---|---|
| Branch | `claude/execution-strategy` @ `d56ef02` |
| Tests | 844/844 at the time of that commit |
| Flag | `EXECUTION_STRATEGY_ENABLED = false` |
| Merged | no |
| Deployed | no |
| Visible to beta | no |
| Verdict | CORE |

The two points that block further work — segment data (1) and the retargeting
threshold (2) — are both blocked on the same missing input, and neither is
blocked on modelling. Nothing about the prescription layer needs revisiting.
