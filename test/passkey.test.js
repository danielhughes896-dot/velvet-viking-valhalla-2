'use strict';
/* PASSKEY SIGN-IN -- the behavioural contract.
   ============================================================================

   What these tests are actually protecting is not "the passkey works". It is
   the set of promises that had to hold before a second front door could be cut
   into an authenticated product at all:

     * the magic link is never removed, on any surface, in any state;
     * a passkey cannot create an account, so it cannot walk around the beta
       allowlist, the trial, the entitlement or the consent rules;
     * a passkey session is the SAME session, resolving to the SAME user id,
       and therefore to the same plan and the same history -- never a second
       account;
     * no password exists anywhere, and nothing biometric is ever collected,
       transmitted or stored;
     * a device that cannot do this is shown the product it always had.

   Each of those is a thing that could be broken later by a change that looks
   entirely reasonable in isolation, which is exactly what a regression suite
   is for. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* The harness deliberately gives the app a browser with no WebAuthn, because
   that is the honest default for a Node sandbox. Tests that need a capable
   device say so explicitly, which also means every test states which of the
   two worlds it is asserting about. */
function withWebAuthn(app, hooks) {
  const h = hooks || {};
  app.window.PublicKeyCredential = function PublicKeyCredential(){};
  app.window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable =
    () => Promise.resolve(h.platform !== false);
  app.navigator.credentials = {
    create: h.create || (() => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))),
    get:    h.get    || (() => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))),
  };
  return app;
}

/* A stand-in for GoTrue that records what it was asked and answers from a
   script. Every test that asserts about the wire uses this rather than a
   hand-written expectation of what the code "probably" sends. */
function stubFetch(app, routes) {
  const calls = [];
  app.fetch = function(url, opts){
    opts = opts || {};
    calls.push({ url: String(url), method: opts.method || 'GET',
                 headers: opts.headers || {},
                 body: opts.body ? JSON.parse(opts.body) : null });
    for (const key of Object.keys(routes)) {
      if (String(url).indexOf(key) !== -1) {
        const r = routes[key];
        return Promise.resolve({
          ok: r.status ? r.status < 400 : true,
          status: r.status || 200,
          json: () => Promise.resolve(r.body === undefined ? {} : r.body),
        });
      }
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
  return calls;
}

/* A WebAuthn assertion in the shape a real browser hands back, minus toJSON --
   which forces the manual serialiser to run, because that is the path older
   browsers take and the one that can silently produce the wrong encoding. */
function fakeAssertion() {
  const bytes = (n, seed) => {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = (seed + i * 31) & 0xff;
    return a.buffer;
  };
  return {
    id: 'Y3JlZC1pZA',
    type: 'public-key',
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
    response: {
      clientDataJSON: bytes(24, 1),
      authenticatorData: bytes(37, 7),
      signature: bytes(64, 11),
      userHandle: bytes(16, 3),
    },
  };
}

/* Assertions about "this function does not do X" have to look at code, not at
   the prose around it -- a comment explaining that the trial gates are NOT
   touched here contains the word "trial", and a test that cannot tell those
   apart is a test that fails for being right. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const SESSION = {
  access_token: 'access-abc', refresh_token: 'refresh-xyz', expires_in: 3600,
  user: { id: 'user-0001', email: 'athlete@example.com' },
};

// ---------------------------------------------------------------------------
// 1. THE MAGIC LINK IS NEVER TAKEN AWAY
// ---------------------------------------------------------------------------

test('1. every sign-in surface still offers the email link when passkeys exist', () => {
  const app = withWebAuthn(loadApp());
  const html = app.renderSignInOptions('lede');
  assert.ok(html.indexOf('data-action="cloud-sign-in"') !== -1, 'the magic-link control is still there');
  assert.ok(html.indexOf('id="cloud-email"') !== -1, 'and so is the address field it needs');
  assert.ok(html.indexOf('data-action="passkey-sign-in"') !== -1, 'alongside the passkey');
});

test('2. a device without WebAuthn is shown exactly the surface it always had', () => {
  const app = loadApp();   // no WebAuthn
  const html = app.renderSignInOptions('Sign in to back your plan up.');
  assert.ok(html.indexOf('passkey') === -1, 'nothing about passkeys is mentioned at all');
  assert.ok(html.indexOf('data-action="cloud-sign-in"') !== -1);
  assert.ok(html.indexOf('btn-primary') !== -1,
    'and the email link is the PRIMARY control again, not a demoted one');
  /* AND THE COPY DOES NOT PROMISE WHAT THE DEVICE CANNOT DO. Naming a passkey
     here would describe a capability this browser does not have. */
  assert.match(html, /no password for you to create or remember — we email you a link/);
});

