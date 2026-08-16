'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// These drive the REAL request handlers -- api/app.js (delivery) and
// api/session.js (the bridge) -- rather than only the pure resolveAccess()
// function accessGate.test.js already covers. What is untested without this
// file: whether a missing/invalid cookie actually produces a redirect instead
// of a 200, whether a denied session actually clears the cookie instead of
// setting one, and whether the runtime is only ever handed over when the real
// handler's own decision says so. That is the boundary a new athlete's
// "reach Build My Plan only after successful auth" guarantee lives behind --
// there is no client-side gate to test, because the runtime (and everything
// in it, including the plan builder) is simply never delivered.
//
// api/app.js and api/session.js both `require('./_access.js')` and
// `require('./_strava.js')` once, and Node caches that module object -- the
// same object this file gets from `require('../api/_access.js')`. Overwriting
// a property on it here therefore changes what the handler sees too, with no
// network, no real Supabase project and no change to production code.

const A = require('../api/_access.js');
const S = require('../api/_strava.js');
const appHandler = require('../api/app.js');
const sessionHandler = require('../api/session.js');

function mockRes(){
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v){ this.headers[k.toLowerCase()] = v; },
    status(code){ this.statusCode = code; return this; },
    send(body){ this.body = body; return this; },
    end(){ return this; },
  };
}
function mockReq(opts){ return Object.assign({ method: 'GET', headers: {} }, opts || {}); }

function locationWhy(res){
  const loc = res.headers['location'] || '';
  const m = /why=([a-z_]+)/.exec(loc);
  return { location: loc, why: m ? m[1] : null };
}

async function withPatched(mod, patches, fn){
  const saved = {};
  Object.keys(patches).forEach(k => { saved[k] = mod[k]; mod[k] = patches[k]; });
  try{ return await fn(); }
  finally{ Object.keys(saved).forEach(k => { mod[k] = saved[k]; }); }
}

const FAKE_CFG = { serviceKey: 'fake', serviceKeySource: 'test' };

// ---------------------------------------------------------------------------
// api/app.js -- the delivery boundary
// ---------------------------------------------------------------------------

test('gate off: the runtime is served unconditionally, cookie or not', async () => {
  await withPatched(A, { accountRequired: () => false }, async () => {
    const res = mockRes();
    await appHandler(mockReq(), res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body && res.body.length > 1000, 'the real runtime file, not a stub');
  });
});

test('gate on, no cookie at all: refused, not served -- a missing cookie is never success', async () => {
  await withPatched(A, {
    accountRequired: () => true,
    readGateCookie: () => null,
  }, async () => {
    await withPatched(S, { config: () => FAKE_CFG }, async () => {
      const res = mockRes();
      await appHandler(mockReq(), res);
      assert.notEqual(res.statusCode, 200, 'no cookie must never resolve to the runtime');
      const { why } = locationWhy(res);
      assert.equal(res.statusCode, 302);
      assert.equal(why, 'signin');
    });
  });
});

test('gate on, cookie present but the lease is gone (missing/revoked/expired): refused', async () => {
  await withPatched(A, {
    accountRequired: () => true,
    readGateCookie: () => 'some-lease-id',
    resolveLease: async () => null,
  }, async () => {
    await withPatched(S, { config: () => FAKE_CFG }, async () => {
      const res = mockRes();
      await appHandler(mockReq(), res);
      assert.equal(res.statusCode, 302);
      assert.equal(locationWhy(res).why, 'signin');
    });
  });
});

test('gate on, service key unusable: fails closed to the shell, not the runtime', async () => {
  await withPatched(A, { accountRequired: () => true }, async () => {
    await withPatched(S, { config: () => ({ serviceKey: '', serviceKeySource: 'absent' }) }, async () => {
      const res = mockRes();
      await appHandler(mockReq(), res);
      assert.equal(res.statusCode, 302);
      assert.equal(locationWhy(res).why, 'unavailable');
    });
  });
});

test('gate on, an unresolvable entitlement read: fails closed, not open', async () => {
  await withPatched(A, {
    accountRequired: () => true,
    readGateCookie: () => 'lease-1',
    resolveLease: async () => ({ user_id: 'uid-1' }),
    readEntitlement: async () => ({ ok: false }),
  }, async () => {
    await withPatched(S, { config: () => FAKE_CFG }, async () => {
      const res = mockRes();
      await appHandler(mockReq(), res);
      assert.equal(res.statusCode, 302);
      assert.equal(locationWhy(res).why, 'unavailable');
    });
  });
});

test('gate on, the real decision denies access: refused with the matching reason', async () => {
  await withPatched(A, {
    accountRequired: () => true,
    readGateCookie: () => 'lease-1',
    resolveLease: async () => ({ user_id: 'uid-1' }),
    readEntitlement: async () => ({ ok: true, row: {} }),
    resolveAccess: () => ({ allow: false, reason: 'expired' }),
  }, async () => {
    await withPatched(S, { config: () => FAKE_CFG }, async () => {
      const res = mockRes();
      await appHandler(mockReq(), res);
      assert.equal(res.statusCode, 302);
      assert.equal(locationWhy(res).why, 'locked', 'an authenticated-but-denied athlete is told to manage access, not sign in again');
    });
  });
});

