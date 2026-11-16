'use strict';
/* THE SAFETY NET (founder, 16 November 2026: "build the safety net").
   Changing a session's type in Edit Details drops the workout the day
   carried, so a day could read REPETITION with nothing to run (measured on
   a live plan: a week three session changed to repetition, no
   prescription). The day now says so, under its hero in every view, with
   two glass buttons, the choice on the right:
     Back to the Plan   the plan's own session back (manualEdit.from)
     Choose a Workout   Edit Session, open on Change Workout for that type */
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

const SENTENCE = 'This session was changed to Repetition, but no workout came with it.';

function plan(){
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', startDate: '2026-11-16' });
  return a;
}
/* The Edit Details path, exactly as handleSaveEdit() writes it: the planned
   session kept in manualEdit.from, the type changed, the structure dropped. */
function changeType(a, dd, type){
  const before = { title: dd.title, type: dd.type, km: dd.km, desc: dd.desc, mpSegment: !!dd.mpSegment,
                   prescription: dd.prescription ? JSON.parse(JSON.stringify(dd.prescription)) : null };
  dd.type = type;
  delete dd.prescription;
  dd.manualEdit = { at: '2026-11-16T09:00:00Z', fields: ['type'], from: before };
}
function futureEasy(a){
  return a.state.days.find(d => d.date > '2026-11-18' && d.type === 'easy' && d.km > 0 && !d.completed);
}
function clickListener(a){
  const fns = (a.document._listeners || {}).click || [];
  assert.equal(fns.length, 1);
  return fns[0];
}
function clickOn(action, attrs){
  const at = Object.assign({ 'data-action': action }, attrs || {});
  const node = {
    getAttribute(n){ return Object.prototype.hasOwnProperty.call(at, n) ? at[n] : null; },
    closest(sel){ return sel === 'details' ? null : this; },
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, removeAttribute(){}, focus(){}, blur(){}, value: '', checked: false, dataset: {},
  };
  return { target: node, currentTarget: node, preventDefault(){}, stopPropagation(){} };
}

test('a session changed to Repetition with no workout says so, with both buttons, primary on the right', () => {
  const a = plan();
  const dd = futureEasy(a);
  changeType(a, dd, 'repetition');
  const html = a.renderMissingWorkoutNet(dd);
  assert.ok(html.indexOf(SENTENCE) !== -1, html);
  const back = html.indexOf('Back to the Plan'), choose = html.indexOf('Choose a Workout');
  assert.ok(back > 0 && choose > back, 'Back to the Plan first, Choose a Workout (primary) on the right');
  assert.ok(/class="btn btn-primary" data-action="mw-choose"/.test(html), 'Choose a Workout is the primary');
  assert.ok(/class="btn btn-ghost" data-action="mw-back"/.test(html));
});

test('the net is on Today and on the week and Full Plan cards (it rides on the shared hero)', () => {
  const a = plan();
  const dd = futureEasy(a);
  changeType(a, dd, 'repetition');
  const hero = a.renderDayHeroBlock(dd, a.getDayTargets(dd));
  assert.ok(hero.indexOf(SENTENCE) !== -1, 'hero');
  assert.ok(a.renderDayCard(dd).indexOf(SENTENCE) !== -1, 'day card (Today / Full Plan)');
  assert.ok(a.weekSlideHtml(dd, 0).indexOf(SENTENCE) !== -1, 'week slide');
});

test('Back to the Plan is hidden when there is nothing to restore', () => {
  const a = plan();
  const dd = futureEasy(a);
  changeType(a, dd, 'repetition');
  delete dd.manualEdit.from;
  const html = a.renderMissingWorkoutNet(dd);
  assert.ok(html.indexOf(SENTENCE) !== -1);
  assert.equal(html.indexOf('Back to the Plan'), -1);
  assert.ok(html.indexOf('Choose a Workout') !== -1);
});

test('Back to the Plan restores the planned session and the net goes', () => {
  const a = plan();
  const dd = futureEasy(a);
  const was = { type: dd.type, km: dd.km, title: dd.title };
  changeType(a, dd, 'repetition');
  clickListener(a)(clickOn('mw-back', { 'data-day': dd.id }));
  const after = a.findDay(dd.id);
  assert.deepEqual({ type: after.type, km: after.km, title: after.title }, was);
  assert.equal(after.manualEdit, undefined);
  assert.equal(a.renderMissingWorkoutNet(after), '');
});

