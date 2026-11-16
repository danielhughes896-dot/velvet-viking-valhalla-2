'use strict';
/* THE TODAY TRAY. Founder, choosing from the mock-ups: "Option 1 and
   straight into Your Log", and of Ask Coach: "Keep it on Today".
   On a run day Today has one primary action, Log Run, on a glass tray just
   above the tab bar, with Hear Today beside it on the left. Log Run marks the
   run done (as the circle does) and opens Your Log. After logging the tray
   offers Share. On a rest day the tray holds Hear Today alone. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

function athlete(pin){
  const a = loadApp({ pinnedDate: pin + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', startDate: '2026-11-16' });
  a.state.view = 'today';
  return a;
}
function runDayPin(){
  const a = athlete('2026-11-16');
  const d = a.state.days.find(x => x.date >= '2026-11-16' && x.type !== 'rest' && x.km > 0);
  return d.date;
}
const buttons = html => (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) || []);

test('a run day not yet logged: Hear Today on the left, Log Run (the one primary) on the right', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const html = a.renderTodayTray();
  const b = buttons(html);
  assert.equal(b.length, 2, html);
  assert.match(b[0], /class="btn btn-ghost"/);
  assert.match(b[0], /data-action="voice-listen"/);
  /* Hear Today on a device that speaks, Read Today on one that cannot. */
  assert.match(b[0], />(Hear|Read) Today</, 'the tray label is Title Case');
  assert.match(b[1], /class="btn btn-primary" data-action="today-log-run"/);
  assert.match(b[1], />Log Run</);
  assert.equal((html.match(/btn-primary/g) || []).length, 1, 'one primary');
});

test('Log Run marks the run done and opens Your Log; while the log is open and unsaved the tray steps aside', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  assert.ok(!dd.completed);
  a.handleTodayLogRun(dd.id);
  assert.equal(a.findDayByDate(pin).completed, true, 'marked done');
  assert.equal(a.logOpenFor[dd.id], true, 'Your Log is open');
  assert.equal(a.renderTodayTray(), '', 'Save at the end of the log is the one thing to press');
});

test('Save at the end of Your Log: Save, then Saved, then the tray offers Share', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  a.handleTodayLogRun(dd.id);
  assert.match(a.logSaveButtonHtml(dd), /data-action="log-save"[^>]*><span>Save<\/span>/);
  a.handleLogSave(dd.id);
  assert.ok(a.findDayByDate(pin).logSavedAt, 'recorded on the day, so it holds across a restart and a sync');
  assert.match(a.logSaveButtonHtml(dd), /is-saved[\s\S]*<span>Saved<\/span>/);
  const b = buttons(a.renderTodayTray());
  assert.match(b[b.length - 1], /class="btn btn-primary" data-action="share-workout"/);
  assert.match(b[b.length - 1], />Share</);
  assert.doesNotMatch(a.renderTodayTray(), /today-log-run|>(Hear|Read) Today</, 'no briefing once the run is done');
});

test('changing an answer after Saved puts it back to Save, and Share waits again', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  a.handleTodayLogRun(dd.id);
  a.handleLogSave(dd.id);
  a.markLogEdited(dd.id);
  assert.ok(!a.findDayByDate(pin).logSavedAt);
  assert.match(a.logSaveButtonHtml(dd), /<span>Save<\/span>/);
  assert.doesNotMatch(a.renderTodayTray(), /share-workout/);
});

test('a run already done but not logged (a Strava run, or the log closed): Log Run opens the log', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  dd.completed = true;
  a.logOpenFor[dd.id] = false;
  const b = buttons(a.renderTodayTray());
  assert.equal(b.length, 1);
  assert.match(b[0], /data-action="today-log-run"/);
  a.handleTodayLogRun(dd.id);
  assert.equal(a.findDayByDate(pin).completed, true, 'not unticked');
  assert.equal(a.logOpenFor[dd.id], true);
});

test('after Save the only voice on the tray is the spoken analysis, never the briefing', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  a.handleTodayLogRun(dd.id);
  a.handleLogSave(dd.id);
  const html = a.renderTodayTray();
  const script = a.voiceScriptFor(dd);
  if (script && script.kind === 'debrief') assert.match(html, />(Hear|Read) How It Went</);
  else assert.doesNotMatch(html, /voice-listen/);
});

test('today\'s card holds its own Share until Save; a past run keeps Share', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  a.handleTodayLogRun(dd.id);
  assert.doesNotMatch(a.renderDayCard(dd), /btn-share/, 'Share before Save');
  a.handleLogSave(dd.id);
  assert.match(a.renderDayCard(dd), /btn-share/, 'Share after Save');
});

test('the session card carries no tick; status lives in the day circles and Log Run', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  const card = a.renderDayCard(dd);
  assert.doesNotMatch(card, /data-action="toggle-complete"/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /cls \+= \(dd\.type !== 'rest' && !dd\.restricted\) \? ' is-missed' : ' is-past';/, 'This Week still marks missed days');
});

