# velvet-viking-valhalla-2
Running training

## Tests

`npm test` runs a deliberately small, targeted regression suite — not broad
coverage of the app. It exists to protect the coaching-decision invariants
that would be dangerous or hard to notice by eye if they silently regressed,
and the RC1 fix that keeps a regenerated plan from erasing logged history:

- `test/harness.js` loads `protected/velvet-viking-valhalla.html`'s inline `<script>`
  into a sandboxed Node VM (stubbed `document`/`window`/`localStorage`) so
  tests call the app's real functions without a browser or a build step.
- `test/fixtures.js` builds a real plan through the app's own
  `buildBlockWeeks`/`buildDaysFromWeeks`, mirroring `handleGeneratePlan()`,
  so fixtures exercise the same pace-zone/prescription machinery the app
  relies on rather than a hand-rolled shape that could quietly diverge from it.
- `test/computeExecutionScore.test.js` — the Execution Score's distance/pace
  weighting, HR/RPE reweighting when data is missing, and the abandoned-session
  cap (a partial-distance session must never read as a fully good one).
- `test/buildBlockWeeks.test.js` — periodisation invariants: race week is
  always last, peak volume follows the distance profile, cutback weeks are
  lighter than the week before them, taper decreases toward the race.
- `test/evolutionChanges.test.js` — the cheapest-first adaptation hierarchy
  and its floor: a key session is shortened, never removed; race/checkpoint
  days and already-adjusted days are never touched again.
- `test/coachDecision.test.js` — insufficient evidence never manufactures a
  state, a single weak signal doesn't reach MODIFY, two independent
  corroborating signals do, repeated pain reports trip the RECOVER safety
  threshold, positive execution alone never escalates, and a hot/humid
  session is attributed to conditions rather than misread as pain or illness.
- `test/reconcileRegeneratedDays.test.js` — the RC1 history-preservation fix
  itself: a completed day survives a regenerate that changes the whole
  schedule, with its logged actuals intact; untouched future days are still
  fully replaced; no two days in the merged result ever share a date; and
  preserved history is never pulled into an unrelated week's card by a
  coincidentally-matching old week number.

## Brand assets

`assets/velvet-viking-crest.png` is the canonical Velvet Viking crest —
the single master asset (identical to the website repo's
`public/brand/velvet-viking-crest.png`). Approved wording:

```
VELVET VIKING
VALHALLA AWAITS
EARN YOUR PLACE
```

An earlier "RUNNING PROGRAMS" crest variant is retired and must not be
reintroduced. Everything else under `assets/` is a **generated derivative**
of this master, not a competing master — don't hand-edit them independently
of it:

| File | Purpose | How it's derived |
|---|---|---|
| `velvet-viking-crest.png` | Canonical master | — |
| In-app hero (`<img class="medallion-img">` in `velvet-viking-valhalla.html`, and `get.html`'s install-page medallion) | Full crest, unmodified | Same file, referenced directly |
| `icon.png` | Favicon (`get.html`) / notification icon / OG image | Master losslessly pillarboxed onto a square black canvas (no crop). **Current** — regenerated from the transparent master. |
| `apple-touch-icon.png` (180×180) | Apple touch icon (both `velvet-viking-valhalla.html` and `get.html`) | Same pillarbox as `icon.png`, resized to 180×180. **Current.** Replaces a ~16KB inline base64 blob that used to sit in `velvet-viking-valhalla.html`'s `<head>` — that blob was never actually crest-derived (see note below), so this is both a freshness fix and a page-weight cleanup. |
| `icon-foreground.png` (+ per-density `android/.../mipmap-*/ic_launcher_foreground.png`) | Android adaptive-icon foreground layer | Same square-pillarbox as `icon.png`, resized per density — the adaptive-icon XML (`mipmap-anydpi-v26/ic_launcher.xml`) already wraps it in `<inset android:inset="16.7%">`, so no manual safe-zone padding is baked in here. **STALE, deliberately not regenerated** — see below. |
| `icon-background.png` (+ per-density `ic_launcher_background.png`) | Android adaptive-icon background layer | Solid black — brand-agnostic, not crest-derived, unrelated to the master. Not stale (never tied to the master). |
| Per-density `ic_launcher.png` / `ic_launcher_round.png` (legacy pre-Android-8 launcher icon) | Legacy launcher icon | Master's circular emblem only (ring/axes/wheel/"VELVET VIKING"/"VALHALLA AWAITS" — no "EARN YOUR PLACE" line), composited onto solid black with the same 16.7% inset as the adaptive icon, at each legacy resolution. **STALE, deliberately not regenerated** — see below. |

**Android launcher icons (adaptive + legacy, all densities) are deliberately
still on the previous master, pending a design decision.** Rendered at their
actual ~48dp home-screen size, the full crest — even cropped to just the
circular emblem — is illegible (confirmed visually, not assumed) regardless
of which master backs it, so regenerating from the current master would not
fix anything and updating some densities but not others would just trade one
inconsistency for another. This needs a purpose-built small-format mark, not
a re-crop of the full crest; do not create one without an explicit go-ahead,
and do not silently ship a re-crop that fails the same legibility test the
current one does.

**`velvet-viking-valhalla.html` also has a separate, pre-existing inline SVG
favicon** (`<link rel="icon" type="image/svg+xml">`) — three overlapping gold
"V" blades on a dark rounded square. It is **not derived from the crest at
all** (a distinct abstract mark, not a simplified crest), predates this
brand-asset work, and was left untouched here since replacing or extending
its use is a design decision outside a straight "regenerate from master"
pass. `get.html` has no equivalent and falls back to `icon.png` for its own
favicon — fine for apple-touch/OG size, still illegible at literal
browser-tab favicon size, same known limitation as the Android icons above.

## Strava integration setup

The "Connect Strava" flow uses a serverless function (`api/strava-auth.js`) so
the Strava Client Secret never reaches the browser. For it to work, set these
in the Vercel project's **Settings -> Environment Variables** (Production, and
Preview if you want it working on preview deploys too), then redeploy:

- `STRAVA_CLIENT_ID` — from your app at [strava.com/settings/api](https://www.strava.com/settings/api)
- `STRAVA_CLIENT_SECRET` — from the same page

In that Strava API app's settings, set **Authorization Callback Domain** to
the deployed domain (`velvet-viking-valhalla-1.vercel.app`), with no
`https://` prefix and no path — Strava only lets you register a bare domain.
