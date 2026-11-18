'use strict';
/* COPY TIDY. The founder's standing rules for anything an athlete can see:
 * "no em dashes", "no symbols" (the middle dot counts), "no repetition".
 *
 * Three laws, each read from the runtime that ships:
 *   1. A notice (showToast) never carries an em dash.
 *   2. No string literal in the runtime's script puts a middle dot into text.
 *   3. On the Today card, the box line is never said again inside the Why.
 *
 * Laws 1 and 2 read the SOURCE rather than rendering, because a toast or a
 * separator can sit on a branch no fixture reaches. A small lexer below finds
 * the string literals (quotes and template text) and skips comments and
 * regular expressions, so the many comments that QUOTE old copy ("Week 9 ·
 * Taper") do not count against the copy itself. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

const HTML = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

/* The application script: the largest inline <script>, exactly as the harness
   picks it. Its starting line is kept so a failure names a real line. */
function appScript(html) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let best = null, m;
  while ((m = re.exec(html)) !== null) {
    if (best === null || m[1].length > best.src.length) {
      best = { src: m[1], offset: m.index + m[0].indexOf('>') + 1 };
    }
  }
  if (!best) throw new Error('no inline <script> in the runtime');
  best.firstLine = html.slice(0, best.offset).split('\n').length;
  return best;
}
const SCRIPT = appScript(HTML);
const JS = SCRIPT.src;
function lineOf(offset) {
  return SCRIPT.firstLine + JS.slice(0, offset).split('\n').length - 1;
}

/* ---------- THE LEXER ----------
   Returns every string literal as { start, end, raw, q }: raw is the source
   text between the quotes, escapes left as written (so an escaped middle dot is
   seen as the six characters it is in the file, and a literal one as itself). Template
   literals contribute their text parts; their ${...} expressions are lexed
   as code. Comments are skipped. A "/" starts a regular expression only
   where an expression may begin, which is the usual rule for telling a
   regex from a division. */
const KW_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'else', 'do', 'instanceof', 'yield', 'await']);
function lexStrings(src) {
  const strings = [];
  const n = src.length;
  let i = 0, last = '', braceDepth = 0;
  const tplStack = [];
  const regexAllowed = () => {
    if (!last) return true;
    if (last === 'num' || last === 'str' || last === 'regex') return false;
    if (last.startsWith('id:')) return KW_BEFORE_REGEX.has(last.slice(3));
    const c = last.slice(5);
    return !(c === ')' || c === ']' || c === '}');
  };
  const readTemplate = () => {
    const s = i;
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { strings.push({ start: s, end: i, raw: src.slice(s, i), q: '`' }); i++; last = 'str'; return; }
      if (ch === '$' && src[i + 1] === '{') {
        strings.push({ start: s, end: i, raw: src.slice(s, i), q: '`' });
        i += 2; tplStack.push(braceDepth); braceDepth++; last = 'punc:{'; return;
      }
      i++;
    }
  };
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"' || ch === "'") {
      const s = ++i;
      while (i < n && src[i] !== ch && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      strings.push({ start: s, end: i, raw: src.slice(s, i), q: ch });
      i++; last = 'str'; continue;
    }
    if (ch === '`') { i++; readTemplate(); continue; }
    if (ch === '/') {
      if (regexAllowed()) {
        i++;
        let inClass = false;
        while (i < n && src[i] !== '\n') {
          const c = src[i];
          if (c === '\\') { i += 2; continue; }
          if (inClass) { if (c === ']') inClass = false; }
          else if (c === '[') inClass = true;
          else if (c === '/') break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(src[i])) i++;
        last = 'regex'; continue;
      }
      i++; last = 'punc:/'; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) { const s = i; while (i < n && /[\w$]/.test(src[i])) i++; last = 'id:' + src.slice(s, i); continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1]))) { while (i < n && /[\w.]/.test(src[i])) i++; last = 'num'; continue; }
    if (ch === '{') { braceDepth++; i++; last = 'punc:{'; continue; }
    if (ch === '}') {
      braceDepth--;
      if (tplStack.length && tplStack[tplStack.length - 1] === braceDepth) { tplStack.pop(); i++; readTemplate(); continue; }
      i++; last = 'punc:}'; continue;
    }
    i++; last = 'punc:' + ch;
  }
  return strings;
}
const STRINGS = lexStrings(JS);

