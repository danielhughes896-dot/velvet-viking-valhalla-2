'use strict';
/* THE "HOW ARE YOU TODAY?" CHECK-IN — PHOTOGRAPHED AT PHONE WIDTHS.
 * ===========================================================================
 * The defect was reported on a narrow mobile Today screen: one tap and the
 * whole panel vanished. So the five states that matter are photographed at
 * 360 / 390 / 430 in both themes, through the app's own render path — the
 * answers are given by calling handleSetReadiness(), which is exactly what
 * the buttons call, and the finished panel is reopened by clicking the real
 * confirmation button rather than by setting a flag.
 *
 * It also MEASURES what a screenshot cannot be trusted to show: horizontal
 * overflow, the rendered size of every option chip (the tap target), the
 * computed colour of the selected chip (it must be the accent, not gold),
 * and whether the check-in collides with Hear Today / Ask Coach / the
 * bottom navigation.
 *
 *   node tools/shots/today-checkin-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-today-checkin');
/* THE BROWSER'S REAL TODAY, not a pinned Monday. The suite pins its clock;
   a real Chromium does not, so a fixture built around any other date lands
   its evidence and its next quality session on the wrong days, the decision
   never earns the check-in, and every frame photographs a Today screen with
   no check-in on it -- while still reporting success. That happened on the
   first run of this script. */
const TODAY = new Date().toISOString().slice(0, 10);

/* The check-in is EARNED — it appears only when the evidence already says
   something and a quality session is next. So the photographed athlete has to
   have earned it, which is the same corroborated-fatigue fixture the
   regression suite uses. Building it here rather than forcing the flag means
   the screenshots are of a real decision. */
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  const startDate = a.addDays(a.todayStr(), -10);
  const { days } = buildPlan(a, { lthr: 172, maxHR: 188, weeks: 12, startDate });
  const today = a.todayStr();
  const fill = (dd) => {
    const t = a.executionPaceTarget(dd), b = a.expectedRPEBand(dd), z = a.executionHRTarget(dd);
    dd.completed = true;
    dd.actual = { km: dd.km, pace: t ? a.secToPace((t.slow + t.fast) / 2) : null,
      hr: z && z.lo != null ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 20)) / 2) : null,
      rpe: b ? Math.round((b[0] + b[1]) / 2) : null, notes: '' };
  };
  days.filter(d => d.date <= today && d.type !== 'rest').forEach(fill);
  const last7 = days.filter(d => d.date <= today && d.date >= a.addDays(today, -6) && d.type !== 'rest');
  const ob = last7.find(d => ['interval','threshold','tempo'].includes(d.type)) || last7[0];
  const band = a.expectedRPEBand(ob), z1 = a.executionHRTarget(ob);
  ob.actual.rpe = band[1] + 2;
  ob.actual.hr = (z1.hi != null ? z1.hi : z1.lo + 20) + 15;
  const s2 = last7.find(d => d.id !== ob.id && d.type === 'easy') || last7[1];
  const z2 = a.executionHRTarget(s2);
  s2.actual.hr = (z2.hi != null ? z2.hi : z2.lo + 20) + 15;
  const nq = days.find(d => d.date > today && ['interval','threshold','tempo'].includes(d.type));
  days.filter(d => d.date > today && d.date < nq.date && d.type !== 'rest').forEach(fill);
  const dec = a.coachDecision();
  if (!dec || !dec.readinessEarned) throw new Error('fixture did not earn the check-in');
  return a;
}
const STATE = athlete();

