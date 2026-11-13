'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* Founder:
   "1. Full Plan: Glass progress panel. Keep FULL MARATHON as a separate
   heading at the top left. Place WEEK 1 OF 16, 0 / 922 km and 0% inside one
   subtle liquid-glass panel. Keep the gold progress bar within that panel,
   underneath the figures. Preserve the phase imagery below.
   2. Keyboard and input visibility. When the keyboard opens, automatically
   bring the active input box into view. Keep the box and its entered value
   visible above the keyboard. Keep the glass bottom navigation unchanged.
   No jumping, clipping or disappearing inputs." */

const RT = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = RT.slice(RT.indexOf('<style'), RT.indexOf('</style>'));
const fnIn = (n) => {
  const i = RT.indexOf('function ' + n + '(');
  assert.ok(i > -1, n);
  return RT.slice(i, RT.indexOf('\n}', i) + 2);
};

function plan(){
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'full', volume: 45, weeks: 16, startDate: '2026-11-16' });
  return a;
}

// ------------------------------------------------------------ 1. the glass pane
test('Full Plan: the heading stands alone, the three figures and the gold bar share one pane of glass', () => {
  const a = plan();
  const html = a.renderWeekHeroBlock(1, true);
  const title = html.indexOf('wk-hero-title'), pane = html.indexOf('<div class="wk-glass">');
  const figs = html.indexOf('wk-hero-figs'), wk = html.indexOf('wk-hero-wk'), vol = html.indexOf('wk-hero-vol'),
        pct = html.indexOf('wk-hero-pct'), bar = html.indexOf('<div class="wk-bar">');
  assert.ok(title > -1 && pane > title, 'the heading must come first, outside the pane');
  assert.ok(pane < figs && figs < wk && wk < vol && vol < pct && pct < bar, 'week, volume and percent, then the bar, in the pane');
  /* The pane closes straight after the bar: nothing else is inside it. */
  const afterBar = html.slice(bar);
  assert.match(afterBar, /^<div class="wk-bar"><div class="wk-bar-fill"[^>]*><\/div><\/div><\/div>/);
  /* Every box opened is closed: a pane left open would swallow the notes and
     everything after the hero. */
  assert.equal((html.match(/<div\b/g) || []).length, (html.match(/<\/div>/g) || []).length);
  assert.match(html, /<\/div><\/div><\/div><\/div>$/, 'fill, bar, pane, hero');
  assert.match(html, /Week 1 of 16/);
  assert.match(html.slice(title, pane), /Full Marathon/);
});

test('This Week keeps its hero without a pane', () => {
  const a = plan();
  assert.equal(a.renderWeekHeroBlock(1).indexOf('wk-glass'), -1);
});

test('the pane is the tab bar\'s own glass, subtle, and never clips the bar\'s glow', () => {
  const rule = /\.wk-glass\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, 'no .wk-glass rule');
  ['background:var(--glass-sheen), var(--glass-tint)', 'backdrop-filter:var(--glass-blur)', 'box-shadow:var(--glass-rim)']
    .forEach(d => assert.ok(rule[1].indexOf(d) > -1, 'the pane is not the shared glass: ' + d));
  assert.doesNotMatch(rule[1], /overflow/, 'a clipped pane would cut the gold bar\'s glow');
  assert.match(CSS, /\.wk-glass \.wk-hero-figs\{margin-top:0;\}/);
});

// ------------------------------------------------------------ 2. the field stays in sight
function rect(top, bottom, left, right){ return { top, bottom, left: left || 0, right: right || 390, width: (right || 390) - (left || 0), height: bottom - top }; }
function el(r, opts){
  opts = opts || {};
  const e = {
    nodeType: 1, tagName: opts.tag || 'DIV', type: opts.type, readOnly: !!opts.readOnly, disabled: false,
    isConnected: true, style: {}, _r: r, _pos: opts.pos || 'static', _children: [], parentElement: null,
    getBoundingClientRect(){ return this._r; },
    contains(x){ for (let p = x; p; p = p.parentElement) if (p === this) return true; return false; },
    closest(){ return opts.inModal || null; },
    getElementsByTagName(){ const out = []; const walk = n => n._children.forEach(c => { out.push(c); walk(c); }); walk(this); return out; },
  };
  return e;
}
function attach(parent, child){ parent._children.push(child); child.parentElement = parent; return child; }
function page(a, vv){
  const body = el(rect(0, 2000), {});
  const sc = { scrollHeight: 2000, clientHeight: 780, scrollTop: 400, moved: [],
    scrollBy(o){ this.moved.push(o.top); this.scrollTop += o.top; } };
  a.document = { body, scrollingElement: sc, documentElement: sc, activeElement: null };
  a.getComputedStyle = x => ({ position: x._pos || 'static', display: 'block', visibility: 'visible', overflowY: 'visible', paddingBottom: '0px' });
  a.matchMedia = () => ({ matches: true });
  a.visualViewport = vv;
  a.innerHeight = 780;
  return { body, sc };
}

