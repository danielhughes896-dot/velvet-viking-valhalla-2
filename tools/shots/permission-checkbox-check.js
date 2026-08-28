'use strict';
/* THE PERMISSION TICKS, MEASURED IN A REAL BROWSER.
 * ===========================================================================
 * A CSS selector being present proves nothing here: the defect this fixes was
 * a selector that existed and LOST -- `.field input` repainted the circle as a
 * text box, and the markup's inline width:auto fought `width` while nothing
 * fought `min-height:44px`. So this reads getComputedStyle on the controls as
 * the browser actually paints them, in both themes, unchecked / checked /
 * focused, and compares them against the shared circle component's other
 * members rather than against numbers typed in here.
 *
 *   node tools/shots/permission-checkbox-check.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-permission-checkbox');
const TODAY = '2026-08-05';
const MIME = { '.png':'image/png','.js':'text/javascript','.css':'text/css','.json':'application/json' };

function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html'){
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }); return res.end(html);
    }
    const f = path.join(ROOT, url.replace(/^\/+/, ''));
    if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()){
      res.writeHead(404); return res.end('nf');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url:'http://127.0.0.1:' + server.address().port + '/' })));
}

/* An athlete who has NOT answered the health question, so BOTH permissions
   render and can be compared with each other. */
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey:'half', volume:45, weeks:14,
    startDate: a.addDays(a.todayStr(), -21), benchSec: a.clockToSec('0:45:00'),
    lthr:168, maxHR:188, healthConsent:false });
  a.state.setup.supportWork = 'on';
  a.state.healthConsent = null;
  return a;
}

/* A REAL FUNCTION, NOT A STRING. Passed as a string, Playwright evaluates it
   as an expression rather than calling it with the argument -- it returned a
   non-serialisable function, which arrived here as undefined and read exactly
   like "the control does not exist". The counts printed alongside are what
   showed the elements were there all along. */
