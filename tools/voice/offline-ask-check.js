'use strict';
/* DOES ASK COACH ANSWER IN AIRPLANE MODE? IN A REAL BROWSER, WITH A REAL DEAD
 * NETWORK.
 * ===========================================================================
 * The unit suite proves the branching with a stubbed fetch. It cannot prove
 * that a browser whose network is genuinely gone reaches the local reader
 * rather than hanging, because a stubbed rejection is not the same object a
 * real failed connection produces -- and the whole classification rests on
 * exactly that object.
 *
 * THE SERVER IS SHUT DOWN, not marked offline. Playwright's setOffline does
 * not reach a service worker's own fetch() in this Chromium, and the offline
 * startup harness was misled by that once already. Closing the socket is the
 * only unambiguous test.
 *
 *   node tools/voice/offline-ask-check.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const appMod = require(path.join(ROOT, 'api', 'app.js'));
const RUNTIME = fs.readFileSync(appMod.RUNTIME_FILE);
const MIME = { '.png':'image/png','.js':'text/javascript','.css':'text/css','.json':'application/json' };

function serve(state){
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/api/voice-ask'){
      /* The configuration fault the athlete must NOT be told is a signal
         problem. Served only when the run asks for it. */
      if (state.askStatus === 503){
        res.writeHead(503, { 'Content-Type':'application/json' });
        return res.end(JSON.stringify({ error:'voice_not_configured', code:'VOICE_NOT_CONFIGURED' }));
      }
      res.writeHead(200, { 'Content-Type':'application/json' });
      return res.end(JSON.stringify({ answer:'Cloud coaching.', needsPlanChange:false, complete:true }));
    }
    if (url === '/sw.js'){
      res.writeHead(200, { 'Content-Type':'text/javascript', 'Cache-Control':'no-cache' });
      return res.end(fs.readFileSync(path.join(ROOT, 'sw.js')));
    }
    if (url === '/' || url === '/index.html'){
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

function seeded(){
  const { loadApp } = require(path.join(ROOT, 'test', 'harness.js'));
  const { buildPlan, logAsPrescribed } = require(path.join(ROOT, 'test', 'fixtures.js'));
  /* ANCHORED TO THE REAL CLOCK, and every weekday active. The page runs on the
     browser's own date, not a pinned one, so a plan seeded around a fixed day
     lands wherever the calendar happens to be -- and the first run of this
     harness put a REST day under "today", which answers "what pace?" with "I
     don't have that on the device". Perfectly correct, and it proved nothing
     about the three intents it was supposed to exercise. */
  const today = new Date().toISOString().slice(0, 10);
  const a = loadApp({ pinnedDate: today + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey:'half', volume:45, weeks:16,
                 startDate: a.addDays(a.todayStr(), -60),
                 schedule:{ activeDays:[0,1,2,3,4,5,6], longRunDay:6 } });
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach(d => logAsPrescribed(a, d));
  a.state.ownerUid = 'user-A';
  return { key: a.STORAGE_KEY, blob: JSON.stringify(a.state) };
}

/* Ask a question through the real askSend() and report what the athlete would
   see. Only the entitlement facts are stubbed -- the coach being switched on,
   and a session token. The network is not stubbed at all, which is the point. */
async function askIn(page, question){
  return page.evaluate(async (q) => {
    voiceCoachAvailable = true;
    if (!cloudSignedIn()){
      cloudSession = { access_token:'t', refresh_token:'r',
                       expires_at: Date.now() + 3600000, user_id:'user-A', email:'a@b.c' };
    }
    const t0 = Date.now();
    let threw = null;
    try { await askSend(q); } catch(e){ threw = String(e && e.message || e); }
    const panel = renderAskPanel(findDayByDate(todayStr())) || '';
    return {
      ms: Date.now() - t0,
      status: askState.status,
      source: askState.source,
      answer: String(askState.answer || '').slice(0, 150),
      message: String(askState.message || ''),
      note: panel.indexOf('Offline guidance') !== -1,
      errorBox: panel.indexOf('ask-error') !== -1,
      proposal: askState.proposalDayId,
      threw: threw,
      onLine: navigator.onLine
    };
  }, question);
}

async function open(ctx, url){
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e && e.message || e)));
  try{
    await page.goto(url, { waitUntil:'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => {
      const app = document.getElementById('app');
      return !!(app && (app.innerText || '').length > 200);
    }, { timeout: 8000 });
  }catch(e){}
  return { page, errs };
}

