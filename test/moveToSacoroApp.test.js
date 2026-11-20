'use strict';
// THE ONE-TIME MOVE TO app.sacoro.app. Founder, 20 November 2026: the app
// moves from app.velvetviking.co.uk to app.sacoro.app. A WebView keeps
// localStorage per address, so the installed app carries the old address's
// storage across the first time it opens at the new one: <script id="move-in">
// at the top of the runtime, and move-out.html at the old address.
//
// These tests RUN both halves, in a sandbox standing in for each address, and
// then run them into each other the way the app will on a phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const RUNTIME = read('protected/velvet-viking-valhalla.html');
const MOVE_IN = /<script id="move-in">([\s\S]*?)<\/script>/.exec(RUNTIME)[1];
const MOVE_OUT_PAGE = read('move-out.html');
const MOVE_OUT = /<script>([\s\S]*?)<\/script>/.exec(MOVE_OUT_PAGE)[1];

const NEW = 'https://app.sacoro.app';
const OLD = 'https://app.velvetviking.co.uk';
const OWN = ['vvv_move_nonce', 'vvv_moved', 'vvv_move_tries'];

function storage(initial){
  const m = new Map(Object.entries(initial || {}));
  return {
    map: m,
    get length(){ return m.size; },
    key(i){ return Array.from(m.keys())[i] ?? null; },
    getItem(k){ return m.has(k) ? m.get(k) : null; },
    setItem(k, v){ m.set(k, String(v)); },
    removeItem(k){ m.delete(k); },
  };
}

/* One page load at one address. Resolves once the page has gone somewhere
   (location.replace) or, if it never does, after the script has settled. */
function load(src, { host, hash = '', search = '', referrer = '', native = false, ls, compression = true }){
  const calls = { replaced: null, stopped: 0, rewritten: null };
  let done;
  const went = new Promise((r) => { done = r; });
  const location = {
    hostname: host, hash, search, pathname: '/',
    replace(u){ calls.replaced = u; done(); },
  };
  const box = {
    window: {
      localStorage: ls,
      stop(){ calls.stopped++; },
      Capacitor: native ? { isNativePlatform: () => true } : undefined,
    },
    location,
    history: { replaceState(_s, _t, u){ calls.rewritten = u; location.hash = ''; } },
    document: { documentElement: { style: {} }, referrer },
    crypto: webcrypto, btoa, atob, Blob, Response,
    DecompressionStream,
  };
  if (compression) box.CompressionStream = CompressionStream;
  vm.runInNewContext(src, box);
  return Promise.race([went, new Promise((r) => setTimeout(r, 200))]).then(() => calls);
}

const appData = {
  'velvet-viking-generator-v2': JSON.stringify({ setup: { race: 'Marathon' }, days: [{ date: '2026-11-20', type: 'Long', km: 24 }] }),
  'vvv_cloud_session': JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', user_id: 'u1' }),
  'vvv_plan_archive': JSON.stringify([{ name: 'Spring plan' }]),
  'sacoro.coachNote.v1': 'Easy week; hold the long run.',
  'vvv_journey': JSON.stringify({ step: 'done' }),
  'vv-gestures-learned': '1',
};

// ---------------------------------------------------------------------------
// WHERE IT RUNS
// ---------------------------------------------------------------------------
test('the move runs before anything else on the page can write to storage', () => {
  const at = RUNTIME.indexOf('<script id="move-in">');
  assert.ok(at > 0, 'the move-in script is missing');
  assert.equal(RUNTIME.indexOf('<script'), at, 'another script runs before the move');
  assert.ok(at < RUNTIME.indexOf('</head>'), 'the move is not in the head');
});

test('it does nothing at the old address, or for a browser at the new one', async () => {
  for (const opts of [
    { host: 'app.velvetviking.co.uk', native: true },
    { host: 'velvet-viking-valhalla-1.vercel.app', native: true },
    { host: 'localhost', native: true },
    { host: 'app.sacoro.app', native: false },
  ]){
    const ls = storage();
    const calls = await load(MOVE_IN, { ...opts, ls });
    assert.equal(calls.replaced, null, `${opts.host} (native ${opts.native}) was sent somewhere`);
    assert.equal(calls.stopped, 0);
    assert.equal(ls.length, 0, `${opts.host} wrote to storage`);
  }
});

