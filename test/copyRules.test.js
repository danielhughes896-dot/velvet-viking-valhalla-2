'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* EVERY SENTENCE AN ATHLETE READS KEEPS THE HOUSE RULES (founder, 16
   November 2026, of the copy rows in the learning audit: "Interesting - how
   should we attack that?"). The screens are drawn for a spread of plans and
   every visible sentence is read, so a rule broken anywhere fails here
   rather than in an audit weeks later. */

const strip = h => String(h || '').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const RULES = [
  ['em dash', /—/],
  ['double-hyphen dash', / -- /],
  ['American spelling', /\b(kilometers?|meters?\b|color|favorite|center\b|analyze|optimize|personalize|recognize|program\b)/i],
  ['engine text', /\b(archetype|prescription object|undefined|NaN)\b|\[object |placed by the plan, not chosen/]
];

function screens(dk, vol, exp){
  const NOW = '2026-11-23';
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: dk, volume: vol, weeks: 12, experience: exp, startDate: '2026-11-02',
                 schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  a.state.days.filter(d => d.date < NOW && d.type !== 'rest' && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  const out = [];
  const add = (where, f) => { try { out.push([where, strip(f())]); } catch(e){ /* a screen this fixture cannot draw */ } };
  a.state.view = 'today'; add('Today', () => a.renderTodayView());
  add('Coach', () => a.renderPlanHQView());
  a.state.days.filter(d => d.week <= 5).forEach(d => add('Week day ' + d.date, () => a.weekSlideHtml(d)));
  const rv = (() => { try { return a.weeklyCoachingReview(a.currentWeekNum()); } catch(e){ return null; } })();
  if (rv) add('Weekly sheet', () => { const c = a.weeklyReviewCopy(rv); return c ? [c.head, c.why, c.note, c.yes, c.no].join(' ') : ''; });
  return out;
}

const PLANS = [['5k', 25, 'novice'], ['10k', 45, 'experienced'], ['half', 40, 'experienced'], ['full', 60, 'advanced'], ['full', 30, 'novice']];

for (const [dk, vol, exp] of PLANS){
  test('the copy rules hold on every screen: ' + dk + ' ' + exp + ' ' + vol + 'km', () => {
    const broken = [];
    screens(dk, vol, exp).forEach(([where, text]) => RULES.forEach(([rule, re]) => {
      const m = text.match(re);
      if (m) broken.push(where + ': ' + rule + ': "...' + text.slice(Math.max(0, m.index - 40), m.index + 40) + '..."');
    }));
    assert.deepEqual(broken, []);
  });
}
