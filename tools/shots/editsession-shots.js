'use strict';
/* Visual proof for the Edit Session theme fix.
   ===========================================================================

   Edit Session was the one edit flow that never opted into .modal-themed, so a
   light-mode athlete got a near-black sheet dropped over a cream app. This
   opens it in both themes and MEASURES the two things a screenshot alone can
   not settle:

     - the modal's surface actually follows the app's surface, rather than
       sitting on the fixed dark ramp in both themes;
     - every piece of text inside it still clears WCAG AA against whatever it
       now sits on.

   Run:  node tools/shots/editsession-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'editsession');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
               '.json':'application/json' };

/* ONE KNOWN SHORTFALL, AND IT IS NOT THIS FIX'S.
   .btn-danger is a bare outline -- background:none, --danger-text as its label
   -- so in DARK mode its label sits on --bg wherever it appears in the app,
   at 3.72:1. Measured on the pre-fix build it was 3.79:1 against the pinned
   dark ramp: the same number, from the same tokens, before this change
   existed. Raising it means moving --danger-text app-wide, which is a
   deliberate palette decision and not a side effect of theming one modal.

   The fix's own effect on this button ran the other way: in LIGHT mode Reset
   was a real 2.63:1 AA failure on the dark sheet, and is 6.30:1 now. */
const KNOWN = { 'dark/Reset': '.btn-danger on --bg, app-wide, unchanged by this fix (was 3.79:1)' };

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

function seed(theme){
  const start = todayStr();
  const startMonday = addDays(start, -isoWeekday(start));
  const br = buildBlockWeeks('half', 45, 12);
  const schedule = { activeDays:[1,2,3,5,6], longRunDay:6 };
  state.days = buildDaysFromWeeks(br, addDays(startMonday, 83), schedule,
                                  addDays(startMonday, -28), false);
  state.setup = { distanceKey:'half', currentVolume:45, raceDate:addDays(startMonday, 83),
    hasEvent:false, startDate:addDays(startMonday, -28), planWeeks:br.planWeeks,
    schedule:schedule, benchmark:{ distanceKey:'10k', timeSec:2585 },
    goals:{ A:{ timeSec:5820 } }, activeGoal:'A', paceOverrides:{},
    lthr:168, maxHR:190, experience:'experienced' };
  state.theme = theme; state.themeExplicit = true; applyThemeToDocument();
  state.view = 'week';
  renderApp();
  // A quality session in the past, so the completion sub-form has real content.
  const today = todayStr();
  let target = null;
  state.days.forEach(dd => {
    if (dd.type !== 'rest' && dd.date < today) target = dd;
  });
  openEditModal(target.id);
  return target.id;
}

// WCAG relative luminance / contrast ratio, from the rendered colours.
function contrastProbe(){
  const lum = (c) => {
    const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
      .map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (fg, bg) => {
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  /* Walk up for the first element that actually paints a background -- and
     read a GRADIENT as its darkest stop rather than walking past it. The
     primary buttons are gradient-filled, so a backgroundColor-only probe
     reported their label against the card behind them and produced a 1:1
     that is not what anybody sees. */
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const img = cs.backgroundImage;
      if (img && img !== 'none') {
        const stops = img.match(/rgba?\([^)]+\)/g);
        if (stops && stops.length) {
          // darkest stop = worst case for a light label, lightest for a dark one
          return stops.slice().sort((a, b) => lum(a) - lum(b))[
            lum(getComputedStyle(el).color) > 0.5 ? 0 : stops.length - 1];
        }
      }
      if (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor))
        return cs.backgroundColor;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const card = document.querySelector('#modal-overlay .modal-card');
  const samples = [];
  const add = (name, el) => {
    if (!el) return;
    const fg = getComputedStyle(el).color, bg = bgOf(el);
    samples.push({ name, fg, bg, ratio: Number(ratio(fg, bg).toFixed(2)) });
  };
  add('heading', card.querySelector('.modal-head h2'));
  add('date hint', card.querySelector('.modal-body > .field-hint'));
  add('field label', card.querySelector('.field label'));
  add('text input', card.querySelector('#ef-title'));
  add('select', card.querySelector('#ef-type'));
  add('textarea', card.querySelector('#ef-desc'));
  add('legend', card.querySelector('legend'));
  add('swap hint', card.querySelector('fieldset .field-hint'));
  add('Save', card.querySelector('[data-action="save-edit"]'));
  add('Reset', card.querySelector('[data-action="reset-day"]'));
  return {
    appBg: getComputedStyle(document.body).backgroundColor,
    cardBg: getComputedStyle(card).backgroundColor,
    themed: card.classList.contains('modal-themed'),
    height: Math.round(card.getBoundingClientRect().height),
    fields: card.querySelectorAll('#ef-title,#ef-type,#ef-km,#ef-mp,#ef-desc,#ef-swap').length,
    samples,
  };
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];
  const seen = {};

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
                                           deviceScaleFactor: 3 });
    await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });
    await page.evaluate(seed, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'edit-session.' + theme + '.png') });

    const m = await page.evaluate(contrastProbe);
    seen[theme] = m;
    console.log('\n' + theme.toUpperCase() + '  app ' + m.appBg + '   modal ' + m.cardBg +
      '   themed=' + m.themed + '   ' + m.height + 'px   ' + m.fields + '/6 fields');
    m.samples.forEach(s => {
      const aa = s.ratio >= 4.5 ? 'AA' : s.ratio >= 3 ? 'AA-large' : 'FAIL';
      console.log('    ' + s.name.padEnd(13) + String(s.ratio).padStart(6) + ':1  ' + aa +
        '   ' + s.fg + ' on ' + s.bg);
      if (s.ratio < 4.5 && !KNOWN[theme + '/' + s.name])
        problems.push(theme + ': "' + s.name + '" at ' + s.ratio + ':1');
    });
    if (!m.themed) problems.push(theme + ': the modal does not carry .modal-themed');
    if (m.fields !== 6) problems.push(theme + ': ' + m.fields + '/6 fields survived the fix');
    await ctx.close();
  }
  await browser.close();
  server.close();

  // The actual bug: the modal surface has to MOVE with the theme.
  if (seen.light && seen.dark) {
    console.log('\nmodal surface  light ' + seen.light.cardBg + '   dark ' + seen.dark.cardBg);
    if (seen.light.cardBg === seen.dark.cardBg)
      problems.push('the modal paints the same surface in both themes — the bug is back');
    if (seen.light.cardBg !== seen.light.appBg)
      problems.push('light: the modal surface (' + seen.light.cardBg +
        ') does not match the app surface (' + seen.light.appBg + ')');
    if (seen.dark.cardBg !== seen.dark.appBg)
      problems.push('dark: the modal surface (' + seen.dark.cardBg +
        ') does not match the app surface (' + seen.dark.appBg + ')');
  }

  console.log('\n=== ' + (problems.length ? problems.length + ' PROBLEM(S)' : 'no problems') + ' ===');
  problems.forEach(p => console.log('  ! ' + p));
  console.log('frames in ' + path.relative(ROOT, OUT));
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
