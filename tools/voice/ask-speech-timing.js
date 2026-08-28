'use strict';
/* WHEN DOES THE COACH ACTUALLY START TALKING? BEFORE AND AFTER.
 * ===========================================================================
 * Drives the real client pipeline in Chromium against a server that streams
 * prose with REAL delays and a TTS endpoint with a REAL generation cost, and
 * records the four timings the brief asks for:
 *
 *     Ask -> first visible prose        Ask -> first audible speech
 *     first prose -> first speech       complete prose -> first speech
 *
 * BEFORE is produced by disabling the pipeline in the page, so it is this code
 * with the change off rather than a description of the old behaviour.
 *
 *   node tools/voice/ask-speech-timing.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');

/* A three-sentence answer, the shape the prompt asks the coach for. */
const SENTENCES = [
  'Nice easy one today, nine kilometres at a relaxed aerobic pace. ',
  'Keep it conversational the whole way and let the legs recover. ',
  'If the calf still grumbles on Thursday we will move that session.'
];
/* Paced to the observed live product: first prose at about three seconds, the
   whole answer at about seven. Without this the simulated model finishes in
   under a second and the BEFORE case looks far better than it is. */
const MODEL_TTFT_MS = 3000;
const PROSE_CHUNK_MS = 1300;    /* per sentence, so ~7s to finish all three */
const TTS_MS_PER_CHAR = 9;      /* generation cost, proportional to length */
const TTS_FLOOR_MS = 450;

function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
  const server = http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/api/voice-ask'){
      res.writeHead(200, { 'Content-Type':'application/x-ndjson', 'Cache-Control':'no-store' });
      await new Promise(r => setTimeout(r, MODEL_TTFT_MS));
      for (const s of SENTENCES){
        /* Delivered in small pieces, as a provider really delivers them. */
        for (let i = 0; i < s.length; i += 14){
          await new Promise(r => setTimeout(r, PROSE_CHUNK_MS / Math.ceil(s.length / 14)));
          res.write(JSON.stringify({ t:'prose', d: s.slice(i, i + 14) }) + '\n');
        }
      }
      res.write(JSON.stringify({ t:'final', complete:true, structured:true,
                                 needsPlanChange:false, changeReason:null }) + '\n');
      return res.end();
    }
    if (url === '/api/voice-tts'){
      let body = '';
      req.on('data', c => { body += c; });
      await new Promise(r => req.on('end', r));
      let text = '';
      try{ text = JSON.parse(body).text || ''; }catch(e){}
      /* Generation cost scales with the text, which is the whole reason a
         whole-answer request is slow and a one-sentence request is not. */
      await new Promise(r => setTimeout(r, TTS_FLOOR_MS + text.length * TTS_MS_PER_CHAR));
      res.writeHead(200, { 'Content-Type':'audio/mpeg' });
      return res.end(Buffer.alloc(2048));
    }
    if (url === '/' || url === '/index.html'){
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
      return res.end(html);
    }
    const f = path.join(ROOT, url.replace(/^\/+/, ''));
    if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()){
      res.writeHead(404); return res.end('nf');
    }
    res.writeHead(200); res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url:'http://127.0.0.1:' + server.address().port })));
}

