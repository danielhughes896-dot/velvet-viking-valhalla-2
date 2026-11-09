'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THIS WEEK TAKES TODAY'S HIERARCHY, AND THE CARD TAKES THE GESTURE.
 * ===========================================================================
 * The session is the hero on this screen too, so it is shown the same way
 * rather than as a smaller imitation: one arm added to the focused-session
 * selector instead of a second set of rules that can drift from it.
 * And the week is swiped on the CARD, not on the day circles -- a row of
 * 44px targets is a poor thing to drag, and the card is the thing being
 * read. Committing goes through the same handleWeekPickDay() a tapped
 * circle goes through, so there is one selected date and every part of the
 * screen reads it.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const rule = sel => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const i = bare.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return bare.slice(i + sel.length + 1, bare.indexOf('}', i));
};
function app(){
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.replaceCard = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k',
    volume: 40, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  return a;
}

test('nothing on This Week is a lifted card any more', () => {
  /* The week is context and the week's shape is a reading; two rimmed boxes
     either side of the session is the arrangement that says otherwise. Each
     keeps every word and colour it had and gives up only the rim and the
     lift -- the same trade Today made. */
  ['.wk-session', '.wk-hero', '.wk-summary > .zone-card'].forEach(sel => {
    const r = rule(sel);
    assert.match(r, /background:none/, sel + ' has its fill back');
    assert.match(r, /border:0/, sel + ' has its rim back');
    assert.match(r, /box-shadow:none/, sel + ' is lifted again');
  });
});

test('the week lays out every day and moves the row, not the content', () => {
  const a = app();
  const w = a.currentWeekNum();
  const days = a.weekSessionDays(w);
  const html = a.renderWeekDayTrack(w);
  assert.equal((html.match(/class="wk-slide"/g) || []).length, days.length,
    'the track no longer holds one slide per day of the week');
  assert.match(html, /data-hswipe="1"/,
    'without data-hswipe the view pager claims the card and a day swipe changes tab');
  assert.match(html, /data-count="' \+ days\.length|data-count="\d/,
    'the track no longer declares how many days it holds');
  /* Flex items in one row, so every slide is as tall as the tallest and the
     card is a fixed box -- the zone breakdown below must not move as the
     week is swiped, which is the lesson the coaching rail learned. */
  assert.match(rule('.wk-slide'), /flex:0 0 100%/, 'a slide is no longer the full card width');
  assert.match(rule('.wk-track'), /display:flex/, 'the track is no longer one row');
  assert.match(rule('.view-week .wk-rail'), /overflow:hidden/, 'the track is no longer clipped');
  assert.match(rule('.view-week .wk-rail'), /touch-action:pan-y/,
    'the card takes the horizontal gesture and must leave vertical to the page');
});

test('every ring in the track paints with its own gradient', () => {
  /* url(#th-grad) against <linearGradient id="th-grad"> is a CONSTANT in the
     shared hero markup. Seven summaries in one document would mean seven
     elements sharing that id and every url() resolving to the first -- the
     exact failure recorded when the summary and the hidden full card both
     carried it: a visibly empty ring in a box of the right size. */
  const a = app();
  const html = a.renderWeekDayTrack(a.currentWeekNum());
  const ids = (html.match(/<linearGradient id="([^"]+)"/g) || []);
  const uniq = new Set(ids);
  assert.equal(uniq.size, ids.length,
    'two slides share a gradient id, so one of the rings will paint with nothing');
  assert.equal(html.indexOf('url(#th-grad)'), -1,
    'a slide still points at the shared gradient id');
  assert.ok(ids.length > 0, 'no slide renders a ring at all');
});

test('a swipe steps one day and stops at both ends of the week', () => {
  const a = app();
  const w = a.currentWeekNum();
  const days = a.weekSessionDays(w);
  a.weekSelectedDate = days[0].date;
  assert.equal(a.weekStepDate(w, -1), null, 'swiping back from the first day rolls somewhere');
  assert.equal(a.weekStepDate(w, 1), days[1].date, 'forward does not step exactly one day');
  a.weekSelectedDate = days[days.length - 1].date;
  assert.equal(a.weekStepDate(w, 1), null, 'swiping past the last day rolls into next week');
  assert.equal(a.weekStepDate(w, -1), days[days.length - 2].date, 'back does not step exactly one day');
});

