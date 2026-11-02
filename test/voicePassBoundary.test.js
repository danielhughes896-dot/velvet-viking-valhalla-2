'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* THE VALHALLA VOICE, AND WHERE IT STOPS.
 * ===========================================================================
 * The voice pass humanised Valhalla's INTERPRETATION of the evidence. It did
 * not touch the evidence, the execution language, the targets, the status
 * labels or anything safety-critical, and this file is the boundary.
 *
 * HQ's guardrail, which is the one worth restating: warmer and more human
 * does not mean more certain. A coaching claim may not be strengthened to
 * make a sentence read better.
 */

const app = () => loadApp({ pinnedDate: '2026-11-02T09:00:00Z' });

/* Every clause that tells an athlete to stop, ease off, or not push through.
   These are copied character-for-character across any rewrite. */
const SAFETY_CLAUSES = [
  'Stop if the effort climbs out of proportion to the pace.',
  'Do not force the closing reps if the effort starts climbing.',
  'Swapping this to an easy run costs one session; running through it can cost a month.'
];

test('every safety clause survived the voice pass verbatim', () => {
  const src = require('fs').readFileSync(
    require('./harness.js').RUNTIME_RELATIVE ? __dirname + '/../' + require('./harness.js').RUNTIME_RELATIVE
      : __dirname + '/../protected/velvet-viking-valhalla.html', 'utf8');
  SAFETY_CLAUSES.forEach(c => assert.ok(src.indexOf(c) !== -1,
    'a safety clause was reworded: ' + c));
});

test('live execution language stayed terse', () => {
  /* TERSE_GUIDANCE is what an athlete reads mid-session. It is shorthand by
     design and the voice pass deliberately did not reach it. The bound is
     generous -- the point is to fail loudly if someone later decides these
     should be conversational too. */
  const T = app().TERSE_GUIDANCE;
  let checked = 0;
  Object.keys(T).forEach(k => ['why','how','feel','avoid'].forEach(f => {
    const t = T[k][f];
    if (!t) return;
    checked++;
    assert.ok(t.length <= 110,
      'execution guidance grew conversational: ' + k + '.' + f + ' (' + t.length + ' chars)');
  }));
  assert.ok(checked > 80, 'the table shrank, so this guard is no longer covering it');
});

test('the evidence rows were left as evidence', () => {
  /* HQ: humanise Valhalla's interpretation of the evidence, not the evidence
     itself. These rows are scannable facts and stay that way. */
  const src = require('fs').readFileSync(
    __dirname + '/../protected/velvet-viking-valhalla.html', 'utf8');
  [ 'Easy pace is costing more heart rate than it did earlier in the block.',
    'Quality work is landing about where it has been.',
    'Long runs are costing more effort than they did earlier in the block.',
    'Effort has been above target on '
  ].forEach(row => assert.ok(src.indexOf(row) !== -1,
    'an evidence row was conversationalised: ' + row));
});

test('no coaching claim was strengthened to make the copy read better', () => {
  const a = app();
  const parts = [];
  const G = a.ARCHETYPE_GUIDANCE;
  Object.keys(G).forEach(k => { if (G[k].why) parts.push(G[k].why); });
  ['ADAPTING','RESPONDING','PLATEAU','STRAINED','LEARNING'].forEach(st =>
    parts.push(a.blockCoachRead(st, 'Build')));
  const text = parts.join(' ');
  /* The shapes that creep in when prose is being warmed up. "the one that
     raises your ceiling" was in the first draft of this pass and is the
     reason the rule is written down. */
  [ /\bthe best way\b/i, /\bguarantee/i, /\balways works\b/i, /\bnever fails\b/i,
    /\bproven to\b/i, /\bscientifically\b/i, /\bthe most important\b/i,
    /\bthe one that\b/i, /\bwill make you\b/i, /\bthe single biggest\b/i
  ].forEach(re => assert.doesNotMatch(text, re, 'a claim got stronger, not just warmer'));
});

test('the humanised surfaces actually changed register', () => {
  /* The other half of the boundary: proving the pass happened at all, so a
     future revert cannot quietly restore the system voice. */
  const a = app();
  assert.match(a.blockCoachRead('ADAPTING', 'Build'), /\bI am\b|\bwe carry\b/,
    'the block verdict is back to describing itself in the third person');
  assert.doesNotMatch(a.blockCoachRead('ADAPTING', 'Build'), /no programme-level change is justified/,
    'the pre-pass wording is back');
  assert.match(a.ARCHETYPE_GUIDANCE.track_reps.why, /helps raise your ceiling/,
    'the reps explanation lost the softened claim HQ asked for');
});