// ---------------------------------------------------------------------------
// THE NEW ADDRESS, FIRST OPEN
// ---------------------------------------------------------------------------
test('the installed app, opening empty at the new address, fetches its storage from the old one', async () => {
  const ls = storage();
  const calls = await load(MOVE_IN, { host: 'app.sacoro.app', native: true, ls });
  const n = ls.getItem('vvv_move_nonce');
  assert.match(n, /^[A-Za-z0-9_-]{24}$/, 'no fresh random nonce was kept');
  assert.equal(calls.stopped, 1, 'the page kept loading, so the app could write first');
  assert.equal(calls.replaced, `${OLD}/move-out#n=${n}`);
  assert.equal(ls.getItem('vvv_move_tries'), '1');
  const again = storage();
  await load(MOVE_IN, { host: 'app.sacoro.app', native: true, ls: again });
  assert.notEqual(again.getItem('vvv_move_nonce'), n, 'two moves used the same nonce');
});

test('an app already holding its data here is never bounced', async () => {
  const ls = storage({ 'velvet-viking-generator-v2': '{"days":[]}' });
  const calls = await load(MOVE_IN, { host: 'app.sacoro.app', native: true, ls });
  assert.equal(calls.replaced, null);
  assert.equal(ls.getItem('vvv_moved'), '1');
  const later = await load(MOVE_IN, { host: 'app.sacoro.app', native: true, ls: storage({ vvv_moved: '1' }) });
  assert.equal(later.replaced, null, 'a finished move ran again');
});

test('three attempts at most, then the app starts fresh rather than looping', async () => {
  const ls = storage({ vvv_move_tries: '3' });
  const calls = await load(MOVE_IN, { host: 'app.sacoro.app', native: true, ls });
  assert.equal(calls.replaced, null);
  assert.equal(calls.stopped, 0);
  assert.equal(ls.getItem('vvv_moved'), '1');
});

// ---------------------------------------------------------------------------
// THE OLD ADDRESS
// ---------------------------------------------------------------------------
test('the old address hands its storage back to the new address, and only there', async () => {
  const ls = storage({ ...appData, vvv_move_nonce: 'stale' });
  const n = 'N0nceN0nceN0nceN0nce1234';
  const calls = await load(MOVE_OUT, { host: 'app.velvetviking.co.uk', hash: '#n=' + n, referrer: NEW + '/', ls });
  const m = /^https:\/\/app\.sacoro\.app\/#vvv-move=(z[A-Za-z0-9_-]+)&n=([A-Za-z0-9_-]+)$/.exec(calls.replaced);
  assert.ok(m, 'it did not go back to the new address with a compressed payload: ' + String(calls.replaced).slice(0, 80));
  assert.equal(m[2], n, 'the nonce did not come back unchanged');
  assert.deepEqual(Object.fromEntries(ls.map), { ...appData, vvv_move_nonce: 'stale' }, 'the old storage was changed');
});

test('opened any other way, the old address hands over nothing', async () => {
  const n = 'N0nceN0nceN0nceN0nce1234';
  for (const [why, opts] of [
    ['opened from another site', { host: 'app.velvetviking.co.uk', hash: '#n=' + n, referrer: 'https://evil.example/' }],
    ['opened directly', { host: 'app.velvetviking.co.uk', hash: '#n=' + n, referrer: '' }],
    ['no nonce', { host: 'app.velvetviking.co.uk', hash: '', referrer: NEW + '/' }],
    ['a malformed nonce', { host: 'app.velvetviking.co.uk', hash: '#n=<script>', referrer: NEW + '/' }],
    ['the wrong address', { host: 'velvet-viking-valhalla-1.vercel.app', hash: '#n=' + n, referrer: NEW + '/' }],
  ]){
    const calls = await load(MOVE_OUT, { ...opts, ls: storage(appData) });
    assert.equal(calls.replaced, NEW + '/', `${why}: it sent ${String(calls.replaced).slice(0, 60)}`);
  }
});

