'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const { PROVIDER_A, PROVIDER_B, RAW_A, RAW_B } = require('./raceFixtures.js');

// RACE FINDER — PROTOTYPE TESTS.
//
// There is no provider. Every test feeds synthetic payloads through the real
// normaliser, deduper and filters, because that is the half of the feature that
// can be proven today: the data itself is a licensing question, not a code one.
//
// The tests that matter most are the ones about not lying. A race calendar is
// somebody else's database, and the failure modes are a cancelled event offered
// as a goal, two feeds' copies of one race shown as two races, two different
// races merged into one, an invented elevation, and a name from a stranger's
// database rendered as markup.
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const TODAY = '2026-08-17';
function app() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  return a;
}
const all = a => a.normaliseRaces(RAW_A, PROVIDER_A).concat(a.normaliseRaces(RAW_B, PROVIDER_B));
const byName = (list, frag) => list.filter(r => (r.race || r).name.indexOf(frag) !== -1)[0];
const CAMBRIDGE = { lat: 52.2053, lon: 0.1218, locationLabel: 'Cambridge' };

// ---------------------------------------------------------------------------
// 1. OFF, AND CONNECTED TO NOTHING
// ---------------------------------------------------------------------------
test('1. the prototype is inert and has no provider wired to it', () => {
  const a = app();
  assert.equal(a.RACE_FINDER_ENABLED, false);
  const code = stripComments(SRC);
  const from = code.indexOf('function raceDistanceKey');
  const to = code.indexOf('function goalRaceCourseContext');
  assert.ok(from !== -1 && to > from, 'the Race Finder region must be findable');
  const region = code.slice(from, to);
  /* No network of any kind. A prototype that could fetch is a prototype that
     could fetch from production. */
  ['fetch(', 'XMLHttpRequest', 'cloudFetch(', 'import(', 'WebSocket']
    .forEach(k => assert.ok(region.indexOf(k) === -1, 'must not contain ' + k));
  // and no render path reaches it
  Array.from(code.matchAll(/function (render[A-Za-z]*|patch[A-Za-z]*)\(/g)).map(m => m[1])
    .forEach(fn => {
      const at = code.indexOf('function ' + fn + '(');
      const body = code.slice(at, code.indexOf('\n}', at));
      assert.ok(!/searchRaces\(|raceToPlanInput\(|normaliseRaces\(/.test(body),
        fn + ' reaches into the Race Finder prototype');
    });
});

// ---------------------------------------------------------------------------
// 2. THE PROVIDER BOUNDARY
// ---------------------------------------------------------------------------
test('2. two providers with different vocabularies produce one shape', () => {
  const a = app();
  const A = a.normaliseRaces(RAW_A, PROVIDER_A);
  const B = a.normaliseRaces(RAW_B, PROVIDER_B);
  assert.ok(A.length >= 8 && B.length >= 5, 'both fixtures must yield races');
  const shape = r => Object.keys(r).sort().join(',');
  const expected = shape(A[0]);
  A.concat(B).forEach(r => assert.equal(shape(r), expected, r.name + ' has a different shape'));
});

test('2. no provider field name survives the boundary', () => {
  const a = app();
  const canonical = JSON.stringify(all(a));
  ['event_id', 'event_name', 'event_date', 'distance_km', 'ascent_m', 'organiser_name',
   'event_status', 'startDate', 'distanceKm', 'courseType', 'promoter', 'iso2', 'lastSeen']
    .forEach(f => assert.ok(canonical.indexOf('"' + f + '"') === -1,
      'provider field ' + f + ' leaked past normaliseRace'));
});

test('2. records that are not races are refused rather than repaired', () => {
  const a = app();
  const races = a.normaliseRaces(RAW_A, PROVIDER_A);
  ['', 'No Date 10K', 'Impossible Date 10K', 'No Distance Race', 'No Id Race', 'Absurd Distance']
    .forEach(n => assert.ok(!races.some(r => r.name === n), n + ' must not become a race'));
  assert.equal(a.normaliseRace(null, PROVIDER_A), null);
  assert.equal(a.normaliseRace({}, null), null);
});

test('2. a February 31st is not a date', () => {
  const a = app();
  assert.equal(a.raceDateOf('2026-02-31'), null);
  assert.equal(a.raceDateOf('2026-02-28'), '2026-02-28');
  assert.equal(a.raceDateOf('2026-11-08T09:00:00Z'), '2026-11-08', 'a datetime yields its date');
});

// ---------------------------------------------------------------------------
// 3. UNTRUSTED INPUT
// ---------------------------------------------------------------------------
test('3. a script payload in a race name is inert data, and still escapes on render', () => {
  const a = app();
  const evil = byName(all(a), 'Evil 10K');
  assert.ok(evil, 'the hostile fixture must survive as a race — refusing it would hide a real event');
  assert.equal(evil.name, '<img src=x onerror=alert(1)>Evil 10K',
    'the normaliser stores text, it does not silently rewrite a name');
  /* The defence is that this value is never markup: escapeHtml is what any
     surface must use, and it neutralises exactly this. */
  assert.equal(a.escapeHtml(evil.name).indexOf('<img'), -1);
  assert.match(a.escapeHtml(evil.name), /&lt;img/);
  assert.equal(a.escapeHtml(evil.location).indexOf('<script'), -1);
});

test('3. a javascript: or protocol-relative URL is refused, not sanitised', () => {
  const a = app();
  const evil = byName(all(a), 'Evil 10K');
  assert.equal(evil.officialUrl, null, 'javascript: must not reach an href');
  assert.equal(byName(all(a), 'Redirect 10K').officialUrl, null, 'nor a protocol-relative URL');
  ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', 'ftp://x.example/',
   'https://x.example/a"onmouseover=y', 'not a url', ''].forEach(u =>
    assert.equal(a.safeRaceUrl(u), null, 'must refuse ' + JSON.stringify(u)));
  ['https://bathhalf.example/', 'http://ok.example/path?a=1&b=2']
    .forEach(u => assert.equal(a.safeRaceUrl(u), u, 'must accept ' + u));
});

test('3. a terrain the provider invented becomes unknown, never itself', () => {
  const a = app();
  const evil = byName(all(a), 'Evil 10K');
  assert.equal(evil.terrain, 'unknown', '"lava" is not a terrain Valhalla has');
  assert.equal(evil.status, 'unknown', 'nor is "definitely_on" a status');
  assert.ok(a.RACE_TERRAIN.indexOf(evil.terrain) !== -1);
  assert.ok(a.RACE_STATUS.indexOf(evil.status) !== -1);
});

test('3. control characters and runaway lengths are bounded', () => {
  const a = app();
  assert.equal(a.raceText('Bath Half' + String.fromCharCode(0) + 'Marathon'), 'Bath Half Marathon');
  const long = a.raceText('x'.repeat(500));
  assert.ok(long.length <= a.RACE_TEXT_MAX, 'got ' + long.length);
  assert.equal(a.raceText(123), null, 'a number is not a name');
  assert.equal(a.raceText('   '), null);
});

// ---------------------------------------------------------------------------
// 4. IDENTITY — MERGE THE SAME RACE, NEVER MERGE DIFFERENT ONES
// ---------------------------------------------------------------------------
test('4. one event from two feeds becomes one row that remembers both', () => {
  const a = app();
  const merged = a.dedupeRaces(all(a));
  const cam = merged.filter(r => r.date === '2026-11-08' && /Cambridge Half/.test(r.name));
  assert.equal(cam.length, 1, 'the same race from two providers must collapse');
  assert.equal(cam[0].sources.length, 2, 'and provenance must survive the merge');
  const providers = cam[0].sources.map(s => s.provider).sort().join(',');
  assert.equal(providers, 'fixture-a,fixture-b');
  assert.equal(cam[0].elevationM, 45,
    'the field only one feed had is filled in from the feed that had it');
  assert.equal(cam[0].mergedFrom, 2, 'the merge is declared, not silent');
  assert.ok(cam[0].officialUrl, 'the shared official page is the evidence that allowed it');
});

test('4. merging requires shared-URL evidence, not similar names', () => {
  const a = app();
  const canonical = all(a);
  const cam = canonical.filter(r => /Cambridge Half/.test(r.name));
  assert.equal(cam.length, 2, 'the fixture has the same event from both feeds');
  // Strip the one signal that justifies a merge and the rows must stay apart,
  // even though the names still read like the same race to a human.
  const noUrl = canonical.map(r => {
    const c = {}; Object.keys(r).forEach(k => { c[k] = r[k]; });
    if (/Cambridge/.test(c.name)) c.officialUrl = null;
    return c;
  });
  const merged = a.dedupeRaces(noUrl).filter(r => r.date === '2026-11-08');
  assert.equal(merged.length, 3, 'no evidence, no merge');
  merged.forEach(r => {
    assert.equal(r.mergedFrom, null);
    assert.ok(r.possibleDuplicates >= 1, 'and the athlete is told they may be the same event');
  });
});

test('4. two different races with the same name are two races', () => {
  const a = app();
  const merged = a.dedupeRaces(all(a));
  const riverside = merged.filter(r => r.name === 'Riverside 10K');
  assert.equal(riverside.length, 2, 'Chester and Durham are not one event');
  assert.notEqual(riverside[0].date, riverside[1].date);
});

test('4. same day, same distance, same town, different event stays separate', () => {
  const a = app();
  const merged = a.dedupeRaces(all(a));
  const nov8 = merged.filter(r => r.date === '2026-11-08');
  assert.equal(nov8.length, 2,
    'the charity half and the city half share a date and a town and are not the same race');
  const chariots = nov8.filter(r => /Chariots/.test(r.name))[0];
  assert.ok(chariots, 'the charity half survives as its own row');
  assert.equal(chariots.mergedFrom, null, 'nothing was merged into it');
  assert.ok(chariots.possibleDuplicates >= 1,
    'and it is flagged as a possible duplicate rather than quietly absorbed');
  assert.equal(chariots.sources.length, 1);
});

test('4. identity is not the name, and neither is the merge', () => {
  const code = stripComments(SRC);
  const at = code.indexOf('function raceIdentityKey');
  const body = code.slice(at, code.indexOf('\n}', at));
  assert.ok(!/\.name/.test(body),
    'names differ across feeds and repeat across events; the key must be date, distance and place');
  assert.match(body, /r\.date/);
  assert.match(body, /r\.km/);
  const dd = code.slice(code.indexOf('function dedupeRaces'));
  const ddBody = dd.slice(0, dd.indexOf('\n}\n'));
  assert.ok(!/\.name/.test(ddBody),
    'the deduper must not consult the name at all: a sponsor prefix and a ' +
    'distinguishing name are the same thing to a string comparison');
});

test('4. dedupe is stable and idempotent', () => {
  const a = app();
  const once = a.dedupeRaces(all(a));
  const twice = a.dedupeRaces(a.dedupeRaces(all(a)));
  assert.equal(once.length, twice.length);
  assert.equal(once.map(r => r.name).join('|'), twice.map(r => r.name).join('|'));
});

// ---------------------------------------------------------------------------
// 5. SEARCH — DETERMINISTIC FILTERS
// ---------------------------------------------------------------------------
test('5. distance filters exactly, and a near-miss distance is not the goal', () => {
  const a = app();
  const out = a.searchRaces(all(a), { distanceKey: 'half' }, TODAY);
  assert.ok(out.results.length >= 3);
  out.results.forEach(r => assert.equal(r.race.distanceKey, 'half'));
  const fifteen = a.searchRaces(all(a), {}, TODAY).results
    .filter(r => r.race.name === 'Malvern 15K')[0];
  assert.ok(fifteen, 'a 15K is a real race and stays searchable');
  assert.equal(fifteen.race.distanceKey, null, 'but it is not a 10K');
  assert.equal(fifteen.fit.selectable, false, 'and cannot become a goal');
});

test('5. a date window includes and excludes', () => {
  const a = app();
  const inWindow = a.searchRaces(all(a), { from: '2026-10-01', to: '2026-10-31' }, TODAY);
  assert.ok(inWindow.results.length >= 1);
  inWindow.results.forEach(r => {
    assert.ok(r.race.date >= '2026-10-01' && r.race.date <= '2026-10-31', r.race.date);
  });
  assert.ok(inWindow.rejected.before_window > 0 || inWindow.rejected.after_window > 0,
    'and it must say what it excluded');
});

test('5. "a marathon around October" is a window, not a date', () => {
  const a = app();
  const out = a.searchRaces(all(a),
    { distanceKey: 'full', from: '2026-10-01', to: '2026-10-31' }, TODAY);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].race.name, 'Peak District Trail Marathon');
});

test('5. a radius excludes by geography and never by missing geography', () => {
  const a = app();
  const near = a.searchRaces(all(a),
    Object.assign({ radiusKm: 40, distanceKey: '10k' }, CAMBRIDGE), TODAY);
  const names = near.results.map(r => r.race.name);
  assert.ok(!names.some(n => n === 'Riverside 10K' && false));
  assert.ok(names.indexOf('Riverside 10K') !== -1,
    'Chester has no coordinates, so a radius must not silently hide it');
  const chester = near.results.filter(r => r.race.location === 'Chester')[0];
  assert.equal(chester.fit.distanceFromSearchKm, null);
  assert.ok(chester.fit.caveats.some(c => /No coordinates/.test(c)),
    'and the athlete is told why the distance is blank');
});

test('5. a terrain preference does not discard races whose terrain is unstated', () => {
  const a = app();
  const trail = a.searchRaces(all(a), { terrain: 'trail' }, TODAY);
  trail.results.forEach(r =>
    assert.ok(r.race.terrain === 'trail' || r.race.terrain === 'unknown', r.race.terrain));
  assert.ok(trail.results.some(r => r.race.terrain === 'unknown'),
    'the provider being silent is not the race being unsuitable');
});

test('5. a cancelled race is never a result', () => {
  const a = app();
  const out = a.searchRaces(all(a), {}, TODAY);
  assert.ok(!out.results.some(r => r.race.status === 'cancelled'));
  assert.ok(!out.results.some(r => r.race.name === 'Coastal Half'));
  assert.ok(out.rejected.cancelled >= 1, 'and it is counted as excluded, not lost');
});

test('5. no matches is a bounded answer, not an empty screen', () => {
  const a = app();
  const out = a.searchRaces(all(a),
    { distanceKey: '5k', from: '2027-01-01', to: '2027-01-31' }, TODAY);
  assert.equal(out.results.length, 0);
  assert.ok(Object.keys(out.rejected).length > 0, 'it must be able to say why');
  assert.equal(out.manualEntryAlwaysAvailable, true);
});

test('5. a provider being unavailable is an empty list, not a crash', () => {
  const a = app();
  [undefined, null, []].forEach(input => {
    const out = a.searchRaces(input, { distanceKey: 'half' }, TODAY);
    assert.equal(out.results.length, 0);
    assert.equal(out.manualEntryAlwaysAvailable, true);
  });
});

test('5. search is deterministic', () => {
  const a = app();
  const q = Object.assign({ distanceKey: 'half', radiusKm: 200 }, CAMBRIDGE);
  const one = JSON.stringify(a.searchRaces(all(a), q, TODAY).results.map(r => r.race.providerId));
  for (let i = 0; i < 4; i++)
    assert.equal(JSON.stringify(a.searchRaces(all(a), q, TODAY).results.map(r => r.race.providerId)), one);
});

// ---------------------------------------------------------------------------
// 6. FIT — EXPLAINABLE, AND SILENT WHERE IT DOES NOT KNOW
// ---------------------------------------------------------------------------
test('6. fit answers the question the athlete cannot work out: is there time', () => {
  const a = app();
  const out = a.searchRaces(all(a), { distanceKey: 'full' }, TODAY);
  const soon = out.results.filter(r => r.race.name === 'Autumn Marathon')[0];
  assert.equal(soon.fit.band, 'too_soon');
  assert.ok(soon.fit.caveats.some(c => /less than a full block/.test(c)));
  const peak = out.results.filter(r => r.race.name === 'Peak District Trail Marathon')[0];
  assert.ok(['good', 'workable'].indexOf(peak.fit.band) !== -1, peak.fit.band);
  assert.ok(peak.fit.reasons.some(r => /weeks to prepare/.test(r)));
});

test('6. every reason is a fact, and nothing is called perfect', () => {
  const a = app();
  const said = [];
  a.searchRaces(all(a), Object.assign({ distanceKey: 'half' }, CAMBRIDGE), TODAY)
    .results.forEach(r => { said.push.apply(said, r.fit.reasons); said.push.apply(said, r.fit.caveats); });
  assert.ok(said.length > 5);
  const joined = said.join(' | ');
  [/perfect/i, /ideal race for you/i, /best match/i, /you will/i, /guaranteed/i, /PB/i, /personal best/i]
    .forEach(rx => assert.ok(!rx.test(joined), 'unsupported claim: ' + rx + ' in ' + joined));
});

test('6. a missing elevation is named, never filled in', () => {
  const a = app();
  const out = a.searchRaces(all(a), {}, TODAY);
  const chester = out.results.filter(r => r.race.location === 'Chester')[0];
  assert.equal(chester.race.elevationM, null);
  assert.ok(chester.fit.caveats.some(c => /No elevation data/.test(c)));
  out.results.forEach(r => {
    if (r.race.elevationM == null)
      assert.ok(!r.fit.reasons.some(x => /flat|hilly|elevation|climb/i.test(x)),
        r.race.name + ' described a course it has no data for');
  });
});

test('6. postponed and sold out are stated, not hidden and not fatal', () => {
  const a = app();
  const out = a.searchRaces(all(a), {}, TODAY);
  const post = out.results.filter(r => r.race.name === 'Fenland Marathon')[0];
  assert.ok(post, 'a postponed race is still a race');
  assert.ok(post.fit.caveats.some(c => /postponed/.test(c)));
  const sold = out.results.filter(r => r.race.name === 'Thames Path Half')[0];
  assert.ok(sold.fit.caveats.some(c => /sold out/.test(c)));
  /* Both stay selectable: the source's word on entry status is reported, and
     the product does not claim to know whether a place can still be had. */
  assert.equal(post.fit.selectable, true);
  assert.equal(sold.fit.selectable, true);
});

test('6. ordering is by band then date, and is not a hidden score', () => {
  const a = app();
  const out = a.searchRaces(all(a), { distanceKey: 'full' }, TODAY);
  const bands = out.results.map(r => a.FIT_BAND_ORDER[r.fit.band]);
  for (let i = 1; i < bands.length; i++)
    assert.ok(bands[i] >= bands[i - 1], 'results must be grouped by band');
  out.results.forEach(r => {
    assert.equal(r.fit.score, undefined, 'a single ranking number is what makes paid placement invisible');
  });
});

test('6. a stale record is surfaced as a source date, not a judgement', () => {
  const a = app();
  const stale = a.searchRaces(all(a), {}, TODAY).results
    .filter(r => r.race.name === 'Border Ultra')[0];
  assert.equal(stale.race.sourceUpdatedAt, '2025-02-01',
    'freshness is a fact the surface can act on; the engine does not silently drop it');
});

// ---------------------------------------------------------------------------
// 7. SELECTION MAPS ONTO THE EXISTING GOAL
// ---------------------------------------------------------------------------
test('7. selecting a race writes the three fields Build Your Plan already uses', () => {
  const a = app();
  const out = a.searchRaces(all(a), { distanceKey: 'half' }, TODAY);
  const cam = out.results.filter(r => /Cambridge Half/.test(r.race.name))[0];
  const input = a.raceToPlanInput(cam.race, cam.fit);
  assert.equal(input.distanceKey, 'half');
  assert.equal(input.raceDate, '2026-11-08');
  assert.equal(input.hasEvent, true);
  assert.ok(a.DISTANCE_PROFILES[input.distanceKey], 'and the key must be one the generator knows');
});

test('7. an unselectable race cannot become a goal', () => {
  const a = app();
  const races = a.dedupeRaces(all(a));
  const cancelled = races.filter(r => r.status === 'cancelled')[0];
  assert.ok(cancelled);
  assert.equal(a.raceToPlanInput(cancelled, null), null, 'a cancelled race is not a goal');
  const fifteen = races.filter(r => r.name === 'Malvern 15K')[0];
  assert.equal(a.raceToPlanInput(fifteen, null), null, 'nor is an unmappable distance');
  const past = { date: '2020-01-01', distanceKey: 'half', status: 'scheduled', km: 21.1 };
  assert.equal(a.raceToPlanInput(past, a.raceFit(past, {}, TODAY)), null, 'nor is a race in the past');
});

test('7. the goal-race metadata is provenance, not a second plan', () => {
  const a = app();
  const cam = a.searchRaces(all(a), { distanceKey: 'half' }, TODAY)
    .results.filter(r => /Cambridge Half/.test(r.race.name))[0];
  const g = a.raceToPlanInput(cam.race, cam.fit).goalRace;
  ['name', 'provider', 'providerId', 'officialUrl', 'terrain', 'sourceUpdatedAt', 'selectedAt']
    .forEach(k => assert.ok(k in g, 'goalRace must carry ' + k));
  /* And nothing the generator reads. distanceKey and raceDate live at the top
     level, where they already lived; goalRace must not shadow them. */
  assert.equal(g.distanceKey, undefined);
  assert.equal(g.raceDate, undefined);
});

test('7. a selected race survives normal plan persistence', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const cam = a.searchRaces(all(a), { distanceKey: 'half' }, TODAY)
    .results.filter(r => /Cambridge Half/.test(r.race.name))[0];
  const input = a.raceToPlanInput(cam.race, cam.fit);
  a.state.setup.goalRace = input.goalRace;
  a.persistStateLocalOnly();

  const b = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  b.localStorage.setItem(b.STORAGE_KEY, a.localStorage.getItem(a.STORAGE_KEY));
  b.loadState();
  /* The merged row is the more complete of the two feeds' records -- feed A
     carried an elevation and feed B did not -- so that is the name and the
     provenance that must come back out of storage unchanged. */
  assert.equal(b.state.setup.goalRace.name, 'Cambridge Half Marathon');
  assert.equal(b.state.setup.goalRace.provider, 'fixture-a');
  assert.equal(b.state.setup.goalRace.elevationM, 45);
  assert.equal(b.state.setup.goalRace.officialUrl, 'https://example-cambridgehalf.test/');
});

