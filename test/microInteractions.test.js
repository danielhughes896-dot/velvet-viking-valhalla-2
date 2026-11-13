'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* MICRO-INTERACTIONS. Founder, of the audit: "Do 1, 2, 3 & 4."
   1. "Buttons compress by perhaps 2% when pressed and return immediately."
   2. "Once a run is logged, its card transitions from prescribed to
      completed ... a single haptic confirms success."
   3. "If the coach recommends changing a session and the athlete accepts,
      the old prescription smoothly transitions into the new one."
   4. "When weekly distance increases from 32 to 40 km, the number smoothly
      counts upward while the gold progress bar advances." */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.slice(SRC.indexOf('<style'), SRC.indexOf('</style>'));
const fnBody = n => { const i = SRC.indexOf('function ' + n + '('); assert.ok(i > -1, n); return SRC.slice(i, SRC.indexOf('\n}\n', i)); };

function fakeEl(extra){
  const cls = new Set();
  return Object.assign({
    style: {}, textContent: '', offsetWidth: 1,
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
    has: c => cls.has(c), attrs: {},
    getAttribute(k){ return this.attrs[k] == null ? null : this.attrs[k]; },
    setAttribute(k, v){ this.attrs[k] = String(v); }, removeAttribute(k){ delete this.attrs[k]; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }
  }, extra || {});
}
function app(pin){
  const a = loadApp({ pinnedDate: (pin || '2026-11-12') + 'T07:00:00Z' });
  a.renderApp = () => {}; a.showToast = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-02' });
  return a;
}

// ---------------------------------------------------------------- 1. press
test('1. a button gives 2% under the thumb, only buttons, never twice, and not under Reduce Motion', () => {
  const at = CSS.indexOf('@media (prefers-reduced-motion: no-preference){\n    :where(button');
  assert.ok(at > -1, 'the press is not confined to phones that allow motion');
  const block = CSS.slice(at, CSS.indexOf('\n  }\n', at));
  assert.match(block, /:where\(button, \.btn, \[role="button"\], label\.day-check\):not\(:disabled\):active\{ scale:\.98; \}/);
  assert.match(block, /\.bn-item:active, \.opt-grid button:active, \.bld-purpose button:active\{ scale:none; \}/,
    'a control that already had its own press takes a second one on top');
  /* `scale`, never `transform`, so a control's own transform survives the press. */
  assert.doesNotMatch(block, /transform:/);
  /* Cards are not in it: "scroll through content: none". */
  assert.doesNotMatch(block.split('{')[1], /\.day(?![\w-])|\.ev-card|\.week(?![\w-])|\[data-action\]/);
});

// ---------------------------------------------------------------- 2. completion
test('2. the first look after an update replays nothing; a new completion plays once where it is seen', () => {
  const a = app();
  const els = {};
  a.document.getElementById = id => els[id] || null;
  a.document.querySelectorAll = () => [];
  const done = a.state.days.filter(d => d.date < '2026-11-12' && d.type !== 'rest' && !a.isOptionalRunDay(d)).slice(0, 2);
  done.forEach(d => { logAsPrescribed(a, d); els['day-' + d.id] = fakeEl(); });
  a.doneArrivals();
  done.forEach(d => assert.equal(els['day-' + d.id].has('is-completing'), false, 'an old completion replayed on the update'));
  /* A run arrives (Strava, or ticked): its card plays, once. */
  const fresh = a.state.days.filter(d => d.date >= '2026-11-12' && d.type !== 'rest' && !a.isOptionalRunDay(d))[0];
  fresh.completed = true;
  a.doneArrivals();                                  // not on screen yet: nothing, and not counted as seen
  els['day-' + fresh.id] = fakeEl();
  const slide = fakeEl();
  a.document.querySelectorAll = sel => sel === '.wk-slide[data-date="' + fresh.date + '"]' ? [slide] : [];
  a.doneArrivals();
  assert.equal(els['day-' + fresh.id].has('is-completing'), true, 'the completed card did not play');
  assert.equal(slide.has('is-completing'), true, 'This Week’s slide of the same day did not play');
  els['day-' + fresh.id] = fakeEl();
  a.doneArrivals();
  assert.equal(els['day-' + fresh.id].has('is-completing'), false, 'it played twice');
  /* Un-ticked, it is forgotten, so ticking again plays again. */
  fresh.completed = false; a.doneArrivals();
  fresh.completed = true; a.doneArrivals();
  assert.equal(els['day-' + fresh.id].has('is-completing'), true);
  /* Kept on the device under its own key, never in the synced plan. */
  assert.ok(JSON.parse(a.localStorage.getItem('vvv_done_seen'))[fresh.id]);
  assert.equal(JSON.stringify(a.state).indexOf('vvv_done_seen'), -1);
});

