'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* THE CARDS MOVE SMOOTHLY.

   Founder: "I'm not sure the transitions on the cards look smooth? Can this
   be looked at? Go through every clickable tab in the app."
   Each transition was stopped at 0/60/120/200/280/440ms in Chromium. Four
   faults showed up:
     1. a tapped tab dropped the old screen and faded the new one up from
        the bare ground: its first frame was empty;
     2. a morph drew a title at the width of the box it was flying to, so
        Full Plan's "WEEK 4" was smeared across the screen;
     3. a page that grew out of a Coach circle also ran its own fade, so it
        faded twice;
     4. a sheet left in one frame. Every sheet's rise also lost its glass
        blur, because the dimmed layer fading under it was a group of its
        own. The words behind showed sharp through the sheet.
   These checks pin the fix for each one. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');

function app(){
  const a = loadApp({ pinnedDate: '2026-11-12T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  return a;
}
/* Enough of an overlay and its card for modalLeave(). */
function overlay(){
  const classes = s => ({ set: new Set(), add(c){ this.set.add(c); }, remove(c){ this.set.delete(c); }, contains(c){ return this.set.has(c); } });
  const card = { style: {}, classList: classes() };
  const parent = { kids: [], removeChild(k){ this.kids = this.kids.filter(x => x !== k); k.parentNode = null; } };
  const ov = { id: 'modal-overlay', classList: classes(), attrs: { id: 'modal-overlay' },
    removeAttribute(k){ delete this.attrs[k]; if (k === 'id') this.id = ''; },
    querySelector(sel){ return sel === '.modal-card' ? card : null; } };
  ov.parentNode = parent; parent.kids.push(ov);
  return { ov, card, parent };
}
function withTimers(a){
  const due = [];
  a.setTimeout = (fn, ms) => { due.push({ fn, ms }); return due.length; };
  return due;
}

test('1. a tapped tab cross-fades; a swipe and the app\'s own trips do not', () => {
  assert.match(SRC, /case 'set-view': handleSetView\(target\.getAttribute\('data-view'\), true\); break;/);
  assert.match(SRC, /if \(tapped\) viewCrossfade\(renderApp\); else renderApp\(\);/);
  assert.match(CSS, /html\.vt-tab::view-transition-old\(root\), html\.vt-tab::view-transition-new\(root\)\{\s*animation-duration:200ms;/);

  const a = app();
  let started = 0, rendered = 0, fadeHeld = null;
  a.document.startViewTransition = cb => { started++; cb(); return { finished: Promise.resolve() }; };
  a.viewCrossfade(() => { rendered++; fadeHeld = a.pagerSuppressFade; });
  assert.equal(started, 1);
  assert.equal(rendered, 1);
  assert.equal(fadeHeld, true, 'the new screen still faded up from nothing inside the cross-fade');
  assert.equal(a.pagerSuppressFade, false, 'the suppression outlived its one render');

  /* A swipe has already moved the page. */
  a.pagerSuppressFade = true;
  a.viewCrossfade(() => { rendered++; });
  assert.equal(started, 1, 'a swiped page was faded again');
  a.pagerSuppressFade = false;

  /* Reduce Motion keeps the view's own short fade. */
  a.matchMedia = q => ({ matches: /prefers-reduced-motion: reduce/.test(q) });
  a.viewCrossfade(() => { rendered++; });
  assert.equal(started, 1);
  assert.equal(rendered, 3);
});

test('2. words in a morph slide at their own size, never stretched to the other box', () => {
  assert.match(CSS, /::view-transition-old\(vt-title\), ::view-transition-new\(vt-title\),\s*::view-transition-old\(vt-figs\), ::view-transition-new\(vt-figs\),\s*::view-transition-old\(vt-dist\), ::view-transition-new\(vt-dist\)\{\s*height:100%; object-fit:none; object-position:left center; \}/);
  assert.match(CSS, /::view-transition-old\(vt-pct\), ::view-transition-new\(vt-pct\)\{\s*height:100%; object-fit:none; object-position:right center; \}/);
});

test('3. a page that grew out of what was tapped does not fade in a second time', () => {
  assert.match(CSS, /\.modal-overlay\.is-morphed, \.modal-overlay\.is-morphed > \.modal-card\{ animation:none; \}/);
  assert.match(SRC, /overlay\.className = 'modal-overlay' \+ \(vtInMorph \? ' is-morphed' : ''\);/);
  const a = app();
  let during = null;
  a.document.startViewTransition = cb => { cb(); return { finished: Promise.resolve() }; };
  a.vtMorph({ hero: { style: {}, setAttribute(){}, removeAttribute(){} }, parts: {} }, () => { during = a.vtInMorph; }, () => null);
  assert.equal(during, true);
  assert.equal(a.vtInMorph, false, 'the flag outlived the morph');
});

test('4. a sheet leaves the way it came: it sinks and fades, then is gone', () => {
  const a = app();
  a.matchMedia = () => ({ matches: false });
  const due = withTimers(a);
  const { ov, card, parent } = overlay();
  a.modalLeave(ov);
  assert.equal(ov.id, '', 'a leaving sheet still answered to #modal-overlay');
  assert.ok(ov.classList.contains('is-leaving'));
  assert.ok(card.classList.contains('is-leaving'));
  assert.ok(card.classList.contains('is-sinking'));
  assert.equal(parent.kids.length, 1, 'removed before it could be seen leaving');
  assert.equal(due.length, 1);
  assert.ok(due[0].ms >= a.MODAL_LEAVE_MS);
  due[0].fn();
  assert.equal(parent.kids.length, 0, 'never removed');
  assert.match(CSS, /\.modal-overlay\.is-leaving\{ animation:scrimout \.22s ease forwards; pointer-events:none; \}/);
});

test('4. a page on its way out is never taken for the open one', () => {
  /* Found by id it has already lost its id; found by class, it says so. */
  const lookups = SRC.match(/document\.querySelector\('\.modal-card[^)]*\)/g) || [];
  assert.ok(lookups.length >= 6);
  lookups.forEach(l => assert.match(l, /:not\(\.is-leaving\)/, l));
});

test('4. a sheet already swiped away keeps where the finger left it', () => {
  const a = app();
  a.matchMedia = () => ({ matches: false });
  withTimers(a);
  const { ov, card } = overlay();
  card.style.transform = 'translateY(640px)';
  a.modalLeave(ov);
  assert.ok(ov.classList.contains('is-leaving'));
  assert.ok(card.classList.contains('is-leaving'), 'a lookup for the open page could still find it');
  assert.equal(card.classList.contains('is-sinking'), false, 'the swiped sheet jumped back to slide down again');
});

test('4. gone at once: no animation, Reduce Motion, a morph, or another page replacing it', () => {
  const check = (setup, why) => {
    const a = app();
    const due = withTimers(a);
    setup(a);
    const { ov, parent } = overlay();
    a.modalLeave(ov);
    assert.equal(parent.kids.length, 0, why);
    assert.equal(due.length, 0, why);
  };
  check(a => { a.matchMedia = undefined; }, 'a device that cannot animate kept a dead sheet');
  check(a => { a.matchMedia = q => ({ matches: /reduce/.test(q) }); }, 'Reduce Motion still animated the close');
  check(a => { a.matchMedia = () => ({ matches: false }); a.vtInMorph = true; }, 'a closing page lingered in the morph\'s new side');
  check(a => { a.matchMedia = () => ({ matches: false }); a.modalSwapping = true; }, 'a replaced page sank under its replacement');
});

test('4. the glass keeps its blur while the sheet rises: the dim fades, not the layer', () => {
  const rule = CSS.match(/\n\s*\.modal-overlay\{[^}]*\}/)[0];
  assert.match(rule, /animation:scrimin \.26s ease;/);
  assert.doesNotMatch(rule, /animation:fadein/);
  assert.match(CSS, /@keyframes scrimin\{from\{background-color:transparent;\}\}/);
  assert.match(CSS, /\.vvcal-scrim\{[^}]*animation:scrimin \.18s ease;\}/);
  assert.match(CSS, /\.tw-layer\{[^}]*animation:scrimin \.2s ease;\}/);
  /* Opaque early: the rise is the movement, not a long see-through fade. */
  assert.match(CSS, /@keyframes slideup\{0%\{transform:translateY\(24px\); opacity:0;\} 35%\{opacity:1;\} 100%\{transform:translateY\(0\); opacity:1;\}\}/);
});