test('without compression it still hands everything over, uncompressed', async () => {
  const n = 'N0nceN0nceN0nceN0nce1234';
  const calls = await load(MOVE_OUT, { host: 'app.velvetviking.co.uk', hash: '#n=' + n, referrer: NEW + '/', ls: storage(appData), compression: false });
  const m = /#vvv-move=(j[^&]+)&n=/.exec(calls.replaced);
  assert.ok(m, 'no uncompressed payload');
  assert.deepEqual(JSON.parse(decodeURIComponent(m[1].slice(1))), appData);
});

test('it is never too long to open: the largest entries stay behind before that could happen', async () => {
  // Random printable text: the worst case, because it barely compresses.
  const noise = (len) => Array.from(require('crypto').randomBytes(len), (b) => String.fromCharCode(33 + (b % 90))).join('');
  const big = { ...appData, 'vvv_huge_a': noise(1200000), 'vvv_huge_b': noise(700000) };
  const calls = await load(MOVE_OUT, { host: 'app.velvetviking.co.uk', hash: '#n=N0nceN0nceN0nceN0nce1234', referrer: NEW + '/', ls: storage(big) });
  const fragment = calls.replaced.slice(calls.replaced.indexOf('#'));
  assert.ok(fragment.length <= 1500100, 'the address is ' + fragment.length + ' characters');
  const back = storage({ vvv_move_nonce: 'N0nceN0nceN0nceN0nce1234' });
  await load(MOVE_IN, { host: 'app.sacoro.app', hash: fragment, native: true, ls: back });
  for (const k of Object.keys(appData)) assert.equal(back.getItem(k), appData[k], `${k} was lost making room`);
  assert.equal(back.getItem('vvv_huge_a'), null, 'the largest entry was kept and the address overflowed');
});

// ---------------------------------------------------------------------------
// THE NEW ADDRESS, ON THE WAY BACK
// ---------------------------------------------------------------------------
test('the whole move: storage arrives, the address is wiped, and the app reloads signed in', async () => {
  // 1. First open at the new address.
  const here = storage();
  const first = await load(MOVE_IN, { host: 'app.sacoro.app', native: true, ls: here });
  const n = here.getItem('vvv_move_nonce');
  // 2. The old address, reached with that nonce, from the new address.
  const there = storage(appData);
  const out = await load(MOVE_OUT, { host: 'app.velvetviking.co.uk', hash: first.replaced.slice(first.replaced.indexOf('#')), referrer: NEW + '/', ls: there });
  assert.ok(out.replaced.startsWith(NEW + '/#vvv-move='));
  // 3. Back at the new address.
  const back = await load(MOVE_IN, { host: 'app.sacoro.app', hash: out.replaced.slice(out.replaced.indexOf('#')), native: true, ls: here });
  assert.equal(back.rewritten, '/', 'the payload was left in the address');
  assert.equal(back.stopped, 1, 'the page booted before the storage was written');
  assert.equal(back.replaced, '/', 'the app did not reload into its moved storage');
  for (const k of Object.keys(appData)) assert.equal(here.getItem(k), appData[k], `${k} did not arrive`);
  assert.equal(here.getItem('vvv_moved'), '1');
  for (const k of ['vvv_move_nonce', 'vvv_move_tries']) assert.equal(here.getItem(k), null, `${k} was left behind`);
  // 4. And the next launch is an ordinary one.
  const next = await load(MOVE_IN, { host: 'app.sacoro.app', native: true, ls: here });
  assert.equal(next.replaced, null);
});

