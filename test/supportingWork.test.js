'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* SUPPORTING WORK — STRENGTH, CONDITIONING AND MOBILITY
 * ===========================================================================
 * VALHALLA IS A RUNNING COACH, and the whole risk in this feature is that it
 * stops behaving like one. Three things are protected here, and every one of
 * them fails silently:
 *
 *   1. PERMISSION IS NOT A QUOTA. A YES gives leave to prescribe. If it
 *      quietly became "two gym days a week" the athlete would be doing extra
 *      training nobody decided was useful, and the plan would still look
 *      correct on screen. There is an explicit multi-week proof that weeks
 *      with nothing in them happen, in a real block, for real reasons.
 *
 *   2. RUNNING IS NEVER DISPLACED. Supporting work is a companion, not a day.
 *      It cannot consume a slot, cannot soften a session and cannot appear
 *      where doing so would cost a KEY objective — and the proof is a
 *      day-for-day comparison of the same plan with the preference on and off.
 *
 *   3. LOAD ONLY EVER SUBTRACTS. The engine must be able to conclude "the
 *      running is already providing enough stimulus". It must never be able to
 *      reason from a hard week to more work.
 */

const TODAY = '2026-09-03';

function app(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: (o.today || TODAY) + 'T09:00:00Z' });
  a.showToast = () => {}; a.scheduleSave = () => {}; a.renderApp = () => {};
  buildPlan(a, Object.assign({
    startDate: a.addDays(a.todayStr(), -35), weeks: 12
  }, o.plan || {}));
  if (o.purpose) a.state.setup.purpose = o.purpose;
  if (o.support !== false) a.state.setup.supportWork = 'on';
  return a;
}
/* Log the completed part of the block, so load, recovery and trends have real
   evidence to reason over rather than an empty history. */
function logHistory(a, quality){
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest')
    .forEach(d => logAsPrescribed(a, d, quality != null ? { quality } : undefined));
  return a;
}
const week = (a, n) => a.supportForWeek(n);
const kinds = (a, n) => week(a, n).map(x => x.kind);
const phaseOf = (a, n) => a.trainingPhase(n);
/* Every week of the block, as { phase, kinds } — the shape most of the
   phase-law assertions below read. */
function sweep(a){
  const out = [];
  for (let w = 1; w <= a.totalWeeksInPlan(); w++) out.push({ w, phase: phaseOf(a, w), kinds: kinds(a, w) });
  return out;
}
const STRENGTH = ['strength_foundation', 'strength_running', 'conditioning_circuit'];

// ---------------------------------------------------------------------------
// 1. PERMISSION
// ---------------------------------------------------------------------------

test('with no preference stored, nothing is ever prescribed', () => {
  const a = app({ support: false });
  assert.equal(a.state.setup.supportWork, undefined,
    'the fixture pre-set a preference, so this proves nothing');
  sweep(a).forEach(r => assert.equal(r.kinds.length, 0,
    'week ' + r.w + ' prescribed supporting work without permission'));
});

test('an explicit OFF is respected exactly as an absent answer is', () => {
  const a = app({ support: false });
  a.state.setup.supportWork = 'off';
  sweep(a).forEach(r => assert.equal(r.kinds.length, 0, 'week ' + r.w));
});

test('the builder writes the preference only when the athlete ticks it', () => {
  const a = app({ support: false });
  /* The builder reads a checkbox by id; absent means "a caller that predates
     this", and the stored value stands. Asserted through the stored shape
     rather than the DOM, which the sandbox does not have. */
  assert.equal(a.supportWorkEnabled({ supportWork: 'on' }), true);
  assert.equal(a.supportWorkEnabled({ supportWork: 'off' }), false);
  assert.equal(a.supportWorkEnabled({}), false, 'an absent answer opted the athlete in');
  assert.equal(a.supportWorkEnabled(null), false);
});

// ---------------------------------------------------------------------------
// 2. THE HEADLINE PROOF — YES IS NOT A WEEKLY QUOTA
// ---------------------------------------------------------------------------

test('YES does not mean supporting work every week', () => {
  /* A full 12-week race block, permission granted, history logged so load and
     recovery are real. The block must contain weeks with nothing in them. */
  const a = logHistory(app({}));
  const rows = sweep(a);
  const empty = rows.filter(r => !r.kinds.length);
  assert.ok(empty.length >= 2,
    'every week of the block carried supporting work, which is a quota: ' +
    rows.map(r => r.w + ':' + r.phase + '=' + (r.kinds.join('+') || 'none')).join(' '));
  /* And the empty weeks are not an accident of the end of the block: at least
     one must be a real training week, refused on capacity or adjacency rather
     than because the phase forbids everything. */
  const trainingEmpty = empty.filter(r => ['Base', 'Build', 'Peak', 'Maintain'].indexOf(r.phase) !== -1);
  assert.ok(trainingEmpty.length >= 1 || empty.length >= 3,
    'the only empty weeks were the taper, so nothing proves a week can simply not need it');
});

test('zero in a week is reachable from capacity alone, not only from the calendar', () => {
  /* Same athlete, same phase, one thing different: the running is expensive.
     THIS is the conclusion the brief asks for — the running is already
     providing enough stimulus, so adding strength would cost more than it
     gives. */
  const a = logHistory(app({}));
  const wk = a.currentWeekNum();
  const before = kinds(a, wk);
  a.coachLoad = () => ({ acute: 100, chronic: 50, ratio: 2.0, band: 'spike', enough: true });
  a.coachRecovery = () => ({ state: 'strained' });
  const after = kinds(a, wk);
  assert.ok(after.length <= before.length,
    'a strained, spiking week produced MORE supporting work than a fresh one');
  assert.ok(after.every(k => k === 'mobility_recovery'),
    'strength survived a spike in running load and a strained athlete: ' + after.join(', '));
});

