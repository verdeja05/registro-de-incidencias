/*
 * db.js
 * Almacenamiento local de incidencias con IndexedDB.
 * Permite registrar y consultar incidencias aunque no haya conexión.
 */
const DB = (() => {
  const NOMBRE_BD = 'incidencias-db';
  const VERSION_BD = 1;
  const TABLA = 'incidencias';
  let conexion = null;

  function abrir() {
    if (conexion) return Promise.resolve(conexion);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NOMBRE_BD, VERSION_BD);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(TABLA)) {
          const store = db.createObjectStore(TABLA, { keyPath: 'id' });
          store.createIndex('fecha', 'fecha');
          store.createIndex('sincronizada', 'sincronizada');
        }
      };
      req.onsuccess = () => { conexion = req.result; resolve(conexion); };
      req.onerror = () => reject(req.error);
    });
  }

  async function transaccion(modo, accion) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TABLA, modo);
      const store = tx.objectStore(TABLA);
      const req = accion(store);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    guardar: (incidencia) => transaccion('readwrite', (s) => s.put(incidencia)),
    obtener: (id) => transaccion('readonly', (s) => s.get(id)),
    eliminar: (id) => transaccion('readwrite', (s) => s.delete(id)),
    limpiar: () => transaccion('readwrite', (s) => s.clear()),
    async listar() {
      const todas = await transaccion('readonly', (s) => s.getAll());
      return (todas || []).sort((a, b) => b.fecha - a.fecha);
    },
    async pendientes() {
      const todas = await this.listar();
      return todas.filter((i) => !i.sincronizada);
    }
  };
})();
