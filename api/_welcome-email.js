'use strict';
/* THE FOUNDER WELCOME EMAIL.
 *
 * One email, from Dan, the first time an athlete actually gets into Valhalla.
 *
 * IT IS NOT AN AUTH EMAIL, and the separation is deliberate rather than
 * incidental. Supabase sends the magic link, from its own templates, through
 * its own SMTP; this is sent by us, through Resend's API, from a different
 * address, and carries no credential of any kind. Folding the two together
 * would put a marketing-shaped message on the path that decides whether
 * somebody can sign in -- and the first time the welcome copy broke, nobody
 * would be able to get in.
 *
 * WHAT MAKES IT SEND ONCE. Not this file. The database: one row per athlete
 * whose PRIMARY KEY is the lock, claimed in a single INSERT ... ON CONFLICT DO
 * UPDATE. Two simultaneous first sign-ins are serialised by Postgres, one is
 * told to send and the other is told not to, and there is no window between
 * them. See supabase-welcome-email.sql.
 *
 * IT CAN NEVER BLOCK A SIGN-IN. Every path returns a report; nothing throws to
 * the caller. A provider outage produces an athlete who is signed in and not
 * yet welcomed, which is retried on their next few visits and then given up on.
 * At most once is guaranteed; at least once is not, and pretending otherwise is
 * how an athlete ends up receiving three copies.
 *
 * WHAT IT KNOWS ABOUT THE ATHLETE. Their email address, for the duration of one
 * request, taken from their own verified token. It is not stored, not logged,
 * not sent anywhere else, and it is the only personal datum this file touches.
 * No name, no training, no health information, no plan, nothing about how they
 * are doing -- there is nowhere in the copy for any of it to go.
 */

const RESEND_API = 'https://api.resend.com/emails';

/* The identity the athlete sees, and the address a reply reaches. Both are the
   same inbox on purpose: a welcome from a founder that bounces when you answer
   it is worse than no welcome. */
const FROM = 'Dan from Velvet Viking <support@velvetviking.co.uk>';
const REPLY_TO = 'support@velvetviking.co.uk';
const SUBJECT = 'Welcome to Valhalla — the flagship app from Velvet Viking';

/* Ten seconds. A sign-in already waited for an entitlement read and a lease
   write; it must not also wait indefinitely for an email provider. The claim
   has already been recorded by the time this runs, so a timeout is a retry on
   the next visit rather than a lost email. */
const SEND_TIMEOUT_MS = 10000;

function log(what){ try{ console.log('welcome-email: ' + what); }catch(e){} }

/* OFF UNLESS SOMEBODY SAYS SO, like every other outward integration here.
   A merge must not be able to start emailing real athletes; that is a decision,
   not a deployment. */
function config(env){
  const e = env || process.env;
  const key = String(e.RESEND_API_KEY || '').trim();
  return {
    enabled: String(e.VVV_WELCOME_EMAIL || '').trim().toLowerCase() === 'on',
    hasKey: !!key,
    /* Read through a function, never captured at module scope: Vercel evaluates
       module scope once per cold start and a captured key would outlive a
       rotation. */
    key: function(){ return key; },
    from: String(e.VVV_WELCOME_FROM || FROM).trim(),
    replyTo: String(e.VVV_WELCOME_REPLY_TO || REPLY_TO).trim()
  };
}

/* ---------------------------------------------------------------------------
 * THE COPY
 *
 * Verbatim, in one place, and shared by both renderings so the plain-text part
 * cannot drift from the HTML. A recipient whose client shows text and a
 * recipient whose client shows HTML have to be reading the same letter.
 * ------------------------------------------------------------------------- */
