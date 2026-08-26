'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../api/_strava.js');

/* STRAVA IS AN INTEGRATION, NOT A SINGLE POINT OF FAILURE
 * ===========================================================================
 * The athlete must never lose Valhalla because Strava is having a bad day, and
 * a bad day must never cost them a working authorization. Those are two
 * different promises and this file holds both.
 *
 * THE ASYMMETRY THAT MATTERS. accessTokenFor() DELETES the stored grant when
 * Strava refuses a refresh with 400/401, because that refusal means the
 * authorization is gone for good and a connection that cannot do any work must
 * stop reporting itself as connected. Every other failure -- a 500, a rate
 * limit, a timeout, DNS, a body that will not parse -- means "ask again
 * later", and must leave the grant untouched. Getting that backwards would
 * turn a five-minute Strava outage into every beta athlete silently
 * disconnected, with no notification that it had happened.
 *
 * These drive the real module. The only thing replaced is the network.
 */

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = () => Math.floor(Date.now() / 1000);

/* A recording stand-in for global fetch. Handlers are matched on the URL so a
   test says what Strava did, not what order it was asked. Anything unmatched
   throws loudly: a fake that quietly answers a question it does not understand
   is how a test passes against nothing. */
async function withFetch(routes, run){
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    const key = Object.keys(routes).find(k => u.includes(k));
    if (!key) throw new Error('unstubbed fetch: ' + u);
    const r = routes[key];
    return typeof r === 'function' ? r(u, opts) : r;
  };
  /* await, not return: the finally must not restore the real fetch while the
     body is still in flight, which is how a stubbed test quietly starts
     talking to the internet. */
  try { return await run(calls); }
  finally { global.fetch = real; }
}
const reply = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body
});
const unparseable = status => ({
  ok: status >= 200 && status < 300, status,
  json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
});
const dead = () => { throw new TypeError('fetch failed'); };

const CFG = {
  clientId: 'id', clientSecret: 'secret',
  supabaseUrl: 'https://project.supabase.co', serviceKey: 'service-key',
  serviceKeySource: 'vvv_namespaced'
};
const conn = over => Object.assign({
  user_id: 'user-a', strava_athlete_id: 4242,
  access_token: 'access-old', refresh_token: 'refresh-old',
  expires_at: NOW() - 60, scope: 'read,activity:read_all', athlete_name: 'Dan H'
}, over || {});

const supabaseWrites = calls => calls.filter(c => c.url.includes('/rest/v1/'));
const deletes = calls => supabaseWrites(calls).filter(c => c.method === 'DELETE');

// ---------------------------------------------------------------------------
// TOKEN REFRESH
// ---------------------------------------------------------------------------
test('a live token is reused, and Strava is not called at all', () => {
  /* The cheapest correct behaviour, and the one the rate limit depends on:
     opening the app must not spend a Strava request to learn something the
     stored expiry already answers. */
  return withFetch({}, async calls => {
    const token = await S.accessTokenFor(CFG, conn({ expires_at: NOW() + 3600, access_token: 'access-live' }));
    assert.equal(token, 'access-live');
    assert.equal(calls.length, 0, 'a live token cost a network call');
  });
});

test('an expired token is refreshed and the new pair is persisted', async () => {
  await withFetch({
    'oauth/token': reply(200, { access_token: 'access-new', refresh_token: 'refresh-new',
                                expires_at: NOW() + 21600 }),
    '/rest/v1/': reply(201, {})
  }, async calls => {
    const token = await S.accessTokenFor(CFG, conn());
    assert.equal(token, 'access-new', 'the caller got the refreshed token');
    const saved = supabaseWrites(calls).find(c => c.method === 'POST');
    assert.ok(saved, 'the refreshed pair was not written back');
    const row = JSON.parse(saved.body);
    assert.equal(row.access_token, 'access-new');
    assert.equal(row.refresh_token, 'refresh-new');
    assert.equal(row.user_id, 'user-a', 'the refresh was written to the wrong athlete');
  });
});

test('a refresh that omits a new refresh_token keeps the old one', async () => {
  /* Strava does not always rotate it. Storing undefined would make the next
     refresh impossible and disconnect the athlete for no reason. */
  await withFetch({
    'oauth/token': reply(200, { access_token: 'access-new', expires_at: NOW() + 21600 }),
    '/rest/v1/': reply(201, {})
  }, async calls => {
    await S.accessTokenFor(CFG, conn());
    const row = JSON.parse(supabaseWrites(calls).find(c => c.method === 'POST').body);
    assert.equal(row.refresh_token, 'refresh-old', 'the usable refresh token was thrown away');
  });
});

