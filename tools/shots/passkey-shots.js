'use strict';
/* Visual evidence for the passkey work.
   ===========================================================================

   Captures every surface the feature touches, at mobile width, in BOTH themes,
   and in both worlds -- a device that can do passkeys and one that cannot --
   because "the email link is never taken away" is a claim about pixels as much
   as about code, and the second world is the one nobody looks at.

   Chromium, not a physical handset. What this cannot show is a real Face ID or
   Touch ID sheet: that is drawn by the operating system, over the page, and is
   deliberately not something this application recreates. Every frame here stops
   at the moment the platform prompt would appear.

   Run:  node tools/shots/passkey-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'passkey');
const WIDTH = 390, HEIGHT = 844;

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
               '.json':'application/json', '.ico':'image/x-icon' };

/* The real routes, reproduced from vercel.json, plus the one thing a static
   server cannot do: /api/app hands over the protected runtime. Nothing here is
   the delivery gate -- these frames are about what the sign-in surfaces LOOK
   like, and the gate has its own tests. */
const ROUTES = {
  '/': 'protected/velvet-viking-valhalla.html',
  '/account': 'account.html',
  '/start': 'start.html',
};

function serve(){
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      let file = ROUTES[url] || url.replace(/^\//, '');
      const abs = path.join(ROOT, file);
      if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()){
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
      res.end(fs.readFileSync(abs));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* Headless Chromium may or may not expose WebAuthn depending on build flags, and
   we need BOTH answers deterministically -- so the capability is forced rather
   than discovered. This stubs only the two capability checks; it never fakes a
   ceremony, because a fabricated authenticator response would be evidence of
   nothing. */
const FORCE_ON = `
  window.PublicKeyCredential = window.PublicKeyCredential || function(){};
  window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable =
    function(){ return Promise.resolve(true); };
  if (!navigator.credentials) Object.defineProperty(navigator, 'credentials', { value: {} });
  navigator.credentials.create = navigator.credentials.create || function(){ return new Promise(function(){}); };
  navigator.credentials.get    = navigator.credentials.get    || function(){ return new Promise(function(){}); };
`;
const FORCE_OFF = `
  try{ delete window.PublicKeyCredential; }catch(e){}
  Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
`;

async function shot(page, name){
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log((overflow ? 'OVERFLOW  ' : 'ok        ') + name + '  theme=' + theme);
  return { name, overflow, theme };
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const errors = [];

  for (const theme of ['light', 'dark']) {
    for (const [capLabel, capScript] of [['passkey', FORCE_ON], ['nopasskey', FORCE_OFF]]) {
      const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT },
                                             deviceScaleFactor: 2 });
      await ctx.addInitScript(capScript);
      /* The theme boot script in every shell reads this key before first paint,
         so it is seeded rather than toggled after the fact. */
      await ctx.addInitScript(`try{ localStorage.setItem('vvv_theme', JSON.stringify({theme:'${theme}'})); }catch(e){}`);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(theme + '/' + capLabel + ': ' + e.message));

      // --- the front door: /account, sign-in only, passkey primary
      await page.goto(base + '/account', { waitUntil: 'networkidle' });
      await page.waitForSelector('#pane-signin:not(.vvv-hidden)');
      results.push(await shot(page, `account-signin.${capLabel}.${theme}`));

      // --- /start, first-account route, passkey secondary
      await page.goto(base + '/start', { waitUntil: 'networkidle' });
      await page.waitForSelector('#pane-auth:not(.vvv-hidden)', { timeout: 15000 });
      results.push(await shot(page, `start-auth.${capLabel}.${theme}`));

      await ctx.close();
    }
  }

  /* ---- inside the app ----
     Four Settings states, all of which need a plan to exist before Settings is
     reachable at all. The plan is built through the app's own builder rather
     than injected, so these are frames of the real screen. */
  for (const theme of ['light', 'dark']) {
    for (const [capLabel, capScript] of [['passkey', FORCE_ON], ['nopasskey', FORCE_OFF]]) {
      for (const account of ['signed-out', 'no-passkey', 'has-passkey']) {
        const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT },
                                               deviceScaleFactor: 2 });
        await ctx.addInitScript(capScript);
        const session = account === 'signed-out' ? 'null' : JSON.stringify(JSON.stringify({
          access_token: 'shot-token', refresh_token: 'r',
          expires_at: Date.now() + 3600000, email: 'athlete@example.com', user_id: 'user-0001',
        }));
        await ctx.addInitScript(`
          try{
            localStorage.setItem('vvv_theme', JSON.stringify({theme:'${theme}'}));
            var s = ${session};
            if (s) localStorage.setItem('vvv_cloud_session', s);
          }catch(e){}
        `);
        /* Every network call is refused, so nothing here depends on a live
           Supabase. The passkey LIST is the one answer the frame is about, so
           it is the one thing answered -- from a fixture, not a server. */
        await ctx.route('**/*', (route) => {
          const url = route.request().url();
          if (url.startsWith(base)) return route.continue();
          if (url.indexOf('/auth/v1/passkeys') !== -1)
            return route.fulfill({ status: 200, contentType: 'application/json',
              body: account === 'has-passkey'
                ? JSON.stringify([{ id: 'pk-1', friendly_name: 'iPhone', created_at: '2026-08-01T10:00:00Z' }])
                : '[]' });
          return route.abort();
        });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(theme + '/' + capLabel + '/' + account + ': ' + e.message));

        await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });
        /* THE THEME LIVES IN THE PLAN, NOT ONLY IN THE MIRROR KEY. The boot
           script reads vvv_theme before first paint, but the app then re-applies
           whatever its own state says -- so seeding only the mirror produced
           byte-identical light and dark frames. */
        await page.evaluate((t) => {
          state.theme = t; state.themeExplicit = true; applyThemeToDocument();
        }, theme);
        /* A plan through the app's own generator, so Settings is reachable and
           the card renders in a real app state rather than an empty shell. */
        await page.evaluate(() => {
          const start = todayStr();
          const startMonday = addDays(start, -isoWeekday(start));
          const raceDate = addDays(startMonday, 10 * 7 - 1);
          const schedule = { activeDays: [1,2,3,5,6], longRunDay: 6 };
          const br = buildBlockWeeks('10k', 40, 10);
          state.days = buildDaysFromWeeks(br, raceDate, schedule, start, false);
          state.setup = { distanceKey:'10k', currentVolume:40, raceDate, hasEvent:false,
            startDate:start, planWeeks:br.planWeeks, schedule,
            benchmark:{ distanceKey:'10k', timeSec:2700 },
            goals:{ A:{ timeSec:2565 } }, activeGoal:'A', paceOverrides:{},
            lthr:null, maxHR:null, experience:'experienced' };
          state.view = 'settings';
          renderApp();
        });
        await page.waitForTimeout(600);
        results.push(await shot(page, `settings.${account}.${capLabel}.${theme}`));

        // The restore modal is the second signed-out sign-in surface.
        if (account === 'signed-out') {
          await page.evaluate(() => openRestoreModal());
          await page.waitForTimeout(250);
          results.push(await shot(page, `restore-modal.${capLabel}.${theme}`));
          await page.evaluate(() => closeModal());
        }
        // And the management sheet, which only exists when one is registered.
        if (account === 'has-passkey' && capLabel === 'passkey') {
          await page.evaluate(() => handlePasskeyManage());
          await page.waitForTimeout(250);
          results.push(await shot(page, `passkey-manage.${theme}`));
        }
        await ctx.close();
      }
    }
  }

  await browser.close();
  server.close();

  const bad = results.filter((r) => r.overflow);
  console.log('\n--- ' + results.length + ' frames ---');
  console.log('horizontal overflow : ' + bad.length + (bad.length ? ' -> ' + bad.map(r=>r.name).join(', ') : ''));
  console.log('uncaught page errors: ' + errors.length + (errors.length ? '\n  ' + errors.join('\n  ') : ''));
  const wrongTheme = results.filter((r) => r.theme !== r.name.split('.').pop());
  console.log('theme mismatches    : ' + wrongTheme.length +
    (wrongTheme.length ? ' -> ' + wrongTheme.map(r=>r.name+'='+r.theme).join(', ') : ''));
}

main().catch((e) => { console.error(e); process.exit(1); });