test('7. plan rendering never depends on the provider', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const withRace = a.renderTodayView().length;
  a.state.setup.goalRace = { v: 1, name: 'X', provider: 'gone', providerId: 'x' };
  assert.ok(a.renderTodayView().length > 0, 'a plan renders with race metadata attached');
  delete a.state.setup.goalRace;
  assert.equal(a.renderTodayView().length, withRace,
    'and renders identically without it — no surface reads goalRace today');
});

// ---------------------------------------------------------------------------
// 8. CHANGING THE RACE DESCRIBES, IT DOES NOT REBUILD
// ---------------------------------------------------------------------------
test('8. changing the race reports the consequence and rebuilds nothing', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  a.state.days.filter(d => d.date < a.addDays(TODAY, 20) && d.type !== 'rest').slice(0, 3)
    .forEach(d => { d.completed = true; d.actual = Object.assign(a.emptyActual(), { km: d.km, pace: '5:00' }); });
  const before = JSON.stringify(a.state);

  const marathon = a.dedupeRaces(all(a)).filter(r => r.name === 'Peak District Trail Marathon')[0];
  const impact = a.raceChangeImpact(marathon, TODAY);
  assert.equal(impact.distanceChanges, true);
  assert.equal(impact.requiresRegeneration, true);
  assert.match(impact.warning, /different distance means a different block/);
  assert.equal(impact.completedSessions, 3, 'the athlete is told what is at stake');
  assert.match(impact.historyPreserved, /never deleted/);
  assert.equal(JSON.stringify(a.state), before, 'and nothing was rebuilt or touched');
});