test('a token inside the skew window is refreshed rather than used', async () => {
  /* Expiring in 30 seconds is expiring: handing it to a caller that is about
     to make several requests is how a sync dies halfway through. */
  await withFetch({
    'oauth/token': reply(200, { access_token: 'access-new', refresh_token: 'r', expires_at: NOW() + 21600 }),
    '/rest/v1/': reply(201, {})
  }, async () => {
    const token = await S.accessTokenFor(CFG, conn({ expires_at: NOW() + 30, access_token: 'access-stale' }));
    assert.equal(token, 'access-new');
  });
});

// ---------------------------------------------------------------------------
// A DEAD GRANT vs A BAD DAY
// ---------------------------------------------------------------------------
test('a refused refresh (400/401) deletes the grant, so status stops lying', async () => {
  for (const status of [400, 401]) {
    await withFetch({
      'oauth/token': reply(status, { message: 'Bad Request' }),
      '/rest/v1/': reply(204, {})
    }, async calls => {
      const token = await S.accessTokenFor(CFG, conn());
      assert.equal(token, null, status + ': a dead grant returned a token');
      const gone = deletes(calls);
      assert.equal(gone.length, 1, status + ': the dead grant was not removed');
      assert.match(gone[0].url, /strava_connections\?user_id=eq\.user-a/);
    });
  }
});

test('an outage does NOT delete the grant', async () => {
  /* THE ONE THAT WOULD HURT MOST. A Strava outage that disconnected every beta
     athlete would be indistinguishable, to them, from the product losing their
     data -- and reconnecting is manual. Unreachable is not "revoked". */
  for (const [label, route] of [['500', reply(500, {})],
                                ['rate limited', reply(429, {})],
                                ['unreachable', dead],
                                ['unparseable', unparseable(200)]]) {
    await withFetch({ 'oauth/token': route, '/rest/v1/': reply(204, {}) }, async calls => {
      const token = await S.accessTokenFor(CFG, conn());
      assert.equal(token, null, label + ': a failed refresh returned a token');
      assert.equal(deletes(calls).length, 0,
        label + ': a transient failure destroyed a valid authorization');
    });
  }
});