test('2. ticking the session off is felt once, as success; un-ticking is not felt', () => {
  const a = app();
  const today = a.state.days.filter(d => d.date === '2026-11-12')[0];
  let d = today;
  if (!a.canToggleCompletion(d)){
    const run = a.state.days.filter(x => x.type !== 'rest' && !a.isOptionalRunDay(x) && x.date > '2026-11-12')[0];
    const b = app(run.date); d = b.findDayByDate(run.date); return check(b, d);
  }
  check(a, d);
  function check(x, day){
    const felt = []; x.sacoroHaptic = k => felt.push(k);
    x.handleToggleComplete(day.id);
    assert.equal(day.completed, true);
    assert.deepEqual(felt, ['success']);
    x.handleToggleComplete(day.id);
    assert.equal(day.completed, false);
    assert.deepEqual(felt, ['success'], 'un-ticking buzzed');
  }
});

test('2. the animation lands on what says it, and stops for Reduce Motion', () => {
  assert.match(CSS, /\.is-completing \.actual-done\{ animation:done-rise 520ms/);
  assert.match(CSS, /\.is-completing \.actual-done::before\{ animation:done-light 1100ms/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)\{\s*\.is-completing \.actual-done, \.is-completing \.actual-done::before,\s*\.is-completing \.actual-done-i, \.is-completing \.day-check input:checked\{ animation:none; \}/);
  assert.match(fnBody('renderApp'), /doneArrivals\(\)/);
  assert.match(fnBody('replaceCard'), /doneArrivals\(\)/);
});

// ---------------------------------------------------------------- 3. accept
test('3. accepting a change morphs the session card from its old prescription to its new one', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date > '2026-11-12' && d.type !== 'rest' && !a.isOptionalRunDay(d))[0];
  /* No support (or Reduce Motion): the change simply happens. */
  let applied = 0;
  a.vtAccept(dd.id, () => { applied++; });
  assert.equal(applied, 1);
  /* With support: the card's title and distance are named on both sides. */
  const parts = side => ({ title: fakeEl({ side }), dist: fakeEl({ side }) });
  let current = 'old';
  const cards = { old: parts('old'), new: parts('new') };
  const cardEl = () => fakeEl({ querySelector: sel => sel === a.VT_CARD_PARTS.title ? cards[current].title : sel === a.VT_CARD_PARTS.dist ? cards[current].dist : null });
  a.document.getElementById = id => id === 'day-' + dd.id ? cardEl() : null;
  a.document.querySelectorAll = () => [];
  const names = {};
  a.document.startViewTransition = cb => {
    names.before = [cards.old.title.attrs['data-vt'], cards.old.dist.attrs['data-vt']];
    cb();
    names.after = [cards.new.title.attrs['data-vt'], cards.new.dist.attrs['data-vt']];
    return { finished: { then(){} } };
  };
  a.window.matchMedia = () => ({ matches: false });
  a.vtAccept(dd.id, () => { applied++; current = 'new'; });
  assert.equal(applied, 2);
  assert.deepEqual(names.before, ['vt-title', 'vt-dist'], 'the old title and distance were not photographed');
  assert.deepEqual(names.after, ['vt-title', 'vt-dist'], 'the new title and distance were not named to fly to');
  /* Every Accept goes through it; the haptic stays in the handler. */
  assert.match(SRC, /case 'coach-accept': \{ var acc = target\.getAttribute\('data-day'\); vtAccept\(acc, function\(\)\{ handleCoachAccept\(acc\); \}\); break; \}/);
  assert.match(SRC, /vtAccept\(changedA, function\(\)\{ if \(pbA\) handleAcceptPlaybook\(shownA\); else handleAcceptEvolution\(shownA\); \}\);/);
  /* Reduce Motion is the same switch every morph uses. */
  a.window.matchMedia = () => ({ matches: true });
  let started = false; a.document.startViewTransition = () => { started = true; };
  a.vtAccept(dd.id, () => { applied++; });
  assert.equal(started, false); assert.equal(applied, 3);
});

