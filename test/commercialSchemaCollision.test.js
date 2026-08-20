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

test('a commercial migration cannot silently skip an existing table', () => {
  // `create table if not exists` is legitimate for a table only this repository
  // owns. For a commercial table that another workstream may already have
  // created, it must be paired with a guard that inspects the existing shape
  // and refuses rather than proceeding.
  for (const f of sqlFiles){
    const src = read(f);
    for (const t of COMMERCIAL){
      const re = new RegExp('create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.' + t + '\\b', 'i');
      if (!re.test(src)) continue;
      assert.match(src, /raise\s+exception/i,
        f + ' creates ' + t + ' with IF NOT EXISTS and no guard: it would report ' +
        'success against an incompatible existing table');
    }
  }
});

test('the purchases migration refuses an incompatible billing_events', () => {
  const src = read('supabase-purchases.sql');
  assert.match(src, /to_regclass\('public\.billing_events'\)/,
    'it must look before it leaps');
  assert.match(src, /information_schema\.columns/,
    'the shape must be inspected, not just the existence');
  assert.match(src, /provider_event_id/,
    'the discriminating column must be the thing checked');
  assert.match(src, /refusing to run/i);
  // And the guard must come BEFORE the create, or it guards nothing.
  assert.ok(src.indexOf('refusing to run') < src.indexOf('create table if not exists public.purchases'),
    'the guard must precede the tables it protects');
});
