'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* COACHING THAT KNOWS WHERE THE DAY SITS
 * ===========================================================================
 * Founder: "If athletes see identical coaching every Easy Run, they will stop
 * reading it."
 * MEASURED BEFORE: a 19-week marathon block produced 95 coached days and 17
 * distinct coaching texts; easy_run took 51 of those days with exactly ONE.
 * That was never a shortage of writing -- selection was a pure function of
 * session identity, so a second variant could not have been reached.
 *
 * WHAT THESE LAWS PROTECT, in order of how much damage breaking them does:
 *   1. Execution never rotates. how/feel/avoid describe the correct way to
 *      run the session; an athlete who has read the right instruction before
 *      still needs the right instruction.
 *   2. Selection is deterministic. The same day resolves to the same line
 *      after a reload, on another device, forever.
 *   3. A variant is only reachable when its context is true of the day, so
 *      novelty can never outrank relevance.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

function block(){
  const a = loadApp({ pinnedDate: '2026-11-10T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks:19, startDate:'2026-11-09', distanceKey:'full', volume:72,
    benchSec:45*60, lthr:165, maxHR:190,
    schedule:{ activeDays:[1,2,3,4,5,6], longRunDay:6 } });
  return a;
}
const sorted = a => a.state.days.slice().sort((x,y)=> x.date < y.date ? -1 : 1);

/* =====================================================================
 * THE SOLO NOTE IS WHERE THE COACHING ACTUALLY ARRIVES
 * =====================================================================
 * Founder, looking at four easy runs across two different phases: "The
 * easy runs still all say the same still."
 * They did. An easy or long run draws a SOLO NOTE, and that came from
 * SINGLE_CARD_NOTE -- one fixed entry per archetype. Measured on a
 * 105-day plan: 47 days draw one, and they produced FIVE distinct texts,
 * 39 of them "Keep it easy / Finish wanting more". The contextual layer
 * was already holding 55 distinct lines for those same days; nothing on
 * this screen ever asked it.
 * THE LESSON THESE TESTS NOW CARRY: the earlier work was verified by
 * measuring contextualWhy() -- the generator -- and never by measuring
 * what a screen renders. A coaching system that varies perfectly and is
 * not read is indistinguishable from one that does not vary. So these
 * assert the RENDERED note, through renderSoloNote(), not the pool. */
test('an easy run does not say the same thing every time', () => {
  const a = block();
  const notes = sorted(a).map(d => {
    let h = '';
    try { h = a.renderSoloNote(d); } catch (e) { h = ''; }
    return h ? { date: d.date, type: d.type, t: h.replace(/<[^>]+>/g, '|') } : null;
  }).filter(Boolean);
  assert.ok(notes.length >= 20, 'expected a plan with plenty of solo-note days, got ' + notes.length);

  /* NO TWO IN A ROW, which is the thing the founder actually saw: the
     screenshots were consecutive days reading identically. */
  let consecutive = 0;
  for (let i = 1; i < notes.length; i++) if (notes[i].t === notes[i - 1].t) consecutive++;
  assert.equal(consecutive, 0,
    consecutive + ' solo notes repeat the one before them');

  /* AND NOT A HANDFUL OF TEXTS SPREAD THIN. Five was the broken state. */
  const distinct = new Set(notes.map(n => n.t)).size;
  assert.ok(distinct >= 12,
    'only ' + distinct + ' distinct solo notes across ' + notes.length + ' days');
});

test('the solo note is deterministic: the same plan renders the same words', () => {
  /* Same property the why pool holds, asserted where it is now read. A
     rotation keyed on anything but the plan would fail here. */
  const render = (app) => sorted(app).map((d) => {
    try { return app.renderSoloNote(d); } catch (e) { return ''; }
  });
  const first = render(block());
  const second = render(block());
  assert.ok(first.filter(Boolean).length >= 20, 'no solo notes were rendered to compare');
  assert.equal(first.length, second.length,
    'the two loads produced different numbers of days: ' + first.length + ' vs ' + second.length);
  let mism = 0, firstAt = -1;
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) { mism++; if (firstAt < 0) firstAt = i; }
  }
  assert.equal(mism + '|' + Object.keys(first).length + '|' + Object.keys(second).length,
    0 + '|' + first.length + '|' + second.length,
    'mismatches=' + mism + ' firstAt=' + firstAt +
    ' ownKeys=' + Object.keys(first).length + '/' + Object.keys(second).length +
    ' len=' + first.length + '/' + second.length +
    (firstAt >= 0 ? '\n  A: ' + String(first[firstAt]).replace(/<[^>]+>/g, '|') +
                    '\n  B: ' + String(second[firstAt]).replace(/<[^>]+>/g, '|') : ''));
  const at = firstAt;
  assert.equal(at, -1,
    'two independent loads rendered different notes at index ' + at +
    '\n  A: ' + String(first[at]).replace(/<[^>]+>/g, '|') +
    '\n  B: ' + String(second[at]).replace(/<[^>]+>/g, '|'));
});

