'use strict';
/* INJURY / TRAINING RESTRICTION -- THE THREE STATES OF THE CARD, AND THE MODAL.
 * ===========================================================================
 *   declare   the modal an athlete meets after tapping Settings -> Training
 *             Availability: two levels, three durations, one date field
 *   open      Today while a restriction is running
 *   back      the "are you back?" question once the window has run out
 *   easing    Today while the graded return is still in force
 *
 * MEASURED as well as photographed. A screenshot cannot prove that the
 * restricted days are actually out of the adherence reading, so each frame
 * also reports what the plan looks like underneath it.
 *
 *   node tools/shots/restriction-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const ROOT = process.env.VVV_ROOT || path.join(__dirname, '..', '..');
const { loadApp } = require(path.join(ROOT, 'test', 'harness.js'));
const { buildPlan } = require(path.join(ROOT, 'test', 'fixtures.js'));

const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-restriction');
const TODAY = new Date().toISOString().slice(0, 10);

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 55, weeks: 14, lthr: 172, maxHR: 188,
                 startDate: a.addDays(TODAY, -35) });
  a.state.setup.purpose = 'race';
  // six weeks of real training behind them, so the evidence layer has something
  a.state.days.forEach(d => {
    if (d.date >= TODAY || d.type === 'rest') return;
    d.completed = true;
    d.actual = { km: d.km, pace: '5:05', paceUnit: 'km', hr: 148, rpe: 5, feel: 'good', notes: '' };
  });
  return a;
}
/* An athlete Valhalla can actually speak about: two measured efforts (so a
   demonstrated rate exists) and a completed Fitness Checkpoint (so the
   intervention card is earned). Nothing here is special to the restriction
   -- it is the ordinary precondition raceGoalAssessment() has always had. */
function measuredAthlete(a){
  [[-35, 250], [-5, 240]].forEach(function(pair){
    var d = a.state.days.filter(function(x){ return x.date === a.addDays(TODAY, pair[0]); })[0];
    if (!d) return;
    d.type = 'checkpoint'; d.km = 5; d.completed = true;
    d.actual = { km:5, timeSec: 5 * pair[1],
                 pace: Math.floor(pair[1]/60) + ':' + String(pair[1]%60), paceUnit:'km' };
    a.recordMeasuredPerformance(d);
  });
  return a;
}
const STATE = athlete();

const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json',
               '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2',
               '.html':'text/html; charset=utf-8' };
