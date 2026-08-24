'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Making an account mandatory means every existing athlete meets a sign-in
// screen holding a plan they built without one. That is the single riskiest
// moment in Phase 3, and the answer is that it introduces no new path: the
// gate forces sign-in, and sign-in runs the ownership resolution and cloud
// reconciliation that Phase 1 and 2B already made green.
//
// These tests re-prove the migration transitions THROUGH that lens, and pin the
// new obligations the delivery cookie adds -- principally that signing out or
// deleting an account must not leave a working product behind on the device.
const PINNED = '2026-03-11T09:00:00Z';
const OLD = 'uid-old-1111', NEW = 'uid-new-2222';

function app() { return loadApp({ pinnedDate: PINNED }); }
function withPlan(a, opts) {
  buildPlan(a, Object.assign({ weeks: 12, startDate: a.addDays(a.todayStr(), -42) }, opts || {}));
  const today = a.todayStr();
  a.state.days.filter(d => d.date < today && d.type !== 'rest').forEach(d => {
    d.completed = true;
    d.actual = { km: d.km, pace: '5:30', hr: 145, rpe: 4, notes: '' };
  });
  return a;
}
const shape = a => ({
  days: (a.state.days || []).length,
  done: (a.state.days || []).filter(d => d.completed).length,
});

/* Records the calls the app makes to /api/session without a network. The point
   is not to test fetch -- it is to prove the app ASKS at the right moments,
   because a bridge that is never called is the failure that only shows up on
   the next cold start. */
function captureSessionCalls(a) {
  const calls = [];
  a.fetch = function (url, opts) {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ access: true, tier: 'standard', capabilities: [] }),
    });
  };
  return calls;
}
const sessionCalls = calls => calls.filter(c => /\/api\/session$/.test(c.url));

// ---------------------------------------------------------------------------
// THE MIGRATION TRANSITIONS
// ---------------------------------------------------------------------------
test('an unowned local plan is adopted by the first account to sign in', () => {
  const a = withPlan(app());
  const before = shape(a);
  a.persistStateLocalOnly();
  assert.equal(a.planOwnerUid(), null, 'precondition: built before accounts were required');

  assert.equal(a.resolvePlanOwnership(NEW), 'legacy-adopted');
  assert.deepEqual(shape(a), before, 'every session and every logged run survives the gate');
  assert.equal(a.planOwnerUid(), NEW);
});

test('an athlete signing back into their own account keeps their plan untouched', () => {
  const a = withPlan(app());
  a.stampPlanOwner(NEW);
  a.persistStateLocalOnly();
  const before = shape(a);
  assert.equal(a.resolvePlanOwnership(NEW), 'own');
  assert.deepEqual(shape(a), before);
});

test('a plan belonging to someone else is parked, never handed over', () => {
  const a = withPlan(app());
  a.stampPlanOwner(OLD);
  a.persistStateLocalOnly();
  const before = shape(a);

  assert.equal(a.resolvePlanOwnership(NEW), 'cleared');
  assert.equal(shape(a).days, 0, 'the new account starts clean');
  const arch = a.readPlanArchive();
  assert.ok(arch[OLD], 'and the previous athlete’s plan is parked, not destroyed');
  assert.equal(arch[OLD].state.days.length, before.days);
});

test('a parked plan is returned to the account that owns it', () => {
  const a = withPlan(app());
  a.stampPlanOwner(OLD);
  a.persistStateLocalOnly();
  const before = shape(a);
  a.resolvePlanOwnership(NEW);              // parks it
  assert.equal(a.resolvePlanOwnership(OLD), 'restored');
  assert.deepEqual(shape(a), before);
});

test('the recovery route still finds a plan parked by the migration', () => {
  const a = withPlan(app());
  a.stampPlanOwner(OLD);
  a.persistStateLocalOnly();
  a.resolvePlanOwnership(NEW);
  const found = a.recoverablePlans();
  assert.equal(found.length, 1, 'Phase 1 recovery must survive the account gate');
  assert.equal(found[0].key, 'archive:' + OLD);
});

