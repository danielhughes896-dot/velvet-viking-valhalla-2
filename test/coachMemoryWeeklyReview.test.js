'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const L = require('../api/_coach-memory-lines.js');

/* THE REST OF THE WEEKLY REVIEW, REMEMBERED.
   Founder, asked whether the step-back and repeat-session answers should be
   remembered too: "Build it, push and merge when no fails." Hold, reload,
   protect, step the session back and repeat it are all the coach asking the
   athlete to ease off or consolidate. What they chose is remembered like a
   progression answer, and a no is offered the reason chips. */

const RUNTIME = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const KINDS = {
  hold:         ['week_held', 'week_hold_declined'],
  reload:       ['reload_taken', 'reload_declined'],
  protect:      ['week_protected', 'protect_declined'],
  quality_back: ['session_stepped_back', 'step_back_declined'],
  quality:      ['session_repeated', 'repeat_declined']
};

test('every weekly review answer maps to a decision the server knows', () => {
  const a = loadApp({ pinnedDate: '2026-11-17T09:00:00Z' });
  a.healthConsentGranted = () => true;
  for (const [kind, [yes, no]] of Object.entries(KINDS)){
    assert.equal(a.weeklyReviewMemoryCode(kind, true), yes, kind + ' accepted');
    assert.equal(a.weeklyReviewMemoryCode(kind, false), no, kind + ' declined');
    assert.ok(L.DECISIONS[yes] && L.DECISIONS[no], kind + ' has server sentences');
    assert.ok(L.REASON_DECISIONS.includes(no), kind + ': a no gets the reason chips');
    assert.ok(!L.REASON_DECISIONS.includes(yes), kind + ': a yes does not');
  }
  /* The kinds already remembered elsewhere, and those that propose nothing to
     turn down, are not mapped twice. */
  for (const k of ['progress', 'recovery', 'new_run', 'insufficient']) assert.equal(a.weeklyReviewMemoryCode(k, true), null, k);
});

test('a no, with or without a reason, makes a line the coach is allowed to read', () => {
  for (const [, [yes, no]] of Object.entries(KINDS)){
    const plainYes = L.buildEntry({ kind:'decision', code: yes, week: 6 }, { healthGranted: true });
    assert.ok(plainYes.ok, yes);
    assert.ok(L.madeHere(plainYes.row.line), yes + ' passes the line-shape check');
    for (const r of Object.keys(L.REASONS)){
      const e = L.buildEntry({ kind:'decision', code: no, week: 12, reason: r }, { healthGranted: true });
      assert.ok(e.ok, no + ' ' + r + ': ' + e.why);
      assert.ok(e.row.line.length <= L.LINE_MAX);
      assert.ok(L.madeHere(e.row.line), e.row.line);
    }
  }
  assert.equal(L.buildEntry({ kind:'decision', code:'repeat_declined', week: 3, reason:'short_on_time' }, {}).row.line,
    'Kept the planned session rather than repeat the last one, week 3: short on time.');
});

test('protect is about pain, niggles or feeling unwell, so it needs health consent', () => {
  const a = loadApp({ pinnedDate: '2026-11-17T09:00:00Z' });
  a.healthConsentGranted = () => false;
  assert.equal(a.weeklyReviewMemoryCode('protect', true), null);
  assert.equal(a.weeklyReviewMemoryCode('protect', false), null);
  assert.equal(a.weeklyReviewMemoryCode('reload', false), 'reload_declined', 'the others do not need it');
  for (const code of KINDS.protect){
    const e = L.buildEntry({ kind:'decision', code, week: 4 }, { healthGranted: false });
    assert.equal(e.ok, false); assert.equal(e.why, 'health_without_consent');
    assert.equal(L.buildEntry({ kind:'decision', code, week: 4 }, { healthGranted: true }).row.health, true);
  }
});

test('the weekly answer notes them through the same decline path as a progression', () => {
  assert.match(RUNTIME, /: p\.rv\.kind === 'progress' \? \(accept \? 'progression_accepted' : 'progression_declined'\)\s*: weeklyReviewMemoryCode\(p\.rv\.kind, !!accept\);/);
  assert.match(RUNTIME, /if \(memCode\) coachMemoryNoteDecline\(memCode\);/);
});
