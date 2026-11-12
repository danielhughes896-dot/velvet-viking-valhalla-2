'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* SACORO SOCIAL SHARING — WHAT THE GRAPHIC IS ALLOWED TO SAY
 * ===========================================================================
 * The product claim is "Strava shows the activity, Runna shows the workout,
 * Sacoro shows what the workout MEANT". A shareable image is therefore a
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

  /* CONTROLLED is the one rung that cannot be shown on a hand-built day: it
     now answers to an execution score as well as to paceEased, and a day with
     no prescription behind it has no score to answer with. (This fixture also
     could not occur in production -- coachPaceEased() returns false when
     there is no pace target, so paceEased:true here is hand-set.) The rung
     itself is covered against the real engine further down, in
     'CONTROLLED answers to the execution score, not to pace alone'. */
  assert.equal(app.shareVerdictLabel(completedDay({
    coachReview: { trainingSignal: 'on_track', paceEased: true },
  })), null, 'paceEased alone, with no execution score, is not a verdict');

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

  // Sacoro's own facts are not Strava's and survive.
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
  /* And no health value reaches anything the card DISPLAYS. Scoped to the
     text the ops carry rather than the whole serialised structure: coordinates
     are integers in the same numeric range, so '171' matched a y position and
     the assertion was passing or failing on where a line happened to land
     rather than on what the card says. */
  const ops = app.shareCardLayout(data, 'full', SIZE);
  const words = [];
  Array.prototype.forEach.call(ops, o => {
    if (o.text) words.push(String(o.text));
    if (o.value) words.push(String(o.value));
    if (o.unit) words.push(String(o.unit));
    if (o.items) Array.prototype.forEach.call(o.items, it => words.push(String(it.text)));
  });
  const said = words.join(' | ');
  for (const v of ['148', '171', 'strong', 'heavy']) {
    assert.ok(!said.includes(v), 'the card must not say ' + v + ' -- it says: ' + said);
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

test('the registry holds eleven overlays: five framed, six photo-first', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const keys = Array.prototype.slice.call(app.shareOverlayKeys());
  assert.equal(keys.join(','),
    'frame,panel,rail,diagonal,badge,lowcentre,topcentre,lowleft,lowright,railleft,railright');
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');

  const data = app.shareCardData(completedDay({
    actual: { km: 28, pace: '5:31', movingTimeSec: 9258, elevationGainM: 312 },
    coachReview: { trainingSignal: 'positive_adaptation' },
  }));
  const opsOf = k => Array.prototype.slice.call(app.shareCardLayout(data, k, SIZE));
  const surfaceOf = k => opsOf(k).map(o => o.kind)
    .filter(kind => ['frame','plinth','rail','wedge','badge','fade','seam'].includes(kind))
    .join(',');

  /* THE FIRST FIVE EACH OWN A SURFACE. That is what makes them different
     designs rather than the density tiers they replaced. */
  assert.deepEqual(keys.slice(0, 5).map(surfaceOf),
    ['frame', 'plinth', 'rail', 'wedge', 'badge']);

  /* THE SIX WATERMARKS SHARE ONE, AND THAT IS THE POINT. None of them puts
     anything opaque on the photograph: a directional fade, and for the two
     rails a single gold seam. They are told apart by where the block sits,
     not by what is drawn behind it. */
  keys.slice(5).forEach(k => {
    const surface = surfaceOf(k);
    assert.ok(surface === 'fade' || surface === 'fade,seam',
      k + ' is a watermark and must carry no panel: ' + surface);
  });

  /* And no two overlays are the same overlay under two names -- the real
     distinctness property, which survives six of them sharing a surface. */
  const seen = new Map();
  keys.forEach(k => {
    const sig = JSON.stringify(opsOf(k));
    assert.ok(!seen.has(sig), k + ' draws exactly what ' + seen.get(sig) + ' draws');
    seen.set(sig, k);
  });
});

