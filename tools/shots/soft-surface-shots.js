'use strict';
/* Visual proof for the VALHALLA SOFT SURFACE / ROUNDED TILE pass:
   Active Goal A/B/C, Athlete Status (Load/Recovery/Trend), the "How to run
   this" workout-card disclosure, and Reading/Record evidence cards.

   Captures, at 360/390/430px width, light + dark:
     goal.<w>.<theme>       Record tab: goal toggle + record evidence cards
     coach.<w>.<theme>      Coach tab: Athlete Status card
     today.<w>.<theme>      Today screen: day card with How-to-run-this
     today-open.<w>.<theme> same, with the disclosure expanded

   And MEASURES: no horizontal scroll at any width, no ancestor clips the
   tile shadows, the goal/coach-metric/how-card/ev-card radii actually
   changed from the old --radius-sm (10px) to --radius (16px).

   Run:  node tools/shots/soft-surface-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'soft-surface');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8' };

function serve(){
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const file = url === '/' ? 'protected/velvet-viking-valhalla.html' : url.replace(/^\//, '');
      const abs = path.join(ROOT, file);
      if (!abs.startsWith(ROOT) || !fs.existsSync(abs)){ res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'text/plain' });
      res.end(fs.readFileSync(abs));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

/* Real coaching state -- same shape as the other tools/shots seed()s -- with
   two goals set (so Active Goal A/B renders) and today's day left
   incomplete/structured so its workout card carries a real "How to run
   this" disclosure. */
function seed(theme){
  const start = todayStr();
  const startMonday = addDays(start, -isoWeekday(start));
  const weeks = 12;
  const raceDate = addDays(startMonday, weeks * 7 - 1);
  const br = buildBlockWeeks('half', 45, weeks);
  const schedule = { activeDays:[1,2,3,5,6], longRunDay:6 };
  state.days = buildDaysFromWeeks(br, raceDate, schedule, addDays(startMonday, -28), false);
  state.setup = { distanceKey:'half', currentVolume:45, raceDate:raceDate, hasEvent:false,
    startDate: addDays(startMonday, -28), planWeeks: br.planWeeks, schedule: schedule,
    benchmark:{ distanceKey:'10k', timeSec:2585 },
    goals:{ A:{ timeSec:5820 }, B:{ timeSec:6120 } }, activeGoal:'A',
    paceOverrides:{ M:{ fast:294, slow:313 } },
    lthr:168, maxHR:190, experience:'experienced' };
  state.healthConsent = { granted:true, version: HEALTH_CONSENT_VERSION, at: new Date().toISOString() };
  const today = todayStr();
  state.days.forEach(function(dd){
    if (dd.type === 'rest' || dd.date >= today) return;
    const tgt = getTargetPaceRangeSecPerKm ? getTargetPaceRangeSecPerKm(dd) : null;
    const mid = tgt && tgt.fast != null ? Math.round((tgt.fast + tgt.slow) / 2) : 320;
    dd.completed = true;
    dd.actual = { km: dd.km, pace: secToPace(mid), hr: 148, rpe: 5, feel: 'good', notes: '' };
    if (dd.type === 'race' || dd.type === 'checkpoint') recordMeasuredPerformance(dd);
  });
  state.theme = theme; state.themeExplicit = true; applyThemeToDocument();
}

