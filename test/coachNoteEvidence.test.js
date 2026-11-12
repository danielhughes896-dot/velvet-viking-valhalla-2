'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE WRITTEN COACH'S NOTE, AND THE EVIDENCE BEHIND IT.

   Founder: "Surface the evidence-aware coaching observations already
   produced by SACORO. Ensure observations reflect the athlete's actual
   training history, recovery, check-ins and relevant coaching decisions. Do
   not invent observations or imply evidence that does not exist. When
   evidence is insufficient, retain appropriate session guidance rather than
   manufacturing personalisation. Do not introduce a new AI API call."

   And the validation asked for: "Test the same prescribed session against
   contrasting athlete histories: improving, strained, missed training, pain,
   heavy legs and insufficient data. The written Coach's Note must reflect
   meaningful differences without contradicting the coaching engine."

   So one session -- a progressive tempo on 5 November -- and seven athletes
   about to run it. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const TODAY = '2026-11-05';

function quiet(a){
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
function athlete(today){
  const a = quiet(loadApp({ pinnedDate: (today || TODAY) + 'T09:00:00Z' }));
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-10-06' });
  return a;
}
/* The same athlete, the same stored state, a later morning. */
function carry(a, date){
  const b = quiet(loadApp({ pinnedDate: date + 'T09:00:00Z' }));
  b.state = JSON.parse(JSON.stringify(a.state));
  return b;
}
const past = (a, today) => a.state.days.filter(d => d.type !== 'rest' && d.date < (today || TODAY));
const relog = (a, d) => { delete d.coachReview; a.coachPersistReview(d); };
const HISTORY = {
  improving(a){ const p = past(a); p.forEach((d, i) => logAsPrescribed(a, d, { quality: i < p.length / 2 ? 0.86 : 1 })); },
  steady(a){ past(a).forEach(d => logAsPrescribed(a, d, { quality: 1 })); },
  strained(a){
    const p = past(a); p.forEach(d => logAsPrescribed(a, d, { quality: 1 }));
    p.slice(-5).forEach(d => {
      const band = a.expectedRPEBand(d) || [5, 7];
      d.actual.rpe = Math.min(10, band[1] + 2);
      const z = a.executionHRTarget(d); if (z && z.hi) d.actual.hr = z.hi + 8;
      relog(a, d);
    });
  },
  missed(a){ past(a).slice(0, -5).forEach(d => logAsPrescribed(a, d, { quality: 1 })); },
  pain(a){
    const p = past(a); p.forEach(d => logAsPrescribed(a, d, { quality: 1 }));
    p.slice(-2).forEach(d => { d.actual.hurting = 'pain'; relog(a, d); });
  },
  heavyLegs(a){
    past(a).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
    a.state.readiness = { date: TODAY, legs: 'heavy', sleep: 'good', health: 'good' };
  },
  noData(){},
};
const make = name => { const a = athlete(); HISTORY[name](a); return a; };
const session = a => a.state.days.filter(d => d.date === TODAY)[0];
const text = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const observationOnCard = card => {
  const m = card.match(/<span class="[^"]*\b(why-session-o|how-note-obs|hn-obs)\b[^"]*">([\s\S]*?)<\/span>/g) || [];
  return m.map(text);
};
const body = name => {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  assert.ok(at !== -1, name + ' is gone');
  return SRC.slice(at, SRC.indexOf('\n}\n', at));
};

// ---------------------------------------------------------------------------
// ONE SESSION, SEVEN ATHLETES
// ---------------------------------------------------------------------------

test('the same session reads differently to seven athletes, and only where the evidence differs', () => {
  const said = {}, why = {}, title = {};
  Object.keys(HISTORY).forEach(name => {
    const a = make(name), dd = session(a);
    title[name] = dd.title + '|' + dd.km;
    const card = a.renderDayCard(dd);
    const on = observationOnCard(card);
    assert.ok(on.length <= 1, name + ': the observation is drawn ' + on.length + ' times');
    said[name] = on[0] || '';
    assert.equal(said[name], text(a.escapeHtml(a.coachObservation(dd))), name + ': the card and the engine disagree');
    why[name] = text((card.match(/<span class="why-session-v">[\s\S]*?<\/span>/) || [''])[0]);
  });
  /* It IS the same prescribed session, with the same guidance, for all seven. */
  assert.equal(new Set(Object.values(title)).size, 1, 'the fixture did not prescribe one session');
  assert.equal(new Set(Object.values(why)).size, 1, 'the session guidance changed with the athlete');
  assert.ok(why.steady.length > 20, 'the session guidance is gone');

  assert.match(said.improving, /trending up/);
  assert.match(said.strained, /above target this week/);
  assert.match(said.missed, /You have run \d+ of the last \d+ prescribed sessions/);
  assert.match(said.pain, /Pain or soreness reported in 2 recent sessions/);
  assert.match(said.heavyLegs, /You reported heavy legs this morning/);
  /* Nothing to say is said as nothing. */
  assert.equal(said.steady, '', 'a steady athlete was given an observation: ' + said.steady);
  assert.equal(said.noData, '', 'an athlete with nothing logged was given an observation: ' + said.noData);
  const spoken = ['improving', 'strained', 'missed', 'pain', 'heavyLegs'].map(k => said[k]);
  assert.equal(new Set(spoken).size, 5, 'two different histories were told the same thing');
});

test('the note never contradicts the engine', () => {
  Object.keys(HISTORY).forEach(name => {
    const a = make(name), dd = session(a);
    const dec = a.coachDecision(), rec = a.coachRecovery(), obs = a.coachObservation(dd);
    const reasons = Array.from(dec.reasons || []);
    if (dec.state === 'recover'){
      assert.match(obs, /Recovery comes before this session/, name + ': the engine says recover and the note does not');
      assert.ok(obs.indexOf(reasons[0]) === 0, name + ': the note gives a different reason from the decision');
    }
    if (dec.state === 'modify')
      assert.ok(obs.indexOf(reasons[0]) === 0, name + ': the note gives a different reason from the decision');
    if (dec.state === 'proceed' && rec.state === 'fresh')
      assert.ok(!/fatigue|strain|pain|sore|heavy|above target|Recovery comes/i.test(obs),
        name + ': the engine sees a fresh athlete cleared to proceed and the note warns: ' + obs);
    if (!/trending up/.test(obs))
      assert.ok(!/good place|going well|strong/i.test(obs), name + ': praise without a rising trend behind it');
    if (/trending up/.test(obs)){
      const tr = a.coachTrend();
      assert.equal(tr.enough && tr.direction, 'rising', name + ': a rising trend was claimed and there is none');
    }
    if (/heavy legs/.test(obs)) assert.deepEqual(Array.from(rec.morning.flags), ['heavy legs']);
    if (/above target/.test(obs)) assert.ok(rec.overRPE + rec.overHR > 0, name + ': strain claimed with no excursion');
    if (/prescribed sessions/.test(obs)){
      const m = a.missPattern();
      assert.ok(m && m.tier !== 'isolated', name + ': missed training claimed without the pattern');
      assert.ok(obs.indexOf('You have run ' + m.ran + ' of the last ' + m.planned) === 0, 'the count is not the engine\'s');
    }
  });
});

test('nothing is written for the note: it is the briefing\'s own leading sentence, or silence', () => {
  /* One voice. The spoken briefing and the written note open on the same
     sentence because they are the same call. */
  Object.keys(HISTORY).forEach(name => {
    const a = make(name), dd = session(a), obs = a.coachObservation(dd);
    const brief = a.coachBrief(dd), paras = brief ? Array.from(brief.paragraphs) : [];
    if (obs) assert.ok(paras.indexOf(obs) !== -1, name + ': the note says something the briefing does not');
    assert.notEqual(obs, a.coachIntentLine(dd), name + ': the generic purpose was passed off as an observation');
    assert.notEqual(obs, a.fuelPrepareCue(dd) || null, name + ': the fuelling cue was passed off as an observation');
    assert.ok(!a.voiceIsLabelled(obs), name + ': a labelled status line reached the note');
  });
  const fn = body('coachObservation');
  assert.ok(!/'[A-Z][a-z]+ [a-z]/.test(fn), 'coachObservation writes a sentence of its own');
  assert.match(fn, /coachBrief\(dd\)/);
  /* And no model is asked. */
  ['coachObservation', 'coachBrief', 'coachReadinessLine', 'recoveryWatchSentence', 'blockHoldSentence'].forEach(n =>
    assert.ok(!/fetch\(|XMLHttpRequest|\/api\//.test(body(n)), n + ' reaches the network'));
  /* The one model call in the product is still the one behind Ask Coach. */
  const apiDir = path.join(__dirname, '..', 'api');
  const read = f => fs.readFileSync(path.join(apiDir, f), 'utf8');
  const files = fs.readdirSync(apiDir).filter(f => /\.js$/.test(f));
  assert.deepEqual(files.filter(f => /api\.anthropic\.com/.test(read(f))).sort(), ['_voice-ask.js'],
    'a second model call was added');
  files.forEach(f => assert.ok(!/api\.openai\.com|generativelanguage\.googleapis/.test(read(f)), f + ' calls another model'));
});

test('only the session the decision is about carries it', () => {
  const a = make('strained'), dd = session(a);
  assert.ok(a.coachObservation(dd));
  const others = a.state.days.filter(d => d.id !== dd.id);
  others.forEach(d => assert.equal(a.coachObservation(d), '',
    d.date + ' (' + d.type + ') was given today\'s reading of the athlete'));
  const later = others.filter(d => d.date > TODAY && d.type !== 'rest').slice(0, 6);
  later.forEach(d => assert.deepEqual(observationOnCard(a.renderDayCard(d)), [], d.date + ' prints an observation'));
  /* Once it is run, the note about how you were going into it is gone. */
  logAsPrescribed(a, dd, { quality: 1 });
  assert.equal(a.coachObservation(dd), '');
});

test('it is drawn once, in the place that session\'s note already is', () => {
  /* A session whose coaching went to the rail: under the Why, beneath the
     session's own words. */
  const a = make('heavyLegs'), dd = session(a);
  assert.equal(a.coachObservationInWhy(dd), true, 'the fixture session is not a rail session');
  const card = a.renderDayCard(dd);
  const whyBox = (card.match(/<div class="why-session">[\s\S]*?<\/div>/) || [''])[0];
  assert.match(whyBox, /why-session-k font-head">Why this session</, 'the Why heading changed');
  assert.ok(whyBox.indexOf('why-session-v') !== -1 && whyBox.indexOf('why-session-v') < whyBox.indexOf('why-session-o'),
    'the observation comes before the session guidance');
  assert.ok(!/how-note-obs|hn-obs/.test(card), 'it is drawn in a note box as well');

  /* An easy day, which is a box of two lines: under them, in the box. */
  const easyDate = (() => { const b = athlete();
    return b.state.days.filter(d => d.date > TODAY && d.type === 'easy' && b.soloNoteSession(d))[0].date; })();
  const e = athlete(easyDate);
  past(e, easyDate).forEach(d => logAsPrescribed(e, d, { quality: 1 }));
  e.state.readiness = { date: easyDate, legs: 'heavy', sleep: 'good', health: 'good' };
  const ed = e.state.days.filter(d => d.date === easyDate)[0];
  assert.equal(e.coachObservationInWhy(ed), false);
  const ecard = e.renderDayCard(ed);
  const box = (ecard.match(/<div class="how-note" data-solo="1">[\s\S]*?<\/div>/) || [''])[0];
  assert.match(box, /hn-lead/, 'the easy-run box lost its lead');
  assert.ok(box.indexOf('hn-lead') < box.indexOf('hn-obs'), 'the observation leads the box');
  assert.match(text(box), /You reported heavy legs this morning\. Worth knowing rather than worth worrying about\./);
  assert.ok(!/why-session-o/.test(ecard), 'it is drawn under the Why as well');
  assert.equal(observationOnCard(ecard).length, 1);

  /* Design: a white sentence. No label, no box, no mark. */
  ['.why-session-o{', '.how-note[data-solo] .hn-obs{'].forEach(sel => {
    const at = SRC.indexOf(sel);
    assert.ok(at !== -1, sel + ' has no rule');
    const rule = SRC.slice(at, SRC.indexOf('}', at));
    assert.match(rule, /color:#FFFFFF/, sel + ' is not white');
    assert.match(rule, /font-size:var\(--fs-body\); line-height:var\(--lh-body\)/);
    assert.ok(!/border|background|box-shadow/.test(rule), sel + ' draws a box');
  });
});

// ---------------------------------------------------------------------------
// THE THREE FAULTS
// ---------------------------------------------------------------------------

test('heavy legs this morning is not fatigue in the last few runs', () => {
  const a = make('heavyLegs'), dd = session(a), rec = a.coachRecovery();
  assert.equal(rec.trainingState, 'fresh', 'the fixture\'s runs are not clean');
  assert.equal(rec.state, 'watch');
  const line = a.coachReadinessLine(dd);
  assert.ok(!/last few runs|fatigue/i.test(line), 'clean runs were described as fatigued: ' + line);
  assert.match(line, /^You reported heavy legs this morning\./);

  const say = (o, quality) => a.recoveryWatchSentence(Object.assign(
    { overRPE: 0, overHR: 0, hardStreak: 0, morning: { flags: [] } }, o), quality);
  /* Where the runs do show it, the sentence is the one it always was. */
  assert.equal(say({ overRPE: 1 }, true),
    'There is a bit more fatigue in the last few runs than usual. Do not force the closing reps if the effort starts climbing.');
  assert.match(say({ overHR: 1 }, false), /^A bit more fatigue than usual in the last few runs/);
  /* Where both are true, both are said. */
  assert.match(say({ overRPE: 1, morning: { flags: ['heavy legs'] } }, true),
    /fatigue in the last few runs than usual, and you reported heavy legs this morning\./);
  /* The morning alone, whatever was answered. */
  assert.equal(say({ morning: { flags: ['heavy legs', 'poor sleep'] } }, false),
    'You reported heavy legs and poor sleep this morning. Worth knowing rather than worth worrying about.');
  /* And hard days in a row are hard days in a row, not fatigue. */
  const streak = say({ hardStreak: 3 }, true);
  assert.match(streak, /^That is 3 hard days in a row without an easy one\./);
  assert.ok(!/fatigue/.test(streak));
  ['coachReadinessLine'].forEach(n => assert.ok(!/bit more fatigue/.test(body(n)), n + ' still words the watch state itself'));
});

test('an athlete completing their training is not told the block reads as Plateau', () => {
  const a = make('steady');
  const miss = a.missPattern();
  assert.ok(!miss || miss.tier === 'isolated', 'the fixture is not a compliant athlete');
  const s = a.blockHoldSentence({ state: 'PLATEAU' });
  assert.match(s, /^You are completing your training as prescribed, and your results are holding steady rather than improving yet/);
  assert.match(s, /so the plan stays as it is for now\.$/);
  ['PLATEAU', 'LEARNING', 'RESPONDING', 'STRAINED', undefined].forEach(st => {
    const out = a.blockHoldSentence(st ? { state: st } : null);
    assert.ok(!/Plateau|Learning|Responding|reads as|not yet evidence|absorbed/.test(out),
      'an internal label or the old verdict reached the athlete: ' + out);
    assert.match(out, /\.$/);
  });
  /* The credit is given only where the engine's own count supports it. */
  const b = make('missed');
  assert.ok(b.missPattern() && b.missPattern().tier !== 'isolated');
  ['PLATEAU', 'LEARNING'].forEach(st =>
    assert.ok(!/completing your training/.test(b.blockHoldSentence({ state: st })),
      'an athlete five sessions short was told they are completing their training'));
  assert.ok(!/The block reads as/.test(SRC), 'the old sentence is still in the engine');
  assert.match(SRC, /why:blockHoldSentence\(block\)/, 'the progression gate does not use the sentence');
});

test('the hard streak is this week\'s, and made of days that were run', () => {
  const setup = fill => {
    const a = athlete();
    const days = a.state.days.filter(d => d.date <= TODAY).sort((x, y) => x.date < y.date ? -1 : 1);
    days.forEach(d => { d.type = 'easy'; d.completed = d.date < TODAY; d.actual = d.completed ? { km: d.km } : null; });
    fill(a, date => days.filter(d => d.date === date)[0], a.addDays);
    return a.coachRecovery();
  };
  /* Four hard days in a row, three weeks ago. Easy running since. */
  const old = setup((a, on, add) => { [-24, -23, -22, -21].forEach(n => { on(add(TODAY, n)).type = 'tempo'; }); });
  assert.equal(old.hardStreak, 0, 'a streak from three weeks ago is still being reported');
  assert.equal(old.trainingState, 'fresh', 'and is still being counted as strain');
  /* Three in a row inside the week. */
  const now = setup((a, on, add) => { [-3, -2, -1].forEach(n => { on(add(TODAY, n)).type = 'tempo'; }); });
  assert.equal(now.hardStreak, 3);
  assert.equal(now.trainingState, 'watch');
  /* A run that began before the week and reaches into it counts in full. */
  const reach = setup((a, on, add) => { [-8, -7, -6, -5].forEach(n => { on(add(TODAY, n)).type = 'tempo'; }); });
  assert.equal(reach.hardStreak, 4, 'a streak was cut at the edge of the week');
  /* A hard session that was not run is not a hard day in the legs. */
  const skipped = setup((a, on, add) => {
    [-3, -2, -1].forEach(n => { on(add(TODAY, n)).type = 'tempo'; });
    const d = on(add(TODAY, -2)); d.completed = false; d.actual = null;
  });
  assert.equal(skipped.hardStreak, 1, 'an unlogged session was counted as a hard day');
  /* Today's own session counts while it is still ahead. */
  const today = setup((a, on, add) => { [-2, -1, 0].forEach(n => { on(add(TODAY, n)).type = 'tempo'; }); });
  assert.equal(today.hardStreak, 3);
  assert.ok(!/Longest hard streak/.test(SRC), 'the Recovery page still calls it the longest');
  assert.match(SRC, /hqRow\('Hard days in a row', nDays\(report\.recovery\.hardStreak\)\+' this week'\)/);
});

// ---------------------------------------------------------------------------
// PROPOSALS: THE CALENDAR IS NOT EVIDENCE
// ---------------------------------------------------------------------------

/* Founder: "Do not allow the same underlying evidence to repeatedly trigger
   reductions merely because the date changes. A new proposal requires
   materially new evidence or a genuine change in circumstances." */

const answer = (a, ev, yes) => {
  const pb = !!ev.playbook;
  if (yes) (pb ? a.handleAcceptPlaybook : a.handleAcceptEvolution)(ev.proposalId);
  else (pb ? a.handleDeclinePlaybook : a.handleDeclineEvolution)(ev.proposalId);
};

for (const name of ['strained', 'pain']) {
  for (const yes of [true, false]) {
    test((yes ? 'accepting' : 'declining') + ' a ' + name + ' proposal settles it for the days that follow', () => {
      let a = make(name);
      const first = a.planEvolution();
      assert.equal(first.changes.length, 1, 'the fixture produced no proposal');
      assert.ok(a.evolutionProposalVisible(first));
      answer(a, first, yes);
      const adjusted = a.state.days.filter(d => d.coachAdjust).length;
      assert.equal(adjusted, yes ? 1 : 0);
      let date = TODAY;
      for (let i = 1; i <= 4; i++){
        date = a.addDays(date, 1);
        a = carry(a, date);
        const ev = a.planEvolution();
        assert.equal(ev.changes.length, 0,
          'day +' + i + ': nothing was logged, and a ' + (ev.changes[0] || {}).kind + ' was proposed again');
        assert.equal(a.evolutionProposalVisible(ev), false);
        assert.equal(ev.settled, true);
        assert.match(ev.reasons[0], yes ? /You accepted a change on this evidence/ : /You kept your plan on this evidence/);
        assert.equal(a.renderTodayProposal(a.state.days.filter(d => d.date === date)[0], 'above') +
                     a.renderTodayProposal(a.state.days.filter(d => d.date === date)[0], 'below'), '');
      }
      assert.equal(a.state.days.filter(d => d.coachAdjust).length, adjusted, 'the plan was changed again');
    });
  }
}

test('the evidence is what the athlete gave, and a date is not part of it', () => {
  const a = make('strained');
  const sig = a.evolutionEvidenceSignature();
  assert.equal(carry(a, a.addDays(TODAY, 1)).evolutionEvidenceSignature(), sig, 'a new day changed the evidence');
  assert.equal(carry(a, a.addDays(TODAY, 9)).evolutionEvidenceSignature(), sig);
  assert.ok(!/todayStr|new Date|Date\.now|dec\b/.test(body('evolutionEvidenceSignature')),
    'the signature reads the calendar or the engine\'s own conclusion');

  const changed = (label, edit) => {
    const b = carry(a, TODAY); edit(b);
    assert.notEqual(b.evolutionEvidenceSignature(), sig, label + ' is not new evidence');
  };
  const last = b => b.state.days.filter(d => d.completed).slice(-1)[0];
  changed('a session logged', b => logAsPrescribed(b, session(b), { quality: 1 }));
  changed('a corrected effort', b => { last(b).actual.rpe = 3; });
  changed('a note written', b => { last(b).actual.notes = 'Sharp pain in my calf.'; });
  changed('a Your Log answer', b => { last(b).actual.hurting = 'pain'; });
  changed('a morning check-in', b => { session(b).readiness = { legs: 'heavy' }; });
  changed('a check-in stored the old way', b => { b.state.readiness = { date: TODAY, legs: 'heavy' }; });
});

test('new evidence reopens the question, after either answer', () => {
  for (const yes of [true, false]){
    let a = make('pain');
    answer(a, a.planEvolution(), yes);
    a = carry(a, a.addDays(TODAY, 1));
    assert.equal(a.planEvolution().settled, true);
    const next = a.state.days.filter(d => d.type !== 'rest' && !d.completed && d.date >= a.addDays(TODAY, 1))[0];
    logAsPrescribed(a, next, { quality: 1 });
    next.actual.hurting = 'pain';
    assert.equal(a.planEvolution().settled, false, 'a third session with pain was met with silence');
  }
});

test('a decline is only recorded against a proposal that was there', () => {
  const a = make('steady');
  const ev = a.planEvolution();
  assert.equal(ev.changes.length, 0);
  a.handleDeclineEvolution(null);
  assert.equal((a.state.evolution || {}).declinedEvidence || null, null,
    'evidence nobody was asked about was marked as answered');
  assert.equal(a.planEvolution().settled, false);
});

test('on settled evidence a newly missed key session may be recovered, and nothing may be reduced', () => {
  const a = make('strained');
  answer(a, a.planEvolution(), false);
  assert.equal(a.planEvolution().settled, true);
  const target = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest')[0];
  a.missedStimulus = () => [{ dayId: 'missed-1', type: 'tempo', km: 8, date: TODAY, stimulusStillUseful: true }];
  a.evolutionChanges = () => [
    { kind: 'reduce', dayId: target.id, date: target.date, fromKm: target.km, toKm: 3, why: 'x' },
    { kind: 'reschedule', dayId: target.id, date: target.date, fromType: target.type, toType: 'tempo',
      fromKm: target.km, toKm: 8, sourceDayId: 'missed-1', why: 'y' }];
  const ev = a.planEvolution();
  assert.deepEqual(Array.from(ev.changes).map(c => c.kind), ['reschedule'],
    'the old evidence produced a reduction again');
  assert.equal(ev.settled, false);
  /* Once that has been answered too, it is not asked again. */
  a.state.evolution = Object.assign({}, a.state.evolution, { answeredMissed: ['missed-1'] });
  const again = a.planEvolution();
  assert.equal(again.changes.length, 0);
  assert.equal(again.settled, true);
});
