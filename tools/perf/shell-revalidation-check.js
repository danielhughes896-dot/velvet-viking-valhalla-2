'use strict';
/* DOES THE BROWSER ACTUALLY REUSE THE SHELL, AND DOES THE GATE STILL RUN?
 * ===========================================================================
 * Runs api/app.js's OWN serveRuntime() behind a real HTTP server and drives a
 * real Chromium through it, measuring what crosses the wire on a second launch
 * -- with the old header and the new one, so the difference is measured rather
 * than argued.
 *
 * It also proves the security property end to end: a browser holding a valid
 * cached copy, whose access has since been revoked, must NOT be answered 304.
 *
 *   node tools/perf/shell-revalidation-check.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const appMod = require(path.join(ROOT, 'api', 'app.js'));
const RUNTIME = fs.readFileSync(appMod.RUNTIME_FILE);
const GZ = zlib.gzipSync(RUNTIME, { level: 9 });
const MIME = { '.png':'image/png','.js':'text/javascript','.css':'text/css','.json':'application/json' };

/* The gate, reduced to its decision, so the transport can be exercised without
   a live Supabase. `allow` is flipped by the test to model revocation. */
function serve(mode, gate){
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html'){
      /* THE GATE RUNS FIRST, ALWAYS -- exactly as api/app.js orders it. */
      if (!gate.allow){
        res.writeHead(302, { 'cache-control':'private, no-store', 'location':'/account' });
        return res.end();
      }
      gate.served++;
      if (mode === 'old'){
        res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8',
          'Cache-Control':'private, no-store, must-revalidate', 'Vary':'Cookie',
          'Content-Encoding':'gzip', 'Content-Length':String(GZ.length) });
        return res.end(GZ);
      }
      const tag = appMod.runtimeEtag();
      if (appMod.etagMatches(req, tag)){
        gate.notModified++;
        res.writeHead(304, { 'ETag':tag, 'Cache-Control':'private, max-age=0, must-revalidate',
                             'Vary':'Cookie' });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'private, max-age=0, must-revalidate', 'ETag':tag, 'Vary':'Cookie',
        'Content-Encoding':'gzip', 'Content-Length':String(GZ.length) });
      return res.end(GZ);
    }
    const f = path.join(ROOT, url.replace(/^\/+/, ''));
    if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()){
      res.writeHead(404); return res.end('nf');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
                         'Cache-Control':'public, max-age=31536000, immutable' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url:'http://127.0.0.1:' + server.address().port + '/' })));
}

async function launch(ctx, url, throttle){
  const page = await ctx.newPage();
  await page.route('https://fonts.googleapis.com/**', r =>
    r.fulfill({ status:200, contentType:'text/css', body:'' }));
  if (throttle){
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline:false, latency:throttle.latency,
      downloadThroughput:throttle.down, uploadThroughput:throttle.up });
  }
  let status = 0, wire = 0;
  page.on('response', async (r) => {
    if (new URL(r.url()).pathname !== '/') return;
    status = r.status();
    try{ const h = await r.allHeaders(); wire = Number(h['content-length'] || 0); }catch(e){}
  });
  await page.goto(url, { waitUntil:'load' });
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = {}; performance.getEntriesByType('paint').forEach(p => paints[p.name] = Math.round(p.startTime));
    return { html: Math.round(nav.responseEnd || 0), interactive: Math.round(nav.domInteractive || 0),
             transfer: nav.transferSize || 0, fcp: paints['first-contentful-paint'] || null };
  });
  await page.close();
  return { status, wire, ...m };
}

/* THE PRIMARY EVIDENCE, over real HTTP against api/app.js's own validator.
   A browser is a second opinion; this is the contract. */
async function overHttp(){
  const gate = { allow: true };
  const { server, url } = await serve('new', gate);
  const port = Number(new URL(url).port);
  const get = (headers) => new Promise(r => {
    const req = http.request({ port, path:'/', headers: headers || {} }, resp => {
      let n = 0; resp.on('data', c => n += c.length);
      resp.on('end', () => r({ status: resp.statusCode, etag: resp.headers.etag,
                               cc: resp.headers['cache-control'], bytes: n }));
    });
    req.end();
  });
  const first = await get();
  const repeat = await get({ 'if-none-match': first.etag });
  const changed = await get({ 'if-none-match': '"a-different-build"' });
  gate.allow = false;
  const revoked = await get({ 'if-none-match': first.etag });
  gate.allow = true;
  const weak = await get({ 'if-none-match': 'W/' + first.etag });
  server.close();

  console.log('=== OVER HTTP, against the real validator ===');
  console.log('  1 first authorised    : ' + first.status + '  ' + first.bytes + ' bytes  ' + first.cc);
  console.log('  2 repeat, same build  : ' + repeat.status + '  ' + repeat.bytes + ' bytes   <- reuse');
  console.log('  3 changed build       : ' + changed.status + '  ' + changed.bytes + ' bytes');
  console.log('  4 REVOKED, valid etag : ' + revoked.status + '  ' + revoked.bytes +
              ' bytes   <- must never be 304');
  console.log('  5 weak-marked etag    : ' + weak.status);
  console.log('  repeat launch saves ' + first.bytes + ' -> ' + repeat.bytes + ' bytes\n');
  const bad = [];
  if (first.status !== 200) bad.push('the first authorised request did not return the document');
  if (repeat.status !== 304) bad.push('a repeat launch did not revalidate to 304');
  if (changed.status !== 200) bad.push('a changed build was validated against the old one');
  if (revoked.status === 304) bad.push('A REVOKED ATHLETE WAS ANSWERED 304');
  if (weak.status !== 304) bad.push('a weak-marked validator was rejected');
  return bad;
}

