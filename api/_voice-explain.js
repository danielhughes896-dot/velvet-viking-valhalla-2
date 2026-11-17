// The coach's word on a finished run or a finished week. The third thing
// Sacoro asks a language model for, through the same door as the other two.
//
//   POST { kind: 'run' | 'week', evidence } -> { text }   passed every check
//                                           -> { text: null, code }  anything
//                                              else; the panel keeps the
//                                              engine's own sentence
//
// Founder: "I don't want a list of copying. I want it to sound like a real
// normal coach. Concise English. Not robotic. Summarising the stats."
//
// WHAT THE ENGINE HAS ALREADY DECIDED STAYS DECIDED. `evidence.verdict` is the
// engine's reading of the run or the week -- a tone, its label and its own
// sentence -- and the model is asked to say that, the way a coach would, with
// the figures beside it. It decides nothing, prescribes nothing and returns
// only text.
//
// THE CHECKS ARE THE COACH'S NOTE'S, PLUS THREE. validateNote() already rejects
// an invented number, a plan change the engine did not make, medical advice,
// mention of a machine, emoji, markup and a line the athlete is already
// reading. A result panel adds: the words must agree with the verdict's tone
// (no praise on a run the engine flagged, no worry on one it read as good), a
// recovery verdict must say recovery, and no exclamation marks -- a coach who
// means it does not need them.
//
// ONE MODEL CALL SITE, still: this sends through postModel() in
// _voice-ask.js. It reads no database and no service-role key.

const V = require('./_voice.js');
const ASK = require('./_voice-ask.js');
const NOTE = require('./_voice-note.js');

const EXPLAIN_MAX_TOKENS = 16000;   // thinking is drawn from this; not a target
const EVIDENCE_MAX_CHARS = 6000;
const KINDS = ['run', 'week'];
const TONES = ['positive', 'neutral', 'caution', 'recovery'];

const STYLE = [
  'HOW IT SOUNDS. Like a real coach talking to an adult athlete they know: plain, warm, direct,',
  'British English, second person. Two or three short sentences, at most 50 words, one paragraph.',
  'Sum up what the figures say in ordinary words. Pick the one or two figures that matter most and',
  'say what they mean; never list figures and never repeat the whole log back. No greeting, no',
  'sign-off, no headings, no lists, no emoji, no quotation marks, no exclamation marks, no',
  'cheerleading and no cliches. Reply with the paragraph and nothing else.',
  '',
  'THE REGISTER, BY EXAMPLE (not about this athlete):',
  '  "Ten kilometres at a proper easy effort, and nothing forced. That is the run that lets the',
  '  harder days work, so keep the same feel going into your intervals."',
  '  "Your heart rate sat well above where an easy run should, so this one cost more than it',
  '  gave. Recovery comes first now; treat your next hard session with caution."'
];
/* A RUN'S ANALYSIS IS FLOWING ENGLISH (founder: "I don't want it to look like
   this. I want it to be normal flowing English"): two or three short
   paragraphs in place of the labelled card. */
const STYLE_RUN = STYLE.map(l => l
  .replace('Two or three short sentences, at most 50 words, one paragraph.',
           'Two or three short paragraphs separated by a blank line, at most 110 words in all.')
  .replace('Reply with the paragraph and nothing else.', 'Reply with the paragraphs and nothing else.'));
const RUN_LIMITS = { maxChars: 800, maxSentences: 8 };
/* WEEK COMPLETE IS ONE SENTENCE (founder: "Week complete should have 1
   sentence summarising the week"). The ring and the figures sit above it, so
   the sentence says what the week amounted to, not what it measured. */
/* The run examples are two sentences about a run; a week gets its own. */
const STYLE_WEEK = STYLE.slice(0, STYLE.indexOf('')).map(l => l
  .replace('Two or three short sentences, at most 50 words, one paragraph.', 'ONE sentence, at most 25 words, summing up the week.')
  .replace('Reply with the paragraph and nothing else.', 'Reply with the sentence and nothing else.'))
  .concat(['',
           'THE REGISTER, BY EXAMPLE (not about this athlete):',
           '  "Every run done and none of them forced, so the week did exactly what it was there to do."',
           '  "Two runs ran hotter than they should have, which is why next week eases off to let you recover."',
           '','The figures are shown right above your sentence: say what the week amounted to, quoting',
           'at most one figure, and mention next week only if it fits in the same sentence.']);
