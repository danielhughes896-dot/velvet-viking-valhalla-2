# The Record's dead list-row shell — removed

Branch `claude/dead-rec-card-shell`, cut from `main` @ `bc950ba`.
**Not merged.**

---

## 1. What was dead, and how that was established

The Record used to be **rows**: subject on the left, value on the right, built
from `.plan-summary-bar`'s shell. Record cards later became `.ev-card` buttons —
headline value, then subject, then a synopsis in `.rs-syn` — and the row styles
stayed behind.

Established by splitting the runtime at its single `<style>` block and asking
two separate questions, with comments stripped from both halves (a comment
naming a class is documentation, not a rule and not an emission):

| Class | Styled | Emitted anywhere in the runtime |
|---|---|---|
| `.rec-card` (+ `:hover`, `:active`, ` svg`) | yes | **no** |
| `.rec-top` | yes | **no** |
| `.rec-subject` | yes | **no** |
| `.rec-right` | yes | **no** |
| `.rec-val`, `.rec-val.rec-none` | yes | **no** |
| `.rec-syn` | yes | **no** |
| `.rec-lede` | yes | yes (2) |
| `.rec-headline`, `.rec-context`, `.rec-empty`, `.rec-empty-subject`, `.rec-empty-state`, `.rec-none`, `.rec-panel-nav` | yes | yes |

**11 rules removed. Every live `.rec-*` class kept.**

---

## 2. The part that was not dead, and was nearly deleted with it

The block being removed opened with a design law:

> *"THE RIGHT-HAND ELEMENT IS A VALUE, NOT A VERDICT. … A Record card carries a
> fact: no dot, no status hue, ever. That is the whole distinction between the
> two jobs the one component does."*

That law is **still in force** — it is simply enforced on different elements
now (`.rec-headline` / `.rec-empty-state` / `.b-plate .val`, against `.read-val`,
which is the surface allowed to carry tone). Deleting the CSS block wholesale
would have deleted the only written statement of it. It is rehomed, pointed at
the surfaces that carry it today, and a test asserts it survives.

Two cross-references elsewhere pointed at classes that no longer exist and are
corrected in the same pass:

```diff
- destination cards now (.read-val above, .rec-card shell)
+ destination cards now (.read-val above, .ev-card shell)

- may carry the tone … which is exactly what .rec-val is forbidden from doing
+ may carry the tone … which is exactly what a Record value is forbidden from
+ doing (see THE RECORD above)
```

A comment explaining a live component by contrast with a deleted one is the
same failure as the dead CSS, one level up.

---

## 3. Proven inert, two ways

`tools/shots/plan-hq-shell-shots.js` — **12 frames**: Plan HQ's three tabs
(Valhalla / Coach / Record) × light and dark × a measured and an unmeasured
athlete.

1. **No element matches.** The sweep queries the removed selectors against the
   live DOM in every frame: `removedSelectorsMatched=none`, everywhere. A rule
   that matches nothing cannot paint anything — this is the actual argument.
   Each frame also asserts it rendered Record/Reading elements at all, so "no
   matches" is never vacuously true.
2. **The pixels are unchanged.** Run on the commit before and after: **all 12
   PNGs byte-identical**. Same checksums, not "looks the same". This is the
   backstop for the one way the argument above could be wrong — a mistake in
   the selector list.

No horizontal overflow, no page errors, in any frame.

---

## 4. Tests — `test/recordShellDead.test.js`, 7 new

1. one `<style>` block, so the CSS/markup split the rest of the file relies on
   is real
2. the dead list-row shell has no rules left
3. and nothing emits it either — *if the shell comes back, its CSS has to come
   back with it*
4. **every `.rec-*` class the stylesheet styles is one the app can render** —
   the general rule, and the only one of these worth keeping in five years. Not
   about these six names: about the namespace never again carrying a rule that
   cannot paint
5. the surviving Record classes are all still styled *and* still rendered — the
   deletion must not have taken a live class with it
6. the fact-not-verdict law survived the deletion, still names `.read-val`, and
   THE READING no longer explains itself by contrast with `.rec-val`

### Mutation-checked

| Mutation | Fails |
|---|---|
| Restore one dead rule | 2 |
| Delete the fact-not-verdict law | 1 |
| Add a brand-new orphan `.rec-ghost` rule | 1 |

Test 4 catching a class this pass never touched is the point: it is a guard,
not a snapshot of today.

---

## 5. Files

```
protected/velvet-viking-valhalla.html   11 dead rules removed; the design law
                                        rehomed; 2 stale cross-references fixed
test/recordShellDead.test.js            NEW — 7 tests
tools/shots/plan-hq-shell-shots.js      NEW — 12 frames + live-DOM selector check
test/themeSystem.test.js                one row re-homed (§6)
test/valhallaRedesign.test.js           one test re-homed (§6)
test/mutation/run.js                    two cases re-homed, subset widened (§6)
DEAD-REC-SHELL-REPORT.md                this file
```

No markup, no JavaScript, no behaviour and no live style changed.

## 6. Two tests that were guarding a ghost

Removing the rules made **two existing tests fail**, and both had been passing
vacuously against a component nothing renders:

| Test | Pinned | Re-homed to |
|---|---|---|
| `themeSystem` — *fills that carry state or semantics were not flattened* | `.rec-card:hover` | `.ev-card:hover` |
| `valhallaRedesign` — *carries its data typography by default, not by caller convention* | `.rec-val` | `.b-plate .val` + `.rec-headline b` |

The second is the sharper one: a test named for a law about components not
relying on caller convention was asserting it on a class with **no callers**.

`test/mutation/run.js` had the same problem twice. One case mutated `.rec-val`'s
colour to prove *"a Record value is a fact, and stops being one"* — its anchor no
longer existed, so that guarantee had **no enforcement at all**. Re-homed to
`.b-plate .val` and verified: applying the mutation now fails `RECORD_SUBSET`
(caught by test 7 below, and by an existing claims test). The other case used
`class="rec-val"` as its neutral replacement markup and now uses `.hq-row-l`.

`recordShellDead` and `recordEmptyTypography` were added to `RECORD_SUBSET` so
the re-homed case is checked against suites that actually hold the law.

**7th test added: no Record value carries a status hue** — `.b-plate .val`,
`.rec-headline b` and `.rec-empty-state` against every status token, plus that
`.read-val` still does carry tone, because the law is the contrast. That
assertion is what catches the re-homed mutation.

Nothing was weakened to make the suite green: two vacuous assertions became
live ones, and a guarantee that had no enforcement now has some.

### A note on the mutation runner

`node test/mutation/run.js record` exceeded a 10-minute budget and was killed
mid-run. The working tree was verified restored intact — no leftover mutation in
the runtime — before continuing, and the one re-homed case was checked directly
against `RECORD_SUBSET` instead.

---

## 7. Suite

Targeted: `recordShellDead` 7/7, `recordEmptyTypography` 10/10,
`themeSystem` + `valhallaRedesign` 60/60.
**Complete suite: 3085 pass / 0 fail** (3078 before; 7 new).