test('2b. the same surface names the passkey only where one is actually possible', () => {
  const html = withWebAuthn(loadApp()).renderSignInOptions('Sign in to back your plan up.');
  assert.match(html, /a passkey on this device, or a link we email you/);
  /* Provable in both worlds: no password, and the email link never disappears. */
  assert.match(html, /no password for you to create or remember/);
  for (const file of ['account.html']) {
    const src = read(file).replace(/<!--[\s\S]*?-->/g, ' ');
    const staticLede = src.slice(src.indexOf('<p id="lede">'), src.indexOf('</p>', src.indexOf('<p id="lede">')));
    assert.ok(staticLede.indexOf('passkey') === -1,
      file + ' does not claim a passkey before script has proven the device has one');
  }
});

test('3. the passkey demotes the email link visually and in nothing else', () => {
  const bare = loadApp().renderSignInOptions('lede');
  const withPk = withWebAuthn(loadApp()).renderSignInOptions('lede');
  const action = /data-action="cloud-sign-in"/g;
  assert.equal((bare.match(action) || []).length, 1);
  assert.equal((withPk.match(action) || []).length, 1);
  assert.ok(bare.indexOf('class="btn btn-primary btn-block" data-action="cloud-sign-in"') !== -1);
  assert.ok(withPk.indexOf('class="btn btn-ghost btn-block" data-action="cloud-sign-in"') !== -1,
    'ghost rather than primary -- the only thing that changed');
});

test('4. the front-door shells keep their email control and gain the passkey', () => {
  for (const file of ['account.html', 'start.html']) {
    const src = read(file);
    assert.ok(/id="send"/.test(src), file + ' still has the magic-link button');
    assert.ok(/beta-signin/.test(src), file + ' still posts to the magic-link endpoint');
    assert.ok(/id="passkey"/.test(src), file + ' offers a passkey too');
    assert.ok(/id="passkey-block" class="vvv-hidden"/.test(src),
      file + ' hides the passkey control until script proves the device can use it');
  }
});

// ---------------------------------------------------------------------------
// 2. NO PASSWORD, ANYWHERE, EVER
// ---------------------------------------------------------------------------

test('5. nothing in the passkey work introduces a password or a password reset', () => {
  const sources = ['passkey.js', 'account.html', 'start.html',
                   path.join('protected', 'velvet-viking-valhalla.html')];
  for (const f of sources) {
    const src = read(f);
    assert.ok(!/type="password"/i.test(src), f + ' has no password input');
    assert.ok(!/autocomplete="(current|new)-password"/i.test(src), f + ' asks for no password');
    assert.ok(!/\/auth\/v1\/(token\?grant_type=password|recover)/.test(src),
      f + ' calls no password or password-reset endpoint');
  }
});

test('6. no biometric is collected, transmitted or stored', () => {
  const src = read('passkey.js') + read(path.join('protected', 'velvet-viking-valhalla.html'));
  /* The words may appear in copy explaining that we do NOT receive them. What
     must never appear is code that reads one. */
  for (const forbidden of [/navigator\.\w*[Bb]iometric/, /getFingerprint/, /faceId\s*[:=]/i,
                           /biometricTemplate/i, /\.enroll\w*Fingerprint/i]) {
    assert.ok(!forbidden.test(src), 'no biometric capture: ' + forbidden);
  }
  const app = withWebAuthn(loadApp());
  const copy = app.renderSignInOptions('lede');
  assert.match(copy, /never sent your fingerprint or your face/,
    'and the athlete is told so in the one place they are asked to use it');
});