(async () => {
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const rows = [];

  for (const early of [false, true]){
    const ctx = await browser.newContext({ viewport:{ width:390, height:900 }, isMobile:true });
    const page = await ctx.newPage();
    await page.route('https://fonts.googleapis.com/**', r =>
      r.fulfill({ status:200, contentType:'text/css', body:'' }));
    const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.goto(url, { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(600);

    const out = await page.evaluate(async (opts) => {
      const marks = { spoken: [], order: [] };
      const t0 = performance.now();
      const at = () => Math.round(performance.now() - t0);

      window.cloudSignedIn = () => true;
      window.cloudSession = { access_token:'t', expires_at: Math.floor(Date.now()/1000)+3600 };
      window.cloudRefreshIfNeeded = () => Promise.resolve(true);
      window.ttsCloudDown = false; window.ttsInflight = {};
      window.patchVoiceCard = () => {};
      window.coachVoice = () => 'molly';
      /* Audio that reports when it would actually be heard. */
      const RealAudio = window.Audio;
      window.Audio = function(u){
        const self = this;
        self.play = () => { if (marks.first == null) marks.first = at();
                            marks.order.push(at());
                            setTimeout(() => self.onended && self.onended(), 300);
                            return Promise.resolve(); };
        self.pause = () => {};
      };
      /* BEFORE: only the PIPELINE is off. Cloud TTS stays on, exactly as it
         was before this pass, so the baseline is one whole-answer generation
         after the answer finishes -- not "no speech at all", which is what
         disabling voiceCloudEligible() produced on the first run of this
         harness and made the comparison meaningless. */
      if (!opts.early) window.askSpeechStart = function(){ return null; };

      const realFeed = window.askSpeechFeed;
      const realSpeak = window.voiceCloudSpeak;
      window.voiceCloudSpeak = function(text, o){
        marks.spoken.push({ at: at(), chars: text.length, whole: true });
        return realSpeak.apply(this, arguments);
      };
      window.askSpeechEnqueue = (function(real){
        return function(p, text){ marks.spoken.push({ at: at(), chars: text.length });
                                  return real.apply(this, arguments); };
      })(window.askSpeechEnqueue);

      const realChunk = window.askStreamChunk;
      window.askStreamChunk = function(t){
        if (marks.firstProse == null) marks.firstProse = at();
        return realChunk.apply(this, arguments);
      };

      const resp = await fetch('/api/voice-ask', { method:'POST',
        headers:{ 'accept':'application/x-ndjson' }, body:'{}' });
      const d = await window.askReadStream(resp);
      marks.proseComplete = at();
      /* The real completion handler decides what speaks. */
      window.askSet('answered', { answer:d.answer, proposalDayId:null, incomplete:false });
      if (window.askSpeech){
        window.askSpeechFeed('', d.incomplete !== true);
      } else {
        window.voiceSpeak(window.voiceSpeakable(d.answer), { kind:'answer' });
      }
      await new Promise(r => setTimeout(r, 9000));
      return marks;
    }, { early });

    rows.push({ early, out, errors });
    await page.close(); await ctx.close();
  }
  await browser.close(); server.close();

  const fmt = (n) => (n == null ? '   —' : String(n).padStart(5) + 'ms');
  console.log('                                   BEFORE (whole answer)   AFTER (early units)');
  const b = rows[0].out, a = rows[1].out;
  const line = (label, x, y) => console.log('  ' + label.padEnd(32) + fmt(x).padStart(12) + '     ' + fmt(y).padStart(12));
  line('Ask -> first visible prose', b.firstProse, a.firstProse);
  line('Ask -> prose complete', b.proseComplete, a.proseComplete);
  line('Ask -> first audible speech', b.first, a.first);
  line('first prose -> first speech', b.first != null ? b.first - b.firstProse : null,
                                      a.first != null ? a.first - a.firstProse : null);
  line('prose complete -> first speech', b.first != null ? b.first - b.proseComplete : null,
                                         a.first != null ? a.first - a.proseComplete : null);
  console.log('\n  generation requests:');
  console.log('    before: ' + JSON.stringify(b.spoken.map(s => s.at + 'ms/' + s.chars + 'ch')));
  console.log('    after : ' + JSON.stringify(a.spoken.map(s => s.at + 'ms/' + s.chars + 'ch')));
  console.log('  playback starts (must ascend): before ' + JSON.stringify(b.order) +
              '  after ' + JSON.stringify(a.order));
  const ascending = (arr) => arr.every((v, i) => i === 0 || v >= arr[i - 1]);
  const problems = [];
  if (!ascending(a.order)) problems.push('speech played out of order');
  if (a.first == null) problems.push('nothing was ever spoken with the pipeline on');
  if (b.first != null && a.first != null && !(a.first < b.first)) problems.push('no improvement');
  rows.forEach(r => { if (r.errors.length) problems.push((r.early?'after':'before') + ': page errors'); });
  console.log('');
  if (problems.length){ console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('Speech now begins from the first stable sentence, in order, well before the ' +
                   'answer finishes generating.');
})();
