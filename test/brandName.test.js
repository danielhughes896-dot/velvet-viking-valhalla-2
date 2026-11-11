'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

/* ===========================================================================
 * THE PRODUCT IS CALLED SACORO
 * ---------------------------------------------------------------------------
 * Founder, on naming it after his family: Sarah, Cole and Romy -- two letters
 * each, in that order, nobody favoured and not one character of padding. It
 * replaced Valhalla, which was borrowed mythology anyone could use and which
 * a search found crowded on the App Store.
 *
 * A RENAME IS NOT A SUBSTITUTION, IT IS A PROMISE THAT NOTHING WAS MISSED.
 * The old name appeared 437 times in the runtime alone and the only failure
 * mode that matters is one survivor reaching a screen. Grepping the source
 * cannot prove that -- a string assembled at render time, or one living in a
 * table the grep did not think to look at, is invisible to it. So this
 * renders the product and reads what comes out.
 *
 * AND SOME OF IT HAD TO SURVIVE, which is the other half. Four things are
 * identities the outside world already holds rather than names we display,
 * and renaming any of them breaks something real:
 *   com.velvetviking.valhalla   the Android package id and its URL scheme.
 *                               Permanent once published: change it and every
 *                               existing install is orphaned on a dead listing.
 *   @velvetvikingvalhalla       the ICS UID suffix. Change it and every
 *                               calendar event already exported re-issues as
 *                               a new event instead of an update.
 *   velvet-viking-valhalla.html the runtime's own filename, which the service
 *                               worker, the tests and the host all resolve.
 *   /assets/valhalla-*          real files on disk.
 * Each is asserted present below, because a future tidy-up that "finishes the
 * rename" would break them silently and this is the only place that says why
 * they are the way they are.
 * ======================================================================== */

function planned() {
  const a = loadApp();
  a.showToast = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'full', volume: 55, weeks: 14, hasEvent: true });
  return a;
}

/* The old name, never written out in full in a way a careless find-and-replace
   would catch -- this file has to keep saying it to be able to forbid it. */
const OLD = ['V', 'a', 'l', 'h', 'a', 'l', 'l', 'a'].join('');