test('the lead is the instruction and never rotates; only the second line moves', () => {
  /* "Keep it easy" is the same instruction every time, so varying it would
     make a day look different when it is not. The context belongs in the
     line underneath. */
  const a = block();
  const leads = new Map();
  sorted(a).forEach(d => {
    let parts = null;
    try { parts = a.singleCardNoteParts(d); } catch (e) { parts = null; }
    if (!parts || !parts.lead) return;
    const p = a.prescriptionOf(d) || {};
    if (!a.SINGLE_CARD_NOTE[p.archetype]) return;
    if (!leads.has(p.archetype)) leads.set(p.archetype, new Set());
    leads.get(p.archetype).add(parts.lead);
  });
  assert.ok(leads.size > 0, 'no written-archetype solo notes were produced at all');
  leads.forEach((set, arch) => {
    assert.equal(set.size, 1,
      arch + ' varies its lead (' + [...set].join(' / ') + ') -- the instruction must not rotate');
  });
});

test('the short lines stay short, and carry no em dash', () => {
  /* The box is deliberately terse -- "that is the cleanest it can ever be"
     -- which is why these exist instead of reusing a why, and the founder's
     copy standard removes em dashes. Both are easy to lose by adding one
     good long line later. */
  const a = block();
  const lines = [];
  const walk = (o) => {
    if (typeof o === 'string') { lines.push(o); return; }
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') Object.keys(o).forEach(k => walk(o[k]));
  };
  walk(a.COACHING_SOLO_SUB);
  /* Easy runs only: a long run's line is dictated copy and does not
     rotate, so the pool is the eight easy buckets at two or three lines
     each. A floor, not the exact count, so adding a line is not a failure. */
  assert.ok(lines.length >= 15, 'the short-line pool is suspiciously small: ' + lines.length);
  lines.forEach((t) => {
    assert.ok(t.length <= 60, 'a solo-note line is ' + t.length + ' characters: ' + t);
    assert.ok(t.indexOf('\u2014') === -1, 'an em dash is back in the coaching copy: ' + t);
    assert.ok(!/\.$/.test(t), 'a solo-note line ends in a full stop: ' + t);
  });
});

test('the execution guidance never rotates, whatever the context', () => {
  /* THE SAFETY PROPERTY. Only `why` is contextual. If how/feel/avoid ever
     varied by day, Sacoro would be inventing alternative instructions for
     running the same session, which is a methodology change wearing a copy
     change's clothes. */
  const a = block();
  const byKey = {};
  sorted(a).forEach(d => {
    const k = a.coachingKeyFor(d);
    if (!k) return;
    const g = a.coachingDisclosureFor(d, 'experienced');
    if (!g || !g.how) return;
    const sig = [g.how, g.feel, g.avoid].join('||');
    (byKey[k] = byKey[k] || new Set()).add(sig);
  });
  const keys = Object.keys(byKey);
  assert.ok(keys.length >= 8, 'too few families to prove anything: ' + keys.length);
  keys.forEach(k => assert.equal(byKey[k].size, 1,
    k + ' has ' + byKey[k].size + ' different execution instructions across the block'));
});

test('the same day resolves to the same coaching after a reload', () => {
  /* Two independent loads of the same plan, no shared memory. Deterministic
     means deterministic: not "stable within a session". */
  const a = block(), b = block();
  const da = sorted(a), db = sorted(b);
  assert.equal(da.length, db.length);
  let checked = 0;
  for (let i = 0; i < da.length; i++){
    const wa = a.contextualWhy(da[i]), wb = b.contextualWhy(db[i]);
    assert.equal(wa, wb, da[i].date + ' resolved differently on a second load');
    if (wa) checked++;
  }
  assert.ok(checked > 100, 'only ' + checked + ' days carried contextual coaching');
});

