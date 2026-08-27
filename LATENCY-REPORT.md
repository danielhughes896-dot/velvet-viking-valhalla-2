# Live Latency / Startup Performance Pass

Branch `claude/latency-pass`, cut from `main` @ `c9bff92`.
**Not merged. Held for founder review.**

You reported: app launch ~2 s, Ask Coach ~4 s to any visible change, Hear Today
~4 s to anything happening. I instrumented before changing anything.

**Headline: one of the three was ours, and it was the launch.** A render-blocking
font stylesheet was delaying not just the typeface but the entire application —
first paint, `init()`, the Today render and the voice probe. The other two were
already reacting in ~30 ms; what was wrong there was that Hear Today *said the
wrong thing* while waiting.

---

## 1. How this was measured

`tools/perf/measure.js` — the real runtime, in Chromium at 390×844, phone
emulation. Every network call is stubbed at a **declared fixed 400 ms** so our
own cost is isolated from the vendors'.

**The measurement is "painted", not "set".** Assigning a loading state and then
doing 200 ms of synchronous work before yielding leaves the interface visibly
dead for 200 ms however early the state was assigned. So every UI timing is
taken from a double `requestAnimationFrame` after the tap — the first frame the
browser could actually show you.

Two caveats, stated because they bound what these numbers mean:

- **The font host is unreachable from this sandbox.** Left unhandled it stalls
  for the proxy timeout and the first run measured a first paint of **12,768 ms**
  — a sandbox artefact, not your device. Every number below therefore answers
  the font request explicitly, either instantly or after a declared delay.
- **The 400 ms network stub is not Anthropic or ElevenLabs.** Real vendor
  latency is discussed in §5 and §6 and was not measured from here.

---

## 2. Cold start

| | Before | After |
|---|---:|---:|
| HTML delivered (`responseEnd`) | 27 ms | 27 ms |
| **first paint** | **1140 ms** | **124 ms** |
| script executed (`domInteractive`) | 1123 ms | 333 ms |
| first app network call | 1078 ms | 241 ms |
| Today drawn | yes | yes |

*(measured with the font stylesheet answered after a declared 1000 ms — the
question is not "is the network slow" but "does our first paint wait for it")*

With the font answered instantly, the app's own cost is: first paint **96 ms**,
script parsed **279 ms**, first contentful paint **300 ms**, Today drawn.

### The blocking work found

```html
<link href="https://fonts.googleapis.com/css2?family=Cinzel…" rel="stylesheet">
```

A plain render-blocking stylesheet in `<head>`. Two consequences, and the second
is the one that mattered:

1. **It blocks painting.** Expected, and normally survivable.
2. **It blocks execution of every script after it** — because a script may query
   computed style, the browser will not run one while a stylesheet is pending.
   The script after it here is *the entire application*. So a slow font host
   delayed `init()`, `loadState()`, the Today render, and the voice probe.

That is the ~2 s launch. Google Fonts on mobile data is routinely 300 ms–1.5 s,
and every millisecond of it was in front of your plan.

### The fix

```html
<link href="…" rel="stylesheet" media="print" onload="this.media='all';this.onload=null;">
<noscript><link href="…" rel="stylesheet"></noscript>
```

`media="print"` makes the browser fetch it off the critical path; `onload` flips
it to a real stylesheet the moment it lands. The faces already carried
`display=swap`, and every stack has a real fallback (`-apple-system`, `serif`,
`sans-serif`, `monospace`), so text paints immediately in fallback and swaps.

**Typography is unchanged.** Only when you are allowed to see the app changed.
`preconnect` is kept and now does its real job.

### Probes are NOT blocking startup — measured, not assumed

You asked me to check this. First paint **96 ms**, first network call
**191 ms**. `init()` calls `renderApp()` before `cloudInit()`, `voiceProbeOnce()`
and `stravaRefreshStatus()`, and awaits none of them. **The render-first
ordering you asked for already existed.** No change made; a test now pins the
ordering so it cannot regress.

---

## 3. Our synchronous work was never the problem

| Work | ms |
|---|---:|
| `JSON.parse(state)` | 0.0 |
| `renderApp()` | 13.9 |
| `renderTodayView()` | 11.3 |
| `voiceCoachContext()` | 0.1 |
| `voiceScriptFor(today)` | 3.7 |
| `coachBrief(today)` | 3.2 |
| `patchVoiceCard()` | 5.1 |

Nothing here is worth optimising. I did not touch any of it.

---

## 4. Two remaining payload findings — reported, not fixed

**The crest is 2.1 MB.** `assets/velvet-viking-crest.png`, intrinsic 1223×1286,
`loading="eager"`, displayed at roughly 180 CSS px on the launch screen. It does
not block first paint (it is an `<img>`), but on mobile data it is seconds of
downloading competing with everything else, and it dominates largest-contentful-
paint.

I have **not** re-encoded it. This container has no image tooling (no
ImageMagick, `cwebp`, `sharp` or PIL), and hand-rolling a PNG re-encoder for
your canonical brand asset — the README calls it exactly that — is not a
latency fix I should make unilaterally. **Recommended:** a 512 px WebP with a
PNG fallback, ~60–100 KB, a ~95% saving on the largest asset in the app. Say the
word and I will do it as its own change with before/after renders for you to
compare.

