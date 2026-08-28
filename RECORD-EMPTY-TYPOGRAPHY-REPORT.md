# The Record — "Nothing measured" typography

Branch `claude/record-empty-typography`, cut from `main` @ `fbd0113`.
**Not merged. Held for founder review.**

---

## 1. Where the typography was inherited from

The card is on the **Valhalla tab**, in `renderValhallaRecordPreview()` →
`recordPlate()`. Three chamfered plates, value over label:

```
Nothing measured   |   10K · 23:00        10%
MEASURED FITNESS   |   BENCHMARK       PROGRESS
```

The value slot is one rule:

```css
.b-plate .val{font-family:'JetBrains Mono',monospace; font-size:16px; font-weight:600; overflow-wrap:anywhere;}
```

That is correct — a plate holds a measurement, and monospace at 16px **is** the
typography of data in this product. `recordPlate()` adds `.rec-none` when the
fact is an absence, and the only rule for it was:

```css
.rec-headline b.rec-none, .b-plate .val.rec-none{color:var(--ink-faint); font-weight:500;}
```

Colour and weight. **The face was never changed**, so "Nothing measured" was set
in the data face at data size and read as the metric's value — a reading *of*
nothing, rather than the absence of a reading. Measured in the browser before the
change: `JetBrains Mono 16px/500`, wrapping to two lines at 390 px.

### The product had already made this exact decision — one surface earlier

The **Record tab** card (`recordCard()`) hit the same problem and solved it, and
its CSS says so in as many words:

```css
/* The interface face, NOT the monospace data face -- that difference is what
   stops the words being read as a value. */
.rec-empty-state{font-size:12px; color:var(--ink-faint); font-style:italic;}
```

So this is not a new opinion either. The rule existed, was written down, and had
simply not reached the plate.

---

## 2. The change

**One new CSS rule. No markup change, no JS change, no wording change.**

```css
/* AND IT IS A SENTENCE, SO IT IS SET IN THE SENTENCE FACE.
   … (full comment in the diff) */
.b-plate .val.rec-none{
  font-family:'Inter',-apple-system,sans-serif;
  font-size:15px; line-height:1.3; letter-spacing:normal;
}
```

That is the entire diff to the runtime.

### Why Inter at 15px rather than reusing `.rec-empty-state` wholesale

`.rec-empty-state` is the established VV text-value treatment, so its **face** is
what to borrow. Its **demotion** is not: it is 12 px and italic because on the
Record tab it sits *after* its label as a secondary note, with no headline slot
at all. On the plate the value is still the primary content, so it keeps the
plate's own scale and only the face changes.

15 px rather than 16: proportional text sets wider than the mono it replaces, and
15 px holds "Nothing measured" on one line at 390 px without dropping it out of
the primary slot. `font-family` is written out rather than using `.font-mono`-style
utility classes because those are applied in markup, and this had to be a CSS-only
change to avoid touching `recordPlate()`.

### One observable consequence, which you should decide on

Because the sentence no longer wraps at 390 px, **the plate is shorter** — and
grid row stretch means the Benchmark plate beside it follows:

| | Plate width | Plate height |
|---|---:|---:|
| 390 px, before | 174 px | 83 px (2 lines) |
| 390 px, after | **174 px** | **65 px** (1 line) |
| 320 px, before | 139 px | 83 px (2 lines) |
| 320 px, after | **139 px** | **84 px** (2 lines) |

Width, padding, radius, grid, gap, alignment and position are **untouched** and a
test pins each. The height change is the text no longer wrapping, not a geometry
change — and it cannot be avoided while switching to a proportional face, because
any proportional face fits that sentence on one line in a 174 px plate. Preserving
the old height would need a forced line break or a `min-height`, both of which
would be worse than the honest result. Say the word if you want it held.

---

## 3. Verified in the browser, both themes, two widths

`tools/shots/record-empty-typography-shots.js` → `tools/shots/out-record-empty/`

The sweep **reads the computed font out of the live DOM** rather than trusting the
image — a screenshot cannot tell you which typeface rendered, and the fallback
stack means a missing web font would look plausible either way.

| Frame | Measured fitness | Benchmark | Progress |
|---|---|---|---|
| 390 light/dark, before | `JetBrains Mono 16px/500`, 2 ln | `JetBrains Mono 16px/600` | `JetBrains Mono 16px/600` |
| 390 light/dark, after | **`Inter 15px/500`, 1 ln** | `JetBrains Mono 16px/600` | `JetBrains Mono 16px/600` |
| 320 light/dark, after | **`Inter 15px/500`, 2 ln** | `JetBrains Mono 16px/600` | `JetBrains Mono 16px/600` |

No horizontal overflow, no value overflowing its plate, no page errors, in either
theme at either width. 320 px is included because the plate is half-width there
and it is the one place a proportional sentence could have overrun.

---

## 4. Tests — `test/recordEmptyTypography.test.js`, 8 new

1. the empty plate is set in the interface face, not the data face
2. **the measured plates keep the data face** — the value of the change is the
   contrast, and a rule that leaked to `.b-plate .val` would destroy it from the
   other side
3. the empty plate is still the plate's primary value, not a demoted note —
   pins the scale against the plate's own, forbids the borrowed italic, and
   checks the quieting rule this pass did not touch
4. the plate geometry is untouched — padding, alignment, radius, grid columns,
   gap, and the third plate's centring
5. the words and the label are exactly what they were, and the plate markup is
   byte-identical
6. the measured plates are built exactly as before — three facts, same order,
   exactly one absence
7. a measured athlete gets no empty treatment at all
8. the Record tab's own empty state is not touched by this

The tests parse the runtime's CSS **with comments stripped first**: this file's
own prose quotes the strings it forbids, and matching prose as code has produced
false passes in this suite before.

### Mutation-checked

- Delete the new rule → **2 fail**
- Widen its selector to `.b-plate .val` (all plates) → **3 fail**

---

## 5. Noted, not changed

`.rec-headline b.rec-none` — the other half of the quieting rule — is **dead**.
`recordCard()` returns the `ev-card-empty` branch for any `none` fact, so no
`.rec-headline b` ever carries `rec-none`. Removing it is a tidy-up outside a
typography-only brief, so I left it and am telling you instead.

---

## 6. What was deliberately not done

No wording change; no explanatory copy; no change to the Benchmark or Progress
plates; no redesign of The Record; no change to measured-fitness logic, Current
Fitness, Race Outlook, or any coaching methodology; no markup or JavaScript
change of any kind.

---

## 7. Files changed

```
protected/velvet-viking-valhalla.html          one new CSS rule (+ its comment)
test/recordEmptyTypography.test.js             NEW — 8 tests
tools/shots/record-empty-typography-shots.js   NEW — 4 frames + computed-font measurement
RECORD-EMPTY-TYPOGRAPHY-REPORT.md              this file
```

## 8. Suite

Targeted: `recordEmptyTypography` 8/8.
**Complete suite: 3076 pass / 0 fail** (3068 before; 8 new).

**Not merged. Awaiting your review.**
