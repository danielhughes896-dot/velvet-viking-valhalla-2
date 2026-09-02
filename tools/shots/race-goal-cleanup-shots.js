'use strict';
/* RACE GOAL APP CLEANUP -- THE THREE CHANGES, IN THE RUNNING APP.
 * ===========================================================================
 *   A  builder stage 05 for a RACE build   -- no weekly-volume question
 *   A2 builder stage 05 for an AEROBIC BASE build -- the question is still there
 *   B  the experience choices              -- Developing / Established / Advanced
 *   C  Today, checkpoint recommendation pending
 *   D  Today, after Accept
 *   E  Today, after Decline
 *
 * Each frame is MEASURED as well as photographed, because a screenshot cannot
 * prove that a hidden field is also not validated, or that a card rendered
 * SYSTEM's own recommendation rather than a hardcoded letter.
 *
 *   node tools/shots/race-goal-cleanup-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const ROOT = process.env.VVV_ROOT || path.join(__dirname, '..', '..');
const { loadApp } = require(path.join(ROOT, 'test', 'harness.js'));
const { buildPlan } = require(path.join(ROOT, 'test', 'fixtures.js'));

const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-race-goal-cleanup');
const TODAY = new Date().toISOString().slice(0, 10);

/* An athlete mid race block with TWO qualified performances, which is what
   SYSTEM requires before it will project at all. */
function raceAthlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 14, lthr: 172, maxHR: 188,
                 startDate: a.addDays(TODAY, -49) });
  const su = a.state.setup;
  su.purpose = 'race';
  const bp = a.DISTANCE_PROFILES[su.benchmark.distanceKey], pr = a.DISTANCE_PROFILES['half'];
  const vb = a.vdotFromPerformance(bp.raceKm * 1000, su.benchmark.timeSec);
  const m = a.BUILDER_SPEC.goals.ambitionMult;
  su.goals = {};
  a.GOAL_KEYS.forEach(k => { su.goals[k] = { timeSec: Math.round(a.equivalentTimeSec(vb * m[k], pr.raceKm * 1000)) }; });
  su.activeGoal = 'B';
  const past = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest');
  const early = past[3];
  early.type = 'checkpoint'; early.completed = true;
  early.actual = { km: early.km || 5, pace: '4:40', hr: null, rpe: null, notes: '' };
  a.coachPersistReview(early);
  const chk = a.state.days.filter(d => d.type === 'checkpoint' && d.date !== early.date)[0];
  if (chk){ chk.completed = true;
    chk.actual = { km: chk.km, pace: '4:20', hr: null, rpe: null, notes: '' };
    a.coachPersistReview(chk); }
  return a;
}
const STATE = raceAthlete();
const ASMT = STATE.checkpointInterventionState();
if (!ASMT) throw new Error('no checkpoint intervention in the fixture — the frames would prove nothing');
console.log('SYSTEM verdict: ' + ASMT.assessment.verdict + ', recommends ' + ASMT.assessment.recommend +
            ', active ' + ASMT.assessment.activeGoal);

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

const FRAMES = [
  { name: 'A-builder-race',  kind: 'builder', purpose: 'race' },
  { name: 'A2-builder-base', kind: 'builder', purpose: 'base' },
  { name: 'C-today-pending', kind: 'today',   act: null },
  { name: 'D-today-accept',  kind: 'today',   act: 'accept' },
  { name: 'E-today-decline', kind: 'today',   act: 'decline' }
];

async function openBuilder(page, purpose){
  await page.evaluate((p) => {
    openSetupModal();
    var sel = document.getElementById('su-purpose');
    if (sel){ sel.value = p; bldApplyPurpose(); }
    // walk to stage 05 (YOU), the screen that carried the question
    for (var i = 0; i < 4; i++) handleBldNext();
  }, purpose);
}

function measureBuilder(){
  const vol = document.getElementById('f-volume');
  const panel = document.querySelector('.bld-panel[data-stage="4"]');
  const visible = el => !!el && !el.hidden && el.offsetParent !== null;
  const txt = (panel && panel.innerText) || '';
  return {
    stageVisible: visible(panel),
    volumeAsked: visible(vol),
    mentionsVolume: /weekly volume|km \/ week|mi \/ week|weekly mileage/i.test(txt),
    experienceLabels: [...document.querySelectorAll('#su-experience button')].map(b => b.textContent.trim()),
    experienceHint: (document.getElementById('su-experience-hint') || {}).textContent || '',
    panelText: txt.replace(/\s+/g, ' ').trim().slice(0, 220),
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
  };
}
function measureToday(){
  const card = document.querySelector('.cp-card');
  return {
    hasCard: !!card,
    resolved: !!document.querySelector('.cp-done'),
    head: card ? (card.querySelector('.coach-next-title') || {}).textContent : null,
    why: card ? ((card.querySelector('.cp-why') || {}).textContent || '') : '',
    opts: [...document.querySelectorAll('.cp-opt')].map(o => o.innerText.replace(/\s+/g, ' ').trim()),
    recMarked: [...document.querySelectorAll('.cp-opt.is-rec')].length,
    actions: [...document.querySelectorAll('.cp-card .yr-choices button')].map(b => b.textContent.trim()),
    leaksInternals: /vdot|VDOT|_supported|preparation_short|projection/.test(card ? card.innerHTML : ''),
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = JSON.parse(JSON.stringify(STATE.state));
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const rows = [];
  for (const f of FRAMES){
    for (const width of [360, 390, 430]){
      for (const theme of ['light', 'dark']){
        const ctx = await browser.newContext({ viewport: { width, height: 900 },
          deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        await page.addInitScript(seed, { key: STATE.STORAGE_KEY,
          state: JSON.stringify(Object.assign({}, base, { view: 'today', theme, themeExplicit: true })) });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(750);
        let m;
        if (f.kind === 'builder'){
          try { await openBuilder(page, f.purpose); } catch (e) { errors.push('builder: ' + e.message); }
          await page.waitForTimeout(350);
          m = await page.evaluate(measureBuilder);
          if (!m.stageVisible) errors.push('stage 05 did not render — this frame proves nothing');
        } else {
          if (f.act){
            try { await page.evaluate((act) => {
              if (act === 'accept') handleCheckpointAccept(null); else handleCheckpointDecline();
            }, f.act); } catch (e) { errors.push('act: ' + e.message); }
            await page.waitForTimeout(300);
          }
          m = await page.evaluate(measureToday);
          if (!m.hasCard) errors.push('no checkpoint card rendered — this frame proves nothing');
          try { await page.evaluate(() => {
            const el = document.querySelector('.cp-card'); if (el) el.scrollIntoView({ block:'center' }); }); } catch(e){}
          await page.waitForTimeout(150);
        }
        const file = f.name + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        rows.push({ file, frame: f.name, width, theme, errors, m });
        console.log(file.padEnd(26) +
          (f.kind === 'builder'
            ? ' volumeAsked=' + m.volumeAsked + ' mentionsVolume=' + m.mentionsVolume +
              ' exp=' + JSON.stringify(m.experienceLabels)
            : ' card=' + m.hasCard + ' resolved=' + m.resolved + ' rec=' + m.recMarked +
              ' leaks=' + m.leaksInternals + ' actions=' + JSON.stringify(m.actions)) +
          ' xoverflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        if (width === 390 && theme === 'light'){
          if (f.kind === 'builder'){ console.log('      hint  ' + m.experienceHint);
                                     console.log('      panel ' + m.panelText); }
          else { console.log('      why   ' + m.why);
                 m.opts.forEach(o => console.log('      opt   ' + o)); }
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
