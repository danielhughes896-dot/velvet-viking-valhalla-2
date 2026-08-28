'use strict';
/* WHAT OPENING VALHALLA ACTUALLY COSTS, MEASURED.
 * ===========================================================================
 * Serves the runtime through the PRODUCTION cache headers -- api/app.js sends
 * `private, no-store, must-revalidate` -- and measures a cold load and a
 * repeat load with a warm profile, reporting transferred bytes and the timings
 * that matter to an athlete:
 *
 *     tap -> shell visible      tap -> useful Today content      tap -> interactive
 *
 * Then repeats the whole thing with the document made cacheable, so the
 * headroom is a measurement rather than an estimate. Nothing is changed in the
 * repository by this: the header is varied by the harness only.
 *
 *   node tools/perf/startup-audit.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const MIME = { '.png':'image/png','.css':'text/css','.js':'text/javascript',
               '.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml' };

/* PRODUCTION HEADER, verbatim from api/app.js serveRuntime(). */
const PROD_HTML_CACHE = 'private, no-store, must-revalidate';
/* What a cacheable-but-still-private document would send. Used only to
   measure the difference; nothing in the repo is changed. */
const ALT_HTML_CACHE = 'private, max-age=0, must-revalidate';

function serve(htmlCache){
  const html = fs.readFileSync(RUNTIME);
  const gz = zlib.gzipSync(html, { level: 9 });
  const etag = '"' + require('crypto').createHash('sha1').update(html).digest('hex').slice(0, 16) + '"';
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html'){
      /* Conditional request support, so a cacheable variant can 304. */
      if (htmlCache !== PROD_HTML_CACHE && req.headers['if-none-match'] === etag){
        res.writeHead(304, { 'ETag': etag, 'Cache-Control': htmlCache });
        return res.end();
      }
      const accepts = String(req.headers['accept-encoding'] || '').indexOf('gzip') !== -1;
      const head = { 'Content-Type':'text/html; charset=utf-8',
                     'Cache-Control': htmlCache, 'Vary':'Cookie',
                     'X-Content-Type-Options':'nosniff' };
      if (htmlCache !== PROD_HTML_CACHE) head['ETag'] = etag;
      if (accepts){ head['Content-Encoding'] = 'gzip'; res.writeHead(200, head); return res.end(gz); }
      res.writeHead(200, head); return res.end(html);
    }
    const f = path.join(ROOT, url.replace(/^\/+/, ''));
    if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()){
      res.writeHead(404); return res.end('nf');
    }
    /* Vercel serves /assets/* as static files with a long cache. */
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
                         'Cache-Control':'public, max-age=31536000, immutable' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url:'http://127.0.0.1:' + server.address().port + '/' })));
}

/* A plan in localStorage, so a repeat launch has real state to paint from --
   which is what a repeat launch actually has. */
function seededState(){
  const { loadApp } = require(path.join(ROOT, 'test', 'harness.js'));
  const { buildPlan, logAsPrescribed } = require(path.join(ROOT, 'test', 'fixtures.js'));
  const a = loadApp({ pinnedDate: '2026-08-27T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey:'half', volume:45, weeks:16,
                 startDate: a.addDays(a.todayStr(), -60),
                 schedule:{ activeDays:[1,2,3,5,6], longRunDay:6 } });
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach(d => logAsPrescribed(a, d));
  return { key: a.STORAGE_KEY, blob: JSON.stringify(a.state), days: a.state.days.length };
}
function seed(p){ try { localStorage.setItem(p.key, p.state); } catch (e) {} }

/* ONE CONTEXT, REUSED. A fresh Playwright context has a fresh HTTP cache, so
   measuring "repeat launch" in a new context measures a cold one -- which is
   what the first version of this harness did, and it reported no difference
   between cacheable and no-store because neither was ever given a warm cache
   to use. A repeat launch is the SAME profile opening the app again. */
