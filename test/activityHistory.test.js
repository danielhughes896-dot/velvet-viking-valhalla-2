'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* ACTIVITY HISTORY.

   Founder: "At the minute SACORO focuses on future but nothing is easy to
   see past runs. So a box under the 4 on coach page. Then when opened a
   simple list of the past days sessions. No need to have rest days. Just
   the workouts." Approving the mock: execution scores in neutral white,
   cards that grow with their names, no social features, and "tapping any
   activity should open its actual completed log and analysis, not merely
   the original prescribed session." */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const TODAY = '2026-05-20';
function athlete(skip){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -42), lthr: 170, maxHR: 190 });
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted', at: '2026-01-01T00:00:00Z' };
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').forEach((d, i) => {
    if (skip && i % 5 === 3) return;
    logAsPrescribed(a, d, { sections: true });
  });
  return a;
}
const ids = html => [...html.matchAll(/data-action="history-open" data-day="([^"]+)"/g)].map(m => m[1]);

test('a box under the four on the Coach page, the full width, opening the history', () => {
  const a = athlete();
  const html = a.renderSacoroInstruments();
  const plates = html.slice(html.indexOf('class="b-plates"'));
  assert.match(plates, /class="b-plate b-plate-wide" data-action="open-record" data-record="history"/);
  assert.ok(plates.indexOf('data-record="benchmark"') < plates.indexOf('data-record="history"'), 'not under the four');
  assert.match(plates, />Activity History</);
  assert.match(CSS, /\.b-plates \.b-plate-wide\{grid-column:1 \/ -1;\}/);
  assert.equal(a.RECORD_PANELS.history, a.recordPanelHistory);
});

test('only runs that happened, newest first: no rest days, nothing unlogged, nothing to come', () => {
  const a = athlete(true);
  const html = a.recordPanelHistory();
  const listed = ids(html);
  const ran = a.state.days.filter(d => d.date <= TODAY && a.sessionRan(d)).map(d => d.id);
  assert.equal(JSON.stringify(listed.slice().sort()), JSON.stringify(ran.slice().sort()));
  listed.forEach(id => {
    const d = a.findDay(id);
    assert.notEqual(d.type, 'rest', 'a rest day is listed');
    assert.ok(d.date <= TODAY, 'a day still to come is listed');
  });
  const dates = listed.map(id => a.findDay(id).date);
  assert.equal(JSON.stringify(dates), JSON.stringify(dates.slice().sort().reverse()), 'not newest first');
  const missed = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest' && !a.sessionRan(d));
  assert.ok(missed.length > 0, 'fixture: some sessions were not logged');
  missed.forEach(d => assert.equal(listed.indexOf(d.id), -1, 'an unlogged session is listed as run'));
});

test('grouped by phase, then by week with its dates', () => {
  const a = athlete();
  const html = a.recordPanelHistory();
  assert.match(html, /class="setup-section-title">Build</);
  assert.match(html, /class="setup-section-title">Base</);
  assert.ok(html.indexOf('>Build<') < html.indexOf('>Base<'), 'the newest phase is not first');
  assert.match(html, /class="ah-week font-head">Week 7, 18 May to 24 May</);
});

test('each card carries the log’s own figures and the score, in white', () => {
  const a = athlete();
  const d = a.state.days.filter(x => x.date < TODAY && a.sessionRan(x)).slice(-1)[0];
  d.actual.hr = 151;
  const card = a.activityCardHtml(d);
  assert.match(card, new RegExp('>' + a.escapeHtml(a.fmtDist(d.actual.km)) + '<'));
  assert.match(card, />Pace</);
  assert.match(card, />151 bpm</);
  assert.match(card, />Execution \d+</);
  assert.match(CSS, /\.ah-date, \.ah-score\{font-size:\.75rem; color:#FFFFFF;\}/, 'the score is not white');
  // heart rate is health information: without consent it is not shown
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'declined', at: '2026-01-01T00:00:00Z' };
  assert.doesNotMatch(a.activityCardHtml(d), /bpm/);
});

test('a card grows with its name: no fixed height, the name wraps', () => {
  const rule = sel => (CSS.match(new RegExp('\\' + sel + '\\{([^}]*)\\}')) || [])[1] || '';
  assert.match(rule('.ah-card'), /height:auto/);
  assert.doesNotMatch(rule('.ah-card'), /(^|;)\s*(max-)?height:\s*\d/);
  assert.match(rule('.ah-name'), /overflow-wrap:anywhere/);
  assert.doesNotMatch(rule('.ah-name'), /nowrap|overflow:hidden|text-overflow/);
});

test('no social features: nothing to like, comment on or share', () => {
  const a = athlete();
  const html = a.recordPanelHistory();
  assert.doesNotMatch(html, /like|comment|share|kudos/i);
  const actions = new Set([...html.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
  assert.equal([...actions].sort().join(), 'close-record-panel,history-open');
});

test('tapping a run opens its completed log and analysis, and Back returns to the list', () => {
  const a = athlete();
  const d = a.state.days.filter(x => x.date < TODAY && a.sessionRan(x) && x.type === 'long').slice(-1)[0];
  a.handleHistoryOpen(d.id);
  assert.equal(a.state.view, 'full');
  assert.equal(a.planSessionOpen, d.id, 'the run’s own day is not the page');
  assert.equal(a.logOpenFor[d.id], true, 'Your Log is not open');
  assert.equal(a.analysisOpenFor[d.id], true, 'SACORO Analysis is not open');
  // the page is the completed record: its log carries what was run
  const page = a.renderPlanSessionView();
  assert.match(page, /data-action="toggle-log" data-day="/);
  assert.match(page, /data-action="view-analysis" data-day="/);
  let reopened = null;
  a.openRecordPanel = k => { reopened = k; };
  a.handlePlanBack();
  assert.equal(reopened, 'history', 'Back did not return to Activity History');
  assert.equal(a.state.view, 'planhq');
  assert.equal(a.planSessionOpen, null);
});

test('leaving by a tab forgets the way back', () => {
  const a = athlete();
  const d = a.state.days.filter(x => x.date < TODAY && a.sessionRan(x)).slice(-1)[0];
  a.handleHistoryOpen(d.id);
  a.handleSetView('today');
  assert.equal(a.historyReturn, null);
});

test('with nothing run yet the box says so, and the page explains itself', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: TODAY });
  assert.match(a.activityHistoryPlateHtml(), />None yet</);
  assert.match(a.recordPanelHistory(), /Nothing run yet/);
});

test('a Strava run says so beside its date, small and plain', () => {
  /* Founder: "Add a small, muted 'From Strava' label beside the date in
     Activity History. No Strava orange or extra icon." */
  const a = athlete();
  const d = a.state.days.filter(x => x.date < TODAY && a.sessionRan(x)).slice(-1)[0];
  assert.doesNotMatch(a.activityCardHtml(d), /From Strava/, 'a hand-logged run claims to come from Strava');
  d.stravaActivityId = 123;
  const card = a.activityCardHtml(d);
  assert.match(card, /<span class="ah-when"><span class="ah-date font-mono">[^<]+<\/span><span class="ah-src">From Strava<\/span><\/span>/);
  assert.doesNotMatch(card, /<svg|#FC4C02|strava-orange/i, 'an icon or Strava orange came with it');
  assert.match(CSS, /\.ah-src\{[^}]*font-size:\.6875rem;[^}]*color:#FFFFFF;\}/);
});
