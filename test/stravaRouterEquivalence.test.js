'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// STRAVA ROUTER EQUIVALENCE.
//
// Six Strava endpoints became six _-prefixed modules behind one router, purely
// so the deployment stops sitting at 12/12 Serverless Functions. Packaging, not
// capability -- which is a claim that has to be PROVEN rather than asserted,
// because two of these paths are registered with a third party and one of them
// writes OAuth tokens.
//
// So this file checks three separate things:
//   1. the handler bodies are byte-identical to the ones on the merge base,
//      except for the single export line that had to change
//   2. every public URL still resolves to the handler it used to reach
//   3. the resolution survives losing the rewrite, losing req.query, and
//      anything unrecognised is refused rather than guessed
const ROOT = path.join(__dirname, '..');
const ROUTES = ['strava-auth', 'strava-callback', 'strava-enabled',
                'strava-sync', 'strava-webhook', 'strava-admin'];

const router = require(path.join(ROOT, 'api', 'strava.js'));

test('the router serves exactly the six routes that used to be six functions', () => {
  assert.deepEqual(router.ROUTES.slice().sort(), ROUTES.slice().sort());
});

test('every handler module still exposes handle()', () => {
  ROUTES.forEach(r => {
    const m = require(path.join(ROOT, 'api', '_' + r + '.js'));
    assert.equal(typeof m.handle, 'function', r + ': no handle()');
  });
});

test('the handler bodies are unchanged apart from the export line', () => {
  /* The strongest available evidence that this was packaging and not a
     rewrite: diff each module against the same file on the merge base and
     require that every changed line is the export. If a single line of OAuth,
     token or webhook logic moved, this fails and the consolidation is not
     behaviour-preserving. */
  let base;
  try {
    base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'],
                        { cwd: ROOT }).toString().trim();
  } catch (e) {
    return; // no git / no origin in this environment -- the other tests still run
  }
  ROUTES.forEach(r => {
    let before;
    try {
      before = execFileSync('git', ['show', base + ':api/' + r + '.js'],
                            { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 }).toString();
    } catch (e) {
      return; // file did not exist at the base (nothing to compare)
    }
    const after = fs.readFileSync(path.join(ROOT, 'api', '_' + r + '.js'), 'utf8');

    const normalise = s => s
      .replace(/^module\.exports = async function handler\(req, res\)\{$/m, '@@HANDLER@@')
      .replace(/^async function handle\(req, res\)\{$/m, '@@HANDLER@@')
      .replace(/\n*module\.exports = \{ handle \};\n*$/, '\n')
      .replace(/\s+$/, '');

    assert.equal(normalise(after), normalise(before),
      r + ': the handler body changed — this is no longer a packaging-only move');
  });
});

// ---- resolution ----------------------------------------------------------
const asReq = (url, query) => ({ url: url, query: query || {} });

test('each public URL resolves to its own handler, via the rewrite', () => {
  ROUTES.forEach(r => {
    assert.equal(router.resolveRoute(asReq('/api/strava?route=' + r, { route: r })), r);
  });
});

test('resolution survives the platform not populating req.query', () => {
  ROUTES.forEach(r => {
    assert.equal(router.resolveRoute(asReq('/api/strava?route=' + r, null)), r,
      r + ': did not fall back to parsing req.url');
  });
});

test('resolution survives the rewrite being removed entirely', () => {
  /* The path fallback is why ROUTES is keyed by the public segment. An OAuth
     callback arriving at /api/strava-callback with no rewrite must still reach
     the callback handler rather than 404 an athlete mid-authorization. */
  ROUTES.forEach(r => {
    assert.equal(router.resolveRoute(asReq('/api/' + r, {})), r);
    assert.equal(router.resolveRoute(asReq('/api/' + r + '?code=abc&state=xyz', {})), r);
  });
});

test('an unrecognised route is refused, never guessed', () => {
  ['', '/api/strava', '/api/strava?route=', '/api/strava-nope',
   '/api/strava?route=../_strava', '/api/strava?route=_strava',
   '/api/strava?route=constructor', '/api/strava?route=__proto__']
    .forEach(u => assert.equal(router.resolveRoute(asReq(u, {})), null, u + ' resolved to something'));
  // and a prototype key cannot be smuggled in through req.query either
  assert.equal(router.resolveRoute(asReq('/x', { route: 'constructor' })), null);
  assert.equal(router.resolveRoute(asReq('/x', { route: '__proto__' })), null);
});

test('an unroutable request is a 404 and says nothing about the router', () => {
  // The shape S.json() actually writes to: setHeader, then status().send().
  let code = null, body = null;
  const res = { setHeader(){},
                status(s){ code = s; return this; },
                send(b){ body = b; } };
  return router({ url: '/api/strava', query: {}, method: 'GET' }, res).then(() => {
    assert.equal(code, 404);
    assert.match(String(body), /not_found/);
    assert.doesNotMatch(String(body), /strava-auth|strava-callback|route/);
  });
});

// ---- the URLs a third party holds ----------------------------------------
test('the two externally registered URLs are unchanged', () => {
  /* redirect_uri is registered on the Strava application and callback_url on
     the webhook subscription. Both are built from hardcoded strings rather
     than from req.url, which is what makes them survive being served by a
     different function -- so the test is that those strings still say what
     Strava has on file. */
  const S = fs.readFileSync(path.join(ROOT, 'api', '_strava.js'), 'utf8');
  assert.match(S, /siteOrigin\(req\)\s*\+\s*'\/api\/strava-callback'/,
    'the OAuth redirect_uri moved — every existing Strava authorization breaks');
  const admin = fs.readFileSync(path.join(ROOT, 'api', '_strava-admin.js'), 'utf8');
  assert.match(admin, /'\/api\/strava-webhook'/,
    'the webhook callback_url moved — Strava would deliver to a dead path');
});

test('vercel.json rewrites all six paths onto the one function', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const routes = v.routes || [];
  ROUTES.forEach(r => {
    const hit = routes.find(x => x.src === '/api/' + r);
    assert.ok(hit, 'no rewrite for /api/' + r);
    assert.equal(hit.dest, '/api/strava?route=' + r);
  });
  // and they are all ahead of the filesystem handler, or they never match
  const fsIdx = routes.findIndex(x => x.handle === 'filesystem');
  ROUTES.forEach(r => {
    assert.ok(routes.findIndex(x => x.src === '/api/' + r) < fsIdx,
      '/api/' + r + ' is routed after the filesystem handler');
  });
});

test('the old endpoint files are gone, or the budget saving is imaginary', () => {
  ROUTES.forEach(r => {
    assert.ok(!fs.existsSync(path.join(ROOT, 'api', r + '.js')),
      'api/' + r + '.js still exists and still counts as a function');
    assert.ok(fs.existsSync(path.join(ROOT, 'api', '_' + r + '.js')),
      'api/_' + r + '.js is missing');
  });
});

test('the client still calls the same paths it always did', () => {
  const app = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  // Whatever the browser fetches must be a path the rewrites cover.
  const called = [...app.matchAll(/['"]\/api\/(strava[a-z-]*)['"]/g)].map(m => m[1]);
  assert.ok(called.length, 'the app no longer calls Strava at all');
  [...new Set(called)].forEach(p => {
    assert.ok(ROUTES.indexOf(p) > -1 || p === 'strava',
      'the app calls /api/' + p + ' which the router does not serve');
  });
});
