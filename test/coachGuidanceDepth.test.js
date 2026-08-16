'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// "How to run this" is the strongest coaching in the product, and it used to be
// novice-only. Experience should decide how MUCH is written, never whether the
// aid exists -- there is no version of an athlete who is not allowed to look
// something up.
//
// Alongside it, three copy properties that are easy to regress: the card must
// not say the same thing twice, it must not turn an absence of concern into a
// positive claim, and an estimate must not be printed as though it were
// measured.
const PINNED = '2026-03-11T09:00:00Z';
const LEVELS = ['novice', 'experienced', 'advanced'];

function app(level) {
  const a = loadApp({ pinnedDate: PINNED });
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
  a.state.setup.experience = level;
  return a;
}
const dayWith = (a, archetype) => ({
  id: 'x', date: a.todayStr(), type: 'easy', title: 't', km: 10,
  prescription: { v: a.PRESCRIPTION_VERSION, archetype: archetype, params: { km: 10 } },
});
const wordCount = s => (s || '').trim().split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------------------
// AVAILABILITY AT EVERY LEVEL
// ---------------------------------------------------------------------------
test('every workout family offers the guidance at every experience level', () => {
  const missing = [];
  LEVELS.forEach(level => {
    const a = app(level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      if (!/How to run this/.test(a.renderCoachingDepth(dayWith(a, arch)))) missing.push(arch + '/' + level);
    });
  });
  assert.deepEqual(missing, [], 'no family may lose the coaching aid at any level');
});

test('a legacy day with no prescription still gets it, at every level', () => {
  const missing = [];
  LEVELS.forEach(level => {
    const a = app(level);
    Object.keys(a.COACH_GUIDANCE).filter(t => t !== 'rest').forEach(type => {
      const dd = { id: 'y', date: a.todayStr(), type: type, title: 't', km: 10 };
      if (!/How to run this/.test(a.renderCoachingDepth(dd))) missing.push(type + '/' + level);
    });
  });
  assert.deepEqual(missing, [], 'hand-edited and pre-prescription days are still coached');
});

test('all four headings are present for every family and level', () => {
  const gaps = [];
  LEVELS.forEach(level => {
    const a = app(level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      const g = a.coachingDisclosureFor(dayWith(a, arch), level);
      ['why', 'how', 'feel', 'avoid'].forEach(k => { if (!g || !g[k]) gaps.push(arch + '/' + level + '/' + k); });
    });
  });
  assert.deepEqual(gaps, [], 'WHY / HOW / FEEL / AVOID is the structure, at both depths');
});

// ---------------------------------------------------------------------------
// DEPTH CHANGES LENGTH, NOT AVAILABILITY
// ---------------------------------------------------------------------------
test('experienced copy is genuinely shorter than novice copy, everywhere', () => {
  const notShorter = [];
  const nov = app('novice'), exp = app('experienced');
  Object.keys(nov.ARCHETYPE_GUIDANCE).forEach(arch => {
    const n = nov.coachingDisclosureFor(dayWith(nov, arch), 'novice');
    const e = exp.coachingDisclosureFor(dayWith(exp, arch), 'experienced');
    const len = g => ['why', 'how', 'feel', 'avoid'].reduce((t, k) => t + wordCount(g[k]), 0);
    if (len(e) >= len(n)) notShorter.push(arch + ' (' + len(e) + ' vs ' + len(n) + ')');
  });
  assert.deepEqual(notShorter, [], 'depth is supposed to change verbosity');
});

test('the experienced copy is different text, not a truncation of the novice copy', () => {
  const nov = app('novice'), exp = app('experienced');
  const n = nov.coachingDisclosureFor(dayWith(nov, 'threshold_continuous'), 'novice');
  const e = exp.coachingDisclosureFor(dayWith(exp, 'threshold_continuous'), 'experienced');
  assert.notEqual(e.how, n.how);
  assert.ok(!n.how.startsWith(e.how.replace(/\.$/, '')), 'written short, not chopped');
  assert.ok(e.terse, 'and flagged as the terse variant');
});

test('advanced keeps its single essential cue AND gains the disclosure', () => {
  const a = app('advanced');
  const html = a.renderCoachingDepth(dayWith(a, 'progressive_tempo'));
  assert.match(html, /coach-cue/, 'the one-line cue an advanced athlete gets is unchanged');
  assert.match(html, /Start controlled/, 'and it is still the essential line, not the standing cue');
  assert.match(html, /How to run this/, 'the aid is available rather than withheld');
});

test('the guidance is a closed disclosure, so it costs no vertical space unopened', () => {
  LEVELS.forEach(level => {
    const a = app(level);
    const html = a.renderCoachingDepth(dayWith(a, 'easy_run'));
    assert.match(html, /<details class="fuel-card how-card">/);
    assert.ok(!/<details[^>]*\bopen\b/.test(html), 'never open by default at ' + level);
  });
});

test('a rest day stays silent for everyone but a novice, as before', () => {
  LEVELS.forEach(level => {
    const a = app(level);
    const dd = { id: 'r', date: a.todayStr(), type: 'rest', title: 'Rest', km: 0 };
    const html = a.renderCoachingDepth(dd);
    assert.ok(!/How to run this/.test(html), 'a rest day has no execution to explain');
    if (level !== 'novice') assert.equal(html, '');
  });
});

// ---------------------------------------------------------------------------
// THE VOICE HQ ASKED US TO PROTECT
// ---------------------------------------------------------------------------
test('the guidance lines HQ called out are still exactly as written', () => {
  const a = app('novice');
  const all = JSON.stringify(a.ARCHETYPE_GUIDANCE);
  [
    'Every surge should look the same.',
    'Comfortable and chatty.',
    'Easy early, honest work late.',
    'strong and controlled, not flat out',
    'Treating the surges as sprints',
  ].forEach(line => assert.ok(all.indexOf(line) !== -1, 'protected line missing: ' + line));
  assert.match(JSON.stringify(a.TERSE_GUIDANCE), /Every surge should look the same/,
    'the short version keeps the punchy line rather than flattening it');
});

test('the protected recommendation line survives on a real PROCEED quality day', () => {
  const a = app('experienced');
  const today = a.todayStr();
  a.state.days.filter(d => d.date < today && d.type !== 'rest').forEach(d => {
    const tr = a.executionPaceTarget(d), z = a.executionHRTarget(d), band = a.expectedRPEBand(d);
    d.completed = true;
    d.actual = { km: d.km, pace: a.secToPace(tr ? Math.round((tr.fast + tr.slow) / 2) : 330),
                 hr: z ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 10)) / 2) : 145,
                 rpe: band ? band[0] : 3, notes: '' };
  });
  const nxt = a.state.days.filter(d => !d.completed && d.type !== 'rest' && d.date >= today)
                          .sort((x, y) => x.date < y.date ? -1 : 1)[0];
  nxt.type = 'threshold';
  const mv = a.coachAnalyse().nextMove;
  assert.equal(mv.recommendation, 'Run it as prescribed. Hit the target window rather than beating it.');
});

test('terse copy stays terse -- no heading balloons into a paragraph', () => {
  const a = app('experienced');
  const long = [];
  Object.keys(a.TERSE_GUIDANCE).forEach(k => {
    ['why', 'how', 'feel', 'avoid'].forEach(f => {
      const v = a.TERSE_GUIDANCE[k][f];
      if (v && wordCount(v) > 16) long.push(k + '.' + f + ' (' + wordCount(v) + 'w)');
    });
  });
  assert.deepEqual(long, [], 'sharp means sharp');
});