test('rising running load can only ever reduce or remove, never create', () => {
  /* The one-directional law, asserted across every band rather than at one
     point. Nothing about a harder week may raise the ceiling. */
  const a = logHistory(app({}));
  const wk = a.currentWeekNum();
  const seen = {};
  ['low', 'productive', 'elevated', 'spike'].forEach(band => {
    a.coachLoad = () => ({ acute: 10, chronic: 10, ratio: 1, band, enough: true });
    seen[band] = kinds(a, wk);
  });
  const cost = ks => ks.reduce((s, k) => s + a.SUPPORT_KINDS[k].cost, 0);
  assert.ok(cost(seen.elevated) <= cost(seen.productive),
    'elevated load bought more supporting work than productive load');
  assert.ok(cost(seen.spike) <= cost(seen.elevated),
    'a spike bought more supporting work than merely elevated load');
});

test('elevated running load alone reduces supporting work, with nothing else changed', () => {
  /* WRITTEN BECAUSE A MUTATION SURVIVED. Test 5 stubs load AND recovery, so
     removing either one alone left the other still doing the job and the load
     gate could be deleted with every test still green. This changes exactly
     one signal, in a Base week where the phase ceiling is at its highest, so
     the only thing that can move the answer is the load band. */
  const a = app({});
  const cost = ks => ks.reduce((s, k) => s + a.SUPPORT_KINDS[k].cost, 0);
  a.coachLoad = () => ({ acute: 10, chronic: 10, ratio: 1.0, band: 'productive', enough: true });
  const productive = cost(kinds(a, 1));
  assert.ok(productive >= 2, 'a Base week with productive load prescribed nothing worth measuring');
  a.coachLoad = () => ({ acute: 15, chronic: 10, ratio: 1.45, band: 'elevated', enough: true });
  const elevated = cost(kinds(a, 1));
  assert.ok(elevated < productive,
    'elevated running load did not reduce supporting work (' + elevated + ' vs ' + productive + ')');
  a.coachLoad = () => ({ acute: 20, chronic: 10, ratio: 2.0, band: 'spike', enough: true });
  assert.ok(cost(kinds(a, 1)) <= elevated, 'a spike bought more than merely elevated load');
});

test('a strained athlete alone reduces supporting work, with nothing else changed', () => {
  /* The same gap on the other signal: recovery must do its own work rather
     than lean on the load gate standing beside it. */
  const a = app({});
  const cost = ks => ks.reduce((s, k) => s + a.SUPPORT_KINDS[k].cost, 0);
  const fresh = cost(kinds(a, 1));
  assert.ok(fresh >= 2, 'a Base week prescribed nothing worth measuring');
  a.coachRecovery = () => ({ state: 'watch' });
  const watch = cost(kinds(a, 1));
  assert.ok(watch <= fresh, 'an athlete worth watching was given more than a fresh one');
  a.coachRecovery = () => ({ state: 'strained' });
  const strained = cost(kinds(a, 1));
  assert.ok(strained < fresh,
    'a strained athlete was given as much supporting work as a fresh one');
  assert.ok(kinds(a, 1).every(k => k === 'mobility_recovery'),
    'strength survived a strained athlete: ' + kinds(a, 1).join(', '));
});

// ---------------------------------------------------------------------------
// 3. THE OTHER HEADLINE PROOF — RUNNING IS NEVER DISPLACED
// ---------------------------------------------------------------------------

test('supporting work never displaces or degrades a key running objective', () => {
  /* The same block built twice. Every running day must be identical, field for
     field, whether the preference is on or off — same dates, same types, same
     distances, same titles, same prescriptions. A companion that changed any
     of them would not be a companion. */
  const off = app({ support: false });
  const on  = app({});
  const shape = x => x.state.days.map(d => [d.date, d.type, d.km, d.title,
    d.prescription ? d.prescription.archetype : null].join('|')).join('\n');
  assert.equal(shape(on), shape(off),
    'the running plan changed when supporting work was switched on');

  /* And no companion is ever attached to a KEY session or the day before one. */
  const all = [];
  for (let w = 1; w <= on.totalWeeksInPlan(); w++) week(on, w).forEach(i => all.push(i));
  assert.ok(all.length > 0, 'nothing was prescribed at all, so this proves nothing');
  all.forEach(item => {
    const dd = on.state.days.filter(d => d.id === item.dayId)[0];
    assert.notEqual(on.sessionImportance(dd), 'KEY',
      'supporting work landed on a KEY session on ' + item.date);
    /* THE DAY BEFORE A KEY SESSION IS NOT BLANKET-REFUSED, and must not be:
       a blanket refusal is what made the deliberate post-long-run mobility
       rule unreachable on the commonest schedule in the app. What must hold is
       the invariant itself -- nothing DEMANDING may compromise an upcoming key
       session -- so the assertion is on cost, which is the thing that could
       actually do the compromising. */
    const nxt = on.state.days.filter(d => d.date === on.addDays(item.date, 1))[0];
    if (nxt && on.sessionImportance(nxt) === 'KEY'){
      assert.equal(on.SUPPORT_KINDS[item.kind].cost, 1,
        'demanding supporting work (' + item.kind + ') landed the day before a KEY session on ' + item.date);
    }
  });
});

test('it never lands on a quality, long or race day', () => {
  const a = app({});
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    week(a, w).forEach(item => {
      const dd = a.state.days.filter(d => d.id === item.dayId)[0];
      assert.ok(['easy', 'rest'].indexOf(dd.type) !== -1,
        'supporting work attached to a ' + dd.type + ' day on ' + item.date);
    });
  }
});

test('nothing is written into state.days, so a rebuild cannot duplicate it', () => {
  const a = app({});
  const before = JSON.stringify(a.state.days);
  for (let w = 1; w <= a.totalWeeksInPlan(); w++) week(a, w);
  assert.equal(JSON.stringify(a.state.days), before,
    'resolving supporting work mutated the plan');
});

// ---------------------------------------------------------------------------
// 4. PHASE LAW
// ---------------------------------------------------------------------------

