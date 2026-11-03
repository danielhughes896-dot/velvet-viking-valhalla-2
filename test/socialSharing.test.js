'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* VALHALLA SOCIAL SHARING — WHAT THE GRAPHIC IS ALLOWED TO SAY
 * ===========================================================================
 * The product claim is "Strava shows the activity, Runna shows the workout,
 * Valhalla shows what the workout MEANT". A shareable image is therefore a
 * coaching statement, and three separate rules decide what may appear on it.
 * All three are properties of pure functions, which is why they are testable
 * here rather than asserted by eye on a screenshot.
 *
 *   1. THE VERDICT IS READ, NEVER INVENTED. Every presentation verdict maps
 *      onto a conclusion the coach had already reached and persisted. No new
 *      score, no new threshold, and no verdict a coaching surface would not
 *      also stand behind.
 *
 *   2. A SESSION THE COACH IS WORRIED ABOUT NEVER GETS A CHEERFUL ONE. Fatigue
 *      and recovery-priority outrank everything, including a breakthrough on
 *      the same day. The failure mode this exists to prevent is an athlete
 *      being handed BREAKTHROUGH to post about a session their coach flagged.
 *
 *   3. THE IMAGE CARRIES NO HEALTH DATA AND NO STRAVA-DERIVED MEASUREMENT.
 *      Heart rate, RPE and feel are not filtered out of the card object -- they
 *      are never put into it, so no future layout can surface one by accident.
 *      Strava-derived fields are withheld under API Policy 5.4, which reaches
 *      "output that incorporates or was generated using Strava Data": a
 *      distributable PNG is exactly that.
 */

const SIZE = { w: 1080, h: 1920 };

function completedDay(over) {
  return Object.assign({
    id: 'w1-2', date: '2026-11-02', week: 1, type: 'easy', km: 10,
    completed: true,
    actual: { km: 10.2, pace: '5:31', movingTimeSec: 3380, elevationGainM: null },
    coachReview: { trainingSignal: 'on_track', breakthrough: false, paceEased: false },
  }, over || {});
}

test('every locked verdict is read off a conclusion the coach already reached', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });

  /* Joined rather than deep-compared: the app runs in a VM realm, so its
     Array has a different prototype and deepStrictEqual would reject an
     identical list. */
  assert.equal(Array.prototype.join.call(app.SHARE_VERDICTS, ','),
    'BREAKTHROUGH,CALIBRATED,ABSORBED,DIALED,CONTROLLED',
    'the locked five, in precedence order');

  // BREAKTHROUGH — the coach's own breakthrough flag, nothing else.
  assert.equal(app.shareVerdictLabel(completedDay({
    coachReview: { trainingSignal: 'on_track', breakthrough: true },
  })), 'BREAKTHROUGH');

  // ABSORBED — the existing positive_adaptation signal.
  assert.equal(app.shareVerdictLabel(completedDay({
    coachReview: { trainingSignal: 'positive_adaptation' },
  })), 'ABSORBED');

  // CONTROLLED — the existing paceEased conclusion, now persisted.
  assert.equal(app.shareVerdictLabel(completedDay({
    coachReview: { trainingSignal: 'on_track', paceEased: true },
  })), 'CONTROLLED');

  // CALIBRATED — only when the calibration was actually APPLIED. A refused
  // calibration is a real coaching event, but it is not an achievement.
  assert.equal(app.shareVerdictLabel(completedDay({
    type: 'calibration',
    calibration: { outcome: 'applied' },
    coachReview: { trainingSignal: 'on_track' },
  })), 'CALIBRATED');
  assert.equal(app.shareVerdictLabel(completedDay({
    type: 'calibration',
    calibration: { outcome: 'refused' },
    coachReview: { trainingSignal: 'on_track' },
  })), null, 'a refused calibration earns no verdict at all');
});

test('an uncompleted or unreviewed session has no verdict to show', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  assert.equal(app.shareVerdictLabel(null), null);
  assert.equal(app.shareVerdictLabel(completedDay({ completed: false })), null);
  assert.equal(app.shareVerdictLabel(completedDay({ coachReview: null })), null);
});