test('every overlay shows everything the session legitimately has', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay({
    actual: { km: 28, pace: '5:31', movingTimeSec: 9258, elevationGainM: 312 },
    coachReview: { trainingSignal: 'positive_adaptation' },
  }));
  /* An overlay is a DESIGN, not a density level: picking one must never cost
     the athlete a number. Matched case-insensitively because the two rail
     watermarks set the programme line in letterspaced caps, as their mock
     does -- a presentation difference, not a missing fact. */
  for (const key of app.shareOverlayKeys()) {
    const ops = Array.prototype.slice.call(app.shareCardLayout(data, key, SIZE));
    const kinds = ops.map(o => o.kind);
    for (const need of ['wordmark', 'distance']) {
      assert.ok(kinds.includes(need), key + ' is missing ' + need);
    }
    /* 'mark' WAS REQUIRED HERE. Founder, on a real export: "I don't like the
       S square app on the share function. I think that's best as just the
       app icon." No overlay carries an emblem now. */
    assert.ok(!kinds.includes('mark'), key + ' draws an emblem above the name again');
    const said = JSON.stringify(ops);
    assert.ok(/28\.0/.test(said), key + ' drops the distance');
    assert.ok(/ABSORBED/i.test(said), key + ' drops the verdict');
    assert.ok(/5:31/.test(said), key + ' drops the pace');
    assert.ok(/2:34:18/.test(said), key + ' drops the time');
    assert.ok(/312 m/i.test(said), key + ' drops the elevation');
    assert.ok(/week 1/i.test(said), key + ' drops the programme line');
  }
});

test('the imported-data rule holds on every overlay, not just the default', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  /* The fence is applied once, in shareCardData(), and overlays are handed
     the result -- so a withheld metric reaches them as null and cannot be
     drawn. This is the assertion that makes adding a twelfth design safe. */
  const dd = completedDay({
    stravaActivityId: 4242,
    actual: { km: 28, pace: '5:31', movingTimeSec: 9258, elevationGainM: 312 },
    coachReview: { trainingSignal: 'positive_adaptation', breakthrough: true },
  });
  const data = app.shareCardData(dd);
  for (const key of app.shareOverlayKeys()) {
    for (const fmt of ['story', 'post']) {
      const said = JSON.stringify(app.shareCardLayout(data, key, app.SHARE_SIZES[fmt]));
      for (const leak of ['28.0', '5:31', '2:34:18', '312 m', 'ABSORBED']) {
        assert.ok(!new RegExp(leak.replace('.', '\\.'), 'i').test(said),
          key + '/' + fmt + ' published an imported value: ' + leak);
      }
      assert.ok(/week 1/i.test(said), key + '/' + fmt + ' lost SACORO\'s own facts');
    }
  }
});

test('the watermarks keep the photograph: no opaque surface anywhere in them', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay());
  const WATERMARKS = ['lowcentre','topcentre','lowleft','lowright','railleft','railright'];
  for (const key of WATERMARKS) {
    const ops = Array.prototype.slice.call(app.shareCardLayout(data, key, SIZE));
    const fade = ops.find(o => o.kind === 'fade');
    assert.ok(fade, key + ' has no fade at all');
    /* A fade that reached full strength would be a panel with soft edges.
       The ceiling is what keeps these readable as watermarks. */
    assert.ok(fade.peak <= 0.85, key + ' fade is heavy enough to be a panel: ' + fade.peak);
    assert.ok(fade.extent < SIZE.h * 0.62,
      key + ' fade covers most of the frame: ' + fade.extent);
    for (const solid of ['plinth', 'rail', 'wedge', 'badge']) {
      assert.ok(!ops.some(o => o.kind === solid),
        key + ' draws a ' + solid + ', which is not a watermark');
    }
  }
});

test('an unknown overlay key falls back rather than drawing nothing', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay());
  const ops = app.shareCardLayout(data, 'no-such-overlay', SIZE);
  assert.ok(ops.length > 0, 'a stale saved preference still produces a card');
});

test('every overlay is pure, and fits whichever canvas it is given', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay({
    actual: { km: 28, pace: '5:31', movingTimeSec: 9258, elevationGainM: 312 },
  }));
  const frozen = JSON.stringify(data);

  for (const fmt of ['story', 'post']) {
    const size = app.SHARE_SIZES[fmt];
    assert.equal(size.w, 1080, fmt + ' exports at 1080px wide');
    for (const key of app.shareOverlayKeys()) {
      const ops = Array.prototype.slice.call(app.shareCardLayout(data, key, size));
      for (const op of ops) {
        if (op.y != null) assert.ok(op.y >= 0 && op.y <= size.h,
          key + '/' + fmt + ': y ' + op.y + ' outside 0..' + size.h);
        if (op.cx != null) assert.ok(op.cx >= 0 && op.cx <= size.w,
          key + '/' + fmt + ': cx ' + op.cx + ' outside 0..' + size.w);
      }
    }
  }
  assert.equal(JSON.stringify(data), frozen, 'laying out never mutates the data');
});

