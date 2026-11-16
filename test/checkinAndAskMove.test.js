'use strict';
/* Founder: "Daily check-in. Before completion: Display the check-in prompt.
   After completion: Remove it from Today. Retain the recorded answers within
   Recovery on the Coach page. This will allow the athlete to amend their
   answers through Recovery if their condition changes." And: "Also move Ask
   Coach to the Coach page." */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

function athlete(){
  const a = loadApp({ pinnedDate: '2026-11-17T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', startDate: '2026-11-16' });
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted', at: '2026-01-01T00:00:00Z' };
  a.state.view = 'today';
  return a;
}
function answer(a, legs){
  a.handleSetReadiness('legs', legs); a.handleSetReadiness('sleep', 'good'); a.handleSetReadiness('health', 'good');
}

test('before the check-in, Today asks; after it, Today shows nothing of it', () => {
  const a = athlete();
  assert.match(a.renderTodayCheckIn('top'), /How are you today\?/);
  answer(a, 'fresh');
  assert.equal(a.renderTodayCheckIn('top'), '');
  assert.equal(a.renderTodayCheckIn('foot'), '', 'no summary line at the foot either');
});

test('the answers feed the Morning tile and are three lines under The Evidence; a tap reopens the check-in', () => {
  const a = athlete();
  answer(a, 'heavy');
  const panel = a.readingPanel('recovery');
  assert.match(panel, /Morning/);
  assert.doesNotMatch(panel, /data-action="set-readiness"/, 'no grid of answer buttons');
  const ev = panel.slice(panel.indexOf('The Evidence'));
  for (const [k, v] of [['Legs', 'Heavy'], ['Sleep', 'Good'], ['Health', 'Good']])
    assert.match(ev, new RegExp('data-action="recovery-checkin-edit"[^>]*>[\\s\\S]*?' + k + '<\\/span><span class="hq-row-v is-words">' + v + '<'), k);
  a.handleSetReadiness('legs', 'fresh');
  assert.equal(a.findDayByDate('2026-11-17').readiness.legs, 'fresh');
  assert.match(a.readingPanel('recovery'), />Legs<\/span><span class="hq-row-v is-words">Fresh</);
});

test('without health consent Recovery shows no check-in', () => {
  const a = athlete();
  a.state.healthConsent = null;
  assert.doesNotMatch(a.readingPanel('recovery') || '', /Today’s Check-in/);
});

test('Ask Coach is on the Coach page, not on Today', () => {
  const a = athlete();
  a.setVoiceCoachAvailable ? a.setVoiceCoachAvailable(true) : null;
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  /* Under the circles; Coach Noticed may sit between it and the graph
     (founder: "Move Coach Noticed above Aerobic Development"). */
  assert.match(src, /'<div id="coach-ask-mount">'\+coachAskHtml\(\)\+'<\/div>'\+[\s\S]{0,600}?renderCoachNoticedCard\(report\)\+\s*renderCoachGraph\(\)/, 'Ask Coach sits under the Coach circles');
  assert.match(src, /\.view-today #voice-card \.voice-btn\[data-action="voice-ask-open"\]\{display:none;\}/, 'Today no longer shows it');
  assert.match(src, /class="coach-ask-btn" data-action="voice-ask-open"/);
});

test('the edit pencil sits after the last word of the open session title, and not in the corner rail', () => {
  const a = athlete();
  const dd = a.findDayByDate('2026-11-17');
  const card = a.renderDayCard(dd);
  assert.match(card, /<span class="th-title-last">[^<]+<button[^>]*data-action="open-edit"/);
  assert.doesNotMatch(card, /class="day-rail"[\s\S]{0,200}data-action="open-edit"/);
  assert.equal((card.match(/data-action="open-edit"/g) || []).length, 1, 'one pencil');
});

test('Ask Coach on the Coach page wears the cherry rim and glow', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /\.coach-ask-btn\{border:1\.5px solid var\(--cherry\); box-shadow:0 0 16px var\(--cherry-dim\);/);
});