test('fatigue and recovery-priority outrank every cheerful verdict', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });

  /* THE ONE THAT MATTERS MOST. A breakthrough on a day the coach has flagged
     for fatigue must not become something to post about -- the safety rule is
     checked BEFORE the achievement, not after it. */
  assert.equal(app.shareVerdictLabel(completedDay({
    coachReview: { trainingSignal: 'monitor_fatigue', breakthrough: true },
  })), null);

  assert.equal(app.shareVerdictLabel(completedDay({
    coachReview: { trainingSignal: 'recovery_priority', trainingSignalPositive: true },
  })), null);

  // And the same day without the flag does produce one, so the assertion
  // above is testing the flag rather than some other absence.
  assert.equal(app.shareVerdictLabel(completedDay({
    coachReview: { trainingSignal: 'on_track', breakthrough: true },
  })), 'BREAKTHROUGH');
});

test('no verdict is not a refusal to share — the card is simply quieter', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const dd = completedDay({ coachReview: { trainingSignal: 'monitor_fatigue' } });
  const data = app.shareCardData(dd);
  assert.ok(data, 'the card is still composed');
  assert.equal(data.verdict, null);
  const ops = app.shareCardLayout(data, 'full', SIZE);
  assert.ok(ops.length > 0, 'and still has something to draw');

  /* The headline falls back to the session's own name. The card says what the
     run WAS; it just makes no claim about what it meant. */
  const hl = ops.find(o => o.kind === 'headline');
  assert.equal(hl.text, data.sessionLabel);
  assert.ok(!/\u2014/.test(hl.text), 'no verdict clause appended');
  assert.equal(hl.accentFrom, -1, 'and nothing for the gold accent to highlight');
});

test('a Strava-imported session puts no imported measurement on the image', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const dd = completedDay({
    stravaActivityId: 998877,
    actual: { km: 10.2, pace: '5:31', movingTimeSec: 3380, elevationGainM: 142 },
    coachReview: { trainingSignal: 'on_track', breakthrough: true },
  });
  const data = app.shareCardData(dd);

  assert.equal(data.distanceKm, null, 'distance withheld');
  assert.equal(data.paceStr, null, 'pace withheld');
  assert.equal(data.durationSec, null, 'duration withheld');
  assert.equal(data.elevationM, null, 'elevation withheld');

  /* THE VERDICT GOES WITH THEM. It is read off distance and pace, so leaving
     it on the graphic would be publishing a conclusion generated using Strava
     Data -- which is precisely what 5.4 reaches. */
  assert.equal(data.verdict, null, 'and the verdict, which is derived from them');

  // Valhalla's own facts are not Strava's and survive.
  assert.equal(data.week, 1);
  assert.ok(data.sessionLabel);

  // The athlete is told, by field, that something was held back.
  assert.equal(Array.prototype.slice.call(data.withheld).sort().join(','),
    'distance,duration,elevation,pace,verdict');
});

test('a self-logged session is unaffected by the Strava boundary', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay({
    coachReview: { trainingSignal: 'on_track', breakthrough: true },
  }));
  assert.equal(data.withheld.length, 0, 'nothing withheld');
  assert.equal(data.distanceKm, 10.2);
  assert.equal(data.paceStr, '5:31');
  assert.equal(data.verdict, 'BREAKTHROUGH');
});

test('no health field reaches the card object at all', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  /* A day carrying every health field the app can hold. None of them may
     appear on the object, under any key, at any value. */
  const dd = completedDay({
    actual: {
      km: 10.2, pace: '5:31', movingTimeSec: 3380, elevationGainM: 80,
      hr: 148, maxHR: 171, rpe: 6, feel: 'strong',
      notes: 'legs felt heavy from the start',
    },
  });
  const data = app.shareCardData(dd);
  const keys = Object.keys(data);
  for (const banned of ['hr', 'maxHR', 'rpe', 'feel', 'notes', 'cadence']) {
    assert.ok(!keys.includes(banned), banned + ' must not be a card key');
  }
  // And nothing anywhere in the drawn output carries one of those values.
  const drawn = JSON.stringify(app.shareCardLayout(data, 'full', SIZE));
  for (const v of ['148', '171', 'strong', 'heavy']) {
    assert.ok(!drawn.includes(v), 'drawn card must not contain ' + v);
  }
});