test('identical local and cloud copies are not a conflict at migration', () => {
  const a = withPlan(app());
  const remote = JSON.parse(JSON.stringify(a.state));
  assert.equal(a.planContentSignature(a.state), a.planContentSignature(remote),
    'signing in must not raise a question that has no answer');
});

test('genuinely different copies stay distinguishable, so the athlete is asked', () => {
  const a = withPlan(app());
  const remote = JSON.parse(JSON.stringify(a.state));
  remote.days[0].km = remote.days[0].km + 3;
  assert.notEqual(a.planContentSignature(a.state), a.planContentSignature(remote));
});

// ---------------------------------------------------------------------------
// THE DELIVERY SESSION IS ESTABLISHED AND REVOKED AT THE RIGHT MOMENTS
// ---------------------------------------------------------------------------
test('signing out revokes the delivery lease, not just the local session', async () => {
  const a = withPlan(app());
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  const calls = captureSessionCalls(a);

  a.cloudSignOut();
  await new Promise(r => setImmediate(r));

  const del = sessionCalls(calls).filter(c => c.method === 'DELETE');
  assert.equal(del.length, 1,
    'a cleared localStorage session with a live cookie still opens the product');
  assert.equal(a.cloudSession, null);
});

test('the revocation is sent while the token still exists to authorise it', () => {
  const a = withPlan(app());
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  let sessionAtCall = 'not-called';
  a.fetch = function (url, opts) {
    if (/\/api\/session$/.test(String(url)) && opts && opts.method === 'DELETE') {
      sessionAtCall = a.cloudSession;
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };
  a.cloudSignOut();
  assert.notEqual(sessionAtCall, 'not-called', 'the call must happen');
  assert.ok(sessionAtCall, 'and before cloudSession is cleared, or it cannot be authorised');
});

test('the app asks for a lease when a native sign-in link is consumed', () => {
  const a = app();
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = src.slice(src.indexOf('function handleAuthDeepLink'),
                       src.indexOf('function cloudInitDeepLinks'));
  assert.match(fn, /establishDeliverySession/,
    'the custom-scheme return is not an https response, so no cookie rides back on it — ' +
    'without an explicit exchange the athlete is bounced out at the next cold start');
  assert.ok(typeof a.establishDeliverySession === 'function');
  assert.ok(typeof a.revalidateDeliverySession === 'function');
});

test('returning to the foreground revalidates rather than trusting a stale lease', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const handler = src.slice(src.indexOf("var STRAVA_AWAY_MS"),
                            src.indexOf("window.addEventListener('pagehide'"));
  assert.match(handler, /revalidateDeliverySession/,
    'Android resume does not re-run init(), so nothing else would notice an expired lease');
});

test('revalidation is rate limited, so glancing at the app is not a request storm', async () => {
  const a = withPlan(app());
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  const calls = captureSessionCalls(a);
  await a.establishDeliverySession();
  await a.revalidateDeliverySession();
  await a.revalidateDeliverySession();
  assert.equal(sessionCalls(calls).length, 1, 'one exchange, then a quiet window');
});

