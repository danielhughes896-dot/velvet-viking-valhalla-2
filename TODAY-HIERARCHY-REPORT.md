# Today — Information Hierarchy + Non-Repetitive Coaching Pass

Branch `claude/today-hierarchy`, cut from `main` @ `4863002`.
**Not merged. Held for founder review.**

The brief: *keep as much useful coaching information on Today as practical, but
put each piece of information in the correct location and stop different
surfaces repeating the same message.*

Nothing was deleted to satisfy it. Every coaching concept that was on Today
before this pass is still on Today. What changed is which surface owns it.

---

## 1. The audit, before anything was changed

Today carries four coaching surfaces. Their responsibilities overlapped:

| Surface | What it said | What it should own |
|---|---|---|
| **NEXT MOVE** (`coachBrief`) | led with `coachIntentLine()` — the generic purpose of the session *archetype* | why this session, **for this athlete, today** |
| **HOW TO RUN THIS** (`coachingDisclosureFor`) | Why / Execution / Feel / Watch For / Fuel | what the session is for, and how to execute it |
| **HEAR TODAY** (`voiceBriefingScript`) | ended with `coachBrief()`'s first paragraph, verbatim | a spoken briefing — not either of the above read out |
| **Guidance-level note** (`voice-why`) | "Fuller detail — you have not run many of these yet." | *nothing on Today* — it explains a mechanism, not the training |

The concrete failure, measured rather than asserted. For an easy day, one
concept appeared three times in three registers on one screen:

```
NEXT MOVE          "Today is about banking aerobic time cheaply. Save the hard
                    running for the sessions built for it."
HOW TO RUN / Why   "Aerobic base, and freshness for the hard days."
HEAR TODAY         "Today is about banking aerobic time cheaply. Save the hard
                    running for the sessions built for it."   <- byte-identical
```

The cause was structural, not editorial: Next Move *led* with the archetype's
generic purpose, and the briefing *ended* with Next Move's lead paragraph.

---

## 2. What changed

**(a) NEXT MOVE now leads with what only it can say.**
`coachReadinessLine()` — recent load, freshness, the decision and the evidence
behind it — leads. `coachIntentLine()` is no longer the automatic opener.

**(b) The generic purpose was relocated, not removed.**
It remains the `Why` row of HOW TO RUN THIS, and it is still `unshift`ed into
Next Move when nothing unlabelled leads. That fallback exists because removing
it outright produced two worse outcomes, both of which I hit and had to correct:

- an athlete with no load/recovery/decision context got an **empty Next Move**
  — a missing card, not a simplification;
- where the only remaining paragraph was a labelled status line, that furniture
  ("Insufficient evidence: …") was **promoted to the lead**.

The lead rule is therefore: *at least one concrete unlabelled line, never
leading with a label* (`voiceIsLabelled()` decides).

**(c) HEAR TODAY no longer narrates Next Move.**
This was found by the screenshot harness, not by reading the code, and it was
still live after (a) and (b). `voiceBriefingScript()` ended with
`voiceBriefParagraphs(coachBrief(dd))[0]`. With no adaptive context that
paragraph *is* `coachIntentLine()` — so on **all eight session types** the last
thing the athlete heard was byte-for-byte the paragraph on the screen in front
of them. The rule now:

- the engine's lead is spoken when it **knows something** (load, freshness, a
  held adjustment) — no authored sentence can carry that, so it must reach the ear;
