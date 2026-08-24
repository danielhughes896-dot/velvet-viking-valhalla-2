'use strict';
/* Visual proof for THE READING's five dimensional badges on Valhalla.
   ===========================================================================
   Captures, at 360px and 390px width, light + dark:
     valhalla.<w>.<theme>       the whole Valhalla screen
     badges.<w>.<theme>         just the five-badge block, tightly cropped

   And MEASURES the concerns the brief called out by name:
     - badge diameter is consistent (62px / 70px lead) across all five
     - the 3+2 row arrangement is centred and does not wrap oddly
     - long state text ("Worth watching") and the percentage do not overflow
       or get clipped by the badge face
     - the badge's own shadow is not clipped by any ancestor
     - text/face contrast is legible

   Run:  node tools/shots/reading-badges-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'reading-badges');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
               '.json':'application/json' };

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

/* Same fixture shape as tools/shots/planhq-shots.js's seed() -- a half
   marathon block a third of the way in, sessions behind the athlete logged
   and scored, a mid-block checkpoint run and recorded -- so the five
   readings come from real coaching state, not a hand-picked value. */
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
    return { x: 0, y: r.top + window.scrollY - padTop, width,
             height: r.height + padTop + padBottom };
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
      const clip = await clipOf(page, '.b-dials', 40, 10, width);
      if (clip) await page.screenshot({ path: path.join(OUT, 'badges.' + tag + '.png'), fullPage: true, clip });

      // --- measurements -----------------------------------------------------
      const data = await page.evaluate(() => {
        const cols = Array.from(document.querySelectorAll('.b-dial-col'));
        const rows = Array.from(document.querySelectorAll('.b-dials-row'));
        const badges = cols.map((col) => {
          const dial = col.querySelector('.b-dial');
          const medal = col.querySelector('.b-medal');
          const b = col.querySelector('.b-medal b');
          const lbl = col.querySelector('.lbl');
          const dr = dial.getBoundingClientRect();
          const mr = medal.getBoundingClientRect();
          const br_ = b.getBoundingClientRect();
          const dialCS = getComputedStyle(dial);
          const medalCS = getComputedStyle(medal);
          return {
            label: lbl.textContent,
            text: b.textContent,
            lead: dial.classList.contains('lead'),
            dialW: Math.round(dr.width), dialH: Math.round(dr.height),
            textOverflowsMedal: br_.right > mr.right + 0.5 || br_.left < mr.left - 0.5 ||
                                 br_.bottom > mr.bottom + 0.5 || br_.top < mr.top - 0.5,
            textScrollOverflow: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1,
            rimColor: dialCS.backgroundColor,
            faceColor: (medalCS.backgroundImage.match(/#[0-9a-fA-F]{3,6}/g) || [])[1] || medalCS.backgroundColor,
            textColor: getComputedStyle(b).color,
          };
        });
        const rowsInfo = rows.map(r => r.querySelectorAll('.b-dial-col').length);
        // shadow-clip check: does any ancestor of .b-dials clip overflow?
        let clipper = null;
        let node = document.querySelector('.b-dials');
        while (node && node !== document.body) {
          const cs = getComputedStyle(node);
          if (node !== document.querySelector('.b-dials') && (cs.overflow === 'hidden' || cs.overflowY === 'hidden')) {
            clipper = node.className;
            break;
          }
          node = node.parentElement;
        }
        return { badges, rowsInfo, clipper };
      });

      console.log('\n' + tag);
      console.log('  rows: ' + data.rowsInfo.join('+'));
      if (data.rowsInfo.join('+') !== '3+2') problems.push(tag + ': row split is ' + data.rowsInfo.join('+') + ', expected 3+2');
      if (data.clipper) problems.push(tag + ': an ancestor (' + data.clipper + ') clips overflow -- badge shadow may be cut');
      data.badges.forEach((b) => {
        console.log('  ' + b.label.padEnd(11) + '"' + b.text + '"'.padEnd(18) + b.dialW + 'x' + b.dialH +
          (b.lead ? ' (lead)' : '') + '  rim=' + b.rimColor + '  face=' + b.faceColor);
        const expected = b.lead ? 70 : 62;
        if (b.dialW !== expected || b.dialH !== expected)
          problems.push(tag + ': ' + b.label + ' badge is ' + b.dialW + 'x' + b.dialH + 'px, expected ' + expected + 'x' + expected);
        if (b.textOverflowsMedal) problems.push(tag + ': ' + b.label + ' text box overflows its badge face');
        if (b.textScrollOverflow) problems.push(tag + ': ' + b.label + ' text "' + b.text + '" is clipped/scrolling inside its box');
      });

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
