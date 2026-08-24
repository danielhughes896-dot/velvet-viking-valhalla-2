'use strict';
/* Renders every real state word THE READING's badges can show (pulled
   straight from BLOCK_META / EVOLUTION_META / responsePatternsSummary /
   the recovery map in readingSections()), not just whatever one fixture
   happens to produce -- so long words like "Responding" and multi-word
   phrases like "Ready to progress" get checked even when today's fixture
   doesn't land on that state.
   Run:  node tools/shots/reading-badges-vocab.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'reading-badges');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8' };

const WORDS = [
  // key, value, tone -- the exact strings the real META tables/functions produce
  ['readiness', '7%', null], ['readiness', '68%', null], ['readiness', '100%', null],
  ['recovery', 'Fresh', 'good'], ['recovery', 'Watch', 'watch'], ['recovery', 'Strained', 'bad'],
  ['evolution', 'On track', 'good'], ['evolution', 'Ready to progress', 'good'],
  ['evolution', 'Worth watching', 'watch'], ['evolution', 'A small evolution', 'watch'],
  ['evolution', 'Recovery first', 'bad'],
  ['patterns', '1 noted', null], ['patterns', '3 established', null], ['patterns', '2 emerging', null],
  ['patterns', 'Learning', null],
  ['adaptation', 'Learning', 'good'], ['adaptation', 'Responding', 'good'], ['adaptation', 'Adapting', 'good'],
  ['adaptation', 'Plateau', 'watch'], ['adaptation', 'Strained', 'bad'],
];

function serve(){
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const file = url === '/' ? 'protected/velvet-viking-valhalla.html' : url.replace(/^\//, '');
      const abs = path.join(ROOT, file);
      if (!abs.startsWith(ROOT) || !fs.existsSync(abs)){ res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'text/plain' });
      res.end(fs.readFileSync(abs));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2 });
    await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.readingDialHtml === 'function', { timeout: 20000 });

    const result = await page.evaluate(({ words, theme }) => {
      state.theme = theme; state.themeExplicit = true; applyThemeToDocument();
      const mount = document.createElement('div');
      mount.style.cssText = 'display:flex; flex-wrap:wrap; gap:20px; padding:20px; background:var(--bg); width:700px;';
      document.body.innerHTML = '';
      document.body.appendChild(mount);
      const problems = [];
      words.forEach(([key, value, tone]) => {
        const col = document.createElement('div');
        col.className = 'b-dial-col';
        col.innerHTML = window.readingDialHtml({ key, value, tone }, key === 'readiness') +
          '<span class="lbl">' + value + '</span>';
        mount.appendChild(col);
        const b = col.querySelector('.b-medal b');
        const medal = col.querySelector('.b-medal');
        const br_ = b.getBoundingClientRect(), mr = medal.getBoundingClientRect();
        if (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1)
          problems.push(key + '/"' + value + '": text is clipped inside its own box');
        if (br_.bottom > mr.bottom + 1 || br_.top < mr.top - 1)
          problems.push(key + '/"' + value + '": text overflows the medallion face vertically');
      });
      return { html: document.body.innerHTML, problems };
    }, { words: WORDS, theme });

    problems.push(...result.problems.map(p => theme + ': ' + p));
    await page.screenshot({ path: path.join(OUT, 'vocab.' + theme + '.png'), fullPage: true });
    await ctx.close();
  }
  await browser.close();
  server.close();

  console.log('=== ' + (problems.length ? problems.length + ' PROBLEM(S)' : 'no problems') + ' ===');
  problems.forEach(p => console.log('  ! ' + p));
  console.log('frames in ' + path.relative(ROOT, OUT));
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
