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

**So Valhalla asks for the on-device recogniser only.** Where Android exposes
one (`SpeechRecognizer.isOnDeviceRecognitionAvailable()` /
`createOnDeviceSpeechRecognizer()`, API 31+) it is used. Where the phone has
none, speech input is **refused** and the athlete types instead — the microphone
is not drawn at all, and one line says why. `requireOnDevice` is asserted on both
sides of the bridge, and a test holds each side.

---

## Stage by stage

| Stage | Processor | Leaves the device? | Persisted? | Logged? | Consent | On failure |
|---|---|---|---|---|---|---|
| **Raw microphone audio** | Android's **on-device** recogniser only, via `VvvSpeechPlugin` | **No** — the networked recogniser is refused, not preferred-against | No. Valhalla never opens an audio stream; `onBufferReceived` is deliberately empty | No | Runtime `RECORD_AUDIO`, asked at the press | No transcript; typed path remains |
| **Transcript** | Valhalla, in the WebView | Only as the question text, to Valhalla's own server | **No** — held in memory for the exchange, never written to `localStorage` or the plan | **No** — never in logcat, never in a server log | Shown to the athlete before it is sent | Athlete retypes or edits |
| **Model context** | Assembled in the browser, sent to `/api/voice-ask` | Yes — HTTPS to Valhalla, then to Anthropic | No | No — server logs carry fixed reason codes and counts only | Health fields omitted entirely without consent; Strava-derived evidence excluded by provenance | Refused, athlete keeps written coaching |
| **Model response** | Anthropic (`claude-opus-5`) | Returns over HTTPS | No | No — only a character count | — | Human message, written coaching untouched |
| **Spoken output** | Android `TextToSpeech` (`@capacitor-community/text-to-speech`) or the browser's own synthesiser | **No** — local engine, no cloud TTS anywhere in the repo | No | No | — | Text is shown instead |

**Anthropic receives text only.** No audio, in any encoding, reaches the model
endpoint — asserted by test against both the plugin and the server module.

---

## What is still the founder's decision

**Enabling the networked recogniser.** Today a phone with no on-device
recognition simply cannot use the microphone in Valhalla. Allowing the ordinary
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
