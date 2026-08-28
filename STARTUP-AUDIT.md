# Opening Valhalla — startup audit

Audit only. **No behavioural change is proposed for merge here.** Branch
`claude/startup-audit` carries one dev-only measurement tool; nothing that
ships to an athlete is touched.

Measured against `main` @ `31e4a38`.

---

## The headline, first

**The app is re-downloading itself on every single launch, and it cannot open
at all without a network.** Both are consequences of one line.

`api/app.js` → `serveRuntime()`:

```js
res.setHeader('cache-control', 'private, no-store, must-revalidate');
```

`no-store` forbids the browser from storing the response **at all** — not in
disk cache, not in memory. There is nothing to revalidate, so there is no 304
path. The document is **1,754,938 bytes raw / 551,470 gzipped**, and it carries
all of the CSS and all of the JS inline. That is the whole app, over the wire,
every time.

The service worker cannot compensate, because it does no caching. `sw.js` says
so itself: *"No caching/offline behavior is implemented."* It exists only so
`registration.showNotification()` can fire the 08:00 reminder.

### The confirming test

Airplane mode after a successful online session, with a full 106-day plan in
localStorage:

```
document loaded : NO — the app does not open at all
failed requests : /
```

Not "opens without sync". **Does not open.** The athlete's plan is sitting in
localStorage on the device and is unreachable, because the shell needed to read
it has to be fetched first.

---

## What the audit did NOT find, which matters just as much

**The JavaScript startup is already cached-first and correct.** `init()` is:

```js
loadState();          // localStorage — measured at 0.3ms
...
renderApp();          // paints from local state
...
// "Deliberately last and un-awaited: the app is already painted from
//  localStorage by this point, so cloud sync can never delay startup and a
//  cloud failure can never prevent the app from opening."
cloudInit();
```

So of the five candidate causes:

| Category | Verdict |
|---|---|
| NETWORK-HYDRATION | **No.** Nothing is awaited before paint. |
| AUTH | **No.** `cloudInit()` is un-awaited and last. |
| RENDER-GATING | **No.** No loading gate, no auth gate, no `Promise.all`. |
| **STATIC-ASSET** | **Yes — primary.** `no-store`, 540KB, every launch. |
| **CPU / JS** | **Yes — secondary.** See below. |

The architecture the brief hopes for is already written. It is defeated one
layer below it, at the HTTP header.

---

## Measured timings

Chromium, 390px mobile emulation, real 16-week plan (106 days, 87KB of
localStorage).

| Condition | HTML | FCP | Interactive | Transferred |
|---|---:|---:|---:|---:|
| A cold first-ever | 16ms | — | 91ms | 540KB |
| B repeat launch | 13ms | — | **479ms** | 540KB |
| D reopen again | 10ms | — | 461ms | 540KB |
| F slow 3G (400kbps) | **11,330ms** | **11,756ms** | 11,759ms | 540KB |

**On a poor connection the athlete waits 11.8 seconds before anything appears.**
540KB at 400kbps is ~10.8s; the measurement matches the arithmetic, so this is
transfer time and not overhead.

### Where the 390ms difference between cold and repeat goes

| | |
|---|---:|
| `loadState()` | **0.3ms** |
| `renderApp()` | **296.8ms** |

localStorage is free. The cost is rendering a full plan — and this is a
desktop-class CPU. A mid-range Android is typically 3–5× slower single-core,
which puts the same work at roughly **0.9–1.5 seconds** on the device the
athlete actually holds, on every launch, *after* the download.

---

## Per-item cache audit

| Item | Cached locally | Mechanism | Fetched every launch | Blocks paint |
|---|---|---|---|---|
| HTML + all CSS + all JS | **No** | — (`no-store`) | **Yes, 540KB** | **Yes** |
| `/assets/builder-spec.js` | Yes | HTTP cache (static) | No | Yes (sync `<script>`) |
| Crest PNG (137KB) | Yes | HTTP cache | No | No |
| Fonts (Cinzel/Oswald/Inter/JetBrains Mono) | Yes | HTTP cache | No | **No** — `media="print"` + `onload` swap |
| App shell | **No** | — | **Yes** | **Yes** |
| Athlete profile / plan / days / settings | **Yes** | `localStorage` | No | No |
| Auth session | Yes | `localStorage` | No | No |
| Derived plan state | Rebuilt | in-memory | n/a | **Yes — 297ms** |

