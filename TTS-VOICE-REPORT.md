# ElevenLabs Premium TTS + Coach Voice Selection

Branch `claude/elevenlabs-voice`, cut from `main` @ `fbfc12d`.
**Not merged. Held for founder review.**

**The voice is NOT green.** Nothing below is a claim that Molly sounds right on
your phone — that is §11, and only you can close it.

---

## 1. Model and endpoint

| | |
|---|---|
| **Endpoint** | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128` |
| **Auth header** | `xi-api-key` |
| **Model** | **`eleven_multilingual_v2`** |
| **Output** | `mp3_44100_128` |
| **Voice settings** | `stability 0.5, similarity_boost 0.8, style 0, use_speaker_boost true` |
| **Override** | `VVV_TTS_MODEL` — repointable without a code release |

### Why this model, checked against current documentation rather than memory

I could not reach `elevenlabs.io` directly — **the session's egress proxy blocks
that domain** — so the line-up was established from current secondary sources
dated August 2026 and cross-checked across four of them. As of now the TTS
line-up is three models: `eleven_v3`, `eleven_multilingual_v2`,
`eleven_flash_v2_5` (plus the superseded `eleven_turbo_v2_5`). No model has
shipped after `eleven_v3`, which went GA on 2 February 2026.

| Model | Why not / why |
|---|---|
| `eleven_flash_v2_5` | Fastest (~75 ms) and half the credit cost, but it is the speed-first tier and trades exactly the prosody this change exists to buy. Rejected: we are replacing a robotic voice, not a slow one. |
| `eleven_turbo_v2_5` | ~300 ms, "good balance" — but ElevenLabs' own guidance is to prefer Flash over Turbo in all cases. Superseded. |
| `eleven_v3` | Best expressive range, and documented as having higher latency and cost per character and being **unsuitable for real-time or conversational use**. It is also the most variable between generations, which is the wrong property for a coach who should sound the same on Tuesday as on Monday. Rejected on latency and consistency, not on quality. |
| **`eleven_multilingual_v2`** | **Chosen.** The production English quality tier — "proven range" — at the same 1 credit/character as v3, with lower latency, a 10,000-character request ceiling, and stable output. A briefing is ~270 characters of factual coaching containing paces that must be pronounced correctly; that is a narration job, not a performance. |

**This is a judgement, and it is cheap to revisit.** `VVV_TTS_MODEL` exists
precisely so you can set it to `eleven_v3` in Vercel, listen, and decide,
without a deploy. I would rather you A/B it on your own ear than take my
reading of a table.

---

## 2. Architecture

```
Valhalla engine  →  voiceBriefingScript()  →  /api/voice-tts  →  ElevenLabs  →  <audio>
(deterministic,      (the exact words,        (server, holds       (renders          (device)
 on the device)       already approved)        the credential)      only)
                                   │
                                   └── on ANY failure ──→ voiceSpeakNative() → Android TTS
