# Today Voice Coach — feature brief

**STATUS: LOGGED. NOT IMPLEMENTED. NOT STARTED.**

Received 2026-08-26. Filed for later implementation at the founder's direction.
No production code, no provider selection, no dependency and no API route has
been created for this. Nothing in this document has been built.

Activation is a separate, explicit instruction.

**Amended 2026-08-26** with a founder clarification, incorporated below:
Guidance Level and Experience Level are intentionally separate concepts and
must not be substituted for one another (*Guidance Level is a missing
prerequisite*); a consolidated server-side Voice router is preferred in
principle, subject to the implementation audit (*platform constraints*); and
the audio / transcription / health-statement lifecycle must be audited before
provider selection (*Health, safety and consent*). No code changed.

---

## The product objective

Not "put AI chat in a running app". **Make the existing Valhalla coach
conversational.** The loop:

```
TODAY → LISTEN TO BRIEFING → ASK COACH (if needed) → RUN
      → EXECUTION REVIEW → LISTEN TO DEBRIEF → ASK COACH
      → any proposed change goes through Valhalla's real coaching system
      → athlete accepts or declines
```

The coach should feel like it knows what you were supposed to do, what you
actually did, why you are doing it, where you are trying to get, and what
should happen next.

Two restrained controls on Today, associated with the existing coaching:

```
▶ LISTEN        🎙 ASK COACH
```

The workout stays the primary object. The written app remains fully usable
without voice.

---

## Hard boundaries

These are stated as absolutes in the brief.

| Rule | |
|---|---|
| **Today only** | No voice control on This Week, Full Plan, Valhalla, Record, Settings, Builder, Plan HQ or anywhere else. |
| **No new navigation** | No bottom-nav item, no Chat tab, no floating global assistant. |
| **No autoplay** | Audio never starts on its own. Opening the app in public must never produce sound. |
| **Not a chatbot** | Not a generic assistant. Not a second coaching engine. |
| **The LLM is not the methodology** | See below — this is the critical architectural rule. |
| **No silent plan mutation** | A conversation must never change the programme by itself. |

### The critical architectural rule

The conversational layer **may**: understand the question, retrieve relevant
evidence, explain existing coaching decisions, summarise evidence, identify
what the athlete is asking to change, and present an already-authorised
recommendation naturally.

It **must not** bypass: workout prescription, Current Fitness methodology,
training-zone calculation, Next Move, Plan Evolution, session-identity trust,
load/recovery protection, health/safety rules, or consent rules.

Where Valhalla already has deterministic, reconciled coaching logic, that logic
is used. **Never mutate a session because an LLM returned text asking for one.**

### Plan changes through voice

A proposal, never an action:

```
SUGGESTED CHANGE
Intervals  →  40 min Easy
[ ACCEPT CHANGE ]   [ KEEP ORIGINAL ]
```

Routed through the existing authoritative plan-change and provenance
mechanisms.

---

## LISTEN

**Before the session** — a short natural briefing synthesising the existing
authoritative coaching for today: what, why, how, feel, watch-for, execution
guidance, and any adjustment or context Valhalla already holds.

Not a word-for-word read of the UI. Not `"What. Fifty minutes easy. Why.
Aerobic development."` Instead:

> "Tonight you've got fifty minutes easy. Keep this one genuinely comfortable —
> we're building aerobic work without adding unnecessary fatigue. Don't chase
> the top of the pace range. Relaxed breathing and controlled legs are what I'm
> looking for, and you should finish feeling like you could have carried on."

**After the session**, once Execution Review exists, LISTEN becomes a debrief
grounded in that review as authoritative evidence:

> "Good session. You kept the effort where we wanted it for most of the run.
> Heart rate climbed towards the end while pace stayed fairly stable, so the
> cardiovascular cost was a little higher than usual. I'm not changing anything
> yet — tomorrow remains as planned."

Both must stay faithful to the same coaching truth shown on screen. Voice must
not invent a second interpretation, and must not reach a conclusion the
coaching system has not reached.

**Briefing length** follows **Guidance Level** — concise (only the important
execution information), full (purpose, execution, feel, watch-outs), adaptive
(Valhalla decides from session and current athlete context). Do not create a
second independent voice-detail setting, and **do not substitute Experience
Level**. Guidance Level is not present in the current runtime; it is a missing
prerequisite, not an invitation to map onto something else. See *Guidance Level
is a missing prerequisite* under **Orientation** below.

