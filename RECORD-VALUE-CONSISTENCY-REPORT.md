# The Record — "Nothing measured" back inside the value system

Branch `claude/record-empty-value-consistency`, cut from `main` @ `bc950ba`.
**Not merged. Held for review.**

---

## 0. This reverses a merged decision, on purpose

`9912d79` moved this value **off** the value system onto Inter 15px, on the
brief that an absence is a sentence rather than a measurement. This brief asks
for the opposite — consistency **with** the Benchmark value. The state you
described is that merged change, so I have treated it as a considered reversal
and implemented it. Recorded here and in the test file's header so the next
reader does not think it drifted.

What survives from that pass, because it is a different question and was not in
this brief's list: the **colour** quieting (`--ink-faint`), which exists so an
empty record does not read as a warning.

---

## 1. The audit

| | `.b-plate .val` (Benchmark, Progress) | `.rec-none` before | `.rec-none` after |
|---|---|---|---|
| font-family | `'JetBrains Mono',monospace` | `'Inter',-apple-system,sans-serif` | **inherited** |
| font-size | 16px | 15px | **13px** |
| font-weight | 600 | 500 | **inherited (600)** |
| letter-spacing | not set | `normal` | **inherited** |
| line-height | not set (normal) | 1.3 | **inherited** |
| casing | none (sentence) | none | **inherited** |
| alignment | centred, from `.b-plate` | same | **inherited** |
| colour | `var(--ink)` from `.b-plate` | `var(--ink-faint)` | `var(--ink-faint)` |
| overflow-wrap | `anywhere` | inherited | **inherited** |

The other Valhalla value treatments were checked for the same system:
`.rec-headline b` (Record tab headline) is the same face and weight at 20px, and
`.rd-val b` (the Reading dials) is the same face at weight 700. Monospace at
600–700 **is** the value typography here; Inter was the outlier.

---

## 2. The change

**One CSS rule replaced. No markup, no JavaScript, no wording, no logic.**

```diff
- .b-plate .val.rec-none{color:var(--ink-faint); font-weight:500;}
- .b-plate .val.rec-none{
-   font-family:'Inter',-apple-system,sans-serif;
-   font-size:15px; line-height:1.3; letter-spacing:normal;
- }
+ .b-plate .val.rec-none{color:var(--ink-faint); font-size:13px;}
```

It declares **only** the two things that must differ and inherits everything
else from `.b-plate .val` directly above it. That is deliberate: a rule that
*restates* the family and weight is a copy, and a copy drifts the moment
`.b-plate .val` changes. Two tests assert the absence of those declarations
rather than their value.

---

## 3. Why 13px, measured rather than guessed

Monospace "Nothing measured" is 16 characters. One-line width against the
plate's content width, measured in a browser at each production viewport:

| Viewport | Plate | Content | 16px (154px) | 14px (135px) | **13px (125px)** |
|---|---:|---:|:--:|:--:|:--:|
| 430 | 194 | 166 | 1 line | 1 line | **1 line** |
| 412 *(Android)* | 185 | 157 | 1 line | 1 line | **1 line** |
| 390 *(iPhone)* | 174 | 146 | **wraps** | 1 line | **1 line** |
| 384 | 171 | 143 | **wraps** | 1 line | **1 line** |
| 360 *(Android)* | 159 | 131 | **wraps** | **wraps** | **1 line** |
| 320 *(floor)* | 139 | 111 | **wraps** | **wraps** | wraps |

At the system's own 16px it wraps on **every phone narrower than 412**. 14px
still wraps at 360, which is one of the two most common Android widths. 13px
holds one line from 360 up; at 320 nothing consistent fits and it wraps
cleanly, which is the "genuinely required" case.

13px is an accommodation, not a demotion: it is still 44% larger than the 9px
label beneath it, and 3px is the smallest step that reaches 360.

**If you would rather have +1px and accept a wrap at 360, say so and it is
14px** — one character of the brief, and the table above is the whole argument
either way.

---

## 4. Verified in a browser

`tools/shots/record-empty-typography-shots.js`, widened from 2 viewports to 6.
**12 frames** — 430 / 412 / 390 / 384 / 360 / 320 × light and dark. Computed
font read out of the live DOM, because a screenshot cannot tell you which
typeface rendered and the fallback stack would look plausible either way.

| | Measured fitness | Benchmark | Progress |
|---|---|---|---|
| every frame | **`JetBrains Mono 13px/600`** | `JetBrains Mono 16px/600` | `JetBrains Mono 16px/600` |
| lines, 360–430 | **1** | 1 | 1 |
| lines, 320 | 2 | 1 | 1 |

**No layout shift.** Plate box is 64px tall at every width from 360 up — the
same 64px as Benchmark beside it, and 1px off the 65px the Inter version
produced. Widths are unchanged at every viewport. No overflow, no page errors,
in either theme at any width.

The sweep now also **fails** if any plate leaves the data face, if a measured
plate changes size, or if the empty value wraps at 360 or above.

---

## 5. Tests — `test/recordEmptyTypography.test.js`, 10 → 11

Four rewritten to the reversed decision, one added:

1. **the empty plate is on the value system's face and weight** — asserted as
   *inheritance*: the rule must not declare family or weight at all
2. **and it takes nothing else out of the system either** — letter-spacing,
   line-height, text-transform, text-align, font-style must all stay
   un-overridden, so it cannot drift back out one property at a time
3. **the measured plates are untouched** — Benchmark and Progress are out of
   scope, and a rule reaching `.b-plate .val` would shrink real measurements
4. **the size accommodation is an accommodation, not a demotion** — bounded at
   both ends: ≤13px or it wraps at 390; more than 2px above the label or it has
   stopped being the plate's primary content; within 3px of the plate value or
   it is not the same system. Also that the colour is quiet and never a status hue
5–11. unchanged: geometry, wording, markup, the three facts, a measured
   athlete, the Record tab's own empty state, the quieting rule, the single
   `rec-none` producer

### Mutation-checked

| Mutation | Fails |
|---|---|
| back to the system's 16px (wraps everywhere) | 1 |
| back onto Inter | 1 |
| shrink to 10px, label scale | 1 |

---

## 6. Preserved

Wording, label, card dimensions, grid, spacing, position, Record logic,
measured-fitness methodology, the Benchmark and Progress plates, Plan HQ's
Coach/Record structure, both themes, and every other typography rule in the
product. No markup or JavaScript changed.

## 7. Files

```
protected/velvet-viking-valhalla.html          one CSS rule (+ its rationale)
test/recordEmptyTypography.test.js             4 rewritten, 1 added (10 -> 11)
tools/shots/record-empty-typography-shots.js   2 viewports -> 6, 3 new invariants
RECORD-VALUE-CONSISTENCY-REPORT.md             this file
```

## 8. Suite

Targeted: `recordEmptyTypography` 11/11.
**Complete suite: 3079 pass / 0 fail** (3078 on `main` @ `bc950ba`; 1 net new).

**Not merged. Awaiting your review.**