const READ = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const after = getComputedStyle(el, '::after');
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    radius: cs.borderTopLeftRadius, borderW: cs.borderTopWidth, borderC: cs.borderTopColor,
    bg: cs.backgroundColor, appearance: cs.appearance || cs.webkitAppearance,
    shadow: cs.boxShadow, minH: cs.minHeight,
    tick: after.content + '|' + after.width + '|' + after.height + '|' + after.borderRightColor,
    outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const problems = [];
  const report = [];

  for (const theme of ['light', 'dark']){
    const a = athlete();
    const ctx = await browser.newContext({ viewport:{ width:390, height:900 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:theme });
    const page = await ctx.newPage();
    await page.route('https://fonts.googleapis.com/**', r =>
      r.fulfill({ status:200, contentType:'text/css', body:'' }));
    const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e)));
    const blob = Object.assign({}, JSON.parse(JSON.stringify(a.state)),
      { view:'today', theme, themeExplicit:true });
    await page.addInitScript(p => { try { localStorage.setItem(p.key, p.state); } catch(e){} },
      { key:a.STORAGE_KEY, state: JSON.stringify(blob) });
    await page.addInitScript(`(function(){
      var pinned = new Date(${JSON.stringify(TODAY + 'T09:00:00Z')}).getTime();
      var RealDate = Date;
      function D(){ return arguments.length ? new RealDate(...arguments) : new RealDate(pinned); }
      D.now = function(){ return pinned; };
      D.parse = RealDate.parse; D.UTC = RealDate.UTC; D.prototype = RealDate.prototype;
      window.Date = D;
    })();`);
    await page.goto(url, { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(700);

    /* THE REFERENCE MEMBER, measured on the same page: the Training Day
       selector's tick, which has always been the circular cherry control. */
    await page.evaluate(() => window.openSetupModal && window.openSetupModal());
    await page.waitForTimeout(500);
    await page.evaluate(() => { for (let i = 0; i < 20 && window.bldCurrentStage < 6; i++){
      const b = window.bldCurrentStage; window.handleBldNext(); if (window.bldCurrentStage === b) break; } });
    await page.waitForTimeout(400);
    const ref = await page.evaluate(READ, '.wd-check input');

    /* Then walk on to Review, where both permissions live. */
    await page.evaluate(() => { for (let i = 0; i < 20 && window.bldCurrentStage < 9; i++){
      const b = window.bldCurrentStage; window.handleBldNext(); if (window.bldCurrentStage === b) break; } });
    await page.waitForTimeout(500);

    /* Unchecked / checked, both controls.
       SETTLE BEFORE READING. The shared component animates background and
       border over .15s, and reading getComputedStyle immediately after a
       toggle returns an INTERPOLATED colour -- the first run of this reported
       a checked control as white and an unchecked one as cherry, which looked
       exactly like the fix not working. */
    const settle = () => page.waitForTimeout(320);
    await page.evaluate(() => {
      const h = document.getElementById('su-health-consent'); if (h) h.checked = false;
      const s = document.getElementById('su-support-work');   if (s) s.checked = false;
    });
    await settle();
    const healthOff  = await page.evaluate(READ, '#su-health-consent');
    const supportOff = await page.evaluate(READ, '#su-support-work');
    await page.evaluate(() => {
      const h = document.getElementById('su-health-consent'); if (h) h.checked = true;
      const s = document.getElementById('su-support-work');   if (s) s.checked = true;
    });
    await settle();
    const healthOn  = await page.evaluate(READ, '#su-health-consent');
    const supportOn = await page.evaluate(READ, '#su-support-work');

    /* Keyboard focus, reached by the keyboard rather than by script, so the
       :focus-visible the app relies on genuinely applies. */
    await page.evaluate(() => { const el = document.getElementById('su-health-consent'); if (el) el.blur(); });
    await page.focus('#su-health-consent');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(READ, '#su-health-consent');
    const focusMatch = await page.evaluate(() =>
      document.activeElement && document.activeElement.id === 'su-health-consent');

    /* Disabled, applied to a clone so the real control's state is untouched. */
    const disabled = await page.evaluate(() => {
      const el = document.getElementById('su-support-work');
      el.disabled = true;
      const cs = getComputedStyle(el);
      const out = { opacity: cs.opacity, cursor: cs.cursor };
      el.disabled = false;
      return out;
    });

    const check = (cond, msg) => { if (!cond) problems.push(theme + ': ' + msg); };
    check(ref, 'the reference .wd-check control was not found');
    [['health', healthOff, healthOn], ['support', supportOff, supportOn]].forEach(([name, off, on]) => {
      check(off, name + ' control not found');
      if (!off || !ref) return;
      check(off.w === ref.w && off.h === ref.h,
        name + ' is ' + off.w + 'x' + off.h + ', reference is ' + ref.w + 'x' + ref.h);
      check(off.radius === ref.radius, name + ' radius ' + off.radius + ' vs ' + ref.radius);
      check(off.borderW === ref.borderW, name + ' border width ' + off.borderW + ' vs ' + ref.borderW);
      check(off.borderC === ref.borderC, name + ' unchecked border ' + off.borderC + ' vs ' + ref.borderC);
      check(off.bg === ref.bg, name + ' unchecked fill ' + off.bg + ' vs ' + ref.bg);
      check(off.appearance === 'none', name + ' still has native appearance: ' + off.appearance);
      check(off.shadow === 'none', name + ' carries the text-input inset shadow: ' + off.shadow);
      check(on.tick.indexOf('none') === -1, name + ' checked state draws no tick: ' + on.tick);
    });
    if (healthOn && supportOn){
      check(healthOn.bg === supportOn.bg,
        'the two permissions do not match when checked: ' + healthOn.bg + ' vs ' + supportOn.bg);
      check(healthOn.tick === supportOn.tick, 'the two ticks differ');
    }
    if (healthOn && ref){
      /* The checked fill must be the shared --cherry token, resolved by the
         browser rather than compared against a hex typed in here. */
      const cherry = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.color = 'var(--cherry)';
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      });
      check(healthOn.bg === cherry, 'health checked fill ' + healthOn.bg + ' is not --cherry ' + cherry);
      check(supportOn.bg === cherry, 'support checked fill ' + supportOn.bg + ' is not --cherry ' + cherry);
      check(healthOff.bg !== cherry, 'the unchecked state is already cherry');
    }
    check(focusMatch, 'the control could not be reached by keyboard');
    check(focused && focused.outline.indexOf('none') === -1,
      'keyboard focus draws no outline: ' + (focused && focused.outline));
    check(disabled.opacity !== '1', 'disabled draws no dimming: opacity ' + disabled.opacity);
    check(disabled.cursor === 'default', 'disabled keeps a pointer cursor: ' + disabled.cursor);
    check(!errors.length, 'page errors: ' + errors.join(' | '));

    const counts = await page.evaluate(() => ({
      wd: document.querySelectorAll('.wd-check input').length,
      health: document.querySelectorAll('#su-health-consent').length,
      support: document.querySelectorAll('#su-support-work').length,
      panels: document.querySelectorAll('.bld-panel').length
    }));
    report.push({ theme, ref, healthOff, healthOn, supportOff, supportOn, focused, disabled,
                  stage: await page.evaluate(() => window.bldCurrentStage), counts });

    const panel = await page.$('.bld-permission');
    if (panel){ await panel.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
      await panel.screenshot({ path: path.join(OUT, 'permissions-' + theme + '.png') }); }
    const stage = await page.$('.bld-panel:not([hidden])');
    if (stage){ await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT, 'review-' + theme + '.png'), fullPage:false }); }
    await ctx.close();
  }
  await browser.close();
  await new Promise(r => server.close(r));

  report.forEach(r => {
    console.log('\n--- ' + r.theme + ' ---');
    if (!r.ref || !r.healthOff || !r.supportOff){
      console.log('  MISSING: ref=' + !!r.ref + ' health=' + !!r.healthOff + ' support=' + !!r.supportOff +
                  ' stage=' + r.stage + ' counts=' + JSON.stringify(r.counts));
      return;
    }
    console.log('  reference .wd-check : ' + r.ref.w + 'x' + r.ref.h + ' r=' + r.ref.radius +
      ' border=' + r.ref.borderW + ' ' + r.ref.borderC + ' bg=' + r.ref.bg);
    console.log('  health   unchecked  : ' + r.healthOff.w + 'x' + r.healthOff.h + ' r=' + r.healthOff.radius +
      ' border=' + r.healthOff.borderW + ' ' + r.healthOff.borderC + ' bg=' + r.healthOff.bg +
      ' shadow=' + r.healthOff.shadow + ' appearance=' + r.healthOff.appearance);
    console.log('  health   checked    : bg=' + r.healthOn.bg + ' tick=' + r.healthOn.tick);
    console.log('  support  unchecked  : ' + r.supportOff.w + 'x' + r.supportOff.h + ' bg=' + r.supportOff.bg);
    console.log('  support  checked    : bg=' + r.supportOn.bg + ' tick=' + r.supportOn.tick);
    console.log('  focus-visible       : ' + r.focused.outline);
    console.log('  disabled            : opacity=' + r.disabled.opacity + ' cursor=' + r.disabled.cursor);
  });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== VERDICT ===');
  if (!problems.length) console.log('  no problems found');
  else problems.forEach(p => console.log('  PROBLEM: ' + p));
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
