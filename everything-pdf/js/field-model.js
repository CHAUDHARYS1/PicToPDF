/* Everything PDF — field data model
   Field rects are always PDF user-space points (bottom-left origin, y-up),
   never screen pixels — see pdf-render.js for the conversion. */
window.EPDF = window.EPDF || {};

EPDF.FieldModel = (function () {
  const TYPES = ['text', 'number', 'checkbox', 'signature', 'date'];
  const BEHAVIORS = ['plain', 'sum', 'total'];
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
      behavior: type === 'number' && BEHAVIORS.includes(partial.behavior) ? partial.behavior : 'plain',
      targetTotalId: partial.targetTotalId ?? null,
      format: partial.format ?? null,
      value: partial.value ?? '',
      order: partial.order ?? 0,
    };
  }

  /**
   * Validates + normalizes a candidate field against the rest of the store.
   * Returns { ok: true, field } or { ok: false, error }.
   * Does not mutate `field` or `allFields`.
   */
  function validate(field, allFields) {
    const f = { ...field, rect: { ...field.rect } };

    if (f.rect.w <= 0 || f.rect.h <= 0) {
      f.rect.w = Math.max(f.rect.w, MIN_SIZE);
      f.rect.h = Math.max(f.rect.h, MIN_SIZE);
    }
    if (f.rect.w < MIN_SIZE || f.rect.h < MIN_SIZE) {
      return { ok: false, error: 'Field is too small.' };
    }

    if (f.type !== 'number') {
      // Rule 1/2: non-numeric fields can never carry sum/total behavior.
      f.behavior = 'plain';
      f.targetTotalId = null;
    }

    if (f.behavior === 'total') {
      // Rule 3: a total cannot itself feed another total.
      f.targetTotalId = null;
    }

    if (f.behavior === 'sum') {
      const target = allFields.find((other) => other.id === f.targetTotalId && other.id !== f.id);
      if (!target || target.behavior !== 'total') {
        return { ok: false, error: 'Sum field must target an existing "Is a total" field.' };
      }
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

    function cascadeDemote(totalId) {
      // Rule 2/4: demote every field that pointed its sum at a total field
      // that no longer qualifies (removed, or type/behavior changed away).
      fields = fields.map((f) =>
        f.targetTotalId === totalId ? { ...f, behavior: 'plain', targetTotalId: null } : f
      );
    }

    function add(partial) {
      const draft = createField({ ...partial, order: orderCounter++ });
      const result = validate(draft, fields);
      if (!result.ok) throw new Error(result.error);
      fields.push(result.field);
      selectedId = result.field.id;
      emit({ type: 'add', field: result.field });
      // A freshly-added field can already be a fully-formed sum contributor
      // (e.g. programmatic/template creation) — recompute its target if so.
      if (result.field.behavior === 'sum' && result.field.targetTotalId) {
        recomputeTotal(result.field.targetTotalId);
      }
      return result.field;
    }

    function update(id, patch) {
      const existing = fields.find((f) => f.id === id);
      if (!existing) return null;
      const wasTotal = existing.behavior === 'total';
      const merged = { ...existing, ...patch, rect: { ...existing.rect, ...(patch.rect || {}) } };
      const result = validate(merged, fields.filter((f) => f.id !== id));
      if (!result.ok) throw new Error(result.error);

      fields = fields.map((f) => (f.id === id ? result.field : f));

      // If this field stopped being a valid total (behavior changed away, or
      // type changed away from number), demote anything that summed into it.
      const stillTotal = result.field.behavior === 'total';
      if (wasTotal && !stillTotal) cascadeDemote(id);

      emit({ type: 'update', field: result.field, valueOnly: isValueOnlyPatch(patch) });

      // Recompute every total this field affects — its previous target (it
      // may have stopped contributing: value changed, behavior/type/target
      // changed away) and its current target (newly contributing, or its
      // value just changed). Covers value edits, behavior toggles, and
      // target-total reassignment with one rule instead of three.
      const affected = new Set();
      if (existing.behavior === 'sum' && existing.targetTotalId) affected.add(existing.targetTotalId);
      if (result.field.behavior === 'sum' && result.field.targetTotalId) affected.add(result.field.targetTotalId);
      affected.forEach((totalId) => recomputeTotal(totalId));

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
      if (existing.behavior === 'total') cascadeDemote(id);
      if (selectedId === id) selectedId = null;
      emit({ type: 'remove', field: existing });
      // Removing a sum contributor changes its total's sum.
      if (existing.behavior === 'sum' && existing.targetTotalId) {
        recomputeTotal(existing.targetTotalId);
      }
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

    /** Sums every field whose targetTotalId === totalFieldId, writes the
     *  result into the total field's value. Read-only fields (behavior:
     *  'total') are never typed into directly — this is the only writer. */
    function recomputeTotal(totalFieldId) {
      const total = get(totalFieldId);
      if (!total || total.behavior !== 'total') return null;
      const sum = fields
        .filter((f) => f.targetTotalId === totalFieldId)
        .reduce((acc, f) => acc + (parseFloat(f.value) || 0), 0);
      const formatted = sum.toFixed(2);
      if (total.value !== formatted) {
        fields = fields.map((f) => (f.id === totalFieldId ? { ...f, value: formatted } : f));
        emit({ type: 'update', field: get(totalFieldId), valueOnly: true });
      }
      return sum;
    }

    return {
      add, update, remove, select, getSelected, list, byPage, get, subscribe,
      recomputeTotal,
    };
  }

  return { TYPES, BEHAVIORS, createField, validate, createStore };
})();