Fonts are already correct: loaded non-render-blocking via the `media="print"`
swap, and they are not a factor.

---

## Freshness and versioning already available

Enough exists to support a stale-while-revalidate startup safely: state carries
a schema version and is migrated on load (`migrateAthleteRecord()`), the cloud
reconcile path already distinguishes local from remote plans and resolves
conflicts, and `cloudStatus` already models sync state. The app can already
tell last-known-good from unknown; that is not the blocker.

---

## Classification

**MULTIPLE**, in this order:

1. **STATIC-ASSET BOTTLENECK — primary and severe.** `no-store` plus a
   non-caching service worker means the whole app re-downloads every launch and
   the app is unopenable offline.
2. **CPU / JS BOTTLENECK — secondary and real.** ~297ms of `renderApp()` on
   desktop, plausibly ~1s+ on a mid-range Android, after the download completes.

---

## Why the header is the way it is, and the real constraint

The comment in `api/app.js` is not careless — it is defending a real boundary:

> *"private, so no shared CDN or proxy ever holds a copy that could be served
> to someone who did not pass this check. no-store rather than a short max-age
> for the same reason: the document is personal to an entitled session even
> though its bytes are identical for everyone."*

That reasoning is sound about **intermediaries** and, by its own admission,
notes the bytes are identical for everyone. The entitlement decision is made by
the gate on each navigation; the document itself carries no per-athlete data.
So the question a change would have to answer is: *can the client be allowed to
keep a copy while no shared cache ever can?* That is what `private` already
says, and `no-store` additionally forbids the client. **Whether relaxing the
client half is acceptable is a security decision, not a performance one, and it
is the founder's to make** — I am not proposing it unilaterally.

---

## Target architecture, described not implemented

If the gate's requirement can be met by revalidating rather than re-sending:

```
launch
  └─ navigation to /api/app  → gate decides (unchanged, every launch)
        ├─ entitled + unchanged → 304, no body        (~1KB instead of 540KB)
        └─ entitled + changed   → 200 with new build
  └─ shell paints from the cached document
  └─ loadState() from localStorage           (0.3ms)
  └─ renderApp()                             (the remaining cost)
  └─ cloudInit() in background               (already the case)
```

Two candidate levers, independently useful:

1. **`ETag` + `private, max-age=0, must-revalidate`** — the gate still runs on
   every launch and still decides; only the body is skipped when the build has
   not changed. Preserves the boundary exactly as described; removes 540KB from
   every launch. **This is the high-value change.**
2. **Reduce `renderApp()`'s 297ms** — a separate, later pass; needs profiling
   to say what inside it costs the time, which this audit did not do.

Deliberately **not** proposed: IndexedDB, an offline mode, a caching service
worker, or any change to auth or Supabase queries. None of them is the
bottleneck, and the first lever likely makes the difference on its own.

### Expected improvement

Repeat launch on a poor connection: **~11.8s → well under 1s** for the shell,
since the 540KB transfer is what the measurement shows dominating. On a good
connection the visible gain is smaller (~490ms → ~300ms, bounded by
`renderApp()`), which is why the CPU item stays on the list.

Offline would still not work — that needs a caching service worker and is a
separate decision.

### Risks

- Relaxing `no-store` is a security-posture change and must be reviewed as one.
- A stale cached shell after a deploy: mitigated by `must-revalidate` — the
  client must check every time and cannot serve a stale build.
- `Vary: Cookie` is already set, which is what keeps one athlete's cached
  document from being reused across sessions.

---

## Honest limits of this audit

- **I could not demonstrate the cacheable counterfactual in-browser.** Two
  harness attempts failed to produce a conditional request in Playwright's
  Chromium, so the "540KB → 304" figure is derived from the HTTP spec and the
  code, not measured end to end. The `no-store` behaviour itself is not in
  doubt: it is a code fact plus the airplane-mode result.
- Timings are desktop-class Chromium under emulation, not a real Android
  handset. The direction and the dominant term are safe; absolute numbers on
  device will be worse, not better.
- `renderApp()`'s 297ms was measured but **not profiled** — I have not
  established what inside it is expensive.

---

## Recommendation

**Yes, an implementation branch is worth opening — for lever 1 only**, and only
once you have decided the security question about the client-side half of
`no-store`. That single change addresses the primary bottleneck and the
airplane-mode failure is the evidence for how total the current dependency is.

Lever 2 should be its own pass, after profiling.