/* Every showToast(...) call and the string literals inside its parentheses. */
function toastCalls() {
  const calls = [];
  const re = /\bshowToast\s*\(/g;
  let m, k = 0;
  while ((m = re.exec(JS)) !== null) {
    const open = m.index + m[0].length - 1;
    while (k < STRINGS.length && STRINGS[k].end < open) k++;
    if (STRINGS[k] && STRINGS[k].start <= open && open < STRINGS[k].end) continue;  // inside a string
    const strs = [];
    let depth = 0, i = open, j = k;
    for (; i < JS.length; i++) {
      if (j < STRINGS.length && i === STRINGS[j].start) { strs.push(STRINGS[j]); i = STRINGS[j].end; j++; continue; }
      const c = JS[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (--depth === 0) break; }
    }
    calls.push({ line: lineOf(open), strs });
  }
  return calls;
}

const EM_DASH = /—|\\u2014|&mdash;|&#8212;/i;
const MIDDLE_DOT = /·|\\u00b7|&middot;|&#183;|&#xb7;/i;

test('the lexer sees string literals and nothing in comments or regexes', () => {
  const src = [
    "// 'Week 9 · Taper' quoted in a comment",
    "/* \"Signed out — your plan\" quoted in a block comment */",
    "var r = /['\"]/g, q = a / b / c;",
    "var s = 'one' + \"two\" + `three ${ x ? 'four' : `five` } six`;",
  ].join('\n');
  const raws = lexStrings(src).map(s => s.raw);
  assert.deepEqual(raws, ['one', 'two', 'three ', 'four', 'five', ' six']);
  assert.ok(STRINGS.length > 10000, 'the runtime lexed to almost nothing: ' + STRINGS.length);
  const unterminated = STRINGS.filter(s => s.q !== '`' && JS[s.end] !== s.q);
  assert.deepEqual(unterminated.map(s => lineOf(s.start)), [],
    'the lexer lost its place in the runtime, so the laws below would read garbage');
});

// ===========================================================================
// 1. NOTICES. Founder: "no em dashes".
// ===========================================================================
test('no notice carries an em dash', () => {
  const calls = toastCalls();
  assert.ok(calls.length > 100, 'found only ' + calls.length + ' showToast calls; the scan is broken');
  const bad = [];
  calls.forEach(c => c.strs.forEach(s => {
    if (EM_DASH.test(s.raw)) bad.push(c.line + ': ' + s.raw);
  }));
  assert.deepEqual(bad, [], 'a notice reads with an em dash:\n' + bad.join('\n'));
});

test('the copy tables and builders that feed notices carry no em dash either', () => {
  const a = loadApp({ pinnedDate: '2026-03-11T09:00:00Z' });
  const said = [];
  ['STRAVA_ERROR_COPY', 'GARMIN_ERROR_COPY', 'VOICE_ERROR_COPY'].forEach(t =>
    Object.keys(a[t]).forEach(k => said.push(t + '.' + k + ': ' + a[t][k])));
  said.push('stravaMessage: ' + a.stravaMessage({ code: 'no_such_code' }));
  ['otp_expired', 'access_denied', 'anything_else'].forEach(c =>
    said.push('cloudAuthErrorCopy: ' + a.cloudAuthErrorCopy(c)));
  const bad = said.filter(s => /—/.test(s));
  assert.deepEqual(bad, [], 'a notice reads with an em dash:\n' + bad.join('\n'));
});

// ===========================================================================
// 2. MIDDLE DOTS. Founder: "no symbols", and the middle dot is one.
// ===========================================================================
/* Nothing needs to stay. If something genuinely must, add it here as
   { line text fragment: reason }, and keep the list short. */
const MIDDLE_DOT_ALLOWED = {};

test('no string in the runtime puts a middle dot into text', () => {
  const bad = STRINGS
    .filter(s => MIDDLE_DOT.test(s.raw))
    .map(s => ({ line: lineOf(s.start), raw: s.raw }))
    .filter(s => !Object.keys(MIDDLE_DOT_ALLOWED).some(frag => s.raw.indexOf(frag) > -1));
  assert.deepEqual(bad.map(s => s.line + ': ' + s.raw), [],
    'a middle dot is back in athlete-facing text; use natural punctuation (", " or ": ")');
});

test('the share strap is drawn from its parts, not by splitting a displayed separator', () => {
  /* The stacked designs used to split the strap on "  ·  ". The parts are
     now a list of their own, so the displayed join can be ordinary
     punctuation without the stack and the single-line strap disagreeing. */
  assert.doesNotMatch(JS, /strap\.split\(/, 'a design splits the strap text again');
  const a = loadApp({ pinnedDate: '2026-03-11T09:00:00Z' });
  const data = { programme: 'Half Marathon', phase: 'Build', week: 9 };
  assert.deepEqual(Array.from(a.shareStrapParts(data)), ['Half Marathon', 'Build', 'Week 9']);
  assert.equal(a.shareStrapText(data), 'Half Marathon, Build, Week 9');
  assert.equal(a.shareStrapText({ programme: 'Aerobic Base' }), 'Aerobic Base');
});

// ===========================================================================
// 3. REPETITION. Founder: "no repetition".
// ===========================================================================
/* An easy run's Today card showed a box headed "Keep it easy" with "Most of
   your running should feel like this", and WHY THIS SESSION directly under
   it opened with the same sentence. The box line and the Why are chosen from
   the same context (family, role, phase), so the law is read bucket by
   bucket: nothing the box can say in a bucket may be said again by any Why
   the same bucket can resolve to. */
const norm = s => String(s).toLowerCase().replace(/[‘’']/g, "'")
  .replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
const contains = (why, line) => norm(line).length > 5 && norm(why).indexOf(norm(line)) > -1;
const PHASES = ['Base', 'Build', 'Peak', 'Taper'];

test('no session type repeats its box line inside its Why', () => {
  const a = loadApp({ pinnedDate: '2026-03-11T09:00:00Z' });
  const bad = [];
  let compared = 0;

  /* The contextual box line against the contextual Why, per bucket. The box
     resolves role first, then the phase, exactly as coachingSoloSub() does;
     the Why is the app's own coachingVariantsFor() for the same context. */
  Object.keys(a.COACHING_SOLO_SUB).forEach(family => {
    const fam = a.COACHING_SOLO_SUB[family];
    const roles = [null].concat(Object.keys(fam.role || {}));
    roles.forEach(role => PHASES.forEach(phase => {
      const box = (role && fam.role && fam.role[role]) || (fam.phase && fam.phase[phase]) || [];
      const whys = a.coachingVariantsFor({ family, phase, role, milestone: null }) || [];
      box.forEach(line => whys.forEach(why => {
        compared++;
        if (contains(why, line)) bad.push(family + '/' + (role || phase) + ': "' + line + '" is repeated in "' + why + '"');
      }));
    }));
  });

  /* The written note (SINGLE_CARD_NOTE) and, for every archetype, the feel
     line the box leads with, against that archetype's own written Why at
     every depth. */
  const whysOf = k => [a.ARCHETYPE_GUIDANCE[k], a.TERSE_GUIDANCE && a.TERSE_GUIDANCE[k]]
    .filter(Boolean).map(g => g.why).filter(w => typeof w === 'string');
  Object.keys(a.SINGLE_CARD_NOTE).forEach(k => {
    const n = a.SINGLE_CARD_NOTE[k];
    [n.lead].concat(n.subs || []).forEach(line => whysOf(k).forEach(why => {
      compared++;
      if (contains(why, line)) bad.push(k + ': "' + line + '" is repeated in "' + why + '"');
    }));
  });
  Object.keys(a.ARCHETYPE_GUIDANCE).forEach(k => {
    [a.ARCHETYPE_GUIDANCE[k], a.TERSE_GUIDANCE && a.TERSE_GUIDANCE[k]].filter(Boolean).forEach(g => {
      if (typeof g.feel !== 'string' || typeof g.why !== 'string') return;
      compared++;
      if (contains(g.why, g.feel)) bad.push(k + ': feel "' + g.feel + '" is repeated in "' + g.why + '"');
    });
  });

  assert.ok(compared > 100, 'only ' + compared + ' pairs compared; the guidance data moved');
  assert.deepEqual(bad, [], 'the Today card says the same thing twice:\n' + bad.join('\n'));
});

test('on the cards themselves, the box line never reappears in WHY THIS SESSION', () => {
  let boxed = 0;
  const bad = [];
  [['10k', 'novice'], ['half', 'intermediate']].forEach(([distanceKey, level]) => {
    const a = loadApp({ pinnedDate: '2026-03-11T09:00:00Z' });
    buildPlan(a, { weeks: 12, distanceKey });
    a.state.setup.experience = level;
    a.state.days.forEach(dd => {
      if (!a.soloNoteSession(dd)) return;
      const parts = a.singleCardNoteParts(dd);
      const gd = a.coachingDisclosureFor(dd, a.athleteExperience());
      const why = gd && gd.why ? a.resolveDesc(gd.why) : '';
      if (!parts || !why) return;
      boxed++;
      [parts.lead].concat(parts.subs || []).filter(Boolean).forEach(line => {
        if (contains(why, line)) bad.push(distanceKey + ' ' + dd.date + ': "' + line + '" / "' + why + '"');
      });
    });
  });
  assert.ok(boxed > 30, 'only ' + boxed + ' boxed days with a Why; the fixture no longer exercises this');
  assert.deepEqual(bad, [], 'the box and the Why repeat each other:\n' + bad.join('\n'));
});
