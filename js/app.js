/*
 * app.js - Lógica principal de la PWA de Incidencias
 *
 * Módulos:
 *   1. Utilidades y navegación entre pantallas
 *   2. Service Worker: registro, actualización y diagnóstico
 *   3. Estado de conexión (online / offline)
 *   4. Notificaciones locales
 *   5. Cámara (getUserMedia + input file como respaldo)
 *   6. Geolocalización
 *   7. Registro, lista y detalle de incidencias (IndexedDB)
 *   8. Sincronización con servidor (requiere internet)
 *   9. Instalación de la app
 */

/* =========================================================
 * 1. UTILIDADES Y NAVEGACIÓN
 * ========================================================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const API_URL = 'https://jsonplaceholder.typicode.com/posts'; // servidor de prueba

let registroSW = null;
let fotoActual = null;       // dataURL de la foto
let ubicacionActual = null;  // { lat, lng, precision }
let streamCamara = null;
let incidenciaAbierta = null;

function toast(mensaje, tipo = 'normal') {
  const t = $('#toast');
  t.textContent = mensaje;
  t.className = 'toast visible' + (tipo === 'error' ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('visible'), 3200);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

function generarId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatearFecha(ms) {
  return new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function irA(vista) {
  $$('.vista').forEach((v) => v.classList.remove('activa'));
  $(`#vista-${vista}`).classList.add('activa');
  $$('.tabbar button').forEach((b) => b.classList.toggle('activo', b.dataset.ir === vista));
  if (vista !== 'nueva') cerrarCamara();
  if (vista === 'lista') renderLista();
  if (vista === 'ajustes') actualizarDiagnostico();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const boton = e.target.closest('[data-ir]');
  if (boton) irA(boton.dataset.ir);
});

/* =========================================================
 * 2. SERVICE WORKER
 * ========================================================= */
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Este navegador no soporta Service Workers');
    return;
  }
  try {
    registroSW = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('Service Worker registrado. Alcance:', registroSW.scope);

    // Ya había una versión nueva esperando
    if (registroSW.waiting && navigator.serviceWorker.controller) {
      mostrarAvisoActualizacion();
    }

    // Se encontró una versión nueva de sw.js
    registroSW.addEventListener('updatefound', () => {
      const nuevo = registroSW.installing;
      nuevo.addEventListener('statechange', () => {
        console.log('Nuevo Service Worker:', nuevo.state);
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          mostrarAvisoActualizacion();
        }
      });
    });

    // Buscar actualizaciones cada 30 minutos mientras la app esté abierta
    setInterval(() => registroSW.update(), 30 * 60 * 1000);
  } catch (err) {
    console.error('Error al registrar el Service Worker:', err);
    toast('No se pudo registrar el Service Worker', 'error');
  }
}

function mostrarAvisoActualizacion() {
  // Solo se muestra si de verdad hay una versión nueva esperando
  // y la página ya estaba controlada por una versión anterior.
  if (!registroSW || !registroSW.waiting || !navigator.serviceWorker.controller) return;
  $('#bannerActualizacion').hidden = false;
}

let actualizacionSolicitada = false;

$('#btnActualizar').addEventListener('click', () => {
  if (registroSW && registroSW.waiting) {
    actualizacionSolicitada = true;
    registroSW.waiting.postMessage({ tipo: 'SKIP_WAITING' });
  }
});

// Cuando la nueva versión toma el control se recarga una sola vez.
// Solo si el usuario pidió actualizar (en la primera visita clients.claim()
// también dispara este evento y no se debe recargar).
let recargando = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!actualizacionSolicitada || recargando) return;
    recargando = true;
    window.location.reload();
  });

  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.tipo === 'VERSION') {
      $('#dCache').textContent = e.data.version;
      $('#dRecursos').textContent = `${e.data.recursos} archivos esenciales`;
    }
  });
}

$('#btnBuscarActualizacion').addEventListener('click', async () => {
  if (!registroSW) return toast('Service Worker no registrado', 'error');
  if (!navigator.onLine) return toast('Buscar actualizaciones requiere conexión a internet', 'error');
  await registroSW.update();
  if (registroSW.waiting || registroSW.installing) {
    mostrarAvisoActualizacion();
    toast('Se encontró una nueva versión');
  } else {
    toast('Ya tienes la versión más reciente');
  }
});