test('Build allows robustness work only — no running strength, no circuits', () => {
  const a = app({});
  const build = sweep(a).filter(r => r.phase === 'Build');
  assert.ok(build.length, 'the fixture block has no Build weeks');
  build.forEach(r => r.kinds.forEach(k => {
    assert.ok(['strength_foundation', 'mobility_recovery'].indexOf(k) !== -1,
      'Build week ' + r.w + ' prescribed ' + k);
  }));
});

test('Peak allows maintenance cost only', () => {
  const a = app({});
  const peak = sweep(a).filter(r => r.phase === 'Peak');
  assert.ok(peak.length, 'the fixture block has no Peak weeks');
  peak.forEach(r => r.kinds.forEach(k => {
    assert.equal(a.SUPPORT_KINDS[k].cost, 1,
      'Peak week ' + r.w + ' prescribed ' + k + ' at cost ' + a.SUPPORT_KINDS[k].cost);
  }));
});

test('Taper, Race Week and Final Week prescribe no strength at all', () => {
  const a = app({});
  sweep(a).filter(r => ['Taper', 'Race Week', 'Final Week'].indexOf(r.phase) !== -1)
    .forEach(r => r.kinds.forEach(k => {
      assert.ok(STRENGTH.indexOf(k) === -1,
        r.phase + ' week ' + r.w + ' prescribed strength: ' + k);
    }));
});

test('a taper keeps mobility only where it is already how the athlete trains', () => {
  const a = logHistory(app({}));
  const taper = sweep(a).filter(r => r.phase === 'Taper');
  assert.ok(taper.length, 'no taper weeks in the fixture');
  /* Nothing habitual yet: the taper is silent. */
  taper.forEach(r => assert.equal(r.kinds.length, 0,
    'a taper introduced supporting work to an athlete who had never done any'));
  /* Now make it habitual by completing some, and only mobility may return. */
  const t = a.todayStr();
  const done = a.state.days.filter(d => d.date < t && d.type === 'easy').slice(-3);
  done.forEach(d => { d.support = { kind:'strength_foundation', completedAt: d.date + 'T18:00:00Z' }; });
  a.supportIsHabitual = () => true;
  sweep(a).filter(r => r.phase === 'Taper').forEach(r => r.kinds.forEach(k => {
    assert.equal(k, 'mobility_recovery', 'a taper brought back ' + k);
  }));
});

test('base and development phases may prescribe real strength', () => {
  const a = app({});
  const base = sweep(a).filter(r => r.phase === 'Base');
  assert.ok(base.some(r => r.kinds.some(k => STRENGTH.indexOf(k) !== -1)),
    'no phase of the block ever allows meaningful strength development');
});

test('a maintain block treats supporting work as a development phase', () => {
  const a = app({ purpose: 'maintain' });
  const rows = sweep(a);
  /* Not EVERY week: trainingPhase() names the week containing the goal effort
     after that effort, whatever the block's purpose, so the last week of a
     maintain block still reads Final Week. The phase under test is the rest. */
  const maintain = rows.filter(r => r.phase === 'Maintain');
  assert.ok(maintain.length >= rows.length - 1, 'the fixture is not a maintain block: ' +
    rows.map(r => r.phase).join(','));
  assert.ok(maintain.some(r => r.kinds.length), 'a maintain block prescribed nothing at all');
});

test('a recovery block allows mobility and foundation work only', () => {
  const a = app({ purpose: 'recovery' });
  sweep(a).forEach(r => r.kinds.forEach(k => {
    assert.ok(['mobility_recovery', 'strength_foundation'].indexOf(k) !== -1,
      'a recovery block prescribed ' + k);
  }));
});

test('marathon and half blocks thin rather than disappear', () => {
  ['full', 'half'].forEach(distanceKey => {
    const a = app({ plan: { distanceKey, weeks: 16, volume: 60 } });
    const rows = sweep(a);
    const early = rows.filter(r => r.phase === 'Base');
    const late = rows.filter(r => ['Peak', 'Taper', 'Final Week', 'Race Week'].indexOf(r.phase) !== -1);
    const cost = rs => rs.reduce((s, r) =>
      s + r.kinds.reduce((t, k) => t + a.SUPPORT_KINDS[k].cost, 0), 0) / Math.max(1, rs.length);
    assert.ok(cost(late) < cost(early),
      distanceKey + ': supporting work did not get cheaper as race demands rose');
  });
});

// ---------------------------------------------------------------------------
// 5. CONTEXT — WHAT RUNNING SURROUNDS IT
// ---------------------------------------------------------------------------

test('the day after a long run gets recovery-oriented work, never lower-body strength', () => {
  const a = app({});
  let checked = 0;
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    week(a, w).forEach(item => {
      const prev = a.state.days.filter(d => d.date === a.addDays(item.date, -1))[0];
      if (!prev || prev.type !== 'long') return;
      checked++;
      assert.equal(item.kind, 'mobility_recovery',
        'the day after a long run was given ' + item.kind + ' on ' + item.date);
    });
  }
  /* THE FIXTURE NEVER REACHES THIS RULE, and that is worth stating rather than
     hiding: in this schedule the day after every long run is also the day
     before the week's interval session, so the STRONGER adjacency rule refuses
     it first. Correct behaviour, and it has its own test — but it means the
     post-long-run rule is untested unless it is isolated.

     So the following day is neutralised to an easy run, removing the KEY
     adjacency and leaving exactly one reason for the answer. Without this the
     assertion would pass on a day that was refused for a different reason
     entirely, which is a test that proves nothing. */
  const longs = a.state.days.filter(d => d.type === 'long');
  assert.ok(longs.length, 'the fixture block has no long runs');
  let proven = 0;
  longs.forEach(l => {
    const after = a.state.days.filter(d => d.date === a.addDays(l.date, 1))[0];
    if (!after || ['easy', 'rest'].indexOf(after.type) === -1) return;
    const nxt = a.state.days.filter(x => x.date === a.addDays(after.date, 1))[0];
    const restore = nxt ? { type: nxt.type, km: nxt.km } : null;
    if (nxt && a.sessionImportance(nxt) === 'KEY'){ nxt.type = 'easy'; nxt.km = 6; }
    assert.notEqual(nxt && a.sessionImportance(nxt), 'KEY', 'the isolation did not take');
    const slot = a.supportDayEligible(after, a.state.days.filter(x => x.week === after.week));
    assert.ok(slot, 'a post-long-run day was refused even with no KEY session after it');
    assert.equal(slot.only.join(''), 'mobility_recovery',
      'the day after a long run allowed ' + slot.only.join('+'));
    assert.equal(slot.ceiling, 1, 'the day after a long run was not held to low-cost work');
    proven++;
    if (restore){ nxt.type = restore.type; nxt.km = restore.km; }
  });
  assert.ok(proven > 0 || checked, 'no post-long-run day was examined at all');
});

