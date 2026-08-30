'use strict';
/* SUPPORTING-WORK COMPLETION — THE FOUR STATES, AT PHONE WIDTHS.
 * ===========================================================================
 * The defect was reported in Full Plan: a supporting-work prescription weeks
 * away offered an actionable "Mark done" while the running session on the same
 * card refused to be ticked off early. So the states photographed are the ones
 * that rule produces, and they are produced by MOVING THE CLOCK over one
 * unmodified plan -- never by regenerating it, and never by forcing a flag.
 *
 * It also MEASURES what a screenshot cannot be trusted to show: that the
 * future control is genuinely disabled and genuinely unchecked, the rendered
 * geometry of the supporting ring against the running session's own completion
 * circle (they must line up as one language, not two), the tap target, and
 * horizontal overflow.
 *
 *   node tools/shots/support-completion-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-support-completion');

/* The browser has a real clock, so the plan is anchored to it: the fixture is
   built as though the athlete started today, which puts week 1 around now and
   makes "future" and "today" real rather than pinned fiction. */
const TODAY = new Date().toISOString().slice(0, 10);

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188,
                 startDate: TODAY });
  a.state.setup.supportWork = 'on';
  // The first day the engine actually puts supporting work on, whenever that is.
  const weeks = [...new Set(a.state.days.map(d => d.week))].filter(Boolean).sort((x, y) => x - y);
  let item = null;
  for (const w of weeks){ const wk = a.supportForWeek(w) || []; if (wk.length){ item = wk[0]; break; } }
  if (!item) throw new Error('fixture produced no supporting work');
  return { a, item };
}
const { a: STATE, item: ITEM } = athlete();

/* Each frame is the SAME plan seen from a different day. `shiftDays` moves
   every date in the plan so the target day lands where the frame needs it,
   which is the only honest way to photograph "future" and "today" in a
   browser whose clock cannot be pinned. */
const shift = (n) => `
  (function(){
    var days = state.days;
    for (var i=0;i<days.length;i++){
      days[i].date = addDays(days[i].date, ${n});
      days[i].id   = days[i].date;
    }
  })();`;

const TARGET = ITEM.date;
const offsetToToday = (d1, d2) =>
  Math.round((new Date(d2) - new Date(d1)) / 86400000);
const TO_TODAY = offsetToToday(TARGET, TODAY);          // makes the target day = today
const TO_PAST  = TO_TODAY - 3;                          // three days ago

/* `shift` puts the target day where the frame needs it. `completeAt` is a
   SEPARATE earlier shift used only to log the work, because completion is now
   refused on any day that is not today -- which is the whole point of the
   change, so the past frame has to be produced honestly: become today, tick
   it, then let the day recede into the past. */