function actualizarDiagnostico() {
  const si = (v) => (v ? 'Sí' : 'No');
  $('#dSW').textContent = si('serviceWorker' in navigator);
  $('#dCamara').textContent = si(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  $('#dGeo').textContent = si('geolocation' in navigator);
  const permisos = { granted: 'Concedido', denied: 'Bloqueado', default: 'Sin decidir' };
  $('#dNoti').textContent = 'Notification' in window ? permisos[Notification.permission] : 'No soportado';
  $('#dModo').textContent = window.matchMedia('(display-mode: standalone)').matches
    ? 'Instalada (standalone)' : 'Navegador';

  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    $('#dEstadoSW').textContent = 'Activo y controlando la página';
    navigator.serviceWorker.controller.postMessage({ tipo: 'OBTENER_VERSION' });
  } else if (registroSW) {
    $('#dEstadoSW').textContent = 'Registrado (recarga para que tome el control)';
  } else {
    $('#dEstadoSW').textContent = 'No registrado';
  }
  actualizarEstadoPermisoNoti();
}

/* =========================================================
 * 3. ESTADO DE CONEXIÓN
 * ========================================================= */
function actualizarEstadoRed() {
  const enLinea = navigator.onLine;
  const chip = $('#estadoRed');
  chip.className = 'chip ' + (enLinea ? 'chip-online' : 'chip-offline');
  chip.innerHTML = enLinea
    ? '<svg><use href="#i-wifi"/></svg><span>En línea</span>'
    : '<svg><use href="#i-wifi-off"/></svg><span>Sin conexión</span>';
  $('#bannerOffline').hidden = enLinea;

  // Los controles que necesitan internet se ven deshabilitados sin conexión
  $$('[data-requiere-red]').forEach((b) => {
    b.classList.toggle('deshabilitado', !enLinea);
    b.title = enLinea ? '' : 'Requiere conexión a internet';
  });
}

window.addEventListener('online', async () => {
  actualizarEstadoRed();
  const pendientes = await DB.pendientes();
  mostrarNotificacion('Conexión restablecida',
    pendientes.length
      ? `Sincronizando ${pendientes.length} incidencia(s) pendiente(s).`
      : 'Todas tus incidencias están al día.');
  if (pendientes.length) sincronizar(true);
});

window.addEventListener('offline', () => {
  actualizarEstadoRed();
  toast('Sin conexión. Los datos se guardarán en el dispositivo');
});

/* =========================================================
 * 4. NOTIFICACIONES LOCALES
 * ========================================================= */
function actualizarEstadoPermisoNoti() {
  const texto = {
    granted: 'Concedido',
    denied: 'Bloqueado (cámbialo en la configuración del sitio)',
    default: 'Sin decidir'
  };
  $('#estadoPermisoNoti').textContent =
    'Notification' in window ? texto[Notification.permission] : 'No soportado en este navegador';
  $('#btnPermisoNoti').hidden = 'Notification' in window && Notification.permission === 'granted';
}

async function pedirPermisoNotificaciones() {
  if (!('Notification' in window)) {
    toast('Este navegador no soporta notificaciones', 'error');
    return false;
  }
  if (Notification.permission === 'denied') {
    toast('Las notificaciones están bloqueadas. Actívalas desde el candado de la barra de direcciones', 'error');
    return false;
  }
  const permiso = await Notification.requestPermission();
  actualizarEstadoPermisoNoti();
  if (permiso === 'granted') {
    mostrarNotificacion('Notificaciones activadas', 'Te avisaremos sobre tus incidencias.');
    return true;
  }
  toast('No se concedió el permiso de notificaciones', 'error');
  return false;
}

async function mostrarNotificacion(titulo, cuerpo) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opciones = {
    body: cuerpo,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'incidencias-' + Date.now(),
    data: { url: './index.html' }
  };
  try {
    // En Android/Chrome se debe usar el Service Worker para mostrar notificaciones
    const reg = registroSW || (await navigator.serviceWorker?.getRegistration());
    if (reg) await reg.showNotification(titulo, opciones);
    else new Notification(titulo, opciones);
  } catch (err) {
    console.error('Error al mostrar notificación:', err);
  }
}