test('an easy day is permission, not a trigger', () => {
  /* The brief is explicit: an easy run does not automatically require strength
     afterwards simply because it is an easy day. Most easy days must carry
     nothing. */
  const a = logHistory(app({}));
  const easyDays = a.state.days.filter(d => d.type === 'easy');
  const attached = [];
  for (let w = 1; w <= a.totalWeeksInPlan(); w++) week(a, w).forEach(i => attached.push(i.dayId));
  const ratio = attached.length / Math.max(1, easyDays.length);
  assert.ok(ratio < 0.5,
    'supporting work attached to ' + Math.round(ratio * 100) + '% of easy days, which is slot-filling');
});

// ---------------------------------------------------------------------------
// 6. SAFETY AND ADAPTATION
// ---------------------------------------------------------------------------

test('pain or illness stops supporting work through the existing boundary', () => {
  const a = logHistory(app({}));
  const wk = a.currentWeekNum();
  assert.ok(kinds(a, wk).length >= 0);
  a.coachRecentSessions = () => [{ actual: { notes: 'calf pain today' } }];
  assert.equal(week(a, wk).length, 0, 'supporting work survived a pain report');
  a.coachRecentSessions = () => [];
  a.coachReadinessToday = () => ({ health: 'under' });
  assert.equal(week(a, wk).length, 0, 'supporting work survived an illness report');
});

test('poor readiness, elevated effort or negative feel regress it to low cost', () => {
  const a = logHistory(app({ plan: { weeks: 12 } }));
  const wk = 2;   // a Base week, where the ceiling is highest
  const rich = kinds(a, wk);
  a.athleteTrends = () => ([
    { id: 'rpe_elevated_quality', direction: 'negative', confidence: 'established' }
  ]);
  const poor = kinds(a, wk);
  const cost = ks => ks.reduce((s, k) => s + a.SUPPORT_KINDS[k].cost, 0);
  assert.ok(cost(poor) < cost(rich) || poor.every(k => k === 'mobility_recovery'),
    'effort above the athlete\'s own normal did not reduce supporting work');
});

test('repeatedly declining it stops the engine asking', () => {
  const a = logHistory(app({}));
  const wk = a.currentWeekNum();
  const t = a.todayStr();
  const past = a.state.days.filter(d => d.date < t && d.date >= a.addDays(t, -14)).slice(0, 2);
  assert.equal(past.length, 2, 'fixture does not have two recent past days');
  past.forEach(d => { d.support = { kind: null, dismissed: true, dismissedAt: d.date }; });
  assert.equal(week(a, wk).length, 0, 'the engine kept prescribing what the athlete kept declining');
});

test('well-tolerated work is not punished — completions do not suppress it', () => {
  const a = logHistory(app({}));
  const wk = a.currentWeekNum();
  const before = kinds(a, wk).length;
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type === 'easy').slice(-3)
    .forEach(d => { d.support = { kind:'strength_foundation', completedAt: d.date + 'T18:00:00Z' }; });
  assert.ok(kinds(a, wk).length >= before,
    'completing supporting work made the engine offer less of it');
});

test('variety: the same kind is not repeated where an alternative is allowed', () => {
  const a = app({});
  const w1 = week(a, 1);
  if (w1.length > 1) assert.notEqual(w1[0].kind, w1[1].kind,
    'two identical supporting sessions in one week');
});

// ---------------------------------------------------------------------------
// 7. THE RUNNING RECORD IS UNTOUCHED
// ---------------------------------------------------------------------------

test('weekly running volume, execution scoring, trends and baselines are unaffected', () => {
  const a = logHistory(app({}));
  const wk = a.currentWeekNum();
  const volBefore = JSON.stringify(a.weekVolume(wk));
  const trendsBefore = a.athleteTrends().map(t => t.id).join('|');
  const baseBefore = JSON.stringify(a.athleteBaselines().quality);
  const dd = a.state.days.filter(d => d.type === 'easy' && d.date < a.todayStr())[0];
  const scoreBefore = a.computeExecutionScore(dd);

  dd.support = { kind:'strength_running', completedAt: dd.date + 'T18:00:00Z' };

  assert.equal(JSON.stringify(a.weekVolume(wk)), volBefore, 'weekly volume moved');
  assert.equal(a.athleteTrends().map(t => t.id).join('|'), trendsBefore, 'the trends moved');
  assert.equal(JSON.stringify(a.athleteBaselines().quality), baseBefore, 'a baseline moved');
  assert.equal(a.computeExecutionScore(dd), scoreBefore, 'the execution score moved');
});

test('a completed companion is carried into the athlete record as its own field', () => {
  const a = logHistory(app({}));
  const dd = a.state.days.filter(d => d.type === 'easy' && d.date < a.todayStr())[0];
  dd.support = { kind:'strength_foundation', completedAt: dd.date + 'T18:00:00Z' };
  const rec = a.athleteMemoryFromDays(a.state.days, null).filter(r => r.date === dd.date)[0];
  assert.ok(rec, 'the day left no memory record');
  assert.ok(rec.support && rec.support.kind === 'strength_foundation',
    'the completion did not reach the record');
  /* And it is not mistaken for running: the record still describes the run. */
  assert.equal(rec.type, 'easy');
});

