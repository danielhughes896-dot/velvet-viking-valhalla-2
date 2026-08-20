'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// RETIRING THE SIGNUP AUTO-GRANT.
//
// A trigger on auth.users gave every new account entitlements.override='beta'.
// resolveAccess() checks the override BEFORE any commercial rule, so while it
// lived, opening a commercial front door would have granted every arriving
// athlete permanent free access. These tests keep it retired.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sqlFiles = fs.readdirSync(ROOT).filter((f) => /^supabase-.*\.sql$/.test(f));

test('no repository migration creates the signup auto-grant', () => {
  const offenders = [];
  for (const f of sqlFiles){
    /* Strip SQL line comments first. A retired step is DOCUMENTED in place --
       that is the point of retiring rather than deleting -- and a scanner that
       matches its own explanation reports the thing it just fixed. */
    const src = read(f).replace(/--.*$/gm, ' ');
    if (/create\s+(or\s+replace\s+)?function\s+public\.seed_entitlement_for_new_user/i.test(src))
      offenders.push(f + ' defines the function');
    if (/create\s+trigger\s+seed_entitlement_on_signup/i.test(src))
      offenders.push(f + ' installs the trigger');
  }
  assert.deepEqual(offenders, [],
    'a fresh deployment would auto-grant beta to every new account');
});

test('the Phase 1 commercial seed is NOT retired with it', () => {
  // Different trigger, different job: it creates the row a trial allowance is
  // recorded against, with no trial and no entitlement. It must survive.
  const core = read('supabase-commercial-core.sql');
  assert.match(core, /create trigger seed_account_commercial_on_signup/);
  assert.match(core, /NO TRIAL\. NO ENTITLEMENT\./,
    'account creation must never look like a purchase');
});

test('the retirement migration refuses to remove somebody\'s only access', () => {
  const m = read('supabase-retire-legacy-beta-autogrant.sql');
  // The safety argument is that entitlement_grants already carries anyone
  // relying on the legacy override. The file must CHECK that rather than
  // assume it.
  assert.match(m, /entitlement_grants/, 'it must look for canonical grants');
  assert.match(m, /ABORTED/, 'it must refuse, not warn');
  assert.match(m, /Nothing has been changed/);
  // And the check must precede the drops, or it guards nothing.
  assert.ok(m.indexOf('ABORTED') < m.indexOf('drop trigger if exists seed_entitlement_on_signup'),
    'the guard must run before the trigger is dropped');
});

test('the retirement migration consumes no trial and creates no subscription', () => {
  const m = read('supabase-retire-legacy-beta-autogrant.sql')
    .replace(/--.*$/gm, ' ');           // strip comments; only statements matter
  for (const forbidden of ['trial_consumed_at =', 'insert into public.subscriptions',
                           'update public.account_commercial', 'delete from public.entitlement_grants',
                           'delete from public.entitlements']) {
    assert.equal(m.indexOf(forbidden), -1,
      'the migration must not ' + forbidden.split(' ')[0] + ': found "' + forbidden + '"');
  }
});

test('the entitlement migration no longer claims the trigger should exist', () => {
  // Its verify query used to assert signup_trigger_expect_1. A verification
  // that expects the thing we just removed would fail every future audit.
  const e = read('supabase-entitlement.sql');
  assert.equal(/signup_trigger_expect_1/.test(e), false);
  assert.match(e, /signup_trigger_expect_0/);
});
