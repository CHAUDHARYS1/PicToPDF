/* Everything PDF — field data model
   Field rects are always PDF user-space points (bottom-left origin, y-up),
   never screen pixels — see pdf-render.js for the conversion. */
window.EPDF = window.EPDF || {};

EPDF.FieldModel = (function () {
  // 'radio': same-named fields form a mutually-exclusive group (see
  // createStore's update() below). 'select': a fixed-choice dropdown —
  // carries an extra `options: [{value, label}, ...]` array.
  const TYPES = ['text', 'number', 'checkbox', 'radio', 'select', 'date', 'image'];
  const MIN_SIZE = 8; // pt — degenerate-drag guard

  let nextId = 1;
  function newFieldId() {
    if (window.crypto && crypto.randomUUID) return 'fld_' + crypto.randomUUID();
    return 'fld_' + (nextId++) + '_' + Date.now().toString(36);
  }

  function createField(partial) {
    const type = TYPES.includes(partial.type) ? partial.type : 'text';
    const field = {
      id: partial.id || newFieldId(),
      page: partial.page || 1,
      rect: {
        x: partial.rect?.x ?? 0,
        y: partial.rect?.y ?? 0,
        w: partial.rect?.w ?? 100,
        h: partial.rect?.h ?? 20,
      },
      name: partial.name || 'Field',
      type,
      value: partial.value ?? '',
      order: partial.order ?? 0,
    };
    if (type === 'select') field.options = Array.isArray(partial.options) ? partial.options : [];
    if (type === 'image') {
      field.src = partial.src || '';
      field.crop = partial.crop && typeof partial.crop === 'object'
        ? { x: partial.crop.x ?? 0, y: partial.crop.y ?? 0, w: partial.crop.w ?? 1, h: partial.crop.h ?? 1 }
        : { x: 0, y: 0, w: 1, h: 1 };
      field.naturalW = partial.naturalW || 0;
      field.naturalH = partial.naturalH || 0;
      field.lockAspect = partial.lockAspect ?? true;
    }
    return field;
  }

  /**
   * Validates + normalizes a candidate field against the rest of the store.
   * Returns { ok: true, field } or { ok: false, error }.
   * Does not mutate `field` or `allFields`.
   */
  function validate(field) {
    const f = { ...field, rect: { ...field.rect } };

    if (f.rect.w <= 0 || f.rect.h <= 0) {
      f.rect.w = Math.max(f.rect.w, MIN_SIZE);
      f.rect.h = Math.max(f.rect.h, MIN_SIZE);
    }
    if (f.rect.w < MIN_SIZE || f.rect.h < MIN_SIZE) {
      return { ok: false, error: 'Field is too small.' };
    }

    return { ok: true, field: f };
  }

  const UNDO_LIMIT = 50;

  function createStore() {
    let fields = [];
    let selectedId = null;
    let orderCounter = 0;
    const listeners = new Set();
    // Structural-change snapshots only (add/remove/rect change) — a plain
    // keystroke (valueOnly update) never pushes here, since the browser's
    // own per-input undo already covers text edits within a field.
    const undoStack = [];

    function emit(reason) {
      const snapshot = { fields: fields.slice(), selectedId, reason };
      listeners.forEach((fn) => fn(snapshot));
    }

    function pushUndo() {
      undoStack.push({ fields: fields.slice(), selectedId, timestamp: Date.now() });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }

    function add(partial) {
      pushUndo();
      const draft = createField({ ...partial, order: orderCounter++ });
      const result = validate(draft);
      if (!result.ok) { undoStack.pop(); throw new Error(result.error); }
      fields.push(result.field);
      selectedId = result.field.id;
      emit({ type: 'add', field: result.field });
      return result.field;
    }

    function update(id, patch) {
      const existing = fields.find((f) => f.id === id);
      if (!existing) return null;
      const valueOnly = isValueOnlyPatch(patch);
      if (!valueOnly) pushUndo();
      const merged = { ...existing, ...patch, rect: { ...existing.rect, ...(patch.rect || {}) } };
      const result = validate(merged);
      if (!result.ok) { if (!valueOnly) undoStack.pop(); throw new Error(result.error); }

      // Radio fields sharing a name form a group — checking one clears any
      // other checked field in that group, same as a real PDF radio group
      // (our fields just aren't nested under one shared parent to get this
      // structurally; see pdf-render.js's mapAnnotationToField for how a
      // detected radio group's fieldName carries over into `name` here).
      let radioCascaded = false;
      if (result.field.type === 'radio' && result.field.value === 'true') {
        fields = fields.map((f) => {
          if (f.id === id) return result.field;
          if (f.type === 'radio' && f.name === result.field.name && f.value) {
            radioCascaded = true;
            return { ...f, value: '' };
          }
          return f;
        });
      } else {
        fields = fields.map((f) => (f.id === id ? result.field : f));
      }

      // A radio cascade silently changes sibling fields too — a single-field
      // valueOnly refresh (see canvas-editor.js's store subscription) would
      // miss them, so force the full re-layout an ordinary change gets.
      emit({ type: 'update', field: result.field, valueOnly: valueOnly && !radioCascaded });
      return result.field;
    }

    function isValueOnlyPatch(patch) {
      const keys = Object.keys(patch);
      return keys.length === 1 && keys[0] === 'value';
    }

    function remove(id) {
      const existing = fields.find((f) => f.id === id);
      if (!existing) return;
      pushUndo();
      fields = fields.filter((f) => f.id !== id);
      if (selectedId === id) selectedId = null;
      emit({ type: 'remove', field: existing });
    }

    function undo() {
      if (undoStack.length === 0) return false;
      const snap = undoStack.pop();
      fields = snap.fields;
      selectedId = snap.selectedId;
      emit({ type: 'undo' });
      return true;
    }

    function canUndo() {
      return undoStack.length > 0;
    }

    // Wipes accumulated history without touching the fields themselves —
    // for the moment a PDF finishes loading: auto-detected/preset/restored
    // fields all go through add(), which pushes undo entries same as any
    // user action would, but the user hasn't done anything yet.
    function clearUndoHistory() {
      undoStack.length = 0;
    }

    function lastUndoTimestamp() {
      return undoStack.length ? undoStack[undoStack.length - 1].timestamp : 0;
    }

    function select(id) {
      if (selectedId === id) return;
      selectedId = id;
      emit({ type: 'select', field: id ? get(id) : null });
    }

    function getSelected() {
      return selectedId ? get(selectedId) : null;
    }

    function list() {
      return fields.slice().sort((a, b) => a.order - b.order);
    }

    function byPage(pageNum) {
      return list().filter((f) => f.page === pageNum);
    }

    function get(id) {
      return fields.find((f) => f.id === id) || null;
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    return { add, update, remove, select, getSelected, list, byPage, get, subscribe, undo, canUndo, lastUndoTimestamp, clearUndoHistory };
  }

  return { TYPES, createField, validate, createStore };
})();
