'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// PRESCRIPTION VALUES ARE NOT GOLD.
//
// A prescribed pace is data. The same 4:10-4:19/km appears in the session
// summary, in the structured workout step, in the Settle/Hold/Absorb execution
// guidance and beside the logging row -- and it used to be gold in three of
// those four places and normal ink in the other. Gold is reserved for what it
// means everywhere else: headings, session-type badges, status, and the
// confidence figure.
//
// This is checked at the CSS-rule level because that is where the mistake was
// made and where it would be made again -- a future rule reaching for
// --bronze-text because it "looks like a Valhalla number".
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');

// The rule bodies for the selectors that render a prescribed VALUE.
const VALUE_RULES = ['.ws-target', '.ws-hr', '.ws-qty', '.ws-effort', '.ws-note',
                     '.strat-phase-target', '.strat-phase-span',
                     '.day-targets', '.day-targets .mp', '.day-targets .hr',
                     '.slog-presc'];

function ruleBody(sel){
  // the declaration block for `sel{...}` -- anchored so `.ws-target` does not
  // match `.ws-k-ladder .ws-target` and vice versa
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = APP.match(new RegExp('(?:^|[\\n};])\\s*' + esc + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

test('every rule that colours a prescribed value exists', () => {
  VALUE_RULES.forEach(sel => {
    assert.ok(ruleBody(sel), sel + ': rule not found — the selector was renamed and this guard went blind');
  });
});

test('no prescribed value is painted with a gold or bronze token', () => {
  VALUE_RULES.forEach(sel => {
    const body = ruleBody(sel);
    assert.doesNotMatch(body, /--(gold|bronze)[a-z0-9-]*\)/,
      sel + ': a prescribed value is gold again — it must read as data, not brand');
  });
});

test('prescribed values resolve through an --ink token, so both themes work', () => {
  /* The correction is "use the normal readable text colour", NOT "use black".
     --ink/--ink-dim/--ink-faint flip with the theme; a literal hex would leave
     dark mode with black text on a near-black card. `inherit` is allowed: it
     lands on whichever --ink token the parent already resolved. */
  VALUE_RULES.forEach(sel => {
    const body = ruleBody(sel);
    const colour = (body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/) || [])[1];
    if (!colour) return;                       // rule sets no colour of its own
    assert.match(colour.trim(), /^(var\(--ink[a-z-]*\)|inherit)$/,
      sel + ': colour is "' + colour.trim() + '" — not a theme-aware ink token');
  });
});

test('gold still means what it means: headings, badges, status, the confidence figure', () => {
  /* The counterpart assertion. If a future pass "cleans up" gold by removing
     it from these, the accent system has lost its other half. */
  [['.gauge-pct', 'the confidence figure'],
   ['.exec-pill', 'the execution score pill'],
   ['.coach-cue', 'the coaching cue'],
   ['.day-status-label.key', 'the Key-session status label']].forEach(([sel, what]) => {
    const body = ruleBody(sel);
    assert.ok(body, sel + ': rule not found (' + what + ')');
    assert.match(body, /--(gold|bronze)[a-z0-9-]*\)/,
      sel + ' is no longer gold — ' + what + ' is exactly what gold is for');
  });
});

test('the gauge keeps purple on the mechanism and gold on the reading', () => {
  const grad = APP.match(/<linearGradient id="gaugeFillGrad"[^]*?<\/linearGradient>/);
  assert.ok(grad, 'the gauge fill gradient is gone');
  assert.match(grad[0], /var\(--violet-dim\)/);
  assert.match(grad[0], /var\(--violet\)/);
  // the needle is the one <line> carrying an explicit stroke
  assert.match(APP, /<line x1="'\+cx\+'"[^]*?stroke="var\(--violet\)"/,
    'the gauge needle is no longer violet');
  // ticks are class-styled and must not have been given a violet stroke
  const tick = ruleBody('.gauge-tick');
  if (tick) assert.doesNotMatch(tick, /--violet/, 'the gauge ticks turned violet — they are the scale, not the progress');
  assert.match(APP, /<circle cx="'\+cx\+'"[^]*?fill="var\(--modal-active\)"/,
    'the gauge pivot is no longer the gold pivot');
});

test('Garmin readiness copy reads as two sentences, not a dash clause', () => {
  assert.match(APP,
    /Once this is switched on, connecting here is all you’ll need to do\. '\+\s*'Your upcoming sessions will appear on your watch automatically\./,
    'the Garmin readiness sentence does not match the approved copy');
  assert.doesNotMatch(APP, /all you’ll need to do —/, 'the em-dash clause is still there');
});