test('7. no authentication secret is written to local storage by the passkey path', () => {
  const app = withWebAuthn(loadApp(), { get: () => Promise.resolve(fakeAssertion()) });
  stubFetch(app, {
    'authentication/options': { body: { challenge_id: 'c1', options: { challenge: 'Y2hhbA' } } },
    'authentication/verify':  { body: SESSION },
  });
  const before = new Set(Object.keys(app.localStorage).length ? [] : []);
  return app.passkeySignIn().then(() => {
    /* The ONLY thing that lands is the Supabase session -- the identical
       artefact the magic link produces. No credential, no private key, no
       challenge, no passkey list. */
    const raw = app.localStorage.getItem('vvv_cloud_session');
    assert.ok(raw, 'the session is stored, as it is for the magic link');
    const kept = JSON.parse(raw);
    assert.deepEqual(Object.keys(kept).sort(),
      ['access_token', 'email', 'expires_at', 'refresh_token', 'user_id'].sort());
    assert.ok(!/credential|privateKey|challenge|attestation|publicKey/i.test(raw),
      'nothing WebAuthn-shaped is persisted');
    assert.ok(before.size === 0);
  });
});

// ---------------------------------------------------------------------------
// 3. THE SAME ACCOUNT, NEVER A SECOND ONE
// ---------------------------------------------------------------------------

test('8. a passkey session is stored in the same shape and slot as a magic-link one', () => {
  const link = loadApp();
  link.cloudSetSession({ access_token: 'a', refresh_token: 'b', expires_at: 1 });
  const linkKeys = Object.keys(JSON.parse(link.localStorage.getItem('vvv_cloud_session')));

  const pk = withWebAuthn(loadApp(), { get: () => Promise.resolve(fakeAssertion()) });
  stubFetch(pk, {
    'authentication/options': { body: { challenge_id: 'c1', options: { challenge: 'Y2hhbA' } } },
    'authentication/verify':  { body: SESSION },
  });
  return pk.passkeySignIn().then(() => {
    const pkKeys = Object.keys(JSON.parse(pk.localStorage.getItem('vvv_cloud_session')));
    for (const k of linkKeys) assert.ok(pkKeys.indexOf(k) !== -1, 'passkey session carries ' + k);
    assert.equal(pk.cloudSession.user_id, 'user-0001',
      'and resolves to the user id the server named -- no client-side identity is invented');
    assert.equal(pk.cloudSession.email, 'athlete@example.com');
  });
});

test('9. sign-in asks the server for the account; it never supplies one', () => {
  const app = withWebAuthn(loadApp(), { get: () => Promise.resolve(fakeAssertion()) });
  const calls = stubFetch(app, {
    'authentication/options': { body: { challenge_id: 'c1', options: { challenge: 'Y2hhbA' } } },
    'authentication/verify':  { body: SESSION },
  });
  return app.passkeySignIn().then(() => {
    const mine = calls.filter((c) => c.url.indexOf('/passkeys/') !== -1);
    /* A discoverable-credential ceremony: the authenticator knows which account
       the credential belongs to, and the server returns THAT user. There is no
       branch here that could name a different one. */
    assert.equal(mine.length, 2, 'exactly two calls: get the challenge, verify the answer');
    for (const c of mine) {
      const b = c.body || {};
      assert.ok(!('email' in b) && !('user_id' in b) && !('phone' in b),
        'no identity is asserted by the client: ' + c.url);
      /* The only `id` that crosses is the credential's own, which the
         authenticator chose and the server already knows. */
      const cred = b.credential || {};
      assert.ok(!/@/.test(JSON.stringify(b)), 'and no address is sent: ' + c.url);
      if (cred.id) assert.equal(cred.id, 'Y3JlZC1pZA');
    }
  });
});

