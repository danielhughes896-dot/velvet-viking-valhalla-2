'use strict';
/* THE COMMERCIAL JOURNEY, AT THE WIDTHS AN ATHLETE ACTUALLY HOLDS.
 * ===========================================================================
 * Settings -> Subscription in every state the launch produces, at 360, 390 and
 * 430, in both themes. What is real: the state, the entitlement shape the
 * server would return, and the card the runtime renders from it. Nothing is
 * mocked below the payload -- the card is the shipped function.
 *
 *   node tools/shots/commercial-launch-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-commercial-launch');
const WIDTHS = [360, 390, 430];

const STATES = {
  'no-entitlement': { access:false, reason:'no_entitlement', state:null, override:null },
  'trialing':       { access:true, reason:'subscription_trial', state:'trial',
                      access_until:'2026-09-14T00:00:00Z', manageable_here:true },
  'active':         { access:true, reason:'subscription_active', state:'active',
                      access_until:'2026-09-29T00:00:00Z', manageable_here:true },
  'ended':          { access:false, reason:'expired', state:'expired',
                      access_until:'2026-08-01T00:00:00Z' },
  'retired-beta':   { access:false, reason:'expired', state:'expired', override:'beta' },
  'owner':          { access:true, reason:'override_owner', state:'expired', override:'owner' }
};

/* A REAL STATIC SERVER, not "the runtime for every path". The first version
   answered /assets/builder-spec.js with the HTML document, so the page threw
   "Unexpected token '<'" and BUILDER_SPEC was never defined -- and every shot
   was of a page that had not finished booting, reported as a successful
   capture. The counts in the output exist because of that. */
const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json',
               '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2',
               '.html':'text/html; charset=utf-8' };
function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html'){
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    const file = path.join(ROOT, url.replace(/^\/+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const notes = [];

  for (const [name, info] of Object.entries(STATES)){
    for (const width of WIDTHS){
      for (const theme of ['light', 'dark']){
        const ctx = await browser.newContext({ viewport: { width, height: 900 },
          deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        await page.route('https://fonts.googleapis.com/**', r =>
          r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);

        const read = await page.evaluate((payload) => {
          document.documentElement.setAttribute('data-theme', payload.theme);
          window.cloudSession = { access_token:'t', user_id:'u', email:'a@b.test' };
          window.entitlementInfo = Object.assign({ signed_in:true, commercial_required:true,
            checkout_configured:true, capabilities:[] }, payload.info);
          const host = document.createElement('div');
          host.id = 'shot-host';
          host.style.cssText = 'padding:16px;';
          host.innerHTML = window.renderSubscriptionCard();
          document.body.innerHTML = '';
          document.body.appendChild(host);
          const t = (s) => (document.querySelector(s) || {}).textContent || null;
          return {
            pill: t('.sub-pill'),
            line: t('.sub-line'),
            buy: !!document.querySelector('[data-action="subscription-resubscribe"]'),
            manage: !!document.querySelector('[data-action="subscription-manage"]'),
            prices: !!document.querySelector('.sub-offers'),
            beta: /beta/i.test(host.textContent || ''),
            preLaunch: /not open yet|aren.t switched on|not charging/i.test(host.textContent || '')
          };
        }, { info, theme });

        const el = await page.$('#subscription-card');
        const file = path.join(OUT, `${name}-${width}-${theme}.png`);
        if (el) await el.screenshot({ path: file });
        else await page.screenshot({ path: file });
        notes.push(Object.assign({ state: name, width, theme, errors }, read));
        await ctx.close();
      }
    }
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'notes.json'), JSON.stringify(notes, null, 2));
  notes.filter(n => n.theme === 'light' && n.width === 390).forEach(n => console.log(
    n.state.padEnd(16), 'buy=' + (n.buy ? 'Y' : 'n'), 'manage=' + (n.manage ? 'Y' : 'n'),
    'prices=' + (n.prices ? 'Y' : 'n'), 'beta=' + (n.beta ? 'Y' : 'n'),
    'preLaunch=' + (n.preLaunch ? 'Y' : 'n'), 'errs=' + n.errors.length, '|', n.line || '-'));
  const bad = notes.filter(n => n.beta || n.preLaunch || n.errors.length);
  console.log('\n' + notes.length + ' shots, ' + bad.length + ' with beta/pre-launch copy or errors');
  console.log('wrote ' + OUT);
})();