const WEEK_MAX_WORDS = 25;
const RULES = [
  'HARD RULES.',
  '1. Use only facts in evidence. Never state a number, pace, distance, time, heart rate, day or',
  '   count that is not written there, and never work one out.',
  '2. Your read must agree with evidence.verdict. Say what verdict.line says, in your own words.',
  '   If verdict.tone is "caution" or "recovery", do not praise the session. If it is "recovery",',
  '   say plainly that recovery comes first. If it is "positive", do not invent a worry.',
  '3. Never change the plan and never suggest changing it. Do not tell the athlete to skip, swap,',
  '   shorten, extend, move or add anything unless evidence.next says so in those words.',
  '4. No medical advice and no diagnosis.',
  '5. Never mention evidence, data, a score system, the engine, an algorithm, AI, or yourself.',
  '6. Do not reuse the engine\'s sentences. verdict.line, noticed, next and nextWeek are there',
  '   for you to understand; say what they mean in your own words. Never write report phrases',
  '   such as "proceed as planned", "monitor the fatigue", "completed at easy intent" or',
  '   "the session did not do the job it was set for".',
  '7. Name days only as evidence names them (a date such as 17 Nov is fine; do not turn it',
  '   into a weekday). A session can be named by what it is: "your 3x600m intervals".'
];
const SYSTEM = {
  run: [
    'You are the running coach in the Sacoro app. The athlete has just logged a run, and you are',
    'writing its analysis: what you would tell them about it, as a coach, in plain English.',
    '',
    'WHAT YOU ARE GIVEN. A JSON object called evidence: what they logged, the session it was meant to',
    'be, verdict -- what Sacoro\'s own coaching engine has ALREADY concluded about this run -- and',
    'analysis, the engine\'s own paragraphs saying everything it found. Say all of that again in your',
    'own words. Keep every problem it names (pace, heart rate, distance, effort, reps, fading) and',
    'the trend across recent runs, which is separate from how this run scored. If evidence.next is',
    'present, it is the next session; finish with it, briefly.',
    ''
  ].concat(RULES, [''], STYLE_RUN).join('\n'),
  week: [
    'You are the running coach in the Sacoro app. The athlete has just finished a training week, and',
    'you are writing the few words that sit on the Week Complete panel.',
    '',
    'WHAT YOU ARE GIVEN. A JSON object called evidence: what the week asked for, what they did, and',
    'verdict -- what Sacoro\'s own coaching engine has ALREADY concluded about the week. If',
    'evidence.nextWeek is present, it is what the plan does next week; mention it last, briefly.',
    ''
  ].concat(RULES, [''], STYLE_WEEK).join('\n')
};

const PRAISE = /\b(?:great|brilliant|excellent|perfect(?:ly)?|superb|fantastic|amazing|awesome|nailed|crushed|smashed|spot[- ]on|well done|good job|textbook|impressive)\b/i;
const WORRY = /\b(?:worr\w*|concern\w*|struggl\w*|too hard|overcook\w*|overdid|overdone|fatigued?|warning)\b/i;
const RECOVERY_WORDS = /\b(?:recover\w*|rest\w*|back off|ease off|easy)\b/i;

/* THE CHECK. Returns { ok:true, text } or { ok:false, why }. Pure, so the copy
   the browser runs (resultSayValid() in the app) can be held to the same cases. */
/* The engine's own sentences, which the paragraph must say in its own words
   rather than copy (founder: "I don't want a list of copying"). */
/* Only the engine's full-length sentences count: echoing four words such as
   "you're ready to progress" is not the robotic list the founder objected to,
   repeating "11.5km completed at easy intent" back is. */
