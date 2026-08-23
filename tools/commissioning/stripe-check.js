#!/usr/bin/env node
'use strict';
//
// VELVET VIKING -- STRIPE TEST-MODE COMMISSIONING PROBE
//
//   node tools/commissioning/stripe-check.js
//   node tools/commissioning/stripe-check.js --session <uuid>
//   node tools/commissioning/stripe-check.js --subscription sub_xxx
//
// WHY THIS EXISTS. The Phase 2 verification matrix runs against a fake Stripe.
// That proves our side of the contract -- the paths, the methods, the form
// bodies -- and it proves nothing whatsoever about theirs. Closing the
// commissioning gates needs evidence from the real thing, and the environment
// the repository is developed in cannot reach api.stripe.com.
//
// So this is the owner's half. It runs on a machine that CAN reach Stripe, with
// a Stripe TEST key, and it reports what Stripe actually says.
//
// IT EXERCISES THE REAL ADAPTER. Every check below calls the same functions
// api/_stripe.js exposes to the webhook and the checkout endpoint, and the
// paid-through verdict runs the real api/_entitlement.js resolver. A probe that
// re-implemented any of that would prove the probe.
//
// IT NEVER TOUCHES THE DATABASE. There is no Supabase call anywhere in this
// file and no service key is read. Nothing it does can change production
// commercial state, because it cannot reach the tables that hold it.
//
// IT REFUSES A LIVE KEY, unconditionally and before anything else runs.
//
// READ-ONLY BY DEFAULT. The only mode that creates anything is --session, which
// creates one test-mode Checkout Session, and it says so before it does.

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const P = require(path.join(ROOT, 'api', '_stripe.js'));
const Prod = require(path.join(ROOT, 'api', '_products.js'));
const E = require(path.join(ROOT, 'api', '_entitlement.js'));

const args = process.argv.slice(2);
function flag(name){
  const i = args.indexOf('--' + name);
  return i === -1 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
}

let problems = 0;
const out = [];
function say(s){ out.push(s); console.log(s); }
function head(s){ say(''); say('=== ' + s + ' ==='); }
function ok(label, detail){ say('  PASS  ' + label + (detail ? '  ' + detail : '')); }
function bad(label, detail){ problems++; say('  FAIL  ' + label + (detail ? '  ' + detail : '')); }
function info(label, detail){ say('  --    ' + label + (detail == null ? '' : '  ' + detail)); }

/* Identifiers are truncated everywhere. The output of this script is meant to
   be pasted back into a conversation, and a full customer id is somebody's
   reference at a third party. Price ids are shown in full deliberately: they
   are configuration, not identity, and getting the right one configured is the
   thing being checked. */
const ref = v => v ? String(v).slice(0, 12) + '…' : '-';

