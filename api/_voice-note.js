// Coach's Note, written. The second thing Sacoro asks a language model for,
// and it goes through the same door as the first.
//
//   POST { evidence } -> { note }            a note that passed every check
//                     -> { note: null, ... } anything else; the app keeps the
//                                            engine's own sentence
//
// Founder: "Upgrade Coach's Note to genuinely personalised, AI-written coaching
// using existing Anthropic integration and engine evidence. The engine retains
// all training decisions; AI explains, never invents data or changes
// prescriptions. Avoid duplicate observations and provide a safe fallback."
//
// WHAT THAT IS, AS CODE RATHER THAN AS A PROMISE:
//
//   * THE ENGINE HAS ALREADY DECIDED. `evidence` is what Sacoro's
//     deterministic engine concluded about this athlete and this session --
//     the decision, its reasons, the recovery reading, the check-in -- together
//     with the sentence the engine itself would print. The model is asked to
//     say that, to this athlete, well. It is given no training record to
//     reason from and cannot ask for one.
//   * THE REPLY IS TEXT, AND ONLY TEXT. There is no flag here that proposes a
//     plan change, no structured field the app acts on, nothing that names a
//     session to move. This endpoint cannot alter a prescription because it has
//     no way to express one.
//   * THE REPLY IS CHECKED BEFORE IT IS RETURNED. Every number in it must be a
//     number in the evidence. It may not announce a change to the plan, tell
//     the athlete to skip, swap or shorten anything the engine did not, give
//     medical advice, or repeat a line already on the screen. validateNote() is
//     that check, and a reply that fails it is discarded, not repaired.
//   * THE FALLBACK IS THE DEFAULT, NOT THE EXCEPTION. Disabled, unconfigured,
//     signed out, refused, timed out, malformed or rejected: every one of
//     those returns no note, and the app goes on showing the engine's sentence,
//     which it was already showing. Nothing waits on this call.
//
// ONE MODEL CALL SITE. The endpoint is named in _voice-ask.js and nowhere else;
// this file sends through postModel() exported from there, so "how many places
// can reach a model" is still answered by one grep. Like that file, this one
// reads no database and no service-role key.

const V = require('./_voice.js');
const ASK = require('./_voice-ask.js');

/* The same headroom the conversation uses, for the same reason: thinking is
   drawn from this budget, and a ceiling sized to a two-sentence answer leaves
   no text block at all. The ceiling is not a target. */
const NOTE_MAX_TOKENS = 16000;
const NOTE_MAX_CHARS = 340;
const NOTE_MIN_CHARS = 24;
const EVIDENCE_MAX_CHARS = 6000;

const SYSTEM = [
  'You write the Coach\'s Note that sits under one athlete\'s next running session in the Sacoro app.',
  '',
  'WHAT YOU ARE GIVEN. A JSON object called evidence. It holds what Sacoro\'s own coaching engine',
  'has ALREADY concluded about this athlete going into this session: its decision, the reasons for',
  'it, how recovery reads, anything the athlete reported this morning, and "engineNote" -- the',
  'sentence the engine itself would print. The engine made every training decision. You make none.',
  '',
  'WHAT YOU WRITE. One or two sentences, at most 45 words, in plain text, that tell this athlete',
  'what the engine sees in them and what that means for how they run this session. Say what',
  'engineNote says, in a coach\'s own words, made specific by the other evidence. If the evidence',
  'adds nothing to engineNote, return engineNote\'s meaning plainly rather than padding it.',
  '',
  'HARD RULES.',
  '1. Use only facts in evidence. Never state a number, a pace, a distance, a heart rate, a day or',
  '   a count that is not written there.',
  '2. Never change the session and never suggest changing it. Do not tell the athlete to skip,',
  '   swap, shorten, extend, move or replace anything unless engineNote says so in those terms.',
  '   Never say the plan has changed.',
  '3. If evidence.decision is "recover", say that recovery comes before this session. Do not soften',
  '   it and do not add to it.',
  '4. No medical advice and no diagnosis. For pain or illness, say only what engineNote says.',
  '5. Do not repeat or paraphrase closely any line in evidence.alreadyOnScreen. The athlete is',
  '   reading those right beside your note.',
  '6. No praise the evidence does not earn, and no generic advice that would be true of anybody.',
  '7. Never mention evidence, data, the engine, an algorithm, AI, or yourself.',
  '',
  'HOW IT SOUNDS. A serious coach talking to an adult athlete: calm, direct, British, second',
  'person. No greeting, no sign-off, no headings, no lists, no emoji, no quotation marks.',
  'Reply with the note and nothing else.'
].join('\n');

