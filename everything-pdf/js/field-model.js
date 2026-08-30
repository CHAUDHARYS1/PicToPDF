/* Everything PDF — field data model
   Field rects are always PDF user-space points (bottom-left origin, y-up),
   never screen pixels — see pdf-render.js for the conversion. */
window.EPDF = window.EPDF || {};

EPDF.FieldModel = (function () {
  const TYPES = ['text', 'number', 'checkbox', 'signature', 'date'];
  const MIN_SIZE = 8; // pt — degenerate-drag guard

  let nextId = 1;
  function newFieldId() {
    if (window.crypto && crypto.randomUUID) return 'fld_' + crypto.randomUUID();
    return 'fld_' + (nextId++) + '_' + Date.now().toString(36);
  }

  function createField(partial) {
    const type = TYPES.includes(partial.type) ? partial.type : 'text';
    return {
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

  function createStore() {
    let fields = [];
    let selectedId = null;
    let orderCounter = 0;
    const listeners = new Set();

    function emit(reason) {
      const snapshot = { fields: fields.slice(), selectedId, reason };
      listeners.forEach((fn) => fn(snapshot));
    }

    function add(partial) {
      const draft = createField({ ...partial, order: orderCounter++ });
      const result = validate(draft);
      if (!result.ok) throw new Error(result.error);
      fields.push(result.field);
      selectedId = result.field.id;
      emit({ type: 'add', field: result.field });
      return result.field;
    }

    function update(id, patch) {
      const existing = fields.find((f) => f.id === id);
      if (!existing) return null;
      const merged = { ...existing, ...patch, rect: { ...existing.rect, ...(patch.rect || {}) } };
      const result = validate(merged);
      if (!result.ok) throw new Error(result.error);

      fields = fields.map((f) => (f.id === id ? result.field : f));
      emit({ type: 'update', field: result.field, valueOnly: isValueOnlyPatch(patch) });
      return result.field;
    }

    function isValueOnlyPatch(patch) {
      const keys = Object.keys(patch);
      return keys.length === 1 && keys[0] === 'value';
    }

    function remove(id) {
      const existing = fields.find((f) => f.id === id);
      if (!existing) return;
      fields = fields.filter((f) => f.id !== id);
      if (selectedId === id) selectedId = null;
      emit({ type: 'remove', field: existing });
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

    return { add, update, remove, select, getSelected, list, byPage, get, subscribe };
  }

  return { TYPES, createField, validate, createStore };
})();