test('10. enrolment is refused without an authenticated identity', () => {
  const app = withWebAuthn(loadApp(), { create: () => Promise.resolve(fakeAssertion()) });
  app.cloudSession = null;
  let reached = false;
  app.fetch = function(){ reached = true; return Promise.reject(new Error('should not happen')); };
  return app.passkeyRegister().then(
    () => assert.fail('registration must not succeed without a session'),
    (err) => {
      assert.equal(err.code, 'session_missing');
      assert.equal(reached, false, 'and the server is never even asked');
    }
  );
});

test('11. enrolment carries the athlete’s own token, so the server decides whose it is', () => {
  const app = withWebAuthn(loadApp(), { create: () => Promise.resolve(fakeAssertion()) });
  app.cloudSetSession({ access_token: 'access-abc', refresh_token: 'r',
                        expires_at: Date.now() + 3600000, user_id: 'user-0001' });
  const calls = stubFetch(app, {
    'registration/options': { body: { challenge_id: 'c1', options: { challenge: 'Y2hhbA', user: { id: 'dQ', name: 'a', displayName: 'a' } } } },
    'registration/verify':  { body: { id: 'pk-1' } },
  });
  return app.passkeyRegister().then(() => {
    for (const c of calls)
      assert.equal(c.headers.Authorization, 'Bearer access-abc',
        'registration is authorised as the athlete, never as the anonymous key');
  });
});

test('12. sign-in uses the publishable key, because there is no session to use yet', () => {
  const app = withWebAuthn(loadApp(), { get: () => Promise.resolve(fakeAssertion()) });
  /* A STALE SESSION MUST NOT LEAK INTO THE CEREMONY. Somebody signing in again
     may still be holding an expired token; sending it would have the server
     answer about the wrong identity. */
  app.cloudSetSession({ access_token: 'stale-token', expires_at: Date.now() + 3600000, user_id: 'someone-else' });
  const calls = stubFetch(app, {
    'authentication/options': { body: { challenge_id: 'c1', options: { challenge: 'Y2hhbA' } } },
    'authentication/verify':  { body: SESSION },
  });
  return app.passkeySignIn().then(() => {
    const mine = calls.filter((c) => c.url.indexOf('/passkeys/') !== -1);
    assert.equal(mine.length, 2);
    for (const c of mine) {
      assert.ok(c.headers.Authorization.indexOf('stale-token') === -1,
        'the stale token never goes near the authentication endpoints');
      assert.match(c.headers.Authorization, /^Bearer sb_publishable_/,
        'the publishable key is what authorises them, in both headers');
      assert.match(c.headers.apikey, /^sb_publishable_/);
    }
    assert.equal(app.cloudSession.user_id, 'user-0001',
      'and the session that lands is the one the server returned, replacing the stale one');
  });
});

// ---------------------------------------------------------------------------
// 4. NO GATE IS BYPASSED
// ---------------------------------------------------------------------------