test('8. the same race is not a change', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  a.state.setup.raceDate = '2026-11-08';
  const impact = a.raceChangeImpact({ date: '2026-11-08', distanceKey: 'half' }, TODAY);
  assert.equal(impact.requiresRegeneration, false);
  assert.equal(impact.warning, null);
});

// ---------------------------------------------------------------------------
// 8b. THE BUILD YOUR PLAN STEP — MANUAL ENTRY IS NEVER TAKEN AWAY
// ---------------------------------------------------------------------------
test('8b. the step is a view model, not a screen', () => {
  const a = app();
  const m = a.raceFinderStepModel(all(a), { distanceKey: 'half' }, TODAY);
  assert.equal(m.heading, 'Find your race');
  assert.ok(!/\.$/.test(m.heading), 'a heading takes no terminal full stop');
  assert.ok(m.results.length >= 3);
  assert.ok(m.selectableCount >= 1);
  assert.equal(m.orderedBy, 'fit band, then date');
  const code = stripComments(SRC);
  const at = code.indexOf('function raceFinderStepModel');
  const body = code.slice(at, code.indexOf('\n}\n', at));
  ['document', 'innerHTML', 'fetch(', 'state.setup ='].forEach(bad =>
    assert.ok(body.indexOf(bad) === -1, 'the step model must not ' + bad));
});