```

ElevenLabs is a **loudspeaker, not a coach**. It is never asked what to say,
never asked to rephrase, shorten or improve. The words are composed by the
engine's own arithmetic on the device before the route is reached.

This is the same line drawn around the model in `_voice-ask.js`, and drawn for
the same reason: an earlier pass of the spoken briefing sent the assembled
lines to a model for "a conversational rephrasing" and was removed, because a
paraphrase that quietly drops *"Watch for racing it"* passes every guard while
changing the coaching the athlete receives.

**Ask Coach is untouched.** It still reasons through Anthropic (`claude-opus-5`),
and a test asserts the speech vendor never appears in that path.

### A boundary that had to move, honestly

Three existing tests asserted **"no cloud TTS endpoint exists anywhere"** and
**"the narration half reaches no endpoint"**. Your brief reverses the first.
I did not delete them — I worked out what each was *protecting* and asserted
that instead:

- *"No cloud TTS anywhere"* → **the vendor endpoint is named in exactly one
  file in `api/`, never in the browser, and no second vendor appeared beside
  it.** Plus a new test that the credential and the voice ids are absent from
  the runtime.
- *"The narration half reaches no endpoint"* → the region boundary moved from
  the whole Voice Coach to **composition only**. Deciding *what* the coach says
  still reaches nothing; *delivering* it may now reach a vendor. The invariant
  those tests existed for — no network answer can change the coaching — is now
  asserted more precisely than before.

The old rationale comment in the runtime argued *against* a cloud voice. It is
rewritten rather than deleted: it records what the objection was, which half of
it was real, and what makes the decision safe.

---

## 3. Privacy and data flow

**What leaves the device:** `{ text, voice }` — the final approved briefing
sentences, and a voice key like `"molly"`.

**What leaves the server for ElevenLabs:** `{ text, model_id, voice_settings }`.
Asserted key-by-key by test, with a deliberately poisoned request carrying an
athlete id, a plan, a heart rate, a readiness object, a Strava payload and a
conversation — every one of which must be absent from the outbound body.

**Never sent:** athlete identity, plan, training history, heart rate, readiness,
RPE, feel, Strava payload of any kind, Ask Coach conversation, raw audio, any
credential.

**The Strava fence is unmoved.** A Strava-derived day already refuses the
briefing whole at the card, so it never reaches speech — asserted directly.
`aiEligibleDays()` and the Article 9 health-consent fence both run on the
device, before the briefing text exists.

**Logging** — `voice: TTS ...` lines carry only: outcome, fault class, latency,
character count, byte count, voice key, model id. A test drives a success and a
`429` through the route with `console.log` captured and asserts the key, the
briefing text and the athlete id appear in none of it, while the operational
facts do.

`ENVIRONMENT.md` documents all six new variables and states plainly that voice
ids are not secrets and the API key is.

---

## 4. Fallback

Hear Today cannot be taken away by a vendor. Every one of these ends with the
athlete hearing the same words in the device's own voice:

| Condition | Behaviour |
|---|---|
| No `ELEVENLABS_API_KEY` | 503 → client latches → native, **one request for the whole session** |
| Signed out | never asks → native |
| Provider error (401/429/5xx) | 502 → native |
| Timeout (8 s) | abort → native |
| Empty audio | treated as failure → native |
| Network down | native |
| No `AbortController` (old WebView) | one wasted request, then native — and Stop still silences it |

**Nothing was removed.** `voiceSpeakNative()` is the previous `voiceSpeak()`
body, unchanged; a test fails if the Android bridge or the Web Speech path
disappears. No manual switch, no setting, no athlete action.

One deliberate consequence: `voiceAvailable()` now also counts the cloud, so a
device with no speech engine is offered **"Hear today"** rather than
**"Read today"** — and if that voice fails, native is tried and the words are
shown, so the label's promise is still kept.

---

## 5. Latency and cost control

- **Bounded**: 8 s timeout via `AbortController`.
- **No retry.** A retry doubles the cost of a bad minute and delays the fallback
  the athlete can actually hear. Native TTS is already on the phone and is a
  better answer than a second attempt.
- **No polling.** Nothing probes; the first press is the only discovery.
- **Latched failure** for an unconfigured deployment — one 503, then silence
  from the network for the rest of the session.
- **Auth required**, so synthesis cannot be billed by an anonymous caller.
- **1200-character ceiling**, refused before spending.
- **Closed voice catalogue resolved server-side** — a caller sending a voice
  *id* rather than one of our four keys gets Molly, so nobody can bill this
  account for synthesis with an arbitrary or cloned voice.

---

## 6. The content-addressed cache

**Identity is content, never date.** The key is a hash of:

| Input | Where |
|---|---|
| the exact approved spoken text | both |
| the resolved voice id | both |
| the TTS model id | server |
| the output format | server |
| the voice settings | server |

**Guidance Level needs no separate term.** It, the session type, the athlete's
paces and every adaptive decision reach this layer *only as words*. Hashing the
words covers all of them — there is no second input that can change the audio
without changing the text. Change the briefing or the voice and the key changes
with it, automatically.

Two caches, no persistence:

- **Client, in memory** — the one that saves the money. A hit never opens a
  request at all. 8 entries, 30-minute TTL, expiry enforced on read as well as
  insert, object URLs revoked on eviction.
- **Server, in memory, per instance** — 24 entries, 30-minute TTL, LRU. Catches
  a reload or a second device, and is where **concurrent presses collapse into
  one vendor request**.

**Opaque keys**: SHA-256 hex (server), 128-bit (client). No athlete identifier
and no briefing text goes into either — asserted.

**Nothing is written to disk, to a database, or to athlete storage.** Tested:
the route imports no `fs` and reaches no database, and the runtime never writes
a blob URL into storage. There is no archive of athlete coaching audio anywhere
in this design.

### Estimated ElevenLabs requests avoided

Assumptions stated so you can disagree with them: 10 beta athletes, ~2.5 Hear
Today presses per athlete per day on an unchanged briefing, ~270 characters per
briefing, 1 credit/character on `eleven_multilingual_v2`.

| | Without cache | With cache | Avoided |
|---|---|---|---|
| Hear Today, per day | 25 requests | 10 | **60%** |
| Hear Today, per 30 days | 750 req / ~202k chars | 300 req / ~81k chars | **~121k characters** |
| Settings previews (4 voices, ~2 taps each, 10 athletes) | ~80 requests | 4–40 | **50–95%** |

Previews are the strongest case: the preview sentence is a **fixed literal,
identical for every athlete**, so the server key is shared across accounts and a
warm instance can serve the entire beta from four generations. The 4–40 range is
honest about instance churn — see §7.

---

## 7. Caching recommendation

**In-memory caching: done, in scope, tested. Persistent caching: a separate
change, and I recommend deferring it.**

The server cache is per-instance and ephemeral. Vercel gives no guarantee a
second request reaches the same warm lambda, so cross-request server hits are
best-effort — that is why the preview saving is a range and not a number. The
**client** cache is the one that reliably pays for itself, and it is complete.

Persistent caching (Vercel Blob or Supabase Storage) would close the gap, and it
is a different kind of change with a different review:

- it creates **stored athlete coaching audio**, which your brief explicitly
  gates behind "an explicit reason and review";
- it needs a retention and deletion policy, and a line in the account-deletion
  and data-export paths;
- it needs the privacy notice to say the audio is stored, not merely generated;
- it needs bucket auth so audio is not publicly addressable by its hash.

None of that is hard; all of it is a decision rather than an implementation.
**The identity boundary is already correct and already tested**, so a persistent
tier can be added later purely as a storage backend behind the same key — no
re-design, no risk of Harry being served Molly's audio.

---

## 8. Coach Voice selection

Molly is the default. Existing athletes with no stored preference resolve to
Molly. A missing, unknown, corrupt or non-string stored preference resolves to
Molly at **both** ends independently — the client refuses to store it and the
server refuses to honour it.

The control is in **Settings → Preferences & Notifications**, beneath Coaching
detail, because it is a presentation preference and that is where presentation
preferences live. It uses the **existing circular cherry selection component** —
it joins `.day-check input, .wd-check input` as a third member of the same CSS
rule rather than opening a second definition of "circular, cherry, selected".
The screenshot harness resolves the fill from the live stylesheet: `50%` radius,
`rgb(83,45,58)` light / `rgb(154,84,108)` dark.

Radios in one `role="radiogroup"`, so assistive technology hears that one voice
is in force. Every row is a 44px tap target.

**Preview** speaks one fixed Valhalla sentence, identical for every voice, so
they are compared on the same words: *"Easy today. Keep it conversational, and
save the hard running for the sessions built for it."* It is a literal in the
source. It calls no coaching endpoint and no model — asserted — and it does not
change the stored selection.

Switching voice takes effect on the **next playback**: `coachVoice()` is read at
the moment of the press. No restart, no new programme, no sign-in.

**It changes nothing else.** A test snapshots `coachBrief`, the disclosure,
resolved Guidance Level, the day's targets and the prescription, then cycles all
four voices and requires the snapshot to be byte-identical; another requires the
briefing text handed to TTS to be identical across all four.

---

## 9. Files changed

```
api/_voice-tts.js                    NEW — the whole server half
api/voice.js                         registers voice-tts on the existing router
vercel.json                          the rewrite (without it the route 404s)
protected/velvet-viking-valhalla.html
                                     coach voice catalogue + persistence;
                                     cloud speech with cache/dedup/abort;
                                     voiceSpeak splits into premium + native;
                                     voiceStop halts playback and the request;
                                     Settings COACH VOICE row + shared CSS;
                                     the on-device-only rationale rewritten
