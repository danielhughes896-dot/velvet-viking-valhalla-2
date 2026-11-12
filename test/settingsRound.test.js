'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const fnBody = name => { const at = SRC.indexOf('\nfunction ' + name + '('); assert.ok(at !== -1, name + ' is gone'); return SRC.slice(at, SRC.indexOf('\n}\n', at)); };
const rule = sel => { const at = CSS.indexOf(sel); assert.ok(at !== -1, sel + ' has no rule'); return CSS.slice(at, CSS.indexOf('}', at)); };
const text = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function app(){
  const a = loadApp({ pinnedDate: '2026-11-12T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'patchDerivedStats', 'patchExecutionUI'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-02', healthConsent: true });
  return a;
}

// ---------------------------------------------------------------------------
// THIS WEEK: THE LOG OPENS ON THE CARD YOU ARE LOOKING AT
// ---------------------------------------------------------------------------
/* Founder: "A completed session on this week doesn't allow you to open your
   log." The session on This Week is the day's slide; the canonical card sits
   hidden behind the carousel, and replaceCard() redrew only that one. */
test('a redraw of a session redraws its week slide too, at the slide\'s own index', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date < '2026-11-12' && d.type !== 'rest')[0];
  logAsPrescribed(a, dd, { quality: 1 });
  /* A carousel of three slides, the day's own in the middle. */
  const replaced = [];
  const slide = date => ({ date, parentNode: null });
  const slides = [slide('2026-11-01'), slide(dd.date), slide('2026-11-30')];
  const track = { querySelectorAll: () => slides,
    replaceChild: (n, o) => { replaced.push({ html: n.html, old: o.date }); } };
  slides.forEach(s => { s.parentNode = track; });
  a.document.querySelectorAll = sel => {
    const m = /^\.wk-slide\[data-date="([^"]+)"\]$/.exec(sel);
    return m ? slides.filter(s => s.date === m[1]) : [];
  };
  a.document.createElement = () => { const w = {}; Object.defineProperty(w, 'innerHTML', { set(v){ w.firstChild = { html: v }; } }); return w; };
  a.document.getElementById = () => null;          // the hidden card is not even there
  a.wireCoachingRails = () => {};
  a.logOpenFor[dd.id] = true;
  a.replaceCard(dd);
  assert.equal(replaced.length, 1, 'the slide on screen was not redrawn');
  assert.equal(replaced[0].old, dd.date);
  assert.equal(replaced[0].html, a.weekSlideHtml(dd, 1), 'the slide was redrawn at the wrong index, so its ids would collide');
  assert.match(replaced[0].html, /class="log-body"/, 'the redrawn slide does not show the open log');
  /* And the Your Log tab on the slide is the one that fires the toggle. */
  assert.match(a.weekSlideHtml(dd, 1), new RegExp('data-action="toggle-log"\\s+data-day="' + dd.id + '"'));
  /* replaceCard no longer stops when the hidden card is missing. */
  assert.ok(fnBody('replaceCard').indexOf('replaceWeekSlides(dd);') < fnBody('replaceCard').indexOf("getElementById('day-'"));
  assert.doesNotMatch(fnBody('replaceCard'), /if \(!cardEl\) return;/);
});

// ---------------------------------------------------------------------------
// TRAINING & ZONES: BACK GOES BACK ONE PAGE
// ---------------------------------------------------------------------------
/* Founder: "Training zones. When you click 1 of the 3 pages but then swipe
   out it takes all the way back to settings not the training zone page." */