test('history survives a rebuild through the archive rather than the plan', () => {
  const a = logHistory(app({}));
  const t = a.todayStr();
  const past = a.state.days.filter(d => d.date < t && d.type === 'easy').slice(-2);
  past.forEach(d => { d.support = { kind:'strength_foundation', completedAt: d.date + 'T18:00:00Z' }; });
  assert.equal(a.supportIsHabitual(), true, 'two recent completions did not read as habitual');
  /* Archive the block and drop the live plan, as a rebuild does. */
  a.archiveCompletedSessions('block-1');
  a.state.days = [];
  assert.equal(a.supportRecentCompletions(28).length >= 2, true,
    'the archive lost the supporting-work history a rebuild depends on');
});

// ---------------------------------------------------------------------------
// 8. THE SESSION AND THE SURFACE
// ---------------------------------------------------------------------------

test('every kind carries the app’s existing four-part disclosure and real steps', () => {
  const a = app({});
  const ids = Object.keys(a.SUPPORT_KINDS);
  assert.equal(ids.length, 4, 'the taxonomy is no longer four kinds: ' + ids.join(', '));
  ids.forEach(id => {
    const k = a.SUPPORT_KINDS[id];
    ['why', 'how', 'feel', 'avoid', 'label'].forEach(f =>
      assert.ok(k[f] && k[f].length > 10, id + ' has no ' + f));
    assert.ok(k.steps.length >= 4, id + ' has no real step list');
    k.steps.forEach(s => assert.ok(s.label && s.qty, id + ' has a step with no quantity'));
    assert.ok(k.minutes > 0 && k.cost >= 1 && k.cost <= 3, id + ' has no usable cost or duration');
  });
});

test('the card renders the companion below the running, and nothing when there is none', () => {
  const a = app({});
  const items = week(a, 1);
  assert.ok(items.length, 'week 1 prescribed nothing, so this proves nothing');
  const dd = a.state.days.filter(d => d.id === items[0].dayId)[0];
  const html = a.renderSupportCompanion(dd);
  assert.ok(html.indexOf('Supporting work') !== -1);
  assert.ok(html.indexOf(a.SUPPORT_KINDS[items[0].kind].label) !== -1);
  assert.ok(html.indexOf('Avoid') !== -1, 'the coaching detail is not present at all');
  /* A day with no companion renders nothing at all — no empty container. */
  const key = a.state.days.filter(d => a.sessionImportance(d) === 'KEY')[0];
  assert.equal(a.renderSupportCompanion(key), '');
});

test('the companion is closed by default and the running stays the primary object', () => {
  /* THE HIERARCHY, ASSERTED RATHER THAN EYEBALLED. What must be visible
     without opening anything is exactly: that supporting work exists, what
     kind, roughly how long, and why. Everything else sits behind one
     disclosure — the same <details> the running session's own "How to run
     this" uses, not a new control. */
  const a = app({});
  const items = week(a, 1);
  assert.ok(items.length, 'week 1 prescribed nothing, so this proves nothing');
  const dd = a.state.days.filter(d => d.id === items[0].dayId)[0];
  const html = a.renderSupportCompanion(dd);
  const k = a.SUPPORT_KINDS[items[0].kind];

  /* Closed: <details> with no `open` attribute. */
  assert.ok(/<details class="[^"]*support-detail"/.test(html), 'no disclosure was used');
  assert.ok(!/<details[^>]*\sopen[\s>]/.test(html), 'the companion opens expanded by default');

  const collapsed = html.slice(0, html.indexOf('<details'));
  assert.ok(collapsed.indexOf('Supporting work') !== -1, 'the athlete is not told it exists');
  assert.ok(collapsed.indexOf(k.label) !== -1, 'the kind is hidden behind the disclosure');
  assert.ok(collapsed.indexOf(k.minutes + ' min') !== -1, 'the duration is hidden');
  assert.ok(collapsed.indexOf(a.escapeHtml(k.why)) !== -1, 'no purpose is given without opening it');

  /* And the movements and remaining coaching really are inside it. THE
     PRESCRIBED routine, read from the item -- a kind now has more than one
     coherent route through the same session, so k.steps is only the first of
     them and a card showing the second was failing an assertion about which
     routine rather than about the hierarchy this test is named for. */
  const steps = a.supportStepsFor(items[0]);
  assert.ok(steps.length, 'the item must carry a routine');
  const inside = html.slice(html.indexOf('<details'));
  assert.ok(inside.indexOf(steps[0].label) !== -1, 'the movement list is not behind the disclosure');
  ['How', 'Feel', 'Avoid'].forEach(key =>
    assert.ok(inside.indexOf('>' + key + '<') !== -1, key + ' is not behind the disclosure'));
  /* Nothing was lost in the move: every movement is still there. */
  steps.forEach(st => assert.ok(html.indexOf(st.label) !== -1, 'lost a movement: ' + st.label));
  /* And Why is said once, not twice. */
  assert.equal(html.split(a.escapeHtml(k.why)).length - 1, 1, 'the purpose is stated twice');
});

test('the companion is materially shorter than the running prescription it supports', () => {
  /* A proxy for vertical dominance that does not depend on pixels: the
     collapsed companion must not carry more content than the session it hangs
     off. Before this pass it carried six movements and four coaching rows on
     every card, whether or not the athlete wanted them. */
  const a = app({});
  const items = week(a, 1);
  const dd = a.state.days.filter(d => d.id === items[0].dayId)[0];
  const html = a.renderSupportCompanion(dd);
  const collapsed = html.slice(0, html.indexOf('<details'));
  const text = collapsed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(text.length < 220,
    'the collapsed companion is still a wall of text (' + text.length + ' chars): ' + text);
});

