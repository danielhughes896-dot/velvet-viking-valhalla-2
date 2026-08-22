'use strict';
//
//   node test/mutation/run.js              every case
//   node test/mutation/run.js record       only the cases whose name starts "record"
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
const files = ns => ns.map(n => 'test/' + n + '.test.js').join(' ');
const SUBSET = files(['stripeLifecycle','monthlyPause','commercialCore','securityPosture',
  'mondayOperational','accountActivity','providerTrial','productionReadiness',
  'betaClosure','entitlementMigration','releaseReadiness','observability','accessGate',
  'billingWebhook','stripeFoundation','commercialEntry','legacyBetaRetirement',
  'commercialSchemaCollision','adjustedSessionStructure',
  'prescriptionAwareLogging','healthDataConsent',
  'medicalBoundary','healthErasure','commercialJourney',
  'productionReadiness']);
/* Plan HQ's cases are checked against the suites that guard them rather than
   against the commercial subset above, which knows nothing about them:
   thirty-odd runtime cases against twenty-five API suites is minutes of work
   to reach the same verdict. A case names its own subset as a fifth element,
   and anything that does not name one gets SUBSET. */
const RECORD_SUBSET = files(['planHqRecord','planHqReading','modalThemeConsistency',
  'phase4AppUx','yearRoundLifecycle','coachSurfaceDistinctness']);
// The accent migration's own guards, plus the two suites that already held
// the switch component and the gauge's colour semantics.
const ACCENT_SUBSET = files(['cherryLacquer','themeSystem','metricColour',
  'modalThemeConsistency','planHqReading','lightModeSystem']);