test('an unreachable Strava is status 0, which is not any refusal it can send', async () => {
  await withFetch({ 'oauth/token': dead }, async () => {
    const res = await S.stravaTokenRequest(CFG, { grant_type: 'refresh_token', refresh_token: 'r' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 0, 'an outage must be distinguishable from a 400');
    assert.equal(res.unreachable, true);
  });
});

// ---------------------------------------------------------------------------
// THE ACTIVITY READ
// ---------------------------------------------------------------------------
test('an outage and a malformed body are refusals, never exceptions', async () => {
  /* Both used to throw straight out of this module, and neither route that
     calls it has a try/catch -- so an athlete pressing Sync during an outage
     got a platform 500 rather than "Strava is not responding". */
  await withFetch({ '/api/v3/': dead }, async () => {
    const r = await S.stravaApi('/athlete/activities', 'token');
    assert.deepEqual({ ok: r.ok, status: r.status, data: r.data }, { ok: false, status: 0, data: null });
  });
  await withFetch({ '/api/v3/': unparseable(200) }, async () => {
    const r = await S.stravaApi('/activities/1', 'token');
    assert.equal(r.ok, false, 'an unreadable 200 was treated as success');
    assert.equal(r.data, null, 'nothing may be staged from a body that would not parse');
    assert.equal(r.malformed, true);
  });
});

test('a rate limit is reported as itself and stages nothing', async () => {
  await withFetch({ '/api/v3/': reply(429, { message: 'Rate Limit Exceeded' }) }, async () => {
    const r = await S.stravaApi('/athlete/activities', 'token');
    assert.equal(r.ok, false);
    assert.equal(r.status, 429, 'the caller cannot back off from a status it never sees');
    assert.equal(r.data, null);
  });
});

test('every Strava network call in the module is guarded', () => {
  /* A source rule, because the failure mode is a NEW call added later without
     one -- which reintroduces exactly the unhandled rejection this closes. */
  const src = read('api/_strava.js');
  const bodies = ['stravaTokenRequest', 'stravaApi'].map(name => {
    const at = src.indexOf('async function ' + name + '(');
    assert.ok(at > 0, name + ' has moved');
    return src.slice(at, src.indexOf('\n}', at));
  });
  bodies.forEach((b, i) => {
    assert.match(b, /try\s*\{[^]*await fetch\(/, 'an unguarded fetch remains in call ' + i);
    assert.match(b, /status:\s*0/, 'call ' + i + ' cannot report unreachable');
  });
});

// ---------------------------------------------------------------------------
// ATHLETE ISOLATION
// ---------------------------------------------------------------------------
test('every connection read is scoped to one athlete by an equality filter', async () => {
  /* One athlete must never be able to reach another's credentials or
     activities. The scoping is a filter on the query, so the query is what is
     checked -- and both lookups are keyed on a column that is unique. */
  await withFetch({ '/rest/v1/': reply(200, []) }, async calls => {
    await S.getConnection(CFG, 'user-a');
    await S.getConnectionByAthlete(CFG, 4242);
    const urls = calls.map(c => c.url);
    assert.match(urls[0], /strava_connections\?user_id=eq\.user-a&limit=1/);
    assert.match(urls[1], /strava_connections\?strava_athlete_id=eq\.4242&limit=1/);
    urls.forEach(u => assert.ok(/=eq\./.test(u), 'an unscoped read of the token table: ' + u));
  });
});

test('a user id is URL-encoded into the filter, not concatenated raw', () => {
  /* The id comes from a verified JWT rather than from a caller, so this is
     defence in depth -- but a PostgREST filter is a query string, and an
     unencoded value there is how a scoped read stops being scoped. */
  const src = read('api/_strava.js');
  ['getConnectionBy', 'deleteConnection', 'deleteStagedActivities'].forEach(fn => {
    const at = src.indexOf('function ' + fn + '(');
    assert.ok(at > 0, fn + ' has moved');
    const body = src.slice(at, src.indexOf('\n}', at));
    assert.match(body, /encodeURIComponent/, fn + ' builds a filter without encoding');
  });
});

test('the staged row is written against the athlete the server resolved', async () => {
  await withFetch({ '/rest/v1/': reply(201, {}) }, async calls => {
    await S.stageActivity(CFG, 'user-a', S.normaliseActivity({
      id: 555, sport_type: 'Run', start_date_local: '2026-08-24T07:00:00Z',
      distance: 10000, moving_time: 3000, elapsed_time: 3100
    }));
    const post = supabaseWrites(calls).find(c => c.method === 'POST');
    const row = JSON.parse(post.body);
    assert.equal(row.user_id, 'user-a');
    assert.equal(row.activity_id, '555');
  });
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY
// ---------------------------------------------------------------------------
test('staging the same activity twice upserts rather than duplicating', async () => {
  /* The property every replay, retry and update event rests on. The table is
     keyed (user_id, activity_id); merge-duplicates is what makes a second
     arrival refresh the row in place. */
  await withFetch({ '/rest/v1/': reply(201, {}) }, async calls => {
    const a = S.normaliseActivity({ id: 777, sport_type: 'Run',
      start_date_local: '2026-08-24T07:00:00Z', distance: 10000, moving_time: 3000 });
    await S.stageActivity(CFG, 'user-a', a);
    await S.stageActivity(CFG, 'user-a', a);
    const posts = supabaseWrites(calls).filter(c => c.method === 'POST');
    assert.equal(posts.length, 2, 'both arrivals were sent');
    posts.forEach(p => {
      const row = JSON.parse(p.body);
      assert.equal(row.activity_id, '777', 'the identity moved between arrivals');
      /* THE SUBTLE HALF OF THE UPSERT. A second arrival must refresh the
         payload WITHOUT resetting ingested_at -- otherwise every `update`
         event re-offers a run the athlete has already logged, and the day is
         written again from underneath them. Absent from the row is what makes
         merge-duplicates leave the existing value alone. */
      assert.ok(!('ingested_at' in row),
        'staging cleared ingested_at -- an update event will re-offer a logged run');
    });
    posts.forEach(p => assert.match(p.url, /strava_activities/));
  });
  const src = read('api/_strava.js');
  const body = src.slice(src.indexOf('async function stageActivity('),
                         src.indexOf('\n}', src.indexOf('async function stageActivity(')));
  assert.match(body, /resolution=merge-duplicates/,
    'staging must upsert -- without this every webhook retry is a duplicate run');
});

test('an update event carries the corrected numbers into the same row', async () => {
  /* An athlete fixing a mis-recorded distance on Strava must end up with one
     row holding the new value, not two rows disagreeing. */
  await withFetch({ '/rest/v1/': reply(201, {}) }, async calls => {
    const base = { id: 777, sport_type: 'Run', start_date_local: '2026-08-24T07:00:00Z' };
    await S.stageActivity(CFG, 'user-a', S.normaliseActivity(Object.assign({}, base,
      { distance: 10000, moving_time: 3000 })));
    await S.stageActivity(CFG, 'user-a', S.normaliseActivity(Object.assign({}, base,
      { distance: 12000, moving_time: 3600 })));
    const rows = supabaseWrites(calls).filter(c => c.method === 'POST').map(c => JSON.parse(c.body));
    assert.equal(rows[0].payload.km, 10);
    assert.equal(rows[1].payload.km, 12, 'the correction did not reach the payload');
    assert.equal(rows[0].activity_id, rows[1].activity_id, 'a correction became a second run');
  });
});

// ---------------------------------------------------------------------------
// WHAT IS AND IS NOT EVIDENCE
// ---------------------------------------------------------------------------
test('an unprocessed upload is not staged, and its zeros are not measurements', () => {
  /* Strava fires `create` before the uploaded file is processed, so the
     activity is briefly readable with distance 0. A 0 km run offered to the
     matcher would be scored as a catastrophically failed session. */
  const fresh = S.normaliseActivity({ id: 1, sport_type: 'Run',
    start_date_local: '2026-08-24T07:00:00Z', distance: 0, moving_time: 0, elapsed_time: 0 });
  assert.equal(fresh.km, null, 'zero distance became a measurement');
  assert.equal(fresh.movingTimeSec, null);
  assert.equal(fresh.paceSecPerKm, null, 'a pace was invented from nothing');
  assert.equal(S.isUsableRun(fresh), false, 'an unprocessed upload was treated as evidence');
});

test('a flat run really does climb zero metres', () => {
  const a = S.normaliseActivity({ id: 1, sport_type: 'Run',
    start_date_local: '2026-08-24T07:00:00Z', distance: 10000, moving_time: 3000,
    total_elevation_gain: 0 });
  assert.equal(a.elevationGainM, 0, 'a true zero was discarded as missing');
});

test('missing heart rate stays missing rather than becoming zero', () => {
  const none = S.normaliseActivity({ id: 1, sport_type: 'Run',
    start_date_local: '2026-08-24T07:00:00Z', distance: 10000, moving_time: 3000,
    has_heartrate: false, average_heartrate: 0, max_heartrate: 0 });
  assert.equal(none.hr, null, '0 bpm was recorded as a heart rate');
  assert.equal(none.maxHR, null);
});

test('only runs are evidence, and only once they have a date and a distance', () => {
  const mk = over => S.normaliseActivity(Object.assign({ id: 1, sport_type: 'Run',
    start_date_local: '2026-08-24T07:00:00Z', distance: 10000, moving_time: 3000 }, over));
  assert.equal(S.isUsableRun(mk({})), true);
  assert.equal(S.isUsableRun(mk({ sport_type: 'Ride' })), false, 'a ride was staged as a run');
  assert.equal(S.isUsableRun(mk({ sport_type: 'Swim' })), false);
  assert.equal(S.isUsableRun(mk({ start_date_local: '' , start_date: '' })), false,
    'an activity with no local date cannot be matched to a day');
  ['Run', 'TrailRun', 'VirtualRun', 'Treadmill'].forEach(t =>
    assert.equal(S.isUsableRun(mk({ sport_type: t })), true, t + ' is running and must import'));
});

test('a treadmill or manual Strava entry still imports, and says which it is', () => {
  /* Neither is a reason to refuse: an indoor run is training that happened.
     They are recorded as facts so nothing downstream has to guess. */
  const a = S.normaliseActivity({ id: 1, sport_type: 'Run', trainer: true, manual: true,
    start_date_local: '2026-08-24T07:00:00Z', distance: 10000, moving_time: 3000 });
  assert.equal(S.isUsableRun(a), true);
  assert.equal(a.trainer, true);
  assert.equal(a.manual, true);
});

test('pace is derived from the two primitives, so it agrees with the imported distance', () => {
  /* Not from average_speed. A rounded average and a rounded distance disagree,
     and the athlete would see a pace their own numbers do not produce. */
  const a = S.normaliseActivity({ id: 1, sport_type: 'Run', start_date_local: '2026-08-24T07:00:00Z',
    distance: 10000, moving_time: 3000, average_speed: 99 });
  assert.equal(a.paceSecPerKm, 300, 'pace did not come from distance and moving time');
});
