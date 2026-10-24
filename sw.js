/*
 * sw.js - Service Worker de la PWA de Incidencias
 *
 * Ciclo de vida:
 *   install  -> precarga (precache) de los recursos esenciales
 *   activate -> elimina cachés de versiones anteriores y toma control
 *   fetch    -> responde desde caché o red según el tipo de petición
 *   message  -> permite activar una nueva versión (SKIP_WAITING) y consultar la versión
 *
 * Para publicar una actualización: cambiar VERSION. El navegador detecta
 * que sw.js cambió, instala la nueva versión y la app muestra el aviso "Actualizar".
 */

const VERSION = 'v1.0.0';
const CACHE_ESTATICO = `incidencias-estatico-${VERSION}`;
const CACHE_DINAMICO = `incidencias-dinamico-${VERSION}`;

// Recursos esenciales para que la interfaz abra sin conexión (App Shell)
const RECURSOS_ESENCIALES = [
  './',
  './index.html',
  './offline.html',
  './styles.css',
  './js/db.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

/* ---------------- INSTALACIÓN ---------------- */
self.addEventListener('install', (event) => {
  console.log(`[SW ${VERSION}] Instalando y guardando recursos esenciales`);
  event.waitUntil(
    caches.open(CACHE_ESTATICO).then((cache) => cache.addAll(RECURSOS_ESENCIALES))
  );
  // No se llama skipWaiting aquí: la nueva versión espera a que el usuario
  // pulse "Actualizar" para no cambiar la app mientras la está usando.
});

/* ---------------- ACTIVACIÓN ---------------- */
self.addEventListener('activate', (event) => {
  console.log(`[SW ${VERSION}] Activado`);
  event.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(
        nombres
          .filter((n) => n.startsWith('incidencias-') && n !== CACHE_ESTATICO && n !== CACHE_DINAMICO)
          .map((n) => {
            console.log(`[SW ${VERSION}] Eliminando caché antigua: ${n}`);
            return caches.delete(n);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------------- MENSAJES DESDE LA APP ---------------- */
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.tipo === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.tipo === 'OBTENER_VERSION') {
    caches.open(CACHE_ESTATICO).then((cache) => cache.keys()).then((claves) => {
      event.source.postMessage({ tipo: 'VERSION', version: VERSION, recursos: claves.length });
    });
  }
});

/* ---------------- PETICIONES ---------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT van directo a la red

  const url = new URL(req.url);

  // 1) Navegación (abrir páginas): red primero, si falla -> caché -> offline.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE_DINAMICO).then((c) => c.put(req, copia));
          return resp;
        })
        .catch(async () =>
          (await caches.match(req)) ||
          (await caches.match('./index.html')) ||
          caches.match('./offline.html')
        )
    );
    return;
  }

  // 2) Recursos propios (CSS, JS, imágenes): caché primero y se actualiza en segundo plano
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((enCache) => {
        const deRed = fetch(req)
          .then((resp) => {
            if (resp && resp.ok) {
              const copia = resp.clone();
              caches.open(CACHE_DINAMICO).then((c) => c.put(req, copia));
            }
            return resp;
          })
          .catch(() => enCache);
        return enCache || deRed;
      })
    );
    return;
  }

  // 3) Recursos externos (API, mapas): solo red. Si no hay conexión responde 503
  //    para que la app pueda informar al usuario que la función requiere internet.
  event.respondWith(
    fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'sin_conexion', mensaje: 'Esta función requiere conexión a internet.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    ))
  );
});

/* ---------------- NOTIFICACIONES ---------------- */
// Al tocar una notificación se enfoca la app (o se abre si estaba cerrada)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ('focus' in v) return v.focus();
      }
      return self.clients.openWindow(destino);
    })
  );
});

// Ampliación: notificaciones push reales.
// Solo se ejecuta si se configura una suscripción con claves VAPID y un servidor
// que envíe mensajes push (ver documento técnico). Con notificaciones locales no se usa.
self.addEventListener('push', (event) => {
  let datos = { titulo: 'Incidencias', cuerpo: 'Tienes una actualización.' };
  try { if (event.data) datos = event.data.json(); } catch (e) { /* texto plano */ }
  event.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.cuerpo,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: './index.html' }
    })
  );
});
