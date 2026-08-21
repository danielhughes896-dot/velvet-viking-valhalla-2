'use strict';
/* ERASURE OF COVERED HEALTH VALUES — the capability, not a feature.
 *
 * WITHDRAWING CONSENT IS NOT A REQUEST FOR ERASURE, and the product treats
 * them as the different things they are. Withdrawal stops future collection
 * and use immediately; the values the athlete already logged stay in the
 * athlete's own record and become inert. That is the approved policy, and it
 * is deliberate: deleting somebody's training record because they turned a
 * switch off destroys their data without them asking for it.
 *
 * But an erasure REQUEST is a separate right, and a system that cannot honour
 * one is a system that has to answer a lawyer with "we would have to write
 * something". So this exists: a purely subtractive transformation that removes
 * every covered value from an athlete's stored record and leaves everything
 * else — every distance, pace, time, split, RPE, note, benchmark, race result
 * and adherence fact — exactly as it was.
 *
 * IT IS AN OPERATOR ACTION, ON PURPOSE. There is no endpoint and no button.
 * An erasure request arrives as a request, is assessed, and is carried out
 * with the service key by a person who has decided it should be. Wiring it to
 * a tap would make an irreversible deletion one mis-click away from an athlete
 * who meant to withdraw consent — which is exactly the confusion the split
 * between the two exists to prevent.
 *
 * WHAT IT DOES NOT DO. It does not delete the account, the plan, the training
 * history, the subscription or the consent audit. The consent record in
 * particular SURVIVES: it is the proof of what was agreed and when, it holds
 * no value about the athlete's body, and destroying it would remove the
 * evidence that the processing which happened was lawful at the time.
 */

/* WHERE COVERED VALUES ARE STORED. Two places, and this list is the whole of
 * it — it mirrors the runtime's own covered vocabulary, and the test asserts
 * the two do not drift apart.
 *
 *   the plan document   setup.lthr, setup.maxHR      the profile values
 *                       day.readiness                legs / sleep / health
 *                       day.actual.hr                the logged heart rate
 *                       day.actual.feel              how the session felt
 *
 *   staged activities   payload.hr, payload.maxHR    from a provider
 *
 * The athlete's own note TEXT is not on this list and is not touched. It is
 * theirs, they wrote it, and the covered part of a note is the READING the
 * parser derives at display time — which is computed, never stored, and
 * therefore already gone the moment consent is absent. */
const PLAN_SETUP_FIELDS = ['lthr', 'maxHR'];
const PLAN_DAY_FIELDS = ['readiness'];
const PLAN_ACTUAL_FIELDS = ['hr', 'feel'];
const ACTIVITY_FIELDS = ['hr', 'maxHR'];

function drop(obj, keys, counter, label){
  if (!obj || typeof obj !== 'object') return obj;
  const out = Object.assign({}, obj);
  keys.forEach(function(k){
    if (out[k] != null){ counter[label] = (counter[label] || 0) + 1; }
    if (Object.prototype.hasOwnProperty.call(out, k)) delete out[k];
  });
  return out;
}

/* A NEW DOCUMENT, never a mutation of the one passed in. The caller is holding
   the athlete's plan as it currently exists in the database; editing it in
   place would mean a failure half way through leaves a partially erased object
   that some other code path might still write back. */
function eraseFromPlan(planData){
  const removed = {};
  if (!planData || typeof planData !== 'object') return { data: planData, removed: removed };

  const out = Object.assign({}, planData);
  if (out.setup) out.setup = drop(out.setup, PLAN_SETUP_FIELDS, removed, 'profile');

  if (Array.isArray(out.days)){
    out.days = out.days.map(function(d){
      if (!d || typeof d !== 'object') return d;
      let day = drop(d, PLAN_DAY_FIELDS, removed, 'readiness');
      if (day.actual) day.actual = drop(day.actual, PLAN_ACTUAL_FIELDS, removed, 'logged');
      return day;
    });
  }
  /* The consent record stays. It is the proof of what was agreed and when, it
     says nothing about the athlete's body, and an erasure that destroyed it
     would remove the evidence that what already happened was lawful. */
  return { data: out, removed: removed };
}

function eraseFromActivityPayload(payload){
  const removed = {};
  return { data: drop(payload, ACTIVITY_FIELDS, removed, 'activity'), removed: removed };
}

/* THE ASSERTION THAT MAKES THIS SAFE TO RUN AGAINST A REAL ATHLETE'S RECORD.
 *
 * An erasure is only ever allowed to REMOVE, and only ever the named fields.
 * This walks the before and after and refuses if anything else moved: a key
 * that gained a value, a key that changed value, a day that vanished, an array
 * that shortened. A bug in the transformation above then fails loudly instead
 * of silently eating somebody's training history — which, unlike the covered
 * values, cannot be recovered by asking them to log it again. */
