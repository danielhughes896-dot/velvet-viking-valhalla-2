'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// UNIT CONSISTENCY IN ATHLETE-FACING PROSE.
//
// The reported defect: a tester on MILES opened "How to run this" on an easy
// run and read "Hold the easy window from the first kilometre to the last."
// directly underneath a target line quoted in /mi and a distance quoted in mi.
//
// The numbers were never wrong. displayUnit(), kmToDisplay(), fmtDist() and
// paceSecToDisplay() all read state.units and always did. What was wrong is
// that the coaching PROSE never asked: the guidance tables, the Execution
// Strategy phase copy and the trend sentences were frozen literals with the
// word "kilometre" typed into them, so a preference that governed every number
// on the card governed none of the words.
//
// The fix is one preference, two spellings. displayUnitNoun() sits beside
// displayUnit() and reads exactly the same state.units; resolveDesc() -- the
// formatter that already existed for @@D:/@@T: distance tokens -- gained @@U@@
// for the noun; and every read of a copy table goes through that formatter.
// These tests hold both halves: the sentence must follow the setting, and no
// second unit-selection path may reappear.
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

const TODAY = '2026-05-20';
const LEVELS = ['novice', 'experienced', 'advanced'];
const UNITS = ['km', 'mi'];

function app(units, level) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays(TODAY, -28),
                 distanceKey: 'full', volume: 60,
                 benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  a.state.setup.experience = level || 'experienced';
  a.state.units = units;
  return a;
}
const dayWith = (a, archetype) => ({
  id: 'x', date: a.todayStr(), type: 'easy', title: 't', km: 10,
  prescription: { v: a.PRESCRIPTION_VERSION, archetype: archetype, params: { km: 10 } },
});
function dayOf(a, archetype) {
  return a.state.days.filter(x => {
    const p = a.prescriptionOf(x);
    return p && p.archetype === archetype;
  })[0] || null;
}
// The words this suite polices, in both spellings and both numbers.
const KM_WORD = /kilometre|kilometer|kilometres|kilometers/i;
const MI_WORD = /\bmiles?\b/i;

// ---------------------------------------------------------------------------
// 1. THE REPORTED CASE, EXACTLY AS REPORTED
// ---------------------------------------------------------------------------
test('the reported sentence follows the unit selection', () => {
  const mi = app('mi');
  const html = mi.renderCoachingDepth(dayWith(mi, 'easy_run'));
  assert.match(html, /from the first mile to the last/,
    'a tester on miles must be told about the first MILE');
  assert.doesNotMatch(html, KM_WORD,
    'the reported defect: "kilometre" survived on a miles card');
});

test('the same sentence is unchanged for an athlete on kilometres', () => {
  const km = app('km');
  const html = km.renderCoachingDepth(dayWith(km, 'easy_run'));
  assert.match(html, /from the first kilometre to the last/);
  assert.doesNotMatch(html, MI_WORD, 'nothing about miles belongs on a km card');
});

test('toggling units re-renders the sentence rather than freezing the first read', () => {
  const a = app('km');
  const day = dayWith(a, 'easy_run');
  assert.match(a.renderCoachingDepth(day), /first kilometre/);
  a.state.units = 'mi';
  assert.match(a.renderCoachingDepth(day), /first mile/,
    'the copy is resolved on render, so a toggle is enough');
  a.state.units = 'km';
  assert.match(a.renderCoachingDepth(day), /first kilometre/, 'and it comes back');
});

// ---------------------------------------------------------------------------
// 2. ONE SOURCE OF TRUTH
// ---------------------------------------------------------------------------
test('displayUnitNoun agrees with displayUnit, in both settings', () => {
  const km = app('km'), mi = app('mi');
  assert.equal(km.displayUnit(), 'km');
  assert.equal(km.displayUnitNoun(), 'kilometre');
  assert.equal(mi.displayUnit(), 'mi');
  assert.equal(mi.displayUnitNoun(), 'mile');
});

test('the noun is derived from state.units and nothing else', () => {
  const a = app('km');
  assert.equal(a.displayUnitNoun(), 'kilometre');
  a.state.units = 'mi';
  assert.equal(a.displayUnitNoun(), 'mile', 'no cache, no second preference');
  a.state.units = 'anything else';
  assert.equal(a.displayUnitNoun(), 'kilometre',
    'km is the fallback for the noun exactly as it is for the abbreviation');
});

