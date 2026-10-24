# PWA - Registro de Incidencias

Actividad 10: Implementación de funcionalidades avanzadas en una PWA.
Desarrollo para Dispositivos Inteligentes - UTVT.

Aplicación web progresiva para registrar incidencias del campus (infraestructura, equipo de cómputo, limpieza, seguridad) con evidencia fotográfica, ubicación GPS, funcionamiento sin conexión y notificaciones.

## Funcionalidades

| Requisito | Implementación |
|---|---|
| Service Worker | `sw.js` con instalación, activación, limpieza de cachés y actualización controlada por el usuario |
| Offline | App Shell en Cache Storage + incidencias en IndexedDB |
| Notificaciones | Notificaciones locales con `Notification.requestPermission()` y `registration.showNotification()` |
| Característica física | Cámara (`getUserMedia`) y geolocalización (`navigator.geolocation`) |
| Función que requiere red | Sincronizar con servidor y ver ubicación en mapa |

## Estructura

```
pwa-incidencias/
├── index.html        Pantallas: lista, nueva incidencia, ajustes
├── offline.html      Página de respaldo sin conexión
├── manifest.json     Configuración de instalación
├── sw.js             Service Worker
├── styles.css        Estilos
├── js/
│   ├── db.js         IndexedDB (almacenamiento local)
│   └── app.js        Lógica de la app
└── icons/            Iconos 192, 512 y maskable
```

## Ejecutar en local

Los Service Workers solo funcionan en `https://` o en `localhost`. No abras `index.html` con doble clic.

Con Python:

```bash
cd pwa-incidencias
python -m http.server 8080
```

Abrir `http://localhost:8080`.

Con VS Code: extensión Live Server, clic derecho en `index.html` > Open with Live Server.

## Publicar en GitHub Pages

1. Crear repositorio `pwa-incidencias` y subir el contenido de esta carpeta a la raíz.
2. Settings > Pages > Branch: `main` / `(root)` > Save.
3. URL: `https://<usuario>.github.io/pwa-incidencias/`

Todas las rutas son relativas (`./`), por lo que funciona dentro de la subcarpeta de GitHub Pages.

## Publicar una actualización

Cambiar la constante `VERSION` en `sw.js` (por ejemplo `v1.0.1`) y subir los cambios. Al abrir la app aparece el aviso "Hay una nueva versión disponible" con el botón Actualizar.

## Pruebas rápidas (Chrome DevTools)

- Application > Service Workers: estado `activated and is running`.
- Application > Cache Storage: `incidencias-estatico-v1.0.0` con los recursos esenciales.
- Network > Offline (o Application > Service Workers > Offline) y recargar: la app abre.
- Application > Storage > IndexedDB > `incidencias-db`: incidencias guardadas.
- Lighthouse > PWA / Best practices.