**The HTML is 1.69 MB** and is fully parsed before `init()` runs (~280 ms of the
cold start). That is inherent to the single-file architecture and not something
to change in a latency pass.

---

## 5. Ask Coach

| | ms |
|---|---:|
| open panel → painted | 23 |
| submit → tap handler returned | 7 |
| **submit → `Thinking…` painted** | **32** |
| thinking state visible | yes |
| submit → answer | 423 (400 of it the stub) |

**The interface was already reacting in 32 ms.** `askSend()` calls
`askSet('thinking', …)` before assembling the context and before the request,
and `.ask-thinking` is a real visible element with `role="status"
aria-live="polite"`. **No change was needed and none was made.**

So the ~4 s you experienced is **Anthropic's generation time**, not dead UI.
Two contributing factors, neither of which I changed:

- the call is **non-streaming**, so nothing can appear until the whole answer is
  generated;
- Opus 5 runs adaptive thinking by default (`effort: 'low'` is already set).

**The one change that would actually move this is streaming** — first tokens in
well under a second instead of a 4 s wall. That is a real change to the Ask
Coach transport and its rendering, so I have not done it in a pass whose brief
was "smallest fixes". If you want it, it is a well-scoped follow-up and I would
estimate it takes the *perceived* wait from ~4 s to under 1 s without changing a
word of what the coach says.

Two tests now pin the ordering so future growth in context assembly cannot get
in front of the loading state.

---

## 6. Hear Today

| | Before | After |
|---|---:|---:|
| tap → handler returned | 11 ms | 14 ms |
| tap → briefing painted | 26 ms | **19 ms** |
| briefing visible | yes | yes |
| **status while waiting** | **"Playing briefing…"** | **"Preparing voice…"** |
| tap → audio | 412 ms | 420 ms (400 the stub) |

The briefing already opened on the tap — that was the fix merged in `c9bff92`.
What was left was a **status line that lied**: it said *Playing briefing* while
the audio was still being fetched. On a slow connection you read "playing"
through two seconds of silence and reasonably conclude it is broken.

`voiceState` now carries a `phase`:

- **`preparing`** — request in flight. Card says *"Preparing voice…"*.
- **`playing`** — audio genuinely started. Card says *"Playing briefing…"*.

A **cache hit never shows preparing** (the audio is already in hand), and the
**native fallback never shows preparing** (the device engine starts instantly).
An existing `voiceSetStatus('speaking')` with no phase still means playing, so
nothing that predates this changed meaning.

The words are on screen throughout. **Stop stays responsive while preparing** —
it aborts the request, keeps the briefing visible, and audio arriving afterwards
does not start.

So the remaining ~4 s is **ElevenLabs generation + Vercel**, now honestly
labelled and, after the first play, eliminated entirely by the content-addressed
cache.

---

## 7. Logging

No timing logs were added to the client. The measurement harness lives in
`tools/perf/` and is a development tool, not shipped behaviour — it needs no
runtime instrumentation because the browser's own Performance API already
carries everything. The server's existing `voice: TTS ok ms=… chars=…` line
already gives you vendor latency in production.

A test asserts no `console.log` in the runtime carries a question, answer,
briefing, script line or anything an athlete typed.

---

## 8. Files changed

```
protected/velvet-viking-valhalla.html   font stylesheet off the critical path;
                                        voiceState.phase; "Preparing voice…"
test/latency.test.js                    NEW — 16 tests
tools/perf/measure.js                   NEW — the measurement harness
tools/shots/today-hierarchy-shots.js    a preparing frame, and a name filter
LATENCY-REPORT.md                       this file
```

No coaching content, methodology, prescription, Today hierarchy, voice wording
or Ask Coach intelligence was touched.

---

## 9. Tests

**Complete suite: 3005 pass / 0 fail** (2989 before; 16 new).

`test/latency.test.js` guards: the font stylesheet cannot return to the critical
path; `display=swap` and the fallback stacks survive; preconnect is kept;
`renderApp()` stays ahead of every optional service in `init()`; nothing is
awaited before the first render; *Preparing* vs *Playing* is honest in every
path including cache hit, native fallback and Stop; Ask Coach reaches its
thinking state before the request is opened; and no log line carries athlete
content.

Reverting the font link to a plain stylesheet **fails the guard**, verified.

### Two mistakes of mine, caught by my own tests

1. The `init()` ordering test read the string `cloudInit()` out of a *comment*
   sitting above `renderApp()` and reported a defect that did not exist. Fixed
   by stripping comments before reasoning about order — the same prose-matching
   trap this codebase has bitten me with before.
2. The font test matched the `<noscript>` fallback, which is a plain stylesheet
   deliberately. Scoped to the scripted path.

---

## 10. Summary

| Symptom | Cause | Status |
|---|---|---|
| Launch ~2 s | render-blocking font stylesheet blocking paint **and script execution** | **fixed** — 1140 ms → 124 ms first paint |
| Launch payload | 2.1 MB crest PNG | **reported**, needs your call on re-encoding the brand asset |
| Ask Coach ~4 s | Anthropic generation, non-streaming | **not ours** — UI reacts in 32 ms; streaming proposed as a follow-up |
| Hear Today ~4 s | ElevenLabs generation, mislabelled as "Playing" | **honesty fixed**; latency is real and cached after first play |
| Probes blocking startup | — | **investigated, not true**; ordering now pinned by test |

**Not merged. Awaiting your review.**
