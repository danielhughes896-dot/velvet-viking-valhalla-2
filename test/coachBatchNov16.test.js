'use strict';
/* Founder, of the Coach page (16 November 2026):
   "Move Coach Noticed above Aerobic Development. Important insights
   shouldn't be buried."
   "Standardise section headings to either SACORO'S READ or SACORO'S
   ASSESSMENT."
   "Full Plan showed 1,204.7km, whereas Progress shows 1,246.9km. The
   difference is exactly 42.2km ... That needs clarifying."
   "All the glass panels have the same boarder issue we had on the other
   glass panels." */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');

function athlete(distanceKey){
  const a = loadApp({ pinnedDate: '2026-11-30T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey, volume: 50, weeks: 16, experience: 'experienced', startDate: '2026-11-02' });
  a.state.days.filter(d => d.date < '2026-11-30' && d.km > 0).forEach(d => { try { logAsPrescribed(a, d); } catch (e) {} });
  return a;
}
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

for (const key of ['full', 'half']){
  test(key+': Progress prints the same training distance Full Plan does, and the race on its own line', () => {
    const a = athlete(key);
    let planned = 0, done = 0;
    for (let w = 1; w <= a.totalWeeksInPlan(); w++){ const v = a.weekVolume(w); planned += v.training; done += v.doneTraining; }
    const race = a.state.days.find(d => d.type === 'race');
    assert.ok(race && race.km > 0, 'the plan has a race day');
    const html = strip(a.recordPanelProgress());
    assert.ok(html.includes('Training distance'), html);
    assert.ok(html.includes(a.kmToDisplay(a.round1(done))+' / '+a.fmtDist(a.round1(planned))),
      'Progress bar reads '+a.fmtDist(a.round1(planned))+' like Full Plan: '+html);
    assert.ok(html.includes('Race day, counted separately '+a.fmtDist(race.km)), html);
    /* The all-runs total, race included, is not printed as the distance. */
    const all = a.computeStats().totalKm;
    assert.ok(!html.includes('/ '+a.fmtDist(all)), 'the race-inclusive total is gone');
  });
}

test('Coach Noticed sits above the aerobic graph on the Coach page, and once', () => {
  const fn = SRC.slice(SRC.indexOf('function renderSacoroInstruments'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const noticed = body.indexOf('renderCoachNoticedCard(');
  const graph = body.indexOf('renderCoachGraph(');
  assert.ok(noticed !== -1 && graph !== -1 && noticed < graph);
  const panel = SRC.slice(SRC.indexOf('function renderCoachPanel'));
  assert.ok(!panel.slice(0, panel.indexOf('\n}\n')).includes('renderCoachNoticedCard('));
});

test('no Coach heading says Coach’s Read any more', () => {
  assert.ok(!/sectionRule\('Coach(’|\\u2019|')s Read'/.test(SRC));
  assert.ok(/sectionRule\('SACORO(’|\\u2019)s Read'/.test(SRC));
});

test('a Coach glass sheet is one pane: no tinted heading, no line, only the body scrolls', () => {
  const sel = '.modal-overlay:has(> .hq-full) > .hq-full:has(> .modal-body)';
  const head = SRC.indexOf(sel+' > .modal-head{');
  assert.ok(head !== -1);
  const rule = SRC.slice(head, SRC.indexOf('}', head));
  assert.match(rule, /background:transparent/);
  assert.match(rule, /border-bottom:0/);
  assert.match(rule, /backdrop-filter:none/);
  const bodyAt = SRC.indexOf(sel+' > .modal-body{');
  assert.match(SRC.slice(bodyAt, SRC.indexOf('}', bodyAt)), /overflow-y:auto/);
  /* Anything keeping a sheet's place asks which part scrolls. */
  assert.match(SRC, /atTop:\(modalScrollGet\(card\) <= 0\)/);
  const om = SRC.slice(SRC.indexOf('function openModal('));
  assert.match(om.slice(0, 800), /modalScrollGet\(card\)[\s\S]*modalScrollSet\(card, y\)/);
});

test('each sheet’s hero ring wears its small circle’s colour, and so does the sheet', () => {
  /* Founder: "Make sure all Modal Hero Rings: On the BENCHMARK, GOAL,
     PROGRESS, and MEASURED FITNESS bottom sheets, the top-left ring" matches
     the circle that opens it. One map draws all three. */
  const a = athlete('half');
  const page = a.renderSacoroInstruments();
  const RIM = { 'rp-cherry':'var(--cherry)', 'rp-cyan':'var(--cyan)', 'rp-green':'var(--z-easy)', 'rp-blue':'var(--z-mp)' };
  const WANT = { fitness:'var(--cherry)', progress:'var(--cyan)', goal:'var(--z-easy)', benchmark:'var(--z-mp)' };
  Object.keys(WANT).forEach(k => {
    const mini = new RegExp('class="b-dial b-mini"[^>]*data-record="' + k + '"[^>]*--rd-base:([^;"]+)').exec(page);
    assert.ok(mini, k + ' has no small circle');
    assert.equal(mini[1], WANT[k], k + '’s small circle');
    const hero = /<div class="rp-hero">[\s\S]*?--rd-base:([^;"]+)/.exec(a.RECORD_PANELS[k]());
    assert.ok(hero, k + '’s sheet has no hero ring');
    assert.equal(hero[1], WANT[k], k + '’s hero ring');
    assert.equal(RIM[a.PANEL_ACCENT_CLASS[k]], WANT[k], k + '’s sheet rim');
  });
});

test('forms and ways in are plain glass; only Coach metric sheets wear a colour', () => {
  /* Founder: "Yes, plain glass for all three and activity". */
  const a = athlete('half');
  assert.match(a.STG_PAGE, /\brp-plain\b/);
  assert.doesNotMatch(a.STG_PAGE, /\brp-cherry\b/);
  assert.equal(a.PANEL_ACCENT_CLASS.history, 'rp-plain');
  assert.match(SRC, /openModal\(html, 'modal-themed builder-light hq-panel rp-plain hq-full restriction-panel'\)/);
  assert.match(SRC, /openModal\(circlePageHtml\(\), 'modal-themed builder-light hq-panel rp-plain hq-full circle-page'\)/);
  const plain = SRC.indexOf('.modal-overlay:has(> .hq-full.rp-plain) > .hq-full.rp-plain{');
  assert.ok(plain !== -1);
  assert.match(SRC.slice(plain, SRC.indexOf('}', plain)), /border:0/, 'a plain page still has a coloured edge');
  assert.ok(SRC.indexOf('.modal-overlay:has(> .hq-full.rp-plain) > .hq-full.rp-plain::before{') !== -1, 'no lit edge');
  ['recovery','evolution','adaptation','patterns','readiness','fitness','progress','goal','benchmark']
    .forEach(k => assert.notEqual(a.PANEL_ACCENT_CLASS[k], 'rp-plain', k + ' lost its colour'));
});