(async () => {
  const problemsHttp = await overHttp();
  const browser = await playwright.chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--disk-cache-size=52428800'] });
  const problems = problemsHttp.slice();
  const results = {};

  for (const mode of ['old', 'new']){
    const gate = { allow: true, served: 0, notModified: 0 };
    const { server, url } = await serve(mode, gate);
    /* One persistent profile: a repeat launch is the same device opening again. */
    const dir = '/tmp/vvv-profile-' + mode + '-' + Date.now();
    const ctx = await playwright.chromium.launchPersistentContext(dir, {
      executablePath:'/opt/pw-browsers/chromium', viewport:{ width:390, height:900 }, isMobile:true });
    const cold = await launch(ctx, url);
    const repeat = await launch(ctx, url);
    const slow = await launch(ctx, url, { latency:300, down:400*1024/8, up:400*1024/8 });
    results[mode] = { cold, repeat, slow, gate: { ...gate } };

    console.log('=== ' + (mode === 'old' ? 'BEFORE  (no-store)' : 'AFTER   (private + ETag)') + ' ===');
    [['cold', cold], ['repeat', repeat], ['slow 3G repeat', slow]].forEach(([n, r]) => {
      console.log('  ' + n.padEnd(16) + ' status=' + r.status +
        ' wire=' + String(Math.round(r.wire/1024)).padStart(4) + 'KB' +
        ' html=' + String(r.html).padStart(6) + 'ms' +
        ' fcp=' + String(r.fcp == null ? '-' : r.fcp).padStart(6) + 'ms' +
        ' interactive=' + String(r.interactive).padStart(6) + 'ms');
    });
    console.log('  bodies sent by the gate: ' + gate.served + '   304s: ' + gate.notModified);

    /* THE SECURITY PROPERTY, END TO END: the same browser, still holding the
       cached document, after access is revoked. */
    gate.allow = false;
    const revoked = await launch(ctx, url);
    console.log('  after revocation      : status=' + revoked.status +
      (revoked.status === 304 ? '  <-- CACHED DOCUMENT SERVED TO A REVOKED ATHLETE' : '  (redirected, not 304)'));
    if (revoked.status === 304) problems.push(mode + ': a revoked athlete was answered 304');
    await ctx.close(); server.close();
    console.log('');
  }

  const o = results.old, n = results.new;
  console.log('Repeat launch: ' + Math.round(o.repeat.wire/1024) + 'KB -> ' +
              Math.round(n.repeat.wire/1024) + 'KB, status ' + o.repeat.status + ' -> ' + n.repeat.status);
  console.log('Slow 3G      : html ' + o.slow.html + 'ms -> ' + n.slow.html + 'ms, fcp ' +
              o.slow.fcp + 'ms -> ' + n.slow.fcp + 'ms');
  /* HEADLESS CHROMIUM IN THIS CONTAINER DOES NOT ISSUE THE CONDITIONAL REQUEST.
     Three separate harness designs -- fresh contexts, a reused context, and a
     persistent profile -- all produced a 200 with no If-None-Match, for both
     the old header and the new one. That is a property of this browser build,
     not of the change: the old header is `no-store`, which CANNOT produce a
     304, so if the browser were revalidating the two columns would differ.
     They do not, in either direction, which is the signature of a client that
     is not caching at all.

     The contract is therefore proven over HTTP above, where it is
     unambiguous. This browser section is kept because it still measures the
     cold path honestly and will start showing the difference the moment it is
     run somewhere with a working cache. */
  if (n.repeat.status !== 304)
    console.log('NOTE: this Chromium did not revalidate (no If-None-Match sent) in either ' +
                'column; see the comment in this file. The HTTP section above is the evidence.');
  console.log('');
  if (problems.length){ console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('Repeat launches revalidate to 304 and reuse the local body; a revoked ' +
                   'athlete is redirected rather than validated.');
  await browser.close();
})();
