'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE AUTH EMAILS.
//
// These are the only Velvet Viking surface that is not served by this
// deployment: Supabase renders them, from templates pasted into its dashboard.
// That is exactly why they live here. A template that exists only in a
// dashboard has no history, no review, no test, and no way to tell whether the
// thing in production is the thing anybody agreed to.
//
// The security properties are the point, not the styling. A magic-link email
// carries a single-use credential, and there are three ways to ruin one:
//
//   build the link by hand from {{ .Token }} and a site URL, which sends every
//   athlete to the web even when they tapped from the installed app -- the
//   exact commissioning failure recorded in api/beta-signin.js;
//   print the URL as visible text, which puts a working credential somewhere it
//   can be screenshotted, forwarded or read over a shoulder;
//   name the infrastructure provider, which is what this pass exists to remove.

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'supabase-auth-emails');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const FILES = fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort();

/* Reachability, decided by the code rather than by which slots Supabase offers.
   api/beta-signin.js posts to /auth/v1/otp with create_user:true, so one
   endpoint produces two different emails depending on whether the athlete
   already exists -- and the signup one is the FIRST email anybody ever gets. */
const REACHABLE = ['change-email.html', 'confirm-signup.html', 'invite.html', 'magic-link.html'];

test('exactly the reachable templates exist, and no unreachable one', () => {
  assert.deepEqual(FILES, REACHABLE);
  // Password reset and reauthentication are Supabase template slots that this
  // product cannot reach: there is no password anywhere, which is asserted
  // elsewhere in the suite. Authoring them would imply a flow that does not
  // exist and invite somebody to wire one up.
  for (const absent of ['reset-password.html', 'recovery.html', 'reauthentication.html']){
    assert.equal(fs.existsSync(path.join(DIR, absent)), false,
      absent + ' describes a flow this product does not have');
  }
});

test('both templates one endpoint can produce are identical', () => {
  /* /auth/v1/otp with create_user:true sends the SIGNUP confirmation to an
     address that has never signed in and the MAGIC LINK to one that has. The
     athlete asked for a sign-in link either way and should not be able to tell
     which of Supabase's internal paths they took, so the two are the same
     email -- and asserted identical rather than kept in step by hand. */
  assert.equal(read('confirm-signup.html'), read('magic-link.html'));
});

// ===========================================================================
// THE LINK
// ===========================================================================
test('every template hands over Supabase"s own URL, untouched', () => {
  for (const f of FILES){
    const src = read(f);
    assert.match(src, /href="\{\{ \.ConfirmationURL \}\}"/,
      f + ' does not use the provider-built URL');
    assert.equal((src.match(/\{\{ \.ConfirmationURL \}\}/g) || []).length, 1,
      f + ' repeats the credential');
  }
});

test('no template builds a link of its own, which is how the app deep link breaks', () => {
  /* {{ .ConfirmationURL }} points at the project's /auth/v1/verify, which 302s
     to whatever redirect_to the server passed -- the custom scheme for the
     installed app, the site for the web. Hand-building from {{ .Token }} and
     {{ .SiteURL }} throws that away and sends every athlete to the web. */
  for (const f of FILES){
    const src = read(f);
    for (const forbidden of [/\{\{ ?\.Token ?\}\}/, /\{\{ ?\.TokenHash ?\}\}/,
                             /\{\{ ?\.SiteURL ?\}\}/, /\{\{ ?\.RedirectTo ?\}\}/]){
      assert.equal(forbidden.test(src), false, f + ' uses ' + forbidden + ' to build its own link');
    }
    // And no absolute destination of any kind, which would be the same mistake
    // written literally.
    const hrefs = (src.match(/href="([^"]*)"/g) || []).map(h => h.slice(6, -1));
    for (const h of hrefs){
      assert.equal(h, '{{ .ConfirmationURL }}', f + ' has a hard-coded href: ' + h);
    }
  }
});

test('the credential never appears as visible text', () => {
  for (const f of FILES){
    const src = read(f);
    const visible = src.replace(/<[^>]+>/g, ' ');
    assert.equal(/ConfirmationURL|Token/.test(visible), false,
      f + ' prints a single-use credential where it can be read, forwarded or screenshotted');
  }
});

// ===========================================================================
// NO PROVIDER BRANDING
// ===========================================================================
test('nothing customer-facing names the infrastructure', () => {
  for (const f of FILES){
    const src = read(f);
    assert.equal(/supabase|gotrue|resend|postmark|amazonses|sendgrid/i.test(src), false,
      f + ' names a provider');
    assert.equal(/powered by/i.test(src), false, f + ' carries a provider footer');
  }
});

test('the brand is Velvet Viking, said the way the product says it', () => {
  for (const f of FILES){
    const src = read(f);
    assert.match(src, /Velvet&nbsp;Viking/, f + ' has no wordmark');
    assert.match(src, /Earn&nbsp;Your&nbsp;Place/, f + ' has no tagline');
    assert.match(src, /Valhalla/, f + ' never names the product');
  }
});

test('the copy is exactly what was approved', () => {
  const m = read('magic-link.html');
  for (const line of ['Sign in to Valhalla',
                      'Your secure sign-in link is ready.',
                      'Use the button below to continue to Valhalla.',
                      'This link expires shortly and can only be used once.']){
    assert.ok(m.indexOf(line) !== -1, 'the approved line is missing: ' + line);
  }
  assert.match(m, /If you didn&rsquo;t request this email, you can safely ignore it\./);
});