test('Story is 9:16 and Post is square', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  assert.equal(app.SHARE_SIZES.story.w / app.SHARE_SIZES.story.h, 1080 / 1920);
  assert.equal(app.SHARE_SIZES.story.square, false);
  assert.equal(app.SHARE_SIZES.post.w, app.SHARE_SIZES.post.h, 'Post is square this pass');
  assert.equal(app.SHARE_SIZES.post.square, true);
  assert.equal(app.SHARE_SIZES.square, undefined, 'the old name is gone, not aliased');
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
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const dd = completedDay({ actual: Object.assign(app.emptyActual(),
    { km: 10.2, pace: '5:31', rpe: 6, elevationGainM: 240 }) });
  app.state.days = [dd];

  /* ASSERTED BY RENDERING, NOT BY READING THE SOURCE. This was a regex that
     started at the label's own copy and ran forward to the next </div> --
     which proved only that two strings sat near each other, and tied the
     rule to wording that has since been shortened. What the rule is about
     is which side of the gate the input is on, so shut the gate and look. */
  app.state.healthConsent = { decision: 'declined', version: app.HEALTH_CONSENT_VERSION };
  assert.equal(app.healthConsentGranted(), false, 'the gate did not shut');

  /* Your Log is a tab now, closed until asked -- open it, or this renders
     an empty log and the assertion below proves nothing. */
  app.logOpenFor[dd.id] = true;
  const shut = app.renderDayCard(dd);
  assert.doesNotMatch(shut, /data-field="hr"/,
    'Avg HR survived a declined consent, so the assertion below proves nothing');
  assert.match(shut, /data-field="elevationGainM"/,
    'elevation is ordinary training data and must outlive a declined consent');

  app.state.healthConsent = { decision: 'granted', version: app.HEALTH_CONSENT_VERSION };
  const open = app.renderDayCard(dd);
  assert.match(open, /data-field="hr"/, 'granting consent no longer offers Avg HR');
  assert.match(open, /data-field="elevationGainM"/, 'elevation vanished when consent was granted');
});