function overlay(a){
  const o = { card: { id: 'training-page' } };
  a.document.getElementById = id => (id === 'modal-overlay' && o.card ? { querySelector: () => o.card } : null);
  return o;
}
test('a page opened from Training & Zones closes back to Training & Zones', () => {
  const a = app();
  const o = overlay(a);
  const opened = [];
  a.openSettingsPanel = k => { opened.push(k); };
  a.openRecordPanelKey = 'training';
  a.stgOpenSub(() => { o.card = { id: 'recalibrate' }; a.openRecordPanelKey = null; });
  assert.equal(a.stgCloseSub(), true, 'closing the sub-page did not go back');
  assert.deepEqual(opened, ['training']);
  /* Once only: the next close is an ordinary close. */
  assert.equal(a.stgCloseSub(), false);
  /* From anywhere else, nothing is remembered. */
  a.openRecordPanelKey = 'prefs';
  a.stgOpenSub(() => { o.card = { id: 'zones' }; });
  assert.equal(a.stgCloseSub(), false, 'a page opened from elsewhere went back to Training & Zones');
  /* A sub-page since replaced by something else is not returned from. */
  a.openRecordPanelKey = 'training';
  a.stgOpenSub(() => { o.card = { id: 'pacing' }; });
  o.card = { id: 'edit-session' };
  assert.equal(a.stgCloseSub(), false, 'a stale return reopened Training & Zones over another page');
  assert.deepEqual(opened, ['training']);
  /* Every door: the four rows, the ring, the record panel's ring, Android's back -- and a swipe presses the ring. */
  ["case 'open-setup': stgOpenSub(openSetupModal); break;",
   "case 'open-recalibrate': stgOpenSub(openRecalibrateModal); break;",
   "case 'open-pacing': stgOpenSub(openPacingModal); break;",
   "case 'close-modal': if (!stgCloseSub()) closeModal(); break;",
   "case 'close-record-panel': if (!stgCloseSub()) closeRecordPanel(); break;",
   "if (document.getElementById('modal-overlay')){ if (!stgCloseSub()) closeModal(); return; }"]
    .forEach(s => assert.ok(SRC.indexOf(s) !== -1, 'missing: ' + s));
  assert.match(SRC, /case 'open-record': \(function\(k\)\{ stgOpenSub\(function\(\)\{ openRecordPanel\(k\); \}\); \}\)\(target\.getAttribute\('data-record'\)\); break;/);
  assert.match(fnBody('settingsPanelTraining'), /data-action="open-recalibrate"[\s\S]*data-record="zones"[\s\S]*data-action="open-setup"[\s\S]*data-action="open-pacing"/);
});

test('Build your training block opens as a full page', () => {
  /* Founder: "Training zones. Build your training block full page." */
  assert.match(fnBody('openSetupModal'), /openModal\(html, 'modal-themed builder-light bld-modal '\+STG_PAGE\);/);
  assert.match(SRC, /var STG_PAGE = '[^']*\bhq-full\b[^']*';/);
});

// ---------------------------------------------------------------------------
// THE SMALLER ITEMS
// ---------------------------------------------------------------------------
test('Coaching detail is gone from Preferences, and its row from the hub line', () => {
  const a = app();
  const prefs = a.hqPanelHtml('prefs');
  assert.doesNotMatch(prefs, /Coaching detail|guidance-level-row|data-action="set-guidance"/);
  assert.doesNotMatch(a.renderSettingsHubView(), /Coaching detail/);
  assert.equal(a.guidanceLevel(), 'adaptive');
});

test('Health & Readiness gives each of its three points room of its own', () => {
  const a = app();
  const html = a.renderHealthConsentSettings();
  const gaps = [...html.matchAll(/class="field-hint hc-para" style="margin-top:(\d+)px;"/g)].map(m => +m[1]);
  assert.equal(gaps.length, 3);
  gaps.forEach(g => assert.ok(g >= 18, 'the sentences are packed together again (' + g + 'px)'));
});

test('no dashes standing in for punctuation on the Settings and injury screens', () => {
  /* Founder: "Injury or illness has a erm -". */
  const a = app();
  a.openModal = h => { a.__last = h; };
  a.openRestrictionModal();
  const injury = text(a.__last);
  assert.doesNotMatch(injury, /—/, 'a dash is back on Injury or illness');
  assert.match(injury, /does not record one\. If you are hurt or unwell, see a clinician\./);
  assert.match(injury, /You can end it early or extend it at any time\. Nothing is locked in\./);
  const hub = text(a.renderSettingsHubView());
  assert.doesNotMatch(hub, /—/, 'a dash is back on the Settings list');
  /* And the line it shows while a restriction is open. */
  a.openRestriction = () => ({ id: 'r1', kind: 'injury', start: '2026-11-10' });
  const open = text(a.renderSettingsHubView());
  assert.match(open, /Injury or illness: restriction open/);
  assert.doesNotMatch(open, /—/, 'a dash is back on the open restriction line');
  assert.doesNotMatch(text(a.renderHealthConsentSettings()), /—/);
});