test('an absent metric leaves no gap and no zero behind', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });

  /* BLANK ELEVATION IS UNKNOWN, NOT FLAT. A track session with 0m of climb and
     a run nobody measured are different facts, and the card must not turn the
     second into the first. */
  const sparse = app.shareCardData(completedDay({
    actual: { km: null, pace: '5:31', elevationGainM: null },
  }));
  assert.equal(sparse.elevationM, null);
  assert.equal(sparse.distanceKm, null);

  const ops = app.shareCardLayout(sparse, 'full', SIZE);
  const metrics = ops.filter(o => o.kind === 'metrics');
  assert.equal(metrics.length, 1, 'one metric row');
  assert.equal(metrics[0].items.length, 1, 'holding only the pace it actually has');
  assert.ok(/5:31/.test(JSON.stringify(metrics[0].items)));
  assert.equal(ops.filter(o => o.kind === 'distance').length, 0,
    'and no distance block drawn empty');

  // A genuine zero the athlete typed is kept and shown.
  const flat = app.shareCardData(completedDay({
    actual: { km: 8, pace: '5:10', elevationGainM: 0 },
  }));
  assert.equal(flat.elevationM, 0, 'a real 0m survives as a number');
  const flatDrawn = JSON.stringify(app.shareCardLayout(flat, 'full', SIZE));
  assert.ok(/0\s*m/.test(flatDrawn) || /"0m"/.test(flatDrawn),
    'and is drawn, because it is an answer');

  // A card with nothing measurable at all emits no metric row rather than an
  // empty one.
  const bare = app.shareCardData(completedDay({ actual: {} }));
  assert.equal(app.shareCardLayout(bare, 'full', SIZE)
    .filter(o => o.kind === 'metrics').length, 0);
});

test('the three layouts say progressively less, and all three are honest', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay({
    actual: { km: 21.1, pace: '4:48', movingTimeSec: 6080, elevationGainM: 210 },
    coachReview: { trainingSignal: 'positive_adaptation' },
  }));

  const kinds = l => Array.prototype.map.call(
    app.shareCardLayout(data, l, SIZE), o => o.kind);
  const full = kinds('full'), compact = kinds('compact'), minimal = kinds('minimal');

  for (const k of ['headline', 'distance']) {
    assert.ok(full.includes(k) && compact.includes(k) && minimal.includes(k),
      k + ' survives every layout');
  }
  assert.ok(full.includes('metrics') && compact.includes('metrics'));
  assert.ok(!minimal.includes('metrics'), 'minimal is verdict and distance only');
  assert.ok(minimal.length < compact.length, 'minimal drops whole blocks');

  /* FULL AND COMPACT DIFFER INSIDE THE METRIC ROW, not in which blocks exist.
     Counting op kinds would call them identical, so count what the row holds:
     full says time, pace and elevation; compact says pace alone. */
  const row = l => app.shareCardLayout(data, l, SIZE).find(o => o.kind === 'metrics');
  assert.equal(row('full').items.length, 3, 'full: time, pace, elevation');
  assert.equal(row('compact').items.length, 1, 'compact: pace only');
  assert.ok(/4:48/.test(JSON.stringify(row('compact').items)));
  assert.ok(!/210/.test(JSON.stringify(row('compact').items)),
    'compact does not carry elevation');

  /* The headline names the session and then its verdict, and tells the painter
     where the gold accent starts so only the verdict is highlighted. */
  const hl = app.shareCardLayout(data, 'full', SIZE).find(o => o.kind === 'headline');
  assert.equal(hl.text, 'EASY  —  ABSORBED');
  assert.equal(hl.text.slice(hl.accentFrom), 'ABSORBED',
    'the accent begins exactly at the verdict');
});

