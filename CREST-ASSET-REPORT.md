# Crest — Mobile Delivery Asset

Branch `claude/crest-asset`, cut from `main` @ `83e5ba6`.
**Not merged. The production reference is unchanged — nothing ships until you choose.**

The canonical master `assets/velvet-viking-crest.png` is **untouched** and stays
the master. This produced delivery variants beside it and measured them.

---

## 1. What the problem actually is

| | |
|---|---|
| Master file | `assets/velvet-viking-crest.png` |
| Intrinsic | 1223 × 1286, RGBA 8-bit, no palette, non-interlaced |
| Size | **2,100,661 bytes (2051 KB)** |
| Rendered by | `.medallion-img { width:180px; max-width:60%; height:auto }` |
| Rendered at | **180 CSS px**, `loading="eager"` |

At 180 CSS px a 3× phone draws **540 device pixels**. The master is 1223 wide,
so **more than three quarters of every pixel downloaded is discarded before it
reaches the screen** — on the first screen of the app, on mobile data.

It blocks no paint (it is an `<img>`), but it is the largest single asset in the
product and it dominates largest-contentful-paint.

---

## 2. Every format measured

Downscaled with Lanczos3 (the right filter for fine gold linework — a box
filter softens the runes). All variants preserve the alpha channel.

**Quality is measured composited over the app's real backgrounds**
(`#151417` dark, `#F4F1EA` light) against the master resized to the same size
with no codec applied — so the number is *codec loss only*, with resize held
constant.

### At 540 px (covers a 3× phone exactly)

| Variant | Size | Saving | PSNR | Max channel delta |
|---|---:|---:|---:|---:|
| **master (1223 px)** | 2051 KB | — | — | — |
| PNG (truecolour) | 447 KB | 78.2% | lossless | 0 |
| WebP lossless | 307 KB | 85.0% | **lossless** | 0 |
| **PNG-8 palette (q100)** | **137 KB** | **93.3%** | **42.6 dB** | 49 |
| AVIF q90 | 100 KB | 95.1% | 41.5 dB | 29 |
| WebP q90 | 89 KB | 95.7% | 33.2 dB | 81 |
| **AVIF q80** | **69 KB** | **96.6%** | **38.2 dB** | 45 |
| AVIF q65 | 42 KB | 97.9% | 34.7 dB | 72 |
| AVIF q50 | 27 KB | 98.7% | 31.9 dB | 102 |

At 360 px (2× phones): PNG-8 63 KB, WebP q88 44 KB, AVIF 22 KB.

**WebP lossy plateaus around 33 dB** on this artwork however far the quality
dial is pushed — it does not handle the gold gradient over the navy field well.
AVIF is dramatically better per byte, and palette PNG is better still.

### A measurement trap worth recording

My first pass compared raw RGBA and reported WebP **lossless** at "RMSE 12,
max delta 255" — impossible. The cause: RGB values under **fully transparent
pixels** are arbitrary and invisible, and I was averaging them in. Every number
above is composited over the real background first, which is what the eye
actually receives. Corrected, WebP lossless measures exactly 0.

---

## 3. Rendered comparison

`tools/assets/crest-candidates/`

- `comparison-zoom-dark.png` — master / PNG-8 / AVIF q80 / WebP q90, the
  "VALHALLA AWAITS — EARN YOUR PLACE" band at **3× nearest-neighbour zoom**,
  which is where palette banding and codec ringing would appear first. They are
  indistinguishable. No banding in the gold gradient, no ringing on the
  letterforms, the navy field texture intact.
- `comparison-app-dark.png` / `comparison-app-light.png` — the crest **as the
  app renders it**, at 390 px viewport, DPR 3, both themes.
  Left: current 2051 KB. Right: candidate 137 KB.

Measured in the app, not asserted:

| | Current | Candidate |
|---|---|---|
| Rendered size | 180 × 189 CSS px | **180 × 189 CSS px** |
| Intrinsic | 1223 × 1286 | 540 × 568 |
| Bytes over the wire | 2051.4 KB | **137.4 KB** |
| Rendered-pixel PSNR vs current | — | 33.0 dB dark / 32.6 dB light |

**No layout shift.** The aspect ratio is 0.9510 → 0.9507, identical to three
decimal places, so the `width`/`height` attributes still describe it correctly.
Transparency preserved, no branding or colour regression in either theme.

---

## 4. Recommendation

**Ship the 540 px palette PNG as a straight `src` swap.**

`tools/assets/crest-candidates/velvet-viking-crest-540.png` — **137 KB, a
93.3% reduction**, the *highest measured quality of any lossy option* (42.6 dB,
better than AVIF q90), universal browser support, and a one-line change with no
`<picture>` element, no format negotiation and no browser-support question.

That is the smallest change that gets the dramatic reduction you asked for.

**If you want the last 68 KB**, a `<picture>` with AVIF first and the PNG as
fallback takes it to **69 KB (96.6%)**:

```html
<picture>
  <source srcset="/assets/velvet-viking-crest-540.avif" type="image/avif">
  <img class="medallion-img" src="/assets/velvet-viking-crest-540.png"
       width="540" height="568" alt="…" loading="eager">
</picture>
```

AVIF is supported by Android WebView from Chromium 85 and iOS 16+, and the
`<img>` fallback covers anything older, so it is safe — it is simply more
markup for 68 KB. My recommendation is the plain PNG swap; the AVIF file is
committed so you can take the second step whenever you want it without
regenerating anything.

**I do not recommend WebP here.** It measures worse than the palette PNG at
similar size on this specific artwork.

### What I have deliberately NOT done

- **The master is unchanged.** `assets/velvet-viking-crest.png` is byte-for-byte
  what it was.
- **The production reference is unchanged.** `renderMedallion()` still points at
  the master. Nothing in the app is affected by this branch.
- **`sharp` is not a project dependency.** It is an authoring tool used once and
  deliberately kept out of `package.json` — nothing the app or the test suite
  does requires it. `tools/assets/crest-variants.js` documents the one-off
  install.

---

## 5. Files

```
tools/assets/crest-variants.js                       NEW — the generator
tools/assets/crest-candidates/velvet-viking-crest-540.png    137 KB  (recommended)
tools/assets/crest-candidates/velvet-viking-crest-540.avif    69 KB  (optional step 2)
tools/assets/crest-candidates/velvet-viking-crest-540.webp    85 KB  (measured, not recommended)
tools/assets/crest-candidates/sizes.json                     the full measurement table
tools/assets/crest-candidates/comparison-*.png               the rendered evidence
CREST-ASSET-REPORT.md                                        this file
```

No runtime code, no test, no dependency and no production asset was changed.
Suite unaffected: **3005 pass / 0 fail** on the base commit.

---

## 6. If you approve

One line changes in `renderMedallion()`:

```diff
- src="/assets/velvet-viking-crest.png" width="1223" height="1286"
+ src="/assets/velvet-viking-crest-540.png" width="540" height="568"
```

plus moving the chosen file into `assets/`. I would also add a test pinning the
delivery asset under a size budget, so a future re-export cannot quietly put two
megabytes back on the launch screen.

**Say which option and I will do it as its own small change.**
