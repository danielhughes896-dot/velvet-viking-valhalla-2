'use strict';
/* Visual proof for THE RECORD — Plan HQ's four cards and their detail panels.
   ===========================================================================

   Captures, at Pixel width in both themes:
     planhq.<theme>           the whole of Plan HQ, so the rhythm is judgeable
     record.<theme>           The Record section on its own
     panel.<key>.<theme>      each of the four panels, opened over Plan HQ

   It also MEASURES the three claims that are easy to assert and hard to see:
     - the four cards are the same height as each other;
     - every panel's BACK button is full width and violet, and is the only
       primary on the surface;
     - closing a panel returns the page to the exact scroll offset it was at.

   Run:  node tools/shots/record-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'record');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
               '.json':'application/json' };
const PANELS = ['fitness', 'benchmark', 'zones', 'progress'];

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
   athlete actually logged and scored -- an empty plan hides every value the
   Record cards exist to state. */
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
    /* The same call logging a session makes (see the comment at
       "MEASURED FITNESS IS RECORDED HERE"), so a checkpoint the athlete has
       already run shows up as a measurement rather than as an unlogged one. */
    if (dd.type === 'race' || dd.type === 'checkpoint') recordMeasuredPerformance(dd);
  });
  state.theme = theme; state.themeExplicit = true; applyThemeToDocument();
  state.view = 'planhq';
  renderApp();
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

    // --- the four cards, measured -------------------------------------------
    const geo = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.rec-card'));
      return cards.map(c => ({
        subject: c.querySelector('.rec-subject').textContent,
        value: c.querySelector('.rec-val').textContent,
        h: Math.round(c.getBoundingClientRect().height),
        valColour: getComputedStyle(c.querySelector('.rec-val')).color,
        chevron: !!c.querySelector('svg'),
      }));
    });
    console.log('\n' + theme.toUpperCase() + ' — ' + geo.length + ' Record cards');
    geo.forEach(g => console.log('  ' + g.subject.padEnd(22) + String(g.h).padStart(4) + 'px  ' +
      g.value.padEnd(22) + (g.chevron ? 'chev' : 'NO CHEVRON') + '  ' + g.valColour));
    if (geo.length !== 4) problems.push(theme + ': ' + geo.length + ' cards, expected 4');
    if (new Set(geo.map(g => g.h)).size > 2)
      problems.push(theme + ': cards come in ' + new Set(geo.map(g => g.h)).size + ' different heights');
    if (new Set(geo.map(g => g.valColour)).size > 2)
      problems.push(theme + ': Record values are painted in more than two colours');

    // The Record section on its own.
    const first = await page.$('.rec-card');
    const box = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.setup-section-title'))
        .filter(e => e.textContent === 'The Record')[0];
      const cards = Array.from(document.querySelectorAll('.rec-card'));
      const last = cards[cards.length - 1].getBoundingClientRect();
      const top = t.getBoundingClientRect();
      return { x: 0, y: top.top + window.scrollY - 8, width: 390,
               height: (last.bottom + window.scrollY) - (top.top + window.scrollY) + 16 };
    });
    // fullPage, because the section sits well below the fold and a clip is
    // read against the captured image rather than the viewport.
    if (first) await page.screenshot({ path: path.join(OUT, 'record.' + theme + '.png'),
                                       fullPage: true, clip: box });

    // --- each panel, opened over a scrolled Plan HQ --------------------------
    for (const key of PANELS) {
      await page.evaluate((y) => window.scrollTo(0, y), box.y);
      await page.waitForTimeout(150);
      const before = await page.evaluate(() => window.scrollY);
      await page.evaluate((k) => openRecordPanel(k), key);
      await page.waitForTimeout(320);
      await page.screenshot({ path: path.join(OUT, 'panel.' + key + '.' + theme + '.png') });

      const m = await page.evaluate(() => {
        const card = document.querySelector('#modal-overlay .modal-card');
        const back = card.querySelector('.btn-primary');
        const closes = card.querySelectorAll('[data-action="close-record-panel"]');
        const x = card.querySelector('.icon-btn');
        return {
          title: card.querySelector('.modal-head h2').textContent,
          radius: getComputedStyle(card).borderRadius,
          backLabel: back.textContent,
          backWidth: Math.round(back.getBoundingClientRect().width),
          // content width, not clientWidth: .modal-body carries 18px of side
          // padding, and a full-width button fills the content box.
          bodyWidth: Math.round(
            card.querySelector('.modal-body').getBoundingClientRect().width -
            parseFloat(getComputedStyle(card.querySelector('.modal-body')).paddingLeft) -
            parseFloat(getComputedStyle(card.querySelector('.modal-body')).paddingRight)),
          backBg: getComputedStyle(back).backgroundImage.slice(0, 60),
          primaries: card.querySelectorAll('.btn-primary').length,
          exits: closes.length,
          xRadius: getComputedStyle(x).borderRadius,
          rail: card.querySelectorAll('.bld-progress, .bld-stage-no').length,
          height: Math.round(card.getBoundingClientRect().height),
        };
      });
      console.log('  panel ' + key.padEnd(10) + '"' + m.title + '"  ' + m.height + 'px  ' +
        'back=' + JSON.stringify(m.backLabel) + ' ' + m.backWidth + '/' + m.bodyWidth + 'px  ' +
        'primaries=' + m.primaries + ' exits=' + m.exits + ' rail=' + m.rail +
        ' x-radius=' + m.xRadius);
      console.log('      back fill: ' + m.backBg);
      if (m.primaries !== 1) problems.push(theme + '/' + key + ': ' + m.primaries + ' primary buttons');
      if (m.exits !== 2) problems.push(theme + '/' + key + ': ' + m.exits + ' exits, expected X and BACK');
      if (m.rail !== 0) problems.push(theme + '/' + key + ': carries a build-stage rail');
      if (m.backLabel.trim() !== '← BACK') problems.push(theme + '/' + key + ': BACK reads ' + m.backLabel);
      if (Math.abs(m.backWidth - m.bodyWidth) > 2)
        problems.push(theme + '/' + key + ': BACK is ' + m.backWidth + 'px in a ' + m.bodyWidth + 'px body');

      // Close it the way an athlete would, and check where they land.
      await page.evaluate(() => document.querySelector('.rec-panel-nav .btn-primary').click());
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => window.scrollY);
      if (Math.abs(after - before) > 2)
        problems.push(theme + '/' + key + ': BACK landed at ' + after + ', left from ' + before);
      if (await page.$('#modal-overlay')) problems.push(theme + '/' + key + ': BACK did not close it');
    }

    // The X, once, on the same terms.
    await page.evaluate((y) => window.scrollTo(0, y), box.y);
    const beforeX = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => openRecordPanel('progress'));
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('.modal-head .icon-btn').click());
    await page.waitForTimeout(250);
    const afterX = await page.evaluate(() => window.scrollY);
    console.log('  X exit: left at ' + beforeX + ', landed at ' + afterX);
    if (Math.abs(afterX - beforeX) > 2) problems.push(theme + ': X landed at ' + afterX + ', left from ' + beforeX);

    // Plan HQ's overall height, before and after, is the point of the exercise.
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