test('the day before a KEY session allows low-cost work only, and is not refused outright', () => {
  /* THE DEFECT THIS REPLACED. Both context rules were early returns with the
     KEY rule first, so on the app's commonest schedule — long run Sunday, rest
     Monday, intervals Tuesday — every post-long-run day was also the day
     before a key session, and the deliberate post-long-run mobility rule could
     never fire for the athletes it was written for. */
  /* THE ATHLETE THIS RULE WAS WRITTEN FOR HAS TWO QUALITY SESSIONS A WEEK.
     The commonest schedule in the app -- long run Sunday, rest Monday,
     intervals Tuesday -- is a two-quality week: with a single quality slot the
     session moves away from the day after the long run and the overlapping
     case simply stops occurring. Since quality frequency became earned rather
     than granted by the day count, the fixture has to say so or it describes a
     different athlete from the one whose bug this is. */
  const a = app({ plan: { earnedSecondQuality: true } });
  let sawBoth = 0, sawKeyOnly = 0;
  a.state.days.forEach(dd => {
    if (['easy', 'rest'].indexOf(dd.type) === -1) return;
    const prev = a.state.days.filter(x => x.date === a.addDays(dd.date, -1))[0];
    const next = a.state.days.filter(x => x.date === a.addDays(dd.date, 1))[0];
    const beforeKey = next && a.sessionImportance(next) === 'KEY';
    const afterLong = prev && prev.type === 'long';
    if (!beforeKey && !afterLong) return;
    const slot = a.supportDayEligible(dd, a.state.days.filter(x => x.week === dd.week));
    assert.ok(slot, 'a day was refused outright on ' + dd.date +
      ' (beforeKey=' + !!beforeKey + ' afterLong=' + !!afterLong + ')');
    assert.equal(slot.ceiling, 1, 'not held to low cost on ' + dd.date);
    assert.equal(slot.only.join(''), 'mobility_recovery', 'not mobility-only on ' + dd.date);
    if (beforeKey && afterLong) sawBoth++; else if (beforeKey) sawKeyOnly++;
  });
  assert.ok(sawBoth > 0,
    'the fixture never produced a day that is BOTH after a long run and before a key session, ' +
    'which is the exact case the old ordering got wrong');
});

test('a constrained day does not outrank a capable one merely by being earlier', () => {
  /* THE DEFECT THIS REPLACED, and it was invisible until someone tried to
     photograph a strength session. Candidates were taken in date order, and on
     the app's commonest schedule the first eligible day of every week is the
     Monday after the Sunday long run -- deliberately capped to low-cost
     mobility. It consumed the week's only slot every week, so a Base or Build
     block could never prescribe the strength development its phase explicitly
     allows. The engine had quietly become mobility-only for those athletes. */
  const a = app({});
  const rows = sweep(a).filter(r => ['Base', 'Build'].indexOf(r.phase) !== -1);
  assert.ok(rows.length >= 3, 'the fixture has too few development weeks');
  assert.ok(rows.some(r => r.kinds.some(k => STRENGTH.indexOf(k) !== -1)),
    'no development week prescribed any strength at all: ' +
    rows.map(r => r.w + ':' + (r.kinds.join('+') || 'none')).join(' '));

  /* And specifically: where a week contains BOTH a post-long-run day and an
     unconstrained one, the unconstrained day is the one that gets used. */
  let checked = 0;
  rows.forEach(r => {
    const days = a.state.days.filter(d => d.week === r.w);
    const slots = days.map(d => ({ d, s: a.supportDayEligible(d, days) })).filter(x => x.s);
    const constrained = slots.filter(x => x.s.ceiling === 1);
    const capable = slots.filter(x => x.s.ceiling > 1);
    if (!constrained.length || !capable.length) return;
    checked++;
    const picked = week(a, r.w);
    if (!picked.length) return;
    assert.ok(capable.some(x => x.d.id === picked[0].dayId),
      'week ' + r.w + ' spent its slot on a constrained day while a capable one was free');
  });
  assert.ok(checked > 0,
    'no week contained both a constrained and a capable day, so the ordering was never exercised');
});

test('supporting work does not appear merely because a KEY session occurred', () => {
  /* Nothing in the resolver triggers on a key session; a key session only ever
     restricts. Asserted by removing every key session from a week and checking
     supporting work does not vanish with them. */
  const a = app({});
  const withKey = kinds(a, 2).length;
  a.state.days.filter(d => d.week === 2 && a.sessionImportance(d) === 'KEY')
    .forEach(d => { d.type = 'easy'; d.km = 6; });
  assert.ok(kinds(a, 2).length >= withKey,
    'removing the key sessions removed the supporting work, so it was triggered BY them');
});

test('with the preference off the card renders nothing', () => {
  const a = app({ support: false });
  a.state.days.forEach(d => assert.equal(a.renderSupportCompanion(d), ''));
});

test('a completed companion collapses to one line and offers no scoring', () => {
  const a = app({});
  const dd = a.state.days.filter(d => d.type === 'easy')[0];
  dd.support = { kind:'mobility_recovery', completedAt: '2026-09-01T18:00:00Z' };
  const html = a.renderSupportCompanion(dd);
  assert.ok(html.indexOf('done') !== -1);
  assert.ok(html.indexOf('support-actions') === -1, 'a completed companion still offered its buttons');
  assert.ok(!/exec|score/i.test(html), 'supporting work was given an execution score');
});

test('declining is remembered, is not a completion, and one decline is not two', () => {
  /* WHAT "NOT TODAY" MEANS, established rather than assumed. It writes a
     dismissal, which is real evidence: two inside the recent window and
     supportRecentlyIgnored() stops the engine asking for the rest of the
     block. That is a genuine adaptation distinction from simply never logging
     it — an unlogged day is silent and changes nothing — so the action stays,
     subordinate to Mark done rather than beside it as an equal choice. */
  const a = app({});
  const t = a.todayStr();
  const past = a.state.days.filter(d => d.date <= t && d.date >= a.addDays(t, -14));
  assert.ok(past.length >= 2, 'fixture has too few recent days');

  /* One decline is not enough to stop anything. */
  past[0].support = { kind:null, dismissed:true, dismissedAt: past[0].date };
  assert.equal(a.supportRecentlyIgnored(), false, 'a single decline silenced the engine');

  /* Two is. */
  past[1].support = { kind:null, dismissed:true, dismissedAt: past[1].date };
  assert.equal(a.supportRecentlyIgnored(), true, 'two declines did not register');

  /* A decline is never mistaken for having done it. */
  assert.equal(a.supportRecentCompletions(28).length, 0,
    'a decline was counted as a completed session');
  assert.equal(a.supportIsHabitual(), false, 'declining twice made it look habitual');
});

