'use strict';
// THE SIGN-IN LINK, IN THE INSTALLED APP (founder, 18 November 2026, on
// iPhone: "The sign in link just takes me back to the same page").
// Asked from the app, the link returns through com.velvetviking.valhalla://auth
// with the tokens in its fragment. The page in front is /account, which only
// listened for the payment page's return (and on iPhone not at all), so the
// athlete came back to the form they had just used. These run /account's own
// script in a stand-in app shell and hand it the link, warm and cold.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'account.html'), 'utf8');
const SCRIPT = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.replace(/<\/?script>/g, '')).join('\n');

function el(id){
  const cls = new Set(['vvv-hidden']);
  return { id, textContent: '', value: '', disabled: false, className: '', hidden: false, style: {}, dataset: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); } },
    _cls: cls, setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){}, addEventListener(){},
    appendChild(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, focus(){}, innerHTML: '' };
}
function shell(opts){
  const o = opts || {};
  const els = {};
  const store = {};
  const calls = [];
  const listeners = {};
  const doc = {
    getElementById: id => (els[id] = els[id] || el(id)),
    querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, createElement: () => el('x'),
    visibilityState: 'visible', body: el('body'), documentElement: el('html')
  };
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => o.platform || 'ios',
      Plugins: { App: {
        addListener: (ev, fn) => { listeners[ev] = fn; return { remove(){} }; },
        getLaunchUrl: () => Promise.resolve(o.launchUrl ? { url: o.launchUrl } : null)
      } }
    }
  };
  const loc = { href: 'https://app.velvetviking.co.uk/account', origin: 'https://app.velvetviking.co.uk',
    pathname: '/account', search: '', hash: '', replace(u){ calls.push(['replace', u]); }, assign(u){ calls.push(['assign', u]); }, reload(){} };
  const ctx = {
    window: win, document: doc, location: loc, navigator: { userAgent: 'Mozilla/5.0 (iPhone) Capacitor' },
    history: { replaceState(){} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    fetch: (url, init) => {
      calls.push(['fetch', String(url), init && init.headers && (init.headers.authorization || init.headers.Authorization)]);
      const body = String(url).indexOf('/api/session') === 0 ? { access: true } : {};
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body) });
    },
    setTimeout: (f) => { calls.push(['timer']); return 0; }, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    URLSearchParams, Promise, JSON, Date, Math, encodeURIComponent, decodeURIComponent, console
  };
  win.document = doc; win.location = loc; win.localStorage = ctx.localStorage;
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  return { els, store, calls, listeners };
}
const flush = () => new Promise(r => setImmediate(r));
const LINK = 'com.velvetviking.valhalla://auth#access_token=tok-123&refresh_token=ref-9&expires_in=3600&token_type=bearer';

test('the page listens for the sign-in link inside the iPhone app', () => {
  const s = shell({ platform: 'ios' });
  assert.equal(typeof s.listeners.appUrlOpen, 'function', 'nothing in /account hears the link on iPhone');
});

test('the link, arriving while the app is open, signs the athlete in', async () => {
  const s = shell({ platform: 'ios' });
  s.listeners.appUrlOpen({ url: LINK });
  await flush(); await flush();
  const saved = JSON.parse(s.store.vvv_cloud_session || 'null');
  assert.ok(saved, 'the session from the link was not kept');
  assert.equal(saved.access_token, 'tok-123');
  assert.equal(saved.refresh_token, 'ref-9');
  assert.ok(s.calls.some(c => c[0] === 'fetch' && c[1] === '/api/session' && c[2] === 'Bearer tok-123'),
    'the token was never exchanged for the app');
});

test('the link that launched the app from closed signs the athlete in too', async () => {
  const s = shell({ platform: 'ios', launchUrl: LINK });
  await flush(); await flush();
  assert.equal(JSON.parse(s.store.vvv_cloud_session || 'null').access_token, 'tok-123');
});

test('Android is handled the same way', async () => {
  const s = shell({ platform: 'android' });
  s.listeners.appUrlOpen({ url: LINK });
  await flush(); await flush();
  assert.equal(JSON.parse(s.store.vvv_cloud_session || 'null').access_token, 'tok-123');
});

test('an expired link says so instead of leaving the athlete on the form in silence', async () => {
  const s = shell({ platform: 'ios' });
  s.listeners.appUrlOpen({ url: 'com.velvetviking.valhalla://auth#error=access_denied&error_description=Email+link+is+invalid+or+has+expired' });
  await flush();
  assert.equal(s.store.vvv_cloud_session, undefined);
  assert.match(s.els.msg.textContent, /expired or was already used/);
});

test('the payment return and unrelated links are not read as a sign-in', async () => {
  const s = shell({ platform: 'ios' });
  s.listeners.appUrlOpen({ url: 'com.velvetviking.valhalla://auth/checkout?status=complete&session_id=cs_1' });
  s.listeners.appUrlOpen({ url: 'https://evil.example/#access_token=x' });
  s.listeners.appUrlOpen({ url: 'com.velvetviking.valhalla://auth' });
  await flush();
  assert.equal(s.store.vvv_cloud_session, undefined);
});
