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
  'commercialSchemaCollision','adjustedSessionStructure','prescriptionAwareLogging',
  'historicalImmutability','historyIntegrity','reconcileRegeneratedDays',
  'healthDataConsent','medicalBoundary','healthErasure','commercialJourney',
  'productionReadiness'].map(n => 'test/' + n + '.test.js').join(' ');

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
  /* ---- HISTORICAL IMMUTABILITY ----
     Elapsed training is evidence. A regeneration may re-tailor today and the
     future and must not touch the calendar behind the athlete. */
  ['history: a rebuild may refill elapsed days again', 'protected/velvet-viking-valhalla.html',
   "    return dd.date < today && dd.date >= startMonday;",
   "    return false;"],
  ['history: a rebuild freezes today as well as the past', 'protected/velvet-viking-valhalla.html',
   "    return dd.date < today && dd.date >= startMonday;",
   "    return dd.date <= today && dd.date >= startMonday;"],
  ['history: a previous block\u2019s days are dragged into this one', 'protected/velvet-viking-valhalla.html',
   "    return dd.date < today && dd.date >= startMonday;",
   "    return dd.date < today;"],
  ['history: a logged day outside the block stops being preserved', 'protected/velvet-viking-valhalla.html',
   "    if (dayCarriesHistory(dd)) return true;", ""],

  /* ---- VOLUME CEILING ----
     The launch blocker. Volume compounded block on block with nothing anywhere
     comparing it to the athlete: 60 -> 86 -> 149 -> 257 km/week over three
     years. Every mutation here reopens one part of the loop that closes it. */
  ['volume: the peak is no longer capped', 'protected/velvet-viking-valhalla.html',
   "  var peakVolume = Math.min(currentVolume * volMult, ceiling);",
   "  var peakVolume = currentVolume * volMult;", ['volumeCeiling','blockShape','blockTransitions','learningWithoutHealthData']],
  ['volume: a block may start from whatever the last one prescribed',
   'protected/velvet-viking-valhalla.html',
   "  if (dem) out = Math.min(out, round1(dem * VOLUME_BLOCK_GROWTH_CAP));", "", ['volumeCeiling','blockShape','blockTransitions','learningWithoutHealthData']],
  ['volume: the ceiling ratchets on demonstrated capacity again',
   'protected/velvet-viking-valhalla.html',
   "  return round1(Math.min(Math.max(dem, backstop), backstop * CEILING_MAX_OVER_BACKSTOP));",
   "  return round1(Math.max(dem * 1.05, backstop));", ['volumeCeiling','blockShape','blockTransitions','learningWithoutHealthData']],
  ['volume: one heroic week counts as capacity', 'protected/velvet-viking-valhalla.html',
   "var SUSTAINED_WEEKS_REQUIRED = 3;", "var SUSTAINED_WEEKS_REQUIRED = 1;", ['volumeCeiling','blockShape','blockTransitions','learningWithoutHealthData']],
  ['volume: capacity from years ago still counts', 'protected/velvet-viking-valhalla.html',
   "  var cutoff = addDays(todayStr(), -7 * DEMONSTRATED_WINDOW_WEEKS);",
   "  var cutoff = '1970-01-01';", ['volumeCeiling','blockShape','blockTransitions','learningWithoutHealthData']],

  /* ---- PROGRESSION NEEDS A REASON ----
     The ceiling above answers "how much is allowed". These answer "why more at
     all". Each one reopens a route by which completing training, on its own,
     becomes a reason to be given more of it. */
  ['progression: compliance alone is a reason again', 'protected/velvet-viking-valhalla.html',
   "  var out = (prev > 0)\n    ? (progressionJustification().earned ? prev * VOLUME_BLOCK_GROWTH_CAP : prev)\n    : base;",
   "  var out = (prev > 0) ? prev * VOLUME_BLOCK_GROWTH_CAP : base;",
   ['progressionJustification','volumeCeiling','blockTransitions']],
  ['progression: the anchor goes back to what the last ramp produced',
   'protected/velvet-viking-valhalla.html',
   "  var prev = previousBlockAnchorVolume();", "  var prev = null;",
   ['progressionJustification','volumeCeiling','blockTransitions']],
  ['progression: recovering earns a step up', 'protected/velvet-viking-valhalla.html',
   "var PROGRESSION_EARNING_PURPOSES = ['race', 'base', 'speed'];",
   "var PROGRESSION_EARNING_PURPOSES = ['race', 'base', 'speed', 'recovery', 'maintain'];",
   ['progressionJustification','blockTransitions']],
  ['progression: missed sessions stop mattering', 'protected/velvet-viking-valhalla.html',
   "  if (miss && PROGRESSION_TIERS_ALLOWED.indexOf(miss.tier) === -1){",
   "  if (false){", ['progressionJustification','blockTransitions']],
  ['progression: sessions that never land stop mattering', 'protected/velvet-viking-valhalla.html',
   "  if (exec && PROGRESSION_TIERS_ALLOWED.indexOf(exec.tier) === -1){",
   "  if (false){", ['progressionJustification','blockTransitions']],
  ['progression: never reaching the last block is no obstacle', 'protected/velvet-viking-valhalla.html',
   "    if (best < prevPeak * 0.95){", "    if (false){",
   ['progressionJustification','blockTransitions']],
  ['progression: a first block is ramped from a capacity it no longer has',
   'protected/velvet-viking-valhalla.html',
   "  if (!(previousBlockAnchorVolume() > 0)){\n    out.blockedBy = 'no_previous_block';",
   "  if (false){\n    out.blockedBy = 'no_previous_block';",
   ['progressionJustification','volumeCeiling']],
  ['progression: the step comes back once per block instead of once per cycle',
   'protected/velvet-viking-valhalla.html',
   "  if (since != null && since < PROGRESSION_BLOCKS_PER_CYCLE){", "  if (false){",
   ['progressionJustification','blockTransitions']],
  ['progression: a cycle shrinks until the rule does nothing',
   'protected/velvet-viking-valhalla.html',
   "var PROGRESSION_BLOCKS_PER_CYCLE = 3;", "var PROGRESSION_BLOCKS_PER_CYCLE = 1;",
   ['progressionJustification','blockTransitions']],
  ['progression: recovery and maintenance count toward the cycle',
   'protected/velvet-viking-valhalla.html',
   "    if (PROGRESSION_EARNING_PURPOSES.indexOf(b.purpose) !== -1) count++;",
   "    count++;", ['progressionJustification','blockTransitions']],
  ['progression: the step is never recorded, so the cycle never starts',
   'protected/velvet-viking-valhalla.html',
   "    progressionStep: !!o.progressionStep,", "    progressionStep: false,",
   ['progressionJustification','blockTransitions']],
  ['progression: the cycle rule masks a reason the athlete has not earned a step',
   'protected/velvet-viking-valhalla.html',
   "  var miss = null, exec = null;",
   "  var __s = developmentBlocksSinceLastStep();\n  if (__s != null && __s < PROGRESSION_BLOCKS_PER_CYCLE){\n    out.blockedBy = 'stepped_this_cycle';\n    out.reason = 'Your volume already stepped up this cycle. It moves once a cycle, not once a block, so this one holds the level you are training at.';\n    return out;\n  }\n  var miss = null, exec = null;",
   ['progressionJustification','blockTransitions']],
  ['progression: the magnitude of a step is widened', 'protected/velvet-viking-valhalla.html',
   "var VOLUME_BLOCK_GROWTH_CAP = 1.10;", "var VOLUME_BLOCK_GROWTH_CAP = 1.20;",
   ['progressionJustification','volumeCeiling','blockTransitions']],
  ['progression: the peak stops being bounded by capacity', 'protected/velvet-viking-valhalla.html',
   "  if (demForPeak) peakVolume = Math.min(peakVolume, round1(demForPeak * PEAK_OVER_DEMONSTRATED));",
   "", ['progressionJustification','volumeCeiling','blockShape']],
  /* progressionJustification FIRST, and it was missing. The test that kills this
     lives there; the case named only the other two, so the case ran 65 tests
     rather than 91 and reported a survivor for five consecutive full passes.
     Every "isolated" re-check added the suite by hand and killed it, which is
     how a case-definition error read for hours as a runner defect. */
  ['progression: the peak is measured against a week never scheduled',
   'protected/velvet-viking-valhalla.html',
   "                          startVolume: spec.volume, peakVolume: largestScheduledWeek(days),",
   "                          startVolume: spec.volume, peakVolume: blockResult.peakVolume,",
   ['progressionJustification','blockTransitions','yearRoundLifecycle']],

  /* ---- RECOVERY REDUCES TRAINING STRESS ---- */
  ['recovery: the intensity ceiling stops at the date window again',
   'protected/velvet-viking-valhalla.html',
   "  (days || []).forEach(function(dd){ if (dd && dd.date > until) until = dd.date; });",
   "", ['recoveryBlock','blockTransitions']],
  ['recovery: a recovery block sizes sessions at the top of their range',
   'protected/velvet-viking-valhalla.html',
   "    if (purpose === 'recovery') pos = 0;", "", ['recoveryBlock','blockShape']],
  ['recovery: the block no longer reduces volume', 'protected/velvet-viking-valhalla.html',
   "  'half':  { weeks:2, noIntensityDays:10, volumeFactor:0.50 },",
   "  'half':  { weeks:2, noIntensityDays:10, volumeFactor:1.00 },",
   ['recoveryBlock','blockTransitions']],
  ['recovery: a longer race no longer means a deeper reduction',
   'protected/velvet-viking-valhalla.html',
   "  'full':  { weeks:3, noIntensityDays:18, volumeFactor:0.40 },",
   "  'full':  { weeks:3, noIntensityDays:18, volumeFactor:0.55 },",
   ['recoveryBlock']],

  /* ---- AN AEROBIC BASE BLOCK IS AEROBIC DEVELOPMENT ---- */
  ['base: quality progresses at a race build\'s pace again',
   'protected/velvet-viking-valhalla.html',
   "    if (purpose === 'base') pos = pos * BASE_QUALITY_POS_MAX;", "",
   ['aerobicBaseComposition','blockShape']],
  ['base: the quality bound is widened until it does nothing',
   'protected/velvet-viking-valhalla.html',
   "var BASE_QUALITY_POS_MAX = 0.5;", "var BASE_QUALITY_POS_MAX = 0.95;",
   ['aerobicBaseComposition','blockShape']],
  ['base: the bound is tightened until the block stops developing',
   'protected/velvet-viking-valhalla.html',
   "var BASE_QUALITY_POS_MAX = 0.5;", "var BASE_QUALITY_POS_MAX = 0;",
   ['aerobicBaseComposition','blockShape']],
  ['base: the bound leaks into a race block', 'protected/velvet-viking-valhalla.html',
   "    if (purpose === 'base') pos = pos * BASE_QUALITY_POS_MAX;",
   "    pos = pos * BASE_QUALITY_POS_MAX;", ['aerobicBaseComposition','blockShape']],

  /* ---- MAINTENANCE ----
     A block called Maintain & Protect grew quality load 56-66% across eight
     weeks, invisibly, because the weekly volume never moved. */
  ['maintain: the block progresses again', 'protected/velvet-viking-valhalla.html',
   "    var pos = steady ? MAINTAIN_POS_CYCLE[(w - 1) % MAINTAIN_POS_CYCLE.length]",
   "    var pos = steady ? (w - 1) / Math.max(1, N - 1)", ['maintenanceBlock','blockShape','blockTransitions']],
  ['maintain: the dose cycle acquires a trend', 'protected/velvet-viking-valhalla.html',
   "var MAINTAIN_POS_CYCLE = [0.5, 0.35, 0.65];",
   "var MAINTAIN_POS_CYCLE = [0.35, 0.5, 0.65];", ['maintenanceBlock','blockShape','blockTransitions']],
  ['maintain: goal pace comes back to a block with no goal',
   'protected/velvet-viking-valhalla.html',
   "  var goalOriented = purpose === 'race';", "  var goalOriented = true;", ['maintenanceBlock','blockShape','blockTransitions']],
  ['maintain: the coach may add quality volume in maintenance again',
   'protected/velvet-viking-valhalla.html',
   "  Maintain:    { progress:'none',", "  Maintain:    { progress:'volume_and_quality_volume',", ['maintenanceBlock','blockShape','blockTransitions']],
  ['maintain: the block borrows the Build pool again', 'protected/velvet-viking-valhalla.html',
   "    var structPhase = steady ? 'Maintain' : phase;",
   "    var structPhase = steady ? 'Build' : phase;", ['maintenanceBlock','blockShape','blockTransitions']],

  /* ---- ROTATION ----
     Two consecutive maintenance blocks were byte-identical, 8 weeks of 8. */
  ['rotation: the next block opens on the same session as the last',
   'protected/velvet-viking-valhalla.html',
   "  return candidates[(weekNum + (rotation || 0)) % candidates.length](pos, emphasis);",
   "  return candidates[weekNum % candidates.length](pos, emphasis);", ['maintenanceBlock','coachVoice','blockTransitions']],
  ['rotation: the live block counts itself and re-rotates on every rebuild',
   'protected/velvet-viking-valhalla.html',
   "    return b && b.purpose === purpose && b.status === 'closed';",
   "    return b && b.purpose === purpose;", ['maintenanceBlock','coachVoice','blockTransitions']],
  ['rotation: every long run in a block is the same one again',
   'protected/velvet-viking-valhalla.html',
   "      : LONG_RUN_SHAPE_ORDER[(w + rotation) % LONG_RUN_SHAPE_ORDER.length];",
   "      : 'steady';", ['maintenanceBlock','coachVoice','blockTransitions']],

  /* ---- BLOCK SHAPE ----
     Aerobic Base was a ten-week block with one base week, a mid-block time
     trial, a two-week taper and a maximal goal effort. */
  ['shape: the base block tapers for a race that does not exist',
   'protected/velvet-viking-valhalla.html',
   "             baseEnd: BASE_PHASE_SPLIT, buildEnd: 1.01, volumeMult: BASE_VOLUME_MULT };",
   "             baseEnd: PHASE_BASE_END, buildEnd: PHASE_BUILD_END, volumeMult: null };", ['blockShape','maintenanceBlock','blockTransitions','yearRoundLifecycle']],
  ['shape: a block with no goal effort ends in one anyway',
   'protected/velvet-viking-valhalla.html',
   "    var isRace = !steady && arc.hasGoalEffort && (w===N);",
   "    var isRace = !steady && (w===N);", ['blockShape','maintenanceBlock','blockTransitions','yearRoundLifecycle']],
  ['shape: the mid-block time trial comes back everywhere',
   'protected/velvet-viking-valhalla.html',
   "      isCheckpoint = !steady && arc.hasCheckpoint && (w === Math.max(1,Math.round(buildWeeks*0.6)));",
   "      isCheckpoint = !steady && (w === Math.max(1,Math.round(buildWeeks*0.6)));", ['blockShape','maintenanceBlock','blockTransitions','yearRoundLifecycle']],
  ['shape: the speed block goes back to three development weeks',
   'protected/velvet-viking-valhalla.html',
   "var SPEED_CONSOLIDATION_WEEKS = 1;", "var SPEED_CONSOLIDATION_WEEKS = 2;", ['blockShape','maintenanceBlock','blockTransitions','yearRoundLifecycle']],
  ['shape: a recovery block ramps on the race multiplier again',
   'protected/velvet-viking-valhalla.html',
   "             baseEnd: 1.01, buildEnd: 1.01, volumeMult: 1 };",
   "             baseEnd: 1.01, buildEnd: 1.01, volumeMult: null };", ['blockShape','maintenanceBlock','blockTransitions','yearRoundLifecycle']],
  ['shape: the base block ends at its own peak', 'protected/velvet-viking-valhalla.html',
   "      if (!steady && !arc.hasGoalEffort && w===N && N>=4) isCutback = true;", "", ['blockShape','maintenanceBlock','blockTransitions','yearRoundLifecycle']],

  /* ---- THE WEEK THE ATHLETE IS STANDING IN ---- */
  ['cap: a mid-week re-tailor stacks a third hard session again',
   'protected/velvet-viking-valhalla.html',
   "  capCurrentWeekQuality(merged, newDays, today);", "", ['historicalImmutability','reconcileRegeneratedDays','historyIntegrity']],
  ['cap: the cap is paid for out of the past', 'protected/velvet-viking-valhalla.html',
   "  var changeable = quality.filter(function(dd){ return dd.date >= today && !dayCarriesHistory(dd); })",
   "  var changeable = quality.filter(function(dd){ return true; })", ['historicalImmutability','reconcileRegeneratedDays','historyIntegrity']],

  /* ---- ESCALATION ----
     One missed session and seven produced the same sentence. */
  ['escalation: every miss is an isolated one again', 'protected/velvet-viking-valhalla.html',
   "  return { tier: patternTier(ran.length, win.length), missed: win.length-ran.length,",
   "  return { tier: 'isolated', missed: win.length-ran.length,", ['escalation','learningWithoutHealthData']],
  ['escalation: a handful of sessions is enough to call it persistent',
   'protected/velvet-viking-valhalla.html',
   "var PATTERN_MIN_PLANNED      = 6;", "var PATTERN_MIN_PLANNED      = 1;", ['escalation','learningWithoutHealthData']],
  ['escalation: rest days count towards the window', 'protected/velvet-viking-valhalla.html',
   "    return dd && dd.type!=='rest' && dd.date < today;",
   "    return dd && dd.date < today;", ['escalation','learningWithoutHealthData']],
  ['escalation: an accepted adjustment counts as a missed session',
   'protected/velvet-viking-valhalla.html',
   "  var ran = win.filter(function(dd){ return sessionRan(dd) || !!dd.coachAdjust; });",
   "  var ran = win.filter(function(dd){ return sessionRan(dd); });", ['escalation','learningWithoutHealthData']],
  ['escalation: an easy run logged short reads as the block being too hard',
   'protected/velvet-viking-valhalla.html',
   "    return sessionRan(dd) && isQualityType(dd.type);",
   "    return sessionRan(dd);", ['escalation','learningWithoutHealthData']],
  ['escalation: the pattern never reaches the athlete', 'protected/velvet-viking-valhalla.html',
   "  } else if (patternSpeaks && patternSpeaks.tier !== 'isolated'){",
   "  } else if (false){", ['escalation','learningWithoutHealthData']],

  /* ---- COACHING VOICE ---- */
  ['voice: every past card points at today again', 'protected/velvet-viking-valhalla.html',
   "    return x.date > dd.date && x.type!=='rest';",
   "    return x.date > dd.date && x.type!=='rest' && !x.completed;", ['coachVoice','copyRepetition','escalation']],
  ['voice: safety-critical language is suppressed like anything else',
   'protected/velvet-viking-valhalla.html',
   "  if (!sentence || PHRASE_ALWAYS_SAY.test(sentence)) return false;",
   "  if (!sentence) return false;", ['coachVoice','copyRepetition','escalation']],
  ['voice: the same commentary lands on every card again',
   'protected/velvet-viking-valhalla.html',
   "var PHRASE_SUPPRESS_WINDOW = 3;", "var PHRASE_SUPPRESS_WINDOW = 0;", ['coachVoice','copyRepetition','escalation']],
  ['voice: a heart rate the athlete never logged is claimed',
   'protected/velvet-viking-valhalla.html',
   "      if (hrInZone) held.push('heart rate at '+a.hr+' bpm');",
   "      held.push('heart rate at '+a.hr+' bpm');", ['coachVoice','copyRepetition','escalation']],
  ['voice: the internal block state reaches the athlete again',
   'protected/velvet-viking-valhalla.html',
   "        why:'The block reads as '+((BLOCK_META[block?block.state:'LEARNING']||BLOCK_META.LEARNING).label)+",
   "        why:'The block reads as '+(block?block.state:'LEARNING')+", ['coachVoice','copyRepetition','escalation']],

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
   "    if (!mirrored.ok){ return S.json(res, 503, { error: 'unavailable' }); }\n    if (false){"]

];