const ENGINE_COPY_MIN = 32;
function engineLines(ev){
  const out = [];
  const add = t => String(t).split(/(?<=[.!?])\s+/).forEach(sn => {
    if (sn.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().length >= ENGINE_COPY_MIN) out.push(sn);
  });
  if (ev.verdict && ev.verdict.line) add(ev.verdict.line);
  if (ev.noticed) add(ev.noticed);
  if (typeof ev.next === 'string' && ev.next) add(ev.next);
  if (Array.isArray(ev.analysis)) ev.analysis.forEach(add);
  return out;
}
/* WHAT THE VERDICT FLAGS, THE PARAGRAPH MUST SAY (founder: "words must agree
   with the engine verdict"). A neutral run can still carry a fault -- "pace
   ran quicker than the easy window" -- and the side-by-side test found a
   paragraph that called that run "exactly the job" and left the pace out.
   Each fault word in verdict.line must reach the paragraph, in its own words
   or a plain synonym. */
const FLAGS = [
  [/\bquicker|\bfaster/i, /\b(?:quick|quicker|fast|faster|pushed|hurried)\b/i],
  [/\bslower\b/i, /\b(?:slow|slower|held back|off the pace)\b/i],
  [/\bshort\b|km target\b/i, /\b(?:short|shy|less than|under|of the|against|cut)\b/i],
  [/\babove\b|\bover\b|\bceiling\b/i, /\b(?:above|over|high|higher|ceiling|too hard|cost)\b/i],
  [/(?<!\bnone )\bharder than\b/i, /\b(?:hard|harder|tough|tougher|heavy)\b/i],
  [/\bmissed\b|\bnot logged\b/i, /\b(?:miss|missed|missing|not logged|unlogged|logged so far|still to log|not in yet|in yet|yet to be logged)\b/i]
];
function missedFlag(text, ev){
  const line = String((ev.verdict && ev.verdict.line) || '');
  for (let i = 0; i < FLAGS.length; i++){
    if (FLAGS[i][0].test(line) && !FLAGS[i][1].test(text)) return true;
  }
  return false;
}
function validateExplain(raw, evidence){
  const ev = evidence || {};
  /* A run's analysis is paragraphs: checked as one text, kept as paragraphs. */
  const paras = String(raw == null ? '' : raw).split(/\n\s*\n/).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  raw = paras.join(' ');
  const shown = (Array.isArray(ev.alreadyOnScreen) ? ev.alreadyOnScreen : []).concat(engineLines(ev));
  const base = NOTE.validateNote(raw, Object.assign({}, ev, { alreadyOnScreen: shown }), ev.kind === 'run' ? RUN_LIMITS : null);
  if (!base.ok) return base.why === 'duplicate' ? { ok: false, why: 'copied_engine' } : base;
  const text = base.note;
  if (/!/.test(text)) return { ok: false, why: 'exclamation' };
  const tone = ev.verdict && ev.verdict.tone;
  if ((tone === 'caution' || tone === 'recovery') && PRAISE.test(text)) return { ok: false, why: 'praise_against_verdict' };
  if (tone === 'recovery' && !RECOVERY_WORDS.test(text)) return { ok: false, why: 'softens_recovery' };
  if (tone === 'positive' && WORRY.test(text)) return { ok: false, why: 'worry_against_verdict' };
  if (missedFlag(text, ev)) return { ok: false, why: 'drops_verdict_flag' };
  if (ev.kind === 'week'){
    if (text.split(/(?<=[.!?])\s+/).filter(Boolean).length > 1) return { ok: false, why: 'week_not_one_sentence' };
    if (text.split(/\s+/).length > WEEK_MAX_WORDS) return { ok: false, why: 'week_too_long' };
  }
  if (ev.kind === 'run' && paras.length > 3) return { ok: false, why: 'too_many_paragraphs' };
  return { ok: true, text: ev.kind === 'run' ? paras.join('\n\n') : text };
}
function explainPayload(cfg, kind, evidenceJson, noEffort){
  const payload = {
    model: cfg.noteModel || cfg.model,
    max_tokens: EXPLAIN_MAX_TOKENS,
    system: SYSTEM[kind],
    messages: [{ role: 'user', content: 'evidence:\n' + evidenceJson + '\n\nWrite the paragraph.' }]
  };
  if (!noEffort) payload.output_config = { effort: 'low' };
  return payload;
}
function none(res, status, code){ return V.json(res, status, { text: null, code: code }); }