test('a payload without this device\'s own nonce is dropped unread', async () => {
  const payload = 'j' + encodeURIComponent(JSON.stringify({ vvv_cloud_session: '{"access_token":"someone-else"}' }));
  for (const [why, stored] of [['a different nonce', 'OtherNonceOtherNonce1234'], ['no move under way', null]]){
    const ls = storage(stored ? { vvv_move_nonce: stored } : {});
    const calls = await load(MOVE_IN, { host: 'app.sacoro.app', hash: `#vvv-move=${payload}&n=N0nceN0nceN0nceN0nce1234`, native: true, ls });
    assert.equal(calls.rewritten, '/', `${why}: the payload stayed in the address`);
    assert.equal(ls.getItem('vvv_cloud_session'), null, `${why}: it was written`);
    assert.equal(calls.stopped, 0, `${why}: the page was stopped`);
    assert.equal(ls.getItem('vvv_move_nonce'), null, `${why}: the nonce survived to be guessed at`);
  }
});

test('a payload cannot mark the move done, restart it or plant anything that is not text', async () => {
  const n = 'N0nceN0nceN0nceN0nce1234';
  const sneaky = { vvv_moved: '0', vvv_move_nonce: 'x', vvv_move_tries: '0', 'vvv_journey': { step: 'done' }, 'sacoro.coachNote.v1': 'ok' };
  const ls = storage({ vvv_move_nonce: n });
  await load(MOVE_IN, { host: 'app.sacoro.app', hash: `#vvv-move=j${encodeURIComponent(JSON.stringify(sneaky))}&n=${n}`, native: true, ls });
  assert.equal(ls.getItem('vvv_moved'), '1');
  assert.equal(ls.getItem('vvv_move_nonce'), null);
  assert.equal(ls.getItem('vvv_move_tries'), null);
  assert.equal(ls.getItem('vvv_journey'), null, 'a non-string value was written');
  assert.equal(ls.getItem('sacoro.coachNote.v1'), 'ok');
});

test('a payload that cannot be read still ends the move, so the app starts rather than looping', async () => {
  const n = 'N0nceN0nceN0nceN0nce1234';
  const ls = storage({ vvv_move_nonce: n });
  const calls = await load(MOVE_IN, { host: 'app.sacoro.app', hash: `#vvv-move=zNOT-DEFLATE&n=${n}`, native: true, ls });
  assert.equal(calls.replaced, '/');
  assert.equal(ls.getItem('vvv_moved'), '1');
});

// ---------------------------------------------------------------------------
// THE PLUMBING
// ---------------------------------------------------------------------------
test('/move-out is served, and the service worker never answers it with the old app', () => {
  const routes = JSON.parse(read('vercel.json')).routes;
  const at = routes.findIndex((r) => r.src === '/move-out');
  assert.ok(at !== -1 && routes[at].dest === '/move-out.html', 'no route to move-out.html');
  assert.ok(at < routes.findIndex((r) => r.handle === 'filesystem'), 'the route comes after the filesystem');

  let onFetch = null;
  const box = {
    self: { addEventListener(type, fn){ if (type === 'fetch') onFetch = fn; }, location: { origin: OLD } },
    caches: {}, Response: function(){}, Date, Math, URL,
    fetch: () => new Promise(() => {}),
  };
  vm.createContext(box);
  vm.runInContext(read('sw.js'), box);
  const navigate = (p) => {
    let answered = false;
    onFetch({ request: { method: 'GET', mode: 'navigate', url: OLD + p }, respondWith(){ answered = true; } });
    return answered;
  };
  assert.equal(navigate('/move-out'), false, 'the service worker answered /move-out');
  assert.equal(navigate('/'), true, 'the service worker stopped answering the app itself');
});

test('the move-out page leaves no way to send storage anywhere but the new address', () => {
  assert.match(MOVE_OUT_PAGE, /<meta name="robots" content="noindex">/);
  const targets = MOVE_OUT.match(/https:\/\/[a-z0-9.-]+/g);
  assert.deepEqual([...new Set(targets)], [NEW], 'another address appears in the move-out script');
  assert.doesNotMatch(MOVE_OUT, /fetch\(|XMLHttpRequest|sendBeacon|postMessage/, 'the move-out page talks to something');
});
