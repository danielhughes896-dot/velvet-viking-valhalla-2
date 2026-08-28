'use strict';
/* DOES VALHALLA OPEN IN AIRPLANE MODE? THE AUDIT'S FAILING TEST, RERUN.
 * ===========================================================================
 * The startup audit's strongest finding was one line:
 *
 *     document loaded : NO -- the app does not open at all
 *
 * with a complete 106-day plan sitting in localStorage. This runs exactly that
 * test against the service worker, in a real Chromium, and then the cases that
 * decide whether the bound is real: an expired window, and a clock rolled back
 * to try to extend one.
 *
 *   node tools/perf/offline-startup-check.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const appMod = require(path.join(ROOT, 'api', 'app.js'));
const RUNTIME = fs.readFileSync(appMod.RUNTIME_FILE);
const MIME = { '.png':'image/png','.js':'text/javascript','.css':'text/css','.json':'application/json' };

function serve(gate){
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/sw.js'){
      res.writeHead(200, { 'Content-Type':'text/javascript', 'Cache-Control':'no-cache' });
      return res.end(fs.readFileSync(path.join(ROOT, 'sw.js')));
    }
    if (url === '/' || url === '/index.html'){
      if (!gate.allow){
        res.writeHead(302, { 'location':'/account', 'cache-control':'private, no-store' });
        return res.end();
      }
      gate.served++;
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'private, max-age=0, must-revalidate',
        'ETag': appMod.runtimeEtag(), 'Vary':'Cookie',
        'x-vvv-entitled-at': String(Date.now()) });
      return res.end(RUNTIME);
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

/* A real 16-week plan, so what opens offline is a real athlete's training. */
function seeded(){
  const { loadApp } = require(path.join(ROOT, 'test', 'harness.js'));
  const { buildPlan, logAsPrescribed } = require(path.join(ROOT, 'test', 'fixtures.js'));
  const a = loadApp({ pinnedDate: '2026-08-27T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey:'half', volume:45, weeks:16,
                 startDate: a.addDays(a.todayStr(), -60),
                 schedule:{ activeDays:[1,2,3,5,6], longRunDay:6 } });
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach(d => logAsPrescribed(a, d));
  a.state.ownerUid = 'user-A';
  return { key: a.STORAGE_KEY, blob: JSON.stringify(a.state) };
}

async function open(ctx, url, label){
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e && e.message || e)));
  let ok = true;
  const t0 = Date.now();
  /* TIME TO USEFUL CONTENT, not to `load`. With the server down the Google
     Fonts stylesheet request hangs until it times out, which has nothing to do
     with how quickly the athlete can read their session -- the font link is
     media="print" and never blocked rendering. Waiting for `load` reported
     twelve seconds for a screen that was already readable in half of one. */
  try{
    await page.goto(url, { waitUntil:'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => {
      const app = document.getElementById('app');
      return !!(app && (app.innerText || '').length > 200);
    }, { timeout: 8000 });
  }catch(e){ ok = false; }
  const wall = Date.now() - t0;
  let view = { chars:0, sample:'', controlled:null, meta:null };
  if (ok){
    try{
      view = await page.evaluate(async () => {
        const app = document.getElementById('app');
        const txt = app ? (app.innerText || '') : '';
        let meta = null;
        try{
          const c = await caches.open('vvv-meta-v1');
          const r = await c.match('/__vvv_entitlement');
          if (r) meta = await r.json();
        }catch(e){}
        return { chars: txt.length, sample: txt.slice(0, 90).replace(/\s+/g, ' '),
                 /* Did the service worker actually answer this navigation? If
                    not, the browser's own HTTP cache did, and the window checks
                    were never consulted. */
                 controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
                 meta: meta ? { ageDays: Math.round((Date.now() - meta.deviceAt) / 86400000 * 10) / 10,
                                aheadOfNow: meta.deviceAt > Date.now() } : null };
      });
    }catch(e){}
  }
  await page.close();
  return { label, ok, wall, view, errs };
}