---

## ASK COACH

Spoken, natural questions. The athlete never restates their programme.

> "Why have you given me intervals tomorrow?" · "Why have my paces slowed
> down?" · "That felt much harder than it should have. Should tomorrow change?"
> · "I've only got forty minutes tonight." · "Can I move my long run to
> Sunday?" · "I missed yesterday. Should I make it up?" · "How am I
> progressing?" · "Do you still think my goal is realistic?" · "My calf feels a
> little sore. Should I run?" · "What should I eat before tomorrow's long run?"

**Flow:** tap → listening state → athlete speaks → speech to text → athlete
sees what Valhalla understood → coach answers → answer shown as text → the same
voice optionally speaks it.

Needs a clear listening indicator, cancel, retry, and graceful handling of
microphone permission and recognition failure. **Never trap the athlete in a
voice-only interaction.**

After a briefing, offer a natural path to **🎙 ASK COACH ABOUT THIS SESSION**,
automatically grounded in today's workout.

**Follow-ups** within the active Today interaction should resolve against the
immediate conversation ("what if I can't hold the pace?" → today's threshold
session). Conversational memory stays bounded and deliberate — no unlimited
permanent chat history without separate justification.

### Coach context — minimum necessary

A controlled context layer, assembled per question, **not** the athlete's whole
state and history posted to a model. Candidate sources: today's prescription
and coaching; current programme/block and phase; upcoming sessions; recent
completed sessions and their Execution Reviews; current fitness evidence; goal;
pace calibration; recent plan adjustments; Next Move; relevant athlete notes;
recent load/training history; available training days; and health-derived
information **only where consent permits**.

### Response quality

Concise by default, specific to the athlete, grounded in Valhalla evidence,
clear about uncertainty, consistent with existing coaching decisions.

Bad: *"Running in hot weather can increase cardiovascular strain. Remember to
hydrate."*

Better: *"Tonight cost you more than that easy run normally should. You still
completed it well, and tomorrow is already low-load, so I wouldn't change the
plan yet. Recover tonight and I'll reassess after your next session."*

The difference is that Valhalla understands **the athlete's plan**.

---

## Voice identity

One consistent **British English female voice** across briefing, debrief and
Ask Coach. Natural, warm, calm, confident, knowledgeable, conversational,
supportive without being sugary, recognisably British, appropriate for a
serious running coach.

Avoid: robotic TTS, exaggerated enthusiasm, "wellness app" delivery, overly
emotional delivery, American pronunciation, or the voice changing between
features.

---

## Post-run spoken feedback (explore)

Allow natural spoken debrief — including how people actually talk:

> "That was fucking brutal. My legs were actually okay but I couldn't get my
> breathing under control and the heat was ridiculous."

Valhalla may extract *candidate* signals: perceived difficulty, breathing
difficulty, muscular state, environmental context, soreness or pain mention,
execution context.

**Free speech must not silently become authoritative health or training fact.**
Where extracted information would materially influence coaching, show what was
understood and let the athlete confirm:

```
I picked up:
• Effort felt harder than expected
• Legs felt okay
• Breathing was difficult
• Hot conditions affected the session
[ THAT'S RIGHT ]   [ EDIT ]
```

Only confirmed and appropriately governed information enters systems that
affect future coaching.

---

## Health, safety and consent

Voice must **not** become a back door around the existing Article 9 health-data
boundary. Speech containing pain, injury, illness, heart-rate or other
protected health signals goes through the existing consent and privacy
architecture. Nothing protected is persisted or fed into future coaching
contrary to the athlete's consent state.

**A specific privacy and data-flow review is required before implementation.**

**ACCEPTED BY THE FOUNDER (2026-08-26), AND BINDING ON SEQUENCE.** Voice
implementation must explicitly audit the **lifecycle of audio, transcription
and health-related statements** — capture, transmission, retention, deletion
and any onward processing — **before provider selection or implementation**.

**Do not assume the existing stored-data consent boundary automatically covers
raw voice processing.** The established Article 9 pattern strips health data at
the point of *write* (`api/_health-consent.js` → `forIngest()`, `stripCovered()`,
`carriesCovered()`), so an athlete who has not consented never has it stored.
Raw audio is a surface that architecture has never had to consider: an
utterance can carry protected health information *before* anything reaches a
write path, and transcription creates a second copy on a third party's
infrastructure. Neither is covered by the existing boundary by default, and
neither may be assumed into it.

