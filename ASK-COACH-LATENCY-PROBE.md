# Ask Coach — latency diagnostic

Branch `claude/ask-coach-latency-probe`, cut from `main` @ `b376866`.
**Diagnostic only. No streaming. Nothing athlete-facing changed.**

`claude/ask-coach-streaming-audit` @ `bd8321b` is untouched and remains
audit-only.

---

## 1. What now gets logged

One file changed — `api/_voice-ask.js` — and every code line added is a
timestamp or a log line. The existing `voice: ASK …` lines gain four fields:

```
voice: ASK ok chars=214 out=812 change=0 total=4180 pre=190 head=3910 body=80
```

| Field | Boundary |
|---|---|
| **`pre`** | request received → the upstream request is opened. **Our own cost**: the auth round trip, the Strava boundary, context handling. |
| **`head`** | upstream opened → **response headers arrive**. |
| **`body`** | headers → body fully read and parsed. |
| **`total`** | request received → our response sent. |

Already present and unchanged, and needed to read the result:

| Field | Meaning |
|---|---|
| `out=` | total output tokens — **includes thinking tokens** |
| `chars=` | length of the answer actually returned |

`ASK declined` and `ASK empty_reply` are timed too, so a slow *failure* is as
readable as a slow success. The retry-without-effort path carries the original
receive time through, so `total` still measures the whole wait rather than the
second attempt only.

---

## 2. What cannot be measured, stated plainly

**`head` is NOT time-to-first-token, and no field here claims to be.**

You asked me to report this explicitly rather than fabricate an equivalent, so:
this is a **non-streaming** call. There are no tokens on the wire — only a
complete JSON body. `fetch` resolves when the **response headers** arrive, and
for a non-streamed generation those arrive at or near the **end** of generation.

**True first-visible-token timing is observable only by actually streaming**,
and streaming is not implemented here. Any `ttft=` field on this endpoint would
be an invented number. There isn't one, and a test asserts there never is.

### What the numbers can still tell us

`head` is the **whole upstream turn — thinking and generation together**. The
split between them is not measured, but it can be *inferred* from the two token
counts already logged:

| Reading | Inference |
|---|---|
| large `out`, small `chars` | thinking consumed the turn → **streaming will not help much**; the lever is `effort` or a different model for this route |
| `out` close to `chars`/4 | generation dominated → **streaming is worth building** |

That is an inference and I will label it as one when I report your results. It
is not a measurement of thinking time, and I am not going to present it as one.

---

## 3. What did not change

| | |
|---|---|
| Model | `claude-opus-5` — unchanged |
| Effort | `low` — unchanged |
| `max_tokens` | 16000 — unchanged |
| Prompt | unchanged, including the OUTPUT contract verbatim |
| Response contract | `{answer, needsPlanChange, changeReason}` — unchanged |
| `needsPlanChange` | unchanged, both directions |
| Athlete-facing UX | **not one line of the browser runtime changed on this branch** |
| Strava boundary / Article 9 | unchanged |
| Streaming | **not enabled** — asserted by test |

`test/askCoachLatencyProbe.test.js` (13 tests) asserts all of the above rather
than asserting my intent: the model id, the effort literal, the token ceiling,
the exact prompt OUTPUT lines, the response key set, `needsPlanChange`
round-tripping in both directions, every refusal path and its code, that no
timing field leaks into the athlete-facing JSON, and that no dependency or
external `require` was added.

---

## 4. Privacy

Every added field is a plain integer. A test drives a question containing
*"my left calf has been hurting since Tuesday"* with a heart rate and a
readiness score in the context, captures every `console.log`, and asserts none
of the question, the answer, the day id, the heart rate, the readiness object,
the API key or the athlete id appears in any line — and that each timing field
matches `^\d+$` exactly.

No question, answer, athlete context, thinking content, secret or personal
information is logged. Same contract the surrounding lines already held.

---

## 5. What I need from you

1. **Deploy this branch** (or merge it — it is a logging change; your call).
2. **Make several live Ask Coach requests from Android.** Vary them a little:
   one short factual question, one that invites a longer answer.
3. **Send me the `voice: ASK ok …` lines** from the Vercel log — the whole
   line, they carry nothing sensitive by construction.

Then I will report the split and recommend one of:

- **implement streaming** — if generation dominates;
- **investigate effort/model latency** — if thinking dominates;
- **leave Ask Coach transport unchanged** — if `total` is mostly network and
  the server is quick, which would point at the device or the connection
  rather than at us.

One more thing worth knowing when you read the numbers: `total` is
**server-side**. The difference between it and the ~4 s you feel on the phone is
network round trip plus client render. If `total` comes back at, say, 3.8 s,
the wait is upstream. If it comes back at 1.5 s, most of your four seconds is
somewhere I have not instrumented yet, and that is the next thing to measure.

**Not merged. Diagnostic only.**
