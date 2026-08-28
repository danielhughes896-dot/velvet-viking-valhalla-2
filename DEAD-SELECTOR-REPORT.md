# `.rec-headline b.rec-none` — removed

Branch `claude/dead-rec-none-selector`, cut from `main` @ `9912d79`.
**Not merged.**

---

## 1. Why it was dead

```css
.rec-headline b.rec-none, .b-plate .val.rec-none{color:var(--ink-faint); font-weight:500;}
```

The first half dates from when the Record tab's empty state was a **dimmed
headline**. `recordCard()` has since returned the `ev-card-empty` branch for
every absence — label first, state second, no headline slot at all — so nothing
can put `rec-none` on a `.rec-headline b`. Verified rather than assumed: the
class is emitted from exactly **one** place in the runtime, `recordPlate()`.

## 2. The change

```diff
- .rec-headline b.rec-none, .b-plate .val.rec-none{color:var(--ink-faint); font-weight:500;}
+ .b-plate .val.rec-none{color:var(--ink-faint); font-weight:500;}
```

The declarations are unchanged. The comment above it now records why the
headline half went, so nobody re-adds it by pattern-matching the old code.

## 3. Proven to be a no-op

The four rendered frames from `tools/shots/record-empty-typography-shots.js`
(390 and 320 px, light and dark) are **byte-identical** before and after —
same PNG checksums, not "looks the same".

## 4. Tests — 2 added to `test/recordEmptyTypography.test.js` (now 10)

- **the quieting rule reaches the plate and nothing else** — asserts the dead
  selector is gone, that the plate kept both its colour and its weight, and
  then asserts the *reason*: no absence renders a headline. If the headline
  branch ever comes back for an absence, that assertion fails and the selector
  has to come back with it, rather than the words silently rendering unquieted.
- **every rec-none the app can emit is styled** — the other direction. Exactly
  one producer, and it is the plate. A second producer added without a matching
  rule would render a bare absence in the data face, which is the defect the
  previous pass removed.

Mutation-checked: restoring the dead selector fails 1; deleting the whole rule
fails 2.

## 5. Found while verifying, NOT removed

An older Record list-row shell is also dead — these classes have **no emission
anywhere in the runtime**:

```
.rec-card  .rec-card:hover  .rec-card:active  .rec-top
.rec-subject  .rec-right  .rec-val  .rec-val.rec-none  .rec-syn
```

That is roughly 10 further rules, replaced when Record rows became `.ev-card`.
It is a bigger deletion than the one you asked for and touches a second
component family, so I have not touched it. Say the word and it is a separate
one-commit pass with the same byte-identical-render proof.

## 6. Files

```
protected/velvet-viking-valhalla.html   one selector removed, comment added
test/recordEmptyTypography.test.js      2 tests added (8 -> 10)
DEAD-SELECTOR-REPORT.md                 this file
```

## 7. Suite

Targeted: `recordEmptyTypography` 10/10.
**Complete suite: 3078 pass / 0 fail** (3076 before; 2 new).