// ---------------------------------------------------------------- 4. living numbers
function hero(a, week, done, pct){
  const vol = fakeEl({ textContent: done }), pc = fakeEl({ textContent: pct + '%' }), fill = fakeEl();
  /* Every width the bar is given, in order, so "from where it was" is seen. */
  const widths = [];
  fill.style = new Proxy({ width: pct + '%' }, { set(o, k, v){ if (k === 'width') widths.push(v); o[k] = v; return true; } });
  fill.widths = widths;
  const h = fakeEl({ querySelector: s => s === '.wk-hero-vol b' ? vol : s === '.wk-hero-pct' ? pc : s === '.wk-bar-fill' ? fill : null });
  h.attrs['data-week'] = String(week);
  a.document.querySelector = s => (s === '.wk-hero' || s === '.wk-hero[data-week]') ? h : null;
  return { vol, pc, fill };
}
test('4. the same week with more done: the total counts and the bar slides from where it was', () => {
  const a = app();
  const frames = []; a.requestAnimationFrame = fn => frames.push(fn);
  a.window.matchMedia = () => ({ matches: false });
  hero(a, 9, '32', 55);
  assert.equal(a.weekRise(), false, 'a first look should fill as it always did');
  const h = hero(a, 9, '40', 69);
  assert.equal(a.weekRise(), true);
  assert.equal(h.fill.style.width, '69%');
  assert.deepEqual(h.fill.widths, ['55%', '69%'], 'the bar did not slide from where it was to where it is');
  assert.match(h.fill.style.transition, /^width 900ms/);
  assert.equal(h.vol.textContent, '32', 'it should start from what was last shown');
  assert.equal(h.pc.textContent, '55%');
  /* Run the frames: halfway it is between, at the end it is exactly the page's own words. */
  let t = 0; while (frames.length){ const f = frames.shift(); f(t); if (t === 350) assert.ok(+h.vol.textContent > 32 && +h.vol.textContent < 40, 'mid-count: ' + h.vol.textContent); t += 350; }
  assert.equal(h.vol.textContent, '40'); assert.equal(h.pc.textContent, '69%');
  /* Nothing moved since: no replay. */
  hero(a, 9, '40', 69); assert.equal(a.weekRise(), false);
  /* A new week, or the other unit, is a first look, never a count across. */
  hero(a, 10, '5', 10); assert.equal(a.weekRise(), false);
  a.state.units = 'mi'; hero(a, 10, '3', 10); assert.equal(a.weekRise(), false);
});

test('4. decimals and commas keep their shape while counting; Reduce Motion lands at once', () => {
  const a = app();
  assert.deepEqual(JSON.parse(JSON.stringify(a.weekFigure('13.5'))), { n: 13.5, dp: 1, comma: false });
  assert.deepEqual(JSON.parse(JSON.stringify(a.weekFigure('13,5'))), { n: 13.5, dp: 1, comma: true });
  assert.equal(a.weekFigure('13.5 km'), null);
  assert.equal(a.weekFigureText(14.25, a.weekFigure('13,5')), '14,3');
  a.requestAnimationFrame = () => { throw new Error('animated under Reduce Motion'); };
  a.window.matchMedia = q => ({ matches: /reduce/.test(q) });
  hero(a, 9, '20', 30);
  a.weekRise();
  const h = hero(a, 9, '30', 45);
  assert.equal(a.weekRise(), true);
  assert.equal(h.vol.textContent, '30'); assert.equal(h.fill.style.width, '45%');
});

test('4. a tick on This Week rewrites the hero in place and lets it rise', () => {
  assert.match(fnBody('patchDerivedStats'), /patchWeekHero\(\)/);
  const body = fnBody('patchWeekHero');
  assert.match(body, /weekDoneText\(v\.doneTraining\)/);
  assert.match(body, /weekDonePct\(v\.doneTraining, v\.training\)/);
  assert.match(body, /weekRise\(\);\s*$/);
  assert.match(fnBody('renderWeekHeroBlock'), /escapeHtml\(weekDoneText\(done\)\)/);
  assert.match(fnBody('renderWeekHeroBlock'), /var pct = weekDonePct\(done, planned\);/);
});