- otherwise the **authored spoken purpose** carries the concept in the register
  the ear wants ("The goal is just to bank some aerobic work and stay fresh for
  the harder sessions").

Exactly one purpose is spoken, as before. Only the tie-break changed.

**(d) The guidance-level implementation note is gone from Today.**
The `voice-why` block is removed. `guidanceAdaptiveReason()` itself is
**untouched** and Guidance Level resolves exactly as before — only this
surfacing of it was removed.

---

## 3. Should WHY / EXECUTION / FEEL / WATCH FOR collapse to WHY / DO THIS / AVOID?

**Recommendation: keep all four. Do not collapse.**

I dumped all four rows for all eight types. They are distinct everywhere:

| Type | Why | Execution | Feel | Watch For |
|---|---|---|---|---|
| easy | Aerobic base, and freshness for the hard days. | Hold the easy window from the first kilometre to the last. | Conversational throughout. | Drifting up to comfortably quick. |
| long | Endurance and fatigue resistance — the backbone of the block. | Easy throughout. Fluid and carbohydrate past 90 minutes. | Easy early, honest work late. | Starting at the pace you mean to finish at. |
| tempo | Aerobic strength at a cost you can repeat. | A rhythm you could hold well past the time given. | Firm, not hard. | Letting it creep up to threshold. |
| threshold | Raises the pace at which lactate starts to accumulate. | Into the window inside the first kilometre, then hold. No surges, no sprint finish. | Hard but even, and repeatable. | Racing it. |
| interval | Power and running strength at a low impact cost. | Drive from the hips, short quick steps, eyes up. Effort, not pace. | Hard up, genuinely recovered at the bottom. | Racing the descent. |
| repetition | Speed, mechanics and economy without deep fatigue. | Quick but smooth, and jog the full recovery. | Fast, never straining. | Cutting the recovery short. |
| checkpoint | Resets your goal and every training pace in the block. | Warm up properly, even effort, nothing left. | Hard enough that the number is a fair reading. | Going out hard and fading. |
| race | The day the block was built for. | Goal pace early even while it feels too easy. Race the last third. | Comfortable early, hard late. | Banking time early. |

The reason to keep four is that **FEEL and WATCH FOR are not the same kind of
statement.** FEEL is a calibration target the athlete checks themselves
against *during* the session. WATCH FOR is the specific failure mode that
ruins *this* session type. On easy: "Conversational throughout" is the target;
"Drifting up to comfortably quick" is the error. Collapsing them into a single
AVOID row would keep the error and lose the target — that is information loss,
not simplification. Likewise WHY (purpose) and EXECUTION (procedure) answer
different questions.

The disclosure is already **closed by default**, so an athlete who does not
want the detail pays one line of card for it. The cost of four rows is paid
only by an athlete who opened it, which is the athlete who wants them.

---

## 4. Repetition, measured

`tools/shots/today-hierarchy-shots.js` normalises every sentence of ≥6 words on
the rendered page and counts duplicates. Across **34 frames**:

- **before the (c) fix:** 4 frames flagged repeats — `hear-playing` and
  `hear-read-no-speech`, both themes, each repeating two sentences.
- **after:** `repeats=0` on every frame; no page errors; no horizontal overflow.

---

## 5. The visible Hear Today transcript, and accessibility

**Investigated as asked, and changed — but not simply removed.**

Previously, pressing HEAR TODAY inserted the whole script as prose below the
controls, which made Today longer every time it was used and put a third copy
of the same coaching on screen. Now:

| Situation | What renders | Why |
|---|---|---|
| Speaking (device has a synthesiser) | a **visually-hidden `aria-live="polite"` region** containing every spoken line, plus a short visible "Playing briefing…" status | a screen reader announces the briefing exactly as before; a sighted athlete gets a status line, not duplicated prose |
| Read (device has **no** synthesiser) | the full visible transcript (`.voice-said`), unchanged | here the words *are* the delivery — this is the case the visible block existed for |

The hiding is `position:absolute; width:1px; height:1px; clip:rect(0 0 0 0)` —
**not `display:none`**, which is not announced. There is a test asserting
`display:none` never appears on that rule.

**No spoken word is lost to any athlete on any device.** The accessibility
invariant "every spoken line is also available as text" still holds.

---

## 6. What was NOT changed

- `guidanceAdaptiveReason()` — retained, only its Today surfacing removed.
- Guidance Level resolution — unchanged.
- The Strava fence on the voice card — untouched; a Strava-derived day still
  refuses the briefing and Ask Coach whole, and says so.
- Ask Coach — untouched.
- Every coaching sentence in the corpus — untouched. Nothing was reworded.
- **The RPE methodology branch (`claude/rpe-within-type-comparison` @ `04532bc`)
  — not touched, as instructed. It remains unmerged and separate.**

---

## 7. Tests

**Full suite: 2903 pass / 0 fail.**

New: `test/todayHierarchy.test.js` — 13 tests covering the lead rule, the
never-empty guarantee, the never-lead-with-a-label guarantee, the four
disclosure rows staying four and staying distinct, the briefing not narrating
Next Move, adaptive context still reaching the ear, the transcript treatment,
and the removed note.

Changed:
- `test/spokenRendering.test.js` — the test "the purpose is said once, and the
  engine's own line wins" encoded the *previous* tie-break. Its real invariant
  (**exactly one purpose, never both**) was preserved and is now asserted under
  both conditions, as two tests. It was rewritten, not deleted.
- `test/consentProvenanceAndBrevity.test.js` — required the intent line
  *specifically*; now requires *at least one concrete unlabelled line, never
  leading with a label*, which is the actual contract.

### Two defects I introduced and had to correct
1. Removing `coachIntentLine` outright emptied Next Move for easy/long and
   promoted "Insufficient evidence:" to the lead for threshold/interval. Fixed
   with the lead rule in §2(b).
2. Three render tests in my own new file were driving the wrong day.
   `voiceMayRender()` refuses any day whose date is not `todayStr()`, so the
   card rendered as an empty string and the assertions failed. Worse, the
   *absence* assertions in a fourth test were passing **vacuously** for the same
   reason. All four now drive the pinned day, and the absence test asserts the
   card actually rendered before proving anything is absent.

---

## 8. Screenshots

`tools/shots/today-hierarchy-shots.js` → `tools/shots/out-today-hierarchy/`,
34 frames, 390px, ×2 DPR, light and dark:

- Today for all eight types: `easy long tempo threshold interval repetition checkpoint race`
- HOW TO RUN THIS closed and open, on a quality day (threshold) and an easy day
- HEAR TODAY idle, playing, and read-only (no synthesiser)
- Ask Coach closed and open

Every frame: no page error, no horizontal overflow, no repeated coaching
sentence, guidance-level note absent.

---

## 9. Files changed

```
protected/velvet-viking-valhalla.html      coachBrief lead rule; voice card transcript
                                           treatment; voice-why removed; briefing
                                           purpose tie-break
test/todayHierarchy.test.js                new, 13 tests
test/spokenRendering.test.js               purpose tie-break contract rewritten
test/consentProvenanceAndBrevity.test.js   lead contract updated
tools/shots/today-hierarchy-shots.js       new, 34-frame capture + repetition measure
TODAY-HIERARCHY-REPORT.md                  this file
```

---

## 10. Residual finding, reported rather than hidden

For **race**, the authored spoken purpose ("Everything from here is execution,
the training that matters is already done") and the card's generic purpose
("Everything from here is execution. The training that matters is already
done.") are the same sentence with different punctuation. They now sit on
different surfaces rather than both being spoken, so the automated repeat scan
is clean — but an athlete who opens the disclosure *and* plays the briefing on
race day will meet that sentence twice.

I did not "fix" this by suppressing the race purpose. On race day
"everything from here is execution" is the single most important line, and
dropping it from speech to satisfy a duplicate-detector would be optimising the
wrong thing. **If you want it changed, the fix is editorial — reword one of the
two — and that is a coaching decision, not mine to make.**

---

## 11. Risk

Low. No engine, no prescription, no Strava path and no consent/provenance
logic was touched. The changes are which surface renders an existing string,
plus one tie-break in the spoken briefing. Every change is covered by a test
that fails if it is reverted.

---

## 12. Decisions I need from you

1. **Four disclosure rows, or three?** My recommendation is four — §3.
2. **The race purpose duplication** — §10. Reword, or leave?
3. Approve for merge, or send back.

**Not merged. Awaiting your review.**
