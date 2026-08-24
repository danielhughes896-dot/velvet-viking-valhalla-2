'use strict';
/* Diagnostic + verification capture for the UNIFY WORKOUT CARDS pass
   (Today / This Week / Full Plan shared workout-card visual language).

   Seeds a half-marathon plan, finds representative days by step-count/type,
   and screenshots the states named in the task brief's verification list:

     today-structured.<w>.<theme>   Today: expanded 3-step structured workout
     today-simple.<w>.<theme>       Today: simple/easy (1-step) workout
     today-pace-ref.<w>.<theme>     Today: Pace Reference card
     week-structured.<w>.<theme>    This Week: expanded structured workout
     week-collapsed.<w>.<theme>     This Week: collapsed day rows
     week-zones.<w>.<theme>         This Week: Weekly Zone Breakdown
     plan-collapsed.<w>.<theme>     Full Plan: collapsed week
     plan-expanded.<w>.<theme>      Full Plan: expanded week (day list)
     plan-structured.<w>.<theme>    Full Plan: expanded structured workout
     plan-nonthree.<w>.<theme>      Full Plan: a day whose step count != 3 (vertical layout)
     plan-rest.<w>.<theme>          Full Plan: a rest day
     plan-zones.<w>.<theme>         Full Plan: Weekly Zone Breakdown (expanded week)

   Run:  node tools/shots/unify-cards.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'unify-cards');
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
  state.healthConsent = { version: HEALTH_CONSENT_VERSION, decision:'granted', decidedAt: new Date().toISOString(), grantedAt: new Date().toISOString(), withdrawnAt: null };
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

/* Classify every future day by its structured step-count so we can pick
   concrete representative dates instead of guessing which workout type
   produces which shape. */
function classify(){
  const today = todayStr();
  const out = { three: null, nonThree: null, single: null, rest: null, weekOfThree: null, weekOfNonThree: null };
  for (const dd of state.days) {
    if (dd.date < today) continue;
    if (dd.type === 'rest') { if (!out.rest) out.rest = dd.date; continue; }
    let steps = null;
    try { steps = workoutSteps(dd); } catch(e) { steps = null; }
    const n = steps ? steps.length : 0;
    if (n === 3 && !out.three) { out.three = dd.date; out.weekOfThree = dd.week; }
    if (n && n !== 3 && !out.nonThree) { out.nonThree = dd.date; out.weekOfNonThree = dd.week; }
    if (n === 1 && !out.single) out.single = dd.date;
  }
  return out;
}

/* There is no test-only "today" override in the app -- todayStr() reads the
   real system clock. To reliably show a chosen workout SHAPE (3-step,
   1-step, ...) in the actual Today page (with its real Next Move/Proceed
   pill/Pace Reference around it), transplant that day's fields onto
   whichever state.days entry really is today, keeping today's own date/week
   so renderTodayView() picks it up naturally. Runs INSIDE page.evaluate, so
   it must be self-contained (no references to node-side helpers).
   Reverted by re-seeding (each capture iteration re-seeds from scratch). */
