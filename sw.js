self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('ddr-v1').then(cache => cache.addAll([
    './', './index.html', './styles.css', './app.js', './manifest.json'
  ])));
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(resp => resp || fetch(e.request)));
});