test('the layout is pure, and fits whichever canvas it is given', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay());
  const frozen = JSON.stringify(data);

  for (const key of ['story', 'square']) { // eslint-disable-line
    const size = app.SHARE_SIZES[key];
    assert.equal(size.w, 1080, key + ' exports at 1080px wide');
    const ops = app.shareCardLayout(data, 'full', size);
    for (const op of ops) {
      if (op.x != null) assert.ok(op.x >= 0 && op.x <= size.w, key + ': x within canvas');
      if (op.y != null) assert.ok(op.y >= 0 && op.y <= size.h, key + ': y within canvas');
    }
  }
  assert.equal(JSON.stringify(data), frozen, 'laying out never mutates the data');
});

test('elevation is optional training data: blank stays unknown through the log', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });

  /* The field has to behave in the handler, not only in the card -- an empty
     box that silently became 0 would make every unmeasured run look flat. */
  assert.equal(app.emptyActual().elevationGainM, null,
    'a fresh log carries unknown, not zero');

  const dd = completedDay({ actual: app.emptyActual() });
  app.state.days = [dd];   // findDay() reads state.days

  app.handleActualFieldChange(dd.id, 'elevationGainM', '240');
  assert.equal(dd.actual.elevationGainM, 240);

  app.handleActualFieldChange(dd.id, 'elevationGainM', '0');
  assert.equal(dd.actual.elevationGainM, 0, 'a typed zero is the athlete\'s answer');

  app.handleActualFieldChange(dd.id, 'elevationGainM', '');
  assert.equal(dd.actual.elevationGainM, null, 'and clearing it returns to unknown');

  app.handleActualFieldChange(dd.id, 'elevationGainM', 'not a number');
  assert.equal(dd.actual.elevationGainM, null, 'unparseable is unknown, never NaN');
});

test('elevation is not health data and is not behind the consent gate', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const m = src.match(/Elevation gain \(m\)[\s\S]{0,400}?<\/div>'/);
  assert.ok(m, 'the elevation input exists');
  assert.ok(!/healthConsentGranted/.test(m[0]),
    'elevation is ordinary training data and must not be gated on health consent');
});

test('the share surface tells the athlete when something is held back', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const fn = src.match(/function shareModalHtml\(\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'shareModalHtml exists');
  assert.ok(/withheldNote/.test(fn[0]) && /share-note/.test(fn[0]),
    'a withheld metric is explained in the composer, never silently omitted');
  assert.ok(/d\.withheld\.length/.test(fn[0]),
    'and the notice is driven by what was actually withheld');
});

test('the share path neither reads nor writes any coaching decision', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const start = src.indexOf('function shareVerdictLabel');
  const end = src.indexOf('function renderExecutionReview');
  assert.ok(start > 0 && end > start);
  const region = src.slice(start, end);

  /* A presentation feature may not move the plan. If sharing ever needs to
     write, that is a coaching change and belongs in a coaching review. */
  for (const banned of ['applyCompletion(', 'regenerate', 'scheduleSave(',
                        'state.plan.days[', 'coachPersistReview(']) {
    assert.ok(!region.includes(banned),
      'the share core must not call ' + banned);
  }
});

test('the exported file is handed to the device, not to a server', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const start = src.indexOf('function saveBinaryFile');
  const end = src.indexOf('function shareBlobToBase64');
  assert.ok(start > 0 && end > start, 'the binary save path exists');
  /* Bounded by the LAST function on the path, not by a character count -- a
     fixed window overran into the text-export helpers below it and failed on
     their API calls rather than on anything the image path does. */
  const after = src.indexOf('function nativeSaveTextFile', end);
  assert.ok(after > end);
  const region = src.slice(start, after);

  /* NO UPLOAD, ANYWHERE ON THIS PATH. The image is composed locally and given
     to the native share sheet, so Valhalla never learns where a post went --
     which is also why there is no account to link. */
  for (const banned of ['fetch(', 'XMLHttpRequest', 'supabase', 'api/']) {
    assert.ok(!region.includes(banned),
      'the export path must not reference ' + banned);
  }
  assert.ok(/Share\.share\(/.test(region), 'it hands off to the native share sheet');
});