$('#btnPermisoNoti').addEventListener('click', pedirPermisoNotificaciones);
$('#btnProbarNoti').addEventListener('click', async () => {
  if (Notification.permission !== 'granted') {
    const ok = await pedirPermisoNotificaciones();
    if (!ok) return;
  }
  mostrarNotificacion('Notificación de prueba', 'Las notificaciones funcionan correctamente.');
});

/* =========================================================
 * 5. CÁMARA
 * ========================================================= */
async function abrirCamara() {
  if (!window.isSecureContext) {
    return toast('La cámara solo funciona en HTTPS o localhost', 'error');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Tu navegador no permite usar la cámara aquí. Usa "Elegir imagen"', 'error');
    return;
  }
  try {
    toast('Se solicitará permiso para usar la cámara');
    streamCamara = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    $('#video').srcObject = streamCamara;
    $('#camaraWrap').hidden = false;
  } catch (err) {
    const mensajes = {
      NotAllowedError: 'Permiso de cámara denegado. Actívalo en la configuración del sitio',
      NotFoundError: 'No se encontró ninguna cámara en el dispositivo',
      NotReadableError: 'La cámara está siendo usada por otra aplicación',
      OverconstrainedError: 'La cámara no cumple con la configuración solicitada'
    };
    toast(mensajes[err.name] || 'No se pudo abrir la cámara: ' + err.message, 'error');
    console.error('Error de cámara:', err);
  }
}

function cerrarCamara() {
  if (streamCamara) {
    streamCamara.getTracks().forEach((t) => t.stop());
    streamCamara = null;
  }
  const wrap = $('#camaraWrap');
  if (wrap) wrap.hidden = true;
}

