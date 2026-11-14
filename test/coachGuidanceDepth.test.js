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

function app(level, planOpts) {
  const a = loadApp({ pinnedDate: PINNED });
  buildPlan(a, Object.assign({ weeks: 14, startDate: a.addDays(a.todayStr(), -56) },
                             planOpts || {}));
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
/* ---------- WHAT CARRIES THE AID, PER FAMILY ----------
   The aid used to be one thing: a disclosure headed "How to run this" (or
   "Session Details" once logged). It is three things now. Where a session
   has a rail of stage cards, the founder's instruction moved the coaching
   onto them -- "the rail becomes the coach: each part tells the athlete
   what to do and how to execute it when they are looking at that part" --
   with the purpose below the rail in WHY THIS SESSION, and the disclosure
   was removed because both its halves were then empty. Where there is no
   such rail, the disclosure or the solo note still carries it.
   ASKED OF THE WHOLE CARD, because that is the only place all three can be
   seen; renderCoachingDepth() alone can no longer answer the question this
   file is about. */
function aidCarrier(a, dd) {
  const html = a.renderDayCard(dd);
  if (/How to run this|Session Details/.test(html)) return 'disclosure';
  if (/class="fuel-body ws-rail/.test(html) && html.indexOf('class="why-session"') > -1)
    return 'rail+why';
  if (html.indexOf('class="how-note"') > -1) return 'note';
  return null;
}

test('every workout family offers the guidance at every experience level', () => {
  const missing = [];
  const carriers = {};
  LEVELS.forEach(level => {
    const a = app(level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      const c = aidCarrier(a, dayWith(a, arch));
      if (!c) missing.push(arch + '/' + level);
      (carriers[arch] = carriers[arch] || {})[level] = c;
    });
  });
  assert.deepEqual(missing, [], 'no family may lose the coaching aid at any level');
  /* AND EXPERIENCE DOES NOT DECIDE WHERE IT IS EITHER. The original law
     said experience may decide how MUCH is written, never whether the aid
     exists -- which it checked by looking for one fixed element. With three
     possible carriers that check would pass a build where novices got a
     disclosure and advanced athletes got nothing but a rail, so the stronger
     half of the claim is now stated outright: same family, same carrier, at
     every level. */
  const varies = Object.keys(carriers).filter(arch =>
    new Set(LEVELS.map(l => carriers[arch][l])).size > 1);
  assert.deepEqual(varies, [],
    'the aid moves house with experience, which is the defect this file was opened for');
});

test('a legacy day with no prescription still gets it, at every level', () => {
  const missing = [];
  LEVELS.forEach(level => {
    const a = app(level);
    Object.keys(a.COACH_GUIDANCE).filter(t => t !== 'rest').forEach(type => {
      const dd = { id: 'y', date: a.todayStr(), type: type, title: 't', km: 10 };
      if (!/How to run this|Session Details/.test(a.renderCoachingDepth(dd))) missing.push(type + '/' + level);
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
  /* THE AID IS AVAILABLE, AND FOR THIS FAMILY IT IS THE RAIL. A
     progressive tempo is a blueprint session: its coaching rides the stage
     cards and its purpose rides WHY THIS SESSION, so there is no
     disclosure to find and asking for one asked for the old furniture.
     The claim -- available rather than withheld -- is asked of the card. */
  assert.equal(aidCarrier(a, dayWith(a, 'progressive_tempo')), 'rail+why',
    'the aid is available rather than withheld');
});

test('the guidance is a closed disclosure, so it costs no vertical space unopened', () => {
  LEVELS.forEach(level => {
    const a = app(level);
    /* ON THE SURFACES WHERE IT IS ONE. The focused session -- Today, This
       Week's opened day, Full Plan's session screen -- shows one session
       and nothing else, and its instructions are most of the reason the
       screen exists; they render open there, with no summary to press. In
       a week LISTING, where the card is one of several, it is still a
       closed disclosure and costs no vertical space, which is what this
       has always been about. */
    /* ---- ASKED OF A SESSION THAT STILL COLLAPSES ----
       An easy run is a solo-note day now: no rail, no modules, two lines in
       a box, and the founder asked for it on every screen -- "that needs to
       follow the every place a day card is" -- so it is deliberately open
       in a listing too. It is no longer an example of this law.
       NOR IS A TRACK SESSION, ANY MORE. It was the example here, because it
       had the rail and the modules this law is about. It has no disclosure
       at all now: the rail carries its coaching and WHY THIS SESSION
       carries its purpose, so there is nothing left to collapse and nothing
       taking vertical space unopened either.
       A THRESHOLD CALIBRATION STILL HAS ONE -- four stages, no blueprint,
       not a solo note -- so the modules still ship inside a <details> and
       the law has something to hold. Checked at all three levels, which is
       what the loop around this is for. */
    a.state.view = 'week';
    const html = a.renderCoachingDepth(dayWith(a, 'threshold_calibration'));
    /* .is-static NOW RIDES IT ON EVERY SURFACE. Founder: "How to run this
       on the left should not be a thing." That class is what hides the
       summary, and it stopped being conditional so the summary cannot
       reappear on a surface nobody tested. What stayed conditional is
       OPEN, which is the half this law is about. */
    assert.match(html, /<details class="fuel-card how-card is-static">/);
    assert.ok(!/<details[^>]*\bopen\b/.test(html), 'never open by default at ' + level);
    assert.ok(!/How to run this<span class="fuel-chevron"/.test(html),
      'the pressable "How to run this" summary is back at ' + level);
  });
});

test('a rest day explains itself, and explains nothing it does not have', () => {
  /* WAS "a rest day stays silent for everyone but a novice", asserting
     renderCoachingDepth() === '' above novice. That silence was the defect,
     not the rule: Today opened on a rest day with two chips and a line of
     stage directions, and the cue written for rest days -- "Rest is part of
     the plan, adaptation happens on the days you don't run" -- had been in
     the product all along, computed below the early return that sends rest
     days home so nothing could reach it. Changed on the founder's call.
     WHAT SURVIVES UNCHANGED is the half this test was really protecting: a
     rest day has no execution to explain, so it gets no disclosure, no
     rail, no fuel -- it gets one sentence. */
  LEVELS.forEach(level => {
    const a = app(level);
    const dd = { id: 'r', date: a.todayStr(), type: 'rest', title: 'Rest', km: 0 };
    const html = a.renderCoachingDepth(dd);
    assert.ok(!/How to run this|Session Details/.test(html), 'a rest day has no execution to explain, at ' + level);
    assert.ok(!/fuel-body|how-mod|exec-rail|how-table/.test(html),
      'a rest day has grown a coaching rail at ' + level + ' — it has one sentence, not a session');
  /* THE REST CUE IS CONTEXTUAL NOW, so this asks for the line this day
     actually resolves to rather than one particular sentence. A rest day in
     Base and a rest day in Taper are explaining different things on purpose
     -- that is the repetition fix. What the law still protects is that the
     rest day IS coached, in both positions, from the rest pool. */
    const restLine = a.coachingEntryFor(dd).cue;
    assert.ok(html.indexOf(a.escapeHtml(restLine)) !== -1,
      'the rest day is silent again at ' + level);
    /* One sentence means one sentence: the note for a focused session and
       the inline cue for a list, which are two POSITIONS of it, not two. */
    assert.equal(html.split(a.escapeHtml(restLine)).length - 1, 2,
      'the rest cue is not in exactly its two positions (note + inline cue) at ' + level);
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
  /* "A REAL PROCEED DAY" IS A PRECONDITION, AND IT HAS TO BE ASSERTED. The
     recommendation this test protects is the one an athlete gets when nothing
     in recent training argues either way. A block carrying one quality session
     a week logs a recent seven days lighter than its own four-week average --
     acute:chronic 0.75, band 'low' -- and the card correctly says load has
     dropped off instead. That is a different day, not a different sentence.
     The fixture describes an athlete whose recent load is productive, and now
     says so before asserting what they are told. */
  const a = app('experienced', { earnedSecondQuality: true });
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
  assert.equal(a.coachLoad().band, 'productive',
    'precondition: a PROCEED day means recent load is productive, and it is ' +
    a.coachLoad().band + ' at ' + a.coachLoad().ratio.toFixed(2) + 'x');
  const mv = a.coachAnalyse().nextMove;
  assert.equal(mv.recommendation, 'Run it as prescribed. Landing inside the target window is the session. Beating it is not a bonus.');
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
