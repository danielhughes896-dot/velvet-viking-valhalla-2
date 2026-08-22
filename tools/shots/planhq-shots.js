'use strict';
/* Visual proof for the whole of Plan HQ.
   ===========================================================================

   Captures, at Pixel width in both themes:
     planhq.<theme>            the whole screen, so the rhythm is judgeable
     reading.<theme>           THE READING's destination cards
     record.<theme>            THE RECORD's destination cards
     outlook.<theme>           the measured-range / goal-marker line
     trio.<theme>              the bottom action trio
     panel.<key>.<theme>       all eleven panels, opened over Plan HQ

   And MEASURES the claims that are easy to assert and hard to see:
     - every card on the screen is one of two heights, not eleven;
     - every panel has exactly one full-width violet primary and two exits;
     - no panel carries a build-stage rail;
     - closing any panel returns the page to the offset it was opened from;
     - the outlook band and goal marker sit where the times say they should.

   Run:  node tools/shots/planhq-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'planhq');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
               '.json':'application/json' };
const PANELS = ['readiness', 'recovery', 'evolution', 'patterns', 'adaptation',
                'fitness', 'benchmark', 'zones', 'progress',
                'newblock', 'checkpoint'];

function serve(){
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const file = url === '/' ? 'protected/velvet-viking-valhalla.html' : url.replace(/^\//, '');
      const abs = path.join(ROOT, file);
      if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()){
        res.writeHead(404); res.end('nope'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
      res.end(fs.readFileSync(abs));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

/* A half-marathon block a third of the way in, with the sessions behind the
   athlete logged and scored, and the mid-block checkpoint run and recorded --
   an empty plan hides every value these cards exist to state. */
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
  state.healthConsent = { granted:true, version: HEALTH_CONSENT_VERSION,
                          at: new Date().toISOString() };
  const today = todayStr();
  state.days.forEach(function(dd){
    if (dd.type === 'rest' || dd.date >= today) return;
    const tgt = getTargetPaceRangeSecPerKm ? getTargetPaceRangeSecPerKm(dd) : null;
    const mid = tgt && tgt.fast != null ? Math.round((tgt.fast + tgt.slow) / 2) : 320;
    dd.completed = true;
    dd.actual = { km: dd.km, pace: secToPace(mid), hr: 148, rpe: 5, feel: 'good', notes: '' };
    // The same call logging a session makes, so a checkpoint already run shows
    // up as a measurement rather than as an unlogged one.
    if (dd.type === 'race' || dd.type === 'checkpoint') recordMeasuredPerformance(dd);
  });
  state.theme = theme; state.themeExplicit = true; applyThemeToDocument();
  state.view = 'planhq';
  renderApp();
}