function serve(runtime){
  const html = fs.readFileSync(runtime, 'utf8');
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html'){
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    const file = path.join(ROOT, url.replace(/^\/+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}
function seed(p){ try { localStorage.setItem(p.key, p.state); } catch (e) {} }

function measure(){
  const card = document.querySelector('.yr-outcome');
  const picks = [...document.querySelectorAll('.rs-pick')];
  const txt = el => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null);
  return {
    hasCard: !!card,
    cardTitle: txt(document.querySelector('.yr-outcome .coach-next-title')),
    prepLine: txt(document.querySelector('.cp-prep')),
    cardText: (txt(card) || '').slice(0, 180),
    picks: picks.length,
    picked: picks.filter(p => p.classList.contains('is-picked')).length,
    pickLabels: picks.map(p => txt(p.querySelector('.rs-pick-label'))),
    modal: !!document.querySelector('.modal-card'),
    view: (typeof state !== 'undefined' && state) ? state.view : null,
    dayCards: document.querySelectorAll('.day-top').length,
    allLabels: document.querySelectorAll('.day-status-label').length,
    restrictedLabels: document.querySelectorAll('.day-status-label.restricted').length,
    missedLabels: document.querySelectorAll('.day-status-label.missed').length,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
  };
}

const SCENES = [
  { tag:'open',    view:'today',    setup: a => { a.declareRestriction('none', a.addDays(TODAY, 20)); } },
  { tag:'back',    view:'today',    setup: a => { a.declareRestriction('easy', a.addDays(TODAY, 3));
                                                  a.state.setup.restriction.from = a.addDays(TODAY, -18);
                                                  a.state.setup.restriction.until = a.addDays(TODAY, -1); } },
  /* BACK, AND THE PRODUCT CLAIMS NOTHING. There is deliberately no third
     card: Valhalla does not size a return (see the RETURN TO TRAINING
     open-authority note in the runtime), so a card implying it was managing
     one would be a coaching act the product is not performing. This frame
     exists to show the programme restored, intensity included. */
  { tag:'resumed', view:'today',    setup: a => { a.declareRestriction('none', a.addDays(TODAY, 10));
                                                  a.state.setup.restriction.from = a.addDays(TODAY, -18);
                                                  a.endRestriction(); } },
  /* THE SENTENCE AN INTERRUPTED ATHLETE ACTUALLY READS, which needs a
     demonstrated rate (two measured efforts) and a completed checkpoint
     before raceGoalAssessment() will speak at all. */
  { tag:'checkpoint', view:'today', setup: a => { measuredAthlete(a);
                                                  a.declareRestriction('none', a.addDays(TODAY, 41)); } },
  { tag:'plan',    view:'full',     setup: a => { a.declareRestriction('none', a.addDays(TODAY, 20)); } },
  { tag:'settings',view:'settings', setup: a => {} },
  { tag:'declare', view:'settings', setup: a => {}, modal:true },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const rows = [];
  const { server, url } = await serve(RUNTIME);
  for (const scene of SCENES){
    const a = athlete();
    scene.setup(a);
    const seeded = JSON.parse(JSON.stringify(a.state));
    for (const width of [360, 390, 430]){
      for (const theme of ['dark', 'light']){
        const ctx = await browser.newContext({ viewport: { width, height: 900 },
          deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        await page.addInitScript(seed, { key: STATE.STORAGE_KEY,
          state: JSON.stringify(Object.assign({}, seeded,
            { view: scene.view, theme, themeExplicit: true })) });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
        /* THE SEEDED VIEW IS NOT THE RENDERED VIEW. init() decides what to
           show, so a view asked for in storage can arrive as Today -- which
           is how an earlier run of this tool produced six frames of the
           wrong screen and called them Full Plan. Set it in the page and
           re-render, then assert below that the frame really is that view. */
        try { await page.evaluate((v) => { state.view = v; renderApp(); }, scene.view); }
        catch (e) { errors.push('view: ' + e.message); }
        await page.waitForTimeout(300);
        if (scene.view === 'full'){
          try { await page.evaluate(() => {
            const w = currentWeekNum() || 1;
            expandedWeeks[w] = true; renderApp();
          }); } catch (e) { errors.push('expand: ' + e.message); }
          await page.waitForTimeout(300);
        }
        if (scene.modal){
          try { await page.evaluate(() => { openRestrictionModal(); }); }
          catch (e) { errors.push('modal: ' + e.message); }
          await page.waitForTimeout(350);
        }
        const m = await page.evaluate(measure);
        if ((scene.tag === 'open' || scene.tag === 'back') && !m.hasCard)
          errors.push('no restriction card rendered — this frame proves nothing');
        if (scene.tag === 'resumed' && m.hasCard)
          errors.push('a card is claiming a return Valhalla does not manage');
        if (scene.tag === 'resumed' && m.restrictedLabels)
          errors.push('the programme did not come back — this frame proves nothing');
        if (scene.tag === 'checkpoint' && !m.prepLine)
          errors.push('no preparation sentence rendered — this frame proves nothing');
        if (scene.tag === 'declare' && !m.picks)
          errors.push('the modal rendered no picks — this frame proves nothing');
        if (scene.tag === 'plan' && !m.restrictedLabels)
          errors.push('no Restricted labels on Full Plan — this frame proves nothing');
        if (m.view !== scene.view)
          errors.push('rendered ' + m.view + ', not ' + scene.view + ' — this frame proves nothing');
        const file = scene.tag + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        rows.push({ file, tag: scene.tag, width, theme, errors, m });
        console.log(file.padEnd(22) +
          ' card=' + (m.hasCard ? JSON.stringify(m.cardTitle) : 'none') +
          ' picks=' + m.picks + '/' + m.picked +
          ' view=' + m.view + ' cards=' + m.dayCards + ' labels=' + m.allLabels +
          ' restricted=' + m.restrictedLabels + ' missed=' + m.missedLabels +
          (m.prepLine ? ' prep=' + JSON.stringify(m.prepLine.slice(0, 48)) : '') +
          ' xoverflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        await page.close(); await ctx.close();
      }
    }
  }
  server.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  const bad = rows.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1);
  console.log('\n' + rows.length + ' frames, ' + bad.length + ' with a problem');
  bad.forEach(b => console.log('  ' + b.file + ': ' + (b.errors.join(' | ') || 'layout')));
})();