const HQ_SUBSET = RECORD_SUBSET;
const BUILDER_SUBSET = files(['builderNineStages','cherryLacquer','healthDataConsent',
                             'betaLegalDiscoverability','yearRoundLifecycle']);

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

  /* ---- HEALTH AND READINESS CONSENT ----
     Every case below is one way an athlete's health information could be
     processed without their explicit agreement, or one way declining could
     quietly cost them something. A guard nothing detects is not a guard, and
     for this particular boundary "nothing detected it" is the whole failure
     mode: the athlete never sees that it went wrong. */
  ['consent: the gate stops fai1ing closed',
   'protected/velvet-viking-valhalla.html',
   "  return !!(c && c.decision === 'granted' && c.version === HEALTH_CONSENT_VERSION);",
   '  return true;'],
  ['consent: a stale version still counts as agreement',
   'protected/velvet-viking-valhalla.html',
   "  return !!(c && c.decision === 'granted' && c.version === HEALTH_CONSENT_VERSION);",
   "  return !!(c && c.decision === 'granted');"],
  ['consent: the default becomes granted',
   'protected/velvet-viking-valhalla.html',
   '    healthConsent:null\n  };',
   "    healthConsent:{ version:HEALTH_CONSENT_VERSION, decision:'granted', decidedAt:null,\n"+
   '                    grantedAt:null, withdrawnAt:null }\n  };'],
  ['consent: the builder box is pre-ticked',
   'protected/velvet-viking-valhalla.html',
   "'<input type=\"checkbox\" id=\"su-health-consent\" style=\"width:auto; margin:3px 7px 0 0;\">'",
   "'<input type=\"checkbox\" id=\"su-health-consent\" checked style=\"width:auto; margin:3px 7px 0 0;\">'"],
  ['consent: heart rate reaches the athlete record anyway',
   'protected/velvet-viking-valhalla.html',
   '        hr: (isPast && healthConsentGranted() && a.hr!=null) ? a.hr : null,',
   '        hr: (isPast && a.hr!=null) ? a.hr : null,'],
  ['consent: how a session felt is read anyway',
   'protected/velvet-viking-valhalla.html',
   '  // How a session felt is what the athlete reported about themselves.\n  if (!healthConsentGranted()) return null;',
   ''],
  ['consent: the morning readiness answers are read anyway',
   'protected/velvet-viking-valhalla.html',
   '  if (!healthConsentGranted()) return null;\n  return (dd && dd.readiness && (dd.readiness.legs',
   '  return (dd && dd.readiness && (dd.readiness.legs'],
  ['consent: body and sleep readings are taken from the notes anyway',
   'protected/velvet-viking-valhalla.html',
   '    if (withhold && isCoveredNoteSignal(NOTE_SIGNAL_BY_ID[sig.id])) return;',
   ''],
  ['consent: the covered-signal classifier stops covering the body',
   'protected/velvet-viking-valhalla.html',
   "var HEALTH_COVERED_NOTE_CATS = ['physical'];",
   'var HEALTH_COVERED_NOTE_CATS = [];'],
  /* THE ZONE TABLE IS THE ROOT, and it is the one worth mutating. The target
     range, the structured card's per-step BPM, the Execution Strategy phases,
     the Plan HQ tables and the scoring path all read it.

     The gates on its individual readers -- getTargetHRRangeForDay,
     executionHRTarget, computeHRScore -- are deliberately kept as defence in
     depth, and are deliberately NOT listed here as cases of their own: with
     the root gate in place, removing any one of them changes no behaviour, so
     a case for it would report as a survivor forever and teach the next reader
     to ignore survivors. What must never survive is losing the root, and that
     is this case. */
  ['consent: the athlete’s heart-rate zones are computed anyway',
   'protected/velvet-viking-valhalla.html',
   '  if (!healthConsentGranted()) return {};\n  var su = state.setup;',
   '  var su = state.setup;'],
  ['consent: a typed heart rate is stored anyway',
   'protected/velvet-viking-valhalla.html',
   "    if (value==='') dd.actual.hr = null;\n    else if (healthConsentGranted()) dd.actual.hr = parseInt(value,10);",
   "    dd.actual.hr = value===''?null:parseInt(value,10);"],
  ['consent: heart-rate drift is still computed from saved laps',
   'protected/velvet-viking-valhalla.html',
   '  if (!healthConsentGranted()) return null;\n  var a = dd && dd.actual;\n  var splits = a && a.splits;',
   '  var a = dd && dd.actual;\n  var splits = a && a.splits;'],
  ['consent: the recent-context aggregate still averages heart rate',
   'protected/velvet-viking-valhalla.html',
   "    recentEasyHR: healthConsentGranted()\n      ? mean(easies, function(x){ return (x.actual||{}).hr; }) : null,",
   '    recentEasyHR: mean(easies, function(x){ return (x.actual||{}).hr; }),'],
  ['consent: comparable sessions put the heart rate back on the card',
   'protected/velvet-viking-valhalla.html',
   '               hr: healthConsentGranted() ? (x.actual||{}).hr : null };',
   '               hr: (x.actual||{}).hr };'],
  ['consent: a Strava heart rate is written into the log anyway',
   'protected/velvet-viking-valhalla.html',
   '  if (healthConsentGranted()){\n    if (a.hr != null)           A.hr = a.hr;\n    if (a.maxHR != null)        A.maxHR = a.maxHR;\n  }',
   '  if (a.hr != null) A.hr = a.hr;\n  if (a.maxHR != null) A.maxHR = a.maxHR;'],
  ['consent: a Strava heart rate is stored on the server anyway',
   'api/_strava.js',
   '  const staged = await HC.forIngest(cfg, sb, userId, activity);',
   '  const staged = activity;'],
  /* The anchor here is the LOGGED refusal, not the bare `return false` this
     case was written against: adding the diagnostic split that line into a
     block and silently turned the case into an ANCHOR NOT FOUND -- a mutation
     testing nothing, which is exactly the failure a mutation pass exists to
     catch and did. */
  ['consent: an unreadable consent table is read as agreement',
   'api/_health-consent.js',
   "      log('READ_FAILED status=' + (r ? r.status : 'none'));\n      return false;",
   "      log('READ_FAILED status=' + (r ? r.status : 'none'));\n      return true;"],
  ['consent: the ingest strip stops removing the covered fields',
   'api/_health-consent.js',
   "const COVERED_ACTIVITY_FIELDS = ['hr', 'maxHR'];",
   'const COVERED_ACTIVITY_FIELDS = [];'],
  ['consent: the Garmin seam trusts its own strip',
   'api/_garmin.js',
   '  if (!granted && HC.carriesCovered(out)){',
   '  if (false){'],
  ['consent: withdrawal leaves the heart-rate profile values behind',
   'protected/velvet-viking-valhalla.html',
   '  if (!granted && state.setup){ state.setup.lthr = null; state.setup.maxHR = null; }',
   ''],
  ['consent: the record collapses to a bare boolean',
   'protected/velvet-viking-valhalla.html',
   "    grantedAt: decision === 'granted' ? now : (prev ? prev.grantedAt || null : null),",
   '    grantedAt: null,'],
  ['consent: withdrawal is not timestamped',
   'protected/velvet-viking-valhalla.html',
   "    withdrawnAt: decision === 'granted' ? null : (prev && prev.decision === 'granted' ? now : null)",
   '    withdrawnAt: null'],
  ['consent: the athlete is asked again after saying no',
   'protected/velvet-viking-valhalla.html',
   "function renderHealthConsentCard(){\n  if (healthConsentAnswered()) return '';",
   "function renderHealthConsentCard(){\n  if (healthConsentGranted()) return '';"],
  ['consent: Settings loses the way back out',
   'protected/velvet-viking-valhalla.html',
   "    renderHealthConsentSettings()+",
   ''],
  ['consent: the client and server versions drift apart',
   'api/_health-consent.js',
   "const HEALTH_CONSENT_VERSION = 'health_data_consent_v1';",
   "const HEALTH_CONSENT_VERSION = 'health_data_consent_v2';"],
  ['consent: the audit table becomes rewritable by its own subject',
   'supabase-health-consent.sql',
   'create policy "own health consent: insert" on public.health_data_consent\n  for insert with check ((select auth.uid()) = user_id);',
   'create policy "own health consent: insert" on public.health_data_consent\n'+
   '  for insert with check ((select auth.uid()) = user_id);\n'+
   'create policy "own health consent: update" on public.health_data_consent\n'+
   '  for update using ((select auth.uid()) = user_id);'],
  ['consent: the audit table stops being scoped to the athlete',
   'supabase-health-consent.sql',
   'create policy "own health consent: select" on public.health_data_consent\n  for select using ((select auth.uid()) = user_id);',
   'create policy "own health consent: select" on public.health_data_consent\n  for select using (true);'],
  ['consent: a covered field is added to the operational allow list',
   'api/_monday-operational.js',
   "  'syncedAt'\n];",
   "  'syncedAt',\n  'readiness'\n];"],

  // ---- HEALTH CONSENT: THE ASYMMETRY, AND THE ERASURE ----
  ['consent: a grant no longer needs a record to prove it', 'protected/velvet-viking-valhalla.html',
   "  if (granted && cloudSignedIn()){", "  if (false){"],
  ['consent: the builder reads LTHR before the grant is recorded', 'protected/velvet-viking-valhalla.html',
   "if (consentBox) await handleHealthConsentDecision(!!consentBox.checked, { quiet:true });",
   "if (consentBox) handleHealthConsentDecision(!!consentBox.checked, { quiet:true });"],
  ['consent: a failed record is treated as a success', 'protected/velvet-viking-valhalla.html',
   "      if (!recorded){", "      if (false){"],
  ['erasure: it removes something that is not covered', 'api/_health-erasure.js',
   "const PLAN_ACTUAL_FIELDS = ['hr', 'feel'];", "const PLAN_ACTUAL_FIELDS = ['hr', 'feel', 'rpe'];"],
  ['erasure: the subtractive check stops checking', 'api/_health-erasure.js',
   "    if (problems.length) return { ok: false, reason: 'not_subtractive', problems: problems };",
   "    if (false) return { ok: false, reason: 'not_subtractive', problems: problems };"],
  ['erasure: a dry run writes anyway', 'api/_health-erasure.js',
   "    if (!dryRun && report.plan.changed){", "    if (report.plan.changed){"],
  ['erasure: it destroys the consent record with the values', 'api/_health-erasure.js',
   "  const out = Object.assign({}, planData);",
   "  const out = Object.assign({}, planData); delete out.healthConsent;"],
  ['erasure: it mutates the caller document', 'api/_health-erasure.js',
   "  const out = Object.assign({}, obj);", "  const out = obj;"],

  // ---- STORE STEERING ----
  ['store: the prices come back inside the native shell', 'start.html',
   "  if (isNativeApp()){", "  if (false){"],

  // ---- ANDROID ----
  ['android: a manifest comment breaks XML again', 'android/app/src/main/AndroidManifest.xml',
   "locally cached plan — which, for a", "locally cached plan -- which, for a"],
  ['android: device backup of the cached plan is allowed again', 'android/app/src/main/AndroidManifest.xml',
   'android:allowBackup="false"', 'android:allowBackup="true"'],

  // ---- MONDAY MIRROR ----
  ['monday: the mirror trusts the caller instead of re-reading', 'api/_monday-operational.js',
   "    const facts = await Store.readCommercialFacts(S, cfg, accountId);",
   "    const facts = { ok: true, account: null, subscriptions: [], grants: [] };"],
  ['monday: a mirror failure fails the webhook', 'api/billing-webhook.js',
   "    if (!mirrored.ok && mirrored.code !== 'operational_sync_disabled'){",
   "    if (!mirrored.ok){ return S.json(res, 503, { error: 'unavailable' }); }\n    if (false){"],

  // ---- PLAN HQ: THE RECORD ----
  ['record: a Record value is a fact, and stops being one', 'protected/velvet-viking-valhalla.html',
   "  .rec-val{font-size:11.5px; color:var(--ink-dim);",
   "  .rec-val{font-size:11.5px; color:var(--c-tempo);", RECORD_SUBSET],
  ['record: the four cards become one combined list again', 'protected/velvet-viking-valhalla.html',
   "  return '<div class=\"setup-section-title\">The Record</div>'+",
   "  return '<div class=\"setup-section-title\">The Record</div><table>'+", RECORD_SUBSET],
  ['record: a card stops reading live state and states a fixed value', 'protected/velvet-viking-valhalla.html',
   "    ? recordValue(DISTANCE_PROFILES[b.distanceKey].label+' · '+secToClock(b.timeSec), 'font-mono')",
   "    ? recordValue('Half Marathon · 1:37:00', 'font-mono')", RECORD_SUBSET],
  ['record: the zone panel rebuilds the editor instead of hosting it', 'protected/velvet-viking-valhalla.html',
   '  var body = renderZonePacesCard(true)+', "  var body = '<div class=\"field-hint\">Paces</div>'+", RECORD_SUBSET],
  ['record: the progress panel loses the mount patchDerivedStats() patches', 'protected/velvet-viking-valhalla.html',
   "  var body = '<div id=\"planhq-stats-mount\">'+renderPlanOverviewStats()+'</div>'+",
   "  var body = '<div>'+renderPlanOverviewStats()+'</div>'+", RECORD_SUBSET],
  ['record: the benchmark panel grows its own benchmark form', 'protected/velvet-viking-valhalla.html',
   "      'data-action=\"open-recalibrate\">'+ICONS.zap+' Update benchmark &amp; re-calibrate</button>'",
   "      'data-action=\"open-recalibrate\">'+ICONS.zap+' Update benchmark &amp; re-calibrate</button>'+'<input id=\"rc-bench-time\">'", RECORD_SUBSET],
  ['record: a detail panel becomes a wizard step', 'protected/velvet-viking-valhalla.html',
   "    '<div class=\"modal-body\">'+body+",
   "    '<div class=\"modal-body\"><div class=\"bld-progress\"></div><span class=\"bld-stage-no\">01 / 05</span>'+body+", RECORD_SUBSET],
  ['record: BACK stops being the violet full-width navigation', 'protected/velvet-viking-valhalla.html',
   "        '<button type=\"button\" class=\"btn btn-primary btn-block\" data-action=\"close-record-panel\">← BACK</button>'+",
   "        '<button type=\"button\" class=\"btn btn-ghost\" data-action=\"close-record-panel\">← BACK</button>'+", RECORD_SUBSET],
  ['record: X and BACK stop agreeing', 'protected/velvet-viking-valhalla.html',
   "'<button type=\"button\" class=\"icon-btn\" data-action=\"close-record-panel\" aria-label=\"Close\">'",
   "'<button type=\"button\" class=\"icon-btn\" data-action=\"close-modal\" aria-label=\"Close\">'", RECORD_SUBSET],
  ['record: closing a panel drops the athlete back at the top of Plan HQ',
   'protected/velvet-viking-valhalla.html',
   "  try { window.scrollTo(0, planhqReturnScrollY); } catch(err) { }",
   "  try { window.scrollTo(0, 0); } catch(err) { }", RECORD_SUBSET],
  ['record: a pace edit scrolls Plan HQ away underneath the panel',
   'protected/velvet-viking-valhalla.html',
   "  renderApp();\n  restorePlanHQScroll();\n  refreshOpenRecordPanel();\n  showToast('Zone paces reset to calculated values');",
   "  renderApp();\n  showToast('Zone paces reset to calculated values');", RECORD_SUBSET],
  ['record: a benchmark is called a measurement of current fitness',
   'protected/velvet-viking-valhalla.html',
   "    '<div class=\"setup-section-title\">Not a measurement of current fitness</div>'+",
   "    '<div class=\"setup-section-title\">Your current fitness</div>'+", RECORD_SUBSET],
  ['record: the paces are said to come from the benchmark', 'protected/velvet-viking-valhalla.html',
   "        ? 'Calculated from your active goal — Goal '+escapeHtml(state.setup.activeGoal)+', '+",
   "        ? 'Derived from your benchmark — Goal '+escapeHtml(state.setup.activeGoal)+', '+", RECORD_SUBSET],
  ['record: a completed checkpoint is counted before it is measured',
   'protected/velvet-viking-valhalla.html',
   "    var counted = chk.completed && measuredPerformances().some(function(p){\n      return p.date === chk.date;\n    });",
   "    var counted = chk.completed;", RECORD_SUBSET],
  ['record: Plan HQ keeps the confidence gauge but loses the line beneath it',
   'protected/velvet-viking-valhalla.html',
   "    (state.setup ? '<div class=\"field-hint\">Confidence reflects how closely your logged sessions have matched '+",
   "    (false ? '<div class=\"field-hint\">Confidence reflects how closely your logged sessions have matched '+", RECORD_SUBSET],
  ['record: the zone editor loses its head everywhere, not just in the panel',
   'protected/velvet-viking-valhalla.html',
   "    (inPanel ? '' : '<div class=\"zpc-head\"><span class=\"font-head\">Training Zone Paces</span></div>')+",
   "    ''+", RECORD_SUBSET],

  // ---- PLAN HQ: THE READING ----
  ['reading: an interpretation quietly loses its card', 'protected/velvet-viking-valhalla.html',
   "var READING_KEYS = ['readiness','recovery','evolution','patterns','adaptation'];",
   "var READING_KEYS = ['readiness','recovery','evolution','patterns'];", HQ_SUBSET],
  ['reading: tone is invented rather than borrowed from the engine',
   'protected/velvet-viking-valhalla.html',
   "      tone: { fresh:'good', watch:'watch', strained:'bad' }[rec.state],",
   "      tone: 'good',", HQ_SUBSET],
  ['reading: a Reading card stops carrying its conclusion', 'protected/velvet-viking-valhalla.html',
   "  var value = '<span class=\"read-val'+tone+'\">'+",
   "  var value = '<span class=\"rec-val\">'+", HQ_SUBSET],
  ['reading: a panel stops hosting the evidence and paraphrases it',
   'protected/velvet-viking-valhalla.html',
   "  return recordPanelShell(sec.title, head+'<div class=\"hub-card\">'+sec.body+'</div>');",
   "  return recordPanelShell(sec.title, head+'<div class=\"hub-card\">'+escapeHtml(sec.syn)+'</div>');", HQ_SUBSET],
  ['reading: the cards go back to expanding in place', 'protected/velvet-viking-valhalla.html',
   "  return '<button type=\"button\" class=\"rec-card\" data-action=\"open-reading\" data-reading=\"'+sec.key+'\">'+",
   "  return '<button type=\"button\" class=\"rec-card\" aria-expanded=\"false\" data-action=\"toggle-hq-section\" data-reading=\"'+sec.key+'\">'+", HQ_SUBSET],
  ['reading: BACK stops being the only violet in a panel', 'protected/velvet-viking-valhalla.html',
   "  .hq-panel .btn-primary{background:linear-gradient(135deg,var(--bronze),var(--bronze-2)); color:var(--bronze-ink);}",
   "", HQ_SUBSET],

  // ---- PLAN HQ: RACE OUTLOOK ----
  ['outlook: a training run becomes measured evidence', 'protected/velvet-viking-valhalla.html',
   "  var est = measuredFitnessEstimate(key);\n  if (!est) return { state:'none', profile:profile, goalSec:goalSec };",
   "  var est = measuredFitnessEstimate(key);\n  if (!est) return { state:'measured', profile:profile, goalSec:goalSec, fastSec:goalSec, slowSec:goalSec+300, fromDate:todayStr(), fromSource:'race' };", HQ_SUBSET],
  ['outlook: a withheld estimate is drawn anyway', 'protected/velvet-viking-valhalla.html',
   "  if (est.withheld) return { state:'withheld', profile:profile, goalSec:goalSec, reason:est.reason };",
   "  if (est.withheld) return { state:'measured', profile:profile, goalSec:goalSec, fastSec:goalSec-120, slowSec:goalSec+120, fromDate:todayStr(), fromSource:'race' };", HQ_SUBSET],
  ['outlook: the goal marker stops coming from the active goal',
   'protected/velvet-viking-valhalla.html',
   "  var goalSec = (goal && goal.timeSec) ? goal.timeSec : null;",
   "  var goalSec = state.setup.benchmark ? state.setup.benchmark.timeSec : null;", HQ_SUBSET],
  ['outlook: the measured band stops wearing the brand accent',
   'protected/velvet-viking-valhalla.html',
   "    background:var(--cherry);\n    min-width:8px;",
   "    background:var(--gold);\n    min-width:8px;", HQ_SUBSET],
  ['outlook: the goal marker stops being gold', 'protected/velvet-viking-valhalla.html',
   "    border-radius:2px; background:var(--gold);",
   "    border-radius:2px; background:var(--violet);", HQ_SUBSET],
  ['outlook: it stops repainting when a measurement is logged',
   'protected/velvet-viking-valhalla.html',
   "  var outlookEl = document.getElementById('outlook-mount');\n  if (outlookEl) outlookEl.innerHTML = renderRaceOutlook();",
   "", HQ_SUBSET],
  ['outlook: it is placed above the gauge it belongs beneath',
   'protected/velvet-viking-valhalla.html',
   "    (state.setup ? '<div id=\"outlook-mount\">'+renderRaceOutlook()+'</div>' : '');",
   "    '';", HQ_SUBSET],

  // ---- PLAN HQ: THE ACTION TRIO ----
  ['trio: two tiles fire the same action again', 'protected/velvet-viking-valhalla.html',
   "    actionTile('open-new-block', ICONS.layers, 'New block')+",
   "    actionTile('open-setup', ICONS.layers, 'New block')+", HQ_SUBSET],
  ['trio: CHECKPOINT offers a door to a session that is not there',
   'protected/velvet-viking-valhalla.html',
   "  var chk = scheduledCheckpointDay();\n  var body;\n  if (!chk){",
   "  var chk = scheduledCheckpointDay();\n  var body;\n  if (false){", HQ_SUBSET],
  ['trio: CHECKPOINT becomes generic workout scheduling', 'protected/velvet-viking-valhalla.html',
   "      '<div class=\"setup-section-title\">What it is for</div>'+",
   "      '<div class=\"setup-section-title\">Schedule a session</div>'+", HQ_SUBSET],
  ['trio: NEW BLOCK loses the builder it always has to offer',
   'protected/velvet-viking-valhalla.html',
   "    '<button type=\"button\" class=\"btn btn-ghost btn-block\" data-action=\"open-setup\">'+\n      ICONS.target+' Build a new training block</button>'+",
   "    ''+", HQ_SUBSET],
  ['trio: a tile drops below a thumb-sized target', 'protected/velvet-viking-valhalla.html',
   "    min-height:76px; padding:10px 6px; font:inherit; text-align:center; cursor:pointer;",
   "    min-height:28px; padding:10px 6px; font:inherit; text-align:center; cursor:pointer;", HQ_SUBSET],
  // ---- CHERRY LACQUER: THE ACCENT MIGRATION ----
  ['accent: the old violet comes back as a token', 'protected/velvet-viking-valhalla.html',
   "    --cherry:#532D3A;\n    --cherry-fill:#532D3A;",
   "    --cherry:#4C2A6B;\n    --cherry-fill:#4C2A6B;", ACCENT_SUBSET],
  ['accent: a brand control hard-codes the colour instead of the token',
   'protected/velvet-viking-valhalla.html',
   "  .builder-light .btn-primary{\n    background:var(--cherry-fill); color:var(--cherry-btn-ink);",
   "  .builder-light .btn-primary{\n    background:#532D3A; color:#FFFFFF;", ACCENT_SUBSET],
  ['accent: the primary goes back to a gradient', 'protected/velvet-viking-valhalla.html',
   "  .hq-panel .rec-panel-nav .btn-primary{\n    background:var(--cherry-fill); color:var(--cherry-btn-ink);",
   "  .hq-panel .rec-panel-nav .btn-primary{\n    background:linear-gradient(135deg,var(--cherry-fill),var(--cherry-text)); color:var(--cherry-btn-ink);", ACCENT_SUBSET],
  ['accent: dark mode ships the raw brand value and loses its control boundary',
   'protected/velvet-viking-valhalla.html',
   "    --cherry:#AD4A5F;                   /* bare indicators -- 3.06:1 on --bg-3 */",
   "    --cherry:#532D3A;                   /* bare indicators -- 3.06:1 on --bg-3 */", ACCENT_SUBSET],
  ['accent: dark mode lifts further than it needs to', 'protected/velvet-viking-valhalla.html',
   "    --cherry:#AD4A5F;                   /* bare indicators -- 3.06:1 on --bg-3 */",
   "    --cherry:#C08094;                   /* bare indicators -- 3.06:1 on --bg-3 */", ACCENT_SUBSET],
  ['accent: the dark companion drifts off the Cherry Lacquer hue',
   'protected/velvet-viking-valhalla.html',
   "    --cherry:#AD4A5F;                   /* bare indicators -- 3.06:1 on --bg-3 */",
   "    --cherry:#6C549A;                   /* bare indicators -- 3.06:1 on --bg-3 */", ACCENT_SUBSET],
  ['accent: small accent text is painted with the fill tone', 'protected/velvet-viking-valhalla.html',
   "letter-spacing:1px; color:var(--cherry-text);}",
   "letter-spacing:1px; color:var(--cherry);}", ACCENT_SUBSET],
  ['accent: a semantic status colour is swallowed by the brand',
   'protected/velvet-viking-valhalla.html',
   "  .read-val.good{color:var(--c-easy);}", "  .read-val.good{color:var(--cherry);}", ACCENT_SUBSET],
  ['accent: the destructive button takes the brand', 'protected/velvet-viking-valhalla.html',
   "  .btn-danger{background:none; border:1px solid var(--c-threshold); color:var(--danger-text);}",
   "  .btn-danger{background:none; border:1px solid var(--cherry); color:var(--cherry);}", ACCENT_SUBSET],
  ['accent: gold gives up the focus ring', 'protected/velvet-viking-valhalla.html',
   "  :focus-visible{outline:2px solid var(--gold); outline-offset:2px; border-radius:4px;}",
   "  :focus-visible{outline:2px solid var(--cherry); outline-offset:2px; border-radius:4px;}", ACCENT_SUBSET],
  ['accent: the switch stops sharing one ON colour', 'protected/velvet-viking-valhalla.html',
   "  .switch input:checked + .switch-track{background:var(--cherry);}",
   "  .switch input:checked + .switch-track{background:var(--bronze);}", ACCENT_SUBSET],
  ['accent: the gauge needle stops carrying the accent', 'protected/velvet-viking-valhalla.html',
   "stroke=\"var(--cherry)\" stroke-width=\"2.4\"",
   "stroke=\"var(--gold)\" stroke-width=\"2.4\"", ACCENT_SUBSET],
  ['accent: a component redefines the accent for one theme',
   'protected/velvet-viking-valhalla.html',
   "  .rec-panel-nav{margin-top:22px;}",
   "  .rec-panel-nav{margin-top:22px; --cherry:#7A3F52;}", ACCENT_SUBSET],

  ['theme: Edit Session opens on the fixed dark ramp again',
   'protected/velvet-viking-valhalla.html',
   "  openModal(html, 'modal-themed');\n}\n\nfunction findDay(dayId){",
   "  openModal(html);\n}\n\nfunction findDay(dayId){", HQ_SUBSET],
  ['theme: the one modal that must interrupt quietly opts into the theme',
   'protected/velvet-viking-valhalla.html',
   "    '<button type=\"button\" class=\"btn btn-ghost btn-block\" data-action=\"cloud-keep-remote\">Use my account\u2019s plan</button>'+\n  '</div>');",
   "    '<button type=\"button\" class=\"btn btn-ghost btn-block\" data-action=\"cloud-keep-remote\">Use my account\u2019s plan</button>'+\n  '</div>', 'modal-themed');", HQ_SUBSET],
  // ---- THE NINE-STAGE BUILDER ----
  ['builder: a stage is dropped from the journey', 'protected/velvet-viking-valhalla.html',
   "var BLD_STAGE_NAMES = ['Goal','Distance','Event','You','Benchmark','Week','Training data','Targets','Review'];",
   "var BLD_STAGE_NAMES = ['Goal','Distance','Event','You','Benchmark','Week','Targets','Review'];", BUILDER_SUBSET],
  ['builder: a validation rule is pointed at the wrong screen',
   'protected/velvet-viking-valhalla.html',
   "  if (i === BLD_STAGE.YOU){\n    var volume = parseDistInput",
   "  if (i === BLD_STAGE.BENCHMARK){\n    var volume = parseDistInput", BUILDER_SUBSET],
  ['builder: the named stage indices drift out of step with the order',
   'protected/velvet-viking-valhalla.html',
   "var BLD_STAGE = { GOAL:0, DISTANCE:1, EVENT:2, YOU:3, BENCHMARK:4, WEEK:5, TRAINING:6, TARGETS:7, REVIEW:8 };",
   "var BLD_STAGE = { GOAL:0, DISTANCE:1, EVENT:2, YOU:4, BENCHMARK:3, WEEK:5, TRAINING:6, TARGETS:7, REVIEW:8 };", BUILDER_SUBSET],
  ['builder: a panel is unmounted instead of hidden, breaking the couplings',
   'protected/velvet-viking-valhalla.html',
   "    '<section class=\"bld-panel\" data-stage=\"4\" hidden>'+",
   "    '<section class=\"bld-panel\" data-stage=\"4\">'+", BUILDER_SUBSET],
  ['builder: the goal requirement becomes race-only',
   'protected/velvet-viking-valhalla.html',
   "  if (!anyGoal){ showToast('Enter at least one goal time (or tap Suggest first)'); return; }",
   "  if (!anyGoal && buildPurpose === 'race'){ showToast('Enter at least one goal time (or tap Suggest first)'); return; }", BUILDER_SUBSET],
  ['builder: the no-HR skip invents a heart rate instead of leaving it blank',
   'protected/velvet-viking-valhalla.html',
   "    if (el) el.value = '';\n  });\n  handleBldNext();",
   "    if (el) el.value = (id === 'su-lthr') ? '172' : '188';\n  });\n  handleBldNext();", BUILDER_SUBSET],
  ['builder: consent drifts away from the data it governs',
   'protected/velvet-viking-valhalla.html',
   "      renderHealthConsentStep()+\n      navBtns(6)+",
   "      navBtns(6)+", BUILDER_SUBSET],
  ['builder: the objectives go back to a single column',
   'protected/velvet-viking-valhalla.html',
   "  .bld-purpose{display:grid; gap:10px; grid-template-columns:1fr 1fr;}",
   "  .bld-purpose{display:grid; gap:10px; grid-template-columns:1fr;}", BUILDER_SUBSET],
  ['builder: the fifth distance is stranded on its own row',
   'protected/velvet-viking-valhalla.html',
   "  .opt-grid-32 > button:nth-child(n+4){grid-column:span 3;}",
   "  .opt-grid-32 > button:nth-child(n+4){grid-column:span 2;}", BUILDER_SUBSET],
  ['builder: a selected objective wears the primary-action colour',
   'protected/velvet-viking-valhalla.html',
   "  .bld-purpose button.active{\n    color:var(--modal-active); background:rgba(var(--modal-active-rgb),0.14);",
   "  .bld-purpose button.active{\n    color:var(--cherry); background:rgba(var(--modal-active-rgb),0.14);", BUILDER_SUBSET],
  // ---- THE ANTI-ROSE RULE ----
  ['accent: the dark fill slides back up to a mid-tone rose',
   'protected/velvet-viking-valhalla.html',
   "    --cherry-fill:#7A2E42;              /* labelled fills -- white at 9.14:1 */",
   "    --cherry-fill:#AD4A5F;              /* labelled fills -- white at 9.14:1 */", ACCENT_SUBSET],
  ['accent: the two tones collapse back into one',
   'protected/velvet-viking-valhalla.html',
   "    --cherry-fill:#7A2E42;              /* labelled fills -- white at 9.14:1 */",
   "    --cherry-fill:var(--cherry);        /* labelled fills -- white at 9.14:1 */", ACCENT_SUBSET],
  ['accent: the dark fill loses the rim that gives it a boundary',
   'protected/velvet-viking-valhalla.html',
   "  .builder-light .btn-primary{\n    background:var(--cherry-fill); color:var(--cherry-btn-ink);\n    box-shadow:inset 0 0 0 1px var(--cherry);\n  }",
   "  .builder-light .btn-primary{\n    background:var(--cherry-fill); color:var(--cherry-btn-ink);\n  }", ACCENT_SUBSET],
  ['accent: light mode stops using the canonical value on filled controls',
   'protected/velvet-viking-valhalla.html',
   "    --cherry-fill:#532D3A;              /* the canonical value on both jobs */",
   "    --cherry-fill:#6B3A49;              /* the canonical value on both jobs */", ACCENT_SUBSET],
  ['trio: going to the checkpoint stops opening its week',
   'protected/velvet-viking-valhalla.html',
   "  state.view = 'full';\n  expandedWeeks[chk.week] = true;",
   "  state.view = 'full';", HQ_SUBSET]

];