function clean(s, max){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}
/* Every run of digits, as the athlete would read it: "12", "0.74", "5:20". */
function numbersIn(text){
  return (String(text == null ? '' : text).match(/\d+(?:[.:]\d+)*/g) || []);
}
function norm(s){
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/* Words that change what the athlete was told to do. Allowed only where the
   engine used them first. */
const CHANGE_WORDS = ['skip', 'swap', 'replace', 'shorten', 'cut short', 'extend', 'add another', 'drop the',
  'rest day instead', 'take the day off', 'take today off', 'move the', 'postpone', 'cancel', 'do not run',
  'don\'t run', 'instead run', 'run it tomorrow'];
const NEVER = [
  [/\b(i|we)(?:'ve| have)\s+(?:changed|moved|adjusted|reduced|swapped|updated|rewritten)\b/i, 'claims_change'],
  [/\byour (?:plan|session|schedule|programme) (?:has been|is now|was) (?:changed|adjusted|updated|moved|reduced)\b/i, 'claims_change'],
  [/\b(?:as an ai|language model|algorithm|the engine|the data (?:shows|says)|evidence (?:shows|says|suggests))\b/i, 'mentions_machine'],
  [/\b(?:diagnos|ibuprofen|paracetamol|anti-inflammator|medication|tablet|dose)\w*/i, 'medical'],
  [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'emoji'],
  [/^\s*[-*#]|\n\s*[-*#]/, 'markup']
];
/* THE CHECK. Returns { ok:true, note } or { ok:false, why }. Pure, so the same
   cases can be put to the copy of it the browser runs before it shows
   anything -- see coachNoteValid() in the app. */
function validateNote(raw, evidence){
  const note = clean(raw, 2000).replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (note.length < NOTE_MIN_CHARS) return { ok: false, why: 'too_short' };
  if (note.length > NOTE_MAX_CHARS) return { ok: false, why: 'too_long' };
  const sentences = note.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 3) return { ok: false, why: 'too_many_sentences' };
  for (let i = 0; i < NEVER.length; i++) if (NEVER[i][0].test(note)) return { ok: false, why: NEVER[i][1] };

  let ev = '';
  try { ev = JSON.stringify(evidence == null ? {} : evidence); } catch (e) { ev = ''; }
  /* A number the evidence does not contain is an invented one. */
  const known = new Set(numbersIn(ev));
  const stray = numbersIn(note).filter(n => !known.has(n));
  if (stray.length) return { ok: false, why: 'invented_number' };

  /* An instruction to change the session that the engine did not give. */
  const evLower = ev.toLowerCase(), noteLower = note.toLowerCase();
  for (let i = 0; i < CHANGE_WORDS.length; i++){
    const w = CHANGE_WORDS[i];
    if (noteLower.indexOf(w) !== -1 && evLower.indexOf(w) === -1) return { ok: false, why: 'changes_prescription' };
  }
  /* The engine said recover: the note must say so. */
  if (evidence && evidence.decision === 'recover' && !/recover/i.test(note)) return { ok: false, why: 'softens_recover' };

  /* A line the athlete is already reading. */
  const shown = (evidence && Array.isArray(evidence.alreadyOnScreen)) ? evidence.alreadyOnScreen : [];
  const noteNorm = norm(note);
  for (let i = 0; i < shown.length; i++){
    const parts = String(shown[i] == null ? '' : shown[i]).split(/(?<=[.!?])\s+/);
    for (let j = 0; j < parts.length; j++){
      const p = norm(parts[j]);
      if (p.length >= 24 && noteNorm.indexOf(p) !== -1) return { ok: false, why: 'duplicate' };
    }
  }
  return { ok: true, note: note };
}
/* What is actually sent. Bounded here as well as in the browser: a browser is
   not a trusted producer of payload size. */
function notePayload(cfg, evidenceJson, noEffort){
  const payload = {
    model: cfg.model,
    max_tokens: NOTE_MAX_TOKENS,
    system: SYSTEM,
    messages: [{ role: 'user', content: 'evidence:\n' + evidenceJson + '\n\nWrite the Coach\'s Note.' }]
  };
  /* A tuning knob, not a requirement -- as it is for the conversation. */
  if (!noEffort) payload.output_config = { effort: 'low' };
  return payload;
}
function textOf(data){
  const blocks = (data && Array.isArray(data.content)) ? data.content : [];
  return blocks.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
}
/* Every refusal has the same shape, so the app has one thing to do with all of
   them: nothing. `code` is a fixed word for the log and the tests. */
function none(res, status, code){
  return V.json(res, status, { note: null, code: code });
}

async function handle(req, res, deps){
  const D = deps || {};
  const config = D.voiceConfig || V.voiceConfig;
  const verifyUser = D.verifyUser || (r => V.verifyUser(r, require('./_strava.js').config()));
  const postModel = D.postModel || ASK.postModel;

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return none(res, 405, 'method_not_allowed');
  }
  const cfg = config();
  if (!cfg.enabled){ V.log('NOTE refused voice_disabled'); return none(res, 403, 'VOICE_DISABLED'); }
  if (!cfg.apiKey){ V.log('NOTE refused not_configured'); return none(res, 503, 'VOICE_NOT_CONFIGURED'); }
  const fault = ASK.keyFault(cfg.apiKey);
  if (fault){ V.log('NOTE refused key_' + fault); return none(res, 503, 'VOICE_KEY_MALFORMED'); }

  /* A known account, before anything is sent: this costs money per call, and
     the evidence can carry health information. */
  const who = await verifyUser(req);
  if (!who || !who.uid){ V.log('NOTE rejected ' + ((who && who.code) || 'no_user')); return none(res, 401, 'not_signed_in'); }

  const body = V.readBody(req) || {};
  const evidence = (body.evidence && typeof body.evidence === 'object' && !Array.isArray(body.evidence)) ? body.evidence : null;
  if (!evidence || !clean(evidence.engineNote, 600)) return none(res, 400, 'no_evidence');
  let evidenceJson = '';
  try { evidenceJson = JSON.stringify(evidence); } catch (e) { evidenceJson = ''; }
  if (!evidenceJson || evidenceJson.length > EVIDENCE_MAX_CHARS) return none(res, 413, 'evidence_too_large');

  /* THE SAME BOUNDARY AS THE CONVERSATION, and the same answer to "something
     is wrong" on it: send nothing at all. The browser does not assemble
     evidence for an athlete who holds Strava-derived days; if a marker arrives
     anyway, refusing costs one unwritten note and guessing costs a breach. */
  if (/stravaActivityId|strava_activity|"source"\s*:\s*"strava"/i.test(evidenceJson)){
    V.log('NOTE REFUSED strava_marker_in_evidence');
    return none(res, 422, 'STRAVA_DERIVED_CONTEXT');
  }

  const started = Date.now();
  let resp;
  try {
    resp = await postModel(cfg, notePayload(cfg, evidenceJson));
    /* The one retry the conversation also makes: a request rejected as
       malformed is sent once more without the effort setting. */
    if (resp && resp.status === 400){
      V.log('NOTE retrying without effort');
      resp = await postModel(cfg, notePayload(cfg, evidenceJson, true));
    }
  }
  catch (err){ V.log('NOTE unreachable ' + ASK.transportFault(err)); return none(res, 502, 'coach_unavailable'); }
  if (!resp || !resp.ok){ V.log('NOTE upstream ' + ((resp && resp.status) || 0)); return none(res, 502, 'coach_unavailable'); }
  let data = null;
  try { data = await resp.json(); } catch (e) { data = null; }
  if (data && data.stop_reason === 'refusal'){ V.log('NOTE declined'); return none(res, 200, 'declined'); }
  const verdict = validateNote(textOf(data), evidence);
  if (!verdict.ok){
    /* A fixed word, never the text: a rejected note can be about pain. */
    V.log('NOTE rejected_' + verdict.why + ' ms=' + (Date.now() - started));
    return none(res, 200, 'rejected_' + verdict.why);
  }
  V.log('NOTE ok chars=' + verdict.note.length + ' ms=' + (Date.now() - started));
  return V.json(res, 200, { note: verdict.note });
}

module.exports = { handle, validateNote, notePayload, textOf, numbersIn, SYSTEM,
                   NOTE_MAX_CHARS, NOTE_MIN_CHARS, EVIDENCE_MAX_CHARS, CHANGE_WORDS };
