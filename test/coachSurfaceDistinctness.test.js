'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// COACH SURFACE DISTINCTNESS.
//
// Next Move used to render coachingEntryFor(dd).cue -- the exact string the
// workout card shows directly above it -- so the athlete read one byte-identical
// coaching sentence twice on one screen, on every session. In a 12-week block
// that is 60 of 60 running days, and the easy-run cue alone appeared 24 times
// before being doubled.
//
// The first test here is the one that would have caught it. The rest keep the
// surfaces answering different questions:
//
//   card cue          HOW to run it
//   How to run this   WHY it exists / what it should FEEL like / what to WATCH FOR
//   Next Move         WHERE it sits in the week -- what today is for
//   Execution Review  HOW IT WENT, from the numbers actually logged
const ROOT = path.join(__dirname, '..');
const RUNTIME = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-17';
const LEVELS = ['novice', 'experienced', 'advanced'];
const DISTANCES = ['5k', '10k', 'half', 'full', 'ultra'];

function app(distanceKey, level) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 16, startDate: TODAY, distanceKey: distanceKey || 'half' });
  if (level) a.state.setup.experience = level;
  return a;
}
const cueOf = (a, dd) => {
  const m = (a.renderCoachingDepth(dd) || '').match(/coach-cue[^>]*>.*?<span>([^<]*)</);
  return m ? m[1] : null;
};

test('Next Move never repeats the workout card cue', () => {
  // THE REGRESSION TEST. This is the reported defect, stated directly.
  let checked = 0;
  for (const dist of DISTANCES) {
    for (const level of LEVELS) {
      const a = app(dist, level);
      for (const dd of a.state.days.filter((d) => d.type !== 'rest')) {
        const cue = cueOf(a, dd);
        const intent = a.coachIntentLine(dd);
        checked++;
        if (cue && intent) {
          assert.notEqual(
            intent,
            cue,
            'Next Move is repeating the card cue verbatim for ' +
              dist + '/' + level + '/' + dd.type + ': "' + cue + '"'
          );
        }
      }
    }
  }
  assert.ok(checked > 500, 'sanity: the sweep covered the plan (' + checked + ')');
});

test('Next Move does not restate any row of How to run this', () => {
  for (const dist of DISTANCES) {
    for (const level of LEVELS) {
      const a = app(dist, level);
      for (const dd of a.state.days.filter((d) => d.type !== 'rest')) {
        const intent = a.coachIntentLine(dd);
        if (!intent) continue;
        const gd = a.coachingDisclosureFor(dd, level) || {};
        for (const k of ['why', 'how', 'feel', 'avoid']) {
          if (gd[k]) {
            assert.notEqual(intent, gd[k], 'Next Move duplicates the ' + k + ' row for ' + dd.type);
          }
        }
      }
    }
  }
});

test('every archetype and every non-rest type has its own intent line', () => {
  const a = app();
  // No session may fall through to an empty Next Move.
  for (const key of Object.keys(a.ARCHETYPE_GUIDANCE)) {
    assert.ok(a.SESSION_INTENT[key], 'no intent line for archetype ' + key);
  }
  for (const key of Object.keys(a.COACH_GUIDANCE)) {
    if (key === 'rest') continue; // coachBrief returns before this for a rest day
    assert.ok(a.SESSION_INTENT_BY_TYPE[key], 'no fallback intent line for type ' + key);
  }
  // And nothing orphaned: an entry keyed to an archetype that does not exist
  // would be copy nobody ever reads.
  for (const key of Object.keys(a.SESSION_INTENT)) {
    assert.ok(a.ARCHETYPE_GUIDANCE[key], 'SESSION_INTENT has an orphan key: ' + key);
  }
});

test('no session anywhere in a real block renders a blank Next Move line', () => {
  for (const dist of DISTANCES) {
    const a = app(dist);
    for (const dd of a.state.days.filter((d) => d.type !== 'rest')) {
      assert.ok(
        a.coachIntentLine(dd),
        'blank intent for ' + dist + '/' + dd.type + '/' +
          ((a.prescriptionOf(dd) || {}).archetype || 'no-archetype')
      );
    }
  }
});

test('the intent line is a lookup, with no randomness and no clock', () => {
  const at = RUNTIME.indexOf('function coachIntentLine(');
  const body = RUNTIME.slice(at, RUNTIME.indexOf('\n}', at));
  for (const banned of ['Math.random', 'Date.now', 'new Date']) {
    assert.equal(body.indexOf(banned), -1, 'coachIntentLine must stay deterministic: ' + banned);
  }
  // It must not reach back into the guidance tables, which is how it became a
  // duplicate of the cue in the first place.
  assert.equal(
    body.indexOf('coachingEntryFor'),
    -1,
    'Next Move must not read the cue table again'
  );
});

test('the same state renders the same Next Move twice', () => {
  const snap = () => {
    const a = app();
    return a.state.days
      .filter((d) => d.type !== 'rest')
      .map((d) => a.coachIntentLine(d))
      .join('|');
  };
  assert.equal(snap(), snap());
});

test('intent lines carry no numbers the engine owns', () => {
  const a = app();
  // Pace, HR, distance and rep counts come from the prescription, never from
  // this copy. A digit here would be a number that cannot follow the plan.
  for (const [k, v] of Object.entries(a.SESSION_INTENT)) {
    assert.ok(!/\d/.test(v), 'intent line for ' + k + ' contains a digit: ' + v);
  }
  for (const [k, v] of Object.entries(a.SESSION_INTENT_BY_TYPE)) {
    assert.ok(!/\d/.test(v), 'fallback intent for ' + k + ' contains a digit: ' + v);
  }
});

test('the safety message still owns the Next Move brief in a recover state', () => {
  const a = app();
  a.coachDecision = () => ({ state: 'recover', reasons: ['Pain reported in your last two sessions'] });
  const dd = a.state.days.filter((d) => !d.completed && d.type !== 'rest')[0];
  const brief = a.coachBrief(dd);
  const paras = brief ? brief.paragraphs : [];
  assert.ok(
    paras.some((p) => /Recovery comes before this session/.test(p)),
    'the recovery instruction must still appear'
  );
  // Supplementary advice stays suppressed while recovering.
  assert.equal(a.fuelPrepareCue(dd), null, 'fuelling must stay quiet in a recover state');
  assert.equal(a.coachNextConnection(dd), '', 'next-session advice must stay quiet');
});
