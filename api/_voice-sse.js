// Reading Anthropic's event stream, and deciding what counts as the answer.
// ===========================================================================
// THE ONE THING THIS FILE IS FOR. A streamed model turn is not one channel; it
// is several interleaved ones, identified by block index. On this model a turn
// typically looks like:
//
//     content_block_start  index 0  {type:"thinking"}
//     content_block_delta  index 0  {type:"thinking_delta", ...}   <- reasoning
//     content_block_stop   index 0
//     content_block_start  index 1  {type:"text"}
//     content_block_delta  index 1  {type:"text_delta", text:"..."} <- the answer
//     content_block_stop   index 1
//     message_delta                 {stop_reason:"end_turn"}
//     message_stop
//
// Only index 1 is the athlete's. THE FILTER IS POSITIVE, NOT NEGATIVE: a delta
// is forwarded when its block index was OPENED as type "text" and the delta
// itself is a "text_delta". Everything else -- a thinking block, a block whose
// start was never seen, a delta type this code does not know, a block type
// invented after this was written -- is not forwarded, because it was never
// affirmatively identified as the answer.
//
// WHY NOT JUST DROP thinking_delta. Because that is a blocklist, and a
// blocklist is only correct until the provider adds a name to it. Today
// thinking blocks stream with EMPTY text on this model (display defaults to
// "omitted"), so a negative filter would look perfect in every test and in
// production, right up until the day the default changed or a summarized
// display was enabled -- at which point reasoning would begin appearing inside
// the athlete's answer with nothing failing. The allowlist cannot have that
// failure mode: an unrecognised channel produces silence, not a leak.

/* A minimal SSE line reader. Anthropic frames each event as
     event: <name>\n
     data: <json>\n
     \n
   with the possibility of any of those lines being split across network
   chunks, so the incomplete tail is carried between feeds. */
function createEventReader(){
  let buf = '';
  return {
    feed(chunk){
      buf += String(chunk == null ? '' : chunk);
      const out = [];
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1){
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line) continue;                    // frame separator
        if (line.startsWith(':')) continue;     // comment / keepalive
        if (!line.startsWith('data:')) continue; // event: name -- the JSON carries `type`
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try{ out.push(JSON.parse(payload)); }
        catch(e){ /* a frame we cannot read is a frame we do not act on */ }
      }
      return out;
    }
  };
}

/* THE ANSWER CHANNEL, TRACKED BY INDEX.
   Returns { text, stopReason, done, sawText } for each event fed to it.
   `text` is only ever the athlete-facing answer. */
function createBlockFilter(){
  const textBlocks = Object.create(null);   // index -> true, ONLY for type "text"
  let stopReason = null;
  let done = false;
  let sawText = false;

  return {
    handle(ev){
      if (!ev || typeof ev !== 'object') return '';
      const type = ev.type;

      if (type === 'content_block_start'){
        const cb = ev.content_block || {};
        /* THE ALLOWLIST, and the only place a channel is ever opened. */
        if (cb.type === 'text') textBlocks[ev.index] = true;
        return '';
      }
      if (type === 'content_block_delta'){
        if (!textBlocks[ev.index]) return '';           // never opened as text
        const d = ev.delta || {};
        if (d.type !== 'text_delta') return '';          // not the text channel
        if (typeof d.text !== 'string') return '';
        if (d.text) sawText = true;
        return d.text;
      }
      if (type === 'content_block_stop') return '';
      if (type === 'message_delta'){
        const d = ev.delta || {};
        if (d.stop_reason) stopReason = d.stop_reason;
        return '';
      }
      if (type === 'message_stop'){ done = true; return ''; }
      /* `error` frames are surfaced by the caller through stopReason/done
         staying unset -- an incomplete stream, which is exactly what it is. */
      if (type === 'error'){
        stopReason = 'error';
        return '';
      }
      return '';
    },
    get stopReason(){ return stopReason; },
    get done(){ return done; },
    get sawText(){ return sawText; }
  };
}

module.exports = { createEventReader, createBlockFilter };