test('the share surface tells the athlete when something is held back', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  /* The composer lives in shareComposerHtml() now -- shareModalHtml() is
     that plus a title bar -- so the completion card can host it inline. The
     note has to travel with the composer, not with the modal. */
  const fn = src.match(/function shareComposerHtml\(\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'shareComposerHtml exists');
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
  /* Comments stripped first. The raw text matched the word applyCompletion
     inside a comment EXPLAINING that the share path must not call it, so the
     guard was failing on its own documentation. What is scanned is code. */
  const region = src.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

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
     to the native share sheet, so Sacoro never learns where a post went --
     which is also why there is no account to link. */
  for (const banned of ['fetch(', 'XMLHttpRequest', 'supabase', 'api/']) {
    assert.ok(!region.includes(banned),
      'the export path must not reference ' + banned);
  }
  assert.ok(/Share\.share\(/.test(region), 'it hands off to the native share sheet');
});

/* THE JOURNEY, STAGE BY STAGE
 * ===========================================================================
 * Session completed now -> Workout Complete popup -> Share to Socials ->
 * the editor -> overlay + picture + Story/Post -> Share or Save to photos.
 * The stages are asserted as stages because the value of this flow is that it
 * does NOT collapse: a share that jumps straight to the OS sheet gives the
 * athlete no say over what the image looks like, and a completion that never
 * surfaces is a form confirming a save.
 */

/* ---------- THE POPUP IS RETIRED, AND THESE TWO TESTS WITH IT ----------
   THEY GUARDED A GATE, AND THE GATE'S PREMISE WAS WRONG. The popup was
   raised from the completion tick and from logging a distance that
   completed a session, never from applyCompletion() itself -- so a Strava
   backfill, a CSV import or a restore could not throw one modal per
   historical activity. That gate worked. What it could not fix is that at
   the tick nothing has been logged: no distance, no pace, no heart rate,
   no feel. The card that opened to tell an athlete how their session went
   was scoring an empty form, in the register of an arrival.

   So the moment is gone. renderExecutionReview() still renders in the day
   card and says the same thing once the figures are in; what was removed
   is the interruption, and with it the duplicate -- the popup and the
   inline review were both on screen at once, saying the same sentence.

   WHAT IS ASSERTED NOW is the thing that must stay true: no bulk write and
   no interaction raises a modal on completion at all, which is a strictly
   wider guard than the two-trigger gate it replaces. */
test('finishing a session opens no modal, from any path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.ok(!/raiseCompletionMoment/.test(code),
    'the completion popup is back; it fires before anything has been logged');
  assert.ok(!/wc-modal/.test(code), 'the completion popup\u2019s surface class is back');

  const fnBody = (name) => {
    const i = code.indexOf('function ' + name + '(');
    assert.ok(i > 0, name + ' not found');
    return code.slice(i, code.indexOf('\n}', i));
  };
  for (const fn of ['handleToggleComplete', 'handleActualFieldChange',
                    'applyCompletion', 'stravaWriteActivity', 'handleApplyCsvRow']) {
    assert.ok(!/openModal\(/.test(fnBody(fn)),
      fn + ' opens a modal on completion');
  }
  /* And the review itself is not lost -- it is in the card, where it can
     see the figures the athlete actually typed. */
  /* Matched on the mount and the call rather than on one exact string: the
     review has since moved UP the card, to sit with Share under "Session
     complete" instead of below the whole log, and this guard is about it
     being in the card at all -- not about which line of renderDayCard
     emits it. */
  /* THE MOUNT AND THE CALL, WITH WHATEVER IS BETWEEN THEM. The mount took
     a data-exec-review hook so patchExecutionUI can write EVERY copy of it
     -- a completed day's panel is now on This Week twice, in the canonical
     card and on the day's own slide, and getElementById was patching the
     hidden one. Pinning the exact characters between the id and the call
     made this fail on an attribute that does not change the claim. */
  assert.ok(/id="exec-review-'\+dd\.id\+'"[\s\S]{0,200}renderExecutionReview\(dd\)/.test(src),
    'the execution review left the day card');
});

test('Share opens the editor; it does not jump to the OS share sheet', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const i = code.indexOf("case 'share-workout':");
  assert.ok(i > 0);
  const line = code.slice(i, code.indexOf('break;', i));
  /* The editor opens in place now rather than over the app; either host is
     the editor. What this guards is unchanged and is the second assertion:
     Share to Socials must never reach the OS share sheet or write a file on
     its own -- the athlete approves an image first. */
  assert.ok(/toggleShareInline|openShareModal/.test(line),
    'Share to Socials opens the editor');
  assert.ok(!/saveBinaryFile|Share\.share/.test(line), 'and nothing else');
});

test('the editor offers overlay, picture source and format as three choices', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = src.indexOf('function shareComposerHtml()');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  /* source and format go through the seg() helper, which builds the data-k
     attribute from its argument -- so the literal never appears in source and
     the control is asserted at the call that creates it. */
  assert.match(body, /data-k="overlay"/, 'overlay picker');
  assert.match(body, /seg\('source'[\s\S]{0,120}SACORO[\s\S]{0,60}My photos/,
    'SACORO / My photos');
  assert.match(body, /seg\('format'[\s\S]{0,120}Story[\s\S]{0,40}Post/, 'Story / Post');
  assert.match(body, /data-action="share-export" data-mode="share"/);
  assert.match(body, /data-action="share-export" data-mode="save"/);
  assert.match(body, /withheldNote/, 'and it still explains a withheld metric');
});

test('changing the overlay changes nothing but the overlay', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const dd = completedDay();
  app.state.days = [dd];
  app.openShareModal(dd);
  const st = app.shareState;
  assert.ok(st, 'the editor opened');
  assert.equal(st.overlay, 'frame', 'defaults to the frame');
  assert.equal(st.source, 'sacoro', 'and to a SACORO backdrop');

  st.transform = { scale: 2.2, x: -0.3, y: 0.1 };
  const dataBefore = JSON.stringify(st.data);
  app.handleShareSet('overlay', 'diagonal');
  assert.equal(app.shareState.overlay, 'diagonal');
  assert.deepEqual(app.shareState.transform, { scale: 2.2, x: -0.3, y: 0.1 },
    'the athlete keeps the crop they framed');
  assert.equal(JSON.stringify(app.shareState.data), dataBefore,
    'and the workout data is untouched');
});

