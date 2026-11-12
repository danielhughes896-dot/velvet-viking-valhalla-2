'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* Founder, of the open Ask Coach panel: "Ask coach needs the new rules." The
   house rules: no pills or symbols, white text, no grey text, no raised black
   boxes, no em dashes; cherry is the active thing, gold is the brand. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.slice(SRC.indexOf('<style'), SRC.indexOf('</style>'));
const text = h => String(h || '').replace(/<[^>]+>/g, ' ');
/* The LAST declaration of a property in the last rule for a selector wins. */
function lastRule(sel){
  const re = new RegExp('(^|[}\\s,])' + sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}', 'g');
  let m, body = null;
  while ((m = re.exec(CSS))) body = m[2];
  assert.ok(body !== null, 'no rule for ' + sel);
  return body;
}

function panels(){
  const a = loadApp({ pinnedDate: '2026-11-12T07:00:00Z' });
  a.renderApp = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-02' });
  const dd = a.findDayByDate('2026-11-12');
  /* With speech available, so Speak instead is drawn and checked too. */
  a.voiceSttUnsupportedReason = () => null;
  const out = [];
  const states = [
    ['open', {}], ['listening', {}], ['thinking', { heard: 'Why?' }],
    ['answered', { heard: 'Why?', answer: 'Because the week builds.' }],
    ['answered', { heard: 'Why?', answer: 'Partly', incomplete: true }],
    ['error', { message: a.VOICE_ERROR_COPY.coach_busy }]
  ];
  states.forEach(([st, o]) => { a.askSet(st, Object.assign({ heard: '', answer: '', message: '', proposalDayId: null }, o)); out.push([st, a.renderAskPanel(dd)]); });
  return { a, out };
}

test('every state of the panel: no glyph, no em dash, no arrow, and a way out', () => {
  const { a, out } = panels();
  out.forEach(([st, h]) => {
    assert.doesNotMatch(h, /<svg/, st + ': a symbol is drawn in Ask Coach');
    assert.doesNotMatch(text(h), /[—→]/, st + ': an em dash or arrow is in Ask Coach');
    assert.doesNotMatch(h, /btn-primary|btn-ghost/, st + ': an old gold or boxed button is back');
    assert.match(h, /voice-ask-close|voice-ask-cancel/, st + ': no way out');
  });
  assert.match(out[0][1], /data-action="voice-ask-speak">Speak instead</, 'Speak instead was not drawn, or not as plain words');
  for (const k of Object.keys(a.VOICE_STT_COPY)) assert.doesNotMatch(a.VOICE_STT_COPY[k], /—/, k);
  for (const k of Object.keys(a.VOICE_ERROR_COPY)) assert.doesNotMatch(a.VOICE_ERROR_COPY[k], /—/, k);
  assert.doesNotMatch(SRC.slice(SRC.indexOf('function renderAskProposal'), SRC.indexOf('function patchVoiceCard')), /→/);
});

test('the panel is glass, not a raised box; Ask is cherry; the questions are lines, not pills', () => {
  assert.match(lastRule('.ask-panel'), /backdrop-filter:var\(--glass-blur\)/);
  assert.match(lastRule('.ask-panel'), /box-shadow:var\(--glass-rim\)/);
  assert.match(lastRule('.ask-go'), /background:var\(--cherry\)/);
  const chip = lastRule('.ask-chip');
  assert.match(chip, /border:0/); assert.match(chip, /border-radius:0/); assert.match(chip, /background:none/);
  assert.match(SRC, /class="btn btn-sm ask-go" data-action="voice-ask-submit">Ask</);
});

test('every word in it is white, the placeholder included', () => {
  assert.match(lastRule('.ask-chip'), /color:#fff/);
  assert.match(lastRule('.ask-link'), /color:#fff/);
  assert.match(lastRule('.ask-form input'), /color:#fff/);
  assert.match(lastRule('.ask-form input::placeholder'), /color:#fff/);
  assert.match(CSS, /\.ask-k, \.ask-v, \.ask-thinking, \.ask-incomplete, \.ask-source, \.ask-stt-note, \.ask-prop-head\{ color:#fff; \}/);
  /* and that shared white rule comes after every older grey one */
  const at = CSS.indexOf('.ask-k, .ask-v, .ask-thinking');
  ['.ask-k{', '.ask-v{', '.ask-thinking{', '.ask-incomplete{', '.ask-source{', '.ask-stt-note{'].forEach(s => {
    let i = CSS.indexOf(s, at);
    while (i > -1){
      assert.doesNotMatch(CSS.slice(i, CSS.indexOf('}', i)), /(^|[;{\s])color:/, s + ' is recoloured after the white rule');
      i = CSS.indexOf(s, i + 1);
    }
  });
});