const PARAGRAPHS = [
  'Welcome to Valhalla!',
  "My name is Dan, and I'm the founder and CEO of Velvet Viking and its flagship Valhalla app.",
  "You're now part of Valhalla, and I'm genuinely glad you're here.",
  'I built this because I wanted something that actually felt like having a coach, ' +
    'something that pays attention to your training, learns from it and helps you make ' +
    'better decisions, rather than just handing you a plan.',
  'So, train hard, train smart and earn your place.'
];
const SIGN_OFF = ['Thank you,', 'Dan', 'Founder, Velvet Viking'];

function escapeHtml(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Plain text, for the clients that show it and for anyone reading with a screen
   reader that prefers it. Not an afterthought: a text part is also what stops a
   spam filter treating an HTML-only message as suspicious. */
function textBody(){
  return PARAGRAPHS.join('\n\n') + '\n\n' + SIGN_OFF.join('\n') + '\n';
}

/* The same visual system as the auth emails, for the same reasons written out
   in supabase-auth-emails/: no images, because clients block them by default
   and a remote fetch from an email is a read receipt nobody agreed to; inline
   styles, because Gmail strips <style> on some mobile views; the product's own
   colours rather than new ones.
   
   NO CALL TO ACTION. There is nothing to ask for -- the athlete is already in.
   A button here would be the first piece of marketing clutter, and every one
   after it would be easier to add. */
function htmlBody(){
  const P = (t) =>
    '            <p style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,' +
    "'Segoe UI',Helvetica,Arial,sans-serif; font-size:15px; line-height:1.7; color:#514D45;\">\n" +
    '              ' + escapeHtml(t) + '\n            </p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(SUBJECT)}</title>
</head>
<body style="margin:0; padding:0; background-color:#F4F1EA; -webkit-text-size-adjust:100%;">

<div style="display:none; font-size:1px; color:#F4F1EA; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
  ${escapeHtml(PARAGRAPHS[2])}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F1EA;">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px; width:100%;">

        <tr>
          <td align="center" style="padding:0 0 22px;">
            <div style="font-family:Cinzel,Georgia,'Times New Roman',serif; font-size:15px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase; color:#7A5C1E;">
              Velvet&nbsp;Viking
            </div>
          </td>
        </tr>

        <tr>
          <td style="background-color:#FCFBFB; border:1px solid #DAD1BB; border-radius:16px; padding:34px 28px;">

            <h1 style="margin:0 0 20px; font-family:Cinzel,Georgia,'Times New Roman',serif; font-size:19px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#171717; line-height:1.35;">
              Welcome to Valhalla
            </h1>

${PARAGRAPHS.map(P).join('\n')}

            <div style="height:1px; background-color:#DAD1BB; margin:26px 0 22px;"></div>

            <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; font-size:15px; line-height:1.7; color:#171717;">
              ${escapeHtml(SIGN_OFF[0])}<br>
              <strong style="font-weight:600;">${escapeHtml(SIGN_OFF[1])}</strong><br>
              <span style="color:#5D574C; font-size:13px;">${escapeHtml(SIGN_OFF[2])}</span>
            </p>

          </td>
        </tr>

        <tr>
          <td align="center" style="padding:26px 8px 0;">
            <div style="font-family:Cinzel,Georgia,'Times New Roman',serif; font-size:11px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase; color:#5D574C;">
              Velvet&nbsp;Viking
            </div>
            <div style="margin-top:6px; font-family:Oswald,'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:#5D574C;">
              Earn&nbsp;Your&nbsp;Place
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>
`;
}

/* ---------------------------------------------------------------------------
 * THE PROVIDER CALL
 *
 * A code out, never Resend's message: its error bodies echo the request, and
 * the request carries the athlete's address.
 * ------------------------------------------------------------------------- */
async function sendViaResend(cfg, toEmail, deps){
  const d = deps || {};
  const fetchFn = d.fetch || globalThis.fetch;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(function(){ controller.abort(); }, SEND_TIMEOUT_MS) : null;

  try{
    const r = await fetchFn(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.key(),
        'Content-Type': 'application/json'
      },
      /* reply_to so an athlete answering the founder reaches a real inbox.
         No tags, no headers, no tracking parameters: nothing here asks Resend
         to record whether the email was opened or a link was followed, because
         nothing in it needs to know. */
      body: JSON.stringify({
        from: cfg.from,
        to: [toEmail],
        reply_to: cfg.replyTo,
        subject: SUBJECT,
        html: htmlBody(),
        text: textBody()
      }),
      signal: controller ? controller.signal : undefined
    });

    if (!r || !r.ok){
      const status = r ? r.status : 0;
      return { ok: false, code: 'resend_http_' + status,
               transient: status === 0 || status === 429 || status >= 500 };
    }
    return { ok: true };
  }catch(e){
    const aborted = e && (e.name === 'AbortError');
    return { ok: false, code: aborted ? 'resend_timeout' : 'resend_unreachable', transient: true };
  }finally{
    if (timer) clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * THE ONE ENTRY POINT
 *
 * Called after a lease has been minted -- which is the moment an athlete has
 * genuinely got in, as distinct from having asked to. Returns a report and
 * never throws. The caller is not expected to do anything with it except log.
 * ------------------------------------------------------------------------- */
async function welcomeIfFirstEntry(S, cfg, accountId, email, deps){
  const c = (deps && deps.config) || config();

  if (!c.enabled) return { ok: false, code: 'welcome_email_disabled' };
  if (!c.hasKey){ log('NOT_CONFIGURED'); return { ok: false, code: 'not_configured' }; }
  if (!accountId || !email) return { ok: false, code: 'no_recipient' };

  /* 1. CLAIM FIRST, ALWAYS. Claiming before sending can lose an email; sending
        before claiming can send it twice. One of those is recoverable by the
        athlete asking, and the other is not recoverable at all. */
  let claimed = false;
  try{
    const r = await S.sb(cfg, '/rpc/claim_welcome_email', {
      method: 'POST', body: JSON.stringify({ p_account_id: accountId })
    });
    if (!r || !r.ok){ log('CLAIM_FAILED status=' + (r ? r.status : 'none')); return { ok: false, code: 'claim_failed' }; }
    claimed = (await r.json().catch(function(){ return false; })) === true;
  }catch(e){
    log('CLAIM_THREW');
    return { ok: false, code: 'claim_failed' };
  }

  if (!claimed) return { ok: false, code: 'already_welcomed' };

  // 2. Send.
  const sent = await sendViaResend(c, email, deps);

  if (!sent.ok){
    /* The claim stands and sent_at is still null, so the next sign-in will try
       again -- up to the attempt limit the database enforces. A code is
       recorded so "the provider refused" is distinguishable from "nobody has
       signed in since". */
    try{
      await S.sb(cfg, '/rpc/record_welcome_email_failure', {
        method: 'POST', body: JSON.stringify({ p_account_id: accountId, p_code: sent.code })
      });
    }catch(e){ /* the failure of a failure record is not worth a second one */ }
    log('SEND_FAILED code=' + sent.code + ' transient=' + (sent.transient ? 1 : 0));
    return { ok: false, code: sent.code, willRetry: !!sent.transient };
  }

  // 3. Only now is it sent.
  try{
    await S.sb(cfg, '/rpc/mark_welcome_email_sent', {
      method: 'POST', body: JSON.stringify({ p_account_id: accountId })
    });
  }catch(e){
    /* Sent but not stamped. The retry guard is attempts < 3, so the worst case
       is bounded rather than unbounded -- and it is logged loudly because it is
       the one path that can produce a second copy. */
    log('SENT_BUT_UNSTAMPED');
    return { ok: true, code: 'sent_unstamped' };
  }

  log('SENT');
  return { ok: true, code: 'sent' };
}

module.exports = {
  FROM, REPLY_TO, SUBJECT, PARAGRAPHS, SIGN_OFF, SEND_TIMEOUT_MS, RESEND_API,
  config, htmlBody, textBody, sendViaResend, welcomeIfFirstEntry
};
