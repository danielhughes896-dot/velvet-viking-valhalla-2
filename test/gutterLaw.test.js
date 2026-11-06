'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* ONE GUTTER, AND .wrap ALREADY OWNS IT.
 * ===========================================================================
 * The page's content gutter is .wrap's 16px. Every screen is supposed to run
 * its content to that line, and three of them were quietly adding their own
 * padding on top of it -- so the same kind of line sat at 16 on Today and at
 * 32 on Full Plan, and the modal sheet ran a narrower column than the screen
 * behind it.
 *
 * Traced on a 412px phone before the fix:
 *   Full Plan session title   x=32   (wrap 16 + pp-body 2 + inner 12 + row 2)
 *   Full Plan phase name      x=57   (wrap 16 + head 2 + a 28px disc + 11 gap)
 *   Full Plan zone label      x=43   (wrap 16 + a de-boxed card's 14+13)
 *   Modal body                +19    from the card's own edge (18 + 1px rim)
 *
 * None of those numbers was deciding anything. Together they were a second
 * gutter nobody chose. What this file holds is that there is one.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];

function rule(sel){
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp('(?:^|[\\n,])\\s*' + esc + '\\s*\\{([^}]*)\\}', 'm'));
  assert.ok(m, 'rule not found: ' + sel);
  return m[1];
}
/* The horizontal halves of a shorthand, which is the only part this file is
   about -- every rule below keeps its own vertical rhythm. */
function sides(decl, prop){
  const m = decl.match(new RegExp(prop + ':\\s*([^;}]+)'));
  if (!m) return null;
  const p = m[1].trim().split(/\s+/);
  if (p.length === 1) return [p[0], p[0]];
  if (p.length === 2) return [p[1], p[1]];
  if (p.length === 3) return [p[1], p[1]];
  return [p[3], p[1]];
}

test('the page gutter is 16px and lives in one place', () => {
  assert.deepEqual(sides(rule('.wrap'), 'padding'), ['16px', '16px'],
    'the gutter every other rule in this file defers to has moved');
});

test('Full Plan adds no gutter of its own', () => {
  for (const [sel, why] of [
    ['.view-plan .pp-head', 'the phase row'],
    ['.view-plan .pp-body', 'the phase body'],
    [':is(.view-plan, .view-plan-week, .view-plan-session) .pw-row', 'the session row'],
    [':is(.view-plan, .view-plan-week, .view-plan-session) .week-body-inner', 'the week body'],
    [':is(.view-plan, .view-plan-week, .view-plan-session) .week-head', 'the week row'],
    ['.view-plan .pp-body .week-head', 'the week row inside a phase'],
  ]){
    assert.deepEqual(sides(rule(sel), 'padding'), ['0', '0'],
      why + ' is padding itself again, on top of .wrap’s 16px');
  }
});

test('a panel that lost its box lost the box’s inset with it', () => {
  /* The ground, the rim and the radius were removed from these on the plan
     views and the 13-14px they justified was left behind -- a card's padding
     with no card to put it in. That is why the zone breakdown's label sat at
     x=43 here and x=16 on This Week. */
  const r = rule(':is(.view-plan, .view-plan-week, .view-plan-session) :is(.hub-card, .zone-card, .race-event, .race-strategy)');
  assert.match(r, /margin-left:\s*0/);
  assert.match(r, /margin-right:\s*0/);
  assert.match(r, /padding-left:\s*0/);
  assert.match(r, /padding-right:\s*0/);
  assert.match(r, /background:\s*none/, 'the box came back but the reset stayed');
});

test('a modal’s content sits 16px inside the card, like the page inside the screen', () => {
  /* 15px, not 16: the card draws a 1px rim, so 15 + 1 is the same 16 the
     page uses. Both modal shapes land on it -- the bottom sheet is full
     width so its content is 16 from the screen, and the floating builder
     card is inset 10px so its content is 16 inside its own edge, which is
     the edge it is read against. */
  assert.deepEqual(sides(rule('.modal-body'), 'padding'), ['15px', '15px']);
  assert.deepEqual(sides(rule('.modal-head'), 'padding'), ['15px', '15px']);
});

test('no status glyph holds a title off the gutter', () => {
  /* Both of these said in a mark what their own line already said in words:
     the phase row ends "Completed" / "Now" / "Ahead" and turns gold when it
     is now; the call title ends "-- PROCEED". Each cost its title the left
     edge of the screen. */
  assert.doesNotMatch(SRC, /<span class="pp-mark/, 'the phase disc is back in front of the phase name');
  assert.doesNotMatch(SRC, /v-call-head"><span class="v-status-dot/, 'the call dot is back in front of the call title');
  assert.match(rule('.v-call-sub'), /padding-left:\s*0/,
    'the call sub is indented to clear a dot that is no longer drawn');
});
