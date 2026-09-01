'use strict';
/* RECORDED LAPS ON A COMPLETED SESSION -- BEFORE AND AFTER.
 * ===========================================================================
 * The change is that an imported activity's DEVICE laps survive, so the frames
 * are the completed interval card with the real ladder's recorded structure
 * on it: warm-up kilometres, six rep-paced laps, four slow recoveries and the
 * cool-down.
 *
 * before = the runtime at the branch base (laps discarded, nothing to show)
 * after  = the working tree, closed and open
 *
 * It MEASURES what a screenshot cannot be trusted for: that no lap is labelled
 * a rep or a recovery, that the rep paces are actually legible, and that the
 * athlete's own logging control is still there and still first-class.
 *
 *   node tools/shots/recorded-laps-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const ROOT = process.env.VVV_ROOT || path.join(__dirname, '..', '..');
const { loadApp } = require(path.join(ROOT, 'test', 'harness.js'));
const { buildPlan } = require(path.join(ROOT, 'test', 'fixtures.js'));

const AFTER  = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const BEFORE = process.env.VVV_BEFORE;
const OUT = process.argv[2] || path.join(__dirname, 'out-recorded-laps');
const TODAY = new Date().toISOString().slice(0, 10);

/* The real recorded structure, no identity in it. Moving time per lap. */
const LAPS = [
  {km:1.0,sec:356,paceSec:356},{km:1.0,sec:327,paceSec:327},
  {km:0.5,sec:127,paceSec:254,elapsedSec:282},{km:1.0,sec:260,paceSec:260,elapsedSec:345},
  {km:0.4,sec:171,paceSec:428},{km:1.0,sec:254,paceSec:254},
  {km:0.5,sec:130,paceSec:260},{km:0.4,sec:175,paceSec:438},
  {km:1.0,sec:255,paceSec:255},{km:0.4,sec:182,paceSec:455,elapsedSec:198},
  {km:0.5,sec:128,paceSec:256},{km:0.2,sec:94,paceSec:470},
  {km:1.0,sec:327,paceSec:327},{km:1.0,sec:332,paceSec:332},{km:0.1,sec:42,paceSec:420}
];

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  /* A month back, so the interval day photographed is genuinely in the past
     and genuinely completable -- a future day cannot be logged at all, and a
     frame of an empty card would prove nothing. */
  const start = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  buildPlan(a, { distanceKey: '10k', volume: 50, weeks: 12, lthr: 172, maxHR: 188, startDate: start });
  const dd = a.state.days.filter(d => d.type === 'interval' && d.date < TODAY)[0];
  if (!dd) throw new Error('no past interval session to photograph');
  dd.completed = true;
  dd.actual = { km: dd.km, pace: '5:16', paceUnit: 'km', hr: 161, rpe: 7, feel: null, notes: '' };
  dd.actual.deviceLaps = LAPS.map(l => Object.assign({ hr: null }, l));
  dd.actual.deviceLapSource = 'strava';
  dd.stravaActivityId = '100000001';
  return { a, dd };
}
const { a: STATE, dd: DAY } = athlete();

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
  const box = el => { const b = el.getBoundingClientRect();
    return { y:Math.round(b.y + (window.scrollY||0)), h:Math.round(b.height) }; };
  const card = document.querySelector('.dlap-card');
  const rows = [...document.querySelectorAll('.dlap-row')];
  const body = document.body.innerText || '';
  return {
    hasCard: !!card,
    cardH: card ? box(card).h : null,
    open: card ? card.open : null,
    rows: rows.length,
    paces: rows.map(r => (r.querySelector('.dlap-pace')||{}).textContent || ''),
    labelsARep: /Rep \d|Recovery \d|>Warm-up<|>Cool-down</.test(card ? card.innerHTML : ''),
    // innerText, never innerHTML: the runtime's own source is inside a <script>
    // in this document and would match every string it contains.
    saysLimit: /not told which lap/.test(body),
    hasOwnEditor: !!document.querySelector('[data-action="toggle-splits"], .splits-summary'),
    clause: (() => { const el = [...document.querySelectorAll('*')]
        .filter(e => e.children.length === 0 && /judged across the whole run/.test(e.textContent))[0];
      return el ? el.textContent.trim().slice(0, 160) : null; })(),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = JSON.parse(JSON.stringify(STATE.state));
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const rows = [];
  const FRAMES = [];
  if (BEFORE) FRAMES.push({ tag: 'before', runtime: BEFORE, open: false });
  FRAMES.push({ tag: 'after-closed', runtime: AFTER, open: false });
  FRAMES.push({ tag: 'after-open',   runtime: AFTER, open: true });

  for (const f of FRAMES){
    const { server, url } = await serve(f.runtime);
    for (const width of [360, 390, 430]){
      for (const theme of ['light', 'dark']){
        const ctx = await browser.newContext({ viewport: { width, height: 900 },
          deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        await page.addInitScript(seed, { key: STATE.STORAGE_KEY,
          state: JSON.stringify(Object.assign({}, base, { view:'full', theme, themeExplicit:true })) });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        try { await page.evaluate(() => window.handleSetView && window.handleSetView('full')); } catch (e) {}
        await page.waitForTimeout(200);
        try { await page.evaluate((d) => {
          expandedWeeks[d.week] = true; dayExpandOverride[d.id] = true;
          if (typeof detailEditorOpen !== 'undefined') detailEditorOpen[d.id] = true;
          renderApp();
        }, { id: DAY.id, week: DAY.week }); }
        catch (e) { errors.push('open day: ' + e.message); }
        await page.waitForTimeout(300);
        try { await page.evaluate((id) => {
          const el = document.getElementById('day-' + id);
          if (!el) throw new Error('the day card did not render');
        }, DAY.id); } catch (e) { errors.push(e.message); }
        if (f.open){
          try { await page.evaluate(() => {
            const d = document.querySelector('.dlap-card'); if (d) d.open = true; }); } catch (e) {}
          await page.waitForTimeout(200);
        }
        try { await page.evaluate(() => {
          const el = document.querySelector('.dlap-card') || document.querySelector('.splits-block');
          if (el) el.scrollIntoView({ block: 'center' }); }); } catch (e) {}
        await page.waitForTimeout(150);
        const m = await page.evaluate(measure);
        if (!m.hasOwnEditor) errors.push("the athlete's own logging control vanished");
        const file = f.tag + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        rows.push({ file, tag: f.tag, width, theme, errors, m });
        console.log(file.padEnd(22) +
          ' lapCard=' + (m.hasCard ? m.cardH + 'px' : 'none') +
          ' rows=' + m.rows +
          ' labelsARep=' + m.labelsARep +
          ' saysLimit=' + m.saysLimit +
          ' ownEditor=' + m.hasOwnEditor +
          ' xoverflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        if (width === 390 && theme === 'light'){
          if (m.paces.length) console.log('      paces  ' + m.paces.join(' '));
          console.log('      clause ' + JSON.stringify(m.clause));
        }
        await page.close(); await ctx.close();
      }
    }
    server.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  const bad = rows.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1);
  console.log('\n' + rows.length + ' frames, ' + bad.length + ' with a problem');
  bad.forEach(b => console.log('  ' + b.file + ': ' + (b.errors.join(' | ') || 'layout')));
})();
