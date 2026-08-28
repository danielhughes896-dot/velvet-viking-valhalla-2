'use strict';
/* ASK COACH STREAMING — END-TO-END, IN A REAL BROWSER, AGAINST REAL SERVER CODE.
 * ===========================================================================
 * Unit tests prove the protocol. They cannot prove the thing the pass is FOR:
 * that words reach the athlete before the model has finished, and that nothing
 * protocol-shaped ever flashes on screen while they do.
 *
 * So this runs the genuine server streaming path -- api/_voice-ask.js's
 * readStreamed(), the real SSE reader, the real prose state machine -- against
 * a fake upstream that emits Anthropic frames with REAL DELAYS, and drives the
 * genuine browser reader and renderer in Chromium.
 *
 * It measures what only a live run can: when the first character became
 * visible against when the turn ended, and every intermediate DOM snapshot,
 * checked for the marker, the trailer and the reasoning.
 *
 *   node tools/voice/ask-stream-check.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const askMod = require(path.join(ROOT, 'api', '_voice-ask.js'));
const PROTO = require(path.join(ROOT, 'api', '_voice-protocol.js'));
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');

const S = PROTO.SENTINEL;
const ANSWER = 'Keep tomorrow easy and see how the calf feels. If it is still sore ' +
               'on Thursday, we will move the session rather than push through it.';
const SECRET = 'REASONING_THAT_MUST_NEVER_BE_SEEN';

/* A thinking block FIRST, as this model really does emit, carrying text that
   must never appear. Then the answer, then the marker and trailer -- with the
   marker deliberately falling across chunk boundaries. */
function frames(scenario){
  const out = [
    { type:'message_start', message:{ id:'msg_test' } },
    { type:'content_block_start', index:0, content_block:{ type:'thinking' } },
    { type:'content_block_delta', index:0, delta:{ type:'thinking_delta', thinking:SECRET } },
    { type:'content_block_stop', index:0 },
    { type:'content_block_start', index:1, content_block:{ type:'text' } }
  ];
  const body = ANSWER + '\n' + S + '\n{"needsPlanChange":true,"changeReason":"Sore calf."}';
  const pieces = [];
  for (let i = 0; i < body.length; i += 11) pieces.push(body.slice(i, i + 11));
  pieces.forEach(p => out.push({ type:'content_block_delta', index:1,
                                 delta:{ type:'text_delta', text:p } }));
  if (scenario === 'truncated') return out.slice(0, 5 + Math.floor(pieces.length / 3));
  out.push({ type:'content_block_stop', index:1 });
  out.push({ type:'message_delta', delta:{ stop_reason:'end_turn' } });
  out.push({ type:'message_stop' });
  return out;
}

/* A fake upstream Response: a real ReadableStream delivering SSE frames with a
   real gap between them, so "before the model finished" is a measurement. */
function fakeUpstream(scenario, gapMs){
  const evs = frames(scenario);
  let i = 0;
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async pull(controller){
      if (i >= evs.length){ controller.close(); return; }
      const ev = evs[i++];
      await new Promise(r => setTimeout(r, gapMs));
      controller.enqueue(enc.encode('event: ' + ev.type + '\ndata: ' + JSON.stringify(ev) + '\n\n'));
    }
  });
  return { ok:true, status:200, body:body };
}

const MIME = { '.png':'image/png','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2',
               '.json':'application/json','.svg':'image/svg+xml' };
function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/api/voice-ask'){
      /* THE REAL SERVER PATH -- api/_voice-ask.js's own streamed reader,
         writing its own protocol. Not a re-implementation for the test. */
      const scenario = /truncated/.test(req.url) ? 'truncated' : 'clean';
      const opts = { receivedAt:Date.now(), upstreamAt:Date.now(),
                     headersAt:Date.now(), wantStream:true };
      try{ await askMod.readStreamed(res, fakeUpstream(scenario, 25), opts); }
      catch(e){ try{ res.end(); }catch(_){} }
      return;
    }
    if (url === '/' || url === '/index.html'){
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
      return res.end(html);
    }
    const file = path.join(ROOT, url.replace(/^\/+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); return res.end('nf');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url:'http://127.0.0.1:' + server.address().port })));
}

