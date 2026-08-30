/* Everything PDF — freehand/shape annotation data model.
   Shape geometry is always PDF user-space points (bottom-left origin,
   y-up), same convention as field-model.js — see pdf-render.js for the
   conversion. Shape shapes:
     freehand: { points: [{x,y}, ...], color, strokeWidth }
     arrow:    { x1, y1, x2, y2, color, strokeWidth }
     rect:     { x, y, w, h, color, strokeWidth }
     ellipse:  { x, y, w, h, color, strokeWidth }
     text:     { x, y, text, fontSize, color }
   Every shape also has: id, page. */
window.EPDF = window.EPDF || {};

EPDF.Annotations = (function () {
  const UNDO_LIMIT = 50;

  function newId() {
    if (window.crypto && crypto.randomUUID) return 'ann_' + crypto.randomUUID();
    return 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  function createStore() {
    let shapes = [];
    let selectedId = null;
    const listeners = new Set();
    const undoStack = [];

    function emit(reason) {
      const snapshot = { shapes: shapes.slice(), selectedId, reason };
      listeners.forEach((fn) => fn(snapshot));
    }

    function pushUndo() {
      undoStack.push({ shapes: shapes.slice(), selectedId, timestamp: Date.now() });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }

    function add(partial) {
      pushUndo();
      const shape = { ...partial, id: newId() };
      shapes.push(shape);
      selectedId = shape.id;
      emit({ type: 'add', shape });
      return shape;
    }

    function update(id, patch) {
      const existing = shapes.find((s) => s.id === id);
      if (!existing) return null;
      pushUndo();
      const merged = { ...existing, ...patch, id };
      shapes = shapes.map((s) => (s.id === id ? merged : s));
      emit({ type: 'update', shape: merged });
      return merged;
    }

    function remove(id) {
      const existing = shapes.find((s) => s.id === id);
      if (!existing) return;
      pushUndo();
      shapes = shapes.filter((s) => s.id !== id);
      if (selectedId === id) selectedId = null;
      emit({ type: 'remove', shape: existing });
    }

    // Clears one page's shapes, or every page's if `page` is omitted.
    function clear(page) {
      const affected = page == null ? shapes : shapes.filter((s) => s.page === page);
      if (affected.length === 0) return;
      pushUndo();
      shapes = page == null ? [] : shapes.filter((s) => s.page !== page);
      selectedId = null;
      emit({ type: 'clear' });
    }

    function select(id) {
      if (selectedId === id) return;
      selectedId = id;
      emit({ type: 'select' });
    }

    function getSelected() {
      return selectedId ? get(selectedId) : null;
    }

    function list() { return shapes.slice(); }
    function byPage(page) { return shapes.filter((s) => s.page === page); }
    function get(id) { return shapes.find((s) => s.id === id) || null; }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function undo() {
      if (undoStack.length === 0) return false;
      const snap = undoStack.pop();
      shapes = snap.shapes;
      selectedId = snap.selectedId;
      emit({ type: 'undo' });
      return true;
    }

    function canUndo() { return undoStack.length > 0; }
    function lastUndoTimestamp() { return undoStack.length ? undoStack[undoStack.length - 1].timestamp : 0; }
    function clearUndoHistory() { undoStack.length = 0; }

    // For autosave/session persistence — shapes are plain JSON-safe data.
    function toJSON() { return shapes.slice(); }
    function loadJSON(arr) {
      shapes = Array.isArray(arr) ? arr.slice() : [];
      selectedId = null;
      emit({ type: 'load' });
    }

    return {
      add, update, remove, clear, select, getSelected, list, byPage, get,
      subscribe, undo, canUndo, lastUndoTimestamp, clearUndoHistory, toJSON, loadJSON,
    };
  }

  return { createStore };
})();