test('Save to photos writes to the photo library, not the cache', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = src.indexOf('function saveImageToPhotos(');
  assert.ok(i > 0, 'there is a dedicated save path');
  const body = src.slice(i, src.indexOf('\n}\n', i));

  /* The failure this guards is a renamed action: "Save to photos" wired to
     the share path, which caches the file and opens a sheet. */
  assert.match(body, /nativePlugin\('Media'\)/, 'it asks for the media library');
  assert.match(body, /savePhoto/);
  assert.ok(!/Share\.share|directory:\s*'CACHE'/.test(body),
    'and must not fall back to caching it and opening a share sheet');
  assert.match(body, /permission/i, 'a refused permission is explained');

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@capacitor-community/media'],
    'the plugin that makes it real is declared');
});

test('no social network is integrated, and nothing is uploaded', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = src.indexOf('var SHARE_OVERLAYS');
  const j = src.indexOf('function renderExecutionReview');
  /* Comments stripped: the ruling itself is written down in this file, and
     naming the networks in order to say they are NOT integrated must not trip
     the guard that checks they are not integrated. */
  const region = src.slice(i, j)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  /* The ruling is explicit: Share renders the image and hands it to the OS
     sheet. No branded chooser whose buttons all do the same thing, and no
     per-network deep links in this pass. */
  for (const banned of ['instagram', 'facebook', 'twitter', 'whatsapp',
                        'strava-share', 'fetch(', 'XMLHttpRequest']) {
    assert.ok(!region.toLowerCase().includes(banned.toLowerCase()),
      'the share path must not reference ' + banned);
  }
});

/* CONTROLLED, AND THE SESSION IT IS A CLAIM ABOUT
 * ===========================================================================
 * paceEased is computed from the pace band and the pace, and from nothing
 * else -- coachPaceEased() is handed no distance and asks for none. So on its
 * own evidence a fraction of a session run at a comfortable pace is
 * indistinguishable from the whole of it, and CONTROLLED was returned for a
 * session scoring 55% directly above the coach's own sentence that it "ran
 * well away from the session it was meant to be".
 *
 * These cases are the ones measured on the real engine during the audit, so
 * the table below is evidence rather than illustration. They are built
 * through buildPlan() for the same reason: an execution score has to come
 * from a real prescription, and a hand-written day cannot produce one.
 */
const { buildPlan } = require('./fixtures.js');

/* A prescribed long run, logged at a given fraction of its distance with the
   pace held at the middle of its own window -- which is squarely inside
   paceEased on every row, so distance is the only thing that varies. */
function longRunLoggedAt(fraction) {
  const { app } = buildPlan(loadApp({ pinnedDate: '2026-08-01' }),
    { distanceKey: 'full', weeks: 14, volume: 60, startDate: '2026-05-01' });
  const dd = app.state.days
    .filter(d => d.type === 'long' && d.km >= 18 && d.date < '2026-08-01')[0];
  const range = app.executionPaceTarget(dd);
  dd.completed = true;
  dd.actual = Object.assign(app.emptyActual(), {
    km: Math.round(dd.km * fraction * 10) / 10,
    pace: app.secToClock(Math.round((range.fast + range.slow) / 2)),
    paceUnit: 'km',
  });
  delete dd.coachReview;
  app.coachPersistReview(dd);
  return { app, dd, breakdown: app.computeExecutionBreakdown(dd) };
}