test('the entitlement the client holds is display-only and grants nothing', async () => {
  const a = withPlan(app());
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  captureSessionCalls(a);
  await a.establishDeliverySession();
  // a tampered client promoting itself
  a.entitlementInfo = { access: true, tier: 'pro', capabilities: ['everything'], override: 'owner' };
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const script = src.slice(src.indexOf('<script>'));
  assert.ok(!/if\s*\(\s*entitlementInfo\s*(&&\s*entitlementInfo\.)?(access|tier)/.test(script),
    'no branch may decide what the athlete can do from a value the client can edit');
});

test('an offline exchange failure does not break a working app', async () => {
  const a = withPlan(app());
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  a.fetch = () => Promise.reject(new Error('offline'));
  const before = shape(a);
  const got = await a.establishDeliverySession();
  assert.equal(got, null, 'it reports failure');
  assert.deepEqual(shape(a), before, 'and changes nothing — the existing lease still stands');
});

test('the bridge is never called for a signed-out athlete', async () => {
  const a = withPlan(app());
  a.cloudSession = null;
  const calls = captureSessionCalls(a);
  assert.equal(await a.establishDeliverySession(), null);
  assert.equal(sessionCalls(calls).length, 0, 'there is no token to exchange');
});

// ---------------------------------------------------------------------------
// ACCOUNT DELETION -- PHASE 2B GUARANTEES MUST SURVIVE
// ---------------------------------------------------------------------------
test('deletion still releases the ownership stamp, so the plan is not stranded', () => {
  const a = withPlan(app());
  a.stampPlanOwner(OLD);
  a.persistStateLocalOnly();
  const before = shape(a);

  // exactly what the delete handler does to local state after the RPC succeeds
  delete a.state.ownerUid;
  a.persistStateLocalOnly();

  assert.equal(a.planOwnerUid(), null);
  assert.equal(a.resolvePlanOwnership(NEW), 'legacy-adopted',
    're-signing in after deletion adopts the plan rather than parking it — the Phase 2B fix');
  assert.deepEqual(shape(a), before, 'and the plan is whole');
});

test('the delete path revokes the delivery cookie too', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const region = src.slice(src.indexOf("rpc/delete_own_account"),
                           src.indexOf("RELEASE THE OWNERSHIP STAMP"));
  assert.match(region, /ENTITLEMENT_ENDPOINT[\s\S]*DELETE/,
    'a deleted account must not leave a browser still holding a working product');
});

test('deletion does not touch the local plan or the archive', () => {
  const a = withPlan(app());
  a.stampPlanOwner(OLD);
  a.archivePlanFor('someone-else', JSON.parse(JSON.stringify(a.state)));
  a.persistStateLocalOnly();
  const archBefore = a.localStorage.getItem('vvv_plan_archive');
  const planBefore = a.localStorage.getItem('velvet-viking-generator-v2');

  delete a.state.ownerUid;
  a.persistStateLocalOnly();

  assert.equal(a.localStorage.getItem('vvv_plan_archive'), archBefore, 'archive untouched');
  assert.ok(a.localStorage.getItem('velvet-viking-generator-v2'), 'plan still stored');
  assert.notEqual(planBefore, null);
});

// ---------------------------------------------------------------------------
// THE SHELL
// ---------------------------------------------------------------------------
test('the account shell is public, small, and carries no coaching engine', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'account.html'), 'utf8');
  /* Re-baselined for Phase 3A2, which added the locked shell -- the four
     things an athlete keeps when they have no entitlement. That is the
     phase's deliverable, so the page legitimately grew.

     The ceiling is not the real guard and never was: a shell that stayed
     under 20KB while importing the coaching engine would pass a byte count
     and fail the point. The symbol list below is what actually holds, and it
     is unchanged. The number is here to make growth a DECISION -- if a later
     phase needs to raise it again, somebody has to write down why.

     RAISED TO 29KB FOR PHASE 2 WEB BILLING, and here is the why. The shell held
     the product's only purchase control, and that control POSTed
     {action:'resubscribe'} to an endpoint that read a URL out of the
     environment -- no offer validation, no duplicate-subscription check, no
     commerce flag, no provider customer. Retiring it means the shell now does
     three things it did not: render the offers the server says are actually
     purchasable, start the real checkout by naming a PERIOD, and hand the
     returning session id to the server so entitlement is re-derived from the
     provider rather than believed from a query string. That is roughly 2.8KB,
     it is all door and none of it is product, and the symbol list below still
     holds unchanged.

     RAISED AGAIN TO 33KB FOR COMMERCIAL COMMISSIONING. Two things a paying
     customer has to be shown before a card is taken: the two agreements --
     Terms, and the acknowledgement that they are asking us to begin the service
     inside the statutory cancellation period -- and the actual calendar date of
     the first charge alongside "£0 today". Both are rendered from server-owned
     wording and a server-computed instant, so the growth is markup and
     plumbing rather than content this page decides. Still all door.

     RAISED TO 34.5KB FOR THE CANONICAL-DOCUMENTS WIRING. Under a kilobyte,
     and it removes content rather than adding any: the Terms and Privacy
     links are no longer written here at all but read from the server's
     payload, plus a short honest notice for the case where no commercial
     Terms have been published and there is therefore nothing to tick. The
     page now holds LESS legal text than it did, not more -- what grew is the
     plumbing that stops this shell deciding anything for itself. */
  assert.ok(shell.length < 34500, 'the shell must stay a shell (' + shell.length + ' bytes)');
  ['coachDecision', 'playbookAssess', 'athleteMemory', 'buildBlockWeeks', 'ARCHETYPE_GUIDANCE']
    .forEach(sym => assert.ok(shell.indexOf(sym) === -1, 'shell must not contain ' + sym));
});

