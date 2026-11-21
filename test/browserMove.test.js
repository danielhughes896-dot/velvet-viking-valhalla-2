'use strict';
/* THE BROWSER MOVE. Founder, 21 November 2026: "Go ahead with the browser
 * move." A browser at app.velvetviking.co.uk keeps its plan, notes and
 * settings there; the installed app moved itself, a browser is moved by two
 * windows talking:
 *
 *   the app at the old address  -> offers the move (sheet once a visit, a row in Settings)
 *   app.sacoro.app/move-in      -> one tap opens the old address's /hand-over in a small window
 *   /hand-over (old address)    -> posts its storage to the window that opened it, for app.sacoro.app only
 *   /move-in                    -> writes it by the rules, answers, opens SACORO
 *   the old address             -> marked moved on that answer, then sends the browser on
 *
 * These tests RUN both pages and the top of the app's <head> in sandboxes
 * standing in for each address, and drive the app's offer through the
 * harness. Nothing here travels in a URL but a nonce. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const { loadApp } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const RUNTIME = read('protected/velvet-viking-valhalla.html');
const HEAD = /<script id="move-in">([\s\S]*?)<\/script>/.exec(RUNTIME)[1];
const HAND_OVER = /<script>([\s\S]*?)<\/script>/.exec(read('hand-over.html'))[1];
const MOVE_IN = /<script>([\s\S]*?)<\/script>/.exec(read('move-in.html'))[1];

const NEW = 'https://app.sacoro.app';
const OLD = 'https://app.velvetviking.co.uk';
const UID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const session = (uid) => JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', user_id: uid, email: 'athlete@example.com' });
const PLAN = JSON.stringify({ setup: { race: 'Marathon' }, days: [{ date: '2027-01-01', type: 'easy' }] });

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
function timers(){
  const q = [];
  return {
    setTimeout(fn){ q.push(fn); return q.length; },
    setInterval(fn){ q.push(fn); return q.length; },
    clearInterval(){}, clearTimeout(){},
    run(){ while (q.length) q.shift()(); },
  };
}
function el(){
  const listeners = {};
  return { textContent: '', disabled: false, classes: new Set(),
    classList: { toggle(c, on){ on ? this._o.classes.add(c) : this._o.classes.delete(c); } },
    addEventListener(t, fn){ listeners[t] = fn; }, fire(t){ return listeners[t](); } };
}

// ---------------------------------------------------------------------------
// THE OLD ADDRESS'S HALF: /hand-over
// ---------------------------------------------------------------------------
function runHandOver({ host = 'app.velvetviking.co.uk', hash = '#n=' + 'N'.repeat(24), opener = true, ls } = {}){
  const posted = [], t = timers();
  let onMessage = null, closed = 0;
  const say = el();
  const openerWin = opener ? { postMessage(msg, target){ posted.push({ msg, target }); } } : null;
  const window = {
    opener: openerWin, localStorage: ls,
    addEventListener(type, fn){ if (type === 'message') onMessage = fn; },
    close(){ closed++; },
  };
  const box = { window, location: { hostname: host, hash }, document: { getElementById: () => say },
    setTimeout: t.setTimeout, Date, JSON };
  vm.createContext(box);
  new vm.Script(HAND_OVER).runInContext(box);
  return { posted, say, opener: openerWin, deliver: (ev) => onMessage && onMessage(ev), closed: () => closed, timers: t };
}

test('/hand-over posts this address\'s storage to its opener, addressed to app.sacoro.app only', () => {
  const ls = storage({ vvv_cloud_session: session(UID), 'velvet-viking-generator-v2': PLAN, vvv_moved: '1', vvv_move_tries: '2' });
  const h = runHandOver({ ls });
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].target, NEW, 'the browser delivers it to no other opener');
  assert.equal(h.posted[0].msg.type, 'sacoro-hand-over');
  assert.equal(h.posted[0].msg.nonce, 'N'.repeat(24));
  assert.deepEqual(Object.keys(h.posted[0].msg.data).sort(), ['velvet-viking-generator-v2', 'vvv_cloud_session'],
    'everything except the move\'s own bookkeeping');
  assert.equal(ls.getItem('vvv_moved_out'), null, 'not marked moved until the new address says so');
});

test('/hand-over is marked moved only on the new address\'s own answer', () => {
  const ls = storage({ vvv_cloud_session: session(UID) });
  const h = runHandOver({ ls });
  const ok = (over) => Object.assign({ origin: NEW, source: h.opener,
    data: { type: 'sacoro-hand-over-ok', nonce: 'N'.repeat(24), outcome: 'moved' } }, over);
  h.deliver(ok({ origin: 'https://evil.example' }));
  h.deliver(ok({ source: {} }));
  h.deliver(ok({ data: { type: 'sacoro-hand-over-ok', nonce: 'X'.repeat(24), outcome: 'moved' } }));
  assert.equal(ls.getItem('vvv_moved_out'), null, 'another origin, another window or another nonce changes nothing');
  h.deliver(ok());
  assert.match(String(ls.getItem('vvv_moved_out')), /^\d{4}-\d\d-\d\dT/);
  assert.equal(h.closed(), 1, 'and the window closes itself');
});

test('/hand-over: a refusal at the new address leaves the old address unmarked', () => {
  const ls = storage({ vvv_cloud_session: session(UID) });
  const h = runHandOver({ ls });
  h.deliver({ origin: NEW, source: h.opener, data: { type: 'sacoro-hand-over-ok', nonce: 'N'.repeat(24), outcome: 'other-account' } });
  assert.equal(ls.getItem('vvv_moved_out'), null);
  assert.equal(h.closed(), 1);
});

test('/hand-over opened any other way hands nothing over', () => {
  for (const over of [{ opener: false }, { host: 'app.sacoro.app' }, { hash: '' }, { hash: '#n=short' }, { hash: '#vvv-move=x&n=' + 'N'.repeat(24) }]){
    const ls = storage({ vvv_cloud_session: session(UID) });
    const h = runHandOver(Object.assign({ ls }, over));
    assert.equal(h.posted.length, 0, JSON.stringify(over));
    assert.equal(ls.getItem('vvv_moved_out'), null);
  }
});

// ---------------------------------------------------------------------------
// THE NEW ADDRESS'S HALF: /move-in
// ---------------------------------------------------------------------------
function runMoveIn({ host = 'app.sacoro.app', ls = storage(), blocked = false } = {}){
  const t = timers(), opened = [], replaced = [];
  let onMessage = null;
  const state = el(); state.classList._o = state;
  const bring = el();
  const popup = { closed: false, posted: [], postMessage(msg, target){ this.posted.push({ msg, target }); } };
  const window = {
    localStorage: ls,
    open(url, name){ opened.push({ url, name }); return blocked ? null : popup; },
    addEventListener(type, fn){ if (type === 'message') onMessage = fn; },
  };
  const box = { window, location: { hostname: host, replace(u){ replaced.push(u); } },
    document: { getElementById: (id) => (id === 'state' ? state : bring) },
    crypto: webcrypto, btoa, Uint8Array, JSON, Object, String,
    setTimeout: t.setTimeout, setInterval: t.setInterval, clearInterval: t.clearInterval };
  vm.createContext(box);
  new vm.Script(MOVE_IN).runInContext(box);
  return { ls, state, bring, popup, opened, replaced, timers: t,
    tap(){ bring.fire('click'); return opened.length ? /#n=(.+)$/.exec(opened[opened.length - 1].url)[1] : null; },
    deliver(ev){ onMessage && onMessage(ev); } };
}
const handOver = (m, nonce, data, over) => Object.assign({ origin: OLD, source: m.popup,
  data: { type: 'sacoro-hand-over', nonce, data } }, over);

test('/move-in: one tap opens the old address\'s /hand-over with a fresh nonce, and nothing else', () => {
  const m = runMoveIn();
  const n = m.tap();
  assert.equal(m.opened.length, 1);
  assert.match(m.opened[0].url, /^https:\/\/app\.velvetviking\.co\.uk\/hand-over#n=[A-Za-z0-9_-]{16,64}$/);
  assert.ok(n && n.length >= 16);
  assert.equal(m.bring.disabled, true);
  assert.equal(m.state.textContent, 'Copying your data…');
});

test('/move-in: into an empty address, everything is written and SACORO opens signed in', () => {
  const m = runMoveIn();
  const n = m.tap();
  const data = { vvv_cloud_session: session(UID), 'velvet-viking-generator-v2': PLAN, vvv_plan_archive: '[{"name":"Autumn"}]',
                 'sacoro.coachNote.v1': 'hold the long run', vvv_moved_out: 'never copied' };
  m.deliver(handOver(m, n, data));
  for (const k of ['vvv_cloud_session', 'velvet-viking-generator-v2', 'vvv_plan_archive', 'sacoro.coachNote.v1'])
    assert.equal(m.ls.getItem(k), data[k], k);
  assert.equal(m.ls.getItem('vvv_moved_out'), null, 'the old address\'s own marker stays there');
  assert.deepEqual(JSON.parse(JSON.stringify(m.popup.posted)), [{ msg: { type: 'sacoro-hand-over-ok', nonce: n, outcome: 'moved' }, target: OLD }],
    'the answer goes back to the old address only');
  assert.match(m.state.textContent, /^Done\. Your plan, notes and settings are here/);
  m.timers.run();
  assert.deepEqual(m.replaced, ['/']);
});

test('/move-in: an address already in use keeps everything it has, and gains only what it lacks', () => {
  const ls = storage({ vvv_cloud_session: session(UID), 'velvet-viking-generator-v2': '{"days":[{"date":"2027-02-01"}]}' });
  const m = runMoveIn({ ls });
  const n = m.tap();
  m.deliver(handOver(m, n, { vvv_cloud_session: session(UID), 'velvet-viking-generator-v2': PLAN, vvv_plan_archive: '[]', 'sacoro.coachNote.v1': 'note' }));
  assert.equal(ls.getItem('velvet-viking-generator-v2'), '{"days":[{"date":"2027-02-01"}]}', 'nothing here is overwritten');
  assert.equal(ls.getItem('vvv_plan_archive'), '[]');
  assert.equal(ls.getItem('sacoro.coachNote.v1'), 'note');
  assert.equal(m.popup.posted[0].msg.outcome, 'merged');
});

test('/move-in: a different account signed in here gets nothing at all', () => {
  const ls = storage({ vvv_cloud_session: session(OTHER) });
  const m = runMoveIn({ ls });
  const n = m.tap();
  m.deliver(handOver(m, n, { vvv_cloud_session: session(UID), 'velvet-viking-generator-v2': PLAN, 'sacoro.coachNote.v1': 'note' }));
  assert.equal(ls.getItem('sacoro.coachNote.v1'), null);
  assert.equal(JSON.parse(ls.getItem('vvv_cloud_session')).user_id, OTHER);
  assert.equal(m.popup.posted[0].msg.outcome, 'other-account');
  assert.match(m.state.textContent, /signed in to a different account here, so nothing was copied/);
  m.timers.run();
  assert.deepEqual(m.replaced, [], 'and it does not carry on into SACORO');
});

test('/move-in: an old address with nothing worth moving moves nothing', () => {
  const m = runMoveIn();
  const n = m.tap();
  m.deliver(handOver(m, n, { 'vv-gestures-learned': '1' }));
  assert.equal(m.ls.length, 0);
  assert.equal(m.popup.posted[0].msg.outcome, 'nothing');
  assert.equal(m.state.textContent, 'There was nothing to bring across from the old address.');
});

test('/move-in accepts only the old address, only from its own window, only with its own nonce', () => {
  const m = runMoveIn();
  const n = m.tap();
  const data = { vvv_cloud_session: session(UID) };
  m.deliver(handOver(m, n, data, { origin: 'https://evil.example' }));
  m.deliver(handOver(m, n, data, { origin: NEW }));
  m.deliver(handOver(m, n, data, { source: {} }));
  m.deliver(handOver(m, 'Z'.repeat(24), data));
  m.deliver({ origin: OLD, source: m.popup, data: { type: 'something-else', nonce: n, data } });
  assert.equal(m.ls.length, 0, 'nothing was written');
  assert.equal(m.popup.posted.length, 0, 'and nothing was answered');
  // Before any tap there is no nonce, so nothing is accepted either.
  const idle = runMoveIn();
  idle.deliver({ origin: OLD, source: idle.popup, data: { type: 'sacoro-hand-over', nonce: n, data } });
  assert.equal(idle.ls.length, 0);
});

test('/move-in: a blocked window is said so, and the tap can be tried again', () => {
  const m = runMoveIn({ blocked: true });
  m.tap();
  assert.match(m.state.textContent, /stopped the window opening\. Allow pop-ups for app\.sacoro\.app/);
  assert.equal(m.bring.disabled, false);
});

test('/move-in at the old address belongs at the new one', () => {
  const m = runMoveIn({ host: 'app.velvetviking.co.uk' });
  assert.deepEqual(m.replaced, [NEW + '/move-in']);
});

// ---------------------------------------------------------------------------
// THE OLD ADDRESS, ONCE MOVED: the top of the app's <head>
// ---------------------------------------------------------------------------
function runHead({ host = 'app.velvetviking.co.uk', search = '', native = false, ls }){
  const calls = { replaced: null, stopped: 0 };
  const box = {
    window: { localStorage: ls, stop(){ calls.stopped++; }, Capacitor: native ? { isNativePlatform: () => true } : undefined },
    location: { hostname: host, pathname: '/auth', search, hash: '#x', replace(u){ calls.replaced = u; } },
    history: { replaceState(){} }, document: { documentElement: { style: {} }, referrer: '' },
    crypto: webcrypto, btoa, atob, Uint8Array, JSON, Number, String,
  };
  vm.createContext(box);
  new vm.Script(HEAD).runInContext(box);
  return calls;
}

test('a moved browser opening the old address is sent straight on, to the same place', () => {
  const c = runHead({ search: '?a=1', ls: storage({ vvv_moved_out: '2026-11-21T12:00:00.000Z', vvv_cloud_session: session(UID) }) });
  assert.equal(c.replaced, NEW + '/auth?a=1#x');
  assert.equal(c.stopped, 1, 'before the app can load or write');
});

test('the old address keeps serving everyone who has not moved, the installed app, and ?stay=1', () => {
  const moved = () => storage({ vvv_moved_out: '2026-11-21T12:00:00.000Z' });
  assert.equal(runHead({ ls: storage({ vvv_cloud_session: session(UID) }) }).replaced, null, 'not moved: stays');
  assert.equal(runHead({ ls: moved(), native: true }).replaced, null, 'the installed app is never sent on');
  assert.equal(runHead({ ls: moved(), search: '?stay=1' }).replaced, null);
  assert.equal(runHead({ ls: moved(), search: '?a=1&stay=1' }).replaced, null);
  assert.notEqual(runHead({ ls: moved(), search: '?stay=10' }).replaced, null, 'only stay=1 itself');
});

// ---------------------------------------------------------------------------
// THE APP'S OFFER, AT THE OLD ADDRESS ONLY
// ---------------------------------------------------------------------------
function appAt(host, initial, native){
  const app = loadApp({ storage: initial || {} });
  app.location.hostname = host;
  if (native) app.Capacitor = { isNativePlatform: () => true };
  return app;
}

test('the offer is made only to a browser at the old address with something to move', () => {
  const withSession = { vvv_cloud_session: session(UID) };
  assert.equal(appAt('app.velvetviking.co.uk', withSession).browserMoveApplies(), true);
  assert.equal(appAt('app.velvetviking.co.uk', { 'velvet-viking-generator-v2': PLAN }).browserMoveApplies(), true);
  assert.equal(appAt('app.velvetviking.co.uk', {}).browserMoveApplies(), false, 'nothing to move');
  assert.equal(appAt('app.velvetviking.co.uk', Object.assign({ vvv_moved_out: 'x' }, withSession)).browserMoveApplies(), false, 'already moved');
  assert.equal(appAt('app.sacoro.app', withSession).browserMoveApplies(), false, 'the new address');
  assert.equal(appAt('app.velvetviking.co.uk', withSession, true).browserMoveApplies(), false, 'the installed app moves itself');
});

test('Continue saves first, then goes to the new address\'s move page', () => {
  const app = appAt('app.velvetviking.co.uk', { vvv_cloud_session: session(UID) });
  const went = [];
  let saved = 0;
  app.location.assign = (u) => went.push(u);
  app.flushSave = () => { saved++; };
  app.browserMoveGo();
  assert.equal(saved, 1);
  assert.deepEqual(went, [NEW + '/move-in']);
});

test('the sheet and the Settings row say what happens, and lead to the move', () => {
  const app = appAt('app.velvetviking.co.uk', { vvv_cloud_session: session(UID) });
  const body = app.browserMoveSheetBody();
  assert.match(body, /SACORO now lives at app\.sacoro\.app\./);
  assert.match(body, /data-action="browser-move-go">Continue</);
  assert.match(body, /data-action="close-stg-sheet">Not now</);
  assert.equal(/[–—]/.test(body), false, 'no dashes in visible copy');
  assert.match(RUNTIME, /case 'browser-move-open': openStgSheet\('moved'\); break;/);
  assert.match(RUNTIME, /case 'browser-move-go': browserMoveGo\(\); break;/);
  assert.match(RUNTIME, /if \(!appUpdate && browserMoveApplies\(\)\)\{/);
  assert.match(RUNTIME, /window\.setTimeout\(browserMoveOffer, 1200\)/);
});

test('the two pages are routed, and the service worker never answers them with the app', () => {
  const v = JSON.parse(read('vercel.json'));
  const route = (p) => (v.routes || []).find((r) => r.src === p);
  assert.equal(route('/move-in').dest, '/move-in.html');
  assert.equal(route('/hand-over').dest, '/hand-over.html');
  assert.match(read('sw.js'), /url\.pathname === '\/move-in' \|\| url\.pathname === '\/hand-over'\) return;/);
});