This audit **precedes** provider selection, because provider choice is partly
determined by its answer.

### High-risk questions

Ask Coach is a running coach, not a doctor. For pain, injury or medical
questions: do not diagnose, do not manufacture certainty, use the conservative
existing Valhalla safety logic, distinguish training guidance from medical
advice, and escalate where symptoms need professional assessment.

**Conversational fluency must not create more certainty than the evidence
supports.** This is the single largest risk in the feature.

---

## Failure behaviour

Today must keep working when voice does not. Handle: no internet, speech
recognition unavailable, microphone denied, TTS unavailable, model provider
unavailable, timeout, malformed response, rate limit. The written coaching is
always retained.

---

## Design, accessibility

Existing Velvet Viking visual language. Subtle controls, not third-party AI
widgets. States: idle, listening, processing, speaking, paused/stopped,
unavailable/error. Today must not become visually busy.

Voice is optional. Every spoken response is also available as text, and every
voice action has an accessible non-voice equivalent. Screen readers, accessible
labels, keyboard interaction on web, clear microphone and audio-playing state,
stop/pause.

---

## Required before any production code

1. Audit the existing Today/coaching architecture.
2. Identify the authoritative sources for briefing and debrief content.
3. Map Ask Coach context sources.
4. Map every action that could alter the plan.
5. Design the deterministic boundary between conversation and coaching logic.
6. Design health and consent handling.
7. **Audit the audio / transcription / health-statement lifecycle — BEFORE
   step 8.** Provider choice partly depends on the answer, so this cannot be
   deferred until after a provider is picked.
8. Evaluate STT / TTS / model provider options.
9. Determine the smallest architecturally correct route for **Guidance Level** —
   implemented as part of this work, or landed first as its own small
   prerequisite. Report before changing code.
10. Report architecture, cost and privacy implications — expected STT provider,
   model route, TTS provider, approximate per-interaction cost, likely latency,
   caching opportunities (including whether pre-session briefing audio can be
   generated and cached), privacy implications, and Android/web compatibility.

**If a major provider, privacy, commercial or architecture decision requires
founder approval: STOP and present the options first. Do not casually hard-wire
a provider.**

---

## Test requirements (eventual)

Pre-session Listen · post-session Listen · concise/full/adaptive · Ask Coach
about today · follow-up contextual question · question about tomorrow ·
proposed plan change requires explicit acceptance · declining changes nothing ·
LLM cannot directly mutate the plan · pain/injury language · Article 9 granted
/ absent / withdrawn · microphone denied · STT failure · TTS failure · provider
failure · offline · text remains available · no voice UI outside Today · one
voice identity across all three surfaces · light and dark · 360/390/430px ·
Android behaviour.

---

# Orientation — verified anchors in this repository

Recorded at log time so the implementation audit starts from fact rather than
assumption. **This is not a design and commits to nothing.** Every statement
below was checked against the code on `origin/main` at `d9687aa`.

### Guidance Level is a missing prerequisite

**The audit finding stands: there is no Guidance Level in the current runtime.**
Searching finds `guidance` only as session guidance tables (`resolveGuidance()`,
the long-run guidance overlay). There is no adaptive/full/concise control, and
no verbosity or detail-level setting of any kind.

**The founder's clarification (2026-08-26) settles what that means, and it is
not what this document first suggested.** Guidance Level and Experience Level
are *intentionally separate Valhalla concepts*. An earlier revision of this
section proposed reusing Experience Level for voice verbosity. **That is
explicitly rejected and must not be done.**

| | **Experience Level** | **Guidance Level** |
|---|---|---|
| Values | `novice` / `experienced` / `advanced` | `Adaptive` / `Full` / `Concise` |
| Belongs to | programme / prescription **methodology** | **presentation / detail** control |
| May affect | what training is prescribed | how much coaching **explanation** is presented |
| Affects prescription? | yes | **never** |
| Lives in | the builder (`BUILDER_SPEC.experience`) | **Settings** (intended) |
| Default | `experienced` | **`Adaptive`** (default and recommended) |
| Is it the athlete's voice/coaching verbosity preference? | **no** | **yes** |

`Adaptive` is intended to be genuinely adaptive: it may become more concise as
demonstrated execution and understanding improve, and restore detail when
intervention is warranted.

**The rule for Voice Coach, stated three ways so it cannot be misread:**