test('Settings titles are white, and no row carries a pill', () => {
  /* Founder: "All titles are gold? White please." and, of the subscription
     row's "Owner": "do we need the pill?" */
  assert.match(rule('.view-settings .stg-group .setup-section-title,\n  .hq-panel.stg-panel .setup-section-title{'), /color:#FFFFFF/);
  assert.doesNotMatch(fnBody('stgRow').replace(/\/\*[\s\S]*?\*\//g, ''), /stg-pill/, 'a Settings row can carry a pill again');
  const a = app();
  /* The row exactly as the hub builds it (the hub only adds it when signed in). */
  assert.match(fnBody('renderSettingsHubView'), /stgPanelRow\('Subscription', subscriptionRowLine\(sub\),\s*'subscription', subscriptionRowPill\(sub\), 'is-gold'\)/);
  const row = info => a.stgPanelRow('Subscription', a.subscriptionRowLine(info), 'subscription', a.subscriptionRowPill(info), 'is-gold');
  const owner = row({ signed_in: true, override: 'owner', access: true });
  assert.match(owner, /stg-row-title">Subscription<\/span><span class="stg-row-sub">Owner access<\/span>/, 'the subscription row no longer says what it is in words');
  assert.doesNotMatch(owner, /stg-pill|>Owner</, 'the Owner pill is back');
  /* A paying athlete reads a sentence, not a pill. */
  const paying = row({ signed_in: true, commercial_required: true, access: true, state: 'active', access_until: '2026-12-12' });
  assert.match(paying, /stg-row-sub">Subscription active until /);
  assert.doesNotMatch(paying, /stg-pill|>Active</);
  assert.doesNotMatch(fnBody('renderSubscriptionCard').replace(/\/\*[\s\S]*?\*\//g, ''), /sub-pill/, 'the pill is back on the Subscription page');
});

// ---------------------------------------------------------------------------
// THE NAME, IN CAPITALS, WHEREVER IT IS READ
// ---------------------------------------------------------------------------
/* Founder: "Saroco should be SACORO check the whole app every place the end
   user can reach!" The fixed copy was rewritten; what a language model writes
   arrives at run time, so it is put into capitals on its way to the screen.
   What is spoken is the word, not four letters spelled out. */
test('a written note and a coach answer show SACORO; the voice says the word', () => {
  const a = app();
  assert.equal(a.brandCase('Sacoro read this. Sacoros and sacoro stay.'), 'SACORO read this. Sacoros and sacoro stay.');
  assert.equal(a.brandCase(null), '');
  assert.equal(a.voiceSayName('SACORO wants an easy day.'), 'Sacoro wants an easy day.');
  const dd = a.state.days.filter(d => d.type !== 'rest')[0];
  a.coachNoteWritten = () => 'Sacoro kept the plan as written.';
  assert.equal(a.coachNoteText(dd), 'SACORO kept the plan as written.', 'a written Coach’s Note shows the name as the model spelled it');
  /* Both ways an answer reaches Ask Coach go through it. */
  assert.match(SRC, /answer: \(extra && extra\.answer != null\) \? brandCase\(extra\.answer\) : askState\.answer,/);
  assert.match(SRC, /askState\.answer = brandCase\(askStreamBuf\);/);
  /* And the voice turns it back into a word before any engine sees it. */
  const speak = fnBody('voiceSpeak');
  assert.ok(speak.indexOf('text = voiceSayName(text);') > -1 && speak.indexOf('text = voiceSayName(text);') < speak.indexOf('voiceCloudSpeak('),
    'the name reaches a speech engine in capitals');
});