ENVIRONMENT.md                       six new variables, documented
test/voiceTtsServer.test.js          NEW — 31 tests
test/coachVoiceSelection.test.js     NEW — 36 tests
test/voiceNativeAndroid.test.js      the vendor-boundary contract, rewritten
test/voiceSpokenRegister.test.js     composition-reaches-no-network, narrowed
test/voiceAskCoach.test.js           same
test/builderTrainingDayCircles.test.js
                                     the shared circle component gained a third member
tools/shots/coach-voice-shots.js     NEW — 24 images + measurement
TTS-VOICE-REPORT.md                  this file
```

**One serverless function was NOT spent.** `/api/voice-tts` joins the existing
`api/voice.js` router — the deployment stays at its current function count,
which matters because Strava once failed to deploy at all on that limit.

---

## 10. Tests

**Complete suite: 2972 pass / 0 fail** (2905 before; 67 new).

Targeted, all green:

| Suite | Tests |
|---|---|
| `voiceTtsServer` | 31 |
| `coachVoiceSelection` | 36 |
| `voiceNativeAndroid` | 31 |
| `voiceAskCoach`, `voiceSpokenRegister`, `voiceCoach`, `voiceFirstRender`, `voiceLiveDefects`, `voiceStravaProvenance` | all pass |
| `productionReadiness` (env inventory) | 24 |

Everything you asked to be proved, is: ElevenLabs primary when configured;
voice id from server config; the key absent client-side; only the final briefing
sent; native fallback; timeout falls back; provider error falls back; Stop
cancels; repeated taps make no storm; Strava/privacy boundaries intact; no
coaching logic changed. Plus Molly default, all four selectable, persistence,
invalid preference safe, cache identity cannot collide across voices, and
Preview never invokes Ask Coach.

### Three defects my own tests caught, and what they were

1. **`withEnv` restored the environment before the async route read it** — the
   same async/`finally` trap as an earlier workstream. Every server test was
   silently exercising the *unconfigured* path and passing for the wrong reason.
   Fixed with a separate `withEnvAsync`, with a comment saying why both exist.
2. **`String(['harry']) === 'harry'`**, so a JSON array could select a voice.
   Harmless today; exactly the accidental surface that stops being harmless when
   the catalogue grows. `resolveVoiceKey` now requires a string.
3. **Two of my own tests were measuring the wrong moment** — one aged the cache
   using the test realm's clock while the app runs on a pinned one, the other
   pressed Stop before the request existed. Both fixed in the test, not the code.

---

## 11. What needs you, on the device

**I cannot mark the voice green and I am not going to.** These need your ears
and your phone:

1. **Set nothing new.** `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are
   already in Production. The three extra voice-id variables are optional —
   the built-in catalogue already carries Joanna, Harry and Andrew.
