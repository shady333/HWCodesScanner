/* Garage Log — Hot Wheels Scanner service worker.
   Caches the app shell so it loads offline after the first visit.
   Tesseract.js core/worker/lang files are fetched from the CDN and cached
   opportunistically as they're requested. */

var CACHE_NAME = 'garage-log-v1';
var APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(key){ return key !== CACHE_NAME; })
            .map(function(key){ return caches.delete(key); })
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;

  /* Only handle GET requests. */
  if(req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(function(cached){
      if(cached) return cached;

      return fetch(req).then(function(response){
        /* Cache successful same-origin and CDN responses for offline use
           (e.g. Tesseract.js scripts, wasm, and trained data files). */
        if(response && response.status === 200){
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(req, copy);
          });
        }
        return response;
      }).catch(function(){
        /* Offline and not cached — fall back to the app shell for
           navigation requests so the UI still loads. */
        if(req.mode === 'navigate'){
          return caches.match('./index.html');
        }
      });
    })
  );
});