(async () => {
  const st = seeded();
  const gate = { allow: true, served: 0 };
  const { server, url } = await serve(gate);
  const dir = '/tmp/vvv-offline-' + Date.now();
  const ctx = await playwright.chromium.launchPersistentContext(dir, {
    executablePath:'/opt/pw-browsers/chromium', viewport:{ width:390, height:900 }, isMobile:true });
  await ctx.addInitScript(p => { try{ localStorage.setItem(p.key, p.state); }catch(e){} },
                          { key: st.key, state: st.blob });
  const problems = [];

  /* 1. One successful online launch, which registers the worker and grants. */
  const first = await open(ctx, url, 'online, first');
  /* The worker installs asynchronously; a second online launch is the first
     one it actually controls, and is what fills the shell cache. */
  const second = await open(ctx, url, 'online, controlled');
  await new Promise(r => setTimeout(r, 1200));

  /* 2. AIRPLANE MODE -- the audit's failing test.
     THE SERVER IS SHUT DOWN, not merely marked offline. Playwright's
     setOffline does not reach the service worker's own fetch() in this
     Chromium, so the first version of this harness measured a worker that was
     still successfully reaching the network and reported it as offline
     success. Closing the socket is the only unambiguous test. */
  const port = Number(new URL(url).port);
  await new Promise(r => server.close(r));
  const offline = await open(ctx, url, 'AIRPLANE MODE (server down)');

  /* 3. Age the stamp past seven days, with the server still down. The record
     is written from a page context, and the worker's own stamp cannot race it
     because there is nothing for the worker to fetch. */
  const agePage = await ctx.newPage();
  await agePage.goto(url, { waitUntil:'load' }).catch(() => {});
  await agePage.evaluate(async () => {
    const c = await caches.open('vvv-meta-v1');
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await c.put('/__vvv_entitlement', new Response(JSON.stringify(
      { serverAt: old, deviceAt: old, highWater: old }),
      { headers:{ 'content-type':'application/json' } }));
  }).catch(e => problems.push('could not age the stamp: ' + e.message));
  await agePage.close();
  const expired = await open(ctx, url, 'offline, window expired (day 8)');

  /* 4. A stamp from the future -- what a rolled-back clock looks like. */
  const rollPage = await ctx.newPage();
  await rollPage.goto(url, { waitUntil:'load' }).catch(() => {});
  await rollPage.evaluate(async () => {
    const c = await caches.open('vvv-meta-v1');
    const now = Date.now();
    await c.put('/__vvv_entitlement', new Response(JSON.stringify(
      { serverAt: now, deviceAt: now + 3 * 86400000, highWater: now + 3 * 86400000 }),
      { headers:{ 'content-type':'application/json' } }));
  }).catch(() => {});
  await rollPage.close();
  const rolled = await open(ctx, url, 'offline, clock rolled back');

  await ctx.close();

  [first, second, offline, expired, rolled].forEach(r => {
    console.log('  ' + r.label.padEnd(34) +
      ' opened=' + (r.ok ? 'yes' : 'NO ') +
      ' content=' + String(r.view.chars).padStart(5) + 'ch' +
      ' wall=' + String(r.wall).padStart(5) + 'ms' +
      ' sw=' + (r.view.controlled === null ? '?' : (r.view.controlled ? 'yes' : 'NO')) +
      ' meta=' + (r.view.meta ? (r.view.meta.ageDays + 'd' + (r.view.meta.aheadOfNow ? ' AHEAD' : '')) : 'none') +
      (r.errs.length ? '  ERR ' + r.errs[0].slice(0, 40) : ''));
    if (r.view.sample) console.log('      ' + r.view.sample);
  });

  if (!offline.ok) problems.push('AIRPLANE MODE: the app still does not open');
  if (offline.ok && offline.view.chars < 200) problems.push('AIRPLANE MODE: opened but showed nothing');
  if (expired.ok) problems.push('an expired window still served the shell offline');
  if (rolled.ok) problems.push('a rolled-back clock extended the offline window');
  console.log('');
  if (problems.length){ console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('Opens offline from last-known-good state; refuses once the window has ' +
                   'expired, and refuses a clock rolled back to extend it.');
})();
