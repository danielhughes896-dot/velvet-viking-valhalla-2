'use strict';
/* THE RACE-DAY JOURNEY, PHOTOGRAPHED AT EVERY STAGE.
 * ===========================================================================
 *   race block running -> taper -> Race Day passed, outcome pending
 *   -> Raced / DNF / DNS -> recovery running -> recovery done
 *
 * Each frame drives the app's OWN state transitions (recordRaceOutcome,
 * startDevelopmentBlock) inside the page and re-renders through renderApp(),
 * so what is photographed is the product's real path rather than markup posed
 * to look like it.
 *
 * It also MEASURES what the pass is about: whether the What's next card is
 * present at every stage, whether a live start-block action is offered, and
 * whether the outcome question is up. A stage that silently loses continuity
 * is the defect this exists to catch, and a screenshot alone would not.
 *
 *   node tools/shots/race-lifecycle-shots.js [outDir] [nameFilter]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-race-lifecycle');

/* Anchored to a real week so the plan lands on real weekdays. */
const BLOCK_START = '2026-07-27';
const RACE_DATE = '2026-10-25';

function athlete(pinned){
  const a = loadApp({ pinnedDate: pinned + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 13, startDate: BLOCK_START, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190, raceDate: RACE_DATE, hasEvent: true,
                 schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  a.state.setup.purpose = 'race';
  a.state.setup.raceDate = RACE_DATE;
  a.migrateAthleteRecord();
  return a;
}

/* view: which screen. FULL PLAN IS ITS OWN VIEW ('full'), not a Plan HQ tab --
   handleGoToCheckpoint() sets state.view='full'. Pointing these frames at
   'planhq' photographed the Valhalla overview and reported the continuity card
   missing from every single stage, which was the harness being wrong and not
   the product. */
const FRAMES = [
  { name: 'plan-01-block-running',  date: '2026-08-27', view: 'full' },
  { name: 'plan-02-taper-week',     date: '2026-10-20', view: 'full' },
  { name: 'today-03-outcome-ask',   date: '2026-10-26', view: 'today' },
  { name: 'plan-03-outcome-ask',    date: '2026-10-26', view: 'full' },
  { name: 'plan-04-raced',          date: '2026-10-26', view: 'full',
    setup: `recordRaceOutcome('raced');` },
  { name: 'plan-05-dnf',            date: '2026-10-26', view: 'full',
    setup: `recordRaceOutcome('dnf');` },
  { name: 'plan-06-dns',            date: '2026-10-26', view: 'full',
    setup: `recordRaceOutcome('dns');` },
  { name: 'plan-07-recovery-running', date: '2026-10-26', view: 'full',
    setup: `recordRaceOutcome('raced'); startDevelopmentBlock('recovery');` },
  /* Recovery finished: the block is built from the race date, so pinning a
     later "today" puts the athlete at its end without faking any state. */
  { name: 'plan-08-recovery-done',  date: '2026-11-08', view: 'full',
    seedFrom: '2026-10-26',
    setup: `recordRaceOutcome('raced'); startDevelopmentBlock('recovery');` }
];

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const only = process.argv[3] || '';
  const frames = only ? FRAMES.filter(f => f.name.indexOf(only) !== -1) : FRAMES;
  const results = [];

  for (const f of frames){
    /* The state is built at the date the block was LIVE, then the page is
       pinned to the frame's date -- otherwise a block started "today" on a
       date after its own end could not exist. */
    const state = athlete(f.seedFrom || f.date);
    for (const theme of ['light', 'dark']){
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
      await page.route('https://fonts.googleapis.com/**', r =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));

      const blob = Object.assign({}, JSON.parse(JSON.stringify(state.state)),
        { view: f.view, theme, themeExplicit: true });
      await page.addInitScript(seed, { key: state.STORAGE_KEY, state: JSON.stringify(blob) });
      /* Pin the page's clock to the frame's date without touching the plan. */
      await page.addInitScript(`(function(){
        var pinned = new Date(${JSON.stringify(f.date + 'T09:00:00Z')}).getTime();
        var RealDate = Date;
        function D(){ return arguments.length ? new RealDate(...arguments) : new RealDate(pinned); }
        D.now = function(){ return pinned; };
        D.parse = RealDate.parse; D.UTC = RealDate.UTC; D.prototype = RealDate.prototype;
        window.Date = D;
      })();`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      /* SETUP FIRST, THEN THE VIEW. startDevelopmentBlock() lands the athlete on
         Today -- correctly, it has just rebuilt their schedule -- so setting the
         view before running it photographed Today for every frame and reported
         the continuity card missing from the whole journey. The harness was
         wrong, not the product. */
      if (f.setup) try { await page.evaluate(f.setup); } catch (e) { errors.push('setup: ' + e.message); }
      try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), f.view); } catch (e) {}
      await page.waitForTimeout(150);
      try { await page.evaluate(() => window.renderApp && window.renderApp()); } catch (e) {}
      await page.waitForTimeout(350);

      const m = await page.evaluate(() => {
        const txt = document.body.innerText || '';
        /* MATCHED ON THE ELEMENT, NOT ON PROSE. The card's title is one of
           three strings and one of them contains a curly apostrophe; matching
           innerText for it made the whole sweep report continuity missing from
           every stage while the card was demonstrably rendering. The heading
           element is what actually identifies the card. */
        const titles = [...document.querySelectorAll('.coach-next-title')]
          .map(e => (e.textContent || '').trim());
        const isNext = (t) => /next/i.test(t) && !/^Next Move$/i.test(t);
        return {
          view: (window.state && window.state.view) || '?',
          titles: titles,
          whatsNext: titles.some(isNext),
          outcomeAsk: /How did/i.test(txt),
          recoverCue: /Recover first/.test(txt),
          startBlock: !!document.querySelector('[data-action="start-block"]'),
          nothingChanges: /Nothing changes until you choose/.test(txt),
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth
        };
      });
      const file = f.name + '-' + theme;
      await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
      results.push({ file, errors, m });
      console.log(file.padEnd(30) +
        ' view=' + String(m.view).padEnd(6) +
        ' next=' + (m.whatsNext ? 'y' : 'NO') +
        ' ask=' + (m.outcomeAsk ? 'y' : '-') +
        ' recover=' + (m.recoverCue ? 'y' : '-') +
        ' startBlock=' + (m.startBlock ? 'y' : '-') +
        ' choose=' + (m.nothingChanges ? 'y' : '-') +
        ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
        ' [' + m.titles.join(' | ') + ']' +
        (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
      await page.close(); await ctx.close();
    }
  }
  await browser.close(); server.close();

  /* THE INVARIANT THIS SWEEP EXISTS FOR: continuity is never lost, at any
     stage, in either theme. */
  const lost = results.filter(r => !r.m.whatsNext && r.file.indexOf('today-') !== 0);
  const bad = results.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  if (lost.length) console.log('CONTINUITY LOST ON: ' + lost.map(r => r.file).join(', '));
  if (bad.length) console.log('PROBLEMS: ' + bad.map(r => r.file).join(', '));
  if (!lost.length && !bad.length)
    console.log('What’s next present at every Full Plan stage; no overflow, no page errors');
})();
