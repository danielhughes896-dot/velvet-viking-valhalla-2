'use strict';
/* Visual verification for the Cherry Lacquer accent migration.
   ===========================================================================

   Captures, in BOTH themes, the surfaces where the accent actually lands, and
   MEASURES each one rather than trusting the frame:

     builder      the five-stage rail, a selected option, Continue
     workout      the numbered step discs, the connector, "How to run this"
     planhq       the confidence gauge and the Race Outlook band
     panel        a Plan HQ panel's solid Cherry Lacquer BACK
     settings     the switch ON states
     edit         Edit Session (the theme fix)
     restore      one of the newly corrected work modals

   For every accent-bearing element it reports the rendered colour, the label
   contrast where there is a label, and the boundary contrast against whatever
   surface it sits on. And it sweeps the whole rendered page for any surviving
   purple, which is the orphan check.

   Run:  node tools/shots/accent-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'accent');
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

function seed(theme){
  const start = todayStr();
  const startMonday = addDays(start, -isoWeekday(start));
  const br = buildBlockWeeks('half', 45, 12);
  const schedule = { activeDays:[1,2,3,5,6], longRunDay:6 };
  state.days = buildDaysFromWeeks(br, addDays(startMonday, 83), schedule,
                                  addDays(startMonday, -49), false);
  state.setup = { distanceKey:'half', currentVolume:45, raceDate:addDays(startMonday, 83),
    hasEvent:false, startDate:addDays(startMonday, -49), planWeeks:br.planWeeks,
    schedule:schedule, benchmark:{ distanceKey:'10k', timeSec:2585 },
    goals:{ A:{ timeSec:5820 } }, activeGoal:'A', paceOverrides:{ M:{ fast:294, slow:313 } },
    lthr:168, maxHR:190, experience:'experienced' };
  state.healthConsent = { granted:true, version:HEALTH_CONSENT_VERSION,
                          at:new Date().toISOString() };
  state.notifyEnabled = true;
  const today = todayStr();
  state.days.forEach(function(dd){
    if (dd.type === 'rest' || dd.date >= today) return;
    const tgt = getTargetPaceRangeSecPerKm(dd);
    const mid = tgt && tgt.fast != null ? Math.round((tgt.fast + tgt.slow) / 2) : 320;
    dd.completed = true;
    dd.actual = { km: dd.km, pace: secToPace(mid), hr: 148, rpe: 5, feel: 'good', notes: '' };
    if (dd.type === 'race' || dd.type === 'checkpoint') recordMeasuredPerformance(dd);
  });
  state.theme = theme; state.themeExplicit = true; applyThemeToDocument();
  renderApp();
}

/* Contrast, measured off the live page. A gradient is read as its worst stop;
   a transparent element is measured against the first painted ancestor. */