test('the unit noun resolves through the SAME formatter the distances do', () => {
  const mi = app('mi');
  assert.equal(mi.resolveDesc('the first @@U@@'), 'the first mile');
  // and the pre-existing distance token still works alongside it
  assert.equal(mi.resolveDesc('@@D:10@@ at the first @@U@@'),
    mi.fmtDist(10) + ' at the first mile');
});

// ---------------------------------------------------------------------------
// 3. NO SURFACE LEAKS -- EVERY ARCHETYPE, EVERY EXPERIENCE LEVEL
// ---------------------------------------------------------------------------
test('no coaching card on miles mentions a kilometre, at any depth', () => {
  const offenders = [];
  LEVELS.forEach(level => {
    const a = app('mi', level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      const html = a.renderCoachingDepth(dayWith(a, arch));
      if (KM_WORD.test(html)) offenders.push(arch + '/' + level);
    });
  });
  assert.deepEqual(offenders, [], 'athlete-facing copy still hard-codes km');
});

test('no coaching card on kilometres mentions a mile, at any depth', () => {
  const offenders = [];
  LEVELS.forEach(level => {
    const a = app('km', level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      const html = a.renderCoachingDepth(dayWith(a, arch));
      if (MI_WORD.test(html)) offenders.push(arch + '/' + level);
    });
  });
  assert.deepEqual(offenders, [], 'the fix must not leak the other way');
});

test('no rendered card leaves a raw token on screen', () => {
  const leaks = [];
  UNITS.forEach(u => LEVELS.forEach(level => {
    const a = app(u, level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      const html = a.renderCoachingDepth(dayWith(a, arch));
      if (html.indexOf('@@') !== -1) leaks.push(arch + '/' + level + '/' + u);
    });
  }));
  assert.deepEqual(leaks, [], 'an unresolved @@ token is worse than the bug it fixed');
});

test('the accessors hand back resolved copy, not tokens', () => {
  const leaks = [];
  UNITS.forEach(u => LEVELS.forEach(level => {
    const a = app(u, level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      const dd = dayWith(a, arch);
      const entry = a.coachingEntryFor(dd) || {};
      const disc = a.coachingDisclosureFor(dd, level) || {};
      [entry, disc].forEach(o => Object.keys(o).forEach(k => {
        const v = o[k];
        if (typeof v !== 'string') return;
        if (v.indexOf('@@') !== -1) leaks.push(arch + '.' + k + '/' + u);
        if (u === 'mi' && KM_WORD.test(v)) leaks.push(arch + '.' + k + ' says km on mi');
        if (u === 'km' && MI_WORD.test(v)) leaks.push(arch + '.' + k + ' says mi on km');
      }));
    });
  }));
  assert.deepEqual(leaks, [], 'resolution belongs at the accessor, not at each caller');
});

test('the terse variant is resolved too -- experienced is not a second path', () => {
  const mi = app('mi', 'experienced');
  const d = mi.coachingDisclosureFor(dayWith(mi, 'easy_run'), 'experienced');
  assert.ok(d && d.terse, 'easy_run has terse copy, so this is the terse path');
  assert.match(d.how, /first mile/);
  assert.doesNotMatch(d.how, KM_WORD);
});

// ---------------------------------------------------------------------------
// 4. EXECUTION STRATEGY PHASES
// ---------------------------------------------------------------------------
test('Execution Strategy phase copy follows the unit selection', () => {
  const mi = app('mi', 'novice');
  const d = dayOf(mi, 'threshold_continuous');
  assert.ok(d, 'the fixture must contain a threshold_continuous session');
  const html = mi.renderExecutionStrategyBlock(d);
  assert.ok(html, 'the session earns a staged plan');
  assert.match(html, MI_WORD, 'the phase prose should be talking in miles');
  assert.doesNotMatch(html, KM_WORD);
  assert.equal(html.indexOf('@@'), -1, 'no raw token reaches the phase card');
});

test('no Execution Strategy block on miles mentions a kilometre', () => {
  const mi = app('mi', 'novice');
  const offenders = [];
  mi.state.days.forEach(d => {
    let html = '';
    try { html = mi.renderExecutionStrategyBlock(d); } catch (e) { return; }
    if (html && KM_WORD.test(html)) offenders.push(d.date + ' ' + d.title);
    if (html && html.indexOf('@@') !== -1) offenders.push(d.date + ' raw token');
  });
  assert.deepEqual(offenders, [], 'every phase sentence must follow the setting');
});