async function clipOf(page, sel, padTop, padBottom){
  return page.evaluate(({ sel, padTop, padBottom }) => {
    const els = Array.from(document.querySelectorAll(sel));
    if (!els.length) return null;
    const first = els[0].getBoundingClientRect();
    const last = els[els.length - 1].getBoundingClientRect();
    return { x: 0, y: first.top + window.scrollY - padTop, width: 390,
             height: (last.bottom - first.top) + padTop + padBottom };
  }, { sel, padTop, padBottom });
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
                                           deviceScaleFactor: 3 });
    await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });
    await page.evaluate(seed, theme);
    await page.waitForTimeout(400);

    await page.screenshot({ path: path.join(OUT, 'planhq.' + theme + '.png'), fullPage: true });

    // --- the cards, measured ------------------------------------------------
    const geo = await page.evaluate(() => Array.from(document.querySelectorAll('.rec-card')).map(c => {
      const v = c.querySelector('.rec-val, .read-val');
      return {
        kind: c.getAttribute('data-action') === 'open-record' ? 'record' : 'reading',
        subject: c.querySelector('.rec-subject').textContent,
        value: v ? v.textContent.trim() : '(none)',
        h: Math.round(c.getBoundingClientRect().height),
        dot: !!c.querySelector('.read-dot'),
        colour: v ? getComputedStyle(v).color : '',
      };
    }));
    console.log('\n' + theme.toUpperCase() + ' — ' + geo.length + ' cards');
    geo.forEach(g => console.log('  ' + g.kind.padEnd(8) + g.subject.padEnd(22) +
      String(g.h).padStart(4) + 'px  ' + (g.dot ? '•' : ' ') + ' ' + g.value.slice(0, 34)));
    if (geo.filter(g => g.kind === 'record').length !== 4)
      problems.push(theme + ': expected 4 Record cards');
    if (geo.filter(g => g.kind === 'reading').length !== 5)
      problems.push(theme + ': expected 5 Reading cards');
    // A Record value is a fact: never a dot, never a status hue.
    geo.filter(g => g.kind === 'record' && g.dot)
       .forEach(g => problems.push(theme + ': Record card "' + g.subject + '" grew a status dot'));

    // --- the outlook, measured ---------------------------------------------
    const ol = await page.evaluate(() => {
      const t = document.querySelector('.outlook-track');
      if (!t) return { present:false, text:(document.querySelector('.outlook')||{}).textContent };
      const tr = t.getBoundingClientRect();
      const b = t.querySelector('.outlook-band').getBoundingClientRect();
      const g = t.querySelector('.outlook-goal');
      return { present:true,
        bandPct: [((b.left-tr.left)/tr.width*100).toFixed(1), ((b.right-tr.left)/tr.width*100).toFixed(1)],
        goalPct: g ? ((g.getBoundingClientRect().left-tr.left)/tr.width*100).toFixed(1) : null,
        bandFill: getComputedStyle(t.querySelector('.outlook-band')).backgroundImage.slice(0, 58),
        goalFill: g ? getComputedStyle(g).backgroundColor : null,
        legend: Array.from(document.querySelectorAll('.ol-key')).map(k => k.textContent.trim()),
        note: (document.querySelector('.outlook .field-hint')||{}).textContent };
    });
    if (!ol.present){
      console.log('  outlook: no band — ' + String(ol.text).slice(0, 90));
      problems.push(theme + ': the outlook drew no band on a block with a measured checkpoint');
    } else {
      console.log('  outlook band ' + ol.bandPct[0] + '%–' + ol.bandPct[1] + '%  goal ' + ol.goalPct + '%');
      console.log('    band: ' + ol.bandFill);
      console.log('    goal: ' + ol.goalFill + '   legend: ' + ol.legend.join(' | '));
      console.log('    ' + String(ol.note).slice(0, 120));
      if (!/violet|rgb/.test(ol.bandFill)) problems.push(theme + ': the outlook band is not painted');
      if (ol.goalPct == null) problems.push(theme + ': no goal marker with an active goal set');
    }

    // --- section crops ------------------------------------------------------
    for (const [name, sel, pt, pb] of [['reading', '[data-action="open-reading"]', 44, 10],
                                       ['record', '[data-action="open-record"]', 44, 10],
                                       ['outlook', '.outlook', 8, 8],
                                       ['trio', '.act-trio', 8, 8]]) {
      const clip = await clipOf(page, sel, pt, pb);
      if (clip) await page.screenshot({ path: path.join(OUT, name + '.' + theme + '.png'),
                                        fullPage: true, clip });
    }

    // --- every panel --------------------------------------------------------
    const anchor = (await clipOf(page, '[data-action="open-reading"]', 44, 10)).y;
    for (const key of PANELS) {
      await page.evaluate((y) => window.scrollTo(0, y), anchor);
      await page.waitForTimeout(120);
      const before = await page.evaluate(() => window.scrollY);
      await page.evaluate((k) => openHQPanel(k), key);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, 'panel.' + key + '.' + theme + '.png') });

      const m = await page.evaluate(() => {
        const card = document.querySelector('#modal-overlay .modal-card');
        if (!card) return null;
        const back = card.querySelector('.rec-panel-nav .btn-primary');
        const body = card.querySelector('.modal-body');
        const cs = getComputedStyle(body);
        return {
          title: card.querySelector('.modal-head h2').textContent,
          backLabel: back ? back.textContent.trim() : '(none)',
          backWidth: back ? Math.round(back.getBoundingClientRect().width) : 0,
          contentWidth: Math.round(body.getBoundingClientRect().width -
            parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
          backBg: back ? getComputedStyle(back).backgroundImage.slice(0, 52) : '',
          primaries: card.querySelectorAll('.btn-primary').length,
          exits: card.querySelectorAll('[data-action="close-record-panel"]').length,
          rail: card.querySelectorAll('.bld-progress, .bld-stage-no').length,
          height: Math.round(card.getBoundingClientRect().height),
          actions: Array.from(card.querySelectorAll('.modal-body [data-action]'))
            .map(e => e.getAttribute('data-action'))
            .filter(a => a !== 'close-record-panel'),
        };
      });
      if (!m){ problems.push(theme + '/' + key + ': the panel did not open'); continue; }
      console.log('  panel ' + key.padEnd(11) + '"' + m.title + '"'.padEnd(24) + m.height + 'px  ' +
        'back=' + m.backWidth + '/' + m.contentWidth + 'px  primaries=' + m.primaries +
        ' exits=' + m.exits + ' rail=' + m.rail +
        (m.actions.length ? '  actions=' + m.actions.join(',') : ''));
      if (m.primaries !== 1) problems.push(theme + '/' + key + ': ' + m.primaries + ' primary buttons');
      if (m.exits !== 2) problems.push(theme + '/' + key + ': ' + m.exits + ' exits, expected X and BACK');
      if (m.rail !== 0) problems.push(theme + '/' + key + ': carries a build-stage rail');
      if (m.backLabel !== '← BACK') problems.push(theme + '/' + key + ': BACK reads ' + m.backLabel);
      if (Math.abs(m.backWidth - m.contentWidth) > 2)
        problems.push(theme + '/' + key + ': BACK is ' + m.backWidth + 'px in a ' + m.contentWidth + 'px body');
      if (!/rgb/.test(m.backBg)) problems.push(theme + '/' + key + ': BACK is not a violet fill');

      // Close it the way an athlete would, and check where they land.
      await page.evaluate(() => document.querySelector('.rec-panel-nav .btn-primary').click());
      await page.waitForTimeout(220);
      const after = await page.evaluate(() => window.scrollY);
      if (Math.abs(after - before) > 2)
        problems.push(theme + '/' + key + ': BACK landed at ' + after + ', left from ' + before);
      if (await page.$('#modal-overlay')) problems.push(theme + '/' + key + ': BACK did not close it');
    }

    // The X, once, on the same terms.
    await page.evaluate((y) => window.scrollTo(0, y), anchor);
    const beforeX = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => openHQPanel('recovery'));
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('.modal-head .icon-btn').click());
    await page.waitForTimeout(220);
    const afterX = await page.evaluate(() => window.scrollY);
    console.log('  X exit: left at ' + beforeX + ', landed at ' + afterX);
    if (Math.abs(afterX - beforeX) > 2) problems.push(theme + ': X landed at ' + afterX + ', left from ' + beforeX);

    // Every trio tile has to be a real target and fire a handled action.
    const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('.act-tile')).map(t => ({
      label: t.querySelector('.act-lab').textContent,
      action: t.getAttribute('data-action'),
      w: Math.round(t.getBoundingClientRect().width),
      h: Math.round(t.getBoundingClientRect().height),
      clipped: t.scrollWidth > t.clientWidth + 1,
    })));
    console.log('  trio: ' + tiles.map(t => t.label + ' [' + t.action + '] ' + t.w + 'x' + t.h).join('  |  '));
    const acts = new Set(tiles.map(t => t.action));
    if (acts.size !== tiles.length) problems.push(theme + ': two trio tiles fire the same action');
    tiles.forEach(t => {
      if (t.h < 44 || t.w < 44) problems.push(theme + ': tile "' + t.label + '" is ' + t.w + 'x' + t.h);
      if (t.clipped) problems.push(theme + ': tile "' + t.label + '" is clipped at 390px');
    });

    const h = await page.evaluate(() => document.getElementById('view-mount').scrollHeight);
    console.log('  Plan HQ height: ' + h + 'px');
    await ctx.close();
  }
  await browser.close();
  server.close();

  console.log('\n=== ' + (problems.length ? problems.length + ' PROBLEM(S)' : 'no problems') + ' ===');
  problems.forEach(p => console.log('  ! ' + p));
  console.log('frames in ' + path.relative(ROOT, OUT));
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
