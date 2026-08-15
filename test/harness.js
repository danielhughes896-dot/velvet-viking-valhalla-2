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

function extractInlineScript(html) {
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  if (start === -1 || end === -1) throw new Error('Could not find the inline <script> block');
  return html.slice(start + '<script>'.length, end);
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

function loadApp() {
  const htmlPath = path.join(__dirname, '..', 'velvet-viking-valhalla.html');
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
  sandbox.Date = Date;
  sandbox.Math = Math;
  sandbox.JSON = JSON;

  vm.createContext(sandbox);
  new vm.Script(src, { filename: 'velvet-viking-valhalla.html (inline script)' }).runInContext(sandbox);

  return sandbox;
}

module.exports = { loadApp };