async function measure(ctxOpts, url, seedState, label, throttle){
  const ctx = ctxOpts.ctx;
  const page = await ctx.newPage();
  await page.route('https://fonts.googleapis.com/**', r =>
    r.fulfill({ status:200, contentType:'text/css', body:'' }));
  if (throttle){
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline:false,
      latency: throttle.latency, downloadThroughput: throttle.down, uploadThroughput: throttle.up });
  }
  const transfer = { total:0, byUrl:{} };
  page.on('response', async (resp) => {
    try{
      const h = await resp.allHeaders();
      const len = Number(h['content-length'] || 0);
      const from = resp.request().timing().responseStart < 0 ? 'cache' : 'net';
      const key = new URL(resp.url()).pathname;
      transfer.byUrl[key] = { status: resp.status(), bytes: len, from };
      if (resp.status() !== 304) transfer.total += len;
    }catch(e){}
  });
  if (seedState) await page.addInitScript(seed, { key: seedState.key, state: seedState.blob });

  const t0 = Date.now();
  await page.goto(url, { waitUntil:'load' });
  const marks = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = {};
    performance.getEntriesByType('paint').forEach(p => { paints[p.name] = Math.round(p.startTime); });
    const app = document.getElementById('app');
    return {
      html: Math.round(nav.responseEnd || 0),
      domInteractive: Math.round(nav.domInteractive || 0),
      domComplete: Math.round(nav.domComplete || 0),
      fp: paints['first-paint'] || null,
      fcp: paints['first-contentful-paint'] || null,
      transferSize: nav.transferSize || 0,
      decoded: nav.decodedBodySize || 0,
      appHasContent: !!(app && app.innerHTML.length > 500),
      appChars: app ? app.innerHTML.length : 0
    };
  });
  const wall = Date.now() - t0;
  await page.close();
  return { label, wall, marks, transfer };
}

(async () => {
  const browser = await playwright.chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const st = seededState();
  console.log('Fixture: a real 16-week plan, ' + st.days + ' days, ' +
              Math.round(st.blob.length / 1024) + ' KB of localStorage\n');

  for (const variant of [
        { name:'PRODUCTION  (no-store)', cache: PROD_HTML_CACHE },
        { name:'CACHEABLE   (max-age=0 + ETag)', cache: ALT_HTML_CACHE }]){
    const { server, url } = await serve(variant.cache);
    console.log('=== ' + variant.name + ' ===');
    /* A persistent profile so the second load sees a warm HTTP cache -- which
       is what a repeat launch is. */
    const ctx = await browser.newContext({ viewport:{ width:390, height:900 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const ctxA = { ctx };
    const cold = await measure(ctxA, url, null, 'A cold first-ever');
    const repeat = await measure(ctxA, url, st, 'B repeat launch (warm cache)');
    const repeat2 = await measure(ctxA, url, st, 'D reopen again');
    const slow = await measure(ctxA, url, st, 'F slow 3G (warm cache)',
      { latency: 300, down: 400 * 1024 / 8, up: 400 * 1024 / 8 });

    [cold, repeat, repeat2, slow].forEach(r => {
      const m = r.marks;
      console.log('  ' + r.label.padEnd(32) +
        ' html=' + String(m.html).padStart(5) + 'ms' +
        ' fcp=' + String(m.fcp == null ? '-' : m.fcp).padStart(5) + 'ms' +
        ' interactive=' + String(m.domInteractive).padStart(5) + 'ms' +
        ' wall=' + String(r.wall).padStart(5) + 'ms' +
        ' transfer=' + String(Math.round(m.transferSize / 1024)).padStart(4) + 'KB' +
        ' content=' + (m.appHasContent ? 'yes' : 'NO'));
    });
    /* Which resources actually crossed the wire on the repeat launch. */
    console.log('  repeat-launch resources:');
    Object.keys(repeat.transfer.byUrl).forEach(k => {
      const v = repeat.transfer.byUrl[k];
      console.log('    ' + k.padEnd(42) + ' ' + v.status + '  ' +
        (v.bytes ? Math.round(v.bytes / 1024) + 'KB' : '-'));
    });
    console.log('');
    await ctx.close();
    server.close();
  }
  await browser.close();
})();