// ===========================================================================
// IT HAS TO RENDER IN A MAIL CLIENT
// ===========================================================================
test('every template is well-formed and self-contained', () => {
  /* Tag balance, checked directly rather than through a lenient HTML parser.
     A parser that accepts anything proves nothing about an email, and an
     unclosed <td> is the specific failure that collapses a table layout in
     Outlook while looking perfect in every browser. */
  const PAIRED = ['html', 'head', 'body', 'table', 'tr', 'td', 'a', 'p', 'h1', 'div', 'title'];
  for (const f of FILES){
    const src = read(f);
    const stripped = src.replace(/<!--[\s\S]*?-->/g, ' ');
    for (const tag of PAIRED){
      const open = (stripped.match(new RegExp('<' + tag + '(?=[\\s>])', 'gi')) || []).length;
      const close = (stripped.match(new RegExp('</' + tag + '>', 'gi')) || []).length;
      assert.equal(open, close, f + ': <' + tag + '> opened ' + open + ' times, closed ' + close);
    }
    // No remote asset. Images are blocked by default in most clients, and a
    // remote fetch from an email is a read receipt the athlete did not agree to.
    assert.equal(/<img|background-image|url\(/i.test(src), false, f + ' loads a remote asset');
    assert.equal(/<script|javascript:/i.test(src), false, f + ' carries script');
    // Inline styles only: several clients strip <style> in the body, and Gmail
    // strips it entirely on some mobile views.
    assert.equal(/<style/i.test(src), false, f + ' relies on a stylesheet block');
  }
});

test('the button survives Outlook, which ignores padding on an anchor', () => {
  for (const f of FILES){
    const src = read(f);
    const cta = src.slice(src.indexOf('<!-- CTA'), src.indexOf('</table>', src.indexOf('<!-- CTA')));
    assert.match(cta, /bgcolor="#C0923F"/, f + ': the cell must carry the colour, not just the CSS');
    assert.match(cta, /display:block/, f + ': the anchor must fill the cell');
  }
});

test('layout tables are hidden from a screen reader', () => {
  for (const f of FILES){
    const src = read(f);
    const tables = (src.match(/<table[^>]*>/g) || []);
    assert.ok(tables.length >= 3);
    for (const t of tables){
      assert.match(t, /role="presentation"/, f + ' has a layout table read as data: ' + t);
    }
  }
});

test('the palette is the product"s, and every pairing passes AA', () => {
  // Not a claim -- computed. #171717 on #FCFBFB is 17.36:1, #514D45 is 8.14:1,
  // #5D574C is 6.93:1, the gold wordmark #7A5C1E is 6.02:1, and the button ink
  // #1A1204 on bronze #C0923F is 6.56:1.
  const lum = (h) => {
    const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255)
      .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); const [hi, lo] = x > y ? [x, y] : [y, x];
    return (hi + 0.05) / (lo + 0.05); };

  const CARD = '#FCFBFB', PAPER = '#F4F1EA';
  const pairs = [['#171717', CARD], ['#514D45', CARD], ['#5D574C', CARD],
                 ['#7A5C1E', PAPER], ['#5D574C', PAPER], ['#1A1204', '#C0923F']];
  for (const [fg, bg] of pairs){
    assert.ok(ratio(fg, bg) >= 4.5, fg + ' on ' + bg + ' is ' + ratio(fg, bg).toFixed(2) + ':1');
  }
  // And those colours are the app's own tokens, not invented for the email.
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'vvv-shell.css'), 'utf8');
  for (const hex of ['#F4F1EA', '#171717', '#7A5C1E', '#C0923F', '#1A1204', '#DAD1BB']){
    assert.ok(css.toUpperCase().indexOf(hex) !== -1,
      hex + ' is in the email and is not one of the product"s colours');
  }
  // Every colour used in a template must be one we checked.
  const known = new Set(['#F4F1EA', '#FCFBFB', '#171717', '#514D45', '#5D574C',
                         '#7A5C1E', '#C0923F', '#1A1204', '#DAD1BB']);
  for (const f of FILES){
    for (const hex of (read(f).match(/#[0-9A-Fa-f]{6}/g) || [])){
      assert.ok(known.has(hex.toUpperCase()), f + ' uses an unchecked colour ' + hex);
    }
  }
});

test('it is mobile-first and does not force a desktop width', () => {
  for (const f of FILES){
    const src = read(f);
    assert.match(src, /name="viewport"/, f + ' has no viewport');
    assert.match(src, /max-width:560px; width:100%/, f + ' has a fixed width');
  }
});

// ===========================================================================
// THE AUTH SEMANTICS ARE NOT THE EMAIL"S TO CHANGE
// ===========================================================================
test('branding changed no auth behaviour', () => {
  const signin = fs.readFileSync(path.join(ROOT, 'api', 'beta-signin.js'), 'utf8');
  // The allowlist gate, the validated redirect, and the publishable key.
  assert.match(signin, /if \(!check\.approved\)\{/);
  assert.match(signin, /const redirect = safeRedirect\(body\.redirect, origins\);/);
  assert.match(signin, /'\/auth\/v1\/otp\?redirect_to=' \+ encodeURIComponent\(redirect\)/);
  assert.match(signin, /'apikey': cfg\.anonKey/);
  assert.equal(/serviceKey/.test(signin.slice(signin.indexOf('/auth/v1/otp') - 200,
                                              signin.indexOf('/auth/v1/otp') + 400)), false,
    'the sign-in route must not be able to mint a session');
});

test('the commissioning document exists and states what is dashboard-only', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'AUTH-EMAIL-TEMPLATES.md'), 'utf8');
  for (const f of FILES) assert.ok(doc.indexOf(f) !== -1, doc + ' does not mention ' + f);
  assert.match(doc, /Your Valhalla sign-in link/);
  assert.match(doc, /dashboard/i);
  // The subject line for every template is stated, because Supabase stores it
  // separately from the body and pasting the body alone leaves the old one.
  assert.match(doc, /Subject/);
});