/* A SUITE THAT DID NOT RUN IS NOT A SUITE THAT PASSED.
   The old loop piped node straight into `grep -c "^not ok "` and read the
   count. A pipeline reports the exit status of its LAST command, so if the
   test process was killed -- out of memory, reaped under load, timed out --
   grep saw an empty stream, printed 0, and the case was recorded as a
   SURVIVOR. One case in this file did exactly that on three consecutive full
   runs while killing reliably every time it was run on its own, which is how
   it was found.

   Wrong in the safe direction, but wrong: it reports risk that is not there,
   and the same blindness would let a genuine survivor hide behind noise. The
   run now keeps the whole TAP output and requires POSITIVE EVIDENCE that the
   suites executed -- node prints exactly one `# tests N` summary per
   invocation -- and a case with no summary is an ERROR rather than a verdict.
   Errors are reported separately and fail the run, because the honest answer
   to "did this mutation survive" is that we do not know. */
const OUT_FILE = require('os').tmpdir() + '/valhalla-mutation-out.txt';

/* HOW MANY TESTS THAT SET OF SUITES IS SUPPOSED TO RUN.
   Requiring a `# tests N` summary was not enough. node --test runs the files
   in parallel workers and flattens their results, so a worker killed under
   sustained load simply removes its tests from the count -- the summary is
   still printed, the remaining suites still pass, and the case is recorded as
   a SURVIVOR. One case did that on four consecutive full runs while being
   killed by five separate runs of the identical command, including a replay of
   its exact neighbourhood with checksums proving the file was clean.

   So each distinct suite set is run ONCE against unmutated source to learn how
   many tests it contains, and a mutated run that reports a different number has
   not answered the question. Lazily, because the sets repeat: fifteen or so
   baselines across a hundred and fifty cases. */