test('the shell can complete a magic-link return, since the gate redirects them to it', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'account.html'), 'utf8');
  assert.match(shell, /access_token/, 'it must read the fragment the gate bounced here');
  assert.match(shell, /\/api\/session/, 'and exchange it for a delivery cookie');
  assert.match(shell, /history\.replaceState|location\.hash\s*=\s*''/,
    'and strip the tokens so a copied URL cannot carry a live session');
});

test('the shell still names no price and makes no claim', () => {
  /* Superseded by Phase 3A2, exactly as this test's original name anticipated.
     The shell may now speak about subscriptions -- that is the whole locked
     shell, and refusing the vocabulary would mean a lapsed athlete could not
     be told what happened to them.

     What has NOT changed is where a price may live. _access.js states it: the
     capability map is not a pricing table, and the commercial meaning of a
     tier belongs to the payment provider and the offering. A number on this
     page is a second source of truth for what something costs, and the second
     one is always the one that goes stale. Marketing claims stay out for the
     older reason -- this product does not make claims it has not earned. */
  const shell = fs.readFileSync(path.join(__dirname, '..', 'account.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  /* ZERO IS NOT A PRICE, and the distinction is the rule's own reasoning applied
     rather than relaxed. What must not appear is a figure for what the product
     COSTS -- that number lives in the catalogue, and a copy of it here is the
     copy that goes stale. "£0 today" is not that number: it is the amount taken
     during a trial, it is zero by construction of a trial rather than by a
     commercial decision, and it cannot drift because there is nothing for it to
     drift from. It is also required disclosure -- an athlete handing over a card
     is entitled to be told plainly that nothing is taken today.

     The actual prices on this page still come from the server: priceAmount()
     renders o.priceMinor and o.currency straight off the catalogue, so a price
     change reaches this screen without anybody editing it. The pattern below
     therefore forbids a currency symbol followed by a NON-ZERO digit, which is
     exactly the thing that could ever be wrong. */
  [/£\s*[1-9]/, /\$\s*[1-9]/, /€\s*[1-9]/, /£\s*0\.\d*[1-9]/,
   /\bper month\b/i, /\ba month\b/i, /\bcancel any ?time\b/i,
   /\bfree forever\b/i, /\bmoney[- ]back\b/i, /\bbest value\b/i, /\bPro\b/]
    .forEach(rx => assert.ok(!rx.test(shell), 'a price or a claim reached the shell: ' + rx));

  /* And the prices that ARE shown must still be server-derived, never typed. */
  assert.match(shell, /o\.priceMinor \/ 100/, 'the amount must come from the catalogue');
});

test('legal routes stay reachable without any entitlement', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const dests = (cfg.routes || []).map(r => r.dest).filter(Boolean);
  ['/privacy.html', '/terms.html', '/account.html'].forEach(d => {
    assert.ok(dests.indexOf(d) !== -1, d + ' must not sit behind the gate');
  });
});
