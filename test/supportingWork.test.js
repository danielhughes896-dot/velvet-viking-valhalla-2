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
    const nxt = on.state.days.filter(d => d.date === on.addDays(item.date, 1))[0];
    if (nxt) assert.notEqual(on.sessionImportance(nxt), 'KEY',
      'supporting work landed the day before a KEY session on ' + item.date);
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
  assert.ok(html.indexOf('Why') !== -1 && html.indexOf('Avoid') !== -1);
  /* A day with no companion renders nothing at all — no empty container. */
  const key = a.state.days.filter(d => a.sessionImportance(d) === 'KEY')[0];
  assert.equal(a.renderSupportCompanion(key), '');
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
  const dd = a.state.days.filter(d => d.id === items[0].dayId)[0];
  const km = dd.km, type = dd.type, completed = dd.completed;
  a.handleSupportDone(dd.id);
  assert.ok(dd.support.completedAt, 'nothing was logged');
  assert.equal(dd.km, km); assert.equal(dd.type, type); assert.equal(dd.completed, completed);
  const dd2 = a.state.days.filter(d => d.type === 'easy')[1];
  a.handleSupportSkip(dd2.id);
  assert.equal(dd2.support.dismissed, true);
});

test('the builder stays at ten stages and the question lives on Review', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const spec = require('../assets/builder-spec.js');
  assert.equal(spec.stages.length, 10, 'the canonical builder gained a stage');
  /* The control is rendered inside the Review stage's optional panel, beside
     the health permission — not as a stage of its own. */
  assert.ok(src.indexOf('su-support-work') !== -1);
  const review = src.slice(src.indexOf('/* ---------- 10 REVIEW ----------'));
  assert.ok(review.slice(0, 2000).indexOf('supportStep') !== -1,
    'the supporting-work question is not on the Review stage');
});