async function handle(req, res, deps){
  const D = deps || {};
  const config = D.voiceConfig || V.voiceConfig;
  const verifyUser = D.verifyUser || (r => V.verifyUser(r, require('./_strava.js').config()));
  const postModel = D.postModel || ASK.postModel;

  if (req.method !== 'POST'){ res.setHeader('Allow', 'POST'); return none(res, 405, 'method_not_allowed'); }
  const cfg = config();
  if (!cfg.enabled){ V.log('EXPLAIN refused voice_disabled'); return none(res, 403, 'VOICE_DISABLED'); }
  if (!cfg.apiKey){ V.log('EXPLAIN refused not_configured'); return none(res, 503, 'VOICE_NOT_CONFIGURED'); }
  const fault = ASK.keyFault(cfg.apiKey);
  if (fault){ V.log('EXPLAIN refused key_' + fault); return none(res, 503, 'VOICE_KEY_MALFORMED'); }

  /* A known account before anything is sent: it costs money, and a run log
     can carry health information. */
  const who = await verifyUser(req);
  if (!who || !who.uid){ V.log('EXPLAIN rejected ' + ((who && who.code) || 'no_user')); return none(res, 401, 'not_signed_in'); }

  const body = V.readBody(req) || {};
  const kind = KINDS.indexOf(body.kind) !== -1 ? body.kind : null;
  const evidence = (body.evidence && typeof body.evidence === 'object' && !Array.isArray(body.evidence)) ? body.evidence : null;
  if (!kind || !evidence) return none(res, 400, 'no_evidence');
  const v = evidence.verdict;
  if (!v || TONES.indexOf(v.tone) === -1 || !String(v.line || '').trim()) return none(res, 400, 'no_verdict');
  let evidenceJson = '';
  try { evidenceJson = JSON.stringify(evidence); } catch (e) { evidenceJson = ''; }
  if (!evidenceJson || evidenceJson.length > EVIDENCE_MAX_CHARS) return none(res, 413, 'evidence_too_large');
  /* Strava-derived data never reaches a model. The browser does not send it;
     if a marker arrives anyway, nothing is sent at all. */
  if (/stravaActivityId|strava_activity|"source"\s*:\s*"strava"/i.test(evidenceJson)){
    V.log('EXPLAIN REFUSED strava_marker_in_evidence');
    return none(res, 422, 'STRAVA_DERIVED_CONTEXT');
  }

  const started = Date.now();
  let resp;
  try {
    resp = await postModel(cfg, explainPayload(cfg, kind, evidenceJson));
    if (resp && resp.status === 400){
      V.log('EXPLAIN retrying without effort');
      resp = await postModel(cfg, explainPayload(cfg, kind, evidenceJson, true));
    }
  }
  catch (err){ V.log('EXPLAIN unreachable ' + ASK.transportFault(err)); return none(res, 502, 'coach_unavailable'); }
  if (!resp || !resp.ok){ V.log('EXPLAIN upstream ' + ((resp && resp.status) || 0)); return none(res, 502, 'coach_unavailable'); }
  let data = null;
  try { data = await resp.json(); } catch (e) { data = null; }
  if (data && data.stop_reason === 'refusal'){ V.log('EXPLAIN declined'); return none(res, 200, 'declined'); }
  const verdict = validateExplain(NOTE.textOf(data), evidence);
  const usage = (data && data.usage) || {};
  const cost = ' in=' + (usage.input_tokens || 0) + ' out=' + (usage.output_tokens || 0);
  if (!verdict.ok){
    V.log('EXPLAIN ' + kind + ' rejected_' + verdict.why + ' ms=' + (Date.now() - started) + cost);
    return none(res, 200, 'rejected_' + verdict.why);
  }
  V.log('EXPLAIN ' + kind + ' ok chars=' + verdict.text.length + ' ms=' + (Date.now() - started) + cost);
  return V.json(res, 200, { text: verdict.text });
}

module.exports = { handle, validateExplain, engineLines, FLAGS, explainPayload, SYSTEM, KINDS, TONES, PRAISE, WORRY };