test('the old name reaches no screen the athlete can open', () => {
  const a = planned();
  const race = a.state.days.filter(d => d.type === 'race')[0];
  const long = a.state.days.filter(d => d.type === 'long' && d.km >= 16)[0];
  const rest = a.state.days.filter(d => d.type === 'rest')[0];

  /* EVERY SURFACE THAT RENDERS FROM A FUNCTION, not a sample of them. A
     screen left out of this list is a screen the rename was never checked
     against, so the list is the claim. */
  const surfaces = [
    ['a run day card', () => a.renderDayCard(long, { open: true })],
    ['goal day card', () => a.renderDayCard(race, { open: true })],
    ['a rest day card', () => rest && a.renderDayCard(rest, { open: true })],
    ['the week slide', () => a.weekSlideHtml(long, 0)],
    ['the week session box', () => a.renderWeekSessionBox(a.currentWeekNum())],
    ['the programme entry / splash', () => a.renderProgrammeEntry()],
    ['the programme status', () => a.renderProgrammeStatus()],
    ['the race day event', () => a.renderRaceDayEvent(race.week)],
    /* renderRaceStrategyPicker, not renderRaceStrategy -- the first version
       of this law guessed the name, the optional-call guard swallowed the
       undefined, and the surface was never read. The guard is gone and the
       count below is exact, so a wrong name fails loudly instead. */
    ['the race strategy control', () => a.renderRaceStrategyPicker()],
  ];
  /* The nine panels behind the circles, which are their own renderers. */
  ['readiness', 'recovery', 'evolution', 'patterns', 'adaptation'].forEach(k =>
    surfaces.push(['the ' + k + ' panel', () => a.readingPanel(k)]));
  /* NAMED ONE BY ONE, because there is no recordPanel(key) to loop over --
     the first version of this law called one and every Record panel silently
     returned undefined, so four of the nine panels were never read and a
     mutation putting the old name back in the Benchmark copy survived. The
     list is the claim; a wrong name in it is a surface nobody checked. */
  [['fitness', a.recordPanelFitness], ['progress', a.recordPanelProgress],
   ['goal', a.recordPanelGoal], ['benchmark', a.recordPanelBenchmark],
   ['zones', a.recordPanelZones]].forEach(([k, fn]) => {
    assert.equal(typeof fn, 'function',
      'the ' + k + ' panel renderer is not where this law thinks it is, so it checks nothing');
    surfaces.push(['the ' + k + ' panel', () => fn()]);
  });
  /* AND THE TOP BAR, which is the one surface on every screen at once. It is
     where the wordmark lives, so a rename that missed it would be the single
     most visible survivor there is -- and the first version of this law did
     miss it. */
  assert.equal(typeof a.renderTopbar, 'function', 'the top bar renderer is gone');
  surfaces.push(['the top bar', () => a.renderTopbar()]);

  /* TWO COUNTS, BECAUSE THEY ARE TWO DIFFERENT FAILURES. A renderer that is
     missing or throws means this law named it wrongly and never looked at
     it -- that is a hole in the law and it fails. A renderer that returns
     an empty string has simply got nothing to show for this fixture, which
     is honest behaviour: renderRaceStrategyPicker() does exactly that when
     the block has no strategy to offer. Conflating the two is how a wrong
     function name hid behind an optional call in the first version. */
  let called = 0, read = 0;
  surfaces.forEach(([what, render]) => {
    let html;
    try { html = render(); }
    catch (e) {
      assert.fail(what + ' could not be rendered at all (' + e.message + ') — ' +
        'this law is not looking at the surface it claims to');
    }
    assert.equal(typeof html, 'string',
      what + ' returned ' + typeof html + ' rather than markup — the renderer named ' +
      'here is not the one that draws it');
    called++;
    if (!html) return;
    read++;
    /* Asset paths legitimately carry the old name; strip them before reading,
       because /assets/valhalla-sunrise-820.jpg is a filename and not a word
       anybody sees. */
    const visible = html.replace(/\/assets\/[a-z0-9.-]+/gi, '')
                        .replace(/com\.velvetviking\.valhalla[^"'\s]*/gi, '')
                        .replace(/@velvetvikingvalhalla/gi, '');
    const hit = new RegExp(OLD, 'i').exec(visible);
    assert.equal(hit, null,
      what + ' still shows the old name: ' +
      (hit ? visible.slice(Math.max(0, hit.index - 70), hit.index + 70) : ''));
  });
  /* THE FLOOR IS THE WHOLE LIST, NOT A SAMPLE OF IT. At >= 10 this passed
     while four Record panels and the top bar were returning nothing, which
     is how two mutations survived. Every surface named above must actually
     have rendered, or the omission is the bug. */
  assert.equal(called, surfaces.length,
    'only ' + called + ' of ' + surfaces.length + ' surfaces could be rendered');
  assert.ok(read >= surfaces.length - 2,
    'only ' + read + ' of ' + surfaces.length + ' surfaces produced any markup — more than ' +
    'one empty surface means the fixture is not exercising this product');
});

test('the name is on the surfaces that carry it', () => {
  /* The counterpart. A rename that emptied the wordmark instead of changing
     it would satisfy the law above perfectly. */
  const a = planned();
  assert.match(a.renderProgrammeEntry(), /Sacoro/,
    'the splash no longer names the product');
  const NEW = 'SACORO';
  assert.ok(SRC.indexOf('<span class="bm-word">Sacoro</span>') > -1 ||
            SRC.indexOf('>Sacoro<') > -1,
    'the top bar wordmark no longer says the product name');
  assert.ok(SRC.indexOf(NEW) > -1 || SRC.indexOf('Sacoro') > -1,
    'the product name appears nowhere in the runtime at all');
});

test('no separator form of the Android identity was renamed', () => {
  /* ---- THE MISS THIS LAW EXISTS FOR ----
     The rename protected the literal com.velvetviking.valhalla, and that was
     not enough. The same identity is written three other ways in this repo,
     and every one of them slipped through:
       com\.velvetviking\.valhalla   escaped, inside a test's regex
       com/velvetviking/valhalla     as a Java package directory on disk
       'com', 'velvetviking', ...    as path segments joined at runtime
     Nine tests failed on it. The code was right each time -- it was the
     expectations that had been renamed out from under it, which is the
     worst shape this can take: a green-looking repo that disagrees with
     the Play Store.
     So the guard is on the SHAPE rather than on one spelling. If any file
     anywhere expects the new name where an immovable identity belongs, that
     is the rename having reached something it must never reach. */
  const files = [];
  (function walk(dir){
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'www') return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      if (/\.(js|json|md|yml|yaml|html|gradle|xml|java)$/.test(e.name)) files.push(full);
    });
  })(ROOT);
  assert.ok(files.length > 100, 'only ' + files.length + ' files were walked');

  const NEW = 'sacoro';
  const FORBIDDEN = [
    new RegExp('velvetviking[\\\\./\\\\\\\\]+' + NEW, 'i'),
    new RegExp("'velvetviking',\\s*'" + NEW + "'", 'i'),
    new RegExp(NEW + '-(mountains|sunrise|v-256)', 'i'),
    new RegExp('velvetviking' + NEW, 'i'),
    new RegExp('velvet-viking-' + NEW, 'i'),
  ];
  const bad = [];
  files.forEach(f => {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    FORBIDDEN.forEach(re => {
      const m = re.exec(txt);
      if (m) bad.push(path.relative(ROOT, f) + ': ' + m[0]);
    });
  });
  assert.deepEqual(bad, [],
    'an immovable identity was renamed — the package id, its Java package ' +
    'directory, the ICS UID, the runtime filename and the asset filenames all ' +
    'stay on the old name whatever the product is called');
});

