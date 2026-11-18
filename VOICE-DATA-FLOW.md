# Voice Coach — the data flow, stated precisely

Written because an earlier report said **"audio never leaves the device"**, and
once speech input is native that sentence is no longer provable on its own
terms. This document replaces it with what is actually true at each stage.

Nothing here is a policy proposal. It records what the code does.

---

## Why the earlier claim needed restating

Android's ordinary `SpeechRecognizer` is a front end to whatever recognition
service the phone has installed — on most devices, Google's. **That service may
send the audio to Google's servers**, depending on the device, the Android
version and whether offline language packs are present. An app calling it cannot
promise the audio stayed local.

A spoken question to a running coach is not neutral text. *"My calf is sore,
should I run?"* is health information, and routing it to a third-party service
is a sub-processor decision, not an implementation detail.

**So Sacoro asks for the on-device recogniser only.** Where Android exposes
one (`SpeechRecognizer.isOnDeviceRecognitionAvailable()` /
`createOnDeviceSpeechRecognizer()`, API 31+) it is used. Where the phone has
none, speech input is **refused** and the athlete types instead — the microphone
is not drawn at all, and one line says why. `requireOnDevice` is asserted on both
sides of the bridge, and a test holds each side.

---

## Stage by stage

| Stage | Processor | Leaves the device? | Persisted? | Logged? | Consent | On failure |
|---|---|---|---|---|---|---|
| **Raw microphone audio** | Android's **on-device** recogniser only, via `VvvSpeechPlugin` | **No** — the networked recogniser is refused, not preferred-against | No. Sacoro never opens an audio stream; `onBufferReceived` is deliberately empty | No | Runtime `RECORD_AUDIO`, asked at the press | No transcript; typed path remains |
| **Transcript** | Sacoro, in the WebView | Only as the question text, to Sacoro's own server | **No** — held in memory for the exchange, never written to `localStorage` or the plan. **Exception, only if the athlete turns on Coach Memory:** after a real answer, the question is kept as one line ("Asked: …", at most 200 characters) in `coach_memory` — see below | **No** — never in logcat, never in a server log | Shown to the athlete before it is sent | Athlete retypes or edits |
| **Coach Memory** (off by default) | Sacoro's server (`/api/coach-memory`), Supabase | Yes — to Sacoro's own server and database; read back to the model as background | **Yes, if turned on:** one line per decision or question in `coach_memory`, newest 100 kept, readable and clearable in Settings, deleted with the account, health lines erased on request, included in the account export | No — counts and fixed reason codes only | Its own consent sheet; health lines only with health consent; nothing from Strava; run notes never stored verbatim | Nothing kept; Ask Coach answers as it would without memory |
| **Model context** | Assembled in the browser, sent to `/api/voice-ask` | Yes — HTTPS to Sacoro, then to Anthropic | No | No — server logs carry fixed reason codes and counts only | Health fields omitted entirely without consent; Strava-derived evidence excluded by provenance | Refused, athlete keeps written coaching |
| **Model response** | Anthropic (`claude-opus-5-5`) | Returns over HTTPS | No | No — only a character count | — | Human message, written coaching untouched |
| **Spoken output** | Android `TextToSpeech` (`@capacitor-community/text-to-speech`) or the browser's own synthesiser | **No** — local engine, no cloud TTS anywhere in the repo | No | No | — | Text is shown instead |

**Remembered lines reach the model as background, never instructions.** At
most eight, re-checked on the server (length, no Strava, nothing shaped like an
instruction, health lines only when the conversation has health information),
placed after the training context under a label that says so, and named in the
system prompt as background only. The same lines go to Ask Coach, the run, week
and Recovery Check explanations, and the Coach's Note. None of `_voice-ask.js`,
`_voice-explain.js` or `_voice-note.js` reads the table: the browser sends the
lines, and the pure rules in `api/_coach-memory-lines.js` fence them.

**A reason for a decline is a fixed code, never free text.** After the athlete
turns a suggestion down, with Coach Memory on, four optional chips (Legs Tired,
Short on Time, Too Big a Jump, Feeling Fine) send a code that the server turns
into a fixed phrase on the decision line ("..., week 5: short on time."). Legs
Tired is kept only with health consent on both sides; without it the decision is
kept without the reason.

**Anthropic receives text only.** No audio, in any encoding, reaches the model
endpoint — asserted by test against both the plugin and the server module.

---

## What is still the founder's decision

**Enabling the networked recogniser.** Today a phone with no on-device
recognition simply cannot use the microphone in Sacoro. Allowing the ordinary
`SpeechRecognizer` would make speech work on many more devices, at the cost of
the athlete's spoken words — possibly including health information — reaching
the device's speech service provider.

That is a privacy and sub-processor decision, with consequences for the privacy
notice and the Play Data Safety declaration. It is **not** taken here. If it is
ever taken, the change is small and localised: `requireOnDevice` in
`askStartListeningNative()` and the matching guard in `VvvSpeechPlugin.listen()`.

---

## Unchanged by this work

The Strava provenance boundary and the Article 9 context rules are untouched.
The spoken question is **athlete input** and does not become Strava-derived
because the athlete uses Strava; the evidence assembled to answer it is still
filtered per item, and a Strava-derived day, a Strava-influenced plan change and
a pace-relative conclusion descending from a Strava-anchored fitness reading are
all still withheld.
