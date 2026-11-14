'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/* CIRCLES: THE DATABASE.

   Founder: "Joining a circle must require explicit consent, and each athlete
   should be able to leave, hide their training details and stop sharing
   without affecting their SACORO programme." And: small (2 to 8), one circle
   each, missed sessions shown, km optional and off by default, "Nice work"
   once per session, nothing pushed to the phone.

   The text laws below hold the shape of supabase-circles.sql in place. The
   last test runs the real proof -- acting as people on a disposable Postgres
   -- wherever Postgres is installed. */

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase-circles.sql'), 'utf8');
const code = SQL.replace(/--[^\n]*/g, '');
const table = name => {
  const m = code.match(new RegExp('create table if not exists public\\.' + name + ' \\(([\\s\\S]*?)\\n\\);'));
  assert.ok(m, name + ' is not created');
  return m[1];
};
const policiesOn = t => [...code.matchAll(new RegExp('create policy "([^"]+)" on public\\.' + t + '\\n\\s+for (\\w+) to (\\w+)', 'g'))]
  .map(m => ({ name: m[1], cmd: m[2], role: m[3] }));

const TABLES = ['circles', 'circle_members', 'circle_invites', 'circle_days', 'circle_cheers', 'circle_sharing_log'];

test('every circle table is created with row-level security on', () => {
  TABLES.forEach(t => {
    table(t);
    assert.match(code, new RegExp('alter table public\\.' + t + ' enable row level security;'), t + ' has no RLS');
  });
});

test('one circle per person, and joining cannot happen without recorded consent', () => {
  const m = table('circle_members');
  assert.match(m, /user_id\s+uuid\s+primary key references auth\.users\(id\) on delete cascade/,
    'a person could be in two circles');
  assert.match(m, /consent_version text\s+not null/);
  assert.match(m, /consented_at\s+timestamptz not null/);
  assert.match(m, /show_km\s+boolean\s+not null default false/, 'km must start OFF');
  assert.match(m, /sharing\s+boolean\s+not null default true/);
});

test('a circle holds 8, checked on both inviting and joining, under a lock', () => {
  assert.equal((code.match(/>= 8 then/g) || []).length, 2);
  const join = code.slice(code.indexOf('function public.circle_join'), code.indexOf('function public.circle_set_sharing'));
  assert.match(join, /for update;[\s\S]*>= 8 then/, 'two people accepting at once could make it nine');
});

test('the circle sees only what the table needs, and never a reason or a body', () => {
  const d = table('circle_days');
  const cols = [...d.matchAll(/^\s*(\w+)\s+(?:uuid|date|text|numeric|timestamptz)/gm)].map(m => m[1]);
  assert.deepEqual(cols, ['user_id', 'day', 'state', 'session_label', 'km', 'updated_at']);
  assert.match(d, /state in \('done','missed','rest','restricted','planned'\)/);
  assert.match(d, /check \(state <> 'restricted' or session_label is null\)/, 'a restriction must not carry its reason');
  assert.match(d, /check \(km is null or state = 'done'\)/);
  assert.match(d, /references public\.circle_members\(user_id\) on delete cascade/,
    'leaving must delete a member\'s days, not leave them behind');
  assert.doesNotMatch(code, /\b(pace|heart|hr_|readiness|notes?\b|lthr)/i, 'a body measure has a column');
  assert.doesNotMatch(code, /public\.plans\b/, 'circles must never touch the programme');
});

test('km is dropped by the database while it is off, and deleted when it is switched off', () => {
  assert.match(code, /create trigger circle_days_km_gate\s+before insert or update on public\.circle_days/);
  assert.match(code, /if old\.show_km and not new\.show_km then\s+update public\.circle_days set km = null/);
});

test('the browser writes only its own day rows; everything else goes through a checked function', () => {
  assert.deepEqual(policiesOn('circle_invites'), [], 'invites must be service-only');
  ['circles', 'circle_members', 'circle_sharing_log'].forEach(t =>
    policiesOn(t).forEach(p => assert.equal(p.cmd, 'select', t + ' has a client ' + p.cmd + ' policy')));
  assert.deepEqual(policiesOn('circle_cheers').map(p => p.cmd).sort(), ['delete', 'select']);
  assert.deepEqual(policiesOn('circle_days').map(p => p.cmd).sort(), ['delete', 'insert', 'select', 'update']);
  TABLES.forEach(t => policiesOn(t).forEach(p =>
    assert.equal(p.role, 'authenticated', p.name + ' reaches beyond signed-in users')));
});

