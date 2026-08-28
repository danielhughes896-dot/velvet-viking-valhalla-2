// Velvet Viking -- notifications, and a bounded offline application shell.
// ===========================================================================
// THIS FILE HAS TWO JOBS AND THEY DO NOT INTERACT.
//
//   1. showNotification(), so the daily 08:00 workout reminder can appear
//      while the tab is only backgrounded. Unchanged.
//   2. Keeping the application shell available when the phone has no usable
//      connection, so Valhalla opens from the athlete's own device instead of
//      failing to open at all.
//
// THE ONLINE PATH IS UNCHANGED, AND THAT IS DELIBERATE. Navigation is
// NETWORK-FIRST: every online launch goes to the network, reaches /api/app,
// and is gated and revalidated exactly as it was before this file cached
// anything. The cache is a FALLBACK for when the network cannot answer -- not
// a faster route that races it. Two modes, not two implementations.
//
// THE BOUNDED WINDOW, AND WHAT IT IS NOT. Serving the cached shell offline
// means opening the app without a live entitlement check, because offline
// there is provably no way to make one. That is accepted, and it is bounded:
// a successful gated delivery stamps the moment it happened, and the cached
// shell may be reused without a gate for OFFLINE_WINDOW_MS after it. Past
// that, an online launch is required before offline access is renewed.
//
// This is not authentication. Nothing here decides that anyone is signed in,
// and no server operation is reachable through it -- every cloud call still
// needs a live token and a live network. It is bounded reuse of application
// code this device was already granted.

/* THE SHELL IS NOT ONE FILE. The document carries all the CSS and all the app
   JavaScript inline, but it also loads /assets/builder-spec.js with a plain
   <script src>, and the runtime throws on startup without it -- so a cached
   document on its own opens to a blank screen and a ReferenceError. Found by
   running the airplane-mode test rather than by reading, which is the only way
   this kind of gap ever shows up.

   These are static, public, non-athlete files. They carry no plan, no profile
   and no identity, so caching them needs no entitlement reasoning; they are
   here because without them the shell does not boot. */
var ASSET_PREFIX = '/assets/';

var SHELL_CACHE = 'vvv-shell-v1';
var META_CACHE  = 'vvv-meta-v1';
var SHELL_KEY   = '/__vvv_shell';        /* the cached document */
var META_KEY    = '/__vvv_entitlement';  /* when it was last granted */

/* SEVEN DAYS, the founder's decision. Long enough that a week away from
   signal does not lock an athlete out of their own training plan; short
   enough that a revoked entitlement cannot be ignored indefinitely. */
var OFFLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener('install', function(){ self.skipWaiting(); });

