# Ask Coach — Streaming: audit and proposal

Branch `claude/ask-coach-streaming-audit`, cut from `main` @ `83e5ba6`.
**Audit only. No code changed. Nothing to merge yet.**

---

## 0. A correction to what I told you last time

In the latency report I estimated streaming would take the perceived wait "from
~4 s to under 1 s". **That estimate was too optimistic and I had not checked
the model's behaviour before making it.**

`claude-opus-5` runs **adaptive thinking on by default**, and `thinking.display`
defaults to **`"omitted"`** on this model. Under `omitted`, thinking blocks are
still streamed — with **empty text**. So the first thing a stream delivers is a
silent thinking block, and the first *visible* token does not arrive until
thinking finishes.

Streaming therefore does not remove the thinking phase. It removes the
**answer-generation** phase from the wait. That is still a real and worthwhile
win, but it is a different, smaller claim, and §5 states it as a range with the
mechanism rather than a number I cannot yet measure.

---

## 1. What Ask Coach does today

```
tap → askSet('thinking')        painted in 32 ms   (measured, already good)
    → voiceCoachContext()       0.1 ms
    → POST /api/voice-ask       one JSON request
    → api/_voice-ask.js         one non-streaming call to /v1/messages
    → whole answer generated    ~4 s of nothing
    → JSON response             → askSet('answered') → render → voiceSpeak()
```

| Fact | Value |
|---|---|
| Model | `claude-opus-5` |
| `max_tokens` | 16000 (non-streaming default) |
| `output_config.effort` | `low` |
| Thinking | adaptive, on by default, `display` defaults to `omitted` |
| Transport | raw `fetch`, no SDK |
| Output contract | **a single JSON object** |

```json
{"answer": "...", "needsPlanChange": true|false, "changeReason": "..."}
```

---

## 2. The obstacle nobody would guess from the outside

**The model is asked to reply with a single JSON object, so the first tokens off
the wire are `{"answer": "` — not prose.** You cannot stream that to an athlete.

This is the crux of the change, and it is a *prompt contract* problem, not a
transport problem. Three ways out:

| Option | How | Verdict |
|---|---|---|
| **A. Incrementally extract `answer` from the JSON stream** | a scanner that finds `"answer":"` and emits unescaped characters until the closing quote | Works, but re-implements a JSON string parser against a partial buffer, including escape sequences and UTF-16 pairs. Fragile in exactly the place where a bug shows the athlete a backslash. |
| **B. Prose first, machine-readable trailer last** | model replies with the answer as plain prose, then a final line `<<<VVV {"needsPlanChange":false,"changeReason":""}>>>` | **Recommended.** Streams naturally from the first token, the trailer arrives last (which is what we want — see §4), and stripping a sentinel from the tail is trivial and testable. |
| **C. Structured outputs (`output_config.format`)** | schema-constrained JSON | Still JSON on the wire, so it has option A's problem, and adds a constraint that is incompatible with citations. No benefit here. |

**Option B changes the prompt's OUTPUT section only.** The coaching instructions
above it — the authority rules, the brevity rules, the "no generic advice"
rule — are untouched, and `parseReply()`'s "failing towards *just answer*"
behaviour is preserved: a reply with no trailer is treated as an answer with no
proposed change, exactly as today.

---

## 3. Architecture

### Server — `api/_voice-ask.js`

Add `stream: true`, keep everything else identical. Consume the SSE stream and
re-emit to the client as newline-delimited JSON (simpler than re-emitting SSE,
and the client is ours):

```
{"t":"delta","v":"Keep it easy — "}      ← as text arrives
{"t":"delta","v":"your last two…"}
{"t":"done","needsPlanChange":false,"changeReason":"","chars":214}
```

Anthropic's SSE events we care about: `content_block_delta` with
`delta.type === "text_delta"` (append), `message_delta` (carries `stop_reason`),
`message_stop` (end). Thinking blocks arrive as `content_block_delta` with
`thinking_delta` and, under `display:"omitted"`, empty text — **ignored, never
forwarded**. Nothing about the reasoning reaches the athlete.

Vercel Node functions stream by writing to `res` progressively; no config change
is needed, but the router in `api/voice.js` must not buffer (it currently just
returns `handle(req,res)`, so it does not).

### Client — `askSend()`

Read `response.body.getReader()`, split on newlines, append each `delta` to a
growing answer, re-render. On `done`, apply the existing completion path
unchanged.

**Fallback is mandatory and cheap**: if `response.body` is absent, the reader
throws, or the first chunk does not parse, fall back to reading the whole body
as JSON — the current path. A device that cannot stream gets exactly today's
behaviour.

---

## 4. Every preservation you named, and how it is held