test('a paused member is invisible to the circle and sends nothing new', () => {
  assert.match(code, /create or replace function public\.circle_sharing_members\(\)[\s\S]*?where m\.sharing/);
  const read = code.slice(code.indexOf('"circle days: read own and sharing members"'));
  assert.match(read, /user_id in \(select public\.circle_sharing_members\(\)\)/);
  assert.match(code, /"circle days: insert own while sharing"[\s\S]*?with check \(\s*user_id = \(select auth\.uid\(\)\)\s*and user_id in \(select public\.circle_sharing_members\(\)\)/);
});

test('Nice work: someone else, a done day, the last 7 days, once', () => {
  const fn = code.slice(code.indexOf('function public.circle_nice_work(p_to'), code.indexOf('function public.circle_nice_work_seen'));
  assert.match(fn, /if p_to = me then/);
  assert.match(fn, /state = 'done'/);
  assert.match(fn, /p_day < current_date - 6/);
  assert.match(fn, /on conflict on constraint circle_cheers_once do nothing/);
  assert.match(table('circle_cheers'), /unique \(from_user, to_user, day\)/);
});

test('every sharing decision is logged, and the log cannot be rewritten by the athlete', () => {
  assert.match(table('circle_sharing_log'), /'created','joined','paused','resumed','km_on','km_off','left'/);
  ['created', 'joined', 'left'].forEach(e => assert.match(code, new RegExp("'" + e + "'")));
  assert.match(code, /case when p_sharing then 'resumed' else 'paused' end/);
  assert.match(code, /case when p_show_km then 'km_on' else 'km_off' end/);
});

test('every circle function is definer on the empty search path, and closed to the anonymous key', () => {
  const fns = [...code.matchAll(/create or replace function public\.(circle\w+)\(/g)].map(m => m[1]);
  assert.ok(fns.length >= 11);
  fns.forEach(f => {
    const body = code.slice(code.indexOf('function public.' + f + '('));
    assert.match(body.slice(0, 400), /security definer set search_path = ''/, f + ' is not pinned');
  });
  assert.match(code, /revoke all on function public\.' \|\| f \|\| ' from public, anon/);
});

test('the file refuses to run if its own posture has drifted', () => {
  ['row-level security OFF', 'must have no client policy', 'let a circle rule be bypassed',
   'reach beyond signed-in users', 'not scoped to the caller', 'not pinned to the empty search path',
   'The anonymous key can call'].forEach(s => assert.ok(SQL.includes(s), 'missing refusal: ' + s));
});

test('it is in the documented order, after the file that asserts every table has RLS', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'SUPABASE-MIGRATIONS.md'), 'utf8');
  assert.match(doc, /\| 12 \| `supabase-circles\.sql`/);
  const t = doc.slice(doc.indexOf('| # | File'), doc.indexOf('## Deployment parameters'));
  assert.ok(t.indexOf('supabase-circles.sql') > t.indexOf('supabase-security-posture.sql'));
  assert.match(doc, /substrate\.sql` must never be run against a real Supabase project/);
});

/* THE PROOF ITSELF. Builds a throwaway Postgres, applies the migration twice,
   and acts as Ann, Ben, an outsider, a full circle and the anonymous key.
   Skipped -- and says so -- where Postgres is not installed. */
const pgBin = (() => {
  try {
    return fs.readdirSync('/usr/lib/postgresql').map(v => '/usr/lib/postgresql/' + v + '/bin/initdb')
      .find(p => fs.existsSync(p)) || null;
  } catch(e){ return null; }
})();
test('the rules hold when real people try to break them', { skip: !pgBin && 'Postgres is not installed here' }, () => {
  const out = execFileSync('bash', [path.join(ROOT, 'tools/db-proof/run.sh'),
    'supabase-circles.sql', 'tools/db-proof/circles-proof.sql'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
  assert.match(out, /ALL CIRCLE RULES HELD/);
});