async function main(){
  const cfg = P.config(process.env);

  head('KEY');
  if (!cfg.hasSecret){
    bad('STRIPE_SECRET_KEY is not set', 'nothing below can run');
    return finish();
  }
  if (cfg.isLiveKey){
    bad('STRIPE_SECRET_KEY is a LIVE key', 'refusing to run — commissioning is test mode only');
    return finish();
  }
  ok('test-mode key present', 'environment recorded on rows would be "' + cfg.environment + '"');
  info('VVV_SITE_ORIGIN', cfg.appOrigin || '(unset — checkout will refuse rather than guess)');
  if (!cfg.appOrigin) problems++;
  info('VVV_MARKETING_ORIGIN', cfg.marketingOrigin || '(unset)');
  info('STRIPE_WEBHOOK_SECRET', cfg.hasWebhookSecret ? 'set' : '(unset — the webhook will answer 503)');
  if (!cfg.hasWebhookSecret) problems++;

  // -------------------------------------------------------------------------
  head('PRICES — what the catalogue asks for, and what Stripe holds');
  // -------------------------------------------------------------------------
  for (const offerCode of Object.keys(Prod.OFFERS)){
    const offer = Prod.offer(offerCode);
    const envName = Prod.providerRefEnvName(P.PROVIDER, offerCode);
    const resolved = P.priceFor(offerCode, process.env);

    if (!resolved.ok){
      bad(offerCode, envName + ' → ' + resolved.code);
      continue;
    }
    const got = await P.call(cfg, 'GET', '/prices/' + encodeURIComponent(resolved.priceId), null);
    if (!got.ok){
      bad(offerCode, resolved.priceId + ' → ' + got.code);
      continue;
    }
    const price = got.data;
    const wantInterval = offer.billingPeriod === 'yearly' ? 'year' : 'month';
    const problemsBefore = problems;

    if (price.active !== true) bad(offerCode + ' price is not active', resolved.priceId);
    if (!price.recurring) bad(offerCode + ' price is not recurring', resolved.priceId);
    else if (price.recurring.interval !== wantInterval)
      bad(offerCode + ' interval is ' + price.recurring.interval, 'catalogue says ' + wantInterval);
    if (String(price.currency).toUpperCase() !== offer.currency)
      bad(offerCode + ' currency is ' + String(price.currency).toUpperCase(), 'catalogue says ' + offer.currency);

    /* A MISMATCHED AMOUNT IS NOT AUTOMATICALLY WRONG. The provider charges and
       the provider's amount is the true one; the catalogue figure is what a
       screen renders and what agreed_price_minor records. They SHOULD agree,
       and an athlete told £11.99 and charged something else is the failure --
       but this reports rather than refuses, because deciding which of the two
       is correct is a commercial decision and not a script's. */
    if (price.unit_amount !== offer.priceMinor){
      bad(offerCode + ' amount is ' + price.unit_amount + ' minor units',
          'catalogue renders ' + offer.priceMinor + ' — an athlete would be shown one and charged the other');
    }
    /* A TRIAL ON THE PRICE IS A SECOND SOURCE OF TRUTH. Valhalla sets
       trial_period_days on the Checkout Session so the fourteen days have one
       origin: TRIAL_DAYS in api/_products.js. A Price that also carries a trial
       can silently win, and then the trial length is whatever a dashboard says. */
    if (price.recurring && price.recurring.trial_period_days != null){
      bad(offerCode + ' price carries its own trial of ' + price.recurring.trial_period_days + ' days',
          'the trial belongs on the Checkout Session, from TRIAL_DAYS — remove it from the Price');
    }
    if (problems === problemsBefore)
      ok(offerCode, resolved.priceId + '  ' + price.unit_amount + ' ' +
         String(price.currency).toUpperCase() + '/' + price.recurring.interval);
  }

  // -------------------------------------------------------------------------
  head('WEBHOOK ENDPOINT');
  // -------------------------------------------------------------------------
  const NEEDED = ['customer.subscription.created',
                  'customer.subscription.updated',
                  'customer.subscription.deleted'];
  const eps = await P.call(cfg, 'GET', '/webhook_endpoints', null);
  if (!eps.ok){
    bad('could not list webhook endpoints', eps.code);
  } else {
    const list = (eps.data && eps.data.data) || [];
    if (!list.length) bad('no webhook endpoint is configured in this Stripe account');
    list.forEach(function(ep){
      const isOurs = /\/api\/billing-webhook$/.test(String(ep.url || ''));
      const events = ep.enabled_events || [];
      const all = events.indexOf('*') !== -1;
      const missing = NEEDED.filter(function(e){ return !all && events.indexOf(e) === -1; });
      if (!isOurs){ info('other endpoint (ignored)', ep.url); return; }
      if (ep.status !== 'enabled') bad('endpoint is ' + ep.status, ep.url);
      else if (missing.length) bad('endpoint is missing events', ep.url + '  → ' + missing.join(', '));
      else ok('endpoint', ep.url + '  [' + (all ? '* (all events)' : NEEDED.length + ' required events present') + ']');
      /* Subscribing to everything is not a failure, but it is worth saying:
         Stripe emits well over a hundred types and the endpoint answers 200 and
         ignores all but three, so the extra deliveries are pure noise in the
         Stripe dashboard's retry view. */
      if (all) info('note', 'this endpoint receives every event type; only the three above are read');
    });
  }

  // -------------------------------------------------------------------------
  if (flag('session')){
    head('CHECKOUT SESSION — the one mode that creates something');
    const uid = flag('session');
    if (uid === true){
      bad('--session needs an account uuid', 'node tools/commissioning/stripe-check.js --session <uuid>');
    } else {
      say('  creating ONE test-mode Checkout Session for account ' + ref(uid) + ' …');
      const cust = await P.ensureCustomer(cfg, uid, null, null, {});
      if (!cust.ok){ bad('customer creation failed', cust.code); }
      else {
        const period = flag('period') === 'yearly' ? 'yearly' : 'monthly';
        const offer = Prod.offerForPeriod(period);
        const s = await P.createCheckoutSession(cfg, {
          uid: uid, accountId: uid, customerId: cust.customerId,
          offerCode: offer.code, env: process.env
        }, { idempotencyKey: 'commission:' + uid + ':' + offer.code + ':' + Date.now() });
        if (!s.ok) bad('session creation failed', s.code);
        else {
          ok('session created', s.sessionId);
          info('period', s.period + '   trial_days ' + s.trialDays);
          say('');
          say('  OPEN THIS AND PAY WITH 4242 4242 4242 4242 (any future expiry, any CVC):');
          say('  ' + s.url);
          say('');
          say('  Then re-run with --subscription <the sub_… Stripe creates> to see the facts.');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  if (flag('subscription')){
    head('SUBSCRIPTION — provider facts, our translation, and the access verdict');
    const subId = flag('subscription');
    const got = await P.fetchSubscription(cfg, subId);
    if (!got.ok){
      bad('could not fetch subscription', String(subId) + ' → ' + got.code);
    } else {
      const s = got.subscription;
      const iso = v => v ? new Date(Number(v) * 1000).toISOString() : null;

      say('  --- what STRIPE says (the fields the paid-through question turns on) ---');
      info('status', s.status);
      info('current_period_start', iso(s.current_period_start));
      info('current_period_end', iso(s.current_period_end) + '   <- INVOICED through');
      info('trial_start / trial_end', iso(s.trial_start) + '  /  ' + iso(s.trial_end));
      info('cancel_at_period_end', String(!!s.cancel_at_period_end));
      info('canceled_at', iso(s.canceled_at));
      info('cancellation_details.reason', (s.cancellation_details && s.cancellation_details.reason) || '(none)');
      info('metadata.vvv_account_id', ref(s.metadata && s.metadata.vvv_account_id));
      info('metadata.vvv_offer', (s.metadata && s.metadata.vvv_offer) || '(none)');
      /* Named explicitly because its ABSENCE is the finding. If Stripe ever
         starts supplying a retry deadline on the subscription object, the web
         rail gains a provider grace and _billing-apply.js should stop writing
         null -- so the probe looks for one rather than assuming. */
      const graceish = ['grace_period_end', 'retry_deadline', 'next_retry_at']
        .filter(function(k){ return s[k] != null; });
      info('any retry/grace deadline on the object', graceish.length ? graceish.join(', ') : 'NONE');

      say('');
      say('  --- what THE ADAPTER makes of it ---');
      const facts = P.subscriptionFacts(s, { type: 'commissioning-probe',
                                             occurredAt: new Date().toISOString() });
      if (!facts){
        bad('the adapter could not classify this subscription',
            'status "' + s.status + '" is not in CONDITION_OF — it would be dropped, not guessed');
      } else {
        info('condition', facts.condition);
        info('offer_code / billing_period', facts.offer_code + ' / ' + facts.billing_period);
        info('period_end (PAID through)', String(facts.period_end));
        info('invoiced_through', String(facts.invoiced_through));
        info('grace_period_end written', String(facts.grace_period_end));

        say('');
        say('  --- what THE RESOLVER grants, right now ---');
        const row = {
          provider: facts.provider, product_code: Prod.STANDARD,
          condition: facts.condition, offer_code: facts.offer_code,
          trial_start: facts.trial_start, trial_end: facts.trial_end,
          current_period_start: facts.period_start,
          current_period_end: facts.period_end,
          grace_period_end: facts.grace_period_end
        };
        const access = E.subscriptionAccess(row, new Date());
        info('active', String(access.active));
        info('reason', access.reason);
        info('until', String(access.until));

        say('');
        say('  --- THE PAID-THROUGH GATE ---');
        if (facts.condition !== 'past_due'){
          info('not applicable yet',
               'this subscription is "' + facts.condition + '". The gate needs a FAILED RENEWAL: ' +
               'see the instructions this probe was sent with.');
        } else if (facts.invoiced_through && facts.period_end &&
                   facts.invoiced_through !== facts.period_end){
          ok('CONFIRMED: Stripe advanced the period past the failure',
             'invoiced ' + facts.invoiced_through + ' vs paid ' + facts.period_end);
          say('        A verbatim mirror would have granted access to ' + facts.invoiced_through + '.');
          say('        paidThroughOf() is correct and is doing real work.');
        } else {
          bad('NOT CONFIRMED: the period did not advance past the failure',
              'invoiced ' + facts.invoiced_through + ' == paid ' + facts.period_end);
          say('        STOP AND REPORT THIS. paidThroughOf() would be under-granting:');
          say('        an athlete who paid for the current month could lose it on a');
          say('        failed charge. Do not change code before the evidence is reviewed.');
        }
      }
    }
  }

  finish();
}

function finish(){
  say('');
  say('=== SUMMARY ===');
  say(problems === 0
    ? '  no problems found by this probe'
    : '  ' + problems + ' problem(s) above');
  say('');
  say('  This probe proves STRIPE configuration and the ADAPTER translation.');
  say('  It does not touch Supabase, does not read a service key, and cannot');
  say('  change any commercial state. Entitlement activation end to end still');
  say('  needs a deployment with the webhook wired up.');
  process.exitCode = problems === 0 ? 0 : 1;
}

main().catch(function(e){
  /* A code, never the error object: a Stripe failure can carry the request, and
     the request carries the customer and the price. */
  console.error('probe failed: ' + (e && e.code ? e.code : 'unexpected_error'));
  process.exitCode = 2;
});