test('Choose a Workout opens Edit Session on Change Workout, on the type\'s own tab', () => {
  const a = plan();
  const dd = futureEasy(a);
  changeType(a, dd, 'repetition');
  const calls = [];
  a.openEditModal = id => calls.push(['open', id]);
  let clicked = false;
  a.document.querySelector = sel => sel === '[aria-controls="ef-sec-workout-body"]' ? { click(){ clicked = true; } } : null;
  clickListener(a)(clickOn('mw-choose', { 'data-day': dd.id }));
  assert.deepEqual(calls, [['open', dd.id]]);
  assert.ok(clicked, 'the Change Workout section was opened');
  assert.equal(a.wkStateFor(dd).fam, 'interval', 'repetition opens on the Interval tab');
  assert.ok(a.wkOptions(dd, 'interval').length > 0, 'there are workouts of that type to choose');
});

test('choosing a library workout clears the net', () => {
  const a = plan();
  const dd = futureEasy(a);
  changeType(a, dd, 'repetition');
  const opt = a.wkOptions(dd, 'interval').find(o => !o.planned && !o.restore);
  assert.ok(opt, 'a library interval workout is offered');
  assert.ok(a.wkApply(dd, opt));
  assert.equal(a.renderMissingWorkoutNet(dd), '');
});

test('no net where the day has a workout, is not a workout type, was never changed, is done, or was rewritten by the athlete', () => {
  const a = plan();
  const q = a.state.days.find(d => d.date > '2026-11-18' && a.WEEKLY_QUALITY_TYPES.includes(d.type) && a.prescriptionOf(d));
  assert.ok(q, 'the plan has a quality session with a workout');
  assert.equal(a.renderMissingWorkoutNet(q), '', 'a planned workout');
  const e = futureEasy(a);
  assert.equal(a.renderMissingWorkoutNet(e), '', 'an easy run needs no workout');
  const legacy = futureEasy(a); legacy.type = 'tempo'; delete legacy.prescription;
  assert.equal(a.renderMissingWorkoutNet(legacy), '', 'not changed by the athlete: not this net');
  const done = futureEasy(a); changeType(a, done, 'tempo'); done.completed = true;
  assert.equal(a.renderMissingWorkoutNet(done), '', 'already run');
  const own = a.state.days.filter(d => d.date > '2026-11-18' && d.type === 'easy' && d.km > 0)[3];
  changeType(a, own, 'tempo'); own.manualEdit.fields.push('desc');
  assert.equal(a.renderMissingWorkoutNet(own), '', 'the athlete wrote their own instructions');
  const ownW = a.state.days.filter(d => d.date > '2026-11-18' && d.type === 'easy' && d.km > 0)[4];
  changeType(a, ownW, 'interval');
  ownW.prescription = a.athletePrescription({ km: ownW.km, type: 'interval', name: 'Your Own Workout' });
  assert.equal(a.renderMissingWorkoutNet(ownW), '', 'Make Your Own is a workout');
});

test('the copy follows the product rules', () => {
  const a = plan();
  const dd = futureEasy(a);
  changeType(a, dd, 'threshold');
  const html = a.renderMissingWorkoutNet(dd);
  assert.ok(html.indexOf('This session was changed to Threshold, but no workout came with it.') !== -1);
  assert.ok(!/—/.test(html), 'no em dash');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.equal((src.match(/<style/g) || []).length, 1, 'exactly one <style block');
  assert.ok(/\.mw-net-say\{[^}]*color:#FFFFFF/.test(src), 'white words, no grey');
});

test('the old session\'s words do not sit under the new type', () => {
  const a = plan();
  const dd = futureEasy(a);
  const easyWords = dd.desc;
  assert.ok(easyWords && /easy/i.test(a.resolveDesc(easyWords)), 'the easy day has its own words to begin with');
  changeType(a, dd, 'repetition');
  const card = a.renderDayCard(dd);
  assert.ok(card.indexOf('class="day-desc"') === -1, 'no description line on the net day');
  assert.ok(card.indexOf(a.escapeHtml(a.resolveDesc(easyWords))) === -1, 'the easy words are gone');
});

test('Change Workout lists and ticks nothing as the current session on the net day', () => {
  const a = plan();
  const dd = futureEasy(a);
  changeType(a, dd, 'repetition');
  const opts = a.wkOptions(dd, 'interval');
  assert.ok(!opts.some(o => o.planned), 'the broken change is not offered as "your change"');
  a.wkState = null;
  const html = a.wkPickerHtml(dd);
  assert.ok(html.indexOf('aria-checked="true"') === -1, 'nothing ticked');
  assert.ok(html.indexOf('Your change to this session') === -1);
});

test('once a workout is chosen, its own row is ticked again', () => {
  const a = plan();
  const dd = futureEasy(a);
  changeType(a, dd, 'repetition');
  const opt = a.wkOptions(dd, 'interval').find(o => !o.planned && !o.restore);
  assert.ok(a.wkApply(dd, opt));
  a.wkState = null;
  assert.ok(!a.missingWorkoutOf(dd));
  assert.ok(a.wkPickerHtml(dd).indexOf('aria-checked="true"') !== -1);
});
