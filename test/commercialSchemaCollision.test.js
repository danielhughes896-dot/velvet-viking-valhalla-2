'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// PREVENTING THE SILENT-COLLISION CLASS OF BUG.
//
// Two independently authorised workstreams each created a `billing_events`.
// They are not the same table: one is keyed on account_id/subscription_id with
// provider vocabulary 'web', the other on user_id/provider_sub_id with 'stripe'.
//
// The danger is not that they disagree -- it is that `create table if not
// exists` lets the second one report SUCCESS while doing nothing, after which
// application code reads columns that are not there. The failure then surfaces
// at the first live webhook instead of at migration time.
//
// These tests do not pick a winner. That is a reconciliation decision requiring
// production evidence. They ensure the mistake cannot be made silently.

const ROOT = path.join(__dirname, '..');
const sqlFiles = fs.readdirSync(ROOT).filter((f) => /^supabase-.*\.sql$/.test(f));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* Tables that carry commercial meaning. A collision in any of these is a
   correctness problem, not a tidiness one. */
const COMMERCIAL = [
  'billing_events', 'purchases', 'subscriptions', 'entitlements',
  'commercial_accounts', 'access_leases'
];

function definitionsOf(table){
  const re = new RegExp('create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.' + table + '\\b', 'i');
  return sqlFiles.filter((f) => re.test(read(f)));
}

test('no commercial table is defined in more than one repository file', () => {
  const offenders = [];
  for (const t of COMMERCIAL){
    const files = definitionsOf(t);
    if (files.length > 1) offenders.push(t + ' defined in: ' + files.join(', '));
  }
  assert.deepEqual(offenders, [],
    'two files creating one commercial table is how a silent collision starts');
});

test('billing_events has exactly one definition in the repository', () => {
  // Named separately because this is the known live defect, and a regression
  // here is the one that reaches production.
  const files = definitionsOf('billing_events');
  assert.equal(files.length, 1,
    'expected one definition, found: ' + (files.join(', ') || 'none'));
});

test('each commercial table has exactly one owning migration', () => {
  // `create table if not exists` is correct for the SOLE owner of a table --
  // that is what makes a migration rerunnable. It becomes dangerous only when a
  // second file claims the same name, because then the second one reports
  // success while doing nothing. Single ownership is therefore the invariant
  // worth enforcing, and the two tests above enforce it directly.
  const owners = {};
  for (const t of COMMERCIAL){
    const files = definitionsOf(t);
    if (files.length) owners[t] = files[0];
  }
  assert.equal(owners.billing_events, 'supabase-commercial-core.sql',
    'billing_events belongs to the commercial core');
  assert.equal(owners.subscriptions, 'supabase-commercial-core.sql');
  assert.equal(owners.entitlements, 'supabase-entitlement.sql',
    'the legacy entitlements projection is still owned by its own file');
});

test('the superseded web-billing schema is gone, not merely discouraged', () => {
  // supabase-purchases.sql defined a second billing_events and a purchases
  // table that duplicated subscriptions. Both are answered by
  // supabase-commercial-core.sql, so the file was deleted rather than left in
  // the tree with a warning comment for a future engineer to misread.
  assert.equal(fs.existsSync(path.join(ROOT, 'supabase-purchases.sql')), false,
    'supabase-purchases.sql must not return');
  for (const dead of ['api/_commerce.js', 'api/_ledger.js']) {
    assert.equal(fs.existsSync(path.join(ROOT, dead)), false, dead + ' must not return');
  }
  // And nothing may reference them.
  const live = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /\.js$/.test(f));
  for (const f of live) {
    const src = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    for (const dead of ['_commerce.js', '_ledger.js', 'supabase-purchases']) {
      assert.equal(src.indexOf(dead), -1, f + ' still references ' + dead);
    }
  }
});

test('purchases and entitlements are not redefined alongside the canonical model', () => {
  // Two tables answering "does this athlete have access" is the defect this
  // reconciliation removed. subscriptions and entitlement_grants are canonical.
  assert.deepEqual(definitionsOf('purchases'), []);
  assert.deepEqual(definitionsOf('subscriptions'), ['supabase-commercial-core.sql']);
  assert.deepEqual(definitionsOf('commercial_accounts').concat(definitionsOf('account_commercial')),
    ['supabase-commercial-core.sql']);
});