test('CONTROLLED answers to the execution score, not to pace alone', () => {
  /* The measured table. The verdict used to be constant down this whole
     column while the score fell by 45 points. */
  const CASES = [
    { fraction: 1.00, score: 100, verdict: 'CONTROLLED' },
    { fraction: 0.90, score: 95,  verdict: 'CONTROLLED' },
    { fraction: 0.80, score: 90,  verdict: 'CONTROLLED' },  // the bar itself
    { fraction: 0.70, score: 85,  verdict: null },
    { fraction: 0.60, score: 75,  verdict: null },
    { fraction: 0.50, score: 65,  verdict: null },
    { fraction: 0.40, score: 55,  verdict: null },          // the reported case
  ];
  for (const c of CASES) {
    const { app, dd, breakdown } = longRunLoggedAt(c.fraction);
    const pct = Math.round(c.fraction * 100) + '%';
    assert.equal(breakdown.score, c.score, pct + ': execution score moved');
    assert.equal(dd.coachReview.paceEased, true,
      pct + ': the fixture must stay inside paceEased, or it tests nothing');
    assert.equal(app.shareVerdictLabel(dd), c.verdict,
      pct + ' (score ' + c.score + ') returned the wrong verdict');
  }
});

test('the gate is the bar the app already had, not a new number', () => {
  const app = loadApp({ pinnedDate: '2026-08-01' });
  assert.equal(app.PLAYBOOK_GOOD_EXECUTION, 90,
    "the app's existing 'this went well' bar");
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = src.indexOf('function shareVerdictLabel');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(body, /PLAYBOOK_GOOD_EXECUTION/,
    'CONTROLLED must read the shared constant rather than a literal');
  assert.ok(!/paceEased\)\s*return 'CONTROLLED'/.test(body),
    'the ungated branch is gone');
});

test('the coaching conclusion behind it is untouched', () => {
  /* THE FIX IS IN THE PRESENTATION LAYER AND NOWHERE ELSE. paceEased is still
     true on a session that fell short -- the athlete really did run the part
     they ran inside the window -- and the coach still says so. What changed
     is only whether that one observation is promoted to a shareable verdict
     about the whole session. */
  const { app, dd, breakdown } = longRunLoggedAt(0.40);
  assert.equal(breakdown.score, 55);
  assert.equal(dd.coachReview.paceEased, true,
    'coachPaceEased must not have been narrowed');
  assert.equal(app.coachPaceEased(dd), true, 'and it still reports directly');
  assert.equal(app.shareVerdictLabel(dd), null, 'only the verdict withholds');

  // The coach's own sentence about the shortfall is still produced.
  const review = app.coachReviewFor(dd) || app.coachWorkoutReview(dd);
  assert.ok(review.executionVerdict && review.executionVerdict.length > 0,
    'the prose is unchanged and still explains the session');
});

test('the correction leaves the other rungs where they were', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = src.indexOf('function shareVerdictLabel');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  /* DIALED keeps its own >=99 band and its recovery-like exclusion; the
     fatigue rule still returns before any rung is tried. Pinned because this
     change sits two lines away from all three. */
  assert.match(body, /b\.score >= 99 && !isRecoveryLikeDay\(dd\)\) return 'DIALED'/);
  assert.match(body, /monitor_fatigue[\s\S]{0,80}recovery_priority'\) return null/);
  assert.match(body, /if \(r\.breakthrough\) return 'BREAKTHROUGH'/);
  assert.match(body, /'positive_adaptation'\) return 'ABSORBED'/);
});

test('a session with no verdict is still a session the athlete can share', () => {
  const { app, dd } = longRunLoggedAt(0.40);
  assert.equal(app.shareVerdictLabel(dd), null);
  const data = app.shareCardData(dd);
  assert.ok(data, 'the card is still composed');
  assert.equal(data.verdict, null);
  assert.equal(data.distanceKm, 7.2, 'and still says what was actually run');
  const ops = app.shareCardLayout(data, 'frame', { w: 1080, h: 1920, square: false });
  assert.ok(ops.length > 0, 'with a card to draw');
});

// ---------------------------------------------------------------------------
// THE MARK ON THE IMAGE THAT LEAVES THE APP
// ---------------------------------------------------------------------------
/* Founder, on the share image: "remove the V and swap the mountain icon
   that's on the home screen." And earlier, on where the company signs its
   work: "We could put it on the socials share overlays and the splash screen
   but I'm not sure it's needed everywhere."
   This is the one picture of the product that reaches people who have never
   seen it. So it carries the thing they could go and find -- the icon on a
   home screen -- the name between its two dots, and the company's byline. */