test('declining takes effect immediately on the card that was declined', () => {
  const a = app({});
  const items = week(a, a.currentWeekNum());
  if (!items.length) return;
  const dd = a.state.days.filter(d => d.id === items[0].dayId)[0];
  assert.ok(a.renderSupportCompanion(dd).length > 0);
  a.handleSupportSkip(dd.id);
  assert.equal(a.renderSupportCompanion(dd), '',
    'the prescription was re-rendered underneath an athlete who had just declined it');
});

test('declining today counts today, not tomorrow', () => {
  const a = app({});
  const t = a.todayStr();
  const todayDay = a.state.days.filter(d => d.date === t)[0];
  const yesterday = a.state.days.filter(d => d.date === a.addDays(t, -1))[0];
  yesterday.support = { kind:null, dismissed:true, dismissedAt: yesterday.date };
  todayDay.support = { kind:null, dismissed:true, dismissedAt: t };
  assert.equal(a.supportRecentlyIgnored(), true,
    'declining twice, the second time today, had no effect until tomorrow');
});

test('the decline action is subordinate to logging it', () => {
  /* UPDATED FOR THE COMPLETION CONTROL, INTENT UNCHANGED. Logging used to be a
     .btn-ghost labelled "Mark done"; it is now the same circular completion
     ring the running session uses, so the markup this asserts on moved. What
     it is actually protecting has not: there is a way to log it, declining is
     still the quiet aside beside it, and neither is a primary button competing
     with the run. See test/supportingWorkCompletion.test.js for why the button
     went. */
  const a = app({});
  const items = week(a, 1);
  const dd = a.state.days.filter(d => d.id === items[0].dayId)[0];
  const html = a.renderSupportCompanion(dd);
  assert.ok(/data-action="support-done"/.test(html.replace(/\n/g, '')),
    'there is no way to log it');
  assert.ok(html.indexOf('>Mark done<') !== -1, 'the log action is not named');
  assert.ok(html.indexOf('class="support-skip"') !== -1,
    'the decline is still styled as an equal button rather than a quiet aside');
  assert.ok(html.indexOf('btn-primary') === -1,
    'the companion carries a primary button, competing with the running session');
});

test('the Settings control reflects and toggles the stored preference', () => {
  const a = app({});
  assert.ok(a.renderSupportWorkRow().indexOf('aria-pressed="true"') !== -1);
  a.handleSetSupportWork(false);
  assert.equal(a.state.setup.supportWork, 'off');
  assert.ok(a.renderSupportWorkRow().indexOf('aria-pressed="false"') !== -1);
  a.handleSetSupportWork(true);
  assert.equal(a.state.setup.supportWork, 'on');
});

test('logging is additive and declining is remembered', () => {
  const a = app({});
  const items = week(a, a.currentWeekNum());
  if (!items.length) return;
  /* THE DAY HAS TO BE TODAY NOW. Supporting work inherits the running
     session's date rule, so handleSupportDone() refuses a day that has not
     arrived -- which is the point of that change, and used to be the bug. The
     week's first companion is not necessarily today's, so the day under test
     is moved onto today rather than the rule being worked around. */
  const dd = a.state.days.filter(d => d.id === items[0].dayId)[0];
  dd.date = a.todayStr(); dd.id = dd.date;
  const km = dd.km, type = dd.type, completed = dd.completed;
  a.handleSupportDone(dd.id);
  assert.ok(dd.support.completedAt, 'nothing was logged');
  assert.equal(dd.km, km); assert.equal(dd.type, type); assert.equal(dd.completed, completed);
  const dd2 = a.state.days.filter(d => d.type === 'easy')[1];
  a.handleSupportSkip(dd2.id);
  assert.equal(dd2.support.dismissed, true);
});

/* ---------------------------------------------------------------------------
   WHERE THE PERMISSION IS ASKED
   ---------------------------------------------------------------------------
   It used to be introduced on Review, which is the wrong screen to meet a
   question for the first time: Review confirms decisions, it does not take
   them. It now sits on stage 07 with the two other decisions about the shape
   of a training week -- which days are run, and which one is long -- and
   Review states the answer back read-only.

   The builder's markup is inspected the way test/builderNineStages.test.js
   already does it: openSetupModal() hands its HTML to openModal(), which is
   intercepted. No browser, and no second idea of what a panel is.
--------------------------------------------------------------------------- */
function journey(mutate){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.scheduleSave = () => {}; a.renderApp = () => {};
  if (mutate) mutate(a);
  let html = null;
  a.openModal = h => { html = h; };
  a.openSetupModal();
  assert.ok(html, 'openSetupModal() did not open anything');
  return { a, html };
}
function panelBodies(html){
  const out = [];
  const re = /<section class="bld-panel" data-stage="(\d+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ stage:+m[1], at:m.index });
  out.forEach((p, i) => { p.body = html.slice(p.at, i+1 < out.length ? out[i+1].at : html.length); });
  return out;
}

test('the permission is presented on stage 07, with the week it belongs to', () => {
  const { html } = journey();
  const p = panelBodies(html);
  assert.equal(p.length, 10, 'the builder no longer renders ten panels');
  const week = p.filter(x => x.stage === 6)[0];
  assert.ok(week, 'stage 07 (Your week) was not found');
  assert.ok(week.body.indexOf('id="su-support-work"') !== -1,
    'the permission is not on the week stage');
  /* And exactly once in the whole journey -- two copies would mean two ids and
     a Generate that reads whichever the DOM hands it first. */
  assert.equal((html.match(/id="su-support-work"/g) || []).length, 1);
});