test('8b. manual entry is present in every state, including the good ones', () => {
  const a = app();
  const states = [
    a.raceFinderStepModel(all(a), { distanceKey: 'half' }, TODAY),   // works well
    a.raceFinderStepModel([], { distanceKey: 'half' }, TODAY),       // no provider
    a.raceFinderStepModel(all(a), { distanceKey: '5k' }, TODAY),     // no matches
    a.raceFinderStepModel(all(a), { from: '2030-01-01' }, TODAY),    // nothing in window
    a.raceFinderStepModel(null, null, TODAY)                         // called with nothing
  ];
  states.forEach(m => {
    assert.equal(m.manualEntry.available, true,
      'a provider Valhalla does not control must never be able to block a plan');
    assert.equal(m.manualEntry.writes.join(','), 'distanceKey,raceDate',
      'and it writes the fields that already existed, not a second goal');
  });
});

test('8b. an empty result set is an explained state, not a blank screen', () => {
  const a = app();
  const noSource = a.raceFinderStepModel([], { distanceKey: 'half' }, TODAY);
  assert.equal(noSource.emptyReason, 'no_source');
  assert.ok(noSource.emptyMessage && noSource.emptyMessage.length > 0);
  const noMatch = a.raceFinderStepModel(all(a), { distanceKey: '5k' }, TODAY);
  assert.equal(noMatch.emptyReason, 'no_matches');
  const fine = a.raceFinderStepModel(all(a), { distanceKey: 'half' }, TODAY);
  assert.equal(fine.emptyReason, null);
  assert.equal(fine.emptyMessage, null);
  /* No internal jargon, no provider names, no ids in anything athlete-facing. */
  [noSource, noMatch].forEach(m =>
    ['fixture', 'provider', 'null', 'undefined', 'canonical'].forEach(bad =>
      assert.ok(m.emptyMessage.toLowerCase().indexOf(bad) === -1,
        'athlete-facing text leaked "' + bad + '"')));
});