test('the clear band is the visible viewport less the bars pinned over its edges', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  /* Android: the keyboard has resized the page to 480; the glass tab bar
     rides on the keyboard at 410..470; the header is pinned at 0..83. */
  const { body } = page(a, { offsetTop: 0, height: 480 });
  attach(body, el(rect(0, 83), { pos: 'sticky' }));
  attach(body, el(rect(410, 470, 12, 378), { pos: 'fixed' }));
  const field = attach(body, el(rect(430, 474, 16, 300), { tag: 'INPUT', type: 'text' }));
  assert.deepEqual({ ...a.fieldClearBand(field) }, { top: 83, bottom: 410 });
});

test('iOS: a bar left under the keyboard is not counted, the keyboard is the edge', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  /* The page is not resized; the visible viewport shrinks to 480 and the
     tab bar stays at the foot of the layout, under the keyboard. */
  const { body } = page(a, { offsetTop: 0, height: 480 });
  attach(body, el(rect(700, 760, 12, 378), { pos: 'fixed' }));
  const field = attach(body, el(rect(430, 474, 16, 300), { tag: 'INPUT', type: 'text' }));
  assert.equal(a.fieldClearBand(field).bottom, 480);
});

test('the field moves by exactly what it is short, once, and only when it is short', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  const band = { top: 83, bottom: 410 };
  assert.equal(a.fieldShortfall(rect(200, 244), band), 0, 'a field in the clear moves nowhere');
  assert.equal(a.fieldShortfall(rect(430, 474), band), 474 - (410 - a.FIELD_GAP), 'under the tab bar: up by the overlap and the gap');
  assert.equal(a.fieldShortfall(rect(60, 104), band), 60 - (83 + a.FIELD_GAP), 'under the header: down');
  assert.equal(a.fieldShortfall(rect(100, 700), band), 100 - (83 + a.FIELD_GAP), 'too tall to fit: its top, where the value starts, stays in sight');
});

test('bringing it into view scrolls what it scrolls in, and makes room at the end of a page when there is none', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  const { body, sc } = page(a, { offsetTop: 0, height: 480 });
  attach(body, el(rect(410, 470, 12, 378), { pos: 'fixed' }));
  const field = attach(body, el(rect(430, 474, 16, 300), { tag: 'INPUT', type: 'text' }));
  a.document.activeElement = field;
  a.fieldView.el = field;
  a.fieldBringIntoView();
  assert.deepEqual(sc.moved, [474 - (410 - a.FIELD_GAP)]);
  assert.equal(body.style.paddingBottom, undefined, 'there was room: nothing is added');
  /* At the very end of the page there is no room left to scroll. */
  sc.moved = []; sc.scrollTop = sc.scrollHeight - sc.clientHeight;
  a.fieldBringIntoView();
  assert.equal(sc.moved.length, 1);
  assert.equal(body.style.paddingBottom, Math.ceil(474 - (410 - a.FIELD_GAP)) + 'px', 'room is made under the page');
  a.fieldUnpad();
  assert.equal(body.style.paddingBottom, undefined, 'and it goes again when typing ends');
});

test('only fields that raise a keyboard: not sliders, ticks, pickers or read-only boxes', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  const f = (tag, type, ro) => ({ nodeType: 1, tagName: tag, type, readOnly: !!ro, disabled: false });
  ['text', 'search', 'email', 'tel', 'number', 'password', 'url'].forEach(t => assert.equal(a.isTypingField(f('INPUT', t)), true, t));
  assert.equal(a.isTypingField(f('TEXTAREA')), true);
  ['range', 'checkbox', 'radio', 'date', 'time', 'button'].forEach(t => assert.equal(a.isTypingField(f('INPUT', t)), false, t));
  assert.equal(a.isTypingField(f('INPUT', 'text', true)), false, 'read-only');
});

test('wired once at start, listening for focus, typing and the keyboard moving the viewport', () => {
  assert.match(RT, /try\{ initFieldInView\(\); \}catch\(e\)\{\}/);
  const init = fnIn('initFieldInView');
  assert.match(init, /addEventListener\('focusin', fieldFocusIn, true\)/);
  assert.match(init, /addEventListener\('focusout', fieldFocusOut, true\)/);
  assert.match(init, /addEventListener\('input', fieldTyped, true\)/);
  assert.match(init, /window\.visualViewport\.addEventListener\('resize', fieldViewportMoved\)/);
  /* Measured once the keyboard has stopped moving, not on every frame. */
  assert.match(fnIn('fieldFocusIn'), /fieldSoon\(FIELD_SETTLE_MS\)/);
  assert.match(fnIn('fieldSoon'), /clearTimeout\(fieldView\.timer\)/);
});

test('the glass tab bar is left exactly as it is: the field moves, the bar does not', () => {
  ['isTypingField', 'fieldScroller', 'fieldClearBand', 'fieldShortfall', 'fieldBringIntoView', 'fieldUnpad',
   'fieldSoon', 'fieldFocusIn', 'fieldFocusOut', 'fieldViewportMoved', 'fieldTyped', 'initFieldInView'].forEach(n => {
    const src = fnIn(n);
    assert.doesNotMatch(src, /bn-stack|bottom-nav|kb-open/, n + ' reaches for the tab bar');
  });
});
