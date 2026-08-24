'use strict';
/* Visual proof for the VALHALLA 3D VISUAL LANGUAGE pass: the Confidence
   gauge's refined depth, alongside the already-refined Reading badges, in
   normal Valhalla context.

   Captures, at 360px and 390px width, light + dark:
     gauge.<w>.<theme>       the Confidence gauge alone, tightly cropped
     hero.<w>.<theme>        the whole hero card (gauge + block/week/figures)
     valhalla.<w>.<theme>    the full Valhalla screen (hero + Reading + Record)

   And MEASURES:
     - the gauge's cream face is sized to the inner ring, not the old
       full-132px box (so it doesn't visually collide with the ticks)
     - the confidence number is still exactly computeConfidenceScore()'s
       value -- the depth pass must not have touched the calculation
     - the gauge's own drop-shadow is not clipped by an ancestor

   Run:  node tools/shots/valhalla-3d-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'valhalla-3d');
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

/* Same fixture as tools/shots/reading-badges-shots.js's seed() -- real
   coaching state, not a hand-picked value. */
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
    benchmark:{ distanceKey:'10k', timeSec:2585 }, goals:{ A:{ timeSec:5820 } },
    activeGoal:'A', paceOverrides:{ M:{ fast:294, slow:313 } },
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
  state.view = 'planhq'; planhqTab = 'valhalla';
  renderApp();
}

async function clipOf(page, sel, padTop, padBottom, width){
  return page.evaluate(({ sel, padTop, padBottom, width }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: 0, y: r.top + window.scrollY - padTop, width, height: r.height + padTop + padBottom };
  }, { sel, padTop, padBottom, width });
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];

  for (const width of [360, 390]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 3 });
      await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
      const page = await ctx.newPage();
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });
      await page.evaluate(seed, theme);
      await page.waitForTimeout(400);

      const tag = width + '.' + theme;
      await page.screenshot({ path: path.join(OUT, 'valhalla.' + tag + '.png'), fullPage: true });
      const heroClip = await clipOf(page, '.v-hero', 12, 12, width);
      if (heroClip) await page.screenshot({ path: path.join(OUT, 'hero.' + tag + '.png'), fullPage: true, clip: heroClip });
      const gaugeClip = await clipOf(page, '.gauge-wrap', 20, 20, width);
      if (gaugeClip) await page.screenshot({ path: path.join(OUT, 'gauge.' + tag + '.png'), fullPage: true, clip: gaugeClip });

      const data = await page.evaluate(() => {
        const wrap = document.querySelector('.gauge-wrap');
        const num = document.querySelector('.gauge-num');
        const b = document.querySelector('.gauge-num b');
        const real = window.formatConfidencePct(window.computeConfidenceScore());
        const shown = b.textContent.replace('%', '');
        let clipper = null, node = wrap;
        while (node && node !== document.body) {
          const cs = getComputedStyle(node);
          if (node !== wrap && (cs.overflow === 'hidden' || cs.overflowY === 'hidden')) { clipper = node.className; break; }
          node = node.parentElement;
        }
        return {
          matches: real === shown, real, shown,
          numW: Math.round(num.getBoundingClientRect().width),
          numH: Math.round(num.getBoundingClientRect().height),
          wrapW: Math.round(wrap.getBoundingClientRect().width),
          clipper,
        };
      });
      console.log(tag + ': confidence ' + data.shown + '% (calc ' + data.real + '%), gauge-num ' +
        data.numW + 'x' + data.numH + ' inside ' + data.wrapW + 'px wrap, clipper=' + data.clipper);
      if (!data.matches) problems.push(tag + ': displayed confidence (' + data.shown + '%) != computeConfidenceScore() (' + data.real + '%)');
      if (data.clipper) problems.push(tag + ': an ancestor (' + data.clipper + ') clips the gauge shadow');

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