/* An optional name prefix narrows the run, so a change to one area can be
   mutation-checked in seconds without waiting for every unrelated case. */
const only = process.argv[2] || '';
const SELECTED = only ? CASES.filter(c => c[0].startsWith(only)) : CASES;
if (only && !SELECTED.length){
  console.error('no case name starts with "' + only + '"');
  process.exit(1);
}
if (only) console.log('running ' + SELECTED.length + ' of ' + CASES.length + ' cases matching "' + only + '"\n');

let survived = [], killed = 0;
for (const [name, file, from, to, subset] of SELECTED){
  const p = ROOT + '/' + file;
  const orig = fs.readFileSync(p, 'utf8');
  if (orig.indexOf(from) === -1){ survived.push(name + '   [ANCHOR NOT FOUND]'); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  let out;
  try{
    out = cp.execSync('cd ' + ROOT + ' && node --test ' + (subset || SUBSET) + ' 2>&1 | grep -c "^not ok "',
                      { encoding: 'utf8', timeout: 600000 });
  }catch(e){ out = (e.stdout || '0'); }
  fs.writeFileSync(p, orig);
  const fails = parseInt(String(out).trim(), 10) || 0;
  if (fails > 0){ killed++; console.log('KILLED  ' + String(fails).padStart(3) + '  ' + name); }
  else { survived.push(name); console.log('SURVIVED       ' + name); }
}
console.log('\n=== ' + killed + '/' + SELECTED.length + ' mutations detected ===');
if (survived.length) console.log('SURVIVORS:\n  ' + survived.join('\n  '));