function probeFactory(){
  return function(){
    const lum = (c) => {
      const [r,g,b] = c.match(/[\d.]+/g).slice(0,3).map(Number)
        .map(v => { v/=255; return v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
      return 0.2126*r + 0.7152*g + 0.0722*b;
    };
    const ratio = (a,b) => (Math.max(lum(a),lum(b))+0.05)/(Math.min(lum(a),lum(b))+0.05);
    const painted = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor))
          return cs.backgroundColor;
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const fillsOf = (el) => {
      const cs = getComputedStyle(el);
      const img = cs.backgroundImage;
      const stops = (img && img !== 'none') ? img.match(/rgba?\([^)]+\)/g) : null;
      if (stops && stops.length) return stops;
      if (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor))
        return [cs.backgroundColor];
      return null;
    };
    window.__probe = function(sel, name, opts){
      const el = document.querySelector(sel);
      if (!el) return { name: name, missing: true };
      const o = opts || {};
      const cs = getComputedStyle(el);
      const fills = fillsOf(el);
      const surface = painted(el.parentElement || document.body);
      const out = { name: name, sel: sel };
      if (o.stroke) {
        // An outlined component is defined by its BORDER, whatever it is
        // filled with -- "How to run this" has a --bg-3 interior and a Cherry
        // Lacquer edge, and it is the edge that marks it.
        out.fill = cs.borderTopColor || cs.borderColor || cs.color;
        out.edge = Math.round(ratio(out.fill, surface) * 100)/100;
        if (o.label !== false && fills)
          out.label = Math.round(Math.min.apply(null, fills.map(f => ratio(cs.color, f))) * 100)/100;
      } else if (fills) {
        out.fill = fills.join(' -> ');
        // A bordered fill reads by whichever of the two separates it better.
        const edges = fills.map(f => ratio(f, surface));
        const b = cs.borderTopColor;
        if (b && !/rgba\(0, 0, 0, 0\)/.test(b) && parseFloat(cs.borderTopWidth) > 0)
          edges.push(ratio(b, surface));
        // A hairline drawn as a box-shadow ring is an edge too -- the Race
        // Outlook's goal marker gets its separation that way.
        const ring = (cs.boxShadow || '').match(/rgba?\([^)]+\)/);
        if (ring && !/inset/.test(cs.boxShadow)) edges.push(ratio(ring[0], surface));
        out.edge = Math.round(Math.max.apply(null, edges) * 100)/100;
        if (o.label !== false)
          out.label = Math.round(Math.min.apply(null, fills.map(f => ratio(cs.color, f))) * 100)/100;
      } else if (false) {
        out.fill = cs.borderColor || cs.color;
        out.edge = Math.round(ratio(out.fill, surface) * 100)/100;
      } else {
        out.fill = cs.color;
        out.label = Math.round(ratio(cs.color, surface) * 100)/100;
      }
      out.surface = surface;
      return out;
    };
    // Every rendered colour on the page, so an orphan purple cannot hide.
    window.__sweep = function(){
      const bad = [];
      document.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        [cs.color, cs.backgroundColor, cs.borderColor, cs.backgroundImage, cs.stroke, cs.fill]
          .join(' ').match(/rgba?\([^)]+\)/g)?.forEach(c => {
            const [r,g,b,a] = c.match(/[\d.]+/g).map(Number);
            if (a === 0) return;
            // purple/violet: blue clearly dominant over red, and red over green
            if (b > r + 22 && r > g + 12 && b > 70)
              bad.push((el.className && el.className.baseVal !== undefined
                        ? el.tagName : (el.className || el.tagName)) + ' ' + c);
          });
      });
      return [...new Set(bad)];
    };
  };
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];
  /* Values this migration did not create and does not change. The bronze
     primary has carried --bronze-ink at 4.38:1 everywhere in the app since
     long before Cherry Lacquer existed; raising it means moving --bronze-ink,
     which is a palette decision rather than a side effect of an accent swap.
     Reported every run, never counted as a regression of this work. */
  const KNOWN = {
    'Save': 'the bronze primary, app-wide, unchanged by this migration',
    'Re-calibrate': 'the bronze primary, app-wide, unchanged by this migration',
  };

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
                                           deviceScaleFactor: 3 });
    await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });
    await page.evaluate(seed, theme);
    await page.evaluate(probeFactory());
    await page.waitForTimeout(350);
    console.log('\n' + '='.repeat(72) + '\n' + theme.toUpperCase());

    const shot = async (name, probes) => {
      await page.waitForTimeout(280);
      await page.screenshot({ path: path.join(OUT, name + '.' + theme + '.png') });
      const rows = await page.evaluate((ps) => ps.map(p => window.__probe(p[0], p[1], p[2])), probes);
      console.log('  -- ' + name);
      rows.forEach(r => {
        if (r.missing) { console.log('     ' + r.name.padEnd(26) + 'NOT PRESENT'); return; }
        const bits = [];
        if (r.label != null) bits.push('label ' + r.label + ':1');
        if (r.edge != null) bits.push('edge ' + r.edge + ':1');
        console.log('     ' + r.name.padEnd(26) + r.fill.slice(0, 40).padEnd(42) + bits.join('  '));
        if (KNOWN[r.name]) { console.log('       ^ known: ' + KNOWN[r.name]); return; }
        if (r.label != null && r.label < 4.5)
          problems.push(theme + '/' + name + ': ' + r.name + ' label ' + r.label + ':1');
        if (r.edge != null && r.edge < 3)
          problems.push(theme + '/' + name + ': ' + r.name + ' boundary ' + r.edge + ':1');
      });
      const purple = await page.evaluate(() => window.__sweep());
      if (purple.length) {
        console.log('     ORPHAN PURPLE: ' + purple.join(' | '));
        problems.push(theme + '/' + name + ': orphan purple -> ' + purple.join(' | '));
      }
      return rows;
    };

    // 1 -- the builder: rail, selected option, Continue
    await page.evaluate(() => { closeModal(); openSetupModal(); });
    await shot('builder', [
      ['.bld-step.now',   'rail: current stage', { label:false }],
      ['.bld-stage-no',   'stage numeral'],
      ['.opt-grid button.active', 'selected option (gold, unchanged)', { stroke:true, label:false }],
      ['.bld-actions .btn-primary', 'Continue'],
    ]);

    // 2 -- an expanded workout: step discs, connector, How to run this
    await page.evaluate(() => {
      closeModal();
      state.view = 'full'; renderApp();
      /* Every week open, every session open: the point of this frame is the
         structured workout, and the renderer only emits .ws-steps for a
         session that has segments. Opening them all and then scrolling to the
         first disc finds one whatever the fixture generated. */
      for (var w = 1; w <= totalWeeksInPlan(); w++) expandedWeeks[w] = true;
      state.days.forEach(function(d){ if (d.type !== 'rest') dayExpandOverride[d.id] = true; });
      renderApp();
      document.querySelectorAll('.fuel-card.how-card').forEach(function(x){ x.open = true; });
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      var n = document.querySelector('.ws-n');
      if (n) {
        var box = n.getBoundingClientRect();
        window.scrollTo(0, box.top + window.scrollY - 210);
      }
    });
    await shot('workout', [
      ['.ws-n',            'step disc'],
      ['.ws-step',         'connector (::before)', { stroke:true }],
      ['.fuel-card.how-card', 'How to run this', { stroke:true }],
    ]);

    // 3 -- Plan HQ: gauge + Race Outlook
    await page.evaluate(() => { state.view = 'planhq'; renderApp(); window.scrollTo(0,0); });
    await shot('planhq', [
      ['.outlook-band',    'Race Outlook band', { label:false }],
      ['.outlook-goal',    'goal marker', { label:false }],
      ['.ol-swatch.measured', 'legend swatch', { label:false }],
    ]);
    const gauge = await page.evaluate(() => {
      const arc = document.querySelector('#gaugeFillGrad stop:last-child');
      const needle = document.querySelector('.confidence-gauge line[stroke-width="2.4"]');
      return { arc: arc && getComputedStyle(arc).stopColor,
               needle: needle && getComputedStyle(needle).stroke };
    });
    console.log('     ' + 'gauge arc / needle'.padEnd(26) + gauge.arc + '  /  ' + gauge.needle);

    // 4 -- a Plan HQ panel: the solid BACK
    await page.evaluate(() => { window.scrollTo(0, 900); openHQPanel('benchmark'); });
    await shot('panel', [['.rec-panel-nav .btn-primary', 'BACK']]);

    // 5 -- Settings: switches ON
    await page.evaluate(() => {
      closeRecordPanel(); state.view = 'settings'; renderApp();
      document.querySelectorAll('.switch input').forEach(i => { i.checked = true; i.disabled = false; });
    });
    await shot('settings', [['.switch input:checked + .switch-track', 'switch ON', { label:false }]]);

    // 6 -- Edit Session (the theme fix)
    await page.evaluate(() => {
      const today = todayStr();
      let t = null; state.days.forEach(d => { if (d.type!=='rest' && d.date < today) t = d; });
      state.view = 'week'; renderApp(); openEditModal(t.id);
    });
    await shot('edit-session', [['.modal-actions .btn-primary', 'Save']]);

    // 7 -- a newly corrected work modal
    await page.evaluate(() => { closeModal(); openSettingsModal(); });
    await shot('settings-modal', [['.modal-body .btn-primary', 'Re-calibrate']]);

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