| Requirement | How |
|---|---|
| **Identical coaching authority and context** | `voiceCoachContext()` untouched. The system prompt's coaching sections untouched. Only the OUTPUT paragraph changes format. |
| **Same model** | `claude-opus-5`, unchanged. No evidence justifies otherwise. `effort: 'low'` unchanged. |
| **Strava provenance boundary** | Untouched. `aiEligibleDays()` and the context refusal run **before** the request is opened; streaming is transport only. The existing `STRAVA_DERIVED_CONTEXT` 422 fires before any stream starts. |
| **Article 9 handling** | Untouched. Health data is never assembled without consent; that happens client-side before transport. |
| **No partial output read as a coaching decision** | This is the one that needs care, and it falls out of option B: `needsPlanChange` **only exists in the trailer, which is the last thing sent**. There is no partial state in which a proposal could be inferred. Concretely: the proposal button renders only on `done`; `coachProposedChangeDayId()` is consulted only on `done`; and `voiceSpeak()` fires only on `done` — a half-spoken answer would be worse than a late one. |
| **Accessible loading/streaming state** | See below — this needs an actual change, not just preservation. |

### The accessibility trap

`.ask-thinking` today is `role="status" aria-live="polite"`. **If streamed text
lands in a live region, a screen reader announces every chunk** — the athlete
hears the answer stuttered word by word. The correct treatment:

- keep `Thinking…` in the live region until the first delta arrives;
- stream the growing answer into a **non-live** element;
- on `done`, move the completed answer into the announced region (or set
  `aria-live` at that moment) so it is announced **once**, in full.

That is a real requirement, not a detail, and it is why "just render the deltas"
would be the wrong implementation.

---

## 5. Expected improvement — stated as a mechanism, not a number

Today the athlete waits for **thinking + full answer generation**. After the
change they wait for **thinking + the first sentence**.

- The saving is the answer-generation time, less the first sentence.
- A 2–3 sentence coaching answer is short, so answer generation is a
  *meaningful but not dominant* share of the 4 s.
- **My honest expectation: first visible text somewhere in the 1.5–2.5 s range,
  against ~4 s today.** A roughly 40–60% cut in perceived wait, not the
  sub-second figure I gave you earlier.

**I cannot measure this from here.** This sandbox has no Anthropic credential
and the egress proxy blocks the API host, so any number I produced would be
invented. The proposal therefore includes instrumentation as part of the work:

> add `ttft=<ms>` (time to first **text** delta) alongside the existing
> `ms=` in the `voice: ASK ok` log line — milliseconds only, no content.

That single field turns "did this help" into a fact you can read in the Vercel
log after one live question, before and after.

**If the measured `ttft` turns out to be most of the 4 s**, the answer is not
more streaming — it is that thinking dominates, and the lever is
`output_config.effort` or a smaller model for this route. Worth knowing before
building, which is why the instrumentation is cheap enough to ship first.

### A cheaper experiment I would run first

Add the `ttft` logging to the **current non-streaming** path as a one-line
change (time to first byte of the response). One live question then tells us how
the 4 s splits between thinking and generation — and therefore whether streaming
is worth building at all. **I recommend doing this before the streaming work.**

---

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Prompt contract change alters answer quality | **Medium — the real one** | Only the OUTPUT paragraph changes. Verify with the existing Ask Coach suite plus a before/after read of live answers. A prompt change is never free and I will not pretend this one is. |
| Trailer leaks into the spoken/displayed answer | Medium | Sentinel-delimited and stripped server-side; the client never sees it. Tested against a reply with no trailer, a malformed trailer, and a trailer-shaped string inside the answer. |
| Screen reader stutters the answer | Medium | §4. Tested. |
| Vercel buffers the response | Low | Node functions stream; verified by the first live request. Fallback covers it. |
| Older WebView lacks `body.getReader()` | Low | Non-streaming fallback, same as today. |
| Connection drops mid-stream | Low | Partial answer discarded, existing error copy shown. Never a partial answer presented as complete. |
| Function duration | Low | Streaming holds the connection open no longer than today's total. |

---

## 7. Tests I would write before implementation

**Server**
1. A streamed reply assembles to the same answer a non-streamed one produces.
2. `thinking_delta` blocks are never forwarded to the client.
3. The trailer is stripped; `needsPlanChange` survives it.
4. No trailer / malformed trailer / a `<<<VVV` string inside the answer → answer intact, no change proposed.
5. Upstream error mid-stream → the client receives a terminal error frame, never a truncated answer marked done.
6. The Strava 422 and the health boundary still fire **before** any stream opens.
7. No log line gains the question, the answer or the reasoning; `ttft` is a number.

**Client**
8. Deltas append in order and render progressively.
9. `voiceSpeak()` fires exactly once, on `done`, with the complete answer.
10. The proposal button never renders before `done`.
11. The growing answer is not inside an `aria-live` region; the completed one is announced once.
12. `body.getReader()` absent → falls back to the current path with an identical result.
13. Stream aborted mid-flight → no partial answer is presented or spoken.
14. Ask Coach still refuses when the coach is unavailable / signed out / Strava-derived.

---

## 8. Recommendation

1. **Ship the `ttft` measurement on the current path first** (one line, no
   behaviour change). One live question tells us how the 4 s splits.
2. **If generation is the bulk of it**, build streaming as described — option B,
   the accessibility treatment in §4, the fallback, and the 14 tests.
3. **If thinking is the bulk of it**, do not build streaming. Tune `effort` or
   route this to a faster model, and I will bring you that comparison instead.

I would rather spend one line finding out than build the wrong thing well.

**Nothing implemented. Awaiting your decision on step 1.**