test('selection never consults the clock or a random number', () => {
  /* COMMENTS STRIPPED FIRST. The first version of this law failed on the
     comment that explains WHY Math.random() is not used -- it was reading
     prose as code. A law that cannot tell the two apart proves nothing. */
  const end = SRC.indexOf('\nfunction coachingTeachFor(');
  const body = SRC.slice(SRC.indexOf('function coachingContextFor('), end)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(body, /Math\.random/, 'selection is random, so it cannot survive a reload');
  assert.doesNotMatch(body, /Date\.now|new Date\(\)/,
    'selection reads the clock, so the same day would drift');
});

test('a variant is only reachable when its context is true of the day', () => {
  /* Novelty must never outrank relevance: an "after the hard session" line
     may only appear the day after a quality session, and a phase line only
     inside that phase. Walked over the whole block rather than argued. */
  const a = block();
  const POOL = a.COACHING_WHY;
  sorted(a).forEach(d => {
    const ctx = a.coachingContextFor(d);
    const why = a.contextualWhy(d);
    if (!ctx || !why) return;
    const fam = POOL[ctx.family];
    const flat = o => { const out = []; (function walk(x){
      if (!x) return;
      if (Array.isArray(x)) return x.forEach(v => out.push(v));
      Object.keys(x).forEach(k => walk(x[k]));
    })(o); return out; };
    /* It came from this family's pool and from no other family's. */
    assert.ok(flat(fam).indexOf(why) !== -1,
      d.date + ': coaching came from outside its own family pool');
    Object.keys(POOL).forEach(other => {
      if (other === ctx.family) return;
      if (flat(POOL[other]).indexOf(why) !== -1 && flat(fam).indexOf(why) === -1)
        assert.fail(d.date + ': took a line belonging to ' + other);
    });
    /* And from the bucket its own context selects. */
    const eligible = a.coachingVariantsFor(ctx);
    assert.ok(eligible.indexOf(why) !== -1,
      d.date + ': the line is not in the eligible set for its own context');
  });
});

test('role and phase compose, so the block visibly progresses', () => {
  /* The first version let a role REPLACE the phase, and measurement showed
     an easy run in Base, Build and Peak all reading the same sentence --
     the athlete never saw the block progress. */
  const a = block();
  const after = {};
  sorted(a).forEach(d => {
    const c = a.coachingContextFor(d);
    if (!c || c.family !== 'easy' || c.role !== 'after_quality') return;
    (after[c.phase] = after[c.phase] || new Set()).add(a.contextualWhy(d));
  });
  const phases = Object.keys(after);
  assert.ok(phases.length >= 3, 'only ' + phases.length + ' phases carried this role');
  phases.forEach(p1 => phases.forEach(p2 => {
    if (p1 >= p2) return;
    [...after[p1]].forEach(w => assert.ok(!after[p2].has(w),
      'the same line is used in ' + p1 + ' and ' + p2 + ', so the phase is invisible'));
  }));
});

test('a milestone stays rare enough to mean something', () => {
  /* "Longest so far" fired on 5 of 7 long runs, because long runs get longer
     by design. A milestone that fires most weeks is not a milestone, and it
     crowded out the phase coaching underneath it. */
  const a = block();
  const hits = sorted(a).filter(d => {
    const c = a.coachingContextFor(d);
    return c && c.milestone === 'peak_long';
  });
  assert.ok(hits.length >= 1, 'the biggest long run is never marked');
  assert.ok(hits.length <= 2, 'the peak long run milestone fired ' + hits.length + ' times');
});

test('no easy run repeats itself on consecutive occurrences', () => {
  /* The athlete-facing claim, measured the way an athlete meets it: one easy
     run after another. */
  const a = block();
  let prev = null, repeats = 0, n = 0;
  sorted(a).forEach(d => {
    const c = a.coachingContextFor(d);
    if (!c || c.family !== 'easy') return;
    const w = a.contextualWhy(d);
    if (!w) return;
    n++;
    if (prev && w === prev) repeats++;
    prev = w;
  });
  assert.ok(n >= 30, 'only ' + n + ' easy runs in the block');
  assert.equal(repeats, 0, repeats + ' easy runs repeated the previous one');
});