test('it sits below the long run day and above the stage actions', () => {
  const week = panelBodies(journey().html).filter(x => x.stage === 6)[0];
  assert.ok(week, 'stage 07 was not found');
  const html = week.body;
  const longAt = html.indexOf('id="f-longday"');
  const supportAt = html.indexOf('id="su-support-work"');
  const navAt = html.indexOf('data-action="bld-next"');
  assert.ok(longAt !== -1 && supportAt !== -1 && navAt !== -1,
    'week stage is missing one of long-run day, the permission, or its actions');
  assert.ok(longAt < supportAt, 'the permission is above the long run day');
  assert.ok(supportAt < navAt, 'the permission is below the Back / Continue actions');
});

test('the concise copy is the week stage’s, and it still says a tick is not a quota', () => {
  const week = panelBodies(journey().html).filter(x => x.stage === 6)[0].body;
  assert.ok(week.indexOf('Supporting work') !== -1, 'the section is unnamed');
  assert.ok(week.indexOf('Include strength &amp; mobility work') !== -1, 'the question changed');
  assert.match(week, /Valhalla may add strength, conditioning or mobility where it helps your running/);
  assert.match(week, /Some weeks may have none/,
    'nothing on the screen prevents the tick being read as a guaranteed weekly session');
});

test('Review no longer offers the decision — it states it back', () => {
  const { html } = journey();
  const review = panelBodies(html).filter(x => x.stage === 9)[0].body;
  assert.ok(review.indexOf('id="su-support-work"') === -1,
    'Review still carries an interactive permission control');
  assert.ok(review.indexOf('bld-review') !== -1, 'Review lost its summary container');
});

test('the Review summary reads the stage 07 tick, On or Off', () => {
  /* bldRenderReview() reads the live DOM, which the sandbox does not have, so
     the row builder is exercised through its own source rather than guessed
     at: the key it uses and both values it can produce. */
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = src.slice(src.indexOf('function bldRenderReview'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /getElementById\('su-support-work'\)/,
    'Review does not read the stage 07 tick, so it could disagree with what is stored');
  assert.match(body, /SUPPORT_COPY\.reviewKey/, 'the summary row has no key');
  assert.match(body, /\? 'On' : 'Off'/, 'the summary does not state On or Off');
  assert.equal(a.SUPPORT_COPY.reviewKey, 'Strength & mobility');
});

test('the health permission has not moved', () => {
  /* Explicitly pinned: this pass moved one control and must not have taken the
     other with it. Consent still lives on Review, where it is recorded. */
  const { html } = journey(a => { a.state.healthConsent = null; });
  const p = panelBodies(html);
  const review = p.filter(x => x.stage === 9)[0].body;
  const week = p.filter(x => x.stage === 6)[0].body;
  assert.ok(review.indexOf('id="su-health-consent"') !== -1,
    'the health permission left the Review stage');
  assert.ok(week.indexOf('id="su-health-consent"') === -1,
    'the health permission followed supporting work onto the week stage');
});

test('stage 07 still validates on its own questions, not on the permission', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = src.slice(src.indexOf('function bldValidateStage'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  /* The week stage's rule is about running days; adding a permission to the
     screen must not have added a rule, and must not be able to block it. */
  assert.match(body, /BLD_STAGE\.WEEK/, 'the week stage lost its validation');
  assert.ok(body.indexOf('su-support-work') === -1,
    'the permission became a validation gate — a tick can now block the builder');
  assert.equal(a.BLD_STAGE.WEEK, 6, 'the week stage moved');
});

test('the tick still writes the same stored value, and off is still off', () => {
  const a = app({});
  a.state.setup.supportWork = 'off';
  assert.equal(a.supportWorkEnabled(), false);
  a.state.setup.supportWork = 'on';
  assert.equal(a.supportWorkEnabled(), true);
  /* Rendered from the stored value, so re-opening the builder shows what the
     athlete chose rather than an unticked box. */
  assert.ok(a.renderSupportWorkStep().indexOf('checked') !== -1);
  a.state.setup.supportWork = 'off';
  assert.ok(a.renderSupportWorkStep().indexOf('checked') === -1);
});

test('the generator reads the tick wherever its panel lives', () => {
  /* Panels are hidden, never unmounted, so moving the control between stages
     cannot change what Generate can see. Pinned because it is the one thing
     that would break silently: the plan would build with the permission
     always off and nothing on screen would say so. */
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = src.slice(src.indexOf('async function handleGeneratePlan'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /getElementById\('su-support-work'\)/,
    'Generate no longer reads the permission');
  assert.match(body, /supportWork: supportPref/, 'Generate no longer stores it');
  const { html } = journey();
  assert.ok(html.indexOf('hidden') !== -1, 'panels are no longer hidden-but-mounted');
});

test('the plan itself is unchanged by where the question is asked', () => {
  /* The move is placement only. Same block, same days, same prescriptions --
     the permission changes what companions are RESOLVED, never what is built. */
  const off = app({ support:false });
  const on  = app({});
  const shape = x => x.state.days.map(d => [d.date, d.type, d.km, d.title,
    d.prescription ? d.prescription.archetype : null].join('|')).join('\n');
  assert.equal(shape(on), shape(off), 'the generated plan differs with the permission on');
  assert.equal(on.state.setup.supportWork, 'on');
  assert.equal(off.state.setup.supportWork, undefined);
});

test('the builder stays at ten stages and /start is untouched', () => {
  const spec = require('../assets/builder-spec.js');
  assert.equal(spec.stages.length, 10, 'the canonical builder gained or lost a stage');
  assert.equal(spec.stages[6].key, 'WEEK');
  const start = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'start.html'), 'utf8');
  assert.ok(start.indexOf('su-support-work') === -1,
    '/start gained the supporting-work control');
});