(async () => {
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const problems = [];

  for (const scenario of ['clean', 'truncated']){
    const ctx = await browser.newContext({ viewport:{ width:390, height:900 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:'dark' });
    const page = await ctx.newPage();
    await page.route('https://fonts.googleapis.com/**', r =>
      r.fulfill({ status:200, contentType:'text/css', body:'' }));
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.goto(url, { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(700);

    const result = await page.evaluate(async (args) => {
      const sc = args.sc, SENT = args.SENT, SECRET = args.SECRET;
      const host = document.createElement('div');
      host.id = 'ask-check-host';
      document.body.appendChild(host);
      const snaps = [];
      const t0 = performance.now();
      let firstVisibleAt = null;

      const paint = () => {
        host.innerHTML = window.renderAskPanel();
        const live = document.getElementById('ask-answer-live');
        if (live) live.textContent = window.askState.answer || '';
        snaps.push({ at: performance.now() - t0, text: host.innerText || '' });
      };
      const realChunk = window.askStreamChunk;
      window.patchVoiceCard = paint;
      window.askStreamChunk = function(t){
        realChunk(t);
        if (firstVisibleAt === null && window.askState.answer) firstVisibleAt = performance.now() - t0;
        paint();
      };

      const resp = await fetch('/api/voice-ask' + (sc === 'truncated' ? '?truncated=1' : ''), {
        method:'POST', headers:{ 'accept':'application/x-ndjson' }, body:'{}' });
      let out = null, threw = null;
      try{ out = await window.askReadStream(resp); }catch(e){ threw = e; }
      const completedAt = performance.now() - t0;

      if (out){
        window.askSet('answered', { answer: out.answer, incomplete: out.incomplete === true,
                                    proposalDayId: null });
        paint();
        window.askAnnounceAnswer(out.answer);
      }
      await new Promise(r => setTimeout(r, 150));
      const liveEl = document.getElementById('ask-answer-live');
      const announceEl = document.getElementById('ask-answer-announce');
      return {
        threw: threw ? String(threw.code || threw) : null,
        result: out,
        firstVisibleAt, completedAt,
        snapCount: snaps.length,
        snaps: snaps.map(s => ({ at: Math.round(s.at), len: s.text.length })),
        leakFrames: snaps.filter(s =>
          s.text.indexOf(SENT) !== -1 || s.text.indexOf('needsPlanChange') !== -1 ||
          s.text.indexOf(SECRET) !== -1 || /"type"\s*:\s*"text_delta"/.test(s.text)
        ).map(s => Math.round(s.at)),
        finalText: host.innerText || '',
        growingIsLive: !!(liveEl && (liveEl.getAttribute('aria-live') || liveEl.getAttribute('role'))),
        announcePresent: !!announceEl,
        announceText: announceEl ? announceEl.textContent : null,
        liveRegions: [...host.querySelectorAll('[aria-live]')].map(e => e.className || e.id)
      };
    }, { sc: scenario, SENT: S, SECRET: SECRET });

    const r = result;
    const growth = r.snaps.filter((s, i) => i === 0 || s.len > r.snaps[i - 1].len).length;
    console.log('--- ' + scenario + ' ---');
    console.log('  first visible char : ' + (r.firstVisibleAt == null ? 'never' : Math.round(r.firstVisibleAt) + 'ms'));
    console.log('  stream completed   : ' + Math.round(r.completedAt) + 'ms');
    console.log('  progressive paints : ' + growth + ' of ' + r.snapCount + ' snapshots grew the answer');
    console.log('  protocol leaks     : ' + (r.leakFrames.length ? 'AT ' + r.leakFrames.join(',') + 'ms' : 'none in any frame'));
    console.log('  growing node live? : ' + (r.growingIsLive ? 'YES' : 'no'));
    console.log('  live regions       : ' + JSON.stringify(r.liveRegions));
    console.log('  announced once     : ' + JSON.stringify(r.announceText && r.announceText.slice(0, 44)));
    console.log('  decision           : ' + JSON.stringify(r.result && {
      complete:r.result.complete, incomplete:r.result.incomplete,
      needsPlanChange:r.result.needsPlanChange }));
    console.log('  page errors        : ' + (errors.length ? errors.slice(0,2).join(' | ') : 'none'));

    if (errors.length) problems.push(scenario + ': page errors');
    if (r.leakFrames.length) problems.push(scenario + ': PROTOCOL LEAKED ON SCREEN');
    if (r.growingIsLive) problems.push(scenario + ': the growing answer is a live region');
    if (!r.announcePresent) problems.push(scenario + ': no announcement region');
    /* A CLEAN ANSWER HAS EXACTLY ONE LIVE REGION -- the announcement. A
       truncated one has two, and correctly so: the answer is announced, and so
       is the fact that it stopped early. Both change exactly once, which is the
       property that matters; the count on its own is not the invariant, and an
       earlier version of this check wrongly failed the truncated case for
       telling the athlete something true. */
    const wantRegions = scenario === 'truncated' ? 2 : 1;
    if (r.liveRegions.length !== wantRegions)
      problems.push(scenario + ': ' + r.liveRegions.length + ' live regions, expected ' + wantRegions);
    if (r.liveRegions.indexOf('ask-answer-live') !== -1)
      problems.push(scenario + ': the growing answer node is itself a live region');
    if (r.firstVisibleAt == null) problems.push(scenario + ': nothing ever became visible');
    else if (!(r.firstVisibleAt < r.completedAt * 0.6))
      problems.push(scenario + ': first text at ' + Math.round(r.firstVisibleAt) +
        'ms is not meaningfully before completion at ' + Math.round(r.completedAt) + 'ms');
    if (growth < 5) problems.push(scenario + ': the answer did not arrive progressively');
    if (scenario === 'clean'){
      if (!r.result || r.result.needsPlanChange !== true) problems.push('clean: the validated decision was lost');
      if (!r.announceText) problems.push('clean: the completed answer was never announced');
    }
    if (scenario === 'truncated'){
      if (!r.result || r.result.incomplete !== true) problems.push('truncated: not marked incomplete');
      if (r.result && r.result.needsPlanChange) problems.push('truncated: A PARTIAL STREAM PROPOSED A PLAN CHANGE');
      if (!/stopped early/i.test(r.finalText)) problems.push('truncated: the athlete is not told it stopped early');
    }
    await page.close(); await ctx.close();
  }

  await browser.close(); server.close();
  console.log('');
  if (problems.length){ console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('Prose arrives progressively and well before completion; no marker, trailer or ' +
                   'reasoning in any frame; one live region; a truncated stream proposes nothing.');
})();
