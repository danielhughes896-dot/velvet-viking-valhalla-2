'use strict';
/* FINAL REMEDIATION PASS -- LIVE VISUAL/RUNTIME SWEEP.
   Corrects a real bug found in capture.js: seeding state.view in the stored
   plan blob does NOT control the initial route (init() always opens on
   Today), so every "week"/"full"/"planhq" frame that tool produced actually
   photographed Today. This script navigates by clicking the real bottom-nav
   buttons instead, then adds Builder Review, Edit Session and a malformed-
   backup rejection, none of which the existing tools captured.
   Run: node tools/shots/final-sweep.js [outDir] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { SCENARIOS, serialise } = require('./states.js');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'final-sweep');
const WIDTHS = [360, 390, 430];
const THEMES = ['light', 'dark'];
const VIEWS = ['today', 'week', 'full', 'planhq', 'settings'];

const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json',
               '.html':'text/html; charset=utf-8', '.js':'text/javascript' };
function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html'){ res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(html); }
    const file = path.join(ROOT, url.replace(/^\/+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, url: 'http://127.0.0.1:'+server.address().port+'/'})));
}
function seed(p){
  try{ localStorage.setItem(p.key, p.state); }catch(e){}
  try{ localStorage.setItem('vvv_theme', JSON.stringify({theme:p.theme, explicit:true})); }catch(e){}
}

async function newPage(browser, width, theme){
  const ctx = await browser.newContext({ viewport:{width, height:1000}, deviceScaleFactor:2,
    isMobile:true, hasTouch:true, colorScheme:theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  return { ctx, page, errors };
}
async function measure(page){
  return page.evaluate(() => {
    const de = document.documentElement;
    const out = { scrollW: de.scrollWidth, clientW: de.clientWidth, overflowing: [] };
    if (out.scrollW > out.clientW + 1){
      const all = document.querySelectorAll('*');
      for (let i=0; i<all.length && out.overflowing.length<6; i++){
        const r = all[i].getBoundingClientRect();
        if (r.width>0 && (r.right>out.clientW+1 || r.left<-1))
          out.overflowing.push((all[i].tagName+'.'+(all[i].className||'')).slice(0,60)+' @'+Math.round(r.right));
      }
    }
    return out;
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({
    executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-device-scale-factor=2'],
  });
  const results = [];
  const scenarios = Object.keys(SCENARIOS).map(k => ({ key:k, s: serialise(SCENARIOS[k]()) }));

  // ---- 1. CORE VIEWS, PROPERLY NAVIGATED ----
  for (const { key, s } of scenarios){
    const widths = key === 'race' ? WIDTHS : [390];
    for (const width of widths){
      for (const theme of THEMES){
        for (const view of VIEWS){
          const name = [key, view, theme, width].join('-');
          try{
            const { ctx, page, errors } = await newPage(browser, width, theme);
            await page.addInitScript(seed, { key: s.storageKey,
              state: JSON.stringify(Object.assign({}, s.state, { theme, themeExplicit: true })), theme });
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(350);
            if (view !== 'today'){
              await page.click('.bn-item[data-view="'+view+'"]');
              await page.waitForTimeout(350);
            }
            if (view === 'week' || view === 'full'){
              const heads = await page.$$('.week-head, .day-top');
              if (heads[0]) { await heads[0].click(); await page.waitForTimeout(300); }
            }
            await page.screenshot({ path: path.join(OUT, name+'.png'), fullPage:true });
            const metrics = await measure(page);
            results.push({ name, errors, metrics });
            await ctx.close();
          }catch(e){ results.push({ name, errors:['CAPTURE FAILED: '+e.message], metrics:{} }); }
        }
      }
    }
  }

  // ---- 2. BUILDER REVIEW (stepping all the way to the final stage) ----
  for (const theme of THEMES){
    try{
      const { ctx, page, errors } = await newPage(browser, 390, theme);
      await page.addInitScript((t) => { try{ localStorage.setItem('vvv_theme', JSON.stringify({theme:t, explicit:true})); }catch(e){} }, theme);
      await page.goto(url, { waitUntil:'domcontentloaded' });
      await page.waitForTimeout(350);
      await page.click('[data-action="open-setup"]');
      await page.waitForTimeout(300);
      // Stage 0 is a pure Overview screen (no purpose selector yet) --
      // advance past it before waiting for .bld-purpose-card.
      const overviewNext = await page.$('[data-action="bld-next"]');
      if (overviewNext) { await overviewNext.click(); await page.waitForTimeout(300); }
      await page.waitForSelector('.bld-purpose-card[data-v="race"]', { state:'visible', timeout:8000 });
      await page.waitForTimeout(200);
      await page.click('.bld-purpose-card[data-v="race"]');
      await page.waitForTimeout(300);
      for (let i=0;i<9;i++){
        const nextBtn = await page.$('[data-action="bld-next"]:visible, [data-action="bld-next"]');
        if (!nextBtn) break;
        await page.evaluate(() => {
          const dist = document.querySelector('.opt-grid[data-mirror="su-distance"] button');
          if (dist && !document.querySelector('.opt-grid[data-mirror="su-distance"] button.active')) dist.click();
          const vol = document.getElementById('su-volume'); if (vol && !vol.value) vol.value = '40';
          const wd = document.querySelectorAll('#su-weekdays input[type=checkbox]');
          if (wd.length && ![...wd].some(c=>c.checked)) [1,2,3,5,6].forEach(i2=>{ if(wd[i2]) wd[i2].checked = true; });
          const bt = document.getElementById('su-bench-time'); if (bt && !bt.value) bt.value = '45:00';
          const goalA = document.getElementById('su-goal-A'); if (goalA && !goalA.value) goalA.value = '1:40:00';
          const rd = document.getElementById('su-racedate');
          if (rd && !rd.value){ const d=new Date(); d.setMonth(d.getMonth()+4); rd.value = d.toISOString().slice(0,10); }
        });
        await page.waitForTimeout(150);
        try{ await nextBtn.click({ timeout: 2000 }); }catch(e){ break; }
        await page.waitForTimeout(250);
      }
      await page.waitForSelector('#bld-review', { timeout: 5000 }).catch(()=>{});
      await page.waitForTimeout(300);
      const name = ['builder-review', theme].join('-');
      await page.screenshot({ path: path.join(OUT, name+'.png'), fullPage:true });
      results.push({ name, errors, metrics: await measure(page) });
      await ctx.close();
    }catch(e){ results.push({ name: 'builder-review-'+theme, errors:['CAPTURE FAILED: '+e.message], metrics:{} }); }
  }

  // ---- 3. EDIT SESSION (edited-session state) ----
  for (const theme of THEMES){
    try{
      const s = scenarios.find(x => x.key==='race').s;
      const { ctx, page, errors } = await newPage(browser, 390, theme);
      await page.addInitScript(seed, { key: s.storageKey, state: JSON.stringify(Object.assign({}, s.state, { theme, themeExplicit: true })), theme });
      await page.goto(url, { waitUntil:'domcontentloaded' });
      await page.waitForTimeout(350);
      const editBtn = await page.$('[data-action="open-edit"]');
      if (editBtn){
        await editBtn.click();
        await page.waitForTimeout(400);
        const name = ['edit-session', theme].join('-');
        await page.screenshot({ path: path.join(OUT, name+'.png'), fullPage:true });
        results.push({ name, errors, metrics: await measure(page) });
      } else {
        results.push({ name: 'edit-session-'+theme, errors: ['no [data-action="open-edit"] found on Today'], metrics:{} });
      }
      await ctx.close();
    }catch(e){ results.push({ name: 'edit-session-'+theme, errors:['CAPTURE FAILED: '+e.message], metrics:{} }); }
  }

  // ---- 4. MALFORMED-BACKUP REJECTION ----
  for (const theme of THEMES){
    try{
      const s = scenarios.find(x => x.key==='race').s;
      const { ctx, page, errors } = await newPage(browser, 390, theme);
      await page.addInitScript(seed, { key: s.storageKey, state: JSON.stringify(Object.assign({}, s.state, { theme, themeExplicit: true })), theme });
      await page.goto(url, { waitUntil:'domcontentloaded' });
      await page.waitForTimeout(350);
      await page.click('.bn-item[data-view="settings"]');
      await page.waitForTimeout(350);
      const pasteToggle = await page.$('[data-action="show-paste-restore"], [data-action="paste-restore"]');
      if (pasteToggle) { await pasteToggle.click(); await page.waitForTimeout(250); }
      const textarea = await page.$('#restore-paste-text, textarea[id*="paste"]');
      if (textarea){
        await textarea.fill('{"not":"a real backup", "days": ["nope"]}');
        const restoreBtn = await page.$('[data-action="restore-pasted"]');
        if (restoreBtn){ await restoreBtn.click(); await page.waitForTimeout(400); }
      }
      const name = ['malformed-backup', theme].join('-');
      await page.screenshot({ path: path.join(OUT, name+'.png'), fullPage:true });
      results.push({ name, errors, metrics: await measure(page),
        note: textarea ? undefined : 'paste-restore textarea not found by these selectors' });
      await ctx.close();
    }catch(e){ results.push({ name: 'malformed-backup-'+theme, errors:['CAPTURE FAILED: '+e.message], metrics:{} }); }
  }

  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 1));
  console.log('captured ' + results.length + ' frames into ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