function swapTodayWithInPage(dateStr){
  const t = todayStr();
  const todayDay = state.days.find((d) => d.date === t);
  const rep = state.days.find((d) => d.date === dateStr);
  if (!todayDay || !rep) return false;
  const keep = { date: todayDay.date, week: todayDay.week };
  Object.assign(todayDay, rep, keep);
  return true;
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];
  const widths = process.env.UC_WIDTHS ? process.env.UC_WIDTHS.split(',').map(Number) : [360, 390, 430];
  const themes = process.env.UC_THEMES ? process.env.UC_THEMES.split(',') : ['light', 'dark'];

  for (const width of widths) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: 2 });
      await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
      const page = await ctx.newPage();
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });
      await page.evaluate('(function(){ window.swapTodayWithInPage = ' + swapTodayWithInPage.toString() + '; })();');
      await page.evaluate(seed, theme);
      const info = await page.evaluate(classify);
      const tag = width + '.' + theme;
      console.log(tag + ' classify: ' + JSON.stringify(info));

      const bodyOverflow = async () => page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 1);

      // --- TODAY: transplant the "three-stage" day onto today's slot so the
      // expanded structured workout renders in the real Today page chrome. ----
      if (info.three) {
        await page.evaluate((d) => { window.swapTodayWithInPage(d); state.view = 'today'; renderApp(); }, info.three);
        await page.waitForTimeout(250);
        await page.evaluate(() => { const t = document.querySelector('[data-action="toggle-day"]'); if (t) t.click(); });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, 'today-structured.' + tag + '.png'), fullPage: true });
        if (await bodyOverflow()) problems.push(tag + '/today-structured: horizontal overflow');
      }
      // Pace Reference + Proceed pill: re-seed to restore the original today.
      await page.evaluate(seed, theme);
      await page.evaluate(() => { state.view = 'today'; renderApp(); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'today-pace-ref.' + tag + '.png'), fullPage: true });
      if (await bodyOverflow()) problems.push(tag + '/today-pace-ref: horizontal overflow');

      if (info.single) {
        await page.evaluate((d) => { window.swapTodayWithInPage(d); state.view = 'today'; renderApp(); }, info.single);
        await page.waitForTimeout(250);
        await page.evaluate(() => { const t = document.querySelector('[data-action="toggle-day"]'); if (t) t.click(); });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, 'today-simple.' + tag + '.png'), fullPage: true });
      }
      await page.evaluate(seed, theme); // restore clean state before This Week / Full Plan

      // --- THIS WEEK ------------------------------------------------------------
      await page.evaluate(() => { state.view = 'week'; renderApp(); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'week-collapsed.' + tag + '.png'), fullPage: true });
      if (await bodyOverflow()) problems.push(tag + '/week-collapsed: horizontal overflow');
      await page.screenshot({ path: path.join(OUT, 'week-zones.' + tag + '.png'), fullPage: true });

      const weekExpanded = await page.evaluate(() => {
        const toggles = Array.from(document.querySelectorAll('[data-action="toggle-day"]'));
        for (const t of toggles) {
          t.click();
          if (document.querySelector('.ws-steps-h, .ws-steps')) return true;
          t.click();
        }
        return false;
      });
      await page.waitForTimeout(250);
      if (weekExpanded) {
        await page.screenshot({ path: path.join(OUT, 'week-structured.' + tag + '.png'), fullPage: true });
        if (await bodyOverflow()) problems.push(tag + '/week-structured: horizontal overflow');
      }

      // --- FULL PLAN --------------------------------------------------------
      await page.evaluate(() => { state.view = 'full'; renderApp(); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'plan-collapsed.' + tag + '.png'), fullPage: true });
      if (await bodyOverflow()) problems.push(tag + '/plan-collapsed: horizontal overflow');

      // Expand the week containing the 3-step day, then expand that day row
      // too (weeks and days are independently collapsible accordions).
      if (info.weekOfThree != null) {
        const expanded = await page.evaluate((wk) => {
          const row = document.querySelector('[data-action="toggle-week"][data-week="' + wk + '"]');
          if (!row) return false;
          row.click();
          const dayToggles = Array.from(document.querySelectorAll('[data-action="toggle-day"]'));
          for (const t of dayToggles) {
            t.click();
            if (document.querySelector('.ws-steps-h')) return true;
            t.click();
          }
          return false;
        }, info.weekOfThree);
        await page.waitForTimeout(250);
        if (expanded) {
          await page.screenshot({ path: path.join(OUT, 'plan-expanded.' + tag + '.png'), fullPage: true });
          await page.screenshot({ path: path.join(OUT, 'plan-structured.' + tag + '.png'), fullPage: true });
          await page.screenshot({ path: path.join(OUT, 'plan-zones.' + tag + '.png'), fullPage: true });
          if (await bodyOverflow()) problems.push(tag + '/plan-expanded: horizontal overflow');
        } else {
          problems.push(tag + '/plan-structured: could not find a 3-step day to expand in week ' + info.weekOfThree);
        }
      }

      // Expand a week containing a non-3-step structured day (vertical layout)
      if (info.weekOfNonThree != null) {
        await page.evaluate(() => { state.view = 'full'; renderApp(); });
        await page.waitForTimeout(150);
        const expanded2 = await page.evaluate((wk) => {
          const row = document.querySelector('[data-action="toggle-week"][data-week="' + wk + '"]');
          if (!row) return false;
          row.click();
          const dayToggles = Array.from(document.querySelectorAll('[data-action="toggle-day"]'));
          for (const t of dayToggles) {
            t.click();
            if (document.querySelector('.ws-steps')) return true;
            t.click();
          }
          return false;
        }, info.weekOfNonThree);
        await page.waitForTimeout(250);
        if (expanded2) {
          await page.screenshot({ path: path.join(OUT, 'plan-nonthree.' + tag + '.png'), fullPage: true });
        }
      }

      // A rest day, if collapsible week found
      if (info.rest) {
        await page.evaluate(() => { state.view = 'full'; renderApp(); });
        await page.waitForTimeout(150);
        await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('[data-action="toggle-week"]'));
          rows.forEach(r => r.click());
        });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, 'plan-rest.' + tag + '.png'), fullPage: true });
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