/* A canvas that records what was asked of it. The painter is the only part of
   sharing that needs a browser; this is enough of one to see what it draws. */
function recordingCtx() {
  const calls = [];
  const rec = name => function () { calls.push([name].concat(Array.prototype.slice.call(arguments))); };
  const ctx = {
    calls,
    measureText: t => ({ width: String(t).length * 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
   'quadraticCurveTo', 'bezierCurveTo', 'clip', 'fill', 'stroke', 'fillRect', 'strokeRect',
   'fillText', 'drawImage', 'translate', 'rotate', 'scale', 'setLineDash', 'roundRect']
    .forEach(n => { ctx[n] = rec(n); });
  return ctx;
}

test('every overlay signs the name: the byline sits under the wordmark and above what follows', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay({
    actual: { km: 28, pace: '5:31', movingTimeSec: 9258, elevationGainM: 312 },
    coachReview: { trainingSignal: 'positive_adaptation' },
  }));
  for (const size of [SIZE, { w: 1080, h: 1080, square: true }]) {
    for (const key of app.shareOverlayKeys()) {
      const ops = Array.prototype.slice.call(app.shareCardLayout(data, key, size));
      const wi = ops.findIndex(o => o.kind === 'wordmark');
      const by = ops[wi + 1];
      const where = key + (size.square ? ' (square)' : '');
      assert.ok(by && by.kind === 'byline', where + ' does not follow the name with the byline');
      assert.equal(by.text, 'BY VELVET VIKING', where + ' signs it as something else');
      const name = ops[wi];
      assert.ok(by.y >= name.y + name.size, where + ': the byline overlaps the name above it');
      assert.equal(by.align, name.align, where + ': the byline is aligned differently from the name');
      /* AND NOTHING WAS LEFT WHERE IT USED TO BE. The byline takes real height,
         so every row after it has to have moved down by at least that much --
         the first text row below must start under the byline, not through it. */
      const next = ops.slice(wi + 2).find(o => typeof o.y === 'number' &&
        ['headline', 'rule', 'distance', 'stack'].indexOf(o.kind) > -1);
      if (next) {
        assert.ok(next.y >= by.y + by.size,
          where + ': the ' + next.kind + ' starts at ' + next.y + ', inside the byline that ends at ' +
          (by.y + by.size));
      }
      /* Readable on the smallest export: the byline never drops under 1.5% of
         the width, which is 16px on a 1080 image. */
      assert.ok(by.size >= Math.round(size.w * 0.015), where + ': the byline is ' + by.size + 'px');
    }
  }
});

/* ---- CHANGED SIDES: A SHARE IMAGE CARRIES NO EMBLEM ----
   Two tests stood here: that the mark on a share image was the app icon, and
   that the painter drew the whole rounded tile. Founder, seeing it exported:
   "I don't like the S square app on the share function. I think that's best
   as just the app icon." So the tile is the home-screen icon and nothing
   else, and what signs a share image is the name between its dots and the
   byline -- the laws either side of this one. */
test('no share image carries an emblem: the S tile is the app icon and nothing else', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  ['SHARE_MARK', 'shareDrawMark', 'shareLoadMark', 'shareMarkPath', 'shareMarkSVG', 'shareMarkGeometry']
    .forEach(n => assert.equal(typeof app[n], 'undefined', n + ' is back'));
  const data = app.shareCardData(completedDay({
    actual: { km: 28, pace: '5:31', movingTimeSec: 9258, elevationGainM: 312 },
    coachReview: { trainingSignal: 'positive_adaptation' },
  }));
  for (const size of [SIZE, { w: 1080, h: 1080, square: true }]) {
    for (const key of app.shareOverlayKeys()) {
      const where = key + (size.square ? ' (square)' : '');
      const ops = Array.prototype.slice.call(app.shareCardLayout(data, key, size));
      assert.ok(!ops.some(o => o.kind === 'mark'), where + ' lays out an emblem');
      const asked = ops.find(o => o.kind === 'wordmark').size;
      const ctx = recordingCtx();
      app.shareCardPaint(ctx, ops, size.w);
      /* The overlay painter draws no image at all: the photograph is laid
         down before it, and the icon was the only picture it ever drew. */
      assert.equal(ctx.calls.filter(c => c[0] === 'drawImage').length, 0,
        where + ' paints an image into the overlay');
      /* AND THE NAME DID NOT PAY FOR THE ROOM. With the tile gone the name
         moved up, and on the wedge "up" is the point of a triangle: fitted
         there it came out a third of its size. The wedge still fits the
         name to its row, as it always has, which is why this is a floor
         and not an equality -- but the row has to be one it can be read on. */
      const painted = ops.find(o => o.kind === 'wordmark').size;
      assert.ok(painted >= asked * 0.6,
        where + ': the name was asked for at ' + asked + 'px and painted at ' + painted +
        'px, squeezed into the room the emblem used to stand in');
    }
  }
});