test('gate on, the real decision allows: owner, beta and ordinary authenticated accounts all reach the runtime', async () => {
  for (const reason of ['override_owner', 'override_beta', 'pre_commercial']){
    await withPatched(A, {
      accountRequired: () => true,
      readGateCookie: () => 'lease-1',
      resolveLease: async () => ({ user_id: 'uid-1' }),
      readEntitlement: async () => ({ ok: true, row: {} }),
      resolveAccess: () => ({ allow: true, reason }),
    }, async () => {
      await withPatched(S, { config: () => FAKE_CFG }, async () => {
        const res = mockRes();
        await appHandler(mockReq(), res);
        assert.equal(res.statusCode, 200, reason + ' must reach the runtime');
      });
    });
  }
});

test('a new athlete cannot reach Build My Plan (or anything else) without a passing decision -- there is no second path to the runtime', async () => {
  // The plan builder lives inside the runtime HTML. If the gate denies, the
  // handler never sends that file at all, so there is nothing to "reach" --
  // this is the guarantee, proven at the one place it can be broken.
  await withPatched(A, {
    accountRequired: () => true,
    readGateCookie: () => null,
  }, async () => {
    await withPatched(S, { config: () => FAKE_CFG }, async () => {
      const res = mockRes();
      await appHandler(mockReq(), res);
      assert.notEqual(res.statusCode, 200);
      assert.equal(res.body, null, 'no bytes of the runtime were ever written to the response');
    });
  });
});

// ---------------------------------------------------------------------------
// api/session.js -- the bridge
// ---------------------------------------------------------------------------

test('POST /api/session with no verifiable token: 401, and any existing cookie is cleared', async () => {
  await withPatched(S, {
    config: () => FAKE_CFG,
    verifyUser: async () => ({ uid: null, code: 'AUTH_HEADER_MISSING', diag: {} }),
  }, async () => {
    const res = mockRes();
    await sessionHandler(mockReq({ method: 'POST' }), res);
    assert.equal(res.statusCode, 401);
    assert.match(res.headers['set-cookie'], /vvv_gate=;.*Max-Age=0/);
  });
});

test('POST /api/session, service key unusable: 503, nothing minted', async () => {
  await withPatched(S, { config: () => ({ serviceKey: '', serviceKeySource: 'absent' }) }, async () => {
    const res = mockRes();
    await sessionHandler(mockReq({ method: 'POST' }), res);
    assert.equal(res.statusCode, 503);
  });
});

test('POST /api/session, the decision denies: 403, cookie cleared, no lease created', async () => {
  let leaseCreated = false;
  await withPatched(S, {
    config: () => FAKE_CFG,
    verifyUser: async () => ({ uid: 'uid-1', email: 'a@b.c' }),
  }, async () => {
    await withPatched(A, {
      readEntitlement: async () => ({ ok: true, row: {} }),
      resolveAccess: () => ({ allow: false, reason: 'no_account', capabilities: [] }),
      createLease: async () => { leaseCreated = true; return { ok: true, id: 'x', ttl: 100 }; },
    }, async () => {
      const res = mockRes();
      await sessionHandler(mockReq({ method: 'POST', headers: { authorization: 'Bearer t' } }), res);
      assert.equal(res.statusCode, 403);
      assert.match(res.headers['set-cookie'], /Max-Age=0/);
      assert.equal(leaseCreated, false, 'a denied athlete is never issued a lease');
    });
  });
});

test('POST /api/session, the decision allows: 200, a real lease-backed cookie is set', async () => {
  await withPatched(S, {
    config: () => FAKE_CFG,
    verifyUser: async () => ({ uid: 'uid-1', email: 'a@b.c' }),
  }, async () => {
    await withPatched(A, {
      readEntitlement: async () => ({ ok: true, row: {} }),
      resolveAccess: () => ({ allow: true, reason: 'pre_commercial', capabilities: ['core_coach'] }),
      createLease: async () => ({ ok: true, id: 'lease-xyz', ttl: 100 }),
    }, async () => {
      const res = mockRes();
      await sessionHandler(mockReq({ method: 'POST', headers: { authorization: 'Bearer t' } }), res);
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['set-cookie'], /^vvv_gate=lease-xyz;/);
      const payload = JSON.parse(res.body);
      assert.equal(payload.signed_in, true);
      assert.equal(payload.access, true);
    });
  });
});

test('DELETE /api/session clears the cookie and revokes the lease it named', async () => {
  let revokedId = null;
  await withPatched(A, {
    readGateCookie: () => 'lease-to-kill',
    revokeLease: async (_S, _cfg, id) => { revokedId = id; },
  }, async () => {
    await withPatched(S, { config: () => FAKE_CFG }, async () => {
      const res = mockRes();
      await sessionHandler(mockReq({ method: 'DELETE' }), res);
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['set-cookie'], /Max-Age=0/);
      assert.equal(revokedId, 'lease-to-kill');
      assert.deepEqual(JSON.parse(res.body), { signed_out: true });
    });
  });
});