1. Do **not** map Voice Coach verbosity to Experience Level.
2. Do **not** create a separate Voice-specific verbosity setting.
3. Treat Guidance Level's absence as a **missing prerequisite / integration
   surface**, never as permission to substitute another setting.

Note that `test/coachGuidanceDepth.test.js` — despite its name — asserts
**Experience**-driven depth of the written "How to run this" aid. It is *not*
Guidance Level and must not be mistaken for it. Its stated principle
("experience should decide how MUCH is written, never whether the aid exists")
is worth reading as precedent for how a detail control behaves, but the setting
it exercises is the methodology one.

**Required at activation, before any code changes:** audit whether Guidance
Level should be implemented *as part of* the Voice work, or landed *first* as
its own small prerequisite. **Report the smallest architecturally correct route
before changing code.** Do not assume either answer here.

### Where the authoritative coaching already lives

| Need | Existing source |
|---|---|
| Execution Review evidence | `computeExecutionBreakdown()` — returns `parts`, `counted` and `missing`, renormalising weights over components that produced a score. `missing` is the ready-made "what we do NOT know" list a debrief must respect. |
| Review freshness | `coachPersistReview()` / `reviewInputHash` / `ACTUAL_SYNCED_FIELDS` |
| Did the session happen | `sessionRan()` (performance boundary) vs `completed` (confirmation boundary) — deliberately different questions; see the long note above `computeExecutionBreakdown()` |
| Session prescription | `prescriptionOf()`, `orderedSegments()`, `structuredLoggingPlan()` |
| Next Move | `test/coachNextMoveCard.test.js`, `test/nextMoveReconciliation.test.js` |
| Plan Evolution | `test/evolutionChanges.test.js`, `test/evolutionLifecycle.test.js`, `test/planEvolutionProtectedReduced.test.js` |
| Absorbed load / capacity | `absorbedWeeklyVolume()`, `loadToleranceModel()`, `demonstratedSustainableVolume()` — all confidence-gated |
| Medical boundary | `test/medicalBoundary.test.js` |
| Coach voice and copy discipline | `test/coachVoice.test.js`, `test/coachCopyDiscipline.test.js`, `test/coachCoherence.test.js`, `test/coachSurfaceDistinctness.test.js` |

### Health consent is already structural

`healthConsentGranted()` and `HEALTH_CONSENT_VERSION` in the runtime;
`api/_health-consent.js` server-side with `forIngest()`, `stripCovered()` and
`carriesCovered()`; `test/healthDataConsent.test.js`, `test/healthErasure.test.js`,
`test/learningWithoutHealthData.test.js`.

The established pattern is **strip at the point of write, not at the point of
use** — an athlete who has not consented never has the data stored, rather than
having it stored and ignored. Voice input carrying health signals must enter
through that same door. Note that raw audio is a *new* processing surface the
existing architecture has never had to consider.

### Two platform constraints that will shape the architecture

1. **Vercel Hobby allows 12 Serverless Functions per deployment**, and every
   non-underscore file under `/api` becomes one. This has already caused a
   hard deployment failure (`exceeded_serverless_functions_per_deployment`,
   see `test/functionBudget.test.js`). Current count: **8 of 12**
   (`account`, `admin-user`, `app`, `beta-signin`, `billing-webhook`,
   `garmin`, `session`, `strava`). Strava's six endpoints already had to be
   consolidated behind one router (`api/strava.js`) for exactly this reason.

   **ACCEPTED IN PRINCIPLE BY THE FOUNDER (2026-08-26):** prefer a
   **consolidated server-side Voice router**, analogous to the existing Strava
   routing architecture, rather than unnecessarily consuming separate Vercel
   functions — **subject to the implementation audit**. This is a stated
   preference to design toward, not a settled design: the audit confirms the
   shape before any route is written.

2. **The app is one 1.5 MB file** (`protected/velvet-viking-valhalla.html`)
   served through the `/api/app` delivery gate, with the Android build a thin
   Capacitor shell pointed at the live site (`capacitor.config.json` →
   `server.url`). Voice UI ships inside that file; no new APK is needed for
   web-delivered changes.

### Precedent worth reading first

`test/stravaPolicyBoundary.test.js` and commit `72e11ca` ("make the AI boundary
structural, and provenance answerable") already establish an AI boundary and a
provenance answer in this codebase. Whatever governs Ask Coach should extend
that boundary rather than invent a second one.