self.addEventListener('activate', function(event){
  /* RETIRE OLD CACHES DELIBERATELY. A service worker that never drops a cache
     is how an athlete ends up pinned to a build from months ago. Anything not
     named by THIS version of the file goes. */
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.map(function(n){
        if (n !== SHELL_CACHE && n !== META_CACHE) return caches.delete(n);
        return null;
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* ---------- THE ENTITLEMENT RECORD ----------
   Three numbers, and each is there for a reason:

     serverAt   the server's own clock at the moment the gate said yes. The
                client never writes this and cannot forge a later one.
     deviceAt   this device's clock at that same moment. Not trusted on its
                own -- it is the other end of an ELAPSED measurement, which is
                what makes a rolled-back clock detectable rather than useful.
     highWater  the latest device time ever observed. If the clock is ever
                seen to be earlier than this, it has moved backwards.

   CLOCK ROLLBACK. Offline, the device clock is the only clock there is, so
   elapsed time has to come from it. Setting it backwards would otherwise
   extend the window indefinitely. Two things stop that being useful, and both
   FAIL CLOSED -- a suspicious clock expires the window rather than extending
   it:

     * now < deviceAt        the clock is behind the moment the stamp was
                             written, which cannot happen honestly.
     * now < highWater       the clock is behind something this device has
                             already seen, which also cannot.

   Neither is a proof of intent and neither needs to be: the cost of being
   wrong is one online launch, and the cost of being permissive is an
   unbounded offline window. */
function readMeta(){
  return caches.open(META_CACHE).then(function(c){
    return c.match(META_KEY).then(function(r){
      if (!r) return null;
      return r.json().catch(function(){ return null; });
    });
  });
}
function writeMeta(meta){
  return caches.open(META_CACHE).then(function(c){
    return c.put(META_KEY, new Response(JSON.stringify(meta),
      { headers: { 'content-type': 'application/json' } }));
  });
}
/* Called on every successful gated delivery -- 200 and 304 alike, because a
   304 means the gate ran and granted just as much as a 200 does. A response
   with no stamp (a redirect to the account shell, an error) never reaches
   here, so a denial can never refresh the window. */
function stampEntitlement(serverAtHeader){
  var serverAt = Number(serverAtHeader);
  if (!serverAt || !isFinite(serverAt)) return Promise.resolve();
  var now = Date.now();
  return readMeta().then(function(prev){
    return writeMeta({
      serverAt: serverAt,
      deviceAt: now,
      highWater: Math.max(now, (prev && prev.highWater) || 0)
    });
  });
}
/* May the cached shell be served without a gate right now? */
function offlineAllowed(meta){
  if (!meta || !meta.deviceAt) return false;
  var now = Date.now();
  if (now < meta.deviceAt) return false;                    /* clock went back */
  if (meta.highWater && now < meta.highWater) return false;  /* ditto, harder */
  return (now - meta.deviceAt) <= OFFLINE_WINDOW_MS;
}

self.addEventListener('fetch', function(event){
  var req = event.request;
  /* NAVIGATIONS ONLY. Everything else -- assets, API calls, the model, the
     voice -- is left entirely alone and behaves exactly as it did. A cloud
     call must fail honestly when there is no cloud, and nothing here pretends
     otherwise. */
  if (req.method !== 'GET') return;

  /* STATIC SUBRESOURCES the shell cannot boot without. Network first, so a new
     deployment's assets are picked up as soon as there is a network; cache as
     a fallback, so the shell can start without one. No entitlement check --
     these are public files, and refusing them offline would only produce the
     blank screen this exists to prevent. */
  var url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if (url.origin === self.location.origin && url.pathname.indexOf(ASSET_PREFIX) === 0){
    event.respondWith(
      fetch(req).then(function(resp){
        if (resp && resp.ok){
          var copy = resp.clone();
          caches.open(SHELL_CACHE).then(function(c){ return c.put(req, copy); });
        }
        return resp;
      }).catch(function(){
        return caches.open(SHELL_CACHE).then(function(c){
          return c.match(req).then(function(hit){ return hit || Response.error(); });
        });
      })
    );
    return;
  }

  if (req.mode !== 'navigate') return;

  event.respondWith(
    /* NETWORK FIRST. The gate is authoritative whenever it can be reached. */
    fetch(req).then(function(resp){
      var stamp = resp.headers.get('x-vvv-entitled-at');
      if (resp.ok && stamp){
        /* A granted delivery: keep the body and refresh the window. */
        var copy = resp.clone();
        caches.open(SHELL_CACHE).then(function(c){ return c.put(SHELL_KEY, copy); });
        stampEntitlement(stamp);
      } else if (stamp){
        /* 304: the gate granted, the body we already hold is still current. */
        stampEntitlement(stamp);
      }
      /* A REDIRECT OR A REFUSAL IS PASSED STRAIGHT THROUGH AND CHANGES
         NOTHING. The athlete sees the account shell, the cached body is left
         alone, and -- critically -- the window is not refreshed, so a revoked
         athlete's offline access ages out on its own. */
      return resp;
    }).catch(function(){
      /* THE NETWORK COULD NOT ANSWER. This is the only path that serves
         anything without a gate, and it is bounded. */
      return readMeta().then(function(meta){
        if (!offlineAllowed(meta)) return Response.error();
        return caches.open(SHELL_CACHE).then(function(c){
          return c.match(SHELL_KEY).then(function(hit){
            return hit || Response.error();
          });
        });
      });
    })
  );
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(clientList){
      for (var i=0; i<clientList.length; i++){
        var client = clientList[i];
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