/* RESTORING THE TREE EVEN WHEN THE RUN DOES NOT FINISH.
   This tool rewrites source files, and it was killed mid-case twice in one
   session -- once by a container restart. Both times it left a mutation on
   disk, and the second time a `git add -A` swept that mutation into a commit,
   where it silently removed a safety rule that a test in the very same run had
   just proved was needed. The header has always warned that `git status` shows
   what is left modified; a warning is not a guard. */
let pending = null;                       // { path, original } while a case is live
function restorePending(){
  if (!pending) return;
  try{ fs.writeFileSync(pending.path, pending.original); }catch(e){ /* nothing better to do */ }
  pending = null;
}
process.on('exit', restorePending);
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => process.on(sig, () => {
  restorePending();
  console.log('\n[interrupted on ' + sig + ' -- source restored]');
  process.exit(130);
}));

const baselines = new Map();
function runSuites(files){
  try{ fs.unlinkSync(OUT_FILE); }catch(e){ /* first run */ }
  try{
    // A failing suite exits non-zero, which is the ordinary kill path.
    cp.execSync('cd ' + ROOT + ' && node --test ' + files + ' > ' + OUT_FILE + ' 2>&1',
                /* The shared SUBSET is twenty-eight suites and its baseline run
                   is the longest single command this tool issues. Fifteen
                   minutes was enough until a stray runner from an interrupted
                   pass was found competing for the same cores; the limit is
                   generous now because a timeout here is indistinguishable from
                   a suite that reported nothing, and that ambiguity is exactly
                   what the rest of this file exists to remove. */
                { encoding: 'utf8', timeout: 1800000 });
  }catch(e){ /* verdict comes from the output, never from the exit status */ }
  let tap = '';
  try{ tap = fs.readFileSync(OUT_FILE, 'utf8'); }catch(e){ tap = ''; }
  const m = tap.match(/^# tests (\d+)/m);
  return { tests: m ? parseInt(m[1], 10) : null,
           fails: (tap.match(/^not ok /gm) || []).length };
}
function baselineFor(files){
  if (!baselines.has(files)){
    const b = runSuites(files);
    if (b.tests == null || b.fails > 0)
      throw new Error('the baseline run for ' + files + ' did not come back clean: ' +
                      JSON.stringify(b));
    baselines.set(files, b.tests);
  }
  return baselines.get(files);
}

/* Narrowing a run. MUT_FROM/MUT_TO take case indices so a single case can be
   re-checked, or a slice bisected, without a ninety-minute pass; MUT_TAP_DIR
   saves each case's raw output there. Both exist because a case was reported as
   surviving five full runs while being killed by every direct run of the
   identical command, and finding out why needed the batch's own output rather
   than another isolated reproduction. */
const ONLY_FROM = parseInt(process.env.MUT_FROM || '0', 10);
const ONLY_TO = parseInt(process.env.MUT_TO || String(CASES.length), 10);
const TAP_DIR = process.env.MUT_TAP_DIR || '';

let survived = [], errored = [], killed = 0;
for (const [idx, [name, file, from, to, suites]] of CASES.entries()){
  if (idx < ONLY_FROM || idx >= ONLY_TO) continue;
  const p = ROOT + '/' + file;
  const orig = fs.readFileSync(p, 'utf8');
  if (orig.indexOf(from) === -1){ survived.push(name + '   [ANCHOR NOT FOUND]'); continue; }
  /* A case may name the suites that guard it. The programme suites build and
     log whole plans and are minutes each, so running all of them for every one
     of sixty-four cases is hours -- and a mutation is only ever killed by the
     suite written for it. A case with no list falls back to the shared
     SUBSET, which is what every commercial case still uses. */
  const files = suites && suites.length
    ? suites.map(n => 'test/' + n + '.test.js').join(' ')
    : SUBSET;
  // BASELINE FIRST, on clean source, then mutate.
  const expected = baselineFor(files);
  pending = { path: p, original: orig };
  fs.writeFileSync(p, orig.replace(from, to));          // clean-source run, cached per suite set
  const r = runSuites(files);
  fs.writeFileSync(p, orig);
  pending = null;
  // Restored, or the next case's `orig` inherits this one's mutation.
  if (fs.readFileSync(p, 'utf8') !== orig)
    throw new Error('failed to restore ' + file + ' after: ' + name);
  if (TAP_DIR){
    try{ fs.copyFileSync(OUT_FILE, TAP_DIR + '/case-' + idx + '.tap'); }catch(e){ /* best effort */ }
  }
  if (r.tests == null){
    errored.push(name);
    console.log('ERROR          ' + name + '   [the suites did not report a result]');
  } else if (r.tests !== expected){
    errored.push(name + '   [ran ' + r.tests + ' tests, expected ' + expected + ']');
    console.log('ERROR          ' + name + '   [ran ' + r.tests + ' of ' + expected + ' tests]');
  } else if (r.fails > 0){
    killed++; console.log('KILLED  ' + String(r.fails).padStart(3) + '  [' + idx + '] ' + name);
  } else {
    survived.push(name); console.log('SURVIVED       [' + idx + '] ' + name);
  }
}
console.log('\n=== ' + killed + '/' + CASES.length + ' mutations detected ===');
if (errored.length){
  console.log('ERRORED (no result reported, verdict unknown):');
  errored.forEach(n => console.log('  ' + n));
}
if (survived.length) console.log('SURVIVORS:\n  ' + survived.join('\n  '));
// A run that could not answer for a case has not verified the guard it names.
process.exitCode = (survived.length || errored.length) ? 1 : 0;