function line(label, r){
  console.log('  ' + label.padEnd(34) +
    'status=' + String(r.status).padEnd(9) +
    ' source=' + String(r.source).padEnd(14) +
    ' note=' + (r.note ? 'yes' : 'no ') +
    ' errorBox=' + (r.errorBox ? 'YES' : 'no ') +
    ' ' + r.ms + 'ms');
  console.log('      ' + (r.answer || r.message || '(nothing)'));
  if (r.threw) console.log('      THREW: ' + r.threw);
}

(async () => {
  const st = seeded();
  const state = { askStatus: 200 };
  const { server, url } = await serve(state);
  const dir = '/tmp/vvv-offline-ask-' + Date.now();
  const ctx = await playwright.chromium.launchPersistentContext(dir, {
    executablePath:'/opt/pw-browsers/chromium', viewport:{ width:390, height:900 }, isMobile:true });
  await ctx.addInitScript(p => { try{ localStorage.setItem(p.key, p.state); }catch(e){} },
                          { key: st.key, state: st.blob });
  const problems = [];

  console.log('\n=== 1. ONLINE — the full coach, unchanged ===');
  let o = await open(ctx, url);
  const online = await askIn(o.page, 'How am I progressing?');
  line('online', online);
  if (online.source === 'offline-local') problems.push('online request fell back to the local reader');
  if (online.status !== 'answered') problems.push('the cloud path did not answer while online');
  await o.page.close();

  console.log('\n=== 2. CONFIGURATION FAULT — must NOT become offline guidance ===');
  state.askStatus = 503;
  o = await open(ctx, url);
  const cfg = await askIn(o.page, 'What am I doing today?');
  line('server up, coach not configured', cfg);
  if (cfg.source === 'offline-local') problems.push('a 503 configuration fault was disguised as offline guidance');
  if (cfg.status !== 'error') problems.push('a configuration fault did not surface as an error');
  await o.page.close();
  state.askStatus = 200;

  /* A controlled launch, so the worker holds the shell before the socket closes. */
  o = await open(ctx, url); await o.page.close();
  await new Promise(r => setTimeout(r, 1200));

  console.log('\n=== 3. AIRPLANE MODE — server socket closed ===');
  await new Promise(r => server.close(r));
  await ctx.setOffline(true);
  o = await open(ctx, url);
  if (o.errs.length) console.log('  page errors on offline load: ' + o.errs.join(' | '));
  const asks = [
    ['what am I doing today?',      'today'],
    ['what pace should I run?',     'pace'],
    ['what are the intervals?',     'steps'],
    ['why am I doing this session?','purpose'],
    ["what's tomorrow's session?",  'next'],
    ['what phase am I in?',         'phase'],
    ['my knee hurts, should I run?','health'],
    ['has my Strava run synced?',   'strava'],
    ['who won the 1996 olympics?',  'unsupported']
  ];
  for (const [q, label] of asks){
    const r = await askIn(o.page, q);
    line(label, r);
    if (r.status !== 'answered') problems.push(label + ': offline question did not produce an answer');
    if (r.source !== 'offline-local') problems.push(label + ': offline answer was not marked local');
    if (!r.note) problems.push(label + ': the athlete was not told this was offline guidance');
    if (r.errorBox) problems.push(label + ': the card rendered as an error state');
    if (r.proposal) problems.push(label + ': an offline answer carried a plan proposal');
    if (r.ms > 4000) problems.push(label + ': took ' + r.ms + 'ms — the athlete waited on a doomed request');
  }
  await o.page.close();
  await ctx.close();

  console.log('\n=== VERDICT ===');
  if (!problems.length) console.log('  no problems found');
  else problems.forEach(p => console.log('  PROBLEM: ' + p));
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
