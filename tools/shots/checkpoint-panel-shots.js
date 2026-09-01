'use strict';
/* FITNESS CHECKPOINT PANEL — FULL PLAN, BEFORE AND AFTER.
 * ===========================================================================
 * The only thing this change is allowed to do is take the large standalone
 * Fitness Checkpoint / Active Goal panel out of the Full Plan chronology. So
 * the frames are shot at the checkpoint week itself, with that week open, in
 * both trees:
 *
 *   before  = the runtime at the branch base (panel present)
 *   after   = the working tree (panel removed)
 *
 * And it MEASURES what a screenshot cannot be trusted for: that the checkpoint
 * WEEK, its phase label and its session card all survive, that the A/B/C goal
 * surface is gone from Full Plan only, that no empty container is left behind,
 * and that the week's height fell by roughly the panel and nothing more.
 *
 *   node tools/shots/checkpoint-panel-shots.js [outDir]
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
const OUT = process.argv[2] || path.join(__dirname, 'out-checkpoint-panel');
const TODAY = new Date().toISOString().slice(0, 10);

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'full', volume: 55, weeks: 14, lthr: 172, maxHR: 188,
                 startDate: TODAY });
  return a;
}
const STATE = athlete();
const CHK = STATE.state.days.filter(d => d.type === 'checkpoint')[0];
if (!CHK) throw new Error('no checkpoint day in the fixture plan — nothing to photograph');

const WIDTHS = [360, 390, 430];
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

function measure(arg){
  const box = el => { const b = el.getBoundingClientRect();
    return { y:Math.round(b.y + (window.scrollY||0)), h:Math.round(b.height),
             bottom:Math.round(b.bottom + (window.scrollY||0)) }; };
  const week = document.getElementById('week-' + arg.week);
  const card = document.getElementById('day-' + arg.id);
  const panel = document.querySelector('.checkpoint');
  const body = document.body.innerHTML;
  return {
    inFull: !!document.querySelector('.weeks') || !!week,
    hasWeek: !!week,
    weekH: week ? box(week).h : null,
    weekLabel: week ? ((week.querySelector('.week-phase') ||
                        week.querySelector('.week-head') || {}).textContent || '').trim() : null,
    hasPanel: !!panel,
    panelH: panel ? box(panel).h : null,
    hasSession: !!card,
    sessionTitle: card ? ((card.querySelector('.day-title') || {}).textContent || '').trim() : null,
    sessionH: card ? box(card).h : null,
    goalBtns: document.querySelectorAll('.goal-toggle, .goal-opt').length,
    dataPointCopy: /is your data point/i.test(body),
    checkpointBanner: document.querySelectorAll('.checkpoint-banner').length,
    emptyDivs: [...document.querySelectorAll('.weeks div')]
                 .filter(d => !d.children.length && !d.textContent.trim()).length,
    weekIds: [...document.querySelectorAll('.week')].map(e => e.id).join(','),
    phaseDividers: [...document.querySelectorAll('.phase-divider')].map(e => e.textContent.trim()).join(' | '),
    weeksH: document.querySelector('.weeks') ? box(document.querySelector('.weeks')).h : null,
    docH: Math.round(document.documentElement.scrollHeight),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = JSON.parse(JSON.stringify(STATE.state));
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const rows = [];
  const TREES = [];
  if (BEFORE) TREES.push({ tag: 'before', runtime: BEFORE });
  TREES.push({ tag: 'after', runtime: AFTER });

  for (const tree of TREES){
    const { server, url } = await serve(tree.runtime);
    for (const width of WIDTHS){
      for (const theme of ['light', 'dark']){
        const ctx = await browser.newContext({ viewport: { width, height: 900 },
          deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        const blob = Object.assign({}, base, { view: 'full', theme, themeExplicit: true });
        await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        try { await page.evaluate(() => window.handleSetView && window.handleSetView('full')); } catch (e) {}
        await page.waitForTimeout(200);
        try {
          await page.evaluate((a) => {
            expandedWeeks[a.week] = true;
            dayExpandOverride[a.id] = true;
            renderApp();
          }, { week: CHK.week, id: CHK.id });
        } catch (e) { errors.push('open: ' + e.message); }
        await page.waitForTimeout(250);
        try { await page.evaluate((w) => {
          const el = document.getElementById('week-' + w);
          if (el) el.scrollIntoView({ block: 'start' });
        }, CHK.week); } catch (e) {}
        await page.waitForTimeout(150);
        const m = await page.evaluate(measure, { week: CHK.week, id: CHK.id });
        if (!m.hasWeek) errors.push('CHECKPOINT WEEK NOT RENDERED — this frame proves nothing');
        const file = tree.tag + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        rows.push({ file, tree: tree.tag, width, theme, errors, m });
        console.log(file.padEnd(20) +
          ' week=' + (m.hasWeek ? m.weekH + 'px' : '-') +
          ' panel=' + (m.hasPanel ? m.panelH + 'px' : 'none') +
          ' session=' + (m.hasSession ? m.sessionH + 'px' : 'MISSING') +
          ' goalBtns=' + m.goalBtns +
          ' banner=' + m.checkpointBanner +
          ' emptyDivs=' + m.emptyDivs +
          ' xoverflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        if (width === 390 && theme === 'light'){
          console.log('      weekLabel  ' + JSON.stringify(m.weekLabel));
          console.log('      session    ' + JSON.stringify(m.sessionTitle));
          console.log('      dataPoint  ' + m.dataPointCopy);
        }
        await page.close(); await ctx.close();
      }
    }
    server.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));

  console.log('\nWEEK HEIGHT DELTA (after - before), same width/theme:');
  rows.filter(r => r.tree === 'after').forEach(a => {
    const b = rows.filter(r => r.tree === 'before' && r.width === a.width && r.theme === a.theme)[0];
    if (!b) return;
    console.log('  ' + a.width + '/' + a.theme +
      '  week ' + b.m.weekH + ' -> ' + a.m.weekH + '  (' + (a.m.weekH - b.m.weekH) + 'px)' +
      '   panel was ' + b.m.panelH + 'px' +
      '   session ' + b.m.sessionH + ' -> ' + a.m.sessionH + 'px');
  });
  const bad = rows.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1);
  console.log('\n' + rows.length + ' frames, ' + bad.length + ' with a problem');
  bad.forEach(b => console.log('  ' + b.file + ': ' + (b.errors.join(' | ') || 'layout')));
})();
