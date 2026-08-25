'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Prod = require('../api/_products.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// AUDIT REPRO (Final Full Product Audit, Part 17/23, finding B). The in-app
// Subscription card is cross-checked against api/_products.js
// (productionSurfaces.test.js: "the prices shown are the prices the billing
// catalogue charges"), but start.html -- the actual checkout page --
// independently hardcodes the same facts as literal strings (£11.99,
// £89.99, 14 days) with no test diffing them against the catalogue. Today
// they agree; nothing prevented drift on a future price change.
//
// THE FIX. This test extracts every literal price/trial-length occurrence
// in start.html and asserts it against Prod.offer()/Prod.TRIAL_DAYS, the
// exact pattern productionSurfaces.test.js already uses for the in-app card.

test('every literal price in start.html matches the billing catalogue', () => {
  const src = read('start.html');
  const monthly = Prod.offer('STANDARD_MONTHLY');
  const yearly = Prod.offer('STANDARD_YEARLY');
  const monthlyPrice = '£' + (monthly.priceMinor / 100).toFixed(2);
  const yearlyPrice = '£' + (yearly.priceMinor / 100).toFixed(2);

  assert.equal(monthlyPrice, '£11.99', 'sanity: catalogue price unexpectedly changed');
  assert.equal(yearlyPrice, '£89.99', 'sanity: catalogue price unexpectedly changed');

  // Every occurrence of "£<number>" in the file must be one of the two
  // real catalogue prices -- catching a stray figure left over from a
  // partial price change, not just confirming the right ones are present.
  const allPrices = (src.match(/£\d+\.\d{2}/g) || []);
  assert.ok(allPrices.length > 0, 'sanity: start.html must actually quote a price');
  allPrices.forEach((p) => {
    assert.ok(p === monthlyPrice || p === yearlyPrice,
      'start.html quotes ' + p + ', which is neither catalogue price (' + monthlyPrice + ' / ' + yearlyPrice + ')');
  });

  const monthlyCount = (src.match(new RegExp(monthlyPrice.replace('.', '\\.'), 'g')) || []).length;
  const yearlyCount = (src.match(new RegExp(yearlyPrice.replace('.', '\\.'), 'g')) || []).length;
  assert.ok(monthlyCount >= 2, 'the monthly price must appear on both the choice tile and the after-trial sentence');
  assert.ok(yearlyCount >= 2, 'the yearly price must appear on both the choice tile and the after-trial sentence');
});

test('every literal trial length in start.html matches Prod.TRIAL_DAYS', () => {
  const src = read('start.html');
  assert.equal(Prod.TRIAL_DAYS, 14, 'sanity: catalogue trial length unexpectedly changed');

  // "14 days" / "14-day" -- both phrasings used on the page -- must always
  // spell out the real trial length, never a stray hand-typed number.
  const dayPhrases = (src.match(/\b\d+[\s-]days?\b/gi) || []);
  assert.ok(dayPhrases.length > 0, 'sanity: start.html must actually state a trial length');
  dayPhrases.forEach((p) => {
    const n = parseInt(p, 10);
    assert.equal(n, Prod.TRIAL_DAYS, '"' + p + '" does not match the catalogue trial length of ' + Prod.TRIAL_DAYS + ' days');
  });
});

test('the currency, offer codes and periods start.html assumes still exist in the catalogue', () => {
  assert.ok(Prod.offer('STANDARD_MONTHLY'), 'STANDARD_MONTHLY must still exist');
  assert.ok(Prod.offer('STANDARD_YEARLY'), 'STANDARD_YEARLY must still exist');
  assert.equal(Prod.offer('STANDARD_MONTHLY').currency, 'GBP', 'start.html quotes £, so the catalogue currency must be GBP');
  assert.equal(Prod.offer('STANDARD_YEARLY').currency, 'GBP');
  const src = read('start.html');
  assert.match(src, /data-period="monthly"/);
  assert.match(src, /data-period="yearly"/);
});