test('13. the passkey path opens no gate of its own', () => {
  const src = read(path.join('protected', 'velvet-viking-valhalla.html'));
  const start = src.indexOf('function passkeySignIn(');
  const end = src.indexOf('function passkeyRegister(');
  const body = codeOnly(src.slice(start, end));
  for (const forbidden of [/entitlementInfo\s*=/, /accountRequired/, /commercialRequired/,
                           /healthConsent/, /trialState|startTrial/, /allowlist/i,
                           /establishDeliverySession/]) {
    assert.ok(!forbidden.test(body),
      'passkeySignIn() decides nothing about access: ' + forbidden);
  }
  assert.ok(/cloudSetSession\(/.test(body), 'all it does is adopt a session');
});

test('14. both doors finish through one shared completion path', () => {
  const src = read(path.join('protected', 'velvet-viking-valhalla.html'));
  /* If these ever diverge, one door can grow behaviour the other lacks -- which
     is how a second authentication system starts. */
  assert.equal((src.match(/function cloudCompleteSignIn\(/g) || []).length, 1);
  assert.ok(/handleAuthDeepLink[\s\S]{0,600}cloudCompleteSignIn\(\)/.test(src),
    'the magic link finishes through it');
  assert.ok(/handlePasskeySignIn[\s\S]{0,900}cloudCompleteSignIn\(\)/.test(src),
    'and so does the passkey');
  const app = loadApp();
  assert.equal(typeof app.cloudCompleteSignIn, 'function');
});

test('15. the front-door shells route a passkey session through the same bridge', () => {
  for (const file of ['account.html', 'start.html']) {
    const src = read(file);
    const at = src.indexOf("$('passkey').addEventListener");
    assert.ok(at !== -1, file + ' wires the passkey button');
    /* Bounded at the handler's own end rather than by a character count, so
       the assertion cannot drift into whatever happens to follow it. */
    const end = src.indexOf('});', src.indexOf('.catch(function(err)', at));
    const body = codeOnly(src.slice(at, end === -1 ? at + 2500 : end));
    assert.ok(/establish\(|route\(\)/.test(body),
      file + ' hands straight back to the existing session bridge rather than deciding anything itself');
    assert.ok(!/access\s*[:=]\s*true|checkout|startTrial|entitlementInfo/i.test(body),
      file + ' decides nothing about entitlement in the passkey handler');
  }
});

test('16. the shared shell engine cannot enrol, so it cannot create an account', () => {
  const src = read('passkey.js');
  assert.ok(src.indexOf('registration/options') === -1, 'no registration endpoint');
  assert.ok(src.indexOf('credentials.create') === -1, 'no creation ceremony');
  assert.ok(src.indexOf('credentials.get') !== -1, 'authentication only');
});

// ---------------------------------------------------------------------------
// 5. FAILURE ALWAYS LEAVES A WAY IN
// ---------------------------------------------------------------------------

test('17. every error code resolves to copy, and none of it leaks the server', () => {
  const app = loadApp();
  const codes = ['unsupported', 'passkey_disabled', 'no_credential',
                 'webauthn_credential_not_found', 'webauthn_credential_exists',
                 'too_many_passkeys', 'webauthn_challenge_expired',
                 'webauthn_challenge_not_found', 'webauthn_verification_failed',
                 'email_not_confirmed', 'user_banned', 'offline', 'session_missing',
                 'something_gotrue_invents_next_year'];
  for (const c of codes) {
    const line = app.passkeyErrorCopy(c);
    assert.ok(line && line.length > 8, c + ' has real copy');
    assert.ok(!/error|exception|null|undefined|4\d\d|5\d\d/i.test(line),
      c + ' says nothing about the machinery: ' + line);
  }
  assert.equal(app.passkeyErrorCopy('nonsense'), app.passkeyErrorCopy('default'));
});

test('18. a project without passkeys switched on says so and points at the email link', () => {
  const app = withWebAuthn(loadApp());
  stubFetch(app, { 'authentication/options': { status: 404 } });
  return app.passkeySignIn().then(
    () => assert.fail('a 404 must not look like success'),
    (err) => {
      assert.equal(err.code, 'passkey_disabled');
      assert.match(app.passkeyErrorCopy(err.code), /email link/);
    }
  );
});

test('19. a dismissed system prompt is treated as an answer, not a fault', () => {
  const app = withWebAuthn(loadApp(), {
    get: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
  });
  stubFetch(app, { 'authentication/options': { body: { challenge_id: 'c', options: { challenge: 'Y2hhbA' } } } });
  return app.passkeySignIn().then(
    () => assert.fail('cancellation is not success'),
    (err) => assert.equal(err.code, 'cancelled')
  );
});

test('20. an unreachable server is distinguished from a refused one', () => {
  const app = withWebAuthn(loadApp());
  app.fetch = () => Promise.reject(new Error('network down'));
  return app.passkeySignIn().then(
    () => assert.fail(),
    (err) => {
      assert.equal(err.code, 'offline');
      assert.match(app.passkeyErrorCopy('offline'), /connection/i);
    }
  );
});

test('21. a failed sign-in leaves no half-session behind', () => {
  const app = withWebAuthn(loadApp(), { get: () => Promise.resolve(fakeAssertion()) });
  stubFetch(app, {
    'authentication/options': { body: { challenge_id: 'c', options: { challenge: 'Y2hhbA' } } },
    'authentication/verify':  { status: 401, body: { error_code: 'webauthn_verification_failed' } },
  });
  return app.passkeySignIn().then(
    () => assert.fail(),
    (err) => {
      assert.equal(err.code, 'webauthn_verification_failed');
      assert.equal(app.localStorage.getItem('vvv_cloud_session'), null,
        'nothing is stored when verification fails');
    }
  );
});

test('21b. a 200 that carries no session is a failure, not a sign-in', () => {
  /* This closed a hole the mutation pass found: the tests exercised every 4xx
     but never a 200 with an empty body, so deleting the access_token guard was
     invisible. GoTrue answering 200 with nothing useful is exactly the shape a
     proxy, a captive portal or a future API change produces -- and treating it
     as success would leave the athlete "signed in" with no session at all. */
  const app = withWebAuthn(loadApp(), { get: () => Promise.resolve(fakeAssertion()) });
  stubFetch(app, {
    'authentication/options': { body: { challenge_id: 'c', options: { challenge: 'Y2hhbA' } } },
    'authentication/verify':  { status: 200, body: {} },
  });
  return app.passkeySignIn().then(
    () => assert.fail('an empty body is not a session'),
    (err) => {
      assert.equal(err.code, 'default');
      assert.equal(app.localStorage.getItem('vvv_cloud_session'), null,
        'and nothing is stored');
      assert.match(app.passkeyErrorCopy(err.code), /email link/,
        'the athlete is pointed at the route that does work');
    }
  );
});

// ---------------------------------------------------------------------------
// 6. THE WIRE FORMAT IS THE ONE THE SERVER SPEAKS
// ---------------------------------------------------------------------------

test('22. WebAuthn binary fields cross the wire base64url-encoded and unpadded', () => {
  const app = withWebAuthn(loadApp(), { get: () => Promise.resolve(fakeAssertion()) });
  const calls = stubFetch(app, {
    'authentication/options': { body: { challenge_id: 'c1', options: { challenge: 'Y2hhbA' } } },
    'authentication/verify':  { body: SESSION },
  });
  return app.passkeySignIn().then(() => {
    const verify = calls[1];
    assert.equal(verify.body.challenge_id, 'c1', 'the challenge is echoed back by id');
    const r = verify.body.credential.response;
    for (const field of ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle']) {
      assert.ok(typeof r[field] === 'string', field + ' is serialised');
      assert.ok(/^[A-Za-z0-9_-]+$/.test(r[field]),
        field + ' is base64URL with no padding: ' + r[field]);
    }
    assert.equal(verify.body.credential.type, 'public-key');
  });
});

test('23. base64url round-trips every byte value, padding included', () => {
  const app = loadApp();
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  for (let len = 1; len <= 8; len++) {
    const slice = all.slice(0, len);
    const back = app.b64uToBytes(app.bytesToB64u(slice.buffer));
    assert.equal(back.length, len, 'length survives at ' + len);
    assert.equal(Array.from(back).join(','), Array.from(slice).join(','), 'bytes survive at ' + len);
  }
  const round = app.b64uToBytes(app.bytesToB64u(all.buffer));
  assert.equal(Array.from(round).join(','), Array.from(all).join(','), 'all 256 byte values survive');
});

test('24. the endpoint paths are the ones the installed SDK uses', () => {
  const app = loadApp();
  assert.deepEqual(JSON.parse(JSON.stringify(app.PASSKEY_ENDPOINTS)), {
    registerOptions: '/auth/v1/passkeys/registration/options',
    registerVerify:  '/auth/v1/passkeys/registration/verify',
    signInOptions:   '/auth/v1/passkeys/authentication/options',
    signInVerify:    '/auth/v1/passkeys/authentication/verify',
    list:            '/auth/v1/passkeys',
  });
});

test('25. the shared shell engine and the runtime agree on the wire contract', () => {
  /* Two copies exist for a reason -- the runtime is a single file with no
     external dependency in its auth path, the shells are ordinary pages -- so
     the thing that must not drift is asserted rather than hoped for. */
  const shell = read('passkey.js');
  const app = loadApp();
  assert.ok(shell.indexOf(app.PASSKEY_ENDPOINTS.signInOptions) !== -1);
  assert.ok(shell.indexOf(app.PASSKEY_ENDPOINTS.signInVerify) !== -1);
  const runtime = read(path.join('protected', 'velvet-viking-valhalla.html'));
  const url = /https:\/\/(\w+)\.supabase\.co/;
  assert.equal(shell.match(url)[1], runtime.match(url)[1],
    'both talk to the same Supabase project');
});

// ---------------------------------------------------------------------------
// 7. SETTINGS TELLS THE TRUTH
// ---------------------------------------------------------------------------

test('26. the Settings row says nothing definite until the server has answered', () => {
  const app = withWebAuthn(loadApp());
  app.cloudSetSession({ access_token: 't', expires_at: Date.now() + 3600000, user_id: 'u' });
  app.passkeyInfo = null;
  const row = app.renderPasskeyRow();
  assert.match(row, /Checking/);
  assert.ok(row.indexOf('data-action="passkey-setup"') === -1,
    'no control is offered while the answer is unknown');
  assert.ok(row.indexOf('Not set up') === -1, 'and it does not guess "none"');
});

test('27. the Settings row offers set-up only when the account genuinely has none', () => {
  const app = withWebAuthn(loadApp());
  app.cloudSetSession({ access_token: 't', expires_at: Date.now() + 3600000, user_id: 'u' });
  app.passkeyInfo = [];
  const row = app.renderPasskeyRow();
  assert.match(row, /Not set up/);
  assert.ok(row.indexOf('data-action="passkey-setup"') !== -1);
  assert.match(row, /sign in with the email link every time/,
    'and it says what the athlete has instead, rather than only what they lack');
});

test('28. the Settings row switches to management once one exists', () => {
  const app = withWebAuthn(loadApp());
  app.cloudSetSession({ access_token: 't', expires_at: Date.now() + 3600000, user_id: 'u' });
  app.passkeyInfo = [{ id: 'pk-1', friendly_name: 'iPhone', created_at: '2026-08-01T00:00:00Z' }];
  const row = app.renderPasskeyRow();
  assert.match(row, /Ready on this account/);
  assert.ok(row.indexOf('data-action="passkey-manage"') !== -1);
  assert.ok(row.indexOf('data-action="passkey-setup"') === -1,
    'and stops offering to create a second one from the row');
  app.passkeyInfo = [{ id: 'a' }, { id: 'b' }];
  assert.match(app.renderPasskeyRow(), /2 registered on this account/);
});

test('29. the Settings row is absent for a signed-out athlete and an incapable device', () => {
  const signedOut = withWebAuthn(loadApp());
  signedOut.cloudSession = null;
  assert.equal(signedOut.renderPasskeyRow(), '', 'nothing to enrol against');

  const incapable = loadApp();
  incapable.cloudSetSession({ access_token: 't', expires_at: Date.now() + 3600000, user_id: 'u' });
  assert.equal(incapable.renderPasskeyRow(), '',
    'and no inert row explaining a feature this device cannot have');
});

test('30. what the account holds is never cached to disk, and is dropped on sign-out', () => {
  const app = withWebAuthn(loadApp());
  app.cloudSetSession({ access_token: 't', expires_at: Date.now() + 3600000, user_id: 'u' });
  app.passkeyInfo = [{ id: 'pk-1' }];
  app.passkeyAsked = true;
  const dump = JSON.stringify(app.localStorage);
  assert.ok(dump.indexOf('pk-1') === -1, 'the list is memory-only');
  app.passkeyForgetLocalStatus();
  assert.equal(app.passkeyInfo, null);
  assert.equal(app.passkeyAsked, false, 'so the next account is asked about afresh');
});

test('31. a failed list read never invents an answer', () => {
  const app = withWebAuthn(loadApp());
  app.cloudSetSession({ access_token: 't', expires_at: Date.now() + 3600000, user_id: 'u' });
  app.fetch = () => Promise.reject(new Error('offline'));
  return app.passkeyList().then((rows) => {
    assert.equal(rows.length, 0);
    /* Empty is the safe answer: the worst it produces is an offer to set up a
       passkey that already exists, which the server refuses cleanly. The
       opposite mistake -- claiming one exists -- would hide the only control
       that fixes it. */
  });
});

// ---------------------------------------------------------------------------
// 8. THE VISUAL SYSTEM IS THE ONE THAT WAS ALREADY THERE
// ---------------------------------------------------------------------------

test('32. the sign-in surface introduces no new component vocabulary', () => {
  const app = withWebAuthn(loadApp());
  const html = app.renderSignInOptions('lede');
  /* Every class used here already existed in the app. No card, no panel, no
     operating-system-shaped object was invented for this. */
  const classes = (html.match(/class="([^"]+)"/g) || [])
    .map((c) => c.slice(7, -1)).join(' ').split(/\s+/).filter(Boolean);
  const known = ['btn', 'btn-primary', 'btn-ghost', 'btn-block', 'field', 'field-hint',
                 'phase-divider', 'is-between', 'l', 'r', 'font-head'];
  for (const c of new Set(classes))
    assert.ok(known.indexOf(c) !== -1, 'unexpected new class in the sign-in surface: ' + c);
});

test('33. the Settings row uses the same connect-row every other integration uses', () => {
  const app = withWebAuthn(loadApp());
  app.cloudSetSession({ access_token: 't', expires_at: Date.now() + 3600000, user_id: 'u' });
  app.passkeyInfo = [];
  const row = app.renderPasskeyRow();
  assert.ok(row.indexOf('class="connect-row"') !== -1);
  assert.ok(row.indexOf('<div class="name">') !== -1 && row.indexOf('<div class="desc">') !== -1);
});

test('34. the shells’ divider is defined once, in the shared stylesheet, for both themes', () => {
  const css = read(path.join('assets', 'vvv-shell.css'));
  assert.ok(/\.vvv-or\{/.test(css), 'the OR divider lives in the shared shell');
  /* Colour comes from tokens, which is what makes it correct in light and dark
     without a second definition. */
  const rule = css.slice(css.indexOf('.vvv-or{'), css.indexOf('.vvv-note{'));
  assert.ok(/var\(--ink-faint\)/.test(rule), 'its label is a token, not a literal');
  assert.ok(!/#[0-9a-f]{6}/i.test(rule.replace(/rgba\([^)]*\)/g, '')),
    'no hard-coded hex that would only work in one theme');
});

test('35. the passkey icon is drawn in the app’s own icon vocabulary', () => {
  const app = loadApp();
  assert.ok(app.ICONS.passkey, 'the icon exists');
  assert.match(app.ICONS.passkey, /viewBox="0 0 24 24"/);
  assert.match(app.ICONS.passkey, /stroke="currentColor"/,
    'so it inherits whatever colour the control it sits in already uses');
  assert.ok(app.ICONS.passkey.indexOf('<image') === -1 && app.ICONS.passkey.indexOf('base64') === -1,
    'no imported operating-system asset');
});