const FRAMES = [
  { name: '1-future-collapsed', shift: 0,        open: false },
  { name: '2-future-expanded',  shift: 0,        open: true  },
  { name: '3-today-available',  shift: TO_TODAY, open: true  },
  { name: '4-today-completed',  shift: TO_TODAY, open: true, completeAt: TO_TODAY },
  { name: '5-past-completed',   shift: TO_PAST,  open: true, completeAt: TO_TODAY },
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

function measure(targetDate){
  const box = el => { const b = el.getBoundingClientRect();
    return { x:Math.round(b.x + (window.scrollX||0)), y:Math.round(b.y + (window.scrollY||0)),
             w:Math.round(b.width), h:Math.round(b.height),
             bottom:Math.round(b.bottom + (window.scrollY||0)) }; };
  /* SCOPED TO THE DAY UNDER TEST. Full Plan renders every week, so the first
     .support-block on the page belongs to whichever day the engine chose
     first -- not necessarily this frame's. Measuring that one would report a
     different day's control and call it a pass. */
  const card = document.getElementById('day-' + targetDate);
  if (!card) return { hasBlock:false, missingCard:true, scrollW:0, clientW:1 };
  const block = card.querySelector('.support-block, .support-line.support-done');
  const supportLabel = card.querySelector('.support-check');
  const supportInput = supportLabel ? supportLabel.querySelector('input') : null;
  // the running session's own completion circle, on the same card
  const runLabel = card.querySelector('.day-check:not(.support-check)');
  const runInput = runLabel ? runLabel.querySelector('input') : null;
  const cs = supportInput ? getComputedStyle(supportInput) : null;
  const cr = runInput ? getComputedStyle(runInput) : null;
  return {
    hasBlock: !!block,
    blockBox: block ? box(block) : null,
    hasControl: !!supportInput,
    disabled: supportInput ? supportInput.disabled : null,
    checked: supportInput ? supportInput.checked : null,
    locked: supportLabel ? supportLabel.classList.contains('locked') : null,
    labelBox: supportLabel ? box(supportLabel) : null,
    ringW: supportInput ? Math.round(supportInput.getBoundingClientRect().width) : null,
    ringH: supportInput ? Math.round(supportInput.getBoundingClientRect().height) : null,
    runRingW: runInput ? Math.round(runInput.getBoundingClientRect().width) : null,
    ringRadius: cs ? cs.borderRadius : null,
    runRingRadius: cr ? cr.borderRadius : null,
    ringBg: cs ? cs.backgroundColor : null,
    runRingBg: cr ? cr.backgroundColor : null,
    ringBorder: cs ? cs.borderColor : null,
    tapH: supportLabel ? Math.round(supportLabel.getBoundingClientRect().height) : null,
    hasMarkDoneButton: !!document.querySelector('button[data-action="support-done"]'),
    detailsPresent: !!card.querySelector('.support-detail'),
    detailsOpen: !!(card.querySelector('.support-detail') || {}).open,
    stepsVisible: card.querySelectorAll('.support-step').length,
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
        page.on('console', m => {
          if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
            errors.push('console: ' + m.text());
        });
        /* FULL PLAN IS view 'full' -- renderMainContent() routes on exactly
           that string. Earlier attempts seeded 'plan' and then 'detailed';
           both left the app on Today, where the only day card in the DOM is
           today's. The future and past frames were therefore photographing a
           screen with no supporting work on it, and only the frames whose
           target happened to BE today rendered anything at all. Seeding the
           view is also not enough on its own -- boot normalises it -- so
           handleSetView() is called after load as well. */
        const blob = Object.assign({}, base, { view: 'full', theme, themeExplicit: true });
        await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), 'full'); } catch (e) {}
        await page.waitForTimeout(200);
        const dateAfter = n => new Date(new Date(TARGET).getTime() + n * 86400000)
                                 .toISOString().slice(0, 10);
        // 1. become the day the work is logged on, and log it
        if (f.completeAt != null){
          try { await page.evaluate(shift(f.completeAt)); } catch (e) { errors.push('shift1: ' + e.message); }
          try {
            await page.evaluate((d) => {
              const dd = state.days.filter(x => x.date === d)[0];
              if (!dd) throw new Error('target day missing');
              window.handleSupportDone(dd.id);
            }, dateAfter(f.completeAt));
          } catch (e) { errors.push('complete: ' + e.message); }
        }
        // 2. move to the day this frame is actually about
        const remaining = f.shift - (f.completeAt != null ? f.completeAt : 0);
        if (remaining) { try { await page.evaluate(shift(remaining)); } catch (e) { errors.push('shift2: ' + e.message); } }
        /* Open the week and the day. expandedWeeks is ASSIGNED, never toggled:
           handleToggleWeek() flips, so setting the flag and then calling it
           shut the week again and the card never rendered at all. */
        try {
          await page.evaluate((d) => {
            const dd = state.days.filter(x => x.date === d)[0];
            if (!dd) throw new Error('target day missing after shift');
            expandedWeeks[dd.week] = true;
            dayExpandOverride[dd.id] = true;
            window.renderApp && window.renderApp();
          }, dateAfter(f.shift));
        } catch (e) { errors.push('open: ' + e.message); }
        await page.waitForTimeout(250);
        if (f.open){
          try { await page.evaluate((d) => {
            const el = document.getElementById('day-' + d);
            const det = el && el.querySelector('.support-detail'); if (det) det.open = true;
          }, dateAfter(f.shift)); } catch (e) {}
          await page.waitForTimeout(200);
        }
        try { await page.evaluate((d) => {
          const el = document.getElementById('day-' + d);
          const t = el && el.querySelector('.support-block, .support-line.support-done');
          if (t) t.scrollIntoView({ block: 'center' });
        }, dateAfter(f.shift)); } catch (e) {}
        await page.waitForTimeout(150);
        const m = await page.evaluate(measure, dateAfter(f.shift));
        if (!m.hasBlock) errors.push('NO SUPPORTING WORK RENDERED — this frame proves nothing');
        const file = f.name + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        rows.push({ file, errors, m });
        console.log(file.padEnd(28) +
          ' ctrl=' + (m.hasControl ? 'y' : '-') +
          ' disabled=' + m.disabled + ' checked=' + m.checked + ' locked=' + m.locked +
          ' ring=' + m.ringW + '/' + m.runRingW +
          ' tap=' + m.tapH + 'px' +
          ' steps=' + m.stepsVisible +
          ' btn=' + (m.hasMarkDoneButton ? 'STILL THERE' : 'gone') +
          ' xoverflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        await page.close(); await ctx.close();
      }
    }
  }
  await browser.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  const bad = rows.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1 ||
                               r.m.hasMarkDoneButton ||
                               (r.m.ringW && r.m.runRingW && r.m.ringW !== r.m.runRingW));
  console.log('\n' + rows.length + ' frames, ' + bad.length + ' with a problem');
  bad.forEach(b => console.log('  ' + b.file + ': ' + (b.errors.join(' | ') || 'geometry/button')));
})();
