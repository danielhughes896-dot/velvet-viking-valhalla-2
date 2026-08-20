'use strict';

// A small in-memory stand-in for the PostgREST surface _commercial-store.js
// actually uses.
//
// WHY THIS EXISTS RATHER THAN MOCKS. The two things that keep the commercial
// core correct under load are not JavaScript -- they are a UNIQUE INDEX and a
// CONDITIONAL UPDATE. A hand-written mock that returns whatever the test wants
// proves neither. This fake enforces both:
//
//   billing_events           unique (provider, provider_event_id) -> 409
//   entitlement_grants       partial unique (account_id, source) where
//                            revoked_at is null -> ignored on conflict
//   subscriptions            unique (provider, provider_subscription_id),
//                            merge-duplicates on upsert
//   account_commercial       PATCH honours the `trial_consumed_at=is.null`
//                            filter, so the second of two racing writers
//                            genuinely matches zero rows
//
// It is not a database and does not pretend to be one. It understands exactly
// the query shapes the store issues; anything else throws loudly rather than
// silently returning an empty result, because a fake that answers questions it
// does not understand is how a test passes against nothing.

let SEQ = 0;
function uuid(){
  SEQ++;
  return '00000000-0000-4000-8000-' + String(SEQ).padStart(12, '0');
}

/* The unique constraints, expressed as the key a row occupies. Returning null
   means "this row participates in no unique index". */
const UNIQUE = {
  billing_events: r => r.provider + '|' + r.provider_event_id,
  subscriptions:  r => r.provider + '|' + r.provider_subscription_id,
  account_commercial: r => r.account_id,
  entitlements:   r => r.user_id,
  // PARTIAL: only live grants collide. A revoked one leaves the slot free.
  entitlement_grants: r => (r.revoked_at == null ? r.account_id + '|' + r.source : null)
};

const DEFAULTS = {
  account_commercial: { trial_consumed_at: null, trial_consumed_provider: null,
                        trial_consumed_subscription_id: null, trial_blocked_at: null,
                        trial_blocked_reason: null },
  subscriptions: { product_code: 'VALHALLA_STANDARD', environment: 'production',
                   auto_renew: true, cancel_at_period_end: false },
  entitlement_grants: { product_code: 'VALHALLA_STANDARD', revoked_at: null,
                        revoked_by: null, expires_at: null, granted_by: null, note: null },
  billing_events: { environment: 'production', processed_at: null, result: null },
  entitlements: { state: 'expired', tier: 'standard', access_until: null,
                  cancel_at_period_end: false, override: null }
};

function res(status, body, extra){
  return Object.assign({
    ok: status >= 200 && status < 300,
    status: status,
    json: async () => body,
    headers: { get: () => null }
  }, extra || {});
}

/* `?a=eq.1&b=is.null&select=...` -> the filters only. select/order/limit/
   on_conflict are query controls, not predicates, and treating them as
   predicates would silently match nothing. */
const CONTROLS = ['select', 'order', 'limit', 'offset', 'on_conflict'];
function parseFilters(qs){
  const out = [];
  String(qs || '').split('&').filter(Boolean).forEach(function(pair){
    const i = pair.indexOf('=');
    if (i < 0) return;
    const col = decodeURIComponent(pair.slice(0, i));
    if (CONTROLS.indexOf(col) !== -1) return;
    const raw = decodeURIComponent(pair.slice(i + 1));
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot), val = raw.slice(dot + 1);
    if (op !== 'eq' && op !== 'is')
      throw new Error('fakeSupabase: unsupported operator "' + op + '" on ' + col);
    out.push({ col: col, op: op, val: val });
  });
  return out;
}
function matches(row, filters){
  return filters.every(function(f){
    if (f.op === 'is') return f.val === 'null' ? row[f.col] == null : row[f.col] != null;
    return String(row[f.col]) === String(f.val);
  });
}

function createFakeSupabase(seed){
  const db = {
    account_commercial: [], subscriptions: [], entitlement_grants: [],
    billing_events: [], entitlements: []
  };
  Object.keys(seed || {}).forEach(function(t){
    (seed[t] || []).forEach(function(r){ db[t].push(Object.assign({}, DEFAULTS[t], r)); });
  });

  const calls = [];
  /* Fires immediately before a write commits. The hook every race test uses:
     it is the only way to interleave two writers deterministically without a
     real database. */
  let beforeWrite = null;

  async function sb(cfg, path, opts){
    opts = opts || {};
    calls.push({ method: opts.method || 'GET', path: path });

    const qi = path.indexOf('?');
    const table = (qi === -1 ? path : path.slice(0, qi)).replace(/^\//, '');
    const filters = parseFilters(qi === -1 ? '' : path.slice(qi + 1));
    if (!Object.prototype.hasOwnProperty.call(db, table))
      throw new Error('fakeSupabase: unknown table ' + table);

    const method = (opts.method || 'GET').toUpperCase();
    const prefer = String(opts.prefer || '');
    const wantRep = prefer.indexOf('return=representation') !== -1;

    if (method === 'GET'){
      return res(200, db[table].filter(function(r){ return matches(r, filters); })
                               .map(function(r){ return Object.assign({}, r); }));
    }

    if (method === 'POST'){
      const incoming = JSON.parse(opts.body || '{}');
      const list = Array.isArray(incoming) ? incoming : [incoming];
      const written = [];
      for (const raw of list){
        const row = Object.assign({ id: uuid() }, DEFAULTS[table], raw);
        const keyOf = UNIQUE[table];
        const key = keyOf ? keyOf(row) : null;
        const clash = key == null ? -1
          : db[table].findIndex(function(r){ return keyOf(r) === key; });

        if (clash !== -1){
          if (prefer.indexOf('resolution=merge-duplicates') !== -1){
            if (beforeWrite) await beforeWrite(table, 'merge', row);
            Object.keys(raw).forEach(function(k){ db[table][clash][k] = raw[k]; });
            written.push(Object.assign({}, db[table][clash]));
            continue;
          }
          if (prefer.indexOf('resolution=ignore-duplicates') !== -1) continue;
          // No resolution asked for: this is the unique violation.
          return res(409, { code: '23505', message: 'duplicate key value' });
        }
        if (beforeWrite) await beforeWrite(table, 'insert', row);
        db[table].push(row);
        written.push(Object.assign({}, row));
      }
      return res(201, wantRep ? written : null);
    }

    if (method === 'PATCH'){
      const patch = JSON.parse(opts.body || '{}');
      if (beforeWrite) await beforeWrite(table, 'patch', patch);
      // Re-evaluated AFTER the hook on purpose: that is what makes a
      // conditional update genuinely conditional under interleaving.
      const hit = db[table].filter(function(r){ return matches(r, filters); });
      hit.forEach(function(r){ Object.assign(r, patch); });
      return res(200, wantRep ? hit.map(function(r){ return Object.assign({}, r); }) : null);
    }

    if (method === 'DELETE'){
      const keep = db[table].filter(function(r){ return !matches(r, filters); });
      const gone = db[table].length - keep.length;
      db[table] = keep;
      return res(200, wantRep ? [] : null, { removed: gone });
    }

    throw new Error('fakeSupabase: unsupported method ' + method);
  }

  return {
    S: { sb: sb },
    cfg: { supabaseUrl: 'https://fake.test', serviceKey: 'service-role-fake' },
    db: db,
    calls: calls,
    onBeforeWrite(fn){ beforeWrite = fn; },
    rows(table){ return db[table].map(function(r){ return Object.assign({}, r); }); }
  };
}

module.exports = { createFakeSupabase, uuid };