test('the strategy DECISION is identical in both units', () => {
  const km = app('km', 'novice'), mi = app('mi', 'novice');
  const dk = dayOf(km, 'threshold_continuous'), dm = dayOf(mi, 'threshold_continuous');
  const sk = km.executionStrategy(dk), sm = mi.executionStrategy(dm);
  assert.equal(sk.id, sm.id, 'a display preference must not move the strategy id');
  // Serialised rather than compared object-to-object: each app runs in its own
  // VM realm, so two structurally identical arrays have different prototypes.
  const shape = s => JSON.stringify(s.phases.map(p => [p.key, p.from, p.to, p.sec, p.intensity]));
  assert.equal(shape(sk), shape(sm),
    'phases, boundaries and intensities are unit-independent');
});

// ---------------------------------------------------------------------------
// 5. TREND SENTENCES
// ---------------------------------------------------------------------------
function easyShift(units, paceDelta, hrDelta) {
  const a = app(units);
  const today = a.todayStr();
  const past = a.state.days.filter(d => d.date < today && d.type !== 'rest');
  past.forEach(d => {
    const tr = a.executionPaceTarget(d), z = a.executionHRTarget(d), band = a.expectedRPEBand(d);
    d.completed = true;
    d.actual = {
      km: d.km,
      pace: a.secToPace(tr ? Math.round((tr.fast + tr.slow) / 2) : 300),
      hr: z ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 10)) / 2) : 140,
      rpe: band ? band[0] : 3,
      notes: '',
    };
  });
  const from = a.addDays(today, -20);
  past.filter(d => d.type === 'easy' && d.date >= from).forEach(d => {
    const tr = a.executionPaceTarget(d);
    const base = tr ? Math.round((tr.fast + tr.slow) / 2) : 330;
    d.actual.pace = a.secToPace(base + paceDelta);
    d.actual.hr = (d.actual.hr || 140) + hrDelta;
  });
  past.forEach(d => { if (d.completed) { try { a.coachPersistReview(d); } catch (e) {} } });
  return (a.athleteTrends() || []).filter(t => /efficiency/.test(t.id))[0] || null;
}

test('the efficiency sentence counts heartbeats per MILE for an athlete on miles', () => {
  const t = easyShift('mi', 60, 0);
  assert.ok(t, 'a trend should be detected');
  assert.match(t.detail, /heartbeats per mile/i);
  assert.doesNotMatch(t.detail, KM_WORD);
});

test('and heartbeats per kilometre for an athlete on kilometres', () => {
  const t = easyShift('km', 60, 0);
  assert.ok(t, 'a trend should be detected');
  assert.match(t.detail, /heartbeats per kilometre/i);
});

test('the trend DECISION is identical in both units', () => {
  const km = easyShift('km', 60, 0), mi = easyShift('mi', 60, 0);
  assert.equal(km.id, mi.id);
  assert.equal(km.direction, mi.direction);
  assert.equal(km.confidence, mi.confidence);
  assert.equal(km.observations, mi.observations);
});

// ---------------------------------------------------------------------------
// 6. THE PROPERTY THAT STOPS THIS RECURRING
//
// A source scan, because the leak this fixes was authored by typing a unit word
// into a copy table -- the next one will be authored exactly the same way. Only
// the copy tables and the phase builders are scanned; prose in comments is a
// developer explaining a design and is deliberately left alone.
// ---------------------------------------------------------------------------
function region(startMarker, endMarker) {
  const s = SRC.indexOf(startMarker);
  assert.notEqual(s, -1, 'marker not found: ' + startMarker);
  const e = SRC.indexOf(endMarker, s);
  assert.notEqual(e, -1, 'end marker not found: ' + endMarker);
  return SRC.slice(s, e);
}
// Quoted string literals only, with // and /* */ comments stripped first.
function literalsIn(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return (code.match(/'(?:[^'\\]|\\.)*'/g) || []);
}

test('no copy table hard-codes a unit noun any more', () => {
  const regions = [
    region('var COACH_GUIDANCE = {', 'var ARCHETYPE_GUIDANCE'),
    region('var ARCHETYPE_GUIDANCE = {', 'THE SAME COACHING, WITH LESS OF IT'),
    region('var TERSE_GUIDANCE = {', 'function coachingEntryFor'),
    // Next Move's own copy table. Added after it shipped with "the closing
    // kilometres" in it: the scan above named three tables by hand, so a
    // FOURTH table was outside the guard the moment it was written. Every
    // athlete-facing copy table belongs on this list.
    region('var SESSION_INTENT = {', 'function coachIntentLine'),
  ];
  const offenders = [];
  regions.forEach(r => literalsIn(r).forEach(lit => {
    if (KM_WORD.test(lit) || MI_WORD.test(lit)) offenders.push(lit);
  }));
  assert.deepEqual(offenders, [],
    'use @@U@@ so the sentence follows state.units -- see displayUnitNoun()');
});