test('the card and the day circles cannot disagree', () => {
  /* Committing calls the same handler a tapped circle calls, so the circles,
     the badges and the full session underneath all read one selected date
     rather than each deriving their own. */
  /* ---- THE PAGER IS NOW SHARED, SO THE LAW IS READ IN TWO PLACES ----
     Full Plan's phase carousel is the same mechanism, so "full-width slides
     that track the finger, resist at the ends and settle before the
     re-render" is wirePagerRail() and nothing else. What makes it a WEEK
     carousel is the commit wireWeekRail() hands it, and that is what the
     first half of this test reads. */
  const fn = /function wireWeekRail\(rail\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(fn, /handleWeekPickDay\(to\)/,
    'the swipe sets the date by some other route than the tap does');
  /* THE RAIL'S OWN WEEK, not the athlete's. These were the same thing
     while This Week was the only screen with a carousel; Full Plan's week
     screen has one now, and there a swipe stepped within the CURRENT week,
     returned a date that was not in the week on screen, and the card did
     not move at all. */
  assert.match(fn, /weekStepDate\(railWeek, dir\)/,
    'the swipe no longer steps exactly one day in the direction of the finger');
  assert.match(fn, /data-week/, 'the swipe has stopped reading the week the rail is showing');
  /* AND IT IS ONE PAGER. Two copies is how the week's carousel and the
     plan's drift into two different gestures. */
  assert.equal((SRC.match(/function wirePagerRail\(/g) || []).length, 1,
    'there is more than one full-width pager implementation');
  assert.match(SRC, /function wireWeekRail\(rail\)\{\s*\n\s*wirePagerRail\(rail, 'week',/,
    'the week rail stopped going through the shared pager');
  assert.match(SRC, /function wirePhaseRail\(rail\)\{\s*\n\s*wirePagerRail\(rail, 'phase',/,
    'the phase carousel stopped going through the shared pager');

  const pager = /function wirePagerRail\(rail, learnKey, planCommit\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(pager, /Math\.abs\(p\.dx\) > w \* PAGER_COMMIT_FRACTION/,
    'the card commits on a different threshold from the rest of the product');
  /* Settle to where the new slide will sit, THEN re-render: the fresh track
     is built at that offset, so the swap lands on the pixel the animation
     finished on. Reversing these is what makes a pager jump. */
  const settle = pager.indexOf('setX(base() + (p.dx < 0 ? -w : w));');
  const render = pager.indexOf('commit()');
  assert.ok(settle > -1 && render > settle,
    'the slide is swapped before the card has finished moving to it');
  /* THE ENDS RESIST RATHER THAN STOPPING DEAD, and a commit the rail has no
     neighbour for is refused rather than wrapping round. */
  assert.match(pager, /atEnd \? dx \* 0\.25 : dx/, 'the end-of-rail resistance is gone');
  assert.match(pager, /if \(!commit\)\{ setX\(base\(\)\); return; \}/,
    'a swipe with nothing beyond it no longer springs back');
});

/* NOTHING BELOW THE CARD MOVES WHEN THE DAY CHANGES.
 * ===========================================================================
 * The slides are align-items:stretch, so the rail is one height for the whole
 * week whichever day is showing. The "View full session" button is NOT in the
 * rail -- it sits under it -- and it used to be dropped entirely on a rest
 * day, because a rest day has no full session to open. That took 54px out of
 * the page on exactly those days: the zone breakdown and everything beneath
 * it rose as the athlete swiped onto a rest day and snapped back as they
 * swiped off it. Measured in Chromium before the fix, the breakdown sat at
 * y=611 on a session day and y=557 on the rest day between them.
 * The slot is now held by the button itself, hidden. Asserting the markup is
 * what this file can do; the pixel claim is the reason it matters.
 */
test('a rest day holds the session button\'s slot instead of collapsing it', () => {
  const a = app();
  const w = a.currentWeekNum();
  const days = a.weekSessionDays(w);
  const rest = days.filter(d => d.type === 'rest')[0];
  /* A DAY THAT STILL HAS SOMETHING TO OPEN. Founder: "On easy sessions the
     view full session isnt needed" -- a solo-note day's button is ghosted
     for the same reason a rest day's is, so picking the week's first
     non-rest day now picks a ghost about half the time. This law is about
     the slot being HELD on a day with nothing to open and OFFERED on a day
     with something, so it needs the latter. */
  const work = days.filter(d => d.type !== 'rest' && !a.soloNoteSession(d))[0];
  assert.ok(rest && work, 'this fixture week needs both a rest day and a session day');

  a.weekSelectedDate = work.date;
  const onWork = a.renderWeekSessionBox(w);
  a.weekSelectedDate = rest.date;
  const onRest = a.renderWeekSessionBox(w);

  // The box is present on BOTH days -- that is the whole fix.
  /* MATCHED AS TOKENS IN A CLASS LIST, not as the whole attribute. These
     read class="wk-open" and class="wk-open is-ghost" exactly, and broke
     the day the button gained .sess-nav -- the shared treatment Race Day's
     way-in and this one now both wear. Nothing about the slot changed; the
     assertion was just pinned to a string that was never the claim. */
  const hasClass = (html, cls) =>
    new RegExp('class="[^"]*\\b' + cls + '\\b[^"]*"').test(html);
  /* ---- EVERY DAY GHOSTS IT NOW, WHICH IS WHY THE SLOT MATTERS MORE ----
     This compared a session day (button offered) with a rest day (button
     held but ghosted). The founder has since taken the button off every day
     but race -- the slide carries the full session -- so the comparison has
     no two sides left in this fixture. What it was really protecting is
     unchanged and is what is asserted: the BOX is there on both, so the
     zone breakdown below it cannot move as the athlete swipes the week. */
  /* ---- THE CLAIM IS STABILITY, NOT A GHOST ON EVERY DAY ----
     What this protects, in its own words above: "the BOX is there on both,
     so the zone breakdown below it cannot move as the athlete swipes the
     week." A week where EVERY day holds the slot satisfies that. So does a
     week where NO day has it -- and that is what weeks with no race day in
     their carousel now do, because there the button can never appear and
     the reserved box was 65px of nothing under the rail. Founder: "There's
     a weird gap between the bottom of the rail and the bar."
     WHAT WOULD BREAK IT is a week that disagrees with itself: some days
     holding the box and some not, so the breakdown steps up and down under
     a finger mid-swipe. That is what is asserted, across every week of the
     block rather than one. */
  const agree = (w) => {
    const ds = a.weekCarouselDays(w);
    const has = ds.map(d => { a.weekSelectedDate = d.date;
      return hasClass(a.renderWeekSessionBox(w), 'wk-open'); });
    return { w, n: ds.length, yes: has.filter(Boolean).length };
  };
  let steady = 0;
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    const r = agree(w);
    if (!r.n) continue;
    assert.ok(r.yes === 0 || r.yes === r.n,
      'week ' + r.w + ' holds the session box on ' + r.yes + ' of its ' + r.n +
      ' days, so the zone breakdown moves as the week is swiped');
    steady++;
  }
  assert.ok(steady >= 10, 'only ' + steady + ' weeks were checked');
  /* ---- AND THE "NONE" HALF, WHICH IS THE FOUNDER'S GAP ----
     The law above is satisfied by all-or-none, so it passes just as happily
     with the box reserved on every week -- which is the state that was
     reported: "There's a weird gap between the bottom of the rail and the
     bar", measured at 65px of a button with visibility:hidden. Caught by
     mutation: forcing the box back on every week left every other guard in
     this file green. This is the half that says a week which can never
     reveal the button reserves nothing for it. */
  let bare = 0;
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    const ds = a.weekCarouselDays(w);
    if (!ds.length || ds.some(d => d.type === 'race')) continue;
    ds.forEach(d => {
      a.weekSelectedDate = d.date;
      assert.equal(hasClass(a.renderWeekSessionBox(w), 'wk-open'), false,
        'week ' + w + ' ' + d.date + ': reserves a box for a button no swipe in ' +
        'this week can ever reveal');
    });
    bare++;
  }
  assert.ok(bare >= 10, 'only ' + bare + ' week(s) without a race were checked');
  /* AND THE WEEK THAT KEEPS IT KEEPS IT GHOSTED on every day but race --
     held, never offered, because the slide already shows the session. */
  const raceDay = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(raceDay, 'the block builds no race day, so the exception is untested');
  const rw = raceDay.week;
  a.weekCarouselDays(rw).filter(d => d.type !== 'race').forEach(d => {
    a.weekSelectedDate = d.date;
    const html = a.renderWeekSessionBox(rw);
    assert.ok(hasClass(html, 'wk-open'),
      d.date + ': race week stopped reserving the box, so swiping onto the race jumps the page');
    assert.ok(hasClass(html, 'is-ghost'),
      d.date + ': a day is offering to open a session the slide is already showing');
  });
  a.weekSelectedDate = rest.date;

  /* Held, not offered. A rest day has nothing to open, so the reserved box
     must not be reachable by pointer, by tab, or by the delegated handler. */
  /* READ THE HELD SLOT WHERE ONE IS STILL HELD. onRest comes from the
     current week, which has no race in its carousel and therefore no box to
     reserve; the slot's own properties are unchanged and are checked on the
     week that still has one. */
  a.weekSelectedDate = a.weekCarouselDays(rw).filter(d => d.type !== 'race')[0].date;
  const onHeld = a.renderWeekSessionBox(rw);
  const ghostM = /<button[^>]*class="[^"]*\bis-ghost\b[^"]*"[^>]*>/.exec(onHeld);
  assert.ok(ghostM, 'no held slot in the markup at all');
  const ghost = ghostM[0];
  assert.doesNotMatch(ghost, /data-action=/, 'the held slot can still be fired');
  assert.doesNotMatch(ghost, /data-date=/, 'the held slot names a day to open');
  assert.match(ghost, /aria-hidden="true"/, 'the held slot is announced to a screen reader');
  assert.match(ghost, /tabindex="-1"/, 'the held slot is still in the tab order');

  /* visibility, never display: display:none would collapse the box and put
     back the exact 54px jump this exists to remove. */
  assert.match(rule('.wk-open.is-ghost'), /visibility:hidden/,
    'the held slot is hidden by some rule other than visibility');
  assert.doesNotMatch(rule('.wk-open.is-ghost'), /display:\s*none/,
    'display:none collapses the slot, which is the bug');
});

test('an open session always keeps a way back out', () => {
  /* The ghost is for the COLLAPSED rest day only. If a rest day is ever open,
     a hidden "Hide full session" would be a trap with no exit. */
  const a = app();
  const w = a.currentWeekNum();
  const rest = a.weekSessionDays(w).filter(d => d.type === 'rest')[0];
  a.weekSelectedDate = rest.date;
  a.weekSessionOpen = true;
  const html = a.renderWeekSessionBox(w);
  assert.doesNotMatch(html, /is-ghost/, 'an open rest day hides its own way out');
  assert.match(html, /Hide full session/, 'an open day offers no way back');
});

/* A GESTURE IS TAUGHT ONCE, THEN THE TEACHING GOES.
 * ===========================================================================
 * Nothing about a full-bleed card says it answers to a horizontal drag, so
 * every swipeable region announces itself. But an affordance that stays
 * forever is chrome: the athlete who has swiped once knows, and the hint is
 * then a line of text taking room from the thing it pointed at. So each
 * region is taught until it is used, per region -- learning the week card
 * does not teach you the tab pager -- and the state is stored, because the
 * whole point is that it survives the next launch.
 */
test('HINT: every swipeable region announces itself, and stops once it is used', () => {
  const a = app();
  const fresh = k => a.swipeHintHtml(k, 'Swipe');
  ['pager', 'rail', 'week'].forEach(k => {
    assert.match(fresh(k), /class="swipe-hint"/, k + ' never announces itself');
    assert.match(fresh(k), new RegExp('data-hint="' + k + '"'), k + ' is not named in its hint');
  });

  // learning one must not retire the others
  a.swipeMarkLearned('week');
  assert.equal(fresh('week'), '', 'the week card goes on teaching after it has been used');
  assert.match(fresh('pager'), /class="swipe-hint"/,
    'learning the week card silently retired the tab pager hint too');
  assert.match(fresh('rail'), /class="swipe-hint"/,
    'learning the week card silently retired the rail hint too');

  // and it is remembered, not held for this render only
  assert.match(SRC, /writeStored\(SWIPE_LEARNED_KEY, all\)/,
    'what was learned is not stored, so it is forgotten at the next launch');
});

test('the rail dots are a POSITION and do not retire', () => {
  /* THIS TEST USED TO SAY THE OPPOSITE: "the dots under the coaching rail
     are that rail's hint, and retire with it -- three grey dots under the
     thing they point at, forever, is the exact chrome this mechanism exists
     to remove." That was right while a rail showed three panels at 33% with
     a fourth peeking: the geometry said "there is more sideways" and the
     dots only had to teach the gesture once.
     Every rail is one full-width card now, on the founder's call. Nothing
     is visible beside the panel you are on, so the dots are the only thing
     saying which of five it is and how many there are. A position
     indicator that disappears once you know how to swipe is a worse card,
     not a cleaner one -- so they stay, and this asserts that they do.
     THE SWIPE HINT STILL RETIRES. "Swipe for another day" is a hint and is
     unchanged; the guard above this one still holds it to that. */
  const i = SRC.indexOf("'<div class=\"how-dots\"");
  assert.ok(i > -1, 'the rail dots renderer could not be found');
  const before = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').slice(0, SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').indexOf("'<div class=\"how-dots\""));
  const fn = before.slice(before.lastIndexOf('function railDotCount'));
  assert.ok(fn.indexOf("swipeLearned('rail')") === -1,
    'the dots retire again — on a full-width rail they are the position, not the hint');
  assert.match(fn, /if \(n < 2\) return '';/,
    'a single-panel rail is drawing a dot, which indicates nothing');
});

test('HINT: each region marks itself learned from its own commit', () => {
  /* The mark is taken where the swipe actually succeeds, not where it
     starts -- an abandoned drag teaches nothing and must not retire the
     hint that would have helped next time. */
  assert.match(SRC, /function pagerFinish\(commit\)\{[\s\S]{0,200}?if \(commit\) swipeMarkLearned\('pager'\)/,
    'the tab pager retires its hint on an abandoned drag, or not at all');
  /* The shared pager takes the mark with the key the rail was wired with --
     'week' for the week card, 'phase' for the plan's carousel -- and takes
     it immediately before the commit runs, which is the only place the
     swipe is known to have succeeded.
     ONCE, AND AFTER THE EARLY RETURN. Asserting the right call EXISTS is not
     the law: a second swipeMarkLearned() higher up the handler retires the
     hint on a drag that sprang back, and the match below would still pass.
     Caught by mutation -- adding one line above the threshold left every
     guard in this file green. */
  const pg = /function wirePagerRail\(rail, learnKey, planCommit\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.equal((pg.match(/swipeMarkLearned\(/g) || []).length, 1,
    'the pager retires its hint in more than one place, so an abandoned drag can retire it');
  assert.ok(pg.indexOf('swipeMarkLearned(learnKey)') > pg.indexOf('if (!commit){ setX(base()); return; }'),
    'the hint is retired before the commit is known to have happened, so a drag that ' +
    'sprang back teaches the athlete nothing and retires the hint anyway');
  /* ---- THE RELATIONSHIP, NOT THE FORMATTING ----
     This pinned the whole line, "window.setTimeout(function(){ commit();",
     and broke the first time that callback grew a second statement -- the
     fade suppression a committed rail swipe now raises. The law is that the
     mark is taken immediately before the timeout that commits, and that the
     timeout really is the one that commits; neither depends on the body
     being written on one line. */
  assert.match(pg, /swipeMarkLearned\(learnKey\);\s*\n\s*window\.setTimeout\(function\(\)\{/,
    'the hint is no longer retired immediately before the committing timeout');
  const after = pg.slice(pg.indexOf('swipeMarkLearned(learnKey);'));
  const body = after.slice(after.indexOf('window.setTimeout('));
  assert.ok(body.indexOf('commit();') > -1,
    'the timeout the hint is marked against is not the one that commits');

  /* ---- AND ITS DELAY IS THE STYLESHEET'S, NOT A SECOND COPY OF IT ----
     THIS PINNED "}, 240)". That number had a twin in the stylesheet --
     .wk-track.is-settling's transition -- and the two were only ever equal
     by hand: shorten the animation and the commit waits after the slide has
     stopped; shorten the timer and it re-renders mid-flight, which is the
     jump the whole settle-then-swap ordering exists to prevent. Founder:
     "can this be made as small as possible" -- which is a change to a
     number that lived in two places.
     ONE TOKEN NOW, asserted as the relationship: the timeout reads it, the
     transition reads it, and reduced motion sets it to zero. Any of the
     three breaking is a drift this would have missed. */
  assert.match(body, /\},\s*pagerSettleMs\(\)\)/,
    'the committing timeout carries its own delay again instead of the shared settle');
  const fn = /function pagerSettleMs\(\)\{[\s\S]*?\n\}/.exec(SRC);
  assert.ok(fn, 'pagerSettleMs() is gone, so the timeout has no token to read');
  assert.match(fn[0], /--pager-settle/,
    'pagerSettleMs() no longer reads the stylesheet\u2019s own settle token');
  assert.match(CSS, /\.wk-track\.is-settling\{transition:transform var\(--pager-settle\)/,
    'the settling track no longer takes its duration from the shared token');
  /* REDUCED MOTION WAITED LONGEST, FOR NOTHING. The transition was already
     killed there while the commit sat on the full timer, so the one athlete
     who asked for no animation got the longest delay in the app. */
  const rm = /@media \(prefers-reduced-motion: reduce\)\{[\s\S]{0,240}?--pager-settle:\s*0m?s/.exec(CSS);
  assert.ok(rm, 'reduced motion no longer zeroes the settle, so it waits for an animation it does not run');
  assert.match(SRC, /wirePagerRail\(rail, 'week',/, 'the week card lost its own hint key');
  assert.match(SRC, /wirePagerRail\(rail, 'phase',/, 'the phase carousel lost its own hint key');
  assert.match(SRC, /if \(animate\) swipeMarkLearned\('rail'\)/,
    'the rail retires its hint on its own initial placement, not on a swipe');
});
