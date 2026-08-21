/* Velvet Viking -- passkey sign-in for the account shells.
   ============================================================================

   WHAT THIS IS FOR. /account and /start are the front door: they are what an
   athlete sees when the runtime has not been delivered yet, which is exactly
   the moment somebody needs to sign in. The runtime carries its own copy of
   this logic because it is a single file by design and its authentication path
   takes no external dependency; these two shells are ordinary pages and can
   share one script, so they do.

   WHAT IT DELIBERATELY DOES NOT DO. It does not enrol. Registering a passkey
   requires an athlete who is already signed in, and the place to do that is
   Settings inside the app, next to the account it belongs to. A front door that
   could create credentials would be a front door that could create accounts,
   and account creation belongs to the beta allowlist and the entitlement rules
   -- not to a WebAuthn ceremony.

   IT ALSO DOES NOT SIGN ANYBODY IN, in the sense the rest of the product means
   it. All it returns is a Supabase session. Trading that for a delivery lease,
   deciding what the athlete may then do, and where they land, stays with the
   page -- which is the same code path the magic link already goes through.

   NO PASSWORD IS INVOLVED ANYWHERE IN HERE, and no biometric ever reaches this
   script. The device checks the fingerprint, the face or the screen lock; what
   crosses the wire is a public key and a signature over a challenge.

   ENDPOINTS AND PAYLOAD SHAPES were transcribed from @supabase/auth-js v2.112.3
   rather than recalled from memory. Supabase's own documentation marks passkey
   support EXPERIMENTAL -- "the API may change without notice" -- so everything
   version-specific is confined to ENDPOINTS below, and every failure path ends
   with the athlete still able to use the email link. */