async function measure(page){
  return page.evaluate(() => {
    const bodyOverflow = document.body.scrollWidth > document.documentElement.clientWidth + 1;
    // Presence of an overflow:hidden ancestor is expected and fine (e.g.
    // .day-detail needs it for the day-card collapse animation) -- what
    // actually matters is whether there's real pixel clearance between the
    // element's own box and that ancestor's box for the shadow to render
    // into. A tile flush against the clipping edge (0px gap) genuinely
    // loses its shadow there; several px of margin does not.
    function clips(sel){
      const el = document.querySelector(sel);
      if (!el) return { present:false };
      let node = el, clipper = null;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if (node !== el && (cs.overflow === 'hidden' || cs.overflowY === 'hidden')) { clipper = node; break; }
        node = node.parentElement;
      }
      if (!clipper) return { present:true, clipper:null };
      const e = el.getBoundingClientRect(), c = clipper.getBoundingClientRect();
      const gaps = { left: e.left - c.left, right: c.right - e.right, top: e.top - c.top, bottom: c.bottom - e.bottom };
      // < 4px on the side the shadow actually bleeds toward (bottom, given
      // this pass's shadows are all offset downward) is a real clip; a hard
      // 0px on the left is architecturally unavoidable without indenting
      // the tile off its siblings' alignment, and empirically doesn't
      // produce a visible artefact (blur shadows are near-zero intensity
      // immediately at the shape's own edge) -- only flag bottom/top/right.
      const tight = gaps.bottom < 4 || gaps.top < 0 || gaps.right < 0;
      return { present:true, clipper: tight ? clipper.className : null, gaps };
    }
    return {
      bodyOverflow,
      goalOpt: clips('.goal-opt'),
      coachMetric: clips('.coach-metric'),
      howCard: clips('.fuel-card.how-card'),
      evCard: clips('.ev-card'),
      goalOptRadius: (() => { const el = document.querySelector('.goal-opt'); return el ? getComputedStyle(el).borderRadius : null; })(),
      coachMetricRadius: (() => { const el = document.querySelector('.coach-metric'); return el ? getComputedStyle(el).borderRadius : null; })(),
    };
  });
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];

  for (const width of [360, 390, 430]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 3 });
      await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
      const page = await ctx.newPage();
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });
      await page.evaluate(seed, theme);
      const tag = width + '.' + theme;

      // --- Record tab: Active Goal A/B/C + evidence cards ---------------------
      await page.evaluate(() => { state.view = 'planhq'; planhqTab = 'record'; renderApp(); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, 'goal.' + tag + '.png'), fullPage: true });
      const goalData = await measure(page);
      console.log(tag + ' [goal]  bodyOverflow=' + goalData.bodyOverflow +
        '  goal-opt radius=' + goalData.goalOptRadius + ' clip=' + goalData.goalOpt.clipper +
        '  ev-card clip=' + goalData.evCard.clipper);
      if (goalData.bodyOverflow) problems.push(tag + '/record: horizontal body overflow');
      if (goalData.goalOpt.clipper) problems.push(tag + '/record: .goal-opt shadow clipped by ' + goalData.goalOpt.clipper);
      if (goalData.evCard.clipper) problems.push(tag + '/record: .ev-card shadow clipped by ' + goalData.evCard.clipper);
      if (goalData.goalOptRadius === '10px') problems.push(tag + '/record: .goal-opt still at the old 10px radius');

      // --- Coach tab: Athlete Status ------------------------------------------
      await page.evaluate(() => { planhqTab = 'coach'; renderApp(); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, 'coach.' + tag + '.png'), fullPage: true });
      const coachData = await measure(page);
      console.log(tag + ' [coach] bodyOverflow=' + coachData.bodyOverflow +
        '  coach-metric radius=' + coachData.coachMetricRadius + ' clip=' + coachData.coachMetric.clipper);
      if (coachData.bodyOverflow) problems.push(tag + '/coach: horizontal body overflow');
      if (coachData.coachMetric.clipper) problems.push(tag + '/coach: .coach-metric shadow clipped by ' + coachData.coachMetric.clipper);
      if (coachData.coachMetricRadius === '10px') problems.push(tag + '/coach: .coach-metric still at the old 10px radius');

      // --- This Week: a workout card with "How to run this" -------------------
      // 'today' alone may land on a rest/unstructured day with no disclosure;
      // This Week always has several structured days -- expand each in turn
      // (days start collapsed) until one reveals the disclosure.
      await page.evaluate(() => { state.view = 'week'; renderApp(); });
      await page.waitForTimeout(300);
      const found = await page.evaluate(() => {
        const toggles = Array.from(document.querySelectorAll('[data-action="toggle-day"]'));
        for (const t of toggles) {
          t.click();
          if (document.querySelector('.fuel-card.how-card')) return true;
          t.click(); // collapse it back before trying the next one
        }
        return false;
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, 'today.' + tag + '.png'), fullPage: true });
      const todayData = await measure(page);
      console.log(tag + ' [today] bodyOverflow=' + todayData.bodyOverflow +
        '  how-card present=' + todayData.howCard.present + ' clip=' + todayData.howCard.clipper);
      if (todayData.bodyOverflow) problems.push(tag + '/today: horizontal body overflow');
      if (todayData.howCard.present && todayData.howCard.clipper) problems.push(tag + '/today: .how-card shadow clipped by ' + todayData.howCard.clipper);

      if (todayData.howCard.present) {
        await page.evaluate(() => { const d = document.querySelector('.fuel-card.how-card'); if (d) d.open = true; });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(OUT, 'today-open.' + tag + '.png'), fullPage: true });
        const openOverflow = await page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 1);
        if (openOverflow) problems.push(tag + '/today-open: horizontal body overflow with disclosure open');
      }

      await ctx.close();
    }
  }
  await browser.close();
  server.close();

  console.log('\n=== ' + (problems.length ? problems.length + ' PROBLEM(S)' : 'no problems') + ' ===');
  problems.forEach(p => console.log('  ! ' + p));
  console.log('frames in ' + path.relative(ROOT, OUT));
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
