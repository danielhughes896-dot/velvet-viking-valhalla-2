'use strict';
//
//   node test/mutation/run.js
//
// MUTATION PASS. Each entry breaks one guarantee in the source and checks that
// at least one test notices. A green suite proves the tests pass; this proves
// they would fail — a guard nothing detects is a guard that is not there, and
// the failure mode it catches is a test that asserts a source line instead of a
// behaviour. Three of the five defects found in the Stripe pipeline had passing
// tests over them for exactly that reason.
//
// It EDITS SOURCE FILES and restores them after every case, pass or fail. Run it
// on a clean tree: if it is interrupted, `git status` will show what is left
// modified and `git checkout --` restores it.
//
// It is not part of `npm test` (which globs test/*.test.js) because it is slow
// relative to a normal run and because a tool that rewrites the working tree
// should be something a person chooses to run.
const fs = require('fs'), cp = require('child_process');
const ROOT = require('path').join(__dirname, '..', '..');
/* The suites that guard these behaviours. The full run is 130 seconds and this
   is three, which is the difference between a mutation pass that gets run and
   one that gets skipped. Every case below is covered by one of these files; a
   mutation that survives here is re-checked against the whole suite. */
const SUBSET = ['stripeLifecycle','monthlyPause','commercialCore','securityPosture',
  'mondayOperational','accountActivity','providerTrial','productionReadiness',
  'betaClosure','entitlementMigration','releaseReadiness','observability','accessGate',
  'billingWebhook','stripeFoundation','commercialEntry','legacyBetaRetirement',
  'commercialSchemaCollision','adjustedSessionStructure',
  'prescriptionAwareLogging','passkey'].map(n => 'test/' + n + '.test.js').join(' ');