test('on the frame the name sits through the top rule, in a gap measured around it', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const data = app.shareCardData(completedDay({
    actual: { km: 28, pace: '5:31', movingTimeSec: 9258, elevationGainM: 312 },
  }));
  for (const size of [SIZE, { w: 1080, h: 1080, square: true }]) {
    const ops = Array.prototype.slice.call(app.shareCardLayout(data, 'frame', size));
    const frame = ops.find(o => o.kind === 'frame'), name = ops.find(o => o.kind === 'wordmark');
    assert.ok(Math.abs((name.y + name.size / 2) - frame.y) <= 1,
      'the name is not centred on the frame’s top rule');
    const ctx = recordingCtx();
    app.shareCardPaint(ctx, ops, size.w);
    const dots = ctx.calls.filter(c => c[0] === 'arc');
    const left = dots[0][1] - dots[0][3], right = dots[1][1] + dots[1][3];
    assert.ok(frame.gapFrom < left && frame.gapTo > right,
      'the rule runs through the name: gap ' + frame.gapFrom + '-' + frame.gapTo +
      ', name ' + left.toFixed(0) + '-' + right.toFixed(0));
    assert.ok(left - frame.gapFrom < size.w * 0.06 && frame.gapTo - right < size.w * 0.06,
      'the gap is far wider than the name it was cut for');
  }
});

test('the name is painted between two gold dots, and fitted with them', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const ctx = recordingCtx();
  /* A budget far too narrow for the size asked, so the fit has work to do. */
  const op = { kind: 'wordmark', cx: 540, y: 400, text: 'SACORO', size: 60, maxW: 150 };
  app.shareCardPaint(ctx, [op], 1080);
  const dots = ctx.calls.filter(c => c[0] === 'arc');
  assert.equal(dots.length, 2, 'the name is painted with ' + dots.length + ' dots, not one each side');
  const letters = ctx.calls.filter(c => c[0] === 'fillText');
  assert.equal(letters.map(c => c[1]).join(''), 'SACORO');
  const left = dots[0][1], right = dots[1][1];
  const first = letters[0][2], last = letters[letters.length - 1][2];
  assert.ok(left < first && right > last, 'a dot is inside the name rather than either side of it');
  /* THE DOTS ARE PART OF THE WIDTH. Fitted without them the name alone fills
     the budget and the dots hang outside it, which on a narrow rail is off
     the edge of the column. */
  const r = dots[0][3];
  assert.ok((right + r) - (left - r) <= op.maxW + 0.5,
    'the mark is ' + ((right + r) - (left - r)).toFixed(1) + 'px wide in a ' + op.maxW + 'px budget');
  assert.ok(op.size < 60, 'the name was not stepped down to make room');
  /* And centred as a whole -- dots included -- on the anchor it was given. */
  assert.ok(Math.abs(((left - r) + (right + r)) / 2 - op.cx) < 0.5, 'the mark is off its centre line');
});

test('the completion card in the app carries the same mark and the same byline', () => {
  const app = loadApp({ pinnedDate: '2026-11-03' });
  const SRC_ = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  /* WAS: the card draws the icon tile above the name. It previews the share
     image, and the share image has no tile now ("I don't like the S square
     app on the share function"), so neither does this. */
  assert.ok(SRC_.indexOf('wc-mark') === -1, 'the in-app card draws an emblem the share image does not');
  assert.match(SRC_, /<div class="wc-by">By Velvet Viking<\/div>/);
  assert.equal((SRC_.match(/class="wc-dot" aria-hidden="true"/g) || []).length, 2);
});
