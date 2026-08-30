'use strict';
/* RACE STRATEGY — THE RACE DAY BLOCK, BEFORE AND AFTER, AT PHONE WIDTHS.
 * ===========================================================================
 * Race Day is the card this feature is least allowed to damage, so what is
 * photographed is the whole race event: the gold head, the new strategy
 * picker, and the card underneath with its execution blocks open.
 *
 * It also MEASURES what a screenshot cannot be trusted for: that the selected
 * chip is Cherry Lacquer and not gold, that the block spans are athlete-facing
 * numbers in the athlete's own unit, that the displayed paces still add up to
 * the athlete's declared goal, and that the card has not been made materially
 * harder to scan.
 *
 *   node tools/shots/race-strategy-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const ROOT = process.env.VVV_ROOT || path.join(__dirname, '..', '..');
const { loadApp } = require(path.join(ROOT, 'test', 'harness.js'));
const { buildPlan } = require(path.join(ROOT, 'test', 'fixtures.js'));

const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-race-strategy');
const TODAY = new Date().toISOString().slice(0, 10);

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'full', volume: 55, weeks: 14, lthr: 172, maxHR: 188,
                 startDate: TODAY });
  return a;
}
const STATE = athlete();
const RACE = STATE.state.days.filter(d => d.type === 'race')[0];

/* The strategy is a stored preference, so each frame is produced by SETTING IT
   and re-rendering -- never by hand-building markup. A tree without the feature
   simply ignores the key, which is what makes the before/after honest. */
const FRAMES = [
  { name: '1-even',        strategy: 'even' },
  { name: '2-negative',    strategy: 'negative' },
  { name: '3-custom',      strategy: 'custom' },
  { name: '4-even-closed', strategy: 'even', closed: true },
];
const WIDTHS = [360, 390, 430];

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

function measure(raceId){
  const box = el => { const b = el.getBoundingClientRect();
    return { y:Math.round(b.y + (window.scrollY||0)), h:Math.round(b.height),
             bottom:Math.round(b.bottom + (window.scrollY||0)) }; };
  const ev = document.querySelector('.race-event');
  const picker = document.querySelector('.race-strategy');
  const chipOn = document.querySelector('.rs-chip.on');
  const card = document.getElementById('day-' + raceId);
  const phases = [...document.querySelectorAll('.strat-phase')];
  const divider = document.querySelector('.race-divider');
  const region = divider || ev;
  return {
    hasEvent: !!ev,
    hasPicker: !!picker,
    pickerH: picker ? box(picker).h : null,
    eventBox: region ? box(region) : null,
    eventBottom: ev ? box(ev).bottom : null,
    cardH: card ? box(card).h : null,
    chipOnBg: chipOn ? getComputedStyle(chipOn).backgroundColor : null,
    chipOnLabel: chipOn ? chipOn.textContent.replace(/Recommended/, '').trim() : null,
    recCount: document.querySelectorAll('.rs-rec').length,
    customVisible: !!document.querySelector('.rs-custom'),
    finish: (document.querySelector('.rs-finish') || {}).textContent || null,
    phases: phases.length,
    spans: phases.map(p => (p.querySelector('.strat-phase-span') || {}).textContent || ''),
    targets: phases.map(p => (p.querySelector('.strat-phase-target') || {}).textContent || ''),
    labels: phases.map(p => (p.querySelector('.strat-phase-label') || {}).textContent || ''),
    desc: (card ? (card.querySelector('.day-desc') || {}) : {}).textContent || null,
    cue: (card ? (card.querySelector('.coach-cue') || {}) : {}).textContent || null,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = JSON.parse(JSON.stringify(STATE.state));
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const rows = [];
  for (const f of FRAMES){
    for (const width of WIDTHS){
      for (const theme of ['light', 'dark']){
        const ctx = await browser.newContext({ viewport: { width, height: 900 },
          deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        const blob = Object.assign({}, base, { view: 'full', theme, themeExplicit: true });
        if (f.strategy) blob.setup = Object.assign({}, blob.setup, { raceStrategy: f.strategy });
        await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        try { await page.evaluate(() => window.handleSetView && window.handleSetView('full')); } catch (e) {}
        await page.waitForTimeout(200);
        try {
          await page.evaluate((id) => {
            const dd = state.days.filter(d => d.id === id)[0];
            expandedWeeks[dd.week] = true;
            dayExpandOverride[dd.id] = true;
            renderApp();
          }, RACE.id);
        } catch (e) { errors.push('open: ' + e.message); }
        await page.waitForTimeout(250);
        if (!f.closed){
          try { await page.evaluate((id) => {
            const el = document.getElementById('day-' + id);
            const d = el && el.querySelector('details.how-card'); if (d) d.open = true;
          }, RACE.id); } catch (e) {}
          await page.waitForTimeout(200);
        }
        try { await page.evaluate(() => {
          const el = document.querySelector('.race-divider') || document.querySelector('.race-event');
          if (el) el.scrollIntoView({ block: 'start' });
        }); } catch (e) {}
        await page.waitForTimeout(150);
        const m = await page.evaluate(measure, RACE.id);
        if (!m.hasEvent) errors.push('NO RACE EVENT RENDERED — this frame proves nothing');
        const file = f.name + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        rows.push({ file, errors, m });
        console.log(file.padEnd(24) +
          ' picker=' + (m.hasPicker ? m.pickerH + 'px' : '-') +
          ' sel=' + JSON.stringify(m.chipOnLabel) +
          ' rec=' + m.recCount +
          ' custom=' + (m.customVisible ? 'y' : '-') +
          ' finish=' + JSON.stringify((m.finish||'').replace('Planned finish','')) +
          ' phases=' + m.phases +
          ' xoverflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          (m.chipOnBg ? ' chipBg=' + m.chipOnBg : '') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        if (width === 390 && theme === 'light'){
          console.log('      spans   ' + m.spans.join(' | '));
          console.log('      targets ' + m.targets.join(' | '));
          console.log('      desc    ' + (m.desc||'').slice(0, 110));
          console.log('      cue     ' + (m.cue||'').slice(0, 110));
        }
        await page.close(); await ctx.close();
      }
    }
  }
  await browser.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  const bad = rows.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1);
  console.log('\n' + rows.length + ' frames, ' + bad.length + ' with a problem');
  bad.forEach(b => console.log('  ' + b.file + ': ' + (b.errors.join(' | ') || 'layout')));
})();
