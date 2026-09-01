'use strict';
/* THE TWO MARATHON OFFERS — VISUAL PROOF. READ-ONLY.
 * ===========================================================================
 * Renders the real modal HTML, from the real functions, inside the app's own
 * stylesheet, at the mobile widths the product is used at, in both themes.
 * Nothing here is a mock.
 *
 * node test/audit/marathonOfferShots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { loadApp, RUNTIME_RELATIVE } = require(path.join(__dirname, '..', 'harness.js'));

const OUT = process.argv[2] || path.join(__dirname, 'out', 'marathon-offers');
fs.mkdirSync(OUT, { recursive: true });
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', RUNTIME_RELATIVE), 'utf8');
const CSS = (SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || [])
  .map(b => b.replace(/^<style[^>]*>/, '').replace(/<\/style>$/, '')).join('\n');

const a = loadApp({ pinnedDate: '2026-08-30T09:00:00Z' });
a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
a.state = a.makeDefaultState();

const runway = a.runwayOfferHtml(a.marathonRunwayPlan(24, 40), 'full');
const expand = a.availabilityOfferHtml({
  why: a.EXPANSION_REASONS.LONG_RUN_LOAD_DISTRIBUTION,
  contains: 'It would be an easy aerobic run, not another hard session.',
  enables: 'It spreads the same running across one more day. If your training keeps absorbing it, '
         + 'that is what later lets the weekly work and the long run develop — but nothing gets '
         + 'bigger just because you said yes.',
  day: 2
});

function page(inner, theme){
  /* body.app is what the product mounts on, and it matters: .modal-themed
     un-pins its colours to `inherit`, so a card rendered on a bare document
     resolves them against nothing and comes out grey-on-grey. Same shell as
     the other shot harnesses, for the same reason. */
  return '<!doctype html><html lang="en" data-theme="' + theme + '"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + CSS + '</style><style>body{margin:0;}</style></head>' +
    '<body class="app"><div class="modal-overlay" id="modal-overlay">' +
    '<div class="modal-card modal-themed">' + inner + '</div></div></body></html>';
}

(async () => {
  /* The session's pre-installed Chromium. The pinned playwright-core wants a
     build number this image does not carry, so the executable is named
     explicitly rather than downloaded. */
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const shots = [];
  /* A CONTROL. An existing themed modal, rendered through the identical
     harness, so "does the new modal look right" is answered against the
     product's own baseline rather than against an impression. */
  let control = '';
  try { control = a.openSettingsModal && '' ; } catch(e){}
  const controlHtml = '<div class="modal-head"><h2 class="font-head">Existing themed modal</h2>'+
    '<button type="button" class="icon-btn" data-action="close-modal">x</button></div>'+
    '<div class="modal-body"><p>Body copy in an existing themed modal.</p>'+
    '<div class="yr-choices"><button type="button" class="btn btn-primary btn-block">Primary</button>'+
    '<button type="button" class="btn btn-ghost btn-block">Ghost</button></div>'+
    '<div class="yr-foot">Footer note.</div></div>';
  for (const [name, html] of [['runway-offer', runway], ['availability-offer', expand],
                              ['control-existing', controlHtml]])
    for (const theme of ['light', 'dark'])
      for (const width of [360, 390, 430]) {
        const p = await browser.newPage({ viewport: { width, height: 900 },
                                          deviceScaleFactor: 2 });
        await p.setContent(page(html, theme), { waitUntil: 'load' });
        /* THE ONE THING A SCREENSHOT CANNOT BE TRUSTED TO SHOW: whether the
           page is scrolling sideways. Measured rather than looked at. */
        const overflow = await p.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const clipped = await p.evaluate(() => {
          const els = Array.from(document.querySelectorAll('.modal-card *'));
          return els.filter(e => e.scrollWidth > e.clientWidth + 1)
                    .map(e => e.className || e.tagName).slice(0, 5);
        });
        const file = path.join(OUT, name + '-' + theme + '-' + width + '.png');
        await p.screenshot({ path: file, fullPage: true });
        shots.push({ name, theme, width, overflow, clipped });
        await p.close();
      }
  await browser.close();
  let bad = 0;
  shots.forEach(s => {
    const ok = s.overflow <= 0 && s.clipped.length === 0;
    if (!ok) bad++;
    console.log((ok ? '  ok   ' : '  BAD  ') + s.name.padEnd(20) + s.theme.padEnd(7) +
      String(s.width).padStart(4) + 'px   h-overflow ' + s.overflow +
      (s.clipped.length ? '   clipped: ' + s.clipped.join(', ') : ''));
  });
  console.log('\n  ' + shots.length + ' renders, ' + bad + ' with horizontal overflow or clipping.');
  console.log('  images: ' + OUT);
})();
