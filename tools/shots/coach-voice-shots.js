'use strict';
/* COACH VOICE IN SETTINGS, PHOTOGRAPHED AT PHONE WIDTH.
 * ===========================================================================
 * The founder asked to see the finished control. Each frame selects a voice
 * through the app's own setter and re-renders through renderApp(), so what is
 * photographed is the product's render path rather than hand-built markup.
 *
 * It also MEASURES the two things a screenshot cannot show:
 *   - the selected circle is Cherry Lacquer, resolved from the live stylesheet
 *     rather than asserted from source, so a token that failed to apply is
 *     visible here;
 *   - every row is at least a 44px tap target.
 *
 *   node tools/shots/coach-voice-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-coach-voice');
const REAL = new Date();
const TODAY = new Date(REAL.getTime() - ((REAL.getUTCDay() + 6) % 7) * 86400000)
  .toISOString().slice(0, 10);

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190,
                 schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  return a;
}
const STATE = athlete();

const FRAMES = [
  { name: 'settings-coach-voice-default', setup: `delete state.coachVoice;` },
  { name: 'coach-voice-molly',            setup: `setCoachVoice('molly');` },
  { name: 'coach-voice-joanna',           setup: `setCoachVoice('joanna');` },
  { name: 'coach-voice-harry',            setup: `setCoachVoice('harry');` },
  { name: 'coach-voice-andrew',           setup: `setCoachVoice('andrew');` },
  /* A stored preference that no longer exists must land on Molly rather than
     drawing nothing selected. */
  { name: 'coach-voice-corrupt-pref',     setup: `state.coachVoice = 'zoe';` }
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
  const blobBase = JSON.parse(JSON.stringify(STATE.state));
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  for (const f of FRAMES){
    for (const theme of ['light', 'dark']){
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
          errors.push('console: ' + m.text());
      });
      const blob = Object.assign({}, blobBase, { view: 'settings', theme, themeExplicit: true });
      await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      try { await page.evaluate(() => window.handleSetView && window.handleSetView('settings')); } catch (e) {}
      await page.waitForTimeout(200);
      try { await page.evaluate(f.setup); } catch (e) { errors.push('setup: ' + e.message); }
      try { await page.evaluate(() => window.renderApp && window.renderApp()); } catch (e) {}
      await page.waitForTimeout(300);

      const m = await page.evaluate(() => {
        const row = document.getElementById('coach-voice-row');
        if (!row) return { missing: true };
        const inputs = [...row.querySelectorAll('input[type="radio"]')];
        const checked = inputs.filter(i => i.checked);
        const opts = [...row.querySelectorAll('.cv-opt')];
        const cs = checked[0] ? getComputedStyle(checked[0]) : null;
        return {
          missing: false,
          count: inputs.length,
          checkedCount: checked.length,
          selected: checked[0] ? checked[0].value : null,
          fill: cs ? cs.backgroundColor : null,
          radius: cs ? cs.borderRadius : null,
          previews: row.querySelectorAll('[data-action="preview-coach-voice"]').length,
          minRowH: Math.min(...opts.map(o => Math.round(o.getBoundingClientRect().height))),
          group: !!row.querySelector('[role="radiogroup"]'),
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth
        };
      });
      /* The row is the subject, so it is photographed on its own as well as in
         the whole Settings screen it has to sit inside. */
      const file = f.name + '-' + theme;
      await page.screenshot({ path: path.join(OUT, file + '-page.png'), fullPage: true });
      const el = await page.$('#coach-voice-row');
      if (el) await el.screenshot({ path: path.join(OUT, file + '.png') });

      results.push({ file, errors, m });
      console.log(file.padEnd(38) +
        (m.missing ? '  MISSING FROM SETTINGS'
          : ' voices=' + m.count + ' previews=' + m.previews +
            ' selected=' + String(m.selected).padEnd(7) +
            ' checked=' + m.checkedCount +
            ' fill=' + m.fill + ' radius=' + m.radius +
            ' minRow=' + m.minRowH + 'px' +
            ' group=' + (m.group ? 'y' : 'NO') +
            ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no')) +
        (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
      await page.close(); await ctx.close();
    }
  }
  await browser.close(); server.close();

  const bad = results.filter(r => r.errors.length || r.m.missing || r.m.count !== 4 ||
    r.m.checkedCount !== 1 || r.m.previews !== 4 || !r.m.group ||
    r.m.minRowH < 44 || r.m.scrollW > r.m.clientW + 1 ||
    r.m.radius.indexOf('50%') === -1);
  console.log('\n' + results.length * 2 + ' images -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.file).join(', ')
    : 'four voices, exactly one selected, four previews, circular cherry fill, 44px rows, no overflow, no errors');
})();