const CASES = [
  // ---- ACCESS ----
  ['access: a revoked subscription grants again', 'api/_entitlement.js',
   "if (s.condition === 'revoked') return out(false, 'revoked', null);",
   "if (s.condition === 'revoked') return out(true, 'paid', asDate(s.current_period_end));"],
  ['access: an unknown provider is trusted', 'api/_entitlement.js',
   "if (!P.isProvider(s.provider)) return out(false, 'invalid', null);", ""],
  ['access: past_due invents its own grace', 'api/_entitlement.js',
   "    const grace = asDate(s.grace_period_end);\n    if (grace && grace > at) return out(true, 'grace_period', grace);",
   "    const grace = asDate(s.grace_period_end) || new Date(at.getTime() + 30*DAY_MS);\n    if (grace && grace > at) return out(true, 'grace_period', grace);"],
  ['access: an unreadable database reads as no subscription', 'api/_commercial-store.js',
   "    return { ok: false, active: false, product: null, reason: 'invalid',",
   "    return { ok: true, active: false, product: null, reason: 'none',"],

  // ---- TRIAL ----
  ['trial: the allowance can be spent twice', 'api/billing-webhook.js',
   "'&trial_consumed_at=is.null'", "''"],
  ['trial: the trial length comes from somewhere else', 'api/_products.js',
   'const TRIAL_DAYS = 14;', 'const TRIAL_DAYS = 30;'],
  ['trial: checkout stops requiring a card', 'api/_stripe.js',
   "    payment_method_collection: 'always',", ""],

  // ---- SUBSCRIPTION / WEBHOOK ----
  ['subscription: the product code drifts again', 'api/billing-webhook.js',
   '    product_code: Prod.STANDARD,', "    product_code: 'STANDARD',"],
  ['webhook: a replay is applied twice', 'api/billing-webhook.js',
   "  if (claim.duplicate){", "  if (false){"],
  ['webhook: an unsigned delivery is accepted', 'api/billing-webhook.js',
   "  if (!check.ok){\n    log('STRIPE_REJECTED reason=' + check.reason);",
   "  if (false){\n    log('STRIPE_REJECTED reason=' + check.reason);"],
  ['webhook: a rotation drops every event', 'api/_stripe.js',
   "    if (a.length === b.length && crypto.timingSafeEqual(a, b)) matched = true;",
   "    if (i === 0 && a.length === b.length && crypto.timingSafeEqual(a, b)) matched = true;"],
  ['webhook: the S.sb prefix is doubled again', 'api/billing-webhook.js',
   "    await S.sb(cfg, '/account_commercial?account_id=eq.' +",
   "    await S.sb(cfg, '/rest/v1/account_commercial?account_id=eq.' +"],

  // ---- CANCELLATION ----
  ['cancellation: a cancelled paid period ends immediately', 'api/_entitlement.js',
   "  if (s.condition === 'active' || s.condition === 'cancelled'){",
   "  if (s.condition === 'cancelled') return out(false, 'expired', null);\n  if (s.condition === 'active'){"],
  ['cancellation: an ordinary cancellation revokes', 'api/_stripe.js',
   "    if (why === 'payment_disputed') finalCondition = 'revoked';",
   "    finalCondition = 'revoked';"],

  // ---- PAUSE ----
  ['pause: access continues while paused', 'api/_entitlement.js',
   "  if (pause) return out(false, 'paused', pause.until);", "  if (false) return out(false, 'paused', null);"],
  ['pause: a paused athlete can buy a second subscription', 'api/_entitlement.js',
   "  return a.active === true || a.reason === 'paused';", "  return a.active === true;"],
  ['pause: the yearly rule is dropped', 'api/_pause.js',
   "    if (at < eligible){", "    if (false){"],
  ['pause: resume forgets the pause happened', 'api/_pause.js',
   "      paused_at: null,\n      pause_resumes_at: null\n",
   "      paused_at: null,\n      pause_resumes_at: null,\n      last_pause_started_at: null\n"],
  ['pause: an annual subscriber may pause', 'api/_pause.js',
   "  if (s.billing_period !== PAUSE_POLICY.billingPeriod) return { ok: false, reason: 'not_monthly' };", ""],
  ['pause: four months is allowed', 'api/_pause.js', '  maxMonths: 3,', '  maxMonths: 12,'],
  ['pause: the provider is told to defer instead of void', 'api/_stripe.js',
   "    pause_collection: { behavior: 'void', resumes_at:",
   "    pause_collection: { behavior: 'keep_as_draft', resumes_at:"],
  ['pause: resume sends nothing at all', 'api/_stripe.js',
   "    pause_collection: ''\n", "    pause_collection: null\n"],

  // ---- FOUNDING PRICE ----
  ['founding price: the lock is not conditional', 'api/_commercial-store.js',
   "            '&price_locked_at=is.null'", "            ''"],
  ['founding price: an unpriceable offer is guessed', 'api/_commercial-store.js',
   "  if (!P.isOffer(a.offer_code)) return { ok: false, reason: 'unknown_offer', locked: false };", ""],

  // ---- OPERATIONAL METRICS ----
  ['metrics: the view goes back to the retired grant model', 'supabase-account-activity.sql',
   "             and s.condition = 'trialing'\n             and coalesce(s.trial_end, s.current_period_end) > now())  as trial_active,",
   "             and s.condition = 'trialing'\n             and s.trial_end > now())  as trial_active,"],
  ['metrics: last_active becomes a timeline', 'supabase-account-activity.sql',
   "     and (last_active_at is null or last_active_at < v_now - interval '1 hour')", ""],

  // ---- RLS ----
  ['rls: a policy stops scoping to the caller', 'supabase-beta-gate.sql',
   'for select using ((select auth.uid()) = user_id and (select public.is_beta_approved()));',
   'for select using ((select public.is_beta_approved()));'],
  ['rls: the beta predicate is dropped from a policy', 'supabase-beta-gate.sql',
   'for insert with check ((select auth.uid()) = user_id and (select public.is_beta_approved()));',
   'for insert with check ((select auth.uid()) = user_id);'],
  ['rls: a policy is added to a service-only table', 'supabase-entitlement.sql',
   'alter table public.access_leases enable row level security;',
   'alter table public.access_leases enable row level security;\ncreate policy "read own lease" on public.access_leases for select using ((select auth.uid()) = user_id);'],
  ['rls: a definer function loses its search path', 'supabase-setup.sql',
   "security definer\nset search_path = public, auth\nas $$\nbegin\n  if auth.uid() is null then",
   "security definer\nas $$\nbegin\n  if auth.uid() is null then"],

  // ---- ACCOUNT DELETION ----
  ['deletion: the money ledger cascades away', 'supabase-commercial-core.sql',
   '  account_id         uuid references auth.users(id) on delete set null,',
   '  account_id         uuid references auth.users(id) on delete cascade,'],
  ['deletion: a delete is not scoped to the caller', 'supabase-setup.sql',
   '  delete from public.plans where user_id = auth.uid();',
   '  delete from public.plans;'],
  ['deletion: anon may delete accounts', 'supabase-setup.sql',
   'revoke all on function public.delete_own_account() from public, anon;', ''],

  // ---- MONDAY ----
  ['monday: the raw uuid is used when no salt is set', 'api/_monday-operational.js',
   '  if (!c.hasSalt) return null;      // fail closed. Never the raw uuid.',
   '  if (!c.hasSalt) return String(accountId);'],
  ['monday: the payload is a copy rather than a projection', 'api/_monday-operational.js',
   '  const problems = validatePayload(payload);\n  if (problems.length) return { ok: false, reason: \'payload_rejected\', problems: problems };',
   '  Object.assign(payload, state);\n  const problems = [];'],
  ['monday: the allow list stops being enforced', 'api/_monday-operational.js',
   "    if (ALLOWED.indexOf(k) === -1) problems.push('field not on the allow list: ' + k);", ''],
  ['monday: a re-sync creates a second item', 'api/_monday-operational.js',
   '  if (found.existing){', '  if (false){'],
  ['monday: a provider error body is echoed', 'api/_monday-operational.js',
   "    return { ok: false, code: 'graphql_error' };",
   "    return { ok: false, code: 'graphql_error', message: json.errors[0].message };"],

  /* ---- THE STRUCTURED WORKOUT CARD ----
     An adjusted session showed as a title and a paragraph of prose because the
     day had silently lost its prescription. Nothing asserted that the card the
     athlete is looking at is the one the plan wrote, so the loss was invisible
     to the suite for as long as it was invisible in the code. Each case below
     is one way to lose it again. */
  ['workout: an adjusted session stops being shrunk and drops its structure',
   'protected/velvet-viking-valhalla.html',
   '  if (fitPrescriptionToDistance(dd, newKm)) return true;',
   '  if (false && fitPrescriptionToDistance(dd, newKm)) return true;'],
  ['workout: a shrunk session may prescribe more running than the day holds',
   'protected/velvet-viking-valhalla.html',
   '  if (qualitySessionKm(shrunk, kind) > newKm + 0.5) return false;', ''],
  ['workout: a shrink may quietly change what the session is',
   'protected/velvet-viking-valhalla.html',
   '  if (!next || next.archetype !== p.archetype) return false;',
   '  if (!next) return false;'],
  ['workout: the recovery ceiling deletes the easy run it just wrote',
   'protected/velvet-viking-valhalla.html',
   "    dd.prescription = { v:PRESCRIPTION_VERSION, archetype:'easy_run', params:{ km:round1(dd.km) } };",
   '    if (dd.prescription) delete dd.prescription;'],
  ['workout: a strides session is no longer fitted',
   'protected/velvet-viking-valhalla.html',
   "  if (p.archetype === 'easy_strides') return fitStridesToDistance(dd, p, newKm);", ''],
  ['workout: strides are hung on an easy run of nothing',
   'protected/velvet-viking-valhalla.html',
   '  if (!(easy >= EASY_MIN_KM)) return false;', ''],
  ['workout: the adjustment record is rendered above the workout',
   'protected/velvet-viking-valhalla.html',
   '          renderStructuredWorkout(dd)+\n          renderCoachingDepth(dd)+\n          renderAdjustedDetail(dd)+',
   '          renderAdjustedDetail(dd)+\n          renderCoachingDepth(dd)+\n          renderStructuredWorkout(dd)+'],
  ['workout: the card stops rendering the structured workout at all',
   'protected/velvet-viking-valhalla.html',
   '          renderStructuredWorkout(dd)+\n', ''],
  ['workout: restore leaves the day without the prescription it had',
   'protected/velvet-viking-valhalla.html',
   '  if (f.prescription) dd.prescription = JSON.parse(JSON.stringify(f.prescription));',
   '  if (false) {}'],
  ['workout: a rename overwrites the name the athlete typed',
   'protected/velvet-viking-valhalla.html',
   '  if (!wasTitle || dd.title !== wasTitle) return;', ''],
  ['workout: the heading keeps naming the distance it no longer prescribes',
   'protected/velvet-viking-valhalla.html',
   '  renameToMatchPrescription(dd, wasTitle, newKm);', ''],
  ['workout: a swap leaves the prescription on the old day',
   'protected/velvet-viking-valhalla.html',
   "'mpSegment','completed','actual',\n                               'prescription','manualEdit'",
   "'mpSegment','completed','actual',\n                               'manualEdit'"],
  ['workout: the coach’s move leaves the prescription on the old day',
   'protected/velvet-viking-valhalla.html',
   "var MOVED_WORKOUT_FIELDS = ['type','title','km','desc','mpSegment','prescription','manualEdit'];",
   "var MOVED_WORKOUT_FIELDS = ['type','title','km','desc','mpSegment','manualEdit'];"],

  // ---- PASSKEY ----
  // Each of these is a promise the feature was allowed to ship on. If a
  // mutation here survives, the promise is not actually being checked.
  ['passkey: the magic link is still drawn but no longer wired to anything',
   'protected/velvet-viking-valhalla.html',
   "'data-action=\"cloud-sign-in\">'+ICONS.link+' Email me a sign-in link</button>';",
   "'data-action=\"cloud-sign-in-x\">'+ICONS.link+' Email me a sign-in link</button>';"],
  ['passkey: the email control is dropped when a passkey exists',
   'protected/velvet-viking-valhalla.html',
   "      : '')+\n    emailBlock;", "      : '');"],
  ['passkey: a browser with no WebAuthn is offered one anyway',
   'protected/velvet-viking-valhalla.html',
   "  var pk = passkeyApiAvailable();\n  lede =", "  var pk = true;\n  lede ="],
  ['passkey: the athlete’s own token is sent to the sign-in endpoints',
   'protected/velvet-viking-valhalla.html',
   "    method: 'POST', auth: false, headers: PASSKEY_ANON_HEADERS(), body: JSON.stringify({})",
   "    method: 'POST', body: JSON.stringify({})"],
  ['passkey: enrolment stops requiring a signed-in identity',
   'protected/velvet-viking-valhalla.html',
   "  if (!cloudSignedIn()) return Promise.reject(passkeyErrFrom('session_missing'));", ""],
  ['passkey: a session without an access token is adopted anyway',
   'protected/velvet-viking-valhalla.html',
   "      if (!sess || !sess.access_token) throw passkeyErrFrom('default');", ""],
  ['passkey: a project with passkeys switched off looks like a generic failure',
   'protected/velvet-viking-valhalla.html',
   "    if (resp.status === 404 || code === 'passkey_disabled') code = 'passkey_disabled';", ""],
  ['passkey: base64url keeps its padding, so the server cannot read it',
   'protected/velvet-viking-valhalla.html',
   ".replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');",
   ".replace(/\\+/g, '-').replace(/\\//g, '_');"],
  ['passkey: what the account holds survives a sign-out',
   'protected/velvet-viking-valhalla.html',
   "function passkeyForgetLocalStatus(){ passkeyInfo = null; passkeyAsked = false; }",
   "function passkeyForgetLocalStatus(){ }"],
  ['passkey: Settings guesses "none" before the server has answered',
   'protected/velvet-viking-valhalla.html',
   "  if (known === null){\n    desc = 'Checking\\u2026';\n    btn  = '';\n  } else if (known.length){",
   "  if (false){\n    desc = 'Checking\\u2026';\n    btn  = '';\n  } else if (known && known.length){"],
  ['passkey: an unreachable list is reported as a passkey that exists',
   'protected/velvet-viking-valhalla.html',
   "    if (!resp.ok) return [];\n    return resp.json().catch(function(){ return []; });\n  }, function(){ return []; })",
   "    if (!resp.ok) return [{ id: 'assumed' }];\n    return resp.json().catch(function(){ return [{ id: 'assumed' }]; });\n  }, function(){ return [{ id: 'assumed' }]; })"],
  ['passkey: the shells gain the power to create credentials',
   'passkey.js',
   "  window.VVVPasskey = { available: available, signIn: signIn, copy: copy };",
   "  window.VVVPasskey = { available: available, signIn: signIn, copy: copy,\n    register: function(){ return navigator.credentials.create({}); },\n    registerOptions: '/auth/v1/passkeys/registration/options' };"],
  ['passkey: the two doors stop sharing one completion path',
   'protected/velvet-viking-valhalla.html',
   "  cloudCompleteSignIn();\n  return true;",
   "  cloudStatus = 'syncing'; patchCloudCard();\n  return true;"]
];

let survived = [], killed = 0;
for (const [name, file, from, to] of CASES){
  const p = ROOT + '/' + file;
  const orig = fs.readFileSync(p, 'utf8');
  if (orig.indexOf(from) === -1){ survived.push(name + '   [ANCHOR NOT FOUND]'); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  let out;
  try{
    out = cp.execSync('cd ' + ROOT + ' && node --test ' + SUBSET + ' 2>&1 | grep -c "^not ok "',
                      { encoding: 'utf8', timeout: 600000 });
  }catch(e){ out = (e.stdout || '0'); }
  fs.writeFileSync(p, orig);
  const fails = parseInt(String(out).trim(), 10) || 0;
  if (fails > 0){ killed++; console.log('KILLED  ' + String(fails).padStart(3) + '  ' + name); }
  else { survived.push(name); console.log('SURVIVED       ' + name); }
}
console.log('\n=== ' + killed + '/' + CASES.length + ' mutations detected ===');
if (survived.length) console.log('SURVIVORS:\n  ' + survived.join('\n  '));
