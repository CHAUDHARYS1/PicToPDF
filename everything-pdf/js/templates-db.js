/* Everything PDF — IndexedDB template persistence.
   Pattern ported from Loan/src/lib/docsDb.ts: a fresh connection per call via
   a promisified openDb(), separate promisified wrapper functions per
   operation. Fully implemented in Milestone 1 even though no UI calls it
   yet (M6 wires this into the dashboard/editor) — de-risks that later
   milestone since the schema has zero surprises left by then. */
window.EPDF = window.EPDF || {};

EPDF.TemplatesDb = (function () {
  const DB_NAME = 'everything_pdf';
  // v2 adds the `session` store (autosaved in-progress work) — existing
  // `templates`/`sourcePdfs` data survives the upgrade untouched, since
  // onupgradeneeded only ever adds stores it finds missing.
  const DB_VERSION = 2;
  const STORE_TEMPLATES = 'templates';
  const STORE_SOURCE_PDFS = 'sourcePdfs';
  const STORE_SESSION = 'session';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
          db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SOURCE_PDFS)) {
          db.createObjectStore(STORE_SOURCE_PDFS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SESSION)) {
          db.createObjectStore(STORE_SESSION, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function newId(prefix) {
    if (window.crypto && crypto.randomUUID) return prefix + '_' + crypto.randomUUID();
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  // ── templates store ──────────────────────────────────────────────
  // Record shape: { id, name, sourcePdfId, pageCount, pageSizes:[{width,height}],
  //                 fields: [...FieldModel objects], createdAt, updatedAt }

  async function saveTemplate(record) {
    const db = await openDb();
    const now = Date.now();
    const full = {
      id: record.id || newId('tmpl'),
      name: record.name,
      sourcePdfId: record.sourcePdfId,
      pageCount: record.pageCount,
      pageSizes: record.pageSizes,
      fields: record.fields,
      createdAt: record.createdAt || now,
      updatedAt: now,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
      tx.objectStore(STORE_TEMPLATES).put(full);
      tx.oncomplete = () => resolve(full);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadTemplate(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TEMPLATES, 'readonly');
      const req = tx.objectStore(STORE_TEMPLATES).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function listTemplates() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TEMPLATES, 'readonly');
      const req = tx.objectStore(STORE_TEMPLATES).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteTemplate(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
      tx.objectStore(STORE_TEMPLATES).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── source PDFs store ────────────────────────────────────────────
  // Record shape: { id, bytes: ArrayBuffer, originalFilename, mimeType }

  async function storeSourcePdf(record) {
    const db = await openDb();
    const full = {
      id: record.id || newId('pdf'),
      bytes: record.bytes,
      originalFilename: record.originalFilename,
      mimeType: record.mimeType || 'application/pdf',
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SOURCE_PDFS, 'readwrite');
      tx.objectStore(STORE_SOURCE_PDFS).put(full);
      tx.oncomplete = () => resolve(full);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadSourcePdf(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SOURCE_PDFS, 'readonly');
      const req = tx.objectStore(STORE_SOURCE_PDFS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // ── session store — autosaved in-progress work (one slot, key 'current')
  // Record shape: { id:'current', originalBytes, originalFileName,
  //   currentTemplateId, pageNumber, pageRotation, fields, annotations,
  //   updatedAt }. Distinct from a template: values are real (not blanked),
  // and there's only ever one, since the editor only ever holds one PDF.

  async function saveSession(record) {
    const db = await openDb();
    const full = { ...record, id: 'current', updatedAt: Date.now() };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSION, 'readwrite');
      tx.objectStore(STORE_SESSION).put(full);
      tx.oncomplete = () => resolve(full);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadSession() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSION, 'readonly');
      const req = tx.objectStore(STORE_SESSION).get('current');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearSession() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSION, 'readwrite');
      tx.objectStore(STORE_SESSION).delete('current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    saveTemplate, loadTemplate, listTemplates, deleteTemplate, storeSourcePdf, loadSourcePdf,
    saveSession, loadSession, clearSession,
  };
})();