function verifySubtractive(before, after, allowed){
  const problems = [];
  const names = allowed || PLAN_SETUP_FIELDS.concat(PLAN_DAY_FIELDS, PLAN_ACTUAL_FIELDS, ACTIVITY_FIELDS);

  (function walk(a, b, path){
    if (a === b) return;
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object'){
      if (a !== b) problems.push(path + ' changed value');
      return;
    }
    if (Array.isArray(a) || Array.isArray(b)){
      if (!Array.isArray(a) || !Array.isArray(b)){ problems.push(path + ' changed shape'); return; }
      if (a.length !== b.length){ problems.push(path + ' changed length'); return; }
      for (let i = 0; i < a.length; i++) walk(a[i], b[i], path + '[' + i + ']');
      return;
    }
    Object.keys(b).forEach(function(k){
      if (!Object.prototype.hasOwnProperty.call(a, k)) problems.push(path + '.' + k + ' was added');
    });
    Object.keys(a).forEach(function(k){
      const p = path + '.' + k;
      if (!Object.prototype.hasOwnProperty.call(b, k)){
        if (names.indexOf(k) === -1) problems.push(p + ' was removed and is not a covered field');
        return;
      }
      walk(a[k], b[k], p);
    });
  })(before, after, '');

  return problems;
}

/* THE RUN. Service key only — every read and write here goes through the
 * caller's own Supabase helper, and there is no path that reaches this from a
 * browser.
 *
 * `dryRun` is the default. An operator sees exactly what would be removed
 * before anything is, because "how many heart rates am I about to delete" is a
 * question worth being able to answer before rather than after.
 */
async function eraseCoveredForAccount(S, cfg, userId, opts){
  const o = opts || {};
  const dryRun = o.dryRun !== false;
  /* THE TRANSFORM IS INJECTABLE, AND THAT IS NOT A TEST ACCOMMODATION.
   *
   * The whole value of this function is the refusal below: it compares before
   * and after and stops if the transformation did anything except remove named
   * covered fields. A guard nobody can trigger is a guard nobody can trust --
   * and with eraseFromPlan() hardcoded there is no way to reach the refusal at
   * all, so a mutation that deleted the check went unnoticed by every test.
   *
   * So the seam exists to prove the guard fires. It has exactly one production
   * value, and passing anything else is what an operator would do to verify
   * the safety net before running an irreversible deletion against somebody's
   * record. */
  const transformPlan = o.transformPlan || eraseFromPlan;
  if (!userId) return { ok: false, reason: 'no_user_id' };

  const report = { ok: true, dryRun: dryRun, userId: userId, plan: null, activities: null };

  // ---- the plan document ----
  const pr = await S.sb(cfg, '/plans?select=user_id,data&user_id=eq.' + encodeURIComponent(userId) + '&limit=1');
  if (!pr || !pr.ok) return { ok: false, reason: 'plan_read_failed' };
  const planRows = await pr.json().catch(function(){ return null; });
  const planRow = (planRows || [])[0] || null;

  if (planRow){
    const erased = transformPlan(planRow.data);
    const problems = verifySubtractive(planRow.data, erased.data);
    if (problems.length) return { ok: false, reason: 'not_subtractive', problems: problems };
    report.plan = { removed: erased.removed, changed: JSON.stringify(erased.data) !== JSON.stringify(planRow.data) };
    if (!dryRun && report.plan.changed){
      const w = await S.sb(cfg, '/plans?user_id=eq.' + encodeURIComponent(userId), {
        method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ data: erased.data })
      });
      if (!w || !w.ok) return { ok: false, reason: 'plan_write_failed' };
    }
  }

  // ---- staged provider activities ----
  const ar = await S.sb(cfg, '/strava_activities?select=user_id,activity_id,payload&user_id=eq.' +
    encodeURIComponent(userId) + '&limit=1000');
  if (!ar || !ar.ok) return { ok: false, reason: 'activities_read_failed' };
  const acts = (await ar.json().catch(function(){ return null; })) || [];

  let touched = 0;
  for (const a of acts){
    const erased = eraseFromActivityPayload(a.payload);
    const problems = verifySubtractive(a.payload, erased.data, ACTIVITY_FIELDS);
    if (problems.length) return { ok: false, reason: 'not_subtractive', problems: problems };
    if (JSON.stringify(erased.data) === JSON.stringify(a.payload)) continue;
    touched++;
    if (!dryRun){
      const w = await S.sb(cfg, '/strava_activities?user_id=eq.' + encodeURIComponent(userId) +
        '&activity_id=eq.' + encodeURIComponent(a.activity_id), {
          method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ payload: erased.data })
        });
      if (!w || !w.ok) return { ok: false, reason: 'activity_write_failed' };
    }
  }
  report.activities = { examined: acts.length, changed: touched };
  return report;
}

module.exports = {
  PLAN_SETUP_FIELDS, PLAN_DAY_FIELDS, PLAN_ACTUAL_FIELDS, ACTIVITY_FIELDS,
  eraseFromPlan, eraseFromActivityPayload, verifySubtractive, eraseCoveredForAccount
};
