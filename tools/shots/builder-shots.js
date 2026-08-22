'use strict';
/* NINE-STAGE BUILDER — visual verification against the real implementation.
   Drives the shipped builder (not a mock) at the reference mobile viewport,
   walks all nine stages for all four block purposes in both themes, and
   MEASURES rather than trusting the frame:

     - does any stage inherently overflow 412x915?
     - are there nine rail segments, equal width?
     - what colour is the primary action, and what contrast does its label get?
     - does the dark accent still read as wine rather than rose?

   Run:  node tools/shots/builder-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'builder');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
               '.json':'application/json' };
const VW = 412, VH = 915;

function serve(){
  return new Promise(resolve => {
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

const srgb = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
const relL = ([r,g,b]) => 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b);
const CR = (a,b) => { const x=relL(a), y=relL(b); return +(((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05))).toFixed(2); };
const parse = s => (s.match(/\d+/g)||[]).slice(0,3).map(Number);
function hsl([r,g,b]){
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2, d=mx-mn;
  let h=0, s=0;
  if(d){ s = l>0.5 ? d/(2-mx-mn) : d/(mx+mn);
    h = mx===r ? ((g-b)/d+(g<b?6:0)) : mx===g ? ((b-r)/d+2) : ((r-g)/d+4); h*=60; }
  return [h, s, l];
}

const PURPOSES = ['race','maintain','base','speed'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const problems = [], notes = [];

  for (const theme of ['dark','light']){
    const ctx = await browser.newContext({ viewport:{width:VW,height:VH}, deviceScaleFactor:2 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:'+port+'/', { waitUntil:'load' });
    await page.waitForTimeout(2200);
    await page.evaluate(t => { try { setTheme(t); } catch(e) { document.documentElement.setAttribute('data-theme', t); } }, theme);
    await page.waitForTimeout(400);

    for (const purpose of PURPOSES){
      await page.evaluate(() => { try { closeModal(); } catch(e){} });
      await page.evaluate(() => openSetupModal());
      await page.waitForTimeout(350);
      // choose the purpose through the real control, so bldApplyPurpose runs
      await page.evaluate(p => {
        const btn = document.querySelector('.bld-purpose button[data-v="'+p+'"]');
        if (btn) btn.click();
      }, purpose);
      await page.waitForTimeout(350);

      for (let n = 0; n < 9; n++){
        await page.evaluate(i => bldStage(i), n);
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => {
          const card = document.querySelector('.modal-card');
          const segs = [...document.querySelectorAll('.bld-step')].map(s => +s.getBoundingClientRect().width.toFixed(1));
          const prim = document.querySelector('.bld-panel:not([hidden]) .btn-primary');
          const cs = prim && getComputedStyle(prim);
          const numeral = document.getElementById('bld-no');
          return {
            over: Math.max(0, card.scrollHeight - card.clientHeight),
            scrollH: card.scrollHeight, clientH: card.clientHeight,
            segs, segCount: segs.length,
            numeral: numeral ? numeral.textContent : '',
            primaryBg: cs ? cs.backgroundColor : null,
            primaryInk: cs ? cs.color : null,
            surface: getComputedStyle(card).backgroundColor,
          };
        });
        const tag = `${purpose}-${String(n+1).padStart(2,'0')}.${theme}`;
        if (purpose === 'race' || n <= 2 || n === 7)
          await page.screenshot({ path: path.join(OUT, tag + '.png') });

        if (m.segCount !== 9) problems.push(`${tag}: rail has ${m.segCount} segments`);
        if (new Set(m.segs).size > 1) problems.push(`${tag}: rail segments are uneven (${m.segs.join(',')})`);
        if (m.over > 0) problems.push(`${tag}: OVERFLOWS by ${m.over}px`);
        if (purpose === 'race' && (n === 6 || n === 8))
          notes.push(`${theme}: stage 0${n+1} ${m.over ? 'OVER by '+m.over+'px' : 'fits'} (content ${m.scrollH}px in ${m.clientH}px)`);
        if (m.numeral !== `0${n+1} / 09`) problems.push(`${tag}: numeral reads "${m.numeral}"`);

        if (n === 0 && purpose === 'race'){
          const bg = parse(m.primaryBg), ink = parse(m.primaryInk), sur = parse(m.surface);
          const [h,s,l] = hsl(bg);
          notes.push(`${theme}: primary ${m.primaryBg}  hue ${h.toFixed(1)}  sat ${(s*100).toFixed(1)}%  light ${(l*100).toFixed(1)}%`);
          notes.push(`${theme}:   label ${CR(bg,ink)}:1   against the sheet ${CR(bg,sur)}:1   rail segment ${m.segs[0]}px`);
          if (theme === 'dark' && l > 0.38) problems.push(`dark primary is ${(l*100).toFixed(1)}% light — that is rose, not lacquer`);
          if (CR(bg,ink) < 4.5) problems.push(`${theme}: primary label only ${CR(bg,ink)}:1`);
        }
      }
    }
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log('=== MEASURED ===');
  notes.forEach(n => console.log('  ' + n));
  console.log('\n=== PROBLEMS ===');
  if (!problems.length) console.log('  none — all 9 stages fit at 412x915 for all four purposes, both themes');
  else problems.forEach(p => console.log('  ' + p));
  console.log('\nshots: ' + OUT);
})();