// ---------------------------------------------------------------- 5. the Coach circles
/* Founder: "When Recovery changes from Fresh to Watch, the turquoise ring
   smoothly adjusts rather than instantly switching." Then: "10. Let's do it." */
function dialEl(reading, word, cls){
  const anims = [];
  const arc = fakeEl({ animate: (kf, o) => anims.push({ on: 'arc', kf, o }) });
  arc.attrs.class = cls;
  const val = fakeEl({ textContent: word, animate: (kf, o) => anims.push({ on: 'val', kf, o }) });
  const el = fakeEl({ querySelector: s => s === '.rd-arc' ? arc : s === '.rd-val b' ? val : null });
  el.attrs['data-reading'] = reading;
  el.anims = anims;
  return el;
}
test('5. a circle eases from what was last seen to what is true now, once', () => {
  const a = app();
  a.window.matchMedia = () => ({ matches: false });
  let dials = [dialEl('recovery', 'Watch', 'rd-arc is-rec-watch'), dialEl('evolution', 'Learning', 'rd-arc is-learning')];
  a.document.querySelectorAll = s => s === '.b-grid .b-dial[data-reading]' ? dials : [];
  a.easeDials();
  dials.forEach(d => assert.equal(d.anims.length, 0, 'the first look after the update played something'));
  /* Recovery went to Strained; Evolution stopped gathering. */
  dials = [dialEl('recovery', 'Strained', 'rd-arc is-rec-strained'), dialEl('evolution', 'On track', 'rd-arc')];
  a.easeDials();
  const rec = dials[0].anims, evo = dials[1].anims;
  const ring = rec.find(x => x.on === 'arc');
  assert.ok(ring, 'the ring switched instead of easing');
  assert.deepEqual(JSON.parse(JSON.stringify(ring.kf.map(k => k.strokeDasharray))), ['264.9 24.1', '289.03 0'], 'the break did not close from where it was');
  assert.equal(ring.o.duration, 900);
  assert.ok(rec.find(x => x.on === 'val'), 'the new word did not rise in');
  const fade = evo.find(x => x.on === 'arc');
  assert.deepEqual(JSON.parse(JSON.stringify(fade.kf.map(k => k.opacity))), [0.25, 1], 'a gathering ring should brighten into its solid form');
  /* Shown again unchanged: nothing replays. */
  dials = [dialEl('recovery', 'Strained', 'rd-arc is-rec-strained'), dialEl('evolution', 'On track', 'rd-arc')];
  a.easeDials();
  dials.forEach(d => assert.equal(d.anims.length, 0, 'it played again with nothing changed'));
  /* Kept on the device under its own key. */
  assert.equal(JSON.parse(a.localStorage.getItem('vvv_dial_seen')).recovery.v, 'Strained');
});

test('5. Fresh to Watch keeps its break and changes its word; Reduce Motion plays nothing', () => {
  const a = app();
  a.window.matchMedia = () => ({ matches: false });
  let d = [dialEl('recovery', 'Fresh', 'rd-arc is-rec-fresh')];
  a.document.querySelectorAll = () => d;
  a.easeDials();
  d = [dialEl('recovery', 'Watch', 'rd-arc is-rec-watch')];
  a.easeDials();
  /* Same break both ways, so the ring settles (brightens) rather than reshaping. */
  assert.deepEqual(JSON.parse(JSON.stringify(d[0].anims.find(x => x.on === 'arc').kf.map(k => k.opacity))), [0.25, 1]);
  assert.ok(d[0].anims.find(x => x.on === 'val'));
  a.window.matchMedia = q => ({ matches: /reduce/.test(q) });
  d = [dialEl('recovery', 'Strained', 'rd-arc is-rec-strained')];
  a.easeDials();
  assert.equal(d[0].anims.length, 0, 'Reduce Motion animated');
  assert.equal(JSON.parse(a.localStorage.getItem('vvv_dial_seen')).recovery.v, 'Strained', 'what was shown is still remembered');
  assert.match(fnBody('renderApp'), /easeDials\(\)/);
});