// Reduce la imagen para no saturar el almacenamiento local
function comprimirImagen(fuente, anchoOriginal, altoOriginal, anchoMax = 1024) {
  const escala = Math.min(1, anchoMax / anchoOriginal);
  const canvas = $('#canvas');
  canvas.width = Math.round(anchoOriginal * escala);
  canvas.height = Math.round(altoOriginal * escala);
  canvas.getContext('2d').drawImage(fuente, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

function establecerFoto(dataURL) {
  fotoActual = dataURL;
  $('#previewFoto').src = dataURL;
  $('#previewWrap').hidden = false;
}

$('#btnAbrirCamara').addEventListener('click', abrirCamara);
$('#btnCerrarCamara').addEventListener('click', cerrarCamara);

$('#btnCapturar').addEventListener('click', () => {
  const video = $('#video');
  if (!video.videoWidth) return toast('La cámara aún no está lista', 'error');
  establecerFoto(comprimirImagen(video, video.videoWidth, video.videoHeight));
  cerrarCamara();
  toast('Foto capturada');
});

// Respaldo: selector de archivo (en móviles abre la cámara nativa por "capture")
$('#inputFoto').addEventListener('change', (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  const img = new Image();
  img.onload = () => {
    establecerFoto(comprimirImagen(img, img.naturalWidth, img.naturalHeight));
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => toast('No se pudo leer la imagen', 'error');
  img.src = URL.createObjectURL(archivo);
  e.target.value = '';
});

$('#btnQuitarFoto').addEventListener('click', () => {
  fotoActual = null;
  $('#previewWrap').hidden = true;
});

/* =========================================================
 * 6. GEOLOCALIZACIÓN
 * ========================================================= */
function obtenerUbicacion() {
  if (!('geolocation' in navigator)) {
    toast('Este navegador no soporta geolocalización', 'error');
    return;
  }
  if (!window.isSecureContext) {
    toast('La ubicación solo funciona en HTTPS o localhost', 'error');
    return;
  }
  const texto = $('#textoUbicacion');
  texto.textContent = 'Obteniendo ubicación... acepta el permiso si el navegador lo solicita.';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ubicacionActual = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        precision: Math.round(pos.coords.accuracy)
      };
      texto.textContent =
        `Lat ${ubicacionActual.lat.toFixed(6)}, Lng ${ubicacionActual.lng.toFixed(6)} ` +
        `(precisión aprox. ${ubicacionActual.precision} m)`;
      toast('Ubicación obtenida');
    },
    (err) => {
      const mensajes = {
        1: 'Permiso de ubicación denegado. Actívalo en la configuración del sitio',
        2: 'No se pudo determinar la ubicación (activa el GPS)',
        3: 'Se agotó el tiempo para obtener la ubicación'
      };
      texto.textContent = mensajes[err.code] || 'Error al obtener ubicación';
      toast(texto.textContent, 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

$('#btnUbicacion').addEventListener('click', obtenerUbicacion);

/* =========================================================
 * 7. INCIDENCIAS: REGISTRO, LISTA Y DETALLE
 * ========================================================= */
$('#formIncidencia').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titulo = $('#titulo').value.trim();
  if (!titulo) {
    $('#titulo').focus();
    return toast('Escribe un título para la incidencia', 'error');
  }

  const incidencia = {
    id: generarId(),
    titulo,
    tipo: $('#tipo').value,
    prioridad: $('#prioridad').value,
    descripcion: $('#descripcion').value.trim(),
    foto: fotoActual,
    ubicacion: ubicacionActual,
    fecha: Date.now(),
    sincronizada: false
  };

  try {
    await DB.guardar(incidencia);
    limpiarFormulario();
    toast(navigator.onLine ? 'Incidencia guardada' : 'Incidencia guardada sin conexión');
    mostrarNotificacion('Incidencia registrada',
      `"${titulo}" (prioridad ${incidencia.prioridad}) se guardó en el dispositivo.`);
    irA('lista');
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar la incidencia', 'error');
  }
});

function limpiarFormulario() {
  $('#formIncidencia').reset();
  fotoActual = null;
  ubicacionActual = null;
  $('#previewWrap').hidden = true;
  $('#textoUbicacion').textContent = 'Sin ubicación.';
  cerrarCamara();
}

async function renderLista() {
  const todas = await DB.listar();
  const texto = $('#buscar').value.trim().toLowerCase();
  const tipo = $('#filtroTipo').value;

  const filtradas = todas.filter((i) =>
    (!tipo || i.tipo === tipo) &&
    (!texto || i.titulo.toLowerCase().includes(texto) || (i.descripcion || '').toLowerCase().includes(texto))
  );

  $('#statTotal').textContent = todas.length;
  $('#statPendientes').textContent = todas.filter((i) => !i.sincronizada).length;
  $('#statAltas').textContent = todas.filter((i) => i.prioridad === 'alta').length;

  const ul = $('#listaIncidencias');
  ul.innerHTML = filtradas.map((i) => `
    <li class="item" data-id="${i.id}">
      ${i.foto
        ? `<img class="item-foto" src="${i.foto}" alt="">`
        : '<div class="item-foto"><svg><use href="#i-alert"/></svg></div>'}
      <div class="item-info">
        <h4>${escaparHTML(i.titulo)}</h4>
        <p>${escaparHTML(i.tipo)} &middot; ${formatearFecha(i.fecha)}</p>
        <div class="etiquetas">
          <span class="tag tag-${i.prioridad}">Prioridad ${i.prioridad}</span>
          <span class="tag ${i.sincronizada ? 'tag-sinc' : 'tag-pend'}">${i.sincronizada ? 'Sincronizada' : 'Pendiente'}</span>
          ${i.ubicacion ? '<span class="tag">Con ubicación</span>' : ''}
        </div>
      </div>
    </li>`).join('');

  $('#listaVacia').hidden = todas.length > 0;
  if (todas.length > 0 && filtradas.length === 0) {
    ul.innerHTML = '<li class="vacio"><p>Sin resultados para el filtro.</p></li>';
  }
}

$('#buscar').addEventListener('input', renderLista);
$('#filtroTipo').addEventListener('change', renderLista);

$('#listaIncidencias').addEventListener('click', async (e) => {
  const li = e.target.closest('.item');
  if (!li) return;
  const inc = await DB.obtener(li.dataset.id);
  if (inc) abrirDetalle(inc);
});

function abrirDetalle(inc) {
  incidenciaAbierta = inc;
  $('#detTitulo').textContent = inc.titulo;
  $('#detTipo').textContent = inc.tipo;
  $('#detPrioridad').textContent = inc.prioridad;
  $('#detFecha').textContent = formatearFecha(inc.fecha);
  $('#detEstado').textContent = inc.sincronizada ? 'Sincronizada con el servidor' : 'Pendiente de sincronizar';
  $('#detDescripcion').textContent = inc.descripcion || 'Sin descripción';
  $('#detUbicacion').textContent = inc.ubicacion
    ? `${inc.ubicacion.lat.toFixed(6)}, ${inc.ubicacion.lng.toFixed(6)} (±${inc.ubicacion.precision} m)`
    : 'No registrada';
  $('#btnVerMapa').hidden = !inc.ubicacion;
  const img = $('#detFoto');
  img.hidden = !inc.foto;
  if (inc.foto) img.src = inc.foto;
  $('#modalDetalle').showModal();
}

$('#btnCerrarModal').addEventListener('click', () => $('#modalDetalle').close());

// Ver en mapa: función que requiere internet
$('#btnVerMapa').addEventListener('click', () => {
  if (!navigator.onLine) {
    return toast('Ver el mapa requiere conexión a internet. Las coordenadas sí están guardadas', 'error');
  }
  const { lat, lng } = incidenciaAbierta.ubicacion;
  window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`, '_blank', 'noopener');
});

$('#btnEliminar').addEventListener('click', async () => {
  if (!incidenciaAbierta || !confirm('¿Eliminar esta incidencia?')) return;
  await DB.eliminar(incidenciaAbierta.id);
  $('#modalDetalle').close();
  toast('Incidencia eliminada');
  renderLista();
});

$('#btnBorrarTodo').addEventListener('click', async () => {
  if (!confirm('Se eliminarán todas las incidencias guardadas en este dispositivo. ¿Continuar?')) return;
  await DB.limpiar();
  toast('Datos locales eliminados');
  renderLista();
});

/* =========================================================
 * 8. SINCRONIZACIÓN (REQUIERE INTERNET)
 * ========================================================= */
let sincronizando = false;

async function sincronizar(automatica = false) {
  if (!navigator.onLine) {
    toast('Sincronizar requiere conexión a internet. Tus incidencias siguen guardadas en el dispositivo', 'error');
    return;
  }
  if (sincronizando) return;
  const pendientes = await DB.pendientes();
  if (!pendientes.length) {
    if (!automatica) toast('No hay incidencias pendientes de sincronizar');
    return;
  }

  sincronizando = true;
  const boton = $('#btnSincronizar');
  boton.disabled = true;
  let enviadas = 0;

  for (const inc of pendientes) {
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // La foto no se envía al servidor de prueba para no exceder su límite
        body: JSON.stringify({
          titulo: inc.titulo, tipo: inc.tipo, prioridad: inc.prioridad,
          descripcion: inc.descripcion, ubicacion: inc.ubicacion, fecha: inc.fecha
        })
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const datos = await resp.json();
      inc.sincronizada = true;
      inc.idServidor = datos.id;
      await DB.guardar(inc);
      enviadas++;
    } catch (err) {
      console.error('Error al sincronizar', inc.id, err);
    }
  }

  sincronizando = false;
  boton.disabled = false;
  renderLista();

  if (enviadas === pendientes.length) {
    toast(`${enviadas} incidencia(s) sincronizada(s)`);
    mostrarNotificacion('Sincronización completa', `${enviadas} incidencia(s) enviada(s) al servidor.`);
  } else {
    toast(`Se sincronizaron ${enviadas} de ${pendientes.length}. Intenta de nuevo más tarde`, 'error');
  }
}

$('#btnSincronizar').addEventListener('click', () => sincronizar(false));

/* =========================================================
 * 9. INSTALACIÓN DE LA APP
 * ========================================================= */
let eventoInstalacion = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  eventoInstalacion = e;
  $('#btnInstalar').hidden = false;
});

$('#btnInstalar').addEventListener('click', async () => {
  if (!eventoInstalacion) return;
  eventoInstalacion.prompt();
  const { outcome } = await eventoInstalacion.userChoice;
  toast(outcome === 'accepted' ? 'App instalada' : 'Instalación cancelada');
  eventoInstalacion = null;
  $('#btnInstalar').hidden = true;
});

window.addEventListener('appinstalled', () => toast('La app se instaló correctamente'));

/* =========================================================
 * INICIO
 * ========================================================= */
window.addEventListener('load', () => {
  registrarServiceWorker();
  actualizarEstadoRed();
  actualizarEstadoPermisoNoti();
  renderLista();
});