test('rest and supporting work are in the same system, not beside it', () => {
  const a = block();
  const rest = sorted(a).filter(d => d.type === 'rest');
  assert.ok(rest.length > 10, 'too few rest days');
  const texts = new Set(rest.map(d => a.contextualWhy(d)).filter(Boolean));
  assert.ok(texts.size >= 4, 'rest produced only ' + texts.size + ' distinct lines');
  /* A rest day has no `how`, so its coaching arrives as the cue. */
  const g = a.coachingEntryFor(rest[rest.length - 1]);
  assert.ok(g && g.cue && texts.has(g.cue), 'the rest card does not show the contextual line');
  /* Supporting work asks the same pool. */
  const anyDay = sorted(a).filter(d => d.type !== 'rest')[10];
  const sw = a.supportContextualWhy(anyDay);
  assert.ok(sw && a.COACHING_WHY.support.phase[a.coachingContextFor(anyDay).phase].indexOf(sw) !== -1,
    'supporting work is not drawing from the shared pool');
});

test('Hear Today is a separate, deeper layer and not a copy of the card', () => {
  const a = block();
  let taught = 0;
  sorted(a).forEach(d => {
    const g = a.coachingDisclosureFor(d, 'experienced');
    if (!g || !g.teach) return;
    taught++;
    assert.notEqual(g.teach, g.why, d.date + ': Hear Today just repeats the card');
    assert.ok(g.teach.length > g.why.length * 0.8,
      d.date + ': the deeper layer is thinner than the card it expands');
  });
  assert.ok(taught > 50, 'only ' + taught + ' days carry a teaching line');
});

test('no coaching claims knowledge Sacoro does not have', () => {
  /* Founder: do not infer recovery, soreness, sleep, HRV, adaptation rate or
     the weather. The heat and plasma-volume material is legitimate physiology
     and is deliberately absent, because Sacoro has no weather data and a
     context-selected line about heat would be a claim about conditions it
     cannot see. */
  const a = block();
  const all = [];
  const walk = x => { if (!x) return;
    if (typeof x === 'string') return all.push(x);
    if (Array.isArray(x)) return x.forEach(walk);
    Object.keys(x).forEach(k => walk(x[k])); };
  walk(a.COACHING_WHY); walk(a.COACHING_TEACH);
  assert.ok(all.length > 80, 'the pool is too small to be worth auditing: ' + all.length);
  const banned = [
    [/\bhumid|\bheat\b|\bwarm weather|\btemperature\b/i, 'weather it cannot see'],
    [/\byour (sleep|HRV|heart rate variability)\b/i, 'sleep or HRV it does not have'],
    [/\byou are (recovered|fatigued|fresh)\b/i, 'a recovery state it cannot measure'],
    [/\bsore\b|\bsoreness\b/i, 'soreness it cannot know'],
    [/\b\d+(\.\d+)?\s*(%|per cent)/i, 'a precise figure it cannot support']
  ];
  all.forEach(line => banned.forEach(([re, why]) =>
    assert.doesNotMatch(line, re, 'a coaching line claims ' + why + ': ' + line)));
});

test('adaptation is attributed to the pattern, never to one session', () => {
  /* The science integrity rule. Mitochondrial, capillary and plasma-volume
     changes are responses to repeated exposure; Sacoro cannot observe an
     individual's, and must not credit them to today's run. */
  const a = block();
  const all = [];
  const walk = x => { if (!x) return;
    if (typeof x === 'string') return all.push(x);
    if (Array.isArray(x)) return x.forEach(walk);
    Object.keys(x).forEach(k => walk(x[k])); };
  walk(a.COACHING_WHY); walk(a.COACHING_TEACH);
  all.forEach(line => {
    assert.doesNotMatch(line, /this (run|session) (increases|improves|builds) your/i,
      'a single session is credited with an adaptation: ' + line);
    assert.doesNotMatch(line, /\btoday('s)? (run|session) (increases|raises) your\b/i,
      'a single session is credited with an adaptation: ' + line);
  });
});
