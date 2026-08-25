'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// AUDIT REPRO (Final Full Product Audit, Part 17, finding A -- release
// blocker). start.html's #trial click handler POSTed straight to
// /api/checkout with only {period}. decideCheckout() (api/_checkout.js)
// refuses that call with terms_not_accepted/immediate_start_not_acknowledged
// whenever Agree.purchaseEvidence() isn't ok -- but start.html rendered
// ZERO checkboxes and never called the agreement-recording action, and its
// trial-error handler had no case for those two refusal codes (they fell
// through to a generic "We could not open the payment page" dead end).
// account.html's resubscribe screen was the ONLY surface with the required
// UI -- not the actual new-subscriber path.
//
// THE FIX. start.html now fetches the same GET /api/subscription payload
// account.html already renders from (agreements / agreements_outstanding),
// renders the same two checkboxes with the same never-pre-ticked, POST-to-
// record-on-tick behaviour, and the trial handler explicitly recognises all
// three refusal codes decideCheckout() can return for missing evidence.

test('start.html renders the same agreement checkboxes account.html does, from the same server payload', () => {
  const src = read('start.html');
  assert.match(src, /checkout-agreements/, 'a container for the agreement rows must exist');
  assert.match(src, /agreements_outstanding/, 'must read the same outstanding-evidence field account.html reads');
  assert.match(src, /api\/subscription/, 'must call the same endpoint account.html calls for agreements');
  assert.match(src, /action:\s*'agree'/, 'must record decisions through the same server action account.html uses');
  assert.match(src, /surface:\s*'checkout'/);
});

test('the checkbox is never pre-ticked (affirmative act, not a default)', () => {
  const src = read('start.html');
  const fn = src.slice(src.indexOf('function agreementRow'), src.indexOf('function agreementRow') + 900);
  assert.match(fn, /cb\.checked\s*=\s*false/);
});

test('the two required checkboxes are gated on commercialLegalPublished, same as account.html', () => {
  const src = read('start.html');
  assert.match(src, /commercialLegalPublished === false/,
    'must refuse to render a Terms tickbox when the commercial Terms are not published');
  assert.match(src, /Subscriptions are not open yet/);
});

test('the trial handler explicitly names all three refusal codes decideCheckout() can return for missing evidence', () => {
  const src = read('start.html');
  const handler = src.slice(src.indexOf("$('trial').addEventListener"));
  ['terms_not_accepted', 'immediate_start_not_acknowledged', 'commercial_terms_not_published']
    .forEach((code) => assert.match(handler, new RegExp(code.replace(/_/g, '_')),
      'trial handler must explicitly handle ' + code + ' rather than falling through to a generic error'));
  // Falling through to the generic dead-end message is still the LAST resort,
  // for genuinely unrecognised codes, but must not be the only branch.
  assert.match(handler, /We could not open the payment page/);
});

test('a terms/immediate-start refusal re-renders the agreement checkboxes rather than dead-ending', () => {
  const src = read('start.html');
  const handler = src.slice(src.indexOf("$('trial').addEventListener"), src.indexOf("$('trial').addEventListener") + 1600);
  const termsBranch = handler.slice(handler.indexOf('terms_not_accepted'));
  assert.match(termsBranch.slice(0, 200), /loadCheckoutAgreements\(\)/,
    'the refusal must re-fetch/re-render the outstanding agreements, giving the athlete a way to resolve it');
});

test('the recorded decision surface is "checkout", never silently defaulted or omitted', () => {
  const src = read('start.html');
  const recordFn = src.slice(src.indexOf('function recordCheckoutAgreement'));
  assert.match(recordFn, /decision:\s*'accepted'/);
  assert.match(recordFn, /surface:\s*'checkout'/);
  assert.match(recordFn, /agreement:\s*kind/);
});
