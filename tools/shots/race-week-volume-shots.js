'use strict';
/* THE END OF A MARATHON BLOCK, PHOTOGRAPHED AS AN ATHLETE MEETS IT.
 * ===========================================================================
 * Peak (Week 10, 79 km) -> Taper (11, 59) -> Taper (12, 40) -> Race Week
 * (13, 25) -> the standalone RACE DAY event underneath it.
 *
 * The pass this exists for is a number: race week used to print 0/67.2 km
 * because a 42.2 km race was added to 25 km of shakeout running, so the block
 * finished by reversing its own taper on the last week. The sweep therefore
 * MEASURES the sequence -- every week header read out of the live DOM, the
 * descent checked, the race counted -- rather than trusting the eye to spot
 * one wrong figure in a column of thirteen.
 *
 *   node tools/shots/race-week-volume-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-race-week-volume');

const TODAY = '2026-08-27';
const SCHEDULE = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };

/* A real marathon block through the app's own generator, so every figure in
   the photograph is one the engine wrote. */
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  const startDate = a.addDays(a.todayStr(), -35);
  const startMonday = a.addDays(startDate, -a.isoWeekday(startDate));
  const raceDate = a.addDays(startMonday, 13 * 7 - 1);
  const blockResult = a.buildBlockWeeks('full', 45, 13);
  a.state = a.makeDefaultState();
  a.state.setup = {
    distanceKey: 'full', currentVolume: 45, raceDate, hasEvent: true,
    startDate, planWeeks: blockResult.planWeeks, schedule: SCHEDULE,
    benchmark: { distanceKey: '10k', timeSec: a.clockToSec('0:45:00') },
    goals: { A: { timeSec: a.clockToSec('3:30:00') } }, activeGoal: 'A',
    paceOverrides: {}, lthr: 172, maxHR: 190, experience: 'experienced', purpose: 'race'
  };
  a.state.days = a.buildDaysFromWeeks(blockResult, raceDate, SCHEDULE, startDate, true);
  a.state.athlete = { sessions: [], baselines: {}, blocks: [] };
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
    decidedAt: '2026-01-01T09:00:00.000Z', grantedAt: '2026-01-01T09:00:00.000Z',
    withdrawnAt: null };
  a.migrateAthleteRecord();
  /* Race week open, so the standalone event and the week it follows are in the
     same frame -- that adjacency is the whole point of the change. */
  a.state.expandedWeeks = {};
  return a;
}

const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json',
               '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2',
               '.html':'text/html; charset=utf-8' };
function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
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

/* `at` pins only the PAGE's clock; the plan is always built at TODAY, so every
   frame photographs the same block seen from a different day. `race` says
   whether the standalone event belongs in this frame at all -- This Week shows
   it only when the athlete is actually in race week. */
