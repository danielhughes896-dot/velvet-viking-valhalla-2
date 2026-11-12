'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* SACORO'S HAPTICS, AS THE FOUNDER TABLED THEM.

     Swipe between main tabs          very light tick
     Complete daily check-in          light confirmation
     Save session                     success pulse
     Accept coaching recommendation   firm confirmation
     Close full-page screen           none
     Scroll through content           none

   Each fires only when the thing it confirms actually happened. */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const fnBody = name => { const at = SRC.indexOf('\nfunction ' + name + '('); assert.ok(at !== -1, name + ' is gone'); return SRC.slice(at, SRC.indexOf('\n}\n', at)); };

function phone(platform){
  const a = loadApp({ pinnedDate: '2026-11-12T07:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'closeModal'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-02', healthConsent: true });
  const felt = [];
  const p = name => (o) => { felt.push(name + (o ? ':' + JSON.stringify(o) : '')); return Promise.resolve(); };
  a.window.Capacitor = { getPlatform: () => platform || 'android', Plugins: { Haptics: {
    selectionStart: p('selectionStart'), selectionChanged: p('selectionChanged'), selectionEnd: p('selectionEnd'),
    vibrate: p('vibrate'), impact: p('impact'), notification: p('notification') } } };
  return { a, felt };
}

test('the four feel different, and each is what the plugin really plays', () => {
  const ios = phone('ios');
  ios.a.sacoroHaptic('tick');
  assert.deepEqual(ios.felt, ['selectionStart', 'selectionChanged', 'selectionEnd']);
  const and = phone('android');
  ['tick', 'light', 'success', 'firm'].forEach(k => and.a.sacoroHaptic(k));
  assert.deepEqual(and.felt, ['vibrate:{"duration":8}', 'impact:{"style":"LIGHT"}', 'notification:{"type":"SUCCESS"}', 'impact:{"style":"MEDIUM"}']);
  /* Anything else is silent, never a guess. */
  and.felt.length = 0; and.a.sacoroHaptic('close'); and.a.sacoroHaptic('scroll');
  assert.deepEqual(and.felt, []);
});

test('completing the check-in is felt once, on the answer that completes it', () => {
  const { a, felt } = phone();
  a.handleSetReadiness('legs', 'fresh');
  a.handleSetReadiness('sleep', 'good');
  assert.deepEqual(felt, [], 'a half-answered check-in was confirmed');
  a.handleSetReadiness('health', 'good');
  assert.deepEqual(felt, ['impact:{"style":"LIGHT"}']);
  /* Changing an answer on a finished check-in is not finishing it again. */
  a.handleSetReadiness('sleep', 'ok');
  assert.deepEqual(felt, ['impact:{"style":"LIGHT"}'], 'amending a finished check-in confirmed it again');
});

test('saving a session pulses only when it saved', () => {
  const save = fnBody('handleSaveEdit');
  const updated = save.indexOf("showToast('Session updated')");
  const swapped = save.indexOf("showToast('Swapped '");
  assert.ok(updated > -1 && swapped > -1);
  assert.match(save.slice(updated - 60, updated), /sacoroHaptic\('success'\);\s*$/, 'a saved session is not felt');
  assert.match(save.slice(swapped - 60, swapped), /sacoroHaptic\('success'\);\s*$/, 'a saved swap is not felt');
  /* The refusals are silent. */
  ["Can’t swap — race day", "Can’t swap — that week", "Can’t swap — a logged session"].forEach(r => {
    const at = save.indexOf(r);
    assert.ok(at > -1);
    assert.doesNotMatch(save.slice(at - 120, at), /sacoroHaptic/, 'a refused swap pulses as if it saved: ' + r);
  });
});

test('accepting a coaching recommendation is firm, at every door, and only once it is applied', () => {
  [['handleCoachAccept', "showToast('Session adjusted"], ['handleAcceptPlaybook', 'showToast(prop.decision'], ['handleAcceptEvolution', 'showToast(applied.length===1']]
    .forEach(([fn, toast]) => {
      const body = fnBody(fn);
      const at = body.indexOf(toast);
      assert.ok(at > -1, fn);
      assert.match(body.slice(0, at), /flushSave\(\);\s*renderApp\(\);\s*sacoroHaptic\('firm'\);\s*$/, fn + ' is not confirmed firmly after it is applied');
      assert.equal((body.match(/sacoroHaptic\(/g) || []).length, 1, fn + ' is felt more than once');
    });
});

test('closing a page and scrolling are felt as nothing', () => {
  ['closeModal', 'closeRecordPanel', 'vtCloseBack', 'stgCloseSub', 'handlePlanBack', 'vtPlanBack']
    .forEach(fn => assert.doesNotMatch(fnBody(fn), /sacoroHaptic|pagerHaptic|vibrate/, fn + ' is felt'));
  assert.doesNotMatch(SRC, /addEventListener\('scroll'[^\n]*(?:sacoroHaptic|vibrate)/, 'scrolling is felt');
  /* Exactly the six doors in the table and the tab tick: nothing else feels. */
  const calls = SRC.match(/sacoroHaptic\('(?:tick|light|success|firm)'\)/g) || [];
  assert.equal(calls.length, 7, 'a haptic was added or lost: ' + calls.join(', '));
});

test('the plugin ships with the app', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@capacitor/haptics'], '@capacitor/haptics is not a dependency, so the installed app has no haptics');
  const settings = fs.readFileSync(path.join(ROOT, 'android/capacitor.settings.gradle'), 'utf8');
  assert.match(settings, /capacitor-haptics/, 'the Android project does not include the haptics plugin');
});