const answer = (pairs) => pairs.map(([k, v]) =>
  `window.handleSetReadiness(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('');

const FRAMES = [
  { name: '1-untouched',  setup: '' },
  { name: '2-one-legs',   setup: answer([['legs','heavy']]) },
  { name: '3-two-sleep',  setup: answer([['legs','heavy'],['sleep','poor']]) },
  { name: '4-complete',   setup: answer([['legs','heavy'],['sleep','poor'],['health','good']]) },
  { name: '5-reopened',   setup: answer([['legs','heavy'],['sleep','poor'],['health','good']]),
    reopen: true },
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

/* What a screenshot cannot be trusted for. Chip geometry, the selected
   colour as the browser actually computes it, and whether the block overlaps
   anything else on the card. */
function measure(){
  /* DOCUMENT-relative, not viewport-relative. The screenshots are fullPage,
     so a viewport box crops the wrong band of a scrolled page -- which is
     exactly what happened the first time these were composed. */
  const r = (el) => { const b = el.getBoundingClientRect();
    const sx = window.scrollX || 0, sy = window.scrollY || 0;
    return { x:Math.round(b.x + sx), y:Math.round(b.y + sy),
             w:Math.round(b.width), h:Math.round(b.height),
             bottom:Math.round(b.bottom + sy) }; };
  const chips = [...document.querySelectorAll('.readiness-btn')];
  const on = chips.filter(c => c.classList.contains('on'));
  const panel = document.querySelector('.readiness') || document.querySelector('.readiness-done');
  const overlaps = (a, b) => {
    if (!a || !b) return false;
    const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
    return !(x.bottom <= y.top + 0.5 || y.bottom <= x.top + 0.5 ||
             x.right <= y.left + 0.5 || y.right <= x.left + 0.5);
  };
  const nav = document.querySelector('.bottom-nav, .bn-item') &&
              (document.querySelector('.bottom-nav') || document.querySelector('.bn-item').parentElement);
  const hear = document.querySelector('[data-action="voice-listen"],[data-action="voice-stop"]');
  const ask  = document.querySelector('[data-action="voice-ask-open"]');
  return {
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    pageH: document.documentElement.scrollHeight,
    chips: chips.length,
    selected: on.length,
    minChip: chips.length ? Math.min(...chips.map(c => Math.round(c.getBoundingClientRect().height))) : null,
    minChipW: chips.length ? Math.min(...chips.map(c => Math.round(c.getBoundingClientRect().width))) : null,
    selectedBg: on.length ? getComputedStyle(on[0]).backgroundColor : null,
    selectedFg: on.length ? getComputedStyle(on[0]).color : null,
    idleBg: chips.length ? getComputedStyle(chips.find(c => !c.classList.contains('on')) || chips[0]).backgroundColor : null,
    panelH: panel ? r(panel).h : null,
    panelBox: panel ? r(panel) : null,
    done: !!document.querySelector('.readiness-done-btn'),
    doneText: (document.querySelector('.readiness-done-line') || {}).textContent || null,
    reopenable: !!document.querySelector('[data-action="readiness-edit"]'),
    /* .readiness-head is text-transform:uppercase, and innerText returns the
       RENDERED text, so this has to be case-insensitive or it reads false on
       a panel that is plainly asking. */
    asking: /how are you today\?/i.test(document.body.innerText || ''),
    hasHear: !!hear, hasAsk: !!ask, hasNav: !!nav,
    collideHear: overlaps(panel, hear), collideAsk: overlaps(panel, ask),
    collideNav: overlaps(panel, nav),
    // anything wider than its own row is a wrap failure, not a wrap
    rowOverflow: [...document.querySelectorAll('.readiness-opts')]
      .filter(o => o.scrollWidth > o.clientWidth + 1).length,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const blobBase = JSON.parse(JSON.stringify(STATE.state));
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
        const blob = Object.assign({}, blobBase, { view: 'today', theme, themeExplicit: true });
        await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        try { await page.evaluate(() => window.voiceSetAvailable && window.voiceSetAvailable(true)); } catch (e) {}
        try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), 'today'); } catch (e) {}
        await page.waitForTimeout(200);
        if (f.setup){
          try { await page.evaluate(f.setup); } catch (e) { errors.push('setup: ' + e.message); }
          await page.waitForTimeout(200);
        }
        if (f.reopen){
          // clicked, not flag-set: the confirmation must genuinely be tappable
          try {
            await page.click('[data-action="readiness-edit"]');
          } catch (e) { errors.push('reopen: ' + e.message); }
          await page.waitForTimeout(250);
        }
        try {
          await page.evaluate(() => {
            const el = document.querySelector('.readiness, .readiness-done');
            if (el) el.scrollIntoView({ block: 'center' });
          });
        } catch (e) {}
        await page.waitForTimeout(150);
        const m = await page.evaluate(measure);
        /* A screenshot of a page where the block is simply absent looks like a
           clean pass. It is not one, so it is an error here. */
        if (!m.panelH) errors.push('NO CHECK-IN RENDERED — this frame proves nothing');
        const file = f.name + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        rows.push({ file, errors, m });
        console.log(file.padEnd(26) +
          ' chips=' + String(m.chips).padStart(2) +
          ' sel=' + m.selected +
          ' minTap=' + String(m.minChip).padStart(3) + 'px' +
          ' panelH=' + String(m.panelH).padStart(4) +
          ' asking=' + (m.asking ? 'y' : '-') +
          ' done=' + (m.done ? 'y' : '-') +
          ' reopen=' + (m.reopenable ? 'y' : '-') +
          ' xoverflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          ' rowOverflow=' + m.rowOverflow +
          ' collide=' + [m.collideHear && 'hear', m.collideAsk && 'ask', m.collideNav && 'nav']
                          .filter(Boolean).join(',') +
          (m.selectedBg ? ' selBg=' + m.selectedBg : '') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        await page.close(); await ctx.close();
      }
    }
  }
  await browser.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  const bad = rows.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1 ||
                               r.m.rowOverflow || r.m.collideHear || r.m.collideAsk || r.m.collideNav);
  console.log('\n' + rows.length + ' frames, ' + bad.length + ' with a problem');
  bad.forEach(b => console.log('  ' + b.file + ': ' + (b.errors.join(' | ') || 'layout')));
})();