const FRAMES = [
  { name: 'fullplan-collapsed',      view: 'full', open: [],   race: true },
  { name: 'fullplan-raceweek-open',  view: 'full', open: [13], race: true },
  { name: 'fullplan-taper-open',     view: 'full', open: [11, 12, 13], race: true },
  { name: 'thisweek-midblock',       view: 'week', open: [],   race: false },
  { name: 'thisweek-raceweek',       view: 'week', open: [],   race: true, at: '2026-10-14' }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];

  for (const f of FRAMES){
    const a = athlete();
    for (const theme of ['light', 'dark']){
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
      await page.route('https://fonts.googleapis.com/**', r =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));

      const expanded = {};
      f.open.forEach(w => { expanded[w] = true; });
      const blob = Object.assign({}, JSON.parse(JSON.stringify(a.state)),
        { view: f.view, theme, themeExplicit: true, expandedWeeks: expanded });
      await page.addInitScript(seed, { key: a.STORAGE_KEY, state: JSON.stringify(blob) });
      await page.addInitScript(`(function(){
        var pinned = new Date(${JSON.stringify((f.at || TODAY) + 'T09:00:00Z')}).getTime();
        var RealDate = Date;
        function D(){ return arguments.length ? new RealDate(...arguments) : new RealDate(pinned); }
        D.now = function(){ return pinned; };
        D.parse = RealDate.parse; D.UTC = RealDate.UTC; D.prototype = RealDate.prototype;
        window.Date = D;
      })();`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      /* SET THE VIEW THROUGH THE APP, not only through the seeded blob. The
         seeded view is honoured on a cold boot, but going through the app's
         own handler is what a tap does and is what re-renders. */
      try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), f.view); } catch (e) {}
      try { await page.evaluate(ws => { ws.forEach(w => { window.expandedWeeks[w] = true; }); },
        f.open); } catch (e) {}
      try { await page.evaluate(() => window.renderApp && window.renderApp()); } catch (e) {}
      await page.waitForTimeout(400);

      /* READ THE HEADERS OUT OF THE LIVE DOM. A screenshot proves the layout;
         only this proves the arithmetic. */
      const m = await page.evaluate(() => {
        const weeks = [...document.querySelectorAll('.week')].map(el => ({
          id: el.id,
          phase: (el.querySelector('.week-phase') || {}).textContent || '',
          vol: (el.querySelector('.week-vol .v') || {}).textContent || '',
          days: el.querySelectorAll('.week-body .day').length
        }));
        const ev = document.querySelector('.race-event');
        return {
          weeks,
          raceEvents: document.querySelectorAll('.race-event').length,
          raceDividers: [...document.querySelectorAll('.race-divider .l')]
            .map(e => e.textContent.trim()),
          raceEventDist: ev ? (ev.querySelector('.race-event-dist') || {}).textContent : null,
          raceEventWhen: ev ? (ev.querySelector('.race-event-when') || {}).textContent : null,
          raceCardsInWeeks: document.querySelectorAll('.week-body .day.type-race').length,
          raceCardsInEvent: document.querySelectorAll('.race-event .day').length,
          combinedNote: /Total includes/i.test(document.body.innerText || ''),
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth
        };
      });

      const file = f.name + '-' + theme;
      await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
      /* A tight crop of the sequence this pass is about -- the last taper weeks
         and the standalone event -- so the change can be read without scrolling
         a thirteen-week full-page capture. */
      const seq = await page.$('.week#week-' + (a.totalWeeksInPlan() - 2));
      const ev = await page.$('.race-event');
      if (seq && ev){
        const s1 = await seq.boundingBox(), s2 = await ev.boundingBox();
        if (s1 && s2) await page.screenshot({ path: path.join(OUT, file + '-sequence.png'),
          fullPage: true,
          clip: { x: 0, y: Math.max(0, s1.y - 8), width: 390,
                  height: Math.min(2400, s2.y + s2.height - s1.y + 16) } });
      }
      results.push({ file, errors, m, race: f.race });

      const tail = m.weeks.slice(-4).map(w => w.phase.replace(/Now$/, '') + ' ' + w.vol).join('  |  ');
      console.log(file.padEnd(30) +
        ' raceEvents=' + m.raceEvents +
        ' raceInWeek=' + m.raceCardsInWeeks +
        ' raceInEvent=' + m.raceCardsInEvent +
        ' combinedNote=' + (m.combinedNote ? 'YES' : 'no') +
        ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no'));
      console.log('  ' + tail + (m.raceEventDist ? '   ->  ' +
        m.raceDividers.join('/') + ' ' + m.raceEventWhen + ' ' + m.raceEventDist : ''));
      if (errors.length) console.log('  ERRORS: ' + errors.slice(0, 2).join(' | '));
      await page.close(); await ctx.close();
    }
  }
  await browser.close(); server.close();

  /* THE INVARIANTS. Each one is a way this pass could be silently undone. */
  const problems = [];
  results.forEach(r => {
    if (r.errors.length) problems.push(r.file + ': page errors');
    if (r.m.scrollW > r.m.clientW + 1) problems.push(r.file + ': horizontal overflow');
    if (r.m.combinedNote) problems.push(r.file + ': the combined-total note is back');
    if (r.m.raceCardsInWeeks) problems.push(r.file + ': the race is inside a week again');
    const want = r.race ? 1 : 0;
    if (r.m.raceEvents !== want)
      problems.push(r.file + ': ' + r.m.raceEvents + ' race events, expected ' + want);
    if (r.m.raceCardsInEvent !== want)
      problems.push(r.file + ': ' + r.m.raceCardsInEvent + ' race cards in the event, expected ' + want);
    /* The taper must descend all the way to race week -- only meaningful on a
       frame that shows the whole block. */
    if (r.m.weeks.length > 3){
      const nums = r.m.weeks.map(w => parseFloat((w.vol.split('/')[1] || '0')));
      for (let i = nums.length - 3; i < nums.length; i++){
        if (i > 0 && nums[i] >= nums[i - 1])
          problems.push(r.file + ': week ' + (i + 1) + ' (' + nums[i] +
            ') is not below week ' + i + ' (' + nums[i - 1] + ')');
      }
    }
  });
  console.log('\n' + results.length + ' frames -> ' + OUT);
  if (problems.length) console.log('PROBLEMS:\n  ' + problems.join('\n  '));
  else console.log('Taper descends to race week; race day renders once, standalone; ' +
    'no combined total, no overflow, no page errors');
})();