test('Log Run on a run already marked done only opens the log', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  a.handleToggleComplete(dd.id);
  assert.equal(a.findDayByDate(pin).completed, true);
  a.handleTodayLogRun(dd.id);
  assert.equal(a.findDayByDate(pin).completed, true, 'not unticked');
  assert.equal(a.logOpenFor[dd.id], true);
});

test('a rest day: Hear Today alone, as the primary', () => {
  const a0 = athlete('2026-11-16');
  const rest = a0.state.days.find(x => x.date >= '2026-11-16' && x.type === 'rest');
  const a = athlete(rest.date);
  const html = a.renderTodayTray();
  const b = buttons(html);
  assert.equal(b.length, 1, html);
  assert.match(b[0], /class="btn btn-primary" data-action="voice-listen"/);
  assert.match(html, /today-tray is-one/);
  assert.doesNotMatch(html, /Log Run|Share/);
});

test('the tray is Today only', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  for (const v of ['week', 'full', 'planhq', 'settings']){
    a.state.view = v;
    assert.equal(a.renderTodayTray(), '', v);
  }
});

test('the tray is its own element; the tab bar stack still holds the tabs and nothing else', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /renderBottomNavStack\(\) \+ renderTodayTray\(\)/);
  assert.match(src, /return '<div class="bn-stack">'\+renderBottomNav\(\)\+'<\/div>';/);
  /* The page's own Hear Today is hidden while the tray carries it. */
  assert.match(src, /\.app-root:has\(> #today-tray\) #voice-card \.voice-btn:is\(\[data-action="voice-listen"\], \[data-action="voice-stop"\]\)\{display:none;\}/);
  /* And Share is offered once: the card's own Share tab steps aside on Today while the tray carries it. */
  assert.match(src, /\.app-root:has\(> #today-tray \[data-action="share-workout"\]\) \.view-today \.share-launch\{display:none;\}/);
  /* The circle keeps the tray in step. */
  const toggle = src.slice(src.indexOf('function handleToggleComplete('), src.indexOf('function handleToggleComplete(') + 900);
  assert.match(toggle, /patchTodayTray\(\);/);
});

test('the tray copy follows the product rules', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const html = a.renderTodayTray();
  assert.doesNotMatch(html, /—|--/, 'no dashes');
  for (const b of buttons(html)){
    const label = b.replace(/<[^>]+>/g, '').trim();
    assert.ok(/^([A-Z][^\s]*)(\s[A-Z][^\s]*)*$/.test(label), 'Title Case: ' + label);
  }
});

test('the tray moves with Today during a swipe and settles with it (founder: "an obvious delay")', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const off = src.slice(src.indexOf('function pagerSetOffset('), src.indexOf('function pagerCleanup('));
  assert.match(off, /getElementById\('today-tray'\)[^;]*;[^\n]*tray\.style\.transform = 'translate3d\(' \+ dx/);
  assert.match(src, /\.today-tray\.is-settling\{transition:transform \.22s/);
  const clean = src.slice(src.indexOf('function pagerCleanup('), src.indexOf('function pagerFinish('));
  assert.match(clean, /tray\.style\.transform = ''; tray\.classList\.remove\('is-settling'\)/);
});

test('one way into today\'s log: no Your Log tab until Save, then it returns', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  a.handleTodayLogRun(dd.id);
  let card = a.renderDayCard(dd);
  assert.doesNotMatch(card, /data-action="toggle-log"/, 'a second Your Log beside the tray');
  assert.match(card, /class="log-body/, 'the log is open');
  a.handleLogSave(dd.id);
  card = a.renderDayCard(dd);
  assert.match(card, /data-action="toggle-log"[^>]*aria-expanded="false"/, 'the tab returns, closed');
});

test('Log Run opens the log with a reveal, once', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  a.logRevealFor[dd.id] = true; a.logOpenFor[dd.id] = true; dd.completed = true;
  assert.match(a.renderDayCard(dd), /class="log-body is-revealing"/);
  assert.doesNotMatch(a.renderDayCard(dd), /is-revealing/, 'only on the render that opens it');
});

test('Not run? Undo at the foot of the log undoes the day and brings Log Run back', () => {
  const pin = runDayPin();
  const a = athlete(pin);
  const dd = a.findDayByDate(pin);
  a.handleTodayLogRun(dd.id);
  assert.match(a.renderDayCard(dd), /data-action="log-undo"[^>]*>Not run\? Undo</);
  a.handleLogUndo(dd.id);
  assert.equal(!!a.findDayByDate(pin).completed, false);
  assert.match(a.renderTodayTray(), /data-action="today-log-run"/);
  assert.doesNotMatch(a.renderDayCard(dd), /log-undo/, 'no undo on a run not done');
});

test('Edit Details no longer points at a tick on the card', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.doesNotMatch(src, /You can also tick this on the card/);
  assert.match(src, /You can also undo it at the foot of Your Log\./);
});