test('8b. there is no promoted slot for anyone to buy', () => {
  const a = app();
  const m = a.raceFinderStepModel(all(a), { distanceKey: 'half' }, TODAY);
  assert.equal(m.promoted, null);
  const code = stripComments(SRC);
  const at = code.indexOf('var RACE_FINDER_VERSION');
  const region = code.slice(at, code.indexOf('function planHasEvent', at));
  [/sponsor(ed)?[A-Za-z]*\s*[:=]/, /promoted\s*:(?!\s*null\b)/, /featured/i, /boost/i, /\bpaid\b/i, /priority\s*[:=]/]
    .forEach(rx => assert.ok(!rx.test(region),
      'race matching must not become pay-to-win: ' + rx));
  /* And the ordering has no numeric score a deal could be added to. */
  m.results.forEach(x => assert.equal(x.fit.score, undefined));
});

test('8b. possible duplicates are surfaced to the step, not resolved by it', () => {
  const a = app();
  const m = a.raceFinderStepModel(all(a), { distanceKey: 'half' }, TODAY);
  assert.ok(m.possibleDuplicateGroups >= 1,
    'the Cambridge pair share a date, a distance and a town and the engine refused to guess');
});

// ---------------------------------------------------------------------------
// 9. THE EXECUTION STRATEGY SEAM IS A SEAM, NOT A COUPLING
// ---------------------------------------------------------------------------
test('9. course context is available and nothing consumes it', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'full' });
  assert.equal(a.goalRaceCourseContext(), null, 'no race, no context');
  a.state.setup.goalRace = { v: 1, name: 'Peak', terrain: 'trail', elevationM: 1180, km: 42.2 };
  const ctx = a.goalRaceCourseContext();
  assert.equal(ctx.terrain, 'trail');
  assert.equal(ctx.elevationM, 1180);
  assert.equal(ctx.profile, null, 'one elevation number is not a course profile');

  const code = stripComments(SRC);
  const users = code.split('goalRaceCourseContext(').length - 1;
  assert.equal(users, 1, 'defined once and called nowhere — a seam, not a dependency');
});