2. Deploy this branch and **press Hear Today on the installed Android app.**
   Confirm it is Molly and not the platform engine.
3. **Judge the model.** If Molly reads the paces flatly, set
   `VVV_TTS_MODEL=eleven_v3` in Vercel, redeploy, listen again. No code change.
4. **Airplane mode, then Hear Today** — confirm it still speaks, in the device
   voice, with the same words.
5. **Press Stop mid-briefing**, and press Hear Today twice quickly — confirm
   no overlap and no double playback.
6. **Settings → Coach voice**: preview all four, select one, return to Today,
   press Hear Today, confirm the voice changed and the words did not.
7. Read one `voice: TTS ok ms=... chars=...` line in the Vercel log and confirm
   the latency is acceptable on a real connection.

Item 2 is the one that decides whether this was worth doing.

---

## 12. Risk

Moderate, and bounded by the fallback. No engine, prescription, Strava path,
consent or provenance logic was touched. The realistic failure modes are
**cost** (bounded by auth, the character ceiling, no-retry, the closed catalogue
and the cache) and **an unpleasant voice** (an env change away). The worst
credible outcome is that Hear Today sounds exactly as it does today.

The one behaviour change beyond speech is the `voiceAvailable()` widening in §4.

**Not merged. Awaiting your review.**
