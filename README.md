# velvet-viking-valhalla-2
Running training

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
| `icon.png` | Favicon / apple-touch-icon / notification icon / OG image | Master losslessly pillarboxed onto a square black canvas (no crop) |
| `icon-foreground.png` (+ per-density `android/.../mipmap-*/ic_launcher_foreground.png`) | Android adaptive-icon foreground layer | Same square-pillarbox as `icon.png`, resized per density — the adaptive-icon XML (`mipmap-anydpi-v26/ic_launcher.xml`) already wraps it in `<inset android:inset="16.7%">`, so no manual safe-zone padding is baked in here |
| `icon-background.png` (+ per-density `ic_launcher_background.png`) | Android adaptive-icon background layer | Solid black — brand-agnostic, not crest-derived, unrelated to the master |
| Per-density `ic_launcher.png` / `ic_launcher_round.png` (legacy pre-Android-8 launcher icon) | Legacy launcher icon | Master's circular emblem only (ring/axes/wheel/"VELVET VIKING"/"VALHALLA AWAITS" — no "EARN YOUR PLACE" line, illegible at 36–192px regardless), composited onto solid black with the same 16.7% inset as the adaptive icon, at each legacy resolution |

**`icon.png`, `icon-foreground.png` and all launcher icons are currently
STALE** — they were derived from the master's previous (solid-canvas)
version and dimensions, not from the current transparent master. Regenerate
them from the current master with the same pillarbox process before relying
on them for anything beyond what's already shipped; a side-by-side at
32/48/96/180px (in the brand-asset task history) shows the illegibility
below ~48px is unchanged either way, so this isn't urgent, just outstanding.
`velvet-viking-valhalla.html`'s inline base64 apple-touch-icon (in its
`<head>`, not a file under `assets/`) is separately stale for the same
reason.

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
