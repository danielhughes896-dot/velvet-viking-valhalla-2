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

  ['valhalla-sunrise-820.jpg'].forEach(f => {
    assert.ok(SRC.indexOf('/assets/' + f) > -1,
      '/assets/' + f + ' is no longer referenced — the file on disk and the reference have drifted');
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', f)),
      '/assets/' + f + ' is referenced but is not on disk');
  });
  /* ---- CHANGED SIDES: valhalla-v-256.png IS NO LONGER DRAWN ----
     It was the gold V above the name on the splash, and it was listed with
     the sunrise because both are real files whose names must not be
     "finished". The splash is the name between two dots now -- founder: "We
     don't need an emblem everywhere for the app. It's simply the name with
     the dots." -- so nothing references it.
     THE FILE STAYS, AND THAT IS THE ASSERTION. It is the Velvet Viking V: a
     brand asset rather than a build artefact, and exactly the kind of thing
     deleted in a clear-out and then wanted back. If it is ever drawn again
     it must still be under this name, which the rename guards above cover. */
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'valhalla-v-256.png')),
    'the Velvet Viking V was deleted as an orphan; it is a brand asset, not a build artefact');
  assert.equal(SRC.indexOf('valhalla-v-256'), -1,
    'the chevron is being drawn again. If that is intended, this law and the ' +
    'splash lockup law in test/programmeEntry both have to say so');
});

/* ===========================================================================
 * THE PRODUCT IS SACORO, THE COMPANY IS VELVET VIKING
 * ---------------------------------------------------------------------------
 * Founder, asked whether page titles should read Sacoro or Velvet Viking:
 * "If it's customer facing SACORO."
 *
 * The two names are not interchangeable and the line between them is not a
 * matter of taste. Velvet Viking Ltd is a registered company that signs the
 * work, owns the domain, is named in the privacy policy as the data
 * controller and appears in the byline under the mark. Sacoro is the thing
 * the athlete opens. Every sentence that addresses the athlete about the
 * product -- a page title, an error, the name under the launcher icon -- is
 * Sacoro.
 *
 * This is the law because the old name does not come back in a rename; it
 * comes back one string at a time, in a toast somebody wrote in a hurry.
 * ======================================================================== */

/* Every surface an athlete reads outside the app. */
const PUBLIC_PAGES = ['get.html', 'start.html', 'account.html',
                      'privacy.html', 'terms.html', 'www/index.html'];

/* THE ONLY PLACES THE COMPANY MAY SPEAK, and what each one is for. Anything
   else carrying the company name is the product being called by the wrong
   one, which is the entire failure this guards. */
const COMPANY_SPEAKS = [
  'By Velvet Viking',              /* the byline under the mark */
  'Velvet Viking Ltd',             /* the registered company, in the legal pages */
  'Velvet Viking crest',           /* what the artwork actually is */
  'data Velvet Viking holds',      /* privacy: the controller, not the app */
  'not to Velvet Viking,',         /* privacy: whose backup it is not */
  'Velvet Viking is responsible',  /* privacy: the controller's duty */
  /* AND ONE THAT IS NOT THE COMPANY SPEAKING AT ALL. It names the entry an
     athlete will see on Strava's own settings screen, which carries whatever
     the Strava application was registered as. It is pinned present by a law
     of its own below rather than merely permitted here, so it cannot quietly
     disappear either. */
  'remove Velvet Viking in your Strava settings',
  /* AND ONE IDENTIFIER, not a name on a screen. PRODID names the software
     that wrote a calendar file, next to a UID suffix this file already pins
     as immovable. No calendar keys an event on it, so renaming it would be
     safe -- but it is stamped into every .ics an athlete has already
     exported, and there is nothing to gain from two spellings of the same
     exporter in the wild. It moves when the UID does, or not at all. */
  "PRODID:-//Velvet Viking//Training Block//EN"
];

/* velvetviking.co.uk is infrastructure the world already resolves, and
   com.velvetviking.valhalla is pinned as immovable above. Neither is a name
   being shown to anybody. */
function strippedOfCompany(text){
  let s = text
    /* COMMENTS ARE NOT CUSTOMER FACING, and this codebase explains itself at
       length -- several of those explanations are about what the header used
       to say, which is exactly the phrase being forbidden. Both comment forms
       are removed: <!-- --> in the markup, and the block comments that carry
       the reasoning in the stylesheet and the script. Line comments are left,
       because stripping // would take the https:// out of every URL. */
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/com\.velvetviking\.valhalla/g, '')
    .replace(/velvetviking\.co\.uk/g, '');
  COMPANY_SPEAKS.forEach(ok => { s = s.split(ok).join(''); });
  return s;
}

test('no public page calls the product by the company name', () => {
  PUBLIC_PAGES.forEach(p => {
    const s = strippedOfCompany(fs.readFileSync(path.join(ROOT, p), 'utf8'));
    const at = s.indexOf('Velvet Viking');
    if (at > -1){
      assert.fail(p + ' calls the product Velvet Viking: "' +
        s.slice(Math.max(0, at - 50), at + 60).replace(/\s+/g, ' ').trim() +
        '". The company signs the work; the product the athlete opens is Sacoro');
    }
  });
});