// ---------------------------------------------------------------------------
// 10. NOTHING ELSE MOVED
// ---------------------------------------------------------------------------
test('10. the existing haversine is defined once and still serves its own caller', () => {
  const a = app();
  assert.equal((SRC.match(/function haversineKm\(/g) || []).length, 1,
    'a second copy of the same trigonometry is how two answers to one question start');
  assert.equal(a.raceDistanceFromKm(51.5074, -0.1278, 52.2053, 0.1218), 79.5);
  assert.equal(a.raceDistanceFromKm(null, 0, 1, 1), null);
  assert.ok(Math.abs(a.haversineKm(51.5074, -0.1278, 52.2053, 0.1218) - 79.47) < 0.1,
    'and the raw function keeps its unrounded contract for the route summer');
});

test('10. no Serverless Function, no flag change, no schema change', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => /\.js$/.test(f) && f.charAt(0) !== '_');
  assert.equal(fns.length, 12, 'Race Finder adds no function in this prototype');
  const access = fs.readFileSync(path.join(ROOT, 'api/_access.js'), 'utf8');
  assert.match(access, /flagOn\(process\.env\.VVV_ACCOUNT_REQUIRED\)/);
  assert.match(access, /flagOn\(process\.env\.VVV_COMMERCIAL_REQUIRED\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'supabase-commercial-activation.sql'), 'utf8'),
    /select 'no'::text/);
  assert.match(fs.readFileSync(path.join(ROOT, 'supabase-beta-gate.sql'), 'utf8'),
    /create trigger beta_allowlist_gate/);
});

test('10. an existing plan with no race metadata is completely unaffected', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half' });
  const sig = a.planContentSignature(a.state);
  a.searchRaces(all(a), { distanceKey: 'half' }, TODAY);
  a.dedupeRaces(all(a));
  assert.equal(a.planContentSignature(a.state), sig, 'searching must not touch the plan');
  assert.equal(a.state.setup.goalRace, undefined);
});