test('the Java package directory still matches the package id', () => {
  /* The directory IS the package id, with slashes. If they ever disagree the
     app does not build, and nothing above would have told us. */
  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  const dir = path.join(ROOT, 'android', 'app', 'src', 'main', 'java',
                        ...cap.appId.split('.'));
  assert.ok(fs.existsSync(dir),
    'the Java sources are not under ' + cap.appId.split('.').join('/') +
    ' — the package id and the directory holding it have drifted apart');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.java'));
  assert.ok(files.length >= 1, 'no Java sources under the package directory at all');
});

test('the four identities the outside world holds are untouched', () => {
  /* Not style -- each of these breaks something real if it is "finished".
     Asserted on the files that own them rather than on the runtime alone. */
  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  assert.equal(cap.appId, 'com.velvetviking.' + OLD.toLowerCase(),
    'the Android package id changed — every existing install is orphaned on a dead Play listing');

  assert.ok(SRC.indexOf('com.velvetviking.' + OLD.toLowerCase() + '://auth') > -1,
    'the native auth redirect scheme no longer matches the package id, so sign-in cannot return');

  assert.ok(SRC.indexOf('@velvetviking' + OLD.toLowerCase()) > -1,
    'the ICS UID suffix changed — every calendar event already exported re-issues as a new one');

  assert.ok(fs.existsSync(path.join(ROOT, RUNTIME_RELATIVE)),
    'the runtime filename changed without the service worker, the tests and the host following it');

  ['valhalla-sunrise-820.jpg', 'valhalla-v-256.png'].forEach(f => {
    assert.ok(SRC.indexOf('/assets/' + f) > -1,
      '/assets/' + f + ' is no longer referenced — the file on disk and the reference have drifted');
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', f)),
      '/assets/' + f + ' is referenced but is not on disk');
  });
});
