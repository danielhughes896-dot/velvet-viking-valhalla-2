// Minimal harness that loads velvet-viking-valhalla.html's inline <script>
// into a sandboxed VM context, so the targeted regression suite can call the
// app's real functions without a browser or a build step. This does not
// modify the app -- it only reads and evaluates the same source that ships.
//
// The app is a single-page script written for a real browser; running it
// here means stubbing just enough of document/window/localStorage/navigator
// that its top-level code (including the try/caught init() call at the very
// bottom of the file) can execute without throwing. Anything init() itself
// can't do without a real DOM (paint the app, register a service worker) is
// already wrapped in the app's own try/catch or defensive checks, so it
// degrades quietly -- exactly as it does in a real browser with a missing
// element.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// One place that knows where the runtime lives, exported so scratch tooling and
// future callers cannot drift from the suite.
const RUNTIME_RELATIVE = path.join('protected', 'velvet-viking-valhalla.html');

// The page carries more than one inline script: a tiny theme boot in <head>
// that runs before the first paint, and the application itself at the end of
// <body>. Slicing from the first <script> to the last </script> would have
// swallowed the stylesheet in between and fed it to the VM as JavaScript, so
// the blocks are enumerated and the largest -- the app -- is the one loaded.
function extractInlineScript(html) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let best = null, m;
  while ((m = re.exec(html)) !== null) {
    if (best === null || m[1].length > best.length) best = m[1];
  }
  if (best === null) throw new Error('Could not find the inline <script> block');
  return best;
}

function makeStubDocument() {
  const listeners = {};
  const el = () => makeStubElement();
  function makeStubElement() {
    return {
      style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
      appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){},
      querySelector(){ return null; }, querySelectorAll(){ return []; },
      focus(){}, blur(){}, click(){},
      get innerHTML(){ return this._html || ''; }, set innerHTML(v){ this._html = v; },
      textContent: '',
    };
  }
  return {
    documentElement: makeStubElement(),
    body: makeStubElement(),
    getElementById(){ return null; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    createElement: el,
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(){},
    dispatchEvent(){ return true; },
  };
}

function makeStubLocalStorage() {
  const store = Object.create(null);
  return {
    getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; },
    clear(){ for (const k of Object.keys(store)) delete store[k]; },
  };
}

/* A clock the app cannot tell from the real one, pinned to a fixed instant.
   Coaching fixtures are built relative to todayStr(), so a suite run on a
   Tuesday and the same suite run on a Saturday ask the engine different
   questions: the phase position moves, the 7-day window covers different
   sessions, and "today" can be a rest day. That made identical code at an
   identical commit produce different results on different calendar days, which
   is not a property a deterministic coaching engine's tests may have.

   Test-time only. The app reads `Date` from its sandbox, so pinning it here
   changes nothing about production date behaviour -- there is no branch in the
   app that knows this exists. Callers opt in: loadApp() with no argument keeps
   the real clock, exactly as before. */
function makePinnedDate(iso) {
  const fixed = new Date(iso).getTime();
  if (!isFinite(fixed)) throw new Error('pinnedDate must be a valid date: ' + iso);
  class PinnedDate extends Date {
    constructor(...args) {
      // `new Date()` means "now", which is the only call that gets pinned;
      // every explicit construction is left alone so date arithmetic is real.
      if (args.length === 0) super(fixed); else super(...args);
    }
    static now() { return fixed; }
  }
  return PinnedDate;
}

function loadApp(options) {
  const opts = options || {};
  // protected/ rather than the site root: Phase 3A1 moved the runtime out of
  // Vercel's static output so that /api/app is the only way to obtain it. The
  // file itself is byte-identical, so the suite still reads exactly what ships.
  const htmlPath = path.join(__dirname, '..', RUNTIME_RELATIVE);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const src = extractInlineScript(html);

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.addEventListener = function(){};
  sandbox.removeEventListener = function(){};
  sandbox.dispatchEvent = function(){ return true; };
  sandbox.document = makeStubDocument();
  sandbox.localStorage = makeStubLocalStorage();
  sandbox.navigator = { userAgent: 'node-test-harness', onLine: true, clipboard: { writeText(){ return Promise.resolve(); } } };
  sandbox.location = { href: 'http://localhost/', pathname: '/', search: '', hash: '', origin: 'http://localhost' };
  sandbox.history = { replaceState(){}, pushState(){} };
  sandbox.Notification = { permission: 'default', requestPermission(){ return Promise.resolve('default'); } };
  // Defaults to "accept" so existing flows that happen to be confirm-gated
  // (Reset Plan, Delete Account, a logged-session swap) keep working without
  // every test needing to know about it; a test that wants to simulate the
  // athlete declining can override `app.confirm = () => false`.
  sandbox.confirm = function(){ return true; };
  sandbox.fetch = function(){ return Promise.reject(new Error('network disabled in test harness')); };
  // Real timers would keep the Node process alive for no benefit here -- the
  // suite calls the app's pure logic functions directly rather than waiting
  // on the countdown clock or notification scheduler the app starts at init.
  let fakeTimerId = 0;
  sandbox.setTimeout = function(){ return ++fakeTimerId; };
  sandbox.clearTimeout = function(){};
  sandbox.setInterval = function(){ return ++fakeTimerId; };
  sandbox.clearInterval = function(){};
  sandbox.console = console;
  sandbox.URLSearchParams = URLSearchParams;
  // Real browsers have these globally; Node's VM sandbox does not. Only
  // consumer today is decoding a JWT payload to read its `sub` claim, which
  // needs the real base64 behaviour rather than a silent no-op.
  sandbox.atob = function(b64){ return Buffer.from(b64, 'base64').toString('binary'); };
  sandbox.btoa = function(str){ return Buffer.from(str, 'binary').toString('base64'); };
  sandbox.Date = opts.pinnedDate ? makePinnedDate(opts.pinnedDate) : Date;
  sandbox.Math = Math;
  sandbox.JSON = JSON;
  // A real browser loads assets/builder-spec.js as a <script src> tag before
  // the app's own inline script (see the app's <head>); the harness only
  // evaluates that inline script, so it has to put the same object in place
  // itself, or the app's builder code would read an undefined BUILDER_SPEC
  // that no real page ever sees. Same file, same shape, require()d rather
  // than fetched -- there is no separate test copy to drift from the real one.
  sandbox.BUILDER_SPEC = require('../assets/builder-spec.js');

  vm.createContext(sandbox);
  new vm.Script(src, { filename: 'velvet-viking-valhalla.html (inline script)' }).runInContext(sandbox);

  return sandbox;
}

module.exports = { loadApp, makePinnedDate, RUNTIME_RELATIVE };