test('no Execution Strategy phase literal hard-codes a unit noun', () => {
  const r = region('function strategyPhase(key, opts)', 'function strategyPhasesFor');
  const offenders = literalsIn(r).filter(lit => KM_WORD.test(lit) || MI_WORD.test(lit));
  assert.deepEqual(offenders, [], 'phase prose must use @@U@@ too');
});

test('there is exactly one unit-noun decision in the whole runtime', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const decisions = code.match(/units\s*===\s*'mi'\s*\)\s*\?\s*'mile'/g) || [];
  assert.equal(decisions.length, 1,
    'a second place choosing the word is a second source of truth -- ' +
    'route new callers through displayUnitNoun() instead');
});

// ---------------------------------------------------------------------------
// 7. NEXT MOVE'S OWN COPY TABLE
//
// SESSION_INTENT arrived after this suite did, giving Next Move a sentence of
// its own instead of repeating the workout card cue. That fix was right, but it
// shipped "The value of this one is in the closing kilometres" -- so an athlete
// on miles read a kilometre in Next Move, on exactly the archetype (a long run
// with a goal-pace finish) where the closing distance is the point.
//
// The plural needs no token of its own: both nouns pluralise regularly, so
// @@U@@s resolves through the same single decision.
// ---------------------------------------------------------------------------
test('the Next Move intent line follows the unit selection', () => {
  const mi = app('mi'), km = app('km');
  const dm = dayWith(mi, 'long_run_goal_finish'), dk = dayWith(km, 'long_run_goal_finish');
  assert.match(mi.coachIntentLine(dm), /the closing miles/,
    'an athlete on miles must be told about the closing MILES');
  assert.match(km.coachIntentLine(dk), /the closing kilometres/);
});

test('the plural token resolves through the one decision, not a second one', () => {
  const mi = app('mi'), km = app('km');
  assert.equal(mi.resolveDesc('the closing @@U@@s'), 'the closing miles');
  assert.equal(km.resolveDesc('the closing @@U@@s'), 'the closing kilometres');
});

test('no Next Move line leaks the wrong unit or a raw token, any archetype', () => {
  const offenders = [];
  UNITS.forEach(u => LEVELS.forEach(level => {
    const a = app(u, level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      const line = a.coachIntentLine(dayWith(a, arch));
      if (!line) { offenders.push(arch + '/' + u + '/' + level + ' (blank)'); return; }
      if (line.indexOf('@@') !== -1) offenders.push(arch + '/' + u + ' (raw token)');
      if (u === 'mi' && KM_WORD.test(line)) offenders.push(arch + ' says km on mi');
      if (u === 'km' && MI_WORD.test(line)) offenders.push(arch + ' says mi on km');
    });
    // and the type-keyed fallback a legacy or hand-edited day lands on
    Object.keys(a.SESSION_INTENT_BY_TYPE).forEach(type => {
      const line = a.coachIntentLine({ id: 'y', date: a.todayStr(), type: type, title: 't', km: 10 });
      if (u === 'mi' && KM_WORD.test(line)) offenders.push('type:' + type + ' says km on mi');
      if (u === 'km' && MI_WORD.test(line)) offenders.push('type:' + type + ' says mi on km');
      if (line.indexOf('@@') !== -1) offenders.push('type:' + type + ' (raw token)');
    });
  }));
  assert.deepEqual(offenders, [], 'Next Move is athlete-facing copy like any other');
});

test('resolving the intent line did not make it repeat the workout cue', () => {
  // The two fixes must hold together: routing SESSION_INTENT through the
  // formatter must not collapse Next Move back onto a guidance string.
  const offenders = [];
  UNITS.forEach(u => LEVELS.forEach(level => {
    const a = app(u, level);
    Object.keys(a.ARCHETYPE_GUIDANCE).forEach(arch => {
      const dd = dayWith(a, arch);
      const g = a.coachingEntryFor(dd) || {};
      const line = a.coachIntentLine(dd);
      ['cue', 'essential', 'why', 'how', 'feel', 'avoid'].forEach(f => {
        if (g[f] && line === g[f]) offenders.push(arch + '.' + f + '/' + u + '/' + level);
      });
    });
  }));
  assert.deepEqual(offenders, [], 'Next Move keeps its own voice in both units');
});