(function(){
  'use strict';

  /* The same project the runtime and every serverless function talk to. Stated
     here rather than fetched because a round trip in the sign-in path buys
     nothing: the publishable key is public by construction, and a wrong value
     would break the magic link long before it broke this. Kept beside the
     runtime's own pair at protected/velvet-viking-valhalla.html -- if one moves
     project, so must the other. */
  var SUPABASE_URL = 'https://eqiydxissphygnycpouu.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_PLiExuCqvMmjYwal4DtFQA_m4eZuCd-';

  var ENDPOINTS = {
    signInOptions: '/auth/v1/passkeys/authentication/options',
    signInVerify:  '/auth/v1/passkeys/authentication/verify'
  };

  /* Authentication cannot carry an athlete's token, because obtaining one is
     the point of the exercise. The publishable key goes in BOTH headers, which
     is what the SDK sends on these two endpoints. */
  function headers(){
    return {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'content-type': 'application/json'
    };
  }
  function post(path, body){
    return fetch(SUPABASE_URL + path, {
      method: 'POST', headers: headers(), body: JSON.stringify(body || {})
    });
  }

  /* ---------- capability ----------
     WebAuthn existing and a usable authenticator existing are two different
     questions. Only the first is answerable synchronously, and it is the one
     that decides whether the control is drawn at all. */
  function available(){
    try{
      return typeof window.PublicKeyCredential === 'function' &&
             !!(navigator.credentials && navigator.credentials.get);
    }catch(e){ return false; }
  }

  /* ---------- base64url <-> bytes ----------
     WebAuthn speaks ArrayBuffers and JSON does not. */
  function b64uToBytes(s){
    var t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var bin = atob(t), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64u(buf){
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* WebAuthn Level 3 gives browsers native converters for exactly this. Where
     they exist they are used, because they are the specification's own answer;
     the manual path is for browsers that predate them. */
  function parseRequestOptions(json){
    var P = window.PublicKeyCredential;
    if (P && typeof P.parseRequestOptionsFromJSON === 'function')
      return P.parseRequestOptionsFromJSON(json);
    var o = {};
    Object.keys(json).forEach(function(k){ o[k] = json[k]; });
    o.challenge = b64uToBytes(json.challenge).buffer;
    if (json.allowCredentials && json.allowCredentials.length)
      o.allowCredentials = json.allowCredentials.map(function(c){
        return { id: b64uToBytes(c.id).buffer, type: c.type || 'public-key', transports: c.transports };
      });
    return o;
  }
  function serialize(cred){
    if (cred && typeof cred.toJSON === 'function') return cred.toJSON();
    var r = cred.response;
    var out = {
      id: cred.id, rawId: cred.id, type: 'public-key',
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: {
        clientDataJSON: bytesToB64u(r.clientDataJSON),
        authenticatorData: bytesToB64u(r.authenticatorData),
        signature: bytesToB64u(r.signature)
      }
    };
    if (cred.authenticatorAttachment) out.authenticatorAttachment = cred.authenticatorAttachment;
    if (r.userHandle) out.response.userHandle = bytesToB64u(r.userHandle);
    return out;
  }

  /* ---------- what the athlete is told ----------
     Never the raw exception, never the address, never GoTrue's `msg` -- which
     can echo an email. Every line ends somewhere the athlete can still get in,
     because the email link is on the same screen. */
  var COPY = {
    unsupported:      'This device cannot use a passkey. Use the email link instead.',
    passkey_disabled: 'Passkey sign-in is not switched on yet. Use the email link instead.',
    no_credential:    'No passkey was found on this device. Use the email link instead, then set one up in Settings.',
    webauthn_credential_not_found: 'That passkey is not registered to a Velvet Viking account. Use the email link instead.',
    webauthn_challenge_expired:    'That took a little too long. Try again.',
    webauthn_challenge_not_found:  'That attempt has already been used. Try again.',
    webauthn_verification_failed:  'That passkey could not be verified. Use the email link instead.',
    email_not_confirmed: 'Confirm your email first, using the sign-in link we email you.',
    user_banned:      'This account cannot be signed in to.',
    offline:          'We could not reach Velvet Viking. Check your connection and try again.',
    'default':        'That did not work. Use the email link instead.'
  };
  function copy(code){ return COPY[code] || COPY['default']; }

  function err(code){ var e = new Error(code); e.code = code; return e; }
  function ceremonyError(e){
    var n = e && e.name;
    /* Dismissing the system prompt is an answer, not a fault. Callers are
       expected to say nothing at all about it. */
    if (n === 'NotAllowedError' || n === 'AbortError') return err('cancelled');
    if (n === 'SecurityError') return err('unsupported');
    return err('default');
  }
  function readError(resp){
    return resp.json().catch(function(){ return {}; }).then(function(body){
      var code = body.error_code || body.code || body.error || 'default';
      /* A project without the passkey switch on answers 404 on these paths.
         That is a configuration fact, not something the athlete did. */
      if (resp.status === 404 || code === 'passkey_disabled') code = 'passkey_disabled';
      try{ console.log('passkey: refused status=' + resp.status + ' code=' + String(code).slice(0, 40)); }catch(e){}
      throw err(code);
    });
  }

  /* ---------- sign in ----------
     A discoverable-credential ceremony, so no email is asked for: the
     authenticator already knows which account the credential belongs to. What
     comes back is an ordinary Supabase session, resolving to the SAME user id
     the magic link would have produced for that person. No account is created
     here and none can be -- this endpoint only ever returns the user the
     credential was registered to. */
  function signIn(){
    if (!available()) return Promise.reject(err('unsupported'));
    return post(ENDPOINTS.signInOptions, { gotrue_meta_security: {} })
      .catch(function(){ throw err('offline'); })
      .then(function(resp){ return resp.ok ? resp.json() : readError(resp); })
      .then(function(start){
        return navigator.credentials.get({ publicKey: parseRequestOptions(start.options) })
          .catch(function(e){ throw ceremonyError(e); })
          .then(function(cred){
            if (!cred) throw err('cancelled');
            return post(ENDPOINTS.signInVerify, {
              challenge_id: start.challenge_id, credential: serialize(cred)
            }).catch(function(){ throw err('offline'); });
          });
      })
      .then(function(resp){ return resp.ok ? resp.json() : readError(resp); })
      .then(function(sess){
        if (!sess || !sess.access_token) throw err('default');
        return sess;
      });
  }

  window.VVVPasskey = { available: available, signIn: signIn, copy: copy };
})();
