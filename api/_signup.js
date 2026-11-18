// Velvet Viking -- the public sign-up switch, as the server reads it.
//
// Founder, 18 November 2026: "It's on Vercel so only I can send it to people.
// So make it as if it's ready to go." Sign-up is open to anyone who reaches
// the app while public.signup_settings.public_signup is true, and invitation
// only (the beta allowlist) while it is false. supabase-public-signup.sql
// installs it; AUTH-AND-EMAIL.md says how to turn it on and back off.
//
// THE DATABASE DECIDES, NOT THIS FILE. The switch is one row read by the
// BEFORE INSERT trigger on auth.users, which is the only place an account can
// come into existence and therefore the only real gate (the publishable key
// is public, so anyone can ask GoTrue for an account without this server).
// A Vercel variable could not be read by that trigger, so it would be a
// second authority able to disagree with the real one.
//
// WHAT THE SERVER USES IT FOR: WORDS. Whether the app says "private beta" or
// not, and whether a refusal from GoTrue is the closed gate talking. Nothing
// here admits or refuses anybody, and nothing here grants access to the
// product: that is resolveAccess() in _access.js, for every account alike.
//
// Three answers, deliberately: true (open), false (closed), null (could not be
// read: no service key, the migration not applied yet, the database slow or
// down). Every caller treats null as "say what was said before", which is the
// private-beta wording, so a failure here can only ever produce today's copy.

'use strict';

const SETTINGS_PATH = '/signup_settings?select=public_signup&id=eq.1&limit=1';

/* Short, because the only thing waiting on this is a sentence. A sign-in
   screen must not hang on a settings read. */
const READ_TIMEOUT_MS = 2500;

async function readPublicSignup(S, cfg){
  if (!cfg || !cfg.serviceKey || !S || typeof S.sb !== 'function') return null;
  let timer = null;
  try{
    const late = new Promise(function(resolve){
      timer = setTimeout(function(){ resolve(null); }, READ_TIMEOUT_MS);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    const r = await Promise.race([S.sb(cfg, SETTINGS_PATH), late]);
    if (!r || !r.ok) return null;
    const rows = await r.json().catch(function(){ return null; });
    const v = Array.isArray(rows) && rows[0] ? rows[0].public_signup : undefined;
    return v === true ? true : v === false ? false : null;
  }catch(e){
    return null;
  }finally{
    if (timer) clearTimeout(timer);
  }
}

/* GoTrue's report of a refused account. The BEFORE INSERT trigger raising
   inside the auth.users insert surfaces through GoTrue as "Database error
   saving new user", whichever way in was used (magic link, Apple, Google).
   Read from the provider's body only to classify it; the body itself is never
   returned to the browser. */
function isNewUserRefusal(upstream){
  const u = upstream || {};
  const text = [u.msg, u.message, u.error_description, u.error].filter(function(x){
    return typeof x === 'string';
  }).join(' ');
  return /saving new user/i.test(text);
}

module.exports = { readPublicSignup, isNewUserRefusal, SETTINGS_PATH, READ_TIMEOUT_MS };