test('no screen inside the app calls the product by the company name', () => {
  /* Read from the runtime rather than rendered, because these are error and
     confirmation strings that only a failing network or a destructive tap
     would ever surface -- exactly the copy nobody re-reads after a rename. */
  const s = strippedOfCompany(SRC);
  const at = s.indexOf('Velvet Viking');
  if (at > -1){
    assert.fail('the runtime calls the product Velvet Viking: "' +
      s.slice(Math.max(0, at - 60), at + 70).replace(/\s+/g, ' ').trim() + '"');
  }
});

test('every title and launcher label says Sacoro', () => {
  /* The name under the icon, the name in the tab, the name in a share card. */
  const titled = [['protected/velvet-viking-valhalla.html', /<title>([^<]*)<\/title>/],
                  ['start.html', /<title>([^<]*)<\/title>/],
                  ['account.html', /<title>([^<]*)<\/title>/],
                  ['get.html', /<title>([^<]*)<\/title>/],
                  ['privacy.html', /<title>([^<]*)<\/title>/],
                  ['terms.html', /<title>([^<]*)<\/title>/],
                  ['www/index.html', /<title>([^<]*)<\/title>/]];
  titled.forEach(([f, re]) => {
    const m = re.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.ok(m, f + ' has no title');
    assert.ok(/Sacoro/.test(m[1]), f + ' is titled "' + m[1] + '"');
  });

  const strings = fs.readFileSync(path.join(ROOT,
    'android/app/src/main/res/values/strings.xml'), 'utf8');
  assert.match(strings, /<string name="app_name">Sacoro<\/string>/,
    'the name under the Android launcher icon is not the product name');
  assert.match(strings, /<string name="title_activity_main">Sacoro<\/string>/);

  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  assert.equal(cap.appName, 'Sacoro', 'the native shell still ships under the company name');
  /* And the one next to it that must NOT follow, for the reason given above. */
  assert.equal(cap.appId, 'com.velvetviking.valhalla',
    'the package id was renamed; every existing install is now orphaned');
});

test('the Strava disconnect copy still names what Strava shows', () => {
  /* THE ONE PIECE OF COPY THAT IS DELIBERATELY NOT RENAMED. It tells an
     athlete what to look for in somebody else's settings screen, and Strava
     lists the connected application under the name it was registered with.
     Renaming this sends them hunting for an entry that is not there. It
     changes when the Strava application is re-registered, not before. */
  assert.match(SRC, /remove Velvet Viking in your Strava settings/,
    'the Strava disconnect note was renamed ahead of the Strava app itself, ' +
    'so it now names something the athlete will not find on that screen');
});

test('the byline is the company signing it, not the product saying its own name', () => {
  /* The counterpart to the law above, and the reason that one is scoped to
     "calls the PRODUCT" rather than "mentions Velvet Viking". A sweep that
     finishes the rename by replacing every occurrence takes the signature off
     the work with it, and that is a loss rather than a tidy-up: the splash,
     the header and the share image are where the company puts its name to
     what it made. Three places, counted, because two means one was dropped
     and four means one was added without thinking about where it reads. */
  const splash = (SRC.match(/<div class="pe-by">By Velvet Viking<\/div>/g) || []).length;
  assert.equal(splash, 2,
    'the splash byline appears ' + splash + ' times; it belongs in exactly two -- ' +
    'the markup the document paints and the screen the app renders, which have ' +
    'to agree or the handover changes the words');
  /* ---- CHANGED SIDES: THE HEADER GAVE IT UP, THE SHARE IMAGE TOOK IT ----
     This asserted <span class="bm-by"> in the top bar. Founder: "Do you
     think we need by velvet viking on every page of the plan? Or just the
     splash screen? ... We could put it on the socials share overlays and
     the splash screen but I'm not sure it's needed everywhere."
     So the two surfaces are: where the product introduces itself, and where
     its work leaves the app in front of people who have never seen it. A
     daily tool's chrome is neither. */
  /* READ FROM THE RENDERED BAR, NOT THE SOURCE. The deleted rule left a
     comment behind saying what .bm-by used to be and why it went, and a law
     that matches its own explanation is a law that asks the next person to
     delete the reasoning in order to pass. */
  const bar = planned().renderTopbar();
  assert.equal(bar.indexOf('bm-by'), -1,
    'the byline element is back in the top bar, on all five tabs of a daily tool');
  assert.equal(bar.indexOf('By Velvet Viking'), -1,
    'the company is signing every screen again');
  assert.match(SRC, /<div class="wc-by">By Velvet Viking<\/div>/,
    'the share image does not carry the byline -- it is the one picture of ' +
    'this product that reaches people who have never seen it');
});
