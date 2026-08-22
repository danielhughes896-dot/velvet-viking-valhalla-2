'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* WHAT THE ATHLETE ACTUALLY READS, COUNTED.
 *
 * Copy repetition is not visible in a source file. Every sentence in this
 * product is written once; the repetition happens in the SEQUENCE, when the
 * same correct sentence lands on forty cards in a fortnight. So this file
 * renders a real athlete's real screens and counts what comes out.
 *
 * The defect it was written for: "Scored without heart rate." appeared on 43 of
 * 43 cards for an athlete who does not own a chest strap, and would have
 * appeared on every session they ever logged. A component the athlete has
 * never recorded is a settled choice, not an omission worth noticing.
 */

const TODAY = '2026-08-21';

function athlete(opts) {
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -56), distanceKey: 'half',
                 volume: 55, benchSec: 45 * 60, lthr: 165, maxHR: 190 });
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').forEach(dd => {
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(),
      { km: dd.km, pace: '5:00', rpe: 6 }, o.withHR ? { hr: 150 } : {});
    try { a.coachPersistReview(dd); } catch (e) {}
  });
  return a;
}
const noticedLines = a => a.state.days.filter(d => d.completed)
  .map(d => { try { const r = a.coachReviewFor(d); return r && r.coachNoticed; } catch (e) { return null; } })
  .filter(Boolean);

test('a component the athlete never records is not remarked on every session', () => {
  const a = athlete();                       // never logs heart rate
  const lines = noticedLines(a);
  assert.ok(lines.length >= 20, 'the fixture must produce a real run of sessions');
  const hrNotes = lines.filter(s => /Scored without heart rate/.test(s));
  assert.equal(hrNotes.length, 0,
    'an athlete without a chest strap was told ' + hrNotes.length +
    ' times that the session was scored without one');
});

test('but a component they usually record and skipped once IS remarked on', () => {
  /* The other half, and the reason this is a suppression rather than a
     deletion: a missing heart rate from somebody who normally logs one is
     genuinely worth a line, and the line still says it. */
  const a = athlete({ withHR: true });
  const past = a.state.days.filter(d => d.completed).sort((x, y) => (x.date < y.date ? -1 : 1));
  const last = past[past.length - 1];
  last.actual.hr = null;
  delete last.coachReview;
  try { a.coachPersistReview(last); } catch (e) {}
  assert.match(a.coachReviewFor(last).coachNoticed, /Scored without heart rate/);
});

test('the habit is read from earlier sessions, not from the one being judged', () => {
  const a = athlete({ withHR: true });
  const past = a.state.days.filter(d => d.completed).sort((x, y) => (x.date < y.date ? -1 : 1));
  // The very first logged session has no history behind it, so there is no
  // habit to compare against and nothing to remark on.
  assert.equal(a.athleteUsuallyLogs(past[0], 'hr'), false);
  assert.equal(a.athleteUsuallyLogs(past[past.length - 1], 'hr'), true);
});

test('no single coaching sentence dominates a fortnight of cards', () => {
  /* A ceiling rather than a target. Chrome -- field labels, section headings,
     the fuelling table -- legitimately repeats on every card and is excluded by
     name. What is counted is prose the coach chose to say. */
  const a = athlete();
  /* Chrome is anything the card prints because it is a card: field labels,
     section headings, the fuelling table, and the static hints under form
     inputs. It repeats on every session by design and always will. */
  const CHROME = /^(How to run this|Avg Pace|Actual|Notes|Feel|RPE|Execution Review|Compared With|Recovery Priority|Total carbs|Gels|Fluid guide|\+ Log the session|Anything the numbers|Fluid is a starting guide|Dial this in during training)/;
  const counts = {};
  a.state.days.filter(d => d.type !== 'rest').slice(0, 40).forEach(dd => {
    let html = ''; try { html = a.renderDayCard(dd); } catch (e) { return; }
    String(html).replace(/<[^>]+>/g, '\n').split('\n').forEach(line => {
      line.trim().split(/(?<=[.!?])\s+/).forEach(s => {
        s = s.trim();
        if (s.length < 25 || CHROME.test(s) || /^\d/.test(s)) return;
        counts[s] = (counts[s] || 0) + 1;
      });
    });
  });
  const cards = a.state.days.filter(d => d.type !== 'rest').slice(0, 40).length;
  const blanket = Object.entries(counts).filter(([, n]) => n > cards * 0.5)
                        .sort((x, y) => y[1] - x[1]);

  /* THREE KNOWN BLANKET SENTENCES, NAMED RATHER THAN ROUNDED AWAY. All three
     are raised in the audit report; none is silently accepted.

       1. "Effort and heart rate have been running above target across the
          week."  -- the recovery_priority reason in trainingSignalFor(). The
          SIGNAL is per-session and correct; the REASON is a week-level fact,
          so in a strained week every session's review repeats it.
       2. "Prioritise recovery before the next quality session." -- the next
          move for that same signal. One coach state, two sentences, both on
          every card: this is the pair the audit flags as cross-card
          repetition.
       3. "Executed at NN% of the prescribed session." -- a template, not a
          fixed sentence. It only lands identically here because the fixture
          logs every session at the same pace, so every score is the same
          number. A real athlete sees a different figure each time.

     Changing 1 and 2 means changing what a session review SAYS, which is
     coaching content rather than chrome, so it is a decision for the report
     rather than a quiet edit. What this guards is that a FOURTH does not
     appear -- which is exactly what the heart-rate note was doing at 43 of 43
     until it was suppressed. */
  const KNOWN = [/running above target across the week/,
                 /Prioritise recovery before the next quality session/,
                 /Executed at \d+% of the prescribed session/];
  const unexpected = blanket.filter(([s]) => !KNOWN.some(re => re.test(s)));
  assert.deepEqual(unexpected.map(([s, n]) => s.slice(0, 70) + ' x' + n), [],
    'a new sentence now lands on over half the cards');
  assert.ok(blanket.length <= KNOWN.length,
    'the number of blanket sentences grew to ' + blanket.length);
});
