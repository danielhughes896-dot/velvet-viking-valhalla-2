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
  'historicalImmutability','historyIntegrity','reconcileRegeneratedDays'].map(n => 'test/' + n + '.test.js').join(' ');

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
  ['progression: the peak is measured against a week never scheduled',
   'protected/velvet-viking-valhalla.html',
   "                          startVolume: spec.volume, peakVolume: largestScheduledWeek(days),",
   "                          startVolume: spec.volume, peakVolume: blockResult.peakVolume,",
   ['blockTransitions','yearRoundLifecycle']],

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
   "        why:'The block reads as '+(block?block.state:'LEARNING')+", ['coachVoice','copyRepetition','escalation']]
];

let survived = [], killed = 0;
for (const [name, file, from, to, suites] of CASES){
  const p = ROOT + '/' + file;
  const orig = fs.readFileSync(p, 'utf8');
  if (orig.indexOf(from) === -1){ survived.push(name + '   [ANCHOR NOT FOUND]'); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  /* A case may name the suites that guard it. The programme suites build and
     log whole plans and are minutes each, so running all of them for every one
     of sixty-four cases is hours -- and a mutation is only ever killed by the
     suite written for it. A case with no list falls back to the shared
     SUBSET, which is what every commercial case still uses. */
  const files = suites && suites.length
    ? suites.map(n => 'test/' + n + '.test.js').join(' ')
    : SUBSET;
  let out;
  try{
    out = cp.execSync('cd ' + ROOT + ' && node --test ' + files + ' 2>&1 | grep -c "^not ok "',
                      { encoding: 'utf8', timeout: 900000 });
  }catch(e){ out = (e.stdout || '0'); }
  fs.writeFileSync(p, orig);
  const fails = parseInt(String(out).trim(), 10) || 0;
  if (fails > 0){ killed++; console.log('KILLED  ' + String(fails).padStart(3) + '  ' + name); }
  else { survived.push(name); console.log('SURVIVED       ' + name); }
}
console.log('\n=== ' + killed + '/' + CASES.length + ' mutations detected ===');
if (survived.length) console.log('SURVIVORS:\n  ' + survived.join('\n  '));
