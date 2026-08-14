// Velvet Viking -- minimal service worker whose only job is to let
// the app show a notification via registration.showNotification() so the
// daily 08:00 workout reminder can still appear while the tab is only
// backgrounded (not closed). No caching/offline behavior is implemented.
self.addEventListener('install', function(event){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
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
