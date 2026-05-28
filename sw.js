const CACHE = 'probador-automotor-ble-v5-audios-neurales';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './audio/arranque_detectado.mp3',
  './audio/bateria_baja.mp3',
  './audio/captura_lista.mp3',
  './audio/carga_alta.mp3',
  './audio/carga_normal.mp3',
  './audio/conectado.mp3',
  './audio/desconectado.mp3',
  './audio/modo_arranque.mp3',
  './audio/modo_carga.mp3',
  './audio/modo_forma.mp3',
  './audio/modo_inyector.mp3',
  './audio/modo_pulsos.mp3',
  './audio/modo_pwm.mp3',
  './audio/modo_sensor.mp3',
  './audio/modo_voltimetro.mp3',
  './audio/pulso_detectado.mp3',
  './audio/senal_presente.mp3',
  './audio/sin_senal.mp3',
  './audio/tension_alta.mp3',
  './audio/tension_baja.mp3'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

